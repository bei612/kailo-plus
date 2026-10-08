use nostr::{EventBuilder, JsonUtil, Kind, PublicKey, Tag, Timestamp, ToBech32};
use tauri::Manager;
use tauri::State;

use crate::{
    app_state::AppState,
    models::IdentityInfo,
    relay::{relay_api_base_url_with_override, relay_ws_url_with_override},
};

/// Encode `pubkey` as npub bech32 and truncate it for display: first 8
/// chars, an ellipsis, then the last 4 chars, mirroring the frontend
/// `truncateNpub` compact policy (`first8…last4` of the whole npub string).
/// Returns the full bech32 when it is 12 chars or fewer, mirroring
/// `truncatePubkey`'s short-string threshold.
fn truncated_display_name(pubkey: &PublicKey) -> Result<String, String> {
    let bech32 = pubkey
        .to_bech32()
        .map_err(|error| format!("bech32 encode failed: {error}"))?;
    Ok(if bech32.len() > 12 {
        format!("{}…{}", &bech32[..8], &bech32[bech32.len() - 4..])
    } else {
        bech32
    })
}

#[cfg(test)]
mod truncated_display_name_tests {
    use super::truncated_display_name;
    use nostr::{PublicKey, ToBech32};

    #[test]
    fn compacts_to_first_8_and_last_4_of_the_npub() {
        // Vector shared with the frontend `truncateNpub` tests; the expected
        // form is derived from the encoded npub, not hardcoded, so the test
        // asserts the compaction policy rather than one key's string.
        let hex = "ea9b4d7a7a78a3e3729e5568b14d764d4962be0e1f20f749bcf8d9dbbf9a9328";
        let pubkey = PublicKey::from_hex(hex).unwrap();
        let npub = pubkey.to_bech32().unwrap();
        let expected = format!("{}…{}", &npub[..8], &npub[npub.len() - 4..]);
        assert_eq!(truncated_display_name(&pubkey).unwrap(), expected);
        // 13 characters, matching the frontend compact form (the ellipsis is
        // one char but three UTF-8 bytes, so count chars, not bytes).
        assert_eq!(expected.chars().count(), 13);
        assert!(expected.starts_with("npub1"));
        // The compact form must not carry the raw hex key.
        assert!(!expected.contains(hex));
    }
}

#[tauri::command]
pub fn get_identity(state: State<'_, AppState>) -> Result<IdentityInfo, String> {
    let keys = state.keys.lock().map_err(|error| error.to_string())?;
    let pubkey = keys.public_key();
    let pubkey_hex = pubkey.to_hex();
    let display_name = truncated_display_name(&pubkey)?;
    let lost = state
        .identity_lost
        .load(std::sync::atomic::Ordering::Acquire);
    let locked = state
        .keyring_locked
        .load(std::sync::atomic::Ordering::Acquire);

    Ok(IdentityInfo {
        pubkey: pubkey_hex,
        display_name,
        storage: state.identity_storage().as_str().to_string(),
        lost,
        locked,
    })
}

#[tauri::command]
pub fn get_relay_ws_url(state: State<'_, AppState>) -> String {
    relay_ws_url_with_override(&state)
}

#[tauri::command]
pub fn get_relay_http_url(state: State<'_, AppState>) -> String {
    relay_api_base_url_with_override(&state)
}

#[tauri::command]
pub fn get_media_proxy_port(state: State<'_, AppState>) -> u16 {
    state
        .media_proxy_port
        .load(std::sync::atomic::Ordering::Relaxed)
}

#[tauri::command]
pub async fn sign_event(
    kind: u16,
    content: String,
    created_at: Option<u64>,
    tags: Vec<Vec<String>>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let keys = state.signing_keys()?;

    tauri::async_runtime::spawn_blocking(move || {
        let nostr_tags = tags
            .into_iter()
            .map(|tag| Tag::parse(tag).map_err(|error| format!("invalid tag: {error}")))
            .collect::<Result<Vec<_>, _>>()?;

        let mut builder = EventBuilder::new(Kind::Custom(kind), content).tags(nostr_tags);
        if let Some(created_at) = created_at {
            builder = builder.custom_created_at(Timestamp::from(created_at));
        }

        let event = builder
            .sign_with_keys(&keys)
            .map_err(|error| format!("sign failed: {error}"))?;

        Ok(event.as_json())
    })
    .await
    .map_err(|e| format!("spawn_blocking failed: {e}"))?
}

fn backup_identity(state: &AppState, expected_pubkey: &str) -> Result<nostr::Keys, String> {
    let expected =
        PublicKey::from_hex(expected_pubkey).map_err(|_| "invalid backup identity".to_string())?;
    let keys = state.signing_keys()?;
    if keys.public_key() != expected {
        return Err("backup identity changed".to_string());
    }
    Ok(keys)
}

