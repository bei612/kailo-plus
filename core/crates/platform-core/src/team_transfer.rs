//! DD-131(3)、DD-42、05 §2.12、06 §7.1：团队快照 `buzz-team-snapshot@1` 的导入与导出。
//!
//! 两端复用通用机制：导入是 `agent.team.import` 的 `RESOURCE_IMPORT`（`resource_transfer` 按动作键
//! 分派到这里），导出是 `agent.team.export` 的 `RESOURCE_EXPORT`（`resource_export` 生成、投影、
//! 下载与审计，本模块只给格式、目标、owner 冻结与包内容）。
//!
//! 导入在准入事务内为每个成员预写 PROVISIONING 的 Definition（slug 由成员显示名规范化并在本
//! Tenant 内加序号去重），再预写引用它们的 agent_team；Workflow 推进时重读包、逐成员复核暂存的
//! 头像，写入每个成员的 DRAFT 与全部投影后一次落定。任一成员不成立整包按确定拒绝收尾（先删
//! 可能已写的投影再转墓碑）；结果不明只以同一冻结意图重试。
//!
//! 导出审批冻结 Team owner 与各成员 Definition owner 的去重集合（ALL_AFFECTED_OWNERS），并冻结
//! 各成员当时的已发布版本；任一 owner、版本、成员名单或投影变化都使批准失效。

use std::collections::{HashMap, HashSet};

