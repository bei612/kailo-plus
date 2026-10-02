//! BFF 表面（`01-工程结构与模块边界.md` §3）。
//!
//! 它只接受 AgentGateway 投影进来的内网身份 header，缺任一条即拒绝。
//! 调用方自报的 principal、pubkey、私钥、raw signed event 一律不接受
//! （`.design/09` 第 2 步）。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, MethodRouter},
    Json, Router,
};
use contracts::{
    ErrorBody, ErrorClass, PlatformSessionAccessMode, PlatformSessionView, ResolvedIdentity,
};

use crate::audit;
use identity::{resolve, session, IdentityError};
use sqlx::PgPool;
use uuid::Uuid;

/// 网关投影的两条 header。名字与 `SS-AGW-OIDC` 的 `set` 目标严格一致——
/// 改这里而不改网关配置会让整条链静默失效。
pub(crate) const HEADER_ISSUER: &str = "x-platform-oidc-issuer";
pub(crate) const HEADER_SUBJECT: &str = "x-platform-oidc-subject";

/// BFF 的运行状态。
#[derive(Clone)]
pub struct BffState {
    /// 部署配置下发的公开平台信息（DD-111），启动时校验，运行期不变
    pub platform_info: std::sync::Arc<contracts::PlatformInfo>,
    pub pool: PgPool,
    /// 设备公钥登记等用户动作要启动 ComponentTaskWorkflow（DD-79）
    pub temporal: std::sync::Arc<crate::temporal::TemporalClient>,
    /// 语义命令的准入、审批与派发（.design/05 §1）
    pub governance: std::sync::Arc<crate::governance::Governance>,
    /// 设备持钥证明（NIP-98 事件）`created_at` 与服务端时钟允许的最大偏差。
    /// 它限定了一份截获的证明还能被使用多久。
    pub client_key_proof_window_seconds: u64,
    /// 每人可同时登记的原生设备上界（DD-77）。超出是 LIMIT 类的确定拒绝。
    pub client_keys_per_principal: i64,
    /// 设备 binding 仍在收敛时，原生端再次查询前至少等待的时间。由服务端下发，
    /// Desktop/Mobile 不各自猜测投影速度。
    pub client_key_recheck_millis: i64,
    /// 原生端直连 Relay 的地址模板，含 `{host}` 占位（Community host）。
    pub relay_native_url_template: String,
    /// PlatformSession 的有效期。它是部署事实，不是常量——不同部署对「多久要
    /// 重新过一次 OIDC」的要求不同。
    pub session_ttl_seconds: i64,
    pub secrets: std::sync::Arc<secret_store::SecretStore>,
    pub http: reqwest::Client,
    /// Relay 的网络地址；Community host 另从 binding 取（SF-BUZ-32）
    pub relay_transport: String,
    /// 历史查询的单页上界。NIP-11 声明的 1000 是 Relay 的上限，不是平台该放行
    /// 的值——上界在 BFF 侧先行设定（`07` §5）。
    pub message_page_limit: i64,
    /// 按 (PlatformSession, Community host, pubkey) 复用的已认证 Relay 连接
    /// （`apps/02` Stage 1）。连接地址 `BUZZ_RELAY_WS_URL`、每条流的缓冲帧数
    /// `BFF_STREAM_BUFFER` 与建连认证上界 `BFF_STREAM_AUTH_TIMEOUT_SECONDS` 都在它里面。
    pub relay_sessions: std::sync::Arc<collab_bridge::stream::RelaySessions>,
    /// Core 自己的 Relay HTTP 调用预算（`apps/07` §5：BFF 侧先行设界）。数值是
    /// 部署登记值，不得高于 Relay 的 tier 额度（`.design/09`、`SF-BUZ-28`）。
    pub relay_budget: std::sync::Arc<collab_bridge::limits::ApiBudget>,
    /// 运行期 NIP-11：只有 digest 与 ACTIVE binding 快照一致时才采用其上界
    /// （`.design/03` §2、`.design/09`「BFF Relay 连接模型」）。
    pub relay_nip11: std::sync::Arc<collab_bridge::limits::Nip11Cache>,
    /// 单条消息正文的字节上界（`.design/09`：单 event content 不超过 256 KiB，
    /// `SF-BUZ-28`）。NIP-11 不声明它，因此是部署登记值；BFF 在发往 Relay 前预检。
    pub message_max_content_bytes: usize,
    /// 撤权对**已建立流**生效的上界。请求路径上撤权立刻生效，长连接靠这个
    /// 周期回头看——它是一个必须被说出来的时间窗，不是实现细节。
    pub stream_readmit_seconds: u64,
    /// 断线后浏览器重连前的等待，经 SSE `retry:` 下发。重连由浏览器的
    /// EventSource 自己做，间隔由服务端说了算——客户端里不写死任何时长。
    pub stream_retry_millis: u64,
    /// 单份媒体的上界。压力在 BFF 侧先行设界，不透传给 Relay（`07` §5）。
    pub media_max_bytes: u64,
}

