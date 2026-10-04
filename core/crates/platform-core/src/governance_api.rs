//! 治理内核的 BFF 与 service API 表面（`.design/06` §9、`01` §3、§4）。
//!
//! BFF：语义命令、本人任务、待我审批、审批决定与撤回。approver、发起者一律从
//! PlatformSession 取，不接受请求体自报（`.design/09` 第 2 步）；审批状态只经
//! Temporal Update 推进，这里没有任何直接改 ApprovalProjection 的路径（DD-47）。
//!
//! service API：ApprovalWorkflow 的两个 Activity——`ProjectApprovalState` 写回投影、
//! `FreshApprovalAdmission` 判定审批者资格。
//!
//! 列表的可见范围由调用方自己的 scope 决定，不接受范围参数。

use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Utc};
use contracts::{
    ActionCommand, ApprovalControlOutcome, ApprovalDecisionOutcome, ApprovalDecisionRequest,
    ApprovalDecisionUpdate, ApprovalSelector, ApprovalStateReport, ApprovalView,
    FreshApprovalAdmissionRequest, ReasonCode, TaskView,
};
use serde_json::Value;
use uuid::Uuid;

use crate::bff::{resolve_lifecycle_execution_context, BffState, ExecutionContext};
use crate::governance::{parse, Actor, Applied, Governance, Refusal, UpdateResult};
use crate::service_api::{authorize, ServiceState};
use crate::spicedb::Consistency;

fn actor(ctx: &ExecutionContext) -> Actor {
    Actor {
        tenant_id: ctx.tenant_id,
        principal_id: ctx.tenant_principal_id,
        human_identity_id: Some(ctx.human_identity_id),
    }
}

fn rfc3339(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true)
}

// ---------------------------------------------------------------------------
// 语义命令
// ---------------------------------------------------------------------------

/// `POST /api/v1/actions`
pub async fn submit_action(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let ctx = match resolve_lifecycle_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let Ok(Json(value)) = body else {
        return Refusal::Precondition(ReasonCode::InvalidParameters).respond(None);
    };
    let cmd = match parse_action_command(value) {
        Ok(cmd) => cmd,
        Err(refusal) => return refusal.respond(None),
    };
    if ctx.access_mode == contracts::PlatformSessionAccessMode::LifecycleRestricted
        && cmd.action_key != "tenant.delete"
        && !cmd.action_key.starts_with("task.cancel.tenant.delete.v")
    {
        return Refusal::Denied(ReasonCode::ScopeGuardFailed).respond(None);
    }
    if cmd.source_event_id.is_some() && cmd.action_key != crate::agent_invocation::ACTION {
        return Refusal::Precondition(ReasonCode::InvalidParameters).respond(None);
    }
    let result = if cmd.action_key == crate::agent_invocation::ACTION {
        crate::agent_invocation::submit_manual(&state, &ctx, &cmd).await
    } else if crate::agent_memory::write::is_action(&cmd.action_key) {
        state.governance.submit_memory(&state, &ctx, &cmd).await
    } else {
        state.governance.submit(actor(&ctx), &cmd).await
    };
    match result {
        Ok((status, submission)) => (status, Json(submission)).into_response(),
        Err((refusal, op)) => refusal.respond(op),
    }
}

fn parse_action_command(value: Value) -> Result<ActionCommand, Refusal> {
    // NONE must not carry a credential field, even null: generated Option
    // fields otherwise erase the difference between null and absence.
    if value.get("actionKey").and_then(Value::as_str) == Some("llm_route.create")
        && value
            .pointer("/llmRouteCreate/providerCredentialMode")
            .and_then(Value::as_str)
            == Some("NONE")
        && value
            .get("llmRouteCreate")
            .and_then(Value::as_object)
            .is_some_and(|source| source.contains_key("providerSecretRef"))
    {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    serde_json::from_value(value).map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))
}

#[cfg(test)]
mod action_command_tests {
    use super::*;
    use serde_json::json;

