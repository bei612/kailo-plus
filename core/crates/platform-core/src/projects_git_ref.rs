//! DD-118 batch 2a: the original Buzz Desktop remote branch commands
//! (`create_project_remote_branch` / `delete_project_remote_branch`, fixed Buzz
//! 779af8886caae1317b4de962082429867ab61503
//! desktop/src-tauri/src/commands/project_git_branches.rs) for Web through BFF.
//!
//! A branch create/delete is a collaboration data-plane write like
//! `projects.publish`, not an ActionAdmission: the person's own SERVER identity
//! pushes to the Relay repository named by its 30617 coordinate and only the
//! Relay (`authorize_git_read`, receive-pack authorization, pre-receive policy)
//! decides. The Browser names the repository, branch and expected head; it
//! never supplies a URL, refspec or NIP-98.
//!
//! DD-81: the ref update (repository, ref, old -> new) and its DISPATCH audit
//! are durable before `git push`. When the outcome cannot be known, it is
//! reconciled only from the ref the Relay advertises to the same person: new
//! means delivered, old means not delivered (the same Idempotency-Key may push
//! again), anything else is TARGET_STATE_CONFLICT. Nothing is pushed blindly.
use crate::{
    audit::{append, AuditEntry, Evidence},
    bff::{resolve_execution_context, BffState, ExecutionContext},
    projects_git::{info_refs_error, repository_path, MAX_REF_CHARS},
    pulse,
    web_transport::{actor_keys, community_client, error_body, record, relay_error_response},
};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use buzz_project_git::{GitAuth, GitAuthConfig, RemoteBranchError};
use collab_bridge::bridge::IdentityClient;
use contracts::{
    ErrorClass, EvidenceKind, ProjectsGitRefRequest, ProjectsGitRefResponse, ReasonCode,
};
use std::sync::Arc;
use std::time::{Duration, Instant};
use uuid::Uuid;

/// Audit action of a Projects branch push. Not an ActionDefinition: like
/// `projects.publish` it only names the DISPATCH/OUTCOME chain of the write.
pub(crate) const GIT_REF_ACTION: &str = "projects.git.ref";

/// One branch operation, however many git invocations it needs.
const PUSH_DEADLINE: Duration = Duration::from_secs(120);
/// One reconciliation read (`ls-remote` of a single ref).
const RECONCILE_DEADLINE: Duration = Duration::from_secs(30);

const ACCEPTED: &str = "ACCEPTED";
const REJECTED: &str = "REJECTED";
const NOT_DELIVERED: &str = "NOT_DELIVERED";
/// The ref is at neither side of the update; another writer moved it.
const CONFLICT: &str = "CONFLICT";

/// Bound on the Relay hook text kept in the log.
const MAX_REASON_CHARS: usize = 512;

/// A request reduced to the original command inputs plus its ref update.
#[derive(Debug, Clone, PartialEq)]
struct RefUpdate {
    /// The 30617 coordinate, as recorded with the intent.
    repository: String,
    /// `/git/{owner}/{d}`; the only path this request may reach on Relay.
    repo_path: String,
    /// Normalized branch name (`refs/heads/` stripped).
    branch: String,
    /// CREATE_BRANCH only: the normalized source branch.
    source_branch: Option<String>,
    /// The ref before the update; all zeros when the branch is created.
    old_commit: String,
    /// The ref after the update; all zeros when the branch is deleted.
    new_commit: String,
}

impl RefUpdate {
    fn ref_name(&self) -> String {
        format!("refs/heads/{}", self.branch)
    }

    /// The original ProjectRepoBranchResult without its English message: the
    /// branch and its new head (DELETE_BRANCH: the deleted head).
    fn result(&self) -> ProjectsGitRefResponse {
        let commit = if self.source_branch.is_some() {
            &self.new_commit
        } else {
            &self.old_commit
        };
        ProjectsGitRefResponse {
            branch: self.branch.clone(),
            commit: commit.clone(),
        }
    }
}

fn is_zero(commit: &str) -> bool {
    commit.bytes().all(|byte| byte == b'0')
}

