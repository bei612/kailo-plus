use super::*;

fn request() -> Request {
    Request {
        operation: "CREATE_BRANCH".into(),
        repository: format!("30617:{}:repo", "a".repeat(64)),
        branch: "feature".into(),
        source_branch: Some("main".into()),
        expected_commit: "b".repeat(40),
        pull_request_event_id: None,
    }
}
fn intent() -> Intent {
    Intent {
        key: uuid::Uuid::new_v4().to_string(),
        request: request(),
        old: None,
        new: Some("b".repeat(40)),
        author: None,
        result: "DISPATCHED".into(),
        event: None,
        event_result: None,
    }
}

#[test]
fn native_journal_survives_restart_and_never_replaces_unknown_intent() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("intent.sqlite");
    let frozen = intent();
    let store = Journal::open(&path).unwrap();
    store.save(&frozen, "DISPATCH").unwrap();
    drop(store);
    let store = Journal::open(&path).unwrap();
    let recovered = store.find(&frozen.key, &frozen.request).unwrap().unwrap();
    assert_eq!(recovered.new, frozen.new);
    assert_eq!(recovered.result, "DISPATCHED");
    // Losing the webview key cannot create a new native push for this ref.
    assert_eq!(
        store
            .find(&uuid::Uuid::new_v4().to_string(), &frozen.request)
            .unwrap()
            .unwrap()
            .key,
        frozen.key
    );
    let mut changed = frozen.request.clone();
    changed.expected_commit = "c".repeat(40);
    assert_eq!(
        store.find(&frozen.key, &changed).unwrap_err().code,
        "IDEMPOTENCY_KEY_REUSED"
    );
    let refused = store
        .find(&uuid::Uuid::new_v4().to_string(), &changed)
        .unwrap_err();
    assert_eq!(refused.code, UNKNOWN);
    assert_eq!(refused.operation_id, Some(frozen.key));
}

#[test]
fn accepted_merge_keeps_its_ref_claim_until_the_signed_status_is_settled() {
    let temp = tempfile::tempdir().unwrap();
    let store = Journal::open(&temp.path().join("intent.sqlite")).unwrap();
    let mut frozen = intent();
    frozen.request.operation = "MERGE".into();
    frozen.request.pull_request_event_id = Some("d".repeat(64));
    frozen.result = "ACCEPTED".into();
    store.save(&frozen, "OUTCOME").unwrap();
    let mut changed = frozen.request.clone();
    changed.expected_commit = "e".repeat(40);
    assert!(store
        .find(&uuid::Uuid::new_v4().to_string(), &changed)
        .is_err());
    frozen.event = Some("signed status evidence".into());
    frozen.event_result = Some("DISPATCHED".into());
    store.save(&frozen, "EVENT_DISPATCH").unwrap();
    let restored = store.find(&frozen.key, &frozen.request).unwrap().unwrap();
    assert_eq!(restored.event, frozen.event);
    frozen.event_result = Some("ACCEPTED".into());
    store.save(&frozen, "EVENT_OUTCOME").unwrap();
    assert!(store
        .find(&uuid::Uuid::new_v4().to_string(), &changed)
        .unwrap()
        .is_none());
    assert_eq!(
        store
            .find(&frozen.key, &frozen.request)
            .unwrap()
            .unwrap()
            .event_result,
        Some("ACCEPTED".into())
    );
}

#[test]
fn native_request_never_accepts_page_urls_owners_or_unbounded_refs() {
    let mut valid = request();
    valid.validate("CREATE_BRANCH").unwrap();
    for repository in [
        "https://evil/git/a/x".into(),
        format!("30617:{}:../escape", "a".repeat(64)),
    ] {
        let mut r = request();
        r.repository = repository;
        assert!(r.validate("CREATE_BRANCH").is_err());
    }
    let mut r = request();
    r.branch = "x".repeat(256);
    assert!(r.validate("CREATE_BRANCH").is_err());
    let mut r = request();
    r.source_branch = None;
    assert!(r.validate("CREATE_BRANCH").is_err());
    let mut r = request();
    r.operation = "DELETE_BRANCH".into();
    assert!(r.validate("DELETE_BRANCH").is_err());
    let mut r = request();
    r.expected_commit = "0".repeat(40);
    assert!(r.validate("CREATE_BRANCH").is_err());
    let json = serde_json::json!({"operation":"CREATE_BRANCH","repository":request().repository,"branch":"new","sourceBranch":"main","expectedCommit":"a".repeat(40),"owner":"forged"});
    assert!(serde_json::from_value::<Request>(json).is_err());
}

