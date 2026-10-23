//! DD-134(3)：网关调用统计、调用列表与单次调用下钻。
//!
//! 来源（每次请求实时读取，不缓存、不复制 Gateway 日志）：
//! - 模型调用：AgentGateway request log（SF-AGW-06），Core 以 SS-AGW-ADMIN 的 service
//!   凭据经 `/api/logs/search` 与 `/api/logs/get` 读取；只取元数据，丢弃 prompt 预览、
//!   turn 与 payload。日志批量写入且失败丢批（SF-AGW-09），只作观测，不作计费依据。
//!   Tenant 归属只按 gateway user 映射 Core 已登记的 Installation gateway 身份或
//!   binding ServicePrincipal（SF-AGW-08、DD-128）；映射不到的为 `UNATTRIBUTED`。
//!   用量状态取 Core durable usage（SS-AGW-USAGE）：没有 UsageEvent 即
//!   `BILLING_UNAVAILABLE`，不显示零用量（`14` §8）。只计模型入口 listener 上解析出
//!   模型请求的记录（DD-134(3)①、SF-AGW-31）：模型列表查询、解析前被拒的请求与其他
//!   listener 上的 MCP、工具与探测流量都不是模型调用。
//! - 工具调用：request log 只持久 LLM 请求（SF-AGW-27），因此取 Core 的 Agent 工具子
//!   ActionExecution 与其审计；时延是 Core 观测的 INTENT 到终态审计的间隔，与模型
//!   调用的 Gateway 时延分列，不混算分位数。
//!
//! 平台范围只呈现 Gateway 原生事实与 Tenant 归属 ID，不读取任何业务 Tenant 的
//! ActionExecution、审计、Agent 或 Tool 名称（REQ-09）。

use std::collections::{BTreeMap, HashMap};

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use contracts::{GatewayCallDetail, GatewayCallPage, GatewayStats, ReasonCode};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use uuid::Uuid;

use super::access::{caller, require_audit, Caller};
use crate::bff::BffState;
use crate::governance::Refusal;

/// 默认窗口与上限（DD-134(3)④）。
const DEFAULT_WINDOW_HOURS: i64 = 24;
const MAX_WINDOW_DAYS: i64 = 7;
const BUCKETS: i64 = 24;
/// 单次查询扫描的原始记录上限；超出时结果标 `truncated`，只基于已扫描部分。
pub(crate) const MODEL_SCAN_LIMIT: usize = 5000;
const TOOL_SCAN_LIMIT: i64 = 5000;
const LOG_PAGE: i64 = 500;
const CALL_PAGE_DEFAULT: usize = 50;
const CALL_PAGE_MAX: usize = 200;
pub(crate) const UNATTRIBUTED: &str = "UNATTRIBUTED";

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

fn unavailable(what: &str) -> Refusal {
    Refusal::Unavailable(format!("gateway admin {what} unavailable"))
}

pub(crate) fn rfc3339(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Millis, true)
}

// ---------------------------------------------------------------------------
// 时间窗
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Window {
    pub from: DateTime<Utc>,
    pub to: DateTime<Utc>,
    pub bucket_seconds: i64,
}

impl Window {
    fn bucket(&self, at: DateTime<Utc>) -> Option<usize> {
        if at < self.from || at >= self.to {
            return None;
        }
        usize::try_from((at - self.from).num_seconds() / self.bucket_seconds).ok()
    }

    fn bucket_count(&self) -> usize {
        let span = (self.to - self.from).num_seconds();
        usize::try_from((span + self.bucket_seconds - 1) / self.bucket_seconds).unwrap_or(0)
    }
}

/// 默认最近 24 小时；最长 7 天；时间桶为窗口的 24 等分（不少于 60 秒）。
pub(crate) fn window(
    from: Option<&str>,
    to: Option<&str>,
    now: DateTime<Utc>,
) -> Result<Window, Refusal> {
    let parse = |value: &str| {
        DateTime::parse_from_rfc3339(value)
            .map(|t| t.with_timezone(&Utc))
            .map_err(|_| invalid())
    };
    let to = to.map(parse).transpose()?.unwrap_or(now);
    let from = from
        .map(parse)
        .transpose()?
        .unwrap_or(to - Duration::hours(DEFAULT_WINDOW_HOURS));
    if from >= to || to - from > Duration::days(MAX_WINDOW_DAYS) {
        return Err(invalid());
    }
    let span = (to - from).num_seconds();
    let bucket_seconds = ((span + BUCKETS - 1) / BUCKETS).max(60);
    Ok(Window {
        from,
        to,
        bucket_seconds,
    })
}

/// 最近秩分位数（`q` 取 0–1）；空集合为 `None`。
pub(crate) fn percentile(sorted: &[i64], q: f64) -> Option<i64> {
    if sorted.is_empty() {
        return None;
    }
    let rank = (q * sorted.len() as f64).ceil() as usize;
    Some(sorted[rank.clamp(1, sorted.len()) - 1])
}

// ---------------------------------------------------------------------------
// 记录
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Model,
    Tool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Outcome {
    Succeeded,
    Failed,
    Denied,
    Running,
    Unknown,
}

impl Outcome {
    fn wire(self) -> &'static str {
        match self {
            Outcome::Succeeded => "SUCCEEDED",
            Outcome::Failed => "FAILED",
            Outcome::Denied => "DENIED",
            Outcome::Running => "RUNNING",
            Outcome::Unknown => "UNKNOWN",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "SUCCEEDED" => Outcome::Succeeded,
            "FAILED" => Outcome::Failed,
            "DENIED" => Outcome::Denied,
            "RUNNING" => Outcome::Running,
            "UNKNOWN" => Outcome::Unknown,
            _ => return None,
        })
    }
}

/// 一次调用：聚合所需字段与对外视图（`GatewayCallView` 形状的 JSON）。
#[derive(Debug, Clone)]
pub(crate) struct Record {
    pub kind: Kind,
    pub call_id: String,
    pub started: DateTime<Utc>,
    pub duration_ms: Option<i64>,
    pub outcome: Outcome,
    pub billing_unavailable: bool,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    pub route: Option<String>,
    pub tool: Option<String>,
    pub agent: Option<String>,
    pub binding: Option<String>,
    pub tenant: Option<String>,
    pub labels: BTreeMap<&'static str, String>,
    pub view: Value,
}

impl Record {
    pub(crate) fn key(&self, dimension: Dimension) -> Option<&str> {
        match dimension {
            Dimension::ModelRoute => self.route.as_deref(),
            Dimension::Tool => self.tool.as_deref(),
            Dimension::Agent => self.agent.as_deref(),
            Dimension::Binding => self.binding.as_deref(),
            Dimension::Tenant => Some(self.tenant.as_deref().unwrap_or(UNATTRIBUTED)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Dimension {
    ModelRoute,
    Tool,
    Agent,
    Binding,
    Tenant,
}

impl Dimension {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "MODEL_ROUTE" => Dimension::ModelRoute,
            "TOOL" => Dimension::Tool,
            "AGENT" => Dimension::Agent,
            "BINDING" => Dimension::Binding,
            "TENANT" => Dimension::Tenant,
            _ => return None,
        })
    }

    fn wire(self) -> &'static str {
        match self {
            Dimension::ModelRoute => "MODEL_ROUTE",
            Dimension::Tool => "TOOL",
            Dimension::Agent => "AGENT",
            Dimension::Binding => "BINDING",
            Dimension::Tenant => "TENANT",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Dimension::ModelRoute => "route",
            Dimension::Tool => "tool",
            Dimension::Agent => "agent",
            Dimension::Binding => "binding",
            Dimension::Tenant => "tenant",
        }
    }

    /// TOOL、AGENT、BINDING 只在 Tenant 范围；TENANT 只在平台范围。
    fn allowed(self, platform: bool) -> bool {
        match self {
            Dimension::ModelRoute => true,
            Dimension::Tenant => platform,
            Dimension::Tool | Dimension::Agent | Dimension::Binding => !platform,
        }
    }
}

/// 模型调用的呈现状态：2xx 且无错误为成功；401/403 是网关准入拒绝；记了错误或非 2xx 为失败。
/// 既无 HTTP 状态也无错误的 request log 没有记下任何应答（例如上游超时后连接被断开），
/// 是结果不明，计入 DD-134(3)④ 的结果不明数，不得计为成功（AGENTS.md 第 15 条）。
pub(crate) fn model_outcome(http_status: Option<i64>, error: Option<&str>) -> Outcome {
    match (http_status, error.filter(|e| !e.is_empty())) {
        (Some(401 | 403), _) => Outcome::Denied,
        (Some(status), None) if (200..300).contains(&status) => Outcome::Succeeded,
        (None, None) => Outcome::Unknown,
        _ => Outcome::Failed,
    }
}