#[tauri::command]
pub fn get_nsec(expected_pubkey: String, state: State<'_, AppState>) -> Result<String, String> {
    let keys = backup_identity(&state, &expected_pubkey)?;
    keys.secret_key()
        .to_bech32()
        .map_err(|error| format!("encode nsec: {error}"))
}

/// Generate a passphrase for a new encrypted backup (EFF short wordlist, OS
/// entropy). `words` is clamped to the range allowed by `key_backup`;
/// `separator` joins the words (defaults to a space).
#[tauri::command]
pub fn generate_backup_passphrase(
    words: Option<u32>,
    separator: Option<String>,
) -> Result<String, String> {
    crate::key_backup::generate_passphrase(
        words.map_or(crate::key_backup::DEFAULT_PASSPHRASE_WORDS, |w| w as usize),
        separator.as_deref().unwrap_or(" "),
    )
}

/// Create and verify a backup while holding the existing local identity lock.
pub(crate) fn create_backup_with_log_n(
    state: &AppState,
    password: &str,
    expected_pubkey: &str,
    log_n: u8,
) -> Result<String, String> {
    if password.chars().count() < crate::key_backup::MIN_PASSPHRASE_LEN {
        return Err(format!(
            "passphrase must be at least {} characters",
            crate::key_backup::MIN_PASSPHRASE_LEN
        ));
    }

    // Serialize against persist_current_identity: the blob
    // must be derived from one stable identity. Also
    // caps KDF concurrency at one.
    let _mutation_guard = state.identity_mutation.lock().map_err(|e| e.to_string())?;

    // Recovery mode (lost/locked) → Err, same gate as signing.
    let keys = backup_identity(state, expected_pubkey)?;

    crate::key_backup::create_backup_blob(&keys, password, log_n)
}

/// Create a NIP-49 backup of the live identity in memory.
///
/// Encrypts under `password`, decrypt-verifies the fresh blob against the live
/// pubkey, and returns the `ncryptsec1…` string for the native save flow. The
/// body runs under `identity_mutation`, so identity changes cannot race the KDF.
#[tauri::command]
pub async fn create_ncryptsec_backup(
    password: String,
    expected_pubkey: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let password = zeroize::Zeroizing::new(password);
        let state = app_handle.state::<AppState>();
        create_backup_with_log_n(
            &state,
            &password,
            &expected_pubkey,
            crate::key_backup::BACKUP_LOG_N,
        )
    })
    .await
    .map_err(|e| format!("spawn_blocking failed: {e}"))?
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupVerification {
    pub pubkey: String,
    pub npub: String,
    pub matches_current_identity: bool,
}

fn verify_ncryptsec_backup_inner(
    state: &AppState,
    ncryptsec: &str,
    password: &str,
    expected_pubkey: &str,
) -> Result<BackupVerification, String> {
    let _mutation_guard = state.identity_mutation.lock().map_err(|e| e.to_string())?;
    let current = backup_identity(state, expected_pubkey)?.public_key();
    let keys = crate::key_backup::decrypt_ncryptsec(ncryptsec, password)?;
    let pubkey = keys.public_key();
    Ok(BackupVerification {
        pubkey: pubkey.to_hex(),
        npub: pubkey
            .to_bech32()
            .map_err(|e| format!("encode backup identity: {e}"))?,
        matches_current_identity: pubkey == current,
    })
}

/// Decrypt and validate a NIP-49 backup without exposing its secret key.
#[tauri::command]
pub async fn verify_ncryptsec_backup(
    ncryptsec: String,
    password: String,
    expected_pubkey: String,
    app_handle: tauri::AppHandle,
) -> Result<BackupVerification, String> {
    tokio::task::spawn_blocking(move || {
        let password = zeroize::Zeroizing::new(password);
        let state = app_handle.state::<AppState>();
        verify_ncryptsec_backup_inner(&state, &ncryptsec, &password, &expected_pubkey)
    })
    .await
    .map_err(|e| format!("spawn_blocking failed: {e}"))?
}

