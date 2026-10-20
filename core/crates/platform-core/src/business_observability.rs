//! 业务操作时间线、Tenant/Workspace 聚合与用量账单读视图（V-REQ-10、`.design/14` §7–8、
//! `.design/11` §6–7、V-SCN-44）。
//!
//! 这里只是受权读模型：ActionExecution/Approval/TaskProjection 给出阶段，Core
//! UsageEvent outbox 给出投递事实，committed usage、额度与账单每次直接读 OpenMeter。
//! Core 不把 OpenMeter 的值复制或聚合成账本；缺失事实只以确定状态呈现，不显示零、
//! 成功、失败或已结算。范围视图与用量账单每次按 `audit` permission fresh 授权；
//! 「我的操作」只返回本人发起或实际执行的操作。

use std::collections::BTreeMap;

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Utc};
use contracts::{
    ActionDispatchState, ActionGateState, BusinessOperationActionSummary, BusinessOperationPage,
    BusinessOperationPhase, BusinessOperationPhaseCount, BusinessOperationSummary,
    BusinessOperationView, MeterUsageState, OperationUsageCount, OperationUsageLine,
    OperationUsageState, ReasonCode, TaskStatus, TaskView, UsageBillingView, UsageCustomerState,
    UsageDeliveryCount, UsageEntitlementView, UsageInvoiceView, UsageMeterView, UsageSectionState,
    UsageSettlementStatus,
};
use futures_util::TryStreamExt;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::audit_views::authorize_scope;
use crate::bff::{db_enum, resolve_execution_context, BffState};
use crate::governance::Refusal;
use crate::governance_api::{task_view, TaskRow, TASK_FROM, TASK_SELECT};
use crate::openmeter::MeterUsage;

/// 根 ActionExecution 的读取列：TaskView 所需列之外，加上发起者/执行者、动作定义
/// 是否声明用量来源、可证明的终态时间与该 operation 的 UsageEvent 投递事实。
/// 参数固定为 `$1` Tenant、`$3` 投影新鲜度秒数；`filter` 只引用 `$2`、`$4`、`$5`。
fn operation_query(filter: &str) -> String {
    format!(
        "{TASK_SELECT},
           ae.initiator_principal_id, ae.actor_principal_id,
           exists(select 1 from catalog.action_definition d
                  where (d.id = ae.action_definition_id
                         or (ae.action_definition_id is null
                             and d.action_key = ae.action_key and d.version = ae.action_version))
                    and d.obs_usage_source <> 'NONE') as metered,
           -- 确定终态时间只取审计事实（审计按 operation 追加，action_execution_id 可空）：
           -- Workflow 取与 TaskProjection 终态同名的首个 OUTCOME；同步动作取首个
           -- DISPATCHED 或 OUTCOME。投影写回、兜底对账或后来的过期/撤销不当作终态时间。
           case
             when tp.status in ('COMPLETED','FAILED','CANCELED','TERMINATED','TIMED_OUT')
               then (select min(a.occurred_at) from audit.audit_event a
                     where a.tenant_id = ae.tenant_id and a.operation_id = ae.operation_id
                       and a.event_type = 'OUTCOME' and a.result_code = tp.status)
             when ae.temporal_workflow_id is null and ae.gate_state = 'ALLOWED'
                  and ae.dispatch_state = 'DISPATCHED'
               then (select min(a.occurred_at) from audit.audit_event a
                     where a.tenant_id = ae.tenant_id and a.operation_id = ae.operation_id
                       and ((a.event_type = 'DISPATCH' and a.result_code = 'DISPATCHED')
                            or a.event_type = 'OUTCOME'))
           end as terminal_at,
           coalesce((select jsonb_agg(jsonb_build_object(
                         'meterKey', u.meter_key, 'quantity', u.quantity,
                         'status', u.settlement_status)
                       order by u.occurred_at, u.meter_key)
                     from outbox.usage_event u where u.operation_id = ae.operation_id),
                    '[]'::jsonb) as usage
         {TASK_FROM}
         where ae.tenant_id = $1 and ae.parent_action_execution_id is null and {filter}"
    )
}

