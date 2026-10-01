//! 搁浅实体的重跑入口（`.design/06` §9 的 `rerun`、`DD-48`、`DD-45`）。
//!
//! 生命周期 Workflow 以确定的拒绝结束（`FAILED`，或兜底对账观察到的
//! `CANCELED/TERMINATED/TIMED_OUT`）时，它驱动的实体仍停在收敛中状态
//! （scope/member 为 `PROVISIONING`/`REVOKING`，身份 binding 还包括
//! `RECONCILING`），并计入 `platform.entity.stranded`。那条 Workflow
//! 的固定 ID 已经 TERMINAL，同 ID 再 Start 只会撞上 `REJECT_DUPLICATE`
//! （`component_task::start` 因此回 409）。设计给出的出路只有一条：
//!
//! - `rerun` 创建**新的** ActionExecution 与**新的** Workflow，不改写旧 history
//!   （`.design/06` §9）；
//! - 新 Workflow 的 ID 由新的实体版本决定（`platform:<kind>:<tenant>:<entity>:<version>`，
//!   `.design/06` §3.1），所以重跑就是「实体版本 +1、状态不变、以新版本重走
//!   同一条建立/撤权链」——与 `DD-45`「恢复访问必须建立新 membership version 并
//!   重走建立对账」同形。
//!
//! 本模块只做重跑独有的三件事：判定旧 Workflow 确实可重跑、在同一事务里推进
//! 版本并预写新 WorkflowRef 与审计、然后把启动交给原来的启动核心
//! （scope/member 走 `membership_lifecycle`，身份投影走 `component_task`）。
//! 准入、投影与 Worker 执行仍沿原链路，不建立第二条任务权威。
//!
//! **结果不明不重跑**：WorkflowRef 为 `UNKNOWN`（NotFound 且超出 retention）或
//! 仍非 TERMINAL 时拒绝——那时旧执行可能仍在推进，另起一条就是对同一事实的
//! 第二个业务 Workflow（`DD-48`）。

use crate::audit::Evidence;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::EvidenceKind;
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::audit::{append, AuditEntry};
use crate::component_task;
use crate::governance::{record_direct_launch, AuditClass};
use crate::membership_lifecycle::{
    launch_membership, launch_scope, LifecycleRequest, LifecycleResponse, ScopeLifecycleRequest,
    ScopeOperation,
};
use crate::membership_projection::MembershipScope;
use crate::scope_state::ScopeKind;
use crate::service_api::{authorize, unavailable, ServiceState};
use crate::task_projection;
use crate::temporal::{Observed, ObservedState, TemporalClient};
use crate::workflow_reconcile;

/// 重跑动作的目标是原 ActionExecution。
const AUDIT_CLASS: AuditClass<'static> = AuditClass::core("ACTION_EXECUTION");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RerunRequest {
    /// 已终结、未完成的那条 Workflow。
    pub workflow_id: String,
    /// 新的、已准入的 ActionExecution：它的 target 必须是原 ActionExecution。一条
    /// ActionExecution 至多驱动一个业务 Workflow（`workflow_ref` 上的唯一约束），
    /// 因此它同时是这次重跑的幂等键。
    pub action_execution_id: Uuid,
}

#[derive(sqlx::FromRow)]
struct OriginalWorkflow {
    kind: String,
    tenant_id: Uuid,
    original_action_execution_id: Uuid,
    original_action_key: String,
    original_target_id: Uuid,
    workspace_id: Option<Uuid>,
    projection_state: String,
    status: Option<String>,
    run_id: Option<String>,
}

/// Workflow 以这些终态结束时，它驱动的实体没有到达目标状态，可以重跑。
/// `COMPLETED` 不在其中：完成了还停在收敛中状态是另一类缺陷，重跑会掩盖它。
const RERUNNABLE_STATUS: &[&str] = &["FAILED", "CANCELED", "TERMINATED", "TIMED_OUT"];

