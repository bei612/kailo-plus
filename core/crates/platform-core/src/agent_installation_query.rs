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
    agent_pubkey: Option<String>,
    agent_principal_state: String,
    owner_principal_id: Uuid,
    resource_version: i32,
    resource_state: String,
    projection_action_execution_id: Option<Uuid>,
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
    version_content: serde_json::Value,
    pinned_published: bool,
}

// 只选已固定的 Installation/Version/AGENT 关系。正文、SecretRef、Gateway key、
// CODEX_HOME、Memory 正文及内部 native endpoint 均不进入查询结果。
const ROW: &str = "select i.resource_id,i.workspace_id,i.agent_resource_id,i.pinned_version_asset_id,
    i.agent_principal_id,agent_identity.pubkey as agent_pubkey,a.status as agent_principal_state,r.owner_principal_id,
    r.version as resource_version,r.state as resource_state,r.projection_action_execution_id,i.state,i.active_projection_generation,
    cb.status as channel_status,cb.triggers as channel_triggers,wb.channel_id,
    p.generation as projection_generation,p.agent_version_asset_id as projection_version,
    p.runtime_profile_key,p.config_hash as projection_config_hash,p.state as projection_state,v.content version_content,
    (v.state='PUBLISHED' and av.state='PUBLISHED' and av.projection_action_execution_id is null
      and d.status='ACTIVE' and dr.state='ACTIVE' and dr.projection_action_execution_id is null) as pinned_published
  from catalog.agent_installation i
  join catalog.resource r on r.id=i.resource_id and r.type_key='agent.installation'
    and r.home_workspace_id=i.workspace_id
  join identity.workspace w on w.id=i.workspace_id and w.tenant_id=r.tenant_id
  join catalog.agent_definition d on d.resource_id=i.agent_resource_id
  join catalog.resource dr on dr.id=d.resource_id and dr.tenant_id=r.tenant_id
  join catalog.agent_version v on v.asset_id=i.pinned_version_asset_id and v.agent_resource_id=d.resource_id
  join catalog.asset av on av.id=v.asset_id and av.tenant_id=r.tenant_id
  join identity.principal a on a.id=i.agent_principal_id and a.tenant_id=r.tenant_id and a.kind='AGENT'
  left join catalog.agent_memory_binding memory on memory.installation_resource_id=i.resource_id and memory.state='ACTIVE'
  left join identity.buzz_identity_binding agent_identity on agent_identity.pubkey=memory.agent_buzz_identity_binding_id
    and agent_identity.principal_id=a.id and agent_identity.tenant_id=r.tenant_id
    and agent_identity.kind='AGENT' and agent_identity.custody='SERVER' and agent_identity.state='ACTIVE'
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
    // Entry hints only (17 §8, DD-125(6)): each submission is fully re-admitted.
    let settled = row.resource_state == "ACTIVE" && row.projection_action_execution_id.is_none();
    let running = settled && row.state == "ACTIVE";
    let upgrade_offered = running && offered(state, "agent.installation.upgrade").await?;
    let disable_offered =
        running && offered(state, crate::agent_installation::lifecycle::DISABLE_ACTION).await?;
    let enable_offered = settled
        && row.state == "DISABLED"
        && row.pinned_published
        && offered(state, crate::agent_installation::lifecycle::ENABLE_ACTION).await?;
    let manage = (upgrade_offered || disable_offered || enable_offered)
        && fresh(state, ctx, row.resource_id, "manage").await?;
    let can_upgrade = upgrade_offered && manage;
    let can_audit = fresh(state, ctx, row.resource_id, "audit").await?;
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
    let permission = crate::governance::installation_permission::view(
        &state.governance,
        ctx.tenant_id,
        ctx.tenant_principal_id,
        row.resource_id,
    )
    .await
    .map_err(|e| e.respond(None))?;
    let read_permission = crate::governance::installation_permission::read_view(
        &state.governance,
        ctx.tenant_id,
        ctx.tenant_principal_id,
        row.resource_id,
    )
    .await
    .map_err(|e| e.respond(None))?;
    let display_name = row
        .version_content
        .pointer("/personaIdentity/displayName")
        .and_then(serde_json::Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .map(str::to_owned);
    let mut result_targets = Vec::new();
    if row.state == "ACTIVE"
        && row.resource_state == "ACTIVE"
        && row.agent_principal_state == "ACTIVE"
        && projection.as_ref().is_some_and(|p| {
            p["state"] == "ACTIVE" && p["generation"].as_i64() == row.active_projection_generation
        })
    {
        let content: contracts::AgentVersionContent =
            serde_json::from_value(row.version_content)
                .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
        match crate::agent_version::reply_to_channel(&content) {
            Ok(_) => result_targets.extend(["TRIGGER_THREAD", "CHANNEL"]),
            Err(Refusal::Blocked(_) | Refusal::Precondition(_)) => {}
            Err(error) => return Err(error.respond(None)),
        }
    }
    // 用原四侧合同解码，未知 enum 或畸形持久事实不下发为可用状态。
    serde_json::from_value(json!({
        "resourceId": row.resource_id.to_string(), "workspaceId": row.workspace_id.to_string(),
        "agentResourceId": row.agent_resource_id.to_string(),
        "pinnedVersionAssetId": row.pinned_version_asset_id.to_string(),
        "agentPrincipalId": row.agent_principal_id.to_string(),
        "agentPubkey": row.agent_pubkey,
        "agentPrincipalState": row.agent_principal_state,
        "agentDisplayName": display_name,
        "ownerPrincipalId": row.owner_principal_id.to_string(),
        "resourceVersion": row.resource_version, "resourceState": row.resource_state,
        "state": row.state, "activeProjectionGeneration": row.active_projection_generation,
        "channelBinding": channel, "projection": projection, "executionPermission": permission,
        "readPermission": read_permission,
        "automationResultTargets": result_targets,
        "canUpgrade": can_upgrade,
        "canDisable": disable_offered && manage,
        "canEnable": enable_offered && manage,
        "canRestart": can_upgrade && row.pinned_published,
        "canAudit": can_audit,
    }))
    .map_err(|_| {
        tracing::error!("Installation 查询事实不符合共享契约");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })
}

