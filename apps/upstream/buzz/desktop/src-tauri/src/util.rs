// ── Safe symlink utilities ────────────────────────────────────────────────────

/// No-op on non-Unix platforms.
#[cfg(not(unix))]
pub(crate) fn create_symlink(
    _target: &std::path::Path,
    _link: &std::path::Path,
) -> std::io::Result<()> {
    Ok(())
}

/// Suppress the console window that Windows otherwise allocates for every
/// console-subsystem child process spawned from a GUI (non-console) parent.
///
/// On Windows, a GUI application (no console window of its own) that spawns a
/// child console-subsystem binary gets a fresh, briefly-visible console window
/// per child unless `CREATE_NO_WINDOW` is set.  Setting it is a pure no-op on
/// non-Windows platforms, so callers can call this unconditionally.
pub(crate) fn configure_no_window(command: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command;
}
