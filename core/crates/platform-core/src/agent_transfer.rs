//! DD-42、DD-131(2)(3)(4)(5)(7)(8)、05 §2.3/§2.12、06 §7.1：Agent 与团队快照的两段式
//! `RESOURCE_EXPORT` / `RESOURCE_IMPORT`。
//!
//! 导出在源 Tenant 生成 ExportPackage Asset（owner 是发起 HUMAN），只在 READY 且当前
//! 可 `read` 时下载；导入只接收同一 PlatformSession 上传的包字节并重算 digest，在一次
//! Workflow 中创建新的 AgentDefinition 与 DRAFT AgentVersion（团队另建引用它们的新
//! `agent.team`），不发布、不安装，任一成员非法整包不提交。包内 owner、公钥、Tenant、
//! ACL、URL 与运行配置一律不被信任；导出不读取、不携带记忆或任何 SecretRef。

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::{ErrorClass, EvidenceKind, ReasonCode};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use super::agent_catalog::{self, Team};
use super::{
    lock_execution, Actor, Definition, Execution, Governance, Params, Refusal, Semantic, Target,
};
use crate::agent_snapshot::{self as snapshot, Encoding, Kind, Member};
use crate::bff::{resolve_execution_context, BffState, ExecutionContext};
use crate::service_api::ServiceState;
use crate::spicedb::Consistency;

pub(crate) const EXPORT_KIND: &str = "RESOURCE_EXPORT";
pub(crate) const IMPORT_KIND: &str = "RESOURCE_IMPORT";
/// 本会话上传暂存的有效期：足够完成预览与确认，过期即清空字节。
const UPLOAD_TTL_SECONDS: i64 = 30 * 60;

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}

pub(crate) fn is_export(action: &str) -> bool {
    matches!(action, "agent.definition.export" | "agent.team.export")
}

pub(crate) fn is_import(action: &str) -> bool {
    matches!(action, "agent.definition.import" | "agent.team.import")
}

fn kind_of(action: &str) -> Kind {
    if action.starts_with("agent.team.") {
        Kind::Team
    } else {
        Kind::Agent
    }
}

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

