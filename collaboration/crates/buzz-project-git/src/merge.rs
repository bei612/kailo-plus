//! Authenticated pull-request merge for Projects repositories.
//!
//! Fixed Buzz 779af8886caae1317b4de962082429867ab61503
//! desktop/src-tauri/src/commands/project_git_workflow.rs
//! (`merge_project_pull_request`: a temporary clone of the target branch, a
//! fetch of the review branch, the expected-head check, `git merge --no-edit`
//! and the push to the target branch) and project_git_merge_error.rs
//! (`classify_merge_error`). The Tauri command, its owner-identity lookup and
//! the signed 1631 status stay with their callers.
//!
//! Kailo (DD-118 / DD-81): the original runs as one step; here it is split at
//! the push. [`prepare_merge_blocking`] merges in the temporary clone and keeps
//! it alive in a [`PreparedMerge`] that names the target head it merged onto
//! (old) and the resulting commit (new), so the caller records that ref update
//! before [`push_merge_blocking`] sends it with a lease on the old head. The
//! caller fixes author, committer and time ([`MergeAuthor`]), so the same
//! inputs make the same merge commit when a not-delivered update is sent
//! again. The Desktop terminal recovery of a conflict is not part of this
//! crate, nor is the Desktop-only channel-binding refusal text.

use crate::exec::{is_timeout_error, run_git, run_git_with_env, GitAuthConfig};
use crate::snapshot::first_output_line;
use std::path::{Path, PathBuf};

/// The original author name when no other name is known.
const DEFAULT_AUTHOR_NAME: &str = "Buzz User";
/// Bound on the author name handed to git.
const MAX_AUTHOR_NAME_CHARS: usize = 128;
/// Prefix of the original `merge_failed` message for a failed `git merge`.
pub const MERGE_FAILED_PREFIX: &str = "Pull request merge failed:";
/// The original `branch_changed` message.
const BRANCH_CHANGED: &str =
    "The pull request branch changed. Refresh the pull request before merging.";

/// Who the merge commit names as author and committer, and when.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeAuthor {
    pub name: String,
    pub email: String,
    /// Unix seconds, used as both author and committer date.
    pub time: i64,
}

/// The original machine-readable merge failure codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MergeErrorCode {
    /// `branch_changed`: the review branch no longer points at the expected
    /// commit.
    BranchChanged,
    /// `merge_conflict`: `git merge` stopped on conflicting paths.
    Conflict,
    /// `merge_failed`: anything else, with git's own words.
    Failed,
}

impl MergeErrorCode {
    /// The original code string.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::BranchChanged => "branch_changed",
            Self::Conflict => "merge_conflict",
            Self::Failed => "merge_failed",
        }
    }
}

/// A failed merge or merge push.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeError {
    pub code: MergeErrorCode,
    /// The original message (git's stderr or the original English refusal).
    pub message: String,
    /// `git push` was started: the remote may have applied the ref update even
    /// though the invocation failed. `false` means nothing was sent.
    pub pushed: bool,
}

impl std::fmt::Display for MergeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for MergeError {}

impl From<String> for MergeError {
    fn from(message: String) -> Self {
        Self {
            code: MergeErrorCode::Failed,
            message,
            pushed: false,
        }
    }
}

/// Original `classify_merge_error`: only unmerged paths are a conflict. A
/// timeout keeps git's own words so callers can still tell it apart.
fn classify_merge_error(message: String, has_conflicts: bool) -> MergeError {
    if has_conflicts {
        MergeError {
            code: MergeErrorCode::Conflict,
            message: "Pull request has merge conflicts.".to_string(),
            pushed: false,
        }
    } else if is_timeout_error(&message) {
        MergeError::from(message)
    } else {
        MergeError::from(format!("{MERGE_FAILED_PREFIX} {message}"))
    }
}

/// A display name git accepts as an ident name: no angle brackets or control
/// characters, none of the characters git strips from either end, bounded,
/// and the original default when nothing is left.
pub fn merge_author_name(display_name: &str) -> String {
    let crud = |c: char| c.is_whitespace() || ".,:;<>\"\\'".contains(c);
    let name = display_name
        .chars()
        .filter(|c| !c.is_control() && *c != '<' && *c != '>')
        .take(MAX_AUTHOR_NAME_CHARS)
        .collect::<String>();
    let name = name.trim_matches(crud);
    if name.is_empty() {
        DEFAULT_AUTHOR_NAME.to_string()
    } else {
        name.to_string()
    }
}

