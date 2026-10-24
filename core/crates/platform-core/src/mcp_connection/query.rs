//! DD-149(7)(10): read-only connector queries. Listing filters by fresh `discover`;
//! probes and refreshes are read-only (no ActionExecution) and write `ACCESS` audit.
//! Credentials are never returned; only `credentialSet` and its rotation time.

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Utc};
use contracts::ReasonCode;
use serde_json::Value;
use sqlx::PgConnection;
use uuid::Uuid;

use super::command::{check, fresh_probe, may_register};
use super::{credential, invalid, Connection, Risk};
use crate::bff::{resolve_execution_context, BffState, ExecutionContext};
use crate::governance::Refusal;
use crate::mcp_egress::EgressScope;

const AUDIT_KEY: &str = "mcp_connection.probe";
const LIST_LIMIT: i64 = 200;

async fn context(state: &BffState, headers: &HeaderMap) -> Result<ExecutionContext, Response> {
    let ctx = resolve_execution_context(state, headers).await?;
    if ctx.access_mode != contracts::PlatformSessionAccessMode::Full {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed).respond(None));
    }
    Ok(ctx)
}

#[derive(sqlx::FromRow)]
struct ToolViewRow {
    resource_id: Uuid,
    name: String,
    upstream_name: String,
    title: Option<String>,
    description: Option<String>,
    input_schema: Value,
    risk: String,
    action_key: String,
    risk_declared: bool,
    annotations: Option<Value>,
}

#[derive(sqlx::FromRow)]
struct HealthRow {
    health: String,
    checked_at: DateTime<Utc>,
    observed_tools_digest: Option<String>,
    server_name: Option<String>,
    server_version: Option<String>,
}

async fn view(
    state: &BffState,
    conn: &mut PgConnection,
    ctx: &ExecutionContext,
    connection: &Connection,
) -> Result<contracts::McpConnectionView, Refusal> {
    let tools: Vec<ToolViewRow> = sqlx::query_as(
        "select t.resource_id,t.name,t.upstream_name,t.title,t.description,t.input_schema,t.risk,t.action_key,
         t.risk_declared,t.annotations from catalog.tool_definition t
         where t.mcp_connection_id=$1 and t.status<>'DELETED' order by t.name",
    )
    .bind(connection.resource_id)
    .fetch_all(&mut *conn)
    .await?;
    let generation_digest: String = sqlx::query_scalar(
        "select tools_digest from catalog.mcp_connection_generation where resource_id=$1 and generation=$2",
    )
    .bind(connection.resource_id)
    .bind(connection.active_generation)
    .fetch_one(&mut *conn)
    .await?;
    let health: Option<HealthRow> = sqlx::query_as(
        "select health,checked_at,observed_tools_digest,server_name,server_version
         from projection.mcp_connection_health where resource_id=$1",
    )
    .bind(connection.resource_id)
    .fetch_optional(&mut *conn)
    .await?;
    let can_manage = connection.state != "DELETED"
        && check(
            &state.memory_service,
            "resource",
            connection.resource_id,
            "manage",
            ctx.tenant_principal_id,
        )
        .await?
        .is_some();
    let mut views = Vec::new();
    for tool in tools {
        let policy = super::Policy::of_action(&tool.action_key)
            .ok_or_else(|| super::unavailable("tool policy"))?;
        let hint = |key: &str| tool.annotations.as_ref().and_then(|a| a[key].as_bool());
        views.push(contracts::McpConnectionToolView {
            tool_resource_id: tool.resource_id.to_string(),
            name: tool.name,
            upstream_name: tool.upstream_name,
            title: tool.title,
            description: tool.description,
            input_schema_json: tool.input_schema.to_string(),
            risk: crate::governance::parse(&tool.risk).ok_or_else(|| super::unavailable("risk"))?,
            call_policy: crate::governance::parse(policy.wire())
                .ok_or_else(|| super::unavailable("policy"))?,
            risk_declared: tool.risk_declared,
            read_only_hint: hint("readOnlyHint"),
            destructive_hint: hint("destructiveHint"),
        });
    }
    let observed = health
        .as_ref()
        .and_then(|h| h.observed_tools_digest.clone());
    let drift = observed
        .as_ref()
        .is_some_and(|digest| digest != &generation_digest);
    Ok(contracts::McpConnectionView {
        id: connection.resource_id.to_string(),
        version: i64::from(connection.resource_version),
        slug: connection.slug.clone(),
        display_name: connection.display_name.clone(),
        endpoint_url: connection.endpoint_url.clone(),
        endpoint_host: connection.endpoint_host.clone(),
        transport: crate::governance::parse(&connection.transport)
            .ok_or_else(|| super::unavailable("transport"))?,
        auth_mode: crate::governance::parse(&connection.auth_mode)
            .ok_or_else(|| super::unavailable("auth"))?,
        api_key_header: connection.api_key_header.clone(),
        credential_set: connection.credential_ref.is_some() && connection.state != "DELETED",
        credential_updated_at: connection.credential_updated_at.map(|at| at.to_rfc3339()),
        visibility: crate::governance::parse(&connection.visibility)
            .ok_or_else(|| super::unavailable("visibility"))?,
        workspace_id: connection.workspace_id.map(|id| id.to_string()),
        owner_principal_id: connection.owner_principal_id.to_string(),
        owner_display_name: connection
            .owner_display_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_owned),
        state: crate::governance::parse(&connection.state)
            .ok_or_else(|| super::unavailable("state"))?,
        generation: i64::from(connection.active_generation),
        health: crate::governance::parse(
            health
                .as_ref()
                .map(|h| h.health.as_str())
                .unwrap_or("UNCHECKED"),
        )
        .ok_or_else(|| super::unavailable("health"))?,
        health_checked_at: health.as_ref().map(|h| h.checked_at.to_rfc3339()),
        server_name: health.as_ref().and_then(|h| h.server_name.clone()),
        server_version: health.as_ref().and_then(|h| h.server_version.clone()),
        tools_digest: generation_digest,
        observed_tools_digest: observed,
        drift,
        tools: views,
        can_manage,
        created_at: Some(connection.created_at.to_rfc3339()),
    })
}

