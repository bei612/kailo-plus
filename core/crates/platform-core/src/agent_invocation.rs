//! 03 §4/§7、12 §6、17 §2/§7：普通 HUMAN mention/manual 的同一受治理执行链。
//! Relay 是消息权威；本模块只固定引用，不生成 Grant、meter 或业务权限。

use contracts::{AgentTaskWorkflowInput, ReasonCode};
use nostr::Event;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    automation::RuntimeScope,
    governance::{self, Actor, Definition, Governance, Refusal, Target},
    service_api::ServiceState,
    spicedb::Consistency,
};

pub(crate) const ACTION: &str = "agent.invoke";

fn meters() -> Result<Option<Vec<String>>, String> {
    let raw = match std::env::var("AGENT_INVOKE_METERS_JSON") {
        Err(std::env::VarError::NotPresent) => return Ok(None),
        Ok(raw) if raw.is_empty() => return Ok(None),
        Ok(raw) => raw,
        Err(_) => return Err("AGENT_INVOKE_METERS_JSON 非 Unicode".into()),
    };
    parse_meters(&raw).map(Some)
}

fn parse_meters(raw: &str) -> Result<Vec<String>, String> {
    let mut keys: Vec<String> = serde_json::from_str(raw)
        .map_err(|_| "AGENT_INVOKE_METERS_JSON 必须为真实模型 meter key 数组")?;
    if keys.is_empty()
        || keys.iter().any(|key| {
            key.trim().is_empty() || key.trim() != key || key == "automation.run" || key == ACTION
        })
    {
        return Err("agent.invoke 只接受非空真实模型 meter 集合，不登记调用计数".into());
    }
    keys.sort();
    if keys.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err("agent.invoke meter 不得重复".into());
    }
    Ok(keys)
}

pub(crate) async fn register(g: &Governance) -> Result<(), String> {
    if !crate::capability_registry::action_exposed(ACTION) {
        return Ok(());
    }
    let Some(keys) = meters()? else {
        return Ok(());
    };
    let pool = std::env::var("AGENT_CAPACITY_POOL_KEY")
        .ok()
        .filter(|key| !key.trim().is_empty() && key.trim() == key)
        .ok_or("agent.invoke 缺少 AGENT_CAPACITY_POOL_KEY")?;
    let mut tx = g.pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "insert into catalog.action_definition
        (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
         permission,permission_object_type,execution_mode,confirmation_mode,
         workflow_type,capacity_policy,capacity_pool_key,quota_policy,meters,
         result_exposure,audit_policy,obs_correlation_mode,obs_progress_source,
         obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
        select $1,1,'core','RESOURCE','SESSION_TENANT','TARGET_HOME_WORKSPACE',
          'execute','resource','TEMPORAL','NONE',$2,'PLATFORM_SLOT',$3,'CHECK',$4,
          'NONE','FULL_LIFECYCLE','OPERATION_REF','TEMPORAL','TEMPORAL','OPENMETER',
          'NONE','PLATFORM_METADATA_ONLY','ACTIVE'
        where not exists(select 1 from catalog.action_definition where action_key=$1)
        on conflict do nothing",
    )
    .bind(ACTION)
    .bind(crate::agent_task::WORKFLOW_TYPE)
    .bind(pool)
    .bind(keys)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("agent.invoke 登记失败: {e}"))?;
    let installations: Vec<(Uuid,Uuid,i64)> = sqlx::query_as("select r.tenant_id,i.resource_id,i.active_projection_generation
        from catalog.agent_installation i join catalog.resource r on r.id=i.resource_id
        join catalog.channel_agent_binding cb on cb.installation_resource_id=i.resource_id and cb.status='ACTIVE'
        where i.state='ACTIVE' and r.state='ACTIVE' and 'MENTION'=any(cb.triggers)")
        .fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
    for (tenant, id, generation) in installations {
        initialize_ingress(&mut tx, tenant, id, generation)
            .await
            .map_err(|e| format!("agent.invoke 起点登记失败: {e:?}"))?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    definition(g)
        .await
        .map_err(|_| "agent.invoke 已冻结策略与配置不一致".into())
        .map(|_| ())
}

async fn definition(g: &Governance) -> Result<Definition, Refusal> {
    if !crate::capability_registry::action_exposed(ACTION) {
        return Err(blocked());
    }
    let keys = meters().map_err(|_| blocked())?.ok_or_else(blocked)?;
    let def = governance::active_definition(&g.pool, ACTION)
        .await?
        .ok_or_else(blocked)?;
    let pool = std::env::var("AGENT_CAPACITY_POOL_KEY").map_err(|_| blocked())?;
    let exact: bool = sqlx::query_scalar("select exists(select 1 from catalog.action_definition
        where action_key=$1 and version=$2 and status='ACTIVE' and component_type_key='core'
          and target_type='RESOURCE' and tenant_rule='SESSION_TENANT' and workspace_rule='TARGET_HOME_WORKSPACE'
          and permission='execute' and permission_object_type='resource'
          and execution_mode='TEMPORAL' and confirmation_mode='NONE'
          and approval_policy_id is null and approval_policy_version is null
          and workflow_type=$3 and workflow_kind is null and capacity_policy='PLATFORM_SLOT'
          and capacity_pool_key=$4 and quota_policy='CHECK' and meters=$5
          and result_exposure='NONE' and audit_policy='FULL_LIFECYCLE'
          and obs_correlation_mode='OPERATION_REF' and obs_progress_source='TEMPORAL'
          and obs_terminal_source='TEMPORAL' and obs_usage_source='OPENMETER'
          and obs_cost_source='NONE' and obs_redaction_policy='PLATFORM_METADATA_ONLY'
          and role_template_key is null and role_template_version is null)")
        .bind(ACTION).bind(def.version).bind(crate::agent_task::WORKFLOW_TYPE).bind(pool).bind(keys)
        .fetch_one(&g.pool).await?;
    if !exact {
        return Err(blocked());
    }
    Ok(def)
}

fn blocked() -> Refusal {
    Refusal::Blocked(ReasonCode::CapabilityBlocked)
}
fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}
fn denied() -> Refusal {
    Refusal::Denied(ReasonCode::PermissionDenied)
}

#[derive(FromRow)]
struct Installation {
    id: Uuid,
    tenant_id: Uuid,
    workspace_id: Uuid,
    version: i32,
    agent_principal_id: Uuid,
    agent_version_asset_id: Uuid,
    projection_generation: i64,
    agent_pubkey: String,
    channel_id: Uuid,
    triggers: Vec<String>,
}

const INSTALLATION: &str = "select r.id,r.tenant_id,i.workspace_id,r.version,i.agent_principal_id,
    p.agent_version_asset_id,p.generation projection_generation,b.pubkey agent_pubkey,
    wb.channel_id,cb.triggers
    from catalog.resource r join catalog.agent_installation i on i.resource_id=r.id
    join identity.tenant t on t.id=r.tenant_id and t.state='ACTIVE'
    join identity.workspace w on w.id=i.workspace_id and w.tenant_id=t.id and w.state='ACTIVE'
    join identity.principal a on a.id=i.agent_principal_id and a.tenant_id=t.id and a.kind='AGENT' and a.status='ACTIVE'
    join catalog.agent_runtime_projection p on p.installation_resource_id=r.id
      and p.generation=coalesce($3::bigint,i.active_projection_generation)
      and p.agent_version_asset_id=coalesce($2::uuid,i.pinned_version_asset_id) and p.state='ACTIVE'
    join catalog.channel_agent_binding cb on cb.installation_resource_id=r.id and cb.workspace_id=w.id and cb.status='ACTIVE'
    join identity.buzz_identity_binding b on b.principal_id=a.id and b.tenant_id=t.id and b.kind='AGENT' and b.state='ACTIVE'
    join projection.workspace_buzz_binding wb on wb.workspace_id=w.id and wb.state='ACTIVE'
    where r.id=$1 and r.type_key='agent.installation' and r.home_workspace_id=w.id
      and r.state='ACTIVE' and r.projection_action_execution_id is null and i.state='ACTIVE'";

