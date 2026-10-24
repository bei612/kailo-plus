//! DD-154：只剩 birth 结果不明的 AgentSession 的放弃对账。
//!
//! Session 在 birth 失败或接收进程丢失时停在 `UNKNOWN`（`agent_session::record_birth_receipt`、
//! `confirm_lost_birth`），而它的 Invocation 已按证据收尾为确定终态。此后同一 root、同一
//! generation 的新触发对它以冲突拒绝，不会再有任何 Invocation 使用它；但排空把 `UNKNOWN`
//! Session 当作在途，升级与停用因此永不收敛（`catalog.agent_installation_drained`）。
//!
//! 对账只在能证明“不再有在途工作”时放弃 Session：同一 Session 键的全部 Invocation 都已
//! `COMPLETED`/`FAILED`/`CANCELED`，其 CapacityLease 全部 `RELEASED`，且 Session 建立与最后
//! 一个 Invocation 的变更都早于对账期限。任一 Invocation 仍是 `UNKNOWN` 或非终态时什么也不写：
//! 结果不明的调用只能由 native 查询对账（DD-48）。`ABANDONED` 不声称 native thread 未创建，
//! 也不改写任何 Invocation；状态变更与 `RECONCILIATION` 审计同事务写入。

use contracts::EvidenceKind;
use sqlx::PgConnection;
use uuid::Uuid;

use crate::audit::{append, AuditEntry, Evidence};
use crate::service_api::ServiceState;

/// 对账期限：长于 `thread/start` 与 resume 的最长等待，平台常量（DD-154(2)）。
pub(crate) const DEADLINE_SECONDS: f64 = 30.0 * 60.0;

/// Session 键：Workspace、root、Installation 与 generation（`03` §7）。
#[derive(Clone, Debug, PartialEq, Eq, sqlx::FromRow)]
pub(crate) struct SessionKey {
    pub(crate) workspace_id: Uuid,
    pub(crate) root_event_id: String,
    pub(crate) installation_resource_id: Uuid,
    pub(crate) projection_generation: i64,
}

/// 只剩确定终态 Invocation 的 Session 条件；`$1..$4` 是 Session 键，`$5` 是期限秒数。
const SETTLED: &str = "s.status = 'UNKNOWN'
    and s.created_at < now() - make_interval(secs => $5)
    and exists(select 1 from catalog.agent_invocation v
      where v.workspace_id = s.workspace_id and v.root_event_id = s.root_event_id
        and v.installation_resource_id = s.installation_resource_id
        and v.projection_generation = s.projection_generation)
    and not exists(select 1 from catalog.agent_invocation v
      where v.workspace_id = s.workspace_id and v.root_event_id = s.root_event_id
        and v.installation_resource_id = s.installation_resource_id
        and v.projection_generation = s.projection_generation
        and (v.status not in ('COMPLETED','FAILED','CANCELED')
          or v.updated_at >= now() - make_interval(secs => $5)
          or exists(select 1 from admission.capacity_lease l
            where l.invocation_id = v.id and l.state <> 'RELEASED')))";

async fn candidates(
    conn: &mut PgConnection,
    batch: i64,
    deadline: f64,
) -> Result<Vec<SessionKey>, sqlx::Error> {
    sqlx::query_as(&format!(
        "select s.workspace_id, s.root_event_id, s.installation_resource_id, s.projection_generation
         from catalog.agent_session s
         where {}
         order by s.created_at, s.installation_resource_id, s.root_event_id
         limit $1",
        SETTLED.replace("$5", "$2")
    ))
    .bind(batch)
    .bind(deadline)
    .fetch_all(conn)
    .await
}

#[derive(sqlx::FromRow)]
struct Anchor {
    tenant_id: Uuid,
    workspace_id: Option<Uuid>,
    invocation_id: Uuid,
    workflow_id: String,
    action_execution_id: Uuid,
    operation_id: Uuid,
    initiator_principal_id: Uuid,
    actor_principal_id: Uuid,
    action_key: String,
    action_version: i32,
    target_id: Uuid,
    parameter_hash: String,
    correlation_id: Uuid,
}