#[test]
fn journal_partition_isolates_community_and_device() {
    let temp = tempfile::tempdir().unwrap();
    assert_ne!(
        journal_path(temp.path(), "https://a", "signer").unwrap(),
        journal_path(temp.path(), "https://b", "signer").unwrap()
    );
    assert_ne!(
        journal_path(temp.path(), "https://a", "first").unwrap(),
        journal_path(temp.path(), "https://a", "second").unwrap()
    );
}

#[test]
fn only_the_advertised_frozen_ref_can_settle_a_restarted_dispatch() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("journal.sqlite");
    let store = Journal::open(&path).unwrap();
    let mut frozen = intent();
    store.save(&frozen, "DISPATCH").unwrap();
    assert!(!settle_observation(&store, &mut frozen, None).unwrap());
    assert_eq!(frozen.result, "NOT_DELIVERED");
    let original = frozen.new.clone();
    assert!(settle_observation(&store, &mut frozen, original).unwrap());
    drop(store);
    let store = Journal::open(&path).unwrap();
    assert_eq!(
        store
            .find(&frozen.key, &frozen.request)
            .unwrap()
            .unwrap()
            .result,
        "ACCEPTED"
    );
    let mut other = intent();
    other.request.branch = "another".into();
    store.save(&other, "DISPATCH").unwrap();
    assert_eq!(
        settle_observation(&store, &mut other, Some("f".repeat(40)))
            .unwrap_err()
            .code,
        CONFLICT
    );
    assert_eq!(
        store
            .find(&other.key, &other.request)
            .unwrap()
            .unwrap()
            .result,
        CONFLICT
    );
}

