use buzz_core_pkg::relay::{BRIDGE_THREAD_MAX_LIMIT, DEFAULT_THREAD_DEPTH_LIMIT};
use tauri::State;

use crate::{
    app_state::AppState,
    events,
    models::{
        FeedItemCategory, FeedItemInfo, FeedMeta, FeedResponse, FeedSections, SearchResponse,
        SendChannelMessageResponse, ThreadRepliesResponse,
    },
    nostr_convert,
    relay::{assert_expected_relay_scope, assert_expected_signer, query_relay},
};

// ── Reads (pure-nostr) ──────────────────────────────────────────────────────

/// Timeline content kinds — the message/channel-event kinds that make up a
/// channel timeline and a thread's replies. Used to build relay `/query`
/// filters for the keyset readers below. None of these are in
/// `P_GATED_KINDS`, so a filter carrying them clears the bridge p-gate
/// (`p_gated_filters_authorized`) without a `#p` tag — load-bearing for the
/// thread-subtree read, whose relay routing keys off `#e`+`depth_limit` (not
/// kind) but still passes through the p-gate before it runs.
const TIMELINE_KINDS: [u32; 3] = [9, 40002, 40099];

#[tauri::command]
pub async fn get_feed(
    since: Option<i64>,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<FeedResponse, String> {
    let cap = limit.unwrap_or(50).min(100);

    let my_pubkey = {
        let keys = state.keys.lock().map_err(|e| e.to_string())?;
        keys.public_key().to_hex()
    };

    // Mentions: channel messages that reference me via #p.
    let mut mention_filter = serde_json::json!({
        "kinds": [9],
        "#p": [my_pubkey],
        "limit": cap,
    });
    if let Some(s) = since {
        mention_filter["since"] = serde_json::json!(s);
    }

    let mentions: Vec<FeedItemInfo> = query_relay(&state, &[mention_filter])
        .await
        .unwrap_or_default()
        .iter()
        .map(|ev| feed_item_from_event(ev, FeedItemCategory::Mention))
        .collect();

    let total = mentions.len() as u64;
    Ok(FeedResponse {
        feed: FeedSections { mentions },
        meta: FeedMeta {
            since: since.unwrap_or(0),
            total,
            generated_at: chrono::Utc::now().timestamp(),
        },
    })
}

fn build_search_messages_filter(
    q: &str,
    cap: u32,
    channel_id: Option<&str>,
    authors: Option<&[String]>,
    since: Option<i64>,
    until: Option<i64>,
) -> serde_json::Value {
    let mut filter = serde_json::Map::new();
    filter.insert("kinds".to_string(), serde_json::json!([9, 40002]));
    filter.insert("search".to_string(), serde_json::json!(q.trim()));
    // The desktop topbar is a typeahead surface. This bridge-only extension is
    // consumed before nostr::Filter parsing on the relay, so general WS/NIP-50
    // search remains word/lexeme-based.
    filter.insert("search_mode".to_string(), serde_json::json!("prefix"));
    filter.insert("limit".to_string(), serde_json::json!(cap));
    if let Some(cid) = channel_id {
        filter.insert("#h".to_string(), serde_json::json!([cid]));
    }
    // Optional operators from the desktop search parser (#2853). The relay
    // already maps authors/since/until onto FTS; search remains never the
    // access boundary (hits are refetched and re-authorized).
    if let Some(authors) = authors {
        let cleaned: Vec<&str> = authors
            .iter()
            .map(|a| a.trim())
            .filter(|a| !a.is_empty())
            .collect();
        if !cleaned.is_empty() {
            filter.insert("authors".to_string(), serde_json::json!(cleaned));
        }
    }
    if let Some(since) = since {
        filter.insert("since".to_string(), serde_json::json!(since));
    }
    if let Some(until) = until {
        filter.insert("until".to_string(), serde_json::json!(until));
    }
    serde_json::Value::Object(filter)
}

#[tauri::command]
pub async fn search_messages(
    q: String,
    limit: Option<u32>,
    channel_id: Option<String>,
    authors: Option<Vec<String>>,
    since: Option<i64>,
    until: Option<i64>,
    state: State<'_, AppState>,
) -> Result<SearchResponse, String> {
    let cap = search_messages_limit(limit);
    let filter = build_search_messages_filter(
        &q,
        cap,
        channel_id.as_deref(),
        authors.as_deref(),
        since,
        until,
    );

    let events = query_relay(&state, &[filter]).await?;
    Ok(nostr_convert::search_response_from_events(&events))
}

fn search_messages_limit(limit: Option<u32>) -> u32 {
    limit.unwrap_or(20).min(500)
}

/// Fetch the reply subtree and its auxiliary events under a thread root.
///
/// Paging is forward keyset on `(created_at, event_id)`: pass the `next_cursor`
/// from a previous page back as `cursor` to fetch the next batch. The event-id
/// tiebreak prevents same-second replies from being skipped.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn get_thread_replies(
    root_event_id: String,
    channel_id: Option<String>,
    limit: Option<u32>,
    depth_limit: Option<u32>,
    cursor: Option<crate::models::ThreadCursor>,
    forum_thread: Option<bool>,
    expected_relay_url: Option<String>,
    expected_signer_pubkey: Option<String>,
    state: State<'_, AppState>,
) -> Result<ThreadRepliesResponse, String> {
    let cap = limit.unwrap_or(200).min(BRIDGE_THREAD_MAX_LIMIT);
    let mut filter = build_thread_replies_filter(
        &root_event_id,
        channel_id.as_deref(),
        depth_limit.unwrap_or(DEFAULT_THREAD_DEPTH_LIMIT),
        cap,
        cursor.as_ref(),
    );
    if forum_thread.unwrap_or(false) {
        filter.insert("kinds".to_string(), serde_json::json!([9, 45003]));
    }

    let relay_base = crate::relay::relay_api_base_url_with_override(&state);
    let keys = state.signing_keys()?;
    assert_expected_relay_scope(expected_relay_url.as_deref(), &relay_base)?;
    assert_expected_signer(
        expected_signer_pubkey.as_deref(),
        &keys.public_key().to_hex(),
    )?;
    let events = crate::relay::query_relay_at_with_keys(
        &state,
        &relay_base,
        &[serde_json::Value::Object(filter)],
        &keys,
        None,
    )
    .await?;

    // A full page implies there may be more; hand back the last event's
    // composite key as the next cursor (the DB returns replies strictly after
    // it, tiebroken by event_id so same-second replies are not skipped).
    let reply_events: Vec<_> = events
        .iter()
        .filter(|event| {
            if forum_thread.unwrap_or(false) {
                matches!(event.kind.as_u16(), 9 | 45003)
            } else {
                TIMELINE_KINDS.contains(&(event.kind.as_u16() as u32))
            }
        })
        .collect();
    let next_cursor = if reply_events.len() as u32 >= cap {
        reply_events.last().map(|ev| crate::models::ThreadCursor {
            created_at: ev.created_at.as_secs() as i64,
            event_id: ev.id.to_hex(),
        })
    } else {
        None
    };

    let event_values: Vec<serde_json::Value> = events
        .iter()
        .filter_map(|ev| serde_json::to_value(ev).ok())
        .collect();

    Ok(ThreadRepliesResponse {
        events: event_values,
        next_cursor,
    })
}