use axum::{
    extract::{rejection::JsonRejection, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::Engine as _;
use contracts::ReasonCode;
use serde_json::{json, Value};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use crate::agent_snapshot::{self, MediaType};
use crate::bff::{resolve_execution_context, BffState, ExecutionContext};
use crate::governance::{Actor, Definition, Execution, Params, Refusal, Target};
use crate::resource_transfer::StagedAvatar;
use crate::spicedb::Consistency;
use crate::team_snapshot::{self, TeamSnapshot, FORMAT_KEY};

pub(crate) const IMPORT: &str = "agent.team.import";
pub(crate) const EXPORT: &str = "agent.team.export";
/// 上传暂存的有效期，与 Agent 快照同一约定。
const UPLOAD_TTL_SECONDS: i64 = 30 * 60;
/// 请求体上界：最大团队包（PNG 50 MiB）的标准 base64 加 JSON 外壳。
pub(crate) const MAX_UPLOAD_REQUEST_BYTES: usize = team_snapshot::MAX_PNG_BYTES / 3 * 4 + 4096;
const OWNERS_KEY: &str = "exportApprovalOwners";
const MEMBERS_KEY: &str = "exportTeamMembers";

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}
fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}
fn blocked() -> Refusal {
    Refusal::Blocked(ReasonCode::CapabilityBlocked)
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, Refusal> {
    value[key]
        .as_str()
        .filter(|s| !s.is_empty() && s.trim() == *s)
        .ok_or_else(invalid)
}
fn hex64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// 第 i 个成员的新 Definition 与 DRAFT 版本 ID 由导入 ActionExecution 确定性导出：重放与对账
/// 只会解析到同一组对象。
pub(crate) fn member_resource_id(action: Uuid, index: usize) -> Uuid {
    Uuid::new_v5(
        &action,
        format!("agent.team.import/member/{index}/definition").as_bytes(),
    )
}
pub(crate) fn member_version_id(action: Uuid, index: usize) -> Uuid {
    Uuid::new_v5(
        &action,
        format!("agent.team.import/member/{index}/version").as_bytes(),
    )
}

// ── 参数 ────────────────────────────────────────────────────────────────────

pub(crate) fn normalize_import(input: &contracts::AgentTeamImportInput) -> Result<Value, Refusal> {
    serde_json::to_value(input).map_err(|_| invalid())
}

pub(crate) fn normalize_export(input: &contracts::AgentTeamExportInput) -> Result<Value, Refusal> {
    serde_json::to_value(input).map_err(|_| invalid())
}

fn closed(p: &Params, allowed: &[&str]) -> bool {
    p.to_json()
        .as_object()
        .is_some_and(|map| map.keys().all(|k| allowed.contains(&k.as_str())))
}

/// 导入参数闭集：团队包引用与显式确认。agent_team 没有 slug，成员 slug 由 Core 生成；团队名与
/// 成员内容取自包，不由命令改写；成员 DRAFT 不带运行配置。
pub(crate) fn validate_import_params(p: &Params) -> Result<(), Refusal> {
    if !closed(p, &["agentTeamImport", "explicitConfirmation"])
        || p.explicit_confirmation != Some(true)
    {
        return Err(invalid());
    }
    import_input(p).map(|_| ())
}

pub(crate) struct ImportInput {
    pub upload_id: Uuid,
    pub package_digest: String,
}

pub(crate) fn import_input(p: &Params) -> Result<ImportInput, Refusal> {
    let value = p.agent_team_import.as_ref().ok_or_else(invalid)?;
    let typed: contracts::AgentTeamImportInput =
        serde_json::from_value(value.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(&typed).map_err(|_| invalid())? != *value {
        return Err(invalid());
    }
    let digest = text(value, "packageDigest")?;
    if !hex64(digest) {
        return Err(invalid());
    }
    Ok(ImportInput {
        upload_id: Uuid::parse_str(text(value, "uploadId")?).map_err(|_| invalid())?,
        package_digest: digest.to_owned(),
    })
}

/// 导出参数闭集：目标 Team 与其版本号、包媒体类型。没有确认位：确认即全部受影响 owner 的批准。
pub(crate) fn validate_export_params(p: &Params) -> Result<(), Refusal> {
    if !closed(p, &["resourceId", "resourceVersion", "agentTeamExport"])
        || p.resource_id.is_none()
        || p.resource_version.is_none_or(|v| v <= 0)
    {
        return Err(invalid());
    }
    export_input(p).map(|_| ())
}

pub(crate) fn export_input(p: &Params) -> Result<MediaType, Refusal> {
    let value = p.agent_team_export.as_ref().ok_or_else(invalid)?;
    let typed: contracts::AgentTeamExportInput =
        serde_json::from_value(value.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(&typed).map_err(|_| invalid())? != *value {
        return Err(invalid());
    }
    value["mediaType"]
        .as_str()
        .and_then(MediaType::from_wire)
        .ok_or_else(invalid)
}

// ── 上传暂存 ─────────────────────────────────────────────────────────────────

struct Staged {
    media_type: String,
    package: Option<Vec<u8>>,
    package_digest: String,
    expired: bool,
    consumed_by: Option<Uuid>,
    /// 成员序号 → 已存为本 Tenant 媒体对象的内联头像。
    avatars: HashMap<usize, StagedAvatar>,
}

type StagedRow = (String, Option<Vec<u8>>, String, bool, Option<Uuid>);

async fn staged(
    conn: &mut PgConnection,
    tenant: Uuid,
    principal: Uuid,
    id: Uuid,
    lock: bool,
) -> Result<Option<Staged>, Refusal> {
    let row: Option<StagedRow> = sqlx::query_as(&format!(
        "select media_type,package,package_digest,expires_at<=now(),consumed_by_action_execution_id
             from admission.transfer_upload where id=$1 and tenant_id=$2 and principal_id=$3
               and format_key=$4{}",
        if lock { " for update" } else { "" }
    ))
    .bind(id)
    .bind(tenant)
    .bind(principal)
    .bind(FORMAT_KEY)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((media_type, package, package_digest, expired, consumed_by)) = row else {
        return Ok(None);
    };
    let rows: Vec<(i32, String, String, String)> = sqlx::query_as(
        "select member_index,avatar_url,avatar_media_sha256,avatar_source_digest
         from admission.transfer_upload_member_avatar where upload_id=$1 and package_digest=$2
         order by member_index",
    )
    .bind(id)
    .bind(&package_digest)
    .fetch_all(&mut *conn)
    .await?;
    let mut avatars = HashMap::new();
    for (index, url, media_sha256, source_digest) in rows {
        let index = usize::try_from(index).map_err(|_| invalid())?;
        avatars.insert(
            index,
            StagedAvatar {
                url,
                media_sha256,
                source_digest,
            },
        );
    }
    Ok(Some(Staged {
        media_type,
        package,
        package_digest,
        expired,
        consumed_by,
        avatars,
    }))
}

/// 重算 digest 并重新解码；字节缺失、摘要不符或格式不成立都是确定的参数拒绝。
fn reread(staged: &Staged, digest: &str) -> Result<TeamSnapshot, Refusal> {
    let bytes = staged.package.as_deref().ok_or_else(invalid)?;
    if staged.package_digest != digest || agent_snapshot::sha256_hex(bytes) != digest {
        return Err(invalid());
    }
    let media = MediaType::from_wire(&staged.media_type).ok_or_else(invalid)?;
    team_snapshot::decode(bytes, media)
}

/// 每个成员暂存的头像必须正好对应重读包内该成员的内联头像（逐成员按字节摘要复核）；多出的
/// 暂存或缺失的暂存都是确定的参数拒绝。返回各成员 DRAFT personaIdentity 引用的对象地址。
fn staged_avatars(
    avatars: &HashMap<usize, StagedAvatar>,
    team: &TeamSnapshot,
) -> Result<Vec<Option<String>>, Refusal> {
    if avatars.keys().any(|i| *i >= team.members.len()) {
        return Err(invalid());
    }
    team.members
        .iter()
        .enumerate()
        .map(
            |(i, member)| match (agent_snapshot::inline_avatar(member), avatars.get(&i)) {
                (None, None) => Ok(None),
                (Some(avatar), Some(stored))
                    if avatar.digest == stored.source_digest
                        && crate::resource_transfer::media_url_hash(&stored.url)
                            == Some(stored.media_sha256.as_str()) =>
                {
                    Ok(Some(stored.url.clone()))
                }
                _ => Err(invalid()),
            },
        )
        .collect()
}

/// 每个成员的 DRAFT 内容：DD-131(2) 映射，不带运行配置与 Route（发布前由 owner 补齐），Skill
/// 与工具不带入。任一成员不成立即整包拒绝。
async fn member_contents(
    gov: &crate::governance::Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    human: Uuid,
    team: &TeamSnapshot,
    avatars: &[Option<String>],
) -> Result<Vec<contracts::AgentVersionContent>, Refusal> {
    let mut contents = Vec::with_capacity(team.members.len());
    for (i, member) in team.members.iter().enumerate() {
        let avatar = avatars.get(i).and_then(Option::as_deref);
        let content = agent_snapshot::content(member, None, None, avatar)?;
        crate::agent_version::content(&content)?;
        crate::agent_version::validate_draft_references(gov, conn, tenant, human, &content).await?;
        contents.push(content);
    }
    Ok(contents)
}

/// 本会话、本人的上传才可被团队导入命令引用；不符即不存在。
pub(crate) async fn check_session(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &contracts::ActionCommand,
) -> Result<(), Refusal> {
    let input = cmd.agent_team_import.as_ref().ok_or_else(invalid)?;
    let id = Uuid::parse_str(&input.upload_id).map_err(|_| invalid())?;
    let owned: bool = sqlx::query_scalar(
        "select exists(select 1 from admission.transfer_upload
         where id=$1 and tenant_id=$2 and session_id=$3 and principal_id=$4 and format_key=$5)",
    )
    .bind(id)
    .bind(ctx.tenant_id)
    .bind(ctx.session_id)
    .bind(ctx.tenant_principal_id)
    .bind(FORMAT_KEY)
    .fetch_one(&state.pool)
    .await?;
    if owned {
        Ok(())
    } else {
        Err(Refusal::Precondition(ReasonCode::TargetNotFound))
    }
}

/// 动作随 release 开放、目录定义 ACTIVE 且是导入的那一份策略，格式两端已登记（入口提示；
/// 提交时完整重新准入）。
async fn offered(state: &BffState) -> Result<bool, Response> {
    if !crate::capability_registry::action_exposed(IMPORT) {
        return Ok(false);
    }
    let def = crate::governance::active_definition(&state.pool, IMPORT)
        .await
        .map_err(crate::service_api::unavailable)?;
    if !def.is_some_and(|d| crate::resource_transfer::definition_matches(&d)) {
        return Ok(false);
    }
    let mut conn = state
        .pool
        .acquire()
        .await
        .map_err(crate::service_api::unavailable)?;
    crate::resource_export::format_registered(
        &mut conn,
        FORMAT_KEY,
        team_snapshot::RESOURCE_TYPE,
        IMPORT,
    )
    .await
    .map_err(crate::service_api::unavailable)
}

/// DD-131(3)：校验一个团队快照包并为本会话暂存，返回导入预览。不创建任何对象；创建只经
/// `agent.team.import`。成员内联头像逐个以导入人身份存为本 Tenant 媒体对象（DD-131(2)(7)）。
pub async fn upload(
    State(state): State<BffState>,
    headers: HeaderMap,
    request: Result<Json<contracts::AgentTeamSnapshotUploadRequest>, JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    match offered(&state).await {
        Ok(true) => {}
        Ok(false) => return StatusCode::FORBIDDEN.into_response(),
        Err(r) => return r,
    }
    match crate::resource_transfer::may_create(&state, &ctx).await {
        Ok(true) => {}
        Ok(false) => return StatusCode::FORBIDDEN.into_response(),
        Err(r) => return r,
    }
    // 授权在前：未授权者看不到上限判定。
    let request = match request {
        Ok(Json(request)) => request,
        Err(rejection) if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE => {
            return Refusal::Precondition(ReasonCode::PayloadTooLarge).respond(None);
        }
        Err(rejection) => return rejection.into_response(),
    };
    let media = match serde_json::to_value(&request.media_type)
        .ok()
        .as_ref()
        .and_then(Value::as_str)
        .and_then(MediaType::from_wire)
    {
        Some(media) => media,
        None => return invalid().respond(None),
    };
    let Ok(bytes) =
        base64::engine::general_purpose::STANDARD.decode(request.content_base64.as_bytes())
    else {
        return invalid().respond(None);
    };
    let team = match team_snapshot::decode(&bytes, media) {
        Ok(team) => team,
        Err(refusal) => return refusal.respond(None),
    };
    let digest = agent_snapshot::sha256_hex(&bytes);
    let mut avatars: Vec<Option<StagedAvatar>> = Vec::with_capacity(team.members.len());
    for member in &team.members {
        avatars.push(match agent_snapshot::inline_avatar(member) {
            Some(avatar) => {
                match crate::resource_transfer::stage_avatar(&state, &ctx, &avatar).await {
                    Ok(stored) => Some(stored),
                    Err(response) => return response,
                }
            }
            None => None,
        });
    }
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(e) => return crate::service_api::unavailable(e),
    };
    // 过期且未被导入消费的暂存不保留字节；没有后台作业，随下一次上传清空。
    if let Err(e) = sqlx::query(
        "update admission.transfer_upload set package=null
         where expires_at<now() and package is not null and consumed_by_action_execution_id is null",
    )
    .execute(&mut *tx)
    .await
    {
        return crate::service_api::unavailable(e);
    }
    let upload_id = Uuid::new_v4();
    let expires: Result<chrono::DateTime<chrono::Utc>, _> = sqlx::query_scalar(
        "insert into admission.transfer_upload(id,tenant_id,session_id,principal_id,format_key,media_type,
         package,package_digest,package_byte_size,expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+make_interval(secs=>$10::bigint))
         returning expires_at",
    )
    .bind(upload_id)
    .bind(ctx.tenant_id)
    .bind(ctx.session_id)
    .bind(ctx.tenant_principal_id)
    .bind(FORMAT_KEY)
    .bind(media.wire())
    .bind(&bytes)
    .bind(&digest)
    .bind(i32::try_from(bytes.len()).unwrap_or(i32::MAX))
    .bind(UPLOAD_TTL_SECONDS)
    .fetch_one(&mut *tx)
    .await;
    let expires = match expires {
        Ok(at) => at,
        Err(e) => return crate::service_api::unavailable(e),
    };
    for (index, avatar) in avatars.iter().enumerate() {
        let Some(avatar) = avatar else { continue };
        if let Err(e) = sqlx::query(
            "insert into admission.transfer_upload_member_avatar
             (upload_id,package_digest,member_index,avatar_url,avatar_media_sha256,avatar_source_digest)
             values ($1,$2,$3,$4,$5,$6)",
        )
        .bind(upload_id)
        .bind(&digest)
        .bind(i32::try_from(index).unwrap_or(i32::MAX))
        .bind(&avatar.url)
        .bind(&avatar.media_sha256)
        .bind(&avatar.source_digest)
        .execute(&mut *tx)
        .await
        {
            return crate::service_api::unavailable(e);
        }
    }
    if let Err(e) = tx.commit().await {
        return crate::service_api::unavailable(e);
    }
    let urls: Vec<Option<String>> = avatars
        .iter()
        .map(|a| a.as_ref().map(|a| a.url.clone()))
        .collect();
    let mut view = team_snapshot::preview_fields(&team, &urls);
    view["uploadId"] = json!(upload_id);
    view["packageDigest"] = json!(digest);
    view["packageByteSize"] = json!(bytes.len());
    view["mediaType"] = json!(media.wire());
    view["formatKey"] = json!(FORMAT_KEY);
    view["expiresAt"] = json!(expires.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
    match crate::resource_transfer::decode_view::<contracts::AgentTeamSnapshotImportPreview>(view) {
        Ok(view) => Json(view).into_response(),
        Err(r) => r,
    }
}

// ── 导入准入 ────────────────────────────────────────────────────────────────

/// 新建类 target：Tenant 级 `agent.team` Resource，ID 首次准入时分配并冻结。
pub(crate) async fn import_target(
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    def: &Definition,
    p: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    validate_import_params(p)?;
    if !crate::resource_transfer::definition_matches(def) {
        return Err(blocked());
    }
    if lock && !crate::agent_definition::active_owner(conn, tenant, initiator).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    Ok(Target {
        id: frozen.unwrap_or_else(Uuid::new_v4),
        version: 0,
        workspace_id: None,
    })
}

/// 准入门：格式两端已登记；暂存仍属发起人、未过期且未被别的导入消费，字节摘要与命令一致，
/// 每个成员的头像暂存与 DRAFT 内容都成立。
pub(crate) async fn import_gate(
    gov: &crate::governance::Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    p: &Params,
) -> Result<(), Refusal> {
    let input = import_input(p)?;
    if !crate::resource_export::format_registered(
        conn,
        FORMAT_KEY,
        team_snapshot::RESOURCE_TYPE,
        IMPORT,
    )
    .await?
    {
        return Err(blocked());
    }
    let staged = staged(conn, tenant, initiator, input.upload_id, false)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    if staged.expired || staged.consumed_by.is_some() {
        return Err(conflict());
    }
    let team = reread(&staged, &input.package_digest)?;
    let avatars = staged_avatars(&staged.avatars, &team)?;
    member_contents(gov, conn, tenant, initiator, &team, &avatars).await?;
    Ok(())
}

async fn registered_type(
    tx: &mut Transaction<'_, Postgres>,
    type_key: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query_scalar::<_, String>(
        "select type_key from catalog.resource_type_definition where type_key=$1
         and status='ACTIVE' and capability_category is null and tenant_delete_action_key='tenant.delete'",
    )
    .bind(type_key)
    .fetch_optional(&mut **tx)
    .await?
    .is_some())
}

