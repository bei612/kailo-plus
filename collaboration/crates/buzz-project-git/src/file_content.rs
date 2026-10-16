//! Fixed Buzz 779af8886caae1317b4de962082429867ab61503
//! desktop/src-tauri/src/commands/project_git_file_content.rs
//! (`read_preview_content`, `validate_repo_file_path`, `checkout_project_repo`
//! and the blocking body of `get_project_repo_file_content`).

use crate::exec::{clean_branch, clean_target_ref, run_git, GitAuthConfig};
use crate::snapshot::first_output_line;

/// Original bound on one file preview.
pub const MAX_PREVIEW_BYTES: u64 = 64 * 1024;

pub(crate) fn read_preview_content(
    repo_dir: &std::path::Path,
    path: &str,
    size: Option<u64>,
) -> Option<String> {
    if size.is_some_and(|value| value > MAX_PREVIEW_BYTES) {
        return None;
    }

    let full_path = repo_dir.join(path);
    if std::fs::symlink_metadata(&full_path)
        .ok()?
        .file_type()
        .is_symlink()
    {
        return None;
    }
    let normalized = full_path.canonicalize().ok()?;
    let repo_root = repo_dir.canonicalize().ok()?;
    if !normalized.starts_with(repo_root) {
        return None;
    }

    let metadata = std::fs::metadata(&normalized).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_PREVIEW_BYTES {
        return None;
    }
    let bytes = std::fs::read(normalized).ok()?;
    if bytes.contains(&0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

/// Rejects empty, absolute and traversing paths: only plain relative
/// components may name a repository file.
pub fn validate_repo_file_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || std::path::Path::new(path)
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err("Repository file path must be a relative file path.".to_string());
    }
    Ok(())
}

/// The original commands' inline `target_commit` normalization: lowercase,
/// 40 or 64 hex digits, otherwise ignored.
pub(crate) fn clean_target_commit(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| matches!(value.len(), 40 | 64))
        .filter(|value| value.chars().all(|c| c.is_ascii_hexdigit()))
}

pub(crate) fn checkout_project_repo(
    repo_dir: &std::path::Path,
    clone_url: &str,
    branch: Option<&str>,
    target_ref: Option<&str>,
    target_commit: Option<&str>,
    auth: &GitAuthConfig,
) -> Result<(), String> {
    let repo_path = repo_dir
        .to_str()
        .ok_or_else(|| "temporary repository path is not UTF-8".to_string())?;
    let explicit_target = target_ref.or(target_commit);

    if let Some(fetch_ref) = explicit_target {
        run_git(
            &[
                "clone",
                "--filter=blob:none",
                "--no-checkout",
                clone_url,
                repo_path,
            ],
            None,
            auth,
        )?;
        run_git(
            &["fetch", "--depth=100", "origin", fetch_ref],
            Some(repo_dir),
            auth,
        )?;
        if let Some(expected_commit) = target_commit {
            let fetched_commit = run_git(&["rev-parse", "FETCH_HEAD"], Some(repo_dir), auth)
                .ok()
                .and_then(|output| first_output_line(&output))
                .map(|commit| commit.to_ascii_lowercase())
                .ok_or_else(|| "Could not resolve the requested repository ref.".to_string())?;
            if fetched_commit != expected_commit {
                return Err(
                    "The requested repository ref changed. Refresh and try again.".to_string(),
                );
            }
        }
        run_git(
            &["checkout", "--detach", "FETCH_HEAD"],
            Some(repo_dir),
            auth,
        )?;
        return Ok(());
    }

    let mut clone_args = vec!["clone", "--filter=blob:none"];
    if let Some(branch) = branch {
        clone_args.push("--branch");
        clone_args.push(branch);
    }
    clone_args.push(clone_url);
    clone_args.push(repo_path);
    if run_git(&clone_args, None, auth).is_err() && branch.is_some() {
        run_git(
            &["clone", "--filter=blob:none", clone_url, repo_path],
            None,
            auth,
        )?;
    }
    Ok(())
}

/// Blocking body of the original `get_project_repo_file_content`: a fresh
/// temporary partial clone, then the bounded preview of `path` (`None` when
/// the file is missing, binary, a symlink or over [`MAX_PREVIEW_BYTES`]).
pub fn project_repo_file_content(
    clone_url: &str,
    default_branch: Option<String>,
    target_ref: Option<String>,
    target_commit: Option<String>,
    path: &str,
    auth: &GitAuthConfig,
) -> Result<Option<String>, String> {
    validate_repo_file_path(path)?;
    let branch = clean_branch(default_branch);
    let target_ref = clean_target_ref(target_ref);
    let target_commit = clean_target_commit(target_commit);

    let temp_dir = tempfile::tempdir().map_err(|error| format!("create temp dir: {error}"))?;
    let repo_dir = temp_dir.path().join("repo");
    checkout_project_repo(
        &repo_dir,
        clone_url,
        branch.as_deref(),
        target_ref.as_deref(),
        target_commit.as_deref(),
        auth,
    )?;
    Ok(read_preview_content(&repo_dir, path, None))
}
