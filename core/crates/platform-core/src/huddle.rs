//! DD-125(3) 原版 Huddle 的受治理入口（`.design/05` §2.11，V-SCN-131..134、158..161）。
//!
//! 四个动作键只接受 HUMAN 会话经 `/api/v1/actions` 发起：SYNC、确认 NONE（原版点击即
//! 发起）、无审批、quota `NONE`、`FULL_LIFECYCLE` 审计。Tenant CONTROL 只是签名者，
//! initiator 与 actor 是已准入的 HUMAN（DD-80）。Relay 的音频房间、参与者与归档是唯一
//! 权威；Core 只保存 `HuddleBuzzBinding`（`03` §2）与动作、审计。
//!
//! - `huddle.start`：父 Workspace（DECLARED_WORKSPACE：Workspace `discover`）或父私聊
//!   （Tenant `discover` 加当前参与者事实）。准入事务内预分配绑定与临时 Channel UUID、冻结
//!   发起会话本人的 ACTIVE HUMAN 公钥为创建者；派发由 CONTROL 签带 `creator` 的 9007
//!   投影并回读 discovery，再以 9000 `role=bot` 加入所选 Agent 并回读 roster。回读一致
//!   才 `ACTIVE`；Relay 明确拒绝投影即 `ERROR`；结果不明保留绑定按 Channel UUID 对账。
//! - `huddle.agent.add/remove`：父 Workspace；发起人须是该 Huddle 参与者且对 Installation
//!   有 `execute`，移除另接受父 Workspace `manage`。CONTROL 9000/9001 后回读。
//! - `huddle.end`：发起人或父 Workspace `manage`。CONTROL 以 9001 移出 Agent、归档临时
//!   频道并回读；Relay 随之关闭房间并补签 48103（SS-BUZ-GOVERNANCE）。
//!
//! 加入、离开与音频不是 Governed Action：Desktop 本机持钥直连（DD-75），Web 经
//! [`crate::huddle_audio`] 的同源音频桥。观察到 48103 或临时频道已归档即置 `ENDED`
//! （[`reconcile`]）；撤员与暂停沿既有收敛链调用 [`withdraw`] 与 [`archive_workspace`]。

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use collab_bridge::bridge::{Delivery, HuddleProjection, IdentityClient, Presence, Scope};
use collab_bridge::huddle as wire;
use contracts::{ActionCommand, ActionSubmission, EvidenceKind, ReasonCode};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::audit::Evidence;
use crate::bff::{resolve_execution_context, BffState, ExecutionContext};
use crate::governance::{
    self, Actor, Definition, Evaluation, Execution, Refusal, Target, EXECUTION_COLUMNS,
};
use crate::service_api::ServiceState;
use crate::spicedb::Consistency;
use crate::tenant_lifecycle::{control_client, ProjectionDirection};

pub(crate) const START: &str = "huddle.start";
pub(crate) const AGENT_ADD: &str = "huddle.agent.add";
pub(crate) const AGENT_REMOVE: &str = "huddle.agent.remove";
pub(crate) const END: &str = "huddle.end";

const ACTIONS: [&str; 4] = [START, AGENT_ADD, AGENT_REMOVE, END];

/// 每个命令都可携带的通用字段；其余字段只属于各自的动作键（确认为 NONE，不接受
/// `explicitConfirmation`）。
const COMMON_FIELDS: [&str; 2] = ["actionKey", "idempotencyKey"];

/// 原 `huddleChannelName.ts` 生成的名字至多这些字符（契约 `HuddleStartInput.channelName`）。
const CHANNEL_NAME_MAX_CHARS: usize = 100;

/// 父频道生命周期一次读取的上界；不高于 BFF 的单页上界。
const LIFECYCLE_PAGE: i64 = 200;

/// 存活查询（48104）等 Relay 回 EOSE 的上界。
const LIVENESS_WAIT: std::time::Duration = std::time::Duration::from_secs(3);

pub(crate) fn is_action(key: &str) -> bool {
    ACTIONS.contains(&key)
}

// ---------------------------------------------------------------------------
// HuddleBuzzBinding
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, sqlx::FromRow)]
pub(crate) struct Binding {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub parent_workspace_id: Option<Uuid>,
    pub parent_conversation_id: Option<Uuid>,
    pub parent_channel_id: Uuid,
    pub channel_id: Uuid,
    pub channel_name: String,
    pub initiator_principal_id: Uuid,
    pub creator_pubkey: String,
    pub agent_installation_resource_ids: Vec<Uuid>,
    pub operation_id: Uuid,
    pub state: String,
    pub version: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub ended_at: Option<chrono::DateTime<chrono::Utc>>,
}

const BINDING_COLUMNS: &str = "id, tenant_id, parent_workspace_id, parent_conversation_id,
     parent_channel_id, channel_id, channel_name, initiator_principal_id, creator_pubkey,
     agent_installation_resource_ids, operation_id, state, version, created_at, ended_at";

async fn load_binding(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    id: Uuid,
) -> Result<Option<Binding>, sqlx::Error> {
    sqlx::query_as(&format!(
        "select {BINDING_COLUMNS} from projection.huddle_buzz_binding
         where id = $1 and tenant_id = $2"
    ))
    .bind(id)
    .bind(tenant)
    .fetch_optional(pool)
    .await
}

fn rfc3339(at: chrono::DateTime<chrono::Utc>) -> String {
    at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn view(binding: &Binding) -> Result<contracts::HuddleView, Refusal> {
    let state = governance::parse(&binding.state)
        .ok_or_else(|| Refusal::Unavailable("Huddle 状态不在契约枚举内".into()))?;
    Ok(contracts::HuddleView {
        huddle_id: binding.id.to_string(),
        parent_workspace_id: binding.parent_workspace_id.map(|id| id.to_string()),
        parent_conversation_id: binding.parent_conversation_id.map(|id| id.to_string()),
        parent_channel_id: binding.parent_channel_id.to_string(),
        channel_id: binding.channel_id.to_string(),
        channel_name: binding.channel_name.clone(),
        initiator_principal_id: binding.initiator_principal_id.to_string(),
        creator_pubkey: binding.creator_pubkey.clone(),
        agent_installation_resource_ids: binding
            .agent_installation_resource_ids
            .iter()
            .map(Uuid::to_string)
            .collect(),
        state,
        version: i64::from(binding.version),
        operation_id: binding.operation_id.to_string(),
        created_at: rfc3339(binding.created_at),
        ended_at: binding.ended_at.map(rfc3339),
    })
}

// ---------------------------------------------------------------------------
// 命令解析
// ---------------------------------------------------------------------------

/// 目录形状与 05 §2.11 一致才执行；不一致即 `CAPABILITY_BLOCKED`。
fn definition_shape(def: &Definition) -> bool {
    let (workspace_rule, object) = match def.action_key.as_str() {
        START | END => ("DECLARED_WORKSPACE", "tenant"),
        AGENT_ADD | AGENT_REMOVE => ("WORKSPACE_REQUIRED", "workspace"),
        _ => return false,
    };
    def.component_type_key == "core"
        && def.target_type == "HUDDLE"
        && def.tenant_rule == "SESSION_TENANT"
        && def.workspace_rule == workspace_rule
        && def.permission == "discover"
        && def.permission_object_type == object
        && def.execution_mode == "SYNC"
        && def.confirmation_mode == "NONE"
        && def.approval_policy_id.is_none()
        && def.workflow_kind.is_none()
        && def.result_exposure == "NONE"
        && def.quota_policy == "NONE"
        && def.meters.is_empty()
}

/// 每个动作只接受自己的字段；缺必带字段或多出字段一律 `INVALID_PARAMETERS`。
fn shape(key: &str, raw: &Value) -> Result<(), Refusal> {
    let (own, required): (&[&str], &[&str]) = match key {
        START => (&["huddleStart", "workspaceId"], &["huddleStart"]),
        AGENT_ADD | AGENT_REMOVE => (
            &["huddleId", "huddleAgent", "workspaceId"],
            &["huddleId", "huddleAgent", "workspaceId"],
        ),
        END => (&["huddleId", "workspaceId"], &["huddleId"]),
        _ => return Err(invalid()),
    };
    let fields = raw.as_object().ok_or_else(invalid)?;
    for (name, value) in fields {
        let known = COMMON_FIELDS.contains(&name.as_str()) || own.contains(&name.as_str());
        if !value.is_null() && !known {
            return Err(invalid());
        }
    }
    if required
        .iter()
        .any(|name| fields.get(*name).is_none_or(Value::is_null))
    {
        return Err(invalid());
    }
    Ok(())
}

fn text<'a>(input: &'a Value, name: &str) -> Option<&'a str> {
    input.get(name).and_then(Value::as_str)
}

fn opt_uuid(input: &Value, name: &str) -> Result<Option<Uuid>, Refusal> {
    match input.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Uuid::parse_str(value).map(Some).map_err(|_| invalid()),
        Some(_) => Err(invalid()),
    }
}

