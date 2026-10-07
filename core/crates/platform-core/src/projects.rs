//! REQ-24 / DD-39: NIP-MP/NIP-34 announcement directory, not a project database.
//! Buzz 779af8886caae1317b4de962082429867ab61503:
//! crates/buzz-relay/src/handlers/ingest.rs::is_global_only_kind makes both
//! 30621 and 30617 Community-global. `buzz-channel` does not authorize Git reads.
use crate::{
    bff::{resolve_execution_context, BffState},
    pulse,
    web_transport::{actor_keys, community_client, community_limits, relay_error_response},
};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

pub(crate) const PUBLISH_ACTION: &str = "projects.publish";

// Native ReposWrite and coordinate ownership are enforced by the same Relay
// ingest as CLIENT publications. Tenant discovery is only this BFF entrance.
#[allow(clippy::result_large_err)]
pub(crate) fn publication_kind(
    request: &contracts::ProjectsPublishRequest,
) -> Result<u16, Response> {
    collab_bridge::projects::publication_kind(request)
        .map_err(|_| StatusCode::BAD_REQUEST.into_response())
}

/// Select a real signed coordinate head, never an author supplied separately by
/// the browser. Missing/stale head refuses before dispatch, not delete success.
pub(crate) async fn publication_target(
    state: &BffState,
    client: &collab_bridge::bridge::IdentityClient,
    request: &contracts::ProjectsPublishRequest,
) -> Result<Option<nostr::Event>, Response> {
    let kind = publication_kind(request)?;
    if kind != 5 {
        let slug = collab_bridge::projects::project_dtag(
            request.name.as_deref().unwrap_or_default().trim(),
        );
        let rows = client
            .query(
                &state.http,
                &[json!({"kinds":[kind],"authors":[client.pubkey_hex()],"#d":[slug],"limit":1})],
            )
            .await
            .map_err(|error| relay_error_response(&error, None))?;
        let events: Vec<nostr::Event> =
            serde_json::from_value(rows).map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
        if !events.is_empty() {
            // CREATE is not an implicit edit of a current coordinate. Retries
            // already dispatched return the original publish_attempt above.
            return Err(StatusCode::CONFLICT.into_response());
        }
        return Ok(None);
    }
    let id = request
        .target_event_id
        .as_deref()
        .ok_or_else(|| StatusCode::BAD_REQUEST.into_response())?;
    if nostr::EventId::from_hex(id).map_or(true, |parsed| parsed.to_hex() != id) {
        return Err(StatusCode::BAD_REQUEST.into_response());
    }
    let value = client
        .query(&state.http, &[json!({"ids":[id],"kinds":[30621,30617]})])
        .await
        .map_err(|error| relay_error_response(&error, None))?;
    let events: Vec<nostr::Event> =
        serde_json::from_value(value).map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
    let [event] = events.as_slice() else {
        return Err(StatusCode::NOT_FOUND.into_response());
    };
    if event.id.to_hex() != id
        || !matches!(event.kind.as_u16(), 30621 | 30617)
        || event.verify().is_err()
    {
        return Err(StatusCode::BAD_GATEWAY.into_response());
    }
    let slug = event
        .tags
        .identifier()
        .ok_or_else(|| StatusCode::BAD_GATEWAY.into_response())?;
    let value = client.query(&state.http, &[json!({"kinds":[event.kind.as_u16()],"authors":[event.pubkey.to_hex()],"#d":[slug],"limit":1})])
        .await.map_err(|error| relay_error_response(&error, None))?;
    let heads: Vec<nostr::Event> =
        serde_json::from_value(value).map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
    if heads.as_slice() != [event.clone()] {
        return Err(StatusCode::CONFLICT.into_response());
    }
    Ok(Some(event.clone()))
}

// Keep the existing BFF HTTP refusal type; no second error wrapper.
#[allow(clippy::result_large_err)]
fn filter(request: &contracts::ProjectsQueryRequest, cap: i64) -> Result<(u16, Value), Response> {
    let view =
        serde_json::to_value(&request.view).map_err(|_| StatusCode::BAD_REQUEST.into_response())?;
    let kind = match view.as_str() {
        Some("PROJECTS") => 30621,
        Some("REPOSITORIES") => 30617,
        Some("DELETIONS") => 5,
        _ => return Err(StatusCode::BAD_REQUEST.into_response()),
    };
    if cap <= 0
        || request.since.is_some_and(|v| v < 0)
        || request.until.is_some_and(|v| v < 0)
        || matches!((request.since, request.until), (Some(s), Some(u)) if s > u)
    {
        return Err(StatusCode::BAD_REQUEST.into_response());
    }
    let mut filter = json!({"kinds":[kind],"limit":cap});
    if kind == 5 {
        let coordinates = request
            .coordinates
            .as_ref()
            .filter(|v| !v.is_empty() && v.len() as i64 <= cap)
            .ok_or_else(|| StatusCode::BAD_REQUEST.into_response())?;
        if coordinates.iter().any(|v| !coordinate(v)) {
            return Err(StatusCode::BAD_REQUEST.into_response());
        }
        filter["#a"] = json!(coordinates);
    } else if request.coordinates.is_some() {
        return Err(StatusCode::BAD_REQUEST.into_response());
    }
    if let Some(since) = request.since {
        filter["since"] = json!(since);
    }
    if let Some(until) = request.until {
        filter["until"] = json!(until);
    }
    Ok((kind, filter))
}

