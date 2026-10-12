//! Original Buzz 30300 reminders: Relay ciphertext is the only stored body.
//! DD-72/75/77: this BFF path only uses the current HUMAN SERVER key.
use crate::{
    bff::{resolve_execution_context, BffState, ExecutionContext},
    pulse,
    web_transport::{actor_keys, community_client, community_limits, relay_error_response},
};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use collab_bridge::bridge::IdentityClient;
use contracts::{ReminderContent, ReminderPublishRequest, ReminderView};
use nostr::Event;
use serde_json::{json, Value};
use uuid::Uuid;

pub(crate) const PUBLISH_ACTION: &str = "reminders.publish";

#[allow(clippy::result_large_err)]
fn invalid() -> Response {
    StatusCode::BAD_REQUEST.into_response()
}

/// Same plaintext acceptance as fixed Buzz reminderService::parseReminderContent.
/// Unknown status/invalid target is not guessed into a pending reminder.
fn content(plaintext: &str) -> Option<ReminderContent> {
    let value: Value = serde_json::from_str(plaintext).ok()?;
    let object = value.as_object()?;
    if !matches!(
        object.get("status")?.as_str()?,
        "pending" | "done" | "cancelled"
    ) || object.get("note").is_some_and(|v| !v.is_string())
    {
        return None;
    }
    if let Some(target) = object.get("target") {
        let target = target.as_object()?;
        if ["eventId", "channelId", "preview", "authorPubkey"]
            .iter()
            .any(|key| !target.get(*key).is_some_and(Value::is_string))
        {
            return None;
        }
    } else if object
        .get("note")
        .and_then(Value::as_str)
        .is_none_or(|v| v.is_empty())
    {
        return None;
    }
    serde_json::from_value(value).ok()
}

fn view(client: &IdentityClient, event: &Event) -> Option<ReminderView> {
    let id = event.tags.identifier()?.to_owned();
    if id.is_empty() {
        return None;
    }
    let content = content(&client.decrypt_reminder(event).ok()?)?;
    let raw = event.tags.iter().find_map(|tag| {
        let values = tag.as_slice();
        (values.first().is_some_and(|v| v == "not_before"))
            .then(|| values.get(1))
            .flatten()
    });
    let not_before = raw.and_then(|v| {
        if v.is_empty()
            || v.len() > 1 && v.starts_with('0')
            || !v.bytes().all(|c| c.is_ascii_digit())
        {
            return None;
        }
        v.parse::<i64>().ok().filter(|v| *v <= buzz_safe_integer())
    });
    Some(ReminderView {
        id,
        content,
        not_before,
        created_at: i64::try_from(event.created_at.as_secs()).ok()?,
        event_id: event.id.to_hex(),
    })
}

// Original NIP-ER parseNotBefore uses JavaScript Number.MAX_SAFE_INTEGER.
fn buzz_safe_integer() -> i64 {
    (1_i64 << f64::MANTISSA_DIGITS) - 1
}

pub(crate) async fn query(State(state): State<BffState>, headers: HeaderMap) -> Response {
    match query_inner(&state, &headers).await {
        Ok(value) => (
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            Json(value),
        )
            .into_response(),
        Err(error) => error,
    }
}

