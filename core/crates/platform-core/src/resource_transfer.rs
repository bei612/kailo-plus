//! DD-42、06 §7.1、05 §2.3/§2.12：跨 Tenant 资源转移的目标端 `RESOURCE_IMPORT`。
//!
//! 导入只信任本会话、本人上传的包字节与重算的 SHA-256；包不携带可信的 Tenant、Workspace、
//! owner 或来源 ID。`agent.definition.import`（DD-131(2)）在准入时预写新 Definition
//! （PROVISIONING）并消费上传，`ComponentTaskWorkflow(kind=RESOURCE_IMPORT)` 经本模块的
//! service 端点重读包、重验格式与运行配置，写入 Definition 与一个 DRAFT AgentVersion 的权限
//! 投影后一次落定。确定拒绝先删除可能已写的投影再终结；结果不明只以同一冻结意图重试。

use axum::{
    extract::{rejection::JsonRejection, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::Engine as _;
use contracts::ReasonCode;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use crate::agent_snapshot::{self, MediaType, Snapshot};
use crate::bff::{resolve_execution_context, BffState, ExecutionContext};
use crate::governance::{Actor, Definition, Execution, Params, Refusal, Target};
use crate::spicedb::Consistency;

pub(crate) const IMPORT: &str = "agent.definition.import";
pub(crate) const IMPORT_KIND: &str = "RESOURCE_IMPORT";
/// 上传暂存的有效期，与 Skill 上传同一约定（DD-135(3)）。
const UPLOAD_TTL_SECONDS: i64 = 30 * 60;
/// 请求体上界：最大包（PNG 10 MiB）的标准 base64 加 JSON 外壳。
pub(crate) const MAX_UPLOAD_REQUEST_BYTES: usize = agent_snapshot::MAX_PNG_BYTES / 3 * 4 + 4096;

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

/// 新 DRAFT 版本的 Asset ID 由导入 ActionExecution 确定性导出：重放与对账只会解析到同一个。
fn version_asset_id(action: Uuid) -> Uuid {
    Uuid::new_v5(&action, b"agent.definition.import/agent.version")
}

// ── 参数 ────────────────────────────────────────────────────────────────────

/// 参数闭集：导入输入、slug 与显式确认。显示名取自包，不由命令改写。
pub(crate) fn validate_params(p: &Params) -> Result<(), Refusal> {
    let value = p.to_json();
    if value.as_object().is_none_or(|map| {
        map.keys().any(|k| {
            !matches!(
                k.as_str(),
                "agentDefinitionImport" | "slug" | "explicitConfirmation"
            )
        })
    }) || p.explicit_confirmation != Some(true)
        || !p.slug.as_deref().is_some_and(crate::governance::valid_slug)
    {
        return Err(invalid());
    }
    input(p).map(|_| ())
}

pub(crate) struct ImportInput {
    pub upload_id: Uuid,
    pub package_digest: String,
    pub runtime_profile_key: String,
    pub model_route_resource_id: Uuid,
}

pub(crate) fn input(p: &Params) -> Result<ImportInput, Refusal> {
    let value = p.agent_definition_import.as_ref().ok_or_else(invalid)?;
    let typed: contracts::AgentDefinitionImportInput =
        serde_json::from_value(value.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(&typed).map_err(|_| invalid())? != *value {
        return Err(invalid());
    }
    let digest = text(value, "packageDigest")?;
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(invalid());
    }
    Ok(ImportInput {
        upload_id: Uuid::parse_str(text(value, "uploadId")?).map_err(|_| invalid())?,
        package_digest: digest.to_owned(),
        runtime_profile_key: text(value, "runtimeProfileKey")?.to_owned(),
        model_route_resource_id: Uuid::parse_str(text(value, "modelRouteResourceId")?)
            .map_err(|_| invalid())?,
    })
}

/// 命令参数的规范形：只保留契约字段，键序由 serde 固定。
pub(crate) fn normalize(input: &contracts::AgentDefinitionImportInput) -> Result<Value, Refusal> {
    serde_json::to_value(input).map_err(|_| invalid())
}

// ── 上传暂存 ─────────────────────────────────────────────────────────────────

struct Staged {
    media_type: String,
    package: Option<Vec<u8>>,
    package_digest: String,
    expired: bool,
    consumed_by: Option<Uuid>,
}

/// media_type, package, package_digest, expired, consumed_by
type StagedRow = (String, Option<Vec<u8>>, String, bool, Option<Uuid>);

async fn staged(
    conn: &mut PgConnection,
    tenant: Uuid,
    principal: Uuid,
    id: Uuid,
    lock: bool,
) -> Result<Option<Staged>, sqlx::Error> {
    let row: Option<StagedRow> = sqlx::query_as(&format!(
        "select media_type,package,package_digest,expires_at<=now(),consumed_by_action_execution_id
             from admission.transfer_upload where id=$1 and tenant_id=$2 and principal_id=$3
               and format_key=$4{}",
        if lock { " for update" } else { "" }
    ))
    .bind(id)
    .bind(tenant)
    .bind(principal)
    .bind(agent_snapshot::FORMAT_KEY)
    .fetch_optional(conn)
    .await?;
    Ok(row.map(
        |(media_type, package, package_digest, expired, consumed_by)| Staged {
            media_type,
            package,
            package_digest,
            expired,
            consumed_by,
        },
    ))
}

/// 重算 digest 并重新解码；字节缺失、摘要不符或格式不成立都是确定的参数拒绝。
fn reread(staged: &Staged, digest: &str) -> Result<Snapshot, Refusal> {
    let bytes = staged.package.as_deref().ok_or_else(invalid)?;
    if staged.package_digest != digest || agent_snapshot::sha256_hex(bytes) != digest {
        return Err(invalid());
    }
    let media = MediaType::from_wire(&staged.media_type).ok_or_else(invalid)?;
    agent_snapshot::decode(bytes, media)
}

/// 在本 Tenant 当前投递的 RuntimeProfile 合同下生成 DRAFT 内容，并按发布与安装同一链重验
/// Profile 与 Route（作者 fresh read）。Skill 与工具不带入，无需在此重验。
async fn draft_content(
    gov: &crate::governance::Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    human: Uuid,
    snapshot: &Snapshot,
    input: &ImportInput,
) -> Result<contracts::AgentVersionContent, Refusal> {
    let directory = crate::agent_version::runtime_profile_directory()?;
    let profile = directory
        .profiles
        .iter()
        .find(|p| p.key == input.runtime_profile_key)
        .ok_or_else(blocked)?;
    let content = agent_snapshot::content(
        snapshot,
        profile,
        &input.model_route_resource_id.to_string(),
    )?;
    crate::agent_version::content(&content)?;
    crate::agent_version::validate_runtime_references(gov, conn, tenant, human, &content).await?;
    Ok(content)
}

/// 本会话、本人的上传才可被导入命令引用；不符即不存在（与 Skill 上传同一规则）。
pub(crate) async fn check_session(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &contracts::ActionCommand,
) -> Result<(), Refusal> {
    let input = cmd.agent_definition_import.as_ref().ok_or_else(invalid)?;
    let id = Uuid::parse_str(&input.upload_id).map_err(|_| invalid())?;
    let owned: bool = sqlx::query_scalar(
        "select exists(select 1 from admission.transfer_upload
         where id=$1 and tenant_id=$2 and session_id=$3 and principal_id=$4)",
    )
    .bind(id)
    .bind(ctx.tenant_id)
    .bind(ctx.session_id)
    .bind(ctx.tenant_principal_id)
    .fetch_one(&state.pool)
    .await?;
    if owned {
        Ok(())
    } else {
        Err(Refusal::Precondition(ReasonCode::TargetNotFound))
    }
}

/// 动作随 release 开放且目录定义 ACTIVE，且是本模块实现的那一份策略（入口提示；提交时完整重新准入）。
async fn offered(state: &BffState) -> Result<bool, Response> {
    if !crate::capability_registry::action_exposed(IMPORT) {
        return Ok(false);
    }
    let def = crate::governance::active_definition(&state.pool, IMPORT)
        .await
        .map_err(crate::service_api::unavailable)?;
    Ok(def.is_some_and(|d| definition_matches(&d)))
}

fn definition_matches(def: &Definition) -> bool {
    def.component_type_key == "core"
        && def.target_type == "RESOURCE"
        && def.tenant_rule == "SESSION_TENANT"
        && def.workspace_rule == "TENANT_ONLY"
        && def.permission_object_type == "tenant"
        && def.permission == "create"
        && def.execution_mode == "TEMPORAL"
        && def.confirmation_mode == "EXPLICIT"
        && def.approval_policy_id.is_none()
        && def.workflow_kind.as_deref() == Some(IMPORT_KIND)
        && def.quota_policy == "NONE"
        && def.meters.is_empty()
        && def.result_exposure == "NONE"
}

async fn may_create(state: &BffState, ctx: &ExecutionContext) -> Result<bool, Response> {
    let proof = state
        .governance
        .spicedb
        .check(
            "tenant",
            &ctx.tenant_id.to_string(),
            "create",
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()).respond(None))?;
    if proof.zed_token.is_empty() {
        return Err(
            Refusal::Unavailable("Tenant create 缺原生 checked revision".into()).respond(None),
        );
    }
    Ok(proof.allowed)
}

