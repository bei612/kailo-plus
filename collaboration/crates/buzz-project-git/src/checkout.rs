//! DD-160 local checkouts, adapted from fixed Buzz 779af8886caae1317b4de962082429867ab61503
//! desktop/src-tauri/src/commands/project_git{,_workflow,_push,_diff}.rs.
//! Callers own the admitted Community/coordinate path and preflight. All git
//! invocations reuse the shared ephemeral authentication and request deadline.

use crate::exec::{run_git, clean_branch, GitAuthConfig};
use crate::file_content::read_preview_content;
use crate::snapshot::{first_output_line, parse_latest_commit, parse_commits, parse_contributors, parse_latest_commit_by_path, branch_activity_range, MAX_EAGER_FILE_PREVIEWS};
use crate::diff::{empty_tree_ref, commit_parent_range, diff_from_repo, clean_commit, ProjectRepoDiffInfo};
use crate::types::{ProjectRepoSnapshotInfo, ProjectRepoCommitInfo, ProjectRepoFileInfo};
use serde::Serialize;
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
pub struct ProjectLocalRepoSnapshotInfo {
    pub path: String,
    pub snapshot: ProjectRepoSnapshotInfo,
}

#[derive(Serialize)]
pub struct ProjectLocalRepoInfo {
    pub name: String,
    pub path: String,
}

#[derive(Serialize)]
pub struct ProjectRepoSyncStatusInfo {
    pub local_path: Option<String>,
    pub local_branch: Option<String>,
    pub local_branches: Vec<String>,
    pub local_head: Option<String>,
    pub local_short_head: Option<String>,
    pub remote_branch: Option<String>,
    pub remote_head: Option<String>,
    pub remote_short_head: Option<String>,
    pub merge_base: Option<String>,
    pub ahead_count: usize,
    pub behind_count: usize,
    pub has_uncommitted_changes: bool,
    pub has_untracked_files: bool,
    pub can_push: bool,
    pub push_block_reason: Option<String>,
    pub can_pull: bool,
    pub pull_block_reason: Option<String>,
}

#[derive(Serialize)]
pub struct ProjectRepoPushResult {
    pub pushed: bool,
    pub message: String,
    pub branch: String,
    pub commit: String,
    pub merge_base: Option<String>,
}

#[derive(Serialize)]
pub struct ProjectRepoPullResult {
    pub pulled: bool,
    pub message: String,
}


#[derive(Serialize)]
pub struct ProjectRepoCloneResult { pub path: String, pub cloned: bool, pub message: String }

/// Stable write uncertainty: refresh/reconcile the remote ref; never blindly retry.
pub const CHECKOUT_OUTCOME_UNKNOWN: &str = "project_repo_outcome_unknown";

fn branch(value: Option<&str>) -> Result<Option<String>, String> {
    value.map(|value| {
        if value.chars().count() > 255 { return Err("Invalid repository branch.".to_owned()); }
        clean_branch(Some(value.to_owned())).ok_or_else(|| "Invalid repository branch.".to_owned())
    }).transpose()
}

/// Refuse repository-local redirection or executable config before any network
/// operation. An app-owned checkout is editable by its owner; editing it must
/// not redirect a newly signed Authorization header to a different server.
pub fn validate_checkout(repo: &Path, root: &str, auth: &GitAuthConfig) -> Result<(), String> {
    let dot_git = repo.join(".git");
    if !std::fs::symlink_metadata(&dot_git).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink()) {
        return Err("Local checkout metadata is invalid.".into());
    }
    let config = dot_git.join("config");
    if !std::fs::symlink_metadata(config).is_ok_and(|m| m.is_file() && !m.file_type().is_symlink()) {
        return Err("Local checkout configuration is invalid.".into());
    }
    let config = run_git(&["config", "--local", "--null", "--list"], Some(repo), auth)?;
    let mut origins = 0;
    for entry in config.split('\0').filter(|e| !e.is_empty()) {
        let (key, value) = entry.split_once('\n').unwrap_or((entry, ""));
        let permitted = matches!(key, "core.repositoryformatversion" | "core.filemode" | "core.logallrefupdates" | "core.ignorecase" | "core.precomposeunicode" | "core.autocrlf" | "core.symlinks" | "user.name" | "user.email" | "remote.origin.fetch")
            || (key == "core.bare" && value == "false")
            || (key == "extensions.objectformat" && matches!(value, "sha1" | "sha256"))
            || (key.starts_with("branch.") && (key.ends_with(".remote") || key.ends_with(".merge")));
        if key == "remote.origin.url" {
            if value != root { return Err("Local checkout belongs to another repository.".into()); }
            origins += 1;
        } else if !permitted { return Err("Local checkout configuration is not supported.".into()); }
    }
    if origins != 1 { return Err("Local checkout origin is missing or ambiguous.".into()); }
    Ok(())
}

