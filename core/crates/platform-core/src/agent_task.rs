//! DD-47/48/65、06 §6：AgentInvocation 持久意图与 Temporal 的实际消费端。
//! 不创建第二 Workflow 权威，不从未查证的 runtime/tool/usage 事实推断成功。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use collab_bridge::memory::CoreMemory;
use contracts::{AgentTaskAdvanceRequest, AgentTaskAdvanceResult, EvidenceKind, TaskStatus};
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    agent_runtime::RuntimeRef,
    service_api::{authorize, unavailable, ServiceState},
};

pub(crate) const WORKFLOW_TYPE: &str = "AgentTaskWorkflow";

#[derive(FromRow)]
struct Invocation {
    id: Uuid,
    tenant_id: Uuid,
    workspace_id: Uuid,
    root_event_id: String,
    source_event_id: String,
    installation_resource_id: Uuid,
    agent_version_asset_id: Uuid,
    projection_generation: i64,
    action_execution_id: Uuid,
    workflow_id: String,
    runtime_thread_id: Option<String>,
    runtime_turn_id: Option<String>,
    native_status: Option<String>,
    reply_event_id: Option<String>,
    status: String,
    cancel_pending: bool,
    observation_cursor: Option<String>,
}

const LOAD: &str = "select i.id,i.tenant_id,i.workspace_id,i.root_event_id,i.source_event_id,
    i.installation_resource_id,i.agent_version_asset_id,i.projection_generation,
    i.action_execution_id,i.workflow_id,s.runtime_thread_id,i.runtime_turn_id,
    i.native_status,i.reply_event_id,i.status,i.cancel_pending,i.observation_cursor
    from catalog.agent_invocation i join catalog.agent_session s
      on s.workspace_id=i.workspace_id and s.root_event_id=i.root_event_id
      and s.installation_resource_id=i.installation_resource_id where i.id=$1";

pub(crate) async fn advance(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<AgentTaskAdvanceRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(response) = authorize(&state, &headers).await {
        return response;
    }
    let Ok(Json(input)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Ok(id) = Uuid::parse_str(&input.invocation_id) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if Uuid::parse_str(&input.run_id).is_err() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let mut invocation: Invocation = match sqlx::query_as(LOAD)
        .bind(id)
        .fetch_optional(&state.pool)
        .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(error) => return unavailable(error),
    };
    if invocation.installation_resource_id.to_string() != input.installation_id
        || invocation.agent_version_asset_id.to_string() != input.agent_version_asset_id
        || invocation.projection_generation != input.projection_generation
        || invocation.workflow_id != input.workflow_id
    {
        return StatusCode::CONFLICT.into_response();
    }
    let reference: Option<Option<String>> = match sqlx::query_scalar("select run_id from projection.workflow_ref where workflow_id=$1 and workflow_type=$2 and kind is null and tenant_id=$3 and action_execution_id=$4")
        .bind(&invocation.workflow_id).bind(WORKFLOW_TYPE).bind(invocation.tenant_id).bind(invocation.action_execution_id).fetch_optional(&state.pool).await {
        Ok(value) => value, Err(error) => return unavailable(error),
    };
    let Some(Some(reference_run)) = reference else {
        return result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT");
    };
    let observed = match state.temporal.describe(&invocation.workflow_id).await {
        Ok(Some(observed)) => observed,
        _ => return result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT"),
    };
    // Continue-as-new 可换当前 run，但不能让同 workflow ID 的另一执行链推进。
    if !matches!(observed.state, crate::temporal::ObservedState::Open)
        || observed.run_id != input.run_id
        || observed.first_run_id.is_empty()
        || (reference_run != observed.first_run_id && reference_run != observed.run_id)
    {
        return StatusCode::CONFLICT.into_response();
    }
    if matches!(
        invocation.status.as_str(),
        "CREATED" | "DISPATCHING" | "RUNNING" | "UNKNOWN"
    ) {
        invocation.cancel_pending = match refresh_delegation_cancel(&state, &invocation).await {
            Ok(pending) => pending,
            Err(_) => return result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT"),
        };
    }
    let Ok(attempt) = i32::try_from(input.attempt) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let holder = match state
        .capacity
        .acquire_or_renew(
            &state.pool,
            &state.temporal,
            id,
            &input.run_id,
            &input.activity_id,
            attempt,
        )
        .await
    {
        Ok(holder) => holder,
        Err(crate::capacity::CapacityError::Rejected) => {
            return StatusCode::CONFLICT.into_response()
        }
        Err(crate::capacity::CapacityError::Exhausted) => {
            return result(id, TaskStatus::Running, "CAPACITY_UNAVAILABLE")
        }
        Err(error) => {
            tracing::warn!(invocation_id=%id, error=%error, "Capacity holder 不可查证");
            return result(id, TaskStatus::Running, "CAPACITY_UNAVAILABLE");
        }
    };
    tracing::debug!(invocation_id=%id, lease_id=%holder.lease_id, "原生 Activity holder 已查证");
    match invocation.status.as_str() {
        "COMPLETED" | "FAILED" | "CANCELED" if !holder.released => {
            return release_holder(&state, id, false, "CAPACITY_UNAVAILABLE").await;
        }
        "COMPLETED" => return result(id, TaskStatus::Completed, "NONE"),
        "FAILED" => return result(id, TaskStatus::Failed, "NONE"),
        "CANCELED" => return result(id, TaskStatus::Canceled, "NONE"),
        "CREATED" | "DISPATCHING" | "RUNNING" | "UNKNOWN" => {}
        _ => return result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT"),
    }
    if (input.cancel_requested || holder.workflow_cancel_requested) && !invocation.cancel_pending {
        let changed = match sqlx::query("update catalog.agent_invocation set cancel_pending=true,updated_at=now() where id=$1 and status in ('CREATED','DISPATCHING','RUNNING','UNKNOWN')")
            .bind(id).execute(&state.pool).await {
            Ok(changed) => changed, Err(error) => return unavailable(error),
        };
        if changed.rows_affected() != 1 {
            return result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT");
        }
        invocation.cancel_pending = true;
    }
    // 已落 dispatch intent 而无 native ID 的情况必须保留 UNKNOWN；取消也不能
    // 将未知 dispatch 写成「确定未发生」。不调用第二次 turn/start。
    if invocation.runtime_thread_id.is_none()
        && matches!(invocation.status.as_str(), "DISPATCHING" | "UNKNOWN")
    {
        return result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT");
    }
    if invocation.cancel_pending && invocation.status == "CREATED" {
        // CREATED 的旧读不能证明未派发：与 first_turn 共用 AE→Tenant→Invocation
        // 锁序，重新查证无 turn/trace/usage 后才记取消，不伪造 native interrupted。
        return match cancel_before_dispatch(&state, &invocation).await {
            Ok(true) if holder.released => result(id, TaskStatus::Canceled, "NONE"),
            Ok(true) => release_holder(&state, id, false, "CAPACITY_UNAVAILABLE").await,
            Ok(false) => result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT"),
            Err(error) => unavailable(error),
        };
    }
    let Some(runtime) = state.agent_runtime.as_ref() else {
        return result(id, TaskStatus::Running, "RUNTIME_UNAVAILABLE");
    };
    if let Some(thread) = invocation.runtime_thread_id.as_deref() {
        // 观察/interrupt 只消费冻结 generation 的原生引用；ACTIVE admission 是
        // 新模型/工具副作用的前置，不阻断 DRAINING/已撤权安装的安全收尾。
        let hash: Option<String> = match sqlx::query_scalar("select config_hash from catalog.agent_runtime_projection where installation_resource_id=$1 and generation=$2 and agent_version_asset_id=$3")
            .bind(invocation.installation_resource_id).bind(invocation.projection_generation)
            .bind(invocation.agent_version_asset_id).fetch_optional(&state.pool).await {
            Ok(hash) => hash, Err(error) => return unavailable(error),
        };
        let Some(config_hash) = hash else {
            return result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT");
        };
        let projection = RuntimeRef {
            installation_id: invocation.installation_resource_id,
            generation: invocation.projection_generation,
            config_hash,
        };
        if crate::agent_session::resume_existing(&state, id, &projection)
            .await
            .is_err()
        {
            return result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT");
        }
        // thread/start is not model dispatch. Only a still-CREATED Invocation
        // can consume the original source and its Session's frozen core event.
        if invocation.status == "CREATED" && invocation.runtime_turn_id.is_none() {
            if !holder.held {
                return result(id, TaskStatus::Running, "CAPACITY_UNAVAILABLE");
            }
            let facts = match crate::agent_installation::admit_runtime(
                &state,
                invocation.installation_resource_id,
                invocation.agent_version_asset_id,
                invocation.projection_generation,
            )
            .await
            {
                Ok(facts)
                    if facts.tenant_id == invocation.tenant_id
                        && facts.workspace_id == invocation.workspace_id
                        && facts.projection_config_hash == projection.config_hash =>
                {
                    facts
                }
                _ => return result(id, TaskStatus::Running, "RUNTIME_ADMISSION_UNAVAILABLE"),
            };
            // The dynamic invocation authorization below is additional to this
            // installation check; the static projection cannot grant a run.
            drop(facts);
            let memory = match crate::agent_session::fixed_core(&state, id, &projection).await {
                Ok(memory) => memory,
                Err(_) => return result(id, TaskStatus::Running, "RUNTIME_ADMISSION_UNAVAILABLE"),
            };
            return first_turn(&state, &invocation, &projection, thread, memory, &input).await;
        }
        if invocation.cancel_pending {
            if let Some(turn) = invocation.runtime_turn_id.as_deref() {
                // interrupt 回应不明仍继续只读同一 turn；它可能已经终结，不能
                // 因 native「无 active turn」错误阻断 terminal observation。
                let _ = runtime.interrupt(&projection, thread, turn).await;
            }
        }
        // 未绑定 turn 时从头读取；只在完整单页证明唯一 clientId 时回填，
        // 不把分页某一段的命中冒充整个 thread 的唯一关联。
        let cursor = invocation
            .runtime_turn_id
            .as_ref()
            .and(invocation.observation_cursor.as_deref());
        let page = match runtime.turns(&projection, thread, cursor).await {
            Ok(page) => page,
            Err(_) => return result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT"),
        };
        return observe(
            &state,
            &invocation,
            &projection,
            page,
            &input,
            holder.released,
        )
        .await;
    }
    if !holder.held {
        return result(id, TaskStatus::Running, "CAPACITY_UNAVAILABLE");
    }
    let facts = match crate::agent_installation::admit_runtime(
        &state,
        invocation.installation_resource_id,
        invocation.agent_version_asset_id,
        invocation.projection_generation,
    )
    .await
    {
        Ok(facts) => facts,
        Err(_) => return result(id, TaskStatus::Running, "RUNTIME_ADMISSION_UNAVAILABLE"),
    };
    if facts.tenant_id != invocation.tenant_id || facts.workspace_id != invocation.workspace_id {
        return StatusCode::CONFLICT.into_response();
    }
    let session: (String, String) = match sqlx::query_as("select status,core_memory_state from catalog.agent_session where workspace_id=$1 and root_event_id=$2 and installation_resource_id=$3")
        .bind(invocation.workspace_id).bind(&invocation.root_event_id).bind(invocation.installation_resource_id).fetch_one(&state.pool).await {
        Ok(session) => session, Err(error) => return unavailable(error),
    };
    if session.0 != "PENDING" {
        return result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT");
    }
    let projection = RuntimeRef {
        installation_id: invocation.installation_resource_id,
        generation: invocation.projection_generation,
        config_hash: facts.projection_config_hash,
    };
    // birth owns its lifecycle/fresh authorization transaction; the plaintext
    // is passed directly to this first turn and is never a durable Task input.
    match crate::agent_session::birth(&state, id, &projection).await {
        Ok(birth) => {
            first_turn(
                &state,
                &invocation,
                &projection,
                &birth.runtime_thread_id,
                birth.core_memory,
                &input,
            )
            .await
        }
        Err(crate::agent_runtime::RuntimeError::AdmissionRequired) => {
            result(id, TaskStatus::Running, "RUNTIME_ADMISSION_UNAVAILABLE")
        }
        Err(_) => result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT"),
    }
}