async fn visible(
    state: &BffState,
    ctx: &ExecutionContext,
    connection: &Connection,
) -> Result<bool, Refusal> {
    if connection.state == "DELETED" || connection.projection_action_execution_id.is_some() {
        return Ok(false);
    }
    Ok(check(
        &state.memory_service,
        "resource",
        connection.resource_id,
        "discover",
        ctx.tenant_principal_id,
    )
    .await?
    .is_some())
}

/// `GET /api/v1/mcp-connections`
pub(crate) async fn list(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let ctx = match context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    match page(&state, &ctx).await {
        Ok(page) => Json(page).into_response(),
        Err(error) => error.respond(None),
    }
}

async fn page(
    state: &BffState,
    ctx: &ExecutionContext,
) -> Result<contracts::McpConnectionPage, Refusal> {
    let service = &state.memory_service;
    let mut conn = state.pool.acquire().await?;
    let rows: Vec<Connection> = sqlx::query_as(&format!(
        "{} where c.tenant_id=$1 and c.state<>'DELETED' and r.type_key='mcp.connection'
         order by c.created_at desc limit $2",
        super::CONNECTION_SELECT
    ))
    .bind(ctx.tenant_id)
    .bind(LIST_LIMIT)
    .fetch_all(&mut *conn)
    .await?;
    let mut connections = Vec::new();
    for row in &rows {
        if visible(state, ctx, row).await? {
            connections.push(view(state, &mut conn, ctx, row).await?);
        }
    }
    let policy = super::tenant_policy(&mut conn, ctx.tenant_id).await?;
    let platform = super::platform_egress()?;
    let manage = check(
        service,
        "tenant",
        ctx.tenant_id,
        "manage",
        ctx.tenant_principal_id,
    )
    .await?
    .is_some();
    let personal = may_register(
        service,
        &mut conn,
        ctx.tenant_id,
        ctx.tenant_principal_id,
        "PERSONAL",
        None,
    )
    .await?
    .is_some();
    let workspaces: Vec<Uuid> = sqlx::query_scalar(
        "select id from identity.workspace where tenant_id=$1 and state='ACTIVE' order by id limit 200",
    )
    .bind(ctx.tenant_id)
    .fetch_all(&mut *conn)
    .await?;
    let mut registrable = Vec::new();
    for workspace in workspaces {
        if check(
            service,
            "workspace",
            workspace,
            "manage",
            ctx.tenant_principal_id,
        )
        .await?
        .is_some()
        {
            registrable.push(workspace.to_string());
        }
    }
    Ok(contracts::McpConnectionPage {
        connections,
        policy: contracts::McpConnectionPolicyView {
            member_registration: crate::governance::parse(&policy.member_registration)
                .ok_or_else(|| super::unavailable("policy"))?,
            egress_host_suffixes: policy.egress_host_suffixes,
            platform_any_public_host: platform.any_public_host,
            platform_host_suffixes: platform.host_suffixes.clone(),
            version: i64::from(policy.version),
            can_manage: manage,
        },
        can_register_tenant: manage,
        can_register_personal: personal,
        registrable_workspace_ids: registrable,
    })
}

