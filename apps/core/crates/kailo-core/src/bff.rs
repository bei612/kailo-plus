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
use kailo_identity::{resolve, IdentityError};
use sqlx::PgPool;

/// 网关投影的两条 header。名字与 `SS-AGW-OIDC` 的 `set` 目标严格一致——
/// 改这里而不改网关配置会让整条链静默失效。
const HEADER_ISSUER: &str = "x-kailo-oidc-issuer";
const HEADER_SUBJECT: &str = "x-kailo-oidc-subject";

pub fn router(pool: PgPool) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/api/v1/session", get(current_session))
        .with_state(pool)
}

/// 健康检查不解析身份：它不返回任何业务事实。
async fn healthz() -> StatusCode {
    StatusCode::OK
}

async fn current_session(State(pool): State<PgPool>, headers: HeaderMap) -> Response {
    // 只取这两条 header，不读请求体、查询串或任何 Browser 可控位置
    let header = |name: &str| -> Option<&str> { headers.get(name).and_then(|v| v.to_str().ok()) };

    match resolve(&pool, header(HEADER_ISSUER), header(HEADER_SUBJECT)).await {
        Ok(identity) => (StatusCode::OK, Json(identity)).into_response(),
        Err(e) => error_response(e),
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