#[derive(sqlx::FromRow)]
struct OperationRow {
    #[sqlx(flatten)]
    task: TaskRow,
    initiator_principal_id: Uuid,
    actor_principal_id: Uuid,
    metered: bool,
    terminal_at: Option<DateTime<Utc>>,
    usage: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageRow {
    meter_key: String,
    quantity: i64,
    status: String,
}

/// 与共用任务页的阶段呈现同序判定：投影不可担保优先，其次准入、派发与 Workflow。
fn operation_phase(task: &TaskView) -> BusinessOperationPhase {
    use BusinessOperationPhase as P;
    match task.observation {
        Some(ReasonCode::ExternalResultUnknown) => return P::Unknown,
        Some(_) => return P::ProjectionDelayed,
        None => {}
    }
    match task.gate_state {
        ActionGateState::Evaluating => return P::Evaluating,
        ActionGateState::Waiting => return P::AwaitingApproval,
        ActionGateState::Denied => return P::Denied,
        ActionGateState::Revoked => return P::Revoked,
        ActionGateState::Expired => return P::Expired,
        ActionGateState::Allowed => {}
    }
    match task.dispatch_state {
        ActionDispatchState::NotDispatched => return P::NotStarted,
        ActionDispatchState::Aborted => return P::Aborted,
        ActionDispatchState::Unknown => return P::Unknown,
        ActionDispatchState::Dispatched => {}
    }
    if task.workflow_id.is_none() {
        // 取消请求被接受不等于原 Workflow 已终结
        return if task.action_key.starts_with("task.cancel.") {
            P::CancelRequested
        } else {
            P::Applied
        };
    }
    match task.task_status {
        None | Some(TaskStatus::Running) => P::Running,
        Some(TaskStatus::Completed) => P::Completed,
        Some(TaskStatus::Failed) => P::Failed,
        Some(TaskStatus::Canceled) => P::Canceled,
        Some(TaskStatus::Terminated) => P::Terminated,
        Some(TaskStatus::TimedOut) => P::TimedOut,
    }
}

/// 只有确定终态才计入耗时；等待、运行、不明与撤销单列，不进入平均值。
fn timed_terminal(phase: &BusinessOperationPhase) -> bool {
    use BusinessOperationPhase as P;
    matches!(
        phase,
        P::Applied | P::Completed | P::Failed | P::Canceled | P::Terminated | P::TimedOut
    )
}

/// `.design/11` §4 第 7 条与 `.design/14` §8：只从 outbox 事实推出，不补零。
fn usage_state(
    metered: bool,
    dispatch: &ActionDispatchState,
    lines: &[OperationUsageLine],
) -> OperationUsageState {
    use UsageSettlementStatus as S;
    if lines.is_empty() {
        return if !metered {
            OperationUsageState::NotMetered
        } else if *dispatch != ActionDispatchState::Dispatched {
            OperationUsageState::NotDispatched
        } else {
            OperationUsageState::BillingUnavailable
        };
    }
    if lines.iter().any(|l| l.status == S::Unknown) {
        OperationUsageState::Unknown
    } else if lines.iter().any(|l| l.status == S::Failed) {
        OperationUsageState::Failed
    } else if lines
        .iter()
        .any(|l| matches!(l.status, S::PendingPublish | S::Accepted))
    {
        OperationUsageState::SettlementPending
    } else {
        OperationUsageState::Committed
    }
}

struct Operation {
    view: BusinessOperationView,
    seconds: Option<f64>,
}

#[allow(clippy::result_large_err)]
fn operation(row: OperationRow) -> Result<Operation, Response> {
    let created_at = row.task.created_at;
    let usage: Vec<UsageRow> = serde_json::from_value(row.usage)
        .map_err(|e| Refusal::Unavailable(format!("UsageEvent 聚合不合形状: {e}")).respond(None))?;
    let usage = usage
        .into_iter()
        .map(|u| -> Result<OperationUsageLine, Response> {
            Ok(OperationUsageLine {
                meter_key: u.meter_key,
                quantity: u.quantity,
                status: db_enum("usage_event.settlement_status", &u.status)?,
            })
        })
        .collect::<Result<Vec<_>, Response>>()?;
    let task = task_view(row.task)?;
    let phase = operation_phase(&task);
    let usage_state = usage_state(row.metered, &task.dispatch_state, &usage);
    let terminal = row.terminal_at.filter(|_| timed_terminal(&phase));
    let seconds = terminal
        .map(|t| (t - created_at).num_milliseconds() as f64 / 1000.0)
        .filter(|s| *s >= 0.0);
    Ok(Operation {
        view: BusinessOperationView {
            operation_id: task.operation_id,
            action_execution_id: task.action_execution_id,
            action_key: task.action_key,
            action_version: task.action_version,
            workspace_id: task.workspace_id,
            target_id: task.target_id,
            initiator_principal_id: row.initiator_principal_id.to_string(),
            actor_principal_id: row.actor_principal_id.to_string(),
            phase,
            reason: task.reason,
            approval_status: task.approval_status,
            workflow_kind: task.workflow_kind,
            usage_state,
            usage,
            created_at: task.created_at,
            terminal_at: terminal.map(|t| t.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true)),
        },
        seconds,
    })
}

