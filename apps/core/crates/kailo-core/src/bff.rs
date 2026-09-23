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
use contracts::{ErrorBody, ErrorClass, ReasonCode};

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
        .route("/api/v1/user-state", get(crate::user_state::get_user_state))
        .route(
            "/api/v1/user-state/workspaces/{workspace_id}",
            axum::routing::put(crate::user_state::put_workspace_preference),
        )
        .route(
            "/api/v1/user-state/read",
            axum::routing::put(crate::user_state::put_read_mark),
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
                identity.human_identity_id.parse(),
                identity.tenant_membership_id.parse(),
            ) else {
                tracing::warn!("解析出的身份 ID 不是 UUID");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            };
            match session::ensure(pool, human, membership, state.session_ttl_seconds).await {
                Ok(s) => (
                    StatusCode::OK,
                    Json(serde_json::json!({
                        "humanIdentityId": identity.human_identity_id,
                        "tenantId": identity.tenant_id,
                        "tenantMembershipId": identity.tenant_membership_id,
                        "tenantPrincipalId": identity.tenant_principal_id,
                        "platformSessionId": s.id,
                        "currentWorkspaceId": s.current_workspace_id,
                    })),
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
    let reason = e.reason().unwrap_or(ReasonCode::SessionNotActive);
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
        ErrorClass::Denied => StatusCode::FORBIDDEN,
        ErrorClass::Unknown => StatusCode::SERVICE_UNAVAILABLE,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    // 错误体不携带业务正文、secret、原始 SQL 或依赖的内部细节
    tracing::warn!(error = %e, "identity resolution failed");
    let body = ErrorBody {
        class,
        reason: e.reason().unwrap_or(ReasonCode::SessionNotActive),
        operation_id: None,
    };
    (status, Json(body)).into_response()
}