pub fn clone_checkout(repo: &Path, root: &str, default_branch: Option<&str>, auth: &GitAuthConfig) -> Result<ProjectRepoCloneResult, String> {
    let branch = branch(default_branch)?;
    if repo.exists() {
        validate_checkout(repo, root, auth)?;
        return Ok(ProjectRepoCloneResult { path: repo.display().to_string(), cloned: false, message: "Repository is already cloned.".into() });
    }
    let parent = repo.parent().ok_or("Invalid checkout directory.")?;
    let temporary = tempfile::tempdir_in(parent).map_err(|_| "Could not create checkout directory.")?;
    let pending = temporary.path().join("repo");
    let path = pending.to_str().ok_or("Repository path is not UTF-8.")?;
    // Only an actually empty remote may use the unborn-HEAD fallback. A missing
    // requested branch or a failed fetch is never silently replaced by HEAD.
    let heads = run_git(&["ls-remote", "--heads", "--end-of-options", root], None, auth)?;
    let mut args = vec!["clone"];
    if !heads.trim().is_empty() {
        if let Some(branch) = branch.as_deref() { args.extend(["--branch", branch]); }
    }
    args.extend(["--end-of-options", root, path]);
    run_git(&args, None, auth)?;
    if heads.trim().is_empty() {
        if let Some(branch) = branch { run_git(&["symbolic-ref", "HEAD", &format!("refs/heads/{branch}")], Some(&pending), auth)?; }
    }
    validate_checkout(&pending, root, auth)?;
    auth.check_deadline()?;
    if repo.exists() { return Err("Checkout destination changed. Refresh and try again.".into()); }
    std::fs::rename(&pending, repo).map_err(|_| "Could not publish local checkout.")?;
    Ok(ProjectRepoCloneResult { path: repo.display().to_string(), cloned: true, message: format!("Cloned repository to {}.", repo.display()) })
}

fn checked_head(repo: &Path, reference: &str, auth: &GitAuthConfig) -> Result<Option<String>, String> {
    match run_git(&["rev-parse", "--verify", "--quiet", reference], Some(repo), auth) {
        Ok(output) => Ok(first_output_line(&output)),
        Err(error) => {
            let name = if reference == "HEAD" {
                run_git(&["symbolic-ref", "--quiet", "HEAD"], Some(repo), auth)?.trim().to_owned()
            } else { reference.to_owned() };
            let found = run_git(&["for-each-ref", "--format=%(objectname)", &name], Some(repo), auth)?;
            if found.trim().is_empty() { Ok(None) } else { Err(error) }
        },
    }
}

