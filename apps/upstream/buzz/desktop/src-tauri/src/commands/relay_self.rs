//! The active relay's NIP-11 `self` pubkey (its own signing identity).
//!
//! The relay signs system messages (kind:40099) with this key; the timeline
//! uses it to attribute them to the relay rather than to a user.

use serde::Deserialize;
use tauri::State;

use crate::{
    app_state::AppState,
    relay::{classify_request_error, relay_http_base_url, relay_ws_url_with_override},
};

#[derive(Debug, Deserialize)]
struct RelayInformationDocument {
    #[serde(default, rename = "self")]
    self_: Option<String>,
}

pub(crate) async fn fetch_relay_self(state: &AppState) -> Result<Option<String>, String> {
    fetch_relay_self_at(state, &relay_ws_url_with_override(state)).await
}

/// How long a fetched NIP-11 `self` pubkey stays valid in
/// [`AppState::relay_self_cache`]. The relay's signing identity changes only
/// on an operator-driven key rotation, so minutes of staleness are safe; the
/// TTL exists so even that rare rotation converges without an app restart.
pub(crate) const RELAY_SELF_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(300);

/// Read a still-fresh cached `self` pubkey for `relay_url`, if any. Fails open
/// (cache miss) on a poisoned lock — the fetch path never depends on the cache.
fn cached_relay_self(state: &AppState, relay_url: &str) -> Option<String> {
    let cache = state.relay_self_cache.lock().ok()?;
    let (fetched_at, relay_self) = cache.get(relay_url)?;
    (fetched_at.elapsed() < RELAY_SELF_CACHE_TTL).then(|| relay_self.clone())
}

/// Reads NIP-11 from an explicit relay WS URL.
///
/// Successful lookups are cached per relay URL for [`RELAY_SELF_CACHE_TTL`].
/// Only a verified `Some` is cached — `Ok(None)` covers transient states
/// (non-2xx status, a document momentarily missing `self`) that must be
/// re-tried, not pinned.
pub(crate) async fn fetch_relay_self_at(
    state: &AppState,
    relay_url: &str,
) -> Result<Option<String>, String> {
    if let Some(cached) = cached_relay_self(state, relay_url) {
        return Ok(Some(cached));
    }

    let http_url = relay_http_base_url(relay_url);
    let response = state
        .http_client
        .get(&http_url)
        .header("Accept", "application/nostr+json")
        .send()
        .await
        .map_err(|e| classify_request_error(&e))?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let doc = response
        .json::<RelayInformationDocument>()
        .await
        .map_err(|_| "relay returned malformed NIP-11 document".to_string())?;

    let Some(relay_self) = doc.self_.map(|value| value.to_ascii_lowercase()) else {
        return Ok(None);
    };

    if relay_self.len() == 64 && relay_self.chars().all(|c| c.is_ascii_hexdigit()) {
        if let Ok(mut cache) = state.relay_self_cache.lock() {
            cache.insert(
                relay_url.to_string(),
                (std::time::Instant::now(), relay_self.clone()),
            );
        }
        Ok(Some(relay_self))
    } else {
        Ok(None)
    }
}

