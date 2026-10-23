//! DD-135(1)(3)(4)(8)、05 §2.14、03 §7：Tenant 级 `skill.definition` Resource 与不可变
//! `skill.version` Asset 的受治理写入。
//!
//! 七个动作全部 SYNC、TENANT_ONLY、HUMAN-only、无审批与计量。创建定义与上传版本以同一
//! ActionExecution 为 SpiceDB 投影意图，写入并 FullyConsistent 复核后才 ACTIVE；发布、
//! 退役与停用只改 Core 事实，在准入事务内完成；目录分享沿 DD-131(6) 只写 `tenant#member`
//! 的 discoverer/reader。上传版本只消费本会话、本人、本定义的一次性上传，准入事务内
//! 重算 digest；artifact 与元数据创建即冻结（库触发器同样拒绝改写）。

use axum::http::StatusCode;
use contracts::{EvidenceKind, ReasonCode};
use serde_json::{json, Value};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use super::{
    audit, lock_execution, Definition, Execution, Governance, Params, Refusal, Semantic, Target,
};
use crate::skill_artifact;
use crate::spicedb::{Consistency, Relationship, RelationshipFilter, Write};

pub(crate) const TYPE_KEY: &str = "skill.definition";
pub(crate) const ASSET_TYPE_KEY: &str = "skill.version";
/// DD-135(4)：一个 AgentVersion 至多引用 16 个 Skill。
pub(crate) const MAX_AGENT_SKILLS: usize = 16;
const MAX_NAME_CHARS: usize = 200;
const MAX_REQUIREMENTS: usize = 32;

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}

fn unavailable(what: &str) -> Refusal {
    Refusal::Unavailable(format!("Skill {what}结果不明"))
}

impl Semantic {
    /// DD-135 的全部动作（05 §2.14）。
    pub(crate) fn is_skill(self) -> bool {
        matches!(
            self,
            Self::SkillDefinitionCreate
                | Self::SkillVersionCreate
                | Self::SkillVersionPublish
                | Self::SkillVersionRetire
                | Self::SkillDefinitionDisable
                | Self::SkillDefinitionShare
                | Self::SkillDefinitionUnshare
        )
    }
}

/// 05 §2.14 的 ActionDefinition 形状；目录漂移即 BLOCKED，不按别的形状执行。
fn expected(sem: Semantic) -> Option<(&'static str, &'static str, &'static str)> {
    Some(match sem {
        Semantic::SkillDefinitionCreate => ("RESOURCE", "create", "tenant"),
        Semantic::SkillVersionCreate => ("RESOURCE", "create", "resource"),
        Semantic::SkillVersionPublish | Semantic::SkillVersionRetire => {
            ("ASSET", "manage", "asset")
        }
        Semantic::SkillDefinitionDisable => ("RESOURCE", "manage", "resource"),
        Semantic::SkillDefinitionShare | Semantic::SkillDefinitionUnshare => {
            ("RESOURCE", "share", "resource")
        }
        _ => return None,
    })
}

fn check_definition(def: &Definition, sem: Semantic) -> Result<(), Refusal> {
    let (target, permission, object) =
        expected(sem).ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    if def.target_type != target
        || def.tenant_rule != "SESSION_TENANT"
        || def.workspace_rule != "TENANT_ONLY"
        || def.permission != permission
        || def.permission_object_type != object
        || def.execution_mode != "SYNC"
        || def.confirmation_mode != "EXPLICIT"
        || def.approval_policy_id.is_some()
        || def.workflow_kind.is_some()
        || def.quota_policy != "NONE"
        || !def.meters.is_empty()
        || def.result_exposure != "NONE"
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

pub(crate) fn valid_requirement(key: &str) -> bool {
    key.split_once('@').is_some_and(|(name, version)| {
        !name.is_empty()
            && !version.is_empty()
            && !key.chars().any(char::is_whitespace)
            && !version.contains('@')
    })
}

/// 规范化 `SkillVersionUploadInput`：上传 ID、小写 digest 与去重的能力需求。
pub(super) fn normalize_upload(
    input: &contracts::SkillVersionUploadInput,
) -> Result<Value, Refusal> {
    let id = Uuid::parse_str(&input.upload_id).map_err(|_| invalid())?;
    let digest = &input.artifact_digest;
    if id.is_nil()
        || digest.len() != 64
        || !digest
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || input.capability_requirements.len() > MAX_REQUIREMENTS
    {
        return Err(invalid());
    }
    let mut seen = std::collections::HashSet::new();
    for key in &input.capability_requirements {
        if !valid_requirement(key) || !seen.insert(key) {
            return Err(invalid());
        }
    }
    Ok(json!({"uploadId": id, "artifactDigest": digest,
        "capabilityRequirements": input.capability_requirements}))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UploadInput {
    pub upload_id: Uuid,
    pub digest: String,
    pub requirements: Vec<String>,
}

pub(crate) fn upload_input(p: &Params) -> Option<UploadInput> {
    let v = p.skill_version_upload.as_ref()?;
    Some(UploadInput {
        upload_id: Uuid::parse_str(v.get("uploadId")?.as_str()?).ok()?,
        digest: v.get("artifactDigest")?.as_str()?.to_owned(),
        requirements: v
            .get("capabilityRequirements")?
            .as_array()?
            .iter()
            .map(|k| k.as_str().map(str::to_owned))
            .collect::<Option<Vec<_>>>()?,
    })
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name == name.trim()
        && name.chars().count() <= MAX_NAME_CHARS
        && !name.chars().any(char::is_control)
}

/// 每个语义的参数是闭集：只保留该语义允许的字段后必须与原参数相等。
pub(super) fn validate_params(sem: Semantic, p: &Params) -> Result<(), Refusal> {
    let target = |p: &Params| {
        p.resource_id.is_some_and(|id| !id.is_nil()) && p.resource_version.is_some_and(|v| v > 0)
    };
    let allowed = match sem {
        Semantic::SkillDefinitionCreate => Params {
            slug: p.slug.clone(),
            name: p.name.clone(),
            explicit_confirmation: p.explicit_confirmation,
            ..Params::default()
        },
        Semantic::SkillVersionCreate => Params {
            resource_id: p.resource_id,
            resource_version: p.resource_version,
            skill_version_upload: p.skill_version_upload.clone(),
            explicit_confirmation: p.explicit_confirmation,
            ..Params::default()
        },
        Semantic::SkillVersionPublish | Semantic::SkillVersionRetire => Params {
            resource_id: p.resource_id,
            resource_version: p.resource_version,
            asset_id: p.asset_id,
            asset_version: p.asset_version,
            explicit_confirmation: p.explicit_confirmation,
            ..Params::default()
        },
        Semantic::SkillDefinitionDisable
        | Semantic::SkillDefinitionShare
        | Semantic::SkillDefinitionUnshare => Params {
            resource_id: p.resource_id,
            resource_version: p.resource_version,
            explicit_confirmation: p.explicit_confirmation,
            ..Params::default()
        },
        _ => return Err(invalid()),
    };
    let ok = *p == allowed
        && p.explicit_confirmation == Some(true)
        && match sem {
            Semantic::SkillDefinitionCreate => {
                p.slug.as_deref().is_some_and(skill_artifact::valid_slug)
                    && p.name.as_deref().is_some_and(valid_name)
            }
            Semantic::SkillVersionCreate => target(p) && upload_input(p).is_some(),
            Semantic::SkillVersionPublish | Semantic::SkillVersionRetire => {
                target(p)
                    && p.asset_id.is_some_and(|id| !id.is_nil())
                    && p.asset_version.is_some_and(|v| v > 0)
            }
            _ => target(p),
        };
    if ok {
        Ok(())
    } else {
        Err(invalid())
    }
}

// ---------------------------------------------------------------------------
// 事实
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow, Debug, Clone)]
pub(crate) struct SkillDefinition {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub owner_principal_id: Uuid,
    pub state: String,
    pub version: i32,
    pub projection_action_execution_id: Option<Uuid>,
    pub stable_slug: String,
    pub display_name: String,
    pub status: String,
    pub current_published_version_asset_id: Option<Uuid>,
}