/// 投影先写、Temporal 后关闭；二者的 status 与 run ID 均一致才构成重跑证据。
/// Open 是确定的尚不可重跑，其余缺口属于结果不明，不据此分配新 Workflow。
fn closed_execution_matches_projection(
    projection_status: Option<&str>,
    projection_run_id: Option<&str>,
    observed: &Observed,
) -> Result<(), StatusCode> {
    match &observed.state {
        ObservedState::Open => Err(StatusCode::CONFLICT),
        ObservedState::Closed(status)
            if !observed.run_id.is_empty()
                && projection_run_id == Some(observed.run_id.as_str())
                && projection_status == Some(task_projection::wire(status).as_str()) =>
        {
            Ok(())
        }
        ObservedState::Closed(_) | ObservedState::Unrecognized(_) => {
            Err(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
}

/// 可重跑的实体及其所在表与收敛中状态。闭集，不来自外部输入。
#[derive(Clone, Copy)]
enum Target {
    Scope(ScopeKind),
    Membership(MembershipScope),
    Identity {
        principal: Uuid,
        custody: &'static str,
    },
}

impl Target {
    fn table(self) -> &'static str {
        match self {
            Target::Scope(ScopeKind::Tenant) => "identity.tenant",
            Target::Scope(ScopeKind::Workspace) => "identity.workspace",
            Target::Membership(MembershipScope::Tenant) => "identity.tenant_membership",
            Target::Membership(MembershipScope::Workspace) => "identity.workspace_membership",
            Target::Identity { .. } => "identity.buzz_identity_binding",
        }
    }
}

#[derive(Clone)]
enum Entity {
    Id(Uuid),
    Pubkey(String),
}

impl Entity {
    fn workflow_segment(&self) -> String {
        match self {
            Self::Id(id) => id.to_string(),
            Self::Pubkey(pubkey) => pubkey.clone(),
        }
    }
}

/// kind 与原动作方向 → 该实体停在的收敛中状态。scope 只重跑建立链：Workspace
/// 暂停与恢复（`workspace.suspend`/`workspace.restore`）同属 WORKSPACE_LIFECYCLE，
/// 但未登记重跑控制定义（DD-84），这里按原 action key 显式不给收敛中状态，使它们
/// 的终态 Workflow 不会被当作建立链以 PROVISIONING 重跑。成员按 kind 区分建立与
/// 撤权，身份投影按原 action key 区分登记与撤销。
fn converging_state(kind: &str, action_key: &str) -> Option<&'static str> {
    match kind {
        "WORKSPACE_LIFECYCLE" => match action_key {
            "workspace.suspend" | "workspace.restore" => None,
            _ => Some("PROVISIONING"),
        },
        // 业务 Tenant 的暂停与恢复同样未登记重跑控制定义（DD-84、DD-96）
        "TENANT_LIFECYCLE" => match action_key {
            "tenant.suspend" | "tenant.restore" => None,
            _ => Some("PROVISIONING"),
        },
        "MEMBERSHIP_PROJECTION" => Some("PROVISIONING"),
        "MEMBERSHIP_REVOCATION" => Some("REVOKING"),
        "BUZZ_IDENTITY_PROJECTION" => match action_key {
            "identity.client_key.register" | "identity.key_provision" => Some("RECONCILING"),
            "identity.client_key.revoke" | "identity.key_revoke" => Some("REVOKING"),
            _ => None,
        },
        _ => None,
    }
}

struct Ready {
    old: OriginalWorkflow,
    target: Target,
    entity: Entity,
    version: i32,
    converging: &'static str,
    next_id: String,
}

/// admission、审批后重新准入、任务详情与最终派发共用的终态证明。
/// 派发路径才修复错误终态投影；详情读取不产生修复副作用。
async fn preflight(
    pool: &PgPool,
    temporal: &TemporalClient,
    workflow_id: &str,
    expected: Option<(Uuid, Uuid, &str)>,
    repair_projection: bool,
) -> Result<Ready, Response> {
    let old = match sqlx::query_as::<_, OriginalWorkflow>(
        "select w.kind, w.tenant_id, w.action_execution_id as original_action_execution_id,
                source.action_key as original_action_key, source.target_id as original_target_id,
                source.workspace_id,
                w.projection_state, t.status, t.run_id
         from projection.workflow_ref w
         join admission.action_execution source
           on source.id = w.action_execution_id and source.tenant_id = w.tenant_id
         left join projection.task_projection t on t.workflow_id = w.workflow_id
         where w.workflow_id = $1 and w.workflow_type = $2 and w.kind is not null",
    )
    .bind(workflow_id)
    .bind(component_task::WORKFLOW_TYPE)
    .fetch_optional(pool)
    .await
    {
        Ok(Some(r)) => r,
        Ok(None) => return Err(StatusCode::NOT_FOUND.into_response()),
        Err(e) => return Err(unavailable(e)),
    };
    if expected.is_some_and(|(tenant, original, kind)| {
        old.tenant_id != tenant || old.original_action_execution_id != original || old.kind != kind
    }) {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    let Some(converging) = converging_state(&old.kind, &old.original_action_key) else {
        return Err(StatusCode::CONFLICT.into_response());
    };
    let Some((segment, version)) = parse_workflow_id(workflow_id, &old.kind, old.tenant_id) else {
        return Err(StatusCode::CONFLICT.into_response());
    };
    let entity = if old.kind == "BUZZ_IDENTITY_PROJECTION" {
        if segment.len() != 64
            || !segment
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return Err(StatusCode::CONFLICT.into_response());
        }
        Entity::Pubkey(segment)
    } else {
        let Ok(id) = Uuid::parse_str(&segment) else {
            return Err(StatusCode::CONFLICT.into_response());
        };
        if id != old.original_target_id {
            return Err(StatusCode::CONFLICT.into_response());
        }
        Entity::Id(id)
    };
    let target = match resolve_target(pool, &old, &entity).await {
        Ok(Some(t)) => t,
        Ok(None) => return Err(StatusCode::NOT_FOUND.into_response()),
        Err(e) => return Err(unavailable(e)),
    };
    if old.projection_state != "TERMINAL" {
        return Err(StatusCode::CONFLICT.into_response());
    }
    let observed = match temporal.describe(workflow_id).await {
        Ok(Some(observed)) => observed,
        Ok(None) => return Err(StatusCode::SERVICE_UNAVAILABLE.into_response()),
        Err(e) => {
            tracing::warn!(workflow_id, error = %e, "旧 Workflow 的 Temporal 观察失败");
            return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
        }
    };
    if let Err(code) =
        closed_execution_matches_projection(old.status.as_deref(), old.run_id.as_deref(), &observed)
    {
        if repair_projection {
            if let ObservedState::Closed(status) = &observed.state {
                if let Err(e) = workflow_reconcile::patch_terminal(
                    pool,
                    workflow_id,
                    observed.run_id.clone(),
                    observed.history_length,
                    status.clone(),
                )
                .await
                {
                    tracing::warn!(workflow_id, error = %e, "终态投影修复失败");
                }
            }
        }
        return Err(code.into_response());
    }
    if !old
        .status
        .as_deref()
        .is_some_and(|status| RERUNNABLE_STATUS.contains(&status))
    {
        return Err(StatusCode::CONFLICT.into_response());
    }
    let next_id = component_task::workflow_id(
        &old.kind,
        old.tenant_id,
        &entity.workflow_segment(),
        version + 1,
    );
    Ok(Ready {
        old,
        target,
        entity,
        version,
        converging,
        next_id,
    })
}

/// 控制动作 admission 的只读目标门禁。实际版本推进仍在重跑事务里用
/// version + converging state 的 compare-and-swap 完成。
pub(crate) async fn eligible(
    pool: &PgPool,
    temporal: &TemporalClient,
    workflow_id: &str,
    tenant: Uuid,
    original_id: Uuid,
    kind: &str,
) -> Result<(), Response> {
    let ready = preflight(
        pool,
        temporal,
        workflow_id,
        Some((tenant, original_id, kind)),
        false,
    )
    .await?;
    let current: Option<(i32, String)> = match (ready.target, &ready.entity) {
        (Target::Scope(_) | Target::Membership(_), Entity::Id(id)) => {
            sqlx::query_as(&format!(
                "select version, state from {} where id = $1",
                ready.target.table()
            ))
            .bind(id)
            .fetch_optional(pool)
            .await
        }
        (Target::Identity { principal, custody }, Entity::Pubkey(pubkey)) => {
            sqlx::query_as(
                "select version, state from identity.buzz_identity_binding
                 where pubkey = $1 and tenant_id = $2 and principal_id = $3
                   and kind = 'HUMAN' and custody = $4",
            )
            .bind(pubkey)
            .bind(ready.old.tenant_id)
            .bind(principal)
            .bind(custody)
            .fetch_optional(pool)
            .await
        }
        _ => return Err(StatusCode::CONFLICT.into_response()),
    }
    .map_err(unavailable)?;
    if current != Some((ready.version, ready.converging.to_owned())) {
        return Err(StatusCode::CONFLICT.into_response());
    }
    Ok(())
}

pub async fn rerun_task(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<RerunRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    // 治理的重跑控制动作经 governance 的 dispatch_rerun 记录派发；这里是 service
    // 入口，由自己把启动回应记为该 ActionExecution 的派发结果
    let response = rerun(&state.pool, &state.temporal, &req, "task.rerun").await;
    record_direct_launch(&state.pool, req.action_execution_id, AUDIT_CLASS, response).await
}

/// 用户控制与部署级搁浅修复共用唯一的重跑核心。调用方先完成各自的准入，
/// 本函数仍逐次核对确切 action key、target 和 Workflow 终态。
pub(crate) async fn rerun(
    pool: &PgPool,
    temporal: &TemporalClient,
    req: &RerunRequest,
    expected_action_key: &str,
) -> Response {
    let ready = match preflight(pool, temporal, &req.workflow_id, None, true).await {
        Ok(ready) => ready,
        Err(response) => return response,
    };
    let old = &ready.old;
    let target = ready.target;
    let entity = &ready.entity;
    let version = ready.version;
    let converging = ready.converging;
    let next_id = &ready.next_id;

    // 每次请求（包括同键重发）先核对准入。不能借另一种已 ALLOWED 的动作，
    // 或借后来已被撤销的准入，触发这个 Workflow 的启动与收敛。
    let action = match component_task::allowed_action(
        pool,
        req.action_execution_id,
        old.tenant_id,
        old.original_action_execution_id,
    )
    .await
    {
        Ok(Some(a)) if a.action_key == expected_action_key => a,
        Ok(_) => return StatusCode::FORBIDDEN.into_response(),
        Err(e) => return unavailable(e),
    };
    let same_workspace: Option<bool> = match sqlx::query_scalar(
        "select workspace_id is not distinct from $2
         from admission.action_execution where id = $1",
    )
    .bind(req.action_execution_id)
    .bind(old.workspace_id)
    .fetch_optional(pool)
    .await
    {
        Ok(matched) => matched,
        Err(e) => return unavailable(e),
    };
    if same_workspace != Some(true) {
        return StatusCode::FORBIDDEN.into_response();
    }

    // 幂等：同一 ActionExecution 已驱动过一个 Workflow。是本次重跑的那个，就
    // 交回启动核心以同一 ID 收敛（结果不明时的重试走到这里）；是别的，就是
    // 拿一张用过的准入去换第二次执行。
    match component_task::workflow_of_action(pool, req.action_execution_id).await {
        Ok(Some(existing)) if existing == *next_id => {
            let state: Result<Option<String>, _> = sqlx::query_scalar(
                "select projection_state from projection.workflow_ref
                 where workflow_id = $1 and action_execution_id = $2",
            )
            .bind(next_id)
            .bind(req.action_execution_id)
            .fetch_optional(pool)
            .await;
            if matches!(state, Ok(Some(ref projection)) if projection == "TERMINAL") {
                // 同一控制动作已经驱动过这条执行。重发仅返回它的固定引用；
                // 业务终态仍必须从 TaskProjection 读取，不能再 Start 终结的 ID。
                return (
                    StatusCode::OK,
                    Json(LifecycleResponse {
                        workflow_id: next_id.clone(),
                        kind: old.kind.clone(),
                        run_id: None,
                    }),
                )
                    .into_response();
            }
            if let Err(e) = state {
                return unavailable(e);
            }
            return start(pool, temporal, &ready, req.action_execution_id).await;
        }
        Ok(Some(existing)) => {
            tracing::warn!(action = %req.action_execution_id, existing, "ActionExecution 已驱动另一个 Workflow");
            return StatusCode::CONFLICT.into_response();
        }
        Ok(None) => {}
        Err(e) => return unavailable(e),
    }

    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(e) => return unavailable(e),
    };
    // 版本推进带乐观并发：实体仍在旧 Workflow 冻结的那个版本、仍在收敛中状态。
    // 两次重跑并发到达时只有一次推进成功，另一次在这里得到 409。
    let bumped: Result<Option<i32>, sqlx::Error> = match (target, entity) {
        (Target::Scope(_) | Target::Membership(_), Entity::Id(id)) => {
            sqlx::query_scalar(&format!(
                "update {} set version = version + 1
             where id = $1 and version = $2 and state = $3 returning version",
                target.table()
            ))
            .bind(id)
            .bind(version)
            .bind(converging)
            .fetch_optional(&mut *tx)
            .await
        }
        (Target::Identity { principal, custody }, Entity::Pubkey(pubkey)) => {
            sqlx::query_scalar(
                "update identity.buzz_identity_binding set version = version + 1
                 where pubkey = $1 and version = $2 and state = $3
                   and tenant_id = $4 and principal_id = $5
                   and kind = 'HUMAN' and custody = $6 returning version",
            )
            .bind(pubkey)
            .bind(version)
            .bind(converging)
            .bind(old.tenant_id)
            .bind(principal)
            .bind(custody)
            .fetch_optional(&mut *tx)
            .await
        }
        _ => return StatusCode::CONFLICT.into_response(),
    };
    match bumped {
        Ok(Some(v)) if v == version + 1 => {}
        Ok(_) => {
            tracing::warn!(entity = %entity.workflow_segment(), version, "实体已不在旧 Workflow 冻结的版本或收敛中状态");
            return StatusCode::CONFLICT.into_response();
        }
        Err(e) => return unavailable(e),
    }

    // 新 WorkflowRef 与版本推进同事务：提交之后崩溃，同一 ActionExecution 的
    // 重试经上面的幂等分支找回它；反过来先提交版本再落 WorkflowRef，崩在中间就
    // 得到一个既不搁浅（新版本没有终结的 Workflow）又没有 Workflow 的实体。
    if let Err(e) = component_task::prewrite(
        &mut tx,
        next_id,
        &old.kind,
        old.tenant_id,
        action.operation_id,
        req.action_execution_id,
    )
    .await
    {
        return unavailable(e);
    }
    let linked = sqlx::query(
        "update admission.action_execution
         set temporal_workflow_id = $2, dispatch_state = 'UNKNOWN',
             reason_code = $3, updated_at = now()
         where id = $1 and gate_state = 'ALLOWED'
           and dispatch_state in ('NOT_DISPATCHED', 'UNKNOWN')
           and temporal_workflow_id is null",
    )
    .bind(req.action_execution_id)
    .bind(next_id)
    .bind("EXTERNAL_RESULT_UNKNOWN")
    .execute(&mut *tx)
    .await;
    match linked {
        Ok(done) if done.rows_affected() == 1 => {}
        Ok(_) => return StatusCode::CONFLICT.into_response(),
        Err(e) => return unavailable(e),
    }

    let entry = AuditEntry {
        event_key: format!(
            "task.rerun:{}:{}",
            old.original_action_execution_id, req.action_execution_id
        ),
        tenant_id: Some(old.tenant_id),
        workspace_id: old.workspace_id,
        operation_id: action.operation_id,
        event_type: "DECISION",
        human_identity_id: None,
        initiator_principal_id: Some(action.initiator_principal_id),
        actor_principal_id: Some(action.actor_principal_id),
        action_key: &action.action_key,
        action_version: action.action_version,
        component_type_key: AUDIT_CLASS.component_type_key,
        target_type: Some(AUDIT_CLASS.target_type),
        target_id: Some(old.original_action_execution_id),
        parameter_hash: &action.parameter_hash,
        decision: "ALLOW",
        result_code: "RERUN_ACCEPTED",
        result_exposure: AUDIT_CLASS.result_exposure,
        evidence_refs: vec![
            Evidence::new(EvidenceKind::TemporalWorkflowId, &req.workflow_id),
            Evidence::new(EvidenceKind::TemporalWorkflowId, next_id),
        ],
        correlation_id: action.correlation_id,
    };
    if let Err(e) = append(&mut tx, entry).await {
        return unavailable(e);
    }
    if let Err(e) = tx.commit().await {
        return unavailable(e);
    }
    tracing::info!(rerun_of = %req.workflow_id, workflow_id = %next_id, "已受理重跑");

    start(pool, temporal, &ready, req.action_execution_id).await
}

