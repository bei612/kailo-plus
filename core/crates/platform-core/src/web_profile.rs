//! Own NIP-01 metadata, through the original BFF collaboration transport (DD-39/75/80/81).
//! Buzz owns the profile. Core stores only the original publish intent/event ID and audit.
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use collab_bridge::bridge::{Custody, Delivery, IdentityClient};
use contracts::{ErrorClass, EvidenceKind, ReasonCode, WebProfileUpdateRequest, WebProfileView};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    audit::{append, AuditEntry, Evidence},
    bff::{resolve_execution_context, BffState, ExecutionContext},
    web_transport::{
        actor_keys, community_limits, error_body, limit_response, record, relay_error_response,
        PublishResponse,
    },
};

pub(crate) const PROFILE_ACTION: &str = "identity.profile.publish";

fn unavailable() -> Response {
    error_body(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorClass::Precondition,
        ReasonCode::DependencyUnavailable,
        None,
    )
}

async fn client(
    state: &BffState,
    ctx: &ExecutionContext,
) -> Result<(IdentityClient, String), Response> {
    let host: Option<String> = sqlx::query_scalar(
        "select b.normalized_host from projection.tenant_buzz_binding b
         join identity.tenant t on t.id=b.tenant_id and t.state='ACTIVE'
         where b.tenant_id=$1 and b.state='ACTIVE'",
    )
    .bind(ctx.tenant_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| unavailable())?;
    let host = host.ok_or_else(|| {
        error_body(
            StatusCode::SERVICE_UNAVAILABLE,
            ErrorClass::Precondition,
            ReasonCode::BindingNotActive,
            None,
        )
    })?;
    community_limits(state, &host)
        .await
        .map_err(IntoResponse::into_response)?;
    let keys = actor_keys(state, ctx).await?;
    let client = IdentityClient::new(
        Custody::Server,
        &keys.secret_key().to_secret_hex(),
        &state.relay_transport,
        &host,
    )
    .map_err(|_| unavailable())?
    .with_budget(state.relay_budget.clone());
    Ok((client, host))
}

/// A successful query must be a verified own kind:0, not an arbitrary row supplied
/// by the browser or a malformed Relay response. Empty is a real missing profile.
fn profile_event(value: Value, author: &str) -> Result<Option<nostr::Event>, ()> {
    let rows = value.as_array().ok_or(())?;
    if rows.len() > 1 {
        return Err(());
    }
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let event: nostr::Event = serde_json::from_value(row.clone()).map_err(|_| ())?;
    if event.kind.as_u16() != 0 || event.pubkey.to_hex() != author || event.verify().is_err() {
        return Err(());
    }
    let content: Value = serde_json::from_str(&event.content).map_err(|_| ())?;
    if !content.is_object() {
        return Err(());
    }
    Ok(Some(event))
}

async fn read(state: &BffState, client: &IdentityClient) -> Result<Option<nostr::Event>, Response> {
    let value = client
        .query(
            &state.http,
            &[json!({"kinds":[0], "authors":[client.pubkey_hex()], "limit":1})],
        )
        .await
        .map_err(|e| relay_error_response(&e, None))?;
    profile_event(value, &client.pubkey_hex()).map_err(|_| unavailable())
}

pub(crate) fn avatar_media_paths(
    picture: Option<&str>,
    host: &str,
) -> std::collections::HashMap<String, String> {
    let mut paths = std::collections::HashMap::new();
    let Some(picture) = picture else { return paths };
    let Ok(community) = reqwest::Url::parse(&format!("https://{host}")) else {
        return paths;
    };
    let (poster, animation) = picture
        .split_once("#buzz-anim=")
        .map_or((picture, None), |(poster, animation)| {
            (poster, Some(animation))
        });
    let animation = animation.and_then(|encoded| {
        nostr::types::form_urlencoded::parse(format!("value={encoded}").as_bytes())
            .next()
            .map(|(_, value)| value.into_owned())
    });
    for source in std::iter::once(poster).chain(animation.as_deref()) {
        let Ok(parsed) = reqwest::Url::parse(source) else {
            continue;
        };
        if !matches!(parsed.scheme(), "http" | "https")
            || parsed.host_str() != community.host_str()
            || parsed.port() != community.port()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            continue;
        }
        let Some(filename) = parsed.path().strip_prefix("/media/") else {
            continue;
        };
        let hash = filename.split('.').next().unwrap_or_default();
        if hash.len() == 64 && hash.bytes().all(|v| v.is_ascii_hexdigit()) {
            paths.insert(source.to_owned(), format!("/api/v1/profile/media/{hash}"));
        }
    }
    paths
}