impl SkillDefinition {
    /// Resource 已闭合投影且定义可被管理（ACTIVE）。
    pub(crate) fn usable(&self) -> bool {
        self.state == "ACTIVE"
            && self.status == "ACTIVE"
            && self.projection_action_execution_id.is_none()
    }
}

pub(crate) async fn definition(
    conn: &mut PgConnection,
    tenant: Uuid,
    id: Uuid,
    lock: bool,
) -> Result<Option<SkillDefinition>, sqlx::Error> {
    sqlx::query_as(&format!(
        "select r.id,r.tenant_id,r.owner_principal_id,r.state,r.version,r.projection_action_execution_id,
         d.stable_slug,d.display_name,d.status,d.current_published_version_asset_id
         from catalog.resource r join catalog.skill_definition d on d.resource_id=r.id and d.tenant_id=r.tenant_id
         where r.id=$1 and r.tenant_id=$2 and r.type_key='skill.definition' and r.home_workspace_id is null{}",
        if lock { " for update of r,d" } else { "" }
    ))
    .bind(id)
    .bind(tenant)
    .fetch_optional(conn)
    .await
}

#[derive(sqlx::FromRow, Debug, Clone)]
pub(crate) struct SkillVersion {
    pub asset_id: Uuid,
    pub tenant_id: Uuid,
    pub skill_resource_id: Uuid,
    pub owner_principal_id: Uuid,
    pub ordinal: i32,
    pub version: i32,
    pub asset_state: String,
    pub state: String,
    pub projection_action_execution_id: Option<Uuid>,
    pub skill_name: String,
    pub description: String,
    pub short_description: Option<String>,
    pub artifact_format: String,
    pub artifact_digest: String,
    pub artifact_byte_size: i32,
    pub metadata_hash: String,
    pub capability_requirements: Vec<String>,
    pub upload_digest: String,
}

pub(crate) const VERSION_COLUMNS: &str =
    "v.asset_id,v.tenant_id,v.skill_resource_id,a.owner_principal_id,v.ordinal,a.version,
     a.state as asset_state,v.state,a.projection_action_execution_id,v.skill_name,v.description,
     v.short_description,v.artifact_format,v.artifact_digest,v.artifact_byte_size,v.metadata_hash,
     v.capability_requirements,v.upload_digest";

/// DD-135(8)：Skill 版本动作的审计证据——slug、版本 Asset 与序号、artifact digest 与字节数；
/// 创建另记上传 digest。只放平台自有的稳定标识与摘要，不含 `SKILL.md` 正文。
pub(crate) fn version_evidence(
    slug: &str,
    asset_id: Uuid,
    ordinal: i32,
    artifact_digest: &str,
    artifact_byte_size: i32,
    upload_digest: Option<&str>,
) -> Vec<crate::audit::Evidence> {
    let mut evidence = vec![
        crate::audit::Evidence::new(EvidenceKind::SkillSlug, slug),
        crate::audit::Evidence::versioned(
            EvidenceKind::SkillVersionAssetId,
            asset_id,
            i64::from(ordinal),
        ),
        crate::audit::Evidence::versioned(
            EvidenceKind::SkillArtifactDigest,
            artifact_digest,
            i64::from(artifact_byte_size),
        ),
    ];
    if let Some(upload) = upload_digest {
        evidence.push(crate::audit::Evidence::new(
            EvidenceKind::SkillUploadDigest,
            upload,
        ));
    }
    evidence
}

pub(crate) async fn version(
    conn: &mut PgConnection,
    tenant: Uuid,
    id: Uuid,
    lock: bool,
) -> Result<Option<SkillVersion>, sqlx::Error> {
    sqlx::query_as(&format!(
        "select {VERSION_COLUMNS} from catalog.skill_version v
         join catalog.asset a on a.id=v.asset_id and a.tenant_id=v.tenant_id
         where v.tenant_id=$1 and v.asset_id=$2 and a.type_key='skill.version'{}",
        if lock { " for update of a,v" } else { "" }
    ))
    .bind(tenant)
    .bind(id)
    .fetch_optional(conn)
    .await
}

/// 版本 Asset 投影与父定义一致。
pub(crate) async fn version_projection_matches(
    g: &Governance,
    v: &SkillVersion,
) -> Result<bool, Refusal> {
    g.spicedb
        .asset_projection_matches(
            &v.asset_id.to_string(),
            &v.tenant_id.to_string(),
            &v.skill_resource_id.to_string(),
            &v.owner_principal_id.to_string(),
            g.cfg.relationship_page,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()))
}

/// 定义的 tenant/owner 投影闭合时返回是否已分享到目录；不一致或不可核验为 `None`。
pub(crate) async fn definition_projection(
    g: &Governance,
    d: &SkillDefinition,
) -> Result<Option<bool>, Refusal> {
    g.spicedb
        .catalog_projection(
            &d.id.to_string(),
            &d.tenant_id.to_string(),
            &d.owner_principal_id.to_string(),
            g.cfg.relationship_page,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()))
}