#[allow(clippy::result_large_err)]
fn decode_view<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, Response> {
    serde_json::from_value(value).map_err(|_| {
        tracing::error!("快照导入视图不符合共享契约");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })
}

/// DD-131(2)、DD-143：校验一个快照包并为本会话暂存，返回导入预览。不创建任何对象；
/// 创建只经 `agent.definition.import`。违规以既有原因码拒绝且不暂存字节（DD-131(9)）。
pub async fn upload(
    State(state): State<BffState>,
    headers: HeaderMap,
    request: Result<Json<contracts::AgentSnapshotUploadRequest>, JsonRejection>,
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
    match may_create(&state, &ctx).await {
        Ok(true) => {}
        Ok(false) => return StatusCode::FORBIDDEN.into_response(),
        Err(r) => return r,
    }
    // 授权在前：未授权者看不到上限判定。超过请求上限的上传在读完前即被截断。
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
    let snapshot = match agent_snapshot::decode(&bytes, media) {
        Ok(snapshot) => snapshot,
        Err(refusal) => return refusal.respond(None),
    };
    let digest = agent_snapshot::sha256_hex(&bytes);
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
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+make_interval(secs=>$10::bigint)) returning expires_at",
    )
    .bind(upload_id)
    .bind(ctx.tenant_id)
    .bind(ctx.session_id)
    .bind(ctx.tenant_principal_id)
    .bind(agent_snapshot::FORMAT_KEY)
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
    if let Err(e) = tx.commit().await {
        return crate::service_api::unavailable(e);
    }
    let mut view = agent_snapshot::preview_fields(&snapshot);
    view["uploadId"] = json!(upload_id);
    view["packageDigest"] = json!(digest);
    view["packageByteSize"] = json!(bytes.len());
    view["mediaType"] = json!(media.wire());
    view["formatKey"] = json!(agent_snapshot::FORMAT_KEY);
    view["expiresAt"] = json!(expires.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
    match decode_view::<contracts::AgentSnapshotImportPreview>(view) {
        Ok(view) => Json(view).into_response(),
        Err(r) => r,
    }
}

