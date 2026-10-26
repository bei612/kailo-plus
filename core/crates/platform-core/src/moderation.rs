//! DD-125(2) 社区审核的受治理动作（`.design/05` §2.11，V-SCN-126..130）。
//!
//! 七个动作键只接受 HUMAN 会话经 `/api/v1/actions` 发起：EXPLICIT、无审批、quota
//! `NONE`、`FULL_LIFECYCLE` 审计，观测终态取同步结果。Relay 的举报、限制与审核日志表
//! 是唯一权威，Core 只保存 ActionExecution、AuditEvent 与发送前的事件引用，不复制。
//!
//! - `moderation.report.submit`：以本人 Web（SERVER）身份签 kind 1984。签名后、发送前把
//!   事件 ID 与签名时间随 ALLOWED 一起落库（DD-81 的 DISPATCH）；结果不明只以 CONTROL
//!   读取 Relay 举报队列按事件 ID 查证：签名时间超出 Relay 漂移窗口仍查不到即确定未送达，
//!   读取已达单次上界则不下结论。绝不重签重发。
//! - `moderation.ban/unban/timeout/untimeout`：目标是同 Tenant 非本人、非有效 Tenant
//!   admin 的 HUMAN Principal；CONTROL 对其全部非 `REVOKED` 公钥签 9040–9043，按 Relay
//!   限制状态先读→发送→回读。禁言到期时刻在准入时以数据库时钟冻结，冻结参数即目标状态，
//!   结果不明时对账先重新准入再重签。AGENT 公钥一律 `PERMISSION_DENIED`。
//! - `moderation.report.resolve`：CONTROL 逐条签 9044，按举报状态回读；只记决定、不执法。
//! - `moderation.message.delete`：CONTROL 签 9005，按 9005 事件 ID 对账。
//!
//! 踢出频道复用 `workspace.member.revoke`（DD-119），不在本模块。新设备公钥进入 ACTIVE
//! 前继承限制（[`inherit_restrictions`]）由 `BUZZ_IDENTITY_PROJECTION` 调用。

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use collab_bridge::bridge::{Delivery, IdentityClient};
use collab_bridge::moderation::{self as wire, ReportRow, Restriction, RestrictionRow};
use collab_bridge::operator::{LimitKind, OperatorError};
use contracts::{ActionCommand, ActionSubmission, ErrorBody, EvidenceKind, ReasonCode};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::audit::Evidence;
use crate::bff::{BffState, ExecutionContext};
use crate::governance::{
    self, Actor, Definition, Evaluation, Execution, Refusal, Target, EXECUTION_COLUMNS,
};
use crate::service_api::ServiceState;
use crate::tenant_lifecycle::{control_client, ProjectionDirection};

pub(crate) const REPORT_SUBMIT: &str = "moderation.report.submit";
pub(crate) const BAN: &str = "moderation.ban";
pub(crate) const UNBAN: &str = "moderation.unban";
pub(crate) const TIMEOUT: &str = "moderation.timeout";
pub(crate) const UNTIMEOUT: &str = "moderation.untimeout";
pub(crate) const REPORT_RESOLVE: &str = "moderation.report.resolve";
pub(crate) const MESSAGE_DELETE: &str = "moderation.message.delete";

const ACTIONS: [&str; 7] = [
    REPORT_SUBMIT,
    BAN,
    UNBAN,
    TIMEOUT,
    UNTIMEOUT,
    REPORT_RESOLVE,
    MESSAGE_DELETE,
];

/// 每个命令都可携带的通用字段；其余字段只属于各自的动作键。
const COMMON_FIELDS: [&str; 3] = ["actionKey", "idempotencyKey", "explicitConfirmation"];

/// 原举报对话框“补充说明”的上界。
const NOTE_MAX_CHARS: usize = 1000;

/// 一次处理的同目标举报上界（契约 ModerationReportResolution）。
const RESOLVE_MAX_REPORTS: usize = 100;

pub(crate) fn is_action(key: &str) -> bool {
    ACTIONS.contains(&key)
}

