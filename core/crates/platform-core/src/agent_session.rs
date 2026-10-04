//! DD-47/65/67、17 §5、19 §4：Session birth 与已持久 Codex thread 恢复。
//! Memory 正文只跨本次调用临时传给首 turn，不从 Relay 重建 rollout。

use collab_bridge::memory::CoreMemory;
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    agent_runtime::{RuntimeError, RuntimeRef},
    service_api::ServiceState,
};

#[derive(FromRow)]
struct Session {
    workspace_id: Uuid,
    root_event_id: String,
    installation_resource_id: Uuid,
    projection_generation: i64,
    runtime_thread_id: String,
    status: String,
}

/// 不实现 Debug/Serialize：首 turn context 不能意外进入日志/history。
pub(crate) struct Birth {
    pub runtime_thread_id: String,
    /// None 是 UNREADABLE，不是 ABSENT；只能由本次首 turn 消费。
    pub core_memory: Option<CoreMemory>,
}

/// Only the first Session turn may carry plaintext core context. A continued
/// turn carries the pinned metadata solely for the dispatch-time recheck.
pub(crate) enum TurnMemory {
    Initial(Option<CoreMemory>),
    Continued {
        state: String,
        event: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MemoryPhase {
    Initial,
    Continued,
}

impl TurnMemory {
    pub(crate) fn phase(&self) -> MemoryPhase {
        match self {
            Self::Initial(_) => MemoryPhase::Initial,
            Self::Continued { .. } => MemoryPhase::Continued,
        }
    }
}

#[derive(FromRow)]
struct BirthSession {
    tenant_id: Uuid,
    workspace_id: Uuid,
    root_event_id: String,
    installation_resource_id: Uuid,
    projection_generation: i64,
    config_hash: String,
    memory_version: i32,
    agent_binding_version: i32,
    counterparty_binding_version: i32,
    agent_pubkey: String,
    counterparty_pubkey: String,
    runtime_thread_id: Option<String>,
    core_memory_state: String,
    core_memory_event_id: Option<String>,
    status: String,
}

/// AgentTask 已核证当前 Activity holder 与 runtime admission 后调用。
/// 只接受尚未启动的 PENDING Session；STARTING/UNKNOWN 不得第二次 start。
pub(crate) async fn birth(
    state: &ServiceState,
    invocation_id: Uuid,
    projection: &RuntimeRef,
) -> Result<Birth, RuntimeError> {
    let runtime = state
        .agent_runtime
        .as_ref()
        .ok_or(RuntimeError::Unavailable)?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| RuntimeError::Unknown)?;
    let session = lock_birth(&mut tx, invocation_id, projection).await?;
    if session.status != "PENDING" || session.runtime_thread_id.is_some() {
        return Err(RuntimeError::Unavailable);
    }
    crate::agent_invocation::fresh_invocation(state, &mut tx, invocation_id)
        .await
        .map_err(|_| RuntimeError::AdmissionRequired)?;
    // 同一事务的 Invocation/lifecycle fence；不另起 memory Action，且不读缓存 head。
    let core_memory =
        crate::agent_memory::read_core(state, &mut tx, invocation_id, &state.agent_memory, None)
            .await
            .map_err(|_| RuntimeError::Unavailable)?;
    let (memory_state, memory_event) = match &core_memory {
        Some(CoreMemory::Found { head, .. }) => ("FOUND", Some(head.event_id.as_str())),
        Some(CoreMemory::Absent) => ("ABSENT", None),
        None => ("UNREADABLE", None),
    };
    let changed = sqlx::query(
        "update catalog.agent_session set status='STARTING',
        core_memory_state=$1,core_memory_event_id=$2
        where workspace_id=$3 and root_event_id=$4 and installation_resource_id=$5
          and projection_generation=$6 and status='PENDING' and runtime_thread_id is null",
    )
    .bind(memory_state)
    .bind(memory_event)
    .bind(session.workspace_id)
    .bind(&session.root_event_id)
    .bind(session.installation_resource_id)
    .bind(session.projection_generation)
    .execute(&mut *tx)
    .await
    .map_err(|_| RuntimeError::Unknown)?;
    if changed.rows_affected() != 1 {
        return Err(RuntimeError::Unknown);
    }
    // 先提交意图：从此任何重入只有观察/恢复权利，不能再创建另一个 thread。
    tx.commit().await.map_err(|_| RuntimeError::Unknown)?;
    opentelemetry::global::meter("platform-core.agent-memory")
        .u64_counter("platform.agent_memory.session_read_count")
        .build()
        .add(1, &[opentelemetry::KeyValue::new("state", memory_state)]);

    // 提交不是授权：重新取得同 scope 锁并验证 frozen generation，跨 native call
    // 保持 lifecycle fence，防止意图提交后与 Tenant/Workspace 撤权交错。
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| RuntimeError::Unknown)?;
    let intent = lock_birth(&mut tx, invocation_id, projection).await?;
    if intent.status != "STARTING"
        || intent.runtime_thread_id.is_some()
        || intent.core_memory_state != memory_state
        || intent.core_memory_event_id.as_deref() != memory_event
        || intent.memory_version != session.memory_version
        || intent.agent_binding_version != session.agent_binding_version
        || intent.counterparty_binding_version != session.counterparty_binding_version
        || intent.agent_pubkey != session.agent_pubkey
        || intent.counterparty_pubkey != session.counterparty_pubkey
    {
        return Err(RuntimeError::Unknown);
    }
    crate::agent_invocation::fresh_invocation(state, &mut tx, invocation_id)
        .await
        .map_err(|_| RuntimeError::AdmissionRequired)?;
    let observed = runtime.start_thread(projection).await;
    let thread = observed.as_ref().ok().map(String::as_str);
    let changed = sqlx::query(
        "update catalog.agent_session set runtime_thread_id=$1,status=$2
        where workspace_id=$3 and root_event_id=$4 and installation_resource_id=$5
          and projection_generation=$6 and status='STARTING' and runtime_thread_id is null
          and core_memory_state=$7 and core_memory_event_id is not distinct from $8",
    )
    .bind(thread)
    .bind(if observed.is_ok() {
        "ACTIVE"
    } else {
        "UNKNOWN"
    })
    .bind(intent.workspace_id)
    .bind(&intent.root_event_id)
    .bind(intent.installation_resource_id)
    .bind(intent.projection_generation)
    .bind(memory_state)
    .bind(memory_event)
    .execute(&mut *tx)
    .await
    .map_err(|_| RuntimeError::Unknown)?;
    if changed.rows_affected() != 1 {
        return Err(RuntimeError::Unknown);
    }
    tx.commit().await.map_err(|_| RuntimeError::Unknown)?;
    Ok(Birth {
        runtime_thread_id: observed?,
        core_memory,
    })
}