fn req_uuid(input: &Value, name: &str) -> Result<Uuid, Refusal> {
    opt_uuid(input, name)?.ok_or_else(invalid)
}

fn is_hex64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// 原 Add agents 所选 Installation：唯一、至多 [`wire::MAX_HUDDLE_AGENTS`] 个。
fn agent_list(input: &Value) -> Result<Vec<Uuid>, Refusal> {
    let Some(listed) = input.get("agentInstallationResourceIds") else {
        return Ok(Vec::new());
    };
    if listed.is_null() {
        return Ok(Vec::new());
    }
    let listed = listed.as_array().ok_or_else(invalid)?;
    if listed.len() > wire::MAX_HUDDLE_AGENTS {
        return Err(invalid());
    }
    let mut agents: Vec<Uuid> = Vec::with_capacity(listed.len());
    for id in listed {
        let id = id
            .as_str()
            .and_then(|id| Uuid::parse_str(id).ok())
            .ok_or_else(invalid)?;
        if agents.contains(&id) {
            return Err(invalid());
        }
        agents.push(id);
    }
    Ok(agents)
}

/// 预分配的新绑定（`huddle.start` 准入事务内写入）。
struct NewBinding {
    id: Uuid,
    parent_workspace_id: Option<Uuid>,
    parent_conversation_id: Option<Uuid>,
    parent_channel_id: Uuid,
    channel_id: Uuid,
    channel_name: String,
    creator_pubkey: String,
    agents: Vec<Uuid>,
}

enum Plan {
    Start(NewBinding),
    Agent {
        binding: Box<Binding>,
        installation: Uuid,
        want: Presence,
    },
    End {
        binding: Box<Binding>,
    },
}

/// 准入前解析出的目标与冻结参数。
struct Resolved {
    target: Target,
    parameters: Value,
    /// 评估通过之后才成立的语义拒绝
    refusal: Option<ReasonCode>,
    plan: Plan,
}

async fn resolve(
    state: &BffState,
    ctx: &ExecutionContext,
    key: &str,
    raw: &Value,
) -> Result<Resolved, Refusal> {
    match key {
        START => resolve_start(state, ctx, raw).await,
        AGENT_ADD | AGENT_REMOVE => resolve_agent(state, ctx, key, raw).await,
        _ => resolve_end(state, ctx, raw).await,
    }
}

async fn resolve_start(
    state: &BffState,
    ctx: &ExecutionContext,
    raw: &Value,
) -> Result<Resolved, Refusal> {
    let input = &raw["huddleStart"];
    let workspace = opt_uuid(input, "parentWorkspaceId")?;
    let conversation = opt_uuid(input, "parentConversationId")?;
    // 恰有一个父；父 Workspace 即执行 Workspace，父私聊没有执行 Workspace
    if workspace.is_some() == conversation.is_some() || opt_uuid(raw, "workspaceId")? != workspace {
        return Err(invalid());
    }
    let name = text(input, "channelName")
        .map(str::trim)
        .filter(|name| (1..=CHANNEL_NAME_MAX_CHARS).contains(&name.chars().count()))
        .ok_or_else(invalid)?
        .to_owned();
    let agents = agent_list(input)?;
    if conversation.is_some() && !agents.is_empty() {
        // 私聊父的 Huddle 没有 Agent（DD-125(3)）
        return Err(invalid());
    }
    let mut refusal = None;
    let creator: Option<String> = match text(input, "creatorPubkey") {
        Some(pubkey) => {
            if !is_hex64(pubkey) {
                return Err(invalid());
            }
            sqlx::query_scalar(
                "select pubkey from identity.buzz_identity_binding
                 where tenant_id = $1 and principal_id = $2 and pubkey = $3
                   and kind = 'HUMAN' and state = 'ACTIVE'",
            )
            .bind(ctx.tenant_id)
            .bind(ctx.tenant_principal_id)
            .bind(pubkey)
            .fetch_optional(&state.pool)
            .await?
        }
        // Web 省略：本人唯一的 ACTIVE SERVER 公钥
        None => {
            sqlx::query_scalar(
                "select pubkey from identity.buzz_identity_binding
                 where tenant_id = $1 and principal_id = $2 and kind = 'HUMAN'
                   and custody = 'SERVER' and state = 'ACTIVE'",
            )
            .bind(ctx.tenant_id)
            .bind(ctx.tenant_principal_id)
            .fetch_optional(&state.pool)
            .await?
        }
    };
    if creator.is_none() {
        refusal = Some(ReasonCode::PermissionDenied);
    }
    let parent_channel_id: Uuid = if let Some(workspace) = workspace {
        let channel: Option<Uuid> = sqlx::query_scalar(
            "select b.channel_id from identity.workspace w
             join projection.workspace_buzz_binding b
               on b.workspace_id = w.id and b.state = 'ACTIVE'
             where w.id = $1 and w.tenant_id = $2",
        )
        .bind(workspace)
        .bind(ctx.tenant_id)
        .fetch_optional(&state.pool)
        .await?;
        channel.ok_or(Refusal::Precondition(ReasonCode::BindingNotActive))?
    } else {
        let row: Option<(Uuid, bool)> = sqlx::query_as(
            "select channel_id, $3 = any(participant_principal_ids)
             from projection.conversation_buzz_binding
             where id = $1 and tenant_id = $2 and state = 'ACTIVE'",
        )
        .bind(conversation)
        .bind(ctx.tenant_id)
        .bind(ctx.tenant_principal_id)
        .fetch_optional(&state.pool)
        .await?;
        let (channel, participant) =
            row.ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
        if !participant {
            refusal = Some(ReasonCode::ScopeGuardFailed);
        }
        channel
    };
    let new = NewBinding {
        id: Uuid::new_v4(),
        parent_workspace_id: workspace,
        parent_conversation_id: conversation,
        parent_channel_id,
        channel_id: Uuid::new_v4(),
        channel_name: name,
        creator_pubkey: creator.unwrap_or_default(),
        agents,
    };
    let parameters = json!({
        "huddleId": new.id,
        "channelId": new.channel_id,
        "parentChannelId": new.parent_channel_id,
        "parentWorkspaceId": new.parent_workspace_id,
        "parentConversationId": new.parent_conversation_id,
        "creatorPubkey": new.creator_pubkey,
        "agentInstallationResourceIds": new.agents,
        "channelName": new.channel_name,
    });
    Ok(Resolved {
        target: Target {
            id: new.id,
            version: 0,
            workspace_id: workspace,
        },
        parameters,
        refusal,
        plan: Plan::Start(new),
    })
}

async fn resolve_agent(
    state: &BffState,
    ctx: &ExecutionContext,
    key: &str,
    raw: &Value,
) -> Result<Resolved, Refusal> {
    let huddle = req_uuid(raw, "huddleId")?;
    let workspace = req_uuid(raw, "workspaceId")?;
    let installation = req_uuid(&raw["huddleAgent"], "agentInstallationResourceId")?;
    let binding = load_binding(&state.pool, ctx.tenant_id, huddle)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    if binding.parent_workspace_id != Some(workspace) {
        return Err(Refusal::Precondition(ReasonCode::TargetNotFound));
    }
    let want = if key == AGENT_ADD {
        Presence::Present
    } else {
        Presence::Absent
    };
    let refusal = (binding.state != "ACTIVE").then_some(ReasonCode::TargetStateConflict);
    let parameters = json!({
        "huddleId": huddle,
        "channelId": binding.channel_id,
        "agentInstallationResourceId": installation,
        "targetVersion": binding.version,
    });
    Ok(Resolved {
        target: Target {
            id: huddle,
            version: binding.version,
            workspace_id: Some(workspace),
        },
        parameters,
        refusal,
        plan: Plan::Agent {
            binding: Box::new(binding),
            installation,
            want,
        },
    })
}

async fn resolve_end(
    state: &BffState,
    ctx: &ExecutionContext,
    raw: &Value,
) -> Result<Resolved, Refusal> {
    let huddle = req_uuid(raw, "huddleId")?;
    let workspace = opt_uuid(raw, "workspaceId")?;
    let binding = load_binding(&state.pool, ctx.tenant_id, huddle)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    if binding.parent_workspace_id != workspace {
        return Err(invalid());
    }
    let refusal = (!matches!(binding.state.as_str(), "ACTIVE" | "PROVISIONING"))
        .then_some(ReasonCode::TargetStateConflict);
    let parameters = json!({
        "huddleId": huddle,
        "channelId": binding.channel_id,
        "targetVersion": binding.version,
    });
    Ok(Resolved {
        target: Target {
            id: huddle,
            version: binding.version,
            workspace_id: workspace,
        },
        parameters,
        refusal,
        plan: Plan::End {
            binding: Box::new(binding),
        },
    })
}

// ---------------------------------------------------------------------------
// 评估之后的语义判定（只读；任何发送都在准入落定之后）
// ---------------------------------------------------------------------------

