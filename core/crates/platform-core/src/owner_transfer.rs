//! DD-168(2)（`.design/03` §2/§3.1、DD-45）：成员“名下资源”只读投影，供 Tenant 管理员
//! 在成员撤权前后逐项移交。
//!
//! `GET /api/v1/owner-transfers`：不带参数时列出 TenantMembership 处于 `REVOKING` 且仍
//! 持有 owner 责任的成员——这些责任正是 `membership_state` 进入 `REVOKED` 前核对的同一
//! 事实（未终结的 Resource 与 Asset）；带 `principalId` 时只列该成员（任一状态）。
//! 每项给出能否以 `resource.transfer_owner` 移交及不能的原因；它不建立 ActionExecution，
//! 移交本身仍经该受治理动作与审批。每次 fresh 校验 Tenant `manage`。

use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
    Json,
};
use contracts::ReasonCode;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::bff::{resolve_execution_context, BffState};
use crate::governance::Refusal;
use crate::spicedb::Consistency;

/// 一次回应列出的成员与每人的条目上界；超出时 `truncated=true`，不静默截断。
const MEMBER_LIMIT: i64 = 50;
const ITEM_LIMIT: i64 = 500;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerTransferQuery {
    principal_id: Option<Uuid>,
}

#[derive(sqlx::FromRow)]
struct MemberRow {
    principal_id: Uuid,
    display_name: String,
    membership_state: String,
}

#[derive(sqlx::FromRow)]
struct ItemRow {
    resource_id: Uuid,
    type_key: String,
    name: Option<String>,
    home_workspace_id: Option<Uuid>,
    home_workspace_name: Option<String>,
    state: String,
    resource_version: i32,
    resource_owner_principal_id: Uuid,
    owned_resource: bool,
    asset_count: i64,
    pending: bool,
    automation_enabled: bool,
}

/// 不能移交的原因；`None` 表示可以提交 `resource.transfer_owner`。
fn block_reason(row: &ItemRow) -> Option<&'static str> {
    if row.pending {
        Some("PROJECTION_PENDING")
    } else if !crate::agent_definition::transferable_state(&row.state) {
        Some("STATE")
    } else if row.owned_resource && row.automation_enabled {
        Some("AUTOMATION_ENABLED")
    } else {
        None
    }
}

fn item_view(row: &ItemRow) -> Value {
    let mut item = json!({
        "resourceId": row.resource_id,
        "typeKey": row.type_key,
        "state": row.state,
        "resourceVersion": row.resource_version,
        "resourceOwnerPrincipalId": row.resource_owner_principal_id,
        "ownedResource": row.owned_resource,
        "assetCount": row.asset_count,
        "transferable": block_reason(row).is_none(),
    });
    if let Some(name) = row.name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        item["name"] = json!(name);
    }
    if let Some(ws) = row.home_workspace_id {
        item["homeWorkspaceId"] = json!(ws);
    }
    if let Some(name) = &row.home_workspace_name {
        item["homeWorkspaceName"] = json!(name);
    }
    if let Some(reason) = block_reason(row) {
        item["blockReason"] = json!(reason);
    }
    item
}

