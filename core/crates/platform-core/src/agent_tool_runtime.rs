//! DD-105: deliver an original native traffic.route and a per-thread, in-memory
//! Session bearer. The Catalog stores only native projection metadata, never
//! the JWT or Memory body. No global MCP target exposes an unguarded alternate.

use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    agent_runtime::RuntimeRef,
    agent_tool_session::{SessionScope, SessionSigner},
    governance::Refusal,
    service_api::ServiceState,
    service_auth::GatewayServiceAuth,
};

fn unavailable() -> Refusal {
    Refusal::Unavailable("Agent Tool native projection unavailable".into())
}

/// Runs before the caller reacquires its Session fence for thread/start/resume.
/// Zero tools have no dependency on Session signer or Gateway service keys.
pub(crate) async fn configuration(
    state: &ServiceState,
    invocation: Uuid,
    projection: &RuntimeRef,
) -> Result<Value, Refusal> {
    let mut tx = state.pool.begin().await?;
    let scope: SessionScopeRow = sqlx::query_as("select i.tenant_id,i.workspace_id,i.installation_resource_id,
        installed.agent_principal_id,i.agent_version_asset_id,i.projection_generation,i.root_event_id,
        i.status,i.runtime_turn_id from catalog.agent_invocation i
        join catalog.agent_installation installed on installed.resource_id=i.installation_resource_id
        join catalog.agent_session s on s.tenant_id=i.tenant_id and s.workspace_id=i.workspace_id
          and s.installation_resource_id=i.installation_resource_id and s.root_event_id=i.root_event_id
          and s.agent_version_asset_id=i.agent_version_asset_id and s.projection_generation=i.projection_generation
        where i.id=$1").bind(invocation).fetch_optional(&mut *tx).await?.ok_or_else(unavailable)?;
    if scope.installation_resource_id != projection.installation_id
        || scope.projection_generation != projection.generation
    {
        return Err(unavailable());
    }
    // Recovery/observation of an already dispatched or unknown turn cannot
    // mint fresh Tool authority or change the original live thread mid-turn.
    if scope.runtime_turn_id.is_some()
        || !matches!(scope.status.as_str(), "CREATED" | "DISPATCHING")
    {
        tx.commit().await?;
        return Ok(json!({"mcp_servers":{}}));
    }
    let (context, parent) =
        crate::agent_tool::invocation_context(state, &mut tx, invocation, false).await?;
    let bindings = crate::agent_tool::bound_tools(
        &state.governance,
        &mut tx,
        scope.tenant_id,
        scope.installation_resource_id,
        scope.projection_generation,
        scope.agent_principal_id,
    )
    .await?;
    let mut names = Vec::new();
    for tool in bindings {
        let def = crate::agent_memory::read_definition(&state.pool, &tool.action_key).await?;
        match crate::agent_tool::tool_admission(state, &mut tx, &context, &parent, &tool, &def)
            .await
        {
            Ok(_) => names.push(tool.name),
            Err(Refusal::Denied(_) | Refusal::Blocked(_) | Refusal::Conflict(_)) => {}
            Err(error) => return Err(error),
        }
    }
    let scope = scope.scope();
    let mut servers =
        crate::application_tool::configuration(state, &mut tx, &context, &parent, &scope).await?;
    if names.is_empty() {
        tx.commit().await?;
        return Ok(json!({"mcp_servers":servers}));
    }
    let signer = state.agent_tool_sessions.as_ref().ok_or_else(unavailable)?;
    let service = state
        .gateway_service_auth
        .as_ref()
        .ok_or_else(unavailable)?;
    let target = crate::agent_tool_pep::target_name(
        scope.installation_resource_id,
        scope.projection_generation,
    );
    let route = route(signer, service, &scope, &names)?;
    let hash = collab_bridge::limits::canonical_digest(&route);
    let changed = sqlx::query("insert into catalog.agent_tool_gateway_projection
        (installation_resource_id,projection_generation,action_execution_id,native_route_id,config_hash,state)
        values($1,$2,$3,$4,$5,'PENDING') on conflict(installation_resource_id,projection_generation)
        do update set action_execution_id=excluded.action_execution_id,config_hash=excluded.config_hash,state='PENDING'
        where agent_tool_gateway_projection.state<>'REVOKED' and agent_tool_gateway_projection.native_route_id=excluded.native_route_id")
        .bind(scope.installation_resource_id).bind(scope.projection_generation).bind(parent.id)
        .bind(&target).bind(&hash).execute(&mut *tx).await?;
    if changed.rows_affected() != 1 {
        return Err(unavailable());
    }
    tx.commit().await?; // original parent AE + delivery intent precede native mutation

    let gateway = crate::model_route::Gateway::from_env()?;
    let effective = gateway.admin(&["api", "config", "effective"], None).await?;
    if effective
        .get("gateways")
        .and_then(|value| value.get(signer.gateway_name()))
        .is_none()
    {
        return Err(unavailable()); // do not invent an unbounded/new native listener
    }
    gateway
        .admin(
            &["api", "config", "resources", "traffic.route"],
            Some(json!({"resources":[{"value":route}]})),
        )
        .await?;
    require_route(&gateway, &target, Some(&route)).await?;
    let mut tx = state.pool.begin().await?;
    let (context, parent) =
        crate::agent_tool::invocation_context(state, &mut tx, invocation, false).await?;
    if context.installation_resource_id != scope.installation_resource_id || parent.id.is_nil() {
        return Err(unavailable());
    }
    let changed = sqlx::query(
        "update catalog.agent_tool_gateway_projection set state='ACTIVE'
        where installation_resource_id=$1 and projection_generation=$2 and action_execution_id=$3
          and native_route_id=$4 and config_hash=$5 and state='PENDING'",
    )
    .bind(scope.installation_resource_id)
    .bind(scope.projection_generation)
    .bind(parent.id)
    .bind(&target)
    .bind(&hash)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(unavailable());
    }
    tx.commit().await?;
    let token = signer.issue(&scope).map_err(|_| unavailable())?;
    let url = route_url(signer, &scope)?;
    servers.insert(target,json!({"url":url.as_str(),"http_headers":{"Authorization":format!("Bearer {token}")},
        "enabled":true,"required":true,"supports_parallel_tool_calls":false,"enabled_tools":names,
        "default_tools_approval_mode":"approve","startup_timeout_sec":state.agent_memory.tool_timeout().as_secs_f64(),
        "tool_timeout_sec":state.agent_memory.tool_timeout().as_secs_f64()}));
    Ok(json!({"mcp_servers":servers}))
}

#[derive(sqlx::FromRow)]
struct SessionScopeRow {
    tenant_id: Uuid,
    workspace_id: Uuid,
    installation_resource_id: Uuid,
    agent_principal_id: Uuid,
    agent_version_asset_id: Uuid,
    projection_generation: i64,
    root_event_id: String,
    status: String,
    runtime_turn_id: Option<String>,
}

impl SessionScopeRow {
    fn scope(self) -> SessionScope {
        SessionScope {
            tenant_id: self.tenant_id,
            workspace_id: self.workspace_id,
            installation_resource_id: self.installation_resource_id,
            agent_principal_id: self.agent_principal_id,
            agent_version_asset_id: self.agent_version_asset_id,
            projection_generation: self.projection_generation,
            root_event_id: self.root_event_id,
        }
    }
}

fn route_url(signer: &SessionSigner, scope: &SessionScope) -> Result<reqwest::Url, Refusal> {
    let mut url = signer.gateway_url().clone();
    url.path_segments_mut()
        .map_err(|_| unavailable())?
        .pop_if_empty()
        .extend([
            "platform-agent-tools",
            &scope.installation_resource_id.to_string(),
            &scope.projection_generation.to_string(),
        ]);
    Ok(url)
}

fn route(
    signer: &SessionSigner,
    service: &GatewayServiceAuth,
    scope: &SessionScope,
    names: &[String],
) -> Result<Value, Refusal> {
    let url = route_url(signer, scope)?;
    let target = crate::agent_tool_pep::target_name(
        scope.installation_resource_id,
        scope.projection_generation,
    );
    let required = format!("jwt.tenant_id == '{}' && jwt.workspace_id == '{}' && jwt.installation_resource_id == '{}' && jwt.agent_principal_id == '{}' && jwt.agent_version_asset_id == '{}' && jwt.projection_generation == {}",
        scope.tenant_id,scope.workspace_id,scope.installation_resource_id,scope.agent_principal_id,scope.agent_version_asset_id,scope.projection_generation);
    let mut rules = vec![format!("({required}) && mcp.methodName == 'tools/list'")];
    for name in names {
        crate::agent_tool::schema_hashes(name)?;
        rules.push(format!(
            "({required}) && mcp.methodName == 'tools/call' && mcp.tool.name == '{name}'"
        ));
    }
    Ok(
        json!({"name":target,"gateways":[signer.gateway_name()],"matches":[{"path":{"exact":url.path()}}],
        "policies":{"mcpAuthentication":{"mode":"strict","issuer":signer.issuer(),"audiences":[signer.audience()],
            "jwks":serde_json::to_string(signer.public_jwks()).map_err(|_| unavailable())?,"resourceMetadata":{"resource":url.as_str()},
            "jwtValidationOptions":{"requiredClaims":["exp","aud","iss","sub"]}},
            "mcpAuthorization":{"rules":rules},"mcpGuardrails":{"processors":[{"kind":"remote",
                "host":service.ext_mcp_url().as_str(),"policies":{"backendAuth":service.backend_auth()},"failureMode":"failClosed",
                "methods":{"*":"request","initialize":"full","ping":"full","tools/list":"full","tools/call":"full"},
                "requestHeaders":{"allowed":["authorization"]},"metadata":{
                    "session":"request.headers['authorization']",
                    "invocationId":"has(mcpGuardrails.invocationId) ? mcpGuardrails.invocationId : ''",
                    "childAE":"has(mcpGuardrails.childAE) ? mcpGuardrails.childAE : ''",
                    "operationId":"has(mcpGuardrails.operationId) ? mcpGuardrails.operationId : ''",
                    "toolName":"has(mcpGuardrails.toolName) ? mcpGuardrails.toolName : ''"}}]}},
        "backends":[{"mcp":{"statefulMode":"stateless","prefixMode":"conditional","failureMode":"failClosed",
            "targets":[{"name":target,"mcp":{"host":service.mcp_url().as_str()},"policies":{"backendAuth":service.backend_auth()}}]}}]}),
    )
}

pub(crate) async fn require_route(
    gateway: &crate::model_route::Gateway,
    id: &str,
    desired: Option<&Value>,
) -> Result<(), Refusal> {
    let stored = gateway.resources("traffic.route").await?;
    let stored: Vec<_> = stored
        .iter()
        .filter(|row| row["id"].as_str() == Some(id))
        .collect();
    let effective = gateway.admin(&["api", "config", "effective"], None).await?;
    let routes = effective
        .get("routes")
        .and_then(Value::as_array)
        .ok_or_else(unavailable)?;
    let routes: Vec<_> = routes
        .iter()
        .filter(|route| route["name"].as_str() == Some(id))
        .collect();
    match desired {
        Some(desired)
            if stored.len() == 1
                && routes.len() == 1
                && stored[0].get("value") == Some(desired)
                && routes[0] == desired =>
        {
            Ok(())
        }
        None if stored.is_empty() && routes.is_empty() => Ok(()),
        _ => Err(unavailable()),
    }
}

/// Original Tenant deletion calls this only after its lifecycle fence. Each
/// route is deleted and independently absent in stored AND effective config.
pub(crate) async fn retire(state: &ServiceState, tenant: Uuid) -> Result<(), Refusal> {
    let rows: Vec<(Uuid,i64,String)> = sqlx::query_as("select p.installation_resource_id,p.projection_generation,p.native_route_id
        from catalog.agent_tool_gateway_projection p join catalog.resource r on r.id=p.installation_resource_id
        where r.tenant_id=$1 and p.state<>'REVOKED' order by p.native_route_id")
        .bind(tenant).fetch_all(&state.pool).await?;
    if !rows.is_empty() {
        let gateway = crate::model_route::Gateway::from_env()?;
        for (installation, generation, id) in rows {
            gateway.delete("traffic.route", &id).await?;
            require_route(&gateway, &id, None).await?;
            sqlx::query("update catalog.agent_tool_gateway_projection set state='REVOKED'
                where installation_resource_id=$1 and projection_generation=$2 and native_route_id=$3")
                .bind(installation).bind(generation).bind(id).execute(&state.pool).await?;
        }
    }
    sqlx::query("update catalog.tool_binding set status='REVOKED'
        where installation_resource_id in (select id from catalog.resource where tenant_id=$1) and status<>'REVOKED'")
        .bind(tenant).execute(&state.pool).await?;
    Ok(())
}
