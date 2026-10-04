//! Approval is an original Catalog action and ComponentTask, not a second
//! release registry. The actual deployment facts only gate this transition.

use super::*;
use crate::governance::Governance;

pub(crate) const APPROVE: &str = "component_release.approve";

pub(crate) fn validate_params(params: &Params) -> Result<(), Refusal> {
    exact_fields(&params.to_json(), &["componentReleaseId"], &[])?;
    params.component_release_id.ok_or_else(bad)?;
    Ok(())
}

pub(crate) async fn valid_policy(
    conn: &mut PgConnection,
    def: &Definition,
) -> Result<bool, sqlx::Error> {
    if def.action_key != APPROVE
        || def.target_type != "COMPONENT_RELEASE"
        || def.tenant_rule != "SESSION_TENANT"
        || def.workspace_rule != "TENANT_ONLY"
        || def.permission != "manage"
        || def.permission_object_type != "tenant"
        || def.execution_mode != "TEMPORAL"
        || def.workflow_kind.as_deref() != Some(KIND)
        || def.quota_policy != "NONE"
        || !def.meters.is_empty()
        || def.result_exposure != "NONE"
        || def.confirmation_mode != "APPROVAL"
        || def.approval_policy_id.is_none()
        || def.approval_policy_version.is_none()
    {
        return Ok(false);
    }
    sqlx::query_scalar("select capacity_policy='NONE' and capacity_pool_key is null
        and workflow_type='ComponentTaskWorkflow' and audit_policy='FULL_LIFECYCLE'
        and obs_correlation_mode='OPERATION_REF' and obs_progress_source='TEMPORAL'
        and obs_terminal_source='TEMPORAL' and obs_usage_source='NONE' and obs_cost_source='NONE'
        and obs_redaction_policy='PLATFORM_METADATA_ONLY' and exists (
          select 1 from catalog.approval_policy p where p.id=approval_policy_id and p.version=approval_policy_version
           and p.status='ACTIVE' and p.action_key='component_release.approve' and p.target_type='COMPONENT_RELEASE'
           and p.role_requirements='[{\"selector\":\"TENANT_ADMIN\",\"minDistinct\":1}]'::jsonb
           and p.owner_requirement='NONE' and p.self_approval='DENY')
        from catalog.action_definition where action_key=$1 and version=$2")
        .bind(&def.action_key).bind(def.version).fetch_one(conn).await
}

pub(crate) async fn target(
    conn: &mut PgConnection,
    tenant: Uuid,
    def: &Definition,
    params: &Params,
    frozen: Option<Uuid>,
) -> Result<Target, Refusal> {
    validate_params(params)?;
    let id = params.component_release_id.ok_or_else(bad)?;
    if frozen.is_some_and(|value| value != id) {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    if !valid_policy(conn, def).await?
        || !crate::platform_bootstrap::is_catalog_tenant(conn, tenant).await?
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let exists: bool = sqlx::query_scalar("select exists(select 1 from catalog.component_release r
        join admission.action_execution ae on ae.id=r.registered_by_action_execution_id
        where r.id=$1 and r.catalog_tenant_id=$2 and r.status='REGISTERED'
          and ae.component_conformance_observation is not null and ae.tenant_id=r.catalog_tenant_id)")
        .bind(id).bind(tenant).fetch_one(&mut *conn).await?;
    if !exists {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let release = stored_release(conn, tenant, id).await?;
    active_contracts(conn, tenant, &release).await?;
    Ok(Target {
        id,
        version: 1,
        workspace_id: None,
    })
}

async fn stored_release(
    conn: &mut PgConnection,
    tenant: Uuid,
    id: Uuid,
) -> Result<Registration, Refusal> {
    let row: Option<(Value, Value, Value)> = sqlx::query_as(
        "select manifest,component_package,binding_config_schema
        from catalog.component_release where id=$1 and catalog_tenant_id=$2",
    )
    .bind(id)
    .bind(tenant)
    .fetch_optional(conn)
    .await?;
    let (manifest, package, config) =
        row.ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    registration(
        &json!({"manifestJson":manifest.to_string(),"packageJson":package.to_string(),"bindingConfigSchemaJson":config.to_string()}),
    )
}

pub(crate) async fn approver_separated(
    conn: &mut PgConnection,
    ae: &Execution,
    approver: Uuid,
) -> Result<bool, Refusal> {
    if ae.action_key != APPROVE
        || ae.workspace_id.is_some()
        || approver == ae.initiator_principal_id
    {
        return Ok(false);
    }
    let registrar: Option<Uuid> = sqlx::query_scalar("select a.initiator_principal_id
        from catalog.component_release r join admission.action_execution a on a.id=r.registered_by_action_execution_id
        where r.id=$1 and r.catalog_tenant_id=$2 and r.status='REGISTERED'
          and a.tenant_id=r.catalog_tenant_id and a.workspace_id is null and a.target_id=r.id
          and a.action_key='component_release.register' and a.gate_state='ALLOWED' and a.dispatch_state='DISPATCHED'")
        .bind(ae.target_id).bind(ae.tenant_id).fetch_optional(conn).await?;
    Ok(registrar.is_some_and(|registrar| registrar != approver))
}

async fn approved(
    g: &Governance,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ae: &Execution,
    before_dispatch: bool,
) -> Result<(), Refusal> {
    let workflow = ae.approval_workflow_id.as_ref().ok_or_else(bad)?;
    let row: Option<(bool, Value)> = sqlx::query_as("select
        ((status='APPROVED' and consume_deadline>clock_timestamp()+make_interval(secs=>$2::bigint))
          or (not $5 and status='CONSUMED')),decisions
        from projection.approval_projection where workflow_id=$1 and action_execution_id=$3 and tenant_id=$4")
        .bind(workflow).bind(g.cfg.dispatch_margin_seconds).bind(ae.id).bind(ae.tenant_id).bind(before_dispatch)
        .fetch_optional(&mut **tx).await?;
    let Some((true, decisions)) = row else {
        return Err(Refusal::Denied(ReasonCode::ApprovalConsumeWindowClosed));
    };
    let decisions: Vec<contracts::DecisionElement> =
        serde_json::from_value(decisions).map_err(|_| bad())?;
    for decision in decisions {
        if decision.decision != contracts::ApprovalDecision::Approve
            || !decision
                .satisfied_selectors
                .contains(&contracts::ApprovalSelector::TenantAdmin)
        {
            continue;
        }
        let approver = Uuid::parse_str(&decision.approver_principal_id).map_err(|_| bad())?;
        if !approver_separated(tx, ae, approver).await? {
            continue;
        }
        if !crate::agent_definition::active_owner(tx, ae.tenant_id, approver).await? {
            continue;
        }
        let human: bool = sqlx::query_scalar("select exists(select 1 from identity.principal where id=$1 and tenant_id=$2 and kind='HUMAN' and status='ACTIVE')")
            .bind(approver).bind(ae.tenant_id).fetch_one(&mut **tx).await?;
        if !human {
            continue;
        }
        if g.spicedb
            .check(
                "tenant",
                &ae.tenant_id.to_string(),
                "manage",
                &approver.to_string(),
                crate::spicedb::Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| Refusal::Unavailable("Catalog approver authorization unavailable".into()))?
            .allowed
        {
            return Ok(());
        }
    }
    Err(Refusal::Denied(ReasonCode::ApproverNotEligible))
}

pub(crate) async fn prewrite(
    g: &Governance,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ae: &Execution,
    params: &Params,
) -> Result<i32, Refusal> {
    validate_params(params)?;
    if params.component_release_id != Some(ae.target_id) {
        return Err(bad());
    }
    approved(g, tx, ae, true).await?;
    Ok(1)
}

pub(crate) async fn start(
    pool: &sqlx::PgPool,
    temporal: &crate::temporal::TemporalClient,
    action: Uuid,
    tenant: Uuid,
    workflow_id: &str,
) -> Result<crate::membership_lifecycle::LifecycleResponse, axum::response::Response> {
    use axum::response::IntoResponse;
    let release: Option<Uuid> = sqlx::query_scalar("select target_id from admission.action_execution
        where id=$1 and tenant_id=$2 and action_key=$3 and temporal_workflow_id=$4 and gate_state='ALLOWED'
          and dispatch_state in ('NOT_DISPATCHED','UNKNOWN','DISPATCHED')")
        .bind(action).bind(tenant).bind(APPROVE).bind(workflow_id).fetch_optional(pool).await
        .map_err(|_| axum::http::StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    let release = release.ok_or_else(|| axum::http::StatusCode::CONFLICT.into_response())?;
    let run_id = crate::component_task::start(
        pool,
        temporal,
        workflow_id,
        tenant,
        action,
        &crate::component_task::ComponentTaskInput {
            kind: KIND.into(),
            target: json!({"releaseApproval":{
            "actionExecutionId":action,"componentReleaseId":release,"workflowId":workflow_id}}),
        },
    )
    .await?;
    Ok(crate::membership_lifecycle::LifecycleResponse {
        workflow_id: workflow_id.into(),
        kind: KIND.into(),
        run_id,
    })
}

pub(crate) async fn record(
    axum::extract::State(state): axum::extract::State<crate::service_api::ServiceState>,
    headers: axum::http::HeaderMap,
    body: Result<
        axum::Json<contracts::ComponentReleaseApprovalReport>,
        axum::extract::rejection::JsonRejection,
    >,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    if let Err(response) = crate::service_api::authorize(&state, &headers).await {
        return response;
    }
    let Ok(axum::Json(body)) = body else {
        return axum::http::StatusCode::BAD_REQUEST.into_response();
    };
    let result = async {
        let body = serde_json::to_value(body).map_err(|_| bad())?;
        let action = Uuid::parse_str(text(&body["target"], "actionExecutionId")?).map_err(|_| bad())?;
        let release_id = Uuid::parse_str(text(&body["target"], "componentReleaseId")?).map_err(|_| bad())?;
        let mut tx = state.pool.begin().await?;
        let ae = crate::governance::lock_execution(&mut tx, action).await?;
        if ae.action_key != APPROVE || ae.target_id != release_id || ae.workspace_id.is_some()
            || ae.actor_principal_id != ae.initiator_principal_id || ae.gate_state != "ALLOWED"
            || ae.dispatch_state != "DISPATCHED" || body["target"]["workflowId"] != json!(ae.temporal_workflow_id)
            || !crate::platform_bootstrap::is_catalog_tenant(&mut tx, ae.tenant_id).await? {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
        let def = crate::governance::exact_definition(&state.pool, &ae.action_key, ae.action_version).await?;
        if !valid_policy(&mut tx, &def).await? { return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)); }
        let release: Option<(String, Option<Uuid>, Value, Value, Value)> = sqlx::query_as("select r.status,r.approved_by_action_execution_id,r.manifest,
            registered.component_conformance_plan,registered.component_conformance_observation from catalog.component_release r
            join admission.action_execution registered on registered.id=r.registered_by_action_execution_id
            where r.id=$1 and r.catalog_tenant_id=$2 and registered.tenant_id=r.catalog_tenant_id for update of r")
            .bind(release_id).bind(ae.tenant_id).fetch_optional(&mut *tx).await?;
        let (status, approving_action, manifest, plan, report) = release.ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
        verify_report(&plan, &report)?;
        current_suite_run(&state, &mut tx, &ae, text(&body, "runId")?).await?;
        if status == "APPROVED" && approving_action == Some(ae.id) {
            let stored: Option<Value> = sqlx::query_scalar("select component_compatibility_observation from admission.action_execution where id=$1")
                .bind(ae.id).fetch_one(&mut *tx).await?;
            if stored.is_none() { return Err(bad()); }
        } else {
            if status != "REGISTERED" || approving_action.is_some() { return Err(Refusal::Conflict(ReasonCode::TargetStateConflict)); }
            // Deployment observation is read-only but bounded network I/O. Do
            // it before fresh authority checks, not after their decision.
            let builds = crate::platform_build_info::observe(&body["workerBuild"]).await?;
            crate::platform_build_info::compatible(&manifest, &builds)?;
            if !crate::agent_definition::active_owner(&mut tx, ae.tenant_id, ae.initiator_principal_id).await? {
                return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
            }
            let human: bool = sqlx::query_scalar("select exists(select 1 from identity.principal p join identity.tenant t on t.id=p.tenant_id
                where p.id=$1 and p.tenant_id=$2 and p.kind='HUMAN' and p.status='ACTIVE' and t.state='ACTIVE')")
                .bind(ae.initiator_principal_id).bind(ae.tenant_id).fetch_one(&mut *tx).await?;
            if !human || !state.governance.spicedb.check("tenant", &ae.tenant_id.to_string(), "manage", &ae.initiator_principal_id.to_string(),
                crate::spicedb::Consistency::FullyConsistent).await.map_err(|_| Refusal::Unavailable("Catalog authorization unavailable".into()))?.allowed {
                return Err(Refusal::Denied(ReasonCode::PermissionDenied));
            }
            approved(&state.governance, &mut tx, &ae, false).await?;
            let release = stored_release(&mut tx, ae.tenant_id, release_id).await?;
            let contracts = active_contracts(&mut tx, ae.tenant_id, &release).await?;
            let digests: Vec<_> = contracts.iter().map(collab_bridge::limits::canonical_digest).collect();
            if json!(digests) != plan["contractDigests"] {
                return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
            }
            let observation = json!({"actionExecutionId":ae.id,"componentReleaseId":release_id,"workflowId":ae.temporal_workflow_id,
                "runId":body["runId"],"builds":builds,"registrationPlanDigest":plan["planDigest"],"approvalWorkflowId":ae.approval_workflow_id});
            persist_approval(&mut tx, &ae, &def, release_id, &observation).await?;
        }
        let receipt: contracts::ComponentReleaseReceipt = serde_json::from_value(json!({"actionExecutionId":ae.id,
            "componentReleaseId":release_id,"planDigest":plan["planDigest"],"status":"APPROVED"})).map_err(|_| bad())?;
        tx.commit().await?;
        Ok::<_, Refusal>(receipt)
    }.await;
    match result {
        Ok(receipt) => axum::Json(receipt).into_response(),
        Err(error) => error.respond(None),
    }
}

async fn persist_approval(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ae: &Execution,
    def: &Definition,
    release_id: Uuid,
    observation: &Value,
) -> Result<(), Refusal> {
    if ae.action_key != APPROVE
        || ae.target_id != release_id
        || observation["actionExecutionId"] != json!(ae.id)
        || observation["componentReleaseId"] != json!(release_id)
        || observation["workflowId"] != json!(ae.temporal_workflow_id)
        || observation["approvalWorkflowId"] != json!(ae.approval_workflow_id)
    {
        return Err(bad());
    }
    let changed = sqlx::query(
        "update admission.action_execution set component_compatibility_observation=$2
        where id=$1 and component_compatibility_observation is null",
    )
    .bind(ae.id)
    .bind(observation)
    .execute(&mut **tx)
    .await?
    .rows_affected();
    if changed != 1 {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let changed = sqlx::query("update catalog.component_release set status='APPROVED',approved_by_action_execution_id=$2
        where id=$1 and catalog_tenant_id=$3 and status='REGISTERED' and approved_by_action_execution_id is null")
        .bind(release_id).bind(ae.id).bind(ae.tenant_id).execute(&mut **tx).await?.rows_affected();
    if changed != 1 {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    crate::audit::append(
        tx,
        crate::audit::AuditEntry {
            event_key: format!("{}:component-release:approved", ae.id),
            tenant_id: Some(ae.tenant_id),
            workspace_id: None,
            operation_id: ae.operation_id,
            event_type: "RECONCILIATION",
            human_identity_id: None,
            initiator_principal_id: Some(ae.initiator_principal_id),
            actor_principal_id: Some(ae.actor_principal_id),
            action_key: &ae.action_key,
            action_version: ae.action_version,
            component_type_key: &def.component_type_key,
            target_type: Some("COMPONENT_RELEASE"),
            target_id: Some(release_id),
            parameter_hash: &ae.parameter_hash,
            decision: "NONE",
            result_code: "APPROVED",
            result_exposure: &def.result_exposure,
            evidence_refs: vec![
                crate::audit::Evidence::new(contracts::EvidenceKind::ActionExecutionId, ae.id),
                crate::audit::Evidence::new(
                    contracts::EvidenceKind::TemporalWorkflowId,
                    ae.temporal_workflow_id.as_deref().ok_or_else(bad)?,
                ),
                crate::audit::Evidence::new(
                    contracts::EvidenceKind::TemporalRunId,
                    text(observation, "runId")?,
                ),
            ],
            correlation_id: ae.correlation_id,
        },
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Acquire;

    // Actual registration wire evidence is consumed first. Authentication and
    // Temporal/SpiceDB live observations remain handler gates, not fixture claims.
    #[tokio::test]
    #[ignore = "requires isolated approval database and actual registration wire evidence"]
    async fn original_registration_approval_evidence_and_audit_are_atomic() {
        let pool = sqlx::PgPool::connect(
            &std::env::var("COMPONENT_CONFORMANCE_TEST_DATABASE_URL").unwrap(),
        )
        .await
        .unwrap();
        let source: Value = serde_json::from_slice(
            &std::fs::read(std::env::var("COMPONENT_CONFORMANCE_WIRE_EVIDENCE").unwrap()).unwrap(),
        )
        .unwrap();
        let plan = &source["plan"];
        let report = &source["report"];
        verify_report(plan, report).unwrap();
        let tenant = Uuid::new_v4();
        let registrar = Uuid::new_v4();
        let requester = Uuid::new_v4();
        let reviewer = Uuid::new_v4();
        let registered = Uuid::parse_str(plan["actionExecutionId"].as_str().unwrap()).unwrap();
        let registered_operation = Uuid::parse_str(plan["operationId"].as_str().unwrap()).unwrap();
        let release_id = Uuid::parse_str(plan["componentReleaseId"].as_str().unwrap()).unwrap();
        let action = Uuid::new_v4();
        let operation = Uuid::new_v4();
        let workflow = Uuid::new_v4().to_string();
        let approval = Uuid::new_v4().to_string();
        let run = Uuid::new_v4().to_string();
        let mut tx = pool.begin().await.unwrap();
        sqlx::query("insert into identity.tenant(id,slug,name,state) values($1,$2,$2,'ACTIVE')")
            .bind(tenant)
            .bind(tenant.to_string())
            .execute(&mut *tx)
            .await
            .unwrap();
        for principal in [registrar, requester, reviewer] {
            sqlx::query("insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'HUMAN','ACTIVE')")
                .bind(principal).bind(tenant).execute(&mut *tx).await.unwrap();
        }
        sqlx::query("insert into identity.relay_operator_identity(catalog_tenant_id,pubkey,private_key_secret_ref,audience,relay_operator_api_origin,state)
            values($1,$2,$2,$2,$2,'PENDING_SECRET')")
            .bind(tenant).bind(Uuid::new_v4().to_string()).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into admission.action_execution(id,operation_id,tenant_id,action_key,action_version,initiator_principal_id,actor_principal_id,
            target_id,parameter_hash,temporal_workflow_id,gate_state,dispatch_state,correlation_id,component_conformance_plan)
            values($1,$2,$3,$4,1,$5,$5,$6,$7,$8,'ALLOWED','DISPATCHED',$9,$10)")
            .bind(registered).bind(registered_operation).bind(tenant).bind(REGISTER).bind(registrar).bind(release_id)
            .bind(collab_bridge::limits::canonical_digest(plan)).bind(plan["workflowId"].as_str().unwrap()).bind(Uuid::new_v4()).bind(plan)
            .execute(&mut *tx).await.unwrap();
        sqlx::query("insert into admission.action_execution(id,operation_id,tenant_id,action_key,action_version,initiator_principal_id,actor_principal_id,
            target_id,parameter_hash,temporal_workflow_id,approval_workflow_id,gate_state,dispatch_state,correlation_id)
            values($1,$2,$3,$4,1,$5,$5,$6,$7,$8,$9,'ALLOWED','DISPATCHED',$10)")
            .bind(action).bind(operation).bind(tenant).bind(APPROVE).bind(requester).bind(release_id)
            .bind(collab_bridge::limits::canonical_digest(&json!(release_id))).bind(&workflow).bind(&approval).bind(Uuid::new_v4())
            .execute(&mut *tx).await.unwrap();
        for (wf, wf_run, wf_type, kind, wf_operation, wf_action) in [
            (
                plan["workflowId"].as_str().unwrap(),
                report["runId"].as_str().unwrap(),
                "ComponentTaskWorkflow",
                Some("COMPONENT_RELEASE"),
                registered_operation,
                registered,
            ),
            (
                workflow.as_str(),
                run.as_str(),
                "ComponentTaskWorkflow",
                Some("COMPONENT_RELEASE"),
                operation,
                action,
            ),
            (
                approval.as_str(),
                run.as_str(),
                "ApprovalWorkflow",
                None,
                operation,
                action,
            ),
        ] {
            sqlx::query("insert into projection.workflow_ref(workflow_id,run_id,workflow_type,workflow_version,kind,tenant_id,operation_id,action_execution_id,projection_state)
                values($1,$2,$3,1,$4,$5,$6,$7,'RUNNING')")
                .bind(wf).bind(wf_run).bind(wf_type).bind(kind).bind(tenant).bind(wf_operation).bind(wf_action).execute(&mut *tx).await.unwrap();
            if wf_type == "ComponentTaskWorkflow" {
                sqlx::query("insert into projection.task_projection(workflow_id,run_id,last_event_id,status) values($1,$2,1,'RUNNING')")
                    .bind(wf).bind(wf_run).execute(&mut *tx).await.unwrap();
            }
        }
        let registered_ae = crate::governance::lock_execution(&mut tx, registered)
            .await
            .unwrap();
        let release = Registration {
            id: release_id,
            component_type_key: format!("fixture_{}", Uuid::new_v4().simple()),
            version: Uuid::new_v4().to_string(),
            manifest: json!({}),
            package: json!({}),
            binding_config_schema: json!({}),
            manifest_digest: collab_bridge::limits::canonical_digest(&json!({})),
            package_digest: collab_bridge::limits::canonical_digest(&json!({})),
            adapter_digest: plan["artifactDigest"].as_str().unwrap().into(),
            contracts: vec![],
        };
        persist_registration(&mut tx, &registered_ae, &release, plan, report)
            .await
            .unwrap();
        let ae = crate::governance::lock_execution(&mut tx, action)
            .await
            .unwrap();
        assert!(!approver_separated(&mut tx, &ae, registrar).await.unwrap());
        assert!(!approver_separated(&mut tx, &ae, requester).await.unwrap());
        assert!(approver_separated(&mut tx, &ae, reviewer).await.unwrap());
        let def = crate::governance::exact_definition(&pool, APPROVE, 1)
            .await
            .unwrap();
        assert!(valid_policy(&mut tx, &def).await.unwrap());
        let observation = json!({"actionExecutionId":action,"componentReleaseId":release_id,"workflowId":workflow,
            "runId":run,"approvalWorkflowId":approval,"registrationPlanDigest":plan["planDigest"],
            "builds":[{"subject":"BUZZ_WEB"},{"subject":"CORE"},{"subject":"WORKER"}]});
        // The same storage consumer must reject a release before any original
        // ApprovalWorkflow projection exists; both attempted writes roll back.
        let mut save = tx.begin().await.unwrap();
        assert!(
            persist_approval(&mut save, &ae, &def, release_id, &observation)
                .await
                .is_err()
        );
        save.rollback().await.unwrap();
        let status: String =
            sqlx::query_scalar("select status from catalog.component_release where id=$1")
                .bind(release_id)
                .fetch_one(&mut *tx)
                .await
                .unwrap();
        assert_eq!(status, "REGISTERED");
        let stored: Option<Value> = sqlx::query_scalar("select component_compatibility_observation from admission.action_execution where id=$1")
            .bind(action).fetch_one(&mut *tx).await.unwrap();
        assert!(stored.is_none());
        sqlx::query("insert into projection.approval_projection(workflow_id,action_execution_id,tenant_id,run_id,last_event_id,status,decisions,expires_at,consume_deadline)
            values($1,$2,$3,$4,1,'CONSUMED',$5,clock_timestamp(),clock_timestamp())")
            .bind(&approval).bind(action).bind(tenant).bind(&run)
            .bind(json!([{"approverPrincipalId":reviewer,"decision":"APPROVE","satisfiedSelectors":["TENANT_ADMIN"],"decidedAt":chrono::Utc::now().to_rfc3339()}]))
            .execute(&mut *tx).await.unwrap();
        persist_approval(&mut tx, &ae, &def, release_id, &observation)
            .await
            .unwrap();
        let visible =
            serde_json::to_value(read_releases(&mut tx, tenant, 1, 0).await.unwrap()).unwrap();
        assert_eq!(visible["releases"][0]["status"], "APPROVED");
        assert_eq!(
            visible["releases"][0]["approvedByActionExecutionId"],
            action.to_string()
        );
        let audits: i64 = sqlx::query_scalar("select count(*) from audit.audit_event where operation_id=$1 and result_code='APPROVED'")
            .bind(operation).fetch_one(&mut *tx).await.unwrap();
        assert_eq!(audits, 1);
        let mut save = tx.begin().await.unwrap();
        assert!(sqlx::query("update admission.action_execution set component_compatibility_observation='{}' where id=$1")
            .bind(action).execute(&mut *save).await.is_err());
        save.rollback().await.unwrap();
        let mut save = tx.begin().await.unwrap();
        assert!(sqlx::raw_sql(include_str!(
            "../../../migrations/20261004018000_component_release_approval.down.sql"
        ))
        .execute(&mut *save)
        .await
        .is_err());
        save.rollback().await.unwrap();
        tx.rollback().await.unwrap();
    }
}