#[derive(sqlx::FromRow)]
struct Upload {
    tenant_id: Uuid,
    principal_id: Uuid,
    skill_resource_id: Uuid,
    artifact: Option<Vec<u8>>,
    artifact_digest: String,
    artifact_byte_size: i32,
    skill_name: String,
    description: String,
    short_description: Option<String>,
    upload_digest: String,
    expired: bool,
    consumed_by_action_execution_id: Option<Uuid>,
}

/// DD-135(3)、V-SCN-211：准入目标解析对暂存上传的判定。他人、跨 Tenant、跨定义的上传按不存在
/// 拒绝；本人本定义的上传存在而 digest 或名称不符是参数错误（`INVALID_PARAMETERS`）。
fn staged_target(
    staged: Option<&Upload>,
    tenant: Uuid,
    initiator: Uuid,
    definition: Uuid,
    slug: &str,
    digest: &str,
) -> Result<(), Refusal> {
    let staged = staged
        .filter(|u| {
            u.tenant_id == tenant
                && u.principal_id == initiator
                && u.skill_resource_id == definition
        })
        .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    if staged.artifact_digest != digest || staged.skill_name != slug {
        return Err(invalid());
    }
    Ok(())
}

async fn upload(
    conn: &mut PgConnection,
    id: Uuid,
    lock: bool,
) -> Result<Option<Upload>, sqlx::Error> {
    sqlx::query_as(&format!(
        "select tenant_id,principal_id,skill_resource_id,artifact,artifact_digest,artifact_byte_size,
         skill_name,description,short_description,upload_digest,expires_at<=now() as expired,
         consumed_by_action_execution_id from admission.skill_artifact_upload where id=$1{}",
        if lock { " for update" } else { "" }
    ))
    .bind(id)
    .fetch_optional(conn)
    .await
}

// ---------------------------------------------------------------------------
// 准入
// ---------------------------------------------------------------------------

/// `resolve_target` 中 DD-135 动作的分支。
#[allow(clippy::too_many_arguments)]
pub(super) async fn target(
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    def: &Definition,
    sem: Semantic,
    p: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    check_definition(def, sem)?;
    if lock && !crate::agent_definition::active_owner(conn, tenant, initiator).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    if sem == Semantic::SkillDefinitionCreate {
        let slug = p.slug.as_deref().ok_or_else(invalid)?;
        let taken: bool = sqlx::query_scalar(
            "select exists(select 1 from catalog.skill_definition
             where tenant_id=$1 and stable_slug=$2 and status<>'DELETED'
               and resource_id is distinct from $3)",
        )
        .bind(tenant)
        .bind(slug)
        .bind(frozen)
        .fetch_one(&mut *conn)
        .await?;
        if taken {
            return Err(conflict());
        }
        return Ok(Target {
            id: frozen.unwrap_or_else(Uuid::new_v4),
            version: 0,
            workspace_id: None,
        });
    }
    let id = p.resource_id.ok_or_else(invalid)?;
    let d = definition(conn, tenant, id, lock)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    // 停用后只允许退役版本与取消分享；其余动作要求定义 ACTIVE。
    let status_ok = match sem {
        Semantic::SkillVersionRetire | Semantic::SkillDefinitionUnshare => {
            matches!(d.status.as_str(), "ACTIVE" | "DISABLED")
        }
        _ => d.status == "ACTIVE",
    };
    if d.state != "ACTIVE"
        || d.projection_action_execution_id.is_some()
        || !status_ok
        || p.resource_version != Some(d.version)
    {
        return Err(conflict());
    }
    match sem {
        Semantic::SkillVersionPublish | Semantic::SkillVersionRetire => {
            let asset = p.asset_id.ok_or_else(invalid)?;
            let want = if sem == Semantic::SkillVersionPublish {
                "DRAFT"
            } else {
                "PUBLISHED"
            };
            let v = version(conn, tenant, asset, lock)
                .await?
                .filter(|v| {
                    v.skill_resource_id == d.id
                        && v.state == want
                        && v.asset_state == want
                        && v.projection_action_execution_id.is_none()
                        && p.asset_version == Some(v.version)
                        && frozen.is_none_or(|f| f == v.asset_id)
                })
                .ok_or_else(conflict)?;
            Ok(Target {
                id: v.asset_id,
                version: v.version,
                workspace_id: None,
            })
        }
        _ => {
            if frozen.is_some_and(|f| f != d.id) {
                return Err(conflict());
            }
            if sem == Semantic::SkillVersionCreate {
                let input = upload_input(p).ok_or_else(invalid)?;
                let staged = upload(conn, input.upload_id, false).await?;
                staged_target(
                    staged.as_ref(),
                    tenant,
                    initiator,
                    d.id,
                    &d.stable_slug,
                    &input.digest,
                )?;
            }
            Ok(Target {
                id: d.id,
                version: d.version,
                workspace_id: None,
            })
        }
    }
}

/// `evaluate` 中 skill.definition 目标的投影核对：tenant/owner 闭合，容许目录授予。
pub(super) async fn evaluate_definition(
    g: &Governance,
    tenant: Uuid,
    target: &Target,
) -> Result<bool, Refusal> {
    let mut conn = g.pool.acquire().await?;
    let Some(d) = definition(&mut conn, tenant, target.id, false).await? else {
        return Ok(false);
    };
    if d.state != "ACTIVE"
        || d.projection_action_execution_id.is_some()
        || d.version != target.version
        || target.workspace_id.is_some()
    {
        return Ok(false);
    }
    Ok(definition_projection(g, &d).await?.is_some())
}

/// `evaluate` 中 skill.version 目标的投影核对：父定义与版本 Asset 投影均闭合。
pub(super) async fn evaluate_version(
    g: &Governance,
    tenant: Uuid,
    target: &Target,
) -> Result<bool, Refusal> {
    let mut conn = g.pool.acquire().await?;
    let Some(v) = version(&mut conn, tenant, target.id, false).await? else {
        return Ok(false);
    };
    if v.version != target.version
        || v.projection_action_execution_id.is_some()
        || !matches!(v.asset_state.as_str(), "DRAFT" | "PUBLISHED" | "RETIRED")
    {
        return Ok(false);
    }
    let Some(d) = definition(&mut conn, tenant, v.skill_resource_id, false).await? else {
        return Ok(false);
    };
    if d.state != "ACTIVE" || d.projection_action_execution_id.is_some() {
        return Ok(false);
    }
    Ok(definition_projection(g, &d).await?.is_some() && version_projection_matches(g, &v).await?)
}