fn within(value: &str) -> bool {
    !value.is_empty() && value.chars().count() <= MAX_REF_CHARS
}

/// Contract checks plus the original command normalization
/// (`normalize_branch` / `normalize_commit`, different source and new branch).
// Keep the existing BFF HTTP refusal type; no second error wrapper.
#[allow(clippy::result_large_err)]
fn validate(request: ProjectsGitRefRequest) -> Result<RefUpdate, Response> {
    let bad = || StatusCode::BAD_REQUEST.into_response();
    let repo_path = repository_path(&request.repository).ok_or_else(bad)?;
    if !within(&request.branch) || request.source_branch.as_deref().is_some_and(|v| !within(v)) {
        return Err(bad());
    }
    // The contract fixes lowercase hex; the original lowercases. Accept only
    // the value both agree on.
    let expected = buzz_project_git::normalize_commit(&request.expected_commit, "expected")
        .ok()
        .filter(|commit| *commit == request.expected_commit && !is_zero(commit))
        .ok_or_else(bad)?;
    let zero = "0".repeat(expected.len());
    let create = request.operation == contracts::ProjectGitRefOperation::CreateBranch;
    match (create, request.source_branch.as_deref()) {
        (true, Some(source)) => {
            let source = buzz_project_git::normalize_branch(source, "source").map_err(|_| bad())?;
            let branch =
                buzz_project_git::normalize_branch(&request.branch, "new").map_err(|_| bad())?;
            // Original: "The new branch must have a different name."
            if branch == source {
                return Err(bad());
            }
            Ok(RefUpdate {
                repository: request.repository,
                repo_path,
                branch,
                source_branch: Some(source),
                old_commit: zero,
                new_commit: expected,
            })
        }
        (false, None) => {
            let branch =
                buzz_project_git::normalize_branch(&request.branch, "branch").map_err(|_| bad())?;
            Ok(RefUpdate {
                repository: request.repository,
                repo_path,
                branch,
                source_branch: None,
                old_commit: expected,
                new_commit: zero,
            })
        }
        _ => Err(bad()),
    }
}

/// Where the remote ref stands relative to one update.
#[derive(Debug, PartialEq)]
enum RefState {
    Delivered,
    NotDelivered,
    Moved,
}

/// One side of the update as the remote advertises it: zero is "absent".
fn side(commit: &str) -> Option<&str> {
    (!is_zero(commit)).then_some(commit)
}

fn ref_state(remote: Option<&str>, update: &RefUpdate) -> RefState {
    if remote == side(&update.new_commit) {
        RefState::Delivered
    } else if remote == side(&update.old_commit) {
        RefState::NotDelivered
    } else {
        RefState::Moved
    }
}

/// What a failed `git push` says about the update.
#[derive(Debug, PartialEq)]
enum PushFailure {
    /// Relay refused the push (pre-receive policy or receive-pack
    /// authorization); the ref was not updated. Carries the Relay's reason.
    Rejected(String),
    TooLarge,
    /// The lease or the remote ref update failed: the ref moved.
    Conflict,
    /// Timeout or transport loss: the remote may have applied the update.
    Unknown,
}

/// The Relay's own words: `remote:` lines (the pre-receive hook's stderr),
/// else git's refusal line. Bounded; kept in the log only.
fn hook_reason(stderr: &str) -> String {
    let remote = stderr
        .lines()
        .filter_map(|line| line.strip_prefix("remote: "))
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    let reason = if remote.is_empty() {
        stderr
            .lines()
            .find(|line| line.contains("[remote rejected]") || line.starts_with("fatal:"))
            .unwrap_or_default()
            .trim()
            .to_owned()
    } else {
        remote.join("\n")
    };
    reason.chars().take(MAX_REASON_CHARS).collect()
}

