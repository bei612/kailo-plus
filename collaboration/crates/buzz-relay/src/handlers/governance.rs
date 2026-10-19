//! Platform (SS-BUZ-GOVERNANCE): owner-governed communities.
//!
//! In a platform community the owner is the tenant's control identity, and
//! channels, rosters and every other piece of shared structure change only
//! through it, except the original member's pure topic command. Members hold
//! their own keys and reach the relay directly, so
//! the relay itself must refuse what the community's governance does not
//! grant: a member may publish only the kinds in `member_event_kinds`.
//! Membership-changing, channel-creating and every other kind is accepted
//! from the owner alone, and every channel is private, so reads and writes
//! are both decided by the channel roster. Huddle audio, which archives the
//! channel it ran in when the last peer leaves, is served only for the
//! owner-projected Huddle temp channels of DD-125(3): a private stream with a
//! TTL whose `created_by` is the admitted initiator named by the owner's
//! `creator` tag. Workspace channels, DMs and every other channel never get
//! an audio connection, so the last-leave archive can only land on a temp
//! channel. See `crate::audio::governed` for the room side.
//!
//! The relay's own workflow engine is off as well (DD-106): the platform's workflows
//! run elsewhere, and this one would otherwise run for every community with
//! the owner, a cron loop, member messages and a bare webhook secret as its
//! triggers. No engine is built, so there is no action sink, cron loop or
//! event trigger; its command kinds are refused from everyone, the owner
//! included; its HTTP routes are not registered. [`verify_workflows_disabled`]
//! confirms all three before the relay serves.

use std::sync::Arc;

use std::net::SocketAddr;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Method, Request, StatusCode};
use axum::Router;
use buzz_core::kind::{
    KIND_APPROVAL_DENY, KIND_APPROVAL_GRANT, KIND_DELETION, KIND_HUDDLE_GUIDELINES,
    KIND_HUDDLE_REACTION, KIND_NIP29_CREATE_GROUP, KIND_NIP29_LEAVE_REQUEST, KIND_WORKFLOW_DEF,
    KIND_WORKFLOW_TRIGGER,
};
use buzz_db::channel::ChannelRecord;
use buzz_workflow::WorkflowEngine;
use nostr::{Event, EventBuilder, Keys, Kind, PublicKey, Tag};
use tower::ServiceExt;

use crate::config::Config;
use crate::handlers::ingest::IngestError;
use crate::state::AppState;
use buzz_core::tenant::TenantContext;

/// Kinds that define, trigger, approve or deny a relay workflow.
const WORKFLOW_COMMAND_KINDS: [u32; 4] = [
    KIND_WORKFLOW_DEF,
    KIND_WORKFLOW_TRIGGER,
    KIND_APPROVAL_GRANT,
    KIND_APPROVAL_DENY,
];

const WORKFLOWS_DISABLED: &str = "restricted: relay workflows are disabled in this community";

/// Whether a relay with this configuration runs owner-governed communities.
pub fn governs(config: &Config) -> bool {
    config.member_event_kinds.is_some()
}

/// Whether the deployment runs owner-governed communities.
pub(crate) fn is_governed(state: &AppState) -> bool {
    governs(&state.config)
}

/// A workflow command, or a kind:5 whose `a` tag addresses a workflow
/// definition (the NIP-09 path that deletes it).
fn is_workflow_event(kind: u32, event: &Event) -> bool {
    WORKFLOW_COMMAND_KINDS.contains(&kind)
        || (kind == KIND_DELETION
            && event.tags.iter().any(|t| {
                t.kind().to_string() == "a"
                    && t.content()
                        .and_then(|v| v.split(':').next())
                        .and_then(|k| k.parse::<u32>().ok())
                        == Some(KIND_WORKFLOW_DEF)
            }))
}

/// Refuses every workflow event when governed, whoever signed it — the
/// community owner included. A no-op when governance is off.
pub(crate) fn check_workflow_event(
    state: &AppState,
    kind: u32,
    event: &Event,
) -> Result<(), IngestError> {
    if is_governed(state) && is_workflow_event(kind, event) {
        return Err(IngestError::Rejected(WORKFLOWS_DISABLED.into()));
    }
    Ok(())
}

