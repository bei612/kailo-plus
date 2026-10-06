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
use collab_bridge::bridge::{IdentityClient, Presence, Scope};
use collab_bridge::operator::OperatorError;
use secret_store::SecretRef;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::service_api::{authorize, unavailable, ServiceState};
use crate::tenant_lifecycle::{control_client, ProjectionDirection};

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

    // Workflow 冻结的是 REVOKING 时的版本；SERVER 身份在 REVOKED（版本 +1）之后
    // 还要完成 DD-113 的第二段 destroy，重试时按确定的下一版本找回同一 binding。
    let binding: Option<ProjectedBinding> = match sqlx::query_as(
        "select tenant_id, principal_id, state, custody, private_key_secret_ref,
                private_key_secret_version, private_key_secret_audience
         from identity.buzz_identity_binding
         where pubkey = $1 and kind = 'HUMAN'
           and (version = $2
                or (custody = 'SERVER' and state = 'REVOKED' and version = $2 + 1))",
    )
    .bind(&req.pubkey)
    .bind(req.binding_version)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(b) => b,
        Err(e) => return unavailable(e),
    };
    let binding = match binding {
        Some(b) => b,
        None => {
            tracing::warn!(pubkey = %req.pubkey, "HUMAN binding 不存在或版本不符");
            return StatusCode::NOT_FOUND.into_response();
        }
    };
    let revoke_workflow = crate::component_task::workflow_id(
        crate::client_keys::KIND,
        binding.tenant_id,
        &req.pubkey,
        req.binding_version,
    );
    if binding.state == "REVOKED" {
        // 只有 SERVER 身份按版本 +1 命中：roster 已移出，只剩第二段 destroy。
        return match crate::server_keys::retire_server_human_key(
            &state,
            binding.tenant_id,
            &req.pubkey,
        )
        .await
        {
            Ok(_) => converged(req.pubkey, "REVOKED"),
            Err(r) => r,
        };
    }

    // CLIENT 私钥只在原生设备；SERVER 身份进入 roster 前必须证明钉住的 KV
    // 版本仍可读，且读出的私钥确实派生为这条 binding 的 pubkey。
    if binding.state == "RECONCILING" && binding.custody == "SERVER" {
        let secret = SecretRef {
            locator: binding.private_key_secret_ref.clone().unwrap_or_default(),
            version: binding.private_key_secret_version.unwrap_or_default() as u32,
            audience: binding.private_key_secret_audience.unwrap_or_default(),
        };
        if let Err(e) =
            crate::server_identity::read_bound_keys(&state.secrets, &secret, &req.pubkey).await
        {
            tracing::warn!(error = %e, pubkey = %req.pubkey, "SERVER 身份不可投入 roster");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    }

    // 登记中的钥匙投入 roster 是投入方向；撤销中的钥匙移出 roster 是撤出方向，
    // binding 因 NIP-11 漂移处于 RECONCILING 时照常执行（DD-114(2)）
    let direction = if binding.state == "REVOKING" {
        ProjectionDirection::Withdraw
    } else {
        ProjectionDirection::Establish
    };
    let (control, _) = match control_client(&state, binding.tenant_id, direction).await {
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
        "REVOKING" => {
            if binding.custody == "SERVER" {
                // DD-113 (3) 第一段先于 roster 移出：数据面立即 404。
                if let Err(r) = crate::server_keys::supersede_server_human_key(
                    &state,
                    binding.tenant_id,
                    &req.pubkey,
                    binding
                        .private_key_secret_ref
                        .as_deref()
                        .unwrap_or_default(),
                )
                .await
                {
                    return r;
                }
            }
            // DD-115 (2)：使 SERVER 私钥到期的是本次撤钥 operation，与 REVOKED 同事务冻结。
            let retire_operation = if binding.custody == "SERVER" {
                match sqlx::query_scalar::<_, Uuid>(
                    "select operation_id from projection.workflow_ref
                     where workflow_id = $1 and tenant_id = $2 and kind = $3",
                )
                .bind(&revoke_workflow)
                .bind(binding.tenant_id)
                .bind(crate::client_keys::KIND)
                .fetch_optional(&state.pool)
                .await
                {
                    Ok(Some(operation)) => Some(operation),
                    Ok(None) => {
                        tracing::warn!(pubkey = %req.pubkey, "撤钥 WorkflowRef 缺失，不推进 REVOKED");
                        return StatusCode::SERVICE_UNAVAILABLE.into_response();
                    }
                    Err(e) => return unavailable(e),
                }
            } else {
                None
            };
            match retire(
                &state,
                &control,
                binding.tenant_id,
                &req,
                retire_operation.zip(binding.private_key_secret_ref.as_deref()),
            )
            .await
            {
                Ok(done) if binding.custody == "SERVER" => {
                    match crate::server_keys::retire_server_human_key(
                        &state,
                        binding.tenant_id,
                        &req.pubkey,
                    )
                    .await
                    {
                        Ok(_) => Ok(done),
                        Err(r) => Err(r),
                    }
                }
                other => other,
            }
        }
        other => {
            // 其余状态没有可投影的方向。已是终态说明这条 Workflow 迟到了。
            tracing::warn!(state = other, "binding 状态不在可投影的两个状态上");
            return StatusCode::CONFLICT.into_response();
        }
    };
    match result {
        Ok(final_state) => converged(req.pubkey, &final_state),
        Err(r) => r,
    }
}

