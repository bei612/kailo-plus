//! DD-159 Desktop local archive: copies of channel messages the user can
//! already read, fetched only through this device's own authenticated Relay
//! query (CLIENT key, DD-75/79), sealed at rest with a per-identity archive key
//! that lives only in the OS keyring. No Core/BFF route, no platform identity.
//!
//! Original: `buzz/desktop/src-tauri/src/archive/mod.rs` (save subscriptions,
//! re-verified against the relay). The observer (24200) and turn-metric (44200)
//! scopes and `referenced_e` are not offered (DD-125(6), DD-159(1)).

mod lifecycle;
mod store;
pub(crate) use lifecycle::{change_device_key, erase_previous_identity, SessionArchive};
use lifecycle::{erase, erase_foreign};

use std::path::{Path, PathBuf};

use nostr::Keys;
use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

use crate::app_state::AppState;
use crate::platform::api::NativeSession;
use crate::relay::{query_relay_at, relay_api_base_url_with_override};
use store::{ArchiveStore, Subscription};

const PAGE_SIZE: usize = 500;
const MAX_PAGES_PER_SYNC: usize = 40;
const READ_LIMIT_MAX: u32 = 500;

static ARCHIVE_LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();

fn lock() -> &'static tokio::sync::Mutex<()> {
    ARCHIVE_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// What a sync learnt about one subscription.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Access {
    Readable,
    /// The relay definitively refuses this channel to this identity.
    Lost,
    /// The relay refuses this identity altogether (401).
    IdentityRejected,
    /// Network, timeout or server trouble: keep everything, retry later.
    Unknown,
}

/// Only explicit 401/403 answers revoke; everything else is transient (DD-159(4)).
pub(crate) fn classify_relay_error(error: &str) -> Access {
    if error.starts_with("relay returned 401") {
        Access::IdentityRejected
    } else if error.starts_with("relay returned 403") {
        Access::Lost
    } else {
        Access::Unknown
    }
}

/// Membership proof as in the original probe: the channel's 39002 roster lists
/// this identity, or (no roster) its 39000 metadata is readable.
pub(crate) fn access_from_roster(
    roster: &[nostr::Event],
    metadata_readable: bool,
    identity: &str,
) -> Access {
    match roster.first() {
        Some(event) => {
            let member = event.tags.iter().any(|tag| {
                let s = tag.as_slice();
                s.len() >= 2 && s[0] == "p" && s[1] == identity
            });
            if member || event.pubkey.to_hex() == identity {
                Access::Readable
            } else {
                Access::Lost
            }
        }
        None if metadata_readable => Access::Readable,
        None => Access::Unknown,
    }
}

async fn query_in_scope(
    state: &AppState,
    session: &NativeSession,
    identity: &str,
    relay: &str,
    filters: &[serde_json::Value],
) -> Result<Vec<nostr::Event>, Access> {
    let check = || {
        session.has_credentials().unwrap_or(false)
            && state
                .signing_keys()
                .is_ok_and(|keys| keys.public_key().to_hex() == identity)
            && relay_api_base_url_with_override(state) == relay
    };
    if !check() {
        return Err(Access::Unknown);
    }
    let result = query_relay_at(state, relay, filters).await;
    if !check() {
        return Err(Access::Unknown);
    }
    result.map_err(|error| classify_relay_error(&error))
}

async fn probe(
    state: &AppState,
    session: &NativeSession,
    identity: &str,
    relay: &str,
    channel_id: &str,
) -> Access {
    let roster = match query_in_scope(
        state,
        session,
        identity,
        relay,
        &[serde_json::json!({"kinds": [39002], "#d": [channel_id], "limit": 1})],
    )
    .await
    {
        Ok(events) => events,
        Err(access) => return access,
    };
    if !roster.is_empty() {
        return access_from_roster(&roster, false, identity);
    }
    match query_in_scope(
        state,
        session,
        identity,
        relay,
        &[serde_json::json!({"kinds": [39000], "#d": [channel_id], "limit": 1})],
    )
    .await
    {
        Ok(meta) => access_from_roster(&[], !meta.is_empty(), identity),
        Err(access) => access,
    }
}

fn identity_tag(pubkey: &str) -> String {
    hex::encode(Sha256::digest(pubkey.as_bytes()))[..32].to_string()
}

fn key_name(tag: &str) -> String {
    format!("local-archive:{tag}")
}

fn archive_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve local archive dir: {e}"))?
        .join("local-archive");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create local archive dir: {e}"))?;
    Ok(dir)
}

