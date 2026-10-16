//! Fixed Buzz 779af8886caae1317b4de962082429867ab61503
//! desktop/src-tauri/src/commands/project_git_types.rs (remote snapshot shapes).
//! Local-checkout, sync, push and pull shapes stay with their commands.

use serde::Serialize;

/// One commit as rendered by the original Projects views.
#[derive(Clone, Serialize)]
pub struct ProjectRepoCommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub subject: String,
}

/// One `ls-tree` entry with its bounded eager preview.
#[derive(Serialize)]
pub struct ProjectRepoFileInfo {
    pub path: String,
    pub kind: String,
    pub size: Option<u64>,
    pub preview_content: Option<String>,
    pub last_changed_at: Option<i64>,
    pub latest_commit: Option<ProjectRepoCommitInfo>,
}

/// Commit author aggregated by email (or name when the email is empty).
#[derive(Serialize)]
pub struct ProjectRepoContributorInfo {
    pub name: String,
    pub email: String,
    pub commit_count: usize,
    pub last_commit_at: i64,
}

/// The original `get_project_repo_snapshot` result.
#[derive(Serialize)]
pub struct ProjectRepoSnapshotInfo {
    pub latest_commit: Option<ProjectRepoCommitInfo>,
    pub commits: Vec<ProjectRepoCommitInfo>,
    pub files: Vec<ProjectRepoFileInfo>,
    pub contributors: Vec<ProjectRepoContributorInfo>,
}
