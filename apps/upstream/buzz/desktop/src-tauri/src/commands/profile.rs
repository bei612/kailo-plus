use std::collections::HashMap;

use tauri::State;

use crate::{
    app_state::AppState,
    models::{ProfileInfo, SearchUsersResponse, UsersBatchResponse},
    nostr_convert,
    relay::query_relay,
};

#[tauri::command]
pub async fn get_profile(state: State<'_, AppState>) -> Result<ProfileInfo, String> {
    let my_pubkey = current_pubkey_hex(&state)?;
    let events = query_relay(
        &state,
        &[serde_json::json!({
            "kinds": [0],
            "authors": [my_pubkey],
            "limit": 1
        })],
    )
    .await?;

    Ok(events
        .first()
        .map(nostr_convert::profile_info_from_event)
        .transpose()?
        .unwrap_or_else(|| empty_profile_info(&current_pubkey_hex_unwrap(&state))))
}

#[tauri::command]
pub async fn get_user_profile(
    pubkey: Option<String>,
    state: State<'_, AppState>,
) -> Result<ProfileInfo, String> {
    let target = match pubkey {
        Some(pk) => pk,
        None => current_pubkey_hex(&state)?,
    };

    let events = query_relay(
        &state,
        &[serde_json::json!({
            "kinds": [0],
            "authors": [target.clone()],
            "limit": 1
        })],
    )
    .await?;

    Ok(events
        .first()
        .map(nostr_convert::profile_info_from_event)
        .transpose()?
        .unwrap_or_else(|| empty_profile_info(&target)))
}

#[tauri::command]
pub async fn get_users_batch(
    pubkeys: Vec<String>,
    state: State<'_, AppState>,
) -> Result<UsersBatchResponse, String> {
    if pubkeys.is_empty() {
        return Ok(UsersBatchResponse {
            profiles: HashMap::new(),
            missing: Vec::new(),
        });
    }
    let events = query_relay(
        &state,
        &[serde_json::json!({
            "kinds": [0],
            "authors": pubkeys,
        })],
    )
    .await?;

    Ok(nostr_convert::users_batch_from_events(&events, &pubkeys))
}

fn build_user_search_filter(query: &str, limit: usize, page: u32) -> serde_json::Value {
    serde_json::json!({
        "kinds": [0],
        "search": query,
        "search_mode": "prefix",
        "limit": limit,
        "page": page,
    })
}

#[tauri::command]
pub async fn search_users(
    query: String,
    limit: Option<u32>,
    cursor: Option<String>,
    state: State<'_, AppState>,
) -> Result<SearchUsersResponse, String> {
    let trimmed = query.trim();
    let max = limit.unwrap_or(8).min(500) as usize;
    let page = cursor
        .as_deref()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(1);

    if max == 0 {
        return Ok(SearchUsersResponse {
            users: Vec::new(),
            next_cursor: None,
        });
    }

    if trimmed.is_empty() {
        let events = query_relay(
            &state,
            &[serde_json::json!({
                "kinds": [0],
                "limit": max,
                "page": page,
            })],
        )
        .await?;

        // Emit a real next page cursor when the relay returned a full page, so
        // the empty-query people directory can page past its first page (the
        // relay honors `page`→offset for this non-search kind:0 listing). The
        // raw `events.len()` is the correct fullness signal — `list_user_search_results`
        // dedupes/truncates, so its output length can undercount a full page.
        let mut response = nostr_convert::list_user_search_results(&events, max);
        if events.len() >= max {
            response.next_cursor = Some((page + 1).to_string());
        }
        return Ok(response);
    }

    // NIP-50 full-text search on kind:0 profiles. The relay's HTTP bridge
    // intercepts the `search` field on POST /query and routes to Postgres FTS
    // (see `crates/buzz-relay/src/api/bridge.rs::handle_bridge_search`),
    // so we get indexed, server-side search instead of fetching every kind:0
    // and scanning client-side. The old path was capped at 2000 kind:0 events
    // by the relay's HTTP bridge limit, which silently hid users on busy relays.
    //
    // We fetch one bounded page (bridge accepts up to 500) and re-rank that page
    // locally because the relay scores FTS rank against the whole kind:0 JSON
    // `content` blob, where a hit in `display_name` is not weighted any higher
    // than a substring hit in `about`. The caller can request later pages via the
    // cursor so the UI cap is only a page size, not a terminal directory ceiling.
    //
    // `search_mode: "prefix"` matters: every caller of this command is a
    // typeahead surface (member picker, @mention popup, DM recipient search,
    // topbar people results), so a partially typed name must match. Without it
    // the relay runs whole-word `websearch_to_tsquery` matching and "tyl"
    // returns zero results for "Tyler". Same bridge-only extension the topbar
    // message search uses (see `build_search_messages_filter`).
    let events = query_relay(&state, &[build_user_search_filter(trimmed, max, page)]).await?;

    let mut response = nostr_convert::rank_user_search_results(&events, trimmed, max);
    if events.len() >= max {
        response.next_cursor = Some((page + 1).to_string());
    }
    Ok(response)
}

fn current_pubkey_hex(state: &AppState) -> Result<String, String> {
    let keys = state.keys.lock().map_err(|e| e.to_string())?;
    Ok(keys.public_key().to_hex())
}

fn current_pubkey_hex_unwrap(state: &AppState) -> String {
    current_pubkey_hex(state).unwrap_or_default()
}

fn empty_profile_info(pubkey: &str) -> ProfileInfo {
    ProfileInfo {
        pubkey: pubkey.to_string(),
        display_name: None,
        avatar_url: None,
        about: None,
        nip05_handle: None,
        owner_pubkey: None,
        has_profile_event: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_search_filter_requests_prefix_mode_for_typeahead() {
        // Every caller of `search_users` is a typeahead surface. Whole-word
        // FTS matching returns zero results for a partially typed name
        // ("tyl" for "Tyler"), which reads as "user doesn't exist" in the
        // member picker and @mention popup. Pin the mode so it can't drift.
        let filter = build_user_search_filter("tyl", 25, 1);

        assert_eq!(filter["search"], serde_json::json!("tyl"));
        assert_eq!(filter["search_mode"], serde_json::json!("prefix"));
        assert_eq!(filter["limit"], serde_json::json!(25));
        assert_eq!(filter["page"], serde_json::json!(1));
    }
}
