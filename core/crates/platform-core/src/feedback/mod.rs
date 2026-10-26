//! DD-158: private feedback to this deployment's operator, never Relay or third-party mail.
mod input;
mod operator;

use axum::{
    extract::{rejection::JsonRejection, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Utc};
use serde_json::json;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::{
    audit::{AuditEntry, Evidence},
    bff::{resolve_execution_context, BffState, ExecutionContext},
};
pub(crate) use input::MAX_REQUEST_BYTES;
use input::{Input, Request};
pub use operator::{attachment, list, triage};

fn unavailable() -> Response {
    StatusCode::SERVICE_UNAVAILABLE.into_response()
}
fn receipt(id: Uuid, created: DateTime<Utc>) -> Response {
    (
        [("cache-control", "no-store")],
        Json(json!({"feedbackId":id,"createdAt":created})),
    )
        .into_response()
}

async fn eligible(
    tx: &mut Transaction<'_, Postgres>,
    ctx: &ExecutionContext,
) -> Result<(), Response> {
    let active = sqlx::query_scalar::<_, bool>(
        "select state='ACTIVE' from identity.tenant where id=$1 for update",
    )
    .bind(ctx.tenant_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| unavailable())?
    .unwrap_or(false);
    if !active
        || !crate::agent_definition::active_owner(tx, ctx.tenant_id, ctx.tenant_principal_id)
            .await
            .map_err(|_| unavailable())?
    {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    Ok(())
}

/// Metadata only: the fixed result code records category/client/consent presence, not content.
struct Metadata<'a> {
    client: &'a str,
    category: Option<&'a str>,
    diagnostics: bool,
    attachment: bool,
}
async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    ctx: &ExecutionContext,
    id: Uuid,
    operation: Uuid,
    action: &str,
    metadata: Metadata<'_>,
) -> Result<(), sqlx::Error> {
    let Metadata {
        client,
        category,
        diagnostics,
        attachment,
    } = metadata;
    let code = format!(
        "FEEDBACK_{}_{}_D{}_A{}",
        client,
        category.unwrap_or("NONE"),
        u8::from(diagnostics),
        u8::from(attachment)
    );
    let hash = hex::encode(sha2::Sha256::digest(code.as_bytes()));
    crate::audit::append(
        tx,
        AuditEntry {
            event_key: format!("{action}:{operation}:{id}"),
            tenant_id: Some(ctx.tenant_id),
            workspace_id: None,
            operation_id: operation,
            event_type: if action.contains("read") {
                "ACCESS"
            } else {
                "OUTCOME"
            },
            human_identity_id: Some(ctx.human_identity_id),
            initiator_principal_id: Some(ctx.tenant_principal_id),
            actor_principal_id: Some(ctx.tenant_principal_id),
            action_key: action,
            action_version: 1,
            component_type_key: "core",
            target_type: Some("FEEDBACK_SUBMISSION"),
            target_id: Some(id),
            parameter_hash: &hash,
            decision: "ALLOW",
            result_code: &code,
            result_exposure: "NONE",
            evidence_refs: vec![Evidence::new(
                contracts::EvidenceKind::PlatformSessionId,
                ctx.session_id,
            )],
            correlation_id: operation,
        },
    )
    .await
}
use sha2::Digest;

pub async fn submit(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: Result<Json<Request>, JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let Ok(Json(request)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let input = match input::validate(request) {
        Ok(i) => i,
        Err(()) => return StatusCode::BAD_REQUEST.into_response(),
    };
    match submit_inner(&state.pool, &ctx, input).await {
        Ok(r) | Err(r) => r,
    }
}

async fn submit_inner(
    pool: &sqlx::PgPool,
    ctx: &ExecutionContext,
    input: Input,
) -> Result<Response, Response> {
    let mut tx = pool.begin().await.map_err(|_| unavailable())?;
    // The principal lock serializes both idempotency and the per-person count. Every replay
    // still requires current active membership; it cannot recover data after revocation.
    eligible(&mut tx, ctx).await?;
    let prior: Option<(Uuid, String, DateTime<Utc>)> = sqlx::query_as(
        "select id,parameter_hash,created_at from support.feedback_submission
         where tenant_id=$1 and principal_id=$2 and idempotency_key=$3",
    )
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .bind(input.key)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| unavailable())?;
    if let Some((id, hash, created)) = prior {
        return if hash == input.parameter_hash {
            Ok(receipt(id, created))
        } else {
            Err(StatusCode::CONFLICT.into_response())
        };
    }
    let (hour, day, retry): (i64, i64, i64) = sqlx::query_as(
        "select count(*) filter(where created_at>now()-interval '1 hour'), count(*),
         greatest(1,ceil(extract(epoch from least(
           coalesce(min(created_at) filter(where created_at>now()-interval '1 hour')+interval '1 hour',now()+interval '1 hour'),
           coalesce(min(created_at)+interval '1 day',now()+interval '1 day'))-now())))::bigint
         from support.feedback_submission where tenant_id=$1 and principal_id=$2 and created_at>now()-interval '1 day'")
        .bind(ctx.tenant_id).bind(ctx.tenant_principal_id).fetch_one(&mut *tx).await.map_err(|_| unavailable())?;
    if hour >= 10 || day >= 50 {
        // Retry-After must cover the exhausted window, including the daily limit.
        let retry = if day >= 50 { 86400 } else { retry };
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            [("retry-after", retry.to_string())],
        )
            .into_response());
    }
    let id = Uuid::new_v4();
    let created: DateTime<Utc> = sqlx::query_scalar(
        "insert into support.feedback_submission(id,tenant_id,principal_id,idempotency_key,parameter_hash,
          client,category,message,diagnostics,attachment,attachment_mime,attachment_sha256)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning created_at")
        .bind(id).bind(ctx.tenant_id).bind(ctx.tenant_principal_id).bind(input.key).bind(&input.parameter_hash)
        .bind(&input.client).bind(&input.category).bind(&input.message).bind(&input.diagnostics)
        .bind(&input.bytes).bind(&input.mime).bind(&input.sha256).fetch_one(&mut *tx).await.map_err(|_| unavailable())?;
    audit(
        &mut tx,
        ctx,
        id,
        id,
        "feedback.submit",
        Metadata {
            client: &input.client,
            category: input.category.as_deref(),
            diagnostics: input.diagnostics.is_some(),
            attachment: input.bytes.is_some(),
        },
    )
    .await
    .map_err(|_| unavailable())?;
    tx.commit().await.map_err(|_| unavailable())?;
    Ok(receipt(id, created))
}

pub(crate) fn spawn_cleanup(pool: sqlx::PgPool) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(3600));
        loop {
            tick.tick().await;
            if sqlx::query("delete from support.feedback_submission where id in
                (select id from support.feedback_submission where state='CLOSED' and updated_at<now()-interval '180 days'
                 order by updated_at limit 500)").execute(&pool).await.is_err() {
                tracing::warn!("清理过期已关闭反馈失败");
            }
        }
    });
}

#[cfg(test)]
mod tests;
