//! Canonical relay identities and bounded native queries shared by callers.

use std::{collections::HashSet, future::Future};

use serde_json::{json, Value};
use thiserror::Error;
use url::{Host, Url};

/// Existing HTTP bridge top-level window default.
pub const BRIDGE_WINDOW_DEFAULT_LIMIT: u32 = 50;
/// Existing HTTP bridge top-level window ceiling.
pub const BRIDGE_WINDOW_MAX_LIMIT: u32 = 200;
/// Existing HTTP bridge thread-subtree ceiling, shared with native callers.
pub const BRIDGE_THREAD_MAX_LIMIT: u32 = 500;
/// Existing native thread-subtree traversal depth.
pub const DEFAULT_THREAD_DEPTH_LIMIT: u32 = 64;

/// Errors returned while canonicalizing a relay URL for runtime identity.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum NormalizeRelayUrlError {
    /// The input is not a valid URL.
    #[error("invalid relay URL: {0}")]
    InvalidUrl(String),
    /// Relay sockets must use WebSocket schemes.
    #[error("relay URL scheme must be ws or wss")]
    InvalidScheme,
    /// Relay identity never includes user credentials.
    #[error("relay URL must not contain credentials")]
    Credentials,
    /// Relay identity never includes a fragment.
    #[error("relay URL must not contain a fragment")]
    Fragment,
    /// A relay URL requires a host.
    #[error("relay URL must contain a host")]
    MissingHost,
}

/// Canonicalize a WebSocket relay URL for use as a runtime identity key.
///
/// This is the sole normalizer for `(agent, relay)` process identity. It keeps
/// the WebSocket scheme, lowercases DNS hosts, folds all loopback spellings to
/// `127.0.0.1`, removes default ports and a root slash, and preserves non-root
/// paths and queries. It deliberately is **not** the NIP-42 AUTH comparison
/// helper in `buzz-auth`: AUTH validation is a security boundary with narrower
/// equivalence rules and must not be widened by runtime-key canonicalization.
///
/// Connection code may retain the configured URL; this canonical form is for
/// identity, receipts, status and deduplication.
pub fn normalize_relay_url(raw: &str) -> Result<String, NormalizeRelayUrlError> {
    let mut url = Url::parse(raw.trim())
        .map_err(|error| NormalizeRelayUrlError::InvalidUrl(error.to_string()))?;
    if !matches!(url.scheme(), "ws" | "wss") {
        return Err(NormalizeRelayUrlError::InvalidScheme);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(NormalizeRelayUrlError::Credentials);
    }
    if url.fragment().is_some() {
        return Err(NormalizeRelayUrlError::Fragment);
    }

    let host = url.host().ok_or(NormalizeRelayUrlError::MissingHost)?;
    let loopback = match host {
        Host::Domain(domain) => domain.eq_ignore_ascii_case("localhost"),
        Host::Ipv4(address) => address.is_loopback(),
        Host::Ipv6(address) => address.is_loopback(),
    };
    if loopback {
        url.set_host(Some("127.0.0.1"))
            .map_err(|_| NormalizeRelayUrlError::MissingHost)?;
    } else if let Host::Domain(domain) = host {
        let lowercase = domain.to_ascii_lowercase();
        url.set_host(Some(&lowercase))
            .map_err(|_| NormalizeRelayUrlError::MissingHost)?;
    }

    let default_port = match url.scheme() {
        "ws" => Some(80),
        "wss" => Some(443),
        _ => None,
    };
    if url.port() == default_port {
        url.set_port(None)
            .map_err(|_| NormalizeRelayUrlError::InvalidScheme)?;
    }
    if url.path() == "/" {
        url.set_path("");
    }
    Ok(url.to_string().trim_end_matches('/').to_string())
}

/// An exhaustive raw query never treats an invalid or truncated page as empty.
#[derive(Debug, Error)]
pub enum QueryAllError<E> {
    /// The caller's existing authenticated transport failed.
    #[error("relay query failed")]
    Query(E),
    /// The page or cursor violates native `(created_at DESC, id ASC)` ordering.
    #[error("invalid relay query page or limits")]
    InvalidPage,
    /// An additional event proves the delivered exhaustive bound was exceeded.
    #[error("relay query event bound exceeded")]
    BoundExceeded,
}

