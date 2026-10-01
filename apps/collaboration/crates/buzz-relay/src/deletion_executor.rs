//! Private transport for the upstream whole-community deletion engine.
//!
//! This router is served only by a distinct deployment-private listener. It
//! reuses the normal operator origin, NIP-98 payload binding, allowlist and
//! replay domain. There are deliberately no abort, unblock, or sweep routes.

use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{OriginalUri, Path, Query, State},
    http::{HeaderMap, StatusCode, Uri},
    response::Json,
    routing::{get, post},
    Router,
};
use buzz_db::deletion::{DeletionInspection, DeletionRequest};
use buzz_deletion::DeletionExecutor;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    api::{api_error, internal_error, operator::authorize_operator_request},
    AppState,
};

type ApiResult<T> = Result<Json<T>, (StatusCode, Json<Value>)>;

#[derive(Clone)]
struct ExecutorState {
    relay: Arc<AppState>,
    executor: DeletionExecutor,
    shutdown: CancellationToken,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SubmitRequest {
    host: String,
    requested_by: Uuid,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ApproveRequest {
    expected_inventory_digest: String,
    approved_by: Uuid,
}

#[derive(Deserialize)]
struct ListQuery {
    host: String,
}

/// Construct the private router and its process-owned execution tracker.
/// The caller must not merge this router into the public relay router.
pub fn build_router(
    relay: Arc<AppState>,
    shutdown: CancellationToken,
) -> (Router, DeletionExecutor) {
    let executor = DeletionExecutor::new(
        &relay.db,
        Arc::clone(&relay.media_storage),
        relay.redis_pool.clone(),
        shutdown.clone(),
    );
    let state = ExecutorState {
        relay,
        executor: executor.clone(),
        shutdown,
    };
    let router = Router::new()
        .route("/operator/deletions", post(submit).get(list))
        .route("/operator/deletions/{id}", get(inspect))
        .route("/operator/deletions/{id}/approve", post(approve))
        .route("/operator/deletions/{id}/run", post(run))
        .with_state(state);
    (router, executor)
}

async fn authorize(
    state: &ExecutorState,
    headers: &HeaderMap,
    method: &str,
    uri: &Uri,
    body: Option<&[u8]>,
) -> Result<(), (StatusCode, Json<Value>)> {
    authorize_operator_request(&state.relay, headers, method, uri.path(), uri.query(), body)
        .await?;
    if state.shutdown.is_cancelled() {
        return Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "deletion executor is draining",
        ));
    }
    Ok(())
}

fn service_result<T: Serialize>(result: anyhow::Result<T>) -> ApiResult<T> {
    match result {
        Ok(value) => Ok(Json(value)),
        Err(error) => match error.downcast_ref::<buzz_db::DbError>() {
            Some(buzz_db::DbError::NotFound(_)) => Err(api_error(
                StatusCode::NOT_FOUND,
                "deletion request not found",
            )),
            Some(buzz_db::DbError::DeletionSafety(_)) => Err(api_error(
                StatusCode::CONFLICT,
                "deletion precondition not satisfied",
            )),
            _ => {
                // Dependency errors can contain credentials or object keys.
                tracing::error!(
                    "private deletion executor dependency failed; inspect native evidence"
                );
                Err(internal_error(
                    "deletion executor unavailable; result requires reconciliation",
                ))
            }
        },
    }
}

async fn submit(
    State(state): State<ExecutorState>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<DeletionRequest> {
    authorize(&state, &headers, "POST", &uri, Some(&body)).await?;
    let request: SubmitRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid deletion submit request"))?;
    if request.host.trim().is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "community host is required",
        ));
    }
    service_result(
        state
            .executor
            .submit(request.host.trim(), &request.requested_by.to_string(), None)
            .await,
    )
}

async fn list(
    State(state): State<ExecutorState>,
    OriginalUri(uri): OriginalUri,
    Query(query): Query<ListQuery>,
    headers: HeaderMap,
) -> ApiResult<Vec<DeletionRequest>> {
    authorize(&state, &headers, "GET", &uri, None).await?;
    if query.host.trim().is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "community host is required",
        ));
    }
    service_result(state.executor.list(query.host.trim()).await)
}

async fn inspect(
    State(state): State<ExecutorState>,
    OriginalUri(uri): OriginalUri,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> ApiResult<DeletionInspection> {
    authorize(&state, &headers, "GET", &uri, None).await?;
    service_result(state.executor.inspect(id).await)
}

async fn approve(
    State(state): State<ExecutorState>,
    OriginalUri(uri): OriginalUri,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<DeletionRequest> {
    authorize(&state, &headers, "POST", &uri, Some(&body)).await?;
    let request: ApproveRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid deletion approval request"))?;
    service_result(
        state
            .executor
            .approve(
                id,
                &request.expected_inventory_digest,
                &request.approved_by.to_string(),
            )
            .await,
    )
}

async fn run(
    State(state): State<ExecutorState>,
    OriginalUri(uri): OriginalUri,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<DeletionInspection> {
    authorize(&state, &headers, "POST", &uri, Some(&body)).await?;
    if !body.is_empty()
        && serde_json::from_slice::<Value>(&body).ok() != Some(serde_json::json!({}))
    {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "deletion run accepts only an empty request",
        ));
    }
    service_result(state.executor.run(id).await)
}
