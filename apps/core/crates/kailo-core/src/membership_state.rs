//! 成员状态跃迁（`DD-41`、`DD-45`、`.design/09` 第 5 步）。
//!
//! 这里**不重做投影查证**。`.design/04` 把查证明确归给 Workflow：「Workflow 再撤
//! SpiceDB relationship、用 CONTROL identity 移除 Relay/Channel 成员并查证」。
//! 在 Core 里再验一遍 SpiceDB 就是第二份查证权威——两边判定一旦分歧，谁说了算
//! 没有答案，而这正是 `GOAL` 里「不复制出第二份权威」要避免的。
//!
//! Core 在这条路径上的职责是三件别人做不了的事：
//!
//! 1. **跃迁合法性**：状态机是 `.design/03` 固定的，非法跃迁一律拒绝；
//! 2. **乐观并发**：带上读到的版本，不匹配即冲突（`01` §7）；
//! 3. **可归属**：每次跃迁必须指向一个已登记的 `WorkflowRef`，且 kind 属于
//!    成员生命周期。没有它，状态就成了可以被任意服务调用改写的东西。
//!
//! Tenant 成员进入 `REVOKED` 还要求已无 active Resource/Asset owner 引用
//! （`DD-45`）。该 owner gate 与查证一样在 Workflow 内执行（`.design/09` 第 5 步
//! 的撤权链）；Resource/Asset 在本 Stage 尚未存在，因此当前没有可引用的对象。
//! 这里不写一个恒为真的检查冒充它——那会在 Resource 出现时悄悄放行。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::membership_projection::MembershipScope;
use crate::service_api::{authorize, unavailable, ServiceState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionRequest {
    pub scope: MembershipScope,
    pub membership_id: Uuid,
    /// 读到的版本。不匹配即冲突——中途被别的动作改过的事实不能被覆盖。
    pub from_version: i32,
    pub to_state: String,
    /// 负责这次跃迁的 Workflow。它必须已登记且 kind 属于成员生命周期。
    pub workflow_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionResponse {
    pub state: String,
    pub version: i32,
}

/// `.design/03` §3 固定的成员状态机。两张表的取值不同，因此分开列。
///
/// 写成表而不是 if 链：合法跃迁是设计事实，列出来就能逐条对照 `.design`，
/// 而条件分支会随着每次改动长出说不清来历的组合。
const TENANT_TRANSITIONS: &[(&str, &str)] = &[
    ("INVITED", "PROVISIONING"),
    ("INVITED", "REVOKED"),
    ("PROVISIONING", "ACTIVE"),
    ("PROVISIONING", "ERROR"),
    ("ACTIVE", "REVOKING"),
    ("REVOKING", "REVOKED"),
    ("REVOKING", "ERROR"),
    ("ERROR", "REVOKING"),
];

const WORKSPACE_TRANSITIONS: &[(&str, &str)] = &[
    ("PROVISIONING", "ACTIVE"),
    ("PROVISIONING", "ERROR"),
    ("ACTIVE", "REVOKING"),
    ("REVOKING", "REVOKED"),
    ("REVOKING", "ERROR"),
    ("ERROR", "REVOKING"),
];

pub async fn transition_membership(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<TransitionRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    // 可归属：跃迁必须指向一个已登记的成员生命周期 Workflow。
    // 两个 kind 共用同一套跃迁——建立与撤权是同一条状态机的两个方向（DD-45）。
    let wf = sqlx::query!(
        "select kind from projection.workflow_ref where workflow_id = $1",
        req.workflow_id
    )
    .fetch_optional(&state.pool)
    .await;
    match wf {
        Ok(Some(row))
            if matches!(
                row.kind.as_deref(),
                Some("MEMBERSHIP_PROJECTION") | Some("MEMBERSHIP_REVOCATION")
            ) => {}
        Ok(_) => {
            tracing::warn!(
                workflow_id = %req.workflow_id,
                "跃迁未指向已登记的成员生命周期 Workflow"
            );
            return StatusCode::FORBIDDEN.into_response();
        }
        Err(e) => return unavailable(e),
    }

    let allowed = match req.scope {
        MembershipScope::Tenant => TENANT_TRANSITIONS,
        MembershipScope::Workspace => WORKSPACE_TRANSITIONS,
    };

    // 跃迁、版本与状态机在同一条 UPDATE 里判定：分成「先读再写」会在两步之间
    // 留下窗口，并发的撤权会被随后的 ACTIVE 覆盖掉。
    //
    // `from_state = any(...)` 取的是能到达 to_state 的全部来源状态；来源为空
    // 说明 to_state 根本不是该状态机的合法目标。
    let froms: Vec<String> = allowed
        .iter()
        .filter(|(_, to)| *to == req.to_state)
        .map(|(from, _)| (*from).to_owned())
        .collect();
    if froms.is_empty() {
        tracing::warn!(to = %req.to_state, "目标状态不在该状态机内");
        return StatusCode::FORBIDDEN.into_response();
    }

    let updated = match req.scope {
        MembershipScope::Tenant => sqlx::query!(
            "update identity.tenant_membership
                 set state = $1, version = version + 1
                 where id = $2 and version = $3 and state = any($4)
                 returning state, version",
            req.to_state,
            req.membership_id,
            req.from_version,
            &froms
        )
        .fetch_optional(&state.pool)
        .await
        .map(|o| o.map(|r| (r.state, r.version))),
        MembershipScope::Workspace => sqlx::query!(
            "update identity.workspace_membership
                 set state = $1, version = version + 1
                 where id = $2 and version = $3 and state = any($4)
                 returning state, version",
            req.to_state,
            req.membership_id,
            req.from_version,
            &froms
        )
        .fetch_optional(&state.pool)
        .await
        .map(|o| o.map(|r| (r.state, r.version))),
    };

    match updated {
        Ok(Some((state, version))) => {
            (StatusCode::OK, Json(TransitionResponse { state, version })).into_response()
        }
        // 没有行被更新有三种成因：id 不存在、版本不匹配、当前状态不允许该跃迁。
        // 三者都是「按现在的事实这次跃迁不成立」，都不该重试；不逐一区分是因为
        // 区分需要再读一次，而那次读到的又可能是第四个版本。
        Ok(None) => {
            tracing::warn!(
                membership = %req.membership_id,
                to = %req.to_state,
                from_version = req.from_version,
                "跃迁不成立：版本不匹配或当前状态不允许"
            );
            StatusCode::CONFLICT.into_response()
        }
        Err(e) => unavailable(e),
    }
}