/// The action is released (capability registry) and its catalog definition is ACTIVE.
async fn offered(state: &BffState, key: &str) -> Result<bool, Response> {
    Ok(crate::capability_registry::action_exposed(key)
        && crate::governance::active_definition(&state.pool, key)
            .await
            .map_err(crate::service_api::unavailable)?
            .is_some())
}

/// Fresh, fully consistent permission of the viewer on the Installation Resource.
async fn fresh(
    state: &BffState,
    ctx: &ExecutionContext,
    resource: Uuid,
    permission: &str,
) -> Result<bool, Response> {
    let proof = state
        .governance
        .spicedb
        .check(
            "resource",
            &resource.to_string(),
            permission,
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    if proof.zed_token.is_empty() {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    Ok(proof.allowed)
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
    Json(contracts::AgentInstallationPage {
        installations: views,
        next_offset: next,
    })
    .into_response()
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
    match read_view(&state, &ctx, id).await {
        Ok(v) => Json(v).into_response(),
        Err(r) => r,
    }
}

/// 05 §2.10、17 §8：Installation 成员使用权目录；与单项读取同一 scope 与 fresh read。
pub async fn users(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(r) => return r,
    };
    if let Err(r) = read_view(&state, &ctx, id).await {
        return r;
    }
    let page = match crate::governance::installation_permission::use_view(
        &state.governance,
        ctx.tenant_id,
        ctx.tenant_principal_id,
        id,
    )
    .await
    {
        Ok(Some(page)) => page,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return e.respond(None),
    };
    match serde_json::from_value::<contracts::AgentInstallationUsePage>(page) {
        Ok(page) => Json(page).into_response(),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

#[derive(FromRow)]
struct ToolBindingRow {
    tool_resource_id: Uuid,
    name: String,
    source: String,
    capability_contract_key: Option<String>,
    application_binding_id: Option<Uuid>,
    status: String,
}

/// DD-122 (8): only existing reason codes explain a non-ACTIVE ToolBinding.
fn tool_reason(status: &str) -> Option<&'static str> {
    match status {
        "NO_PERMISSION" => Some("PERMISSION_DENIED"),
        "REVOKED" => Some("BINDING_NOT_ACTIVE"),
        "PENDING" => Some("PROJECTION_DELAYED"),
        _ => None,
    }
}

/// DD-122: the Tools of the Installation's current generation and their
/// ToolBinding state. Same Workspace scope and fresh Installation read as the
/// detail view; it never grants, resolves or repairs a binding.
pub async fn tools(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(r) => return r,
    };
    if let Err(r) = read_view(&state, &ctx, id).await {
        return r;
    }
    match tool_page(&state, &ctx, id).await {
        Ok(page) => Json(page).into_response(),
        Err(r) => r,
    }
}

async fn tool_page(
    state: &BffState,
    ctx: &ExecutionContext,
    id: Uuid,
) -> Result<contracts::AgentInstallationToolPage, Response> {
    // The active generation; before the first activation, the pending one.
    let current: Option<(i64, serde_json::Value)> = sqlx::query_as(
        "select p.generation,v.content from catalog.agent_installation i
        join catalog.resource r on r.id=i.resource_id and r.tenant_id=$2
        join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
        join catalog.agent_version v on v.asset_id=p.agent_version_asset_id
        where i.resource_id=$1 and (i.active_projection_generation is null
          or p.generation=i.active_projection_generation)
        order by p.generation desc limit 1",
    )
    .bind(id)
    .bind(ctx.tenant_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(crate::service_api::unavailable)?;
    let Some((generation, content)) = current else {
        return Err(StatusCode::NOT_FOUND.into_response());
    };
    let rows: Vec<ToolBindingRow> = sqlx::query_as(
        "select b.tool_resource_id,t.name,t.source,t.capability_contract_key,
        r.application_binding_id,b.status from catalog.tool_binding b
        join catalog.tool_definition t on t.resource_id=b.tool_resource_id
        join catalog.resource r on r.id=t.resource_id and r.tenant_id=$3
        where b.installation_resource_id=$1 and b.projection_generation=$2
        order by t.source desc,t.name,b.tool_resource_id",
    )
    .bind(id)
    .bind(generation)
    .bind(ctx.tenant_id)
    .fetch_all(&state.pool)
    .await
    .map_err(crate::service_api::unavailable)?;
    let mut tools = Vec::with_capacity(rows.len());
    let mut resolved = std::collections::BTreeSet::new();
    for row in rows {
        let requirement = if row.source == "APPLICATION" {
            row.capability_contract_key
        } else {
            None
        };
        if let Some(key) = &requirement {
            resolved.insert(key.clone());
        }
        tools.push(json!({
            "toolResourceId": row.tool_resource_id, "name": row.name, "source": row.source,
            "capabilityRequirement": requirement,
            "applicationBindingId": row.application_binding_id,
            "bindingStatus": row.status, "reasonCode": tool_reason(&row.status),
        }));
    }
    // A requirement without an active provider has no Tool yet (17 §6).
    if let Some(requirements) = content["capabilityRequirements"].as_array() {
        for requirement in requirements.iter().filter_map(serde_json::Value::as_str) {
            if !resolved.contains(requirement) {
                tools.push(json!({
                    "source": "APPLICATION", "capabilityRequirement": requirement,
                    "bindingStatus": "PENDING", "reasonCode": "BINDING_NOT_ACTIVE",
                }));
            }
        }
    }
    serde_json::from_value(json!({
        "installationResourceId": id, "generation": generation, "tools": tools,
    }))
    .map_err(|_| {
        tracing::error!("Installation Tool 事实不符合共享契约");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })
}

pub(crate) async fn read_view(
    state: &BffState,
    ctx: &ExecutionContext,
    id: Uuid,
) -> Result<contracts::AgentInstallationView, Response> {
    let sql = format!("{ROW} and r.id=$2");
    let row: InstallationRow = match sqlx::query_as(&sql)
        .bind(ctx.tenant_id)
        .bind(id)
        .fetch_optional(&state.pool)
        .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return Err(StatusCode::NOT_FOUND.into_response()),
        Err(e) => return Err(crate::service_api::unavailable(e)),
    };
    scope(state, ctx, row.workspace_id).await?;
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
        Ok(c) if c.zed_token.is_empty() => {
            return Err(
                Refusal::Unavailable("Installation read 缺原生 checked revision".into())
                    .respond(None),
            );
        }
        Ok(c) if c.allowed => {}
        Ok(_) => return Err(StatusCode::FORBIDDEN.into_response()),
        Err(e) => return Err(Refusal::Unavailable(e.to_string()).respond(None)),
    }
    view(state, ctx, row).await
}

