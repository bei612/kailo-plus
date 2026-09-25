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
    OwnAuditEntry, RoleMemberPage, RoleMemberView, RoleWorkspacePage, RoleWorkspaceView,
    WorkspaceMemberView, WorkspaceView,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::bff::{db_enum, resolve_execution_context, BffState};
use crate::spicedb::{Consistency, RelationshipFilter};

/// 我在当前 Tenant 里能进的 Workspace。
///
/// 只列有 active WorkspaceMembership 且两侧 binding 都 ACTIVE 的——列出一个
/// 点进去会 403 的 Workspace，比不列更糟：它把「存在但你进不去」变成了可见信息。
pub async fn list_workspaces(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    match sqlx::query_as::<_, (Uuid, String, String)>(
        "select w.id, w.slug, w.name
         from identity.workspace w
         join identity.workspace_membership wm
           on wm.workspace_id = w.id and wm.tenant_principal_id = $1 and wm.state = 'ACTIVE'
         join projection.workspace_buzz_binding b
           on b.workspace_id = w.id and b.state = 'ACTIVE'
         where w.tenant_id = $2 and w.state = 'ACTIVE'
         order by w.slug",
    )
    .bind(ctx.tenant_principal_id)
    .bind(ctx.tenant_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => (
            StatusCode::OK,
            Json(
                rows.into_iter()
                    .map(|(id, slug, name)| WorkspaceView {
                        id: id.to_string(),
                        slug,
                        name,
                    })
                    .collect::<Vec<_>>(),
            ),
        )
            .into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "列 Workspace 失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
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
    if let Err(r) = crate::web_transport::admit_workspace(&state, &ctx, workspace_id).await {
        return r;
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
    let mut rows: Vec<(Uuid, String)> = match sqlx::query_as(
        "select id, name from identity.workspace
         where tenant_id = $1 and state = 'ACTIVE'
         order by id limit $2 offset $3",
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
    let ids: Vec<String> = rows.iter().map(|(id, _)| id.to_string()).collect();
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
    let workspaces = rows
        .into_iter()
        .filter(|(id, _)| allowed.contains(&id.to_string()))
        .map(|(id, name)| RoleWorkspaceView {
            id: id.to_string(),
            name,
        })
        .collect();
    (
        StatusCode::OK,
        Json(RoleWorkspacePage {
            workspaces,
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
    let mut rows: Vec<(Uuid, String)> = match sqlx::query_as(
        "select p.id, hi.display_name
         from identity.principal p
         join identity.tenant_membership tm on tm.tenant_principal_id = p.id
         join identity.human_identity hi on hi.id = tm.human_identity_id
         where p.tenant_id = $1 and p.kind = 'HUMAN' and p.status = 'ACTIVE'
           and tm.tenant_id = $1 and tm.state = 'ACTIVE'
           and ($2::uuid is null or p.id > $2)
         order by p.id limit $3",
    )
    .bind(ctx.tenant_id)
    .bind(query.cursor)
    .bind(fetch_limit)
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
    let members = rows
        .into_iter()
        .map(|(principal_id, display_name)| {
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