impl Installation {
    fn scope(&self, human: Uuid) -> RuntimeScope {
        RuntimeScope {
            tenant_id: self.tenant_id,
            workspace_id: self.workspace_id,
            executor_installation_resource_id: self.id,
            agent_version_asset_id: self.agent_version_asset_id,
            projection_generation: self.projection_generation,
            owner_principal_id: human,
            agent_principal_id: self.agent_principal_id,
        }
    }
}

async fn installation(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
) -> Result<Installation, Refusal> {
    installation_at(tx, id, None).await
}

async fn installation_at(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    frozen: Option<(Uuid, i64)>,
) -> Result<Installation, Refusal> {
    sqlx::query_as(&format!("{INSTALLATION} for update of r,i,w,a,p,cb,b,wb"))
        .bind(id)
        .bind(frozen.map(|v| v.0))
        .bind(frozen.map(|v| v.1))
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(conflict)
}

fn root(event: &Event) -> String {
    collab_bridge::nip10::parse_thread_markers(&event.tags)
        .resolve()
        .map(|(root, _)| root)
        .unwrap_or_else(|| event.id.to_hex())
}

fn valid_thread_markers(event: &Event) -> bool {
    let mut seen = std::collections::HashSet::new();
    event.tags.iter().map(nostr::Tag::as_slice).all(|tag| {
        if tag.first().map(String::as_str) != Some("e")
            || !matches!(tag.get(3).map(String::as_str), Some("root" | "reply"))
        {
            return true;
        }
        tag.get(1).is_some_and(|id| {
            id.len() == 64
                && id
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        }) && seen.insert(tag[3].as_str())
    })
}

fn matches_source(row: &Installation, event: &Event, trigger: &str) -> bool {
    let channel = row.channel_id.to_string();
    let channels: Vec<_> = event
        .tags
        .iter()
        .map(nostr::Tag::as_slice)
        .filter(|tag| tag.first().map(String::as_str) == Some("h"))
        .filter_map(|tag| tag.get(1).map(String::as_str))
        .collect();
    event.verify().is_ok()
        && event.kind.as_u16() == 9
        && valid_thread_markers(event)
        && event
            .tags
            .iter()
            .filter(|tag| tag.as_slice().first().map(String::as_str) == Some("h"))
            .count()
            == 1
        && channels.as_slice() == [channel.as_str()]
        && row.triggers.iter().any(|value| value == trigger)
        && match trigger {
            "MENTION" => event.tags.iter().map(nostr::Tag::as_slice).any(|tag| {
                tag.first().map(String::as_str) == Some("p")
                    && tag.get(1) == Some(&row.agent_pubkey)
            }),
            "MANUAL_ASSIGNMENT" => true,
            _ => false,
        }
}

/// Grant 行锁保护撤销/用量；原 HUMAN/Agent/Installation/Action scope 均精确求交。
#[allow(clippy::too_many_arguments)]
async fn fresh(
    state: &ServiceState,
    tx: &mut Transaction<'_, Postgres>,
    row: &Installation,
    human: Uuid,
    pubkey: &str,
    grant: Uuid,
    def: &Definition,
    operation: Option<Uuid>,
) -> Result<String, Refusal> {
    let scope = row.scope(human);
    crate::automation::source_human(&state.governance, tx, &scope, human, pubkey).await?;
    let max: Option<Option<i64>> = sqlx::query_scalar(
        "select max_uses from admission.delegation_grant
        where id=$1 and tenant_id=$2 and workspace_id=$3 and grantor_principal_id=$4
          and installation_resource_id=$5 and agent_principal_id=$6 and state='ACTIVE'
          and valid_from<=clock_timestamp() and expires_at>clock_timestamp() for update",
    )
    .bind(grant)
    .bind(row.tenant_id)
    .bind(row.workspace_id)
    .bind(human)
    .bind(row.id)
    .bind(row.agent_principal_id)
    .fetch_optional(&mut **tx)
    .await?;
    let max = max.ok_or_else(denied)?;
    let valid: bool = sqlx::query_scalar("select exists(select 1 from admission.delegation_scope s
        join catalog.result_exposure_policy p on p.id=s.result_exposure_policy_id and p.version=s.result_exposure_policy_version
        where s.delegation_id=$1 and s.action_key=$2 and s.action_version=$3 and s.target_type='RESOURCE'
          and s.target_id=$4 and s.create_workspace_id is null and s.tool_resource_id is null
          and p.tenant_id=$5 and p.status='ACTIVE' and p.mode='CONSUME_ONLY'
          and p.output_schema_hash=$6 and p.redaction_policy='PLATFORM_METADATA_ONLY')")
        .bind(grant).bind(ACTION).bind(def.version).bind(row.id).bind(row.tenant_id)
        .bind(crate::governance::delegation::output_schema_hash()).fetch_one(&mut **tx).await?;
    if !valid {
        return Err(denied());
    }
    let used: bool = sqlx::query_scalar("select exists(select 1 from admission.delegation_use where delegation_id=$1 and operation_id=$2)")
        .bind(grant).bind(operation).fetch_one(&mut **tx).await?;
    let count: i64 =
        sqlx::query_scalar("select count(*) from admission.delegation_use where delegation_id=$1")
            .bind(grant)
            .fetch_one(&mut **tx)
            .await?;
    if !used && (max.is_some_and(|max| count >= max) || operation.is_some()) {
        return Err(denied());
    }
    crate::automation::fresh_runtime(state, tx, &scope).await?;
    let mut revision = None;
    for (principal, permission) in [
        (human, "execute"),
        (human, "delegate"),
        (row.agent_principal_id, "execute"),
    ] {
        let check = state
            .governance
            .spicedb
            .check(
                "resource",
                &row.id.to_string(),
                permission,
                &principal.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| Refusal::Unavailable("agent.invoke fresh permission 不可核验".into()))?;
        if !check.allowed {
            return Err(denied());
        }
        if check.zed_token.is_empty() {
            return Err(Refusal::Unavailable(
                "agent.invoke 缺 permission revision".into(),
            ));
        }
        revision = Some(check.zed_token);
    }
    state
        .governance
        .check_automation_quota(row.tenant_id, def)
        .await?;
    let live: bool = sqlx::query_scalar("select exists(select 1 from admission.delegation_grant
        where id=$1 and state='ACTIVE' and valid_from<=clock_timestamp() and expires_at>clock_timestamp())")
        .bind(grant).fetch_one(&mut **tx).await?;
    if !live {
        return Err(denied());
    }
    revision.ok_or_else(denied)
}

