//! DD-125(2) 审核读取（`.design/05` §2.11 末段、`09` 原版审核协议边界）。
//!
//! 队列、审核日志与限制状态是 Tenant `manage` 的受审计敏感读取，不建立
//! ActionExecution：每次 fresh Check 通过后先写 ACCESS 审计，再由 Core 以 Tenant CONTROL
//! 经 NIP-98 读取 Relay `/moderation/*`，原样转述、不复制。成员与原版一样读不到自己的
//! 限制。`/api/v1/moderation/access` 只回答审核入口是否该出现，不读取任何审核事实。

use std::collections::{HashMap, HashSet};

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::Response,
};
use collab_bridge::bridge::IdentityClient;
use collab_bridge::moderation::{self as wire, ReportRow, RestrictionRow};
use contracts::{EvidenceKind, ReasonCode};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::audit::{AuditEntry, Evidence};
use crate::bff::{resolve_execution_context, BffState, ExecutionContext};
use crate::governance::Refusal;
use crate::spicedb::Consistency;
use crate::tenant_lifecycle::{control_client, ProjectionDirection};

/// 读取动作在审计中的名字；它们不是 ActionDefinition，不进入 Catalog。
const READ_REPORTS: &str = "moderation.reports.read";
const READ_AUDIT: &str = "moderation.audit.read";
const READ_RESTRICTED: &str = "moderation.restricted.read";

/// fresh `tenant manage` 的结论与其 checked revision。
async fn manage(state: &BffState, ctx: &ExecutionContext) -> Result<Option<String>, Refusal> {
    let full = ctx.access_mode == contracts::PlatformSessionAccessMode::Full;
    if !full {
        return Ok(None);
    }
    let mut conn = state.pool.acquire().await?;
    if crate::platform_bootstrap::is_catalog_tenant(&mut conn, ctx.tenant_id).await? {
        return Ok(None);
    }
    drop(conn);
    let checked = state
        .governance
        .spicedb
        .check(
            "tenant",
            &ctx.tenant_id.to_string(),
            "manage",
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()))?;
    Ok(checked.allowed.then_some(checked.zed_token))
}

/// `GET /api/v1/moderation/access`：原版只对 Community owner/admin 显示的审核入口，在
/// Kailo 对应 Tenant `manage`。只是提示，提交时仍完整重新准入。
pub(crate) async fn access(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let exposed = crate::capability_registry::action_exposed(crate::moderation::BAN);
    let allowed = match manage(&state, &ctx).await {
        Ok(token) => exposed && token.is_some(),
        Err(refusal) => return refusal.respond(None),
    };
    crate::presence::no_store(contracts::ModerationAccessView {
        can_moderate: allowed,
    })
}

/// 准入一次审核读取：fresh `tenant manage`，先写 ACCESS 审计，再取 CONTROL 客户端。
async fn admit(
    state: &BffState,
    headers: &HeaderMap,
    action: &str,
) -> Result<(ExecutionContext, IdentityClient), Response> {
    let ctx = resolve_execution_context(state, headers).await?;
    let token = match manage(state, &ctx).await {
        Ok(Some(token)) => token,
        Ok(None) => return Err(Refusal::Denied(ReasonCode::PermissionDenied).respond(None)),
        Err(refusal) => return Err(refusal.respond(None)),
    };
    record(state, &ctx, action, &token)
        .await
        .map_err(|refusal| refusal.respond(None))?;
    let direction = ProjectionDirection::Establish;
    let (control, _) = control_client(&state.memory_service, ctx.tenant_id, direction).await?;
    Ok((ctx, control.with_budget(state.relay_budget.clone())))
}