/// 工具子 ActionExecution 的呈现状态（准入 → 派发 → 终态审计）。
pub(crate) fn tool_outcome(gate: &str, dispatch: &str, failed: bool) -> Outcome {
    match gate {
        "DENIED" | "REVOKED" | "EXPIRED" => return Outcome::Denied,
        "EVALUATING" | "WAITING" => return Outcome::Running,
        _ => {}
    }
    match dispatch {
        "UNKNOWN" => Outcome::Unknown,
        "NOT_DISPATCHED" => Outcome::Running,
        "ABORTED" => Outcome::Failed,
        _ if failed => Outcome::Failed,
        _ => Outcome::Succeeded,
    }
}

/// `usage_event.settlement_status` 集合 → OperationUsageState；空集合是 BILLING_UNAVAILABLE。
pub(crate) fn usage_state(statuses: &[String]) -> &'static str {
    if statuses.is_empty() {
        "BILLING_UNAVAILABLE"
    } else if statuses.iter().any(|s| s == "UNKNOWN") {
        "UNKNOWN"
    } else if statuses.iter().any(|s| s == "FAILED") {
        "FAILED"
    } else if statuses
        .iter()
        .any(|s| s == "PENDING_PUBLISH" || s == "ACCEPTED")
    {
        "SETTLEMENT_PENDING"
    } else {
        "COMMITTED"
    }
}

/// `model:<requestLogId>` 或 `tool:<ActionExecution>`。
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CallId {
    Model(String),
    Tool(Uuid),
}

pub(crate) fn parse_call_id(value: &str) -> Option<CallId> {
    if let Some(id) = value.strip_prefix("model:") {
        let valid = !id.is_empty()
            && id.len() <= 128
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.');
        return valid.then(|| CallId::Model(id.to_owned()));
    }
    value
        .strip_prefix("tool:")
        .and_then(|id| Uuid::parse_str(id).ok())
        .map(CallId::Tool)
}

// ---------------------------------------------------------------------------
// gateway user → Tenant / Installation / binding
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Attribution {
    pub tenant: Uuid,
    pub workspace: Option<Uuid>,
    pub installation: Option<Uuid>,
    pub agent_name: Option<String>,
    pub binding: Option<Uuid>,
}

type AttributionRow = (
    Uuid,
    Uuid,
    Option<Uuid>,
    Option<Uuid>,
    Option<String>,
    Option<Uuid>,
    Option<Uuid>,
);

/// Core 已登记的 gateway 身份：Installation 模型 key 的 ServicePrincipal 与 binding 的
/// ServicePrincipal（DD-128）。`tenant=None` 时为全部（平台范围只用其 Tenant 归属）。
pub(crate) async fn gateway_users(
    pool: &sqlx::PgPool,
    tenant: Option<Uuid>,
) -> Result<HashMap<String, Attribution>, Refusal> {
    let rows: Vec<AttributionRow> = sqlx::query_as(
        "select p.id,p.tenant_id,i.workspace_id,amb.installation_resource_id,d.display_name,ab.id,ab.workspace_id
         from identity.principal p
         left join catalog.agent_model_binding amb on amb.gateway_principal_id=p.id
         left join catalog.agent_installation i on i.resource_id=amb.installation_resource_id
         left join catalog.agent_definition d on d.resource_id=i.agent_resource_id
         left join catalog.application_binding ab on ab.service_principal_id=p.id and ab.tenant_id=p.tenant_id
         where ($1::uuid is null or p.tenant_id=$1)
           and (amb.gateway_principal_id is not null or ab.id is not null)",
    )
    .bind(tenant)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(principal, tenant, inst_ws, installation, agent_name, binding, binding_ws)| {
                (
                    principal.to_string(),
                    Attribution {
                        tenant,
                        workspace: inst_ws.or(binding_ws),
                        installation,
                        agent_name,
                        binding,
                    },
                )
            },
        )
        .collect())
}

// ---------------------------------------------------------------------------
// request log
// ---------------------------------------------------------------------------

/// 模型入口 listener（上游 LLM 本地 listener 的固定名称，SF-AGW-31）。
const MODEL_LISTENER: &str = "llm";
/// 只在 Gateway 解析出模型请求时才有的属性及其全部取值（SF-AGW-31）。
const MODEL_OPERATION: (&str, [&str; 2]) = ("gen_ai.operation.name", ["chat", "embeddings"]);

/// 一页检索请求体：只取元数据与属性（gateway user），不取 payload。检索条件恒含
/// 模型调用判定（DD-134(3)①）：平台范围同样不把其他流量计为模型调用。
pub(crate) fn search_body(
    window: &Window,
    users: Option<&[String]>,
    cursor: Option<&str>,
) -> Value {
    let mut filters = json!({"attributes":{"listener":[MODEL_LISTENER],
        MODEL_OPERATION.0: MODEL_OPERATION.1}});
    if let Some(users) = users {
        filters["attributes"]["agentgateway.user"] = json!(users);
    }
    let mut body = json!({"limit":LOG_PAGE,"timeRange":{"from":rfc3339(window.from),"to":rfc3339(window.to)},
        "filters":filters,"includeAttributes":true});
    if let Some(cursor) = cursor {
        body["cursor"] = json!(cursor);
    }
    body
}

/// request log 的元数据部分；prompt 预览、turn、payload 与其余属性一律不保留。
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LogEntry {
    pub id: String,
    pub started: DateTime<Utc>,
    pub completed: Option<DateTime<Utc>>,
    pub duration_ms: Option<i64>,
    pub trace_id: Option<String>,
    pub http_status: Option<i64>,
    pub error: Option<String>,
    pub provider: Option<String>,
    pub request_model: Option<String>,
    pub response_model: Option<String>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
    pub user: Option<String>,
}