fn coordinate(value: &str) -> bool {
    let mut parts = value.splitn(3, ':');
    matches!(parts.next(), Some("30617" | "30621"))
        && parts.next().is_some_and(|v| {
            v.len() == 64
                && v.bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        })
        && parts.next().is_some_and(|v| !v.is_empty())
}

pub(crate) async fn query(
    State(state): State<BffState>,
    headers: HeaderMap,
    Json(request): Json<contracts::ProjectsQueryRequest>,
) -> Response {
    match query_inner(&state, &headers, request).await {
        Ok(value) => (
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            Json(value),
        )
            .into_response(),
        Err(error) => error,
    }
}

async fn query_inner(
    state: &BffState,
    headers: &HeaderMap,
    request: contracts::ProjectsQueryRequest,
) -> Result<Value, Response> {
    let ctx = resolve_execution_context(state, headers).await?;
    let before = pulse::admit(state, &ctx).await?;
    let keys = actor_keys(state, &ctx).await?;
    let client = community_client(state, &keys, &before.community_host)?;
    let cap = community_limits(state, &before.community_host)
        .await
        .map_err(IntoResponse::into_response)?
        .max_limit;
    let (kind, filter) = filter(&request, cap)?;
    let value = client
        .query(&state.http, &[filter])
        .await
        .map_err(|e| relay_error_response(&e, None))?;
    let rows = value
        .as_array()
        .ok_or_else(|| StatusCode::BAD_GATEWAY.into_response())?;
    for row in rows {
        let event: nostr::Event = serde_json::from_value(row.clone())
            .map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
        if event.kind.as_u16() != kind
            || event.verify().is_err()
            || request
                .since
                .is_some_and(|v| event.created_at.as_secs() < v as u64)
            || request
                .until
                .is_some_and(|v| event.created_at.as_secs() > v as u64)
            || kind == 5
                && !event.tags.iter().any(|tag| {
                    let t = tag.as_slice();
                    t.first().is_some_and(|v| v == "a")
                        && t.get(1).is_some_and(|v| {
                            request.coordinates.as_ref().is_some_and(|c| c.contains(v))
                        })
                })
        {
            return Err(StatusCode::BAD_GATEWAY.into_response());
        }
    }
    if rows.len() as i64 > cap {
        return Err(StatusCode::BAD_GATEWAY.into_response());
    }
    if pulse::admit(state, &ctx).await? != before
        || actor_keys(state, &ctx).await?.public_key() != keys.public_key()
    {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    Ok(
        json!({"events":value,"limit":cap,"pubkey":client.pubkey_hex(),"bindingVersion":before.version}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(value: Value) -> contracts::ProjectsQueryRequest {
        serde_json::from_value(value).unwrap()
    }
    #[test]
    fn announcement_filter_never_grants_a_git_or_workspace_scope() {
        let (kind, value) = filter(&request(json!({"view":"PROJECTS","until":42})), 73).unwrap();
        assert_eq!(kind, 30621);
        assert_eq!(value, json!({"kinds":[30621],"limit":73,"until":42}));
        assert_eq!(
            filter(&request(json!({"view":"REPOSITORIES"})), 73)
                .unwrap()
                .0,
            30617
        );
    }
    #[test]
    fn deletion_enumeration_requires_exact_project_coordinates() {
        assert!(filter(&request(json!({"view":"DELETIONS"})), 73).is_err());
        let address = format!("30617:{}:repo", "a".repeat(64));
        let (_, value) = filter(
            &request(json!({"view":"DELETIONS","coordinates":[address],"since":42,"until":42})),
            73,
        )
        .unwrap();
        assert_eq!(value["#a"], json!([address]));
        for address in [
            format!("39000:{}:channel", "a".repeat(64)),
            format!("30617:{}:", "a".repeat(64)),
            format!("30617:{}:repo", "A".repeat(64)),
        ] {
            assert!(filter(
                &request(json!({"view":"DELETIONS","coordinates":[address]})),
                73
            )
            .is_err());
        }
    }
    #[test]
    fn filters_reject_reversed_windows_unbounded_tombstones_and_cross_view_tags() {
        assert!(filter(
            &request(json!({"view":"PROJECTS","since":43,"until":42})),
            73
        )
        .is_err());
        assert!(filter(&request(json!({"view":"PROJECTS","coordinates":[]})), 73).is_err());
        let address = format!("30621:{}:p", "a".repeat(64));
        assert!(filter(
            &request(json!({"view":"DELETIONS","coordinates":[address,address]})),
            1
        )
        .is_err());
        assert!(filter(&request(json!({"view":"PROJECTS"})), 0).is_err());
    }
}