/// The workflow engine, or the refusal a relay without one gives.
pub(crate) fn workflow_engine(state: &AppState) -> Result<&Arc<WorkflowEngine>, IngestError> {
    state
        .workflow_engine
        .as_ref()
        .ok_or_else(|| IngestError::Rejected(WORKFLOWS_DISABLED.into()))
}

fn loopback_request(method: Method, path: &str) -> Result<Request<Body>, axum::http::Error> {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .body(Body::empty())?;
    request
        .extensions_mut()
        .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 0))));
    Ok(request)
}

/// Startup self-check (DD-106): on a governed relay, confirms that no
/// workflow engine exists, that ingest refuses every workflow event, and
/// that `router` — the one about to be served — has no workflow routes.
/// Any failure means the relay must not start. A no-op when governance is off.
pub async fn verify_workflows_disabled(state: &AppState, router: &Router) -> Result<(), String> {
    if !is_governed(state) {
        return Ok(());
    }

    // 1. The action sink and the cron loop hang off the engine; without one
    //    neither exists, and persisted events trigger nothing.
    if state.workflow_engine.is_some() {
        return Err("a workflow engine is constructed".into());
    }

    // 2. Ingest refuses every workflow event.
    let keys = Keys::generate();
    let definition = format!(
        "{KIND_WORKFLOW_DEF}:{}:self-check",
        keys.public_key().to_hex()
    );
    let delete_definition =
        Tag::parse(["a", definition.as_str()]).map_err(|e| format!("self-check tag: {e}"))?;
    let probes = WORKFLOW_COMMAND_KINDS
        .map(|kind| (kind, None))
        .into_iter()
        .chain([(KIND_DELETION, Some(delete_definition))]);
    for (kind, tag) in probes {
        let event = EventBuilder::new(Kind::from(kind as u16), "")
            .tags(tag)
            .sign_with_keys(&keys)
            .map_err(|e| format!("self-check event: {e}"))?;
        if check_workflow_event(state, kind, &event).is_ok() {
            return Err(format!("ingest admits workflow kind {kind}"));
        }
    }

    // 3. No workflow route. Each probe uses a method the route would not
    //    serve: a registered route answers 405, an absent one 404 — so the
    //    answer never depends on a handler or the database. The probe comes
    //    from loopback because unmatched requests pass the localhost-only
    //    layer of the internal git policy router, which refuses anything else.
    for (method, path) in [
        (Method::GET, "/hooks/self-check"),
        (Method::POST, "/workflows/self-check/runs"),
        (
            Method::POST,
            "/workflows/self-check/runs/self-check/approvals",
        ),
    ] {
        let request = loopback_request(method.clone(), path)
            .map_err(|e| format!("self-check request: {e}"))?;
        let status = router
            .clone()
            .oneshot(request)
            .await
            .map_err(|e| format!("self-check {method} {path}: {e}"))?
            .status();
        if status != StatusCode::NOT_FOUND {
            return Err(format!("{method} {path} answered {status}, not 404"));
        }
    }
    Ok(())
}

/// Refuses a kind:9007 or kind:9002 that would leave a channel non-private.
/// The upstream default for a missing `visibility` on create is `open`.
pub(crate) fn check_channel_visibility(
    state: &AppState,
    kind: u32,
    event: &nostr::Event,
) -> Result<(), IngestError> {
    use buzz_core::kind::{KIND_NIP29_CREATE_GROUP, KIND_NIP29_EDIT_METADATA};
    if !is_governed(state) {
        return Ok(());
    }
    let visibility = event
        .tags
        .iter()
        .find(|t| t.kind().to_string() == "visibility")
        .map(|t| t.content().unwrap_or_default().to_owned());
    let private = match (kind, visibility.as_deref()) {
        (KIND_NIP29_CREATE_GROUP, v) => v == Some("private"),
        (KIND_NIP29_EDIT_METADATA, Some(v)) => v == "private",
        _ => true,
    };
    if private {
        Ok(())
    } else {
        Err(IngestError::Rejected(
            "restricted: channels in this community are private".into(),
        ))
    }
}

