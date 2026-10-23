// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src-tauri/src/commands/os_idle.rs. DD-125(5)/DD-120(5): the OS idle time is the
// authoritative automatic-away signal; it is read locally and never reported anywhere.

/// Seconds since the last OS-wide user input (keyboard/mouse anywhere on the
/// machine), or `None` on platforms without a supported idle API (Linux
/// Wayland). Callers fall back to in-app activity tracking when `None`.
#[tauri::command]
pub fn get_os_idle_seconds() -> Option<u64> {
    #[cfg(any(target_os = "macos", windows))]
    {
        user_idle::UserIdle::get_time()
            .ok()
            .map(|idle| idle.as_seconds())
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        None
    }
}
