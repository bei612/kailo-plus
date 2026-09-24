//! HUMAN 身份单把 pubkey 的 roster 投影（`DD-79`，`kind=BUZZ_IDENTITY_PROJECTION`）。
//!
//! 两类调用方：原生设备的登记与撤销（`custody=CLIENT`），以及 Web 托管身份的
//! key revoke 与重建（`custody=SERVER`，`server_keys`，`.design/09` 的 key
//! revoke/rotate 行）。只接受 `kind=HUMAN`：CONTROL 的轮换受 GAP-BUZ-01 阻断。
//!
//! 一把 pubkey 登记或撤销时只动它自己：投入或移出 relay roster 与
//! 此人全部 ACTIVE Workspace 的 Channel roster。方向由 binding 状态决定，不由
//! 调用方指定——`RECONCILING` 投入、`REVOKING` 移出，与成员生命周期同一原则。
//!
//! 与成员撤权并发时的正确性靠两件事：撤权一方先把状态置为 `REVOKING`（成员或
//! 设备）再动 roster；本模块每次投入之后都回头核对那两个状态，发现撤权已开始
//! 就把刚投入的移出。于是任何交错下都不会留下一把已撤权却仍在 roster 上的钥匙。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use kailo_buzz::bridge::{IdentityClient, Presence, Scope};
use kailo_buzz::operator::OperatorError;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::service_api::{authorize, unavailable, ServiceState};
use crate::tenant_lifecycle::control_client;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityProjectionRequest {
    pub pubkey: String,
    /// Workflow input 冻结的 binding 版本。库里的版本与它不等说明事实已经变了
    /// ——拒绝，而不是按新事实执行（`06` §3）。
    pub binding_version: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityProjectionResponse {
    pub converged: bool,
    pub pubkey: String,
    /// 查证后该 binding 的状态
    pub state: String,
}

pub async fn project_buzz_identity(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<IdentityProjectionRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    let binding = match sqlx::query!(
        "select tenant_id, principal_id, state from identity.buzz_identity_binding
         where pubkey = $1 and version = $2 and kind = 'HUMAN'",
        req.pubkey,
        req.binding_version
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(b)) => b,
        Ok(None) => {
            tracing::warn!(pubkey = %req.pubkey, "HUMAN binding 不存在或版本不符");
            return StatusCode::NOT_FOUND.into_response();
        }
        Err(e) => return unavailable(e),
    };

    let (control, _) = match control_client(&state, binding.tenant_id).await {
        Ok(c) => c,
        Err(r) => return r,
    };

    let result = match binding.state.as_str() {
        "RECONCILING" => {
            admit(
                &state,
                &control,
                binding.tenant_id,
                binding.principal_id,
                &req,
            )
            .await
        }
        "REVOKING" => retire(&state, &control, binding.tenant_id, &req).await,
        other => {
            // 其余状态没有可投影的方向。已是终态说明这条 Workflow 迟到了。
            tracing::warn!(state = other, "binding 状态不在可投影的两个状态上");
            return StatusCode::CONFLICT.into_response();
        }
    };
    match result {
        Ok(final_state) => (
            StatusCode::OK,
            Json(IdentityProjectionResponse {
                converged: true,
                pubkey: req.pubkey,
                state: final_state,
            }),
        )
            .into_response(),
        Err(r) => r,
    }
}

/// 投入：relay roster，再逐个 ACTIVE Workspace 的 Channel roster。
async fn admit(
    state: &ServiceState,
    control: &IdentityClient,
    tenant_id: Uuid,
    principal_id: Uuid,
    req: &IdentityProjectionRequest,
) -> Result<String, Response> {
    // 撤权已经开始（成员或本设备任一），就不再投入——并把可能已投入的移出。
    if !still_admissible(state, tenant_id, principal_id, &req.pubkey).await? {
        converge(state, control, Scope::Relay, &req.pubkey, Presence::Absent).await?;
        return Err(StatusCode::CONFLICT.into_response());
    }
    converge(state, control, Scope::Relay, &req.pubkey, Presence::Present).await?;
    if !still_admissible(state, tenant_id, principal_id, &req.pubkey).await? {
        converge(state, control, Scope::Relay, &req.pubkey, Presence::Absent).await?;
        return Err(StatusCode::CONFLICT.into_response());
    }

    for channel in active_channels(state, principal_id).await? {
        converge(
            state,
            control,
            Scope::Channel(&channel),
            &req.pubkey,
            Presence::Present,
        )
        .await?;
        // 这个 Workspace 的成员关系在投入期间被撤了：把刚投入的移出，交给那条
        // 撤权流程收尾。其余 Workspace 照常。
        if !channel_still_admissible(state, principal_id, &channel).await? {
            converge(
                state,
                control,
                Scope::Channel(&channel),
                &req.pubkey,
                Presence::Absent,
            )
            .await?;
        }
    }

    crate::service_api::audit_gate(state).await?;
    // 置 ACTIVE 与「成员仍 ACTIVE」在同一句里判定，不给撤权留下两句之间的窗口。
    let done = sqlx::query!(
        "update identity.buzz_identity_binding b
         set state = 'ACTIVE', version = version + 1
         where b.pubkey = $1 and b.state = 'RECONCILING'
           and exists (select 1 from identity.tenant_membership tm
                       where tm.tenant_principal_id = b.principal_id and tm.state = 'ACTIVE')",
        req.pubkey
    )
    .execute(&state.pool)
    .await
    .map_err(unavailable)?;
    if done.rows_affected() == 0 {
        // Web 托管身份还可能被并发的成员投影先一步置为 ACTIVE（它投入的是同一把
        // pubkey）。那不是撤权：这里已把它投入 relay 与全部 ACTIVE Channel，照常
        // 收敛。其余情形是最后一刻撤权开始了：移出，由撤权流程收尾。
        let now = sqlx::query_scalar!(
            "select state from identity.buzz_identity_binding where pubkey = $1",
            req.pubkey
        )
        .fetch_optional(&state.pool)
        .await
        .map_err(unavailable)?;
        if now.as_deref() == Some("ACTIVE") {
            return Ok("ACTIVE".to_owned());
        }
        converge(state, control, Scope::Relay, &req.pubkey, Presence::Absent).await?;
        return Err(StatusCode::CONFLICT.into_response());
    }
    Ok("ACTIVE".to_owned())
}

