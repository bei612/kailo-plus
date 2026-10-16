//! REQ-24 / DD-39: NIP-MP/NIP-34 reads, not a project database or Git transport.
//! Buzz 779af8886caae1317b4de962082429867ab61503:
//! crates/buzz-relay/src/handlers/ingest.rs::is_global_only_kind makes both
//! 30621 and 30617 Community-global. `buzz-channel` does not authorize Git reads.
use crate::{
    bff::{resolve_execution_context, BffState},
    pulse,
    web_transport::{actor_keys, community_client, community_limits, relay_error_response},
};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use collab_bridge::projects::PULL_REQUEST_STATUS_KINDS;
use serde_json::{json, Value};

pub(crate) const PUBLISH_ACTION: &str = "projects.publish";

/// Same existing HUMAN identity directory consumed by conversations::participants.
/// Tasks are Community-global: repository metadata never invents a Workspace
/// membership requirement. The recipient is not a signing authority.
pub(crate) async fn resolve_human_assignee<'e>(
    executor: impl sqlx::PgExecutor<'e>,
    tenant: uuid::Uuid,
    pubkey: &str,
) -> Result<(), Response> {
    let valid: bool = sqlx::query_scalar(
        "select exists(select 1 from identity.buzz_identity_binding b
         join identity.principal p on p.id=b.principal_id and p.tenant_id=b.tenant_id
           and p.kind='HUMAN' and p.status='ACTIVE'
         join identity.tenant_membership tm on tm.tenant_principal_id=p.id and tm.tenant_id=p.tenant_id
           and tm.state='ACTIVE'
         join identity.human_identity h on h.id=tm.human_identity_id and h.status='ACTIVE'
         where b.tenant_id=$1 and b.pubkey=$2 and b.kind='HUMAN' and b.state='ACTIVE')",
    ).bind(tenant).bind(pubkey).fetch_one(executor).await
        .map_err(crate::service_api::unavailable)?;
    if !valid {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    Ok(())
}

// Native ReposWrite for announcements and MessagesWrite for issues are
// enforced by the same Relay ingest as CLIENT publications. Tenant discovery
// is only this BFF entrance; a repository reference grants no Git/tool access.
#[allow(clippy::result_large_err)]
pub(crate) fn publication_kind(
    request: &contracts::ProjectsPublishRequest,
) -> Result<u16, Response> {
    collab_bridge::projects::publication_kind(request)
        .map_err(|_| StatusCode::BAD_REQUEST.into_response())
}

/// Select a real signed coordinate head, never an author supplied separately by
/// the browser. Missing/stale head refuses before dispatch, not delete success.
pub(crate) async fn publication_target(
    state: &BffState,
    client: &collab_bridge::bridge::IdentityClient,
    request: &contracts::ProjectsPublishRequest,
) -> Result<Option<nostr::Event>, Response> {
    let kind = publication_kind(request)?;
    if matches!(kind, 30617 | 30621) {
        let slug = collab_bridge::projects::project_dtag(
            request.name.as_deref().unwrap_or_default().trim(),
        );
        let rows = client
            .query(
                &state.http,
                &[json!({"kinds":[kind],"authors":[client.pubkey_hex()],"#d":[slug],"limit":1})],
            )
            .await
            .map_err(|error| relay_error_response(&error, None))?;
        let events: Vec<nostr::Event> =
            serde_json::from_value(rows).map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
        if !events.is_empty() {
            // CREATE is not an implicit edit of a current coordinate. Retries
            // already dispatched return the original publish_attempt above.
            return Err(StatusCode::CONFLICT.into_response());
        }
        return Ok(None);
    }
    let id = request
        .target_event_id
        .as_deref()
        .ok_or_else(|| StatusCode::BAD_REQUEST.into_response())?;
    if nostr::EventId::from_hex(id).map_or(true, |parsed| parsed.to_hex() != id) {
        return Err(StatusCode::BAD_REQUEST.into_response());
    }
    let status = PULL_REQUEST_STATUS_KINDS.contains(&kind);
    let target_kinds = if kind == 1 {
        vec![collab_bridge::projects::comment_target_kind(request)
            .map_err(|_| StatusCode::BAD_REQUEST.into_response())?]
    } else if status {
        vec![1618]
    } else if matches!(kind, 1618 | 1621) {
        // Issues and reviews name their repository announcement.
        vec![30617]
    } else {
        vec![30621, 30617]
    };
    let value = client
        .query(&state.http, &[json!({"ids":[id],"kinds":target_kinds})])
        .await
        .map_err(|error| relay_error_response(&error, None))?;
    let events: Vec<nostr::Event> =
        serde_json::from_value(value).map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
    let [event] = events.as_slice() else {
        return Err(StatusCode::NOT_FOUND.into_response());
    };
    if event.id.to_hex() != id
        || !target_kinds.contains(&event.kind.as_u16())
        || event.verify().is_err()
    {
        return Err(StatusCode::BAD_GATEWAY.into_response());
    }
    if kind == 1 || status {
        let repository = collab_bridge::projects::comment_repository(event)
            .map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
        let mut parts = repository.splitn(3, ':');
        parts.next();
        let owner = parts
            .next()
            .ok_or_else(|| StatusCode::BAD_GATEWAY.into_response())?;
        let slug = parts
            .next()
            .ok_or_else(|| StatusCode::BAD_GATEWAY.into_response())?;
        let rows = client
            .query(
                &state.http,
                &[json!({"kinds":[30617],"authors":[owner],"#d":[slug],"limit":1})],
            )
            .await
            .map_err(|error| relay_error_response(&error, None))?;
        let repositories: Vec<nostr::Event> =
            serde_json::from_value(rows).map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
        let [repo] = repositories.as_slice() else {
            return Err(StatusCode::NOT_FOUND.into_response());
        };
        if repo.kind.as_u16() != 30617
            || repo.pubkey.to_hex() != owner
            || repo.tags.identifier() != Some(slug)
            || repo.verify().is_err()
        {
            return Err(StatusCode::BAD_GATEWAY.into_response());
        }
        return Ok(Some(event.clone()));
    }
    let slug = event
        .tags
        .identifier()
        .ok_or_else(|| StatusCode::BAD_GATEWAY.into_response())?;
    let value = client.query(&state.http, &[json!({"kinds":[event.kind.as_u16()],"authors":[event.pubkey.to_hex()],"#d":[slug],"limit":1})])
        .await.map_err(|error| relay_error_response(&error, None))?;
    let heads: Vec<nostr::Event> =
        serde_json::from_value(value).map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
    if heads.as_slice() != [event.clone()] {
        return Err(StatusCode::CONFLICT.into_response());
    }
    Ok(Some(event.clone()))
}

