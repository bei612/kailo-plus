//! DD-24/25/26/29、03 §7、17 §3/§6：Definition 下的版本配置来源。
//! 只读已投递的发布合同与已治理的 Route；不建立或激活 Profile、Route 或 runtime。

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::ReasonCode;
use serde::Deserialize;
use serde_json::json;
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    bff::{resolve_execution_context, BffState, ExecutionContext},
    governance::Refusal,
    spicedb::Consistency,
};

#[derive(Deserialize)]
pub struct PageQuery {
    offset: Option<i64>,
}

#[derive(FromRow, PartialEq)]
struct RouteRow {
    resource_id: Uuid,
    resource_version: i32,
    owner_principal_id: Uuid,
    home_workspace_id: Option<Uuid>,
    native_id: String,
    native_revision: i64,
    native_config_hash: String,
}

const ROUTES: &str = "select r.id as resource_id,r.version as resource_version,
    r.owner_principal_id,r.home_workspace_id,r.native_id,m.native_revision,m.native_config_hash
    from catalog.resource r join catalog.model_route m on m.resource_id=r.id
    join catalog.resource_type_definition rt on rt.type_key=r.type_key and rt.status='ACTIVE'
      and rt.tenant_delete_action_key='tenant.delete'
    join identity.tenant t on t.id=r.tenant_id and t.state='ACTIVE'
    join identity.principal o on o.id=r.owner_principal_id and o.tenant_id=t.id
      and o.kind='HUMAN' and o.status='ACTIVE'
    join identity.tenant_membership om on om.tenant_principal_id=o.id
      and om.tenant_id=t.id and om.state='ACTIVE'
    where r.tenant_id=$1 and r.type_key='llm_route' and r.state='ACTIVE'
      and r.projection_action_execution_id is null";

pub async fn configuration(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Query(query): Query<PageQuery>,
) -> Response {
    match configuration_page(&state, &headers, id, query).await {
        Ok(page) => Json(page).into_response(),
        Err(response) => response,
    }
}

