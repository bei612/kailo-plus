/// Flush the persisted local caches exactly once, whichever of
/// `ExitRequested` / `Exit` reaches the run loop first.
pub(crate) fn shut_down_app(app: &tauri::AppHandle, shutdown_done: &std::sync::atomic::AtomicBool) {
    use std::sync::atomic::Ordering;

    if !shutdown_done.swap(true, Ordering::SeqCst) {
        crate::observed_unread::flush(app);
        crate::channel_head_cache::flush(app);
    }
}
