//! REQ-24 / DD-39: original Buzz kind:1 Community notes, not Workspace messages.
//! Bodies and contacts remain Relay-owned. Only typed filters leave this boundary.
use crate::{
    bff::{resolve_execution_context, BffState, ExecutionContext},
    service_api::ServiceState,
    web_transport::{
        actor_keys, community_client, community_limits, relay_error_response, QueryResponse,
    },
};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

pub(crate) const PUBLISH_ACTION: &str = "pulse.publish";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PulseResponse {
    #[serde(flatten)]
    page: QueryResponse,
    media_paths: std::collections::HashMap<String, String>,
}

// Preserve the existing BFF HTTP error boundary rather than adding a wrapper.
#[allow(clippy::result_large_err)]
pub(crate) fn publication_kind(request: &contracts::PulsePublishRequest) -> Result<u16, Response> {
    let operation = serde_json::to_value(&request.operation)
        .map_err(|_| StatusCode::BAD_REQUEST.into_response())?;
    let kind = match operation.as_str() {
        Some("NOTE") => 1,
        Some("LIKE") => 7,
        Some("UNLIKE") => 5,
        _ => return Err(StatusCode::BAD_REQUEST.into_response()),
    };
    if request
        .target_event_id
        .as_deref()
        .is_some_and(|id| !hex(id))
        || request
            .mentions
            .as_deref()
            .unwrap_or_default()
            .iter()
            .any(|key| !hex(key))
        || kind != 1
            && (request.target_event_id.is_none()
                || request.attachments.as_ref().is_some_and(|v| !v.is_empty())
                || request.mentions.as_ref().is_some_and(|v| !v.is_empty())
                || request.content != if kind == 7 { "+" } else { "" })
    {
        return Err(StatusCode::BAD_REQUEST.into_response());
    }
    Ok(kind)
}

/// Buzz 779af8886caae1317b4de962082429867ab61503:
/// desktop/src-tauri/src/events.rs::build_note and the original NIP-25/NIP-09
/// reaction builders. Only these semantic tags can be signed, never raw input.
pub(crate) async fn publication_tags(
    state: &BffState,
    client: &collab_bridge::bridge::IdentityClient,
    request: &contracts::PulsePublishRequest,
    media: &[Vec<String>],
) -> Result<Vec<Vec<String>>, Response> {
    let kind = publication_kind(request)?;
    let mut tags = Vec::new();
    if let Some(id) = &request.target_event_id {
        if kind == 5 {
            let rows = client
                .query(
                    &state.http,
                    &[json!({"kinds":[7],"ids":[id],"authors":[client.pubkey_hex()],"limit":1})],
                )
                .await
                .map_err(|e| relay_error_response(&e, None))?;
            let event = verified(rows, &[7])?
                .into_iter()
                .find(|event| {
                    event.id.to_hex() == *id && event.pubkey.to_hex() == client.pubkey_hex()
                })
                .ok_or_else(|| StatusCode::FORBIDDEN.into_response())?;
            let parent = event
                .tags
                .iter()
                .find_map(|tag| {
                    let tag = tag.as_slice();
                    (tag.first().is_some_and(|v| v == "e"))
                        .then(|| tag.get(1).cloned())
                        .flatten()
                })
                .ok_or_else(|| StatusCode::BAD_REQUEST.into_response())?;
            read_note(state, client, &parent).await?;
            tags.push(vec!["e".into(), id.clone()]);
            tags.push(vec!["k".into(), "7".into()]);
        } else {
            let target = read_note(state, client, id).await?;
            if kind == 1 {
                tags.push(vec!["e".into(), id.clone(), String::new(), "reply".into()]);
            } else {
                tags.push(vec!["e".into(), id.clone()]);
                tags.push(vec!["p".into(), target.pubkey.to_hex()]);
                tags.push(vec!["k".into(), "1".into()]);
            }
        }
    }
    if kind == 1 {
        tags.extend(
            request
                .mentions
                .as_deref()
                .unwrap_or_default()
                .iter()
                .map(|key| vec!["p".into(), key.clone()]),
        );
        tags.extend_from_slice(media);
    }
    Ok(tags)
}

#[derive(Clone, Debug, PartialEq, sqlx::FromRow)]
pub(crate) struct CommunityScope {
    pub community_host: String,
    pub version: i32,
}

pub(crate) async fn admit(
    state: &BffState,
    ctx: &ExecutionContext,
) -> Result<CommunityScope, Response> {
    admit_actor(
        &state.memory_service,
        ctx.tenant_id,
        ctx.tenant_principal_id,
    )
    .await
}