/// 一次请求的执行身份。
///
/// 它只由网关投影的 issuer/subject 解析而来，且必须伴随一条 active
/// PlatformSession。任何 Browser 可控字段都不参与构造。
pub struct ExecutionContext {
    pub human_identity_id: Uuid,
    pub tenant_id: Uuid,
    pub tenant_principal_id: Uuid,
    pub session_id: Uuid,
    pub access_mode: PlatformSessionAccessMode,
}

/// 解析执行身份，失败即返回可直接下发的响应。
///
/// 每个业务端点都从这里开始。它不缓存：撤权要对**下一个**请求生效，而缓存的
/// 生命周期就是撤权失效的时间窗。
pub async fn resolve_execution_context(
    state: &BffState,
    headers: &HeaderMap,
) -> Result<ExecutionContext, Response> {
    let header = |name: &str| -> Option<&str> { headers.get(name).and_then(|v| v.to_str().ok()) };
    let identity = resolve(&state.pool, header(HEADER_ISSUER), header(HEADER_SUBJECT))
        .await
        .map_err(error_response)?;

    let (Ok(human), Ok(membership), Ok(tenant), Ok(principal)) = (
        identity.human_identity_id.parse(),
        identity.tenant_membership_id.parse(),
        identity.tenant_id.parse::<Uuid>(),
        identity.tenant_principal_id.parse::<Uuid>(),
    ) else {
        return Err(StatusCode::INTERNAL_SERVER_ERROR.into_response());
    };
    let s = session::ensure(&state.pool, human, membership, state.session_ttl_seconds)
        .await
        .map_err(error_response)?;
    Ok(ExecutionContext {
        human_identity_id: human,
        tenant_id: tenant,
        tenant_principal_id: principal,
        session_id: s.id,
        access_mode: PlatformSessionAccessMode::Full,
    })
}