/// A thread ID alone does not prove a first turn: a crash after birth must
/// still consume the frozen core. Once an exact scoped Invocation has a native
/// turn reference, later turns resume history without reading/injecting core.
pub(crate) async fn fixed_core(
    state: &ServiceState,
    invocation_id: Uuid,
    projection: &RuntimeRef,
) -> Result<TurnMemory, RuntimeError> {
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| RuntimeError::Unknown)?;
    let session = lock_birth(&mut tx, invocation_id, projection).await?;
    if session.status != "ACTIVE" || session.runtime_thread_id.is_none() {
        return Err(RuntimeError::Unavailable);
    }
    crate::agent_invocation::fresh_invocation(state, &mut tx, invocation_id)
        .await
        .map_err(|_| RuntimeError::AdmissionRequired)?;
    if !matches!(
        (
            session.core_memory_state.as_str(),
            session.core_memory_event_id.as_deref()
        ),
        ("FOUND", Some(_)) | ("ABSENT" | "UNREADABLE", None)
    ) {
        return Err(RuntimeError::Unavailable);
    }
    // lock_birth holds the exact Session lock. A previous unbound dispatch
    // cannot be guessed consumed, nor authorize another first turn.
    if memory_phase(&mut tx, invocation_id).await? == MemoryPhase::Continued {
        tx.commit().await.map_err(|_| RuntimeError::Unknown)?;
        return Ok(TurnMemory::Continued {
            state: session.core_memory_state,
            event: session.core_memory_event_id,
        });
    }
    let memory = match (
        session.core_memory_state.as_str(),
        session.core_memory_event_id.as_deref(),
    ) {
        ("ABSENT", None) => Some(CoreMemory::Absent),
        ("UNREADABLE", None) => None,
        ("FOUND", Some(event)) => {
            let memory = crate::agent_memory::read_core(
                state,
                &mut tx,
                invocation_id,
                &state.agent_memory,
                Some(event),
            )
            .await
            .map_err(|_| RuntimeError::Unavailable)?;
            match &memory {
                Some(CoreMemory::Found { head, .. }) if head.event_id == event => memory,
                _ => None,
            }
        }
        _ => return Err(RuntimeError::Unavailable),
    };
    tx.commit().await.map_err(|_| RuntimeError::Unknown)?;
    Ok(TurnMemory::Initial(memory))
}

