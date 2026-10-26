use super::*;
fn fixture() -> (Keys, Keys, Request, Event) {
    let keys = Keys::generate();
    let author = Keys::generate();
    let repository = format!("30617:{}:repo", keys.public_key());
    let review = EventBuilder::new(Kind::Custom(1618), "review")
        .tags([
            Tag::parse(["a", &repository]).unwrap(),
            Tag::parse(["branch-name", "feature"]).unwrap(),
            Tag::parse(["target-branch", "main"]).unwrap(),
        ])
        .sign_with_keys(&author)
        .unwrap();
    let request = Request {
        operation: "MERGE".into(),
        repository,
        branch: "main".into(),
        source_branch: Some("feature".into()),
        expected_commit: "a".repeat(40),
        pull_request_event_id: Some(review.id.to_hex()),
    };
    (keys, author, request, review)
}
#[test]
fn owner_status_uses_verified_review_and_keeps_original_tags() {
    let (keys, author, request, review) = fixture();
    let event = merged_status(&keys, &request, &review, None, &"b".repeat(40)).unwrap();
    assert_eq!(event.kind.as_u16(), 1631);
    assert_eq!(event.pubkey, keys.public_key());
    assert!(event.verify().is_ok());
    assert_eq!(field(&event, "merge-commit"), Some("b".repeat(40).as_str()));
    assert!(trusted_status(&review, &keys.public_key().to_hex(), &event));
    assert!(merged_status(&author, &request, &review, None, &"b".repeat(40)).is_err());
    let mut other = request.clone();
    other.repository = format!("30617:{}:other", keys.public_key());
    assert!(!review_matches(&review, &other));
}
#[test]
fn deployment_window_uses_core_observation_and_never_an_api_timeout_or_local_clock() {
    let (_, _, request, review) = fixture();
    let event = &review;
    let before = event.created_at.as_secs();
    let body = |settle: serde_json::Value, now: serde_json::Value| {
        json!({
        "relayUrl":"wss://tenant.example", "publishResultSettleSeconds":settle,
        "publishResultObservedAtUnixSeconds":now})
    };
    let base = "https://tenant.example";
    assert!(
        PublicationFacts::parse(&json!({"relayUrl":"wss://tenant.example"}), base)
            .unwrap()
            .is_none()
    );
    for (wait, now) in [
        (json!(0), json!(before + 11)),
        (json!(10), json!(0)),
        (json!(-1), json!(before + 11)),
        (json!("10"), json!(before + 11)),
        (json!(10), serde_json::Value::Null),
    ] {
        assert!(PublicationFacts::parse(&body(wait, now), base).is_err());
    }
    assert!(PublicationFacts::parse(
        &body(json!(10), json!(before + 11)),
        "https://other.example"
    )
    .is_err());
    let facts = |now| {
        PublicationFacts::parse(&body(json!(10), json!(now)), base)
            .unwrap()
            .unwrap()
    };
    assert!(!facts(before - 1).window_passed(event));
    assert!(!facts(before + 9).window_passed(event));
    assert!(!facts(before + 10).window_passed(event));
    assert!(facts(before + 11).window_passed(event));
    assert!(!PublicationFacts {
        settle_seconds: u64::MAX,
        observed_at: u64::MAX
    }
    .window_passed(event));
    assert_eq!(request.operation, "MERGE");
}

