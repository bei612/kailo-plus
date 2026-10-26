//! DD-81/160: bounded proof for the caller's original signed merged status.
//! This is an observation of the existing event writer, never a receipt ledger.
use super::{
    bridge,
    git::transport::{authorize_git_read, deny_banned_git_principal},
};
use crate::{state::AppState, tenant};
use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use nostr::Event;
use std::sync::Arc;

fn refused() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({"error":"publication unavailable"})),
    )
        .into_response()
}
pub(super) async fn readmit(
    state: &AppState,
    scope: &buzz_core::TenantContext,
    headers: &HeaderMap,
    auth: &bridge::VerifiedBridgeAuth,
    repo: &str,
) -> Result<(), Response> {
    if !state
        .db
        .is_community_active(scope.community())
        .await
        .map_err(|_| refused())?
    {
        return Err(refused());
    }
    let tag = super::relay_members::extract_auth_tag_header(headers);
    super::relay_members::enforce_relay_membership(
        state,
        scope.community(),
        auth.pubkey.as_bytes(),
        tag,
        auth.signed_created_at,
    )
    .await
    .map_err(|_| refused())?;
    deny_banned_git_principal(
        &state.db,
        scope.community(),
        &auth.pubkey,
        tag,
        auth.signed_created_at,
    )
    .await
    .map_err(|_| refused())?;
    authorize_git_read(
        &state.db,
        scope.community(),
        &auth.pubkey,
        &auth.pubkey.to_hex(),
        repo,
    )
    .await
    .map_err(|_| refused())?;
    Ok(())
}