/// Save a portable copy of an `ncryptsec1…` backup to a user-chosen path.
///
/// The input must parse as a structurally valid NIP-49 payload. The dialog is
/// selection-only; the write uses the exact save-panel-authorized path with
/// owner-only permissions, sync, and reread verification. Existing files are
/// preserved rather than truncated. Never mutates canonical app state. Returns
/// the chosen path, or `None` when the user cancelled.
#[tauri::command]
pub async fn save_ncryptsec_copy(
    ncryptsec: String,
    expected_pubkey: String,
    app_handle: tauri::AppHandle,
) -> Result<Option<String>, String> {
    // Reject anything that is not a valid encrypted-key blob — this command
    // must not become a generic file writer.
    backup_identity(&app_handle.state::<AppState>(), &expected_pubkey)?;
    crate::key_backup::parse_ncryptsec(&ncryptsec)?;
    let normalized = ncryptsec.trim().to_string();

    let dest = match crate::commands::export_util::pick_save_path(
        &app_handle,
        crate::key_backup::BACKUP_FILE_NAME,
        "Password-protected key backup",
        &["ncryptsec"],
    )
    .await?
    {
        Some(p) => p,
        None => return Ok(None),
    };

    let dest_for_write = dest.clone();
    tokio::task::spawn_blocking(move || {
        let state = app_handle.state::<AppState>();
        let _mutation_guard = state.identity_mutation.lock().map_err(|e| e.to_string())?;
        backup_identity(&state, &expected_pubkey)?;
        crate::key_backup::write_portable_backup_file(&dest_for_write, &normalized)
    })
    .await
    .map_err(|e| format!("spawn_blocking failed: {e}"))??;

    Ok(Some(dest.display().to_string()))
}

/// Make the current ephemeral identity durable by persisting it to the OS
/// keyring (or falling back to identity.key). This is called when the user
/// chooses to start a new identity instead of re-importing their previous one
/// — it converts the transient lost-state key into a permanent identity.
///
/// **LOST-ONLY**: returns `Err` when `identity_lost` is false, and deliberately
/// does NOT accept `keyring_locked`. In locked state the user's real identity
/// still exists in the unreachable keyring; persisting the ephemeral key to
/// `identity.key` would make it appear as a "different key" on next boot,
/// and the mismatched-file adoption path would then clobber the real keyring
/// key once the keyring becomes reachable again. The correct action in locked
/// state is to unlock the keyring and relaunch — not to adopt the ephemeral key.
#[tauri::command]
pub async fn persist_current_identity(
    app_handle: tauri::AppHandle,
) -> Result<IdentityInfo, String> {
    tokio::task::spawn_blocking(move || {
        let state = app_handle.state::<AppState>();

        // Acquire mutation lock before reading identity_lost so that a
        // concurrent import_identity cannot complete between our check and
        // our persist, which would let the stale ephemeral key overwrite the
        // imported one.
        let _mutation_guard = state.identity_mutation.lock().map_err(|e| e.to_string())?;

        if !state
            .identity_lost
            .load(std::sync::atomic::Ordering::Acquire)
        {
            return Err("identity is not in a lost state".to_string());
        }

        // Clone current keys without holding the mutex across keyring I/O.
        let keys = state.keys.lock().map_err(|e| e.to_string())?.clone();

        let data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("app data dir: {e}"))?;
        std::fs::create_dir_all(&data_dir).map_err(|e| format!("create app data dir: {e}"))?;
        let key_path = data_dir.join("identity.key");

        let store = crate::secret_store::SecretStore::shared(crate::app_state::keyring_service());
        let storage =
            crate::app_state::persist_imported_identity(store, &keys, &key_path, &data_dir)?;

        // Keys are already the live identity. Record where the durable write
        // landed before clearing identity_lost.
        state.set_identity_storage(storage);
        state
            .identity_lost
            .store(false, std::sync::atomic::Ordering::Release);

        let pubkey = keys.public_key();
        let pubkey_hex = pubkey.to_hex();
        let display_name = truncated_display_name(&pubkey)?;

        Ok(IdentityInfo {
            pubkey: pubkey_hex,
            display_name,
            storage: storage.as_str().to_string(),
            lost: false,
            locked: false,
        })
    })
    .await
    .map_err(|e| format!("spawn_blocking failed: {e}"))?
}

#[tauri::command]
pub async fn create_auth_event(
    challenge: String,
    relay_url: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let keys = state.signing_keys()?;

    tauri::async_runtime::spawn_blocking(move || {
        let tags = vec![
            Tag::parse(vec!["relay", &relay_url])
                .map_err(|error| format!("relay tag failed: {error}"))?,
            Tag::parse(vec!["challenge", &challenge])
                .map_err(|error| format!("challenge tag failed: {error}"))?,
        ];

        let event = EventBuilder::new(Kind::Custom(22242), "")
            .tags(tags)
            .sign_with_keys(&keys)
            .map_err(|error| format!("sign failed: {error}"))?;

        Ok(event.as_json())
    })
    .await
    .map_err(|e| format!("spawn_blocking failed: {e}"))?
}
