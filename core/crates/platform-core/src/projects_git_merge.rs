//! DD-118 batch 2b: the original Buzz Desktop `merge_project_pull_request`
//! (fixed Buzz 779af8886caae1317b4de962082429867ab61503
//! desktop/src-tauri/src/commands/project_git_workflow.rs) for Web through BFF.
//!
//! Like branch create/delete, a merge is a collaboration data-plane write, not
//! an ActionAdmission. Web offers it only to the repository owner: the person's
//! own SERVER key must be the 30617 coordinate owner (another device key of the
//! same Human is not). Core merges the review branch into the target branch in
//! a temporary clone, pushes as that owner and only the Relay (receive-pack
//! authorization, pre-receive policy) decides. Then the owner-signed original
//! kind 1631 is published through the `projects.publish` ledger (DD-81).
//!
//! DD-81: the push is the ref update (repository, target ref, old -> new) with
//! new = the merge commit, recorded with its DISPATCH before `git push`. The
//! merge inputs, author and time are frozen with it, so a not-delivered update
//! re-creates the same commit. The same Idempotency-Key reconciles only from
//! the ref Relay advertises: new means merged (no second push, the 1631 is
//! completed), old means not delivered (push again), anything else is
//! TARGET_STATE_CONFLICT. The 1631 is keyed by the merge intent, so a retry
//! never signs a second merged status.
use crate::{
    audit::{append, AuditEntry, Evidence},
    bff::{resolve_execution_context, BffState, ExecutionContext},
    projects::{latest_pull_request_status, PUBLISH_ACTION},
    projects_git::{info_refs_error, repository_path},
    projects_git_ref::{
        advertised_state, classify_push_failure, conflict, git_audit_entry, git_auth,
        idempotency_key, is_zero, read_branch, rejected, reused, too_large, unavailable, unknown,
        within, Claim, PushFailure, RefState, ACCEPTED, CONFLICT, NOT_DELIVERED, REJECTED,
    },
    pulse::{self, CommunityScope},
    web_transport::{actor_keys, community_client, error_body, record, relay_error_response},
};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use buzz_project_git::{
    merge_author_name, normalize_branch, normalize_commit, prepare_merge_blocking,
    push_merge_blocking, MergeAuthor, MergeError, MergeErrorCode, PreparedMerge,
};
use collab_bridge::bridge::{Delivery, IdentityClient};
use collab_bridge::projects::{comment_repository, publication_observed};
use contracts::{
    ErrorClass, EvidenceKind, ProjectsGitMergeRequest, ProjectsGitMergeResponse, ReasonCode,
};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

/// Audit action of a Projects merge push. Not an ActionDefinition: like
/// `projects.git.ref` it only names the DISPATCH/OUTCOME chain of the write.
pub(crate) const GIT_MERGE_ACTION: &str = "projects.git.merge";

/// Clone, fetch and merge, however many git invocations they need.
const MERGE_DEADLINE: Duration = Duration::from_secs(180);
/// The push of one prepared merge.
const PUSH_DEADLINE: Duration = Duration::from_secs(120);

const AUTHOR: &str = "select display_name from identity.human_identity where id = $1";

/// A request reduced to the original command inputs.
#[derive(Debug, Clone, PartialEq)]
struct MergeRequest {
    /// The 30617 coordinate, as recorded with the intent.
    repository: String,
    /// `/git/{owner}/{d}`; the only path this request may reach on Relay.
    repo_path: String,
    /// The coordinate owner: the only key that may merge.
    owner: String,
    /// The original 1618 review being merged.
    pull_request_event_id: String,
    /// Normalized target branch (`refs/heads/` stripped).
    target_branch: String,
    /// Normalized review branch.
    source_branch: String,
    /// The review branch head the person saw.
    expected_commit: String,
}

impl MergeRequest {
    fn ref_name(&self) -> String {
        format!("refs/heads/{}", self.target_branch)
    }
}

fn event_id(value: &str) -> bool {
    nostr::EventId::from_hex(value).is_ok_and(|parsed| parsed.to_hex() == value)
}

fn coordinate_owner(coordinate: &str) -> Option<String> {
    coordinate
        .strip_prefix("30617:")?
        .split(':')
        .next()
        .map(str::to_owned)
}

/// Contract checks plus the original command normalization
/// (`normalize_branch_option` / `normalize_commit`, different branches).
// Keep the existing BFF HTTP refusal type; no second error wrapper.
#[allow(clippy::result_large_err)]
fn validate(request: ProjectsGitMergeRequest) -> Result<MergeRequest, Response> {
    let bad = || StatusCode::BAD_REQUEST.into_response();
    let repo_path = repository_path(&request.repository).ok_or_else(bad)?;
    let owner = coordinate_owner(&request.repository).ok_or_else(bad)?;
    let id = request.pull_request_event_id;
    if !within(&request.target_branch) || !within(&request.source_branch) || !event_id(&id) {
        return Err(bad());
    }
    let target = normalize_branch(&request.target_branch, "target").map_err(|_| bad())?;
    let source = normalize_branch(&request.source_branch, "source").map_err(|_| bad())?;
    // Original: "Source and target branches must be different." The review
    // branch lives in the same repository.
    if target == source {
        return Err(bad());
    }
    // The contract fixes lowercase hex; the original lowercases. Accept only
    // the value both agree on.
    let expected = normalize_commit(&request.expected_commit, "pull request")
        .ok()
        .filter(|commit| *commit == request.expected_commit && !is_zero(commit))
        .ok_or_else(bad)?;
    Ok(MergeRequest {
        repository: request.repository,
        repo_path,
        owner,
        pull_request_event_id: id,
        target_branch: target,
        source_branch: source,
        expected_commit: expected,
    })
}