/// 原禁言预设（`moderation/lib/timeout.ts::TIMEOUT_PRESETS`：1 小时、24 小时、7 天）。
fn timeout_seconds(duration: &str) -> Option<i64> {
    match duration {
        "ONE_HOUR" => Some(60 * 60),
        "ONE_DAY" => Some(24 * 60 * 60),
        "SEVEN_DAYS" => Some(7 * 24 * 60 * 60),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Ban,
    Unban,
    Timeout,
    Untimeout,
}

impl Mode {
    fn of(key: &str) -> Option<Self> {
        match key {
            BAN => Some(Self::Ban),
            UNBAN => Some(Self::Unban),
            TIMEOUT => Some(Self::Timeout),
            UNTIMEOUT => Some(Self::Untimeout),
            _ => None,
        }
    }

    fn kind(self) -> u32 {
        match self {
            Self::Ban => wire::KIND_MODERATION_BAN,
            Self::Unban => wire::KIND_MODERATION_UNBAN,
            Self::Timeout => wire::KIND_MODERATION_TIMEOUT,
            Self::Untimeout => wire::KIND_MODERATION_UNTIMEOUT,
        }
    }
}

/// 目录形状与 05 §2.11 一致才执行；不一致即 `CAPABILITY_BLOCKED`。
fn definition_shape(def: &Definition) -> bool {
    let (target, workspace_rule, permission, object) = match def.action_key.as_str() {
        REPORT_SUBMIT => ("TENANT", "TENANT_ONLY", "discover", "tenant"),
        BAN | UNBAN | TIMEOUT | UNTIMEOUT => ("PRINCIPAL", "TENANT_ONLY", "manage", "tenant"),
        REPORT_RESOLVE => ("TENANT", "TENANT_ONLY", "manage", "tenant"),
        MESSAGE_DELETE => ("WORKSPACE", "WORKSPACE_REQUIRED", "manage", "workspace"),
        _ => return false,
    };
    def.component_type_key == "core"
        && def.target_type == target
        && def.tenant_rule == "SESSION_TENANT"
        && def.workspace_rule == workspace_rule
        && def.permission == permission
        && def.permission_object_type == object
        && def.execution_mode == "SYNC"
        && def.confirmation_mode == "EXPLICIT"
        && def.approval_policy_id.is_none()
        && def.workflow_kind.is_none()
        && def.result_exposure == "NONE"
        && def.quota_policy == "NONE"
        && def.meters.is_empty()
}

/// 每个动作只接受自己的字段，且必须带上 EXPLICIT 确认（原对话框提交与菜单点击）。
fn shape(key: &str, raw: &Value) -> Result<(), Refusal> {
    let own: &[&str] = match key {
        REPORT_SUBMIT => &["moderationReport"],
        REPORT_RESOLVE => &["moderationResolution"],
        MESSAGE_DELETE => &["workspaceId", "moderationEventId"],
        _ => &["moderationMember"],
    };
    let fields = raw.as_object().ok_or_else(invalid)?;
    for (name, value) in fields {
        let known = COMMON_FIELDS.contains(&name.as_str()) || own.contains(&name.as_str());
        if !value.is_null() && !known {
            return Err(invalid());
        }
    }
    for name in own {
        if fields.get(*name).is_none_or(Value::is_null) {
            return Err(invalid());
        }
    }
    if raw["explicitConfirmation"] != Value::Bool(true) {
        return Err(invalid());
    }
    Ok(())
}

/// 准入前解析出的目标与冻结参数。
struct Resolved {
    target: Target,
    parameters: Value,
    /// 评估通过之后才成立的语义拒绝（例如举报他 Tenant 的 HUMAN）
    refusal: Option<ReasonCode>,
    send: Send,
}

/// 外部发送所需的已解析事实。
enum Send {
    /// 本人签 1984（Web SERVER 身份）
    Report {
        client: Box<IdentityClient>,
        author: String,
        event_id: String,
        report_type: String,
        note: String,
    },
    /// CONTROL 对目标 Principal 全部非 REVOKED 公钥签 9040–9043
    Member { principal: Uuid },
    /// CONTROL 逐条签 9044
    Resolve { ids: Vec<String> },
    /// CONTROL 签 9005
    Delete { channel: String, event_id: String },
}

/// 签好、在发送前随 ALLOWED 持久化的唯一事件。
struct Signed {
    kind: i32,
    event: nostr::Event,
    event_id: String,
    signer: String,
    created_at: i64,
}

impl Signed {
    fn of(kind: u32, event: nostr::Event) -> Result<Self, Refusal> {
        let created_at = i64::try_from(event.created_at.as_secs()).map_err(|_| invalid())?;
        Ok(Self {
            kind: i32::try_from(kind).map_err(|_| invalid())?,
            event_id: event.id.to_hex(),
            signer: event.pubkey.to_hex(),
            created_at,
            event,
        })
    }
}

/// 对一条已 ALLOWED 的审核动作得到的结论。
enum Settled {
    Verified(Vec<Evidence>),
    Aborted(ReasonCode, Vec<Evidence>),
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// 准入落定后的首次派发：判定刚刚完成，不再重复
    First,
    /// 结果不明后的对账：重新发送任何命令之前先重新准入
    Reconcile,
}

/// `/api/v1/actions` 的审核动作消费者（`governance_api::submit_action`）。
pub(crate) async fn submit(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &ActionCommand,
) -> Result<(StatusCode, ActionSubmission), (Refusal, Option<Uuid>)> {
    match command(state, ctx, cmd).await {
        Ok(ae) => governance::submission_result(&ae),
        Err(refusal) => Err((refusal, None)),
    }
}

async fn command(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &ActionCommand,
) -> Result<Execution, Refusal> {
    let full = ctx.access_mode == contracts::PlatformSessionAccessMode::Full;
    if !is_action(&cmd.action_key) || !full {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let raw = serde_json::to_value(cmd).map_err(|_| invalid())?;
    shape(&cmd.action_key, &raw)?;
    let key = parse_uuid(&cmd.idempotency_key)?;
    let digest = collab_bridge::limits::canonical_digest(&raw);
    if let Some(ae) = existing(&state.pool, ctx, key).await? {
        return replay(state, &cmd.action_key, &digest, ae).await;
    }
    if !crate::capability_registry::action_exposed(&cmd.action_key) {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let def = governance::active_definition(&state.pool, &cmd.action_key)
        .await?
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    if !definition_shape(&def) {
        tracing::error!(action = %def.action_key, "审核动作的目录形状与 05 §2.11 不一致");
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let mut conn = state.pool.acquire().await?;
    if crate::platform_bootstrap::is_catalog_tenant(&mut conn, ctx.tenant_id).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    drop(conn);
    let resolved = resolve(state, ctx, &cmd.action_key, &raw).await?;
    let eval = state
        .governance
        .evaluate(actor(ctx), &def, &resolved.target)
        .await?;
    let refusal = if eval.allowed {
        check(state, ctx, &resolved).await?
    } else {
        Some(eval.reason.clone().unwrap_or(ReasonCode::PermissionDenied))
    };
    let mut parameters = resolved.parameters;
    parameters["commandDigest"] = json!(digest);
    parameters["platformSessionId"] = json!(ctx.session_id);
    let hash = collab_bridge::limits::canonical_digest(&json!({
        "actionKey": def.action_key,
        "actionVersion": def.version,
        "targetId": resolved.target.id,
        "parameters": parameters,
    }));
    let intent = Intent {
        def: &def,
        target: &resolved.target,
        parameters,
        hash,
        key,
        eval: &eval,
    };
    if let Some(reason) = refusal {
        return match refuse(state, ctx, intent, reason).await? {
            Admission::Opened(ae) => Ok(ae),
            Admission::Raced(ae) => replay(state, &cmd.action_key, &digest, ae).await,
        };
    }
    let prepared = prepare(state, ctx, resolved.send).await?;
    let signed = prepared.as_ref().map(|(signed, _)| signed);
    let ae = match admit(state, ctx, intent, signed).await? {
        Admission::Opened(ae) => ae,
        Admission::Raced(ae) => return replay(state, &cmd.action_key, &digest, ae).await,
    };
    let dispatched = match prepared {
        Some((signed, client)) => send_once(state, &def, ae.id, signed, client).await,
        None => drive(state, &def, ae.id, Phase::First).await,
    };
    if let Err(error) = dispatched {
        // 结论没有写下：原 operation 保持 UNKNOWN，由对账收敛，绝不在这里重发
        let reason = governance::wire(&error.reason());
        tracing::warn!(action_execution_id = %ae.id, reason_code = %reason, "审核动作派发未收敛");
    }
    load(state, ae.id).await
}

fn actor(ctx: &ExecutionContext) -> Actor {
    Actor {
        tenant_id: ctx.tenant_id,
        principal_id: ctx.tenant_principal_id,
        human_identity_id: Some(ctx.human_identity_id),
    }
}

async fn existing(
    pool: &sqlx::PgPool,
    ctx: &ExecutionContext,
    key: Uuid,
) -> Result<Option<Execution>, sqlx::Error> {
    sqlx::query_as(&format!(
        "select {EXECUTION_COLUMNS} from admission.action_execution
         where tenant_id = $1 and initiator_principal_id = $2 and idempotency_key = $3"
    ))
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .bind(key)
    .fetch_optional(pool)
    .await
}

fn frozen<'a>(ae: &'a Execution, name: &str) -> Option<&'a Value> {
    ae.parameters.as_ref()?.get(name)
}

/// 同一幂等键重发：只回答原 operation，参数不同即 `IDEMPOTENCY_KEY_REUSED`。结果不明时
/// 先做一次对账（举报与删除只读查证；状态型命令重新准入后按冻结目标判定）。
async fn replay(
    state: &BffState,
    key: &str,
    digest: &str,
    ae: Execution,
) -> Result<Execution, Refusal> {
    let same = frozen(&ae, "commandDigest").and_then(Value::as_str) == Some(digest);
    if ae.action_key != key || !same {
        return Err(Refusal::Conflict(ReasonCode::IdempotencyKeyReused));
    }
    if ae.gate_state == "ALLOWED" && ae.dispatch_state == "UNKNOWN" {
        let version = ae.action_version;
        let def = governance::exact_definition(&state.pool, &ae.action_key, version).await?;
        if let Err(error) = drive(state, &def, ae.id, Phase::Reconcile).await {
            let reason = governance::wire(&error.reason());
            tracing::warn!(action_execution_id = %ae.id, reason_code = %reason, "审核对账未收敛");
        }
        return load(state, ae.id).await;
    }
    Ok(ae)
}

async fn load(state: &BffState, id: Uuid) -> Result<Execution, Refusal> {
    governance::load_execution(&state.pool, id)
        .await?
        .ok_or_else(|| Refusal::Unavailable("审核 operation 不可查证".into()))
}

// ---------------------------------------------------------------------------
// 目标解析
// ---------------------------------------------------------------------------

async fn resolve(
    state: &BffState,
    ctx: &ExecutionContext,
    key: &str,
    raw: &Value,
) -> Result<Resolved, Refusal> {
    match key {
        REPORT_SUBMIT => resolve_report(state, ctx, &raw["moderationReport"]).await,
        REPORT_RESOLVE => resolve_resolution(ctx, &raw["moderationResolution"]),
        MESSAGE_DELETE => resolve_delete(state, ctx, raw).await,
        _ => resolve_member(state, ctx, key, &raw["moderationMember"]).await,
    }
}

fn text<'a>(input: &'a Value, name: &str) -> Option<&'a str> {
    input.get(name).and_then(Value::as_str)
}

fn hex64(input: &Value, name: &str) -> Result<String, Refusal> {
    let value = text(input, name).ok_or_else(invalid)?;
    if !wire::is_hex64(value) {
        return Err(invalid());
    }
    Ok(value.to_owned())
}

