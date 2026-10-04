//! DD-107: optional version-pinned gate in the existing AgentTask, using one
//! child ActionExecution and the original ApprovalWorkflow/projection.
use super::*;
use crate::governance::{Execution, Policy};
use crate::service_api::ServiceState;

pub(crate) enum Gate {
    Ready,
    Waiting {
        workflow_id: String,
        input: Box<contracts::ApprovalWorkflowInput>,
    },
    Refused(ReasonCode),
}

fn unknown() -> Refusal {
    Refusal::Unavailable("Automation step approval evidence unavailable".into())
}

pub(crate) fn is_child(ae: &Execution) -> bool {
    ae.action_key == ACTION
        && ae
            .parameters
            .as_ref()
            .is_some_and(|p| p.get("automationStepApproval").is_some())
}

/// Resolve only the exact policy pinned by the original Invocation's Version.
/// The parameter object is a reference, never an independent policy authority.
pub(crate) async fn child_policy(
    g: &Governance,
    ae: &Execution,
) -> Result<Option<Policy>, Refusal> {
    if !is_child(ae) {
        return Ok(None);
    }
    let reference: Option<(Uuid,i32)> = sqlx::query_as(
        "select v.approval_policy_id,v.approval_policy_version
         from admission.action_execution c join admission.action_execution p on p.id=c.parent_action_execution_id
         join catalog.agent_invocation i on i.action_execution_id=p.id
         join catalog.automation_version v on v.asset_id=i.automation_version_asset_id
           and v.automation_resource_id=i.automation_resource_id
         join catalog.approval_policy ap on ap.id=v.approval_policy_id and ap.version=v.approval_policy_version
           and ap.tenant_id=c.tenant_id and ap.action_key=c.action_key and ap.target_type='RESOURCE'
         where c.id=$1 and c.action_key='automation.run' and p.action_key=c.action_key
           and c.tenant_id=i.tenant_id and c.workspace_id=i.workspace_id and c.target_id=i.automation_resource_id
           and c.parameters->'automationStepApproval'->>'invocationId'=i.id::text
           and c.parameters->'automationStepApproval'->>'policyId'=ap.id::text
           and c.parameters->'automationStepApproval'->>'policyVersion'=ap.version::text")
        .bind(ae.id).fetch_optional(&g.pool).await?;
    let (id, version) = reference.ok_or_else(unknown)?;
    Ok(Some(governance::exact_policy(&g.pool, id, version).await?))
}

pub(crate) fn owners(ae: &Execution) -> Result<Vec<contracts::AffectedOwnerRef>, Refusal> {
    let raw = ae
        .parameters
        .as_ref()
        .and_then(|p| p.get("automationStepApproval"))
        .and_then(|p| p.get("affectedOwnerRefs"))
        .cloned()
        .ok_or_else(unknown)?;
    serde_json::from_value(raw).map_err(|_| unknown())
}

/// The existing parent remains the sole execution authority. A child approval
/// cannot stay usable after its unstarted Invocation is cancelled or refused.
pub(crate) async fn parent_pending(
    conn: &mut sqlx::PgConnection,
    child: Uuid,
) -> Result<bool, Refusal> {
    Ok(sqlx::query_scalar(
        "select exists(select 1 from admission.action_execution c
        join admission.action_execution p on p.id=c.parent_action_execution_id
        join catalog.agent_invocation i on i.action_execution_id=p.id
        where c.id=$1 and p.gate_state='ALLOWED' and p.dispatch_state='DISPATCHED'
          and i.status='CREATED' and not i.cancel_pending and i.runtime_turn_id is null
          and i.reply_event_id is null and i.post_message_intent is null)",
    )
    .bind(child)
    .fetch_one(conn)
    .await?)
}

pub(crate) async fn target_current(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
) -> Result<bool, Refusal> {
    let Some(row) = management_resource(tx, ae.tenant_id, ae.target_id, true).await? else {
        return Ok(false);
    };
    Ok(row.state == "ACTIVE"
        && row.projection_action_execution_id.is_none()
        && ae.frozen_target_version() == Some(row.version)
        && management_projection(g, &row).await?)
}

