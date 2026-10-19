//! DD-125(6)、05 §2.11、17 §10：原版 Agent 的停止 / 从频道移除 / 删除与启动在 Kailo
//! 的受治理映射。停止、移除与删除都是 `agent.installation.disable`，启动是
//! `agent.installation.enable`，重启是同版本 `agent.installation.upgrade`（DD-122(4)），
//! 不另设动作键，也不提供 Installation 物理删除。
//!
//! 两个动作沿用既有 AGENT_INSTALLATION ComponentTaskWorkflow 与同一 advance 入口：
//! Workflow 只携带冻结引用，终态以 Core 回读到的事实为准。
//!
//! - **停用**：准入事务内把 Installation 移出 ACTIVE（DRAINING，回合准入随之关闭；
//!   `catalog.agent_generation_admitted` 只为排空中的在途回合保留读取），并给全部未终结
//!   Invocation 写入不可撤回的取消意图。排空后依次撤 Tool 投影（DD-122(7)）、退役当前
//!   generation 的模型凭据、停止运行体、以 CONTROL 9001 移出 Channel roster，最后把投影
//!   置 REVOKED、Installation 置 DISABLED。Resource、AgentPrincipal、AGENT 身份、记忆
//!   binding、kind:0 与全部历史保留。
//! - **启用**：只接受 DISABLED 且固定 Version 仍 PUBLISHED。准入事务内为固定 Version
//!   建立新的 PENDING generation；Workflow 先以 CONTROL 恢复 Channel roster，再交给原
//!   readiness 消费者完成模型凭据、DD-122(3) Tool 重新授予与激活。

use axum::response::Response;
use collab_bridge::bridge::{Presence, Scope};
use contracts::{EvidenceKind, ReasonCode, TaskStatus};
use sqlx::{FromRow, PgConnection, Postgres, Transaction};
use uuid::Uuid;

use super::{creation_result, initialize, insert_pending_generation, invalid, projection_audit};
use crate::audit::Evidence;
use crate::governance::{Definition, Execution, Governance, Params, Refusal, Target};
use crate::service_api::ServiceState;
use crate::tenant_lifecycle::{control_client, ProjectionDirection};

pub(crate) const DISABLE_ACTION: &str = "agent.installation.disable";
pub(crate) const ENABLE_ACTION: &str = "agent.installation.enable";

pub(crate) fn is_lifecycle(key: &str) -> bool {
    matches!(key, DISABLE_ACTION | ENABLE_ACTION)
}

/// 05 §2.11 两行的唯一合法登记：Installation `manage`、TARGET_HOME_WORKSPACE、EXPLICIT、
/// 无审批、TEMPORAL 的 AGENT_INSTALLATION，额度与容量 NONE。
fn definition_matches(def: &Definition) -> bool {
    is_lifecycle(&def.action_key)
        && def.target_type == "RESOURCE"
        && def.tenant_rule == "SESSION_TENANT"
        && def.workspace_rule == "TARGET_HOME_WORKSPACE"
        && def.permission_object_type == "resource"
        && def.permission == "manage"
        && def.execution_mode == "TEMPORAL"
        && def.workflow_kind.as_deref() == Some(super::KIND)
        && def.confirmation_mode == "EXPLICIT"
        && def.approval_policy_id.is_none()
        && def.approval_policy_version.is_none()
        && def.quota_policy == "NONE"
        && def.meters.is_empty()
}

fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}

#[derive(FromRow)]
struct LifecycleRow {
    version: i32,
    workspace_id: Uuid,
    agent_resource_id: Uuid,
    pinned_version_asset_id: Uuid,
    state: String,
    active_projection_generation: Option<i64>,
    projection_action_execution_id: Option<Uuid>,
}

const LIFECYCLE_ROW: &str = "select r.version,i.workspace_id,i.agent_resource_id,
    i.pinned_version_asset_id,i.state,i.active_projection_generation,
    r.projection_action_execution_id
    from catalog.agent_installation i join catalog.resource r on r.id=i.resource_id
    join identity.workspace w on w.id=i.workspace_id and w.tenant_id=r.tenant_id
    join identity.tenant t on t.id=r.tenant_id
    where r.id=$1 and r.tenant_id=$2 and r.type_key='agent.installation'
      and r.home_workspace_id=i.workspace_id and r.state='ACTIVE'
      and w.state='ACTIVE' and t.state='ACTIVE'";

