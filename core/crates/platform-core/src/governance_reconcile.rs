//! 受治理动作的兜底收敛与度量（`.design/06` §3.1、`07` §3、RB-05）。
//!
//! 主路径在请求里就走完：判定、派发、审批投影到达后的重新准入与 consume。这里
//! 只收拾主路径没走完的——进程崩溃、依赖暂不可用、Update 结果不明——每一轮取一批
//! 非终态 ActionExecution，交给 `Governance::drive` 做它此刻该做的那一步。drive
//! 只看持久化事实，按固定 workflow ID 与固定 Update ID 行事，重复执行无害。
//!
//! 选批按上次尝试时间轮转；一条持续失败的意图不能长期占住批次。对账失败仍保持
//! 原业务状态并发出度量，不把外部结果不明误判为成功或失败。`tenant.bootstrap` 由
//! 部署引导命令按固定 Workflow ID 收敛，不交给普通 ActionDefinition 派发器。

use std::time::Duration;

use opentelemetry::metrics::{Counter, Gauge, Meter};
use opentelemetry::KeyValue;
use uuid::Uuid;

use crate::governance::Governance;
use crate::membership_projection;
use crate::server_keys;
use crate::service_api::ServiceState;

pub struct Config {
    pub interval: Duration,
    pub batch: i64,
    pub secret_ref_rehome_alert_after: Duration,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let get = |k: &str| -> Result<u64, String> {
            std::env::var(k)
                .map_err(|_| format!("缺少 {k}"))?
                .parse::<u64>()
                .ok()
                .filter(|n| *n > 0)
                .ok_or_else(|| format!("{k} 必须是正整数"))
        };
        Ok(Self {
            interval: Duration::from_secs(get("GOVERNANCE_RECONCILE_INTERVAL_SECONDS")?),
            batch: i64::try_from(get("GOVERNANCE_RECONCILE_BATCH")?)
                .map_err(|_| "GOVERNANCE_RECONCILE_BATCH 超出范围".to_owned())?,
            secret_ref_rehome_alert_after: Duration::from_secs(get(
                "SECRET_REF_REHOME_ALERT_AFTER_SECONDS",
            )?),
        })
    }
}

struct Metrics {
    open: Gauge<u64>,
    oldest_age: Gauge<u64>,
    driven: Counter<u64>,
    passes: Counter<u64>,
    rehome_open: Gauge<u64>,
    rehome_oldest_age: Gauge<u64>,
    rehome_overdue: Gauge<u64>,
    provision_open: Gauge<u64>,
    provision_oldest_age: Gauge<u64>,
    provision_overdue: Gauge<u64>,
    provision_orphan_unknown: Gauge<u64>,
    retirement_pending: Gauge<u64>,
    bootstrap_overdue: Gauge<u64>,
    nip11_unverified: Gauge<u64>,
}

/// 非终态的门禁/派发组合。每轮都记一次，没有行的记 0：告警不能停在旧值上。
const OPEN_STATES: &[(&str, &str)] = &[
    ("EVALUATING", "NOT_DISPATCHED"),
    ("WAITING", "NOT_DISPATCHED"),
    ("ALLOWED", "NOT_DISPATCHED"),
    ("ALLOWED", "UNKNOWN"),
    ("REVOKED", "UNKNOWN"),
];