/// DD-96：普通端点始终调用严格 resolver；只有生命周期治理与会话展示调用此处。
/// 该 release 未登记真实删除链时，暂停 Tenant 仍无入口。每次请求核当前成员与
/// 原生权限或该删除链的销毁前观察证据，不把模式本身作为授权凭证。
async fn lifecycle_identity(
    state: &BffState,
    headers: &HeaderMap,
) -> Result<(ResolvedIdentity, PlatformSessionAccessMode), Response> {
    let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
    let identity =
        identity::resolve_for_lifecycle(&state.pool, header(HEADER_ISSUER), header(HEADER_SUBJECT))
            .await
            .map_err(error_response)?;
    let tenant = identity
        .tenant_id
        .parse::<Uuid>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())?;
    let active = sqlx::query_scalar::<_, String>("select state from identity.tenant where id = $1")
        .bind(tenant)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| error_response(e.into()))?;
    if active == "ACTIVE" {
        return Ok((identity, PlatformSessionAccessMode::Full));
    }
    let registered = crate::capability_registry::action_exposed("tenant.delete")
        && sqlx::query_scalar::<_, bool>(
            "select exists (select 1 from catalog.action_definition where action_key = 'tenant.delete' and status = 'ACTIVE')",
        ).fetch_one(&state.pool).await.map_err(|e| error_response(e.into()))?;
    if !registered {
        return Err(error_response(IdentityError::TenantNotActive));
    }
    let principal = identity
        .tenant_principal_id
        .parse::<Uuid>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())?;
    // 不可逆删除已擦除原生角色时，仅同一删除链的持久观察证据仍可用于受限读取。
    // 普通 resolver 与审批/动作的 fresh 写准入不消费该证据。
    if lifecycle_owner_eligible(&state.governance, tenant, principal, None)
        .await
        .map_err(|e| e.respond(None))?
    {
        return Ok((identity, PlatformSessionAccessMode::LifecycleRestricted));
    }
    let check = state
        .governance
        .spicedb
        .check(
            "tenant",
            &identity.tenant_id,
            "manage",
            &identity.tenant_principal_id,
            crate::spicedb::Consistency::FullyConsistent,
        )
        .await
        .map_err(|e| crate::governance::Refusal::Unavailable(e.to_string()).respond(None))?;
    if !check.allowed {
        return Err(error_response(IdentityError::TenantNotActive));
    }
    Ok((identity, PlatformSessionAccessMode::LifecycleRestricted))
}

/// DD-96：冻结 owner 资格不是名单授权；销毁前核对当前投影，销毁后仅接受该链的
/// 原生观察证据，且每次请求仍锁定、核对当前 ACTIVE HUMAN 成员。
/// 会话查本 Tenant 的当前 snapshot；审批可见性只查该 ActionExecution 的同一 snapshot。
pub(crate) async fn lifecycle_owner_eligible(
    governance: &crate::governance::Governance,
    tenant: Uuid,
    principal: Uuid,
    action_execution_id: Option<Uuid>,
) -> Result<bool, crate::governance::Refusal> {
    let mut tx = governance.pool.begin().await?;
    if !crate::roles::lock_tenant(&mut tx, tenant).await?
        || !crate::agent_definition::active_owner(&mut tx, tenant, principal).await?
    {
        return Ok(false);
    }
    if crate::tenant_delete::lifecycle_reader_eligible(
        &mut tx,
        tenant,
        principal,
        action_execution_id,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(true);
    }
    let snapshots: Vec<serde_json::Value> = sqlx::query_scalar(
        "select s.resource_owner_versions || s.asset_owner_versions from admission.tenant_lifecycle_snapshot s
         join identity.tenant t on t.id = s.tenant_id
         join admission.action_execution ae on ae.id = s.action_execution_id
             and ae.tenant_id = s.tenant_id and ae.action_key = 'tenant.delete'
         where s.tenant_id = $1 and ($2::uuid is null or s.action_execution_id = $2)
           and ((t.state = 'SUSPENDED' and s.state = 'SUSPENDED' and s.tenant_version = t.version)
             or (t.state = 'DELETING' and s.state = 'DELETING' and s.tenant_version = t.version - 1))",
    )
    .bind(tenant)
    .bind(action_execution_id)
    .fetch_all(&mut *tx)
    .await?;
    let principal = principal.to_string();
    for snapshot in snapshots {
        let refs: Vec<contracts::AffectedOwnerRef> = serde_json::from_value(snapshot)
            .map_err(|e| crate::governance::Refusal::Unavailable(e.to_string()))?;
        let refs: Vec<_> = refs
            .into_iter()
            .filter(|owner| owner.owner_principal_id == principal)
            .collect();
        if !refs.is_empty()
            && crate::agent_definition::validate_frozen_owners(governance, &mut tx, tenant, &refs)
                .await?
        {
            tx.commit().await?;
            return Ok(true);
        }
    }
    Ok(false)
}