pub(crate) async fn owned_inbox_agent(
    state: &BffState,
    ctx: &ExecutionContext,
    workspace: Uuid,
    installation: Uuid,
) -> Result<contracts::AgentInstallationView, Response> {
    let view = read_view(state, ctx, installation).await?;
    validate_owned_inbox_agent(&view, workspace, ctx.tenant_principal_id)
        .map_err(IntoResponse::into_response)?;
    Ok(view)
}

fn validate_owned_inbox_agent(
    view: &contracts::AgentInstallationView,
    workspace: Uuid,
    owner: Uuid,
) -> Result<(), StatusCode> {
    if view.workspace_id != workspace.to_string()
        || view.owner_principal_id != owner.to_string()
        || view.state != contracts::AgentInstallationState::Active
        || view.resource_state != contracts::ResourceState::Active
        || view.agent_principal_state != contracts::AgentInstallationViewAgentPrincipalState::Active
        || !view.channel_binding.as_ref().is_some_and(|b| {
            b.status == contracts::AgentInstallationViewChannelBindingStatus::Active
        })
        || !view.projection.as_ref().is_some_and(|p| {
            p.state == contracts::AgentRuntimeProjectionState::Active
                && Some(p.generation) == view.active_projection_generation
        })
    {
        return Err(StatusCode::FORBIDDEN);
    }
    if view
        .agent_pubkey
        .as_deref()
        .is_none_or(|key| nostr::PublicKey::from_hex(key).is_err())
    {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    Ok(())
}

#[cfg(test)]
mod inbox_tests {
    use super::*;

    #[test]
    fn inbox_author_requires_current_owner_scope_and_complete_active_identity() {
        let workspace = Uuid::new_v4();
        let owner = Uuid::new_v4();
        let keys = nostr::Keys::generate();
        let mut raw: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../contracts/samples/agent-installation-upgrade.sample.json"
        ))
        .unwrap();
        raw["workspaceId"] = json!(workspace);
        raw["ownerPrincipalId"] = json!(owner);
        raw["agentPubkey"] = json!(keys.public_key().to_hex());
        raw["activeProjectionGeneration"] = json!(1);
        raw["channelBinding"] = json!({"status":"ACTIVE","triggers":[],"channelId":workspace});
        raw["projection"] = json!({"generation":1,"agentVersionAssetId":Uuid::new_v4(),"configHash":"a".repeat(64),"runtimeProfileKey":"CODEX","state":"ACTIVE"});
        let view: contracts::AgentInstallationView = serde_json::from_value(raw.clone()).unwrap();
        assert!(validate_owned_inbox_agent(&view, workspace, owner).is_ok());
        assert_eq!(
            validate_owned_inbox_agent(&view, Uuid::new_v4(), owner),
            Err(StatusCode::FORBIDDEN)
        );
        assert_eq!(
            validate_owned_inbox_agent(&view, workspace, Uuid::new_v4()),
            Err(StatusCode::FORBIDDEN)
        );
        for (key, value) in [
            ("agentPubkey", serde_json::Value::Null),
            ("agentPubkey", json!("not-a-public-key")),
        ] {
            let mut invalid = raw.clone();
            invalid[key] = value;
            let invalid = serde_json::from_value(invalid).unwrap();
            assert_eq!(
                validate_owned_inbox_agent(&invalid, workspace, owner),
                Err(StatusCode::SERVICE_UNAVAILABLE)
            );
        }
        let mut stale = view.clone();
        stale.active_projection_generation = Some(2);
        assert_eq!(
            validate_owned_inbox_agent(&stale, workspace, owner),
            Err(StatusCode::FORBIDDEN)
        );
        let mut revoked = view;
        revoked.agent_principal_state =
            contracts::AgentInstallationViewAgentPrincipalState::Disabled;
        assert_eq!(
            validate_owned_inbox_agent(&revoked, workspace, owner),
            Err(StatusCode::FORBIDDEN)
        );
    }
}