pub(crate) async fn admit_actor(
    state: &ServiceState,
    tenant: Uuid,
    actor: Uuid,
) -> Result<CommunityScope, Response> {
    crate::conversations::fresh_discover(state, tenant, actor).await?;
    sqlx::query_as::<_, CommunityScope>(
        "select b.normalized_host as community_host,b.version
        from projection.tenant_buzz_binding b where b.tenant_id=$1 and b.state='ACTIVE'
        and exists(select 1 from identity.buzz_identity_binding i where i.tenant_id=b.tenant_id
          and i.principal_id=$2 and i.kind='HUMAN' and i.custody='SERVER' and i.state='ACTIVE')",
    )
    .bind(tenant)
    .bind(actor)
    .fetch_optional(&state.pool)
    .await
    .map_err(crate::service_api::unavailable)?
    .ok_or_else(|| StatusCode::FORBIDDEN.into_response())
}

fn hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
}

/// Exact upstream exclusion: Pulse is not the NIP-34 repository-comment reader.
pub(crate) fn is_note(event: &nostr::Event) -> bool {
    event.kind.as_u16() == 1
        && !event.tags.iter().any(|tag| {
            let tag = tag.as_slice();
            tag.first().is_some_and(|v| v == "a")
                && tag.get(1).is_some_and(|v| v.starts_with("30617:"))
        })
}

pub(crate) async fn read_note(
    state: &BffState,
    client: &collab_bridge::bridge::IdentityClient,
    id: &str,
) -> Result<nostr::Event, Response> {
    if !hex(id) {
        return Err(StatusCode::BAD_REQUEST.into_response());
    }
    let value = client
        .query(&state.http, &[json!({"kinds":[1],"ids":[id],"limit":1})])
        .await
        .map_err(|e| relay_error_response(&e, None))?;
    let events = verified(value, &[1])?;
    events
        .into_iter()
        .find(|e| e.id.to_hex() == id && is_note(e))
        .ok_or_else(|| StatusCode::NOT_FOUND.into_response())
}

// Preserve the existing BFF HTTP error boundary rather than adding a wrapper.
#[allow(clippy::result_large_err)]
fn verified(value: Value, kinds: &[u16]) -> Result<Vec<nostr::Event>, Response> {
    let rows = value
        .as_array()
        .ok_or_else(|| StatusCode::BAD_GATEWAY.into_response())?;
    rows.iter()
        .map(|row| {
            let event: nostr::Event = serde_json::from_value(row.clone())
                .map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
            if !kinds.contains(&event.kind.as_u16()) || event.verify().is_err() {
                return Err(StatusCode::BAD_GATEWAY.into_response());
            }
            Ok(event)
        })
        .collect()
}

pub(crate) async fn query(
    State(state): State<BffState>,
    headers: HeaderMap,
    Json(request): Json<contracts::PulseQueryRequest>,
) -> Response {
    match query_inner(&state, &headers, request).await {
        Ok(value) => (
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            Json(value),
        )
            .into_response(),
        Err(e) => e,
    }
}

