//! DD-49/50、03 §6、17 §8: governed Grant metadata and exact eligible scopes.
//! No permission writes, default grants, runtime dispatch, tokens, or business body.

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

use crate::{
    bff::{resolve_execution_context, BffState, ExecutionContext},
    governance::{delegation, Refusal},
    spicedb::Consistency,
};

#[derive(Deserialize)]
pub struct PageQuery {
    offset: Option<i64>,
}

fn offset(q: &PageQuery, limit: i64) -> Result<i64, StatusCode> {
    let offset = q.offset.unwrap_or(0);
    if offset < 0 || limit <= 0 || offset.checked_add(limit).is_none() {
        Err(StatusCode::BAD_REQUEST)
    } else {
        Ok(offset)
    }
}

async fn authorized(
    state: &BffState,
    conn: &mut PgConnection,
    ctx: &ExecutionContext,
    id: Uuid,
) -> Result<delegation::Installation, Response> {
    let row = delegation::installation(conn, ctx.tenant_id, id, false)
        .await
        .map_err(crate::service_api::unavailable)?
        .ok_or_else(|| StatusCode::NOT_FOUND.into_response())?;
    let admitted = crate::web_transport::workspace_admissions(state, ctx, &[row.workspace_id])
        .await
        .map_err(IntoResponse::into_response)?;
    if !admitted.contains_key(&row.workspace_id) {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    if !delegation::projection_matches(&state.governance, &row)
        .await
        .map_err(|error| error.respond(None))?
    {
        return Err(Refusal::Unavailable("Installation owner 投影不可核验".into()).respond(None));
    }
    let checked = state
        .governance
        .spicedb
        .check(
            "resource",
            &id.to_string(),
            "delegate",
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Delegation 管理权限不可核验".into()).respond(None))?;
    if checked.zed_token.is_empty() {
        return Err(
            Refusal::Unavailable("Delegation 管理权限缺 checked revision".into()).respond(None),
        );
    }
    if !checked.allowed {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    Ok(row)
}

async fn exposed(conn: &mut PgConnection, key: &str) -> Result<bool, Response> {
    let registered: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.action_definition
        where action_key=$1 and status='ACTIVE' and target_type='RESOURCE'
          and tenant_rule='SESSION_TENANT' and workspace_rule='TARGET_HOME_WORKSPACE'
          and permission_object_type='resource' and permission='delegate' and execution_mode='SYNC'
          and confirmation_mode='EXPLICIT' and approval_policy_id is null and approval_policy_version is null
          and capacity_policy='NONE' and quota_policy='NONE' and cardinality(meters)=0)",
    ).bind(key).fetch_one(conn).await.map_err(crate::service_api::unavailable)?;
    Ok(registered && crate::capability_registry::action_exposed(key))
}

#[derive(FromRow)]
struct GrantRow {
    id: Uuid,
    version: i32,
    grantor_principal_id: Uuid,
    state: String,
    valid_from: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    max_uses: Option<i64>,
    uses: i64,
}

pub async fn list(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Query(q): Query<PageQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(error) => return error,
    };
    let limit = i64::from(state.governance.cfg.relationship_page);
    let offset = match offset(&q, limit) {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let mut conn = match state.pool.acquire().await {
        Ok(conn) => conn,
        Err(error) => return crate::service_api::unavailable(error),
    };
    let installation = match authorized(&state, &mut conn, &ctx, id).await {
        Ok(row) => row,
        Err(error) => return error,
    };
    let rows: Vec<GrantRow> = match sqlx::query_as(
        "select g.id,g.version,g.grantor_principal_id,g.state,g.valid_from,g.expires_at,g.max_uses,
            (select count(*) from admission.delegation_use u where u.delegation_id=g.id) uses
        from admission.delegation_grant g
        where g.tenant_id=$1 and g.workspace_id=$2 and g.installation_resource_id=$3
          and g.agent_principal_id=$4 order by g.id offset $5 limit $6",
    )
    .bind(ctx.tenant_id)
    .bind(installation.workspace_id)
    .bind(id)
    .bind(installation.agent_principal_id)
    .bind(offset)
    .bind(limit)
    .fetch_all(&mut *conn)
    .await
    {
        Ok(rows) => rows,
        Err(error) => return crate::service_api::unavailable(error),
    };
    let next =
        (rows.len() == usize::try_from(limit).unwrap_or(usize::MAX)).then_some(offset + limit);
    let mut grants = Vec::new();
    for row in rows {
        // Read historical pinned policies too: revoked/expired references are
        // evidence, not a new authorization or a rewrite to the latest policy.
        let scopes: Vec<Value> = match sqlx::query_scalar(
            "select jsonb_strip_nulls(jsonb_build_object(
                'actionKey',s.action_key,'actionVersion',s.action_version,'targetType',s.target_type,
                'targetId',s.target_id,'createWorkspaceId',s.create_workspace_id,'toolResourceId',s.tool_resource_id,
                'resultExposureMode',p.mode,'outputSchemaHash',p.output_schema_hash,'redactionPolicy',p.redaction_policy))
            from admission.delegation_scope s left join catalog.result_exposure_policy p
              on p.id=s.result_exposure_policy_id and p.version=s.result_exposure_policy_version
              and p.tenant_id=$2
            where s.delegation_id=$1
            order by s.action_key,s.action_version,s.target_type,s.target_id,s.create_workspace_id,s.tool_resource_id",
        ).bind(row.id).bind(ctx.tenant_id).fetch_all(&mut *conn).await {
            Ok(scopes) => scopes, Err(error) => return crate::service_api::unavailable(error),
        };
        if scopes.is_empty() {
            return Refusal::Unavailable("DelegationGrant 缺固定 Scope/Exposure 引用".into())
                .respond(None);
        }
        let value = json!({"delegationId":row.id,"delegationVersion":row.version,
            "grantorPrincipalId":row.grantor_principal_id,"state":row.state,"uses":row.uses,
            "parameters":{"validFrom":row.valid_from,"expiresAt":row.expires_at,
                "maxUses":row.max_uses,"scopes":scopes}});
        match serde_json::from_value::<contracts::GrantElement>(value) {
            Ok(grant) => grants.push(grant),
            Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
        }
    }
    let can_grant = match exposed(&mut conn, "agent.delegation.grant").await {
        Ok(value) => value,
        Err(error) => return error,
    };
    let can_revoke = match exposed(&mut conn, "agent.delegation.revoke").await {
        Ok(value) => value,
        Err(error) => return error,
    };
    Json(contracts::AgentDelegationPage {
        installation_resource_id: id.to_string(),
        resource_version: i64::from(installation.version),
        workspace_id: installation.workspace_id.to_string(),
        can_grant,
        can_revoke,
        grants,
        next_offset: next,
    })
    .into_response()
}