pub async fn list(
    State(state): State<BffState>,
    Query(query): Query<OwnerTransferQuery>,
    headers: HeaderMap,
) -> Response {
    let mut response = read(&state, &headers, query.principal_id).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn read(state: &BffState, headers: &HeaderMap, principal: Option<Uuid>) -> Response {
    let ctx = match resolve_execution_context(state, headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
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
        Ok(check) if check.allowed => {}
        Ok(_) => return Refusal::Denied(ReasonCode::PermissionDenied).respond(None),
        Err(e) => {
            return Refusal::Unavailable(format!("名下资源 Tenant manage 判定失败：{e}"))
                .respond(None)
        }
    }
    match assemble(state, ctx.tenant_id, principal).await {
        Ok(body) => Json(body).into_response(),
        Err(e) => Refusal::from(e).respond(None),
    }
}

async fn assemble(
    state: &BffState,
    tenant: Uuid,
    principal: Option<Uuid>,
) -> Result<Value, sqlx::Error> {
    // 与 membership_state 的 REVOKED 前提同一口径：未终结或有未收敛投影的 Resource/Asset。
    let members: Vec<MemberRow> = sqlx::query_as(
        "select p.id as principal_id, hi.display_name, tm.state as membership_state
         from identity.tenant_membership tm
         join identity.principal p on p.id=tm.tenant_principal_id and p.tenant_id=tm.tenant_id
         join identity.human_identity hi on hi.id=tm.human_identity_id
         where tm.tenant_id=$1 and p.kind='HUMAN'
           and (($2::uuid is null and tm.state='REVOKING') or p.id=$2)
           and ($2::uuid is not null or exists(select 1 from catalog.resource r
                 where r.tenant_id=tm.tenant_id and r.owner_principal_id=p.id
                   and (r.state not in ('DELETED','FAILED') or r.projection_action_execution_id is not null))
               or exists(select 1 from catalog.asset a
                 where a.tenant_id=tm.tenant_id and a.owner_principal_id=p.id
                   and (a.state not in ('DELETED','FAILED') or a.projection_action_execution_id is not null)))
         order by hi.display_name, p.id limit $3",
    )
    .bind(tenant)
    .bind(principal)
    .bind(MEMBER_LIMIT + 1)
    .fetch_all(&state.pool)
    .await?;
    let truncated_members = members.len() as i64 > MEMBER_LIMIT;
    let mut out = Vec::new();
    for member in members.into_iter().take(MEMBER_LIMIT as usize) {
        // 名下 Resource，以及此人名下但父 Resource 属于他人的 Asset（按父 Resource 汇总）。
        let items: Vec<ItemRow> = sqlx::query_as(
            "with mine as (
               select r.id from catalog.resource r
               where r.tenant_id=$1 and r.owner_principal_id=$2
                 and (r.state not in ('DELETED','FAILED') or r.projection_action_execution_id is not null)
               union
               select a.resource_id from catalog.asset a
               where a.tenant_id=$1 and a.owner_principal_id=$2
                 and (a.state not in ('DELETED','FAILED') or a.projection_action_execution_id is not null))
             select r.id as resource_id, r.type_key,
               coalesce(ad.display_name, sd.display_name, tm.name, mc.display_name, iad.display_name,
                 (select v.name from catalog.automation_version v
                  where v.automation_resource_id=r.id order by v.ordinal desc limit 1)) as name,
               r.home_workspace_id, w.name as home_workspace_name, r.state, r.version as resource_version,
               r.owner_principal_id as resource_owner_principal_id,
               r.owner_principal_id=$2 as owned_resource,
               (select count(*) from catalog.asset a where a.tenant_id=$1 and a.resource_id=r.id
                  and a.owner_principal_id=$2 and a.state not in ('DELETED','FAILED')) as asset_count,
               (r.projection_action_execution_id is not null or exists(select 1 from catalog.asset a
                  where a.tenant_id=$1 and a.resource_id=r.id and a.owner_principal_id=$2
                    and a.projection_action_execution_id is not null)) as pending,
               exists(select 1 from catalog.automation_definition d
                  where d.resource_id=r.id and d.state='ENABLED') as automation_enabled
             from mine join catalog.resource r on r.id=mine.id and r.tenant_id=$1
             left join identity.workspace w on w.id=r.home_workspace_id and w.tenant_id=r.tenant_id
             left join catalog.agent_definition ad on ad.resource_id=r.id
             left join catalog.skill_definition sd on sd.resource_id=r.id
             left join catalog.agent_team tm on tm.resource_id=r.id
             left join catalog.mcp_connection mc on mc.resource_id=r.id
             left join catalog.agent_installation ai on ai.resource_id=r.id
             left join catalog.agent_definition iad on iad.resource_id=ai.agent_resource_id
             order by r.type_key, r.id limit $3",
        )
        .bind(tenant)
        .bind(member.principal_id)
        .bind(ITEM_LIMIT + 1)
        .fetch_all(&state.pool)
        .await?;
        let truncated = items.len() as i64 > ITEM_LIMIT;
        out.push(json!({
            "principalId": member.principal_id,
            "displayName": member.display_name,
            "membershipState": member.membership_state,
            "items": items.iter().take(ITEM_LIMIT as usize).map(item_view).collect::<Vec<_>>(),
            "truncated": truncated,
        }));
    }
    Ok(json!({ "members": out, "truncated": truncated_members }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(state: &str, owned: bool, pending: bool, enabled: bool) -> ItemRow {
        ItemRow {
            resource_id: Uuid::nil(),
            type_key: "automation".into(),
            name: Some("  Weekly digest ".into()),
            home_workspace_id: Some(Uuid::nil()),
            home_workspace_name: Some("Release".into()),
            state: state.into(),
            resource_version: 3,
            resource_owner_principal_id: Uuid::nil(),
            owned_resource: owned,
            asset_count: 2,
            pending,
            automation_enabled: enabled,
        }
    }

    #[test]
    fn block_reasons_follow_the_transfer_admission() {
        assert_eq!(block_reason(&row("ACTIVE", true, false, false)), None);
        assert_eq!(block_reason(&row("RETAINED_READ_ONLY", true, false, false)), None);
        assert_eq!(block_reason(&row("ACTIVE", true, true, false)), Some("PROJECTION_PENDING"));
        assert_eq!(block_reason(&row("DELETING", true, false, false)), Some("STATE"));
        assert_eq!(block_reason(&row("ACTIVE", true, false, true)), Some("AUTOMATION_ENABLED"));
        // Left-behind Assets under someone else's enabled automation are gathered by its owner.
        assert_eq!(block_reason(&row("ACTIVE", false, false, true)), None);
    }

    #[test]
    fn item_view_trims_names_and_states_the_block() {
        let view = item_view(&row("ACTIVE", true, false, true));
        assert_eq!(view["name"], "Weekly digest");
        assert_eq!(view["transferable"], false);
        assert_eq!(view["blockReason"], "AUTOMATION_ENABLED");
        assert_eq!(view["homeWorkspaceName"], "Release");
        let blank = ItemRow { name: Some("  ".into()), ..row("ACTIVE", true, false, false) };
        assert!(item_view(&blank).get("name").is_none());
    }
}
