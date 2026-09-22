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
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use kailo_secrets::SecretStore;

use crate::service_auth::{ServiceAuth, ServiceAuthError};

#[derive(Clone)]
pub struct ServiceState {
    pub pool: PgPool,
    pub auth: Arc<ServiceAuth>,
    pub secrets: Arc<SecretStore>,
    /// Relay 的网络地址。它与 Community host 不是一回事：后者参与 NIP-98
    /// 签名并作为 Host 头，前者只用于建立连接（SF-BUZ-32）。
    pub relay_transport: String,
    /// 复用连接池。每次投影新建 Client 会让 TLS 与连接开销落在重试路径上。
    pub http: reqwest::Client,
}

pub fn router(state: ServiceState) -> Router {
    Router::new()
        .route("/service/v1/task-projections", post(project_task_state))
        .route(
            "/service/v1/membership-projections/buzz",
            post(crate::membership_projection::project_buzz_roster),
        )
        .with_state(state)
}

/// `ProjectTaskState` 的请求体（`.design/06` §3.1）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTaskStateRequest {
    pub workflow_id: String,
    pub run_id: String,
    /// history 事件序号。去重与排序都按它，不按到达顺序——Activity 会重试，
    /// 也会乱序到达。
    pub event_id: i64,
    pub status: String,
    pub waiting_reason: Option<String>,
    pub progress: Option<String>,
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
    body: Result<Json<ProjectTaskStateRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        // 请求体不合法是调用方的错，Activity 侧应列入 NonRetryableErrorTypes：
        // 同样的体重试多少次都一样（06 §5.1）。
        return StatusCode::BAD_REQUEST.into_response();
    };

    // 单调 upsert：只有更大的 event_id 才覆盖。`applied` 直接取决于这次写是否
    // 真的更新了行——用返回的 last_event_id 与请求比对，不靠 rows_affected，
    // 因为 ON CONFLICT DO UPDATE 的 WHERE 不成立时不返回行。
    let updated = sqlx::query!(
        r#"
        insert into projection.task_projection
            (workflow_id, run_id, last_event_id, status, waiting_reason, progress, updated_at)
        values ($1, $2, $3, $4, $5, $6, now())
        on conflict (workflow_id) do update set
            run_id         = excluded.run_id,
            last_event_id  = excluded.last_event_id,
            status         = excluded.status,
            waiting_reason = excluded.waiting_reason,
            progress       = excluded.progress,
            updated_at     = now()
        where projection.task_projection.last_event_id < excluded.last_event_id
        returning last_event_id
        "#,
        req.workflow_id,
        req.run_id,
        req.event_id,
        req.status,
        req.waiting_reason,
        req.progress,
    )
    .fetch_optional(&state.pool)
    .await;

    match updated {
        Ok(Some(row)) => (
            StatusCode::OK,
            Json(ProjectTaskStateResponse {
                applied: true,
                last_event_id: row.last_event_id,
            }),
        )
            .into_response(),
        // 没有返回行只有一种可能：已存在的 last_event_id 不小于本次。
        // 回读它并按幂等成功返回，让调用方知道权威值是什么。
        Ok(None) => match sqlx::query!(
            "select last_event_id from projection.task_projection where workflow_id = $1",
            req.workflow_id
        )
        .fetch_optional(&state.pool)
        .await
        {
            Ok(Some(row)) => (
                StatusCode::OK,
                Json(ProjectTaskStateResponse {
                    applied: false,
                    last_event_id: row.last_event_id,
                }),
            )
                .into_response(),
            // 行不存在说明 WorkflowRef 还没建；那是 Core 在 Start 之前的职责，
            // Worker 不能替它建（DD-48）。这是调用方错误，不重试。
            Ok(None) => StatusCode::NOT_FOUND.into_response(),
            Err(e) => unavailable(e),
        },
        Err(sqlx::Error::Database(e)) if e.is_foreign_key_violation() => {
            StatusCode::NOT_FOUND.into_response()
        }
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
