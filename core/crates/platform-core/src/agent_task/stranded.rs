//! AgentTaskWorkflow 已在 Temporal 关闭、Invocation 却仍停在非终态时的自动收尾。
//!
//! 主路径上 Workflow 只在 advance 回报终态后才结束，因此「Workflow 已关闭而
//! Invocation 仍是 CREATED/DISPATCHING/RUNNING」只出现在 Workflow 以失败结束时，
//! 例如 Core 数据库确定拒绝了 advance（CORE_PERSISTENCE_REJECTED）。之后再没有
//! Activity 会推进这一行，它会永远显示为「进行中」。
//!
//! 收尾只写能被证明的结果，绝不重发任何效果（`.design/06` §9、RB-05）：
//!
//! - 没有任何外部效果的痕迹（未派发 turn、无回复、无 webhook/消息意图、无步骤
//!   事件、无模型轨迹与用量）→ `FAILED`；
//! - 其余一律 → `UNKNOWN`：请求可能已经离开，结果不明，只能对账。
//!
//! 每次收尾在原 operation 上追加一条 RECONCILIATION 审计事实，与状态变更同事务。
//! Workflow 是否关闭以按固定 ID Describe 的强一致结果为准，WorkflowRef 的
//! TERMINAL 只用于挑选候选：Worker 的终态投影发生在 Temporal close 之前。

use contracts::EvidenceKind;
use sqlx::PgConnection;
use uuid::Uuid;

use crate::audit::{append, AuditEntry, Evidence};
use crate::service_api::ServiceState;
use crate::temporal::ObservedState;

/// 候选：Invocation 非终态，而它的 AgentTaskWorkflow 投影已到终态。
async fn candidates(
    conn: &mut PgConnection,
    batch: i64,
) -> Result<Vec<(Uuid, String)>, sqlx::Error> {
    sqlx::query_as(
        "select i.id, i.workflow_id from catalog.agent_invocation i
         join projection.workflow_ref w on w.workflow_id = i.workflow_id
           and w.action_execution_id = i.action_execution_id
           and w.workflow_type = $2 and w.kind is null
         join projection.task_projection t on t.workflow_id = w.workflow_id
         where i.status in ('CREATED','DISPATCHING','RUNNING')
           and w.projection_state = 'TERMINAL'
           and t.status in ('COMPLETED','FAILED','CANCELED','TERMINATED','TIMED_OUT')
         order by i.updated_at, i.id
         limit $1",
    )
    .bind(batch)
    .bind(super::WORKFLOW_TYPE)
    .fetch_all(conn)
    .await
}

#[derive(sqlx::FromRow)]
struct Stranded {
    status: String,
    unsent: bool,
    workflow_id: String,
    action_execution_id: Uuid,
    tenant_id: Uuid,
    workspace_id: Option<Uuid>,
    operation_id: Uuid,
    initiator_principal_id: Uuid,
    actor_principal_id: Uuid,
    action_key: String,
    action_version: i32,
    target_id: Uuid,
    parameter_hash: String,
    correlation_id: Uuid,
}