/// 准入事务内：原子消费上传，为每个成员预写 PROVISIONING 的 Definition（owner 即发起 HUMAN，slug
/// 由显示名生成并在本 Tenant 内去重），再预写引用它们的 agent_team。
pub(crate) async fn import_prewrite(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    p: &Params,
) -> Result<i32, Refusal> {
    if !crate::agent_definition::active_owner(tx, ae.tenant_id, ae.initiator_principal_id).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let input = import_input(p)?;
    if !registered_type(tx, "agent.definition").await?
        || !registered_type(tx, team_snapshot::RESOURCE_TYPE).await?
    {
        return Err(blocked());
    }
    let consumed = sqlx::query(
        "update admission.transfer_upload set consumed_by_action_execution_id=$5
         where id=$1 and tenant_id=$2 and principal_id=$3 and package_digest=$4 and format_key=$6
           and consumed_by_action_execution_id is null and package is not null and expires_at>now()",
    )
    .bind(input.upload_id)
    .bind(ae.tenant_id)
    .bind(ae.initiator_principal_id)
    .bind(&input.package_digest)
    .bind(ae.id)
    .bind(FORMAT_KEY)
    .execute(&mut **tx)
    .await?;
    if consumed.rows_affected() != 1 {
        return Err(conflict());
    }
    let staged = staged(
        tx,
        ae.tenant_id,
        ae.initiator_principal_id,
        input.upload_id,
        true,
    )
    .await?
    .ok_or_else(conflict)?;
    let team = reread(&staged, &input.package_digest)?;
    let taken: HashSet<String> = sqlx::query_scalar(
        "select a.stable_slug from catalog.agent_definition a join catalog.resource r on r.id=a.resource_id
         where r.tenant_id=$1",
    )
    .bind(ae.tenant_id)
    .fetch_all(&mut **tx)
    .await?
    .into_iter()
    .collect();
    let names: Vec<&str> = team
        .members
        .iter()
        .map(|m| m.display_name.as_str())
        .collect();
    let slugs = team_snapshot::assign_slugs(&names, &taken);
    let mut members = Vec::with_capacity(team.members.len());
    for (i, (member, slug)) in team.members.iter().zip(&slugs).enumerate() {
        let id = member_resource_id(ae.id, i);
        sqlx::query("insert into catalog.resource
            (id,tenant_id,type_key,owner_principal_id,component_type_key,native_type,native_id,state,version,projection_action_execution_id)
            values ($1,$2,'agent.definition',$3,$4,'agent.definition',$1::text,'PROVISIONING',1,$5)")
            .bind(id).bind(ae.tenant_id).bind(ae.initiator_principal_id)
            .bind(&def.component_type_key).bind(ae.id).execute(&mut **tx).await?;
        sqlx::query(
            "insert into catalog.agent_definition(resource_id,stable_slug,display_name,status)
             values ($1,$2,$3,'PROVISIONING')",
        )
        .bind(id)
        .bind(slug)
        .bind(&member.display_name)
        .execute(&mut **tx)
        .await?;
        members.push(id);
    }
    sqlx::query("insert into catalog.resource
        (id,tenant_id,type_key,owner_principal_id,component_type_key,native_type,native_id,state,version,projection_action_execution_id)
        values ($1,$2,$3,$4,$5,$3,$1::text,'PROVISIONING',1,$6)")
        .bind(ae.target_id).bind(ae.tenant_id).bind(team_snapshot::RESOURCE_TYPE)
        .bind(ae.initiator_principal_id).bind(&def.component_type_key).bind(ae.id)
        .execute(&mut **tx).await?;
    sqlx::query(
        "insert into catalog.agent_team(resource_id,name,description,member_agent_resource_ids,state)
         values ($1,$2,$3,$4,'ACTIVE')",
    )
    .bind(ae.target_id)
    .bind(&team.name)
    .bind(&team.description)
    .bind(&members)
    .execute(&mut **tx)
    .await?;
    Ok(1)
}

/// RESOURCE_IMPORT 冻结目标：新 agent_team 与首个成员的 DRAFT（其余成员由同一 ActionExecution
/// 确定性导出），不携带包字节或来源 ID。
pub(crate) fn import_workflow_target(ae: &Execution, workflow: &str) -> Result<Value, Refusal> {
    let p = crate::resource_export::execution_params(ae)?;
    let input = import_input(&p)?;
    Ok(json!({
        "actionExecutionId": ae.id, "resourceId": ae.target_id,
        "versionAssetId": member_version_id(ae.id, 0), "workflowId": workflow,
        "formatKey": FORMAT_KEY, "packageDigest": input.package_digest,
    }))
}

// ── 导入推进（service API，经 resource_transfer::advance 分派）──────────────

async fn import_terminal_code(
    pool: &sqlx::PgPool,
    ae: &Execution,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "select result_code from audit.audit_event where event_key=$1 and action_key=$2 and operation_id=$3",
    )
    .bind(format!("{}:import:terminal", ae.id))
    .bind(IMPORT)
    .bind(ae.operation_id)
    .fetch_optional(pool)
    .await
}

/// 本导入预写的全部对象（团队与成员 Definition）转 UNKNOWN：结果不明，由下一轮以同一意图重试。
async fn mark_unknown(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update catalog.resource set state='UNKNOWN' where tenant_id=$1 and projection_action_execution_id=$2
         and state in ('PROVISIONING','UNKNOWN')",
    )
    .bind(ae.tenant_id)
    .bind(ae.id)
    .execute(&mut **tx)
    .await
    .map(|_| ())
}

