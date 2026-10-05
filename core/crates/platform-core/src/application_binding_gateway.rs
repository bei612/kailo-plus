//! Original SS-AGW-ADMIN projection: the Catalog records intent/digest only.
//! Each binding generation uses one native MCP route, guarded on both phases.
//! Publishing a route does not grant a ToolBinding or activate the binding.

use super::*;
use crate::{agent_tool_session::SessionSigner, service_api::ServiceState};

pub(crate) fn target(binding: Uuid, generation: i64) -> String {
    format!("application-{binding}-{generation}")
}

pub(crate) fn route_url(
    signer: &SessionSigner,
    binding: Uuid,
    generation: i64,
) -> Result<reqwest::Url, Refusal> {
    if binding.is_nil() || generation <= 0 {
        return Err(invalid());
    }
    let mut url = signer.gateway_url().clone();
    url.path_segments_mut()
        .map_err(|_| invalid())?
        .pop_if_empty()
        .extend([
            "application-tools",
            &binding.to_string(),
            &generation.to_string(),
        ]);
    Ok(url)
}

pub(super) async fn publish(state: &ServiceState, ae: &Execution) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    let row:Option<(i64,String,String,String,Value)>=sqlx::query_as(
        "select p.generation,b.adapter_service_ref,b.native_instance_ref,s.audience,r.manifest
         from catalog.application_binding b join projection.application_runtime p on p.binding_id=b.id
         join catalog.component_release r on r.id=b.component_release_id and r.status='APPROVED'
         join identity.service_principal s on s.principal_id=b.service_principal_id
           and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
         where b.id=$1 and b.tenant_id=$2 and b.workspace_id is not distinct from $3
           and b.state='PROVISIONING' and b.projection_action_execution_id=$4
           and p.action_execution_id=$4 and p.state='PENDING' and p.observation is not null
         for update of b,p")
        .bind(ae.target_id).bind(ae.tenant_id).bind(ae.workspace_id).bind(ae.id)
        .fetch_optional(&mut *tx).await?;
    let (generation, reference, instance, audience, manifest) = row.ok_or_else(conflict)?;
    let names: Vec<String> = sqlx::query_scalar(
        "select t.name from catalog.tool_definition t
        join catalog.resource r on r.id=t.resource_id
        where r.application_binding_id=$1 and r.projection_action_execution_id=$2
          and r.state='PROVISIONING' and t.source='APPLICATION' and t.status='PROVISIONING'
          and t.application_projection_generation=$3 order by t.name",
    )
    .bind(ae.target_id)
    .bind(ae.id)
    .bind(generation)
    .fetch_all(&mut *tx)
    .await?;
    if names.is_empty() {
        tx.commit().await?;
        return Ok(());
    }
    let signer = state.agent_tool_sessions.as_ref().ok_or_else(blocked)?;
    let service = state.gateway_service_auth.as_ref().ok_or_else(blocked)?;
    let adapter = native::Adapter::resolve(&reference, &instance, &manifest)?;
    let url = route_url(signer, ae.target_id, generation)?;
    let target = target(ae.target_id, generation);
    let tenant = serde_json::to_string(&ae.tenant_id.to_string()).map_err(|_| invalid())?;
    let mut scope = format!("jwt.tenant_id == {tenant}");
    if let Some(workspace) = ae.workspace_id {
        scope.push_str(&format!(
            " && jwt.workspace_id == {}",
            serde_json::to_string(&workspace.to_string()).map_err(|_| invalid())?
        ));
    }
    let mut rules = vec![format!("({scope}) && mcp.methodName == 'tools/list'")];
    let mut unique = BTreeSet::new();
    for name in names {
        if name.is_empty() || !unique.insert(name.clone()) {
            return Err(invalid());
        }
        rules.push(format!(
            "({scope}) && mcp.methodName == 'tools/call' && mcp.tool.name == {}",
            serde_json::to_string(&name).map_err(|_| invalid())?
        ));
    }
    let mut native_target = json!({"name":target,"mcp":{"host":adapter.mcp_url()?.as_str()}});
    if native::Connector::from_manifest(&manifest)? == native::Connector::RemoteAdapter {
        native_target["policies"] =
            json!({"backendAuth":service.adapter_backend_auth(&audience).map_err(|_| blocked())?});
    }
    let route = json!({"name":target,"gateways":[signer.gateway_name()],"matches":[{"path":{"exact":url.path()}}],
        "policies":{"mcpAuthentication":{"mode":"strict","issuer":signer.issuer(),"audiences":[signer.audience()],
            "jwks":serde_json::to_string(signer.public_jwks()).map_err(|_|invalid())?,"resourceMetadata":{"resource":url.as_str()},
            "jwtValidationOptions":{"requiredClaims":["exp","aud","iss","sub"]}},
            "mcpAuthorization":{"rules":rules},"mcpGuardrails":{"processors":[{"kind":"remote",
                "host":service.ext_mcp_url().as_str(),"policies":{"backendAuth":service.backend_auth()},"failureMode":"failClosed",
                "methods":{"*":"request","initialize":"full","ping":"full","tools/list":"full","tools/call":"full"},
                "requestHeaders":{"allowed":["authorization"]},"metadata":{
                    "session":"has(mcpGuardrails.session) ? mcpGuardrails.session : ''",
                    "invocationId":"has(mcpGuardrails.invocationId) ? mcpGuardrails.invocationId : ''",
                    "childAE":"has(mcpGuardrails.childAE) ? mcpGuardrails.childAE : ''",
                    "operationId":"has(mcpGuardrails.operationId) ? mcpGuardrails.operationId : ''",
                    "externalExecutionId":"has(mcpGuardrails.externalExecutionId) ? mcpGuardrails.externalExecutionId : ''",
                    "toolName":"has(mcpGuardrails.toolName) ? mcpGuardrails.toolName : ''"}}]}},
        "backends":[{"mcp":{"statefulMode":"stateless","prefixMode":"conditional","failureMode":"failClosed",
            "targets":[native_target]}}]});
    let digest = collab_bridge::limits::canonical_digest(&route);
    sqlx::query("update projection.application_runtime set native_gateway_route_id=$1,gateway_config_hash=$2,gateway_state='PENDING'
        where binding_id=$3 and generation=$4 and action_execution_id=$5 and state='PENDING'")
        .bind(&target).bind(&digest).bind(ae.target_id).bind(generation).bind(ae.id).execute(&mut *tx).await?;
    tx.commit().await?; // durable original lifecycle intent before native delivery

    // The same fence is taken by disable. A late delivery cannot resurrect a
    // route after its deletion; a lost ACK retains PENDING for exact readback.
    let mut tx = state.pool.begin().await?;
    let current: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.application_binding
        where id=$1 and state='PROVISIONING' and projection_action_execution_id=$2 for update)",
    )
    .bind(ae.target_id)
    .bind(ae.id)
    .fetch_one(&mut *tx)
    .await?;
    if !current {
        return Err(conflict());
    }
    let gateway = crate::model_route::Gateway::from_env()?;
    let effective = gateway.admin(&["api", "config", "effective"], None).await?;
    if effective
        .get("gateways")
        .and_then(|v| v.get(signer.gateway_name()))
        .is_none()
    {
        return Err(blocked());
    }
    gateway
        .admin(
            &["api", "config", "resources", "traffic.route"],
            Some(json!({"resources":[{"value":route}]})),
        )
        .await?;
    crate::agent_tool_runtime::require_route(&gateway, &target, Some(&route)).await?;
    sqlx::query("update projection.application_runtime set gateway_state='ACTIVE'
        where binding_id=$1 and generation=$2 and native_gateway_route_id=$3 and gateway_config_hash=$4 and state='PENDING'")
        .bind(ae.target_id).bind(generation).bind(&target).bind(&digest).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

/// Read-only validation of a pending peer binding uses the same native Gateway
/// and ExtMcp service. The existing lifecycle AE is the sole admission; this
/// route cannot call tools or confer an Agent Session's business permissions.
pub(super) async fn publish_validation(
    state: &ServiceState,
    ae: &Execution,
    generation: i64,
    adapter: &native::Adapter,
) -> Result<reqwest::Url, Refusal> {
    let signer = state.agent_tool_sessions.as_ref().ok_or_else(blocked)?;
    let service = state.gateway_service_auth.as_ref().ok_or_else(blocked)?;
    let mut url = route_url(signer, ae.target_id, generation)?;
    url.path_segments_mut()
        .map_err(|_| invalid())?
        .push("validation");
    let target = peer::target(ae.target_id, generation);
    let route = json!({"name":target,"gateways":[signer.gateway_name()],"matches":[{"path":{"exact":url.path()}}],
        "policies":{"jwtAuth":state.auth.core_mcp_authentication().map_err(|_| blocked())?,
            "mcpAuthorization":{"rules":["mcp.methodName in ['initialize', 'ping', 'notifications/initialized', 'tools/list']"]},
            "mcpGuardrails":{"processors":[{"kind":"remote","host":service.ext_mcp_url().as_str(),
                "policies":{"backendAuth":service.backend_auth()},"failureMode":"failClosed",
                "methods":{"*":"request","initialize":"full","ping":"full","tools/list":"full"},
                "requestHeaders":{"allowed":["authorization",peer::HEADER]},
                "metadata":{"managementAction":"has(mcpGuardrails.managementAction) ? mcpGuardrails.managementAction : ''",
                    "managementBearer":"has(mcpGuardrails.managementBearer) ? mcpGuardrails.managementBearer : ''"}}]}},
        "backends":[{"mcp":{"statefulMode":"stateless","prefixMode":"conditional","failureMode":"failClosed",
            "targets":[{"name":target,"mcp":{"host":adapter.mcp_url()?.as_str()}}]}}]});
    let mut tx = state.pool.begin().await?;
    let current:bool=sqlx::query_scalar("select exists(select 1 from catalog.application_binding b
        join projection.application_runtime p on p.binding_id=b.id and p.action_execution_id=b.projection_action_execution_id
        where b.id=$1 and b.projection_action_execution_id=$2 and b.state='PROVISIONING' and p.state='PENDING'
          and p.generation=$3 for update of b,p)").bind(ae.target_id).bind(ae.id).bind(generation).fetch_one(&mut *tx).await?;
    if !current {
        return Err(conflict());
    }
    let gateway = crate::model_route::Gateway::from_env()?;
    gateway
        .admin(
            &["api", "config", "resources", "traffic.route"],
            Some(json!({"resources":[{"value":route}]})),
        )
        .await?;
    crate::agent_tool_runtime::require_route(&gateway, &target, Some(&route)).await?;
    tx.commit().await?;
    Ok(url)
}

pub(super) async fn revoke(state: &ServiceState, ae: &Execution) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    let binding:Option<Uuid>=sqlx::query_scalar("select id from catalog.application_binding
        where id=$1 and tenant_id=$2 and state='DISABLING' and projection_action_execution_id=$3 for update")
        .bind(ae.target_id).bind(ae.tenant_id).bind(ae.id).fetch_optional(&mut *tx).await?;
    if binding.is_none() {
        return Err(conflict());
    }
    let rows:Vec<(i64,String)>=sqlx::query_as("select generation,native_gateway_route_id
        from projection.application_runtime where binding_id=$1 and native_gateway_route_id is not null
          and gateway_state<>'REVOKED' order by generation for update")
        .bind(ae.target_id).fetch_all(&mut *tx).await?;
    if !rows.is_empty() {
        let gateway = crate::model_route::Gateway::from_env()?;
        for (generation, id) in rows {
            gateway.delete("traffic.route", &id).await?;
            crate::agent_tool_runtime::require_route(&gateway, &id, None).await?;
            sqlx::query(
                "update projection.application_runtime set gateway_state='REVOKED'
                where binding_id=$1 and generation=$2 and native_gateway_route_id=$3",
            )
            .bind(ae.target_id)
            .bind(generation)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        }
    }
    let validation_generations: Vec<i64> = sqlx::query_scalar(
        "select p.generation from projection.application_runtime p
        join catalog.component_release r on r.id=p.component_release_id where p.binding_id=$1
          and r.manifest->'executionConnector'->>'mode'='PROTOCOL_PEER'",
    )
    .bind(ae.target_id)
    .fetch_all(&mut *tx)
    .await?;
    if !validation_generations.is_empty() {
        let gateway = crate::model_route::Gateway::from_env()?;
        for generation in validation_generations {
            let id = peer::target(ae.target_id, generation);
            gateway.delete("traffic.route", &id).await?;
            crate::agent_tool_runtime::require_route(&gateway, &id, None).await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

/// Session signing keys are process-local. Reconcile only the existing route's
/// public key after restart, using the original desired digest and binding fence.
/// No Tool, grant, route target or authorization rule is inferred or replaced.
pub(crate) async fn refresh_installation(
    state: &ServiceState,
    installation: Uuid,
    generation: i64,
) -> Result<(), Refusal> {
    let rows:Vec<(Uuid,i64)>=sqlx::query_as("select distinct b.id,p.generation
        from catalog.agent_installation i join catalog.resource ir on ir.id=i.resource_id
        join catalog.agent_runtime_projection installed on installed.installation_resource_id=i.resource_id and installed.generation=$2
        join catalog.agent_version v on v.asset_id=installed.agent_version_asset_id
        join catalog.tool_definition t on v.content->'capabilityRequirements' @> jsonb_build_array(t.capability_contract_key)
          and t.source='APPLICATION' and t.status='ACTIVE'
        join catalog.resource r on r.id=t.resource_id and r.tenant_id=ir.tenant_id
        join catalog.application_binding b on b.id=r.application_binding_id and b.state='ACTIVE'
          and (b.workspace_id is null or b.workspace_id=i.workspace_id)
        join projection.application_runtime p on p.binding_id=b.id and p.generation=b.active_projection_generation
          and p.state='ACTIVE' and p.gateway_state in ('PENDING','ACTIVE')
        where i.resource_id=$1 and exists(select 1 from projection.application_category c where c.binding_id=b.id
          and c.generation=p.generation) order by b.id,p.generation")
        .bind(installation).bind(generation).fetch_all(&state.pool).await?;
    if rows.is_empty() {
        return Ok(());
    }
    let signer = state.agent_tool_sessions.as_ref().ok_or_else(blocked)?;
    let jwks = json!(serde_json::to_string(signer.public_jwks()).map_err(|_| invalid())?);
    let gateway = crate::model_route::Gateway::from_env()?;
    for (binding, generation) in rows {
        let mut tx = state.pool.begin().await?;
        let record:Option<(String,String)>=sqlx::query_as("select p.native_gateway_route_id,p.gateway_config_hash
            from catalog.application_binding b join projection.application_runtime p on p.binding_id=b.id
              and p.generation=b.active_projection_generation and p.state='ACTIVE'
            where b.id=$1 and b.state='ACTIVE' and p.generation=$2 and p.gateway_state in ('PENDING','ACTIVE') for update of b,p")
            .bind(binding).bind(generation).fetch_optional(&mut *tx).await?;
        let (id, digest) = record.ok_or_else(conflict)?;
        if id != target(binding, generation) {
            return Err(conflict());
        }
        let stored = gateway.resources("traffic.route").await?;
        let exact: Vec<_> = stored.iter().filter(|r| r["id"] == id).collect();
        if exact.len() != 1 {
            return Err(Refusal::Precondition(ReasonCode::ProjectionDelayed));
        }
        let original = &exact[0]["value"];
        let mut desired = original.clone();
        desired["policies"]["mcpAuthentication"]["jwks"] = jwks.clone();
        let next = collab_bridge::limits::canonical_digest(&desired);
        if collab_bridge::limits::canonical_digest(original) != digest && next != digest {
            return Err(conflict());
        }
        if original == &desired {
            crate::agent_tool_runtime::require_route(&gateway, &id, Some(&desired)).await?;
            sqlx::query("update projection.application_runtime set gateway_state='ACTIVE' where binding_id=$1 and generation=$2")
                .bind(binding).bind(generation).execute(&mut *tx).await?;
            tx.commit().await?;
            continue;
        }
        sqlx::query("update projection.application_runtime set gateway_config_hash=$3,gateway_state='PENDING'
            where binding_id=$1 and generation=$2")
            .bind(binding).bind(generation).bind(&next).execute(&mut *tx).await?;
        tx.commit().await?;
        let mut tx = state.pool.begin().await?;
        let current:Option<String>=sqlx::query_scalar("select p.gateway_config_hash from catalog.application_binding b
            join projection.application_runtime p on p.binding_id=b.id and p.generation=b.active_projection_generation
            where b.id=$1 and b.state='ACTIVE' and p.generation=$2 and p.state='ACTIVE' and p.gateway_state='PENDING'
            for update of b,p")
            .bind(binding).bind(generation).fetch_optional(&mut *tx).await?;
        if current.as_deref() != Some(&next) {
            return Err(conflict());
        }
        gateway
            .admin(
                &["api", "config", "resources", "traffic.route"],
                Some(json!({"resources":[{"value":desired}]})),
            )
            .await?;
        crate::agent_tool_runtime::require_route(&gateway, &id, Some(&desired)).await?;
        sqlx::query("update projection.application_runtime set gateway_state='ACTIVE' where binding_id=$1 and generation=$2 and gateway_config_hash=$3")
            .bind(binding).bind(generation).bind(&next).execute(&mut *tx).await?;
        tx.commit().await?;
    }
    Ok(())
}