/// POST /events/delivery. The signed proof is bounded, author-only and tied to
/// this request's Host, method and body by the original NIP-98/replay gates.
pub async fn delivery(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, Response> {
    // The existing API router supplies the original request-body bound.
    let host = headers
        .get(axum::http::header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let scope = tenant::bind_community(&state.db, host)
        .await
        .map_err(|_| refused())?;
    let url = bridge::nip98_expected_url(&state.config.relay_url, &scope, "/events/delivery");
    let auth =
        bridge::verify_bridge_auth_with_options(&headers, "POST", &url, Some(&body), true, true)
            .map_err(IntoResponse::into_response)?;
    bridge::enforce_http_admission(&state, &scope, &auth.pubkey)
        .await
        .map_err(IntoResponse::into_response)?;
    bridge::check_nip98_replay(&state, &scope, auth.event_id_bytes)
        .await
        .map_err(IntoResponse::into_response)?;
    let value: serde_json::Value =
        serde_json::from_slice(&body).map_err(|_| StatusCode::BAD_REQUEST.into_response())?;
    let object = value
        .as_object()
        .ok_or_else(|| StatusCode::BAD_REQUEST.into_response())?;
    if object.len() != 7
        || object.keys().any(|key| {
            !matches!(
                key.as_str(),
                "id" | "pubkey" | "created_at" | "kind" | "tags" | "content" | "sig"
            )
        })
    {
        return Err(StatusCode::BAD_REQUEST.into_response());
    }
    let event: Event =
        serde_json::from_value(value).map_err(|_| StatusCode::BAD_REQUEST.into_response())?;
    let repo = buzz_core::publication::merged_status_repository(&event, &auth.pubkey)
        .map_err(|_| refused())?;
    readmit(&state, &scope, &headers, &auth, repo).await?;
    let proof = state
        .db
        .merged_status_delivery(scope.community(), &event)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    // Deletion/quiescing, a changed host binding, or a revoked member may have
    // overtaken the writer read. Such a refusal is never an empty observation.
    let after = tenant::bind_community(&state.db, host)
        .await
        .map_err(|_| refused())?;
    if after.community() != scope.community() {
        return Err(refused());
    }
    readmit(&state, &scope, &headers, &auth, repo).await?;
    Ok(([("cache-control", "no-store")], Json(proof)).into_response())
}

/// The caller supplies references only. This endpoint never accepts an event
/// body or a caller's assertion that an event was absent.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ObservationRequest {
    event_id: String,
    community_id: String,
}

// Some historical kind:5 writers looked up their target through the ordinary
// deleted_at filter and stored NULL for a deletion of a private deleted event.
// Never treat that lost scope, a missing target or a deletion chain as global.
async fn readmit_deletion_scope(
    state: &AppState,
    scope: &buzz_core::TenantContext,
    stored: &buzz_core::StoredEvent,
) -> Result<(), Response> {
    if stored.event.kind.as_u16() != 5 {
        return Ok(());
    }
    let targets: Vec<_> = stored
        .event
        .tags
        .iter()
        .filter(|tag| {
            tag.as_slice()
                .first()
                .is_some_and(|key| key == "e" || key == "a")
        })
        .collect();
    let [target] = targets.as_slice() else {
        return Err(refused());
    };
    let tag = target.as_slice();
    let value = tag.get(1).ok_or_else(refused)?;
    if tag[0] == "a" {
        // Core coordinate deletions are its existing public Project/Repository
        // coordinates. Do not expose another gated addressable protocol here.
        let parts: Vec<_> = value.splitn(3, ':').collect();
        if stored.channel_id.is_some()
            || parts.len() != 3
            || !matches!(parts[0], "30617" | "30621")
            || parts[1] != stored.event.pubkey.to_hex()
            || parts[2].is_empty()
        {
            return Err(refused());
        }
        return Ok(());
    }
    let id = nostr::EventId::from_hex(value).map_err(|_| refused())?;
    if id.to_hex() != *value {
        return Err(refused());
    }
    let original = state
        .db
        .get_event_by_id_including_deleted(scope.community(), id.as_bytes())
        .await
        .map_err(|_| refused())?
        .ok_or_else(refused)?;
    if original.event.id != id
        || original.event.verify().is_err()
        || original.channel_id != stored.channel_id
    {
        return Err(refused());
    }
    if original.channel_id.is_none() && original.event.kind.as_u16() == 7 {
        // Pulse UNLIKE deletes a global kind:7 reaction, not the original note.
        // Keep that real path available after both have been soft-deleted, but
        // prove its last e-target is the original public global kind:1 note.
        let target = original.event.tags.iter().rev().find_map(|tag| {
            let tag = tag.as_slice();
            (tag.first().is_some_and(|key| key == "e")).then(|| tag.get(1)).flatten()
        }).ok_or_else(refused)?;
        let id = nostr::EventId::from_hex(target).map_err(|_| refused())?;
        if id.to_hex() != *target { return Err(refused()); }
        let note = state.db.get_event_by_id_including_deleted(scope.community(), id.as_bytes())
            .await.map_err(|_| refused())?.ok_or_else(refused)?;
        if note.event.id != id || note.event.kind.as_u16() != 1
            || note.channel_id.is_some() || note.event.verify().is_err()
        {
            return Err(refused());
        }
        return Ok(());
    }
    if original.channel_id.is_none()
        && !matches!(
            original.event.kind.as_u16(),
            1 | 1618 | 1621 | 1630 | 1631 | 1632 | 1633 | 30617 | 30621
        )
    {
        // In particular, a historical NULL deletion of another NULL deletion
        // cannot wash a private scope into a Community-global observation.
        return Err(refused());
    }
    Ok(())
}

async fn readmit_observation(
    state: &AppState,
    scope: &buzz_core::TenantContext,
    headers: &HeaderMap,
    auth: &bridge::VerifiedBridgeAuth,
    event: &buzz_core::StoredEvent,
) -> Result<(), Response> {
    if !state
        .db
        .is_community_active(scope.community())
        .await
        .map_err(|_| refused())?
    {
        return Err(refused());
    }
    super::relay_members::enforce_relay_membership(
        state,
        scope.community(),
        auth.pubkey.as_bytes(),
        super::relay_members::extract_auth_tag_header(headers),
        auth.signed_created_at,
    )
    .await
    .map_err(|_| refused())?;
    // A durable ban need not remove the membership row. This evidence reader
    // uses the same fresh ban/verified owner cascade as original Git proof;
    // a timeout is not promoted to a read ban.
    deny_banned_git_principal(
        &state.db,
        scope.community(),
        &auth.pubkey,
        super::relay_members::extract_auth_tag_header(headers),
        auth.signed_created_at,
    )
    .await
    .map_err(|_| refused())?;
    readmit_deletion_scope(state, scope, event).await?;
    // Core-governed channels (including private conversations) require live
    // membership. Never reuse a cached allow or admit CONTROL to a private DM.
    if let Some(channel) = event.channel_id {
        if !state
            .db
            .is_member(scope.community(), channel, auth.pubkey.as_bytes())
            .await
            .map_err(|_| refused())?
        {
            return Err(refused());
        }
    }
    if !buzz_core::filter::reader_authorized_for_event(&event.event, &auth.pubkey.to_hex()) {
        return Err(refused());
    }
    // An encrypted reminder is an author-only personal publication. Metadata
    // observation must not turn a CONTROL reader into its author.
    if event.event.kind.as_u16() == 30300 && event.event.pubkey != auth.pubkey {
        return Err(refused());
    }
    Ok(())
}

/// Positive evidence for a Core publication, including soft-deleted rows.
/// Missing, unreadable and refused references all have the same response and
/// leave the caller's result UNKNOWN. No settled/absence conclusion is exposed.
pub async fn observation(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, Response> {
    let host = headers
        .get(axum::http::header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let scope = tenant::bind_community(&state.db, host)
        .await
        .map_err(|_| refused())?;
    let url = bridge::nip98_expected_url(&state.config.relay_url, &scope, "/events/observation");
    let auth =
        bridge::verify_bridge_auth_with_options(&headers, "POST", &url, Some(&body), true, true)
            .map_err(IntoResponse::into_response)?;
    bridge::enforce_http_admission(&state, &scope, &auth.pubkey)
        .await
        .map_err(IntoResponse::into_response)?;
    bridge::check_nip98_replay(&state, &scope, auth.event_id_bytes)
        .await
        .map_err(IntoResponse::into_response)?;
    let request: ObservationRequest =
        serde_json::from_slice(&body).map_err(|_| StatusCode::BAD_REQUEST.into_response())?;
    let id = nostr::EventId::from_hex(&request.event_id).map_err(|_| refused())?;
    let community = uuid::Uuid::parse_str(&request.community_id).map_err(|_| refused())?;
    if id.to_hex() != request.event_id
        || community.to_string() != request.community_id
        || community != *scope.community().as_uuid()
    {
        return Err(refused());
    }
    // The existing getter is explicitly a writer read; no replica, ordinary
    // deleted_at filter, or new receipt table can stand in for this fact.
    let stored = state
        .db
        .get_event_by_id_including_deleted(scope.community(), id.as_bytes())
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?
        .ok_or_else(refused)?;
    // Only existing Core publication kinds. Private system results, engrams,
    // arbitrary author metadata and other gated protocols are not this API.
    if !matches!(
        stored.event.kind.as_u16(),
        1 | 5
            | 7
            | 9
            | 1618
            | 1621
            | 1630
            | 1631
            | 1632
            | 1633
            | 9002
            | 30300
            | 30617
            | 30621
            | 40003
            | 45001
            | 45003
    ) || stored.event.id != id
        || stored.event.verify().is_err()
    {
        return Err(refused());
    }
    readmit_observation(&state, &scope, &headers, &auth, &stored).await?;
    let after = tenant::bind_community(&state.db, host)
        .await
        .map_err(|_| refused())?;
    if after.community() != scope.community() {
        return Err(refused());
    }
    readmit_observation(&state, &scope, &headers, &auth, &stored).await?;
    Ok((
        [("cache-control", "no-store")],
        Json(serde_json::json!({
            "event_id": stored.event.id.to_hex(),
            "community_id": community.to_string(),
            "pubkey": stored.event.pubkey.to_hex(),
            "kind": stored.event.kind.as_u16(),
            "channel_id": stored.channel_id.map(|channel| channel.to_string()),
        })),
    )
        .into_response())
}

#[cfg(test)]
#[path = "delivery_tests.rs"]
mod tests;