/// Build the relay `/query` filter for a thread-subtree read.
/// `kinds` is required to prove the filter cannot match p-gated events; without
/// it, relay authorization rejects this otherwise kindless query.
fn build_thread_replies_filter(
    root_event_id: &str,
    channel_id: Option<&str>,
    depth_limit: u32,
    cap: u32,
    cursor: Option<&crate::models::ThreadCursor>,
) -> serde_json::Map<String, serde_json::Value> {
    let mut filter = serde_json::Map::new();
    filter.insert("#e".to_string(), serde_json::json!([root_event_id]));
    filter.insert("kinds".to_string(), serde_json::json!(TIMELINE_KINDS));
    // depth_limit is what activates the thread-subtree bridge path; the caller
    // defaults it to a deep-but-bounded value so nested replies aren't dropped.
    filter.insert("depth_limit".to_string(), serde_json::json!(depth_limit));
    filter.insert("limit".to_string(), serde_json::json!(cap));
    filter.insert("include_aux".to_string(), serde_json::json!(true));
    if let Some(cid) = channel_id {
        filter.insert("#h".to_string(), serde_json::json!([cid]));
    }
    if let Some(c) = cursor {
        filter.insert("thread_cursor".to_string(), serde_json::json!(c.created_at));
        filter.insert(
            "thread_cursor_id".to_string(),
            serde_json::json!(c.event_id),
        );
    }
    filter
}