async fn configuration_page(
    state: &BffState,
    headers: &HeaderMap,
    id: Uuid,
    query: PageQuery,
) -> Result<contracts::AgentVersionConfigurationPage, Response> {
    let context = resolve_execution_context(state, headers).await?;
    let offset = query.offset.unwrap_or(0);
    let limit = i64::from(state.governance.cfg.relationship_page);
    if offset < 0 || limit <= 0 || offset.checked_add(limit).is_none() {
        return Err(StatusCode::BAD_REQUEST.into_response());
    }
    let mut connection = state
        .pool
        .acquire()
        .await
        .map_err(crate::service_api::unavailable)?;
    let parent = read_definition(state, &context, &mut connection, id).await?;

    let mut profiles = match crate::agent_version::runtime_profile_directory() {
        Ok(directory) => directory.profiles,
        // 未投递整个运行组是已关闭的能力，不生成默认 Profile。
        Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)) => Vec::new(),
        Err(error) => return Err(error.respond(None)),
    };
    profiles.retain(|profile| {
        let capability = &profile.capability_contract;
        profile.kind == contracts::RuntimeProfileKind::ServerCodex
            && profile.status == "ACTIVE"
            && profile.web_availability == "ENABLED"
            && capability.max_parallelism > 0
            && capability.max_idle_timeout_seconds > 0
            && capability.max_turn_duration_seconds >= capability.max_idle_timeout_seconds
            && !capability.reply_policies.is_empty()
            && capability
                .reply_policies
                .iter()
                .all(|key| !key.trim().is_empty())
    });
    let rows: Vec<RouteRow> = sqlx::query_as(&format!("{ROUTES} order by r.id offset $2 limit $3"))
        .bind(context.tenant_id)
        .bind(offset)
        .bind(limit)
        .fetch_all(&mut *connection)
        .await
        .map_err(crate::service_api::unavailable)?;
    let next =
        (rows.len() == usize::try_from(limit).unwrap_or(usize::MAX)).then_some(offset + limit);
    let workspaces: Vec<_> = rows
        .iter()
        .filter_map(|route| route.home_workspace_id)
        .collect();
    let admitted = crate::web_transport::workspace_admissions(state, &context, &workspaces)
        .await
        .map_err(IntoResponse::into_response)?;
    let mut routes = Vec::new();
    for route in rows {
        if route
            .home_workspace_id
            .is_some_and(|workspace| !admitted.contains_key(&workspace))
        {
            continue;
        }
        // 复用发布/安装同一原生读取链；不存在反向导入 Gateway 授权。
        match crate::model_route::validate_reference(
            &state.governance,
            &mut connection,
            context.tenant_id,
            context.tenant_principal_id,
            route.resource_id,
        )
        .await
        {
            Ok(()) => {}
            Err(Refusal::Denied(_)) | Err(Refusal::Precondition(ReasonCode::BindingNotActive)) => {
                continue
            }
            Err(error) => return Err(error.respond(None)),
        }
        let observed: Option<RouteRow> = sqlx::query_as(&format!("{ROUTES} and r.id=$2"))
            .bind(context.tenant_id)
            .bind(route.resource_id)
            .fetch_optional(&mut *connection)
            .await
            .map_err(crate::service_api::unavailable)?;
        if observed.as_ref() != Some(&route) {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict).respond(None));
        }
        if route.native_id != route.resource_id.to_string()
            || route.resource_version <= 0
            || route.native_revision <= 0
            || route.native_config_hash.len() != 64
            || !route
                .native_config_hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(Refusal::Unavailable("Route 元数据不完整".into()).respond(None));
        }
        routes.push(json!({
            "resourceId": route.resource_id,
            "resourceVersion": route.resource_version,
            "ownerPrincipalId": route.owner_principal_id,
            "homeWorkspaceId": route.home_workspace_id,
            "nativeConfigResourceId": route.native_id,
            "nativeRevision": route.native_revision,
            "nativeConfigHash": route.native_config_hash,
        }));
    }
    // 缺任一真实来源时目录无可用配置，不从一个半份选项生成写入口。
    if routes.is_empty() || profiles.is_empty() {
        routes.clear();
        profiles.clear();
    }
    // 发布策略仍由实际 ActionDefinition 决定；目录缺失不猜确认/审批策略。
    let can_create =
        if !routes.is_empty() && crate::capability_registry::action_exposed("agent.version.create")
        {
            match crate::governance::active_definition(&state.pool, "agent.version.create")
                .await
                .map_err(crate::service_api::unavailable)?
            {
                Some(definition)
                    if definition.component_type_key == "core"
                        && definition.target_type == "RESOURCE"
                        && definition.tenant_rule == "SESSION_TENANT"
                        && definition.workspace_rule == "TARGET_HOME_WORKSPACE"
                        && definition.permission_object_type == "resource"
                        && definition.permission == "create"
                        && definition.execution_mode == "SYNC"
                        && definition.confirmation_mode == "NONE"
                        && definition.approval_policy_id.is_none()
                        && definition.approval_policy_version.is_none()
                        && definition.workflow_kind.is_none()
                        && definition.quota_policy == "NONE"
                        && definition.meters.is_empty()
                        && definition.result_exposure == "NONE" =>
                {
                    let checked = state
                        .governance
                        .spicedb
                        .check(
                            "resource",
                            &id.to_string(),
                            "create",
                            &context.tenant_principal_id.to_string(),
                            Consistency::FullyConsistent,
                        )
                        .await
                        .map_err(|error| Refusal::Unavailable(error.to_string()).respond(None))?;
                    if checked.zed_token.is_empty() {
                        return Err(Refusal::Unavailable("Version 创建权限缺少 revision".into())
                            .respond(None));
                    }
                    checked.allowed
                }
                _ => false,
            }
        } else {
            false
        };
    serde_json::from_value(json!({
        "agentResourceId": id,
        "resourceVersion": parent.version,
        "profiles": profiles,
        "routes": routes,
        "nextOffset": next,
        "canCreate": can_create,
    }))
    .map_err(|_| Refusal::Unavailable("Version 配置目录不符合共享契约".into()).respond(None))
}

async fn read_definition(
    state: &BffState,
    context: &ExecutionContext,
    connection: &mut sqlx::PgConnection,
    id: Uuid,
) -> Result<crate::agent_definition::Resource, Response> {
    let parent = crate::agent_definition::resource(connection, context.tenant_id, id, false)
        .await
        .map_err(crate::service_api::unavailable)?
        .filter(|resource| {
            resource.state == "ACTIVE"
                && resource.home_workspace_id.is_none()
                && resource.projection_action_execution_id.is_none()
        })
        .ok_or_else(|| StatusCode::NOT_FOUND.into_response())?;
    let definition_active: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.agent_definition
         where resource_id=$1 and status='ACTIVE')",
    )
    .bind(id)
    .fetch_one(&mut *connection)
    .await
    .map_err(crate::service_api::unavailable)?;
    if !definition_active
        || !crate::agent_definition::active_owner(
            &mut *connection,
            context.tenant_id,
            parent.owner_principal_id,
        )
        .await
        .map_err(crate::service_api::unavailable)?
    {
        return Err(StatusCode::NOT_FOUND.into_response());
    }
    if !crate::agent_definition::projection_matches(
        &state.governance,
        id,
        context.tenant_id,
        parent.owner_principal_id,
    )
    .await
    .map_err(|error| error.respond(None))?
    {
        return Err(Refusal::Unavailable("Definition 投影未对账".into()).respond(None));
    }
    let read = state
        .governance
        .spicedb
        .check(
            "resource",
            &id.to_string(),
            "read",
            &context.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|error| Refusal::Unavailable(error.to_string()).respond(None))?;
    if read.zed_token.is_empty() {
        return Err(Refusal::Unavailable("Definition 权限查证缺少 revision".into()).respond(None));
    }
    if !read.allowed {
        return Err(StatusCode::FORBIDDEN.into_response());
    }

    Ok(parent)
}