/// 调用方已确认该 Workflow 在 Temporal 关闭。锁住这一行，按证据写终态并追加
/// 审计；行已不在非终态（并发推进或已收尾）时返回 `None`，什么也不写。
async fn close(conn: &mut PgConnection, id: Uuid) -> Result<Option<&'static str>, sqlx::Error> {
    let Some(row) = sqlx::query_as::<_, Stranded>(
        "select i.status,
           coalesce(i.status = 'CREATED' and i.runtime_turn_id is null and i.native_status is null
             and i.reply_event_id is null and i.webhook_intent is null
             and i.post_message_intent is null and cardinality(i.automation_step_event_ids) = 0
             and not exists(select 1 from projection.agent_model_trace t where t.invocation_id = i.id)
             and not exists(select 1 from outbox.usage_event u
                            where u.invocation_id = i.id or u.operation_id = a.operation_id),
             false) as unsent,
           i.workflow_id, a.id as action_execution_id, a.tenant_id, a.workspace_id, a.operation_id,
           a.initiator_principal_id, a.actor_principal_id, a.action_key, a.action_version,
           a.target_id, a.parameter_hash, a.correlation_id
         from catalog.agent_invocation i
         join admission.action_execution a on a.id = i.action_execution_id
           and a.temporal_workflow_id = i.workflow_id
         where i.id = $1 and i.status in ('CREATED','DISPATCHING','RUNNING')
         for update of i",
    )
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(None);
    };
    let (status, result_code) = if row.unsent {
        ("FAILED", "FAILED")
    } else {
        ("UNKNOWN", "RESULT_UNKNOWN")
    };
    let changed = sqlx::query(
        "update catalog.agent_invocation set status = $3, updated_at = now()
         where id = $1 and status = $2",
    )
    .bind(id)
    .bind(&row.status)
    .bind(status)
    .execute(&mut *conn)
    .await?;
    if changed.rows_affected() != 1 {
        return Ok(None);
    }
    let mut tx = sqlx::Connection::begin(&mut *conn).await?;
    append(
        &mut tx,
        AuditEntry {
            event_key: format!("agent-task:{id}:stranded-close"),
            tenant_id: Some(row.tenant_id),
            workspace_id: row.workspace_id,
            operation_id: row.operation_id,
            event_type: "RECONCILIATION",
            human_identity_id: None,
            initiator_principal_id: Some(row.initiator_principal_id),
            actor_principal_id: Some(row.actor_principal_id),
            action_key: &row.action_key,
            action_version: row.action_version,
            component_type_key: "CORE_INTERNAL",
            target_type: None,
            target_id: Some(row.target_id),
            parameter_hash: &row.parameter_hash,
            decision: "ALLOW",
            result_code,
            result_exposure: "NONE",
            evidence_refs: vec![
                Evidence::new(EvidenceKind::ActionExecutionId, row.action_execution_id),
                Evidence::new(EvidenceKind::TemporalWorkflowId, &row.workflow_id),
            ],
            correlation_id: row.correlation_id,
        },
    )
    .await?;
    tx.commit().await?;
    Ok(Some(status))
}

