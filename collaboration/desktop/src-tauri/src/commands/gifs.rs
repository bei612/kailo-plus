//! DD-125(11), SF-BUZ-56(4), V-SCN-170: the original Desktop GIF picker transport.
//!
//! Original `desktop/src/features/gifs/relay.ts`: the Relay holds the KLIPY key and proxies
//! `/gifs/search` and `/gifs/share` for relay members. Desktop calls those relay-relative
//! endpoints directly as this device's CLIENT identity (NIP-98 with a `payload` hash), never
//! through the BFF and never with a provider credential. The endpoints are only the ones the
//! Relay's NIP-11 document advertises (`buzz-gif` + `gif {provider: "klipy", search, share}`),
//! re-read for every call, so the webview can never choose the request path. Results are
//! returned unmodified; the caller normalizes them and keeps only registered image origins.

use nostr::Keys;
use reqwest::Method;
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::{
    app_state::AppState,
    relay::{
        assert_expected_relay_scope, assert_expected_signer, build_authenticated_relay_request,
        build_nip98_auth_header_for_keys, classify_request_error, parse_json_response,
        relay_api_base_url_with_override, relay_error_message,
    },
};

/// Gate: `supported_extensions` must contain this value.
const REQUIRED_EXTENSION: &str = "buzz-gif";
/// Gate: `gif.provider` must be this value.
const REQUIRED_PROVIDER: &str = "klipy";
/// Original Relay request bounds (`api/gifs.rs::validate_text`).
const MAX_QUERY_CHARS: usize = 200;
const MAX_CUSTOMER_ID_CHARS: usize = 128;
const MAX_LOCALE_CHARS: usize = 32;
const MAX_SLUG_CHARS: usize = 200;
/// Above the Relay's own 10 s provider deadline, so its 502 arrives before ours fires.
const GIF_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
/// The Relay member gate refused this identity (original `relay_membership_required`).
const GIF_MEMBERSHIP_REQUIRED: &str = "relay_membership_required";
/// The active Relay no longer advertises a usable GIF descriptor.
const GIF_UNAVAILABLE: &str = "gif_unavailable";

/// The safe relay-relative KLIPY endpoints the Relay advertised in NIP-11.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayGifDescriptor {
    search_path: String,
    share_path: String,
}

#[derive(Clone, Copy)]
enum GifRoute {
    Search,
    Share,
}

/// Original `safeRelayPath` (`desktop/src/features/gifs/api.ts`): an absolute relay-relative
/// path without authority shift, backslashes, escapes, query, fragment or dot segments.
fn safe_relay_path(path: &str) -> bool {
    path.starts_with('/')
        && !path.starts_with("//")
        && !path.contains('\\')
        && !path.contains('%')
        && !path.contains('?')
        && !path.contains('#')
        && !path
            .split('/')
            .any(|segment| segment == "." || segment == "..")
}

fn advertised_path<'a>(gif: &'a Value, key: &str) -> Option<&'a str> {
    gif[key].as_str().filter(|path| safe_relay_path(path))
}

/// Original `relayKlipyCapability`: the descriptor only when every gate holds.
fn parse_gif_descriptor(info: &Value) -> Option<RelayGifDescriptor> {
    let advertised = info["supported_extensions"]
        .as_array()
        .is_some_and(|list| list.iter().any(|value| value == REQUIRED_EXTENSION));
    let gif = &info["gif"];
    let search_path = advertised_path(gif, "search")?;
    let share_path = advertised_path(gif, "share")?;
    (advertised && gif["provider"] == REQUIRED_PROVIDER).then(|| RelayGifDescriptor {
        search_path: search_path.to_owned(),
        share_path: share_path.to_owned(),
    })
}

/// Original Relay `validate_text`, checked before signing so a request the Relay would refuse
/// never spends a NIP-98 nonce or the member's rate budget.
fn validate_text(
    name: &str,
    value: &str,
    max_chars: usize,
    allow_empty: bool,
) -> Result<(), String> {
    if (!allow_empty && value.trim().is_empty()) || value.chars().count() > max_chars {
        let min = if allow_empty { 0 } else { 1 };
        return Err(format!(
            "{name} must be {min} through {max_chars} characters"
        ));
    }
    Ok(())
}

/// Read the Relay's public NIP-11 document (original `/info` read) and its GIF descriptor.
async fn fetch_gif_descriptor_at(
    state: &AppState,
    api_base_url: &str,
) -> Result<Option<RelayGifDescriptor>, String> {
    let response = state
        .http_client
        .get(format!("{}/info", api_base_url.trim_end_matches('/')))
        .header("Accept", "application/nostr+json")
        .timeout(GIF_REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| classify_request_error(&e))?;
    if !response.status().is_success() {
        return Err(relay_error_message(response).await);
    }
    let info: Value = parse_json_response(response).await?;
    Ok(parse_gif_descriptor(&info))
}