/// A merge commit that exists only in its temporary clone until pushed.
#[derive(Debug)]
pub struct PreparedMerge {
    /// Removed with the value.
    temp_dir: tempfile::TempDir,
    target_branch: String,
    /// The target head the merge was made on: the ref update's old side.
    pub target_commit: String,
    /// The merge result: the ref update's new side. Equal to `target_commit`
    /// when the review is already contained in the target branch.
    pub merge_commit: String,
}

impl PreparedMerge {
    fn repo_dir(&self) -> PathBuf {
        self.temp_dir.path().join("repo")
    }
}

fn resolve(repo_dir: &Path, name: &str, auth: &GitAuthConfig) -> Option<String> {
    run_git(&["rev-parse", name], Some(repo_dir), auth)
        .ok()
        .and_then(|output| first_output_line(&output))
        .map(|commit| commit.to_ascii_lowercase())
}

/// The original merge up to, not including, the push: clone `target_branch`,
/// fetch `source_branch`, require it to still be `expected_commit`, and merge
/// that commit as `author`. Branch names and the commit are expected already
/// normalized (`normalize_branch` / `normalize_commit`).
pub fn prepare_merge_blocking(
    clone_url: &str,
    target_branch: &str,
    source_branch: &str,
    expected_commit: &str,
    author: &MergeAuthor,
    auth: &GitAuthConfig,
) -> Result<PreparedMerge, MergeError> {
    let temp_dir = tempfile::tempdir().map_err(|error| format!("create temp dir: {error}"))?;
    let repo_dir = temp_dir.path().join("repo");
    let repo_path = repo_dir
        .to_str()
        .ok_or_else(|| "temporary repository path is not UTF-8".to_string())?;
    run_git(
        &[
            "clone",
            "--filter=blob:none",
            "--no-tags",
            "--branch",
            target_branch,
            "--single-branch",
            "--end-of-options",
            clone_url,
            repo_path,
        ],
        None,
        auth,
    )?;
    let target_commit = resolve(&repo_dir, "HEAD", auth)
        .ok_or_else(|| "Could not resolve the target branch.".to_string())?;
    let source_ref = format!("refs/heads/{source_branch}");
    run_git(
        &[
            "fetch",
            "--quiet",
            "--end-of-options",
            clone_url,
            source_ref.as_str(),
        ],
        Some(&repo_dir),
        auth,
    )?;
    let source_head = resolve(&repo_dir, "FETCH_HEAD", auth)
        .ok_or_else(|| "Could not resolve the pull request branch.".to_string())?;
    if source_head != expected_commit {
        return Err(MergeError {
            code: MergeErrorCode::BranchChanged,
            message: BRANCH_CHANGED.to_string(),
            pushed: false,
        });
    }

    let name = format!("user.name={}", author.name);
    let email = format!("user.email={}", author.email);
    let date = format!("@{} +0000", author.time);
    let env = [
        ("GIT_AUTHOR_DATE", date.as_str()),
        ("GIT_COMMITTER_DATE", date.as_str()),
    ];
    let merged = run_git_with_env(
        &[
            "-c",
            name.as_str(),
            "-c",
            email.as_str(),
            "merge",
            "--no-edit",
            "--end-of-options",
            expected_commit,
        ],
        Some(&repo_dir),
        auth,
        &env,
    );
    if let Err(error) = merged {
        let has_conflicts = run_git(
            &["diff", "--name-only", "--diff-filter=U"],
            Some(&repo_dir),
            auth,
        )
        .is_ok_and(|output| !output.trim().is_empty());
        return Err(classify_merge_error(error, has_conflicts));
    }
    let merge_commit = resolve(&repo_dir, "HEAD", auth)
        .ok_or_else(|| "Could not resolve the merge commit.".to_string())?;

    Ok(PreparedMerge {
        temp_dir,
        target_branch: target_branch.to_string(),
        target_commit,
        merge_commit,
    })
}

