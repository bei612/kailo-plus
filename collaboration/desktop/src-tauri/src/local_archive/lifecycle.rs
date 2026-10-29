//! DD-159 archive retirement, serialized with all archive readers and syncs.
use super::*;

/// Archives of any other local identity are erased: key first, then file
/// (DD-159(4), identity switch / sign-out / device key change).
pub(crate) fn erase_foreign(
    dir: &Path,
    current_tag: &str,
    delete_key: &dyn Fn(&str) -> Result<(), String>,
) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if path.extension().and_then(|e| e.to_str()) != Some("sqlite") || stem == current_tag {
            continue;
        }
        delete_key(&key_name(stem))?;
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn erase_previous_identity(app: &AppHandle, state: &AppState) -> Result<(), String> {
    // Called only by synchronous setup or identity recovery's spawn_blocking.
    let _guard = lock().blocking_lock();
    // A locked keychain gives an ephemeral recovery identity, not a new user.
    let Ok(keys) = state.signing_keys() else {
        return Ok(());
    };
    erase_foreign(
        &archive_dir(app)?,
        &identity_tag(&keys.public_key().to_hex()),
        &|name| keyring().delete(name),
    )
}

pub(super) fn erase(dir: &Path, tag: &str) -> Result<(), String> {
    keyring().delete(&key_name(tag))?;
    let path = dir.join(format!("{tag}.sqlite"));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("remove local archive: {e}"))?;
    }
    Ok(())
}

/// Installed in NativeSession: credential retirement and archive erasure finish
/// under one lifecycle lock before any new login can adopt credentials.
pub(crate) struct SessionArchive(pub AppHandle);

impl crate::platform::api::SessionArchive for SessionArchive {
    fn erase(
        &self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + '_>> {
        Box::pin(async move {
            let _guard = lock().lock().await;
            erase_all(&archive_dir(&self.0)?)
        })
    }
}

pub(crate) async fn change_device_key(
    app: &AppHandle,
    state: &AppState,
    keys: Keys,
) -> Result<(), String> {
    replace_device_key(&state.keys, keys, || erase_all(&archive_dir(app)?)).await
}

async fn replace_device_key(
    current: &std::sync::Mutex<Keys>,
    next: Keys,
    erase_old: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let _guard = lock().lock().await;
    let mut current = current.lock().map_err(|e| e.to_string())?;
    if current.public_key() != next.public_key() {
        // Old sync/read operations have drained; no command can reopen the old
        // identity between erasure and key replacement (including on Windows).
        erase_old()?;
        *current = next;
    }
    Ok(())
}

fn erase_all(dir: &Path) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) == Some("sqlite") {
            if let Some(tag) = path.file_stem().and_then(|s| s.to_str()) {
                erase(dir, tag)?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn device_key_change_waits_for_old_archive_operations_and_erases_before_switch() {
        let current = std::sync::Arc::new(std::sync::Mutex::new(Keys::generate()));
        let old = current.lock().unwrap().public_key();
        let next = Keys::generate();
        let next_pubkey = next.public_key();
        let guard = lock().lock().await;
        let task_current = current.clone();
        let erased = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let task_erased = erased.clone();
        let task = tokio::spawn(async move {
            replace_device_key(&task_current, next, || {
                task_erased.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            })
            .await
        });
        tokio::task::yield_now().await;
        assert!(!task.is_finished());
        assert_eq!(current.lock().unwrap().public_key(), old);
        drop(guard);
        task.await.unwrap().unwrap();
        assert!(erased.load(std::sync::atomic::Ordering::SeqCst));
        assert_eq!(current.lock().unwrap().public_key(), next_pubkey);
    }

    #[tokio::test]
    async fn failed_erasure_preserves_device_identity_and_same_key_does_not_erase() {
        let keys = Keys::generate();
        let current = std::sync::Mutex::new(keys.clone());
        assert!(
            replace_device_key(&current, Keys::generate(), || Err("locked".into()))
                .await
                .is_err()
        );
        assert_eq!(current.lock().unwrap().public_key(), keys.public_key());
        replace_device_key(&current, keys, || panic!("same key is not a switch"))
            .await
            .unwrap();
    }
}