#[derive(FromRow)]
struct CancellationGrant {
    id: Uuid,
    state: String,
    expires_at: chrono::DateTime<chrono::Utc>,
    observed_at: chrono::DateTime<chrono::Utc>,
    cancel_pending: bool,
}

/// The same immutable Grant is checked on every Advance, including a running
/// turn. AE→Tenant→Invocation is shared with the first-turn and cleanup writers;
/// expiry uses actual wall clock, not an Automation pause/current-version flag.
async fn refresh_delegation_cancel(
    state: &ServiceState,
    invocation: &Invocation,
) -> Result<bool, sqlx::Error> {
    let mut tx = state.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, invocation.action_execution_id).await?;
    if ae.tenant_id != invocation.tenant_id
        || ae.workspace_id != Some(invocation.workspace_id)
        || ae.temporal_workflow_id.as_deref() != Some(invocation.workflow_id.as_str())
    {
        return Err(sqlx::Error::Protocol("Delegation 取消 scope 不一致".into()));
    }
    let tenant: Option<Uuid> =
        sqlx::query_scalar("select id from identity.tenant where id=$1 for no key update")
            .bind(ae.tenant_id)
            .fetch_optional(&mut *tx)
            .await?;
    if tenant != Some(invocation.tenant_id) {
        return Err(sqlx::Error::Protocol(
            "Delegation 取消 Tenant 不可核验".into(),
        ));
    }
    let grant: Option<CancellationGrant> =
        sqlx::query_as("select g.id,g.state,g.expires_at,clock_timestamp() as observed_at,i.cancel_pending
            from catalog.agent_invocation i join admission.delegation_grant g on g.id=i.delegation_id
            where i.id=$1 and i.action_execution_id=$2 and i.tenant_id=$3 and i.workspace_id=$4
              and i.workflow_id=$5 and i.installation_resource_id=$6
              and i.agent_version_asset_id=$7 and i.projection_generation=$8
              and g.tenant_id=i.tenant_id and g.workspace_id=i.workspace_id
              and g.installation_resource_id=i.installation_resource_id
              and g.agent_principal_id=$9 and g.grantor_principal_id=$10
            for update of i")
        .bind(invocation.id).bind(ae.id).bind(ae.tenant_id).bind(ae.workspace_id)
        .bind(&invocation.workflow_id).bind(invocation.installation_resource_id)
        .bind(invocation.agent_version_asset_id).bind(invocation.projection_generation)
        .bind(ae.actor_principal_id).bind(ae.initiator_principal_id)
        .fetch_optional(&mut *tx).await?;
    let Some(grant) = grant else {
        return Err(sqlx::Error::Protocol(
            "Invocation 冻结 Delegation 不可核验".into(),
        ));
    };
    let revoked = crate::governance::delegation::cancellation_required(
        &grant.state,
        grant.expires_at,
        grant.observed_at,
    )
    .map_err(|_| sqlx::Error::Protocol("Delegation 状态不可核验".into()))?;
    if revoked {
        crate::governance::delegation::flag_invocations(&mut tx, invocation.tenant_id, grant.id)
            .await?;
        turn_audit(
            state,
            &mut tx,
            &ae,
            invocation.id,
            ("delegation-cancel", "DISPATCH", "DELEGATION_CANCEL_PENDING"),
            vec![crate::audit::Evidence::new(
                EvidenceKind::ActionExecutionId,
                ae.id,
            )],
        )
        .await?;
    }
    tx.commit().await?;
    Ok(grant.cancel_pending || revoked)
}

/// A canceled CREATED invocation has no model execution to settle. The absence
/// proof is taken under the same fence as the only first-turn writer; an intent
/// or trace already written is never reclassified as zero usage.
async fn cancel_before_dispatch(
    state: &ServiceState,
    invocation: &Invocation,
) -> Result<bool, sqlx::Error> {
    let mut tx = state.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, invocation.action_execution_id).await?;
    if ae.tenant_id != invocation.tenant_id
        || ae.workspace_id != Some(invocation.workspace_id)
        || ae.temporal_workflow_id.as_deref() != Some(invocation.workflow_id.as_str())
    {
        return Ok(false);
    }
    // Cleanup remains possible after scope revocation/suspension. This lock
    // fences new dispatch; it does not grant an ACTIVE tenant or permission.
    let tenant: Option<Uuid> =
        sqlx::query_scalar("select id from identity.tenant where id=$1 for no key update")
            .bind(ae.tenant_id)
            .fetch_optional(&mut *tx)
            .await?;
    if tenant != Some(invocation.tenant_id) {
        return Ok(false);
    }
    let undispatched: Option<bool> = sqlx::query_scalar(
        "select i.status='CREATED' and i.cancel_pending and i.runtime_turn_id is null
           and i.native_status is null and i.reply_event_id is null
           and d.quota_policy='CHECK' and cardinality(d.meters)>0
           and not exists(select 1 from projection.agent_model_trace t where t.invocation_id=i.id)
           and not exists(select 1 from outbox.usage_event u where u.invocation_id=i.id or u.operation_id=$6)
         from catalog.agent_invocation i join catalog.action_definition d
           on d.action_key=$7 and d.version=$8
         where i.id=$1 and i.action_execution_id=$2 and i.tenant_id=$3
           and i.workspace_id=$4 and i.workflow_id=$5 for update of i",
    )
    .bind(invocation.id)
    .bind(ae.id)
    .bind(ae.tenant_id)
    .bind(ae.workspace_id)
    .bind(&invocation.workflow_id)
    .bind(ae.operation_id)
    .bind(&ae.action_key)
    .bind(ae.action_version)
    .fetch_optional(&mut *tx)
    .await?;
    if undispatched != Some(true) {
        return Ok(false);
    }
    let changed = sqlx::query(
        "update catalog.agent_invocation set status='CANCELED',updated_at=now()
         where id=$1 and status='CREATED' and cancel_pending and runtime_turn_id is null
           and native_status is null and reply_event_id is null",
    )
    .bind(invocation.id)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Ok(false);
    }
    turn_audit(
        state,
        &mut tx,
        &ae,
        invocation.id,
        (
            "canceled-before-dispatch",
            "OUTCOME",
            "CANCELED_BEFORE_MODEL_DISPATCH",
        ),
        vec![
            crate::audit::Evidence::new(EvidenceKind::ActionExecutionId, ae.id),
            crate::audit::Evidence::new(EvidenceKind::TemporalWorkflowId, &invocation.workflow_id),
        ],
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

/// The only first-turn sender. Once DISPATCHING is committed this branch is
/// unreachable on retry: recovery consumes the same clientUserMessageId from
/// native history, never another model request or a newer memory head.
async fn first_turn(
    state: &ServiceState,
    invocation: &Invocation,
    projection: &RuntimeRef,
    thread: &str,
    memory: Option<CoreMemory>,
    holder: &AgentTaskAdvanceRequest,
) -> Response {
    let Some(memory) = memory else {
        return result(invocation.id, TaskStatus::Running, "MEMORY_UNREADABLE");
    };
    let source = match source_message(state, invocation).await {
        Ok(source) => source,
        Err(_) => {
            return result(
                invocation.id,
                TaskStatus::Running,
                "RUNTIME_ADMISSION_UNAVAILABLE",
            )
        }
    };
    if source.content.is_empty() {
        return result(
            invocation.id,
            TaskStatus::Running,
            "RUNTIME_ADMISSION_UNAVAILABLE",
        );
    }
    match prepare_dispatch(
        state,
        invocation,
        projection,
        thread,
        &source.author,
        &memory,
        holder,
    )
    .await
    {
        Ok(()) => {}
        Err(crate::agent_runtime::RuntimeError::Unknown) => {
            return result(
                invocation.id,
                TaskStatus::Running,
                "UNKNOWN_EXTERNAL_RESULT",
            );
        }
        Err(_) => {
            return result(
                invocation.id,
                TaskStatus::Running,
                "RUNTIME_ADMISSION_UNAVAILABLE",
            )
        }
    }
    let core = match &memory {
        CoreMemory::Found { profile, .. } => Some(profile.as_str()),
        CoreMemory::Absent => None,
    };
    // Context reads can outlive the original Activity observation. Before a
    // new native side effect, re-read that same run/activity/attempt; a retry
    // holder is not authorization for a delayed earlier HTTP request.
    let current = match i32::try_from(holder.attempt) {
        Ok(attempt) => state
            .capacity
            .acquire_or_renew(
                &state.pool,
                &state.temporal,
                invocation.id,
                &holder.run_id,
                &holder.activity_id,
                attempt,
            )
            .await
            .ok(),
        Err(_) => None,
    };
    let observed = match (current, state.agent_runtime.as_ref()) {
        (Some(holder), Some(runtime)) if holder.held && !holder.workflow_cancel_requested => {
            runtime
                .start_turn(
                    state,
                    projection,
                    invocation.id,
                    thread,
                    (&source.content, core),
                )
                .await
        }
        _ => Err(crate::agent_runtime::RuntimeError::AdmissionRequired),
    };
    // Neither source nor decrypted core crosses this RPC lifetime or appears
    // in an audit/error. Even a pre-RPC error retains the committed intent.
    drop(memory);
    drop(source);
    match record_turn(state, invocation, thread, observed).await {
        Ok(true) => result(invocation.id, TaskStatus::Running, "NONE"),
        Ok(false) => result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        ),
        Err(error) => unavailable(error),
    }
}

