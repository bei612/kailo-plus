//! 03 §5、10 §2、17 §8：HUMAN 管理 Installation 自身权限；DD-89 的
//! SERVICE reader 使用同一 Resource/Approval/AE/SpiceDB 派发链。
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
pub(crate) const READ_GRANT: &str = "resource.grant_read";
pub(crate) const READ_REVOKE: &str = "resource.revoke_read";

pub(crate) fn is_grant(action: &str) -> bool {
    matches!(action, GRANT | READ_GRANT)
}

fn is_read(action: &str) -> bool {
    matches!(action, READ_GRANT | READ_REVOKE)
}

fn relation(action: &str) -> &'static str {
    if is_read(action) {
        "reader"
    } else {
        "executor"
    }
}

fn permission(action: &str) -> &'static str {
    if is_read(action) {
        "read"
    } else {
        "execute"
    }
}

#[derive(sqlx::FromRow)]
pub(crate) struct PermissionTarget {
    pub(crate) id: Uuid,
    pub(crate) tenant_id: Uuid,
    pub(crate) workspace_id: Option<Uuid>,
    pub(crate) owner_principal_id: Uuid,
    pub(crate) subject_principal_id: Uuid,
    pub(crate) version: i32,
    projection_action_execution_id: Option<Uuid>,
    read_edge: Option<Value>,
}

