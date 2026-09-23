//! 平台管理页的只读视图（`SS-WEB-01`）。
//!
//! 三个页面各要一份数据：Workspace 选择、成员、基础审计。它们都是**只读**
//! 投影，不引入第二份权威——`.design/14` 明写 Business Observability 不另建
//! 事实权威表，BFF 以既有事实组成只读视图。
//!
//! 每个视图的可见范围都由调用方自己的 scope 决定，不接受任何范围参数：
//! 放开范围参数等于把「我能看谁」交给调用方声明。

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use uuid::Uuid;

use crate::bff::{resolve_execution_context, BffState};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRow {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberRow {
    pub principal_id: Uuid,
    pub display_name: String,
    /// 此人全部 ACTIVE 的 Buzz 协议公钥：Web 一把，另加每台原生设备一把
    /// （DD-77）。公钥是公开事实，与私钥托管无关；客户端据此把任一端签发的
    /// 消息归到同一个人名下。
    pub pubkeys: Vec<String>,
    pub state: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditRow {
    pub occurred_at: String,
    pub event_type: String,
    pub action_key: String,
    pub decision: String,
    pub result_code: String,
    pub workspace_id: Option<Uuid>,
}

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
                    .map(|(id, slug, name)| WorkspaceRow { id, slug, name })
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
    // 一人多把公钥时按人聚合：左连接直接展开会让同一个人出现多行。
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
        Ok(rows) => (
            StatusCode::OK,
            Json(
                rows.into_iter()
                    .map(|(principal_id, display_name, pubkeys, state)| MemberRow {
                        principal_id,
                        display_name,
                        pubkeys,
                        state,
                    })
                    .collect::<Vec<_>>(),
            ),
        )
            .into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "列成员失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
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
        Ok(rows) => (
            StatusCode::OK,
            Json(
                rows.into_iter()
                    .map(
                        |(
                            occurred_at,
                            event_type,
                            action_key,
                            decision,
                            result_code,
                            workspace_id,
                        )| {
                            AuditRow {
                                occurred_at: occurred_at.to_rfc3339(),
                                event_type,
                                action_key,
                                decision,
                                result_code,
                                workspace_id,
                            }
                        },
                    )
                    .collect::<Vec<_>>(),
            ),
        )
            .into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "列审计失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}