#[derive(Deserialize)]
pub struct PageQuery {
    offset: Option<i64>,
}

/// DD-131(2)、DD-26：导入人可重选的 RuntimeProfile 与 Route（与版本配置目录同一来源）。
pub async fn configuration(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(query): Query<PageQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    let offset = query.offset.unwrap_or(0);
    let limit = i64::from(state.governance.cfg.relationship_page);
    if offset < 0 || limit <= 0 || offset.checked_add(limit).is_none() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let mut connection = match state.pool.acquire().await {
        Ok(c) => c,
        Err(e) => return crate::service_api::unavailable(e),
    };
    let (profiles, routes, next) =
        match crate::agent_version_query::sources(&state, &ctx, &mut connection, offset, limit)
            .await
        {
            Ok(v) => v,
            Err(r) => return r,
        };
    let can_import = !routes.is_empty()
        && match offered(&state).await {
            Ok(true) => match may_create(&state, &ctx).await {
                Ok(allowed) => allowed,
                Err(r) => return r,
            },
            Ok(false) => false,
            Err(r) => return r,
        };
    match decode_view::<contracts::AgentImportConfigurationPage>(json!({
        "profiles": profiles, "routes": routes, "nextOffset": next, "canImport": can_import,
    })) {
        Ok(page) => Json(page).into_response(),
        Err(r) => r,
    }
}