/// `principal` 对 `<object_type>:<object>` 的 fresh 判定（FullyConsistent）。
async fn fresh(
    state: &BffState,
    principal: Uuid,
    object_type: &str,
    object: Uuid,
    permission: &str,
) -> Result<bool, Refusal> {
    let proof = state
        .governance
        .spicedb
        .check(
            object_type,
            &object.to_string(),
            permission,
            &principal.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Huddle fresh authorization 不可查证".into()))?;
    if proof.zed_token.is_empty() {
        return Err(Refusal::Unavailable(
            "Huddle authorization 缺 checked revision".into(),
        ));
    }
    Ok(proof.allowed)
}

/// 父 Workspace 中可加入 Huddle 的 Agent：ACTIVE Installation、ACTIVE ChannelAgentBinding、
/// ACTIVE 的 AGENT 公钥（原 Add agents 只列频道里的 Agent）。
async fn agent_pubkey(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    workspace: Uuid,
    installation: Uuid,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "select b.pubkey from catalog.agent_installation i
         join catalog.resource r on r.id = i.resource_id and r.tenant_id = $1
         join catalog.channel_agent_binding c
           on c.installation_resource_id = i.resource_id and c.workspace_id = i.workspace_id
          and c.status = 'ACTIVE'
         join identity.buzz_identity_binding b
           on b.tenant_id = r.tenant_id and b.principal_id = i.agent_principal_id
          and b.kind = 'AGENT' and b.state = 'ACTIVE'
         where i.resource_id = $3 and i.workspace_id = $2 and i.state = 'ACTIVE'",
    )
    .bind(tenant)
    .bind(workspace)
    .bind(installation)
    .fetch_optional(pool)
    .await
}

/// 移出时的 Agent 公钥：该 Installation 的 AGENT 身份不论状态（停用后仍要能移出）。
async fn agent_pubkeys_any(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    installation: Uuid,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        "select b.pubkey from catalog.agent_installation i
         join catalog.resource r on r.id = i.resource_id and r.tenant_id = $1
         join identity.buzz_identity_binding b
           on b.tenant_id = r.tenant_id and b.principal_id = i.agent_principal_id
          and b.kind = 'AGENT'
         where i.resource_id = $2
         order by b.pubkey",
    )
    .bind(tenant)
    .bind(installation)
    .fetch_all(pool)
    .await
}

/// 本人此刻是否是该 Huddle 的参与者：临时频道 roster 中有本人任一 ACTIVE HUMAN 公钥
/// （Relay 在加入音频时把父频道成员自动加为临时频道成员）。
async fn is_participant(
    state: &BffState,
    ctx: &ExecutionContext,
    binding: &Binding,
) -> Result<bool, Refusal> {
    let mine: Vec<String> = sqlx::query_scalar(
        "select pubkey from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2 and kind = 'HUMAN' and state = 'ACTIVE'",
    )
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .fetch_all(&state.pool)
    .await?;
    let control = control(
        &state.memory_service,
        ctx.tenant_id,
        ProjectionDirection::Establish,
    )
    .await?
    .with_budget(state.relay_budget.clone());
    let channel = binding.channel_id.to_string();
    let roster = control
        .roster(&state.relay_http, Scope::Channel(&channel))
        .await
        .map_err(|_| Refusal::Unavailable("Huddle 临时频道 roster 不可读".into()))?;
    Ok(roster.iter().any(|entry| mine.contains(&entry.pubkey)))
}

async fn check(
    state: &BffState,
    ctx: &ExecutionContext,
    resolved: &Resolved,
) -> Result<Option<ReasonCode>, Refusal> {
    if let Some(reason) = &resolved.refusal {
        return Ok(Some(reason.clone()));
    }
    let principal = ctx.tenant_principal_id;
    match &resolved.plan {
        Plan::Start(new) => {
            let Some(workspace) = new.parent_workspace_id else {
                return Ok(None);
            };
            for installation in &new.agents {
                let pool = &state.pool;
                if agent_pubkey(pool, ctx.tenant_id, workspace, *installation)
                    .await?
                    .is_none()
                {
                    return Ok(Some(ReasonCode::TargetNotFound));
                }
                if !fresh(state, principal, "resource", *installation, "execute").await? {
                    return Ok(Some(ReasonCode::PermissionDenied));
                }
            }
            Ok(None)
        }
        Plan::Agent {
            binding,
            installation,
            want,
        } => {
            let workspace = binding.parent_workspace_id.ok_or_else(invalid)?;
            let listed = binding
                .agent_installation_resource_ids
                .contains(installation);
            if *want == Presence::Present {
                let pool = &state.pool;
                if agent_pubkey(pool, ctx.tenant_id, workspace, *installation)
                    .await?
                    .is_none()
                {
                    return Ok(Some(ReasonCode::TargetNotFound));
                }
                let full = binding.agent_installation_resource_ids.len() >= wire::MAX_HUDDLE_AGENTS;
                if !listed && full {
                    return Ok(Some(ReasonCode::TargetStateConflict));
                }
            }
            // 移出另接受父 Workspace manage（DD-125(3)）
            if *want == Presence::Absent
                && fresh(state, principal, "workspace", workspace, "manage").await?
            {
                return Ok(None);
            }
            if !fresh(state, principal, "resource", *installation, "execute").await?
                || !is_participant(state, ctx, binding).await?
            {
                return Ok(Some(ReasonCode::PermissionDenied));
            }
            Ok(None)
        }
        Plan::End { binding } => {
            if binding.initiator_principal_id == principal {
                return Ok(None);
            }
            // 非发起人只有父 Workspace manage 可以结束；私聊父的 Huddle 只有发起人
            let Some(workspace) = binding.parent_workspace_id else {
                return Ok(Some(ReasonCode::PermissionDenied));
            };
            let manage = fresh(state, principal, "workspace", workspace, "manage").await?;
            Ok((!manage).then_some(ReasonCode::PermissionDenied))
        }
    }
}

// ---------------------------------------------------------------------------
// 提交
// ---------------------------------------------------------------------------

/// `/api/v1/actions` 的 Huddle 消费者（`governance_api::submit_action`）。
pub(crate) async fn submit(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &ActionCommand,
) -> Result<(StatusCode, ActionSubmission), (Refusal, Option<Uuid>)> {
    let ae = command(state, ctx, cmd).await.map_err(|e| (e, None))?;
    let (status, mut submission) = governance::submission_result(&ae)?;
    if ae.action_key == START {
        submission.huddle_id = Some(ae.target_id.to_string());
    }
    Ok((status, submission))
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
    let key = Uuid::parse_str(&cmd.idempotency_key).map_err(|_| invalid())?;
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
        tracing::error!(action = %def.action_key, "Huddle 动作的目录形状与 05 §2.11 不一致");
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
    let ae = match admit(state, ctx, intent, &resolved.plan).await? {
        Admission::Opened(ae) => ae,
        Admission::Raced(ae) => return replay(state, &cmd.action_key, &digest, ae).await,
    };
    if let Err(error) = drive(state, &def, ae.id, Phase::First).await {
        // 结论没有写下：原 operation 保持 UNKNOWN，由对账收敛，绝不在这里重发
        let reason = governance::wire(&error.reason());
        tracing::warn!(action_execution_id = %ae.id, reason_code = %reason, "Huddle 动作派发未收敛");
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

/// 同一幂等键重发：只回答原 operation，参数不同即 `IDEMPOTENCY_KEY_REUSED`。结果不明
/// 时先做一次对账（重新准入后按冻结目标收敛；9007 以同一 Channel UUID 重发由 Relay 判为
/// 已存在而不另建）。
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
            tracing::warn!(action_execution_id = %ae.id, reason_code = %reason, "Huddle 对账未收敛");
        }
        return load(state, ae.id).await;
    }
    Ok(ae)
}