pub(crate) fn parse_log(value: &Value) -> Option<LogEntry> {
    let time = |field: &str| {
        value
            .get(field)
            .and_then(Value::as_str)
            .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
            .map(|t| t.with_timezone(&Utc))
    };
    let text = |pointer: &str| {
        value
            .pointer(pointer)
            .and_then(Value::as_str)
            .map(str::to_owned)
    };
    Some(LogEntry {
        id: value.get("id")?.as_str()?.to_owned(),
        started: time("startedAt")?,
        completed: time("completedAt"),
        duration_ms: value.get("durationMs").and_then(Value::as_i64),
        trace_id: text("/traceId"),
        http_status: value.get("httpStatus").and_then(Value::as_i64),
        error: text("/error"),
        provider: text("/genAi/providerName"),
        request_model: text("/genAi/requestModel"),
        response_model: text("/genAi/responseModel"),
        input_tokens: value.pointer("/usage/inputTokens").and_then(Value::as_i64),
        output_tokens: value.pointer("/usage/outputTokens").and_then(Value::as_i64),
        total_tokens: value.pointer("/usage/totalTokens").and_then(Value::as_i64),
        user: value
            .get("attributes")
            .and_then(|attributes| attributes.get("agentgateway.user"))
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
}

/// 按窗口检索 request log，直到没有下一页或达到扫描上限。`Err` 表示日志不可读。
pub(crate) async fn search_logs(
    gateway: &crate::model_route::Gateway,
    window: &Window,
    users: Option<&[String]>,
) -> Result<(Vec<LogEntry>, bool), Refusal> {
    let mut entries = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let body = search_body(window, users, cursor.as_deref());
        let page = gateway
            .admin_post(&["api", "logs", "search"], &body)
            .await?;
        let logs = page
            .get("logs")
            .and_then(Value::as_array)
            .ok_or_else(|| unavailable("request log"))?;
        for log in logs {
            entries.push(parse_log(log).ok_or_else(|| unavailable("request log shape"))?);
        }
        if entries.len() >= MODEL_SCAN_LIMIT {
            entries.truncate(MODEL_SCAN_LIMIT);
            return Ok((entries, true));
        }
        cursor = page
            .get("nextCursor")
            .and_then(Value::as_str)
            .map(str::to_owned);
        if cursor.is_none() || logs.is_empty() {
            return Ok((entries, false));
        }
    }
}

/// 以 request log ID 读取 durable usage 结算状态。
pub(crate) async fn usage_states(
    pool: &sqlx::PgPool,
    ids: &[String],
) -> Result<HashMap<String, Vec<String>>, Refusal> {
    let uuids: Vec<Uuid> = ids
        .iter()
        .filter_map(|id| Uuid::parse_str(id).ok())
        .collect();
    if uuids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<(Uuid, Vec<String>)> = sqlx::query_as(
        "select source_id,array_agg(settlement_status) from outbox.usage_event
         where source_type='GATEWAY_DURABLE_USAGE' and source_id=any($1) group by source_id",
    )
    .bind(uuids)
    .fetch_all(pool)
    .await?;
    let mut by_id: HashMap<String, Vec<String>> = HashMap::new();
    for (id, statuses) in rows {
        // request log ID 的原文大小写可能与 uuid 文本不同：两种写法都可查。
        by_id.insert(id.to_string(), statuses);
    }
    Ok(ids
        .iter()
        .filter_map(|id| {
            let key = Uuid::parse_str(id).ok()?.to_string();
            by_id
                .get(&key)
                .map(|statuses| (id.clone(), statuses.clone()))
        })
        .collect())
}

fn put(view: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    if let Some(value) = value {
        view.insert(key.into(), value);
    }
}

/// 模型调用归属的路由键（DD-134(3)④ 的模型路由维度）。`llm_route.create` 以 route 的原生 ID
/// 命名其 provider、model 与 virtualModel 投影，request log 的 `genAi.providerName` 因此就是
/// route 的原生 ID；按它匹配 Core 登记的 `llm_route` Resource，同名模型的多条 route 不合并。
/// 非 Core 投影的原生 route 以请求模型名登记原生 ID 时退而按请求模型匹配；都匹配不到时
/// 键取 provider（或请求模型），不映射到任何 Resource。
pub(crate) fn route_key(entry: &LogEntry, route_resources: &HashMap<String, Uuid>) -> String {
    [entry.provider.as_ref(), entry.request_model.as_ref()]
        .into_iter()
        .flatten()
        .find(|name| route_resources.contains_key(*name))
        .or(entry.provider.as_ref())
        .or(entry.request_model.as_ref())
        .cloned()
        .unwrap_or_else(|| UNATTRIBUTED.into())
}

/// request log 条目 → 记录；平台范围只填 Gateway 原生字段与 Tenant 归属。
pub(crate) fn model_record(
    entry: &LogEntry,
    attribution: Option<&Attribution>,
    usage: Option<&Vec<String>>,
    route_resources: &HashMap<String, Uuid>,
    platform: bool,
) -> Record {
    let outcome = model_outcome(entry.http_status, entry.error.as_deref());
    let route = route_key(entry, route_resources);
    let usage_state = usage_state(usage.map(Vec::as_slice).unwrap_or(&[]));
    let mut view = Map::new();
    view.insert("callId".into(), json!(format!("model:{}", entry.id)));
    view.insert("kind".into(), json!("MODEL"));
    view.insert("startedAt".into(), json!(rfc3339(entry.started)));
    view.insert("outcome".into(), json!(outcome.wire()));
    put(
        &mut view,
        "completedAt",
        entry.completed.map(|t| json!(rfc3339(t))),
    );
    put(&mut view, "durationMs", entry.duration_ms.map(Value::from));
    put(&mut view, "httpStatus", entry.http_status.map(Value::from));
    put(&mut view, "tenantId", attribution.map(|a| json!(a.tenant)));
    if route != UNATTRIBUTED {
        view.insert("modelRouteKey".into(), json!(route));
    }
    put(
        &mut view,
        "modelRouteResourceId",
        route_resources.get(&route).map(|id| json!(id)),
    );
    put(
        &mut view,
        "provider",
        entry.provider.clone().map(Value::from),
    );
    put(
        &mut view,
        "model",
        entry
            .response_model
            .clone()
            .or_else(|| entry.request_model.clone())
            .map(Value::from),
    );
    put(
        &mut view,
        "inputTokens",
        entry.input_tokens.map(Value::from),
    );
    put(
        &mut view,
        "outputTokens",
        entry.output_tokens.map(Value::from),
    );
    put(
        &mut view,
        "totalTokens",
        entry.total_tokens.map(Value::from),
    );
    view.insert("usageState".into(), json!(usage_state));
    view.insert("requestLogId".into(), json!(entry.id));
    put(
        &mut view,
        "traceId",
        entry.trace_id.clone().map(Value::from),
    );
    if !platform {
        if let Some(attribution) = attribution {
            put(
                &mut view,
                "workspaceId",
                attribution.workspace.map(|w| json!(w)),
            );
            put(
                &mut view,
                "agentInstallationResourceId",
                attribution.installation.map(|i| json!(i)),
            );
            put(
                &mut view,
                "agentName",
                attribution.agent_name.clone().map(Value::from),
            );
            put(
                &mut view,
                "applicationBindingId",
                attribution.binding.map(|b| json!(b)),
            );
        }
    }
    let mut labels = BTreeMap::new();
    if let Some(model) = entry
        .response_model
        .as_ref()
        .or(entry.request_model.as_ref())
    {
        let label = match &entry.provider {
            Some(provider) => format!("{provider}/{model}"),
            None => model.clone(),
        };
        labels.insert("route", label);
    }
    if !platform {
        if let Some(name) = attribution.and_then(|a| a.agent_name.clone()) {
            labels.insert("agent", name);
        }
    }
    Record {
        kind: Kind::Model,
        call_id: format!("model:{}", entry.id),
        started: entry.started,
        duration_ms: entry.duration_ms,
        outcome,
        billing_unavailable: usage_state == "BILLING_UNAVAILABLE",
        input_tokens: entry.input_tokens.unwrap_or(0),
        output_tokens: entry.output_tokens.unwrap_or(0),
        total_tokens: entry.total_tokens.unwrap_or(0),
        route: Some(route),
        tool: None,
        agent: if platform {
            None
        } else {
            attribution
                .and_then(|a| a.installation)
                .map(|i| i.to_string())
        },
        binding: if platform {
            None
        } else {
            attribution.and_then(|a| a.binding).map(|b| b.to_string())
        },
        tenant: attribution.map(|a| a.tenant.to_string()),
        labels,
        view: Value::Object(view),
    }
}

/// 本范围的模型调用：`(记录, truncated, modelLogAvailable)`。
pub(crate) async fn model_records(
    state: &BffState,
    caller: &Caller,
    window: &Window,
    workspace: Option<Uuid>,
) -> Result<(Vec<Record>, bool, bool), Refusal> {
    let tenant = (!caller.platform).then_some(caller.ctx.tenant_id);
    let users = gateway_users(&state.pool, tenant).await?;
    let filter: Option<Vec<String>> = if caller.platform {
        None
    } else {
        let mut ids: Vec<String> = users
            .iter()
            .filter(|(_, a)| workspace.is_none() || a.workspace == workspace)
            .map(|(id, _)| id.clone())
            .collect();
        ids.sort();
        if ids.is_empty() {
            return Ok((Vec::new(), false, true));
        }
        Some(ids)
    };
    let Ok(gateway) = crate::model_route::Gateway::from_env() else {
        return Ok((Vec::new(), false, false));
    };
    let (entries, truncated) = match search_logs(&gateway, window, filter.as_deref()).await {
        Ok(found) => found,
        Err(Refusal::Unavailable(error)) => {
            tracing::warn!(%error, "网关 request log 不可读，模型调用计数缺失");
            return Ok((Vec::new(), false, false));
        }
        Err(error) => return Err(error),
    };
    let ids: Vec<String> = entries.iter().map(|e| e.id.clone()).collect();
    let usage = usage_states(&state.pool, &ids).await?;
    let route_resources = route_resources(&state.pool, tenant, &entries).await?;
    let own = caller.ctx.tenant_id.to_string();
    let records = entries
        .iter()
        .map(|entry| {
            let attribution = entry.user.as_ref().and_then(|user| users.get(user));
            model_record(
                entry,
                attribution,
                usage.get(&entry.id),
                &route_resources,
                caller.platform,
            )
        })
        // Tenant 范围的检索已按本 Tenant gateway user 过滤；这里再核一次归属。
        .filter(|record| caller.platform || record.tenant.as_deref() == Some(own.as_str()))
        .collect();
    Ok((records, truncated, true))
}

/// request log 的请求模型名 → 本 Tenant 的 llm_route Resource（route 的 native ID）。
pub(crate) async fn route_resources(
    pool: &sqlx::PgPool,
    tenant: Option<Uuid>,
    entries: &[LogEntry],
) -> Result<HashMap<String, Uuid>, Refusal> {
    let mut names: Vec<String> = entries
        .iter()
        .flat_map(|e| [e.provider.clone(), e.request_model.clone()])
        .flatten()
        .collect();
    names.sort();
    names.dedup();
    if names.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<(Uuid, String)> = sqlx::query_as(
        "select id,native_id from catalog.resource
         where type_key='llm_route' and application_binding_id is null and native_id=any($1)
           and ($2::uuid is null or tenant_id=$2)",
    )
    .bind(names)
    .bind(tenant)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id, native)| (native, id)).collect())
}