mod event_batch;
pub use event_batch::{get_event, get_events};

// ── Writes ──────────────────────────────────────────────────────────────────

mod thread_ref;
use thread_ref::thread_ref;

pub(crate) mod unconfirmed;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn send_channel_message(
    channel_id: String,
    content: String,
    parent_event_id: Option<String>,
    root_event_id: Option<String>,
    media_tags: Option<Vec<Vec<String>>>,
    emoji_tags: Option<Vec<Vec<String>>>,
    mention_tags: Option<Vec<Vec<String>>>,
    link_preview_tags: Option<Vec<Vec<String>>>,
    sent_from_thread_tag: Option<Vec<String>>,
    mention_pubkeys: Option<Vec<String>>,
    expected_relay_url: Option<String>,
    expected_signer_pubkey: Option<String>,
    forum_kind: Option<events::ForumMessageKind>,
    state: State<'_, AppState>,
) -> Result<SendChannelMessageResponse, String> {
    let channel_uuid = uuid::Uuid::parse_str(&channel_id)
        .map_err(|_| format!("invalid channel UUID: {channel_id}"))?;
    let mentions = mention_pubkeys.unwrap_or_default();
    let mention_refs: Vec<&str> = mentions.iter().map(|s| s.as_str()).collect();
    let media = media_tags.unwrap_or_default();
    let mut emoji = emoji_tags.unwrap_or_default();
    let mention_refs_only = mention_tags.unwrap_or_default();
    let link_previews = link_preview_tags.unwrap_or_default();
    // Resolve the relay AND the signing identity once and use them for every
    // read and the submission. Callers that captured a tenant scope before an
    // await pass `expected_relay_url` and
    // `expected_signer_pubkey`; a mismatch on either means the active
    // community changed mid-flight and the send must fail closed rather than
    // publish the captured tenant's content to the new tenant's relay — or
    // sign it under the new tenant's identity. The relay check alone cannot
    // catch the latter: relay and keys mutate under separate locks during a
    // workspace switch, so the keys are snapshotted here, asserted, and that
    // exact snapshot signs the event and its NIP-98 auth below.
    let relay_base = crate::relay::relay_api_base_url_with_override(&state);
    assert_expected_relay_scope(expected_relay_url.as_deref(), &relay_base)?;
    let signing_keys = state.signing_keys()?;
    assert_expected_signer(
        expected_signer_pubkey.as_deref(),
        &signing_keys.public_key().to_hex(),
    )?;
    let palette_tags =
        super::custom_emoji::message_tags(&state, &relay_base, &signing_keys, &content).await?;
    emoji.retain(|tag| !palette_tags.iter().any(|known| known.get(1) == tag.get(1)));
    emoji.extend(palette_tags);
    if root_event_id.is_some() && parent_event_id.is_none() {
        return Err("root_event_id requires parent_event_id".into());
    }

    let mut resolved_root: Option<String> = None;
    let thread_ref = match parent_event_id.as_deref() {
        Some(pid) => {
            let tr = thread_ref(
                pid,
                root_event_id.as_deref(),
                &state,
                &relay_base,
                Some(&signing_keys),
            )
            .await?;
            resolved_root = Some(tr.root_event_id.to_hex());
            Some(tr)
        }
        None => None,
    };
    let builder = events::build_message_for_surface(
        channel_uuid,
        content.trim(),
        thread_ref.as_ref(),
        &mention_refs,
        &media,
        &emoji,
        &mention_refs_only,
        &link_previews,
        sent_from_thread_tag.as_deref(),
        &relay_base,
        &[],
        forum_kind,
    )?;

    // `created_at` is the signed event's own second, not a post-publication
    // clock read.
    // Submit through the base resolved (and scope-checked) above and the
    // identity snapshotted (and signer-checked) above — a re-resolve or key
    // re-read here would reopen the mid-command switch window.
    //
    // 同一内容上一次结果不明时原样重发那个已签名事件（见 `unconfirmed`），
    // Relay 以 `duplicate:` 接受，不会出现第二条消息。
    let fresh = builder
        .sign_with_keys(&signing_keys)
        .map_err(|e| format!("failed to sign event: {e}"))?;
    let (result, event) =
        unconfirmed::submit_reusing_unconfirmed(fresh, &state, &relay_base, &signing_keys).await?;
    let created_at = event.created_at.as_secs() as i64;

    let depth = match (&parent_event_id, &resolved_root) {
        (None, _) => 0,
        (Some(pid), Some(root)) if pid == root => 1,
        (Some(_), Some(_)) => 2,
        (Some(_), None) => 1,
    };

    Ok(SendChannelMessageResponse {
        event_id: result.event_id,
        root_event_id: resolved_root,
        parent_event_id,
        depth,
        created_at,
    })
}