async fn load(state: &BffState, id: Uuid) -> Result<Execution, Refusal> {
    governance::load_execution(&state.pool, id)
        .await?
        .ok_or_else(|| Refusal::Unavailable("Huddle operation 不可查证".into()))
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

/// Tenant 行锁下复核幂等键：两个并发请求只有一个能打开 ActionExecution。同一 Huddle
/// 上另一条未决动作占着目标时是 `TARGET_STATE_CONFLICT`。
async fn open(
    tx: &mut Transaction<'_, Postgres>,
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
    match governance::open_execution_values(
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
    .await
    {
        Ok(ae) => Ok(Admission::Opened(ae)),
        Err(sqlx::Error::Database(e))
            if e.constraint() == Some("action_execution_one_pending_per_target") =>
        {
            Err(Refusal::Conflict(ReasonCode::TargetStateConflict))
        }
        Err(e) => Err(e.into()),
    }
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

/// 准入通过：ALLOWED、判定与审计、`huddle.start` 的预分配绑定与 DISPATCH 意图同事务
/// 落定。此后任何崩溃都只会让这条 operation 停在 UNKNOWN，由对账按 Channel UUID 收敛。
async fn admit(
    state: &BffState,
    ctx: &ExecutionContext,
    intent: Intent<'_>,
    plan: &Plan,
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
    if let Plan::Start(new) = plan {
        sqlx::query(
            "insert into projection.huddle_buzz_binding
                 (id, tenant_id, parent_workspace_id, parent_conversation_id, parent_channel_id,
                  channel_id, channel_name, initiator_principal_id, creator_pubkey,
                  agent_installation_resource_ids, operation_id, action_execution_id, state)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'PROVISIONING')",
        )
        .bind(new.id)
        .bind(ctx.tenant_id)
        .bind(new.parent_workspace_id)
        .bind(new.parent_conversation_id)
        .bind(new.parent_channel_id)
        .bind(new.channel_id)
        .bind(&new.channel_name)
        .bind(ctx.tenant_principal_id)
        .bind(&new.creator_pubkey)
        .bind(&new.agents)
        .bind(ae.operation_id)
        .bind(ae.id)
        .execute(&mut *tx)
        .await?;
        evidence.push(Evidence::new(EvidenceKind::BuzzPubkey, &new.creator_pubkey));
    }
    let pending = Err(StatusCode::SERVICE_UNAVAILABLE);
    governance::record_dispatch(&mut tx, ae.id, def.audit_class(), pending, evidence).await?;
    tx.commit().await?;
    Ok(Admission::Opened(ae))
}

// ---------------------------------------------------------------------------
// 派发与对账
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// 准入落定后的首次派发：判定刚刚完成，不再重复
    First,
    /// 结果不明后的对账：重新发送任何命令之前先重新准入
    Reconcile,
}

/// 对一条已 ALLOWED 的 Huddle 动作得到的结论。
enum Settled {
    /// 回读一致；`agents` 是 `huddle.start` 实际加入的 Installation
    Verified {
        evidence: Vec<Evidence>,
        agents: Option<Vec<Uuid>>,
    },
    Aborted(ReasonCode, Vec<Evidence>),
    Unknown,
}

fn verified(evidence: Vec<Evidence>) -> Settled {
    Settled::Verified {
        evidence,
        agents: None,
    }
}

/// 该 Tenant 的 CONTROL 客户端。binding 不在 ACTIVE 是前置条件，其余是依赖不可用。
async fn control(
    state: &ServiceState,
    tenant: Uuid,
    direction: ProjectionDirection,
) -> Result<IdentityClient, Refusal> {
    let (client, _) = control_client(state, tenant, direction)
        .await
        .map_err(|response| {
            if response.status() == StatusCode::FORBIDDEN {
                Refusal::Precondition(ReasonCode::BindingNotActive)
            } else {
                Refusal::Unavailable("Tenant CONTROL 身份不可用".into())
            }
        })?;
    Ok(client)
}

/// 派发或对账一条已 ALLOWED、派发未决的 Huddle 动作。
async fn drive(state: &BffState, def: &Definition, id: Uuid, phase: Phase) -> Result<(), Refusal> {
    let ae = load(state, id).await?;
    if ae.gate_state != "ALLOWED" || ae.dispatch_state != "UNKNOWN" {
        return Ok(());
    }
    let binding = load_binding(&state.pool, ae.tenant_id, ae.target_id)
        .await?
        .ok_or_else(|| Refusal::Unavailable("Huddle 绑定缺失".into()))?;
    let direction = if ae.action_key == END || ae.action_key == AGENT_REMOVE {
        ProjectionDirection::Withdraw
    } else {
        ProjectionDirection::Establish
    };
    let control = match control(&state.memory_service, ae.tenant_id, direction).await {
        Ok(control) => control.with_budget(state.relay_budget.clone()),
        Err(Refusal::Precondition(reason)) if phase == Phase::First => {
            return settle(state, def, &ae, Settled::Aborted(reason, Vec::new())).await;
        }
        Err(_) => return Ok(()),
    };
    if phase == Phase::Reconcile && !still_allowed(state, def, &ae).await? {
        let aborted = Settled::Aborted(ReasonCode::PermissionDenied, Vec::new());
        return settle(state, def, &ae, aborted).await;
    }
    let settled = match ae.action_key.as_str() {
        START => drive_start(state, &control, &binding).await?,
        AGENT_ADD | AGENT_REMOVE => drive_agent(state, &control, &ae, &binding).await?,
        _ => drive_end(state, &control, &binding).await?,
    };
    settle(state, def, &ae, settled).await
}

/// 对账时重新准入：发起人此刻仍持有该动作的 fresh 授权。
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
    Ok(state
        .governance
        .evaluate(actor, def, &target)
        .await?
        .allowed)
}

/// 9007 投影 → 回读 discovery → 逐个 9000 `role=bot` → 回读 roster。
async fn drive_start(
    state: &BffState,
    control: &IdentityClient,
    binding: &Binding,
) -> Result<Settled, Refusal> {
    let evidence = vec![Evidence::new(
        EvidenceKind::BuzzPubkey,
        &binding.creator_pubkey,
    )];
    if binding.state != "PROVISIONING" {
        // 投影已被结束或判定：不再向一个已结束的 Huddle 签任何事件
        return Ok(Settled::Aborted(ReasonCode::TargetStateConflict, evidence));
    }
    let channel = binding.channel_id.to_string();
    match control
        .ensure_huddle_channel(
            &state.relay_http,
            &channel,
            &binding.channel_name,
            &binding.creator_pubkey,
        )
        .await
    {
        Ok(HuddleProjection::Ready) => {}
        Ok(HuddleProjection::Rejected(why)) => {
            tracing::warn!(reason = %why, huddle = %binding.id, "Relay 拒绝 Huddle 临时频道投影");
            return Ok(Settled::Aborted(ReasonCode::PublishRejected, evidence));
        }
        Err(e) => {
            tracing::warn!(error = %e, huddle = %binding.id, "Huddle 临时频道投影结果不明，留给对账");
            return Ok(Settled::Unknown);
        }
    }
    let workspace = binding.parent_workspace_id;
    let mut added = Vec::with_capacity(binding.agent_installation_resource_ids.len());
    for installation in &binding.agent_installation_resource_ids {
        let Some(workspace) = workspace else { break };
        // 准入之后被停用的 Agent 不再加入（原版只加此刻在频道里的 Agent）
        let Some(pubkey) =
            agent_pubkey(&state.pool, binding.tenant_id, workspace, *installation).await?
        else {
            continue;
        };
        let scope = Scope::Channel(&channel);
        let present = Presence::Present;
        if let Err(e) = control
            .converge_with_role(&state.relay_http, scope, &pubkey, present, Some("bot"))
            .await
        {
            tracing::warn!(error = %e, huddle = %binding.id, "Huddle Agent 加入未收敛，留给对账");
            return Ok(Settled::Unknown);
        }
        added.push(*installation);
    }
    Ok(Settled::Verified {
        evidence,
        agents: Some(added),
    })
}

/// CONTROL 9000 `role=bot` / 9001 并回读 roster。
async fn drive_agent(
    state: &BffState,
    control: &IdentityClient,
    ae: &Execution,
    binding: &Binding,
) -> Result<Settled, Refusal> {
    let installation = frozen(ae, "agentInstallationResourceId")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or_else(invalid)?;
    if binding.state != "ACTIVE" {
        return Ok(Settled::Aborted(
            ReasonCode::TargetStateConflict,
            Vec::new(),
        ));
    }
    let channel = binding.channel_id.to_string();
    let workspace = binding.parent_workspace_id.ok_or_else(invalid)?;
    let (pubkeys, want, role) = if ae.action_key == AGENT_ADD {
        let pubkey = agent_pubkey(&state.pool, binding.tenant_id, workspace, installation).await?;
        let Some(pubkey) = pubkey else {
            return Ok(Settled::Aborted(ReasonCode::TargetNotFound, Vec::new()));
        };
        (vec![pubkey], Presence::Present, Some("bot"))
    } else {
        let pubkeys = agent_pubkeys_any(&state.pool, binding.tenant_id, installation).await?;
        (pubkeys, Presence::Absent, None)
    };
    let evidence: Vec<Evidence> = pubkeys
        .iter()
        .map(|pubkey| Evidence::new(EvidenceKind::BuzzPubkey, pubkey))
        .collect();
    for pubkey in &pubkeys {
        let scope = Scope::Channel(&channel);
        if let Err(e) = control
            .converge_with_role(&state.relay_http, scope, pubkey, want, role)
            .await
        {
            tracing::warn!(error = %e, huddle = %binding.id, "Huddle Agent roster 未收敛，留给对账");
            return Ok(Settled::Unknown);
        }
    }
    Ok(verified(evidence))
}

