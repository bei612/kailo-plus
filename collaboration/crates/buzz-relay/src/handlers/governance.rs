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
//! channel it ran in when the last peer leaves, is not served.
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
    KIND_APPROVAL_DENY, KIND_APPROVAL_GRANT, KIND_DELETION, KIND_WORKFLOW_DEF,
    KIND_WORKFLOW_TRIGGER,
};
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
