//! 03 §5、10 §2、17 §8：HUMAN 显式管理唯一 Installation AGENT 的自身 execute。
//! SpiceDB 是权限权威；只保存原 AE 的单次投影意图，不另存角色/权限分配表。

use contracts::{EvidenceKind, ReasonCode};
use serde_json::{json, Value};
use sqlx::{PgConnection, Postgres, Row, Transaction};
use uuid::Uuid;

use super::{
    audit, exact_definition, lock_execution, zed_evidence, Actor, Definition, Execution,
    Governance, Params, Refusal, Semantic, Target,
};
use crate::spicedb::{Consistency, Relationship, RelationshipFilter, Write};

pub(crate) const GRANT: &str = "agent.installation.execute.grant";
pub(crate) const REVOKE: &str = "agent.installation.execute.revoke";

#[derive(sqlx::FromRow)]
pub(crate) struct Installation {
    pub(crate) id: Uuid,
    pub(crate) tenant_id: Uuid,
    pub(crate) workspace_id: Uuid,
    pub(crate) owner_principal_id: Uuid,
    pub(crate) agent_principal_id: Uuid,
    pub(crate) version: i32,
    projection_action_execution_id: Option<Uuid>,
}

async fn installation(
    conn: &mut PgConnection,
    tenant: Uuid,
    id: Uuid,
    lock: bool,
) -> Result<Option<Installation>, sqlx::Error> {
    sqlx::query_as(&format!("select r.id,r.tenant_id,i.workspace_id,r.owner_principal_id,
        i.agent_principal_id,r.version,r.projection_action_execution_id
        from catalog.resource r join catalog.agent_installation i on i.resource_id=r.id
        join identity.tenant t on t.id=r.tenant_id and t.state='ACTIVE'
        join identity.workspace w on w.id=i.workspace_id and w.tenant_id=t.id and w.state='ACTIVE'
        join identity.principal a on a.id=i.agent_principal_id and a.tenant_id=t.id
          and a.kind='AGENT' and a.status='ACTIVE'
        join identity.principal p on p.id=r.owner_principal_id and p.tenant_id=t.id
          and p.kind='HUMAN' and p.status='ACTIVE'
        join identity.tenant_membership tm on tm.tenant_principal_id=p.id and tm.tenant_id=t.id and tm.state='ACTIVE'
        where r.id=$1 and r.tenant_id=$2 and r.type_key='agent.installation'
          and r.application_binding_id is null and r.home_workspace_id=w.id and r.state='ACTIVE'
          and i.state='ACTIVE' and i.active_projection_generation is not null
          and (r.projection_action_execution_id is null or exists (
            select 1 from admission.action_execution ae where ae.id=r.projection_action_execution_id
              and ae.tenant_id=r.tenant_id and ae.workspace_id=w.id and ae.target_id=r.id
              and ae.action_key in ('agent.installation.execute.grant','agent.installation.execute.revoke')))
        {}", if lock { "for update of r,i,w,a,p,tm" } else { "" }))
        .bind(id).bind(tenant).fetch_optional(conn).await
}

fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}
fn unavailable() -> Refusal {
    Refusal::Unavailable("Installation execute 投影不可核验".into())
}

pub(super) async fn target(
    conn: &mut PgConnection,
    tenant: Uuid,
    def: &Definition,
    sem: Semantic,
    params: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    let grant = sem == Semantic::AgentInstallationExecuteGrant;
    if def.target_type != "RESOURCE"
        || def.permission_object_type != "resource"
        || def.permission != "share"
        || def.tenant_rule != "SESSION_TENANT"
        || def.workspace_rule != "TARGET_HOME_WORKSPACE"
        || def.execution_mode != "SYNC"
        || def.quota_policy != "NONE"
        || !def.meters.is_empty()
        || def.workflow_kind.is_some()
        || def.confirmation_mode != if grant { "APPROVAL" } else { "EXPLICIT" }
        || (def.approval_policy_id.is_some() != grant)
        || (def.approval_policy_version.is_some() != grant)
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    // These columns are not in the original shared Definition read model;
    // check the same exact catalog version rather than drop required policy.
    let policy: bool = sqlx::query_scalar(
        "select capacity_policy='NONE' and capacity_pool_key is null
        and workflow_type is null and result_exposure='NONE' and audit_policy='FULL_LIFECYCLE'
        and obs_correlation_mode='OPERATION_REF' and obs_progress_source='NONE'
        and obs_terminal_source='SYNC_RESULT' and obs_usage_source='NONE' and obs_cost_source='NONE'
        and obs_redaction_policy='PLATFORM_METADATA_ONLY'
        from catalog.action_definition where action_key=$1 and version=$2",
    )
    .bind(&def.action_key)
    .bind(def.version)
    .fetch_one(&mut *conn)
    .await?;
    if !policy {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let id = params
        .resource_id
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let row = installation(conn, tenant, id, lock)
        .await?
        .ok_or_else(conflict)?;
    if Some(row.version) != params.resource_version
        || frozen.is_some_and(|v| v != row.id)
        || (grant && row.projection_action_execution_id.is_some())
    {
        return Err(conflict());
    }
    if !grant {
        if let Some(pending) = row.projection_action_execution_id {
            let key: String = sqlx::query_scalar(
                "select action_key from admission.action_execution where id=$1 and tenant_id=$2",
            )
            .bind(pending)
            .bind(tenant)
            .fetch_one(&mut *conn)
            .await?;
            if key != GRANT {
                return Err(conflict());
            }
        }
    }
    Ok(Target {
        id: row.id,
        version: row.version,
        workspace_id: Some(row.workspace_id),
    })
}

async fn projection(g: &Governance, row: &Installation) -> Result<(), Refusal> {
    if !g
        .spicedb
        .resource_projection_matches_in_workspace(
            &row.id.to_string(),
            &row.tenant_id.to_string(),
            &row.owner_principal_id.to_string(),
            Some(&row.workspace_id.to_string()),
            g.cfg.relationship_page,
        )
        .await
        .map_err(|_| unavailable())?
    {
        return Err(unavailable());
    }
    Ok(())
}

async fn human(
    g: &Governance,
    conn: &mut PgConnection,
    row: &Installation,
    principal: Uuid,
) -> Result<(), Refusal> {
    if !crate::agent_definition::active_owner(conn, row.tenant_id, principal).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let _: Option<Uuid> = sqlx::query_scalar(
        "select id from identity.workspace_membership
        where workspace_id=$1 and tenant_principal_id=$2 for update",
    )
    .bind(row.workspace_id)
    .bind(principal)
    .fetch_optional(&mut *conn)
    .await?;
    let member: bool = sqlx::query_scalar(
        "select exists(select 1 from identity.workspace_membership
        where workspace_id=$1 and tenant_principal_id=$2 and state='ACTIVE')",
    )
    .bind(row.workspace_id)
    .bind(principal)
    .fetch_one(&mut *conn)
    .await?;
    if !member {
        // Same HUMAN scope distinction as original Governance: a revoked membership
        // cannot be restored by a leftover Workspace role.
        let existed: bool = sqlx::query_scalar(
            "select exists(select 1 from identity.workspace_membership
            where workspace_id=$1 and tenant_principal_id=$2)",
        )
        .bind(row.workspace_id)
        .bind(principal)
        .fetch_one(&mut *conn)
        .await?;
        checked(
            g,
            if existed { "tenant" } else { "workspace" },
            if existed {
                row.tenant_id
            } else {
                row.workspace_id
            },
            "manage",
            principal,
        )
        .await?;
    }
    checked(g, "resource", row.id, "share", principal).await?;
    checked(g, "resource", row.id, "execute", principal).await?;
    Ok(())
}

