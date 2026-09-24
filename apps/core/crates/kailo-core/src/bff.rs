//! BFF 表面（`01-工程结构与模块边界.md` §3）。
//!
//! 它只接受 AgentGateway 投影进来的内网身份 header，缺任一条即拒绝。
//! 调用方自报的 principal、pubkey、私钥、raw signed event 一律不接受
//! （`.design/09` 第 2 步）。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use contracts::{ErrorBody, ErrorClass, PlatformSessionView};

use crate::audit;
use kailo_identity::{resolve, session, IdentityError};
use sqlx::PgPool;
use uuid::Uuid;

/// 网关投影的两条 header。名字与 `SS-AGW-OIDC` 的 `set` 目标严格一致——
/// 改这里而不改网关配置会让整条链静默失效。
const HEADER_ISSUER: &str = "x-kailo-oidc-issuer";
const HEADER_SUBJECT: &str = "x-kailo-oidc-subject";

/// BFF 的运行状态。
#[derive(Clone)]
pub struct BffState {
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
    /// 原生端直连 Relay 的地址模板，含 `{host}` 占位（Community host）。
    pub relay_native_url_template: String,
    /// PlatformSession 的有效期。它是部署事实，不是常量——不同部署对「多久要
    /// 重新过一次 OIDC」的要求不同。
    pub session_ttl_seconds: i64,
    pub secrets: std::sync::Arc<kailo_secrets::SecretStore>,
    pub http: reqwest::Client,
    /// Relay 的网络地址；Community host 另从 binding 取（SF-BUZ-32）
    pub relay_transport: String,
    /// 历史查询的单页上界。NIP-11 声明的 1000 是 Relay 的上限，不是平台该放行
    /// 的值——上界在 BFF 侧先行设定（`07` §5）。
    pub message_page_limit: i64,
    /// Relay 的 WebSocket 地址。与 HTTP transport 分开配置：两者在部署里
    /// 可能经不同的入口，而 Community host 都另从 binding 取。
    pub relay_ws_url: String,
    /// 单条流的缓冲帧数。满了对上游形成背压而不是丢帧——丢帧会让客户端
    /// 以为自己看到了完整序列。
    pub stream_buffer: usize,
    /// 连上 Relay 后等 NIP-42 challenge 的上界。对端连上却不发 challenge 时，
    /// 流以可处理的失败结束，而不是永远挂着。
    pub stream_auth_timeout_seconds: u64,
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
        .map_err(|e| error_response(IdentityError::Unavailable(e)))?;
    Ok(ExecutionContext {
        human_identity_id: human,
        tenant_id: tenant,
        tenant_principal_id: principal,
        session_id: s.id,
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

pub fn router(state: BffState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/api/v1/session", get(current_session))
        // SS-WEB-RELAY：Browser 只发类型化语义命令，不发 raw event、不发任意 filter
        .route(
            "/api/v1/workspaces/{workspace_id}/messages",
            get(crate::web_transport::query_messages).post(crate::web_transport::publish_message),
        )
        // 收藏/静音/已读：Core 是唯一权威，三端共用（DD-40）
        // 注销：必须在调用网关 logout **之前**。网关的 logout 是短路的，
        // 请求根本不到后端（SF-AGW-21），Core 无从得知注销发生过。
        .route("/api/v1/logout", axum::routing::post(logout))
        // SS-WEB-01 的三个内置管理页所需的只读视图
        .route(
            "/api/v1/workspaces",
            get(crate::platform_views::list_workspaces),
        )
        .route(
            "/api/v1/workspaces/{workspace_id}/members",
            get(crate::platform_views::list_members),
        )
        .route("/api/v1/audit", get(crate::platform_views::list_own_audit))
        // 原生设备公钥（DD-77/79）：登记只对原生入口开放，查看与撤销两端都开放
        .route(
            crate::client_keys::REGISTER_PATH,
            get(crate::client_keys::list).post(crate::client_keys::register),
        )
        .route(
            "/api/v1/identity/client-keys/{pubkey}",
            axum::routing::delete(crate::client_keys::revoke),
        )
        // 原生端的 Community 连接事实（DD-75/78）；Web 拿不到
        .route("/api/v1/native/community", get(crate::native::community))
        .route("/api/v1/user-state", get(crate::user_state::get_user_state))
        .route(
            "/api/v1/user-state/workspaces/{workspace_id}",
            axum::routing::put(crate::user_state::put_workspace_preference),
        )
        // 媒体也经 BFF 代签读写（DD-39）；上界在 BFF 侧先行设定
        .route(
            "/api/v1/workspaces/{workspace_id}/media",
            axum::routing::post(crate::web_transport::upload_media),
        )
        .route(
            "/api/v1/workspaces/{workspace_id}/media/{sha256}",
            get(crate::web_transport::fetch_media),
        )
        .route(
            "/api/v1/workspaces/{workspace_id}/stream",
            get(crate::stream::open_stream),
        )
        .route(
            "/api/v1/user-state/read",
            axum::routing::put(crate::user_state::put_read_mark),
        )
        // 治理内核：语义命令、本人任务、待我审批与审批决定（.design/06 §9）。
        // 审批状态只经 Temporal Update 推进，这里没有改投影的端点（DD-47）
        .route(
            "/api/v1/actions",
            axum::routing::post(crate::governance_api::submit_action),
        )
        .route("/api/v1/tasks", get(crate::governance_api::list_tasks))
        .route(
            "/api/v1/tasks/{action_execution_id}",
            get(crate::governance_api::get_task),
        )
        .route(
            "/api/v1/approvals",
            get(crate::governance_api::list_pending_approvals),
        )
        .route(
            "/api/v1/approvals/{workflow_id}",
            get(crate::governance_api::get_approval),
        )
        .route(
            "/api/v1/approvals/{workflow_id}/decision",
            axum::routing::post(crate::governance_api::decide),
        )
        .route(
            "/api/v1/approvals/{workflow_id}/withdraw",
            axum::routing::post(crate::governance_api::withdraw),
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

    match resolve(pool, issuer, subject).await {
        Ok(identity) => {
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
            match session::ensure(pool, human, membership, state.session_ttl_seconds).await {
                Ok(s) => (
                    StatusCode::OK,
                    Json(PlatformSessionView {
                        human_identity_id: identity.human_identity_id,
                        display_name,
                        tenant_id: identity.tenant_id,
                        tenant_membership_id: identity.tenant_membership_id,
                        tenant_principal_id: identity.tenant_principal_id,
                        platform_session_id: s.id.to_string(),
                        // 未选定 Workspace 时缺省，不写 null（contracts/README.md §1）
                        current_workspace_id: s.current_workspace_id.map(|w| w.to_string()),
                    }),
                )
                    .into_response(),
                // 会话建不起来就没有执行上下文可用——fail closed，不返回一个
                // 没有会话的身份让调用方以为可以继续
                Err(e) => error_response(IdentityError::Unavailable(e)),
            }
        }
        Err(e) => {
            // 这里是 `.design/03` §9 允许 `tenant_id=NONE` 的那段边界：网关已经
            // 验过 OIDC，但 Core 还没解析出可用的 TenantMembership。拒绝必须留痕，
            // 否则「谁被挡在门外」这件事无处可查——而这恰恰是最需要查的。
            //
            // 依赖不可用不记：那不是一次身份判定，记下来会把运维故障混进拒绝审计。
            if !matches!(e, IdentityError::Unavailable(_)) {
                record_denied_authentication(pool, issuer, subject, &e).await;
            }
            error_response(e)
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

    // header 缺失时没有可摘要的 subject。此时用固定占位 evidence：这段边界要求
    // 「human_identity 或不可逆 subject hash 至少有一个」，而「没带任何身份
    // header」本身就是需要留痕的事实。
    let evidence = match (issuer, subject) {
        (Some(i), Some(s)) if !i.is_empty() && !s.is_empty() => audit::subject_evidence(i, s),
        _ => serde_json::json!([{ "kind": "IDENTITY_HEADER_MISSING" }]),
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
/// `SS-AGW-OIDC` 把注销分成两半：网关清本地 cookie，Kailo 在同一条成功路径上
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
