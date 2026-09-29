//! Locating the user's `ffmpeg` binary for video/voice-note/HEIC uploads.
//!
//! A GUI-launched app does not inherit the interactive shell's `PATH` on
//! macOS, so a Homebrew or mise install is invisible to a plain `PATH` scan.
//! Resolution therefore tries, in order: the process `PATH`, the login
//! shell's `command -v`, then the well-known package-manager bin dirs.
//! Only hits are cached, so installing ffmpeg mid-session is picked up on
//! the next upload without a restart.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
#[cfg(not(windows))]
use std::time::{Duration, Instant};

/// Wall-clock bound for one login-shell probe. A shell whose rc files block
/// (interactive prompt, stalled mount) is killed and treated as a miss.
#[cfg(not(windows))]
const LOGIN_SHELL_TIMEOUT: Duration = Duration::from_secs(10);

fn executable_name() -> &'static str {
    if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    }
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn find_in_process_path() -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|dir| dir.join(executable_name()))
        .find(|candidate| is_executable_file(candidate))
}

/// Wait for `child` up to `timeout`, killing it on expiry.
#[cfg(not(windows))]
fn wait_with_timeout(
    mut child: std::process::Child,
    timeout: Duration,
) -> Option<std::process::Output> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

#[cfg(not(windows))]
fn find_via_login_shell() -> Option<PathBuf> {
    use std::process::{Command, Stdio};

    for shell in ["/bin/zsh", "/bin/bash"] {
        let Ok(child) = Command::new(shell)
            .args(["-l", "-c", r#"command -v -- "$1""#, "_", executable_name()])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        else {
            continue;
        };
        let Some(output) = wait_with_timeout(child, LOGIN_SHELL_TIMEOUT) else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let Some(line) = stdout.lines().rfind(|line| !line.trim().is_empty()) else {
            continue;
        };
        let path = PathBuf::from(line.trim());
        if path.is_absolute() && is_executable_file(&path) {
            return Some(path);
        }
    }
    None
}

#[cfg(windows)]
fn find_via_login_shell() -> Option<PathBuf> {
    None
}

fn well_known_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/home/linuxbrew/.linuxbrew/bin"),
    ];
    if let Some(home) = dirs::home_dir() {
        dirs.extend([
            home.join(".local/share/mise/shims"),
            home.join(".local/bin"),
            home.join(".asdf/shims"),
        ]);
    }
    dirs
}

fn resolve_uncached() -> Option<PathBuf> {
    find_in_process_path()
        .or_else(find_via_login_shell)
        .or_else(|| {
            well_known_dirs()
                .into_iter()
                .map(|dir| dir.join(executable_name()))
                .find(|candidate| is_executable_file(candidate))
        })
}

/// Resolve `ffmpeg` to an absolute path. Positive results are cached for the
/// app lifetime; a miss re-probes on the next call.
pub(super) fn resolve_ffmpeg() -> Option<PathBuf> {
    static CACHE: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    if let Some(hit) = cache.lock().ok().and_then(|guard| guard.clone()) {
        return Some(hit);
    }
    let resolved = resolve_uncached()?;
    if let Ok(mut guard) = cache.lock() {
        *guard = Some(resolved.clone());
    }
    Some(resolved)
}
