//! Post-implementation checks of the actual retained Activity/receipt consumers.
//! Native replies are injected at the RPC boundary; no model or live service runs.
use super::*;
use crate::agent_runtime::RuntimeError;

pub(crate) async fn fixture(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>) -> Uuid {
    let tenant = Uuid::new_v4();
    sqlx::raw_sql(
        &include_str!("../../../../verify/agent-task-receipt-fixture.sql")
            .replace("__TENANT__", &tenant.to_string()),
    )
    .execute(&mut **tx)
    .await
    .unwrap();
    tenant
}

async fn pool() -> (sqlx::PgPool, sqlx::pool::PoolConnection<sqlx::Postgres>) {
    let pool = sqlx::PgPool::connect(&std::env::var("AGENT_INVOKE_TEST_DATABASE_URL").unwrap())
        .await
        .unwrap();
    let mut lock = pool.acquire().await.unwrap();
    lock.close_on_drop();
    sqlx::query("select pg_advisory_lock(hashtextextended('agent-receipt-fixture-definition',0))")
        .execute(&mut *lock)
        .await
        .unwrap();
    // This action is runtime-configured, not migration-seeded. Reproduce the
    // original agent_invocation::register row in the disposable database so
    // the real audit consumer can resolve its frozen definition on its pool.
    // Existing configuration is never overwritten; all per-case facts below
    // remain in rolled-back transactions. No meter or permission is granted.
    sqlx::query("insert into catalog.action_definition
        (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
         permission,permission_object_type,execution_mode,confirmation_mode,
         workflow_type,capacity_policy,capacity_pool_key,quota_policy,meters,
         result_exposure,audit_policy,obs_correlation_mode,obs_progress_source,
         obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
        select 'agent.invoke',1,'core','RESOURCE','SESSION_TENANT','TARGET_HOME_WORKSPACE',
          'execute','resource','TEMPORAL','NONE','AgentTaskWorkflow','PLATFORM_SLOT','receipt-fixture','CHECK',ARRAY['receipt-fixture-model'],
          'NONE','FULL_LIFECYCLE','OPERATION_REF','TEMPORAL','TEMPORAL','OPENMETER',
          'NONE','PLATFORM_METADATA_ONLY','ACTIVE'
        where not exists(select 1 from catalog.action_definition where action_key='agent.invoke')
        on conflict do nothing")
        .execute(&pool).await.unwrap();
    (pool, lock)
}

async fn cleanup_definition(pool: &sqlx::PgPool) {
    sqlx::query(
        "delete from catalog.action_definition where action_key='agent.invoke' and version=1
        and capacity_pool_key='receipt-fixture' and meters=ARRAY['receipt-fixture-model']",
    )
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
#[ignore = "requires disposable AGENT_INVOKE_TEST_DATABASE_URL and fixture OPENMETER_* configuration"]
async fn dispatch_preparation_refusal_rolls_back_intent_instead_of_stranding_unknown() {
    use sqlx::Acquire;
    let (pool, _lock) = pool().await;
    let mut tx = pool.begin().await.unwrap();
    let tenant = fixture(&mut tx).await;
    let row = invocation(&mut tx, tenant).await;
    let projection = RuntimeRef {
        installation_id: row.installation_resource_id,
        generation: row.projection_generation,
        config_hash: "a".repeat(64),
    };
    let openmeter = crate::openmeter::OpenMeter::from_env().unwrap();
    // This existing fixture deliberately has no ACTIVE model binding/slot.
    // The actual prepare_turn must refuse before any HTTP/native request.
    // A savepoint permits inspecting the caller's original state afterwards.
    let mut dispatch = tx.begin().await.unwrap();
    sqlx::query("update catalog.agent_invocation set status='DISPATCHING' where id=$1")
        .bind(row.id)
        .execute(&mut *dispatch)
        .await
        .unwrap();
    assert!(matches!(
        commit_dispatch(
            dispatch,
            &openmeter,
            &projection,
            row.id,
            row.runtime_thread_id.as_deref().unwrap(),
        )
        .await,
        Err(RuntimeError::AdmissionRequired)
    ));
    assert_eq!(status(&mut tx, row.id).await, "CREATED");
    let trace_count: i64 = sqlx::query_scalar(
        "select count(*) from projection.agent_model_trace where invocation_id=$1",
    )
    .bind(row.id)
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    assert_eq!(trace_count, 0);
    tx.rollback().await.unwrap();
    cleanup_definition(&pool).await;
}

async fn invocation(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, tenant: Uuid) -> Invocation {
    let id: Uuid = sqlx::query_scalar("select id from catalog.agent_invocation where tenant_id=$1 order by source_event_id limit 1")
        .bind(tenant).fetch_one(&mut **tx).await.unwrap();
    sqlx::query_as(LOAD)
        .bind(id)
        .fetch_one(&mut **tx)
        .await
        .unwrap()
}

async fn status(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, id: Uuid) -> String {
    sqlx::query_scalar("select status from catalog.agent_invocation where id=$1")
        .bind(id)
        .fetch_one(&mut **tx)
        .await
        .unwrap()
}

async fn invocation_without_birth(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: Uuid,
    session_status: &str,
) -> Invocation {
    let id = Uuid::new_v4();
    let action = Uuid::new_v4();
    let workflow = format!("receipt-cancel:{id}");
    sqlx::query("insert into admission.action_execution
        (id,operation_id,tenant_id,workspace_id,action_key,action_version,
         initiator_principal_id,actor_principal_id,target_id,parameter_hash,
         gate_state,dispatch_state,correlation_id,temporal_workflow_id)
        select $2,gen_random_uuid(),a.tenant_id,a.workspace_id,a.action_key,a.action_version,
         a.initiator_principal_id,a.actor_principal_id,a.target_id,a.parameter_hash,
         a.gate_state,a.dispatch_state,gen_random_uuid(),$3
        from admission.action_execution a join catalog.agent_invocation i on i.action_execution_id=a.id
        where i.tenant_id=$1 and i.source_event_id=repeat('1',64)")
        .bind(tenant).bind(action).bind(&workflow).execute(&mut **tx).await.unwrap();
    sqlx::query(
        "update catalog.agent_session set status=$2
        where tenant_id=$1 and root_event_id=repeat('c',64) and runtime_thread_id is null",
    )
    .bind(tenant)
    .bind(session_status)
    .execute(&mut **tx)
    .await
    .unwrap();
    sqlx::query("insert into catalog.agent_invocation
        (id,tenant_id,workspace_id,root_event_id,source_event_id,installation_resource_id,
         agent_version_asset_id,projection_generation,action_execution_id,workflow_id,status,cancel_pending)
        select $2,s.tenant_id,s.workspace_id,s.root_event_id,repeat('e',64),s.installation_resource_id,
          s.agent_version_asset_id,s.projection_generation,$3,$4,'CREATED',true
        from catalog.agent_session s where s.tenant_id=$1 and s.root_event_id=repeat('c',64)")
        .bind(tenant).bind(id).bind(action).bind(workflow).execute(&mut **tx).await.unwrap();
    sqlx::query_as(LOAD)
        .bind(id)
        .fetch_one(&mut **tx)
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "requires AGENT_INVOKE_TEST_DATABASE_URL pointing at a disposable migrated database"]
async fn receipt_created_cancellation_does_not_require_a_birth_receipt() {
    let (pool, _lock) = pool().await;
    for session_status in ["STARTING", "UNKNOWN"] {
        let mut tx = pool.begin().await.unwrap();
        let tenant = fixture(&mut tx).await;
        let mut row = invocation_without_birth(&mut tx, tenant, session_status).await;
        assert!(row.runtime_thread_id.is_none());
        let workspace = row.workspace_id;
        row.workspace_id = Uuid::new_v4();
        assert!(!cancel_before_dispatch_in_transaction(&pool, &mut tx, &row)
            .await
            .unwrap());
        row.workspace_id = workspace;
        assert!(cancel_before_dispatch_in_transaction(&pool, &mut tx, &row)
            .await
            .unwrap());
        assert_eq!(status(&mut tx, row.id).await, "CANCELED");
        let facts: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
            "select runtime_turn_id,native_status,reply_event_id from catalog.agent_invocation where id=$1")
            .bind(row.id).fetch_one(&mut *tx).await.unwrap();
        assert_eq!(facts, (None, None, None));
        let audit: Vec<String> =
            sqlx::query_scalar("select result_code from audit.audit_event where tenant_id=$1")
                .bind(tenant)
                .fetch_all(&mut *tx)
                .await
                .unwrap();
        assert_eq!(audit, ["CANCELED_BEFORE_MODEL_DISPATCH"]);
        tx.rollback().await.unwrap();
    }
    cleanup_definition(&pool).await;
}

#[tokio::test]
#[ignore = "requires AGENT_INVOKE_TEST_DATABASE_URL pointing at a disposable migrated database"]
async fn receipt_created_cancellation_rechecks_dispatch_and_trace_after_the_old_read() {
    let (pool, _lock) = pool().await;
    let mut tx = pool.begin().await.unwrap();
    let tenant = fixture(&mut tx).await;
    let row = invocation_without_birth(&mut tx, tenant, "UNKNOWN").await;
    for dispatched in ["DISPATCHING", "UNKNOWN"] {
        sqlx::query("update catalog.agent_invocation set status=$2 where id=$1")
            .bind(row.id)
            .bind(dispatched)
            .execute(&mut *tx)
            .await
            .unwrap();
        assert!(!cancel_before_dispatch_in_transaction(&pool, &mut tx, &row)
            .await
            .unwrap());
        assert_eq!(status(&mut tx, row.id).await, dispatched);
    }
    // A stale CREATED read may not erase independently committed trace evidence.
    let traced = invocation(&mut tx, tenant).await;
    sqlx::query("update admission.action_execution set temporal_workflow_id=$2 where id=$1")
        .bind(traced.action_execution_id)
        .bind(&traced.workflow_id)
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("update catalog.agent_invocation set cancel_pending=true where id=$1")
        .bind(traced.id)
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("insert into projection.agent_model_trace(invocation_id,trace_id,span_id,operation_id,tenant_id,workspace_id,
        gateway_principal_id,openmeter_customer_id,openmeter_namespace,subject_key,binding_version,meter_projection,invocation_meter_projection)
        select i.id,replace(gen_random_uuid()::text,'-',''),repeat('a',16),a.operation_id,i.tenant_id,i.workspace_id,
        b.gateway_principal_id,o.customer_id,o.namespace,o.subject_key_prefix||i.installation_resource_id,1,'[{\"key\":\"fixture\"}]',null
        from catalog.agent_invocation i join admission.action_execution a on a.id=i.action_execution_id
        join catalog.agent_model_binding b on b.installation_resource_id=i.installation_resource_id and b.projection_generation=i.projection_generation
        join projection.openmeter_binding o on o.tenant_id=i.tenant_id where i.id=$1")
        .bind(traced.id).execute(&mut *tx).await.unwrap();
    assert!(
        !cancel_before_dispatch_in_transaction(&pool, &mut tx, &traced)
            .await
            .unwrap()
    );
    assert_eq!(status(&mut tx, traced.id).await, "CREATED");
    let audits: i64 =
        sqlx::query_scalar("select count(*) from audit.audit_event where tenant_id=$1")
            .bind(tenant)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
    assert_eq!(audits, 0);
    tx.rollback().await.unwrap();
    cleanup_definition(&pool).await;
}

#[tokio::test]
#[ignore = "requires AGENT_INVOKE_TEST_DATABASE_URL pointing at a disposable migrated database"]
async fn receipt_not_sent_trace_scope_and_audit_are_checked_by_original_transaction() {
    let (pool, _lock) = pool().await;
    let mut tx = pool.begin().await.unwrap();
    let tenant = fixture(&mut tx).await;
    let mut row = invocation(&mut tx, tenant).await;
    let thread = row.runtime_thread_id.clone().unwrap();
    // Repeated pre-send refusals permit fresh admission, not native replay.
    for _ in 0..2 {
        sqlx::query("update catalog.agent_invocation set status='DISPATCHING' where id=$1")
            .bind(row.id)
            .execute(&mut *tx)
            .await
            .unwrap();
        assert!(!record_turn_in_transaction(
            &pool,
            &mut tx,
            &row,
            &thread,
            Err(RuntimeError::AdmissionRequired)
        )
        .await
        .unwrap());
        assert_eq!(status(&mut tx, row.id).await, "CREATED");
    }
    let audit: Vec<(String, String)> = sqlx::query_as(
        "select event_key,result_code from audit.audit_event where tenant_id=$1 order by event_key",
    )
    .bind(tenant)
    .fetch_all(&mut *tx)
    .await
    .unwrap();
    let operation: Uuid =
        sqlx::query_scalar("select operation_id from admission.action_execution where id=$1")
            .bind(row.action_execution_id)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
    assert_eq!(
        audit,
        vec![(
            format!("{operation}:agent-turn:{}:not-sent", row.id),
            "DISPATCH_NOT_SENT".into()
        )]
    );

    sqlx::query("update catalog.agent_invocation set status='DISPATCHING',native_status='completed' where id=$1")
        .bind(row.id).execute(&mut *tx).await.unwrap();
    record_turn_in_transaction(&pool, &mut tx, &row, &thread, Err(RuntimeError::Unknown))
        .await
        .unwrap();
    assert_eq!(status(&mut tx, row.id).await, "UNKNOWN");
    sqlx::query("update catalog.agent_invocation set native_status=null where id=$1")
        .bind(row.id)
        .execute(&mut *tx)
        .await
        .unwrap();
    // All real migrated trace guards are enabled; this is no fake trace table.
    sqlx::query("insert into projection.agent_model_trace(invocation_id,trace_id,span_id,operation_id,tenant_id,workspace_id,
        gateway_principal_id,openmeter_customer_id,openmeter_namespace,subject_key,binding_version,meter_projection,invocation_meter_projection)
        select i.id,replace(gen_random_uuid()::text,'-',''),repeat('a',16),a.operation_id,i.tenant_id,i.workspace_id,
        b.gateway_principal_id,o.customer_id,o.namespace,o.subject_key_prefix||i.installation_resource_id,1,'[{\"key\":\"fixture\"}]',null
        from catalog.agent_invocation i join admission.action_execution a on a.id=i.action_execution_id
        join catalog.agent_model_binding b on b.installation_resource_id=i.installation_resource_id and b.projection_generation=i.projection_generation
        join projection.openmeter_binding o on o.tenant_id=i.tenant_id where i.id=$1")
        .bind(row.id).execute(&mut *tx).await.unwrap();
    record_turn_in_transaction(
        &pool,
        &mut tx,
        &row,
        &thread,
        Err(RuntimeError::Unavailable),
    )
    .await
    .unwrap();
    assert_eq!(status(&mut tx, row.id).await, "UNKNOWN");
    // A valid native receipt is not lost merely because the earlier observer
    // no longer owns a capacity lease. Receipt writes do not dispatch again.
    assert!(
        record_turn_in_transaction(&pool, &mut tx, &row, &thread, Ok("accepted-turn".into()))
            .await
            .unwrap()
    );
    let bound_audits: Vec<String> = sqlx::query_scalar("select event_key from audit.audit_event where tenant_id=$1 and result_code='NATIVE_TURN_BOUND'")
        .bind(tenant).fetch_all(&mut *tx).await.unwrap();
    assert_eq!(
        bound_audits,
        vec![format!("{operation}:agent-turn:{}:bound", row.id)]
    );
    assert_eq!(status(&mut tx, row.id).await, "RUNNING");
    assert!(
        record_turn_in_transaction(&pool, &mut tx, &row, &thread, Ok("accepted-turn".into()))
            .await
            .unwrap()
    );
    assert!(!record_turn_in_transaction(
        &pool,
        &mut tx,
        &row,
        "foreign-thread",
        Ok("accepted-turn".into())
    )
    .await
    .unwrap());
    row.projection_generation += 1;
    assert!(
        !record_turn_in_transaction(&pool, &mut tx, &row, &thread, Ok("accepted-turn".into()))
            .await
            .unwrap()
    );
    row.projection_generation -= 1;
    row.workspace_id = Uuid::new_v4();
    assert!(
        !record_turn_in_transaction(&pool, &mut tx, &row, &thread, Ok("accepted-turn".into()))
            .await
            .unwrap()
    );
    tx.rollback().await.unwrap();
    cleanup_definition(&pool).await;
}

#[tokio::test]
#[ignore = "requires AGENT_INVOKE_TEST_DATABASE_URL pointing at a disposable migrated database"]
async fn receipt_http_observer_cancel_does_not_drop_accepted_turn_transaction() {
    let (pool, _lock) = pool().await;
    let cleanup_pool = pool.clone();
    let mut tx = pool.begin().await.unwrap();
    let tenant = fixture(&mut tx).await;
    let row = invocation(&mut tx, tenant).await;
    let id = row.id;
    let thread = row.runtime_thread_id.clone().unwrap();
    sqlx::query("update catalog.agent_invocation set status='DISPATCHING' where id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .unwrap();
    let (entered, started) = tokio::sync::oneshot::channel();
    let (receipt, delivered) = tokio::sync::oneshot::channel();
    let (finished, done) = tokio::sync::oneshot::channel();
    // This is the exact boundary called by advance after authentication. The
    // inner future uses its real receipt writer and real audit transaction.
    let observer = tokio::spawn(retain_accepted(id, async move {
        entered.send(()).unwrap();
        let native_turn = delivered.await.unwrap();
        assert!(
            record_turn_in_transaction(&pool, &mut tx, &row, &thread, Ok(native_turn))
                .await
                .unwrap()
        );
        let recorded = status(&mut tx, id).await;
        let audits: i64 = sqlx::query_scalar("select count(*) from audit.audit_event where tenant_id=$1 and result_code='NATIVE_TURN_BOUND'")
            .bind(tenant).fetch_one(&mut *tx).await.unwrap();
        tx.rollback().await.unwrap();
        finished.send((recorded, audits)).unwrap();
        result(id, TaskStatus::Running, "NONE")
    }));
    started.await.unwrap();
    observer.abort();
    assert!(observer.await.unwrap_err().is_cancelled());
    receipt
        .send("accepted-after-http-cancel".to_owned())
        .unwrap();
    assert_eq!(done.await.unwrap(), ("RUNNING".into(), 1));
    cleanup_definition(&cleanup_pool).await;
}