pub(crate) async fn advance_import(
    state: &crate::service_api::ServiceState,
    ae: Execution,
    value: &Value,
) -> Result<Value, Refusal> {
    let target = &value["target"];
    let id = Uuid::parse_str(text(target, "resourceId")?).map_err(|_| invalid())?;
    let workflow = text(target, "workflowId")?;
    if ae.target_id != id
        || ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "DISPATCHED"
        || ae.temporal_workflow_id.as_deref() != Some(workflow)
        || *target != import_workflow_target(&ae, workflow)?
    {
        return Err(conflict());
    }
    crate::resource_transfer::observe_open_run(state, &ae, workflow, text(value, "runId")?).await?;
    if let Some(code) = import_terminal_code(&state.pool, &ae).await? {
        return Ok(crate::resource_transfer::status(
            id,
            if code == "SUCCEEDED" {
                "COMPLETED"
            } else {
                "FAILED"
            },
        ));
    }
    let def = crate::governance::exact_definition(&state.pool, IMPORT, ae.action_version).await?;
    let import = import_input(&crate::resource_export::execution_params(&ae)?)?;

    let mut tx = state.pool.begin().await?;
    crate::governance::lock_execution(&mut tx, ae.id).await?;
    crate::roles::lock_tenant(&mut tx, ae.tenant_id).await?;
    let team_row: Option<(String, Uuid, Option<Uuid>, Vec<Uuid>)> = sqlx::query_as(
        "select r.state,r.owner_principal_id,r.projection_action_execution_id,t.member_agent_resource_ids
         from catalog.resource r join catalog.agent_team t on t.resource_id=r.id
         where r.id=$1 and r.tenant_id=$2 and r.type_key='agent.team' and r.home_workspace_id is null
         for update of r",
    )
    .bind(id)
    .bind(ae.tenant_id)
    .fetch_optional(&mut *tx)
    .await?;
    let (team_state, owner, writer, members) = team_row.ok_or_else(conflict)?;
    if writer != Some(ae.id)
        || owner != ae.initiator_principal_id
        || !matches!(team_state.as_str(), "PROVISIONING" | "UNKNOWN")
        || members.is_empty()
        || members
            .iter()
            .enumerate()
            .any(|(i, m)| *m != member_resource_id(ae.id, i))
    {
        return Err(conflict());
    }
    let pending: i64 = sqlx::query_scalar(
        "select count(*) from catalog.resource r join catalog.agent_definition a on a.resource_id=r.id
         where r.tenant_id=$1 and r.id=any($2) and r.projection_action_execution_id=$3
           and r.owner_principal_id=$4 and r.state in ('PROVISIONING','UNKNOWN')",
    )
    .bind(ae.tenant_id)
    .bind(&members)
    .bind(ae.id)
    .bind(ae.initiator_principal_id)
    .fetch_one(&mut *tx)
    .await?;
    if usize::try_from(pending).ok() != Some(members.len()) {
        return Err(conflict());
    }
    let staged = staged(
        &mut tx,
        ae.tenant_id,
        ae.initiator_principal_id,
        import.upload_id,
        true,
    )
    .await?
    .filter(|s| s.consumed_by == Some(ae.id));
    let versions: Vec<Uuid> = (0..members.len())
        .map(|i| member_version_id(ae.id, i))
        .collect();
    // 确定的拒绝：取消、包不在或字节/摘要/格式不成立、任一成员不成立、Tenant create 不再成立。
    let decision = async {
        if value["cancelRequested"] == true {
            return Err(conflict());
        }
        let staged = staged.as_ref().ok_or_else(conflict)?;
        let team = reread(staged, &import.package_digest)?;
        if team.members.len() != members.len() {
            return Err(conflict());
        }
        let avatars = staged_avatars(&staged.avatars, &team)?;
        let contents = member_contents(
            &state.governance,
            &mut tx,
            ae.tenant_id,
            ae.initiator_principal_id,
            &team,
            &avatars,
        )
        .await?;
        let fresh = state
            .governance
            .evaluate(
                Actor {
                    tenant_id: ae.tenant_id,
                    principal_id: ae.initiator_principal_id,
                    human_identity_id: None,
                },
                &def,
                &Target {
                    id,
                    version: 0,
                    workspace_id: None,
                },
            )
            .await?;
        if !fresh.allowed {
            return Err(Refusal::Denied(
                fresh.reason.unwrap_or(ReasonCode::PermissionDenied),
            ));
        }
        Ok(contents)
    }
    .await;
    let contents = match decision {
        Ok(contents) => contents,
        Err(Refusal::Unavailable(reason)) => {
            mark_unknown(&mut tx, &ae).await?;
            tx.commit().await?;
            return Err(Refusal::Unavailable(reason));
        }
        Err(_) => {
            mark_unknown(&mut tx, &ae).await?;
            tx.commit().await?;
            return fail_import(state, &ae, &def, &members, &versions).await;
        }
    };
    for (i, content) in contents.iter().enumerate() {
        let (normalized, hash) = crate::agent_version::content(content)?;
        sqlx::query(
            "insert into catalog.asset
             (id,tenant_id,resource_id,type_key,owner_principal_id,producer_principal_id,native_ref,state,version,projection_action_execution_id)
             values ($1,$2,$3,'agent.version',$4,$4,$1::text,'DRAFT',1,$5) on conflict (id) do nothing",
        )
        .bind(versions[i])
        .bind(ae.tenant_id)
        .bind(members[i])
        .bind(ae.initiator_principal_id)
        .bind(ae.id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "insert into catalog.agent_version (asset_id,agent_resource_id,ordinal,content,config_hash,state)
             values ($1,$2,1,$3,$4,'DRAFT') on conflict (asset_id) do nothing",
        )
        .bind(versions[i])
        .bind(members[i])
        .bind(&normalized)
        .bind(&hash)
        .execute(&mut *tx)
        .await?;
        let stored: Option<(String, String)> = sqlx::query_as(
            "select v.config_hash,a.state from catalog.agent_version v join catalog.asset a on a.id=v.asset_id
             where v.asset_id=$1 and v.agent_resource_id=$2 and a.projection_action_execution_id=$3",
        )
        .bind(versions[i])
        .bind(members[i])
        .bind(ae.id)
        .fetch_optional(&mut *tx)
        .await?;
        if stored.as_ref().map(|(h, s)| (h.as_str(), s.as_str())) != Some((hash.as_str(), "DRAFT"))
        {
            return Err(conflict());
        }
    }
    // 全部成员的 Definition/DRAFT 投影与团队投影；任一结果不明保持 UNKNOWN 由下一轮重试。
    let mut tokens = Vec::new();
    for (member, version) in members.iter().zip(&versions) {
        match crate::resource_transfer::project(state, &ae, *member, *version).await {
            Ok(written) => tokens.extend(written),
            Err(error) => {
                mark_unknown(&mut tx, &ae).await?;
                tx.commit().await?;
                return Err(error);
            }
        }
    }
    match project_team(state, &ae, id).await {
        Ok(token) => tokens.push(token),
        Err(error) => {
            mark_unknown(&mut tx, &ae).await?;
            tx.commit().await?;
            return Err(error);
        }
    }
    sqlx::query(
        "update catalog.asset set projection_action_execution_id=null,version=version+1
         where id=any($1) and projection_action_execution_id=$2",
    )
    .bind(&versions)
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    let changed = sqlx::query(
        "update catalog.resource set state='ACTIVE',version=version+1,projection_action_execution_id=null
         where tenant_id=$1 and projection_action_execution_id=$2 and (id=$3 or id=any($4))",
    )
    .bind(ae.tenant_id)
    .bind(ae.id)
    .bind(id)
    .bind(&members)
    .execute(&mut *tx)
    .await?;
    if usize::try_from(changed.rows_affected()).ok() != Some(members.len() + 1) {
        return Err(conflict());
    }
    sqlx::query("update catalog.agent_definition set status='ACTIVE' where resource_id=any($1)")
        .bind(&members)
        .execute(&mut *tx)
        .await?;
    crate::resource_transfer::clear_package(&mut tx, ae.id).await?;
    let mut evidence = import_evidence(&ae, &import.package_digest);
    for version in &versions {
        evidence.push(crate::audit::Evidence::new(
            contracts::EvidenceKind::AgentVersionAssetId,
            *version,
        ));
    }
    for token in tokens {
        evidence.push(crate::audit::Evidence::new(
            contracts::EvidenceKind::SpicedbZedtoken,
            token,
        ));
    }
    import_audit(&mut tx, &ae, &def, "SUCCEEDED", evidence).await?;
    tx.commit().await?;
    Ok(crate::resource_transfer::status(id, "COMPLETED"))
}