pub fn spawn(
    state: ServiceState,
    memory: crate::bff::BffState,
    meter: &Meter,
    cfg: Config,
    gateway_usage: crate::gateway_usage::Ingress,
) {
    let metrics = Metrics {
        open: meter
            .u64_gauge("platform.action_execution.open")
            .with_description("门禁未决或已允许未派发的 ActionExecution 数")
            .build(),
        oldest_age: meter
            .u64_gauge("platform.action_execution.oldest_open_age")
            .with_unit("s")
            .with_description("最久一条未决 ActionExecution 的未收敛时间；UNKNOWN 从创建时计")
            .build(),
        driven: meter
            .u64_counter("platform.governance_reconcile.driven")
            .with_description("对账作业对单条 ActionExecution 执行的步骤")
            .build(),
        passes: meter
            .u64_counter("platform.governance_reconcile.passes")
            .with_description("对账轮次，按是否完成区分")
            .build(),
        rehome_open: meter
            .u64_gauge("platform.secret_ref_rehome.open")
            .with_description("按状态统计未终态 SecretRef 归位数量")
            .build(),
        rehome_oldest_age: meter
            .u64_gauge("platform.secret_ref_rehome.oldest_open_age")
            .with_unit("s")
            .with_description("按状态统计最老一条未终态归位的持续秒数")
            .build(),
        rehome_overdue: meter
            .u64_gauge("platform.secret_ref_rehome.overdue")
            .with_description("超过部署登记对账期限的 SecretRef 归位数量")
            .build(),
        provision_open: meter
            .u64_gauge("platform.server_key_provision.open")
            .with_description("未收敛的 SERVER HUMAN OpenBao 写入意图")
            .build(),
        provision_oldest_age: meter
            .u64_gauge("platform.server_key_provision.oldest_open_age")
            .with_unit("s")
            .with_description("最老未收敛 SERVER HUMAN 写入意图年龄")
            .build(),
        provision_overdue: meter
            .u64_gauge("platform.server_key_provision.overdue")
            .with_description("超出准入对账上界的 SERVER HUMAN 写入意图")
            .build(),
        retirement_pending: meter
            .u64_gauge("platform.server_key.retirement_pending")
            .with_description("已撤销或已替下、私钥版本尚未销毁查证的平台自持 Nostr 私钥")
            .build(),
        provision_orphan_unknown: meter
            .u64_gauge("platform.server_key_provision.orphan_unknown")
            .with_description("旧版结果不明、无写入意图且无身份投影固定 WorkflowRef 的动作")
            .build(),
        bootstrap_overdue: meter
            .u64_gauge("platform.tenant_bootstrap.overdue")
            .with_description("超过准入对账上界仍未由部署引导命令确认派发的动作")
            .build(),
        nip11_unverified: meter
            .u64_gauge("platform.tenant_buzz_binding.nip11_unverified")
            .with_description(
                "因 NIP-11 漂移停在 RECONCILING、未通过重新查证的 TenantBuzzBinding 数",
            )
            .build(),
    };
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(cfg.interval);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            let outcome = match pass(
                &state,
                &metrics,
                cfg.batch,
                cfg.secret_ref_rehome_alert_after.as_secs(),
            )
            .await
            {
                Ok(()) => "COMPLETED",
                Err(e) => {
                    tracing::warn!(error = %e, "治理对账本轮未完成");
                    "FAILED"
                }
            };
            metrics.passes.add(1, &[KeyValue::new("outcome", outcome)]);
            if let Err(error) = crate::agent_memory::write::reconcile(&memory, cfg.batch).await {
                tracing::warn!(reason_code=%crate::governance::wire(&error.reason()),
                    state="UNKNOWN", "Memory 原固定事件对账未完成；RB-05 保留原 operation");
            }
            if let Err(error) = crate::automation::reconcile(&state, cfg.batch).await {
                tracing::warn!(reason_code=%crate::governance::wire(&error.reason()),
                    state="UNKNOWN", "自动化持久触发对账未完成；原 checkpoint 保留");
            }
            if let Err(error) =
                crate::protocol_session::maintenance::reconcile(&state, cfg.batch).await
            {
                tracing::warn!(reason_code=%crate::governance::wire(&error.reason()),
                    state="UNKNOWN", "ProtocolSession 原生 token 生命周期未收敛");
            }
            if let Err(error) = crate::agent_invocation::reconcile(&state, cfg.batch).await {
                tracing::warn!(reason_code=%crate::governance::wire(&error.reason()),
                    state="UNKNOWN", "普通 Agent 持久触发对账未完成；原 checkpoint 保留");
            }
            // Usage 与 ActionExecution 各自收敛：缺归因保留 Gateway 原游标，
            // 不把它伪结算，也不让它阻止本轮其他治理动作。
            if let Err(reason) = gateway_usage
                .reconcile(
                    &state.pool,
                    cfg.batch,
                    &state.openmeter,
                    state.agent_runtime.as_deref(),
                )
                .await
            {
                tracing::warn!(
                    reason_code = "BILLING_UNAVAILABLE",
                    state = "UNKNOWN",
                    error = reason,
                    "Gateway usage ingress 尚未收敛"
                );
            }
        }
    });
}

