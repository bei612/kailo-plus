//! DD-81/160 metadata-only proof through the original authenticated HTTP helpers.
use super::*;
use buzz_core_pkg::publication::MergedStatusDelivery;

pub(crate) async fn merged_status_delivery(
    event: &nostr::Event,
    http: &reqwest::Client,
    base: &str,
    keys: &Keys,
    check: impl Fn() -> Result<(), String> + Send + Sync,
) -> Result<MergedStatusDelivery, String> {
    buzz_core_pkg::publication::merged_status_repository(event, &keys.public_key())
        .map_err(str::to_owned)?;
    crate::relay_admission::wait_for_rate_limit().await;
    check()?;
    let url = format!("{}/events/delivery", base.trim_end_matches('/'));
    let body = event.as_json().into_bytes();
    let auth = build_nip98_auth_header_for_keys(keys, &Method::POST, &url, &body)?;
    let response = build_authenticated_relay_request(
        http,
        Method::POST,
        &url,
        &auth,
        Some(body),
        None,
        Some(QUERY_REQUEST_TIMEOUT),
    )
    .send()
    .await
    .map_err(|e| classify_request_error(&e))?;
    if !response.status().is_success() {
        return Err(relay_error_message(response).await);
    }
    let proof: MergedStatusDelivery = parse_json_response(response).await?;
    check()?;
    if proof.event_id != event.id.to_hex() || uuid::Uuid::parse_str(&proof.community_id).is_err() {
        return Err("relay returned malformed publication evidence".into());
    }
    Ok(proof)
}
