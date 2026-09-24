//! Worker → Core 的 service API（`01-工程结构与模块边界.md` §4）。
//!
//! 它与 BFF 分开监听。理由见 `service_auth`：网关整体转发给 BFF，同一 listener
//! 上的服务面等于对任何已登录用户开放。这里的调用方是 Application Worker，
//! 不是人，认证方式与授权含义都不同。
//!
//! service identity 只认证服务，不表达业务授权（`DD-37`）：这些 endpoint 写的
//! 是 Workflow 自己的投影，不代替任何 HUMAN/AGENT 的 permission 判定。

use std::sync::Arc;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde::Serialize;
use sqlx::PgPool;

use kailo_secrets::SecretStore;

use crate::service_auth::{ServiceAuth, ServiceAuthError};

#[derive(Clone)]
pub struct ServiceState {
    pub pool: PgPool,
    pub auth: Arc<ServiceAuth>,
    pub secrets: Arc<SecretStore>,
    /// Platform Catalog Tenant：RelayOperatorIdentity 挂在它下面（.design/09 第 3 步）
    pub catalog_tenant: uuid::Uuid,
    /// SecretRef locator 的前缀 `<namespace>/<mount>`
    pub secret_mount: String,
    /// 允许取用 secret 的 service identity
    pub secret_audience: String,
    /// Community host 的域部分。host 是签名权威（SF-BUZ-32），必须稳定可推导
    pub community_domain: String,
    /// Relay 的网络地址。它与 Community host 不是一回事：后者参与 NIP-98
    /// 签名并作为 Host 头，前者只用于建立连接（SF-BUZ-32）。
    pub relay_transport: String,
    /// 复用连接池。每次投影新建 Client 会让 TLS 与连接开销落在重试路径上。
    pub http: reqwest::Client,
    pub temporal: Arc<crate::temporal::TemporalClient>,
}

pub fn router(state: ServiceState) -> Router {
    Router::new()
        .route("/service/v1/task-projections", post(project_task_state))
        .route(
            "/service/v1/membership-projections/buzz",
            post(crate::membership_projection::project_buzz_roster),
        )
        .route(
            "/service/v1/memberships/state",
            post(crate::membership_state::transition_membership),
        )
        .route(
            "/service/v1/memberships/lifecycle",
            post(crate::membership_lifecycle::start_membership_lifecycle),
        )
        .route(
            "/service/v1/tenants/buzz-provision",
            post(crate::tenant_lifecycle::provision_tenant_buzz),
        )
        .route(
            "/service/v1/tenants/buzz-verify",
            post(crate::tenant_lifecycle::verify_tenant_buzz),
        )
        .route(
            "/service/v1/workspaces/buzz-provision",
            post(crate::tenant_lifecycle::provision_workspace_buzz),
        )
        // 原生设备公钥的 roster 投影（DD-79）
        .route(
            "/service/v1/identity-projections/buzz",
            post(crate::identity_projection::project_buzz_identity),
        )
        .route(
            "/service/v1/scopes/state",
            post(crate::scope_state::transition_scope),
        )
        .route(
            "/service/v1/scopes/lifecycle",
            post(crate::membership_lifecycle::start_scope_lifecycle),
        )
        // 搁浅实体的重跑：新 ActionExecution、新实体版本、新 workflow ID
        // （.design/06 §9、DD-48）
        .route(
            "/service/v1/tasks/rerun",
            post(crate::task_rerun::rerun_task),
        )
        .with_state(state)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTaskStateResponse {
    /// false 表示收到的是更旧或重复的事件，已按单调规则忽略。
    /// 这仍是成功：Activity 重试到达同一结果，不该被当成失败再重试。
    pub applied: bool,
    pub last_event_id: i64,
}

async fn project_task_state(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    // body 放在最后：axum 的 extractor 顺序要求消费 body 的放最末
    body: Result<Json<contracts::TaskStateReport>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(report)) = body else {
        // 请求体不合法是调用方的错，Activity 侧应列入 NonRetryableErrorTypes：
        // 同样的体重试多少次都一样（06 §5.1）。
        return StatusCode::BAD_REQUEST.into_response();
    };
    match crate::task_projection::apply(&state.pool, &report, false).await {
        Ok(Some(a)) => (
            StatusCode::OK,
            Json(ProjectTaskStateResponse {
                applied: a.applied,
                last_event_id: a.last_event_id,
            }),
        )
            .into_response(),
        // WorkflowRef 还没建：那是 Core 在 Start 之前的职责，Worker 不能替它建
        // （DD-48）。这是调用方错误，不重试。
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => unavailable(e),
    }
}

/// 依赖不可用是结果不明，不是拒绝。写成 4xx 会让可恢复故障在 Activity 侧
/// 被当作永久失败而不再重试。
pub(crate) fn unavailable(e: sqlx::Error) -> Response {
    tracing::warn!(error = %e, "service API 依赖不可用");
    StatusCode::SERVICE_UNAVAILABLE.into_response()
}

pub(crate) async fn authorize(state: &ServiceState, headers: &HeaderMap) -> Result<(), Response> {
    let header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    match state.auth.verify(header).await {
        Ok(caller) => {
            tracing::debug!(caller, "service API 调用已认证");
            Ok(())
        }
        // 密钥不可得是结果不明：IdP 暂时打不通不等于调用方没有权限。
        Err(ServiceAuthError::KeysUnavailable) => {
            Err(StatusCode::SERVICE_UNAVAILABLE.into_response())
        }
        Err(e) => {
            tracing::warn!(error = %e, "service API 认证失败");
            Err(StatusCode::UNAUTHORIZED.into_response())
        }
    }
}