// ── 准入 ────────────────────────────────────────────────────────────────────

/// 新建类 target：Tenant 级 `agent.definition` Resource，ID 首次准入时分配并冻结。
pub(crate) async fn target(
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    def: &Definition,
    p: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    validate_params(p)?;
    if !definition_matches(def) {
        return Err(blocked());
    }
    let taken: Option<Uuid> = sqlx::query_scalar(
        "select a.resource_id from catalog.agent_definition a join catalog.resource r on r.id=a.resource_id
         where r.tenant_id=$1 and a.stable_slug=$2",
    )
    .bind(tenant)
    .bind(&p.slug)
    .fetch_optional(&mut *conn)
    .await?;
    if taken.is_some_and(|id| frozen != Some(id)) {
        return Err(conflict());
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

/// 准入门：暂存仍属发起人、未过期且未被别的导入消费，字节摘要与命令一致，所选 Profile 与 Route
/// 在当前合同与权限下成立。`frozen` 是已预写的同一 ActionExecution（重放时上传已被它消费）。
pub(crate) async fn gate(
    gov: &crate::governance::Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    p: &Params,
) -> Result<(), Refusal> {
    let input = input(p)?;
    let staged = staged(conn, tenant, initiator, input.upload_id, false)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    if staged.expired || staged.consumed_by.is_some() {
        return Err(conflict());
    }
    let snapshot = reread(&staged, &input.package_digest)?;
    draft_content(gov, conn, tenant, initiator, &snapshot, &input).await?;
    Ok(())
}

/// 准入事务内：预写 PROVISIONING 的 Definition（owner 即发起 HUMAN）并原子消费上传。
pub(crate) async fn prewrite(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    p: &Params,
) -> Result<i32, Refusal> {
    if !crate::agent_definition::active_owner(tx, ae.tenant_id, ae.initiator_principal_id).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let input = input(p)?;
    let registered: Option<String> = sqlx::query_scalar(
        "select type_key from catalog.resource_type_definition where type_key='agent.definition'
         and status='ACTIVE' and capability_category is null and tenant_delete_action_key='tenant.delete'",
    )
    .fetch_optional(&mut **tx)
    .await?;
    let type_key = registered.ok_or_else(blocked)?;
    let consumed = sqlx::query(
        "update admission.transfer_upload set consumed_by_action_execution_id=$5
         where id=$1 and tenant_id=$2 and principal_id=$3 and package_digest=$4
           and consumed_by_action_execution_id is null and package is not null and expires_at>now()",
    )
    .bind(input.upload_id)
    .bind(ae.tenant_id)
    .bind(ae.initiator_principal_id)
    .bind(&input.package_digest)
    .bind(ae.id)
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
    let snapshot = reread(&staged, &input.package_digest)?;
    sqlx::query("insert into catalog.resource
        (id,tenant_id,type_key,owner_principal_id,component_type_key,native_type,native_id,state,version,projection_action_execution_id)
        values ($1,$2,$3,$4,$5,$3,$1::text,'PROVISIONING',1,$6)")
        .bind(ae.target_id).bind(ae.tenant_id).bind(&type_key).bind(ae.initiator_principal_id)
        .bind(&def.component_type_key).bind(ae.id).execute(&mut **tx).await?;
    sqlx::query(
        "insert into catalog.agent_definition(resource_id,stable_slug,display_name,status)
         values ($1,$2,$3,'PROVISIONING')",
    )
    .bind(ae.target_id)
    .bind(&p.slug)
    .bind(&snapshot.display_name)
    .execute(&mut **tx)
    .await?;
    Ok(1)
}

fn workflow_target(ae: &Execution, workflow: &str) -> Result<Value, Refusal> {
    let p = ae
        .parameters
        .as_ref()
        .and_then(|v| v.get("params"))
        .and_then(Params::from_json)
        .ok_or_else(invalid)?;
    let input = input(&p)?;
    Ok(json!({
        "actionExecutionId": ae.id, "resourceId": ae.target_id,
        "versionAssetId": version_asset_id(ae.id), "workflowId": workflow,
        "formatKey": agent_snapshot::FORMAT_KEY, "packageDigest": input.package_digest,
    }))
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
                && ae.action_key == IMPORT
                && ae.gate_state == "ALLOWED"
                && ae.temporal_workflow_id.as_deref() == Some(workflow)
        })
        .ok_or_else(|| StatusCode::CONFLICT.into_response())?;
    let target = workflow_target(&ae, workflow).map_err(|e| e.respond(None))?;
    let run_id = crate::component_task::start(
        pool,
        temporal,
        workflow,
        tenant,
        action,
        &crate::component_task::ComponentTaskInput {
            kind: IMPORT_KIND.into(),
            target: json!({ "resourceImport": target }),
        },
    )
    .await?;
    Ok(crate::membership_lifecycle::LifecycleResponse {
        workflow_id: workflow.into(),
        kind: IMPORT_KIND.into(),
        run_id,
    })
}

// ── Workflow 推进（service API）──────────────────────────────────────────────

pub(crate) async fn advance(
    State(state): State<crate::service_api::ServiceState>,
    headers: HeaderMap,
    body: Result<Json<contracts::ResourceImportAdvanceRequest>, JsonRejection>,
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

fn status(id: Uuid, status: &str) -> Value {
    json!({"resourceId": id, "status": status, "waitingReason": "NONE"})
}

async fn advance_inner(
    state: &crate::service_api::ServiceState,
    request: contracts::ResourceImportAdvanceRequest,
) -> Result<Value, Refusal> {
    let value = serde_json::to_value(request).map_err(|_| invalid())?;
    let target = &value["target"];
    let action = Uuid::parse_str(text(target, "actionExecutionId")?).map_err(|_| invalid())?;
    let id = Uuid::parse_str(text(target, "resourceId")?).map_err(|_| invalid())?;
    let workflow = text(target, "workflowId")?;
    let ae = crate::governance::load_execution(&state.pool, action)
        .await?
        .ok_or_else(conflict)?;
    if ae.action_key != IMPORT
        || ae.target_id != id
        || ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "DISPATCHED"
        || ae.temporal_workflow_id.as_deref() != Some(workflow)
        || *target != workflow_target(&ae, workflow)?
    {
        return Err(conflict());
    }
    let observed = state
        .temporal
        .describe(workflow)
        .await
        .map_err(|_| Refusal::Unavailable("import workflow observation unavailable".into()))?
        .ok_or_else(|| Refusal::Unavailable("import workflow missing".into()))?;
    let first: Option<String> = sqlx::query_scalar(
        "select run_id from projection.workflow_ref where workflow_id=$1
         and action_execution_id=$2 and tenant_id=$3 and operation_id=$4 and kind=$5
         and workflow_type='ComponentTaskWorkflow'",
    )
    .bind(workflow)
    .bind(ae.id)
    .bind(ae.tenant_id)
    .bind(ae.operation_id)
    .bind(IMPORT_KIND)
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
            id,
            if code == "SUCCEEDED" {
                "COMPLETED"
            } else {
                "FAILED"
            },
        ));
    }
    let def = crate::governance::exact_definition(&state.pool, IMPORT, ae.action_version).await?;
    let p = ae
        .parameters
        .as_ref()
        .and_then(|v| v.get("params"))
        .and_then(Params::from_json)
        .ok_or_else(invalid)?;
    let import = input(&p)?;
    let asset = version_asset_id(ae.id);

    let mut tx = state.pool.begin().await?;
    crate::governance::lock_execution(&mut tx, ae.id).await?;
    crate::roles::lock_tenant(&mut tx, ae.tenant_id).await?;
    let row: Option<(String, Uuid, Option<Uuid>)> = sqlx::query_as(
        "select r.state,r.owner_principal_id,r.projection_action_execution_id
         from catalog.resource r join catalog.agent_definition a on a.resource_id=r.id
         where r.id=$1 and r.tenant_id=$2 and r.home_workspace_id is null for update of r",
    )
    .bind(id)
    .bind(ae.tenant_id)
    .fetch_optional(&mut *tx)
    .await?;
    let (resource_state, owner, writer) = row.ok_or_else(conflict)?;
    if writer != Some(ae.id)
        || owner != ae.initiator_principal_id
        || !matches!(resource_state.as_str(), "PROVISIONING" | "UNKNOWN")
    {
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
    // 确定的拒绝：取消、包不在或字节/摘要/格式不成立、所选配置与权限不再成立。
    let decision = async {
        if value["cancelRequested"] == true {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
        let staged = staged.as_ref().ok_or_else(conflict)?;
        let snapshot = reread(staged, &import.package_digest)?;
        let content = draft_content(
            &state.governance,
            &mut tx,
            ae.tenant_id,
            ae.initiator_principal_id,
            &snapshot,
            &import,
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
        Ok(content)
    }
    .await;
    let content = match decision {
        Ok(content) => content,
        Err(Refusal::Unavailable(reason)) => {
            mark_unknown(&mut tx, id).await?;
            tx.commit().await?;
            return Err(Refusal::Unavailable(reason));
        }
        Err(_) => {
            mark_unknown(&mut tx, id).await?;
            tx.commit().await?;
            return fail(state, &ae, &def, asset).await;
        }
    };
    let (normalized, hash) = crate::agent_version::content(&content)?;
    sqlx::query(
        "insert into catalog.asset
         (id,tenant_id,resource_id,type_key,owner_principal_id,producer_principal_id,native_ref,state,version,projection_action_execution_id)
         values ($1,$2,$3,'agent.version',$4,$4,$1::text,'DRAFT',1,$5) on conflict (id) do nothing",
    )
    .bind(asset)
    .bind(ae.tenant_id)
    .bind(id)
    .bind(ae.initiator_principal_id)
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "insert into catalog.agent_version (asset_id,agent_resource_id,ordinal,content,config_hash,state)
         values ($1,$2,1,$3,$4,'DRAFT') on conflict (asset_id) do nothing",
    )
    .bind(asset)
    .bind(id)
    .bind(&normalized)
    .bind(&hash)
    .execute(&mut *tx)
    .await?;
    let stored: Option<(String, String)> = sqlx::query_as(
        "select v.config_hash,a.state from catalog.agent_version v join catalog.asset a on a.id=v.asset_id
         where v.asset_id=$1 and v.agent_resource_id=$2 and a.projection_action_execution_id=$3",
    )
    .bind(asset)
    .bind(id)
    .bind(ae.id)
    .fetch_optional(&mut *tx)
    .await?;
    if stored.as_ref().map(|(h, s)| (h.as_str(), s.as_str())) != Some((hash.as_str(), "DRAFT")) {
        return Err(conflict());
    }
    let projection = project(state, &ae, id, asset).await;
    let tokens = match projection {
        Ok(tokens) => tokens,
        Err(error) => {
            mark_unknown(&mut tx, id).await?;
            tx.commit().await?;
            return Err(error);
        }
    };
    sqlx::query(
        "update catalog.asset set projection_action_execution_id=null,version=version+1
         where id=$1 and projection_action_execution_id=$2",
    )
    .bind(asset)
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    let changed = sqlx::query(
        "update catalog.resource set state='ACTIVE',version=version+1,projection_action_execution_id=null
         where id=$1 and tenant_id=$2 and projection_action_execution_id=$3",
    )
    .bind(id)
    .bind(ae.tenant_id)
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(conflict());
    }
    sqlx::query("update catalog.agent_definition set status='ACTIVE' where resource_id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    clear_package(&mut tx, ae.id).await?;
    let mut evidence = transfer_evidence(&ae, &import.package_digest);
    evidence.push(crate::audit::Evidence::new(
        contracts::EvidenceKind::AgentVersionAssetId,
        asset,
    ));
    for token in tokens {
        evidence.push(crate::audit::Evidence::new(
            contracts::EvidenceKind::SpicedbZedtoken,
            token,
        ));
    }
    terminal_audit(&mut tx, &ae, &def, "SUCCEEDED", evidence).await?;
    tx.commit().await?;
    Ok(status(id, "COMPLETED"))
}

/// Definition 与 DRAFT 版本的 SpiceDB 投影：写后以 AtLeastAsFresh 查证，返回两条写入 revision。
async fn project(
    state: &crate::service_api::ServiceState,
    ae: &Execution,
    id: Uuid,
    asset: Uuid,
) -> Result<Vec<String>, Refusal> {
    let spicedb = &state.governance.spicedb;
    let unavailable = |e: crate::spicedb::SpiceDbError| Refusal::Unavailable(e.to_string());
    let owner = ae.initiator_principal_id.to_string();
    let tenant = ae.tenant_id.to_string();
    let resource = id.to_string();
    let zed = spicedb
        .replace_resource_projection(&resource, &tenant, &owner, &owner, None)
        .await
        .map_err(unavailable)?;
    let checked = spicedb
        .check(
            "resource",
            &resource,
            "read",
            &owner,
            Consistency::AtLeastAsFresh(&zed),
        )
        .await
        .map_err(unavailable)?;
    if !checked.allowed || checked.zed_token.is_empty() {
        return Err(Refusal::Unavailable(
            "import projection is not causally visible".into(),
        ));
    }
    let asset_zed = spicedb
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
            "imported version projection mismatch".into(),
        ));
    }
    let read = spicedb
        .check(
            "asset",
            &asset.to_string(),
            "read",
            &owner,
            Consistency::AtLeastAsFresh(&asset_zed),
        )
        .await
        .map_err(unavailable)?;
    if !read.allowed || read.zed_token.is_empty() {
        return Err(Refusal::Unavailable(
            "imported version projection is not causally visible".into(),
        ));
    }
    Ok(vec![checked.zed_token, read.zed_token])
}

