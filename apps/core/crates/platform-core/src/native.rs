//! 只对原生端开放的入口（DD-78）。
//!
//! 请求是否来自原生端，只看网关投影的 `x-kailo-client-surface`：原生 listener 把
//! 它无条件设为 `native`，浏览器 listener 无条件移除它。客户端自报的同名 header
//! 在两条路上都到不了这里。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::{ErrorBody, ErrorClass, NativeCommunityFacts, ReasonCode};

use crate::bff::{resolve_execution_context, BffState};

const HEADER_CLIENT_SURFACE: &str = "x-kailo-client-surface";

/// 请求不是经原生 listener 到达的，就拒绝。
#[allow(clippy::result_large_err)]
pub fn require_native(headers: &HeaderMap) -> Result<(), Response> {
    if headers
        .get(HEADER_CLIENT_SURFACE)
        .and_then(|v| v.to_str().ok())
        == Some("native")
    {
        return Ok(());
    }
    Err((
        StatusCode::FORBIDDEN,
        Json(ErrorBody {
            class: ErrorClass::Denied,
            reason: ReasonCode::NativeSurfaceRequired,
            operation_id: None,
        }),
    )
        .into_response())
}

/// 本人所在 Tenant 的 Community 连接事实。
///
/// Buzz Web 永远拿不到它（DD-39）：Web 经 BFF 代签，不认识 Relay；原生端本机
/// 持钥直连 Relay（DD-75），需要知道连到哪里。地址的形态（scheme 与对外端口）是
/// 部署事实，由 `BUZZ_RELAY_NATIVE_URL_TEMPLATE` 给出，Community host 取自
/// ACTIVE 的 TenantBuzzBinding。地址的 authority 就是 Community host：Relay 按
/// 连接的 Host 绑定 Community（SF-BUZ-32），因此地址本身决定进入哪个 Community。
pub async fn community(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    if let Err(r) = require_native(&headers) {
        return r;
    }
    match sqlx::query_scalar!(
        "select normalized_host from projection.tenant_buzz_binding
         where tenant_id = $1 and state = 'ACTIVE'",
        ctx.tenant_id
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(host)) => (
            StatusCode::OK,
            Json(NativeCommunityFacts {
                relay_url: state.relay_native_url_template.replace("{host}", &host),
                community_host: host,
            }),
        )
            .into_response(),
        // 协作面尚未就绪：不给一个连不上或连错 Community 的地址
        Ok(None) => StatusCode::CONFLICT.into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "读 TenantBuzzBinding 失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}
