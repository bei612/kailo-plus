//! TaskProjection 的唯一写入路径（`.design/06` §3.1、`DD-48`）。
//!
//! 两个来源共用它：Workflow 经 `ProjectTaskState` Activity 自己写回（主路径），
//! 以及兜底对账从 Temporal 观察到的终态（`workflow_reconcile`）。写在一处，
//! 两者的单调规则与「终态使 WorkflowRef 进入 TERMINAL」就不会分叉。

use contracts::{TaskStateReport, TaskStatus};
use sqlx::PgPool;

pub struct Applied {
    /// false 表示收到的是更旧或重复的事件，已按单调规则忽略。
    pub applied: bool,
    pub last_event_id: i64,
}

/// Temporal 的 close status 之一。RUNNING 之外都是终态。
pub fn is_terminal(status: &TaskStatus) -> bool {
    !matches!(status, TaskStatus::Running)
}

/// 封闭枚举的线格式值，与库里 `task_status_enum` 约束的取值一致。
pub fn wire(status: &TaskStatus) -> String {
    serde_json::to_value(status)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

/// 按 `event_id` 单调 upsert。报告是终态且被采纳时，同一事务里把 WorkflowRef
/// 的投影状态推进到 TERMINAL。写回发生在 Temporal close 之前，因此这个投影
/// 不能单独证明 execution 已关闭；重跑仍需按固定 ID 向 Temporal 查证。
///
/// `observation_gap` 只由兜底对账置真：那说明 Workflow 自己的写回没有到达，
/// 工作台据此显示 PROJECTION_DELAYED 而不是装作一切按时。
///
/// `Ok(None)` 表示 WorkflowRef 不存在：那是 Core 在 Start 之前的职责，写回方
/// 不能替它建（`DD-48`）。
pub async fn apply(
    pool: &PgPool,
    report: &TaskStateReport,
    observation_gap: bool,
) -> Result<Option<Applied>, sqlx::Error> {
    let status = wire(&report.status);
    let mut tx = pool.begin().await?;
    let updated = sqlx::query_scalar!(
        r#"
        insert into projection.task_projection
            (workflow_id, run_id, last_event_id, status, waiting_reason, progress,
             observation_gap, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, now())
        on conflict (workflow_id) do update set
            run_id          = excluded.run_id,
            last_event_id   = excluded.last_event_id,
            status          = excluded.status,
            waiting_reason  = excluded.waiting_reason,
            progress        = excluded.progress,
            observation_gap = excluded.observation_gap,
            updated_at      = now()
        where projection.task_projection.last_event_id < excluded.last_event_id
        returning last_event_id
        "#,
        report.workflow_id,
        report.run_id,
        report.event_id,
        status,
        report.waiting_reason,
        report.progress,
        observation_gap,
    )
    .fetch_optional(&mut *tx)
    .await;

    let last_event_id = match updated {
        Ok(Some(id)) => id,
        // 没有返回行只有一种可能：已存在的 last_event_id 不小于本次。回读权威值
        // 并按幂等成功返回——Activity 重试到达同一结果不该被当成失败再重试。
        Ok(None) => {
            tx.rollback().await?;
            return Ok(sqlx::query_scalar!(
                "select last_event_id from projection.task_projection where workflow_id = $1",
                report.workflow_id
            )
            .fetch_optional(pool)
            .await?
            .map(|last_event_id| Applied {
                applied: false,
                last_event_id,
            }));
        }
        Err(sqlx::Error::Database(e)) if e.is_foreign_key_violation() => return Ok(None),
        Err(e) => return Err(e),
    };

    if is_terminal(&report.status) {
        sqlx::query!(
            "update projection.workflow_ref
             set projection_state = 'TERMINAL', run_id = coalesce(run_id, $2),
                 version = version + 1
             where workflow_id = $1 and projection_state <> 'TERMINAL'",
            report.workflow_id,
            report.run_id,
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Some(Applied {
        applied: true,
        last_event_id,
    }))
}