/// Caller holds the Session row lock through its decision/CAS. Reuse only
/// immutable native turn references within this exact Session version/scope;
/// CREATED or canceled-before-dispatch siblings did not consume core.
// agent_invocation::dispatch can also finalize a never-started CREATED row as
// FAILED. record_dispatch persists its certain refusal as ABORTED, not
// NOT_DISPATCHED. Other failed/unknown rows remain unresolved without a turn.
const MEMORY_PHASE_FACTS: &str =
    "select coalesce(bool_or(prior.runtime_turn_id is not null),false),
            coalesce(bool_or(prior.id is not null and prior.runtime_turn_id is null
              and prior.status not in ('CREATED','CANCELED')
              and not (prior.status='FAILED' and prior.native_status is null
                and prior.reply_event_id is null
                and not exists(select 1 from projection.agent_model_trace mt
                  where mt.invocation_id=prior.id)
                and exists(select 1 from admission.action_execution ae
                  where ae.id=prior.action_execution_id and ae.tenant_id=prior.tenant_id
                    and ae.workspace_id=prior.workspace_id and ae.action_key='agent.invoke'
                    and ae.gate_state='ALLOWED' and ae.dispatch_state='ABORTED'))),false)
     from catalog.agent_invocation i
     left join catalog.agent_invocation prior on prior.id<>i.id
       and prior.tenant_id=i.tenant_id and prior.workspace_id=i.workspace_id
       and prior.root_event_id=i.root_event_id
       and prior.installation_resource_id=i.installation_resource_id
       and prior.agent_version_asset_id=i.agent_version_asset_id
       and prior.projection_generation=i.projection_generation
     where i.id=$1 group by i.id";

pub(crate) async fn memory_phase(
    tx: &mut Transaction<'_, Postgres>,
    invocation: Uuid,
) -> Result<MemoryPhase, RuntimeError> {
    let facts: Option<(bool, bool)> = sqlx::query_as(MEMORY_PHASE_FACTS)
        .bind(invocation)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| RuntimeError::Unknown)?;
    let (has_turn, unbound_dispatch) = facts.ok_or(RuntimeError::Unavailable)?;
    phase_from_invocations(has_turn, unbound_dispatch)
}

fn phase_from_invocations(
    has_turn: bool,
    unbound_dispatch: bool,
) -> Result<MemoryPhase, RuntimeError> {
    if unbound_dispatch {
        Err(RuntimeError::Unknown)
    } else if has_turn {
        Ok(MemoryPhase::Continued)
    } else {
        Ok(MemoryPhase::Initial)
    }
}

