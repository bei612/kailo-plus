//! 成员生命周期 Workflow 的启动面（`.design/06` §3.1、`DD-48`）。
//!
//! 这条路径上 Core 做三件事，顺序不能换：
//!
//! 1. 确认 Core 自己的 fail-closed 状态**已经**成立——建立走 `PROVISIONING`，
//!    撤权走 `REVOKING`。撤权先置 `REVOKING` 再投影是设计固定的顺序
//!    （`.design/09` 第 5 步）：先关门再收敛，反过来会在收敛期间继续放行。
//! 2. 在 Start 之前持久化唯一 `WorkflowRef`，workflow ID 固定为
//!    `platform:<kind>:<tenant_id>:<primary_entity_id>:<entity_version>`。
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
use crate::governance::{record_direct_launch, AuditClass};
use crate::membership_projection::MembershipScope;
use crate::service_api::{authorize, unavailable, ServiceState};
use crate::temporal::TemporalClient;
use sqlx::PgPool;

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
    /// 建立链不写此字段：已录制与在途的建立 history 的 input 逐字不变，Worker 以
    /// 字段缺省识别建立。暂停与恢复显式写出（`.design/06` §7.3）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation: Option<ScopeOperation>,
}

/// scope 生命周期 Workflow 执行的那一段状态机。调用方声明意图，Core 再核对实体
/// 此刻正停在该意图的收敛中状态——两者不一致即拒绝，不按当前状态替调用方猜。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ScopeOperation {
    #[default]
    Provision,
    Suspend,
    Restore,
}

impl ScopeOperation {
    /// 启动该段 Workflow 时实体必须停在的收敛中状态。
    pub fn converging_state(self) -> &'static str {
        match self {
            Self::Provision => "PROVISIONING",
            Self::Suspend => "SUSPENDING",
            Self::Restore => "RESTORING",
        }
    }

    /// Workflow input 里的取值；建立链为 `None`，保持原 input 形状。
    fn input_field(self) -> Option<Self> {
        (self != Self::Provision).then_some(self)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipTarget {
    scope: String,
    membership_id: String,
    membership_version: i32,
    subject_principal_id: String,
    relation_object_id: String,
    /// 只有 Tenant 撤权才有：此人在本 Tenant 仍在 REVOKING 的 WorkspaceMembership，
    /// 由同一条撤权链逐个撤 Channel roster 并推进到 REVOKED（`.design/10` §5）。
    /// 为空时不写出，其余 input 的形状与已录制 history 逐字相同。
    #[serde(skip_serializing_if = "Vec::is_empty")]
    workspace_memberships: Vec<WorkspaceMembershipRef>,
}

/// Tenant 撤权连带收敛的一个 WorkspaceMembership。版本是启动时读到的那个：
/// 跃迁以它做乐观并发，中途被别的动作改过即冲突，不覆盖。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMembershipRef {
    membership_id: String,
    membership_version: i32,
    workspace_id: String,
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
    start_membership(&state, &req).await
}

/// service API 形态的外壳：把启动结论写成 HTTP 回应，并记为该 ActionExecution
/// 的派发结果。治理派发、部署引导与重跑直接调 `launch_membership`，由它们各自记录。
pub(crate) async fn start_membership(state: &ServiceState, req: &LifecycleRequest) -> Response {
    let response = match launch_membership(&state.pool, &state.temporal, req).await {
        Ok(r) => (StatusCode::OK, Json(r)).into_response(),
        Err(r) => r,
    };
    let class = AuditClass::core(match req.scope {
        MembershipScope::Tenant => "TENANT_MEMBERSHIP",
        MembershipScope::Workspace => "WORKSPACE_MEMBERSHIP",
    });
    record_direct_launch(&state.pool, req.action_execution_id, class, response).await
}

