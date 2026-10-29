//! DD-160: original Buzz local checkout commands, scoped to the admitted
//! Community and 30617 coordinate. The webview supplies neither a filesystem
//! path nor a clone URL. Git authentication comes from project_git_remote.

use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};
use std::time::Instant;

use buzz_project_git::checkout::*;
use buzz_project_git::GitAuthConfig;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use super::project_git_remote::{
    checked_path, git_error, repository_path, RepoScope, REPO_FAILED, REPO_INVALID_REQUEST,
    REPO_TIMEOUT, REQUEST_DEADLINE,
};

// Mutating and reading the same checkout must not race within this process.
// External editors/git retain their ordinary git locks and ff/lease checks.
static CHECKOUT_LOCK: LazyLock<Arc<tokio::sync::Mutex<()>>> =
    LazyLock::new(|| Arc::new(tokio::sync::Mutex::new(())));

fn partition(base: &str, coordinate: &str) -> Result<PathBuf, String> {
    let checked = repository_path(coordinate).ok_or(REPO_INVALID_REQUEST)?;
    let digest = Sha256::digest(base.as_bytes());
    let community = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(PathBuf::from("project-checkouts")
        .join(community)
        .join(checked.trim_start_matches("/git/")))
}

/// No search of home/global repos, no legacy fallback across Community, and no
/// symlink escape through either checkout or its metadata directory.
fn checkout_path(app_data: &Path, base: &str, coordinate: &str) -> Result<PathBuf, String> {
    let relative = partition(base, coordinate)?;
    std::fs::create_dir_all(app_data).map_err(|_| REPO_FAILED)?;
    let root = app_data.canonicalize().map_err(|_| REPO_FAILED)?;
    let mut path = root.clone();
    let components = relative.components().collect::<Vec<_>>();
    for (index, component) in components.iter().enumerate() {
        path.push(component);
        match std::fs::symlink_metadata(&path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err(REPO_FAILED.into());
                }
                if !path
                    .canonicalize()
                    .map_err(|_| REPO_FAILED)?
                    .starts_with(&root)
                {
                    return Err(REPO_FAILED.into());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if index + 1 < components.len() {
                    std::fs::create_dir(&path).map_err(|_| REPO_FAILED)?;
                }
            }
            Err(_) => return Err(REPO_FAILED.into()),
        }
    }
    Ok(path)
}

fn map_checkout_error(error: &str) -> String {
    if matches!(error, CHECKOUT_OUTCOME_UNKNOWN | CHECKOUT_CONFLICT) {
        error.to_owned()
    } else {
        git_error(error)
    }
}

async fn with_checkout<T, F>(
    app: AppHandle,
    repository: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    work: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&Path, &str, &GitAuthConfig) -> Result<T, String> + Send + 'static,
{
    let started = Instant::now();
    let repo_path = repository_path(&repository).ok_or(REPO_INVALID_REQUEST)?;
    let scope = RepoScope::capture(&app, &expected_relay_url, &expected_signer_pubkey)?;
    let root = scope.repository_root(&repo_path)?;
    scope.preflight(&root).await?;
    let app_data = app.path().app_data_dir().map_err(|_| REPO_FAILED)?;
    let task_scope = scope.clone();
    let deadline = started + REQUEST_DEADLINE;
    let guard = tokio::time::timeout_at(
        tokio::time::Instant::from_std(deadline),
        Arc::clone(&CHECKOUT_LOCK).lock_owned(),
    )
    .await
    .map_err(|_| REPO_TIMEOUT)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        // Keep the owned guard in the blocking work even if the webview drops
        // its caller. Queueing itself obeys the same whole-request deadline.
        let _guard = guard;
        let (base, _) = task_scope.check()?;
        let path = checkout_path(&app_data, &base, &repository)?;
        let auth = task_scope.auth(root.clone(), deadline);
        let result = work(&path, &root, &auth).map_err(|error| map_checkout_error(&error));
        task_scope.check()?;
        result
    })
    .await
    .map_err(|_| REPO_FAILED)?;
    scope.check()?;
    result
}