pub fn checkout_status(repo: &Path, root: &str, branch_name: Option<&str>, base_branch: Option<&str>, auth: &GitAuthConfig) -> Result<ProjectRepoSyncStatusInfo, String> {
    validate_checkout(repo, root, auth)?;
    let local_branch = first_output_line(&run_git(&["branch", "--show-current"], Some(repo), auth)?);
    let branch = branch(branch_name)?.or(branch(local_branch.as_deref())?).unwrap_or_else(|| "main".into());
    let base = self::branch(base_branch)?.filter(|base| base != &branch);
    let local_branches = run_git(&["for-each-ref", "--count=200", "--format=%(refname:short)", "refs/heads/"], Some(repo), auth)?.lines().map(|v| v.to_owned()).collect();
    let remote_heads = run_git(&["ls-remote", "--heads", "--end-of-options", root], Some(repo), auth)?;
    // A failed fetch must fail the entire status, never advertise a stale can_push.
    run_git(&["fetch", "--quiet", "--prune", "--end-of-options", root, "+refs/heads/*:refs/remotes/origin/*"], Some(repo), auth)?;
    let local_head = checked_head(repo, "HEAD", auth)?;
    let remote_ref = format!("refs/remotes/origin/{branch}");
    let remote_head = checked_head(repo, &remote_ref, auth)?;
    let count = |range: &str| -> Result<usize, String> { run_git(&["rev-list", "--count", range], Some(repo), auth)?.trim().parse().map_err(|_| "Invalid revision count.".to_owned()) };
    let ahead_count = if remote_head.is_some() && local_head.is_some() { count(&format!("{remote_ref}..HEAD"))? } else { usize::from(local_head.is_some()) };
    let behind_count = if remote_head.is_some() && local_head.is_some() { count(&format!("HEAD..{remote_ref}"))? } else { 0 };
    let status = run_git(&["status", "--porcelain"], Some(repo), auth)?;
    let has_uncommitted_changes = status.lines().any(|line| !line.starts_with("??") && !line.trim().is_empty());
    let has_untracked_files = status.lines().any(|line| line.starts_with("??"));
    let dirty = has_uncommitted_changes || has_untracked_files;
    let first_publish = remote_head.is_none() && remote_heads.trim().is_empty();
    let mismatch = local_branch.as_deref() != Some(&branch);
    let push_block_reason = if local_head.is_none() { Some("No local commits to push.") }
        else if mismatch && !first_publish { Some("Local checkout is on a different branch.") }
        else if dirty { Some("Commit or discard local changes before pushing.") }
        else if behind_count > 0 { Some("Pull or reconcile remote commits before pushing.") }
        else if ahead_count == 0 { Some("Local branch is already pushed.") } else { None };
    let pull_block_reason = if local_head.is_none() { Some("No local commits yet — clone instead of pulling.") }
        else if remote_head.is_none() { Some("Remote branch not found.") }
        else if behind_count == 0 { Some("Local branch is up to date.") }
        else if mismatch { Some("Local checkout is on a different branch.") }
        else if dirty { Some("Commit or stash local changes before pulling.") }
        else if ahead_count > 0 { Some("Local and remote have diverged — reconcile in a terminal.") } else { None };
    let merge_base = if let Some(base) = base { run_git(&["merge-base", "HEAD", &format!("refs/remotes/origin/{base}")], Some(repo), auth).ok().and_then(|out| first_output_line(&out)) } else { None };
    auth.check_deadline()?;
    Ok(ProjectRepoSyncStatusInfo { local_path: Some(repo.display().to_string()), local_branch, local_branches,
        local_short_head: local_head.as_deref().map(|h| h.chars().take(7).collect()), local_head,
        remote_branch: Some(branch), remote_short_head: remote_head.as_deref().map(|h| h.chars().take(7).collect()), remote_head, merge_base,
        ahead_count, behind_count, has_uncommitted_changes, has_untracked_files,
        can_push: push_block_reason.is_none(), push_block_reason: push_block_reason.map(str::to_owned),
        can_pull: pull_block_reason.is_none(), pull_block_reason: pull_block_reason.map(str::to_owned) })
}

pub fn push_checkout(repo: &Path, root: &str, branch: Option<&str>, base: Option<&str>, auth: &GitAuthConfig) -> Result<ProjectRepoPushResult, String> {
    let status = checkout_status(repo, root, branch, base, auth)?;
    if let Some(reason) = status.push_block_reason { return Err(reason); }
    let branch = status.remote_branch.ok_or("No selected branch.")?;
    let commit = status.local_head.ok_or("No local commit.")?;
    if status.local_branch.as_deref() != Some(&branch) && status.remote_head.is_none() {
        run_git(&["branch", "-m", "--", &branch], Some(repo), auth)?;
    }
    let reference = format!("refs/heads/{branch}");
    let lease = format!("--force-with-lease={reference}:{}", status.remote_head.as_deref().unwrap_or(""));
    if run_git(&["push", &lease, "--end-of-options", root, &format!("{commit}:{reference}")], Some(repo), auth).is_err() {
        let observed = run_git(&["ls-remote", "--heads", "--end-of-options", root, &reference], Some(repo), auth).ok();
        if !observed.as_deref().is_some_and(|v| v.split_whitespace().next() == Some(&commit)) { return Err(CHECKOUT_OUTCOME_UNKNOWN.into()); }
    }
    Ok(ProjectRepoPushResult { pushed: true, message: format!("Pushed {branch} to remote."), branch, commit, merge_base: status.merge_base })
}

pub fn pull_checkout(repo: &Path, root: &str, branch: Option<&str>, auth: &GitAuthConfig) -> Result<ProjectRepoPullResult, String> {
    let status = checkout_status(repo, root, branch, None, auth)?;
    if let Some(reason) = status.pull_block_reason { return Err(reason); }
    let target = status.remote_head.ok_or("No remote commit.")?;
    // Merge exactly the fetched, checked head; no second unobserved network pull.
    run_git(&["merge", "--ff-only", "--no-edit", &target], Some(repo), auth)?;
    Ok(ProjectRepoPullResult { pulled: true, message: "Pulled remote commits.".into() })
}