fn classify_push_failure(stderr: &str) -> PushFailure {
    if buzz_project_git::is_timeout_error(stderr) {
        return PushFailure::Unknown;
    }
    let refused = [
        "returned error: 401",
        "returned error: 403",
        "returned error: 404",
    ];
    if stderr.contains("hook declined") || refused.iter().any(|code| stderr.contains(code)) {
        return PushFailure::Rejected(hook_reason(stderr));
    }
    if stderr.contains("returned error: 413") {
        return PushFailure::TooLarge;
    }
    let moved = [
        "(stale info)",
        "(fetch first)",
        "(non-fast-forward)",
        "[rejected]",
        "[remote rejected]",
        "cannot lock ref",
        "failed to update ref",
    ];
    if moved.iter().any(|marker| stderr.contains(marker)) {
        return PushFailure::Conflict;
    }
    PushFailure::Unknown
}

fn conflict(operation_id: Option<Uuid>) -> Response {
    error_body(
        StatusCode::CONFLICT,
        ErrorClass::Conflict,
        ReasonCode::TargetStateConflict,
        operation_id,
    )
}

fn reused() -> Response {
    error_body(
        StatusCode::CONFLICT,
        ErrorClass::Conflict,
        ReasonCode::IdempotencyKeyReused,
        None,
    )
}

fn rejected(operation_id: Uuid) -> Response {
    error_body(
        StatusCode::FORBIDDEN,
        ErrorClass::Denied,
        ReasonCode::PublishRejected,
        Some(operation_id),
    )
}

fn too_large(operation_id: Uuid) -> Response {
    error_body(
        StatusCode::PAYLOAD_TOO_LARGE,
        ErrorClass::Limit,
        ReasonCode::PayloadTooLarge,
        Some(operation_id),
    )
}

fn unknown(operation_id: Uuid) -> Response {
    error_body(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorClass::Unknown,
        ReasonCode::PublishResultUnknown,
        Some(operation_id),
    )
}

fn unavailable(status: StatusCode, operation_id: Option<Uuid>) -> Response {
    error_body(
        status,
        ErrorClass::Precondition,
        ReasonCode::DependencyUnavailable,
        operation_id,
    )
}

/// A failure before `git push` started: nothing reached the remote ref.
fn prepare_error(message: &str, operation_id: Uuid) -> Response {
    let refused = [
        "returned error: 401",
        "returned error: 403",
        "returned error: 404",
    ];
    let moved = [
        "The source branch changed",
        "Could not resolve the source branch",
        "default branch cannot be deleted",
        "couldn't find remote ref",
    ];
    if buzz_project_git::is_timeout_error(message) {
        unavailable(StatusCode::GATEWAY_TIMEOUT, Some(operation_id))
    } else if moved.iter().any(|marker| message.contains(marker)) {
        conflict(Some(operation_id))
    } else if refused.iter().any(|code| message.contains(code)) {
        error_body(
            StatusCode::NOT_FOUND,
            ErrorClass::Precondition,
            ReasonCode::TargetNotFound,
            Some(operation_id),
        )
    } else if message.contains("returned error: 413") {
        too_large(operation_id)
    } else {
        unavailable(StatusCode::SERVICE_UNAVAILABLE, Some(operation_id))
    }
}

fn idempotency_key(headers: &HeaderMap) -> Option<Uuid> {
    headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<Uuid>().ok())
}

/// A fresh NIP-98 per git invocation, signed by the person's own SERVER key
/// for the repository root; Host names the Community (SF-BUZ-32).
fn git_auth(client: &Arc<IdentityClient>, repo_path: &str, budget: Duration) -> GitAuthConfig {
    let signer = Arc::clone(client);
    let path = repo_path.to_owned();
    let header = GitAuth::Header {
        authorization: Box::new(move || {
            signer
                .git_authorization(&path)
                .map_err(|error| error.to_string())
        }),
        host: Some(client.community_host().to_owned()),
    };
    GitAuthConfig::new("git", header).with_deadline(Instant::now() + budget)
}

