//! Original NIP-30 author-owned sets. Relay, not Core, owns the palette.
use crate::{
    bff::{resolve_execution_context, BffState},
    web_profile,
    web_transport::{error_body, relay_error_response},
};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use collab_bridge::{
    bridge::IdentityClient, build_custom_emoji_set, kind::KIND_EMOJI_SET,
    normalize_custom_emoji_shortcode, CustomEmoji, CUSTOM_EMOJI_SET_D_TAG,
};
use contracts::{ErrorClass, ReasonCode, WebCustomEmojiMutation};
use nostr::JsonUtil;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub(crate) const EMOJI_ACTION: &str = "identity.custom_emoji.publish";

fn unavailable() -> Response {
    error_body(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorClass::Precondition,
        ReasonCode::DependencyUnavailable,
        None,
    )
}

fn own_filter(author: &str) -> Value {
    json!({"kinds":[KIND_EMOJI_SET], "#d":[CUSTOM_EMOJI_SET_D_TAG], "authors":[author], "limit":1})
}

fn verified_sets(value: Value, author: Option<&str>) -> Result<Vec<nostr::Event>, ()> {
    let rows = value.as_array().ok_or(())?;
    if author.is_some() && rows.len() > 1 {
        return Err(());
    }
    rows.iter()
        .map(|row| {
            let event: nostr::Event = serde_json::from_value(row.clone()).map_err(|_| ())?;
            if event.kind.as_u16() as u32 != KIND_EMOJI_SET
                || event.verify().is_err()
                || author.is_some_and(|author| event.pubkey.to_hex() != author)
                || event.tags.identifier() != Some(CUSTOM_EMOJI_SET_D_TAG)
            {
                return Err(());
            }
            Ok(event)
        })
        .collect()
}

async fn own(state: &BffState, client: &IdentityClient) -> Result<Vec<nostr::Event>, Response> {
    let author = client.pubkey_hex();
    let rows = client
        .query(&state.http, &[own_filter(&author)])
        .await
        .map_err(|error| relay_error_response(&error, None))?;
    verified_sets(rows, Some(&author)).map_err(|_| unavailable())
}

pub(crate) async fn message_tags(
    state: &BffState,
    client: &IdentityClient,
    content: &str,
) -> Result<Vec<Vec<String>>, Response> {
    if !content.contains(':') {
        return Ok(Vec::new());
    }
    let rows = client
        .query(
            &state.http,
            &[json!({"kinds":[KIND_EMOJI_SET], "#d":[CUSTOM_EMOJI_SET_D_TAG]})],
        )
        .await
        .map_err(|error| relay_error_response(&error, None))?;
    let events = verified_sets(rows, None).map_err(|_| unavailable())?;
    collab_bridge::custom_emoji_tags(content, &events).map_err(|_| unavailable())
}

pub(crate) async fn get(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let (client, host) = match web_profile::client(&state, &ctx).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let rows = match client
        .query(
            &state.http,
            &[json!({"kinds":[KIND_EMOJI_SET], "#d":[CUSTOM_EMOJI_SET_D_TAG]})],
        )
        .await
    {
        Ok(rows) => rows,
        Err(error) => return relay_error_response(&error, None),
    };
    let mut events = match verified_sets(rows, None) {
        Ok(events) => events,
        Err(()) => return unavailable(),
    };
    let author = client.pubkey_hex();
    let own_events = match own(&state, &client).await {
        Ok(events) => events,
        Err(r) => return r,
    };
    events.retain(|event| event.pubkey.to_hex() != author);
    events.extend(own_events);
    let mut media_paths = std::collections::HashMap::new();
    for event in &events {
        for tag in event.tags.iter().map(|tag| tag.as_slice()) {
            if tag.first().map(String::as_str) == Some("emoji") {
                media_paths.extend(web_profile::avatar_media_paths(
                    tag.get(2).map(String::as_str),
                    &host,
                ));
            }
        }
    }
    (
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(json!({
            "pubkey":client.pubkey_hex(), "events":events, "mediaPaths":media_paths,
        })),
    )
        .into_response()
}