pub async fn resolve_lifecycle_execution_context(
    state: &BffState,
    headers: &HeaderMap,
) -> Result<ExecutionContext, Response> {
    let (identity, access_mode) = lifecycle_identity(state, headers).await?;
    let (Ok(human), Ok(membership), Ok(tenant), Ok(principal)) = (
        identity.human_identity_id.parse(),
        identity.tenant_membership_id.parse(),
        identity.tenant_id.parse(),
        identity.tenant_principal_id.parse(),
    ) else {
        return Err(StatusCode::INTERNAL_SERVER_ERROR.into_response());
    };
    let s = session::ensure_mode(
        &state.pool,
        human,
        membership,
        state.session_ttl_seconds,
        access_mode.clone(),
    )
    .await
    .map_err(error_response)?;
    Ok(ExecutionContext {
        human_identity_id: human,
        tenant_id: tenant,
        tenant_principal_id: principal,
        session_id: s.id,
        access_mode,
    })
}

/// 把库里的状态列读成契约枚举（ADR-02）。
///
/// 状态列的 CHECK 约束与 `contracts/enums/` 逐值相等由 `check.sh migrate` 保证，
/// 因此这里读不出来只有一种成因：库与契约漂移了。那是服务端缺陷，回 500 并记
/// 日志，不把一个客户端不认识的值下发出去。
#[allow(clippy::result_large_err)]
pub fn db_enum<T: serde::de::DeserializeOwned>(column: &str, value: &str) -> Result<T, Response> {
    serde_json::from_value(serde_json::Value::String(value.to_owned())).map_err(|_| {
        tracing::error!(column, value, "库中的状态值不在契约枚举内");
        StatusCode::INTERNAL_SERVER_ERROR.into_response()
    })
}

