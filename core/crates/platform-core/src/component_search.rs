//! DD-138(5), `.design/07` §4.8.4 / §5.2: component content as a source of
//! Kailo「搜索全部」.
//!
//! Only a `REMOTE_ADAPTER` release that declares `searchSource=SUPPORTED` is a
//! source; a native-page-only release (`ExecutionConnector=NONE`) is never
//! called. For each candidate binding Core checks, as the current HUMAN and
//! fully consistent, `read` on every ACTIVE Resource of the binding; only the
//! readable ones are sent, and a binding with none is not called. The adapter
//! is authenticated with a 60 s Search Token (ActionToken key and JWKS,
//! `token_use=COMPONENT_SEARCH`) bound to this exact request body. Answers are
//! all-or-nothing per binding, never stored, and each result opens in the
//! Kailo content area through the category's effective native page entry.
//! No ActionExecution, no Quota.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::Duration;

use axum::{
    extract::State,
    http::{header::CACHE_CONTROL, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::ReasonCode;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    bff::{resolve_execution_context, BffState, ExecutionContext},
    governance::Refusal,
};

pub(crate) const TOKEN_USE: &str = "COMPONENT_SEARCH";
const QUERY_MAX: usize = 200;
const LIMIT_DEFAULT: i64 = 8;
const LIMIT_MAX: i64 = 20;
const RESOURCES_PER_BINDING: usize = 50;
/// Resources examined per binding before the `read` filter; bounds one search.
const RESOURCE_SCAN_PER_BINDING: i64 = 500;
const TITLE_MAX: usize = 200;
const SUMMARY_MAX: usize = 400;
const CALL_TIMEOUT: Duration = Duration::from_secs(5);
const CATEGORIES: [&str; 3] = ["file_storage", "knowledge", "data_query"];

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

/// The admitted query: trimmed text, per-source limit and result locale.
#[derive(Debug, PartialEq)]
pub(crate) struct Admitted {
    pub(crate) query: String,
    pub(crate) limit: i64,
    pub(crate) locale: &'static str,
}

pub(crate) fn admit_query(query: &contracts::ComponentSearchQuery) -> Result<Admitted, Refusal> {
    let text = query.q.trim();
    let count = text.chars().count();
    if !(1..=QUERY_MAX).contains(&count) || text.chars().any(char::is_control) {
        return Err(invalid());
    }
    let limit = query.limit.unwrap_or(LIMIT_DEFAULT);
    if !(1..=LIMIT_MAX).contains(&limit) {
        return Err(invalid());
    }
    let locale = match query.locale.as_deref() {
        None | Some("ZH_CN") => "ZH_CN",
        Some("EN") => "EN",
        Some(_) => return Err(invalid()),
    };
    Ok(Admitted {
        query: text.to_owned(),
        limit,
        locale,
    })
}

/// One adapter answer, accepted only as a whole (07 §4.8.4).
pub(crate) fn accept_response(raw: &Value, limit: i64) -> Option<Vec<Value>> {
    let typed: contracts::AdapterSearchResponse = serde_json::from_value(raw.clone()).ok()?;
    if serde_json::to_value(&typed).ok()? != *raw || typed.results.len() as i64 > limit {
        return None;
    }
    let text_ok = |value: &str, min: usize, max: usize| {
        let count = value.chars().count();
        (min..=max).contains(&count)
            && !value.chars().any(char::is_control)
            && (min == 0 || !value.trim().is_empty())
    };
    let mut accepted = Vec::with_capacity(typed.results.len());
    for (item, value) in typed.results.iter().zip(raw["results"].as_array()?) {
        if !text_ok(&item.title, 1, TITLE_MAX)
            || item
                .summary
                .as_deref()
                .is_some_and(|summary| !text_ok(summary, 0, SUMMARY_MAX))
            || !crate::component_notification::component_path(&item.path)
            || item
                .updated_at
                .as_deref()
                .is_some_and(|at| chrono::DateTime::parse_from_rfc3339(at).is_err())
        {
            return None;
        }
        accepted.push(value.clone());
    }
    Some(accepted)
}

#[derive(sqlx::FromRow)]
struct Candidate {
    id: Uuid,
    workspace_id: Option<Uuid>,
    generation: i64,
    manifest: Value,
    adapter_service_ref: Option<String>,
    native_instance_ref: Option<String>,
}

#[derive(sqlx::FromRow)]
struct Entry {
    id: Uuid,
    workspace_id: Option<Uuid>,
    category: String,
}

/// The source's presentation category: the capability category it implements.
fn source_category(manifest: &Value) -> Option<&'static str> {
    manifest["implements"].as_array()?.iter().find_map(|item| {
        CATEGORIES
            .iter()
            .copied()
            .find(|category| item["categoryKey"] == *category)
    })
}

