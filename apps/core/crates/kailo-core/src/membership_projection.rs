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
    /// roster 查证后这些 pubkey 的实际状态。调用方据此对账，不据 HTTP 200。
    pub converged: bool,
    /// 本次投影覆盖的全部 pubkey：此人的 Web 身份与各台原生设备（DD-77）。
    pub target_pubkeys: Vec<String>,
}

/// 解析失败的分类。它决定 HTTP 状态，进而决定 Activity 侧是否重试
/// （`06` §5.1：4xx 类进 `NonRetryableErrorTypes`）。
pub(crate) enum Refusal {
    /// 事实不存在或版本不符——重试多少次都一样
    NotFound(&'static str),
    /// 前置条件不成立（binding 不是 ACTIVE、托管方不是 Core）——同样不该重试
    Denied(&'static str),
}

/// 投影前置步骤不成立的两种方式，对 Activity 的意义相反：拒绝不重试，依赖
/// 不可用必须重试。把后者报成拒绝，一次 OpenBao 的短暂不可用就会让成员建立
/// 永久失败（06 §4 的 PRECONDITION 与 DENIED 之别）。
pub(crate) enum Blocked {
    Refused(Refusal),
    Unavailable(String),
}

impl From<sqlx::Error> for Blocked {
    fn from(e: sqlx::Error) -> Self {
        Self::Unavailable(e.to_string())
    }
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
        Err(Blocked::Refused(refusal)) => return refusal_response(refusal),
        Err(Blocked::Unavailable(why)) => {
            tracing::warn!(error = %why, "投影前置步骤的依赖不可用");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
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

    // 此人的每个 pubkey 都要收敛：一个人同时在用 Web 与原生设备时，撤权漏掉
    // 任何一把都等于这台设备还能继续发言（DD-77）。任一未收敛即整体未收敛，
    // 已收敛的部分在重试时是幂等的。
    let mut outcome = Ok(());
    for pubkey in &plan.target_pubkeys {
        outcome = client.converge(&state.http, scope, pubkey, want).await;
        if outcome.is_err() {
            break;
        }
    }
    match outcome {
        Ok(()) => {
            // roster 查证通过才推进 BuzzIdentityBinding 的状态机
            // （`.design/03` §2：`RECONCILING` 必须核对 Relay roster）。
            //
            // 状态机的归属：成员投影只推进 Web 的 SERVER 身份；原生设备的 CLIENT
            // 身份由 BUZZ_IDENTITY_PROJECTION 推进（它还要覆盖此人全部 Channel，
            // 这里只见到一个 scope，不能替它宣布 ACTIVE）。唯一的例外是 Tenant 层
            // 撤权：人离开了 Tenant，他的每一把钥匙都随之作废。
            //
            // Workspace 层的撤权只动 Channel roster：退出一个 Workspace 不等于退出
            // Tenant，把身份撤掉会顺手关掉他在其他 Workspace 的协作面。
            if req.presence == TargetPresence::Present {
                if let Err(r) = crate::service_api::audit_gate(&state).await {
                    return r;
                }
            }
            let transition = match (req.presence, req.scope) {
                (TargetPresence::Present, _) => sqlx::query!(
                    "update identity.buzz_identity_binding
                     set state = 'ACTIVE', version = version + 1
                     where tenant_id = $1 and pubkey = any($2)
                       and custody = 'SERVER' and state = 'RECONCILING'",
                    plan.tenant_id,
                    &plan.target_pubkeys,
                )
                .execute(&state.pool)
                .await
                .map(|_| ()),
                (TargetPresence::Absent, MembershipScope::Tenant) => sqlx::query!(
                    "update identity.buzz_identity_binding
                     set state = 'REVOKED', version = version + 1
                     where tenant_id = $1 and pubkey = any($2) and state <> 'REVOKED'",
                    plan.tenant_id,
                    &plan.target_pubkeys,
                )
                .execute(&state.pool)
                .await
                .map(|_| ()),
                (TargetPresence::Absent, MembershipScope::Workspace) => Ok(()),
            };
            if let Err(e) = transition {
                return unavailable(e);
            }
            (
                StatusCode::OK,
                Json(BuzzProjectionResponse {
                    converged: true,
                    target_pubkeys: plan.target_pubkeys,
                }),
            )
                .into_response()
        }
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
    tenant_id: Uuid,
    community_host: String,
    /// `None` 表示 relay 层 roster
    channel_id: Option<String>,
    target_pubkeys: Vec<String>,
    control_secret: SecretRef,
}

/// `Blocked` 区分确定的拒绝与依赖不可用，两者映射到不同 HTTP 状态，进而决定
/// 调用方重试与否。
async fn resolve(state: &ServiceState, req: &BuzzProjectionRequest) -> Result<Plan, Blocked> {
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
            .await?;
            let row = row.ok_or(Blocked::Refused(Refusal::NotFound(
                "TenantMembership 不存在或版本不符",
            )))?;
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
            .await?;
            let row = row.ok_or(Blocked::Refused(Refusal::NotFound(
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
    .await?
    .ok_or(Blocked::Refused(Refusal::Denied(
        "TenantBuzzBinding 不是 ACTIVE",
    )))?;

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
    .await?
    .ok_or(Blocked::Refused(Refusal::Denied(
        "CONTROL BuzzIdentityBinding 不可用于代签",
    )))?;

    // 三列由 custody_matches_secret_triple 保证同生共死，这里仍然显式解包：
    // 约束在库里，读取在这里，不靠「它应该非空」推进。
    let control_secret = SecretRef {
        locator: control
            .private_key_secret_ref
            .ok_or(Blocked::Refused(Refusal::Denied("CONTROL 密钥缺 locator")))?,
        version: control
            .private_key_secret_version
            .ok_or(Blocked::Refused(Refusal::Denied("CONTROL 密钥缺版本")))?
            as u32,
        audience: control
            .private_key_secret_audience
            .ok_or(Blocked::Refused(Refusal::Denied("CONTROL 密钥缺 audience")))?,
    };

    // 被投影的目标：该 Principal 的全部 Buzz pubkey（DD-77）。两种托管都要
    // 投影——撤权的执行点是 roster，与私钥在谁手里无关（DD-75、.design/10 §4）。
    //
    // 建立方向只投入仍在使用的钥匙：ACTIVE，以及尚在登记中的 RECONCILING。
    // REVOKING 的设备正在被移出，不能在这里被重新加回去。撤权方向覆盖全部
    // 非 REVOKED 的钥匙，包括登记中与撤销中的。
    let mut targets: Vec<String> = match req.presence {
        TargetPresence::Present => {
            sqlx::query_scalar!(
                "select pubkey from identity.buzz_identity_binding
             where tenant_id = $1 and principal_id = $2
               and state in ('RECONCILING', 'ACTIVE')
             order by pubkey",
                tenant_id,
                principal_id
            )
            .fetch_all(&state.pool)
            .await?
        }
        TargetPresence::Absent => {
            sqlx::query_scalar!(
                "select pubkey from identity.buzz_identity_binding
             where tenant_id = $1 and principal_id = $2 and state <> 'REVOKED'
             order by pubkey",
                tenant_id,
                principal_id
            )
            .fetch_all(&state.pool)
            .await?
        }
    };
    // Buzz Web 的 HUMAN 是 SERVER 托管（DD-75），建立方向上没有就现建；撤权方向
    // 上**不**建——REVOKED 的身份不复活，重新授权走新 binding（.design/10 §4）。
    if req.presence == TargetPresence::Present {
        let server = ensure_human_identity(state, tenant_id, principal_id).await?;
        if !targets.contains(&server) {
            targets.push(server);
        }
    }
    if targets.is_empty() {
        return Err(Blocked::Refused(Refusal::NotFound(
            "目标 Principal 没有可用的 BuzzIdentityBinding",
        )));
    }

    let channel_id = match workspace_id {
        None => None,
        Some(ws) => Some(
            sqlx::query!(
                "select channel_id from projection.workspace_buzz_binding
                 where workspace_id = $1 and state = 'ACTIVE'",
                ws
            )
            .fetch_optional(&state.pool)
            .await?
            .ok_or(Blocked::Refused(Refusal::Denied(
                "WorkspaceBuzzBinding 不是 ACTIVE",
            )))?
            .channel_id
            .to_string(),
        ),
    };

    Ok(Plan {
        tenant_id,
        community_host: binding.normalized_host,
        channel_id,
        target_pubkeys: targets,
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

/// 为一个 HUMAN Principal 建立 SERVER 托管的 Buzz 身份。
///
/// Buzz Web 的 HUMAN 由 Core 代签（`DD-75`），因此私钥写进 OpenBao、只留
/// SecretRef 三元组落库。原生端的 HUMAN 是 CLIENT 托管、本机持钥，它们的
/// binding 由端上注册 pubkey 建立，不走这条路径。
///
/// 状态直接给 `RECONCILING`：此刻只有 Core 侧的事实，roster 还没投影。把它置为
/// `ACTIVE` 要等 roster 查证通过——而那正是紧接着这一步要做的事。
pub(crate) async fn ensure_human_identity(
    state: &ServiceState,
    tenant_id: Uuid,
    principal_id: Uuid,
) -> Result<String, Blocked> {
    // 已有就用已有的：每人至多一条非 REVOKED 的 SERVER binding（DD-77）。
    // 先查再建，免得每次投影都往 OpenBao 写一把用不上的私钥。
    if let Some(pubkey) = sqlx::query_scalar!(
        "select pubkey from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2
           and custody = 'SERVER' and state <> 'REVOKED'",
        tenant_id,
        principal_id
    )
    .fetch_optional(&state.pool)
    .await?
    {
        return Ok(pubkey);
    }

    let keys = nostr::Keys::generate();
    let locator = format!(
        "{}/buzz-human/{tenant_id}/{principal_id}",
        state.secret_mount
    );
    let version = state
        .secrets
        .write(&locator, "value", &keys.secret_key().to_secret_hex())
        .await
        .map_err(|e| match e {
            // locator 与 audience 是配置：重试多少次都一样
            SecretError::LocatorMalformed(_) | SecretError::AudienceMismatch => {
                tracing::warn!(error = %e, "写 HUMAN 私钥被拒");
                Blocked::Refused(Refusal::Denied("HUMAN 私钥无法托管"))
            }
            _ => Blocked::Unavailable(format!("写 HUMAN 私钥：{e}")),
        })?;

    let pubkey = keys.public_key().to_hex();
    sqlx::query!(
        "insert into identity.buzz_identity_binding
             (tenant_id, principal_id, pubkey, custody, private_key_secret_ref,
              private_key_secret_version, private_key_secret_audience, kind, state)
         values ($1, $2, $3, 'SERVER', $4, $5, $6, 'HUMAN', 'RECONCILING')
         on conflict (tenant_id, principal_id)
             where custody = 'SERVER' and state <> 'REVOKED' do nothing",
        tenant_id,
        principal_id,
        pubkey,
        locator,
        version as i32,
        state.secret_audience,
    )
    .execute(&state.pool)
    .await?;

    // 并发下另一个请求可能先插入了。回读实际生效的那条，不用本地生成的值——
    // 用错 pubkey 会把 roster 投影投到一个谁也不持有的身份上。
    sqlx::query_scalar!(
        "select pubkey from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2
           and custody = 'SERVER' and state <> 'REVOKED'",
        tenant_id,
        principal_id
    )
    .fetch_one(&state.pool)
    .await
    .map_err(Blocked::from)
}
