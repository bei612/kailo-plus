//! The original merged-status shape, through the existing native Relay submit
//! and query consumers. DD-81: persist the signed ID before sending; after a
//! lost response or restart query that ID; only proven non-delivery permits
//! another signed attempt for the exact same merge intent.
use super::{
    project_git_intent::{Intent, Journal},
    project_git_remote::RepoScope,
    project_git_write::{Request, WriteError, FAILED, UNKNOWN},
};
use nostr::{Event, EventBuilder, JsonUtil, Keys, Kind, Tag, Timestamp};
use serde_json::json;
use std::path::Path;
use tauri::{AppHandle, Manager};

// Deployment fact + the Core audit clock, read inside NativeSession rather
// than accepted from a webview argument. No request timeout becomes a settle window.
#[derive(Clone, Copy, Debug)]
struct PublicationFacts {
    settle_seconds: u64,
    observed_at: u64,
}
impl PublicationFacts {
    fn parse(body: &serde_json::Value, base: &str) -> Result<Option<Self>, WriteError> {
        let relay = body
            .get("relayUrl")
            .and_then(serde_json::Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| WriteError::new(FAILED))?;
        crate::relay::assert_expected_relay_scope(Some(relay), base)?;
        let settle = body.get("publishResultSettleSeconds");
        let observed = body.get("publishResultObservedAtUnixSeconds");
        if settle.is_none() && observed.is_none() {
            return Ok(None);
        }
        let positive = |value: Option<&serde_json::Value>| {
            value
                .and_then(serde_json::Value::as_u64)
                .filter(|n| *n > 0 && *n <= i64::MAX as u64)
                .ok_or_else(|| WriteError::new(FAILED))
        };
        Ok(Some(Self {
            settle_seconds: positive(settle)?,
            observed_at: positive(observed)?,
        }))
    }
    fn window_passed(self, event: &Event) -> bool {
        event
            .created_at
            .as_secs()
            .checked_add(self.settle_seconds)
            .is_some_and(|deadline| self.observed_at > deadline)
    }
}
async fn publication_facts(
    app: &AppHandle,
    scope: &RepoScope,
) -> Result<Option<PublicationFacts>, WriteError> {
    let (base, _) = scope.check()?;
    let config = crate::platform::config::load(app)?.ok_or_else(|| WriteError::new(FAILED))?;
    let response = app
        .state::<crate::platform::api::NativeSession>()
        .call(
            &app.state::<crate::app_state::AppState>().media_fetch_client,
            &config,
            reqwest::Method::GET,
            "/api/v1/native/community",
            None,
        )
        .await?;
    scope.check()?;
    if response.status != 200 {
        return Err(WriteError::new(FAILED));
    }
    PublicationFacts::parse(&response.body, &base)
}

fn field<'a>(event: &'a Event, name: &str) -> Option<&'a str> {
    event.tags.iter().find_map(|tag| {
        let fields = tag.as_slice();
        (fields.first().map(String::as_str) == Some(name))
            .then(|| fields.get(1).map(String::as_str))
            .flatten()
    })
}
fn review_matches(event: &Event, request: &Request) -> bool {
    event.kind.as_u16() == 1618
        && event.verify().is_ok()
        && Some(event.id.to_hex()) == request.pull_request_event_id
        && field(event, "a") == Some(request.repository.as_str())
        && field(event, "branch-name")
            .and_then(|v| buzz_project_git::normalize_branch(v, "source").ok())
            == request.source_branch
        && field(event, "target-branch")
            .and_then(|v| buzz_project_git::normalize_branch(v, "target").ok())
            .as_deref()
            == Some(request.branch.as_str())
}
async fn query(
    app: &AppHandle,
    scope: &RepoScope,
    filters: &[serde_json::Value],
) -> Result<Vec<Event>, WriteError> {
    let (base, keys) = scope.check()?;
    let events = crate::relay::query_relay_at_with_keys(
        &app.state::<crate::app_state::AppState>(),
        &base,
        filters,
        &keys,
        None,
    )
    .await
    .map_err(|_| WriteError::new(FAILED))?;
    scope.check()?;
    Ok(events)
}
pub(super) async fn read_review(
    app: &AppHandle,
    scope: &RepoScope,
    request: &Request,
) -> Result<Event, WriteError> {
    let events = query(
        app,
        scope,
        &[json!({"ids":[request.pull_request_event_id],"kinds":[1618],"limit":1})],
    )
    .await?;
    match events.as_slice() {
        [event] if review_matches(event, request) => Ok(event.clone()),
        _ => Err(WriteError::new("TARGET_NOT_FOUND")),
    }
}