pub(crate) async fn update(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: Result<Json<WebCustomEmojiMutation>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Ok(Json(request)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Ok(key) = Uuid::parse_str(&request.idempotency_key) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Ok(shortcode) = normalize_custom_emoji_shortcode(&request.shortcode) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if shortcode != request.shortcode {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Ok(encoded) = serde_json::to_vec(&request) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let digest = format!("{:x}", Sha256::digest(encoded));
    let (client, host) = match web_profile::client(&state, &ctx).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if request.expected_pubkey != client.pubkey_hex() {
        return StatusCode::CONFLICT.into_response();
    }
    match web_profile::previous(&state, &ctx, key).await {
        Ok(Some(attempt)) => {
            return web_profile::own_event_response(&attempt, ctx.tenant_id, &digest, EMOJI_ACTION)
        }
        Ok(None) => {}
        Err(r) => return r,
    }
    // Only an actual admitted community upload can be added by the browser;
    // existing signed entries remain untouched, including original external URLs.
    if let Some(url) = request.image_url.as_deref() {
        if !web_profile::avatar_media_paths(Some(url), &host).contains_key(url) {
            return StatusCode::BAD_REQUEST.into_response();
        }
    }
    let prior = match own(&state, &client).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let mut seen = std::collections::HashSet::new();
    let mut emojis = Vec::new();
    for event in &prior {
        for tag in event.tags.iter().map(|tag| tag.as_slice()) {
            if tag.first().map(String::as_str) != Some("emoji") {
                continue;
            }
            let (Some(name), Some(url)) = (tag.get(1), tag.get(2)) else {
                continue;
            };
            let Ok(name) = normalize_custom_emoji_shortcode(name) else {
                continue;
            };
            if name != shortcode && seen.insert(name.clone()) {
                emojis.push(CustomEmoji {
                    shortcode: name,
                    url: url.clone(),
                });
            }
        }
    }
    if let Some(url) = request.image_url {
        emojis.push(CustomEmoji { shortcode, url });
    }
    let builder = match build_custom_emoji_set(&emojis) {
        Ok(v) => v,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    let created = nostr::Timestamp::now().as_secs().max(
        prior
            .first()
            .map_or(0, |event| event.created_at.as_secs().saturating_add(1)),
    );
    let keys = match crate::web_transport::actor_keys(&state, &ctx).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if keys.public_key().to_hex() != client.pubkey_hex() {
        return StatusCode::CONFLICT.into_response();
    }
    let event = match builder
        .custom_created_at(nostr::Timestamp::from(created))
        .sign_with_keys(&keys)
    {
        Ok(v) => v,
        Err(_) => return unavailable(),
    };
    if event.as_json().len() > state.message_max_content_bytes {
        return error_body(
            StatusCode::PAYLOAD_TOO_LARGE,
            ErrorClass::Limit,
            ReasonCode::PayloadTooLarge,
            None,
        );
    }
    web_profile::publish_prepared(
        &state,
        &headers,
        &ctx,
        &host,
        key,
        &digest,
        EMOJI_ACTION,
        event,
        own_filter(&client.pubkey_hex()),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emoji_readback_requires_valid_signed_owner_set_not_an_ack_or_peer_set() {
        let keys = nostr::Keys::generate();
        let event = build_custom_emoji_set(&[])
            .unwrap()
            .sign_with_keys(&keys)
            .unwrap();
        let owner = keys.public_key().to_hex();
        assert!(verified_sets(json!([event]), Some(&owner)).is_ok());
        assert!(verified_sets(
            json!([event]),
            Some(&nostr::Keys::generate().public_key().to_hex())
        )
        .is_err());
        assert!(verified_sets(json!([event, event]), Some(&owner)).is_err());
        let mut tampered = json!(event);
        tampered["content"] = json!("changed");
        assert!(verified_sets(json!([tampered]), None).is_err());
        assert!(verified_sets(json!({"accepted":true}), Some(&owner)).is_err());
    }
}