/// 成员生命周期的启动核心。handler、治理派发、部署引导与重跑入口（`task_rerun`）
/// 共用它：重跑不另写一份「按状态选 kind、核准入、落 WorkflowRef、Start」，两份
/// 迟早分叉。
pub(crate) async fn launch_membership(
    pool: &PgPool,
    temporal: &TemporalClient,
    req: &LifecycleRequest,
) -> Result<LifecycleResponse, Response> {
    let (tenant_id, principal_id, object_id, version, membership_state) =
        match load(pool, req).await {
            Ok(v) => v,
            Err(Some(r)) => return Err(r),
            Err(None) => return Err(StatusCode::SERVICE_UNAVAILABLE.into_response()),
        };

    // 状态决定 kind，不由调用方指定：让调用方选 kind 就等于让它决定这是建立
    // 还是撤权，而那件事已经由 Core 的 fail-closed 状态表达过一次了。
    let kind = match membership_state.as_str() {
        "PROVISIONING" => "MEMBERSHIP_PROJECTION",
        "REVOKING" => "MEMBERSHIP_REVOCATION",
        other => {
            tracing::warn!(state = other, "成员状态不在可启动生命周期的两个状态上");
            return Err(StatusCode::CONFLICT.into_response());
        }
    };

    // 准入依据：ActionExecution 必须已存在、已 ALLOWED、且与该成员同 Tenant。
    match sqlx::query!(
        "select 1 as ok from admission.action_execution
         where id = $1 and tenant_id = $2 and gate_state = 'ALLOWED'",
        req.action_execution_id,
        tenant_id
    )
    .fetch_optional(pool)
    .await
    {
        Ok(Some(_)) => {}
        Ok(None) => {
            tracing::warn!(action = %req.action_execution_id, "ActionExecution 不存在或未准入");
            return Err(StatusCode::FORBIDDEN.into_response());
        }
        Err(e) => return Err(unavailable(e)),
    }

    // Tenant 撤权连带的 WorkspaceMembership 在启动时冻结进 input：governance 在
    // Tenant 成员进入 REVOKING 的同一事务里已把它们置为 REVOKING。重跑时重新读取，
    // 上一轮已推进到 REVOKED 的不再出现。
    let workspace_memberships =
        if kind == "MEMBERSHIP_REVOCATION" && req.scope == MembershipScope::Tenant {
            match revoking_workspace_memberships(pool, tenant_id, principal_id).await {
                Ok(v) => v,
                Err(e) => return Err(unavailable(e)),
            }
        } else {
            Vec::new()
        };

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
                workspace_memberships,
            },
        },
    };

    match component_task::start(
        pool,
        temporal,
        &workflow_id,
        tenant_id,
        req.action_execution_id,
        &input,
    )
    .await
    {
        Ok(run_id) => Ok(LifecycleResponse {
            workflow_id,
            kind: kind.to_owned(),
            run_id,
        }),
        Err(r) => Err(r),
    }
}

type Loaded = (Uuid, Uuid, Uuid, i32, String);

/// 此人在该 Tenant 下处于 REVOKING 的全部 WorkspaceMembership。
async fn revoking_workspace_memberships(
    pool: &PgPool,
    tenant_id: Uuid,
    principal_id: Uuid,
) -> Result<Vec<WorkspaceMembershipRef>, sqlx::Error> {
    let rows: Vec<(Uuid, i32, Uuid)> = sqlx::query_as(
        "select wm.id, wm.version, wm.workspace_id
         from identity.workspace_membership wm
         join identity.workspace w on w.id = wm.workspace_id
         where w.tenant_id = $1 and wm.tenant_principal_id = $2 and wm.state = 'REVOKING'
         order by wm.id",
    )
    .bind(tenant_id)
    .bind(principal_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, version, ws)| WorkspaceMembershipRef {
            membership_id: id.to_string(),
            membership_version: version,
            workspace_id: ws.to_string(),
        })
        .collect())
}

