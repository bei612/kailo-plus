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
    assert_eq!(
        publication_epoch(&event).unwrap(),
        Some(uuid::Uuid::from_u128(42))
    );
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
        observed_at: u64::MAX,
        epoch: None,
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
        event_community_id: None,
        event_publication_epoch: Some(uuid::Uuid::from_u128(42).to_string()),
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
    submit_base: Option<String>,
    keys: Keys,
    now: u64,
    epoch: Option<uuid::Uuid>,
    observed: Option<Event>,
    relay_settled: bool,
    community: String,
    malformed_id: bool,
    facts_seen: std::sync::atomic::AtomicBool,
    retire_on_delivery: bool,
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
        self.facts_seen
            .store(true, std::sync::atomic::Ordering::SeqCst);
        Ok(Some(PublicationFacts {
            settle_seconds: 10,
            observed_at: self.now,
            epoch: self.epoch,
        }))
    }
    async fn query(&self, filters: Vec<serde_json::Value>) -> Result<Vec<Event>, WriteError> {
        assert!(
            filters.iter().all(|f| f.get("ids").is_none()),
            "ordinary filtered history cannot prove delivery"
        );
        if self.retire_on_query {
            self.active
                .store(false, std::sync::atomic::Ordering::SeqCst);
        }
        Ok(Vec::new())
    }
    async fn delivery(&self, event: &Event) -> Result<MergedStatusDelivery, WriteError> {
        assert!(
            self.facts_seen.load(std::sync::atomic::Ordering::SeqCst),
            "Core observation must precede proof"
        );
        if self.retire_on_delivery {
            self.active
                .store(false, std::sync::atomic::Ordering::SeqCst);
        }
        Ok(MergedStatusDelivery {
            event_id: if self.malformed_id {
                "f".repeat(64)
            } else {
                event.id.to_hex()
            },
            community_id: self.community.clone(),
            accepted: self
                .observed
                .as_ref()
                .is_some_and(|seen| seen.id == event.id),
            settled: self.relay_settled && event.created_at.as_secs() < self.now,
        })
    }
    async fn readmit(&self, _: &Request) -> Result<(), WriteError> {
        if self.deny_readmit {
            Err(WriteError::new("PERMISSION_DENIED"))
        } else {
            Ok(())
        }
    }
    async fn submit(&self, event: &Event, community: &str) -> Result<(), String> {
        // The original consumer must commit the new exact event before I/O.
        let store = Journal::open(&self.journal).unwrap();
        let frozen = store
            .find(&self.frozen.key, &self.frozen.request)
            .unwrap()
            .unwrap();
        assert_eq!(frozen.event, Some(event.as_json()));
        assert_eq!(frozen.event_community_id.as_deref(), Some(community));
        assert_eq!(
            frozen.event_community_id.as_deref(),
            Some(self.community.as_str()),
            "Community must be durable before POST"
        );
        assert_eq!(
            frozen.event_publication_epoch.as_deref(),
            self.epoch.map(|epoch| epoch.to_string()).as_deref()
        );
        assert_eq!(
            publication_epoch(event).unwrap(),
            self.epoch,
            "signed epoch must be durable before POST"
        );
        assert_eq!(frozen.event_result.as_deref(), Some("DISPATCHED"));
        self.submitted.lock().unwrap().push(event.clone());
        if self.retire_on_submit {
            self.active
                .store(false, std::sync::atomic::Ordering::SeqCst);
        }
        if let Some(base) = &self.submit_base {
            return crate::relay::submit_signed_event_scoped(
                event,
                &reqwest::Client::builder()
                    .no_proxy()
                    .redirect(reqwest::redirect::Policy::none())
                    .timeout(std::time::Duration::from_secs(3))
                    .build()
                    .unwrap(),
                base,
                &self.keys,
                Some(community),
                || self.keys().map(|_| ()).map_err(|e| format!("{e:?}")),
            )
            .await
            .map(|_| ());
        }
        Ok(())
    }
}
fn consumer_fixture(path: &Path, outcome: &str) -> (Io, Event) {
    let (keys, _, request, review) = fixture();
    let event = merged_status_at(
        &keys,
        &request,
        &review,
        None,
        &"b".repeat(40),
        100,
        Some(uuid::Uuid::from_u128(42)),
    )
    .unwrap();
    let frozen = Intent {
        key: uuid::Uuid::new_v4().to_string(),
        request,
        old: Some("a".repeat(40)),
        new: Some("b".repeat(40)),
        author: None,
        result: "ACCEPTED".into(),
        event: Some(event.as_json()),
        event_result: Some(outcome.into()),
        event_community_id: Some("00000000-0000-0000-0000-000000000001".into()),
        event_publication_epoch: Some(uuid::Uuid::from_u128(42).to_string()),
    };
    Journal::open(path)
        .unwrap()
        .save(&frozen, "EVENT_DISPATCH")
        .unwrap();
    (
        Io {
            submit_base: None,
            keys,
            now: 200,
            epoch: Some(uuid::Uuid::from_u128(42)),
            observed: None,
            relay_settled: true,
            community: "00000000-0000-0000-0000-000000000001".into(),
            malformed_id: false,
            facts_seen: std::sync::atomic::AtomicBool::new(false),
            retire_on_delivery: false,
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
        preserved, 2,
        "preserve the old attempt and its newly revalidated writer conclusion"
    );
}
#[tokio::test]
async fn original_status_consumer_queries_original_id_and_never_guesses_from_unsettled_absence() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("journal.sqlite");
    let (mut io, review) = consumer_fixture(&path, "DISPATCHED");
    io.relay_settled = false;
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
    for phase in ["readmit", "query", "delivery", "submit"] {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("journal.sqlite");
        let (mut io, review) = consumer_fixture(&path, "NOT_DELIVERED");
        io.deny_readmit = phase == "readmit";
        io.retire_on_query = phase == "query";
        io.retire_on_delivery = phase == "delivery";
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

#[tokio::test]
async fn writer_absence_requires_both_prior_core_window_and_original_community() {
    for case in [
        "core_inside",
        "core_boundary",
        "relay_unsettled",
        "wrong_community",
        "wrong_community_accepted",
        "legacy_unknown",
        "legacy_accepted",
        "bad_id",
        "bad_community",
    ] {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("journal.sqlite");
        let (mut io, review) = consumer_fixture(&path, "DISPATCHED");
        match case {
            "core_inside" => io.now = 109,
            "core_boundary" => io.now = 110,
            "relay_unsettled" => io.relay_settled = false,
            "wrong_community" | "wrong_community_accepted" => {
                io.community = "00000000-0000-0000-0000-000000000002".into();
                if case == "wrong_community_accepted" {
                    io.observed =
                        Some(Event::from_json(io.frozen.event.as_ref().unwrap()).unwrap());
                }
            }
            "legacy_unknown" | "legacy_accepted" => {
                if case == "legacy_accepted" {
                    io.observed =
                        Some(Event::from_json(io.frozen.event.as_ref().unwrap()).unwrap());
                }
                io.frozen.event_community_id = None;
                let db = rusqlite::Connection::open(&path).unwrap();
                db.execute(
                    "UPDATE intent SET payload=?1",
                    [serde_json::to_string(&io.frozen).unwrap()],
                )
                .unwrap();
            }
            "bad_id" => io.malformed_id = true,
            "bad_community" => io.community = "invalid".into(),
            _ => unreachable!(),
        }
        let mut intent = io.frozen.clone();
        assert_eq!(
            ensure_status_with(&io, &path, &mut intent, &review)
                .await
                .unwrap_err()
                .code,
            UNKNOWN,
            "{case}"
        );
        assert!(io.submitted.lock().unwrap().is_empty(), "{case}");
        let saved = Journal::open(&path)
            .unwrap()
            .find(&intent.key, &intent.request)
            .unwrap()
            .unwrap();
        assert_eq!(saved.event, io.frozen.event, "{case}");
        assert_eq!(saved.event_result.as_deref(), Some("DISPATCHED"), "{case}");
    }
}
#[tokio::test]
async fn authoritative_absence_recovers_same_intent_and_keeps_old_signed_evidence() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("journal.sqlite");
    let (io, review) = consumer_fixture(&path, "DISPATCHED");
    let old = Event::from_json(io.frozen.event.as_ref().unwrap()).unwrap();
    let mut intent = io.frozen.clone();
    ensure_status_with(&io, &path, &mut intent, &review)
        .await
        .unwrap();
    let sent = io.submitted.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert_ne!(sent[0].id, old.id);
    assert_eq!(sent[0].tags, old.tags);
    assert_eq!(intent.key, io.frozen.key);
    assert_eq!(intent.event_community_id, io.frozen.event_community_id);
    let db = rusqlite::Connection::open(&path).unwrap();
    let proven: i64 = db
        .query_row(
            "SELECT count(*) FROM publication_evidence WHERE event=?1 AND outcome='NOT_DELIVERED'",
            [old.as_json()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(proven, 1);
    let mut late = io.frozen.clone();
    late.event_result = Some("ACCEPTED".into());
    assert!(Journal::open(&path)
        .unwrap()
        .save(&late, "EVENT_OUTCOME")
        .is_err());
}
#[tokio::test]
async fn first_dispatch_freezes_community_and_cannot_switch_after_restart() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("journal.sqlite");
    let (mut io, review) = consumer_fixture(&path, "DISPATCHED");
    io.frozen.event = None;
    io.frozen.event_result = None;
    io.frozen.event_community_id = None;
    io.frozen.event_publication_epoch = None;
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute(
        "UPDATE intent SET payload=?1",
        [serde_json::to_string(&io.frozen).unwrap()],
    )
    .unwrap();
    let mut intent = io.frozen.clone();
    ensure_status_with(&io, &path, &mut intent, &review)
        .await
        .unwrap();
    assert_eq!(io.submitted.lock().unwrap().len(), 1);
    let mut switched = intent.clone();
    switched.event_community_id = Some(uuid::Uuid::new_v4().to_string());
    assert!(Journal::open(&path)
        .unwrap()
        .save(&switched, "EVENT_OUTCOME")
        .is_err());
}

#[tokio::test]
async fn native_delivery_posts_original_event_with_fresh_device_auth_and_fences_late_proof() {
    use axum::{body::Bytes, extract::State, http::HeaderMap, routing::post, Json, Router};
    use base64::Engine;
    use sha2::Digest;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    };
    #[derive(Clone)]
    struct Server {
        url: String,
        event: Event,
        calls: Arc<AtomicUsize>,
        auth_ids: Arc<Mutex<Vec<nostr::EventId>>>,
    }
    async fn receive(
        State(server): State<Server>,
        headers: HeaderMap,
        body: Bytes,
    ) -> Json<serde_json::Value> {
        let raw = headers["authorization"]
            .to_str()
            .unwrap()
            .strip_prefix("Nostr ")
            .unwrap();
        let auth = Event::from_json(
            base64::engine::general_purpose::STANDARD
                .decode(raw)
                .unwrap(),
        )
        .unwrap();
        assert!(auth.verify().is_ok());
        assert_eq!(auth.pubkey, server.event.pubkey);
        assert_eq!(field(&auth, "u"), Some(server.url.as_str()));
        assert_eq!(field(&auth, "method"), Some("POST"));
        assert_eq!(
            field(&auth, "payload"),
            Some(hex::encode(sha2::Sha256::digest(&body)).as_str())
        );
        assert_eq!(Event::from_json(&body).unwrap(), server.event);
        let mut ids = server.auth_ids.lock().unwrap();
        assert!(!ids.contains(&auth.id));
        ids.push(auth.id);
        server.calls.fetch_add(1, Ordering::SeqCst);
        Json(
            json!({"eventId":server.event.id.to_hex(),"communityId":"00000000-0000-0000-0000-000000000001","accepted":true,"settled":false}),
        )
    }
    let (keys, _, request, review) = fixture();
    let event = merged_status(&keys, &request, &review, None, &"b".repeat(40)).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = Server {
        url: format!("{base}/events/delivery"),
        event: event.clone(),
        calls: Arc::new(AtomicUsize::new(0)),
        auth_ids: Arc::new(Mutex::new(Vec::new())),
    };
    let app = Router::new()
        .route("/events/delivery", post(receive))
        .with_state(server.clone());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let http = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    for _ in 0..2 {
        assert!(
            crate::relay::merged_status_delivery(&event, &http, &base, &keys, || Ok(()))
                .await
                .unwrap()
                .accepted
        );
    }
    assert!(
        crate::relay::merged_status_delivery(&event, &http, &base, &keys, || Err("retired".into()))
            .await
            .is_err()
    );
    assert_eq!(
        server.calls.load(Ordering::SeqCst),
        2,
        "retired identity cannot send a proof request"
    );
    let checks = AtomicUsize::new(0);
    assert!(
        crate::relay::merged_status_delivery(&event, &http, &base, &keys, || {
            if checks.fetch_add(1, Ordering::SeqCst) == 0 {
                Ok(())
            } else {
                Err("retired".into())
            }
        })
        .await
        .is_err(),
        "late proof cannot be adopted by retired identity"
    );
    assert_eq!(server.calls.load(Ordering::SeqCst), 3);
    task.abort();
}

#[tokio::test]
async fn persisted_community_signed_post_requires_matching_ack_before_acceptance() {
    use base64::Engine;
    use std::io::{Read, Write};
    for acknowledgement in [
        "missing",
        "different",
        "unauthorized",
        "forbidden",
        "rejected",
        "malformed",
        "wrong-event",
        "disconnect",
        "matching",
    ] {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("journal.sqlite");
        let (mut io, review) = consumer_fixture(&path, "NOT_DELIVERED");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let base = format!("http://{addr}");
        io.submit_base = Some(base.clone());
        let community = io.community.clone();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut chunk = [0; 4096];
            let (headers, body) = loop {
                let count = socket.read(&mut chunk).unwrap();
                assert!(count > 0);
                bytes.extend_from_slice(&chunk[..count]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8(bytes[..end].to_vec()).unwrap();
                    let length: usize = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse().unwrap())
                        })
                        .unwrap();
                    if bytes.len() >= end + 4 + length {
                        break (headers, bytes[end + 4..end + 4 + length].to_vec());
                    }
                }
            };
            assert_eq!(
                headers.lines().next().unwrap(),
                format!("POST /events?community={community} HTTP/1.1")
            );
            let auth = headers
                .lines()
                .find_map(|line| {
                    line.split_once(':')
                        .filter(|(name, _)| name.eq_ignore_ascii_case("authorization"))
                        .map(|(_, value)| value.trim().to_owned())
                })
                .unwrap();
            let token = base64::engine::general_purpose::STANDARD
                .decode(auth.strip_prefix("Nostr ").unwrap())
                .unwrap();
            let signed: Event = serde_json::from_slice(&token).unwrap();
            signed.verify().unwrap();
            assert_eq!(
                field(&signed, "u"),
                Some(format!("{base}/events?community={community}").as_str())
            );
            assert_eq!(field(&signed, "community"), Some(community.as_str()));
            assert_eq!(
                signed
                    .tags
                    .iter()
                    .filter(|t| t.as_slice()[0] == "community")
                    .count(),
                1
            );
            use sha2::{Digest, Sha256};
            assert_eq!(
                field(&signed, "payload"),
                Some(hex::encode(Sha256::digest(&body)).as_str())
            );
            let event: Event = serde_json::from_slice(&body).unwrap();
            assert_eq!(event.pubkey, signed.pubkey);
            let mut response = json!({"event_id":event.id.to_hex(),"accepted":true,"message":""});
            match acknowledgement {
                "matching" => response["community_id"] = json!(community),
                "rejected" => {
                    response["community_id"] = json!(community);
                    response["accepted"] = json!(false);
                }
                "wrong-event" => {
                    response["community_id"] = json!(community);
                    response["event_id"] = json!("f".repeat(64));
                }
                "disconnect" => return,
                "different" => response["community_id"] = json!(uuid::Uuid::new_v4().to_string()),
                _ => {}
            }
            let response = if acknowledgement == "malformed" {
                "{".into()
            } else {
                response.to_string()
            };
            let status = match acknowledgement {
                "unauthorized" => "401 Unauthorized",
                "forbidden" => "403 Forbidden",
                _ => "200 OK",
            };
            write!(socket,"HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",response.len(),response).unwrap();
        });
        let mut intent = io.frozen.clone();
        let result = ensure_status_with(&io, &path, &mut intent, &review).await;
        server.join().unwrap();
        let persisted = Journal::open(&path)
            .unwrap()
            .find(&intent.key, &intent.request)
            .unwrap()
            .unwrap();
        if acknowledgement == "matching" {
            assert!(result.unwrap().is_some());
            assert_eq!(persisted.event_result.as_deref(), Some("ACCEPTED"));
        } else {
            assert!(
                result.is_err(),
                "missing or mismatched Community ACK must remain UNKNOWN"
            );
            assert_eq!(persisted.event_result.as_deref(), Some("DISPATCHED"));
        }
        assert_eq!(persisted.event_community_id, io.frozen.event_community_id);
    }
}

