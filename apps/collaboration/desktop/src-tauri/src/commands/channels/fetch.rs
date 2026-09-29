//! Relay-backed channel list computation for the channels commands.
//!
//! Split out of `channels.rs` to keep that file under the per-file line cap.
//! Owns the two-phase relay fetch (`fetch_channels`), the paged membership
//! cursor, the not-modified hash, and the member-roster collection. The Tauri
//! commands stay in `channels.rs`.

use crate::{app_state::AppState, models::ChannelInfo, nostr_convert, relay::query_relay};

pub(super) const DIRECTORY_PAGE_SIZE: usize = 500;
// Keep this aligned with the relay's aggregate explicit-`#h` request bound.
// Each filter carries one channel so the relay can use its channel_id index.
const LAST_MESSAGE_QUERY_CHANNEL_BATCH_SIZE: usize = 128;
// Human-visible channel activity that drives sidebar Recent ordering. Keep this
// aligned with desktop/src/shared/constants/kinds.ts::CHANNEL_MESSAGE_EVENT_KINDS.
const CHANNEL_RECENCY_EVENT_KINDS: [u16; 2] = [9, 40002];

pub(super) fn advance_directory_cursor(filter: &mut serde_json::Value, page: &[nostr::Event]) {
    let last = page
        .last()
        .expect("a full relay page always has a last event");
    filter["until"] = serde_json::json!(last.created_at.as_secs());
    filter["before_id"] = serde_json::json!(last.id.to_hex());
}

/// Fetch every page for a historical relay filter using the relay's composite
/// `(until, before_id)` cursor. A timestamp-only cursor can skip rows when more
/// than one page of events shares the same second.
async fn query_relay_all(
    state: &AppState,
    mut filter: serde_json::Value,
) -> Result<Vec<nostr::Event>, String> {
    filter["limit"] = serde_json::json!(DIRECTORY_PAGE_SIZE);
    let mut all = Vec::new();

    loop {
        let page = query_relay(state, &[filter.clone()]).await?;
        let done = page.len() < DIRECTORY_PAGE_SIZE;

        if !done {
            advance_directory_cursor(&mut filter, &page);
        }

        all.extend(page);
        if done {
            return Ok(all);
        }
    }
}

// ── FNV-1a hash for the not-modified short-circuit ───────────────────────────

/// FNV-1a 64-bit hash over arbitrary bytes. Used in preference to
/// `std::collections::hash_map::DefaultHasher` because the standard library
/// does not guarantee cross-invocation stability.
fn fnv1a_64(data: &[u8]) -> u64 {
    const OFFSET: u64 = 14695981039346656037;
    const PRIME: u64 = 1099511628211;
    let mut hash = OFFSET;
    for &byte in data {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}

/// Stable projection of `ChannelInfo` for hashing. Excludes `last_message_at`
/// so routine message traffic does not invalidate the not-modified short-circuit
/// for the channel list.
#[derive(serde::Serialize)]
struct ChannelInfoForHash<'a> {
    id: &'a str,
    name: &'a str,
    channel_type: &'a str,
    visibility: &'a str,
    description: &'a str,
    topic: &'a Option<String>,
    purpose: &'a Option<String>,
    member_count: i64,
    member_pubkeys: &'a Vec<String>,
    archived_at: &'a Option<String>,
    participants: &'a Vec<String>,
    participant_pubkeys: &'a Vec<String>,
    is_member: bool,
    ttl_seconds: &'a Option<i32>,
    ttl_deadline: &'a Option<String>,
}

/// Compute a stable 64-bit FNV-1a hash over the channel list, canonicalized
/// by sorting on channel id and excluding `last_message_at`. Returns a
/// 16-character lowercase hex string.
pub(super) fn compute_channels_hash(channels: &[ChannelInfo]) -> String {
    let mut sorted: Vec<&ChannelInfo> = channels.iter().collect();
    sorted.sort_by(|a, b| a.id.cmp(&b.id));

    let projections: Vec<ChannelInfoForHash<'_>> = sorted
        .iter()
        .map(|c| ChannelInfoForHash {
            id: &c.id,
            name: &c.name,
            channel_type: &c.channel_type,
            visibility: &c.visibility,
            description: &c.description,
            topic: &c.topic,
            purpose: &c.purpose,
            member_count: c.member_count,
            member_pubkeys: &c.member_pubkeys,
            archived_at: &c.archived_at,
            participants: &c.participants,
            participant_pubkeys: &c.participant_pubkeys,
            is_member: c.is_member,
            ttl_seconds: &c.ttl_seconds,
            ttl_deadline: &c.ttl_deadline,
        })
        .collect();

    let canonical = serde_json::to_string(&projections).unwrap_or_default();
    format!("{:016x}", fnv1a_64(canonical.as_bytes()))
}

// ── Core fetch implementation ─────────────────────────────────────────────────

pub(super) fn last_message_filter(channel_id: &str) -> serde_json::Value {
    serde_json::json!({
        "kinds": CHANNEL_RECENCY_EVENT_KINDS,
        "#h": [channel_id],
        "limit": 1
    })
}

pub(super) fn last_message_filter_batches(
    filters: &[serde_json::Value],
) -> Vec<&[serde_json::Value]> {
    filters
        .chunks(LAST_MESSAGE_QUERY_CHANNEL_BATCH_SIZE)
        .collect()
}

