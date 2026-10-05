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
    holder: &contracts::AgentTaskAdvanceRequest,
) -> Result<Birth, RuntimeError> {
    let runtime = state
        .agent_runtime
        .as_ref()
        .ok_or(RuntimeError::Unavailable)?;
    let tool_config = crate::agent_tool_runtime::configuration(state, invocation_id, projection)
        .await
        .map_err(|_| RuntimeError::AdmissionRequired)?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| RuntimeError::Unknown)?;
    if holder.invocation_id != invocation_id.to_string() {
        return Err(RuntimeError::Unavailable);
    }
    state
        .capacity
        .lock_birth_holder(&mut tx, holder)
        .await
        .map_err(|_| RuntimeError::Unavailable)?;
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
    let observed = runtime.start_thread(projection, &tool_config).await;
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
// Frozen POST_MESSAGE rows did not enter Codex. Exclude them only with exact
// Automation/AE scope and no model evidence; unknown/missing kinds still block.
const MEMORY_PHASE_FACTS: &str =
    "select coalesce(bool_or(prior.runtime_turn_id is not null),false),
            coalesce(bool_or(prior.id is not null and prior.runtime_turn_id is null
              and prior.status not in ('CREATED','CANCELED')
              and not (prior.native_status is null
                and not exists(select 1 from projection.agent_model_trace mt
                  where mt.invocation_id=prior.id)
                and exists(select 1 from catalog.automation_version av
                  join admission.action_execution ae on ae.id=prior.action_execution_id
                  where av.asset_id=prior.automation_version_asset_id
                    and av.automation_resource_id=prior.automation_resource_id
                    and av.action->>'kind'='POST_MESSAGE'
                    and ae.action_key='automation.run' and ae.tenant_id=prior.tenant_id
                    and ae.workspace_id=prior.workspace_id
                    and ae.target_id=prior.automation_resource_id))
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

/// The caller holds this exact Session row lock until its dispatch CAS commits.
/// A sibling may have started after an earlier resume/idle check. Leave this
/// Invocation CREATED until that original turn and its uncertain result close;
/// never persist a new dispatch intent merely to have native idle reject it.
pub(crate) async fn require_dispatch_idle(
    tx: &mut Transaction<'_, Postgres>,
    invocation: Uuid,
) -> Result<(), RuntimeError> {
    let certain: bool = sqlx::query_scalar(
        "select not exists(select 1 from projection.agent_model_trace t where t.invocation_id=i.id)
          and not exists(select 1 from catalog.agent_invocation prior
            where prior.id<>i.id and prior.tenant_id=i.tenant_id
              and prior.workspace_id=i.workspace_id and prior.root_event_id=i.root_event_id
              and prior.installation_resource_id=i.installation_resource_id
              and prior.agent_version_asset_id=i.agent_version_asset_id
              and prior.projection_generation=i.projection_generation
              and (prior.status in ('DISPATCHING','RUNNING','UNKNOWN')
                or ((prior.runtime_turn_id is not null or exists(select 1
                    from projection.agent_model_trace t where t.invocation_id=prior.id))
                  and coalesce(prior.native_status,'') not in ('completed','failed','interrupted'))))
         from catalog.agent_invocation i where i.id=$1 and i.native_status is null",
    )
    .bind(invocation)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| RuntimeError::Unknown)?
    .ok_or(RuntimeError::Unknown)?;
    if !certain {
        return Err(RuntimeError::Unknown);
    }
    Ok(())
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

/// Only an unstarted invocation may replace its native MCP Session configuration.
/// Hold the original admission/Session fence, and reject any uncertain prior
/// dispatch in this exact Session. Waiting for native idle unload does not
/// rewrite Session status or turn an unsubscribe ACK into completion.
async fn resume_for_dispatch(
    state: &ServiceState,
    invocation: Uuid,
    projection: &RuntimeRef,
) -> Result<(), RuntimeError> {
    let config = crate::agent_tool_runtime::configuration(state, invocation, projection)
        .await
        .map_err(|_| RuntimeError::AdmissionRequired)?;
    let runtime = state
        .agent_runtime
        .as_ref()
        .ok_or(RuntimeError::Unavailable)?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| RuntimeError::Unknown)?;
    let session = lock_birth(&mut tx, invocation, projection).await?;
    let thread = session
        .runtime_thread_id
        .as_deref()
        .ok_or(RuntimeError::Unknown)?;
    require_dispatch_idle(&mut tx, invocation).await?;
    crate::agent_invocation::fresh_invocation(state, &mut tx, invocation)
        .await
        .map_err(|_| RuntimeError::AdmissionRequired)?;
    // All-absent Tool deployment cannot have installed a ticket in this process;
    // keep the original zero-Tool recovery. With the signer enabled, even an
    // empty map must cold-resume so a formerly granted directory cannot linger.
    if state.agent_tool_sessions.is_none() {
        runtime.resume_thread(projection, thread).await?;
    } else {
        runtime.refresh_thread(projection, thread, &config).await?;
    }
    sqlx::query(
        "update catalog.agent_session set status='ACTIVE'
        where workspace_id=$1 and root_event_id=$2 and installation_resource_id=$3
          and projection_generation=$4 and runtime_thread_id=$5",
    )
    .bind(session.workspace_id)
    .bind(&session.root_event_id)
    .bind(session.installation_resource_id)
    .bind(session.projection_generation)
    .bind(thread)
    .execute(&mut *tx)
    .await
    .map_err(|_| RuntimeError::Unknown)?;
    tx.commit().await.map_err(|_| RuntimeError::Unknown)
}

/// 只由 AgentTask 的已知 thread 观察/取消分支调用。恢复同一 durable ID
/// 不发新 turn；事务锁串行化同一 root Session 的并发恢复和关闭。
pub(crate) async fn resume_existing(
    state: &ServiceState,
    invocation_id: Uuid,
    projection: &RuntimeRef,
) -> Result<(), RuntimeError> {
    let undispatched: Option<bool> = sqlx::query_scalar(
        "select status='CREATED' and runtime_turn_id is null and not cancel_pending
         from catalog.agent_invocation where id=$1",
    )
    .bind(invocation_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| RuntimeError::Unknown)?;
    if undispatched == Some(true) {
        return resume_for_dispatch(state, invocation_id, projection).await;
    }
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

#[cfg(test)]
mod dispatch_idle_tests {
    use super::require_dispatch_idle;
    use crate::agent_runtime::RuntimeError;
    use uuid::Uuid;

    #[tokio::test]
    #[ignore = "requires AGENT_INVOKE_TEST_DATABASE_URL pointing at a disposable migrated database"]
    async fn sibling_turn_arriving_after_idle_keeps_original_invocation_created() {
        let pool = sqlx::PgPool::connect(&std::env::var("AGENT_INVOKE_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        let tenant = Uuid::new_v4();
        // Real migrated constraints remain enabled. Fixtures are private and
        // rolled back; no runtime, Relay, authorization or model is fabricated.
        sqlx::raw_sql(&format!(
            r#"DO $$
            DECLARE
              tenant uuid:='{tenant}'; workspace uuid:=gen_random_uuid();
              human uuid:=gen_random_uuid(); human_identity uuid:=gen_random_uuid();
              agent_a uuid:=gen_random_uuid(); agent_b uuid:=gen_random_uuid();
              definition uuid:=gen_random_uuid(); version_asset uuid:=gen_random_uuid();
              installation_a uuid:=gen_random_uuid(); installation_b uuid:=gen_random_uuid();
              route uuid:=gen_random_uuid(); installation uuid; invocation uuid; action uuid;
              n integer;
            BEGIN
              INSERT INTO identity.tenant(id,slug,name,state)
                VALUES(tenant,'session-dispatch-'||tenant,'Session dispatch fixture','ACTIVE');
              INSERT INTO identity.workspace(id,tenant_id,slug,name,state)
                VALUES(workspace,tenant,'session-dispatch','Session dispatch fixture','ACTIVE');
              INSERT INTO identity.human_identity(id,display_name,status)
                VALUES(human_identity,'Session dispatch fixture','ACTIVE');
              INSERT INTO identity.principal(id,tenant_id,kind,status) VALUES
                (human,tenant,'HUMAN','ACTIVE'),(agent_a,tenant,'AGENT','ACTIVE'),(agent_b,tenant,'AGENT','ACTIVE');
              INSERT INTO identity.tenant_membership(id,tenant_id,human_identity_id,tenant_principal_id,state)
                VALUES(gen_random_uuid(),tenant,human_identity,human,'ACTIVE');
              INSERT INTO catalog.resource(id,tenant_id,type_key,home_workspace_id,owner_principal_id,
                component_type_key,native_id,state,version) VALUES
                (definition,tenant,'agent.definition',NULL,human,'core',definition::text,'PROVISIONING',1),
                (route,tenant,'llm_route',workspace,human,'core',route::text,'PROVISIONING',1),
                (installation_a,tenant,'agent.installation',workspace,human,'core',installation_a::text,'PROVISIONING',1),
                (installation_b,tenant,'agent.installation',workspace,human,'core',installation_b::text,'PROVISIONING',1);
              INSERT INTO catalog.agent_definition(resource_id,stable_slug,display_name,status)
                VALUES(definition,'session-dispatch','Session dispatch fixture','PROVISIONING');
              INSERT INTO catalog.asset(id,tenant_id,resource_id,type_key,owner_principal_id,native_ref,state,version)
                VALUES(version_asset,tenant,definition,'agent.version',human,version_asset::text,'DRAFT',1);
              INSERT INTO catalog.agent_version(asset_id,agent_resource_id,ordinal,content,config_hash,state)
                VALUES(version_asset,definition,1,
                  jsonb_build_object('runtimeProfileKey','session-dispatch-fixture','modelRouteResourceId',route),
                  repeat('a',64),'DRAFT');
              INSERT INTO catalog.agent_installation(resource_id,workspace_id,agent_resource_id,pinned_version_asset_id,
                agent_principal_id,runtime_isolation_ref,state) VALUES
                (installation_a,workspace,definition,version_asset,agent_a,'fixture:'||installation_a,'PROVISIONING'),
                (installation_b,workspace,definition,version_asset,agent_b,'fixture:'||installation_b,'PROVISIONING');
              INSERT INTO catalog.agent_runtime_projection(installation_resource_id,generation,agent_version_asset_id,
                runtime_profile_key,model_route_resource_id,gateway_resource_ids,effective_fields,config_hash,state) VALUES
                (installation_a,1,version_asset,'session-dispatch-fixture',route,'{{}}','[]',repeat('a',64),'PENDING'),
                (installation_b,1,version_asset,'session-dispatch-fixture',route,'{{}}','[]',repeat('a',64),'PENDING');
              INSERT INTO catalog.agent_session(tenant_id,workspace_id,root_event_id,installation_resource_id,
                agent_version_asset_id,projection_generation,runtime_thread_id,core_memory_state,status) VALUES
                (tenant,workspace,repeat('a',64),installation_a,version_asset,1,gen_random_uuid()::text,'ABSENT','ACTIVE'),
                (tenant,workspace,repeat('a',64),installation_b,version_asset,1,gen_random_uuid()::text,'ABSENT','ACTIVE'),
                (tenant,workspace,repeat('b',64),installation_a,version_asset,1,gen_random_uuid()::text,'ABSENT','ACTIVE');
              FOR n IN 1..4 LOOP
                installation:=CASE WHEN n=3 THEN installation_b ELSE installation_a END;
                invocation:=gen_random_uuid(); action:=gen_random_uuid();
                INSERT INTO admission.action_execution(id,operation_id,tenant_id,workspace_id,action_key,action_version,
                  initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id)
                  VALUES(action,gen_random_uuid(),tenant,workspace,'agent.installation.create',1,
                    human,human,installation,repeat('a',64),'ALLOWED','DISPATCHED',gen_random_uuid());
                INSERT INTO catalog.agent_invocation(id,tenant_id,workspace_id,root_event_id,source_event_id,
                  installation_resource_id,agent_version_asset_id,projection_generation,action_execution_id,workflow_id,status)
                  VALUES(invocation,tenant,workspace,CASE WHEN n=4 THEN repeat('b',64) ELSE repeat('a',64) END,
                    repeat(n::text,64),installation,version_asset,1,action,'session-dispatch:'||invocation,'CREATED');
              END LOOP;
            END $$;"#
        ))
        .execute(&mut *tx)
        .await
        .unwrap();
        let rows: Vec<(Uuid, String)> = sqlx::query_as(
            "select id,source_event_id from catalog.agent_invocation where tenant_id=$1 order by source_event_id",
        )
        .bind(tenant)
        .fetch_all(&mut *tx)
        .await
        .unwrap();
        assert_eq!(rows.len(), 4);
        let first = rows[0].0;
        let queued = rows[1].0;
        sqlx::query("select installation_resource_id from catalog.agent_session where tenant_id=$1 for update")
            .bind(tenant).fetch_all(&mut *tx).await.unwrap();
        require_dispatch_idle(&mut tx, queued).await.unwrap();
        // Both callers previously observed idle. The first now binds a turn
        // before the second reaches its lock-held dispatch CAS.
        sqlx::query("update catalog.agent_invocation set status='RUNNING',runtime_turn_id='original-turn',native_status='inProgress' where id=$1")
            .bind(first).execute(&mut *tx).await.unwrap();
        assert!(matches!(
            require_dispatch_idle(&mut tx, queued).await,
            Err(RuntimeError::Unknown)
        ));
        let unchanged: (String, Option<String>, bool) = sqlx::query_as(
            "select status,runtime_turn_id,exists(select 1 from projection.agent_model_trace t where t.invocation_id=i.id)
             from catalog.agent_invocation i where id=$1",
        ).bind(queued).fetch_one(&mut *tx).await.unwrap();
        assert_eq!(unchanged, ("CREATED".into(), None, false));
        // The same channel can independently reach another
        // Installation, and a separate root has its own durable Session.
        require_dispatch_idle(&mut tx, rows[2].0).await.unwrap();
        require_dispatch_idle(&mut tx, rows[3].0).await.unwrap();
        sqlx::query("update catalog.agent_invocation set status='UNKNOWN',native_status='completed' where id=$1")
            .bind(first).execute(&mut *tx).await.unwrap();
        assert!(matches!(
            require_dispatch_idle(&mut tx, queued).await,
            Err(RuntimeError::Unknown)
        ));
        sqlx::query("update catalog.agent_invocation set status='FAILED',native_status='failed' where id=$1")
            .bind(first).execute(&mut *tx).await.unwrap();
        require_dispatch_idle(&mut tx, queued).await.unwrap();
        // Missing/uncertain native completion cannot be treated as idle.
        sqlx::query("update catalog.agent_invocation set native_status=null where id=$1")
            .bind(first)
            .execute(&mut *tx)
            .await
            .unwrap();
        assert!(matches!(
            require_dispatch_idle(&mut tx, queued).await,
            Err(RuntimeError::Unknown)
        ));
        tx.rollback().await.unwrap();
    }
}