#[test]
fn trusted_epoch_parse_rejects_noncanonical_or_malformed_values_without_default() {
    let base = "https://tenant.example";
    let mut body = json!({"relayUrl":"wss://tenant.example", "publishResultSettleSeconds":901,
        "publishResultObservedAtUnixSeconds":1900000000});
    assert_eq!(
        PublicationFacts::parse(&body, base).unwrap().unwrap().epoch,
        None
    );
    let epoch = uuid::Uuid::from_u128(42);
    body["publicationEpoch"] = json!(epoch.to_string());
    assert_eq!(
        PublicationFacts::parse(&body, base).unwrap().unwrap().epoch,
        Some(epoch)
    );
    for value in [
        json!(null),
        json!(0),
        json!(""),
        json!("not-an-epoch"),
        json!("00000000-0000-0000-0000-00000000002A"),
    ] {
        body["publicationEpoch"] = value;
        assert!(PublicationFacts::parse(&body, base).is_err());
    }
}

#[tokio::test]
async fn epoch_fence_preserves_old_unknown_without_backfill_and_accepts_positive_receipt() {
    for case in [
        "missing_signed",
        "missing_frozen",
        "changed_epoch",
        "missing_current",
        "legacy_negative",
        "unproven_negative",
        "legacy_positive",
    ] {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("journal.sqlite");
        let (mut io, review) = consumer_fixture(&path, "DISPATCHED");
        if matches!(
            case,
            "missing_signed" | "legacy_negative" | "legacy_positive"
        ) {
            io.frozen.event = Some(
                merged_status_at(
                    &io.keys,
                    &io.frozen.request,
                    &review,
                    None,
                    &"b".repeat(40),
                    100,
                    None,
                )
                .unwrap()
                .as_json(),
            );
            io.frozen.event_publication_epoch = None;
        }
        if case == "missing_frozen" {
            io.frozen.event_publication_epoch = None;
        }
        if case == "changed_epoch" {
            io.epoch = Some(uuid::Uuid::from_u128(43));
        }
        if case == "missing_current" {
            io.epoch = None;
        }
        if matches!(case, "legacy_negative" | "unproven_negative") {
            io.frozen.event_result = Some("NOT_DELIVERED".into());
        }
        if case == "unproven_negative" {
            io.now = 109;
            io.relay_settled = false;
        }
        if case == "legacy_positive" {
            io.observed = Some(Event::from_json(io.frozen.event.as_ref().unwrap()).unwrap());
        }
        rusqlite::Connection::open(&path)
            .unwrap()
            .execute(
                "UPDATE intent SET payload=?1",
                [serde_json::to_string(&io.frozen).unwrap()],
            )
            .unwrap();
        let mut intent = io.frozen.clone();
        let result = ensure_status_with(&io, &path, &mut intent, &review).await;
        if case == "legacy_positive" {
            assert!(result.unwrap().is_some());
        } else {
            assert_eq!(result.unwrap_err().code, UNKNOWN, "{case}");
        }
        assert!(io.submitted.lock().unwrap().is_empty(), "{case}");
        let saved = Journal::open(&path)
            .unwrap()
            .find(&intent.key, &intent.request)
            .unwrap()
            .unwrap();
        assert_eq!(saved.event, io.frozen.event, "{case}");
        assert_eq!(
            saved.event_publication_epoch, io.frozen.event_publication_epoch,
            "no backfill: {case}"
        );
    }
}