/// 9001 移出 Agent → 9002 归档 → 回读。Relay 归档时关闭房间并补签 48103。
async fn drive_end(
    state: &BffState,
    control: &IdentityClient,
    binding: &Binding,
) -> Result<Settled, Refusal> {
    if binding.state == "ENDED" {
        return Ok(verified(Vec::new()));
    }
    let channel = binding.channel_id.to_string();
    let archived = match control.channel_archived(&state.relay_http, &channel).await {
        Ok(archived) => archived,
        Err(e) => {
            tracing::warn!(error = %e, huddle = %binding.id, "Huddle 临时频道状态不可读，留给对账");
            return Ok(Settled::Unknown);
        }
    };
    match archived {
        Some(true) => return Ok(verified(Vec::new())),
        // 投影从未落地（仍 PROVISIONING 且 Relay 上没有该频道）：没有可归档的频道
        None if binding.state == "PROVISIONING" => return Ok(verified(Vec::new())),
        _ => {}
    }
    for installation in &binding.agent_installation_resource_ids {
        for pubkey in agent_pubkeys_any(&state.pool, binding.tenant_id, *installation).await? {
            let scope = Scope::Channel(&channel);
            if let Err(e) = control
                .converge(&state.relay_http, scope, &pubkey, Presence::Absent)
                .await
            {
                // 原版先移出 Agent 再归档；归档本身就结束房间，移出未收敛不阻止结束
                tracing::info!(error = %e, huddle = %binding.id, "结束前移出 Huddle Agent 未收敛");
            }
        }
    }
    match control
        .converge_channel_archived(&state.relay_http, &channel, true)
        .await
    {
        Ok(true) => Ok(verified(Vec::new())),
        Ok(false) => Ok(Settled::Unknown),
        Err(e) => {
            tracing::warn!(error = %e, huddle = %binding.id, "Huddle 临时频道归档结果不明，留给对账");
            Ok(Settled::Unknown)
        }
    }
}

fn outcome_code(key: &str) -> &'static str {
    match key {
        START => "HUDDLE_STARTED",
        AGENT_ADD => "HUDDLE_AGENT_ADDED",
        AGENT_REMOVE => "HUDDLE_AGENT_REMOVED",
        _ => "HUDDLE_ENDED",
    }
}

/// 写下确定结论与绑定状态：VERIFIED → DISPATCHED；拒绝或确定失败 → ABORTED 并保留原因码；
/// 不明不写，留给对账。只推进仍 UNKNOWN 的行，重复调用无害。
async fn settle(
    state: &BffState,
    def: &Definition,
    ae: &Execution,
    settled: Settled,
) -> Result<(), Refusal> {
    let (reason, evidence, agents) = match settled {
        Settled::Unknown => return Ok(()),
        Settled::Verified { evidence, agents } => (None, evidence, agents),
        Settled::Aborted(reason, evidence) => (Some(reason), evidence, None),
    };
    let mut tx = state.pool.begin().await?;
    let current = governance::lock_execution(&mut tx, ae.id).await?;
    if current.gate_state != "ALLOWED" || current.dispatch_state != "UNKNOWN" {
        return Ok(());
    }
    let class = def.audit_class();
    match reason {
        None => {
            apply(&mut tx, &current, agents).await?;
            governance::record_dispatch(&mut tx, current.id, class, Ok(()), evidence.clone())
                .await?;
            let result = outcome_code(&current.action_key);
            governance::audit(
                &mut tx, &current, def, "outcome", "OUTCOME", "ALLOW", result, None, evidence,
            )
            .await?;
        }
        Some(reason) => {
            if current.action_key == START {
                sqlx::query(
                    "update projection.huddle_buzz_binding
                     set state = 'ERROR', version = version + 1, updated_at = now()
                     where id = $1 and state = 'PROVISIONING'",
                )
                .bind(current.target_id)
                .execute(&mut *tx)
                .await?;
            }
            let refused = Err(StatusCode::CONFLICT);
            governance::record_dispatch(&mut tx, current.id, class, refused, evidence.clone())
                .await?;
            let code = governance::wire(&reason);
            sqlx::query("update admission.action_execution set reason_code = $2 where id = $1")
                .bind(current.id)
                .bind(&code)
                .execute(&mut *tx)
                .await?;
            governance::audit(
                &mut tx, &current, def, "outcome", "OUTCOME", "DENY", &code, None, evidence,
            )
            .await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

/// 回读一致后的绑定变化。
async fn apply(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    agents: Option<Vec<Uuid>>,
) -> Result<(), Refusal> {
    let installation = frozen(ae, "agentInstallationResourceId")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok());
    match ae.action_key.as_str() {
        START => {
            sqlx::query(
                "update projection.huddle_buzz_binding
                 set state = 'ACTIVE', agent_installation_resource_ids = $2,
                     version = version + 1, updated_at = now()
                 where id = $1 and state = 'PROVISIONING'",
            )
            .bind(ae.target_id)
            .bind(agents.unwrap_or_default())
            .execute(&mut **tx)
            .await?;
        }
        AGENT_ADD => {
            sqlx::query(
                "update projection.huddle_buzz_binding
                 set agent_installation_resource_ids =
                         case when $2 = any(agent_installation_resource_ids)
                              then agent_installation_resource_ids
                              else array_append(agent_installation_resource_ids, $2) end,
                     version = version + 1, updated_at = now()
                 where id = $1 and state = 'ACTIVE'",
            )
            .bind(ae.target_id)
            .bind(installation.ok_or_else(invalid)?)
            .execute(&mut **tx)
            .await?;
        }
        AGENT_REMOVE => {
            sqlx::query(
                "update projection.huddle_buzz_binding
                 set agent_installation_resource_ids =
                         array_remove(agent_installation_resource_ids, $2),
                     version = version + 1, updated_at = now()
                 where id = $1 and state = 'ACTIVE'",
            )
            .bind(ae.target_id)
            .bind(installation.ok_or_else(invalid)?)
            .execute(&mut **tx)
            .await?;
        }
        _ => {
            end_binding(tx, ae.target_id).await?;
        }
    }
    Ok(())
}

async fn end_binding(tx: &mut Transaction<'_, Postgres>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update projection.huddle_buzz_binding
         set state = 'ENDED', ended_at = now(), version = version + 1, updated_at = now()
         where id = $1 and state in ('PROVISIONING', 'ACTIVE')",
    )
    .bind(id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// 既有治理对账节拍调用（`governance_reconcile`）：
/// 1. 已 ALLOWED、派发仍 UNKNOWN 且超过判定时限的 Huddle 动作，先重新准入再按冻结目标
///    收敛（9007 同一 Channel UUID 重发不另建）；
/// 2. ACTIVE 绑定的结束观察：临时频道已归档，或父频道有创建者/Relay 签的 48103，即 `ENDED`。
pub(crate) async fn reconcile(state: &BffState, batch: i64) -> Result<(), Refusal> {
    let stale = state.governance.cfg.evaluation_timeout_seconds;
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "with selected as (
         select a.id from admission.action_execution a
         where a.action_key like 'huddle.%' and a.gate_state = 'ALLOWED'
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
                state = "UNKNOWN", "Huddle 动作对账未收敛；RB-05 保留原 operation");
        }
    }
    observe_ended(&state.memory_service, batch).await
}

async fn reconcile_one(state: &BffState, id: Uuid) -> Result<(), Refusal> {
    let ae = load(state, id).await?;
    let version = ae.action_version;
    let def = governance::exact_definition(&state.pool, &ae.action_key, version).await?;
    drive(state, &def, id, Phase::Reconcile).await
}

/// ACTIVE 绑定按上次观察时间轮转，只读 Relay：已归档或已有 48103 即 `ENDED`。
async fn observe_ended(state: &ServiceState, batch: i64) -> Result<(), Refusal> {
    let rows: Vec<(Uuid, Uuid, Uuid, Uuid, String)> = sqlx::query_as(
        "with selected as (
         select h.id from projection.huddle_buzz_binding h
         where h.state = 'ACTIVE'
         order by h.observed_at nulls first, h.id
         limit $1 for update of h skip locked)
         update projection.huddle_buzz_binding h set observed_at = now()
         from selected where h.id = selected.id
         returning h.id, h.tenant_id, h.parent_channel_id, h.channel_id, h.creator_pubkey",
    )
    .bind(batch)
    .fetch_all(&state.pool)
    .await?;
    for (id, tenant, parent, channel, creator) in rows {
        let Ok(control) = control(state, tenant, ProjectionDirection::Withdraw).await else {
            continue;
        };
        let channel_text = channel.to_string();
        let archived = control.channel_archived(&state.relay_http, &channel_text).await;
        let ended = match archived {
            Ok(Some(true)) => true,
            Ok(_) => {
                let relay = relay_self(&state.pool, tenant).await?;
                let filter = json!({
                    "kinds": [wire::KIND_HUDDLE_ENDED],
                    "#h": [parent.to_string()],
                    "limit": LIFECYCLE_PAGE,
                });
                match control.query(&state.relay_http, &[filter]).await {
                    Ok(page) => serde_json::from_value::<Vec<nostr::Event>>(page)
                        .unwrap_or_default()
                        .iter()
                        .any(|event| {
                            wire::lifecycle_event(
                                event,
                                &parent.to_string(),
                                channel,
                                &creator,
                                relay.as_deref(),
                            )
                            .is_some()
                        }),
                    Err(_) => false,
                }
            }
            Err(e) => {
                tracing::info!(error = %e, huddle = %id, "Huddle 结束观察本轮读不到临时频道");
                false
            }
        };
        if ended {
            let mut tx = state.pool.begin().await?;
            end_binding(&mut tx, id).await?;
            tx.commit().await?;
        }
    }
    Ok(())
}