/// The native page entry a result opens in: the same Workspace's entry of the
/// category, else the Tenant-level one (the sidebar's resolution order).
fn entry_for(entries: &[Entry], category: &str, workspace: Option<Uuid>) -> Option<Uuid> {
    let of = |scope: Option<Uuid>| {
        entries
            .iter()
            .filter(|entry| entry.category == category && entry.workspace_id == scope)
            .map(|entry| entry.id)
            .min()
    };
    workspace.and_then(|w| of(Some(w))).or_else(|| of(None))
}

/// `POST /api/v1/search/components`.
pub(crate) async fn search(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: Result<Json<contracts::ComponentSearchQuery>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let Ok(Json(query)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let admitted = match admit_query(&query) {
        Ok(admitted) => admitted,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    match fan_out(&state, &ctx, &admitted).await {
        Ok(body) => ([(CACHE_CONTROL, "no-store")], Json(body)).into_response(),
        Err(error) => error.respond(None),
    }
}

async fn fan_out(
    state: &BffState,
    ctx: &ExecutionContext,
    admitted: &Admitted,
) -> Result<Value, Refusal> {
    let candidates: Vec<Candidate> = sqlx::query_as(
        "select b.id,b.workspace_id,b.active_projection_generation as generation,r.manifest,
           b.adapter_service_ref,b.native_instance_ref
         from catalog.application_binding b
         join catalog.component_release r on r.id=b.component_release_id and r.status='APPROVED'
         join projection.application_runtime p on p.binding_id=b.id
           and p.generation=b.active_projection_generation and p.component_release_id=r.id
           and p.state='ACTIVE'
         join identity.tenant t on t.id=b.tenant_id and t.state='ACTIVE'
         where b.tenant_id=$1 and b.state='ACTIVE' and b.active_projection_generation>0
           and r.manifest->'executionConnector'->>'mode'='REMOTE_ADAPTER'
           and r.manifest->'executionConnector'->>'searchSource'='SUPPORTED'
         order by b.id",
    )
    .bind(ctx.tenant_id)
    .fetch_all(&state.pool)
    .await?;
    let entries: Vec<Entry> = sqlx::query_as(
        "select b.id,b.workspace_id,r.manifest->'frontendDelivery'->>'nativePageCategory' as category
         from catalog.application_binding b
         join catalog.component_release r on r.id=b.component_release_id and r.status='APPROVED'
         join projection.application_runtime p on p.binding_id=b.id
           and p.generation=b.active_projection_generation and p.component_release_id=r.id
           and p.state='ACTIVE'
         where b.tenant_id=$1 and b.state='ACTIVE' and b.active_projection_generation>0
           and r.manifest->'frontendDelivery'->>'mode'='NATIVE_PAGE'
           and r.manifest->'frontendDelivery'->>'nativePageCategory' is not null
           and b.normalized_config ? 'nativePageUrl'",
    )
    .bind(ctx.tenant_id)
    .fetch_all(&state.pool)
    .await?;
    let empty = || json!({"results": [], "sources": []});
    if candidates.is_empty() {
        return Ok(empty());
    }

    // Scope: Workspace bindings and entries only for admitted Workspaces; the
    // Tenant itself must still be discoverable (also yields the ZedToken).
    let principal = ctx.tenant_principal_id.to_string();
    let tenant = state
        .governance
        .spicedb
        .check(
            "tenant",
            &ctx.tenant_id.to_string(),
            "discover",
            &principal,
            crate::spicedb::Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| Refusal::Unavailable("component search authorization".into()))?;
    if !tenant.allowed || tenant.zed_token.is_empty() {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let workspaces: Vec<Uuid> = candidates
        .iter()
        .filter_map(|c| c.workspace_id)
        .chain(entries.iter().filter_map(|e| e.workspace_id))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let admitted_workspaces = if workspaces.is_empty() {
        HashMap::new()
    } else {
        crate::web_transport::workspace_admissions(state, ctx, &workspaces)
            .await
            .map_err(|_| Refusal::Unavailable("component search scope".into()))?
    };
    let in_scope =
        |workspace: Option<Uuid>| workspace.is_none_or(|w| admitted_workspaces.contains_key(&w));
    let entries: Vec<Entry> = entries
        .into_iter()
        .filter(|entry| in_scope(entry.workspace_id))
        .collect();

    // Sources that can be opened somewhere; then their readable Resources.
    let sources: Vec<(Candidate, &'static str, Uuid)> = candidates
        .into_iter()
        .filter(|c| in_scope(c.workspace_id))
        .filter_map(|c| {
            let category = source_category(&c.manifest)?;
            let entry = entry_for(&entries, category, c.workspace_id)?;
            Some((c, category, entry))
        })
        .collect();
    if sources.is_empty() {
        return Ok(empty());
    }
    let ids: Vec<Uuid> = sources.iter().map(|(c, _, _)| c.id).collect();
    let resources: Vec<(Uuid, Uuid, String, String)> = sqlx::query_as(
        "select x.id,x.application_binding_id,x.native_type,x.native_id from (
           select r.id,r.application_binding_id,r.native_type,r.native_id,
             row_number() over (partition by r.application_binding_id order by r.id) as n
           from catalog.resource r
           where r.tenant_id=$1 and r.application_binding_id=any($2) and r.state='ACTIVE'
             and r.native_type is not null and r.native_id is not null) x
         where x.n<=$3 order by x.application_binding_id,x.id",
    )
    .bind(ctx.tenant_id)
    .bind(&ids)
    .bind(RESOURCE_SCAN_PER_BINDING)
    .fetch_all(&state.pool)
    .await?;
    let readable = if resources.is_empty() {
        HashSet::new()
    } else {
        let objects: Vec<String> = resources.iter().map(|r| r.0.to_string()).collect();
        state
            .governance
            .spicedb
            .check_bulk("resource", &objects, "read", &principal)
            .await
            .map_err(|_| Refusal::Unavailable("component search authorization".into()))?
    };
    let mut per_binding: BTreeMap<Uuid, Vec<Value>> = BTreeMap::new();
    for (id, binding, native_type, native_id) in resources {
        let list = per_binding.entry(binding).or_default();
        if readable.contains(&id.to_string()) && list.len() < RESOURCES_PER_BINDING {
            list.push(json!({"resourceId": id, "nativeType": native_type, "nativeId": native_id}));
        }
    }

    let service = &state.memory_service;
    let calls = sources.into_iter().filter_map(|(candidate, category, entry)| {
        let resources = per_binding.remove(&candidate.id).filter(|r| !r.is_empty())?;
        let zed = tenant.zed_token.clone();
        Some(async move {
            let answer = tokio::time::timeout(
                CALL_TIMEOUT,
                call(service, ctx, &candidate, resources, admitted, &zed),
            )
            .await;
            let accepted = match answer {
                Ok(Ok(raw)) => accept_response(&raw, admitted.limit),
                Ok(Err(error)) => {
                    tracing::info!(binding = %candidate.id, reason = ?error.reason(), "组件搜索来源不可用");
                    None
                }
                Err(_) => {
                    tracing::info!(binding = %candidate.id, "组件搜索来源超时");
                    None
                }
            };
            (category, entry, accepted)
        })
    });
    let answers = futures_util::future::join_all(calls).await;
    let mut states: BTreeMap<&'static str, bool> = BTreeMap::new();
    let mut results = Vec::new();
    for (category, entry, accepted) in answers {
        let answered = accepted.is_some();
        let ok = states.entry(category).or_insert(true);
        *ok &= answered;
        for mut item in accepted.into_iter().flatten() {
            item["bindingId"] = json!(entry);
            item["nativePageCategory"] = json!(category);
            results.push(item);
        }
    }
    let body = json!({
        "results": results,
        "sources": states.into_iter().map(|(category, answered)| json!({
            "nativePageCategory": category,
            "state": if answered { "ANSWERED" } else { "UNAVAILABLE" },
        })).collect::<Vec<_>>(),
    });
    let typed: contracts::ComponentSearchPage = serde_json::from_value(body.clone())
        .map_err(|_| Refusal::Unavailable("component search contract".into()))?;
    if serde_json::to_value(&typed)
        .map_err(|_| Refusal::Unavailable("component search contract".into()))?
        != body
    {
        return Err(Refusal::Unavailable("component search contract".into()));
    }
    Ok(body)
}

/// The Search Token claims for one call (07 §4.8.4): actor, Tenant, Workspace,
/// binding and the digest of the exact request body; nothing else.
pub(crate) fn token_claims(
    tenant: Uuid,
    workspace: Option<Uuid>,
    binding: Uuid,
    generation: i64,
    actor: Uuid,
    zed: &str,
    body: &Value,
) -> Value {
    let mut claims = json!({
        "token_use": TOKEN_USE,
        "tenant_id": tenant,
        "binding_id": binding,
        "projection_generation": generation,
        "actor_principal_id": actor,
        "authorization_min_zed_token": zed,
        "normalized_parameter_hash": collab_bridge::limits::canonical_digest(body),
    });
    if let Some(workspace) = workspace {
        claims["workspace_id"] = json!(workspace);
    }
    claims
}

async fn call(
    service: &crate::service_api::ServiceState,
    ctx: &ExecutionContext,
    candidate: &Candidate,
    resources: Vec<Value>,
    admitted: &Admitted,
    zed: &str,
) -> Result<Value, Refusal> {
    let reference = candidate
        .adapter_service_ref
        .as_deref()
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    let instance = candidate
        .native_instance_ref
        .as_deref()
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    let adapter = crate::application_binding::native::Adapter::resolve(
        reference,
        instance,
        &candidate.manifest,
    )?;
    let key = Uuid::new_v4();
    let body = json!({
        "idempotencyKey": key,
        "query": admitted.query,
        "limit": admitted.limit,
        "locale": admitted.locale,
        "resources": resources,
    });
    let typed: contracts::AdapterSearchRequest =
        serde_json::from_value(body.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(&typed).map_err(|_| invalid())? != body {
        return Err(invalid());
    }
    let claims = token_claims(
        ctx.tenant_id,
        candidate.workspace_id,
        candidate.id,
        candidate.generation,
        ctx.tenant_principal_id,
        zed,
        &body,
    );
    let audience = candidate.manifest["executionConnector"]["actionTokenAudience"]
        .as_str()
        .ok_or_else(invalid)?;
    let token = crate::action_token::issue_search(service, audience, claims).await?;
    adapter.search(key, &body, &token).await
}

#[cfg(test)]
mod tests {
    use super::*;

    type Edit = Box<dyn Fn(&mut Value)>;

    fn query(q: &str, limit: Option<i64>, locale: Option<&str>) -> contracts::ComponentSearchQuery {
        contracts::ComponentSearchQuery {
            q: q.into(),
            limit,
            locale: locale.map(str::to_owned),
        }
    }

    #[test]
    fn queries_are_trimmed_bounded_and_localized() {
        assert_eq!(
            admit_query(&query("  季度报告 ", None, None)).unwrap(),
            Admitted {
                query: "季度报告".into(),
                limit: LIMIT_DEFAULT,
                locale: "ZH_CN"
            }
        );
        assert_eq!(
            admit_query(&query("x", Some(20), Some("EN")))
                .unwrap()
                .locale,
            "EN"
        );
        for bad in [
            query("   ", None, None),
            query(&"字".repeat(201), None, None),
            query("a\u{0}b", None, None),
            query("x", Some(0), None),
            query("x", Some(21), None),
            query("x", None, Some("zh-CN")),
        ] {
            assert!(admit_query(&bad).is_err(), "accepted {:?}", bad.q);
        }
    }

    #[test]
    fn an_adapter_answer_is_accepted_whole_or_not_at_all() {
        let good = json!({"results": [
            {"kind": "FILE", "title": "报告.docx", "summary": "/项目", "path": "/ws-a/%E6%8A%A5%E5%91%8A.docx",
             "updatedAt": "2026-10-20T08:00:00Z"},
            {"kind": "QUESTION", "title": "Revenue by month", "path": "/home/42"},
        ]});
        assert_eq!(accept_response(&good, 8).map(|r| r.len()), Some(2));
        assert_eq!(
            accept_response(&good, 1),
            None,
            "more results than the limit"
        );
        let cases: Vec<Edit> = vec![
            Box::new(|v: &mut Value| v["results"][0]["path"] = json!("https://evil.test/")),
            Box::new(|v: &mut Value| v["results"][0]["path"] = json!("/x?token=1")),
            Box::new(|v: &mut Value| v["results"][0]["title"] = json!("")),
            Box::new(|v: &mut Value| v["results"][0]["title"] = json!("t".repeat(201))),
            Box::new(|v: &mut Value| v["results"][0]["summary"] = json!("s".repeat(401))),
            Box::new(|v: &mut Value| v["results"][0]["kind"] = json!("EMAIL")),
            Box::new(|v: &mut Value| v["results"][0]["updatedAt"] = json!("soon")),
            Box::new(|v: &mut Value| v["results"][0]["content"] = json!("full body")),
            Box::new(|v: &mut Value| v["extra"] = json!(true)),
        ];
        for (index, edit) in cases.iter().enumerate() {
            let mut value = good.clone();
            edit(&mut value);
            assert_eq!(accept_response(&value, 8), None, "case {index} accepted");
        }
    }

    #[test]
    fn the_token_names_only_the_actor_binding_and_body() {
        let (tenant, binding, actor) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let body = json!({"idempotencyKey": Uuid::nil(), "query": "q", "limit": 3, "locale": "EN",
            "resources": [{"resourceId": Uuid::nil(), "nativeType": "kb", "nativeId": "7"}]});
        let claims = token_claims(tenant, None, binding, 4, actor, "zed", &body);
        assert_eq!(claims["token_use"], TOKEN_USE);
        assert!(claims.get("workspace_id").is_none());
        assert_eq!(
            claims["normalized_parameter_hash"],
            collab_bridge::limits::canonical_digest(&body)
        );
        for forbidden in [
            "action_execution_id",
            "target_id",
            "delegation_id",
            "agent_principal_id",
            "result_exposure_policy_id",
        ] {
            assert!(claims.get(forbidden).is_none(), "{forbidden} present");
        }
        let workspace = Uuid::new_v4();
        let scoped = token_claims(tenant, Some(workspace), binding, 4, actor, "zed", &body);
        assert_eq!(scoped["workspace_id"], json!(workspace));
    }

    #[test]
    fn sources_open_in_the_workspace_entry_else_the_tenant_entry() {
        let (ws, other) = (Uuid::new_v4(), Uuid::new_v4());
        let (tenant_entry, ws_entry, kb_entry) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let entries = vec![
            Entry {
                id: tenant_entry,
                workspace_id: None,
                category: "file_storage".into(),
            },
            Entry {
                id: ws_entry,
                workspace_id: Some(ws),
                category: "file_storage".into(),
            },
            Entry {
                id: kb_entry,
                workspace_id: Some(other),
                category: "knowledge".into(),
            },
        ];
        assert_eq!(
            entry_for(&entries, "file_storage", Some(ws)),
            Some(ws_entry)
        );
        assert_eq!(
            entry_for(&entries, "file_storage", Some(other)),
            Some(tenant_entry)
        );
        assert_eq!(
            entry_for(&entries, "file_storage", None),
            Some(tenant_entry)
        );
        assert_eq!(entry_for(&entries, "knowledge", None), None);
        assert_eq!(entry_for(&entries, "data_query", Some(ws)), None);
        assert_eq!(
            source_category(
                &json!({"implements": [{"categoryKey": "knowledge", "contractVersion": 3}]})
            ),
            Some("knowledge")
        );
        assert_eq!(source_category(&json!({"implements": []})), None);
    }
}