/// 原举报对话框：消息须本人当前可读（Workspace 成员或私聊参与者），以本人身份回读后
/// 取其签名者为 `p` 目标。HUMAN 目标须同 Tenant。
async fn resolve_report(
    state: &BffState,
    ctx: &ExecutionContext,
    input: &Value,
) -> Result<Resolved, Refusal> {
    let report_type = text(input, "reportType").ok_or_else(invalid)?;
    if !wire::REPORT_TYPES.contains(&report_type) {
        return Err(invalid());
    }
    let event_id = hex64(input, "eventId")?;
    let note = text(input, "note").unwrap_or_default().trim().to_owned();
    if note.chars().count() > NOTE_MAX_CHARS {
        return Err(invalid());
    }
    let workspace = text(input, "workspaceId").map(parse_uuid).transpose()?;
    let conversation = text(input, "conversationId").map(parse_uuid).transpose()?;
    let (channel, host, scope) = match (workspace, conversation) {
        (Some(workspace), None) => {
            let scope =
                crate::web_transport::admit_collaboration_workspace_scope(state, ctx, workspace)
                    .await
                    .map_err(admission_refusal)?;
            let fact = json!({"workspaceId": workspace});
            (scope.channel_id, scope.community_host, fact)
        }
        (None, Some(conversation)) => {
            let scope = crate::conversations::admit(state, ctx, conversation)
                .await
                .map_err(response_refusal)?;
            let fact = json!({"conversationId": conversation});
            (scope.channel_id, scope.community_host, fact)
        }
        _ => return Err(invalid()),
    };
    crate::web_transport::community_limits(state, &host)
        .await
        .map_err(|_| Refusal::Precondition(ReasonCode::BindingNotActive))?;
    let keys = crate::web_transport::actor_keys(state, ctx)
        .await
        .map_err(response_refusal)?;
    let client =
        crate::web_transport::community_client(state, &keys, &host).map_err(response_refusal)?;
    let author = message_author(state, &client, &channel, &event_id).await?;
    let foreign: Option<(Uuid, String)> = sqlx::query_as(
        "select tenant_id, kind from identity.buzz_identity_binding where pubkey = $1",
    )
    .bind(&author)
    .fetch_optional(&state.pool)
    .await?;
    let refusal = foreign
        .filter(|(tenant, kind)| kind == "HUMAN" && *tenant != ctx.tenant_id)
        .map(|_| ReasonCode::PermissionDenied);
    let mut parameters = json!({
        "eventId": event_id,
        "reportType": report_type,
        "channelId": channel,
        "targetPubkey": author,
    });
    if let (Some(target), Some(scope)) = (parameters.as_object_mut(), scope.as_object()) {
        target.extend(scope.clone());
    }
    Ok(Resolved {
        target: Target {
            id: ctx.tenant_id,
            version: 0,
            workspace_id: None,
        },
        parameters,
        refusal,
        send: Send::Report {
            client: Box::new(client),
            author,
            event_id,
            report_type: report_type.to_owned(),
            note,
        },
    })
}

/// 以给定身份在 Channel 内按事件 ID 回读一条原版消息，返回其签名者。
async fn message_author(
    state: &BffState,
    client: &IdentityClient,
    channel: &str,
    event_id: &str,
) -> Result<String, Refusal> {
    let filter = json!({"ids": [event_id], "#h": [channel], "limit": 1});
    let page = client
        .query(&state.relay_http, &[filter])
        .await
        .map_err(|_| Refusal::Unavailable("被举报消息不可回读".into()))?;
    let found = page
        .as_array()
        .into_iter()
        .flatten()
        .find(|event| event.get("id").and_then(Value::as_str) == Some(event_id))
        .cloned()
        .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    let event = crate::web_transport::channel_message_event(found, channel)
        .map_err(|_| Refusal::Precondition(ReasonCode::TargetNotFound))?;
    Ok(event.pubkey.to_hex())
}

/// 封禁/禁言的目标：公钥解析为同 Tenant 的 HUMAN Principal；AGENT 与本人一律拒绝。
async fn resolve_member(
    state: &BffState,
    ctx: &ExecutionContext,
    key: &str,
    input: &Value,
) -> Result<Resolved, Refusal> {
    let mode = Mode::of(key).ok_or_else(invalid)?;
    let pubkey = hex64(input, "targetPubkey")?;
    let duration = text(input, "timeoutDuration");
    if duration.is_some() != (mode == Mode::Timeout) {
        return Err(invalid());
    }
    let seconds = duration.map(|d| timeout_seconds(d).ok_or_else(invalid));
    let seconds = seconds.transpose()?;
    let binding: Option<(Uuid, String)> = sqlx::query_as(
        "select principal_id, kind from identity.buzz_identity_binding
         where tenant_id = $1 and pubkey = $2",
    )
    .bind(ctx.tenant_id)
    .bind(&pubkey)
    .fetch_optional(&state.pool)
    .await?;
    let (principal, kind) = binding.ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    let human: bool = sqlx::query_scalar(
        "select exists(select 1 from identity.principal
                       where id = $1 and tenant_id = $2 and kind = 'HUMAN')",
    )
    .bind(principal)
    .bind(ctx.tenant_id)
    .fetch_one(&state.pool)
    .await?;
    // AGENT 身份的停用权威是 Installation（17 §10、DD-117(5)），不以 Relay 封禁代替。
    let refusal = (kind != "HUMAN" || !human || principal == ctx.tenant_principal_id)
        .then_some(ReasonCode::PermissionDenied);
    let mut parameters = json!({"targetPubkey": pubkey, "targetPrincipalId": principal});
    if let Some(seconds) = seconds {
        // 到期时刻在准入时以数据库时钟冻结：冻结参数即目标状态，重签不改变它
        let now: i64 = sqlx::query_scalar("select extract(epoch from clock_timestamp())::bigint")
            .fetch_one(&state.pool)
            .await?;
        parameters["timeoutUntil"] = json!(now + seconds);
    }
    Ok(Resolved {
        target: Target {
            id: principal,
            version: 0,
            workspace_id: None,
        },
        parameters,
        refusal,
        send: Send::Member { principal },
    })
}

/// 一组同目标的未结举报；dismiss 只与 dismissed 配对，其余与 resolved 配对。
fn resolve_resolution(ctx: &ExecutionContext, input: &Value) -> Result<Resolved, Refusal> {
    let status = text(input, "status").ok_or_else(invalid)?;
    let action = text(input, "resolutionAction").ok_or_else(invalid)?;
    let paired = (action == "dismiss") == (status == "dismissed");
    let known_status = matches!(status, "resolved" | "dismissed");
    let known_action = matches!(action, "delete" | "kick" | "ban" | "escalate" | "dismiss");
    if !paired || !known_status || !known_action {
        return Err(invalid());
    }
    let listed = input.get("reportEventIds").and_then(Value::as_array);
    let listed = listed.ok_or_else(invalid)?;
    let mut ids: Vec<String> = Vec::with_capacity(listed.len());
    for id in listed {
        let id = id
            .as_str()
            .filter(|id| wire::is_hex64(id))
            .ok_or_else(invalid)?;
        if ids.iter().any(|seen| seen == id) {
            return Err(invalid());
        }
        ids.push(id.to_owned());
    }
    if ids.is_empty() || ids.len() > RESOLVE_MAX_REPORTS {
        return Err(invalid());
    }
    Ok(Resolved {
        target: Target {
            id: ctx.tenant_id,
            version: 0,
            workspace_id: None,
        },
        parameters: json!({"reportEventIds": ids, "status": status, "resolutionAction": action}),
        refusal: None,
        send: Send::Resolve { ids },
    })
}

/// 9005 的目标：该 Workspace 当前 Channel 中的一条消息。
async fn resolve_delete(
    state: &BffState,
    ctx: &ExecutionContext,
    raw: &Value,
) -> Result<Resolved, Refusal> {
    let workspace = parse_uuid(text(raw, "workspaceId").ok_or_else(invalid)?)?;
    let event_id = hex64(raw, "moderationEventId")?;
    let channel: Option<Uuid> = sqlx::query_scalar(
        "select b.channel_id from identity.workspace w
         join projection.workspace_buzz_binding b on b.workspace_id = w.id and b.state = 'ACTIVE'
         where w.id = $1 and w.tenant_id = $2",
    )
    .bind(workspace)
    .bind(ctx.tenant_id)
    .fetch_optional(&state.pool)
    .await?;
    let channel = channel
        .ok_or(Refusal::Precondition(ReasonCode::BindingNotActive))?
        .to_string();
    Ok(Resolved {
        target: Target {
            id: workspace,
            version: 0,
            workspace_id: Some(workspace),
        },
        parameters: json!({"eventId": event_id, "channelId": channel}),
        refusal: None,
        send: Send::Delete { channel, event_id },
    })
}

