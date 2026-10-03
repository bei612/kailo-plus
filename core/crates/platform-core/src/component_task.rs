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

use crate::temporal::{Observed, ObservedState, Started, TemporalClient, TemporalError};

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

/// 固定 workflow ID 的前缀段。它是协议常量，不随部署显示名变化（`.design/06` §3.1、DD-111）。
pub const WORKFLOW_ID_PREFIX: &str = "platform";
/// ADR-17 一次性迁移窗口内仍按原 ID 对账的旧前缀：只解析、不再用于新 Start。
/// 窗口在旧前缀 WorkflowRef 全部终态且超过 namespace retention、按旧名 Search
/// Attribute 查询无结果时关闭，届时删除本常量与 [`split_workflow_id`] 里的旧分支。
const LEGACY_WORKFLOW_ID_PREFIX: &str = "kailo";

/// 固定 workflow ID：`platform:<kind>:<tenant_id>:<primary_entity_id>:<entity_version>`。
/// 同一事实的同一版本永远映射到同一个 ID，结果不明时只能用它收敛（DD-48）。
pub fn workflow_id(kind: &str, tenant_id: Uuid, entity: &str, version: i32) -> String {
    format!("{WORKFLOW_ID_PREFIX}:{kind}:{tenant_id}:{entity}:{version}")
}

/// 按固定格式拆出 `(kind, tenant_id, primary_entity_id, entity_version)` 四段原文。
///
/// 前缀只接受 [`WORKFLOW_ID_PREFIX`] 与迁移窗口内的旧前缀；段数不是五或前缀不认识时
/// 返回 `None`——调用方据此拒绝按它推断任何事，而不是猜。
pub fn split_workflow_id(id: &str) -> Option<[&str; 4]> {
    let parts: Vec<&str> = id.split(':').collect();
    match parts.as_slice() {
        [prefix, kind, tenant, entity, version]
            if *prefix == WORKFLOW_ID_PREFIX || *prefix == LEGACY_WORKFLOW_ID_PREFIX =>
        {
            Some([kind, tenant, entity, version])
        }
        _ => None,
    }
}

/// 启动一条 ComponentTaskWorkflow。
///
/// `Ok(Some(run_id))` 表示 Temporal 确认了本次创建或同 ID 的既有 execution；
/// `Ok(None)` 表示 Describe 已观察到既有 execution，终态由对账投影。`Err` 已映射为 HTTP 响应：
/// 被拒是确定的冲突，其余是结果不明，调用方只能用同一 ID 收敛，不换 ID 重试。
pub async fn start<T: Serialize>(
    pool: &PgPool,
    temporal: &TemporalClient,
    workflow_id: &str,
    tenant_id: Uuid,
    action_execution_id: Uuid,
    input: &ComponentTaskInput<T>,
) -> Result<Option<String>, Response> {
    start_typed(
        pool,
        temporal,
        Launch {
            workflow_id,
            workflow_type: WORKFLOW_TYPE,
            kind: Some(&input.kind),
            tenant_id,
            action_execution_id,
        },
        input,
    )
    .await
}

/// 一次启动的固定事实：哪个 ID、哪种 Workflow、哪个 kind、归属哪个 Tenant 与
/// 哪条 ActionExecution。ApprovalWorkflow 没有 kind（它不是 ComponentTaskWorkflow
/// 的一种），因此 kind 可空。
pub(crate) struct Launch<'a> {
    pub workflow_id: &'a str,
    pub workflow_type: &'a str,
    pub kind: Option<&'a str>,
    pub tenant_id: Uuid,
    pub action_execution_id: Uuid,
}

// Start 前落引用；同 ID 重试不改既有行，one_per_type 仍约束业务 Workflow 唯一性。
async fn persist_start_reference(pool: &PgPool, launch: &Launch<'_>) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "insert into projection.workflow_ref
             (workflow_id, workflow_type, workflow_version, kind, tenant_id,
              operation_id, action_execution_id, workspace_id, projection_state)
         select $1, $2, 1, $3, $4, ae.operation_id, ae.id, ae.workspace_id, 'PENDING_START'
         from admission.action_execution ae where ae.id = $5
         on conflict (workflow_id) do nothing",
        launch.workflow_id,
        launch.workflow_type,
        launch.kind,
        launch.tenant_id,
        launch.action_execution_id,
    )
    .execute(pool)
    .await
    .map(|_| ())
}