// ---------------------------------------------------------------------------
// 工具调用（Tenant 范围）
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
pub(crate) struct ToolRow {
    id: Uuid,
    operation_id: Uuid,
    workspace_id: Option<Uuid>,
    gate_state: String,
    dispatch_state: String,
    reason_code: Option<String>,
    created_at: DateTime<Utc>,
    tool_resource_id: Option<Uuid>,
    tool_name: Option<String>,
    tool_source: Option<String>,
    installation_resource_id: Option<Uuid>,
    agent_name: Option<String>,
    component_binding_id: Option<Uuid>,
    intent_at: Option<DateTime<Utc>>,
    terminal_at: Option<DateTime<Utc>>,
    failed: bool,
}

/// Agent 工具调用的子 ActionExecution：参数带 `toolResourceId` 与 `invocationId`，
/// 父为 `agent.invoke`（DD-105/122）。子动作的审计键为 `<op>:child:<ae>:<stage>`。
pub(crate) const TOOL_SELECT: &str = "select a.id,a.operation_id,a.workspace_id,a.gate_state,a.dispatch_state,a.reason_code,a.created_at,
       t.resource_id as tool_resource_id,t.name as tool_name,t.source as tool_source,
       inv.installation_resource_id,d.display_name as agent_name,a.component_binding_id,
       ev.intent_at,ev.terminal_at,coalesce(ev.failed,false) as failed
     from admission.action_execution a
     join catalog.agent_invocation inv on inv.id::text=a.parameters->>'invocationId' and inv.tenant_id=a.tenant_id
     left join catalog.tool_definition t on t.resource_id::text=a.parameters->>'toolResourceId'
     left join catalog.agent_installation i on i.resource_id=inv.installation_resource_id
     left join catalog.agent_definition d on d.resource_id=i.agent_resource_id
     left join lateral (
       select min(e.occurred_at) filter (where e.event_type='INTENT') as intent_at,
              max(e.occurred_at) filter (where e.event_type not in ('INTENT','DECISION')) as terminal_at,
              bool_or(e.result_code in ('FAILED','REJECTED','ERROR','TIMED_OUT','ABORTED')) as failed
       from audit.audit_event e
       where e.tenant_id=a.tenant_id and e.operation_id=a.operation_id
         and e.event_key like a.operation_id::text || ':child:' || a.id::text || ':%'
     ) ev on true
     where a.tenant_id=$1 and a.parent_action_execution_id is not null
       and a.parameters ? 'toolResourceId' and a.parameters ? 'invocationId'";

pub(crate) fn tool_record(row: ToolRow) -> Record {
    let outcome = tool_outcome(&row.gate_state, &row.dispatch_state, row.failed);
    let start = row.intent_at.unwrap_or(row.created_at);
    let completed = row
        .terminal_at
        .filter(|_| matches!(outcome, Outcome::Succeeded | Outcome::Failed));
    let duration = completed
        .map(|t| (t - start).num_milliseconds())
        .filter(|ms| *ms >= 0);
    let mut view = Map::new();
    view.insert("callId".into(), json!(format!("tool:{}", row.id)));
    view.insert("kind".into(), json!("TOOL"));
    view.insert("startedAt".into(), json!(rfc3339(start)));
    view.insert("outcome".into(), json!(outcome.wire()));
    put(
        &mut view,
        "completedAt",
        completed.map(|t| json!(rfc3339(t))),
    );
    put(&mut view, "durationMs", duration.map(Value::from));
    put(
        &mut view,
        "reasonCode",
        row.reason_code
            .as_deref()
            .filter(|code| crate::governance::parse::<ReasonCode>(code).is_some())
            .map(Value::from),
    );
    put(&mut view, "workspaceId", row.workspace_id.map(|w| json!(w)));
    put(
        &mut view,
        "toolResourceId",
        row.tool_resource_id.map(|t| json!(t)),
    );
    put(
        &mut view,
        "toolName",
        row.tool_name.clone().map(Value::from),
    );
    put(
        &mut view,
        "toolSource",
        row.tool_source
            .clone()
            .filter(|s| {
                s == "PLATFORM_NATIVE" || s == "APPLICATION" || s == crate::mcp_connection::SOURCE
            })
            .map(Value::from),
    );
    put(
        &mut view,
        "agentInstallationResourceId",
        row.installation_resource_id.map(|i| json!(i)),
    );
    put(
        &mut view,
        "agentName",
        row.agent_name.clone().map(Value::from),
    );
    put(
        &mut view,
        "applicationBindingId",
        row.component_binding_id.map(|b| json!(b)),
    );
    view.insert("operationId".into(), json!(row.operation_id));
    view.insert("actionExecutionId".into(), json!(row.id));
    let mut labels = BTreeMap::new();
    if let Some(name) = &row.tool_name {
        labels.insert("tool", name.clone());
    }
    if let Some(name) = &row.agent_name {
        labels.insert("agent", name.clone());
    }
    Record {
        kind: Kind::Tool,
        call_id: format!("tool:{}", row.id),
        started: start,
        duration_ms: duration,
        outcome,
        billing_unavailable: false,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        route: None,
        tool: row.tool_resource_id.map(|t| t.to_string()),
        agent: row.installation_resource_id.map(|i| i.to_string()),
        binding: row.component_binding_id.map(|b| b.to_string()),
        tenant: None,
        labels,
        view: Value::Object(view),
    }
}

/// 本 Tenant、本窗口的工具调用：`(记录, truncated)`。
pub(crate) async fn tool_records(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    window: &Window,
    workspace: Option<Uuid>,
) -> Result<(Vec<Record>, bool), Refusal> {
    let rows: Vec<ToolRow> = sqlx::query_as(&format!(
        "{TOOL_SELECT} and a.created_at>=$2 and a.created_at<$3
           and ($4::uuid is null or a.workspace_id=$4)
         order by a.created_at desc limit $5"
    ))
    .bind(tenant)
    .bind(window.from)
    .bind(window.to)
    .bind(workspace)
    .bind(TOOL_SCAN_LIMIT + 1)
    .fetch_all(pool)
    .await?;
    let truncated = rows.len() as i64 > TOOL_SCAN_LIMIT;
    let records = rows
        .into_iter()
        .take(TOOL_SCAN_LIMIT as usize)
        .map(tool_record)
        .collect();
    Ok((records, truncated))
}

/// 本范围、本窗口的全部记录：`(记录, truncated, modelLogAvailable)`。
async fn records(
    state: &BffState,
    caller: &Caller,
    window: &Window,
    workspace: Option<Uuid>,
) -> Result<(Vec<Record>, bool, bool), Refusal> {
    let (mut all, mut truncated, available) =
        model_records(state, caller, window, workspace).await?;
    if !caller.platform {
        let (tools, tool_truncated) =
            tool_records(&state.pool, caller.ctx.tenant_id, window, workspace).await?;
        all.extend(tools);
        truncated |= tool_truncated;
    }
    all.sort_by(|a, b| b.started.cmp(&a.started).then(b.call_id.cmp(&a.call_id)));
    Ok((all, truncated, available))
}

// ---------------------------------------------------------------------------
// 聚合
// ---------------------------------------------------------------------------

#[derive(Default)]
pub(crate) struct Counters {
    pub requests: i64,
    succeeded: i64,
    pub failed: i64,
    pub denied: i64,
    running: i64,
    unknown: i64,
    billing_unavailable: i64,
    input_tokens: i64,
    output_tokens: i64,
    pub total_tokens: i64,
    model_ms: Vec<i64>,
    tool_ms: Vec<i64>,
}

impl Counters {
    pub(crate) fn add(&mut self, record: &Record) {
        self.requests += 1;
        match record.outcome {
            Outcome::Succeeded => self.succeeded += 1,
            Outcome::Failed => self.failed += 1,
            Outcome::Denied => self.denied += 1,
            Outcome::Running => self.running += 1,
            Outcome::Unknown => self.unknown += 1,
        }
        if record.billing_unavailable {
            self.billing_unavailable += 1;
        }
        self.input_tokens += record.input_tokens;
        self.output_tokens += record.output_tokens;
        self.total_tokens += record.total_tokens;
        if let Some(ms) = record.duration_ms {
            match record.kind {
                Kind::Model => self.model_ms.push(ms),
                Kind::Tool => self.tool_ms.push(ms),
            }
        }
    }