/// Query one raw filter using Buzz's composite `(until, before_id)` cursor.
///
/// The caller retains its authenticated transport, timeout and delivered page
/// and event bounds. Both RestClient and CONTROL reads use this cursor loop;
/// it rejects repeated, out-of-order and oversized pages before exposing an
/// exhaustive result. A one-event probe distinguishes an exact-bound result
/// from a truncated one. Event signatures and business scope remain the
/// caller's validation responsibility.
pub async fn query_raw_all<E, F, Fut>(
    mut filter: Value,
    page_size: usize,
    event_bound: usize,
    mut query: F,
) -> Result<Vec<Value>, QueryAllError<E>>
where
    F: FnMut(Value) -> Fut,
    Fut: Future<Output = Result<Value, E>>,
{
    let probe_bound = event_bound
        .checked_add(1)
        .filter(|_| page_size > 0 && event_bound > 0 && filter.is_object())
        .ok_or(QueryAllError::InvalidPage)?;
    let mut events = Vec::new();
    let mut seen = HashSet::new();
    let mut cursor: Option<(u64, String)> = None;
    loop {
        let requested = page_size.min(probe_bound - events.len());
        filter["limit"] = json!(requested);
        let page = query(filter.clone()).await.map_err(QueryAllError::Query)?;
        let page = page.as_array().ok_or(QueryAllError::InvalidPage)?;
        if page.len() > requested {
            return Err(QueryAllError::InvalidPage);
        }
        let exhausted = page.len() < requested;
        for event in page {
            let timestamp = event
                .get("created_at")
                .and_then(Value::as_u64)
                .ok_or(QueryAllError::InvalidPage)?;
            let id = event
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| {
                    id.len() == 64
                        && id
                            .bytes()
                            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
                })
                .ok_or(QueryAllError::InvalidPage)?;
            if !seen.insert(id.to_owned())
                || cursor.as_ref().is_some_and(|(time, prior_id)| {
                    timestamp > *time || (timestamp == *time && id <= prior_id.as_str())
                })
            {
                return Err(QueryAllError::InvalidPage);
            }
            cursor = Some((timestamp, id.to_owned()));
        }
        if events.len() + page.len() > event_bound {
            return Err(QueryAllError::BoundExceeded);
        }
        events.extend(page.iter().cloned());
        if exhausted {
            return Ok(events);
        }
        let (timestamp, id) = cursor.as_ref().ok_or(QueryAllError::InvalidPage)?;
        filter["until"] = json!(timestamp);
        filter["before_id"] = json!(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_spellings_have_one_identity() {
        let ipv6 = normalize_relay_url("wss://[::1]/").unwrap();
        let ipv4 = normalize_relay_url("wss://127.0.0.1/").unwrap();
        let localhost = normalize_relay_url("wss://localhost/").unwrap();
        assert_eq!(ipv6, ipv4);
        assert_eq!(ipv4, localhost);
        assert_eq!(localhost, "wss://127.0.0.1");
    }

    #[test]
    fn canonicalizes_only_identity_equivalences() {
        assert_eq!(
            normalize_relay_url(" WSS://Relay.Example:443/ ").unwrap(),
            "wss://relay.example"
        );
        assert_eq!(
            normalize_relay_url("ws://relay.example:8080/community/?x=1").unwrap(),
            "ws://relay.example:8080/community/?x=1"
        );
    }

    #[test]
    fn rejects_non_relay_and_ambiguous_urls() {
        assert_eq!(
            normalize_relay_url("https://relay.example").unwrap_err(),
            NormalizeRelayUrlError::InvalidScheme
        );
        assert_eq!(
            normalize_relay_url("wss://user@relay.example").unwrap_err(),
            NormalizeRelayUrlError::Credentials
        );
        assert_eq!(
            normalize_relay_url("wss://relay.example/#x").unwrap_err(),
            NormalizeRelayUrlError::Fragment
        );
    }
}