/// Refuses `kind` from `author` unless it is a member-publishable kind or the
/// author is the community owner. `author` is the authenticated caller, not
/// the event's signer: a gift wrap is signed by a throwaway key. A no-op when
/// governance is off.
pub(crate) async fn check_event_kind(
    tenant: &TenantContext,
    state: &AppState,
    author: &PublicKey,
    event: &Event,
) -> Result<(), IngestError> {
    let Some(allowed) = state.config.member_event_kinds.as_ref() else {
        return Ok(());
    };
    let kind = buzz_core::kind::event_kind_u32(event);
    // Metadata management cannot be enabled for members by adding the whole
    // kind to a deployment allowlist. Only the exact native topic envelope is
    // a member action; ingest still checks its signer and current roster.
    if (kind == buzz_core::kind::KIND_NIP29_EDIT_METADATA
        && buzz_core::channel::topic_change(event).is_some())
        || (kind != buzz_core::kind::KIND_NIP29_EDIT_METADATA && allowed.contains(&kind))
    {
        if HUDDLE_SCOPED_MEMBER_KINDS.contains(&kind) {
            return check_huddle_scope(tenant, state, author, kind, event).await;
        }
        return Ok(());
    }
    match state
        .db
        .get_relay_member(tenant.community(), &author.to_hex())
        .await
    {
        Ok(Some(member)) if member.role == "owner" => Ok(()),
        Ok(_) => Err(IngestError::Rejected(format!(
            "restricted: kind {kind} is reserved to the community owner"
        ))),
        Err(e) => Err(IngestError::Internal(format!(
            "error: owner lookup failed: {e}"
        ))),
    }
}

/// Member kinds DD-125(3) accepts only inside a governed Huddle temp channel:
/// the guidelines (48106), the emoji burst (24810) and the member's own leave
/// (9022). Listing them in `member_event_kinds` never opens them elsewhere.
pub(crate) const HUDDLE_SCOPED_MEMBER_KINDS: [u32; 3] = [
    KIND_HUDDLE_GUIDELINES,
    KIND_HUDDLE_REACTION,
    KIND_NIP29_LEAVE_REQUEST,
];

/// Whether `owner_created` (is `created_by` the community owner?) plus the
/// stored shape make `channel` a governed Huddle temp channel: a live private
/// stream with a TTL that the owner projected for someone else. Workspace
/// channels are created by the owner (with or without a TTL) and DMs are not
/// streams, so neither ever matches.
pub(crate) fn huddle_projection_shape(channel: &ChannelRecord, owner_created: bool) -> bool {
    channel.ttl_seconds.is_some()
        && channel.visibility == "private"
        && channel.channel_type == "stream"
        && channel.deleted_at.is_none()
        && !owner_created
}

/// DD-125(3): whether `channel` is a governed Huddle temp channel. Always false
/// when governance is off (upstream behaviour is untouched there).
pub(crate) async fn is_huddle_projection(
    state: &AppState,
    tenant: &TenantContext,
    channel: &ChannelRecord,
) -> Result<bool, String> {
    if !is_governed(state) || !huddle_projection_shape(channel, false) {
        return Ok(false);
    }
    let creator = hex::encode(&channel.created_by);
    let member = state
        .db
        .get_relay_member(tenant.community(), &creator)
        .await
        .map_err(|e| format!("owner lookup failed: {e}"))?;
    let owner_created = member.is_some_and(|member| member.role == "owner");
    Ok(huddle_projection_shape(channel, owner_created))
}