    fn route_command() -> Value {
        let source = json!({
            "id": Uuid::new_v4().to_string(),
            "revision": 1,
            "sha256": "a".repeat(64),
        });
        json!({
            "actionKey": "llm_route.create",
            "idempotencyKey": Uuid::new_v4().to_string(),
            "llmRouteCreate": {
                "provider": source,
                "model": source,
                "providerCredentialMode": "NONE",
            },
        })
    }

    #[test]
    fn route_command_keeps_explicit_credential_variants() {
        let command = route_command();
        let route = parse_action_command(command.clone())
            .unwrap()
            .llm_route_create
            .unwrap();
        assert_eq!(
            route.provider_credential_mode,
            contracts::LlmProviderCredentialMode::None
        );
        assert!(route.provider_secret_ref.is_none());

        let mut command = command;
        command["llmRouteCreate"]["providerCredentialMode"] = json!("SECRET_REF");
        command["llmRouteCreate"]["providerSecretRef"] = json!({
            "locator": Uuid::new_v4().to_string(),
            "version": 1,
            "audience": Uuid::new_v4().to_string(),
        });
        let route = parse_action_command(command)
            .unwrap()
            .llm_route_create
            .unwrap();
        assert_eq!(
            route.provider_credential_mode,
            contracts::LlmProviderCredentialMode::SecretRef
        );
        assert!(route.provider_secret_ref.is_some());

        assert!(parse_action_command(json!({
            "actionKey": "workspace.create",
            "idempotencyKey": Uuid::new_v4().to_string(),
        }))
        .is_ok());
    }

    #[test]
    fn route_command_rejects_erased_null_and_unrecognized_mode() {
        let command = route_command();
        for reference in [
            Value::Null,
            json!({
                "locator": Uuid::new_v4().to_string(),
                "version": 1,
                "audience": Uuid::new_v4().to_string(),
            }),
        ] {
            let mut invalid = command.clone();
            invalid["llmRouteCreate"]["providerSecretRef"] = reference;
            assert!(matches!(
                parse_action_command(invalid),
                Err(Refusal::Precondition(ReasonCode::InvalidParameters))
            ));
        }
        for mode in [Value::Null, json!("UNRECOGNIZED")] {
            let mut invalid = command.clone();
            invalid["llmRouteCreate"]["providerCredentialMode"] = mode;
            assert!(matches!(
                parse_action_command(invalid),
                Err(Refusal::Precondition(ReasonCode::InvalidParameters))
            ));
        }
        let mut invalid = command;
        invalid["llmRouteCreate"]
            .as_object_mut()
            .unwrap()
            .remove("providerCredentialMode");
        assert!(matches!(
            parse_action_command(invalid),
            Err(Refusal::Precondition(ReasonCode::InvalidParameters))
        ));
    }
}

// ---------------------------------------------------------------------------
// 本人任务
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct TaskRow {
    id: Uuid,
    operation_id: Uuid,
    action_key: String,
    action_version: i32,
    workspace_id: Option<Uuid>,
    target_id: Uuid,
    gate_state: String,
    dispatch_state: String,
    reason_code: Option<String>,
    approval_workflow_id: Option<String>,
    temporal_workflow_id: Option<String>,
    created_at: DateTime<Utc>,
    approval_status: Option<String>,
    approval_ref_state: Option<String>,
    approval_ref_stale: Option<bool>,
    kind: Option<String>,
    ref_state: Option<String>,
    ref_stale: Option<bool>,
    task_status: Option<String>,
    waiting_reason: Option<String>,
    observation_gap: Option<bool>,
}

