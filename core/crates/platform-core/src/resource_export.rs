//! DD-42、06 §7.1、05 §2.3/§2.12：源 Tenant 的 `RESOURCE_EXPORT`。
//!
//! 导出在 owner 批准后由 `ComponentTaskWorkflow(kind=RESOURCE_EXPORT)` 推进：准入事务预写一个
//! `CREATING` 的 ExportPackage Asset，Workflow 经本模块的 service 端点按登记的 TransferFormat
//! 生成包字节、冻结 SHA-256、写 Asset 投影后一次落定为 `READY`。确定拒绝把包转为 `ERROR` 并撤
//! 投影；结果不明只以同一冻结意图重试。字节只经下载路由给当前对该 Asset 有 `read` 的 HUMAN，
//! 不进入 Workflow 历史、审计或任何跨 Tenant 关系。
//!
//! 机制与格式分离：[`build`] 按动作键分派到具体格式（当前 `buzz-agent-snapshot@1`；团队快照
//! 在此加一支），其余准入、投影、对账、下载与审计对所有格式相同。

use axum::{
    extract::{rejection::JsonRejection, Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::ReasonCode;
use serde_json::{json, Value};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use crate::agent_snapshot::{MediaType, FORMAT_KEY};
use crate::bff::{resolve_execution_context, BffState};
use crate::governance::{Actor, Definition, Execution, Params, Refusal, Target};
use crate::spicedb::Consistency;

pub(crate) const EXPORT: &str = "agent.definition.export";
pub(crate) const EXPORT_KIND: &str = "RESOURCE_EXPORT";
pub(crate) const PACKAGE_TYPE: &str = "export.package";
const AGENT_RESOURCE_TYPE: &str = "agent.definition";
const OWNER_KEY: &str = "exportApprovalOwner";

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}
fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}
fn blocked() -> Refusal {
    Refusal::Blocked(ReasonCode::CapabilityBlocked)
}

/// 包 Asset 的 ID 由导出 ActionExecution 确定性导出：重放与对账只会解析到同一个。
pub(crate) fn package_asset_id(action: Uuid) -> Uuid {
    Uuid::new_v5(&action, b"resource.export/export.package")
}

/// 本模块实现的导出动作（导出端的 TransferFormat 绑定）：Agent 快照与团队快照（DD-131(3)）。
pub(crate) fn is_action(key: &str) -> bool {
    key == EXPORT || key == crate::team_transfer::EXPORT
}

/// 该导出动作登记的 TransferFormat。
pub(crate) fn format_key(action: &str) -> &'static str {
    if action == crate::team_transfer::EXPORT {
        crate::team_snapshot::FORMAT_KEY
    } else {
        FORMAT_KEY
    }
}

// ── 参数 ────────────────────────────────────────────────────────────────────

pub(crate) struct ExportInput {
    pub version_asset_id: Uuid,
    pub media: MediaType,
}

pub(crate) fn normalize(input: &contracts::AgentDefinitionExportInput) -> Result<Value, Refusal> {
    serde_json::to_value(input).map_err(|_| invalid())
}

/// 参数闭集：目标 Definition 与其版本号、冻结的已发布版本与媒体类型。没有确认位：确认即 owner 审批。
pub(crate) fn validate_params(p: &Params) -> Result<(), Refusal> {
    if p.agent_team_export.is_some() {
        return crate::team_transfer::validate_export_params(p);
    }
    let value = p.to_json();
    if value.as_object().is_none_or(|map| {
        map.keys().any(|k| {
            !matches!(
                k.as_str(),
                "resourceId" | "resourceVersion" | "agentDefinitionExport"
            )
        })
    }) || p.resource_id.is_none()
        || p.resource_version.is_none_or(|v| v <= 0)
    {
        return Err(invalid());
    }
    input(p).map(|_| ())
}

pub(crate) fn input(p: &Params) -> Result<ExportInput, Refusal> {
    let value = p.agent_definition_export.as_ref().ok_or_else(invalid)?;
    let typed: contracts::AgentDefinitionExportInput =
        serde_json::from_value(value.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(&typed).map_err(|_| invalid())? != *value {
        return Err(invalid());
    }
    let media = value["mediaType"]
        .as_str()
        .and_then(MediaType::from_wire)
        .ok_or_else(invalid)?;
    Ok(ExportInput {
        version_asset_id: Uuid::parse_str(&typed.version_asset_id).map_err(|_| invalid())?,
        media,
    })
}

pub(crate) fn execution_params(ae: &Execution) -> Result<Params, Refusal> {
    ae.parameters
        .as_ref()
        .and_then(|v| v.get("params"))
        .and_then(Params::from_json)
        .ok_or_else(invalid)
}

// ── 目录 ────────────────────────────────────────────────────────────────────

/// 05 §2.12 的唯一策略：Definition `export`、TENANT_ONLY、TEMPORAL、owner 审批、RESOURCE_EXPORT、
/// ResultExposure EXPORT、无 quota/meter。
pub(crate) fn definition_matches(def: &Definition) -> bool {
    def.component_type_key == "core"
        && def.target_type == "RESOURCE"
        && def.tenant_rule == "SESSION_TENANT"
        && def.workspace_rule == "TENANT_ONLY"
        && def.permission_object_type == "resource"
        && def.permission == "export"
        && def.execution_mode == "TEMPORAL"
        && def.confirmation_mode == "APPROVAL"
        && def.approval_policy_id.is_some()
        && def.workflow_kind.as_deref() == Some(EXPORT_KIND)
        && def.quota_policy == "NONE"
        && def.meters.is_empty()
        && def.result_exposure == "EXPORT"
}

/// 03 §4：格式只有同时绑定已登记且 ACTIVE 的导出与导入动作时才可用。
pub(crate) async fn format_registered(
    conn: &mut PgConnection,
    format_key: &str,
    resource_type: &str,
    action_key: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "select exists(select 1 from catalog.transfer_format f
           where f.format_key=$1 and f.resource_type_key=$2 and f.status='ACTIVE'
             and $3 in (f.export_action_key, f.import_action_key)
             and exists(select 1 from catalog.action_definition d
                        where d.action_key=f.export_action_key and d.status='ACTIVE')
             and exists(select 1 from catalog.action_definition d
                        where d.action_key=f.import_action_key and d.status='ACTIVE'))",
    )
    .bind(format_key)
    .bind(resource_type)
    .bind(action_key)
    .fetch_one(conn)
    .await
}