async fn query_last_messages(
    state: &AppState,
    filters: &[serde_json::Value],
) -> Result<Vec<nostr::Event>, String> {
    let mut messages = Vec::with_capacity(filters.len());
    for batch in last_message_filter_batches(filters) {
        messages.extend(query_relay(state, batch).await?);
    }
    Ok(messages)
}

/// Fetch the channels this identity belongs to. Called by `get_channels`,
/// which wraps it with the hash-based not-modified short-circuit.
///
/// Relay round-trips run in two phases:
/// - Phase 1: member chain — kind:39002 rosters listing my pubkey, then the
///   kind:39000 metadata for those channels.
/// - Phase 2: last-message timestamps (bounded per-channel human-visible
///   activity batches). Failures abort so cached recency is never replaced by
///   a false authoritative empty result.
pub(super) async fn fetch_channels(state: &AppState) -> Result<Vec<ChannelInfo>, String> {
    let my_pubkey = {
        let keys = state.keys.lock().map_err(|e| e.to_string())?;
        keys.public_key().to_hex()
    };

    // Step 1: kind:39002 events listing my pubkey as a member.
    let member_events = query_relay_all(
        state,
        serde_json::json!({"kinds": [39002], "#p": [&my_pubkey]}),
    )
    .await?;

    let mut member_channel_ids: Vec<String> = member_events
        .iter()
        .filter_map(|ev| {
            ev.tags.iter().find_map(|t| {
                let s = t.as_slice();
                (s.len() >= 2 && s[0] == "d").then(|| s[1].clone())
            })
        })
        .collect();
    member_channel_ids.sort();
    member_channel_ids.dedup();
    if member_channel_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Step 2: channel metadata events (kind:39000) for member channels.
    // kind:39000 is addressable: exactly one event per `d` tag, so a limit
    // equal to the number of ids is both necessary and sufficient.
    let meta_events = query_relay(
        state,
        &[serde_json::json!({
            "kinds": [39000],
            "#d": &member_channel_ids,
            "limit": member_channel_ids.len(),
        })],
    )
    .await?;

    // Step 1 returned complete rosters, not just the matching p-tag.
    let membership = collect_members_by_channel(&member_events);
    let mut channels = Vec::with_capacity(meta_events.len());
    for ev in &meta_events {
        if let Ok(mut info) = nostr_convert::channel_info_from_event(ev, None, Some(true)) {
            if let Some(roster) = membership.get(&info.id) {
                info.member_count = roster.count;
                info.member_pubkeys = roster.pubkeys.clone();
            }
            channels.push(info);
        }
    }

    // Phase 2: one indexed filter per channel while keeping every relay
    // request within its aggregate explicit-channel cap. Message timestamps
    // drive the user-selected Recent ordering, so a failed query must not
    // masquerade as an authoritative empty result.
    let last_msg_filters: Vec<serde_json::Value> = channels
        .iter()
        .map(|c| last_message_filter(&c.id))
        .collect();
    let messages = query_last_messages(state, &last_msg_filters).await?;

    let mut last_message_by_channel: std::collections::HashMap<String, u64> =
        std::collections::HashMap::new();
    for ev in &messages {
        if let Some(ch_id) = ev.tags.iter().find_map(|t| {
            let s = t.as_slice();
            (s.len() >= 2 && s[0] == "h").then(|| s[1].clone())
        }) {
            let ts = ev.created_at.as_secs();
            last_message_by_channel
                .entry(ch_id)
                .and_modify(|existing| {
                    if ts > *existing {
                        *existing = ts;
                    }
                })
                .or_insert(ts);
        }
    }
    for channel in &mut channels {
        if let Some(&ts) = last_message_by_channel.get(&channel.id) {
            channel.last_message_at = Some(nostr_convert::timestamp_to_iso(ts));
        }
    }

    Ok(channels)
}

pub(super) struct ChannelMembership {
    pub(super) count: i64,
    pub(super) pubkeys: Vec<String>,
}

/// Build a `channel_id → membership` map from a batch of kind:39002 events.
/// Events without a `d` tag are skipped; member dedupe is delegated to
/// [`nostr_convert::channel_members_from_event`] so the parsing rules match the
/// per-channel `get_channel_members` path.
pub(super) fn collect_members_by_channel(
    events: &[nostr::Event],
) -> std::collections::HashMap<String, ChannelMembership> {
    let mut map: std::collections::HashMap<String, ChannelMembership> =
        std::collections::HashMap::with_capacity(events.len());
    for ev in events {
        let Some(d) = ev.tags.iter().find_map(|t| {
            let s = t.as_slice();
            (s.len() >= 2 && s[0] == "d").then(|| s[1].clone())
        }) else {
            continue;
        };
        let Ok(resp) = nostr_convert::channel_members_from_event(ev) else {
            continue;
        };
        let pubkeys: Vec<String> = resp.members.iter().map(|m| m.pubkey.clone()).collect();
        map.insert(
            d,
            ChannelMembership {
                count: pubkeys.len() as i64,
                pubkeys,
            },
        );
    }
    map
}

#[cfg(test)]
#[path = "fetch_tests.rs"]
mod tests;
