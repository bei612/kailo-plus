//! DD-47/65、17 §7–8、19 §4：原 Session/Invocation 的 HUMAN 只读消费者。
//! 不启动 runtime、不读或复制 rollout 正文，不把 Installation read 扩大成结果读取。

use axum::{
    extract::{Path, Query, State},
    http::{header::CACHE_CONTROL, HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    bff::{resolve_execution_context, BffState, ExecutionContext},
    governance::Refusal,
    spicedb::Consistency,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionQuery {
    root_event_id: Option<String>,
    cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InvocationQuery {
    root_event_id: String,
    projection_generation: i64,
    cursor: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Scope {
    tenant: Uuid,
    principal: Uuid,
    installation: Uuid,
    workspace: Uuid,
    root: Option<String>,
    generation: Option<i64>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    scope: Scope,
    created_at: DateTime<Utc>,
    root: String,
    generation: i64,
    invocation: Option<Uuid>,
}

fn invalid() -> Response {
    Refusal::Precondition(contracts::ReasonCode::InvalidParameters).respond(None)
}

fn unavailable() -> Response {
    Refusal::Unavailable("Agent Session 查询事实不可核验".into()).respond(None)
}

impl Cursor {
    #[allow(clippy::result_large_err)]
    fn decode(raw: &str, scope: &Scope) -> Result<Self, Response> {
        let cursor: Self =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(raw).map_err(|_| invalid())?)
                .map_err(|_| invalid())?;
        if cursor.scope != *scope
            || cursor.generation <= 0
            || cursor.root.is_empty()
            || cursor.invocation.is_some() != scope.generation.is_some()
            || scope.root.as_ref().is_some_and(|root| *root != cursor.root)
            || scope
                .generation
                .is_some_and(|generation| generation != cursor.generation)
        {
            return Err(invalid());
        }
        Ok(cursor)
    }

    #[allow(clippy::result_large_err)]
    fn encode(&self) -> Result<String, Response> {
        serde_json::to_vec(self)
            .map(|value| URL_SAFE_NO_PAD.encode(value))
            .map_err(|_| unavailable())
    }
}

async fn scope(
    state: &BffState,
    ctx: &ExecutionContext,
    installation: Uuid,
    root: Option<String>,
    generation: Option<i64>,
) -> Result<Scope, Response> {
    if root.as_ref().is_some_and(|root| root.is_empty())
        || generation.is_some_and(|generation| generation <= 0)
    {
        return Err(invalid());
    }
    // Existing admission includes current HUMAN/Tenant/Workspace membership,
    // fully consistent Resource read and exact owner/workspace projection.
    let installation_view =
        crate::agent_installation_query::read_view(state, ctx, installation).await?;
    Ok(Scope {
        tenant: ctx.tenant_id,
        principal: ctx.tenant_principal_id,
        installation,
        workspace: Uuid::parse_str(&installation_view.workspace_id).map_err(|_| unavailable())?,
        root,
        generation,
    })
}

#[allow(clippy::result_large_err)]
fn limit(state: &BffState) -> Result<i64, Response> {
    state
        .governance
        .cfg
        .page_limit
        .checked_add(1)
        .filter(|value| *value > 1)
        .ok_or_else(unavailable)
}

fn response<T: Serialize>(value: T) -> Response {
    let mut response = Json(value).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[derive(FromRow)]
struct SessionRow {
    root_event_id: String,
    projection_generation: i64,
    agent_version_asset_id: Uuid,
    runtime_thread_id: Option<String>,
    status: String,
    created_at: DateTime<Utc>,
}

pub async fn sessions(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Query(q): Query<SessionQuery>,
) -> Response {
    match session_page(&state, &headers, id, q).await {
        Ok(page) => response(page),
        Err(error) => error,
    }
}

async fn session_page(
    state: &BffState,
    headers: &HeaderMap,
    id: Uuid,
    q: SessionQuery,
) -> Result<contracts::AgentSessionPage, Response> {
    let ctx = resolve_execution_context(state, headers).await?;
    let scope = scope(state, &ctx, id, q.root_event_id, None).await?;
    let cursor = q
        .cursor
        .as_deref()
        .map(|raw| Cursor::decode(raw, &scope))
        .transpose()?;
    let fetch_limit = limit(state)?;
    let mut rows: Vec<SessionRow> = sqlx::query_as("select root_event_id,projection_generation,
        agent_version_asset_id,runtime_thread_id,status,created_at from catalog.agent_session
        where tenant_id=$1 and workspace_id=$2 and installation_resource_id=$3
          and ($4::text is null or root_event_id=$4)
          and ($5::timestamptz is null or (created_at,root_event_id,projection_generation)<($5,$6,$7))
        order by created_at desc,root_event_id desc,projection_generation desc limit $8")
        .bind(scope.tenant).bind(scope.workspace).bind(id).bind(&scope.root)
        .bind(cursor.as_ref().map(|c| c.created_at)).bind(cursor.as_ref().map(|c| &c.root))
        .bind(cursor.as_ref().map(|c| c.generation)).bind(fetch_limit)
        .fetch_all(&state.pool).await.map_err(crate::service_api::unavailable)?;
    let more = rows.len() as i64 == fetch_limit;
    if more {
        rows.pop();
    }
    let next = if more {
        let last = rows.last().ok_or_else(unavailable)?;
        Some(
            Cursor {
                scope: scope.clone(),
                created_at: last.created_at,
                root: last.root_event_id.clone(),
                generation: last.projection_generation,
                invocation: None,
            }
            .encode()?,
        )
    } else {
        None
    };
    let views: Vec<_> = rows.into_iter().map(|row| json!({
        "installationResourceId": id, "workspaceId": scope.workspace,
        "rootEventId": row.root_event_id, "projectionGeneration": row.projection_generation,
        "agentVersionAssetId": row.agent_version_asset_id, "runtimeThreadId": row.runtime_thread_id,
        "status": row.status, "createdAt": row.created_at,
    })).collect();
    recheck(state, headers, &ctx, id).await?;
    serde_json::from_value(json!({"sessions":views,"nextCursor":next})).map_err(|_| unavailable())
}

async fn recheck(
    state: &BffState,
    headers: &HeaderMap,
    ctx: &ExecutionContext,
    installation: Uuid,
) -> Result<(), Response> {
    let current = resolve_execution_context(state, headers).await?;
    if current.tenant_id != ctx.tenant_id
        || current.tenant_principal_id != ctx.tenant_principal_id
        || current.session_id != ctx.session_id
    {
        return Err(Refusal::Denied(contracts::ReasonCode::ScopeGuardFailed).respond(None));
    }
    crate::agent_installation_query::read_view(state, &current, installation).await?;
    Ok(())
}

async fn audit_target(state: &BffState, scope: &Scope, target: Uuid) -> Result<bool, Response> {
    let resource: Option<(Uuid, Option<Uuid>)> = sqlx::query_as(
        "select owner_principal_id,home_workspace_id from catalog.resource
         where id=$1 and tenant_id=$2 and state<>'DELETED'",
    )
    .bind(target)
    .bind(scope.tenant)
    .fetch_optional(&state.pool)
    .await
    .map_err(crate::service_api::unavailable)?;
    let Some((owner, workspace)) = resource else {
        return Ok(false);
    };
    if workspace != Some(scope.workspace) {
        return Ok(false);
    }
    let workspace = scope.workspace.to_string();
    let projection = state
        .governance
        .spicedb
        .resource_projection_matches_in_workspace(
            &target.to_string(),
            &scope.tenant.to_string(),
            &owner.to_string(),
            Some(&workspace),
            state.governance.cfg.relationship_page,
        )
        .await
        .map_err(|_| unavailable())?;
    if !projection {
        return Err(unavailable());
    }
    let proof = state
        .governance
        .spicedb
        .check(
            "resource",
            &target.to_string(),
            "audit",
            &scope.principal.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| unavailable())?;
    if proof.zed_token.is_empty() {
        return Err(unavailable());
    }
    Ok(proof.allowed)
}

#[derive(FromRow)]
struct InvocationRow {
    id: Uuid,
    action_execution_id: Uuid,
    initiator_principal_id: Uuid,
    target_id: Uuid,
    runtime_turn_id: Option<String>,
    status: String,
    cancel_pending: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

pub async fn invocations(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Query(q): Query<InvocationQuery>,
) -> Response {
    match invocation_page(&state, &headers, id, q).await {
        Ok(page) => response(page),
        Err(error) => error,
    }
}

async fn invocation_page(
    state: &BffState,
    headers: &HeaderMap,
    id: Uuid,
    q: InvocationQuery,
) -> Result<contracts::AgentInvocationPage, Response> {
    let ctx = resolve_execution_context(state, headers).await?;
    let scope = scope(
        state,
        &ctx,
        id,
        Some(q.root_event_id),
        Some(q.projection_generation),
    )
    .await?;
    let cursor = q
        .cursor
        .as_deref()
        .map(|raw| Cursor::decode(raw, &scope))
        .transpose()?;
    let fetch_limit = limit(state)?;
    let mut rows: Vec<InvocationRow> = sqlx::query_as("select i.id,i.action_execution_id,
        ae.initiator_principal_id,ae.target_id,i.runtime_turn_id,i.status,i.cancel_pending,i.created_at,i.updated_at
        from catalog.agent_invocation i join admission.action_execution ae on ae.id=i.action_execution_id
          and ae.tenant_id=i.tenant_id and ae.workspace_id=i.workspace_id
        where i.tenant_id=$1 and i.workspace_id=$2 and i.installation_resource_id=$3
          and i.root_event_id=$4 and i.projection_generation=$5
          and ($6::timestamptz is null or (i.created_at,i.id)<($6,$7::uuid))
        order by i.created_at desc,i.id desc limit $8")
        .bind(scope.tenant).bind(scope.workspace).bind(id).bind(&scope.root).bind(scope.generation)
        .bind(cursor.as_ref().map(|c| c.created_at)).bind(cursor.as_ref().and_then(|c| c.invocation))
        .bind(fetch_limit).fetch_all(&state.pool).await.map_err(crate::service_api::unavailable)?;
    let more = rows.len() as i64 == fetch_limit;
    if more {
        rows.pop();
    }
    let next = if more {
        let last = rows.last().ok_or_else(unavailable)?;
        Some(
            Cursor {
                scope: scope.clone(),
                created_at: last.created_at,
                root: scope.root.clone().ok_or_else(invalid)?,
                generation: q.projection_generation,
                invocation: Some(last.id),
            }
            .encode()?,
        )
    } else {
        None
    };
    let mut views = Vec::new();
    for row in rows {
        // Resource read does not expose another HUMAN's execution. Audit is
        // checked on the actual AE target (Automation may differ from Installation).
        if row.initiator_principal_id != ctx.tenant_principal_id
            && !audit_target(state, &scope, row.target_id).await?
        {
            continue;
        }
        // Reuse the original Workflow projection freshness/UNKNOWN predicate;
        // the trusted persisted initiator here is not a caller-selected identity.
        let task: crate::governance_api::TaskRow = sqlx::query_as(&format!(
            "{} and ae.id=$4 and ae.workspace_id=$5",
            crate::governance_api::TASK_QUERY
        ))
        .bind(ctx.tenant_id)
        .bind(row.initiator_principal_id)
        .bind(state.governance.cfg.projection_freshness_seconds)
        .bind(row.action_execution_id)
        .bind(scope.workspace)
        .fetch_one(&state.pool)
        .await
        .map_err(crate::service_api::unavailable)?;
        views.push(json!({"invocationId":row.id,"actionExecutionId":row.action_execution_id,
            "canReadTask":row.initiator_principal_id == ctx.tenant_principal_id,
            "runtimeTurnId":row.runtime_turn_id,"status":row.status,"cancelPending":row.cancel_pending,
            "observation":crate::governance_api::observation(&task),
            "createdAt":row.created_at,"updatedAt":row.updated_at}));
    }
    recheck(state, headers, &ctx, id).await?;
    serde_json::from_value(json!({"invocations":views,"nextCursor":next}))
        .map_err(|_| unavailable())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cursor() -> Cursor {
        Cursor {
            scope: Scope {
                tenant: Uuid::new_v4(),
                principal: Uuid::new_v4(),
                installation: Uuid::new_v4(),
                workspace: Uuid::new_v4(),
                root: Some("a".repeat(64)),
                generation: Some(2),
            },
            created_at: "2026-10-10T18:00:00Z".parse().unwrap(),
            root: "a".repeat(64),
            generation: 2,
            invocation: Some(Uuid::new_v4()),
        }
    }

    #[test]
    fn cursor_is_bound_to_reader_scope_filter_and_generation() {
        let original = cursor();
        let encoded = original.encode().unwrap();
        let decoded = Cursor::decode(&encoded, &original.scope).unwrap();
        assert_eq!(decoded.created_at, original.created_at);
        assert_eq!(decoded.invocation, original.invocation);
        let mut wrong = original.scope.clone();
        wrong.principal = Uuid::new_v4();
        assert!(Cursor::decode(&encoded, &wrong).is_err());
        wrong = original.scope.clone();
        wrong.tenant = Uuid::new_v4();
        assert!(Cursor::decode(&encoded, &wrong).is_err());
        wrong = original.scope.clone();
        wrong.installation = Uuid::new_v4();
        assert!(Cursor::decode(&encoded, &wrong).is_err());
        wrong = original.scope.clone();
        wrong.workspace = Uuid::new_v4();
        assert!(Cursor::decode(&encoded, &wrong).is_err());
        wrong = original.scope.clone();
        wrong.root = Some("b".repeat(64));
        assert!(Cursor::decode(&encoded, &wrong).is_err());
        wrong = original.scope.clone();
        wrong.generation = Some(3);
        assert!(Cursor::decode(&encoded, &wrong).is_err());
        wrong = original.scope.clone();
        wrong.generation = None;
        assert!(Cursor::decode(&encoded, &wrong).is_err());
    }

    #[test]
    fn malformed_cursor_is_not_reinterpreted_as_first_page() {
        let original = cursor();
        for raw in ["", "not!base64", "e30"] {
            assert!(Cursor::decode(raw, &original.scope).is_err());
        }
        for (field, value) in [
            ("generation", json!(0)),
            ("root", json!("")),
            ("invocation", json!(null)),
            ("unknown", json!(true)),
        ] {
            let mut raw = serde_json::to_value(&original).unwrap();
            raw[field] = value;
            let raw = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&raw).unwrap());
            assert!(Cursor::decode(&raw, &original.scope).is_err());
        }
    }

    #[test]
    fn session_paging_keeps_historical_generations_without_a_new_invocation() {
        let mut original = cursor();
        original.scope.root = None;
        original.scope.generation = None;
        original.invocation = None;
        assert!(Cursor::decode(&original.encode().unwrap(), &original.scope).is_ok());
        original.invocation = Some(Uuid::new_v4());
        assert!(Cursor::decode(&original.encode().unwrap(), &original.scope).is_err());
    }

    #[test]
    fn generated_view_preserves_unknown_and_rejects_unknown_status() {
        let raw = json!({"invocationId":Uuid::new_v4(),"actionExecutionId":Uuid::new_v4(),
            "status":"UNKNOWN","cancelPending":true,"canReadTask":false,"observation":"EXTERNAL_RESULT_UNKNOWN",
            "runtimeTurnId":null,"createdAt":"2026-10-10T18:00:00Z","updatedAt":"2026-10-10T18:01:00Z"});
        let view: contracts::AgentInvocationView = serde_json::from_value(raw.clone()).unwrap();
        let wire = serde_json::to_value(view).unwrap();
        assert_eq!(wire["status"], "UNKNOWN");
        assert_eq!(wire["observation"], "EXTERNAL_RESULT_UNKNOWN");
        assert_eq!(wire["cancelPending"], true);
        assert_eq!(wire["canReadTask"], false);
        assert!(wire.get("runtimeTurnId").is_none());
        let mut unknown = raw;
        unknown["status"] = json!("invented-success");
        assert!(serde_json::from_value::<contracts::AgentInvocationView>(unknown).is_err());
    }
}
