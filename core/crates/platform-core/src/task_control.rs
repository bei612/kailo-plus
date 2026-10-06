//! DD-84 / 06 §8: the existing task control chain also owns AgentTask cancellation.
//! No rerun registration, native replay, task terminal write or Capacity release.

use super::{Actor, Definition, Execution, Governance, Refusal, Semantic, Target};
use contracts::ReasonCode;
use sqlx::PgConnection;
use uuid::Uuid;

pub(crate) fn is_agent_cancel(key: &str) -> bool {
    matches!(
        key,
        "task.cancel.agent.invoke.v1" | "task.cancel.automation.run.v1"
    )
}

/// Register only controls of existing, active, implemented dynamic definitions.
/// This runs after the original two registration consumers; it neither creates
/// a business permission nor overwrites/reactivates an existing control version.
pub(crate) async fn register(g: &Governance) -> Result<(), String> {
    let mut conn = g.pool.acquire().await.map_err(|e| e.to_string())?;
    register_in(&mut conn).await.map_err(|e| e.to_string())
}

async fn register_in(conn: &mut PgConnection) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into catalog.action_definition
        (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
         permission,permission_object_type,execution_mode,confirmation_mode,
         capacity_policy,quota_policy,meters,result_exposure,audit_policy,
         obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,
         obs_cost_source,obs_redaction_policy,status)
        select 'task.cancel.'||d.action_key||'.v'||d.version,1,d.component_type_key,
          'ACTION_EXECUTION',d.tenant_rule,d.workspace_rule,d.permission,d.permission_object_type,
          'PROTOCOL','NONE','NONE','NONE','{}','NONE','FULL_LIFECYCLE',
          'OPERATION_NATIVE_REF','NONE','NATIVE','NONE','NONE','IDS_ONLY','ACTIVE'
        from catalog.action_definition d
        where d.action_key in ('agent.invoke','automation.run') and d.version=1
          and d.status='ACTIVE' and d.component_type_key='core' and d.component_release_id is null
          and d.target_type='RESOURCE' and d.tenant_rule='SESSION_TENANT'
          and d.workspace_rule='TARGET_HOME_WORKSPACE' and d.permission='execute'
          and d.permission_object_type='resource' and d.execution_mode='TEMPORAL'
          and d.workflow_type='AgentTaskWorkflow' and d.workflow_kind is null
          and not exists(select 1 from catalog.action_definition c
            where c.action_key='task.cancel.'||d.action_key||'.v'||d.version)
        on conflict do nothing",
    )
    .execute(conn)
    .await?;
    Ok(())
}

pub(super) async fn agent_source(
    conn: &mut PgConnection,
    original: &Execution,
    source: &Definition,
) -> Result<bool, Refusal> {
    if !is_agent_cancel(&super::cancel_key_for(original))
        || source.component_type_key != "core"
        || source.target_type != "RESOURCE"
        || source.permission_object_type != "resource"
        || source.permission != "execute"
        || source.tenant_rule != "SESSION_TENANT"
        || source.workspace_rule != "TARGET_HOME_WORKSPACE"
        || source.workflow_kind.is_some()
    {
        return Ok(false);
    }
    Ok(sqlx::query_scalar(
        "select exists(select 1 from catalog.action_definition d
         join admission.action_execution a on a.id=$1 and a.action_key=d.action_key
           and a.action_version=d.version
         where d.workflow_type='AgentTaskWorkflow' and d.workflow_kind is null
           and d.component_release_id is null and a.component_release_id is null
           and a.component_binding_kind is null
           and (a.action_definition_id=d.id or a.action_definition_id is null))",
    )
    .bind(original.id)
    .fetch_one(conn)
    .await?)
}

pub(super) async fn cancel_projection(
    conn: &mut PgConnection,
    original: &Execution,
    source: &Definition,
) -> Result<Option<(String, Option<String>)>, Refusal> {
    let workflow_type = if source.workflow_kind.is_some() {
        crate::component_task::WORKFLOW_TYPE
    } else if agent_source(conn, original, source).await? {
        crate::agent_task::WORKFLOW_TYPE
    } else {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    };
    Ok(sqlx::query_as(
        "select projection_state,run_id from projection.workflow_ref
         where workflow_id=$1 and tenant_id=$2 and action_execution_id=$3
           and workflow_type=$4 and kind is not distinct from $5
           and workspace_id is not distinct from $6 and operation_id=$7",
    )
    .bind(&original.temporal_workflow_id)
    .bind(original.tenant_id)
    .bind(original.id)
    .bind(workflow_type)
    .bind(&source.workflow_kind)
    .bind(original.workspace_id)
    .bind(original.operation_id)
    .fetch_optional(conn)
    .await?)
}