async fn installation(
    conn: &mut PgConnection,
    tenant: Uuid,
    id: Uuid,
    lock: bool,
) -> Result<Option<PermissionTarget>, sqlx::Error> {
    sqlx::query_as(&format!("select r.id,r.tenant_id,i.workspace_id,r.owner_principal_id,
        i.agent_principal_id as subject_principal_id,r.version,r.projection_action_execution_id,
        null::jsonb as read_edge
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
          and i.state in ('ACTIVE','DRAINING') and i.active_projection_generation is not null
          and (r.projection_action_execution_id is null or exists (
            select 1 from admission.action_execution ae where ae.id=r.projection_action_execution_id
              and ae.tenant_id=r.tenant_id and ae.workspace_id=w.id and ae.target_id=r.id
              and ae.action_key in ('agent.installation.execute.grant','agent.installation.execute.revoke',
                'resource.grant_read','resource.revoke_read','agent.installation.upgrade')))
        {}", if lock { "for update of r,i,w,a,p,tm" } else { "" }))
        .bind(id).bind(tenant).fetch_optional(conn).await
}

pub(super) fn valid_receiver_reference(value: Option<&Value>) -> bool {
    value.is_none_or(|value| receiver_reference(value).is_ok())
}

fn receiver_reference(value: &Value) -> Result<(Uuid, i32), Refusal> {
    let object = value.as_object().ok_or_else(conflict)?;
    if object.len() != 2 || !object.contains_key("id") || !object.contains_key("version") {
        return Err(conflict());
    }
    let id = value["id"]
        .as_str()
        .and_then(|value| Uuid::parse_str(value).ok())
        .filter(|id| !id.is_nil())
        .ok_or_else(conflict)?;
    let version = value["version"]
        .as_i64()
        .and_then(|value| i32::try_from(value).ok())
        .filter(|version| *version > 0)
        .ok_or_else(conflict)?;
    Ok((id, version))
}

/// DD-89 uses the same source Resource projection and AE as the original reader
/// grant. The recipient is discovered through its Resource, never caller credentials.
async fn permission_target(
    conn: &mut PgConnection,
    tenant: Uuid,
    id: Uuid,
    params: &Params,
    lock: bool,
    projected: Option<Uuid>,
) -> Result<PermissionTarget, Refusal> {
    let Some(reference) = &params.receiver_resource else {
        return installation(conn, tenant, id, lock)
            .await?
            .ok_or_else(conflict);
    };
    let (receiver, version) = receiver_reference(reference)?;
    // A Resource may be both source and receiver. Only this AE's prewrite may
    // account for its version increment; the approved reference stays unchanged.
    let receiver_version = if receiver == id && projected.is_some() {
        version.checked_add(1).ok_or_else(conflict)?
    } else {
        version
    };
    if lock {
        // Reciprocal source/receiver grants take the same resource order.
        let _: Vec<Uuid> = sqlx::query_scalar(
            "select id from catalog.resource
            where tenant_id=$1 and id=any($2) order by id for update",
        )
        .bind(tenant)
        .bind(vec![id, receiver])
        .fetch_all(&mut *conn)
        .await?;
    }
    let row: PermissionTarget = sqlx::query_as("select r.id,r.tenant_id,r.home_workspace_id as workspace_id,
        r.owner_principal_id,br.service_principal_id as subject_principal_id,r.version,
        r.projection_action_execution_id,
        jsonb_build_object('receiverResourceId',rr.id,'receiverResourceVersion',$4::integer,
          'receiverOwnerPrincipalId',rr.owner_principal_id,'receiverWorkspaceId',rr.home_workspace_id,
          'receiverBindingId',br.id,'receiverBindingVersion',br.version,
          'receiverGeneration',br.active_projection_generation,'receiverReleaseId',br.component_release_id,
          'sourceBindingId',bs.id,'sourceBindingVersion',bs.version,
          'sourceGeneration',bs.active_projection_generation,'sourceReleaseId',bs.component_release_id) as read_edge
        from catalog.resource r
        join identity.tenant t on t.id=r.tenant_id and t.state='ACTIVE'
        join identity.principal owner on owner.id=r.owner_principal_id and owner.tenant_id=t.id
          and owner.kind='HUMAN' and owner.status='ACTIVE'
        join identity.tenant_membership membership on membership.tenant_principal_id=owner.id
          and membership.tenant_id=t.id and membership.state='ACTIVE'
        join catalog.application_binding bs on bs.id=r.application_binding_id and bs.tenant_id=t.id and bs.state='ACTIVE'
        join identity.service_principal source_service on source_service.principal_id=bs.service_principal_id
          and source_service.component_binding_kind='APPLICATION' and source_service.component_binding_id=bs.id
        join identity.principal source_principal on source_principal.id=source_service.principal_id
          and source_principal.tenant_id=t.id and source_principal.kind='SERVICE' and source_principal.status='ACTIVE'
        join catalog.component_release source_release on source_release.id=bs.component_release_id and source_release.status='APPROVED'
        join projection.application_runtime source_runtime on source_runtime.binding_id=bs.id
          and source_runtime.generation=bs.active_projection_generation and source_runtime.state='ACTIVE'
          and source_runtime.component_release_id=bs.component_release_id
        join catalog.resource_type_definition source_type on source_type.id=r.resource_type_definition_id
          and source_type.type_key=r.type_key and source_type.component_release_id=bs.component_release_id and source_type.status='ACTIVE'
        join catalog.resource rr on rr.id=$3 and rr.tenant_id=t.id and rr.version=$5 and rr.state='ACTIVE'
          and (rr.projection_action_execution_id is null or
            (rr.id=r.id and rr.projection_action_execution_id=$6::uuid))
        join catalog.application_binding br on br.id=rr.application_binding_id and br.tenant_id=t.id and br.state='ACTIVE'
        join identity.service_principal service on service.principal_id=br.service_principal_id
          and service.component_binding_kind='APPLICATION' and service.component_binding_id=br.id
        join identity.principal recipient on recipient.id=service.principal_id and recipient.tenant_id=t.id
          and recipient.kind='SERVICE' and recipient.status='ACTIVE'
        join catalog.component_release receiver_release on receiver_release.id=br.component_release_id and receiver_release.status='APPROVED'
        join projection.application_runtime receiver_runtime on receiver_runtime.binding_id=br.id
          and receiver_runtime.generation=br.active_projection_generation and receiver_runtime.state='ACTIVE'
          and receiver_runtime.component_release_id=br.component_release_id
        join catalog.resource_type_definition receiver_type on receiver_type.id=rr.resource_type_definition_id
          and receiver_type.type_key=rr.type_key and receiver_type.component_release_id=br.component_release_id and receiver_type.status='ACTIVE'
        where r.id=$1 and r.tenant_id=$2 and r.state='ACTIVE'
          and (r.home_workspace_id is null or exists(select 1 from identity.workspace w
            where w.id=r.home_workspace_id and w.tenant_id=t.id and w.state='ACTIVE'))
          and (bs.workspace_id is null or exists(select 1 from identity.workspace w
            where w.id=bs.workspace_id and w.tenant_id=t.id and w.state='ACTIVE'))
          and (br.workspace_id is null or r.home_workspace_id is null or br.workspace_id=r.home_workspace_id)
          and (br.workspace_id is null or exists(select 1 from identity.workspace w
            where w.id=br.workspace_id and w.tenant_id=t.id and w.state='ACTIVE'))
          and (rr.home_workspace_id is null or exists(select 1 from identity.workspace w
            where w.id=rr.home_workspace_id and w.tenant_id=t.id and w.state='ACTIVE'))
          and source_release.manifest->'executionConnector'->>'mode'='REMOTE_ADAPTER'
          and source_release.manifest->'executionConnector'->>'adapterProtocolRange'='1'
          and coalesce(source_release.manifest->'executionConnector'->>'actionTokenAudience','') not in ('','NONE')
          and exists(select 1 from jsonb_array_elements(source_release.manifest->'capabilityDeclarations') declaration
            where declaration->>'categoryKey'=source_type.capability_category and declaration->>'readEdge' in ('SOURCE','BOTH'))
          and exists(select 1 from jsonb_array_elements(receiver_release.manifest->'capabilityDeclarations') declaration
            where declaration->>'categoryKey'=receiver_type.capability_category and declaration->>'readEdge' in ('RECEIVER','BOTH'))
          and (r.projection_action_execution_id is null or exists(select 1 from admission.action_execution a
            where a.id=r.projection_action_execution_id and a.tenant_id=t.id and a.target_id=r.id
              and a.workspace_id is not distinct from r.home_workspace_id
              and a.action_key in ('resource.grant_read','resource.revoke_read')))
        for share of t,owner,membership,bs,source_service,source_principal,source_release,source_runtime,source_type,
          br,service,recipient,receiver_release,receiver_runtime,receiver_type")
        .bind(id).bind(tenant).bind(receiver).bind(version).bind(receiver_version).bind(projected)
        .fetch_optional(&mut *conn).await?.ok_or_else(conflict)?;
    if params.principal_id != Some(row.subject_principal_id) {
        return Err(conflict());
    }
    Ok(row)
}

fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}
fn unavailable() -> Refusal {
    Refusal::Unavailable("Resource permission 投影不可核验".into())
}

fn principal_field(row: &PermissionTarget) -> &'static str {
    // Keep already-admitted Installation intents readable without rewriting them.
    if row.read_edge.is_some() {
        "servicePrincipalId"
    } else {
        "agentPrincipalId"
    }
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
    let grant = matches!(
        sem,
        Semantic::AgentInstallationExecuteGrant | Semantic::ResourceGrantRead
    );
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
    let row = permission_target(conn, tenant, id, params, lock, None).await?;
    if Some(row.version) != params.resource_version
        || frozen.is_some_and(|v| v != row.id)
        || (grant && row.projection_action_execution_id.is_some())
        || (is_read(&def.action_key) && params.principal_id != Some(row.subject_principal_id))
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
            if key != "agent.installation.upgrade"
                && key
                    != if is_read(&def.action_key) {
                        READ_GRANT
                    } else {
                        GRANT
                    }
            {
                return Err(conflict());
            }
        }
    }
    Ok(Target {
        id: row.id,
        version: row.version,
        workspace_id: row.workspace_id,
    })
}