async fn checked(
    g: &Governance,
    ty: &str,
    id: Uuid,
    permission: &str,
    principal: Uuid,
) -> Result<String, Refusal> {
    let c = g
        .spicedb
        .check(
            ty,
            &id.to_string(),
            permission,
            &principal.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| unavailable())?;
    if c.zed_token.is_empty() {
        return Err(unavailable());
    }
    if !c.allowed {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    Ok(c.zed_token)
}

pub(super) async fn gate(
    g: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    principal: Uuid,
    params: &Params,
) -> Result<(), Refusal> {
    let row = installation(
        conn,
        tenant,
        params.resource_id.ok_or_else(conflict)?,
        false,
    )
    .await?
    .ok_or_else(conflict)?;
    if Some(row.version) != params.resource_version {
        return Err(conflict());
    }
    projection(g, &row).await?;
    human(g, conn, &row, principal).await
}

pub(super) async fn evaluate_target(
    g: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    target: &Target,
) -> Result<(), Refusal> {
    let row = installation(conn, tenant, target.id, false)
        .await?
        .ok_or_else(conflict)?;
    if row.version != target.version || Some(row.workspace_id) != target.workspace_id {
        return Err(conflict());
    }
    projection(g, &row).await
}

/// The only TARGET_OWNER consumer introduced here. No fallback to current owner.
pub(super) fn owner_policy(action: &str, policy: &super::Policy) -> bool {
    action == GRANT
        && policy.owner_requirement == "TARGET_OWNER"
        && policy.self_approval == "ALLOW"
        && policy.role_requirements.is_empty()
}

pub(super) fn frozen_owner(ae: &Execution) -> Result<contracts::AffectedOwnerRef, Refusal> {
    let parameters = ae.parameters.as_ref().ok_or_else(unavailable)?;
    let owner: contracts::AffectedOwnerRef =
        serde_json::from_value(parameters["permissionApprovalOwner"].clone())
            .map_err(|_| unavailable())?;
    if ae.action_key != GRANT
        || !owner_reference_matches(&owner, ae.target_id, ae.frozen_target_version())
    {
        return Err(conflict());
    }
    Ok(owner)
}

fn owner_reference_matches(
    owner: &contracts::AffectedOwnerRef,
    target: Uuid,
    version: Option<i32>,
) -> bool {
    owner.target_type == "RESOURCE"
        && owner.target_id == target.to_string()
        && Some(owner.target_version) == version.map(i64::from)
        && Uuid::parse_str(&owner.owner_principal_id).is_ok_and(|id| !id.is_nil())
}

pub(super) async fn validate_approval_owner(
    g: &Governance,
    conn: &mut PgConnection,
    ae: &Execution,
    projected: bool,
) -> Result<contracts::AffectedOwnerRef, Refusal> {
    let owner = frozen_owner(ae)?;
    let row = installation(conn, ae.tenant_id, ae.target_id, true)
        .await?
        .ok_or_else(conflict)?;
    let version = owner
        .target_version
        .checked_add(i64::from(projected))
        .ok_or_else(conflict)?;
    if i64::from(row.version) != version
        || row.owner_principal_id.to_string() != owner.owner_principal_id
        || Some(row.workspace_id) != ae.workspace_id
        || row.projection_action_execution_id != if projected { Some(ae.id) } else { None }
    {
        return Err(conflict());
    }
    projection(g, &row).await?;
    // Owner approval eligibility is not share/execute: exact active HUMAN owner
    // and same frozen scope are required, as in the original owner approval contract.
    let id = Uuid::parse_str(&owner.owner_principal_id).map_err(|_| conflict())?;
    if !crate::agent_definition::active_owner(conn, ae.tenant_id, id).await? {
        return Err(conflict());
    }
    Ok(owner)
}

pub(crate) async fn approval_owner_eligible(
    g: &Governance,
    tenant: Uuid,
    principal: Uuid,
    id: Uuid,
) -> Result<bool, Refusal> {
    let Some(ae) = super::load_execution(&g.pool, id).await? else {
        return Ok(false);
    };
    if ae.tenant_id != tenant || ae.action_key != GRANT {
        return Ok(false);
    }
    let mut tx = g.pool.begin().await?;
    if !crate::roles::lock_tenant(&mut tx, tenant).await? {
        return Ok(false);
    }
    match validate_approval_owner(g, &mut tx, &ae, false).await {
        Ok(owner) => Ok(owner.owner_principal_id == principal.to_string()),
        Err(Refusal::Conflict(_)) | Err(Refusal::Denied(_)) => Ok(false),
        Err(e) => Err(e),
    }
}

async fn approved(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
) -> Result<(), Refusal> {
    let owner = validate_approval_owner(g, tx, ae, true).await?;
    let wf = ae.approval_workflow_id.as_ref().ok_or_else(unavailable)?;
    let row: Option<(bool, Value)> = sqlx::query_as(
        "select status='APPROVED' and consume_deadline>
        clock_timestamp()+make_interval(secs=>$2::bigint),decisions
        from projection.approval_projection where workflow_id=$1",
    )
    .bind(wf)
    .bind(g.cfg.dispatch_margin_seconds)
    .fetch_optional(&mut **tx)
    .await?;
    let Some((true, decisions)) = row else {
        return Err(Refusal::Denied(ReasonCode::ApprovalConsumeWindowClosed));
    };
    let decisions: Vec<contracts::DecisionElement> =
        serde_json::from_value(decisions).map_err(|_| unavailable())?;
    if !decisions.iter().any(|d| {
        d.approver_principal_id == owner.owner_principal_id
            && d.decision == contracts::ApprovalDecision::Approve
    }) {
        return Err(Refusal::Denied(ReasonCode::ApproverNotEligible));
    }
    Ok(())
}

pub(crate) async fn owner_ref(
    g: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    id: Uuid,
) -> Result<contracts::AffectedOwnerRef, Refusal> {
    let row = installation(conn, tenant, id, true)
        .await?
        .ok_or_else(conflict)?;
    if row.projection_action_execution_id.is_some() {
        return Err(conflict());
    }
    projection(g, &row).await?;
    Ok(contracts::AffectedOwnerRef {
        target_type: "RESOURCE".into(),
        target_id: id.to_string(),
        target_version: i64::from(row.version),
        owner_principal_id: row.owner_principal_id.to_string(),
    })
}

/// Before opening a revoke, cancel only this exact Installation's pending grants.
/// Locks are original AE→Tenant→Workspace/Resource, not Tenant→another AE.
pub(super) async fn prepare_revoke(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    actor: Actor,
    params: &Params,
) -> Result<Vec<Uuid>, Refusal> {
    let id = params.resource_id.ok_or_else(conflict)?;
    let ids: Vec<Uuid> = sqlx::query_scalar("select id from admission.action_execution
        where tenant_id=$1 and target_id=$2 and action_key='agent.installation.execute.grant'
          and (gate_state in ('EVALUATING','WAITING') or (gate_state='ALLOWED' and dispatch_state in ('NOT_DISPATCHED','UNKNOWN')))
        order by id for update")
        .bind(actor.tenant_id).bind(id).fetch_all(&mut **tx).await?;
    if !crate::roles::lock_tenant(tx, actor.tenant_id).await? {
        return Err(conflict());
    }
    let row = installation(tx, actor.tenant_id, id, true)
        .await?
        .ok_or_else(conflict)?;
    if Some(row.version) != params.resource_version {
        return Err(conflict());
    }
    projection(g, &row).await?;
    human(g, tx, &row, actor.principal_id).await?;
    for id in &ids {
        let ae = lock_execution(tx, *id).await?;
        let def = exact_definition(&g.pool, &ae.action_key, ae.action_version).await?;
        sqlx::query("update admission.action_execution set gate_state='REVOKED',
            dispatch_state=case when dispatch_state='NOT_DISPATCHED' then 'ABORTED' else dispatch_state end,
            reason_code='PERMISSION_DENIED',updated_at=now() where id=$1")
            .bind(id).execute(&mut **tx).await?;
        audit(
            tx,
            &ae,
            &def,
            "permission-revoked",
            "DECISION",
            "DENY",
            "PERMISSION_DENIED",
            actor.human_identity_id,
            Vec::new(),
        )
        .await?;
    }
    Ok(ids)
}

pub(super) async fn prewrite(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
) -> Result<(), Refusal> {
    let version = ae.frozen_target_version().ok_or_else(conflict)?;
    let row = installation(tx, ae.tenant_id, ae.target_id, true)
        .await?
        .ok_or_else(conflict)?;
    if row.version != version || Some(row.workspace_id) != ae.workspace_id {
        return Err(conflict());
    }
    let updated = sqlx::query(
        "update catalog.resource set version=version+1,projection_action_execution_id=$2
        where id=$1 and tenant_id=$3 and version=$4 returning version",
    )
    .bind(row.id)
    .bind(ae.id)
    .bind(row.tenant_id)
    .bind(version)
    .fetch_optional(&mut **tx)
    .await?;
    let version: i32 = updated.ok_or_else(conflict)?.try_get("version")?;
    sqlx::query("update admission.action_execution set parameters=jsonb_set(parameters,'{permissionIntent}',$2),updated_at=now() where id=$1")
        .bind(ae.id).bind(json!({"resourceVersion":version,"agentPrincipalId":row.agent_principal_id,
            "ownerPrincipalId":row.owner_principal_id})).execute(&mut **tx).await?;
    if ae.action_key == REVOKE {
        // A subsequent grant never clears this immutable cancellation intent.
        // AgentTask retains native/Temporal/usage terminal authority.
        sqlx::query("update catalog.agent_invocation i set cancel_pending=true,updated_at=now()
            from admission.action_execution source,catalog.agent_runtime_projection p,catalog.agent_installation installed
            where source.id=i.action_execution_id and source.action_key='agent.invoke'
              and source.tenant_id=$1 and source.target_id=$2 and source.workspace_id=$3
              and i.tenant_id=source.tenant_id and i.workspace_id=source.workspace_id
              and i.installation_resource_id=source.target_id
              and p.installation_resource_id=i.installation_resource_id
              and p.generation=i.projection_generation and installed.resource_id=i.installation_resource_id
              and installed.agent_principal_id=$4
              and i.status in ('CREATED','DISPATCHING','RUNNING','UNKNOWN') and not i.cancel_pending")
            .bind(row.tenant_id).bind(row.id).bind(row.workspace_id).bind(row.agent_principal_id)
            .execute(&mut **tx).await?;
    }
    Ok(())
}

async fn held(g: &Governance, row: &Installation) -> Result<bool, Refusal> {
    let resource = row.id.to_string();
    let agent = row.agent_principal_id.to_string();
    let rels = g
        .spicedb
        .read(
            &RelationshipFilter {
                object_type: "resource",
                object_id: Some(&resource),
                relation: Some("executor"),
                subject_principal: Some(&agent),
            },
            g.cfg.relationship_page,
        )
        .await
        .map_err(|_| unavailable())?;
    if rels.len() > 1
        || rels.iter().any(|r| {
            r.object_type != "resource"
                || r.object_id != resource
                || r.relation != "executor"
                || r.subject_principal != agent
        })
    {
        return Err(unavailable());
    }
    Ok(!rels.is_empty())
}

pub(super) async fn dispatch(
    g: &Governance,
    id: Uuid,
    def: &Definition,
    grant: bool,
) -> Result<(), Refusal> {
    // Claim once and commit before external mutation. UNKNOWN is observation-only.
    let mut tx = g.pool.begin().await?;
    let ae = lock_execution(&mut tx, id).await?;
    if ae.gate_state != "ALLOWED"
        || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
    {
        return Ok(());
    }
    let first = ae.dispatch_state == "NOT_DISPATCHED";
    if first {
        sqlx::query("update admission.action_execution set dispatch_state='UNKNOWN',updated_at=now() where id=$1")
            .bind(id).execute(&mut *tx).await?;
        audit(
            &mut tx,
            &ae,
            def,
            "permission-dispatch-intent",
            "DISPATCH",
            "ALLOW",
            "DISPATCH_RESULT_UNKNOWN",
            None,
            Vec::new(),
        )
        .await?;
    }
    tx.commit().await?;
    let mut tx = g.pool.begin().await?;
    let ae = lock_execution(&mut tx, id).await?;
    if ae.gate_state != "ALLOWED" || ae.dispatch_state != "UNKNOWN" {
        return Ok(());
    }
    if !crate::roles::lock_tenant(&mut tx, ae.tenant_id).await? {
        return Err(conflict());
    }
    let row = installation(&mut tx, ae.tenant_id, ae.target_id, true)
        .await?
        .ok_or_else(conflict)?;
    let intent = &ae.parameters.as_ref().ok_or_else(unavailable)?["permissionIntent"];
    if row.projection_action_execution_id != Some(id)
        || Some(row.workspace_id) != ae.workspace_id
        || intent["resourceVersion"].as_i64() != Some(i64::from(row.version))
        || intent["agentPrincipalId"].as_str() != Some(row.agent_principal_id.to_string().as_str())
        || intent["ownerPrincipalId"].as_str() != Some(row.owner_principal_id.to_string().as_str())
    {
        return Err(conflict());
    }
    projection(g, &row).await?;
    let fresh = async {
        human(g, &mut tx, &row, ae.initiator_principal_id).await?;
        if grant && first {
            approved(g, &mut tx, &ae).await?;
        }
        Ok::<(), Refusal>(())
    }
    .await;
    if let Err(error) = fresh {
        // Only this live claimant knows no RPC has yet been issued. A recovered
        // UNKNOWN has no such proof and may not discard an external mutation.
        if first && matches!(error, Refusal::Denied(_) | Refusal::Conflict(_)) {
            sqlx::query("update admission.action_execution set dispatch_state='ABORTED',reason_code=$2,updated_at=now() where id=$1")
                .bind(id).bind(super::wire(&error.reason())).execute(&mut *tx).await?;
            sqlx::query("update catalog.resource set projection_action_execution_id=null where id=$1 and projection_action_execution_id=$2 and version=$3")
                .bind(row.id).bind(id).bind(row.version).execute(&mut *tx).await?;
            audit(
                &mut tx,
                &ae,
                def,
                "permission-outcome",
                "OUTCOME",
                "DENY",
                "NOT_APPLIED",
                None,
                Vec::new(),
            )
            .await?;
            tx.commit().await?;
            g.invalidate(id).await;
        }
        return Err(error);
    }
    let mut token = None;
    if first {
        let rel = Relationship {
            object_type: "resource".into(),
            object_id: row.id.to_string(),
            relation: "executor".into(),
            subject_principal: row.agent_principal_id.to_string(),
        };
        match g
            .spicedb
            .write(&[(if grant { Write::Touch } else { Write::Delete }, rel)])
            .await
        {
            Ok(written) if !written.is_empty() => token = Some(written),
            _ => {
                tx.commit().await?;
                return Err(unavailable());
            }
        }
    }
    let c = g
        .spicedb
        .check(
            "resource",
            &row.id.to_string(),
            "execute",
            &row.agent_principal_id.to_string(),
            token.as_ref().map_or(Consistency::FullyConsistent, |s| {
                Consistency::AtLeastAsFresh(s.as_str())
            }),
        )
        .await
        .map_err(|_| unavailable())?;
    if c.zed_token.is_empty() || held(g, &row).await? != grant || c.allowed != grant {
        audit(
            &mut tx,
            &ae,
            def,
            "permission-prior-unknown",
            "RECONCILIATION",
            "NONE",
            "DISPATCH_RESULT_UNKNOWN",
            None,
            Vec::new(),
        )
        .await?;
        tx.commit().await?;
        return Err(unavailable());
    }
    // An older timed-out native Touch has no operation-status API. Absence after
    // our Delete cannot prove that request will not commit late. Keep the same
    // pending projection fail-closed rather than lift its fence or replay Touch.
    if !grant
        && sqlx::query_scalar::<_, bool>(
            "select exists(select 1 from admission.action_execution
        where tenant_id=$1 and target_id=$2 and action_key='agent.installation.execute.grant'
          and gate_state='REVOKED' and dispatch_state='UNKNOWN')",
        )
        .bind(ae.tenant_id)
        .bind(ae.target_id)
        .fetch_one(&mut *tx)
        .await?
    {
        audit(
            &mut tx,
            &ae,
            def,
            "permission-prior-unknown",
            "RECONCILIATION",
            "NONE",
            "DISPATCH_RESULT_UNKNOWN",
            None,
            Vec::new(),
        )
        .await?;
        tx.commit().await?;
        return Err(unavailable());
    }
    let updated = sqlx::query(
        "update catalog.resource set projection_action_execution_id=null
        where id=$1 and projection_action_execution_id=$2 and version=$3",
    )
    .bind(row.id)
    .bind(id)
    .bind(row.version)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() != 1 {
        return Err(conflict());
    }
    sqlx::query("update admission.action_execution set dispatch_state='DISPATCHED',reason_code=null,updated_at=now() where id=$1")
        .bind(id).execute(&mut *tx).await?;
    let mut evidence = zed_evidence(Some(&c.zed_token));
    evidence.push(crate::audit::Evidence::new(
        EvidenceKind::SpicedbRelationship,
        format!(
            "resource:{}#executor@principal:{}",
            row.id, row.agent_principal_id
        ),
    ));
    audit(
        &mut tx,
        &ae,
        def,
        "permission-outcome",
        "OUTCOME",
        "ALLOW",
        if grant {
            "INSTALLATION_EXECUTE_GRANTED"
        } else {
            "INSTALLATION_EXECUTE_REVOKED"
        },
        None,
        evidence,
    )
    .await?;
    tx.commit().await?;
    if ae.approval_workflow_id.is_some() {
        g.consume(ae.id).await;
    }
    Ok(())
}

pub(crate) async fn view(
    g: &Governance,
    tenant: Uuid,
    principal: Uuid,
    id: Uuid,
) -> Result<Option<Value>, Refusal> {
    let mut conn = g.pool.acquire().await?;
    let Some(row) = installation(&mut conn, tenant, id, false).await? else {
        return Ok(None);
    };
    projection(g, &row).await?;
    let requested = held(g, &row).await?;
    let c = g
        .spicedb
        .check(
            "resource",
            &id.to_string(),
            "execute",
            &row.agent_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| unavailable())?;
    if c.zed_token.is_empty() {
        return Err(unavailable());
    }
    let can_manage = match human(g, &mut conn, &row, principal).await {
        Ok(()) => true,
        Err(Refusal::Denied(_)) => false,
        Err(e) => return Err(e),
    };
    let mut enabled = Vec::new();
    for key in [GRANT, REVOKE] {
        enabled.push(
            crate::capability_registry::action_exposed(key)
                && super::active_definition(&g.pool, key).await?.is_some(),
        );
    }
    let mut result = json!({"requested":requested,"effective":c.allowed && row.projection_action_execution_id.is_none(),
    "canGrant":can_manage && enabled[0] && row.projection_action_execution_id.is_none() && !requested,
    "canRevoke":can_manage && enabled[1] && match row.projection_action_execution_id {
        None => true,
        Some(pending) => sqlx::query_scalar::<_, String>("select action_key from admission.action_execution where id=$1 and tenant_id=$2")
            .bind(pending).bind(tenant).fetch_one(&mut *conn).await? == GRANT,
    }});
    if let Some(pending) = row.projection_action_execution_id {
        result["pendingActionExecutionId"] = json!(pending);
    }
    Ok(Some(result))
}

#[cfg(test)]
mod approval_tests {
    use super::*;

    #[test]
    fn only_exact_installation_grant_resolves_target_owner() {
        let policy = super::super::Policy {
            id: Uuid::new_v4(),
            version: 1,
            role_requirements: Vec::new(),
            owner_requirement: "TARGET_OWNER".into(),
            self_approval: "ALLOW".into(),
            expires_in_seconds: 1,
        };
        assert!(owner_policy(GRANT, &policy));
        for action in [
            REVOKE,
            "resource.grant_read",
            "resource.transfer_owner",
            "unknown",
        ] {
            assert!(!owner_policy(action, &policy));
        }
        for requirement in ["NONE", "ALL_AFFECTED_OWNERS", "UNKNOWN"] {
            assert!(!owner_policy(
                GRANT,
                &super::super::Policy {
                    owner_requirement: requirement.into(),
                    ..policy.clone()
                }
            ));
        }
        assert!(!owner_policy(
            GRANT,
            &super::super::Policy {
                self_approval: "DENY".into(),
                ..policy.clone()
            }
        ));
        assert!(!owner_policy(
            GRANT,
            &super::super::Policy {
                role_requirements: vec![contracts::ApprovalRoleRequirement {
                    selector: contracts::ApprovalSelector::TenantAdmin,
                    min_distinct: 1
                }],
                ..policy
            }
        ));
    }

    #[test]
    fn owner_reference_never_retargets_or_accepts_missing_version() {
        let target = Uuid::new_v4();
        let owner = contracts::AffectedOwnerRef {
            target_type: "RESOURCE".into(),
            target_id: target.to_string(),
            target_version: 3,
            owner_principal_id: Uuid::new_v4().to_string(),
        };
        assert!(owner_reference_matches(&owner, target, Some(3)));
        assert!(!owner_reference_matches(&owner, Uuid::new_v4(), Some(3)));
        assert!(!owner_reference_matches(&owner, target, None));
        assert!(!owner_reference_matches(&owner, target, Some(4)));
        assert!(!owner_reference_matches(
            &contracts::AffectedOwnerRef {
                owner_principal_id: Uuid::nil().to_string(),
                ..owner.clone()
            },
            target,
            Some(3)
        ));
        assert!(!owner_reference_matches(
            &contracts::AffectedOwnerRef {
                target_type: "ASSET".into(),
                ..owner
            },
            target,
            Some(3)
        ));
    }

    #[test]
    fn permission_command_does_not_accept_browser_selected_agent_or_implicit_revoke() {
        let command = |action: &str| {
            serde_json::from_value::<contracts::ActionCommand>(json!({
            "actionKey":action,"idempotencyKey":Uuid::new_v4(),"resourceId":Uuid::new_v4(),"resourceVersion":1})).unwrap()
        };
        let grant = command(GRANT);
        assert!(
            super::super::parse_command(Semantic::AgentInstallationExecuteGrant, &grant).is_ok()
        );
        let mut chosen = grant.clone();
        chosen.principal_id = Some(Uuid::new_v4().to_string());
        assert!(
            super::super::parse_command(Semantic::AgentInstallationExecuteGrant, &chosen).is_err()
        );
        let mut revoke = command(REVOKE);
        assert!(
            super::super::parse_command(Semantic::AgentInstallationExecuteRevoke, &revoke).is_err()
        );
        revoke.explicit_confirmation = Some(false);
        assert!(
            super::super::parse_command(Semantic::AgentInstallationExecuteRevoke, &revoke).is_err()
        );
        revoke.explicit_confirmation = Some(true);
        assert!(
            super::super::parse_command(Semantic::AgentInstallationExecuteRevoke, &revoke).is_ok()
        );
    }
}