#[tauri::command]
pub async fn clone_project_repository(
    repository: String,
    default_branch: Option<String>,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    app: AppHandle,
) -> Result<ProjectRepoCloneResult, String> {
    with_checkout(
        app,
        repository,
        expected_relay_url,
        expected_signer_pubkey,
        move |path, root, auth| clone_checkout(path, root, default_branch.as_deref(), auth),
    )
    .await
}

#[tauri::command]
pub async fn get_project_repo_sync_status(
    repository: String,
    branch_name: Option<String>,
    base_branch: Option<String>,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    app: AppHandle,
) -> Result<Option<ProjectRepoSyncStatusInfo>, String> {
    with_checkout(
        app,
        repository,
        expected_relay_url,
        expected_signer_pubkey,
        move |path, root, auth| {
            if !path.exists() {
                return Ok(None);
            }
            checkout_status(
                path,
                root,
                branch_name.as_deref(),
                base_branch.as_deref(),
                auth,
            )
            .map(Some)
        },
    )
    .await
}

#[tauri::command]
pub async fn push_project_local_repository(
    repository: String,
    branch_name: Option<String>,
    base_branch: Option<String>,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    app: AppHandle,
) -> Result<ProjectRepoPushResult, String> {
    with_checkout(
        app,
        repository,
        expected_relay_url,
        expected_signer_pubkey,
        move |path, root, auth| {
            push_checkout(
                path,
                root,
                branch_name.as_deref(),
                base_branch.as_deref(),
                auth,
            )
        },
    )
    .await
}

#[tauri::command]
pub async fn pull_project_local_repository(
    repository: String,
    branch_name: Option<String>,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    app: AppHandle,
) -> Result<ProjectRepoPullResult, String> {
    with_checkout(
        app,
        repository,
        expected_relay_url,
        expected_signer_pubkey,
        move |path, root, auth| pull_checkout(path, root, branch_name.as_deref(), auth),
    )
    .await
}

#[tauri::command]
pub async fn get_project_local_repo_snapshot(
    repository: String,
    default_branch: Option<String>,
    base_branch: Option<String>,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    app: AppHandle,
) -> Result<Option<ProjectLocalRepoSnapshotInfo>, String> {
    with_checkout(
        app,
        repository,
        expected_relay_url,
        expected_signer_pubkey,
        move |path, root, auth| {
            if !path.exists() {
                return Ok(None);
            }
            checkout_snapshot(
                path,
                root,
                default_branch.as_deref(),
                base_branch.as_deref(),
                auth,
            )
            .map(Some)
        },
    )
    .await
}

#[tauri::command]
pub async fn get_project_local_repo_file_content(
    repository: String,
    path: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    app: AppHandle,
) -> Result<Option<String>, String> {
    checked_path(&path)?;
    with_checkout(
        app,
        repository,
        expected_relay_url,
        expected_signer_pubkey,
        move |repo, root, auth| checkout_file_content(repo, root, &path, auth),
    )
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn get_project_local_repo_diff(
    repository: String,
    default_branch: Option<String>,
    base_branch: Option<String>,
    base_commit: Option<String>,
    target_commit: Option<String>,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    app: AppHandle,
) -> Result<Option<buzz_project_git::ProjectRepoDiffInfo>, String> {
    with_checkout(
        app,
        repository,
        expected_relay_url,
        expected_signer_pubkey,
        move |path, root, auth| {
            if !path.exists() {
                return Ok(None);
            }
            checkout_diff(
                path,
                root,
                default_branch.as_deref(),
                base_branch.as_deref(),
                base_commit,
                target_commit,
                auth,
            )
            .map(Some)
        },
    )
    .await
}

#[tauri::command]
pub async fn open_project_repository_folder(
    repository: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    app: AppHandle,
) -> Result<(), String> {
    let opener_app = app.clone();
    // Opening is performed inside the captured scope/lock, not by forwarding an
    // arbitrary frontend path to the OS opener after an awaited lookup.
    with_checkout(
        app,
        repository,
        expected_relay_url,
        expected_signer_pubkey,
        move |path, root, auth| {
            validate_checkout(path, root, auth)?;
            opener_app
                .opener()
                .open_path(path.to_string_lossy(), None::<&str>)
                .map_err(|_| REPO_FAILED.to_owned())
        },
    )
    .await
}

#[cfg(test)]
#[path = "project_git_checkout_tests.rs"]
mod tests;
