//! DD-131(1)(6)(8)、05 §2.12、03 §5/§7：Tenant 级 `agent.team` Resource（AgentTeam）与
//! 定义/团队的目录分享。
//!
//! 团队成员只是同 Tenant AgentDefinition 的有序引用：写入时要求发起人当前可 `read` 每个
//! 成员，读取时只列出读者可 `discover` 的成员；引用不授予成员任何 permission，不承载
//! instructions 或运行配置。原版团队级 instructions、内置 welcome 团队与本机
//! `teams.json`/kind:30176 不进入运行链。目录分享（原 “Share to catalog”）只为该
//! Resource 写入或删除 `discoverer` 与 `reader` 的 `tenant#member` relationship，
//! 不授予或撤销任何 Installation 使用权（05 §2.10）。全部动作 SYNC、HUMAN-only、EXPLICIT。

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::{EvidenceKind, ReasonCode};
use serde_json::{json, Value};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use super::{
    audit, lock_execution, Definition, Execution, Governance, Params, Refusal, Semantic, Target,
};
use crate::bff::{resolve_execution_context, BffState};
use crate::spicedb::{Consistency, Relationship, RelationshipFilter, Write};

pub(crate) const TYPE_KEY: &str = "agent.team";
/// 03 §7：团队至多 64 个成员（沿原版团队目录上限）。
pub(crate) const MAX_TEAM_MEMBERS: usize = 64;
const MAX_NAME_CHARS: usize = 200;
const MAX_DESCRIPTION_CHARS: usize = 2000;

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}

fn unavailable() -> Refusal {
    Refusal::Unavailable("目录或团队投影结果不明".into())
}

impl Semantic {
    /// DD-131(1)(6) 的团队管理与目录分享动作（05 §2.12）。
    pub(crate) fn is_team_catalog(self) -> bool {
        matches!(
            self,
            Self::AgentTeamCreate
                | Self::AgentTeamUpdate
                | Self::AgentTeamDelete
                | Self::AgentTeamShare
                | Self::AgentTeamUnshare
                | Self::AgentDefinitionShare
                | Self::AgentDefinitionUnshare
        )
    }

    /// 写入或删除目录授予的动作；团队删除同样删除其授予。
    pub(crate) fn writes_catalog_grants(self) -> bool {
        matches!(
            self,
            Self::AgentTeamShare
                | Self::AgentTeamUnshare
                | Self::AgentDefinitionShare
                | Self::AgentDefinitionUnshare
                | Self::AgentTeamDelete
        )
    }

    /// 目标是既有 agent.team Resource 的动作。
    fn targets_team(self) -> bool {
        matches!(
            self,
            Self::AgentTeamUpdate
                | Self::AgentTeamDelete
                | Self::AgentTeamShare
                | Self::AgentTeamUnshare
        )
    }
}

/// 05 §2.12 的 ActionDefinition 形状；目录漂移即 BLOCKED，不按别的形状执行。
fn expected(sem: Semantic) -> Option<(&'static str, &'static str)> {
    Some(match sem {
        Semantic::AgentTeamCreate => ("create", "tenant"),
        Semantic::AgentTeamUpdate => ("update", "resource"),
        Semantic::AgentTeamDelete => ("manage", "resource"),
        Semantic::AgentTeamShare
        | Semantic::AgentTeamUnshare
        | Semantic::AgentDefinitionShare
        | Semantic::AgentDefinitionUnshare => ("share", "resource"),
        _ => return None,
    })
}

fn check_definition(def: &Definition, sem: Semantic) -> Result<(), Refusal> {
    let (permission, object) =
        expected(sem).ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    if def.target_type != "RESOURCE"
        || def.workspace_rule != "TENANT_ONLY"
        || def.permission != permission
        || def.permission_object_type != object
        || def.execution_mode != "SYNC"
        || def.confirmation_mode != "EXPLICIT"
        || def.workflow_kind.is_some()
        || def.quota_policy != "NONE"
        || !def.meters.is_empty()
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

/// 规范化 `AgentTeamInput`：去首尾空白、空说明省略、成员按给出次序去重校验。
pub(crate) fn normalize_team(input: &contracts::AgentTeamInput) -> Result<Value, Refusal> {
    let name = input.name.trim();
    if name.is_empty()
        || name.chars().count() > MAX_NAME_CHARS
        || name.chars().any(char::is_control)
    {
        return Err(invalid());
    }
    let description = input
        .description
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty());
    if description.is_some_and(|d| {
        d.chars().count() > MAX_DESCRIPTION_CHARS
            || d.chars()
                .any(|c| c.is_control() && !matches!(c, '\n' | '\t'))
    }) {
        return Err(invalid());
    }
    if input.member_agent_resource_ids.len() > MAX_TEAM_MEMBERS {
        return Err(invalid());
    }
    let mut members = Vec::with_capacity(input.member_agent_resource_ids.len());
    for id in &input.member_agent_resource_ids {
        let id = Uuid::parse_str(id).map_err(|_| invalid())?;
        if id.is_nil() || members.contains(&id) {
            return Err(invalid());
        }
        members.push(id);
    }
    let mut value = json!({"name": name, "memberAgentResourceIds": members});
    if let Some(description) = description {
        value["description"] = json!(description);
    }
    Ok(value)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TeamInput {
    pub name: String,
    pub description: Option<String>,
    pub members: Vec<Uuid>,
}

pub(crate) fn team_input(p: &Params) -> Option<TeamInput> {
    let v = p.agent_team.as_ref()?;
    Some(TeamInput {
        name: v.get("name")?.as_str()?.to_owned(),
        description: v
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_owned),
        members: v
            .get("memberAgentResourceIds")?
            .as_array()?
            .iter()
            .map(|m| m.as_str().and_then(|s| Uuid::parse_str(s).ok()))
            .collect::<Option<Vec<_>>>()?,
    })
}