fn path_modified_at(path: &std::path::Path) -> Option<i64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    modified
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_secs()).ok())
}

fn parse_worktree_files(
    repo_dir: &std::path::Path,
    output: &str,
    latest_commit_by_path: &std::collections::HashMap<String, ProjectRepoCommitInfo>,
) -> Vec<ProjectRepoFileInfo> {
    output
        .split('\0')
        .filter(|path| !path.trim().is_empty())
        .filter_map(|path| {
            let full_path = repo_dir.join(path);
            let metadata = std::fs::metadata(&full_path).ok()?;
            metadata.is_file().then_some((path, full_path, metadata))
        })
        .enumerate()
        .map(|(index, (path, full_path, metadata))| {
            let size = Some(metadata.len());
            let latest_commit = latest_commit_by_path.get(path).cloned();
            ProjectRepoFileInfo {
                path: path.to_string(),
                kind: "blob".to_string(),
                size,
                preview_content: (index < MAX_EAGER_FILE_PREVIEWS)
                    .then(|| read_preview_content(repo_dir, path, size))
                    .flatten(),
                last_changed_at: latest_commit
                    .as_ref()
                    .map(|commit| commit.timestamp)
                    .or_else(|| path_modified_at(&full_path)),
                latest_commit,
            }
        })
        .collect()
}

