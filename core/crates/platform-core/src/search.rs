//! REQ-24 / DD-39: original Buzz Relay FTS, not a Core search index.
use std::collections::{HashMap, HashSet};

use axum::{
    extract::State,
    http::{header::CACHE_CONTROL, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    bff::{resolve_execution_context, BffState, ExecutionContext},
    user_state::{ReadScope, ReadTarget},
    web_transport::{
        actor_keys, community_client, community_limits, page_limit, relay_error_response,
        AdmissionFailure, QueryResponse,
    },
};

// Fixed Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src-tauri/src/commands/messages.rs::build_search_messages_filter.
const SEARCH_KINDS: [u16; 4] = [9, 40002, 45001, 45003];

#[derive(sqlx::FromRow)]
struct SearchChannel {
    channel_id: Uuid,
    workspace_id: Option<Uuid>,
    conversation_id: Option<Uuid>,
}

/// Resolve native IDs only from existing bindings. A directory label is never
/// permission; every candidate must pass the original read admission as well.
async fn scopes(
    state: &BffState,
    ctx: &ExecutionContext,
    channel: Option<Uuid>,
) -> Result<HashMap<Uuid, (ReadTarget, ReadScope)>, Response> {
    let rows: Vec<SearchChannel> = sqlx::query_as(
        "select b.channel_id,w.id as workspace_id,null::uuid as conversation_id
         from projection.workspace_buzz_binding b
         join identity.workspace w on w.id=b.workspace_id and w.state='ACTIVE'
         where w.tenant_id=$1 and b.state='ACTIVE' and ($3::uuid is null or b.channel_id=$3)
         union all
         select c.channel_id,null::uuid,c.id from projection.conversation_buzz_binding c
         where c.tenant_id=$1 and c.state='ACTIVE' and $2=any(c.participant_principal_ids)
           and ($3::uuid is null or c.channel_id=$3)",
    )
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .bind(channel)
    .fetch_all(&state.pool)
    .await
    .map_err(crate::service_api::unavailable)?;
    let workspace_ids: Vec<_> = rows.iter().filter_map(|row| row.workspace_id).collect();
    let admitted = crate::web_transport::workspace_admissions(state, ctx, &workspace_ids)
        .await
        .map_err(IntoResponse::into_response)?;
    let mut result = HashMap::new();
    for row in rows {
        let target = match (row.workspace_id, row.conversation_id) {
            (Some(id), None) if admitted.get(&id).is_some_and(|epoch| epoch.is_member()) => {
                ReadTarget::Workspace(id)
            }
            (Some(_), None) => continue,
            (None, Some(id)) => ReadTarget::Conversation(id),
            _ => return Err(AdmissionFailure::BindingNotActive.into_response()),
        };
        let scope = target.admit(state, ctx).await?;
        if scope.channel_id() != row.channel_id.to_string()
            || result.insert(row.channel_id, (target, scope)).is_some()
        {
            return Err(AdmissionFailure::BindingNotActive.into_response());
        }
    }
    if channel.is_some_and(|id| !result.contains_key(&id)) {
        return Err(AdmissionFailure::Denied.into_response());
    }
    Ok(result)
}

#[allow(clippy::result_large_err)]
fn filter(
    request: &contracts::WebSearchQuery,
    channels: &[Uuid],
    cap: i64,
    frame_limit: usize,
) -> Result<Value, Response> {
    if request.q.trim().is_empty()
        || request.limit.is_some_and(|limit| limit < 1)
        || request.since.is_some_and(|time| time < 0)
        || request.until.is_some_and(|time| time < 0)
        || matches!((request.since, request.until), (Some(since), Some(until)) if since > until)
        || request.authors.as_ref().is_some_and(|authors| {
            authors.is_empty()
                || authors.len() as i64 > cap
                || authors.iter().any(|key| {
                    nostr::PublicKey::from_hex(key).is_err() || key != &key.to_ascii_lowercase()
                })
        })
    {
        return Err(StatusCode::BAD_REQUEST.into_response());
    }
    let mut filter = json!({
        "kinds": SEARCH_KINDS, "search": request.q.trim(), "search_mode":"prefix",
        "#h":channels, "limit":request.limit.unwrap_or(cap).min(cap),
    });
    if let Some(authors) = request
        .authors
        .as_ref()
        .filter(|authors| !authors.is_empty())
    {
        filter["authors"] = json!(authors);
    }
    if let Some(time) = request.since {
        filter["since"] = json!(time);
    }
    if let Some(time) = request.until {
        filter["until"] = json!(time);
    }
    if serde_json::to_vec(&[&filter])
        .map_err(|_| StatusCode::BAD_REQUEST.into_response())?
        .len()
        > frame_limit
    {
        return Err(StatusCode::PAYLOAD_TOO_LARGE.into_response());
    }
    Ok(filter)
}

#[allow(clippy::result_large_err)]
fn verified(
    value: Value,
    admitted: &HashMap<Uuid, (ReadTarget, ReadScope)>,
    request: &contracts::WebSearchQuery,
    cap: i64,
) -> Result<Vec<nostr::Event>, Response> {
    let rows = value
        .as_array()
        .ok_or_else(|| StatusCode::BAD_GATEWAY.into_response())?;
    if rows.len() as i64 > request.limit.unwrap_or(cap).min(cap) {
        return Err(StatusCode::BAD_GATEWAY.into_response());
    }
    let mut ids = HashSet::new();
    rows.iter()
        .map(|value| {
            let event: nostr::Event = serde_json::from_value(value.clone())
                .map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
            let channels: Vec<_> = event
                .tags
                .iter()
                .filter(|tag| tag.as_slice().first().is_some_and(|name| name == "h"))
                .collect();
            let channel = channels
                .first()
                .and_then(|tag| tag.as_slice().get(1))
                .and_then(|value| value.parse::<Uuid>().ok());
            if !SEARCH_KINDS.contains(&event.kind.as_u16())
                || event.verify().is_err()
                || !ids.insert(event.id)
                || channels.len() != 1
                || !channel.is_some_and(|id| admitted.contains_key(&id))
                || request.channel_id.as_deref().is_some_and(|id| {
                    channel.map(|channel| channel.to_string()).as_deref() != Some(id)
                })
                || request.authors.as_ref().is_some_and(|authors| {
                    !authors.is_empty() && !authors.contains(&event.pubkey.to_hex())
                })
                || request
                    .since
                    .is_some_and(|since| event.created_at.as_secs() < since as u64)
                || request
                    .until
                    .is_some_and(|until| event.created_at.as_secs() > until as u64)
            {
                return Err(StatusCode::BAD_GATEWAY.into_response());
            }
            Ok(event)
        })
        .collect()
}

pub(crate) async fn query(
    State(state): State<BffState>,
    headers: HeaderMap,
    Json(request): Json<contracts::WebSearchQuery>,
) -> Response {
    async fn read(
        state: &BffState,
        headers: &HeaderMap,
        request: contracts::WebSearchQuery,
    ) -> Result<QueryResponse, Response> {
        let ctx = resolve_execution_context(state, headers).await?;
        let before = crate::pulse::admit(state, &ctx).await?;
        let keys = actor_keys(state, &ctx).await?;
        let client = community_client(state, &keys, &before.community_host)?;
        let limits = community_limits(state, &before.community_host)
            .await
            .map_err(IntoResponse::into_response)?;
        let channel = request
            .channel_id
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|_| StatusCode::BAD_REQUEST.into_response())?;
        let admitted = scopes(state, &ctx, channel).await?;
        if admitted
            .values()
            .any(|(_, scope)| scope.community_host() != before.community_host)
        {
            return Err(AdmissionFailure::BindingNotActive.into_response());
        }
        let mut channels: Vec<_> = admitted.keys().copied().collect();
        channels.sort_unstable();
        let cap = page_limit(state, &limits);
        let filter = filter(&request, &channels, cap, limits.max_message_length)?;
        let events = if channels.is_empty() {
            Vec::new()
        } else {
            verified(
                client
                    .query(&state.http, &[filter])
                    .await
                    .map_err(|error| relay_error_response(&error, None))?,
                &admitted,
                &request,
                cap,
            )?
        };
        let after_ctx = resolve_execution_context(state, headers).await?;
        if after_ctx.human_identity_id != ctx.human_identity_id
            || after_ctx.tenant_id != ctx.tenant_id
            || after_ctx.tenant_principal_id != ctx.tenant_principal_id
            || after_ctx.session_id != ctx.session_id
            || after_ctx.access_mode != ctx.access_mode
        {
            return Err(AdmissionFailure::Denied.into_response());
        }
        // Re-read every returned resource after the remote read, not just the
        // tenant or directory. Revocation/binding drift cannot leak stale hits.
        for event in &events {
            let channel = event
                .tags
                .iter()
                .find(|tag| tag.as_slice().first().is_some_and(|name| name == "h"))
                .and_then(|tag| tag.as_slice().get(1))
                .and_then(|id| id.parse::<Uuid>().ok())
                .ok_or_else(|| StatusCode::BAD_GATEWAY.into_response())?;
            let (target, scope) = admitted
                .get(&channel)
                .ok_or_else(|| AdmissionFailure::Denied.into_response())?;
            if !scope.same_admission(&target.admit(state, &after_ctx).await?) {
                return Err(AdmissionFailure::BindingNotActive.into_response());
            }
        }
        if crate::pulse::admit(state, &after_ctx).await? != before
            || actor_keys(state, &after_ctx).await?.public_key() != keys.public_key()
        {
            return Err(AdmissionFailure::BindingNotActive.into_response());
        }
        Ok(QueryResponse {
            events: json!(events),
            next_cursor: None,
        })
    }
    match read(&state, &headers, request).await {
        Ok(page) => ([(CACHE_CONTROL, "no-store")], Json(page)).into_response(),
        Err(response) => response,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> contracts::WebSearchQuery {
        serde_json::from_value(json!({"q":" original "})).unwrap()
    }

    fn admitted(channel: Uuid) -> HashMap<Uuid, (ReadTarget, ReadScope)> {
        HashMap::from([(
            channel,
            (
                ReadTarget::Conversation(Uuid::new_v4()),
                ReadScope::Conversation(crate::conversations::ConversationScope {
                    channel_id: channel.to_string(),
                    community_host: "fixture.invalid".into(),
                    binding_version: 1,
                    tenant_binding_version: 1,
                }),
            ),
        )])
    }

    fn event(keys: &nostr::Keys, channel: Uuid, kind: u16) -> nostr::Event {
        nostr::EventBuilder::new(nostr::Kind::Custom(kind), "original result")
            .tags([nostr::Tag::parse(["h".to_owned(), channel.to_string()]).unwrap()])
            .custom_created_at(nostr::Timestamp::from(100))
            .sign_with_keys(keys)
            .unwrap()
    }

    #[test]
    fn original_typed_query_is_bounded_to_admitted_channels_and_runtime_limits() {
        let channel = Uuid::new_v4();
        let key = nostr::Keys::generate().public_key().to_hex();
        let mut request = request();
        request.limit = Some(50);
        request.authors = Some(vec![key.clone()]);
        request.since = Some(0);
        request.until = Some(100);
        assert_eq!(
            filter(&request, &[channel], 12, 4096).unwrap(),
            json!({
                "kinds":[9,40002,45001,45003],"search":"original","search_mode":"prefix",
                "#h":[channel],"limit":12,"authors":[key],"since":0,"until":100,
            })
        );
    }

    #[test]
    fn invalid_operators_and_oversized_frames_are_not_sent_to_relay() {
        for value in [
            json!({"q":" "}),
            json!({"q":"original","limit":0}),
            json!({"q":"original","since":-1}),
            json!({"q":"original","since":2,"until":1}),
            json!({"q":"original","authors":[]}),
            json!({"q":"original","authors":["unknown"]}),
        ] {
            let request = serde_json::from_value(value).unwrap();
            assert_eq!(
                filter(&request, &[Uuid::new_v4()], 12, 4096)
                    .err()
                    .unwrap()
                    .status(),
                StatusCode::BAD_REQUEST
            );
        }
        assert_eq!(
            filter(&request(), &[Uuid::new_v4()], 12, 1)
                .err()
                .unwrap()
                .status(),
            StatusCode::PAYLOAD_TOO_LARGE
        );
    }

    #[test]
    fn signed_original_fts_hits_preserve_order_without_another_search_authority() {
        let channel = Uuid::new_v4();
        let keys = nostr::Keys::generate();
        let first = event(&keys, channel, 40002);
        let second = event(&keys, channel, 9);
        let post = event(&keys, channel, 45001);
        let reply = event(&keys, channel, 45003);
        let output = verified(
            json!([first, second, post, reply]),
            &admitted(channel),
            &request(),
            12,
        )
        .unwrap();
        assert_eq!(
            output
                .iter()
                .map(|event| event.kind.as_u16())
                .collect::<Vec<_>>(),
            [40002, 9, 45001, 45003]
        );
    }

    #[test]
    fn forged_cross_scope_duplicate_unknown_kind_and_filter_drift_fail_closed() {
        let channel = Uuid::new_v4();
        let keys = nostr::Keys::generate();
        let actual = event(&keys, channel, 9);
        let mut forged = serde_json::to_value(&actual).unwrap();
        forged["content"] = json!("changed after signing");
        for rows in [
            json!([event(&keys, Uuid::new_v4(), 9)]),
            json!([actual, actual]),
            json!([event(&keys, channel, 0)]),
            json!([forged]),
            json!([{"content":"not an event"}]),
        ] {
            assert_eq!(
                verified(rows, &admitted(channel), &request(), 12)
                    .err()
                    .unwrap()
                    .status(),
                StatusCode::BAD_GATEWAY
            );
        }
        for value in [
            json!({"q":"original","authors":[nostr::Keys::generate().public_key().to_hex()]}),
            json!({"q":"original","since":101}),
            json!({"q":"original","until":99}),
        ] {
            let request = serde_json::from_value(value).unwrap();
            assert_eq!(
                verified(json!([actual]), &admitted(channel), &request, 12)
                    .err()
                    .unwrap()
                    .status(),
                StatusCode::BAD_GATEWAY
            );
        }
    }
}