// ── 准入 ────────────────────────────────────────────────────────────────────

/// 目标是同 Tenant、ACTIVE、无在途投影的 AgentDefinition 的确切版本。
pub(crate) async fn target(
    conn: &mut PgConnection,
    tenant: Uuid,
    def: &Definition,
    p: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    if def.action_key == crate::team_transfer::EXPORT {
        return crate::team_transfer::export_target(conn, tenant, def, p, frozen, lock).await;
    }
    validate_params(p)?;
    if p.agent_team_export.is_some() || !definition_matches(def) {
        return Err(blocked());
    }
    let id = p.resource_id.ok_or_else(invalid)?;
    let r = crate::agent_definition::resource(conn, tenant, id, lock)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    if r.state != "ACTIVE"
        || r.projection_action_execution_id.is_some()
        || p.resource_version != Some(r.version)
        || frozen.is_some_and(|f| f != r.id)
    {
        return Err(conflict());
    }
    Ok(Target {
        id: r.id,
        version: r.version,
        workspace_id: r.home_workspace_id,
    })
}

/// 准入门：冻结的版本属于该 Definition 且已发布，格式两端已登记。团队导出另核对每个成员
/// （DD-131(3)）。
pub(crate) async fn gate(
    gov: &crate::governance::Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    p: &Params,
) -> Result<(), Refusal> {
    if p.agent_team_export.is_some() {
        return crate::team_transfer::export_gate(gov, conn, tenant, initiator, p).await;
    }
    let input = input(p)?;
    let definition = p.resource_id.ok_or_else(invalid)?;
    let v = crate::agent_version::version(conn, tenant, input.version_asset_id, false)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    if v.agent_resource_id != definition || v.state != "PUBLISHED" {
        return Err(conflict());
    }
    if !format_registered(conn, FORMAT_KEY, AGENT_RESOURCE_TYPE, EXPORT).await? {
        return Err(blocked());
    }
    Ok(())
}

// ── owner 审批（TARGET_OWNER、可自批）────────────────────────────────────────

/// Agent 导出是 TARGET_OWNER；团队导出是 Team 与各成员 Definition owner 的去重集合
/// （ALL_AFFECTED_OWNERS，DD-131(3)）。两者都可自批、无角色要求。
pub(crate) fn owner_policy(action: &str, policy: &crate::governance::Policy) -> bool {
    let owner = match action {
        EXPORT => "TARGET_OWNER",
        crate::team_transfer::EXPORT => "ALL_AFFECTED_OWNERS",
        _ => return false,
    };
    policy.owner_requirement == owner
        && policy.self_approval == "ALLOW"
        && policy.role_requirements.is_empty()
}

/// 审批开始时在 Tenant 锁下冻结该 Definition 在准入版本上的 HUMAN owner；只写一次。
pub(crate) async fn freeze_owner(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
) -> Result<(), Refusal> {
    if ae.action_key == crate::team_transfer::EXPORT {
        return crate::team_transfer::freeze_export(tx, ae).await;
    }
    let r = crate::agent_definition::resource(tx, ae.tenant_id, ae.target_id, true)
        .await?
        .ok_or_else(conflict)?;
    if r.state != "ACTIVE"
        || r.projection_action_execution_id.is_some()
        || Some(r.version) != ae.frozen_target_version()
        || !crate::agent_definition::active_owner(tx, ae.tenant_id, r.owner_principal_id).await?
    {
        return Err(conflict());
    }
    let owner = contracts::AffectedOwnerRef {
        target_type: "RESOURCE".into(),
        target_id: r.id.to_string(),
        target_version: i64::from(r.version),
        owner_principal_id: r.owner_principal_id.to_string(),
    };
    let value = serde_json::to_value(&owner).map_err(|e| Refusal::Unavailable(e.to_string()))?;
    sqlx::query(
        "update admission.action_execution set parameters=jsonb_set(parameters,'{exportApprovalOwner}',$2)
         where id=$1 and not (parameters ? 'exportApprovalOwner')",
    )
    .bind(ae.id)
    .bind(&value)
    .execute(&mut **tx)
    .await?;
    let frozen = crate::governance::lock_execution(tx, ae.id).await?;
    if frozen_owner(&frozen)? != owner {
        return Err(conflict());
    }
    Ok(())
}

