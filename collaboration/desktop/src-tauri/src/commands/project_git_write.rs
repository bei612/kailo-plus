//! DD-160: original remote branches and owner merge, using the shared Git bodies.
//! Authentication is always the captured device CLIENT; SQLite records the frozen
//! (repository, ref, old -> new) before push, and retries observe info/refs first.
use super::{
    project_git_intent::{Intent, Journal},
    project_git_remote::{repository_path, RepoScope, REQUEST_DEADLINE},
};
use buzz_project_git::{self as git, GitAuthConfig, MergeAuthor};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, LazyLock},
    time::Instant,
};
use tauri::{AppHandle, Manager};

pub(super) const UNKNOWN: &str = "PUBLISH_RESULT_UNKNOWN";
pub(super) const FAILED: &str = "DEPENDENCY_UNAVAILABLE";
const CONFLICT: &str = "TARGET_STATE_CONFLICT";
static WRITE_LOCK: LazyLock<Arc<tokio::sync::Mutex<()>>> =
    LazyLock::new(|| Arc::new(tokio::sync::Mutex::new(())));

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteError {
    pub code: String,
    pub operation_id: Option<String>,
}
impl WriteError {
    pub(super) fn new(code: &str) -> Self {
        Self {
            code: code.into(),
            operation_id: None,
        }
    }
    pub(super) fn at(code: &str, key: &str) -> Self {
        Self {
            code: code.into(),
            operation_id: Some(key.into()),
        }
    }
}
impl From<String> for WriteError {
    fn from(code: String) -> Self {
        Self::new(&code)
    }
}
impl From<&str> for WriteError {
    fn from(code: &str) -> Self {
        Self::new(code)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub operation: String,
    pub repository: String,
    pub branch: String,
    pub source_branch: Option<String>,
    pub expected_commit: String,
    pub pull_request_event_id: Option<String>,
}
impl Request {
    fn validate(&mut self, operation: &str) -> Result<(), WriteError> {
        let invalid = || WriteError::new("INVALID_REQUEST");
        if self.operation != operation
            || repository_path(&self.repository).is_none()
            || self.branch.chars().count() > 255
            || self
                .source_branch
                .as_ref()
                .is_some_and(|s| s.chars().count() > 255)
        {
            return Err(invalid());
        }
        self.branch = git::normalize_branch(&self.branch, "target").map_err(|_| invalid())?;
        self.expected_commit =
            git::normalize_commit(&self.expected_commit, "source").map_err(|_| invalid())?;
        if self.expected_commit.bytes().all(|c| c == b'0') {
            return Err(invalid());
        }
        if operation == "DELETE_BRANCH" {
            if self.source_branch.is_some() || self.pull_request_event_id.is_some() {
                return Err(invalid());
            }
        } else {
            let source =
                git::normalize_branch(self.source_branch.as_deref().ok_or_else(invalid)?, "source")
                    .map_err(|_| invalid())?;
            if source == self.branch {
                return Err(invalid());
            }
            self.source_branch = Some(source);
            if operation == "MERGE" {
                let id = self.pull_request_event_id.as_deref().ok_or_else(invalid)?;
                if nostr::EventId::from_hex(id).map_or(true, |e| e.to_hex() != id) {
                    return Err(invalid());
                }
            } else if self.pull_request_event_id.is_some() {
                return Err(invalid());
            }
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub branch: String,
    pub commit: String,
    pub merge_commit: Option<String>,
    pub status_event_id: Option<String>,
}

// Reject symlink substitution in the native-only metadata tree. The filename
// contains no URL, path, private key or bearer credential supplied by the page.
fn journal_path(app_data: &Path, base: &str, signer: &str) -> Result<PathBuf, WriteError> {
    std::fs::create_dir_all(app_data).map_err(|_| WriteError::new(FAILED))?;
    let mut path = app_data
        .canonicalize()
        .map_err(|_| WriteError::new(FAILED))?;
    let digest = Sha256::digest(format!("{base}\0{signer}").as_bytes());
    let hash = digest
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    for name in ["project-git-intents", hash.as_str()] {
        path.push(name);
        match std::fs::symlink_metadata(&path) {
            Ok(m) if m.is_dir() && !m.file_type().is_symlink() => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                std::fs::create_dir(&path).map_err(|_| WriteError::new(FAILED))?
            }
            _ => return Err(WriteError::new(FAILED)),
        }
    }
    path.push("dispatch.sqlite");
    if std::fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink() || !m.is_file()) {
        return Err(WriteError::new(FAILED));
    }
    Ok(path)
}

fn observed(
    journal: &Journal,
    intent: &mut Intent,
    root: &str,
    auth: &GitAuthConfig,
) -> Result<bool, WriteError> {
    let head = git::remote_branch_commit(root, &intent.request.branch, auth)
        .map_err(|_| WriteError::at(UNKNOWN, &intent.key))?;
    settle_observation(journal, intent, head)
}
fn settle_observation(
    journal: &Journal,
    intent: &mut Intent,
    head: Option<String>,
) -> Result<bool, WriteError> {
    if head == intent.new {
        intent.result = "ACCEPTED".into();
    } else if head == intent.old {
        intent.result = "NOT_DELIVERED".into();
    } else {
        intent.result = CONFLICT.into();
    }
    journal.save(intent, "RECONCILIATION")?;
    if intent.result == CONFLICT {
        return Err(WriteError::at(CONFLICT, &intent.key));
    }
    Ok(intent.result == "ACCEPTED")
}

// Same classifications as Core projects_git_ref::prepare_error /
// classify_push_failure: a stale lease is a conflict, not a hook rejection.
fn failure_code(sent: bool, message: &str) -> Option<&'static str> {
    let denied = [
        "returned error: 401",
        "returned error: 403",
        "returned error: 404",
    ]
    .iter()
    .any(|v| message.contains(v));
    if !sent {
        return Some(if denied {
            "TARGET_NOT_FOUND"
        } else if [
            "source branch changed",
            "Could not resolve the source branch",
            "default branch cannot be deleted",
            "branch already exists",
            "couldn't find remote ref",
        ]
        .iter()
        .any(|v| message.contains(v))
        {
            CONFLICT
        } else {
            FAILED
        });
    }
    if git::is_timeout_error(message) {
        return None;
    }
    if denied || message.contains("hook declined") {
        return Some("PUBLISH_REJECTED");
    }
    if message.contains("returned error: 413") {
        return Some("PAYLOAD_TOO_LARGE");
    }
    if [
        "(stale info)",
        "(fetch first)",
        "(non-fast-forward)",
        "[rejected]",
        "[remote rejected]",
        "cannot lock ref",
        "failed to update ref",
    ]
    .iter()
    .any(|v| message.contains(v))
    {
        return Some(CONFLICT);
    }
    None
}

