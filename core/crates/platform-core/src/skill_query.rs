//! DD-135(2)(3)(4)、05 §2.14、17 §8：Skill 的 BFF 只读查询与一次性上传暂存。
//!
//! 目录列表需定义 `discover`；定义、已发布或已退役版本与其内容需定义 `read`；`DRAFT` 版本只对
//! 版本 Asset `read` 持有者可见。上传只校验并暂存本会话、本人、本定义的规范 artifact，
//! 不创建版本；版本只经 `skill.version.create` 产生。全部回应只含元数据，正文只经内容端点。

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::bff::{resolve_execution_context, BffState, ExecutionContext};
use crate::governance::skill_catalog::{self, SkillDefinition, SkillVersion};
use crate::governance::Refusal;
use crate::skill_artifact;
use crate::spicedb::Consistency;

/// DD-135(3)：暂存上传的有效期。
const UPLOAD_TTL_SECONDS: i64 = 30 * 60;
/// 请求体上界：1 MiB 原始字节的标准 base64 加 JSON 外壳。
pub(crate) const MAX_UPLOAD_REQUEST_BYTES: usize = skill_artifact::MAX_UPLOAD_BYTES / 3 * 4 + 4096;

#[derive(Deserialize)]
pub struct PageQuery {
    pub offset: Option<i64>,
}

fn unavailable(e: impl std::fmt::Display) -> Response {
    Refusal::Unavailable(e.to_string()).respond(None)
}

