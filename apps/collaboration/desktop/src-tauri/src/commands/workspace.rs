use nostr::Keys;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager};

use crate::app_state::AppState;

const WORKSPACE_APPLY_SUPERSEDED: &str = "workspace apply superseded by a newer request";

fn next_apply_generation(generation: &std::sync::atomic::AtomicU64) -> u64 {
    generation.fetch_add(1, Ordering::AcqRel).wrapping_add(1)
}

fn assert_current_apply_generation(
    generation: &std::sync::atomic::AtomicU64,
    ticket: u64,
) -> Result<(), String> {
    if generation.load(Ordering::Acquire) == ticket {
        Ok(())
    } else {
        Err(WORKSPACE_APPLY_SUPERSEDED.to_string())
    }
}

async fn begin_workspace_apply(
    lock: std::sync::Arc<tokio::sync::Mutex<()>>,
    generation: &std::sync::atomic::AtomicU64,
) -> (tokio::sync::OwnedMutexGuard<()>, u64) {
    let guard = lock.lock_owned().await;
    let ticket = next_apply_generation(generation);
    (guard, ticket)
}

/// Apply a workspace's configuration to the backend session.
///
/// Called by the frontend on app init (after reload) and on community switch
/// to configure the Tauri backend with the selected workspace's relay URL and
/// keys. Applies are serialized: a queued apply cannot mutate relay/identity
/// until the running one has finished.
#[tauri::command]
pub async fn apply_workspace(
    relay_url: String,
    nsec: Option<String>,
    app: AppHandle,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    // Take the generation only after entering the serialized transaction. An
    // apply that is already running remains authoritative until it releases
    // the lock; the next apply then advances the generation.
    let (_apply_guard, apply_generation) = begin_workspace_apply(
        state.workspace_apply_lock.clone(),
        &state.workspace_apply_generation,
    )
    .await;

    // ── Validate before mutating ──────────────────────────────────────────
    let parsed_keys = match nsec.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(nsec_trimmed) => {
            Some(Keys::parse(nsec_trimmed).map_err(|e| format!("invalid nsec: {e}"))?)
        }
        None => None,
    };

    // Defense in depth: this transaction still owns the serialized apply
    // generation before making its first mutation.
    assert_current_apply_generation(&state.workspace_apply_generation, apply_generation)?;

    // ── Apply all state changes (nothing below can fail) ──────────────────
    {
        let mut override_guard = state.relay_url_override.lock().map_err(|e| e.to_string())?;
        *override_guard = Some(relay_url);
    }
    // Reset the Rust-side admission gate when switching workspace/community,
    // matching `resetRateLimitGate()` on the TS side.
    crate::relay_admission::reset_gate_for_workspace_change();

    if let Some(keys) = parsed_keys {
        let mut keys_guard = state.keys.lock().map_err(|e| e.to_string())?;
        *keys_guard = keys;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    };

    use super::{assert_current_apply_generation, begin_workspace_apply, next_apply_generation};

    #[test]
    fn explicit_newer_generation_supersedes_older_ticket() {
        let generation = AtomicU64::new(0);
        let older = next_apply_generation(&generation);
        let newer = next_apply_generation(&generation);

        let error = assert_current_apply_generation(&generation, older).unwrap_err();
        assert!(error.contains("superseded"), "{error}");
        assert_current_apply_generation(&generation, newer).unwrap();
    }

    #[tokio::test]
    async fn queued_apply_cannot_supersede_running_transaction_or_restore_phase() {
        let lock = Arc::new(tokio::sync::Mutex::new(()));
        let generation = Arc::new(AtomicU64::new(0));
        let (running_guard, running_ticket) =
            begin_workspace_apply(Arc::clone(&lock), &generation).await;

        let queued_lock = Arc::clone(&lock);
        let queued_generation = Arc::clone(&generation);
        let queued = tokio::spawn(async move {
            let (_guard, ticket) = begin_workspace_apply(queued_lock, &queued_generation).await;
            ticket
        });
        tokio::task::yield_now().await;

        // A queued workspace has not advanced the generation, so every awaited
        // phase of the running transaction, including one-shot launch restore,
        // remains authoritative while it holds the lock.
        assert_eq!(generation.load(Ordering::Acquire), running_ticket);
        assert_current_apply_generation(&generation, running_ticket).unwrap();
        assert!(!queued.is_finished());

        drop(running_guard);
        let queued_ticket = queued.await.unwrap();
        assert!(queued_ticket > running_ticket);
        assert_current_apply_generation(&generation, queued_ticket).unwrap();
    }
}