/// 审批冻结的 owner 名单：Agent 导出是唯一的 TARGET_OWNER，团队导出是去重的全部受影响 owner。
pub(crate) fn frozen_owners(ae: &Execution) -> Result<Vec<contracts::AffectedOwnerRef>, Refusal> {
    if ae.action_key == crate::team_transfer::EXPORT {
        crate::team_transfer::frozen_owners(ae)
    } else {
        Ok(vec![frozen_owner(ae)?])
    }
}

pub(crate) fn frozen_owner(ae: &Execution) -> Result<contracts::AffectedOwnerRef, Refusal> {
    let unavailable = || Refusal::Unavailable("export approval owner unavailable".into());
    let parameters = ae.parameters.as_ref().ok_or_else(unavailable)?;
    let owner: contracts::AffectedOwnerRef =
        serde_json::from_value(parameters[OWNER_KEY].clone()).map_err(|_| unavailable())?;
    if !is_action(&ae.action_key)
        || owner.target_type != "RESOURCE"
        || owner.target_id != ae.target_id.to_string()
        || Some(owner.target_version) != ae.frozen_target_version().map(i64::from)
        || Uuid::parse_str(&owner.owner_principal_id)
            .ok()
            .is_none_or(|id| id.is_nil())
    {
        return Err(conflict());
    }
    Ok(owner)
}

/// 冻结的 owner 仍是该 Definition 在冻结版本上的 active HUMAN owner，且投影一致。
pub(crate) async fn target_current(
    g: &crate::governance::Governance,
    conn: &mut PgConnection,
    ae: &Execution,
) -> Result<bool, Refusal> {
    if ae.action_key == crate::team_transfer::EXPORT {
        return crate::team_transfer::export_target_current(g, conn, ae).await;
    }
    let owner = match frozen_owner(ae) {
        Ok(owner) => owner,
        Err(Refusal::Conflict(_)) => return Ok(false),
        Err(e) => return Err(e),
    };
    let Some(r) =
        crate::agent_definition::resource(conn, ae.tenant_id, ae.target_id, false).await?
    else {
        return Ok(false);
    };
    if r.state != "ACTIVE"
        || r.projection_action_execution_id.is_some()
        || i64::from(r.version) != owner.target_version
        || r.owner_principal_id.to_string() != owner.owner_principal_id
        || !crate::agent_definition::active_owner(conn, ae.tenant_id, r.owner_principal_id).await?
    {
        return Ok(false);
    }
    crate::agent_definition::projection_matches(g, r.id, r.tenant_id, r.owner_principal_id).await
}

/// 落定准入（批准已消费）时：owner 或 Definition 变化使批准失效。
pub(crate) async fn validate_frozen_owner(
    g: &crate::governance::Governance,
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
) -> Result<(), Refusal> {
    if target_current(g, tx, ae).await? {
        Ok(())
    } else {
        Err(Refusal::Conflict(ReasonCode::ApprovalInvalidated))
    }
}

/// 准入事务内：预写 `CREATING` 的包 Asset（owner 即发起导出的 HUMAN，挂在来源 Resource 下）。
pub(crate) async fn prewrite(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    p: &Params,
) -> Result<i32, Refusal> {
    // 团队包没有单一来源版本：成员版本在审批开始时冻结于参数（DD-131(3)）。
    let (source_asset, media) = if ae.action_key == crate::team_transfer::EXPORT {
        (None, crate::team_transfer::export_input(p)?)
    } else {
        let input = input(p)?;
        (Some(input.version_asset_id), input.media)
    };
    let version = ae.frozen_target_version().ok_or_else(conflict)?;
    let asset = package_asset_id(ae.id);
    sqlx::query(
        "insert into catalog.asset
         (id,tenant_id,resource_id,type_key,owner_principal_id,producer_principal_id,native_ref,state,version,projection_action_execution_id)
         values ($1,$2,$3,$4,$5,$5,$1::text,'CREATING',1,$6)",
    )
    .bind(asset)
    .bind(ae.tenant_id)
    .bind(ae.target_id)
    .bind(PACKAGE_TYPE)
    .bind(ae.initiator_principal_id)
    .bind(ae.id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "insert into catalog.export_package
         (asset_id,tenant_id,source_resource_id,source_asset_id,source_object_version,format_key,media_type,
          export_action_execution_id,export_operation_id,state)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'CREATING')",
    )
    .bind(asset)
    .bind(ae.tenant_id)
    .bind(ae.target_id)
    .bind(source_asset)
    .bind(version)
    .bind(format_key(&ae.action_key))
    .bind(media.wire())
    .bind(ae.id)
    .bind(ae.operation_id)
    .execute(&mut **tx)
    .await?;
    Ok(1)
}

fn workflow_target(ae: &Execution, workflow: &str) -> Value {
    json!({
        "actionExecutionId": ae.id, "sourceResourceId": ae.target_id,
        "packageAssetId": package_asset_id(ae.id), "workflowId": workflow,
        "formatKey": format_key(&ae.action_key),
    })
}

