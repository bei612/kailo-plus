//! Web 托管 HUMAN 身份的 key revoke 与重建（`.design/09` 的 key revoke/rotate 行、
//! `.design/06` §1 的 `BUZZ_IDENTITY_PROJECTION` 行、`DD-77`）。
//!
//! 轮换 = 先 revoke 再重建，两个 Governed Action、各一条 Workflow：
//!
//! 1. **revoke**：旧 binding `ACTIVE`/`RECONCILING` → `REVOKING`。这一句就是「停新
//!    签名」：Core signer 只取 `ACTIVE` 的 SERVER binding（`web_transport::actor_keys`），
//!    已建立的 BFF 流在再准入周期内关闭（`stream`）。随后 Workflow 把该 pubkey 移出
//!    relay 与全部 Channel roster，查证后 `REVOKED`。旧 binding 留作历史，审计据它
//!    解析已发布的 event。
//! 2. **重建**：此人没有非 `REVOKED` 的 SERVER binding 时，生成新私钥写入独立
//!    locator 的 KV 版本，建新 binding（`RECONCILING`），Workflow 投入 relay 与此人
//!    全部 ACTIVE Channel 后 `ACTIVE`——「重开」。
//!
//! 先撤后建不是偏好：每人至多一条非 `REVOKED` 的 SERVER binding（`DD-77`，库里的
//! 部分唯一索引），新旧并存在模型里不成立。两步之间此人在 Web 上不能发言，这是
//! 轮换期间唯一允许的状态变化方向——只收紧（`.design/09`「中间状态只允许收紧」）。
//!
//! 只接受 `kind=HUMAN`、`custody=SERVER`：原生设备的 CLIENT 身份由其本人经
//! `client_keys` 撤销；CONTROL 的轮换受 GAP-BUZ-01 阻断，在这里被拒绝。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::audit::{append, AuditEntry};
use crate::client_keys::{IdentityEnvelope, IdentityTarget, KIND};
use crate::component_task::{self, AllowedAction, ComponentTaskInput};
use crate::membership_lifecycle::LifecycleResponse;
use crate::membership_projection::{ensure_human_identity, Blocked, Refusal};
use crate::service_api::{authorize, unavailable, ServiceState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevokeRequest {
    pub pubkey: String,
    /// 已准入的 ActionExecution，target 是该 binding 的 Principal。它同时是
    /// 这次撤销的幂等键。
    pub action_execution_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionRequest {
    pub principal_id: Uuid,
    pub action_execution_id: Uuid,
}

pub async fn revoke_server_key(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<RevokeRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    let binding = match sqlx::query!(
        "select tenant_id, principal_id, kind, custody, state, version
         from identity.buzz_identity_binding where pubkey = $1",
        req.pubkey
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(b)) => b,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return unavailable(e),
    };
    if binding.kind != "HUMAN" || binding.custody != "SERVER" {
        // CONTROL：GAP-BUZ-01。CLIENT：私钥不在 Core，撤销由本人经设备入口发起。
        tracing::warn!(kind = %binding.kind, custody = %binding.custody, "该身份不经此入口撤销");
        return StatusCode::CONFLICT.into_response();
    }

    if let Some(r) = resume(&state, req.action_execution_id, binding.tenant_id).await {
        return r;
    }
    if !matches!(binding.state.as_str(), "ACTIVE" | "RECONCILING") {
        tracing::warn!(state = %binding.state, "binding 不在可撤销的状态");
        return StatusCode::CONFLICT.into_response();
    }
    let action = match admit(
        &state,
        &req.action_execution_id,
        binding.tenant_id,
        binding.principal_id,
    )
    .await
    {
        Ok(a) => a,
        Err(r) => return r,
    };

    let mut tx = match state.pool.begin().await {
        Ok(t) => t,
        Err(e) => return unavailable(e),
    };
    // 停签与 WorkflowRef 同事务：提交之后崩溃，同一 ActionExecution 的重试经
    // resume 找回这条 Workflow；反过来就是一把停了签、却没有人去移出 roster 的钥匙。
    let version = match sqlx::query_scalar!(
        "update identity.buzz_identity_binding set state = 'REVOKING', version = version + 1
         where pubkey = $1 and version = $2 and state in ('ACTIVE', 'RECONCILING')
         returning version",
        req.pubkey,
        binding.version
    )
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(v)) => v,
        Ok(None) => return StatusCode::CONFLICT.into_response(),
        Err(e) => return unavailable(e),
    };
    let workflow_id = component_task::workflow_id(KIND, binding.tenant_id, &req.pubkey, version);
    if let Err(e) = record(
        &mut tx,
        &workflow_id,
        binding.tenant_id,
        binding.principal_id,
        req.action_execution_id,
        &action,
        &req.pubkey,
        "REVOKING",
    )
    .await
    {
        return unavailable(e);
    }
    if let Err(e) = tx.commit().await {
        return unavailable(e);
    }
    tracing::info!(pubkey = %req.pubkey, workflow_id, "Web 托管身份已停签，开始移出 roster");
    start(
        &state,
        binding.tenant_id,
        &req.pubkey,
        version,
        req.action_execution_id,
    )
    .await
}

