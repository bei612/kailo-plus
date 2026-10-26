//! Fixed Buzz 779af8886caae1317b4de962082429867ab61503
//! desktop/src-tauri/src/commands/project_git_diff.rs (`diff_from_repo`, its
//! remote helpers and the blocking body of `get_project_repo_diff`). The
//! local-checkout range helpers stay with the local commands.

use crate::exec::{clean_branch, run_git, GitAuthConfig};
use serde::Serialize;

/// Per-file cap on rendered patch lines. One regenerated lockfile or
/// minified bundle would otherwise produce tens of thousands of DOM nodes
/// in the diff view and freeze the webview.
pub const MAX_PATCH_LINES: usize = 2_000;

/// One changed file with its (possibly truncated) patch.
#[derive(Serialize)]
pub struct ProjectRepoDiffFileInfo {
    pub path: String,
    pub additions: usize,
    pub deletions: usize,
    pub patch: String,
    pub truncated: bool,
}

/// The original `get_project_repo_diff` result.
#[derive(Serialize)]
pub struct ProjectRepoDiffInfo {
    pub files: Vec<ProjectRepoDiffFileInfo>,
    pub additions: usize,
    pub deletions: usize,
    pub commit_body: Option<String>,
}

fn clean_target_ref(value: Option<String>) -> Option<String> {
    value.filter(|value| {
        value.starts_with("refs/")
            && !value.contains("..")
            && value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '.' | '-'))
    })
}

pub(crate) fn clean_commit(value: Option<String>) -> Option<String> {
    value
        .filter(|value| matches!(value.len(), 40 | 64))
        .filter(|value| value.chars().all(|c| c.is_ascii_hexdigit()))
}

fn fetch_target(
    repo_dir: &std::path::Path,
    auth: &GitAuthConfig,
    branch: Option<&str>,
    target_ref: Option<&str>,
    target_commit: Option<&str>,
) -> Result<(), String> {
    if let Some(target_ref) = target_ref {
        if run_git(
            &["fetch", "--depth=100", "origin", target_ref],
            Some(repo_dir),
            auth,
        )
        .is_ok()
        {
            run_git(
                &["checkout", "--detach", "FETCH_HEAD"],
                Some(repo_dir),
                auth,
            )?;
            return Ok(());
        }
    } else if let Some(target_commit) = target_commit {
        if run_git(
            &["fetch", "--depth=100", "origin", target_commit],
            Some(repo_dir),
            auth,
        )
        .is_ok()
        {
            run_git(
                &["checkout", "--detach", "FETCH_HEAD"],
                Some(repo_dir),
                auth,
            )?;
            return Ok(());
        }
    }

    if let Some(target_commit) = target_commit {
        if run_git(
            &["fetch", "--depth=100", "origin", target_commit],
            Some(repo_dir),
            auth,
        )
        .is_ok()
        {
            run_git(
                &["checkout", "--detach", "FETCH_HEAD"],
                Some(repo_dir),
                auth,
            )?;
            return Ok(());
        }
    }

    if let Some(branch) = branch {
        let refspec = format!("refs/heads/{branch}:refs/remotes/origin/{branch}");
        run_git(
            &["fetch", "--depth=100", "origin", &refspec],
            Some(repo_dir),
            auth,
        )?;
        run_git(
            &["checkout", "--detach", &format!("origin/{branch}")],
            Some(repo_dir),
            auth,
        )?;
        return Ok(());
    }

    run_git(
        &["fetch", "--depth=100", "origin", "HEAD"],
        Some(repo_dir),
        auth,
    )?;
    run_git(
        &["checkout", "--detach", "FETCH_HEAD"],
        Some(repo_dir),
        auth,
    )?;
    Ok(())
}

fn diff_base_ref(
    repo_dir: &std::path::Path,
    auth: &GitAuthConfig,
    base_branch: Option<&str>,
) -> Option<String> {
    let base_branch = base_branch?;
    let refspec = format!("refs/heads/{base_branch}:refs/remotes/origin/{base_branch}");
    run_git(
        &["fetch", "--depth=100", "origin", &refspec],
        Some(repo_dir),
        auth,
    )
    .ok()?;
    Some(format!("origin/{base_branch}"))
}

