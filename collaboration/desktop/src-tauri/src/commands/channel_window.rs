use buzz_core_pkg::relay::{BRIDGE_WINDOW_DEFAULT_LIMIT, BRIDGE_WINDOW_MAX_LIMIT};
use tauri::State;

use crate::{app_state::AppState, models::ChannelPageCursor};

const TIMELINE_KINDS: [u32; 3] = [9, 40002, 40099];

fn build_channel_window_filter(
    channel_id: &str,
    cap: u32,
    cursor: Option<&ChannelPageCursor>,
    forum_posts: bool,
) -> serde_json::Value {
    let mut filter = serde_json::Map::new();
    filter.insert("#h".to_string(), serde_json::json!([channel_id]));
    filter.insert(
        "kinds".to_string(),
        if forum_posts {
            serde_json::json!([45001])
        } else {
            serde_json::json!(TIMELINE_KINDS)
        },
    );
    filter.insert("limit".to_string(), serde_json::json!(cap));
    filter.insert("top_level".to_string(), serde_json::json!(true));
    filter.insert("include_summaries".to_string(), serde_json::json!(true));
    filter.insert("include_aux".to_string(), serde_json::json!(true));
    if let Some(cursor) = cursor {
        filter.insert("until".to_string(), serde_json::json!(cursor.created_at));
        filter.insert("before_id".to_string(), serde_json::json!(cursor.event_id));
    }
    serde_json::Value::Object(filter)
}

/// Fetch one server-assembled channel window over the existing `/query` bridge.
#[tauri::command]
pub async fn get_channel_window(
    channel_id: String,
    limit_rows: Option<u32>,
    cursor: Option<ChannelPageCursor>,
    forum_posts: Option<bool>,
    expected_relay_url: Option<String>,
    expected_signer_pubkey: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let filter = build_channel_window_filter(
        &channel_id,
        limit_rows
            .unwrap_or(BRIDGE_WINDOW_DEFAULT_LIMIT)
            .min(BRIDGE_WINDOW_MAX_LIMIT),
        cursor.as_ref(),
        forum_posts.unwrap_or(false),
    );
    let relay_base = crate::relay::relay_api_base_url_with_override(&state);
    let keys = state.signing_keys()?;
    crate::relay::assert_expected_relay_scope(expected_relay_url.as_deref(), &relay_base)?;
    crate::relay::assert_expected_signer(
        expected_signer_pubkey.as_deref(),
        &keys.public_key().to_hex(),
    )?;
    Ok(
        crate::relay::query_relay_at_with_keys(&state, &relay_base, &[filter], &keys, None)
            .await?
            .iter()
            .filter_map(|event| serde_json::to_value(event).ok())
            .collect(),
    )
}
