//! 成员生命周期 Workflow 的启动面（`.design/06` §3.1、`DD-48`）。
//!
//! 这条路径上 Core 做三件事，顺序不能换：
//!
//! 1. 确认 Core 自己的 fail-closed 状态**已经**成立——建立走 `PROVISIONING`，
//!    撤权走 `REVOKING`。撤权先置 `REVOKING` 再投影是设计固定的顺序
//!    （`.design/09` 第 5 步）：先关门再收敛，反过来会在收敛期间继续放行。
//! 2. 在 Start 之前持久化唯一 `WorkflowRef`，workflow ID 固定为
//!    `kailo:<kind>:<tenant_id>:<primary_entity_id>:<entity_version>`。
//! 3. 以 reuse/conflict 三项策略至多一次启动，并回填 run ID。
//!
//! 它**不做准入判定**。谁可以邀请或撤销一个成员，是 ActionExecution 的门禁
//! 结论；本端点要求调用方给出一个已持久化且 `gate_state=ALLOWED` 的
//! ActionExecution，并核对它与该成员同 Tenant。在这里凭空造一个 `ALLOWED`
//! 的 ActionExecution，就是给自己发了一张准入通行证。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::component_task::{self, ComponentTaskInput};
use crate::membership_projection::MembershipScope;
use crate::service_api::{authorize, unavailable, ServiceState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleRequest {
    pub scope: MembershipScope,
    pub membership_id: Uuid,
    /// 已持久化且已准入的 ActionExecution。它是这次启动的授权依据。
    pub action_execution_id: Uuid,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleResponse {
    pub workflow_id: String,
    pub kind: String,
    /// 为空表示本次调用没有创建 execution（同一 ID 的已存在）。
    pub run_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MembershipEnvelope {
    pub membership: MembershipTarget,
}

/// Tenant/Workspace 生命周期的冻结输入。
#[derive(Debug, Serialize)]
pub struct ScopeEnvelope {
    pub scope: ScopeTarget,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeTarget {
    pub id: String,
    pub version: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipTarget {
    scope: String,
    membership_id: String,
    membership_version: i32,
    subject_principal_id: String,
    relation_object_id: String,
}

pub async fn start_membership_lifecycle(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<LifecycleRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    let (tenant_id, principal_id, object_id, version, membership_state) =
        match load(&state, &req).await {
            Ok(v) => v,
            Err(Some(r)) => return r,
            Err(None) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
        };

    // 状态决定 kind，不由调用方指定：让调用方选 kind 就等于让它决定这是建立
    // 还是撤权，而那件事已经由 Core 的 fail-closed 状态表达过一次了。
    let kind = match membership_state.as_str() {
        "PROVISIONING" => "MEMBERSHIP_PROJECTION",
        "REVOKING" => "MEMBERSHIP_REVOCATION",
        other => {
            tracing::warn!(state = other, "成员状态不在可启动生命周期的两个状态上");
            return StatusCode::CONFLICT.into_response();
        }
    };

    // 准入依据：ActionExecution 必须已存在、已 ALLOWED、且与该成员同 Tenant。
    match sqlx::query!(
        "select 1 as ok from admission.action_execution
         where id = $1 and tenant_id = $2 and gate_state = 'ALLOWED'",
        req.action_execution_id,
        tenant_id
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(_)) => {}
        Ok(None) => {
            tracing::warn!(action = %req.action_execution_id, "ActionExecution 不存在或未准入");
            return StatusCode::FORBIDDEN.into_response();
        }
        Err(e) => return unavailable(e),
    }

    let workflow_id =
        component_task::workflow_id(kind, tenant_id, &req.membership_id.to_string(), version);
    let input = ComponentTaskInput {
        kind: kind.to_owned(),
        target: MembershipEnvelope {
            membership: MembershipTarget {
                scope: match req.scope {
                    MembershipScope::Tenant => "TENANT".to_owned(),
                    MembershipScope::Workspace => "WORKSPACE".to_owned(),
                },
                membership_id: req.membership_id.to_string(),
                membership_version: version,
                subject_principal_id: principal_id.to_string(),
                relation_object_id: object_id.to_string(),
            },
        },
    };

    match component_task::start(
        &state.pool,
        &state.temporal,
        &workflow_id,
        tenant_id,
        req.action_execution_id,
        &input,
    )
    .await
    {
        Ok(run_id) => (
            StatusCode::OK,
            Json(LifecycleResponse {
                workflow_id,
                kind: kind.to_owned(),
                run_id,
            }),
        )
            .into_response(),
        Err(r) => r,
    }
}

type Loaded = (Uuid, Uuid, Uuid, i32, String);

/// `Err(Some(resp))` 是确定的拒绝，`Err(None)` 是依赖不可用。
async fn load(state: &ServiceState, req: &LifecycleRequest) -> Result<Loaded, Option<Response>> {
    match req.scope {
        MembershipScope::Tenant => {
            let row = sqlx::query!(
                "select tenant_id, tenant_principal_id, version, state
                 from identity.tenant_membership where id = $1",
                req.membership_id
            )
            .fetch_optional(&state.pool)
            .await
            .map_err(|_| None)?
            .ok_or(Some(StatusCode::NOT_FOUND.into_response()))?;
            // Tenant 成员的 SpiceDB 关系客体就是 Tenant 自己
            Ok((
                row.tenant_id,
                row.tenant_principal_id,
                row.tenant_id,
                row.version,
                row.state,
            ))
        }
        MembershipScope::Workspace => {
            let row = sqlx::query!(
                "select w.tenant_id, wm.tenant_principal_id, wm.workspace_id, wm.version, wm.state
                 from identity.workspace_membership wm
                 join identity.workspace w on w.id = wm.workspace_id
                 where wm.id = $1",
                req.membership_id
            )
            .fetch_optional(&state.pool)
            .await
            .map_err(|_| None)?
            .ok_or(Some(StatusCode::NOT_FOUND.into_response()))?;
            Ok((
                row.tenant_id,
                row.tenant_principal_id,
                row.workspace_id,
                row.version,
                row.state,
            ))
        }
    }
}

// ---- Tenant / Workspace 生命周期的启动面 ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeLifecycleRequest {
    pub kind: crate::scope_state::ScopeKind,
    pub id: Uuid,
    pub action_execution_id: Uuid,
}

/// 启动 `TENANT_LIFECYCLE` 或 `WORKSPACE_LIFECYCLE`。
///
/// 与成员那条同形：状态决定这是不是该起 Workflow（只有 `PROVISIONING` 能起
/// 建立链），ActionExecution 提供准入依据，WorkflowRef 先于 Start 落库。
///
/// 不复用成员那个端点：两者的 target 解析、状态机与 Workflow input 形状都不同，
/// 合并后只会得到一个内部按 kind 分叉三次的函数。
pub async fn start_scope_lifecycle(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<ScopeLifecycleRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    let (kind, tenant_id, version, scope_state) = match req.kind {
        crate::scope_state::ScopeKind::Tenant => {
            match sqlx::query!(
                "select version, state from identity.tenant where id = $1",
                req.id
            )
            .fetch_optional(&state.pool)
            .await
            {
                Ok(Some(r)) => ("TENANT_LIFECYCLE", req.id, r.version, r.state),
                Ok(None) => return StatusCode::NOT_FOUND.into_response(),
                Err(e) => return unavailable(e),
            }
        }
        crate::scope_state::ScopeKind::Workspace => {
            match sqlx::query!(
                "select tenant_id, version, state from identity.workspace where id = $1",
                req.id
            )
            .fetch_optional(&state.pool)
            .await
            {
                Ok(Some(r)) => ("WORKSPACE_LIFECYCLE", r.tenant_id, r.version, r.state),
                Ok(None) => return StatusCode::NOT_FOUND.into_response(),
                Err(e) => return unavailable(e),
            }
        }
    };

    // Stage 1 只注册建立链。暂停/恢复有各自的入口与 input，不能靠同一个端点
    // 按当前状态猜——猜错就是对一个运行中的 Tenant 执行建立。
    if scope_state != "PROVISIONING" {
        tracing::warn!(state = %scope_state, "scope 不在 PROVISIONING，不启动建立链");
        return StatusCode::CONFLICT.into_response();
    }

    match sqlx::query!(
        "select 1 as ok from admission.action_execution
         where id = $1 and tenant_id = $2 and gate_state = 'ALLOWED'",
        req.action_execution_id,
        tenant_id
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(_)) => {}
        Ok(None) => return StatusCode::FORBIDDEN.into_response(),
        Err(e) => return unavailable(e),
    }

    let workflow_id = component_task::workflow_id(kind, tenant_id, &req.id.to_string(), version);
    let input = ComponentTaskInput {
        kind: kind.to_owned(),
        target: ScopeEnvelope {
            scope: ScopeTarget {
                id: req.id.to_string(),
                version,
                // Workspace 在 SpiceDB 里经 tenant 关系归属其 Tenant；
                // Tenant 自己没有上层客体
                tenant_id: match req.kind {
                    crate::scope_state::ScopeKind::Workspace => Some(tenant_id.to_string()),
                    crate::scope_state::ScopeKind::Tenant => None,
                },
            },
        },
    };

    match component_task::start(
        &state.pool,
        &state.temporal,
        &workflow_id,
        tenant_id,
        req.action_execution_id,
        &input,
    )
    .await
    {
        Ok(run_id) => (
            StatusCode::OK,
            Json(LifecycleResponse {
                workflow_id,
                kind: kind.to_owned(),
                run_id,
            }),
        )
            .into_response(),
        Err(r) => r,
    }
}
