//! Authentication-only service window. Business UI remains in the main frame.
//!
//! DD-133(2)(6), `.design/07` §4.7.5 "Desktop": the Desktop signs in through the
//! system browser (RFC 8252), so the IdP session that component iframes use for
//! silent `prompt=none` sign-in exists only in the app WebView, created here.
//! This window signs the Desktop's own public client in inside that WebView
//! (PKCE, intercepted loopback redirect) and keeps only the ID token as the
//! sign-out hint; sign-out later ends that session with RP-initiated logout in
//! an invisible window ([`WindowLogoutBrowser`]) so the IdP delivers
//! back-channel logout to every component client in it.
use reqwest::Method;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use uuid::Uuid;

use super::config::PlatformConfig;
use super::oidc::{self, LogoutNavigation};
use super::{
    api::{LogoutBrowser, NativeSession},
    commands::require_config,
};
use crate::app_state::AppState;

const PREFIX: &str = "platform-native-auth-";
const SIGN_OUT_PREFIX: &str = "platform-native-signout-";
/// How long sign-out waits for the IdP to reach the intercepted post-logout
/// redirect. With a valid `id_token_hint` matching the WebView session the IdP
/// answers with one redirect; a confirmation page never progresses in an
/// invisible window. Fifteen seconds covers a slow IdP round trip without
/// holding the user's sign-out open indefinitely; on expiry the result is
/// reported as unconfirmed, never as ended.
const SIGN_OUT_CONFIRM_TIMEOUT: Duration = Duration::from_secs(15);

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

    // The capability manifest grants IPC to `main` only, never this window.
    // The entry is selected by fresh BFF admission, not by a caller's URL; the
    // window itself only signs the Desktop native client in at the IdP.
    let issuer = url::Url::parse(&cfg.oidc_issuer).map_err(|_| "PLATFORM_NATIVE_PAGE_INVALID")?;
    let issuer_origin = issuer.origin().ascii_serialization();
    let authorization = Arc::new(
        oidc::embedded_authorization(&state.http_client, &cfg)
            .await
            .map_err(|_| "PLATFORM_NATIVE_PAGE_IDP_UNAVAILABLE")?,
    );
    if !allowed_navigation(&authorization.url, std::slice::from_ref(&issuer_origin))
        || !session.page_generation_matches(generation)
    {
        return Err("PLATFORM_NATIVE_PAGE_INVALID".into());
    }
    let label = format!("{PREFIX}{id}");
    if app.get_webview_window(&label).is_some() {
        return Err("PLATFORM_NATIVE_PAGE_AUTHENTICATION_IN_PROGRESS".into());
    }
    let (called_back, receive_callback) = tokio::sync::oneshot::channel();
    let called_back = Mutex::new(Some(called_back));
    let navigation_app = app.clone();
    let navigation_authorization = authorization.clone();
    let allowed = [issuer_origin];
    let auth = WebviewWindowBuilder::new(
        &app,
        label.clone(),
        WebviewUrl::External(authorization.url.clone()),
    )
    .title(origin)
    .on_navigation(move |next| {
        // The loopback redirect is intercepted, never loaded or listened on.
        if let Some(result) = navigation_authorization.callback(next) {
            if let Ok(mut sender) = called_back.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(result);
                }
            }
            return false;
        }
        allowed_navigation(next, &allowed)
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
    let callback = if app.get_webview_window(&label).is_some() {
        tokio::select! {
            result = receive_callback => result.ok(),
            _ = receive_close => None,
        }
    } else {
        None
    };
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.destroy();
    }
    if !session.page_generation_matches(generation) {
        return Err("PLATFORM_NATIVE_PAGE_SESSION_CHANGED".into());
    }
    // Completion still means only that the window closed; a callback
    // additionally leaves the WebView IdP session's sign-out hint.
    if let Some(result) = callback {
        let code = result?;
        let id_token = authorization
            .exchange(&state.http_client, &cfg, &code)
            .await
            .map_err(|_| "PLATFORM_NATIVE_PAGE_SIGN_IN_FAILED")?;
        session.store_embedded_hint(generation, &id_token)?;
    }
    Ok(())
}

/// The invisible, non-interactive window that ends the WebView IdP session at
/// sign-out (`.design/07` §4.7.5 "Desktop"). Only the intercepted
/// post-logout redirect confirms; any other origin, an IdP confirmation page
/// that never progresses, or the timeout is reported as unconfirmed.
pub(crate) struct WindowLogoutBrowser {
    app: AppHandle,
    issuer_origin: Option<url::Origin>,
}

impl WindowLogoutBrowser {
    pub(crate) fn new(app: &AppHandle, cfg: &PlatformConfig) -> Self {
        Self {
            app: app.clone(),
            issuer_origin: url::Url::parse(&cfg.oidc_issuer).ok().map(|u| u.origin()),
        }
    }

    async fn run(&self, url: url::Url) -> bool {
        let Some(issuer_origin) = self.issuer_origin.clone() else {
            return false;
        };
        if oidc::logout_navigation(&url, &issuer_origin) != LogoutNavigation::Continue {
            return false;
        }
        let (decided, receive) = tokio::sync::oneshot::channel();
        let decided = Mutex::new(Some(decided));
        let label = format!("{SIGN_OUT_PREFIX}{}", Uuid::new_v4());
        let built = WebviewWindowBuilder::new(&self.app, label.clone(), WebviewUrl::External(url))
            .visible(false)
            .focused(false)
            .skip_taskbar(true)
            .on_navigation(move |next| {
                let verdict = oidc::logout_navigation(next, &issuer_origin);
                if verdict == LogoutNavigation::Continue {
                    return true;
                }
                if let Ok(mut sender) = decided.lock() {
                    if let Some(sender) = sender.take() {
                        let _ = sender.send(verdict == LogoutNavigation::Confirmed);
                    }
                }
                false
            })
            .on_new_window(|_, _| NewWindowResponse::Deny)
            .build();
        if built.is_err() {
            return false;
        }
        let confirmed = tokio::time::timeout(SIGN_OUT_CONFIRM_TIMEOUT, receive)
            .await
            .ok()
            .and_then(Result::ok)
            .unwrap_or(false);
        if let Some(window) = self.app.get_webview_window(&label) {
            let _ = window.destroy();
        }
        confirmed
    }
}

impl LogoutBrowser for WindowLogoutBrowser {
    fn end_session<'a>(&'a self, url: url::Url) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(self.run(url))
    }
}