/// 新 agent_team 的 tenant/owner 投影：写后以 AtLeastAsFresh 查证。
async fn project_team(
    state: &crate::service_api::ServiceState,
    ae: &Execution,
    id: Uuid,
) -> Result<String, Refusal> {
    let spicedb = &state.governance.spicedb;
    let unavailable = |e: crate::spicedb::SpiceDbError| Refusal::Unavailable(e.to_string());
    let owner = ae.initiator_principal_id.to_string();
    let zed = spicedb
        .replace_resource_projection(
            &id.to_string(),
            &ae.tenant_id.to_string(),
            &owner,
            &owner,
            None,
        )
        .await
        .map_err(unavailable)?;
    let checked = spicedb
        .check(
            "resource",
            &id.to_string(),
            "read",
            &owner,
            Consistency::AtLeastAsFresh(&zed),
        )
        .await
        .map_err(unavailable)?;
    if !checked.allowed || checked.zed_token.is_empty() {
        return Err(Refusal::Unavailable(
            "imported team projection is not causally visible".into(),
        ));
    }
    Ok(checked.zed_token)
}

/// 确定拒绝：先原生删除全部可能已写的投影（各成员 DRAFT、Definition 与团队）并以删除 revision
/// 查证，再把全部预写对象转为墓碑、清空包字节并终结；删除回应不明时保持 UNKNOWN 重试。
async fn fail_import(
    state: &crate::service_api::ServiceState,
    ae: &Execution,
    def: &Definition,
    members: &[Uuid],
    versions: &[Uuid],
) -> Result<Value, Refusal> {
    let spicedb = &state.governance.spicedb;
    let unavailable = |e: crate::spicedb::SpiceDbError| Refusal::Unavailable(e.to_string());
    let mut tokens = Vec::new();
    for version in versions {
        tokens.push(
            spicedb
                .delete_asset_projection(*version)
                .await
                .map_err(unavailable)?,
        );
    }
    for member in members {
        tokens.push(
            spicedb
                .delete_resource_projection(*member)
                .await
                .map_err(unavailable)?,
        );
    }
    let team_token = spicedb
        .delete_resource_projection(ae.target_id)
        .await
        .map_err(unavailable)?;
    if team_token.is_empty() || tokens.iter().any(String::is_empty) {
        return Err(Refusal::Unavailable(
            "team import cleanup revision missing".into(),
        ));
    }
    let mut tx = state.pool.begin().await?;
    crate::governance::lock_execution(&mut tx, ae.id).await?;
    if import_terminal_code(&state.pool, ae).await?.is_some() {
        tx.commit().await?;
        return Ok(crate::resource_transfer::status(ae.target_id, "FAILED"));
    }
    sqlx::query(
        "update catalog.asset set state='DELETED',version=version+1,projection_action_execution_id=null
         where id=any($1) and projection_action_execution_id=$2",
    )
    .bind(versions)
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    let changed = sqlx::query(
        "update catalog.resource set state='DELETED',version=version+1,projection_action_execution_id=null
         where tenant_id=$1 and projection_action_execution_id=$2",
    )
    .bind(ae.tenant_id)
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() == 0 {
        return Err(conflict());
    }
    sqlx::query("update catalog.agent_definition set status='DELETED' where resource_id=any($1)")
        .bind(members)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "update catalog.agent_team set state='DELETED' where resource_id=$1 and state='ACTIVE'",
    )
    .bind(ae.target_id)
    .execute(&mut *tx)
    .await?;
    crate::resource_transfer::clear_package(&mut tx, ae.id).await?;
    let p = crate::resource_export::execution_params(ae)?;
    let mut evidence = import_evidence(ae, &import_input(&p)?.package_digest);
    evidence.push(crate::audit::Evidence::new(
        contracts::EvidenceKind::SpicedbZedtoken,
        team_token,
    ));
    import_audit(&mut tx, ae, def, "FAILED", evidence).await?;
    tx.commit().await?;
    Ok(crate::resource_transfer::status(ae.target_id, "FAILED"))
}

