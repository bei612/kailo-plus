//! DD-107: the authenticated owner requests one original automation.run.
//! Manual input is a stable reference, never a fabricated Relay event or a
//! second executor. All pin/Grant/actor/output decisions remain server-owned.

use super::*;

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

pub(crate) fn validate_command(value: &Value) -> Result<(), Refusal> {
    if !value.as_object().is_some_and(|fields| {
        fields.keys().all(|key| {
            matches!(
                key.as_str(),
                "actionKey"
                    | "idempotencyKey"
                    | "resourceId"
                    | "resourceVersion"
                    | "workspaceId"
                    | "explicitConfirmation"
            )
        })
    }) || value.get("explicitConfirmation") != Some(&Value::Bool(true))
    {
        return Err(invalid());
    }
    Ok(())
}

pub(super) fn request(command: &contracts::ActionCommand) -> Result<Value, Refusal> {
    let value = serde_json::to_value(command).map_err(|_| invalid())?;
    validate_command(&value)?;
    let id = |value: Option<&str>| {
        value
            .and_then(|v| {
                Uuid::parse_str(v)
                    .ok()
                    .filter(|id| !id.is_nil() && id.to_string() == v)
            })
            .ok_or_else(invalid)
    };
    let resource = id(command.resource_id.as_deref())?;
    let workspace = id(command.workspace_id.as_deref())?;
    let key = id(Some(&command.idempotency_key))?;
    let version = command
        .resource_version
        .filter(|version| *version > 0 && i32::try_from(*version).is_ok())
        .ok_or_else(invalid)?;
    if command.action_key != ACTION {
        return Err(invalid());
    }
    Ok(
        json!({"resourceId":resource,"workspaceId":workspace,"resourceVersion":version,
        "idempotencyKey":key,"explicitConfirmation":true}),
    )
}

pub(super) fn source(owner: Uuid, resource: Uuid, key: Uuid) -> String {
    format!("manual:{owner}:{resource}:{key}")
}

pub(super) fn workflow(tenant: Uuid, resource: Uuid, source: &str) -> String {
    format!("platform:automation_run:{tenant}:{resource}-{source}")
}

pub(crate) async fn available(g: &Governance) -> Result<bool, Refusal> {
    match definition(g).await {
        Ok(_) => Ok(true),
        Err(Refusal::Blocked(_) | Refusal::Precondition(_)) => Ok(false),
        Err(error) => Err(error),
    }
}

pub(super) async fn check_replay<'c, E>(
    conn: E,
    id: Uuid,
    command: &contracts::ActionCommand,
) -> Result<(), Refusal>
where
    E: sqlx::Executor<'c, Database = Postgres>,
{
    let parameters: Option<(String, Uuid, Option<Uuid>, Option<Value>)> = sqlx::query_as(
        "select action_key,target_id,workspace_id,parameters from admission.action_execution where id=$1")
        .bind(id).fetch_optional(conn).await?;
    let expected = request(command)?;
    let Some((key, target, workspace, Some(parameters))) = parameters else {
        return Err(Refusal::Conflict(ReasonCode::IdempotencyKeyReused));
    };
    if key != ACTION
        || parameters.get("sourceKind").and_then(Value::as_str) != Some("MANUAL")
        || parameters.get("manualRequest") != Some(&expected)
        || Some(target.to_string().as_str()) != command.resource_id.as_deref()
        || workspace.map(|id| id.to_string()).as_deref() != command.workspace_id.as_deref()
    {
        return Err(Refusal::Conflict(ReasonCode::IdempotencyKeyReused));
    }
    Ok(())
}

