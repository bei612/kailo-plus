//! DD-47/48/65、06 §6：AgentInvocation 持久意图与 Temporal 的实际消费端。
//! 不创建第二 Workflow 权威，不从未查证的 runtime/tool/usage 事实推断成功。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::{AgentTaskAdvanceRequest, AgentTaskAdvanceResult, TaskStatus};
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    agent_runtime::RuntimeRef,
    service_api::{authorize, unavailable, ServiceState},
};

pub(crate) const WORKFLOW_TYPE: &str = "AgentTaskWorkflow";

#[derive(FromRow)]
struct Invocation {
    id: Uuid,
    tenant_id: Uuid,
    workspace_id: Uuid,
    root_event_id: String,
    installation_resource_id: Uuid,
    agent_version_asset_id: Uuid,
    projection_generation: i64,
    action_execution_id: Uuid,
    workflow_id: String,
    runtime_thread_id: Option<String>,
    runtime_turn_id: Option<String>,
    native_status: Option<String>,
    status: String,
    cancel_pending: bool,
    observation_cursor: Option<String>,
}

const LOAD: &str = "select i.id,i.tenant_id,i.workspace_id,i.root_event_id,i.source_event_id,
    i.installation_resource_id,i.agent_version_asset_id,i.projection_generation,
    i.action_execution_id,i.workflow_id,s.runtime_thread_id,i.runtime_turn_id,
    i.native_status,i.status,i.cancel_pending,i.observation_cursor
    from catalog.agent_invocation i join catalog.agent_session s
      on s.workspace_id=i.workspace_id and s.root_event_id=i.root_event_id
      and s.installation_resource_id=i.installation_resource_id where i.id=$1";