async fn source_message(
    state: &ServiceState,
    invocation: &Invocation,
) -> Result<collab_bridge::memory::SourceMessage, crate::agent_runtime::RuntimeError> {
    use crate::agent_runtime::RuntimeError;
    let channel: Option<Uuid> = sqlx::query_scalar(
        "select b.channel_id from projection.workspace_buzz_binding b
         join identity.workspace w on w.id=b.workspace_id and w.tenant_id=$2 and w.state='ACTIVE'
         where b.workspace_id=$1 and b.state='ACTIVE'",
    )
    .bind(invocation.workspace_id)
    .bind(invocation.tenant_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| RuntimeError::Unavailable)?;
    let channel = channel.ok_or(RuntimeError::AdmissionRequired)?;
    let (client, _) = crate::tenant_lifecycle::control_client(
        state,
        invocation.tenant_id,
        crate::tenant_lifecycle::ProjectionDirection::Establish,
    )
    .await
    .map_err(|_| RuntimeError::Unavailable)?;
    client
        .source_message(
            &state.http,
            &invocation.source_event_id,
            &channel.to_string(),
            &invocation.root_event_id,
        )
        .await
        .map_err(|_| RuntimeError::Unavailable)
}

async fn prepare_dispatch(
    state: &ServiceState,
    invocation: &Invocation,
    projection: &RuntimeRef,
    thread: &str,
    source_author: &str,
    memory: &CoreMemory,
    holder: &AgentTaskAdvanceRequest,
) -> Result<(), crate::agent_runtime::RuntimeError> {
    use crate::agent_runtime::RuntimeError;
    crate::service_api::audit_gate(state)
        .await
        .map_err(|_| RuntimeError::Unavailable)?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| RuntimeError::Unknown)?;
    let ae = crate::governance::lock_execution(&mut tx, invocation.action_execution_id)
        .await
        .map_err(|_| RuntimeError::Unknown)?;
    let lifecycle: Option<bool> = sqlx::query_scalar(
        "select t.state='ACTIVE' and w.state='ACTIVE' from identity.tenant t
         join identity.workspace w on w.tenant_id=t.id where t.id=$1 and w.id=$2
         for no key update of t,w",
    )
    .bind(invocation.tenant_id)
    .bind(invocation.workspace_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| RuntimeError::Unknown)?;
    if lifecycle != Some(true)
        || ae.tenant_id != invocation.tenant_id
        || ae.workspace_id != Some(invocation.workspace_id)
        || ae.temporal_workflow_id.as_deref() != Some(invocation.workflow_id.as_str())
    {
        return Err(RuntimeError::AdmissionRequired);
    }
    let frozen: Option<(String,Option<String>,Option<String>)> = sqlx::query_as(
        "select s.core_memory_state,s.core_memory_event_id,i.runtime_turn_id
         from catalog.agent_invocation i join catalog.agent_session s
           on s.workspace_id=i.workspace_id and s.root_event_id=i.root_event_id
           and s.installation_resource_id=i.installation_resource_id and s.tenant_id=i.tenant_id
           and s.agent_version_asset_id=i.agent_version_asset_id and s.projection_generation=i.projection_generation
         join catalog.agent_runtime_projection p on p.installation_resource_id=i.installation_resource_id
           and p.generation=i.projection_generation and p.agent_version_asset_id=i.agent_version_asset_id
         where i.id=$1 and i.status='CREATED' and not i.cancel_pending and i.runtime_turn_id is null
           and i.action_execution_id=$2 and i.tenant_id=$3 and i.workspace_id=$4
           and i.installation_resource_id=$5 and i.agent_version_asset_id=$6
           and i.projection_generation=$7 and p.config_hash=$8 and p.state='ACTIVE'
           and s.status='ACTIVE' and s.runtime_thread_id=$9
           and exists(select 1 from admission.capacity_lease l
             where l.invocation_id=i.id and l.operation_id=$10 and l.state='HELD'
               and l.workflow_id=i.workflow_id and l.tenant_id=i.tenant_id
               and l.workspace_id=i.workspace_id and l.expires_at>clock_timestamp()
               and l.run_id=$11 and l.activity_id=$12 and l.attempt=$13)
         for update of i,s,p",
    ).bind(invocation.id).bind(ae.id).bind(invocation.tenant_id).bind(invocation.workspace_id)
        .bind(projection.installation_id).bind(invocation.agent_version_asset_id)
        .bind(projection.generation).bind(&projection.config_hash).bind(thread).bind(ae.operation_id)
        .bind(Uuid::parse_str(&holder.run_id).map_err(|_| RuntimeError::AdmissionRequired)?)
        .bind(&holder.activity_id)
        .bind(i32::try_from(holder.attempt).map_err(|_| RuntimeError::AdmissionRequired)?)
        .fetch_optional(&mut *tx).await.map_err(|_| RuntimeError::Unknown)?;
    let Some((memory_state, memory_event, None)) = frozen else {
        return Err(RuntimeError::AdmissionRequired);
    };
    let memory_matches = match memory {
        CoreMemory::Found { head, .. } => {
            memory_state == "FOUND" && memory_event.as_deref() == Some(head.event_id.as_str())
        }
        CoreMemory::Absent => memory_state == "ABSENT" && memory_event.is_none(),
    };
    let source: bool = sqlx::query_scalar(
        "select exists(select 1 from identity.buzz_identity_binding b
         join identity.principal p on p.id=b.principal_id and p.tenant_id=b.tenant_id
         join identity.tenant_membership m on m.tenant_principal_id=p.id and m.tenant_id=p.tenant_id
         where b.pubkey=$1 and b.tenant_id=$2 and b.kind='HUMAN' and b.state='ACTIVE'
           and p.kind='HUMAN' and p.status='ACTIVE' and m.state='ACTIVE'
           and p.id::text=$3)",
    )
    .bind(source_author)
    .bind(invocation.tenant_id)
    .bind(
        ae.parameters
            .as_ref()
            .and_then(|p| p.get("sourcePrincipalId"))
            .and_then(Value::as_str),
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| RuntimeError::Unknown)?;
    if !memory_matches
        || !source
        || ae
            .parameters
            .as_ref()
            .and_then(|p| p.get("sourcePubkey"))
            .and_then(Value::as_str)
            != Some(source_author)
    {
        return Err(RuntimeError::AdmissionRequired);
    }
    crate::automation::fresh_invocation(state, &mut tx, invocation.id)
        .await
        .map_err(|_| RuntimeError::AdmissionRequired)?;
    let changed = sqlx::query(
        "update catalog.agent_invocation set status='DISPATCHING',updated_at=now()
        where id=$1 and status='CREATED' and not cancel_pending and runtime_turn_id is null",
    )
    .bind(invocation.id)
    .execute(&mut *tx)
    .await
    .map_err(|_| RuntimeError::Unknown)?;
    if changed.rows_affected() != 1 {
        return Err(RuntimeError::Unknown);
    }
    let mut evidence = vec![
        crate::audit::Evidence::new(EvidenceKind::ActionExecutionId, ae.id),
        crate::audit::Evidence::new(EvidenceKind::BuzzEventId, &invocation.source_event_id),
        crate::audit::Evidence::new(EvidenceKind::BuzzPubkey, source_author),
    ];
    if let Some(event) = memory_event {
        evidence.push(crate::audit::Evidence::new(
            EvidenceKind::BuzzEventId,
            event,
        ));
    }
    turn_audit(
        state,
        &mut tx,
        &ae,
        invocation.id,
        ("intent", "DISPATCH", "DISPATCH_INTENT"),
        evidence,
    )
    .await
    .map_err(|_| RuntimeError::Unknown)?;
    tx.commit().await.map_err(|_| RuntimeError::Unknown)
}

async fn record_turn(
    state: &ServiceState,
    invocation: &Invocation,
    thread: &str,
    observed: Result<String, crate::agent_runtime::RuntimeError>,
) -> Result<bool, sqlx::Error> {
    let mut tx = state.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, invocation.action_execution_id).await?;
    let turn = observed
        .as_ref()
        .ok()
        .filter(|turn| !turn.is_empty())
        .map(String::as_str);
    let changed = sqlx::query("update catalog.agent_invocation i set runtime_turn_id=$2,status=$3,updated_at=now()
        where i.id=$1 and i.action_execution_id=$4 and i.status in ('DISPATCHING','UNKNOWN')
          and i.runtime_turn_id is null and exists(select 1 from catalog.agent_session s
            where s.workspace_id=i.workspace_id and s.root_event_id=i.root_event_id
              and s.installation_resource_id=i.installation_resource_id and s.runtime_thread_id=$5)")
        .bind(invocation.id).bind(turn).bind(if turn.is_some() { "RUNNING" } else { "UNKNOWN" })
        .bind(ae.id).bind(thread).execute(&mut *tx).await?;
    if changed.rows_affected() != 1 {
        // Another Activity may already have read back the exact native ID.
        // Do not overwrite its observed status or mistake that for a resend.
        let bound: bool = sqlx::query_scalar(
            "select exists(select 1 from catalog.agent_invocation
            where id=$1 and action_execution_id=$2 and runtime_turn_id=$3)",
        )
        .bind(invocation.id)
        .bind(ae.id)
        .bind(turn)
        .fetch_one(&mut *tx)
        .await?;
        return Ok(turn.is_some() && bound);
    }
    turn_audit(
        state,
        &mut tx,
        &ae,
        invocation.id,
        (
            "observed",
            "RECONCILIATION",
            if turn.is_some() {
                "NATIVE_TURN_BOUND"
            } else {
                "UNKNOWN_EXTERNAL_RESULT"
            },
        ),
        vec![crate::audit::Evidence::new(
            EvidenceKind::ActionExecutionId,
            ae.id,
        )],
    )
    .await?;
    tx.commit().await?;
    Ok(turn.is_some())
}

