use tauri::State;

use crate::{
    app_state::AppState,
    events,
    models::{
        FeedItemCategory, FeedItemInfo, FeedMeta, FeedResponse, FeedSections, SearchResponse,
        SendChannelMessageResponse, ThreadRepliesResponse,
    },
    nostr_convert,
    relay::{
        assert_expected_relay_scope, assert_expected_signer, query_relay,
        submit_event_at_created_at,
    },
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
pub async fn get_thread_replies(
    root_event_id: String,
    channel_id: Option<String>,
    limit: Option<u32>,
    depth_limit: Option<u32>,
    cursor: Option<crate::models::ThreadCursor>,
    state: State<'_, AppState>,
) -> Result<ThreadRepliesResponse, String> {
    let cap = limit.unwrap_or(200).min(500);
    let filter = build_thread_replies_filter(
        &root_event_id,
        channel_id.as_deref(),
        depth_limit.unwrap_or(64),
        cap,
        cursor.as_ref(),
    );

    let events = query_relay(&state, &[serde_json::Value::Object(filter)]).await?;

    // A full page implies there may be more; hand back the last event's
    // composite key as the next cursor (the DB returns replies strictly after
    // it, tiebroken by event_id so same-second replies are not skipped).
    let reply_events: Vec<_> = events
        .iter()
        .filter(|event| TIMELINE_KINDS.contains(&(event.kind.as_u16() as u32)))
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
    state: State<'_, AppState>,
) -> Result<SendChannelMessageResponse, String> {
    let channel_uuid = uuid::Uuid::parse_str(&channel_id)
        .map_err(|_| format!("invalid channel UUID: {channel_id}"))?;
    let mentions = mention_pubkeys.unwrap_or_default();
    let mention_refs: Vec<&str> = mentions.iter().map(|s| s.as_str()).collect();
    let media = media_tags.unwrap_or_default();
    let emoji = emoji_tags.unwrap_or_default();
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
    let builder = events::build_message(
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
    )?;

    // `created_at` is the signed event's own second, not a post-publication
    // clock read.
    // Submit through the base resolved (and scope-checked) above and the
    // identity snapshotted (and signer-checked) above — a re-resolve or key
    // re-read here would reopen the mid-command switch window.
    let (result, created_at) =
        submit_event_at_created_at(builder, &state, &relay_base, &signing_keys).await?;

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
