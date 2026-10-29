//! DD-160 (DD-118(2)): the original Desktop remote repository reads
//! `get_project_repo_snapshot`, `get_project_repo_file_content` and
//! `get_project_repo_diff` (fixed Buzz 779af8886caae1317b4de962082429867ab61503
//! desktop/src-tauri/src/commands/project_git.rs, project_git_file_content.rs,
//! project_git_diff.rs), running the shared `buzz-project-git` plumbing that
//! Kailo Core uses for Web.
//!
//! Kailo differences, all at the authentication and addressing seam:
//! - The repository is named only by its 30617 coordinate. The smart HTTP root is
//!   derived from the admitted session's Relay; the webview never supplies a
//!   clone URL, filter or NIP-98.
//! - No `git-credential-nostr` sidecar: every git invocation gets a fresh NIP-98
//!   `Authorization` header signed in this process with the device CLIENT key
//!   (`u` = repository root, `method` = GET, the helper's shape). The key never
//!   reaches the git subprocess, its arguments, environment or any file.
//! - Before any git work the device identity must read `info/refs`; Relay's
//!   401 / 403 / 404 are one indistinguishable "not found" (DD-118(3)).
//! - One request has an overall deadline on top of the per-invocation caps.

use std::time::{Duration, Instant};

use buzz_project_git::{GitAuth, GitAuthConfig};
use nostr::{EventBuilder, JsonUtil, Keys, Kind, Tag};
use tauri::State;

use crate::{
    app_state::AppState,
    relay::{assert_expected_relay_scope, assert_expected_signer, relay_api_base_url_with_override},
};

/// The whole read, however many git invocations it needs.
const REQUEST_DEADLINE: Duration = Duration::from_secs(120);
/// `info/refs` preflight bound.
const PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(30);
/// Contract bound on `defaultBranch` / `baseBranch` / `targetRef` (as Core).
const MAX_REF_CHARS: usize = 255;
/// Contract bound on `path` (as Core).
const MAX_PATH_CHARS: usize = 4096;

/// Stable error codes the Projects host maps; git output never reaches the webview.
pub(crate) const REPO_NOT_FOUND: &str = "project_repo_not_found";
pub(crate) const REPO_INVALID_REQUEST: &str = "project_repo_invalid_request";
pub(crate) const REPO_UNAVAILABLE: &str = "project_repo_unavailable";
pub(crate) const REPO_TIMEOUT: &str = "project_repo_timeout";
pub(crate) const REPO_FAILED: &str = "project_repo_failed";

fn lower_hex(value: &str) -> bool {
    value
        .bytes()
        .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn repo_name_byte(c: u8) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-')
}

/// `/git/{owner}/{d}` for a 30617 coordinate, in exactly the shape Relay's git
/// routes serve (same rule as Kailo Core `projects_git::repository_path`).
pub(crate) fn repository_path(coordinate: &str) -> Option<String> {
    let (owner, d) = coordinate.strip_prefix("30617:")?.split_once(':')?;
    let owner_ok = owner.len() == 64 && lower_hex(owner);
    let d_ok = !d.is_empty()
        && d.len() <= 64
        && !d.starts_with('.')
        && !d.contains("..")
        && !d.ends_with(".git")
        && d.bytes().all(repo_name_byte);
    (owner_ok && d_ok).then(|| format!("/git/{owner}/{d}"))
}

fn within(value: Option<&str>, max_chars: usize) -> bool {
    match value {
        Some(value) => !value.is_empty() && value.chars().count() <= max_chars,
        None => true,
    }
}

/// The checked reference arguments of one read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RepoRead {
    pub repo_path: String,
    pub default_branch: Option<String>,
    pub base_branch: Option<String>,
    pub target_ref: Option<String>,
    pub target_commit: Option<String>,
}

