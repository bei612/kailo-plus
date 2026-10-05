//! Independent service page, without a capability granting platform IPC.
use reqwest::Method;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use uuid::Uuid;

use super::{api::NativeSession, commands::require_config};
use crate::app_state::AppState;

const PREFIX: &str = "platform-native-page-";

pub(crate) fn close_all(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with(PREFIX) {
            let _ = window.destroy();
        }
    }
}

#[tauri::command]
pub(crate) async fn platform_open_native_page(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    session: State<'_, NativeSession>,
    binding_id: String,
) -> Result<(), String> {
    // Only the original signed application's main window may request a launch.
    if window.label() != "main" {
        return Err("PLATFORM_NATIVE_PAGE_CALLER_DENIED".into());
    }
    let id = Uuid::parse_str(&binding_id).map_err(|_| "PLATFORM_NATIVE_PAGE_INVALID")?;
    let generation = session.page_generation()?;
    let cfg = require_config(&app)?;
    let response = session
        .call(
            &state.http_client,
            &cfg,
            Method::GET,
            &format!("/api/v1/application-bindings/{id}/native-page"),
            None,
        )
        .await?;
    if response.status != 200 {
        return Err(format!(
            "PLATFORM_NATIVE_PAGE_UNAVAILABLE ({})",
            response.status
        ));
    }
    let page = response.body;
    if page["bindingId"].as_str() != Some(id.to_string().as_str())
        || page["projectionGeneration"]
            .as_i64()
            .is_none_or(|value| value <= 0)
    {
        return Err("PLATFORM_NATIVE_PAGE_INVALID".into());
    }
    let url = url::Url::parse(page["url"].as_str().ok_or("PLATFORM_NATIVE_PAGE_INVALID")?)
        .map_err(|_| "PLATFORM_NATIVE_PAGE_INVALID")?;
    let origin = page["origin"]
        .as_str()
        .ok_or("PLATFORM_NATIVE_PAGE_INVALID")?
        .to_owned();
    let platform_origin = cfg
        .api_url("/api/v1/session")?
        .origin()
        .ascii_serialization();
    let allowed = page["allowedOrigins"]
        .as_array()
        .ok_or("PLATFORM_NATIVE_PAGE_INVALID")?
        .iter()
        .map(|item| {
            let text = item.as_str().ok_or("PLATFORM_NATIVE_PAGE_INVALID")?;
            let parsed = url::Url::parse(text).map_err(|_| "PLATFORM_NATIVE_PAGE_INVALID")?;
            if !matches!(parsed.scheme(), "http" | "https")
                || parsed.origin().ascii_serialization() != text
                || text == platform_origin
            {
                return Err("PLATFORM_NATIVE_PAGE_INVALID");
            }
            Ok(text.to_owned())
        })
        .collect::<Result<Vec<_>, &str>>()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.origin().ascii_serialization() != origin
        || !allowed.contains(&origin)
        || cfg.api_url("/api/v1/session")?.origin() == url.origin()
        || !session.page_generation_matches(generation)
    {
        return Err("PLATFORM_NATIVE_PAGE_INVALID".into());
    }
    let label = format!("{PREFIX}{id}");
    // Fresh BFF authorization precedes replacing even an already open window.
    if let Some(existing) = app.get_webview_window(&label) {
        existing
            .destroy()
            .map_err(|_| "PLATFORM_NATIVE_PAGE_CLOSE_FAILED")?;
    }
    let navigation_app = app.clone();
    let opened = WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
        .title(&origin)
        .on_navigation(move |next| {
            matches!(next.scheme(), "http" | "https")
                && next.username().is_empty()
                && next.password().is_none()
                && allowed.contains(&next.origin().ascii_serialization())
                && navigation_app
                    .state::<NativeSession>()
                    .page_generation_matches(generation)
        })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()
        .map_err(|_| "PLATFORM_NATIVE_PAGE_OPEN_FAILED")?;
    // Sign-out can race the asynchronous BFF read and window construction.
    if !session.page_generation_matches(generation) {
        opened
            .destroy()
            .map_err(|_| "PLATFORM_NATIVE_PAGE_CLOSE_FAILED")?;
        return Err("PLATFORM_NATIVE_PAGE_SESSION_CHANGED".into());
    }
    Ok(())
}
