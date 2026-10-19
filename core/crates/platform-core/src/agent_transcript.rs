//! DD-125(6)、17 §8「Sessions 转写与活动」、05 §2.11 末段、SF-COD-09/17、V-SCN-143。
//!
//! Agent 会话转写改读 Codex ThreadStore：可见范围由原版“只给 owner”映射为 Installation
//! Resource `audit`，是受审计的敏感读取，不建立 ActionExecution。每次读取（分页、实时流
//! 建立、运行中回合）都在 fresh `audit` 通过后先写 ACCESS 审计，再经同一 Installation 的
//! 原生 app-server 读取；原生 ThreadItem 只在本次回应内按固定 Codex 类型逐字段映射为
//! `AgentTranscriptItem`，Core 不写库、不进日志、不复制正文。其他成员只见 Agent 的 20002
//! 工作中信号（`agent_typing`）。

use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use contracts::{EvidenceKind, ReasonCode};
use futures_util::stream::Stream;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sqlx::FromRow;
use tokio::sync::broadcast::error::RecvError;
use uuid::Uuid;

use crate::agent_installation_query::read_view;
use crate::agent_runtime::{NativeNotice, RuntimeRef, Supervisor};
use crate::audit::{AuditEntry, Evidence};
use crate::bff::{resolve_execution_context, BffState, ExecutionContext};
use crate::governance::{Actor, Refusal};
use crate::spicedb::Consistency;
use crate::web_transport::admit_collaboration_workspace_scope;

/// 审计中的读取名；它们不是 ActionDefinition，不进入 Catalog。
const READ_TRANSCRIPT: &str = "agent.transcript.read";
const READ_TRANSCRIPT_STREAM: &str = "agent.transcript.stream";
const READ_ACTIVE_TURNS: &str = "agent.turns.read";
/// 实时流期间取走原生已缓冲通知的间隔（`Supervisor::pump` 从不等待进行中的 RPC）。
const PUMP_EVERY: Duration = Duration::from_secs(1);
/// 一次运行中回合读取的上界。
const ACTIVE_TURN_LIMIT: i64 = 100;

fn unavailable() -> Response {
    Refusal::Unavailable("Agent 转写事实不可查证".into()).respond(None)
}

fn invalid() -> Response {
    Refusal::Precondition(ReasonCode::InvalidParameters).respond(None)
}

fn denied() -> Response {
    Refusal::Denied(ReasonCode::PermissionDenied).respond(None)
}

fn no_store<T: Serialize>(value: T) -> Response {
    crate::presence::no_store(value)
}

/// Installation read 的确定拒绝（与不存在同答）；其余失败是依赖不可用。
fn refused(response: &Response) -> bool {
    matches!(
        response.status(),
        StatusCode::FORBIDDEN | StatusCode::NOT_FOUND | StatusCode::UNAUTHORIZED
    )
}

fn actor(ctx: &ExecutionContext) -> Actor {
    Actor {
        tenant_id: ctx.tenant_id,
        principal_id: ctx.tenant_principal_id,
        human_identity_id: Some(ctx.human_identity_id),
    }
}

// ---------------------------------------------------------------------------
// 准入与 ACCESS 审计
// ---------------------------------------------------------------------------

/// fresh Installation Resource `audit` 的结论与其 checked revision；Resource 必须仍在
/// 该 Workspace，且 owner/workspace 投影与 Core 事实一致（同 `agent_session_query`）。
async fn audit_check(
    state: &BffState,
    ctx: &ExecutionContext,
    installation: Uuid,
    workspace: Uuid,
) -> Result<Option<String>, Refusal> {
    let resource: Option<(Uuid, Option<Uuid>)> = sqlx::query_as(
        "select owner_principal_id,home_workspace_id from catalog.resource
         where id=$1 and tenant_id=$2 and type_key='agent.installation' and state<>'DELETED'",
    )
    .bind(installation)
    .bind(ctx.tenant_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((owner, home)) = resource else {
        return Ok(None);
    };
    if home != Some(workspace) {
        return Ok(None);
    }
    let spicedb = &state.governance.spicedb;
    let projection = spicedb
        .resource_projection_matches_in_workspace(
            &installation.to_string(),
            &ctx.tenant_id.to_string(),
            &owner.to_string(),
            Some(&workspace.to_string()),
            state.governance.cfg.relationship_page,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()))?;
    if !projection {
        return Err(Refusal::Unavailable(
            "Installation 投影与 Core 事实不一致".into(),
        ));
    }
    let checked = spicedb
        .check(
            "resource",
            &installation.to_string(),
            "audit",
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()))?;
    if checked.zed_token.is_empty() {
        return Err(Refusal::Unavailable(
            "Installation audit 缺 checked revision".into(),
        ));
    }
    Ok(checked.allowed.then_some(checked.zed_token))
}

/// 已准入的一位读者：Installation read（含 Tenant/Workspace 成员准入）与 fresh `audit`。
struct Reader {
    ctx: ExecutionContext,
    workspace: Uuid,
    agent_pubkey: Option<String>,
    token: String,
}

async fn admit(
    state: &BffState,
    headers: &HeaderMap,
    installation: Uuid,
) -> Result<Reader, Response> {
    let ctx = resolve_execution_context(state, headers).await?;
    let view = read_view(state, &ctx, installation).await?;
    let workspace = Uuid::parse_str(&view.workspace_id).map_err(|_| unavailable())?;
    let token = match audit_check(state, &ctx, installation, workspace).await {
        Ok(Some(token)) => token,
        Ok(None) => return Err(denied()),
        Err(refusal) => return Err(refusal.respond(None)),
    };
    Ok(Reader {
        ctx,
        workspace,
        agent_pubkey: view.agent_pubkey,
        token,
    })
}