/// `GET /api/v1/mcp-connections/{id}`
pub(crate) async fn detail(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let ctx = match context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let result: Result<contracts::McpConnectionView, Refusal> = async {
        let mut conn = state.pool.acquire().await?;
        let connection = super::load(&mut conn, ctx.tenant_id, id, false)
            .await?
            .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
        if !visible(&state, &ctx, &connection).await? {
            return Err(Refusal::Precondition(ReasonCode::TargetNotFound));
        }
        view(&state, &mut conn, &ctx, &connection).await
    }
    .await;
    match result {
        Ok(view) => Json(view).into_response(),
        Err(error) => error.respond(None),
    }
}

async fn access_audit(
    state: &BffState,
    ctx: &ExecutionContext,
    id: Uuid,
    target: Option<Uuid>,
    result: &str,
) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    crate::audit::append(
        &mut tx,
        crate::audit::AuditEntry {
            event_key: format!("mcp-probe:{id}"),
            tenant_id: Some(ctx.tenant_id),
            workspace_id: None,
            operation_id: id,
            event_type: "ACCESS",
            human_identity_id: Some(ctx.human_identity_id),
            initiator_principal_id: Some(ctx.tenant_principal_id),
            actor_principal_id: Some(ctx.tenant_principal_id),
            action_key: AUDIT_KEY,
            action_version: 1,
            component_type_key: "core",
            target_type: target.map(|_| "RESOURCE"),
            target_id: target,
            parameter_hash: "",
            decision: if result == "SUCCEEDED" {
                "ALLOW"
            } else {
                "DENY"
            },
            result_code: result,
            result_exposure: "NONE",
            evidence_refs: Vec::new(),
            correlation_id: id,
        },
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

fn result_of(probe: &crate::mcp_client::Probe, host: &str) -> contracts::McpConnectionProbeResult {
    let tools = probe
        .tools
        .iter()
        .map(|tool| {
            let risk = Risk::suggested(&tool.annotations);
            contracts::McpProbedTool {
                upstream_name: tool.name.clone(),
                title: tool.title.clone(),
                description: tool.description.clone(),
                input_schema_json: tool.input_schema.to_string(),
                output_schema_json: tool.output_schema.as_ref().map(Value::to_string),
                read_only_hint: tool.annotations.read_only_hint,
                destructive_hint: tool.annotations.destructive_hint,
                idempotent_hint: tool.annotations.idempotent_hint,
                open_world_hint: tool.annotations.open_world_hint,
                suggested_risk: crate::governance::parse(risk.wire())
                    .unwrap_or(contracts::McpToolRisk::Destructive),
                suggested_call_policy: crate::governance::parse(risk.default_policy().wire())
                    .unwrap_or(contracts::McpToolCallPolicy::Approval),
            }
        })
        .collect();
    contracts::McpConnectionProbeResult {
        endpoint_host: host.to_owned(),
        server_name: probe.server.name.clone(),
        server_version: probe.server.version.clone(),
        protocol_version: probe.server.protocol_version.clone(),
        instructions: probe.server.instructions.clone(),
        tools_digest: crate::mcp_client::tools_digest(&probe.tools),
        tools,
    }
}

/// `POST /api/v1/mcp-connections/probes` — before a connector exists.
pub(crate) async fn probe(
    State(state): State<BffState>,
    headers: HeaderMap,
    Json(request): Json<contracts::McpConnectionProbeRequest>,
) -> Response {
    let ctx = match context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    match probe_new(&state, &ctx, request).await {
        Ok(result) => Json(result).into_response(),
        Err(error) => error.respond(None),
    }
}

async fn probe_new(
    state: &BffState,
    ctx: &ExecutionContext,
    request: contracts::McpConnectionProbeRequest,
) -> Result<contracts::McpConnectionProbeResult, Refusal> {
    let service = &state.memory_service;
    let url = crate::mcp_egress::parse_endpoint(&request.endpoint_url).map_err(|_| invalid())?;
    let auth_mode = super::wire(&request.auth_mode);
    let transport_wire = super::wire(&request.transport);
    let transport = super::transport(&transport_wire).ok_or_else(invalid)?;
    let header = request.api_key_header.as_deref();
    let value = request.credential.as_ref().map(|c| c.value.as_str());
    let attempt = request
        .oauth_attempt_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| invalid())?;
    let shape = (auth_mode == "API_KEY") == header.is_some()
        && header.is_none_or(super::valid_api_key_header)
        && matches!(auth_mode.as_str(), "API_KEY" | "BEARER") == value.is_some()
        && (auth_mode == "OAUTH") == attempt.is_some()
        && value.is_none_or(|v| !v.is_empty() && v.len() <= credential::MAX_VALUE_BYTES);
    if !shape {
        return Err(invalid());
    }
    let mut conn = state.pool.acquire().await?;
    let mut allowed = false;
    for visibility in ["PERSONAL", "TENANT"] {
        if may_register(
            service,
            &mut conn,
            ctx.tenant_id,
            ctx.tenant_principal_id,
            visibility,
            None,
        )
        .await?
        .is_some()
        {
            allowed = true;
            break;
        }
    }
    if !allowed {
        let workspaces: Vec<Uuid> = sqlx::query_scalar(
            "select id from identity.workspace where tenant_id=$1 and state='ACTIVE' order by id limit 200",
        )
        .bind(ctx.tenant_id)
        .fetch_all(&mut *conn)
        .await?;
        for workspace in workspaces {
            if check(
                service,
                "workspace",
                workspace,
                "manage",
                ctx.tenant_principal_id,
            )
            .await?
            .is_some()
            {
                allowed = true;
                break;
            }
        }
    }
    if !allowed {
        return Err(super::denied());
    }
    let credential_header = match attempt {
        Some(id) => {
            let attempt = super::oauth::completed_attempt(
                &mut conn,
                ctx,
                id,
                url.as_str(),
                &transport_wire,
                None,
            )
            .await?;
            super::oauth::attempt_credential(service, &attempt).await?
        }
        None => match value {
            Some(value) => credential::header_for(&auth_mode, header, value)?,
            None => None,
        },
    };
    let platform = super::platform_egress()?;
    let policy = super::tenant_policy(&mut conn, ctx.tenant_id).await?;
    drop(conn);
    let scope = EgressScope {
        platform: &platform,
        tenant_suffixes: &policy.egress_host_suffixes,
    };
    if !crate::mcp_egress::host_permitted(&scope, url.host_str().unwrap_or_default()) {
        return Err(super::denied());
    }
    let id = Uuid::new_v4();
    let probed = fresh_probe(&url, transport, credential_header.as_ref(), scope).await;
    let result = match &probed {
        Ok(_) => "SUCCEEDED",
        Err(Refusal::Unavailable(_)) => "UNKNOWN",
        Err(_) => "FAILED",
    };
    access_audit(state, ctx, id, None, result).await?;
    Ok(result_of(&probed?, url.host_str().unwrap_or_default()))
}

