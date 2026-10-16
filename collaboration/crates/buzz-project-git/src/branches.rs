//! Authenticated remote branch management for Projects repositories.
//!
//! Fixed Buzz 779af8886caae1317b4de962082429867ab61503
//! desktop/src-tauri/src/commands/project_git_branches.rs (`normalize_branch`,
//! `normalize_commit`, `remote_head_branch`, `create_remote_branch_blocking`,
//! `delete_remote_branch_blocking` and their tests). The Tauri command wrappers
//! (`create_project_remote_branch` / `delete_project_remote_branch`) stay with
//! Desktop; their input normalization is exported unchanged.
//!
//! Kailo (DD-118): authentication is the crate's [`GitAuthConfig`]; a failure
//! records whether `git push` ran ([`RemoteBranchError::pushed`]), because only
//! then may the remote have applied the update and the caller has to reconcile
//! it. [`remote_branch_commit`] is that reconciliation read: the ref as the
//! remote advertises it to the same identity.

use crate::diff::clean_commit;
use crate::exec::{clean_branch, run_git, GitAuthConfig};
use crate::snapshot::first_output_line;
use serde::Serialize;

/// The original `ProjectRepoBranchResult`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProjectRepoBranchResult {
    pub branch: String,
    pub commit: String,
    pub message: String,
}

/// A failed branch operation. `message` is the original error text (git's
/// stderr or the original English refusal).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteBranchError {
    /// `git push` was started: the remote may have applied the ref update even
    /// though the invocation failed (timeout, transport loss). `false` means
    /// nothing was sent to the remote for the ref update.
    pub pushed: bool,
    pub message: String,
}

impl std::fmt::Display for RemoteBranchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for RemoteBranchError {}

fn before_push(message: String) -> RemoteBranchError {
    RemoteBranchError {
        pushed: false,
        message,
    }
}

fn during_push(message: String) -> RemoteBranchError {
    RemoteBranchError {
        pushed: true,
        message,
    }
}

/// The original branch input normalization: [`clean_branch`] plus git's
/// `check-ref-format` component rules that matter for a pushed ref.
pub fn normalize_branch(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.starts_with("refs/") && !value.starts_with("refs/heads/") {
        return Err(format!("Invalid {label} branch."));
    }
    let branch =
        clean_branch(Some(value.to_string())).ok_or_else(|| format!("Invalid {label} branch."))?;
    if branch.ends_with('.')
        || branch.ends_with(".lock")
        || branch.contains("//")
        || branch
            .split('/')
            .any(|component| component.starts_with('.'))
    {
        return Err(format!("Invalid {label} branch."));
    }
    Ok(branch)
}

/// The original commit input normalization: SHA-1 or SHA-256 hex, lowercased.
pub fn normalize_commit(value: &str, label: &str) -> Result<String, String> {
    clean_commit(Some(value.trim().to_ascii_lowercase()))
        .ok_or_else(|| format!("Invalid {label} commit."))
}

fn remote_head_branch(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let target = line.strip_prefix("ref: ")?.strip_suffix("\tHEAD")?;
        let branch = target.strip_prefix("refs/heads/")?;
        clean_branch(Some(branch.to_string()))
    })
}

/// Creates `new_branch` at `expected_commit`, which must still be the head of
/// `source_branch`. The empty lease refuses to overwrite an existing branch.
pub fn create_remote_branch_blocking(
    clone_url: &str,
    source_branch: &str,
    expected_commit: &str,
    new_branch: &str,
    auth: &GitAuthConfig,
) -> Result<ProjectRepoBranchResult, RemoteBranchError> {
    let temp_dir =
        tempfile::tempdir().map_err(|error| before_push(format!("create temp dir: {error}")))?;
    let repo_dir = temp_dir.path().join("repo.git");
    let repo_path = repo_dir
        .to_str()
        .ok_or_else(|| before_push("temporary repository path is not UTF-8".to_string()))?;
    run_git(&["init", "--bare", "--", repo_path], None, auth).map_err(before_push)?;
    run_git(
        &["remote", "add", "--", "origin", clone_url],
        Some(&repo_dir),
        auth,
    )
    .map_err(before_push)?;
    run_git(
        &[
            "fetch",
            "--quiet",
            "--depth=1",
            "--no-tags",
            "--end-of-options",
            "origin",
            format!("refs/heads/{source_branch}").as_str(),
        ],
        Some(&repo_dir),
        auth,
    )
    .map_err(before_push)?;
    let source_commit = run_git(&["rev-parse", "FETCH_HEAD"], Some(&repo_dir), auth)
        .ok()
        .and_then(|output| first_output_line(&output))
        .ok_or_else(|| before_push("Could not resolve the source branch.".to_string()))?
        .to_ascii_lowercase();
    if source_commit != expected_commit {
        return Err(before_push(
            "The source branch changed. Refresh the repository before creating a branch."
                .to_string(),
        ));
    }
    let lease = format!("--force-with-lease=refs/heads/{new_branch}:");
    let refspec = format!("{source_commit}:refs/heads/{new_branch}");
    run_git(
        &[
            "push",
            lease.as_str(),
            "--end-of-options",
            "origin",
            refspec.as_str(),
        ],
        Some(&repo_dir),
        auth,
    )
    .map_err(during_push)?;

    Ok(ProjectRepoBranchResult {
        branch: new_branch.to_string(),
        commit: source_commit,
        message: format!("Created branch {new_branch} from {source_branch}."),
    })
}

