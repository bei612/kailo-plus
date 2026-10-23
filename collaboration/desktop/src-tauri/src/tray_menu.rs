//! Native system-tray menu for the desktop app (macOS).
//!
//! Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src-tauri/src/tray_menu.rs.
//! DD-125(5): the webview owns the admitted Agent activity (the same projection as the
//! channel activity bar) and sends a small display projection here so the menu stays
//! useful while the window is hidden. Menu actions only navigate or open the existing
//! New Channel dialog; nothing here writes. Labels are localized by the webview and the
//! product name is the deployment's display name (DD-111), so the source holds only
//! neutral fallback labels for the moments before the webview has pushed its own.
//! Differences from the original: the tray icon is the app's own window icon instead of
//! the Buzz bee, and the debug-only demo preview is not carried over.

use std::sync::{Mutex, OnceLock};

use objc2::MainThreadMarker;
use objc2_foundation::{NSProcessInfo, NSString};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Emitter, Manager, Runtime,
};

use crate::main_window::show_main_window;

const TRAY_ID: &str = "main-tray";
const OPEN_APP_ID: &str = "tray-open-app";
const NEW_CHANNEL_ID: &str = "tray-new-channel";
const QUIT_ID: &str = "tray-quit";
const OPEN_CHANNEL_PREFIX: &str = "tray-open-channel:";
const OPEN_CHANNEL_ACTIVITY_SEPARATOR: char = '|';
const TRAY_MENU_MINIMUM_WIDTH: f64 = 320.0;
const MAX_LABEL_CHARS: usize = 120;

/// A running agent and its current channel.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayAgentActivity {
    activity_id: String,
    agent_name: String,
    channel_id: String,
    channel_name: String,
    elapsed: String,
}

/// The menu's fixed labels, localized by the webview.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrayMenuLabels {
    running: String,
    no_agents: String,
    recent: String,
    new_channel: String,
    open_app: String,
    quit_app: String,
}

impl Default for TrayMenuLabels {
    fn default() -> Self {
        Self {
            running: "Running".into(),
            no_agents: "No agents are running".into(),
            recent: "Recent".into(),
            new_channel: "New Channel".into(),
            open_app: "Open".into(),
            quit_app: "Quit".into(),
        }
    }
}

impl TrayMenuLabels {
    /// Every label must be non-blank and short; otherwise the update is refused.
    fn validated(self) -> Result<Self, String> {
        for label in [
            &self.running,
            &self.no_agents,
            &self.recent,
            &self.new_channel,
            &self.open_app,
            &self.quit_app,
        ] {
            if label.trim().is_empty() || label.chars().count() > MAX_LABEL_CHARS {
                return Err("Tray menu labels are invalid".into());
            }
        }
        Ok(self)
    }
}

struct TrayActivityMenuItem<R: Runtime> {
    activity_id: String,
    channel_id: String,
    agent_item: MenuItem<R>,
}

struct TrayActionQueue {
    community_generation: u64,
    pending_actions: Vec<TrayAction>,
}

struct TrayMenuContent {
    labels: TrayMenuLabels,
    activities: Vec<TrayAgentActivity>,
    recent_activities: Vec<TrayAgentActivity>,
}