#[tokio::test]
async fn new_signed_attempt_requires_trusted_epoch_and_journal_rejects_epoch_drift() {
    for available in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("journal.sqlite");
        let (mut io, review) = consumer_fixture(&path, "DISPATCHED");
        io.frozen.event = None;
        io.frozen.event_result = None;
        io.frozen.event_community_id = None;
        io.frozen.event_publication_epoch = None;
        if !available {
            io.epoch = None;
        }
        rusqlite::Connection::open(&path)
            .unwrap()
            .execute(
                "UPDATE intent SET payload=?1",
                [serde_json::to_string(&io.frozen).unwrap()],
            )
            .unwrap();
        let mut intent = io.frozen.clone();
        let result = ensure_status_with(&io, &path, &mut intent, &review).await;
        if !available {
            assert_eq!(result.unwrap_err().code, UNKNOWN);
            assert!(io.submitted.lock().unwrap().is_empty());
            continue;
        }
        assert!(result.unwrap().is_some());
        let event = Event::from_json(intent.event.as_ref().unwrap()).unwrap();
        event.verify().unwrap();
        assert_eq!(publication_epoch(&event).unwrap(), io.epoch);
        for changed in [None, Some(uuid::Uuid::from_u128(43).to_string())] {
            let mut copy = intent.clone();
            copy.event_publication_epoch = changed;
            assert!(Journal::open(&path)
                .unwrap()
                .save(&copy, "EVENT_OUTCOME")
                .is_err());
        }
    }
}