/// The original kind-40003 edit, using the same scoped publisher and unknown
/// receipt cache as ordinary messages. The target is read, never client-trusted.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn edit_message(
    channel_id: String,
    event_id: String,
    content: String,
    media_tags: Vec<Vec<String>>,
    mention_pubkeys: Vec<String>,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    if expected_relay_url.trim().is_empty()
        || nostr::PublicKey::from_hex(&expected_signer_pubkey).is_err()
    {
        return Err("edit requires the captured community and signer".into());
    }
    let channel = uuid::Uuid::parse_str(&channel_id).map_err(|e| e.to_string())?;
    let target_id = nostr::EventId::from_hex(&event_id).map_err(|e| e.to_string())?;
    if content.trim().is_empty() && media_tags.is_empty() {
        return Err("empty edits require the separate deletion action".into());
    }
    let relay_base = crate::relay::relay_api_base_url_with_override(&state);
    let keys = state.signing_keys()?;
    assert_expected_relay_scope(Some(&expected_relay_url), &relay_base)?;
    assert_expected_signer(Some(&expected_signer_pubkey), &keys.public_key().to_hex())?;
    let targets = crate::relay::query_relay_at_with_keys(
        &state, &relay_base,
        &[serde_json::json!({"ids":[target_id.to_hex()],"kinds":[9,45001,45003],"#h":[channel.to_string()]})],
        &keys, None,
    ).await?;
    let target = targets
        .iter()
        .find(|event| event.id == target_id)
        .ok_or("edit target unavailable")?;
    target.verify().map_err(|e| e.to_string())?;
    if target.pubkey != keys.public_key()
        || !matches!(target.kind.as_u16(), 9 | 45001 | 45003)
        || channel_id_from_tags(target).as_deref() != Some(channel_id.as_str())
        || target
            .tags
            .iter()
            .filter(|tag| tag.as_slice().first().is_some_and(|key| key == "h"))
            .count()
            != 1
    {
        return Err("edit target author or channel mismatch".into());
    }
    let original_mentions: Vec<&str> = target
        .tags
        .iter()
        .filter_map(|tag| {
            let values = tag.as_slice();
            (values.first().map(String::as_str) == Some("p"))
                .then(|| values.get(1).map(String::as_str))
                .flatten()
        })
        .collect();
    let new_mentions: Vec<&str> = mention_pubkeys
        .iter()
        .map(String::as_str)
        .filter(|pubkey| !original_mentions.contains(pubkey))
        .collect();
    let emoji = super::custom_emoji::message_tags(&state, &relay_base, &keys, &content).await?;
    let builder = events::build_message_edit(
        channel,
        target_id,
        content.trim(),
        events::MessageEditTags {
            media: &media_tags,
            custom_emoji: &emoji,
            mentions: &new_mentions,
            mention_refs: None,
        },
        false,
    )?;
    let fresh = builder.sign_with_keys(&keys).map_err(|e| e.to_string())?;
    let intent_key = format!("edit:{relay_base}:{}:{target_id}", keys.public_key());
    let (event, first) = unconfirmed::claim_mutation(&intent_key, fresh)?;
    submit_message_mutation(
        event,
        first,
        &intent_key,
        &state,
        &relay_base,
        &keys,
        channel,
    )
    .await
}