async fn pass(
    state: &ServiceState,
    metrics: &Metrics,
    batch: i64,
    rehome_alert_after_secs: u64,
) -> Result<(), String> {
    let g: &Governance = &state.governance;
    g.reconcile_delegations(state.agent_runtime.as_deref(), batch)
        .await
        .map_err(|error| crate::governance::wire(&error.reason()))?;
    crate::application_binding::read_grant::reconcile_expired(state, batch)
        .await
        .map_err(|error| crate::governance::wire(&error.reason()))?;
    // 只取此刻确有一步可做的行：正常等待审批中的 WAITING 不进批次，否则它们
    // 会永远排在最前，把真正要处理的挤出去。
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "with selected as (
         select ae.id from admission.action_execution ae
         left join projection.approval_projection ap on ap.workflow_id = ae.approval_workflow_id
         left join projection.workflow_ref aw on aw.workflow_id = ae.approval_workflow_id
         where ae.action_key <> $4
           and coalesce(ae.parameters->>'componentActionKind','')<>'SERVICE_READ'
           and (ae.action_key not in ('agent.memory.core.replace','agent.memory.entry.set',
                                     'agent.memory.entry.patch','agent.memory.entry.remove')
                or (ae.gate_state='EVALUATING' and ae.dispatch_state='NOT_DISPATCHED'
                    and not exists(select 1 from projection.agent_memory_write mw
                                   where mw.action_execution_id=ae.id)))
           and not (ae.action_key = $3 and ae.gate_state = 'ALLOWED'
                    and ae.dispatch_state = 'UNKNOWN')
           and ((ae.gate_state = 'EVALUATING'
                and ae.updated_at < now() - make_interval(secs => $2::bigint))
            or (ae.gate_state = 'WAITING' and (
                   ap.status = 'APPROVED'
                or (aw.projection_state = 'PENDING_START'
                    and ae.updated_at < now() - make_interval(secs => $2::bigint))
                or (aw.projection_state = 'TERMINAL' and coalesce(ap.status, '') not in
                    ('DENIED', 'EXPIRED', 'CANCELLED', 'INVALIDATED', 'CONSUMED'))))
            or (ae.gate_state = 'ALLOWED' and ae.dispatch_state in ('NOT_DISPATCHED', 'UNKNOWN')
                and ae.updated_at < now() - make_interval(secs => $2::bigint))
            -- 已派发而批准尚未被消费、已撤销而批准尚未失效：重发固定 ID 的 Update
            or (ae.gate_state in ('ALLOWED', 'REVOKED') and ap.status = 'APPROVED'))
         order by coalesce(ae.reconcile_last_attempt_at, ae.updated_at), ae.id
         limit $1 for update of ae skip locked
         )
         update admission.action_execution ae
            set reconcile_last_attempt_at = now()
           from selected where ae.id = selected.id returning ae.id",
    )
    .bind(batch)
    .bind(g.cfg.evaluation_timeout_seconds)
    .bind(server_keys::PROVISION_ACTION)
    .bind(crate::tenant_bootstrap::ACTION_KEY)
    .fetch_all(&g.pool)
    .await
    .map_err(|e| e.to_string())?;
    for id in ids {
        let step = match g.drive(id).await {
            Ok(step) => step,
            Err(e) => {
                tracing::warn!(action = %id, error = ?e, "驱动未完成");
                "FAILED"
            }
        };
        metrics.driven.add(1, &[KeyValue::new("stage", step)]);
    }

    let provision_ids: Vec<Uuid> = sqlx::query_scalar(
        "with selected as (
         select i.action_execution_id from admission.server_key_provision_intent i
         where i.finished_at is null and i.source_membership_id is null
           and i.key_kind = 'HUMAN'
           and not exists (select 1 from admission.action_execution ae
                           where ae.id = i.action_execution_id and ae.tenant_id = i.tenant_id
                             and ae.action_key = $3)
           and i.created_at < now() - make_interval(secs => $2::bigint)
         order by coalesce(i.reconcile_last_attempt_at, i.created_at), i.action_execution_id
         limit $1 for update of i skip locked
         )
         update admission.server_key_provision_intent i
            set reconcile_last_attempt_at = now()
           from selected where i.action_execution_id = selected.action_execution_id
         returning i.action_execution_id",
    )
    .bind(batch)
    .bind(g.cfg.evaluation_timeout_seconds)
    .bind("identity.secret_ref.rehome")
    .fetch_all(&g.pool)
    .await
    .map_err(|e| e.to_string())?;
    for id in provision_ids {
        let step = server_keys::reconcile_provision_intent(state, id).await;
        metrics.driven.add(1, &[KeyValue::new("stage", step)]);
    }
    let legacy_ids: Vec<Uuid> = sqlx::query_scalar(
        "with selected as (
         select ae.id from admission.action_execution ae
         join projection.workflow_ref w on w.action_execution_id = ae.id
         where ae.action_key = $3 and ae.gate_state = 'ALLOWED'
           and ae.dispatch_state in ('NOT_DISPATCHED','UNKNOWN')
           and w.kind = $4
           and not exists (select 1 from admission.server_key_provision_intent i
                           where i.action_execution_id = ae.id)
           and ae.updated_at < now() - make_interval(secs => $2::bigint)
         order by coalesce(ae.reconcile_last_attempt_at, ae.updated_at), ae.id
         limit $1 for update of ae skip locked
         )
         update admission.action_execution ae
            set reconcile_last_attempt_at = now()
           from selected where ae.id = selected.id returning ae.id",
    )
    .bind(batch)
    .bind(g.cfg.evaluation_timeout_seconds)
    .bind(server_keys::PROVISION_ACTION)
    .bind(crate::client_keys::KIND)
    .fetch_all(&g.pool)
    .await
    .map_err(|e| e.to_string())?;
    for id in legacy_ids {
        let step = server_keys::reconcile_legacy_provision(state, id).await;
        metrics.driven.add(1, &[KeyValue::new("stage", step)]);
    }
    let membership_key_ids: Vec<Uuid> = sqlx::query_scalar(
        "with selected as (
         select i.action_execution_id from admission.server_key_provision_intent i
         where i.finished_at is null and i.source_membership_id is not null
           and i.created_at < now() - make_interval(secs => $2::bigint)
         order by coalesce(i.reconcile_last_attempt_at, i.created_at), i.action_execution_id
         limit $1 for update of i skip locked
         )
         update admission.server_key_provision_intent i
            set reconcile_last_attempt_at = now()
           from selected where i.action_execution_id = selected.action_execution_id
         returning i.action_execution_id",
    )
    .bind(batch)
    .bind(g.cfg.evaluation_timeout_seconds)
    .fetch_all(&g.pool)
    .await
    .map_err(|e| e.to_string())?;
    for id in membership_key_ids {
        let step = membership_projection::reconcile_member_key_intent(state, id).await;
        metrics.driven.add(1, &[KeyValue::new("stage", step)]);
    }
    // DD-113 (2) / DD-115 (4)：CONTROL 与 operator 的未绑定写入。CONTROL 超过准入
    // 对账上界后按其 Tenant 建立 operation 是否终态判定；OPERATOR 以冻结的提交截止
    // 为终态判据。同一公平轮转，超出上界的仍由 overdue 度量告警。
    let platform_key_ids: Vec<Uuid> = sqlx::query_scalar(
        "with selected as (
         select i.id from admission.server_key_provision_intent i
         where i.finished_at is null and i.origin = 'PROVISIONED'
           and not exists (select 1 from admission.action_execution ae
                           where ae.id = i.action_execution_id and ae.tenant_id = i.tenant_id
                             and ae.action_key = $3)
           and ((i.key_kind = 'CONTROL'
                 and i.created_at < now() - make_interval(secs => $2::bigint))
                or (i.key_kind = 'OPERATOR' and i.commit_deadline_at <= now()))
         order by coalesce(i.reconcile_last_attempt_at, i.created_at), i.id
         limit $1 for update of i skip locked
         )
         update admission.server_key_provision_intent i
            set reconcile_last_attempt_at = now()
           from selected where i.id = selected.id
         returning i.id",
    )
    .bind(batch)
    .bind(g.cfg.evaluation_timeout_seconds)
    .bind("identity.secret_ref.rehome")
    .fetch_all(&g.pool)
    .await
    .map_err(|e| e.to_string())?;
    for id in platform_key_ids {
        let step = crate::platform_keys::reconcile_platform_key_intent(state, id).await;
        metrics.driven.add(1, &[KeyValue::new("stage", step)]);
    }
    // DD-115 (3)：退役补做——binding 已 REVOKED、意图 BOUND、退役 operation 已冻结，
    // 投影内的 delete/destroy 没有完成的行。
    let retiring_ids: Vec<Uuid> = sqlx::query_scalar(
        "with selected as (
         select i.id from admission.server_key_provision_intent i
         join identity.buzz_identity_binding b
           on b.private_key_secret_ref = i.target_locator and b.tenant_id = i.tenant_id
         where i.key_kind = 'HUMAN' and b.state = 'REVOKED'
           and i.finished_at is not null and i.fenced_at is null and i.destroyed_at is null
           and i.retire_operation_id is not null and i.retired_at is null
         order by coalesce(i.reconcile_last_attempt_at, i.created_at), i.id
         limit $1 for update of i skip locked
         )
         update admission.server_key_provision_intent i
            set reconcile_last_attempt_at = now()
           from selected where i.id = selected.id
         returning i.id",
    )
    .bind(batch)
    .fetch_all(&g.pool)
    .await
    .map_err(|e| e.to_string())?;
    for id in retiring_ids {
        let step = crate::platform_keys::reconcile_retirement(state, id).await;
        metrics.driven.add(1, &[KeyValue::new("stage", step)]);
    }
    // DD-115 (6)：DD-113 之前的轮换遗留、既无引用也无意图的 operator locator。
    match crate::platform_keys::retire_unrecorded_operator_keys(
        state,
        state.catalog_tenant,
        Uuid::new_v4(),
    )
    .await
    {
        Ok(outcomes) => {
            for step in outcomes {
                metrics.driven.add(1, &[KeyValue::new("stage", step)]);
            }
        }
        Err(e) => {
            tracing::warn!(error = %e, "operator 私钥前缀不可列出或判定，遗留 locator 保持并告警")
        }
    }

    let rows: Vec<(String, String, i64, i64)> = sqlx::query_as(
        "select gate_state, dispatch_state, count(*),
                coalesce(extract(epoch from now() - min(
                    case when dispatch_state = 'UNKNOWN' then created_at else updated_at end
                ))::bigint, 0)
         from admission.action_execution
         where gate_state in ('EVALUATING', 'WAITING')
            or (gate_state = 'ALLOWED' and dispatch_state <> 'DISPATCHED' and dispatch_state <> 'ABORTED')
            or (gate_state = 'REVOKED' and dispatch_state = 'UNKNOWN')
         group by gate_state, dispatch_state",
    )
    .fetch_all(&g.pool)
    .await
    .map_err(|e| e.to_string())?;
    for (gate, dispatch) in OPEN_STATES {
        let (n, age) = rows
            .iter()
            .find(|r| r.0 == *gate && r.1 == *dispatch)
            .map(|r| (r.2, r.3))
            .unwrap_or((0, 0));
        // 标签复用 Collector 允许清单里的 state（07 §3）：取值是两个封闭枚举的组合，
        // 不新增键，也不引入高基数
        let attrs = [KeyValue::new("state", format!("{gate}/{dispatch}"))];
        metrics.open.record(n.max(0) as u64, &attrs);
        metrics.oldest_age.record(age.max(0) as u64, &attrs);
    }
    let rows: Vec<(String, i64, i64, i64)> = sqlx::query_as(
        "select state, count(*)::bigint,
                coalesce(extract(epoch from now() - min(created_at))::bigint, 0),
                count(*) filter (where created_at < now() - make_interval(secs => $1::bigint))::bigint
         from admission.secret_ref_rehome
         where state not in ('RETIRED','FAILED')
         group by state",
    )
    .bind(i64::try_from(rehome_alert_after_secs).map_err(|e| e.to_string())?)
    .fetch_all(&g.pool)
    .await
    .map_err(|e| e.to_string())?;
    for state in ["INTENT", "COPY_UNKNOWN", "COPIED", "SWITCHED"] {
        let (open, age, overdue) = rows
            .iter()
            .find(|row| row.0 == state)
            .map(|row| (row.1, row.2, row.3))
            .unwrap_or((0, 0, 0));
        let attrs = [KeyValue::new("state", state)];
        metrics.rehome_open.record(open.max(0) as u64, &attrs);
        metrics.rehome_oldest_age.record(age.max(0) as u64, &attrs);
        metrics.rehome_overdue.record(overdue.max(0) as u64, &attrs);
        if overdue > 0 {
            tracing::warn!(state, overdue, "SecretRef 归位超过对账期限，需运维对账");
        }
    }
    let (open, age, overdue): (i64, i64, i64) = sqlx::query_as(
        "select count(*)::bigint,
                coalesce(extract(epoch from now() - min(created_at))::bigint, 0),
                count(*) filter (where created_at < now() - make_interval(secs => $1::bigint))::bigint
         from admission.server_key_provision_intent where finished_at is null",
    )
    .bind(g.cfg.evaluation_timeout_seconds)
    .fetch_one(&g.pool)
    .await
    .map_err(|e| e.to_string())?;
    metrics.provision_open.record(open.max(0) as u64, &[]);
    metrics.provision_oldest_age.record(age.max(0) as u64, &[]);
    metrics.provision_overdue.record(overdue.max(0) as u64, &[]);
    if overdue > 0 {
        tracing::warn!(overdue, "托管身份写入意图超过治理对账上界，需运维核查");
    }
    // DD-113 (3)(4)(6)：退役结果不明、存量非独占引用或旧 operator key 仍被接受时保持
    // 原状态并告警，不宣称完成。
    let retirement_pending: i64 = sqlx::query_scalar(
        "select (select count(*) from identity.buzz_identity_binding
                 where custody = 'SERVER' and state = 'REVOKED'
                   and private_key_secret_status = 'SUPERSEDED')
              + (select count(*) from admission.server_key_provision_intent i
                 where i.key_kind = 'OPERATOR' and i.finished_at is not null
                   and i.fenced_at is null and i.retired_at is null
                   and not exists (select 1 from identity.relay_operator_identity o
                                   where o.private_key_secret_ref = i.target_locator))",
    )
    .fetch_one(&g.pool)
    .await
    .map_err(|e| e.to_string())?;
    metrics
        .retirement_pending
        .record(retirement_pending.max(0) as u64, &[]);
    if retirement_pending > 0 {
        tracing::warn!(
            retirement_pending,
            "平台自持私钥退役未完成，旧版本仍未销毁查证"
        );
    }
    let orphan_unknown: i64 = sqlx::query_scalar(
        "select count(*)::bigint from admission.action_execution ae
         where ae.action_key = $1 and ae.gate_state = 'ALLOWED'
           and ae.dispatch_state = 'UNKNOWN'
           and not exists (select 1 from admission.server_key_provision_intent i
                           where i.action_execution_id = ae.id)
           and not exists (select 1 from projection.workflow_ref w
                           where w.action_execution_id = ae.id and w.kind = $2)",
    )
    .bind(server_keys::PROVISION_ACTION)
    .bind(crate::client_keys::KIND)
    .fetch_one(&g.pool)
    .await
    .map_err(|e| e.to_string())?;
    metrics
        .provision_orphan_unknown
        .record(orphan_unknown.max(0) as u64, &[]);
    if orphan_unknown > 0 {
        tracing::warn!(
            orphan_unknown,
            "旧版托管身份结果不明且无固定 WorkflowRef；隔离并禁止补写私钥"
        );
    }
    let bootstrap_overdue: i64 = sqlx::query_scalar(
        "select count(*)::bigint from admission.action_execution
         where action_key = $1 and gate_state = 'ALLOWED'
           and dispatch_state in ('NOT_DISPATCHED', 'UNKNOWN')
           and updated_at < now() - make_interval(secs => $2::bigint)",
    )
    .bind(crate::tenant_bootstrap::ACTION_KEY)
    .bind(g.cfg.evaluation_timeout_seconds)
    .fetch_one(&g.pool)
    .await
    .map_err(|e| e.to_string())?;
    metrics
        .bootstrap_overdue
        .record(bootstrap_overdue.max(0) as u64, &[]);
    if bootstrap_overdue > 0 {
        tracing::warn!(
            bootstrap_overdue,
            "部署引导派发未确认，需按固定 Workflow ID 重跑引导命令对账"
        );
    }

    // TenantBuzzBinding 的 NIP-11 漂移（DD-114）：进入、重新查证与告警都在这一步
    let drift = crate::tenant_lifecycle::reconcile_nip11_drift(state, batch).await?;
    for stage in drift.outcomes {
        metrics.driven.add(1, &[KeyValue::new("stage", stage)]);
    }
    metrics.nip11_unverified.record(drift.unverified, &[]);
    for stage in crate::agent_installation::reconcile(state, batch).await? {
        metrics.driven.add(1, &[KeyValue::new("stage", stage)]);
    }
    state
        .capacity
        .reconcile(
            &state.pool,
            &state.temporal,
            state.agent_runtime.as_deref(),
            batch,
        )
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}
