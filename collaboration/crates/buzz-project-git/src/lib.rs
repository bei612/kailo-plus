//! Projects repository reads over Buzz git smart HTTP.
//!
//! Fixed Buzz 779af8886caae1317b4de962082429867ab61503
//! desktop/src-tauri/src/commands/project_git*.rs: the blocking bodies of the
//! original Desktop commands `get_project_repo_snapshot`,
//! `get_project_repo_file_content` and `get_project_repo_diff`, moved out of the
//! Tauri crate unchanged so Desktop and Kailo Core (DD-118) run the same git
//! plumbing, parsers and bounds (64 KiB preview, 2000 patch lines, 250 eager
//! file previews).
//!
//! The only seam is authentication ([`GitAuth`]): Desktop keeps the original
//! `git-credential-nostr` helper; Core injects a freshly pre-signed NIP-98
//! `Authorization` header per git invocation and never hands a private key to
//! the git subprocess. Local-checkout, push, pull, merge and branch commands are
//! not part of this crate yet; they belong next to these modules.

#![forbid(unsafe_code)]

mod diff;
mod exec;
mod file_content;
mod snapshot;
mod types;

pub use diff::{project_repo_diff, ProjectRepoDiffFileInfo, ProjectRepoDiffInfo, MAX_PATCH_LINES};
pub use exec::{
    clean_branch, clean_target_ref, is_timeout_error, AuthorizationSource, GitAuth, GitAuthConfig,
};
pub use file_content::{project_repo_file_content, validate_repo_file_path, MAX_PREVIEW_BYTES};
pub use snapshot::{project_repo_snapshot, MAX_EAGER_FILE_PREVIEWS};
pub use types::{
    ProjectRepoCommitInfo, ProjectRepoContributorInfo, ProjectRepoFileInfo, ProjectRepoSnapshotInfo,
};