/// POST `payload` to the advertised endpoint as `keys` (NIP-98 over the exact body bytes).
async fn post_gif_at(
    state: &AppState,
    api_base_url: &str,
    keys: &Keys,
    route: GifRoute,
    payload: &Value,
) -> Result<reqwest::Response, String> {
    let base = api_base_url.trim_end_matches('/');
    let descriptor = fetch_gif_descriptor_at(state, base)
        .await?
        .ok_or_else(|| GIF_UNAVAILABLE.to_owned())?;
    let path = match route {
        GifRoute::Search => descriptor.search_path,
        GifRoute::Share => descriptor.share_path,
    };
    let url = format!("{base}{path}");
    let body = serde_json::to_vec(payload)
        .map_err(|e| format!("gif request serialization failed: {e}"))?;
    crate::egress_guard::assert_no_key_backup_bytes(&body, "relay gif request")?;
    crate::relay_admission::wait_for_rate_limit().await;
    let auth = build_nip98_auth_header_for_keys(keys, &Method::POST, &url, &body)?;
    let response = build_authenticated_relay_request(
        &state.http_client,
        Method::POST,
        &url,
        &auth,
        Some(body),
        None,
        Some(GIF_REQUEST_TIMEOUT),
    )
    .send()
    .await
    .map_err(|e| classify_request_error(&e))?;
    if response.status() == reqwest::StatusCode::FORBIDDEN {
        return Err(GIF_MEMBERSHIP_REQUIRED.to_owned());
    }
    if !response.status().is_success() {
        return Err(relay_error_message(response).await);
    }
    Ok(response)
}

async fn search_at(
    state: &AppState,
    api_base_url: &str,
    keys: &Keys,
    query: &str,
    locale: &str,
    customer_id: &str,
) -> Result<Value, String> {
    let query = query.trim();
    validate_text("query", query, MAX_QUERY_CHARS, true)?;
    validate_text("customer_id", customer_id, MAX_CUSTOMER_ID_CHARS, false)?;
    validate_text("locale", locale, MAX_LOCALE_CHARS, false)?;
    let payload = serde_json::json!({
        "customer_id": customer_id,
        "locale": locale,
        "query": query,
    });
    let response = post_gif_at(state, api_base_url, keys, GifRoute::Search, &payload).await?;
    let page: Value = parse_json_response(response).await?;
    if page["result"] != true {
        return Err("GIF search failed".to_owned());
    }
    Ok(page)
}

async fn share_at(
    state: &AppState,
    api_base_url: &str,
    keys: &Keys,
    slug: &str,
    customer_id: &str,
) -> Result<(), String> {
    validate_text("slug", slug, MAX_SLUG_CHARS, false)?;
    validate_text("customer_id", customer_id, MAX_CUSTOMER_ID_CHARS, false)?;
    let payload = serde_json::json!({ "customer_id": customer_id, "slug": slug });
    post_gif_at(state, api_base_url, keys, GifRoute::Share, &payload).await?;
    Ok(())
}

/// One relay/identity snapshot for the whole call, pinned to what the composer captured.
fn scoped_signer(
    state: &AppState,
    expected_relay_url: &str,
    expected_signer_pubkey: &str,
) -> Result<(String, Keys), String> {
    let relay = relay_api_base_url_with_override(state);
    let keys = state.signing_keys()?;
    assert_expected_relay_scope(Some(expected_relay_url), &relay)?;
    assert_expected_signer(Some(expected_signer_pubkey), &keys.public_key().to_hex())?;
    Ok((relay, keys))
}

/// The active Relay's advertised KLIPY endpoints, or `None` when it does not offer GIFs.
#[tauri::command]
pub async fn get_relay_gif_descriptor(
    expected_relay_url: String,
    state: State<'_, AppState>,
) -> Result<Option<RelayGifDescriptor>, String> {
    let relay = relay_api_base_url_with_override(&state);
    assert_expected_relay_scope(Some(&expected_relay_url), &relay)?;
    fetch_gif_descriptor_at(&state, &relay).await
}

/// Original `fetchKlipyGifs`: one page of the Relay's `{result, data: {data: [...]}}`.
#[tauri::command]
pub async fn search_relay_gifs(
    query: String,
    locale: String,
    customer_id: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let (relay, keys) = scoped_signer(&state, &expected_relay_url, &expected_signer_pubkey)?;
    search_at(&state, &relay, &keys, &query, &locale, &customer_id).await
}

/// Original `reportKlipyShare`: best-effort Recents report for a selected GIF.
#[tauri::command]
pub async fn share_relay_gif(
    slug: String,
    customer_id: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (relay, keys) = scoped_signer(&state, &expected_relay_url, &expected_signer_pubkey)?;
    share_at(&state, &relay, &keys, &slug, &customer_id).await
}

#[cfg(test)]
#[path = "gifs_tests.rs"]
mod tests;
