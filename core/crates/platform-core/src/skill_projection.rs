//! DD-135(5)(7)、17 §4/§5/§10：Installation 的 Skill 投影事实。
//!
//! 物化输入只取 pinned Version 引用的版本 artifact，并在交给 runtime 前以 digest 重算；
//! 逐回合的有效判定（定义 ACTIVE、版本 PUBLISHED/RETIRED、Installation owner 的定义 `read`）
//! 与 Installation 详情的当前状态是同一规则，只停用失效的 Skill，不阻断整个 Installation。

use std::collections::HashMap;

use contracts::{AgentInstallationSkillStatus, ReasonCode};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::governance::{Governance, Refusal};
use crate::spicedb::Consistency;

/// 交给 runtime 物化的一个 Skill：名称即 slug，字节已按 digest 核对。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SkillArtifact {
    pub asset_id: Uuid,
    pub name: String,
    pub digest: String,
    pub bytes: Vec<u8>,
}

#[derive(FromRow)]
struct ArtifactRow {
    asset_id: Uuid,
    skill_name: String,
    artifact_digest: String,
    artifact: Option<Vec<u8>>,
}

fn ids(values: &[String]) -> Result<Vec<Uuid>, Refusal> {
    values
        .iter()
        .map(|id| {
            Uuid::parse_str(id).map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))
        })
        .collect()
}

/// pinned Version 引用的全部 artifact，保持版本中的顺序；缺失、字节被清空或 digest 不符
/// 都是投影失败（`PROJECTION_FAILED`），不以部分集合物化。
pub(crate) async fn artifacts(
    pool: &PgPool,
    tenant: Uuid,
    references: &[String],
) -> Result<Vec<SkillArtifact>, Refusal> {
    if references.is_empty() {
        return Ok(Vec::new());
    }
    let wanted = ids(references)?;
    let rows: Vec<ArtifactRow> = sqlx::query_as(
        "select v.asset_id,v.skill_name,v.artifact_digest,v.artifact from catalog.skill_version v
         join catalog.asset a on a.id=v.asset_id and a.tenant_id=v.tenant_id
         where v.tenant_id=$1 and v.asset_id=any($2) and a.type_key='skill.version'
           and v.state in ('PUBLISHED','RETIRED') and a.state=v.state",
    )
    .bind(tenant)
    .bind(&wanted)
    .fetch_all(pool)
    .await?;
    let mut by_id: HashMap<Uuid, ArtifactRow> = rows.into_iter().map(|r| (r.asset_id, r)).collect();
    let failed = || Refusal::Unavailable("Skill artifact 投影失败（PROJECTION_FAILED）".into());
    wanted
        .iter()
        .map(|id| {
            let row = by_id.remove(id).ok_or_else(failed)?;
            let bytes = row.artifact.ok_or_else(failed)?;
            if crate::skill_artifact::sha256_hex(&bytes) != row.artifact_digest
                || !crate::skill_artifact::valid_slug(&row.skill_name)
            {
                return Err(failed());
            }
            Ok(SkillArtifact {
                asset_id: *id,
                name: row.skill_name,
                digest: row.artifact_digest,
                bytes,
            })
        })
        .collect()
}

#[derive(FromRow)]
struct StateRow {
    asset_id: Uuid,
    skill_resource_id: Uuid,
    stable_slug: String,
    ordinal: i32,
    artifact_digest: String,
    version_state: String,
    definition_status: String,
    resource_state: String,
}

/// 一个被引 Skill 的 requested 事实与当前治理状态。
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SkillState {
    pub asset_id: Uuid,
    pub skill_resource_id: Uuid,
    pub slug: String,
    pub ordinal: i32,
    pub digest: String,
    /// `Effective`、`Disabled` 或 `NoPermission`；投影类状态由调用方按 generation 叠加。
    pub status: AgentInstallationSkillStatus,
}

/// DD-135(7) 的 fresh 判定：定义 ACTIVE、版本 PUBLISHED 或 RETIRED、`owner` 持有定义 `read`。
/// SpiceDB 不可查证时整体不可用，不把未知当作有效或失效。
pub(crate) async fn governance_states(
    g: &Governance,
    tenant: Uuid,
    owner: Uuid,
    references: &[String],
) -> Result<Vec<SkillState>, Refusal> {
    if references.is_empty() {
        return Ok(Vec::new());
    }
    let wanted = ids(references)?;
    let rows: Vec<StateRow> = sqlx::query_as(
        "select v.asset_id,v.skill_resource_id,d.stable_slug,v.ordinal,v.artifact_digest,
         v.state as version_state,d.status as definition_status,r.state as resource_state
         from catalog.skill_version v
         join catalog.skill_definition d on d.resource_id=v.skill_resource_id and d.tenant_id=v.tenant_id
         join catalog.resource r on r.id=d.resource_id and r.tenant_id=d.tenant_id
         where v.tenant_id=$1 and v.asset_id=any($2)",
    )
    .bind(tenant)
    .bind(&wanted)
    .fetch_all(&g.pool)
    .await?;
    let mut by_id: HashMap<Uuid, StateRow> = rows.into_iter().map(|r| (r.asset_id, r)).collect();
    let mut states = Vec::with_capacity(wanted.len());
    for id in wanted {
        let row = by_id
            .remove(&id)
            .ok_or(Refusal::Unavailable("被引 Skill 版本不存在".into()))?;
        let status = if row.definition_status != "ACTIVE"
            || row.resource_state != "ACTIVE"
            || !matches!(row.version_state.as_str(), "PUBLISHED" | "RETIRED")
        {
            AgentInstallationSkillStatus::Disabled
        } else {
            let checked = g
                .spicedb
                .check(
                    "resource",
                    &row.skill_resource_id.to_string(),
                    "read",
                    &owner.to_string(),
                    Consistency::FullyConsistent,
                )
                .await
                .map_err(|e| Refusal::Unavailable(e.to_string()))?;
            if checked.allowed {
                AgentInstallationSkillStatus::Effective
            } else {
                AgentInstallationSkillStatus::NoPermission
            }
        };
        states.push(SkillState {
            asset_id: id,
            skill_resource_id: row.skill_resource_id,
            slug: row.stable_slug,
            ordinal: row.ordinal,
            digest: row.artifact_digest,
            status,
        });
    }
    Ok(states)
}

/// DD-135(7)：本回合 fresh 有效的 Skill 版本集合（Installation owner 为问责 HUMAN）。
/// 不引 Skill 的 Installation 不做任何查询。
pub(crate) async fn turn_effective(
    g: &Governance,
    tenant: Uuid,
    installation: Uuid,
    version: Uuid,
) -> Result<std::collections::HashSet<Uuid>, Refusal> {
    let row: Option<(Uuid, serde_json::Value)> = sqlx::query_as(
        "select r.owner_principal_id,v.content from catalog.resource r
         join catalog.agent_installation i on i.resource_id=r.id
         join catalog.agent_version v on v.asset_id=$2
         where r.id=$1 and r.tenant_id=$3 and r.type_key='agent.installation'",
    )
    .bind(installation)
    .bind(version)
    .bind(tenant)
    .fetch_optional(&g.pool)
    .await?;
    let (owner, content) = row.ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    let content: contracts::AgentVersionContent = serde_json::from_value(content)
        .map_err(|_| Refusal::Unavailable("已发布 AgentVersion 不符合共享契约".into()))?;
    Ok(
        governance_states(g, tenant, owner, &content.skill_version_asset_ids)
            .await?
            .into_iter()
            .filter(|s| s.status == AgentInstallationSkillStatus::Effective)
            .map(|s| s.asset_id)
            .collect(),
    )
}
