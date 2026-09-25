//! WorkflowRef 的兜底对账与收敛度量（`.design/06` §3.1、`07` §3）。
//!
//! 主路径是 Workflow 自己经 `ProjectTaskState` 写回；这里只修补漏写。每一轮：
//!
//! 1. 取一批超过新鲜度上界仍非 TERMINAL 的 WorkflowRef，按固定 ID Describe
//!    （`DD-48`：结果不明时只用该 ID 查），把观察到的终态经唯一写入路径落库并
//!    标 `observation_gap`，把已在运行的 PENDING_START 推进到 RUNNING，把
//!    NotFound 且已超出 retention 的记为 UNKNOWN。
//! 2. 发出收敛度量：各投影状态的非终态数与最久年龄、各实体停在非终态的数量，
//!    以及「实体仍在收敛中、而驱动它当前版本的 Workflow 已经终结」的搁浅数。
//!
//! 按 Core 预写的 WorkflowRef 逐个 Describe，而不是按 Search Attribute 列举：
//! Describe 是强一致的，列举读的是最终一致的 visibility。只有 Schedule 触发的
//! run 没有预写的 WorkflowRef，需要按 `KailoTenantId` 列举回填；一期没有
//! Schedule，因此没有这条路径的适用对象（ADR-08）。
//!
//! 这里**不重新启动**任何 Workflow：WorkflowRef 不保存冻结输入，重启只能由
//! 持有该事实的原调用路径以同一 ID 发起。NotFound 而仍在 retention 窗口内的
//! 只计数，不改状态——它可能是 Start 从未到达，也可能是到达了而 visibility
//! 尚未可见，两者此时无法区分。

use std::sync::Arc;
use std::time::Duration;

use contracts::{TaskStateReport, TaskStatus};
use opentelemetry::metrics::{Counter, Gauge, Meter};
use opentelemetry::KeyValue;
use sqlx::PgPool;

use crate::task_projection;
use crate::temporal::{ObservedState, TemporalClient};

pub struct Config {
    /// 两轮之间的间隔
    pub interval: Duration,
    /// WorkflowRef 超过它仍非 TERMINAL 才被当作可能漏写
    pub freshness: Duration,
    /// 每轮最多 Describe 的条数
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
            interval: Duration::from_secs(get("WORKFLOW_RECONCILE_INTERVAL_SECONDS")?),
            freshness: Duration::from_secs(get("WORKFLOW_PROJECTION_FRESHNESS_SECONDS")?),
            batch: i64::try_from(get("WORKFLOW_RECONCILE_BATCH")?)
                .map_err(|_| "WORKFLOW_RECONCILE_BATCH 超出范围".to_owned())?,
        })
    }
}

/// 驱动收敛的实体及其「仍在收敛中」的状态。它们都由某条 ComponentTaskWorkflow
/// 推向终态；停在这里说明那条 Workflow 还在跑、没起来，或已终结而没把它带到
/// 终态。表名与状态是闭集，不来自外部输入。
const ENTITIES: &[(&str, &str, &[&str])] = &[
    (
        "tenant",
        "identity.tenant",
        &["PROVISIONING", "SUSPENDING", "RESTORING", "DELETING"],
    ),
    (
        "workspace",
        "identity.workspace",
        &["PROVISIONING", "SUSPENDING", "RESTORING"],
    ),
    (
        "tenant_membership",
        "identity.tenant_membership",
        &["PROVISIONING", "REVOKING"],
    ),
    (
        "workspace_membership",
        "identity.workspace_membership",
        &["PROVISIONING", "REVOKING"],
    ),
    (
        "buzz_identity_binding",
        "identity.buzz_identity_binding",
        &["PENDING_SECRET", "RECONCILING", "REVOKING"],
    ),
];

const REF_STATES: &[&str] = &["PENDING_START", "RUNNING", "UNKNOWN"];

struct Metrics {
    nonterminal: Gauge<u64>,
    oldest_age: Gauge<u64>,
    reconciled: Counter<u64>,
    entity_nonterminal: Gauge<u64>,
    entity_stranded: Gauge<u64>,
    passes: Counter<u64>,
}

impl Metrics {
    fn new(meter: &Meter) -> Self {
        Self {
            nonterminal: meter
                .u64_gauge("kailo.workflow_ref.nonterminal")
                .with_description("非 TERMINAL 的 WorkflowRef 数")
                .build(),
            oldest_age: meter
                .u64_gauge("kailo.workflow_ref.oldest_age")
                .with_unit("s")
                .with_description("最久一条非 TERMINAL WorkflowRef 的年龄，即投影落后的上界")
                .build(),
            reconciled: meter
                .u64_counter("kailo.workflow_ref.reconciled")
                .with_description("兜底对账对单条 WorkflowRef 的观察结果")
                .build(),
            entity_nonterminal: meter
                .u64_gauge("kailo.entity.nonterminal")
                .with_description("停在收敛中状态的实体数")
                .build(),
            entity_stranded: meter
                .u64_gauge("kailo.entity.stranded")
                .with_description("仍在收敛中、而驱动其当前版本的 Workflow 已终结的实体数")
                .build(),
            passes: meter
                .u64_counter("kailo.workflow_reconcile.passes")
                .with_description("对账轮次，按是否完成区分")
                .build(),
        }
    }
}