/// The reconciliation read: the ref as Relay advertises it to this person.
async fn read_ref(
    client: &Arc<IdentityClient>,
    clone_url: &str,
    update: &RefUpdate,
) -> Result<Option<String>, String> {
    let auth = git_auth(client, &update.repo_path, RECONCILE_DEADLINE);
    let url = clone_url.to_owned();
    let branch = update.branch.clone();
    tokio::task::spawn_blocking(move || {
        buzz_project_git::remote_branch_commit(&url, &branch, &auth)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Exactly one original command per update.
fn push(
    update: &RefUpdate,
    clone_url: &str,
    auth: &GitAuthConfig,
) -> Result<(), RemoteBranchError> {
    let result = match &update.source_branch {
        Some(source) => buzz_project_git::create_remote_branch_blocking(
            clone_url,
            source,
            &update.new_commit,
            &update.branch,
            auth,
        ),
        None => buzz_project_git::delete_remote_branch_blocking(
            clone_url,
            &update.branch,
            &update.old_commit,
            auth,
        ),
    };
    result.map(|_| ())
}

#[derive(sqlx::FromRow)]
struct Attempt {
    operation_id: Uuid,
    repository: String,
    ref_name: String,
    source_branch: Option<String>,
    old_commit: String,
    new_commit: String,
    result: Option<String>,
}

impl Attempt {
    fn same_intent(&self, update: &RefUpdate) -> bool {
        self.repository == update.repository
            && self.ref_name == update.ref_name()
            && self.source_branch == update.source_branch
            && self.old_commit == update.old_commit
            && self.new_commit == update.new_commit
    }
}

const ATTEMPT: &str = "select a.operation_id, a.repository, a.ref_name, a.source_branch,
        a.old_commit, a.new_commit,
        (select r.result_code from audit.audit_event r
          where r.operation_id = a.operation_id
            and r.event_type in ('OUTCOME', 'RECONCILIATION')
          order by r.occurred_at desc limit 1) as result
   from admission.git_push_attempt a
   where a.tenant_principal_id = $1 and a.idempotency_key = $2";

fn entry<'a>(
    ctx: &ExecutionContext,
    operation_id: Uuid,
    event_type: &'a str,
    result_code: &'a str,
    signer: &str,
) -> AuditEntry<'a> {
    AuditEntry {
        event_key: format!(
            "{GIT_REF_ACTION}:{operation_id}:{}:{result_code}",
            event_type.to_ascii_lowercase()
        ),
        tenant_id: Some(ctx.tenant_id),
        workspace_id: None,
        operation_id,
        event_type,
        human_identity_id: Some(ctx.human_identity_id),
        initiator_principal_id: Some(ctx.tenant_principal_id),
        actor_principal_id: Some(ctx.tenant_principal_id),
        action_key: GIT_REF_ACTION,
        action_version: 1,
        component_type_key: "buzz",
        // Repositories are Community-global (is_global_only_kind), like issues.
        target_type: Some("TENANT"),
        target_id: Some(ctx.tenant_id),
        // Branch names and commits stay in the intent row, not in audit.
        parameter_hash: "NONE",
        decision: "ALLOW",
        result_code,
        result_exposure: "NONE",
        evidence_refs: vec![
            Evidence::new(EvidenceKind::BuzzPubkey, signer),
            Evidence::new(EvidenceKind::PlatformSessionId, ctx.session_id),
        ],
        correlation_id: operation_id,
    }
}

/// An outcome that cannot be written does not change the answer: DISPATCH and
/// the intent remain, and the next request with the same key reconciles.
async fn settle(
    state: &BffState,
    ctx: &ExecutionContext,
    operation_id: Uuid,
    event_type: &'static str,
    result_code: &'static str,
    signer: &str,
) {
    let written = record(
        state,
        entry(ctx, operation_id, event_type, result_code, signer),
    )
    .await;
    if let Err(error) = written {
        tracing::warn!(error = %error, "Projects branch outcome audit not written");
    }
}

enum Claim {
    Acquired,
    /// Another request holds this key for the same update right now.
    Pending(Uuid),
    Reused,
}

/// Intent and DISPATCH in one transaction, before any push. A retry that was
/// confirmed not delivered re-points the key at the new attempt, provided the
/// key still names the previous one.
async fn dispatch(
    state: &BffState,
    ctx: &ExecutionContext,
    key: Uuid,
    update: &RefUpdate,
    operation_id: Uuid,
    replaces: Option<Uuid>,
    signer: &str,
) -> Result<Claim, sqlx::Error> {
    let mut tx = state.pool.begin().await?;
    let claimed = match replaces {
        Some(previous) => sqlx::query(
            "update admission.git_push_attempt
             set operation_id = $3, created_at = now()
             where tenant_principal_id = $1 and idempotency_key = $2 and operation_id = $4",
        )
        .bind(ctx.tenant_principal_id)
        .bind(key)
        .bind(operation_id)
        .bind(previous)
        .execute(&mut *tx)
        .await?
        .rows_affected(),
        None => sqlx::query(
            "insert into admission.git_push_attempt
                 (tenant_principal_id, idempotency_key, operation_id, repository, ref_name,
                  source_branch, old_commit, new_commit)
             values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing",
        )
        .bind(ctx.tenant_principal_id)
        .bind(key)
        .bind(operation_id)
        .bind(&update.repository)
        .bind(update.ref_name())
        .bind(&update.source_branch)
        .bind(&update.old_commit)
        .bind(&update.new_commit)
        .execute(&mut *tx)
        .await?
        .rows_affected(),
    };
    if claimed == 0 {
        let frozen = sqlx::query_as::<_, Attempt>(ATTEMPT)
            .bind(ctx.tenant_principal_id)
            .bind(key)
            .fetch_one(&mut *tx)
            .await?;
        return Ok(if frozen.same_intent(update) {
            Claim::Pending(frozen.operation_id)
        } else {
            Claim::Reused
        });
    }
    append(
        &mut tx,
        entry(ctx, operation_id, "DISPATCH", "DISPATCHED", signer),
    )
    .await?;
    tx.commit().await?;
    Ok(Claim::Acquired)
}

pub(crate) async fn update_ref(
    State(state): State<BffState>,
    headers: HeaderMap,
    Json(request): Json<ProjectsGitRefRequest>,
) -> Response {
    match update_ref_inner(&state, &headers, request).await {
        Ok(value) => (
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            Json(value),
        )
            .into_response(),
        Err(error) => error,
    }
}

async fn update_ref_inner(
    state: &BffState,
    headers: &HeaderMap,
    request: ProjectsGitRefRequest,
) -> Result<ProjectsGitRefResponse, Response> {
    let ctx = resolve_execution_context(state, headers).await?;
    let update = validate(request)?;
    // DD-81, as for publications: without a key a retry could only push again.
    let key = idempotency_key(headers).ok_or_else(|| StatusCode::BAD_REQUEST.into_response())?;
    let before = pulse::admit(state, &ctx).await?;
    let keys = actor_keys(state, &ctx).await?;
    let signer = keys.public_key().to_hex();
    let client = Arc::new(community_client(state, &keys, &before.community_host)?);
    // Relay decides with the person's own identity before anything is recorded.
    client
        .git_info_refs(&state.http, &update.repo_path)
        .await
        .map_err(|error| info_refs_error(&error))?;
    let clone_url = client
        .git_remote_url(&update.repo_path)
        .map_err(|error| relay_error_response(&error, None))?;

    let previous = sqlx::query_as::<_, Attempt>(ATTEMPT)
        .bind(ctx.tenant_principal_id)
        .bind(key)
        .fetch_optional(&state.pool)
        .await
        .map_err(|error| {
            tracing::warn!(error = %error, "Projects branch intent unreadable");
            unavailable(StatusCode::SERVICE_UNAVAILABLE, None)
        })?;
    let replaces = match &previous {
        None => None,
        Some(attempt) if !attempt.same_intent(&update) => return Err(reused()),
        Some(attempt) => match attempt.result.as_deref() {
            Some(ACCEPTED) => return Ok(update.result()),
            Some(REJECTED) => return Err(rejected(attempt.operation_id)),
            // NOT_DELIVERED, CONFLICT or no outcome yet: ask Relay first.
            _ => {
                let remote = match read_ref(&client, &clone_url, &update).await {
                    Ok(remote) => remote,
                    Err(error) => {
                        tracing::warn!(error = %error, "Projects branch reconciliation failed");
                        return Err(unknown(attempt.operation_id));
                    }
                };
                match ref_state(remote.as_deref(), &update) {
                    RefState::Delivered => {
                        let id = attempt.operation_id;
                        settle(state, &ctx, id, "RECONCILIATION", ACCEPTED, &signer).await;
                        return Ok(update.result());
                    }
                    RefState::Moved => {
                        if attempt.result.is_none() {
                            let id = attempt.operation_id;
                            settle(state, &ctx, id, "RECONCILIATION", CONFLICT, &signer).await;
                        }
                        return Err(conflict(Some(attempt.operation_id)));
                    }
                    RefState::NotDelivered => Some(attempt.operation_id),
                }
            }
        },
    };

    // Relay reads are external I/O: do not push with an admission or a key
    // revoked meanwhile (the same re-check as projects_git::query).
    if pulse::admit(state, &ctx).await? != before
        || actor_keys(state, &ctx).await?.public_key() != keys.public_key()
    {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    // The push is a Relay write: take Core's Relay budget before DISPATCH.
    client
        .admit()
        .map_err(|error| relay_error_response(&error, None))?;

    let operation = Uuid::new_v4();
    match dispatch(state, &ctx, key, &update, operation, replaces, &signer).await {
        Ok(Claim::Acquired) => {}
        Ok(Claim::Pending(current)) => return Err(unknown(current)),
        Ok(Claim::Reused) => return Err(reused()),
        Err(error) => {
            tracing::warn!(error = %error, "Projects branch DISPATCH not written; not pushing");
            return Err(unavailable(StatusCode::SERVICE_UNAVAILABLE, None));
        }
    }

    let auth = git_auth(&client, &update.repo_path, PUSH_DEADLINE);
    let work = update.clone();
    let url = clone_url.clone();
    let pushed = tokio::task::spawn_blocking(move || push(&work, &url, &auth))
        .await
        .unwrap_or_else(|error| {
            Err(RemoteBranchError {
                pushed: true,
                message: format!("branch task failed: {error}"),
            })
        });
    let failure = match pushed {
        Ok(()) => {
            settle(state, &ctx, operation, "OUTCOME", ACCEPTED, &signer).await;
            return Ok(update.result());
        }
        Err(failure) => failure,
    };
    tracing::warn!(
        error = %failure.message,
        pushed = failure.pushed,
        "Projects branch operation failed"
    );
    if !failure.pushed {
        settle(state, &ctx, operation, "OUTCOME", NOT_DELIVERED, &signer).await;
        return Err(prepare_error(&failure.message, operation));
    }
    // git push ran: the remote may have applied the update before failing.
    let remote = read_ref(&client, &clone_url, &update)
        .await
        .map(|remote| ref_state(remote.as_deref(), &update));
    match (remote, classify_push_failure(&failure.message)) {
        (Ok(RefState::Delivered), _) => {
            settle(state, &ctx, operation, "OUTCOME", ACCEPTED, &signer).await;
            Ok(update.result())
        }
        (_, PushFailure::Rejected(reason)) => {
            tracing::info!(reason = %reason, "Relay refused the Projects branch push");
            settle(state, &ctx, operation, "OUTCOME", REJECTED, &signer).await;
            Err(rejected(operation))
        }
        (_, PushFailure::TooLarge) => {
            settle(state, &ctx, operation, "OUTCOME", NOT_DELIVERED, &signer).await;
            Err(too_large(operation))
        }
        (_, PushFailure::Conflict) => {
            settle(state, &ctx, operation, "OUTCOME", NOT_DELIVERED, &signer).await;
            Err(conflict(Some(operation)))
        }
        (Ok(RefState::Moved), PushFailure::Unknown) => {
            settle(state, &ctx, operation, "OUTCOME", CONFLICT, &signer).await;
            Err(conflict(Some(operation)))
        }
        // Still at old, or unreadable: the push may yet land. No outcome; the
        // same key reconciles before it may push again.
        (Ok(RefState::NotDelivered) | Err(_), PushFailure::Unknown) => Err(unknown(operation)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn coordinate() -> String {
        format!("30617:{}:repo", "a".repeat(64))
    }

    fn checked(value: Value) -> Option<RefUpdate> {
        let request: ProjectsGitRefRequest = serde_json::from_value(value).unwrap();
        validate(request).ok()
    }

    fn create(branch: &str, source: &str, commit: &str) -> Option<RefUpdate> {
        checked(json!({
            "operation": "CREATE_BRANCH", "repository": coordinate(), "branch": branch,
            "sourceBranch": source, "expectedCommit": commit
        }))
    }

    fn delete(branch: &str, commit: &str) -> Option<RefUpdate> {
        checked(json!({
            "operation": "DELETE_BRANCH", "repository": coordinate(), "branch": branch,
            "expectedCommit": commit
        }))
    }

    #[test]
    fn create_and_delete_become_one_ref_update_with_a_zero_side() {
        let commit = "b".repeat(40);
        let created = create("refs/heads/feature/x", "main", &commit).unwrap();
        assert_eq!(created.branch, "feature/x");
        assert_eq!(created.ref_name(), "refs/heads/feature/x");
        assert_eq!(created.source_branch.as_deref(), Some("main"));
        assert_eq!(created.old_commit, "0".repeat(40));
        assert_eq!(created.new_commit, commit);
        assert_eq!(created.repo_path, format!("/git/{}/repo", "a".repeat(64)));
        assert_eq!(created.result().commit, commit);

        let sha256 = "c".repeat(64);
        let deleted = delete("feature/x", &sha256).unwrap();
        assert_eq!(deleted.source_branch, None);
        assert_eq!(deleted.old_commit, sha256);
        assert_eq!(deleted.new_commit, "0".repeat(64));
        assert_eq!(deleted.result().branch, "feature/x");
        assert_eq!(deleted.result().commit, sha256);
    }

    #[test]
    fn refs_and_commits_keep_the_original_and_contract_bounds() {
        let commit = "b".repeat(40);
        assert!(create("main", "main", &commit).is_none(), "same name");
        assert!(create("--upload-pack=x", "main", &commit).is_none());
        assert!(create("feature/../main", "main", &commit).is_none());
        assert!(create("refs/tags/v1", "main", &commit).is_none());
        assert!(create("x.lock", "main", &commit).is_none());
        assert!(create("feature", "-main", &commit).is_none());
        assert!(create(&"b".repeat(MAX_REF_CHARS + 1), "main", &commit).is_none());
        assert!(create("feature", "main", &"B".repeat(40)).is_none());
        assert!(create("feature", "main", &"0".repeat(40)).is_none());
        assert!(create("feature", "main", "abc").is_none());
        assert!(delete("feature", &"0".repeat(64)).is_none());
        assert!(delete("", &commit).is_none());
        let source_on_delete = json!({
            "operation": "DELETE_BRANCH", "repository": coordinate(), "branch": "feature",
            "sourceBranch": "main", "expectedCommit": commit
        });
        assert!(checked(source_on_delete).is_none());
        let missing_source = json!({
            "operation": "CREATE_BRANCH", "repository": coordinate(), "branch": "feature",
            "expectedCommit": commit
        });
        assert!(checked(missing_source).is_none());
        let foreign = json!({
            "operation": "DELETE_BRANCH", "repository": "30617:x:repo", "branch": "feature",
            "expectedCommit": commit
        });
        assert!(checked(foreign).is_none());
    }

    #[test]
    fn reconciliation_reads_new_as_delivered_old_as_not_delivered() {
        let commit = "b".repeat(40);
        let other = "d".repeat(40);
        let (head, moved) = (Some(commit.as_str()), Some(other.as_str()));
        let created = create("feature", "main", &commit).unwrap();
        assert_eq!(ref_state(head, &created), RefState::Delivered);
        assert_eq!(ref_state(None, &created), RefState::NotDelivered);
        assert_eq!(ref_state(moved, &created), RefState::Moved);

        let deleted = delete("feature", &commit).unwrap();
        assert_eq!(ref_state(None, &deleted), RefState::Delivered);
        assert_eq!(ref_state(head, &deleted), RefState::NotDelivered);
        assert_eq!(ref_state(moved, &deleted), RefState::Moved);
    }

    #[test]
    fn same_intent_compares_the_whole_ref_update() {
        let update = create("feature", "main", &"b".repeat(40)).unwrap();
        let attempt = |source: Option<&str>, new: String| Attempt {
            operation_id: Uuid::new_v4(),
            repository: coordinate(),
            ref_name: "refs/heads/feature".into(),
            source_branch: source.map(str::to_owned),
            old_commit: "0".repeat(40),
            new_commit: new,
            result: None,
        };
        assert!(attempt(Some("main"), "b".repeat(40)).same_intent(&update));
        assert!(!attempt(Some("dev"), "b".repeat(40)).same_intent(&update));
        assert!(!attempt(Some("main"), "e".repeat(40)).same_intent(&update));
    }

    #[test]
    fn push_failures_keep_relay_rejection_conflict_and_unknown_apart() {
        let hook = "remote: error: push denied by policy (HTTP 403)\nremote: protected branch\n\
            To http://relay/git/x/y\n ! [remote rejected] feature -> feature (pre-receive hook \
            declined)\nerror: failed to push some refs";
        let reason = "error: push denied by policy (HTTP 403)\nprotected branch".to_string();
        assert_eq!(classify_push_failure(hook), PushFailure::Rejected(reason));
        let forbidden = "fatal: unable to access 'http://relay/git/x/y/': The requested URL \
            returned error: 403";
        let PushFailure::Rejected(reason) = classify_push_failure(forbidden) else {
            panic!("a refused receive-pack is a Relay rejection");
        };
        assert!(reason.starts_with("fatal: unable to access"));
        let stale = " ! [rejected]        feature -> feature (stale info)";
        assert_eq!(classify_push_failure(stale), PushFailure::Conflict);
        let large = "error: RPC failed; HTTP 413 curl 22 The requested URL returned error: 413";
        assert_eq!(classify_push_failure(large), PushFailure::TooLarge);
        assert_eq!(
            classify_push_failure("git timed out after 120s"),
            PushFailure::Unknown
        );
        let reset = "error: RPC failed; curl 56 Recv failure: Connection reset by peer";
        assert_eq!(classify_push_failure(reset), PushFailure::Unknown);
        assert!(hook_reason(&"remote: x".repeat(400)).chars().count() <= MAX_REASON_CHARS);
    }

    #[test]
    fn failures_before_the_push_map_to_existing_reasons() {
        let op = Uuid::new_v4();
        let changed = "The source branch changed. Refresh the repository before creating a branch.";
        assert_eq!(prepare_error(changed, op).status(), StatusCode::CONFLICT);
        let default = "The repository's default branch cannot be deleted.";
        assert_eq!(prepare_error(default, op).status(), StatusCode::CONFLICT);
        let timeout = prepare_error("git timed out after 120s", op);
        assert_eq!(timeout.status(), StatusCode::GATEWAY_TIMEOUT);
        let gone = prepare_error("fatal: ... The requested URL returned error: 404", op);
        assert_eq!(gone.status(), StatusCode::NOT_FOUND);
        let down = prepare_error("fatal: unable to access: Connection refused", op);
        assert_eq!(down.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[test]
    fn the_key_is_a_uuid_header() {
        let mut headers = HeaderMap::new();
        assert_eq!(idempotency_key(&headers), None);
        headers.insert("idempotency-key", "not-a-uuid".parse().unwrap());
        assert_eq!(idempotency_key(&headers), None);
        let key = Uuid::new_v4();
        headers.insert("idempotency-key", key.to_string().parse().unwrap());
        assert_eq!(idempotency_key(&headers), Some(key));
    }
}