/// 受审计的敏感读取：每次读取一条 ACCESS 事实，写不进去就不读取。
async fn record(
    state: &BffState,
    ctx: &ExecutionContext,
    workspace: Uuid,
    action: &str,
    target: (&str, Uuid),
    tokens: &[String],
) -> Result<(), Refusal> {
    let operation = Uuid::new_v4();
    let mut evidence = vec![Evidence::new(EvidenceKind::PlatformSessionId, ctx.session_id)];
    for token in tokens.iter().filter(|token| !token.is_empty()) {
        evidence.push(Evidence::new(EvidenceKind::SpicedbZedtoken, token));
    }
    let entry = AuditEntry {
        event_key: format!("agent-transcript-read:{operation}"),
        tenant_id: Some(ctx.tenant_id),
        workspace_id: Some(workspace),
        operation_id: operation,
        event_type: "ACCESS",
        human_identity_id: Some(ctx.human_identity_id),
        initiator_principal_id: Some(ctx.tenant_principal_id),
        actor_principal_id: Some(ctx.tenant_principal_id),
        action_key: action,
        action_version: 1,
        component_type_key: "core",
        target_type: Some(target.0),
        target_id: Some(target.1),
        parameter_hash: "NONE",
        decision: "ALLOW",
        result_code: "AGENT_TRANSCRIPT_READ",
        result_exposure: "NONE",
        evidence_refs: evidence,
        correlation_id: operation,
    };
    let mut tx = state.pool.begin().await?;
    crate::audit::append(&mut tx, entry).await?;
    tx.commit().await?;
    Ok(())
}

/// 本 Installation 正在运行的原生进程的 fence；须是该 Installation 的 ACTIVE 或 PENDING
/// 投影。没有运行体即依赖不可用，不启动进程、不回退。
async fn runtime_ref(
    state: &BffState,
    installation: Uuid,
) -> Result<(Arc<Supervisor>, RuntimeRef), Response> {
    let runtime = state
        .memory_service
        .agent_runtime
        .clone()
        .ok_or_else(unavailable)?;
    let (generation, config_hash) = runtime
        .live_fence(installation)
        .await
        .ok_or_else(unavailable)?;
    let projected: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.agent_runtime_projection
         where installation_resource_id=$1 and generation=$2 and config_hash=$3
           and state in ('ACTIVE','PENDING'))",
    )
    .bind(installation)
    .bind(generation)
    .bind(&config_hash)
    .fetch_one(&state.pool)
    .await
    .map_err(crate::service_api::unavailable)?;
    if !projected {
        return Err(unavailable());
    }
    let fence = RuntimeRef {
        installation_id: installation,
        generation,
        config_hash,
    };
    Ok((runtime, fence))
}

// ---------------------------------------------------------------------------
// Codex ThreadItem → AgentTranscriptItem（内存映射，不落库）
// ---------------------------------------------------------------------------

fn put(map: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    if let Some(value) = value.filter(|value| !value.is_null()) {
        map.insert(key.to_owned(), value);
    }
}

fn text(value: Option<&Value>) -> Option<Value> {
    value
        .and_then(Value::as_str)
        .map(|s| Value::String(s.to_owned()))
}

fn integer(value: Option<&Value>) -> Option<Value> {
    value.and_then(Value::as_i64).map(Value::from)
}

fn strings(value: Option<&Value>) -> Option<Value> {
    let rows: Vec<Value> = value?
        .as_array()?
        .iter()
        .filter_map(|row| row.as_str().map(|s| Value::String(s.to_owned())))
        .collect();
    Some(Value::Array(rows))
}

/// 原生内容块里 `type` 为 `kind` 的文本按原顺序以换行连接；没有文本即省略。
fn joined(blocks: Option<&Value>, kind: &str) -> Option<Value> {
    let parts: Vec<&str> = blocks?
        .as_array()?
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some(kind))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect();
    (!parts.is_empty()).then(|| Value::String(parts.join("\n")))
}

fn status(value: Option<&Value>) -> Option<Value> {
    let status = match value?.as_str()? {
        "inProgress" => "IN_PROGRESS",
        "completed" => "COMPLETED",
        "failed" => "FAILED",
        "declined" => "DECLINED",
        _ => return None,
    };
    Some(json!(status))
}

fn arguments(value: Option<&Value>) -> Option<Value> {
    value
        .filter(|value| !value.is_null())
        .and_then(|value| serde_json::to_string(value).ok())
        .map(Value::String)
}

fn file_changes(value: Option<&Value>) -> Option<Value> {
    let mut changes = Vec::new();
    for change in value?.as_array()? {
        let kind = change.get("kind");
        let change_kind = match kind.and_then(|k| k.get("type")).and_then(Value::as_str) {
            Some("add") => "ADD",
            Some("delete") => "DELETE",
            Some("update") => "UPDATE",
            _ => continue,
        };
        let (Some(path), Some(diff)) = (
            change.get("path").and_then(Value::as_str),
            change.get("diff").and_then(Value::as_str),
        ) else {
            continue;
        };
        let mut row = Map::new();
        row.insert("path".into(), json!(path));
        row.insert("changeKind".into(), json!(change_kind));
        // 原生 struct variant 的字段不随 rename_all 改名，线格式就是 move_path。
        let moved = kind.and_then(|k| k.get("move_path"));
        put(&mut row, "movePath", text(moved));
        row.insert("diff".into(), json!(diff));
        changes.push(Value::Object(row));
    }
    Some(Value::Array(changes))
}