#[derive(FromRow)]
struct CandidateRow {
    resource_id: Uuid,
    resource_version: i32,
    display_name: String,
    owner_principal_id: Uuid,
    asset_id: Uuid,
}

/// Exact published sources only. This read never provisions an identity, checks
/// runtime health, selects a default model, or follows the latest pointer on write.
pub async fn candidates(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(q): Query<PageQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(error) => return error,
    };
    if let Err(error) = scope(&state, &ctx, q.workspace_id).await {
        return error;
    }
    let limit = i64::from(state.governance.cfg.relationship_page);
    let offset = q.offset.unwrap_or(0);
    if offset < 0 || limit <= 0 || offset.checked_add(limit).is_none() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let checked = match state
        .governance
        .spicedb
        .check(
            "workspace",
            &q.workspace_id.to_string(),
            "create",
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
    {
        Ok(checked) if !checked.zed_token.is_empty() => checked,
        _ => {
            return Refusal::Unavailable("安装来源权限缺原生 checked revision".into())
                .respond(None);
        }
    };
    let mut conn = match state.pool.acquire().await {
        Ok(conn) => conn,
        Err(error) => return crate::service_api::unavailable(error),
    };
    let registered: bool = match sqlx::query_scalar(
        "select exists(select 1 from catalog.action_definition
        where action_key='agent.installation.create' and status='ACTIVE'
          and target_type='RESOURCE' and tenant_rule='SESSION_TENANT' and workspace_rule='WORKSPACE_REQUIRED'
          and permission_object_type='workspace' and permission='create' and execution_mode='TEMPORAL'
          and workflow_type='ComponentTaskWorkflow' and workflow_kind='AGENT_INSTALLATION'
          and confirmation_mode='NONE' and approval_policy_id is null and approval_policy_version is null
          and capacity_policy='NONE' and quota_policy='NONE' and cardinality(meters)=0)",
    ).fetch_one(&mut *conn).await {
        Ok(registered) => registered,
        Err(error) => return crate::service_api::unavailable(error),
    };
    let can_create = checked.allowed
        && registered
        && crate::capability_registry::action_exposed("agent.installation.create");
    if !can_create {
        return Json(contracts::AgentInstallationCandidatePage {
            workspace_id: q.workspace_id.to_string(),
            can_create,
            candidates: Vec::new(),
            next_offset: None,
        })
        .into_response();
    }
    let rows: Vec<CandidateRow> = match sqlx::query_as(
        "select r.id resource_id,r.version resource_version,d.display_name,r.owner_principal_id,v.asset_id
        from catalog.agent_definition d join catalog.resource r on r.id=d.resource_id
        join identity.principal owner on owner.id=r.owner_principal_id and owner.tenant_id=r.tenant_id
        join identity.tenant_membership tm on tm.tenant_principal_id=owner.id and tm.tenant_id=r.tenant_id
        join catalog.agent_version v on v.agent_resource_id=r.id
        join catalog.asset a on a.id=v.asset_id and a.resource_id=r.id and a.tenant_id=r.tenant_id
        join identity.principal asset_owner on asset_owner.id=a.owner_principal_id and asset_owner.tenant_id=r.tenant_id
        join identity.tenant_membership asset_tm on asset_tm.tenant_principal_id=asset_owner.id and asset_tm.tenant_id=r.tenant_id
        where r.tenant_id=$1 and r.type_key='agent.definition' and r.home_workspace_id is null
          and r.state='ACTIVE' and r.projection_action_execution_id is null and d.status='ACTIVE'
          and owner.kind='HUMAN' and owner.status='ACTIVE' and tm.state='ACTIVE'
          and asset_owner.kind='HUMAN' and asset_owner.status='ACTIVE' and asset_tm.state='ACTIVE'
          and a.type_key='agent.version' and a.state='PUBLISHED' and v.state='PUBLISHED'
          and a.projection_action_execution_id is null
        order by r.id,v.ordinal desc offset $2 limit $3",
    ).bind(ctx.tenant_id).bind(offset).bind(limit).fetch_all(&mut *conn).await {
        Ok(rows) => rows,
        Err(error) => return crate::service_api::unavailable(error),
    };
    let next =
        (rows.len() == usize::try_from(limit).unwrap_or(usize::MAX)).then_some(offset + limit);
    let mut candidates = Vec::new();
    for row in rows {
        let checked = match state
            .governance
            .spicedb
            .check(
                "asset",
                &row.asset_id.to_string(),
                "consume",
                &ctx.tenant_principal_id.to_string(),
                Consistency::FullyConsistent,
            )
            .await
        {
            Ok(checked) if !checked.zed_token.is_empty() => checked,
            _ => return Refusal::Unavailable("安装版本 consume 不可核验".into()).respond(None),
        };
        if !checked.allowed {
            continue;
        }
        let version = match crate::agent_version::version(
            &mut conn,
            ctx.tenant_id,
            row.asset_id,
            false,
        )
        .await
        {
            Ok(Some(version))
                if version.agent_resource_id == row.resource_id
                    && version.state == "PUBLISHED"
                    && version.asset_state == "PUBLISHED"
                    && version.projection_action_execution_id.is_none() =>
            {
                version
            }
            Ok(_) => {
                return Refusal::Conflict(contracts::ReasonCode::TargetStateConflict).respond(None);
            }
            Err(error) => return crate::service_api::unavailable(error),
        };
        let content: contracts::AgentVersionContent =
            match serde_json::from_value(version.content.clone()) {
                Ok(content) => content,
                Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
            };
        if !crate::agent_version::content(&content)
            .is_ok_and(|(_, hash)| hash == version.config_hash)
        {
            return Refusal::Unavailable("安装版本内容 hash 不一致".into()).respond(None);
        }
        // Skill references are frozen facts of the PUBLISHED Version; their
        // per-skill effect is decided before each turn (DD-135(7)). Native Tool
        // references use the actual install checks, never an empty config.
        match crate::agent_version::runtime_profile(&content) {
            Ok(()) => {}
            Err(Refusal::Blocked(_)) => continue,
            Err(error) => return error.respond(None),
        }
        match crate::agent_tool::installation_references(
            &state.governance,
            &mut conn,
            ctx.tenant_id,
            ctx.tenant_principal_id,
            &content.declared_tool_resource_ids,
        )
        .await
        {
            Ok(_) => {}
            Err(Refusal::Denied(_) | Refusal::Blocked(_) | Refusal::Conflict(_)) => continue,
            Err(error) => return error.respond(None),
        }
        let route_id = match Uuid::parse_str(&content.model_route_resource_id) {
            Ok(id) => id,
            Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
        };
        let route: Option<Uuid> = match sqlx::query_scalar(
            "select route.id from catalog.resource route
            join identity.principal owner on owner.id=route.owner_principal_id and owner.tenant_id=route.tenant_id
            join identity.tenant_membership tm on tm.tenant_principal_id=owner.id and tm.tenant_id=route.tenant_id
            where route.id=$1 and route.tenant_id=$2 and route.type_key='llm_route' and route.state='ACTIVE'
              and route.application_binding_id is null and route.projection_action_execution_id is null
              and (route.home_workspace_id is null or route.home_workspace_id=$3)
              and route.native_id is not null and length(route.native_id)>0
              and owner.kind='HUMAN' and owner.status='ACTIVE' and tm.state='ACTIVE'",
        ).bind(route_id).bind(ctx.tenant_id).bind(q.workspace_id).fetch_optional(&mut *conn).await {
            Ok(route) => route,
            Err(error) => return crate::service_api::unavailable(error),
        };
        if route.is_none() {
            continue;
        }
        let parent = crate::agent_definition::projection_matches(
            &state.governance,
            row.resource_id,
            ctx.tenant_id,
            row.owner_principal_id,
        )
        .await;
        let asset = crate::agent_version::projection_matches(&state.governance, &version).await;
        if !matches!(parent, Ok(true)) || !matches!(asset, Ok(true)) {
            return Refusal::Unavailable("安装来源投影不可核验".into()).respond(None);
        }
        match serde_json::from_value::<contracts::AgentInstallationCandidate>(json!({
            "agentResourceId":row.resource_id,"resourceVersion":row.resource_version,
            "displayName":row.display_name,"agentVersionAssetId":version.asset_id,
            "assetVersion":version.version,"ordinal":version.ordinal,
        })) {
            Ok(candidate) => candidates.push(candidate),
            Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
        }
    }
    Json(contracts::AgentInstallationCandidatePage {
        workspace_id: q.workspace_id.to_string(),
        can_create,
        candidates,
        next_offset: next,
    })
    .into_response()
}