async fn check_huddle_scope(
    tenant: &TenantContext,
    state: &AppState,
    author: &PublicKey,
    kind: u32,
    event: &Event,
) -> Result<(), IngestError> {
    let refused = || {
        IngestError::Rejected(format!(
            "restricted: kind {kind} is only accepted in a Huddle channel"
        ))
    };
    let Some(channel_id) = super::ingest::extract_channel_id(event) else {
        return Err(refused());
    };
    let channel = match state
        .db
        .get_channel_for_event_write(tenant.community(), channel_id)
        .await
    {
        Ok(channel) => channel,
        Err(_) => return Err(refused()),
    };
    let huddle = is_huddle_projection(state, tenant, &channel)
        .await
        .map_err(|e| IngestError::Internal(format!("error: {e}")))?;
    if !huddle || channel.archived_at.is_some() {
        return Err(refused());
    }
    // 9022 is the member's own departure: the signer leaves, nobody else.
    if kind == KIND_NIP29_LEAVE_REQUEST && event.pubkey != *author {
        return Err(refused());
    }
    Ok(())
}

/// The single value of a two-element tag `name`, or `None` when it is absent,
/// repeated or malformed.
fn single_tag_value<'a>(event: &'a Event, name: &str) -> Option<&'a str> {
    let mut values = event
        .tags
        .iter()
        .map(Tag::as_slice)
        .filter(|tag| tag.first().is_some_and(|first| first == name));
    let first = values.next()?;
    if values.next().is_some() || first.len() != 2 {
        return None;
    }
    Some(first[1].as_str())
}

fn is_lower_hex64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// The pure shape check of a Huddle temp-channel projection (DD-125(3)): an
/// h-tagged kind:9007 with a positive `ttl`, `visibility=private`,
/// `channel_type=stream` and exactly one lowercase-hex `creator`. Returns the
/// creator, `Ok(None)` when no `creator` tag is present at all.
pub(crate) fn huddle_projection_tags(event: &Event) -> Result<Option<&str>, &'static str> {
    let creators = event
        .tags
        .iter()
        .filter(|tag| {
            tag.as_slice()
                .first()
                .is_some_and(|first| first == "creator")
        })
        .count();
    if creators == 0 {
        return Ok(None);
    }
    let creator = single_tag_value(event, "creator")
        .filter(|creator| is_lower_hex64(creator))
        .ok_or("a Huddle projection names exactly one lowercase hex creator")?;
    let ttl = single_tag_value(event, "ttl").and_then(|ttl| ttl.parse::<i32>().ok());
    if single_tag_value(event, "h").is_none()
        || single_tag_value(event, "visibility") != Some("private")
        || single_tag_value(event, "channel_type") != Some("stream")
        || !ttl.is_some_and(|ttl| ttl > 0)
    {
        return Err("a Huddle projection is an h-tagged private stream with a TTL");
    }
    Ok(Some(creator))
}

/// DD-125(3): the `created_by` of a governed kind:9007. A `creator` tag is the
/// owner's Huddle temp-channel projection (same shape as the 41010 DM
/// projection's `creator`): it is accepted only from the community owner,
/// only on the exact projection shape, and only naming a current relay member
/// who is not the owner. The channel is then created as that member's, so the
/// member's own 48100 links it and the audio admission accepts it. Any other
/// kind:9007 keeps its signer as `created_by` (`Ok(None)`).
pub(crate) async fn huddle_projection_creator(
    tenant: &TenantContext,
    state: &AppState,
    kind: u32,
    event: &Event,
) -> Result<Option<Vec<u8>>, IngestError> {
    if kind != KIND_NIP29_CREATE_GROUP {
        return Ok(None);
    }
    let refused = |why: &str| IngestError::Rejected(format!("invalid: {why}"));
    let creator = match huddle_projection_tags(event) {
        Ok(None) => return Ok(None),
        Ok(Some(creator)) => creator.to_owned(),
        Err(why) => return Err(refused(why)),
    };
    if !is_governed(state) {
        return Err(refused("creator is a governed Huddle projection tag"));
    }
    let lookup = |e: buzz_db::error::DbError| {
        IngestError::Internal(format!("error: relay member lookup failed: {e}"))
    };
    let signer = state
        .db
        .get_relay_member(tenant.community(), &event.pubkey.to_hex())
        .await
        .map_err(lookup)?;
    if !signer.is_some_and(|member| member.role == "owner") {
        return Err(IngestError::Rejected(
            "restricted: a Huddle projection is reserved to the community owner".into(),
        ));
    }
    let member = state
        .db
        .get_relay_member(tenant.community(), &creator)
        .await
        .map_err(lookup)?;
    if !member.is_some_and(|member| member.role != "owner") {
        return Err(refused("the Huddle creator must be a relay member"));
    }
    hex::decode(&creator)
        .map(Some)
        .map_err(|_| refused("creator is not a public key"))
}

