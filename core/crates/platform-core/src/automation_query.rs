//! REQ-23/DD-107：Automation 管理的只读消费；不创建触发、Grant 或运行对象。
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

use crate::{
    bff::{resolve_execution_context, BffState, ExecutionContext},
    governance::Refusal,
    spicedb::Consistency,
};

#[derive(Deserialize)]
pub struct PageQuery {
    #[serde(rename = "workspaceId")]
    workspace_id: Uuid,
    offset: Option<i64>,
}
#[derive(Deserialize)]
pub struct DetailQuery {
    #[serde(rename = "versionOffset")]
    version_offset: Option<i64>,
    #[serde(rename = "delegationOffset")]
    delegation_offset: Option<i64>,
}
#[derive(FromRow)]
struct AutomationRow {
    resource_id: Uuid,
    workspace_id: Uuid,
    owner_principal_id: Uuid,
    resource_version: i32,
    resource_state: String,
    state: String,
    executor_installation_resource_id: Uuid,
    pinned_version_asset_id: Option<Uuid>,
    delegation_id: Option<Uuid>,
    pinned_version_state: Option<String>,
    pinned_asset_state: Option<String>,
    pinned_projection: Option<Uuid>,
}
const ROW:&str="select r.id resource_id,d.workspace_id,r.owner_principal_id,r.version resource_version,
    r.state resource_state,d.state,d.executor_installation_resource_id,d.pinned_version_asset_id,d.delegation_id,
    pin.state pinned_version_state,asset.state pinned_asset_state,asset.projection_action_execution_id pinned_projection
    from catalog.resource r join catalog.automation_definition d on d.resource_id=r.id
    join catalog.resource_type_definition kind on kind.type_key=r.type_key and kind.status='ACTIVE'
      and kind.tenant_delete_action_key='tenant.delete'
    join identity.workspace w on w.id=d.workspace_id and w.tenant_id=r.tenant_id and w.state='ACTIVE'
    left join catalog.automation_version pin on pin.asset_id=d.pinned_version_asset_id and pin.automation_resource_id=r.id
    left join catalog.asset asset on asset.id=pin.asset_id and asset.resource_id=r.id and asset.tenant_id=r.tenant_id
      and asset.type_key='automation.version'
    where r.tenant_id=$1 and r.type_key='automation' and r.home_workspace_id=d.workspace_id
      and r.application_binding_id is null and r.state='ACTIVE' and r.projection_action_execution_id is null";

fn unavailable() -> Response {
    StatusCode::SERVICE_UNAVAILABLE.into_response()
}
fn offset(value: Option<i64>, limit: i64) -> Option<i64> {
    let value = value.unwrap_or(0);
    if value < 0 || limit <= 0 || value.checked_add(limit).is_none() {
        None
    } else {
        Some(value)
    }
}
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
async fn permission(
    state: &BffState,
    ctx: &ExecutionContext,
    kind: &str,
    id: Uuid,
    permission: &str,
) -> Result<bool, Response> {
    let checked = state
        .governance
        .spicedb
        .check(
            kind,
            &id.to_string(),
            permission,
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()).respond(None))?;
    if checked.zed_token.is_empty() {
        Err(unavailable())
    } else {
        Ok(checked.allowed)
    }
}
// 只读资格不使用写侧 active_owner 的 FOR UPDATE；否则读 Resource 后等待成员锁
// 会与治理写侧的成员→Resource 锁序相反。写请求仍由原治理事务重新锁定和核验。
async fn active_owner(
    conn: &mut PgConnection,
    tenant: Uuid,
    principal: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "select exists(select 1 from identity.principal p
        join identity.tenant_membership tm on tm.tenant_principal_id=p.id
        where p.id=$1 and p.tenant_id=$2 and p.kind='HUMAN' and p.status='ACTIVE'
          and tm.tenant_id=$2 and tm.state='ACTIVE')",
    )
    .bind(principal)
    .bind(tenant)
    .fetch_one(conn)
    .await
}
async fn view(
    state: &BffState,
    conn: &mut PgConnection,
    ctx: &ExecutionContext,
    row: &AutomationRow,
) -> Result<contracts::AutomationView, Response> {
    if row.resource_version <= 0
        || row.pinned_version_asset_id.is_some()
            && (row.pinned_version_state.as_deref() != Some("PUBLISHED")
                || row.pinned_asset_state.as_deref() != Some("PUBLISHED")
                || row.pinned_projection.is_some())
        || (row.state == "ENABLED"
            && (row.pinned_version_asset_id.is_none() || row.delegation_id.is_none()))
    {
        return Err(unavailable());
    }
    if !active_owner(conn, ctx.tenant_id, row.owner_principal_id)
        .await
        .map_err(crate::service_api::unavailable)?
    {
        return Err(Refusal::Denied(contracts::ReasonCode::ScopeGuardFailed).respond(None));
    }
    let matched = state
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
    if !matched {
        return Err(unavailable());
    }
    serde_json::from_value(
        json!({"resourceId":row.resource_id,"workspaceId":row.workspace_id,
        "ownerPrincipalId":row.owner_principal_id,"resourceVersion":row.resource_version,
        "resourceState":row.resource_state,"state":row.state,
        "executorInstallationResourceId":row.executor_installation_resource_id,
        "pinnedVersionAssetId":row.pinned_version_asset_id,"delegationId":row.delegation_id}),
    )
    .map_err(|_| unavailable())
}

