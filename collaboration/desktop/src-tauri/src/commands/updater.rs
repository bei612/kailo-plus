// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src-tauri/src/commands/updater.rs, plus the release-page lookup.
//
// DD-125(5): the update feed and its signing key come only from the Desktop release
// configuration injected at packaging time (apps ADR-06). A build without them does not
// register the updater plugin, so Updates shows the original "unavailable" state; there is
// no fallback to the original GitHub feed. The manual-download page is release
// configuration too and is absent when not configured.

/// Returns `true` when the running install supports Tauri's auto-updater.
///
/// On Linux, Tauri's updater only works for AppImage bundles.  The AppImage
/// runtime sets the `APPIMAGE` environment variable when the binary is
/// executed from an AppImage.  When that variable is absent (e.g. a `.deb`
/// install), the updater plugin will find an update but cannot swap the
/// binary, producing an "invalid binary format" error at install time.
///
/// On macOS and Windows every supported install format is auto-updatable,
/// so this always returns `true` on those platforms.
#[tauri::command]
pub fn is_auto_update_supported() -> bool {
    #[cfg(target_os = "linux")]
    {
        // The AppImage runtime always sets APPIMAGE to the path of the mounted
        // image file.  Its absence means we are running from a .deb, .rpm, or
        // other non-AppImage package that lacks an AppImage update target.
        std::env::var("APPIMAGE").is_ok()
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

/// The release page for manual downloads, when the release configuration provides one.
fn configured_release_url(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim();
    let parsed = url::Url::parse(value).ok()?;
    (parsed.scheme() == "https").then(|| parsed.to_string())
}

#[tauri::command]
pub fn updater_release_url() -> Option<String> {
    configured_release_url(option_env!("PLATFORM_DESKTOP_RELEASE_URL"))
}

#[cfg(test)]
mod tests {
    use super::configured_release_url;

    #[test]
    fn release_url_is_absent_unless_configured_with_https() {
        assert_eq!(configured_release_url(None), None);
        assert_eq!(configured_release_url(Some("  ")), None);
        assert_eq!(
            configured_release_url(Some("http://example.test/releases")),
            None
        );
        assert_eq!(configured_release_url(Some("not a url")), None);
        assert_eq!(
            configured_release_url(Some(" https://example.test/releases/latest ")),
            Some("https://example.test/releases/latest".into())
        );
    }
}