/// `Err(Some(resp))` 是确定的拒绝，`Err(None)` 是依赖不可用。
async fn load(pool: &PgPool, req: &LifecycleRequest) -> Result<Loaded, Option<Response>> {
    match req.scope {
        MembershipScope::Tenant => {
            let row = sqlx::query!(
                "select tenant_id, tenant_principal_id, version, state
                 from identity.tenant_membership where id = $1",
                req.membership_id
            )
            .fetch_optional(pool)
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
            .fetch_optional(pool)
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
    /// 缺省为建立链：既有调用方的请求体不变。
    #[serde(default)]
    pub operation: ScopeOperation,
}

/// 启动 `TENANT_LIFECYCLE` 或 `WORKSPACE_LIFECYCLE`。
///
/// 与成员那条同形：实体的收敛中状态必须与请求的段一致（建立 `PROVISIONING`、
/// 暂停 `SUSPENDING`、恢复 `RESTORING`），ActionExecution 提供准入依据，
/// WorkflowRef 先于 Start 落库。
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
    start_scope(&state, &req).await
}

/// service API 形态的外壳：把启动结论写成 HTTP 回应，并记为该 ActionExecution
/// 的派发结果（同 `start_membership`）。
pub(crate) async fn start_scope(state: &ServiceState, req: &ScopeLifecycleRequest) -> Response {
    let response = match launch_scope(&state.pool, &state.temporal, req).await {
        Ok(r) => (StatusCode::OK, Json(r)).into_response(),
        Err(r) => r,
    };
    let class = AuditClass::core(match req.kind {
        crate::scope_state::ScopeKind::Tenant => "TENANT",
        crate::scope_state::ScopeKind::Workspace => "WORKSPACE",
    });
    record_direct_launch(&state.pool, req.action_execution_id, class, response).await
}

/// scope 生命周期的启动核心，与 `launch_membership` 同理由供治理派发、部署引导与
/// 重跑入口共用。
pub(crate) async fn launch_scope(
    pool: &PgPool,
    temporal: &TemporalClient,
    req: &ScopeLifecycleRequest,
) -> Result<LifecycleResponse, Response> {
    let (kind, tenant_id, version, scope_state) = match req.kind {
        crate::scope_state::ScopeKind::Tenant => {
            match sqlx::query!(
                "select version, state from identity.tenant where id = $1",
                req.id
            )
            .fetch_optional(pool)
            .await
            {
                Ok(Some(r)) => ("TENANT_LIFECYCLE", req.id, r.version, r.state),
                Ok(None) => return Err(StatusCode::NOT_FOUND.into_response()),
                Err(e) => return Err(unavailable(e)),
            }
        }
        crate::scope_state::ScopeKind::Workspace => {
            match sqlx::query!(
                "select tenant_id, version, state from identity.workspace where id = $1",
                req.id
            )
            .fetch_optional(pool)
            .await
            {
                Ok(Some(r)) => ("WORKSPACE_LIFECYCLE", r.tenant_id, r.version, r.state),
                Ok(None) => return Err(StatusCode::NOT_FOUND.into_response()),
                Err(e) => return Err(unavailable(e)),
            }
        }
    };

    // 调用方声明的段与实体此刻的收敛中状态必须一致：不按当前状态猜，猜错就是
    // 对一个运行中的 scope 执行建立。Tenant 与 Workspace 都有暂停与恢复两段
    // （DD-96、`.design/06` §7.2 §7.3）。
    if scope_state != req.operation.converging_state() {
        tracing::warn!(state = %scope_state, operation = ?req.operation, "scope 不在该段的收敛中状态，不启动");
        return Err(StatusCode::CONFLICT.into_response());
    }

    match sqlx::query!(
        "select 1 as ok from admission.action_execution
         where id = $1 and tenant_id = $2 and gate_state = 'ALLOWED'",
        req.action_execution_id,
        tenant_id
    )
    .fetch_optional(pool)
    .await
    {
        Ok(Some(_)) => {}
        Ok(None) => return Err(StatusCode::FORBIDDEN.into_response()),
        Err(e) => return Err(unavailable(e)),
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
                operation: req.operation.input_field(),
            },
        },
    };

    match component_task::start(
        pool,
        temporal,
        &workflow_id,
        tenant_id,
        req.action_execution_id,
        &input,
    )
    .await
    {
        Ok(run_id) => Ok(LifecycleResponse {
            workflow_id,
            kind: kind.to_owned(),
            run_id,
        }),
        Err(r) => Err(r),
    }
}

#[cfg(test)]
mod tests {
    use super::{ScopeEnvelope, ScopeOperation, ScopeTarget};
    use crate::component_task::ComponentTaskInput;

    fn input(operation: ScopeOperation) -> serde_json::Value {
        serde_json::to_value(ComponentTaskInput {
            kind: "WORKSPACE_LIFECYCLE".to_owned(),
            target: ScopeEnvelope {
                scope: ScopeTarget {
                    id: "w".to_owned(),
                    version: 3,
                    tenant_id: Some("t".to_owned()),
                    operation: operation.input_field(),
                },
            },
        })
        .unwrap()
    }

    #[test]
    fn provision_input_keeps_recorded_shape() {
        assert_eq!(
            input(ScopeOperation::Provision),
            serde_json::json!({
                "kind": "WORKSPACE_LIFECYCLE",
                "scope": { "id": "w", "version": 3, "tenantId": "t" }
            }),
            "建立链的 input 必须与已录制 history 逐字相同"
        );
    }

    #[test]
    fn suspend_and_restore_name_their_segment() {
        assert_eq!(
            input(ScopeOperation::Suspend)["scope"]["operation"],
            "SUSPEND"
        );
        assert_eq!(
            input(ScopeOperation::Restore)["scope"]["operation"],
            "RESTORE"
        );
        assert_eq!(ScopeOperation::Suspend.converging_state(), "SUSPENDING");
        assert_eq!(ScopeOperation::Restore.converging_state(), "RESTORING");
    }

    #[test]
    fn service_request_without_operation_is_provision() {
        let req: super::ScopeLifecycleRequest = serde_json::from_value(serde_json::json!({
            "kind": "WORKSPACE",
            "id": "00000000-0000-0000-0000-000000000001",
            "actionExecutionId": "00000000-0000-0000-0000-000000000002"
        }))
        .unwrap();
        assert_eq!(req.operation, ScopeOperation::Provision);
    }
}
