use std::{collections::VecDeque, sync::Mutex};

use serde::Serialize;
use tauri::{Emitter, Manager, State};
use url::Url;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingNavigationDeepLink {
    id: String,
    kind: String,
    channel_id: String,
    message_id: Option<String>,
    thread_root_id: Option<String>,
}

#[derive(Default)]
pub(crate) struct PendingNavigationDeepLinks(Mutex<VecDeque<PendingNavigationDeepLink>>);

impl PendingNavigationDeepLinks {
    fn lock(&self) -> std::sync::MutexGuard<'_, VecDeque<PendingNavigationDeepLink>> {
        self.0.lock().unwrap_or_else(|poisoned| {
            eprintln!("buzz-desktop: recovering poisoned pending navigation deep-link queue");
            poisoned.into_inner()
        })
    }

    fn enqueue(&self, pending: PendingNavigationDeepLink) {
        let mut queue = self.lock();
        if queue.iter().any(|item| {
            item.kind == pending.kind
                && item.channel_id == pending.channel_id
                && item.message_id == pending.message_id
                && item.thread_root_id == pending.thread_root_id
        }) {
            return;
        }
        queue.push_back(pending);
    }

    fn clear(&self) {
        self.lock().clear();
    }

    fn first(&self) -> Option<PendingNavigationDeepLink> {
        self.lock().front().cloned()
    }

    fn acknowledge(&self, id: &str) -> bool {
        let mut queue = self.lock();
        if queue.front().is_some_and(|item| item.id == id) {
            queue.pop_front();
            true
        } else {
            false
        }
    }
}

#[tauri::command]
pub(crate) fn clear_pending_navigation_deep_links(pending: State<'_, PendingNavigationDeepLinks>) {
    pending.clear();
}

#[tauri::command]
pub(crate) fn take_pending_navigation_deep_link(
    pending: State<'_, PendingNavigationDeepLinks>,
) -> Option<PendingNavigationDeepLink> {
    pending.first()
}

#[tauri::command]
pub(crate) fn acknowledge_pending_navigation_deep_link(
    id: String,
    pending: State<'_, PendingNavigationDeepLinks>,
) -> bool {
    pending.acknowledge(&id)
}

fn queue_navigation_deep_link(app: &tauri::AppHandle, kind: &str, payload: &serde_json::Value) {
    let Some(channel_id) = payload["channelId"].as_str() else {
        return;
    };
    app.state::<PendingNavigationDeepLinks>()
        .enqueue(PendingNavigationDeepLink {
            id: uuid::Uuid::new_v4().to_string(),
            kind: kind.to_owned(),
            channel_id: channel_id.to_owned(),
            message_id: payload["messageId"].as_str().map(str::to_owned),
            thread_root_id: payload["threadRootId"].as_str().map(str::to_owned),
        });
}

fn activate_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if let Err(error) = window.unminimize() {
        eprintln!("buzz-desktop: failed to unminimize main window for deep link: {error}");
    }
    if let Err(error) = window.show() {
        eprintln!("buzz-desktop: failed to show main window for deep link: {error}");
    }
    if let Err(error) = window.set_focus() {
        eprintln!("buzz-desktop: failed to focus main window for deep link: {error}");
    }
}

fn parse_channel_deep_link(url: &Url) -> Option<serde_json::Value> {
    if url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    let mut segments = url.path_segments()?;
    let channel_id = segments.next()?;
    let message_id = segments.next();
    if segments.next().is_some() {
        return None;
    }
    let channel_id = uuid::Uuid::parse_str(channel_id).ok()?.to_string();
    if message_id.is_some_and(|value| {
        value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit())
    }) {
        return None;
    }
    Some(match message_id {
        Some(message_id) => serde_json::json!({
            "channelId": channel_id,
            "messageId": message_id.to_ascii_lowercase(),
        }),
        None => serde_json::json!({ "channelId": channel_id }),
    })
}