/// 受审计的敏感读取：每次读取一条 ACCESS 事实，写不进去就不读取。
async fn record(
    state: &BffState,
    ctx: &ExecutionContext,
    action: &str,
    token: &str,
) -> Result<(), Refusal> {
    let operation = Uuid::new_v4();
    let session = Evidence::new(EvidenceKind::PlatformSessionId, ctx.session_id);
    let mut evidence = vec![session];
    if !token.is_empty() {
        evidence.push(Evidence::new(EvidenceKind::SpicedbZedtoken, token));
    }
    let entry = AuditEntry {
        event_key: format!("moderation-read:{operation}"),
        tenant_id: Some(ctx.tenant_id),
        workspace_id: None,
        operation_id: operation,
        event_type: "ACCESS",
        human_identity_id: Some(ctx.human_identity_id),
        initiator_principal_id: Some(ctx.tenant_principal_id),
        actor_principal_id: Some(ctx.tenant_principal_id),
        action_key: action,
        action_version: 1,
        component_type_key: "core",
        target_type: Some("TENANT"),
        target_id: Some(ctx.tenant_id),
        parameter_hash: "NONE",
        decision: "ALLOW",
        result_code: "MODERATION_READ",
        result_exposure: "NONE",
        evidence_refs: evidence,
        correlation_id: operation,
    };
    let mut tx = state.pool.begin().await?;
    crate::audit::append(&mut tx, entry).await?;
    tx.commit().await?;
    Ok(())
}

fn relay_unavailable() -> Response {
    Refusal::Unavailable("Relay 审核读取不可用".into()).respond(None)
}

fn page<T: serde::de::DeserializeOwned + serde::Serialize>(value: Value) -> Response {
    match serde_json::from_value::<T>(value) {
        Ok(page) => crate::presence::no_store(page),
        Err(error) => {
            // Relay 回了契约之外的值（例如新的举报类型）：不转述无法解释的事实
            tracing::error!(error = %error, "Relay 审核行不合契约");
            relay_unavailable()
        }
    }
}

/// 本 Tenant HUMAN 公钥 → Principal。AGENT 与未知公钥不给出。
async fn principals(
    state: &BffState,
    tenant: Uuid,
    pubkeys: Vec<String>,
) -> Result<HashMap<String, Uuid>, Refusal> {
    let rows: Vec<(String, Uuid)> = sqlx::query_as(
        "select pubkey, principal_id from identity.buzz_identity_binding
         where tenant_id = $1 and kind = 'HUMAN' and pubkey = any($2)",
    )
    .bind(tenant)
    .bind(&pubkeys)
    .fetch_all(&state.pool)
    .await?;
    Ok(rows.into_iter().collect())
}

/// Relay Channel → 本 Tenant 的 Workspace（审核队列的删除与踢出以它定位）。
async fn workspaces(
    state: &BffState,
    tenant: Uuid,
    channels: Vec<Uuid>,
) -> Result<HashMap<String, Uuid>, Refusal> {
    let rows: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "select b.channel_id, b.workspace_id from projection.workspace_buzz_binding b
         join identity.workspace w on w.id = b.workspace_id
         where w.tenant_id = $1 and b.channel_id = any($2)",
    )
    .bind(tenant)
    .bind(&channels)
    .fetch_all(&state.pool)
    .await?;
    let pairs = rows
        .into_iter()
        .map(|(channel, ws)| (channel.to_string(), ws));
    Ok(pairs.collect())
}

/// 事件目标的签名者：CONTROL 按 ID 回读（被删除或不可读的缺省）。
async fn authors(
    state: &BffState,
    control: &IdentityClient,
    ids: Vec<String>,
) -> Result<HashMap<String, String>, Refusal> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let limit = ids.len();
    let filter = json!({"ids": ids, "limit": limit});
    let found = control
        .query(&state.relay_http, &[filter])
        .await
        .map_err(|_| Refusal::Unavailable("被举报消息不可回读".into()))?;
    let mut authors = HashMap::new();
    for event in found.as_array().into_iter().flatten() {
        let id = event.get("id").and_then(Value::as_str);
        let pubkey = event.get("pubkey").and_then(Value::as_str);
        if let (Some(id), Some(pubkey)) = (id, pubkey) {
            authors.insert(id.to_owned(), pubkey.to_owned());
        }
    }
    Ok(authors)
}

