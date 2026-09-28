//! 范围审计与 EvidenceRef 解引用（`.design/03` §14、DD-52、V-SCN-43）。
//!
//! 本人审计页只看自己的动作，无需额外判定。这里是另一类读取：Tenant 或其中一个
//! Workspace 范围内的全部审计事件，调用方必须对该范围持有 `audit` permission，
//! 每次请求都以 FullyConsistent 重新判定——刚被撤掉 auditor 的人不能再读到。
//!
//! 列表只给证据种类，不给稳定 ID。稳定 ID 经单条解引用取得，每次解引用都按该
//! 事件自己的 scope 重新授权；原证据已不存在、敏感级别未获授权或存量种类不可识别时
//! 只回不可用，不回退展示 ref 内容。

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::{
    AuditEventPage, AuditEventView, AuditEvidenceSlot, EvidenceKind, EvidenceSensitivity,
    EvidenceUnavailableReason, EvidenceView,
};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::audit::{describe, Evidence};
use crate::bff::{db_enum, resolve_execution_context, BffState, ExecutionContext};
use crate::spicedb::Consistency;

#[derive(Deserialize)]
pub struct AuditScopeQuery {
    /// 缺省读整个 Tenant；给出时只读该 Workspace，且该 Workspace 必须属于当前 Tenant
    #[serde(rename = "workspaceId")]
    workspace_id: Option<Uuid>,
    cursor: Option<Uuid>,
}