pub(crate) async fn close_before_effect(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    parent: Uuid,
    reason: &ReasonCode,
) -> Result<(), Refusal> {
    let children:Vec<Execution>=sqlx::query_as(&format!(
        "update admission.action_execution set gate_state='REVOKED',
        dispatch_state=case when dispatch_state='DISPATCHED' then 'ABORTED' else dispatch_state end,
        reason_code=$2,updated_at=now()
        where parent_action_execution_id=$1 and action_key='automation.run'
          and gate_state in ('WAITING','ALLOWED')
          and exists(select 1 from catalog.agent_invocation i where i.action_execution_id=$1
            and i.status in ('FAILED','CANCELED') and i.runtime_turn_id is null and i.post_message_intent is null
            and i.reply_event_id is null
            and not exists(select 1 from admission.capacity_lease l where l.invocation_id=i.id))
          returning {}",governance::EXECUTION_COLUMNS))
    .bind(parent)
    .bind(governance::wire(reason))
    .fetch_all(&mut **tx)
    .await?;
    for child in children {
        let def =
            governance::exact_definition(&g.pool, &child.action_key, child.action_version).await?;
        governance::audit(
            tx,
            &child,
            &def,
            "step:refused",
            "OUTCOME",
            "DENY",
            &governance::wire(reason),
            None,
            vec![crate::audit::Evidence::new(
                contracts::EvidenceKind::ActionExecutionId,
                parent,
            )],
        )
        .await?;
    }
    Ok(())
}

/// Management may choose an explicitly deployed same-Tenant policy, never
/// borrow another action's policy or synthesize a default approval threshold.
pub(crate) async fn validate_policy(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    id: Option<Uuid>,
    version: Option<i32>,
    active: bool,
) -> Result<(), Refusal> {
    match (id, version) {
        (None, None) => return Ok(()),
        (Some(id), Some(version)) if version > 0 => {
            let row:Option<(Value,String,String,i32)>=sqlx::query_as(
                "select role_requirements,owner_requirement,self_approval,expires_in_seconds
                 from catalog.approval_policy where id=$1 and version=$2 and tenant_id=$3
                   and action_key='automation.run' and target_type='RESOURCE' and (not $4 or status='ACTIVE')")
                .bind(id).bind(version).bind(tenant).bind(active).fetch_optional(&mut *conn).await?;
            let Some((roles, owner, self_approval, expires)) = row else {
                return Err(invalid_management());
            };
            let roles: Vec<contracts::ApprovalRoleRequirement> =
                serde_json::from_value(roles).map_err(|_| invalid_management())?;
            if expires <= 0
                || !matches!(self_approval.as_str(), "ALLOW" | "DENY")
                || !matches!(owner.as_str(), "NONE" | "TARGET_OWNER")
                || (owner == "NONE" && roles.is_empty())
                || roles.iter().any(|r| r.min_distinct <= 0)
            {
                return Err(Refusal::Precondition(
                    ReasonCode::ApprovalSelectorUnresolvable,
                ));
            }
        }
        _ => return Err(invalid_management()),
    }
    Ok(())
}

pub(crate) async fn approver_eligible(
    g: &Governance,
    ae_id: Uuid,
    tenant: Uuid,
    human: Uuid,
) -> Result<bool, Refusal> {
    let ae = governance::load_execution(&g.pool, ae_id)
        .await?
        .ok_or_else(unknown)?;
    if ae.tenant_id != tenant {
        return Ok(false);
    }
    let Some(policy) = child_policy(g, &ae).await? else {
        return Ok(false);
    };
    if policy.self_approval == "DENY" && ae.initiator_principal_id == human {
        return Ok(false);
    }
    let mut tx = g.pool.begin().await?;
    if !parent_pending(&mut tx, ae.id).await? {
        return Ok(false);
    }
    let refs = owners(&ae)?;
    if !crate::agent_definition::validate_frozen_owners(g, &mut tx, tenant, &refs).await? {
        return Ok(false);
    }
    if !target_current(g, &mut tx, &ae).await? {
        return Ok(false);
    }
    if refs
        .iter()
        .any(|owner| owner.owner_principal_id == human.to_string())
    {
        return Ok(true);
    }
    for requirement in policy.role_requirements {
        let (kind, id, permission) = match requirement.selector {
            contracts::ApprovalSelector::ResourceApprover => ("resource", ae.target_id, "approve"),
            contracts::ApprovalSelector::WorkspaceAdmin => {
                ("workspace", ae.workspace_id.ok_or_else(unknown)?, "manage")
            }
            contracts::ApprovalSelector::TenantAdmin => ("tenant", tenant, "manage"),
        };
        let checked = g
            .spicedb
            .check(
                kind,
                &id.to_string(),
                permission,
                &human.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| unknown())?;
        if checked.zed_token.is_empty() {
            return Err(unknown());
        }
        if checked.allowed {
            return Ok(true);
        }
    }
    Ok(false)
}

#[derive(FromRow)]
struct GateFacts {
    action_execution_id: Uuid,
    tenant_id: Uuid,
    approval_policy_id: Option<Uuid>,
    approval_policy_version: Option<i32>,
    action_kind: Option<String>,
}

/// Called by the authenticated current AgentTask Activity, before Capacity,
/// Memory disclosure, native turn or template publication. No business body.
pub(crate) async fn gate(
    state: &ServiceState,
    invocation: Uuid,
    cancel: bool,
) -> Result<Gate, Refusal> {
    let g = &state.governance;
    let mut tx = state.pool.begin().await?;
    let facts:Option<GateFacts>=sqlx::query_as(
        "select i.action_execution_id,i.tenant_id,v.approval_policy_id,v.approval_policy_version,v.action->>'kind' action_kind
         from catalog.agent_invocation i left join catalog.automation_version v
           on v.asset_id=i.automation_version_asset_id and v.automation_resource_id=i.automation_resource_id
         where i.id=$1") .bind(invocation).fetch_optional(&mut *tx).await?;
    let GateFacts {
        action_execution_id: parent_id,
        tenant_id: tenant,
        approval_policy_id: policy_id,
        approval_policy_version: policy_version,
        action_kind: action,
    } = facts.ok_or_else(unknown)?;
    let message_only = match action.as_deref() {
        Some("POST_MESSAGE") => true,
        Some("AGENT_TURN") => false,
        _ => return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)),
    };
    let (pid, pver) = match (policy_id, policy_version) {
        (None, None) => return Ok(Gate::Ready),
        (Some(id), Some(version)) => (id, version),
        _ => return Err(unknown()),
    };
    crate::service_api::audit_gate(state)
        .await
        .map_err(|_| unknown())?;
    crate::roles::lock_tenant(&mut tx, tenant).await?;
    let parent = governance::lock_execution(&mut tx, parent_id).await?;
    validate_policy(&mut tx, parent.tenant_id, Some(pid), Some(pver), false).await?;
    let child_id = Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!("{}:automation-step-approval", parent.id).as_bytes(),
    );
    let workflow_id = governance::approval_workflow_id(parent.tenant_id, child_id);
    let existing: bool =
        sqlx::query_scalar("select exists(select 1 from admission.action_execution where id=$1)")
            .bind(child_id)
            .fetch_one(&mut *tx)
            .await?;
    let mut creation_revision = None;
    if !existing {
        let untouched:bool=sqlx::query_scalar("select exists(select 1 from catalog.agent_invocation i
            where i.id=$1 and i.action_execution_id=$2 and i.status='CREATED' and not i.cancel_pending
              and i.runtime_turn_id is null and i.reply_event_id is null
              and not exists(select 1 from projection.agent_model_trace t where t.invocation_id=i.id))")
            .bind(invocation).bind(parent.id).fetch_one(&mut *tx).await?;
        if !untouched || cancel {
            return Ok(Gate::Refused(ReasonCode::ApprovalWithdrawn));
        }
        creation_revision = Some(
            recheck_invocation(state, &mut tx, invocation, None, None, false, message_only).await?,
        );
        let resource = management_resource(&mut tx, parent.tenant_id, parent.target_id, true)
            .await?
            .ok_or_else(unknown)?;
        let policy = governance::exact_policy(&state.pool, pid, pver).await?;
        let refs = if policy.owner_requirement == "TARGET_OWNER" {
            json!([{"targetType":"RESOURCE","targetId":parent.target_id,"targetVersion":resource.version,
                "ownerPrincipalId":resource.owner_principal_id}])
        } else {
            json!([])
        };
        let mut parameters = parent.parameters.clone().ok_or_else(unknown)?;
        parameters["targetVersion"] = json!(resource.version);
        parameters["automationStepApproval"] = json!({"invocationId":invocation,"policyId":pid,
            "policyVersion":pver,"affectedOwnerRefs":refs});
        sqlx::query("insert into admission.action_execution(id,parent_action_execution_id,operation_id,tenant_id,
            workspace_id,action_key,action_version,initiator_principal_id,actor_principal_id,target_id,
            parameter_hash,parameters,approval_workflow_id,approval_expires_at,gate_state,dispatch_state,reason_code,correlation_id)
            values($1,$2,$3,$4,$5,'automation.run',$6,$7,$8,$9,$10,$11,$12,
              date_trunc('second',clock_timestamp())+make_interval(secs=>$13),'WAITING','NOT_DISPATCHED','WAITING_APPROVAL',$14)")
            .bind(child_id).bind(parent.id).bind(parent.operation_id).bind(parent.tenant_id).bind(parent.workspace_id)
            .bind(parent.action_version).bind(parent.initiator_principal_id).bind(parent.actor_principal_id)
            .bind(parent.target_id).bind(&parent.parameter_hash).bind(parameters).bind(&workflow_id)
            .bind(f64::from(policy.expires_in_seconds)).bind(parent.correlation_id).execute(&mut *tx).await?;
        sqlx::query(
            "insert into projection.workflow_ref(workflow_id,workflow_type,workflow_version,kind,
            tenant_id,workspace_id,operation_id,action_execution_id,projection_state)
            values($1,'ApprovalWorkflow',1,null,$2,$3,$4,$5,'PENDING_START')",
        )
        .bind(&workflow_id)
        .bind(parent.tenant_id)
        .bind(parent.workspace_id)
        .bind(parent.operation_id)
        .bind(child_id)
        .execute(&mut *tx)
        .await?;
    }
    let child = governance::lock_execution(&mut tx, child_id).await?;
    let def =
        governance::exact_definition(&state.pool, &child.action_key, child.action_version).await?;
    if let Some(revision) = creation_revision {
        governance::record_decision(
            &mut tx,
            &child.subject(),
            "ADMISSION",
            "ALLOW",
            "ALLOW",
            "REQUIRED",
            "ALLOW",
            Some(&revision),
            Some(&ReasonCode::WaitingApproval),
        )
        .await?;
        governance::audit(
            &mut tx,
            &child,
            &def,
            "admission:decision",
            "DECISION",
            "ALLOW",
            "WAITING_APPROVAL",
            None,
            vec![
                crate::audit::Evidence::new(
                    contracts::EvidenceKind::ApprovalWorkflowId,
                    &workflow_id,
                ),
                crate::audit::Evidence::versioned(
                    contracts::EvidenceKind::ApprovalPolicy,
                    pid,
                    i64::from(pver),
                ),
            ],
        )
        .await?;
    }
    let projection: Option<(String, bool)> = sqlx::query_as(
        "select status,coalesce(consume_deadline>clock_timestamp()+make_interval(secs=>$2),false)
         from projection.approval_projection where workflow_id=$1 and action_execution_id=$3",
    )
    .bind(&workflow_id)
    .bind(g.cfg.dispatch_margin_seconds as f64)
    .bind(child.id)
    .fetch_optional(&mut *tx)
    .await?;
    if cancel {
        // The caller atomically proves the Invocation still has no effects
        // before closing either AE. A stale Activity must not revoke a child
        // that a concurrent current Activity has already consumed/dispatched.
        return Ok(Gate::Refused(ReasonCode::ApprovalWithdrawn));
    }
    if matches!(child.gate_state.as_str(), "DENIED" | "EXPIRED" | "REVOKED") {
        return Ok(Gate::Refused(
            child
                .reason_code
                .as_deref()
                .and_then(governance::parse)
                .unwrap_or(ReasonCode::ApprovalInvalidated),
        ));
    }
    match projection.as_ref().map(|(s, valid)| (s.as_str(), *valid)) {
        Some(("CONSUMED", _))
            if child.gate_state == "ALLOWED" && child.dispatch_state == "DISPATCHED" =>
        {
            return Ok(Gate::Ready)
        }
        Some(("DENIED", _)) => return Ok(Gate::Refused(ReasonCode::ApprovalDenied)),
        Some(("EXPIRED", _)) => return Ok(Gate::Refused(ReasonCode::ApprovalExpired)),
        Some(("INVALIDATED" | "CANCELLED", _)) => {
            return Ok(Gate::Refused(ReasonCode::ApprovalInvalidated))
        }
        Some(("APPROVED", true)) if child.gate_state == "WAITING" => {
            let revision =
                recheck_invocation(state, &mut tx, invocation, None, None, false, message_only)
                    .await?;
            if !crate::agent_definition::validate_frozen_owners(
                g,
                &mut tx,
                parent.tenant_id,
                &owners(&child)?,
            )
            .await?
            {
                return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
            }
            sqlx::query("update admission.action_execution set gate_state='ALLOWED',dispatch_state='DISPATCHED',reason_code=null,updated_at=now()
                where id=$1 and gate_state='WAITING'").bind(child.id).execute(&mut *tx).await?;
            governance::record_decision(
                &mut tx,
                &child.subject(),
                "RECHECK",
                "ALLOW",
                "ALLOW",
                "SATISFIED",
                "ALLOW",
                Some(&revision),
                None,
            )
            .await?;
            governance::audit(
                &mut tx,
                &child,
                &def,
                "step:dispatch",
                "DISPATCH",
                "ALLOW",
                "DISPATCHED",
                None,
                vec![crate::audit::Evidence::new(
                    contracts::EvidenceKind::ApprovalWorkflowId,
                    &workflow_id,
                )],
            )
            .await?;
        }
        _ => (),
    }
    tx.commit().await?;
    // Reuse the original idempotent consume update and history projection. A
    // missing ACK is not permission to proceed; the next Activity reads it.
    g.consume(child.id).await;
    let input = g.approval_input(&child).await?;
    Ok(Gate::Waiting {
        workflow_id,
        input: Box::new(input),
    })
}

#[cfg(test)]
mod step_approval_tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires the explicit isolated step_approval PostgreSQL fixture"]
    async fn step_approval_catalog_reads_exact_tenant_action_version_and_policy() {
        let url = std::env::var("AGENT_STEP_APPROVAL_TEST_DATABASE_URL")
            .expect("explicit isolated database");
        let pool = sqlx::PgPool::connect(&url).await.unwrap();
        let database: String = sqlx::query_scalar("select current_database()")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(
            database.starts_with("step_approval_"),
            "never use a business database"
        );
        let mut tx = pool.begin().await.unwrap();
        let tenant = Uuid::new_v4();
        let other = Uuid::new_v4();
        for id in [tenant, other] {
            sqlx::query("insert into identity.tenant(id,slug,name,state) values($1,$2,'isolated policy fixture','ACTIVE')")
                .bind(id).bind(format!("step-policy-{id}")).execute(&mut *tx).await.unwrap();
        }
        let policy = Uuid::new_v4();
        sqlx::query(
            "insert into catalog.approval_policy(id,version,tenant_id,action_key,target_type,
            role_requirements,owner_requirement,self_approval,expires_in_seconds,status)
            values($1,1,$2,'automation.run','RESOURCE','[]','TARGET_OWNER','DENY',600,'ACTIVE')",
        )
        .bind(policy)
        .bind(tenant)
        .execute(&mut *tx)
        .await
        .unwrap();
        assert!(validate_policy(&mut tx, tenant, None, None, true)
            .await
            .is_ok());
        assert!(
            validate_policy(&mut tx, tenant, Some(policy), Some(1), true)
                .await
                .is_ok()
        );
        assert!(validate_policy(&mut tx, other, Some(policy), Some(1), true)
            .await
            .is_err());
        assert!(
            validate_policy(&mut tx, tenant, Some(policy), Some(2), true)
                .await
                .is_err()
        );
        assert!(validate_policy(&mut tx, tenant, Some(policy), None, true)
            .await
            .is_err());
        sqlx::query("update catalog.approval_policy set status='RETIRED' where id=$1")
            .bind(policy)
            .execute(&mut *tx)
            .await
            .unwrap();
        assert!(
            validate_policy(&mut tx, tenant, Some(policy), Some(1), true)
                .await
                .is_err()
        );
        // A retired catalog row is not substituted into a new version, while
        // already-pinned input remains readable at its exact original version.
        assert!(
            validate_policy(&mut tx, tenant, Some(policy), Some(1), false)
                .await
                .is_ok()
        );
        for (action, roles, owner) in [
            ("agent.invoke", json!([]), "TARGET_OWNER"),
            (
                "automation.run",
                json!([{"selector":"UNKNOWN","minDistinct":1}]),
                "NONE",
            ),
            (
                "automation.run",
                json!([{"selector":"TENANT_ADMIN","minDistinct":0}]),
                "NONE",
            ),
            ("automation.run", json!([]), "ALL_AFFECTED_OWNERS"),
        ] {
            let invalid = Uuid::new_v4();
            sqlx::query(
                "insert into catalog.approval_policy(id,version,tenant_id,action_key,target_type,
                role_requirements,owner_requirement,self_approval,expires_in_seconds,status)
                values($1,1,$2,$3,'RESOURCE',$4,$5,'DENY',600,'ACTIVE')",
            )
            .bind(invalid)
            .bind(tenant)
            .bind(action)
            .bind(roles)
            .bind(owner)
            .execute(&mut *tx)
            .await
            .unwrap();
            assert!(
                validate_policy(&mut tx, tenant, Some(invalid), Some(1), true)
                    .await
                    .is_err()
            );
        }
        tx.rollback().await.unwrap();
    }
}