#[derive(serde::Deserialize)]
pub(crate) struct ReportQuery {
    status: Option<String>,
}

/// 一行举报的呈现。举报人只出现在这一审核面。
fn report_view(
    row: &ReportRow,
    workspace: Option<&Uuid>,
    author: Option<&String>,
    principal: Option<&Uuid>,
) -> Value {
    let mut view = json!({
        "id": row.id,
        "reportEventId": row.report_event_id,
        "reporterPubkey": row.reporter_pubkey,
        "targetKind": row.target_kind,
        "target": row.target,
        "reportType": row.report_type,
        "status": row.status,
        "createdAt": row.created_at,
    });
    let optional = [
        ("channelId", row.channel_id.clone()),
        ("workspaceId", workspace.map(Uuid::to_string)),
        ("targetAuthorPubkey", author.cloned()),
        ("targetPrincipalId", principal.map(Uuid::to_string)),
        ("note", row.note.clone().filter(|note| !note.is_empty())),
        ("resolvedByPubkey", row.resolved_by.clone()),
        ("resolvedAt", row.resolved_at.clone()),
    ];
    for (name, value) in optional {
        if let Some(value) = value {
            view[name] = json!(value);
        }
    }
    view
}

/// `GET /api/v1/moderation/reports[?status=open]`（V-SCN-130）。
pub(crate) async fn reports(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(query): Query<ReportQuery>,
) -> Response {
    let status = match query.status.as_deref() {
        None => None,
        Some("open") => Some("open"),
        Some(_) => return Refusal::Precondition(ReasonCode::InvalidParameters).respond(None),
    };
    let (ctx, control) = match admit(&state, &headers, READ_REPORTS).await {
        Ok(admitted) => admitted,
        Err(response) => return response,
    };
    let Ok(rows) = control.moderation_reports(&state.relay_http, status).await else {
        return relay_unavailable();
    };
    let truncated = rows.len() >= wire::READ_LIMIT;
    let channels: HashSet<Uuid> = rows
        .iter()
        .filter_map(|row| row.channel_id.as_deref())
        .filter_map(|channel| Uuid::parse_str(channel).ok())
        .collect();
    let events: HashSet<String> = rows
        .iter()
        .filter(|row| row.target_kind == "event")
        .map(|row| row.target.clone())
        .collect();
    let enriched = async {
        let workspaces = workspaces(&state, ctx.tenant_id, channels.into_iter().collect()).await?;
        let authors = authors(&state, &control, events.into_iter().collect()).await?;
        let mut keys: Vec<String> = authors.values().cloned().collect();
        let targets = rows.iter().filter(|row| row.target_kind == "pubkey");
        keys.extend(targets.map(|row| row.target.clone()));
        let principals = principals(&state, ctx.tenant_id, keys).await?;
        Ok::<_, Refusal>((workspaces, authors, principals))
    }
    .await;
    let (workspaces, authors, principals) = match enriched {
        Ok(maps) => maps,
        Err(refusal) => return refusal.respond(None),
    };
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            let channel = row.channel_id.as_ref();
            let workspace = channel.and_then(|channel| workspaces.get(channel));
            let author = match row.target_kind.as_str() {
                "event" => authors.get(&row.target),
                "pubkey" => Some(&row.target),
                _ => None,
            };
            let principal = author.and_then(|author| principals.get(author));
            report_view(row, workspace, author, principal)
        })
        .collect();
    page::<contracts::ModerationReportPage>(json!({"items": items, "truncated": truncated}))
}

