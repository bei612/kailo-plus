//! DD-24/49/99/105: ToolDefinition is a Resource extension in the existing
//! Catalog. Its read consumers never create Resources or grant permissions.
//! DD-122: the only Agent Tool grant is the admitted Installation projection
//! (`provision`); revocation follows the upgrade drain and binding disable.

use contracts::ReasonCode;
use serde_json::Value;
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use crate::governance::{Definition, Execution, Governance, Refusal};
use crate::spicedb::{Consistency, Relationship, RelationshipFilter, Write};

const MEMORY_LIST: &str = "agent.memory.entry.list";
const MEMORY_READ: &str = "agent.memory.entry.read";
/// DD-122 (1): the PLATFORM_NATIVE tool set fixed by this platform build.
pub(crate) const NATIVE_TOOLS: [&str; 2] = [MEMORY_LIST, MEMORY_READ];
/// DD-122 (3): the Agent relationships written on each granted Tool.
const TOOL_RELATIONS: [(&str, &str); 2] = [("discoverer", "discover"), ("consumer", "consume")];
/// Upper bound of relationship updates in one native write request.
const RELATION_WRITE_BATCH: usize = 100;

/// DD-122 (1): one stable Resource ID per business Tenant and native tool name,
/// so a re-run bootstrap converges on the same row instead of minting another.
pub(crate) fn native_tool_id(tenant: Uuid, name: &str) -> Uuid {
    Uuid::new_v5(&tenant, name.as_bytes())
}

fn relationship(object: Uuid, relation: &str, subject: Uuid) -> Relationship {
    Relationship {
        object_type: "resource".into(),
        object_id: object.to_string(),
        relation: relation.into(),
        subject_principal: subject.to_string(),
    }
}

fn unknown(what: &str) -> Refusal {
    Refusal::Unavailable(format!("{what} 结果不明"))
}

/// DD-122 (5): the Agent and the Installation owner hold the Tool rights, as
/// for llm_route. The initiating member only needs the DelegationScope, the
/// target contract permission and `delegate`, never a Tool permission.
pub(crate) async fn agent_rights(
    gov: &Governance,
    tool: Uuid,
    agent: Uuid,
    owner: Uuid,
) -> Result<(), Refusal> {
    permission(gov, tool, agent, "discover").await?;
    permission(gov, tool, agent, "consume").await?;
    permission(gov, tool, owner, "consume").await?;
    Ok(())
}

/// Current active HUMAN owner of the Installation; Tool calls never fall back
/// to the initiator when the owner has left or been disabled.
pub(crate) async fn installation_owner(
    conn: &mut PgConnection,
    tenant: Uuid,
    installation: Uuid,
) -> Result<Uuid, Refusal> {
    sqlx::query_scalar(
        "select r.owner_principal_id from catalog.resource r
        join identity.principal o on o.id=r.owner_principal_id and o.tenant_id=r.tenant_id
          and o.kind='HUMAN' and o.status='ACTIVE'
        join identity.tenant_membership m on m.tenant_principal_id=o.id
          and m.tenant_id=r.tenant_id and m.state='ACTIVE'
        where r.id=$1 and r.tenant_id=$2 and r.type_key='agent.installation'",
    )
    .bind(installation)
    .bind(tenant)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(Refusal::Denied(ReasonCode::ScopeGuardFailed))
}