/// 由既有治理对账节拍调用。单行失败（含守卫拒绝）只记日志，不阻塞其他行。
pub(crate) async fn reconcile(state: &ServiceState, batch: i64) -> Result<(), sqlx::Error> {
    let mut conn = state.pool.acquire().await?;
    let rows = candidates(&mut conn, batch).await?;
    drop(conn);
    for (id, workflow_id) in rows {
        match state.temporal.describe(&workflow_id).await {
            Ok(Some(observed)) if matches!(observed.state, ObservedState::Closed(_)) => {}
            // 仍 OPEN、找不到或查询不明：不能证明不再有 Activity 推进这一行。
            _ => continue,
        }
        let mut tx = state.pool.begin().await?;
        match close(&mut tx, id).await {
            Ok(Some(status)) => {
                tx.commit().await?;
                tracing::warn!(invocation_id = %id, %workflow_id, status,
                    "AgentTaskWorkflow 已关闭而 Invocation 仍未终态：已按证据自动收尾");
            }
            Ok(None) => tx.rollback().await?,
            Err(error) => {
                tx.rollback().await?;
                tracing::error!(invocation_id = %id, %workflow_id, error = %error,
                    "已关闭 AgentTaskWorkflow 的 Invocation 收尾失败；保留原状态");
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use sqlx::PgPool;

    #[tokio::test]
    async fn closed_workflow_invocations_end_failed_or_unknown_by_evidence() {
        let Some(database_url) = std::env::var("DATABASE_URL").ok() else {
            eprintln!("SKIP stranded invocation close: no disposable migrated DATABASE_URL");
            return;
        };
        let pool = PgPool::connect(&database_url)
            .await
            .expect("disposable migrated database");
        let mut tx = pool.begin().await.expect("transaction");
        let tenant = Uuid::new_v4();
        let (unsent, dispatching, open) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        // Real migrated constraints and guards; the whole fixture rolls back.
        sqlx::raw_sql(&format!(
            r#"DO $$
            DECLARE
              tenant uuid:='{tenant}'; workspace uuid:=gen_random_uuid();
              human uuid:=gen_random_uuid(); human_identity uuid:=gen_random_uuid();
              agent uuid:=gen_random_uuid(); definition uuid:=gen_random_uuid();
              version_asset uuid:=gen_random_uuid(); installation uuid:=gen_random_uuid();
              route uuid:=gen_random_uuid(); invocation uuid; action uuid; n integer;
              invocations uuid[]:=ARRAY['{unsent}','{dispatching}','{open}']::uuid[];
            BEGIN
              INSERT INTO identity.tenant(id,slug,name,state)
                VALUES(tenant,'stranded-'||tenant,'Stranded fixture','ACTIVE');
              INSERT INTO identity.workspace(id,tenant_id,slug,name,state)
                VALUES(workspace,tenant,'stranded','Stranded fixture','ACTIVE');
              INSERT INTO identity.human_identity(id,display_name,status)
                VALUES(human_identity,'Stranded fixture','ACTIVE');
              INSERT INTO identity.principal(id,tenant_id,kind,status) VALUES
                (human,tenant,'HUMAN','ACTIVE'),(agent,tenant,'AGENT','ACTIVE');
              INSERT INTO identity.tenant_membership(id,tenant_id,human_identity_id,tenant_principal_id,state)
                VALUES(gen_random_uuid(),tenant,human_identity,human,'ACTIVE');
              INSERT INTO catalog.resource(id,tenant_id,type_key,home_workspace_id,owner_principal_id,
                component_type_key,native_id,state,version) VALUES
                (definition,tenant,'agent.definition',NULL,human,'core',definition::text,'PROVISIONING',1),
                (route,tenant,'llm_route',workspace,human,'core',route::text,'PROVISIONING',1),
                (installation,tenant,'agent.installation',workspace,human,'core',installation::text,'PROVISIONING',1);
              INSERT INTO catalog.agent_definition(resource_id,stable_slug,display_name,status)
                VALUES(definition,'stranded','Stranded fixture','PROVISIONING');
              INSERT INTO catalog.asset(id,tenant_id,resource_id,type_key,owner_principal_id,native_ref,state,version)
                VALUES(version_asset,tenant,definition,'agent.version',human,version_asset::text,'DRAFT',1);
              INSERT INTO catalog.agent_version(asset_id,agent_resource_id,ordinal,content,config_hash,state)
                VALUES(version_asset,definition,1,
                  jsonb_build_object('runtimeProfileKey','stranded-fixture','modelRouteResourceId',route),
                  repeat('a',64),'DRAFT');
              INSERT INTO catalog.agent_installation(resource_id,workspace_id,agent_resource_id,pinned_version_asset_id,
                agent_principal_id,runtime_isolation_ref,state)
                VALUES(installation,workspace,definition,version_asset,agent,'fixture:'||installation,'PROVISIONING');
              INSERT INTO catalog.agent_runtime_projection(installation_resource_id,generation,agent_version_asset_id,
                runtime_profile_key,model_route_resource_id,gateway_resource_ids,effective_fields,config_hash,state)
                VALUES(installation,1,version_asset,'stranded-fixture',route,'{{}}','[]',repeat('a',64),'PENDING');
              INSERT INTO catalog.agent_session(tenant_id,workspace_id,root_event_id,installation_resource_id,
                agent_version_asset_id,projection_generation,runtime_thread_id,core_memory_state,status)
                VALUES(tenant,workspace,repeat('a',64),installation,version_asset,1,NULL,'UNREADABLE','PENDING');
              FOR n IN 1..3 LOOP
                invocation:=invocations[n]; action:=gen_random_uuid();
                INSERT INTO admission.action_execution(id,operation_id,tenant_id,workspace_id,action_key,action_version,
                  initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id)
                  VALUES(action,gen_random_uuid(),tenant,workspace,'agent.invoke',1,
                    human,human,installation,repeat('a',64),'ALLOWED','DISPATCHED',gen_random_uuid());
                INSERT INTO catalog.agent_invocation(id,tenant_id,workspace_id,root_event_id,source_event_id,
                  installation_resource_id,agent_version_asset_id,projection_generation,action_execution_id,workflow_id,status)
                  VALUES(invocation,tenant,workspace,repeat('a',64),repeat(n::text,64),installation,version_asset,1,
                    action,'stranded:'||invocation,'CREATED');
                INSERT INTO projection.workflow_ref(workflow_id,run_id,workflow_type,workflow_version,
                  tenant_id,workspace_id,operation_id,action_execution_id,projection_state)
                  SELECT 'stranded:'||invocation,'run','AgentTaskWorkflow',1,tenant,workspace,operation_id,action,
                    CASE WHEN n=3 THEN 'RUNNING' ELSE 'TERMINAL' END
                  FROM admission.action_execution WHERE id=action;
                UPDATE admission.action_execution SET temporal_workflow_id='stranded:'||invocation WHERE id=action;
                INSERT INTO projection.task_projection(workflow_id,run_id,last_event_id,status,observation_gap)
                  VALUES('stranded:'||invocation,'run',9,CASE WHEN n=3 THEN 'RUNNING' ELSE 'FAILED' END,n<>3);
              END LOOP;
              UPDATE catalog.agent_invocation SET status='DISPATCHING',updated_at=now() WHERE id='{dispatching}';
            END $$;"#
        ))
        .execute(&mut *tx)
        .await
        .expect("stranded fixture");

        let found: Vec<Uuid> = candidates(&mut tx, 100_000)
            .await
            .expect("candidates")
            .into_iter()
            .map(|(id, _)| id)
            .collect();
        assert!(found.contains(&unsent) && found.contains(&dispatching));
        assert!(
            !found.contains(&open),
            "a running workflow is never a candidate"
        );

        assert_eq!(close(&mut tx, unsent).await.expect("close"), Some("FAILED"));
        assert_eq!(
            close(&mut tx, dispatching).await.expect("close"),
            Some("UNKNOWN")
        );
        // Already ended: nothing more is written.
        assert_eq!(close(&mut tx, unsent).await.expect("close"), None);
        let statuses: Vec<(Uuid, String)> = sqlx::query_as(
            "select id, status from catalog.agent_invocation where id = any($1) order by status",
        )
        .bind(vec![unsent, dispatching, open])
        .fetch_all(&mut *tx)
        .await
        .expect("statuses");
        assert_eq!(
            statuses,
            vec![
                (open, "CREATED".to_owned()),
                (unsent, "FAILED".to_owned()),
                (dispatching, "UNKNOWN".to_owned())
            ]
        );
        let facts: Vec<(String, String, Value)> = sqlx::query_as(
            "select a.event_type, a.result_code, a.evidence_refs from audit.audit_event a
             where a.tenant_id = $1 order by a.result_code",
        )
        .bind(tenant)
        .fetch_all(&mut *tx)
        .await
        .expect("audit");
        assert_eq!(
            facts.len(),
            2,
            "one reconciliation fact per closed invocation"
        );
        assert_eq!(
            (facts[0].0.as_str(), facts[0].1.as_str()),
            ("RECONCILIATION", "FAILED")
        );
        assert_eq!(
            (facts[1].0.as_str(), facts[1].1.as_str()),
            ("RECONCILIATION", "RESULT_UNKNOWN")
        );
        assert_eq!(
            facts[1].2[1],
            serde_json::json!({"kind":"TEMPORAL_WORKFLOW_ID","value":format!("stranded:{dispatching}")})
        );
        tx.rollback().await.expect("fixture rolls back");
        pool.close().await;
    }
}