/// 每个语义的参数是闭集：只保留该语义允许的字段后必须与原参数相等。
pub(super) fn validate_params(sem: Semantic, p: &Params) -> Result<(), Refusal> {
    let target = |p: &Params| {
        p.resource_id.is_some_and(|id| !id.is_nil()) && p.resource_version.is_some_and(|v| v > 0)
    };
    let allowed = match sem {
        Semantic::AgentTeamCreate => Params {
            agent_team: p.agent_team.clone(),
            explicit_confirmation: p.explicit_confirmation,
            ..Params::default()
        },
        Semantic::AgentTeamUpdate => Params {
            resource_id: p.resource_id,
            resource_version: p.resource_version,
            agent_team: p.agent_team.clone(),
            explicit_confirmation: p.explicit_confirmation,
            ..Params::default()
        },
        Semantic::AgentTeamDelete
        | Semantic::AgentTeamShare
        | Semantic::AgentTeamUnshare
        | Semantic::AgentDefinitionShare
        | Semantic::AgentDefinitionUnshare => Params {
            resource_id: p.resource_id,
            resource_version: p.resource_version,
            explicit_confirmation: p.explicit_confirmation,
            ..Params::default()
        },
        _ => return Err(invalid()),
    };
    let confirmed = p.explicit_confirmation == Some(true);
    let ok = *p == allowed
        && confirmed
        && match sem {
            Semantic::AgentTeamCreate => team_input(p).is_some(),
            Semantic::AgentTeamUpdate => target(p) && team_input(p).is_some(),
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
pub(crate) struct Team {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub owner_principal_id: Uuid,
    pub state: String,
    pub version: i32,
    pub projection_action_execution_id: Option<Uuid>,
    pub name: String,
    pub description: Option<String>,
    pub members: Vec<Uuid>,
    pub team_state: String,
}

const TEAM_COLUMNS: &str =
    "r.id,r.tenant_id,r.owner_principal_id,r.state,r.version,r.projection_action_execution_id,
    t.name,t.description,t.member_agent_resource_ids as members,t.state as team_state";

pub(crate) async fn team(
    conn: &mut PgConnection,
    tenant: Uuid,
    id: Uuid,
    lock: bool,
) -> Result<Option<Team>, sqlx::Error> {
    sqlx::query_as(&format!(
        "select {TEAM_COLUMNS}
         from catalog.resource r join catalog.agent_team t on t.resource_id=r.id
         where r.id=$1 and r.tenant_id=$2 and r.type_key='agent.team' and r.home_workspace_id is null{}",
        if lock { " for update of r,t" } else { "" }
    ))
    .bind(id)
    .bind(tenant)
    .fetch_optional(conn)
    .await
}

fn usable(team: &Team) -> bool {
    team.state == "ACTIVE"
        && team.team_state == "ACTIVE"
        && team.projection_action_execution_id.is_none()
}

/// 成员须是同 Tenant、当前 ACTIVE 且无未闭合投影的 AgentDefinition；read 在 gate 里 fresh 查。
async fn members_exist(
    conn: &mut PgConnection,
    tenant: Uuid,
    members: &[Uuid],
) -> Result<bool, sqlx::Error> {
    let found: i64 = sqlx::query_scalar(
        "select count(*) from catalog.resource r join catalog.agent_definition a on a.resource_id=r.id
         where r.tenant_id=$1 and r.id = any($2) and r.type_key='agent.definition' and r.state='ACTIVE'
           and r.projection_action_execution_id is null",
    )
    .bind(tenant)
    .bind(members)
    .fetch_one(conn)
    .await?;
    Ok(usize::try_from(found).ok() == Some(members.len()))
}

/// `resolve_target` 中 DD-131(1)(6) 动作的分支。
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
    match sem {
        Semantic::AgentTeamCreate => {
            let input = team_input(p).ok_or_else(invalid)?;
            if !members_exist(conn, tenant, &input.members).await? {
                return Err(Refusal::Precondition(ReasonCode::TargetNotFound));
            }
            Ok(Target {
                id: frozen.unwrap_or_else(Uuid::new_v4),
                version: 0,
                workspace_id: None,
            })
        }
        _ if sem.targets_team() => {
            let id = p.resource_id.ok_or_else(invalid)?;
            let t = team(conn, tenant, id, lock)
                .await?
                .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
            if !usable(&t)
                || p.resource_version != Some(t.version)
                || frozen.is_some_and(|f| f != t.id)
            {
                return Err(conflict());
            }
            if sem == Semantic::AgentTeamUpdate {
                let input = team_input(p).ok_or_else(invalid)?;
                if !members_exist(conn, tenant, &input.members).await? {
                    return Err(Refusal::Precondition(ReasonCode::TargetNotFound));
                }
            }
            Ok(Target {
                id: t.id,
                version: t.version,
                workspace_id: None,
            })
        }
        Semantic::AgentDefinitionShare | Semantic::AgentDefinitionUnshare => {
            let id = p.resource_id.ok_or_else(invalid)?;
            let r = crate::agent_definition::resource(conn, tenant, id, lock)
                .await?
                .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
            if r.state != "ACTIVE"
                || r.home_workspace_id.is_some()
                || r.projection_action_execution_id.is_some()
                || p.resource_version != Some(r.version)
                || frozen.is_some_and(|f| f != r.id)
            {
                return Err(conflict());
            }
            Ok(Target {
                id: r.id,
                version: r.version,
                workspace_id: None,
            })
        }
        _ => Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)),
    }
}