const TASK_QUERY: &str = "
    select ae.id, ae.operation_id, ae.action_key, ae.action_version, ae.workspace_id, ae.target_id,
           ae.gate_state, ae.dispatch_state, ae.reason_code, ae.approval_workflow_id,
           ae.temporal_workflow_id, ae.created_at,
           ap.status as approval_status,
           aw.projection_state as approval_ref_state,
           aw.created_at < now() - make_interval(secs => $3::bigint) as approval_ref_stale,
           w.kind, w.projection_state as ref_state,
           w.created_at < now() - make_interval(secs => $3::bigint) as ref_stale,
           tp.status as task_status, tp.waiting_reason, tp.observation_gap
    from admission.action_execution ae
    left join projection.approval_projection ap on ap.workflow_id = ae.approval_workflow_id
    left join projection.workflow_ref aw on aw.workflow_id = ae.approval_workflow_id
    left join projection.workflow_ref w on w.workflow_id = ae.temporal_workflow_id
    left join projection.task_projection tp on tp.workflow_id = ae.temporal_workflow_id
    where ae.tenant_id = $1 and ae.initiator_principal_id = $2";

/// 投影能否担保为当前（`.design/06` §3.1、RB-05）。返回 None 即当前；否则是
/// UI 必须显示为「待对账」的原因，不得渲染成成功或失败（`06` §4）。
fn observation(r: &TaskRow) -> Option<ReasonCode> {
    let unknown = r.dispatch_state == "UNKNOWN"
        || r.ref_state.as_deref() == Some("UNKNOWN")
        || r.approval_ref_state.as_deref() == Some("UNKNOWN");
    if unknown {
        return Some(ReasonCode::ExternalResultUnknown);
    }
    // 终态来自兜底对账而不是 Workflow 自己的写回
    if r.observation_gap == Some(true) {
        return Some(ReasonCode::ProjectionDelayed);
    }
    // WorkflowRef 已标终态却没有对应的终态 TaskProjection，不能把缺失的
    // 派生事实当作一次完成。取得确定的 Temporal 对账修复后再展示结果。
    if r.ref_state.as_deref() == Some("TERMINAL")
        && !matches!(
            r.task_status.as_deref(),
            Some("COMPLETED" | "FAILED" | "CANCELED" | "TERMINATED" | "TIMED_OUT")
        )
    {
        return Some(ReasonCode::ProjectionDelayed);
    }
    // 业务 Workflow 超过新鲜度上界仍没有任何写回（Start 未确认或从未投影 RUNNING）
    let stale = |state: &Option<String>, stale: Option<bool>, written: bool| {
        matches!(state.as_deref(), Some("PENDING_START" | "RUNNING"))
            && stale == Some(true)
            && !written
    };
    if stale(
        &r.ref_state,
        r.ref_stale,
        r.task_status.is_some() && r.ref_state.as_deref() != Some("PENDING_START"),
    ) {
        return Some(ReasonCode::ProjectionDelayed);
    }
    if stale(
        &r.approval_ref_state,
        r.approval_ref_stale,
        r.approval_status.is_some() && r.approval_ref_state.as_deref() != Some("PENDING_START"),
    ) {
        return Some(ReasonCode::ProjectionDelayed);
    }
    // 审批 Workflow 已终结而投影没有终态：history 的结论还没到 Core
    if r.approval_ref_state.as_deref() == Some("TERMINAL")
        && !matches!(
            r.approval_status.as_deref(),
            Some("DENIED" | "EXPIRED" | "CANCELLED" | "INVALIDATED" | "CONSUMED")
        )
    {
        return Some(ReasonCode::ProjectionDelayed);
    }
    None
}

#[allow(clippy::result_large_err)]
fn task_view(r: TaskRow) -> Result<TaskView, Response> {
    let e = |c: &str, v: &str| {
        tracing::error!(column = c, value = v, "库中的状态值不在契约枚举内");
        Refusal::Unavailable(format!("任务投影的 {c} 状态值不在契约枚举内"))
            .respond(Some(r.operation_id))
    };
    let observation = observation(&r);
    Ok(TaskView {
        operation_id: r.operation_id.to_string(),
        action_execution_id: r.id.to_string(),
        action_key: r.action_key,
        action_version: i64::from(r.action_version),
        workspace_id: r.workspace_id.map(|w| w.to_string()),
        target_id: r.target_id.to_string(),
        gate_state: parse(&r.gate_state).ok_or_else(|| e("gate_state", &r.gate_state))?,
        dispatch_state: parse(&r.dispatch_state)
            .ok_or_else(|| e("dispatch_state", &r.dispatch_state))?,
        reason: r
            .reason_code
            .as_deref()
            .map(|v| parse(v).ok_or_else(|| e("reason_code", v)))
            .transpose()?,
        approval_workflow_id: r.approval_workflow_id,
        approval_status: r
            .approval_status
            .as_deref()
            .map(|v| parse(v).ok_or_else(|| e("approval_status", v)))
            .transpose()?,
        workflow_id: r.temporal_workflow_id,
        workflow_kind: r
            .kind
            .as_deref()
            .map(|v| parse(v).ok_or_else(|| e("workflow_kind", v)))
            .transpose()?,
        task_status: r
            .task_status
            .as_deref()
            .map(|v| parse(v).ok_or_else(|| e("task_status", v)))
            .transpose()?,
        waiting_reason: r.waiting_reason,
        observation,
        cancel_action_key: None,
        rerun_action_key: None,
        created_at: rfc3339(r.created_at),
    })
}