async fn mark_unknown(tx: &mut Transaction<'_, Postgres>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update catalog.resource set state='UNKNOWN' where id=$1 and state in ('PROVISIONING','UNKNOWN')",
    )
    .bind(id)
    .execute(&mut **tx)
    .await
    .map(|_| ())
}

/// 确定拒绝：先原生删除可能已写的 Definition/版本投影并以删除 revision 查证，再把预写对象
/// 转为墓碑、清空包字节并终结；删除回应不明时保持 UNKNOWN，由下一轮以同一意图重试。
async fn fail(
    state: &crate::service_api::ServiceState,
    ae: &Execution,
    def: &Definition,
    asset: Uuid,
) -> Result<Value, Refusal> {
    let spicedb = &state.governance.spicedb;
    let unavailable = |e: crate::spicedb::SpiceDbError| Refusal::Unavailable(e.to_string());
    let asset_zed = spicedb
        .delete_asset_projection(asset)
        .await
        .map_err(unavailable)?;
    let zed = spicedb
        .delete_resource_projection(ae.target_id)
        .await
        .map_err(unavailable)?;
    if zed.is_empty() || asset_zed.is_empty() {
        return Err(Refusal::Unavailable(
            "import cleanup revision missing".into(),
        ));
    }
    let mut tx = state.pool.begin().await?;
    crate::governance::lock_execution(&mut tx, ae.id).await?;
    if terminal_code(&state.pool, ae).await?.is_some() {
        tx.commit().await?;
        return Ok(status(ae.target_id, "FAILED"));
    }
    sqlx::query(
        "update catalog.asset set state='DELETED',version=version+1,projection_action_execution_id=null
         where id=$1 and projection_action_execution_id=$2",
    )
    .bind(asset)
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    let changed = sqlx::query(
        "update catalog.resource set state='DELETED',version=version+1,projection_action_execution_id=null
         where id=$1 and tenant_id=$2 and projection_action_execution_id=$3",
    )
    .bind(ae.target_id)
    .bind(ae.tenant_id)
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(conflict());
    }
    sqlx::query("update catalog.agent_definition set status='DELETED' where resource_id=$1")
        .bind(ae.target_id)
        .execute(&mut *tx)
        .await?;
    clear_package(&mut tx, ae.id).await?;
    let mut evidence = transfer_evidence(ae, &input_digest(ae)?);
    evidence.push(crate::audit::Evidence::new(
        contracts::EvidenceKind::SpicedbZedtoken,
        zed,
    ));
    terminal_audit(&mut tx, ae, def, "FAILED", evidence).await?;
    tx.commit().await?;
    Ok(status(ae.target_id, "FAILED"))
}

