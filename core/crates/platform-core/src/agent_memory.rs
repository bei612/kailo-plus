//! DD-66/67, SS-BUZ-ENGRAM: Core owns only the Installation binding and
//! observed native head references. Relay retains every encrypted memory body.

use collab_bridge::{
    bridge::{Custody, IdentityClient},
    limits::fetch_nip11,
    memory::{CoreMemory, MemoryError, ReadLimits, Reader, Snapshot},
};
use contracts::ReasonCode;
use secret_store::{PlatformKey, SecretRef};
use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

use crate::{governance::Refusal, service_api::ServiceState};

pub(crate) struct Config {
    limits: ReadLimits,
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
        if event_bound.checked_add(1).is_none()
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
        })
    }
}

#[derive(FromRow)]
struct Binding {
    tenant_id: Uuid,
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
    let observed = observe(state, &binding, config, false).await;
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
        Ok(Observed::Core(_)) => Err(unavailable("Agent memory 对账结果类型不符")),
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
    match observe(state, &binding, config, true).await {
        Ok(Observed::Core(core)) => Ok(Some(core)),
        Ok(Observed::Snapshot(_)) => Err(unavailable("Agent memory Session 结果类型不符")),
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
        "select r.tenant_id,i.resource_id as installation_resource_id,i.state as installation_state,
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
}
enum ObserveError {
    Binding,
    Native(MemoryError),
}

async fn observe(
    state: &ServiceState,
    binding: &Binding,
    config: &Config,
    core_only: bool,
) -> Result<Observed, ObserveError> {
    crate::service_api::audit_gate(state)
        .await
        .map_err(|_| ObserveError::Binding)?;
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
    let client = IdentityClient::new(
        Custody::Server,
        &counterparty.secret_key().to_secret_hex(),
        &state.relay_transport,
        &binding.normalized_host,
    )
    .map_err(|_| ObserveError::Binding)?;
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
    if core_only {
        return reader
            .read_core(&state.http, now)
            .await
            .map(Observed::Core)
            .map_err(ObserveError::Native);
    }
    reader
        .inspect(&state.http, now)
        .await
        .map(Observed::Snapshot)
        .map_err(ObserveError::Native)
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
