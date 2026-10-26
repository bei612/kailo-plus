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
