//! The original COMPONENT_BINDING consumer materializes only governed Tool
//! metadata. Component processes, private databases and business bodies are not
//! created, copied or stopped by this projection.

use super::*;
use crate::service_api::ServiceState;

/// Stable Resource references are committed before relationship delivery.
/// Recovery finds the same binding/native identity; it never mints another Tool.
pub(super) async fn prepare(state: &ServiceState, ae: &Execution) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    let row:Option<(Uuid,String,i64,Value,Value)>=sqlx::query_as(
        "select b.component_release_id,b.component_type_key,p.generation,r.manifest,b.capability_categories
         from catalog.application_binding b join projection.application_runtime p on p.binding_id=b.id
         join catalog.component_release r on r.id=b.component_release_id and r.status='APPROVED'
         where b.id=$1 and b.tenant_id=$2 and b.workspace_id is not distinct from $3
           and b.state='PROVISIONING' and b.projection_action_execution_id=$4
           and p.action_execution_id=$4 and p.state='PENDING' and p.observation is not null
           and p.component_release_id=r.id and p.normalized_manifest_digest=r.manifest_digest
         for update of b,p")
        .bind(ae.target_id).bind(ae.tenant_id).bind(ae.workspace_id).bind(ae.id)
        .fetch_optional(&mut *tx).await?;
    let (release, component, generation, manifest, categories) = row.ok_or_else(conflict)?;
    fresh(state, ae).await?;
    if !crate::agent_definition::active_owner(&mut tx, ae.tenant_id, ae.initiator_principal_id)
        .await?
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    crate::application_catalog::register_release_definitions(&mut tx, release).await?;
    let mut required = BTreeSet::new();
    for category in categories.as_array().ok_or_else(invalid)? {
        let content: Value = sqlx::query_scalar(
            "select content from catalog.capability_contract
            where category_key=$1 and contract_version=$2 and status='ACTIVE' for share",
        )
        .bind(text(category, "category")?)
        .bind(category["version"].as_i64().ok_or_else(invalid)? as i32)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(blocked)?;
        for operation in content["operationContracts"]
            .as_array()
            .ok_or_else(blocked)?
        {
            if operation["surface"] == "TOOL" {
                required.insert(text(operation, "contractKey")?.to_owned());
            }
        }
    }
    let mut actual = BTreeSet::new();
    for declaration in manifest["toolDefinitions"].as_array().ok_or_else(blocked)? {
        let key = text(declaration, "capabilityContractKey")?;
        if !required.contains(key) {
            continue;
        }
        if !actual.insert(key.to_owned()) {
            return Err(blocked());
        }
        let name = text(declaration, "name")?;
        let id = Uuid::new_v4();
        sqlx::query("insert into catalog.resource
            (id,tenant_id,type_key,home_workspace_id,owner_principal_id,component_type_key,
             application_binding_id,native_type,native_id,state,version,projection_action_execution_id)
            values($1,$2,'tool.definition',$3,$4,$5,$6,'tool.definition',$7,'PROVISIONING',1,$8)
            on conflict(application_binding_id,native_type,native_id) do nothing")
            .bind(id).bind(ae.tenant_id).bind(ae.workspace_id).bind(ae.initiator_principal_id)
            .bind(&component).bind(ae.target_id).bind(name).bind(ae.id).execute(&mut *tx).await?;
        let resource:Option<Uuid>=sqlx::query_scalar("select id from catalog.resource
            where application_binding_id=$1 and native_type='tool.definition' and native_id=$2
              and tenant_id=$3 and home_workspace_id is not distinct from $4 and owner_principal_id=$5
              and component_type_key=$6 and type_key='tool.definition' and state='PROVISIONING'
              and projection_action_execution_id=$7 for update")
            .bind(ae.target_id).bind(name).bind(ae.tenant_id).bind(ae.workspace_id)
            .bind(ae.initiator_principal_id).bind(&component).bind(ae.id)
            .fetch_optional(&mut *tx).await?;
        let resource = resource.ok_or_else(conflict)?;
        sqlx::query("insert into catalog.tool_definition
            (resource_id,name,source,action_key,capability_contract_key,input_schema_hash,output_schema_hash,
             backend_ref,status,application_projection_generation)
            values($1,$2,'APPLICATION',$3,$3,$4,$5,$6,'PROVISIONING',$7) on conflict(resource_id) do nothing")
            .bind(resource).bind(name).bind(key).bind(text(declaration,"inputSchemaHash")?)
            .bind(text(declaration,"outputSchemaHash")?).bind(text(declaration,"backendRef")?)
            .bind(generation).execute(&mut *tx).await?;
        let exact: bool = sqlx::query_scalar(
            "select exists(select 1 from catalog.tool_definition where resource_id=$1
            and name=$2 and source='APPLICATION' and action_key=$3 and capability_contract_key=$3
            and input_schema_hash=$4 and output_schema_hash=$5 and backend_ref=$6
            and application_projection_generation=$7 and status='PROVISIONING')",
        )
        .bind(resource)
        .bind(name)
        .bind(key)
        .bind(text(declaration, "inputSchemaHash")?)
        .bind(text(declaration, "outputSchemaHash")?)
        .bind(text(declaration, "backendRef")?)
        .bind(generation)
        .fetch_one(&mut *tx)
        .await?;
        if !exact {
            return Err(conflict());
        }
    }
    if actual != required {
        return Err(blocked());
    }
    tx.commit().await?;
    Ok(())
}

/// Hold the same binding fence as disable while delivering and reading back
/// relations, so a late create TOUCH cannot resurrect a disabled projection.
pub(super) async fn permissions(state: &ServiceState, ae: &Execution) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    let binding: Option<Uuid> = sqlx::query_scalar(
        "select id from catalog.application_binding
        where id=$1 and tenant_id=$2 and workspace_id is not distinct from $3
          and state='PROVISIONING' and projection_action_execution_id=$4 for update",
    )
    .bind(ae.target_id)
    .bind(ae.tenant_id)
    .bind(ae.workspace_id)
    .bind(ae.id)
    .fetch_optional(&mut *tx)
    .await?;
    if binding.is_none() {
        return Err(conflict());
    }
    fresh(state, ae).await?;
    let resources:Vec<(Uuid,Uuid,Option<Uuid>)>=sqlx::query_as("select r.id,r.owner_principal_id,r.home_workspace_id
        from catalog.resource r join catalog.tool_definition t on t.resource_id=r.id and t.source='APPLICATION'
        where r.application_binding_id=$1 and r.tenant_id=$2 and r.state='PROVISIONING'
          and r.projection_action_execution_id=$3 order by r.id for update of r,t")
        .bind(ae.target_id).bind(ae.tenant_id).bind(ae.id).fetch_all(&mut *tx).await?;
    for (id, owner, workspace) in resources {
        let id = id.to_string();
        let tenant = ae.tenant_id.to_string();
        let owner = owner.to_string();
        let workspace = workspace.map(|id| id.to_string());
        state
            .governance
            .spicedb
            .replace_resource_projection(&id, &tenant, &owner, &owner, workspace.as_deref())
            .await
            .map_err(|_| {
                Refusal::Unavailable("application Tool permission projection unknown".into())
            })?;
        if !state
            .governance
            .spicedb
            .resource_projection_matches_in_workspace(
                &id,
                &tenant,
                &owner,
                workspace.as_deref(),
                state.governance.cfg.relationship_page,
            )
            .await
            .map_err(|_| {
                Refusal::Unavailable("application Tool permission observation unavailable".into())
            })?
        {
            return Err(Refusal::Precondition(ReasonCode::ProjectionDelayed));
        }
    }
    tx.commit().await?;
    Ok(())
}

/// Stop only this provider's Kailo visibility and delegated reader edges.
/// The independent service, original Resource/Asset and native data remain.
pub(super) async fn revoke(state: &ServiceState, ae: &Execution) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    let service: Option<Uuid> = sqlx::query_scalar(
        "select service_principal_id from catalog.application_binding
        where id=$1 and tenant_id=$2 and workspace_id is not distinct from $3
          and state='DISABLING' and projection_action_execution_id=$4 for update",
    )
    .bind(ae.target_id)
    .bind(ae.tenant_id)
    .bind(ae.workspace_id)
    .bind(ae.id)
    .fetch_optional(&mut *tx)
    .await?;
    let service = service.ok_or_else(conflict)?.to_string();
    // DISABLING has already closed fresh call admission. Do not re-grant or
    // require the original caller still to possess content permissions while
    // withdrawing this same, already authorized projection.
    sqlx::query(
        "update catalog.tool_binding set status='REVOKED' where status<>'REVOKED'
        and tool_resource_id in (select r.id from catalog.resource r
          join catalog.tool_definition t on t.resource_id=r.id and t.source='APPLICATION'
          where r.application_binding_id=$1 and r.tenant_id=$2)",
    )
    .bind(ae.target_id)
    .bind(ae.tenant_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("delete from projection.application_category where binding_id=$1 and tenant_id=$2")
        .bind(ae.target_id)
        .bind(ae.tenant_id)
        .execute(&mut *tx)
        .await?;
    for object in ["resource", "asset"] {
        let filter = crate::spicedb::RelationshipFilter {
            object_type: object,
            object_id: None,
            relation: Some("reader"),
            subject_principal: Some(&service),
        };
        let relations = state
            .governance
            .spicedb
            .read(&filter, state.governance.cfg.relationship_page)
            .await
            .map_err(|_| Refusal::Unavailable("binding reader observation unavailable".into()))?;
        for relation in relations {
            state
                .governance
                .spicedb
                .write(&[(crate::spicedb::Write::Delete, relation)])
                .await
                .map_err(|_| Refusal::Unavailable("binding reader revocation unknown".into()))?;
        }
        if !state
            .governance
            .spicedb
            .read(&filter, state.governance.cfg.relationship_page)
            .await
            .map_err(|_| {
                Refusal::Unavailable("binding reader revocation observation unavailable".into())
            })?
            .is_empty()
        {
            return Err(Refusal::Precondition(ReasonCode::ProjectionDelayed));
        }
    }
    tx.commit().await?;
    Ok(())
}

async fn fresh(state: &ServiceState, ae: &Execution) -> Result<(), Refusal> {
    let definition =
        crate::governance::exact_definition(&state.pool, &ae.action_key, ae.action_version).await?;
    let decision = state
        .governance
        .evaluate(
            crate::governance::Actor {
                tenant_id: ae.tenant_id,
                principal_id: ae.initiator_principal_id,
                human_identity_id: None,
            },
            &definition,
            &Target {
                id: ae.target_id,
                version: 0,
                workspace_id: ae.workspace_id,
            },
        )
        .await?;
    if !decision.allowed || decision.zed_token.as_deref().is_none_or(str::is_empty) {
        return Err(Refusal::Denied(
            decision.reason.unwrap_or(ReasonCode::PermissionDenied),
        ));
    }
    Ok(())
}

pub(super) async fn metering(state: &ServiceState, ae: &Execution) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    // Share the existing Customer replace lock/order with Installation and
    // Tenant lifecycle. No second subject authority or blind PUT retry.
    let active: bool =
        sqlx::query_scalar("select state='ACTIVE' from identity.tenant where id=$1 for update")
            .bind(ae.tenant_id)
            .fetch_optional(&mut *tx)
            .await?
            .unwrap_or(false);
    if !active {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let binding:bool=sqlx::query_scalar("select exists(select 1 from catalog.application_binding b
        where b.id=$1 and b.tenant_id=$2 and b.projection_action_execution_id=$3 and b.state='PROVISIONING')")
        .bind(ae.target_id).bind(ae.tenant_id).bind(ae.id).fetch_one(&mut *tx).await?;
    if !binding {
        return Err(conflict());
    }
    fresh(state, ae).await?;
    let applicable: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.application_binding b
        where b.id=$1 and (b.model_call_mode='PLATFORM_LLM_ROUTE' or exists(
          select 1 from catalog.action_definition d where d.component_release_id=b.component_release_id
            and cardinality(d.meters)>0)))",
    )
    .bind(ae.target_id)
    .fetch_one(&mut *tx)
    .await?;
    if applicable {
        crate::model_route::ensure_usage_subject(
            state,
            &mut tx,
            ae.tenant_id,
            ae.workspace_id,
            ae.target_id,
            ae.id,
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}