/// 所有用户可达业务路由都由同一份生成目录准入；healthz 不是业务能力。
trait ExposedRoute {
    fn exposed_route(self, path: &'static str, method: MethodRouter<BffState>) -> Self;
}

impl ExposedRoute for Router<BffState> {
    fn exposed_route(self, path: &'static str, method: MethodRouter<BffState>) -> Self {
        if crate::capability_registry::route_exposed(path) {
            self.route(path, method)
        } else {
            self
        }
    }
}

pub fn router(state: BffState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .exposed_route("/api/v1/session", get(current_session))
        // 公开平台信息（DD-111）：不解析身份，三端据此显示部署的产品名
        .exposed_route("/api/v1/platform-info", get(crate::platform_info::get))
        // SS-WEB-RELAY：Browser 只发类型化语义命令，不发 raw event、不发任意 filter
        .exposed_route(
            "/api/v1/workspaces/{workspace_id}/messages",
            get(crate::web_transport::query_messages).post(crate::web_transport::publish_message),
        )
        // 收藏/静音/已读：Core 是唯一权威，三端共用（DD-40）
        // 注销：必须在调用网关 logout **之前**。网关的 logout 是短路的，
        // 请求根本不到后端（SF-AGW-21），Core 无从得知注销发生过。
        .exposed_route("/api/v1/logout", axum::routing::post(logout))
        // SS-WEB-01 的三个内置管理页所需的只读视图
        .exposed_route(
            "/api/v1/workspaces",
            get(crate::platform_views::list_workspaces),
        )
        .exposed_route(
            "/api/v1/workspaces/{workspace_id}/members",
            get(crate::platform_views::list_members),
        )
        .exposed_route(
            "/api/v1/role-members",
            get(crate::platform_views::list_role_members),
        )
        .exposed_route(
            "/api/v1/role-workspaces",
            get(crate::platform_views::list_role_workspaces),
        )
        .exposed_route(
            "/api/v1/agent-definitions",
            get(crate::agent_definition::list),
        )
        .exposed_route("/api/v1/automations", get(crate::automation_query::list))
        .exposed_route(
            "/api/v1/automations/{resource_id}",
            get(crate::automation_query::get),
        )
        .exposed_route(
            "/api/v1/agent-definitions/{resource_id}",
            get(crate::agent_definition::get),
        )
        .exposed_route(
            "/api/v1/agent-installations",
            get(crate::agent_installation_query::list),
        )
        .exposed_route(
            "/api/v1/agent-installations/{resource_id}",
            get(crate::agent_installation_query::get),
        )
        // 未登记 exposure 的 Version 链不生成实际路由；read 也复用同一 BFF 身份。
        .exposed_route(
            "/api/v1/agent-versions/{asset_id}",
            get(crate::agent_version::get),
        )
        // DD-96：业务 Tenant 的暂停与恢复只由 Platform Catalog 会话管理
        .exposed_route(
            "/api/v1/platform/tenants",
            get(crate::platform_views::list_platform_tenants),
        )
        .exposed_route(
            "/api/v1/identity/legacy-secret-refs",
            get(crate::secret_ref_rehome::list_eligible),
        )
        .exposed_route("/api/v1/audit", get(crate::platform_views::list_own_audit))
        // 范围审计与证据解引用：每次按 scope 的 audit permission fresh 授权（DD-52）
        .exposed_route(
            "/api/v1/audit/events",
            get(crate::audit_views::list_scope_audit),
        )
        .exposed_route(
            "/api/v1/audit/events/{event_id}/evidence/{index}",
            get(crate::audit_views::dereference_evidence),
        )
        // 原生设备公钥（DD-77/79）：登记只对原生入口开放，查看与撤销两端都开放
        .exposed_route(
            crate::client_keys::REGISTER_PATH,
            get(crate::client_keys::list).post(crate::client_keys::register),
        )
        .exposed_route(
            "/api/v1/identity/client-keys/{pubkey}",
            axum::routing::delete(crate::client_keys::revoke),
        )
        // 原生端的 Community 连接事实（DD-75/78）；Web 拿不到
        .exposed_route("/api/v1/native/community", get(crate::native::community))
        .exposed_route("/api/v1/user-state", get(crate::user_state::get_user_state))
        .exposed_route(
            "/api/v1/user-state/workspaces/{workspace_id}",
            axum::routing::put(crate::user_state::put_workspace_preference),
        )
        // 媒体也经 BFF 代签读写（DD-39）；上界在 BFF 侧先行设定
        .exposed_route(
            "/api/v1/workspaces/{workspace_id}/media",
            axum::routing::post(crate::web_transport::upload_media),
        )
        .exposed_route(
            "/api/v1/workspaces/{workspace_id}/media/{sha256}",
            get(crate::web_transport::fetch_media),
        )
        .exposed_route(
            "/api/v1/workspaces/{workspace_id}/stream",
            get(crate::stream::open_stream),
        )
        .exposed_route(
            "/api/v1/user-state/read",
            axum::routing::put(crate::user_state::put_read_mark),
        )
        // 治理内核：语义命令、本人任务、待我审批与审批决定（.design/06 §9）。
        // 审批状态只经 Temporal Update 推进，这里没有改投影的端点（DD-47）
        .exposed_route(
            "/api/v1/actions",
            axum::routing::post(crate::governance_api::submit_action),
        )
        .exposed_route("/api/v1/tasks", get(crate::governance_api::list_tasks))
        .exposed_route(
            "/api/v1/tasks/{action_execution_id}",
            get(crate::governance_api::get_task),
        )
        .exposed_route(
            "/api/v1/approvals",
            get(crate::governance_api::list_pending_approvals),
        )
        .exposed_route(
            "/api/v1/approvals/{workflow_id}",
            get(crate::governance_api::get_approval),
        )
        .exposed_route(
            "/api/v1/approvals/{workflow_id}/decision",
            axum::routing::post(crate::governance_api::decide),
        )
        .exposed_route(
            "/api/v1/approvals/{workflow_id}/withdraw",
            axum::routing::post(crate::governance_api::withdraw),
        )
        // Tenant 成员邀请（DD-83）。签发与撤回走上面的语义命令；这里是管理视图与
        // 兑换。兑换与兑换进度不要求 PlatformSession：兑换者此刻还不是成员
        .exposed_route(
            "/api/v1/invitations",
            get(crate::invitation::list_invitations),
        )
        .exposed_route(
            "/api/v1/invitations/redeem",
            axum::routing::post(crate::invitation::redeem),
        )
        .exposed_route(
            "/api/v1/invitations/redemptions",
            get(crate::invitation::list_redemptions),
        )
        .with_state(state)
}

/// 健康检查不解析身份：它不返回任何业务事实。
async fn healthz() -> StatusCode {
    StatusCode::OK
}

async fn current_session(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let pool = &state.pool;
    // 只取这两条 header，不读请求体、查询串或任何 Browser 可控位置
    let header = |name: &str| -> Option<&str> { headers.get(name).and_then(|v| v.to_str().ok()) };
    let (issuer, subject) = (header(HEADER_ISSUER), header(HEADER_SUBJECT));

    match lifecycle_identity(&state, &headers).await {
        Ok((identity, access_mode)) => {
            // 会话在身份解析**之后**建立：解析不过就没有会话可用，撤权因此
            // 对下一个请求立刻生效，不需要等任何凭证过期（`.design/03` §4.1）。
            let (Ok(human), Ok(membership)) = (
                identity.human_identity_id.parse::<uuid::Uuid>(),
                identity.tenant_membership_id.parse::<uuid::Uuid>(),
            ) else {
                tracing::warn!("解析出的身份 ID 不是 UUID");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            };
            // 显示名是 HumanIdentity 自己的字段（`.design/03`），只用于界面上认出
            // 「这是我」；它不参与任何判定。取不到就是依赖不可用，照常 fail closed。
            let display_name = match sqlx::query_scalar!(
                "select display_name from identity.human_identity where id = $1",
                human
            )
            .fetch_one(pool)
            .await
            {
                Ok(n) => n,
                Err(e) => return error_response(IdentityError::Unavailable(e)),
            };
            match session::ensure_mode(
                pool,
                human,
                membership,
                state.session_ttl_seconds,
                access_mode.clone(),
            )
            .await
            {
                Ok(s) => (
                    StatusCode::OK,
                    Json(PlatformSessionView {
                        human_identity_id: identity.human_identity_id,
                        display_name,
                        tenant_id: identity.tenant_id,
                        tenant_membership_id: identity.tenant_membership_id,
                        tenant_principal_id: identity.tenant_principal_id,
                        platform_session_id: s.id.to_string(),
                        access_mode,
                        // 未选定 Workspace 时缺省，不写 null（contracts/README.md §1）
                        current_workspace_id: s.current_workspace_id.map(|w| w.to_string()),
                    }),
                )
                    .into_response(),
                // 会话建不起来就没有执行上下文可用——fail closed，不返回一个
                // 没有会话的身份让调用方以为可以继续
                Err(e) => error_response(e),
            }
        }
        Err(response) => {
            // 这里是 `.design/03` §9 允许 `tenant_id=NONE` 的那段边界：网关已经
            // 验过 OIDC，但 Core 还没解析出可用的 TenantMembership。拒绝必须留痕，
            // 否则「谁被挡在门外」这件事无处可查——而这恰恰是最需要查的。
            //
            // 依赖不可用不记：那不是一次身份判定，记下来会把运维故障混进拒绝审计。
            if let Err(e) = resolve(pool, issuer, subject).await {
                if !matches!(e, IdentityError::Unavailable(_)) {
                    record_denied_authentication(pool, issuer, subject, &e).await;
                }
            }
            response
        }
    }
}

/// 记一条被拒的认证。
///
/// 写失败只记日志：请求本身已经被拒，再因为审计写不进去返回另一个错误，会把
/// 一次正确的拒绝变成一次看起来像故障的响应。缺口由 §3 的审计缺口度量兜底。
async fn record_denied_authentication(
    pool: &PgPool,
    issuer: Option<&str>,
    subject: Option<&str>,
    e: &IdentityError,
) {
    let reason = e.reason();
    let code = serde_json::to_value(reason)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_else(|| "SESSION_NOT_ACTIVE".to_owned());

    // `tenant_id=NONE` 的认证事件必须以 HumanIdentity 或外部 subject 摘要归因
    // （DD-52）。header 缺失时两者都没有，这不是一条可成立的审计事实：请求照样拒绝，
    // 只记日志（网关未投影身份 header 是 SS-AGW-OIDC 链路上的基础设施信号），
    // 不以占位 evidence 凑出归因。
    let evidence = match (issuer, subject) {
        (Some(i), Some(s)) if !i.is_empty() && !s.is_empty() => {
            vec![audit::subject_evidence(i, s)]
        }
        _ => {
            tracing::warn!(reason = %code, "缺少身份 header 的请求已拒绝；无可归因主体，不写审计");
            return;
        }
    };

    // operation_id 在这段边界上没有上游来源：请求还没进入任何 Governed Action。
    // 每次拒绝各自成一条，event_key 因此也用它——同一次拒绝不会被重试写两遍，
    // 因为这条路径上根本没有重试。
    let operation_id = uuid::Uuid::new_v4();
    let entry = audit::AuditEntry {
        event_key: format!("auth-denied:{operation_id}"),
        tenant_id: None,
        workspace_id: None,
        operation_id,
        event_type: "AUTHENTICATION",
        human_identity_id: None,
        initiator_principal_id: None,
        actor_principal_id: None,
        action_key: "session.resolve",
        action_version: 1,
        component_type_key: "core",
        target_type: None,
        target_id: None,
        parameter_hash: "NONE",
        decision: "DENY",
        result_code: &code,
        result_exposure: "NONE",
        evidence_refs: evidence,
        correlation_id: operation_id,
    };

    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(err) => {
            tracing::warn!(error = %err, "认证拒绝审计未写入");
            return;
        }
    };
    if let Err(err) = audit::append(&mut tx, entry).await {
        tracing::warn!(error = %err, "认证拒绝审计未写入");
        return;
    }
    if let Err(err) = tx.commit().await {
        tracing::warn!(error = %err, "认证拒绝审计未提交");
    }
}