pub(crate) async fn start(
    pool: &sqlx::PgPool,
    temporal: &crate::temporal::TemporalClient,
    action: Uuid,
    tenant: Uuid,
    workflow: &str,
) -> Result<crate::membership_lifecycle::LifecycleResponse, Response> {
    let ae = crate::governance::load_execution(pool, action)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?
        .filter(|ae| {
            ae.tenant_id == tenant
                && is_action(&ae.action_key)
                && ae.gate_state == "ALLOWED"
                && ae.temporal_workflow_id.as_deref() == Some(workflow)
        })
        .ok_or_else(|| StatusCode::CONFLICT.into_response())?;
    let run_id = crate::component_task::start(
        pool,
        temporal,
        workflow,
        tenant,
        action,
        &crate::component_task::ComponentTaskInput {
            kind: EXPORT_KIND.into(),
            target: json!({ "resourceExport": workflow_target(&ae, workflow) }),
        },
    )
    .await?;
    Ok(crate::membership_lifecycle::LifecycleResponse {
        workflow_id: workflow.into(),
        kind: EXPORT_KIND.into(),
        run_id,
    })
}

// ── 包生成（按格式）──────────────────────────────────────────────────────────

pub(crate) struct Built {
    pub bytes: Vec<u8>,
    pub file_name: String,
    pub media: MediaType,
    /// 审计引用的来源 Asset（版本）；不含任何内容。
    pub source_asset: Option<Uuid>,
}

/// 头像只在是本 Tenant Community 的媒体对象时经 CONTROL 身份取回；不存在、过大或不是图片即不内联
/// （包内也不留本 Tenant 的媒体 URL）。取回失败是结果不明。
async fn avatar_bytes(
    state: &crate::service_api::ServiceState,
    tenant: Uuid,
    url: &str,
) -> Result<Option<Vec<u8>>, Refusal> {
    if let Some(rest) = url.strip_prefix("data:") {
        let decoded = rest.split_once(',').and_then(|(header, data)| {
            header.strip_suffix(";base64")?;
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data.trim()).ok()
        });
        return Ok(decoded);
    }
    let unavailable = |_| Refusal::Unavailable("export avatar unavailable".into());
    let (client, host) = crate::tenant_lifecycle::control_client(
        state,
        tenant,
        crate::tenant_lifecycle::ProjectionDirection::Establish,
    )
    .await
    .map_err(unavailable)?;
    let paths = crate::web_profile::avatar_media_paths(Some(url), &host);
    let Some(hash) = paths
        .get(url)
        .and_then(|p| p.rsplit('/').next())
        .map(str::to_owned)
    else {
        return Ok(None);
    };
    match client
        .fetch_media(&state.http, &format!("/media/{hash}"))
        .await
    {
        Ok((bytes, content_type)) if content_type.starts_with("image/") => Ok(Some(bytes)),
        Ok(_) => Ok(None),
        Err(collab_bridge::operator::OperatorError::Rejected { status: 404, .. }) => Ok(None),
        Err(e) => Err(Refusal::Unavailable(e.to_string())),
    }
}

/// 一个已发布版本的 DD-131(2) 清单与可作 PNG 图像体的内联头像字节：读冻结版本（content 完整性
/// 以 config_hash 复核），只取可移植字段。Agent 包与团队包的每个成员同用（DD-131(3)）。
pub(crate) async fn version_manifest(
    state: &crate::service_api::ServiceState,
    tenant: Uuid,
    version_asset_id: Uuid,
    definition: Uuid,
) -> Result<(Value, Option<Vec<u8>>, Uuid), Refusal> {
    let mut conn = state.pool.acquire().await?;
    let v = crate::agent_version::version(&mut conn, tenant, version_asset_id, false)
        .await?
        .ok_or_else(conflict)?;
    if v.agent_resource_id != definition || !matches!(v.state.as_str(), "PUBLISHED" | "RETIRED") {
        return Err(conflict());
    }
    let skill_ids: Vec<Uuid> = v.content["skillVersionAssetIds"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|id| id.as_str().and_then(|s| Uuid::parse_str(s).ok()))
                .collect()
        })
        .unwrap_or_default();
    let skills: Vec<(String, String)> = if skill_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as(
            "select d.stable_slug,v.artifact_digest from unnest($2::uuid[]) with ordinality as i(id,n)
             join catalog.skill_version v on v.asset_id=i.id and v.tenant_id=$1
             join catalog.skill_definition d on d.resource_id=v.skill_resource_id
             order by i.n",
        )
        .bind(tenant)
        .bind(&skill_ids)
        .fetch_all(&mut *conn)
        .await?
    };
    drop(conn);
    let avatar = match v.content["personaIdentity"]["avatarUrl"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
    {
        Some(url) => avatar_bytes(state, tenant, url).await?,
        None => None,
    };
    let data_url = avatar
        .as_deref()
        .and_then(crate::snapshot_package::avatar_data_url);
    let skills: Vec<crate::snapshot_package::SkillRef> = skills
        .into_iter()
        .map(
            |(slug, artifact_digest)| crate::snapshot_package::SkillRef {
                slug,
                artifact_digest,
            },
        )
        .collect();
    let manifest =
        crate::snapshot_package::agent_manifest(&v.content, data_url.as_deref(), &skills)
            .ok_or_else(conflict)?;
    // 只有内联的头像才可作图像体，避免超出包上限。
    Ok((manifest, data_url.and(avatar), v.asset_id))
}