fn keyring() -> &'static crate::secret_store::SecretStore {
    crate::secret_store::SecretStore::shared(crate::app_state::keyring_service())
}

struct Opened {
    store: ArchiveStore,
    identity: String,
    relay: String,
    dir: PathBuf,
    tag: String,
}

fn open(app: &AppHandle, state: &AppState) -> Result<Opened, String> {
    if !app
        .state::<crate::platform::api::NativeSession>()
        .has_credentials()?
    {
        return Err("local archive: sign in required".into());
    }
    let identity = state.signing_keys()?.public_key().to_hex();
    let tag = identity_tag(&identity);
    let dir = archive_dir(app)?;
    erase_foreign(&dir, &tag, &|name| keyring().delete(name))?;
    let key = match keyring().load(&key_name(&tag))? {
        Some(secret) => {
            Keys::parse(&secret).map_err(|_| "local archive key corrupt".to_string())?
        }
        None => {
            // A file without its key is unreadable by design; start over.
            let stale = dir.join(format!("{tag}.sqlite"));
            if stale.exists() {
                std::fs::remove_file(&stale).map_err(|e| format!("remove local archive: {e}"))?;
            }
            let keys = Keys::generate();
            keyring().store(&key_name(&tag), &keys.secret_key().to_secret_hex())?;
            keys
        }
    };
    let conn = Connection::open(dir.join(format!("{tag}.sqlite")))
        .map_err(|e| format!("open local archive: {e}"))?;
    Ok(Opened {
        store: ArchiveStore::open(conn, key)?,
        identity,
        relay: relay_api_base_url_with_override(state),
        dir,
        tag,
    })
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalArchiveStatus {
    subscriptions: Vec<Subscription>,
    bytes: u64,
    archivable_kinds: Vec<u16>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalArchiveSyncResult {
    channel_id: String,
    /// `ok` | `retry` | `access_lost` (subscription and copies removed) | `identity_rejected`
    result: &'static str,
    stored: usize,
}

fn status_of(opened: &Opened) -> Result<LocalArchiveStatus, String> {
    let bytes = std::fs::metadata(opened.dir.join(format!("{}.sqlite", opened.tag)))
        .map(|m| m.len())
        .unwrap_or_default();
    Ok(LocalArchiveStatus {
        subscriptions: opened.store.subscriptions()?,
        bytes,
        archivable_kinds: store::ARCHIVABLE_KINDS.to_vec(),
    })
}

#[tauri::command]
pub async fn local_archive_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LocalArchiveStatus, String> {
    let _guard = lock().lock().await;
    status_of(&open(&app, &state)?)
}

/// Subscribes a channel or DM only after the relay proves this identity reads it.
#[tauri::command]
pub async fn local_archive_subscribe(
    app: AppHandle,
    state: State<'_, AppState>,
    channel_id: String,
    kinds: Vec<u16>,
) -> Result<LocalArchiveStatus, String> {
    let _guard = lock().lock().await;
    let opened = open(&app, &state)?;
    match probe(
        &state,
        &app.state::<NativeSession>(),
        &opened.identity,
        &opened.relay,
        &channel_id,
    )
    .await
    {
        Access::Readable => {}
        Access::Lost => {
            opened.store.unsubscribe(&channel_id)?;
            return Err("local archive: channel not readable".into());
        }
        Access::IdentityRejected => {
            let tag = opened.tag.clone();
            let dir = opened.dir.clone();
            drop(opened);
            erase(&dir, &tag)?;
            return Err("local archive: identity rejected".into());
        }
        Access::Unknown => return Err("local archive: relay unavailable, try again".into()),
    }
    opened.store.subscribe(&channel_id, &kinds, now())?;
    status_of(&opened)
}

#[tauri::command]
pub async fn local_archive_unsubscribe(
    app: AppHandle,
    state: State<'_, AppState>,
    channel_id: String,
) -> Result<LocalArchiveStatus, String> {
    let _guard = lock().lock().await;
    let opened = open(&app, &state)?;
    opened.store.unsubscribe(&channel_id)?;
    status_of(&opened)
}

/// Crypto-erases this identity's archive (key, then file).
#[tauri::command]
pub async fn local_archive_clear(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let _guard = lock().lock().await;
    let identity = state.signing_keys()?.public_key().to_hex();
    erase(&archive_dir(&app)?, &identity_tag(&identity))
}

/// Re-checks access and pulls new events for every subscription.
#[tauri::command]
pub async fn local_archive_sync(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<LocalArchiveSyncResult>, String> {
    let _guard = lock().lock().await;
    let mut opened = open(&app, &state)?;
    let mut results = Vec::new();
    for sub in opened.store.subscriptions()? {
        let access = probe(
            &state,
            &app.state::<NativeSession>(),
            &opened.identity,
            &opened.relay,
            &sub.channel_id,
        )
        .await;
        let outcome = match access {
            Access::Readable => {
                pull(
                    &state,
                    &app.state::<NativeSession>(),
                    &opened.identity,
                    &opened.relay,
                    &mut opened.store,
                    &sub,
                )
                .await
            }
            other => Err(other),
        };
        match outcome {
            Ok((stored, cursor)) => {
                opened.store.finish_pages(&sub.channel_id, cursor, now())?;
                results.push(LocalArchiveSyncResult {
                    channel_id: sub.channel_id,
                    result: "ok",
                    stored,
                });
            }
            Err(Access::Lost) => {
                opened.store.unsubscribe(&sub.channel_id)?;
                results.push(LocalArchiveSyncResult {
                    channel_id: sub.channel_id,
                    result: "access_lost",
                    stored: 0,
                });
            }
            Err(Access::IdentityRejected) => {
                let tag = opened.tag.clone();
                let dir = opened.dir.clone();
                drop(opened);
                erase(&dir, &tag)?;
                results.push(LocalArchiveSyncResult {
                    channel_id: sub.channel_id,
                    result: "identity_rejected",
                    stored: 0,
                });
                return Ok(results);
            }
            Err(Access::Unknown) | Err(Access::Readable) => {
                opened
                    .store
                    .record_sync(&sub.channel_id, "retry", None, now())?;
                results.push(LocalArchiveSyncResult {
                    channel_id: sub.channel_id,
                    result: "retry",
                    stored: 0,
                });
            }
        }
    }
    Ok(results)
}

async fn pull(
    state: &AppState,
    session: &NativeSession,
    identity: &str,
    relay: &str,
    store: &mut ArchiveStore,
    sub: &Subscription,
) -> Result<(usize, i64), Access> {
    // Deletions are required even when the user selected messages only.
    let mut kinds = sub.kinds.clone();
    kinds.extend([5, 9005]);
    kinds.sort_unstable();
    kinds.dedup();
    let mut filter = serde_json::json!({
        "kinds": kinds,
        "#h": [sub.channel_id],
        "since": sub.cursor,
        "limit": PAGE_SIZE,
    });
    let mut stored = 0;
    let mut cursor = sub.cursor;
    if let Some((until, before_id, newest)) = store
        .page_cursor(&sub.channel_id)
        .map_err(|_| Access::Unknown)?
    {
        filter["until"] = serde_json::json!(until);
        filter["before_id"] = serde_json::json!(before_id);
        cursor = cursor.max(newest);
    }
    for _ in 0..MAX_PAGES_PER_SYNC {
        let page = query_in_scope(state, session, identity, relay, &[filter.clone()]).await?;
        stored += store
            .ingest(&sub.channel_id, &page)
            .map_err(|_| Access::Unknown)?;
        if let Some(newest) = page.iter().map(|e| e.created_at.as_secs() as i64).max() {
            cursor = cursor.max(newest);
        }
        let Some(last) = page.last() else {
            return Ok((stored, cursor));
        };
        if page.len() < PAGE_SIZE {
            return Ok((stored, cursor));
        }
        store
            .save_page(
                &sub.channel_id,
                last.created_at.as_secs() as i64,
                &last.id.to_hex(),
                cursor,
            )
            .map_err(|_| Access::Unknown)?;
        filter["until"] = serde_json::json!(last.created_at.as_secs());
        filter["before_id"] = serde_json::json!(last.id.to_hex());
    }
    // A bounded round is incomplete, not a successful sync. Continue from the
    // durable composite page cursor next round without skipping older pages.
    Err(Access::Unknown)
}

/// Opens archived copies of one subscribed channel, newest first.
#[tauri::command]
pub async fn local_archive_read(
    app: AppHandle,
    state: State<'_, AppState>,
    channel_id: String,
    limit: Option<u32>,
) -> Result<Vec<serde_json::Value>, String> {
    let _guard = lock().lock().await;
    let opened = open(&app, &state)?;
    if opened.store.subscription(&channel_id)?.is_none() {
        return Err("local archive: not subscribed".into());
    }
    let limit = limit.unwrap_or(100).min(READ_LIMIT_MAX);
    opened
        .store
        .read(&channel_id, limit)?
        .into_iter()
        .map(|event| serde_json::to_value(event).map_err(|e| e.to_string()))
        .collect()
}

#[cfg(test)]
#[path = "mod_tests.rs"]
mod tests;