/// The lifecycle command only names the Installation and the version it read;
/// the home Workspace is resolved from Core facts (TARGET_HOME_WORKSPACE).
pub(crate) async fn target(
    conn: &mut PgConnection,
    tenant: Uuid,
    def: &Definition,
    params: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    if !definition_matches(def) {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let id = params.resource_id.ok_or_else(invalid)?;
    if frozen.is_some_and(|frozen| frozen != id) {
        return Err(conflict());
    }
    let row: LifecycleRow = sqlx::query_as(&format!(
        "{LIFECYCLE_ROW}{}",
        if lock { " for update of r,i" } else { "" }
    ))
    .bind(id)
    .bind(tenant)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(conflict)?;
    if params.resource_version != Some(row.version) || row.projection_action_execution_id.is_some()
    {
        return Err(conflict());
    }
    let ready = if def.action_key == DISABLE_ACTION {
        row.state == "ACTIVE" && row.active_projection_generation.is_some()
    } else {
        row.state == "DISABLED" && pinned_published(conn, tenant, &row, lock).await?
    };
    if !ready {
        return Err(conflict());
    }
    Ok(Target {
        id,
        version: row.version,
        workspace_id: Some(row.workspace_id),
    })
}

/// 17 §10: enable only re-projects the Installation's own pinned Version, and
/// only while that Version is still PUBLISHED under an ACTIVE Definition.
async fn pinned_published(
    conn: &mut PgConnection,
    tenant: Uuid,
    row: &LifecycleRow,
    lock: bool,
) -> Result<bool, Refusal> {
    let definition = crate::agent_definition::resource(conn, tenant, row.agent_resource_id, lock)
        .await?
        .filter(|r| r.state == "ACTIVE" && r.projection_action_execution_id.is_none());
    let Some(definition) = definition else {
        return Ok(false);
    };
    let definition_active: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.agent_definition
        where resource_id=$1 and status='ACTIVE')",
    )
    .bind(definition.id)
    .fetch_one(&mut *conn)
    .await?;
    let version = crate::agent_version::version(conn, tenant, row.pinned_version_asset_id, lock)
        .await?
        .filter(|v| {
            v.agent_resource_id == definition.id
                && v.state == "PUBLISHED"
                && v.asset_state == "PUBLISHED"
                && v.projection_action_execution_id.is_none()
        });
    Ok(definition_active && version.is_some())
}