#[cfg(desktop)]
pub(crate) fn install_deep_link_handlers(app: &mut tauri::App) {
    use tauri_plugin_deep_link::DeepLinkExt;

    let dl_handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            handle_deep_link_url(&dl_handle, url.as_str());
        }
    });

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    match app.deep_link().get_current() {
        Ok(Some(urls)) => {
            for url in urls {
                handle_deep_link_url(app.handle(), url.as_str());
            }
        }
        Ok(None) => {}
        Err(error) => eprintln!("buzz-desktop: failed to read launch deep link: {error}"),
    }
}

/// Parse the query string of a `buzz://message?…` URL into the JSON
/// payload emitted on `deep-link-message`. Returns `None` when a required
/// param (`channel`, `id`) is missing or empty, so the frontend never sees a half-formed
/// payload (e.g. `channelId: ""` from `channel=&id=foo`).
///
/// Pulled out of `handle_deep_link_url` so it can be unit-tested without
/// a live `tauri::AppHandle`.
fn parse_message_deep_link(url: &Url) -> Option<serde_json::Value> {
    let mut channel: Option<String> = None;
    let mut message_id: Option<String> = None;
    let mut thread: Option<String> = None;
    for (k, v) in url.query_pairs() {
        let v = v.into_owned();
        if v.is_empty() {
            continue;
        }
        match k.as_ref() {
            "channel" => channel = Some(v),
            "id" => message_id = Some(v),
            "thread" => thread = Some(v),
            _ => {}
        }
    }
    let (channel_id, message_id) = (channel?, message_id?);
    Some(serde_json::json!({
        "channelId": channel_id,
        "messageId": message_id,
        "threadRootId": thread,
    }))
}

/// Handle an incoming `buzz://` deep link URL.
///
/// Supports only in-app navigation: the community is the one Kailo resolved
/// for this sign-in, so there are no connect/add-community links.
/// - `buzz://channel?…` / `buzz://message?…` — emit `deep-link-channel` / `deep-link-message`
pub(crate) fn handle_deep_link_url(app: &tauri::AppHandle, url_str: &str) {
    let url = match Url::parse(url_str) {
        Ok(u) => u,
        Err(e) => {
            eprintln!("buzz-desktop: invalid deep link URL {url_str:?}: {e}");
            return;
        }
    };

    if url.scheme() != crate::build_identity::deep_link_scheme() {
        eprintln!("buzz-desktop: ignoring unsupported deep link scheme: {url_str}");
        return;
    }

    match url.host_str() {
        Some("channel") => {
            let Some(payload) = parse_channel_deep_link(&url) else {
                eprintln!("buzz-desktop: channel deep link missing/invalid channel: {url_str}");
                return;
            };
            activate_main_window(app);
            if payload["messageId"].is_string() {
                queue_navigation_deep_link(app, "message", &payload);
                let _ = app.emit("deep-link-message", payload);
            } else {
                queue_navigation_deep_link(app, "channel", &payload);
                let _ = app.emit("deep-link-channel", payload);
            }
        }
        Some("message") => {
            // `buzz://message?channel=<uuid>&id=<eventId>[&thread=<rootId>]`
            //
            // Parse what we need, refuse to emit anything if a required param is missing
            // so the frontend never sees a half-formed payload. The
            // frontend listener mirrors `parseMessageLink` in TS — we keep
            // structure on this side (serde JSON) and let the TS code own
            // any further normalisation.
            let Some(payload) = parse_message_deep_link(&url) else {
                eprintln!("buzz-desktop: message deep link missing channel or id: {url_str}");
                return;
            };
            activate_main_window(app);
            queue_navigation_deep_link(app, "message", &payload);
            let _ = app.emit("deep-link-message", payload);
        }
        Some(action) => {
            eprintln!("buzz-desktop: unknown deep link action: {action}");
        }
        None => {
            eprintln!("buzz-desktop: deep link missing action: {url_str}");
        }
    }
}

#[cfg(test)]
#[path = "deep_link_tests.rs"]
mod tests;