pub async fn provision_server_key(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<ProvisionRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    // 重建只给仍是 ACTIVE 成员的人：离开 Tenant 的人不该重新拿到协作身份
    let tenant_id = match sqlx::query_scalar!(
        "select tenant_id from identity.tenant_membership
         where tenant_principal_id = $1 and state = 'ACTIVE'",
        req.principal_id
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(t)) => t,
        Ok(None) => {
            tracing::warn!(principal = %req.principal_id, "没有 ACTIVE 的 Tenant 成员关系，不重建身份");
            return StatusCode::CONFLICT.into_response();
        }
        Err(e) => return unavailable(e),
    };
    if let Some(r) = resume(&state, req.action_execution_id, tenant_id).await {
        return r;
    }
    // 仍有非 REVOKED 的 SERVER binding：旧的还没撤完，或已经重建过。先撤后建。
    match sqlx::query_scalar!(
        "select state from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2 and kind = 'HUMAN'
           and custody = 'SERVER' and state <> 'REVOKED'",
        tenant_id,
        req.principal_id
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(None) => {}
        Ok(Some(s)) => {
            tracing::warn!(state = %s, "此人仍有非 REVOKED 的 Web 托管身份");
            return StatusCode::CONFLICT.into_response();
        }
        Err(e) => return unavailable(e),
    }
    let action = match admit(
        &state,
        &req.action_execution_id,
        tenant_id,
        req.principal_id,
    )
    .await
    {
        Ok(a) => a,
        Err(r) => return r,
    };

    // 新私钥写独立 locator 的 KV 版本；旧 binding 的 pubkey 留给已发布 event 的
    // 作者归因，旧私钥按 SecretRef 生命周期另行处置。
    // 这一步是外部副作用，不在事务里；它幂等——已有非 REVOKED binding 即返回它。
    let pubkey = match ensure_human_identity(&state, tenant_id, req.principal_id).await {
        Ok(p) => p,
        Err(Blocked::Refused(Refusal::Denied(why) | Refusal::NotFound(why))) => {
            tracing::warn!(why, "重建身份被拒");
            return StatusCode::FORBIDDEN.into_response();
        }
        Err(Blocked::Unavailable(e)) => {
            tracing::warn!(error = %e, "重建身份时依赖不可用");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let version = match sqlx::query_scalar!(
        "select version from identity.buzz_identity_binding
         where pubkey = $1 and state = 'RECONCILING'",
        pubkey
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(v)) => v,
        // 刚建的 binding 已被别的路径推进（并发的成员投影）或撤销：不在这里凑合
        Ok(None) => return StatusCode::CONFLICT.into_response(),
        Err(e) => return unavailable(e),
    };

    let workflow_id = component_task::workflow_id(KIND, tenant_id, &pubkey, version);
    let mut tx = match state.pool.begin().await {
        Ok(t) => t,
        Err(e) => return unavailable(e),
    };
    match record(
        &mut tx,
        &workflow_id,
        tenant_id,
        req.principal_id,
        req.action_execution_id,
        &action,
        &pubkey,
        "RECONCILING",
    )
    .await
    {
        Ok(()) => {}
        // 同一把新 pubkey 已由另一条 ActionExecution 驱动：不起第二个 Workflow
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            return StatusCode::CONFLICT.into_response()
        }
        Err(e) => return unavailable(e),
    }
    if let Err(e) = tx.commit().await {
        return unavailable(e);
    }
    tracing::info!(pubkey, workflow_id, "Web 托管身份已重建，开始投入 roster");
    start(&state, tenant_id, &pubkey, version, req.action_execution_id).await
}

