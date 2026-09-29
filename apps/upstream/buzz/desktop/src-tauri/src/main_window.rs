//! Restoring the macOS main window after it was hidden on close.

use tauri::{AppHandle, Manager, Runtime};

pub(crate) fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if let Err(error) = window.unminimize() {
        eprintln!("buzz-desktop: failed to restore main window: {error}");
        return;
    }
    if let Err(error) = window.show() {
        eprintln!("buzz-desktop: failed to show main window: {error}");
        return;
    }
    if let Err(error) = window.set_focus() {
        eprintln!("buzz-desktop: failed to focus main window: {error}");
    }
}