async fn start(pool: &PgPool, temporal: &TemporalClient, ready: &Ready, action: Uuid) -> Response {
    let launched = match (ready.target, &ready.entity) {
        (Target::Scope(kind), Entity::Id(id)) => {
            launch_scope(
                pool,
                temporal,
                &ScopeLifecycleRequest {
                    kind,
                    id: *id,
                    action_execution_id: action,
                    // converging_state 只为 scope 的建立链给出收敛中状态
                    operation: ScopeOperation::Provision,
                },
            )
            .await
        }
        (Target::Membership(scope), Entity::Id(id)) => {
            launch_membership(
                pool,
                temporal,
                &LifecycleRequest {
                    scope,
                    membership_id: *id,
                    action_execution_id: action,
                },
            )
            .await
        }
        (Target::Identity { principal, custody }, Entity::Pubkey(pubkey)) => {
            let row: Option<i32> = match sqlx::query_scalar(
                "select version from identity.buzz_identity_binding
                 where pubkey = $1 and tenant_id = $2 and principal_id = $3
                   and kind = 'HUMAN' and custody = $4 and state = $5",
            )
            .bind(pubkey)
            .bind(ready.old.tenant_id)
            .bind(principal)
            .bind(custody)
            .bind(ready.converging)
            .fetch_optional(pool)
            .await
            {
                Ok(row) => row,
                Err(e) => return unavailable(e),
            };
            let Some(version) = row else {
                return StatusCode::CONFLICT.into_response();
            };
            let workflow_id = component_task::workflow_id(
                crate::client_keys::KIND,
                ready.old.tenant_id,
                pubkey,
                version,
            );
            if workflow_id != ready.next_id {
                return StatusCode::CONFLICT.into_response();
            }
            let input = component_task::ComponentTaskInput {
                kind: crate::client_keys::KIND.to_owned(),
                target: crate::client_keys::IdentityEnvelope {
                    identity: crate::client_keys::IdentityTarget {
                        pubkey: pubkey.clone(),
                        binding_version: version,
                    },
                },
            };
            return match component_task::start(
                pool,
                temporal,
                &workflow_id,
                ready.old.tenant_id,
                action,
                &input,
            )
            .await
            {
                Ok(run_id) => (
                    StatusCode::OK,
                    Json(LifecycleResponse {
                        workflow_id,
                        kind: crate::client_keys::KIND.to_owned(),
                        run_id,
                    }),
                )
                    .into_response(),
                Err(response) => response,
            };
        }
        _ => return StatusCode::CONFLICT.into_response(),
    };
    launched
        .map(|r| (StatusCode::OK, Json(r)).into_response())
        .unwrap_or_else(|r| r)
}