/// The same registered Tool permission check is used by install and PEP.
pub(crate) async fn permission(
    gov: &Governance,
    tool: Uuid,
    subject: Uuid,
    permission: &str,
) -> Result<String, Refusal> {
    let proof = gov
        .spicedb
        .check(
            "resource",
            &tool.to_string(),
            permission,
            &subject.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Tool fresh permission 不可核验".into()))?;
    if proof.zed_token.is_empty() {
        return Err(Refusal::Unavailable(
            "Tool permission 缺 checked revision".into(),
        ));
    }
    if !proof.allowed {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    Ok(proof.zed_token)
}

/// Candidate discovery and installation use the same registered native tools.
/// DD-122 (3): the initiator's Tool rights are decided by `provision`; a
/// denial keeps the ToolBinding NO_PERMISSION and never blocks installation.
/// This only resolves references; it creates no binding or permission.
pub(crate) async fn installation_references(
    gov: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    human: Uuid,
    tools: &[String],
) -> Result<Vec<Uuid>, Refusal> {
    if !crate::agent_definition::active_owner(conn, tenant, human).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let mut references = Vec::with_capacity(tools.len());
    for id in tools {
        let id = Uuid::parse_str(id)
            .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?;
        registered(gov, conn, tenant, id).await?;
        references.push(id);
    }
    Ok(references)
}

/// 03/17: a binding is visibility configuration. It never writes a consumer,
/// discoverer or reader relationship, and does not borrow installation rights;
/// DD-122 grants happen only in `provision` of the admitted generation.
pub(crate) async fn install_bindings(
    gov: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    version: Uuid,
    generation: i64,
    tools: &[String],
) -> Result<(), Refusal> {
    for id in
        installation_references(gov, tx, ae.tenant_id, ae.initiator_principal_id, tools).await?
    {
        sqlx::query(
            "insert into catalog.tool_binding(installation_resource_id,projection_generation,
            workspace_id,agent_version_asset_id,tool_resource_id,action_execution_id,status)
            values($1,$2,$3,$4,$5,$6,'NO_PERMISSION')",
        )
        .bind(ae.target_id)
        .bind(generation)
        .bind(ae.workspace_id)
        .bind(version)
        .bind(id)
        .bind(ae.id)
        .execute(&mut **tx)
        .await?;
    }
    crate::application_tool::resolve_installation(tx, ae.tenant_id, ae.target_id, generation)
        .await?;
    Ok(())
}

#[derive(Clone, sqlx::FromRow)]
pub(crate) struct BoundTool {
    pub(crate) resource_id: Uuid,
    pub(crate) name: String,
    pub(crate) action_key: String,
    pub(crate) input_schema_hash: String,
    pub(crate) output_schema_hash: String,
}

pub(crate) async fn bound_tools(
    gov: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    installation: Uuid,
    generation: i64,
    agent: Uuid,
) -> Result<Vec<BoundTool>, Refusal> {
    let rows: Vec<BoundTool> = sqlx::query_as("select t.resource_id,t.name,t.action_key,
        t.input_schema_hash,t.output_schema_hash from catalog.tool_binding b
        join catalog.tool_definition t on t.resource_id=b.tool_resource_id and t.status='ACTIVE'
        join catalog.resource r on r.id=t.resource_id and r.tenant_id=$1 and r.state='ACTIVE'
          and r.type_key='tool.definition' and r.projection_action_execution_id is null
        join catalog.agent_installation i on i.resource_id=b.installation_resource_id
        join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
          and p.generation=b.projection_generation and p.agent_version_asset_id=b.agent_version_asset_id
        join catalog.agent_version v on v.asset_id=b.agent_version_asset_id
        where b.installation_resource_id=$2 and b.projection_generation=$3
          and i.agent_principal_id=$4 and i.workspace_id=b.workspace_id
          and p.state='ACTIVE'
          and v.content->'declaredToolResourceIds' @> jsonb_build_array(t.resource_id::text)
          and b.status in ('NO_PERMISSION','ACTIVE') and t.source='PLATFORM_NATIVE'
          and t.backend_ref='CORE_STREAMABLE_MCP' order by t.resource_id")
        .bind(tenant).bind(installation).bind(generation).bind(agent).fetch_all(&mut *conn).await?;
    let mut names = std::collections::HashSet::new();
    let mut allowed = Vec::new();
    for row in rows {
        let hashes = schema_hashes(&row.name)?;
        if row.action_key != row.name
            || hashes
                != (
                    row.input_schema_hash.clone(),
                    row.output_schema_hash.clone(),
                )
            || !names.insert(row.name.clone())
        {
            return Err(Refusal::Unavailable(
                "ToolBinding schema/name 不唯一或不一致".into(),
            ));
        }
        let check = async {
            permission(gov, row.resource_id, agent, "discover").await?;
            permission(gov, row.resource_id, agent, "consume").await?;
            Ok::<(), Refusal>(())
        }
        .await;
        match check {
            Ok(()) => allowed.push(row),
            Err(Refusal::Denied(_)) => {}
            Err(e) => return Err(e),
        }
    }
    Ok(allowed)
}

#[derive(sqlx::FromRow)]
pub(crate) struct InvocationContext {
    pub(crate) id: Uuid,
    pub(crate) tenant_id: Uuid,
    pub(crate) workspace_id: Uuid,
    pub(crate) installation_resource_id: Uuid,
    pub(crate) projection_generation: i64,
    pub(crate) delegation_id: Uuid,
    pub(crate) runtime_turn_id: Option<String>,
    pub(crate) parent_action_execution_id: Uuid,
    pub(crate) agent_principal_id: Uuid,
}

pub(crate) async fn invocation_context(
    state: &crate::service_api::ServiceState,
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    calling: bool,
) -> Result<(InvocationContext, Execution), Refusal> {
    let context: InvocationContext = sqlx::query_as("select i.id,i.tenant_id,i.workspace_id,
        i.installation_resource_id,i.projection_generation,i.delegation_id,i.runtime_turn_id,
        i.action_execution_id parent_action_execution_id,installed.agent_principal_id
        from catalog.agent_invocation i join catalog.agent_installation installed
          on installed.resource_id=i.installation_resource_id and installed.workspace_id=i.workspace_id
        join catalog.agent_session s on s.tenant_id=i.tenant_id and s.workspace_id=i.workspace_id
          and s.root_event_id=i.root_event_id and s.installation_resource_id=i.installation_resource_id
          and s.agent_version_asset_id=i.agent_version_asset_id and s.projection_generation=i.projection_generation
        where i.id=$1 and i.reply_event_id is null and not i.cancel_pending
          and ((i.status='RUNNING' and i.native_status='inProgress' and i.runtime_turn_id is not null
               and s.status='ACTIVE' and s.runtime_thread_id is not null)
            or (not $2 and i.status in ('CREATED','DISPATCHING') and i.runtime_turn_id is null
               and s.status in ('PENDING','STARTING','ACTIVE')))")
        .bind(id).bind(calling).fetch_optional(&mut **tx).await?.ok_or(Refusal::Denied(ReasonCode::ScopeGuardFailed))?;
    let parent = crate::governance::lock_execution(tx, context.parent_action_execution_id).await?;
    if let Some(turn) = &context.runtime_turn_id {
        crate::agent_invocation::fresh_tool(state, tx, id, turn).await?;
    } else if !calling {
        crate::agent_invocation::fresh_invocation(state, tx, id).await?;
    } else {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    if parent.tenant_id != context.tenant_id
        || parent.workspace_id != Some(context.workspace_id)
        || parent.actor_principal_id != context.agent_principal_id
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    Ok((context, parent))
}

/// Actual directory consumer for native MCP. Service authentication or a
/// caller-supplied UUID cannot substitute for the original live Invocation.
pub(crate) async fn invocation_tools(
    state: &crate::service_api::ServiceState,
    invocation: Uuid,
) -> Result<Vec<String>, Refusal> {
    let mut tx = state.pool.begin().await?;
    let (context, parent) = invocation_context(state, &mut tx, invocation, false).await?;
    let rows = bound_tools(
        &state.governance,
        &mut tx,
        context.tenant_id,
        context.installation_resource_id,
        context.projection_generation,
        context.agent_principal_id,
    )
    .await?;
    let mut names = Vec::new();
    for tool in rows {
        let def = crate::agent_memory::read_definition(&state.pool, &tool.action_key).await?;
        match tool_admission(state, &mut tx, &context, &parent, &tool, &def).await {
            Ok(_) => names.push(tool.name),
            Err(Refusal::Denied(_) | Refusal::Blocked(_) | Refusal::Conflict(_)) => {}
            Err(e) => return Err(e),
        }
    }
    tx.commit().await?;
    Ok(names)
}

/// A signed Session is identity, not authority. Resolve its exact frozen
/// version/generation and the one admitted Invocation; never select a latest
/// Installation pin or borrow another thread's in-flight turn.
pub(crate) async fn session_invocation(
    state: &crate::service_api::ServiceState,
    scope: &crate::agent_tool_session::SessionScope,
    calling: bool,
) -> Result<Uuid, Refusal> {
    let mut tx = state.pool.begin().await?;
    let ids: Vec<Uuid> = sqlx::query_scalar("select i.id from catalog.agent_invocation i
        join catalog.agent_session s on s.tenant_id=i.tenant_id and s.workspace_id=i.workspace_id
          and s.root_event_id=i.root_event_id and s.installation_resource_id=i.installation_resource_id
          and s.agent_version_asset_id=i.agent_version_asset_id and s.projection_generation=i.projection_generation
        join catalog.agent_installation installed on installed.resource_id=i.installation_resource_id
          and installed.workspace_id=i.workspace_id and installed.agent_principal_id=$4
        where i.tenant_id=$1 and i.workspace_id=$2 and i.installation_resource_id=$3
          and i.agent_version_asset_id=$5 and i.projection_generation=$6 and i.root_event_id=$7
          and i.status in ('CREATED','DISPATCHING','RUNNING') and i.reply_event_id is null
          and not i.cancel_pending order by i.id limit 2")
        .bind(scope.tenant_id).bind(scope.workspace_id).bind(scope.installation_resource_id)
        .bind(scope.agent_principal_id).bind(scope.agent_version_asset_id)
        .bind(scope.projection_generation).bind(&scope.root_event_id).fetch_all(&mut *tx).await?;
    let [id] = ids.as_slice() else {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    };
    invocation_context(state, &mut tx, *id, calling).await?;
    tx.commit().await?;
    Ok(*id)
}

pub(crate) async fn tool_admission(
    state: &crate::service_api::ServiceState,
    tx: &mut Transaction<'_, Postgres>,
    context: &InvocationContext,
    parent: &Execution,
    tool: &BoundTool,
    def: &Definition,
) -> Result<String, Refusal> {
    if tool.name != def.action_key
        || parent.id != context.parent_action_execution_id
        || parent.tenant_id != context.tenant_id
        || parent.workspace_id != Some(context.workspace_id)
        || parent.actor_principal_id != context.agent_principal_id
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    // Reuse the parent's actual DelegationUse; another Tool call in this same
    // Operation cannot spend a second use or borrow a different Grant.
    let scope: bool = sqlx::query_scalar("select exists(select 1 from admission.delegation_grant g
        join admission.delegation_scope s on s.delegation_id=g.id
        join catalog.result_exposure_policy p on p.id=s.result_exposure_policy_id
          and p.version=s.result_exposure_policy_version and p.tenant_id=g.tenant_id and p.status='ACTIVE'
        join admission.delegation_use u on u.delegation_id=g.id and u.operation_id=$9
        where g.id=$1 and g.tenant_id=$2 and g.workspace_id=$3 and g.installation_resource_id=$4
          and g.agent_principal_id=$5 and g.grantor_principal_id=$6 and g.state='ACTIVE'
          and g.valid_from<=clock_timestamp() and g.expires_at>clock_timestamp()
          and s.action_key=$7 and s.action_version=$8 and s.target_type='RESOURCE'
          and s.target_id=g.installation_resource_id and s.create_workspace_id is null
          and s.tool_resource_id=$10 and p.mode='CONSUME_ONLY'
          and p.output_schema_hash=$11 and p.redaction_policy='PLATFORM_METADATA_ONLY')")
        .bind(context.delegation_id).bind(context.tenant_id).bind(context.workspace_id)
        .bind(context.installation_resource_id).bind(context.agent_principal_id).bind(parent.initiator_principal_id)
        .bind(&def.action_key).bind(def.version).bind(parent.operation_id).bind(tool.resource_id)
        .bind(&tool.output_schema_hash).fetch_one(&mut **tx).await?;
    if !scope {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    // DD-122 (5): Tool rights belong to the Agent and the Installation owner;
    // the initiator only needs the target contract permission and delegate.
    let owner = installation_owner(tx, context.tenant_id, context.installation_resource_id).await?;
    agent_rights(
        &state.governance,
        tool.resource_id,
        context.agent_principal_id,
        owner,
    )
    .await?;
    for principal in [parent.initiator_principal_id, context.agent_principal_id] {
        permission(
            &state.governance,
            context.installation_resource_id,
            principal,
            "read",
        )
        .await?;
    }
    permission(
        &state.governance,
        context.installation_resource_id,
        parent.initiator_principal_id,
        "delegate",
    )
    .await
}

pub(crate) fn schema_hashes(name: &str) -> Result<(String, String), Refusal> {
    // The authenticated Session, not tool input, supplies the Installation.
    let (input, output) = match name {
        MEMORY_LIST => (
            include_str!("../../../../contracts/domain/agent_memory_entry_list_input.schema.json"),
            include_str!("../../../../contracts/api/agent_memory_entry_page.schema.json"),
        ),
        MEMORY_READ => (
            include_str!("../../../../contracts/domain/agent_memory_entry_read_input.schema.json"),
            include_str!("../../../../contracts/api/agent_memory_read_view.schema.json"),
        ),
        _ => return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)),
    };
    let input: Value =
        serde_json::from_str(input).map_err(|_| Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    let output: Value = serde_json::from_str(output)
        .map_err(|_| Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    Ok((
        collab_bridge::limits::canonical_digest(&input),
        collab_bridge::limits::canonical_digest(&output),
    ))
}

/// 17 §6: a Version may declare the exact registered PLATFORM_NATIVE Resource.
/// This is a requested reference only: it neither installs a ToolBinding nor
/// grants the future Agent a target read permission or a Gateway route.
pub(crate) async fn validate_reference(
    gov: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    human: Uuid,
    tool: Uuid,
) -> Result<(), Refusal> {
    if !crate::agent_definition::active_owner(conn, tenant, human).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let owner = registered(gov, conn, tenant, tool).await?;
    if !crate::agent_definition::active_owner(conn, tenant, owner).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let proof = gov
        .spicedb
        .check(
            "resource",
            &tool.to_string(),
            "consume",
            &human.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Tool reference fresh consume 不可核验".into()))?;
    if proof.zed_token.is_empty() {
        return Err(Refusal::Unavailable(
            "Tool reference 缺 checked revision".into(),
        ));
    }
    if !proof.allowed {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    Ok(())
}

/// The exact registered PLATFORM_NATIVE Resource with its fixed schema hashes
/// and closed tenant/owner projection. Returns the Tool owner; whether that
/// owner is still active is decided by the caller.
async fn registered(
    gov: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    tool: Uuid,
) -> Result<Uuid, Refusal> {
    let name: String = sqlx::query_scalar(
        "select t.name from catalog.tool_definition t
        join catalog.resource r on r.id=t.resource_id where r.id=$1 and r.tenant_id=$2",
    )
    .bind(tool)
    .bind(tenant)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    let (input, output) = schema_hashes(&name)?;
    let owner: Option<Uuid> = sqlx::query_scalar(
        "select r.owner_principal_id
        from catalog.resource r join catalog.tool_definition t on t.resource_id=r.id
        join catalog.resource_type_definition d on d.type_key=r.type_key and d.status='ACTIVE'
        where r.id=$1 and r.tenant_id=$2 and r.type_key='tool.definition'
          and r.state='ACTIVE' and r.projection_action_execution_id is null
          and r.home_workspace_id is null and r.application_binding_id is null
          and r.component_type_key='core' and r.native_type=r.type_key and r.native_id=r.id::text
          and t.status='ACTIVE' and t.name in ('agent.memory.entry.list','agent.memory.entry.read')
          and t.source='PLATFORM_NATIVE' and t.action_key=t.name
          and t.capability_contract_key is null and t.backend_ref='CORE_STREAMABLE_MCP'
          and t.input_schema_hash=$3 and t.output_schema_hash=$4 for update of r,t",
    )
    .bind(tool)
    .bind(tenant)
    .bind(input)
    .bind(output)
    .fetch_optional(&mut *conn)
    .await?;
    let owner = owner.ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    if !crate::agent_definition::projection_matches(gov, tool, tenant, owner).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    Ok(owner)
}

#[derive(sqlx::FromRow)]
struct ProvisionTool {
    tool_resource_id: Uuid,
    name: String,
    source: String,
    owner_principal_id: Uuid,
    home_workspace_id: Option<Uuid>,
}

/// DD-122 (3) outcome for one ToolBinding of the admitted generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Provision {
    Grant,
    NoPermission,
}

/// An inactive Tool owner or a definite denial of the initiator's fresh
/// `discover`/`consume`/`share` keeps NO_PERMISSION without blocking the
/// Installation. Any other result is unknown: the caller does not activate and
/// leaves the generation to the original projection reconciler.
pub(crate) fn provision_decision(
    tool_owner_active: bool,
    initiator_rights: Result<(), Refusal>,
) -> Result<Provision, Refusal> {
    if !tool_owner_active {
        return Ok(Provision::NoPermission);
    }
    match initiator_rights {
        Ok(()) => Ok(Provision::Grant),
        Err(Refusal::Denied(_)) => Ok(Provision::NoPermission),
        Err(error) => Err(error),
    }
}

async fn initiator_rights(gov: &Governance, tool: Uuid, initiator: Uuid) -> Result<(), Refusal> {
    for checked in ["discover", "consume", "share"] {
        permission(gov, tool, initiator, checked).await?;
    }
    Ok(())
}

/// Read back one written relationship at least as fresh as its write.
async fn written(
    gov: &Governance,
    object: Uuid,
    checked: &str,
    subject: Uuid,
    token: &str,
) -> Result<(), Refusal> {
    let proof = gov
        .spicedb
        .check(
            "resource",
            &object.to_string(),
            checked,
            &subject.to_string(),
            Consistency::AtLeastAsFresh(token),
        )
        .await
        .map_err(|_| unknown("Agent Tool 授予复读"))?;
    if proof.zed_token.is_empty() || !proof.allowed {
        return Err(unknown("Agent Tool 授予复读"));
    }
    Ok(())
}

/// DD-122 (3): the same admitted Installation projection as the llm_route
/// grant (`model_route::provision`); no new Action, Workflow or authority.
/// Returns the Tools whose ToolBinding the activation transaction sets ACTIVE.
pub(crate) async fn provision(
    state: &crate::service_api::ServiceState,
    installation: Uuid,
    version: Uuid,
    generation: i64,
    action: Uuid,
) -> Result<Vec<Uuid>, Refusal> {
    let gov = &state.governance;
    let (tenant, workspace): (Uuid, Uuid) = sqlx::query_as(
        "select r.tenant_id,i.workspace_id from catalog.agent_installation i
        join catalog.resource r on r.id=i.resource_id where i.resource_id=$1",
    )
    .bind(installation)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    // Same lifecycle lock order as the route grant: Tenant, Workspace, Resource.
    let mut lifecycle = state.pool.begin().await?;
    let active: bool = sqlx::query_scalar(
        "select state='ACTIVE' from identity.tenant where id=$1 for no key update",
    )
    .bind(tenant)
    .fetch_one(&mut *lifecycle)
    .await?;
    let workspace_active: bool = sqlx::query_scalar(
        "select state='ACTIVE' from identity.workspace
        where id=$1 and tenant_id=$2 for no key update",
    )
    .bind(workspace)
    .bind(tenant)
    .fetch_one(&mut *lifecycle)
    .await?;
    if !active || !workspace_active {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let (agent, owner, initiator): (Uuid, Uuid, Uuid) = sqlx::query_as(
        "select i.agent_principal_id,r.owner_principal_id,ae.initiator_principal_id
        from catalog.agent_installation i join catalog.resource r on r.id=i.resource_id
        join admission.action_execution ae on ae.id=r.projection_action_execution_id
        join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
          and p.generation=$3 and p.agent_version_asset_id=$2 and p.state='PENDING'
        join identity.principal a on a.id=i.agent_principal_id and a.tenant_id=r.tenant_id
          and a.kind='AGENT' and a.status='ACTIVE'
        where i.resource_id=$1 and r.tenant_id=$5 and i.workspace_id=$6
          and r.home_workspace_id=i.workspace_id and r.state in ('PROVISIONING','ACTIVE')
          and i.state in ('PROVISIONING','DRAINING') and ae.id=$4
          and ae.tenant_id=r.tenant_id and ae.workspace_id=i.workspace_id and ae.target_id=r.id
          and ae.actor_principal_id=ae.initiator_principal_id and ae.gate_state='ALLOWED'
          and ae.dispatch_state='DISPATCHED'
          and ae.action_key in ('agent.installation.create','agent.installation.upgrade')
          and ae.parameters->'params'->>'assetId'=$2::uuid::text
        for no key update of r",
    )
    .bind(installation)
    .bind(version)
    .bind(generation)
    .bind(action)
    .bind(tenant)
    .bind(workspace)
    .fetch_optional(&mut *lifecycle)
    .await?
    .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    let mut humans = vec![owner, initiator];
    humans.sort_unstable();
    humans.dedup();
    for human in humans {
        if !crate::agent_definition::active_owner(&mut lifecycle, tenant, human).await? {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
    }
    let tools: Vec<ProvisionTool> = sqlx::query_as(
        "select b.tool_resource_id,t.name,t.source,r.owner_principal_id,r.home_workspace_id
        from catalog.tool_binding b
        join catalog.tool_definition t on t.resource_id=b.tool_resource_id and t.status='ACTIVE'
        join catalog.resource r on r.id=t.resource_id and r.tenant_id=$4 and r.state='ACTIVE'
          and r.type_key='tool.definition' and r.projection_action_execution_id is null
          and (r.home_workspace_id is null or r.home_workspace_id=$5)
        where b.installation_resource_id=$1 and b.projection_generation=$2
          and b.agent_version_asset_id=$3 and b.workspace_id=$5
          and b.status in ('PENDING','NO_PERMISSION','ACTIVE')
        order by b.tool_resource_id",
    )
    .bind(installation)
    .bind(generation)
    .bind(version)
    .bind(tenant)
    .bind(workspace)
    .fetch_all(&mut *lifecycle)
    .await?;
    let mut granted = Vec::new();
    for tool in &tools {
        if !gov
            .spicedb
            .resource_projection_matches_in_workspace(
                &tool.tool_resource_id.to_string(),
                &tenant.to_string(),
                &tool.owner_principal_id.to_string(),
                tool.home_workspace_id.map(|id| id.to_string()).as_deref(),
                gov.cfg.relationship_page,
            )
            .await
            .map_err(|_| unknown("Tool Resource 投影"))?
        {
            return Err(unknown("Tool Resource 投影"));
        }
        let owner_active =
            crate::agent_definition::active_owner(&mut lifecycle, tenant, tool.owner_principal_id)
                .await?;
        let rights = if owner_active {
            initiator_rights(gov, tool.tool_resource_id, initiator).await
        } else {
            Ok(())
        };
        if provision_decision(owner_active, rights)? == Provision::Grant {
            granted.push(tool.tool_resource_id);
        }
    }
    // A Version declaring native memory tools also needs the Agent to read its
    // own Installation, the target of those tools' contract permission.
    let memory = tools.iter().any(|tool| {
        tool.source == "PLATFORM_NATIVE" && NATIVE_TOOLS.contains(&tool.name.as_str())
    });
    let mut writes = Vec::new();
    for tool in &granted {
        for (relation, _) in TOOL_RELATIONS {
            writes.push((Write::Touch, relationship(*tool, relation, agent)));
        }
    }
    if memory {
        writes.push((Write::Touch, relationship(installation, "reader", agent)));
    }
    if writes.is_empty() {
        lifecycle.commit().await?;
        return Ok(granted);
    }
    crate::service_api::audit_gate(state)
        .await
        .map_err(|_| unknown("审计 sink"))?;
    let token = gov
        .spicedb
        .write(&writes)
        .await
        .map_err(|_| unknown("Agent Tool 授予"))?;
    if token.is_empty() {
        return Err(unknown("Agent Tool 授予"));
    }
    for tool in &granted {
        for (_, checked) in TOOL_RELATIONS {
            written(gov, *tool, checked, agent, &token).await?;
        }
    }
    if memory {
        written(gov, installation, "read", agent, &token).await?;
    }
    lifecycle.commit().await?;
    Ok(granted)
}

/// Delete the given Agents' Tool relationships and read them back as absent.
async fn delete_agent_relations(
    gov: &Governance,
    tools: &[Uuid],
    agents: &[Uuid],
) -> Result<(), Refusal> {
    let mut deletes = Vec::new();
    for tool in tools {
        for agent in agents {
            for (relation, _) in TOOL_RELATIONS {
                deletes.push((Write::Delete, relationship(*tool, relation, *agent)));
            }
        }
    }
    for batch in deletes.chunks(RELATION_WRITE_BATCH) {
        gov.spicedb
            .write(batch)
            .await
            .map_err(|_| unknown("Agent Tool 关系撤销"))?;
    }
    let subjects: Vec<String> = agents.iter().map(Uuid::to_string).collect();
    for tool in tools {
        let object = tool.to_string();
        for (relation, _) in TOOL_RELATIONS {
            let remaining = gov
                .spicedb
                .read(
                    &RelationshipFilter {
                        object_type: "resource",
                        object_id: Some(&object),
                        relation: Some(relation),
                        subject_principal: None,
                    },
                    gov.cfg.relationship_page,
                )
                .await
                .map_err(|_| unknown("Agent Tool 关系撤销复读"))?;
            let leaked = remaining
                .iter()
                .any(|held| subjects.contains(&held.subject_principal));
            if leaked {
                return Err(Refusal::Precondition(ReasonCode::ProjectionDelayed));
            }
        }
    }
    Ok(())
}

/// DD-122 (7): after the upgrade drain the Agent keeps relationships only on
/// Tools granted to the new generation; Tools that appear only in an older
/// generation (or are no longer granted) lose discoverer/consumer.
pub(crate) async fn retire_previous_generation(
    state: &crate::service_api::ServiceState,
    installation: Uuid,
    generation: i64,
    action: Uuid,
    granted: &[Uuid],
) -> Result<(), Refusal> {
    let agent: Uuid = sqlx::query_scalar(
        "select i.agent_principal_id from catalog.agent_installation i
        join catalog.resource r on r.id=i.resource_id
        join admission.action_execution a on a.id=r.projection_action_execution_id
        where i.resource_id=$1 and i.state='DRAINING' and i.active_projection_generation<>$2
          and a.id=$3 and a.action_key='agent.installation.upgrade' and a.gate_state='ALLOWED'
          and catalog.agent_installation_drained(i.resource_id)",
    )
    .bind(installation)
    .bind(generation)
    .bind(action)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    let previous: Vec<Uuid> = sqlx::query_scalar(
        "select distinct tool_resource_id from catalog.tool_binding
        where installation_resource_id=$1 and projection_generation<>$2
          and not (tool_resource_id=any($3::uuid[]))
        order by tool_resource_id",
    )
    .bind(installation)
    .bind(generation)
    .bind(granted.to_vec())
    .fetch_all(&state.pool)
    .await?;
    delete_agent_relations(&state.governance, &previous, &[agent]).await
}

/// DD-122 (7): disabling an application binding deletes every AgentPrincipal
/// relationship on its Tools. Other principals' relationships are not Agent
/// grants and stay untouched.
pub(crate) async fn revoke_tool_agents(
    gov: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    tools: &[Uuid],
) -> Result<(), Refusal> {
    for tool in tools {
        let object = tool.to_string();
        let mut subjects = Vec::new();
        for (relation, _) in TOOL_RELATIONS {
            let held = gov
                .spicedb
                .read(
                    &RelationshipFilter {
                        object_type: "resource",
                        object_id: Some(&object),
                        relation: Some(relation),
                        subject_principal: None,
                    },
                    gov.cfg.relationship_page,
                )
                .await
                .map_err(|_| unknown("Agent Tool 关系读取"))?;
            for row in held {
                if let Ok(subject) = Uuid::parse_str(&row.subject_principal) {
                    subjects.push(subject);
                }
            }
        }
        subjects.sort_unstable();
        subjects.dedup();
        let agents: Vec<Uuid> = sqlx::query_scalar(
            "select id from identity.principal
            where tenant_id=$1 and kind='AGENT' and id=any($2::uuid[]) order by id",
        )
        .bind(tenant)
        .bind(subjects)
        .fetch_all(&mut *conn)
        .await?;
        if !agents.is_empty() {
            delete_agent_relations(gov, std::slice::from_ref(tool), &agents).await?;
        }
    }
    Ok(())
}

#[derive(serde::Deserialize)]
pub struct PageQuery {
    offset: Option<i64>,
}

#[derive(sqlx::FromRow)]
struct ToolRow {
    resource_id: Uuid,
    owner_principal_id: Uuid,
    resource_version: i32,
    resource_state: String,
    projection_action_execution_id: Option<Uuid>,
    name: String,
    status: String,
    input_schema_hash: String,
    output_schema_hash: String,
}

/// Read-only directory metadata. Every visible Tool requires its existing
/// Resource projection and fresh discover permission.
pub async fn list(
    axum::extract::State(state): axum::extract::State<crate::bff::BffState>,
    headers: axum::http::HeaderMap,
    axum::extract::Query(query): axum::extract::Query<PageQuery>,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let context = match crate::bff::resolve_execution_context(&state, &headers).await {
        Ok(context) => context,
        Err(error) => return error,
    };
    match directory(&state, &context, query.offset.unwrap_or(0)).await {
        Ok(page) => axum::Json(page).into_response(),
        Err(error) => error.respond(None),
    }
}

async fn directory(
    state: &crate::bff::BffState,
    context: &crate::bff::ExecutionContext,
    offset: i64,
) -> Result<contracts::PlatformToolPage, Refusal> {
    let limit = i64::from(state.governance.cfg.relationship_page);
    if offset < 0 || limit <= 0 || offset.checked_add(limit).is_none() {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    let mut tx = state.pool.begin().await?;
    if !crate::roles::lock_tenant(&mut tx, context.tenant_id).await?
        || !crate::agent_definition::active_owner(
            &mut tx,
            context.tenant_id,
            context.tenant_principal_id,
        )
        .await?
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let rows: Vec<ToolRow> = sqlx::query_as("select r.id resource_id,r.owner_principal_id,
        r.version resource_version,r.state resource_state,r.projection_action_execution_id,
        t.name,t.status,t.input_schema_hash,t.output_schema_hash
        from catalog.resource r join catalog.tool_definition t on t.resource_id=r.id
        where r.tenant_id=$1 and r.type_key='tool.definition' and r.state in ('PROVISIONING','ACTIVE')
          and t.source='PLATFORM_NATIVE' and t.status in ('PROVISIONING','ACTIVE') order by r.id offset $2 limit $3")
        .bind(context.tenant_id).bind(offset).bind(limit).fetch_all(&mut *tx).await?;
    let next =
        (rows.len() == usize::try_from(limit).unwrap_or(usize::MAX)).then_some(offset + limit);
    let mut tools = Vec::new();
    for row in rows {
        let (input, output) = schema_hashes(&row.name)?;
        if input != row.input_schema_hash || output != row.output_schema_hash {
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        }
        let active = row.resource_state == "ACTIVE"
            && row.status == "ACTIVE"
            && row.projection_action_execution_id.is_none();
        let visible = if active {
            if !crate::agent_definition::projection_matches(
                &state.governance,
                row.resource_id,
                context.tenant_id,
                row.owner_principal_id,
            )
            .await?
            {
                return Err(Refusal::Unavailable("Tool Resource 投影未闭合".into()));
            }
            let proof = state
                .governance
                .spicedb
                .check(
                    "resource",
                    &row.resource_id.to_string(),
                    "discover",
                    &context.tenant_principal_id.to_string(),
                    Consistency::FullyConsistent,
                )
                .await
                .map_err(|_| Refusal::Unavailable("Tool discover 不可核验".into()))?;
            if proof.zed_token.is_empty() {
                return Err(Refusal::Unavailable("Tool discover 缺 revision".into()));
            }
            proof.allowed
        } else {
            false
        };
        if !visible {
            continue;
        }
        let can_consume = if active {
            let proof = state
                .governance
                .spicedb
                .check(
                    "resource",
                    &row.resource_id.to_string(),
                    "consume",
                    &context.tenant_principal_id.to_string(),
                    Consistency::FullyConsistent,
                )
                .await
                .map_err(|_| Refusal::Unavailable("Tool consume 不可核验".into()))?;
            if proof.zed_token.is_empty() {
                return Err(Refusal::Unavailable("Tool consume 缺 revision".into()));
            }
            proof.allowed
        } else {
            false
        };
        tools.push(serde_json::json!({"resourceId": row.resource_id,
            "resourceVersion": row.resource_version, "resourceState": row.resource_state,
            "ownerPrincipalId": row.owner_principal_id, "name": row.name, "actionKey": row.name,
            "source": "PLATFORM_NATIVE", "status": row.status,
            "inputSchemaHash": row.input_schema_hash, "outputSchemaHash": row.output_schema_hash,
            "canConsume": can_consume}));
    }
    let page = serde_json::from_value(serde_json::json!({"tools": tools, "nextOffset": next}))
        .map_err(|_| Refusal::Unavailable("Tool 目录与共享合同不一致".into()))?;
    tx.commit().await?;
    Ok(page)
}

#[cfg(test)]
mod provision_tests {
    use super::*;

    #[test]
    fn provision_decision_table_follows_dd122() {
        let denied = || Err(Refusal::Denied(ReasonCode::PermissionDenied));
        for (owner_active, rights, expected) in [
            (true, Ok(()), Provision::Grant),
            (true, denied(), Provision::NoPermission),
            (false, Ok(()), Provision::NoPermission),
            (false, denied(), Provision::NoPermission),
        ] {
            assert_eq!(provision_decision(owner_active, rights).unwrap(), expected);
        }
        // An unverifiable or conflicting check is neither a grant nor a denial:
        // the Installation is not activated and stays with its reconciler.
        let unverifiable = provision_decision(true, Err(Refusal::Unavailable("x".into())));
        assert!(matches!(unverifiable, Err(Refusal::Unavailable(_))));
        let error = Refusal::Conflict(ReasonCode::TargetStateConflict);
        let conflict = provision_decision(true, Err(error));
        assert!(matches!(conflict, Err(Refusal::Conflict(_))));
    }

    #[test]
    fn native_tool_identity_and_agent_relations_are_fixed() {
        let tenant = Uuid::new_v4();
        assert_eq!(
            NATIVE_TOOLS,
            ["agent.memory.entry.list", "agent.memory.entry.read"]
        );
        for name in NATIVE_TOOLS {
            assert!(schema_hashes(name).is_ok());
            assert_eq!(
                native_tool_id(tenant, name),
                Uuid::new_v5(&tenant, name.as_bytes())
            );
        }
        assert_eq!(
            TOOL_RELATIONS,
            [("discoverer", "discover"), ("consumer", "consume")]
        );
    }
}