    /// 已排序后的 P95（模型、工具）。
    pub(crate) fn p95(&mut self) -> (Option<i64>, Option<i64>) {
        self.model_ms.sort_unstable();
        self.tool_ms.sort_unstable();
        (
            percentile(&self.model_ms, 0.95),
            percentile(&self.tool_ms, 0.95),
        )
    }

    fn json(mut self) -> Value {
        self.model_ms.sort_unstable();
        self.tool_ms.sort_unstable();
        let mut value = json!({"requests":self.requests,"succeeded":self.succeeded,"failed":self.failed,
            "denied":self.denied,"running":self.running,"unknown":self.unknown,
            "billingUnavailable":self.billing_unavailable,"inputTokens":self.input_tokens,
            "outputTokens":self.output_tokens,"totalTokens":self.total_tokens});
        for (key, values, q) in [
            ("modelP50Ms", &self.model_ms, 0.5),
            ("modelP95Ms", &self.model_ms, 0.95),
            ("toolP50Ms", &self.tool_ms, 0.5),
            ("toolP95Ms", &self.tool_ms, 0.95),
        ] {
            if let Some(ms) = percentile(values, q) {
                value[key] = json!(ms);
            }
        }
        value
    }
}

type Row = (Counters, Option<Kind>, Option<String>);

/// 聚合为 `(totals, rows, buckets)`，均为 `GatewayStats` 对应部分的 JSON。
pub(crate) fn aggregate(
    records: &[Record],
    window: &Window,
    dimension: Dimension,
    labels: &HashMap<String, String>,
) -> (Value, Vec<Value>, Vec<Value>) {
    let mut totals = Counters::default();
    let mut rows: BTreeMap<String, Row> = BTreeMap::new();
    let count = window.bucket_count();
    let mut buckets = vec![(0i64, 0i64, 0i64, 0i64); count];
    for record in records {
        totals.add(record);
        if let Some(index) = window.bucket(record.started).filter(|i| *i < count) {
            let bucket = &mut buckets[index];
            bucket.0 += 1;
            if record.outcome == Outcome::Failed {
                bucket.1 += 1;
            }
            if record.outcome == Outcome::Denied {
                bucket.2 += 1;
            }
            bucket.3 += record.total_tokens;
        }
        if let Some(key) = record.key(dimension) {
            let entry = rows.entry(key.to_owned()).or_insert_with(|| {
                let label = labels
                    .get(key)
                    .cloned()
                    .or_else(|| record.labels.get(dimension.label()).cloned());
                (Counters::default(), Some(record.kind), label)
            });
            if entry.1 != Some(record.kind) {
                entry.1 = None;
            }
            entry.0.add(record);
        }
    }
    let mut rows: Vec<(String, Row)> = rows.into_iter().collect();
    rows.sort_by(|a, b| b.1 .0.requests.cmp(&a.1 .0.requests).then(a.0.cmp(&b.0)));
    let rows = rows
        .into_iter()
        .map(|(key, (counters, kind, label))| {
            let mut row = json!({"key":key,"counters":counters.json()});
            if let Some(label) = label {
                row["label"] = json!(label);
            }
            if let Some(kind) = kind {
                row["kind"] = json!(match kind {
                    Kind::Model => "MODEL",
                    Kind::Tool => "TOOL",
                });
            }
            row
        })
        .collect();
    let buckets = buckets
        .into_iter()
        .enumerate()
        .map(|(index, (requests, failed, denied, tokens))| {
            let start = window.from + Duration::seconds(window.bucket_seconds * index as i64);
            json!({"start":rfc3339(start),"requests":requests,"failed":failed,"denied":denied,"totalTokens":tokens})
        })
        .collect();
    (totals.json(), rows, buckets)
}

/// 维度键的展示名：binding 取组件类型；Tenant（平台范围）只用 ID，不读取名称（DD-134(2)①）。
async fn dimension_labels(
    pool: &sqlx::PgPool,
    caller: &Caller,
    dimension: Dimension,
    records: &[Record],
) -> Result<HashMap<String, String>, Refusal> {
    let mut ids: Vec<Uuid> = records
        .iter()
        .filter_map(|r| r.key(dimension))
        .filter_map(|key| Uuid::parse_str(key).ok())
        .collect();
    ids.sort();
    ids.dedup();
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<(Uuid, String)> = match dimension {
        Dimension::Binding => {
            sqlx::query_as(
                "select id,component_type_key from catalog.application_binding where id=any($1) and tenant_id=$2",
            )
            .bind(&ids)
            .bind(caller.ctx.tenant_id)
            .fetch_all(pool)
            .await?
        }
        // 平台范围只呈现 Tenant 归属 ID（DD-134(2)①），不读取业务 Tenant 的名称：行标签即 ID。
        _ => Vec::new(),
    };
    Ok(rows
        .into_iter()
        .map(|(id, name)| (id.to_string(), name))
        .collect())
}

fn scope_wire(caller: &Caller) -> &'static str {
    if caller.platform {
        "PLATFORM"
    } else {
        "TENANT"
    }
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StatsQuery {
    from: Option<String>,
    to: Option<String>,
    dimension: Option<String>,
    workspace_id: Option<Uuid>,
}

async fn stats_view(
    state: &BffState,
    caller: &Caller,
    query: StatsQuery,
) -> Result<GatewayStats, Refusal> {
    let dimension = match query.dimension.as_deref() {
        None => Dimension::ModelRoute,
        Some(value) => Dimension::parse(value).ok_or_else(invalid)?,
    };
    if !dimension.allowed(caller.platform) {
        return Err(invalid());
    }
    require_audit(state, caller, query.workspace_id).await?;
    let window = window(query.from.as_deref(), query.to.as_deref(), Utc::now())?;
    let (records, truncated, available) =
        records(state, caller, &window, query.workspace_id).await?;
    let labels = dimension_labels(&state.pool, caller, dimension, &records).await?;
    let (totals, rows, buckets) = aggregate(&records, &window, dimension, &labels);
    let mut value = json!({"scope":scope_wire(caller),
        "from":rfc3339(window.from),"to":rfc3339(window.to),"bucketSeconds":window.bucket_seconds,
        "dimension":dimension.wire(),"truncated":truncated,"modelLogAvailable":available,
        "totals":totals,"rows":rows,"buckets":buckets});
    if let Some(workspace) = query.workspace_id {
        value["workspaceId"] = json!(workspace);
    }
    serde_json::from_value(value).map_err(|e| Refusal::Unavailable(format!("GatewayStats: {e}")))
}

