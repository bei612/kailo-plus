//! Buzz roster 的成员投影（`DD-41`、`DD-45`）。
//!
//! Workflow 在 Worker 里编排，但这一步留在 Core：CONTROL 身份的私钥由 Core
//! 托管（`custody=SERVER`），签名只在 Core signer 的内存中完成（`DD-72`）。
//! 把签名挪到 Worker 就要把私钥也挪过去，那是第二个持钥方。
//!
//! 本模块只做投影这一件事。它不判定成员该不该 active——那是 Workflow 在
//! 全部投影查证一致后的结论（`.design/09`）。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use kailo_buzz::bridge::{Custody, IdentityClient, Presence, Scope};
use kailo_buzz::operator::OperatorError;
use kailo_secrets::{SecretError, SecretRef};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::service_api::{authorize, unavailable, ServiceState};

/// 投影目标的层级。`TENANT` 投 relay roster，`WORKSPACE` 投 Channel roster
/// （`DD-45`）。两者共用同一个 Workflow kind，靠这个字段区分。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum MembershipScope {
    Tenant,
    Workspace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum TargetPresence {
    Present,
    Absent,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuzzProjectionRequest {
    pub scope: MembershipScope,
    pub membership_id: Uuid,
    /// Workflow input 冻结的 membership 版本。库里的版本与它不等，说明这条
    /// Workflow 正在对着一个已经变过的事实做投影——拒绝，而不是按新事实执行
    /// （`06` §3：Workflow 运行中不得换冻结输入）。
    pub membership_version: i32,
    pub presence: TargetPresence,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuzzProjectionResponse {
    /// roster 查证后该 pubkey 的实际状态。调用方据此对账，不据 HTTP 200。
    pub converged: bool,
    pub target_pubkey: String,
}

/// 解析失败的分类。它决定 HTTP 状态，进而决定 Activity 侧是否重试
/// （`06` §5.1：4xx 类进 `NonRetryableErrorTypes`）。
enum Refusal {
    /// 事实不存在或版本不符——重试多少次都一样
    NotFound(&'static str),
    /// 前置条件不成立（binding 不是 ACTIVE、托管方不是 Core）——同样不该重试
    Denied(&'static str),
}

pub async fn project_buzz_roster(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<BuzzProjectionRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    let plan = match resolve(&state, &req).await {
        Ok(p) => p,
        Err(Ok(refusal)) => return refusal_response(refusal),
        Err(Err(e)) => return unavailable(e),
    };

    // 私钥只在这里出现，且只进 IdentityClient 的内存。SecretValue 不实现
    // Debug/Display，任何日志路径都拿不到它（DD-70）。
    let key = match state.secrets.read(&plan.control_secret, "value").await {
        Ok(v) => v,
        Err(SecretError::AudienceMismatch) => {
            return refusal_response(Refusal::Denied("CONTROL 密钥的 audience 与本服务不符"))
        }
        Err(SecretError::VersionUnavailable) => {
            return refusal_response(Refusal::Denied("CONTROL 密钥的指定版本不可读"))
        }
        Err(e) => {
            tracing::warn!(error = %e, "SecretRef 解析不可用");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };

    let client = match IdentityClient::new(
        Custody::Server,
        key.expose(),
        &state.relay_transport,
        &plan.community_host,
    ) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "构造 CONTROL 客户端失败");
            return refusal_response(Refusal::Denied("CONTROL 身份不可用于代签"));
        }
    };

    let scope = match plan.channel_id.as_deref() {
        Some(id) => Scope::Channel(id),
        None => Scope::Relay,
    };
    let want = match req.presence {
        TargetPresence::Present => Presence::Present,
        TargetPresence::Absent => Presence::Absent,
    };

    match client
        .converge(&state.http, scope, &plan.target_pubkey, want)
        .await
    {
        Ok(()) => (
            StatusCode::OK,
            Json(BuzzProjectionResponse {
                converged: true,
                target_pubkey: plan.target_pubkey,
            }),
        )
            .into_response(),
        // 未收敛是结果不明，不是拒绝：roster 快照可能落后，修复来自 Relay 的
        // 周期对账（SF-BUZ-34）。503 让 Activity 按其重试上界继续。
        Err(e @ OperatorError::NotConverged(_)) => {
            tracing::info!(error = %e, "roster 未收敛，等待重试");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
        Err(e) => {
            tracing::warn!(error = %e, "roster 投影失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

/// 一次投影所需的全部事实，解析完就不再回库。
struct Plan {
    community_host: String,
    /// `None` 表示 relay 层 roster
    channel_id: Option<String>,
    target_pubkey: String,
    control_secret: SecretRef,
}

/// 外层 `Err` 区分两类：`Ok(Refusal)` 是确定的拒绝，`Err(sqlx)` 是依赖不可用。
/// 两者映射到不同 HTTP 状态，进而决定调用方重试与否。
async fn resolve(
    state: &ServiceState,
    req: &BuzzProjectionRequest,
) -> Result<Plan, Result<Refusal, sqlx::Error>> {
    // membership → tenant/principal，并在同一句里核版本。分两句查会在两次
    // 查询之间留下版本变化的窗口。
    let (tenant_id, principal_id, workspace_id) = match req.scope {
        MembershipScope::Tenant => {
            let row = sqlx::query!(
                "select tenant_id, tenant_principal_id from identity.tenant_membership
                 where id = $1 and version = $2",
                req.membership_id,
                req.membership_version
            )
            .fetch_optional(&state.pool)
            .await
            .map_err(Err)?;
            let row = row.ok_or(Ok(Refusal::NotFound("TenantMembership 不存在或版本不符")))?;
            (row.tenant_id, row.tenant_principal_id, None)
        }
        MembershipScope::Workspace => {
            let row = sqlx::query!(
                "select wm.tenant_principal_id, wm.workspace_id, w.tenant_id
                 from identity.workspace_membership wm
                 join identity.workspace w on w.id = wm.workspace_id
                 where wm.id = $1 and wm.version = $2",
                req.membership_id,
                req.membership_version
            )
            .fetch_optional(&state.pool)
            .await
            .map_err(Err)?;
            let row = row.ok_or(Ok(Refusal::NotFound(
                "WorkspaceMembership 不存在或版本不符",
            )))?;
            (
                row.tenant_id,
                row.tenant_principal_id,
                Some(row.workspace_id),
            )
        }
    };

    // TenantBuzzBinding 必须 ACTIVE：库里的三条 CHECK 已保证 ACTIVE 蕴含
    // require_relay_membership=true 且 allow_nip_oa_auth=false，也就是协作面
    // 确实有准入执行点（SF-BUZ-26、DD-75）。这里只需断言状态。
    let binding = sqlx::query!(
        "select normalized_host, control_service_principal_id
         from projection.tenant_buzz_binding
         where tenant_id = $1 and state = 'ACTIVE'",
        tenant_id
    )
    .fetch_optional(&state.pool)
    .await
    .map_err(Err)?
    .ok_or(Ok(Refusal::Denied("TenantBuzzBinding 不是 ACTIVE")))?;

    // CONTROL 身份：必须 SERVER 托管且 ACTIVE。CLIENT 托管说明私钥不在 Core
    // 手里，此时代签是走错了路径，必须当场失败而不是换个身份凑合（DD-75）。
    let control = sqlx::query!(
        "select private_key_secret_ref, private_key_secret_version, private_key_secret_audience
         from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2
           and kind = 'CONTROL' and custody = 'SERVER' and state = 'ACTIVE'",
        tenant_id,
        binding.control_service_principal_id
    )
    .fetch_optional(&state.pool)
    .await
    .map_err(Err)?
    .ok_or(Ok(Refusal::Denied(
        "CONTROL BuzzIdentityBinding 不可用于代签",
    )))?;

    // 三列由 custody_matches_secret_triple 保证同生共死，这里仍然显式解包：
    // 约束在库里，读取在这里，不靠「它应该非空」推进。
    let control_secret = SecretRef {
        locator: control
            .private_key_secret_ref
            .ok_or(Ok(Refusal::Denied("CONTROL 密钥缺 locator")))?,
        version: control
            .private_key_secret_version
            .ok_or(Ok(Refusal::Denied("CONTROL 密钥缺版本")))? as u32,
        audience: control
            .private_key_secret_audience
            .ok_or(Ok(Refusal::Denied("CONTROL 密钥缺 audience")))?,
    };

    // 被投影的目标：该 Principal 的 Buzz pubkey。两种托管都要投影——撤权的
    // 执行点是 roster，与私钥在谁手里无关（DD-75、.design/10 §4）。
    let target = sqlx::query!(
        "select pubkey from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2 and state <> 'REVOKED'",
        tenant_id,
        principal_id
    )
    .fetch_optional(&state.pool)
    .await
    .map_err(Err)?
    .ok_or(Ok(Refusal::NotFound(
        "目标 Principal 没有可用的 BuzzIdentityBinding",
    )))?;

    let channel_id = match workspace_id {
        None => None,
        Some(ws) => Some(
            sqlx::query!(
                "select channel_id from projection.workspace_buzz_binding
                 where workspace_id = $1 and state = 'ACTIVE'",
                ws
            )
            .fetch_optional(&state.pool)
            .await
            .map_err(Err)?
            .ok_or(Ok(Refusal::Denied("WorkspaceBuzzBinding 不是 ACTIVE")))?
            .channel_id
            .to_string(),
        ),
    };

    Ok(Plan {
        community_host: binding.normalized_host,
        channel_id,
        target_pubkey: target.pubkey,
        control_secret,
    })
}

fn refusal_response(r: Refusal) -> Response {
    match r {
        Refusal::NotFound(why) => {
            tracing::warn!(why, "投影前置事实缺失");
            StatusCode::NOT_FOUND.into_response()
        }
        Refusal::Denied(why) => {
            tracing::warn!(why, "投影前置条件不成立");
            StatusCode::FORBIDDEN.into_response()
        }
    }
}
