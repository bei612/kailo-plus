//! DD-66/67, SS-BUZ-ENGRAM: Core owns only the Installation binding and
//! observed native head references. Relay retains every encrypted memory body.

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use collab_bridge::{
    bridge::{Custody, IdentityClient},
    limits::fetch_nip11,
    memory::{CoreMemory, MemoryError, ReadLimits, Reader, Snapshot},
};
use contracts::{EvidenceKind, ReasonCode};
use secret_store::{PlatformKey, SecretRef};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

use crate::{governance::Refusal, service_api::ServiceState};

#[path = "agent_memory_write.rs"]
pub(crate) mod write;

pub(crate) struct Config {
    limits: ReadLimits,
    read_timeout: std::time::Duration,
}

impl Config {
    /// One required deployment source, no local fallback or invented native
    /// threshold. `Reader` additionally enforces the exported NIP-44 ceiling.
    pub(crate) fn from_env() -> Result<Self, Refusal> {
        let positive = |name: &str| -> Result<u64, Refusal> {
            std::env::var(name)
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .filter(|value| *value > 0)
                .ok_or_else(|| unavailable("Agent memory 缺有效协议上界投递"))
        };
        let event_bound = usize::try_from(positive("AGENT_MEMORY_LIST_LIMIT")?)
            .map_err(|_| unavailable("Agent memory listing 上界不可表示"))?;
        let plaintext_bytes = usize::try_from(positive("AGENT_MEMORY_MAX_DECOMPRESSED_BYTES")?)
            .map_err(|_| unavailable("Agent memory body 上界不可表示"))?;
        let relay_timestamp_window_seconds =
            positive("AGENT_MEMORY_RELAY_TIMESTAMP_WINDOW_SECONDS")?;
        let read_timeout =
            std::time::Duration::from_secs(positive("AGENT_MEMORY_READ_TIMEOUT_SECONDS")?);
        if event_bound.checked_add(1).is_none()
            || tokio::time::Instant::now()
                .checked_add(read_timeout)
                .is_none()
            || plaintext_bytes > collab_bridge::memory::NIP44_PLAINTEXT_MAX
        {
            return Err(unavailable("Agent memory 协议上界不可表示或超出 NIP-44"));
        }
        Ok(Self {
            limits: ReadLimits {
                event_bound,
                plaintext_bytes,
                relay_timestamp_window_seconds,
            },
            read_timeout,
        })
    }
}

#[derive(FromRow)]
struct Binding {
    tenant_id: Uuid,
    workspace_id: Uuid,
    resource_version: i32,
    installation_resource_id: Uuid,
    installation_state: String,
    memory_state: String,
    memory_version: i32,
    agent_pubkey: String,
    agent_binding_state: String,
    agent_secret_status: Option<String>,
    agent_locator: Option<String>,
    agent_secret_version: Option<i32>,
    agent_audience: Option<String>,
    counterparty_pubkey: String,
    counterparty_binding_state: String,
    counterparty_secret_status: Option<String>,
    counterparty_locator: Option<String>,
    counterparty_secret_version: Option<i32>,
    counterparty_audience: Option<String>,
    normalized_host: String,
    nip11_snapshot_digest: Option<String>,
}

