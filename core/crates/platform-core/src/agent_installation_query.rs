//! DD-25/27/50/66、17 §8：Installation 管理只读事实，不建立或修复投影。
//! Workspace scope 与 Resource read 都 fresh；不会调用带副作用的 runtime health/reconcile。

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::FromRow;
use uuid::Uuid;

use crate::bff::{resolve_execution_context, BffState, ExecutionContext};
use crate::governance::Refusal;
use crate::spicedb::Consistency;

#[derive(Deserialize)]
pub struct PageQuery {
    #[serde(rename = "workspaceId")]
    workspace_id: Uuid,
    offset: Option<i64>,
}

#[derive(FromRow)]
struct InstallationRow {
    resource_id: Uuid,
    workspace_id: Uuid,
    agent_resource_id: Uuid,
    pinned_version_asset_id: Uuid,
    agent_principal_id: Uuid,
    agent_principal_state: String,
    owner_principal_id: Uuid,
    resource_version: i32,
    resource_state: String,
    state: String,
    active_projection_generation: Option<i64>,
    channel_status: Option<String>,
    channel_triggers: Option<Vec<String>>,
    channel_id: Option<Uuid>,
    projection_generation: Option<i64>,
    projection_version: Option<Uuid>,
    runtime_profile_key: Option<String>,
    projection_config_hash: Option<String>,
    projection_state: Option<String>,
}

// 只选已固定的 Installation/Version/AGENT 关系。正文、SecretRef、Gateway key、
// CODEX_HOME、Memory 正文及内部 native endpoint 均不进入查询结果。
const ROW: &str = "select i.resource_id,i.workspace_id,i.agent_resource_id,i.pinned_version_asset_id,
    i.agent_principal_id,a.status as agent_principal_state,r.owner_principal_id,
    r.version as resource_version,r.state as resource_state,i.state,i.active_projection_generation,
    cb.status as channel_status,cb.triggers as channel_triggers,wb.channel_id,
    p.generation as projection_generation,p.agent_version_asset_id as projection_version,
    p.runtime_profile_key,p.config_hash as projection_config_hash,p.state as projection_state
  from catalog.agent_installation i
  join catalog.resource r on r.id=i.resource_id and r.type_key='agent.installation'
    and r.home_workspace_id=i.workspace_id
  join identity.workspace w on w.id=i.workspace_id and w.tenant_id=r.tenant_id
  join catalog.agent_definition d on d.resource_id=i.agent_resource_id
  join catalog.resource dr on dr.id=d.resource_id and dr.tenant_id=r.tenant_id
  join catalog.agent_version v on v.asset_id=i.pinned_version_asset_id and v.agent_resource_id=d.resource_id
  join catalog.asset av on av.id=v.asset_id and av.tenant_id=r.tenant_id
  join identity.principal a on a.id=i.agent_principal_id and a.tenant_id=r.tenant_id and a.kind='AGENT'
  left join catalog.channel_agent_binding cb on cb.installation_resource_id=i.resource_id and cb.workspace_id=w.id
  left join projection.workspace_buzz_binding wb on wb.workspace_id=w.id
  left join lateral (select p.* from catalog.agent_runtime_projection p
    where p.installation_resource_id=i.resource_id
      and p.agent_version_asset_id=i.pinned_version_asset_id
      and (i.active_projection_generation is null or p.generation=i.active_projection_generation)
    order by p.generation desc limit 1) p on true
  where r.tenant_id=$1 and r.state<>'DELETED'";

async fn scope(state: &BffState, ctx: &ExecutionContext, workspace: Uuid) -> Result<(), Response> {
    let admitted = crate::web_transport::workspace_admissions(state, ctx, &[workspace])
        .await
        .map_err(IntoResponse::into_response)?;
    if admitted.contains_key(&workspace) {
        Ok(())
    } else {
        Err(StatusCode::FORBIDDEN.into_response())
    }
}

