//! Fixed Buzz 779af8886caae1317b4de962082429867ab61503
//! desktop/src-tauri/src/commands/project_git.rs (`snapshot_from_repo`, its
//! parsers, `MAX_EAGER_FILE_PREVIEWS` and the blocking body of
//! `get_project_repo_snapshot`). Tests from project_git_tests.rs.

use crate::exec::{clean_branch, clean_target_ref, run_git, GitAuthConfig};
use crate::file_content::{checkout_project_repo, clean_target_commit, read_preview_content};
use crate::types::{
    ProjectRepoCommitInfo, ProjectRepoContributorInfo, ProjectRepoFileInfo, ProjectRepoSnapshotInfo,
};

/// Bound eager content without truncating the repository tree.
pub const MAX_EAGER_FILE_PREVIEWS: usize = 250;

fn parse_latest_commit(output: &str) -> Option<ProjectRepoCommitInfo> {
    let line = output.lines().next()?;
    let mut parts = line.split('\0');
    let hash = parts.next()?.to_string();
    let short_hash = parts.next()?.to_string();
    let author_name = parts.next()?.to_string();
    let author_email = parts.next()?.to_string();
    let timestamp = parts.next()?.parse::<i64>().ok()?;
    let subject = parts.next().unwrap_or_default().to_string();

    Some(ProjectRepoCommitInfo {
        hash,
        short_hash,
        author_name,
        author_email,
        timestamp,
        subject,
    })
}

pub(crate) fn first_output_line(output: &str) -> Option<String> {
    output
        .lines()
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_commits(output: &str) -> Vec<ProjectRepoCommitInfo> {
    output
        .lines()
        .filter_map(parse_latest_commit)
        .take(50)
        .collect()
}

fn parse_contributors(output: &str) -> Vec<ProjectRepoContributorInfo> {
    let mut contributors: std::collections::HashMap<String, ProjectRepoContributorInfo> =
        std::collections::HashMap::new();

    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let mut parts = line.split('\0');
        let name = parts.next().unwrap_or_default().trim().to_string();
        let email = parts.next().unwrap_or_default().trim().to_string();
        let timestamp = parts
            .next()
            .and_then(|value| value.trim().parse::<i64>().ok())
            .unwrap_or_default();
        if name.is_empty() && email.is_empty() {
            continue;
        }

        let key = if email.is_empty() {
            name.to_lowercase()
        } else {
            email.to_lowercase()
        };
        contributors
            .entry(key)
            .and_modify(|contributor| {
                contributor.commit_count += 1;
                contributor.last_commit_at = contributor.last_commit_at.max(timestamp);
            })
            .or_insert(ProjectRepoContributorInfo {
                name,
                email,
                commit_count: 1,
                last_commit_at: timestamp,
            });
    }

    let mut contributors = contributors.into_values().collect::<Vec<_>>();
    contributors.sort_by(|left, right| {
        right
            .commit_count
            .cmp(&left.commit_count)
            .then_with(|| right.last_commit_at.cmp(&left.last_commit_at))
            .then_with(|| left.name.cmp(&right.name))
    });
    contributors.truncate(50);
    contributors
}

fn parse_latest_commit_by_path(
    output: &str,
) -> std::collections::HashMap<String, ProjectRepoCommitInfo> {
    let mut current_commit = None;
    let mut result = std::collections::HashMap::new();

    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        if line.contains('\0') {
            current_commit = parse_latest_commit(line);
            continue;
        }

        if let Some(commit) = &current_commit {
            result
                .entry(line.to_string())
                .or_insert_with(|| commit.clone());
        }
    }

    result
}

fn normalize_branch_name(branch: &str) -> &str {
    branch
        .trim()
        .strip_prefix("refs/heads/")
        .unwrap_or_else(|| branch.trim())
}

fn branch_activity_range(
    repo_dir: &std::path::Path,
    auth: &GitAuthConfig,
    branch_name: Option<&str>,
    base_branch: Option<&str>,
) -> Option<String> {
    let branch_name = branch_name.map(normalize_branch_name)?;
    let base_branch = base_branch.map(normalize_branch_name)?;

    if branch_name.is_empty() || base_branch.is_empty() || branch_name == base_branch {
        return None;
    }

    let remote_base_ref = format!("refs/remotes/origin/{base_branch}");
    if run_git(
        &["rev-parse", "--verify", "--quiet", remote_base_ref.as_str()],
        Some(repo_dir),
        auth,
    )
    .is_err()
    {
        return None;
    }

    Some(format!("origin/{base_branch}..HEAD"))
}

