//! `ComponentTaskWorkflow` 的唯一启动路径（`.design/06` §3.1、`DD-48`）。
//!
//! 每个 kind 的启动都是同一个三步：Start 之前持久化唯一 `WorkflowRef`、以固定
//! workflow ID 至多一次启动、回填 run ID。这三步写在一处，任何 kind 都不另写
//! 一份——两份实现迟早在「结果不明时换不换 ID」这类细节上分叉。
//!
//! 本模块**不做准入判定**。调用方必须先持有一条已持久化、`gate_state=ALLOWED`
//! 且与目标同 Tenant 的 ActionExecution；WorkflowRef 通过它取得 operation。

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::temporal::{Started, TemporalClient, TemporalError};

/// Worker 注册的 Workflow 类型名。两侧必须逐字相同，否则 Start 成功但没有
/// 任何 Worker 认领，表现为「启动了却永远不动」。
pub const WORKFLOW_TYPE: &str = "ComponentTaskWorkflow";

/// Workflow 的冻结输入。字段名必须与 Go 侧的 `ComponentTaskInput` 一致——
/// 两侧共用 JSON payload，名字对不上时 Workflow 收到的是零值而不是错误。
#[derive(Debug, Serialize)]
pub struct ComponentTaskInput<T> {
    pub kind: String,
    #[serde(flatten)]
    pub target: T,
}

/// 固定 workflow ID：`kailo:<kind>:<tenant_id>:<primary_entity_id>:<entity_version>`。
/// 同一事实的同一版本永远映射到同一个 ID，结果不明时只能用它收敛（DD-48）。
pub fn workflow_id(kind: &str, tenant_id: Uuid, entity: &str, version: i32) -> String {
    format!("kailo:{kind}:{tenant_id}:{entity}:{version}")
}

/// 启动一条 ComponentTaskWorkflow。
///
/// `Ok(Some(run_id))` 是本次创建了 execution；`Ok(None)` 是同一 ID 的 execution
/// 已存在——那恰好证明目标状态成立，不是失败。`Err` 已映射为 HTTP 响应：
/// 被拒是确定的冲突，其余是结果不明，调用方只能用同一 ID 收敛，不换 ID 重试。
pub async fn start<T: Serialize>(
    pool: &PgPool,
    temporal: &TemporalClient,
    workflow_id: &str,
    tenant_id: Uuid,
    action_execution_id: Uuid,
    input: &ComponentTaskInput<T>,
) -> Result<Option<String>, Response> {
    // Start 之前先落 WorkflowRef。ON CONFLICT DO NOTHING 让重复调用收敛到同一
    // 行而不是失败——重复调用与崩溃重试是同一件事。action_execution_id 上的
    // 唯一约束保证一个 ActionExecution 至多一个业务 Workflow。
    if let Err(e) = sqlx::query!(
        "insert into projection.workflow_ref
             (workflow_id, workflow_type, workflow_version, kind, tenant_id,
              operation_id, action_execution_id, projection_state)
         select $1, $2, 1, $3, $4, ae.operation_id, ae.id, 'PENDING_START'
         from admission.action_execution ae where ae.id = $5
         on conflict (workflow_id) do nothing",
        workflow_id,
        WORKFLOW_TYPE,
        input.kind,
        tenant_id,
        action_execution_id,
    )
    .execute(pool)
    .await
    {
        tracing::warn!(error = %e, workflow_id, "持久化 WorkflowRef 失败");
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }

    // 同一版本的 execution 已经终结：再 Start 只会撞上 REJECT_DUPLICATE，
    // Server 答「已存在」，而调用方会把它读成「已启动」——实际什么也没在跑。
    // 终结的结果已在 TaskProjection 里；要重做就是新的事实版本与新的 ID。
    match sqlx::query_scalar!(
        "select projection_state from projection.workflow_ref where workflow_id = $1",
        workflow_id
    )
    .fetch_one(pool)
    .await
    {
        Ok(state) if state == "TERMINAL" => return Err(StatusCode::CONFLICT.into_response()),
        Ok(_) => {}
        Err(e) => {
            tracing::warn!(error = %e, workflow_id, "读取 WorkflowRef 失败");
            return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
        }
    }

    let tenant = tenant_id.to_string();
    let attributes = [
        (crate::temporal::SA_TENANT, tenant.as_str()),
        (crate::temporal::SA_KIND, input.kind.as_str()),
    ];
    match temporal
        .start(workflow_id, WORKFLOW_TYPE, input, &attributes)
        .await
    {
        Ok(Started::Created { run_id }) => {
            mark_running(pool, workflow_id, Some(&run_id)).await;
            Ok(Some(run_id))
        }
        // run ID 只从 observation 回填，这里不编一个（`.design/03` §6）。
        Ok(Started::AlreadyStarted) => {
            mark_running(pool, workflow_id, None).await;
            Ok(None)
        }
        Err(e @ TemporalError::Rejected(_)) => {
            tracing::warn!(error = %e, "Start 被拒绝");
            Err(StatusCode::CONFLICT.into_response())
        }
        // 结果不明：WorkflowRef 停在 PENDING_START，调用方只能用同一 ID 收敛，
        // 不换 ID 重试（DD-48）。
        Err(e) => {
            tracing::warn!(error = %e, workflow_id, "Start 结果不明");
            Err(StatusCode::SERVICE_UNAVAILABLE.into_response())
        }
    }
}