async fn projection(g: &Governance, row: &PermissionTarget) -> Result<(), Refusal> {
    let workspace = row.workspace_id.map(|id| id.to_string());
    if !g
        .spicedb
        .resource_projection_matches_in_workspace(
            &row.id.to_string(),
            &row.tenant_id.to_string(),
            &row.owner_principal_id.to_string(),
            workspace.as_deref(),
            g.cfg.relationship_page,
        )
        .await
        .map_err(|_| unavailable())?
    {
        return Err(unavailable());
    }
    if let Some(edge) = &row.read_edge {
        if !g
            .spicedb
            .resource_projection_matches_in_workspace(
                edge["receiverResourceId"]
                    .as_str()
                    .ok_or_else(unavailable)?,
                &row.tenant_id.to_string(),
                edge["receiverOwnerPrincipalId"]
                    .as_str()
                    .ok_or_else(unavailable)?,
                edge["receiverWorkspaceId"].as_str(),
                g.cfg.relationship_page,
            )
            .await
            .map_err(|_| unavailable())?
        {
            return Err(unavailable());
        }
    }
    Ok(())
}

async fn human(
    g: &Governance,
    conn: &mut PgConnection,
    row: &PermissionTarget,
    principal: Uuid,
    action: &str,
) -> Result<(), Refusal> {
    human_scope(g, conn, row.tenant_id, row.workspace_id, principal).await?;
    checked(g, "resource", row.id, "share", principal).await?;
    if let Some(edge) = &row.read_edge {
        let receiver = edge["receiverResourceId"]
            .as_str()
            .and_then(|id| Uuid::parse_str(id).ok())
            .ok_or_else(unavailable)?;
        checked(g, "resource", receiver, "update", principal).await?;
    }
    if !is_read(action) {
        checked(g, "resource", row.id, "execute", principal).await?;
    }
    Ok(())
}