fn dispatch(
    journal: &Journal,
    key: &str,
    request: Request,
    root: &str,
    auth: &GitAuthConfig,
    author: Option<MergeAuthor>,
) -> Result<Intent, WriteError> {
    let previous = journal.find(key, &request)?;
    let mut prepared = None;
    let mut intent = if let Some(mut intent) = previous {
        match intent.result.as_str() {
            "ACCEPTED" => return Ok(intent),
            "TARGET_STATE_CONFLICT"
            | "PUBLISH_REJECTED"
            | "TARGET_NOT_FOUND"
            | "PAYLOAD_TOO_LARGE"
            | "DEPENDENCY_UNAVAILABLE" => return Err(WriteError::at(&intent.result, &intent.key)),
            _ => {}
        }
        if observed(journal, &mut intent, root, auth)? {
            return Ok(intent);
        }
        intent
    } else {
        let old = git::remote_branch_commit(root, &request.branch, auth)
            .map_err(|_| WriteError::new(FAILED))?;
        let (new, author) = match request.operation.as_str() {
            "CREATE_BRANCH" => {
                if old.is_some() {
                    return Err(WriteError::new(CONFLICT));
                }
                (Some(request.expected_commit.clone()), None)
            }
            "DELETE_BRANCH" => {
                if old.as_deref() != Some(&request.expected_commit) {
                    return Err(WriteError::new(CONFLICT));
                }
                (None, None)
            }
            "MERGE" => {
                let author = author.ok_or_else(|| WriteError::new(FAILED))?;
                let merge = git::prepare_merge_blocking(
                    root,
                    &request.branch,
                    request.source_branch.as_deref().unwrap(),
                    &request.expected_commit,
                    &author,
                    auth,
                )
                .map_err(|e| {
                    WriteError::new(if e.code == git::MergeErrorCode::Failed {
                        FAILED
                    } else {
                        CONFLICT
                    })
                })?;
                if old.as_deref() != Some(&merge.target_commit) {
                    return Err(WriteError::new(CONFLICT));
                }
                let new = Some(merge.merge_commit.clone());
                prepared = Some(merge);
                (new, Some((author.name, author.email, author.time)))
            }
            _ => return Err(WriteError::new("INVALID_REQUEST")),
        };
        Intent {
            key: key.into(),
            request,
            old,
            new,
            author,
            result: "DISPATCHED".into(),
            event: None,
            event_result: None,
        }
    };
    if intent.request.operation == "MERGE" && prepared.is_none() {
        let (name, email, time) = intent
            .author
            .clone()
            .ok_or_else(|| WriteError::at(UNKNOWN, &intent.key))?;
        let merge = git::prepare_merge_blocking(
            root,
            &intent.request.branch,
            intent.request.source_branch.as_deref().unwrap(),
            &intent.request.expected_commit,
            &MergeAuthor { name, email, time },
            auth,
        )
        .map_err(|_| WriteError::at(CONFLICT, &intent.key))?;
        if Some(&merge.target_commit) != intent.old.as_ref()
            || Some(&merge.merge_commit) != intent.new.as_ref()
        {
            return Err(WriteError::at(CONFLICT, &intent.key));
        }
        prepared = Some(merge);
    }
    intent.result = "DISPATCHED".into();
    journal.save(&intent, "DISPATCH")?;
    let pushed = match intent.request.operation.as_str() {
        "CREATE_BRANCH" => git::create_remote_branch_blocking(
            root,
            intent.request.source_branch.as_deref().unwrap(),
            &intent.request.expected_commit,
            &intent.request.branch,
            auth,
        )
        .map(|_| ())
        .map_err(|e| (e.pushed, e.message)),
        "DELETE_BRANCH" => git::delete_remote_branch_blocking(
            root,
            &intent.request.branch,
            &intent.request.expected_commit,
            auth,
        )
        .map(|_| ())
        .map_err(|e| (e.pushed, e.message)),
        _ => git::push_merge_blocking(prepared.as_ref().unwrap(), auth)
            .map_err(|e| (e.pushed, e.message)),
    };
    match pushed {
        Ok(()) => {
            intent.result = "ACCEPTED".into();
            journal.save(&intent, "OUTCOME")?;
            Ok(intent)
        }
        Err((sent, message)) => {
            // Even an error may follow an accepted push. Only the advertised
            // frozen target can establish this intent's terminal outcome.
            if observed(journal, &mut intent, root, auth)? {
                return Ok(intent);
            }
            if let Some(code) = failure_code(sent, &message) {
                intent.result = code.into();
                journal.save(&intent, "OUTCOME")?;
                Err(WriteError::at(code, &intent.key))
            } else {
                Err(WriteError::at(UNKNOWN, &intent.key))
            }
        }
    }
}