pub(super) fn same_execution_chain(reference: Option<&str>, current: &str, first: &str) -> bool {
    !current.is_empty()
        && !first.is_empty()
        && reference.is_some_and(|run| !run.is_empty() && (run == current || run == first))
}

/// The control target is an ActionExecution, never a SpiceDB Resource. Resolve
/// the original resource and workspace through owned Core facts before the
/// existing fully-consistent permission check and membership admission.
pub(super) async fn permission_resource(
    g: &Governance,
    actor: Actor,
    control: &Definition,
    target: &Target,
) -> Result<Uuid, Refusal> {
    let mut conn = g.pool.acquire().await?;
    let (original, _) = super::control_original(
        &mut conn,
        actor.tenant_id,
        actor.principal_id,
        control,
        Semantic::TaskCancel,
        target.id,
        false,
    )
    .await?;
    if original.workspace_id != target.workspace_id || original.action_version != target.version {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let valid = match original.action_key.as_str() {
        "agent.invoke" => {
            let row = super::delegation::installation(
                &mut conn,
                actor.tenant_id,
                original.target_id,
                false,
                true,
            )
            .await?
            .filter(|r| Some(r.workspace_id) == original.workspace_id);
            match row {
                Some(row) => super::delegation::projection_matches(g, &row).await?,
                None => false,
            }
        }
        "automation.run" => {
            let row = crate::automation::management_resource(
                &mut conn,
                actor.tenant_id,
                original.target_id,
                false,
            )
            .await?
            .filter(|r| {
                r.state == "ACTIVE"
                    && r.projection_action_execution_id.is_none()
                    && Some(r.workspace_id) == original.workspace_id
            });
            match row {
                Some(row) => crate::automation::management_projection(g, &row).await?,
                None => false,
            }
        }
        _ => false,
    };
    if !valid {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    Ok(original.target_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_controls_are_exact_cancel_versions_not_rerun_or_prefixes() {
        for key in [
            "task.cancel.agent.invoke.v1",
            "task.cancel.automation.run.v1",
        ] {
            assert!(is_agent_cancel(key));
        }
        for key in [
            "task.rerun.agent.invoke.v1",
            "task.cancel.agent.invoke.v2",
            "task.cancel.agent.invoke.v1.extra",
            "task.cancel.other.v1",
        ] {
            assert!(!is_agent_cancel(key));
        }
    }

    #[test]
    fn cancel_fences_original_chain_and_allows_its_continue_as_new() {
        assert!(same_execution_chain(Some("first"), "current", "first"));
        assert!(same_execution_chain(Some("current"), "current", "first"));
        assert!(!same_execution_chain(Some("old-chain"), "current", "first"));
        assert!(!same_execution_chain(None, "current", "first"));
        assert!(!same_execution_chain(Some(""), "current", "first"));
        assert!(!same_execution_chain(Some("current"), "current", ""));
        assert!(!same_execution_chain(Some("first"), "", "first"));
    }

    #[tokio::test]
    #[ignore = "requires AGENT_INVOKE_TEST_DATABASE_URL pointing at a disposable migrated database"]
    async fn agent_cancel_original_and_projection_use_owned_exact_workflow() {
        let pool = sqlx::PgPool::connect(&std::env::var("AGENT_INVOKE_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        let tenant = Uuid::new_v4();
        let workspace = Uuid::new_v4();
        let human = Uuid::new_v4();
        sqlx::query("insert into identity.tenant(id,slug,name,state) values($1,$1::text,'cancel fixture','ACTIVE')")
            .bind(tenant).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into identity.workspace(id,tenant_id,slug,name,state) values($1,$2,$1::text,'cancel fixture','ACTIVE')")
            .bind(workspace).bind(tenant).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'HUMAN','ACTIVE')")
            .bind(human).bind(tenant).execute(&mut *tx).await.unwrap();
        for key in ["agent.invoke", "automation.run"] {
            sqlx::query("insert into catalog.action_definition
                (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
                 permission,permission_object_type,execution_mode,confirmation_mode,workflow_type,
                 capacity_policy,quota_policy,meters,result_exposure,audit_policy,obs_correlation_mode,
                 obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
                values($1,1,'core','RESOURCE','SESSION_TENANT','TARGET_HOME_WORKSPACE',
                 'execute','resource','TEMPORAL','NONE','AgentTaskWorkflow','NONE','NONE','{}','NONE',
                 'FULL_LIFECYCLE','OPERATION_REF','TEMPORAL','TEMPORAL','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE')
                on conflict do nothing")
                .bind(key).execute(&mut *tx).await.unwrap();
        }
        register_in(&mut tx).await.unwrap();
        register_in(&mut tx).await.unwrap();
        for key in ["agent.invoke", "automation.run"] {
            let control_key = format!("task.cancel.{key}.v1");
            let control: Definition = sqlx::query_as(&format!(
                "select {} from catalog.action_definition where action_key=$1 and version=1",
                super::super::DEFINITION_COLUMNS
            ))
            .bind(&control_key)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
            assert_eq!(control.quota_policy, "NONE");
            assert!(control.meters.is_empty());
            let count: i64 = sqlx::query_scalar(
                "select count(*) from catalog.action_definition where action_key=$1",
            )
            .bind(&control_key)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
            assert_eq!(count, 1);
            let action = Uuid::new_v4();
            let operation = Uuid::new_v4();
            let workflow = format!("verify-cancel:{action}");
            sqlx::query("insert into admission.action_execution
                (id,operation_id,tenant_id,workspace_id,action_key,action_version,initiator_principal_id,
                 actor_principal_id,target_id,parameter_hash,temporal_workflow_id,gate_state,dispatch_state,correlation_id)
                values($1,$2,$3,$4,$5,1,$6,$6,$1,$7,$8,'ALLOWED','DISPATCHED',$1)")
                .bind(action).bind(operation).bind(tenant).bind(workspace).bind(key).bind(human)
                .bind("0".repeat(64)).bind(&workflow).execute(&mut *tx).await.unwrap();
            sqlx::query("insert into projection.workflow_ref
                (workflow_id,workflow_type,workflow_version,kind,tenant_id,workspace_id,operation_id,
                 action_execution_id,projection_state,run_id)
                values($1,'AgentTaskWorkflow',1,null,$2,$3,$4,$5,'RUNNING',$6)")
                .bind(&workflow).bind(tenant).bind(workspace).bind(operation).bind(action)
                .bind(Uuid::new_v4().to_string()).execute(&mut *tx).await.unwrap();
            let (original, source) = super::super::control_original(
                &mut tx,
                tenant,
                human,
                &control,
                Semantic::TaskCancel,
                action,
                false,
            )
            .await
            .unwrap();
            assert_eq!(
                cancel_projection(&mut tx, &original, &source)
                    .await
                    .unwrap()
                    .map(|(state, _)| state)
                    .as_deref(),
                Some("RUNNING")
            );
            for (other_tenant, other_human) in [(Uuid::new_v4(), human), (tenant, Uuid::new_v4())] {
                assert!(super::super::control_original(
                    &mut tx,
                    other_tenant,
                    other_human,
                    &control,
                    Semantic::TaskCancel,
                    action,
                    false
                )
                .await
                .is_err());
            }
            let mut wrong = control.clone();
            wrong.permission = "read".into();
            assert!(super::super::control_original(
                &mut tx,
                tenant,
                human,
                &wrong,
                Semantic::TaskCancel,
                action,
                false
            )
            .await
            .is_err());
            wrong = control.clone();
            wrong.action_key = format!("task.rerun.{key}.v1");
            assert!(super::super::control_original(
                &mut tx,
                tenant,
                human,
                &wrong,
                Semantic::TaskRerun,
                action,
                false
            )
            .await
            .is_err());
            let mut wrong_original = original;
            wrong_original.workspace_id = Some(Uuid::new_v4());
            assert!(cancel_projection(&mut tx, &wrong_original, &source)
                .await
                .unwrap()
                .is_none());
            wrong_original.workspace_id = Some(workspace);
            wrong_original.operation_id = Uuid::new_v4();
            assert!(cancel_projection(&mut tx, &wrong_original, &source)
                .await
                .unwrap()
                .is_none());
            wrong_original.operation_id = operation;
            wrong_original.temporal_workflow_id = Some(format!("other:{action}"));
            assert!(cancel_projection(&mut tx, &wrong_original, &source)
                .await
                .unwrap()
                .is_none());
        }
        tx.rollback().await.unwrap();
    }
}
