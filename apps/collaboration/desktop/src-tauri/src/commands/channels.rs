use tauri::State;

use crate::{
    app_state::AppState,
    models::{ChannelDetailInfo, ChannelMembersResponse, GetChannelsPayload},
    nostr_convert,
    relay::query_relay,
};

// ── Reads (pure-nostr via /query) ────────────────────────────────────────────

// The relay-backed channel list computation (fetch_channels, the membership
// cursor, the not-modified hash, and roster collection) lives in the `fetch`
// submodule.
mod fetch;
use fetch::{compute_channels_hash, fetch_channels};

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Return the channels the active identity belongs to. This is the 60s poll
/// path; its phase-2 fan-out is bounded by membership.
///
/// `known_hash` is a previously returned `hash` value. When it matches the
/// computed stable hash (which excludes `last_message_at`), the response
/// carries `channels: null` so the multi-MB list is not serialized across IPC.
/// `last_messages` is always included because it is cheap and changes with
/// every new message.
#[tauri::command]
pub async fn get_channels(
    known_hash: Option<String>,
    state: State<'_, AppState>,
) -> Result<GetChannelsPayload, String> {
    let channels = fetch_channels(&state).await?;

    let last_messages: std::collections::HashMap<String, String> = channels
        .iter()
        .filter_map(|c| {
            c.last_message_at
                .as_ref()
                .map(|ts| (c.id.clone(), ts.clone()))
        })
        .collect();

    let hash = compute_channels_hash(&channels);

    // Not-modified short-circuit: skip the multi-MB IPC payload when the
    // caller's hash matches. `last_messages` still ships so the TS side can
    // update sidebar timestamps without re-rendering the full list.
    if known_hash.as_deref() == Some(hash.as_str()) {
        return Ok(GetChannelsPayload {
            hash,
            channels: None,
            last_messages,
        });
    }

    Ok(GetChannelsPayload {
        hash,
        channels: Some(channels),
        last_messages,
    })
}

#[tauri::command]
pub async fn get_channel_details(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<ChannelDetailInfo, String> {
    let events = query_relay(
        &state,
        &[serde_json::json!({
            "kinds": [39000],
            "#d": [channel_id],
            "limit": 1
        })],
    )
    .await?;

    events
        .first()
        .map(nostr_convert::channel_detail_from_event)
        .transpose()?
        .ok_or_else(|| "channel not found".to_string())
}

/// Cap for the kind:0 profile join in `get_channel_members`. Enriching a
/// huge roster required an `authors` filter carrying every member pubkey — a
/// query whose size and relay cost grow linearly with membership and which
/// dominated channel-open latency on large channels. Members past the cap
/// keep `display_name: None` (the UI falls back to pubkey-derived labels and
/// resolves visible names through its profile caches); `role == "bot"` agent
/// flags are roster-derived and unaffected by the cap.
const MEMBER_PROFILE_JOIN_LIMIT: usize = 500;

/// The pubkeys eligible for the kind:0 profile join: roster order, capped.
fn profile_join_pubkeys(members: &[crate::models::ChannelMemberInfo], limit: usize) -> Vec<String> {
    members
        .iter()
        .take(limit)
        .map(|member| member.pubkey.clone())
        .collect()
}

#[tauri::command]
pub async fn get_channel_members(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<ChannelMembersResponse, String> {
    let events = query_relay(
        &state,
        &[serde_json::json!({
            "kinds": [39002],
            "#d": [channel_id],
            "limit": 1
        })],
    )
    .await?;

    let mut response = events
        .first()
        .map(nostr_convert::channel_members_from_event)
        .transpose()?
        .ok_or_else(|| "channel members not found".to_string())?;

    // Batch-fetch kind:0 profiles to populate display names, capped so the
    // query cost is bounded on large rosters (see MEMBER_PROFILE_JOIN_LIMIT).
    let pubkeys = profile_join_pubkeys(&response.members, MEMBER_PROFILE_JOIN_LIMIT);
    if !pubkeys.is_empty() {
        let profile_events = query_relay(
            &state,
            &[serde_json::json!({
                "kinds": [0],
                "authors": pubkeys,
                "limit": pubkeys.len()
            })],
        )
        .await
        .unwrap_or_default();

        // Build pubkey → profile display metadata from kind:0 events.
        let mut profile_map = std::collections::HashMap::new();
        for ev in &profile_events {
            let pk = ev.pubkey.to_hex();
            if let Ok(profile) = nostr_convert::profile_info_from_event(ev) {
                profile_map.insert(
                    pk,
                    (
                        profile.display_name,
                        nostr_convert::profile_has_valid_oa_owner(ev),
                    ),
                );
            }
        }

        // Populate profile-derived fields on each member.
        for member in &mut response.members {
            if member.role == "bot" {
                member.is_agent = true;
            }
            if let Some((display_name, is_agent)) = profile_map.get(&member.pubkey) {
                if member.display_name.is_none() {
                    member.display_name = display_name.clone();
                }
                member.is_agent = member.is_agent || *is_agent;
            }
        }
    }

    Ok(response)
}

// ── Writes (signed events) ──────────────────────────────────────────────────

#[cfg(test)]
#[path = "channels_tests.rs"]
mod tests;