/// Deletes `branch` only while it still points at `expected_commit`; the
/// repository's default branch is refused.
pub fn delete_remote_branch_blocking(
    clone_url: &str,
    branch: &str,
    expected_commit: &str,
    auth: &GitAuthConfig,
) -> Result<ProjectRepoBranchResult, RemoteBranchError> {
    let head_output = run_git(
        &[
            "ls-remote",
            "--symref",
            "--exit-code",
            "--end-of-options",
            clone_url,
            "HEAD",
        ],
        None,
        auth,
    )
    .map_err(before_push)?;
    if remote_head_branch(&head_output).as_deref() == Some(branch) {
        return Err(before_push(
            "The repository's default branch cannot be deleted.".to_string(),
        ));
    }

    let temp_dir =
        tempfile::tempdir().map_err(|error| before_push(format!("create temp dir: {error}")))?;
    let repo_dir = temp_dir.path().join("repo.git");
    let repo_path = repo_dir
        .to_str()
        .ok_or_else(|| before_push("temporary repository path is not UTF-8".to_string()))?;
    run_git(&["init", "--bare", "--", repo_path], None, auth).map_err(before_push)?;
    run_git(
        &["remote", "add", "--", "origin", clone_url],
        Some(&repo_dir),
        auth,
    )
    .map_err(before_push)?;
    let lease = format!("--force-with-lease=refs/heads/{branch}:{expected_commit}");
    let refspec = format!(":refs/heads/{branch}");
    run_git(
        &[
            "push",
            lease.as_str(),
            "--end-of-options",
            "origin",
            refspec.as_str(),
        ],
        Some(&repo_dir),
        auth,
    )
    .map_err(during_push)?;

    Ok(ProjectRepoBranchResult {
        branch: branch.to_string(),
        commit: expected_commit.to_string(),
        message: format!("Deleted branch {branch}."),
    })
}

/// The commit `refs/heads/{branch}` points at in an `ls-remote` listing, or
/// `None` when the remote does not advertise that exact ref. A malformed object
/// id for the ref is an error, never an absent ref.
fn advertised_commit(output: &str, branch: &str) -> Result<Option<String>, String> {
    let name = format!("refs/heads/{branch}");
    for line in output.lines() {
        let Some((oid, advertised)) = line.trim_end().split_once('\t') else {
            continue;
        };
        if advertised == name {
            return clean_commit(Some(oid.to_ascii_lowercase()))
                .map(Some)
                .ok_or_else(|| format!("invalid object id advertised for {name}"));
        }
    }
    Ok(None)
}

/// Kailo (DD-118) reconciliation read: where `refs/heads/{branch}` points on
/// the remote right now (`None`: the branch does not exist). Uses the same
/// authentication as the push, so the remote answers for the same identity.
pub fn remote_branch_commit(
    clone_url: &str,
    branch: &str,
    auth: &GitAuthConfig,
) -> Result<Option<String>, String> {
    let name = format!("refs/heads/{branch}");
    let args = ["ls-remote", "--end-of-options", clone_url, name.as_str()];
    let output = run_git(&args, None, auth)?;
    advertised_commit(&output, branch)
}

#[cfg(test)]
mod tests {
    use super::{
        advertised_commit, create_remote_branch_blocking, delete_remote_branch_blocking,
        normalize_branch, normalize_commit, remote_branch_commit, remote_head_branch,
    };
    use crate::exec::{run_git, test_auth_config, GitAuth, GitAuthConfig};

    fn build_test_git_auth_config() -> GitAuthConfig {
        test_auth_config(GitAuth::CredentialHelper {
            helper: None,
            nsec: String::new(),
        })
    }

    #[test]
    fn branch_inputs_use_conservative_git_validation() {
        assert_eq!(
            normalize_branch("refs/heads/feature/demo", "source"),
            Ok("feature/demo".to_string())
        );
        assert!(normalize_branch("--upload-pack=/tmp/evil", "new").is_err());
        assert!(normalize_branch("feature/../main", "new").is_err());
        assert!(normalize_branch("refs/tags/v1", "new").is_err());
        assert!(normalize_branch("feature//demo", "new").is_err());
        assert!(normalize_branch("feature/.hidden", "new").is_err());
        assert!(normalize_branch("feature/demo.lock", "new").is_err());
    }