/// 评估通过之后的语义判定。只读；任何发送都在准入落定之后。
async fn check(
    state: &BffState,
    ctx: &ExecutionContext,
    resolved: &Resolved,
) -> Result<Option<ReasonCode>, Refusal> {
    if let Some(reason) = &resolved.refusal {
        return Ok(Some(reason.clone()));
    }
    match &resolved.send {
        Send::Report { .. } => Ok(None),
        Send::Member { principal } => {
            // 有效 Tenant admin 不能被封禁或禁言（DD-82：无 owner/admin 两级）
            if is_effective_admin(state, ctx.tenant_id, *principal).await? {
                return Ok(Some(ReasonCode::PermissionDenied));
            }
            let keys = live_pubkeys(&state.pool, ctx.tenant_id, *principal).await?;
            Ok(keys.is_empty().then_some(ReasonCode::TargetStateConflict))
        }
        Send::Resolve { ids } => {
            let control = control(state, ctx.tenant_id).await?;
            let rows = control
                .moderation_reports(&state.relay_http, None)
                .await
                .map_err(|_| Refusal::Unavailable("Relay 举报队列不可读".into()))?;
            open_reports(&rows, ids)
        }
        Send::Delete { channel, event_id } => {
            let control = control(state, ctx.tenant_id).await?;
            message_author(state, &control, channel, event_id).await?;
            Ok(None)
        }
    }
}

/// 处理目标必须全部存在、仍 open 且指向同一目标。读取已达单次上界而找不到时不下结论。
fn open_reports(rows: &[ReportRow], ids: &[String]) -> Result<Option<ReasonCode>, Refusal> {
    let mut target: Option<(&str, &str)> = None;
    for id in ids {
        let Some(row) = rows.iter().find(|row| &row.report_event_id == id) else {
            if rows.len() >= wire::READ_LIMIT {
                return Err(Refusal::Unavailable("举报超出 Relay 单次读取上界".into()));
            }
            return Ok(Some(ReasonCode::TargetNotFound));
        };
        if row.status != "open" {
            return Ok(Some(ReasonCode::TargetStateConflict));
        }
        let this = (row.target_kind.as_str(), row.target.as_str());
        if target.is_some_and(|seen| seen != this) {
            return Ok(Some(ReasonCode::InvalidParameters));
        }
        target = Some(this);
    }
    Ok(None)
}

async fn is_effective_admin(
    state: &BffState,
    tenant: Uuid,
    principal: Uuid,
) -> Result<bool, Refusal> {
    let page = state.governance.cfg.relationship_page;
    let spicedb = &state.governance.spicedb;
    let mut conn = state.pool.acquire().await?;
    let admins = crate::roles::effective_tenant_admins(&mut conn, spicedb, tenant, page).await?;
    Ok(admins.contains(&principal))
}

/// 目标 Principal 的全部非 `REVOKED` HUMAN 公钥（DD-77 多设备）。
async fn live_pubkeys(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    principal: Uuid,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        "select pubkey from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2 and kind = 'HUMAN' and state <> 'REVOKED'
         order by pubkey",
    )
    .bind(tenant)
    .bind(principal)
    .fetch_all(pool)
    .await
}

/// 该 Tenant 的 CONTROL 客户端（BFF 发出的 Relay 调用同样先过 Core 预算）。
async fn control(state: &BffState, tenant: Uuid) -> Result<IdentityClient, Refusal> {
    let direction = ProjectionDirection::Establish;
    let (client, _) = control_client(&state.memory_service, tenant, direction)
        .await
        .map_err(binding_refusal)?;
    Ok(client.with_budget(state.relay_budget.clone()))
}

/// 唯一事件在准入落定前签好：举报以本人 SERVER 身份，删除以 CONTROL。状态型命令不预签。
async fn prepare(
    state: &BffState,
    ctx: &ExecutionContext,
    send: Send,
) -> Result<Option<(Signed, IdentityClient)>, Refusal> {
    match send {
        Send::Report {
            client,
            author,
            event_id,
            report_type,
            note,
        } => {
            let tags = wire::report_tags(&author, &event_id, &report_type);
            let event = client
                .sign_moderation(wire::KIND_REPORT, &note, &tags)
                .map_err(signing)?;
            Ok(Some((Signed::of(wire::KIND_REPORT, event)?, *client)))
        }
        Send::Delete { channel, event_id } => {
            let client = control(state, ctx.tenant_id).await?;
            let tags = wire::delete_tags(&channel, &event_id);
            let kind = wire::KIND_NIP29_DELETE_EVENT;
            let event = client.sign_moderation(kind, "", &tags).map_err(signing)?;
            Ok(Some((Signed::of(kind, event)?, client)))
        }
        Send::Member { .. } | Send::Resolve { .. } => Ok(None),
    }
}

// ---------------------------------------------------------------------------
// 准入落定
// ---------------------------------------------------------------------------

struct Intent<'a> {
    def: &'a Definition,
    target: &'a Target,
    parameters: Value,
    hash: String,
    key: Uuid,
    eval: &'a Evaluation,
}

enum Admission {
    Opened(Execution),
    /// 同一幂等键已由并发请求落定：只回答那一条
    Raced(Execution),
}

/// Tenant 行锁下复核幂等键：两个并发请求只有一个能打开 ActionExecution。
async fn open(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ctx: &ExecutionContext,
    intent: Intent<'_>,
) -> Result<Admission, Refusal> {
    if !crate::roles::lock_tenant(tx, ctx.tenant_id).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let raced: Option<Execution> = sqlx::query_as(&format!(
        "select {EXECUTION_COLUMNS} from admission.action_execution
         where tenant_id = $1 and initiator_principal_id = $2 and idempotency_key = $3"
    ))
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .bind(intent.key)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some(ae) = raced {
        return Ok(Admission::Raced(ae));
    }
    let ae = governance::open_execution_values(
        tx,
        actor(ctx),
        ctx.tenant_principal_id,
        intent.def,
        intent.target,
        intent.parameters,
        intent.hash,
        intent.key,
        None,
    )
    .await?;
    Ok(Admission::Opened(ae))
}

fn zed_evidence(eval: &Evaluation) -> Vec<Evidence> {
    match eval.zed_token.as_deref() {
        Some(token) if !token.is_empty() => {
            vec![Evidence::new(EvidenceKind::SpicedbZedtoken, token)]
        }
        _ => Vec::new(),
    }
}

/// 准入判定为拒绝：ActionExecution 以 DENIED 落定，判定与审计同事务（FULL_LIFECYCLE）。
async fn refuse(
    state: &BffState,
    ctx: &ExecutionContext,
    intent: Intent<'_>,
    reason: ReasonCode,
) -> Result<Admission, Refusal> {
    let (def, eval) = (intent.def, intent.eval);
    let mut tx = state.pool.begin().await?;
    let ae = match open(&mut tx, ctx, intent).await? {
        Admission::Opened(ae) => ae,
        raced @ Admission::Raced(_) => return Ok(raced),
    };
    let code = governance::wire(&reason);
    governance::record_decision(
        &mut tx,
        &ae.subject(),
        "ADMISSION",
        eval.scope,
        eval.authorization,
        "NOT_REQUIRED",
        eval.quota,
        eval.zed_token.as_deref(),
        Some(&reason),
    )
    .await?;
    sqlx::query(
        "update admission.action_execution
         set gate_state = 'DENIED', reason_code = $2, updated_at = now()
         where id = $1",
    )
    .bind(ae.id)
    .bind(&code)
    .execute(&mut *tx)
    .await?;
    governance::audit(
        &mut tx,
        &ae,
        def,
        "admission:decision",
        "DECISION",
        "DENY",
        &code,
        Some(ctx.human_identity_id),
        zed_evidence(eval),
    )
    .await?;
    tx.commit().await?;
    Ok(Admission::Opened(load(state, ae.id).await?))
}

/// 准入通过：ALLOWED、判定与审计、发送前的事件引用与 DISPATCH 意图同事务落定。此后
/// 任何崩溃都只会让这条 operation 停在 UNKNOWN，由对账收敛。
async fn admit(
    state: &BffState,
    ctx: &ExecutionContext,
    intent: Intent<'_>,
    signed: Option<&Signed>,
) -> Result<Admission, Refusal> {
    let (def, eval) = (intent.def, intent.eval);
    let mut tx = state.pool.begin().await?;
    let ae = match open(&mut tx, ctx, intent).await? {
        Admission::Opened(ae) => ae,
        raced @ Admission::Raced(_) => return Ok(raced),
    };
    governance::record_decision(
        &mut tx,
        &ae.subject(),
        "ADMISSION",
        eval.scope,
        eval.authorization,
        "NOT_REQUIRED",
        eval.quota,
        eval.zed_token.as_deref(),
        None,
    )
    .await?;
    sqlx::query(
        "update admission.action_execution
         set gate_state = 'ALLOWED', reason_code = null, updated_at = now()
         where id = $1",
    )
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    governance::audit(
        &mut tx,
        &ae,
        def,
        "admission:decision",
        "DECISION",
        "ALLOW",
        "ALLOWED",
        Some(ctx.human_identity_id),
        zed_evidence(eval),
    )
    .await?;
    let mut evidence = Vec::new();
    if let Some(signed) = signed {
        sqlx::query(
            "insert into admission.moderation_publication
                 (action_execution_id, event_kind, event_id, signer_pubkey, event_created_at)
             values ($1, $2, $3, $4, $5)",
        )
        .bind(ae.id)
        .bind(signed.kind)
        .bind(&signed.event_id)
        .bind(&signed.signer)
        .bind(signed.created_at)
        .execute(&mut *tx)
        .await?;
        evidence.push(Evidence::new(EvidenceKind::BuzzEventId, &signed.event_id));
    }
    let pending = Err(StatusCode::SERVICE_UNAVAILABLE);
    governance::record_dispatch(&mut tx, ae.id, def.audit_class(), pending, evidence).await?;
    tx.commit().await?;
    Ok(Admission::Opened(ae))
}