async fn turn_audit(
    state: &ServiceState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ae: &crate::governance::Execution,
    invocation: Uuid,
    outcome: (&str, &str, &str),
    evidence_refs: Vec<crate::audit::Evidence>,
) -> Result<(), sqlx::Error> {
    let (stage, event_type, result_code) = outcome;
    let def = crate::governance::exact_definition(&state.pool, &ae.action_key, ae.action_version)
        .await
        .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
    let human: Option<Uuid> = sqlx::query_scalar(
        "select human_identity_id from identity.tenant_membership
        where tenant_id=$1 and tenant_principal_id=$2",
    )
    .bind(ae.tenant_id)
    .bind(ae.initiator_principal_id)
    .fetch_optional(&mut **tx)
    .await?
    .flatten();
    crate::audit::append(
        tx,
        crate::audit::AuditEntry {
            event_key: format!("{}:agent-turn:{invocation}:{stage}", ae.operation_id),
            tenant_id: Some(ae.tenant_id),
            workspace_id: ae.workspace_id,
            operation_id: ae.operation_id,
            event_type,
            human_identity_id: human,
            initiator_principal_id: Some(ae.initiator_principal_id),
            actor_principal_id: Some(ae.actor_principal_id),
            action_key: &ae.action_key,
            action_version: ae.action_version,
            component_type_key: &def.component_type_key,
            target_type: Some(&def.target_type),
            target_id: Some(ae.target_id),
            parameter_hash: &ae.parameter_hash,
            decision: if event_type == "DISPATCH" {
                "ALLOW"
            } else {
                "NONE"
            },
            result_code,
            result_exposure: &def.result_exposure,
            evidence_refs,
            correlation_id: ae.correlation_id,
        },
    )
    .await
}

async fn observe(
    state: &ServiceState,
    invocation: &Invocation,
    projection: &RuntimeRef,
    page: Value,
    activity: &AgentTaskAdvanceRequest,
    released: bool,
) -> Response {
    let Some(turns) = page.get("data").and_then(Value::as_array) else {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    };
    let cursor = match page.get("nextCursor") {
        Some(Value::Null) => None,
        Some(Value::String(cursor)) if !cursor.is_empty() => Some(cursor.as_str()),
        _ => {
            return result(
                invocation.id,
                TaskStatus::Running,
                "UNKNOWN_EXTERNAL_RESULT",
            )
        }
    };
    let mut matched = None;
    let client_id = invocation.id.to_string();
    for turn in turns {
        if turn.get("itemsView").and_then(Value::as_str) != Some("full") {
            return result(
                invocation.id,
                TaskStatus::Running,
                "UNKNOWN_EXTERNAL_RESULT",
            );
        }
        let Some(items) = turn.get("items").and_then(Value::as_array) else {
            return result(
                invocation.id,
                TaskStatus::Running,
                "UNKNOWN_EXTERNAL_RESULT",
            );
        };
        let Some(turn_id) = turn
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
        else {
            return result(
                invocation.id,
                TaskStatus::Running,
                "UNKNOWN_EXTERNAL_RESULT",
            );
        };
        let correlations = items
            .iter()
            .filter(|item| {
                item.get("type").and_then(Value::as_str) == Some("userMessage")
                    && item.get("clientId").and_then(Value::as_str) == Some(client_id.as_str())
            })
            .count();
        let expected = match invocation.runtime_turn_id.as_deref() {
            Some(known) => known == turn_id,
            None => correlations != 0,
        };
        if expected {
            // 原 turn ID 本身不证明属于此 Invocation；full history 还必须包含
            // 唯一的 clientUserMessageId，不能消费同 thread 另一轮的终态。
            if correlations != 1 || matched.is_some() {
                return result(
                    invocation.id,
                    TaskStatus::Running,
                    "UNKNOWN_EXTERNAL_RESULT",
                );
            }
            matched = Some(turn);
        }
    }
    if invocation.runtime_turn_id.is_none() && cursor.is_some() {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    }
    let Some(turn) = matched else {
        let changed = match sqlx::query("update catalog.agent_invocation set status='UNKNOWN',observation_cursor=$2,updated_at=now() where id=$1 and status=$3 and observation_cursor is not distinct from $4 and native_status is not distinct from $5 and runtime_turn_id is not distinct from $6")
            .bind(invocation.id).bind(cursor).bind(&invocation.status).bind(&invocation.observation_cursor)
            .bind(&invocation.native_status).bind(&invocation.runtime_turn_id).execute(&state.pool).await {
            Ok(changed) => changed, Err(error) => return unavailable(error),
        };
        if changed.rows_affected() != 1 {
            return result(
                invocation.id,
                TaskStatus::Running,
                "UNKNOWN_EXTERNAL_RESULT",
            );
        }
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    };
    let Some(id) = turn
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| Uuid::parse_str(id).is_ok())
    else {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    };
    let Some(status) = turn.get("status").and_then(Value::as_str) else {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    };
    if !["inProgress", "completed", "failed", "interrupted"].contains(&status) {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    }
    if invocation.native_status.as_deref().is_some_and(|known| {
        matches!(known, "completed" | "failed" | "interrupted") && known != status
    }) {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    }
    let changed = match sqlx::query("update catalog.agent_invocation set runtime_turn_id=$2,native_status=$3,status='RUNNING',observation_cursor=null,updated_at=now() where id=$1 and status=$4 and observation_cursor is not distinct from $5 and native_status is not distinct from $6 and runtime_turn_id is not distinct from $7")
        .bind(invocation.id).bind(id).bind(status).bind(&invocation.status).bind(&invocation.observation_cursor)
        .bind(&invocation.native_status).bind(&invocation.runtime_turn_id).execute(&state.pool).await {
        Ok(changed) => changed, Err(error) => return unavailable(error),
    };
    if changed.rows_affected() != 1 {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    }
    if status == "inProgress" && invocation.cancel_pending {
        // Recovery can discover the original turn ID in this very page. Stop
        // that turn even when its billing timestamp is still unknown, without
        // another dispatch; acceptance is not native terminal evidence.
        let (Some(runtime), Some(thread)) = (
            state.agent_runtime.as_ref(),
            invocation.runtime_thread_id.as_deref(),
        ) else {
            return result(
                invocation.id,
                TaskStatus::Running,
                "UNKNOWN_EXTERNAL_RESULT",
            );
        };
        if runtime.interrupt(projection, thread, id).await.is_err() {
            return result(
                invocation.id,
                TaskStatus::Running,
                "UNKNOWN_EXTERNAL_RESULT",
            );
        }
    }
    let Some(started_at) = turn
        .get("startedAt")
        .and_then(Value::as_i64)
        .filter(|seconds| *seconds > 0)
        .and_then(|seconds| chrono::DateTime::<chrono::Utc>::from_timestamp(seconds, 0))
    else {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    };
    // 唯一 native turn 已 CAS 绑定后，消费同一冻结 count meter/outbox；不从
    // poll 时间、模型 token 或 Activity 次数生成 Invocation 运行次数。
    let usage_recorded =
        crate::gateway_usage::record_invocation_usage(&state.pool, invocation.id, id, started_at)
            .await
            .is_ok();
    if status == "inProgress" && !invocation.cancel_pending {
        let (Some(runtime), Some(thread)) = (
            state.agent_runtime.as_ref(),
            invocation.runtime_thread_id.as_deref(),
        ) else {
            return result(
                invocation.id,
                TaskStatus::Running,
                "UNKNOWN_EXTERNAL_RESULT",
            );
        };
        let activity = match runtime.last_activity_at(projection, thread, id).await {
            Ok(activity) => activity,
            Err(_) => {
                return result(
                    invocation.id,
                    TaskStatus::Running,
                    "UNKNOWN_EXTERNAL_RESULT",
                )
            }
        };
        let mut conn = match state.pool.acquire().await {
            Ok(conn) => conn,
            Err(error) => return unavailable(error),
        };
        let expired = match crate::agent_policy::load(&mut conn, invocation.id).await {
            Ok(policy) => match policy.turn_limit_reached(turn, activity, chrono::Utc::now()) {
                Ok(expired) => expired,
                Err(_) => {
                    return result(
                        invocation.id,
                        TaskStatus::Running,
                        "UNKNOWN_EXTERNAL_RESULT",
                    )
                }
            },
            Err(_) => {
                return result(
                    invocation.id,
                    TaskStatus::Running,
                    "UNKNOWN_EXTERNAL_RESULT",
                )
            }
        };
        if expired {
            // 原生同 turn 的 startedAt/emittedAtMs 才证明到期。先保存取消意图；interrupt
            // 成功或结果不明都不写 CANCELED、不释放 holder，不重复 turn/start。
            let changed = match sqlx::query("update catalog.agent_invocation set cancel_pending=true,updated_at=now() where id=$1 and status='RUNNING' and native_status='inProgress' and runtime_turn_id=$2 and not cancel_pending")
                .bind(invocation.id).bind(id).execute(&mut *conn).await {
                Ok(changed) => changed, Err(error) => return unavailable(error),
            };
            if changed.rows_affected() != 1 {
                return result(
                    invocation.id,
                    TaskStatus::Running,
                    "UNKNOWN_EXTERNAL_RESULT",
                );
            }
            drop(conn);
            if runtime.interrupt(projection, thread, id).await.is_err() {
                return result(
                    invocation.id,
                    TaskStatus::Running,
                    "UNKNOWN_EXTERNAL_RESULT",
                );
            }
        }
    }
    if !usage_recorded {
        // Billing 拒绝不是 native failure，也不绕过已到期回合的安全取消。
        return result(invocation.id, TaskStatus::Running, "BILLING_UNAVAILABLE");
    }
    if status == "completed" {
        if invocation.cancel_pending && invocation.reply_event_id.is_none() {
            // Known native completion is not a successful governed reply. A
            // revoked run cannot create a new reply intent, but must settle its
            // actual usage and release its holder before business failure.
            if released {
                return finish_billed_turn(state, invocation, id, status, None, None).await;
            }
            return release_holder(state, invocation.id, false, "CAPACITY_UNAVAILABLE").await;
        }
        let event_id = match invocation.reply_event_id.as_deref() {
            Some(event_id) => event_id.to_owned(),
            None => match publish_reply(state, invocation, projection, turn, activity).await {
                Ok(event_id) => event_id,
                Err(error) => {
                    // 新回复仍须 fresh 准入；没有已持久意图时不把拒绝伪装为发送。
                    return result(
                        invocation.id,
                        TaskStatus::Running,
                        &crate::governance::wire(&error.reason()),
                    );
                }
            },
        };
        let waiting = match reconcile_reply(state, invocation, id, &event_id).await {
            Ok(Some(delivered)) if released => {
                return finish_billed_turn(
                    state,
                    invocation,
                    id,
                    status,
                    Some(&event_id),
                    Some(delivered),
                )
                .await;
            }
            Ok(Some(_)) => "CAPACITY_UNAVAILABLE",
            Ok(None) => {
                let changed = match sqlx::query("update catalog.agent_invocation set status='UNKNOWN',updated_at=now() where id=$1 and status='RUNNING' and native_status='completed' and runtime_turn_id=$2 and reply_event_id=$3")
                        .bind(invocation.id).bind(id).bind(&event_id)
                        .execute(&state.pool).await {
                        Ok(changed) => changed, Err(error) => return unavailable(error),
                    };
                if changed.rows_affected() != 1 {
                    return result(
                        invocation.id,
                        TaskStatus::Running,
                        "UNKNOWN_EXTERNAL_RESULT",
                    );
                }
                "UNKNOWN_EXTERNAL_RESULT"
            }
            Err(error) => return unavailable(error),
        };
        return release_holder(state, invocation.id, released, waiting).await;
    }
    if matches!(status, "failed" | "interrupted") {
        if released {
            return finish_billed_turn(state, invocation, id, status, None, None).await;
        }
        return release_holder(state, invocation.id, false, "CAPACITY_UNAVAILABLE").await;
    }
    // 原生 usage notification 仍不替代 durable Usage 与 reply/sideeffect receipts。
    result(invocation.id, TaskStatus::Running, "NONE")
}