fn view(author: String, event: Option<&nostr::Event>, host: &str) -> WebProfileView {
    let content = event
        .and_then(|e| serde_json::from_str::<Value>(&e.content).ok())
        .unwrap_or(Value::Null);
    let field = |key: &str| content.get(key).and_then(Value::as_str).map(str::to_owned);
    WebProfileView {
        avatar_media_paths: avatar_media_paths(
            content.get("picture").and_then(Value::as_str),
            host,
        ),
        pubkey: author,
        event_id: event.map(|e| e.id.to_hex()),
        display_name: field("display_name").or_else(|| field("name")),
        avatar_url: field("picture"),
        about: field("about"),
        nip05_handle: field("nip05"),
    }
}

pub(crate) async fn get(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let (client, host) = match client(&state, &ctx).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    match read(&state, &client).await {
        Ok(event) => (
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            Json(view(client.pubkey_hex(), event.as_ref(), &host)),
        )
            .into_response(),
        Err(response) => response,
    }
}

/// The original actor-signed Blossom path, scoped to this Tenant rather than
/// borrowing a Workspace's membership for a community-wide profile image.
pub(crate) async fn upload_avatar(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if body.len() as u64 > state.media_max_bytes {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    }
    let mime = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream");
    let (client, _) = match client(&state, &ctx).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if headers
        .get("x-profile-pubkey")
        .and_then(|value| value.to_str().ok())
        != Some(client.pubkey_hex().as_str())
    {
        return StatusCode::CONFLICT.into_response();
    }
    let fresh = match resolve_execution_context(&state, &headers).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if fresh.session_id != ctx.session_id
        || fresh.tenant_id != ctx.tenant_id
        || fresh.tenant_principal_id != ctx.tenant_principal_id
    {
        return StatusCode::CONFLICT.into_response();
    }
    match client.upload_media(&state.http, body.to_vec(), mime).await {
        Ok(descriptor)
            if descriptor
                .mime_type
                .as_deref()
                .is_some_and(|mime| mime.starts_with("image/")) =>
        {
            Json(descriptor).into_response()
        }
        Ok(_) => StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response(),
        Err(error) => relay_error_response(&error, None),
    }
}

pub(crate) async fn avatar(
    State(state): State<BffState>,
    axum::extract::Path(sha256): axum::extract::Path<String>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if sha256.len() != 64 || !sha256.bytes().all(|v| v.is_ascii_hexdigit()) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let (client, _) = match client(&state, &ctx).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    match client
        .fetch_media(&state.http, &format!("/media/{sha256}"))
        .await
    {
        Ok((bytes, content_type)) if content_type.starts_with("image/") => (
            [
                (axum::http::header::CONTENT_TYPE, content_type),
                (axum::http::header::CACHE_CONTROL, "no-store".to_owned()),
                (
                    axum::http::header::X_CONTENT_TYPE_OPTIONS,
                    "nosniff".to_owned(),
                ),
            ],
            bytes,
        )
            .into_response(),
        Ok(_) => StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response(),
        Err(error) => relay_error_response(&error, None),
    }
}