// ---------------------------------------------------------------------------
// 派发与对账
// ---------------------------------------------------------------------------

fn limit_reason(kind: LimitKind) -> ReasonCode {
    match kind {
        LimitKind::PayloadTooLarge => ReasonCode::PayloadTooLarge,
        LimitKind::RateLimited | LimitKind::Capacity => ReasonCode::RateLimited,
    }
}

/// 举报或删除的唯一一次发送。只有持有本次签名事件的请求能走到这里；重放、重启与对账
/// 只能读取查证（[`observe_publication`]）。
async fn send_once(
    state: &BffState,
    def: &Definition,
    id: Uuid,
    signed: Signed,
    client: IdentityClient,
) -> Result<(), Refusal> {
    let delivery = client
        .deliver_moderation(&state.relay_http, &signed.event)
        .await;
    let evidence = vec![Evidence::new(EvidenceKind::BuzzEventId, &signed.event_id)];
    let settled = match delivery {
        Delivery::Accepted => Settled::Verified(evidence),
        Delivery::Rejected(why) => {
            tracing::warn!(reason = %why, kind = signed.kind, "Relay 拒绝审核事件");
            Settled::Aborted(ReasonCode::PublishRejected, evidence)
        }
        // 429/413 在 Relay 读取事件之前返回：确定没有落库
        Delivery::Limited(kind, _) => Settled::Aborted(limit_reason(kind), evidence),
        Delivery::Unknown(why) => {
            tracing::warn!(error = %why, kind = signed.kind, "审核事件发送结果不明，留给对账");
            Settled::Unknown
        }
    };
    settle(state, def, id, settled).await
}

/// 派发或对账一条已 ALLOWED、派发未决的审核动作。
async fn drive(state: &BffState, def: &Definition, id: Uuid, phase: Phase) -> Result<(), Refusal> {
    let ae = load(state, id).await?;
    if ae.gate_state != "ALLOWED" || ae.dispatch_state != "UNKNOWN" {
        return Ok(());
    }
    let settled = match ae.action_key.as_str() {
        REPORT_SUBMIT | MESSAGE_DELETE => observe_publication(state, &ae).await?,
        REPORT_RESOLVE => drive_resolution(state, def, &ae, phase).await?,
        _ => drive_restriction(state, def, &ae, phase).await?,
    };
    settle(state, def, id, settled).await
}

fn outcome_code(key: &str) -> &'static str {
    match key {
        REPORT_SUBMIT => "MODERATION_REPORT_SUBMITTED",
        BAN => "MODERATION_BANNED",
        UNBAN => "MODERATION_BAN_LIFTED",
        TIMEOUT => "MODERATION_TIMED_OUT",
        UNTIMEOUT => "MODERATION_TIMEOUT_LIFTED",
        REPORT_RESOLVE => "MODERATION_REPORTS_RESOLVED",
        _ => "MODERATION_MESSAGE_DELETED",
    }
}