/// `POST /api/v1/mcp-connections/{id}/refresh` — re-probe with the saved credential,
/// record health, report drift against the confirmed generation (DD-149(10)).
pub(crate) async fn refresh(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let ctx = match context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    match refresh_connection(&state, &ctx, id).await {
        Ok(result) => Json(result).into_response(),
        Err(error) => error.respond(None),
    }
}

fn health_of(error: &Refusal) -> &'static str {
    match error.reason() {
        ReasonCode::BindingNotActive => "AUTH_FAILED",
        ReasonCode::PermissionDenied => "EGRESS_DENIED",
        ReasonCode::InvalidParameters | ReasonCode::PayloadTooLarge => "PROTOCOL_ERROR",
        _ => "UNREACHABLE",
    }
}

async fn refresh_connection(
    state: &BffState,
    ctx: &ExecutionContext,
    id: Uuid,
) -> Result<contracts::McpConnectionRefreshResult, Refusal> {
    let service = &state.memory_service;
    let mut conn = state.pool.acquire().await?;
    let connection = super::load(&mut conn, ctx.tenant_id, id, false)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    if connection.state == "DELETED" {
        return Err(Refusal::Precondition(ReasonCode::TargetNotFound));
    }
    check(service, "resource", id, "manage", ctx.tenant_principal_id)
        .await?
        .ok_or_else(super::denied)?;
    let platform = super::platform_egress()?;
    let policy = super::tenant_policy(&mut conn, ctx.tenant_id).await?;
    let snapshot: (String, Value) = sqlx::query_as(
        "select tools_digest,server_info from catalog.mcp_connection_generation where resource_id=$1 and generation=$2",
    )
    .bind(id)
    .bind(connection.active_generation)
    .fetch_one(&mut *conn)
    .await?;
    drop(conn);
    let scope = EgressScope {
        platform: &platform,
        tenant_suffixes: &policy.egress_host_suffixes,
    };
    let url = connection.url()?;
    let probed = async {
        let credential_header = credential::current(service, &connection).await?;
        fresh_probe(
            &url,
            connection.transport()?,
            credential_header.as_ref(),
            scope,
        )
        .await
    }
    .await;
    let audit_id = Uuid::new_v4();
    let mut conn = state.pool.acquire().await?;
    let probe = match probed {
        Ok(probe) => probe,
        Err(error) => {
            let health = if connection.auth_mode == "OAUTH"
                && error.reason() == ReasonCode::BindingNotActive
            {
                "REAUTHORIZATION_REQUIRED"
            } else {
                health_of(&error)
            };
            sqlx::query(
                "insert into projection.mcp_connection_health(resource_id,health,checked_at) values($1,$2,now())
                 on conflict(resource_id) do update set health=excluded.health,checked_at=excluded.checked_at",
            )
            .bind(id)
            .bind(health)
            .execute(&mut *conn)
            .await?;
            access_audit(state, ctx, audit_id, Some(id), "FAILED").await?;
            return Ok(contracts::McpConnectionRefreshResult {
                health: crate::governance::parse(health)
                    .unwrap_or(contracts::McpConnectionHealth::Unreachable),
                checked_at: Utc::now().to_rfc3339(),
                probe: None,
                drift: false,
                added_tools: Vec::new(),
                removed_tools: Vec::new(),
                changed_tools: Vec::new(),
            });
        }
    };
    let digest = crate::mcp_client::tools_digest(&probe.tools);
    super::command::record_health(&mut conn, id, "OK", Some(&digest), &probe).await?;
    drop(conn);
    access_audit(state, ctx, audit_id, Some(id), "SUCCEEDED").await?;
    // The confirmation listed every upstream tool with its digest (enabled or not).
    let listed: Vec<(String, String)> = snapshot.1["tools"]
        .as_array()
        .map(|tools| {
            tools
                .iter()
                .filter_map(|t| {
                    Some((
                        t["name"].as_str()?.to_owned(),
                        t["digest"].as_str()?.to_owned(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();
    let mut added = Vec::new();
    let mut changed = Vec::new();
    for tool in &probe.tools {
        match listed.iter().find(|(name, _)| name == &tool.name) {
            None => added.push(tool.name.clone()),
            Some((_, digest)) if digest != &super::command::probed_digest(tool) => {
                changed.push(tool.name.clone())
            }
            Some(_) => {}
        }
    }
    let removed = listed
        .iter()
        .filter(|(name, _)| !probe.tools.iter().any(|t| &t.name == name))
        .map(|(name, _)| name.clone())
        .collect();
    Ok(contracts::McpConnectionRefreshResult {
        health: contracts::McpConnectionHealth::Ok,
        checked_at: Utc::now().to_rfc3339(),
        drift: digest != snapshot.0,
        probe: Some(result_of(&probe, &connection.endpoint_host)),
        added_tools: added,
        removed_tools: removed,
        changed_tools: changed,
    })
}
