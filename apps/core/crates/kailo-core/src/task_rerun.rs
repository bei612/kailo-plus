//! 搁浅实体的重跑入口（`.design/06` §9 的 `rerun`、`DD-48`、`DD-45`）。
//!
//! 生命周期 Workflow 以确定的拒绝结束（`FAILED`，或兜底对账观察到的
//! `CANCELED/TERMINATED/TIMED_OUT`）时，它驱动的实体仍停在收敛中状态
//! （`PROVISIONING`/`REVOKING`），并计入 `kailo.entity.stranded`。那条 Workflow
//! 的固定 ID 已经 TERMINAL，同 ID 再 Start 只会撞上 `REJECT_DUPLICATE`
//! （`component_task::start` 因此回 409）。设计给出的出路只有一条：
//!
//! - `rerun` 创建**新的** ActionExecution 与**新的** Workflow，不改写旧 history
//!   （`.design/06` §9）；
//! - 新 Workflow 的 ID 由新的实体版本决定（`kailo:<kind>:<tenant>:<entity>:<version>`，
//!   `.design/06` §3.1），所以重跑就是「实体版本 +1、状态不变、以新版本重走
//!   同一条建立/撤权链」——与 `DD-45`「恢复访问必须建立新 membership version 并
//!   重走建立对账」同形。
//!
//! 本模块只做重跑独有的三件事：判定旧 Workflow 确实可重跑、在同一事务里推进
//! 版本并预写新 WorkflowRef 与审计、然后把启动交给原来的启动核心
//! （`membership_lifecycle::start_scope/start_membership`）。准入依据、kind 判定、
//! Start 三项策略都在那里，这里不另写一份。
//!
//! **结果不明不重跑**：WorkflowRef 为 `UNKNOWN`（NotFound 且超出 retention）或
//! 仍非 TERMINAL 时拒绝——那时旧执行可能仍在推进，另起一条就是对同一事实的
//! 第二个业务 Workflow（`DD-48`）。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::audit::{append, AuditEntry};
use crate::component_task;
use crate::membership_lifecycle::{
    start_membership, start_scope, LifecycleRequest, ScopeLifecycleRequest,
};
use crate::membership_projection::MembershipScope;
use crate::scope_state::ScopeKind;
use crate::service_api::{authorize, unavailable, ServiceState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RerunRequest {
    /// 已终结、未完成的那条 Workflow。
    pub workflow_id: String,
    /// 新的、已准入的 ActionExecution：它的 target 必须就是该实体。一条
    /// ActionExecution 至多驱动一个业务 Workflow（`workflow_ref` 上的唯一约束），
    /// 因此它同时是这次重跑的幂等键。
    pub action_execution_id: Uuid,
}

/// Workflow 以这些终态结束时，它驱动的实体没有到达目标状态，可以重跑。
/// `COMPLETED` 不在其中：完成了还停在收敛中状态是另一类缺陷，重跑会掩盖它。
const RERUNNABLE_STATUS: &[&str] = &["FAILED", "CANCELED", "TERMINATED", "TIMED_OUT"];

/// 可重跑的实体及其所在表与收敛中状态。闭集，不来自外部输入。
#[derive(Clone, Copy)]
enum Target {
    Scope(ScopeKind),
    Membership(MembershipScope),
}

impl Target {
    fn table(self) -> &'static str {
        match self {
            Target::Scope(ScopeKind::Tenant) => "identity.tenant",
            Target::Scope(ScopeKind::Workspace) => "identity.workspace",
            Target::Membership(MembershipScope::Tenant) => "identity.tenant_membership",
            Target::Membership(MembershipScope::Workspace) => "identity.workspace_membership",
        }
    }

    fn target_type(self) -> &'static str {
        match self {
            Target::Scope(ScopeKind::Tenant) => "TENANT",
            Target::Scope(ScopeKind::Workspace) => "WORKSPACE",
            Target::Membership(MembershipScope::Tenant) => "TENANT_MEMBERSHIP",
            Target::Membership(MembershipScope::Workspace) => "WORKSPACE_MEMBERSHIP",
        }
    }
}