/// 当前 HUMAN 对一个对象的 FullyConsistent permission；缺 revision 视为不可用。
async fn fresh(
    state: &BffState,
    ctx: &ExecutionContext,
    object: &str,
    id: Uuid,
    permission: &str,
) -> Result<bool, Response> {
    let proof = state
        .governance
        .spicedb
        .check(
            object,
            &id.to_string(),
            permission,
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(unavailable)?;
    if proof.zed_token.is_empty() {
        return Err(unavailable("Skill read 缺原生 checked revision"));
    }
    Ok(proof.allowed)
}

/// 动作已随 release 开放且目录定义 ACTIVE（入口提示；提交时完整重新准入）。
async fn offered(state: &BffState, key: &str) -> Result<bool, Response> {
    Ok(crate::capability_registry::action_exposed(key)
        && crate::governance::active_definition(&state.pool, key)
            .await
            .map_err(crate::service_api::unavailable)?
            .is_some())
}

/// 已闭合投影的定义（含已停用者）及其目录分享位；投影不符即不可用。
async fn readable_definition(
    state: &BffState,
    ctx: &ExecutionContext,
    id: Uuid,
) -> Result<(SkillDefinition, bool), Response> {
    let mut conn = state
        .pool
        .acquire()
        .await
        .map_err(crate::service_api::unavailable)?;
    let d = skill_catalog::definition(&mut conn, ctx.tenant_id, id, false)
        .await
        .map_err(crate::service_api::unavailable)?
        .filter(|d| d.state == "ACTIVE" && d.projection_action_execution_id.is_none())
        .filter(|d| matches!(d.status.as_str(), "ACTIVE" | "DISABLED"))
        .ok_or_else(|| StatusCode::NOT_FOUND.into_response())?;
    let shared = skill_catalog::definition_projection(&state.governance, &d)
        .await
        .map_err(|e| e.respond(None))?
        .ok_or_else(|| unavailable("Skill 定义投影不一致"))?;
    if !fresh(state, ctx, "resource", d.id, "read").await? {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    Ok((d, shared))
}

fn definition_json(d: &SkillDefinition, shared: bool) -> Value {
    json!({
        "resourceId": d.id, "ownerPrincipalId": d.owner_principal_id,
        "stableSlug": d.stable_slug, "displayName": d.display_name, "status": d.status,
        "resourceVersion": d.version,
        "currentPublishedVersionAssetId": d.current_published_version_asset_id,
        "catalogShared": shared,
    })
}

fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, Response> {
    serde_json::from_value(value).map_err(|_| {
        tracing::error!("Skill 查询事实不符合共享契约");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })
}

pub async fn list(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(q): Query<PageQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    let offset = q.offset.unwrap_or(0);
    if offset < 0 {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let limit = i64::from(state.governance.cfg.relationship_page);
    let rows: Vec<SkillDefinition> = match sqlx::query_as(
        "select r.id,r.tenant_id,r.owner_principal_id,r.state,r.version,r.projection_action_execution_id,
         d.stable_slug,d.display_name,d.status,d.current_published_version_asset_id
         from catalog.skill_definition d join catalog.resource r on r.id=d.resource_id and r.tenant_id=d.tenant_id
         where r.tenant_id=$1 and r.type_key='skill.definition' and r.state='ACTIVE'
           and r.projection_action_execution_id is null and d.status in ('ACTIVE','DISABLED')
         order by d.stable_slug,r.id offset $2 limit $3",
    )
    .bind(ctx.tenant_id)
    .bind(offset)
    .bind(limit)
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => return crate::service_api::unavailable(e),
    };
    let ids: Vec<String> = rows.iter().map(|r| r.id.to_string()).collect();
    let allowed = match state
        .governance
        .spicedb
        .check_bulk(
            "resource",
            &ids,
            "discover",
            &ctx.tenant_principal_id.to_string(),
        )
        .await
    {
        Ok(a) => a,
        Err(e) => return unavailable(e),
    };
    let next =
        (rows.len() == usize::try_from(limit).unwrap_or(usize::MAX)).then_some(offset + limit);
    let mut definitions = Vec::new();
    for d in rows.iter().filter(|r| allowed.contains(&r.id.to_string())) {
        let shared = match skill_catalog::definition_projection(&state.governance, d).await {
            Ok(Some(shared)) => shared,
            Ok(None) => return unavailable("Skill 定义投影不一致"),
            Err(e) => return e.respond(None),
        };
        definitions.push(definition_json(d, shared));
    }
    match decode::<contracts::SkillDefinitionPage>(
        json!({"definitions": definitions, "nextOffset": next}),
    ) {
        Ok(page) => Json(page).into_response(),
        Err(r) => r,
    }
}

pub async fn get(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    let (d, shared) = match readable_definition(&state, &ctx, id).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let mut view = definition_json(&d, shared);
    let active = d.status == "ACTIVE";
    for (field, key, permission) in [
        ("canUpload", "skill.version.create", "create"),
        ("canDisable", "skill.definition.disable", "manage"),
        ("canShare", "skill.definition.share", "share"),
    ] {
        let can = match offered(&state, key).await {
            Ok(true) if active || field == "canShare" => {
                match fresh(&state, &ctx, "resource", d.id, permission).await {
                    Ok(v) => v,
                    Err(r) => return r,
                }
            }
            Ok(_) => false,
            Err(r) => return r,
        };
        view[field] = json!(can);
    }
    match decode::<contracts::SkillDefinitionView>(view) {
        Ok(v) => Json(v).into_response(),
        Err(r) => r,
    }
}

fn version_json(v: &SkillVersion, slug: &str, current: bool) -> Value {
    json!({
        "assetId": v.asset_id, "skillResourceId": v.skill_resource_id, "stableSlug": slug,
        "ordinal": v.ordinal, "assetVersion": v.version, "ownerPrincipalId": v.owner_principal_id,
        "skillName": v.skill_name, "description": v.description,
        "shortDescription": v.short_description, "artifactFormat": v.artifact_format,
        "artifactDigest": v.artifact_digest, "artifactByteSize": v.artifact_byte_size,
        "metadataHash": v.metadata_hash, "capabilityRequirements": v.capability_requirements,
        "state": v.state, "current": current,
    })
}

/// 版本可见性：PUBLISHED/RETIRED 随定义 `read`（调用前已核），DRAFT 需版本 Asset `read`。
async fn version_visible(
    state: &BffState,
    ctx: &ExecutionContext,
    v: &SkillVersion,
) -> Result<bool, Response> {
    if v.projection_action_execution_id.is_some() || v.asset_state != v.state {
        return Ok(false);
    }
    match v.state.as_str() {
        "PUBLISHED" | "RETIRED" => Ok(true),
        "DRAFT" => fresh(state, ctx, "asset", v.asset_id, "read").await,
        _ => Ok(false),
    }
}

async fn version_view(
    state: &BffState,
    ctx: &ExecutionContext,
    d: &SkillDefinition,
    v: &SkillVersion,
) -> Result<Value, Response> {
    if !skill_catalog::version_projection_matches(&state.governance, v)
        .await
        .map_err(|e| e.respond(None))?
    {
        return Err(unavailable("Skill 版本 Asset 投影不一致"));
    }
    let mut view = version_json(
        v,
        &d.stable_slug,
        d.current_published_version_asset_id == Some(v.asset_id),
    );
    let (key, want) = match v.state.as_str() {
        "DRAFT" => ("skill.version.publish", d.status == "ACTIVE"),
        "PUBLISHED" => ("skill.version.retire", true),
        _ => ("", false),
    };
    let can = want
        && offered(state, key).await?
        && fresh(state, ctx, "asset", v.asset_id, "manage").await?;
    view[if v.state == "DRAFT" {
        "canPublish"
    } else {
        "canRetire"
    }] = json!(can);
    Ok(view)
}

pub async fn versions(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Query(q): Query<PageQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    let offset = q.offset.unwrap_or(0);
    if offset < 0 {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let (d, _) = match readable_definition(&state, &ctx, id).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let limit = i64::from(state.governance.cfg.relationship_page);
    let rows: Vec<SkillVersion> = match sqlx::query_as(&format!(
        "select {} from catalog.skill_version v
         join catalog.asset a on a.id=v.asset_id and a.tenant_id=v.tenant_id
         where v.tenant_id=$1 and v.skill_resource_id=$2 and a.type_key='skill.version'
         order by v.ordinal desc offset $3 limit $4",
        skill_catalog::VERSION_COLUMNS
    ))
    .bind(ctx.tenant_id)
    .bind(d.id)
    .bind(offset)
    .bind(limit)
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => return crate::service_api::unavailable(e),
    };
    let next =
        (rows.len() == usize::try_from(limit).unwrap_or(usize::MAX)).then_some(offset + limit);
    let mut versions = Vec::new();
    for v in &rows {
        match version_visible(&state, &ctx, v).await {
            Ok(true) => {}
            Ok(false) => continue,
            Err(r) => return r,
        }
        match version_view(&state, &ctx, &d, v).await {
            Ok(view) => versions.push(view),
            Err(r) => return r,
        }
    }
    match decode::<contracts::SkillVersionPage>(json!({
        "skillResourceId": d.id, "resourceVersion": d.version, "versions": versions, "nextOffset": next,
    })) {
        Ok(page) => Json(page).into_response(),
        Err(r) => r,
    }
}

/// 读取一个版本及其父定义，并按 DD-135(4) 的可见性规则授权。
async fn readable_version(
    state: &BffState,
    ctx: &ExecutionContext,
    id: Uuid,
) -> Result<(SkillDefinition, SkillVersion), Response> {
    let mut conn = state
        .pool
        .acquire()
        .await
        .map_err(crate::service_api::unavailable)?;
    let v = skill_catalog::version(&mut conn, ctx.tenant_id, id, false)
        .await
        .map_err(crate::service_api::unavailable)?
        .ok_or_else(|| StatusCode::NOT_FOUND.into_response())?;
    drop(conn);
    let (d, _) = readable_definition(state, ctx, v.skill_resource_id).await?;
    if !version_visible(state, ctx, &v).await? {
        return Err(StatusCode::NOT_FOUND.into_response());
    }
    Ok((d, v))
}

pub async fn version(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    let (d, v) = match readable_version(&state, &ctx, id).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    match version_view(&state, &ctx, &d, &v)
        .await
        .and_then(decode::<contracts::SkillVersionView>)
    {
        Ok(view) => Json(view).into_response(),
        Err(r) => r,
    }
}

/// 版本正文（规范 `SKILL.md`）。读取即对该版本的 `read`；返回前以 digest 重算。
pub async fn content(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    let (_, v) = match readable_version(&state, &ctx, id).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let bytes: Option<Option<Vec<u8>>> = match sqlx::query_scalar(
        "select artifact from catalog.skill_version where asset_id=$1 and tenant_id=$2",
    )
    .bind(v.asset_id)
    .bind(ctx.tenant_id)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(b) => b,
        Err(e) => return crate::service_api::unavailable(e),
    };
    let Some(Some(bytes)) = bytes else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if skill_artifact::sha256_hex(&bytes) != v.artifact_digest {
        return unavailable("Skill artifact digest 不一致");
    }
    let Ok(text) = String::from_utf8(bytes) else {
        return unavailable("Skill artifact 不是 UTF-8");
    };
    let mut response = Json(contracts::SkillVersionContentView {
        asset_id: v.asset_id.to_string(),
        artifact_digest: v.artifact_digest,
        content: text,
    })
    .into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("no-store"),
    );
    response
}