#[derive(FromRow, PartialEq)]
struct ReplyBinding {
    agent_version_content: Value,
    agent_version_config_hash: String,
    agent_pubkey: String,
    agent_locator: String,
    agent_secret_version: i32,
    agent_audience: String,
    normalized_host: String,
    nip11_snapshot_digest: String,
    channel_id: Uuid,
}

/// Consume only the original message-triggered AGENT_TURN result location.
/// An arbitrary AgentVersion replyPolicy key is not a broadcast policy.
async fn lock_reply(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    invocation: &Invocation,
    projection: &RuntimeRef,
    turn_id: &str,
    expected_event: Option<&str>,
) -> Result<(crate::governance::Execution, ReplyBinding), crate::governance::Refusal> {
    use crate::governance::Refusal;
    use contracts::ReasonCode;
    let ae = crate::governance::lock_execution(tx, invocation.action_execution_id).await?;
    let lifecycle: Option<bool> = sqlx::query_scalar(
        "select t.state='ACTIVE' and w.state='ACTIVE' from identity.tenant t
         join identity.workspace w on w.tenant_id=t.id where t.id=$1 and w.id=$2
         for no key update of t,w",
    )
    .bind(invocation.tenant_id)
    .bind(invocation.workspace_id)
    .fetch_optional(&mut **tx)
    .await?;
    if lifecycle != Some(true)
        || ae.tenant_id != invocation.tenant_id
        || ae.workspace_id != Some(invocation.workspace_id)
        || ae.temporal_workflow_id.as_deref() != Some(invocation.workflow_id.as_str())
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let binding: Option<ReplyBinding> = sqlx::query_as(
        "select av.content agent_version_content,av.config_hash agent_version_config_hash,
            b.pubkey agent_pubkey,b.private_key_secret_ref agent_locator,
            b.private_key_secret_version agent_secret_version,b.private_key_secret_audience agent_audience,
            tb.normalized_host,tb.nip11_snapshot_digest,wb.channel_id
         from catalog.agent_invocation i
         join catalog.agent_session s on s.workspace_id=i.workspace_id and s.root_event_id=i.root_event_id
           and s.installation_resource_id=i.installation_resource_id and s.tenant_id=i.tenant_id
           and s.agent_version_asset_id=i.agent_version_asset_id and s.projection_generation=i.projection_generation
         join catalog.agent_runtime_projection p on p.installation_resource_id=i.installation_resource_id
           and p.generation=i.projection_generation and p.agent_version_asset_id=i.agent_version_asset_id
         join catalog.automation_version v on v.asset_id=i.automation_version_asset_id
           and v.automation_resource_id=i.automation_resource_id and v.state='PUBLISHED'
           and v.action->>'kind'='AGENT_TURN' and v.trigger->>'kind' in ('CHANNEL_MESSAGE','MENTION')
           and v.result_target='TRIGGER_THREAD'
         join catalog.agent_installation a on a.resource_id=i.installation_resource_id and a.workspace_id=i.workspace_id
           and a.pinned_version_asset_id=i.agent_version_asset_id and a.active_projection_generation=i.projection_generation
         join catalog.agent_version av on av.asset_id=i.agent_version_asset_id
           and av.agent_resource_id=a.agent_resource_id and av.state in ('PUBLISHED','RETIRED')
         join catalog.asset va on va.id=av.asset_id and va.tenant_id=i.tenant_id
           and va.state in ('PUBLISHED','RETIRED') and va.projection_action_execution_id is null
         join catalog.agent_memory_binding m on m.installation_resource_id=a.resource_id and m.state='ACTIVE'
         join identity.buzz_identity_binding b on b.pubkey=m.agent_buzz_identity_binding_id
           and b.principal_id=a.agent_principal_id and b.tenant_id=i.tenant_id and b.kind='AGENT'
           and b.custody='SERVER' and b.state='ACTIVE'
         join catalog.channel_agent_binding cb on cb.installation_resource_id=a.resource_id
           and cb.workspace_id=i.workspace_id and cb.status='ACTIVE'
         join projection.tenant_buzz_binding tb on tb.tenant_id=i.tenant_id and tb.state='ACTIVE'
         join projection.workspace_buzz_binding wb on wb.workspace_id=i.workspace_id and wb.state='ACTIVE'
         where i.id=$1 and i.action_execution_id=$2 and i.tenant_id=$3 and i.workspace_id=$4
           and i.installation_resource_id=$5 and i.agent_version_asset_id=$6 and i.projection_generation=$7
           and p.config_hash=$8 and p.state='ACTIVE' and s.status='ACTIVE' and s.runtime_thread_id=$9
           and i.status in ('RUNNING','UNKNOWN') and i.native_status='completed' and i.runtime_turn_id=$10
           and i.reply_event_id is not distinct from $11::text and not i.cancel_pending
           and b.private_key_secret_ref is not null and b.private_key_secret_version>0
           and b.private_key_secret_audience is not null and tb.nip11_snapshot_digest is not null
         for update of i,s,p,b,m,cb,tb,wb")
        .bind(invocation.id).bind(ae.id).bind(invocation.tenant_id).bind(invocation.workspace_id)
        .bind(projection.installation_id).bind(invocation.agent_version_asset_id).bind(projection.generation)
        .bind(&projection.config_hash).bind(&invocation.runtime_thread_id).bind(turn_id).bind(expected_event)
        .fetch_optional(&mut **tx).await?;
    let binding = binding.ok_or(Refusal::Precondition(ReasonCode::BindingNotActive))?;
    let content: contracts::ContentClass =
        serde_json::from_value(binding.agent_version_content.clone())
            .map_err(|_| Refusal::Unavailable("Agent reply 的固定版本不符合共享契约".into()))?;
    let (_, hash) = crate::agent_version::content(&content)?;
    if hash != binding.agent_version_config_hash {
        return Err(Refusal::Unavailable(
            "Agent reply 的固定版本摘要不可查证".into(),
        ));
    }
    // Both pre-sign and pre-delivery callers take this fence. The current
    // Automation result target remains TRIGGER_THREAD; no broadcast publisher
    // is introduced, and an already persisted reply ID is only observed.
    crate::agent_version::runtime_profile(&content)?;
    Ok((ae, binding))
}

/// Full durable history is already fenced by the unique Invocation clientId.
/// Only an explicit final_answer is publishable; unknown phases/async questions
/// do not become a guessed reply, and completion time never comes from a poll.
fn native_reply(turn: &Value) -> Option<(&str, u64)> {
    if turn.get("status").and_then(Value::as_str) != Some("completed")
        || turn.get("itemsView").and_then(Value::as_str) != Some("full")
        || turn.get("error").is_some_and(|error| !error.is_null())
    {
        return None;
    }
    let started = turn.get("startedAt")?.as_i64().filter(|time| *time > 0)?;
    let completed = turn
        .get("completedAt")?
        .as_i64()
        .filter(|time| *time >= started && *time <= chrono::Utc::now().timestamp())?;
    let mut final_message = None;
    for message in turn
        .get("items")?
        .as_array()?
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("agentMessage"))
    {
        if message.get("id")?.as_str()?.is_empty()
            || message
                .get("delivery")
                .is_some_and(|delivery| !delivery.is_null())
            || message
                .get("questions")
                .is_some_and(|questions| !questions.is_null())
        {
            return None;
        }
        match message.get("phase").and_then(Value::as_str) {
            Some("commentary") => {}
            Some("final_answer") => {
                if final_message.replace(message).is_some() {
                    return None;
                }
            }
            _ => return None,
        }
    }
    let message = final_message?;
    let text = message
        .get("text")?
        .as_str()
        .filter(|text| !text.trim().is_empty())?;
    Some((text, u64::try_from(completed).ok()?))
}