/// `GET /api/v1/tasks`：本人发起的受治理动作，新的在前。
pub async fn list_tasks(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let ctx = match resolve_lifecycle_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let g = &state.governance;
    let rows: Result<Vec<TaskRow>, _> = sqlx::query_as(&format!(
        "{TASK_QUERY} and (not $5 or ae.action_key = 'tenant.delete') order by ae.created_at desc limit $4"
    ))
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .bind(g.cfg.projection_freshness_seconds)
    .bind(g.cfg.page_limit)
    .bind(ctx.access_mode == contracts::PlatformSessionAccessMode::LifecycleRestricted)
    .fetch_all(&g.pool)
    .await;
    match rows {
        Ok(rows) => {
            let mut out = Vec::with_capacity(rows.len());
            for r in rows {
                match task_view(r) {
                    Ok(v) => out.push(v),
                    Err(resp) => return resp,
                }
            }
            (StatusCode::OK, Json(out)).into_response()
        }
        Err(e) => Refusal::from(e).respond(None),
    }
}

/// `GET /api/v1/tasks/{actionExecutionId}`。别人的与不存在的是同一个回答。
pub async fn get_task(
    State(state): State<BffState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_lifecycle_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let g = &state.governance;
    let row: Result<Option<TaskRow>, _> = sqlx::query_as(&format!(
        "{TASK_QUERY} and ae.id = $4 and (not $5 or ae.action_key = 'tenant.delete')"
    ))
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .bind(g.cfg.projection_freshness_seconds)
    .bind(id)
    .bind(ctx.access_mode == contracts::PlatformSessionAccessMode::LifecycleRestricted)
    .fetch_optional(&g.pool)
    .await;
    match row {
        Ok(Some(r)) => match task_view(r) {
            Ok(mut v) => {
                match g.available_cancel_action(actor(&ctx), id).await {
                    Ok(key) => v.cancel_action_key = key,
                    Err(e) => {
                        tracing::warn!(task = %id, error = ?e, "任务控制可用性不可查；不提供入口");
                    }
                }
                match g.available_rerun_action(actor(&ctx), id).await {
                    Ok(key) => v.rerun_action_key = key,
                    Err(e) => {
                        tracing::warn!(task = %id, error = ?e, "任务重跑可用性不可查；不提供入口");
                    }
                }
                (StatusCode::OK, Json(v)).into_response()
            }
            Err(resp) => resp,
        },
        Ok(None) => Refusal::Precondition(ReasonCode::TargetNotFound).respond(None),
        Err(e) => Refusal::from(e).respond(None),
    }
}

#[cfg(test)]
mod task_observation_tests {
    use super::*;