/// Original author deletion (kind 5), not administrator deletion (9005).
#[tauri::command]
pub async fn delete_message(
    channel_id: String,
    event_id: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    if expected_relay_url.trim().is_empty()
        || nostr::PublicKey::from_hex(&expected_signer_pubkey).is_err()
    {
        return Err("deletion requires the captured community and signer".into());
    }
    let channel = uuid::Uuid::parse_str(&channel_id).map_err(|e| e.to_string())?;
    let target_id = nostr::EventId::from_hex(&event_id).map_err(|e| e.to_string())?;
    let relay_base = crate::relay::relay_api_base_url_with_override(&state);
    let keys = state.signing_keys()?;
    assert_expected_relay_scope(Some(&expected_relay_url), &relay_base)?;
    assert_expected_signer(Some(&expected_signer_pubkey), &keys.public_key().to_hex())?;
    let intent_key = format!(
        "delete:{relay_base}:{}:{channel}:{target_id}",
        keys.public_key()
    );
    let (event, first) = match unconfirmed::existing_mutation(&intent_key)? {
        Some(event) => (event, false),
        None => {
            let targets = crate::relay::query_relay_at_with_keys(
                &state, &relay_base,
                &[serde_json::json!({"ids":[target_id.to_hex()],"kinds":[9,45001,45003],"#h":[channel.to_string()]})],
                &keys, None,
            ).await?;
            let target = targets
                .iter()
                .find(|event| event.id == target_id)
                .ok_or("deletion target unavailable")?;
            target.verify().map_err(|e| e.to_string())?;
            if target.pubkey != keys.public_key()
                || !matches!(target.kind.as_u16(), 9 | 45001 | 45003)
                || channel_id_from_tags(target).as_deref() != Some(channel_id.as_str())
                || target
                    .tags
                    .iter()
                    .filter(|tag| tag.as_slice().first().is_some_and(|key| key == "h"))
                    .count()
                    != 1
            {
                return Err("deletion target author or channel mismatch".into());
            }
            let fresh = events::build_delete_compat(channel, target_id)?
                .sign_with_keys(&keys)
                .map_err(|e| e.to_string())?;
            unconfirmed::claim_mutation(&intent_key, fresh)?
        }
    };
    submit_message_mutation(
        event,
        first,
        &intent_key,
        &state,
        &relay_base,
        &keys,
        channel,
    )
    .await
}

#[tauri::command]
pub async fn add_reaction(
    channel_id: String,
    event_id: String,
    emoji: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    change_reaction(
        channel_id,
        event_id,
        emoji,
        false,
        expected_relay_url,
        expected_signer_pubkey,
        state,
    )
    .await
}

#[tauri::command]
pub async fn remove_reaction(
    channel_id: String,
    event_id: String,
    emoji: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    change_reaction(
        channel_id,
        event_id,
        emoji,
        true,
        expected_relay_url,
        expected_signer_pubkey,
        state,
    )
    .await
}