fn parse_count(value: &str) -> usize {
    value.parse::<usize>().unwrap_or_default()
}

fn parse_numstat(output: &str) -> Vec<(String, usize, usize)> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let additions = parse_count(parts.next()?);
            let deletions = parse_count(parts.next()?);
            let path = parts.next()?.to_string();
            Some((path, additions, deletions))
        })
        .take(250)
        .collect()
}

pub(crate) fn empty_tree_ref(
    repo_dir: &std::path::Path,
    auth: &GitAuthConfig,
) -> Result<String, String> {
    run_git(
        &["hash-object", "-t", "tree", "/dev/null"],
        Some(repo_dir),
        auth,
    )
    .map(|output| output.trim().to_string())
}

fn diff_range(
    repo_dir: &std::path::Path,
    auth: &GitAuthConfig,
    base_ref: Option<String>,
) -> String {
    if let Some(base_ref) = base_ref {
        return if run_git(&["merge-base", &base_ref, "HEAD"], Some(repo_dir), auth).is_ok() {
            format!("{base_ref}...HEAD")
        } else {
            format!("{base_ref}..HEAD")
        };
    }

    empty_tree_ref(repo_dir, auth)
        .map(|empty_tree| format!("{empty_tree}..HEAD"))
        .unwrap_or_else(|_| "HEAD^..HEAD".to_string())
}

/// Range for a single commit against its parent, used by the commit detail
/// view. Root commits fall back to the empty tree so the whole initial tree
/// renders as additions. Errors when the commit is not reachable in the
/// available history — diffing an unrelated ref instead would be misleading.
pub(crate) fn commit_parent_range(
    repo_dir: &std::path::Path,
    auth: &GitAuthConfig,
    commit: &str,
) -> Result<String, String> {
    run_git(
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{commit}^{{commit}}"),
        ],
        Some(repo_dir),
        auth,
    )
    .map_err(|_| format!("commit {commit} was not found in the repository history"))?;
    let parent = format!("{commit}^");
    if run_git(
        &["rev-parse", "--verify", "--quiet", &parent],
        Some(repo_dir),
        auth,
    )
    .is_ok()
    {
        return Ok(format!("{parent}..{commit}"));
    }
    let empty_tree = empty_tree_ref(repo_dir, auth)?;
    Ok(format!("{empty_tree}..{commit}"))
}

/// Caps a patch at [`MAX_PATCH_LINES`], reporting whether it was cut.
fn truncate_patch(patch: String) -> (String, bool) {
    let mut line_starts = patch
        .char_indices()
        .filter(|(_, c)| *c == '\n')
        .map(|(index, _)| index);
    match line_starts.nth(MAX_PATCH_LINES - 1) {
        Some(cut_at) => (patch[..cut_at].to_string(), true),
        None => (patch, false),
    }
}

pub(crate) fn diff_from_repo(
    repo_dir: &std::path::Path,
    auth: &GitAuthConfig,
    range: &str,
    target_commit: Option<&str>,
) -> Result<ProjectRepoDiffInfo, String> {
    let commit_body = target_commit
        .map(|commit| {
            run_git(
                &[
                    "show",
                    "--no-patch",
                    "--format=%b",
                    "--end-of-options",
                    commit,
                ],
                Some(repo_dir),
                auth,
            )
            .map(|body| body.trim_end().to_string())
        })
        .transpose()?
        .filter(|body| !body.is_empty());
    let numstat = run_git(&["diff", "--numstat", range], Some(repo_dir), auth)?;
    let files = parse_numstat(&numstat)
        .into_iter()
        .map(|(path, additions, deletions)| {
            let patch = run_git(
                &[
                    "diff",
                    "--no-ext-diff",
                    "--find-renames",
                    "--find-copies",
                    "--unified=80",
                    "--src-prefix=a/",
                    "--dst-prefix=b/",
                    range,
                    "--",
                    &path,
                ],
                Some(repo_dir),
                auth,
            )
            .unwrap_or_default();
            let (patch, truncated) = truncate_patch(patch);
            ProjectRepoDiffFileInfo {
                path,
                additions,
                deletions,
                patch,
                truncated,
            }
        })
        .collect::<Vec<_>>();
    Ok(ProjectRepoDiffInfo {
        additions: files.iter().map(|file| file.additions).sum(),
        deletions: files.iter().map(|file| file.deletions).sum(),
        commit_body,
        files,
    })
}