/// 从固定 workflow ID 取出实体 ID 与版本，并核对前三段与 WorkflowRef 自己的
/// kind、Tenant 一致——不一致说明这不是按固定格式建的 ID，不按它推断任何事。
fn parse_workflow_id(id: &str, kind: &str, tenant: Uuid) -> Option<(String, i32)> {
    match component_task::split_workflow_id(id) {
        Some([k, t, entity, version]) if k == kind && t == tenant.to_string() => {
            let version = version.parse::<i32>().ok()?;
            (version > 0 && version < i32::MAX).then(|| (entity.to_string(), version))
        }
        _ => None,
    }
}

/// 成员 kind 不区分 Tenant/Workspace 成员（`MembershipScope` 在 input 里），
/// 因此按 ID 在两张表里找；scope kind 直接对应一张表。
async fn resolve_target(
    pool: &PgPool,
    old: &OriginalWorkflow,
    entity: &Entity,
) -> Result<Option<Target>, sqlx::Error> {
    let Entity::Id(id) = entity else {
        let Entity::Pubkey(pubkey) = entity else {
            unreachable!()
        };
        let expected_custody = match old.original_action_key.as_str() {
            "identity.client_key.register" | "identity.client_key.revoke" => "CLIENT",
            "identity.key_provision" | "identity.key_revoke" => "SERVER",
            _ => return Ok(None),
        };
        let owned: Option<i32> = sqlx::query_scalar(
            "select 1 from identity.buzz_identity_binding
             where pubkey = $1 and tenant_id = $2 and principal_id = $3
               and kind = 'HUMAN' and custody = $4",
        )
        .bind(pubkey)
        .bind(old.tenant_id)
        .bind(old.original_target_id)
        .bind(expected_custody)
        .fetch_optional(pool)
        .await?;
        return Ok(owned.map(|_| Target::Identity {
            principal: old.original_target_id,
            custody: expected_custody,
        }));
    };
    Ok(match old.kind.as_str() {
        "TENANT_LIFECYCLE" => Some(Target::Scope(ScopeKind::Tenant)),
        "WORKSPACE_LIFECYCLE" => Some(Target::Scope(ScopeKind::Workspace)),
        _ => {
            let tenant = sqlx::query_scalar!(
                "select 1 as one from identity.tenant_membership where id = $1",
                id
            )
            .fetch_optional(pool)
            .await?;
            if tenant.is_some() {
                Some(Target::Membership(MembershipScope::Tenant))
            } else {
                sqlx::query_scalar!(
                    "select 1 as one from identity.workspace_membership where id = $1",
                    id
                )
                .fetch_optional(pool)
                .await?
                .map(|_| Target::Membership(MembershipScope::Workspace))
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use contracts::TaskStatus;

    #[test]
    fn rerun_requires_matching_temporal_close_not_just_terminal_projection() {
        let mut observed = Observed {
            run_id: "run-1".into(),
            first_run_id: "run-1".into(),
            history_length: 1,
            state: ObservedState::Open,
        };
        assert_eq!(
            closed_execution_matches_projection(Some("FAILED"), Some("run-1"), &observed),
            Err(StatusCode::CONFLICT),
            "终态投影先到时，Temporal 仍 Open 不能重跑"
        );

        observed.state = ObservedState::Closed(TaskStatus::Failed);
        assert_eq!(
            closed_execution_matches_projection(Some("FAILED"), Some("run-1"), &observed),
            Ok(())
        );
        for (status, run_id) in [
            (Some("CANCELED"), Some("run-1")),
            (Some("FAILED"), Some("run-0")),
            (Some("FAILED"), None),
        ] {
            assert_eq!(
                closed_execution_matches_projection(status, run_id, &observed),
                Err(StatusCode::SERVICE_UNAVAILABLE),
                "投影与 Temporal close 不一致属于结果不明"
            );
        }
        observed.run_id.clear();
        assert_eq!(
            closed_execution_matches_projection(Some("FAILED"), Some(""), &observed),
            Err(StatusCode::SERVICE_UNAVAILABLE),
            "空 run ID 不能作为终态证据"
        );
        observed.state = ObservedState::Unrecognized(99);
        assert_eq!(
            closed_execution_matches_projection(Some("FAILED"), Some(""), &observed),
            Err(StatusCode::SERVICE_UNAVAILABLE)
        );
    }

    #[test]
    fn workflow_id_must_match_its_ref() {
        let tenant = Uuid::new_v4();
        let entity = Uuid::new_v4();
        let id = component_task::workflow_id("TENANT_LIFECYCLE", tenant, &entity.to_string(), 3);
        assert_eq!(
            parse_workflow_id(&id, "TENANT_LIFECYCLE", tenant),
            Some((entity.to_string(), 3))
        );
        // kind 或 Tenant 与 WorkflowRef 不符即不解析
        assert_eq!(parse_workflow_id(&id, "WORKSPACE_LIFECYCLE", tenant), None);
        assert_eq!(
            parse_workflow_id(&id, "TENANT_LIFECYCLE", Uuid::new_v4()),
            None
        );
        assert_eq!(
            parse_workflow_id("platform:TENANT_LIFECYCLE:x", "TENANT_LIFECYCLE", tenant),
            None
        );
        // ADR-17 迁移窗口：旧前缀的存量 WorkflowRef 仍按原 ID 解析；不认识的前缀不解析
        assert_eq!(
            parse_workflow_id(
                &format!("kailo:TENANT_LIFECYCLE:{tenant}:{entity}:3"),
                "TENANT_LIFECYCLE",
                tenant
            ),
            Some((entity.to_string(), 3))
        );
        assert_eq!(
            parse_workflow_id(
                &format!("other:TENANT_LIFECYCLE:{tenant}:{entity}:3"),
                "TENANT_LIFECYCLE",
                tenant
            ),
            None
        );
        for version in [
            0.to_string(),
            (-1).to_string(),
            i32::MAX.to_string(),
            (i64::from(i32::MAX) + 1).to_string(),
        ] {
            let id = format!("platform:TENANT_LIFECYCLE:{tenant}:{entity}:{version}");
            assert_eq!(parse_workflow_id(&id, "TENANT_LIFECYCLE", tenant), None);
        }
    }

    #[test]
    fn identity_rerun_direction_is_fixed_by_original_action() {
        for (action, state) in [
            ("identity.client_key.register", "RECONCILING"),
            ("identity.client_key.revoke", "REVOKING"),
            ("identity.key_provision", "RECONCILING"),
            ("identity.key_revoke", "REVOKING"),
        ] {
            assert_eq!(
                converging_state("BUZZ_IDENTITY_PROJECTION", action),
                Some(state)
            );
        }
        assert_eq!(
            converging_state("BUZZ_IDENTITY_PROJECTION", "tenant.member.revoke"),
            None,
            "另一种动作不能借身份投影的终态重跑"
        );
        assert_eq!(
            converging_state("WORKSPACE_LIFECYCLE", "workspace.create"),
            Some("PROVISIONING")
        );
        for action in ["tenant.suspend", "tenant.restore"] {
            assert_eq!(converging_state("TENANT_LIFECYCLE", action), None);
        }
        assert_eq!(
            converging_state("TENANT_LIFECYCLE", "tenant.bootstrap"),
            Some("PROVISIONING")
        );
        for action in ["workspace.suspend", "workspace.restore"] {
            assert_eq!(
                converging_state("WORKSPACE_LIFECYCLE", action),
                None,
                "暂停与恢复未开放重跑，不能被当作建立链重跑"
            );
        }
        let tenant = Uuid::new_v4();
        let pubkey = "a".repeat(64);
        let id = component_task::workflow_id("BUZZ_IDENTITY_PROJECTION", tenant, &pubkey, 5);
        assert_eq!(
            parse_workflow_id(&id, "BUZZ_IDENTITY_PROJECTION", tenant),
            Some((pubkey, 5))
        );
    }
}