async fn query_inner(
    state: &BffState,
    headers: &HeaderMap,
    request: contracts::PulseQueryRequest,
) -> Result<PulseResponse, Response> {
    let ctx = resolve_execution_context(state, headers).await?;
    let before = admit(state, &ctx).await?;
    let keys = actor_keys(state, &ctx).await?;
    let client = community_client(state, &keys, &before.community_host)?;
    let cap = community_limits(state, &before.community_host)
        .await
        .map_err(IntoResponse::into_response)?
        .max_limit;
    for values in [&request.authors, &request.event_ids].into_iter().flatten() {
        if values.len() as i64 > cap || values.iter().any(|v| !hex(v)) {
            return Err(StatusCode::BAD_REQUEST.into_response());
        }
    }
    // No caller-selected kinds or tags. These are the original social.rs queries.
    let view =
        serde_json::to_value(&request.view).map_err(|_| StatusCode::BAD_REQUEST.into_response())?;
    let kinds: &[u16] = match view.as_str() {
        Some("NOTES") => &[1],
        Some("CONTACTS") => &[3],
        Some("REACTIONS") => &[7],
        Some("PROFILES") => &[0],
        Some("LIKED") => &[7, 5],
        Some("AGENTS") => &[10100],
        _ => return Err(StatusCode::BAD_REQUEST.into_response()),
    };
    let mut filter = json!({"kinds":kinds,"limit":cap});
    if let Some(authors) = &request.authors {
        filter["authors"] = json!(authors)
    }
    if let Some(ids) = &request.event_ids {
        filter[if view == "REACTIONS" { "#e" } else { "ids" }] = json!(ids);
    }
    if view == "CONTACTS" || view == "LIKED" {
        filter["authors"] = json!([client.pubkey_hex()])
    }
    if view == "CONTACTS" {
        filter["limit"] = json!(1)
    }
    if let Some(before) = request.before {
        if before < 0 {
            return Err(StatusCode::BAD_REQUEST.into_response());
        }
        filter["until"] = json!(before);
    }
    let value = client
        .query(&state.http, &[filter])
        .await
        .map_err(|e| relay_error_response(&e, None))?;
    let mut events = verified(value, kinds)?;
    if view == "REACTIONS" && !events.is_empty() {
        // NIP-09 deletes reference the reaction, not the note. Querying kind:5
        // with the note ids would keep removed likes visible forever.
        let ids: Vec<String> = events.iter().map(|event| event.id.to_hex()).collect();
        let removed = client
            .query(&state.http, &[json!({"kinds":[5],"#e":ids,"limit":cap})])
            .await
            .map_err(|e| relay_error_response(&e, None))?;
        events.extend(verified(removed, &[5])?);
    }
    if view == "LIKED" {
        let deleted: std::collections::HashSet<String> = events
            .iter()
            .filter(|e| e.kind.as_u16() == 5)
            .flat_map(|e| e.tags.iter())
            .filter_map(|t| {
                let t = t.as_slice();
                (t.first().is_some_and(|s| s == "e"))
                    .then(|| t.get(1).cloned())
                    .flatten()
            })
            .collect();
        let ids: Vec<String> = events
            .iter()
            .filter(|e| {
                e.kind.as_u16() == 7 && e.content == "+" && !deleted.contains(&e.id.to_hex())
            })
            .flat_map(|e| e.tags.iter())
            .filter_map(|t| {
                let t = t.as_slice();
                (t.first().is_some_and(|s| s == "e"))
                    .then(|| t.get(1).cloned())
                    .flatten()
            })
            .collect();
        events = if ids.is_empty() {
            Vec::new()
        } else {
            verified(
                client
                    .query(&state.http, &[json!({"kinds":[1],"ids":ids,"limit":cap})])
                    .await
                    .map_err(|e| relay_error_response(&e, None))?,
                &[1],
            )?
        };
    }
    if view == "NOTES" || view == "LIKED" {
        events.retain(is_note)
    }
    if admit(state, &ctx).await? != before
        || actor_keys(state, &ctx).await?.public_key() != keys.public_key()
    {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    let mut media_paths = std::collections::HashMap::new();
    for event in events.iter().filter(|event| event.kind.as_u16() == 0) {
        let content: Value = serde_json::from_str(&event.content)
            .map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
        media_paths.extend(crate::web_profile::avatar_media_paths(
            content.get("picture").and_then(Value::as_str),
            &before.community_host,
        ));
    }
    Ok(PulseResponse {
        page: QueryResponse {
            events: serde_json::to_value(events)
                .map_err(|_| StatusCode::BAD_GATEWAY.into_response())?,
            next_cursor: None,
        },
        media_paths,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publication_is_a_closed_original_operation_not_raw_event_input() {
        let request =
            |value| serde_json::from_value::<contracts::PulsePublishRequest>(value).unwrap();
        assert_eq!(
            publication_kind(&request(json!({"operation":"NOTE","content":"hello"}))).unwrap(),
            1
        );
        let id = "a".repeat(64);
        assert_eq!(
            publication_kind(&request(
                json!({"operation":"LIKE","content":"+","targetEventId":id})
            ))
            .unwrap(),
            7
        );
        assert_eq!(
            publication_kind(&request(
                json!({"operation":"UNLIKE","content":"","targetEventId":id})
            ))
            .unwrap(),
            5
        );
        for invalid in [
            json!({"operation":"LIKE","content":"+"}),
            json!({"operation":"LIKE","content":"arbitrary","targetEventId":id}),
            json!({"operation":"UNLIKE","content":"","targetEventId":id,"mentions":[id]}),
            json!({"operation":"NOTE","content":"reply","targetEventId":"not-an-event"}),
        ] {
            assert!(publication_kind(&request(invalid)).is_err());
        }
    }

    #[test]
    fn verifies_original_signatures_and_excludes_repository_comments() {
        let keys = nostr::Keys::generate();
        let signed = nostr::EventBuilder::new(nostr::Kind::TextNote, "original")
            .sign_with_keys(&keys)
            .unwrap();
        let row = serde_json::to_value(&signed).unwrap();
        assert!(is_note(&verified(json!([row]), &[1]).unwrap()[0]));
        let mut corrupt = serde_json::to_value(&signed).unwrap();
        corrupt["content"] = json!("changed");
        assert!(verified(json!([corrupt]), &[1]).is_err());
        assert!(verified(json!([signed]), &[7]).is_err());
        let comment = nostr::EventBuilder::new(nostr::Kind::TextNote, "repository")
            .tags([nostr::Tag::parse(["a", "30617:owner:repo"]).unwrap()])
            .sign_with_keys(&keys)
            .unwrap();
        assert!(!is_note(&comment));
    }
}