pub(crate) fn checked_read(
    repository: &str,
    default_branch: Option<String>,
    base_branch: Option<String>,
    target_ref: Option<String>,
    target_commit: Option<String>,
) -> Result<RepoRead, String> {
    let repo_path = repository_path(repository).ok_or(REPO_INVALID_REQUEST)?;
    let refs_ok = within(default_branch.as_deref(), MAX_REF_CHARS)
        && within(base_branch.as_deref(), MAX_REF_CHARS)
        && within(target_ref.as_deref(), MAX_REF_CHARS);
    let commit_ok = match target_commit.as_deref() {
        Some(commit) => matches!(commit.len(), 40 | 64) && lower_hex(commit),
        None => true,
    };
    if !refs_ok || !commit_ok {
        return Err(REPO_INVALID_REQUEST.to_owned());
    }
    Ok(RepoRead {
        repo_path,
        default_branch,
        base_branch,
        target_ref,
        target_commit,
    })
}

pub(crate) fn checked_path(path: &str) -> Result<(), String> {
    if within(Some(path), MAX_PATH_CHARS) && buzz_project_git::validate_repo_file_path(path).is_ok()
    {
        Ok(())
    } else {
        Err(REPO_INVALID_REQUEST.to_owned())
    }
}

/// The NIP-98 value for git smart HTTP: `u` is the repository root, `method`
/// GET (Relay checks neither method nor payload on git routes, SF-BUZ-49).
/// Signed afresh for every call; the token's window never spans invocations.
pub(crate) fn git_authorization(keys: &Keys, repo_root: &str) -> Result<String, String> {
    use base64::Engine as _;
    let tags = vec![
        Tag::parse(["u", repo_root]).map_err(|error| format!("url tag failed: {error}"))?,
        Tag::parse(["method", "GET"]).map_err(|error| format!("method tag failed: {error}"))?,
    ];
    let event = EventBuilder::new(Kind::HttpAuth, "")
        .tags(tags)
        .sign_with_keys(keys)
        .map_err(|error| format!("sign failed: {error}"))?;
    Ok(format!(
        "Nostr {}",
        base64::engine::general_purpose::STANDARD.encode(event.as_json().as_bytes())
    ))
}

/// The admitted session's Relay HTTP base and device keys, refused when the
/// webview's expectation names another Relay or signer.
fn scoped(
    state: &AppState,
    expected_relay_url: &str,
    expected_signer_pubkey: &str,
) -> Result<(String, Keys), String> {
    // Repository reads are always scoped; an empty expectation is no scope.
    if expected_relay_url.trim().is_empty() || expected_signer_pubkey.trim().is_empty() {
        return Err(REPO_INVALID_REQUEST.to_owned());
    }
    let relay = relay_api_base_url_with_override(state);
    let keys = state.signing_keys()?;
    assert_expected_relay_scope(Some(expected_relay_url), &relay)?;
    assert_expected_signer(Some(expected_signer_pubkey), &keys.public_key().to_hex())?;
    Ok((relay.trim_end_matches('/').to_owned(), keys))
}

/// Map a git failure (after Relay admitted the read) to a stable code.
pub(crate) fn git_error(error: &str) -> String {
    if buzz_project_git::is_timeout_error(error) {
        REPO_TIMEOUT.to_owned()
    } else {
        REPO_FAILED.to_owned()
    }
}

/// DD-118(3): the device identity reads `info/refs` first; 401/403/404 are one
/// "not found", other failures are "unavailable".
async fn preflight(state: &AppState, keys: &Keys, repo_root: &str) -> Result<(), String> {
    let url = format!("{repo_root}/info/refs?service=git-upload-pack");
    let response = state
        .media_fetch_client
        .get(&url)
        .header("Authorization", git_authorization(keys, repo_root)?)
        .timeout(PREFLIGHT_TIMEOUT)
        .send()
        .await
        .map_err(|_| REPO_UNAVAILABLE.to_owned())?;
    match response.status().as_u16() {
        200..=299 => Ok(()),
        401 | 403 | 404 => Err(REPO_NOT_FOUND.to_owned()),
        _ => Err(REPO_UNAVAILABLE.to_owned()),
    }
}