/// DD-135(7)、17 §8：pinned Version 引用的每个 Skill 的 requested 事实、投影结果与当前状态。
/// 与详情同一 scope 与 fresh Installation read；读取不触发投影、重试或启停。
pub async fn skills(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(r) => return r,
    };
    if let Err(r) = read_view(&state, &ctx, id).await {
        return r;
    }
    #[derive(FromRow)]
    struct Row {
        pinned_version_asset_id: Uuid,
        content: serde_json::Value,
        owner_principal_id: Uuid,
        installation_state: String,
        generation: Option<i64>,
        projection_state: Option<String>,
        effective_fields: Option<serde_json::Value>,
    }
    let row: Option<Row> = match sqlx::query_as(
        "select i.pinned_version_asset_id,v.content,r.owner_principal_id,i.state as installation_state,
         p.generation,p.state as projection_state,p.effective_fields
         from catalog.agent_installation i
         join catalog.resource r on r.id=i.resource_id and r.tenant_id=$2
         join catalog.agent_version v on v.asset_id=i.pinned_version_asset_id
         left join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
           and p.agent_version_asset_id=i.pinned_version_asset_id and p.state<>'REVOKED'
         where i.resource_id=$1 order by p.generation desc nulls last limit 1",
    )
    .bind(id)
    .bind(ctx.tenant_id)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(row) => row,
        Err(e) => return crate::service_api::unavailable(e),
    };
    let Some(row) = row else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let content: contracts::AgentVersionContent = match serde_json::from_value(row.content) {
        Ok(c) => c,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    let states = match crate::skill_projection::governance_states(
        &state.governance,
        ctx.tenant_id,
        row.owner_principal_id,
        &content.skill_version_asset_ids,
    )
    .await
    {
        Ok(states) => states,
        Err(e) => return e.respond(None),
    };
    // 投影事实：ACTIVE generation 的 skillVersionAssetIds 字段已 effective 才算已核对物化。
    let projected = row.projection_state.as_deref() == Some("ACTIVE")
        && row
            .effective_fields
            .as_ref()
            .and_then(serde_json::Value::as_array)
            .is_some_and(|fields| {
                fields.iter().any(|f| {
                    f.get("fieldKey").and_then(serde_json::Value::as_str)
                        == Some("skillVersionAssetIds")
                        && f.get("effectiveValueHash")
                            .is_some_and(serde_json::Value::is_string)
                        && f.get("reasonCode").is_some_and(serde_json::Value::is_null)
                })
            });
    let failed =
        row.installation_state == "ERROR" || row.projection_state.as_deref() == Some("ERROR");
    let skills: Vec<_> = states
        .iter()
        .map(|s| {
            let status = if projected {
                s.status.clone()
            } else if failed {
                contracts::AgentInstallationSkillStatus::ProjectionFailed
            } else {
                contracts::AgentInstallationSkillStatus::RuntimeNotReady
            };
            json!({
                "skillVersionAssetId": s.asset_id, "skillResourceId": s.skill_resource_id,
                "stableSlug": s.slug, "ordinal": s.ordinal, "artifactDigest": s.digest,
                "projected": projected, "status": status,
            })
        })
        .collect();
    match serde_json::from_value::<contracts::AgentInstallationSkillPage>(json!({
        "installationResourceId": id, "agentVersionAssetId": row.pinned_version_asset_id,
        "generation": row.generation, "skills": skills,
    })) {
        Ok(page) => Json(page).into_response(),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}