async fn change_reaction(
    channel_id: String,
    event_id: String,
    emoji: String,
    remove: bool,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    if expected_relay_url.trim().is_empty()
        || emoji.trim().is_empty()
        || nostr::PublicKey::from_hex(&expected_signer_pubkey).is_err()
    {
        return Err("reaction requires the captured community and signer".into());
    }
    let channel = uuid::Uuid::parse_str(&channel_id).map_err(|error| error.to_string())?;
    let target = nostr::EventId::from_hex(&event_id).map_err(|error| error.to_string())?;
    let relay = crate::relay::relay_api_base_url_with_override(&state);
    let keys = state.signing_keys()?;
    assert_expected_relay_scope(Some(&expected_relay_url), &relay)?;
    assert_expected_signer(Some(&expected_signer_pubkey), &keys.public_key().to_hex())?;
    let emoji = emoji.trim();
    let intent = format!(
        "reaction:{relay}:{}:{channel}:{target}:{emoji}",
        keys.public_key()
    );
    let (event, first) = match unconfirmed::existing_mutation(&intent)? {
        Some(event) => {
            if (event.kind.as_u16() == 5) != remove {
                return Err("relay publish outcome unknown".into());
            }
            (event, false)
        }
        None => {
            let rows = crate::relay::query_relay_at_with_keys(&state, &relay,
                &[serde_json::json!({"ids":[target.to_hex()],"kinds":[9,40002,40099,45001,45003],"#h":[channel.to_string()]})], &keys, None).await?;
            let message = rows
                .iter()
                .find(|row| row.id == target)
                .ok_or("reaction target unavailable")?;
            message.verify().map_err(|error| error.to_string())?;
            if !matches!(message.kind.as_u16(), 9 | 40002 | 40099 | 45001 | 45003) {
                return Err("reaction target kind mismatch".into());
            }
            if message.kind.as_u16() == 40099 {
                let relay_author = super::relay_self::fetch_relay_self_at(
                    &state,
                    &crate::relay::relay_ws_url_with_override(&state),
                )
                .await?;
                if relay_author.as_deref() != Some(message.pubkey.to_hex().as_str()) {
                    return Err("reaction system target author mismatch".into());
                }
            }
            if channel_id_from_tags(message).as_deref() != Some(channel_id.as_str())
                || message
                    .tags
                    .iter()
                    .filter(|tag| tag.as_slice().first().is_some_and(|name| name == "h"))
                    .count()
                    != 1
            {
                return Err("reaction target channel mismatch".into());
            }
            let builder = if remove {
                // Original remove_reaction selects the actor's accepted event,
                // never another author's reaction or a caller-supplied event.
                let reactions = crate::relay::query_relay_at_with_keys(&state, &relay,
                    &[serde_json::json!({"kinds":[7],"#e":[target.to_hex()],"#h":[channel.to_string()],"authors":[keys.public_key().to_hex()]})], &keys, None).await?;
                let reaction = reactions.iter().find(|event| event.kind.as_u16() == 7
                    && event.pubkey == keys.public_key() && event.content.trim() == emoji
                    && event.verify().is_ok()
                    && event.tags.iter().filter(|tag| tag.as_slice().first().is_some_and(|name| name == "e")).count() == 1
                    && event.tags.iter().any(|tag| tag.as_slice().first().is_some_and(|name| name == "e")
                        && tag.as_slice().get(1) == Some(&target.to_hex())))
                    .ok_or("could not find your reaction event for this emoji")?;
                buzz_sdk_pkg::build_remove_reaction(reaction.id)
            } else {
                let tags = super::custom_emoji::message_tags(&state, &relay, &keys, emoji).await?;
                match tags.as_slice() {
                    [] => buzz_sdk_pkg::build_reaction(target, emoji),
                    [tag] if tag.len() == 3 && tag[0] == "emoji" && emoji == format!(":{}:", tag[1]) =>
                        buzz_sdk_pkg::build_custom_emoji_reaction(target, &tag[1], &tag[2]),
                    _ => return Err("reaction emoji evidence is invalid".into()),
                }
            }.map_err(|error| error.to_string())?;
            let fresh = builder
                .sign_with_keys(&keys)
                .map_err(|error| error.to_string())?;
            unconfirmed::claim_mutation(&intent, fresh)?
        }
    };
    submit_message_mutation(event, first, &intent, &state, &relay, &keys, channel).await
}

