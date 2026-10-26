//! DD-118(6)/DD-160: durable, repository-local push intent. Only public repository
//! addressing and object IDs are stored. A pending intent is never replaced by
//! the current checkout HEAD, including after process restart.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;

use super::CHECKOUT_OUTCOME_UNKNOWN;
use crate::diff::clean_commit;
use crate::exec::{clean_branch, run_git, GitAuthConfig};

const FILE: &str = "kailo-push-intent";
const MAX_BYTES: u64 = 8192;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct PushIntent {
    pub root: String,
    pub reference: String,
    pub old: Option<String>,
    pub new: String,
    pub merge_base: Option<String>,
}

fn checked_commit(value: &str) -> Result<Option<String>, String> {
    if value.is_empty() {
        return Ok(None);
    }
    clean_commit(Some(value.to_owned()))
        .filter(|clean| clean == value)
        .map(Some)
        .ok_or_else(|| CHECKOUT_OUTCOME_UNKNOWN.into())
}

fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|_| CHECKOUT_OUTCOME_UNKNOWN.to_owned())?;
    #[cfg(not(unix))]
    let _ = path; // NamedTempFile's contents are flushed before the atomic move.
    Ok(())
}

pub(super) fn read(repo: &Path, root: &str) -> Result<Option<PushIntent>, String> {
    let path = repo.join(".git").join(FILE);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(CHECKOUT_OUTCOME_UNKNOWN.into()),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX_BYTES {
        return Err(CHECKOUT_OUTCOME_UNKNOWN.into());
    }
    let mut value = String::new();
    File::open(path)
        .and_then(|file| file.take(MAX_BYTES + 1).read_to_string(&mut value))
        .map_err(|_| CHECKOUT_OUTCOME_UNKNOWN.to_owned())?;
    let fields = value.split('\n').collect::<Vec<_>>();
    if fields.len() != 7
        || fields[0] != "kailo-push-v1"
        || fields[1] != root
        || fields[6] != ""
        || value.len() as u64 > MAX_BYTES
    {
        return Err(CHECKOUT_OUTCOME_UNKNOWN.into());
    }
    let reference = fields[2];
    let branch = reference
        .strip_prefix("refs/heads/")
        .ok_or(CHECKOUT_OUTCOME_UNKNOWN)?;
    if clean_branch(Some(branch.to_owned())).as_deref() != Some(branch) {
        return Err(CHECKOUT_OUTCOME_UNKNOWN.into());
    }
    Ok(Some(PushIntent {
        root: root.to_owned(),
        reference: reference.to_owned(),
        old: checked_commit(fields[3])?,
        new: checked_commit(fields[4])?.ok_or(CHECKOUT_OUTCOME_UNKNOWN)?,
        merge_base: checked_commit(fields[5])?,
    }))
}

pub(super) fn persist(repo: &Path, intent: &PushIntent) -> Result<(), String> {
    if intent.root.contains(['\n', '\r']) || !intent.reference.starts_with("refs/heads/") {
        return Err(CHECKOUT_OUTCOME_UNKNOWN.into());
    }
    let bytes = format!(
        "kailo-push-v1\n{}\n{}\n{}\n{}\n{}\n",
        intent.root,
        intent.reference,
        intent.old.as_deref().unwrap_or(""),
        intent.new,
        intent.merge_base.as_deref().unwrap_or("")
    );
    if bytes.len() as u64 > MAX_BYTES {
        return Err(CHECKOUT_OUTCOME_UNKNOWN.into());
    }
    let directory = repo.join(".git");
    let mut pending = tempfile::NamedTempFile::new_in(&directory)
        .map_err(|_| CHECKOUT_OUTCOME_UNKNOWN.to_owned())?;
    pending
        .write_all(bytes.as_bytes())
        .and_then(|_| pending.as_file().sync_all())
        .map_err(|_| CHECKOUT_OUTCOME_UNKNOWN.to_owned())?;
    // Never replace a pending operation, including one created by another app
    // process. A later attempt must read and reconcile that exact intent.
    pending
        .persist_noclobber(directory.join(FILE))
        .map_err(|_| CHECKOUT_OUTCOME_UNKNOWN.to_owned())?;
    sync_directory(&directory)
}

pub(super) fn complete(repo: &Path) -> Result<(), String> {
    let directory = repo.join(".git");
    fs::remove_file(directory.join(FILE)).map_err(|_| CHECKOUT_OUTCOME_UNKNOWN.to_owned())?;
    sync_directory(&directory)
}

/// Only info/refs (git ls-remote), never fetch, push, or the current local HEAD.
pub(super) fn observe(
    repo: &Path,
    intent: &PushIntent,
    auth: &GitAuthConfig,
) -> Result<Option<String>, String> {
    let output = run_git(
        &[
            "ls-remote",
            "--heads",
            "--end-of-options",
            &intent.root,
            &intent.reference,
        ],
        Some(repo),
        auth,
    )
    .map_err(|_| CHECKOUT_OUTCOME_UNKNOWN.to_owned())?;
    let mut lines = output.lines().filter(|line| !line.is_empty());
    let Some(line) = lines.next() else {
        return Ok(None);
    };
    let (commit, reference) = line.split_once('\t').ok_or(CHECKOUT_OUTCOME_UNKNOWN)?;
    if reference != intent.reference || lines.next().is_some() {
        return Err(CHECKOUT_OUTCOME_UNKNOWN.into());
    }
    checked_commit(commit)?
        .map(Some)
        .ok_or_else(|| CHECKOUT_OUTCOME_UNKNOWN.into())
}