/// `buzz-agent-snapshot@1`：按 DD-131(2) 只取冻结已发布版本的可移植字段编码。确定的不成立返回
/// 拒绝；外部读取不明返回 Unavailable。
async fn build_agent(
    state: &crate::service_api::ServiceState,
    ae: &Execution,
    input: &ExportInput,
) -> Result<Built, Refusal> {
    let (manifest, image, source) =
        version_manifest(state, ae.tenant_id, input.version_asset_id, ae.target_id).await?;
    let json_bytes = serde_json::to_vec_pretty(&manifest).map_err(|_| conflict())?;
    let bytes = match input.media {
        MediaType::Json => json_bytes,
        MediaType::Png => crate::snapshot_package::png_with_manifest(
            crate::snapshot_package::AGENT_PNG_KEYWORD,
            &json_bytes,
            // 原版图像体就是头像。
            image.as_deref(),
        ),
    };
    if bytes.len() > input.media.limit() {
        return Err(Refusal::Precondition(ReasonCode::PayloadTooLarge));
    }
    let display = manifest["profile"]["displayName"]
        .as_str()
        .unwrap_or("agent");
    Ok(Built {
        file_name: crate::snapshot_package::file_name(
            display,
            "agent",
            input.media == MediaType::Png,
        ),
        bytes,
        media: input.media,
        source_asset: Some(source),
    })
}

async fn build(state: &crate::service_api::ServiceState, ae: &Execution) -> Result<Built, Refusal> {
    match ae.action_key.as_str() {
        EXPORT => build_agent(state, ae, &input(&execution_params(ae)?)?).await,
        crate::team_transfer::EXPORT => crate::team_transfer::build_team(state, ae).await,
        _ => Err(conflict()),
    }
}

// ── Workflow 推进（service API）──────────────────────────────────────────────

pub(crate) async fn advance(
    State(state): State<crate::service_api::ServiceState>,
    headers: HeaderMap,
    body: Result<Json<contracts::ResourceExportAdvanceRequest>, JsonRejection>,
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

fn status(asset: Uuid, status: &str) -> Value {
    json!({"packageAssetId": asset, "status": status, "waitingReason": "NONE"})
}

fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, Refusal> {
    value[key]
        .as_str()
        .filter(|s| !s.is_empty() && s.trim() == *s)
        .ok_or_else(invalid)
}

async fn advance_inner(
    state: &crate::service_api::ServiceState,
    request: contracts::ResourceExportAdvanceRequest,
) -> Result<Value, Refusal> {
    let value = serde_json::to_value(request).map_err(|_| invalid())?;
    let target = &value["target"];
    let action = Uuid::parse_str(text(target, "actionExecutionId")?).map_err(|_| invalid())?;
    let workflow = text(target, "workflowId")?;
    let ae = crate::governance::load_execution(&state.pool, action)
        .await?
        .ok_or_else(conflict)?;
    let asset = package_asset_id(ae.id);
    if !is_action(&ae.action_key)
        || ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "DISPATCHED"
        || ae.temporal_workflow_id.as_deref() != Some(workflow)
        || *target != workflow_target(&ae, workflow)
    {
        return Err(conflict());
    }
    let observed = state
        .temporal
        .describe(workflow)
        .await
        .map_err(|_| Refusal::Unavailable("export workflow observation unavailable".into()))?
        .ok_or_else(|| Refusal::Unavailable("export workflow missing".into()))?;
    let first: Option<String> = sqlx::query_scalar(
        "select run_id from projection.workflow_ref where workflow_id=$1
         and action_execution_id=$2 and tenant_id=$3 and operation_id=$4 and kind=$5
         and workflow_type='ComponentTaskWorkflow'",
    )
    .bind(workflow)
    .bind(ae.id)
    .bind(ae.tenant_id)
    .bind(ae.operation_id)
    .bind(EXPORT_KIND)
    .fetch_optional(&state.pool)
    .await?
    .flatten();
    if !matches!(observed.state, crate::temporal::ObservedState::Open)
        || observed.run_id != text(&value, "runId")?
        || observed.first_run_id.is_empty()
        || first
            .as_deref()
            .is_none_or(|first| first != observed.first_run_id && first != observed.run_id)
    {
        return Err(conflict());
    }
    if let Some(code) = terminal_code(&state.pool, &ae).await? {
        return Ok(status(
            asset,
            if code == "SUCCEEDED" {
                "COMPLETED"
            } else {
                "FAILED"
            },
        ));
    }
    let def =
        crate::governance::exact_definition(&state.pool, &ae.action_key, ae.action_version).await?;
    // 外部读取（头像）在任何锁之外；结果不明不改任何事实。
    let built = if value["cancelRequested"] == true {
        Err(conflict())
    } else {
        build(state, &ae).await
    };
    let built = match built {
        Ok(built) => built,
        Err(Refusal::Unavailable(reason)) => return Err(Refusal::Unavailable(reason)),
        Err(_) => return fail(state, &ae, &def, asset).await,
    };
    let mut tx = state.pool.begin().await?;
    crate::governance::lock_execution(&mut tx, ae.id).await?;
    crate::roles::lock_tenant(&mut tx, ae.tenant_id).await?;
    let row: Option<(String, String, Option<Uuid>)> = sqlx::query_as(
        "select p.state,a.state,a.projection_action_execution_id from catalog.export_package p
         join catalog.asset a on a.id=p.asset_id
         where p.asset_id=$1 and p.tenant_id=$2 and p.export_action_execution_id=$3 for update of p,a",
    )
    .bind(asset)
    .bind(ae.tenant_id)
    .bind(ae.id)
    .fetch_optional(&mut *tx)
    .await?;
    let (package_state, asset_state, writer) = row.ok_or_else(conflict)?;
    if package_state != "CREATING" || asset_state != "CREATING" || writer != Some(ae.id) {
        return Err(conflict());
    }
    // 生成期间失去 export 许可（撤权、转移 owner、删除）即确定拒绝。
    let current = if ae.action_key == crate::team_transfer::EXPORT {
        crate::team_transfer::export_source(&mut tx, &ae).await?
    } else {
        crate::agent_definition::resource(&mut tx, ae.tenant_id, ae.target_id, false)
            .await?
            .filter(|r| r.state == "ACTIVE")
            .map(|r| (r.id, r.version, r.home_workspace_id))
    };
    let fresh = match current {
        Some((id, version, workspace_id)) => {
            state
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
                        version,
                        workspace_id,
                    },
                )
                .await
        }
        None => Err(conflict()),
    };
    match fresh {
        Ok(e) if e.allowed => {}
        Err(Refusal::Unavailable(reason)) => return Err(Refusal::Unavailable(reason)),
        _ => {
            drop(tx);
            return fail(state, &ae, &def, asset).await;
        }
    }
    let token = project(state, &ae, asset).await?;
    let digest = crate::agent_snapshot::sha256_hex(&built.bytes);
    let size = i32::try_from(built.bytes.len()).map_err(|_| conflict())?;
    sqlx::query(
        "update catalog.export_package set state='READY',package=$2,content_digest=$3,byte_size=$4,
         file_name=$5,media_type=$6,ready_at=now() where asset_id=$1 and state='CREATING'",
    )
    .bind(asset)
    .bind(&built.bytes)
    .bind(&digest)
    .bind(size)
    .bind(&built.file_name)
    .bind(built.media.wire())
    .execute(&mut *tx)
    .await?;
    let changed = sqlx::query(
        "update catalog.asset set state='READY',version=version+1,projection_action_execution_id=null
         where id=$1 and projection_action_execution_id=$2",
    )
    .bind(asset)
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(conflict());
    }
    let mut evidence = transfer_evidence(&ae, Some(&digest));
    if let Some(source) = built.source_asset {
        evidence.push(crate::audit::Evidence::new(
            contracts::EvidenceKind::AgentVersionAssetId,
            source,
        ));
    }
    evidence.push(crate::audit::Evidence::new(
        contracts::EvidenceKind::SpicedbZedtoken,
        token,
    ));
    terminal_audit(&mut tx, &ae, &def, "SUCCEEDED", evidence).await?;
    tx.commit().await?;
    Ok(status(asset, "COMPLETED"))
}

