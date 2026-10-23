//! The tray menu exists only on macOS, as in the original. Other platforms keep the same
//! command surface so the shared webview code needs no platform branches; the commands
//! accept and discard updates and never report queued actions.

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct TrayAgentActivity {}

#[derive(Debug, Deserialize)]
pub struct TrayMenuLabels {}

#[derive(Debug, Deserialize, Serialize)]
pub struct TrayAction {}

#[tauri::command]
pub fn take_tray_actions() -> Vec<TrayAction> {
    Vec::new()
}

#[tauri::command]
pub fn requeue_tray_actions(actions: Vec<TrayAction>) {
    let _ = actions;
}

#[tauri::command]
pub fn clear_tray_agent_activity() {}

#[tauri::command]
pub fn update_tray_menu_labels(labels: TrayMenuLabels) {
    let _ = labels;
}

#[tauri::command]
pub fn update_tray_agent_activity(
    activities: Vec<TrayAgentActivity>,
    recent_activities: Vec<TrayAgentActivity>,
) {
    let _ = (activities, recent_activities);
}