/// 准入门禁：只接受 HUMAN 发起（Agent 不得经委托代管 Skill）。
pub(super) async fn gate(
    _g: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    _sem: Semantic,
    _p: &Params,
) -> Result<(), Refusal> {
    if !crate::agent_definition::active_owner(conn, tenant, initiator).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 准入事务内的写入
// ---------------------------------------------------------------------------

/// SYNC 动作在准入事务内的预写。返回随结果写入审计的证据（artifact digest）。
pub(super) async fn prewrite(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    sem: Semantic,
    p: &Params,
) -> Result<Vec<crate::audit::Evidence>, Refusal> {
    if !crate::agent_definition::active_owner(tx, ae.tenant_id, ae.initiator_principal_id).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    match sem {
        Semantic::SkillDefinitionCreate => {
            let registered: Option<String> = sqlx::query_scalar(
                "select type_key from catalog.resource_type_definition where type_key=$1 and status='ACTIVE'
                 and capability_category is null and tenant_delete_action_key='tenant.delete'",
            )
            .bind(TYPE_KEY)
            .fetch_optional(&mut **tx)
            .await?;
            if registered.is_none() {
                return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
            }
            let slug = p.slug.as_deref().ok_or_else(invalid)?;
            let name = p.name.as_deref().ok_or_else(invalid)?;
            sqlx::query("insert into catalog.resource
                (id,tenant_id,type_key,owner_principal_id,component_type_key,native_type,native_id,state,version,projection_action_execution_id)
                values ($1,$2,$3,$4,$5,$3,$1::text,'PROVISIONING',1,$6)")
                .bind(ae.target_id).bind(ae.tenant_id).bind(TYPE_KEY).bind(ae.initiator_principal_id)
                .bind(&def.component_type_key).bind(ae.id).execute(&mut **tx).await?;
            sqlx::query(
                "insert into catalog.skill_definition(resource_id,tenant_id,stable_slug,display_name,status)
                 values ($1,$2,$3,$4,'PROVISIONING')",
            )
            .bind(ae.target_id)
            .bind(ae.tenant_id)
            .bind(slug)
            .bind(name)
            .execute(&mut **tx)
            .await?;
            Ok(Vec::new())
        }
        Semantic::SkillVersionCreate => {
            let d = definition(tx, ae.tenant_id, ae.target_id, true)
                .await?
                .filter(SkillDefinition::usable)
                .ok_or_else(conflict)?;
            let input = upload_input(p).ok_or_else(invalid)?;
            let staged = upload(tx, input.upload_id, true)
                .await?
                .filter(|u| {
                    u.tenant_id == ae.tenant_id
                        && u.principal_id == ae.initiator_principal_id
                        && u.skill_resource_id == d.id
                        && !u.expired
                        && u.consumed_by_action_execution_id.is_none()
                })
                .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
            let bytes = staged
                .artifact
                .as_deref()
                .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
            // 准入事务内重算：暂存行与命令中的 digest 都必须等于实际字节。
            if staged.artifact_digest != input.digest
                || skill_artifact::sha256_hex(bytes) != input.digest
                || usize::try_from(staged.artifact_byte_size).ok() != Some(bytes.len())
                || staged.skill_name != d.stable_slug
            {
                return Err(invalid());
            }
            let metadata_hash = skill_artifact::metadata_hash(
                &staged.skill_name,
                &staged.description,
                staged.short_description.as_deref(),
                &input.requirements,
            );
            let ordinal: i32 = sqlx::query_scalar(
                "select coalesce(max(ordinal),0)+1 from catalog.skill_version where skill_resource_id=$1",
            )
            .bind(d.id)
            .fetch_one(&mut **tx)
            .await?;
            sqlx::query("insert into catalog.asset
                (id,tenant_id,resource_id,type_key,owner_principal_id,producer_principal_id,native_ref,state,version,projection_action_execution_id)
                values ($1,$2,$3,$4,$5,$5,$1::text,'DRAFT',1,$1)")
                .bind(ae.id).bind(ae.tenant_id).bind(d.id).bind(ASSET_TYPE_KEY)
                .bind(ae.initiator_principal_id).execute(&mut **tx).await?;
            sqlx::query(
                "insert into catalog.skill_version(asset_id,tenant_id,skill_resource_id,ordinal,skill_name,
                 description,short_description,artifact_format,artifact,artifact_digest,artifact_byte_size,
                 metadata_hash,capability_requirements,upload_digest,state)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'DRAFT')",
            )
            .bind(ae.id)
            .bind(ae.tenant_id)
            .bind(d.id)
            .bind(ordinal)
            .bind(&staged.skill_name)
            .bind(&staged.description)
            .bind(&staged.short_description)
            .bind(skill_artifact::FORMAT)
            .bind(bytes)
            .bind(&input.digest)
            .bind(staged.artifact_byte_size)
            .bind(&metadata_hash)
            .bind(&input.requirements)
            .bind(&staged.upload_digest)
            .execute(&mut **tx)
            .await?;
            let consumed = sqlx::query(
                "update admission.skill_artifact_upload set consumed_by_action_execution_id=$2,artifact=null
                 where id=$1 and consumed_by_action_execution_id is null",
            )
            .bind(input.upload_id)
            .bind(ae.id)
            .execute(&mut **tx)
            .await?;
            if consumed.rows_affected() != 1 {
                return Err(conflict());
            }
            Ok(version_evidence(
                &staged.skill_name,
                ae.id,
                ordinal,
                &input.digest,
                staged.artifact_byte_size,
                Some(&staged.upload_digest),
            ))
        }
        Semantic::SkillVersionPublish | Semantic::SkillVersionRetire => {
            let publish = sem == Semantic::SkillVersionPublish;
            let d = definition(tx, ae.tenant_id, p.resource_id.ok_or_else(invalid)?, true)
                .await?
                .filter(|d| {
                    d.state == "ACTIVE"
                        && d.projection_action_execution_id.is_none()
                        && (d.status == "ACTIVE" || (!publish && d.status == "DISABLED"))
                })
                .ok_or_else(conflict)?;
            let want = if publish { "DRAFT" } else { "PUBLISHED" };
            let v = version(tx, ae.tenant_id, ae.target_id, true)
                .await?
                .filter(|v| {
                    v.skill_resource_id == d.id
                        && v.state == want
                        && v.asset_state == want
                        && v.projection_action_execution_id.is_none()
                        && p.asset_version == Some(v.version)
                })
                .ok_or_else(conflict)?;
            if !version_projection_matches(g, &v).await? {
                return Err(Refusal::Unavailable("Skill 版本 Asset 投影不一致".into()));
            }
            let next = if publish { "PUBLISHED" } else { "RETIRED" };
            let changed = sqlx::query(
                "update catalog.skill_version set state=$2 where asset_id=$1 and state=$3",
            )
            .bind(v.asset_id)
            .bind(next)
            .bind(want)
            .execute(&mut **tx)
            .await?;
            let asset = sqlx::query(
                "update catalog.asset set state=$2,version=version+1 where id=$1 and version=$3 and state=$4",
            )
            .bind(v.asset_id)
            .bind(next)
            .bind(v.version)
            .bind(want)
            .execute(&mut **tx)
            .await?;
            if changed.rows_affected() != 1 || asset.rows_affected() != 1 {
                return Err(conflict());
            }
            let pointer = if publish {
                sqlx::query(
                    "update catalog.skill_definition set current_published_version_asset_id=$2 where resource_id=$1",
                )
                .bind(d.id)
                .bind(v.asset_id)
                .execute(&mut **tx)
                .await?
            } else {
                sqlx::query(
                    "update catalog.skill_definition set current_published_version_asset_id=null
                     where resource_id=$1 and current_published_version_asset_id=$2",
                )
                .bind(d.id)
                .bind(v.asset_id)
                .execute(&mut **tx)
                .await?
            };
            if pointer.rows_affected() == 1 {
                sqlx::query(
                    "update catalog.resource set version=version+1 where id=$1 and tenant_id=$2",
                )
                .bind(d.id)
                .bind(ae.tenant_id)
                .execute(&mut **tx)
                .await?;
            }
            Ok(version_evidence(
                &v.skill_name,
                v.asset_id,
                v.ordinal,
                &v.artifact_digest,
                v.artifact_byte_size,
                None,
            ))
        }
        Semantic::SkillDefinitionDisable => {
            let slug: Option<String> = sqlx::query_scalar(
                "update catalog.skill_definition set status='DISABLED' where resource_id=$1 and status='ACTIVE'
                 returning stable_slug",
            )
            .bind(ae.target_id)
            .fetch_optional(&mut **tx)
            .await?;
            let bumped = sqlx::query(
                "update catalog.resource set version=version+1 where id=$1 and tenant_id=$2 and version=$3",
            )
            .bind(ae.target_id)
            .bind(ae.tenant_id)
            .bind(ae.frozen_target_version())
            .execute(&mut **tx)
            .await?;
            let Some(slug) = slug else {
                return Err(conflict());
            };
            if bumped.rows_affected() != 1 {
                return Err(conflict());
            }
            Ok(vec![crate::audit::Evidence::new(
                EvidenceKind::SkillSlug,
                slug,
            )])
        }
        Semantic::SkillDefinitionShare | Semantic::SkillDefinitionUnshare => Ok(Vec::new()),
        _ => Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)),
    }
}

