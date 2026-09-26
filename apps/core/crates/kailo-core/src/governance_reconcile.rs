//! 受治理动作的兜底收敛与度量（`.design/06` §3.1、`07` §3、RB-05）。
//!
//! 主路径在请求里就走完：判定、派发、审批投影到达后的重新准入与 consume。这里
//! 只收拾主路径没走完的——进程崩溃、依赖暂不可用、Update 结果不明——每一轮取一批
//! 非终态 ActionExecution，交给 `Governance::drive` 做它此刻该做的那一步。drive
//! 只看持久化事实，按固定 workflow ID 与固定 Update ID 行事，重复执行无害。
//!
//! 每个新状态的终结上界因此是确定的：EVALUATING 与「已允许未派发」在
//! `ADMISSION_EVALUATION_TIMEOUT_SECONDS` 加一个对账周期内被处理；WAITING 以审批
//! 策略的 `expires_in` 为界（Workflow 的 timer）；APPROVED 以 consume 窗口为界。

use std::sync::Arc;
use std::time::Duration;

use opentelemetry::metrics::{Counter, Gauge, Meter};
use opentelemetry::KeyValue;
use uuid::Uuid;

use crate::governance::Governance;

pub struct Config {
    pub interval: Duration,
    pub batch: i64,
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
        })
    }
}

struct Metrics {
    open: Gauge<u64>,
    oldest_age: Gauge<u64>,
    driven: Counter<u64>,
    passes: Counter<u64>,
}

/// 非终态的门禁/派发组合。每轮都记一次，没有行的记 0：告警不能停在旧值上。
const OPEN_STATES: &[(&str, &str)] = &[
    ("EVALUATING", "NOT_DISPATCHED"),
    ("WAITING", "NOT_DISPATCHED"),
    ("ALLOWED", "NOT_DISPATCHED"),
    ("ALLOWED", "UNKNOWN"),
];

pub fn spawn(g: Arc<Governance>, meter: &Meter, cfg: Config) {
    let metrics = Metrics {
        open: meter
            .u64_gauge("kailo.action_execution.open")
            .with_description("门禁未决或已允许未派发的 ActionExecution 数")
            .build(),
        oldest_age: meter
            .u64_gauge("kailo.action_execution.oldest_open_age")
            .with_unit("s")
            .with_description("最久一条未决 ActionExecution 的未收敛时间；UNKNOWN 从创建时计")
            .build(),
        driven: meter
            .u64_counter("kailo.governance_reconcile.driven")
            .with_description("对账作业对单条 ActionExecution 执行的步骤")
            .build(),
        passes: meter
            .u64_counter("kailo.governance_reconcile.passes")
            .with_description("对账轮次，按是否完成区分")
            .build(),
    };
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(cfg.interval);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            let outcome = match pass(&g, &metrics, cfg.batch).await {
                Ok(()) => "COMPLETED",
                Err(e) => {
                    tracing::warn!(error = %e, "治理对账本轮未完成");
                    "FAILED"
                }
            };
            metrics.passes.add(1, &[KeyValue::new("outcome", outcome)]);
        }
    });
}

async fn pass(g: &Governance, metrics: &Metrics, batch: i64) -> Result<(), String> {
    // 只取此刻确有一步可做的行：正常等待审批中的 WAITING 不进批次，否则它们
    // 会永远排在最前，把真正要处理的挤出去。
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "select ae.id from admission.action_execution ae
         left join projection.approval_projection ap on ap.workflow_id = ae.approval_workflow_id
         left join projection.workflow_ref aw on aw.workflow_id = ae.approval_workflow_id
         where (ae.gate_state = 'EVALUATING'
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
            or (ae.gate_state in ('ALLOWED', 'REVOKED') and ap.status = 'APPROVED')
         order by ae.updated_at
         limit $1",
    )
    .bind(batch)
    .bind(g.cfg.evaluation_timeout_seconds)
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

    let rows: Vec<(String, String, i64, i64)> = sqlx::query_as(
        "select gate_state, dispatch_state, count(*),
                coalesce(extract(epoch from now() - min(
                    case when dispatch_state = 'UNKNOWN' then created_at else updated_at end
                ))::bigint, 0)
         from admission.action_execution
         where gate_state in ('EVALUATING', 'WAITING')
            or (gate_state = 'ALLOWED' and dispatch_state <> 'DISPATCHED' and dispatch_state <> 'ABORTED')
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
    Ok(())
}
