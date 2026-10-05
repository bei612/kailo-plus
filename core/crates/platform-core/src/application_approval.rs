//! DD-47/69/88: APPLICATION consumes the original ApprovalWorkflow and policy.
//! Only exact frozen target owners and existing SpiceDB selectors are eligible.
use std::collections::{HashMap, HashSet};

use contracts::{
    AffectedOwnerRef, ApprovalDecision, ApprovalSelector, DecisionElement,
    FreshApprovalAdmissionResult, ReasonCode,
};
use serde_json::Value;
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::{
    governance::{Definition, Execution, Governance, Policy, Refusal},
    spicedb::Consistency,
};

fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::ApprovalInvalidated)
}
fn unknown() -> Refusal {
    Refusal::Unavailable("APPLICATION approval evidence unavailable".into())
}

pub(crate) async fn is_application(pool: &PgPool, ae: &Execution) -> Result<bool, Refusal> {
    Ok(sqlx::query_scalar::<_, bool>(
        "select coalesce(component_binding_kind='APPLICATION',false)
        from admission.action_execution where id=$1 and tenant_id=$2",
    )
    .bind(ae.id)
    .bind(ae.tenant_id)
    .fetch_optional(pool)
    .await?
    .unwrap_or(false))
}

// Same ordering as the Tool factory: original root and Invocation before child.
// Reconciliation may lock a revoked parent to invalidate its old approval.
pub(crate) async fn lock_parent(conn: &mut PgConnection, ae: &Execution) -> Result<(), Refusal> {
    if lock_parent_refs(conn, ae.id).await?.is_none() {
        return Err(conflict());
    }
    Ok(())
}

pub(crate) async fn lock_parent_refs(
    conn: &mut PgConnection,
    id: Uuid,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select p.id from admission.action_execution a
        join admission.action_execution p on p.id=a.parent_action_execution_id
          and p.operation_id=a.operation_id and p.tenant_id=a.tenant_id
          and p.workspace_id is not distinct from a.workspace_id and p.correlation_id=a.correlation_id
        join catalog.agent_invocation i on i.action_execution_id=p.id and i.tenant_id=p.tenant_id
        where a.id=$1 and a.component_binding_kind='APPLICATION' for update of p,i")
        .bind(id).fetch_optional(conn).await
}

pub(crate) fn resolvable(def: &Definition, policy: &Policy, workspace: Option<Uuid>) -> bool {
    matches!(def.target_type.as_str(), "RESOURCE" | "ASSET")
        && matches!(policy.owner_requirement.as_str(), "NONE" | "TARGET_OWNER")
        && matches!(policy.self_approval.as_str(), "ALLOW" | "DENY")
        && (policy.owner_requirement == "TARGET_OWNER" || !policy.role_requirements.is_empty())
        && policy.role_requirements.iter().all(|r| {
            r.min_distinct > 0
                && match r.selector {
                    ApprovalSelector::TenantAdmin | ApprovalSelector::ResourceApprover => true,
                    ApprovalSelector::WorkspaceAdmin => workspace.is_some(),
                }
        })
}

