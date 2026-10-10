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
    execution_trace: Option<&serde_json::Value>,
) -> Result<Option<Applied>, sqlx::Error> {
    let status = wire(&report.status);
    let mut tx = pool.begin().await?;
    let updated = sqlx::query_scalar!(
        r#"
        insert into projection.task_projection
            (workflow_id, run_id, last_event_id, status, waiting_reason, progress,
             observation_gap, execution_trace, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, now())
        on conflict (workflow_id) do update set
            run_id          = excluded.run_id,
            last_event_id   = excluded.last_event_id,
            status          = excluded.status,
            waiting_reason  = excluded.waiting_reason,
            progress        = excluded.progress,
            observation_gap = excluded.observation_gap,
            execution_trace = coalesce(excluded.execution_trace, projection.task_projection.execution_trace),
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
        execution_trace,
    )
    .fetch_optional(&mut *tx)
    .await;

    let last_event_id = match updated {
        Ok(Some(id)) => id,
        // 同 EventID 只有同一报告才是幂等重试。仅回读事件号会把不同 run/终态
        // 的碰撞误作已写入；较旧报告仍按原单调规则忽略。
        Ok(None) => {
            tx.rollback().await?;
            let current: Option<(i64, bool)> = sqlx::query_as(
                "select last_event_id,
                    (run_id = $2 and status = $3
                     and waiting_reason is not distinct from $4
                     and progress is not distinct from $5
                     and ($6::jsonb is null or execution_trace is not distinct from $6))
                 from projection.task_projection where workflow_id = $1",
            )
            .bind(&report.workflow_id)
            .bind(&report.run_id)
            .bind(&status)
            .bind(&report.waiting_reason)
            .bind(&report.progress)
            .bind(execution_trace)
            .fetch_optional(pool)
            .await?;
            return current
                .map(|(last_event_id, matches)| {
                    if last_event_id == report.event_id && !matches {
                        return Err(sqlx::Error::Protocol(
                            "TaskProjection 同 EventID 的报告证据冲突".into(),
                        ));
                    }
                    Ok(Applied {
                        applied: false,
                        last_event_id,
                    })
                })
                .transpose();
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    #[tokio::test]
    #[ignore = "requires migrated automation_trace_verify_* PostgreSQL database"]
    async fn automation_trace_same_event_collision_old_writer_and_body_rejection() {
        let pool = PgPool::connect(&std::env::var("AUTOMATION_TRACE_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        let database: String = sqlx::query_scalar("select current_database()")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(database.starts_with("automation_trace_verify_"));
        let tenant = Uuid::new_v4();
        let principal = Uuid::new_v4();
        let ae = Uuid::new_v4();
        let workflow = format!("trace-evidence:{ae}");
        sqlx::query("insert into identity.tenant(id,slug,name,state) values($1,$2,$2,'ACTIVE')")
            .bind(tenant)
            .bind(tenant.to_string())
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'SERVICE','ACTIVE')")
            .bind(principal).bind(tenant).execute(&pool).await.unwrap();
        sqlx::query("insert into admission.action_execution(id,operation_id,tenant_id,action_key,action_version,
            initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id)
            values($1,$1,$2,'tenant.provision',1,$3,$3,$2,$4,'ALLOWED','DISPATCHED',$1)")
            .bind(ae).bind(tenant).bind(principal).bind("0".repeat(64)).execute(&pool).await.unwrap();
        sqlx::query("insert into projection.workflow_ref(workflow_id,run_id,workflow_type,workflow_version,
            tenant_id,operation_id,action_execution_id,projection_state) values($1,$2,'AgentTaskWorkflow',1,$3,$4,$4,'RUNNING')")
            .bind(&workflow).bind(Uuid::new_v4().to_string()).bind(tenant).bind(ae).execute(&pool).await.unwrap();
        let mut report: TaskStateReport = serde_json::from_value(json!({"workflowId":workflow,
            "runId":Uuid::new_v4(),"eventId":1,"status":"RUNNING","waitingReason":"UNKNOWN_EXTERNAL_RESULT"})).unwrap();
        let trace = json!([{"stepId":"publish","status":"unknown","output":{"eventId":"a".repeat(64)},"error":"EXTERNAL_RESULT_UNKNOWN"}]);
        assert!(
            apply(&pool, &report, false, Some(&trace))
                .await
                .unwrap()
                .unwrap()
                .applied
        );
        assert!(
            !apply(&pool, &report, false, Some(&trace))
                .await
                .unwrap()
                .unwrap()
                .applied
        );
        let wrong = json!([{"stepId":"publish","status":"completed","output":{}}]);
        assert!(apply(&pool, &report, false, Some(&wrong)).await.is_err());
        report.event_id = 2;
        assert!(
            apply(&pool, &report, true, None)
                .await
                .unwrap()
                .unwrap()
                .applied
        );
        let retained: serde_json::Value = sqlx::query_scalar(
            "select execution_trace from projection.task_projection where workflow_id=$1",
        )
        .bind(&workflow)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(retained, trace);
        report.event_id = 3;
        for malformed in [
            json!([{"stepId":"publish","status":"completed","output":{"body":"must not persist"}}]),
            json!([{"stepId":"publish","status":null,"output":{}}]),
            json!([{"stepId":"publish","status":"accepted","output":{}}]),
        ] {
            assert!(apply(&pool, &report, false, Some(&malformed))
                .await
                .is_err());
        }
        let pending = json!([{"stepId":"next","status":"pending","output":{}}]);
        let (left, right) = tokio::join!(
            apply(&pool, &report, false, Some(&pending)),
            apply(&pool, &report, false, Some(&wrong))
        );
        assert_ne!(
            left.is_ok(),
            right.is_ok(),
            "same-event different traces cannot both be acknowledged"
        );
        report.event_id = 1;
        assert!(
            !apply(&pool, &report, false, Some(&wrong))
                .await
                .unwrap()
                .unwrap()
                .applied
        );
    }
}