fn input_digest(ae: &Execution) -> Result<String, Refusal> {
    let p = ae
        .parameters
        .as_ref()
        .and_then(|v| v.get("params"))
        .and_then(Params::from_json)
        .ok_or_else(invalid)?;
    Ok(input(&p)?.package_digest)
}

async fn clear_package(
    tx: &mut Transaction<'_, Postgres>,
    action: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update admission.transfer_upload set package=null where consumed_by_action_execution_id=$1",
    )
    .bind(action)
    .execute(&mut **tx)
    .await
    .map(|_| ())
}

fn transfer_evidence(ae: &Execution, digest: &str) -> Vec<crate::audit::Evidence> {
    vec![
        crate::audit::Evidence::new(contracts::EvidenceKind::ActionExecutionId, ae.id),
        crate::audit::Evidence::new(
            contracts::EvidenceKind::TransferFormat,
            agent_snapshot::FORMAT_KEY,
        ),
        crate::audit::Evidence::new(contracts::EvidenceKind::TransferPackageDigest, digest),
    ]
}

async fn terminal_code(pool: &sqlx::PgPool, ae: &Execution) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "select result_code from audit.audit_event where event_key=$1 and action_key=$2 and operation_id=$3",
    )
    .bind(format!("{}:import:terminal", ae.id))
    .bind(IMPORT)
    .bind(ae.operation_id)
    .fetch_optional(pool)
    .await
}