async fn execute(
    app: AppHandle,
    mut input: Request,
    key: String,
    operation: &str,
    relay: String,
    signer: String,
) -> Result<WriteResult, WriteError> {
    input.validate(operation)?;
    let key = uuid::Uuid::parse_str(&key)
        .map_err(|_| WriteError::new("INVALID_REQUEST"))?
        .to_string();
    let deadline = Instant::now() + REQUEST_DEADLINE;
    let scope = RepoScope::capture(&app, &relay, &signer)?;
    let (base, keys) = scope.check()?;
    if operation == "MERGE"
        && input.repository.split(':').nth(1) != Some(keys.public_key().to_hex().as_str())
    {
        return Err(WriteError::new("PERMISSION_DENIED"));
    }
    let root = scope.repository_root(&repository_path(&input.repository).unwrap())?;
    scope.preflight(&root).await?;
    let guard = tokio::time::timeout_at(
        tokio::time::Instant::from_std(deadline),
        Arc::clone(&WRITE_LOCK).lock_owned(),
    )
    .await
    .map_err(|_| WriteError::new(FAILED))?;
    scope.check()?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| WriteError::new(FAILED))?;
    let path = journal_path(&app_data, &base, &keys.public_key().to_hex())?;
    let (review, author) = if operation == "MERGE" {
        let review = super::project_git_publication::read_review(&app, &scope, &input).await?;
        let cfg = crate::platform::config::load(&app)?.ok_or_else(|| WriteError::new(FAILED))?;
        let state = app.state::<crate::app_state::AppState>();
        let response = app
            .state::<crate::platform::api::NativeSession>()
            .call(
                &state.media_fetch_client,
                &cfg,
                reqwest::Method::GET,
                "/api/v1/session",
                None,
            )
            .await?;
        scope.check()?;
        if response.status != 200 {
            return Err(WriteError::new(FAILED));
        }
        let name = response
            .body
            .get("displayName")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| WriteError::new(FAILED))?;
        let host = url::Url::parse(&base)
            .ok()
            .and_then(|u| u.host_str().map(str::to_owned))
            .ok_or_else(|| WriteError::new(FAILED))?;
        (
            Some(review),
            Some(MergeAuthor {
                name: git::merge_author_name(name),
                email: format!("{}@{host}", keys.public_key().to_hex()),
                time: nostr::Timestamp::now().as_secs() as i64,
            }),
        )
    } else {
        (None, None)
    };
    let auth = scope.auth(root.clone(), deadline);
    let task_scope = scope.clone();
    let task_path = path.clone();
    let operation_key = key.clone();
    let (result, _guard) = tauri::async_runtime::spawn_blocking(move || {
        let result = (|| {
            task_scope.check()?;
            let journal = Journal::open(&task_path)?;
            dispatch(&journal, &key, input, &root, &auth, author)
        })();
        (result, guard)
    })
    .await
    .map_err(|_| WriteError::at(UNKNOWN, &operation_key))?;
    let mut intent = result?;
    scope
        .check()
        .map_err(|_| WriteError::at(UNKNOWN, &intent.key))?;
    let status_event_id = if let Some(review) = review {
        super::project_git_publication::ensure_status(&app, &scope, &path, &mut intent, &review)
            .await?
    } else {
        None
    };
    scope
        .check()
        .map_err(|_| WriteError::at(UNKNOWN, &intent.key))?;
    Ok(WriteResult {
        branch: intent.request.branch.clone(),
        commit: intent
            .new
            .clone()
            .unwrap_or_else(|| intent.request.expected_commit.clone()),
        merge_commit: if operation == "MERGE" {
            intent.new
        } else {
            None
        },
        status_event_id,
    })
}