/// 对 `tenant` 或其中一个 Workspace 的 `audit` 做 fresh Check。
///
/// 判定失败是结果不明，回 503；不把它当成「无权」或「有权」。
async fn audit_allowed(
    state: &BffState,
    ctx: &ExecutionContext,
    workspace_id: Option<Uuid>,
) -> Result<bool, Response> {
    let (object_type, object_id) = match workspace_id {
        Some(w) => ("workspace", w.to_string()),
        None => ("tenant", ctx.tenant_id.to_string()),
    };
    match state
        .governance
        .spicedb
        .check(
            object_type,
            &object_id,
            "audit",
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
    {
        Ok(result) => Ok(result.allowed),
        Err(e) => {
            tracing::warn!(error = %e, object_type, "审计范围的 audit 判定失败");
            Err(StatusCode::SERVICE_UNAVAILABLE.into_response())
        }
    }
}

/// 列表中的证据槽位：可识别的给出种类、权威与敏感级别，不可识别的只给位置。
fn slots(refs: &Value) -> Vec<AuditEvidenceSlot> {
    refs.as_array()
        .map(|items| {
            items
                .iter()
                .enumerate()
                .map(|(i, item)| {
                    let index = i64::try_from(i).unwrap_or(i64::MAX);
                    match Evidence::parse(item) {
                        Some(e) => {
                            let (authority, sensitivity) = describe(&e.kind);
                            AuditEvidenceSlot {
                                index,
                                kind: Some(e.kind),
                                authority: Some(authority),
                                sensitivity: Some(sensitivity),
                            }
                        }
                        None => AuditEvidenceSlot {
                            index,
                            kind: None,
                            authority: None,
                            sensitivity: None,
                        },
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

type EventRow = (
    Uuid,
    chrono::DateTime<chrono::Utc>,
    String,
    String,
    String,
    String,
    Option<Uuid>,
    Option<Uuid>,
    Option<Uuid>,
    Value,
);

/// `GET /api/v1/audit/events`：当前 Tenant（或其中一个 Workspace）范围内的审计事件。
pub async fn list_scope_audit(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(query): Query<AuditScopeQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    if let Some(workspace_id) = query.workspace_id {
        // 先确认 Workspace 属于调用方的 Tenant，再问 SpiceDB：跨 Tenant 的 ID
        // 不该走到授权判定那一步
        let belongs: Result<Option<i32>, _> =
            sqlx::query_scalar("select 1 from identity.workspace where id = $1 and tenant_id = $2")
                .bind(workspace_id)
                .bind(ctx.tenant_id)
                .fetch_optional(&state.pool)
                .await;
        match belongs {
            Ok(Some(_)) => {}
            Ok(None) => return StatusCode::FORBIDDEN.into_response(),
            Err(e) => {
                tracing::warn!(error = %e, "审计范围的 Workspace 归属判定失败");
                return StatusCode::SERVICE_UNAVAILABLE.into_response();
            }
        }
    }
    match audit_allowed(&state, &ctx, query.workspace_id).await {
        Ok(true) => {}
        Ok(false) => return StatusCode::FORBIDDEN.into_response(),
        Err(r) => return r,
    }

    let page = state.message_page_limit;
    let rows: Result<Vec<EventRow>, _> = sqlx::query_as(
        "select id, occurred_at, event_type, action_key, decision, result_code,
                workspace_id, initiator_principal_id, actor_principal_id, evidence_refs
         from audit.audit_event
         where tenant_id = $1
           and ($2::uuid is null or workspace_id = $2)
           and ($3::uuid is null or (occurred_at, id) < (
                select occurred_at, id from audit.audit_event where id = $3 and tenant_id = $1))
         order by occurred_at desc, id desc
         limit $4",
    )
    .bind(ctx.tenant_id)
    .bind(query.workspace_id)
    .bind(query.cursor)
    .bind(page + 1)
    .fetch_all(&state.pool)
    .await;
    let mut rows = match rows {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "读取范围审计失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let limit = usize::try_from(page).unwrap_or(usize::MAX);
    let more = rows.len() > limit;
    rows.truncate(limit);
    let next_cursor = if more {
        rows.last().map(|r| r.0.to_string())
    } else {
        None
    };
    let mut events = Vec::with_capacity(rows.len());
    for (
        id,
        occurred_at,
        event_type,
        action_key,
        decision,
        result_code,
        workspace,
        initiator,
        actor,
        refs,
    ) in rows
    {
        let event_type = match db_enum("audit_event.event_type", &event_type) {
            Ok(t) => t,
            Err(r) => return r,
        };
        events.push(AuditEventView {
            id: id.to_string(),
            occurred_at: occurred_at.to_rfc3339(),
            event_type,
            action_key,
            decision,
            result_code,
            workspace_id: workspace.map(|w| w.to_string()),
            initiator_principal_id: initiator.map(|p| p.to_string()),
            actor_principal_id: actor.map(|p| p.to_string()),
            evidence: slots(&refs),
        });
    }
    (
        StatusCode::OK,
        Json(AuditEventPage {
            events,
            next_cursor,
        }),
    )
        .into_response()
}

fn unavailable(reason: EvidenceUnavailableReason, e: Option<&Evidence>) -> EvidenceView {
    let described = e.map(|e| (e.kind.clone(), describe(&e.kind)));
    EvidenceView {
        available: false,
        unavailable_reason: Some(reason),
        kind: described.as_ref().map(|(k, _)| k.clone()),
        authority: described.as_ref().map(|(_, (a, _))| a.clone()),
        sensitivity: described.map(|(_, (_, s))| s),
        stable_id: None,
        version: None,
    }
}

/// Core 自有证据的原对象是否仍在当前 Tenant 中。外部权威（Temporal、SpiceDB、Buzz、
/// OIDC）的证据只是其权威源中的稳定 ID，这里不代它们判定存在性。
async fn core_evidence_exists(
    state: &BffState,
    tenant_id: Uuid,
    e: &Evidence,
) -> Result<bool, sqlx::Error> {
    // 审批策略属平台 Catalog，按 (id, version) 核对；存量把版本写在值里（`<id>@<version>`），
    // 新写入用 version 字段，两种形状指向同一条策略
    if e.kind == EvidenceKind::ApprovalPolicy {
        let (id, version) = match (e.value.split_once('@'), e.version) {
            (Some((id, v)), None) => (id, v.parse::<i32>().ok()),
            (None, Some(v)) => (e.value.as_str(), i32::try_from(v).ok()),
            _ => return Ok(false),
        };
        let (Ok(id), Some(version)) = (Uuid::parse_str(id), version) else {
            return Ok(false);
        };
        return sqlx::query_scalar::<_, i32>(
            "select 1 from catalog.approval_policy where id = $1 and version = $2",
        )
        .bind(id)
        .bind(version)
        .fetch_optional(&state.pool)
        .await
        .map(|row| row.is_some());
    }
    let sql = match e.kind {
        EvidenceKind::ActionExecutionId
        | EvidenceKind::AdmitActionExecutionId
        | EvidenceKind::OriginalActionExecutionId => {
            "select 1 from admission.action_execution where id = $1 and tenant_id = $2"
        }
        EvidenceKind::TenantInvitationId => {
            "select 1 from identity.tenant_invitation where id = $1 and tenant_id = $2"
        }
        EvidenceKind::TenantMembershipId => {
            "select 1 from identity.tenant_membership where id = $1 and tenant_id = $2"
        }
        EvidenceKind::SecretRefRehomeId => {
            "select 1 from admission.secret_ref_rehome where id = $1 and tenant_id = $2"
        }
        _ => return Ok(true),
    };
    let Ok(id) = Uuid::parse_str(&e.value) else {
        return Ok(false);
    };
    sqlx::query_scalar::<_, i32>(sql)
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(&state.pool)
        .await
        .map(|row| row.is_some())
}

/// `GET /api/v1/audit/events/{id}/evidence/{index}`：单条证据的解引用。
pub async fn dereference_evidence(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path((event_id, index)): Path<(Uuid, usize)>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let row: Result<Option<(Option<Uuid>, Value)>, _> = sqlx::query_as(
        "select workspace_id, evidence_refs from audit.audit_event where id = $1 and tenant_id = $2",
    )
    .bind(event_id)
    .bind(ctx.tenant_id)
    .fetch_optional(&state.pool)
    .await;
    let (workspace_id, refs) = match row {
        Ok(Some(r)) => r,
        // 别的 Tenant 的事件与不存在的事件同样回 404：不透露它在哪里
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "读取审计事件失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    // 授权按事件自己的 scope：Workspace 事件查该 Workspace 的 audit（其中包含
    // Tenant 的 audit），Tenant 级事件查 Tenant 的 audit
    match audit_allowed(&state, &ctx, workspace_id).await {
        Ok(true) => {}
        Ok(false) => return StatusCode::FORBIDDEN.into_response(),
        Err(r) => return r,
    }
    let Some(item) = refs.as_array().and_then(|items| items.get(index)) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Some(evidence) = Evidence::parse(item) else {
        return Json(unavailable(EvidenceUnavailableReason::Unrecognized, None)).into_response();
    };
    let (authority, sensitivity) = describe(&evidence.kind);
    // RESTRICTED 还需要 ResultExposure 授权；它交付之前一律不可用
    if sensitivity == EvidenceSensitivity::Restricted {
        return Json(unavailable(
            EvidenceUnavailableReason::Restricted,
            Some(&evidence),
        ))
        .into_response();
    }
    match core_evidence_exists(&state, ctx.tenant_id, &evidence).await {
        Ok(true) => {}
        Ok(false) => {
            return Json(unavailable(
                EvidenceUnavailableReason::NotFound,
                Some(&evidence),
            ))
            .into_response()
        }
        Err(e) => {
            tracing::warn!(error = %e, "核对证据原对象失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    }
    Json(EvidenceView {
        available: true,
        unavailable_reason: None,
        kind: Some(evidence.kind),
        authority: Some(authority),
        sensitivity: Some(sensitivity),
        stable_id: Some(evidence.value),
        version: evidence.version,
    })
    .into_response()
}