fn parse_ls_tree(
    repo_dir: &std::path::Path,
    output: &str,
    latest_commit_by_path: &std::collections::HashMap<String, ProjectRepoCommitInfo>,
) -> Vec<ProjectRepoFileInfo> {
    let mut blob_index = 0;
    output
        .lines()
        .filter_map(|line| {
            let (meta, path) = line.split_once('\t')?;
            let mut parts = meta.split_whitespace();
            let _mode = parts.next()?;
            let kind = parts.next()?.to_string();
            let _object = parts.next()?;
            let size = parts.next().and_then(|value| value.parse::<u64>().ok());
            if kind == "blob" {
                blob_index += 1;
            }
            let preview_content = (kind == "blob" && blob_index <= MAX_EAGER_FILE_PREVIEWS)
                .then(|| read_preview_content(repo_dir, path, size))
                .flatten();
            Some(ProjectRepoFileInfo {
                path: path.to_string(),
                kind,
                size,
                preview_content,
                last_changed_at: latest_commit_by_path
                    .get(path)
                    .map(|commit| commit.timestamp),
                latest_commit: latest_commit_by_path.get(path).cloned(),
            })
        })
        .collect()
}

fn snapshot_from_repo(
    repo_dir: &std::path::Path,
    auth: &GitAuthConfig,
    branch_name: Option<&str>,
    base_branch: Option<&str>,
) -> ProjectRepoSnapshotInfo {
    let latest_commit = run_git(
        &["log", "-1", "--format=%H%x00%h%x00%an%x00%ae%x00%at%x00%s"],
        Some(repo_dir),
        auth,
    )
    .ok()
    .and_then(|output| parse_latest_commit(&output));
    let branch_activity_range = branch_activity_range(repo_dir, auth, branch_name, base_branch);
    let branch_activity_ref = branch_activity_range.as_deref().unwrap_or("HEAD");
    let (commits, contributors) = if latest_commit.is_some() {
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
        .unwrap_or_default();
        let contributors = run_git(
            &["log", "--format=%an%x00%ae%x00%at", branch_activity_ref],
            Some(repo_dir),
            auth,
        )
        .map(|output| parse_contributors(&output))
        .unwrap_or_default();
        (commits, contributors)
    } else {
        (Vec::new(), Vec::new())
    };

    let files = if latest_commit.is_some() {
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
        .unwrap_or_default();

        run_git(&["ls-tree", "-r", "--long", "HEAD"], Some(repo_dir), auth)
            .map(|output| parse_ls_tree(repo_dir, &output, &latest_commit_by_path))
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    ProjectRepoSnapshotInfo {
        latest_commit,
        commits,
        files,
        contributors,
    }
}

/// Blocking body of the original `get_project_repo_snapshot`: a fresh
/// temporary partial clone of `clone_url`, then the original snapshot.
///
/// Kailo: the original swallows failed steps into empty lists; when the
/// request deadline expired meanwhile, a timeout is returned instead so a
/// truncated snapshot is never presented as complete.
pub fn project_repo_snapshot(
    clone_url: &str,
    default_branch: Option<String>,
    base_branch: Option<String>,
    target_ref: Option<String>,
    target_commit: Option<String>,
    auth: &GitAuthConfig,
) -> Result<ProjectRepoSnapshotInfo, String> {
    let branch = clean_branch(default_branch);
    let base_branch = clean_branch(base_branch);
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

    let snapshot = snapshot_from_repo(&repo_dir, auth, branch.as_deref(), base_branch.as_deref());
    auth.check_deadline()?;
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_content::validate_repo_file_path;

    #[test]
    fn parse_ls_tree_keeps_paths_after_eager_preview_limit() {
        let repo_dir = tempfile::tempdir().expect("create temporary repository");
        std::fs::create_dir(repo_dir.path().join("src")).expect("create source directory");
        std::fs::write(repo_dir.path().join("README.md"), "# Deferred README")
            .expect("write deferred README");
        std::fs::write(
            repo_dir.path().join("src/application.rs"),
            "fn deferred() {}",
        )
        .expect("write deferred source file");
        let hidden_entries = (0..MAX_EAGER_FILE_PREVIEWS)
            .map(|index| {
                format!(
                    "100644 blob {} 1\t.agents/generated-{index:03}.txt",
                    "a".repeat(40)
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        let output = format!(
            "{hidden_entries}\n100644 blob {} 17\tREADME.md\n100644 blob {} 16\tsrc/application.rs",
            "b".repeat(40),
            "c".repeat(40)
        );

        let files = parse_ls_tree(repo_dir.path(), &output, &std::collections::HashMap::new());

        assert_eq!(files.len(), MAX_EAGER_FILE_PREVIEWS + 2);
        let readme = files
            .iter()
            .find(|file| file.path == "README.md")
            .expect("README metadata remains visible");
        assert_eq!(readme.preview_content, None);
        assert_eq!(
            read_preview_content(repo_dir.path(), &readme.path, readme.size).as_deref(),
            Some("# Deferred README")
        );
        assert_eq!(
            files.last().map(|file| file.path.as_str()),
            Some("src/application.rs")
        );
        let source = files.last().expect("source metadata remains visible");
        assert_eq!(source.preview_content, None);
        assert_eq!(
            read_preview_content(repo_dir.path(), &source.path, source.size).as_deref(),
            Some("fn deferred() {}")
        );
    }

    #[test]
    fn repo_file_paths_reject_traversal_and_absolute_paths() {
        assert!(validate_repo_file_path("src/application.rs").is_ok());
        assert!(validate_repo_file_path("../outside.txt").is_err());
        assert!(validate_repo_file_path("src/../outside.txt").is_err());
        assert!(validate_repo_file_path("/absolute.txt").is_err());
    }

    #[test]
    fn parse_ls_tree_counts_only_blobs_toward_eager_preview_limit() {
        let repo_dir = tempfile::tempdir().expect("create temporary repository");
        std::fs::write(repo_dir.path().join("application.rs"), "fn main() {}")
            .expect("write preview file");
        let non_blob_entries = (0..MAX_EAGER_FILE_PREVIEWS)
            .map(|index| {
                format!(
                    "160000 commit {} -\tvendor/dependency-{index:03}",
                    "a".repeat(40)
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        let output = format!(
            "{non_blob_entries}\n100644 blob {} 12\tapplication.rs",
            "b".repeat(40)
        );

        let files = parse_ls_tree(repo_dir.path(), &output, &std::collections::HashMap::new());

        assert_eq!(
            files
                .last()
                .and_then(|file| file.preview_content.as_deref()),
            Some("fn main() {}")
        );
    }

    #[test]
    fn preview_refuses_oversized_binary_and_escaping_files() {
        let repo_dir = tempfile::tempdir().expect("create temporary repository");
        let dir = repo_dir.path();
        let limit = usize::try_from(crate::MAX_PREVIEW_BYTES).unwrap();
        std::fs::write(dir.join("large.txt"), "x".repeat(limit + 1)).expect("write large file");
        std::fs::write(dir.join("binary.bin"), [b'a', 0, b'b']).expect("write binary file");
        std::fs::write(dir.join("small.txt"), "small").expect("write small file");
        let oversized = Some(crate::MAX_PREVIEW_BYTES + 1);
        assert_eq!(read_preview_content(dir, "large.txt", None), None);
        assert_eq!(read_preview_content(dir, "binary.bin", None), None);
        assert_eq!(read_preview_content(dir, "small.txt", oversized), None);
        assert_eq!(read_preview_content(dir, "../outside", None), None);
        let small = read_preview_content(dir, "small.txt", None);
        assert_eq!(small.as_deref(), Some("small"));
    }

    #[test]
    fn commit_and_contributor_parsers_keep_the_original_shape() {
        let log = concat!(
            "a1\0a\0Ada\0ada@example.com\042\0first\n",
            "b2\0b\0Bob\0bob@example.com\041\0",
        );
        let commits = parse_commits(log);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].hash, "a1");
        assert_eq!(commits[0].timestamp, 42);
        assert_eq!(commits[1].subject, "");

        let authors = concat!(
            "Ada\0ADA@example.com\010\n",
            "Ada L\0ada@example.com\020\n",
            "Bob\0\05\n",
            "\0\09",
        );
        let contributors = parse_contributors(authors);
        assert_eq!(contributors.len(), 2);
        assert_eq!(contributors[0].name, "Ada");
        assert_eq!(contributors[0].commit_count, 2);
        assert_eq!(contributors[0].last_commit_at, 20);
        assert_eq!(contributors[1].name, "Bob");

        let paths = concat!(
            "c1\0c\0Ada\0ada@example.com\07\0newer\nREADME.md\n\n",
            "c0\0c\0Ada\0ada@example.com\03\0older\nREADME.md\nsrc/lib.rs",
        );
        let by_path = parse_latest_commit_by_path(paths);
        assert_eq!(by_path["README.md"].hash, "c1");
        assert_eq!(by_path["src/lib.rs"].hash, "c0");
    }
}