/// DD-135(4)：AgentVersion 编辑器可选的版本——当前 HUMAN fresh 可 `read` 的 ACTIVE 定义下的
/// PUBLISHED 版本；目录只是选择入口，引用仍在动作准入中完整重验。
pub async fn references(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(q): Query<PageQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    let offset = q.offset.unwrap_or(0);
    if offset < 0 {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let limit = i64::from(state.governance.cfg.relationship_page);
    #[derive(sqlx::FromRow)]
    struct Row {
        #[sqlx(flatten)]
        version: SkillVersion,
        stable_slug: String,
        current: bool,
    }
    let rows: Vec<Row> = match sqlx::query_as(&format!(
        "select {},d.stable_slug,d.current_published_version_asset_id is not distinct from v.asset_id as current
         from catalog.skill_version v
         join catalog.asset a on a.id=v.asset_id and a.tenant_id=v.tenant_id
         join catalog.skill_definition d on d.resource_id=v.skill_resource_id and d.tenant_id=v.tenant_id
         join catalog.resource r on r.id=d.resource_id and r.tenant_id=d.tenant_id
         where v.tenant_id=$1 and v.state='PUBLISHED' and a.state='PUBLISHED'
           and a.projection_action_execution_id is null and d.status='ACTIVE' and r.state='ACTIVE'
           and r.projection_action_execution_id is null
         order by d.stable_slug,v.ordinal desc offset $2 limit $3",
        skill_catalog::VERSION_COLUMNS
    ))
    .bind(ctx.tenant_id)
    .bind(offset)
    .bind(limit)
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => return crate::service_api::unavailable(e),
    };
    let next =
        (rows.len() == usize::try_from(limit).unwrap_or(usize::MAX)).then_some(offset + limit);
    let ids: Vec<String> = rows
        .iter()
        .map(|r| r.version.skill_resource_id.to_string())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let allowed = match state
        .governance
        .spicedb
        .check_bulk(
            "resource",
            &ids,
            "read",
            &ctx.tenant_principal_id.to_string(),
        )
        .await
    {
        Ok(a) => a,
        Err(e) => return unavailable(e),
    };
    let versions: Vec<Value> = rows
        .iter()
        .filter(|r| allowed.contains(&r.version.skill_resource_id.to_string()))
        .map(|r| version_json(&r.version, &r.stable_slug, r.current))
        .collect();
    match decode::<contracts::SkillReferencePage>(json!({"versions": versions, "nextOffset": next}))
    {
        Ok(page) => Json(page).into_response(),
        Err(r) => r,
    }
}