/// DD-125(3): the community owner (Tenant CONTROL) manages a governed Huddle
/// temp channel it projected without being its member: 9000/9001 for Agents
/// and removals, and a bare `archived=true` 9002 to end it. Everything else
/// keeps the upstream channel-role checks.
pub(crate) async fn owner_manages_huddle(
    state: &AppState,
    tenant: &TenantContext,
    channel: &ChannelRecord,
    kind: u32,
    event: &Event,
) -> anyhow::Result<bool> {
    if !is_governed(state) || !matches!(kind, 9000..=9002) {
        return Ok(false);
    }
    if kind == 9002 && !is_huddle_archive(event) {
        return Ok(false);
    }
    let signer = state
        .db
        .get_relay_member(tenant.community(), &event.pubkey.to_hex())
        .await?;
    if !signer.is_some_and(|member| member.role == "owner") {
        return Ok(false);
    }
    is_huddle_projection(state, tenant, channel)
        .await
        .map_err(anyhow::Error::msg)
}

/// A kind:9002 that only archives: one `h` and `archived=true`, nothing else.
pub(crate) fn is_huddle_archive(event: &Event) -> bool {
    let mut archive = false;
    for tag in event.tags.iter().map(Tag::as_slice) {
        match tag.first().map(String::as_str) {
            Some("h") if tag.len() == 2 => {}
            Some("archived") if tag.len() == 2 && tag[1] == "true" && !archive => archive = true,
            _ => return false,
        }
    }
    archive && single_tag_value(event, "h").is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Relay state with unreachable Postgres and Redis: nothing here touches
    /// either. `governed` sets `BUZZ_MEMBER_EVENT_KINDS`; `engine` decides
    /// whether a workflow engine is handed in, as main.rs would or would not.
    async fn state(governed: bool, engine: bool) -> Arc<AppState> {
        let mut config = Config::from_env().expect("default config loads");
        config.require_relay_membership = false;
        config.database_url = "postgres://buzz:buzz_dev@127.0.0.1:1/buzz".to_string();
        config.read_database_url = None;
        config.redis_url = "redis://127.0.0.1:1".to_string();
        config.member_event_kinds = governed.then(|| vec![9]);
        let pool = sqlx::PgPool::connect_lazy(&config.database_url).expect("lazy pg pool");
        let db = buzz_db::Db::from_pool(pool.clone());
        let redis_pool = deadpool_redis::Config::from_url(&config.redis_url)
            .create_pool(Some(deadpool_redis::Runtime::Tokio1))
            .expect("redis pool");
        let pubsub = Arc::new(
            buzz_pubsub::PubSubManager::new(&config.redis_url, redis_pool.clone())
                .await
                .expect("pubsub manager"),
        );
        let workflow_engine = engine.then(|| {
            Arc::new(WorkflowEngine::new(
                db.clone(),
                buzz_workflow::WorkflowConfig::default(),
            ))
        });
        let media_storage = buzz_media::MediaStorage::new(&config.media).expect("media storage");
        let (state, _audit_shutdown) = AppState::new(
            config.clone(),
            db,
            redis_pool,
            buzz_audit::AuditService::new(pool.clone()),
            pubsub,
            buzz_auth::AuthService::new(config.auth.clone()),
            buzz_search::SearchService::new(pool),
            workflow_engine,
            Keys::generate(),
            media_storage,
        );
        Arc::new(state)
    }

    fn event(kind: u32, tags: Vec<Tag>) -> Event {
        EventBuilder::new(Kind::from(kind as u16), "")
            .tags(tags)
            .sign_with_keys(&Keys::generate())
            .expect("sign")
    }

    fn a_tag(coordinate: &str) -> Tag {
        Tag::parse(["a", coordinate]).expect("a tag")
    }

    async fn status(router: &Router, method: Method, path: &str) -> StatusCode {
        router
            .clone()
            .oneshot(loopback_request(method, path).expect("request"))
            .await
            .expect("response")
            .status()
    }

    fn tag(parts: &[&str]) -> Tag {
        Tag::parse(parts.iter().copied()).expect("tag")
    }

    fn channel(ttl: Option<i32>, visibility: &str, channel_type: &str) -> ChannelRecord {
        let now = chrono::Utc::now();
        ChannelRecord {
            id: uuid::Uuid::nil(),
            name: "huddle".into(),
            channel_type: channel_type.into(),
            visibility: visibility.into(),
            description: None,
            canvas: None,
            created_by: vec![7; 32],
            created_at: now,
            updated_at: now,
            archived_at: None,
            deleted_at: None,
            nip29_group_id: None,
            topic_required: false,
            max_members: None,
            topic: None,
            topic_set_by: None,
            topic_set_at: None,
            purpose: None,
            purpose_set_by: None,
            purpose_set_at: None,
            ttl_seconds: ttl,
            ttl_deadline: None,
        }
    }

    #[test]
    fn only_owner_projected_private_ttl_streams_are_huddle_channels() {
        assert!(huddle_projection_shape(
            &channel(Some(3600), "private", "stream"),
            false
        ));
        // Workspace channels are the owner's own, TTL or not.
        assert!(!huddle_projection_shape(
            &channel(Some(3600), "private", "stream"),
            true
        ));
        assert!(!huddle_projection_shape(
            &channel(None, "private", "stream"),
            false
        ));
        assert!(!huddle_projection_shape(
            &channel(Some(3600), "private", "dm"),
            false
        ));
        assert!(!huddle_projection_shape(
            &channel(Some(3600), "open", "stream"),
            false
        ));
    }

    #[test]
    fn huddle_projection_tags_require_the_exact_shape() {
        let creator = "a".repeat(64);
        let h = "00000000-0000-4000-8000-000000000001";
        let full = |extra: Vec<Tag>| {
            let mut tags = vec![
                tag(&["h", h]),
                tag(&["name", "huddle"]),
                tag(&["visibility", "private"]),
                tag(&["channel_type", "stream"]),
                tag(&["ttl", "3600"]),
            ];
            tags.extend(extra);
            event(9007, tags)
        };
        let projected = full(vec![tag(&["creator", &creator])]);
        assert_eq!(
            huddle_projection_tags(&projected),
            Ok(Some(creator.as_str()))
        );
        assert_eq!(huddle_projection_tags(&full(vec![])), Ok(None));
        let twice = full(vec![
            tag(&["creator", &creator]),
            tag(&["creator", &creator]),
        ]);
        assert!(huddle_projection_tags(&twice).is_err());
        let upper = full(vec![tag(&["creator", &"A".repeat(64)])]);
        assert!(huddle_projection_tags(&upper).is_err());
        let no_ttl = event(
            9007,
            vec![
                tag(&["h", h]),
                tag(&["visibility", "private"]),
                tag(&["channel_type", "stream"]),
                tag(&["creator", &creator]),
            ],
        );
        assert!(huddle_projection_tags(&no_ttl).is_err());
    }

    #[test]
    fn only_a_bare_archive_is_the_owner_huddle_end() {
        let h = "00000000-0000-4000-8000-000000000001";
        assert!(is_huddle_archive(&event(
            9002,
            vec![tag(&["h", h]), tag(&["archived", "true"])]
        )));
        assert!(!is_huddle_archive(&event(
            9002,
            vec![tag(&["h", h]), tag(&["archived", "false"])]
        )));
        assert!(!is_huddle_archive(&event(
            9002,
            vec![
                tag(&["h", h]),
                tag(&["archived", "true"]),
                tag(&["name", "x"])
            ]
        )));
        assert!(!is_huddle_archive(&event(
            9002,
            vec![tag(&["archived", "true"])]
        )));
    }

    #[tokio::test]
    async fn governed_relay_refuses_every_workflow_event() {
        let state = state(true, false).await;
        let owner = Keys::generate().public_key().to_hex();
        for kind in WORKFLOW_COMMAND_KINDS {
            let refused = check_workflow_event(&state, kind, &event(kind, vec![]));
            assert!(
                matches!(&refused, Err(IngestError::Rejected(m)) if m == WORKFLOWS_DISABLED),
                "kind {kind}"
            );
        }
        let delete_workflow = event(
            KIND_DELETION,
            vec![a_tag(&format!("{KIND_WORKFLOW_DEF}:{owner}:nightly"))],
        );
        assert!(check_workflow_event(&state, KIND_DELETION, &delete_workflow).is_err());

        // Other deletions and ordinary messages pass on to the usual checks.
        let delete_article = event(KIND_DELETION, vec![a_tag(&format!("30023:{owner}:draft"))]);
        assert!(check_workflow_event(&state, KIND_DELETION, &delete_article).is_ok());
        assert!(check_workflow_event(&state, 9, &event(9, vec![])).is_ok());
    }

    #[tokio::test]
    async fn ungoverned_relay_keeps_upstream_workflows() {
        let state = state(false, true).await;
        for kind in WORKFLOW_COMMAND_KINDS {
            assert!(check_workflow_event(&state, kind, &event(kind, vec![])).is_ok());
        }
        assert!(workflow_engine(&state).is_ok());
        let router = crate::router::build_router(Arc::clone(&state));
        // The probe discriminates: a registered route answers 405 to it.
        assert_eq!(
            status(&router, Method::GET, "/hooks/self-check").await,
            StatusCode::METHOD_NOT_ALLOWED
        );
        assert_eq!(
            status(&router, Method::POST, "/workflows/self-check/runs").await,
            StatusCode::METHOD_NOT_ALLOWED
        );
        assert!(verify_workflows_disabled(&state, &router).await.is_ok());
    }

    #[tokio::test]
    async fn governed_relay_serves_no_workflow_route() {
        let state = state(true, false).await;
        let router = crate::router::build_router(Arc::clone(&state));
        assert_eq!(
            status(
                &router,
                Method::POST,
                "/hooks/00000000-0000-0000-0000-000000000000"
            )
            .await,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            status(&router, Method::GET, "/workflows/w/runs").await,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            status(&router, Method::GET, "/workflows/w/runs/r/approvals").await,
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn governed_relay_without_engine_refuses_workflow_commands() {
        let state = state(true, false).await;
        assert!(matches!(
            workflow_engine(&state),
            Err(IngestError::Rejected(m)) if m == WORKFLOWS_DISABLED
        ));
    }

    #[tokio::test]
    async fn self_check_passes_only_when_all_three_are_off() {
        let governed = state(true, false).await;
        let governed_router = crate::router::build_router(Arc::clone(&governed));
        assert_eq!(
            verify_workflows_disabled(&governed, &governed_router).await,
            Ok(())
        );

        // An engine was built.
        let with_engine = state(true, true).await;
        let err = verify_workflows_disabled(&with_engine, &governed_router)
            .await
            .expect_err("engine present");
        assert!(err.contains("workflow engine"), "{err}");

        // Workflow routes are served.
        let ungoverned = state(false, true).await;
        let upstream_router = crate::router::build_router(ungoverned);
        let err = verify_workflows_disabled(&governed, &upstream_router)
            .await
            .expect_err("routes present");
        assert!(err.contains("/hooks/self-check"), "{err}");
    }
}
