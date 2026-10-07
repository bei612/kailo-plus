//! Authentication-only service window. Business UI remains in the main frame.
use reqwest::Method;
use std::sync::{Arc, Mutex};
use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use uuid::Uuid;

use super::{api::NativeSession, commands::require_config};
use crate::app_state::AppState;

const PREFIX: &str = "platform-native-auth-";

fn allowed_navigation(url: &url::Url, origins: &[String]) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
        && origins.contains(&url.origin().ascii_serialization())
}

pub(crate) fn close_all(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with(PREFIX) {
            let _ = window.destroy();
        }
    }
}

/// Completion means only that the authentication window closed, not SSO success.
#[tauri::command]
pub(crate) async fn platform_authenticate_native_page(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    session: State<'_, NativeSession>,
    binding_id: String,
) -> Result<(), String> {
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
    let target = url::Url::parse(page["url"].as_str().ok_or("PLATFORM_NATIVE_PAGE_INVALID")?)
        .map_err(|_| "PLATFORM_NATIVE_PAGE_INVALID")?;
    let origin = page["origin"]
        .as_str()
        .ok_or("PLATFORM_NATIVE_PAGE_INVALID")?;
    let platform_origin = cfg
        .api_url("/api/v1/session")?
        .origin()
        .ascii_serialization();
    let origins = page["allowedOrigins"]
        .as_array()
        .ok_or("PLATFORM_NATIVE_PAGE_INVALID")?
        .iter()
        .map(|item| {
            let value = item.as_str().ok_or("PLATFORM_NATIVE_PAGE_INVALID")?;
            let parsed = url::Url::parse(value).map_err(|_| "PLATFORM_NATIVE_PAGE_INVALID")?;
            if !matches!(parsed.scheme(), "http" | "https")
                || parsed.origin().ascii_serialization() != value
                || value == platform_origin
            {
                return Err("PLATFORM_NATIVE_PAGE_INVALID");
            }
            Ok(value.to_owned())
        })
        .collect::<Result<Vec<_>, &str>>()?;
    if !allowed_navigation(&target, &origins)
        || target.origin().ascii_serialization() != origin
        || !session.page_generation_matches(generation)
    {
        return Err("PLATFORM_NATIVE_PAGE_INVALID".into());
    }

    // The capability manifest grants IPC to `main` only, never this remote page.
    // The entry is selected by fresh BFF admission, not by a caller's URL.
    let navigation_app = app.clone();
    // Authentication uses the existing native OIDC deployment authority. Do
    // not add its origin to the business-page descriptor or iframe allowlist.
    let issuer = url::Url::parse(&cfg.oidc_issuer).map_err(|_| "PLATFORM_NATIVE_PAGE_INVALID")?;
    let mut authentication_origins = origins;
    let issuer_origin = issuer.origin().ascii_serialization();
    if !authentication_origins.contains(&issuer_origin) {
        authentication_origins.push(issuer_origin);
    }
    let origins = Arc::new(authentication_origins);
    let label = format!("{PREFIX}{id}");
    if app.get_webview_window(&label).is_some() {
        return Err("PLATFORM_NATIVE_PAGE_AUTHENTICATION_IN_PROGRESS".into());
    }
    let auth = WebviewWindowBuilder::new(&app, label.clone(), WebviewUrl::External(target))
        .title(origin)
        .on_navigation(move |next| {
            allowed_navigation(next, &origins)
                && navigation_app
                    .state::<NativeSession>()
                    .page_generation_matches(generation)
        })
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build()
        .map_err(|_| "PLATFORM_NATIVE_PAGE_OPEN_FAILED")?;
    let (closed, receive_close) = tokio::sync::oneshot::channel();
    let closed = Mutex::new(Some(closed));
    auth.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            if let Ok(mut sender) = closed.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(());
                }
            }
        }
    });
    if !session.page_generation_matches(generation) {
        auth.destroy()
            .map_err(|_| "PLATFORM_NATIVE_PAGE_CLOSE_FAILED")?;
        return Err("PLATFORM_NATIVE_PAGE_SESSION_CHANGED".into());
    }
    // A user can close the window between build and listener registration.
    if app.get_webview_window(&label).is_some() {
        receive_close
            .await
            .map_err(|_| "PLATFORM_NATIVE_PAGE_CLOSE_FAILED")?;
    }
    if !session.page_generation_matches(generation) {
        return Err("PLATFORM_NATIVE_PAGE_SESSION_CHANGED".into());
    }
    Ok(())
}