async fn lock_birth(
    tx: &mut Transaction<'_, Postgres>,
    invocation: Uuid,
    projection: &RuntimeRef,
) -> Result<BirthSession, RuntimeError> {
    let scope: (Uuid, Uuid, Uuid) = sqlx::query_as(
        "select tenant_id,workspace_id,action_execution_id
        from catalog.agent_invocation where id=$1",
    )
    .bind(invocation)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| RuntimeError::Unknown)?
    .ok_or(RuntimeError::Unavailable)?;
    // The same AE→Tenant lock order is used by governance/Delegation. The
    // native lifecycle fence must not introduce Tenant→AE inversion.
    crate::governance::lock_execution(tx, scope.2)
        .await
        .map_err(|_| RuntimeError::Unknown)?;
    let active: Option<bool> = sqlx::query_scalar(
        "select t.state='ACTIVE' and w.state='ACTIVE'
        from identity.tenant t join identity.workspace w on w.tenant_id=t.id
        where t.id=$1 and w.id=$2 for no key update of t,w",
    )
    .bind(scope.0)
    .bind(scope.1)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| RuntimeError::Unknown)?;
    if active != Some(true) {
        return Err(RuntimeError::Unavailable);
    }
    let session: BirthSession = sqlx::query_as("select s.tenant_id,s.workspace_id,s.root_event_id,
        s.installation_resource_id,s.projection_generation,p.config_hash,s.runtime_thread_id,
        s.core_memory_state,s.core_memory_event_id,s.status,m.version as memory_version,
        a.version as agent_binding_version,c.version as counterparty_binding_version,
        a.pubkey as agent_pubkey,c.pubkey as counterparty_pubkey
        from catalog.agent_session s join catalog.agent_invocation v
          on v.workspace_id=s.workspace_id and v.root_event_id=s.root_event_id
          and v.installation_resource_id=s.installation_resource_id and v.tenant_id=s.tenant_id
          and v.agent_version_asset_id=s.agent_version_asset_id and v.projection_generation=s.projection_generation
        join catalog.agent_installation i on i.resource_id=v.installation_resource_id
          and i.workspace_id=v.workspace_id and i.pinned_version_asset_id=v.agent_version_asset_id
          and i.active_projection_generation=v.projection_generation and i.state='ACTIVE'
        join catalog.resource r on r.id=i.resource_id and r.tenant_id=v.tenant_id
          and r.home_workspace_id=v.workspace_id and r.state='ACTIVE' and r.projection_action_execution_id is null
        join identity.principal owner on owner.id=r.owner_principal_id and owner.tenant_id=v.tenant_id
          and owner.kind='HUMAN' and owner.status='ACTIVE'
        join identity.tenant_membership om on om.tenant_principal_id=owner.id
          and om.tenant_id=v.tenant_id and om.state='ACTIVE'
        join identity.principal agent on agent.id=i.agent_principal_id and agent.tenant_id=v.tenant_id
          and agent.kind='AGENT' and agent.status='ACTIVE'
        join catalog.agent_memory_binding m on m.installation_resource_id=i.resource_id and m.state='ACTIVE'
        join identity.buzz_identity_binding a on a.pubkey=m.agent_buzz_identity_binding_id
          and a.tenant_id=v.tenant_id and a.principal_id=agent.id and a.kind='AGENT'
          and a.custody='SERVER' and a.state='ACTIVE' and a.private_key_secret_status='ACTIVE'
        join projection.tenant_buzz_binding tb on tb.tenant_id=v.tenant_id and tb.state='ACTIVE'
          and tb.require_relay_membership and not tb.allow_nip_oa_auth and not tb.pubkey_allowlist_enabled
        join identity.buzz_identity_binding c on c.pubkey=m.memory_counterparty_buzz_identity_binding_id
          and c.tenant_id=v.tenant_id and c.principal_id=tb.control_service_principal_id and c.kind='CONTROL'
          and c.custody='SERVER' and c.state='ACTIVE' and c.private_key_secret_status='ACTIVE'
        join identity.principal cp on cp.id=c.principal_id and cp.tenant_id=v.tenant_id
          and cp.kind='SERVICE' and cp.status='ACTIVE'
        join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
          and p.generation=v.projection_generation and p.agent_version_asset_id=v.agent_version_asset_id
          and p.state='ACTIVE'
        join admission.action_execution ae on ae.id=v.action_execution_id and ae.tenant_id=v.tenant_id
          and ae.workspace_id=v.workspace_id and ae.gate_state='ALLOWED'
          and ae.temporal_workflow_id=v.workflow_id
        where v.id=$1 and v.status='CREATED' and not v.cancel_pending and v.runtime_turn_id is null
          and exists(select 1 from admission.capacity_lease l where l.invocation_id=v.id
            and l.operation_id=ae.operation_id and l.tenant_id=v.tenant_id and l.workspace_id=v.workspace_id
            and l.workflow_id=v.workflow_id and l.state='HELD' and l.expires_at>clock_timestamp())
        for update of s,v,i,r,p,owner,om,agent,m,a,c,tb,cp")
        .bind(invocation).fetch_optional(&mut **tx).await
        .map_err(|_| RuntimeError::Unknown)?.ok_or(RuntimeError::Unavailable)?;
    if session.tenant_id != scope.0
        || session.workspace_id != scope.1
        || session.installation_resource_id != projection.installation_id
        || session.projection_generation != projection.generation
        || session.config_hash != projection.config_hash
    {
        return Err(RuntimeError::Unavailable);
    }
    Ok(session)
}