/// The management directory uses exactly the write path's HUMAN scope rule.
pub(crate) async fn human_scope(
    g: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    workspace: Option<Uuid>,
    principal: Uuid,
) -> Result<(), Refusal> {
    if !crate::agent_definition::active_owner(conn, tenant, principal).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    if let Some(workspace_id) = workspace {
        let _: Option<Uuid> = sqlx::query_scalar(
            "select id from identity.workspace_membership
        where workspace_id=$1 and tenant_principal_id=$2 for update",
        )
        .bind(workspace_id)
        .bind(principal)
        .fetch_optional(&mut *conn)
        .await?;
        let member: bool = sqlx::query_scalar(
            "select exists(select 1 from identity.workspace_membership
        where workspace_id=$1 and tenant_principal_id=$2 and state='ACTIVE')",
        )
        .bind(workspace_id)
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
            .bind(workspace_id)
            .bind(principal)
            .fetch_one(&mut *conn)
            .await?;
            checked(
                g,
                if existed { "tenant" } else { "workspace" },
                if existed { tenant } else { workspace_id },
                "manage",
                principal,
            )
            .await?;
        }
    }
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
    action: &str,
) -> Result<(), Refusal> {
    let row = permission_target(
        conn,
        tenant,
        params.resource_id.ok_or_else(conflict)?,
        params,
        false,
        None,
    )
    .await?;
    if Some(row.version) != params.resource_version {
        return Err(conflict());
    }
    projection(g, &row).await?;
    if is_read(action) && params.principal_id != Some(row.subject_principal_id) {
        return Err(conflict());
    }
    human(g, conn, &row, principal, action).await
}

