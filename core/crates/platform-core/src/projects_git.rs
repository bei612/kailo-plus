//! DD-118 batch 1: the original Buzz Desktop remote repository reads
//! (`get_project_repo_snapshot` / `get_project_repo_file_content` /
//! `get_project_repo_diff`, fixed Buzz 779af8886caae1317b4de962082429867ab61503
//! desktop/src-tauri/src/commands/project_git*.rs) for Web through BFF.
//!
//! Relay git storage is the only content and authorization authority. The
//! Browser names a repository only by its 30617 coordinate; Core derives the
//! smart HTTP repository root from the trusted Community binding, signs NIP-98
//! with the person's own SERVER key for every request and git invocation, and
//! lets Relay `authorize_git_read` decide. No clone URL, filter or NIP-98 comes
//! from the Browser, and nothing is cached.
use crate::{
    bff::{resolve_execution_context, BffState},
    pulse,
    web_transport::{actor_keys, community_client, error_body, relay_error_response},
};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use buzz_project_git::{GitAuth, GitAuthConfig};
use collab_bridge::operator::OperatorError;
use contracts::{
    ErrorClass, ProjectRepoCommit, ProjectRepoContributor, ProjectRepoDiff, ProjectRepoDiffFile,
    ProjectRepoFile, ProjectRepoSnapshot, ProjectsGitQueryRequest, ProjectsGitQueryRequestView,
    ProjectsGitQueryResponse, ReasonCode,
};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// One Web read, however many git invocations it needs. The original
/// per-invocation caps (60 s local, 300 s remote) alone would let a single
/// request hold a blocking thread for many minutes.
const QUERY_DEADLINE: Duration = Duration::from_secs(120);

/// Contract bound on `defaultBranch` / `baseBranch` / `targetRef`.
pub(crate) const MAX_REF_CHARS: usize = 255;
/// Contract bound on `path`.
const MAX_PATH_CHARS: usize = 4096;

/// A request reduced to what the original commands receive.
#[derive(Debug, PartialEq)]
struct GitRead {
    view: ProjectsGitQueryRequestView,
    /// `/git/{owner}/{d}`; the only path this request may reach on Relay.
    repo_path: String,
    default_branch: Option<String>,
    base_branch: Option<String>,
    target_ref: Option<String>,
    target_commit: Option<String>,
    path: Option<String>,
}

fn repo_name_byte(c: u8) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-')
}

