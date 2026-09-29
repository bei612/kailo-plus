#![recursion_limit = "256"] // Deep Tauri command futures exceed the default layout query depth.
mod app_menu;
mod app_state;
mod build_identity;
mod channel_head_cache;
mod commands;
mod deep_link;
mod egress_guard;
mod events;
mod identity_storage;
mod initial_window;
mod platform;
mod link_preview_tags;
mod linux_media;
#[cfg(target_os = "macos")]
mod macos_notifications;
#[cfg(target_os = "macos")]
mod main_window;
mod media_proxy;
#[cfg(test)]
mod model_tests;
mod models;
#[cfg(target_os = "macos")]
mod mouse_nav;
mod native_relay_client;
mod native_websocket;
mod native_websocket_batch;
mod nostr_convert;
mod observed_unread;
mod relay;
mod relay_admission;
mod secret_store;
mod shutdown;
mod unread_catch_up;
mod util;
#[cfg(target_os = "linux")]
pub mod webkit_rendering;
use app_state::{build_app_state, resolve_persisted_identity, AppState};
use commands::*;
use deep_link::{
    acknowledge_pending_navigation_deep_link, clear_pending_navigation_deep_links,
    handle_deep_link_url, take_pending_navigation_deep_link, PendingNavigationDeepLinks,
};
use initial_window::*;
#[cfg(target_os = "macos")]
use main_window::show_main_window;
use shutdown::shut_down_app;
use std::sync::atomic::AtomicBool;
#[cfg(target_os = "macos")]
use tauri::Listener;
#[cfg(target_os = "macos")]
use tauri::WindowEvent;
use tauri::{Manager, RunEvent};
use tauri_plugin_window_state::StateFlags;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Focus the existing window when a duplicate instance launches.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
            // Forward any deep link URLs from the duplicate launch.
            for arg in &argv {
                if crate::build_identity::is_deep_link_for_build(arg) {
                    handle_deep_link_url(app, arg);
                }
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // Visibility is excluded: the native reveal plugin below
                // shows the window after saved geometry has been restored.
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(
            tauri::plugin::Builder::<_, ()>::new("initial-window-reveal")
                .on_webview_ready(|webview| {
                    if webview.label() != "main" {
                        return;
                    }
                    // Linux/WebKitGTK needs media-stream settings and a
                    // permission-request handler for getUserMedia; no-op
                    // on macOS/Windows.
                    linux_media::enable_media_capture(&webview);

                    // macOS applies the restored geometry asynchronously. Wait
                    // for several identical outer bounds and for React to
                    // commit the startup surface before revealing it.
                    let window = webview.window();

                    #[cfg(target_os = "macos")]
                    {
                        set_initial_window_backing(&window);

                        let (initial_render_tx, initial_render_rx) = tokio::sync::oneshot::channel();
                        window
                            .app_handle()
                            .once(INITIAL_RENDER_READY_EVENT, move |_| {
                                let _ = initial_render_tx.send(());
                            });

                        tauri::async_runtime::spawn(async move {
                            wait_for_stable_initial_window_geometry(&window).await;

                            if tokio::time::timeout(
                                std::time::Duration::from_secs(5),
                                initial_render_rx,
                            )
                            .await
                            .is_err()
                            {
                                eprintln!(
                                    "buzz-desktop: initial render did not commit before reveal timeout"
                                );
                            }

                            reveal_initial_window(&window);
                            clear_initial_window_backing(&window).await;
                        });
                    }

                    #[cfg(not(target_os = "macos"))]
                    {
                        reveal_initial_window(&window);
                    }
                })
                .build(),
        )
        .plugin(native_websocket::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init());

    let app = app_menu::install(builder)
        .register_asynchronous_uri_scheme_protocol("buzz-media", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                let response = media_proxy::handle_buzz_media(&app, &request).await;
                responder.respond(response);
            });
        })
        .manage(build_app_state())
        .manage(platform::api::KailoSession::default())
        .manage(ClipboardState::new())
        .manage(PendingNavigationDeepLinks::default())
        .manage(observed_unread::ObservedUnreadStore::default())
        .manage(channel_head_cache::ChannelHeadCacheStore::default())
        .setup(move |app| {
            let app_handle = app.handle().clone();
            #[cfg(target_os = "macos")]
            {
                macos_notifications::init(&app_handle)?;
                mouse_nav::init(&app_handle);
            }

            // Resolve persisted identity key (env var → keyring → file →
            // generate+save). Fatal: an ephemeral identity would be lost on
            // restart and silently break channel memberships.
            let state = app_handle.state::<AppState>();
            if let Err(e) = resolve_persisted_identity(&app_handle, &state) {
                eprintln!("buzz-desktop: fatal: identity resolution failed: {e}");
                std::process::exit(1);
            }

            // Start the localhost media streaming proxy. The port is stored in
            // AppState and exposed to the frontend via `get_media_proxy_port`.
            let proxy_client = state.http_client.clone();
            let proxy_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let port = media_proxy::spawn_media_proxy(proxy_client, proxy_handle.clone()).await;
                let state = proxy_handle.state::<AppState>();
                state
                    .media_proxy_port
                    .store(port, std::sync::atomic::Ordering::Relaxed);
            });

            // Handle deep link URLs received while the app is running (macOS)
            // and on cold start. The single-instance plugin handles forwarding
            // from duplicate launches on Windows/Linux.
            #[cfg(desktop)]
            deep_link::install_deep_link_handlers(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform::commands::kailo_get_config,
            platform::commands::kailo_set_config,
            platform::commands::kailo_status,
            platform::commands::kailo_sign_in,
            platform::commands::kailo_cancel_sign_in,
            platform::commands::kailo_sign_out,
            platform::commands::kailo_api,
            platform::commands::kailo_register_device,
            acknowledge_pending_navigation_deep_link,
            apply_workspace,
            cancel_link_preview_metadata,
            cancel_media_fetch,
            cancel_media_upload,
            channel_head_cache::channel_head_cache_load,
            channel_head_cache::channel_head_cache_store,
            clear_pending_navigation_deep_links,
            copy_image_to_clipboard,
            copy_text_to_clipboard,
            create_auth_event,
            download_file,
            download_image,
            fetch_link_preview_metadata,
            fetch_media_bytes,
            get_channel_details,
            get_channel_members,
            get_channel_reconnect_repair,
            get_channel_window,
            get_channels,
            get_event,
            get_events,
            get_feed,
            get_identity,
            get_media_proxy_port,
            get_profile,
            get_relay_http_url,
            get_relay_self,
            get_relay_ws_url,
            get_thread_replies,
            get_user_profile,
            get_users_batch,
            #[cfg(target_os = "macos")]
            macos_notifications::notification_permission_state,
            observed_unread::observed_unread_ingest,
            observed_unread::observed_unread_open_scope,
            perform_sidebar_default_haptic,
            persist_current_identity,
            pick_and_upload_media,
            read_clipboard_text,
            relay_reconnect_hook,
            relay_reconnect_hook_configured,
            release_link_preview_metadata,
            release_media_fetch,
            release_media_upload,
            #[cfg(target_os = "macos")]
            macos_notifications::request_notification_access,
            search_messages,
            search_users,
            send_channel_message,
            set_window_vibrancy,
            show_native_notification,
            sign_event,
            #[cfg(target_os = "macos")]
            macos_notifications::take_pending_activations,
            take_pending_navigation_deep_link,
            title_bar_double_click,
            unread_catch_up::unread_catch_up,
            upload_media_bytes,
            upload_media_bytes_raw,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    let shutdown_done = AtomicBool::new(false);
    app.run(move |app_handle, event| match event {
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main_window(app_handle),
        #[cfg(target_os = "macos")]
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            // Keep the webview alive so Buzz can be reopened from the Dock.
            api.prevent_close();
            if let Some(window) = app_handle.get_webview_window("main") {
                if let Err(error) = window.hide() {
                    eprintln!("buzz-desktop: failed to hide main window: {error}");
                }
            }
        }
        RunEvent::ExitRequested { .. } => {
            shut_down_app(app_handle, &shutdown_done);
        }
        RunEvent::Exit => {
            shut_down_app(app_handle, &shutdown_done);
            app_handle.state::<ClipboardState>().release();
        }
        _ => {}
    });
}