/// The original push of the merge to the target branch, leased on the head
/// the merge was made on: a target that moved meanwhile is refused, never
/// overwritten.
pub fn push_merge_blocking(
    prepared: &PreparedMerge,
    auth: &GitAuthConfig,
) -> Result<(), MergeError> {
    let branch = &prepared.target_branch;
    let old = &prepared.target_commit;
    let new = &prepared.merge_commit;
    let lease = format!("--force-with-lease=refs/heads/{branch}:{old}");
    let refspec = format!("{new}:refs/heads/{branch}");
    run_git(
        &[
            "push",
            lease.as_str(),
            "--end-of-options",
            "origin",
            refspec.as_str(),
        ],
        Some(&prepared.repo_dir()),
        auth,
    )
    .map(|_| ())
    .map_err(|message| MergeError {
        code: MergeErrorCode::Failed,
        message,
        pushed: true,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        classify_merge_error, merge_author_name, prepare_merge_blocking, push_merge_blocking,
        MergeAuthor, MergeErrorCode, MERGE_FAILED_PREFIX,
    };
    use crate::branches::remote_branch_commit;
    use crate::exec::{run_git, test_auth_config, GitAuth, GitAuthConfig};
    use std::path::Path;

    fn build_test_git_auth_config() -> GitAuthConfig {
        test_auth_config(GitAuth::CredentialHelper {
            helper: None,
            nsec: String::new(),
        })
    }

    fn commit_file(worktree: &Path, file: &str, text: &str, auth: &GitAuthConfig) -> String {
        std::fs::write(worktree.join(file), text).expect("write fixture");
        run_git(&["add", file], Some(worktree), auth).expect("stage fixture");
        run_git(
            &[
                "-c",
                "user.name=Buzz Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                file,
            ],
            Some(worktree),
            auth,
        )
        .expect("commit fixture");
        run_git(&["rev-parse", "HEAD"], Some(worktree), auth)
            .expect("resolve fixture commit")
            .trim()
            .to_string()
    }

    fn author() -> MergeAuthor {
        MergeAuthor {
            name: "Ada".to_string(),
            email: format!("{}@community.example", "a".repeat(64)),
            time: 1_700_000_000,
        }
    }

    #[test]
    fn merge_conflict_error_has_the_original_code_and_message() {
        let error = classify_merge_error(
            "CONFLICT (content): Merge conflict in src/main.rs".to_string(),
            true,
        );
        assert_eq!(error.code, MergeErrorCode::Conflict);
        assert_eq!(error.code.as_str(), "merge_conflict");
        assert_eq!(error.message, "Pull request has merge conflicts.");
        assert!(!error.pushed);
    }

    #[test]
    fn merge_error_classification_only_marks_conflicts() {
        let other = classify_merge_error(
            "fatal: refusing to merge unrelated histories".to_string(),
            false,
        );
        assert_eq!(other.code.as_str(), "merge_failed");
        assert!(other.message.starts_with(MERGE_FAILED_PREFIX));
        assert!(other.message.ends_with("unrelated histories"));
        let timeout = classify_merge_error("git timed out after 60s".to_string(), false);
        assert_eq!(timeout.code, MergeErrorCode::Failed);
        assert!(crate::is_timeout_error(&timeout.message));
        assert_eq!(MergeErrorCode::BranchChanged.as_str(), "branch_changed");
    }

    #[test]
    fn author_names_are_git_idents() {
        assert_eq!(merge_author_name("Ada Lovelace"), "Ada Lovelace");
        assert_eq!(merge_author_name(" <Ada> \n"), "Ada");
        assert_eq!(merge_author_name("\"Ada.\""), "Ada");
        assert_eq!(merge_author_name("<>"), "Buzz User");
        assert_eq!(merge_author_name(""), "Buzz User");
        assert_eq!(merge_author_name(&"x".repeat(300)).chars().count(), 128);
    }

    #[test]
    fn merge_is_prepared_recreated_and_pushed_with_a_lease() {
        let auth = build_test_git_auth_config();
        let root = tempfile::tempdir().expect("create test directory");
        let remote = root.path().join("remote.git");
        let worktree = root.path().join("worktree");
        let remote_path = remote.to_str().expect("remote path");
        let worktree_path = worktree.to_str().expect("worktree path");

        run_git(&["init", "--bare", "--", remote_path], None, &auth).expect("init remote");
        run_git(&["init", "--", worktree_path], None, &auth).expect("init worktree");
        let base = commit_file(&worktree, "README.md", "base\n", &auth);
        run_git(&["branch", "-M", "main"], Some(&worktree), &auth).expect("rename branch");
        run_git(&["checkout", "-b", "feature"], Some(&worktree), &auth).expect("branch");
        let feature = commit_file(&worktree, "feature.txt", "feature\n", &auth);
        run_git(&["checkout", "main"], Some(&worktree), &auth).expect("checkout main");
        let main = commit_file(&worktree, "main.txt", "main\n", &auth);
        run_git(
            &["remote", "add", "origin", remote_path],
            Some(&worktree),
            &auth,
        )
        .expect("add remote");
        run_git(
            &["push", "origin", "main", "feature"],
            Some(&worktree),
            &auth,
        )
        .expect("push branches");

        let moved_branch =
            prepare_merge_blocking(remote_path, "main", "feature", &base, &author(), &auth)
                .expect_err("a moved review branch is refused");
        assert_eq!(moved_branch.code, MergeErrorCode::BranchChanged);
        assert!(!moved_branch.pushed);

        let prepared =
            prepare_merge_blocking(remote_path, "main", "feature", &feature, &author(), &auth)
                .expect("prepare merge");
        assert_eq!(prepared.target_commit, main);
        assert_ne!(prepared.merge_commit, main);
        // Frozen inputs make the same merge commit again; another time does not.
        let again_merge =
            prepare_merge_blocking(remote_path, "main", "feature", &feature, &author(), &auth)
                .expect("prepare merge again");
        assert_eq!(again_merge.merge_commit, prepared.merge_commit);
        let later = MergeAuthor {
            time: 1_700_000_100,
            ..author()
        };
        let stale_merge =
            prepare_merge_blocking(remote_path, "main", "feature", &feature, &later, &auth)
                .expect("prepare a later merge");
        assert_ne!(stale_merge.merge_commit, prepared.merge_commit);

        assert_eq!(
            remote_branch_commit(remote_path, "main", &auth),
            Ok(Some(main.clone()))
        );
        push_merge_blocking(&prepared, &auth).expect("push merge");
        assert_eq!(
            remote_branch_commit(remote_path, "main", &auth),
            Ok(Some(prepared.merge_commit.clone()))
        );
        let format = "--format=%an <%ae> %at %cn <%ce> %ct";
        let ident = run_git(&["log", "-1", format, "main"], Some(&remote), &auth)
            .expect("read merge commit");
        let email = author().email;
        let expected = format!("Ada <{email}> 1700000000 Ada <{email}> 1700000000");
        assert_eq!(ident.trim(), expected);

        // A merge made on the old head is refused by its lease.
        let refused = push_merge_blocking(&stale_merge, &auth).expect_err("target moved");
        assert!(refused.pushed);
        assert_eq!(refused.code, MergeErrorCode::Failed);

        // Already merged: the original "Already up to date" leaves old == new.
        let contained =
            prepare_merge_blocking(remote_path, "main", "feature", &feature, &author(), &auth)
                .expect("prepare a contained merge");
        assert_eq!(contained.target_commit, prepared.merge_commit);
        assert_eq!(contained.merge_commit, contained.target_commit);
        push_merge_blocking(&contained, &auth).expect("an up-to-date push is a no-op");
    }

    #[test]
    fn conflicting_changes_are_a_merge_conflict() {
        let auth = build_test_git_auth_config();
        let root = tempfile::tempdir().expect("create test directory");
        let remote = root.path().join("remote.git");
        let worktree = root.path().join("worktree");
        let remote_path = remote.to_str().expect("remote path");
        let worktree_path = worktree.to_str().expect("worktree path");

        run_git(&["init", "--bare", "--", remote_path], None, &auth).expect("init remote");
        run_git(&["init", "--", worktree_path], None, &auth).expect("init worktree");
        commit_file(&worktree, "README.md", "base\n", &auth);
        run_git(&["branch", "-M", "main"], Some(&worktree), &auth).expect("rename branch");
        run_git(&["checkout", "-b", "feature"], Some(&worktree), &auth).expect("branch");
        let feature = commit_file(&worktree, "README.md", "feature\n", &auth);
        run_git(&["checkout", "main"], Some(&worktree), &auth).expect("checkout main");
        commit_file(&worktree, "README.md", "main\n", &auth);
        run_git(
            &["remote", "add", "origin", remote_path],
            Some(&worktree),
            &auth,
        )
        .expect("add remote");
        run_git(
            &["push", "origin", "main", "feature"],
            Some(&worktree),
            &auth,
        )
        .expect("push branches");

        let conflict =
            prepare_merge_blocking(remote_path, "main", "feature", &feature, &author(), &auth)
                .expect_err("conflicting merge is refused");
        assert_eq!(conflict.code, MergeErrorCode::Conflict);
        assert!(!conflict.pushed);
    }
}
