//! The original merged-status shape, through the existing native Relay submit
//! and query consumers. DD-81: persist the signed ID before sending; after a
//! lost response or restart only query that ID, never sign or send another.
use super::{
    project_git_intent::{Intent, Journal},
    project_git_remote::RepoScope,
    project_git_write::{Request, WriteError, FAILED, UNKNOWN},
};
use nostr::{Event, EventBuilder, JsonUtil, Keys, Kind, Tag, Timestamp};
use serde_json::json;
use std::path::Path;
use tauri::{AppHandle, Manager};

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
fn merged_status(
    keys: &Keys,
    request: &Request,
    review: &Event,
    latest: Option<&Event>,
    commit: &str,
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
        .map_or(Ok(Timestamp::now().as_secs()), |e| {
            e.created_at
                .as_secs()
                .checked_add(1)
                .ok_or_else(|| WriteError::new(FAILED))
        })?
        .max(Timestamp::now().as_secs());
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

pub(super) async fn ensure_status(
    app: &AppHandle,
    scope: &RepoScope,
    path: &Path,
    intent: &mut Intent,
    review: &Event,
) -> Result<Option<String>, WriteError> {
    let pending = || WriteError::at(UNKNOWN, &intent.key);
    let journal = Journal::open(path).map_err(|_| pending())?;
    if let Some(raw) = &intent.event {
        let event = Event::from_json(raw).map_err(|_| pending())?;
        match intent.event_result.as_deref() {
            Some("ACCEPTED") => return Ok(Some(event.id.to_hex())),
            Some("REJECTED") => return Ok(None),
            Some("NOT_DELIVERED") => {
                return submit_status(app, scope, journal, intent, &event).await
            }
            _ => {}
        }
        let events=query(app,scope,&[json!({"ids":[event.id.to_hex()],"authors":[event.pubkey.to_hex()],"kinds":[1631],"limit":1})]).await.map_err(|_|pending())?;
        if !events
            .iter()
            .any(|found| found.id == event.id && found.verify().is_ok())
        {
            return Err(pending());
        }
        intent.event_result = Some("ACCEPTED".into());
        journal.save(intent, "EVENT_RECONCILIATION")?;
        return Ok(Some(event.id.to_hex()));
    }
    let (_, keys) = scope.check().map_err(|_| pending())?;
    let owner = keys.public_key().to_hex();
    let id = review.id.to_hex();
    let filters = [
        json!({"kinds":[1630,1631,1632,1633],"#e":[id],"authors":[owner,review.pubkey.to_hex()],"limit":256}),
        json!({"kinds":[1630,1631,1632,1633],"#E":[id],"authors":[owner,review.pubkey.to_hex()],"limit":256}),
    ];
    let history = query(app, scope, &filters).await.map_err(|_| pending())?;
    // An incomplete lifecycle page cannot establish the timestamp to sign.
    if history.len() >= 256 {
        return Err(pending());
    }
    let latest = history
        .iter()
        .filter(|e| trusted_status(review, &owner, e))
        .max_by_key(|e| (e.created_at, e.id));
    let event = merged_status(
        &keys,
        &intent.request,
        review,
        latest,
        intent.new.as_deref().ok_or_else(pending)?,
    )
    .map_err(|_| pending())?;
    scope.check().map_err(|_| pending())?;
    intent.event = Some(event.as_json());
    submit_status(app, scope, journal, intent, &event).await
}

async fn submit_status(
    app: &AppHandle,
    scope: &RepoScope,
    journal: Journal,
    intent: &mut Intent,
    event: &Event,
) -> Result<Option<String>, WriteError> {
    intent.event_result = Some("DISPATCHED".into());
    journal.save(intent, "EVENT_DISPATCH")?;
    let (base, keys) = scope
        .check()
        .map_err(|_| WriteError::at(UNKNOWN, &intent.key))?;
    let result = crate::relay::submit_signed_event_at_with_keys(
        &event,
        &app.state::<crate::app_state::AppState>(),
        &base,
        &keys,
    )
    .await;
    scope
        .check()
        .map_err(|_| WriteError::at(UNKNOWN, &intent.key))?;
    match result {
        Ok(_) => {
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
mod tests {
    use super::*;
    #[test]
    fn owner_status_uses_verified_review_and_keeps_original_tags() {
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
}