pub(crate) async fn advance(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<AgentTaskAdvanceRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(response) = authorize(&state, &headers).await {
        return response;
    }
    let Ok(Json(input)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Ok(id) = Uuid::parse_str(&input.invocation_id) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if Uuid::parse_str(&input.run_id).is_err() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let mut invocation: Invocation = match sqlx::query_as(LOAD)
        .bind(id)
        .fetch_optional(&state.pool)
        .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(error) => return unavailable(error),
    };
    if invocation.installation_resource_id.to_string() != input.installation_id
        || invocation.agent_version_asset_id.to_string() != input.agent_version_asset_id
        || invocation.projection_generation != input.projection_generation
        || invocation.workflow_id != input.workflow_id
    {
        return StatusCode::CONFLICT.into_response();
    }
    let reference: Option<Option<String>> = match sqlx::query_scalar("select run_id from projection.workflow_ref where workflow_id=$1 and workflow_type=$2 and kind is null and tenant_id=$3 and action_execution_id=$4")
        .bind(&invocation.workflow_id).bind(WORKFLOW_TYPE).bind(invocation.tenant_id).bind(invocation.action_execution_id).fetch_optional(&state.pool).await {
        Ok(value) => value, Err(error) => return unavailable(error),
    };
    let Some(Some(reference_run)) = reference else {
        return result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT");
    };
    let observed = match state.temporal.describe(&invocation.workflow_id).await {
        Ok(Some(observed)) => observed,
        _ => return result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT"),
    };
    // Continue-as-new 可换当前 run，但不能让同 workflow ID 的另一执行链推进。
    if !matches!(observed.state, crate::temporal::ObservedState::Open)
        || observed.run_id != input.run_id
        || observed.first_run_id.is_empty()
        || (reference_run != observed.first_run_id && reference_run != observed.run_id)
    {
        return StatusCode::CONFLICT.into_response();
    }
    let Ok(attempt) = i32::try_from(input.attempt) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let holder = match state
        .capacity
        .acquire_or_renew(
            &state.pool,
            &state.temporal,
            id,
            &input.run_id,
            &input.activity_id,
            attempt,
        )
        .await
    {
        Ok(holder) => holder,
        Err(crate::capacity::CapacityError::Rejected) => {
            return StatusCode::CONFLICT.into_response()
        }
        Err(crate::capacity::CapacityError::Exhausted) => {
            return result(id, TaskStatus::Running, "CAPACITY_UNAVAILABLE")
        }
        Err(error) => {
            tracing::warn!(invocation_id=%id, error=%error, "Capacity holder 不可查证");
            return result(id, TaskStatus::Running, "CAPACITY_UNAVAILABLE");
        }
    };
    tracing::debug!(invocation_id=%id, lease_id=%holder.lease_id, "原生 Activity holder 已查证");
    match invocation.status.as_str() {
        "COMPLETED" | "FAILED" | "CANCELED" if !holder.released => {
            return release_holder(&state, id, false).await;
        }
        "COMPLETED" => return result(id, TaskStatus::Completed, "NONE"),
        "FAILED" => return result(id, TaskStatus::Failed, "NONE"),
        "CANCELED" => return result(id, TaskStatus::Canceled, "NONE"),
        "CREATED" | "DISPATCHING" | "RUNNING" | "UNKNOWN" => {}
        _ => return result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT"),
    }
    if (input.cancel_requested || holder.workflow_cancel_requested) && !invocation.cancel_pending {
        let changed = match sqlx::query("update catalog.agent_invocation set cancel_pending=true,updated_at=now() where id=$1 and status in ('CREATED','DISPATCHING','RUNNING','UNKNOWN')")
            .bind(id).execute(&state.pool).await {
            Ok(changed) => changed, Err(error) => return unavailable(error),
        };
        if changed.rows_affected() != 1 {
            return result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT");
        }
        invocation.cancel_pending = true;
    }
    // 已落 dispatch intent 而无 native ID 的情况必须保留 UNKNOWN；取消也不能
    // 将未知 dispatch 写成「确定未发生」。不调用第二次 turn/start。
    if invocation.runtime_thread_id.is_none()
        && matches!(invocation.status.as_str(), "DISPATCHING" | "UNKNOWN")
    {
        return result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT");
    }
    if invocation.cancel_pending && invocation.status == "CREATED" {
        // 确定未派发只启动释放；Activity 自己的原生终态仍由对账器核证。
        return release_holder(&state, id, holder.released).await;
    }
    let Some(runtime) = state.agent_runtime.as_ref() else {
        return result(id, TaskStatus::Running, "RUNTIME_UNAVAILABLE");
    };
    if let Some(thread) = invocation.runtime_thread_id.as_deref() {
        // thread/start 不是 turn/start。确定未派发的 CREATED 不能仅因持有
        // thread 就进入 dispatch 对账，更不能把空 history 记作结果不明。
        if invocation.status == "CREATED" && invocation.runtime_turn_id.is_none() {
            return result(id, TaskStatus::Running, "RUNTIME_SESSION_NOT_INITIALIZED");
        }
        // 观察/interrupt 只消费冻结 generation 的原生引用；ACTIVE admission 是
        // 新模型/工具副作用的前置，不阻断 DRAINING/已撤权安装的安全收尾。
        let hash: Option<String> = match sqlx::query_scalar("select config_hash from catalog.agent_runtime_projection where installation_resource_id=$1 and generation=$2 and agent_version_asset_id=$3")
            .bind(invocation.installation_resource_id).bind(invocation.projection_generation)
            .bind(invocation.agent_version_asset_id).fetch_optional(&state.pool).await {
            Ok(hash) => hash, Err(error) => return unavailable(error),
        };
        let Some(config_hash) = hash else {
            return result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT");
        };
        let projection = RuntimeRef {
            installation_id: invocation.installation_resource_id,
            generation: invocation.projection_generation,
            config_hash,
        };
        if crate::agent_session::resume_existing(&state, id, &projection)
            .await
            .is_err()
        {
            return result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT");
        }
        if invocation.cancel_pending {
            if let Some(turn) = invocation.runtime_turn_id.as_deref() {
                // interrupt 回应不明仍继续只读同一 turn；它可能已经终结，不能
                // 因 native「无 active turn」错误阻断 terminal observation。
                let _ = runtime.interrupt(&projection, thread, turn).await;
            }
        }
        // 未绑定 turn 时从头读取；只在完整单页证明唯一 clientId 时回填，
        // 不把分页某一段的命中冒充整个 thread 的唯一关联。
        let cursor = invocation
            .runtime_turn_id
            .as_ref()
            .and(invocation.observation_cursor.as_deref());
        let page = match runtime.turns(&projection, thread, cursor).await {
            Ok(page) => page,
            Err(_) => return result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT"),
        };
        return observe(&state, &invocation, page, holder.released).await;
    }
    if !holder.held {
        return result(id, TaskStatus::Running, "CAPACITY_UNAVAILABLE");
    }
    let facts = match crate::agent_installation::admit_runtime(
        &state,
        invocation.installation_resource_id,
        invocation.agent_version_asset_id,
        invocation.projection_generation,
    )
    .await
    {
        Ok(facts) => facts,
        Err(_) => return result(id, TaskStatus::Running, "RUNTIME_ADMISSION_UNAVAILABLE"),
    };
    if facts.tenant_id != invocation.tenant_id || facts.workspace_id != invocation.workspace_id {
        return StatusCode::CONFLICT.into_response();
    }
    let session: (String, String) = match sqlx::query_as("select status,core_memory_state from catalog.agent_session where workspace_id=$1 and root_event_id=$2 and installation_resource_id=$3")
        .bind(invocation.workspace_id).bind(&invocation.root_event_id).bind(invocation.installation_resource_id).fetch_one(&state.pool).await {
        Ok(session) => session, Err(error) => return unavailable(error),
    };
    if session.0 != "PENDING" {
        return result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT");
    }
    let projection = RuntimeRef {
        installation_id: invocation.installation_resource_id,
        generation: invocation.projection_generation,
        config_hash: facts.projection_config_hash,
    };
    // birth 自己持有生命周期与 Invocation 锁，调用方不带第二个外层事务。
    // 返回的 memory 正文只存在此调用；未贯通的 turn/额度准入不发模型请求。
    let waiting = match crate::agent_session::birth(&state, id, &projection).await {
        Ok(birth) if Uuid::parse_str(&birth.runtime_thread_id).is_ok() => {
            if birth.core_memory.is_none() {
                "MEMORY_UNREADABLE"
            } else {
                "RUNTIME_SESSION_NOT_INITIALIZED"
            }
        }
        _ => "UNKNOWN_EXTERNAL_RESULT",
    };
    result(id, TaskStatus::Running, waiting)
}