/// 锁住 Session 行并在同一事务内重新判定；仍满足时转 `ABANDONED` 并在最后一个 Invocation
/// 的 operation 上追加审计。条件已不成立（并发推进或已收尾）时返回 `false`，什么也不写。
async fn abandon(
    conn: &mut PgConnection,
    key: &SessionKey,
    deadline: f64,
) -> Result<bool, sqlx::Error> {
    let settled: Option<bool> = sqlx::query_scalar(&format!(
        "select true from catalog.agent_session s
         where s.workspace_id = $1 and s.root_event_id = $2
           and s.installation_resource_id = $3 and s.projection_generation = $4
           and {SETTLED}
         for update of s"
    ))
    .bind(key.workspace_id)
    .bind(&key.root_event_id)
    .bind(key.installation_resource_id)
    .bind(key.projection_generation)
    .bind(deadline)
    .fetch_optional(&mut *conn)
    .await?;
    if settled.is_none() {
        return Ok(false);
    }
    let anchor: Anchor = sqlx::query_as(
        "select a.tenant_id, a.workspace_id, v.id as invocation_id, v.workflow_id,
           a.id as action_execution_id, a.operation_id, a.initiator_principal_id,
           a.actor_principal_id, a.action_key, a.action_version, a.target_id,
           a.parameter_hash, a.correlation_id
         from catalog.agent_invocation v
         join admission.action_execution a on a.id = v.action_execution_id
         where v.workspace_id = $1 and v.root_event_id = $2
           and v.installation_resource_id = $3 and v.projection_generation = $4
         order by v.updated_at desc, v.id desc
         limit 1",
    )
    .bind(key.workspace_id)
    .bind(&key.root_event_id)
    .bind(key.installation_resource_id)
    .bind(key.projection_generation)
    .fetch_one(&mut *conn)
    .await?;
    let changed = sqlx::query(
        "update catalog.agent_session set status = 'ABANDONED'
         where workspace_id = $1 and root_event_id = $2
           and installation_resource_id = $3 and projection_generation = $4
           and status = 'UNKNOWN'",
    )
    .bind(key.workspace_id)
    .bind(&key.root_event_id)
    .bind(key.installation_resource_id)
    .bind(key.projection_generation)
    .execute(&mut *conn)
    .await?;
    if changed.rows_affected() != 1 {
        return Ok(false);
    }
    let mut tx = sqlx::Connection::begin(&mut *conn).await?;
    append(
        &mut tx,
        AuditEntry {
            event_key: format!(
                "agent-session:{}:{}:{}:{}:abandoned",
                key.installation_resource_id,
                key.projection_generation,
                key.workspace_id,
                key.root_event_id
            ),
            tenant_id: Some(anchor.tenant_id),
            workspace_id: anchor.workspace_id,
            operation_id: anchor.operation_id,
            event_type: "RECONCILIATION",
            human_identity_id: None,
            initiator_principal_id: Some(anchor.initiator_principal_id),
            actor_principal_id: Some(anchor.actor_principal_id),
            action_key: &anchor.action_key,
            action_version: anchor.action_version,
            component_type_key: "CORE_INTERNAL",
            target_type: None,
            target_id: Some(anchor.target_id),
            parameter_hash: &anchor.parameter_hash,
            decision: "ALLOW",
            result_code: "SESSION_ABANDONED",
            result_exposure: "NONE",
            evidence_refs: vec![
                Evidence::new(EvidenceKind::ActionExecutionId, anchor.action_execution_id),
                Evidence::new(EvidenceKind::TemporalWorkflowId, &anchor.workflow_id),
            ],
            correlation_id: anchor.correlation_id,
        },
    )
    .await?;
    tx.commit().await?;
    tracing::warn!(
        installation_resource_id = %key.installation_resource_id,
        projection_generation = key.projection_generation,
        invocation_id = %anchor.invocation_id,
        "只剩 birth 结果不明的 AgentSession 超过对账期限：已放弃并留审计（DD-154）"
    );
    Ok(true)
}