    fn terminal_row(task_status: Option<&str>) -> TaskRow {
        TaskRow {
            id: Uuid::new_v4(),
            operation_id: Uuid::new_v4(),
            action_key: "scope.provision".to_owned(),
            action_version: 1,
            workspace_id: None,
            target_id: Uuid::new_v4(),
            gate_state: "ALLOWED".to_owned(),
            dispatch_state: "DISPATCHED".to_owned(),
            reason_code: None,
            approval_workflow_id: None,
            temporal_workflow_id: Some("workflow".to_owned()),
            created_at: Utc::now(),
            approval_status: None,
            approval_ref_state: None,
            approval_ref_stale: None,
            kind: Some("TENANT_LIFECYCLE".to_owned()),
            ref_state: Some("TERMINAL".to_owned()),
            ref_stale: Some(false),
            task_status: task_status.map(str::to_owned),
            waiting_reason: None,
            observation_gap: Some(false),
        }
    }

    #[test]
    fn terminal_ref_requires_terminal_task_projection() {
        assert_eq!(
            observation(&terminal_row(None)),
            Some(ReasonCode::ProjectionDelayed)
        );
        assert_eq!(
            observation(&terminal_row(Some("RUNNING"))),
            Some(ReasonCode::ProjectionDelayed)
        );
        assert_eq!(observation(&terminal_row(Some("COMPLETED"))), None);
    }