#[derive(Deserialize)]
pub struct OperationsQuery {
    /// `mine`：本人发起或实际执行；`tenant`/`workspace`：持有该范围 audit 时的全部操作
    scope: String,
    #[serde(rename = "workspaceId")]
    workspace_id: Option<Uuid>,
    cursor: Option<Uuid>,
}

/// `GET /api/v1/operations`：业务操作时间线，新的在前。
pub async fn list_operations(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(query): Query<OperationsQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let mine = match (query.scope.as_str(), query.workspace_id) {
        ("mine", None) => true,
        ("tenant", None) | ("workspace", Some(_)) => false,
        _ => return Refusal::Precondition(ReasonCode::InvalidParameters).respond(None),
    };
    if !mine {
        if let Err(r) = authorize_scope(&state, &ctx, query.workspace_id).await {
            return r;
        }
    }
    let filter = if mine {
        "(ae.initiator_principal_id = $2 or ae.actor_principal_id = $2)"
    } else {
        "($2::uuid is null or ae.workspace_id = $2)"
    };
    let page = state.governance.cfg.page_limit;
    let rows: Result<Vec<OperationRow>, _> = sqlx::query_as(&format!(
        "{} and ($4::uuid is null or (ae.created_at, ae.id) < (
                select created_at, id from admission.action_execution
                where id = $4 and tenant_id = $1))
         order by ae.created_at desc, ae.id desc limit $5",
        operation_query(filter)
    ))
    .bind(ctx.tenant_id)
    .bind(if mine {
        Some(ctx.tenant_principal_id)
    } else {
        query.workspace_id
    })
    .bind(state.governance.cfg.projection_freshness_seconds)
    .bind(query.cursor)
    .bind(page + 1)
    .fetch_all(&state.pool)
    .await;
    let mut rows = match rows {
        Ok(r) => r,
        Err(e) => return Refusal::from(e).respond(None),
    };
    let limit = usize::try_from(page).unwrap_or(usize::MAX);
    let more = rows.len() > limit;
    rows.truncate(limit);
    let next_cursor = if more {
        rows.last().map(|r| r.task.id.to_string())
    } else {
        None
    };
    let mut operations = Vec::with_capacity(rows.len());
    for row in rows {
        match operation(row) {
            Ok(o) => operations.push(o.view),
            Err(r) => return r,
        }
    }
    Json(BusinessOperationPage {
        operations,
        next_cursor,
    })
    .into_response()
}

#[derive(Deserialize)]
pub struct WindowQuery {
    #[serde(rename = "workspaceId")]
    workspace_id: Option<Uuid>,
    from: String,
    to: String,
}

#[allow(clippy::result_large_err)]
fn window(query: &WindowQuery) -> Result<(DateTime<Utc>, DateTime<Utc>), Response> {
    let parse = |s: &str| DateTime::parse_from_rfc3339(s).map(|t| t.with_timezone(&Utc));
    match (parse(&query.from), parse(&query.to)) {
        (Ok(from), Ok(to)) if from < to => Ok((from, to)),
        _ => Err(Refusal::Precondition(ReasonCode::InvalidParameters).respond(None)),
    }
}