struct TrayMenuState<R: Runtime> {
    activity_items: Mutex<Vec<TrayActivityMenuItem<R>>>,
    content: Mutex<TrayMenuContent>,
    action_queue: Mutex<TrayActionQueue>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum TrayAction {
    NewChannel,
    OpenChannel {
        #[serde(rename = "channelId")]
        channel_id: String,
        #[serde(rename = "communityGeneration")]
        community_generation: u64,
    },
}

fn queue_tray_action<R: Runtime>(app: &AppHandle<R>, mut action: TrayAction) {
    let state = app.state::<TrayMenuState<R>>();
    let Ok(mut queue) = state.action_queue.lock() else {
        eprintln!("buzz-desktop: tray action queue is unavailable");
        return;
    };
    if let TrayAction::OpenChannel {
        community_generation,
        ..
    } = &mut action
    {
        *community_generation = queue.community_generation;
    }
    queue.pending_actions.push(action);
    drop(queue);

    if let Err(error) = app.emit("tray-action-available", ()) {
        eprintln!("buzz-desktop: failed to notify frontend of tray action: {error}");
    }
}

fn append_separator<R: Runtime>(app: &AppHandle<R>, menu: &Menu<R>) -> tauri::Result<()> {
    menu.append(&PredefinedMenuItem::separator(app)?)
}

fn agent_item_label(activity: &TrayAgentActivity) -> String {
    let primary = format!("{} · {}", activity.agent_name, activity.elapsed);
    if supports_menu_item_subtitles() {
        primary
    } else {
        format!("{primary} — #{}", activity.channel_name)
    }
}

fn supports_menu_item_subtitles() -> bool {
    static SUPPORTS_SUBTITLES: OnceLock<bool> = OnceLock::new();
    *SUPPORTS_SUBTITLES.get_or_init(|| {
        NSProcessInfo::processInfo()
            .operatingSystemVersion()
            .majorVersion
            >= 14
    })
}

fn channel_item_id(activity: &TrayAgentActivity) -> String {
    format!(
        "{OPEN_CHANNEL_PREFIX}{}{OPEN_CHANNEL_ACTIVITY_SEPARATOR}{}",
        activity.channel_id, activity.activity_id
    )
}

fn build_menu<R: Runtime>(
    app: &AppHandle<R>,
    content: &TrayMenuContent,
) -> tauri::Result<(Menu<R>, Vec<TrayActivityMenuItem<R>>)> {
    let labels = &content.labels;
    let menu = Menu::new(app)?;
    let mut activity_items = Vec::with_capacity(
        content
            .activities
            .len()
            .saturating_add(content.recent_activities.len()),
    );

    let running = MenuItem::new(app, &labels.running, false, None::<&str>)?;
    menu.append(&running)?;

    if content.activities.is_empty() {
        let empty = MenuItem::new(app, &labels.no_agents, false, None::<&str>)?;
        menu.append(&empty)?;
    } else {
        append_activity_items(app, &menu, &content.activities, &mut activity_items)?;
    }

    if !content.recent_activities.is_empty() {
        append_separator(app, &menu)?;
        let recent = MenuItem::new(app, &labels.recent, false, None::<&str>)?;
        menu.append(&recent)?;
        append_activity_items(app, &menu, &content.recent_activities, &mut activity_items)?;
    }

    append_separator(app, &menu)?;
    menu.append(&MenuItem::with_id(
        app,
        NEW_CHANNEL_ID,
        &labels.new_channel,
        true,
        None::<&str>,
    )?)?;
    append_separator(app, &menu)?;
    menu.append(&MenuItem::with_id(
        app,
        OPEN_APP_ID,
        &labels.open_app,
        true,
        None::<&str>,
    )?)?;
    append_separator(app, &menu)?;
    menu.append(&MenuItem::with_id(
        app,
        QUIT_ID,
        &labels.quit_app,
        true,
        None::<&str>,
    )?)?;

    Ok((menu, activity_items))
}

fn append_activity_items<R: Runtime>(
    app: &AppHandle<R>,
    menu: &Menu<R>,
    activities: &[TrayAgentActivity],
    activity_items: &mut Vec<TrayActivityMenuItem<R>>,
) -> tauri::Result<()> {
    for activity in activities {
        let agent_item = MenuItem::with_id(
            app,
            channel_item_id(activity),
            agent_item_label(activity),
            true,
            None::<&str>,
        )?;
        menu.append(&agent_item)?;
        activity_items.push(TrayActivityMenuItem {
            activity_id: activity.activity_id.clone(),
            channel_id: activity.channel_id.clone(),
            agent_item,
        });
    }

    Ok(())
}

fn apply_activity_presentation<R: Runtime>(
    tray: &TrayIcon<R>,
    activities: &[TrayAgentActivity],
    recent_activities: &[TrayAgentActivity],
) -> Result<(), String> {
    if !supports_menu_item_subtitles() {
        return Ok(());
    }

    let subtitles = activities
        .iter()
        .chain(recent_activities)
        .map(|activity| format!("#{}", activity.channel_name))
        .collect::<Vec<_>>();
    let running_count = activities.len();
    let recent_count = recent_activities.len();

    tray.with_inner_tray_icon(move |inner| {
        let Some(status_item) = inner.ns_status_item() else {
            return;
        };
        let Some(main_thread) = MainThreadMarker::new() else {
            return;
        };
        let Some(menu) = status_item.menu(main_thread) else {
            return;
        };
        menu.setMinimumWidth(TRAY_MENU_MINIMUM_WIDTH);

        let mut item_index = 1;
        for subtitle in subtitles.iter().take(running_count) {
            if let Some(item) = menu.itemAtIndex(item_index) {
                let subtitle = NSString::from_str(subtitle);
                item.setSubtitle(Some(&subtitle));
            }
            item_index += 1;
        }

        if running_count == 0 {
            item_index += 1;
        }

        if recent_count > 0 {
            // The separator and Recent heading precede the completed rows.
            item_index += 2;
            for subtitle in subtitles.iter().skip(running_count) {
                if let Some(item) = menu.itemAtIndex(item_index) {
                    let subtitle = NSString::from_str(subtitle);
                    item.setSubtitle(Some(&subtitle));
                }
                item_index += 1;
            }
        }
    })
    .map_err(|error| error.to_string())
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        OPEN_APP_ID => show_main_window(app),
        NEW_CHANNEL_ID => {
            show_main_window(app);
            queue_tray_action(app, TrayAction::NewChannel);
        }
        QUIT_ID => app.exit(0),
        _ => {
            let Some(channel_id) = id.strip_prefix(OPEN_CHANNEL_PREFIX) else {
                return;
            };
            show_main_window(app);
            let channel_id = channel_id
                .split_once(OPEN_CHANNEL_ACTIVITY_SEPARATOR)
                .map(|(channel_id, _)| channel_id)
                .unwrap_or(channel_id);
            queue_tray_action(
                app,
                TrayAction::OpenChannel {
                    channel_id: channel_id.into(),
                    community_generation: 0,
                },
            );
        }
    }
}

