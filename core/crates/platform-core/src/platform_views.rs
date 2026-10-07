//! 平台管理页的只读视图（`SS-WEB-01`）。
//!
//! 三个页面各要一份数据：Workspace 选择、成员、基础审计。它们都是**只读**
//! 投影，不引入第二份权威——`.design/14` 明写 Business Observability 不另建
//! 事实权威表，BFF 以既有事实组成只读视图。
//!
//! 每个视图的可见范围都由调用方自己的 scope 决定，不接受任何范围参数：
//! 放开范围参数等于把「我能看谁」交给调用方声明。

use std::collections::HashSet;

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::{
    OwnAuditEntry, PlatformTenantPage, PlatformTenantView, RoleMemberPage, RoleMemberView,
    RoleWorkspacePage, RoleWorkspaceView, WorkspaceMemberView, WorkspaceView,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::bff::{db_enum, resolve_execution_context, BffState};
use crate::governance::{Actor, TenantLifecycleOffer, WorkspaceLifecycleOffer};
use crate::spicedb::{Consistency, RelationshipFilter};

#[derive(Deserialize)]
pub struct DiscoveryQuery {
    cursor: Option<Uuid>,
}

#[derive(sqlx::FromRow, PartialEq)]
struct DiscoveryRow {
    id: Uuid,
    visibility: String,
    version: i32,
    channel_id: String,
    binding_version: i32,
    membership_state: Option<String>,
    membership_version: Option<i32>,
    member_count: i64,
    created_at: chrono::DateTime<chrono::Utc>,
}

async fn discovery_rows(
    state: &BffState,
    ctx: &crate::bff::ExecutionContext,
    cursor: Option<Uuid>,
    limit: i64,
) -> Result<Vec<DiscoveryRow>, sqlx::Error> {
    sqlx::query_as(
        "select w.id, w.visibility, w.version, b.channel_id::text as channel_id,
                b.version as binding_version, wm.state as membership_state,
                wm.version as membership_version, w.created_at,
                (select count(*) from identity.workspace_membership members
                 where members.workspace_id = w.id and members.state = 'ACTIVE') as member_count
         from identity.workspace w
         join projection.workspace_buzz_binding b on b.workspace_id = w.id and b.state = 'ACTIVE'
         left join identity.workspace_membership wm on wm.workspace_id = w.id and wm.tenant_principal_id = $2
         where w.tenant_id = $1 and w.state = 'ACTIVE' and ($3::uuid is null or w.id > $3)
           and (w.visibility = 'open' or wm.state = 'ACTIVE')
         order by w.id limit $4",
    ).bind(ctx.tenant_id).bind(ctx.tenant_principal_id).bind(cursor).bind(limit).fetch_all(&state.pool).await
}

async fn discover_tenant(
    state: &BffState,
    ctx: &crate::bff::ExecutionContext,
) -> Result<(), Response> {
    let checked = state
        .governance
        .spicedb
        .check(
            "tenant",
            &ctx.tenant_id.to_string(),
            "discover",
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    if checked.zed_token.is_empty() {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    if !checked.allowed {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    Ok(())
}

/// DD-80 public discovery is not message admission. Metadata is read from the
/// original signed Relay snapshot by the existing CONTROL identity, never cached
/// as a second channel authority. Private nonmember rows never reach that reader.
pub async fn discoverable_workspaces(
    State(state): State<BffState>,
    Query(query): Query<DiscoveryQuery>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if let Err(r) = discover_tenant(&state, &ctx).await {
        return r;
    }
    let page = state.governance.cfg.role_member_page_limit;
    let Some(limit) = page.checked_add(1) else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let mut rows = match discovery_rows(&state, &ctx, query.cursor, limit).await {
        Ok(rows) => rows,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    let more = rows.len() as i64 > page;
    rows.truncate(page as usize);
    let ids = rows.iter().map(|row| row.id).collect::<Vec<_>>();
    let admitted = match crate::web_transport::workspace_admissions(&state, &ctx, &ids).await {
        Ok(v) => v,
        Err(e) => return e.into_response(),
    };
    let (control, host) = match crate::tenant_lifecycle::control_client(
        &state.memory_service,
        ctx.tenant_id,
        crate::tenant_lifecycle::ProjectionDirection::Establish,
    )
    .await
    {
        Ok(v) => v,
        Err(r) => return r,
    };
    let author = match crate::web_transport::window_author(&state, &ctx, &host).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let join_definition =
        match crate::governance::active_definition(&state.pool, "workspace.join").await {
            Ok(value) => value,
            Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
        };
    let join_exposed = crate::capability_registry::action_exposed("workspace.join")
        && join_definition.is_some_and(|def| {
            def.target_type == "WORKSPACE_MEMBERSHIP"
                && def.workspace_rule == "WORKSPACE_REQUIRED"
                && def.permission == "discover"
                && def.permission_object_type == "tenant"
                && def.workflow_kind.as_deref() == Some("MEMBERSHIP_PROJECTION")
        });
    let mut items = Vec::with_capacity(rows.len());
    for row in &rows {
        let event = match control.channel_metadata(&state.http, &row.channel_id).await {
            Ok(Some(event)) => event,
            _ => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
        };
        let channel =
            match crate::web_transport::web_channel_view(&event, &row.channel_id, &author.1) {
                Ok(v) => v,
                Err(r) => return r,
            };
        let mut item = serde_json::json!({
            "id": row.id, "visibility": row.visibility, "channel": channel,
            "isMember": admitted.get(&row.id).is_some_and(|epoch| epoch.is_member()), "memberCount": row.member_count,
            "createdAt": row.created_at,
        });
        if let Some(membership) = &row.membership_state {
            item["membershipState"] = membership.clone().into();
        }
        if join_exposed
            && row.visibility == "open"
            && row.membership_state.is_none()
            && !channel.archived
        {
            item["joinActionKey"] = "workspace.join".into();
        }
        let parsed = match serde_json::from_value::<contracts::DiscoverableWorkspacePageItem>(item)
        {
            Ok(v) => v,
            Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
        };
        items.push(parsed);
    }
    // Scope and projection must still be the same after the external reads.
    let current = match resolve_execution_context(&state, &headers).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if current.tenant_id != ctx.tenant_id || current.tenant_principal_id != ctx.tenant_principal_id
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    if let Err(r) = discover_tenant(&state, &current).await {
        return r;
    }
    let mut observed = match discovery_rows(&state, &current, query.cursor, limit).await {
        Ok(v) => v,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    observed.truncate(page as usize);
    if observed != rows {
        return StatusCode::CONFLICT.into_response();
    }
    let current_admitted =
        match crate::web_transport::workspace_admissions(&state, &current, &ids).await {
            Ok(value) => value,
            Err(error) => return error.into_response(),
        };
    if ids.iter().any(|id| {
        admitted.get(id).map(|epoch| epoch.is_member())
            != current_admitted.get(id).map(|epoch| epoch.is_member())
    }) {
        return StatusCode::CONFLICT.into_response();
    }
    match crate::web_transport::window_author(&state, &current, &host).await {
        Ok(now) if now == author => {}
        _ => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
    Json(contracts::DiscoverableWorkspacePage {
        items,
        next_cursor: if more {
            rows.last().map(|row| row.id.to_string())
        } else {
            None
        },
    })
    .into_response()
}

/// 当前 Tenant 的成员或管理可见 Workspace；isMember 单独表示协作参与资格。
///
/// 不以 manage 冒充 Channel roster，也不为修复协作目录删掉管理入口。
pub async fn list_workspaces(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let rows = match sqlx::query_as::<_, (Uuid, String, String, String)>(
        "select w.id, w.slug, w.name, w.visibility
         from identity.workspace w
         join identity.tenant tenant
           on tenant.id = w.tenant_id and tenant.state = 'ACTIVE'
         join projection.workspace_buzz_binding b
           on b.workspace_id = w.id and b.state = 'ACTIVE'
         join projection.tenant_buzz_binding t
           on t.tenant_id = w.tenant_id and t.state = 'ACTIVE'
         where w.tenant_id = $1 and w.state = 'ACTIVE'
         order by w.slug",
    )
    .bind(ctx.tenant_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!(error = %e, "列 Workspace 失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let ids: Vec<Uuid> = rows.iter().map(|(id, _, _, _)| *id).collect();
    let admitted = match crate::web_transport::workspace_admissions(&state, &ctx, &ids).await {
        Ok(admitted) => admitted,
        Err(e) => return e.into_response(),
    };
    if rows
        .iter()
        .any(|(_, _, _, visibility)| !matches!(visibility.as_str(), "open" | "private"))
    {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    (
        StatusCode::OK,
        Json(
            rows.into_iter()
                .filter(|(id, _, _, _)| admitted.contains_key(id))
                .map(|(id, slug, name, visibility)| WorkspaceView {
                    id: id.to_string(),
                    slug,
                    name,
                    is_member: Some(admitted.get(&id).is_some_and(|epoch| epoch.is_member())),
                    visibility: Some(if visibility == "open" {
                        contracts::WorkspaceVisibility::Open
                    } else {
                        contracts::WorkspaceVisibility::Private
                    }),
                })
                .collect::<Vec<_>>(),
        ),
    )
        .into_response()
}

/// 某个 Workspace 的成员。
///
/// 先过同一条 Workspace 准入：看得到成员名单本身就是一种 scope 内的能力，
/// 不是公共信息。
pub async fn list_members(
    State(state): State<BffState>,
    Path(workspace_id): Path<Uuid>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    if let Err(r) = crate::web_transport::admit_workspace_scope(&state, &ctx, workspace_id).await {
        return r.into_response();
    }
    // 一人多把公钥时按人聚合：左连接直接展开会让同一个人出现多行。公钥是公开
    // 事实，与私钥托管无关；客户端据此把任一端签发的消息归到同一个人名下（DD-77）。
    match sqlx::query_as::<_, (Uuid, String, Vec<String>, String)>(
        "select wm.tenant_principal_id, hi.display_name,
                coalesce(array_agg(bib.pubkey order by bib.pubkey)
                         filter (where bib.pubkey is not null), '{}') as pubkeys,
                wm.state
         from identity.workspace_membership wm
         join identity.tenant_membership tm
           on tm.tenant_principal_id = wm.tenant_principal_id
         join identity.human_identity hi on hi.id = tm.human_identity_id
         left join identity.buzz_identity_binding bib
           on bib.principal_id = wm.tenant_principal_id and bib.state = 'ACTIVE'
         where wm.workspace_id = $1 and wm.state <> 'REVOKED'
         group by wm.tenant_principal_id, hi.display_name, wm.state
         order by hi.display_name",
    )
    .bind(workspace_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => {
            let mut members = Vec::with_capacity(rows.len());
            for (principal_id, display_name, pubkeys, state) in rows {
                let state = match db_enum("workspace_membership.state", &state) {
                    Ok(s) => s,
                    Err(r) => return r,
                };
                members.push(WorkspaceMemberView {
                    principal_id: principal_id.to_string(),
                    display_name,
                    pubkeys,
                    state,
                });
            }
            (StatusCode::OK, Json(members)).into_response()
        }
        Err(e) => {
            tracing::warn!(error = %e, "列成员失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleMemberQuery {
    workspace_id: Option<Uuid>,
    cursor: Option<Uuid>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleWorkspaceQuery {
    offset: Option<i64>,
}

/// 管理角色的 Workspace 选择与频道准入是两个不同的集合：角色持有者未必有
/// WorkspaceMembership。先从 Core 的 Tenant 索引有界分页，再对本页做 SpiceDB
/// CheckBulkPermissions；游标只暴露偏移，不泄露无权 Workspace 的 ID。
///
/// 暂停中、已暂停、恢复中与 ERROR 的 Workspace 也在此列出并带当前状态：暂停与
/// 恢复只能从这里（Tenant scope）发起，被暂停的 Workspace 自身 scope 不可进入
/// （`.design/06` §7.3）。ERROR 只列已有 Buzz binding 的——暂停或恢复失败留下的，
/// 可从这里重新暂停；建立失败没有 binding 的 ERROR 与建立中的都不列，它们没有可在
/// 此发起的动作。本人可进入的 Workspace 列表（`list_workspaces`）仍只列 ACTIVE。
///
/// 生命周期动作键是只读提示：目录形状不符或依赖判定失败时本页不给任何生命周期键，
/// 页面其余部分照常返回，提交仍由 Core 重新准入。
pub async fn list_role_workspaces(
    State(state): State<BffState>,
    Query(query): Query<RoleWorkspaceQuery>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let offset = query.offset.unwrap_or(0);
    if offset < 0 {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let page = state.governance.cfg.role_member_page_limit;
    let Some(fetch_limit) = page.checked_add(1) else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let mut rows: Vec<(Uuid, String, String)> = match sqlx::query_as(
        "select w.id, w.name, w.state from identity.workspace w
         where w.tenant_id = $1
           and (w.state in ('ACTIVE', 'SUSPENDING', 'SUSPENDED', 'RESTORING')
                or (w.state = 'ERROR' and exists (
                      select 1 from projection.workspace_buzz_binding b where b.workspace_id = w.id)))
         order by w.id limit $2 offset $3",
    )
    .bind(ctx.tenant_id)
    .bind(fetch_limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!(error = %e, "列角色管理 Workspace 失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let more = rows.len() as i64 > page;
    rows.truncate(page as usize);
    let next_offset = if more {
        match offset.checked_add(rows.len() as i64) {
            Some(next) => Some(next),
            None => return StatusCode::BAD_REQUEST.into_response(),
        }
    } else {
        None
    };
    let ids: Vec<String> = rows.iter().map(|(id, _, _)| id.to_string()).collect();
    let allowed = match state
        .governance
        .spicedb
        .check_bulk(
            "workspace",
            &ids,
            "manage",
            &ctx.tenant_principal_id.to_string(),
        )
        .await
    {
        Ok(ids) => ids,
        Err(e) => {
            tracing::warn!(error = %e, "角色管理 Workspace 批量权限判定失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let actor = Actor {
        tenant_id: ctx.tenant_id,
        principal_id: ctx.tenant_principal_id,
        human_identity_id: Some(ctx.human_identity_id),
    };
    let lifecycle = match state
        .governance
        .available_workspace_lifecycle_actions(actor)
        .await
    {
        Ok(offer) => offer,
        Err(e) => {
            tracing::warn!(refusal = ?e, "Workspace 生命周期动作提示判定失败，本页不给生命周期键");
            WorkspaceLifecycleOffer::default()
        }
    };
    let mut workspaces = Vec::with_capacity(rows.len());
    for (id, name, ws_state) in rows {
        if !allowed.contains(&id.to_string()) {
            continue;
        }
        let lifecycle_action_key = lifecycle.for_state(&ws_state);
        let ws_state = match db_enum("workspace.state", &ws_state) {
            Ok(s) => s,
            Err(r) => return r,
        };
        workspaces.push(RoleWorkspaceView {
            id: id.to_string(),
            name,
            state: ws_state,
            lifecycle_action_key,
        });
    }
    let create_action_key = match state
        .governance
        .available_workspace_create_action(actor)
        .await
    {
        Ok(key) => key,
        Err(e) => return e.respond(None),
    };
    (
        StatusCode::OK,
        Json(RoleWorkspacePage {
            workspaces,
            next_offset,
            create_action_key,
        }),
    )
        .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformTenantQuery {
    offset: Option<i64>,
}

/// Platform Catalog 的业务 Tenant 管理视图（DD-96）。
///
/// 只对 Catalog 会话、且在 Catalog Tenant 上 fresh `manage` 为真的人开放，其余 403：
/// 业务 Tenant 的清单本身就是平台管理面的事实。有界分页与角色管理 Workspace 列表
/// 同一写法（偏移游标、多取一行判断是否还有下一页）。暂停/恢复的动作键是只读提示：
/// 判定失败时本页不给任何生命周期键，页面其余部分照常返回。
pub async fn list_platform_tenants(
    State(state): State<BffState>,
    Query(query): Query<PlatformTenantQuery>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let offset = query.offset.unwrap_or(0);
    if offset < 0 {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let is_catalog = match state.pool.acquire().await {
        Ok(mut conn) => {
            crate::platform_bootstrap::is_catalog_tenant(&mut conn, ctx.tenant_id).await
        }
        Err(e) => Err(e),
    };
    match is_catalog {
        Ok(true) => {}
        Ok(false) => return StatusCode::FORBIDDEN.into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "Catalog 会话判定失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    }
    match state
        .governance
        .spicedb
        .check(
            "tenant",
            &ctx.tenant_id.to_string(),
            "manage",
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
    {
        Ok(c) if c.allowed => {}
        Ok(_) => return StatusCode::FORBIDDEN.into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "Catalog manage 判定失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    }
    let page = state.governance.cfg.role_member_page_limit;
    let Some(fetch_limit) = page.checked_add(1) else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let mut rows: Vec<(Uuid, String, String, String, bool)> = match sqlx::query_as(
        "select t.id, t.name, t.slug, t.state,
                exists (select 1 from projection.tenant_buzz_binding b
                        where b.tenant_id = t.id and b.state = 'ACTIVE')
         from identity.tenant t
         where t.id <> $1
         order by t.id limit $2 offset $3",
    )
    .bind(ctx.tenant_id)
    .bind(fetch_limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!(error = %e, "列业务 Tenant 失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let more = rows.len() as i64 > page;
    rows.truncate(page as usize);
    let next_offset = if more {
        match offset.checked_add(rows.len() as i64) {
            Some(next) => Some(next),
            None => return StatusCode::BAD_REQUEST.into_response(),
        }
    } else {
        None
    };
    let offer = match state
        .governance
        .available_tenant_lifecycle_actions(Actor {
            tenant_id: ctx.tenant_id,
            principal_id: ctx.tenant_principal_id,
            human_identity_id: Some(ctx.human_identity_id),
        })
        .await
    {
        Ok(offer) => offer,
        Err(e) => {
            tracing::warn!(refusal = ?e, "Tenant 生命周期动作提示判定失败，本页不给生命周期键");
            TenantLifecycleOffer::default()
        }
    };
    let mut tenants = Vec::with_capacity(rows.len());
    for (id, name, slug, tenant_state, has_binding) in rows {
        let lifecycle_action_key = offer.for_state(&tenant_state, has_binding);
        let tenant_state = match db_enum("tenant.state", &tenant_state) {
            Ok(s) => s,
            Err(r) => return r,
        };
        tenants.push(PlatformTenantView {
            id: id.to_string(),
            name,
            slug,
            state: tenant_state,
            lifecycle_action_key,
        });
    }
    (
        StatusCode::OK,
        Json(PlatformTenantPage {
            tenants,
            next_offset,
        }),
    )
        .into_response()
}

/// 角色管理候选人是本 Tenant 的全部 ACTIVE HUMAN 成员，不限于 WorkspaceMembership：
/// Workspace admin 可以授给尚未加入该 Workspace 的 Tenant 成员（DD-82）。角色只从
/// SpiceDB fresh 读取，不在 Core 缓存；按钮只是当前视图，动作仍走重新准入。
pub async fn list_role_members(
    State(state): State<BffState>,
    Query(query): Query<RoleMemberQuery>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let tenant = ctx.tenant_id.to_string();
    let actor = ctx.tenant_principal_id.to_string();
    let tenant_manage = match state
        .governance
        .spicedb
        .check(
            "tenant",
            &tenant,
            "manage",
            &actor,
            Consistency::FullyConsistent,
        )
        .await
    {
        Ok(result) => result.allowed,
        Err(e) => {
            tracing::warn!(error = %e, "角色列表 Tenant 权限判定失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let workspace_manage = if let Some(workspace_id) = query.workspace_id {
        let belongs: Option<i32> = match sqlx::query_scalar(
            "select 1 from identity.workspace where id = $1 and tenant_id = $2 and state = 'ACTIVE'",
        )
        .bind(workspace_id)
        .bind(ctx.tenant_id)
        .fetch_optional(&state.pool)
        .await
        {
            Ok(row) => row,
            Err(e) => {
                tracing::warn!(error = %e, "角色列表 Workspace 范围判定失败");
                return StatusCode::SERVICE_UNAVAILABLE.into_response();
            }
        };
        if belongs.is_none() {
            return StatusCode::FORBIDDEN.into_response();
        }
        match state
            .governance
            .spicedb
            .check(
                "workspace",
                &workspace_id.to_string(),
                "manage",
                &actor,
                Consistency::FullyConsistent,
            )
            .await
        {
            Ok(result) => result.allowed,
            Err(e) => {
                tracing::warn!(error = %e, "角色列表 Workspace 权限判定失败");
                return StatusCode::SERVICE_UNAVAILABLE.into_response();
            }
        }
    } else {
        false
    };
    if !tenant_manage && !workspace_manage {
        return StatusCode::FORBIDDEN.into_response();
    }

    let page = state.governance.cfg.role_member_page_limit;
    let Some(fetch_limit) = page.checked_add(1) else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let mut rows: Vec<(Uuid, String, bool)> = match sqlx::query_as(
        "select p.id, hi.display_name,
           exists(select 1 from identity.workspace_membership wm
             where wm.workspace_id=$4 and wm.tenant_principal_id=p.id and wm.state in ('ACTIVE','ERROR'))
         from identity.principal p
         join identity.tenant_membership tm on tm.tenant_principal_id = p.id
         join identity.human_identity hi on hi.id = tm.human_identity_id
         where p.tenant_id = $1 and p.kind = 'HUMAN' and p.status = 'ACTIVE'
           and tm.tenant_id = $1 and tm.state = 'ACTIVE' and hi.status = 'ACTIVE'
           and ($2::uuid is null or p.id > $2)
         order by p.id limit $3",
    )
    .bind(ctx.tenant_id)
    .bind(query.cursor)
    .bind(fetch_limit)
    .bind(query.workspace_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!(error = %e, "列 Tenant 角色候选成员失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let more = rows.len() as i64 > page;
    rows.truncate(page as usize);
    let next_cursor = if more {
        rows.last().map(|r| r.0.to_string())
    } else {
        None
    };

    // 必须读完整关系集；SpiceDB 断流或数据形状不符时整个视图失败，不能把
    // "未读到"显示成"无人持有角色"。分页只约束 Core 成员，不截断关系读取。
    let tenant_rels = match state
        .governance
        .spicedb
        .read(
            &RelationshipFilter {
                object_type: "tenant",
                object_id: Some(&tenant),
                relation: Some("admin"),
                subject_principal: None,
            },
            state.governance.cfg.relationship_page,
        )
        .await
    {
        Ok(rels) => rels,
        Err(e) => {
            tracing::warn!(error = %e, "读取 Tenant admin 关系失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let workspace_rels = if let Some(id) = query.workspace_id {
        let object = id.to_string();
        match state
            .governance
            .spicedb
            .read(
                &RelationshipFilter {
                    object_type: "workspace",
                    object_id: Some(&object),
                    relation: Some("admin"),
                    subject_principal: None,
                },
                state.governance.cfg.relationship_page,
            )
            .await
        {
            Ok(rels) => rels,
            Err(e) => {
                tracing::warn!(error = %e, "读取 Workspace admin 关系失败");
                return StatusCode::SERVICE_UNAVAILABLE.into_response();
            }
        }
    } else {
        vec![]
    };
    let parse_subjects = |rels: Vec<crate::spicedb::Relationship>| -> Option<HashSet<Uuid>> {
        rels.into_iter()
            .map(|r| Uuid::parse_str(&r.subject_principal).ok())
            .collect()
    };
    let (Some(tenant_admins), Some(workspace_admins)) =
        (parse_subjects(tenant_rels), parse_subjects(workspace_rels))
    else {
        tracing::error!("SpiceDB admin relation 含非法 Principal ID");
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    // Catalog 中没有 ACTIVE 且与 DD-82 模板一致的动作，不给按钮；不能把一个
    // 已撤下或漂移的 ActionDefinition 在前端继续展示为可用。
    let enabled: HashSet<String> = match sqlx::query_scalar(
        "select ad.action_key from catalog.action_definition ad
         join catalog.role_template rt
           on rt.role_key = ad.role_template_key and rt.version = ad.role_template_version
         where ad.status = 'ACTIVE' and rt.status = 'ACTIVE'
           and ad.action_key in ('tenant.admin.grant', 'tenant.admin.revoke',
                                 'workspace.admin.grant', 'workspace.admin.revoke')
           and ad.permission = 'manage' and ad.execution_mode = 'SYNC'
           and rt.relations = ARRAY['admin']::text[]
           and ((ad.target_type = 'TENANT_ROLE' and ad.permission_object_type = 'tenant'
                 and rt.object_type = 'tenant' and ad.action_key like 'tenant.admin.%')
             or (ad.target_type = 'WORKSPACE_ROLE' and ad.permission_object_type = 'workspace'
                 and rt.object_type = 'workspace' and ad.action_key like 'workspace.admin.%'))",
    )
    .fetch_all(&state.pool)
    .await
    {
        Ok(keys) => keys.into_iter().collect(),
        Err(e) => {
            tracing::warn!(error = %e, "读取角色 ActionDefinition 失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let admin_ids: Vec<Uuid> = tenant_admins.iter().copied().collect();
    let effective: Vec<Uuid> = match sqlx::query_scalar(
        "select p.id from identity.principal p
         join identity.tenant_membership tm on tm.tenant_principal_id = p.id
         where p.id = any($1) and p.tenant_id = $2 and p.kind = 'HUMAN' and p.status = 'ACTIVE'
           and tm.tenant_id = $2 and tm.state = 'ACTIVE'",
    )
    .bind(&admin_ids)
    .bind(ctx.tenant_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(ids) => ids,
        Err(e) => {
            tracing::warn!(error = %e, "角色列表有效 Tenant admin 判定失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let removal_actions = match active_member_removal_actions(&state.pool).await {
        Ok(keys) => keys,
        Err(error) => {
            tracing::warn!(%error,"读取成员撤权 ActionDefinition 失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let members = rows
        .into_iter()
        .map(|(principal_id, display_name, removable_workspace_member)| {
            let tenant_admin = tenant_admins.contains(&principal_id);
            let workspace_admin = workspace_admins.contains(&principal_id);
            let last_tenant_admin =
                tenant_admin && effective.len() == 1 && effective.first() == Some(&principal_id);
            RoleMemberView {
                principal_id: principal_id.to_string(),
                display_name,
                tenant_admin,
                workspace_admin,
                can_grant_tenant_admin: tenant_manage
                    && !tenant_admin
                    && enabled.contains("tenant.admin.grant"),
                can_revoke_tenant_admin: tenant_manage
                    && tenant_admin
                    && !last_tenant_admin
                    && enabled.contains("tenant.admin.revoke"),
                can_grant_workspace_admin: workspace_manage
                    && !workspace_admin
                    && enabled.contains("workspace.admin.grant"),
                can_revoke_workspace_admin: workspace_manage
                    && workspace_admin
                    && enabled.contains("workspace.admin.revoke"),
                last_tenant_admin,
                can_remove_from_workspace: Some(
                    workspace_manage
                        && removable_workspace_member
                        && principal_id != ctx.tenant_principal_id
                        && removal_actions.contains("workspace.member.revoke")
                        && crate::capability_registry::action_exposed("workspace.member.revoke"),
                ),
                can_remove_from_tenant: Some(
                    tenant_manage
                        && !last_tenant_admin
                        && principal_id != ctx.tenant_principal_id
                        && removal_actions.contains("tenant.member.revoke")
                        && crate::capability_registry::action_exposed("tenant.member.revoke"),
                ),
            }
        })
        .collect();
    (
        StatusCode::OK,
        Json(RoleMemberPage {
            members,
            next_cursor,
        }),
    )
        .into_response()
}

async fn active_member_removal_actions<'e>(
    executor: impl sqlx::PgExecutor<'e>,
) -> Result<HashSet<String>, sqlx::Error> {
    let keys:Vec<String>=sqlx::query_scalar(
        "select ad.action_key from catalog.action_definition ad
         where ad.status='ACTIVE' and ad.component_type_key='core' and ad.permission='manage'
           and ad.tenant_rule='SESSION_TENANT' and ad.execution_mode='TEMPORAL'
           and ad.workflow_type='ComponentTaskWorkflow' and ad.workflow_kind='MEMBERSHIP_REVOCATION'
           and ((ad.action_key='workspace.member.revoke' and ad.target_type='WORKSPACE_MEMBERSHIP'
             and ad.permission_object_type='workspace' and ad.workspace_rule='WORKSPACE_REQUIRED')
           or (ad.action_key='tenant.member.revoke' and ad.target_type='TENANT_MEMBERSHIP'
             and ad.permission_object_type='tenant' and ad.workspace_rule='TENANT_ONLY'
             and ad.confirmation_mode='APPROVAL' and exists(select 1 from catalog.approval_policy ap
               where ap.id=ad.approval_policy_id and ap.version=ad.approval_policy_version
                 and ap.status='ACTIVE' and ap.action_key=ad.action_key and ap.target_type=ad.target_type)))",
    ).fetch_all(executor).await?;
    Ok(keys.into_iter().collect())
}

#[cfg(test)]
mod member_action_tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires disposable migrated AGENT_INVOKE_TEST_DATABASE_URL; rolls back DDL and fixture"]
    async fn generated_catalog_guard_roundtrip_keeps_status_mutable_and_evidence_immutable() {
        use sqlx::Acquire;
        const UP: &str = include_str!(
            "../../../migrations/20261007040000_action_definition_generated_guard.up.sql"
        );
        const DOWN: &str = include_str!(
            "../../../migrations/20261007040000_action_definition_generated_guard.down.sql"
        );
        let pool = sqlx::PgPool::connect(&std::env::var("AGENT_INVOKE_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        let definition: Uuid = sqlx::query_scalar("select id from catalog.action_definition where action_key='workspace.create' and status='ACTIVE' and component_release_id is null")
            .fetch_one(&mut *tx).await.unwrap();
        let before: serde_json::Value =
            sqlx::query_scalar("select to_jsonb(d) from catalog.action_definition d where id=$1")
                .bind(definition)
                .fetch_one(&mut *tx)
                .await
                .unwrap();
        sqlx::raw_sql(UP).execute(&mut *tx).await.unwrap();
        for status in ["RETIRED", "ACTIVE"] {
            assert_eq!(
                sqlx::query("update catalog.action_definition set status=$2 where id=$1")
                    .bind(definition)
                    .bind(status)
                    .execute(&mut *tx)
                    .await
                    .unwrap()
                    .rows_affected(),
                1
            );
            let actual: serde_json::Value = sqlx::query_scalar(
                "select to_jsonb(d) from catalog.action_definition d where id=$1",
            )
            .bind(definition)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
            let mut expected = before.clone();
            expected["status"] = status.into();
            assert_eq!(actual, expected);
        }
        sqlx::raw_sql(DOWN).execute(&mut *tx).await.unwrap();
        let mut save = tx.begin().await.unwrap();
        let error =
            sqlx::query("update catalog.action_definition set status='RETIRED' where id=$1")
                .bind(definition)
                .execute(&mut *save)
                .await
                .unwrap_err();
        assert_eq!(
            error.as_database_error().and_then(|e| e.code()).as_deref(),
            Some("23001")
        );
        save.rollback().await.unwrap();
        sqlx::raw_sql(UP).execute(&mut *tx).await.unwrap();
        let mut save = tx.begin().await.unwrap();
        sqlx::query("update catalog.action_definition set status='RETIRED' where id=$1")
            .bind(definition)
            .execute(&mut *save)
            .await
            .unwrap();
        let error =
            sqlx::query("update catalog.action_definition set permission='read' where id=$1")
                .bind(definition)
                .execute(&mut *save)
                .await
                .unwrap_err();
        assert_eq!(
            error.as_database_error().and_then(|e| e.code()).as_deref(),
            Some("23001")
        );
        save.rollback().await.unwrap();
        let actual: serde_json::Value =
            sqlx::query_scalar("select to_jsonb(d) from catalog.action_definition d where id=$1")
                .bind(definition)
                .fetch_one(&mut *tx)
                .await
                .unwrap();
        assert_eq!(
            actual, before,
            "failed content update must roll back the whole savepoint, including status"
        );

        let tenant = Uuid::new_v4();
        let actor = Uuid::new_v4();
        let action = Uuid::new_v4();
        sqlx::query("insert into identity.tenant(id,slug,name,state) values($1,$2,$2,'ACTIVE')")
            .bind(tenant)
            .bind(tenant.to_string())
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'HUMAN','ACTIVE')")
            .bind(actor).bind(tenant).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into admission.action_execution(id,operation_id,tenant_id,action_key,action_version,
            initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id)
            select $1,$2,$3,action_key,version,$4,$4,$5,$6,'EVALUATING','NOT_DISPATCHED',$7 from catalog.action_definition where id=$8")
            .bind(action).bind(Uuid::new_v4()).bind(tenant).bind(actor).bind(Uuid::new_v4())
            .bind(collab_bridge::limits::canonical_digest(&serde_json::json!({}))).bind(Uuid::new_v4()).bind(definition)
            .execute(&mut *tx).await.unwrap();
        let referenced: Uuid = sqlx::query_scalar(
            "select action_definition_id from admission.action_execution where id=$1",
        )
        .bind(action)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert_eq!(referenced, definition);
        let mut save = tx.begin().await.unwrap();
        let error = sqlx::query("delete from catalog.action_definition where id=$1")
            .bind(definition)
            .execute(&mut *save)
            .await
            .unwrap_err();
        assert_eq!(
            error.as_database_error().and_then(|e| e.code()).as_deref(),
            Some("23001")
        );
        assert!(error
            .as_database_error()
            .unwrap()
            .message()
            .contains("ActionExecution"));
        save.rollback().await.unwrap();
        let actual: serde_json::Value =
            sqlx::query_scalar("select to_jsonb(d) from catalog.action_definition d where id=$1")
                .bind(definition)
                .fetch_one(&mut *tx)
                .await
                .unwrap();
        assert_eq!(actual, before);
        tx.rollback().await.unwrap();
    }

    #[tokio::test]
    #[ignore = "requires AGENT_INVOKE_TEST_DATABASE_URL pointing at a disposable migrated database"]
    async fn member_removal_view_requires_its_original_action_and_active_approval_policy() {
        let pool = sqlx::PgPool::connect(&std::env::var("AGENT_INVOKE_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        let active = active_member_removal_actions(&mut *tx).await.unwrap();
        assert!(active.contains("workspace.member.revoke"));
        assert!(active.contains("tenant.member.revoke"));
        sqlx::query("update catalog.approval_policy set status='RETIRED' where action_key='tenant.member.revoke' and status='ACTIVE'")
            .execute(&mut *tx).await.unwrap();
        let retired = active_member_removal_actions(&mut *tx).await.unwrap();
        assert!(retired.contains("workspace.member.revoke"));
        assert!(!retired.contains("tenant.member.revoke"));
        tx.rollback().await.unwrap();
    }
}

/// 基础审计页：**只看自己的动作**。
///
/// Tenant/Workspace 聚合与错误 evidence 需要目标 `audit` permission
/// （`.design/03` §14），而那要 Core 侧的 fresh SpiceDB Check——属于 Stage 2。
/// 这里不写一个恒为真的权限判断冒充它：能看的范围收窄到调用方自己，
/// 那是无需额外判定就成立的最小集合。
pub async fn list_own_audit(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    match sqlx::query_as::<
        _,
        (
            chrono::DateTime<chrono::Utc>,
            String,
            String,
            String,
            String,
            Option<Uuid>,
        ),
    >(
        "select occurred_at, event_type, action_key, decision, result_code, workspace_id
         from audit.audit_event
         where tenant_id = $1 and actor_principal_id = $2
         order by occurred_at desc
         limit $3",
    )
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .bind(state.message_page_limit)
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => {
            let mut entries = Vec::with_capacity(rows.len());
            for (occurred_at, event_type, action_key, decision, result_code, workspace_id) in rows {
                let event_type = match db_enum("audit_event.event_type", &event_type) {
                    Ok(t) => t,
                    Err(r) => return r,
                };
                entries.push(OwnAuditEntry {
                    occurred_at: occurred_at.to_rfc3339(),
                    event_type,
                    action_key,
                    decision,
                    result_code,
                    // Tenant 级动作没有 Workspace：缺省，不写 null
                    workspace_id: workspace_id.map(|w| w.to_string()),
                });
            }
            (StatusCode::OK, Json(entries)).into_response()
        }
        Err(e) => {
            tracing::warn!(error = %e, "列审计失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}