/// DD-118 (5): only the coordinate owner's own SERVER key merges.
fn owner_may_merge(signer: &str, merge: &MergeRequest) -> bool {
    signer == merge.owner
}

/// How the named 1618 relates to the request.
#[derive(Debug, PartialEq)]
enum ReviewCheck {
    Matches,
    /// Not a review of this repository.
    OtherRepository,
    /// A review of this repository, but of other branches.
    OtherBranches,
}

/// A branch tag of the review, normalized like the request's branches.
fn review_branch(review: &nostr::Event, name: &str) -> Option<String> {
    let value = review
        .tags
        .iter()
        .map(nostr::Tag::as_slice)
        .find(|tag| tag.first().is_some_and(|field| field == name))?
        .get(1)?;
    normalize_branch(value, name).ok()
}

/// The original review tags (pullRequestMutations.ts::projectPullRequestTags):
/// `a` names the repository, `branch-name` and `target-branch` the branches.
fn review_check(review: &nostr::Event, merge: &MergeRequest) -> ReviewCheck {
    let repository = comment_repository(review).ok();
    if review.kind.as_u16() != 1618 || repository != Some(merge.repository.as_str()) {
        return ReviewCheck::OtherRepository;
    }
    let source = review_branch(review, "branch-name");
    let target = review_branch(review, "target-branch");
    if source.as_ref() == Some(&merge.source_branch)
        && target.as_ref() == Some(&merge.target_branch)
    {
        ReviewCheck::Matches
    } else {
        ReviewCheck::OtherBranches
    }
}

fn permission_denied() -> Response {
    error_body(
        StatusCode::FORBIDDEN,
        ErrorClass::Denied,
        ReasonCode::PermissionDenied,
        None,
    )
}

fn not_found() -> Response {
    error_body(
        StatusCode::NOT_FOUND,
        ErrorClass::Precondition,
        ReasonCode::TargetNotFound,
        None,
    )
}

/// A refusal before `git push`: nothing reached the target ref and nothing
/// was recorded. The original `branch_changed` / `merge_conflict`, a failed
/// `git merge` and a branch that is gone are the existing state conflict.
fn merge_error(error: &MergeError) -> Response {
    let message = error.message.as_str();
    let refused = [
        "returned error: 401",
        "returned error: 403",
        "returned error: 404",
    ];
    let gone = ["not found in upstream", "couldn't find remote ref"];
    let gone = gone.iter().any(|marker| message.contains(marker));
    if error.code != MergeErrorCode::Failed {
        conflict(None)
    } else if buzz_project_git::is_timeout_error(message) {
        unavailable(StatusCode::GATEWAY_TIMEOUT, None)
    } else if refused.iter().any(|code| message.contains(code)) {
        not_found()
    } else if message.contains("returned error: 413") {
        error_body(
            StatusCode::PAYLOAD_TOO_LARGE,
            ErrorClass::Limit,
            ReasonCode::PayloadTooLarge,
            None,
        )
    } else if gone || message.starts_with(buzz_project_git::MERGE_FAILED_PREFIX) {
        conflict(None)
    } else {
        unavailable(StatusCode::SERVICE_UNAVAILABLE, None)
    }
}

/// A panicked or cancelled blocking git task.
fn task_failed(error: tokio::task::JoinError, pushed: bool) -> MergeError {
    MergeError {
        code: MergeErrorCode::Failed,
        message: format!("merge task failed: {error}"),
        pushed,
    }
}

fn unix_now() -> i64 {
    i64::try_from(nostr::Timestamp::now().as_secs()).unwrap_or(i64::MAX)
}

/// The 1631's publication key, derived from the merge intent (its
/// Idempotency-Key and merge commit): every retry finds the same attempt.
fn status_key(key: Uuid, merge_commit: &str) -> Uuid {
    let name = format!("{GIT_MERGE_ACTION}:1631:{merge_commit}");
    Uuid::new_v5(&key, name.as_bytes())
}

/// The ledger entries `projects.publish` writes for one Community-global
/// publication, so the existing publication reconciler settles the 1631.
fn status_entry<'a>(
    ctx: &ExecutionContext,
    operation_id: Uuid,
    event_id: &str,
    event_type: &'a str,
    result: &'a str,
) -> AuditEntry<'a> {
    let event_key = crate::web_transport::publication_event_key(operation_id, event_id, event_type);
    AuditEntry {
        event_key,
        tenant_id: Some(ctx.tenant_id),
        workspace_id: None,
        operation_id,
        event_type,
        human_identity_id: Some(ctx.human_identity_id),
        initiator_principal_id: Some(ctx.tenant_principal_id),
        actor_principal_id: Some(ctx.tenant_principal_id),
        action_key: PUBLISH_ACTION,
        action_version: 1,
        component_type_key: "buzz",
        // Review lifecycle events are Community-global (is_global_only_kind).
        target_type: Some("TENANT"),
        target_id: Some(ctx.tenant_id),
        parameter_hash: "NONE",
        decision: "ALLOW",
        result_code: result,
        result_exposure: "NONE",
        evidence_refs: vec![
            Evidence::new(EvidenceKind::BuzzEventId, event_id),
            Evidence::new(EvidenceKind::PlatformSessionId, ctx.session_id),
        ],
        correlation_id: operation_id,
    }
}