async fn publish_reply(
    state: &ServiceState,
    invocation: &Invocation,
    projection: &RuntimeRef,
    turn: &Value,
    activity: &AgentTaskAdvanceRequest,
) -> Result<String, crate::governance::Refusal> {
    use crate::{audit::Evidence, governance::Refusal};
    use collab_bridge::bridge::{Custody, Delivery, IdentityClient};
    use contracts::ReasonCode;
    let unknown = || Refusal::Unavailable("Agent reply evidence cannot be verified".into());
    let (text, completed_at) = native_reply(turn).ok_or_else(unknown)?;
    let turn_id = turn.get("id").and_then(Value::as_str).ok_or_else(unknown)?;
    let attempt = i32::try_from(activity.attempt).map_err(|_| unknown())?;
    let holder = state
        .capacity
        .acquire_or_renew(
            &state.pool,
            &state.temporal,
            invocation.id,
            &activity.run_id,
            &activity.activity_id,
            attempt,
        )
        .await
        .map_err(|_| unknown())?;
    if !holder.held || holder.workflow_cancel_requested || invocation.cancel_pending {
        return Err(Refusal::Precondition(ReasonCode::TargetStateConflict));
    }
    crate::service_api::audit_gate(state)
        .await
        .map_err(|_| unknown())?;
    let mut tx = state.pool.begin().await?;
    let (ae, binding) = lock_reply(&mut tx, invocation, projection, turn_id, None).await?;
    let expected_locator = state.secrets.tenant_locator(
        invocation.tenant_id,
        &format!(
            "buzz-agent/installation/{}",
            invocation.installation_resource_id
        ),
    );
    if binding.agent_locator != expected_locator || binding.agent_audience != state.secret_audience
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let keys = crate::server_identity::read_bound_keys(
        &state.secrets,
        &secret_store::SecretRef {
            locator: binding.agent_locator.clone(),
            version: u32::try_from(binding.agent_secret_version).map_err(|_| unknown())?,
            audience: binding.agent_audience.clone(),
        },
        &binding.agent_pubkey,
    )
    .await
    .map_err(|_| unknown())?;
    let client = IdentityClient::new(
        Custody::Server,
        &keys.secret_key().to_secret_hex(),
        &state.relay_transport,
        &binding.normalized_host,
    )
    .map_err(|_| unknown())?;
    let transport = reqwest::Url::parse(&state.relay_transport).map_err(|_| unknown())?;
    let nip11 =
        collab_bridge::limits::fetch_nip11(&state.http, &transport, &binding.normalized_host)
            .await
            .map_err(|_| unknown())?;
    if nip11.digest != binding.nip11_snapshot_digest {
        return Err(Refusal::Precondition(ReasonCode::BindingNotActive));
    }
    let revision =
        crate::automation::fresh_reply(state, &mut tx, invocation.id, turn_id, None).await?;
    let event = client
        .sign_channel_reply_at(
            &binding.channel_id.to_string(),
            text,
            (&invocation.root_event_id, &invocation.source_event_id),
            completed_at,
        )
        .map_err(|_| unknown())?;
    let event_id = event.id.to_hex();
    let admitted = client.admit().map_err(|_| unknown())?;
    let evidence = vec![
        Evidence::new(EvidenceKind::ActionExecutionId, ae.id),
        Evidence::new(EvidenceKind::BuzzEventId, &event_id),
        Evidence::new(EvidenceKind::BuzzPubkey, &binding.agent_pubkey),
        Evidence::new(EvidenceKind::SpicedbZedtoken, revision),
        Evidence::new(EvidenceKind::TemporalWorkflowId, &invocation.workflow_id),
        Evidence::new(EvidenceKind::TemporalRunId, &activity.run_id),
    ];
    let changed = sqlx::query(
        "update catalog.agent_invocation set reply_event_id=$3,updated_at=now()
        where id=$1 and runtime_turn_id=$2 and native_status='completed' and reply_event_id is null
          and status in ('RUNNING','UNKNOWN') and not cancel_pending",
    )
    .bind(invocation.id)
    .bind(turn_id)
    .bind(&event_id)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(unknown());
    }
    turn_audit(
        state,
        &mut tx,
        &ae,
        invocation.id,
        (
            &format!("reply:{event_id}:dispatch"),
            "DISPATCH",
            "DISPATCHED",
        ),
        evidence.clone(),
    )
    .await?;
    tx.commit().await?;
    // A crash after this commit leaves only the stable ID. Future observations
    // query it; they cannot sign again or reconstruct/replay a second reply.
    let prepared = async {
        let holder = state
            .capacity
            .acquire_or_renew(
                &state.pool,
                &state.temporal,
                invocation.id,
                &activity.run_id,
                &activity.activity_id,
                attempt,
            )
            .await
            .map_err(|_| unknown())?;
        if !holder.held || holder.workflow_cancel_requested {
            return Err(Refusal::Precondition(ReasonCode::TargetStateConflict));
        }
        let mut guard = state.pool.begin().await?;
        let (current_ae, current_binding) =
            lock_reply(&mut guard, invocation, projection, turn_id, Some(&event_id)).await?;
        let intents: Vec<ReplyIntent> = sqlx::query_as(REPLY_INTENT)
            .bind(invocation.id)
            .bind(&event_id)
            .bind(turn_id)
            .fetch_all(&mut *guard)
            .await?;
        let [intent] = intents.as_slice() else {
            return Err(unknown());
        };
        if current_binding != binding
            || current_ae.operation_id != ae.operation_id
            || intent.operation_id != ae.operation_id
            || intent.agent_pubkey != binding.agent_pubkey
            || intent.channel_id != binding.channel_id
        {
            return Err(unknown());
        }
        crate::automation::fresh_reply(state, &mut guard, invocation.id, turn_id, Some(&event_id))
            .await?;
        Ok::<_, Refusal>(guard)
    }
    .await;
    let mut guard = match prepared {
        Ok(guard) => guard,
        Err(error) => {
            // Only this invocation of publish_reply just won the intent CAS;
            // no deliver call has begun. Dependency/DB uncertainty is not a
            // rejection proof, and recovery never manufactures this outcome.
            if definite_reply_refusal(&error) {
                record_reply_not_delivered(
                    state,
                    invocation,
                    &ae,
                    turn_id,
                    &event_id,
                    evidence.clone(),
                )
                .await?;
            }
            return Err(error);
        }
    };
    // Keep the same DB fences through the one external call. Neither native
    // rejection nor an HTTP timeout causes a new ID, turn or body replay.
    let outcome = match client.deliver(&state.http, &event, admitted).await {
        Delivery::Accepted => Some("ACCEPTED"),
        Delivery::Rejected(_) => Some("REJECTED"),
        Delivery::Limited(_, _) => Some("NOT_DELIVERED"),
        Delivery::Unknown(_) => None,
    };
    if let Some(outcome) = outcome {
        turn_audit(
            state,
            &mut guard,
            &ae,
            invocation.id,
            (&format!("reply:{event_id}:outcome"), "OUTCOME", outcome),
            evidence,
        )
        .await?;
    }
    guard.commit().await?;
    Ok(event_id)
}

fn definite_reply_refusal(error: &crate::governance::Refusal) -> bool {
    use crate::governance::Refusal;
    match error {
        Refusal::Denied(_)
        | Refusal::Blocked(_)
        | Refusal::Precondition(_)
        | Refusal::Limit(_)
        | Refusal::Conflict(_) => true,
        Refusal::Unavailable(_) => false,
    }
}