/// Relay applies #a/#E after SQL LIMIT. Page only SQL-pushed author/kind,
/// using its original (created_at DESC, id ASC) cursor, then match either root
/// tag locally. Kind 1 is Community-global and has no channel visibility filter.
pub(crate) async fn latest_comment(
    state: &BffState,
    client: &collab_bridge::bridge::IdentityClient,
    issue: &nostr::Event,
    community_host: &str,
) -> Result<Option<nostr::Event>, Response> {
    collab_bridge::projects::comment_repository(issue)
        .map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
    let author = client.pubkey_hex();
    let cap = community_limits(state, community_host)
        .await
        .map_err(IntoResponse::into_response)?
        .max_limit;
    let cap = usize::try_from(cap)
        .ok()
        .filter(|cap| *cap > 0)
        .ok_or_else(|| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    let mut cursor: Option<(u64, String)> = None;
    loop {
        let mut filter = json!({"kinds":[1],"authors":[author],"limit":cap});
        if let Some((until, before_id)) = &cursor {
            filter["until"] = json!(until);
            filter["before_id"] = json!(before_id);
        }
        // IdentityClient::query retains its original per-query budget, timeout
        // and Relay authentication; exhaustion refuses, it is not an empty page.
        let rows = client
            .query(&state.http, &[filter])
            .await
            .map_err(|error| relay_error_response(&error, None))?;
        let events: Vec<nostr::Event> =
            serde_json::from_value(rows).map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
        validate_project_page(&events, &[1], Some(&author), cap, cursor.as_ref())?;
        if let Some(event) = events
            .iter()
            .find(|event| collab_bridge::projects::comment_activity_matches(issue, event, &author))
        {
            return Ok(Some(event.clone()));
        }
        if events.len() < cap {
            return Ok(None);
        }
        let last = events
            .last()
            .ok_or_else(|| StatusCode::BAD_GATEWAY.into_response())?;
        cursor = Some((last.created_at.as_secs(), last.id.to_hex()));
    }
}

/// Newest trusted lifecycle event of one review (projectPullRequests.mjs::
/// latestStatusForPullRequest). Only the review author and repository owner are
/// trusted, so SQL-pushed authors/kinds bound the pages; the root `e` tag is
/// matched locally because Relay applies tag filters after its SQL limit.
pub(crate) async fn latest_pull_request_status(
    state: &BffState,
    client: &collab_bridge::bridge::IdentityClient,
    pull_request: &nostr::Event,
    community_host: &str,
) -> Result<Option<nostr::Event>, Response> {
    let (owner, author) = collab_bridge::projects::pull_request_status_actors(pull_request)
        .map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
    let cap = community_limits(state, community_host)
        .await
        .map_err(IntoResponse::into_response)?
        .max_limit;
    let cap = usize::try_from(cap)
        .ok()
        .filter(|cap| *cap > 0)
        .ok_or_else(|| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    let kinds = [1630, 1631, 1632, 1633];
    let mut authors = vec![owner.clone()];
    if author != owner {
        authors.push(author.clone());
    }
    let mut cursor: Option<(u64, String)> = None;
    loop {
        let mut filter = json!({"kinds":kinds,"authors":authors,"limit":cap});
        if let Some((until, before_id)) = &cursor {
            filter["until"] = json!(until);
            filter["before_id"] = json!(before_id);
        }
        let rows = client
            .query(&state.http, &[filter])
            .await
            .map_err(|error| relay_error_response(&error, None))?;
        let events: Vec<nostr::Event> =
            serde_json::from_value(rows).map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
        validate_project_page(&events, &kinds, None, cap, cursor.as_ref())?;
        if events
            .iter()
            .any(|event| !authors.contains(&event.pubkey.to_hex()))
        {
            return Err(StatusCode::BAD_GATEWAY.into_response());
        }
        // Pages are (created_at DESC, id ASC): the first trusted match is newest.
        let trusted = |event: &&nostr::Event| {
            collab_bridge::projects::pull_request_status_trusted(pull_request, event)
        };
        if let Some(event) = events.iter().find(trusted) {
            return Ok(Some(event.clone()));
        }
        if events.len() < cap {
            return Ok(None);
        }
        let last = events
            .last()
            .ok_or_else(|| StatusCode::BAD_GATEWAY.into_response())?;
        cursor = Some((last.created_at.as_secs(), last.id.to_hex()));
    }
}

#[allow(clippy::result_large_err)]
fn validate_project_page(
    events: &[nostr::Event],
    kinds: &[u16],
    author: Option<&str>,
    cap: usize,
    cursor: Option<&(u64, String)>,
) -> Result<(), Response> {
    if events.len() > cap
        || events.iter().any(|event| {
            !kinds.contains(&event.kind.as_u16())
                || author.is_some_and(|author| event.pubkey.to_hex() != author)
                || event.verify().is_err()
                || cursor.is_some_and(|(until, before)| {
                    event.created_at.as_secs() > *until
                        || event.created_at.as_secs() == *until && event.id.to_hex() <= *before
                })
        })
        || events.windows(2).any(|pair| {
            pair[0].created_at < pair[1].created_at
                || pair[0].created_at == pair[1].created_at && pair[0].id >= pair[1].id
        })
    {
        return Err(StatusCode::BAD_GATEWAY.into_response());
    }
    Ok(())
}

/// Assignment heads include authoritative owner/author operations, not just
/// this signer's comments. Read complete original keyset pages before reducing;
/// Relay's post-LIMIT #a/#e filters cannot prove that a head is current.
pub(crate) async fn assignment_activity(
    state: &BffState,
    client: &collab_bridge::bridge::IdentityClient,
    request: &contracts::ProjectsPublishRequest,
    issue: &nostr::Event,
    community_host: &str,
) -> Result<Option<nostr::Event>, Response> {
    let cap = community_limits(state, community_host)
        .await
        .map_err(IntoResponse::into_response)?
        .max_limit;
    let cap = usize::try_from(cap)
        .ok()
        .filter(|cap| *cap > 0)
        .ok_or_else(|| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    assignment_activity_page(&state.http, client, request, issue, cap).await
}

async fn assignment_activity_page(
    http: &reqwest::Client,
    client: &collab_bridge::bridge::IdentityClient,
    request: &contracts::ProjectsPublishRequest,
    issue: &nostr::Event,
    cap: usize,
) -> Result<Option<nostr::Event>, Response> {
    let mut cursor = None;
    let mut activity = Vec::new();
    loop {
        let mut filter = json!({"kinds":[1],"limit":cap});
        if let Some((until, before_id)) = &cursor {
            filter["until"] = json!(until);
            filter["before_id"] = json!(before_id);
        }
        let rows = client
            .query(http, &[filter])
            .await
            .map_err(|error| relay_error_response(&error, None))?;
        let events: Vec<nostr::Event> =
            serde_json::from_value(rows).map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
        validate_project_page(&events, &[1], None, cap, cursor.as_ref())?;
        let complete = events.len() < cap;
        cursor = events
            .last()
            .map(|last| (last.created_at.as_secs(), last.id.to_hex()));
        activity.extend(events.into_iter().filter(|event| {
            collab_bridge::projects::comment_activity_matches(issue, event, &event.pubkey.to_hex())
        }));
        if complete {
            break;
        }
    }
    let head = collab_bridge::projects::assignment_head(issue, &activity, &client.pubkey_hex())
        .map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
    if head != request.prior_event_id {
        return Err(StatusCode::CONFLICT.into_response());
    }
    Ok(activity
        .into_iter()
        .filter(|event| event.pubkey.to_hex() == client.pubkey_hex())
        .max_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then(right.id.cmp(&left.id))
        }))
}

/// Fill a requested activity page from unfiltered SQL pages. A short filtered
/// page is not evidence of exhaustion: advance the original native keyset until
/// the output is full or the underlying global-kind history really ends.
async fn work_item_activity_page(
    http: &reqwest::Client,
    client: &collab_bridge::bridge::IdentityClient,
    request: &contracts::ProjectsQueryRequest,
    kinds: &[u16],
    mut filter: Value,
    cap: i64,
) -> Result<Value, Response> {
    let cap = usize::try_from(cap)
        .ok()
        .filter(|cap| *cap > 0)
        .ok_or_else(|| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    filter
        .as_object_mut()
        .ok_or_else(|| StatusCode::BAD_REQUEST.into_response())?
        .remove("#a");
    let mut result = Vec::new();
    let mut cursor = None;
    loop {
        if let Some((until, before_id)) = &cursor {
            filter["until"] = json!(until);
            filter["before_id"] = json!(before_id);
        }
        let page = client
            .query(http, &[filter.clone()])
            .await
            .map_err(|error| relay_error_response(&error, None))?;
        let events: Vec<nostr::Event> =
            serde_json::from_value(page).map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
        validate_project_page(&events, kinds, None, cap, cursor.as_ref())?;
        if events.iter().any(|event| {
            request
                .since
                .is_some_and(|since| event.created_at.as_secs() < since as u64)
                || request
                    .until
                    .is_some_and(|until| event.created_at.as_secs() > until as u64)
        }) {
            return Err(StatusCode::BAD_GATEWAY.into_response());
        }
        for event in &events {
            let repository = event
                .tags
                .iter()
                .find(|tag| tag.as_slice().first().is_some_and(|name| name == "a"))
                .and_then(|tag| tag.as_slice().get(1));
            if repository.is_some_and(|repository| {
                request
                    .coordinates
                    .as_ref()
                    .is_some_and(|coordinates| coordinates.contains(repository))
            }) {
                result.push(event.clone());
                if result.len() == cap {
                    return Ok(json!(result));
                }
            }
        }
        if events.len() < cap {
            return Ok(json!(result));
        }
        let last = events
            .last()
            .ok_or_else(|| StatusCode::BAD_GATEWAY.into_response())?;
        cursor = Some((last.created_at.as_secs(), last.id.to_hex()));
    }
}

/// An accepted idempotency key names the original issue, not any later body
/// submitted under that key. Compare transient input to Relay's signed source;
/// never retain the body or a guessable body digest in Core.
pub(crate) async fn confirm_accepted_issue_publication(
    state: &BffState,
    ctx: &crate::bff::ExecutionContext,
    request: &contracts::ProjectsPublishRequest,
    event_id: &str,
    operation_id: uuid::Uuid,
) -> Result<(), Response> {
    let unknown = || {
        crate::web_transport::error_body(
            StatusCode::SERVICE_UNAVAILABLE,
            contracts::ErrorClass::Unknown,
            contracts::ReasonCode::PublishResultUnknown,
            Some(operation_id),
        )
    };
    let before = pulse::admit(state, ctx).await?;
    let keys = actor_keys(state, ctx).await?;
    let client = community_client(state, &keys, &before.community_host)?;
    let kind = publication_kind(request)?;
    let page = client
        .query(
            &state.http,
            &[json!({"ids":[event_id],"authors":[client.pubkey_hex()],"kinds":[kind],"limit":1})],
        )
        .await
        .map_err(|_| unknown())?;
    let events: Vec<nostr::Event> = serde_json::from_value(page).map_err(|_| unknown())?;
    let [event] = events.as_slice() else {
        return Err(unknown());
    };
    if event.id.to_hex() != event_id || event.pubkey != keys.public_key() {
        return Err(unknown());
    }
    let matches = if PULL_REQUEST_STATUS_KINDS.contains(&kind) {
        // Compare with the immutable review named by the retained request.
        let target_id = request.target_event_id.as_deref().ok_or_else(unknown)?;
        let page = client
            .query(
                &state.http,
                &[json!({"ids":[target_id],"kinds":[1618],"limit":1})],
            )
            .await
            .map_err(|_| unknown())?;
        let reviews: Vec<nostr::Event> = serde_json::from_value(page).map_err(|_| unknown())?;
        let [review] = reviews.as_slice() else {
            return Err(unknown());
        };
        collab_bridge::projects::status_publication_matches(request, review, event)
            .map_err(|_| unknown())?
    } else if kind == 1 {
        // Retained receipt comparison needs the immutable issue, not today's
        // replaceable repository head or a freshly chosen comment timestamp.
        let target_id = request.target_event_id.as_deref().ok_or_else(unknown)?;
        let target_kind =
            collab_bridge::projects::comment_target_kind(request).map_err(|_| unknown())?;
        let page = client
            .query(
                &state.http,
                &[json!({"ids":[target_id],"kinds":[target_kind],"limit":1})],
            )
            .await
            .map_err(|_| unknown())?;
        let issues: Vec<nostr::Event> = serde_json::from_value(page).map_err(|_| unknown())?;
        let [issue] = issues.as_slice() else {
            return Err(unknown());
        };
        let media_tags =
            crate::web_transport::project_comment_media(request, &before.community_host)?;
        collab_bridge::projects::comment_publication_matches(request, issue, event, &media_tags)
            .map_err(|_| unknown())?
    } else if kind == 1618 {
        collab_bridge::projects::pull_request_publication_matches(request, event)
            .map_err(|_| unknown())?
    } else {
        collab_bridge::projects::issue_publication_matches(request, event).map_err(|_| unknown())?
    };
    if pulse::admit(state, ctx).await? != before
        || actor_keys(state, ctx).await?.public_key() != keys.public_key()
    {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    if !matches {
        return Err(StatusCode::CONFLICT.into_response());
    }
    Ok(())
}

// Keep the existing BFF HTTP refusal type; no second error wrapper.
#[allow(clippy::result_large_err)]
fn filter(
    request: &contracts::ProjectsQueryRequest,
    cap: i64,
) -> Result<(Vec<u16>, Value), Response> {
    let view =
        serde_json::to_value(&request.view).map_err(|_| StatusCode::BAD_REQUEST.into_response())?;
    let kinds = match view.as_str() {
        Some("PROJECTS") => vec![30621],
        Some("REPOSITORIES") => vec![30617],
        Some("REPOSITORY_STATES") => vec![30618],
        Some("DELETIONS") => vec![5],
        Some("WORK_ITEMS") => vec![1618, 1621],
        Some("WORK_ITEM_ACTIVITY") => vec![1, 1619, 1630, 1631, 1632, 1633],
        _ => return Err(StatusCode::BAD_REQUEST.into_response()),
    };
    if cap <= 0
        || request.since.is_some_and(|v| v < 0)
        || request.until.is_some_and(|v| v < 0)
        || matches!((request.since, request.until), (Some(s), Some(u)) if s > u)
    {
        return Err(StatusCode::BAD_REQUEST.into_response());
    }
    let mut filter = json!({"kinds":kinds,"limit":cap});
    if !matches!(view.as_str(), Some("PROJECTS" | "REPOSITORIES")) {
        let coordinates = request
            .coordinates
            .as_ref()
            .filter(|v| !v.is_empty() && v.len() as i64 <= cap)
            .ok_or_else(|| StatusCode::BAD_REQUEST.into_response())?;
        if coordinates.iter().any(|v| {
            !coordinate(v) || view.as_str() != Some("DELETIONS") && !v.starts_with("30617:")
        }) || coordinates
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != coordinates.len()
        {
            return Err(StatusCode::BAD_REQUEST.into_response());
        }
        filter["#a"] = json!(coordinates);
    } else if request.coordinates.is_some() {
        return Err(StatusCode::BAD_REQUEST.into_response());
    }
    if let Some(since) = request.since {
        filter["since"] = json!(since);
    }
    if let Some(until) = request.until {
        filter["until"] = json!(until);
    }
    Ok((kinds, filter))
}

fn coordinate(value: &str) -> bool {
    let mut parts = value.splitn(3, ':');
    matches!(parts.next(), Some("30617" | "30621"))
        && parts.next().is_some_and(|v| {
            v.len() == 64
                && v.bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        })
        && parts.next().is_some_and(|v| !v.is_empty())
}

/// Fixed Buzz desktop/src/features/projects/hooks.ts::fetchRepoState for one
/// requested 30617 coordinate: the newest kind 30618 with the repository `d`,
/// trusting only the coordinate owner and the Relay's own NIP-11 `self` key
/// (moderation/lib/relaySelf.ts::getRelaySelf; without it, the owner alone).
/// A request window narrows it as for every other view.
fn repository_state_filter(
    coordinate: &str,
    relay_self: Option<&str>,
    window: &Value,
) -> Option<(Vec<String>, String, Value)> {
    let mut parts = coordinate.splitn(3, ':');
    if parts.next() != Some("30617") {
        return None;
    }
    let owner = parts.next()?;
    let d = parts.next().filter(|d| !d.is_empty())?;
    let mut authors = vec![owner.to_owned()];
    if let Some(relay) = relay_self.filter(|relay| *relay != owner) {
        authors.push(relay.to_owned());
    }
    let mut filter = json!({"kinds":[30618],"authors":authors,"#d":[d],"limit":1});
    for bound in ["since", "until"] {
        if let Some(value) = window.get(bound) {
            filter[bound] = value.clone();
        }
    }
    Some((authors, d.to_owned(), filter))
}

fn trusted_repository_state(event: &nostr::Event, authors: &[String], d: &str) -> bool {
    event.kind.as_u16() == 30618
        && authors.contains(&event.pubkey.to_hex())
        && event.tags.identifier() == Some(d)
        && event.verify().is_ok()
}

fn canonical_pubkey(key: &str) -> bool {
    nostr::PublicKey::from_hex(key).is_ok_and(|parsed| parsed.to_hex() == key)
}

/// The Relay `self` key recorded with the admitted binding version
/// (tenant_lifecycle, NIP-11). Like the original, an absent or invalid key is
/// not trusted, which leaves only the repository owner.
async fn repository_relay_self(
    state: &BffState,
    tenant: uuid::Uuid,
    version: i32,
) -> Result<Option<String>, Response> {
    let row: Option<Option<String>> = sqlx::query_scalar(
        "select relay_self_pubkey from projection.tenant_buzz_binding
         where tenant_id=$1 and state='ACTIVE' and version=$2",
    )
    .bind(tenant)
    .bind(version)
    .fetch_optional(&state.pool)
    .await
    .map_err(crate::service_api::unavailable)?;
    // The binding moved since admission: never trust another snapshot's key.
    let key = row.ok_or_else(|| StatusCode::FORBIDDEN.into_response())?;
    Ok(key.filter(|key| canonical_pubkey(key)))
}

/// One original `limit: 1` read per repository; Relay applies `authors` and
/// `#d` before its limit, so the newest trusted state is the only row.
async fn repository_states(
    http: &reqwest::Client,
    client: &collab_bridge::bridge::IdentityClient,
    coordinates: &[String],
    relay_self: Option<&str>,
    window: &Value,
) -> Result<Value, Response> {
    let mut states: Vec<nostr::Event> = Vec::new();
    for coordinate in coordinates {
        let (authors, d, filter) = repository_state_filter(coordinate, relay_self, window)
            .ok_or_else(|| StatusCode::BAD_REQUEST.into_response())?;
        let rows = client
            .query(http, &[filter])
            .await
            .map_err(|error| relay_error_response(&error, None))?;
        let events: Vec<nostr::Event> =
            serde_json::from_value(rows).map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
        if events.len() > 1
            || events
                .iter()
                .any(|event| !trusted_repository_state(event, &authors, &d))
        {
            return Err(StatusCode::BAD_GATEWAY.into_response());
        }
        for event in events {
            if !states.iter().any(|known| known.id == event.id) {
                states.push(event);
            }
        }
    }
    Ok(json!(states))
}

/// NIP-34 work-item reference. `h`/buzz-channel are not an authorization scope.
pub(crate) fn work_item_root(event: &nostr::Event) -> Option<nostr::EventId> {
    let tags: Vec<_> = event.tags.iter().map(nostr::Tag::as_slice).collect();
    let repository = tags
        .iter()
        .find(|tag| tag.first().is_some_and(|name| name == "a"))?
        .get(1)?;
    if !repository.starts_with("30617:") || !coordinate(repository) {
        return None;
    }
    match event.kind.as_u16() {
        1618 | 1621 => Some(event.id),
        1 | 1619 | 1630..=1633 => tags
            .iter()
            .find(|tag| tag.first().is_some_and(|name| name == "e"))
            .or_else(|| {
                tags.iter()
                    .find(|tag| tag.first().is_some_and(|name| name == "E"))
            })
            .and_then(|tag| tag.get(1))
            .and_then(|id| nostr::EventId::from_hex(id).ok()),
        _ => None,
    }
}

/// Reuse actor-bound Community admission for channel-less Inbox read markers.
/// This consumes existing Relay events, never a second work-item/read database.
pub(crate) async fn readable_work_items(
    state: &BffState,
    ctx: &crate::bff::ExecutionContext,
    requested: &[nostr::EventId],
) -> Result<std::collections::HashMap<nostr::EventId, bool>, Response> {
    if requested.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    let before = pulse::admit(state, ctx).await?;
    let keys = actor_keys(state, ctx).await?;
    let client = community_client(state, &keys, &before.community_host)?;
    let cap = community_limits(state, &before.community_host)
        .await
        .map_err(IntoResponse::into_response)?
        .max_limit;
    let size = usize::try_from(cap)
        .ok()
        .filter(|cap| *cap > 0)
        .ok_or_else(|| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    let mut readable = std::collections::HashMap::new();
    for ids in requested.chunks(size) {
        let value = client
            .query(
                &state.http,
                &[
                    json!({"ids":ids.iter().map(ToString::to_string).collect::<Vec<_>>(),
            "kinds":[1,1618,1619,1621,1630,1631,1632,1633],"limit":ids.len()}),
                ],
            )
            .await
            .map_err(|error| relay_error_response(&error, None))?;
        let events: Vec<nostr::Event> =
            serde_json::from_value(value).map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
        if events.len() > ids.len() {
            return Err(StatusCode::BAD_GATEWAY.into_response());
        }
        for event in events {
            if !ids.contains(&event.id) || event.verify().is_err() {
                return Err(StatusCode::BAD_GATEWAY.into_response());
            }
            if let Some(root) = work_item_root(&event) {
                readable.insert(event.id, root == event.id);
            }
        }
    }
    if pulse::admit(state, ctx).await? != before
        || actor_keys(state, ctx).await?.public_key() != keys.public_key()
    {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    Ok(readable)
}

pub(crate) async fn query(
    State(state): State<BffState>,
    headers: HeaderMap,
    Json(request): Json<contracts::ProjectsQueryRequest>,
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
    request: contracts::ProjectsQueryRequest,
) -> Result<Value, Response> {
    let ctx = resolve_execution_context(state, headers).await?;
    let before = pulse::admit(state, &ctx).await?;
    let keys = actor_keys(state, &ctx).await?;
    let client = community_client(state, &keys, &before.community_host)?;
    let cap = community_limits(state, &before.community_host)
        .await
        .map_err(IntoResponse::into_response)?
        .max_limit;
    let (kinds, filter) = filter(&request, cap)?;
    let states_view = request.view == contracts::ProjectsQueryRequestView::RepositoryStates;
    let relay_self = if states_view {
        repository_relay_self(state, ctx.tenant_id, before.version).await?
    } else {
        None
    };
    let value = if serde_json::to_value(&request.view)
        .is_ok_and(|view| view.as_str() == Some("WORK_ITEM_ACTIVITY"))
    {
        work_item_activity_page(&state.http, &client, &request, &kinds, filter, cap).await?
    } else if states_view {
        let coordinates = request.coordinates.as_deref().unwrap_or_default();
        let trusted = relay_self.as_deref();
        repository_states(&state.http, &client, coordinates, trusted, &filter).await?
    } else {
        client
            .query(&state.http, &[filter])
            .await
            .map_err(|e| relay_error_response(&e, None))?
    };
    let rows = value
        .as_array()
        .ok_or_else(|| StatusCode::BAD_GATEWAY.into_response())?;
    for row in rows {
        let event: nostr::Event = serde_json::from_value(row.clone())
            .map_err(|_| StatusCode::BAD_GATEWAY.into_response())?;
        if !kinds.contains(&event.kind.as_u16())
            || event.verify().is_err()
            || request
                .since
                .is_some_and(|v| event.created_at.as_secs() < v as u64)
            || request
                .until
                .is_some_and(|v| event.created_at.as_secs() > v as u64)
            || request.coordinates.is_some()
                && !states_view
                && !event.tags.iter().any(|tag| {
                    let t = tag.as_slice();
                    t.first().is_some_and(|v| v == "a")
                        && t.get(1).is_some_and(|v| {
                            request.coordinates.as_ref().is_some_and(|c| c.contains(v))
                        })
                })
        {
            return Err(StatusCode::BAD_GATEWAY.into_response());
        }
    }
    if rows.len() as i64 > cap {
        return Err(StatusCode::BAD_GATEWAY.into_response());
    }
    if pulse::admit(state, &ctx).await? != before
        || actor_keys(state, &ctx).await?.public_key() != keys.public_key()
    {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    let mut response = json!({"events":value,"limit":cap,"pubkey":client.pubkey_hex()});
    response["bindingVersion"] = json!(before.version);
    if states_view {
        // The original trust set, so the client picks each repository's state
        // exactly as fetchRepoState did (authors: owner and Relay self).
        response["relaySelf"] = json!(relay_self);
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn assignment_prior_requires_current_head_from_complete_signed_pages() {
        use std::sync::{Arc, Mutex};
        let member = nostr::Keys::generate();
        let owner = nostr::Keys::generate();
        let address = format!("30617:{}:target", owner.public_key());
        let issue = nostr::EventBuilder::new(nostr::Kind::from(1621), "task")
            .tags([nostr::Tag::parse(["a", &address]).unwrap()])
            .sign_with_keys(&owner)
            .unwrap();
        let decision = nostr::EventBuilder::new(nostr::Kind::from(1), "owner assignment")
            .tags([
                nostr::Tag::parse(["a", &address]).unwrap(),
                nostr::Tag::parse(["e", &issue.id.to_hex(), "", "root"]).unwrap(),
                nostr::Tag::parse(["p", &member.public_key().to_hex()]).unwrap(),
                nostr::Tag::parse(["t", "assignment"]).unwrap(),
            ])
            .custom_created_at(nostr::Timestamp::from_secs(41))
            .sign_with_keys(&owner)
            .unwrap();
        let unrelated = nostr::EventBuilder::new(nostr::Kind::from(1), "other task")
            .custom_created_at(nostr::Timestamp::from_secs(42))
            .sign_with_keys(&member)
            .unwrap();
        let calls = Arc::new(Mutex::new(Vec::<Value>::new()));
        let pages = Arc::new(Mutex::new(Vec::<Value>::new()));
        let app = axum::Router::new().route(
            "/query",
            axum::routing::post({
                let calls = calls.clone();
                let pages = pages.clone();
                move |Json(filters): Json<Value>| {
                    let calls = calls.clone();
                    let pages = pages.clone();
                    async move {
                        calls.lock().unwrap().push(filters);
                        Json(pages.lock().unwrap().remove(0))
                    }
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let client = collab_bridge::bridge::IdentityClient::new(
            collab_bridge::bridge::Custody::Server,
            &member.secret_key().to_secret_hex(),
            &endpoint,
            "community.test",
        )
        .unwrap();
        let mut request:contracts::ProjectsPublishRequest=serde_json::from_value(json!({"operation":"SELF_UNASSIGN_ISSUE","targetEventId":issue.id.to_hex(),"assigneeLabel":"Me"})).unwrap();
        // The first unrelated full SQL page is not an empty activity history.
        *pages.lock().unwrap() = vec![json!([unrelated]), json!([decision]), json!([])];
        let error = assignment_activity_page(&reqwest::Client::new(), &client, &request, &issue, 1)
            .await
            .unwrap_err();
        assert_eq!(error.status(), StatusCode::CONFLICT);
        request.prior_event_id = Some(decision.id.to_hex());
        *pages.lock().unwrap() = vec![json!([unrelated]), json!([decision]), json!([])];
        assert!(
            assignment_activity_page(&reqwest::Client::new(), &client, &request, &issue, 1)
                .await
                .unwrap()
                .is_none()
        );
        let mut forged = decision.clone();
        forged.content = "not signed".into();
        *pages.lock().unwrap() = vec![json!([forged])];
        assert_eq!(
            assignment_activity_page(&reqwest::Client::new(), &client, &request, &issue, 1)
                .await
                .unwrap_err()
                .status(),
            StatusCode::BAD_GATEWAY
        );
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 7);
        assert!(calls.iter().all(|call| ["#a", "#e", "authors"]
            .iter()
            .all(|key| call[0].get(key).is_none())));
        assert_eq!(calls[1][0]["before_id"], unrelated.id.to_hex());
        assert_eq!(calls[2][0]["before_id"], decision.id.to_hex());
        server.abort();
    }

    #[tokio::test]
    async fn work_item_activity_reads_past_unrelated_sql_page_before_returning() {
        use std::sync::{Arc, Mutex};
        let keys = nostr::Keys::generate();
        let address = format!("30617:{}:target", keys.public_key());
        let unrelated = nostr::EventBuilder::new(nostr::Kind::from(1), "other repository")
            .tags([
                nostr::Tag::parse(["a", &format!("30617:{}:other", keys.public_key())]).unwrap(),
            ])
            .custom_created_at(nostr::Timestamp::from_secs(42))
            .sign_with_keys(&keys)
            .unwrap();
        let comment = nostr::EventBuilder::new(nostr::Kind::from(1), "expected comment")
            .tags([nostr::Tag::parse(["a", address.as_str()]).unwrap()])
            .custom_created_at(nostr::Timestamp::from_secs(41))
            .sign_with_keys(&keys)
            .unwrap();
        let calls = Arc::new(Mutex::new(Vec::<Value>::new()));
        let pages = Arc::new(Mutex::new(vec![json!([unrelated]), json!([comment])]));
        let app = axum::Router::new().route(
            "/query",
            axum::routing::post({
                let calls = calls.clone();
                move |Json(filters): Json<Value>| {
                    let calls = calls.clone();
                    let pages = pages.clone();
                    async move {
                        calls.lock().unwrap().push(filters);
                        Json(pages.lock().unwrap().remove(0))
                    }
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let client = collab_bridge::bridge::IdentityClient::new(
            collab_bridge::bridge::Custody::Server,
            &keys.secret_key().to_secret_hex(),
            &endpoint,
            "community.test",
        )
        .unwrap();
        let request = request(json!({"view":"WORK_ITEM_ACTIVITY","coordinates":[address]}));
        let (kinds, filter) = filter(&request, 1).unwrap();
        let result = work_item_activity_page(
            &reqwest::Client::new(),
            &client,
            &request,
            &kinds,
            filter,
            1,
        )
        .await
        .unwrap();
        assert_eq!(result, json!([comment]));
        let calls = calls.lock().unwrap();
        assert_eq!(
            calls.len(),
            2,
            "an unrelated SQL page must not terminate the repository read"
        );
        assert!(calls.iter().all(|request| request[0].get("#a").is_none()));
        assert_eq!(calls[1][0]["until"], 42);
        assert_eq!(calls[1][0]["before_id"], unrelated.id.to_hex());
        server.abort();
    }

    use super::*;
    fn request(value: Value) -> contracts::ProjectsQueryRequest {
        serde_json::from_value(value).unwrap()
    }
    #[test]
    fn announcement_filter_never_grants_a_git_or_workspace_scope() {
        let (kind, value) = filter(&request(json!({"view":"PROJECTS","until":42})), 73).unwrap();
        assert_eq!(kind, vec![30621]);
        assert_eq!(value, json!({"kinds":[30621],"limit":73,"until":42}));
        assert_eq!(
            filter(&request(json!({"view":"REPOSITORIES"})), 73)
                .unwrap()
                .0,
            vec![30617]
        );
    }
    #[test]
    fn deletion_enumeration_requires_exact_project_coordinates() {
        assert!(filter(&request(json!({"view":"DELETIONS"})), 73).is_err());
        let address = format!("30617:{}:repo", "a".repeat(64));
        let (_, value) = filter(
            &request(json!({"view":"DELETIONS","coordinates":[address],"since":42,"until":42})),
            73,
        )
        .unwrap();
        assert_eq!(value["#a"], json!([address]));
        for address in [
            format!("39000:{}:channel", "a".repeat(64)),
            format!("30617:{}:", "a".repeat(64)),
            format!("30617:{}:repo", "A".repeat(64)),
        ] {
            assert!(filter(
                &request(json!({"view":"DELETIONS","coordinates":[address]})),
                73
            )
            .is_err());
        }
    }
    #[test]
    fn work_item_reads_are_closed_kind_sets_scoped_to_repositories() {
        let address = format!("30617:{}:repo", "a".repeat(64));
        for (view, expected) in [
            ("WORK_ITEMS", vec![1618, 1621]),
            ("WORK_ITEM_ACTIVITY", vec![1, 1619, 1630, 1631, 1632, 1633]),
            ("REPOSITORY_STATES", vec![30618]),
        ] {
            let (kinds, value) =
                filter(&request(json!({"view":view,"coordinates":[address]})), 73).unwrap();
            assert_eq!(kinds, expected);
            assert_eq!(value["#a"], json!([address]));
            assert!(filter(&request(json!({"view":view})), 73).is_err());
            assert!(filter(&request(json!({"view":view,"coordinates":[]})), 73).is_err());
            assert!(filter(
                &request(json!({"view":view,"coordinates":[address,address]})),
                73
            )
            .is_err());
            assert!(filter(
                &request(
                    json!({"view":view,"coordinates":[format!("30621:{}:project", "a".repeat(64))]})
                ),
                73
            )
            .is_err());
        }
    }
    #[test]
    fn project_read_marks_require_original_repository_and_work_item_reference() {
        let keys = nostr::Keys::generate();
        let root = nostr::EventBuilder::new(nostr::Kind::from(1621), "task")
            .tags([nostr::Tag::parse(["a", &format!("30617:{}:repo", keys.public_key())]).unwrap()])
            .sign_with_keys(&keys)
            .unwrap();
        assert_eq!(work_item_root(&root), Some(root.id));
        let comment = nostr::EventBuilder::new(nostr::Kind::from(1), "activity")
            .tags([
                nostr::Tag::parse(["a", &format!("30617:{}:repo", keys.public_key())]).unwrap(),
                nostr::Tag::parse(["e", &root.id.to_hex()]).unwrap(),
            ])
            .sign_with_keys(&keys)
            .unwrap();
        assert_eq!(work_item_root(&comment), Some(root.id));
        let note = nostr::EventBuilder::new(nostr::Kind::from(1), "not a work item")
            .tags([
                nostr::Tag::parse(["h", "workspace"]).unwrap(),
                nostr::Tag::parse(["e", &root.id.to_hex()]).unwrap(),
            ])
            .sign_with_keys(&keys)
            .unwrap();
        assert_eq!(work_item_root(&note), None);
    }
    #[test]
    fn filters_reject_reversed_windows_unbounded_tombstones_and_cross_view_tags() {
        assert!(filter(
            &request(json!({"view":"PROJECTS","since":43,"until":42})),
            73
        )
        .is_err());
        assert!(filter(&request(json!({"view":"PROJECTS","coordinates":[]})), 73).is_err());
        let address = format!("30621:{}:p", "a".repeat(64));
        assert!(filter(
            &request(json!({"view":"DELETIONS","coordinates":[address,address]})),
            1
        )
        .is_err());
        assert!(filter(&request(json!({"view":"PROJECTS"})), 0).is_err());
    }
    #[test]
    fn comment_history_pages_keep_uppercase_root_and_exact_cursor() {
        let owner = nostr::Keys::generate();
        let author = nostr::Keys::generate();
        let coordinate = format!("30617:{}:repo", owner.public_key());
        let issue = nostr::EventBuilder::new(nostr::Kind::from(1621), "issue")
            .tags([nostr::Tag::parse(["a", coordinate.as_str()]).unwrap()])
            .sign_with_keys(&owner)
            .unwrap();
        let newer = nostr::EventBuilder::new(nostr::Kind::from(1), "another task")
            .custom_created_at(nostr::Timestamp::from_secs(42))
            .sign_with_keys(&author)
            .unwrap();
        let previous = nostr::EventBuilder::new(nostr::Kind::from(1), "earlier target comment")
            .tags([
                nostr::Tag::parse(["a", coordinate.as_str()]).unwrap(),
                nostr::Tag::parse(["E", &issue.id.to_hex()]).unwrap(),
            ])
            .custom_created_at(nostr::Timestamp::from_secs(41))
            .sign_with_keys(&author)
            .unwrap();
        let actor = author.public_key().to_hex();
        validate_project_page(std::slice::from_ref(&newer), &[1], Some(&actor), 1, None).unwrap();
        assert!(!collab_bridge::projects::comment_activity_matches(
            &issue, &newer, &actor
        ));
        let cursor = (newer.created_at.as_secs(), newer.id.to_hex());
        validate_project_page(
            std::slice::from_ref(&previous),
            &[1],
            Some(&actor),
            1,
            Some(&cursor),
        )
        .unwrap();
        assert!(collab_bridge::projects::comment_activity_matches(
            &issue, &previous, &actor
        ));
        assert!(validate_project_page(
            std::slice::from_ref(&newer),
            &[1],
            Some(&actor),
            1,
            Some(&cursor)
        )
        .is_err());
        assert!(validate_project_page(
            &[previous.clone(), newer.clone()],
            &[1],
            Some(&actor),
            2,
            None
        )
        .is_err());
        assert!(validate_project_page(
            std::slice::from_ref(&previous),
            &[1],
            Some(&owner.public_key().to_hex()),
            1,
            None
        )
        .is_err());
        let same_second = nostr::EventBuilder::new(nostr::Kind::from(1), "same second")
            .custom_created_at(newer.created_at)
            .sign_with_keys(&author)
            .unwrap();
        let mut page = vec![newer, same_second];
        page.sort_by_key(|event| event.id);
        validate_project_page(&page, &[1], Some(&actor), 2, None).unwrap();
        let cursor = (page[0].created_at.as_secs(), page[0].id.to_hex());
        validate_project_page(&page[1..], &[1], Some(&actor), 1, Some(&cursor)).unwrap();
        page[1].content = "forged".into();
        assert!(validate_project_page(&page, &[1], Some(&actor), 2, None).is_err());
    }

    fn state_filter(coordinate: &str, relay: Option<&str>) -> (Vec<String>, String, Value) {
        let window = json!({"kinds":[30618],"limit":73,"until":42});
        repository_state_filter(coordinate, relay, &window).unwrap()
    }

    #[test]
    fn repository_states_trust_only_the_owner_and_the_relay_itself() {
        let owner = nostr::Keys::generate();
        let relay = nostr::Keys::generate();
        let stranger = nostr::Keys::generate();
        let owner_hex = owner.public_key().to_hex();
        let relay_hex = relay.public_key().to_hex();
        let coordinate = format!("30617:{owner_hex}:repo");
        let (authors, d, value) = state_filter(&coordinate, Some(&relay_hex));
        assert_eq!(authors, [owner_hex.clone(), relay_hex.clone()]);
        assert_eq!(d, "repo");
        assert_eq!(value["kinds"], json!([30618]));
        assert_eq!(value["authors"], json!([owner_hex, relay_hex]));
        assert_eq!(value["#d"], json!(["repo"]));
        assert_eq!(value["limit"], 1);
        assert_eq!(value["until"], 42);
        assert!(value.get("since").is_none());
        let (owner_only, _, _) = state_filter(&coordinate, None);
        assert_eq!(owner_only, [owner_hex.clone()]);
        let (deduplicated, _, _) = state_filter(&coordinate, Some(&owner_hex));
        assert_eq!(deduplicated, owner_only);
        let empty = json!({});
        let project = format!("30621:{owner_hex}:project");
        assert!(repository_state_filter(&project, None, &empty).is_none());

        let state = |keys: &nostr::Keys, d: &str| {
            nostr::EventBuilder::new(nostr::Kind::from(30618), "")
                .tags([nostr::Tag::parse(["d", d]).unwrap()])
                .sign_with_keys(keys)
                .unwrap()
        };
        let trusted = |event: &nostr::Event, authors: &[String]| {
            trusted_repository_state(event, authors, &d)
        };
        assert!(trusted(&state(&owner, "repo"), &authors));
        assert!(trusted(&state(&relay, "repo"), &authors));
        assert!(!trusted(&state(&stranger, "repo"), &authors));
        assert!(!trusted(&state(&owner, "other"), &authors));
        assert!(!trusted(&state(&relay, "repo"), &owner_only));
        let mut forged = state(&owner, "repo");
        forged.content = "forged".into();
        assert!(!trusted(&forged, &authors));
        assert!(canonical_pubkey(&owner.public_key().to_hex()));
        let upper = owner.public_key().to_hex().to_uppercase();
        assert!(!canonical_pubkey(&upper));
    }
}