async fn relay_self(pool: &sqlx::PgPool, tenant: Uuid) -> Result<Option<String>, sqlx::Error> {
    let value: Option<Option<String>> = sqlx::query_scalar(
        "select relay_self_pubkey from projection.tenant_buzz_binding where tenant_id = $1",
    )
    .bind(tenant)
    .fetch_optional(pool)
    .await?;
    Ok(value.flatten())
}

// ---------------------------------------------------------------------------
// 撤权与暂停（`10` §、V-SCN-132）
// ---------------------------------------------------------------------------

/// 撤出的范围：一个父 Workspace 下的 Huddle，或整个 Tenant（含父私聊的 Huddle）。
#[derive(Debug, Clone, Copy)]
pub(crate) enum Withdraw {
    Workspace(Uuid),
    Tenant,
}

/// 撤员链：以 CONTROL 9001 把该成员的全部公钥移出范围内仍在进行的 Huddle 临时频道，
/// Relay 随之关闭其音频连接。任一未收敛即整体未收敛（调用方按既有重试上界重试）；已归档
/// 的临时频道没有可移出的连接，跳过。
pub(crate) async fn withdraw(
    state: &ServiceState,
    control: &IdentityClient,
    tenant: Uuid,
    scope: Withdraw,
    pubkeys: &[String],
) -> Result<(), String> {
    let workspace = match scope {
        Withdraw::Workspace(workspace) => Some(workspace),
        Withdraw::Tenant => None,
    };
    let channels: Vec<Uuid> = sqlx::query_scalar(
        "select channel_id from projection.huddle_buzz_binding
         where tenant_id = $1 and state in ('PROVISIONING', 'ACTIVE')
           and ($2::uuid is null or parent_workspace_id = $2)
         order by created_at, id",
    )
    .bind(tenant)
    .bind(workspace)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    for channel in channels {
        let channel = channel.to_string();
        match control.channel_archived(&state.relay_http, &channel).await {
            Ok(Some(true)) | Ok(None) => continue,
            Ok(Some(false)) => {}
            Err(e) => return Err(e.to_string()),
        }
        for pubkey in pubkeys {
            control
                .converge(
                    &state.relay_http,
                    Scope::Channel(&channel),
                    pubkey,
                    Presence::Absent,
                )
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Workspace 暂停先归档其全部进行中的 Huddle 临时频道（V-SCN-132）：Relay 关闭房间并补签
/// 48103，绑定置 `ENDED`。
pub(crate) async fn archive_workspace(
    state: &ServiceState,
    control: &IdentityClient,
    tenant: Uuid,
    workspace: Uuid,
) -> Result<(), String> {
    let rows: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "select id, channel_id from projection.huddle_buzz_binding
         where tenant_id = $1 and parent_workspace_id = $2
           and state in ('PROVISIONING', 'ACTIVE')
         order by created_at, id",
    )
    .bind(tenant)
    .bind(workspace)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    for (id, channel) in rows {
        let channel = channel.to_string();
        let ended = match control.channel_archived(&state.relay_http, &channel).await {
            // 投影从未落地：没有频道，也没有房间
            Ok(None) => true,
            Ok(Some(true)) => true,
            Ok(Some(false)) => control
                .converge_channel_archived(&state.relay_http, &channel, true)
                .await
                .map_err(|e| e.to_string())?,
            Err(e) => return Err(e.to_string()),
        };
        if !ended {
            return Err(format!("Huddle 临时频道 {channel} 归档回读未达目标"));
        }
        let mut tx = state.pool.begin().await.map_err(|e| e.to_string())?;
        end_binding(&mut tx, id).await.map_err(|e| e.to_string())?;
        tx.commit().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// BFF 读取与本人发布
// ---------------------------------------------------------------------------

/// 父 scope 的准入结果：父频道与 Community host。
struct Parent {
    channel_id: String,
    community_host: String,
}

/// 读取与本人发布的共同前提：本人对父 Workspace（协作成员）或父私聊（当前参与者）仍有
/// 准入，且父频道仍是绑定记录的那一个。
async fn admit_parent(
    state: &BffState,
    ctx: &ExecutionContext,
    binding: &Binding,
) -> Result<Parent, Response> {
    let (channel_id, community_host) =
        match (binding.parent_workspace_id, binding.parent_conversation_id) {
            (Some(workspace), None) => {
                let scope = crate::web_transport::admit_workspace(state, ctx, workspace).await?;
                (scope.channel_id, scope.community_host)
            }
            (None, Some(conversation)) => {
                let scope = crate::conversations::admit(state, ctx, conversation).await?;
                (scope.channel_id, scope.community_host)
            }
            _ => return Err(StatusCode::FORBIDDEN.into_response()),
        };
    if channel_id != binding.parent_channel_id.to_string() {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    Ok(Parent {
        channel_id,
        community_host,
    })
}

pub(crate) async fn context(
    state: &BffState,
    headers: &HeaderMap,
) -> Result<ExecutionContext, Response> {
    let ctx = resolve_execution_context(state, headers).await?;
    if ctx.access_mode != contracts::PlatformSessionAccessMode::Full {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed).respond(None));
    }
    Ok(ctx)
}

async fn visible_binding(
    state: &BffState,
    ctx: &ExecutionContext,
    huddle: Uuid,
) -> Result<(Binding, Parent), Response> {
    let binding = load_binding(&state.pool, ctx.tenant_id, huddle)
        .await
        .map_err(|e| Refusal::from(e).respond(None))?
        // 不存在与不可见同一个回答
        .ok_or_else(|| StatusCode::FORBIDDEN.into_response())?;
    let parent = admit_parent(state, ctx, &binding).await?;
    Ok((binding, parent))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListQuery {
    parent_workspace_id: Option<Uuid>,
    parent_conversation_id: Option<Uuid>,
}

/// `GET /api/v1/huddles?parentWorkspaceId=…|parentConversationId=…`：父频道中尚未结束的
/// Huddle（原 HuddleIndicator / HuddleAttachment 的进行中状态）。
pub async fn list(
    State(state): State<BffState>,
    headers: HeaderMap,
    query: Result<Query<ListQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let ctx = match context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let Ok(Query(query)) = query else {
        return invalid().respond(None);
    };
    let channel = match (query.parent_workspace_id, query.parent_conversation_id) {
        (Some(workspace), None) => {
            match crate::web_transport::admit_workspace(&state, &ctx, workspace).await {
                Ok(scope) => scope.channel_id,
                Err(response) => return response,
            }
        }
        (None, Some(conversation)) => {
            match crate::conversations::admit(&state, &ctx, conversation).await {
                Ok(scope) => scope.channel_id,
                Err(response) => return response,
            }
        }
        _ => return invalid().respond(None),
    };
    let Ok(channel) = Uuid::parse_str(&channel) else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let rows: Result<Vec<Binding>, _> = sqlx::query_as(&format!(
        "select {BINDING_COLUMNS} from projection.huddle_buzz_binding
         where tenant_id = $1 and parent_channel_id = $2
           and state in ('PROVISIONING', 'ACTIVE')
         order by created_at desc, id
         limit 50"
    ))
    .bind(ctx.tenant_id)
    .bind(channel)
    .fetch_all(&state.pool)
    .await;
    let rows = match rows {
        Ok(rows) => rows,
        Err(e) => return Refusal::from(e).respond(None),
    };
    match rows.iter().map(view).collect::<Result<Vec<_>, _>>() {
        Ok(items) => Json(contracts::HuddlePage { items }).into_response(),
        Err(refusal) => refusal.respond(None),
    }
}

/// `GET /api/v1/huddles/{huddle_id}`。
pub async fn read(
    State(state): State<BffState>,
    Path(huddle): Path<Uuid>,
    headers: HeaderMap,
) -> Response {
    let ctx = match context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    match visible_binding(&state, &ctx, huddle).await {
        Ok((binding, _)) => match view(&binding) {
            Ok(view) => Json(view).into_response(),
            Err(refusal) => refusal.respond(None),
        },
        Err(response) => response,
    }
}

/// `GET /api/v1/huddles/voice`：Web 转写与朗读的可用性（V-SCN-160）。Huddle 语音推理
/// 服务尚未部署登记（`apps/07`），按原版“仅语音模式”两项均不可用，通话不受影响。
pub async fn voice(State(state): State<BffState>, headers: HeaderMap) -> Response {
    if let Err(response) = context(&state, &headers).await {
        return response;
    }
    Json(contracts::HuddleVoiceView {
        transcription: contracts::HuddleVoiceAvailability::Unavailable,
        speech: contracts::HuddleVoiceAvailability::Unavailable,
    })
    .into_response()
}

/// 以本人 SERVER 身份连 Relay 的 HTTP bridge（DD-39）。
async fn own_client(
    state: &BffState,
    ctx: &ExecutionContext,
    parent: &Parent,
) -> Result<(nostr::Keys, IdentityClient), Response> {
    crate::web_transport::community_limits(state, &parent.community_host)
        .await
        .map_err(IntoResponse::into_response)?;
    let keys = crate::web_transport::actor_keys(state, ctx).await?;
    let client = crate::web_transport::community_client(state, &keys, &parent.community_host)?;
    Ok((keys, client))
}

/// `GET /api/v1/huddles/{huddle_id}/lifecycle`：父频道 48100–48103（按原签名者校验）与
/// Relay 合成的 48104 存活（V-SCN-158）。
pub async fn lifecycle(
    State(state): State<BffState>,
    Path(huddle): Path<Uuid>,
    headers: HeaderMap,
) -> Response {
    let ctx = match context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let (binding, parent) = match visible_binding(&state, &ctx, huddle).await {
        Ok(found) => found,
        Err(response) => return response,
    };
    let (keys, client) = match own_client(&state, &ctx, &parent).await {
        Ok(found) => found,
        Err(response) => return response,
    };
    let relay = match relay_self(&state.pool, ctx.tenant_id).await {
        Ok(relay) => relay,
        Err(e) => return Refusal::from(e).respond(None),
    };
    let limit = LIFECYCLE_PAGE.min(state.message_page_limit);
    let page = match client
        .query(
            &state.relay_http,
            &[wire::lifecycle_filter(&parent.channel_id, limit)],
        )
        .await
    {
        Ok(page) => page,
        Err(e) => return crate::web_transport::relay_error_response(&e, None),
    };
    let channel = binding.channel_id;
    let mut events: Vec<wire::LifecycleEvent> = serde_json::from_value::<Vec<nostr::Event>>(page)
        .unwrap_or_default()
        .iter()
        .filter_map(|event| {
            wire::lifecycle_event(
                event,
                &parent.channel_id,
                channel,
                &binding.creator_pubkey,
                relay.as_deref(),
            )
        })
        .collect();
    events.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.event_id.cmp(&b.event_id))
    });
    let live = binding.state == "ACTIVE"
        && liveness(
            &state,
            &ctx,
            &parent,
            &keys,
            &channel.to_string(),
            relay.as_deref(),
        )
        .await;
    let events = events
        .into_iter()
        .map(|event| contracts::HuddleLifecycleEvent {
            event_id: event.event_id,
            kind: i64::from(event.kind),
            pubkey: event.pubkey,
            created_at: event.created_at,
            ephemeral_channel_id: event.ephemeral_channel_id.to_string(),
            participant_pubkey: event.participant_pubkey,
            roster_revision: event.roster_revision,
            admission_id: event.admission_id,
            generation: event.generation,
        })
        .collect();
    Json(contracts::HuddleLifecyclePage { events, live }).into_response()
}

/// 48104 只在 WebSocket REQ 上合成（`req.rs::handle_huddle_liveness_req`）：沿本会话的
/// 已认证连接发一次只含 48104 的 REQ，等到 EOSE 或上界即止。读不到按“不在进行”回答。
async fn liveness(
    state: &BffState,
    ctx: &ExecutionContext,
    parent: &Parent,
    keys: &nostr::Keys,
    channel: &str,
    relay: Option<&str>,
) -> bool {
    let Ok(limits) = crate::web_transport::community_limits(state, &parent.community_host).await
    else {
        return false;
    };
    let key = collab_bridge::stream::SessionKey {
        session: ctx.session_id.to_string(),
        community_host: parent.community_host.clone(),
        pubkey: keys.public_key().to_hex(),
    };
    let filter = wire::liveness_filter(&parent.channel_id, channel);
    let Ok(mut subscription) = state
        .relay_sessions
        .subscribe(key, keys, vec![filter], &limits)
        .await
    else {
        return false;
    };
    let mut events = Vec::new();
    let deadline = tokio::time::Instant::now() + LIVENESS_WAIT;
    loop {
        match tokio::time::timeout_at(deadline, subscription.next()).await {
            Ok(Some(collab_bridge::stream::Frame::Event(event))) => events.push(event),
            Ok(Some(collab_bridge::stream::Frame::EndOfStored)) => break,
            _ => return false,
        }
    }
    wire::is_live(&Value::Array(events), channel, relay)
}

/// Web 音频桥的准入结果：本人 SERVER 身份的客户端与临时频道、父频道。
pub(crate) struct AudioAdmission {
    pub client: IdentityClient,
    pub channel: Uuid,
    pub parent: Uuid,
}

/// 音频桥建立前的准入（V-SCN-158）：绑定 `ACTIVE`、本人对父 scope 仍有准入、Community
/// binding 与 NIP-11 一致、本人有 ACTIVE 的 SERVER 身份。
pub(crate) async fn admit_audio(
    state: &BffState,
    ctx: &ExecutionContext,
    huddle: Uuid,
) -> Result<AudioAdmission, Response> {
    let (binding, parent) = visible_binding(state, ctx, huddle).await?;
    if binding.state != "ACTIVE" {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict).respond(None));
    }
    let (_, client) = own_client(state, ctx, &parent).await?;
    Ok(AudioAdmission {
        client,
        channel: binding.channel_id,
        parent: binding.parent_channel_id,
    })
}