#[test]
fn journal_retries_only_proven_unsent_status_and_preserves_old_attempt_and_late_receipt_fence() {
    let (keys, _, request, review) = fixture();
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("journal.sqlite");
    let store = Journal::open(&path).unwrap();
    let first = merged_status(&keys, &request, &review, None, &"b".repeat(40)).unwrap();
    let next = merged_status(&keys, &request, &review, Some(&first), &"b".repeat(40)).unwrap();
    assert_ne!(first.id, next.id);
    let mut old = Intent {
        key: uuid::Uuid::new_v4().to_string(),
        request,
        old: Some("a".repeat(40)),
        new: Some("b".repeat(40)),
        author: None,
        result: "ACCEPTED".into(),
        event: Some(first.as_json()),
        event_result: Some("DISPATCHED".into()),
    };
    store.save(&old, "EVENT_DISPATCH").unwrap();
    let mut replacement = old.clone();
    replacement.event = Some(next.as_json());
    assert!(store.save(&replacement, "EVENT_DISPATCH").is_err());
    old.event_result = Some("NOT_DELIVERED".into());
    store.save(&old, "EVENT_RECONCILIATION").unwrap();
    let other = merged_status(&keys, &old.request, &review, Some(&first), &"c".repeat(40)).unwrap();
    let mut changed = replacement.clone();
    changed.event = Some(other.as_json());
    assert!(store.save(&changed, "EVENT_DISPATCH").is_err());
    store.save(&replacement, "EVENT_DISPATCH").unwrap();
    old.event_result = Some("ACCEPTED".into());
    assert!(store.save(&old, "EVENT_OUTCOME").is_err());
    drop(store);
    let store = Journal::open(&path).unwrap();
    let current = store.find(&old.key, &old.request).unwrap().unwrap();
    assert_eq!(current.event, Some(next.as_json()));
    assert_eq!(current.event_result.as_deref(), Some("DISPATCHED"));
    let db = rusqlite::Connection::open(path).unwrap();
    let rows: i64 = db
        .query_row(
            "SELECT count(*) FROM publication_evidence WHERE event=?1",
            [first.as_json()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        rows, 2,
        "old signed ID and its reconciliation remain append-only"
    );
    replacement.event_result = Some("ACCEPTED".into());
    store.save(&replacement, "EVENT_OUTCOME").unwrap();
    replacement.event_result = Some("DISPATCHED".into());
    assert!(store.save(&replacement, "EVENT_DISPATCH").is_err());
}

struct Io {
    keys: Keys,
    now: u64,
    observed: Option<Event>,
    deny_readmit: bool,
    retire_on_query: bool,
    retire_on_submit: bool,
    active: std::sync::atomic::AtomicBool,
    submitted: std::sync::Mutex<Vec<Event>>,
    journal: std::path::PathBuf,
    frozen: Intent,
}
impl PublicationIo for Io {
    fn keys(&self) -> Result<Keys, WriteError> {
        if self.active.load(std::sync::atomic::Ordering::SeqCst) {
            Ok(self.keys.clone())
        } else {
            Err(WriteError::new("PERMISSION_DENIED"))
        }
    }
    async fn facts(&self) -> Result<Option<PublicationFacts>, WriteError> {
        Ok(Some(PublicationFacts {
            settle_seconds: 10,
            observed_at: self.now,
        }))
    }
    async fn query(&self, filters: Vec<serde_json::Value>) -> Result<Vec<Event>, WriteError> {
        if self.retire_on_query {
            self.active
                .store(false, std::sync::atomic::Ordering::SeqCst);
        }
        if let Some(id) = filters[0].get("ids") {
            assert_eq!(
                id[0],
                Event::from_json(self.frozen.event.as_ref().unwrap())
                    .unwrap()
                    .id
                    .to_hex()
            );
            Ok(self.observed.iter().cloned().collect())
        } else {
            Ok(Vec::new())
        }
    }
    async fn readmit(&self, _: &Request) -> Result<(), WriteError> {
        if self.deny_readmit {
            Err(WriteError::new("PERMISSION_DENIED"))
        } else {
            Ok(())
        }
    }
    async fn submit(&self, event: &Event) -> Result<(), String> {
        // The original consumer must commit the new exact event before I/O.
        let store = Journal::open(&self.journal).unwrap();
        let frozen = store
            .find(&self.frozen.key, &self.frozen.request)
            .unwrap()
            .unwrap();
        assert_eq!(frozen.event, Some(event.as_json()));
        assert_eq!(frozen.event_result.as_deref(), Some("DISPATCHED"));
        self.submitted.lock().unwrap().push(event.clone());
        if self.retire_on_submit {
            self.active
                .store(false, std::sync::atomic::Ordering::SeqCst);
        }
        Ok(())
    }
}
fn consumer_fixture(path: &Path, outcome: &str) -> (Io, Event) {
    let (keys, _, request, review) = fixture();
    let event = merged_status_at(&keys, &request, &review, None, &"b".repeat(40), 100).unwrap();
    let frozen = Intent {
        key: uuid::Uuid::new_v4().to_string(),
        request,
        old: Some("a".repeat(40)),
        new: Some("b".repeat(40)),
        author: None,
        result: "ACCEPTED".into(),
        event: Some(event.as_json()),
        event_result: Some(outcome.into()),
    };
    Journal::open(path)
        .unwrap()
        .save(&frozen, "EVENT_DISPATCH")
        .unwrap();
    (
        Io {
            keys,
            now: 200,
            observed: None,
            deny_readmit: false,
            retire_on_query: false,
            retire_on_submit: false,
            active: std::sync::atomic::AtomicBool::new(true),
            submitted: std::sync::Mutex::new(Vec::new()),
            journal: path.into(),
            frozen,
        },
        review,
    )
}
#[tokio::test]
async fn original_status_consumer_recovers_only_the_same_known_unsent_merge_intent() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("journal.sqlite");
    let (io, review) = consumer_fixture(&path, "NOT_DELIVERED");
    // Upgrade from the previous journal format: the intent row is the only
    // retained signed event until the new attempt-evidence table is populated.
    let legacy = rusqlite::Connection::open(&path).unwrap();
    legacy
        .execute("DELETE FROM publication_evidence", [])
        .unwrap();
    let mut intent = Journal::open(&path)
        .unwrap()
        .find(&io.frozen.key, &io.frozen.request)
        .unwrap()
        .unwrap();
    let result = ensure_status_with(&io, &path, &mut intent, &review)
        .await
        .unwrap()
        .unwrap();
    let events = io.submitted.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(result, events[0].id.to_hex());
    let old = Event::from_json(io.frozen.event.as_ref().unwrap()).unwrap();
    assert_ne!(result, old.id.to_hex());
    assert_eq!(events[0].tags, old.tags);
    assert_eq!(events[0].created_at.as_secs(), io.now);
    assert_eq!(intent.key, io.frozen.key);
    assert_eq!(intent.new, io.frozen.new);
    let preserved: i64 = legacy
        .query_row(
            "SELECT count(*) FROM publication_evidence WHERE event=?1 AND outcome='NOT_DELIVERED'",
            [old.as_json()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        preserved, 1,
        "upgrade must preserve the old proven-unsent signed event"
    );
}
#[tokio::test]
async fn original_status_consumer_queries_original_id_and_never_guesses_from_an_empty_page() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("journal.sqlite");
    let (mut io, review) = consumer_fixture(&path, "DISPATCHED");
    let mut intent = io.frozen.clone();
    assert_eq!(
        ensure_status_with(&io, &path, &mut intent, &review)
            .await
            .unwrap_err()
            .code,
        UNKNOWN
    );
    assert!(io.submitted.lock().unwrap().is_empty());
    io.observed = Some(Event::from_json(io.frozen.event.as_ref().unwrap()).unwrap());
    assert_eq!(
        ensure_status_with(&io, &path, &mut intent, &review)
            .await
            .unwrap(),
        io.observed.as_ref().map(|e| e.id.to_hex())
    );
    assert!(io.submitted.lock().unwrap().is_empty());
}
#[tokio::test]
async fn original_status_consumer_fences_revocation_retirement_and_late_ack() {
    for phase in ["readmit", "query", "submit"] {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("journal.sqlite");
        let (mut io, review) = consumer_fixture(&path, "NOT_DELIVERED");
        io.deny_readmit = phase == "readmit";
        io.retire_on_query = phase == "query";
        io.retire_on_submit = phase == "submit";
        let mut intent = io.frozen.clone();
        assert_eq!(
            ensure_status_with(&io, &path, &mut intent, &review)
                .await
                .unwrap_err()
                .code,
            UNKNOWN
        );
        assert_eq!(
            io.submitted.lock().unwrap().len(),
            usize::from(phase == "submit")
        );
        let saved = Journal::open(&path)
            .unwrap()
            .find(&io.frozen.key, &io.frozen.request)
            .unwrap()
            .unwrap();
        assert_eq!(
            saved.event_result.as_deref(),
            Some(if phase == "submit" {
                "DISPATCHED"
            } else {
                "NOT_DELIVERED"
            })
        );
    }
}