pub(super) fn normalize_import(
    input: &contracts::AgentSnapshotImportInput,
) -> Result<Value, Refusal> {
    let upload = Uuid::parse_str(&input.upload_id).map_err(|_| invalid())?;
    let route = Uuid::parse_str(&input.model_route_resource_id).map_err(|_| invalid())?;
    let digest = input.content_digest.as_str();
    let profile = input.runtime_profile_key.trim();
    if upload.is_nil()
        || route.is_nil()
        || digest.len() != 64
        || !digest
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        || profile.is_empty()
    {
        return Err(invalid());
    }
    Ok(json!({"uploadId": upload, "contentDigest": digest,
        "runtimeProfileKey": profile, "modelRouteResourceId": route}))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ImportInput {
    pub upload_id: Uuid,
    pub content_digest: String,
    pub runtime_profile_key: String,
    pub model_route_resource_id: Uuid,
}

pub(super) fn import_input(p: &Params) -> Option<ImportInput> {
    let v = p.snapshot_import.as_ref()?;
    let text = |k: &str| v.get(k).and_then(Value::as_str);
    Some(ImportInput {
        upload_id: Uuid::parse_str(text("uploadId")?).ok()?,
        content_digest: text("contentDigest")?.to_owned(),
        runtime_profile_key: text("runtimeProfileKey")?.to_owned(),
        model_route_resource_id: Uuid::parse_str(text("modelRouteResourceId")?).ok()?,
    })
}

pub(super) fn export_encoding(p: &Params) -> Option<Encoding> {
    Encoding::from_wire(p.snapshot_export.as_ref()?.get("encoding")?.as_str()?)
}

// ---------------------------------------------------------------------------
// 目标与准入
// ---------------------------------------------------------------------------

/// 导出定义时指定的版本须是该定义的 PUBLISHED AgentVersion（DD-131(2)）。
pub(super) async fn definition_export_version(
    conn: &mut PgConnection,
    tenant: Uuid,
    definition: Uuid,
    p: &Params,
    lock: bool,
) -> Result<(), Refusal> {
    let asset = p.asset_id.ok_or_else(invalid)?;
    crate::agent_version::version(conn, tenant, asset, lock)
        .await?
        .filter(|v| {
            v.agent_resource_id == definition
                && v.state == "PUBLISHED"
                && v.asset_state == "PUBLISHED"
                && v.projection_action_execution_id.is_none()
        })
        .ok_or_else(conflict)?;
    Ok(())
}

/// 团队导出取各成员当前已发布版本；任一成员没有已发布版本或不可用即整包拒绝。
pub(super) async fn team_export_members(
    conn: &mut PgConnection,
    tenant: Uuid,
    team: &Team,
) -> Result<Vec<(Uuid, Uuid)>, Refusal> {
    let rows: Vec<(Uuid, Option<Uuid>)> = sqlx::query_as(
        "select r.id,a.current_published_version_asset_id from catalog.resource r
         join catalog.agent_definition a on a.resource_id=r.id
         where r.tenant_id=$1 and r.id=any($2) and r.type_key='agent.definition' and r.state='ACTIVE'
           and r.projection_action_execution_id is null",
    )
    .bind(tenant)
    .bind(&team.members)
    .fetch_all(&mut *conn)
    .await?;
    team.members
        .iter()
        .map(|m| {
            rows.iter()
                .find(|(id, _)| id == m)
                .and_then(|(id, version)| version.map(|v| (*id, v)))
                .ok_or_else(conflict)
        })
        .collect()
}

#[derive(sqlx::FromRow)]
struct Upload {
    id: Uuid,
    session_id: Uuid,
    principal_id: Uuid,
    snapshot_kind: String,
    encoding: String,
    content_digest: String,
    byte_size: i32,
    content: Option<Vec<u8>>,
    consumed_by_action_execution_id: Option<Uuid>,
}

async fn upload(
    conn: &mut PgConnection,
    tenant: Uuid,
    id: Uuid,
    lock: bool,
) -> Result<Option<Upload>, sqlx::Error> {
    sqlx::query_as(&format!(
        "select id,session_id,principal_id,snapshot_kind,encoding,content_digest,byte_size,content,
         consumed_by_action_execution_id from admission.agent_snapshot_upload
         where id=$1 and tenant_id=$2 and expires_at>now(){}",
        if lock { " for update" } else { "" }
    ))
    .bind(id)
    .bind(tenant)
    .fetch_optional(conn)
    .await
}

pub(super) async fn import_target(
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    sem: Semantic,
    p: &Params,
    frozen: Option<Uuid>,
) -> Result<Target, Refusal> {
    let input = import_input(p).ok_or_else(invalid)?;
    let kind = if sem == Semantic::AgentTeamImport {
        Kind::Team
    } else {
        Kind::Agent
    };
    let row = upload(conn, tenant, input.upload_id, false)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    if row.principal_id != initiator
        || row.content.is_none()
        || row.consumed_by_action_execution_id.is_some()
        || row.snapshot_kind != kind.wire()
        || row.content_digest != input.content_digest
    {
        return Err(conflict());
    }
    Ok(Target {
        id: frozen.unwrap_or_else(Uuid::new_v4),
        version: 0,
        workspace_id: None,
    })
}

/// BFF 提交导入前：包必须由本 PlatformSession 上传（DD-42「目标 Tenant 新会话」）。
pub(crate) async fn check_session(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &contracts::ActionCommand,
) -> Result<(), Refusal> {
    let input = cmd.snapshot_import.as_ref().ok_or_else(invalid)?;
    let id = Uuid::parse_str(&input.upload_id).map_err(|_| invalid())?;
    let mut conn = state.pool.acquire().await?;
    let row = upload(&mut conn, ctx.tenant_id, id, false)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    if row.session_id != ctx.session_id || row.principal_id != ctx.tenant_principal_id {
        return Err(Refusal::Precondition(ReasonCode::TargetNotFound));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// owner 审批（05 §2.12：Definition 导出 TARGET_OWNER，团队导出 ALL_AFFECTED_OWNERS）
// ---------------------------------------------------------------------------

pub(super) fn owner_policy(action: &str, policy: &super::Policy) -> bool {
    let requirement = match action {
        "agent.definition.export" => "TARGET_OWNER",
        "agent.team.export" => "ALL_AFFECTED_OWNERS",
        _ => return false,
    };
    policy.owner_requirement == requirement
        && policy.self_approval == "ALLOW"
        && policy.role_requirements.is_empty()
}

/// 冻结受影响 owner：被导出对象本身，团队另加各成员定义（按目标去重，同一 owner 的多份
/// 引用由同一个决定满足）。
pub(super) async fn freeze_owners(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
) -> Result<Vec<contracts::AffectedOwnerRef>, Refusal> {
    let mut targets = vec![ae.target_id];
    if ae.action_key == "agent.team.export" {
        let t = agent_catalog::team(tx, ae.tenant_id, ae.target_id, true)
            .await?
            .ok_or_else(conflict)?;
        targets.extend(t.members.iter().copied().filter(|m| *m != t.id));
    }
    let mut refs = Vec::with_capacity(targets.len());
    for id in targets {
        let row: Option<(i32, Uuid)> = sqlx::query_as(
            "select version,owner_principal_id from catalog.resource
             where id=$1 and tenant_id=$2 and state='ACTIVE' and projection_action_execution_id is null for update",
        )
        .bind(id)
        .bind(ae.tenant_id)
        .fetch_optional(&mut **tx)
        .await?;
        let (version, owner) = row.ok_or_else(conflict)?;
        if id == ae.target_id && Some(version) != ae.frozen_target_version() {
            return Err(conflict());
        }
        refs.push(contracts::AffectedOwnerRef {
            target_type: "RESOURCE".into(),
            target_id: id.to_string(),
            target_version: i64::from(version),
            owner_principal_id: owner.to_string(),
        });
    }
    if !crate::agent_definition::validate_frozen_owners(g, tx, ae.tenant_id, &refs).await? {
        return Err(conflict());
    }
    Ok(refs)
}

pub(super) fn frozen_owners(ae: &Execution) -> Result<Vec<contracts::AffectedOwnerRef>, Refusal> {
    let value = ae
        .parameters
        .as_ref()
        .and_then(|p| p.get("transferApprovalOwners"))
        .ok_or_else(|| Refusal::Unavailable("导出审批缺冻结 owner".into()))?;
    let refs: Vec<contracts::AffectedOwnerRef> = serde_json::from_value(value.clone())
        .map_err(|_| Refusal::Unavailable("导出审批 owner 不合契约".into()))?;
    let target = ae.target_id.to_string();
    let first = refs.first().ok_or_else(conflict)?;
    if first.target_type != "RESOURCE"
        || first.target_id != target
        || Some(first.target_version) != ae.frozen_target_version().map(i64::from)
        || (ae.action_key == "agent.definition.export" && refs.len() != 1)
    {
        return Err(conflict());
    }
    Ok(refs)
}

/// 审批者资格判定时目标是否仍是冻结的那一个（版本与可用性未变）。
pub(super) async fn target_current(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
) -> Result<bool, Refusal> {
    let params = ae.params().ok_or_else(invalid)?;
    let sem = Semantic::from_key(&def.action_key)
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    match agent_catalog::target(
        tx,
        ae.tenant_id,
        ae.initiator_principal_id,
        def,
        sem,
        &params,
        Some(ae.target_id),
        true,
    )
    .await
    {
        Ok(target) => {
            Ok(target.id == ae.target_id && Some(target.version) == ae.frozen_target_version())
        }
        Err(r @ Refusal::Unavailable(_)) => Err(r),
        Err(_) => Ok(false),
    }
}

/// `GET /api/v1/approvals` 的可见性：只有冻结 owner 之一在其当前仍有效时可决定。
pub(crate) async fn approval_owner_eligible(
    g: &Governance,
    tenant: Uuid,
    principal: Uuid,
    id: Uuid,
) -> Result<bool, Refusal> {
    let Some(ae) = super::load_execution(&g.pool, id).await? else {
        return Ok(false);
    };
    if ae.tenant_id != tenant || !is_export(&ae.action_key) {
        return Ok(false);
    }
    let refs = match frozen_owners(&ae) {
        Ok(refs) => refs,
        Err(Refusal::Unavailable(e)) => return Err(Refusal::Unavailable(e)),
        Err(_) => return Ok(false),
    };
    if !refs
        .iter()
        .any(|r| r.owner_principal_id == principal.to_string())
    {
        return Ok(false);
    }
    let mut tx = g.pool.begin().await?;
    if !crate::roles::lock_tenant(&mut tx, tenant).await? {
        return Ok(false);
    }
    crate::agent_definition::validate_frozen_owners(g, &mut tx, tenant, &refs).await
}

// ---------------------------------------------------------------------------
// 准入落定（TEMPORAL 预写）
// ---------------------------------------------------------------------------

/// 导出：冻结确切的成员版本（DD-131(3) 取各成员当前已发布版本）；导入：认领本会话上传
/// 并以导入人选择的运行合同与模型路由预检全部成员。返回 workflow ID 的实体版本。
pub(super) async fn prewrite(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    sem: Semantic,
    p: &Params,
) -> Result<i32, Refusal> {
    match sem {
        Semantic::AgentDefinitionExport | Semantic::AgentTeamExport => {
            let refs = frozen_owners(ae)?;
            if !crate::agent_definition::validate_frozen_owners(g, tx, ae.tenant_id, &refs).await? {
                return Err(conflict());
            }
            let encoding = export_encoding(p).ok_or_else(invalid)?;
            let members: Vec<(Uuid, Uuid)> = if sem == Semantic::AgentTeamExport {
                let t = agent_catalog::team(tx, ae.tenant_id, ae.target_id, true)
                    .await?
                    .ok_or_else(conflict)?;
                team_export_members(tx, ae.tenant_id, &t).await?
            } else {
                vec![(ae.target_id, p.asset_id.ok_or_else(invalid)?)]
            };
            let frozen = json!({
                "encoding": encoding.wire(),
                "members": members.iter().map(|(r, a)| json!({"resourceId": r, "assetId": a})).collect::<Vec<_>>(),
            });
            sqlx::query("update admission.action_execution set parameters=jsonb_set(parameters,'{transferExport}',$2)
                where id=$1")
                .bind(ae.id).bind(&frozen).execute(&mut **tx).await?;
            ae.frozen_target_version().ok_or_else(conflict)
        }
        Semantic::AgentDefinitionImport | Semantic::AgentTeamImport => {
            let input = import_input(p).ok_or_else(invalid)?;
            let row = upload(tx, ae.tenant_id, input.upload_id, true)
                .await?
                .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
            let kind = kind_of(&ae.action_key);
            let bytes = row.content.as_deref().ok_or_else(conflict)?;
            if row.principal_id != ae.initiator_principal_id
                || row.consumed_by_action_execution_id.is_some()
                || row.snapshot_kind != kind.wire()
                || row.content_digest != input.content_digest
                || hex::encode(Sha256::digest(bytes)) != input.content_digest
            {
                return Err(conflict());
            }
            let decoded = snapshot::decode(bytes, None).map_err(decode_refusal)?;
            if decoded.kind != kind {
                return Err(invalid());
            }
            // 与草稿创建同一规则预检：任一成员不满足即整包拒绝，不启动 Workflow。
            for member in &decoded.members {
                let content = version_content(member, &input, None)?;
                crate::agent_version::content(&content)?;
                crate::agent_version::validate_references(
                    g,
                    tx,
                    ae.tenant_id,
                    ae.initiator_principal_id,
                    &content,
                )
                .await?;
            }
            let claimed = sqlx::query(
                "update admission.agent_snapshot_upload set consumed_by_action_execution_id=$2
                 where id=$1 and consumed_by_action_execution_id is null",
            )
            .bind(row.id)
            .bind(ae.id)
            .execute(&mut **tx)
            .await?;
            if claimed.rows_affected() != 1 {
                return Err(conflict());
            }
            Ok(1)
        }
        _ => Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)),
    }
}

fn decode_refusal(error: snapshot::DecodeError) -> Refusal {
    match error {
        snapshot::DecodeError::TooLarge => Refusal::Limit(ReasonCode::PayloadTooLarge),
        snapshot::DecodeError::Invalid => invalid(),
    }
}

/// DD-131(2) 映射到本 Tenant 的 DRAFT 内容：运行合同与模型路由由导入人选择；回复策略、
/// 并行度与时限按该运行合同的上界收窄；Skill 与原生工具引用不可移植（重选）。
fn version_content(
    member: &Member,
    input: &ImportInput,
    avatar_url: Option<&str>,
) -> Result<contracts::AgentVersionContent, Refusal> {
    let directory = crate::agent_version::runtime_profile_directory()?;
    let profile = directory
        .profiles
        .iter()
        .find(|p| p.key == input.runtime_profile_key)
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    let c = &profile.capability_contract;
    let selectable = |key: &str| crate::agent_version::reply_policy_contract(c, Some(key)).is_ok();
    let reply_policy = member
        .reply_policy
        .clone()
        .filter(|k| selectable(k))
        .or_else(|| {
            let thread = |key: &&String| {
                c.reply_policy_mappings
                    .as_deref()
                    .and_then(|m| m.iter().find(|m| &m.key == *key))
                    .is_some_and(|m| m.thread_replies)
            };
            c.reply_policies
                .iter()
                .filter(|k| selectable(k))
                .find(thread)
                .or_else(|| c.reply_policies.iter().find(|k| selectable(k)))
                .cloned()
        })
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    let max_turn = member
        .max_turn_duration_seconds
        .unwrap_or(c.max_turn_duration_seconds)
        .clamp(1, c.max_turn_duration_seconds.max(1));
    let idle = member
        .idle_timeout_seconds
        .unwrap_or(c.max_idle_timeout_seconds)
        .clamp(1, c.max_idle_timeout_seconds.max(1))
        .min(max_turn);
    let mut persona = json!({"displayName": member.display_name});
    if let Some(description) = &member.description {
        persona["description"] = json!(description);
    }
    if let Some(url) = avatar_url {
        persona["avatarUrl"] = json!(url);
    }
    serde_json::from_value(json!({
        "personaIdentity": persona,
        "instructions": member.instructions,
        "runtimeProfileKey": profile.key,
        "modelRouteResourceId": input.model_route_resource_id,
        "skillVersionAssetIds": [],
        "declaredToolResourceIds": [],
        "capabilityRequirements": member.capability_requirements.iter()
            .filter(|r| c.capability_requirements.contains(r)).collect::<Vec<_>>(),
        "triggerDefaults": member.trigger_defaults.clone().unwrap_or_else(|| vec!["MENTION".into()]),
        "replyPolicy": reply_policy,
        "parallelism": member.parallelism.unwrap_or(1).clamp(1, c.max_parallelism.max(1)),
        "turnLimits": {"idleTimeoutSeconds": idle, "maxTurnDurationSeconds": max_turn},
        "memoryPolicy": {
            "coreWrite": member.core_write.as_deref().unwrap_or("HUMAN_ONLY"),
            "coldWrite": member.cold_write.as_deref().unwrap_or("DISABLED"),
        },
    }))
    .map_err(|_| invalid())
}

/// 导出成员：只取冻结 PUBLISHED/RETIRED 版本的可移植字段（DD-131(2)），不含 owner、
/// 公钥、Installation、绑定、`llm_route`、RuntimeProfile、Delegation、记忆或 SecretRef。
fn export_member(
    content: &contracts::AgentVersionContent,
    avatar: Option<snapshot::Avatar>,
) -> Member {
    let persona = &content.persona_identity;
    Member {
        display_name: persona.display_name.clone(),
        description: persona.description.clone().filter(|d| !d.trim().is_empty()),
        avatar,
        instructions: content.instructions.clone(),
        parallelism: Some(content.parallelism),
        idle_timeout_seconds: Some(content.turn_limits.idle_timeout_seconds),
        max_turn_duration_seconds: Some(content.turn_limits.max_turn_duration_seconds),
        reply_policy: Some(content.reply_policy.clone()),
        trigger_defaults: Some(content.trigger_defaults.iter().map(super::wire).collect()),
        core_write: Some(super::wire(&content.memory_policy.core_write)),
        cold_write: Some(super::wire(&content.memory_policy.cold_write)),
        capability_requirements: content.capability_requirements.clone(),
        discarded: Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// Workflow 启动与推进
// ---------------------------------------------------------------------------

fn workflow_target(ae: &Execution, workflow: &str) -> Result<Value, Refusal> {
    Ok(json!({
        "actionExecutionId": ae.id,
        "actionKey": ae.action_key,
        "targetId": ae.target_id,
        "targetVersion": ae.frozen_target_version().ok_or_else(conflict)?,
        "workflowId": workflow,
    }))
}

pub(crate) async fn start(
    pool: &sqlx::PgPool,
    temporal: &crate::temporal::TemporalClient,
    action: Uuid,
    workflow: &str,
) -> Result<crate::membership_lifecycle::LifecycleResponse, Response> {
    let ae = super::load_execution(pool, action)
        .await
        .map_err(crate::service_api::unavailable)?
        .filter(|ae| {
            (is_export(&ae.action_key) || is_import(&ae.action_key))
                && ae.gate_state == "ALLOWED"
                && ae.temporal_workflow_id.as_deref() == Some(workflow)
        })
        .ok_or_else(|| StatusCode::CONFLICT.into_response())?;
    let kind = if is_export(&ae.action_key) {
        EXPORT_KIND
    } else {
        IMPORT_KIND
    };
    let target = workflow_target(&ae, workflow).map_err(|e| e.respond(None))?;
    let run_id = crate::component_task::start(
        pool,
        temporal,
        workflow,
        ae.tenant_id,
        ae.id,
        &crate::component_task::ComponentTaskInput {
            kind: kind.into(),
            target: json!({ "resourceTransfer": target }),
        },
    )
    .await?;
    Ok(crate::membership_lifecycle::LifecycleResponse {
        workflow_id: workflow.into(),
        kind: kind.into(),
        run_id,
    })
}

/// `POST /service/v1/resource-transfers/advance`
pub(crate) async fn advance(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<
        Json<contracts::ResourceTransferAdvanceRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Response {
    if let Err(response) = crate::service_api::authorize(&state, &headers).await {
        return response;
    }
    let Ok(Json(input)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    match advance_inner(&state, input).await {
        Ok(value) => Json(value).into_response(),
        Err(error) => error.respond(None),
    }
}

fn result(ae: Uuid, status: &str, waiting: &str) -> Value {
    json!({"actionExecutionId": ae, "status": status, "waitingReason": waiting})
}

async fn advance_inner(
    state: &ServiceState,
    input: contracts::ResourceTransferAdvanceRequest,
) -> Result<Value, Refusal> {
    let target = &input.target;
    let id = Uuid::parse_str(&target.action_execution_id).map_err(|_| invalid())?;
    let ae = super::load_execution(&state.pool, id)
        .await?
        .ok_or_else(conflict)?;
    let kind = if is_export(&ae.action_key) {
        EXPORT_KIND
    } else if is_import(&ae.action_key) {
        IMPORT_KIND
    } else {
        return Err(conflict());
    };
    if ae.action_key != target.action_key
        || ae.target_id.to_string() != target.target_id
        || ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "DISPATCHED"
        || ae.temporal_workflow_id.as_deref() != Some(target.workflow_id.as_str())
        || serde_json::to_value(target).ok() != workflow_target(&ae, &target.workflow_id).ok()
    {
        return Err(conflict());
    }
    let observed = state
        .temporal
        .describe(&target.workflow_id)
        .await
        .map_err(|_| Refusal::Unavailable("transfer workflow observation unavailable".into()))?
        .ok_or_else(|| Refusal::Unavailable("transfer workflow missing".into()))?;
    let first: Option<String> = sqlx::query_scalar(
        "select run_id from projection.workflow_ref where workflow_id=$1 and action_execution_id=$2
         and tenant_id=$3 and operation_id=$4 and kind=$5 and workflow_type='ComponentTaskWorkflow'",
    )
    .bind(&target.workflow_id)
    .bind(ae.id)
    .bind(ae.tenant_id)
    .bind(ae.operation_id)
    .bind(kind)
    .fetch_optional(&state.pool)
    .await?
    .flatten();
    if !matches!(observed.state, crate::temporal::ObservedState::Open)
        || observed.run_id != input.run_id
        || observed.first_run_id.is_empty()
        || first
            .as_deref()
            .is_none_or(|first| first != observed.first_run_id && first != observed.run_id)
    {
        return Err(conflict());
    }
    let terminal: Option<String> = sqlx::query_scalar(
        "select result_code from audit.audit_event where event_key=$1 and action_key=$2 and operation_id=$3",
    )
    .bind(format!("{}:transfer:terminal", ae.id))
    .bind(&ae.action_key)
    .bind(ae.operation_id)
    .fetch_optional(&state.pool)
    .await?;
    if let Some(code) = terminal {
        return Ok(result(
            ae.id,
            if code == "SUCCEEDED" {
                "COMPLETED"
            } else {
                "FAILED"
            },
            "NONE",
        ));
    }
    let def = super::exact_definition(&state.pool, &ae.action_key, ae.action_version).await?;
    if kind == EXPORT_KIND {
        export(state, &ae, &def, input.cancel_requested).await
    } else {
        import(state, &ae, &def, input.cancel_requested).await
    }
}

async fn terminal(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    code: &str,
    evidence: Vec<crate::audit::Evidence>,
) -> Result<(), Refusal> {
    let mut refs = vec![crate::audit::Evidence::new(
        EvidenceKind::ActionExecutionId,
        ae.id,
    )];
    refs.extend(evidence);
    crate::audit::append(
        tx,
        crate::audit::AuditEntry {
            event_key: format!("{}:transfer:terminal", ae.id),
            tenant_id: Some(ae.tenant_id),
            workspace_id: ae.workspace_id,
            operation_id: ae.operation_id,
            event_type: "OUTCOME",
            human_identity_id: None,
            initiator_principal_id: Some(ae.initiator_principal_id),
            actor_principal_id: Some(ae.actor_principal_id),
            action_key: &ae.action_key,
            action_version: ae.action_version,
            component_type_key: &def.component_type_key,
            target_type: Some("RESOURCE"),
            target_id: Some(ae.target_id),
            parameter_hash: &ae.parameter_hash,
            decision: "NONE",
            result_code: code,
            result_exposure: &def.result_exposure,
            evidence_refs: refs,
            correlation_id: ae.correlation_id,
        },
    )
    .await?;
    Ok(())
}

fn fresh_actor(ae: &Execution) -> Actor {
    Actor {
        tenant_id: ae.tenant_id,
        principal_id: ae.initiator_principal_id,
        human_identity_id: None,
    }
}

/// 冻结的导出意图（准入落定时写入）。
fn export_spec(ae: &Execution) -> Result<(Encoding, Vec<(Uuid, Uuid)>), Refusal> {
    let spec = ae
        .parameters
        .as_ref()
        .and_then(|p| p.get("transferExport"))
        .ok_or_else(conflict)?;
    let encoding = spec
        .get("encoding")
        .and_then(Value::as_str)
        .and_then(Encoding::from_wire)
        .ok_or_else(conflict)?;
    let members = spec
        .get("members")
        .and_then(Value::as_array)
        .ok_or_else(conflict)?
        .iter()
        .map(|m| {
            let id = |k: &str| {
                m.get(k)
                    .and_then(Value::as_str)
                    .and_then(|s| Uuid::parse_str(s).ok())
            };
            Some((id("resourceId")?, id("assetId")?))
        })
        .collect::<Option<Vec<_>>>()
        .ok_or_else(conflict)?;
    Ok((encoding, members))
}

/// 以 CONTROL 身份读取 Relay 媒体：只在头像 URL 指向一份内容寻址媒体（64 位 SHA-256）时。
async fn fetch_avatar(
    state: &ServiceState,
    tenant: Uuid,
    url: Option<&str>,
) -> Result<Option<(snapshot::Avatar, Vec<u8>)>, Refusal> {
    let Some(sha) = url.and_then(media_sha) else {
        return Ok(None);
    };
    let (client, _) = crate::tenant_lifecycle::control_client(
        state,
        tenant,
        crate::tenant_lifecycle::ProjectionDirection::Establish,
    )
    .await
    .map_err(|_| Refusal::Unavailable("CONTROL media reader unavailable".into()))?;
    match client
        .fetch_media(&state.http, &format!("/media/{sha}"))
        .await
    {
        Ok((bytes, content_type)) if content_type.starts_with("image/") => {
            let raw = bytes.clone();
            Ok(snapshot::inline_avatar(bytes).map(|a| (a, raw)))
        }
        Ok(_) => Ok(None),
        Err(collab_bridge::operator::OperatorError::Rejected { status, .. })
            if (400..500).contains(&status) && status != 429 =>
        {
            Ok(None)
        }
        Err(e) => Err(Refusal::Unavailable(e.to_string())),
    }
}

/// 头像 URL 中的内容寻址 SHA-256（Blossom `/<sha256>[.ext]`）。
fn media_sha(url: &str) -> Option<String> {
    let last = url.split(['?', '#']).next()?.rsplit('/').next()?;
    let stem = last.split('.').next()?;
    (stem.len() == 64 && stem.bytes().all(|b| b.is_ascii_hexdigit()))
        .then(|| stem.to_ascii_lowercase())
}

async fn export(
    state: &ServiceState,
    ae: &Execution,
    def: &Definition,
    cancel: bool,
) -> Result<Value, Refusal> {
    let g = &state.governance;
    let row: Option<String> = sqlx::query_scalar(
        "select state from catalog.export_package where asset_id=$1 and tenant_id=$2",
    )
    .bind(ae.id)
    .bind(ae.tenant_id)
    .fetch_optional(&state.pool)
    .await?;
    let version = ae.frozen_target_version().ok_or_else(conflict)?;
    let fresh = g
        .evaluate(
            fresh_actor(ae),
            def,
            &Target {
                id: ae.target_id,
                version,
                workspace_id: None,
            },
        )
        .await?;
    let (encoding, members) = export_spec(ae)?;
    let mut allowed = fresh.allowed && !cancel;
    if allowed && ae.action_key == "agent.team.export" {
        for (member, _) in &members {
            let c = g
                .spicedb
                .check(
                    "resource",
                    &member.to_string(),
                    "export",
                    &ae.initiator_principal_id.to_string(),
                    Consistency::FullyConsistent,
                )
                .await
                .map_err(|e| Refusal::Unavailable(e.to_string()))?;
            allowed &= c.allowed;
        }
    }
    if !allowed {
        return fail_export(state, ae, def, row.is_some()).await;
    }
    let kind = kind_of(&ae.action_key);
    if row.is_none() {
        let mut conn = state.pool.acquire().await?;
        let mut snapshot_members = Vec::with_capacity(members.len());
        let mut body = None;
        for (resource, asset) in &members {
            let v = crate::agent_version::version(&mut conn, ae.tenant_id, *asset, false)
                .await?
                .filter(|v| {
                    v.agent_resource_id == *resource
                        && matches!(v.state.as_str(), "PUBLISHED" | "RETIRED")
                })
                .ok_or_else(conflict)?;
            let content: contracts::AgentVersionContent =
                serde_json::from_value(v.content).map_err(|_| conflict())?;
            let avatar = fetch_avatar(
                state,
                ae.tenant_id,
                content.persona_identity.avatar_url.as_deref(),
            )
            .await?;
            let (avatar, raw) = avatar.map_or((None, None), |(a, r)| (Some(a), Some(r)));
            if body.is_none() {
                body = raw;
            }
            snapshot_members.push(export_member(&content, avatar));
        }
        let (manifest, name) = if kind == Kind::Team {
            let t = agent_catalog::team(&mut conn, ae.tenant_id, ae.target_id, false)
                .await?
                .ok_or_else(conflict)?;
            (
                snapshot::team_manifest(&t.name, t.description.as_deref(), &snapshot_members),
                t.name,
            )
        } else {
            let member = snapshot_members.first().ok_or_else(conflict)?;
            (
                snapshot::agent_manifest(member),
                member.display_name.clone(),
            )
        };
        drop(conn);
        let bytes =
            snapshot::encode(kind, encoding, &manifest, body.as_deref()).map_err(decode_refusal);
        let bytes = match bytes {
            Ok(b) => b,
            Err(_) => return fail_export(state, ae, def, false).await,
        };
        let digest = hex::encode(Sha256::digest(&bytes));
        let mut tx = state.pool.begin().await?;
        lock_execution(&mut tx, ae.id).await?;
        let source_asset = (kind == Kind::Agent).then(|| members[0].1);
        sqlx::query("insert into catalog.asset
            (id,tenant_id,resource_id,type_key,owner_principal_id,producer_principal_id,native_ref,state,version,projection_action_execution_id)
            values ($1,$2,$3,'export.package',$4,$4,$1::text,'CREATING',1,$1) on conflict (id) do nothing")
            .bind(ae.id).bind(ae.tenant_id).bind(ae.target_id).bind(ae.initiator_principal_id)
            .execute(&mut *tx).await?;
        sqlx::query("insert into catalog.export_package
            (asset_id,tenant_id,source_resource_id,source_asset_id,source_object_version,format_key,format_version,
             encoding,media_type,file_name,content_digest,byte_size,content,export_operation_id,state)
            values ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,$11,$12,$13,'CREATING') on conflict (asset_id) do nothing")
            .bind(ae.id).bind(ae.tenant_id).bind(ae.target_id).bind(source_asset).bind(version)
            .bind(kind.format_key()).bind(encoding.wire()).bind(encoding.media_type())
            .bind(snapshot::file_name(kind, encoding, &name)).bind(&digest)
            .bind(i32::try_from(bytes.len()).map_err(|_| Refusal::Limit(ReasonCode::PayloadTooLarge))?)
            .bind(&bytes).bind(ae.operation_id).execute(&mut *tx).await?;
        tx.commit().await?;
    }
    // Asset owner 是导出发起 HUMAN；父 Resource 是被导出的定义或团队（03 §3）。
    g.spicedb
        .write_asset_projection(
            &ae.id.to_string(),
            &ae.tenant_id.to_string(),
            &ae.target_id.to_string(),
            &ae.initiator_principal_id.to_string(),
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()))?;
    if !g
        .spicedb
        .asset_projection_matches(
            &ae.id.to_string(),
            &ae.tenant_id.to_string(),
            &ae.target_id.to_string(),
            &ae.initiator_principal_id.to_string(),
            g.cfg.relationship_page,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()))?
    {
        return Err(Refusal::Unavailable("ExportPackage 投影未闭合".into()));
    }
    let proof = g
        .spicedb
        .check(
            "asset",
            &ae.id.to_string(),
            "read",
            &ae.initiator_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()))?;
    if !proof.allowed || proof.zed_token.is_empty() {
        return Err(Refusal::Unavailable("ExportPackage 读权未生效".into()));
    }
    let mut tx = state.pool.begin().await?;
    lock_execution(&mut tx, ae.id).await?;
    let digest: String = sqlx::query_scalar(
        "update catalog.export_package set state='READY' where asset_id=$1 and state in ('CREATING','READY')
         returning content_digest",
    )
    .bind(ae.id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "update catalog.asset set state='READY',projection_action_execution_id=null where id=$1",
    )
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    terminal(
        &mut tx,
        ae,
        def,
        "SUCCEEDED",
        vec![
            crate::audit::Evidence::versioned(EvidenceKind::TransferPackageDigest, digest, 1),
            crate::audit::Evidence::new(EvidenceKind::SpicedbZedtoken, proof.zed_token),
            crate::audit::Evidence::new(
                EvidenceKind::SpicedbRelationship,
                format!(
                    "asset:{}#owner@principal:{}",
                    ae.id, ae.initiator_principal_id
                ),
            ),
        ],
    )
    .await?;
    tx.commit().await?;
    Ok(result(ae.id, "COMPLETED", "NONE"))
}

/// 确定拒绝：已写的包投影先原生删除，包字节清空并转 ERROR，再写终态。
async fn fail_export(
    state: &ServiceState,
    ae: &Execution,
    def: &Definition,
    created: bool,
) -> Result<Value, Refusal> {
    if created {
        state
            .governance
            .spicedb
            .delete_asset_projection(ae.id)
            .await
            .map_err(|e| Refusal::Unavailable(e.to_string()))?;
    }
    let mut tx = state.pool.begin().await?;
    lock_execution(&mut tx, ae.id).await?;
    sqlx::query("update catalog.export_package set state='ERROR',content=null where asset_id=$1 and state<>'ERROR'")
        .bind(ae.id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("update catalog.asset set state='DELETED',projection_action_execution_id=null,version=version+1
        where id=$1 and type_key='export.package' and state<>'DELETED'")
        .bind(ae.id)
        .execute(&mut *tx)
        .await?;
    terminal(&mut tx, ae, def, "FAILED", Vec::new()).await?;
    tx.commit().await?;
    Ok(result(ae.id, "FAILED", "NONE"))
}

/// 导入创建的对象：定义 ID 与版本 ID 由原 AE 派生，重试得到同一组对象。
#[derive(Debug, Clone, PartialEq, Eq)]
struct Planned {
    definition: Uuid,
    version: Uuid,
    slug: String,
}

fn planned(ae: &Execution, kind: Kind, members: &[Member]) -> Vec<Planned> {
    members
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let definition = if kind == Kind::Agent {
                ae.target_id
            } else {
                Uuid::new_v5(&ae.id, format!("definition:{i}").as_bytes())
            };
            let version = Uuid::new_v5(&ae.id, format!("version:{i}").as_bytes());
            let base = snapshot::file_name(Kind::Agent, Encoding::Json, &m.display_name);
            let stem = base.trim_end_matches(".agent.json");
            let stem = if stem == "agent" {
                "imported-agent"
            } else {
                stem
            };
            let slug = format!("{stem}-{}", &definition.simple().to_string()[..8]);
            Planned {
                definition,
                version,
                slug,
            }
        })
        .collect()
}

async fn import(
    state: &ServiceState,
    ae: &Execution,
    def: &Definition,
    cancel: bool,
) -> Result<Value, Refusal> {
    let g = &state.governance;
    let params = ae.params().ok_or_else(conflict)?;
    let input = import_input(&params).ok_or_else(conflict)?;
    let kind = kind_of(&ae.action_key);
    let created: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.resource where id=$1 and tenant_id=$2)",
    )
    .bind(ae.target_id)
    .bind(ae.tenant_id)
    .fetch_one(&state.pool)
    .await?;
    let bytes: Option<Vec<u8>> = sqlx::query_scalar(
        "select content from admission.agent_snapshot_upload
         where id=$1 and tenant_id=$2 and consumed_by_action_execution_id=$3 and content_digest=$4",
    )
    .bind(input.upload_id)
    .bind(ae.tenant_id)
    .bind(ae.id)
    .bind(&input.content_digest)
    .fetch_optional(&state.pool)
    .await?
    .flatten();
    let decoded = bytes
        .as_deref()
        .filter(|b| hex::encode(Sha256::digest(b)) == input.content_digest)
        .map(|b| snapshot::decode(b, None));
    let members = match decoded {
        Some(Ok(d)) if d.kind == kind => d,
        // 字节已在此前一轮成功后清空：只能由终态审计回答，这里不重建。
        _ => return fail_import(state, ae, def, created, &[]).await,
    };
    let plan = planned(ae, kind, &members.members);
    let fresh = g
        .evaluate(
            fresh_actor(ae),
            def,
            &Target {
                id: ae.target_id,
                version: 0,
                workspace_id: None,
            },
        )
        .await?;
    if !fresh.allowed || cancel {
        return fail_import(state, ae, def, created, &plan).await;
    }
    if !created {
        // 头像以 CONTROL 身份上传为内容寻址媒体，重试得到同一 URL；不把 data URL 写进内容。
        let mut contents = Vec::with_capacity(members.members.len());
        let mut client = None;
        for member in &members.members {
            let url = match &member.avatar {
                Some(avatar) => {
                    if client.is_none() {
                        client = Some(
                            crate::tenant_lifecycle::control_client(
                                state,
                                ae.tenant_id,
                                crate::tenant_lifecycle::ProjectionDirection::Establish,
                            )
                            .await
                            .map_err(|_| {
                                Refusal::Unavailable("CONTROL media writer unavailable".into())
                            })?
                            .0,
                        );
                    }
                    let uploader = client.as_ref().ok_or_else(conflict)?;
                    match uploader
                        .upload_media(
                            &state.http,
                            avatar.bytes.clone(),
                            &avatar.mime,
                            snapshot::MAX_AVATAR_INLINE_BYTES as u64,
                        )
                        .await
                    {
                        Ok(descriptor) => Some(descriptor.url),
                        Err(collab_bridge::operator::OperatorError::InvalidMedia(_)) => None,
                        Err(e) => return Err(Refusal::Unavailable(e.to_string())),
                    }
                }
                None => None,
            };
            let content = match version_content(member, &input, url.as_deref()) {
                Ok(c) => c,
                Err(Refusal::Unavailable(e)) => return Err(Refusal::Unavailable(e)),
                Err(_) => return fail_import(state, ae, def, false, &plan).await,
            };
            contents.push(content);
        }
        let mut tx = state.pool.begin().await?;
        lock_execution(&mut tx, ae.id).await?;
        if !crate::roles::lock_tenant(&mut tx, ae.tenant_id).await?
            || !crate::agent_definition::active_owner(
                &mut tx,
                ae.tenant_id,
                ae.initiator_principal_id,
            )
            .await?
        {
            drop(tx);
            return fail_import(state, ae, def, false, &plan).await;
        }
        let mut normalized = Vec::with_capacity(contents.len());
        for content in &contents {
            let checked = match crate::agent_version::content(content) {
                Ok(v) => v,
                Err(_) => {
                    drop(tx);
                    return fail_import(state, ae, def, false, &plan).await;
                }
            };
            match crate::agent_version::validate_references(
                g,
                &mut tx,
                ae.tenant_id,
                ae.initiator_principal_id,
                content,
            )
            .await
            {
                Ok(()) => {}
                Err(Refusal::Unavailable(e)) => return Err(Refusal::Unavailable(e)),
                Err(_) => {
                    drop(tx);
                    return fail_import(state, ae, def, false, &plan).await;
                }
            }
            normalized.push(checked);
        }
        // 整包在同一事务内落库：任一成员失败则没有任何新对象（DD-131(3)）。
        for ((p, content), (normalized, digest)) in plan.iter().zip(&contents).zip(&normalized) {
            sqlx::query("insert into catalog.resource
                (id,tenant_id,type_key,owner_principal_id,component_type_key,native_type,native_id,state,version,projection_action_execution_id)
                values ($1,$2,'agent.definition',$3,'core','agent.definition',$1::text,'PROVISIONING',1,$4)")
                .bind(p.definition).bind(ae.tenant_id).bind(ae.initiator_principal_id).bind(ae.id)
                .execute(&mut *tx).await?;
            sqlx::query(
                "insert into catalog.agent_definition(resource_id,stable_slug,display_name,status)
                values ($1,$2,$3,'PROVISIONING')",
            )
            .bind(p.definition)
            .bind(&p.slug)
            .bind(&content.persona_identity.display_name)
            .execute(&mut *tx)
            .await?;
            sqlx::query("insert into catalog.asset
                (id,tenant_id,resource_id,type_key,owner_principal_id,producer_principal_id,native_ref,state,version,projection_action_execution_id)
                values ($1,$2,$3,'agent.version',$4,$4,$1::text,'DRAFT',1,$5)")
                .bind(p.version).bind(ae.tenant_id).bind(p.definition).bind(ae.initiator_principal_id).bind(ae.id)
                .execute(&mut *tx).await?;
            sqlx::query("insert into catalog.agent_version
                (asset_id,agent_resource_id,ordinal,content,config_hash,state) values ($1,$2,1,$3,$4,'DRAFT')")
                .bind(p.version).bind(p.definition).bind(normalized).bind(digest)
                .execute(&mut *tx).await?;
        }
        if kind == Kind::Team {
            let meta = members.team.as_ref().ok_or_else(conflict)?;
            sqlx::query("insert into catalog.resource
                (id,tenant_id,type_key,owner_principal_id,component_type_key,native_type,native_id,state,version,projection_action_execution_id)
                values ($1,$2,'agent.team',$3,'core','agent.team',$1::text,'PROVISIONING',1,$4)")
                .bind(ae.target_id).bind(ae.tenant_id).bind(ae.initiator_principal_id).bind(ae.id)
                .execute(&mut *tx).await?;
            sqlx::query("insert into catalog.agent_team(resource_id,name,description,member_agent_resource_ids,state)
                values ($1,$2,$3,$4,'ACTIVE')")
                .bind(ae.target_id).bind(&meta.name).bind(&meta.description)
                .bind(plan.iter().map(|p| p.definition).collect::<Vec<_>>())
                .execute(&mut *tx).await?;
        }
        tx.commit().await?;
    }
    // 新对象只在目标 Tenant 内建立 tenant/owner relationship；源 Tenant 的任何引用不进入。
    let tenant = ae.tenant_id.to_string();
    let owner = ae.initiator_principal_id.to_string();
    let mut evidence = Vec::new();
    for p in &plan {
        let id = p.definition.to_string();
        g.spicedb
            .replace_resource_projection(&id, &tenant, &owner, &owner, None)
            .await
            .map_err(|e| Refusal::Unavailable(e.to_string()))?;
        g.spicedb
            .write_asset_projection(&p.version.to_string(), &tenant, &id, &owner)
            .await
            .map_err(|e| Refusal::Unavailable(e.to_string()))?;
        let resource = g
            .spicedb
            .resource_projection_matches(&id, &tenant, &owner, g.cfg.relationship_page)
            .await
            .map_err(|e| Refusal::Unavailable(e.to_string()))?;
        let asset = g
            .spicedb
            .asset_projection_matches(
                &p.version.to_string(),
                &tenant,
                &id,
                &owner,
                g.cfg.relationship_page,
            )
            .await
            .map_err(|e| Refusal::Unavailable(e.to_string()))?;
        if !resource || !asset {
            return Err(Refusal::Unavailable("导入定义投影未闭合".into()));
        }
        evidence.push(crate::audit::Evidence::new(
            EvidenceKind::SpicedbRelationship,
            format!("resource:{id}#owner@principal:{owner}"),
        ));
    }
    if kind == Kind::Team {
        let id = ae.target_id.to_string();
        g.spicedb
            .replace_resource_projection(&id, &tenant, &owner, &owner, None)
            .await
            .map_err(|e| Refusal::Unavailable(e.to_string()))?;
        if !g
            .spicedb
            .resource_projection_matches(&id, &tenant, &owner, g.cfg.relationship_page)
            .await
            .map_err(|e| Refusal::Unavailable(e.to_string()))?
        {
            return Err(Refusal::Unavailable("导入团队投影未闭合".into()));
        }
        evidence.push(crate::audit::Evidence::new(
            EvidenceKind::SpicedbRelationship,
            format!("resource:{id}#owner@principal:{owner}"),
        ));
    }
    let proof = g
        .spicedb
        .check(
            "tenant",
            &tenant,
            "discover",
            &owner,
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()))?;
    let mut tx = state.pool.begin().await?;
    lock_execution(&mut tx, ae.id).await?;
    let ids: Vec<Uuid> = plan
        .iter()
        .map(|p| p.definition)
        .chain((kind == Kind::Team).then_some(ae.target_id))
        .collect();
    sqlx::query("update catalog.resource set state='ACTIVE',version=version+1,projection_action_execution_id=null
        where id=any($1) and tenant_id=$2 and projection_action_execution_id=$3")
        .bind(&ids).bind(ae.tenant_id).bind(ae.id).execute(&mut *tx).await?;
    sqlx::query("update catalog.agent_definition set status='ACTIVE' where resource_id=any($1) and status='PROVISIONING'")
        .bind(&ids).execute(&mut *tx).await?;
    sqlx::query("update catalog.asset set projection_action_execution_id=null where id=any($1) and projection_action_execution_id=$2")
        .bind(plan.iter().map(|p| p.version).collect::<Vec<_>>()).bind(ae.id).execute(&mut *tx).await?;
    sqlx::query("update admission.agent_snapshot_upload set content=null where id=$1 and consumed_by_action_execution_id=$2")
        .bind(input.upload_id).bind(ae.id).execute(&mut *tx).await?;
    evidence.insert(
        0,
        crate::audit::Evidence::versioned(
            EvidenceKind::TransferPackageDigest,
            &input.content_digest,
            1,
        ),
    );
    if !proof.zed_token.is_empty() {
        evidence.push(crate::audit::Evidence::new(
            EvidenceKind::SpicedbZedtoken,
            proof.zed_token,
        ));
    }
    terminal(&mut tx, ae, def, "SUCCEEDED", evidence).await?;
    tx.commit().await?;
    Ok(result(ae.id, "COMPLETED", "NONE"))
}

/// 确定拒绝：没有对象时直接终结；已落库的同一组对象先删除其投影再转 DELETED 墓碑，
/// 暂存字节清空。
async fn fail_import(
    state: &ServiceState,
    ae: &Execution,
    def: &Definition,
    created: bool,
    plan: &[Planned],
) -> Result<Value, Refusal> {
    let g = &state.governance;
    if created {
        for p in plan {
            g.spicedb
                .delete_asset_projection(p.version)
                .await
                .map_err(|e| Refusal::Unavailable(e.to_string()))?;
            g.spicedb
                .delete_resource_projection(p.definition)
                .await
                .map_err(|e| Refusal::Unavailable(e.to_string()))?;
        }
        if kind_of(&ae.action_key) == Kind::Team {
            g.spicedb
                .delete_resource_projection(ae.target_id)
                .await
                .map_err(|e| Refusal::Unavailable(e.to_string()))?;
        }
    }
    let mut tx = state.pool.begin().await?;
    lock_execution(&mut tx, ae.id).await?;
    if created {
        sqlx::query("update catalog.agent_version set state='RETIRED' where asset_id in
            (select id from catalog.asset where projection_action_execution_id=$1 and tenant_id=$2)")
            .bind(ae.id).bind(ae.tenant_id).execute(&mut *tx).await?;
        sqlx::query("update catalog.asset set state='DELETED',projection_action_execution_id=null,version=version+1
            where projection_action_execution_id=$1 and tenant_id=$2")
            .bind(ae.id).bind(ae.tenant_id).execute(&mut *tx).await?;
        sqlx::query("update catalog.agent_definition set status='DELETED' where resource_id in
            (select id from catalog.resource where projection_action_execution_id=$1 and tenant_id=$2)")
            .bind(ae.id).bind(ae.tenant_id).execute(&mut *tx).await?;
        sqlx::query("update catalog.agent_team set state='DELETED' where resource_id in
            (select id from catalog.resource where projection_action_execution_id=$1 and tenant_id=$2) and state='ACTIVE'")
            .bind(ae.id).bind(ae.tenant_id).execute(&mut *tx).await?;
        sqlx::query("update catalog.resource set state='DELETED',projection_action_execution_id=null,version=version+1
            where projection_action_execution_id=$1 and tenant_id=$2")
            .bind(ae.id).bind(ae.tenant_id).execute(&mut *tx).await?;
    }
    sqlx::query("update admission.agent_snapshot_upload set content=null where consumed_by_action_execution_id=$1")
        .bind(ae.id)
        .execute(&mut *tx)
        .await?;
    terminal(&mut tx, ae, def, "FAILED", Vec::new()).await?;
    tx.commit().await?;
    Ok(result(ae.id, "FAILED", "NONE"))
}

// ---------------------------------------------------------------------------
// BFF：上传预览、包元数据与下载
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
pub struct UploadQuery {
    pub kind: Option<String>,
}

fn preview(member: &Member) -> contracts::AgentSnapshotMemberPreview {
    serde_json::from_value(json!({
        "displayName": member.display_name,
        "description": member.description,
        "avatarDataUrl": member.avatar.as_ref().map(snapshot::Avatar::data_url),
        "instructions": member.instructions,
        "parallelism": member.parallelism,
        "idleTimeoutSeconds": member.idle_timeout_seconds,
        "maxTurnDurationSeconds": member.max_turn_duration_seconds,
        "replyPolicy": member.reply_policy,
        "triggerDefaults": member.trigger_defaults,
        "discardedFields": member.discarded.iter().map(|d| d.wire()).collect::<Vec<_>>(),
    }))
    .unwrap_or_else(|_| contracts::AgentSnapshotMemberPreview {
        avatar_data_url: None,
        description: None,
        discarded_fields: Vec::new(),
        display_name: member.display_name.clone(),
        idle_timeout_seconds: None,
        instructions: member.instructions.clone(),
        max_turn_duration_seconds: None,
        parallelism: None,
        reply_policy: None,
        trigger_defaults: None,
    })
}

fn strip_nulls(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .filter(|(_, v)| !v.is_null())
                .map(|(k, v)| (k, strip_nulls(v)))
                .collect(),
        ),
        other => other,
    }
}

/// `POST /api/v1/agent-snapshots/uploads`：本会话的包字节暂存与导入预览。不创建 Resource，
/// 不是导入；超过原版上界 413，非 v1/旧 `.persona.*`/zip/锁定卡/字段非法 422。
pub async fn upload_snapshot(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(q): Query<UploadQuery>,
    body: axum::body::Bytes,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    let file_name = headers
        .get("x-snapshot-filename")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let decoded = match snapshot::decode(&body, file_name.as_deref()) {
        Ok(d) => d,
        Err(snapshot::DecodeError::TooLarge) => {
            return crate::web_transport::error_body(
                StatusCode::PAYLOAD_TOO_LARGE,
                ErrorClass::Limit,
                ReasonCode::PayloadTooLarge,
                None,
            )
        }
        Err(snapshot::DecodeError::Invalid) => return invalid().respond(None),
    };
    if q.kind.as_deref().is_some_and(|k| k != decoded.kind.wire()) {
        return invalid().respond(None);
    }
    let id = Uuid::new_v4();
    let digest = hex::encode(Sha256::digest(&body));
    let size = match i32::try_from(body.len()) {
        Ok(s) => s,
        Err(_) => return Refusal::Limit(ReasonCode::PayloadTooLarge).respond(None),
    };
    let stored: Result<chrono::DateTime<chrono::Utc>, sqlx::Error> = async {
        let mut tx = state.pool.begin().await?;
        // 过期暂存不保留字节；只留 digest 供审计关联。
        sqlx::query("update admission.agent_snapshot_upload set content=null where expires_at<now() and content is not null")
            .execute(&mut *tx)
            .await?;
        let expires = sqlx::query_scalar(
            "insert into admission.agent_snapshot_upload
             (id,tenant_id,session_id,principal_id,snapshot_kind,encoding,content_digest,byte_size,content,expires_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,date_trunc('second',now())+make_interval(secs=>$10::bigint))
             returning expires_at",
        )
        .bind(id)
        .bind(ctx.tenant_id)
        .bind(ctx.session_id)
        .bind(ctx.tenant_principal_id)
        .bind(decoded.kind.wire())
        .bind(decoded.encoding.wire())
        .bind(&digest)
        .bind(size)
        .bind(body.as_ref())
        .bind(UPLOAD_TTL_SECONDS)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(expires)
    }
    .await;
    let expires = match stored {
        Ok(e) => e,
        Err(e) => return crate::service_api::unavailable(e),
    };
    let team = decoded.team.as_ref().map(|t| {
        strip_nulls(json!({
            "name": t.name,
            "description": t.description,
            "discardedFields": t.discarded.iter().map(|d| d.wire()).collect::<Vec<_>>(),
        }))
    });
    let view = strip_nulls(json!({
        "uploadId": id,
        "contentDigest": digest,
        "byteSize": size,
        "encoding": decoded.encoding.wire(),
        "snapshotKind": decoded.kind.wire(),
        "expiresAt": expires.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true),
        "team": team,
        "members": decoded.members.iter().map(|m| strip_nulls(json!(preview(m)))).collect::<Vec<_>>(),
    }));
    match serde_json::from_value::<contracts::AgentSnapshotUploadView>(view) {
        Ok(v) => ([(header::CACHE_CONTROL, "no-store")], Json(v)).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[derive(sqlx::FromRow)]
struct PackageRow {
    asset_id: Uuid,
    source_resource_id: Uuid,
    source_asset_id: Option<Uuid>,
    format_key: String,
    format_version: i32,
    encoding: String,
    content_digest: String,
    byte_size: i32,
    media_type: String,
    file_name: String,
    state: String,
}

async fn readable_package(
    state: &BffState,
    ctx: &ExecutionContext,
    id: Uuid,
) -> Result<PackageRow, Response> {
    let row: Option<PackageRow> = sqlx::query_as(
        "select p.asset_id,p.source_resource_id,p.source_asset_id,p.format_key,p.format_version,p.encoding,
         p.content_digest,p.byte_size,p.media_type,p.file_name,p.state
         from catalog.export_package p join catalog.asset a on a.id=p.asset_id and a.tenant_id=p.tenant_id
         where p.asset_id=$1 and p.tenant_id=$2 and a.type_key='export.package'",
    )
    .bind(id)
    .bind(ctx.tenant_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(crate::service_api::unavailable)?;
    let row = row.ok_or_else(|| StatusCode::NOT_FOUND.into_response())?;
    // 下载 ExportPackage 是对该 Asset 的 read（DD-131(8)）；每次 fresh 判定。
    let checked = state
        .governance
        .spicedb
        .check(
            "asset",
            &id.to_string(),
            "read",
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()).respond(None))?;
    if !checked.allowed {
        return Err(StatusCode::NOT_FOUND.into_response());
    }
    Ok(row)
}

/// `GET /api/v1/export-packages/{asset_id}`
pub async fn package(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    let row = match readable_package(&state, &ctx, id).await {
        Ok(r) => r,
        Err(r) => return r,
    };
    let view = strip_nulls(json!({
        "assetId": row.asset_id,
        "sourceResourceId": row.source_resource_id,
        "sourceAssetId": row.source_asset_id,
        "formatKey": row.format_key,
        "formatVersion": row.format_version,
        "encoding": row.encoding,
        "contentDigest": row.content_digest,
        "byteSize": row.byte_size,
        "mediaType": row.media_type,
        "fileName": row.file_name,
        "state": row.state,
    }));
    match serde_json::from_value::<contracts::ExportPackageView>(view) {
        Ok(v) => ([(header::CACHE_CONTROL, "no-store")], Json(v)).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// `GET /api/v1/export-packages/{asset_id}/content`：只在 READY 时下载原字节。
pub async fn package_content(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    let row = match readable_package(&state, &ctx, id).await {
        Ok(r) => r,
        Err(r) => return r,
    };
    if row.state != "READY" {
        return Refusal::Conflict(ReasonCode::TargetStateConflict).respond(None);
    }
    let bytes: Option<Vec<u8>> = match sqlx::query_scalar(
        "select content from catalog.export_package where asset_id=$1 and tenant_id=$2 and state='READY'",
    )
    .bind(id)
    .bind(ctx.tenant_id)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(b) => b.flatten(),
        Err(e) => return crate::service_api::unavailable(e),
    };
    let Some(bytes) = bytes.filter(|b| hex::encode(Sha256::digest(b)) == row.content_digest) else {
        return Refusal::Conflict(ReasonCode::TargetStateConflict).respond(None);
    };
    let disposition = HeaderValue::from_str(&format!("attachment; filename=\"{}\"", row.file_name))
        .unwrap_or_else(|_| HeaderValue::from_static("attachment"));
    (
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_str(&row.media_type)
                    .unwrap_or(HeaderValue::from_static("application/octet-stream")),
            ),
            (header::CONTENT_DISPOSITION, disposition),
            (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
            (
                header::X_CONTENT_TYPE_OPTIONS,
                HeaderValue::from_static("nosniff"),
            ),
        ],
        bytes,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command(value: Value) -> contracts::ActionCommand {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn import_and_export_commands_are_closed_sets() {
        let digest = "a".repeat(64);
        let import = command(
            json!({"actionKey":"agent.team.import","idempotencyKey":Uuid::new_v4(),
            "snapshotImport":{"uploadId":Uuid::new_v4(),"contentDigest":digest,
                "runtimeProfileKey":" server-codex ","modelRouteResourceId":Uuid::new_v4()},
            "explicitConfirmation":true}),
        );
        let p = super::super::parse_command(Semantic::AgentTeamImport, &import).unwrap();
        let input = import_input(&p).unwrap();
        assert_eq!(input.runtime_profile_key, "server-codex");
        assert_eq!(Params::from_json(&p.to_json()), Some(p));
        let upper = command(
            json!({"actionKey":"agent.team.import","idempotencyKey":Uuid::new_v4(),
            "snapshotImport":{"uploadId":Uuid::new_v4(),"contentDigest":"A".repeat(64),
                "runtimeProfileKey":"k","modelRouteResourceId":Uuid::new_v4()},"explicitConfirmation":true}),
        );
        assert!(super::super::parse_command(Semantic::AgentTeamImport, &upper).is_err());
        let export = command(
            json!({"actionKey":"agent.definition.export","idempotencyKey":Uuid::new_v4(),
            "resourceId":Uuid::new_v4(),"resourceVersion":3,"assetId":Uuid::new_v4(),
            "snapshotExport":{"encoding":"PNG"}}),
        );
        let p = super::super::parse_command(Semantic::AgentDefinitionExport, &export).unwrap();
        assert_eq!(export_encoding(&p), Some(Encoding::Png));
        // 导出没有确认位、记忆级别或其他参数；团队导出不带版本 Asset。
        let confirmed = command(
            json!({"actionKey":"agent.definition.export","idempotencyKey":Uuid::new_v4(),
            "resourceId":Uuid::new_v4(),"resourceVersion":3,"assetId":Uuid::new_v4(),
            "snapshotExport":{"encoding":"PNG"},"explicitConfirmation":true}),
        );
        assert!(super::super::parse_command(Semantic::AgentDefinitionExport, &confirmed).is_err());
        let team_asset = command(
            json!({"actionKey":"agent.team.export","idempotencyKey":Uuid::new_v4(),
            "resourceId":Uuid::new_v4(),"resourceVersion":3,"assetId":Uuid::new_v4(),
            "snapshotExport":{"encoding":"JSON"}}),
        );
        assert!(super::super::parse_command(Semantic::AgentTeamExport, &team_asset).is_err());
    }

    #[test]
    fn media_sha_reads_only_content_addressed_paths() {
        let sha = "ab".repeat(32);
        assert_eq!(
            media_sha(&format!("https://relay.example/{sha}.png")),
            Some(sha.clone())
        );
        assert_eq!(
            media_sha(&format!("/api/v1/profile/media/{sha}")),
            Some(sha)
        );
        assert_eq!(media_sha("https://relay.example/avatar.png"), None);
    }

    #[test]
    fn planned_ids_are_deterministic_per_action_and_slugs_are_valid() {
        let ae_id = Uuid::new_v4();
        let members = vec![
            Member {
                display_name: "Research Bot".into(),
                ..Member::default()
            },
            Member {
                display_name: "研究".into(),
                ..Member::default()
            },
        ];
        let ae = Execution {
            id: ae_id,
            operation_id: Uuid::new_v4(),
            tenant_id: Uuid::new_v4(),
            workspace_id: None,
            action_key: "agent.team.import".into(),
            action_version: 1,
            initiator_principal_id: Uuid::new_v4(),
            actor_principal_id: Uuid::new_v4(),
            target_id: Uuid::new_v4(),
            parameter_hash: String::new(),
            parameters: None,
            temporal_workflow_id: None,
            cancel_first_run_id: None,
            approval_workflow_id: None,
            approval_expires_at: None,
            gate_state: "ALLOWED".into(),
            dispatch_state: "DISPATCHED".into(),
            reason_code: None,
            correlation_id: Uuid::new_v4(),
            updated_at: chrono::Utc::now(),
        };
        let first = planned(&ae, Kind::Team, &members);
        assert_eq!(first, planned(&ae, Kind::Team, &members));
        assert_ne!(first[0].definition, first[1].definition);
        assert!(
            first.iter().all(|p| super::super::valid_slug(&p.slug)),
            "{first:?}"
        );
        assert!(first[0].slug.starts_with("research-bot-"));
        assert!(first[1].slug.starts_with("imported-agent-"));
    }
}