/// DD-135(2)(3)：上传校验与一次性暂存。只接受定义 `create` 持有者对 ACTIVE 定义的上传；
/// 违规以 422 逐项返回且不暂存字节。
pub async fn upload(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(request): Json<contracts::SkillArtifactUploadRequest>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    let (d, _) = match readable_definition(&state, &ctx, id).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if d.status != "ACTIVE" {
        return Refusal::Conflict(contracts::ReasonCode::TargetStateConflict).respond(None);
    }
    match offered(&state, "skill.version.create").await {
        Ok(true) => {}
        Ok(false) => return StatusCode::FORBIDDEN.into_response(),
        Err(r) => return r,
    }
    match fresh(&state, &ctx, "resource", d.id, "create").await {
        Ok(true) => {}
        Ok(false) => return StatusCode::FORBIDDEN.into_response(),
        Err(r) => return r,
    }
    use base64::Engine as _;
    let Ok(body) =
        base64::engine::general_purpose::STANDARD.decode(request.content_base64.as_bytes())
    else {
        return Refusal::Precondition(contracts::ReasonCode::InvalidParameters).respond(None);
    };
    let upload_digest = skill_artifact::sha256_hex(&body);
    let artifact = match skill_artifact::decode(&body, &d.stable_slug) {
        Ok(artifact) => artifact,
        Err(violations) => {
            let too_large = violations
                .iter()
                .any(|v| v.code == contracts::SkillArtifactViolationCode::UploadTooLarge);
            let view = json!({
                "accepted": false, "skillResourceId": d.id, "uploadDigest": upload_digest,
                "uploadByteSize": body.len(),
                "violations": violations.iter().map(|v| json!({"code": v.code, "path": v.path})).collect::<Vec<_>>(),
            });
            return match decode::<contracts::SkillArtifactUploadView>(view) {
                Ok(view) => (
                    if too_large {
                        StatusCode::PAYLOAD_TOO_LARGE
                    } else {
                        StatusCode::UNPROCESSABLE_ENTITY
                    },
                    Json(view),
                )
                    .into_response(),
                Err(r) => r,
            };
        }
    };
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(e) => return crate::service_api::unavailable(e),
    };
    // 过期暂存不保留字节；没有后台作业，随下一次上传清空。
    if let Err(e) = sqlx::query(
        "update admission.skill_artifact_upload set artifact=null where expires_at<now() and artifact is not null",
    )
    .execute(&mut *tx)
    .await
    {
        return crate::service_api::unavailable(e);
    }
    let upload_id = Uuid::new_v4();
    let expires: Result<chrono::DateTime<chrono::Utc>, _> = sqlx::query_scalar(
        "insert into admission.skill_artifact_upload(id,tenant_id,session_id,principal_id,skill_resource_id,
         encoding,upload_digest,upload_byte_size,artifact,artifact_digest,artifact_byte_size,skill_name,
         description,short_description,expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now()+make_interval(secs=>$15::bigint))
         returning expires_at",
    )
    .bind(upload_id)
    .bind(ctx.tenant_id)
    .bind(ctx.session_id)
    .bind(ctx.tenant_principal_id)
    .bind(d.id)
    .bind(crate::governance::wire(&artifact.encoding))
    .bind(&artifact.upload_digest)
    .bind(i32::try_from(artifact.upload_byte_size).unwrap_or(i32::MAX))
    .bind(&artifact.bytes)
    .bind(&artifact.digest)
    .bind(i32::try_from(artifact.bytes.len()).unwrap_or(i32::MAX))
    .bind(&artifact.name)
    .bind(&artifact.description)
    .bind(&artifact.short_description)
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
    let view = json!({
        "accepted": true, "skillResourceId": d.id, "uploadDigest": artifact.upload_digest,
        "uploadByteSize": artifact.upload_byte_size, "encoding": artifact.encoding,
        "uploadId": upload_id, "artifactDigest": artifact.digest,
        "artifactByteSize": artifact.bytes.len(), "skillName": artifact.name,
        "description": artifact.description, "shortDescription": artifact.short_description,
        "expiresAt": expires.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        "violations": [],
    });
    match decode::<contracts::SkillArtifactUploadView>(view) {
        Ok(view) => Json(view).into_response(),
        Err(r) => r,
    }
}

/// DD-135(3)：`skill.version.create` 只接收本 PlatformSession 上传的暂存；会话或本人不符即不存在。
pub(crate) async fn check_session(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &contracts::ActionCommand,
) -> Result<(), Refusal> {
    let Some(input) = cmd.skill_version_upload.as_ref() else {
        return Err(Refusal::Precondition(
            contracts::ReasonCode::InvalidParameters,
        ));
    };
    let id = Uuid::parse_str(&input.upload_id)
        .map_err(|_| Refusal::Precondition(contracts::ReasonCode::InvalidParameters))?;
    let owned: bool = sqlx::query_scalar(
        "select exists(select 1 from admission.skill_artifact_upload
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
        Err(Refusal::Precondition(contracts::ReasonCode::TargetNotFound))
    }
}