/// 回填 run ID 并把投影状态推进到 RUNNING。
///
/// 失败只记日志：execution 已经起来了，这里再报错会让调用方以为没启动而重试，
/// 那比投影落后更糟。兜底由 `workflow_reconcile` 的对账作业承担（06 §3.1）。
async fn mark_running(pool: &PgPool, workflow_id: &str, run_id: Option<&str>) {
    if let Err(e) = sqlx::query!(
        "update projection.workflow_ref
         set run_id = coalesce($2, run_id), projection_state = 'RUNNING', version = version + 1
         where workflow_id = $1 and projection_state = 'PENDING_START'",
        workflow_id,
        run_id,
    )
    .execute(pool)
    .await
    {
        tracing::warn!(error = %e, workflow_id, "回填 run ID 失败，留给对账作业");
    }
}

/// 一条已准入 ActionExecution 中，受治理的启动入口（重跑、托管身份的撤销与
/// 重建）需要带进 WorkflowRef 与审计的字段。
pub(crate) struct AllowedAction {
    pub operation_id: Uuid,
    pub action_key: String,
    pub action_version: i32,
    pub initiator_principal_id: Uuid,
    pub actor_principal_id: Uuid,
    pub parameter_hash: String,
    pub correlation_id: Uuid,
}

/// 准入依据：ActionExecution 已 `ALLOWED`、与目标同 Tenant、`target_id` 就是该
/// 目标。target 不核，就能拿一张为别的对象签发的准入来驱动这一个。
pub(crate) async fn allowed_action(
    pool: &PgPool,
    action_execution_id: Uuid,
    tenant_id: Uuid,
    target_id: Uuid,
) -> Result<Option<AllowedAction>, sqlx::Error> {
    sqlx::query_as!(
        AllowedAction,
        "select operation_id, action_key, action_version, initiator_principal_id,
                actor_principal_id, parameter_hash, correlation_id
         from admission.action_execution
         where id = $1 and tenant_id = $2 and target_id = $3 and gate_state = 'ALLOWED'",
        action_execution_id,
        tenant_id,
        target_id
    )
    .fetch_optional(pool)
    .await
}

/// 该 ActionExecution 已驱动的 Workflow。一条 ActionExecution 至多驱动一个
/// （`workflow_ref.action_execution_id` 唯一），因此它就是这些入口的幂等键：
/// 已有即以同一 ID 收敛，不再推进任何实体版本。
pub(crate) async fn workflow_of_action(
    pool: &PgPool,
    action_execution_id: Uuid,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar!(
        "select workflow_id from projection.workflow_ref where action_execution_id = $1",
        action_execution_id
    )
    .fetch_optional(pool)
    .await
}

/// 在调用方的事务里预写 WorkflowRef。与实体状态/版本的推进同事务：提交之后
/// 崩溃，同一 ActionExecution 的重试经 `workflow_of_action` 找回它；`start`
/// 随后的 `ON CONFLICT DO NOTHING` 收敛到同一行。
pub(crate) async fn prewrite(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    workflow_id: &str,
    kind: &str,
    tenant_id: Uuid,
    operation_id: Uuid,
    action_execution_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "insert into projection.workflow_ref
             (workflow_id, workflow_type, workflow_version, kind, tenant_id,
              operation_id, action_execution_id, projection_state)
         values ($1, $2, 1, $3, $4, $5, $6, 'PENDING_START')",
        workflow_id,
        WORKFLOW_TYPE,
        kind,
        tenant_id,
        operation_id,
        action_execution_id,
    )
    .execute(&mut **tx)
    .await
    .map(|_| ())
}
