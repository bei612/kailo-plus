use super::*;

/// Response from `POST /events`.
#[derive(Debug, Deserialize, serde::Serialize)]
pub struct SubmitEventResponse {
    pub event_id: String,
    pub accepted: bool,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub community_id: Option<String>,
}

/// POST an already-signed event to an explicit relay with an explicit owner.
///
/// Deferred/scoped publication uses this form so a workspace or identity
/// switch cannot retarget either the event or its NIP-98 authentication after
/// the operation captured its `(relay, owner)` scope.
pub async fn submit_signed_event_at_with_keys(
    event: &nostr::Event,
    state: &AppState,
    api_base_url: &str,
    keys: &nostr::Keys,
) -> Result<SubmitEventResponse, String> {
    submit_signed_event_scoped(event, &state.http_client, api_base_url, keys, None, || {
        Ok(())
    })
    .await
}

/// Original submit path with a lifecycle check after rate-limit waiting.
/// Scoped callers provide the original no-redirect authenticated client.
pub(crate) async fn submit_signed_event_scoped(
    event: &nostr::Event,
    http: &reqwest::Client,
    api_base_url: &str,
    keys: &nostr::Keys,
    community: Option<&str>,
    check: impl Fn() -> Result<(), String> + Send + Sync,
) -> Result<SubmitEventResponse, String> {
    if event.pubkey != keys.public_key() {
        return Err("signed event does not match the publishing identity".to_string());
    }
    crate::relay_admission::wait_for_rate_limit().await;
    check()?;
    let mut url = format!("{}/events", api_base_url.trim_end_matches('/'));
    if let Some(community) = community {
        url.push_str(&format!("?community={community}"));
    }
    let body_bytes = event.as_json().into_bytes();
    crate::egress_guard::assert_no_key_backup_bytes(&body_bytes, "relay event submit")?;
    let auth_header =
        build_nip98_publication_auth(keys, &Method::POST, &url, &body_bytes, community)?;

    let response = build_authenticated_relay_request(
        http,
        Method::POST,
        &url,
        &auth_header,
        Some(body_bytes),
        None,
        None,
    )
    .send()
    .await
    .map_err(|e| classify_request_error(&e))?;

    if !response.status().is_success() {
        let error = relay_error_message(response).await;
        // A refusal from this Host is not evidence about the original frozen
        // Community. Keep its original event available for writer reconciliation.
        return Err(if community.is_some() { "relay publish outcome unknown".into() } else { error });
    }

    let result: SubmitEventResponse = parse_json_response(response).await.map_err(|error| {
        if community.is_some() { "relay publish outcome unknown".into() } else { error }
    })?;
    if result.event_id != event.id.to_hex() {
        return Err("relay returned malformed response: event ID mismatch".to_string());
    }
    if community.is_some_and(|expected| result.community_id.as_deref() != Some(expected)) {
        return Err("relay returned malformed response: community ID mismatch".into());
    }
    if !result.accepted {
        return Err(if community.is_some() {
            "relay publish outcome unknown".into()
        } else { format!("relay rejected event: {}", result.message) });
    }

    Ok(result)
}

/// Sign with an explicit identity and POST the event to an explicit relay.
///
/// The caller owns the signer lifetime. This is important for deferred work:
/// an in-process identity swap cannot retarget the event or its NIP-98 auth
/// after the caller has validated which identity the operation belongs to.
#[cfg(test)]
pub async fn submit_event_at_with_keys(
    builder: nostr::EventBuilder,
    state: &AppState,
    api_base_url: &str,
    keys: &nostr::Keys,
) -> Result<SubmitEventResponse, String> {
    let event = builder
        .sign_with_keys(keys)
        .map_err(|e| format!("failed to sign event: {e}"))?;
    submit_signed_event_at_with_keys(&event, state, api_base_url, keys).await
}