// A business Resource is selected through its exact stored binding/release/type,
// not the AgentDefinition-only reader and not a release-independent natural key.
async fn current_owners(
    g: &Governance,
    conn: &mut PgConnection,
    ae: &Execution,
    def: &Definition,
) -> Result<Vec<AffectedOwnerRef>, Refusal> {
    let resource = match def.target_type.as_str() {
        "RESOURCE" => ae.target_id,
        "ASSET" => sqlx::query_scalar(
            "select resource_id from catalog.asset
            where id=$1 and tenant_id=$2",
        )
        .bind(ae.target_id)
        .bind(ae.tenant_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(conflict)?,
        _ => return Err(conflict()),
    };
    let row: Option<(Uuid, i32, Option<Uuid>)> = sqlx::query_as("select r.owner_principal_id,r.version,r.home_workspace_id
        from catalog.resource r join admission.action_execution a on a.id=$1
        join catalog.application_binding b on b.id=a.component_binding_id and b.tenant_id=a.tenant_id
        join projection.application_runtime p on p.binding_id=b.id and p.generation=a.component_projection_generation
          and p.component_release_id=a.component_release_id
        join catalog.resource_type_definition ty on ty.id=r.resource_type_definition_id
          and ty.type_key=r.type_key and ty.component_release_id=a.component_release_id and ty.status='ACTIVE'
        where r.id=$2 and r.tenant_id=a.tenant_id and r.application_binding_id=b.id
          and r.state='ACTIVE' and r.projection_action_execution_id is null
          and b.state='ACTIVE' and b.active_projection_generation=p.generation and p.state='ACTIVE'
          and b.component_release_id=a.component_release_id
          and (b.workspace_id is null or b.workspace_id=a.workspace_id)
          and (r.home_workspace_id is null or r.home_workspace_id=a.workspace_id) for update of r")
        .bind(ae.id).bind(resource).fetch_optional(&mut *conn).await?;
    let (owner, version, workspace) = row.ok_or_else(conflict)?;
    if !crate::agent_definition::active_owner(conn, ae.tenant_id, owner).await?
        || !g
            .spicedb
            .resource_projection_matches_in_workspace(
                &resource.to_string(),
                &ae.tenant_id.to_string(),
                &owner.to_string(),
                workspace.map(|w| w.to_string()).as_deref(),
                g.cfg.relationship_page,
            )
            .await
            .map_err(|_| unknown())?
    {
        return Err(conflict());
    }
    let parent = AffectedOwnerRef {
        target_type: "RESOURCE".into(),
        target_id: resource.to_string(),
        target_version: i64::from(version),
        owner_principal_id: owner.to_string(),
    };
    if def.target_type == "RESOURCE" {
        if ae.frozen_target_version() != Some(version) {
            return Err(conflict());
        }
        return Ok(vec![parent]);
    }
    let asset: Option<(Uuid, i32)> = sqlx::query_as(
        "select owner_principal_id,version from catalog.asset
        where id=$1 and tenant_id=$2 and resource_id=$3 and state='ACTIVE'
          and projection_action_execution_id is null for update",
    )
    .bind(ae.target_id)
    .bind(ae.tenant_id)
    .bind(resource)
    .fetch_optional(&mut *conn)
    .await?;
    let (owner, version) = asset.ok_or_else(conflict)?;
    if ae.frozen_target_version() != Some(version)
        || !crate::agent_definition::active_owner(conn, ae.tenant_id, owner).await?
        || !g
            .spicedb
            .asset_projection_matches(
                &ae.target_id.to_string(),
                &ae.tenant_id.to_string(),
                &resource.to_string(),
                &owner.to_string(),
                g.cfg.relationship_page,
            )
            .await
            .map_err(|_| unknown())?
    {
        return Err(conflict());
    }
    Ok(vec![
        AffectedOwnerRef {
            target_type: "ASSET".into(),
            target_id: ae.target_id.to_string(),
            target_version: i64::from(version),
            owner_principal_id: owner.to_string(),
        },
        parent,
    ])
}

pub(crate) fn frozen_owners(
    ae: &Execution,
    def: &Definition,
) -> Result<Vec<AffectedOwnerRef>, Refusal> {
    let refs: Vec<AffectedOwnerRef> = serde_json::from_value(
        ae.parameters.as_ref().ok_or_else(unknown)?["applicationApprovalOwners"].clone(),
    )
    .map_err(|_| unknown())?;
    if !frozen_matches(
        ae.target_id,
        ae.frozen_target_version(),
        &def.target_type,
        &refs,
    ) {
        return Err(conflict());
    }
    Ok(refs)
}

fn frozen_matches(
    target: Uuid,
    version: Option<i32>,
    kind: &str,
    refs: &[AffectedOwnerRef],
) -> bool {
    let expected = match kind {
        "RESOURCE" => 1,
        "ASSET" => 2,
        _ => return false,
    };
    refs.len() == expected
        && refs[0].target_type == kind
        && refs[0].target_id == target.to_string()
        && Some(refs[0].target_version) == version.map(i64::from)
        && refs.iter().all(|r| {
            r.target_version > 0
                && Uuid::parse_str(&r.target_id).is_ok_and(|id| !id.is_nil())
                && Uuid::parse_str(&r.owner_principal_id).is_ok_and(|id| !id.is_nil())
        })
        && (expected == 1
            || (refs[1].target_type == "RESOURCE" && refs[1].target_id != refs[0].target_id))
}

pub(crate) async fn freeze(
    g: &Governance,
    conn: &mut PgConnection,
    ae: &Execution,
    def: &Definition,
) -> Result<(), Refusal> {
    if !crate::roles::lock_tenant(conn, ae.tenant_id).await? {
        return Err(conflict());
    }
    let refs = current_owners(g, conn, ae, def).await?;
    sqlx::query("update admission.action_execution set parameters=jsonb_set(parameters,'{applicationApprovalOwners}',$2)
        where id=$1 and not(parameters ? 'applicationApprovalOwners')")
        .bind(ae.id).bind(serde_json::to_value(&refs).map_err(|_|unknown())?).execute(&mut *conn).await?;
    let parameters: Value =
        sqlx::query_scalar("select parameters from admission.action_execution where id=$1")
            .bind(ae.id)
            .fetch_one(&mut *conn)
            .await?;
    let stored: Vec<AffectedOwnerRef> =
        serde_json::from_value(parameters["applicationApprovalOwners"].clone())
            .map_err(|_| unknown())?;
    if stored != refs {
        return Err(conflict());
    }
    Ok(())
}

pub(crate) async fn target_current(
    g: &Governance,
    conn: &mut PgConnection,
    ae: &Execution,
    def: &Definition,
) -> Result<bool, Refusal> {
    let frozen = frozen_owners(ae, def)?;
    match current_owners(g, conn, ae, def).await {
        Ok(current) => Ok(current == frozen),
        Err(Refusal::Conflict(_) | Refusal::Denied(_)) => Ok(false),
        Err(error) => Err(error),
    }
}

/// The same fresh consumer serves the original admission Activity, BFF reader,
/// and the last pre-dispatch check. No cached relationship is an approval.
pub(crate) async fn qualify(
    g: &Governance,
    conn: &mut PgConnection,
    ae: &Execution,
    def: &Definition,
    policy: &Policy,
    approver: Uuid,
) -> Result<(FreshApprovalAdmissionResult, Option<String>), Refusal> {
    let refused = |reason| {
        (
            FreshApprovalAdmissionResult {
                admitted: false,
                reason: Some(reason),
                satisfied_selectors: vec![],
            },
            None,
        )
    };
    if !resolvable(def, policy, ae.workspace_id) {
        return Ok(refused(ReasonCode::ApprovalSelectorUnresolvable));
    }
    let active_policy: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.approval_policy
        where id=$1 and version=$2 and action_key=$3 and target_type=$4 and status='ACTIVE')",
    )
    .bind(policy.id)
    .bind(policy.version)
    .bind(&def.action_key)
    .bind(&def.target_type)
    .fetch_one(&mut *conn)
    .await?;
    if !active_policy {
        return Ok(refused(ReasonCode::ApprovalInvalidated));
    }
    let parent_live:bool=sqlx::query_scalar("select exists(select 1 from admission.action_execution a
        join admission.action_execution p on p.id=a.parent_action_execution_id and p.tenant_id=a.tenant_id
          and p.operation_id=a.operation_id and p.workspace_id is not distinct from a.workspace_id
        join catalog.agent_invocation i on i.action_execution_id=p.id and i.tenant_id=p.tenant_id
        where a.id=$1 and p.gate_state='ALLOWED' and p.dispatch_state='DISPATCHED'
          and i.status='RUNNING' and i.native_status='inProgress' and not i.cancel_pending)")
        .bind(ae.id).fetch_one(&mut *conn).await?;
    if !parent_live {
        return Ok(refused(ReasonCode::ApprovalInvalidated));
    }
    let active:bool=sqlx::query_scalar("select exists(select 1 from identity.principal p
        join identity.tenant_membership tm on tm.tenant_principal_id=p.id and tm.tenant_id=p.tenant_id
        where p.id=$1 and p.tenant_id=$2 and p.kind='HUMAN' and p.status='ACTIVE' and tm.state='ACTIVE')")
        .bind(approver).bind(ae.tenant_id).fetch_one(&mut *conn).await?;
    if !active {
        return Ok(refused(ReasonCode::ApproverNotEligible));
    }
    if policy.self_approval == "DENY" && approver == ae.initiator_principal_id {
        return Ok(refused(ReasonCode::SelfApprovalDenied));
    }
    if !target_current(g, conn, ae, def).await? {
        return Ok(refused(ReasonCode::ApprovalInvalidated));
    }
    let refs = frozen_owners(ae, def)?;
    let owner = policy.owner_requirement == "TARGET_OWNER"
        && refs[0].owner_principal_id == approver.to_string();
    let mut satisfied = Vec::new();
    let mut revision = None;
    for requirement in &policy.role_requirements {
        let (kind, id, permission) = match requirement.selector {
            ApprovalSelector::TenantAdmin => ("tenant", ae.tenant_id, "manage"),
            ApprovalSelector::WorkspaceAdmin => {
                ("workspace", ae.workspace_id.ok_or_else(conflict)?, "manage")
            }
            ApprovalSelector::ResourceApprover => {
                (def.permission_object_type.as_str(), ae.target_id, "approve")
            }
        };
        let checked = g
            .spicedb
            .check(
                kind,
                &id.to_string(),
                permission,
                &approver.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| unknown())?;
        if checked.zed_token.is_empty() {
            return Err(unknown());
        }
        revision = Some(checked.zed_token);
        if checked.allowed && !satisfied.contains(&requirement.selector) {
            satisfied.push(requirement.selector.clone());
        }
    }
    if !owner && satisfied.is_empty() {
        return Ok(refused(ReasonCode::ApproverNotEligible));
    }
    Ok((
        FreshApprovalAdmissionResult {
            admitted: true,
            reason: None,
            satisfied_selectors: satisfied,
        },
        revision,
    ))
}

pub(crate) async fn eligible(
    g: &Governance,
    ae: &Execution,
    approver: Uuid,
) -> Result<bool, Refusal> {
    let def = crate::governance::exact_definition_for_execution(&g.pool, ae).await?;
    let mut tx = g.pool.begin().await?;
    lock_parent(&mut tx, ae).await?;
    if !crate::roles::lock_tenant(&mut tx, ae.tenant_id).await? {
        return Ok(false);
    }
    let policy = policy(&mut tx, &def).await?;
    Ok(qualify(g, &mut tx, ae, &def, &policy, approver)
        .await?
        .0
        .admitted)
}

/// Recheck every recorded approving HUMAN and each selector threshold, not merely
/// APPROVED. Dependency failure leaves UNKNOWN; revoked facts invalidate.
pub(crate) async fn require_consumable(
    g: &Governance,
    conn: &mut PgConnection,
    ae: &Execution,
    def: &Definition,
) -> Result<(), Refusal> {
    if def.confirmation_mode != "APPROVAL" {
        return Ok(());
    }
    let workflow = ae.approval_workflow_id.as_deref().ok_or_else(unknown)?;
    let row:Option<(bool,Value)>=sqlx::query_as("select status='APPROVED' and coalesce(consume_deadline>
        clock_timestamp()+make_interval(secs=>$2::bigint),false),decisions from projection.approval_projection
        where workflow_id=$1 and action_execution_id=$3")
        .bind(workflow).bind(g.cfg.dispatch_margin_seconds).bind(ae.id).fetch_optional(&mut *conn).await?;
    let Some((true, decisions)) = row else {
        return Err(Refusal::Denied(ReasonCode::ApprovalConsumeWindowClosed));
    };
    let decisions: Vec<DecisionElement> =
        serde_json::from_value(decisions).map_err(|_| unknown())?;
    let policy = policy(conn, def).await?;
    let mut qualified = Vec::new();
    for decision in decisions {
        if decision.decision != ApprovalDecision::Approve {
            return Err(conflict());
        }
        let approver = Uuid::parse_str(&decision.approver_principal_id).map_err(|_| unknown())?;
        let admission = qualify(g, conn, ae, def, &policy, approver).await?.0;
        if !admission.admitted {
            return Err(conflict());
        }
        qualified.push((approver, admission.satisfied_selectors));
    }
    let owners = frozen_owners(ae, def)?;
    let owner = Uuid::parse_str(&owners[0].owner_principal_id).map_err(|_| unknown())?;
    if !requirements_satisfied(&policy, owner, &qualified) {
        return Err(conflict());
    }
    Ok(())
}

fn requirements_satisfied(
    policy: &Policy,
    owner: Uuid,
    qualified: &[(Uuid, Vec<ApprovalSelector>)],
) -> bool {
    let mut groups: HashMap<String, HashSet<Uuid>> = HashMap::new();
    for (id, selectors) in qualified {
        for selector in selectors {
            groups
                .entry(crate::governance::wire(selector))
                .or_default()
                .insert(*id);
        }
    }
    (policy.owner_requirement != "TARGET_OWNER" || qualified.iter().any(|(id, _)| *id == owner))
        && (policy.owner_requirement == "TARGET_OWNER" || !policy.role_requirements.is_empty())
        && policy.role_requirements.iter().all(|r| {
            r.min_distinct > 0
                && groups
                    .get(&crate::governance::wire(&r.selector))
                    .is_some_and(|ids| {
                        i64::try_from(ids.len()).is_ok_and(|count| count >= r.min_distinct)
                    })
        })
}

async fn policy(conn: &mut PgConnection, def: &Definition) -> Result<Policy, Refusal> {
    let (Some(id), Some(version)) = (def.approval_policy_id, def.approval_policy_version) else {
        return Err(unknown());
    };
    let row:Option<(Value,String,String,i32)>=sqlx::query_as("select role_requirements,owner_requirement,self_approval,expires_in_seconds
        from catalog.approval_policy where id=$1 and version=$2 and action_key=$3 and target_type=$4 and status='ACTIVE'")
        .bind(id).bind(version).bind(&def.action_key).bind(&def.target_type).fetch_optional(conn).await?;
    let (roles, owner_requirement, self_approval, expires_in_seconds) = row.ok_or_else(conflict)?;
    Ok(Policy {
        id,
        version,
        role_requirements: serde_json::from_value(roles).map_err(|_| unknown())?,
        owner_requirement,
        self_approval,
        expires_in_seconds,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_policy(
        owner: &str,
        requirements: Vec<contracts::ApprovalRoleRequirement>,
    ) -> Policy {
        Policy {
            id: Uuid::new_v4(),
            version: 1,
            role_requirements: requirements,
            owner_requirement: owner.into(),
            self_approval: "DENY".into(),
            expires_in_seconds: 300,
        }
    }

    #[test]
    fn owner_and_each_role_threshold_are_independent() {
        let owner = Uuid::new_v4();
        let admin = Uuid::new_v4();
        let policy = fixture_policy(
            "TARGET_OWNER",
            vec![contracts::ApprovalRoleRequirement {
                selector: ApprovalSelector::TenantAdmin,
                min_distinct: 1,
            }],
        );
        assert!(!requirements_satisfied(
            &policy,
            owner,
            &[(admin, vec![ApprovalSelector::TenantAdmin])]
        ));
        assert!(!requirements_satisfied(&policy, owner, &[(owner, vec![])]));
        assert!(requirements_satisfied(
            &policy,
            owner,
            &[
                (owner, vec![]),
                (admin, vec![ApprovalSelector::TenantAdmin])
            ]
        ));
    }

    #[test]
    fn duplicate_vote_or_other_selector_cannot_fill_a_group() {
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let policy = fixture_policy(
            "NONE",
            vec![contracts::ApprovalRoleRequirement {
                selector: ApprovalSelector::ResourceApprover,
                min_distinct: 2,
            }],
        );
        assert!(!requirements_satisfied(
            &policy,
            a,
            &[
                (a, vec![ApprovalSelector::ResourceApprover]),
                (a, vec![ApprovalSelector::ResourceApprover]),
                (b, vec![ApprovalSelector::TenantAdmin])
            ]
        ));
        assert!(requirements_satisfied(
            &policy,
            a,
            &[
                (a, vec![ApprovalSelector::ResourceApprover]),
                (b, vec![ApprovalSelector::ResourceApprover])
            ]
        ));
        assert!(!requirements_satisfied(
            &fixture_policy("NONE", vec![]),
            a,
            &[]
        ));
    }

    #[test]
    fn owner_reference_keeps_exact_target_version_and_asset_parent() {
        let target = Uuid::new_v4();
        let owner = Uuid::new_v4();
        let reference = AffectedOwnerRef {
            target_type: "RESOURCE".into(),
            target_id: target.to_string(),
            target_version: 7,
            owner_principal_id: owner.to_string(),
        };
        assert!(frozen_matches(
            target,
            Some(7),
            "RESOURCE",
            std::slice::from_ref(&reference)
        ));
        assert!(!frozen_matches(
            target,
            Some(8),
            "RESOURCE",
            std::slice::from_ref(&reference)
        ));
        assert!(!frozen_matches(
            Uuid::new_v4(),
            Some(7),
            "RESOURCE",
            std::slice::from_ref(&reference)
        ));
        let asset = AffectedOwnerRef {
            target_type: "ASSET".into(),
            target_id: Uuid::new_v4().to_string(),
            target_version: 3,
            owner_principal_id: owner.to_string(),
        };
        let id = Uuid::parse_str(&asset.target_id).unwrap();
        assert!(!frozen_matches(
            id,
            Some(3),
            "ASSET",
            std::slice::from_ref(&asset)
        ));
        assert!(frozen_matches(id, Some(3), "ASSET", &[asset, reference]));
    }
}