/// 移出：relay roster 与该 Tenant 全部 ACTIVE Channel。只移出一把 pubkey，
/// 移出不在其中的是无害的，因此不必按成员关系筛 Channel——少筛一层就少一个
/// 「漏掉某个刚被撤权的 Workspace」的机会。
async fn retire(
    state: &ServiceState,
    control: &IdentityClient,
    tenant_id: Uuid,
    req: &IdentityProjectionRequest,
) -> Result<String, Response> {
    let channels = sqlx::query_scalar!(
        "select b.channel_id from projection.workspace_buzz_binding b
         join identity.workspace w on w.id = b.workspace_id
         where w.tenant_id = $1 and b.state = 'ACTIVE'",
        tenant_id
    )
    .fetch_all(&state.pool)
    .await
    .map_err(unavailable)?;
    for channel in channels {
        let channel = channel.to_string();
        converge(
            state,
            control,
            Scope::Channel(&channel),
            &req.pubkey,
            Presence::Absent,
        )
        .await?;
    }
    converge(state, control, Scope::Relay, &req.pubkey, Presence::Absent).await?;
    sqlx::query!(
        "update identity.buzz_identity_binding set state = 'REVOKED', version = version + 1
         where pubkey = $1 and state = 'REVOKING'",
        req.pubkey
    )
    .execute(&state.pool)
    .await
    .map_err(unavailable)?;
    Ok("REVOKED".to_owned())
}

async fn converge(
    state: &ServiceState,
    control: &IdentityClient,
    scope: Scope<'_>,
    pubkey: &str,
    want: Presence,
) -> Result<(), Response> {
    control
        .converge(&state.http, scope, pubkey, want)
        .await
        .map_err(|e| {
            // 未收敛是结果不明，不是拒绝：roster 快照可能落后（SF-BUZ-34）。
            // 503 让 Activity 按其重试上界继续，已收敛的部分在重试时幂等。
            match e {
                OperatorError::NotConverged(_) => tracing::info!(error = %e, "roster 未收敛"),
                _ => tracing::warn!(error = %e, "roster 投影失败"),
            }
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        })
}

/// binding 仍在登记中，且此人的 Tenant 成员关系仍 ACTIVE。
async fn still_admissible(
    state: &ServiceState,
    tenant_id: Uuid,
    principal_id: Uuid,
    pubkey: &str,
) -> Result<bool, Response> {
    sqlx::query_scalar!(
        r#"select exists (
             select 1 from identity.buzz_identity_binding b
             join identity.tenant_membership tm
               on tm.tenant_principal_id = b.principal_id and tm.tenant_id = b.tenant_id
             where b.pubkey = $1 and b.state = 'RECONCILING' and tm.state = 'ACTIVE'
               and b.tenant_id = $2 and b.principal_id = $3) as "ok!""#,
        pubkey,
        tenant_id,
        principal_id
    )
    .fetch_one(&state.pool)
    .await
    .map_err(unavailable)
}

/// 此人仍是该 Channel 所属 Workspace 的 ACTIVE 成员。
async fn channel_still_admissible(
    state: &ServiceState,
    principal_id: Uuid,
    channel: &str,
) -> Result<bool, Response> {
    let Ok(channel_id) = channel.parse::<Uuid>() else {
        return Ok(false);
    };
    sqlx::query_scalar!(
        r#"select exists (
             select 1 from projection.workspace_buzz_binding b
             join identity.workspace_membership wm on wm.workspace_id = b.workspace_id
             where b.channel_id = $1 and b.state = 'ACTIVE'
               and wm.tenant_principal_id = $2 and wm.state = 'ACTIVE') as "ok!""#,
        channel_id,
        principal_id
    )
    .fetch_one(&state.pool)
    .await
    .map_err(unavailable)
}

/// 此人 ACTIVE 成员关系所在、且 Channel 绑定 ACTIVE 的全部 Channel。
async fn active_channels(
    state: &ServiceState,
    principal_id: Uuid,
) -> Result<Vec<String>, Response> {
    Ok(sqlx::query_scalar!(
        "select b.channel_id from projection.workspace_buzz_binding b
         join identity.workspace_membership wm on wm.workspace_id = b.workspace_id
         where wm.tenant_principal_id = $1 and wm.state = 'ACTIVE' and b.state = 'ACTIVE'",
        principal_id
    )
    .fetch_all(&state.pool)
    .await
    .map_err(unavailable)?
    .into_iter()
    .map(|c| c.to_string())
    .collect())
}