async fn view(
    state: &BffState,
    ctx: &ExecutionContext,
    row: InstallationRow,
) -> Result<contracts::AgentInstallationView, Response> {
    let matches = state
        .governance
        .spicedb
        .resource_projection_matches_in_workspace(
            &row.resource_id.to_string(),
            &ctx.tenant_id.to_string(),
            &row.owner_principal_id.to_string(),
            Some(&row.workspace_id.to_string()),
            state.governance.cfg.relationship_page,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()).respond(None))?;
    if !matches {
        return Err(Refusal::Unavailable("Installation Resource 投影未对账".into()).respond(None));
    }
    let channel = match (row.channel_status, row.channel_triggers) {
        (Some(status), Some(triggers)) => Some(json!({
            "status": status, "triggers": triggers,
            "channelId": row.channel_id.map(|id| id.to_string()),
        })),
        (None, None) => None,
        _ => return Err(StatusCode::SERVICE_UNAVAILABLE.into_response()),
    };
    let projection = match (
        row.projection_generation,
        row.projection_version,
        row.runtime_profile_key,
        row.projection_config_hash,
        row.projection_state,
    ) {
        (Some(generation), Some(version), Some(profile), Some(hash), Some(state)) => Some(json!({
            "generation": generation, "agentVersionAssetId": version.to_string(),
            "runtimeProfileKey": profile, "configHash": hash, "state": state,
        })),
        (None, None, None, None, None) => None,
        _ => return Err(StatusCode::SERVICE_UNAVAILABLE.into_response()),
    };
    // 用原四侧合同解码，未知 enum 或畸形持久事实不下发为可用状态。
    serde_json::from_value(json!({
        "resourceId": row.resource_id.to_string(), "workspaceId": row.workspace_id.to_string(),
        "agentResourceId": row.agent_resource_id.to_string(),
        "pinnedVersionAssetId": row.pinned_version_asset_id.to_string(),
        "agentPrincipalId": row.agent_principal_id.to_string(),
        "agentPrincipalState": row.agent_principal_state,
        "ownerPrincipalId": row.owner_principal_id.to_string(),
        "resourceVersion": row.resource_version, "resourceState": row.resource_state,
        "state": row.state, "activeProjectionGeneration": row.active_projection_generation,
        "channelBinding": channel, "projection": projection,
    }))
    .map_err(|_| {
        tracing::error!("Installation 查询事实不符合共享契约");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })
}

pub async fn list(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(q): Query<PageQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(r) => return r,
    };
    if let Err(r) = scope(&state, &ctx, q.workspace_id).await {
        return r;
    }
    let offset = q.offset.unwrap_or(0);
    let limit = i64::from(state.governance.cfg.relationship_page);
    if offset < 0 || limit <= 0 || offset.checked_add(limit).is_none() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let sql = format!("{ROW} and i.workspace_id=$2 order by r.id offset $3 limit $4");
    let rows: Vec<InstallationRow> = match sqlx::query_as(&sql)
        .bind(ctx.tenant_id)
        .bind(q.workspace_id)
        .bind(offset)
        .bind(limit)
        .fetch_all(&state.pool)
        .await
    {
        Ok(rows) => rows,
        Err(e) => return crate::service_api::unavailable(e),
    };
    let next =
        (rows.len() == usize::try_from(limit).unwrap_or(usize::MAX)).then_some(offset + limit);
    let ids: Vec<String> = rows.iter().map(|r| r.resource_id.to_string()).collect();
    let allowed = match state
        .governance
        .spicedb
        .check_bulk(
            "resource",
            &ids,
            "read",
            &ctx.tenant_principal_id.to_string(),
        )
        .await
    {
        Ok(ids) => ids,
        Err(e) => return Refusal::Unavailable(e.to_string()).respond(None),
    };
    let mut views = Vec::new();
    for row in rows {
        if !allowed.contains(&row.resource_id.to_string()) {
            continue;
        }
        match view(&state, &ctx, row).await {
            Ok(v) => views.push(v),
            Err(r) => return r,
        }
    }
    match serde_json::from_value::<contracts::AgentInstallationPage>(json!({
        "installations": views, "nextOffset": next,
    })) {
        Ok(page) => Json(page).into_response(),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

pub async fn get(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(r) => return r,
    };
    let sql = format!("{ROW} and r.id=$2");
    let row: InstallationRow = match sqlx::query_as(&sql)
        .bind(ctx.tenant_id)
        .bind(id)
        .fetch_optional(&state.pool)
        .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return crate::service_api::unavailable(e),
    };
    if let Err(r) = scope(&state, &ctx, row.workspace_id).await {
        return r;
    }
    match state
        .governance
        .spicedb
        .check(
            "resource",
            &id.to_string(),
            "read",
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
    {
        Ok(c) if c.allowed => {}
        Ok(_) => return StatusCode::FORBIDDEN.into_response(),
        Err(e) => return Refusal::Unavailable(e.to_string()).respond(None),
    }
    match view(&state, &ctx, row).await {
        Ok(v) => Json(v).into_response(),
        Err(r) => r,
    }
}