pub async fn list(
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
    let offset = match offset(q.offset, limit) {
        Some(offset) => offset,
        None => return StatusCode::BAD_REQUEST.into_response(),
    };
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(error) => return crate::service_api::unavailable(error),
    };
    let rows: Vec<AutomationRow> = match sqlx::query_as(&format!(
        "{ROW} and d.workspace_id=$2 order by r.id offset $3 limit $4"
    ))
    .bind(ctx.tenant_id)
    .bind(q.workspace_id)
    .bind(offset)
    .bind(limit)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(rows) => rows,
        Err(error) => return crate::service_api::unavailable(error),
    };
    let next =
        (rows.len() == usize::try_from(limit).unwrap_or(usize::MAX)).then_some(offset + limit);
    let mut values = Vec::new();
    for row in &rows {
        let value = match view(&state, &mut tx, &ctx, row).await {
            Ok(value) => value,
            Err(error) => return error,
        };
        match permission(&state, &ctx, "resource", row.resource_id, "discover").await {
            Ok(true) => values.push(value),
            Ok(false) => {}
            Err(error) => return error,
        }
    }
    let can_create = match permission(&state, &ctx, "workspace", q.workspace_id, "create").await {
        Ok(allowed) => allowed && crate::capability_registry::action_exposed("automation.create"),
        Err(error) => return error,
    };
    match serde_json::from_value::<contracts::AutomationPage>(
        json!({"automations":values,"canCreate":can_create,"nextOffset":next}),
    ) {
        Ok(value) => Json(value).into_response(),
        Err(_) => unavailable(),
    }
}