/// 审计只记格式、包摘要、新建对象与 revision，不记 instructions 或包正文（DD-131(8)）。
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

#[cfg(test)]
mod tests {
    use super::*;

    fn params(value: Value) -> Params {
        Params::from_json(&value).unwrap()
    }

    fn valid() -> Value {
        json!({"slug": "release-writer", "explicitConfirmation": true,
            "agentDefinitionImport": {"uploadId": Uuid::new_v4(), "packageDigest": "a".repeat(64),
                "runtimeProfileKey": "server-codex", "modelRouteResourceId": Uuid::new_v4()}})
    }

    #[test]
    fn import_params_are_a_closed_confirmed_set() {
        assert!(validate_params(&params(valid())).is_ok());
        let mut unconfirmed = valid();
        unconfirmed["explicitConfirmation"] = json!(false);
        assert!(validate_params(&params(unconfirmed)).is_err());
        let mut extra = valid();
        extra["name"] = json!("Renamed");
        assert!(validate_params(&params(extra)).is_err());
        let mut upper = valid();
        upper["agentDefinitionImport"]["packageDigest"] = json!("A".repeat(64));
        assert!(validate_params(&params(upper)).is_err());
        let mut slug = valid();
        slug["slug"] = json!("Bad Slug");
        assert!(validate_params(&params(slug)).is_err());
    }

    #[test]
    fn version_asset_is_fixed_by_the_admitted_execution() {
        let action = Uuid::new_v4();
        assert_eq!(version_asset_id(action), version_asset_id(action));
        assert_ne!(version_asset_id(action), version_asset_id(Uuid::new_v4()));
        assert_ne!(version_asset_id(action), action);
    }
}