async fn record_reply_not_delivered(
    state: &ServiceState,
    invocation: &Invocation,
    ae: &crate::governance::Execution,
    turn: &str,
    event: &str,
    evidence: Vec<crate::audit::Evidence>,
) -> Result<(), crate::governance::Refusal> {
    let mut tx = state.pool.begin().await?;
    let current = crate::governance::lock_execution(&mut tx, ae.id).await?;
    if current.operation_id != ae.operation_id
        || current.tenant_id != invocation.tenant_id
        || current.workspace_id != Some(invocation.workspace_id)
        || current.parameter_hash != ae.parameter_hash
    {
        return Err(crate::governance::Refusal::Unavailable(
            "Reply intent 不可核验".into(),
        ));
    }
    let tenant: Option<Uuid> =
        sqlx::query_scalar("select id from identity.tenant where id=$1 for no key update")
            .bind(ae.tenant_id)
            .fetch_optional(&mut *tx)
            .await?;
    let exact: Option<Uuid> = sqlx::query_scalar(
        "select id from catalog.agent_invocation
        where id=$1 and action_execution_id=$2 and tenant_id=$3 and workspace_id=$4
          and runtime_turn_id=$5 and native_status='completed' and reply_event_id=$6
          and status in ('RUNNING','UNKNOWN') for update",
    )
    .bind(invocation.id)
    .bind(ae.id)
    .bind(ae.tenant_id)
    .bind(ae.workspace_id)
    .bind(turn)
    .bind(event)
    .fetch_optional(&mut *tx)
    .await?;
    if tenant != Some(ae.tenant_id) || exact != Some(invocation.id) {
        return Err(crate::governance::Refusal::Unavailable(
            "Reply intent 已漂移".into(),
        ));
    }
    turn_audit(
        state,
        &mut tx,
        &current,
        invocation.id,
        (
            &format!("reply:{event}:outcome"),
            "OUTCOME",
            "NOT_DELIVERED",
        ),
        evidence,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

#[derive(FromRow, PartialEq)]
struct ReplyIntent {
    dispatch_audit_id: Uuid,
    operation_id: Uuid,
    human_identity_id: Option<Uuid>,
    initiator_principal_id: Option<Uuid>,
    actor_principal_id: Uuid,
    action_key: String,
    action_version: i32,
    component_type_key: String,
    target_type: Option<String>,
    target_id: Option<Uuid>,
    parameter_hash: String,
    result_exposure: String,
    correlation_id: Uuid,
    evidence_refs: Value,
    agent_pubkey: String,
    channel_id: Uuid,
    delivery_outcome: Option<String>,
}

// Readback only: revoked identities/projections may still have an in-flight
// dispatch to observe. Neither an ACTIVE flag nor an arbitrary stored event ID
// grants a new publish; the original same-operation AGENT DISPATCH is required.
const REPLY_INTENT: &str = "select d.id as dispatch_audit_id,d.operation_id,d.human_identity_id,
    d.initiator_principal_id,d.actor_principal_id,d.action_key,d.action_version,
    d.component_type_key,d.target_type,d.target_id,d.parameter_hash,d.result_exposure,
    d.correlation_id,d.evidence_refs,b.pubkey as agent_pubkey,wb.channel_id,o.result_code as delivery_outcome
  from catalog.agent_invocation i
  join admission.action_execution ae on ae.id=i.action_execution_id
    and ae.tenant_id=i.tenant_id and ae.workspace_id=i.workspace_id
  join catalog.agent_installation a on a.resource_id=i.installation_resource_id
    and a.workspace_id=i.workspace_id and a.pinned_version_asset_id=i.agent_version_asset_id
  join catalog.resource r on r.id=a.resource_id and r.tenant_id=i.tenant_id
    and r.home_workspace_id=i.workspace_id and r.type_key='agent.installation'
  join catalog.agent_runtime_projection p on p.installation_resource_id=a.resource_id
    and p.generation=i.projection_generation and p.agent_version_asset_id=i.agent_version_asset_id
  join identity.principal agent on agent.id=a.agent_principal_id
    and agent.tenant_id=i.tenant_id and agent.kind='AGENT'
  join catalog.agent_memory_binding m on m.installation_resource_id=a.resource_id
  join identity.buzz_identity_binding b on b.pubkey=m.agent_buzz_identity_binding_id
    and b.principal_id=agent.id and b.tenant_id=i.tenant_id and b.kind='AGENT' and b.custody='SERVER'
  join catalog.channel_agent_binding cb on cb.installation_resource_id=a.resource_id
    and cb.workspace_id=i.workspace_id
  join projection.workspace_buzz_binding wb on wb.workspace_id=i.workspace_id
  join audit.audit_event d on d.operation_id=ae.operation_id
    and d.tenant_id=i.tenant_id and d.workspace_id=i.workspace_id
    and d.action_key=ae.action_key and d.action_version=ae.action_version
    and d.parameter_hash=ae.parameter_hash and d.actor_principal_id=agent.id
    and d.event_type='DISPATCH' and d.decision='ALLOW'
    and d.evidence_refs @> jsonb_build_array(
      jsonb_build_object('kind','BUZZ_EVENT_ID','value',i.reply_event_id),
      jsonb_build_object('kind','BUZZ_PUBKEY','value',b.pubkey),
      jsonb_build_object('kind','ACTION_EXECUTION_ID','value',ae.id::text))
  left join audit.audit_event o on o.event_key=ae.operation_id::text||':agent-turn:'||i.id::text||':reply:'||i.reply_event_id||':outcome'
    and o.operation_id=d.operation_id and o.tenant_id=d.tenant_id and o.workspace_id=d.workspace_id
    and o.actor_principal_id=d.actor_principal_id and o.action_key=d.action_key
    and o.action_version=d.action_version and o.parameter_hash=d.parameter_hash and o.event_type='OUTCOME'
    and o.evidence_refs @> jsonb_build_array(
      jsonb_build_object('kind','BUZZ_EVENT_ID','value',i.reply_event_id),
      jsonb_build_object('kind','ACTION_EXECUTION_ID','value',ae.id::text))
  where i.id=$1 and i.reply_event_id=$2 and i.runtime_turn_id=$3
    and i.native_status='completed' and i.status in ('RUNNING','UNKNOWN')";

/// Consume only an existing stable Reply intent. There is no publisher or
/// model replay here, and a missing event is never a terminal delivery result.
async fn reconcile_reply(
    state: &ServiceState,
    invocation: &Invocation,
    turn_id: &str,
    event_id: &str,
) -> Result<Option<bool>, sqlx::Error> {
    let intents: Vec<ReplyIntent> = sqlx::query_as(REPLY_INTENT)
        .bind(invocation.id)
        .bind(event_id)
        .bind(turn_id)
        .fetch_all(&state.pool)
        .await?;
    let [intent] = intents.as_slice() else {
        return Ok(None);
    };
    let Some(raw_refs) = intent.evidence_refs.as_array() else {
        return Ok(None);
    };
    let Some(evidence_refs) = raw_refs
        .iter()
        .map(crate::audit::Evidence::parse)
        .collect::<Option<Vec<_>>>()
    else {
        return Ok(None);
    };
    if matches!(
        intent.delivery_outcome.as_deref(),
        Some("REJECTED" | "NOT_DELIVERED")
    ) {
        return Ok(Some(false));
    }
    let Ok((control, _)) = crate::tenant_lifecycle::control_client(
        state,
        invocation.tenant_id,
        crate::tenant_lifecycle::ProjectionDirection::Withdraw,
    )
    .await
    else {
        return Ok(None);
    };
    let observed = control
        .channel_reply_exists(
            &state.http,
            event_id,
            &intent.agent_pubkey,
            &intent.channel_id.to_string(),
            (&invocation.root_event_id, &invocation.source_event_id),
        )
        .await;
    if !matches!(observed, Ok(true)) {
        // Native errors may include protocol bodies; don't copy them to logs.
        return Ok(None);
    }
    let mut tx = state.pool.begin().await?;
    let locked: Option<Uuid> = sqlx::query_scalar(
        "select id from catalog.agent_invocation where id=$1 and status in ('RUNNING','UNKNOWN')
         and native_status='completed' and runtime_turn_id=$2 and reply_event_id=$3 for update",
    )
    .bind(invocation.id)
    .bind(turn_id)
    .bind(event_id)
    .fetch_optional(&mut *tx)
    .await?;
    if locked.is_none() {
        return Ok(None);
    }
    let current: Vec<ReplyIntent> = sqlx::query_as(REPLY_INTENT)
        .bind(invocation.id)
        .bind(event_id)
        .bind(turn_id)
        .fetch_all(&mut *tx)
        .await?;
    if current.as_slice() != std::slice::from_ref(intent) {
        return Ok(None);
    }
    crate::audit::append(
        &mut tx,
        crate::audit::AuditEntry {
            event_key: format!(
                "agent.reply:{}:{}:{event_id}:observed",
                invocation.id, intent.dispatch_audit_id
            ),
            tenant_id: Some(invocation.tenant_id),
            workspace_id: Some(invocation.workspace_id),
            operation_id: intent.operation_id,
            event_type: "RECONCILIATION",
            human_identity_id: intent.human_identity_id,
            initiator_principal_id: intent.initiator_principal_id,
            actor_principal_id: Some(intent.actor_principal_id),
            action_key: &intent.action_key,
            action_version: intent.action_version,
            component_type_key: &intent.component_type_key,
            target_type: intent.target_type.as_deref(),
            target_id: intent.target_id,
            parameter_hash: &intent.parameter_hash,
            decision: "ALLOW",
            result_code: "ACCEPTED",
            result_exposure: &intent.result_exposure,
            evidence_refs,
            correlation_id: intent.correlation_id,
        },
    )
    .await?;
    tx.commit().await?;
    // Relay acceptance proves delivery, not Usage completeness or Invocation
    // business completion. The caller separately requires the committed set.
    Ok(Some(true))
}

/// A released holder and native terminal turn are necessary but not metering
/// proof. Finish only after the actual nonempty Gateway set and turn COUNT have
/// all reached OpenMeter stored_at, and persist those exact references atomically.
async fn finish_billed_turn(
    state: &ServiceState,
    invocation: &Invocation,
    turn: &str,
    native_status: &str,
    reply: Option<&str>,
    reply_delivered: Option<bool>,
) -> Response {
    let Some((status, wire_status)) = billed_outcome(
        native_status,
        reply,
        invocation.cancel_pending,
        reply_delivered,
    ) else {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    };
    let (ids, mut evidence) = match crate::gateway_usage::committed_turn(
        &state.pool,
        &state.openmeter,
        invocation.id,
        turn,
        native_status,
    )
    .await
    {
        Ok(Some(proof)) => proof,
        Ok(None) | Err(_) => {
            return release_holder(state, invocation.id, true, "BILLING_UNAVAILABLE").await;
        }
    };
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(error) => return unavailable(error),
    };
    let ae = match crate::governance::lock_execution(&mut tx, invocation.action_execution_id).await
    {
        Ok(ae) => ae,
        Err(_) => {
            return result(
                invocation.id,
                TaskStatus::Running,
                "UNKNOWN_EXTERNAL_RESULT",
            )
        }
    };
    // Cleanup does not grant a new execution after suspend/revoke. Preserve the
    // existing AE→Tenant→Invocation lock order without requiring ACTIVE now.
    let tenant: Option<Uuid> =
        match sqlx::query_scalar("select id from identity.tenant where id=$1 for no key update")
            .bind(ae.tenant_id)
            .fetch_optional(&mut *tx)
            .await
        {
            Ok(tenant) => tenant,
            Err(error) => return unavailable(error),
        };
    if tenant != Some(invocation.tenant_id)
        || ae.workspace_id != Some(invocation.workspace_id)
        || ae.temporal_workflow_id.as_deref() != Some(invocation.workflow_id.as_str())
    {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    }
    let Ok(event_count) = i64::try_from(ids.len()) else {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    };
    let settled: Option<bool> = match sqlx::query_scalar(
        "select l.state='RELEASED' and l.native_release_confirmed_at is not null
           and l.terminal_event_id is not null and l.terminal_event_at is not null
           and (select count(*) from outbox.usage_event u where u.invocation_id=i.id
             and u.operation_id=$7 and u.id=any($8::uuid[]) and u.settlement_status='COMMITTED'
             and u.stored_at is not null)=$9
           and not exists(select 1 from outbox.usage_event u where u.invocation_id=i.id
             and (u.operation_id<>$7 or not(u.id=any($8::uuid[]))))
         from catalog.agent_invocation i join admission.capacity_lease l on l.invocation_id=i.id
           and l.operation_id=$7 and l.tenant_id=i.tenant_id and l.workspace_id=i.workspace_id
           and l.workflow_id=i.workflow_id
         where i.id=$1 and i.action_execution_id=$2 and i.tenant_id=$3 and i.workspace_id=$4
           and i.status in ('RUNNING','UNKNOWN') and i.runtime_turn_id=$5 and i.native_status=$6
           and i.reply_event_id is not distinct from $10::text
           and ($6<>'completed' or $10::text is not null or i.cancel_pending)
           and ($11::boolean is distinct from false or exists(select 1 from audit.audit_event o
             where o.event_key=$7::text||':agent-turn:'||i.id::text||':reply:'||i.reply_event_id||':outcome'
               and o.operation_id=$7 and o.tenant_id=i.tenant_id and o.workspace_id=i.workspace_id
               and o.action_key=$12 and o.action_version=$13 and o.actor_principal_id=$14
               and o.parameter_hash=$15 and o.event_type='OUTCOME' and o.result_code in ('REJECTED','NOT_DELIVERED')
               and o.evidence_refs @> jsonb_build_array(
                 jsonb_build_object('kind','BUZZ_EVENT_ID','value',i.reply_event_id),
                 jsonb_build_object('kind','ACTION_EXECUTION_ID','value',i.action_execution_id::text))))
           for update of i,l",
    )
    .bind(invocation.id)
    .bind(ae.id)
    .bind(invocation.tenant_id)
    .bind(invocation.workspace_id)
    .bind(turn)
    .bind(native_status)
    .bind(ae.operation_id)
    .bind(&ids)
    .bind(event_count)
    .bind(reply)
    .bind(reply_delivered)
    .bind(&ae.action_key).bind(ae.action_version).bind(ae.actor_principal_id).bind(&ae.parameter_hash)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(settled) => settled,
        Err(error) => return unavailable(error),
    };
    if settled != Some(true) || ids.is_empty() {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    }
    let changed = match sqlx::query(
        "update catalog.agent_invocation set status=$2,observation_cursor=null,updated_at=now()
         where id=$1 and status in ('RUNNING','UNKNOWN') and runtime_turn_id=$3 and native_status=$4
           and reply_event_id is not distinct from $5::text",
    )
    .bind(invocation.id)
    .bind(wire_status)
    .bind(turn)
    .bind(native_status)
    .bind(reply)
    .execute(&mut *tx)
    .await
    {
        Ok(changed) => changed,
        Err(error) => return unavailable(error),
    };
    if changed.rows_affected() != 1 {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    }
    evidence.push(crate::audit::Evidence::new(
        EvidenceKind::ActionExecutionId,
        ae.id,
    ));
    evidence.push(crate::audit::Evidence::new(
        EvidenceKind::TemporalWorkflowId,
        &invocation.workflow_id,
    ));
    if let Some(reply) = reply {
        evidence.push(crate::audit::Evidence::new(
            EvidenceKind::BuzzEventId,
            reply,
        ));
    }
    if let Err(error) = turn_audit(
        state,
        &mut tx,
        &ae,
        invocation.id,
        (
            "check-usage-committed",
            "OUTCOME",
            if native_status == "completed" && wire_status == "FAILED" {
                "FAILED_REPLY_NOT_DELIVERED"
            } else {
                wire_status
            },
        ),
        evidence,
    )
    .await
    {
        return unavailable(error);
    }
    if tx.commit().await.is_err() {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    }
    // Task completion certifies execution/reply/CHECK usage; it is deliberately
    // not an OpenMeter invoice-finalized or credit-snapshot assertion.
    result(invocation.id, status, "NONE")
}