/// Git authentication for one request: a fresh in-process NIP-98 per invocation.
fn auth_for(keys: Keys, repo_root: String, deadline: Instant) -> GitAuthConfig {
    let header = GitAuth::Header {
        authorization: Box::new(move || git_authorization(&keys, &repo_root)),
        host: None,
    };
    GitAuthConfig::new("git", header).with_deadline(deadline)
}

/// Run one blocking read after the preflight, refusing a result once the session's
/// Relay or signer changed meanwhile (the webview would show another identity's view).
async fn run_read<T, F>(
    state: &AppState,
    expected_relay_url: &str,
    expected_signer_pubkey: &str,
    repo_path: &str,
    read: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&str, &GitAuthConfig) -> Result<T, String> + Send + 'static,
{
    let deadline = Instant::now() + REQUEST_DEADLINE;
    let (base, keys) = scoped(state, expected_relay_url, expected_signer_pubkey)?;
    let repo_root = format!("{base}{repo_path}");
    preflight(state, &keys, &repo_root).await?;
    scoped(state, expected_relay_url, expected_signer_pubkey)?;
    let auth = auth_for(keys, repo_root.clone(), deadline);
    let value = tokio::task::spawn_blocking(move || read(&repo_root, &auth))
        .await
        .map_err(|_| REPO_FAILED.to_owned())?
        .map_err(|error| git_error(&error))?;
    scoped(state, expected_relay_url, expected_signer_pubkey)?;
    Ok(value)
}

/// Original `get_project_repo_snapshot` (raw snake_case shape; the TS host maps it).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn get_project_repo_snapshot(
    repository: String,
    default_branch: Option<String>,
    base_branch: Option<String>,
    target_ref: Option<String>,
    target_commit: Option<String>,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<buzz_project_git::ProjectRepoSnapshotInfo, String> {
    let read = checked_read(&repository, default_branch, base_branch, target_ref, target_commit)?;
    let repo_path = read.repo_path.clone();
    run_read(&state, &expected_relay_url, &expected_signer_pubkey, &repo_path, move |url, auth| {
        buzz_project_git::project_repo_snapshot(
            url,
            read.default_branch,
            read.base_branch,
            read.target_ref,
            read.target_commit,
            auth,
        )
    })
    .await
}

/// Original `get_project_repo_file_content`: bounded preview text or `None`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn get_project_repo_file_content(
    repository: String,
    default_branch: Option<String>,
    target_ref: Option<String>,
    target_commit: Option<String>,
    path: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let read = checked_read(&repository, default_branch, None, target_ref, target_commit)?;
    checked_path(&path)?;
    let repo_path = read.repo_path.clone();
    run_read(&state, &expected_relay_url, &expected_signer_pubkey, &repo_path, move |url, auth| {
        buzz_project_git::project_repo_file_content(
            url,
            read.default_branch,
            read.target_ref,
            read.target_commit,
            &path,
            auth,
        )
    })
    .await
}

/// Original `get_project_repo_diff`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn get_project_repo_diff(
    repository: String,
    default_branch: Option<String>,
    base_branch: Option<String>,
    target_ref: Option<String>,
    target_commit: Option<String>,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<buzz_project_git::ProjectRepoDiffInfo, String> {
    let read = checked_read(&repository, default_branch, base_branch, target_ref, target_commit)?;
    let repo_path = read.repo_path.clone();
    run_read(&state, &expected_relay_url, &expected_signer_pubkey, &repo_path, move |url, auth| {
        buzz_project_git::project_repo_diff(
            url,
            read.default_branch,
            read.base_branch,
            read.target_ref,
            read.target_commit,
            auth,
        )
    })
    .await
}

#[cfg(test)]
#[path = "project_git_remote_tests.rs"]
mod tests;