pub async fn versions(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Query(query): Query<PageQuery>,
) -> Response {
    match version_page(&state, &headers, id, query).await {
        Ok(page) => Json(page).into_response(),
        Err(response) => response,
    }
}

async fn version_page(
    state: &BffState,
    headers: &HeaderMap,
    id: Uuid,
    query: PageQuery,
) -> Result<contracts::AgentVersionPage, Response> {
    let context = resolve_execution_context(state, headers).await?;
    let offset = query.offset.unwrap_or(0);
    let limit = i64::from(state.governance.cfg.relationship_page);
    if offset < 0 || limit <= 0 || offset.checked_add(limit).is_none() {
        return Err(StatusCode::BAD_REQUEST.into_response());
    }
    let mut connection = state
        .pool
        .acquire()
        .await
        .map_err(crate::service_api::unavailable)?;
    let parent = read_definition(state, &context, &mut connection, id).await?;
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "select v.asset_id from catalog.agent_version v
         join catalog.asset a on a.id=v.asset_id
         where a.tenant_id=$1 and a.resource_id=$2 and v.agent_resource_id=$2
         order by v.ordinal desc,v.asset_id offset $3 limit $4",
    )
    .bind(context.tenant_id)
    .bind(id)
    .bind(offset)
    .bind(limit)
    .fetch_all(&mut *connection)
    .await
    .map_err(crate::service_api::unavailable)?;
    let next =
        (ids.len() == usize::try_from(limit).unwrap_or(usize::MAX)).then_some(offset + limit);
    let mut versions = Vec::new();
    for asset in ids {
        match crate::agent_version::read(state, &context, &mut connection, asset).await {
            Ok(view) => versions.push(view),
            Err(response)
                if matches!(
                    response.status(),
                    StatusCode::FORBIDDEN | StatusCode::NOT_FOUND
                ) => {}
            Err(response) => return Err(response),
        }
    }
    let current = read_definition(state, &context, &mut connection, id).await?;
    if current.version != parent.version || current.owner_principal_id != parent.owner_principal_id
    {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict).respond(None));
    }
    serde_json::from_value(
        json!({"agentResourceId": id, "resourceVersion": parent.version,
        "versions": versions, "nextOffset": next}),
    )
    .map_err(|_| Refusal::Unavailable("Version 目录不符合共享契约".into()).respond(None))
}

pub(crate) async fn draft_permissions(
    state: &BffState,
    context: &ExecutionContext,
    connection: &mut sqlx::PgConnection,
    version: &crate::agent_version::Version,
    parent: &crate::agent_definition::Resource,
) -> Result<(bool, bool), Response> {
    if version.state != "DRAFT" || version.asset_state != "DRAFT" {
        return Ok((false, false));
    }
    for human in [
        context.tenant_principal_id,
        parent.owner_principal_id,
        version.owner_principal_id,
    ] {
        if !crate::agent_definition::active_owner(connection, context.tenant_id, human)
            .await
            .map_err(crate::service_api::unavailable)?
        {
            return Ok((false, false));
        }
    }
    let mut allowed = [false, false];
    for (index, (key, permission, confirmation)) in [
        ("agent.version.update", "update", "NONE"),
        ("agent.version.publish", "manage", "EXPLICIT"),
    ]
    .into_iter()
    .enumerate()
    {
        if !crate::capability_registry::action_exposed(key) {
            continue;
        }
        let Some(definition) = crate::governance::active_definition(&state.pool, key)
            .await
            .map_err(crate::service_api::unavailable)?
        else {
            continue;
        };
        if definition.component_type_key != "core"
            || definition.target_type != "ASSET"
            || definition.tenant_rule != "SESSION_TENANT"
            || definition.workspace_rule != "TARGET_HOME_WORKSPACE"
            || definition.permission_object_type != "asset"
            || definition.permission != permission
            || definition.execution_mode != "SYNC"
            || definition.confirmation_mode != confirmation
            || definition.approval_policy_id.is_some()
            || definition.approval_policy_version.is_some()
            || definition.workflow_kind.is_some()
            || definition.quota_policy != "NONE"
            || !definition.meters.is_empty()
            || definition.result_exposure != "NONE"
        {
            continue;
        }
        let checked = state
            .governance
            .spicedb
            .check(
                "asset",
                &version.asset_id.to_string(),
                permission,
                &context.tenant_principal_id.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|error| Refusal::Unavailable(error.to_string()).respond(None))?;
        if checked.zed_token.is_empty() {
            return Err(
                Refusal::Unavailable("Version 写资格缺少 checked revision".into()).respond(None),
            );
        }
        allowed[index] = checked.allowed;
    }
    Ok((allowed[0], allowed[1]))
}