/// `evaluate` 中 agent.team 目标的投影核对：tenant/owner 闭合（容许目录授予），团队未删除。
pub(super) async fn evaluate_team(
    g: &Governance,
    tenant: Uuid,
    target: &Target,
) -> Result<bool, Refusal> {
    let mut conn = g.pool.acquire().await?;
    let Some(t) = team(&mut conn, tenant, target.id, false).await? else {
        return Ok(false);
    };
    if !usable(&t) || t.version != target.version || target.workspace_id.is_some() {
        return Ok(false);
    }
    Ok(projection(g, &t).await?.is_some())
}

async fn projection(g: &Governance, t: &Team) -> Result<Option<bool>, Refusal> {
    g.spicedb
        .catalog_projection(
            &t.id.to_string(),
            &t.tenant_id.to_string(),
            &t.owner_principal_id.to_string(),
            g.cfg.relationship_page,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()))
}

/// 准入门禁：只接受 HUMAN 发起；团队写入时发起人须当前 fresh 可 `read` 每个成员（DD-131(1)）。
pub(super) async fn gate(
    g: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    sem: Semantic,
    p: &Params,
) -> Result<(), Refusal> {
    if !crate::agent_definition::active_owner(conn, tenant, initiator).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let members = match sem {
        Semantic::AgentTeamCreate | Semantic::AgentTeamUpdate => {
            team_input(p).ok_or_else(invalid)?.members
        }
        _ => return Ok(()),
    };
    for member in members {
        let checked = g
            .spicedb
            .check(
                "resource",
                &member.to_string(),
                "read",
                &initiator.to_string(),
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

// ---------------------------------------------------------------------------
// 准入事务内的写入
// ---------------------------------------------------------------------------

/// SYNC 动作在准入事务内的预写。create 以同一 AE 作投影意图；update 在准入事务内完成；
/// delete 先写墓碑（拒绝新动作）再由派发删除目录授予；分享不改写 Core 事实。
pub(super) async fn prewrite(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    sem: Semantic,
    p: &Params,
) -> Result<(), Refusal> {
    if !crate::agent_definition::active_owner(tx, ae.tenant_id, ae.initiator_principal_id).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    match sem {
        Semantic::AgentTeamCreate => {
            let input = team_input(p).ok_or_else(invalid)?;
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
            sqlx::query("insert into catalog.resource
                (id,tenant_id,type_key,owner_principal_id,component_type_key,native_type,native_id,state,version,projection_action_execution_id)
                values ($1,$2,$3,$4,$5,$3,$1::text,'PROVISIONING',1,$6)")
                .bind(ae.target_id).bind(ae.tenant_id).bind(TYPE_KEY).bind(ae.initiator_principal_id)
                .bind(&def.component_type_key).bind(ae.id).execute(&mut **tx).await?;
            sqlx::query(
                "insert into catalog.agent_team(resource_id,name,description,member_agent_resource_ids,state)
                 values ($1,$2,$3,$4,'ACTIVE')",
            )
            .bind(ae.target_id)
            .bind(&input.name)
            .bind(&input.description)
            .bind(&input.members)
            .execute(&mut **tx)
            .await?;
        }
        Semantic::AgentTeamUpdate | Semantic::AgentTeamDelete => {
            let changed = if sem == Semantic::AgentTeamUpdate {
                let input = team_input(p).ok_or_else(invalid)?;
                sqlx::query(
                    "update catalog.agent_team set name=$2,description=$3,member_agent_resource_ids=$4
                     where resource_id=$1 and state='ACTIVE'",
                )
                .bind(ae.target_id)
                .bind(&input.name)
                .bind(&input.description)
                .bind(&input.members)
                .execute(&mut **tx)
                .await?
            } else {
                sqlx::query(
                    "update catalog.agent_team set state='DELETED' where resource_id=$1 and state='ACTIVE'",
                )
                .bind(ae.target_id)
                .execute(&mut **tx)
                .await?
            };
            let bumped = sqlx::query(
                "update catalog.resource set version=version+1 where id=$1 and tenant_id=$2 and version=$3
                 and state='ACTIVE' and projection_action_execution_id is null",
            )
            .bind(ae.target_id)
            .bind(ae.tenant_id)
            .bind(ae.frozen_target_version())
            .execute(&mut **tx)
            .await?;
            if changed.rows_affected() != 1 || bumped.rows_affected() != 1 {
                return Err(conflict());
            }
        }
        _ if sem.writes_catalog_grants() => {}
        _ => return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)),
    }
    Ok(())
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

/// `agent.team.create` 的投影：tenant/owner 投影写入并查证后 Resource 才 ACTIVE；确定拒绝
/// 先原生删除投影再中止，结果不明保持 UNKNOWN（由对账以同一意图重试）。
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
    let t = team(&mut tx, ae.tenant_id, ae.target_id, true)
        .await?
        .filter(|t| t.projection_action_execution_id == Some(ae.id))
        .ok_or_else(conflict)?;
    let owner = t.owner_principal_id;
    if !(active && crate::agent_definition::active_owner(&mut tx, ae.tenant_id, owner).await?) {
        return abort_create(g, tx, &ae, def, &t).await;
    }
    let matched = match projection(g, &t).await {
        Ok(observed) => observed.is_some(),
        Err(_) => return record_unknown(tx, &ae, def).await,
    };
    if !matched {
        // 首次写入前 fresh 复核发起人的 Tenant create 与每个成员的 read。
        let mut allowed = true;
        let mut checks = vec![("tenant", ae.tenant_id, "create")];
        checks.extend(t.members.iter().map(|m| ("resource", *m, "read")));
        for (object, object_id, permission) in checks {
            match g
                .spicedb
                .check(
                    object,
                    &object_id.to_string(),
                    permission,
                    &ae.initiator_principal_id.to_string(),
                    Consistency::FullyConsistent,
                )
                .await
            {
                Ok(c) => allowed &= c.allowed,
                Err(_) => return record_unknown(tx, &ae, def).await,
            }
        }
        if !allowed {
            return abort_create(g, tx, &ae, def, &t).await;
        }
        match g
            .spicedb
            .replace_resource_projection(
                &t.id.to_string(),
                &t.tenant_id.to_string(),
                &owner.to_string(),
                &owner.to_string(),
                None,
            )
            .await
        {
            Ok(token) if !token.is_empty() => {}
            _ => return record_unknown(tx, &ae, def).await,
        }
        if !matches!(projection(g, &t).await, Ok(Some(_))) {
            return record_unknown(tx, &ae, def).await;
        }
    }
    let proof = match g
        .spicedb
        .check(
            "resource",
            &t.id.to_string(),
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
    .bind(t.id)
    .bind(t.tenant_id)
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(conflict());
    }
    let evidence = vec![
        crate::audit::Evidence::new(EvidenceKind::SpicedbZedtoken, &proof.zed_token),
        crate::audit::Evidence::new(
            EvidenceKind::SpicedbRelationship,
            format!("resource:{}#owner@principal:{owner}", t.id),
        ),
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
            "AGENT_TEAM_CREATED",
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
    t: &Team,
) -> Result<(), Refusal> {
    // 可能已写入的投影先原生删除并以空集合查证，再中止；不把未知写当作从未发生。
    match g.spicedb.delete_resource_projection(t.id).await {
        Ok(token) if !token.is_empty() => {
            sqlx::query(
                "update catalog.resource set state='DELETED',projection_action_execution_id=null,version=version+1
                 where id=$1 and tenant_id=$2",
            )
            .bind(t.id)
            .bind(t.tenant_id)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "update catalog.agent_team set state='DELETED' where resource_id=$1 and state='ACTIVE'",
            )
            .bind(t.id)
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

/// 目录分享、取消分享与团队删除（删除其目录授予）的派发：先持久化 UNKNOWN 意图再写
/// SpiceDB，写后回读复核；结果不明保持 UNKNOWN，由对账以同一冻结意图幂等重写并查证。
/// 写入只在 Tenant ACTIVE（取消与删除不要求）且持有 Tenant 行锁时发生。
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
            "catalog-dispatch-intent",
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
    let grant = matches!(
        sem,
        Semantic::AgentTeamShare | Semantic::AgentDefinitionShare
    );
    // 冻结的目标：分享不改版本；删除在准入事务里已写墓碑并推进一个版本。
    let expected = ae.frozen_target_version().ok_or_else(conflict)?
        + i32::from(sem == Semantic::AgentTeamDelete);
    let current = match sem {
        Semantic::AgentDefinitionShare | Semantic::AgentDefinitionUnshare => {
            crate::agent_definition::resource(&mut tx, ae.tenant_id, ae.target_id, true)
                .await?
                .filter(|r| {
                    r.state == "ACTIVE"
                        && r.version == expected
                        && r.projection_action_execution_id.is_none()
                })
                .map(|r| r.owner_principal_id)
        }
        _ => team(&mut tx, ae.tenant_id, ae.target_id, true)
            .await?
            .filter(|t| {
                t.state == "ACTIVE"
                    && t.version == expected
                    && t.projection_action_execution_id.is_none()
                    && (t.team_state == "DELETED") == (sem == Semantic::AgentTeamDelete)
            })
            .map(|t| t.owner_principal_id),
    };
    let fresh = match current {
        Some(_) if active && first && grant => {
            // 首次写入前 fresh 复核发起人当前的 share 与 scope。
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
                "catalog-outcome",
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
            return Err(unavailable());
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
            "catalog-prior-unknown",
            "RECONCILIATION",
            "NONE",
            "DISPATCH_RESULT_UNKNOWN",
            None,
            Vec::new(),
        )
        .await?;
        tx.commit().await?;
        return Err(unavailable());
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
    // 写前意图把 DISPATCH 记为结果不明；回读确认后以同一 record_dispatch 推进为 DISPATCHED。
    let recorded =
        super::record_dispatch(&mut tx, ae.id, def.audit_class(), Ok(()), evidence.clone()).await?;
    if recorded.settled {
        audit(
            &mut tx,
            &ae,
            def,
            "catalog-outcome",
            "OUTCOME",
            "ALLOW",
            match sem {
                Semantic::AgentTeamDelete => "AGENT_TEAM_DELETED",
                _ if grant => "CATALOG_SHARED",
                _ => "CATALOG_UNSHARED",
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
// 读取（BFF）
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
pub struct PageQuery {
    pub offset: Option<i64>,
}

fn view(t: Team, visible: Vec<Uuid>, shared: bool) -> contracts::AgentTeamView {
    let hidden = t.members.len().saturating_sub(visible.len());
    contracts::AgentTeamView {
        resource_id: t.id.to_string(),
        name: t.name,
        description: t.description,
        member_agent_resource_ids: visible.iter().map(Uuid::to_string).collect(),
        hidden_member_count: i64::try_from(hidden).unwrap_or(i64::MAX),
        owner_principal_id: t.owner_principal_id.to_string(),
        resource_version: i64::from(t.version),
        resource_state: contracts::ResourceState::Active,
        catalog_shared: shared,
    }
}

/// 只列出读者当前可 discover 的成员，原顺序不变（DD-131(1)）。
async fn visible_members(
    g: &Governance,
    principal: Uuid,
    teams: &[Team],
) -> Result<std::collections::HashSet<String>, Refusal> {
    let mut ids: Vec<String> = teams
        .iter()
        .flat_map(|t| t.members.iter().map(Uuid::to_string))
        .collect();
    ids.sort();
    ids.dedup();
    g.spicedb
        .check_bulk("resource", &ids, "discover", &principal.to_string())
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()))
}

async fn shared_of(g: &Governance, t: &Team) -> Result<bool, Refusal> {
    projection(g, t)
        .await?
        .ok_or_else(|| Refusal::Unavailable("Resource 权限投影不一致".into()))
}

fn visible_of(t: &Team, members: &std::collections::HashSet<String>) -> Vec<Uuid> {
    t.members
        .iter()
        .copied()
        .filter(|m| members.contains(&m.to_string()))
        .collect()
}

/// `GET /api/v1/agent-teams`：同 Tenant、读者当前可 discover 的未删除团队。
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
    let g = &state.governance;
    let limit = i64::from(g.cfg.relationship_page);
    let rows: Result<Vec<Team>, _> = sqlx::query_as(&format!(
        "select {TEAM_COLUMNS} from catalog.resource r join catalog.agent_team t on t.resource_id=r.id
         where r.tenant_id=$1 and r.type_key='agent.team' and r.state='ACTIVE' and t.state='ACTIVE'
           and r.projection_action_execution_id is null
         order by r.id offset $2 limit $3"
    ))
    .bind(ctx.tenant_id)
    .bind(offset)
    .bind(limit)
    .fetch_all(&state.pool)
    .await;
    let rows = match rows {
        Ok(r) => r,
        Err(e) => return crate::service_api::unavailable(e),
    };
    let next =
        (rows.len() == usize::try_from(limit).unwrap_or(usize::MAX)).then_some(offset + limit);
    let ids: Vec<String> = rows.iter().map(|r| r.id.to_string()).collect();
    let discoverable = match g
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
        Err(e) => return Refusal::Unavailable(e.to_string()).respond(None),
    };
    let rows: Vec<Team> = rows
        .into_iter()
        .filter(|r| discoverable.contains(&r.id.to_string()))
        .collect();
    let members = match visible_members(g, ctx.tenant_principal_id, &rows).await {
        Ok(m) => m,
        Err(e) => return e.respond(None),
    };
    let mut teams = Vec::with_capacity(rows.len());
    for t in rows {
        let shared = match shared_of(g, &t).await {
            Ok(s) => s,
            Err(e) => return e.respond(None),
        };
        let visible = visible_of(&t, &members);
        teams.push(view(t, visible, shared));
    }
    Json(contracts::AgentTeamPage {
        teams,
        next_offset: next,
    })
    .into_response()
}

/// `GET /api/v1/agent-teams/{resource_id}`：读者须 fresh 持有该团队的 `read`。
pub async fn get(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    let g = &state.governance;
    let mut conn = match state.pool.acquire().await {
        Ok(c) => c,
        Err(e) => return crate::service_api::unavailable(e),
    };
    let t = match team(&mut conn, ctx.tenant_id, id, false).await {
        Ok(Some(t)) if usable(&t) => t,
        Ok(_) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return crate::service_api::unavailable(e),
    };
    drop(conn);
    match g
        .spicedb
        .check(
            "resource",
            &id.to_string(),
            "read",
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
    {
        Ok(c) if c.allowed => {}
        Ok(_) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return Refusal::Unavailable(e.to_string()).respond(None),
    }
    let shared = match shared_of(g, &t).await {
        Ok(s) => s,
        Err(e) => return e.respond(None),
    };
    let members = match visible_members(g, ctx.tenant_principal_id, std::slice::from_ref(&t)).await
    {
        Ok(m) => m,
        Err(e) => return e.respond(None),
    };
    let visible = visible_of(&t, &members);
    Json(view(t, visible, shared)).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command(value: Value) -> contracts::ActionCommand {
        serde_json::from_value(value).unwrap()
    }

    fn parse(sem: Semantic, value: Value) -> Result<Params, Refusal> {
        super::super::parse_command(sem, &command(value))
    }

    #[test]
    fn team_input_is_trimmed_ordered_and_closed() {
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let p = parse(
            Semantic::AgentTeamCreate,
            json!({"actionKey":"agent.team.create","idempotencyKey":Uuid::new_v4(),
                "agentTeam":{"name":"  Crew ","description":"  ","memberAgentResourceIds":[b,a]},
                "explicitConfirmation":true}),
        )
        .unwrap();
        let input = team_input(&p).unwrap();
        assert_eq!(input.name, "Crew");
        assert_eq!(input.description, None);
        assert_eq!(input.members, vec![b, a]);
        assert_eq!(Params::from_json(&p.to_json()), Some(p.clone()));
        // 重复成员、超过 64 个、缺确认、空名、多出的参数都拒绝。
        for bad in [
            json!({"actionKey":"agent.team.create","idempotencyKey":Uuid::new_v4(),
                "agentTeam":{"name":"x","memberAgentResourceIds":[a,a]},"explicitConfirmation":true}),
            json!({"actionKey":"agent.team.create","idempotencyKey":Uuid::new_v4(),
                "agentTeam":{"name":"x","memberAgentResourceIds":(0..65).map(|_| Uuid::new_v4()).collect::<Vec<_>>()},
                "explicitConfirmation":true}),
            json!({"actionKey":"agent.team.create","idempotencyKey":Uuid::new_v4(),
                "agentTeam":{"name":"x","memberAgentResourceIds":[]}}),
            json!({"actionKey":"agent.team.create","idempotencyKey":Uuid::new_v4(),
                "agentTeam":{"name":" ","memberAgentResourceIds":[]},"explicitConfirmation":true}),
            json!({"actionKey":"agent.team.create","idempotencyKey":Uuid::new_v4(),
                "agentTeam":{"name":"x","memberAgentResourceIds":[]},"explicitConfirmation":true,
                "resourceId":a,"resourceVersion":1}),
            json!({"actionKey":"agent.team.create","idempotencyKey":Uuid::new_v4(),
                "agentTeam":{"name":"x","memberAgentResourceIds":[Uuid::nil()]},"explicitConfirmation":true}),
        ] {
            assert!(parse(Semantic::AgentTeamCreate, bad).is_err());
        }
        // 团队输入只属于 create/update。
        assert!(parse(
            Semantic::AgentTeamShare,
            json!({"actionKey":"agent.team.share","idempotencyKey":Uuid::new_v4(),"resourceId":a,
                "resourceVersion":1,"explicitConfirmation":true,
                "agentTeam":{"name":"x","memberAgentResourceIds":[]}})
        )
        .is_err());
        assert!(parse(
            Semantic::AgentDefinitionCreate,
            json!({"actionKey":"agent.definition.create","idempotencyKey":Uuid::new_v4(),
                "agentTeam":{"name":"x","memberAgentResourceIds":[]}})
        )
        .is_err());
    }

    #[test]
    fn update_requires_target_version_and_input() {
        let id = Uuid::new_v4();
        let ok = parse(
            Semantic::AgentTeamUpdate,
            json!({"actionKey":"agent.team.update","idempotencyKey":Uuid::new_v4(),"resourceId":id,
                "resourceVersion":3,"agentTeam":{"name":"Crew","memberAgentResourceIds":[]},
                "explicitConfirmation":true}),
        )
        .unwrap();
        assert_eq!(ok.resource_version, Some(3));
        assert!(parse(
            Semantic::AgentTeamUpdate,
            json!({"actionKey":"agent.team.update","idempotencyKey":Uuid::new_v4(),"resourceId":id,
                "agentTeam":{"name":"Crew","memberAgentResourceIds":[]},"explicitConfirmation":true})
        )
        .is_err());
        assert!(parse(
            Semantic::AgentTeamUpdate,
            json!({"actionKey":"agent.team.update","idempotencyKey":Uuid::new_v4(),"resourceId":id,
                "resourceVersion":3,"explicitConfirmation":true})
        )
        .is_err());
    }

    #[test]
    fn share_commands_take_only_target_version_and_confirmation() {
        let id = Uuid::new_v4();
        for sem in [
            Semantic::AgentTeamShare,
            Semantic::AgentTeamUnshare,
            Semantic::AgentTeamDelete,
            Semantic::AgentDefinitionShare,
            Semantic::AgentDefinitionUnshare,
        ] {
            let ok = parse(
                sem,
                json!({"actionKey":"x","idempotencyKey":Uuid::new_v4(),"resourceId":id,
                    "resourceVersion":2,"explicitConfirmation":true}),
            )
            .unwrap();
            assert_eq!(ok.resource_id, Some(id));
            assert!(parse(
                sem,
                json!({"actionKey":"x","idempotencyKey":Uuid::new_v4(),"resourceId":id,"resourceVersion":2})
            )
            .is_err());
            assert!(parse(
                sem,
                json!({"actionKey":"x","idempotencyKey":Uuid::new_v4(),"resourceId":id,
                    "resourceVersion":2,"explicitConfirmation":true,"principalId":Uuid::new_v4()})
            )
            .is_err());
        }
    }

    #[test]
    fn team_actions_are_human_explicit_and_tenant_serialized() {
        for key in [
            "agent.team.create",
            "agent.team.update",
            "agent.team.delete",
            "agent.team.share",
            "agent.team.unshare",
            "agent.definition.share",
            "agent.definition.unshare",
        ] {
            let sem = Semantic::from_key(key).unwrap();
            assert!(sem.is_team_catalog(), "{key}");
            assert!(sem.takes_explicit_confirmation(), "{key}");
            assert!(sem.serializes_on_tenant(), "{key}");
        }
        assert!(Semantic::AgentTeamUpdate.completes_in_admission());
        assert!(!Semantic::AgentTeamCreate.completes_in_admission());
        assert!(!Semantic::AgentTeamDelete.completes_in_admission());
        assert!(!Semantic::AgentDefinitionShare.completes_in_admission());
        assert!(Semantic::AgentTeamDelete.writes_catalog_grants());
        assert!(!Semantic::AgentTeamUpdate.writes_catalog_grants());
    }

    fn team_row(members: Vec<Uuid>) -> Team {
        Team {
            id: Uuid::new_v4(),
            tenant_id: Uuid::new_v4(),
            owner_principal_id: Uuid::new_v4(),
            state: "ACTIVE".into(),
            version: 3,
            projection_action_execution_id: None,
            name: "Crew".into(),
            description: None,
            members,
            team_state: "ACTIVE".into(),
        }
    }

    #[test]
    fn view_lists_only_discoverable_members_in_order() {
        let (a, b, c) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let t = team_row(vec![c, a, b]);
        let visible: std::collections::HashSet<String> =
            [b.to_string(), c.to_string()].into_iter().collect();
        let v = view(t.clone(), visible_of(&t, &visible), true);
        assert_eq!(
            v.member_agent_resource_ids,
            vec![c.to_string(), b.to_string()]
        );
        assert_eq!(v.hidden_member_count, 1);
        assert!(v.catalog_shared);
        assert_eq!(v.resource_version, 3);
        let mut deleted = t.clone();
        deleted.team_state = "DELETED".into();
        assert!(!usable(&deleted));
        let mut pending = t;
        pending.projection_action_execution_id = Some(Uuid::new_v4());
        assert!(!usable(&pending));
    }

    /// 隔离库：团队的库内不变式（迁移后的一次性库，事务回滚）。
    #[tokio::test]
    #[ignore = "requires isolated AGENT_TEAM_TEST_DATABASE_URL pointing at a disposable migrated database"]
    async fn agent_team_isolated_database_invariants() {
        use sqlx::Connection;
        let mut conn = PgConnection::connect(
            &std::env::var("AGENT_TEAM_TEST_DATABASE_URL").expect("isolated database URL"),
        )
        .await
        .unwrap();
        let mut tx = conn.begin().await.unwrap();
        let tenant = Uuid::new_v4();
        let other_tenant = Uuid::new_v4();
        let (principal, foreign_principal) = (Uuid::new_v4(), Uuid::new_v4());
        for (id, slug) in [(tenant, "dd131-a"), (other_tenant, "dd131-b")] {
            sqlx::query("insert into identity.tenant(id,slug,name,state) values ($1,$2||'-'||$1::text,'isolated DD-131','ACTIVE')")
                .bind(id).bind(slug).execute(&mut *tx).await.unwrap();
        }
        for (p, t) in [(principal, tenant), (foreign_principal, other_tenant)] {
            sqlx::query("insert into identity.principal(id,tenant_id,kind,status) values ($1,$2,'HUMAN','ACTIVE')")
                .bind(p).bind(t).execute(&mut *tx).await.unwrap();
        }
        async fn definition(tx: &mut PgConnection, tenant: Uuid, owner: Uuid) -> Uuid {
            let id = Uuid::new_v4();
            sqlx::query("insert into catalog.resource(id,tenant_id,type_key,owner_principal_id,component_type_key,native_type,native_id,state,version)
                values ($1,$2,'agent.definition',$3,'core','agent.definition',$1::text,'ACTIVE',1)")
                .bind(id).bind(tenant).bind(owner).execute(&mut *tx).await.unwrap();
            sqlx::query("insert into catalog.agent_definition(resource_id,stable_slug,display_name,status) values ($1,'d-'||$1::text,'D','ACTIVE')")
                .bind(id).execute(&mut *tx).await.unwrap();
            id
        }
        let a = definition(&mut tx, tenant, principal).await;
        let b = definition(&mut tx, tenant, principal).await;
        let foreign = definition(&mut tx, other_tenant, foreign_principal).await;
        let team_id = Uuid::new_v4();
        sqlx::query("insert into catalog.resource(id,tenant_id,type_key,owner_principal_id,component_type_key,native_type,native_id,state,version)
            values ($1,$2,'agent.team',$3,'core','agent.team',$1::text,'ACTIVE',1)")
            .bind(team_id).bind(tenant).bind(principal).execute(&mut *tx).await.unwrap();
        let insert = |members: Vec<Uuid>| {
            sqlx::query("insert into catalog.agent_team(resource_id,name,member_agent_resource_ids,state) values ($1,'Crew',$2,'ACTIVE')")
                .bind(team_id).bind(members)
        };
        // 重复成员与跨 Tenant 成员由库内守卫拒绝（逐次在保存点内尝试）。
        for bad in [vec![a, a], vec![a, foreign]] {
            let mut sp = tx.begin().await.unwrap();
            assert!(insert(bad).execute(&mut *sp).await.is_err());
            sp.rollback().await.unwrap();
        }
        insert(vec![b, a]).execute(&mut *tx).await.unwrap();
        let t = team(&mut tx, tenant, team_id, true).await.unwrap().unwrap();
        assert_eq!(t.members, vec![b, a]);
        assert!(usable(&t));
        assert!(team(&mut tx, other_tenant, team_id, false)
            .await
            .unwrap()
            .is_none());
        assert!(members_exist(&mut tx, tenant, &[a, b]).await.unwrap());
        assert!(!members_exist(&mut tx, tenant, &[a, foreign]).await.unwrap());
        // 墓碑不可改写。
        sqlx::query("update catalog.agent_team set state='DELETED' where resource_id=$1")
            .bind(team_id)
            .execute(&mut *tx)
            .await
            .unwrap();
        {
            let mut sp = tx.begin().await.unwrap();
            assert!(sqlx::query(
                "update catalog.agent_team set name='Again',state='ACTIVE' where resource_id=$1"
            )
            .bind(team_id)
            .execute(&mut *sp)
            .await
            .is_err());
            sp.rollback().await.unwrap();
        }
        assert!(!usable(
            &team(&mut tx, tenant, team_id, false)
                .await
                .unwrap()
                .unwrap()
        ));
        tx.rollback().await.unwrap();
    }
}