#[derive(FromRow)]
struct TargetRow {
    resource_id: Uuid,
    action_key: String,
    action_version: i32,
    target_type: String,
    redaction_policy: String,
    tool_resource_id: Option<Uuid>,
    output_schema_hash: Option<String>,
    result_exposure_mode: Option<String>,
}

pub async fn targets(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Query(q): Query<PageQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(error) => return error,
    };
    let limit = i64::from(state.governance.cfg.relationship_page);
    let offset = match offset(&q, limit) {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let mut conn = match state.pool.acquire().await {
        Ok(conn) => conn,
        Err(error) => return crate::service_api::unavailable(error),
    };
    let installation = match authorized(&state, &mut conn, &ctx, id).await {
        Ok(row) => row,
        Err(error) => return error,
    };
    let can_grant = match exposed(&mut conn, "agent.delegation.grant").await {
        Ok(value) => value,
        Err(error) => return error,
    };
    let mut scopes = Vec::new();
    let mut next = None;
    if can_grant {
        // Real Invocation producers and immutable installed ToolBindings only.
        // Approved metadata never substitutes for the per-target fresh checks.
        let rows: Vec<TargetRow> = match sqlx::query_as(
            "select * from (select r.id resource_id,a.action_key,a.version action_version,a.target_type,a.obs_redaction_policy redaction_policy,
            null::uuid tool_resource_id,null::text output_schema_hash,null::text result_exposure_mode
            from catalog.automation_definition d join catalog.resource r on r.id=d.resource_id
            join catalog.action_definition a on a.action_key='automation.run' and a.status='ACTIVE' and a.component_release_id is null
            where r.tenant_id=$1 and r.home_workspace_id=$2 and r.type_key='automation'
              and r.owner_principal_id=$3 and r.state='ACTIVE' and r.projection_action_execution_id is null
              and r.application_binding_id is null and d.workspace_id=$2 and d.executor_installation_resource_id=$4
            union all
            select r.id resource_id,a.action_key,a.version action_version,a.target_type,a.obs_redaction_policy redaction_policy,
            null::uuid tool_resource_id,null::text output_schema_hash,null::text result_exposure_mode
            from catalog.resource r join catalog.agent_installation i on i.resource_id=r.id
            join catalog.action_definition a on a.action_key='agent.invoke' and a.status='ACTIVE' and a.component_release_id is null
            where r.id=$4 and r.tenant_id=$1 and r.home_workspace_id=$2 and r.type_key='agent.installation'
              and r.state='ACTIVE' and r.projection_action_execution_id is null and r.application_binding_id is null
              and i.workspace_id=$2 and i.state='ACTIVE'
            union all
            select i.resource_id,a.action_key,a.version action_version,a.target_type,a.obs_redaction_policy redaction_policy,
            t.resource_id tool_resource_id,t.output_schema_hash,null::text result_exposure_mode
            from catalog.tool_binding b join catalog.agent_installation i on i.resource_id=b.installation_resource_id
            join catalog.resource r on r.id=i.resource_id and r.tenant_id=$1 and r.home_workspace_id=$2
              and r.state='ACTIVE' and r.projection_action_execution_id is null
            join catalog.tool_definition t on t.resource_id=b.tool_resource_id and t.status='ACTIVE' and t.source='PLATFORM_NATIVE'
            join catalog.action_definition a on a.action_key=t.action_key and a.status='ACTIVE' and a.component_release_id is null
            where i.resource_id=$4 and i.state='ACTIVE' and i.workspace_id=$2 and b.workspace_id=$2
              and b.projection_generation=i.active_projection_generation and b.agent_version_asset_id=i.pinned_version_asset_id
              and b.status in ('NO_PERMISSION','ACTIVE') and t.action_key in ('agent.memory.entry.list','agent.memory.entry.read')
            union all
            select target.id resource_id,a.action_key,a.version action_version,a.target_type,a.obs_redaction_policy redaction_policy,
              t.resource_id tool_resource_id,t.output_schema_hash,a.result_exposure result_exposure_mode
            from catalog.tool_binding tool_binding
            join catalog.agent_installation i on i.resource_id=tool_binding.installation_resource_id
              and i.active_projection_generation=tool_binding.projection_generation
              and i.pinned_version_asset_id=tool_binding.agent_version_asset_id
            join catalog.agent_runtime_projection agent on agent.installation_resource_id=i.resource_id
              and agent.generation=tool_binding.projection_generation and agent.agent_version_asset_id=tool_binding.agent_version_asset_id
              and agent.state='ACTIVE'
            join catalog.agent_version v on v.asset_id=tool_binding.agent_version_asset_id
            join catalog.tool_definition t on t.resource_id=tool_binding.tool_resource_id and t.source='APPLICATION' and t.status='ACTIVE'
            join catalog.resource tool on tool.id=t.resource_id and tool.tenant_id=$1 and tool.state='ACTIVE'
              and tool.type_key='tool.definition' and tool.projection_action_execution_id is null
            join catalog.application_binding implementation on implementation.id=tool.application_binding_id
              and implementation.tenant_id=$1 and implementation.state='ACTIVE'
              and (implementation.workspace_id is null or implementation.workspace_id=$2)
            join projection.application_runtime runtime on runtime.binding_id=implementation.id
              and runtime.generation=t.application_projection_generation and runtime.state='ACTIVE' and runtime.gateway_state='ACTIVE'
              and implementation.active_projection_generation=runtime.generation
              and runtime.component_release_id=implementation.component_release_id
            join catalog.action_definition a on a.component_release_id=runtime.component_release_id
              and a.action_key=t.action_key and a.status='ACTIVE'
            join catalog.resource r on r.application_binding_id=implementation.id and r.tenant_id=$1
              and r.state='ACTIVE' and r.projection_action_execution_id is null
              and (r.home_workspace_id is null or r.home_workspace_id=$2)
            join catalog.resource_type_definition type on type.id=r.resource_type_definition_id
              and type.type_key=r.type_key and type.component_release_id=runtime.component_release_id and type.status='ACTIVE'
            join lateral (select r.id where a.target_type='RESOURCE'
              union all select asset.id from catalog.asset asset where a.target_type='ASSET'
                and asset.resource_id=r.id and asset.tenant_id=r.tenant_id and asset.state='ACTIVE'
                and asset.projection_action_execution_id is null) target on true
            where i.resource_id=$4 and i.state='ACTIVE' and i.workspace_id=$2
              and tool_binding.workspace_id=$2 and tool_binding.status in ('NO_PERMISSION','ACTIVE')
              and v.content->'capabilityRequirements' @> jsonb_build_array(t.capability_contract_key)) targets
            order by resource_id,action_key,tool_resource_id offset $5 limit $6",
        ).bind(ctx.tenant_id).bind(installation.workspace_id).bind(ctx.tenant_principal_id)
            .bind(id).bind(offset).bind(limit).fetch_all(&mut *conn).await {
            Ok(rows) => rows, Err(error) => return crate::service_api::unavailable(error),
        };
        next =
            (rows.len() == usize::try_from(limit).unwrap_or(usize::MAX)).then_some(offset + limit);
        for row in rows {
            let mode = match row.result_exposure_mode {
                Some(mode) => match serde_json::from_value(serde_json::Value::String(mode)) {
                    Ok(mode) => mode,
                    Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
                },
                None => contracts::ResultExposureMode::ConsumeOnly,
            };
            let scope = contracts::ScopeElement {
                action_key: row.action_key,
                action_version: i64::from(row.action_version),
                target_type: row.target_type,
                target_id: Some(row.resource_id.to_string()),
                create_workspace_id: None,
                tool_resource_id: row.tool_resource_id.map(|id| id.to_string()),
                result_exposure_mode: mode,
                output_schema_hash: row
                    .output_schema_hash
                    .unwrap_or_else(delegation::output_schema_hash),
                redaction_policy: row.redaction_policy,
            };
            match delegation::validate_scope(
                &state.governance,
                &mut conn,
                ctx.tenant_id,
                ctx.tenant_principal_id,
                &installation,
                &scope,
            )
            .await
            {
                Ok(()) => scopes.push(scope),
                Err(Refusal::Denied(_) | Refusal::Blocked(_) | Refusal::Conflict(_)) => {}
                Err(error) => return error.respond(None),
            }
        }
    }
    Json(contracts::AgentDelegationTargetPage {
        installation_resource_id: id.to_string(),
        resource_version: i64::from(installation.version),
        workspace_id: installation.workspace_id.to_string(),
        scopes,
        next_offset: next,
    })
    .into_response()
}