/// 已建立的音频桥周期重新准入：会话仍有效、父 scope 仍可进入、绑定仍 `ACTIVE`。
pub(crate) async fn audio_still_admitted(
    state: &BffState,
    headers: &HeaderMap,
    huddle: Uuid,
) -> bool {
    let Ok(ctx) = context(state, headers).await else {
        return false;
    };
    matches!(
        visible_binding(state, &ctx, huddle).await,
        Ok((binding, _)) if binding.state == "ACTIVE"
    )
}

/// 本人身份发一条事件：Relay 接受或回读到即成功。
async fn deliver_once(
    state: &BffState,
    client: &IdentityClient,
    event: &nostr::Event,
) -> Result<bool, Response> {
    let admitted = client
        .admit()
        .map_err(|e| crate::web_transport::relay_error_response(&e, None))?;
    match client.deliver(&state.relay_http, event, admitted).await {
        Delivery::Accepted => Ok(true),
        Delivery::Rejected(why) => {
            tracing::info!(reason = %why, kind = event.kind.as_u16(), "Relay 拒绝本人 Huddle 事件");
            Err(Refusal::Denied(ReasonCode::PublishRejected).respond(None))
        }
        Delivery::Limited(..) => Err(Refusal::Limit(ReasonCode::RateLimited).respond(None)),
        Delivery::Unknown(why) => {
            tracing::warn!(error = %why, "本人 Huddle 事件发送结果不明，按事件 ID 回读");
            Ok(client
                .event_exists(&state.relay_http, &event.id.to_hex())
                .await
                .unwrap_or(false))
        }
    }
}

/// `POST /api/v1/huddles/{huddle_id}/announcement`：Web 创建者的 48106 与 48100
/// （DD-125(3)）。两条事件各签一次并随绑定持久化；重试只重投同一事件，不重签（DD-81）。
/// 48106 按原版尽力发布；48100 是父频道卡片与音频准入依赖的创建者链接。
pub async fn announce(
    State(state): State<BffState>,
    Path(huddle): Path<Uuid>,
    headers: HeaderMap,
) -> Response {
    let ctx = match context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let (binding, parent) = match visible_binding(&state, &ctx, huddle).await {
        Ok(found) => found,
        Err(response) => return response,
    };
    if binding.initiator_principal_id != ctx.tenant_principal_id {
        return Refusal::Denied(ReasonCode::PermissionDenied).respond(None);
    }
    if binding.state != "ACTIVE" {
        return Refusal::Conflict(ReasonCode::TargetStateConflict).respond(None);
    }
    let (keys, client) = match own_client(&state, &ctx, &parent).await {
        Ok(found) => found,
        Err(response) => return response,
    };
    // 原生端创建者自己签这两条；Web 只能代签本人 SERVER 公钥创建的 Huddle
    if keys.public_key().to_hex() != binding.creator_pubkey {
        return Refusal::Denied(ReasonCode::PermissionDenied).respond(None);
    }
    let (guidelines, started) = match announcement_events(&state, &client, &binding).await {
        Ok(events) => events,
        Err(refusal) => return refusal.respond(None),
    };
    if let Err(response) = deliver_once(&state, &client, &guidelines).await {
        // 原 `start_huddle` 的 48106 是尽力发布：失败不阻止发现链接
        tracing::info!(status = %response.status(), huddle = %binding.id, "48106 未送达");
    }
    let delivered = match deliver_once(&state, &client, &started).await {
        Ok(delivered) => delivered,
        Err(response) => return response,
    };
    let view = contracts::HuddleAnnouncementView {
        started_event_id: started.id.to_hex(),
        started_delivered: delivered,
        guidelines_event_id: Some(guidelines.id.to_hex()),
    };
    let status = if delivered {
        StatusCode::OK
    } else {
        StatusCode::ACCEPTED
    };
    (status, Json(view)).into_response()
}