#[tokio::test]
async fn old_explicit_unsent_outcome_keeps_retry_without_rewriting_old_epoch() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("journal.sqlite");
    let (mut io, review) = consumer_fixture(&path, "NOT_DELIVERED");
    let old = merged_status_at(
        &io.keys,
        &io.frozen.request,
        &review,
        None,
        &"b".repeat(40),
        100,
        None,
    )
    .unwrap();
    io.frozen.event = Some(old.as_json());
    io.frozen.event_publication_epoch = None;
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute(
        "UPDATE intent SET payload=?1",
        [serde_json::to_string(&io.frozen).unwrap()],
    )
    .unwrap();
    Journal::open(&path)
        .unwrap()
        .save(&io.frozen, "EVENT_OUTCOME")
        .unwrap();
    io.relay_settled = false;
    let mut intent = io.frozen.clone();
    ensure_status_with(&io, &path, &mut intent, &review)
        .await
        .unwrap();
    assert_eq!(io.submitted.lock().unwrap().len(), 1);
    assert_eq!(
        intent.event_publication_epoch,
        io.epoch.map(|epoch| epoch.to_string())
    );
    let saved: i64 = db.query_row("SELECT count(*) FROM publication_evidence WHERE event=?1 AND phase='EVENT_OUTCOME' AND outcome='NOT_DELIVERED'", [old.as_json()], |row| row.get(0)).unwrap();
    assert_eq!(saved, 1);
}