async fn query_inner(state: &BffState, headers: &HeaderMap) -> Result<Value, Response> {
    let ctx = resolve_execution_context(state, headers).await?;
    let before = pulse::admit(state, &ctx).await?;
    let keys = actor_keys(state, &ctx).await?;
    let client = community_client(state, &keys, &before.community_host)?;
    let cap = community_limits(state, &before.community_host)
        .await
        .map_err(IntoResponse::into_response)?
        .max_limit;
    if cap <= 0 {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    let value = client
        .query(
            &state.http,
            &[json!({"kinds":[30300],"authors":[client.pubkey_hex()],"limit":cap})],
        )
        .await
        .map_err(|e| relay_error_response(&e, None))?;
    let events: Vec<Event> =
        serde_json::from_value(value).map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
    // Never label a potentially truncated author inbox as a complete snapshot.
    if events.len() as i64 >= cap {
        return Err(crate::web_transport::limit_response(
            collab_bridge::operator::LimitKind::PayloadTooLarge,
            None,
            None,
        ));
    }
    if events.iter().any(|event| {
        event.kind.as_u16() != 30300 || event.pubkey != keys.public_key() || event.verify().is_err()
    }) {
        return Err(StatusCode::BAD_GATEWAY.into_response());
    }
    let reminders: Vec<_> = events
        .iter()
        .filter_map(|event| view(&client, event))
        .collect();
    if pulse::admit(state, &ctx).await? != before
        || actor_keys(state, &ctx).await?.public_key() != keys.public_key()
    {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    Ok(json!({"pubkey":client.pubkey_hex(),"reminders":reminders}))
}

#[allow(clippy::result_large_err)]
pub(crate) fn validate(request: &ReminderPublishRequest) -> Result<(), Response> {
    let operation = serde_json::to_value(&request.operation).map_err(|_| invalid())?;
    if request
        .event_id
        .as_deref()
        .is_some_and(|v| nostr::EventId::from_hex(v).map_or(true, |id| id.to_hex() != v))
        || request
            .source_event_id
            .as_deref()
            .is_some_and(|v| nostr::EventId::from_hex(v).map_or(true, |id| id.to_hex() != v))
        || request
            .not_before
            .is_some_and(|v| v < 0 || v > buzz_safe_integer())
    {
        return Err(invalid());
    }
    let valid = match operation.as_str() {
        Some("CREATE") => {
            request.event_id.is_none()
                && request.not_before.is_some()
                && request.source_event_id.is_some()
                && request
                    .channel_id
                    .as_deref()
                    .is_some_and(|id| id.parse::<Uuid>().is_ok())
        }
        Some("SNOOZE") => {
            request.event_id.is_some()
                && request.not_before.is_some()
                && request.source_event_id.is_none()
                && request.channel_id.is_none()
                && request.note.is_none()
        }
        Some("COMPLETE" | "CANCEL") => {
            request.event_id.is_some()
                && request.not_before.is_none()
                && request.source_event_id.is_none()
                && request.channel_id.is_none()
                && request.note.is_none()
        }
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(invalid())
    }
}

/// Read current signed head, not a client-supplied decrypted snapshot.
pub(crate) async fn head(
    state: &BffState,
    client: &IdentityClient,
    id: &str,
) -> Result<(Event, ReminderView), Response> {
    let raw = client
        .query(
            &state.http,
            &[json!({"kinds":[30300],"ids":[id],"authors":[client.pubkey_hex()],"limit":1})],
        )
        .await
        .map_err(|e| relay_error_response(&e, None))?;
    let rows: Vec<Event> =
        serde_json::from_value(raw).map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
    let [event] = rows.as_slice() else {
        return Err(StatusCode::NOT_FOUND.into_response());
    };
    if event.id.to_hex() != id {
        return Err(StatusCode::BAD_GATEWAY.into_response());
    }
    let reminder = view(client, event).ok_or_else(|| StatusCode::BAD_GATEWAY.into_response())?;
    let raw = client.query(&state.http, &[json!({"kinds":[30300],"#d":[reminder.id],"authors":[client.pubkey_hex()],"limit":1})])
        .await.map_err(|e| relay_error_response(&e, None))?;
    let heads: Vec<Event> =
        serde_json::from_value(raw).map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
    if heads.as_slice() != [event.clone()] {
        return Err(StatusCode::CONFLICT.into_response());
    }
    Ok((event.clone(), reminder))
}

/// A prior ACCEPTED receipt proves the old event, not any new request using its key.
fn accepted_matches(
    reminder: &ReminderView,
    request: &ReminderPublishRequest,
    parent_event_id: Option<&str>,
) -> bool {
    if parent_event_id
        != request
            .event_id
            .as_deref()
            .or(request.source_event_id.as_deref())
    {
        return false;
    }
    let operation = serde_json::to_value(&request.operation).ok();
    let status = serde_json::to_value(&reminder.content.status).ok();
    match operation.as_ref().and_then(Value::as_str) {
        Some("CREATE") => {
            status == Some(json!("pending"))
                && reminder.not_before == request.not_before
                && reminder.content.note == request.note
                && reminder.content.target.as_ref().is_some_and(|target| {
                    Some(target.event_id.as_str()) == request.source_event_id.as_deref()
                        && request
                            .channel_id
                            .as_deref()
                            .and_then(|id| id.parse::<Uuid>().ok())
                            == target.channel_id.parse::<Uuid>().ok()
                })
        }
        Some("SNOOZE") => {
            status == Some(json!("pending")) && reminder.not_before == request.not_before
        }
        Some("COMPLETE") => status == Some(json!("done")) && reminder.not_before.is_none(),
        Some("CANCEL") => status == Some(json!("cancelled")) && reminder.not_before.is_none(),
        _ => false,
    }
}

pub(crate) async fn confirm_accepted(
    state: &BffState,
    ctx: &ExecutionContext,
    request: &ReminderPublishRequest,
    event_id: &str,
    parent_event_id: Option<&str>,
    operation_id: Uuid,
) -> Result<(), Response> {
    let unknown = || {
        crate::web_transport::error_body(
            StatusCode::SERVICE_UNAVAILABLE,
            contracts::ErrorClass::Unknown,
            contracts::ReasonCode::PublishResultUnknown,
            Some(operation_id),
        )
    };
    let before = pulse::admit(state, ctx).await?;
    let keys = actor_keys(state, ctx).await?;
    let client = community_client(state, &keys, &before.community_host)?;
    if let (Some(channel), Some(source_id)) = (&request.channel_id, &request.source_event_id) {
        source(
            state,
            ctx,
            &client,
            channel.parse().map_err(|_| invalid())?,
            source_id,
        )
        .await?;
    }
    let raw = client
        .query(
            &state.http,
            &[json!({
                "ids":[event_id],"kinds":[30300],"authors":[client.pubkey_hex()],"limit":1
            })],
        )
        .await
        .map_err(|_| unknown())?;
    let events: Vec<Event> = serde_json::from_value(raw).map_err(|_| unknown())?;
    let [event] = events.as_slice() else {
        return Err(unknown());
    };
    if event.id.to_hex() != event_id {
        return Err(unknown());
    }
    let reminder = view(&client, event).ok_or_else(unknown)?;
    if pulse::admit(state, ctx).await? != before
        || actor_keys(state, ctx).await?.public_key() != keys.public_key()
    {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    if !accepted_matches(&reminder, request, parent_event_id) {
        return Err(StatusCode::CONFLICT.into_response());
    }
    Ok(())
}

pub(crate) async fn source(
    state: &BffState,
    ctx: &ExecutionContext,
    client: &IdentityClient,
    channel: Uuid,
    id: &str,
) -> Result<Event, Response> {
    crate::user_state::require_visible_channel(state, ctx, channel).await?;
    let event =
        crate::web_transport::read_message_event(state, client, &channel.to_string(), id).await?;
    crate::user_state::require_visible_channel(state, ctx, channel).await?;
    Ok(event)
}

pub(crate) struct Prepared {
    pub content: ReminderContent,
    pub tags: Vec<Vec<String>>,
    pub created_at: u64,
}

pub(crate) async fn read_source(
    State(state): State<BffState>,
    headers: HeaderMap,
    Json(request): Json<contracts::ReminderSourceRequest>,
) -> Response {
    match read_source_inner(&state, &headers, request).await {
        Ok(event) => (
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            Json(json!({"event":event})),
        )
            .into_response(),
        Err(error) => error,
    }
}

async fn read_source_inner(
    state: &BffState,
    headers: &HeaderMap,
    request: contracts::ReminderSourceRequest,
) -> Result<Event, Response> {
    let channel = request.channel_id.parse::<Uuid>().map_err(|_| invalid())?;
    let ctx = resolve_execution_context(state, headers).await?;
    let before = pulse::admit(state, &ctx).await?;
    let keys = actor_keys(state, &ctx).await?;
    let client = community_client(state, &keys, &before.community_host)?;
    let event = source(state, &ctx, &client, channel, &request.event_id).await?;
    if pulse::admit(state, &ctx).await? != before
        || actor_keys(state, &ctx).await?.public_key() != keys.public_key()
    {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    Ok(event)
}

pub(crate) async fn prepare(
    state: &BffState,
    ctx: &ExecutionContext,
    client: &IdentityClient,
    request: &ReminderPublishRequest,
) -> Result<Prepared, Response> {
    validate(request)?;
    let operation = serde_json::to_value(&request.operation).map_err(|_| invalid())?;
    let now = chrono::Utc::now().timestamp();
    let mut entropy = [0_u8; 16];
    getrandom::fill(&mut entropy).map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    let (id, mut content, created_at): (String, ReminderContent, i64) = if operation == "CREATE" {
        let channel = request
            .channel_id
            .as_deref()
            .and_then(|v| v.parse::<Uuid>().ok())
            .ok_or_else(invalid)?;
        let message = source(
            state,
            ctx,
            client,
            channel,
            request.source_event_id.as_deref().ok_or_else(invalid)?,
        )
        .await?;
        // Original MessageRow/HomeView preview is body.slice(0,100), in UTF-16.
        let preview =
            String::from_utf16_lossy(&message.content.encode_utf16().take(100).collect::<Vec<_>>());
        let mut body = json!({"status":"pending","target":{
            "eventId":message.id.to_hex(),"channelId":channel.to_string(),
            "preview":preview,"authorPubkey":message.pubkey.to_hex()}});
        if let Some(note) = &request.note {
            body["note"] = json!(note);
        }
        let id = entropy
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        (
            id,
            serde_json::from_value(body).map_err(|_| invalid())?,
            now,
        )
    } else {
        let (event, previous) = head(
            state,
            client,
            request.event_id.as_deref().ok_or_else(invalid)?,
        )
        .await?;
        (
            previous.id,
            previous.content,
            now.max(
                i64::try_from(event.created_at.as_secs())
                    .map_err(|_| invalid())?
                    .checked_add(1)
                    .ok_or_else(invalid)?,
            ),
        )
    };
    let status = match operation.as_str() {
        Some("COMPLETE") => "done",
        Some("CANCEL") => "cancelled",
        _ => "pending",
    };
    content.status = serde_json::from_value(json!(status)).map_err(|_| invalid())?;
    let mut tags = vec![vec!["d".into(), id]];
    if status == "pending" {
        tags.push(vec![
            "not_before".into(),
            request.not_before.ok_or_else(invalid)?.to_string(),
        ]);
    } else {
        // Original reminderService::jitteredExpiration: 30 + floor(random*60) days.
        let jitter = u32::from_le_bytes(entropy[..4].try_into().map_err(|_| invalid())?) as u64;
        let days = 30 + jitter * 60 / (u64::from(u32::MAX) + 1);
        let expiration = now
            .checked_add(i64::try_from(days * 86_400).map_err(|_| invalid())?)
            .ok_or_else(invalid)?;
        tags.push(vec!["expiration".into(), expiration.to_string()]);
    }
    let plaintext = serde_json::to_vec(&content).map_err(|_| invalid())?;
    if plaintext.len() > state.message_max_content_bytes
        || plaintext.len() > collab_bridge::memory::NIP44_PLAINTEXT_MAX
    {
        return Err(crate::web_transport::limit_response(
            collab_bridge::operator::LimitKind::PayloadTooLarge,
            None,
            None,
        ));
    }
    Ok(Prepared {
        content,
        tags,
        created_at: u64::try_from(created_at).map_err(|_| invalid())?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepted_receipt_checks_signed_plaintext_and_current_typed_intent() {
        let keys = nostr::Keys::generate();
        let client = IdentityClient::new(
            collab_bridge::bridge::Custody::Server,
            &keys.secret_key().to_secret_hex(),
            "http://relay.test",
            "community.test",
        )
        .unwrap();
        let source_id = "ab".repeat(32);
        let channel_id = Uuid::new_v4().to_string();
        let content: ReminderContent = serde_json::from_value(json!({
            "status":"pending","note":"original private note","target":{
                "eventId":source_id,"channelId":channel_id,"preview":"old preview",
                "authorPubkey":keys.public_key().to_hex()
            }
        }))
        .unwrap();
        let published = client
            .sign_reminder(
                &content,
                &[
                    vec!["d".into(), "same-reminder".into()],
                    vec!["not_before".into(), "12".into()],
                ],
                17,
            )
            .unwrap();
        let reminder = view(&client, &published).unwrap();
        let create = json!({"operation":"CREATE","channelId":channel_id,
            "sourceEventId":source_id,"notBefore":12,"note":"original private note"});
        let request: ReminderPublishRequest = serde_json::from_value(create.clone()).unwrap();
        assert!(accepted_matches(&reminder, &request, Some(&source_id)));
        for (field, value) in [
            ("note", json!("different private note")),
            ("notBefore", json!(13)),
            ("sourceEventId", json!("cd".repeat(32))),
            ("channelId", json!(Uuid::new_v4().to_string())),
        ] {
            let mut changed = create.clone();
            changed[field] = value;
            let changed: ReminderPublishRequest = serde_json::from_value(changed).unwrap();
            assert!(!accepted_matches(
                &reminder,
                &changed,
                changed.source_event_id.as_deref()
            ));
        }
        let parent = "ef".repeat(32);
        let snooze: ReminderPublishRequest = serde_json::from_value(json!({
            "operation":"SNOOZE","eventId":parent,"notBefore":12
        }))
        .unwrap();
        assert!(accepted_matches(&reminder, &snooze, Some(&parent)));
        assert!(!accepted_matches(&reminder, &snooze, Some(&source_id)));
        for operation in ["COMPLETE", "CANCEL"] {
            let request: ReminderPublishRequest = serde_json::from_value(json!({
                "operation":operation,"eventId":parent
            }))
            .unwrap();
            assert!(!accepted_matches(&reminder, &request, Some(&parent)));
        }
        let mut complete_content = content.clone();
        complete_content.status = serde_json::from_value(json!("done")).unwrap();
        let completed = client
            .sign_reminder(
                &complete_content,
                &[vec!["d".into(), "same-reminder".into()]],
                18,
            )
            .unwrap();
        let complete: ReminderPublishRequest = serde_json::from_value(json!({
            "operation":"COMPLETE","eventId":parent
        }))
        .unwrap();
        assert!(accepted_matches(
            &view(&client, &completed).unwrap(),
            &complete,
            Some(&parent)
        ));
        let mut corrupted = published;
        corrupted.created_at = nostr::Timestamp::from(19);
        assert!(view(&client, &corrupted).is_none());
    }

    #[test]
    fn reminder_plaintext_and_typed_operations_preserve_original_status_boundary() {
        assert!(content(r#"{"status":"pending","note":"personal"}"#).is_some());
        assert!(content(r#"{"status":"done","target":{"eventId":"","channelId":"","preview":"","authorPubkey":""}}"#).is_some());
        for text in [
            r#"{"status":"unknown","note":"x"}"#,
            r#"{"status":"pending","note":""}"#,
            r#"{"status":"pending","target":{}}"#,
            "[]",
        ] {
            assert!(content(text).is_none());
        }
        let create = json!({"operation":"CREATE","channelId":Uuid::new_v4().to_string(),"sourceEventId":"ab".repeat(32),"notBefore":0});
        let request: ReminderPublishRequest = serde_json::from_value(create.clone()).unwrap();
        assert!(validate(&request).is_ok());
        for (key, value) in [
            ("eventId", json!("cd".repeat(32))),
            ("notBefore", json!(buzz_safe_integer() + 1)),
            ("channelId", json!("not-a-channel")),
        ] {
            let mut invalid = create.clone();
            invalid[key] = value;
            assert!(validate(&serde_json::from_value(invalid).unwrap()).is_err());
        }
        for operation in ["COMPLETE", "CANCEL", "SNOOZE"] {
            let mut value = json!({"operation":operation,"eventId":"ef".repeat(32)});
            if operation == "SNOOZE" {
                value["notBefore"] = json!(0);
            }
            assert!(validate(&serde_json::from_value(value.clone()).unwrap()).is_ok());
            value["note"] = json!("must not overwrite frozen content");
            assert!(validate(&serde_json::from_value(value).unwrap()).is_err());
        }
    }
}