async fn submit_message_mutation(
    event: nostr::Event,
    first: bool,
    intent_key: &str,
    state: &AppState,
    relay_base: &str,
    keys: &nostr::Keys,
    channel: uuid::Uuid,
) -> Result<serde_json::Value, String> {
    let admitted = state.signing_keys().and_then(|current| {
        assert_expected_relay_scope(
            Some(relay_base),
            &crate::relay::relay_api_base_url_with_override(state),
        )?;
        assert_expected_signer(
            Some(&keys.public_key().to_hex()),
            &current.public_key().to_hex(),
        )
    });
    if let Err(error) = admitted {
        if first {
            // This claim has not left the process; no external ambiguity yet.
            unconfirmed::resolve_mutation(intent_key, event.id)?;
            return Err(error);
        }
        return Err("relay publish outcome unknown".into());
    }
    if first {
        match crate::relay::submit_signed_event_at_with_keys(&event, state, relay_base, keys).await
        {
            Ok(_) => {
                unconfirmed::resolve_mutation(intent_key, event.id)?;
                return serde_json::to_value(event)
                    .map_err(|_| "relay publish outcome unknown".into());
            }
            Err(error) if !unconfirmed::outcome_unknown(&error) => {
                unconfirmed::resolve_mutation(intent_key, event.id)?;
                return Err(error);
            }
            Err(_) => {}
        }
    }
    // Lost ACK / remounted composer: query the original signed intent. An
    // absent event is unknown, never permission to dispatch a new edit.
    let observed = crate::relay::query_relay_at_with_keys(
        state, relay_base,
        &[serde_json::json!({"ids":[event.id.to_hex()],"kinds":[event.kind.as_u16()],"#h":[channel.to_string()]})],
        keys, None,
    ).await.map_err(|_| "relay publish outcome unknown".to_string())?;
    let actual = observed
        .iter()
        .find(|actual| actual.id == event.id && actual.verify().is_ok())
        .ok_or("relay publish outcome unknown")?;
    state
        .signing_keys()
        .and_then(|current| {
            assert_expected_relay_scope(
                Some(relay_base),
                &crate::relay::relay_api_base_url_with_override(state),
            )?;
            assert_expected_signer(
                Some(&keys.public_key().to_hex()),
                &current.public_key().to_hex(),
            )
        })
        .map_err(|_| "relay publish outcome unknown".to_string())?;
    unconfirmed::resolve_mutation(intent_key, event.id)?;
    serde_json::to_value(actual).map_err(|_| "relay publish outcome unknown".into())
}

// ── Local helpers ───────────────────────────────────────────────────────────

fn channel_id_from_tags(ev: &nostr::Event) -> Option<String> {
    ev.tags.iter().find_map(|t| {
        let s = t.as_slice();
        if s.len() >= 2 && s[0] == "h" {
            Some(s[1].clone())
        } else {
            None
        }
    })
}

fn tags_to_vec(ev: &nostr::Event) -> Vec<Vec<String>> {
    ev.tags.iter().map(|t| t.as_slice().to_vec()).collect()
}

fn feed_item_from_event(ev: &nostr::Event, category: FeedItemCategory) -> FeedItemInfo {
    let channel_id = channel_id_from_tags(ev);
    FeedItemInfo {
        id: ev.id.to_hex(),
        kind: ev.kind.as_u16() as u32,
        pubkey: ev.pubkey.to_hex(),
        content: ev.content.clone(),
        created_at: ev.created_at.as_secs(),
        channel_id,
        channel_name: String::new(),
        channel_type: None,
        tags: tags_to_vec(ev),
        category,
    }
}
#[cfg(test)]
#[path = "messages_tests.rs"]
mod tests;