/// kind → 该 kind 驱动的实体停在的收敛中状态。与启动核心的判定一一对应：
/// scope 只有建立链（`PROVISIONING`），成员按状态区分建立（`PROVISIONING`）
/// 与撤权（`REVOKING`）。
fn converging_state(kind: &str) -> Option<&'static str> {
    match kind {
        "TENANT_LIFECYCLE" | "WORKSPACE_LIFECYCLE" | "MEMBERSHIP_PROJECTION" => {
            Some("PROVISIONING")
        }
        "MEMBERSHIP_REVOCATION" => Some("REVOKING"),
        _ => None,
    }
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

    let old = match sqlx::query!(
        r#"select w.kind as "kind!", w.tenant_id, w.projection_state, t.status as "status?"
           from projection.workflow_ref w
           left join projection.task_projection t on t.workflow_id = w.workflow_id
           where w.workflow_id = $1 and w.kind is not null"#,
        req.workflow_id
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(r)) => r,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return unavailable(e),
    };
    let Some(converging) = converging_state(&old.kind) else {
        tracing::warn!(kind = %old.kind, "该 kind 没有登记重跑");
        return StatusCode::CONFLICT.into_response();
    };
    let Some((entity, version)) = parse_workflow_id(&req.workflow_id, &old.kind, old.tenant_id)
    else {
        tracing::warn!(workflow_id = %req.workflow_id, "workflow ID 不是固定格式");
        return StatusCode::CONFLICT.into_response();
    };
    let target = match resolve_target(&state, &old.kind, entity).await {
        Ok(Some(t)) => t,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return unavailable(e),
    };
    let next_id =
        component_task::workflow_id(&old.kind, old.tenant_id, &entity.to_string(), version + 1);

    // 幂等：同一 ActionExecution 已驱动过一个 Workflow。是本次重跑的那个，就
    // 交回启动核心以同一 ID 收敛（结果不明时的重试走到这里）；是别的，就是
    // 拿一张用过的准入去换第二次执行。
    match sqlx::query_scalar!(
        "select workflow_id from projection.workflow_ref where action_execution_id = $1",
        req.action_execution_id
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(existing)) if existing == next_id => {
            return start(&state, target, entity, req.action_execution_id).await
        }
        Ok(Some(existing)) => {
            tracing::warn!(action = %req.action_execution_id, existing, "ActionExecution 已驱动另一个 Workflow");
            return StatusCode::CONFLICT.into_response();
        }
        Ok(None) => {}
        Err(e) => return unavailable(e),
    }

    // 只有「确定已终结且没有完成」才可重跑。仍在跑、结果不明、或投影尚未落库
    // 都不行——那时另起一条就是同一事实的第二个 Workflow。
    let rerunnable = old.projection_state == "TERMINAL"
        && old
            .status
            .as_deref()
            .is_some_and(|s| RERUNNABLE_STATUS.contains(&s));
    if !rerunnable {
        tracing::warn!(
            workflow_id = %req.workflow_id,
            projection_state = %old.projection_state,
            status = ?old.status,
            "旧 Workflow 不在可重跑的终态"
        );
        return StatusCode::CONFLICT.into_response();
    }

    // 准入依据：已 ALLOWED、同 Tenant、target 就是该实体。target 不核就可以拿
    // 一张为别的实体签发的准入来重跑这一个。
    let action = match sqlx::query!(
        "select operation_id, action_key, action_version, initiator_principal_id,
                actor_principal_id, parameter_hash, correlation_id
         from admission.action_execution
         where id = $1 and tenant_id = $2 and target_id = $3 and gate_state = 'ALLOWED'",
        req.action_execution_id,
        old.tenant_id,
        entity
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(a)) => a,
        Ok(None) => {
            tracing::warn!(action = %req.action_execution_id, "ActionExecution 不存在、未准入或 target 不是该实体");
            return StatusCode::FORBIDDEN.into_response();
        }
        Err(e) => return unavailable(e),
    };

    let mut tx = match state.pool.begin().await {
        Ok(t) => t,
        Err(e) => return unavailable(e),
    };
    // 版本推进带乐观并发：实体仍在旧 Workflow 冻结的那个版本、仍在收敛中状态。
    // 两次重跑并发到达时只有一次推进成功，另一次在这里得到 409。
    let bumped: Result<Option<i32>, sqlx::Error> = sqlx::query_scalar(&format!(
        "update {} set version = version + 1
         where id = $1 and version = $2 and state = $3 returning version",
        target.table()
    ))
    .bind(entity)
    .bind(version)
    .bind(converging)
    .fetch_optional(&mut *tx)
    .await;
    match bumped {
        Ok(Some(v)) if v == version + 1 => {}
        Ok(_) => {
            tracing::warn!(entity = %entity, version, "实体已不在旧 Workflow 冻结的版本或收敛中状态");
            return StatusCode::CONFLICT.into_response();
        }
        Err(e) => return unavailable(e),
    }

    // 新 WorkflowRef 与版本推进同事务：提交之后崩溃，同一 ActionExecution 的
    // 重试经上面的幂等分支找回它；反过来先提交版本再落 WorkflowRef，崩在中间就
    // 得到一个既不搁浅（新版本没有终结的 Workflow）又没有 Workflow 的实体。
    if let Err(e) = sqlx::query!(
        "insert into projection.workflow_ref
             (workflow_id, workflow_type, workflow_version, kind, tenant_id,
              operation_id, action_execution_id, projection_state)
         values ($1, $2, 1, $3, $4, $5, $6, 'PENDING_START')",
        next_id,
        component_task::WORKFLOW_TYPE,
        old.kind,
        old.tenant_id,
        action.operation_id,
        req.action_execution_id,
    )
    .execute(&mut *tx)
    .await
    {
        return unavailable(e);
    }

    let entry = AuditEntry {
        event_key: format!("task.rerun:{}:{}", req.workflow_id, req.action_execution_id),
        tenant_id: Some(old.tenant_id),
        workspace_id: match target {
            Target::Scope(ScopeKind::Workspace) => Some(entity),
            _ => None,
        },
        operation_id: action.operation_id,
        event_type: "DECISION",
        human_identity_id: None,
        initiator_principal_id: Some(action.initiator_principal_id),
        actor_principal_id: Some(action.actor_principal_id),
        action_key: &action.action_key,
        action_version: action.action_version,
        component_type_key: "core",
        target_type: Some(target.target_type()),
        target_id: Some(entity),
        parameter_hash: &action.parameter_hash,
        decision: "ALLOW",
        result_code: "RERUN_ACCEPTED",
        result_exposure: "NONE",
        evidence_refs: serde_json::json!([
            { "kind": "TEMPORAL_WORKFLOW_ID", "value": req.workflow_id },
            { "kind": "TEMPORAL_WORKFLOW_ID", "value": next_id },
        ]),
        correlation_id: action.correlation_id,
    };
    if let Err(e) = append(&mut tx, entry).await {
        return unavailable(e);
    }
    if let Err(e) = tx.commit().await {
        return unavailable(e);
    }
    tracing::info!(rerun_of = %req.workflow_id, workflow_id = %next_id, "已受理重跑");

    start(&state, target, entity, req.action_execution_id).await
}