fn snapshot_from_worktree(
    repo_dir: &std::path::Path,
    auth: &GitAuthConfig,
    branch_name: Option<&str>,
    base_branch: Option<&str>,
) -> Result<ProjectRepoSnapshotInfo, String> {
    let latest_commit = if checked_head(repo_dir, "HEAD", auth)?.is_some() {
        parse_latest_commit(&run_git(&["log", "-1", "--format=%H%x00%h%x00%an%x00%ae%x00%at%x00%s"], Some(repo_dir), auth)?)
    } else { None };
    let branch_activity_range = branch_activity_range(repo_dir, auth, branch_name, base_branch);
    let branch_activity_ref = branch_activity_range.as_deref().unwrap_or("HEAD");
    let (commits, contributors, latest_commit_by_path) = if latest_commit.is_some() {
        let commits = run_git(
            &[
                "log",
                "--max-count=50",
                "--format=%H%x00%h%x00%an%x00%ae%x00%at%x00%s",
                branch_activity_ref,
            ],
            Some(repo_dir),
            auth,
        )
        .map(|output| parse_commits(&output))
        ?;
        let contributors = run_git(
            &["log", "--format=%an%x00%ae%x00%at", branch_activity_ref],
            Some(repo_dir),
            auth,
        )
        .map(|output| parse_contributors(&output))
        ?;
        let latest_commit_by_path = run_git(
            &[
                "log",
                "--format=%H%x00%h%x00%an%x00%ae%x00%at%x00%s",
                "--name-only",
                "--diff-filter=ACMRT",
                "--",
            ],
            Some(repo_dir),
            auth,
        )
        .map(|output| parse_latest_commit_by_path(&output))
        ?;
        (commits, contributors, latest_commit_by_path)
    } else {
        (Vec::new(), Vec::new(), std::collections::HashMap::new())
    };

    let files = run_git(
        &[
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
        Some(repo_dir),
        auth,
    )
    .map(|output| parse_worktree_files(repo_dir, &output, &latest_commit_by_path))
    ?;

    Ok(ProjectRepoSnapshotInfo {
        latest_commit,
        commits,
        files,
        contributors,
    })
}

fn local_ref_exists(repo_dir: &std::path::Path, auth: &GitAuthConfig, ref_name: &str) -> bool {
    run_git(
        &["rev-parse", "--verify", "--quiet", ref_name],
        Some(repo_dir),
        auth,
    )
    .is_ok()
}

fn local_target_ref(
    repo_dir: &std::path::Path,
    auth: &GitAuthConfig,
    branch: Option<&str>,
    target_commit: Option<&str>,
) -> String {
    if let Some(target_commit) = target_commit {
        if local_ref_exists(repo_dir, auth, target_commit) {
            return target_commit.to_string();
        }
    }
    if let Some(branch) = branch {
        if local_ref_exists(repo_dir, auth, branch) {
            return branch.to_string();
        }
        let origin_branch = format!("origin/{branch}");
        if local_ref_exists(repo_dir, auth, &origin_branch) {
            return origin_branch;
        }
    }
    "HEAD".to_string()
}

fn local_base_ref(
    repo_dir: &std::path::Path,
    auth: &GitAuthConfig,
    branch: Option<&str>,
    target_branch: Option<&str>,
) -> Option<String> {
    let branch = branch?;
    let origin_branch = format!("origin/{branch}");
    if local_ref_exists(repo_dir, auth, &origin_branch) {
        return Some(origin_branch);
    }
    if target_branch == Some(branch) {
        return None;
    }
    local_ref_exists(repo_dir, auth, branch).then_some(branch.to_string())
}

fn local_diff_range(
    repo_dir: &std::path::Path,
    auth: &GitAuthConfig,
    base_branch: Option<&str>,
    target_branch: Option<&str>,
    base_commit: Option<&str>,
    target_commit: Option<&str>,
) -> String {
    let target_ref = local_target_ref(repo_dir, auth, target_branch, target_commit);
    if let Some(base_commit) = base_commit {
        if base_commit != target_ref && local_ref_exists(repo_dir, auth, base_commit) {
            return if run_git(
                &["merge-base", base_commit, &target_ref],
                Some(repo_dir),
                auth,
            )
            .is_ok()
            {
                format!("{base_commit}...{target_ref}")
            } else {
                format!("{base_commit}..{target_ref}")
            };
        }
    }
    if let Some(base_ref) = local_base_ref(repo_dir, auth, base_branch, target_branch) {
        return if run_git(
            &["merge-base", &base_ref, &target_ref],
            Some(repo_dir),
            auth,
        )
        .is_ok()
        {
            format!("{base_ref}...{target_ref}")
        } else {
            format!("{base_ref}..{target_ref}")
        };
    }
    // With no base at all, a bare commit means "diff against its parent"
    // (commit detail view) rather than against the whole tree.
    if base_commit.is_none() && base_branch.is_none() {
        if let Some(target_commit) = target_commit {
            if local_ref_exists(repo_dir, auth, target_commit) {
                if let Ok(range) = commit_parent_range(repo_dir, auth, target_commit) {
                    return range;
                }
            }
        }
    }
    empty_tree_ref(repo_dir, auth)
        .map(|empty_tree| format!("{empty_tree}..{target_ref}"))
        .unwrap_or_else(|_| format!("{target_ref}^..{target_ref}"))
}


pub fn checkout_snapshot(repo: &Path, root: &str, default_branch: Option<&str>, base_branch: Option<&str>, auth: &GitAuthConfig) -> Result<ProjectLocalRepoSnapshotInfo, String> {
    validate_checkout(repo, root, auth)?;
    let branch = branch(default_branch)?;
    let base = self::branch(base_branch)?;
    let snapshot = snapshot_from_worktree(repo, auth, branch.as_deref(), base.as_deref())?;
    auth.check_deadline()?;
    Ok(ProjectLocalRepoSnapshotInfo { path: repo.display().to_string(), snapshot })
}

pub fn checkout_diff(repo: &Path, root: &str, default_branch: Option<&str>, base_branch: Option<&str>, base_commit: Option<String>, target_commit: Option<String>, auth: &GitAuthConfig) -> Result<ProjectRepoDiffInfo, String> {
    validate_checkout(repo, root, auth)?;
    let branch = branch(default_branch)?;
    let base = self::branch(base_branch)?;
    let checked_commit = |value: Option<String>| -> Result<Option<String>, String> { value.map(|value| clean_commit(Some(value)).ok_or_else(|| "Invalid commit.".to_owned())).transpose() };
    let base_commit = checked_commit(base_commit)?;
    let target_commit = checked_commit(target_commit)?;
    for commit in [base_commit.as_deref(), target_commit.as_deref()].into_iter().flatten() {
        if !local_ref_exists(repo, auth, commit) { return Err("Requested local commit was not found.".into()); }
    }
    let range = local_diff_range(repo, auth, base.as_deref(), branch.as_deref(), base_commit.as_deref(), target_commit.as_deref());
    let body = if base_commit.is_none() && base.is_none() { target_commit.as_deref() } else { None };
    let result = diff_from_repo(repo, auth, &range, body)?;
    auth.check_deadline()?;
    Ok(result)
}

#[cfg(test)]
#[path = "checkout_tests.rs"]
mod tests;
