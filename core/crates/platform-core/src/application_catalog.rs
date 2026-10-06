//! DD-88: contract keys are logical; their implementation is the exact release
//! selected through the original binding generation. No second action registry.
use serde_json::Value;
use sqlx::PgConnection;
use uuid::Uuid;

use crate::governance::{Definition, Refusal, DEFINITION_COLUMNS};
use contracts::ReasonCode;

#[path = "application_approval.rs"]
pub(crate) mod approval;

pub(crate) struct ApplicationDefinition {
    pub(crate) definition: Definition,
    pub(crate) definition_id: Uuid,
    pub(crate) component_release_id: Uuid,
    pub(crate) declaration: Value,
}

fn blocked() -> Refusal {
    Refusal::Blocked(ReasonCode::CapabilityBlocked)
}

fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, Refusal> {
    value[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(blocked)
}

fn integer(value: &Value, key: &str) -> Result<i32, Refusal> {
    value[key]
        .as_i64()
        .and_then(|v| i32::try_from(v).ok())
        .filter(|v| *v > 0)
        .ok_or_else(blocked)
}

/// Called by COMPONENT_BINDING before its runtime projection can become ACTIVE.
/// Registers only immutable approved declarations in the original Catalog.
/// All writes participate in the caller's existing transaction.
pub(crate) async fn register_release_definitions(
    conn: &mut PgConnection,
    release: Uuid,
) -> Result<(), Refusal> {
    let (component, manifest): (String, Value) = sqlx::query_as(
        "select r.component_type_key,r.manifest from catalog.component_release r
         join catalog.component_definition c on c.type_key=r.component_type_key
         where r.id=$1 and r.status='APPROVED' and c.class='APPLICATION' and c.status='ACTIVE'
         for key share of r,c",
    )
    .bind(release)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(blocked)?;
    for declaration in manifest["resourceTypeDefinitions"]
        .as_array()
        .ok_or_else(blocked)?
    {
        let key = text(declaration, "typeKey")?;
        let category = text(declaration, "capabilityCategory")?;
        let version = integer(declaration, "capabilityContractVersion")?;
        sqlx::query("insert into catalog.resource_type_definition
            (type_key,capability_category,capability_contract_version,incremental_contracts,
             llm_gateway_contract,transfer_formats,tenant_delete_action_key,status,component_release_id,implementation_declaration)
            values($1,$2,$3,$4,$5,$6,nullif($7,'NONE'),'ACTIVE',$8,$9)
            on conflict(type_key,component_release_id) do nothing")
            .bind(key).bind(category).bind(version).bind(&declaration["incrementalContracts"])
            .bind(text(declaration,"llmGatewayContract")?).bind(&declaration["transferFormats"])
            .bind(text(declaration,"tenantDeleteActionKey")?).bind(release).bind(declaration)
            .execute(&mut *conn).await?;
        let stored: Value = sqlx::query_scalar(
            "select implementation_declaration from catalog.resource_type_definition
            where type_key=$1 and component_release_id=$2 and status='ACTIVE'",
        )
        .bind(key)
        .bind(release)
        .fetch_one(&mut *conn)
        .await?;
        if stored != *declaration {
            return Err(blocked());
        }
    }
    for declaration in manifest["actionDefinitions"]
        .as_array()
        .ok_or_else(blocked)?
    {
        let key = text(declaration, "actionKey")?;
        let version = integer(declaration, "version")?;
        if text(declaration, "componentTypeKey")? != component
            || text(declaration, "capabilityContractKey")? != key
            || text(declaration, "capacityPolicy")? != "NATIVE"
        {
            return Err(blocked());
        }
        if !matches!(
            text(declaration, "executionMode")?,
            "SYNC" | "PROTOCOL" | "TEMPORAL"
        ) || (declaration["executionMode"] == "TEMPORAL"
            && declaration["workflowType"] != "ComponentTaskWorkflow")
            || (declaration["executionMode"] != "TEMPORAL" && declaration["workflowType"] != "NONE")
        {
            return Err(blocked());
        }
        // Retry keeps the already registered policy version; a later ACTIVE
        // version with the same policy ID cannot silently replace that snapshot.
        let existing:Option<(Value,String,Option<Uuid>,Option<i32>)>=sqlx::query_as(
            "select implementation_declaration,status,approval_policy_id,approval_policy_version
             from catalog.action_definition where action_key=$1 and version=$2 and component_release_id=$3")
            .bind(key).bind(version).bind(release).fetch_optional(&mut *conn).await?;
        if let Some((stored, status, policy_id, policy_version)) = existing {
            if stored != *declaration || status != "ACTIVE" {
                return Err(blocked());
            }
            if let Some(policy) = policy_id {
                let active:bool=sqlx::query_scalar("select exists(select 1 from catalog.approval_policy
                    where id=$1 and version=$2 and action_key=$3 and target_type=$4 and status='ACTIVE')")
                    .bind(policy).bind(policy_version).bind(key).bind(text(declaration,"targetType")?)
                    .fetch_one(&mut *conn).await?;
                if !active {
                    return Err(blocked());
                }
            }
            continue;
        }
        let object = match text(declaration, "targetType")? {
            "RESOURCE" => "resource",
            "ASSET" => "asset",
            _ => return Err(blocked()),
        };
        let approval: Option<(Uuid, i32)> = if text(declaration, "approvalPolicyId")? == "NONE" {
            None
        } else {
            let id =
                Uuid::parse_str(text(declaration, "approvalPolicyId")?).map_err(|_| blocked())?;
            let policies: Vec<(Uuid, i32)> = sqlx::query_as(
                "select id,version from catalog.approval_policy
                where id=$1 and action_key=$2 and target_type=$3 and status='ACTIVE'",
            )
            .bind(id)
            .bind(key)
            .bind(text(declaration, "targetType")?)
            .fetch_all(&mut *conn)
            .await?;
            match policies.as_slice() {
                [policy] => Some(*policy),
                _ => return Err(blocked()),
            }
        };
        let meters: Vec<String> =
            serde_json::from_value(declaration["meters"].clone()).map_err(|_| blocked())?;
        let exposure = &declaration["resultExposurePolicy"];
        let observation = &declaration["businessObservabilityPolicy"];
        sqlx::query("insert into catalog.action_definition
            (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,permission,
             permission_object_type,execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,
             workflow_type,workflow_kind,capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
             obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,
             status,component_release_id,implementation_declaration)
            values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
             CASE WHEN $9='TEMPORAL' THEN 'ComponentTaskWorkflow' END,
             CASE WHEN $9='TEMPORAL' THEN 'COMPONENT_ACTION' END,'NATIVE',NULL,$13,$14,$15,$16,
             $17,$18,$19,$20,$21,$22,'ACTIVE',$23,$24)
            on conflict(action_key,version,component_release_id) do nothing")
            .bind(key).bind(version).bind(&component).bind(text(declaration,"targetType")?)
            .bind(text(declaration,"tenantRule")?).bind(text(declaration,"workspaceRule")?)
            .bind(text(declaration,"permission")?).bind(object).bind(text(declaration,"executionMode")?)
            .bind(text(declaration,"confirmationMode")?).bind(approval.map(|v|v.0)).bind(approval.map(|v|v.1))
            .bind(text(declaration,"quotaPolicy")?).bind(meters).bind(text(exposure,"mode")?)
            .bind(text(declaration,"auditPolicy")?).bind(text(observation,"correlationMode")?)
            .bind(text(observation,"progressSource")?).bind(text(observation,"terminalSource")?)
            .bind(text(observation,"usageSource")?).bind(text(observation,"costSource")?)
            .bind(text(observation,"redactionPolicy")?).bind(release).bind(declaration)
            .execute(&mut *conn).await?;
        let stored: Value = sqlx::query_scalar(
            "select implementation_declaration from catalog.action_definition
            where action_key=$1 and version=$2 and component_release_id=$3 and status='ACTIVE'",
        )
        .bind(key)
        .bind(version)
        .bind(release)
        .fetch_one(&mut *conn)
        .await?;
        if stored != *declaration {
            return Err(blocked());
        }
    }
    Ok(())
}

/// Reads the binding's exact ACTIVE generation; a missing application policy is
/// an error, never permission to fall back to the platform definition.
pub(crate) async fn exact_definition_for_binding(
    conn: &mut PgConnection,
    binding: Uuid,
    generation: i64,
    key: &str,
    version: i32,
) -> Result<ApplicationDefinition, Refusal> {
    let (id,release,declaration):(Uuid,Uuid,Value)=sqlx::query_as(
        "select d.id,p.component_release_id,d.implementation_declaration
         from catalog.application_binding b
         join projection.application_runtime p on p.binding_id=b.id and p.generation=$2
         join identity.tenant tenant on tenant.id=b.tenant_id and tenant.state='ACTIVE'
         left join identity.workspace workspace on workspace.id=b.workspace_id and workspace.tenant_id=b.tenant_id
         join catalog.component_release r on r.id=p.component_release_id and r.status='APPROVED'
         join catalog.action_definition d on d.component_release_id=p.component_release_id
         where b.id=$1 and b.state='ACTIVE' and b.active_projection_generation=p.generation
           and b.component_release_id=p.component_release_id and p.state='ACTIVE'
           and (b.workspace_id is null or workspace.state='ACTIVE')
           and d.action_key=$3 and d.version=$4 and d.status='ACTIVE'")
        .bind(binding).bind(generation).bind(key).bind(version)
        .fetch_optional(&mut *conn).await?.ok_or_else(blocked)?;
    let definition: Definition = sqlx::query_as(&format!(
        "select {DEFINITION_COLUMNS}
        from catalog.action_definition where id=$1 and component_release_id=$2"
    ))
    .bind(id)
    .bind(release)
    .fetch_one(&mut *conn)
    .await?;
    Ok(ApplicationDefinition {
        definition,
        definition_id: id,
        component_release_id: release,
        declaration,
    })
}

/// Target-based routing is an assertion of the stored resource/binding identity,
/// not selection by display name, natural contract key or provider ordering.
pub(crate) async fn definition_for_resource(
    conn: &mut PgConnection,
    tenant: Uuid,
    workspace: Option<Uuid>,
    target: Uuid,
    key: &str,
    version: i32,
) -> Result<(Uuid, i64, ApplicationDefinition), Refusal> {
    let (binding,generation):(Uuid,i64)=sqlx::query_as(
        "select b.id,b.active_projection_generation from catalog.resource r
         join catalog.application_binding b on b.id=r.application_binding_id and b.tenant_id=r.tenant_id
         join catalog.resource_type_definition type on type.id=r.resource_type_definition_id
           and type.type_key=r.type_key and type.component_release_id=b.component_release_id and type.status='ACTIVE'
         where r.id=$1 and r.tenant_id=$2 and r.state='ACTIVE' and r.projection_action_execution_id is null
           and (r.home_workspace_id is null or r.home_workspace_id=$3)
           and (b.workspace_id is null or b.workspace_id=$3) and b.state='ACTIVE'")
        .bind(target).bind(tenant).bind(workspace).fetch_optional(&mut *conn).await?.ok_or_else(blocked)?;
    let definition = exact_definition_for_binding(conn, binding, generation, key, version).await?;
    Ok((binding, generation, definition))
}

pub(crate) async fn definition_for_asset(
    conn: &mut PgConnection,
    tenant: Uuid,
    workspace: Option<Uuid>,
    target: Uuid,
    key: &str,
    version: i32,
) -> Result<(Uuid, i64, ApplicationDefinition), Refusal> {
    let resource: Uuid = sqlx::query_scalar(
        "select resource_id from catalog.asset
        where id=$1 and tenant_id=$2 and state='ACTIVE' and projection_action_execution_id is null",
    )
    .bind(target)
    .bind(tenant)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(blocked)?;
    definition_for_resource(conn, tenant, workspace, resource, key, version).await
}