/// `GET /api/v1/gateway/stats`
pub(crate) async fn stats(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(query): Query<StatsQuery>,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    match stats_view(&state, &caller, query).await {
        Ok(view) => Json(view).into_response(),
        Err(error) => error.respond(None),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CallsQuery {
    from: Option<String>,
    to: Option<String>,
    kind: Option<String>,
    outcome: Option<String>,
    dimension: Option<String>,
    key: Option<String>,
    workspace_id: Option<Uuid>,
    cursor: Option<String>,
    limit: Option<usize>,
}

/// 过滤与游标分页：游标是上一页最后一条的 `callId`，只在同一查询条件内继续。
pub(crate) fn page<'a>(
    records: &'a [Record],
    kind: Option<Kind>,
    outcome: Option<Outcome>,
    filter: Option<(Dimension, &str)>,
    cursor: Option<&str>,
    limit: usize,
) -> Result<(Vec<&'a Record>, Option<String>), Refusal> {
    let matching: Vec<&Record> = records
        .iter()
        .filter(|r| kind.is_none_or(|k| r.kind == k))
        .filter(|r| outcome.is_none_or(|o| r.outcome == o))
        .filter(|r| filter.is_none_or(|(d, key)| r.key(d) == Some(key)))
        .collect();
    let start = match cursor {
        None => 0,
        Some(cursor) => {
            matching
                .iter()
                .position(|r| r.call_id == cursor)
                .ok_or_else(invalid)?
                + 1
        }
    };
    let slice: Vec<&Record> = matching.iter().skip(start).take(limit).copied().collect();
    let next = if start + slice.len() < matching.len() {
        slice.last().map(|r| r.call_id.clone())
    } else {
        None
    };
    Ok((slice, next))
}

async fn calls_view(
    state: &BffState,
    caller: &Caller,
    query: CallsQuery,
) -> Result<GatewayCallPage, Refusal> {
    let kind = match query.kind.as_deref() {
        None => None,
        Some("MODEL") => Some(Kind::Model),
        Some("TOOL") => Some(Kind::Tool),
        Some(_) => return Err(invalid()),
    };
    let outcome = query
        .outcome
        .as_deref()
        .map(|o| Outcome::parse(o).ok_or_else(invalid))
        .transpose()?;
    let filter = match (query.dimension.as_deref(), query.key.as_deref()) {
        (None, None) => None,
        (Some(dimension), Some(key)) => {
            let dimension = Dimension::parse(dimension).ok_or_else(invalid)?;
            if !dimension.allowed(caller.platform) {
                return Err(invalid());
            }
            Some((dimension, key))
        }
        _ => return Err(invalid()),
    };
    let limit = query.limit.unwrap_or(CALL_PAGE_DEFAULT);
    if limit == 0 || limit > CALL_PAGE_MAX {
        return Err(invalid());
    }
    require_audit(state, caller, query.workspace_id).await?;
    let window = window(query.from.as_deref(), query.to.as_deref(), Utc::now())?;
    let (records, truncated, available) =
        records(state, caller, &window, query.workspace_id).await?;
    let (calls, next) = page(
        &records,
        kind,
        outcome,
        filter,
        query.cursor.as_deref(),
        limit,
    )?;
    let mut value = json!({"scope":scope_wire(caller),
        "calls":calls.iter().map(|r| r.view.clone()).collect::<Vec<_>>(),
        "truncated":truncated,"modelLogAvailable":available});
    if let Some(next) = next {
        value["nextCursor"] = json!(next);
    }
    serde_json::from_value(value).map_err(|e| Refusal::Unavailable(format!("GatewayCallPage: {e}")))
}

/// `GET /api/v1/gateway/calls`
pub(crate) async fn calls(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(query): Query<CallsQuery>,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    match calls_view(&state, &caller, query).await {
        Ok(view) => Json(view).into_response(),
        Err(error) => error.respond(None),
    }
}

// ---------------------------------------------------------------------------
// 单次调用
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DetailQuery {
    workspace_id: Option<Uuid>,
}

#[derive(sqlx::FromRow)]
struct ExecutionRow {
    id: Uuid,
    operation_id: Uuid,
    action_key: String,
    action_version: i32,
    gate_state: String,
    dispatch_state: String,
    reason_code: Option<String>,
    parent_action_execution_id: Option<Uuid>,
    created_at: DateTime<Utc>,
    updated_at: Option<DateTime<Utc>>,
}

fn execution_json(row: &ExecutionRow) -> Value {
    let mut value = json!({"actionExecutionId":row.id,"operationId":row.operation_id,
        "actionKey":row.action_key,"actionVersion":row.action_version,
        "gateState":row.gate_state,"dispatchState":row.dispatch_state,
        "createdAt":rfc3339(row.created_at)});
    if let Some(code) = row
        .reason_code
        .as_deref()
        .filter(|code| crate::governance::parse::<ReasonCode>(code).is_some())
    {
        value["reasonCode"] = json!(code);
    }
    if let Some(parent) = row.parent_action_execution_id {
        value["parentActionExecutionId"] = json!(parent);
    }
    if let Some(updated) = row.updated_at {
        value["updatedAt"] = json!(rfc3339(updated));
    }
    value
}

/// 审计键中的子动作：`<op>:child:<ae>:<stage>`。
pub(crate) fn child_execution(event_key: &str) -> Option<Uuid> {
    let (_, rest) = event_key.split_once(":child:")?;
    let (id, _) = rest.split_once(':')?;
    Uuid::parse_str(id).ok()
}

type AuditRow = (Uuid, String, String, String, String, String, DateTime<Utc>);

async fn operation_audit(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    operation: Uuid,
    root: Option<Uuid>,
) -> Result<Vec<Value>, Refusal> {
    let rows: Vec<AuditRow> = sqlx::query_as(
        "select id,event_type,action_key,decision,result_code,event_key,occurred_at
         from audit.audit_event where tenant_id=$1 and operation_id=$2
         order by occurred_at,id limit 200",
    )
    .bind(tenant)
    .bind(operation)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(id, event_type, action_key, decision, result_code, key, at)| {
                let mut value = json!({"eventId":id,"eventType":event_type,"actionKey":action_key,
                "decision":decision,"resultCode":result_code,"occurredAt":rfc3339(at)});
                if let Some(ae) = child_execution(&key).or(root) {
                    value["actionExecutionId"] = json!(ae);
                }
                value
            },
        )
        .collect())
}

const EXECUTION_COLUMNS: &str =
    "id,operation_id,action_key,action_version,gate_state,dispatch_state,reason_code,
     parent_action_execution_id,created_at,updated_at";

fn not_found() -> Refusal {
    Refusal::Precondition(ReasonCode::TargetNotFound)
}