/// 一条原生 ThreadItem 的转写形状（wire 名）；缺 id 的条目不呈现。
fn transcript_item(
    turn: &str,
    item: &Value,
    started_at_ms: Option<i64>,
    completed_at_ms: Option<i64>,
) -> Option<Value> {
    let id = item.get("id").and_then(Value::as_str)?;
    let native = item.get("type").and_then(Value::as_str)?;
    let field = |key: &str| item.get(key);
    let mut out = Map::new();
    out.insert("itemId".into(), json!(id));
    out.insert("turnId".into(), json!(turn));
    out.insert("nativeType".into(), json!(native));
    put(&mut out, "startedAtMs", started_at_ms.map(Value::from));
    put(&mut out, "completedAtMs", completed_at_ms.map(Value::from));
    let kind = match native {
        "userMessage" => {
            put(&mut out, "text", joined(field("content"), "text"));
            "USER_MESSAGE"
        }
        "agentMessage" => {
            put(&mut out, "text", text(field("text")));
            let phase = match field("phase").and_then(Value::as_str) {
                Some("commentary") => Some(json!("COMMENTARY")),
                Some("final_answer") => Some(json!("FINAL_ANSWER")),
                _ => None,
            };
            put(&mut out, "phase", phase);
            "AGENT_MESSAGE"
        }
        "plan" => {
            put(&mut out, "text", text(field("text")));
            "PLAN"
        }
        "reasoning" => {
            put(&mut out, "reasoningSummary", strings(field("summary")));
            put(&mut out, "reasoningContent", strings(field("content")));
            "REASONING"
        }
        "commandExecution" => {
            put(&mut out, "status", status(field("status")));
            put(&mut out, "command", text(field("command")));
            put(&mut out, "cwd", text(field("cwd")));
            let output = text(field("aggregatedOutput"));
            put(&mut out, "aggregatedOutput", output);
            put(&mut out, "exitCode", integer(field("exitCode")));
            put(&mut out, "durationMs", integer(field("durationMs")));
            "COMMAND_EXECUTION"
        }
        "fileChange" => {
            put(&mut out, "status", status(field("status")));
            put(&mut out, "fileChanges", file_changes(field("changes")));
            "FILE_CHANGE"
        }
        "mcpToolCall" => {
            put(&mut out, "status", status(field("status")));
            put(&mut out, "server", text(field("server")));
            put(&mut out, "tool", text(field("tool")));
            put(&mut out, "argumentsJson", arguments(field("arguments")));
            let result = field("result").and_then(|result| result.get("content"));
            put(&mut out, "resultText", joined(result, "text"));
            let error = field("error").and_then(|error| error.get("message"));
            put(&mut out, "errorText", text(error));
            put(&mut out, "durationMs", integer(field("durationMs")));
            "MCP_TOOL_CALL"
        }
        "dynamicToolCall" => {
            put(&mut out, "status", status(field("status")));
            put(&mut out, "server", text(field("namespace")));
            put(&mut out, "tool", text(field("tool")));
            put(&mut out, "argumentsJson", arguments(field("arguments")));
            let result = joined(field("contentItems"), "inputText");
            put(&mut out, "resultText", result);
            put(&mut out, "durationMs", integer(field("durationMs")));
            "DYNAMIC_TOOL_CALL"
        }
        "webSearch" => {
            put(&mut out, "query", text(field("query")));
            "WEB_SEARCH"
        }
        "imageView" => "IMAGE_VIEW",
        "contextCompaction" => "CONTEXT_COMPACTION",
        _ => "OTHER",
    };
    out.insert("kind".into(), json!(kind));
    Some(Value::Object(out))
}

/// 原生 `thread/items/list` 一页（`data[{turnId,item}]`）的转写条目；形状不符即结果不明。
fn page_items(page: &Value) -> Option<Vec<Value>> {
    let mut items = Vec::new();
    for entry in page.get("data")?.as_array()? {
        let turn = entry.get("turnId").and_then(Value::as_str)?;
        let item = entry.get("item")?;
        if let Some(row) = transcript_item(turn, item, None, None) {
            items.push(row);
        }
    }
    Some(items)
}

/// 一条实时通知的 SSE 帧（`AgentTranscriptEvent`）；item 不成形时不转发。
fn event_frame(root: &str, generation: i64, notice: &NativeNotice) -> Option<Value> {
    let (phase, item) = match notice.method {
        "item/started" | "item/completed" => {
            let started = notice.params.get("startedAtMs").and_then(Value::as_i64);
            let completed = notice.params.get("completedAtMs").and_then(Value::as_i64);
            let native = notice.params.get("item")?;
            let item = transcript_item(&notice.turn, native, started, completed)?;
            let phase = if notice.method == "item/started" {
                "ITEM_STARTED"
            } else {
                "ITEM_COMPLETED"
            };
            (phase, Some(item))
        }
        "turn/started" => ("TURN_STARTED", None),
        "turn/completed" => ("TURN_COMPLETED", None),
        _ => return None,
    };
    let at = match notice.method {
        "item/started" => notice.params.get("startedAtMs").and_then(Value::as_i64),
        "item/completed" => notice.params.get("completedAtMs").and_then(Value::as_i64),
        _ => notice.emitted_at_ms,
    };
    let mut out = Map::new();
    out.insert("installationId".into(), json!(notice.installation));
    out.insert("rootEventId".into(), json!(root));
    out.insert("projectionGeneration".into(), json!(generation));
    out.insert("threadId".into(), json!(notice.thread));
    out.insert("turnId".into(), json!(notice.turn));
    out.insert("phase".into(), json!(phase));
    put(&mut out, "atMs", at.map(Value::from));
    put(&mut out, "item", item);
    let typed: contracts::AgentTranscriptEvent = serde_json::from_value(Value::Object(out)).ok()?;
    serde_json::to_value(typed).ok()
}

