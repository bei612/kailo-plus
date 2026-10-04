//! DD-24/25/45/47、03 §4/§7、17 §3/§6：Definition 下的不可变 Version Asset。
//! 创建与更新只经已有 Governance/ActionExecution；不安装、启动或复制 Agent 权威。

use axum::{http::StatusCode, response::IntoResponse, Json};
use contracts::{ContentClass as AgentVersionContent, ReasonCode};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    governance::{Definition, Execution, Governance, Params, Refusal, Semantic},
    spicedb::Consistency,
};

#[derive(sqlx::FromRow)]
pub(crate) struct Version {
    pub asset_id: Uuid,
    pub tenant_id: Uuid,
    pub agent_resource_id: Uuid,
    pub owner_principal_id: Uuid,
    pub ordinal: i32,
    pub version: i32,
    pub content: Value,
    pub config_hash: String,
    pub state: String,
    pub asset_state: String,
    pub projection_action_execution_id: Option<Uuid>,
}

pub(crate) async fn version(
    conn: &mut PgConnection,
    tenant: Uuid,
    id: Uuid,
    lock: bool,
) -> Result<Option<Version>, sqlx::Error> {
    sqlx::query_as(&format!(
        "select v.asset_id,a.tenant_id,v.agent_resource_id,a.owner_principal_id,v.ordinal,
         a.version,v.content,v.config_hash,v.state,a.state as asset_state,a.projection_action_execution_id
         from catalog.agent_version v join catalog.asset a on a.id=v.asset_id
         where a.tenant_id=$1 and a.id=$2{}", if lock { " for update of a,v" } else { "" }))
        .bind(tenant).bind(id).fetch_optional(conn).await
}

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

/// 共享契约的基础约束；没有缺省模型、timeout、owner 或 runtime。
pub(crate) fn content(value: &AgentVersionContent) -> Result<(Value, String), Refusal> {
    if value.persona_identity.display_name.trim().is_empty()
        || value.instructions.trim().is_empty()
        || value.runtime_profile_key.trim().is_empty()
        || value.reply_policy.trim().is_empty()
        || value.parallelism <= 0
        || value.turn_limits.idle_timeout_seconds <= 0
        || value.turn_limits.max_turn_duration_seconds <= 0
        || value.turn_limits.idle_timeout_seconds > value.turn_limits.max_turn_duration_seconds
        || Uuid::parse_str(&value.model_route_resource_id).is_err()
    {
        return Err(invalid());
    }
    for refs in [
        &value.skill_version_asset_ids,
        &value.declared_tool_resource_ids,
    ] {
        let mut seen = std::collections::HashSet::new();
        for id in refs {
            if Uuid::parse_str(id).is_err() || !seen.insert(id) {
                return Err(invalid());
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    for key in &value.capability_requirements {
        let Some((name, version)) = key.rsplit_once('@') else {
            return Err(invalid());
        };
        if name.is_empty() || version.trim().is_empty() || !seen.insert(key) {
            return Err(invalid());
        }
    }
    // 递归排序键使 hash 不依赖 serde_json 的 Map feature；只含 requested 内容，
    // 不含 owner、安装、runtime state 或当前用量。
    let normalized = canonical(serde_json::to_value(value).map_err(|_| invalid())?);
    let canonical = serde_json::to_vec(&normalized).map_err(|_| invalid())?;
    let digest = hex::encode(Sha256::digest(canonical));
    Ok((normalized, digest))
}

pub(crate) fn canonical(value: Value) -> Value {
    match value {
        Value::Object(fields) => {
            let mut keys: Vec<_> = fields.into_iter().collect();
            keys.sort_by(|a, b| a.0.cmp(&b.0));
            Value::Object(
                keys.into_iter()
                    .map(|(key, value)| (key, canonical(value)))
                    .collect(),
            )
        }
        Value::Array(values) => Value::Array(values.into_iter().map(canonical).collect()),
        value => value,
    }
}

/// 同一受控 release 文件供启动与发布读取；不登记或激活 profile。
pub(crate) fn runtime_profile_directory() -> Result<contracts::RuntimeProfileDirectory, Refusal> {
    let path = std::env::var("AGENT_RUNTIME_PROFILES_FILE")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    let path = std::path::Path::new(&path);
    if !path.is_absolute()
        || !path.is_file()
        || path
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(Refusal::Unavailable(
            "RuntimeProfile Catalog 路径无效".into(),
        ));
    }
    let bytes = std::fs::read(path)
        .map_err(|_| Refusal::Unavailable("RuntimeProfile Catalog 不可读".into()))?;
    let source: Value = serde_json::from_slice(&bytes)
        .map_err(|_| Refusal::Unavailable("RuntimeProfile Catalog 不符合共享契约".into()))?;
    let directory: contracts::RuntimeProfileDirectory = serde_json::from_value(source.clone())
        .map_err(|_| Refusal::Unavailable("RuntimeProfile Catalog 不符合共享契约".into()))?;
    // 生成类型的原样回写须与输入相等；可选映射缺省由原生成器 skipNone
    // 保持缺席，不填 null/default，也不能把缺映射当支持。
    // 不另列字段表，但不能把 serde 静默丢弃的未知配置键当作合法投递。
    if serde_json::to_value(&directory)
        .map_err(|_| Refusal::Unavailable("RuntimeProfile Catalog 不符合共享契约".into()))?
        != source
    {
        return Err(Refusal::Unavailable(
            "RuntimeProfile Catalog 含共享契约外字段".into(),
        ));
    }
    let mut keys = std::collections::HashSet::new();
    if directory
        .profiles
        .iter()
        .any(|p| p.key.trim().is_empty() || !keys.insert(&p.key))
    {
        return Err(Refusal::Unavailable(
            "RuntimeProfile Catalog 的 key 不唯一".into(),
        ));
    }
    for profile in &directory.profiles {
        reply_policy_contract(&profile.capability_contract, None)?;
    }
    Ok(directory)
}

/// 同一发布合同的纯映射裁决；旧目录可以没有映射，但不能据此执行策略。
pub(crate) fn reply_policy_contract(
    contract: &contracts::FluffyCapabilityContract,
    selected: Option<&str>,
) -> Result<(), Refusal> {
    let mut policy_keys = std::collections::HashSet::new();
    let mut mapping_keys = std::collections::HashSet::new();
    if contract
        .reply_policies
        .iter()
        .any(|key| key.trim().is_empty() || !policy_keys.insert(key.as_str()))
        || contract
            .reply_policy_mappings
            .as_deref()
            .into_iter()
            .flatten()
            .any(|mapping| {
                !policy_keys.contains(mapping.key.as_str())
                    || !mapping_keys.insert(mapping.key.as_str())
            })
    {
        return Err(Refusal::Unavailable(
            "RuntimeProfile 回复策略键或原生映射不唯一/未登记".into(),
        ));
    }
    let Some(key) = selected else {
        return Ok(());
    };
    if !policy_keys.contains(key) {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let mapping = contract
        .reply_policy_mappings
        .as_deref()
        .and_then(|mappings| mappings.iter().find(|mapping| mapping.key == key))
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    // Exactly one native delivery mode: ordinary triggers use their Thread;
    // DD-107 Schedule uses the Workspace Channel. Neither BOTH nor NONE can
    // borrow a different consumer or an opaque policy key.
    if mapping.thread_replies == mapping.broadcast_replies {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    Ok(())
}

pub(crate) fn reply_to_channel(value: &AgentVersionContent) -> Result<bool, Refusal> {
    runtime_profile(value)?;
    let directory = runtime_profile_directory()?;
    let profile = directory
        .profiles
        .iter()
        .find(|p| p.key == value.runtime_profile_key)
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    reply_policy_contract(&profile.capability_contract, Some(&value.reply_policy))?;
    let mapping = profile
        .capability_contract
        .reply_policy_mappings
        .as_deref()
        .and_then(|items| items.iter().find(|m| m.key == value.reply_policy))
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    Ok(mapping.broadcast_replies)
}

/// 发布只消费已投递合同，profile 的 ACTIVE 不能从 runtime spawn 推导。
pub(crate) fn runtime_profile(value: &AgentVersionContent) -> Result<(), Refusal> {
    let directory = runtime_profile_directory()?;
    let profile = directory
        .profiles
        .iter()
        .find(|p| p.key == value.runtime_profile_key)
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    let c = &profile.capability_contract;
    if profile.kind != contracts::RuntimeProfileKind::ServerCodex
        || profile.status != "ACTIVE"
        || profile.web_availability != "ENABLED"
        || c.max_parallelism <= 0
        || c.max_idle_timeout_seconds <= 0
        || c.max_turn_duration_seconds <= 0
        || value.parallelism > c.max_parallelism
        || value.turn_limits.idle_timeout_seconds > c.max_idle_timeout_seconds
        || value.turn_limits.max_turn_duration_seconds > c.max_turn_duration_seconds
        || value
            .capability_requirements
            .iter()
            .any(|r| !c.capability_requirements.contains(r))
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    reply_policy_contract(c, Some(&value.reply_policy))
}

/// 引用只声明 requested；引用存在与 fresh read 不把 execute 权限送给未来 Installation。
pub(crate) async fn validate_references(
    gov: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    human: Uuid,
    value: &AgentVersionContent,
) -> Result<(), Refusal> {
    runtime_profile(value)?;
    let route = Uuid::parse_str(&value.model_route_resource_id).map_err(|_| invalid())?;
    if !value.skill_version_asset_ids.is_empty() {
        // Skill 尚无真实 producer；Tool 仅引用受控、受权的原生目录。
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    for tool in &value.declared_tool_resource_ids {
        let tool = Uuid::parse_str(tool).map_err(|_| invalid())?;
        crate::agent_tool::validate_reference(gov, conn, tenant, human, tool).await?;
    }
    crate::model_route::validate_reference(gov, conn, tenant, human, route).await
}

pub(crate) async fn prewrite(
    gov: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    sem: Semantic,
    p: &Params,
) -> Result<Vec<crate::audit::Evidence>, Refusal> {
    let resource_id = p.resource_id.ok_or_else(invalid)?;
    let parent = crate::agent_definition::resource(tx, ae.tenant_id, resource_id, true)
        .await?
        .filter(|r| r.state == "ACTIVE" && r.projection_action_execution_id.is_none())
        .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    if !crate::agent_definition::active_owner(tx, ae.tenant_id, ae.initiator_principal_id).await?
        || !crate::agent_definition::active_owner(tx, ae.tenant_id, parent.owner_principal_id)
            .await?
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    match sem {
        Semantic::AgentVersionCreate => {
            let requested = p.agent_version_content.as_ref().ok_or_else(invalid)?;
            let (normalized, digest) = content(requested)?;
            validate_references(gov, tx, ae.tenant_id, ae.initiator_principal_id, requested)
                .await?;
            let ordinal: i32 = sqlx::query_scalar(
                "select coalesce(max(ordinal),0)+1 from catalog.agent_version where agent_resource_id=$1")
                .bind(parent.id).fetch_one(&mut **tx).await?;
            sqlx::query("insert into catalog.asset
                (id,tenant_id,resource_id,type_key,owner_principal_id,producer_principal_id,native_ref,state,version,projection_action_execution_id)
                values ($1,$2,$3,'agent.version',$4,$4,$1::text,'DRAFT',1,$5)")
                .bind(ae.id).bind(ae.tenant_id).bind(parent.id).bind(ae.initiator_principal_id)
                .bind(ae.id).execute(&mut **tx).await?;
            sqlx::query("insert into catalog.agent_version
                (asset_id,agent_resource_id,ordinal,content,config_hash,state) values ($1,$2,$3,$4,$5,'DRAFT')")
                .bind(ae.id).bind(parent.id).bind(ordinal).bind(normalized).bind(digest)
                .execute(&mut **tx).await?;
            Ok(Vec::new())
        }
        Semantic::AgentVersionUpdate | Semantic::AgentVersionPublish => {
            let v = version(tx, ae.tenant_id, ae.target_id, true)
                .await?
                .filter(|v| {
                    v.agent_resource_id == parent.id
                        && v.state == "DRAFT"
                        && v.asset_state == "DRAFT"
                        && v.projection_action_execution_id.is_none()
                })
                .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
            if !crate::agent_definition::active_owner(tx, ae.tenant_id, v.owner_principal_id)
                .await?
            {
                return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
            }
            if !projection_matches(gov, &v).await? {
                return Err(Refusal::Unavailable("Asset 权限投影不一致".into()));
            }
            let requested = match sem {
                Semantic::AgentVersionUpdate => {
                    p.agent_version_content.clone().ok_or_else(invalid)?
                }
                _ => serde_json::from_value(v.content.clone()).map_err(|_| invalid())?,
            };
            let (normalized, digest) = content(&requested)?;
            validate_references(gov, tx, ae.tenant_id, ae.initiator_principal_id, &requested)
                .await?;
            if sem == Semantic::AgentVersionPublish && digest != v.config_hash {
                return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
            }
            sqlx::query("update catalog.agent_version set content=$2,config_hash=$3,
                state=case when $4 then 'PUBLISHED' else state end where asset_id=$1 and state='DRAFT'")
                .bind(v.asset_id).bind(normalized).bind(digest).bind(sem == Semantic::AgentVersionPublish)
                .execute(&mut **tx).await?;
            sqlx::query(
                "update catalog.asset set version=version+1,
                state=case when $2 then 'PUBLISHED' else state end where id=$1",
            )
            .bind(v.asset_id)
            .bind(sem == Semantic::AgentVersionPublish)
            .execute(&mut **tx)
            .await?;
            if sem == Semantic::AgentVersionPublish {
                sqlx::query("update catalog.agent_definition set current_published_version_asset_id=$2 where resource_id=$1")
                    .bind(parent.id).bind(v.asset_id).execute(&mut **tx).await?;
                sqlx::query("update catalog.resource set version=version+1 where id=$1")
                    .bind(parent.id)
                    .execute(&mut **tx)
                    .await?;
            }
            Ok(Vec::new())
        }
        Semantic::AgentVersionRetire => {
            let v = version(tx, ae.tenant_id, ae.target_id, true)
                .await?
                .filter(|v| {
                    v.agent_resource_id == parent.id
                        && v.state == "PUBLISHED"
                        && v.asset_state == "PUBLISHED"
                        && p.asset_version == Some(v.version)
                        && v.projection_action_execution_id.is_none()
                })
                .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
            if !crate::agent_definition::active_owner(tx, ae.tenant_id, v.owner_principal_id)
                .await?
            {
                return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
            }
            if !projection_matches(gov, &v).await? {
                return Err(Refusal::Unavailable("Asset 权限投影不一致".into()));
            }
            // Retire only closes new installation selection. It does not revalidate
            // configuration providers or rewrite existing pins, content or evidence.
            let cleared = sqlx::query(
                "update catalog.agent_definition
                set current_published_version_asset_id=null
                where resource_id=$1 and current_published_version_asset_id=$2",
            )
            .bind(parent.id)
            .bind(v.asset_id)
            .execute(&mut **tx)
            .await?;
            if cleared.rows_affected() == 1 {
                sqlx::query("update catalog.resource set version=version+1 where id=$1")
                    .bind(parent.id)
                    .execute(&mut **tx)
                    .await?;
            }
            let retired = sqlx::query(
                "update catalog.agent_version set state='RETIRED'
                where asset_id=$1 and state='PUBLISHED'",
            )
            .bind(v.asset_id)
            .execute(&mut **tx)
            .await?;
            let asset = sqlx::query(
                "update catalog.asset set state='RETIRED',version=version+1
                where id=$1 and version=$2 and state='PUBLISHED'",
            )
            .bind(v.asset_id)
            .bind(v.version)
            .execute(&mut **tx)
            .await?;
            if retired.rows_affected() != 1 || asset.rows_affected() != 1 {
                return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
            }
            Ok(Vec::new())
        }
        _ => Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)),
    }
}

pub(crate) async fn projection_matches(gov: &Governance, v: &Version) -> Result<bool, Refusal> {
    gov.spicedb
        .asset_projection_matches(
            &v.asset_id.to_string(),
            &v.tenant_id.to_string(),
            &v.agent_resource_id.to_string(),
            &v.owner_principal_id.to_string(),
            gov.cfg.relationship_page,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()))
}

pub(crate) async fn dispatch(gov: &Governance, id: Uuid, def: &Definition) -> Result<(), Refusal> {
    let mut tx = gov.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, id).await?;
    if ae.gate_state != "ALLOWED"
        || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
    {
        return Ok(());
    }
    let active = sqlx::query_scalar::<_, bool>(
        "select state='ACTIVE' from identity.tenant where id=$1 for update",
    )
    .bind(ae.tenant_id)
    .fetch_optional(&mut *tx)
    .await?
    .unwrap_or(false);
    // 创建 target 是已存在的父 Resource（create Check）；Asset 以同一预写 AE 的 UUID 固定。
    let v = version(&mut tx, ae.tenant_id, ae.id, true)
        .await?
        .filter(|v| v.projection_action_execution_id == Some(ae.id))
        .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    let parent =
        crate::agent_definition::resource(&mut tx, ae.tenant_id, v.agent_resource_id, true).await?;
    let parent_active = match parent.as_ref() {
        Some(r) if r.state == "ACTIVE" && r.projection_action_execution_id.is_none() => {
            crate::agent_definition::active_owner(&mut tx, ae.tenant_id, r.owner_principal_id)
                .await?
        }
        _ => false,
    };
    let valid = active
        && parent_active
        && crate::agent_definition::active_owner(&mut tx, ae.tenant_id, v.owner_principal_id)
            .await?;
    let matched = if valid {
        let r = parent
            .as_ref()
            .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
        match crate::agent_definition::projection_matches(
            gov,
            r.id,
            r.tenant_id,
            r.owner_principal_id,
        )
        .await
        {
            Ok(true) => {}
            _ => return unknown(tx, &ae, def).await,
        }
        match projection_matches(gov, &v).await {
            Ok(matched) => matched,
            Err(_) => return unknown(tx, &ae, def).await,
        }
    } else {
        false
    };
    let result = if !valid
        || (!matched
            && parent
                .as_ref()
                .is_none_or(|r| Some(r.version) != ae.frozen_target_version()))
    {
        // 可能已经写入的投影先原生删除+空集合查证，再 ABORTED；不把未知写当从未发生。
        gov.spicedb
            .delete_asset_projection(v.asset_id)
            .await
            .map(|t| (false, t))
    } else {
        match matched {
            false => {
                let checked = gov
                    .spicedb
                    .check(
                        "resource",
                        &v.agent_resource_id.to_string(),
                        "create",
                        &ae.initiator_principal_id.to_string(),
                        Consistency::FullyConsistent,
                    )
                    .await;
                match checked {
                    Err(_) => return unknown(tx, &ae, def).await,
                    Ok(c) if !c.allowed => gov
                        .spicedb
                        .delete_asset_projection(v.asset_id)
                        .await
                        .map(|t| (false, t)),
                    Ok(_) => {
                        if gov
                            .spicedb
                            .write_asset_projection(
                                &v.asset_id.to_string(),
                                &v.tenant_id.to_string(),
                                &v.agent_resource_id.to_string(),
                                &v.owner_principal_id.to_string(),
                            )
                            .await
                            .is_err()
                        {
                            return unknown(tx, &ae, def).await;
                        }
                        match projection_matches(gov, &v).await {
                            Ok(true) => observed(gov, &v).await.map(|t| (true, t)),
                            _ => return unknown(tx, &ae, def).await,
                        }
                    }
                }
            }
            true => observed(gov, &v).await.map(|t| (true, t)),
        }
    };
    let (created, token) = match result {
        Ok((created, token)) if !token.is_empty() => (created, token),
        _ => return unknown(tx, &ae, def).await,
    };
    sqlx::query(
        "update catalog.asset set projection_action_execution_id=null,
        state=case when $2 then state else 'DELETED' end,version=version+1 where id=$1",
    )
    .bind(v.asset_id)
    .bind(created)
    .execute(&mut *tx)
    .await?;
    crate::governance::record_dispatch(
        &mut tx,
        ae.id,
        def.audit_class(),
        if created {
            Ok(())
        } else {
            Err(StatusCode::FORBIDDEN)
        },
        vec![crate::audit::Evidence::new(
            contracts::EvidenceKind::SpicedbZedtoken,
            token,
        )],
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

async fn observed(gov: &Governance, v: &Version) -> Result<String, crate::spicedb::SpiceDbError> {
    gov.spicedb
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
                    "Asset owner 查证不一致".into(),
                ))
            }
        })
}

async fn unknown(
    mut tx: Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
) -> Result<(), Refusal> {
    crate::governance::record_dispatch(
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

pub async fn get(
    axum::extract::State(state): axum::extract::State<crate::bff::BffState>,
    headers: axum::http::HeaderMap,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> axum::response::Response {
    let ctx = match crate::bff::resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    let mut conn = match state.pool.acquire().await {
        Ok(c) => c,
        Err(e) => return crate::service_api::unavailable(e),
    };
    match read(&state, &ctx, &mut conn, id).await {
        Ok(view) => Json(view).into_response(),
        Err(response) => response,
    }
}

/// 目录与 exact GET 复用同一状态、投影、fresh read 与内容 hash 查证。
pub(crate) async fn read(
    state: &crate::bff::BffState,
    ctx: &crate::bff::ExecutionContext,
    conn: &mut PgConnection,
    id: Uuid,
) -> Result<contracts::AgentVersionView, axum::response::Response> {
    let v = match version(conn, ctx.tenant_id, id, false).await {
        Ok(Some(v))
            if v.projection_action_execution_id.is_none()
                && matches!(v.asset_state.as_str(), "DRAFT" | "PUBLISHED" | "RETIRED") =>
        {
            v
        }
        Ok(_) => return Err(StatusCode::NOT_FOUND.into_response()),
        Err(e) => return Err(crate::service_api::unavailable(e)),
    };
    if v.asset_state != v.state {
        return Err(Refusal::Unavailable("Asset 与 Version 状态不一致".into()).respond(None));
    }
    let parent =
        match crate::agent_definition::resource(conn, ctx.tenant_id, v.agent_resource_id, false)
            .await
        {
            Ok(Some(r)) if r.state == "ACTIVE" && r.projection_action_execution_id.is_none() => r,
            Ok(_) => return Err(StatusCode::NOT_FOUND.into_response()),
            Err(e) => return Err(crate::service_api::unavailable(e)),
        };
    match crate::agent_definition::projection_matches(
        &state.governance,
        parent.id,
        parent.tenant_id,
        parent.owner_principal_id,
    )
    .await
    {
        Ok(true) => {}
        Ok(false) => {
            return Err(Refusal::Unavailable("父 Resource 投影不一致".into()).respond(None))
        }
        Err(e) => return Err(e.respond(None)),
    }
    match projection_matches(&state.governance, &v).await {
        Ok(true) => {}
        Ok(false) => return Err(Refusal::Unavailable("Asset 投影不一致".into()).respond(None)),
        Err(e) => return Err(e.respond(None)),
    }
    match state
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
    {
        Ok(c) if c.zed_token.is_empty() => {
            return Err(
                Refusal::Unavailable("Version read 缺原生 checked revision".into()).respond(None),
            );
        }
        Ok(c) if c.allowed => {}
        Ok(_) => return Err(StatusCode::FORBIDDEN.into_response()),
        Err(e) => return Err(Refusal::Unavailable(e.to_string()).respond(None)),
    }
    let (can_update, can_publish, can_retire) =
        crate::agent_version_query::version_permissions(state, ctx, conn, &v, &parent).await?;
    let content: AgentVersionContent = match serde_json::from_value(v.content) {
        Ok(c) => c,
        Err(_) => return Err(StatusCode::SERVICE_UNAVAILABLE.into_response()),
    };
    if !self::content(&content).is_ok_and(|(_, hash)| hash == v.config_hash) {
        return Err(Refusal::Unavailable("AgentVersion config_hash 不一致".into()).respond(None));
    }
    let state = match v.state.as_str() {
        "DRAFT" => contracts::AgentVersionState::Draft,
        "PUBLISHED" => contracts::AgentVersionState::Published,
        "RETIRED" => contracts::AgentVersionState::Retired,
        _ => return Err(StatusCode::SERVICE_UNAVAILABLE.into_response()),
    };
    Ok(contracts::AgentVersionView {
        asset_id: v.asset_id.to_string(),
        agent_resource_id: v.agent_resource_id.to_string(),
        ordinal: i64::from(v.ordinal),
        asset_version: i64::from(v.version),
        owner_principal_id: v.owner_principal_id.to_string(),
        content,
        config_hash: v.config_hash,
        state,
        can_update: Some(can_update),
        can_publish: Some(can_publish),
        can_retire: Some(can_retire),
    })
}

#[cfg(test)]
mod reply_policy_tests {
    use super::reply_policy_contract;
    use serde_json::{json, Value};

    #[test]
    fn absent_mapping_preserves_old_contract_but_never_supports_a_policy() {
        let original = json!({
            "capabilityRequirements": [],
            "replyPolicies": ["registered"],
            "maxParallelism": 1,
            "maxIdleTimeoutSeconds": 1,
            "maxTurnDurationSeconds": 1
        });
        let contract: contracts::FluffyCapabilityContract =
            serde_json::from_value(original.clone()).expect("old capability contract parses");
        assert!(contract.reply_policy_mappings.is_none());
        assert_eq!(serde_json::to_value(&contract).unwrap(), original);
        assert!(reply_policy_contract(&contract, None).is_ok());
        assert!(reply_policy_contract(&contract, Some("registered")).is_err());
    }

    #[test]
    fn only_exact_registered_exclusive_reply_mapping_is_supported() {
        for (thread, broadcast, supported) in [
            (false, false, false),
            (false, true, true),
            (true, false, true),
            (true, true, false),
        ] {
            let contract: contracts::FluffyCapabilityContract = serde_json::from_value(json!({
                "capabilityRequirements": [],
                "replyPolicies": ["registered"],
                "replyPolicyMappings": [{
                    "key": "registered",
                    "threadReplies": thread,
                    "broadcastReplies": broadcast
                }],
                "maxParallelism": 1,
                "maxIdleTimeoutSeconds": 1,
                "maxTurnDurationSeconds": 1
            }))
            .unwrap();
            assert_eq!(
                reply_policy_contract(&contract, Some("registered")).is_ok(),
                supported,
                "thread={thread}, broadcast={broadcast}"
            );
            assert!(reply_policy_contract(&contract, Some("REGISTERED")).is_err());
            assert!(reply_policy_contract(&contract, Some("unknown")).is_err());
        }
    }

    #[test]
    fn duplicate_unknown_blank_or_missing_mapping_keys_are_rejected() {
        let original = json!({
            "capabilityRequirements": [],
            "replyPolicies": ["registered"],
            "replyPolicyMappings": [{
                "key": "registered", "threadReplies": true, "broadcastReplies": false
            }],
            "maxParallelism": 1,
            "maxIdleTimeoutSeconds": 1,
            "maxTurnDurationSeconds": 1
        });
        let mut duplicate_policy = original.clone();
        duplicate_policy["replyPolicies"] = json!(["registered", "registered"]);
        let mut duplicate_mapping = original.clone();
        duplicate_mapping["replyPolicyMappings"]
            .as_array_mut()
            .unwrap()
            .push(original["replyPolicyMappings"][0].clone());
        let mut unknown_mapping = original.clone();
        unknown_mapping["replyPolicyMappings"][0]["key"] = json!("unknown");
        let mut blank_policy = original.clone();
        blank_policy["replyPolicies"] = json!([" "]);
        let mut empty_mapping = original;
        empty_mapping["replyPolicyMappings"] = json!([]);
        for value in [
            duplicate_policy,
            duplicate_mapping,
            unknown_mapping,
            blank_policy,
            empty_mapping,
        ] {
            let contract: contracts::FluffyCapabilityContract =
                serde_json::from_value(value).unwrap();
            assert!(reply_policy_contract(&contract, Some("registered")).is_err());
        }
    }

    #[test]
    fn native_boolean_fields_are_explicit_and_absence_is_not_a_default() {
        let original = json!({
            "capabilityRequirements": [],
            "replyPolicies": ["registered"],
            "replyPolicyMappings": [{
                "key": "registered", "threadReplies": true, "broadcastReplies": false
            }],
            "maxParallelism": 1,
            "maxIdleTimeoutSeconds": 1,
            "maxTurnDurationSeconds": 1
        });
        for field in ["threadReplies", "broadcastReplies"] {
            let mut missing = original.clone();
            missing["replyPolicyMappings"][0]
                .as_object_mut()
                .unwrap()
                .remove(field);
            assert!(
                serde_json::from_value::<contracts::FluffyCapabilityContract>(missing).is_err()
            );
        }
        let mut null_mapping = original;
        null_mapping["replyPolicyMappings"] = Value::Null;
        let parsed: contracts::FluffyCapabilityContract =
            serde_json::from_value(null_mapping.clone()).unwrap();
        // Optional None serializes as absence; the production strict roundtrip
        // therefore rejects explicit null instead of treating it as old syntax.
        assert_ne!(serde_json::to_value(parsed).unwrap(), null_mapping);
    }
}