fn import_evidence(ae: &Execution, digest: &str) -> Vec<crate::audit::Evidence> {
    vec![
        crate::audit::Evidence::new(contracts::EvidenceKind::ActionExecutionId, ae.id),
        crate::audit::Evidence::new(contracts::EvidenceKind::TransferFormat, FORMAT_KEY),
        crate::audit::Evidence::new(contracts::EvidenceKind::TransferPackageDigest, digest),
    ]
}

/// 审计只记格式、包摘要、新建对象与 revision，不记 instructions 或包正文（DD-131(8)）。
async fn import_audit(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    code: &str,
    evidence: Vec<crate::audit::Evidence>,
) -> Result<(), Refusal> {
    crate::audit::append(
        tx,
        crate::audit::AuditEntry {
            event_key: format!("{}:import:terminal", ae.id),
            tenant_id: Some(ae.tenant_id),
            workspace_id: None,
            operation_id: ae.operation_id,
            event_type: "OUTCOME",
            human_identity_id: None,
            initiator_principal_id: Some(ae.initiator_principal_id),
            actor_principal_id: Some(ae.actor_principal_id),
            action_key: IMPORT,
            action_version: ae.action_version,
            component_type_key: &def.component_type_key,
            target_type: Some("RESOURCE"),
            target_id: Some(ae.target_id),
            parameter_hash: &ae.parameter_hash,
            decision: "NONE",
            result_code: code,
            result_exposure: "NONE",
            evidence_refs: evidence,
            correlation_id: ae.correlation_id,
        },
    )
    .await?;
    Ok(())
}

// ── 导出（经 resource_export 分派）──────────────────────────────────────────

fn usable(team: &crate::governance::agent_team::Team) -> bool {
    team.state == "ACTIVE"
        && team.team_state == "ACTIVE"
        && team.projection_action_execution_id.is_none()
}

/// 目标是同 Tenant、ACTIVE、无在途投影的 agent_team 的确切版本。
pub(crate) async fn export_target(
    conn: &mut PgConnection,
    tenant: Uuid,
    def: &Definition,
    p: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    validate_export_params(p)?;
    if !crate::resource_export::definition_matches(def) {
        return Err(blocked());
    }
    let id = p.resource_id.ok_or_else(invalid)?;
    let t = crate::governance::agent_team::team(conn, tenant, id, lock)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    if !usable(&t) || p.resource_version != Some(t.version) || frozen.is_some_and(|f| f != t.id) {
        return Err(conflict());
    }
    Ok(Target {
        id: t.id,
        version: t.version,
        workspace_id: None,
    })
}

#[derive(sqlx::FromRow)]
struct Member {
    id: Uuid,
    version: i32,
    owner_principal_id: Uuid,
    state: String,
    projection_action_execution_id: Option<Uuid>,
    published: Option<Uuid>,
}

/// 团队成员 Definition 的当前事实，按团队成员次序；缺一即 None。
async fn members(
    conn: &mut PgConnection,
    tenant: Uuid,
    ids: &[Uuid],
    lock: bool,
) -> Result<Option<Vec<Member>>, sqlx::Error> {
    let rows: Vec<Member> = sqlx::query_as(&format!(
        "select r.id,r.version,r.owner_principal_id,r.state,r.projection_action_execution_id,
                a.current_published_version_asset_id as published
         from catalog.resource r join catalog.agent_definition a on a.resource_id=r.id
         where r.tenant_id=$1 and r.id=any($2) and r.type_key='agent.definition'{}",
        if lock { " for update of r" } else { "" }
    ))
    .bind(tenant)
    .bind(ids)
    .fetch_all(conn)
    .await?;
    let mut by_id: HashMap<Uuid, Member> = rows.into_iter().map(|m| (m.id, m)).collect();
    Ok(ids.iter().map(|id| by_id.remove(id)).collect())
}

fn member_exportable(m: &Member) -> bool {
    m.state == "ACTIVE" && m.projection_action_execution_id.is_none() && m.published.is_some()
}

/// 发起人当前对每个成员 Definition 都有 `export`（团队 `export` 由准入评估本身判定）。
async fn members_exportable_by(
    gov: &crate::governance::Governance,
    initiator: Uuid,
    members: &[Uuid],
) -> Result<bool, Refusal> {
    for member in members {
        let checked = gov
            .spicedb
            .check(
                "resource",
                &member.to_string(),
                "export",
                &initiator.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|e| Refusal::Unavailable(e.to_string()))?;
        if checked.zed_token.is_empty() {
            return Err(Refusal::Unavailable(
                "member export 缺原生 checked revision".into(),
            ));
        }
        if !checked.allowed {
            return Ok(false);
        }
    }
    Ok(true)
}

