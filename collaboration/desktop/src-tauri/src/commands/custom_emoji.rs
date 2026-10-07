//! Original NIP-30 own-set operations with the captured CLIENT identity.
use crate::{
    app_state::AppState,
    relay::{
        assert_expected_relay_scope, assert_expected_signer, query_relay_at_with_keys,
        relay_api_base_url_with_override, submit_signed_event_at_with_keys,
    },
};
use buzz_core_pkg::kind::KIND_EMOJI_SET;
use buzz_sdk_pkg::{
    build_custom_emoji_set, normalize_custom_emoji_shortcode, CustomEmoji, CUSTOM_EMOJI_SET_D_TAG,
};
use sha2::{Digest, Sha256};
use tauri::State;

fn current_scope(state: &AppState, relay: &str, author: &str) -> Result<(), String> {
    assert_expected_relay_scope(Some(relay), &relay_api_base_url_with_override(state))?;
    assert_expected_signer(Some(author), &state.signing_keys()?.public_key().to_hex())
}

fn verify(events: &[nostr::Event], author: Option<&str>) -> Result<(), String> {
    if author.is_some() && events.len() > 1 {
        return Err("invalid own emoji set".into());
    }
    for event in events {
        if event.verify().is_err()
            || event.kind.as_u16() as u32 != KIND_EMOJI_SET
            || event.tags.identifier() != Some(CUSTOM_EMOJI_SET_D_TAG)
            || author.is_some_and(|author| author != event.pubkey.to_hex())
        {
            return Err("invalid emoji set".into());
        }
    }
    Ok(())
}

pub(super) async fn message_tags(
    state: &AppState,
    relay: &str,
    keys: &nostr::Keys,
    content: &str,
) -> Result<Vec<Vec<String>>, String> {
    if !content.contains(':') {
        return Ok(Vec::new());
    }
    let events = query_relay_at_with_keys(
        state,
        relay,
        &[serde_json::json!({"kinds":[KIND_EMOJI_SET],"#d":[CUSTOM_EMOJI_SET_D_TAG]})],
        keys,
        None,
    )
    .await?;
    buzz_sdk_pkg::custom_emoji_tags(content, &events).map_err(str::to_owned)
}

#[tauri::command]
pub async fn get_custom_emoji(
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let relay = relay_api_base_url_with_override(&state);
    let keys = state.signing_keys()?;
    let author = keys.public_key().to_hex();
    assert_expected_relay_scope(Some(&expected_relay_url), &relay)?;
    assert_expected_signer(Some(&expected_signer_pubkey), &author)?;
    let mut rows = query_relay_at_with_keys(
        &state,
        &relay,
        &[serde_json::json!({"kinds":[KIND_EMOJI_SET],"#d":[CUSTOM_EMOJI_SET_D_TAG]})],
        &keys,
        None,
    )
    .await?;
    verify(&rows, None)?;
    let own = query_relay_at_with_keys(&state, &relay,
        &[serde_json::json!({"kinds":[KIND_EMOJI_SET],"#d":[CUSTOM_EMOJI_SET_D_TAG],"authors":[author],"limit":1})], &keys, None).await?;
    verify(&own, Some(&author))?;
    rows.retain(|event| event.pubkey.to_hex() != author);
    rows.extend(own);
    current_scope(&state, &relay, &author)?;
    Ok(serde_json::json!({"pubkey":author,"events":rows,"mediaPaths":{}}))
}

#[tauri::command]
pub async fn update_custom_emoji(
    idempotency_key: String,
    shortcode: String,
    image_url: Option<String>,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, super::profile::ProfileUpdateError> {
    let key = uuid::Uuid::parse_str(&idempotency_key).map_err(|_| "invalid emoji intent")?;
    let shortcode =
        normalize_custom_emoji_shortcode(&shortcode).map_err(|_| "invalid emoji shortcode")?;
    let relay = relay_api_base_url_with_override(&state);
    let keys = state.signing_keys()?;
    let author = keys.public_key().to_hex();
    assert_expected_relay_scope(Some(&expected_relay_url), &relay)?;
    assert_expected_signer(Some(&expected_signer_pubkey), &author)?;
    let filter = serde_json::json!({"kinds":[KIND_EMOJI_SET],"#d":[CUSTOM_EMOJI_SET_D_TAG],"authors":[author],"limit":1});
    let digest = hex::encode(Sha256::digest(
        serde_json::json!([shortcode, image_url])
            .to_string()
            .as_bytes(),
    ));
    let prefix = format!("emoji:{relay}:{author}:{key}:");
    let pending = super::messages::unconfirmed::existing_mutation(&format!("{prefix}{digest}"))?;
    let rows = query_relay_at_with_keys(&state, &relay, &[filter.clone()], &keys, None)
        .await
        .map_err(|error| {
            if pending.is_some() {
                "relay publish outcome unknown".to_owned()
            } else {
                error
            }
        })?;
    if let Some(pending) = pending {
        verify(&rows, Some(&author)).map_err(|_| "relay publish outcome unknown")?;
        current_scope(&state, &relay, &author).map_err(|_| "relay publish outcome unknown")?;
        return if rows.first().is_some_and(|actual| actual.id == pending.id) {
            Ok(serde_json::json!({"eventId":pending.id.to_hex()}))
        } else {
            Err("relay publish outcome unknown".into())
        };
    }
    verify(&rows, Some(&author))?;
    let mut entries = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for event in &rows {
        for tag in event.tags.iter().map(|tag| tag.as_slice()) {
            if tag.first().map(String::as_str) != Some("emoji") {
                continue;
            }
            let (Some(name), Some(url)) = (tag.get(1), tag.get(2)) else {
                continue;
            };
            let Ok(name) = normalize_custom_emoji_shortcode(name) else {
                continue;
            };
            if name != shortcode && seen.insert(name.clone()) {
                entries.push(CustomEmoji {
                    shortcode: name,
                    url: url.clone(),
                });
            }
        }
    }
    if let Some(url) = image_url {
        entries.push(CustomEmoji { shortcode, url });
    }
    let builder = build_custom_emoji_set(&entries).map_err(|_| "invalid emoji set")?;
    let created = nostr::Timestamp::now().as_secs().max(
        rows.first()
            .map_or(0, |event| event.created_at.as_secs().saturating_add(1)),
    );
    let fresh = builder
        .custom_created_at(nostr::Timestamp::from(created))
        .sign_with_keys(&keys)
        .map_err(|_| "emoji signing failed")?;
    current_scope(&state, &relay, &author)?;
    let (event, first) = super::messages::unconfirmed::claim_profile(&prefix, &digest, fresh)?;
    if first {
        if let Err(error) = submit_signed_event_at_with_keys(&event, &state, &relay, &keys).await {
            if !super::messages::unconfirmed::outcome_unknown(&error) {
                return Err(error.into());
            }
        }
    }
    let actual = query_relay_at_with_keys(&state, &relay, &[filter], &keys, None)
        .await
        .map_err(|_| "relay publish outcome unknown")?;
    verify(&actual, Some(&author)).map_err(|_| "relay publish outcome unknown")?;
    current_scope(&state, &relay, &author).map_err(|_| "relay publish outcome unknown")?;
    if actual.first().is_none_or(|actual| actual.id != event.id) {
        return Err("relay publish outcome unknown".into());
    }
    Ok(serde_json::json!({"eventId":event.id.to_hex()}))
}
