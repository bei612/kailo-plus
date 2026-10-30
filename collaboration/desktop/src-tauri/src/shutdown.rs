use tauri::Manager;

/// Flush the persisted local caches exactly once, whichever of
/// `ExitRequested` / `Exit` reaches the run loop first.
pub(crate) fn shut_down_app(app: &tauri::AppHandle, shutdown_done: &std::sync::atomic::AtomicBool) {
    use std::sync::atomic::Ordering;

    if !shutdown_done.swap(true, Ordering::SeqCst) {
        crate::observed_unread::flush(app);
        crate::channel_head_cache::flush(app);
        // DD-161(5): closing the app ends every PTY child.
        app.state::<crate::terminal_runtime::TerminalSessions>()
            .shutdown_all();
    }
}