/// Installs the persistent tray icon with the initial empty activity menu.
pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let content = TrayMenuContent {
        labels: TrayMenuLabels::default(),
        activities: Vec::new(),
        recent_activities: Vec::new(),
    };
    let (menu, activity_items) = build_menu(app, &content)?;
    app.manage(TrayMenuState {
        activity_items: Mutex::new(activity_items),
        content: Mutex::new(content),
        action_queue: Mutex::new(TrayActionQueue {
            community_generation: 0,
            pending_actions: Vec::new(),
        }),
    });
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .on_menu_event(|app, event| handle_menu_event(app, event.id.as_ref()));
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Drains actions selected from the tray while the frontend was unavailable.
#[tauri::command]
pub fn take_tray_actions<R: Runtime>(app: AppHandle<R>) -> Result<Vec<TrayAction>, String> {
    let state = app.state::<TrayMenuState<R>>();
    let mut queue = state
        .action_queue
        .lock()
        .map_err(|_| "Tray action queue is unavailable".to_string())?;
    Ok(std::mem::take(&mut queue.pending_actions))
}

fn requeue_actions(queue: &mut TrayActionQueue, mut actions: Vec<TrayAction>) {
    actions.retain(|action| match action {
        TrayAction::NewChannel => true,
        TrayAction::OpenChannel {
            community_generation,
            ..
        } => *community_generation == queue.community_generation,
    });
    actions.append(&mut queue.pending_actions);
    queue.pending_actions = actions;
}

/// Restores actions that were drained as the frontend unmounted. Channel
/// actions from a previous session scope are discarded.
#[tauri::command]
pub fn requeue_tray_actions<R: Runtime>(
    app: AppHandle<R>,
    actions: Vec<TrayAction>,
) -> Result<(), String> {
    let state = app.state::<TrayMenuState<R>>();
    let mut queue = state
        .action_queue
        .lock()
        .map_err(|_| "Tray action queue is unavailable".to_string())?;
    requeue_actions(&mut queue, actions);
    drop(queue);
    app.emit("tray-action-available", ())
        .map_err(|error| error.to_string())
}

/// Clears session-scoped agent activity and queued channel navigation from
/// the native tray menu (the original community switch).
#[tauri::command]
pub fn clear_tray_agent_activity<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let state = app.state::<TrayMenuState<R>>();
    let mut queue = state
        .action_queue
        .lock()
        .map_err(|_| "Tray action queue is unavailable".to_string())?;
    queue.community_generation = queue.community_generation.wrapping_add(1);
    queue
        .pending_actions
        .retain(|action| matches!(action, TrayAction::NewChannel));
    drop(queue);

    update_tray_agent_activity(app, Vec::new(), Vec::new())
}

fn rebuild<R: Runtime>(app: &AppHandle<R>, state: &TrayMenuState<R>) -> Result<(), String> {
    let content = state
        .content
        .lock()
        .map_err(|_| "Tray menu state is unavailable".to_string())?;
    let mut activity_items = state
        .activity_items
        .lock()
        .map_err(|_| "Tray menu state is unavailable".to_string())?;
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "Tray icon is not available".to_string())?;
    let (menu, next_activity_items) =
        build_menu(app, &content).map_err(|error| error.to_string())?;
    tray.set_menu(Some(menu))
        .map_err(|error| error.to_string())?;
    apply_activity_presentation(&tray, &content.activities, &content.recent_activities)?;
    *activity_items = next_activity_items;
    Ok(())
}