/// The caller's existing admission transaction owns the lifecycle fence. It
/// must commit `false` results too: ERROR/UNKNOWN is an observed state, not a
/// discarded failed projection. No additional workflow or memory authority.
pub(crate) async fn reconcile(
    state: &ServiceState,
    conn: &mut PgConnection,
    installation: Uuid,
    config: &Config,
) -> Result<bool, Refusal> {
    let binding = binding(conn, installation, true).await?;
    if binding.memory_state == "REVOKED" {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let agent_ready = binding.agent_binding_state == "ACTIVE"
        || (binding.installation_state == "PROVISIONING"
            && binding.agent_binding_state == "RECONCILING");
    if !agent_ready
        || binding.counterparty_binding_state != "ACTIVE"
        || binding.agent_secret_status.as_deref() != Some("ACTIVE")
        || binding.counterparty_secret_status.as_deref() != Some("ACTIVE")
    {
        let revoked = matches!(binding.agent_binding_state.as_str(), "REVOKING" | "REVOKED")
            || matches!(
                binding.counterparty_binding_state.as_str(),
                "REVOKING" | "REVOKED"
            )
            || binding.agent_secret_status.as_deref() == Some("REVOKED")
            || binding.counterparty_secret_status.as_deref() == Some("REVOKED");
        record(
            conn,
            &binding,
            None,
            "UNKNOWN",
            "UNKNOWN",
            if revoked { "REVOKED" } else { "ERROR" },
        )
        .await?;
        return Ok(false);
    }
    let observed = observe(state, &binding, config, ReadRequest::Snapshot, None).await;
    match observed {
        Ok(Observed::Snapshot(snapshot)) => {
            let ready = !snapshot.head_ahead_of_relay;
            record(
                conn,
                &binding,
                Some(&snapshot),
                "COMPLETE",
                if ready {
                    "CONSISTENT"
                } else {
                    "HEAD_AHEAD_OF_RELAY"
                },
                if ready { "ACTIVE" } else { "ERROR" },
            )
            .await?;
            Ok(ready)
        }
        Ok(_) => Err(unavailable("Agent memory 对账结果类型不符")),
        Err(error) => {
            record(
                conn,
                &binding,
                None,
                if matches!(error, ObserveError::Native(MemoryError::BoundExceeded)) {
                    "BOUND_EXCEEDED"
                } else {
                    "UNKNOWN"
                },
                "UNKNOWN",
                "ERROR",
            )
            .await?;
            Ok(false)
        }
    }
}

/// Session birth reads once from the original pair. The Invocation must
/// already exist and be admitted; a binding cached head is not session memory.
/// `None` means UNREADABLE, never ABSENT, and contains no event reference.
pub(crate) async fn read_core(
    state: &ServiceState,
    conn: &mut PgConnection,
    invocation: Uuid,
    config: &Config,
    frozen_event: Option<&str>,
) -> Result<Option<CoreMemory>, Refusal> {
    let installation: Option<Uuid> = sqlx::query_scalar(
        "select v.installation_resource_id from catalog.agent_invocation v
         join catalog.agent_installation i on i.resource_id=v.installation_resource_id
           and i.workspace_id=v.workspace_id and i.pinned_version_asset_id=v.agent_version_asset_id
           and i.active_projection_generation=v.projection_generation and i.state='ACTIVE'
         join catalog.resource r on r.id=i.resource_id and r.tenant_id=v.tenant_id
           and r.home_workspace_id=v.workspace_id and r.state='ACTIVE'
           and r.projection_action_execution_id is null
         join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
           and p.generation=v.projection_generation and p.agent_version_asset_id=v.agent_version_asset_id
           and p.state='ACTIVE'
         where v.id=$1 and v.status in ('CREATED','DISPATCHING','RUNNING') for update of v",
    ).bind(invocation).fetch_optional(&mut *conn).await?;
    let binding = binding(
        conn,
        installation.ok_or(Refusal::Denied(ReasonCode::ScopeGuardFailed))?,
        false,
    )
    .await?;
    if binding.installation_state != "ACTIVE"
        || binding.memory_state != "ACTIVE"
        || binding.agent_binding_state != "ACTIVE"
        || binding.counterparty_binding_state != "ACTIVE"
        || binding.agent_secret_status.as_deref() != Some("ACTIVE")
        || binding.counterparty_secret_status.as_deref() != Some("ACTIVE")
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let request = match frozen_event {
        Some(event) => ReadRequest::CoreEvent(event),
        None => ReadRequest::Core,
    };
    match observe(state, &binding, config, request, None).await {
        Ok(Observed::Core(core)) => Ok(Some(core)),
        Ok(_) => Err(unavailable("Agent memory Session 结果类型不符")),
        Err(ObserveError::Native(_)) => Ok(None),
        Err(ObserveError::Binding) => {
            Err(unavailable("Agent memory 身份/secret/projection 不可查证"))
        }
    }
}

async fn binding(
    conn: &mut PgConnection,
    installation: Uuid,
    provisioning: bool,
) -> Result<Binding, Refusal> {
    sqlx::query_as(
        "select r.tenant_id,i.workspace_id,r.version resource_version,
           i.resource_id as installation_resource_id,i.state as installation_state,
           m.state as memory_state,m.version as memory_version,
           a.pubkey as agent_pubkey,a.state as agent_binding_state,
           a.private_key_secret_status as agent_secret_status,
           a.private_key_secret_ref as agent_locator,a.private_key_secret_version as agent_secret_version,
           a.private_key_secret_audience as agent_audience,
           c.pubkey as counterparty_pubkey,c.state as counterparty_binding_state,
           c.private_key_secret_status as counterparty_secret_status,
           c.private_key_secret_ref as counterparty_locator,c.private_key_secret_version as counterparty_secret_version,
           c.private_key_secret_audience as counterparty_audience,tb.normalized_host,tb.nip11_snapshot_digest
         from catalog.agent_installation i join catalog.resource r on r.id=i.resource_id
         join identity.tenant t on t.id=r.tenant_id and t.state='ACTIVE'
         join identity.workspace w on w.id=i.workspace_id and w.tenant_id=t.id and w.state='ACTIVE'
         join identity.principal owner on owner.id=r.owner_principal_id and owner.tenant_id=t.id
           and owner.kind='HUMAN' and owner.status='ACTIVE'
         join identity.tenant_membership om on om.tenant_principal_id=owner.id
           and om.tenant_id=t.id and om.state='ACTIVE'
         join identity.principal agent on agent.id=i.agent_principal_id and agent.tenant_id=t.id
           and agent.kind='AGENT' and agent.status='ACTIVE'
         join catalog.agent_memory_binding m on m.installation_resource_id=i.resource_id
         join identity.buzz_identity_binding a on a.pubkey=m.agent_buzz_identity_binding_id
           and a.tenant_id=t.id and a.principal_id=agent.id and a.kind='AGENT' and a.custody='SERVER'
         join projection.tenant_buzz_binding tb on tb.tenant_id=t.id and tb.state='ACTIVE'
           and tb.require_relay_membership and not tb.allow_nip_oa_auth and not tb.pubkey_allowlist_enabled
         join identity.buzz_identity_binding c on c.pubkey=m.memory_counterparty_buzz_identity_binding_id
           and c.tenant_id=t.id and c.principal_id=tb.control_service_principal_id
           and c.kind='CONTROL' and c.custody='SERVER'
         join identity.principal cp on cp.id=c.principal_id and cp.tenant_id=t.id
           and cp.kind='SERVICE' and cp.status='ACTIVE'
         where i.resource_id=$1 and r.type_key='agent.installation' and r.home_workspace_id=w.id
           and ((i.state='ACTIVE' and r.state='ACTIVE' and r.projection_action_execution_id is null)
             or ($2::boolean and i.state='PROVISIONING' and r.state='PROVISIONING'
               and exists(select 1 from admission.action_execution ae
                 join projection.workflow_ref f on f.action_execution_id=ae.id and f.tenant_id=t.id
                   and f.operation_id=ae.operation_id and f.workflow_id=ae.temporal_workflow_id
                   and f.workflow_type='ComponentTaskWorkflow' and f.kind='AGENT_INSTALLATION'
                   and f.projection_state='RUNNING' and f.run_id is not null
                 where ae.id=r.projection_action_execution_id and ae.tenant_id=t.id
                   and ae.workspace_id=w.id and ae.target_id=i.resource_id
                   and ae.action_key='agent.installation.create' and ae.gate_state='ALLOWED')))
         for update of t,w,r,i,m,a,c,tb,agent,owner,om,cp",
    ).bind(installation).bind(provisioning).fetch_optional(&mut *conn).await?
        .ok_or(Refusal::Denied(ReasonCode::ScopeGuardFailed))
}

enum Observed {
    Snapshot(Snapshot),
    Core(CoreMemory),
    Entries(Vec<collab_bridge::memory::EntryHead>, usize),
    Entry(Option<collab_bridge::memory::MemoryEntry>),
}
enum ObserveError {
    Binding,
    Native(MemoryError),
}

enum ReadRequest<'a> {
    Snapshot,
    Core,
    CoreEvent(&'a str),
    CoreManagement,
    Entries,
    Entry(&'a str),
}

async fn observe(
    state: &ServiceState,
    binding: &Binding,
    config: &Config,
    request: ReadRequest<'_>,
    budget: Option<std::sync::Arc<collab_bridge::limits::ApiBudget>>,
) -> Result<Observed, ObserveError> {
    tokio::time::timeout(
        config.read_timeout,
        observe_native(state, binding, config, request, budget),
    )
    .await
    .unwrap_or(Err(ObserveError::Native(MemoryError::Unavailable)))
}

async fn observe_native(
    state: &ServiceState,
    binding: &Binding,
    config: &Config,
    request: ReadRequest<'_>,
    budget: Option<std::sync::Arc<collab_bridge::limits::ApiBudget>>,
) -> Result<Observed, ObserveError> {
    crate::service_api::audit_gate(state)
        .await
        .map_err(|_| ObserveError::Binding)?;
    let counterparty = read_counterparty(state, binding).await?;
    let mut client = IdentityClient::new(
        Custody::Server,
        &counterparty.secret_key().to_secret_hex(),
        &state.relay_transport,
        &binding.normalized_host,
    )
    .map_err(|_| ObserveError::Binding)?;
    if let Some(budget) = budget {
        client = client.with_budget(budget);
    }
    let transport =
        reqwest::Url::parse(&state.relay_transport).map_err(|_| ObserveError::Binding)?;
    let nip11 = fetch_nip11(&state.http, &transport, &binding.normalized_host)
        .await
        .map_err(|_| ObserveError::Binding)?;
    if binding.nip11_snapshot_digest.as_deref() != Some(nip11.digest.as_str()) {
        return Err(ObserveError::Binding);
    }
    let reader = Reader::new(
        &client,
        &counterparty,
        &binding.agent_pubkey,
        &nip11.limits,
        config.limits,
    )
    .map_err(ObserveError::Native)?;
    let now = u64::try_from(chrono::Utc::now().timestamp()).map_err(|_| ObserveError::Binding)?;
    match request {
        ReadRequest::Core => reader
            .read_core(&state.http, now)
            .await
            .map(Observed::Core)
            .map_err(ObserveError::Native),
        ReadRequest::CoreManagement => reader
            .read_core_entry(&state.http, now)
            .await
            .map(Observed::Entry)
            .map_err(ObserveError::Native),
        ReadRequest::CoreEvent(event) => reader
            .read_core_event(&state.http, event, now)
            .await
            .map(Observed::Core)
            .map_err(ObserveError::Native),
        ReadRequest::Snapshot => reader
            .inspect(&state.http, now)
            .await
            .map(Observed::Snapshot)
            .map_err(ObserveError::Native),
        ReadRequest::Entries => reader
            .list_entries(&state.http, now)
            .await
            .map(|(entries, bytes)| Observed::Entries(entries, bytes))
            .map_err(ObserveError::Native),
        ReadRequest::Entry(slug) => reader
            .read_entry(&state.http, slug, now)
            .await
            .map(Observed::Entry)
            .map_err(ObserveError::Native),
    }
}

async fn read_counterparty(
    state: &ServiceState,
    binding: &Binding,
) -> Result<nostr::Keys, ObserveError> {
    let reference = |locator: &Option<String>, version: Option<i32>, audience: &Option<String>| {
        let locator = locator
            .as_ref()
            .filter(|value| !value.is_empty())
            .ok_or(ObserveError::Binding)?;
        let version = version
            .and_then(|value| u32::try_from(value).ok())
            .filter(|value| *value > 0)
            .ok_or(ObserveError::Binding)?;
        let audience = audience
            .as_ref()
            .filter(|value| **value == state.secret_audience)
            .ok_or(ObserveError::Binding)?;
        Ok::<_, ObserveError>(SecretRef {
            locator: locator.clone(),
            version,
            audience: audience.clone(),
        })
    };
    let agent_ref = reference(
        &binding.agent_locator,
        binding.agent_secret_version,
        &binding.agent_audience,
    )?;
    let counterparty_ref = reference(
        &binding.counterparty_locator,
        binding.counterparty_secret_version,
        &binding.counterparty_audience,
    )?;
    let expected_agent = state.secrets.tenant_locator(
        binding.tenant_id,
        &format!(
            "buzz-agent/installation/{}",
            binding.installation_resource_id
        ),
    );
    if agent_ref.locator != expected_agent
        || !state.secrets.owns_platform_key(
            PlatformKey::Control,
            binding.tenant_id,
            &counterparty_ref.locator,
        )
    {
        return Err(ObserveError::Binding);
    }
    // Both frozen key references must still match their pubkeys. The AGENT
    // private key is never used to query or sign a write in this read adapter.
    crate::server_identity::read_bound_keys(&state.secrets, &agent_ref, &binding.agent_pubkey)
        .await
        .map_err(|_| ObserveError::Binding)?;
    let counterparty = crate::server_identity::read_bound_keys(
        &state.secrets,
        &counterparty_ref,
        &binding.counterparty_pubkey,
    )
    .await
    .map_err(|_| ObserveError::Binding)?;
    Ok(counterparty)
}

#[derive(Deserialize)]
pub struct EntryQuery {
    slug: String,
}

/// DD-66/68, 19 §5: HUMAN reads use the same controlled pair as Session reads.
/// No client-supplied identity, Relay origin, filter or key is accepted.
pub async fn core(
    State(state): State<crate::bff::BffState>,
    headers: HeaderMap,
    Path(installation): Path<Uuid>,
) -> Response {
    management_read(
        &state,
        &headers,
        installation,
        ReadRequest::CoreManagement,
        "core",
    )
    .await
}

pub async fn entries(
    State(state): State<crate::bff::BffState>,
    headers: HeaderMap,
    Path(installation): Path<Uuid>,
) -> Response {
    management_read(&state, &headers, installation, ReadRequest::Entries, "").await
}

pub async fn entry(
    State(state): State<crate::bff::BffState>,
    headers: HeaderMap,
    Path(installation): Path<Uuid>,
    Query(query): Query<EntryQuery>,
) -> Response {
    if query.slug == "core" || collab_bridge::memory::validate_slug(&query.slug).is_err() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    management_read(
        &state,
        &headers,
        installation,
        ReadRequest::Entry(&query.slug),
        &query.slug,
    )
    .await
}

async fn read_permission(
    state: &crate::bff::BffState,
    ctx: &crate::bff::ExecutionContext,
    binding: &Binding,
    definition: &crate::governance::Definition,
) -> Result<String, Refusal> {
    let admitted = crate::web_transport::workspace_admissions(state, ctx, &[binding.workspace_id])
        .await
        .map_err(|_| unavailable("Memory Workspace 准入不可查证"))?;
    if !admitted.contains_key(&binding.workspace_id) {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let checked = state
        .governance
        .evaluate(
            crate::governance::Actor {
                tenant_id: ctx.tenant_id,
                principal_id: ctx.tenant_principal_id,
                human_identity_id: Some(ctx.human_identity_id),
            },
            definition,
            &crate::governance::Target {
                id: binding.installation_resource_id,
                version: binding.resource_version,
                workspace_id: Some(binding.workspace_id),
            },
        )
        .await?;
    if !checked.allowed {
        return Err(Refusal::Denied(
            checked.reason.unwrap_or(ReasonCode::PermissionDenied),
        ));
    }
    checked
        .zed_token
        .filter(|token| !token.is_empty())
        .ok_or_else(|| unavailable("Memory read 缺 fresh revision"))
}

async fn management_read(
    state: &crate::bff::BffState,
    headers: &HeaderMap,
    installation: Uuid,
    request: ReadRequest<'_>,
    slug: &str,
) -> Response {
    let ctx = match crate::bff::resolve_execution_context(state, headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let mut response = match management_result(state, &ctx, installation, request, slug).await {
        Ok(value) => ([(header::CACHE_CONTROL, "no-store")], Json(value)).into_response(),
        Err(error) => error.respond(None),
    };
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("no-store"),
    );
    response
}

async fn lock_read_context(
    ctx: &crate::bff::ExecutionContext,
    installation: Uuid,
    conn: &mut PgConnection,
) -> Result<Binding, Refusal> {
    if !crate::roles::lock_tenant(conn, ctx.tenant_id).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    // Lock the real HUMAN/session membership, not a cached browser identity.
    let actor: Option<Uuid> = sqlx::query_scalar(
        "select p.id from identity.principal p
         join identity.tenant_membership tm on tm.tenant_principal_id=p.id and tm.tenant_id=p.tenant_id
         join identity.human_identity h on h.id=tm.human_identity_id
         join identity.platform_session s on s.tenant_membership_id=tm.id and s.human_identity_id=h.id
         where p.id=$1 and p.tenant_id=$2 and p.kind='HUMAN' and p.status='ACTIVE'
           and tm.state='ACTIVE' and h.id=$3 and h.status='ACTIVE'
           and s.id=$4 and s.status='ACTIVE' and s.expires_at>clock_timestamp()
         for update of p,tm,h,s",
    ).bind(ctx.tenant_principal_id).bind(ctx.tenant_id).bind(ctx.human_identity_id)
        .bind(ctx.session_id).fetch_optional(&mut *conn).await?;
    let scoped: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.resource r join catalog.agent_installation i on i.resource_id=r.id
         where r.id=$1 and r.tenant_id=$2 and r.type_key='agent.installation'
           and r.home_workspace_id=i.workspace_id and r.state='ACTIVE' and i.state='ACTIVE'
           and r.projection_action_execution_id is null)",
    ).bind(installation).bind(ctx.tenant_id).fetch_one(&mut *conn).await?;
    if actor.is_none() || !scoped {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let binding = binding(conn, installation, false).await?;
    if binding.tenant_id != ctx.tenant_id
        || binding.memory_state != "ACTIVE"
        || binding.agent_binding_state != "ACTIVE"
        || binding.counterparty_binding_state != "ACTIVE"
        || binding.agent_secret_status.as_deref() != Some("ACTIVE")
        || binding.counterparty_secret_status.as_deref() != Some("ACTIVE")
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    // A concurrent member revocation cannot change this row while plaintext is
    // being read. The original scope checker still decides manager exceptions.
    let _: Option<Uuid> = sqlx::query_scalar(
        "select id from identity.workspace_membership where workspace_id=$1 and tenant_principal_id=$2 for update",
    ).bind(binding.workspace_id).bind(ctx.tenant_principal_id).fetch_optional(&mut *conn).await?;
    // The Workspace checker is still the existing BFF scope authority.
    Ok(binding)
}

async fn management_result(
    state: &crate::bff::BffState,
    ctx: &crate::bff::ExecutionContext,
    installation: Uuid,
    request: ReadRequest<'_>,
    slug: &str,
) -> Result<Value, Refusal> {
    let listing = matches!(request, ReadRequest::Entries);
    let action = if listing {
        "agent.memory.entry.list"
    } else if slug == "core" {
        "agent.memory.core.read"
    } else {
        "agent.memory.entry.read"
    };
    let definition = crate::governance::active_definition(&state.pool, action)
        .await?
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    if definition.permission != "read"
        || definition.permission_object_type != "resource"
        || definition.target_type != "RESOURCE"
        || definition.tenant_rule != "SESSION_TENANT"
        || definition.workspace_rule != "WORKSPACE_REQUIRED"
        || definition.execution_mode != "SYNC"
        || definition.confirmation_mode != "NONE"
        || definition.approval_policy_id.is_some()
        || definition.approval_policy_version.is_some()
        || definition.workflow_kind.is_some()
        || definition.quota_policy != "NONE"
        || definition.result_exposure != "READ"
        || definition.meters != ["agent_memory_read_count", "agent_memory_plaintext_bytes"]
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let mut tx = state.pool.begin().await?;
    let binding = lock_read_context(ctx, installation, &mut tx).await?;
    let revision = read_permission(state, ctx, &binding, &definition).await?;
    let billing = memory_billing(&mut tx, state, &binding).await?;
    let digest = hex::encode(Sha256::digest(slug.as_bytes()));
    let parameters = json!({"memoryUsage":billing,"slugDigest":digest,
        "targetVersion":binding.resource_version,"platformSessionId":ctx.session_id});
    let hash = collab_bridge::limits::canonical_digest(&json!({"actionKey":action,
        "actionVersion":definition.version,"targetId":installation,"parameters":parameters}));
    let ae = crate::governance::open_execution_values(
        &mut tx,
        crate::governance::Actor {
            tenant_id: ctx.tenant_id,
            principal_id: ctx.tenant_principal_id,
            human_identity_id: Some(ctx.human_identity_id),
        },
        ctx.tenant_principal_id,
        &definition,
        &crate::governance::Target {
            id: installation,
            version: binding.resource_version,
            workspace_id: Some(binding.workspace_id),
        },
        parameters,
        hash,
        Uuid::new_v4(),
        None,
    )
    .await?;
    crate::governance::record_owned_decision(
        &mut tx,
        &crate::governance::DecisionSubject {
            action_execution_id: ae.id,
            operation_id: ae.operation_id,
            tenant_id: ae.tenant_id,
            workspace_id: ae.workspace_id,
            principal_id: ae.initiator_principal_id,
            action_key: &ae.action_key,
            action_version: ae.action_version,
            target_id: ae.target_id,
            parameter_hash: &ae.parameter_hash,
        },
        &revision,
    )
    .await?;
    sqlx::query(
        "update admission.action_execution set gate_state='ALLOWED',updated_at=now()
        where id=$1 and gate_state='EVALUATING'",
    )
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    let operation = ae.operation_id;
    let observed = observe(
        &state.memory_service,
        &binding,
        &state.memory_service.agent_memory,
        request,
        Some(state.relay_budget.clone()),
    )
    .await;
    let mut result = json!({"installationResourceId": installation, "workspaceId": binding.workspace_id,
        "operationId": operation});
    let mut evidence = vec![crate::audit::Evidence::new(
        EvidenceKind::PlatformSessionId,
        ctx.session_id,
    )];
    let outcome;
    let plaintext_bytes;
    if listing {
        let (status, entries) = match observed {
            Ok(Observed::Entries(entries, bytes)) => {
                plaintext_bytes = Some(bytes);
                (
                    "COMPLETE",
                    entries
                        .into_iter()
                        .map(|entry| {
                            evidence.push(crate::audit::Evidence::new(
                                EvidenceKind::BuzzEventId,
                                &entry.head.event_id,
                            ));
                            json!({"slug":entry.slug,"eventId":entry.head.event_id,
                    "createdAt":entry.head.created_at,"tombstone":entry.tombstone})
                        })
                        .collect::<Vec<_>>(),
                )
            }
            Err(ObserveError::Native(MemoryError::BoundExceeded)) => {
                plaintext_bytes = None;
                ("BOUND_EXCEEDED", Vec::new())
            }
            Err(_) => {
                plaintext_bytes = None;
                ("UNKNOWN", Vec::new())
            }
            Ok(_) => return Err(unavailable("Memory listing 原生结果不符")),
        };
        outcome = status;
        result["state"] = json!(status);
        result["entries"] = json!(entries);
        // Decode the real response through the generated contract, including
        // state enums; no manually maintained cross-language response type.
        result = serde_json::to_value(
            serde_json::from_value::<contracts::AgentMemoryEntryPage>(result)
                .map_err(|_| unavailable("Memory listing 不符合共享契约"))?,
        )
        .map_err(|_| unavailable("Memory listing 不可编码"))?;
    } else {
        result["slug"] = json!(slug);
        let (status, head, body, value_hash) = match observed {
            Ok(Observed::Entry(None)) => {
                plaintext_bytes = Some(0);
                ("ABSENT", None, None, None)
            }
            Ok(Observed::Entry(Some(entry))) => {
                plaintext_bytes = Some(entry.plaintext_bytes);
                (
                    if entry.value.is_some() {
                        "FOUND"
                    } else {
                        "ABSENT"
                    },
                    Some(entry.head),
                    entry.value,
                    entry.value_hash,
                )
            }
            Err(_) => {
                plaintext_bytes = None;
                ("UNREADABLE", None, None, None)
            }
            Ok(_) => return Err(unavailable("Memory read 原生结果不符")),
        };
        outcome = status;
        result["state"] = json!(status);
        if let Some(head) = head {
            evidence.push(crate::audit::Evidence::new(
                EvidenceKind::BuzzEventId,
                &head.event_id,
            ));
            result["eventId"] = json!(head.event_id);
            result["createdAt"] = json!(head.created_at);
        }
        if let Some(body) = body {
            result["contentBytes"] = json!(body.len());
            result["content"] = json!(body);
            if let Some(value_hash) = value_hash {
                result["valueHash"] = json!(value_hash);
            }
        }
        result = serde_json::to_value(
            serde_json::from_value::<contracts::AgentMemoryReadView>(result)
                .map_err(|_| unavailable("Memory read 不符合共享契约"))?,
        )
        .map_err(|_| unavailable("Memory read 不可编码"))?;
    }
    // Do not expose already decrypted data after a fresh permission failure.
    read_permission(state, ctx, &binding, &definition).await?;
    crate::audit::append(
        &mut tx,
        crate::audit::AuditEntry {
            event_key: format!("memory:{operation}"),
            tenant_id: Some(ctx.tenant_id),
            workspace_id: Some(binding.workspace_id),
            operation_id: operation,
            event_type: "ACCESS",
            human_identity_id: Some(ctx.human_identity_id),
            initiator_principal_id: Some(ctx.tenant_principal_id),
            actor_principal_id: Some(ctx.tenant_principal_id),
            action_key: action,
            action_version: definition.version,
            component_type_key: "agent.installation",
            target_type: Some("RESOURCE"),
            target_id: Some(installation),
            parameter_hash: &digest,
            decision: "ALLOW",
            result_code: outcome,
            result_exposure: "NONE",
            evidence_refs: evidence.clone(),
            correlation_id: operation,
        },
    )
    .await?;
    let usage_ids = if let Some(bytes) = plaintext_bytes {
        record_memory_usage(&mut tx, &ae, &billing, bytes, outcome, &evidence).await?
    } else {
        Vec::new()
    };
    crate::governance::record_dispatch(
        &mut tx,
        ae.id,
        definition.audit_class(),
        if plaintext_bytes.is_some() {
            Ok(())
        } else {
            Err(StatusCode::SERVICE_UNAVAILABLE)
        },
        evidence,
    )
    .await?;
    tx.commit().await?;
    if !usage_ids.is_empty() {
        let settled = tokio::time::timeout(
            state.memory_service.agent_memory.read_timeout,
            confirm_memory_usage(state, &ae, &usage_ids),
        )
        .await;
        if !matches!(settled, Ok(Ok(true))) {
            return Err(unavailable(
                "BILLING_UNAVAILABLE: Memory 计量未获原生存储证据",
            ));
        }
    }
    // Delivery released the original transaction. Reacquire the SAME scope and
    // current session/owner/read authority before disclosing any plaintext.
    let mut tx = state.pool.begin().await?;
    let current = lock_read_context(ctx, installation, &mut tx).await?;
    if current.workspace_id != binding.workspace_id
        || current.agent_pubkey != binding.agent_pubkey
        || current.counterparty_pubkey != binding.counterparty_pubkey
        || current.resource_version != binding.resource_version
        || current.memory_version != binding.memory_version
        || current.agent_locator != binding.agent_locator
        || current.agent_secret_version != binding.agent_secret_version
        || current.counterparty_locator != binding.counterparty_locator
        || current.counterparty_secret_version != binding.counterparty_secret_version
        || current.normalized_host != binding.normalized_host
        || current.nip11_snapshot_digest != binding.nip11_snapshot_digest
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    if plaintext_bytes.is_some() && memory_billing(&mut tx, state, &current).await? != billing {
        return Err(unavailable("BILLING_UNAVAILABLE: Memory 计量映射已变化"));
    }
    if plaintext_bytes.is_some() {
        tokio::time::timeout(
            state.memory_service.agent_memory.read_timeout,
            read_counterparty(&state.memory_service, &current),
        )
        .await
        .map_err(|_| unavailable("Memory disclosure 身份不可查证"))?
        .map_err(|_| unavailable("Memory disclosure 身份不可查证"))?;
    }
    let revision = read_permission(state, ctx, &current, &definition).await?;
    let session_current: bool = sqlx::query_scalar(
        "select exists(select 1 from identity.platform_session
        where id=$1 and status='ACTIVE' and expires_at>clock_timestamp())",
    )
    .bind(ctx.session_id)
    .fetch_one(&mut *tx)
    .await?;
    if !session_current {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    crate::audit::append(
        &mut tx,
        crate::audit::AuditEntry {
            event_key: format!("memory:{operation}:disclosure"),
            tenant_id: Some(ctx.tenant_id),
            workspace_id: Some(current.workspace_id),
            operation_id: operation,
            event_type: "ACCESS",
            human_identity_id: Some(ctx.human_identity_id),
            initiator_principal_id: Some(ctx.tenant_principal_id),
            actor_principal_id: Some(ctx.tenant_principal_id),
            action_key: action,
            action_version: definition.version,
            component_type_key: "agent.installation",
            target_type: Some("RESOURCE"),
            target_id: Some(installation),
            parameter_hash: &digest,
            decision: "ALLOW",
            result_code: outcome,
            result_exposure: if plaintext_bytes.is_some() {
                "READ"
            } else {
                "NONE"
            },
            evidence_refs: vec![crate::audit::Evidence::new(
                EvidenceKind::SpicedbZedtoken,
                revision,
            )],
            correlation_id: operation,
        },
    )
    .await?;
    tx.commit().await?;
    Ok(result)
}

async fn memory_billing(
    conn: &mut PgConnection,
    state: &crate::bff::BffState,
    binding: &Binding,
) -> Result<Value, Refusal> {
    let row: Option<(String, String, String, i32)> = sqlx::query_as(
        "select customer_id,namespace,subject_key_prefix,version from projection.openmeter_binding
         where tenant_id=$1 and status='ACTIVE' for update",
    )
    .bind(binding.tenant_id)
    .fetch_optional(&mut *conn)
    .await?;
    let (customer, namespace, prefix, version) =
        row.ok_or_else(|| unavailable("BILLING_UNAVAILABLE: Memory 缺真实 Customer binding"))?;
    if namespace != state.memory_service.openmeter.namespace() {
        return Err(unavailable("BILLING_UNAVAILABLE: Memory namespace 不匹配"));
    }
    let subject = format!("{prefix}{}", binding.installation_resource_id);
    let meters = tokio::time::timeout(
        state.memory_service.agent_memory.read_timeout,
        state
            .memory_service
            .openmeter
            .memory_read_meters(binding.tenant_id, &customer, &subject),
    )
    .await
    .map_err(|_| unavailable("BILLING_UNAVAILABLE: Memory 原生 meter 查证超时"))?
    .map_err(|_| unavailable("BILLING_UNAVAILABLE: Memory 原生 meter 不可查证"))?;
    Ok(
        json!({"namespace":namespace,"customer_id":customer,"binding_version":version,"subject":subject,"meters":meters}),
    )
}

async fn record_memory_usage(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ae: &crate::governance::Execution,
    billing: &Value,
    bytes: usize,
    outcome: &str,
    evidence: &[crate::audit::Evidence],
) -> Result<Vec<Uuid>, Refusal> {
    let bytes = i64::try_from(bytes).map_err(|_| unavailable("Memory 原生字节数不可表示"))?;
    let meters: Vec<crate::openmeter::MemoryMeter> =
        serde_json::from_value(billing["meters"].clone())
            .map_err(|_| unavailable("Memory meter 投影不可查证"))?;
    // The native event reader verifies RFC3339 seconds precision. This is the
    // actual read-completion clock, not the engram's historical created_at.
    let occurred: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("select date_trunc('second',clock_timestamp())")
            .fetch_one(&mut **tx)
            .await?;
    let heads: Vec<&str> = evidence
        .iter()
        .filter(|e| e.kind == EvidenceKind::BuzzEventId)
        .map(|e| e.value.as_str())
        .collect();
    let dimensions = json!({"tenant_id":ae.tenant_id,"workspace_id":ae.workspace_id,
        "operation_id":ae.operation_id,"agent_installation_resource_id":ae.target_id,
        "plaintext_bytes":bytes,"action_key":ae.action_key,
        "slug_digest":ae.parameters.as_ref().and_then(|p| p.get("slugDigest"))
            .ok_or_else(|| unavailable("Memory read 缺冻结 slug digest"))?,
        "read_outcome":outcome,"native_event_ids":heads});
    let mut ids = Vec::new();
    for meter in meters {
        let quantity = match meter.key.as_str() {
            "agent_memory_read_count" => 1,
            "agent_memory_plaintext_bytes" => bytes,
            _ => return Err(unavailable("Memory meter 未识别")),
        };
        let id = Uuid::new_v5(
            &Uuid::NAMESPACE_URL,
            format!("{}:BUZZ_AGENT_MEMORY:{}:{}", ae.tenant_id, ae.id, meter.key).as_bytes(),
        );
        let event = json!({"specversion":"1.0","source":"urn:platform:core:usage","id":id,
            "type":meter.event_type,"subject":billing["subject"],"time":occurred.to_rfc3339(),"data":dimensions});
        sqlx::query("insert into outbox.usage_event
            (id,operation_id,tenant_id,workspace_id,openmeter_customer_id,agent_installation_resource_id,
             source_type,source_id,meter_key,subject_key,quantity,occurred_at,dimensions,openmeter_event_id,event,
             settlement_status,openmeter_namespace)
            values($1,$2,$3,$4,$5,$6,'BUZZ_AGENT_MEMORY',$7,$8,$9,$10,$11,$12,$1,$13,'PENDING_PUBLISH',$14)")
            .bind(id).bind(ae.operation_id).bind(ae.tenant_id).bind(ae.workspace_id)
            .bind(billing["customer_id"].as_str()).bind(ae.target_id).bind(ae.id).bind(meter.key)
            .bind(billing["subject"].as_str()).bind(quantity).bind(occurred).bind(&dimensions).bind(event)
            .bind(billing["namespace"].as_str()).execute(&mut **tx).await?;
        ids.push(id);
    }
    Ok(ids)
}

async fn confirm_memory_usage(
    state: &crate::bff::BffState,
    ae: &crate::governance::Execution,
    ids: &[Uuid],
) -> Result<bool, &'static str> {
    if !crate::gateway_usage::settle_events(&state.pool, ids, &state.memory_service.openmeter)
        .await?
    {
        return Ok(false);
    }
    let events: Vec<(Uuid, Value, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "select id,event,stored_at from outbox.usage_event where id=any($1)
         and tenant_id=$2 and operation_id=$3 and source_type='BUZZ_AGENT_MEMORY' and source_id=$4
         and settlement_status='COMMITTED' and stored_at is not null",
    )
    .bind(ids)
    .bind(ae.tenant_id)
    .bind(ae.operation_id)
    .bind(ae.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| "MEMORY_USAGE_READ_FAILED")?;
    if ids.len() != 2 || events.len() != ids.len() {
        return Ok(false);
    }
    for (_, event, stored_at) in events {
        let evidence = state
            .memory_service
            .openmeter
            .stored_usage(&event)
            .await
            .map_err(|_| "MEMORY_USAGE_NATIVE_UNKNOWN")?;
        if !evidence.is_some_and(|e| e.stored_at == stored_at && !e.configuration_warning) {
            return Ok(false);
        }
    }
    Ok(true)
}

async fn record(
    conn: &mut PgConnection,
    binding: &Binding,
    snapshot: Option<&Snapshot>,
    listing: &str,
    head: &str,
    state: &str,
) -> Result<(), Refusal> {
    let reference = snapshot.and_then(|snapshot| match &snapshot.core {
        CoreMemory::Found { head, .. } => Some(head),
        CoreMemory::Absent => None,
    });
    let timestamp = reference
        .map(|head| i64::try_from(head.created_at))
        .transpose()
        .map_err(|_| unavailable("Agent memory head 时间不可表示"))?;
    let changed = sqlx::query(
        "update catalog.agent_memory_binding set listing_state=$1,head_state=$2,state=$3,
           core_head_event_id=case when $4::boolean then $5 else core_head_event_id end,
           core_head_created_at=case when $4::boolean then $6 else core_head_created_at end,version=version+1
         where installation_resource_id=$7 and version=$8 and state=$9
           and agent_buzz_identity_binding_id=$10 and memory_counterparty_buzz_identity_binding_id=$11",
    ).bind(listing).bind(head).bind(state).bind(snapshot.is_some())
        .bind(reference.map(|head| head.event_id.as_str())).bind(timestamp)
        .bind(binding.installation_resource_id).bind(binding.memory_version).bind(&binding.memory_state)
        .bind(&binding.agent_pubkey).bind(&binding.counterparty_pubkey).execute(&mut *conn).await?;
    if changed.rows_affected() != 1 {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    Ok(())
}

fn unavailable(message: &str) -> Refusal {
    Refusal::Unavailable(message.into())
}