#[derive(Default)]
struct ActionTotals {
    total: i64,
    phases: BTreeMap<String, (BusinessOperationPhase, i64)>,
    timed: i64,
    seconds: f64,
}

#[derive(Default)]
struct Aggregate {
    total: i64,
    phases: BTreeMap<String, (BusinessOperationPhase, i64)>,
    actions: BTreeMap<String, ActionTotals>,
    usage: BTreeMap<String, (OperationUsageState, i64)>,
}

fn bump<T: Clone + serde::Serialize>(map: &mut BTreeMap<String, (T, i64)>, value: &T) {
    let key = serde_json::to_string(value).unwrap_or_default();
    map.entry(key).or_insert_with(|| (value.clone(), 0)).1 += 1;
}

/// 区间内（按 ActionExecution 创建时间）范围内全部根操作的阶段与用量状态聚合。
/// 逐行流式累计，不把整段结果载入内存。
async fn aggregate(
    state: &BffState,
    tenant: Uuid,
    workspace: Option<Uuid>,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<Aggregate, Response> {
    let sql = format!(
        "{} and ae.created_at >= $4 and ae.created_at < $5",
        operation_query("($2::uuid is null or ae.workspace_id = $2)")
    );
    let mut rows = sqlx::query_as::<_, OperationRow>(&sql)
        .bind(tenant)
        .bind(workspace)
        .bind(state.governance.cfg.projection_freshness_seconds)
        .bind(from)
        .bind(to)
        .fetch(&state.pool);
    let mut out = Aggregate::default();
    loop {
        let row = match rows.try_next().await {
            Ok(Some(row)) => row,
            Ok(None) => break,
            Err(e) => return Err(Refusal::from(e).respond(None)),
        };
        let op = operation(row)?;
        out.total += 1;
        bump(&mut out.phases, &op.view.phase);
        bump(&mut out.usage, &op.view.usage_state);
        let action = out.actions.entry(op.view.action_key.clone()).or_default();
        action.total += 1;
        bump(&mut action.phases, &op.view.phase);
        if let Some(seconds) = op.seconds {
            action.timed += 1;
            action.seconds += seconds;
        }
    }
    Ok(out)
}

fn phase_counts(
    phases: BTreeMap<String, (BusinessOperationPhase, i64)>,
) -> Vec<BusinessOperationPhaseCount> {
    phases
        .into_values()
        .map(|(phase, count)| BusinessOperationPhaseCount { phase, count })
        .collect()
}

fn usage_counts(usage: BTreeMap<String, (OperationUsageState, i64)>) -> Vec<OperationUsageCount> {
    usage
        .into_values()
        .map(|(state, count)| OperationUsageCount { state, count })
        .collect()
}

fn rfc3339(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true)
}

/// `GET /api/v1/operations/summary`：Tenant/Workspace 业务聚合，需该范围 `audit`。
pub async fn summary(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(query): Query<WindowQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let (from, to) = match window(&query) {
        Ok(w) => w,
        Err(r) => return r,
    };
    if let Err(r) = authorize_scope(&state, &ctx, query.workspace_id).await {
        return r;
    }
    let agg = match aggregate(&state, ctx.tenant_id, query.workspace_id, from, to).await {
        Ok(a) => a,
        Err(r) => return r,
    };
    let actions = agg
        .actions
        .into_iter()
        .map(|(action_key, a)| BusinessOperationActionSummary {
            action_key,
            total: a.total,
            phases: phase_counts(a.phases),
            timed_terminal_count: a.timed,
            average_terminal_seconds: (a.timed > 0).then(|| a.seconds / a.timed as f64),
        })
        .collect();
    Json(BusinessOperationSummary {
        tenant_id: ctx.tenant_id.to_string(),
        workspace_id: query.workspace_id.map(|w| w.to_string()),
        from: rfc3339(from),
        to: rfc3339(to),
        total: agg.total,
        phases: phase_counts(agg.phases),
        actions,
        usage_states: usage_counts(agg.usage),
    })
    .into_response()
}