/// 同一 ActionExecution 已驱动过 Workflow：以它的固定 ID 收敛（Start 结果不明
/// 后的重试走到这里）。`None` 表示这张准入还没用过。
async fn resume(state: &ServiceState, action: Uuid, tenant_id: Uuid) -> Option<Response> {
    let existing = match component_task::workflow_of_action(&state.pool, action).await {
        Ok(Some(w)) => w,
        Ok(None) => return None,
        Err(e) => return Some(unavailable(e)),
    };
    // 固定 ID 的后两段就是冻结的 pubkey 与 binding 版本
    let parts: Vec<&str> = existing.split(':').collect();
    match parts.as_slice() {
        ["kailo", k, t, pubkey, version] if *k == KIND && *t == tenant_id.to_string() => {
            match version.parse() {
                Ok(v) => Some(start(state, tenant_id, pubkey, v, action).await),
                Err(_) => Some(StatusCode::CONFLICT.into_response()),
            }
        }
        _ => {
            tracing::warn!(action = %action, existing, "ActionExecution 已驱动另一类 Workflow");
            Some(StatusCode::CONFLICT.into_response())
        }
    }
}

async fn admit(
    state: &ServiceState,
    action: &Uuid,
    tenant_id: Uuid,
    principal_id: Uuid,
) -> Result<AllowedAction, Response> {
    match component_task::allowed_action(&state.pool, *action, tenant_id, principal_id).await {
        Ok(Some(a)) => Ok(a),
        Ok(None) => {
            tracing::warn!(action = %action, "ActionExecution 不存在、未准入或 target 不是该 Principal");
            Err(StatusCode::FORBIDDEN.into_response())
        }
        Err(e) => Err(unavailable(e)),
    }
}

/// 预写 WorkflowRef 并写决定审计，两者与调用方的状态变化同事务。
#[allow(clippy::too_many_arguments)]
async fn record(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    workflow_id: &str,
    tenant_id: Uuid,
    principal_id: Uuid,
    action_execution_id: Uuid,
    action: &AllowedAction,
    pubkey: &str,
    result_code: &str,
) -> Result<(), sqlx::Error> {
    component_task::prewrite(
        tx,
        workflow_id,
        KIND,
        tenant_id,
        action.operation_id,
        action_execution_id,
    )
    .await?;
    append(
        tx,
        AuditEntry {
            event_key: format!("{}:{pubkey}:{action_execution_id}", action.action_key),
            tenant_id: Some(tenant_id),
            workspace_id: None,
            operation_id: action.operation_id,
            event_type: "DECISION",
            human_identity_id: None,
            initiator_principal_id: Some(action.initiator_principal_id),
            actor_principal_id: Some(action.actor_principal_id),
            action_key: &action.action_key,
            action_version: action.action_version,
            component_type_key: "buzz",
            target_type: Some("PRINCIPAL"),
            target_id: Some(principal_id),
            parameter_hash: &action.parameter_hash,
            decision: "ALLOW",
            result_code,
            result_exposure: "NONE",
            evidence_refs: serde_json::json!([
                { "kind": "BUZZ_PUBKEY", "value": pubkey },
                { "kind": "TEMPORAL_WORKFLOW_ID", "value": workflow_id },
            ]),
            correlation_id: action.correlation_id,
        },
    )
    .await
}

async fn start(
    state: &ServiceState,
    tenant_id: Uuid,
    pubkey: &str,
    version: i32,
    action: Uuid,
) -> Response {
    let workflow_id = component_task::workflow_id(KIND, tenant_id, pubkey, version);
    let input = ComponentTaskInput {
        kind: KIND.to_owned(),
        target: IdentityEnvelope {
            identity: IdentityTarget {
                pubkey: pubkey.to_owned(),
                binding_version: version,
            },
        },
    };
    match component_task::start(
        &state.pool,
        &state.temporal,
        &workflow_id,
        tenant_id,
        action,
        &input,
    )
    .await
    {
        Ok(run_id) => (
            StatusCode::OK,
            Json(LifecycleResponse {
                workflow_id,
                kind: KIND.to_owned(),
                run_id,
            }),
        )
            .into_response(),
        Err(r) => r,
    }
}