/// 包 Asset 的 SpiceDB 投影（owner 即导出人、挂在来源 Resource 下）：写后以 AtLeastAsFresh 查证。
async fn project(
    state: &crate::service_api::ServiceState,
    ae: &Execution,
    asset: Uuid,
) -> Result<String, Refusal> {
    let spicedb = &state.governance.spicedb;
    let unavailable = |e: crate::spicedb::SpiceDbError| Refusal::Unavailable(e.to_string());
    let owner = ae.initiator_principal_id.to_string();
    let tenant = ae.tenant_id.to_string();
    let resource = ae.target_id.to_string();
    let zed = spicedb
        .write_asset_projection(&asset.to_string(), &tenant, &resource, &owner)
        .await
        .map_err(unavailable)?;
    let page = state.governance.cfg.relationship_page;
    if !spicedb
        .asset_projection_matches(&asset.to_string(), &tenant, &resource, &owner, page)
        .await
        .map_err(unavailable)?
    {
        return Err(Refusal::Unavailable(
            "export package projection mismatch".into(),
        ));
    }
    let read = spicedb
        .check(
            "asset",
            &asset.to_string(),
            "read",
            &owner,
            Consistency::AtLeastAsFresh(&zed),
        )
        .await
        .map_err(unavailable)?;
    if !read.allowed || read.zed_token.is_empty() {
        return Err(Refusal::Unavailable(
            "export package projection is not causally visible".into(),
        ));
    }
    Ok(read.zed_token)
}

/// 确定拒绝：先撤包 Asset 投影并以删除 revision 查证，再把包转 ERROR、Asset 转墓碑并终结。
async fn fail(
    state: &crate::service_api::ServiceState,
    ae: &Execution,
    def: &Definition,
    asset: Uuid,
) -> Result<Value, Refusal> {
    let zed = state
        .governance
        .spicedb
        .delete_asset_projection(asset)
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()))?;
    if zed.is_empty() {
        return Err(Refusal::Unavailable(
            "export cleanup revision missing".into(),
        ));
    }
    let mut tx = state.pool.begin().await?;
    crate::governance::lock_execution(&mut tx, ae.id).await?;
    if terminal_code(&state.pool, ae).await?.is_some() {
        tx.commit().await?;
        return Ok(status(asset, "FAILED"));
    }
    sqlx::query(
        "update catalog.export_package set state='ERROR',package=null
         where asset_id=$1 and export_action_execution_id=$2 and state='CREATING'",
    )
    .bind(asset)
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "update catalog.asset set state='DELETED',version=version+1,projection_action_execution_id=null
         where id=$1 and projection_action_execution_id=$2",
    )
    .bind(asset)
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    let mut evidence = transfer_evidence(ae, None);
    evidence.push(crate::audit::Evidence::new(
        contracts::EvidenceKind::SpicedbZedtoken,
        zed,
    ));
    terminal_audit(&mut tx, ae, def, "FAILED", evidence).await?;
    tx.commit().await?;
    Ok(status(asset, "FAILED"))
}