fn merged_content(
    prior: Option<&nostr::Event>,
    request: &WebProfileUpdateRequest,
) -> Option<String> {
    if request.display_name.is_none()
        && request.avatar_url.is_none()
        && request.about.is_none()
        && request.nip05_handle.is_none()
    {
        return None;
    }
    let mut content = prior
        .and_then(|e| serde_json::from_str::<Value>(&e.content).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    for (key, value) in [
        ("display_name", &request.display_name),
        ("picture", &request.avatar_url),
        ("about", &request.about),
        ("nip05", &request.nip05_handle),
    ] {
        if let Some(value) = value {
            content.insert(key.into(), Value::String(value.clone()));
        }
    }
    Some(Value::Object(content).to_string())
}

#[derive(sqlx::FromRow)]
struct Attempt {
    operation_id: Uuid,
    event_id: String,
    action_key: String,
    tenant_id: Option<Uuid>,
    parameter_hash: String,
    result: Option<String>,
}

async fn previous(
    state: &BffState,
    ctx: &ExecutionContext,
    key: Uuid,
) -> Result<Option<Attempt>, Response> {
    sqlx::query_as("select a.operation_id,a.event_id,d.action_key,d.tenant_id,d.parameter_hash,
        (select r.result_code from audit.audit_event r where r.operation_id=a.operation_id
         and r.event_type in ('OUTCOME','RECONCILIATION') order by r.occurred_at desc limit 1) as result
        from admission.publish_attempt a join audit.audit_event d on d.operation_id=a.operation_id and d.event_type='DISPATCH'
        where a.tenant_principal_id=$1 and a.idempotency_key=$2")
        .bind(ctx.tenant_principal_id).bind(key).fetch_optional(&state.pool).await.map_err(|_| unavailable())
}

fn attempt_response(attempt: &Attempt, tenant: Uuid, parameter_hash: &str) -> Response {
    if attempt.action_key != PROFILE_ACTION
        || attempt.tenant_id != Some(tenant)
        || attempt.parameter_hash != parameter_hash
    {
        return StatusCode::CONFLICT.into_response();
    }
    match attempt.result.as_deref() {
        Some("ACCEPTED") => Json(PublishResponse {
            event_id: attempt.event_id.clone(),
            operation_id: attempt.operation_id,
        })
        .into_response(),
        Some("REJECTED") => error_body(
            StatusCode::FORBIDDEN,
            ErrorClass::Denied,
            ReasonCode::PublishRejected,
            Some(attempt.operation_id),
        ),
        Some("NOT_DELIVERED") => error_body(
            StatusCode::CONFLICT,
            ErrorClass::Precondition,
            ReasonCode::PublishRejected,
            Some(attempt.operation_id),
        ),
        _ => error_body(
            StatusCode::SERVICE_UNAVAILABLE,
            ErrorClass::Unknown,
            ReasonCode::PublishResultUnknown,
            Some(attempt.operation_id),
        ),
    }
}

async fn claim_in_transaction(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    principal: Uuid,
    key: Uuid,
    event_id: &str,
    dispatch: AuditEntry<'_>,
) -> Result<bool, sqlx::Error> {
    let inserted = sqlx::query("insert into admission.publish_attempt (tenant_principal_id,idempotency_key,operation_id,event_id)
        values ($1,$2,$3,$4) on conflict do nothing")
        .bind(principal).bind(key).bind(dispatch.operation_id).bind(event_id).execute(&mut **tx).await?.rows_affected();
    if inserted == 0 {
        return Ok(false);
    }
    append(tx, dispatch).await?;
    Ok(true)
}

pub(crate) async fn update(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: Result<Json<WebProfileUpdateRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Ok(Json(request)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Ok(key) = request.idempotency_key.parse::<Uuid>() else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    // Freeze the semantic intent without persisting profile text. Reusing a
    // key with edited fields must not report the first request's success.
    let encoded = match serde_json::to_vec(&request) {
        Ok(value) => value,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    let parameter_hash = format!("{:x}", Sha256::digest(encoded));
    let (client, host) = match client(&state, &ctx).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if request.expected_pubkey != client.pubkey_hex() {
        return StatusCode::CONFLICT.into_response();
    }
    match previous(&state, &ctx, key).await {
        Ok(Some(attempt)) => return attempt_response(&attempt, ctx.tenant_id, &parameter_hash),
        Ok(None) => {}
        Err(r) => return r,
    }
    let prior = match read(&state, &client).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Some(content) = merged_content(prior.as_ref(), &request) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if content.len() > state.message_max_content_bytes {
        return error_body(
            StatusCode::PAYLOAD_TOO_LARGE,
            ErrorClass::Limit,
            ReasonCode::PayloadTooLarge,
            None,
        );
    }
    // NIP-01 replaces by created_at. The original native updater also uses a
    // monotonic second, so saving twice in one second cannot silently keep old metadata.
    let created_at = nostr::Timestamp::now().as_secs().max(
        prior
            .as_ref()
            .map_or(0, |e| e.created_at.as_secs().saturating_add(1)),
    );
    let keys = match actor_keys(&state, &ctx).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if keys.public_key().to_hex() != client.pubkey_hex() {
        return StatusCode::CONFLICT.into_response();
    }
    let event = match nostr::EventBuilder::new(nostr::Kind::Metadata, content)
        .custom_created_at(nostr::Timestamp::from(created_at))
        .sign_with_keys(&keys)
    {
        Ok(v) => v,
        Err(_) => return unavailable(),
    };
    // Fresh after the external read, before DISPATCH; never retarget a captured
    // profile to a replacement membership, session, Tenant or Buzz identity.
    let fresh = match resolve_execution_context(&state, &headers).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if fresh.session_id != ctx.session_id
        || fresh.tenant_id != ctx.tenant_id
        || fresh.tenant_principal_id != ctx.tenant_principal_id
    {
        return StatusCode::CONFLICT.into_response();
    }
    let (fresh_client, fresh_host) = match self::client(&state, &fresh).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if fresh_host != host || fresh_client.pubkey_hex() != event.pubkey.to_hex() {
        return StatusCode::CONFLICT.into_response();
    }
    let admitted = match fresh_client.admit() {
        Ok(v) => v,
        Err(e) => return relay_error_response(&e, None),
    };
    let operation = Uuid::new_v4();
    let event_id = event.id.to_hex();
    let entry = |event_type, result_code| AuditEntry {
        event_key: format!("profile.publish:{event_id}:{event_type}"),
        tenant_id: Some(ctx.tenant_id),
        workspace_id: None,
        operation_id: operation,
        event_type,
        human_identity_id: Some(ctx.human_identity_id),
        initiator_principal_id: Some(ctx.tenant_principal_id),
        actor_principal_id: Some(ctx.tenant_principal_id),
        action_key: PROFILE_ACTION,
        action_version: 1,
        component_type_key: "buzz",
        target_type: Some("PRINCIPAL"),
        target_id: Some(ctx.tenant_principal_id),
        parameter_hash: &parameter_hash,
        decision: "ALLOW",
        result_code,
        result_exposure: "NONE",
        evidence_refs: vec![
            Evidence::new(EvidenceKind::BuzzEventId, &event_id),
            Evidence::new(EvidenceKind::PlatformSessionId, ctx.session_id),
        ],
        correlation_id: operation,
    };
    let claimed: Result<bool, sqlx::Error> = async {
        let mut tx = state.pool.begin().await?;
        let claimed = claim_in_transaction(
            &mut tx,
            ctx.tenant_principal_id,
            key,
            &event_id,
            entry("DISPATCH", "DISPATCHED"),
        )
        .await?;
        if !claimed {
            return Ok(false);
        }
        tx.commit().await?;
        Ok(true)
    }
    .await;
    match claimed {
        Ok(true) => {}
        Err(_) => return unavailable(),
        Ok(false) => {
            return match previous(&state, &ctx, key).await {
                Ok(Some(attempt)) => attempt_response(&attempt, ctx.tenant_id, &parameter_hash),
                _ => unavailable(),
            };
        }
    }
    let (result, response) = match fresh_client.deliver(&state.http, &event, admitted).await {
        Delivery::Accepted => match read(&state, &fresh_client).await {
            Ok(Some(actual)) if actual.id == event.id => (
                Some("ACCEPTED"),
                Json(PublishResponse {
                    event_id: event_id.clone(),
                    operation_id: operation,
                })
                .into_response(),
            ),
            // An ACK is not the canonical profile readback. Another version or
            // a failed read remains unconfirmed; never send the event again.
            _ => (
                None,
                error_body(
                    StatusCode::SERVICE_UNAVAILABLE,
                    ErrorClass::Unknown,
                    ReasonCode::PublishResultUnknown,
                    Some(operation),
                ),
            ),
        },
        Delivery::Rejected(_) => (
            Some("REJECTED"),
            error_body(
                StatusCode::FORBIDDEN,
                ErrorClass::Denied,
                ReasonCode::PublishRejected,
                Some(operation),
            ),
        ),
        Delivery::Limited(kind, _) => (
            Some("NOT_DELIVERED"),
            limit_response(kind, None, Some(operation)),
        ),
        Delivery::Unknown(_) => (
            None,
            error_body(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorClass::Unknown,
                ReasonCode::PublishResultUnknown,
                Some(operation),
            ),
        ),
    };
    if let Some(result) = result {
        if let Err(error) = record(&state, entry("OUTCOME", result)).await {
            tracing::warn!(%error, %operation, "Profile publication receipt pending reconciliation");
            return error_body(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorClass::Unknown,
                ReasonCode::PublishResultUnknown,
                Some(operation),
            );
        }
    }
    response
}

/// Reuse the existing publication reconciliation loop, not another scheduler.
/// Absence NEVER proves non-delivery for a replaceable kind:0: a later version
/// may have replaced it. Only the exact original event is a positive receipt.
#[derive(sqlx::FromRow)]
struct Pending {
    operation_id: Uuid,
    occurred_at: chrono::DateTime<chrono::Utc>,
    tenant_id: Uuid,
    human_identity_id: Option<Uuid>,
    actor_principal_id: Option<Uuid>,
    evidence_refs: Value,
    event_id: String,
    parameter_hash: String,
}

async fn pending<'e>(
    executor: impl sqlx::Executor<'e, Database = sqlx::Postgres>,
    batch: i64,
    cursor: Option<(chrono::DateTime<chrono::Utc>, Uuid)>,
) -> Result<Vec<Pending>, sqlx::Error> {
    sqlx::query_as("select d.operation_id,d.occurred_at,d.tenant_id,d.human_identity_id,d.actor_principal_id,d.evidence_refs,a.event_id,d.parameter_hash
        from admission.publish_attempt a join audit.audit_event d on d.operation_id=a.operation_id
        join identity.tenant t on t.id=d.tenant_id
        where d.event_type='DISPATCH' and d.action_key=$1
        and not exists(select 1 from audit.audit_event r where r.operation_id=d.operation_id and r.event_type in ('OUTCOME','RECONCILIATION'))
        and ($3::timestamptz is null or (d.occurred_at,d.operation_id)>($3,$4))
        order by d.occurred_at,d.operation_id limit $2")
        .bind(PROFILE_ACTION).bind(batch).bind(cursor.map(|v| v.0)).bind(cursor.map(|v| v.1)).fetch_all(executor).await
}

pub(crate) async fn reconcile(
    state: &crate::service_api::ServiceState,
    batch: i64,
    cursor: &mut Option<(chrono::DateTime<chrono::Utc>, Uuid)>,
) -> Result<(), String> {
    let rows = pending(&state.pool, batch, *cursor)
        .await
        .map_err(|e| e.to_string())?;
    if rows.is_empty() {
        *cursor = None;
    }
    for row in rows {
        *cursor = Some((row.occurred_at, row.operation_id));
        let Ok((reader, _)) = crate::tenant_lifecycle::control_client(
            state,
            row.tenant_id,
            crate::tenant_lifecycle::ProjectionDirection::Establish,
        )
        .await
        else {
            continue;
        };
        if !matches!(
            reader.event_exists(&state.http, &row.event_id).await,
            Ok(true)
        ) {
            continue;
        }
        let mut tx = state.pool.begin().await.map_err(|e| e.to_string())?;
        append(
            &mut tx,
            AuditEntry {
                event_key: format!("profile.publish:{}:reconciled", row.event_id),
                tenant_id: Some(row.tenant_id),
                workspace_id: None,
                operation_id: row.operation_id,
                event_type: "RECONCILIATION",
                human_identity_id: row.human_identity_id,
                initiator_principal_id: row.actor_principal_id,
                actor_principal_id: row.actor_principal_id,
                action_key: PROFILE_ACTION,
                action_version: 1,
                component_type_key: "buzz",
                target_type: Some("PRINCIPAL"),
                target_id: row.actor_principal_id,
                parameter_hash: &row.parameter_hash,
                decision: "ALLOW",
                result_code: "ACCEPTED",
                result_exposure: "NONE",
                evidence_refs: row
                    .evidence_refs
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Evidence::parse)
                    .collect(),
                correlation_id: row.operation_id,
            },
        )
        .await
        .map_err(|e| e.to_string())?;
        tx.commit().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