    #[test]
    fn commit_inputs_accept_sha1_and_sha256() {
        assert_eq!(
            normalize_commit(&"A".repeat(40), "source"),
            Ok("a".repeat(40))
        );
        assert_eq!(
            normalize_commit(&"B".repeat(64), "branch"),
            Ok("b".repeat(64))
        );
        assert!(normalize_commit("not-a-commit", "source").is_err());
    }

    #[test]
    fn remote_head_parser_only_accepts_branch_symrefs() {
        assert_eq!(
            remote_head_branch(
                "ref: refs/heads/main\tHEAD\n0123456789012345678901234567890123456789\tHEAD\n"
            ),
            Some("main".to_string())
        );
        assert_eq!(remote_head_branch("0123\tHEAD\n"), None);
        assert_eq!(remote_head_branch("ref: refs/tags/v1\tHEAD\n"), None);
    }

    #[test]
    fn advertised_commit_matches_only_the_exact_branch_ref() {
        let a = "a".repeat(40);
        let b = "B".repeat(64);
        let listing = format!(
            "{a}\trefs/remotes/x/refs/heads/demo\n{b}\trefs/heads/demo\n{a}\trefs/heads/demo2\n"
        );
        assert_eq!(
            advertised_commit(&listing, "demo"),
            Ok(Some("b".repeat(64)))
        );
        assert_eq!(advertised_commit(&listing, "other"), Ok(None));
        assert_eq!(advertised_commit("", "demo"), Ok(None));
        assert!(advertised_commit("zz\trefs/heads/demo\n", "demo").is_err());
    }

    #[test]
    fn remote_branch_create_and_delete_round_trip() {
        let auth = build_test_git_auth_config();
        let root = tempfile::tempdir().expect("create test directory");
        let remote = root.path().join("remote.git");
        let worktree = root.path().join("worktree");
        let remote_path = remote.to_str().expect("remote path");
        let worktree_path = worktree.to_str().expect("worktree path");

        run_git(&["init", "--bare", "--", remote_path], None, &auth).expect("init remote");
        run_git(&["init", "--", worktree_path], None, &auth).expect("init worktree");
        std::fs::write(worktree.join("README.md"), "branch test\n").expect("write fixture");
        run_git(&["add", "README.md"], Some(&worktree), &auth).expect("stage fixture");
        run_git(
            &[
                "-c",
                "user.name=Buzz Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "Initial commit",
            ],
            Some(&worktree),
            &auth,
        )
        .expect("commit fixture");
        run_git(&["branch", "-M", "main"], Some(&worktree), &auth).expect("rename branch");
        run_git(
            &["remote", "add", "origin", remote_path],
            Some(&worktree),
            &auth,
        )
        .expect("add remote");
        run_git(&["push", "origin", "main"], Some(&worktree), &auth).expect("push main");
        run_git(
            &[
                format!("--git-dir={remote_path}").as_str(),
                "symbolic-ref",
                "HEAD",
                "refs/heads/main",
            ],
            None,
            &auth,
        )
        .expect("set remote HEAD");
        let commit = run_git(&["rev-parse", "HEAD"], Some(&worktree), &auth)
            .expect("resolve fixture commit")
            .trim()
            .to_string();

        assert_eq!(
            remote_branch_commit(remote_path, "feature/demo", &auth),
            Ok(None)
        );
        let created =
            create_remote_branch_blocking(remote_path, "main", &commit, "feature/demo", &auth)
                .expect("create remote branch");
        assert_eq!(created.branch, "feature/demo");
        assert!(run_git(
            &[
                format!("--git-dir={remote_path}").as_str(),
                "show-ref",
                "--verify",
                "refs/heads/feature/demo",
            ],
            None,
            &auth,
        )
        .is_ok());
        assert_eq!(
            remote_branch_commit(remote_path, "feature/demo", &auth),
            Ok(Some(commit.clone()))
        );
        // The empty lease refuses to overwrite the branch it just created.
        let again =
            create_remote_branch_blocking(remote_path, "main", &commit, "feature/demo", &auth)
                .expect_err("existing branch is not overwritten");
        assert!(again.pushed);

        delete_remote_branch_blocking(remote_path, "feature/demo", &commit, &auth)
            .expect("delete remote branch");
        assert!(run_git(
            &[
                format!("--git-dir={remote_path}").as_str(),
                "show-ref",
                "--verify",
                "refs/heads/feature/demo",
            ],
            None,
            &auth,
        )
        .is_err());
        let default_branch = delete_remote_branch_blocking(remote_path, "main", &commit, &auth)
            .expect_err("default branch is kept");
        assert!(!default_branch.pushed);
        let moved = create_remote_branch_blocking(
            remote_path,
            "main",
            &"0".repeat(40),
            "feature/demo",
            &auth,
        )
        .expect_err("moved source is refused");
        assert!(!moved.pushed);
    }
}