/// No admin exception: this source is the actual active HUMAN owner and must
/// currently belong to this Workspace. execute is freshly checked separately.
pub(super) async fn fresh_owner(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    workspace: Uuid,
    resource: Uuid,
    owner: Uuid,
) -> Result<(), Refusal> {
    let active: bool = sqlx::query_scalar("select exists(select 1
        from identity.principal p join identity.tenant t on t.id=p.tenant_id and t.state='ACTIVE'
        join identity.tenant_membership tm on tm.tenant_id=t.id and tm.tenant_principal_id=p.id and tm.state='ACTIVE'
        join identity.workspace w on w.id=$2 and w.tenant_id=t.id and w.state='ACTIVE'
        join identity.workspace_membership wm on wm.workspace_id=w.id and wm.tenant_principal_id=p.id and wm.state='ACTIVE'
        join catalog.resource r on r.id=$3 and r.tenant_id=t.id and r.home_workspace_id=w.id
          and r.owner_principal_id=p.id and r.type_key='automation' and r.state='ACTIVE'
        where t.id=$1 and p.id=$4 and p.kind='HUMAN' and p.status='ACTIVE')")
        .bind(tenant).bind(workspace).bind(resource).bind(owner).fetch_one(&mut **tx).await?;
    if !active {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let checked = g
        .spicedb
        .check(
            "resource",
            &resource.to_string(),
            "execute",
            &owner.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Manual owner permission 不可核验".into()))?;
    if checked.zed_token.is_empty() {
        return Err(Refusal::Unavailable(
            "Manual owner permission 缺原生 revision".into(),
        ));
    }
    if !checked.allowed {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    Ok(())
}

pub(crate) fn frozen_source(ae: &governance::Execution, source_id: &str, root: &str) -> bool {
    let Some(p) = ae.parameters.as_ref() else {
        return false;
    };
    let Some(key) = p
        .pointer("/manualRequest/idempotencyKey")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .filter(|key| !key.is_nil())
    else {
        return false;
    };
    let expected = source(ae.initiator_principal_id, ae.target_id, key);
    ae.action_key == ACTION
        && ae.actor_principal_id != ae.initiator_principal_id
        && source_id == expected
        && root == expected
        && p.get("sourceKind").and_then(Value::as_str) == Some("MANUAL")
        && p.get("sourcePrincipalId").and_then(Value::as_str)
            == Some(ae.initiator_principal_id.to_string().as_str())
        && p.get("sourceEventId").and_then(Value::as_str) == Some(source_id)
        && p.get("rootEventId").and_then(Value::as_str) == Some(root)
        && p.get("sourcePubkey").is_none()
        && p.pointer("/manualRequest/resourceId")
            .and_then(Value::as_str)
            == Some(ae.target_id.to_string().as_str())
        && p.pointer("/manualRequest/workspaceId")
            .and_then(Value::as_str)
            == ae.workspace_id.map(|id| id.to_string()).as_deref()
        && p.pointer("/manualRequest/resourceVersion")
            .and_then(Value::as_i64)
            == ae.frozen_target_version().map(i64::from)
        && p.pointer("/manualRequest/idempotencyKey")
            .and_then(Value::as_str)
            == Some(key.to_string().as_str())
        && p.pointer("/manualRequest/explicitConfirmation") == Some(&Value::Bool(true))
}

pub(crate) async fn submit_manual(
    state: &crate::bff::BffState,
    ctx: &crate::bff::ExecutionContext,
    command: &contracts::ActionCommand,
) -> Result<(axum::http::StatusCode, contracts::ActionSubmission), (Refusal, Option<Uuid>)> {
    let admit = async {
        if ctx.access_mode != contracts::PlatformSessionAccessMode::Full {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        let frozen_request = request(command)?;
        let resource = Uuid::parse_str(frozen_request["resourceId"].as_str().ok_or_else(invalid)?)
            .map_err(|_| invalid())?;
        let workspace =
            Uuid::parse_str(frozen_request["workspaceId"].as_str().ok_or_else(invalid)?)
                .map_err(|_| invalid())?;
        let key = Uuid::parse_str(&command.idempotency_key).map_err(|_| invalid())?;
        let mut tx = state.pool.begin().await?;
        let target = management_resource(&mut tx, ctx.tenant_id, resource, false)
            .await?
            .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
        if target.owner_principal_id != ctx.tenant_principal_id || target.workspace_id != workspace
        {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        fresh_owner(
            &state.governance,
            &mut tx,
            ctx.tenant_id,
            workspace,
            resource,
            ctx.tenant_principal_id,
        )
        .await?;
        let prior: Option<Uuid> = sqlx::query_scalar(
            "select id from admission.action_execution
            where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3",
        )
        .bind(ctx.tenant_id)
        .bind(ctx.tenant_principal_id)
        .bind(key)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(id) = prior {
            check_replay(&mut *tx, id, command).await?;
            return Ok(id);
        }
        let snapshot = run(&mut tx, resource, None).await?;
        if snapshot.tenant_id != ctx.tenant_id
            || snapshot.workspace_id != workspace
            || snapshot.owner_principal_id != ctx.tenant_principal_id
            || snapshot.human_identity_id != Some(ctx.human_identity_id)
            || command.resource_version != Some(i64::from(snapshot.resource_version))
        {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
        tx.commit().await?;
        let def = definition(&state.governance).await?;
        match admit_source(
            &state.memory_service,
            &snapshot,
            &def,
            AdmissionSource::Manual(ctx, command),
        )
        .await
        {
            Ok(id) => Ok(id),
            Err(error) => {
                // A committed admission/unknown Start is read back, not replaced
                // with a new operation or a second manual request.
                let prior: Option<Uuid> = sqlx::query_scalar(
                    "select id from admission.action_execution
                    where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3",
                )
                .bind(ctx.tenant_id)
                .bind(ctx.tenant_principal_id)
                .bind(key)
                .fetch_optional(&state.pool)
                .await?;
                if let Some(id) = prior {
                    check_replay(&state.pool, id, command).await?;
                    Ok(id)
                } else {
                    Err(error)
                }
            }
        }
    }
    .await;
    let id = admit.map_err(|error| (error, None))?;
    let ae = governance::load_execution(&state.pool, id)
        .await
        .map_err(|error| (Refusal::from(error), None))?
        .ok_or((Refusal::Conflict(ReasonCode::TargetStateConflict), None))?;
    if ae.tenant_id != ctx.tenant_id || ae.initiator_principal_id != ctx.tenant_principal_id {
        return Err((Refusal::Denied(ReasonCode::ScopeGuardFailed), None));
    }
    governance::submission_result(&ae)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command() -> Value {
        json!({"actionKey":ACTION,"idempotencyKey":Uuid::new_v4(),"resourceId":Uuid::new_v4(),
            "resourceVersion":3,"workspaceId":Uuid::new_v4(),"explicitConfirmation":true})
    }

    #[test]
    fn manual_input_freezes_only_the_explicit_owner_request() {
        let value = command();
        let typed: contracts::ActionCommand = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(
            request(&typed).unwrap(),
            json!({"resourceId":value["resourceId"],
            "workspaceId":value["workspaceId"],"resourceVersion":3,
            "idempotencyKey":value["idempotencyKey"],"explicitConfirmation":true})
        );
        for field in [
            "assetId",
            "delegationId",
            "executorInstallationResourceId",
            "sourceEventId",
            "automationVersionContent",
            "tenantId",
            "actorPrincipalId",
            "resultTarget",
        ] {
            for added in [Value::Null, json!(Uuid::new_v4())] {
                let mut invalid = value.clone();
                invalid[field] = added;
                assert!(validate_command(&invalid).is_err(), "{field}");
            }
        }
        for value in [Value::Null, json!(false), json!("true")] {
            let mut invalid = command();
            invalid["explicitConfirmation"] = value;
            assert!(validate_command(&invalid).is_err());
        }
    }

    #[test]
    fn manual_input_rejects_missing_nil_or_out_of_domain_target_and_key() {
        for field in ["resourceId", "workspaceId", "idempotencyKey"] {
            for bad in [Value::Null, json!(Uuid::nil()), json!("not-a-uuid")] {
                let mut value = command();
                value[field] = bad;
                let typed = serde_json::from_value::<contracts::ActionCommand>(value);
                assert!(
                    typed.is_err() || request(&typed.unwrap()).is_err(),
                    "{field}"
                );
            }
        }
        for bad in [Value::Null, json!(0), json!(-1), json!(i64::MAX)] {
            let mut value = command();
            value["resourceVersion"] = bad;
            let typed: contracts::ActionCommand = serde_json::from_value(value).unwrap();
            assert!(request(&typed).is_err());
        }
        let mut value = command();
        value["actionKey"] = json!("agent.invoke");
        assert!(request(&serde_json::from_value(value).unwrap()).is_err());
    }

    fn execution() -> governance::Execution {
        let owner = Uuid::new_v4();
        let target = Uuid::new_v4();
        let workspace = Uuid::new_v4();
        let key = Uuid::new_v4();
        let source = source(owner, target, key);
        let id = Uuid::new_v4();
        governance::Execution {
            id,
            operation_id: id,
            tenant_id: Uuid::new_v4(),
            workspace_id: Some(workspace),
            action_key: ACTION.into(),
            action_version: 1,
            initiator_principal_id: owner,
            actor_principal_id: Uuid::new_v4(),
            target_id: target,
            parameter_hash: "test-reference-only".into(),
            parameters: Some(
                json!({"targetVersion":3,"sourceKind":"MANUAL","sourcePrincipalId":owner,
                "sourceEventId":source,"rootEventId":source,"manualRequest":{"resourceId":target,
                "workspaceId":workspace,"resourceVersion":3,"idempotencyKey":key,"explicitConfirmation":true}}),
            ),
            temporal_workflow_id: None,
            cancel_first_run_id: None,
            approval_workflow_id: None,
            approval_expires_at: None,
            gate_state: "ALLOWED".into(),
            dispatch_state: "UNKNOWN".into(),
            reason_code: None,
            correlation_id: id,
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn manual_source_is_the_same_frozen_owner_target_and_request_not_a_relay_event() {
        let mut ae = execution();
        let p = ae.parameters.clone().unwrap();
        let source = p["sourceEventId"].as_str().unwrap().to_owned();
        assert!(frozen_source(&ae, &source, &source));
        assert!(!frozen_source(&ae, "foreign", &source));
        assert!(!frozen_source(&ae, &source, "foreign"));
        for (field, bad) in [
            ("sourceKind", json!("BUZZ_EVENT")),
            ("sourcePrincipalId", json!(Uuid::new_v4())),
            ("sourcePubkey", Value::Null),
            ("targetVersion", json!(4)),
        ] {
            ae.parameters = Some(p.clone());
            ae.parameters.as_mut().unwrap()[field] = bad;
            assert!(!frozen_source(&ae, &source, &source), "{field}");
        }
        for field in ["resourceId", "workspaceId", "idempotencyKey"] {
            ae.parameters = Some(p.clone());
            ae.parameters.as_mut().unwrap()["manualRequest"][field] = json!(Uuid::new_v4());
            assert!(!frozen_source(&ae, &source, &source), "{field}");
        }
        ae.parameters = Some(p);
        ae.actor_principal_id = ae.initiator_principal_id;
        assert!(!frozen_source(&ae, &source, &source));
    }

    #[test]
    fn manual_workflow_identity_keeps_each_owner_target_key_distinct() {
        let owner = Uuid::new_v4();
        let target = Uuid::new_v4();
        let key = Uuid::new_v4();
        let tenant = Uuid::new_v4();
        let original = source(owner, target, key);
        assert_eq!(original, source(owner, target, key));
        for other in [
            source(Uuid::new_v4(), target, key),
            source(owner, Uuid::new_v4(), key),
            source(owner, target, Uuid::new_v4()),
        ] {
            assert_ne!(original, other);
            assert_ne!(
                workflow(tenant, target, &original),
                workflow(tenant, target, &other)
            );
        }
        assert_ne!(
            workflow(tenant, target, &original),
            workflow(Uuid::new_v4(), target, &original)
        );
        assert!(workflow(tenant, target, &original).starts_with(&format!(
            "platform:automation_run:{tenant}:{target}-manual:"
        )));
    }

    #[tokio::test]
    #[ignore = "requires WORKFLOW_MANUAL_TEST_DATABASE_URL pointing at an isolated schedule_dispatch_verify_manual_* database"]
    async fn original_manual_ae_replay_and_source_guard_keep_one_request() {
        let pool =
            sqlx::PgPool::connect(&std::env::var("WORKFLOW_MANUAL_TEST_DATABASE_URL").unwrap())
                .await
                .unwrap();
        let database: String = sqlx::query_scalar("select current_database()")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(database.starts_with("schedule_dispatch_verify_manual_"));
        let mut tx = pool.begin().await.unwrap();
        let tenant = crate::agent_task::receipt_tests::fixture(&mut tx).await;
        let (owner,agent,workspace,target):(Uuid,Uuid,Uuid,Uuid) = sqlx::query_as("select r.owner_principal_id,i.agent_principal_id,i.workspace_id,i.resource_id
            from catalog.agent_installation i join catalog.resource r on r.id=i.resource_id where r.tenant_id=$1 order by i.resource_id limit 1")
            .bind(tenant).fetch_one(&mut *tx).await.unwrap();
        let key = Uuid::new_v4();
        let id = Uuid::new_v4();
        let source = source(owner, target, key);
        let command: contracts::ActionCommand = serde_json::from_value(json!({"actionKey":ACTION,"resourceId":target,
            "workspaceId":workspace,"resourceVersion":1,"idempotencyKey":key,"explicitConfirmation":true})).unwrap();
        let parameters = json!({"sourceKind":"MANUAL","sourcePrincipalId":owner,"sourceEventId":source,
            "rootEventId":source,"targetVersion":1,"manualRequest":request(&command).unwrap()});
        // This is a stored admission fixture, not a dispatched native run or an
        // authorization substitute. Actual migrated AE constraints stay enabled.
        sqlx::query("insert into admission.action_execution(id,operation_id,tenant_id,workspace_id,action_key,action_version,
            initiator_principal_id,actor_principal_id,target_id,idempotency_key,parameter_hash,gate_state,dispatch_state,correlation_id,parameters)
            values($1,$1,$2,$3,'automation.run',1,$4,$5,$6,$7,'manual-replay-fixture','ALLOWED','UNKNOWN',$1,$8)")
            .bind(id).bind(tenant).bind(workspace).bind(owner).bind(agent).bind(target).bind(key).bind(parameters)
            .execute(&mut *tx).await.unwrap();
        for _ in 0..2 {
            check_replay(&mut *tx, id, &command).await.unwrap();
        }
        let mut changed = command.clone();
        changed.resource_version = Some(2);
        assert!(matches!(
            check_replay(&mut *tx, id, &changed).await,
            Err(Refusal::Conflict(ReasonCode::IdempotencyKeyReused))
        ));
        let ae = governance::lock_execution(&mut tx, id).await.unwrap();
        assert!(frozen_source(&ae, &source, &source));
        sqlx::query("savepoint source_guard")
            .execute(&mut *tx)
            .await
            .unwrap();
        assert!(sqlx::query("update admission.action_execution set parameters=parameters||'{\"sourcePubkey\":null}'::jsonb where id=$1")
            .bind(id).execute(&mut *tx).await.is_err());
        sqlx::query("rollback to savepoint source_guard")
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("release savepoint source_guard")
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("update admission.action_execution set parameters=parameters||'{\"stepApprovalReleased\":true}'::jsonb where id=$1")
            .bind(id).execute(&mut *tx).await.unwrap();
        check_replay(&mut *tx, id, &command).await.unwrap();
        let same: (Uuid, Uuid, String) = sqlx::query_as(
            "select id,operation_id,dispatch_state from admission.action_execution
            where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3",
        )
        .bind(tenant)
        .bind(owner)
        .bind(key)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert_eq!(same, (id, id, "UNKNOWN".into()));
        tx.rollback().await.unwrap();
        pool.close().await;
    }
}