/// 任一类型 Workflow 的唯一启动路径：先落 WorkflowRef、以固定 ID 至多一次启动、
/// 回填 run ID。`start` 与 ApprovalWorkflow 的启动共用它，「结果不明时换不换 ID」
/// 这类细节因此只有一份实现。
pub(crate) async fn start_typed(
    pool: &PgPool,
    temporal: &TemporalClient,
    launch: Launch<'_>,
    input: &impl Serialize,
) -> Result<Option<String>, Response> {
    // Keep the pre-Start write independently verifiable without issuing Start.
    if let Err(e) = persist_start_reference(pool, &launch).await {
        tracing::warn!(error = %e, workflow_id=launch.workflow_id, "持久化 WorkflowRef 失败");
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    let Launch {
        workflow_id,
        workflow_type,
        kind,
        tenant_id,
        action_execution_id,
    } = launch;
    // 预写引用在重试时仍是同一行。不能仅凭同 ID 就接受另一条动作的引用；
    // 更不能对 UNKNOWN 直接再 Start：history 过 retention 后已没有去重证据。
    let reference: (String, Option<String>, String, Option<String>, Uuid, Uuid) =
        match sqlx::query_as(
            "select projection_state, run_id, workflow_type, kind, tenant_id, action_execution_id
             from projection.workflow_ref where workflow_id = $1",
        )
        .bind(workflow_id)
        .fetch_one(pool)
        .await
        {
            Ok(reference) => reference,
            Err(e) => {
                tracing::warn!(error = %e, workflow_id, "读取 WorkflowRef 失败");
                return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
            }
        };
    let (state, run_id, stored_type, stored_kind, stored_tenant, stored_action) = reference;
    if stored_type != workflow_type
        || stored_kind.as_deref() != kind
        || stored_tenant != tenant_id
        || stored_action != action_execution_id
    {
        tracing::error!(workflow_id, "WorkflowRef 与本次动作的冻结身份不一致");
        return Err(StatusCode::CONFLICT.into_response());
    }
    if state == "TERMINAL" {
        return Err(StatusCode::CONFLICT.into_response());
    }
    if !matches!(state.as_str(), "PENDING_START" | "RUNNING" | "UNKNOWN") {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }

    // 重试先向 history 权威核实。已观察到的 execution 无论 OPEN/CLOSED 都不能
    // 再 Start；CLOSED 的终态由 workflow_reconcile 修补，不在启动面伪造。
    match temporal.describe(workflow_id).await {
        Ok(Some(observed)) => return observed_existing(pool, workflow_id, observed).await,
        Ok(None) => {}
        Err(e) => {
            tracing::warn!(error = %e, workflow_id, "Describe 结果不明，禁止重新 Start");
            return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
        }
    }

    // RUNNING 或已有 run ID 是此前观察到 execution 的持久证据；NotFound 不能
    // 推翻它。其余引用也只在 retention 内、且没有任何投影证明执行发生过时重试。
    if state == "RUNNING" || run_id.is_some() {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    let retention = match temporal.retention().await {
        Ok(retention) => i64::try_from(retention.as_secs()).unwrap_or(i64::MAX),
        Err(e) => {
            tracing::warn!(error = %e, workflow_id, "无法确认 Temporal retention");
            return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
        }
    };
    let safe_to_start: bool = match sqlx::query_scalar(
        "select w.created_at > now() - make_interval(secs => $2::bigint)
                and not exists(select 1 from projection.task_projection t
                               where t.workflow_id = w.workflow_id)
                and not exists(select 1 from projection.approval_projection a
                               where a.workflow_id = w.workflow_id)
         from projection.workflow_ref w where w.workflow_id = $1
           and w.projection_state in ('PENDING_START', 'UNKNOWN') and w.run_id is null",
    )
    .bind(workflow_id)
    .bind(retention)
    .fetch_optional(pool)
    .await
    {
        Ok(Some(safe)) => safe,
        Ok(None) => false,
        Err(e) => {
            tracing::warn!(error = %e, workflow_id, "核对 WorkflowRef retention 失败");
            return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
        }
    };
    if !safe_to_start {
        tracing::warn!(workflow_id, "Workflow 旧执行无法排除，禁止重新 Start");
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }

    let tenant = tenant_id.to_string();
    // kind 只有 ComponentTaskWorkflow 才有；没有的不写（ADR-08 的 Search Attribute 约定）
    let mut attributes = vec![(crate::temporal::SA_TENANT, tenant.as_str())];
    if let Some(kind) = kind {
        attributes.push((crate::temporal::SA_KIND, kind));
    }
    match temporal
        .start(workflow_id, workflow_type, input, &attributes)
        .await
    {
        Ok(Started::Created { run_id }) => {
            mark_running(pool, workflow_id, &run_id).await;
            Ok(Some(run_id))
        }
        // Temporal 的已存在错误携带原 execution 的 run ID；不以一次额外 Describe
        // 的时序竞争覆盖这条已确认事实。终态由 workflow_reconcile 对账。
        Ok(Started::AlreadyStarted { run_id }) => {
            mark_running(pool, workflow_id, &run_id).await;
            Ok(Some(run_id))
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

async fn observed_existing(
    pool: &PgPool,
    workflow_id: &str,
    observed: Observed,
) -> Result<Option<String>, Response> {
    if observed.run_id.is_empty() {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    match observed.state {
        ObservedState::Open => {
            mark_running(pool, workflow_id, &observed.run_id).await;
            Ok(None)
        }
        ObservedState::Closed(_) => Ok(None),
        ObservedState::Unrecognized(code) => {
            tracing::warn!(workflow_id, code, "Temporal 执行状态不可识别");
            Err(StatusCode::SERVICE_UNAVAILABLE.into_response())
        }
    }
}

/// 回填 run ID 并把投影状态推进到 RUNNING。
///
/// 失败只记日志：execution 已经起来了，这里再报错会让调用方以为没启动而重试，
/// 那比投影落后更糟。兜底由 `workflow_reconcile` 的对账作业承担（06 §3.1）。
async fn mark_running(pool: &PgPool, workflow_id: &str, run_id: &str) {
    if let Err(e) = sqlx::query(
        "update projection.workflow_ref
         set run_id = coalesce(run_id, $2), projection_state = 'RUNNING', version = version + 1
         where workflow_id = $1
           and (projection_state in ('PENDING_START', 'UNKNOWN')
                or (projection_state = 'RUNNING' and run_id is null))
           and (run_id is null or run_id = $2)",
    )
    .bind(workflow_id)
    .bind(run_id)
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

/// 该 ActionExecution 已驱动的业务 Workflow。一条 ActionExecution 至多驱动一个
/// ComponentTaskWorkflow（`workflow_ref` 按 action_execution_id 与类型唯一；另一个
/// 可能的是它的 ApprovalWorkflow），因此它就是这些入口的幂等键：
/// 已有即以同一 ID 收敛，不再推进任何实体版本。
pub(crate) async fn workflow_of_action(
    pool: &PgPool,
    action_execution_id: Uuid,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar!(
        "select workflow_id from projection.workflow_ref
         where action_execution_id = $1 and workflow_type = $2",
        action_execution_id,
        WORKFLOW_TYPE
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
              operation_id, action_execution_id, workspace_id, projection_state)
         values ($1, $2, 1, $3, $4, $5, $6,
                 (select workspace_id from admission.action_execution where id=$6), 'PENDING_START')",
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

/// Repair only missing scope on the original business WorkflowRef. The frozen
/// ActionExecution, registered definition and same-Tenant Workspace prove the
/// value; history/run/state are not rewritten and a conflicting value is never
/// replaced. Tenant-scope and cross-Tenant lifecycle references are untouched.
pub(crate) async fn reconcile_workspace(
    pool: &PgPool,
    workflow_id: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    // Action scope is immutable after admission. Lock only its projection:
    // dispatch may already hold AE while awaiting a pooled WorkflowRef write.
    let reference: Option<(Option<Uuid>, Uuid)> = sqlx::query_as(
        "select w.workspace_id,ae.workspace_id
         from projection.workflow_ref w
         join admission.action_execution ae on ae.id=w.action_execution_id
           and ae.tenant_id=w.tenant_id and ae.operation_id=w.operation_id
           and ae.temporal_workflow_id=w.workflow_id
         join catalog.action_definition d on d.action_key=ae.action_key
           and d.version=ae.action_version and d.execution_mode='TEMPORAL'
           and d.workflow_type=w.workflow_type and d.workflow_kind is not distinct from w.kind
         join identity.workspace s on s.id=ae.workspace_id and s.tenant_id=ae.tenant_id
         where w.workflow_id=$1
           and w.workflow_type in ('ComponentTaskWorkflow','AgentTaskWorkflow')
         for update of w",
    )
    .bind(workflow_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((stored, frozen)) = reference else {
        return Ok(false);
    };
    if stored == Some(frozen) {
        return Ok(false);
    }
    if stored.is_some() {
        return Err(sqlx::Error::Protocol(
            "WorkflowRef Workspace 与冻结 ActionExecution 冲突".into(),
        ));
    }
    let changed = sqlx::query(
        "update projection.workflow_ref set workspace_id=$2,version=version+1
         where workflow_id=$1 and workspace_id is null",
    )
    .bind(workflow_id)
    .bind(frozen)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(changed.rows_affected() == 1)
}

#[cfg(test)]
mod scope_tests {
    use super::*;

    /// Uses a disposable migrated database only; no Temporal or production fixture.
    #[tokio::test]
    #[ignore = "requires WORKFLOW_SCOPE_TEST_DATABASE_URL pointing at a disposable migrated database"]
    async fn workflow_workspace_projection_preserves_frozen_identity_and_state() {
        let url = std::env::var("WORKFLOW_SCOPE_TEST_DATABASE_URL").unwrap();
        let pool = PgPool::connect(&url).await.unwrap();
        let tenant = Uuid::new_v4();
        let workspace = Uuid::new_v4();
        let conflicting = Uuid::new_v4();
        let principal = Uuid::new_v4();
        let action = Uuid::new_v4();
        let operation = Uuid::new_v4();
        let workflow = workflow_id("AGENT_INSTALLATION", tenant, &action.to_string(), 1);
        sqlx::query("insert into identity.tenant(id,slug,name,state) values($1,$1::text,'scope verification','ACTIVE')")
            .bind(tenant).execute(&pool).await.unwrap();
        for id in [workspace, conflicting] {
            sqlx::query("insert into identity.workspace(id,tenant_id,slug,name,state) values($1,$2,$1::text,'scope verification','ACTIVE')")
                .bind(id).bind(tenant).execute(&pool).await.unwrap();
        }
        sqlx::query("insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'HUMAN','ACTIVE')")
            .bind(principal).bind(tenant).execute(&pool).await.unwrap();
        sqlx::query("insert into admission.action_execution
            (id,operation_id,tenant_id,workspace_id,action_key,action_version,
             initiator_principal_id,actor_principal_id,target_id,parameter_hash,
             temporal_workflow_id,gate_state,dispatch_state,correlation_id)
            values($1,$2,$3,$4,'agent.installation.create',1,$5,$5,$1,$6,$7,'ALLOWED','DISPATCHED',$1)")
            .bind(action).bind(operation).bind(tenant).bind(workspace).bind(principal)
            .bind("0".repeat(64)).bind(&workflow).execute(&pool).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        prewrite(
            &mut tx,
            &workflow,
            "AGENT_INSTALLATION",
            tenant,
            operation,
            action,
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        let scope: Option<Uuid> = sqlx::query_scalar(
            "select workspace_id from projection.workflow_ref where workflow_id=$1",
        )
        .bind(&workflow)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            scope,
            Some(workspace),
            "the original writer must project frozen scope"
        );
        sqlx::query("delete from projection.workflow_ref where workflow_id=$1")
            .bind(&workflow)
            .execute(&pool)
            .await
            .unwrap();
        let launch = Launch {
            workflow_id: &workflow,
            workflow_type: WORKFLOW_TYPE,
            kind: Some("AGENT_INSTALLATION"),
            tenant_id: tenant,
            action_execution_id: action,
        };
        persist_start_reference(&pool, &launch).await.unwrap();
        persist_start_reference(&pool, &launch).await.unwrap();
        let started: (Option<Uuid>, i32) = sqlx::query_as(
            "select workspace_id,version from projection.workflow_ref where workflow_id=$1",
        )
        .bind(&workflow)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            started,
            (Some(workspace), 1),
            "Start writer projects scope exactly once"
        );

        // Reproduce the live missing projection, without changing its execution.
        sqlx::query("update projection.workflow_ref set workspace_id=null,run_id='existing-run',projection_state='RUNNING' where workflow_id=$1")
            .bind(&workflow).execute(&pool).await.unwrap();
        // Dispatch holds AE while another pooled request writes WorkflowRef.
        // Repair must not acquire that AE lock in the reverse order.
        let mut dispatch = pool.begin().await.unwrap();
        sqlx::query("select id from admission.action_execution where id=$1 for update")
            .bind(action)
            .fetch_one(&mut *dispatch)
            .await
            .unwrap();
        let repaired = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            reconcile_workspace(&pool, &workflow),
        )
        .await;
        dispatch.rollback().await.unwrap();
        assert!(repaired
            .expect("scope repair must not wait on dispatch AE lock")
            .unwrap());
        let restored: (Option<Uuid>, String, String, i32) = sqlx::query_as("select workspace_id,run_id,projection_state,version from projection.workflow_ref where workflow_id=$1")
            .bind(&workflow).fetch_one(&pool).await.unwrap();
        assert_eq!(
            restored,
            (Some(workspace), "existing-run".into(), "RUNNING".into(), 2)
        );
        assert!(!reconcile_workspace(&pool, &workflow).await.unwrap());
        let version: i32 =
            sqlx::query_scalar("select version from projection.workflow_ref where workflow_id=$1")
                .bind(&workflow)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            version, 2,
            "repeat repair does not manufacture another version"
        );

        sqlx::query("update projection.workflow_ref set workspace_id=$2 where workflow_id=$1")
            .bind(&workflow)
            .bind(conflicting)
            .execute(&pool)
            .await
            .unwrap();
        assert!(reconcile_workspace(&pool, &workflow).await.is_err());
        let scope: Option<Uuid> = sqlx::query_scalar(
            "select workspace_id from projection.workflow_ref where workflow_id=$1",
        )
        .bind(&workflow)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            scope,
            Some(conflicting),
            "never overwrite conflicting scope"
        );

        // A matching action ID alone cannot justify repairing another reference.
        for mutation in [
            "operation_id='00000000-0000-0000-0000-000000000000'",
            "kind='MEMBERSHIP_PROJECTION'",
            "workflow_type='AgentTaskWorkflow'",
        ] {
            sqlx::query(&format!("update projection.workflow_ref set workspace_id=null,{mutation} where workflow_id=$1"))
                .bind(&workflow).execute(&pool).await.unwrap();
            assert!(!reconcile_workspace(&pool, &workflow).await.unwrap());
            sqlx::query("update projection.workflow_ref set operation_id=$2,kind='AGENT_INSTALLATION',workflow_type='ComponentTaskWorkflow' where workflow_id=$1")
                .bind(&workflow).bind(operation).execute(&pool).await.unwrap();
        }
        sqlx::query("update admission.action_execution set temporal_workflow_id=null where id=$1")
            .bind(action)
            .execute(&pool)
            .await
            .unwrap();
        assert!(!reconcile_workspace(&pool, &workflow).await.unwrap());
        sqlx::query("update admission.action_execution set temporal_workflow_id=$2 where id=$1")
            .bind(action)
            .bind(&workflow)
            .execute(&pool)
            .await
            .unwrap();
        let other_tenant = Uuid::new_v4();
        sqlx::query("insert into identity.tenant(id,slug,name,state) values($1,$1::text,'scope verification','ACTIVE')")
            .bind(other_tenant).execute(&pool).await.unwrap();
        sqlx::query("update projection.workflow_ref set tenant_id=$2 where workflow_id=$1")
            .bind(&workflow)
            .bind(other_tenant)
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            !reconcile_workspace(&pool, &workflow).await.unwrap(),
            "cross-Tenant lifecycle references are not inferred"
        );
        sqlx::query("update projection.workflow_ref set tenant_id=$2 where workflow_id=$1")
            .bind(&workflow)
            .bind(tenant)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("update admission.action_execution set temporal_workflow_id=$2,workspace_id=null where id=$1")
            .bind(action).bind(&workflow).execute(&pool).await.unwrap();
        assert!(!reconcile_workspace(&pool, &workflow).await.unwrap());
    }
}