// ---------------------------------------------------------------------------
// 派发
// ---------------------------------------------------------------------------

async fn tenant_active(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query_scalar::<_, bool>(
        "select state='ACTIVE' from identity.tenant where id=$1 for update",
    )
    .bind(tenant)
    .fetch_optional(&mut **tx)
    .await?
    .unwrap_or(false))
}

async fn record_unknown(
    mut tx: Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
) -> Result<(), Refusal> {
    super::record_dispatch(
        &mut tx,
        ae.id,
        def.audit_class(),
        Err(StatusCode::SERVICE_UNAVAILABLE),
        Vec::new(),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// `skill.definition.create` 的投影：tenant/owner 投影写入并查证后 Resource 才 ACTIVE；
/// 确定拒绝先原生删除投影再中止，结果不明保持 UNKNOWN。
pub(super) async fn dispatch_create(
    g: &Governance,
    id: Uuid,
    def: &Definition,
) -> Result<(), Refusal> {
    let mut tx = g.pool.begin().await?;
    let ae = lock_execution(&mut tx, id).await?;
    if ae.gate_state != "ALLOWED"
        || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
    {
        return Ok(());
    }
    let active = tenant_active(&mut tx, ae.tenant_id).await?;
    let d = definition(&mut tx, ae.tenant_id, ae.target_id, true)
        .await?
        .filter(|d| d.projection_action_execution_id == Some(ae.id))
        .ok_or_else(conflict)?;
    let owner = d.owner_principal_id;
    if !(active && crate::agent_definition::active_owner(&mut tx, ae.tenant_id, owner).await?) {
        return abort_create(g, tx, &ae, def, &d).await;
    }
    let matched = match definition_projection(g, &d).await {
        Ok(observed) => observed.is_some(),
        Err(_) => return record_unknown(tx, &ae, def).await,
    };
    if !matched {
        let allowed = match g
            .spicedb
            .check(
                "tenant",
                &ae.tenant_id.to_string(),
                "create",
                &ae.initiator_principal_id.to_string(),
                Consistency::FullyConsistent,
            )
            .await
        {
            Ok(c) => c.allowed,
            Err(_) => return record_unknown(tx, &ae, def).await,
        };
        if !allowed {
            return abort_create(g, tx, &ae, def, &d).await;
        }
        match g
            .spicedb
            .replace_resource_projection(
                &d.id.to_string(),
                &d.tenant_id.to_string(),
                &owner.to_string(),
                &owner.to_string(),
                None,
            )
            .await
        {
            Ok(token) if !token.is_empty() => {}
            _ => return record_unknown(tx, &ae, def).await,
        }
        if !matches!(definition_projection(g, &d).await, Ok(Some(_))) {
            return record_unknown(tx, &ae, def).await;
        }
    }
    let proof = match g
        .spicedb
        .check(
            "resource",
            &d.id.to_string(),
            "read",
            &owner.to_string(),
            Consistency::FullyConsistent,
        )
        .await
    {
        Ok(proof) if proof.allowed && !proof.zed_token.is_empty() => proof,
        _ => return record_unknown(tx, &ae, def).await,
    };
    let changed = sqlx::query(
        "update catalog.resource set state='ACTIVE',version=version+1,projection_action_execution_id=null
         where id=$1 and tenant_id=$2 and projection_action_execution_id=$3",
    )
    .bind(d.id)
    .bind(d.tenant_id)
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(conflict());
    }
    sqlx::query("update catalog.skill_definition set status='ACTIVE' where resource_id=$1 and status='PROVISIONING'")
        .bind(d.id)
        .execute(&mut *tx)
        .await?;
    let evidence = vec![
        crate::audit::Evidence::new(EvidenceKind::SpicedbZedtoken, &proof.zed_token),
        crate::audit::Evidence::new(
            EvidenceKind::SpicedbRelationship,
            format!("resource:{}#owner@principal:{owner}", d.id),
        ),
        crate::audit::Evidence::new(EvidenceKind::SkillSlug, &d.stable_slug),
    ];
    let recorded =
        super::record_dispatch(&mut tx, ae.id, def.audit_class(), Ok(()), evidence.clone()).await?;
    if recorded.settled {
        audit(
            &mut tx,
            &ae,
            def,
            "outcome",
            "OUTCOME",
            "ALLOW",
            "SKILL_DEFINITION_CREATED",
            None,
            evidence,
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

async fn abort_create(
    g: &Governance,
    mut tx: Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    d: &SkillDefinition,
) -> Result<(), Refusal> {
    // 可能已写入的投影先原生删除并以空集合查证，再中止；不把未知写当作从未发生。
    match g.spicedb.delete_resource_projection(d.id).await {
        Ok(token) if !token.is_empty() => {
            sqlx::query(
                "update catalog.resource set state='DELETED',projection_action_execution_id=null,version=version+1
                 where id=$1 and tenant_id=$2",
            )
            .bind(d.id)
            .bind(d.tenant_id)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "update catalog.skill_definition set status='DELETED' where resource_id=$1",
            )
            .bind(d.id)
            .execute(&mut *tx)
            .await?;
            super::record_dispatch(
                &mut tx,
                ae.id,
                def.audit_class(),
                Err(StatusCode::FORBIDDEN),
                vec![crate::audit::Evidence::new(
                    EvidenceKind::SpicedbZedtoken,
                    token,
                )],
            )
            .await?;
            tx.commit().await?;
            Ok(())
        }
        _ => record_unknown(tx, ae, def).await,
    }
}

/// `skill.version.create` 的 Asset 投影：与 AgentVersion 同一模式（父 Resource create 复核、
/// 写 asset tenant/resource/owner、FullyConsistent 回读），确定拒绝删除投影并把 Asset 置 DELETED。
pub(super) async fn dispatch_version(
    g: &Governance,
    id: Uuid,
    def: &Definition,
) -> Result<(), Refusal> {
    let mut tx = g.pool.begin().await?;
    let ae = lock_execution(&mut tx, id).await?;
    if ae.gate_state != "ALLOWED"
        || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
    {
        return Ok(());
    }
    let active = tenant_active(&mut tx, ae.tenant_id).await?;
    let v = version(&mut tx, ae.tenant_id, ae.id, true)
        .await?
        .filter(|v| v.projection_action_execution_id == Some(ae.id))
        .ok_or_else(conflict)?;
    let parent = definition(&mut tx, ae.tenant_id, v.skill_resource_id, true).await?;
    let parent_ok = match parent.as_ref() {
        Some(d) if d.usable() => {
            crate::agent_definition::active_owner(&mut tx, ae.tenant_id, d.owner_principal_id)
                .await?
        }
        _ => false,
    };
    let valid = active
        && parent_ok
        && crate::agent_definition::active_owner(&mut tx, ae.tenant_id, v.owner_principal_id)
            .await?;
    let result = if !valid {
        g.spicedb
            .delete_asset_projection(v.asset_id)
            .await
            .map(|t| (false, t))
    } else {
        let d = parent.as_ref().ok_or_else(conflict)?;
        if !matches!(definition_projection(g, d).await, Ok(Some(_))) {
            return record_unknown(tx, &ae, def).await;
        }
        match version_projection_matches(g, &v).await {
            Err(_) => return record_unknown(tx, &ae, def).await,
            Ok(true) => observed(g, &v).await.map(|t| (true, t)),
            Ok(false) => {
                match g
                    .spicedb
                    .check(
                        "resource",
                        &v.skill_resource_id.to_string(),
                        "create",
                        &ae.initiator_principal_id.to_string(),
                        Consistency::FullyConsistent,
                    )
                    .await
                {
                    Err(_) => return record_unknown(tx, &ae, def).await,
                    Ok(c) if !c.allowed => g
                        .spicedb
                        .delete_asset_projection(v.asset_id)
                        .await
                        .map(|t| (false, t)),
                    Ok(_) => {
                        if g.spicedb
                            .write_asset_projection(
                                &v.asset_id.to_string(),
                                &v.tenant_id.to_string(),
                                &v.skill_resource_id.to_string(),
                                &v.owner_principal_id.to_string(),
                            )
                            .await
                            .is_err()
                        {
                            return record_unknown(tx, &ae, def).await;
                        }
                        match version_projection_matches(g, &v).await {
                            Ok(true) => observed(g, &v).await.map(|t| (true, t)),
                            _ => return record_unknown(tx, &ae, def).await,
                        }
                    }
                }
            }
        }
    };
    let (created, token) = match result {
        Ok((created, token)) if !token.is_empty() => (created, token),
        _ => return record_unknown(tx, &ae, def).await,
    };
    sqlx::query(
        "update catalog.asset set projection_action_execution_id=null,
         state=case when $2 then state else 'DELETED' end,version=version+1 where id=$1",
    )
    .bind(v.asset_id)
    .bind(created)
    .execute(&mut *tx)
    .await?;
    let mut evidence = vec![crate::audit::Evidence::new(
        EvidenceKind::SpicedbZedtoken,
        token,
    )];
    if created {
        evidence.extend(version_evidence(
            &v.skill_name,
            v.asset_id,
            v.ordinal,
            &v.artifact_digest,
            v.artifact_byte_size,
            Some(&v.upload_digest),
        ));
    }
    let recorded = super::record_dispatch(
        &mut tx,
        ae.id,
        def.audit_class(),
        if created {
            Ok(())
        } else {
            Err(StatusCode::FORBIDDEN)
        },
        evidence.clone(),
    )
    .await?;
    if recorded.settled && created {
        audit(
            &mut tx,
            &ae,
            def,
            "outcome",
            "OUTCOME",
            "ALLOW",
            "SKILL_VERSION_CREATED",
            None,
            evidence,
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

async fn observed(
    g: &Governance,
    v: &SkillVersion,
) -> Result<String, crate::spicedb::SpiceDbError> {
    g.spicedb
        .check(
            "asset",
            &v.asset_id.to_string(),
            "read",
            &v.owner_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .and_then(|c| {
            if c.allowed && !c.zed_token.is_empty() {
                Ok(c.zed_token)
            } else {
                Err(crate::spicedb::SpiceDbError::Unavailable(
                    "Skill 版本 owner 查证不一致".into(),
                ))
            }
        })
}

/// 目录分享与取消分享：先持久化 UNKNOWN 意图再写 SpiceDB，写后读回复核；结果不明保持
/// UNKNOWN，由对账以同一冻结意图幂等重写并查证（DD-131(6) 同一模式）。
pub(super) async fn dispatch_grants(
    g: &Governance,
    id: Uuid,
    def: &Definition,
    sem: Semantic,
) -> Result<(), Refusal> {
    let mut tx = g.pool.begin().await?;
    let ae = lock_execution(&mut tx, id).await?;
    if ae.gate_state != "ALLOWED"
        || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
    {
        return Ok(());
    }
    let first = ae.dispatch_state == "NOT_DISPATCHED";
    if first {
        sqlx::query("update admission.action_execution set dispatch_state='UNKNOWN',updated_at=now() where id=$1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        audit(
            &mut tx,
            &ae,
            def,
            "skill-share-intent",
            "DISPATCH",
            "ALLOW",
            "DISPATCH_RESULT_UNKNOWN",
            None,
            Vec::new(),
        )
        .await?;
    }
    tx.commit().await?;
    let mut tx = g.pool.begin().await?;
    let ae = lock_execution(&mut tx, id).await?;
    if ae.gate_state != "ALLOWED" || ae.dispatch_state != "UNKNOWN" {
        return Ok(());
    }
    if !crate::roles::lock_tenant(&mut tx, ae.tenant_id).await? {
        return Err(conflict());
    }
    let active = tenant_active(&mut tx, ae.tenant_id).await?;
    let grant = sem == Semantic::SkillDefinitionShare;
    let expected = ae.frozen_target_version().ok_or_else(conflict)?;
    let current = definition(&mut tx, ae.tenant_id, ae.target_id, true)
        .await?
        .filter(|d| {
            d.state == "ACTIVE"
                && d.version == expected
                && d.projection_action_execution_id.is_none()
                && (d.status == "ACTIVE" || (!grant && d.status == "DISABLED"))
        });
    let fresh = match current {
        Some(_) if active && first && grant => {
            let scoped = crate::agent_definition::active_owner(
                &mut tx,
                ae.tenant_id,
                ae.initiator_principal_id,
            )
            .await?;
            let checked = g
                .spicedb
                .check(
                    "resource",
                    &ae.target_id.to_string(),
                    "share",
                    &ae.initiator_principal_id.to_string(),
                    Consistency::FullyConsistent,
                )
                .await
                .map_err(|e| Refusal::Unavailable(e.to_string()))?;
            scoped && checked.allowed
        }
        Some(_) => active || !grant,
        None => false,
    };
    if !fresh {
        if first {
            // 确定未写入：同一 record_dispatch 记 ABORTED（TARGET_STATE_CONFLICT）与 DISPATCH 审计。
            super::record_dispatch(
                &mut tx,
                ae.id,
                def.audit_class(),
                Err(StatusCode::CONFLICT),
                Vec::new(),
            )
            .await?;
            audit(
                &mut tx,
                &ae,
                def,
                "skill-share-outcome",
                "OUTCOME",
                "DENY",
                "NOT_APPLIED",
                None,
                Vec::new(),
            )
            .await?;
            tx.commit().await?;
            return Ok(());
        }
        tx.commit().await?;
        return Err(conflict());
    }
    let grants =
        Relationship::catalog_share_grants(&ae.target_id.to_string(), &ae.tenant_id.to_string());
    let writes: Vec<_> = grants
        .iter()
        .map(|r| (if grant { Write::Touch } else { Write::Delete }, r.clone()))
        .collect();
    let token = match g.spicedb.write(&writes).await {
        Ok(token) if !token.is_empty() => token,
        _ => {
            tx.commit().await?;
            return Err(unavailable("目录分享"));
        }
    };
    let mut matched = true;
    for relationship in &grants {
        let held = g
            .spicedb
            .read(
                &RelationshipFilter {
                    object_type: "resource",
                    object_id: Some(&relationship.object_id),
                    relation: Some(&relationship.relation),
                    subject_principal: None,
                },
                g.cfg.relationship_page,
            )
            .await
            .map_err(|e| Refusal::Unavailable(e.to_string()))?
            .contains(relationship);
        matched &= held == grant;
    }
    if !matched {
        audit(
            &mut tx,
            &ae,
            def,
            "skill-share-prior-unknown",
            "RECONCILIATION",
            "NONE",
            "DISPATCH_RESULT_UNKNOWN",
            None,
            Vec::new(),
        )
        .await?;
        tx.commit().await?;
        return Err(unavailable("目录分享"));
    }
    let mut evidence = vec![crate::audit::Evidence::new(
        EvidenceKind::SpicedbZedtoken,
        &token,
    )];
    evidence.extend(
        grants
            .iter()
            .map(|r| crate::audit::Evidence::new(EvidenceKind::SpicedbRelationship, r)),
    );
    // 写前意图把 DISPATCH 记为结果不明；原生写入经回读确认后以同一 record_dispatch 把
    // dispatch_state 推进为 DISPATCHED 并追加 DISPATCH 审计，审计终态与 ActionExecution 一致。
    let recorded =
        super::record_dispatch(&mut tx, ae.id, def.audit_class(), Ok(()), evidence.clone()).await?;
    if recorded.settled {
        audit(
            &mut tx,
            &ae,
            def,
            "skill-share-outcome",
            "OUTCOME",
            "ALLOW",
            if grant {
                "CATALOG_SHARED"
            } else {
                "CATALOG_UNSHARED"
            },
            None,
            evidence,
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// AgentVersion 引用（DD-135(4)）
// ---------------------------------------------------------------------------

/// AgentVersion 草稿创建、编辑与发布时的 Skill 引用校验：作者 fresh 持有每个被引定义的
/// Resource `read`，被引版本 `PUBLISHED`、定义 `ACTIVE`，同一定义至多一个版本，至多 16 个，
/// 且 Skill 的能力需求包含在本版本的能力需求中。引用只声明 requested，不授予任何权限。
pub(crate) async fn validate_agent_references(
    g: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    human: Uuid,
    content: &contracts::AgentVersionContent,
) -> Result<(), Refusal> {
    if content.skill_version_asset_ids.len() > MAX_AGENT_SKILLS {
        return Err(invalid());
    }
    let mut definitions = std::collections::HashSet::new();
    for id in &content.skill_version_asset_ids {
        let id = Uuid::parse_str(id).map_err(|_| invalid())?;
        let v = version(conn, tenant, id, false)
            .await?
            .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
        if !definitions.insert(v.skill_resource_id) {
            return Err(invalid());
        }
        let d = definition(conn, tenant, v.skill_resource_id, false)
            .await?
            .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
        if !d.usable()
            || v.state != "PUBLISHED"
            || v.asset_state != "PUBLISHED"
            || v.projection_action_execution_id.is_some()
        {
            return Err(conflict());
        }
        if v.capability_requirements
            .iter()
            .any(|key| !content.capability_requirements.contains(key))
        {
            return Err(invalid());
        }
        let checked = g
            .spicedb
            .check(
                "resource",
                &d.id.to_string(),
                "read",
                &human.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|e| Refusal::Unavailable(e.to_string()))?;
        if !checked.allowed {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn upload_command(requirements: &[&str]) -> contracts::SkillVersionUploadInput {
        contracts::SkillVersionUploadInput {
            upload_id: Uuid::new_v4().to_string(),
            artifact_digest: "a".repeat(64),
            capability_requirements: requirements.iter().map(|s| (*s).to_owned()).collect(),
        }
    }

    #[test]
    fn upload_input_is_normalized_and_closed() {
        let ok = normalize_upload(&upload_command(&["knowledge.search@v1"])).unwrap();
        assert_eq!(ok["capabilityRequirements"], json!(["knowledge.search@v1"]));
        for bad in [&["x"][..], &["a@v1", "a@v1"], &["a @v1"], &["@v1"], &["a@"]] {
            assert!(normalize_upload(&upload_command(bad)).is_err(), "{bad:?}");
        }
        let mut upper = upload_command(&[]);
        upper.artifact_digest = "A".repeat(64);
        assert!(normalize_upload(&upper).is_err());
    }

    #[test]
    fn staged_upload_digest_mismatch_is_invalid_parameters_not_absence() {
        let (tenant, me, other, definition) = (
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
        );
        let staged = Upload {
            tenant_id: tenant,
            principal_id: me,
            skill_resource_id: definition,
            artifact: Some(b"x".to_vec()),
            artifact_digest: "a".repeat(64),
            artifact_byte_size: 1,
            skill_name: "release-notes".into(),
            description: "d".into(),
            short_description: None,
            upload_digest: "b".repeat(64),
            expired: false,
            consumed_by_action_execution_id: None,
        };
        let reason = |r: Result<(), Refusal>| r.err().map(|refusal| refusal.reason());
        let digest = "a".repeat(64);
        assert!(staged_target(
            Some(&staged),
            tenant,
            me,
            definition,
            "release-notes",
            &digest
        )
        .is_ok());
        assert_eq!(
            reason(staged_target(
                Some(&staged),
                tenant,
                me,
                definition,
                "release-notes",
                &"c".repeat(64)
            )),
            Some(ReasonCode::InvalidParameters)
        );
        for (who, def) in [(other, definition), (me, Uuid::new_v4())] {
            assert_eq!(
                reason(staged_target(
                    Some(&staged),
                    tenant,
                    who,
                    def,
                    "release-notes",
                    &digest
                )),
                Some(ReasonCode::TargetNotFound)
            );
        }
        assert_eq!(
            reason(staged_target(
                None,
                tenant,
                me,
                definition,
                "release-notes",
                &digest
            )),
            Some(ReasonCode::TargetNotFound)
        );
    }

    #[test]
    fn each_skill_action_accepts_only_its_own_parameters() {
        let resource = Some(Uuid::new_v4());
        let create = Params {
            slug: Some("release-notes".into()),
            name: Some("Release notes".into()),
            explicit_confirmation: Some(true),
            ..Params::default()
        };
        assert!(validate_params(Semantic::SkillDefinitionCreate, &create).is_ok());
        let unconfirmed = Params {
            explicit_confirmation: None,
            ..create.clone()
        };
        assert!(validate_params(Semantic::SkillDefinitionCreate, &unconfirmed).is_err());
        let bad_slug = Params {
            slug: Some("Release".into()),
            ..create.clone()
        };
        assert!(validate_params(Semantic::SkillDefinitionCreate, &bad_slug).is_err());
        let stray = Params {
            resource_id: resource,
            ..create
        };
        assert!(validate_params(Semantic::SkillDefinitionCreate, &stray).is_err());
        let share = Params {
            resource_id: resource,
            resource_version: Some(2),
            explicit_confirmation: Some(true),
            ..Params::default()
        };
        for sem in [
            Semantic::SkillDefinitionShare,
            Semantic::SkillDefinitionUnshare,
            Semantic::SkillDefinitionDisable,
        ] {
            assert!(validate_params(sem, &share).is_ok());
        }
        assert!(validate_params(Semantic::SkillVersionCreate, &share).is_err());
        let upload = Params {
            skill_version_upload: Some(normalize_upload(&upload_command(&[])).unwrap()),
            ..share.clone()
        };
        assert!(validate_params(Semantic::SkillVersionCreate, &upload).is_ok());
        assert!(validate_params(Semantic::SkillDefinitionShare, &upload).is_err());
        let publish = Params {
            asset_id: Some(Uuid::new_v4()),
            asset_version: Some(1),
            ..share
        };
        assert!(validate_params(Semantic::SkillVersionPublish, &publish).is_ok());
        assert!(validate_params(Semantic::SkillVersionRetire, &publish).is_ok());
        assert!(validate_params(Semantic::SkillDefinitionDisable, &publish).is_err());
    }

    #[test]
    fn every_skill_semantic_has_a_closed_catalog_shape() {
        for key in [
            "skill.definition.create",
            "skill.version.create",
            "skill.version.publish",
            "skill.version.retire",
            "skill.definition.disable",
            "skill.definition.share",
            "skill.definition.unshare",
        ] {
            let sem = Semantic::from_key(key).unwrap();
            assert!(sem.is_skill() && expected(sem).is_some(), "{key}");
        }
        assert!(!Semantic::AgentVersionCreate.is_skill());
    }
}