pub fn spawn(pool: PgPool, temporal: Arc<TemporalClient>, meter: &Meter, cfg: Config) {
    let metrics = Metrics::new(meter);
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(cfg.interval);
        // 错过的轮次不补跑：补跑只是连续做几遍同样的观察
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            let outcome = match pass(&pool, &temporal, &metrics, &cfg).await {
                Ok(()) => "COMPLETED",
                Err(e) => {
                    tracing::warn!(error = %e, "WorkflowRef 对账本轮未完成");
                    "FAILED"
                }
            };
            metrics.passes.add(1, &[KeyValue::new("outcome", outcome)]);
        }
    });
}

async fn pass(
    pool: &PgPool,
    temporal: &TemporalClient,
    metrics: &Metrics,
    cfg: &Config,
) -> Result<(), String> {
    // retention 每轮现取：它是 Server 上可被运维修改的事实
    let retention = temporal.retention().await.map_err(|e| e.to_string())?;
    let freshness = i64::try_from(cfg.freshness.as_secs()).unwrap_or(i64::MAX);
    let retention_secs = i64::try_from(retention.as_secs()).unwrap_or(i64::MAX);

    let stale = sqlx::query!(
        r#"select workflow_id, projection_state,
                  (created_at > now() - make_interval(secs => $3::bigint)) as "within_retention!"
           from projection.workflow_ref
           where projection_state <> 'TERMINAL'
             and created_at < now() - make_interval(secs => $1::bigint)
           order by coalesce(last_observed_at, created_at)
           limit $2"#,
        freshness,
        cfg.batch,
        retention_secs,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    for r in stale {
        let outcome = match temporal.describe(&r.workflow_id).await {
            Ok(Some(o)) => match o.state {
                ObservedState::Open => {
                    sqlx::query!(
                        "update projection.workflow_ref
                         set run_id = coalesce(run_id, $2), projection_state = 'RUNNING',
                             version = version + 1
                         where workflow_id = $1 and projection_state in ('PENDING_START', 'UNKNOWN')",
                        r.workflow_id,
                        o.run_id,
                    )
                    .execute(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                    "OPEN"
                }
                ObservedState::Closed(status) => {
                    patch_terminal(pool, &r.workflow_id, o.run_id, o.history_length, status)
                        .await?;
                    "TERMINAL_PATCHED"
                }
                ObservedState::Unrecognized(code) => {
                    tracing::warn!(workflow_id = %r.workflow_id, code, "Temporal 返回未知的执行状态");
                    "UNRECOGNIZED"
                }
            },
            // NotFound 只在 retention 窗口内才可能是「未启动」（SF-TMP-07）；
            // 窗口外它与「已终结且被清理」无法区分，只能是 UNKNOWN。
            Ok(None) if r.within_retention => "NOT_FOUND",
            Ok(None) => {
                sqlx::query!(
                    "update projection.workflow_ref
                     set projection_state = 'UNKNOWN', version = version + 1
                     where workflow_id = $1 and projection_state <> 'TERMINAL'",
                    r.workflow_id
                )
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
                "UNKNOWN"
            }
            Err(e) => {
                tracing::warn!(workflow_id = %r.workflow_id, error = %e, "Describe 结果不明");
                "DESCRIBE_FAILED"
            }
        };
        sqlx::query!(
            "update projection.workflow_ref set last_observed_at = now() where workflow_id = $1",
            r.workflow_id
        )
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
        metrics
            .reconciled
            .add(1, &[KeyValue::new("outcome", outcome)]);
    }

    record_refs(pool, metrics).await?;
    record_entities(pool, metrics).await
}

/// Temporal 已终结而 Core 没收到终态投影：以观察到的终态经唯一写入路径落库。
/// Worker 的 event_id 会累加 continue-as-new 之前各 run 的 history 长度；Describe
/// 只返回最新 run 的 history 长度。因此修复事件必须同时高于已持久化的 event_id
/// 与当前 run 的 history 长度，不能直接拿后者写回。
async fn patch_terminal(
    pool: &PgPool,
    workflow_id: &str,
    run_id: String,
    history_length: i64,
    status: TaskStatus,
) -> Result<(), String> {
    let previous: Option<i64> = sqlx::query_scalar(
        "select last_event_id from projection.task_projection where workflow_id = $1",
    )
    .bind(workflow_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    let event_id = next_reconciled_event_id(previous, history_length)
        .ok_or_else(|| format!("{workflow_id} 的投影事件序号已达上限"))?;
    let report = TaskStateReport {
        workflow_id: workflow_id.to_owned(),
        run_id,
        event_id,
        status,
        waiting_reason: None,
        progress: None,
    };
    let applied = task_projection::apply(pool, &report, true)
        .await
        .map_err(|e| e.to_string())?;
    match applied {
        Some(result) if result.applied => {}
        Some(_) => {
            // 并发的主路径写回抢先提交。它若写的不是本次观察到的终态，
            // 本轮不能宣称修复成功；下一轮继续按 Temporal 事实对账。
            let actual: Option<(String, Option<String>)> = sqlx::query_as(
                "select status, run_id from projection.task_projection where workflow_id = $1",
            )
            .bind(workflow_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
            if actual.as_ref().is_none_or(|(status, run_id)| {
                status != &task_projection::wire(&report.status)
                    || run_id.as_deref() != Some(report.run_id.as_str())
            }) {
                return Err(format!("{workflow_id} 的终态投影在对账时发生并发变化"));
            }
        }
        None => return Err(format!("{workflow_id} 缺少预写的 WorkflowRef")),
    }
    Ok(())
}

fn next_reconciled_event_id(previous: Option<i64>, history_length: i64) -> Option<i64> {
    previous.unwrap_or(0).max(history_length).checked_add(1)
}

async fn record_refs(pool: &PgPool, metrics: &Metrics) -> Result<(), String> {
    let rows = sqlx::query!(
        r#"select projection_state as "state!", count(*) as "n!",
                  extract(epoch from now() - min(created_at))::bigint as "age!"
           from projection.workflow_ref
           where projection_state <> 'TERMINAL'
           group by projection_state"#
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    // 每个状态都记一次，没有行的记 0：否则告警会停在上一轮的旧值上
    for state in REF_STATES {
        let (n, age) = rows
            .iter()
            .find(|r| r.state == *state)
            .map(|r| (r.n, r.age))
            .unwrap_or((0, 0));
        let attrs = [KeyValue::new("projection_state", *state)];
        metrics.nonterminal.record(n.max(0) as u64, &attrs);
        metrics.oldest_age.record(age.max(0) as u64, &attrs);
    }
    Ok(())
}

async fn record_entities(pool: &PgPool, metrics: &Metrics) -> Result<(), String> {
    for (entity, table, states) in ENTITIES {
        // 实体主键：buzz_identity_binding 以 pubkey 为键，其余为 id。它与
        // workflow ID 的第四段一致（`component_task::workflow_id`）。
        let key = if *entity == "buzz_identity_binding" {
            "pubkey"
        } else {
            "id::text"
        };
        let sql = format!(
            "select state, count(*) as n,
                    count(*) filter (where exists (
                        select 1 from projection.workflow_ref w
                        where w.projection_state = 'TERMINAL'
                          and split_part(w.workflow_id, ':', 4) = e.{key}
                          and split_part(w.workflow_id, ':', 5) = e.version::text)) as stranded
             from {table} e where state = any($1) group by state"
        );
        let states_owned: Vec<String> = states.iter().map(|s| (*s).to_owned()).collect();
        let rows: Vec<(String, i64, i64)> = sqlx::query_as(&sql)
            .bind(&states_owned)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;
        let mut stranded = 0u64;
        for state in *states {
            let (n, s) = rows
                .iter()
                .find(|(st, _, _)| st == state)
                .map(|(_, n, s)| (*n, *s))
                .unwrap_or((0, 0));
            stranded += s.max(0) as u64;
            metrics.entity_nonterminal.record(
                n.max(0) as u64,
                &[
                    KeyValue::new("entity", *entity),
                    KeyValue::new("state", *state),
                ],
            );
            if s > 0 {
                tracing::warn!(
                    entity,
                    state,
                    count = s,
                    "实体搁浅：驱动其当前版本的 Workflow 已终结"
                );
            }
        }
        metrics
            .entity_stranded
            .record(stranded, &[KeyValue::new("entity", *entity)]);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::next_reconciled_event_id;

    #[test]
    fn reconcile_event_id_stays_ahead_of_prior_runs() {
        assert_eq!(next_reconciled_event_id(None, 20), Some(21));
        assert_eq!(
            next_reconciled_event_id(Some(1_000_000), 20),
            Some(1_000_001)
        );
        assert_eq!(
            next_reconciled_event_id(Some(20), 1_000_000),
            Some(1_000_001)
        );
        assert_eq!(next_reconciled_event_id(Some(i64::MAX), 20), None);
    }
}