/// 已持久化的两条签名事件；第一次调用时签名并在行锁下写入，之后只读回。
async fn announcement_events(
    state: &BffState,
    client: &IdentityClient,
    binding: &Binding,
) -> Result<(nostr::Event, nostr::Event), Refusal> {
    let mut tx = state.pool.begin().await?;
    let stored: Option<(Option<Value>, Option<Value>)> = sqlx::query_as(
        "select guidelines_event, started_event from projection.huddle_buzz_binding
         where id = $1 and tenant_id = $2 for update",
    )
    .bind(binding.id)
    .bind(binding.tenant_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(stored) = stored else {
        return Err(Refusal::Precondition(ReasonCode::TargetNotFound));
    };
    if let (Some(guidelines), Some(started)) = stored {
        let parse = |value: Value| {
            serde_json::from_value::<nostr::Event>(value)
                .map_err(|_| Refusal::Unavailable("Huddle 公告事件损坏".into()))
        };
        return Ok((parse(guidelines)?, parse(started)?));
    }
    let channel = binding.channel_id.to_string();
    let parent = binding.parent_channel_id.to_string();
    let sign = |kind: u32, content: &str, tags: &[Vec<String>]| {
        let kind = u16::try_from(kind).map_err(|_| invalid())?;
        client
            .sign(kind, content, tags)
            .map_err(|e| Refusal::Unavailable(format!("Huddle 公告签名失败: {e}")))
    };
    let guidelines = sign(
        wire::KIND_HUDDLE_GUIDELINES,
        &wire::voice_mode_guidelines(&parent),
        &wire::guidelines_tags(&channel),
    )?;
    let started = sign(
        wire::KIND_HUDDLE_STARTED,
        &wire::lifecycle_content(&channel),
        &wire::started_tags(&parent),
    )?;
    let as_json = |event: &nostr::Event| {
        serde_json::to_value(event)
            .map_err(|_| Refusal::Unavailable("Huddle 公告事件序列化失败".into()))
    };
    sqlx::query(
        "update projection.huddle_buzz_binding
         set guidelines_event = $3, started_event = $4, updated_at = now()
         where id = $1 and tenant_id = $2",
    )
    .bind(binding.id)
    .bind(binding.tenant_id)
    .bind(as_json(&guidelines)?)
    .bind(as_json(&started)?)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok((guidelines, started))
}

/// `POST /api/v1/huddles/{huddle_id}/leave`：原 `leave_huddle` 在仍有其他人类成员时以本人
/// 身份发 9022 退出临时频道（Relay 只在临时频道内接受成员 9022）。最后一人只断开音频，
/// 由 Relay 归档并签 48103，不走这里。
pub async fn leave(
    State(state): State<BffState>,
    Path(huddle): Path<Uuid>,
    headers: HeaderMap,
) -> Response {
    let ctx = match context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let (binding, parent) = match visible_binding(&state, &ctx, huddle).await {
        Ok(found) => found,
        Err(response) => return response,
    };
    if binding.state != "ACTIVE" {
        return StatusCode::NO_CONTENT.into_response();
    }
    let (_, client) = match own_client(&state, &ctx, &parent).await {
        Ok(found) => found,
        Err(response) => return response,
    };
    let channel = binding.channel_id.to_string();
    let event = match client.sign(
        wire::KIND_NIP29_LEAVE_REQUEST as u16,
        "",
        &wire::leave_tags(&channel),
    ) {
        Ok(event) => event,
        Err(e) => return Refusal::Unavailable(e.to_string()).respond(None),
    };
    match deliver_once(&state, &client, &event).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::ACCEPTED.into_response(),
        Err(response) => response,
    }
}

// ---------------------------------------------------------------------------
// 共用
// ---------------------------------------------------------------------------

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn def(key: &str, rule: &str, object: &str) -> Definition {
        Definition {
            action_key: key.to_owned(),
            version: 1,
            component_type_key: "core".into(),
            target_type: "HUDDLE".into(),
            tenant_rule: "SESSION_TENANT".into(),
            workspace_rule: rule.into(),
            permission: "discover".into(),
            permission_object_type: object.into(),
            confirmation_mode: "NONE".into(),
            approval_policy_id: None,
            approval_policy_version: None,
            workflow_kind: None,
            result_exposure: "NONE".into(),
            execution_mode: "SYNC".into(),
            quota_policy: "NONE".into(),
            meters: Vec::new(),
            role_template_key: None,
            role_template_version: None,
        }
    }

    #[test]
    fn catalog_shape_is_the_05_policy() {
        assert!(definition_shape(&def(
            START,
            "DECLARED_WORKSPACE",
            "tenant"
        )));
        assert!(definition_shape(&def(END, "DECLARED_WORKSPACE", "tenant")));
        assert!(definition_shape(&def(
            AGENT_ADD,
            "WORKSPACE_REQUIRED",
            "workspace"
        )));
        assert!(!definition_shape(&def(
            AGENT_ADD,
            "DECLARED_WORKSPACE",
            "tenant"
        )));
        let mut confirmed = def(START, "DECLARED_WORKSPACE", "tenant");
        confirmed.confirmation_mode = "EXPLICIT".into();
        assert!(!definition_shape(&confirmed));
        assert!(!definition_shape(&def(
            "huddle.join",
            "DECLARED_WORKSPACE",
            "tenant"
        )));
        assert!(ACTIONS.iter().all(|key| is_action(key)));
    }

    #[test]
    fn commands_carry_only_their_own_fields() {
        let start = json!({"actionKey": START, "idempotencyKey": "k",
            "huddleStart": {"channelName": "x huddle"}});
        assert!(shape(START, &start).is_ok());
        let mut confirmed = start.clone();
        confirmed["explicitConfirmation"] = json!(true);
        assert!(shape(START, &confirmed).is_err());
        let mut foreign = start.clone();
        foreign["huddleId"] = json!("h");
        assert!(shape(START, &foreign).is_err());
        let add = json!({"actionKey": AGENT_ADD, "idempotencyKey": "k", "huddleId": "h",
            "workspaceId": "w", "huddleAgent": {"agentInstallationResourceId": "a"}});
        assert!(shape(AGENT_ADD, &add).is_ok());
        let mut no_workspace = add.clone();
        no_workspace["workspaceId"] = Value::Null;
        assert!(shape(AGENT_ADD, &no_workspace).is_err());
        let end = json!({"actionKey": END, "idempotencyKey": "k", "huddleId": "h"});
        assert!(shape(END, &end).is_ok());
        assert!(shape(END, &add).is_err());
    }

    #[test]
    fn agent_list_is_unique_and_bounded_by_the_original_limit() {
        let id = |n: usize| format!("00000000-0000-4000-8000-{n:012}");
        let ok = json!({"agentInstallationResourceIds": [id(1), id(2)]});
        assert_eq!(agent_list(&ok).unwrap().len(), 2);
        assert!(agent_list(&json!({})).unwrap().is_empty());
        let twice = json!({"agentInstallationResourceIds": [id(1), id(1)]});
        assert!(agent_list(&twice).is_err());
        let many: Vec<String> = (0..=wire::MAX_HUDDLE_AGENTS).map(id).collect();
        assert!(agent_list(&json!({"agentInstallationResourceIds": many})).is_err());
        assert!(agent_list(&json!({"agentInstallationResourceIds": ["x"]})).is_err());
    }

    #[test]
    fn views_round_trip_the_binding_state() {
        let now = chrono::Utc::now();
        let binding = Binding {
            id: Uuid::new_v4(),
            tenant_id: Uuid::new_v4(),
            parent_workspace_id: None,
            parent_conversation_id: Some(Uuid::new_v4()),
            parent_channel_id: Uuid::new_v4(),
            channel_id: Uuid::new_v4(),
            channel_name: "a <> b huddle".into(),
            initiator_principal_id: Uuid::new_v4(),
            creator_pubkey: "a".repeat(64),
            agent_installation_resource_ids: Vec::new(),
            operation_id: Uuid::new_v4(),
            state: "ENDED".into(),
            version: 3,
            created_at: now,
            ended_at: Some(now),
        };
        let view = view(&binding).unwrap();
        assert_eq!(view.state, contracts::HuddleState::Ended);
        assert!(view.parent_workspace_id.is_none());
        assert!(view.ended_at.is_some());
        let mut unknown = binding;
        unknown.state = "RECONCILING".into();
        assert!(super::view(&unknown).is_err());
    }
}