#[derive(sqlx::FromRow)]
struct ProjectedBinding {
    tenant_id: Uuid,
    principal_id: Uuid,
    state: String,
    custody: String,
    private_key_secret_ref: Option<String>,
    private_key_secret_version: Option<i32>,
    private_key_secret_audience: Option<String>,
}

fn converged(pubkey: String, final_state: &str) -> Response {
    (
        StatusCode::OK,
        Json(IdentityProjectionResponse {
            converged: true,
            pubkey,
            state: final_state.to_owned(),
        }),
    )
        .into_response()
}

/// 投入：relay roster，再逐个未暂停 Workspace 的 Channel roster（暂停中与已暂停的
/// 由恢复重建收敛，DD-97）。
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

    crate::conversations::project_for_principal(state, tenant_id, principal_id, Some(&req.pubkey))
        .await?;
    crate::service_api::audit_gate(state).await?;
    // 置 ACTIVE 与「成员仍 ACTIVE」在同一句里判定，不给撤权留下两句之间的窗口。
    // 绑定版本随 binding 一起转 ACTIVE（`.design/03` SecretRef 状态机）；CLIENT 无引用。
    let done = sqlx::query(
        "update identity.buzz_identity_binding b
         set state = 'ACTIVE', version = version + 1,
             private_key_secret_status = case when b.private_key_secret_ref is null
                                              then null else 'ACTIVE' end
         where b.pubkey = $1 and b.state = 'RECONCILING'
           and exists (select 1 from identity.tenant_membership tm
                       where tm.tenant_principal_id = b.principal_id and tm.state = 'ACTIVE')",
    )
    .bind(&req.pubkey)
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
    retire_operation: Option<(Uuid, &str)>,
) -> Result<String, Response> {
    let principal: Uuid = sqlx::query_scalar(
        "select principal_id from identity.buzz_identity_binding where pubkey=$1 and tenant_id=$2",
    )
    .bind(&req.pubkey)
    .bind(tenant_id)
    .fetch_one(&state.pool)
    .await
    .map_err(unavailable)?;
    crate::conversations::project_for_principal(state, tenant_id, principal, None).await?;
    // 不按 Workspace 状态筛：暂停中的 Channel 在清空之后已无该 pubkey，按缺席查证
    // 先读 roster 即成立、不发 9001，不会卡在已归档的 Channel 上（DD-97）
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
    let mut tx = state.pool.begin().await.map_err(unavailable)?;
    let revoked = sqlx::query(
        "update identity.buzz_identity_binding set state = 'REVOKED', version = version + 1
         where pubkey = $1 and state = 'REVOKING'",
    )
    .bind(&req.pubkey)
    .execute(&mut *tx)
    .await
    .map_err(unavailable)?;
    if let Some((operation, locator)) = retire_operation {
        if revoked.rows_affected() == 1
            && !crate::platform_keys::freeze_retirement(&mut tx, locator, operation)
                .await
                .map_err(unavailable)?
        {
            tracing::error!(pubkey = %req.pubkey, "撤销的 SERVER 身份没有可退役的 BOUND 意图");
        }
    }
    tx.commit().await.map_err(unavailable)?;
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
    // Workspace 在投入期间进入暂停，同样把刚投入的移出：暂停的清空可能已经做完
    sqlx::query_scalar(
        "select exists (
             select 1 from projection.workspace_buzz_binding b
             join identity.workspace_membership wm on wm.workspace_id = b.workspace_id
             join identity.workspace w on w.id = b.workspace_id
             where b.channel_id = $1 and b.state = 'ACTIVE'
               and w.state not in ('SUSPENDING', 'SUSPENDED')
               and wm.tenant_principal_id = $2 and wm.state = 'ACTIVE')",
    )
    .bind(channel_id)
    .bind(principal_id)
    .fetch_one(&state.pool)
    .await
    .map_err(unavailable)
}

/// 此人 ACTIVE 成员关系所在、Channel 绑定 ACTIVE 的全部 Channel，跳过暂停中与
/// 已暂停的 Workspace：它们的 roster 已清空或将被清空，由恢复时的重建补上（DD-97）。
/// 恢复中的照常投入——解档之前 9000 被拒即按结果不明重试。
async fn active_channels(
    state: &ServiceState,
    principal_id: Uuid,
) -> Result<Vec<String>, Response> {
    Ok(sqlx::query_scalar::<_, Uuid>(
        "select b.channel_id from projection.workspace_buzz_binding b
         join identity.workspace_membership wm on wm.workspace_id = b.workspace_id
         join identity.workspace w on w.id = b.workspace_id
         where wm.tenant_principal_id = $1 and wm.state = 'ACTIVE' and b.state = 'ACTIVE'
           and w.state not in ('SUSPENDING', 'SUSPENDED')",
    )
    .bind(principal_id)
    .fetch_all(&state.pool)
    .await
    .map_err(unavailable)?
    .into_iter()
    .map(|c| c.to_string())
    .collect())
}