// Fixed Buzz project_git_workflow.rs::build_merged_status_event, with signing
// metadata derived from the verified review and trusted lifecycle events.
#[cfg(test)]
fn merged_status(
    keys: &Keys,
    request: &Request,
    review: &Event,
    latest: Option<&Event>,
    commit: &str,
) -> Result<Event, WriteError> {
    merged_status_at(
        keys,
        request,
        review,
        latest,
        commit,
        Timestamp::now().as_secs(),
    )
}
fn merged_status_at(
    keys: &Keys,
    request: &Request,
    review: &Event,
    latest: Option<&Event>,
    commit: &str,
    now: u64,
) -> Result<Event, WriteError> {
    let owner = keys.public_key().to_hex();
    if request.repository.split(':').nth(1) != Some(owner.as_str())
        || !review_matches(review, request)
    {
        return Err(WriteError::new("PERMISSION_DENIED"));
    }
    let id = review.id.to_hex();
    let author = review.pubkey.to_hex();
    let mut tags = vec![
        vec!["e", id.as_str(), "", "root"],
        vec!["a", request.repository.as_str()],
        vec!["p", owner.as_str()],
    ];
    if author != owner {
        tags.push(vec!["p", author.as_str()]);
    }
    tags.extend([vec!["merge-commit", commit], vec!["r", commit]]);
    let tags = tags
        .into_iter()
        .map(Tag::parse)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| WriteError::new(FAILED))?;
    let time = latest
        .map_or(Ok(now), |e| {
            e.created_at
                .as_secs()
                .checked_add(1)
                .ok_or_else(|| WriteError::new(FAILED))
        })?
        .max(now);
    EventBuilder::new(Kind::Custom(1631), "")
        .tags(tags)
        .allow_self_tagging()
        .custom_created_at(Timestamp::from(time))
        .sign_with_keys(keys)
        .map_err(|_| WriteError::new(FAILED))
}
fn trusted_status(review: &Event, owner: &str, event: &Event) -> bool {
    matches!(event.kind.as_u16(), 1630..=1633)
        && event.verify().is_ok()
        && (event.pubkey == review.pubkey || event.pubkey.to_hex() == owner)
        && event.tags.iter().any(|tag| {
            let f = tag.as_slice();
            matches!(f.first().map(String::as_str), Some("e" | "E"))
                && f.get(1) == Some(&review.id.to_hex())
        })
}