/// Blocking body of the original `get_project_repo_diff`: a fresh temporary
/// partial clone, the requested target, then the bounded per-file patches.
///
/// Kailo: a patch whose `git diff` timed out is swallowed into an empty patch
/// by the original; when the request deadline expired meanwhile, a timeout is
/// returned instead so an emptied diff is never presented as complete.
pub fn project_repo_diff(
    clone_url: &str,
    default_branch: Option<String>,
    base_branch: Option<String>,
    target_ref: Option<String>,
    target_commit: Option<String>,
    auth: &GitAuthConfig,
) -> Result<ProjectRepoDiffInfo, String> {
    let branch = clean_branch(default_branch);
    let base_branch = clean_branch(base_branch);
    let target_ref = clean_target_ref(target_ref);
    let target_commit = clean_commit(target_commit);

    let temp_dir = tempfile::tempdir().map_err(|error| format!("create temp dir: {error}"))?;
    let repo_dir = temp_dir.path().join("repo");
    let repo_path = repo_dir
        .to_str()
        .ok_or_else(|| "temporary repository path is not UTF-8".to_string())?;
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
    fetch_target(
        &repo_dir,
        auth,
        branch.as_deref(),
        target_ref.as_deref(),
        target_commit.as_deref(),
    )?;
    // A commit with no base branch or target ref means "diff this commit
    // against its parent" (commit detail view), not "diff HEAD against a
    // base".
    let range = match (&target_ref, &base_branch, &target_commit) {
        (None, None, Some(commit)) => commit_parent_range(&repo_dir, auth, commit)?,
        _ => diff_range(
            &repo_dir,
            auth,
            diff_base_ref(&repo_dir, auth, base_branch.as_deref()),
        ),
    };
    let commit_body_ref = if target_ref.is_none() && base_branch.is_none() {
        target_commit.as_deref()
    } else {
        None
    };
    let diff = diff_from_repo(&repo_dir, auth, &range, commit_body_ref)?;
    auth.check_deadline()?;
    Ok(diff)
}

#[cfg(test)]
mod tests {
    use super::{clean_commit, clean_target_ref, parse_numstat, truncate_patch, MAX_PATCH_LINES};

    #[test]
    fn truncate_patch_caps_lines_and_reports_truncation() {
        let short = "a\nb\n".to_string();
        assert_eq!(truncate_patch(short.clone()), (short, false));
        let long = "line\n".repeat(MAX_PATCH_LINES + 5);
        let (patch, truncated) = truncate_patch(long);
        assert!(truncated);
        assert_eq!(patch.lines().count(), MAX_PATCH_LINES);
    }

    #[test]
    fn parse_numstat_keeps_the_original_file_bound() {
        let output = (0..300)
            .map(|index| format!("1\t2\tfile-{index}.txt"))
            .collect::<Vec<_>>()
            .join("\n");
        let files = parse_numstat(&output);
        assert_eq!(files.len(), 250);
        assert_eq!(files[0], ("file-0.txt".to_string(), 1, 2));
        let binary = parse_numstat("-\t-\timage.png");
        assert_eq!(binary, vec![("image.png".to_string(), 0, 0)]);
    }

    #[test]
    fn diff_target_refs_and_commits_are_allowlisted() {
        assert_eq!(
            clean_target_ref(Some("refs/heads/main".into())),
            Some("refs/heads/main".to_string())
        );
        assert_eq!(clean_target_ref(Some("main".into())), None);
        assert_eq!(clean_target_ref(Some("refs/../x".into())), None);
        assert_eq!(clean_target_ref(Some("refs/x;y".into())), None);
        let commit = "a".repeat(40);
        assert_eq!(clean_commit(Some(commit.clone())), Some(commit));
        assert_eq!(clean_commit(Some("abc".into())), None);
        assert_eq!(clean_commit(Some("g".repeat(40))), None);
    }
}