/// `GET /api/v1/usage-billing`：用量与账单，需该范围 `audit`。
pub async fn usage_billing(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(query): Query<WindowQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let (from, to) = match window(&query) {
        Ok(w) => w,
        Err(r) => return r,
    };
    if let Err(r) = authorize_scope(&state, &ctx, query.workspace_id).await {
        return r;
    }
    let openmeter = &state.governance.openmeter;
    let binding: Result<Option<(String, String, String)>, _> = sqlx::query_as(
        "select namespace, customer_id, status from projection.openmeter_binding
         where tenant_id = $1",
    )
    .bind(ctx.tenant_id)
    .fetch_optional(&state.pool)
    .await;
    let customer_state = match binding {
        Err(e) => return Refusal::from(e).respond(None),
        Ok(None) => (UsageCustomerState::NotProvisioned, None),
        Ok(Some((_, _, status))) if status == "REVOKED" => (UsageCustomerState::Revoked, None),
        Ok(Some((namespace, customer_id, status)))
            if status == "ACTIVE" && namespace == openmeter.namespace() =>
        {
            match openmeter.customer_by_id(&customer_id, ctx.tenant_id).await {
                Ok(Some(customer)) if customer.is_active() => {
                    (UsageCustomerState::Active, Some(customer_id))
                }
                Ok(_) | Err(_) => (UsageCustomerState::Unavailable, None),
            }
        }
        Ok(Some(_)) => (UsageCustomerState::Unavailable, None),
    };
    let (customer_state, customer) = customer_state;
    let unavailable_section = || match customer_state {
        UsageCustomerState::NotProvisioned => UsageSectionState::NotProvisioned,
        _ => UsageSectionState::Unavailable,
    };

    let meter_keys: Result<Vec<String>, _> = sqlx::query_scalar(
        "select distinct m from catalog.action_definition d, unnest(d.meters) m
         where d.status = 'ACTIVE' order by m",
    )
    .fetch_all(&state.pool)
    .await;
    let meter_keys = match meter_keys {
        Ok(k) => k,
        Err(e) => return Refusal::from(e).respond(None),
    };
    let mut meters = Vec::with_capacity(meter_keys.len());
    for meter_key in meter_keys {
        let Some(customer_id) = customer.as_deref() else {
            meters.push(UsageMeterView {
                meter_key,
                aggregation: None,
                state: MeterUsageState::Unavailable,
                quantity: None,
            });
            continue;
        };
        let (meter_state, aggregation, quantity) = match openmeter
            .committed_meter_usage(customer_id, &meter_key, query.workspace_id, from, to)
            .await
        {
            Ok(MeterUsage::Committed {
                aggregation,
                quantity,
            }) => (
                MeterUsageState::Committed,
                Some(aggregation),
                Some(quantity),
            ),
            Ok(MeterUsage::NoCommittedUsage { aggregation }) => {
                (MeterUsageState::NoCommittedUsage, Some(aggregation), None)
            }
            Ok(MeterUsage::WorkspaceDimensionUnavailable { aggregation }) => (
                MeterUsageState::WorkspaceDimensionUnavailable,
                Some(aggregation),
                None,
            ),
            Ok(MeterUsage::NotRegistered) => (MeterUsageState::MeterNotRegistered, None, None),
            Err(e) => {
                tracing::warn!(error = %e, meter = %meter_key, "OpenMeter committed usage 不可查证");
                (MeterUsageState::Unavailable, None, None)
            }
        };
        meters.push(UsageMeterView {
            meter_key,
            aggregation,
            state: meter_state,
            quantity,
        });
    }

    let (entitlement_state, entitlements) = if query.workspace_id.is_some() {
        (UsageSectionState::TenantScopeOnly, Vec::new())
    } else if let Some(customer_id) = customer.as_deref() {
        match openmeter
            .entitlement_facts(ctx.tenant_id, customer_id)
            .await
        {
            Ok(facts) => (
                UsageSectionState::Available,
                facts
                    .into_iter()
                    .map(|f| UsageEntitlementView {
                        feature_key: f.feature_key,
                        entitlement_type: f.kind.to_owned(),
                        has_access: f.has_access,
                        balance: f.balance,
                        usage: f.usage,
                        overage: f.overage,
                    })
                    .collect(),
            ),
            Err(e) => {
                tracing::warn!(error = %e, "OpenMeter entitlement 不可查证");
                (UsageSectionState::Unavailable, Vec::new())
            }
        }
    } else {
        (unavailable_section(), Vec::new())
    };

    let (billing_state, invoices) = if query.workspace_id.is_some() {
        (UsageSectionState::TenantScopeOnly, Vec::new())
    } else if let Some(customer_id) = customer.as_deref() {
        match openmeter.invoice_facts(customer_id).await {
            Ok(facts) => (
                UsageSectionState::Available,
                facts
                    .into_iter()
                    .map(|f| {
                        let (period_from, period_to) = f.service_period.unzip();
                        UsageInvoiceView {
                            id: f.id,
                            number: f.number,
                            status: f.status,
                            currency: f.currency,
                            total: f.total,
                            service_period_from: period_from,
                            service_period_to: period_to,
                            issued_at: f.issued_at,
                        }
                    })
                    .collect(),
            ),
            Err(e) => {
                tracing::warn!(error = %e, "OpenMeter invoice 不可查证");
                (UsageSectionState::Unavailable, Vec::new())
            }
        }
    } else {
        (unavailable_section(), Vec::new())
    };

    let delivery: Result<Vec<(String, i64)>, _> = sqlx::query_as(
        "select settlement_status, count(*) from outbox.usage_event
         where tenant_id = $1 and ($2::uuid is null or workspace_id = $2)
           and occurred_at >= $3 and occurred_at < $4
         group by settlement_status order by settlement_status",
    )
    .bind(ctx.tenant_id)
    .bind(query.workspace_id)
    .bind(from)
    .bind(to)
    .fetch_all(&state.pool)
    .await;
    let delivery = match delivery {
        Ok(rows) => rows,
        Err(e) => return Refusal::from(e).respond(None),
    };
    let mut delivery_counts = Vec::with_capacity(delivery.len());
    for (status, count) in delivery {
        match db_enum("usage_event.settlement_status", &status) {
            Ok(status) => delivery_counts.push(UsageDeliveryCount { status, count }),
            Err(r) => return r,
        }
    }
    let agg = match aggregate(&state, ctx.tenant_id, query.workspace_id, from, to).await {
        Ok(a) => a,
        Err(r) => return r,
    };

    Json(UsageBillingView {
        tenant_id: ctx.tenant_id.to_string(),
        workspace_id: query.workspace_id.map(|w| w.to_string()),
        from: rfc3339(from),
        to: rfc3339(to),
        customer_state,
        meters,
        entitlement_state,
        entitlements,
        delivery: delivery_counts,
        operation_usage: usage_counts(agg.usage),
        billing_state,
        invoices,
    })
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(status: UsageSettlementStatus) -> OperationUsageLine {
        OperationUsageLine {
            meter_key: "m".into(),
            quantity: 1,
            status,
        }
    }

    #[test]
    fn missing_usage_is_never_rendered_as_settled_or_zero() {
        use OperationUsageState as O;
        use UsageSettlementStatus as S;
        let dispatched = ActionDispatchState::Dispatched;
        assert_eq!(usage_state(false, &dispatched, &[]), O::NotMetered);
        assert_eq!(
            usage_state(true, &ActionDispatchState::NotDispatched, &[]),
            O::NotDispatched
        );
        assert_eq!(usage_state(true, &dispatched, &[]), O::BillingUnavailable);
        assert_eq!(
            usage_state(true, &dispatched, &[line(S::Committed), line(S::Accepted)]),
            O::SettlementPending
        );
        assert_eq!(
            usage_state(true, &dispatched, &[line(S::Committed), line(S::Unknown)]),
            O::Unknown
        );
        assert_eq!(
            usage_state(true, &dispatched, &[line(S::Failed), line(S::Committed)]),
            O::Failed
        );
        assert_eq!(
            usage_state(true, &dispatched, &[line(S::Committed)]),
            O::Committed
        );
    }
}