#[derive(FromRow)]
struct VersionRow {
    asset_id: Uuid,
    owner_principal_id: Uuid,
    asset_version: i32,
    asset_state: String,
    ordinal: i32,
    state: String,
    config_hash: String,
    trigger: Value,
    action: Value,
    approval_policy_id: Option<Uuid>,
    result_target: String,
}
async fn versions(
    state: &BffState,
    conn: &mut PgConnection,
    ctx: &ExecutionContext,
    row: &AutomationRow,
    offset: i64,
    limit: i64,
) -> Result<(Vec<contracts::AutomationVersionView>, Option<i64>), Response> {
    let rows:Vec<VersionRow>=sqlx::query_as("select a.id asset_id,a.owner_principal_id,a.version asset_version,
        a.state asset_state,v.ordinal,v.state,v.config_hash,v.trigger,v.action,v.approval_policy_id,v.result_target
        from catalog.automation_version v join catalog.asset a on a.id=v.asset_id
        where v.automation_resource_id=$1 and a.resource_id=$1 and a.tenant_id=$2
          and a.type_key='automation.version' and a.state<>'DELETED' and a.projection_action_execution_id is null
        order by v.ordinal desc offset $3 limit $4")
        .bind(row.resource_id).bind(ctx.tenant_id).bind(offset).bind(limit).fetch_all(&mut *conn).await
        .map_err(crate::service_api::unavailable)?;
    let next =
        (rows.len() == usize::try_from(limit).unwrap_or(usize::MAX)).then_some(offset + limit);
    let mut values = Vec::new();
    let executor: Uuid = sqlx::query_scalar(
        "select i.agent_principal_id from catalog.agent_installation i
        join catalog.resource r on r.id=i.resource_id and r.tenant_id=$1 and r.home_workspace_id=$2
        where i.resource_id=$3 and i.workspace_id=$2",
    )
    .bind(ctx.tenant_id)
    .bind(row.workspace_id)
    .bind(row.executor_installation_resource_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(crate::service_api::unavailable)?;
    for version in rows {
        if !permission(state, ctx, "asset", version.asset_id, "read").await? {
            continue;
        }
        let trigger = version.trigger.as_object().ok_or_else(unavailable)?;
        let action = version.action.as_object().ok_or_else(unavailable)?;
        if version.asset_version <= 0
            || version.ordinal <= 0
            || trigger.keys().any(|key| {
                !matches!(
                    key.as_str(),
                    "kind" | "text_prefix" | "mention_principal_id" | "schedule_spec"
                )
            })
            || action
                .keys()
                .any(|key| !matches!(key.as_str(), "kind" | "template"))
            || action.get("kind").and_then(Value::as_str) != Some("AGENT_TURN")
            || action
                .get("template")
                .and_then(Value::as_str)
                .is_none_or(|text| text.trim().is_empty())
            || trigger
                .get("text_prefix")
                .is_some_and(|value| value.as_str().is_none_or(str::is_empty))
        {
            return Err(unavailable());
        }
        match trigger.get("kind").and_then(Value::as_str) {
            Some("CHANNEL_MESSAGE")
                if !trigger.contains_key("mention_principal_id")
                    && !trigger.contains_key("schedule_spec")
                    && version.result_target == "TRIGGER_THREAD" => {}
            Some("MENTION")
                if trigger
                    .get("mention_principal_id")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                    == Some(executor)
                    && !trigger.contains_key("schedule_spec")
                    && version.result_target == "TRIGGER_THREAD" => {}
            Some("SCHEDULE")
                if !trigger.contains_key("text_prefix")
                    && !trigger.contains_key("mention_principal_id")
                    && version.result_target == "CHANNEL" =>
            {
                crate::automation::schedule_spec(
                    trigger.get("schedule_spec").ok_or_else(unavailable)?,
                )
                .map_err(|e| e.respond(None))?;
            }
            _ => return Err(unavailable()),
        }
        let content = json!({"trigger":version.trigger,"action":version.action,
            "approvalPolicyId":version.approval_policy_id,"resultTarget":version.result_target});
        if version.state != version.asset_state
            || version.approval_policy_id.is_some()
            || collab_bridge::limits::canonical_digest(&content) != version.config_hash
            || !active_owner(conn, ctx.tenant_id, version.owner_principal_id)
                .await
                .map_err(crate::service_api::unavailable)?
        {
            return Err(unavailable());
        }
        let matched = state
            .governance
            .spicedb
            .asset_projection_matches(
                &version.asset_id.to_string(),
                &ctx.tenant_id.to_string(),
                &row.resource_id.to_string(),
                &version.owner_principal_id.to_string(),
                state.governance.cfg.relationship_page,
            )
            .await
            .map_err(|e| Refusal::Unavailable(e.to_string()).respond(None))?;
        if !matched {
            return Err(unavailable());
        }
        let mut trigger = json!({"kind":content["trigger"]["kind"]});
        if let Some(value) = content["trigger"].get("text_prefix") {
            trigger["textPrefix"] = value.clone();
        }
        if let Some(value) = content["trigger"].get("mention_principal_id") {
            trigger["mentionPrincipalId"] = value.clone();
        }
        if let Some(value) = content["trigger"].get("schedule_spec") {
            trigger["scheduleSpec"] = value.clone();
        }
        let value=serde_json::from_value(json!({"assetId":version.asset_id,"automationResourceId":row.resource_id,
            "ownerPrincipalId":version.owner_principal_id,"assetVersion":version.asset_version,
            "ordinal":version.ordinal,"state":version.state,"configHash":version.config_hash,
            "content":{"trigger":trigger,"action":content["action"],"resultTarget":content["resultTarget"]}}))
            .map_err(|_|unavailable())?;
        values.push(value);
    }
    Ok((values, next))
}
#[derive(FromRow)]
struct GrantRow {
    id: Uuid,
    version: i32,
    expires_at: DateTime<Utc>,
}
async fn delegations(
    state: &BffState,
    conn: &mut PgConnection,
    ctx: &ExecutionContext,
    row: &AutomationRow,
    offset: i64,
    limit: i64,
) -> Result<(Vec<contracts::AutomationDelegationView>, Option<i64>), Response> {
    let rows:Vec<GrantRow>=sqlx::query_as("select g.id,g.version,g.expires_at from admission.delegation_grant g
        join catalog.agent_installation i on i.resource_id=g.installation_resource_id and i.state='ACTIVE'
        join catalog.resource ir on ir.id=i.resource_id and ir.tenant_id=g.tenant_id
          and ir.home_workspace_id=g.workspace_id and ir.state='ACTIVE' and ir.projection_action_execution_id is null
        join identity.principal agent on agent.id=i.agent_principal_id and agent.tenant_id=g.tenant_id
          and agent.kind='AGENT' and agent.status='ACTIVE'
        where g.tenant_id=$1 and g.workspace_id=$2 and g.grantor_principal_id=$3
          and g.installation_resource_id=$4 and g.agent_principal_id=agent.id and g.state='ACTIVE'
          and g.valid_from<=clock_timestamp() and g.expires_at>clock_timestamp()
          and (g.max_uses is null or g.max_uses>(select count(*) from admission.delegation_use u where u.delegation_id=g.id))
          and exists(select 1 from admission.delegation_scope scope
            join catalog.action_definition action on action.action_key=scope.action_key and action.version=scope.action_version
              and action.status='ACTIVE' and action.action_key='automation.run'
            join catalog.result_exposure_policy exposure on exposure.id=scope.result_exposure_policy_id
              and exposure.version=scope.result_exposure_policy_version and exposure.tenant_id=g.tenant_id
              and exposure.status='ACTIVE' and exposure.mode='CONSUME_ONLY'
              and exposure.output_schema_hash=$8 and exposure.redaction_policy='PLATFORM_METADATA_ONLY'
            where scope.delegation_id=g.id and scope.target_type='RESOURCE' and scope.target_id=$5
              and scope.create_workspace_id is null and scope.tool_resource_id is null)
        order by g.id offset $6 limit $7")
        .bind(ctx.tenant_id).bind(row.workspace_id).bind(row.owner_principal_id)
        .bind(row.executor_installation_resource_id).bind(row.resource_id).bind(offset).bind(limit)
        .bind(format!("{:x}",Sha256::digest(include_str!("../../../../contracts/api/action_submission.schema.json").as_bytes())))
        .fetch_all(&mut *conn).await.map_err(crate::service_api::unavailable)?;
    let next =
        (rows.len() == usize::try_from(limit).unwrap_or(usize::MAX)).then_some(offset + limit);
    if !rows.is_empty() {
        let agent: Uuid = sqlx::query_scalar(
            "select agent_principal_id from catalog.agent_installation where resource_id=$1",
        )
        .bind(row.executor_installation_resource_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(crate::service_api::unavailable)?;
        for subject in [row.owner_principal_id, agent] {
            let checked = state
                .governance
                .spicedb
                .check(
                    "resource",
                    &row.resource_id.to_string(),
                    "execute",
                    &subject.to_string(),
                    Consistency::FullyConsistent,
                )
                .await
                .map_err(|e| Refusal::Unavailable(e.to_string()).respond(None))?;
            if checked.zed_token.is_empty() {
                return Err(unavailable());
            }
            if !checked.allowed {
                return Ok((Vec::new(), next));
            }
        }
    }
    let mut values = Vec::new();
    for grant in rows {
        values.push(serde_json::from_value(json!({"delegationId":grant.id,"delegationVersion":grant.version,
            "ownerPrincipalId":row.owner_principal_id,"executorInstallationResourceId":row.executor_installation_resource_id,
            "expiresAt":grant.expires_at})).map_err(|_|unavailable())?);
    }
    Ok((values, next))
}

pub async fn get(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Query(q): Query<DetailQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(error) => return error,
    };
    let limit = i64::from(state.governance.cfg.relationship_page);
    let version_offset = match offset(q.version_offset, limit) {
        Some(value) => value,
        None => return StatusCode::BAD_REQUEST.into_response(),
    };
    let delegation_offset = match offset(q.delegation_offset, limit) {
        Some(value) => value,
        None => return StatusCode::BAD_REQUEST.into_response(),
    };
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(error) => return crate::service_api::unavailable(error),
    };
    let row: AutomationRow = match sqlx::query_as(&format!("{ROW} and r.id=$2"))
        .bind(ctx.tenant_id)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(error) => return crate::service_api::unavailable(error),
    };
    if let Err(error) = scope(&state, &ctx, row.workspace_id).await {
        return error;
    }
    let automation = match view(&state, &mut tx, &ctx, &row).await {
        Ok(value) => value,
        Err(error) => return error,
    };
    match permission(&state, &ctx, "resource", row.resource_id, "read").await {
        Ok(true) => {}
        Ok(false) => return StatusCode::FORBIDDEN.into_response(),
        Err(error) => return error,
    }
    let can_manage = match permission(&state, &ctx, "resource", row.resource_id, "manage").await {
        Ok(allowed) => allowed,
        Err(error) => return error,
    };
    let (versions, next_version) =
        match versions(&state, &mut tx, &ctx, &row, version_offset, limit).await {
            Ok(value) => value,
            Err(error) => return error,
        };
    let (grants, next_grant) = if can_manage {
        match delegations(&state, &mut tx, &ctx, &row, delegation_offset, limit).await {
            Ok(value) => value,
            Err(error) => return error,
        }
    } else {
        (Vec::new(), None)
    };
    match serde_json::from_value::<contracts::AutomationDetailView>(json!({"automation":automation,
        "versions":versions,"delegations":grants,"canManage":can_manage,
        "nextVersionOffset":next_version,"nextDelegationOffset":next_grant}))
    {
        Ok(value) => Json(value).into_response(),
        Err(_) => unavailable(),
    }
}