    #[test]
    fn unknown_persisted_task_enums_do_not_become_absent_fields() {
        let mut row = terminal_row(Some("COMPLETED"));
        row.reason_code = Some("UNRECOGNIZED_REASON".to_owned());
        assert_eq!(
            task_view(row).unwrap_err().status(),
            StatusCode::SERVICE_UNAVAILABLE
        );

        let mut row = terminal_row(Some("COMPLETED"));
        row.approval_status = Some("UNRECOGNIZED_APPROVAL".to_owned());
        assert_eq!(
            task_view(row).unwrap_err().status(),
            StatusCode::SERVICE_UNAVAILABLE
        );

        let mut row = terminal_row(Some("COMPLETED"));
        row.kind = Some("UNRECOGNIZED_KIND".to_owned());
        assert_eq!(
            task_view(row).unwrap_err().status(),
            StatusCode::SERVICE_UNAVAILABLE
        );

        let row = terminal_row(Some("UNRECOGNIZED_TASK"));
        assert_eq!(
            task_view(row).unwrap_err().status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
}

// ---------------------------------------------------------------------------
// 审批
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct ApprovalRow {
    workflow_id: String,
    action_execution_id: Uuid,
    action_key: String,
    target_type: String,
    target_id: Uuid,
    workspace_id: Option<Uuid>,
    tenant_id: Uuid,
    initiator_principal_id: Uuid,
    status: String,
    decisions: Value,
    expires_at: DateTime<Utc>,
    consume_deadline: Option<DateTime<Utc>>,
    reason_code: Option<String>,
    role_requirements: Value,
    self_approval: String,
    ref_state: String,
}

const APPROVAL_QUERY: &str = "
    select ap.workflow_id, ae.id as action_execution_id, ae.action_key, d.target_type, ae.target_id,
           ae.workspace_id, ae.tenant_id, ae.initiator_principal_id, ap.status, ap.decisions,
           ap.expires_at, ap.consume_deadline, ap.reason_code, pol.role_requirements,
           pol.self_approval, w.projection_state as ref_state
    from projection.approval_projection ap
    join admission.action_execution ae on ae.id = ap.action_execution_id
    join projection.workflow_ref w on w.workflow_id = ap.workflow_id
    join catalog.action_definition d on d.action_key = ae.action_key and d.version = ae.action_version
    join catalog.approval_policy pol
      on pol.id = d.approval_policy_id and pol.version = d.approval_policy_version
    where ap.tenant_id = $1";

impl ApprovalRow {
    fn decided_by(&self, principal: Uuid) -> bool {
        self.decisions.as_array().is_some_and(|a| {
            a.iter().any(|d| {
                d.get("approverPrincipalId").and_then(Value::as_str) == Some(&principal.to_string())
            })
        })
    }

    fn view(self) -> Option<ApprovalView> {
        let terminal_ref = self.ref_state == "TERMINAL";
        let open = matches!(self.status.as_str(), "REQUESTED" | "WAITING" | "APPROVED");
        let observation = if self.ref_state == "UNKNOWN" {
            Some(ReasonCode::ExternalResultUnknown)
        } else if terminal_ref && open {
            // Workflow 已终结而投影仍停在未决状态
            Some(ReasonCode::ProjectionDelayed)
        } else {
            None
        };
        Some(ApprovalView {
            workflow_id: self.workflow_id,
            action_execution_id: self.action_execution_id.to_string(),
            action_key: self.action_key,
            target_type: self.target_type,
            target_id: self.target_id.to_string(),
            workspace_id: self.workspace_id.map(|w| w.to_string()),
            initiator_principal_id: self.initiator_principal_id.to_string(),
            status: parse(&self.status)?,
            expires_at: rfc3339(self.expires_at),
            consume_deadline: self.consume_deadline.map(rfc3339),
            decisions: serde_json::from_value(self.decisions).ok()?,
            role_requirements: serde_json::from_value(self.role_requirements).ok()?,
            reason: self.reason_code.as_deref().and_then(parse),
            observation,
        })
    }
}

/// 调用方此刻能否满足该审批的某个选择器或冻结 owner 要求。普通列表使用低延迟
/// 一致性（`.design/10` §1）；受限会话只以 fresh 角色或同一 snapshot 的 owner 资格可见。
/// 真正的决定仍由 FreshApprovalAdmission 以 FullyConsistent 判定。
async fn eligible(
    g: &Governance,
    ctx: &ExecutionContext,
    row: &ApprovalRow,
    cache: &mut HashMap<(String, Uuid), bool>,
) -> Result<bool, Refusal> {
    if row.self_approval == "DENY" && row.initiator_principal_id == ctx.tenant_principal_id {
        return Ok(false);
    }
    let catalog_approval = row.action_key == crate::capability_contract::APPROVE;
    if catalog_approval {
        let ae = crate::governance::load_execution(&g.pool, row.action_execution_id)
            .await?
            .ok_or_else(|| Refusal::Unavailable("Catalog approval action unavailable".into()))?;
        let mut conn = g.pool.acquire().await?;
        if !crate::capability_contract::approver_separated(&mut conn, &ae, ctx.tenant_principal_id)
            .await?
        {
            return Ok(false);
        }
    }
    let reqs: Vec<contracts::ApprovalRoleRequirement> =
        serde_json::from_value(row.role_requirements.clone()).unwrap_or_default();
    for r in reqs {
        let object = match r.selector {
            ApprovalSelector::TenantAdmin => Some(("tenant", row.tenant_id)),
            ApprovalSelector::WorkspaceAdmin => row.workspace_id.map(|w| ("workspace", w)),
            ApprovalSelector::ResourceApprover => None,
        };
        let Some((ty, id)) = object else { continue };
        let key = (ty.to_owned(), id);
        let allowed = match cache.get(&key).filter(|_| !catalog_approval) {
            Some(a) => *a,
            None => {
                let c = g
                    .spicedb
                    .check(
                        ty,
                        &id.to_string(),
                        "manage",
                        &ctx.tenant_principal_id.to_string(),
                        if catalog_approval
                            || ctx.access_mode
                                == contracts::PlatformSessionAccessMode::LifecycleRestricted
                        {
                            Consistency::FullyConsistent
                        } else {
                            Consistency::MinimizeLatency
                        },
                    )
                    .await
                    .map_err(|e| Refusal::Unavailable(e.to_string()))?;
                cache.insert(key, c.allowed);
                c.allowed
            }
        };
        if allowed {
            return Ok(true);
        }
    }
    if crate::governance::installation_permission::is_grant(&row.action_key)
        && ctx.access_mode == contracts::PlatformSessionAccessMode::Full
    {
        crate::governance::installation_permission::approval_owner_eligible(
            g,
            ctx.tenant_id,
            ctx.tenant_principal_id,
            row.action_execution_id,
        )
        .await
    } else if row.action_key == "tenant.delete" {
        crate::bff::lifecycle_owner_eligible(
            g,
            ctx.tenant_id,
            ctx.tenant_principal_id,
            Some(row.action_execution_id),
        )
        .await
    } else {
        Ok(false)
    }
}

/// `GET /api/v1/approvals`：待我审批——未决、我尚未决定、我能满足某个选择器。
pub async fn list_pending_approvals(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let ctx = match resolve_lifecycle_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let g = &state.governance;
    let rows: Result<Vec<ApprovalRow>, _> = sqlx::query_as(&format!(
        "{APPROVAL_QUERY} and ap.status in ('REQUESTED', 'WAITING') and (not $3 or ae.action_key = 'tenant.delete') order by ae.created_at limit $2"
    ))
    .bind(ctx.tenant_id)
    .bind(g.cfg.page_limit)
    .bind(ctx.access_mode == contracts::PlatformSessionAccessMode::LifecycleRestricted)
    .fetch_all(&g.pool)
    .await;
    let rows = match rows {
        Ok(r) => r,
        Err(e) => return Refusal::from(e).respond(None),
    };
    let mut cache = HashMap::new();
    let mut out = vec![];
    for row in rows {
        if row.decided_by(ctx.tenant_principal_id) {
            continue;
        }
        match eligible(g, &ctx, &row, &mut cache).await {
            Ok(true) => {}
            Ok(false) => continue,
            Err(r) => return r.respond(None),
        }
        match row.view() {
            Some(v) => out.push(v),
            None => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        }
    }
    (StatusCode::OK, Json(out)).into_response()
}

/// `GET /api/v1/approvals/{workflowId}`：发起者、已决定者或此刻合格的审批者可见。
pub async fn get_approval(
    State(state): State<BffState>,
    Path(workflow_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_lifecycle_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let g = &state.governance;
    let row: Result<Option<ApprovalRow>, _> = sqlx::query_as(&format!(
        "{APPROVAL_QUERY} and ap.workflow_id = $2 and (not $3 or ae.action_key = 'tenant.delete')"
    ))
    .bind(ctx.tenant_id)
    .bind(&workflow_id)
    .bind(ctx.access_mode == contracts::PlatformSessionAccessMode::LifecycleRestricted)
    .fetch_optional(&g.pool)
    .await;
    let not_found = || Refusal::Precondition(ReasonCode::TargetNotFound).respond(None);
    let row = match row {
        Ok(Some(r)) => r,
        Ok(None) => return not_found(),
        Err(e) => return Refusal::from(e).respond(None),
    };
    let visible = row.initiator_principal_id == ctx.tenant_principal_id
        || row.decided_by(ctx.tenant_principal_id)
        || match eligible(g, &ctx, &row, &mut HashMap::new()).await {
            Ok(v) => v,
            Err(r) => return r.respond(None),
        };
    if !visible {
        return not_found();
    }
    match row.view() {
        Some(v) => (StatusCode::OK, Json(v)).into_response(),
        None => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// `POST /api/v1/approvals/{workflowId}/decision`：经 Temporal Update 提交决定。
/// Update ID 固定为 `<approval_workflow_id>:<approver_principal_id>`，同一人的
/// 重发由 Server 去重、拿回原结论（`.design/06` §4）。
pub async fn decide(
    State(state): State<BffState>,
    Path(workflow_id): Path<String>,
    headers: HeaderMap,
    body: Result<Json<ApprovalDecisionRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let ctx = match resolve_lifecycle_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let Ok(Json(req)) = body else {
        return Refusal::Precondition(ReasonCode::InvalidParameters).respond(None);
    };
    let g = &state.governance;
    let ae = match g.approval_execution(ctx.tenant_id, &workflow_id).await {
        Ok(Some(ae)) => ae,
        Ok(None) => return Refusal::Precondition(ReasonCode::TargetNotFound).respond(None),
        Err(e) => return Refusal::from(e).respond(None),
    };
    let op = Some(ae.operation_id);
    if ctx.access_mode == contracts::PlatformSessionAccessMode::LifecycleRestricted
        && ae.action_key != "tenant.delete"
    {
        return Refusal::Denied(ReasonCode::ScopeGuardFailed).respond(op);
    }
    let update = ApprovalDecisionUpdate {
        approver_principal_id: ctx.tenant_principal_id.to_string(),
        decision: req.decision.clone(),
    };
    let update_id = format!("{workflow_id}:{}", ctx.tenant_principal_id);
    match g
        .send_update(
            &workflow_id,
            &update_id,
            "decide",
            serde_json::to_value(&update).ok(),
        )
        .await
    {
        UpdateResult::Completed(v) => {
            let Ok(outcome) = serde_json::from_value::<ApprovalDecisionOutcome>(v) else {
                return Refusal::Unavailable("decide 结果不合契约".into()).respond(op);
            };
            if !outcome.admitted {
                let reason = outcome
                    .reason
                    .clone()
                    .unwrap_or(ReasonCode::ApproverNotEligible);
                return Refusal::Denied(reason).respond(op);
            }
            // 同一 Update ID 的重发拿回的是第一次的结论；与本次请求不同就是冲突值
            if outcome.decision.as_ref() != Some(&req.decision) {
                return Refusal::Conflict(ReasonCode::DuplicateDecision).respond(op);
            }
            (StatusCode::OK, Json(outcome)).into_response()
        }
        UpdateResult::Refused(r) => r.respond(op),
    }
}

/// `POST /api/v1/approvals/{workflowId}/withdraw`：发起者撤回仍未决的请求
/// （REQUESTED/WAITING → CANCELLED）。
pub async fn withdraw(
    State(state): State<BffState>,
    Path(workflow_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_lifecycle_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let g = &state.governance;
    let ae = match g.approval_execution(ctx.tenant_id, &workflow_id).await {
        Ok(Some(ae)) if ae.initiator_principal_id == ctx.tenant_principal_id => ae,
        Ok(_) => return Refusal::Precondition(ReasonCode::TargetNotFound).respond(None),
        Err(e) => return Refusal::from(e).respond(None),
    };
    let op = Some(ae.operation_id);
    if ctx.access_mode == contracts::PlatformSessionAccessMode::LifecycleRestricted
        && ae.action_key != "tenant.delete"
    {
        return Refusal::Denied(ReasonCode::ScopeGuardFailed).respond(op);
    }
    match g
        .send_update(
            &workflow_id,
            &format!("{}:withdraw", ae.id),
            "withdraw",
            None,
        )
        .await
    {
        UpdateResult::Completed(v) => match serde_json::from_value::<ApprovalControlOutcome>(v) {
            Ok(o) => (StatusCode::OK, Json(o)).into_response(),
            Err(_) => Refusal::Unavailable("withdraw 结果不合契约".into()).respond(op),
        },
        UpdateResult::Refused(r) => r.respond(op),
    }
}

// ---------------------------------------------------------------------------
// service API（Worker → Core）
// ---------------------------------------------------------------------------

/// `POST /service/v1/approval-projections`：ProjectApprovalState 的写回。
pub async fn project_approval_state(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<ApprovalStateReport>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(report)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    match state.governance.apply_approval_report(&report).await {
        Ok(Applied::Done { approved }) => {
            if let Some(ae) = approved {
                let g: Arc<Governance> = Arc::clone(&state.governance);
                tokio::spawn(async move { g.after_approval(ae).await });
            }
            StatusCode::OK.into_response()
        }
        Ok(Applied::UnknownWorkflow) => StatusCode::NOT_FOUND.into_response(),
        Ok(Applied::Invalid) => StatusCode::BAD_REQUEST.into_response(),
        Err(e) => crate::service_api::unavailable(e),
    }
}

/// `POST /service/v1/approvals/admission`：FreshApprovalAdmission。拒绝是 200 里
/// 的 admitted=false——它是一条要进 history 的结论，不是调用失败。
pub async fn fresh_approval_admission(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<FreshApprovalAdmissionRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    match state.governance.fresh_approval_admission(&req).await {
        Ok(Some(result)) => (StatusCode::OK, Json(result)).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(Refusal::Precondition(_)) => StatusCode::BAD_REQUEST.into_response(),
        Err(r) => {
            tracing::warn!(error = ?r, "FreshApprovalAdmission 依赖不可用");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}