/// Run the actual shared Git commands against git-http-backend. Lose the first
/// receive-pack response and its immediate read-back; reopening SQLite must
/// observe the original target without a second receive-pack.
#[tokio::test]
async fn real_native_dispatch_reconciles_a_lost_push_after_restart() {
    use axum::{
        body::{to_bytes, Body},
        extract::{Request as HttpRequest, State},
        response::Response,
        routing::any,
        Router,
    };
    use std::{
        io::Write,
        process::{Command, Stdio},
        sync::atomic::{AtomicBool, AtomicUsize, Ordering},
    };
    fn command(path: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .current_dir(path)
            .args(args)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).unwrap().trim().to_owned()
    }
    #[derive(Clone)]
    struct Server {
        root: PathBuf,
        journal: PathBuf,
        request: Request,
        key: String,
        lose: Arc<AtomicBool>,
        pushes: Arc<AtomicUsize>,
        durable: Arc<AtomicBool>,
    }
    async fn serve(State(state): State<Server>, request: HttpRequest) -> Response {
        let method = request.method().as_str().to_owned();
        let path = request.uri().path().to_owned();
        let query = request.uri().query().unwrap_or("").to_owned();
        let content_type = request
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_owned();
        let bytes = to_bytes(request.into_body(), 16 * 1024 * 1024)
            .await
            .unwrap();
        if state.lose.load(Ordering::SeqCst) && state.pushes.load(Ordering::SeqCst) > 0 {
            return Response::builder().status(502).body(Body::empty()).unwrap();
        }
        let receive = path.ends_with("/git-receive-pack");
        if receive {
            let journal = Journal::open(&state.journal).unwrap();
            let persisted = journal.find(&state.key, &state.request).unwrap().unwrap();
            state.durable.store(
                persisted.result == "DISPATCHED"
                    && persisted.new == Some(state.request.expected_commit.clone()),
                Ordering::SeqCst,
            );
            state.pushes.fetch_add(1, Ordering::SeqCst);
        }
        let root = state.root.clone();
        let output = tokio::task::spawn_blocking(move || {
            let mut child = Command::new("git")
                .arg("http-backend")
                .env("GIT_PROJECT_ROOT", root)
                .env("GIT_HTTP_EXPORT_ALL", "1")
                .env("REQUEST_METHOD", method)
                .env("PATH_INFO", path)
                .env("QUERY_STRING", query)
                .env("CONTENT_TYPE", content_type)
                .env("CONTENT_LENGTH", bytes.len().to_string())
                .env("REMOTE_USER", "native-test")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap();
            child.stdin.take().unwrap().write_all(&bytes).unwrap();
            let output = child.wait_with_output().unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            output.stdout
        })
        .await
        .unwrap();
        if receive && state.lose.load(Ordering::SeqCst) {
            return Response::builder().status(502).body(Body::empty()).unwrap();
        }
        let split = output.windows(4).position(|v| v == b"\r\n\r\n").unwrap();
        let headers = String::from_utf8_lossy(&output[..split]);
        let mut response = Response::builder();
        for line in headers.lines() {
            if let Some((name, value)) = line.split_once(':') {
                if name.eq_ignore_ascii_case("status") {
                    response = response.status(
                        value
                            .trim()
                            .split_whitespace()
                            .next()
                            .unwrap()
                            .parse::<u16>()
                            .unwrap(),
                    );
                } else {
                    response = response.header(name, value.trim());
                }
            }
        }
        response
            .body(Body::from(output[split + 4..].to_vec()))
            .unwrap()
    }
    let temp = tempfile::tempdir().unwrap();
    let remote = temp.path().join("repo.git");
    let work = temp.path().join("work");
    command(temp.path(), &["init", "--bare", remote.to_str().unwrap()]);
    command(&remote, &["config", "http.receivepack", "true"]);
    command(temp.path(), &["init", work.to_str().unwrap()]);
    std::fs::write(work.join("README.md"), "native\n").unwrap();
    command(&work, &["add", "README.md"]);
    command(
        &work,
        &[
            "-c",
            "user.name=Native Test",
            "-c",
            "user.email=native@example.test",
            "commit",
            "-m",
            "first",
        ],
    );
    command(&work, &["branch", "-M", "main"]);
    command(&work, &["push", remote.to_str().unwrap(), "main"]);
    command(&remote, &["symbolic-ref", "HEAD", "refs/heads/main"]);
    let commit = command(&work, &["rev-parse", "HEAD"]);
    let mut input = request();
    input.expected_commit = commit;
    let key = uuid::Uuid::new_v4().to_string();
    let journal_path = temp.path().join("journal.sqlite");
    let server = Server {
        root: temp.path().to_owned(),
        journal: journal_path.clone(),
        request: input.clone(),
        key: key.clone(),
        lose: Arc::new(AtomicBool::new(true)),
        pushes: Arc::new(AtomicUsize::new(0)),
        durable: Arc::new(AtomicBool::new(false)),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let root = format!("http://{}/repo.git", listener.local_addr().unwrap());
    let router = Router::new()
        .fallback(any(serve))
        .with_state(server.clone());
    let serving = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let run = |path: PathBuf, key: String, input: Request, root: String| {
        tokio::task::spawn_blocking(move || {
            let journal = Journal::open(&path).unwrap();
            let auth = git::GitAuthConfig::new(
                "git",
                git::GitAuth::Header {
                    authorization: Box::new(|| Ok("Nostr test-boundary".into())),
                    host: None,
                },
            );
            dispatch(&journal, &key, input, &root, &auth, None)
        })
    };
    let first = run(
        journal_path.clone(),
        key.clone(),
        input.clone(),
        root.clone(),
    )
    .await
    .unwrap()
    .unwrap_err();
    assert_eq!(first.code, UNKNOWN);
    assert!(server.durable.load(Ordering::SeqCst));
    assert_eq!(server.pushes.load(Ordering::SeqCst), 1);
    server.lose.store(false, Ordering::SeqCst);
    let resumed = run(journal_path, key, input, root).await.unwrap().unwrap();
    assert_eq!(resumed.result, "ACCEPTED");
    assert_eq!(
        server.pushes.load(Ordering::SeqCst),
        1,
        "a restarted dispatch only reads its frozen target"
    );
    serving.abort();
}