/// One admitted merge request: the person, their Relay identity and the
/// repository root it may reach.
struct Call<'a> {
    state: &'a BffState,
    ctx: &'a ExecutionContext,
    before: CommunityScope,
    client: Arc<IdentityClient>,
    clone_url: String,
    signer: String,
    key: Uuid,
}

/// A merge that reached the target ref.
struct Merged {
    /// The push operation.
    operation_id: Uuid,
    merge_commit: String,
}

#[derive(sqlx::FromRow)]
struct MergeAttempt {
    operation_id: Uuid,
    repository: String,
    ref_name: String,
    source_branch: Option<String>,
    old_commit: String,
    new_commit: String,
    pull_request_event_id: Option<String>,
    source_commit: Option<String>,
    merge_author_name: Option<String>,
    merge_author_email: Option<String>,
    merged_at: Option<i64>,
    result: Option<String>,
}

impl MergeAttempt {
    /// The key names this merge: the review, its branches and expected head.
    fn same_request(&self, merge: &MergeRequest) -> bool {
        self.repository == merge.repository
            && self.ref_name == merge.ref_name()
            && self.source_branch.as_ref() == Some(&merge.source_branch)
            && self.pull_request_event_id.as_ref() == Some(&merge.pull_request_event_id)
            && self.source_commit.as_ref() == Some(&merge.expected_commit)
    }

    /// The author, committer and time frozen with the intent.
    fn author(&self) -> Option<MergeAuthor> {
        Some(MergeAuthor {
            name: self.merge_author_name.clone()?,
            email: self.merge_author_email.clone()?,
            time: self.merged_at?,
        })
    }

    fn merged(&self) -> Merged {
        Merged {
            operation_id: self.operation_id,
            merge_commit: self.new_commit.clone(),
        }
    }
}

const ATTEMPT: &str = "select a.operation_id, a.repository, a.ref_name, a.source_branch,
        a.old_commit, a.new_commit, a.pull_request_event_id, a.source_commit,
        a.merge_author_name, a.merge_author_email, a.merged_at,
        (select r.result_code from audit.audit_event r
          where r.operation_id = a.operation_id
            and r.event_type in ('OUTCOME', 'RECONCILIATION')
          order by r.occurred_at desc limit 1) as result
   from admission.git_push_attempt a
   where a.tenant_principal_id = $1 and a.idempotency_key = $2";

#[derive(sqlx::FromRow)]
struct StatusAttempt {
    operation_id: Uuid,
    event_id: String,
    message_kind: i32,
    parent_event_id: Option<String>,
    result: Option<String>,
}

impl StatusAttempt {
    fn same_status(&self, merge: &MergeRequest) -> bool {
        self.message_kind == 1631
            && self.parent_event_id.as_ref() == Some(&merge.pull_request_event_id)
    }
}

const STATUS_ATTEMPT: &str = "select a.operation_id, a.event_id, a.message_kind,
        a.parent_event_id,
        (select r.result_code from audit.audit_event r
          where r.operation_id = a.operation_id
            and r.event_type in ('OUTCOME', 'RECONCILIATION')
          order by r.occurred_at desc limit 1) as result
   from admission.publish_attempt a
   where a.tenant_principal_id = $1 and a.idempotency_key = $2";