/// 写下确定结论：VERIFIED → DISPATCHED；拒绝或确定未送达 → ABORTED 并保留原因码；
/// 不明不写，留给对账。只推进仍 UNKNOWN 的行，重复调用无害。
async fn settle(
    state: &BffState,
    def: &Definition,
    id: Uuid,
    settled: Settled,
) -> Result<(), Refusal> {
    let (reason, evidence) = match settled {
        Settled::Unknown => return Ok(()),
        Settled::Verified(evidence) => (None, evidence),
        Settled::Aborted(reason, evidence) => (Some(reason), evidence),
    };
    let mut tx = state.pool.begin().await?;
    let ae = governance::lock_execution(&mut tx, id).await?;
    if ae.gate_state != "ALLOWED" || ae.dispatch_state != "UNKNOWN" {
        return Ok(());
    }
    let class = def.audit_class();
    let outcome = match &reason {
        None => "VERIFIED",
        Some(ReasonCode::PublishRejected) => "REJECTED",
        Some(_) => "NOT_DELIVERED",
    };
    sqlx::query(
        "update admission.moderation_publication
         set outcome = $2, settled_at = now()
         where action_execution_id = $1 and outcome is null",
    )
    .bind(id)
    .bind(outcome)
    .execute(&mut *tx)
    .await?;
    match reason {
        None => {
            governance::record_dispatch(&mut tx, id, class, Ok(()), evidence.clone()).await?;
            let result = outcome_code(&ae.action_key);
            governance::audit(
                &mut tx, &ae, def, "outcome", "OUTCOME", "ALLOW", result, None, evidence,
            )
            .await?;
        }
        Some(reason) => {
            let refused = Err(StatusCode::CONFLICT);
            governance::record_dispatch(&mut tx, id, class, refused, evidence.clone()).await?;
            let code = governance::wire(&reason);
            sqlx::query("update admission.action_execution set reason_code = $2 where id = $1")
                .bind(id)
                .bind(&code)
                .execute(&mut *tx)
                .await?;
            governance::audit(
                &mut tx, &ae, def, "outcome", "OUTCOME", "DENY", &code, None, evidence,
            )
            .await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

fn unix(at: Option<&str>) -> Option<i64> {
    let at = chrono::DateTime::parse_from_rfc3339(at?).ok()?;
    Some(at.timestamp())
}

/// 举报与删除结果不明时的只读查证：查到即已送达；签名时间超出 Relay 漂移窗口仍查不到
/// 即确定未送达；举报读取已达单次上界时不下结论。
async fn observe_publication(state: &BffState, ae: &Execution) -> Result<Settled, Refusal> {
    let row: Option<(i32, String, i64)> = sqlx::query_as(
        "select event_kind, event_id, event_created_at from admission.moderation_publication
         where action_execution_id = $1",
    )
    .bind(ae.id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((kind, event_id, created_at)) = row else {
        return Err(Refusal::Unavailable("审核事件引用缺失".into()));
    };
    let evidence = vec![Evidence::new(EvidenceKind::BuzzEventId, &event_id)];
    let Ok(control) = control(state, ae.tenant_id).await else {
        return Ok(Settled::Unknown);
    };
    let observed = if u32::try_from(kind).ok() == Some(wire::KIND_REPORT) {
        control
            .moderation_reports(&state.relay_http, None)
            .await
            .map(|rows| {
                let found = rows.iter().any(|row| row.report_event_id == event_id);
                (found, rows.len() < wire::READ_LIMIT)
            })
    } else {
        control
            .event_exists(&state.relay_http, &event_id)
            .await
            .map(|found| (found, true))
    };
    let Ok((found, complete)) = observed else {
        return Ok(Settled::Unknown);
    };
    if found {
        return Ok(Settled::Verified(evidence));
    }
    let expired = now_secs() > created_at + wire::RELAY_TIMESTAMP_DRIFT_SECS;
    if expired && complete {
        // 同一签名事件已不可能再被 Relay 接受：确定未送达，不重签
        return Ok(Settled::Aborted(
            ReasonCode::DependencyUnavailable,
            evidence,
        ));
    }
    Ok(Settled::Unknown)
}

/// 对账时重新准入：发起人此刻仍持有该动作的 fresh 授权，状态型命令的目标仍合格。
async fn still_allowed(
    state: &BffState,
    def: &Definition,
    ae: &Execution,
) -> Result<bool, Refusal> {
    let actor = Actor {
        tenant_id: ae.tenant_id,
        principal_id: ae.initiator_principal_id,
        human_identity_id: None,
    };
    let target = Target {
        id: ae.target_id,
        version: 0,
        workspace_id: ae.workspace_id,
    };
    let eval = state.governance.evaluate(actor, def, &target).await?;
    if !eval.allowed {
        return Ok(false);
    }
    if Mode::of(&ae.action_key).is_some() {
        return Ok(!is_effective_admin(state, ae.tenant_id, ae.target_id).await?);
    }
    Ok(true)
}

/// 冻结参数即目标状态。Relay 限制列表只含当前有效的封禁与禁言。
fn restriction_reached(
    rows: &[RestrictionRow],
    pubkey: &str,
    mode: Mode,
    until: Option<i64>,
    now: i64,
) -> bool {
    let row = rows.iter().find(|row| row.pubkey == pubkey);
    match mode {
        Mode::Ban => row.is_some_and(|row| row.banned && row.ban_expires_at.is_none()),
        Mode::Unban => row.is_none_or(|row| !row.banned),
        Mode::Timeout => match until {
            Some(until) if until <= now => true,
            Some(until) => row.and_then(|row| unix(row.muted_until.as_deref())) == Some(until),
            None => false,
        },
        Mode::Untimeout => row.is_none_or(|row| row.muted_until.is_none()),
    }
}

fn restriction_tags(mode: Mode, pubkey: &str, until: Option<i64>) -> Option<Vec<Vec<String>>> {
    Some(match mode {
        Mode::Ban => wire::ban_tags(pubkey, None),
        Mode::Timeout => wire::timeout_tags(pubkey, until?),
        Mode::Unban | Mode::Untimeout => wire::lift_tags(pubkey),
    })
}

/// 9040–9043：先读→发送→回读。全部公钥到达目标状态即成功；有发送结果不明或读取失败即
/// 不明；其余（Relay 明确拒绝）即中止。
async fn drive_restriction(
    state: &BffState,
    def: &Definition,
    ae: &Execution,
    phase: Phase,
) -> Result<Settled, Refusal> {
    let mode = Mode::of(&ae.action_key).ok_or_else(invalid)?;
    let until = frozen(ae, "timeoutUntil").and_then(Value::as_i64);
    let pubkeys = live_pubkeys(&state.pool, ae.tenant_id, ae.target_id).await?;
    let evidence: Vec<Evidence> = pubkeys
        .iter()
        .map(|pubkey| Evidence::new(EvidenceKind::BuzzPubkey, pubkey))
        .collect();
    let control = match control(state, ae.tenant_id).await {
        Ok(control) => control,
        Err(Refusal::Precondition(reason)) if phase == Phase::First => {
            return Ok(Settled::Aborted(reason, evidence));
        }
        Err(_) => return Ok(Settled::Unknown),
    };
    let now = now_secs();
    let Ok(before) = control.moderation_restricted(&state.relay_http).await else {
        return Ok(Settled::Unknown);
    };
    let pending: Vec<&String> = pubkeys
        .iter()
        .filter(|pubkey| !restriction_reached(&before, pubkey, mode, until, now))
        .collect();
    if pending.is_empty() {
        return Ok(Settled::Verified(evidence));
    }
    if phase == Phase::Reconcile && !still_allowed(state, def, ae).await? {
        return Ok(Settled::Aborted(ReasonCode::PermissionDenied, evidence));
    }
    let mut unknown = false;
    for pubkey in pending {
        let tags = restriction_tags(mode, pubkey, until).ok_or_else(invalid)?;
        let event = control
            .sign_moderation(mode.kind(), "", &tags)
            .map_err(signing)?;
        match control.deliver_moderation(&state.relay_http, &event).await {
            Delivery::Accepted => {}
            Delivery::Rejected(why) => tracing::warn!(reason = %why, "Relay 拒绝审核命令"),
            Delivery::Limited(..) | Delivery::Unknown(_) => unknown = true,
        }
    }
    let Ok(after) = control.moderation_restricted(&state.relay_http).await else {
        return Ok(Settled::Unknown);
    };
    let reached = pubkeys
        .iter()
        .all(|pubkey| restriction_reached(&after, pubkey, mode, until, now));
    Ok(if reached {
        Settled::Verified(evidence)
    } else if unknown {
        Settled::Unknown
    } else {
        Settled::Aborted(ReasonCode::PublishRejected, evidence)
    })
}

#[derive(Debug, PartialEq, Eq)]
enum Progress {
    Done,
    Pending(Vec<String>),
    Conflict,
    Undetermined,
}

/// 9044 的目标状态：每条举报的状态等于冻结的 status。仍 open 的待发送；被他人以不同
/// 决定关闭即冲突；读取已达单次上界而找不到时不下结论。
fn resolution_progress(rows: &[ReportRow], ids: &[String], status: &str) -> Progress {
    let mut pending = Vec::new();
    for id in ids {
        match rows.iter().find(|row| &row.report_event_id == id) {
            Some(row) if row.status == status => {}
            Some(row) if row.status == "open" => pending.push(id.clone()),
            Some(_) => return Progress::Conflict,
            None if rows.len() >= wire::READ_LIMIT => return Progress::Undetermined,
            None => return Progress::Conflict,
        }
    }
    if pending.is_empty() {
        Progress::Done
    } else {
        Progress::Pending(pending)
    }
}

/// 9044：先读→逐条发送→回读。只记决定，不执法（执法由各自的受治理动作先行完成）。
async fn drive_resolution(
    state: &BffState,
    def: &Definition,
    ae: &Execution,
    phase: Phase,
) -> Result<Settled, Refusal> {
    let ids: Vec<String> = frozen(ae, "reportEventIds")
        .and_then(|ids| serde_json::from_value(ids.clone()).ok())
        .ok_or_else(invalid)?;
    let status = frozen(ae, "status")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    let action = frozen(ae, "resolutionAction").and_then(Value::as_str);
    let action = action.ok_or_else(invalid)?;
    let evidence: Vec<Evidence> = ids
        .iter()
        .map(|id| Evidence::new(EvidenceKind::BuzzEventId, id))
        .collect();
    let Ok(control) = control(state, ae.tenant_id).await else {
        return Ok(Settled::Unknown);
    };
    let Ok(before) = control.moderation_reports(&state.relay_http, None).await else {
        return Ok(Settled::Unknown);
    };
    let pending = match resolution_progress(&before, &ids, status) {
        Progress::Done => return Ok(Settled::Verified(evidence)),
        Progress::Conflict => {
            let reason = ReasonCode::TargetStateConflict;
            return Ok(Settled::Aborted(reason, evidence));
        }
        Progress::Undetermined => return Ok(Settled::Unknown),
        Progress::Pending(pending) => pending,
    };
    if phase == Phase::Reconcile && !still_allowed(state, def, ae).await? {
        return Ok(Settled::Aborted(ReasonCode::PermissionDenied, evidence));
    }
    let mut unknown = false;
    for id in &pending {
        let tags = wire::resolve_tags(id, status, action);
        let kind = wire::KIND_MODERATION_RESOLVE_REPORT;
        let event = control.sign_moderation(kind, "", &tags).map_err(signing)?;
        match control.deliver_moderation(&state.relay_http, &event).await {
            Delivery::Accepted => {}
            Delivery::Rejected(why) => tracing::warn!(reason = %why, "Relay 拒绝举报处理"),
            Delivery::Limited(..) | Delivery::Unknown(_) => unknown = true,
        }
    }
    let Ok(after) = control.moderation_reports(&state.relay_http, None).await else {
        return Ok(Settled::Unknown);
    };
    Ok(match resolution_progress(&after, &ids, status) {
        Progress::Done => Settled::Verified(evidence),
        Progress::Conflict => Settled::Aborted(ReasonCode::TargetStateConflict, evidence),
        Progress::Pending(_) if !unknown => Settled::Aborted(ReasonCode::PublishRejected, evidence),
        Progress::Pending(_) | Progress::Undetermined => Settled::Unknown,
    })
}

/// 既有治理对账节拍调用（`governance_reconcile`）：只处理已 ALLOWED、派发仍 UNKNOWN 且
/// 超过判定时限的审核动作，按上次尝试时间轮转。举报与删除只读查证，状态型命令先重新
/// 准入再按冻结目标重签。
pub(crate) async fn reconcile(state: &BffState, batch: i64) -> Result<(), Refusal> {
    let stale = state.governance.cfg.evaluation_timeout_seconds;
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "with selected as (
         select a.id from admission.action_execution a
         where a.action_key like 'moderation.%' and a.gate_state = 'ALLOWED'
           and a.dispatch_state = 'UNKNOWN'
           and a.updated_at < now() - make_interval(secs => $2::bigint)
         order by coalesce(a.reconcile_last_attempt_at, a.updated_at), a.id
         limit $1 for update of a skip locked)
         update admission.action_execution a set reconcile_last_attempt_at = now()
         from selected where a.id = selected.id returning a.id",
    )
    .bind(batch)
    .bind(stale)
    .fetch_all(&state.pool)
    .await?;
    for id in ids {
        if let Err(error) = reconcile_one(state, id).await {
            let reason = governance::wire(&error.reason());
            tracing::warn!(action_execution_id = %id, reason_code = %reason,
                state = "UNKNOWN", "审核动作对账未收敛；RB-05 保留原 operation");
        }
    }
    Ok(())
}

async fn reconcile_one(state: &BffState, id: Uuid) -> Result<(), Refusal> {
    let ae = load(state, id).await?;
    let version = ae.action_version;
    let def = governance::exact_definition(&state.pool, &ae.action_key, version).await?;
    drive(state, &def, id, Phase::Reconcile).await
}

// ---------------------------------------------------------------------------
// 新设备公钥继承限制（DD-125(2)、V-SCN-127）
// ---------------------------------------------------------------------------

/// 其他公钥中当前有效的最强限制。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Inherited {
    /// `Some(None)` 永久封禁，`Some(Some(t))` 封禁至 t
    ban: Option<Option<i64>>,
    /// 禁言至 t
    mute: Option<i64>,
}

/// 一行的封禁到期：`None` 未封禁，`Some(None)` 永久，`Some(Some(t))` 至 t。到期时刻不可
/// 解析按永久处理（fail closed）。
fn ban_expiry(row: &RestrictionRow) -> Option<Option<i64>> {
    row.banned.then(|| unix(row.ban_expires_at.as_deref()))
}

/// 永久封禁优先，否则取最晚到期；禁言取最晚到期。
fn inherited(rows: &[RestrictionRow], others: &[String], now: i64) -> Inherited {
    let mut wanted = Inherited::default();
    for row in rows.iter().filter(|row| others.contains(&row.pubkey)) {
        if let Some(expiry) = ban_expiry(row) {
            wanted.ban = Some(match (wanted.ban, expiry) {
                (Some(None), _) | (_, None) => None,
                (Some(Some(seen)), Some(expiry)) => Some(seen.max(expiry)),
                (None, Some(expiry)) => Some(expiry),
            });
        }
        if let Some(until) = unix(row.muted_until.as_deref()).filter(|until| *until > now) {
            wanted.mute = Some(wanted.mute.map_or(until, |seen| seen.max(until)));
        }
    }
    wanted
}

/// 新公钥尚未覆盖继承限制的命令（9040 / 9042）；为空即已一致。
fn inheritance_commands(
    rows: &[RestrictionRow],
    pubkey: &str,
    wanted: Inherited,
) -> Vec<(u32, Vec<Vec<String>>)> {
    let row = rows.iter().find(|row| row.pubkey == pubkey);
    let mut commands = Vec::new();
    if let Some(expiry) = wanted.ban {
        let covered = match (row.and_then(ban_expiry), expiry) {
            (Some(None), _) => true,
            (Some(Some(have)), Some(want)) => have >= want,
            _ => false,
        };
        if !covered {
            commands.push((wire::KIND_MODERATION_BAN, wire::ban_tags(pubkey, expiry)));
        }
    }
    if let Some(until) = wanted.mute {
        let have = row.and_then(|row| unix(row.muted_until.as_deref()));
        if have.is_none_or(|have| have < until) {
            let tags = wire::timeout_tags(pubkey, until);
            commands.push((wire::KIND_MODERATION_TIMEOUT, tags));
        }
    }
    commands
}

/// `BUZZ_IDENTITY_PROJECTION` 在新公钥投入 roster、进入 ACTIVE 之前调用：以 CONTROL 读取
/// 该 Principal 其他非 REVOKED 公钥的现行限制，施加于新公钥并回读。任何一步不能确认都回
/// 503，binding 保持 `RECONCILING`，由 Activity 按其重试上界继续。
pub(crate) async fn inherit_restrictions(
    state: &ServiceState,
    control: &IdentityClient,
    tenant: Uuid,
    principal: Uuid,
    pubkey: &str,
) -> Result<(), Response> {
    let others: Vec<String> = sqlx::query_scalar(
        "select pubkey from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2 and kind = 'HUMAN'
           and state <> 'REVOKED' and pubkey <> $3",
    )
    .bind(tenant)
    .bind(principal)
    .bind(pubkey)
    .fetch_all(&state.pool)
    .await
    .map_err(crate::service_api::unavailable)?;
    if others.is_empty() {
        return Ok(());
    }
    let unavailable = |error: OperatorError| {
        tracing::warn!(error = %error, "新公钥的限制继承不可查证");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    };
    let rows = control
        .moderation_restricted(&state.relay_http)
        .await
        .map_err(unavailable)?;
    let wanted = inherited(&rows, &others, now_secs());
    let commands = inheritance_commands(&rows, pubkey, wanted);
    if commands.is_empty() {
        return Ok(());
    }
    for (kind, tags) in commands {
        let event = control
            .sign_moderation(kind, "", &tags)
            .map_err(unavailable)?;
        if let Delivery::Rejected(why) = control.deliver_moderation(&state.relay_http, &event).await
        {
            tracing::warn!(reason = %why, "Relay 拒绝继承限制命令");
        }
    }
    let after = control
        .moderation_restricted(&state.relay_http)
        .await
        .map_err(unavailable)?;
    if inheritance_commands(&after, pubkey, wanted).is_empty() {
        Ok(())
    } else {
        tracing::warn!(pubkey, "新公钥尚未继承现行限制，保持 RECONCILING");
        Err(StatusCode::SERVICE_UNAVAILABLE.into_response())
    }
}

// ---------------------------------------------------------------------------
// PUBLISH_REJECTED 的结构化限制（V-SCN-129）
// ---------------------------------------------------------------------------

fn restriction_view(why: &str) -> Option<Value> {
    let restriction = wire::restriction_from_rejection(why)?;
    Some(match restriction {
        Restriction::Banned => json!({"kind": "BANNED"}),
        Restriction::TimedOut(until) => {
            let until = until.and_then(|secs| chrono::DateTime::from_timestamp(secs, 0));
            match until {
                Some(at) => {
                    let at = at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
                    json!({"kind": "TIMED_OUT", "until": at})
                }
                None => json!({"kind": "TIMED_OUT"}),
            }
        }
    })
}

/// Relay 拒绝本人发布：社区禁言/封禁带结构化 `restriction` 供原禁言横幅，其他拒绝保持
/// 原 `PUBLISH_REJECTED`。成员读不到限制列表，这里只转述 Relay 对这一次写入的拒绝。
pub(crate) fn publish_rejected(why: &str, operation_id: Option<Uuid>) -> Response {
    let mut body = json!({"class": "DENIED", "reason": "PUBLISH_REJECTED"});
    if let Some(operation) = operation_id {
        body["operationId"] = json!(operation.to_string());
    }
    if let Some(restriction) = restriction_view(why) {
        body["restriction"] = restriction;
    }
    let body: ErrorBody = match serde_json::from_value(body) {
        Ok(body) => body,
        Err(_) => ErrorBody {
            class: contracts::ErrorClass::Denied,
            reason: ReasonCode::PublishRejected,
            operation_id: operation_id.map(|o| o.to_string()),
            restriction: None,
        },
    };
    (StatusCode::FORBIDDEN, Json(body)).into_response()
}

// ---------------------------------------------------------------------------
// 共用
// ---------------------------------------------------------------------------

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

fn parse_uuid(value: &str) -> Result<Uuid, Refusal> {
    Uuid::parse_str(value).map_err(|_| invalid())
}

fn signing(error: OperatorError) -> Refusal {
    Refusal::Unavailable(format!("审核事件签名失败: {error}"))
}

/// CONTROL 客户端取不到：binding 不在 ACTIVE 是前置条件，其余是依赖不可用。
fn binding_refusal(response: Response) -> Refusal {
    if response.status() == StatusCode::FORBIDDEN {
        Refusal::Precondition(ReasonCode::BindingNotActive)
    } else {
        Refusal::Unavailable("Tenant CONTROL 身份不可用".into())
    }
}

/// 既有准入函数以 HTTP 回应表达拒绝；按其分类映射，不另造原因。
fn response_refusal(response: Response) -> Refusal {
    match response.status() {
        StatusCode::FORBIDDEN | StatusCode::NOT_FOUND => {
            Refusal::Denied(ReasonCode::ScopeGuardFailed)
        }
        StatusCode::SERVICE_UNAVAILABLE => Refusal::Unavailable("协作范围不可判定".into()),
        _ => Refusal::Precondition(ReasonCode::BindingNotActive),
    }
}

fn admission_refusal(failure: crate::web_transport::AdmissionFailure) -> Refusal {
    use crate::web_transport::AdmissionFailure;
    match failure {
        AdmissionFailure::Denied => Refusal::Denied(ReasonCode::ScopeGuardFailed),
        AdmissionFailure::BindingNotActive => Refusal::Precondition(ReasonCode::BindingNotActive),
        AdmissionFailure::Unavailable => Refusal::Unavailable("Workspace 准入不可判定".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn restriction(
        pubkey: &str,
        banned: bool,
        ban: Option<&str>,
        mute: Option<&str>,
    ) -> RestrictionRow {
        RestrictionRow {
            pubkey: pubkey.to_owned(),
            banned,
            ban_expires_at: ban.map(str::to_owned),
            muted_until: mute.map(str::to_owned),
            updated_at: "2026-10-19T08:00:00Z".to_owned(),
        }
    }

    fn report(id: &str, status: &str, target: &str) -> ReportRow {
        ReportRow {
            id: "00000000-0000-4000-8000-000000000001".to_owned(),
            report_event_id: id.to_owned(),
            reporter_pubkey: "e".repeat(64),
            target_kind: "event".to_owned(),
            target: target.to_owned(),
            channel_id: None,
            report_type: "spam".to_owned(),
            note: None,
            status: status.to_owned(),
            resolved_by: None,
            resolved_at: None,
            created_at: "2026-10-19T08:00:00Z".to_owned(),
        }
    }

    const NOW: i64 = 1_760_860_800; // 2025-10-19T08:00:00Z

    fn rfc3339(secs: i64) -> String {
        let at = chrono::DateTime::from_timestamp(secs, 0).unwrap();
        at.to_rfc3339()
    }

    #[test]
    fn command_fields_belong_to_their_own_action_and_need_explicit_confirmation() {
        let member = json!({"actionKey": BAN, "idempotencyKey": "k", "explicitConfirmation": true,
            "moderationMember": {"targetPubkey": "b"}});
        assert!(shape(BAN, &member).is_ok());
        let mut unconfirmed = member.clone();
        unconfirmed["explicitConfirmation"] = json!(false);
        assert!(shape(BAN, &unconfirmed).is_err());
        let mut foreign = member.clone();
        foreign["moderationEventId"] = json!("a");
        assert!(shape(BAN, &foreign).is_err());
        assert!(shape(MESSAGE_DELETE, &member).is_err());
        let delete = json!({"actionKey": MESSAGE_DELETE, "idempotencyKey": "k",
            "explicitConfirmation": true, "workspaceId": "w", "moderationEventId": "a"});
        assert!(shape(MESSAGE_DELETE, &delete).is_ok());
        assert_eq!(timeout_seconds("ONE_DAY"), Some(86_400));
        assert_eq!(timeout_seconds("SEVEN_DAYS"), Some(604_800));
        assert_eq!(timeout_seconds("TWO_DAYS"), None);
        assert!(ACTIONS.iter().all(|key| is_action(key)));
        assert!(!is_action("workspace.member.revoke"));
    }

    #[test]
    fn restriction_target_state_is_the_frozen_parameter() {
        let pk = "b".repeat(64);
        let banned = [restriction(&pk, true, None, None)];
        let temporary = [restriction(&pk, true, Some("2026-10-20T08:00:00Z"), None)];
        assert!(restriction_reached(&banned, &pk, Mode::Ban, None, NOW));
        assert!(!restriction_reached(&temporary, &pk, Mode::Ban, None, NOW));
        assert!(!restriction_reached(&banned, &pk, Mode::Unban, None, NOW));
        assert!(restriction_reached(&[], &pk, Mode::Unban, None, NOW));
        let until = NOW + 3_600;
        let at = rfc3339(until);
        let muted = [restriction(&pk, false, None, Some(&at))];
        assert!(restriction_reached(
            &muted,
            &pk,
            Mode::Timeout,
            Some(until),
            NOW
        ));
        let later = Some(until + 60);
        assert!(!restriction_reached(&muted, &pk, Mode::Timeout, later, NOW));
        // 已过期的冻结禁言是空目标：对账不再重签
        assert!(restriction_reached(
            &[],
            &pk,
            Mode::Timeout,
            Some(NOW - 1),
            NOW
        ));
        assert!(!restriction_reached(
            &muted,
            &pk,
            Mode::Untimeout,
            None,
            NOW
        ));
        assert!(restriction_reached(
            &banned,
            &pk,
            Mode::Untimeout,
            None,
            NOW
        ));
    }

    #[test]
    fn resolution_progress_distinguishes_pending_conflict_and_bound() {
        let (a, b) = ("a".repeat(64), "b".repeat(64));
        let (t, other) = (&"c".repeat(64), &"d".repeat(64));
        let ids = vec![a.clone(), b.clone()];
        let rows = vec![report(&a, "resolved", t), report(&b, "open", t)];
        let pending = resolution_progress(&rows, &ids, "resolved");
        assert_eq!(pending, Progress::Pending(vec![b.clone()]));
        let rows = vec![report(&a, "resolved", t), report(&b, "resolved", t)];
        let done = resolution_progress(&rows, &ids, "resolved");
        assert_eq!(done, Progress::Done);
        let rows = vec![report(&a, "dismissed", t), report(&b, "open", t)];
        let conflict = resolution_progress(&rows, &ids, "resolved");
        assert_eq!(conflict, Progress::Conflict);
        let full: Vec<ReportRow> = (0..wire::READ_LIMIT)
            .map(|n| report(&format!("{n:064x}"), "open", t))
            .collect();
        let missing = resolution_progress(&full, &ids, "resolved");
        assert_eq!(missing, Progress::Undetermined);
        let rows = vec![report(&a, "open", t), report(&b, "open", other)];
        let mixed = open_reports(&rows, &ids).unwrap();
        assert_eq!(mixed, Some(ReasonCode::InvalidParameters));
        let rows = vec![report(&a, "open", t), report(&b, "open", t)];
        assert_eq!(open_reports(&rows, &ids).unwrap(), None);
        assert!(open_reports(&full, &ids).is_err());
    }

    #[test]
    fn a_new_key_inherits_the_strongest_current_restriction() {
        let (old, other, new) = ("a".repeat(64), "b".repeat(64), "c".repeat(64));
        let others = vec![old.clone(), other.clone()];
        let until = NOW + 86_400;
        let at = rfc3339(until);
        let earlier = rfc3339(NOW + 60);
        let rows = vec![
            restriction(&old, false, None, Some(&at)),
            restriction(&other, false, None, Some(&earlier)),
        ];
        let wanted = inherited(&rows, &others, NOW);
        assert_eq!(wanted.mute, Some(until));
        assert_eq!(wanted.ban, None);
        let commands = inheritance_commands(&rows, &new, wanted);
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].0, wire::KIND_MODERATION_TIMEOUT);
        let mut applied = rows.clone();
        applied.push(restriction(&new, false, None, Some(&at)));
        assert!(inheritance_commands(&applied, &new, wanted).is_empty());
        let banned = vec![restriction(&old, true, None, None)];
        let wanted = inherited(&banned, &others, NOW);
        assert_eq!(wanted.ban, Some(None));
        let commands = inheritance_commands(&banned, &new, wanted);
        assert_eq!(commands[0].1, wire::ban_tags(&new, None));
        // 其他公钥没有限制、或只有新公钥自己的行：不发任何命令
        let wanted = inherited(&[], &others, NOW);
        assert!(inheritance_commands(&[], &new, wanted).is_empty());
    }

    #[test]
    fn relay_restriction_rejections_become_structured_publish_rejections() {
        let timed = "restricted: you are timed out until 1760864400";
        let expected = json!({"kind": "TIMED_OUT", "until": "2025-10-19T09:00:00Z"});
        assert_eq!(restriction_view(timed), Some(expected));
        let banned = "HTTP 403 blocked: you are banned from this community";
        assert_eq!(restriction_view(banned), Some(json!({"kind": "BANNED"})));
        let other = "invalid: event timestamp too far";
        assert_eq!(restriction_view(other), None);
    }
}