async fn model_detail(
    state: &BffState,
    caller: &Caller,
    log_id: &str,
    workspace: Option<Uuid>,
) -> Result<(Value, Option<Value>, Vec<Value>), Refusal> {
    let tenant = caller.ctx.tenant_id;
    let gateway =
        crate::model_route::Gateway::from_env().map_err(|_| unavailable("request log"))?;
    let found = gateway
        .admin_post(
            &["api", "logs", "get"],
            &json!({"id":log_id,"includePayload":false}),
        )
        .await?;
    let log = found
        .get("log")
        .filter(|log| !log.is_null())
        .ok_or_else(not_found)?;
    // get 不带属性：以同一 trace 与时间段的检索补出 gateway user 归属；该检索带模型调用
    // 判定，检索不到即不是模型调用（DD-134(3)①），不下钻。
    let mut entry = parse_log(log).ok_or_else(|| unavailable("request log shape"))?;
    let around = Window {
        from: entry.started - Duration::seconds(1),
        to: entry.completed.unwrap_or(entry.started) + Duration::seconds(1),
        bucket_seconds: 60,
    };
    let mut body = search_body(&around, None, None);
    if let Some(trace) = &entry.trace_id {
        body["filters"]["traceId"] = json!(trace);
    }
    let page = gateway
        .admin_post(&["api", "logs", "search"], &body)
        .await?;
    entry.user = page
        .get("logs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(parse_log)
        .find(|candidate| candidate.id == entry.id)
        .ok_or_else(not_found)?
        .user;
    let scoped = (!caller.platform).then_some(tenant);
    let users = gateway_users(&state.pool, scoped).await?;
    let attribution = entry.user.as_ref().and_then(|user| users.get(user));
    if !caller.platform
        && (attribution.map(|a| a.tenant) != Some(tenant)
            || workspace.is_some_and(|w| attribution.and_then(|a| a.workspace) != Some(w)))
    {
        return Err(not_found());
    }
    let usage = usage_states(&state.pool, std::slice::from_ref(&entry.id)).await?;
    let routes = route_resources(&state.pool, scoped, std::slice::from_ref(&entry)).await?;
    let record = model_record(
        &entry,
        attribution,
        usage.get(&entry.id),
        &routes,
        caller.platform,
    );
    if caller.platform {
        return Ok((record.view, None, Vec::new()));
    }
    // trace → AgentInvocation → agent.invoke ActionExecution（Codex 模型链）
    let execution: Option<ExecutionRow> = match &entry.trace_id {
        Some(trace) => {
            sqlx::query_as(&format!(
                "select {EXECUTION_COLUMNS} from admission.action_execution
                 where tenant_id=$1 and id=(select i.action_execution_id
                   from projection.agent_model_trace t join catalog.agent_invocation i on i.id=t.invocation_id
                   where t.trace_id=$2 and t.tenant_id=$1)"
            ))
            .bind(tenant)
            .bind(trace)
            .fetch_optional(&state.pool)
            .await?
        }
        None => None,
    };
    let mut view = record.view;
    let audit = match &execution {
        Some(row) => {
            view["operationId"] = json!(row.operation_id);
            view["actionExecutionId"] = json!(row.id);
            operation_audit(&state.pool, tenant, row.operation_id, Some(row.id)).await?
        }
        None => Vec::new(),
    };
    Ok((view, execution.as_ref().map(execution_json), audit))
}

async fn tool_detail(
    state: &BffState,
    caller: &Caller,
    ae: Uuid,
    workspace: Option<Uuid>,
) -> Result<(Value, Option<Value>, Vec<Value>), Refusal> {
    if caller.platform {
        return Err(not_found());
    }
    let tenant = caller.ctx.tenant_id;
    let row: ToolRow = sqlx::query_as(&format!("{TOOL_SELECT} and a.id=$2"))
        .bind(tenant)
        .bind(ae)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(not_found)?;
    if workspace.is_some_and(|w| row.workspace_id != Some(w)) {
        return Err(not_found());
    }
    let execution: ExecutionRow = sqlx::query_as(&format!(
        "select {EXECUTION_COLUMNS} from admission.action_execution where id=$1 and tenant_id=$2"
    ))
    .bind(ae)
    .bind(tenant)
    .fetch_one(&state.pool)
    .await?;
    let root: Option<Uuid> = sqlx::query_scalar(
        "select id from admission.action_execution
         where tenant_id=$1 and operation_id=$2 and parent_action_execution_id is null",
    )
    .bind(tenant)
    .bind(execution.operation_id)
    .fetch_optional(&state.pool)
    .await?;
    let audit = operation_audit(&state.pool, tenant, execution.operation_id, root).await?;
    Ok((
        tool_record(row).view,
        Some(execution_json(&execution)),
        audit,
    ))
}

async fn detail_view(
    state: &BffState,
    caller: &Caller,
    call_id: &str,
    workspace: Option<Uuid>,
) -> Result<GatewayCallDetail, Refusal> {
    let id = parse_call_id(call_id).ok_or_else(invalid)?;
    require_audit(state, caller, workspace).await?;
    let (call, execution, audit) = match id {
        CallId::Model(log_id) => model_detail(state, caller, &log_id, workspace).await?,
        CallId::Tool(ae) => tool_detail(state, caller, ae, workspace).await?,
    };
    let mut value = json!({"call":call,"auditEvents":audit});
    if let Some(execution) = execution {
        value["execution"] = execution;
    }
    serde_json::from_value(value)
        .map_err(|e| Refusal::Unavailable(format!("GatewayCallDetail: {e}")))
}

/// `GET /api/v1/gateway/calls/{call_id}`
pub(crate) async fn call_detail(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(call_id): Path<String>,
    Query(query): Query<DetailQuery>,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    match detail_view(&state, &caller, &call_id, query.workspace_id).await {
        Ok(view) => Json(view).into_response(),
        Err(error) => error.respond(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(text: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(text)
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn window_defaults_bounds_and_buckets() {
        let now = at("2026-10-21T12:00:00Z");
        let w = window(None, None, now).unwrap();
        assert_eq!(w.to, now);
        assert_eq!(w.from, at("2026-10-20T12:00:00Z"));
        assert_eq!(w.bucket_seconds, 3600);
        assert_eq!(w.bucket_count(), 24);
        assert_eq!(w.bucket(at("2026-10-20T12:59:59Z")), Some(0));
        assert_eq!(w.bucket(at("2026-10-21T12:00:00Z")), None);
        let short = window(Some("2026-10-21T11:50:00Z"), None, now).unwrap();
        assert_eq!(short.bucket_seconds, 60);
        assert!(window(Some("2026-10-10T00:00:00Z"), None, now).is_err());
        assert!(window(
            Some("2026-10-21T12:00:00Z"),
            Some("2026-10-21T11:00:00Z"),
            now
        )
        .is_err());
        assert!(window(Some("yesterday"), None, now).is_err());
    }

    #[test]
    fn nearest_rank_percentiles() {
        let values: Vec<i64> = (1..=100).collect();
        assert_eq!(percentile(&values, 0.5), Some(50));
        assert_eq!(percentile(&values, 0.95), Some(95));
        assert_eq!(percentile(&[7], 0.95), Some(7));
        assert_eq!(percentile(&[], 0.5), None);
    }

    #[test]
    fn call_ids_round_trip_and_reject_garbage() {
        assert_eq!(
            parse_call_id("model:01JABC-def_9"),
            Some(CallId::Model("01JABC-def_9".into()))
        );
        let ae = Uuid::new_v4();
        assert_eq!(parse_call_id(&format!("tool:{ae}")), Some(CallId::Tool(ae)));
        assert_eq!(parse_call_id("tool:not-a-uuid"), None);
        assert_eq!(parse_call_id("model:"), None);
        assert_eq!(parse_call_id("model:a/b"), None);
        assert_eq!(parse_call_id("other:1"), None);
    }

    #[test]
    fn outcomes() {
        assert_eq!(model_outcome(Some(200), None), Outcome::Succeeded);
        assert_eq!(model_outcome(Some(403), None), Outcome::Denied);
        assert_eq!(model_outcome(Some(502), Some("upstream")), Outcome::Failed);
        // 没有应答也没有错误：结果不明，不是成功（生产 wren binding 超时的 166 条 request log）
        assert_eq!(model_outcome(None, None), Outcome::Unknown);
        assert_eq!(model_outcome(None, Some("")), Outcome::Unknown);
        assert_eq!(model_outcome(None, Some("timeout")), Outcome::Failed);
        assert_eq!(
            model_outcome(Some(200), Some("stream reset")),
            Outcome::Failed
        );
        assert_eq!(
            tool_outcome("DENIED", "NOT_DISPATCHED", false),
            Outcome::Denied
        );
        assert_eq!(
            tool_outcome("WAITING", "NOT_DISPATCHED", false),
            Outcome::Running
        );
        assert_eq!(tool_outcome("ALLOWED", "UNKNOWN", false), Outcome::Unknown);
        assert_eq!(tool_outcome("ALLOWED", "DISPATCHED", true), Outcome::Failed);
        assert_eq!(
            tool_outcome("ALLOWED", "DISPATCHED", false),
            Outcome::Succeeded
        );
    }

    #[test]
    fn usage_states_never_show_zero() {
        assert_eq!(usage_state(&[]), "BILLING_UNAVAILABLE");
        assert_eq!(usage_state(&["COMMITTED".into()]), "COMMITTED");
        assert_eq!(
            usage_state(&["COMMITTED".into(), "ACCEPTED".into()]),
            "SETTLEMENT_PENDING"
        );
        assert_eq!(usage_state(&["UNKNOWN".into(), "FAILED".into()]), "UNKNOWN");
    }

    fn log(id: &str, user: Option<&str>, status: i64, ms: i64, model: &str) -> LogEntry {
        LogEntry {
            id: id.into(),
            started: at("2026-10-21T10:30:00Z"),
            completed: Some(at("2026-10-21T10:30:01Z")),
            duration_ms: Some(ms),
            trace_id: Some("0af7651916cd43dd8448eb211c80319c".into()),
            http_status: Some(status),
            error: None,
            provider: Some("openai".into()),
            request_model: Some(model.into()),
            response_model: Some("gpt-x".into()),
            input_tokens: Some(10),
            output_tokens: Some(5),
            total_tokens: Some(15),
            user: user.map(str::to_owned),
        }
    }

    #[test]
    fn log_metadata_is_parsed_without_prompt_or_payload() {
        let value = json!({"id":"l1","startedAt":"2026-10-21T10:30:00Z","completedAt":"2026-10-21T10:30:01Z",
            "durationMs":1000,"traceId":"t","httpStatus":200,"error":null,"promptPreview":"secret prompt",
            "turn":{"input":"user","output":"assistant"},
            "genAi":{"providerName":"openai","requestModel":"r1","responseModel":"m"},
            "usage":{"inputTokens":1,"outputTokens":2,"totalTokens":3},"cost":0.1,"hasPayload":true,
            "attributes":{"agentgateway.user":"u1","http.path":"/v1/responses"}});
        let entry = parse_log(&value).unwrap();
        assert_eq!(entry.user.as_deref(), Some("u1"));
        assert_eq!(entry.total_tokens, Some(3));
        let record = model_record(&entry, None, None, &HashMap::new(), true);
        let text = record.view.to_string();
        assert!(!text.contains("secret prompt"));
        assert!(!text.contains("http.path"));
        assert_eq!(record.view["usageState"], "BILLING_UNAVAILABLE");
        assert!(record.billing_unavailable);
    }

    #[test]
    fn platform_records_carry_only_gateway_facts_and_tenant() {
        let tenant = Uuid::new_v4();
        let installation = Uuid::new_v4();
        let attribution = Attribution {
            tenant,
            workspace: Some(Uuid::new_v4()),
            installation: Some(installation),
            agent_name: Some("研究助理".into()),
            binding: None,
        };
        let entry = log("l1", Some("u1"), 200, 900, "route-a");
        let usage = vec!["COMMITTED".to_owned()];
        let platform = model_record(
            &entry,
            Some(&attribution),
            Some(&usage),
            &HashMap::new(),
            true,
        );
        assert_eq!(platform.view["tenantId"], json!(tenant));
        assert!(platform.view.get("agentName").is_none());
        assert!(platform.view.get("agentInstallationResourceId").is_none());
        assert_eq!(platform.agent, None);
        assert_eq!(
            platform.key(Dimension::Tenant),
            Some(tenant.to_string().as_str())
        );
        let scoped = model_record(
            &entry,
            Some(&attribution),
            Some(&usage),
            &HashMap::new(),
            false,
        );
        assert_eq!(scoped.view["agentName"], "研究助理");
        assert_eq!(scoped.agent, Some(installation.to_string()));
        let unattributed = model_record(&entry, None, None, &HashMap::new(), true);
        assert_eq!(unattributed.key(Dimension::Tenant), Some(UNATTRIBUTED));
    }

    #[test]
    fn aggregation_separates_model_and_tool_latency_and_counts_outcomes() {
        let w = window(None, None, at("2026-10-21T12:00:00Z")).unwrap();
        let mut records: Vec<Record> = [(200, 100), (200, 300), (502, 50), (403, 10)]
            .iter()
            .enumerate()
            .map(|(i, (status, ms))| {
                model_record(
                    &log(&format!("l{i}"), None, *status, *ms, "route-a"),
                    None,
                    None,
                    &HashMap::new(),
                    false,
                )
            })
            .collect();
        let mut tool = records[0].clone();
        tool.kind = Kind::Tool;
        tool.call_id = "tool:x".into();
        tool.duration_ms = Some(5000);
        tool.route = None;
        tool.tool = Some("t1".into());
        tool.total_tokens = 0;
        tool.billing_unavailable = false;
        records.push(tool);
        let (totals, rows, buckets) =
            aggregate(&records, &w, Dimension::ModelRoute, &HashMap::new());
        assert_eq!(totals["requests"], 5);
        assert_eq!(totals["failed"], 1);
        assert_eq!(totals["denied"], 1);
        assert_eq!(totals["succeeded"], 3);
        assert_eq!(totals["billingUnavailable"], 4);
        assert_eq!(totals["modelP95Ms"], 300);
        assert_eq!(totals["toolP95Ms"], 5000);
        assert_eq!(rows.len(), 1, "tool records have no model route");
        // 未登记为 llm_route 的调用以 provider（route 原生 ID）为键，不按请求模型名合并
        assert_eq!(rows[0]["key"], "openai");
        assert_eq!(rows[0]["counters"]["requests"], 4);
        assert_eq!(rows[0]["label"], "openai/gpt-x");
        assert_eq!(rows[0]["kind"], "MODEL");
        assert_eq!(buckets.len(), 24);
        assert_eq!(buckets[22]["requests"], 5);
        assert_eq!(buckets[22]["totalTokens"], 60);
        let (_, by_tool, _) = aggregate(&records, &w, Dimension::Tool, &HashMap::new());
        assert_eq!(by_tool.len(), 1);
        assert_eq!(by_tool[0]["counters"]["toolP50Ms"], 5000);
        assert!(by_tool[0]["counters"].get("modelP50Ms").is_none());
    }

    /// 生产验收：模型统计只取模型入口 listener 上解析出模型请求的记录；平台范围（无
    /// gateway user 过滤）与 Tenant 范围同样带该判定，用户过滤叠加而不覆盖它。
    #[test]
    fn log_search_only_counts_model_calls_on_the_model_listener() {
        let window = Window {
            from: Utc::now() - Duration::hours(1),
            to: Utc::now(),
            bucket_seconds: 60,
        };
        let platform = search_body(&window, None, None);
        assert_eq!(
            platform["filters"]["attributes"],
            json!({"listener":["llm"],"gen_ai.operation.name":["chat","embeddings"]})
        );
        let users = vec!["p1".to_string()];
        let tenant = search_body(&window, Some(&users), Some("c"));
        assert_eq!(
            tenant["filters"]["attributes"],
            json!({"listener":["llm"],"gen_ai.operation.name":["chat","embeddings"],
                "agentgateway.user":["p1"]})
        );
        assert_eq!(tenant["cursor"], "c");
    }

    #[test]
    fn paging_continues_after_cursor_and_filters() {
        let records: Vec<Record> = (0..5)
            .map(|i| {
                model_record(
                    &log(
                        &format!("l{i}"),
                        None,
                        if i == 2 { 500 } else { 200 },
                        1,
                        "r",
                    ),
                    None,
                    None,
                    &HashMap::new(),
                    false,
                )
            })
            .collect();
        let (first, next) = page(&records, None, None, None, None, 2).unwrap();
        assert_eq!(first.len(), 2);
        assert_eq!(next.as_deref(), Some("model:l1"));
        let (second, next) = page(&records, None, None, None, next.as_deref(), 2).unwrap();
        assert_eq!(second[0].call_id, "model:l2");
        let (last, end) = page(&records, None, None, None, next.as_deref(), 2).unwrap();
        assert_eq!(last.len(), 1);
        assert_eq!(end, None);
        let (failed, _) = page(&records, None, Some(Outcome::Failed), None, None, 10).unwrap();
        assert_eq!(failed.len(), 1);
        let (by_route, _) = page(
            &records,
            Some(Kind::Model),
            None,
            Some((Dimension::ModelRoute, "openai")),
            None,
            10,
        )
        .unwrap();
        assert_eq!(by_route.len(), 5);
        assert!(page(&records, None, None, None, Some("model:none"), 2).is_err());
    }

    /// 缺陷 2（生产验收）：两条 route 投影同一模型名时，按 request log 的 providerName（route
    /// 原生 ID）各自归属到自己的 Resource，统计分行、`modelRouteResourceId` 填上；登记不到的
    /// 调用不映射 Resource，非 Core 投影的原生 route 以请求模型名匹配。
    #[test]
    fn model_route_follows_the_route_native_id_not_the_model_name() {
        let (first, second, native) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let routes: HashMap<String, Uuid> = [
            ("62f190fc".to_owned(), first),
            ("55ba18a0".to_owned(), second),
            ("legacy-qwen".to_owned(), native),
        ]
        .into_iter()
        .collect();
        let mut a = log("l1", None, 200, 10, "qwen");
        a.provider = Some("62f190fc".into());
        let mut b = log("l2", None, 200, 10, "qwen");
        b.provider = Some("55ba18a0".into());
        let mut legacy = log("l3", None, 200, 10, "legacy-qwen");
        legacy.provider = Some("openai".into());
        let mut unknown = log("l4", None, 200, 10, "qwen");
        unknown.provider = None;
        assert_eq!(route_key(&a, &routes), "62f190fc");
        assert_eq!(route_key(&b, &routes), "55ba18a0");
        assert_eq!(route_key(&legacy, &routes), "legacy-qwen");
        assert_eq!(route_key(&unknown, &routes), "qwen");
        let mut none = unknown.clone();
        none.request_model = None;
        assert_eq!(route_key(&none, &routes), UNATTRIBUTED);
        let records: Vec<Record> = [&a, &b, &legacy, &unknown]
            .into_iter()
            .map(|entry| model_record(entry, None, None, &routes, false))
            .collect();
        assert_eq!(records[0].view["modelRouteResourceId"], json!(first));
        assert_eq!(records[1].view["modelRouteResourceId"], json!(second));
        assert_eq!(records[2].view["modelRouteResourceId"], json!(native));
        assert!(records[3].view.get("modelRouteResourceId").is_none());
        let w = window(None, None, at("2026-10-21T12:00:00Z")).unwrap();
        let (_, rows, _) = aggregate(&records, &w, Dimension::ModelRoute, &HashMap::new());
        let keys: std::collections::BTreeSet<_> = rows
            .iter()
            .map(|row| row["key"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(
            keys,
            ["55ba18a0", "62f190fc", "legacy-qwen", "qwen"]
                .into_iter()
                .map(str::to_owned)
                .collect()
        );
    }

    #[test]
    fn child_execution_is_read_from_audit_key() {
        let op = Uuid::new_v4();
        let ae = Uuid::new_v4();
        assert_eq!(
            child_execution(&format!("{op}:child:{ae}:intent")),
            Some(ae)
        );
        assert_eq!(child_execution(&format!("{op}:intent")), None);
    }

    #[test]
    fn dimensions_follow_scope() {
        assert!(Dimension::ModelRoute.allowed(true));
        assert!(Dimension::Tenant.allowed(true));
        assert!(!Dimension::Tool.allowed(true));
        assert!(!Dimension::Agent.allowed(true));
        assert!(!Dimension::Tenant.allowed(false));
        assert!(Dimension::Binding.allowed(false));
    }
}