fn lower_hex(value: &str) -> bool {
    value
        .bytes()
        .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

/// `/git/{owner}/{d}` for a 30617 coordinate, accepted only in the exact shape
/// the Relay git routes serve (fixed Buzz crates/buzz-relay/src/api/git/
/// transport.rs `validate_repo_id`): owner is 64 lowercase hex, `d` is
/// `[A-Za-z0-9._-]{1,64}` without a leading dot or `..`. A `.git` suffix is
/// refused because Relay strips it and would serve a different repository.
pub(crate) fn repository_path(coordinate: &str) -> Option<String> {
    let (owner, d) = coordinate.strip_prefix("30617:")?.split_once(':')?;
    let owner_ok = owner.len() == 64 && lower_hex(owner);
    let d_ok = !d.is_empty()
        && d.len() <= 64
        && !d.starts_with('.')
        && !d.contains("..")
        && !d.ends_with(".git")
        && d.bytes().all(repo_name_byte);
    (owner_ok && d_ok).then(|| format!("/git/{owner}/{d}"))
}

fn within(value: Option<&str>, max_chars: usize) -> bool {
    match value {
        Some(value) => !value.is_empty() && value.chars().count() <= max_chars,
        None => true,
    }
}

/// Contract checks only. Branch and ref values keep the original commands'
/// normalization (`clean_branch` / `clean_target_ref` drop unusable values).
// Keep the existing BFF HTTP refusal type; no second error wrapper.
#[allow(clippy::result_large_err)]
fn validate(request: ProjectsGitQueryRequest) -> Result<GitRead, Response> {
    let bad = || StatusCode::BAD_REQUEST.into_response();
    let repo_path = repository_path(&request.repository).ok_or_else(bad)?;
    let refs_ok = within(request.default_branch.as_deref(), MAX_REF_CHARS)
        && within(request.base_branch.as_deref(), MAX_REF_CHARS)
        && within(request.target_ref.as_deref(), MAX_REF_CHARS);
    let commit_ok = match request.target_commit.as_deref() {
        Some(commit) => matches!(commit.len(), 40 | 64) && lower_hex(commit),
        None => true,
    };
    let path_ok = match (&request.view, request.path.as_deref()) {
        (ProjectsGitQueryRequestView::FileContent, Some(path)) => {
            within(Some(path), MAX_PATH_CHARS)
                && buzz_project_git::validate_repo_file_path(path).is_ok()
        }
        (ProjectsGitQueryRequestView::FileContent, None) => false,
        (_, path) => path.is_none(),
    };
    if !(refs_ok && commit_ok && path_ok) {
        return Err(bad());
    }
    Ok(GitRead {
        view: request.view,
        repo_path,
        default_branch: request.default_branch,
        base_branch: request.base_branch,
        target_ref: request.target_ref,
        target_commit: request.target_commit,
        path: request.path,
    })
}

fn count(value: usize) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn bytes(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn commit(info: buzz_project_git::ProjectRepoCommitInfo) -> ProjectRepoCommit {
    ProjectRepoCommit {
        author_email: info.author_email,
        author_name: info.author_name,
        hash: info.hash,
        short_hash: info.short_hash,
        subject: info.subject,
        timestamp: info.timestamp,
    }
}

fn file(info: buzz_project_git::ProjectRepoFileInfo) -> ProjectRepoFile {
    ProjectRepoFile {
        kind: info.kind,
        last_changed_at: info.last_changed_at,
        latest_commit: info.latest_commit.map(commit),
        path: info.path,
        preview_content: info.preview_content,
        size: info.size.map(bytes),
    }
}

fn contributor(info: buzz_project_git::ProjectRepoContributorInfo) -> ProjectRepoContributor {
    ProjectRepoContributor {
        commit_count: count(info.commit_count),
        email: info.email,
        last_commit_at: info.last_commit_at,
        name: info.name,
    }
}

fn snapshot(info: buzz_project_git::ProjectRepoSnapshotInfo) -> ProjectRepoSnapshot {
    ProjectRepoSnapshot {
        commits: info.commits.into_iter().map(commit).collect(),
        contributors: info.contributors.into_iter().map(contributor).collect(),
        files: info.files.into_iter().map(file).collect(),
        latest_commit: info.latest_commit.map(commit),
    }
}

fn diff_file(info: buzz_project_git::ProjectRepoDiffFileInfo) -> ProjectRepoDiffFile {
    ProjectRepoDiffFile {
        additions: count(info.additions),
        deletions: count(info.deletions),
        patch: info.patch,
        path: info.path,
        truncated: info.truncated,
    }
}

fn diff(info: buzz_project_git::ProjectRepoDiffInfo) -> ProjectRepoDiff {
    ProjectRepoDiff {
        additions: count(info.additions),
        commit_body: info.commit_body,
        deletions: count(info.deletions),
        files: info.files.into_iter().map(diff_file).collect(),
    }
}

/// The blocking body: exactly one original command per view.
fn read(
    target: GitRead,
    clone_url: &str,
    auth: &GitAuthConfig,
) -> Result<ProjectsGitQueryResponse, String> {
    let mut response = ProjectsGitQueryResponse {
        content: None,
        diff: None,
        snapshot: None,
        view: target.view.clone(),
    };
    match target.view {
        ProjectsGitQueryRequestView::Snapshot => {
            let value = buzz_project_git::project_repo_snapshot(
                clone_url,
                target.default_branch,
                target.base_branch,
                target.target_ref,
                target.target_commit,
                auth,
            )?;
            response.snapshot = Some(snapshot(value));
        }
        ProjectsGitQueryRequestView::FileContent => {
            let path = target.path.unwrap_or_default();
            response.content = buzz_project_git::project_repo_file_content(
                clone_url,
                target.default_branch,
                target.target_ref,
                target.target_commit,
                &path,
                auth,
            )?;
        }
        ProjectsGitQueryRequestView::Diff => {
            let value = buzz_project_git::project_repo_diff(
                clone_url,
                target.default_branch,
                target.base_branch,
                target.target_ref,
                target.target_commit,
                auth,
            )?;
            response.diff = Some(diff(value));
        }
    }
    Ok(response)
}

/// DD-118 (3): Relay's 404 / 401 / 403 are one indistinguishable "not found";
/// the reason is never told apart. Other failures keep the Relay read mapping.
pub(crate) fn info_refs_error(error: &OperatorError) -> Response {
    match error {
        OperatorError::Rejected {
            status: 401 | 403 | 404,
            ..
        } => error_body(
            StatusCode::NOT_FOUND,
            ErrorClass::Precondition,
            ReasonCode::TargetNotFound,
            None,
        ),
        other => {
            tracing::warn!(error = %other, "Projects git info/refs failed");
            relay_error_response(other, None)
        }
    }
}

/// After Relay admitted the read: a timeout is 504, anything else 502. The git
/// output stays in the log; it never reaches the Browser.
fn git_error_response(error: &str) -> Response {
    tracing::warn!(error = %error, "Projects git read failed");
    if buzz_project_git::is_timeout_error(error) {
        error_body(
            StatusCode::GATEWAY_TIMEOUT,
            ErrorClass::Precondition,
            ReasonCode::DependencyUnavailable,
            None,
        )
    } else {
        StatusCode::BAD_GATEWAY.into_response()
    }
}

pub(crate) async fn query(
    State(state): State<BffState>,
    headers: HeaderMap,
    Json(request): Json<ProjectsGitQueryRequest>,
) -> Response {
    match query_inner(&state, &headers, request).await {
        Ok(value) => (
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            Json(value),
        )
            .into_response(),
        Err(error) => error,
    }
}

async fn query_inner(
    state: &BffState,
    headers: &HeaderMap,
    request: ProjectsGitQueryRequest,
) -> Result<ProjectsGitQueryResponse, Response> {
    let ctx = resolve_execution_context(state, headers).await?;
    let target = validate(request)?;
    let before = pulse::admit(state, &ctx).await?;
    let keys = actor_keys(state, &ctx).await?;
    let client = Arc::new(community_client(state, &keys, &before.community_host)?);
    // Relay decides with the person's own identity before any git work starts.
    client
        .git_info_refs(&state.http, &target.repo_path)
        .await
        .map_err(|error| info_refs_error(&error))?;
    let clone_url = client
        .git_remote_url(&target.repo_path)
        .map_err(|error| relay_error_response(&error, None))?;
    let signer = Arc::clone(&client);
    let repo_path = target.repo_path.clone();
    let header = GitAuth::Header {
        authorization: Box::new(move || {
            signer
                .git_authorization(&repo_path)
                .map_err(|error| error.to_string())
        }),
        host: Some(client.community_host().to_owned()),
    };
    let auth = GitAuthConfig::new("git", header).with_deadline(Instant::now() + QUERY_DEADLINE);
    let response = tokio::task::spawn_blocking(move || read(target, &clone_url, &auth))
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY.into_response())?
        .map_err(|error| git_error_response(&error))?;
    if pulse::admit(state, &ctx).await? != before
        || actor_keys(state, &ctx).await?.public_key() != keys.public_key()
    {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use serde_json::{json, Value};

    fn coordinate(d: &str) -> String {
        format!("30617:{}:{d}", "a".repeat(64))
    }

    fn checked(view: &str, extra: Value) -> Option<GitRead> {
        let mut value = json!({"view": view, "repository": coordinate("repo")});
        if let (Some(target), Value::Object(extra)) = (value.as_object_mut(), extra) {
            target.extend(extra);
        }
        let request: ProjectsGitQueryRequest = serde_json::from_value(value).unwrap();
        validate(request).ok()
    }

    #[test]
    fn repository_path_comes_only_from_a_servable_coordinate() {
        let owner = "a".repeat(64);
        assert_eq!(
            repository_path(&coordinate("my-repo_1.2")),
            Some(format!("/git/{owner}/my-repo_1.2"))
        );
        for bad in [
            format!("30617:{}:repo", "A".repeat(64)),
            format!("30617:{}:repo", "a".repeat(63)),
            format!("30621:{owner}:repo"),
            format!("30617:{owner}:"),
            format!("30617:{owner}:../x"),
            format!("30617:{owner}:a/b"),
            format!("30617:{owner}:.hidden"),
            format!("30617:{owner}:a..b"),
            format!("30617:{owner}:repo.git"),
            format!("30617:{owner}:{}", "r".repeat(65)),
            format!("30617:{owner}:re po"),
            format!("30617:{owner}:repo?x=1"),
            format!("30617:{owner}:a:b"),
            "https://relay.example/git/x/y".to_string(),
        ] {
            assert_eq!(repository_path(&bad), None, "{bad}");
        }
    }

    #[test]
    fn file_content_requires_a_relative_path_and_other_views_refuse_one() {
        let read = checked("FILE_CONTENT", json!({"path": "src/lib.rs"})).unwrap();
        assert_eq!(read.view, ProjectsGitQueryRequestView::FileContent);
        assert_eq!(read.path.as_deref(), Some("src/lib.rs"));
        assert_eq!(read.repo_path, format!("/git/{}/repo", "a".repeat(64)));
        assert!(checked("FILE_CONTENT", json!({})).is_none());
        for path in ["../etc/passwd", "/etc/passwd", "src/../../x", "./x", ""] {
            assert!(checked("FILE_CONTENT", json!({"path": path})).is_none());
        }
        assert!(checked("SNAPSHOT", json!({"path": "src/lib.rs"})).is_none());
        assert!(checked("DIFF", json!({"path": "src/lib.rs"})).is_none());
        assert!(checked("SNAPSHOT", json!({})).is_some());
    }

    #[test]
    fn target_commit_and_refs_keep_the_contract_bounds() {
        for commit in ["a".repeat(40), "b".repeat(64)] {
            let read = checked("DIFF", json!({"targetCommit": &commit})).unwrap();
            assert_eq!(read.target_commit, Some(commit));
        }
        let invalid = [("A", 40), ("a", 39), ("a", 41), ("g", 40)];
        for (digit, len) in invalid {
            let commit = digit.repeat(len);
            assert!(checked("DIFF", json!({"targetCommit": commit})).is_none());
        }
        assert!(checked("SNAPSHOT", json!({"defaultBranch": ""})).is_none());
        let long = "b".repeat(MAX_REF_CHARS + 1);
        assert!(checked("SNAPSHOT", json!({"baseBranch": long})).is_none());
        assert!(checked("DIFF", json!({"targetRef": "refs/nostr/x"})).is_some());
        assert!(checked("SNAPSHOT", json!({"repository": "30617:x:repo"})).is_none());
    }

    #[test]
    fn git_authorization_is_a_nip98_for_the_relay_repository_root() {
        let keys = nostr::Keys::generate();
        let client = collab_bridge::bridge::IdentityClient::new(
            collab_bridge::bridge::Custody::Server,
            &keys.secret_key().to_secret_hex(),
            "http://relay.internal:3000",
            "community.example",
        )
        .unwrap();
        let repo_path = repository_path(&coordinate("repo")).unwrap();
        let remote = client.git_remote_url(&repo_path).unwrap();
        assert_eq!(remote, format!("http://relay.internal:3000{repo_path}"));
        assert_eq!(client.community_host(), "community.example");

        let header = client.git_authorization(&repo_path).unwrap();
        let token = header.strip_prefix("Nostr ").unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(token)
            .unwrap();
        let event: nostr::Event = serde_json::from_slice(&bytes).unwrap();
        event.verify().unwrap();
        assert_eq!(event.kind.as_u16(), 27235);
        assert_eq!(event.pubkey, keys.public_key());
        // Fixed Buzz crates/buzz-relay/src/api/git/transport.rs `git_expected_url`
        // (non-`wss://` relay_url → `http`): tenant host + the request path
        // before `/info/refs` (or `/git-upload-pack`).
        let request_path = format!("{repo_path}/info/refs?service=git-upload-pack");
        let (prefix, _) = request_path.split_once("/info/refs").unwrap();
        let expected = format!("http://community.example{prefix}");
        let tags = event
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect::<Vec<_>>();
        let u = ["u".to_string(), expected];
        let method = ["method".to_string(), "GET".to_string()];
        assert_eq!(tags, [u, method]);
    }

    #[test]
    fn relay_denials_are_one_not_found_and_git_failures_stay_gateway_errors() {
        for status in [401, 403, 404] {
            let body = "repository not found".to_string();
            let error = OperatorError::Rejected { status, body };
            assert_eq!(info_refs_error(&error).status(), StatusCode::NOT_FOUND);
        }
        let unavailable = OperatorError::Rejected {
            status: 500,
            body: String::new(),
        };
        assert_eq!(
            info_refs_error(&unavailable).status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        let timeout = git_error_response("git timed out after 300s");
        assert_eq!(timeout.status(), StatusCode::GATEWAY_TIMEOUT);
        let failed = git_error_response("fatal: unable to access");
        assert_eq!(failed.status(), StatusCode::BAD_GATEWAY);
    }
}