fn billed_outcome(
    native_status: &str,
    reply: Option<&str>,
    cancel_pending: bool,
    reply_delivered: Option<bool>,
) -> Option<(TaskStatus, &'static str)> {
    match native_status {
        "completed" if reply.is_some() && reply_delivered == Some(true) => {
            Some((TaskStatus::Completed, "COMPLETED"))
        }
        "completed" if reply.is_some() && reply_delivered == Some(false) => {
            Some((TaskStatus::Failed, "FAILED"))
        }
        "completed" if reply.is_none() && cancel_pending => Some((TaskStatus::Failed, "FAILED")),
        "failed" if reply.is_none() => Some((TaskStatus::Failed, "FAILED")),
        "interrupted" if reply.is_none() => Some((TaskStatus::Canceled, "CANCELED")),
        _ => None,
    }
}

async fn release_holder(state: &ServiceState, id: Uuid, released: bool, waiting: &str) -> Response {
    let finish_activity = if released {
        true
    } else {
        match state.capacity.begin_release(&state.pool, id).await {
            Ok(confirmed) => confirmed,
            Err(error) => {
                tracing::warn!(invocation_id=%id, error=%error, "Capacity native release 尚不可核证");
                false
            }
        }
    };
    // 只结束当前持有 Activity，不伪造 Invocation、用量或 Reply 的业务终态。
    (
        StatusCode::OK,
        Json(AgentTaskAdvanceResult {
            invocation_id: id.to_string(),
            status: TaskStatus::Running,
            waiting_reason: if finish_activity {
                waiting
            } else {
                "CAPACITY_RELEASE_UNCONFIRMED"
            }
            .to_owned(),
            finish_activity,
        }),
    )
        .into_response()
}

fn result(id: Uuid, status: TaskStatus, waiting: &str) -> Response {
    let finish_activity = matches!(
        status,
        TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Canceled
    );
    (
        StatusCode::OK,
        Json(AgentTaskAdvanceResult {
            invocation_id: id.to_string(),
            status,
            waiting_reason: waiting.to_owned(),
            finish_activity,
        }),
    )
        .into_response()
}

#[cfg(test)]
mod reply_tests {
    use super::{billed_outcome, definite_reply_refusal, native_reply};
    use serde_json::json;

    #[test]
    fn revoked_completed_turn_requires_delivery_or_exact_rejection_proof() {
        assert_eq!(
            billed_outcome("completed", None, true, None),
            Some((contracts::TaskStatus::Failed, "FAILED"))
        );
        assert!(billed_outcome("completed", None, false, None).is_none());
        // An already-issued reply is observed/settled, never erased or resent.
        assert_eq!(
            billed_outcome("completed", Some("original-event"), true, Some(true)),
            Some((contracts::TaskStatus::Completed, "COMPLETED"))
        );
        assert_eq!(
            billed_outcome("completed", Some("original-event"), true, Some(false)),
            Some((contracts::TaskStatus::Failed, "FAILED"))
        );
        assert_eq!(
            billed_outcome("completed", Some("original-event"), false, Some(false)),
            Some((contracts::TaskStatus::Failed, "FAILED"))
        );
        assert!(billed_outcome("completed", Some("original-event"), true, None).is_none());
        for status in ["inProgress", "future-status", "UNKNOWN"] {
            assert!(billed_outcome(status, None, true, None).is_none());
        }
        assert_eq!(
            billed_outcome("interrupted", None, true, None),
            Some((contracts::TaskStatus::Canceled, "CANCELED"))
        );
    }

    #[test]
    fn dependency_uncertainty_is_not_a_pre_delivery_rejection() {
        use crate::governance::Refusal;
        use contracts::ReasonCode;
        for refusal in [
            Refusal::Denied(ReasonCode::ScopeGuardFailed),
            Refusal::Precondition(ReasonCode::TargetStateConflict),
        ] {
            assert!(definite_reply_refusal(&refusal));
        }
        assert!(!definite_reply_refusal(&Refusal::Unavailable(
            "read unknown".into()
        )));
    }

    // 实现后的原生协议断言，无 Tenant/Installation/DB 或执行入口夹具。
    #[test]
    fn completed_reply_requires_full_final_and_native_completion_time() {
        let mut turn = json!({"status":"completed","itemsView":"full","error":null,
            "startedAt":100,"completedAt":105,"items":[
                {"type":"agentMessage","id":"note","phase":"commentary","text":"working"},
                {"type":"agentMessage","id":"answer","phase":"final_answer","text":"native answer"}]});
        assert_eq!(native_reply(&turn), Some(("native answer", 105)));
        for status in ["inProgress", "failed", "interrupted", "futureStatus"] {
            turn["status"] = json!(status);
            assert!(native_reply(&turn).is_none());
        }
        turn["status"] = json!("completed");
        for view in ["summary", "notLoaded", "futureView"] {
            turn["itemsView"] = json!(view);
            assert!(native_reply(&turn).is_none());
        }
        turn["itemsView"] = json!("full");
        for time in [
            json!(null),
            json!(0),
            json!(99),
            json!("105"),
            json!(i64::MAX),
        ] {
            turn["completedAt"] = time;
            assert!(native_reply(&turn).is_none());
        }
        turn["completedAt"] = json!(105);
        turn.as_object_mut().unwrap().remove("completedAt");
        assert!(native_reply(&turn).is_none());
    }

    #[test]
    fn completed_reply_rejects_unknown_or_missing_phase_even_alongside_final() {
        let mut turn = json!({"status":"completed","itemsView":"full","startedAt":100,
            "completedAt":105,"items":[
                {"type":"agentMessage","id":"note","phase":"commentary","text":"working"},
                {"type":"agentMessage","id":"answer","phase":"final_answer","text":"native answer"}]});
        for phase in [json!("future_phase"), json!(null), json!(7)] {
            turn["items"][0]["phase"] = phase;
            assert!(native_reply(&turn).is_none());
        }
        turn["items"][0].as_object_mut().unwrap().remove("phase");
        assert!(native_reply(&turn).is_none());
        turn["items"][0]["phase"] = json!("final_answer");
        assert!(native_reply(&turn).is_none());
    }

    #[test]
    fn completed_reply_rejects_async_delivery_questions_and_empty_answer() {
        let mut turn = json!({"status":"completed","itemsView":"full","startedAt":100,
            "completedAt":105,"items":[
                {"type":"agentMessage","id":"answer","phase":"final_answer","text":"native answer"}]});
        for delivery in [json!("async"), json!("futureDelivery")] {
            turn["items"][0]["delivery"] = delivery;
            assert!(native_reply(&turn).is_none());
        }
        turn["items"][0]["delivery"] = json!(null);
        for questions in [json!([]), json!([{"title":"choose"}])] {
            turn["items"][0]["questions"] = questions;
            assert!(native_reply(&turn).is_none());
        }
        turn["items"][0]["questions"] = json!(null);
        turn["items"][0]["text"] = json!(" ");
        assert!(native_reply(&turn).is_none());
        turn["items"][0]["text"] = json!("native answer");
        turn["items"][0]["id"] = json!("");
        assert!(native_reply(&turn).is_none());
    }
}