async fn observe(
    state: &ServiceState,
    invocation: &Invocation,
    page: Value,
    released: bool,
) -> Response {
    let Some(turns) = page.get("data").and_then(Value::as_array) else {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    };
    let cursor = match page.get("nextCursor") {
        Some(Value::Null) => None,
        Some(Value::String(cursor)) if !cursor.is_empty() => Some(cursor.as_str()),
        _ => {
            return result(
                invocation.id,
                TaskStatus::Running,
                "UNKNOWN_EXTERNAL_RESULT",
            )
        }
    };
    let mut matched = None;
    let client_id = invocation.id.to_string();
    for turn in turns {
        if turn.get("itemsView").and_then(Value::as_str) != Some("full") {
            return result(
                invocation.id,
                TaskStatus::Running,
                "UNKNOWN_EXTERNAL_RESULT",
            );
        }
        let Some(items) = turn.get("items").and_then(Value::as_array) else {
            return result(
                invocation.id,
                TaskStatus::Running,
                "UNKNOWN_EXTERNAL_RESULT",
            );
        };
        let Some(turn_id) = turn
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
        else {
            return result(
                invocation.id,
                TaskStatus::Running,
                "UNKNOWN_EXTERNAL_RESULT",
            );
        };
        let correlated = items.iter().any(|item| {
            item.get("type").and_then(Value::as_str) == Some("userMessage")
                && item.get("clientId").and_then(Value::as_str) == Some(client_id.as_str())
        });
        let expected = match invocation.runtime_turn_id.as_deref() {
            Some(known) => known == turn_id,
            None => correlated,
        };
        if expected {
            if matched.is_some() {
                return result(
                    invocation.id,
                    TaskStatus::Running,
                    "UNKNOWN_EXTERNAL_RESULT",
                );
            }
            matched = Some(turn);
        }
    }
    if invocation.runtime_turn_id.is_none() && cursor.is_some() {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    }
    let Some(turn) = matched else {
        let changed = match sqlx::query("update catalog.agent_invocation set status='UNKNOWN',observation_cursor=$2,updated_at=now() where id=$1 and status=$3 and observation_cursor is not distinct from $4 and native_status is not distinct from $5 and runtime_turn_id is not distinct from $6")
            .bind(invocation.id).bind(cursor).bind(&invocation.status).bind(&invocation.observation_cursor)
            .bind(&invocation.native_status).bind(&invocation.runtime_turn_id).execute(&state.pool).await {
            Ok(changed) => changed, Err(error) => return unavailable(error),
        };
        if changed.rows_affected() != 1 {
            return result(
                invocation.id,
                TaskStatus::Running,
                "UNKNOWN_EXTERNAL_RESULT",
            );
        }
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    };
    let Some(id) = turn
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
    else {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    };
    let Some(status) = turn.get("status").and_then(Value::as_str) else {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    };
    if !["inProgress", "completed", "failed", "interrupted"].contains(&status) {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    }
    if invocation.native_status.as_deref().is_some_and(|known| {
        matches!(known, "completed" | "failed" | "interrupted") && known != status
    }) {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    }
    let changed = match sqlx::query("update catalog.agent_invocation set runtime_turn_id=$2,native_status=$3,status='RUNNING',observation_cursor=null,updated_at=now() where id=$1 and status=$4 and observation_cursor is not distinct from $5 and native_status is not distinct from $6 and runtime_turn_id is not distinct from $7")
        .bind(invocation.id).bind(id).bind(status).bind(&invocation.status).bind(&invocation.observation_cursor)
        .bind(&invocation.native_status).bind(&invocation.runtime_turn_id).execute(&state.pool).await {
        Ok(changed) => changed, Err(error) => return unavailable(error),
    };
    if changed.rows_affected() != 1 {
        return result(
            invocation.id,
            TaskStatus::Running,
            "UNKNOWN_EXTERNAL_RESULT",
        );
    }
    if matches!(status, "completed" | "failed" | "interrupted") {
        return release_holder(state, invocation.id, released).await;
    }
    // 原生 usage notification 仍不替代 durable Usage 与 reply/sideeffect receipts。
    result(invocation.id, TaskStatus::Running, "NONE")
}

async fn release_holder(state: &ServiceState, id: Uuid, released: bool) -> Response {
    let finish_activity = if released {
        true
    } else {
        match state.capacity.begin_release(&state.pool, id).await {
            Ok(confirmed) => confirmed,
            Err(error) => {
                tracing::warn!(invocation_id=%id, error=%error, "Capacity native release 尚不可核证");
                false
            }
        }
    };
    // 只结束当前持有 Activity，不伪造 Invocation、用量或 Reply 的业务终态。
    (
        StatusCode::OK,
        Json(AgentTaskAdvanceResult {
            invocation_id: id.to_string(),
            status: TaskStatus::Running,
            waiting_reason: if released {
                "BILLING_UNAVAILABLE"
            } else {
                "CAPACITY_RELEASE_UNCONFIRMED"
            }
            .to_owned(),
            finish_activity,
        }),
    )
        .into_response()
}

fn result(id: Uuid, status: TaskStatus, waiting: &str) -> Response {
    let finish_activity = matches!(
        status,
        TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Canceled
    );
    (
        StatusCode::OK,
        Json(AgentTaskAdvanceResult {
            invocation_id: id.to_string(),
            status,
            waiting_reason: waiting.to_owned(),
            finish_activity,
        }),
    )
        .into_response()
}
