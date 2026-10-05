//! Independent service page, without a capability granting platform IPC.
use reqwest::Method;
use std::sync::Arc;
use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use uuid::Uuid;

use super::{api::NativeSession, commands::require_config};
use crate::app_state::AppState;

const PREFIX: &str = "platform-native-page-";

fn allowed_navigation(url: &url::Url, origins: &[String]) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
        && origins.contains(&url.origin().ascii_serialization())
}

fn open_window(
    app: &AppHandle,
    label: String,
    url: url::Url,
    origins: Arc<Vec<String>>,
    generation: u64,
    features: Option<NewWindowFeatures>,
) -> Result<WebviewWindow, String> {
    if !allowed_navigation(&url, &origins)
        || !app
            .state::<NativeSession>()
            .page_generation_matches(generation)
    {
        return Err("PLATFORM_NATIVE_PAGE_INVALID".into());
    }
    let title = url.origin().ascii_serialization();
    // For a native popup the webview engine performs the requested navigation.
    // Start blank to avoid loading the same native request twice. Tauri's
    // window_features retains the opener's native webview environment.
    let initial = if features.is_some() {
        url::Url::parse("about:blank").map_err(|_| "PLATFORM_NATIVE_PAGE_INVALID")?
    } else {
        url
    };
    let mut builder =
        WebviewWindowBuilder::new(app, label, WebviewUrl::External(initial)).title(title);
    if let Some(features) = features {
        builder = builder.window_features(features);
    }
    let navigation_app = app.clone();
    let navigation_origins = Arc::clone(&origins);
    let popup_app = app.clone();
    let opened = builder
        .on_navigation(move |next| {
            allowed_navigation(next, &navigation_origins)
                && navigation_app
                    .state::<NativeSession>()
                    .page_generation_matches(generation)
        })
        .on_new_window(move |next, features| {
            match open_window(
                &popup_app,
                format!("{PREFIX}{}", Uuid::new_v4()),
                next,
                Arc::clone(&origins),
                generation,
                Some(features),
            ) {
                Ok(window) => NewWindowResponse::Create { window },
                Err(_) => NewWindowResponse::Deny,
            }
        })
        .build()
        .map_err(|_| "PLATFORM_NATIVE_PAGE_OPEN_FAILED")?;
    // Apply the same sign-out race check to both the entry and every child.
    if !app
        .state::<NativeSession>()
        .page_generation_matches(generation)
    {
        opened
            .destroy()
            .map_err(|_| "PLATFORM_NATIVE_PAGE_CLOSE_FAILED")?;
        return Err("PLATFORM_NATIVE_PAGE_SESSION_CHANGED".into());
    }
    Ok(opened)
}

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
    if !allowed_navigation(&url, &allowed)
        || url.origin().ascii_serialization() != origin
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
    open_window(&app, label, url, Arc::new(allowed), generation, None)?;
    Ok(())
}