async fn start(state: &ServiceState, target: Target, entity: Uuid, action: Uuid) -> Response {
    match target {
        Target::Scope(kind) => {
            start_scope(
                state,
                &ScopeLifecycleRequest {
                    kind,
                    id: entity,
                    action_execution_id: action,
                },
            )
            .await
        }
        Target::Membership(scope) => {
            start_membership(
                state,
                &LifecycleRequest {
                    scope,
                    membership_id: entity,
                    action_execution_id: action,
                },
            )
            .await
        }
    }
}

/// 从固定 workflow ID 取出实体 ID 与版本，并核对前三段与 WorkflowRef 自己的
/// kind、Tenant 一致——不一致说明这不是按固定格式建的 ID，不按它推断任何事。
fn parse_workflow_id(id: &str, kind: &str, tenant: Uuid) -> Option<(Uuid, i32)> {
    let parts: Vec<&str> = id.split(':').collect();
    match parts.as_slice() {
        ["kailo", k, t, entity, version] if *k == kind && *t == tenant.to_string() => {
            Some((Uuid::parse_str(entity).ok()?, version.parse().ok()?))
        }
        _ => None,
    }
}

/// 成员 kind 不区分 Tenant/Workspace 成员（`MembershipScope` 在 input 里），
/// 因此按 ID 在两张表里找；scope kind 直接对应一张表。
async fn resolve_target(
    state: &ServiceState,
    kind: &str,
    entity: Uuid,
) -> Result<Option<Target>, sqlx::Error> {
    Ok(match kind {
        "TENANT_LIFECYCLE" => Some(Target::Scope(ScopeKind::Tenant)),
        "WORKSPACE_LIFECYCLE" => Some(Target::Scope(ScopeKind::Workspace)),
        _ => {
            let tenant = sqlx::query_scalar!(
                "select 1 as one from identity.tenant_membership where id = $1",
                entity
            )
            .fetch_optional(&state.pool)
            .await?;
            if tenant.is_some() {
                Some(Target::Membership(MembershipScope::Tenant))
            } else {
                sqlx::query_scalar!(
                    "select 1 as one from identity.workspace_membership where id = $1",
                    entity
                )
                .fetch_optional(&state.pool)
                .await?
                .map(|_| Target::Membership(MembershipScope::Workspace))
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workflow_id_must_match_its_ref() {
        let tenant = Uuid::new_v4();
        let entity = Uuid::new_v4();
        let id = component_task::workflow_id("TENANT_LIFECYCLE", tenant, &entity.to_string(), 3);
        assert_eq!(
            parse_workflow_id(&id, "TENANT_LIFECYCLE", tenant),
            Some((entity, 3))
        );
        // kind 或 Tenant 与 WorkflowRef 不符即不解析
        assert_eq!(parse_workflow_id(&id, "WORKSPACE_LIFECYCLE", tenant), None);
        assert_eq!(
            parse_workflow_id(&id, "TENANT_LIFECYCLE", Uuid::new_v4()),
            None
        );
        assert_eq!(
            parse_workflow_id("kailo:TENANT_LIFECYCLE:x", "TENANT_LIFECYCLE", tenant),
            None
        );
    }
}