/// `GET /api/v1/moderation/audit`：Relay 审核日志原样转述（私有理由不读取）。
pub(crate) async fn audit_log(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let (_, control) = match admit(&state, &headers, READ_AUDIT).await {
        Ok(admitted) => admitted,
        Err(response) => return response,
    };
    let Ok(rows) = control.moderation_audit(&state.relay_http).await else {
        return relay_unavailable();
    };
    let truncated = rows.len() >= wire::READ_LIMIT;
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            let mut view = json!({
                "id": row.id,
                "actorPubkey": row.actor_pubkey,
                "action": row.action,
                "createdAt": row.created_at,
            });
            let optional = [
                ("targetPubkey", &row.target_pubkey),
                ("targetEventId", &row.target_event_id),
                ("channelId", &row.channel_id),
                ("publicReason", &row.public_reason),
            ];
            for (name, value) in optional {
                if let Some(value) = value.as_ref().filter(|value| !value.is_empty()) {
                    view[name] = json!(value);
                }
            }
            view
        })
        .collect();
    page::<contracts::ModerationAuditPage>(json!({"items": items, "truncated": truncated}))
}

fn restriction_view(row: &RestrictionRow, principal: Option<&Uuid>) -> Value {
    let mut view = json!({
        "pubkey": row.pubkey,
        "banned": row.banned,
        "updatedAt": row.updated_at,
    });
    let optional = [
        ("principalId", principal.map(Uuid::to_string)),
        (
            "banExpiresAt",
            row.ban_expires_at.clone().filter(|_| row.banned),
        ),
        ("mutedUntil", row.muted_until.clone()),
    ];
    for (name, value) in optional {
        if let Some(value) = value {
            view[name] = json!(value);
        }
    }
    view
}

/// `GET /api/v1/moderation/restricted`：当前有效的封禁与禁言（V-SCN-127）。
pub(crate) async fn restricted(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let (ctx, control) = match admit(&state, &headers, READ_RESTRICTED).await {
        Ok(admitted) => admitted,
        Err(response) => return response,
    };
    let Ok(rows) = control.moderation_restricted(&state.relay_http).await else {
        return relay_unavailable();
    };
    let keys = rows.iter().map(|row| row.pubkey.clone()).collect();
    let principals = match principals(&state, ctx.tenant_id, keys).await {
        Ok(principals) => principals,
        Err(refusal) => return refusal.respond(None),
    };
    let items: Vec<Value> = rows
        .iter()
        .map(|row| restriction_view(row, principals.get(&row.pubkey)))
        .collect();
    page::<contracts::ModerationRestrictionPage>(json!({"items": items}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_rows_project_only_contract_fields() {
        let row = ReportRow {
            id: "00000000-0000-4000-8000-000000000001".to_owned(),
            report_event_id: "c".repeat(64),
            reporter_pubkey: "e".repeat(64),
            target_kind: "event".to_owned(),
            target: "a".repeat(64),
            channel_id: Some("00000000-0000-4000-8000-000000000002".to_owned()),
            report_type: "spam".to_owned(),
            note: Some(String::new()),
            status: "open".to_owned(),
            resolved_by: None,
            resolved_at: None,
            created_at: "2026-10-19T08:00:00Z".to_owned(),
        };
        let workspace = Uuid::new_v4();
        let author = "b".repeat(64);
        let view = report_view(&row, Some(&workspace), Some(&author), None);
        assert_eq!(view["workspaceId"], json!(workspace.to_string()));
        assert_eq!(view["targetAuthorPubkey"], json!(author));
        // 空说明与缺省的 Principal 都不出现
        assert!(view.get("note").is_none());
        assert!(view.get("targetPrincipalId").is_none());
    }

    #[test]
    fn restriction_rows_drop_a_stale_ban_expiry() {
        let row = RestrictionRow {
            pubkey: "b".repeat(64),
            banned: false,
            ban_expires_at: Some("2026-10-18T08:00:00Z".to_owned()),
            muted_until: Some("2026-10-20T08:00:00Z".to_owned()),
            updated_at: "2026-10-19T08:00:00Z".to_owned(),
        };
        let view = restriction_view(&row, None);
        assert!(view.get("banExpiresAt").is_none());
        assert_eq!(view["mutedUntil"], json!("2026-10-20T08:00:00Z"));
    }
}