/// 把身份错误映射成 `06-工程基线规范.md` §4 的分类与 HTTP 状态。
///
/// `UNKNOWN` 不映射成 4xx：依赖不可用是结果不明，不是拒绝。把它写成拒绝
/// 会让可恢复故障在审计里变成永久否决。
fn error_response(e: IdentityError) -> Response {
    let class = e.class();
    let status = match class {
        // BLOCKED 同样不可重试：能力未开放，不是服务端故障
        ErrorClass::Denied | ErrorClass::Blocked => StatusCode::FORBIDDEN,
        // 依赖恢复后可重试
        ErrorClass::Precondition | ErrorClass::Unknown => StatusCode::SERVICE_UNAVAILABLE,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    // 错误体不携带业务正文、secret、原始 SQL 或依赖的内部细节
    tracing::warn!(error = %e, "identity resolution failed");
    let body = ErrorBody {
        class,
        reason: e.reason(),
        operation_id: None,
    };
    (status, Json(body)).into_response()
}

/// 撤销调用方自己的 PlatformSession。
///
/// `SS-AGW-OIDC` 把注销分成两半：网关清本地 cookie，平台在同一条成功路径上
/// 撤销 Core 会话并关闭 stream。顺序不能反——网关的 logout 是短路的，请求不到
/// 后端（`SF-AGW-21`），先调它就再也没机会告诉 Core。
///
/// 只撤调用方那一条会话：同一个人可能在另一台设备上还开着，注销一台不该把
/// 另一台踢掉。要踢全部是撤权，不是注销。
async fn logout(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    match session::revoke_one(&state.pool, ctx.session_id).await {
        Ok(revoked) => {
            // 已经撤过也是成功：注销是幂等的，重复调用不该报错。
            tracing::info!(session = %ctx.session_id, revoked, "注销");
            (
                StatusCode::OK,
                Json(serde_json::json!({ "revoked": revoked })),
            )
                .into_response()
        }
        Err(e) => {
            tracing::warn!(error = %e, "撤销会话失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}