/// Read the active relay's NIP-11 `self` pubkey (its own signing key, hex).
///
/// A public, unauthenticated document read. Fails open: an unreachable relay,
/// a document without `self`, or a malformed value all return `None`, and
/// callers must treat that as "not the relay".
#[tauri::command]
pub async fn get_relay_self(state: State<'_, AppState>) -> Result<Option<String>, String> {
    fetch_relay_self(&state).await
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::Keys;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn relay_information_document_reads_nip11_self_field() {
        let doc: RelayInformationDocument = serde_json::from_str(
            r#"{"name":"test relay","self":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#,
        )
        .expect("NIP-11 document");

        assert_eq!(
            doc.self_.as_deref(),
            Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        );
    }

    /// Spawn a loopback NIP-11 endpoint that counts hits and serves `self_hex`
    /// (or a bare 503 when `self_hex` is `None`). Returns the `ws://` base and
    /// the shared hit counter.
    async fn spawn_nip11_relay(self_hex: Option<String>) -> (String, std::sync::Arc<AtomicUsize>) {
        use axum::{http::StatusCode, routing::get, Json, Router};

        let hits = std::sync::Arc::new(AtomicUsize::new(0));
        let route_hits = hits.clone();
        let router = Router::new().route(
            "/",
            get(move || {
                let self_hex = self_hex.clone();
                let route_hits = route_hits.clone();
                async move {
                    route_hits.fetch_add(1, Ordering::SeqCst);
                    match self_hex {
                        Some(self_hex) => Ok(Json(serde_json::json!({ "self": self_hex }))),
                        None => Err(StatusCode::SERVICE_UNAVAILABLE),
                    }
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, router).await.ok();
        });
        (format!("ws://{addr}"), hits)
    }

    /// A second lookup within the TTL must be served from
    /// [`AppState::relay_self_cache`]
    /// without touching the relay. RED-on-revert: drop the `cached_relay_self`
    /// check and the hit counter reads 2.
    #[tokio::test]
    async fn relay_self_second_fetch_within_ttl_is_served_from_cache() {
        let self_hex = Keys::generate().public_key().to_hex();
        let (relay_url, hits) = spawn_nip11_relay(Some(self_hex.clone())).await;
        let state = crate::app_state::build_app_state();

        let first = fetch_relay_self_at(&state, &relay_url).await.unwrap();
        let second = fetch_relay_self_at(&state, &relay_url).await.unwrap();

        assert_eq!(first.as_deref(), Some(self_hex.as_str()));
        assert_eq!(second.as_deref(), Some(self_hex.as_str()));
        assert_eq!(
            hits.load(Ordering::SeqCst),
            1,
            "the second in-TTL lookup must not re-GET the NIP-11 document"
        );
    }

    /// A non-success NIP-11 response yields `Ok(None)` and MUST stay
    /// retryable: caching the outage would misattribute relay system messages
    /// for the full TTL after one relay blip.
    #[tokio::test]
    async fn relay_self_non_success_response_is_not_cached() {
        let (relay_url, hits) = spawn_nip11_relay(None).await;
        let state = crate::app_state::build_app_state();

        assert_eq!(fetch_relay_self_at(&state, &relay_url).await.unwrap(), None);
        assert_eq!(fetch_relay_self_at(&state, &relay_url).await.unwrap(), None);
        assert_eq!(
            hits.load(Ordering::SeqCst),
            2,
            "a failed lookup must retry the relay, never pin the outage"
        );
    }

    /// An entry older than [`RELAY_SELF_CACHE_TTL`] must be refetched so a
    /// relay-side key rotation converges without an app restart.
    #[tokio::test]
    async fn relay_self_expired_cache_entry_is_refetched() {
        let self_hex = Keys::generate().public_key().to_hex();
        let (relay_url, hits) = spawn_nip11_relay(Some(self_hex.clone())).await;
        let state = crate::app_state::build_app_state();
        // `Instant` is opaque, so expiry is staged by planting an already-stale
        // entry rather than sleeping through the TTL. Skip (vacuous pass) if
        // the platform clock cannot represent an instant that far back.
        let Some(stale_instant) = std::time::Instant::now()
            .checked_sub(RELAY_SELF_CACHE_TTL + std::time::Duration::from_secs(1))
        else {
            return;
        };
        state
            .relay_self_cache
            .lock()
            .unwrap()
            .insert(relay_url.clone(), (stale_instant, "b".repeat(64)));

        let refreshed = fetch_relay_self_at(&state, &relay_url).await.unwrap();

        assert_eq!(refreshed.as_deref(), Some(self_hex.as_str()));
        assert_eq!(
            hits.load(Ordering::SeqCst),
            1,
            "an expired entry must be refetched from the relay"
        );
    }
}
