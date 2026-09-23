//! Tenant 与 Workspace 的状态跃迁（`.design/03` §2）。
//!
//! 与 `membership_state` 分开不是重复：那里是成员关系的状态机
//! （`INVITED/PROVISIONING/ACTIVE/REVOKING/REVOKED/ERROR`），这里是 scope 自身的
//! 状态机（含 `SUSPENDING/SUSPENDED/RESTORING`）。取值集合、合法跃迁与触发动作
//! 都不同，合并成一个端点只会让两张表挤在同一组分支里互相干扰。
//!
//! 两者共享的规则在这里同样成立，并且是同样的理由：跃迁必须指向已登记的
//! `WorkflowRef`、带乐观并发版本、状态机判定与更新在同一条 UPDATE 里完成。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::audit::{append, AuditEntry};
use crate::service_api::{authorize, unavailable, ServiceState};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ScopeKind {
    Tenant,
    Workspace,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeTransitionRequest {
    pub kind: ScopeKind,
    pub id: Uuid,
    pub from_version: i32,
    pub to_state: String,
    pub workflow_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeTransitionResponse {
    pub state: String,
    pub version: i32,
}

/// Tenant 状态机（`.design/03` §2）。`DELETING`/`DELETED` 不在此列：
/// Stage 1 不注册 Tenant delete（`apps/02` 明确限制），没有能到达它们的跃迁。
const TENANT_TRANSITIONS: &[(&str, &str)] = &[
    ("PROVISIONING", "ACTIVE"),
    ("PROVISIONING", "ERROR"),
    ("ACTIVE", "SUSPENDING"),
    ("SUSPENDING", "SUSPENDED"),
    ("SUSPENDING", "ERROR"),
    ("SUSPENDED", "RESTORING"),
    ("RESTORING", "ACTIVE"),
    ("RESTORING", "ERROR"),
    ("ERROR", "SUSPENDING"),
];

/// Workspace 状态机。同样不含 delete——Stage 1 不注册 Workspace delete，
/// 暂停/恢复固定映射 Channel archive/unarchive（`.design/06` §1）。
const WORKSPACE_TRANSITIONS: &[(&str, &str)] = &[
    ("PROVISIONING", "ACTIVE"),
    ("PROVISIONING", "ERROR"),
    ("ACTIVE", "SUSPENDING"),
    ("SUSPENDING", "SUSPENDED"),
    ("SUSPENDING", "ERROR"),
    ("SUSPENDED", "RESTORING"),
    ("RESTORING", "ACTIVE"),
    ("RESTORING", "ERROR"),
    ("ERROR", "SUSPENDING"),
];

pub async fn transition_scope(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<ScopeTransitionRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    // 可归属：跃迁必须指向已登记的 scope 生命周期 Workflow。
    let (wf_tenant, wf_operation) = match sqlx::query!(
        "select kind, tenant_id, operation_id from projection.workflow_ref where workflow_id = $1",
        req.workflow_id
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(row))
            if matches!(
                row.kind.as_deref(),
                Some("TENANT_LIFECYCLE") | Some("WORKSPACE_LIFECYCLE")
            ) =>
        {
            (row.tenant_id, row.operation_id)
        }
        Ok(_) => {
            tracing::warn!(workflow_id = %req.workflow_id, "跃迁未指向已登记的 scope 生命周期 Workflow");
            return StatusCode::FORBIDDEN.into_response();
        }
        Err(e) => return unavailable(e),
    };

    let allowed = match req.kind {
        ScopeKind::Tenant => TENANT_TRANSITIONS,
        ScopeKind::Workspace => WORKSPACE_TRANSITIONS,
    };
    let froms: Vec<String> = allowed
        .iter()
        .filter(|(_, to)| *to == req.to_state)
        .map(|(from, _)| (*from).to_owned())
        .collect();
    if froms.is_empty() {
        tracing::warn!(to = %req.to_state, "目标状态不在该状态机内");
        return StatusCode::FORBIDDEN.into_response();
    }

    let mut tx = match state.pool.begin().await {
        Ok(t) => t,
        Err(e) => return unavailable(e),
    };
    let updated = match req.kind {
        ScopeKind::Tenant => sqlx::query!(
            "update identity.tenant set state = $1, version = version + 1
             where id = $2 and version = $3 and state = any($4)
             returning state, version",
            req.to_state,
            req.id,
            req.from_version,
            &froms
        )
        .fetch_optional(&mut *tx)
        .await
        .map(|o| o.map(|r| (r.state, r.version))),
        ScopeKind::Workspace => sqlx::query!(
            "update identity.workspace set state = $1, version = version + 1
             where id = $2 and version = $3 and state = any($4)
             returning state, version",
            req.to_state,
            req.id,
            req.from_version,
            &froms
        )
        .fetch_optional(&mut *tx)
        .await
        .map(|o| o.map(|r| (r.state, r.version))),
    };

    match updated {
        Ok(Some((new_state, version))) => {
            // 审计与状态变化同事务，理由同成员跃迁
            let entry = AuditEntry {
                event_key: format!("{}:{}:{}", req.workflow_id, req.id, new_state),
                tenant_id: Some(wf_tenant),
                workspace_id: match req.kind {
                    ScopeKind::Workspace => Some(req.id),
                    ScopeKind::Tenant => None,
                },
                operation_id: wf_operation,
                event_type: "OUTCOME",
                human_identity_id: None,
                initiator_principal_id: None,
                actor_principal_id: None,
                action_key: "scope.transition",
                action_version: 1,
                component_type_key: "core",
                target_type: Some(match req.kind {
                    ScopeKind::Tenant => "TENANT",
                    ScopeKind::Workspace => "WORKSPACE",
                }),
                target_id: Some(req.id),
                parameter_hash: &new_state,
                decision: "ALLOW",
                result_code: &new_state,
                result_exposure: "NONE",
                evidence_refs: serde_json::json!([{
                    "kind": "TEMPORAL_WORKFLOW_ID",
                    "value": req.workflow_id,
                }]),
                correlation_id: wf_operation,
            };
            if let Err(e) = append(&mut tx, entry).await {
                return unavailable(e);
            }
            if let Err(e) = tx.commit().await {
                return unavailable(e);
            }
            (
                StatusCode::OK,
                Json(ScopeTransitionResponse {
                    state: new_state,
                    version,
                }),
            )
                .into_response()
        }
        Ok(None) => {
            tracing::warn!(
                id = %req.id,
                to = %req.to_state,
                from_version = req.from_version,
                "跃迁不成立：版本不匹配或当前状态不允许"
            );
            StatusCode::CONFLICT.into_response()
        }
        Err(e) => unavailable(e),
    }
}