/// 只由 AgentTask 的已知 thread 观察/取消分支调用。恢复同一 durable ID
/// 不发新 turn；事务锁串行化同一 root Session 的并发恢复和关闭。
pub(crate) async fn resume_existing(
    state: &ServiceState,
    invocation_id: Uuid,
    projection: &RuntimeRef,
) -> Result<(), RuntimeError> {
    let runtime = state
        .agent_runtime
        .as_ref()
        .ok_or(RuntimeError::Unavailable)?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| RuntimeError::Unknown)?;
    let session: Session = sqlx::query_as(
        "select s.workspace_id,s.root_event_id,s.installation_resource_id,
                s.projection_generation,s.runtime_thread_id,s.status
         from catalog.agent_session s join catalog.agent_invocation i
           on i.workspace_id=s.workspace_id and i.root_event_id=s.root_event_id
           and i.installation_resource_id=s.installation_resource_id
           and i.tenant_id=s.tenant_id and i.agent_version_asset_id=s.agent_version_asset_id
           and i.projection_generation=s.projection_generation
         where i.id=$1 and i.status in ('CREATED','DISPATCHING','RUNNING','UNKNOWN')
           and s.runtime_thread_id is not null for update of s",
    )
    .bind(invocation_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| RuntimeError::Unknown)?
    .ok_or(RuntimeError::Unavailable)?;
    if session.installation_resource_id != projection.installation_id
        || session.projection_generation != projection.generation
        || !matches!(session.status.as_str(), "STARTING" | "ACTIVE" | "UNKNOWN")
    {
        return Err(RuntimeError::Unavailable);
    }
    // STARTING/UNKNOWN 只有已有 native ID 才可恢复，绝不回退到 thread/start。
    let observed = runtime
        .resume_thread(projection, &session.runtime_thread_id)
        .await;
    let next = if observed.is_ok() {
        "ACTIVE"
    } else {
        "UNKNOWN"
    };
    let changed = sqlx::query(
        "update catalog.agent_session set status=$1
         where workspace_id=$2 and root_event_id=$3 and installation_resource_id=$4
           and projection_generation=$5 and runtime_thread_id=$6 and status=$7",
    )
    .bind(next)
    .bind(session.workspace_id)
    .bind(&session.root_event_id)
    .bind(session.installation_resource_id)
    .bind(session.projection_generation)
    .bind(&session.runtime_thread_id)
    .bind(&session.status)
    .execute(&mut *tx)
    .await
    .map_err(|_| RuntimeError::Unknown)?;
    if changed.rows_affected() != 1 {
        return Err(RuntimeError::Unknown);
    }
    tx.commit().await.map_err(|_| RuntimeError::Unknown)?;
    observed
}

#[cfg(test)]
mod memory_phase_tests {
    use super::{phase_from_invocations, MemoryPhase};
    use crate::agent_runtime::RuntimeError;

    #[test]
    fn thread_birth_without_a_native_turn_still_requires_initial_core() {
        // The durable thread may already exist, but no scoped Invocation has
        // consumed a turn. CREATED/canceled-before-dispatch is not consumption.
        assert_eq!(
            phase_from_invocations(false, false).unwrap(),
            MemoryPhase::Initial
        );
    }

    #[test]
    fn bound_native_turn_uses_history_instead_of_another_core_context() {
        assert_eq!(
            phase_from_invocations(true, false).unwrap(),
            MemoryPhase::Continued
        );
    }

    #[test]
    fn unbound_dispatch_remains_unknown_even_with_another_known_turn() {
        for has_turn in [false, true] {
            assert!(matches!(
                phase_from_invocations(has_turn, true),
                Err(RuntimeError::Unknown)
            ));
        }
    }
}