// ---------------------------------------------------------------------------
// 分页游标：绑定读者、Tenant、Installation 与 Session，原生 cursor 不外露
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, PartialEq, Debug, Clone)]
#[serde(deny_unknown_fields)]
struct Cursor {
    tenant: Uuid,
    principal: Uuid,
    installation: Uuid,
    root: String,
    generation: i64,
    thread: String,
    native: String,
}

impl Cursor {
    fn encode(&self) -> Option<String> {
        serde_json::to_vec(self)
            .ok()
            .map(|bytes| URL_SAFE_NO_PAD.encode(bytes))
    }

    /// 只认同一读者、Installation 与 Session 的游标；其他一律无效，不当作首页重读。
    fn decode(raw: &str, expected: &Cursor) -> Option<String> {
        let bytes = URL_SAFE_NO_PAD.decode(raw).ok()?;
        let cursor: Cursor = serde_json::from_slice(&bytes).ok()?;
        let bound = Cursor {
            native: cursor.native.clone(),
            ..expected.clone()
        };
        (cursor == bound && !cursor.native.is_empty()).then_some(cursor.native)
    }
}

// ---------------------------------------------------------------------------
// 运行中回合
// ---------------------------------------------------------------------------

#[derive(FromRow)]
struct TurnRow {
    installation_resource_id: Uuid,
    id: Uuid,
    action_execution_id: Uuid,
    root_event_id: String,
    projection_generation: i64,
    runtime_thread_id: Option<String>,
    runtime_turn_id: Option<String>,
}

/// 运行中的回合：已派发或运行、原生尚未终态。可选限定一个 Installation 或一个 Session。
const ACTIVE_TURNS: &str = "select i.installation_resource_id,i.id,i.action_execution_id,
    i.root_event_id,i.projection_generation,s.runtime_thread_id,i.runtime_turn_id
  from catalog.agent_invocation i
  join catalog.agent_session s on s.workspace_id=i.workspace_id and s.root_event_id=i.root_event_id
    and s.installation_resource_id=i.installation_resource_id
    and s.projection_generation=i.projection_generation
    and s.agent_version_asset_id=i.agent_version_asset_id
  where i.tenant_id=$1 and i.workspace_id=$2 and i.status in ('DISPATCHING','RUNNING')
    and (i.native_status is null or i.native_status not in ('completed','failed','interrupted'))
    and ($3::uuid is null or i.installation_resource_id=$3)
    and ($4::text is null or (i.root_event_id=$4 and i.projection_generation=$5))
  order by i.created_at,i.id limit $6";

async fn active_turns(
    state: &BffState,
    ctx: &ExecutionContext,
    workspace: Uuid,
    installation: Option<Uuid>,
    session: Option<(&str, i64)>,
) -> Result<Vec<TurnRow>, Response> {
    sqlx::query_as(ACTIVE_TURNS)
        .bind(ctx.tenant_id)
        .bind(workspace)
        .bind(installation)
        .bind(session.map(|(root, _)| root))
        .bind(session.map(|(_, generation)| generation))
        .bind(ACTIVE_TURN_LIMIT)
        .fetch_all(&state.pool)
        .await
        .map_err(crate::service_api::unavailable)
}