async fn action(tx: &mut Transaction<'_, Postgres>, invocation: Uuid) -> Result<String, Refusal> {
    sqlx::query_scalar("select a.action_key from catalog.agent_invocation i
        join admission.action_execution a on a.id=i.action_execution_id
        where i.id=$1 and a.tenant_id=i.tenant_id and a.workspace_id=i.workspace_id
          and ((a.action_key='agent.invoke' and i.automation_resource_id is null and i.automation_version_asset_id is null)
            or (a.action_key='automation.run' and i.automation_resource_id is not null and i.automation_version_asset_id is not null))")
        .bind(invocation).fetch_optional(&mut **tx).await?.ok_or_else(conflict)
}

pub(crate) async fn fresh_invocation(
    state: &ServiceState,
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
) -> Result<(), Refusal> {
    if action(tx, id).await? == "automation.run" {
        return crate::automation::fresh_invocation(state, tx, id).await;
    }
    recheck(state, tx, id, None, None, false).await.map(|_| ())
}

pub(crate) async fn fresh_reply(
    state: &ServiceState,
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    turn: &str,
    reply: Option<&str>,
) -> Result<String, Refusal> {
    if action(tx, id).await? == "automation.run" {
        return crate::automation::fresh_reply(state, tx, id, turn, reply).await;
    }
    if turn.is_empty() || reply.is_some_and(str::is_empty) {
        return Err(conflict());
    }
    recheck(state, tx, id, Some(turn), reply, false).await
}

/// Tool PEP reuses the admitted Invocation's exact frozen source/runtime/Grant.
/// A live native turn is neither a first-turn nor a completed-reply admission.
pub(crate) async fn fresh_tool(
    state: &ServiceState,
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    turn: &str,
) -> Result<String, Refusal> {
    if turn.is_empty() {
        return Err(conflict());
    }
    if action(tx, id).await? == "automation.run" {
        return crate::automation::fresh_tool(state, tx, id, turn).await;
    }
    recheck(state, tx, id, Some(turn), None, true).await
}

#[derive(FromRow)]
struct Frozen {
    installation_resource_id: Uuid,
    agent_version_asset_id: Uuid,
    projection_generation: i64,
    delegation_id: Uuid,
    action_execution_id: Uuid,
    source_event_id: String,
    root_event_id: String,
}

fn frozen_parameters_match(parameters: &Value, frozen: &Frozen, human: Uuid) -> bool {
    parameters.get("agentVersionAssetId") == Some(&json!(frozen.agent_version_asset_id))
        && parameters.get("projectionGeneration") == Some(&json!(frozen.projection_generation))
        && parameters.get("delegationId") == Some(&json!(frozen.delegation_id))
        && parameters.get("sourceEventId") == Some(&json!(frozen.source_event_id))
        && parameters.get("rootEventId") == Some(&json!(frozen.root_event_id))
        && parameters.get("sourcePrincipalId") == Some(&json!(human))
}

fn dispatch_rejection_is_certain(dispatch_state: &str, error: &Refusal) -> bool {
    dispatch_state == "NOT_DISPATCHED" && !matches!(error, Refusal::Unavailable(_))
}

fn manual_parameters_match(
    parameters: &Value,
    source: &str,
    grant: Uuid,
    version: Option<i64>,
) -> bool {
    parameters.get("sourceEventId") == Some(&json!(source))
        && parameters.get("delegationId") == Some(&json!(grant))
        && parameters.get("targetVersion") == Some(&json!(version))
}

async fn recheck(
    state: &ServiceState,
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    turn: Option<&str>,
    reply: Option<&str>,
    tool: bool,
) -> Result<String, Refusal> {
    let frozen: Frozen = sqlx::query_as("select installation_resource_id,agent_version_asset_id,
        projection_generation,delegation_id,action_execution_id,source_event_id,root_event_id
        from catalog.agent_invocation where id=$1 and automation_resource_id is null and not cancel_pending
          and ((not $4 and $2::text is null and status in ('CREATED','DISPATCHING') and runtime_turn_id is null)
            or (not $4 and $2::text is not null and status in ('RUNNING','UNKNOWN') and native_status='completed'
              and runtime_turn_id=$2 and reply_event_id is not distinct from $3::text)
            or ($4 and $3::text is null and status='RUNNING' and native_status='inProgress'
              and runtime_turn_id=$2 and reply_event_id is null)) for update")
        .bind(id).bind(turn).bind(reply).bind(tool).fetch_optional(&mut **tx).await?.ok_or_else(conflict)?;
    let ae = governance::lock_execution(tx, frozen.action_execution_id).await?;
    let row = installation_at(
        tx,
        frozen.installation_resource_id,
        Some((frozen.agent_version_asset_id, frozen.projection_generation)),
    )
    .await?;
    let def = definition(&state.governance).await?;
    let params = ae.parameters.as_ref().ok_or_else(conflict)?;
    let pubkey = params
        .get("sourcePubkey")
        .and_then(Value::as_str)
        .ok_or_else(conflict)?;
    let trigger = params
        .get("trigger")
        .and_then(Value::as_str)
        .ok_or_else(conflict)?;
    if ae.action_key != ACTION
        || ae.action_version != def.version
        || ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "DISPATCHED"
        || ae.tenant_id != row.tenant_id
        || ae.workspace_id != Some(row.workspace_id)
        || ae.target_id != row.id
        || ae.actor_principal_id != row.agent_principal_id
        || row.agent_version_asset_id != frozen.agent_version_asset_id
        || row.projection_generation != frozen.projection_generation
        || !frozen_parameters_match(params, &frozen, ae.initiator_principal_id)
        || !matches!(trigger, "MENTION" | "MANUAL_ASSIGNMENT")
        || !row.triggers.iter().any(|v| v == trigger)
    {
        return Err(conflict());
    }
    let revision = fresh(
        state,
        tx,
        &row,
        ae.initiator_principal_id,
        pubkey,
        frozen.delegation_id,
        &def,
        Some(ae.operation_id),
    )
    .await?;
    state
        .governance
        .record_automation_decision(tx, &ae, &def, "RECHECK", Ok(revision.clone()))
        .await?;
    Ok(revision)
}

/// 普通用户输入没有 Automation 模板；不注入空的第二输入或虚构任务指令。
pub(crate) async fn turn_template(
    pool: &sqlx::PgPool,
    invocation: Uuid,
) -> Result<Option<String>, Refusal> {
    let mut tx = pool.begin().await?;
    let key = action(&mut tx, invocation).await?;
    tx.commit().await?;
    if key == ACTION {
        Ok(None)
    } else {
        crate::automation::turn_template(pool, invocation)
            .await
            .map(Some)
    }
}

/// 源事件与 Installation 的唯一键跨 mention/manual 共用；客户端重试不产生第二回合。
#[allow(clippy::too_many_arguments)]
async fn admit(
    state: &ServiceState,
    snapshot: &Installation,
    event: &Event,
    human: Uuid,
    trigger: &str,
    requested_grant: Option<Uuid>,
    idempotency: Uuid,
) -> Result<Uuid, Refusal> {
    if !matches_source(snapshot, event, trigger) {
        return Err(denied());
    }
    let def = definition(&state.governance).await?;
    let mut tx = state.pool.begin().await?;
    let active: bool =
        sqlx::query_scalar("select state='ACTIVE' from identity.tenant where id=$1 for update")
            .bind(snapshot.tenant_id)
            .fetch_one(&mut *tx)
            .await?;
    if !active {
        return Err(denied());
    }
    // Tenant 串行下核两种幂等键；已经存在的执行只返回原 operation。
    let existing: Option<(Uuid,Uuid,Option<Uuid>)> = sqlx::query_as("select i.action_execution_id,a.initiator_principal_id,i.delegation_id
        from catalog.agent_invocation i join admission.action_execution a on a.id=i.action_execution_id
        where i.tenant_id=$1 and i.source_event_id=$2 and i.installation_resource_id=$3
          and i.automation_resource_id is null and a.action_key='agent.invoke'")
        .bind(snapshot.tenant_id).bind(event.id.to_hex()).bind(snapshot.id).fetch_optional(&mut *tx).await?;
    if let Some((ae, initiator, grant)) = existing {
        if initiator != human || requested_grant.is_some_and(|id| Some(id) != grant) {
            return Err(conflict());
        }
        let key_owner: Option<Uuid> = sqlx::query_scalar(
            "select id from admission.action_execution
            where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3",
        )
        .bind(snapshot.tenant_id)
        .bind(human)
        .bind(idempotency)
        .fetch_optional(&mut *tx)
        .await?;
        if key_owner.is_some_and(|id| id != ae) {
            return Err(Refusal::Conflict(ReasonCode::IdempotencyKeyReused));
        }
        return Ok(ae);
    }
    let previous: Option<(Uuid,String,Uuid,Option<Value>)> = sqlx::query_as("select id,action_key,target_id,parameters
        from admission.action_execution where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3")
        .bind(snapshot.tenant_id).bind(human).bind(idempotency).fetch_optional(&mut *tx).await?;
    if let Some((id, key, target, parameters)) = previous {
        let p = parameters.ok_or_else(conflict)?;
        if key != ACTION
            || target != snapshot.id
            || p.get("sourceEventId") != Some(&json!(event.id.to_hex()))
            || requested_grant.is_some_and(|grant| p.get("delegationId") != Some(&json!(grant)))
        {
            return Err(Refusal::Conflict(ReasonCode::IdempotencyKeyReused));
        }
        return Ok(id);
    }
    let row = installation(&mut tx, snapshot.id).await?;
    if row.version != snapshot.version
        || row.agent_version_asset_id != snapshot.agent_version_asset_id
        || row.projection_generation != snapshot.projection_generation
        || !matches_source(&row, event, trigger)
    {
        return Err(conflict());
    }
    let identity: Option<Option<Uuid>> = sqlx::query_scalar("select tm.human_identity_id from identity.principal p
        join identity.tenant_membership tm on tm.tenant_principal_id=p.id and tm.tenant_id=p.tenant_id
        join identity.buzz_identity_binding b on b.principal_id=p.id and b.tenant_id=p.tenant_id
        where p.id=$1 and p.tenant_id=$2 and p.kind='HUMAN' and p.status='ACTIVE'
          and tm.state='ACTIVE' and b.kind='HUMAN' and b.state='ACTIVE' and b.pubkey=$3")
        .bind(human).bind(row.tenant_id).bind(event.pubkey.to_hex()).fetch_optional(&mut *tx).await?;
    let identity = identity.ok_or_else(denied)?;
    let grants: Vec<Uuid> = sqlx::query_scalar(
        "select g.id from admission.delegation_grant g
        join admission.action_execution ga on ga.id=g.action_execution_id
        where g.tenant_id=$1 and g.workspace_id=$2 and g.installation_resource_id=$3
          and g.agent_principal_id=$4 and g.grantor_principal_id=$5 and g.state='ACTIVE'
          and g.valid_from<=clock_timestamp() and g.expires_at>clock_timestamp()
          and ($6::uuid is null or g.id=$6)
          and ga.gate_state='ALLOWED' and ga.dispatch_state='DISPATCHED'
          and ($7::boolean or (to_timestamp($8)>=g.valid_from and to_timestamp($8)>=ga.updated_at))
          and exists(select 1 from admission.delegation_scope s where s.delegation_id=g.id
            and s.action_key='agent.invoke' and s.action_version=$9 and s.target_type='RESOURCE'
            and s.target_id=$3 and s.create_workspace_id is null and s.tool_resource_id is null)
        order by g.id limit 2 for update of g",
    )
    .bind(row.tenant_id)
    .bind(row.workspace_id)
    .bind(row.id)
    .bind(row.agent_principal_id)
    .bind(human)
    .bind(requested_grant)
    .bind(trigger == "MANUAL_ASSIGNMENT")
    .bind(event.created_at.as_secs() as f64)
    .bind(def.version)
    .fetch_all(&mut *tx)
    .await?;
    let grant = match grants.as_slice() {
        [id] => Some(*id),
        _ => None,
    };
    let root = root(event);
    let parameters = json!({"targetVersion":row.version,"agentVersionAssetId":row.agent_version_asset_id,
        "projectionGeneration":row.projection_generation,"sourceEventId":event.id.to_hex(),"rootEventId":root,
        "sourcePrincipalId":human,"sourcePubkey":event.pubkey.to_hex(),"delegationId":grant,"trigger":trigger});
    let ae = governance::open_automation_execution(
        &mut tx,
        Actor {
            tenant_id: row.tenant_id,
            principal_id: human,
            human_identity_id: identity,
        },
        row.agent_principal_id,
        &def,
        &Target {
            id: row.id,
            version: row.version,
            workspace_id: Some(row.workspace_id),
        },
        parameters,
        idempotency,
    )
    .await?;
    let session_matches: Option<bool> = sqlx::query_scalar(
        "select agent_version_asset_id=$4 and projection_generation=$5
        and status in ('PENDING','ACTIVE') from catalog.agent_session
        where workspace_id=$1 and root_event_id=$2 and installation_resource_id=$3 for update",
    )
    .bind(row.workspace_id)
    .bind(&root)
    .bind(row.id)
    .bind(row.agent_version_asset_id)
    .bind(row.projection_generation)
    .fetch_optional(&mut *tx)
    .await?;
    let decision = match (session_matches, grant) {
        (Some(false), _) => Err(conflict()),
        (_, Some(grant)) => {
            fresh(
                state,
                &mut tx,
                &row,
                human,
                &event.pubkey.to_hex(),
                grant,
                &def,
                None,
            )
            .await
        }
        (_, None) => Err(denied()),
    };
    state
        .governance
        .record_automation_decision(
            &mut tx,
            &ae,
            &def,
            "ADMISSION",
            decision.as_ref().map(Clone::clone),
        )
        .await?;
    if decision.is_err() {
        tx.commit().await?;
        return Ok(ae.id);
    }
    let grant = grant.ok_or_else(denied)?;
    let invocation = Uuid::new_v4();
    let workflow = crate::component_task::workflow_id(
        "AGENT_TASK",
        row.tenant_id,
        &invocation.to_string(),
        def.version,
    );
    sqlx::query("insert into catalog.agent_session
        (tenant_id,workspace_id,root_event_id,installation_resource_id,agent_version_asset_id,projection_generation,core_memory_state,status)
        values($1,$2,$3,$4,$5,$6,'UNREADABLE','PENDING') on conflict(workspace_id,root_event_id,installation_resource_id) do nothing")
        .bind(row.tenant_id).bind(row.workspace_id).bind(&root).bind(row.id).bind(row.agent_version_asset_id)
        .bind(row.projection_generation).execute(&mut *tx).await?;
    let same: bool = sqlx::query_scalar(
        "select agent_version_asset_id=$4 and projection_generation=$5
        and status in ('PENDING','ACTIVE') from catalog.agent_session
        where workspace_id=$1 and root_event_id=$2 and installation_resource_id=$3 for update",
    )
    .bind(row.workspace_id)
    .bind(&root)
    .bind(row.id)
    .bind(row.agent_version_asset_id)
    .bind(row.projection_generation)
    .fetch_one(&mut *tx)
    .await?;
    if !same {
        return Err(conflict());
    }
    sqlx::query("insert into catalog.agent_invocation
        (id,tenant_id,workspace_id,root_event_id,source_event_id,installation_resource_id,agent_version_asset_id,
         projection_generation,delegation_id,action_execution_id,workflow_id,status)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'CREATED')")
        .bind(invocation).bind(row.tenant_id).bind(row.workspace_id).bind(&root).bind(event.id.to_hex())
        .bind(row.id).bind(row.agent_version_asset_id).bind(row.projection_generation).bind(grant)
        .bind(ae.id).bind(&workflow).execute(&mut *tx).await?;
    sqlx::query("insert into projection.workflow_ref
        (workflow_id,workflow_type,workflow_version,kind,tenant_id,workspace_id,operation_id,action_execution_id,projection_state)
        values($1,$2,1,null,$3,$4,$5,$6,'PENDING_START')")
        .bind(&workflow).bind(crate::agent_task::WORKFLOW_TYPE).bind(row.tenant_id).bind(row.workspace_id)
        .bind(ae.operation_id).bind(ae.id).execute(&mut *tx).await?;
    sqlx::query("update admission.action_execution set temporal_workflow_id=$2 where id=$1")
        .bind(ae.id)
        .bind(workflow)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    // 派发失败仍有原 AE/Invocation，普通入口的对账器只恢复该固定 Workflow ID。
    if let Err(error) = dispatch(state, invocation).await {
        tracing::warn!(operation_id=%ae.operation_id,reason_code=%governance::wire(&error.reason()),"普通 Invocation 原派发待对账");
    }
    Ok(ae.id)
}

async fn dispatch(state: &ServiceState, id: Uuid) -> Result<(), Refusal> {
    let linked: (Uuid, Uuid) = sqlx::query_as(
        "select action_execution_id,tenant_id from catalog.agent_invocation
        where id=$1 and automation_resource_id is null and automation_version_asset_id is null",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(conflict)?;
    let mut tx = state.pool.begin().await?;
    let ae = governance::lock_execution(&mut tx, linked.0).await?;
    if ae.action_key != ACTION
        || ae.gate_state != "ALLOWED"
        || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
    {
        return Ok(());
    }
    let active: bool =
        sqlx::query_scalar("select state='ACTIVE' from identity.tenant where id=$1 for update")
            .bind(linked.1)
            .fetch_one(&mut *tx)
            .await?;
    let frozen: Frozen = sqlx::query_as("select installation_resource_id,agent_version_asset_id,projection_generation,
        delegation_id,action_execution_id,source_event_id,root_event_id from catalog.agent_invocation where id=$1 for update")
        .bind(id).fetch_one(&mut *tx).await?;
    let workflow = ae.temporal_workflow_id.as_deref().ok_or_else(conflict)?;
    let def = definition(&state.governance).await?;
    let observed = state
        .temporal
        .describe(workflow)
        .await
        .map_err(|_| Refusal::Unavailable("agent.invoke Workflow Describe 不可核验".into()))?;
    if observed.is_none() {
        let admitted = async {
        if !active { return Err(denied()); }
        let row = installation(&mut tx,frozen.installation_resource_id).await?;
        let p = ae.parameters.as_ref().ok_or_else(conflict)?;
        let pubkey = p.get("sourcePubkey").and_then(Value::as_str).ok_or_else(conflict)?;
        let trigger = p.get("trigger").and_then(Value::as_str).ok_or_else(conflict)?;
        if row.agent_version_asset_id != frozen.agent_version_asset_id || row.projection_generation != frozen.projection_generation
            || ae.action_version != def.version || ae.frozen_target_version()!=Some(row.version)
            || ae.target_id != row.id || ae.actor_principal_id != row.agent_principal_id
            || ae.tenant_id != row.tenant_id || ae.workspace_id != Some(row.workspace_id)
            || !frozen_parameters_match(p,&frozen,ae.initiator_principal_id)
            || !row.triggers.iter().any(|v| v == trigger) { return Err(conflict()); }
        let used: bool = sqlx::query_scalar("select exists(select 1 from admission.delegation_use where delegation_id=$1 and operation_id=$2)")
            .bind(frozen.delegation_id).bind(ae.operation_id).fetch_one(&mut *tx).await?;
        let revision = fresh(state,&mut tx,&row,ae.initiator_principal_id,pubkey,frozen.delegation_id,&def,used.then_some(ae.operation_id)).await?;
        Ok::<_,Refusal>(revision)
        }.await;
        state
            .governance
            .record_automation_decision(
                &mut tx,
                &ae,
                &def,
                "RECHECK",
                admitted.as_ref().map(Clone::clone),
            )
            .await?;
        if let Err(error) = admitted {
            // UNKNOWN 曾可能 Start 成功；当前缺席不抹除外部结果不明。
            // 仅从未派发的明确拒绝收为 FAILED，不伪造 canceled/native interrupted。
            let certain = dispatch_rejection_is_certain(&ae.dispatch_state, &error);
            let status = if certain {
                error.class_status().1
            } else {
                axum::http::StatusCode::SERVICE_UNAVAILABLE
            };
            governance::record_dispatch(&mut tx, ae.id, def.audit_class(), Err(status), Vec::new())
                .await?;
            if certain {
                sqlx::query("update catalog.agent_invocation set status='FAILED',updated_at=now()
                    where id=$1 and status='CREATED' and runtime_turn_id is null
                      and not exists(select 1 from projection.agent_model_trace where invocation_id=$1)")
                    .bind(id).execute(&mut *tx).await?;
            }
            tx.commit().await?;
            return if certain { Ok(()) } else { Err(error) };
        }
        sqlx::query("insert into admission.delegation_use(delegation_id,operation_id) values($1,$2) on conflict do nothing")
            .bind(frozen.delegation_id).bind(ae.operation_id).execute(&mut *tx).await?;
    }
    let seconds = |key| {
        std::env::var(key)
            .ok()
            .and_then(|s| s.parse::<i64>().ok())
            .filter(|v| *v > 0)
            .ok_or_else(blocked)
    };
    let input = AgentTaskWorkflowInput {
        invocation_id: id.to_string(),
        installation_id: frozen.installation_resource_id.to_string(),
        agent_version_asset_id: frozen.agent_version_asset_id.to_string(),
        projection_generation: frozen.projection_generation,
        event_base: 0,
        cancel_pending: false,
        heartbeat_timeout_seconds: seconds("WORKER_AGENT_ACTIVITY_HEARTBEAT_TIMEOUT_SECONDS")?,
        heartbeat_interval_seconds: seconds("WORKER_AGENT_ACTIVITY_HEARTBEAT_INTERVAL_SECONDS")?,
        observation_interval_seconds: seconds(
            "WORKER_AGENT_ACTIVITY_OBSERVATION_INTERVAL_SECONDS",
        )?,
    };
    if input.heartbeat_interval_seconds >= input.heartbeat_timeout_seconds {
        return Err(blocked());
    }
    let outcome = crate::component_task::start_typed(
        &state.pool,
        &state.temporal,
        crate::component_task::Launch {
            workflow_id: workflow,
            workflow_type: crate::agent_task::WORKFLOW_TYPE,
            kind: None,
            tenant_id: ae.tenant_id,
            action_execution_id: ae.id,
        },
        &input,
    )
    .await
    .map(|_| ())
    .map_err(|r| r.status());
    governance::record_dispatch(&mut tx, ae.id, def.audit_class(), outcome, Vec::new()).await?;
    tx.commit().await?;
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    since: u64,
    until: Option<u64>,
    before_id: Option<String>,
}

/// 原 Action 注册/Installation ACTIVE 事务的消费起点，不以进程轮转时刻替代启用。
pub(crate) async fn initialize_ingress(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    installation: Uuid,
    generation: i64,
) -> Result<(), Refusal> {
    if meters().map_err(|_| blocked())?.is_none() {
        return Ok(());
    }
    sqlx::query("insert into projection.ingress_checkpoint(source_key,tenant_id,cursor)
        select 'relay:agent.invoke:'||$1::uuid::text||':'||$2::bigint::text,$3,
          json_build_object('since',ceil(extract(epoch from clock_timestamp()))::bigint,'until',null,'before_id',null)::text
        where exists(select 1 from catalog.action_definition where action_key='agent.invoke' and status='ACTIVE')
        on conflict(source_key) do nothing")
        .bind(installation).bind(generation).bind(tenant).execute(&mut **tx).await?;
    Ok(())
}

pub(crate) async fn reconcile(state: &ServiceState, batch: i64) -> Result<(), Refusal> {
    if batch <= 0 {
        return Err(blocked());
    }
    if meters().map_err(|_| blocked())?.is_none() {
        return Ok(());
    }
    definition(&state.governance).await?;
    let pending: Vec<Uuid> = sqlx::query_scalar("select i.id from catalog.agent_invocation i
        join admission.action_execution a on a.id=i.action_execution_id
        where a.action_key='agent.invoke' and a.gate_state='ALLOWED' and a.dispatch_state in ('NOT_DISPATCHED','UNKNOWN')
          and i.automation_resource_id is null order by a.updated_at,i.id limit $1")
        .bind(batch).fetch_all(&state.pool).await?;
    let mut failed = None;
    for id in pending {
        if let Err(e) = dispatch(state, id).await {
            failed = Some(e);
        }
    }
    let ids: Vec<Uuid> = sqlx::query_scalar("select cb.installation_resource_id from catalog.channel_agent_binding cb
        join catalog.agent_installation i on i.resource_id=cb.installation_resource_id
        left join projection.ingress_checkpoint c on c.source_key='relay:agent.invoke:'||i.resource_id::text||':'||i.active_projection_generation::text
        where cb.status='ACTIVE' and 'MENTION'=any(cb.triggers) and i.state='ACTIVE'
        order by c.updated_at nulls first,i.resource_id limit $1")
        .bind(batch).fetch_all(&state.pool).await?;
    for id in ids {
        if let Err(e) = inspect(state, id, batch).await {
            failed = Some(e);
        }
    }
    failed.map_or(Ok(()), Err)
}

async fn inspect(state: &ServiceState, id: Uuid, batch: i64) -> Result<(), Refusal> {
    let row: Installation = sqlx::query_as(INSTALLATION)
        .bind(id)
        .bind(Option::<Uuid>::None)
        .bind(Option::<i64>::None)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(conflict)?;
    let key = format!("relay:agent.invoke:{}:{}", id, row.projection_generation);
    // 起点已由 Action/Installation 激活事务冻结；缺失不临时跳过合法历史。
    let mut tx = state.pool.begin().await?;
    let raw: Option<String> = sqlx::query_scalar(
        "select cursor from projection.ingress_checkpoint
        where source_key=$1 and tenant_id=$2 for update skip locked",
    )
    .bind(&key)
    .bind(row.tenant_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(raw) = raw else {
        return Ok(());
    };
    let cursor: Cursor = serde_json::from_str(&raw).map_err(|_| conflict())?;
    if cursor.until.is_some() != cursor.before_id.is_some()
        || cursor
            .before_id
            .as_ref()
            .is_some_and(|id| nostr::EventId::from_hex(id).is_err())
    {
        return Err(conflict());
    }
    let (client, host) = crate::tenant_lifecycle::control_client(
        state,
        row.tenant_id,
        crate::tenant_lifecycle::ProjectionDirection::Establish,
    )
    .await
    .map_err(|_| Refusal::Unavailable("普通触发 CONTROL 读身份不可用".into()))?;
    let url = reqwest::Url::parse(&state.relay_transport).map_err(|_| blocked())?;
    let document = collab_bridge::limits::fetch_nip11(&state.http, &url, &host)
        .await
        .map_err(|_| Refusal::Unavailable("普通触发 NIP11 上界不可读".into()))?;
    let digest: Option<String> = sqlx::query_scalar("select nip11_snapshot_digest from projection.tenant_buzz_binding where tenant_id=$1 and state='ACTIVE'")
        .bind(row.tenant_id).fetch_optional(&mut *tx).await?;
    if digest.as_deref() != Some(document.digest.as_str()) {
        return Err(conflict());
    }
    let limit = batch.min(document.limits.max_limit);
    let mut filter = json!({"kinds":[9],"#h":[row.channel_id.to_string()],"#p":[row.agent_pubkey],"since":cursor.since,"limit":limit});
    if let (Some(until), Some(before)) = (cursor.until, &cursor.before_id) {
        filter["until"] = json!(until);
        filter["before_id"] = json!(before);
    }
    let page = client
        .query(&state.http, &[filter])
        .await
        .map_err(|_| Refusal::Unavailable("普通触发 Relay 原生页不可读".into()))?;
    let values = page.as_array().ok_or_else(conflict)?;
    if i64::try_from(values.len())
        .ok()
        .is_none_or(|count| count > limit)
    {
        return Err(conflict());
    }
    let mut last: Option<(u64, String)> = None;
    for value in values {
        let event: Event = serde_json::from_value(value.clone()).map_err(|_| conflict())?;
        let time = event.created_at.as_secs();
        let event_id = event.id.to_hex();
        if !matches_source(&row, &event, "MENTION")
            || time < cursor.since
            || cursor
                .until
                .zip(cursor.before_id.as_ref())
                .is_some_and(|(until, before)| {
                    time > until || (time == until && event_id <= *before)
                })
            || last.as_ref().is_some_and(|(until, before)| {
                time > *until || (time == *until && event_id <= *before)
            })
        {
            return Err(conflict());
        }
        last = Some((time, event_id));
        let author: Option<Uuid> = sqlx::query_scalar(
            "select p.id from identity.buzz_identity_binding b
            join identity.principal p on p.id=b.principal_id and p.tenant_id=b.tenant_id
            where b.pubkey=$1 and b.tenant_id=$2 and b.kind='HUMAN' and b.state='ACTIVE'
              and p.kind='HUMAN' and p.status='ACTIVE'",
        )
        .bind(event.pubkey.to_hex())
        .bind(row.tenant_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(author) = author else {
            continue;
        };
        admit(
            state,
            &row,
            &event,
            author,
            "MENTION",
            None,
            Uuid::new_v5(&row.id, event.id.to_hex().as_bytes()),
        )
        .await?;
    }
    let (until, before_id) = if i64::try_from(values.len()).ok() == Some(limit) {
        let (time, id) = last.ok_or_else(conflict)?;
        (Some(time), Some(id))
    } else {
        (None, None)
    };
    let next = Cursor {
        since: cursor.since,
        until,
        before_id,
    };
    sqlx::query(
        "update projection.ingress_checkpoint set cursor=$2,updated_at=now() where source_key=$1",
    )
    .bind(key)
    .bind(serde_json::to_string(&next).map_err(|_| conflict())?)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn submit_manual(
    state: &crate::bff::BffState,
    ctx: &crate::bff::ExecutionContext,
    command: &contracts::ActionCommand,
) -> Result<(axum::http::StatusCode, contracts::ActionSubmission), (Refusal, Option<Uuid>)> {
    if !crate::capability_registry::action_exposed(ACTION) {
        return Err((blocked(), None));
    }
    let id = manual(state, ctx, command)
        .await
        .map_err(|error| (error, None))?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| (Refusal::from(e), None))?;
    let ae = governance::lock_execution(&mut tx, id)
        .await
        .map_err(|e| (Refusal::from(e), None))?;
    if ae.initiator_principal_id != ctx.tenant_principal_id || ae.tenant_id != ctx.tenant_id {
        return Err((denied(), None));
    }
    tx.commit()
        .await
        .map_err(|e| (Refusal::from(e), Some(ae.operation_id)))?;
    governance::submission_result(&ae)
}

async fn manual(
    state: &crate::bff::BffState,
    ctx: &crate::bff::ExecutionContext,
    command: &contracts::ActionCommand,
) -> Result<Uuid, Refusal> {
    let invalid = || Refusal::Precondition(ReasonCode::InvalidParameters);
    let value = serde_json::to_value(command).map_err(|_| invalid())?;
    if ctx.access_mode != contracts::PlatformSessionAccessMode::Full
        || command.action_key != ACTION
        || !value.as_object().is_some_and(|fields| {
            fields.iter().all(|(key, value)| {
                value.is_null()
                    || matches!(
                        key.as_str(),
                        "actionKey"
                            | "idempotencyKey"
                            | "resourceId"
                            | "resourceVersion"
                            | "workspaceId"
                            | "sourceEventId"
                            | "delegationId"
                    )
            })
        })
    {
        return Err(invalid());
    }
    let id = Uuid::parse_str(command.resource_id.as_deref().ok_or_else(invalid)?)
        .map_err(|_| invalid())?;
    let workspace = Uuid::parse_str(command.workspace_id.as_deref().ok_or_else(invalid)?)
        .map_err(|_| invalid())?;
    let grant = Uuid::parse_str(command.delegation_id.as_deref().ok_or_else(invalid)?)
        .map_err(|_| invalid())?;
    let idempotency = Uuid::parse_str(&command.idempotency_key).map_err(|_| invalid())?;
    let source = command.source_event_id.as_deref().ok_or_else(invalid)?;
    if nostr::EventId::from_hex(source).is_err() {
        return Err(invalid());
    }
    type ManualReplay = (Uuid, String, Uuid, Option<Uuid>, Option<Value>);
    let prior: Option<ManualReplay>=sqlx::query_as("select id,action_key,target_id,workspace_id,parameters
        from admission.action_execution where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3")
        .bind(ctx.tenant_id).bind(ctx.tenant_principal_id).bind(idempotency).fetch_optional(&state.pool).await?;
    if let Some((ae, key, target, scope, parameters)) = prior {
        let p = parameters.ok_or_else(conflict)?;
        if key != ACTION
            || target != id
            || scope != Some(workspace)
            || !manual_parameters_match(&p, source, grant, command.resource_version)
        {
            return Err(Refusal::Conflict(ReasonCode::IdempotencyKeyReused));
        }
        return Ok(ae);
    }
    let row: Installation = sqlx::query_as(INSTALLATION)
        .bind(id)
        .bind(Option::<Uuid>::None)
        .bind(Option::<i64>::None)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(conflict)?;
    if row.tenant_id != ctx.tenant_id
        || row.workspace_id != workspace
        || command.resource_version != Some(i64::from(row.version))
    {
        return Err(conflict());
    }
    let (client, _) = crate::tenant_lifecycle::control_client(
        &state.memory_service,
        row.tenant_id,
        crate::tenant_lifecycle::ProjectionDirection::Establish,
    )
    .await
    .map_err(|_| Refusal::Unavailable("人工分派消息来源不可查证".into()))?;
    let page = client
        .query(
            &state.memory_service.http,
            &[json!({"ids":[source],"kinds":[9],"#h":[row.channel_id.to_string()],"limit":1})],
        )
        .await
        .map_err(|_| Refusal::Unavailable("人工分派持久消息不可读".into()))?;
    let values = page
        .as_array()
        .filter(|values| values.len() == 1)
        .ok_or_else(conflict)?;
    let event: Event = serde_json::from_value(values[0].clone()).map_err(|_| conflict())?;
    if event.id.to_hex() != source || !matches_source(&row, &event, "MANUAL_ASSIGNMENT") {
        return Err(denied());
    }
    admit(
        &state.memory_service,
        &row,
        &event,
        ctx.tenant_principal_id,
        "MANUAL_ASSIGNMENT",
        Some(grant),
        idempotency,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    fn source(extra: Vec<Vec<String>>) -> (Installation, Event) {
        let row = Installation {
            id: Uuid::new_v4(),
            tenant_id: Uuid::new_v4(),
            workspace_id: Uuid::new_v4(),
            version: 1,
            agent_principal_id: Uuid::new_v4(),
            agent_version_asset_id: Uuid::new_v4(),
            projection_generation: 1,
            agent_pubkey: Keys::generate().public_key().to_hex(),
            channel_id: Uuid::new_v4(),
            triggers: vec!["MENTION".into(), "MANUAL_ASSIGNMENT".into()],
        };
        let mut tags = vec![
            vec!["h".into(), row.channel_id.to_string()],
            vec!["p".into(), row.agent_pubkey.clone()],
        ];
        tags.extend(extra);
        let event = EventBuilder::new(Kind::Custom(9), "a real signed source")
            .tags(
                tags.into_iter()
                    .map(|v| Tag::parse(v).unwrap())
                    .collect::<Vec<_>>(),
            )
            .sign_with_keys(&Keys::generate())
            .unwrap();
        (row, event)
    }

    #[test]
    fn invoke_source_rejects_cross_channel_wrong_agent_disabled_trigger_and_bad_signature() {
        let (mut row, event) = source(Vec::new());
        assert!(matches_source(&row, &event, "MENTION"));
        assert!(matches_source(&row, &event, "MANUAL_ASSIGNMENT"));
        let channel = row.channel_id;
        row.channel_id = Uuid::new_v4();
        assert!(!matches_source(&row, &event, "MENTION"));
        row.channel_id = channel;
        row.agent_pubkey = Keys::generate().public_key().to_hex();
        assert!(!matches_source(&row, &event, "MENTION"));
        assert!(matches_source(&row, &event, "MANUAL_ASSIGNMENT"));
        row.triggers.clear();
        assert!(!matches_source(&row, &event, "MANUAL_ASSIGNMENT"));
        let (row, mut event) = source(Vec::new());
        event.content.push('x');
        assert!(!matches_source(&row, &event, "MENTION"));
    }

    #[test]
    fn invoke_source_preserves_native_root_and_rejects_malformed_markers() {
        let root_id = "a".repeat(64);
        let parent = "b".repeat(64);
        let (row, event) = source(vec![
            vec!["e".into(), root_id.clone(), "".into(), "root".into()],
            vec!["e".into(), parent, "".into(), "reply".into()],
        ]);
        assert!(matches_source(&row, &event, "MENTION"));
        assert_eq!(root(&event), root_id);
        for tags in [
            vec![vec!["e".into(), "bad".into(), "".into(), "reply".into()]],
            vec![vec!["h".into()]],
            vec![vec!["h".into(), Uuid::new_v4().to_string()]],
            vec![
                vec!["e".into(), "a".repeat(64), "".into(), "reply".into()],
                vec!["e".into(), "b".repeat(64), "".into(), "reply".into()],
            ],
        ] {
            let (row, event) = source(tags);
            assert!(!matches_source(&row, &event, "MENTION"));
        }
    }

    #[test]
    fn invoke_frozen_refs_reject_changed_generation_source_root_human_or_grant() {
        let human = Uuid::new_v4();
        let frozen = Frozen {
            installation_resource_id: Uuid::new_v4(),
            agent_version_asset_id: Uuid::new_v4(),
            projection_generation: 3,
            delegation_id: Uuid::new_v4(),
            action_execution_id: Uuid::new_v4(),
            source_event_id: "a".repeat(64),
            root_event_id: "b".repeat(64),
        };
        let parameters = json!({"agentVersionAssetId":frozen.agent_version_asset_id,"projectionGeneration":3,
            "delegationId":frozen.delegation_id,"sourceEventId":frozen.source_event_id,
            "rootEventId":frozen.root_event_id,"sourcePrincipalId":human});
        assert!(frozen_parameters_match(&parameters, &frozen, human));
        for key in [
            "agentVersionAssetId",
            "projectionGeneration",
            "delegationId",
            "sourceEventId",
            "rootEventId",
            "sourcePrincipalId",
        ] {
            let mut changed = parameters.clone();
            changed[key] = Value::Null;
            assert!(!frozen_parameters_match(&changed, &frozen, human), "{key}");
        }
        assert!(!frozen_parameters_match(
            &parameters,
            &frozen,
            Uuid::new_v4()
        ));
    }

    #[test]
    fn invoke_unknown_dispatch_never_becomes_known_rejection() {
        assert!(dispatch_rejection_is_certain("NOT_DISPATCHED", &denied()));
        assert!(!dispatch_rejection_is_certain("UNKNOWN", &denied()));
        assert!(!dispatch_rejection_is_certain(
            "NOT_DISPATCHED",
            &Refusal::Unavailable("offline".into())
        ));
    }

    #[test]
    fn invoke_manual_idempotency_keeps_original_source_grant_and_version() {
        let source = "a".repeat(64);
        let grant = Uuid::new_v4();
        let parameters = json!({"sourceEventId":source,"delegationId":grant,"targetVersion":2});
        assert!(manual_parameters_match(
            &parameters,
            &source,
            grant,
            Some(2)
        ));
        assert!(!manual_parameters_match(
            &parameters,
            &"b".repeat(64),
            grant,
            Some(2)
        ));
        assert!(!manual_parameters_match(
            &parameters,
            &source,
            Uuid::new_v4(),
            Some(2)
        ));
        assert!(!manual_parameters_match(
            &parameters,
            &source,
            grant,
            Some(3)
        ));
        assert!(!manual_parameters_match(&parameters, &source, grant, None));
    }

    #[test]
    fn invoke_meters_are_explicit_models_without_automation_counter() {
        assert_eq!(
            parse_meters(r#"["provider.output", "provider.input"]"#).unwrap(),
            vec!["provider.input", "provider.output"]
        );
        for raw in [
            "[]",
            r#"["automation.run"]"#,
            r#"["agent.invoke"]"#,
            r#"["tokens","tokens"]"#,
            r#"[" "]"#,
            r#"[null]"#,
        ] {
            assert!(parse_meters(raw).is_err(), "{raw}");
        }
    }

    #[tokio::test]
    #[ignore = "requires AGENT_INVOKE_TEST_DATABASE_URL pointing at a disposable migrated database"]
    async fn invoke_record_dispatch_preserves_agent_task_native_execution() {
        let pool = sqlx::PgPool::connect(&std::env::var("AGENT_INVOKE_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        let tenant = Uuid::new_v4();
        let workspace = Uuid::new_v4();
        let human = Uuid::new_v4();
        let key = format!("verify.agent.invoke.{}", Uuid::new_v4());
        sqlx::query("insert into identity.tenant(id,slug,name,state) values($1,$1::text,'invoke verification','ACTIVE')")
            .bind(tenant).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into identity.workspace(id,tenant_id,slug,name,state) values($1,$2,$1::text,'invoke verification','ACTIVE')")
            .bind(workspace).bind(tenant).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'HUMAN','ACTIVE')")
            .bind(human).bind(tenant).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into catalog.action_definition
            (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,permission,permission_object_type,
             execution_mode,confirmation_mode,workflow_type,capacity_policy,quota_policy,meters,result_exposure,audit_policy,
             obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
            values($1,1,'core','RESOURCE','SESSION_TENANT','TARGET_HOME_WORKSPACE','execute','resource',
             'TEMPORAL','NONE','AgentTaskWorkflow','NONE','NONE','{}','NONE','FULL_LIFECYCLE',
             'OPERATION_REF','TEMPORAL','TEMPORAL','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE')")
            .bind(&key).execute(&mut *tx).await.unwrap();
        for state in ["RUNNING", "TERMINAL", "PENDING_START"] {
            let action = Uuid::new_v4();
            let operation = Uuid::new_v4();
            let workflow = format!("verify:{action}");
            sqlx::query("insert into admission.action_execution
                (id,operation_id,tenant_id,workspace_id,action_key,action_version,initiator_principal_id,actor_principal_id,
                 target_id,parameter_hash,temporal_workflow_id,gate_state,dispatch_state,correlation_id)
                values($1,$2,$3,$4,$5,1,$6,$6,$1,$7,$8,'ALLOWED','UNKNOWN',$1)")
                .bind(action).bind(operation).bind(tenant).bind(workspace).bind(&key).bind(human)
                .bind("0".repeat(64)).bind(&workflow).execute(&mut *tx).await.unwrap();
            sqlx::query("insert into projection.workflow_ref
                (workflow_id,workflow_type,workflow_version,kind,tenant_id,workspace_id,operation_id,action_execution_id,projection_state,run_id)
                values($1,'AgentTaskWorkflow',1,null,$2,$3,$4,$5,$6,$7)")
                .bind(&workflow).bind(tenant).bind(workspace).bind(operation).bind(action).bind(state)
                .bind((state!="PENDING_START").then(||Uuid::new_v4().to_string()))
                .execute(&mut *tx).await.unwrap();
            let error = if state == "PENDING_START" {
                axum::http::StatusCode::SERVICE_UNAVAILABLE
            } else {
                axum::http::StatusCode::CONFLICT
            };
            let recorded = governance::record_dispatch(
                &mut tx,
                action,
                governance::AuditClass::core("RESOURCE"),
                Err(error),
                Vec::new(),
            )
            .await
            .unwrap();
            let expected = if state == "PENDING_START" {
                "UNKNOWN"
            } else {
                "DISPATCHED"
            };
            let actual: String = sqlx::query_scalar(
                "select dispatch_state from admission.action_execution where id=$1",
            )
            .bind(action)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
            assert!(recorded.settled);
            assert_eq!(
                actual, expected,
                "{state} must follow the exact AgentTask ref"
            );
        }
        tx.rollback().await.unwrap();
    }
}