pub(super) async fn evaluate_target(
    g: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    target: &Target,
    action: &str,
) -> Result<(), Refusal> {
    if let Some(row) = installation(conn, tenant, target.id, false).await? {
        if row.version != target.version || row.workspace_id != target.workspace_id {
            return Err(conflict());
        }
        return projection(g, &row).await;
    }
    if !is_read(action) {
        return Err(conflict());
    }
    // The generic evaluator only checks source scope/projection. The same
    // action's gate re-reads the exact receiver and checks update permission.
    let owner: Uuid = sqlx::query_scalar("select r.owner_principal_id from catalog.resource r
        join catalog.application_binding b on b.id=r.application_binding_id and b.tenant_id=r.tenant_id and b.state='ACTIVE'
        where r.id=$1 and r.tenant_id=$2 and r.version=$3 and r.state='ACTIVE'
          and r.home_workspace_id is not distinct from $4::uuid")
        .bind(target.id).bind(tenant).bind(target.version).bind(target.workspace_id)
        .fetch_optional(conn).await?.ok_or_else(conflict)?;
    let workspace = target.workspace_id.map(|id| id.to_string());
    if !g
        .spicedb
        .resource_projection_matches_in_workspace(
            &target.id.to_string(),
            &tenant.to_string(),
            &owner.to_string(),
            workspace.as_deref(),
            g.cfg.relationship_page,
        )
        .await
        .map_err(|_| unavailable())?
    {
        return Err(unavailable());
    }
    Ok(())
}

/// The only TARGET_OWNER consumer introduced here. No fallback to current owner.
pub(super) fn owner_policy(action: &str, policy: &super::Policy) -> bool {
    is_grant(action)
        && policy.owner_requirement == "TARGET_OWNER"
        && policy.self_approval == "ALLOW"
        && policy.role_requirements.is_empty()
}

pub(super) fn frozen_owner(ae: &Execution) -> Result<contracts::AffectedOwnerRef, Refusal> {
    let parameters = ae.parameters.as_ref().ok_or_else(unavailable)?;
    let owner: contracts::AffectedOwnerRef =
        serde_json::from_value(parameters["permissionApprovalOwner"].clone())
            .map_err(|_| unavailable())?;
    if !is_grant(&ae.action_key)
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
    let params = ae.params().ok_or_else(unavailable)?;
    let row = permission_target(
        conn,
        ae.tenant_id,
        ae.target_id,
        &params,
        true,
        projected.then_some(ae.id),
    )
    .await?;
    let version = owner
        .target_version
        .checked_add(i64::from(projected))
        .ok_or_else(conflict)?;
    if i64::from(row.version) != version
        || row.owner_principal_id.to_string() != owner.owner_principal_id
        || row.workspace_id != ae.workspace_id
        || row.projection_action_execution_id != if projected { Some(ae.id) } else { None }
        || ae
            .parameters
            .as_ref()
            .and_then(|value| value.get("permissionReadEdge"))
            != row.read_edge.as_ref()
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
    if ae.tenant_id != tenant || !is_grant(&ae.action_key) {
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
    ae: &Execution,
) -> Result<contracts::AffectedOwnerRef, Refusal> {
    let params = ae.params().ok_or_else(unavailable)?;
    let row = permission_target(conn, ae.tenant_id, ae.target_id, &params, true, None).await?;
    if row.projection_action_execution_id.is_some() {
        return Err(conflict());
    }
    projection(g, &row).await?;
    if let Some(edge) = &row.read_edge {
        sqlx::query("update admission.action_execution set parameters=jsonb_set(parameters,'{permissionReadEdge}',$2)
            where id=$1 and not (parameters ? 'permissionReadEdge')")
            .bind(ae.id).bind(edge).execute(&mut *conn).await?;
        let frozen: Value = sqlx::query_scalar(
            "select parameters->'permissionReadEdge' from admission.action_execution where id=$1",
        )
        .bind(ae.id)
        .fetch_one(&mut *conn)
        .await?;
        if frozen != *edge {
            return Err(conflict());
        }
    }
    Ok(contracts::AffectedOwnerRef {
        target_type: "RESOURCE".into(),
        target_id: row.id.to_string(),
        target_version: i64::from(row.version),
        owner_principal_id: row.owner_principal_id.to_string(),
    })
}

/// Before opening a revoke, cancel only this exact PermissionTarget's pending grants.
/// Locks are original AE→Tenant→Workspace/Resource, not Tenant→another AE.
pub(super) async fn prepare_revoke(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    actor: Actor,
    params: &Params,
    action: &str,
) -> Result<Vec<Uuid>, Refusal> {
    let id = params.resource_id.ok_or_else(conflict)?;
    let ids: Vec<Uuid> = sqlx::query_scalar("select id from admission.action_execution
        where tenant_id=$1 and target_id=$2 and action_key=$3
          and ($4::uuid is null or parameters->'params'->>'principalId'=$4::uuid::text)
          and (gate_state in ('EVALUATING','WAITING') or (gate_state='ALLOWED' and dispatch_state in ('NOT_DISPATCHED','UNKNOWN')))
        order by id for update")
        .bind(actor.tenant_id).bind(id).bind(if is_read(action) { READ_GRANT } else { GRANT })
        .bind(if is_read(action) { params.principal_id } else { None })
        .fetch_all(&mut **tx).await?;
    if !crate::roles::lock_tenant(tx, actor.tenant_id).await? {
        return Err(conflict());
    }
    let row = permission_target(tx, actor.tenant_id, id, params, true, None).await?;
    if Some(row.version) != params.resource_version {
        return Err(conflict());
    }
    if row.read_edge.is_some()
        && row
            .projection_action_execution_id
            .is_some_and(|id| !ids.contains(&id))
    {
        return Err(conflict());
    }
    projection(g, &row).await?;
    if is_read(action) && params.principal_id != Some(row.subject_principal_id) {
        return Err(conflict());
    }
    human(g, tx, &row, actor.principal_id, action).await?;
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
    let params = ae.params().ok_or_else(unavailable)?;
    let row = permission_target(tx, ae.tenant_id, ae.target_id, &params, true, None).await?;
    if row.version != version || row.workspace_id != ae.workspace_id {
        return Err(conflict());
    }
    if is_grant(&ae.action_key)
        && ae
            .parameters
            .as_ref()
            .and_then(|value| value.get("permissionReadEdge"))
            != row.read_edge.as_ref()
    {
        return Err(conflict());
    }
    let interrupted: Option<Uuid> = if let Some(pending) = row.projection_action_execution_id {
        sqlx::query_scalar(
            "select id from admission.action_execution where id=$1
            and action_key='agent.installation.upgrade' and gate_state='ALLOWED'",
        )
        .bind(pending)
        .fetch_optional(&mut **tx)
        .await?
    } else {
        None
    };
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
    let mut intent = json!({"resourceVersion":version,
            "ownerPrincipalId":row.owner_principal_id,
            "interruptedProjectionActionExecutionId":interrupted});
    intent[principal_field(&row)] = json!(row.subject_principal_id);
    if let Some(edge) = &row.read_edge {
        intent["readEdge"] = edge.clone();
    }
    sqlx::query("update admission.action_execution set parameters=jsonb_set(parameters,'{permissionIntent}',$2),updated_at=now() where id=$1")
        .bind(ae.id).bind(intent).execute(&mut **tx).await?;
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
            .bind(row.tenant_id).bind(row.id).bind(row.workspace_id).bind(row.subject_principal_id)
            .execute(&mut **tx).await?;
    }
    Ok(())
}

async fn held(g: &Governance, row: &PermissionTarget, relation: &str) -> Result<bool, Refusal> {
    let resource = row.id.to_string();
    let agent = row.subject_principal_id.to_string();
    let rels = g
        .spicedb
        .read(
            &RelationshipFilter {
                object_type: "resource",
                object_id: Some(&resource),
                relation: Some(relation),
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
                || r.relation != relation
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
    let params = ae.params().ok_or_else(unavailable)?;
    let row = permission_target(
        &mut tx,
        ae.tenant_id,
        ae.target_id,
        &params,
        true,
        Some(ae.id),
    )
    .await?;
    let intent = &ae.parameters.as_ref().ok_or_else(unavailable)?["permissionIntent"];
    if row.projection_action_execution_id != Some(id)
        || row.workspace_id != ae.workspace_id
        || intent["resourceVersion"].as_i64() != Some(i64::from(row.version))
        || intent[principal_field(&row)].as_str()
            != Some(row.subject_principal_id.to_string().as_str())
        || intent["ownerPrincipalId"].as_str() != Some(row.owner_principal_id.to_string().as_str())
        || intent.get("readEdge") != row.read_edge.as_ref()
    {
        return Err(conflict());
    }
    projection(g, &row).await?;
    let fresh = async {
        human(g, &mut tx, &row, ae.initiator_principal_id, &ae.action_key).await?;
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
            restore_projection_intent(&mut tx, &row, &ae).await?;
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
            relation: relation(&ae.action_key).into(),
            subject_principal: row.subject_principal_id.to_string(),
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
            permission(&ae.action_key),
            &row.subject_principal_id.to_string(),
            token.as_ref().map_or(Consistency::FullyConsistent, |s| {
                Consistency::AtLeastAsFresh(s.as_str())
            }),
        )
        .await
        .map_err(|_| unavailable())?;
    if c.zed_token.is_empty()
        || held(g, &row, relation(&ae.action_key)).await? != grant
        || c.allowed != grant
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
    // An older timed-out native Touch has no operation-status API. Absence after
    // our Delete cannot prove that request will not commit late. Keep the same
    // pending projection fail-closed rather than lift its fence or replay Touch.
    if !grant
        && sqlx::query_scalar::<_, bool>(
            "select exists(select 1 from admission.action_execution
        where tenant_id=$1 and target_id=$2 and action_key=$3
          and gate_state='REVOKED' and dispatch_state='UNKNOWN')",
        )
        .bind(ae.tenant_id)
        .bind(ae.target_id)
        .bind(if is_read(&ae.action_key) {
            READ_GRANT
        } else {
            GRANT
        })
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
    restore_projection_intent(&mut tx, &row, &ae).await?;
    sqlx::query("update admission.action_execution set dispatch_state='DISPATCHED',reason_code=null,updated_at=now() where id=$1")
        .bind(id).execute(&mut *tx).await?;
    let mut evidence = zed_evidence(Some(&c.zed_token));
    evidence.push(crate::audit::Evidence::new(
        EvidenceKind::SpicedbRelationship,
        format!(
            "resource:{}#{}@principal:{}",
            row.id,
            relation(&ae.action_key),
            row.subject_principal_id
        ),
    ));
    audit(
        &mut tx,
        &ae,
        def,
        "permission-outcome",
        "OUTCOME",
        "ALLOW",
        if row.read_edge.is_some() && grant {
            "SERVICE_READ_GRANTED"
        } else if row.read_edge.is_some() {
            "SERVICE_READ_REVOKED"
        } else if is_read(&ae.action_key) && grant {
            "INSTALLATION_READ_GRANTED"
        } else if is_read(&ae.action_key) {
            "INSTALLATION_READ_REVOKED"
        } else if grant {
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

async fn restore_projection_intent(
    tx: &mut Transaction<'_, Postgres>,
    row: &PermissionTarget,
    ae: &Execution,
) -> Result<(), Refusal> {
    let previous = ae
        .parameters
        .as_ref()
        .and_then(|p| p.get("permissionIntent"))
        .and_then(|p| p.get("interruptedProjectionActionExecutionId"))
        .filter(|v| !v.is_null())
        .map(|v| {
            v.as_str()
                .and_then(|s| Uuid::parse_str(s).ok())
                .ok_or_else(conflict)
        })
        .transpose()?;
    // Only an already admitted upgrade can be resumed. Revocation never
    // invents or clears that original action, nor rewrites its parameters.
    if let Some(previous) = previous {
        let valid: bool = sqlx::query_scalar("select exists(select 1 from admission.action_execution a
            join catalog.agent_installation i on i.resource_id=a.target_id
            where a.id=$1 and a.target_id=$2 and a.tenant_id=$3 and a.workspace_id=$4
              and a.action_key='agent.installation.upgrade' and a.gate_state='ALLOWED' and i.state='DRAINING')")
            .bind(previous).bind(row.id).bind(row.tenant_id).bind(row.workspace_id).fetch_one(&mut **tx).await?;
        if !valid {
            return Err(conflict());
        }
    }
    let changed = sqlx::query(
        "update catalog.resource set projection_action_execution_id=$4
        where id=$1 and projection_action_execution_id=$2 and version=$3",
    )
    .bind(row.id)
    .bind(ae.id)
    .bind(row.version)
    .bind(previous)
    .execute(&mut **tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(conflict());
    }
    Ok(())
}

pub(crate) async fn view(
    g: &Governance,
    tenant: Uuid,
    principal: Uuid,
    id: Uuid,
) -> Result<Option<Value>, Refusal> {
    permission_view(g, tenant, principal, id, GRANT, REVOKE).await
}

pub(crate) async fn read_view(
    g: &Governance,
    tenant: Uuid,
    principal: Uuid,
    id: Uuid,
) -> Result<Option<Value>, Refusal> {
    permission_view(g, tenant, principal, id, READ_GRANT, READ_REVOKE).await
}

async fn permission_view(
    g: &Governance,
    tenant: Uuid,
    principal: Uuid,
    id: Uuid,
    grant_key: &str,
    revoke_key: &str,
) -> Result<Option<Value>, Refusal> {
    let mut conn = g.pool.acquire().await?;
    let Some(row) = installation(&mut conn, tenant, id, false).await? else {
        return Ok(None);
    };
    projection(g, &row).await?;
    let requested = held(g, &row, relation(grant_key)).await?;
    let c = g
        .spicedb
        .check(
            "resource",
            &id.to_string(),
            permission(grant_key),
            &row.subject_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| unavailable())?;
    if c.zed_token.is_empty() {
        return Err(unavailable());
    }
    let can_manage = match human(g, &mut conn, &row, principal, grant_key).await {
        Ok(()) => true,
        Err(Refusal::Denied(_)) => false,
        Err(e) => return Err(e),
    };
    let mut enabled = Vec::new();
    for key in [grant_key, revoke_key] {
        enabled.push(
            crate::capability_registry::action_exposed(key)
                && super::active_definition(&g.pool, key).await?.is_some(),
        );
    }
    let mut result = json!({"requested":requested,"effective":c.allowed && row.projection_action_execution_id.is_none(),
    "canGrant":can_manage && enabled[0] && row.projection_action_execution_id.is_none() && !requested,
    "canRevoke":can_manage && enabled[1] && match row.projection_action_execution_id {
        None => true,
        Some(pending) => {
            let key = sqlx::query_scalar::<_, String>("select action_key from admission.action_execution where id=$1 and tenant_id=$2")
                .bind(pending).bind(tenant).fetch_one(&mut *conn).await?;
            key == grant_key || key == "agent.installation.upgrade"
        },
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
    fn service_receiver_reference_is_closed_versioned_and_optional_for_legacy() {
        let id = Uuid::new_v4();
        assert!(valid_receiver_reference(None));
        assert!(valid_receiver_reference(Some(
            &json!({"id":id,"version":1})
        )));
        for value in [
            json!({"id":id}),
            json!({"id":id,"version":0}),
            json!({"id":id,"version":i64::MAX}),
            json!({"id":Uuid::nil(),"version":1}),
            json!({"id":id,"version":1,"bindingId":Uuid::new_v4()}),
            json!({"id":id,"version":1,"secret":"not-accepted"}),
            Value::Null,
        ] {
            assert!(!valid_receiver_reference(Some(&value)), "{value}");
        }
    }

    #[test]
    fn service_receiver_survives_params_hash_input_without_changing_legacy_intents() {
        let mut command: contracts::ActionCommand = serde_json::from_value(json!({
            "actionKey":READ_GRANT,"idempotencyKey":Uuid::new_v4(),
            "resourceId":Uuid::new_v4(),"resourceVersion":4,
            "principalId":Uuid::new_v4(),
            "receiverResource":{"id":Uuid::new_v4(),"version":7}
        }))
        .unwrap();
        let params = super::super::parse_command(Semantic::ResourceGrantRead, &command).unwrap();
        let value = params.to_json();
        assert_eq!(value["receiverResource"]["version"], 7);
        assert_eq!(Params::from_json(&value).unwrap().to_json(), value);
        command.action_key = GRANT.into();
        command.principal_id = None;
        assert!(
            super::super::parse_command(Semantic::AgentInstallationExecuteGrant, &command).is_err()
        );
        command.action_key = READ_REVOKE.into();
        command.principal_id = Some(Uuid::new_v4().to_string());
        assert!(super::super::parse_command(Semantic::ResourceRevokeRead, &command).is_err());
        command.explicit_confirmation = Some(true);
        assert!(super::super::parse_command(Semantic::ResourceRevokeRead, &command).is_ok());
        command.receiver_resource = None;
        let legacy = super::super::parse_command(Semantic::ResourceRevokeRead, &command).unwrap();
        assert!(legacy.to_json().get("receiverResource").is_none());

        let mut row = PermissionTarget {
            id: Uuid::new_v4(),
            tenant_id: Uuid::new_v4(),
            workspace_id: None,
            owner_principal_id: Uuid::new_v4(),
            subject_principal_id: Uuid::new_v4(),
            version: 1,
            projection_action_execution_id: None,
            read_edge: None,
        };
        assert_eq!(principal_field(&row), "agentPrincipalId");
        row.read_edge = Some(json!({"receiverResourceId":Uuid::new_v4()}));
        assert_eq!(principal_field(&row), "servicePrincipalId");
    }

    /// Uses the existing isolated migrated DB only. No business objects or
    /// permissions are inserted: exercise PostgreSQL's real joins/types and
    /// prove an absent receiver is a conflict, not a fabricated grant.
    #[tokio::test]
    #[ignore = "requires isolated SERVICE_PERMISSION_TEST_DATABASE_URL"]
    async fn service_receiver_sql_rejects_absence_in_migrated_database() {
        use sqlx::Connection;
        let url = std::env::var("SERVICE_PERMISSION_TEST_DATABASE_URL")
            .expect("isolated DB configuration");
        let mut conn = sqlx::PgConnection::connect(&url).await.unwrap();
        let command: contracts::ActionCommand = serde_json::from_value(json!({
            "actionKey":READ_GRANT,"idempotencyKey":Uuid::new_v4(),
            "resourceId":Uuid::new_v4(),"resourceVersion":1,"principalId":Uuid::new_v4(),
            "receiverResource":{"id":Uuid::new_v4(),"version":1}
        }))
        .unwrap();
        let params = super::super::parse_command(Semantic::ResourceGrantRead, &command).unwrap();
        let result = permission_target(
            &mut conn,
            Uuid::new_v4(),
            params.resource_id.unwrap(),
            &params,
            true,
            None,
        )
        .await;
        assert!(
            matches!(result, Err(Refusal::Conflict(_))),
            "missing Resource must fail closed with valid SQL"
        );
    }

    #[test]
    fn only_exact_installation_permission_grants_resolve_target_owner() {
        let policy = super::super::Policy {
            id: Uuid::new_v4(),
            version: 1,
            role_requirements: Vec::new(),
            owner_requirement: "TARGET_OWNER".into(),
            self_approval: "ALLOW".into(),
            expires_in_seconds: 1,
        };
        assert!(owner_policy(GRANT, &policy));
        assert!(owner_policy(READ_GRANT, &policy));
        for action in [REVOKE, READ_REVOKE, "resource.transfer_owner", "unknown"] {
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