fn rfc3339(seconds: i64) -> Option<String> {
    chrono::DateTime::<chrono::Utc>::from_timestamp(seconds, 0)
        .map(|at| at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

/// `AgentActiveTurnView`：开始时刻只取原生 turn startedAt，查不到即省略；中断键只在
/// DD-84 控制此刻对本人可用时给出（原发起人或 Installation manage，提交仍完整重新准入）。
async fn turn_view(
    state: &BffState,
    ctx: &ExecutionContext,
    row: &TurnRow,
    agent_pubkey: Option<&str>,
) -> Value {
    let mut out = Map::new();
    out.insert("installationId".into(), json!(row.installation_resource_id));
    out.insert("invocationId".into(), json!(row.id));
    let original = json!(row.action_execution_id);
    out.insert("originalActionExecutionId".into(), original);
    out.insert("rootEventId".into(), json!(row.root_event_id));
    let generation = json!(row.projection_generation);
    out.insert("projectionGeneration".into(), generation);
    put(&mut out, "agentPubkey", agent_pubkey.map(|key| json!(key)));
    let thread = row.runtime_thread_id.as_deref().map(|id| json!(id));
    put(&mut out, "threadId", thread);
    let turn = row.runtime_turn_id.as_deref().map(|id| json!(id));
    put(&mut out, "turnId", turn);
    if let (Some(thread), Some(turn)) = (&row.runtime_thread_id, &row.runtime_turn_id) {
        if let Ok((runtime, fence)) = runtime_ref(state, row.installation_resource_id).await {
            if let Ok(Some(seconds)) = runtime.turn_started_at(&fence, thread, turn).await {
                put(&mut out, "startedAt", rfc3339(seconds).map(Value::String));
            }
        }
    }
    match state
        .governance
        .available_cancel_action(actor(ctx), row.action_execution_id)
        .await
    {
        Ok(key) => put(&mut out, "cancelActionKey", key.map(Value::String)),
        Err(error) => {
            tracing::warn!(invocation = %row.id, ?error, "回合中断可用性不可查；不提供入口");
        }
    }
    Value::Object(out)
}

// ---------------------------------------------------------------------------
// GET /api/v1/agent-installations/{id}/transcript
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranscriptQuery {
    root_event_id: String,
    projection_generation: i64,
    cursor: Option<String>,
}

pub(crate) async fn page(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Query(q): Query<TranscriptQuery>,
) -> Response {
    match transcript_page(&state, &headers, id, q).await {
        Ok(page) => no_store(page),
        Err(response) => response,
    }
}

async fn transcript_page(
    state: &BffState,
    headers: &HeaderMap,
    id: Uuid,
    q: TranscriptQuery,
) -> Result<contracts::AgentTranscriptPage, Response> {
    if q.root_event_id.is_empty() || q.projection_generation <= 0 {
        return Err(invalid());
    }
    let reader = admit(state, headers, id).await?;
    let thread: Option<Option<String>> = sqlx::query_scalar(
        "select runtime_thread_id from catalog.agent_session
         where tenant_id=$1 and workspace_id=$2 and installation_resource_id=$3
           and root_event_id=$4 and projection_generation=$5",
    )
    .bind(reader.ctx.tenant_id)
    .bind(reader.workspace)
    .bind(id)
    .bind(&q.root_event_id)
    .bind(q.projection_generation)
    .fetch_optional(&state.pool)
    .await
    .map_err(crate::service_api::unavailable)?;
    let Some(thread) = thread else {
        let missing = Refusal::Precondition(ReasonCode::TargetNotFound);
        return Err(missing.respond(None));
    };
    record(
        state,
        &reader.ctx,
        reader.workspace,
        READ_TRANSCRIPT,
        ("RESOURCE", id),
        std::slice::from_ref(&reader.token),
    )
    .await
    .map_err(|refusal| refusal.respond(None))?;
    let mut out = Map::new();
    out.insert("installationId".into(), json!(id));
    out.insert("rootEventId".into(), json!(q.root_event_id));
    let generation = json!(q.projection_generation);
    out.insert("projectionGeneration".into(), generation);
    let mut items = Vec::new();
    if let Some(thread) = thread {
        let bound = Cursor {
            tenant: reader.ctx.tenant_id,
            principal: reader.ctx.tenant_principal_id,
            installation: id,
            root: q.root_event_id.clone(),
            generation: q.projection_generation,
            thread: thread.clone(),
            native: String::new(),
        };
        let native = match q.cursor.as_deref() {
            Some(raw) => Some(Cursor::decode(raw, &bound).ok_or_else(invalid)?),
            None => None,
        };
        let (runtime, fence) = runtime_ref(state, id).await?;
        let page = runtime
            .items(&fence, &thread, native.as_deref())
            .await
            .map_err(|_| unavailable())?;
        items = page_items(&page).ok_or_else(unavailable)?;
        if let Some(next) = page.get("nextCursor").and_then(Value::as_str) {
            let cursor = Cursor {
                native: next.to_owned(),
                ..bound
            };
            put(&mut out, "nextCursor", cursor.encode().map(Value::String));
        }
        out.insert("threadId".into(), json!(thread));
    }
    out.insert("items".into(), Value::Array(items));
    let session = Some((q.root_event_id.as_str(), q.projection_generation));
    let running = active_turns(state, &reader.ctx, reader.workspace, Some(id), session).await?;
    if let Some(row) = running.first() {
        let view = turn_view(state, &reader.ctx, row, reader.agent_pubkey.as_deref()).await;
        out.insert("activeTurn".into(), view);
    }
    serde_json::from_value(Value::Object(out)).map_err(|_| unavailable())
}

// ---------------------------------------------------------------------------
// GET /api/v1/workspaces/{workspace_id}/agent-turns
// ---------------------------------------------------------------------------

pub(crate) async fn workspace_turns(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(workspace): Path<Uuid>,
) -> Response {
    match turn_page(&state, &headers, workspace).await {
        Ok(page) => no_store(page),
        Err(response) => response,
    }
}

async fn turn_page(
    state: &BffState,
    headers: &HeaderMap,
    workspace: Uuid,
) -> Result<contracts::AgentActiveTurnPage, Response> {
    let ctx = resolve_execution_context(state, headers).await?;
    admit_collaboration_workspace_scope(state, &ctx, workspace)
        .await
        .map_err(IntoResponse::into_response)?;
    let rows = active_turns(state, &ctx, workspace, None, None).await?;
    // Installation 级的可见性：Resource read 与 fresh audit 同时成立；没有 audit 的回合
    // 不出现（成员只见 20002）。读不动的依赖是结果不明，不当作“没有回合”。
    let mut visible: HashMap<Uuid, Option<(Option<String>, String)>> = HashMap::new();
    for row in &rows {
        if visible.contains_key(&row.installation_resource_id) {
            continue;
        }
        let installation = row.installation_resource_id;
        let view = match read_view(state, &ctx, installation).await {
            Ok(view) => view,
            Err(response) if refused(&response) => {
                visible.insert(installation, None);
                continue;
            }
            Err(response) => return Err(response),
        };
        if view.workspace_id != workspace.to_string() {
            visible.insert(installation, None);
            continue;
        }
        let token = audit_check(state, &ctx, installation, workspace)
            .await
            .map_err(|refusal| refusal.respond(None))?;
        visible.insert(installation, token.map(|token| (view.agent_pubkey, token)));
    }
    let tokens: Vec<String> = visible
        .values()
        .flatten()
        .map(|(_, token)| token.clone())
        .collect();
    let mut turns = Vec::new();
    if !tokens.is_empty() {
        record(
            state,
            &ctx,
            workspace,
            READ_ACTIVE_TURNS,
            ("WORKSPACE", workspace),
            &tokens,
        )
        .await
        .map_err(|refusal| refusal.respond(None))?;
        for row in &rows {
            if let Some(Some((pubkey, _))) = visible.get(&row.installation_resource_id) {
                turns.push(turn_view(state, &ctx, row, pubkey.as_deref()).await);
            }
        }
    }
    serde_json::from_value(json!({"workspaceId": workspace, "turns": turns}))
        .map_err(|_| unavailable())
}

// ---------------------------------------------------------------------------
// GET /api/v1/agent-installations/{id}/transcript/stream
// ---------------------------------------------------------------------------

/// SSE：`retry`（重连间隔毫秒）、`live`（已订阅）、`transcript`（`AgentTranscriptEvent`）、
/// `closed`（原因：`session-revoked`、`scope-revoked`、`readmission-unavailable`、
/// `upstream-unavailable`）。准入之后一律 200，原因在带内表达（同 `stream.rs`）。
pub(crate) async fn stream(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let reader = match admit(&state, &headers, id).await {
        Ok(reader) => reader,
        Err(response) => return response,
    };
    if let Err(refusal) = record(
        &state,
        &reader.ctx,
        reader.workspace,
        READ_TRANSCRIPT_STREAM,
        ("RESOURCE", id),
        std::slice::from_ref(&reader.token),
    )
    .await
    {
        return refusal.respond(None);
    }
    let retry = Duration::from_millis(state.stream_retry_millis);
    let Some(runtime) = state.memory_service.agent_runtime.clone() else {
        return crate::stream::closed_in_band(retry, "upstream-unavailable");
    };
    let notices = runtime.subscribe_notices();
    let feed = Feed {
        state,
        ctx: reader.ctx,
        installation: id,
        workspace: reader.workspace,
        runtime,
    };
    Sse::new(frames(feed, retry, notices))
        .keep_alive(KeepAlive::default())
        .into_response()
}

struct Feed {
    state: BffState,
    ctx: ExecutionContext,
    installation: Uuid,
    workspace: Uuid,
    runtime: Arc<Supervisor>,
}

impl Feed {
    /// 原生 thread → AgentSession（root, generation）；不是本 Installation 的 thread 为 None。
    async fn session(&self, thread: &str) -> Result<Option<(String, i64)>, sqlx::Error> {
        sqlx::query_as(
            "select root_event_id,projection_generation from catalog.agent_session
             where tenant_id=$1 and workspace_id=$2 and installation_resource_id=$3
               and runtime_thread_id=$4",
        )
        .bind(self.ctx.tenant_id)
        .bind(self.workspace)
        .bind(self.installation)
        .bind(thread)
        .fetch_optional(&self.state.pool)
        .await
    }

    /// 长连接的周期性再准入：会话、Installation read 与 audit 都须仍然成立。
    async fn check(&self) -> Option<&'static str> {
        match identity::session::is_live(&self.state.pool, self.ctx.session_id).await {
            Ok(true) => {}
            Ok(false) => return Some("session-revoked"),
            Err(_) => return Some("readmission-unavailable"),
        }
        match read_view(&self.state, &self.ctx, self.installation).await {
            Ok(view) if view.workspace_id == self.workspace.to_string() => {}
            Ok(_) => return Some("scope-revoked"),
            Err(response) if refused(&response) => return Some("scope-revoked"),
            Err(_) => return Some("readmission-unavailable"),
        }
        match audit_check(&self.state, &self.ctx, self.installation, self.workspace).await {
            Ok(Some(_)) => None,
            Ok(None) => Some("scope-revoked"),
            Err(_) => Some("readmission-unavailable"),
        }
    }
}

fn closed(reason: &'static str) -> Event {
    Event::default().event("closed").data(reason)
}

fn frames(
    feed: Feed,
    retry: Duration,
    mut notices: tokio::sync::broadcast::Receiver<NativeNotice>,
) -> impl Stream<Item = Result<Event, Infallible>> {
    async_stream::stream! {
        yield Ok::<_, Infallible>(crate::stream::retry_frame(retry));
        yield Ok(Event::default().event("live").data(feed.installation.to_string()));
        let mut sessions: HashMap<String, Option<(String, i64)>> = HashMap::new();
        let mut pump = tokio::time::interval(PUMP_EVERY);
        let readmit_every = Duration::from_secs(feed.state.stream_readmit_seconds.max(1));
        let mut readmit = tokio::time::interval(readmit_every);
        // 第一次 tick 立即返回，跳过它：刚刚才过完准入
        readmit.tick().await;
        loop {
            tokio::select! {
                notice = notices.recv() => {
                    let notice = match notice {
                        Ok(notice) => notice,
                        // 落后丢帧或运行体退出：关流让客户端重连并以分页补齐
                        Err(RecvError::Lagged(_)) | Err(RecvError::Closed) => {
                            yield Ok(closed("upstream-unavailable"));
                            break;
                        }
                    };
                    if notice.installation != feed.installation {
                        continue;
                    }
                    let session = match sessions.get(&notice.thread) {
                        Some(session) => session.clone(),
                        None => match feed.session(&notice.thread).await {
                            Ok(session) => {
                                sessions.insert(notice.thread.clone(), session.clone());
                                session
                            }
                            Err(error) => {
                                tracing::warn!(%error, "转写 thread 解析失败");
                                yield Ok(closed("readmission-unavailable"));
                                break;
                            }
                        },
                    };
                    let Some((root, generation)) = session else {
                        continue;
                    };
                    if let Some(frame) = event_frame(&root, generation, &notice) {
                        yield Ok(Event::default().event("transcript").data(frame.to_string()));
                    }
                }
                _ = pump.tick() => feed.runtime.pump(feed.installation).await,
                _ = readmit.tick() => {
                    if let Some(reason) = feed.check().await {
                        yield Ok(closed(reason));
                        break;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn typed(value: &Value) -> contracts::AgentTranscriptItem {
        serde_json::from_value(value.clone()).expect("contract item")
    }

    #[test]
    fn every_native_item_kind_maps_to_the_contract_shape() {
        let turn = "019a0000-0000-7000-8000-000000000001";
        let cases = [
            (
                json!({"type":"userMessage","id":"u","clientId":null,"content":[
                    {"type":"text","text":"@Scout hi","text_elements":[]},
                    {"type":"image","url":"https://x.test/a.png"},
                    {"type":"text","text":"second"}]}),
                json!({"kind":"USER_MESSAGE","text":"@Scout hi\nsecond"}),
            ),
            (
                json!({"type":"agentMessage","id":"a","text":"done","phase":"final_answer"}),
                json!({"kind":"AGENT_MESSAGE","text":"done","phase":"FINAL_ANSWER"}),
            ),
            (
                json!({"type":"agentMessage","id":"a2","text":"thinking aloud","phase":null}),
                json!({"kind":"AGENT_MESSAGE","text":"thinking aloud"}),
            ),
            (
                json!({"type":"plan","id":"p","text":"1. read"}),
                json!({"kind":"PLAN","text":"1. read"}),
            ),
            (
                json!({"type":"reasoning","id":"r","summary":["s"],"content":[]}),
                json!({"kind":"REASONING","reasoningSummary":["s"],"reasoningContent":[]}),
            ),
            (
                json!({"type":"commandExecution","id":"c","command":"ls","cwd":"/w",
                    "processId":null,"source":"agent","status":"failed","commandActions":[],
                    "aggregatedOutput":"no","exitCode":2,"durationMs":15}),
                json!({"kind":"COMMAND_EXECUTION","status":"FAILED","command":"ls","cwd":"/w",
                    "aggregatedOutput":"no","exitCode":2,"durationMs":15}),
            ),
            (
                json!({"type":"fileChange","id":"f","status":"completed","changes":[
                    {"path":"a.md","kind":{"type":"update","move_path":"b.md"},"diff":"@@"},
                    {"path":"c.md","kind":{"type":"add"},"diff":"+x"},
                    {"path":"d.md","kind":{"type":"future"},"diff":""}]}),
                json!({"kind":"FILE_CHANGE","status":"COMPLETED","fileChanges":[
                    {"path":"a.md","changeKind":"UPDATE","movePath":"b.md","diff":"@@"},
                    {"path":"c.md","changeKind":"ADD","diff":"+x"}]}),
            ),
            (
                json!({"type":"mcpToolCall","id":"m","server":"platform","tool":"memory",
                    "status":"completed","arguments":{"slug":"x"},"result":{"content":[
                        {"type":"text","text":"one"},{"type":"image","data":"…"},
                        {"type":"text","text":"two"}],"structuredContent":null},
                    "error":null,"durationMs":4}),
                json!({"kind":"MCP_TOOL_CALL","status":"COMPLETED","server":"platform",
                    "tool":"memory","argumentsJson":"{\"slug\":\"x\"}","resultText":"one\ntwo",
                    "durationMs":4}),
            ),
            (
                json!({"type":"mcpToolCall","id":"m2","server":"s","tool":"t","status":"failed",
                    "arguments":null,"result":null,"error":{"message":"denied"}}),
                json!({"kind":"MCP_TOOL_CALL","status":"FAILED","server":"s","tool":"t",
                    "errorText":"denied"}),
            ),
            (
                json!({"type":"dynamicToolCall","id":"d","namespace":"buzz","tool":"send",
                    "arguments":{},"status":"inProgress","contentItems":[
                        {"type":"inputText","text":"sent"}],"success":null}),
                json!({"kind":"DYNAMIC_TOOL_CALL","status":"IN_PROGRESS","server":"buzz",
                    "tool":"send","argumentsJson":"{}","resultText":"sent"}),
            ),
            (
                json!({"type":"webSearch","id":"w","query":"q","action":{"type":"search"}}),
                json!({"kind":"WEB_SEARCH","query":"q"}),
            ),
            (
                json!({"type":"imageView","id":"i","path":"/secret/path.png"}),
                json!({"kind":"IMAGE_VIEW"}),
            ),
            (
                json!({"type":"contextCompaction","id":"x"}),
                json!({"kind":"CONTEXT_COMPACTION"}),
            ),
            (
                json!({"type":"hookPrompt","id":"h","fragments":[{"text":"secret"}]}),
                json!({"kind":"OTHER"}),
            ),
        ];
        for (native, expected) in cases {
            let mapped = transcript_item(turn, &native, None, None).unwrap();
            let mut want = expected.as_object().unwrap().clone();
            want.insert("itemId".into(), native["id"].clone());
            want.insert("turnId".into(), json!(turn));
            want.insert("nativeType".into(), native["type"].clone());
            assert_eq!(mapped, Value::Object(want), "{native}");
            // Every mapped item is a valid contract value that keeps absent fields absent.
            assert_eq!(serde_json::to_value(typed(&mapped)).unwrap(), mapped);
        }
        // The local image path never leaves Core.
        let image = json!({"type":"imageView","id":"i","path":"/p"});
        let image = transcript_item(turn, &image, None, None);
        assert!(!image.unwrap().to_string().contains("/p"));
        // No native id or type: not presented.
        assert!(transcript_item(turn, &json!({"type":"plan","text":"x"}), None, None).is_none());
        assert!(transcript_item(turn, &json!({"id":"x"}), None, None).is_none());
    }

    #[test]
    fn native_pages_and_live_notices_become_contract_frames() {
        let page = json!({"data":[
            {"turnId":"t1","item":{"type":"plan","id":"p","text":"x"}},
            {"turnId":"t1","item":{"text":"no id"}}],"nextCursor":"n","backwardsCursor":null});
        let items = page_items(&page).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["turnId"], "t1");
        assert!(page_items(&json!({"data":[{"item":{}}]})).is_none());
        assert!(page_items(&json!({})).is_none());

        let installation = Uuid::from_u128(5);
        let started = NativeNotice {
            installation,
            method: "item/started",
            thread: "th".into(),
            turn: "tu".into(),
            params: json!({"threadId":"th","turnId":"tu","startedAtMs":10,
                "item":{"type":"commandExecution","id":"c","command":"ls","status":"inProgress"}}),
            emitted_at_ms: Some(11),
        };
        let frame = event_frame(&"a".repeat(64), 2, &started).unwrap();
        assert_eq!(frame["phase"], "ITEM_STARTED");
        assert_eq!(frame["atMs"], 10);
        assert_eq!(frame["item"]["startedAtMs"], 10);
        assert_eq!(frame["item"]["status"], "IN_PROGRESS");
        assert_eq!(frame["projectionGeneration"], 2);
        let done = NativeNotice {
            method: "turn/completed",
            params: json!({"status":"completed"}),
            ..started.clone()
        };
        let frame = event_frame("r", 2, &done).unwrap();
        assert_eq!(frame["phase"], "TURN_COMPLETED");
        assert_eq!(frame["atMs"], 11);
        assert!(frame.get("item").is_none());
        let malformed = NativeNotice {
            params: json!({"threadId":"th","turnId":"tu","item":{"text":"no id"}}),
            ..started
        };
        assert!(event_frame("r", 2, &malformed).is_none());
    }

    #[test]
    fn cursor_is_bound_to_reader_installation_and_session() {
        let bound = Cursor {
            tenant: Uuid::from_u128(1),
            principal: Uuid::from_u128(2),
            installation: Uuid::from_u128(3),
            root: "a".repeat(64),
            generation: 2,
            thread: "th".into(),
            native: String::new(),
        };
        let issued = Cursor {
            native: "native-cursor".into(),
            ..bound.clone()
        };
        let raw = issued.encode().unwrap();
        assert_eq!(Cursor::decode(&raw, &bound).as_deref(), Some("native-cursor"));
        for change in 0..6 {
            let mut other = bound.clone();
            match change {
                0 => other.tenant = Uuid::from_u128(9),
                1 => other.principal = Uuid::from_u128(9),
                2 => other.installation = Uuid::from_u128(9),
                3 => other.root = "b".repeat(64),
                4 => other.generation = 3,
                _ => other.thread = "other".into(),
            }
            assert!(Cursor::decode(&raw, &other).is_none(), "{change}");
        }
        for raw in ["", "not!base64", "e30"] {
            assert!(Cursor::decode(raw, &bound).is_none());
        }
        let empty = bound.encode().unwrap();
        assert!(Cursor::decode(&empty, &bound).is_none());
    }

    #[test]
    fn active_turns_are_running_and_not_natively_terminal() {
        for fact in [
            "i.status in ('DISPATCHING','RUNNING')",
            "not in ('completed','failed','interrupted')",
            "i.tenant_id=$1 and i.workspace_id=$2",
        ] {
            assert!(ACTIVE_TURNS.contains(fact), "{fact}");
        }
        assert_eq!(rfc3339(1_760_860_800).as_deref(), Some("2025-10-19T08:00:00Z"));
    }

    #[tokio::test]
    #[ignore = "requires AGENT_INVOKE_TEST_DATABASE_URL pointing at a disposable migrated database"]
    async fn active_turn_query_matches_the_migrated_schema() {
        let pool = sqlx::PgPool::connect(&std::env::var("AGENT_INVOKE_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        let rows: Vec<TurnRow> = sqlx::query_as(ACTIVE_TURNS)
            .bind(Uuid::new_v4())
            .bind(Uuid::new_v4())
            .bind(None::<Uuid>)
            .bind(Some("a".repeat(64)))
            .bind(Some(1_i64))
            .bind(1_i64)
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(rows.is_empty());
        pool.close().await;
    }
}