/// Evaluate's Resource projection evidence: the frozen version, home Workspace,
/// an active HUMAN owner and the SpiceDB Resource projection all agree.
pub(crate) async fn projection_current(
    gov: &Governance,
    tenant: Uuid,
    target: &Target,
) -> Result<bool, Refusal> {
    let mut conn = gov.pool.acquire().await?;
    let owner: Option<Uuid> = sqlx::query_scalar(
        "select r.owner_principal_id from catalog.resource r
        join catalog.agent_installation i on i.resource_id=r.id
        join identity.principal owner on owner.id=r.owner_principal_id
          and owner.tenant_id=r.tenant_id and owner.kind='HUMAN' and owner.status='ACTIVE'
        join identity.tenant_membership tm on tm.tenant_principal_id=owner.id
          and tm.tenant_id=r.tenant_id and tm.state='ACTIVE'
        where r.id=$1 and r.tenant_id=$2 and r.type_key='agent.installation'
          and r.state='ACTIVE' and r.version=$3 and r.home_workspace_id=$4
          and i.workspace_id=$4",
    )
    .bind(target.id)
    .bind(tenant)
    .bind(target.version)
    .bind(target.workspace_id)
    .fetch_optional(&mut *conn)
    .await?;
    drop(conn);
    let Some(owner) = owner else {
        return Ok(false);
    };
    let workspace = target.workspace_id.map(|id| id.to_string());
    gov.spicedb
        .resource_projection_matches_in_workspace(
            &target.id.to_string(),
            &tenant.to_string(),
            &owner.to_string(),
            workspace.as_deref(),
            gov.cfg.relationship_page,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Installation 授权投影不可核验".into()))
}

/// Called inside the admission transaction after the fresh locked evaluation.
/// Returns the advanced Resource version that names the Workflow.
pub(crate) async fn prewrite(
    gov: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    params: &Params,
) -> Result<i32, Refusal> {
    let installation = params.resource_id.ok_or_else(invalid)?;
    let workspace = ae.workspace_id.ok_or_else(invalid)?;
    if installation != ae.target_id || !is_lifecycle(&ae.action_key) {
        return Err(conflict());
    }
    let version: i32 = sqlx::query_scalar(
        "update catalog.resource set version=version+1,projection_action_execution_id=$2
        where id=$1 and tenant_id=$3 and home_workspace_id=$4 and state='ACTIVE'
          and version=$5 and projection_action_execution_id is null returning version",
    )
    .bind(installation)
    .bind(ae.id)
    .bind(ae.tenant_id)
    .bind(workspace)
    .bind(params.resource_version)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(conflict)?;
    if ae.action_key == DISABLE_ACTION {
        // 先关门：离开 ACTIVE 后提及、指派与 Automation 都不再准入新回合；在途回合只在
        // 排空期间按冻结 generation 继续被观察与中断。
        let changed = sqlx::query(
            "update catalog.agent_installation set state='DRAINING'
            where resource_id=$1 and workspace_id=$2 and state='ACTIVE'
              and active_projection_generation is not null",
        )
        .bind(installation)
        .bind(workspace)
        .execute(&mut **tx)
        .await?;
        if changed.rows_affected() != 1 {
            return Err(conflict());
        }
        // 05 §2.11「取消等待」：该 Installation 的全部未终结 Invocation 收到同一不可撤回
        // 的取消意图；native 中断、用量与终态仍由原 AgentTask 链确认。
        sqlx::query(
            "update catalog.agent_invocation set cancel_pending=true,updated_at=now()
            where installation_resource_id=$1 and workspace_id=$2
              and status in ('CREATED','DISPATCHING','RUNNING','UNKNOWN') and not cancel_pending",
        )
        .bind(installation)
        .bind(workspace)
        .execute(&mut **tx)
        .await?;
        return Ok(version);
    }
    let pinned: Uuid = sqlx::query_scalar(
        "select pinned_version_asset_id from catalog.agent_installation
        where resource_id=$1 and workspace_id=$2 and state='DISABLED' for update",
    )
    .bind(installation)
    .bind(workspace)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(conflict)?;
    // 重新投影固定 Version 与 upgrade/create 同样要求发起人能 consume 该 Version。
    super::check(gov, ae.initiator_principal_id, "asset", pinned, "consume").await?;
    let pinned_version = crate::agent_version::version(tx, ae.tenant_id, pinned, true)
        .await?
        .filter(|v| {
            v.state == "PUBLISHED"
                && v.asset_state == "PUBLISHED"
                && v.projection_action_execution_id.is_none()
        })
        .ok_or_else(conflict)?;
    let (content, requested) =
        super::version_content(tx, ae.tenant_id, workspace, &pinned_version).await?;
    let generation: i64 = sqlx::query_scalar(
        "select coalesce(max(generation),0)+1 from catalog.agent_runtime_projection
        where installation_resource_id=$1",
    )
    .bind(installation)
    .fetch_one(&mut **tx)
    .await?;
    insert_pending_generation(gov, tx, ae, &content, &requested, pinned, generation).await?;
    Ok(version)
}

/// The Version an admitted enable re-projects: the DISABLED Installation's pin.
pub(super) async fn enabling_version(
    state: &ServiceState,
    installation: Uuid,
    workspace: Uuid,
) -> Result<Uuid, Refusal> {
    sqlx::query_scalar(
        "select pinned_version_asset_id from catalog.agent_installation
        where resource_id=$1 and workspace_id=$2 and state='DISABLED'",
    )
    .bind(installation)
    .bind(workspace)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(conflict)
}

/// The Workflow start target of an admitted lifecycle action: disable carries
/// the draining generation, enable the new PENDING generation of the pin.
pub(crate) const START_TARGET: &str = "select i.resource_id,p.agent_version_asset_id,p.generation,
    (ae.parameters->'params'->>'resourceVersion')::int+1
    from catalog.agent_installation i join catalog.resource r on r.id=i.resource_id
    join admission.action_execution ae on ae.id=r.projection_action_execution_id
    join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
      and p.agent_version_asset_id=i.pinned_version_asset_id
      and ((ae.action_key='agent.installation.disable' and i.state='DRAINING'
          and p.generation=i.active_projection_generation and p.state='ACTIVE')
        or (ae.action_key='agent.installation.enable' and i.state='DISABLED'
          and p.state='PENDING'))
    where ae.id=$1 and ae.tenant_id=$2 and ae.target_id=i.resource_id
      and ae.workspace_id=i.workspace_id and ae.gate_state='ALLOWED'
      and ae.dispatch_state in ('NOT_DISPATCHED','UNKNOWN','DISPATCHED')
      and r.state='ACTIVE' and r.tenant_id=ae.tenant_id and ae.temporal_workflow_id=$3";

/// One Worker round of an admitted lifecycle action. HTTP success is not the
/// terminal: COMPLETED only after the target facts were written and read back.
pub(super) async fn advance(
    state: &ServiceState,
    ae: &Execution,
    installation: Uuid,
    version: Uuid,
    generation: i64,
) -> Response {
    let outcome = if ae.action_key == DISABLE_ACTION {
        advance_disable(state, ae, installation, version, generation).await
    } else {
        advance_enable(state, ae, installation, version, generation).await
    };
    match outcome {
        Ok(()) => creation_result(installation, TaskStatus::Completed, "NONE"),
        Err(refusal) => {
            tracing::warn!(installation=%installation,action=%ae.id,action_key=%ae.action_key,
                kind=super::refusal_kind(&refusal),reason=?refusal.reason(),
                "Installation lifecycle 对账未闭合");
            creation_result(installation, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT")
        }
    }
}

async fn recorded(state: &ServiceState, ae: &Execution, phase: &str) -> Result<bool, Refusal> {
    Ok(sqlx::query_scalar(
        "select exists(select 1 from audit.audit_event where event_key=$1 and tenant_id=$2)",
    )
    .bind(format!("{}:installation:{phase}", ae.id))
    .bind(ae.tenant_id)
    .fetch_one(&state.pool)
    .await?)
}

async fn record(
    state: &ServiceState,
    ae: &Execution,
    def: &Definition,
    phase: &str,
    result: &str,
    evidence: Vec<Evidence>,
) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    projection_audit(&mut tx, ae, def, phase, result, evidence).await?;
    tx.commit().await?;
    Ok(())
}

#[derive(FromRow)]
struct Identity {
    tenant_id: Uuid,
    workspace_id: Uuid,
    agent_pubkey: String,
    channel_id: Uuid,
}

/// The Installation's own AGENT pubkey (kept through disable) and Channel.
const IDENTITY: &str = "select r.tenant_id,i.workspace_id,a.pubkey as agent_pubkey,wb.channel_id
    from catalog.agent_installation i join catalog.resource r on r.id=i.resource_id
    join catalog.agent_memory_binding m on m.installation_resource_id=i.resource_id
    join identity.buzz_identity_binding a on a.pubkey=m.agent_buzz_identity_binding_id
      and a.principal_id=i.agent_principal_id and a.tenant_id=r.tenant_id
      and a.kind='AGENT' and a.custody='SERVER'
    join projection.workspace_buzz_binding wb on wb.workspace_id=i.workspace_id
      and wb.state='ACTIVE'
    where i.resource_id=$1";

async fn identity(state: &ServiceState, installation: Uuid) -> Result<Identity, Refusal> {
    sqlx::query_as(IDENTITY)
        .bind(installation)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(Refusal::Unavailable(
            "Installation AGENT 身份或 Channel 投影未就绪".into(),
        ))
}

async fn advance_disable(
    state: &ServiceState,
    ae: &Execution,
    installation: Uuid,
    version: Uuid,
    generation: i64,
) -> Result<(), Refusal> {
    if recorded(state, ae, "disabled").await? {
        return Ok(());
    }
    let drained: Option<bool> = sqlx::query_scalar(
        "select catalog.agent_installation_drained(i.resource_id)
        from catalog.agent_installation i join catalog.resource r on r.id=i.resource_id
        where i.resource_id=$1 and i.state='DRAINING' and r.state='ACTIVE'
          and r.projection_action_execution_id=$2 and i.pinned_version_asset_id=$3
          and i.active_projection_generation=$4",
    )
    .bind(installation)
    .bind(ae.id)
    .bind(version)
    .bind(generation)
    .fetch_optional(&state.pool)
    .await?;
    let Some(drained) = drained else {
        return Err(conflict());
    };
    if !drained {
        return Err(Refusal::Unavailable("Installation 在途回合尚未排空".into()));
    }
    let def =
        crate::governance::exact_definition(&state.pool, &ae.action_key, ae.action_version).await?;
    if !definition_matches(&def) {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let who = identity(state, installation).await?;
    let pubkey = Evidence::new(EvidenceKind::BuzzPubkey, &who.agent_pubkey);
    // 排空后不再有可观察的回合：ChannelAgentBinding 停用，Channel 不再发现或触发。
    let mut tx = state.pool.begin().await?;
    sqlx::query(
        "update catalog.channel_agent_binding set status='DISABLED'
        where installation_resource_id=$1 and workspace_id=$2 and status<>'DISABLED'",
    )
    .bind(installation)
    .bind(who.workspace_id)
    .execute(&mut *tx)
    .await?;
    projection_audit(
        &mut tx,
        ae,
        &def,
        "drained",
        "INSTALLATION_DRAINED",
        Vec::new(),
    )
    .await?;
    tx.commit().await?;
    // DD-122(7)：Agent 在全部 generation 工具上的关系与自身 Installation 的 reader 删除并复读。
    crate::agent_tool::retire_installation(state, installation, ae.id).await?;
    record(
        state,
        ae,
        &def,
        "tools",
        "INSTALLATION_TOOLS_REVOKED",
        Vec::new(),
    )
    .await?;
    crate::model_route::retire_disabled_generation(state, installation, ae.id).await?;
    record(
        state,
        ae,
        &def,
        "model",
        "INSTALLATION_MODEL_REVOKED",
        Vec::new(),
    )
    .await?;
    if let Some(runtime) = &state.agent_runtime {
        runtime
            .stop(installation)
            .await
            .map_err(|_| Refusal::Unavailable("Installation 运行体退出尚未查证".into()))?;
    }
    let (control, _) = control_client(state, who.tenant_id, ProjectionDirection::Withdraw)
        .await
        .map_err(|_| Refusal::Unavailable("Installation CONTROL binding 未就绪".into()))?;
    control
        .converge(
            &state.http,
            Scope::Channel(&who.channel_id.to_string()),
            &who.agent_pubkey,
            Presence::Absent,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Installation Channel roster 移出结果不明".into()))?;
    record(
        state,
        ae,
        &def,
        "roster",
        "INSTALLATION_ROSTER_WITHDRAWN",
        vec![pubkey.clone()],
    )
    .await?;
    let mut tx = state.pool.begin().await?;
    let locked = crate::governance::lock_execution(&mut tx, ae.id).await?;
    if locked.gate_state != "ALLOWED" || locked.target_id != installation {
        return Err(conflict());
    }
    sqlx::query(
        "update catalog.agent_runtime_projection set state='REVOKED'
        where installation_resource_id=$1 and state='ACTIVE'",
    )
    .bind(installation)
    .execute(&mut *tx)
    .await?;
    let changed = sqlx::query(
        "update catalog.agent_installation set state='DISABLED'
        where resource_id=$1 and state='DRAINING'
          and catalog.agent_installation_drained(resource_id)",
    )
    .bind(installation)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(conflict());
    }
    let changed = sqlx::query(
        "update catalog.resource set version=version+1,projection_action_execution_id=null
        where id=$1 and tenant_id=$2 and state='ACTIVE' and projection_action_execution_id=$3",
    )
    .bind(installation)
    .bind(who.tenant_id)
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(conflict());
    }
    projection_audit(
        &mut tx,
        &locked,
        &def,
        "disabled",
        "INSTALLATION_DISABLED",
        vec![pubkey],
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

async fn advance_enable(
    state: &ServiceState,
    ae: &Execution,
    installation: Uuid,
    version: Uuid,
    generation: i64,
) -> Result<(), Refusal> {
    // The original activation writes `<ae>:installation:ready` in its commit.
    if recorded(state, ae, "ready").await? {
        return Ok(());
    }
    let pending: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.agent_installation i
        join catalog.resource r on r.id=i.resource_id
        join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
          and p.generation=$4 and p.agent_version_asset_id=$3 and p.state='PENDING'
        where i.resource_id=$1 and i.state='DISABLED' and r.state='ACTIVE'
          and r.projection_action_execution_id=$2 and i.pinned_version_asset_id=$3)",
    )
    .bind(installation)
    .bind(ae.id)
    .bind(version)
    .bind(generation)
    .fetch_one(&state.pool)
    .await?;
    if !pending {
        return Err(conflict());
    }
    let def =
        crate::governance::exact_definition(&state.pool, &ae.action_key, ae.action_version).await?;
    if !definition_matches(&def) {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let who = identity(state, installation).await?;
    // The runtime readiness consumer requires the AGENT in both rosters; restore
    // the Channel roster that disable withdrew before reusing it.
    let (control, _) = control_client(state, who.tenant_id, ProjectionDirection::Establish)
        .await
        .map_err(|_| Refusal::Unavailable("Installation CONTROL binding 未就绪".into()))?;
    let channel = who.channel_id.to_string();
    for scope in [Scope::Relay, Scope::Channel(&channel)] {
        control
            .converge(&state.http, scope, &who.agent_pubkey, Presence::Present)
            .await
            .map_err(|_| Refusal::Unavailable("Installation roster 恢复结果不明".into()))?;
    }
    record(
        state,
        ae,
        &def,
        "roster",
        "INSTALLATION_IDENTITY_PROJECTED",
        vec![Evidence::new(EvidenceKind::BuzzPubkey, &who.agent_pubkey)],
    )
    .await?;
    match initialize(state, installation, version, generation, true).await {
        Ok(()) => {
            // DD-117(4): the same reconciliation decides whether the pinned
            // Version's profile still needs a kind:0 for this AGENT key.
            let profile_state = state.clone();
            tokio::spawn(async move {
                crate::agent_profile::project_installation(&profile_state, installation).await;
            });
            Ok(())
        }
        Err(stalled) => {
            tracing::warn!(installation=%installation,action=%ae.id,generation,
                step=stalled.step,kind=super::refusal_kind(&stalled.refusal),
                reason=?stalled.refusal.reason(),"Installation enable readiness 未闭合");
            Err(stalled.refusal)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn definition(action_key: &str) -> Definition {
        Definition {
            action_key: action_key.into(),
            version: 1,
            component_type_key: "core".into(),
            target_type: "RESOURCE".into(),
            tenant_rule: "SESSION_TENANT".into(),
            workspace_rule: "TARGET_HOME_WORKSPACE".into(),
            permission: "manage".into(),
            permission_object_type: "resource".into(),
            confirmation_mode: "EXPLICIT".into(),
            approval_policy_id: None,
            approval_policy_version: None,
            workflow_kind: Some("AGENT_INSTALLATION".into()),
            result_exposure: "NONE".into(),
            execution_mode: "TEMPORAL".into(),
            quota_policy: "NONE".into(),
            meters: Vec::new(),
            role_template_key: None,
            role_template_version: None,
        }
    }

    #[test]
    fn only_the_two_lifecycle_keys_are_lifecycle_actions() {
        assert!(is_lifecycle(DISABLE_ACTION));
        assert!(is_lifecycle(ENABLE_ACTION));
        for key in [
            "agent.installation.create",
            "agent.installation.upgrade",
            "agent.installation.delete",
            "agent.installation.restart",
            "agent.installation.disable.v2",
        ] {
            assert!(!is_lifecycle(key), "{key}");
        }
    }

    #[test]
    fn registration_must_match_the_05_policy_row_exactly() {
        for key in [DISABLE_ACTION, ENABLE_ACTION] {
            assert!(definition_matches(&definition(key)), "{key}");
        }
        let mut def = definition(DISABLE_ACTION);
        def.permission = "execute".into();
        assert!(!definition_matches(&def));
        let mut def = definition(DISABLE_ACTION);
        def.confirmation_mode = "APPROVAL".into();
        assert!(!definition_matches(&def));
        let mut def = definition(ENABLE_ACTION);
        def.workspace_rule = "WORKSPACE_REQUIRED".into();
        assert!(!definition_matches(&def));
        let mut def = definition(ENABLE_ACTION);
        def.workflow_kind = None;
        assert!(!definition_matches(&def));
        let mut def = definition(ENABLE_ACTION);
        def.meters = vec!["agent.turn".into()];
        assert!(!definition_matches(&def));
        assert!(!definition_matches(&definition("agent.installation.upgrade")));
    }

    #[tokio::test]
    #[ignore = "requires AGENT_INVOKE_TEST_DATABASE_URL pointing at a disposable migrated database"]
    async fn disable_drain_keeps_only_in_flight_reads_and_disabled_admits_nothing() {
        let pool = sqlx::PgPool::connect(&std::env::var("AGENT_INVOKE_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        sqlx::raw_sql(r#"DO $$
        DECLARE
          tenant uuid:=gen_random_uuid(); workspace uuid:=gen_random_uuid();
          human uuid:=gen_random_uuid(); human_identity uuid:=gen_random_uuid(); agent uuid:=gen_random_uuid();
          definition uuid:=gen_random_uuid(); installation uuid:=gen_random_uuid(); route uuid:=gen_random_uuid();
          version uuid:=gen_random_uuid(); disable_action uuid:=gen_random_uuid(); enable_action uuid:=gen_random_uuid();
        BEGIN
          INSERT INTO identity.tenant(id,slug,name,state) VALUES(tenant,tenant::text,'lifecycle fixture','ACTIVE');
          INSERT INTO identity.workspace(id,tenant_id,slug,name,state) VALUES(workspace,tenant,workspace::text,'lifecycle fixture','ACTIVE');
          INSERT INTO identity.principal(id,tenant_id,kind,status) VALUES(human,tenant,'HUMAN','ACTIVE'),(agent,tenant,'AGENT','ACTIVE');
          INSERT INTO identity.human_identity(id,display_name,status) VALUES(human_identity,'lifecycle fixture','ACTIVE');
          INSERT INTO identity.tenant_membership(id,tenant_id,human_identity_id,tenant_principal_id,state) VALUES(gen_random_uuid(),tenant,human_identity,human,'ACTIVE');
          INSERT INTO catalog.resource(id,tenant_id,type_key,home_workspace_id,owner_principal_id,component_type_key,native_id,state,version) VALUES
            (definition,tenant,'agent.definition',NULL,human,'core',definition::text,'PROVISIONING',1),
            (route,tenant,'llm_route',workspace,human,'core',route::text,'PROVISIONING',1),
            (installation,tenant,'agent.installation',workspace,human,'core',installation::text,'PROVISIONING',1);
          INSERT INTO catalog.agent_definition(resource_id,stable_slug,display_name,status) VALUES(definition,definition::text,'lifecycle fixture','PROVISIONING');
          INSERT INTO catalog.asset(id,tenant_id,resource_id,type_key,owner_principal_id,native_ref,state,version) VALUES
            (version,tenant,definition,'agent.version',human,version::text,'DRAFT',1);
          INSERT INTO catalog.agent_version(asset_id,agent_resource_id,ordinal,content,config_hash,state) VALUES
            (version,definition,1,jsonb_build_object('runtimeProfileKey','fixture','modelRouteResourceId',route),repeat('a',64),'DRAFT');
          INSERT INTO catalog.agent_installation(resource_id,workspace_id,agent_resource_id,pinned_version_asset_id,agent_principal_id,runtime_isolation_ref,state)
            VALUES(installation,workspace,definition,version,agent,'fixture:'||installation,'PROVISIONING');
          INSERT INTO catalog.agent_runtime_projection(installation_resource_id,generation,agent_version_asset_id,runtime_profile_key,model_route_resource_id,gateway_resource_ids,effective_fields,config_hash,state) VALUES
            (installation,1,version,'fixture',route,ARRAY[route],jsonb_build_array(jsonb_build_object('fieldKey','runtimeProfileKey','requestedValueHash',repeat('a',64),'effectiveValueHash',repeat('a',64),'reasonCode',NULL)),repeat('a',64),'ACTIVE');
          UPDATE catalog.agent_installation SET state='ACTIVE',active_projection_generation=1 WHERE resource_id=installation;
          UPDATE catalog.resource SET state='ACTIVE' WHERE id=installation;
          IF NOT catalog.agent_generation_admitted(installation,version,1) THEN RAISE EXCEPTION 'ACTIVE generation must be admitted'; END IF;
          INSERT INTO admission.action_execution(id,operation_id,tenant_id,workspace_id,action_key,action_version,initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id) VALUES
            (disable_action,gen_random_uuid(),tenant,workspace,'agent.installation.disable',1,human,human,installation,repeat('a',64),'ALLOWED','DISPATCHED',gen_random_uuid()),
            (enable_action,gen_random_uuid(),tenant,workspace,'agent.installation.enable',1,human,human,installation,repeat('b',64),'ALLOWED','DISPATCHED',gen_random_uuid());
          UPDATE catalog.resource SET projection_action_execution_id=disable_action WHERE id=installation;
          UPDATE catalog.agent_installation SET state='DRAINING' WHERE resource_id=installation;
          IF NOT catalog.agent_generation_admitted(installation,version,1) THEN RAISE EXCEPTION 'disable drain keeps the in-flight generation readable'; END IF;
          IF NOT catalog.agent_installation_drained(installation) THEN RAISE EXCEPTION 'an idle Installation drains at once'; END IF;
          UPDATE catalog.resource SET projection_action_execution_id=enable_action WHERE id=installation;
          IF catalog.agent_generation_admitted(installation,version,1) THEN RAISE EXCEPTION 'only an upgrade or disable drain admits a DRAINING generation'; END IF;
          UPDATE catalog.agent_runtime_projection SET state='REVOKED' WHERE installation_resource_id=installation;
          UPDATE catalog.agent_installation SET state='DISABLED' WHERE resource_id=installation;
          UPDATE catalog.resource SET projection_action_execution_id=NULL WHERE id=installation;
          IF catalog.agent_generation_admitted(installation,version,1) THEN RAISE EXCEPTION 'a DISABLED Installation admits no generation'; END IF;
          IF NOT EXISTS(SELECT 1 FROM catalog.action_definition WHERE action_key='agent.installation.disable' AND version=1
              AND workspace_rule='TARGET_HOME_WORKSPACE' AND permission='manage' AND permission_object_type='resource'
              AND confirmation_mode='EXPLICIT' AND approval_policy_id IS NULL AND workflow_kind='AGENT_INSTALLATION'
              AND quota_policy='NONE' AND cardinality(meters)=0 AND status='ACTIVE') THEN
            RAISE EXCEPTION 'disable definition must match 05 §2.11';
          END IF;
          IF NOT EXISTS(SELECT 1 FROM catalog.action_definition WHERE action_key='agent.installation.enable' AND version=1
              AND workspace_rule='TARGET_HOME_WORKSPACE' AND permission='manage' AND confirmation_mode='EXPLICIT'
              AND workflow_kind='AGENT_INSTALLATION' AND status='ACTIVE') THEN
            RAISE EXCEPTION 'enable definition must match 05 §2.11';
          END IF;
          IF position('agent.installation.enable' in pg_get_functiondef('catalog.guard_platform_tool_binding()'::regprocedure))=0 THEN
            RAISE EXCEPTION 'enable generations must be able to bind their declared Tools';
          END IF;
        END $$;"#).execute(&mut *tx).await.unwrap();
        tx.rollback().await.unwrap();
    }

    #[test]
    fn start_target_freezes_the_draining_or_pending_generation_of_the_pin() {
        for fact in [
            "p.agent_version_asset_id=i.pinned_version_asset_id",
            "ae.action_key='agent.installation.disable' and i.state='DRAINING'",
            "p.generation=i.active_projection_generation and p.state='ACTIVE'",
            "ae.action_key='agent.installation.enable' and i.state='DISABLED'",
            "p.state='PENDING'",
            "ae.temporal_workflow_id=$3",
        ] {
            assert!(START_TARGET.contains(fact), "{fact}");
        }
    }
}