async fn bounded_execute(
    app: AppHandle,
    input: Request,
    key: String,
    operation: &str,
    relay: String,
    signer: String,
) -> Result<WriteResult, WriteError> {
    let pending = WriteError::at(UNKNOWN, &key);
    tokio::time::timeout(
        REQUEST_DEADLINE,
        execute(app, input, key, operation, relay, signer),
    )
    .await
    .map_err(|_| pending)?
}

#[tauri::command]
pub async fn create_project_remote_branch(
    input: Request,
    idempotency_key: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    app: AppHandle,
) -> Result<WriteResult, WriteError> {
    bounded_execute(
        app,
        input,
        idempotency_key,
        "CREATE_BRANCH",
        expected_relay_url,
        expected_signer_pubkey,
    )
    .await
}
#[tauri::command]
pub async fn delete_project_remote_branch(
    input: Request,
    idempotency_key: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    app: AppHandle,
) -> Result<WriteResult, WriteError> {
    bounded_execute(
        app,
        input,
        idempotency_key,
        "DELETE_BRANCH",
        expected_relay_url,
        expected_signer_pubkey,
    )
    .await
}
#[tauri::command]
pub async fn merge_project_pull_request(
    input: Request,
    idempotency_key: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    app: AppHandle,
) -> Result<WriteResult, WriteError> {
    bounded_execute(
        app,
        input,
        idempotency_key,
        "MERGE",
        expected_relay_url,
        expected_signer_pubkey,
    )
    .await
}

#[cfg(test)]
#[path = "project_git_write_tests.rs"]
mod tests;