/// Replaces the menu's fixed labels (locale or deployment display name changed).
#[tauri::command]
pub fn update_tray_menu_labels<R: Runtime>(
    app: AppHandle<R>,
    labels: TrayMenuLabels,
) -> Result<(), String> {
    let labels = labels.validated()?;
    let state = app.state::<TrayMenuState<R>>();
    {
        let mut content = state
            .content
            .lock()
            .map_err(|_| "Tray menu state is unavailable".to_string())?;
        if content.labels == labels {
            return Ok(());
        }
        content.labels = labels;
    }
    rebuild(&app, &state)
}

/// Replaces the native menu's activity section with the current live work.
#[tauri::command]
pub fn update_tray_agent_activity<R: Runtime>(
    app: AppHandle<R>,
    activities: Vec<TrayAgentActivity>,
    recent_activities: Vec<TrayAgentActivity>,
) -> Result<(), String> {
    let state = app.state::<TrayMenuState<R>>();
    {
        let mut content = state
            .content
            .lock()
            .map_err(|_| "Tray menu state is unavailable".to_string())?;
        let activity_items = state
            .activity_items
            .lock()
            .map_err(|_| "Tray menu state is unavailable".to_string())?;
        let same_rows = activity_items.len()
            == activities.len().saturating_add(recent_activities.len())
            && activity_items
                .iter()
                .zip(activities.iter().chain(&recent_activities))
                .all(|(item, activity)| {
                    item.activity_id == activity.activity_id
                        && item.channel_id == activity.channel_id
                });
        if same_rows {
            for (item, activity) in activity_items
                .iter()
                .zip(activities.iter().chain(&recent_activities))
            {
                item.agent_item
                    .set_text(agent_item_label(activity))
                    .map_err(|error| error.to_string())?;
            }
            let tray = app
                .tray_by_id(TRAY_ID)
                .ok_or_else(|| "Tray icon is not available".to_string())?;
            apply_activity_presentation(&tray, &activities, &recent_activities)?;
            content.activities = activities;
            content.recent_activities = recent_activities;
            return Ok(());
        }
        content.activities = activities;
        content.recent_activities = recent_activities;
    }
    rebuild(&app, &state)
}

#[cfg(test)]
mod tests {
    use super::{requeue_actions, TrayAction, TrayActionQueue, TrayMenuLabels};

    #[test]
    fn open_channel_action_serializes_with_frontend_field_names() {
        let action = TrayAction::OpenChannel {
            channel_id: "channel-123".into(),
            community_generation: 7,
        };

        assert_eq!(
            serde_json::to_value(action).expect("tray action should serialize"),
            serde_json::json!({
                "kind": "openChannel",
                "channelId": "channel-123",
                "communityGeneration": 7,
            })
        );
    }

    #[test]
    fn stale_channel_actions_are_not_requeued_after_community_change() {
        let mut queue = TrayActionQueue {
            community_generation: 2,
            pending_actions: Vec::new(),
        };

        requeue_actions(
            &mut queue,
            vec![TrayAction::OpenChannel {
                channel_id: "old-channel".into(),
                community_generation: 1,
            }],
        );

        assert!(queue.pending_actions.is_empty());
    }

    #[test]
    fn new_channel_actions_survive_community_change() {
        let mut queue = TrayActionQueue {
            community_generation: 2,
            pending_actions: Vec::new(),
        };

        requeue_actions(&mut queue, vec![TrayAction::NewChannel]);

        assert_eq!(queue.pending_actions, vec![TrayAction::NewChannel]);
    }

    #[test]
    fn labels_deserialize_from_frontend_names_and_reject_blank_or_long_values() {
        let labels: TrayMenuLabels = serde_json::from_value(serde_json::json!({
            "running": "运行中",
            "noAgents": "没有正在运行的 Agent",
            "recent": "最近",
            "newChannel": "新建频道",
            "openApp": "打开 Kailo",
            "quitApp": "退出 Kailo",
        }))
        .expect("labels should deserialize");
        assert!(labels.clone().validated().is_ok());

        let blank = TrayMenuLabels {
            recent: "  ".into(),
            ..labels.clone()
        };
        assert!(blank.validated().is_err());
        let long = TrayMenuLabels {
            quit_app: "x".repeat(121),
            ..labels
        };
        assert!(long.validated().is_err());
    }
}