fn transfer_evidence(ae: &Execution, digest: Option<&str>) -> Vec<crate::audit::Evidence> {
    let mut evidence = vec![
        crate::audit::Evidence::new(contracts::EvidenceKind::ActionExecutionId, ae.id),
        crate::audit::Evidence::new(
            contracts::EvidenceKind::TransferFormat,
            format_key(&ae.action_key),
        ),
        crate::audit::Evidence::new(
            contracts::EvidenceKind::ExportPackageAssetId,
            package_asset_id(ae.id),
        ),
    ];
    if let Some(digest) = digest {
        evidence.push(crate::audit::Evidence::new(
            contracts::EvidenceKind::TransferPackageDigest,
            digest,
        ));
    }
    // owner 决定由审批 Workflow 记录；这里只引用它，不复制决定内容。
    if let Some(workflow) = ae.approval_workflow_id.as_deref() {
        evidence.push(crate::audit::Evidence::new(
            contracts::EvidenceKind::ApprovalWorkflowId,
            workflow,
        ));
    }
    evidence
}

async fn terminal_code(pool: &sqlx::PgPool, ae: &Execution) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "select result_code from audit.audit_event where event_key=$1 and action_key=$2 and operation_id=$3",
    )
    .bind(format!("{}:export:terminal", ae.id))
    .bind(&ae.action_key)
    .bind(ae.operation_id)
    .fetch_optional(pool)
    .await
}

/// 审计只记格式、包摘要、包与来源版本 ID、批准与 revision，不记 instructions 或包正文（DD-131(8)）。
async fn terminal_audit(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    code: &str,
    evidence: Vec<crate::audit::Evidence>,
) -> Result<(), Refusal> {
    crate::audit::append(
        tx,
        crate::audit::AuditEntry {
            event_key: format!("{}:export:terminal", ae.id),
            tenant_id: Some(ae.tenant_id),
            workspace_id: None,
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
            evidence_refs: evidence,
            correlation_id: ae.correlation_id,
        },
    )
    .await?;
    Ok(())
}

// ── 读取与下载（BFF）────────────────────────────────────────────────────────

type PackageRow = (
    Uuid,
    Uuid,
    Uuid,
    Option<Uuid>,
    String,
    String,
    String,
    Option<String>,
    Option<i32>,
    Option<String>,
);

const PACKAGE_COLUMNS: &str = "p.asset_id,p.export_action_execution_id,p.source_resource_id,
     p.source_asset_id,p.format_key,p.media_type,p.state,p.content_digest,p.byte_size,p.file_name";

/// 当前对包 Asset 有 `read` 才可见（owner 即导出人，或来源 Resource 的 manage）；
/// 不可见与不存在同为 404。
async fn readable(
    state: &BffState,
    principal: Uuid,
    row: Option<PackageRow>,
) -> Result<PackageRow, Response> {
    let row = row.ok_or_else(|| StatusCode::NOT_FOUND.into_response())?;
    if row.6 == "DELETED" {
        return Err(StatusCode::NOT_FOUND.into_response());
    }
    let checked = state
        .governance
        .spicedb
        .check(
            "asset",
            &row.0.to_string(),
            "read",
            &principal.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()).respond(None))?;
    if checked.zed_token.is_empty() {
        return Err(Refusal::Unavailable("asset read 缺 checked revision".into()).respond(None));
    }
    if checked.allowed {
        Ok(row)
    } else {
        Err(StatusCode::NOT_FOUND.into_response())
    }
}

fn view(row: &PackageRow) -> Value {
    let mut view = json!({
        "packageAssetId": row.0, "actionExecutionId": row.1, "sourceResourceId": row.2,
        "formatKey": row.4, "mediaType": row.5, "state": row.6,
    });
    if let Some(source) = row.3 {
        view["sourceAssetId"] = json!(source);
    }
    if row.6 == "READY" {
        if let Some(digest) = &row.7 {
            view["contentDigest"] = json!(digest);
        }
        if let Some(size) = row.8 {
            view["byteSize"] = json!(size);
        }
        if let Some(name) = &row.9 {
            view["fileName"] = json!(name);
        }
        view["downloadPath"] = json!(format!("/api/v1/export-packages/{}/content", row.0));
    }
    view
}