/// 由既有治理对账节拍调用。单行失败只记日志，不阻塞其他行。
pub(crate) async fn reconcile(state: &ServiceState, batch: i64) -> Result<(), sqlx::Error> {
    let mut conn = state.pool.acquire().await?;
    let rows = candidates(&mut conn, batch, DEADLINE_SECONDS).await?;
    drop(conn);
    for key in rows {
        let mut tx = state.pool.begin().await?;
        match abandon(&mut tx, &key, DEADLINE_SECONDS).await {
            Ok(true) => tx.commit().await?,
            Ok(false) => tx.rollback().await?,
            Err(error) => {
                tx.rollback().await?;
                tracing::error!(installation_resource_id = %key.installation_resource_id,
                    projection_generation = key.projection_generation, error = %error,
                    "AgentSession 放弃对账失败；保留 UNKNOWN");
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

    /// V-SCN-253：只剩确定终态 Invocation 的旧 UNKNOWN Session 被放弃并留审计，排空随之完成；
    /// 有结果不明 Invocation 的、或尚未过期的 UNKNOWN Session 保持不动并继续阻止排空。
    #[tokio::test]
    async fn settled_unknown_session_is_abandoned_and_unblocks_the_drain() {
        let Some(database_url) = std::env::var("DATABASE_URL").ok() else {
            eprintln!("SKIP session abandon: no disposable migrated DATABASE_URL");
            return;
        };
        let pool = PgPool::connect(&database_url)
            .await
            .expect("disposable migrated database");
        let mut tx = pool.begin().await.expect("transaction");
        let tenant = Uuid::new_v4();
        let (settled, open) = (Uuid::new_v4(), Uuid::new_v4());
        // Real migrated constraints, triggers and the drain function; rolls back.
        sqlx::raw_sql(&format!(
            r#"DO $$
            DECLARE
              tenant uuid:='{tenant}'; workspace uuid:=gen_random_uuid();
              human uuid:=gen_random_uuid(); human_identity uuid:=gen_random_uuid();
              definition uuid:=gen_random_uuid(); version_asset uuid:=gen_random_uuid();
              route uuid:=gen_random_uuid(); agent uuid; installation uuid; action uuid;
              installations uuid[]:=ARRAY['{settled}','{open}']::uuid[];
              n integer; m integer; root text; status text; age interval;
            BEGIN
              INSERT INTO identity.tenant(id,slug,name,state)
                VALUES(tenant,'abandon-'||tenant,'Abandon fixture','ACTIVE');
              INSERT INTO identity.workspace(id,tenant_id,slug,name,state)
                VALUES(workspace,tenant,'abandon','Abandon fixture','ACTIVE');
              INSERT INTO identity.human_identity(id,display_name,status)
                VALUES(human_identity,'Abandon fixture','ACTIVE');
              INSERT INTO identity.principal(id,tenant_id,kind,status) VALUES(human,tenant,'HUMAN','ACTIVE');
              INSERT INTO identity.tenant_membership(id,tenant_id,human_identity_id,tenant_principal_id,state)
                VALUES(gen_random_uuid(),tenant,human_identity,human,'ACTIVE');
              INSERT INTO catalog.resource(id,tenant_id,type_key,home_workspace_id,owner_principal_id,
                component_type_key,native_id,state,version) VALUES
                (definition,tenant,'agent.definition',NULL,human,'core',definition::text,'PROVISIONING',1),
                (route,tenant,'llm_route',workspace,human,'core',route::text,'PROVISIONING',1);
              INSERT INTO catalog.agent_definition(resource_id,stable_slug,display_name,status)
                VALUES(definition,'abandon','Abandon fixture','PROVISIONING');
              INSERT INTO catalog.asset(id,tenant_id,resource_id,type_key,owner_principal_id,native_ref,state,version)
                VALUES(version_asset,tenant,definition,'agent.version',human,version_asset::text,'DRAFT',1);
              INSERT INTO catalog.agent_version(asset_id,agent_resource_id,ordinal,content,config_hash,state)
                VALUES(version_asset,definition,1,
                  jsonb_build_object('runtimeProfileKey','abandon-fixture','modelRouteResourceId',route),
                  repeat('a',64),'DRAFT');
              FOR n IN 1..2 LOOP
                installation:=installations[n]; agent:=gen_random_uuid();
                INSERT INTO identity.principal(id,tenant_id,kind,status) VALUES(agent,tenant,'AGENT','ACTIVE');
                INSERT INTO catalog.resource(id,tenant_id,type_key,home_workspace_id,owner_principal_id,
                  component_type_key,native_id,state,version)
                  VALUES(installation,tenant,'agent.installation',workspace,human,'core',installation::text,'PROVISIONING',1);
                INSERT INTO catalog.agent_installation(resource_id,workspace_id,agent_resource_id,pinned_version_asset_id,
                  agent_principal_id,runtime_isolation_ref,state)
                  VALUES(installation,workspace,definition,version_asset,agent,'fixture:'||installation,'PROVISIONING');
                INSERT INTO catalog.agent_runtime_projection(installation_resource_id,generation,agent_version_asset_id,
                  runtime_profile_key,model_route_resource_id,gateway_resource_ids,effective_fields,config_hash,state)
                  VALUES(installation,1,version_asset,'abandon-fixture',route,'{{}}','[]',repeat('a',64),'PENDING');
                -- settled: one old UNKNOWN Session whose only Invocation FAILED long ago.
                -- open: an old UNKNOWN Session with an UNKNOWN Invocation, and a fresh
                -- UNKNOWN Session whose Invocation just FAILED (still inside the deadline).
                FOR m IN 1..(CASE WHEN n=1 THEN 1 ELSE 2 END) LOOP
                  root:=repeat(chr(96+m),64);
                  status:=CASE WHEN n=2 AND m=1 THEN 'UNKNOWN' ELSE 'FAILED' END;
                  age:=CASE WHEN n=2 AND m=2 THEN interval '0 minutes' ELSE interval '2 hours' END;
                  INSERT INTO catalog.agent_session(tenant_id,workspace_id,root_event_id,installation_resource_id,
                    agent_version_asset_id,projection_generation,runtime_thread_id,core_memory_state,status,created_at)
                    VALUES(tenant,workspace,root,installation,version_asset,1,NULL,'UNREADABLE','UNKNOWN',now()-age);
                  action:=gen_random_uuid();
                  INSERT INTO admission.action_execution(id,operation_id,tenant_id,workspace_id,action_key,action_version,
                    initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id)
                    VALUES(action,gen_random_uuid(),tenant,workspace,'agent.invoke',1,
                      human,human,installation,repeat('a',64),'ALLOWED','DISPATCHED',gen_random_uuid());
                  INSERT INTO catalog.agent_invocation(id,tenant_id,workspace_id,root_event_id,source_event_id,
                    installation_resource_id,agent_version_asset_id,projection_generation,action_execution_id,workflow_id,
                    status,updated_at)
                    VALUES(gen_random_uuid(),tenant,workspace,root,repeat(m::text,64),installation,version_asset,1,
                      action,'abandon:'||action,status,now()-age);
                END LOOP;
              END LOOP;
            END $$;"#
        ))
        .execute(&mut *tx)
        .await
        .expect("abandon fixture");

        let drained = |installation: Uuid| {
            sqlx::query_scalar::<_, bool>("select catalog.agent_installation_drained($1)")
                .bind(installation)
        };
        assert!(!drained(settled).fetch_one(&mut *tx).await.unwrap());
        let found = candidates(&mut tx, 100_000, DEADLINE_SECONDS)
            .await
            .expect("candidates");
        let ours: Vec<_> = found
            .iter()
            .filter(|key| [settled, open].contains(&key.installation_resource_id))
            .collect();
        assert_eq!(ours.len(), 1, "only the settled Session is a candidate");
        let key = ours[0].clone();
        assert_eq!(key.installation_resource_id, settled);
        assert!(abandon(&mut tx, &key, DEADLINE_SECONDS).await.unwrap());
        // Already abandoned: nothing more is written.
        assert!(!abandon(&mut tx, &key, DEADLINE_SECONDS).await.unwrap());
        // Neither open Session qualifies even when asked directly.
        for root in ["a", "b"] {
            let open_key = SessionKey {
                workspace_id: key.workspace_id,
                root_event_id: root.repeat(64),
                installation_resource_id: open,
                projection_generation: 1,
            };
            assert!(!abandon(&mut tx, &open_key, DEADLINE_SECONDS).await.unwrap());
        }
        assert!(drained(settled).fetch_one(&mut *tx).await.unwrap());
        assert!(!drained(open).fetch_one(&mut *tx).await.unwrap());
        let statuses: Vec<(Uuid, String)> = sqlx::query_as(
            "select installation_resource_id, status from catalog.agent_session
             where installation_resource_id = any($1) order by installation_resource_id, root_event_id",
        )
        .bind(vec![settled, open])
        .fetch_all(&mut *tx)
        .await
        .expect("statuses");
        assert_eq!(
            statuses.iter().filter(|(_, s)| s == "ABANDONED").count(),
            1
        );
        assert!(statuses
            .iter()
            .all(|(id, s)| (*id == settled) == (s == "ABANDONED")));
        let facts: Vec<(String, String, Value)> = sqlx::query_as(
            "select event_type, result_code, evidence_refs from audit.audit_event where tenant_id = $1",
        )
        .bind(tenant)
        .fetch_all(&mut *tx)
        .await
        .expect("audit");
        assert_eq!(facts.len(), 1, "one reconciliation fact per abandoned Session");
        assert_eq!(
            (facts[0].0.as_str(), facts[0].1.as_str()),
            ("RECONCILIATION", "SESSION_ABANDONED")
        );
        assert_eq!(facts[0].2[0]["kind"], "ACTION_EXECUTION_ID");
        tx.rollback().await.expect("fixture rolls back");
        pool.close().await;
    }
}