/// Relay reads are external I/O: never push or sign with an admission or a key
/// revoked meanwhile (the same re-check as branch pushes).
async fn readmit(call: &Call<'_>) -> Result<(), Response> {
    let scope = pulse::admit(call.state, call.ctx).await?;
    let keys = actor_keys(call.state, call.ctx).await?;
    if scope != call.before || keys.public_key().to_hex() != call.signer {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    Ok(())
}

/// As for branch pushes: an outcome that cannot be written does not change the
/// answer; the next request with the same key reconciles.
async fn settle(
    call: &Call<'_>,
    operation_id: Uuid,
    event_type: &'static str,
    result_code: &'static str,
) {
    let entry = git_audit_entry(
        call.ctx,
        GIT_MERGE_ACTION,
        operation_id,
        event_type,
        result_code,
        &call.signer,
    );
    if let Err(error) = record(call.state, entry).await {
        tracing::warn!(error = %error, "Projects merge outcome audit not written");
    }
}

/// As `projects.publish`: an outcome that cannot be written does not change the
/// answer; the publication reconciler settles the DISPATCH by its event id.
async fn record_status(
    call: &Call<'_>,
    operation_id: Uuid,
    event_id: &str,
    event_type: &'static str,
    result: &'static str,
) {
    let entry = status_entry(call.ctx, operation_id, event_id, event_type, result);
    if let Err(error) = record(call.state, entry).await {
        tracing::warn!(error = %error, "Merged review status audit not written");
    }
}

/// The 1618 being merged, as Relay serves it to this person.
async fn read_review(
    state: &BffState,
    client: &IdentityClient,
    merge: &MergeRequest,
) -> Result<nostr::Event, Response> {
    let id = merge.pull_request_event_id.as_str();
    let filter = json!({"ids": [id], "kinds": [1618], "limit": 1});
    let page = client
        .query(&state.http, &[filter])
        .await
        .map_err(|error| relay_error_response(&error, None))?;
    let events: Vec<nostr::Event> =
        serde_json::from_value(page).map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
    let [review] = events.as_slice() else {
        return Err(not_found());
    };
    if review.id.to_hex() != id || review.verify().is_err() {
        return Err(StatusCode::BAD_GATEWAY.into_response());
    }
    match review_check(review, merge) {
        ReviewCheck::Matches => Ok(review.clone()),
        ReviewCheck::OtherRepository => Err(not_found()),
        ReviewCheck::OtherBranches => Err(conflict(None)),
    }
}

/// DD-118 (5): HumanIdentity display name and `<pubkey>@<community host>`,
/// frozen with the intent so a resent update makes the same merge commit.
async fn merge_author(call: &Call<'_>) -> Result<MergeAuthor, Response> {
    let name: String = sqlx::query_scalar(AUTHOR)
        .bind(call.ctx.human_identity_id)
        .fetch_one(&call.state.pool)
        .await
        .map_err(|error| {
            tracing::warn!(error = %error, "Projects merge author unreadable");
            unavailable(StatusCode::SERVICE_UNAVAILABLE, None)
        })?;
    Ok(MergeAuthor {
        name: merge_author_name(&name),
        email: format!("{}@{}", call.signer, call.before.community_host),
        time: unix_now(),
    })
}

/// The original merge in a temporary clone, as the coordinate owner. Nothing
/// is pushed; the clone lives in the returned value until the push.
async fn prepare(
    call: &Call<'_>,
    merge: &MergeRequest,
    author: &MergeAuthor,
) -> Result<PreparedMerge, Response> {
    let auth = git_auth(&call.client, &merge.repo_path, MERGE_DEADLINE);
    let url = call.clone_url.clone();
    let work = merge.clone();
    let author = author.clone();
    let prepared = tokio::task::spawn_blocking(move || {
        prepare_merge_blocking(
            &url,
            &work.target_branch,
            &work.source_branch,
            &work.expected_commit,
            &author,
            &auth,
        )
    })
    .await
    .unwrap_or_else(|error| Err(task_failed(error, false)));
    prepared.map_err(|error| {
        let code = error.code.as_str();
        tracing::warn!(code, error = %error.message, "Projects merge refused before the push");
        merge_error(&error)
    })
}

async fn read_target(call: &Call<'_>, merge: &MergeRequest) -> Result<Option<String>, String> {
    let (url, path) = (&call.clone_url, &merge.repo_path);
    read_branch(&call.client, url, path, &merge.target_branch).await
}

/// Intent and DISPATCH in one transaction, before any push. A retry that was
/// confirmed not delivered re-points the key at the new attempt, provided the
/// key still names the previous one.
async fn dispatch(
    call: &Call<'_>,
    merge: &MergeRequest,
    author: &MergeAuthor,
    prepared: &PreparedMerge,
    operation_id: Uuid,
    replaces: Option<Uuid>,
) -> Result<Claim, sqlx::Error> {
    let principal = call.ctx.tenant_principal_id;
    let mut tx = call.state.pool.begin().await?;
    let claimed = match replaces {
        Some(previous) => sqlx::query(
            "update admission.git_push_attempt
             set operation_id = $3, created_at = now()
             where tenant_principal_id = $1 and idempotency_key = $2 and operation_id = $4",
        )
        .bind(principal)
        .bind(call.key)
        .bind(operation_id)
        .bind(previous)
        .execute(&mut *tx)
        .await?
        .rows_affected(),
        None => sqlx::query(
            "insert into admission.git_push_attempt
                 (tenant_principal_id, idempotency_key, operation_id, repository, ref_name,
                  source_branch, old_commit, new_commit, pull_request_event_id,
                  source_commit, merge_author_name, merge_author_email, merged_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             on conflict do nothing",
        )
        .bind(principal)
        .bind(call.key)
        .bind(operation_id)
        .bind(&merge.repository)
        .bind(merge.ref_name())
        .bind(&merge.source_branch)
        .bind(&prepared.target_commit)
        .bind(&prepared.merge_commit)
        .bind(&merge.pull_request_event_id)
        .bind(&merge.expected_commit)
        .bind(&author.name)
        .bind(&author.email)
        .bind(author.time)
        .execute(&mut *tx)
        .await?
        .rows_affected(),
    };
    if claimed == 0 {
        let frozen = sqlx::query_as::<_, MergeAttempt>(ATTEMPT)
            .bind(principal)
            .bind(call.key)
            .fetch_one(&mut *tx)
            .await?;
        return Ok(if frozen.same_request(merge) {
            Claim::Pending(frozen.operation_id)
        } else {
            Claim::Reused
        });
    }
    let entry = git_audit_entry(
        call.ctx,
        GIT_MERGE_ACTION,
        operation_id,
        "DISPATCH",
        "DISPATCHED",
        &call.signer,
    );
    append(&mut tx, entry).await?;
    tx.commit().await?;
    Ok(Claim::Acquired)
}

/// DD-81: the ref update (target, old -> merge commit) and its DISPATCH are
/// durable before `git push`; a failed push is reconciled from the ref.
async fn push(
    call: &Call<'_>,
    merge: &MergeRequest,
    author: &MergeAuthor,
    prepared: PreparedMerge,
    replaces: Option<Uuid>,
) -> Result<Merged, Response> {
    readmit(call).await?;
    // The push is a Relay write: take Core's Relay budget before DISPATCH.
    let client = &call.client;
    client
        .admit()
        .map_err(|error| relay_error_response(&error, None))?;

    let operation = Uuid::new_v4();
    match dispatch(call, merge, author, &prepared, operation, replaces).await {
        Ok(Claim::Acquired) => {}
        Ok(Claim::Pending(current)) => return Err(unknown(current)),
        Ok(Claim::Reused) => return Err(reused()),
        Err(error) => {
            tracing::warn!(error = %error, "Projects merge DISPATCH not written; not pushing");
            return Err(unavailable(StatusCode::SERVICE_UNAVAILABLE, None));
        }
    }

    let old = prepared.target_commit.clone();
    let new = prepared.merge_commit.clone();
    let merged = Merged {
        operation_id: operation,
        merge_commit: new.clone(),
    };
    let auth = git_auth(client, &merge.repo_path, PUSH_DEADLINE);
    let pushed = tokio::task::spawn_blocking(move || push_merge_blocking(&prepared, &auth))
        .await
        .unwrap_or_else(|error| Err(task_failed(error, true)));
    let failure = match pushed {
        Ok(()) => {
            settle(call, operation, "OUTCOME", ACCEPTED).await;
            return Ok(merged);
        }
        Err(failure) => failure,
    };
    tracing::warn!(error = %failure.message, "Projects merge push failed");
    // git push ran: the remote may have applied the update before failing.
    let remote = read_target(call, merge).await;
    let remote = remote.map(|head| advertised_state(head.as_deref(), &old, &new));
    match (remote, classify_push_failure(&failure.message)) {
        (Ok(RefState::Delivered), _) => {
            settle(call, operation, "OUTCOME", ACCEPTED).await;
            Ok(merged)
        }
        (_, PushFailure::Rejected(reason)) => {
            tracing::info!(reason = %reason, "Relay refused the Projects merge push");
            settle(call, operation, "OUTCOME", REJECTED).await;
            Err(rejected(operation))
        }
        (_, PushFailure::TooLarge) => {
            settle(call, operation, "OUTCOME", NOT_DELIVERED).await;
            Err(too_large(operation))
        }
        (_, PushFailure::Conflict) => {
            settle(call, operation, "OUTCOME", NOT_DELIVERED).await;
            Err(conflict(Some(operation)))
        }
        (Ok(RefState::Moved), PushFailure::Unknown) => {
            settle(call, operation, "OUTCOME", CONFLICT).await;
            Err(conflict(Some(operation)))
        }
        // Still at old, or unreadable: the push may yet land. No outcome; the
        // same key reconciles before it may push again.
        (Ok(RefState::NotDelivered) | Err(_), PushFailure::Unknown) => Err(unknown(operation)),
    }
}

/// A new key: merge, record old -> new with its DISPATCH, then push.
async fn fresh(call: &Call<'_>, merge: &MergeRequest) -> Result<Merged, Response> {
    let author = merge_author(call).await?;
    let prepared = prepare(call, merge, &author).await?;
    push(call, merge, &author, prepared, None).await
}

/// The same key again: answer from the recorded outcome, else from the ref
/// Relay advertises. New is merged, old is not delivered (the same merge is
/// re-created from the frozen inputs and pushed again), anything else is a
/// conflict.
async fn resume(
    call: &Call<'_>,
    merge: &MergeRequest,
    attempt: MergeAttempt,
) -> Result<Merged, Response> {
    let id = attempt.operation_id;
    match attempt.result.as_deref() {
        Some(ACCEPTED) => return Ok(attempt.merged()),
        Some(REJECTED) => return Err(rejected(id)),
        // NOT_DELIVERED, CONFLICT or no outcome yet: ask Relay first.
        _ => {}
    }
    let remote = match read_target(call, merge).await {
        Ok(remote) => remote,
        Err(error) => {
            tracing::warn!(error = %error, "Projects merge reconciliation failed");
            return Err(unknown(id));
        }
    };
    let (old, new) = (&attempt.old_commit, &attempt.new_commit);
    match advertised_state(remote.as_deref(), old, new) {
        RefState::Delivered => {
            settle(call, id, "RECONCILIATION", ACCEPTED).await;
            Ok(attempt.merged())
        }
        RefState::Moved => {
            if attempt.result.is_none() {
                settle(call, id, "RECONCILIATION", CONFLICT).await;
            }
            Err(conflict(Some(id)))
        }
        RefState::NotDelivered => {
            let author = attempt.author().ok_or_else(|| conflict(Some(id)))?;
            let prepared = prepare(call, merge, &author).await?;
            // Only the recorded update may be pushed under this key.
            if prepared.target_commit != *old || prepared.merge_commit != *new {
                return Err(conflict(Some(id)));
            }
            push(call, merge, &author, prepared, Some(id)).await
        }
    }
}

/// The 1631 publication intent and its DISPATCH in one transaction, as
/// `projects.publish` records them.
async fn dispatch_status(
    call: &Call<'_>,
    merge: &MergeRequest,
    key: Uuid,
    operation: Uuid,
    event_id: &str,
    replaces: Option<Uuid>,
) -> Result<Claim, sqlx::Error> {
    let principal = call.ctx.tenant_principal_id;
    let mut tx = call.state.pool.begin().await?;
    let claimed = match replaces {
        Some(previous) => sqlx::query(
            "update admission.publish_attempt
             set operation_id = $3, event_id = $4, created_at = now()
             where tenant_principal_id = $1 and idempotency_key = $2 and operation_id = $5",
        )
        .bind(principal)
        .bind(key)
        .bind(operation)
        .bind(event_id)
        .bind(previous)
        .execute(&mut *tx)
        .await?
        .rows_affected(),
        None => sqlx::query(
            "insert into admission.publish_attempt
                 (tenant_principal_id, idempotency_key, operation_id, event_id, message_kind,
                  parent_event_id)
             values ($1, $2, $3, $4, 1631, $5) on conflict do nothing",
        )
        .bind(principal)
        .bind(key)
        .bind(operation)
        .bind(event_id)
        .bind(&merge.pull_request_event_id)
        .execute(&mut *tx)
        .await?
        .rows_affected(),
    };
    if claimed == 0 {
        let frozen = sqlx::query_as::<_, StatusAttempt>(STATUS_ATTEMPT)
            .bind(principal)
            .bind(key)
            .fetch_one(&mut *tx)
            .await?;
        return Ok(if frozen.same_status(merge) {
            Claim::Pending(frozen.operation_id)
        } else {
            Claim::Reused
        });
    }
    let entry = status_entry(call.ctx, operation, event_id, "DISPATCH", "DISPATCHED");
    append(&mut tx, entry).await?;
    tx.commit().await?;
    Ok(Claim::Acquired)
}

/// Sign the owner's 1631 after the newest trusted lifecycle event and publish
/// it once. `None`: Relay refused it; like the original, the merge stands.
async fn publish_status(
    call: &Call<'_>,
    merge: &MergeRequest,
    review: &nostr::Event,
    merged: &Merged,
    key: Uuid,
    replaces: Option<Uuid>,
) -> Result<Option<String>, Response> {
    // The merge already stands: until the status is dispatched, any failure
    // leaves it to the same key.
    let pending = || unknown(merged.operation_id);
    let client = &call.client;
    let host = call.before.community_host.as_str();
    let latest = latest_pull_request_status(call.state, client, review, host).await;
    let latest = latest.map_err(|_| pending())?;
    let event = client.sign_merged_status(review, latest.as_ref(), &merged.merge_commit);
    let event = event.map_err(|error| {
        tracing::warn!(error = %error, "Merged review status not signed");
        pending()
    })?;
    readmit(call).await.map_err(|_| pending())?;
    let admitted = client.admit().map_err(|_| pending())?;

    let event_id = event.id.to_hex();
    let operation = Uuid::new_v4();
    match dispatch_status(call, merge, key, operation, &event_id, replaces).await {
        Ok(Claim::Acquired) => {}
        Ok(Claim::Pending(current)) => return Err(unknown(current)),
        Ok(Claim::Reused) => return Err(reused()),
        Err(error) => {
            tracing::warn!(error = %error, "Merged review status DISPATCH not written");
            return Err(pending());
        }
    }
    match client.deliver(&call.state.http, &event, admitted).await {
        Delivery::Accepted => {
            record_status(call, operation, &event_id, "OUTCOME", ACCEPTED).await;
            Ok(Some(event_id))
        }
        Delivery::Rejected(reason) => {
            tracing::warn!(reason = %reason, "Relay refused the merged review status");
            record_status(call, operation, &event_id, "OUTCOME", REJECTED).await;
            Ok(None)
        }
        Delivery::Limited(_, reason) => {
            tracing::warn!(reason = %reason, "Relay limited the merged review status");
            record_status(call, operation, &event_id, "OUTCOME", NOT_DELIVERED).await;
            Err(unknown(operation))
        }
        Delivery::Unknown(reason) => {
            tracing::warn!(error = %reason, "Merged review status result unknown");
            Err(unknown(operation))
        }
    }
}

/// A dispatched 1631 without an outcome is delivered only if Relay holds that
/// exact signed event; otherwise its result stays unknown (DD-81).
async fn observe_status(
    call: &Call<'_>,
    attempt: &StatusAttempt,
) -> Result<Option<String>, Response> {
    let id = attempt.operation_id;
    let event_id = attempt.event_id.as_str();
    let filter = json!({"ids": [event_id], "authors": [call.signer], "kinds": [1631]});
    let page = call.client.query(&call.state.http, &[filter]).await;
    let page = page.map_err(|_| unknown(id))?;
    let observed = publication_observed(page, event_id, &call.signer, 1631);
    if !matches!(observed, Ok(true)) {
        return Err(unknown(id));
    }
    record_status(call, id, event_id, "RECONCILIATION", ACCEPTED).await;
    Ok(Some(event_id.to_owned()))
}

/// DD-81 for the owner-signed 1631: one publication attempt per merge intent,
/// so a retry reconciles instead of signing a second merged status.
async fn ensure_status(
    call: &Call<'_>,
    merge: &MergeRequest,
    review: &nostr::Event,
    merged: &Merged,
) -> Result<Option<String>, Response> {
    let key = status_key(call.key, &merged.merge_commit);
    let previous = sqlx::query_as::<_, StatusAttempt>(STATUS_ATTEMPT)
        .bind(call.ctx.tenant_principal_id)
        .bind(key)
        .fetch_optional(&call.state.pool)
        .await
        .map_err(|error| {
            tracing::warn!(error = %error, "Merged review status intent unreadable");
            unknown(merged.operation_id)
        })?;
    let replaces = match previous {
        None => None,
        Some(attempt) if !attempt.same_status(merge) => return Err(reused()),
        Some(attempt) => match attempt.result.as_deref() {
            Some(ACCEPTED) => return Ok(Some(attempt.event_id)),
            Some(REJECTED) => return Ok(None),
            Some(NOT_DELIVERED) => Some(attempt.operation_id),
            // Dispatched without an outcome: only Relay can tell.
            _ => return observe_status(call, &attempt).await,
        },
    };
    publish_status(call, merge, review, merged, key, replaces).await
}

pub(crate) async fn merge(
    State(state): State<BffState>,
    headers: HeaderMap,
    Json(request): Json<ProjectsGitMergeRequest>,
) -> Response {
    match merge_inner(&state, &headers, request).await {
        Ok(value) => (
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            Json(value),
        )
            .into_response(),
        Err(error) => error,
    }
}

async fn merge_inner(
    state: &BffState,
    headers: &HeaderMap,
    request: ProjectsGitMergeRequest,
) -> Result<ProjectsGitMergeResponse, Response> {
    let ctx = resolve_execution_context(state, headers).await?;
    let merge = validate(request)?;
    // DD-81, as for every git write: without a key a retry could only push again.
    let key = idempotency_key(headers).ok_or_else(|| StatusCode::BAD_REQUEST.into_response())?;
    let before = pulse::admit(state, &ctx).await?;
    let keys = actor_keys(state, &ctx).await?;
    let signer = keys.public_key().to_hex();
    if !owner_may_merge(&signer, &merge) {
        return Err(permission_denied());
    }
    let client = Arc::new(community_client(state, &keys, &before.community_host)?);
    // Relay decides with the person's own identity before anything is recorded.
    client
        .git_info_refs(&state.http, &merge.repo_path)
        .await
        .map_err(|error| info_refs_error(&error))?;
    let clone_url = client
        .git_remote_url(&merge.repo_path)
        .map_err(|error| relay_error_response(&error, None))?;
    let review = read_review(state, &client, &merge).await?;
    let call = Call {
        state,
        ctx: &ctx,
        before,
        client,
        clone_url,
        signer,
        key,
    };

    let previous = sqlx::query_as::<_, MergeAttempt>(ATTEMPT)
        .bind(ctx.tenant_principal_id)
        .bind(key)
        .fetch_optional(&state.pool)
        .await
        .map_err(|error| {
            tracing::warn!(error = %error, "Projects merge intent unreadable");
            unavailable(StatusCode::SERVICE_UNAVAILABLE, None)
        })?;
    let merged = match previous {
        None => fresh(&call, &merge).await?,
        Some(attempt) if !attempt.same_request(&merge) => return Err(reused()),
        Some(attempt) => resume(&call, &merge, attempt).await?,
    };
    let status_event_id = ensure_status(&call, &merge, &review, &merged).await?;
    Ok(ProjectsGitMergeResponse {
        merge_commit: merged.merge_commit,
        status_event_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_project_git::MERGE_FAILED_PREFIX;
    use nostr::{EventBuilder, Keys, Kind, Tag};
    use serde_json::Value;

    fn owner_hex() -> String {
        "a".repeat(64)
    }

    fn coordinate() -> String {
        format!("30617:{}:repo", owner_hex())
    }

    fn request(target: &str, source: &str, commit: &str) -> Value {
        json!({
            "repository": coordinate(), "pullRequestEventId": "d".repeat(64),
            "targetBranch": target, "sourceBranch": source, "expectedCommit": commit
        })
    }

    fn checked(value: Value) -> Option<MergeRequest> {
        let request: ProjectsGitMergeRequest = serde_json::from_value(value).unwrap();
        validate(request).ok()
    }

    fn review(keys: &Keys, tags: &[[&str; 2]]) -> nostr::Event {
        let tags = tags.iter().map(|tag| Tag::parse(*tag).unwrap());
        EventBuilder::new(Kind::from(1618), "review")
            .tags(tags)
            .sign_with_keys(keys)
            .unwrap()
    }

    #[test]
    fn requests_keep_the_original_normalization_and_contract_bounds() {
        let commit = "b".repeat(40);
        let merge = checked(request("refs/heads/main", "feature/x", &commit)).unwrap();
        assert_eq!(merge.target_branch, "main");
        assert_eq!(merge.source_branch, "feature/x");
        assert_eq!(merge.ref_name(), "refs/heads/main");
        assert_eq!(merge.owner, owner_hex());
        assert_eq!(merge.repo_path, format!("/git/{}/repo", owner_hex()));
        assert_eq!(merge.expected_commit, commit);
        assert_eq!(merge.pull_request_event_id, "d".repeat(64));

        assert!(checked(request("main", "refs/heads/main", &commit)).is_none());
        assert!(checked(request("main", "--upload-pack=x", &commit)).is_none());
        assert!(checked(request("main", "feature/../x", &commit)).is_none());
        assert!(checked(request("main", &"f".repeat(256), &commit)).is_none());
        assert!(checked(request("main", "feature", &"B".repeat(40))).is_none());
        assert!(checked(request("main", "feature", &"0".repeat(64))).is_none());
        assert!(checked(request("main", "feature", "abc")).is_none());
        let mut foreign = request("main", "feature", &commit);
        foreign["repository"] = json!("30617:x:repo");
        assert!(checked(foreign).is_none());
        let mut event = request("main", "feature", &commit);
        event["pullRequestEventId"] = json!("D".repeat(64));
        assert!(checked(event).is_none());
    }

    #[test]
    fn only_the_coordinate_owner_key_may_merge() {
        let merge = checked(request("main", "feature", &"b".repeat(40))).unwrap();
        assert!(owner_may_merge(&owner_hex(), &merge));
        assert!(!owner_may_merge(&"b".repeat(64), &merge));
        assert!(!owner_may_merge("", &merge));
    }

    #[test]
    fn the_review_must_name_this_repository_and_these_branches() {
        let owner = Keys::generate();
        let author = Keys::generate();
        let repository = format!("30617:{}:repo", owner.public_key().to_hex());
        let mut value = request("main", "feature/x", &"b".repeat(40));
        value["repository"] = json!(repository);
        let merge = checked(value).unwrap();
        let tags = |target| {
            [
                ["a", repository.as_str()],
                ["branch-name", "refs/heads/feature/x"],
                ["target-branch", target],
            ]
        };
        let matching = review(&author, &tags("main"));
        assert_eq!(review_check(&matching, &merge), ReviewCheck::Matches);
        let other_target = review(&author, &tags("develop"));
        assert_eq!(
            review_check(&other_target, &merge),
            ReviewCheck::OtherBranches
        );
        let bare = review(&author, &[["a", repository.as_str()]]);
        assert_eq!(review_check(&bare, &merge), ReviewCheck::OtherBranches);
        let elsewhere = format!("30617:{}:other", owner.public_key().to_hex());
        let foreign_review = review(&author, &[["a", elsewhere.as_str()]]);
        assert_eq!(
            review_check(&foreign_review, &merge),
            ReviewCheck::OtherRepository
        );
        let task = EventBuilder::new(Kind::from(1621), "task")
            .tags([Tag::parse(["a", repository.as_str()]).unwrap()])
            .sign_with_keys(&author)
            .unwrap();
        assert_eq!(review_check(&task, &merge), ReviewCheck::OtherRepository);
    }

    #[test]
    fn same_request_compares_the_whole_merge_intent() {
        let commit = "b".repeat(40);
        let merge = checked(request("main", "feature", &commit)).unwrap();
        let attempt = |source: &str, expected: &str| MergeAttempt {
            operation_id: Uuid::new_v4(),
            repository: coordinate(),
            ref_name: "refs/heads/main".into(),
            source_branch: Some(source.into()),
            old_commit: "c".repeat(40),
            new_commit: "e".repeat(40),
            pull_request_event_id: Some("d".repeat(64)),
            source_commit: Some(expected.into()),
            merge_author_name: Some("Ada".into()),
            merge_author_email: Some("a@community.example".into()),
            merged_at: Some(1_700_000_000),
            result: None,
        };
        let frozen = attempt("feature", &commit);
        assert!(frozen.same_request(&merge));
        assert_eq!(frozen.author().unwrap().time, 1_700_000_000);
        assert_eq!(frozen.merged().merge_commit, "e".repeat(40));
        assert!(!attempt("other", &commit).same_request(&merge));
        assert!(!attempt("feature", &"f".repeat(40)).same_request(&merge));
        // A branch push under the same key is another intent.
        let branch = MergeAttempt {
            pull_request_event_id: None,
            source_commit: None,
            ..attempt("feature", &commit)
        };
        assert!(!branch.same_request(&merge));
        assert!(branch.author().is_some());
        let unfrozen = MergeAttempt {
            merged_at: None,
            ..attempt("feature", &commit)
        };
        assert!(unfrozen.author().is_none());
    }

    #[test]
    fn the_status_key_is_derived_from_the_merge_intent() {
        let key = Uuid::new_v4();
        let commit = "e".repeat(40);
        let derived = status_key(key, &commit);
        assert_eq!(derived, status_key(key, &commit));
        assert_ne!(derived, key);
        assert_ne!(derived, status_key(key, &"f".repeat(40)));
        assert_ne!(derived, status_key(Uuid::new_v4(), &commit));
    }

    #[test]
    fn status_entries_use_the_projects_publication_ledger() {
        let ctx = ExecutionContext {
            human_identity_id: Uuid::new_v4(),
            tenant_id: Uuid::new_v4(),
            tenant_principal_id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            access_mode: contracts::PlatformSessionAccessMode::Full,
        };
        let op = Uuid::new_v4();
        let id = "f".repeat(64);
        let dispatch = status_entry(&ctx, op, &id, "DISPATCH", "DISPATCHED");
        let expected = format!("message.publish:{id}:{op}:DISPATCH");
        assert_eq!(dispatch.event_key, expected);
        assert_eq!(dispatch.action_key, PUBLISH_ACTION);
        assert_eq!(dispatch.target_type, Some("TENANT"));
        assert_eq!(dispatch.target_id, Some(ctx.tenant_id));
        assert_eq!(dispatch.workspace_id, None);
        let outcome = status_entry(&ctx, op, &id, "OUTCOME", ACCEPTED);
        assert_eq!(
            outcome.event_key,
            format!("message.publish:{id}:{op}:OUTCOME")
        );
        let reconciled = status_entry(&ctx, op, &id, "RECONCILIATION", ACCEPTED);
        let expected = format!("message.publish:{id}:{op}:RECONCILIATION");
        assert_eq!(reconciled.event_key, expected);
    }

    #[test]
    fn refusals_before_the_push_map_to_existing_reasons() {
        fn status(code: MergeErrorCode, message: &str) -> StatusCode {
            let error = MergeError {
                code,
                message: message.to_owned(),
                pushed: false,
            };
            merge_error(&error).status()
        }
        let moved = StatusCode::CONFLICT;
        assert_eq!(status(MergeErrorCode::BranchChanged, "x"), moved);
        assert_eq!(status(MergeErrorCode::Conflict, "x"), moved);
        let unrelated = format!("{MERGE_FAILED_PREFIX} fatal: refusing to merge");
        assert_eq!(status(MergeErrorCode::Failed, &unrelated), moved);
        let gone = "fatal: Remote branch main not found in upstream origin";
        assert_eq!(status(MergeErrorCode::Failed, gone), moved);
        let timeout = "git timed out after 60s";
        let timeout = status(MergeErrorCode::Failed, timeout);
        assert_eq!(timeout, StatusCode::GATEWAY_TIMEOUT);
        let refused = "fatal: unable to access: The requested URL returned error: 403";
        let refused = status(MergeErrorCode::Failed, refused);
        assert_eq!(refused, StatusCode::NOT_FOUND);
        let down = status(MergeErrorCode::Failed, "fatal: Connection refused");
        assert_eq!(down, StatusCode::SERVICE_UNAVAILABLE);
    }
}