fn respond_view(row: &PackageRow) -> Response {
    match serde_json::from_value::<contracts::ExportPackageView>(view(row)) {
        Ok(view) => Json(view).into_response(),
        Err(_) => {
            tracing::error!("导出包视图不符合共享契约");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

/// 发起人在提交后按 ActionExecution 找到自己的包；包尚未预写（等待审批）时为 404。
pub async fn by_action(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(action): Path<Uuid>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    let row: Result<Option<PackageRow>, _> = sqlx::query_as(&format!(
        "select {PACKAGE_COLUMNS} from catalog.export_package p
         where p.export_action_execution_id=$1 and p.tenant_id=$2"
    ))
    .bind(action)
    .bind(ctx.tenant_id)
    .fetch_optional(&state.pool)
    .await;
    let row = match row {
        Ok(row) => row,
        Err(e) => return crate::service_api::unavailable(e),
    };
    match readable(&state, ctx.tenant_principal_id, row).await {
        Ok(row) => respond_view(&row),
        Err(r) => r,
    }
}

async fn load(state: &BffState, tenant: Uuid, asset: Uuid) -> Result<Option<PackageRow>, Response> {
    sqlx::query_as(&format!(
        "select {PACKAGE_COLUMNS} from catalog.export_package p where p.asset_id=$1 and p.tenant_id=$2"
    ))
    .bind(asset)
    .bind(tenant)
    .fetch_optional(&state.pool)
    .await
    .map_err(crate::service_api::unavailable)
}

pub async fn package(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(asset): Path<Uuid>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    let row = match load(&state, ctx.tenant_id, asset).await {
        Ok(row) => row,
        Err(r) => return r,
    };
    match readable(&state, ctx.tenant_principal_id, row).await {
        Ok(row) => respond_view(&row),
        Err(r) => r,
    }
}

/// 06 §7.1：只有 READY 且当前 `read` 通过时返回字节；附件下载，不让浏览器内联执行。
pub async fn content(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(asset): Path<Uuid>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    let row = match load(&state, ctx.tenant_id, asset).await {
        Ok(row) => row,
        Err(r) => return r,
    };
    let row = match readable(&state, ctx.tenant_principal_id, row).await {
        Ok(row) => row,
        Err(r) => return r,
    };
    if row.6 != "READY" {
        return StatusCode::CONFLICT.into_response();
    }
    let bytes: Result<Option<Vec<u8>>, _> = sqlx::query_scalar(
        "select package from catalog.export_package where asset_id=$1 and tenant_id=$2
         and state='READY' and content_digest=$3",
    )
    .bind(asset)
    .bind(ctx.tenant_id)
    .bind(&row.7)
    .fetch_optional(&state.pool)
    .await
    .map(Option::flatten);
    let bytes = match bytes {
        Ok(Some(bytes))
            if crate::agent_snapshot::sha256_hex(&bytes) == row.7.clone().unwrap_or_default() =>
        {
            bytes
        }
        Ok(_) => return StatusCode::CONFLICT.into_response(),
        Err(e) => return crate::service_api::unavailable(e),
    };
    let name = row.9.unwrap_or_else(|| "snapshot".into());
    let ascii: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_graphic() && c != '"' && c != '\\' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let encoded: String = name
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    (
        [
            (header::CONTENT_TYPE, row.5),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}"),
            ),
            (header::CACHE_CONTROL, "no-store".into()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".into()),
        ],
        bytes,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(value: Value) -> Params {
        Params::from_json(&value).unwrap()
    }

    fn valid() -> Value {
        json!({"resourceId": Uuid::new_v4(), "resourceVersion": 3,
            "agentDefinitionExport": {"versionAssetId": Uuid::new_v4(), "mediaType": "image/png"}})
    }

    #[test]
    fn export_params_are_a_closed_set() {
        assert!(validate_params(&params(valid())).is_ok());
        let mut extra = valid();
        extra["slug"] = json!("copy");
        assert!(validate_params(&params(extra)).is_err());
        let mut confirmed = valid();
        confirmed["explicitConfirmation"] = json!(true);
        assert!(validate_params(&params(confirmed)).is_err());
        let mut media = valid();
        media["agentDefinitionExport"]["mediaType"] = json!("application/zip");
        assert!(validate_params(&params(media)).is_err());
        let mut memory = valid();
        memory["agentDefinitionExport"]["memoryLevel"] = json!("core");
        assert!(validate_params(&params(memory)).is_err());
        let mut version = valid();
        version["resourceVersion"] = json!(0);
        assert!(validate_params(&params(version)).is_err());
    }

    #[test]
    fn package_asset_is_fixed_by_the_admitted_execution() {
        let action = Uuid::new_v4();
        assert_eq!(package_asset_id(action), package_asset_id(action));
        assert_ne!(package_asset_id(action), package_asset_id(Uuid::new_v4()));
        assert_ne!(package_asset_id(action), action);
    }

    #[test]
    fn views_expose_bytes_only_through_ready_downloads() {
        let id = Uuid::new_v4();
        let creating: PackageRow = (
            id,
            Uuid::new_v4(),
            Uuid::new_v4(),
            None,
            FORMAT_KEY.into(),
            "image/png".into(),
            "CREATING".into(),
            None,
            None,
            None,
        );
        let v = view(&creating);
        assert!(v.get("downloadPath").is_none() && v.get("contentDigest").is_none());
        let mut ready = creating.clone();
        ready.6 = "READY".into();
        ready.7 = Some("a".repeat(64));
        ready.8 = Some(10);
        ready.9 = Some("Writer.agent.png".into());
        let v = view(&ready);
        assert_eq!(
            v["downloadPath"],
            format!("/api/v1/export-packages/{id}/content")
        );
        assert!(serde_json::from_value::<contracts::ExportPackageView>(v).is_ok());
    }
}