#[test]
fn native_git_failures_keep_existing_contract_reasons() {
    assert_eq!(
        failure_code(false, "The repository's default branch cannot be deleted."),
        Some(CONFLICT)
    );
    assert_eq!(
        failure_code(false, "The source branch changed. Refresh the repository."),
        Some(CONFLICT)
    );
    assert_eq!(
        failure_code(true, " ! [rejected] feature -> feature (stale info)"),
        Some(CONFLICT)
    );
    assert_eq!(
        failure_code(true, "remote: denied\npre-receive hook declined"),
        Some("PUBLISH_REJECTED")
    );
    assert_eq!(
        failure_code(true, "The requested URL returned error: 413"),
        Some("PAYLOAD_TOO_LARGE")
    );
    assert_eq!(failure_code(false, "could not connect"), Some(FAILED));
    assert_eq!(failure_code(true, "connection reset"), None);
}

#[test]
fn reprepare_conflicts_settle_the_ref_but_network_failures_keep_it_frozen() {
    let temp = tempfile::tempdir().unwrap();
    let store = Journal::open(&temp.path().join("intent.sqlite")).unwrap();
    let mut frozen = intent();
    frozen.result = "NOT_DELIVERED".into();
    store.save(&frozen, "RECONCILIATION").unwrap();
    assert_eq!(
        reconstruction_error(&store, &mut frozen, git::MergeErrorCode::Failed).code,
        UNKNOWN
    );
    assert_eq!(
        store
            .find(&frozen.key, &frozen.request)
            .unwrap()
            .unwrap()
            .result,
        "NOT_DELIVERED"
    );
    assert_eq!(
        reconstruction_error(&store, &mut frozen, git::MergeErrorCode::BranchChanged).code,
        CONFLICT
    );
    assert_eq!(
        store
            .find(&frozen.key, &frozen.request)
            .unwrap()
            .unwrap()
            .result,
        CONFLICT
    );
    let mut changed = frozen.request.clone();
    changed.expected_commit = "e".repeat(40);
    assert!(store
        .find(&uuid::Uuid::new_v4().to_string(), &changed)
        .unwrap()
        .is_none());
}

#[test]
fn durable_claim_itself_refuses_replacement_and_late_terminal_regression() {
    let temp = tempfile::tempdir().unwrap();
    let store = Journal::open(&temp.path().join("intent.sqlite")).unwrap();
    let mut frozen = intent();
    store.save(&frozen, "DISPATCH").unwrap();
    let mut replacement = frozen.clone();
    replacement.new = Some("c".repeat(40));
    assert_eq!(
        store.save(&replacement, "DISPATCH").unwrap_err().code,
        "IDEMPOTENCY_KEY_REUSED"
    );
    assert_eq!(
        store
            .find(&frozen.key, &frozen.request)
            .unwrap()
            .unwrap()
            .new,
        frozen.new
    );
    frozen.result = "ACCEPTED".into();
    frozen.event = Some("original signed event".into());
    frozen.event_result = Some("ACCEPTED".into());
    store.save(&frozen, "EVENT_OUTCOME").unwrap();
    replacement = frozen.clone();
    replacement.event = Some("new signature".into());
    assert_eq!(
        store.save(&replacement, "EVENT_DISPATCH").unwrap_err().code,
        UNKNOWN
    );
    replacement = frozen.clone();
    replacement.result = "DISPATCHED".into();
    assert!(store.save(&replacement, "DISPATCH").is_err());
    replacement = frozen.clone();
    replacement.event_result = Some("DISPATCHED".into());
    assert!(store.save(&replacement, "EVENT_DISPATCH").is_err());
    assert_eq!(
        store
            .find(&frozen.key, &frozen.request)
            .unwrap()
            .unwrap()
            .event_result,
        Some("ACCEPTED".into())
    );
}