/// 准入门：格式两端已登记；团队至少有一个成员，每个成员都是 ACTIVE 且有当前已发布版本
/// （否则整包 `TARGET_STATE_CONFLICT`），发起人对每个成员都有 `export`。
pub(crate) async fn export_gate(
    gov: &crate::governance::Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    p: &Params,
) -> Result<(), Refusal> {
    export_input(p)?;
    if !crate::resource_export::format_registered(
        conn,
        FORMAT_KEY,
        team_snapshot::RESOURCE_TYPE,
        EXPORT,
    )
    .await?
    {
        return Err(blocked());
    }
    let id = p.resource_id.ok_or_else(invalid)?;
    let t = crate::governance::agent_team::team(conn, tenant, id, false)
        .await?
        .filter(usable)
        .ok_or_else(conflict)?;
    if t.members.is_empty() {
        return Err(conflict());
    }
    let current = members(conn, tenant, &t.members, false)
        .await?
        .ok_or_else(conflict)?;
    if !current.iter().all(member_exportable) {
        return Err(conflict());
    }
    if !members_exportable_by(gov, initiator, &t.members).await? {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    Ok(())
}

/// 审批开始时在 Tenant 锁下冻结：Team 与各成员 Definition 的 owner 引用（去重即 ALL_AFFECTED_OWNERS
/// 的名单）与各成员当时的已发布版本；只写一次。
pub(crate) async fn freeze_export(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
) -> Result<(), Refusal> {
    let t = crate::governance::agent_team::team(tx, ae.tenant_id, ae.target_id, true)
        .await?
        .filter(usable)
        .ok_or_else(conflict)?;
    if Some(t.version) != ae.frozen_target_version()
        || t.members.is_empty()
        || !crate::agent_definition::active_owner(tx, ae.tenant_id, t.owner_principal_id).await?
    {
        return Err(conflict());
    }
    let current = members(tx, ae.tenant_id, &t.members, true)
        .await?
        .ok_or_else(conflict)?;
    let mut owners = vec![contracts::AffectedOwnerRef {
        target_type: "RESOURCE".into(),
        target_id: t.id.to_string(),
        target_version: i64::from(t.version),
        owner_principal_id: t.owner_principal_id.to_string(),
    }];
    let mut frozen_members = Vec::with_capacity(current.len());
    for m in &current {
        if !member_exportable(m)
            || !crate::agent_definition::active_owner(tx, ae.tenant_id, m.owner_principal_id)
                .await?
        {
            return Err(conflict());
        }
        owners.push(contracts::AffectedOwnerRef {
            target_type: "RESOURCE".into(),
            target_id: m.id.to_string(),
            target_version: i64::from(m.version),
            owner_principal_id: m.owner_principal_id.to_string(),
        });
        frozen_members.push(json!({"resourceId": m.id, "versionAssetId": m.published}));
    }
    let owners_value =
        serde_json::to_value(&owners).map_err(|e| Refusal::Unavailable(e.to_string()))?;
    sqlx::query(
        "update admission.action_execution
         set parameters=parameters || jsonb_build_object($2::text,$3::jsonb,$4::text,$5::jsonb)
         where id=$1 and not (parameters ? $2)",
    )
    .bind(ae.id)
    .bind(OWNERS_KEY)
    .bind(&owners_value)
    .bind(MEMBERS_KEY)
    .bind(Value::Array(frozen_members.clone()))
    .execute(&mut **tx)
    .await?;
    let frozen = crate::governance::lock_execution(tx, ae.id).await?;
    if frozen_owners(&frozen)? != owners
        || frozen.parameters.as_ref().map(|p| &p[MEMBERS_KEY])
            != Some(&Value::Array(frozen_members))
    {
        return Err(conflict());
    }
    Ok(())
}

/// 审批冻结的受影响 owner 引用：首项是目标 Team 在冻结版本上的 owner，其余是各成员 Definition。
pub(crate) fn frozen_owners(ae: &Execution) -> Result<Vec<contracts::AffectedOwnerRef>, Refusal> {
    let unavailable = || Refusal::Unavailable("team export approval owners unavailable".into());
    let parameters = ae.parameters.as_ref().ok_or_else(unavailable)?;
    let owners: Vec<contracts::AffectedOwnerRef> =
        serde_json::from_value(parameters[OWNERS_KEY].clone()).map_err(|_| unavailable())?;
    let team_ok = owners.first().is_some_and(|team| {
        team.target_id == ae.target_id.to_string()
            && Some(team.target_version) == ae.frozen_target_version().map(i64::from)
    });
    if ae.action_key != EXPORT
        || !team_ok
        || owners.len() < 2
        || owners.iter().any(|o| {
            o.target_type != "RESOURCE"
                || Uuid::parse_str(&o.owner_principal_id)
                    .ok()
                    .is_none_or(|id| id.is_nil())
        })
    {
        return Err(conflict());
    }
    Ok(owners)
}

/// 冻结的成员（Definition 与其已发布版本），按团队成员次序。
fn frozen_members(ae: &Execution) -> Result<Vec<(Uuid, Uuid)>, Refusal> {
    let unavailable = || Refusal::Unavailable("team export members unavailable".into());
    ae.parameters
        .as_ref()
        .and_then(|p| p[MEMBERS_KEY].as_array())
        .ok_or_else(unavailable)?
        .iter()
        .map(|m| {
            let id = |key: &str| m[key].as_str().and_then(|s| Uuid::parse_str(s).ok());
            id("resourceId")
                .zip(id("versionAssetId"))
                .ok_or_else(conflict)
        })
        .collect()
}

/// 冻结的 owner、团队版本、成员名单与各成员已发布版本仍是当前事实，且投影一致。
pub(crate) async fn export_target_current(
    g: &crate::governance::Governance,
    conn: &mut PgConnection,
    ae: &Execution,
) -> Result<bool, Refusal> {
    let (owners, frozen) = match (frozen_owners(ae), frozen_members(ae)) {
        (Ok(owners), Ok(frozen)) => (owners, frozen),
        (Err(Refusal::Conflict(_)), _) | (_, Err(Refusal::Conflict(_))) => return Ok(false),
        (Err(e), _) | (_, Err(e)) => return Err(e),
    };
    let Some(t) = crate::governance::agent_team::team(conn, ae.tenant_id, ae.target_id, false)
        .await?
        .filter(usable)
    else {
        return Ok(false);
    };
    let ids: Vec<Uuid> = frozen.iter().map(|(id, _)| *id).collect();
    if t.members != ids || owners.len() != ids.len() + 1 {
        return Ok(false);
    }
    let Some(current) = members(conn, ae.tenant_id, &ids, false).await? else {
        return Ok(false);
    };
    if current
        .iter()
        .zip(&frozen)
        .any(|(m, (_, version))| !member_exportable(m) || m.published != Some(*version))
    {
        return Ok(false);
    }
    crate::agent_definition::validate_frozen_owners(g, conn, ae.tenant_id, &owners).await
}

/// 生成期间重读导出来源：仍 ACTIVE 的目标 Team（供 fresh `export` 评估）。
pub(crate) async fn export_source(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
) -> Result<Option<(Uuid, i32, Option<Uuid>)>, Refusal> {
    Ok(
        crate::governance::agent_team::team(tx, ae.tenant_id, ae.target_id, false)
            .await?
            .filter(|t| t.state == "ACTIVE" && t.team_state == "ACTIVE")
            .map(|t| (t.id, t.version, None)),
    )
}

/// `buzz-team-snapshot@1`：团队名与说明加各成员冻结已发布版本的 DD-131(2) 清单；图像体是 1×1
/// 占位（团队没有头像，成员头像在各自清单内）。失去任一成员 `export` 是确定拒绝。
pub(crate) async fn build_team(
    state: &crate::service_api::ServiceState,
    ae: &Execution,
) -> Result<crate::resource_export::Built, Refusal> {
    let media = export_input(&crate::resource_export::execution_params(ae)?)?;
    let frozen = frozen_members(ae)?;
    let mut conn = state.pool.acquire().await?;
    let t = crate::governance::agent_team::team(&mut conn, ae.tenant_id, ae.target_id, false)
        .await?
        .filter(|t| t.state == "ACTIVE" && t.team_state == "ACTIVE")
        .ok_or_else(conflict)?;
    drop(conn);
    let ids: Vec<Uuid> = frozen.iter().map(|(id, _)| *id).collect();
    if t.members != ids {
        return Err(conflict());
    }
    if !members_exportable_by(&state.governance, ae.initiator_principal_id, &ids).await? {
        return Err(conflict());
    }
    let mut manifests = Vec::with_capacity(frozen.len());
    for (definition, version) in &frozen {
        let (manifest, _, _) =
            crate::resource_export::version_manifest(state, ae.tenant_id, *version, *definition)
                .await?;
        manifests.push(manifest);
    }
    let manifest = team_snapshot::team_manifest(&t.name, t.description.as_deref(), manifests);
    let json_bytes = serde_json::to_vec_pretty(&manifest).map_err(|_| conflict())?;
    let bytes = match media {
        MediaType::Json => json_bytes,
        MediaType::Png => crate::snapshot_package::png_with_manifest(
            team_snapshot::PNG_KEYWORD,
            &json_bytes,
            None,
        ),
    };
    if bytes.len() > team_snapshot::limit(media) {
        return Err(Refusal::Precondition(ReasonCode::PayloadTooLarge));
    }
    Ok(crate::resource_export::Built {
        file_name: crate::snapshot_package::file_name(&t.name, "team", media == MediaType::Png),
        bytes,
        media,
        source_asset: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(value: Value) -> Params {
        Params::from_json(&value).unwrap()
    }

    fn import() -> Value {
        json!({"explicitConfirmation": true,
            "agentTeamImport": {"uploadId": Uuid::new_v4(), "packageDigest": "a".repeat(64)}})
    }

    fn export() -> Value {
        json!({"resourceId": Uuid::new_v4(), "resourceVersion": 2,
            "agentTeamExport": {"mediaType": "application/json"}})
    }

    #[test]
    fn import_params_are_a_closed_confirmed_set_without_slug_or_runtime() {
        assert!(validate_import_params(&params(import())).is_ok());
        let mut unconfirmed = import();
        unconfirmed["explicitConfirmation"] = json!(false);
        assert!(validate_import_params(&params(unconfirmed)).is_err());
        // agent_team has no slug and member slugs are Core-derived.
        let mut slug = import();
        slug["slug"] = json!("crew");
        assert!(validate_import_params(&params(slug)).is_err());
        let mut runtime = import();
        runtime["agentTeamImport"]["runtimeProfileKey"] = json!("server-codex");
        assert!(validate_import_params(&params(runtime)).is_err());
        let mut upper = import();
        upper["agentTeamImport"]["packageDigest"] = json!("A".repeat(64));
        assert!(validate_import_params(&params(upper)).is_err());
        let mut agent = import();
        agent["agentDefinitionImport"] = agent["agentTeamImport"].clone();
        assert!(validate_import_params(&params(agent)).is_err());
    }

    #[test]
    fn export_params_are_a_closed_set_without_confirmation() {
        assert!(validate_export_params(&params(export())).is_ok());
        assert_eq!(export_input(&params(export())).unwrap(), MediaType::Json);
        let mut confirmed = export();
        confirmed["explicitConfirmation"] = json!(true);
        assert!(validate_export_params(&params(confirmed)).is_err());
        let mut version = export();
        version["agentTeamExport"]["versionAssetId"] = json!(Uuid::new_v4());
        assert!(validate_export_params(&params(version)).is_err());
        let mut zip = export();
        zip["agentTeamExport"]["mediaType"] = json!("application/zip");
        assert!(validate_export_params(&params(zip)).is_err());
        let mut stale = export();
        stale["resourceVersion"] = json!(0);
        assert!(validate_export_params(&params(stale)).is_err());
    }

    #[test]
    fn member_objects_are_fixed_by_the_admitted_execution() {
        let action = Uuid::new_v4();
        assert_eq!(member_resource_id(action, 0), member_resource_id(action, 0));
        assert_ne!(member_resource_id(action, 0), member_resource_id(action, 1));
        assert_ne!(member_resource_id(action, 0), member_version_id(action, 0));
        assert_ne!(
            member_version_id(action, 0),
            member_version_id(Uuid::new_v4(), 0)
        );
    }

    fn member(name: &str, avatar: Option<&[u8]>) -> Value {
        let mut m = json!({"format": "buzz-agent-snapshot", "version": 1,
            "definition": {"name": name, "systemPrompt": "Help."},
            "profile": {"displayName": name}});
        if let Some(bytes) = avatar {
            m["profile"]["avatarDataUrl"] = json!(format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            ));
        }
        m
    }

    fn decoded(members: Vec<Value>) -> TeamSnapshot {
        let manifest = team_snapshot::team_manifest("Crew", None, members);
        team_snapshot::decode(&serde_json::to_vec(&manifest).unwrap(), MediaType::Json).unwrap()
    }

    fn stored(bytes: &[u8]) -> StagedAvatar {
        let hash = "b".repeat(64);
        StagedAvatar {
            url: format!("https://buzz.example.test/media/{hash}.png"),
            media_sha256: hash,
            source_digest: agent_snapshot::sha256_hex(bytes),
        }
    }

    #[test]
    fn member_avatars_are_reverified_one_by_one() {
        let team = decoded(vec![member("A", None), member("B", Some(b"bee"))]);
        let ok: HashMap<usize, StagedAvatar> = [(1, stored(b"bee"))].into();
        assert_eq!(
            staged_avatars(&ok, &team).unwrap(),
            vec![None, Some(stored(b"bee").url)]
        );
        // Staged under the wrong member, missing, extra, or different bytes.
        let shifted: HashMap<usize, StagedAvatar> = [(0, stored(b"bee"))].into();
        assert!(staged_avatars(&shifted, &team).is_err());
        assert!(staged_avatars(&HashMap::new(), &team).is_err());
        let extra: HashMap<usize, StagedAvatar> = [(1, stored(b"bee")), (5, stored(b"x"))].into();
        assert!(staged_avatars(&extra, &team).is_err());
        let changed: HashMap<usize, StagedAvatar> = [(1, stored(b"wasp"))].into();
        assert!(staged_avatars(&changed, &team).is_err());
    }

    #[test]
    fn member_drafts_need_no_runtime_and_keep_avatar_references() {
        let team = decoded(vec![member("A", None), member("B", Some(b"bee"))]);
        let urls = [None, Some(stored(b"bee").url)];
        for (i, m) in team.members.iter().enumerate() {
            let content = agent_snapshot::content(m, None, None, urls[i].as_deref()).unwrap();
            assert!(content.runtime_profile_key.is_none());
            assert!(content.model_route_resource_id.is_none());
            assert!(crate::agent_version::content(&content).is_ok());
            assert_eq!(content.persona_identity.avatar_url, urls[i]);
        }
    }
}