// One consumer owns the journal state machine. Production delegates every
// network step to the existing scoped Relay/NativeSession path; checks use the
// same consumer with a controlled I/O boundary, not a second status algorithm.
trait PublicationIo: Sync {
    fn keys(&self) -> Result<Keys, WriteError>;
    fn facts(
        &self,
    ) -> impl std::future::Future<Output = Result<Option<PublicationFacts>, WriteError>> + Send;
    fn query(
        &self,
        filters: Vec<serde_json::Value>,
    ) -> impl std::future::Future<Output = Result<Vec<Event>, WriteError>> + Send;
    fn readmit(
        &self,
        request: &Request,
    ) -> impl std::future::Future<Output = Result<(), WriteError>> + Send;
    fn submit(&self, event: &Event)
        -> impl std::future::Future<Output = Result<(), String>> + Send;
}
struct NativePublication<'a> {
    app: &'a AppHandle,
    scope: &'a RepoScope,
}
impl PublicationIo for NativePublication<'_> {
    fn keys(&self) -> Result<Keys, WriteError> {
        Ok(self.scope.check()?.1)
    }
    async fn facts(&self) -> Result<Option<PublicationFacts>, WriteError> {
        publication_facts(self.app, self.scope).await
    }
    async fn query(&self, filters: Vec<serde_json::Value>) -> Result<Vec<Event>, WriteError> {
        query(self.app, self.scope, &filters).await
    }
    async fn readmit(&self, request: &Request) -> Result<(), WriteError> {
        let path = super::project_git_remote::repository_path(&request.repository)
            .ok_or_else(|| WriteError::new(FAILED))?;
        let root = self.scope.repository_root(&path)?;
        self.scope.preflight(&root).await?;
        let (_, keys) = self.scope.check()?;
        if request.repository.split(':').nth(1) != Some(keys.public_key().to_hex().as_str()) {
            return Err(WriteError::new("PERMISSION_DENIED"));
        }
        Ok(())
    }
    async fn submit(&self, event: &Event) -> Result<(), String> {
        let (base, keys) = self.scope.check()?;
        crate::relay::submit_signed_event_at_with_keys(
            event,
            &self.app.state::<crate::app_state::AppState>(),
            &base,
            &keys,
        )
        .await
        .map(|_| ())
    }
}
pub(super) async fn ensure_status(
    app: &AppHandle,
    scope: &RepoScope,
    path: &Path,
    intent: &mut Intent,
    review: &Event,
) -> Result<Option<String>, WriteError> {
    ensure_status_with(&NativePublication { app, scope }, path, intent, review).await
}
async fn ensure_status_with(
    io: &impl PublicationIo,
    path: &Path,
    intent: &mut Intent,
    review: &Event,
) -> Result<Option<String>, WriteError> {
    let key = intent.key.clone();
    let pending = || WriteError::at(UNKNOWN, &key);
    let journal = Journal::open(path).map_err(|_| pending())?;
    io.keys().map_err(|_| pending())?;
    if let Some(raw) = &intent.event {
        let event = Event::from_json(raw).map_err(|_| pending())?;
        match intent.event_result.as_deref() {
            Some("ACCEPTED") => return Ok(Some(event.id.to_hex())),
            Some("REJECTED") => return Ok(None),
            _ => {}
        }
    }
    let facts = io.facts().await.map_err(|_| pending())?;
    io.keys().map_err(|_| pending())?;
    let mut previous_event = None;
    if let Some(raw) = &intent.event {
        let event = Event::from_json(raw).map_err(|_| pending())?;
        let events=io.query(vec![json!({"ids":[event.id.to_hex()],"authors":[event.pubkey.to_hex()],"kinds":[1631],"limit":1})]).await.map_err(|_|pending())?;
        io.keys().map_err(|_| pending())?;
        if events.iter().any(|found| {
            found.id != event.id
                || found.pubkey != event.pubkey
                || found.kind.as_u16() != 1631
                || found.verify().is_err()
        }) {
            return Err(pending());
        }
        if !events.is_empty() {
            intent.event_result = Some("ACCEPTED".into());
            journal.save(intent, "EVENT_RECONCILIATION")?;
            return Ok(Some(event.id.to_hex()));
        }
        // A missing ordinary query is NOT proof: this event and its deletion
        // can both have been soft-deleted. Only the original NOT_DELIVERED
        // evidence permits rebuilding until the authoritative receipt seam exists.
        if intent.event_result.as_deref() != Some("NOT_DELIVERED") {
            return Err(pending());
        }
        previous_event = Some(event);
    }
    let keys = io.keys().map_err(|_| pending())?;
    let owner = keys.public_key().to_hex();
    let id = review.id.to_hex();
    let history=io.query(vec![
        json!({"kinds":[1630,1631,1632,1633],"#e":[id],"authors":[owner,review.pubkey.to_hex()],"limit":256}),
        json!({"kinds":[1630,1631,1632,1633],"#E":[id],"authors":[owner,review.pubkey.to_hex()],"limit":256}),
    ]).await.map_err(|_|pending())?;
    io.keys().map_err(|_| pending())?;
    if history.len() >= 256 {
        return Err(pending());
    }
    let latest = history
        .iter()
        .filter(|e| trusted_status(review, &owner, e))
        .chain(previous_event.iter())
        .max_by_key(|e| (e.created_at, e.id));
    let now = facts.map_or_else(|| Timestamp::now().as_secs(), |f| f.observed_at);
    let event = merged_status_at(
        &keys,
        &intent.request,
        review,
        latest,
        intent.new.as_deref().ok_or_else(pending)?,
        now,
    )
    .map_err(|_| pending())?;
    io.readmit(&intent.request).await.map_err(|_| pending())?;
    io.keys().map_err(|_| pending())?;
    intent.event = Some(event.as_json());
    submit_status(io, journal, intent, &event).await
}
async fn submit_status(
    io: &impl PublicationIo,
    journal: Journal,
    intent: &mut Intent,
    event: &Event,
) -> Result<Option<String>, WriteError> {
    intent.event_result = Some("DISPATCHED".into());
    journal.save(intent, "EVENT_DISPATCH")?;
    io.keys()
        .map_err(|_| WriteError::at(UNKNOWN, &intent.key))?;
    let result = io.submit(event).await;
    io.keys()
        .map_err(|_| WriteError::at(UNKNOWN, &intent.key))?;
    match result {
        Ok(()) => {
            intent.event_result = Some("ACCEPTED".into());
            journal.save(intent, "EVENT_OUTCOME")?;
            Ok(Some(event.id.to_hex()))
        }
        Err(error)
            if error == "relay unreachable: could not connect to relay"
                || error == "relay unreachable: relay host not found"
                || error.starts_with("relay rate-limited:") =>
        {
            intent.event_result = Some("NOT_DELIVERED".into());
            journal.save(intent, "EVENT_OUTCOME")?;
            Err(WriteError::at(UNKNOWN, &intent.key))
        }
        Err(error) if !super::messages::unconfirmed::outcome_unknown(&error) => {
            intent.event_result = Some("REJECTED".into());
            journal.save(intent, "EVENT_OUTCOME")?;
            Ok(None)
        }
        Err(_) => Err(WriteError::at(UNKNOWN, &intent.key)),
    }
}

#[cfg(test)]
#[path = "project_git_publication_tests.rs"]
mod tests;
