//! REQ-23、DD-107、03 §7、05 §2.9：Relay 持久触发复用统一治理和 AgentTask。
//! Core 只保存触发引用和版本；Relay 消息正文只在当前原生读取调用中存在。

use chrono::{DateTime, Utc};
use contracts::{AgentTaskWorkflowInput, ReasonCode};
use nostr::Event;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    governance::{self, Actor, Definition, Governance, Refusal, Target},
    service_api::ServiceState,
    spicedb::{Consistency, Relationship, RelationshipFilter, SpiceDb, Write},
};

pub(crate) const ACTION: &str = "automation.run";

pub(crate) mod manual;
pub(crate) mod post_message;
mod schedule;
pub(crate) mod step_approval;
pub(crate) mod steps;
mod webhook_secret;
pub(crate) use manual::submit_manual;
pub(crate) use schedule::admit_schedule;
pub(crate) use schedule::converge_scope_schedules;
pub(crate) use schedule::spec as schedule_spec;

fn configured_run_meters() -> Result<Option<Vec<String>>, String> {
    match std::env::var("AUTOMATION_RUN_METERS_JSON") {
        Err(std::env::VarError::NotPresent) => Ok(None),
        Ok(value) if value.is_empty() => Ok(None),
        Ok(value) => {
            let native_key = crate::openmeter::configured_automation_native_meter_key()?
                .ok_or("automation.run 缺少 AUTOMATION_RUN_NATIVE_METER_KEY")?;
            parse_run_meters(&value, &native_key).map(Some)
        }
        Err(_) => Err("AUTOMATION_RUN_METERS_JSON 不是有效 Unicode".into()),
    }
}

fn parse_run_meters(value: &str, native_count_key: &str) -> Result<Vec<String>, String> {
    let mut meters: Vec<String> = serde_json::from_str(value)
        .map_err(|_| "AUTOMATION_RUN_METERS_JSON 必须是 meter key 字符串数组")?;
    if meters.len() < 2
        || !meters.iter().any(|key| key == ACTION)
        || meters.iter().any(|key| key == native_count_key)
        || meters
            .iter()
            .any(|key| key.trim().is_empty() || key.trim() != key)
    {
        return Err("automation.run 必须显式登记计数 meter 与模型 meter".into());
    }
    meters.sort();
    if meters.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err("automation.run meter key 不得重复".into());
    }
    Ok(meters)
}

/// DD-107：只从受控部署配置登记已有 consumer 的固定策略，不生成 meter、
/// Customer、额度或业务对象。原生 meter/entitlement 仍在每次准入与派发时核验。
/// 已有定义不覆盖、不复活；配置漂移拒绝启动，避免改变已冻结的授权版本。
pub(crate) async fn register_run(g: &Governance) -> Result<(), String> {
    let Some(meters) = configured_run_meters()? else {
        return Ok(());
    };
    let pool_key = std::env::var("AGENT_CAPACITY_POOL_KEY")
        .ok()
        .filter(|key| !key.trim().is_empty() && key.trim() == key)
        .ok_or("automation.run 缺少有效 AGENT_CAPACITY_POOL_KEY")?;
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
    .bind(pool_key)
    .bind(&meters)
    .execute(&g.pool)
    .await
    .map_err(|e| format!("automation.run 登记失败: {e}"))?;
    definition(g)
        .await
        .map_err(|_| "automation.run 已登记策略与投递配置不一致".to_owned())?;
    Ok(())
}

#[derive(FromRow)]
pub(crate) struct ManagementResource {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub workspace_id: Uuid,
    pub owner_principal_id: Uuid,
    pub version: i32,
    pub state: String,
    pub projection_action_execution_id: Option<Uuid>,
    automation_state: String,
    executor_installation_resource_id: Uuid,
    schedule_id: Option<String>,
    webhook_secret_ref: Option<Value>,
}

pub(crate) async fn management_resource(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    id: Uuid,
    lock: bool,
) -> Result<Option<ManagementResource>, sqlx::Error> {
    sqlx::query_as(&format!(
        "select r.id,r.tenant_id,d.workspace_id,r.owner_principal_id,r.version,
        r.state,r.projection_action_execution_id,d.state automation_state,
        d.executor_installation_resource_id,d.schedule_id,d.webhook_secret_ref
        from catalog.resource r join catalog.automation_definition d on d.resource_id=r.id
        where r.tenant_id=$1 and r.id=$2 and r.type_key='automation'
          and r.home_workspace_id=d.workspace_id and r.application_binding_id is null{}",
        if lock { " for update of r,d" } else { "" }
    ))
    .bind(tenant)
    .bind(id)
    .fetch_optional(conn)
    .await
}

pub(crate) async fn management_projection(
    g: &Governance,
    row: &ManagementResource,
) -> Result<bool, Refusal> {
    g.spicedb
        .resource_projection_matches_in_workspace(
            &row.id.to_string(),
            &row.tenant_id.to_string(),
            &row.owner_principal_id.to_string(),
            Some(&row.workspace_id.to_string()),
            g.cfg.relationship_page,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Automation owner 投影不可核验".into()))
}

// DD-107: the explicit definition selects one Installation, not a set of
// independently privileged Agents. Keep its executor relationship exact while
// leaving owner/reader and every other Resource relationship untouched.
async fn project_executor(
    spicedb: &SpiceDb,
    resource: Uuid,
    agent: Uuid,
    page: u32,
) -> Result<(), Refusal> {
    let resource = resource.to_string();
    let agent = agent.to_string();
    let filter = RelationshipFilter {
        object_type: "resource",
        object_id: Some(&resource),
        relation: Some("executor"),
        subject_principal: None,
    };
    let read = || async {
        let rows = spicedb
            .read_native(&filter, page)
            .await
            .map_err(|_| Refusal::Unavailable("Automation executor 投影不可读".into()))?;
        rows.into_iter()
            .map(|row| {
                let text = |path| row.pointer(path).and_then(Value::as_str);
                if text("/resource/objectType") != Some("resource")
                    || text("/resource/objectId") != Some(resource.as_str())
                    || text("/relation") != Some("executor")
                    || text("/subject/object/objectType") != Some("principal")
                    || text("/subject/optionalRelation").is_some_and(|value| !value.is_empty())
                    || text("/optionalCaveat/caveatName").is_some_and(|value| !value.is_empty())
                {
                    return Err(Refusal::Unavailable(
                        "Automation executor 投影形状不可核验".into(),
                    ));
                }
                let principal = text("/subject/object/objectId")
                    .and_then(|value| Uuid::parse_str(value).ok())
                    .ok_or_else(|| {
                        Refusal::Unavailable("Automation executor 主体不可核验".into())
                    })?;
                if text("/subject/object/objectId") != Some(principal.to_string().as_str()) {
                    return Err(Refusal::Unavailable(
                        "Automation executor 非规范主体".into(),
                    ));
                }
                Ok(principal.to_string())
            })
            .collect::<Result<Vec<_>, Refusal>>()
    };
    let before = read().await?;
    let relationship = |subject_principal| Relationship {
        object_type: "resource".into(),
        object_id: resource.clone(),
        relation: "executor".into(),
        subject_principal,
    };
    let mut updates: Vec<_> = before
        .iter()
        .filter(|subject| *subject != &agent)
        .map(|subject| (Write::Delete, relationship(subject.clone())))
        .collect();
    if !before.contains(&agent) {
        updates.push((Write::Touch, relationship(agent.clone())));
    }
    if !updates.is_empty() {
        let revision = spicedb
            .write(&updates)
            .await
            .map_err(|_| Refusal::Unavailable("Automation executor 投影写入结果不明".into()))?;
        if revision.is_empty() {
            return Err(Refusal::Unavailable(
                "Automation executor 投影缺少 revision".into(),
            ));
        }
    }
    if read().await? != vec![agent] {
        return Err(Refusal::Unavailable(
            "Automation executor 投影尚未精确收敛".into(),
        ));
    }
    Ok(())
}

fn invalid_management() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

/// 使用共享命令契约产生的值；数据库存储沿原 Relay consumer 的 native 字段名。
fn management_content(value: &Value) -> Result<Value, Refusal> {
    let object = value.as_object().ok_or_else(invalid_management)?;
    if object.keys().any(|key| {
        !matches!(
            key.as_str(),
            "name"
                | "trigger"
                | "action"
                | "resultTarget"
                | "approvalPolicy"
                | "formatVersion"
                | "steps"
        )
    }) {
        return Err(invalid_management());
    }
    let name = match value.get("name") {
        None => None,
        Some(value) => Some(
            value
                .as_str()
                .filter(|name| !name.trim().is_empty())
                .ok_or_else(invalid_management)?,
        ),
    };
    let trigger = value
        .get("trigger")
        .and_then(Value::as_object)
        .ok_or_else(invalid_management)?;
    let native_action = match value.get("formatVersion") {
        None if value.get("steps").is_none() && value["action"].get("stepsVersion").is_none() => {
            value
                .get("action")
                .cloned()
                .ok_or_else(invalid_management)?
        }
        Some(version) if version == 2 && value.get("action").is_none() => {
            steps::action(&value["steps"])?
        }
        _ => return Err(invalid_management()),
    };
    if trigger.keys().any(|key| {
        !matches!(
            key.as_str(),
            "kind" | "textPrefix" | "mentionPrincipalId" | "scheduleSpec"
        )
    }) || !steps::supported(&native_action)
    {
        return Err(invalid_management());
    }
    let mut native_trigger = json!({"kind":trigger.get("kind").ok_or_else(invalid_management)?});
    if let Some(prefix) = trigger.get("textPrefix") {
        if prefix.as_str().is_none_or(str::is_empty) {
            return Err(invalid_management());
        }
        native_trigger["text_prefix"] = prefix.clone();
    }
    match trigger.get("kind").and_then(Value::as_str) {
        Some("CHANNEL_MESSAGE")
            if !trigger.contains_key("mentionPrincipalId")
                && !trigger.contains_key("scheduleSpec") => {}
        Some("MENTION") if !trigger.contains_key("scheduleSpec") => {
            let id = trigger
                .get("mentionPrincipalId")
                .and_then(Value::as_str)
                .and_then(|text| Uuid::parse_str(text).ok())
                .filter(|id| !id.is_nil())
                .ok_or_else(invalid_management)?;
            native_trigger["mention_principal_id"] = json!(id);
        }
        Some("SCHEDULE")
            if !trigger.contains_key("textPrefix")
                && !trigger.contains_key("mentionPrincipalId") =>
        {
            let spec = trigger.get("scheduleSpec").ok_or_else(invalid_management)?;
            schedule::spec(spec)?;
            native_trigger["schedule_spec"] = spec.clone();
        }
        _ => return Err(invalid_management()),
    }
    let result = value
        .get("resultTarget")
        .and_then(Value::as_str)
        .filter(|result| {
            *result
                == if trigger.get("kind").and_then(Value::as_str) == Some("SCHEDULE") {
                    "CHANNEL"
                } else {
                    "TRIGGER_THREAD"
                }
        })
        .ok_or_else(invalid_management)?;
    let step_policy = steps::approval(&native_action).map(|step| &step["approvalPolicy"]);
    if step_policy.is_some() && value.get("approvalPolicy").is_some() {
        return Err(invalid_management());
    }
    let (policy, version) = policy_reference(step_policy.or_else(|| value.get("approvalPolicy")))?;
    Ok(version_content(
        native_trigger,
        native_action,
        policy,
        version,
        result,
        name,
    ))
}

fn policy_reference(value: Option<&Value>) -> Result<(Option<Uuid>, Option<i32>), Refusal> {
    Ok(match value {
        None => (None, None),
        Some(raw) => {
            let object = raw
                .as_object()
                .filter(|o| o.len() == 2 && o.contains_key("id") && o.contains_key("version"))
                .ok_or_else(invalid_management)?;
            let id = object["id"]
                .as_str()
                .and_then(|s| Uuid::parse_str(s).ok())
                .filter(|id| !id.is_nil())
                .ok_or_else(invalid_management)?;
            let version = object["version"]
                .as_i64()
                .and_then(|v| i32::try_from(v).ok())
                .filter(|v| *v > 0)
                .ok_or_else(invalid_management)?;
            (Some(id), Some(version))
        }
    })
}

pub(crate) fn version_content(
    trigger: Value,
    action: Value,
    policy: Option<Uuid>,
    version: Option<i32>,
    result: &str,
    name: Option<&str>,
) -> Value {
    let mut content =
        json!({"trigger":trigger,"action":action,"approvalPolicyId":policy,"resultTarget":result});
    // Preserve the exact pre-step hash for existing versions with no policy.
    if let Some(version) = version {
        content["approvalPolicyVersion"] = json!(version);
    }
    // Do not add a null key: unnamed historical versions must keep their exact digest.
    if let Some(name) = name {
        content["name"] = json!(name);
    }
    content
}

pub(crate) fn validate_management_params(
    sem: governance::Semantic,
    p: &governance::Params,
) -> Result<(), Refusal> {
    use governance::Semantic;
    if p.tenant_id.is_some()
        || p.principal_id.is_some()
        || p.slug.is_some()
        || p.name.is_some()
        || p.invitation_id.is_some()
        || p.original_action_execution_id.is_some()
        || p.agent_version_content.is_some()
        || p.delegation_grant.is_some()
        || p.explicit_confirmation != Some(true)
    {
        return Err(invalid_management());
    }
    let content = matches!(
        sem,
        Semantic::AutomationCreate | Semantic::AutomationPublish
    );
    if p.automation_version_content.is_some() != content {
        return Err(invalid_management());
    }
    if let Some(value) = &p.automation_version_content {
        management_content(value)?;
    }
    let valid = match sem {
        Semantic::AutomationCreate => {
            p.workspace_id.is_some_and(|id| !id.is_nil())
                && p.executor_installation_resource_id
                    .is_some_and(|id| !id.is_nil())
                && p.resource_id.is_none()
                && p.resource_version.is_none()
                && p.asset_id.is_none()
                && p.asset_version.is_none()
                && p.delegation_id.is_none()
                && p.delegation_version.is_none()
        }
        Semantic::AutomationPublish
        | Semantic::AutomationEnable
        | Semantic::AutomationPause
        | Semantic::AutomationDisable
        | Semantic::AutomationDelete
        | Semantic::AutomationRotateWebhookSecret => {
            p.workspace_id.is_none()
                && p.executor_installation_resource_id.is_none()
                && p.resource_id.is_some_and(|id| !id.is_nil())
                && p.resource_version.is_some_and(|v| v > 0)
                && if sem == Semantic::AutomationEnable {
                    p.asset_id.is_some_and(|id| !id.is_nil())
                        && p.asset_version.is_some_and(|v| v > 0)
                        && p.delegation_id.is_some_and(|id| !id.is_nil())
                        && p.delegation_version.is_some_and(|v| v > 0)
                } else {
                    p.asset_id.is_none()
                        && p.asset_version.is_none()
                        && p.delegation_id.is_none()
                        && p.delegation_version.is_none()
                }
        }
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(invalid_management())
    }
}

pub(crate) async fn management_target(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    def: &Definition,
    p: &governance::Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    use governance::Semantic;
    let sem = Semantic::from_key(&def.action_key)
        .filter(|sem| sem.is_automation())
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    validate_management_params(sem, p)?;
    let creating = sem == Semantic::AutomationCreate;
    if def.target_type != "RESOURCE"
        || def.tenant_rule != "SESSION_TENANT"
        || def.workspace_rule
            != if creating {
                "WORKSPACE_REQUIRED"
            } else {
                "TARGET_HOME_WORKSPACE"
            }
        || def.permission_object_type != if creating { "workspace" } else { "resource" }
        || def.permission != if creating { "create" } else { "manage" }
        || def.execution_mode != "SYNC"
        || def.confirmation_mode != "EXPLICIT"
        || def.approval_policy_id.is_some()
        || def.approval_policy_version.is_some()
        || def.workflow_kind.is_some()
        || def.quota_policy != "NONE"
        || !def.meters.is_empty()
        || def.result_exposure != "NONE"
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    if lock && !crate::agent_definition::active_owner(conn, tenant, initiator).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    if creating {
        let workspace = p.workspace_id.ok_or_else(invalid_management)?;
        let active:bool=sqlx::query_scalar("select exists(select 1 from catalog.resource_type_definition
            where type_key='automation' and status='ACTIVE' and tenant_delete_action_key='tenant.delete')")
            .fetch_one(&mut *conn).await?;
        if !active {
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        }
        let actual: Option<Uuid> = sqlx::query_scalar(&format!(
            "select i.agent_principal_id from identity.workspace w
            join catalog.agent_installation i on i.workspace_id=w.id
            join catalog.resource r on r.id=i.resource_id and r.tenant_id=w.tenant_id
            where w.id=$1 and w.tenant_id=$2 and w.state='ACTIVE' and i.resource_id=$3
              and r.type_key='agent.installation' and r.home_workspace_id=w.id
              and r.state not in ('DELETED','FAILED'){}",
            if lock { " for update of w,i,r" } else { "" }
        ))
        .bind(workspace)
        .bind(tenant)
        .bind(p.executor_installation_resource_id)
        .fetch_optional(&mut *conn)
        .await?;
        let agent = actual.ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
        let content = management_content(
            p.automation_version_content
                .as_ref()
                .ok_or_else(invalid_management)?,
        )?;
        if content.pointer("/trigger/kind").and_then(Value::as_str) == Some("MENTION")
            && content
                .pointer("/trigger/mention_principal_id")
                .and_then(Value::as_str)
                != Some(agent.to_string().as_str())
        {
            return Err(invalid_management());
        }
        return Ok(Target {
            id: frozen.unwrap_or_else(Uuid::new_v4),
            version: 0,
            workspace_id: Some(workspace),
        });
    }
    let row = management_resource(
        conn,
        tenant,
        p.resource_id.ok_or_else(invalid_management)?,
        lock,
    )
    .await?
    .filter(|r| {
        r.state == "ACTIVE"
            && r.projection_action_execution_id.is_none()
            && Some(r.version) == p.resource_version
            && frozen.is_none_or(|id| id == r.id)
    })
    .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    if !matches!(
        row.automation_state.as_str(),
        "DRAFT" | "ENABLED" | "PAUSED" | "DISABLED"
    ) {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    if row.automation_state == "DELETED"
        || (sem == Semantic::AutomationPause && row.automation_state != "ENABLED")
        || (sem == Semantic::AutomationEnable && row.automation_state == "ENABLED")
        || (sem == Semantic::AutomationDisable && row.automation_state == "DISABLED")
    {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    if sem == Semantic::AutomationRotateWebhookSecret {
        let webhook: bool = sqlx::query_scalar("select exists(select 1 from catalog.automation_definition d
            join catalog.automation_version v on v.asset_id=d.pinned_version_asset_id and v.automation_resource_id=d.resource_id
            where d.resource_id=$1 and d.state in ('ENABLED','PAUSED') and d.webhook_secret_ref is not null
              and v.state='PUBLISHED' and v.trigger->>'kind'='WEBHOOK')")
            .bind(row.id).fetch_one(&mut *conn).await?;
        if !webhook {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
    }
    let workspace: Option<Uuid> = sqlx::query_scalar(&format!(
        "select id from identity.workspace
        where id=$1 and tenant_id=$2 and state='ACTIVE'{}",
        if lock { " for update" } else { "" }
    ))
    .bind(row.workspace_id)
    .bind(tenant)
    .fetch_optional(&mut *conn)
    .await?;
    if workspace.is_none() {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    Ok(Target {
        id: row.id,
        version: row.version,
        workspace_id: Some(row.workspace_id),
    })
}

async fn management_installation(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    workspace: Uuid,
    installation: Uuid,
    human: Uuid,
    content: &Value,
) -> Result<(), Refusal> {
    let actual:Option<(Uuid,Value)>=sqlx::query_as("select i.agent_principal_id,v.content
        from catalog.agent_installation i join catalog.resource r on r.id=i.resource_id
        join catalog.agent_version v on v.asset_id=i.pinned_version_asset_id
        join catalog.asset a on a.id=v.asset_id and a.tenant_id=r.tenant_id
        join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
          and p.generation=i.active_projection_generation and p.agent_version_asset_id=v.asset_id
        left join catalog.agent_model_binding b on b.installation_resource_id=i.resource_id
          and b.projection_generation=p.generation and b.model_route_resource_id=p.model_route_resource_id
        join identity.principal agent on agent.id=i.agent_principal_id and agent.tenant_id=r.tenant_id
        join identity.principal owner on owner.id=r.owner_principal_id and owner.tenant_id=r.tenant_id
        join identity.tenant_membership tm on tm.tenant_id=r.tenant_id and tm.tenant_principal_id=owner.id
        join identity.principal version_owner on version_owner.id=a.owner_principal_id and version_owner.tenant_id=r.tenant_id
        join identity.tenant_membership version_tm on version_tm.tenant_id=r.tenant_id and version_tm.tenant_principal_id=version_owner.id
        where r.id=$1 and r.tenant_id=$2 and i.workspace_id=$3 and r.home_workspace_id=$3
          and r.state='ACTIVE' and r.projection_action_execution_id is null and i.state='ACTIVE'
          and v.state='PUBLISHED' and a.state='PUBLISHED' and a.projection_action_execution_id is null
          and p.state='ACTIVE' and ($4 or (b.secret_status='ACTIVE' and b.secret_version>0
          and length(b.secret_locator)>0 and length(b.secret_audience)>0
          and length(b.native_key_id)>0 and b.native_key_revision>0))
          and agent.kind='AGENT' and agent.status='ACTIVE'
          and owner.kind='HUMAN' and owner.status='ACTIVE' and tm.state='ACTIVE'
          and version_owner.kind='HUMAN' and version_owner.status='ACTIVE' and version_tm.state='ACTIVE'
        for update of r,i,v,a,p,agent,owner,tm,version_owner,version_tm")
        .bind(installation).bind(tenant).bind(workspace)
        .bind(content.pointer("/action/kind").and_then(Value::as_str).is_some_and(steps::is_message_kind))
        .fetch_optional(&mut **tx).await?;
    let Some((agent, requested)) = actual else {
        return Err(Refusal::Precondition(ReasonCode::BindingNotActive));
    };
    if content.pointer("/trigger/kind").and_then(Value::as_str) == Some("MENTION")
        && content
            .pointer("/trigger/mention_principal_id")
            .and_then(Value::as_str)
            != Some(agent.to_string().as_str())
    {
        return Err(invalid_management());
    }
    let policy = content
        .get("approvalPolicyId")
        .and_then(Value::as_str)
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| invalid_management())?;
    let version = content
        .get("approvalPolicyVersion")
        .and_then(Value::as_i64)
        .map(i32::try_from)
        .transpose()
        .map_err(|_| invalid_management())?;
    step_approval::validate_policy(tx, tenant, policy, version, true).await?;
    let requested: contracts::ContentClass = serde_json::from_value(requested)
        .map_err(|_| Refusal::Unavailable("Installation 已发布 Version 不符合共享契约".into()))?;
    // Validate the registered AgentVersion policy, without using the ordinary
    // Agent's output location to override the frozen Automation/source contract.
    crate::agent_version::reply_to_channel(&requested)?;
    if content
        .pointer("/action/kind")
        .and_then(Value::as_str)
        .is_some_and(crate::automation::steps::is_message_kind)
    {
        Ok(())
    } else {
        crate::agent_version::validate_references(g, tx, tenant, human, &requested).await
    }
}

pub(crate) async fn management_prewrite(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    ae: &governance::Execution,
    def: &Definition,
    sem: governance::Semantic,
    p: &governance::Params,
) -> Result<(), Refusal> {
    use governance::Semantic;
    if sem == Semantic::AutomationCreate {
        let normalized = management_content(
            p.automation_version_content
                .as_ref()
                .ok_or_else(invalid_management)?,
        )?;
        let workspace = ae.workspace_id.ok_or_else(invalid_management)?;
        sqlx::query("insert into catalog.resource
            (id,tenant_id,type_key,owner_principal_id,home_workspace_id,component_type_key,native_type,native_id,state,version,projection_action_execution_id)
            values($1,$2,'automation',$3,$4,$5,'automation',$1::text,'PROVISIONING',1,$6)")
            .bind(ae.target_id).bind(ae.tenant_id).bind(ae.initiator_principal_id).bind(workspace)
            .bind(&def.component_type_key).bind(ae.id).execute(&mut **tx).await?;
        sqlx::query("insert into catalog.automation_definition
            (resource_id,workspace_id,executor_installation_resource_id,state,version) values($1,$2,$3,'DRAFT',1)")
            .bind(ae.target_id).bind(workspace).bind(p.executor_installation_resource_id)
            .execute(&mut **tx).await?;
        return management_insert_version(tx, ae, ae.target_id, normalized).await;
    }
    let row = management_resource(tx, ae.tenant_id, ae.target_id, true)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    if row.automation_state == "DELETED" {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    if !crate::agent_definition::active_owner(tx, ae.tenant_id, row.owner_principal_id).await?
        || !management_projection(g, &row).await?
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    match sem {
        Semantic::AutomationRotateWebhookSecret => {
            webhook_secret::freeze(g, tx, ae, &row).await.map(|_| ())
        }
        Semantic::AutomationPublish => {
            let normalized = management_content(
                p.automation_version_content
                    .as_ref()
                    .ok_or_else(invalid_management)?,
            )?;
            management_installation(
                g,
                tx,
                ae.tenant_id,
                row.workspace_id,
                row.executor_installation_resource_id,
                ae.initiator_principal_id,
                &normalized,
            )
            .await?;
            management_insert_version(tx, ae, row.id, normalized).await
        }
        Semantic::AutomationEnable => {
            let version: Option<ManagementVersion> = sqlx::query_as(
                "select a.id asset_id,a.owner_principal_id,
                a.state,a.projection_action_execution_id,v.config_hash,
                jsonb_build_object('trigger',v.trigger,'action',v.action,
                'approvalPolicyId',v.approval_policy_id,'resultTarget',v.result_target)
                || case when v.approval_policy_version is null then '{}'::jsonb else jsonb_build_object('approvalPolicyVersion',v.approval_policy_version) end
                || case when v.name is null then '{}'::jsonb else jsonb_build_object('name',v.name) end content
                from catalog.automation_version v join catalog.asset a on a.id=v.asset_id
                where v.asset_id=$1 and v.automation_resource_id=$2 and v.state='PUBLISHED'
                  and a.tenant_id=$3 and a.resource_id=$2 and a.state='PUBLISHED' and a.version=$4
                  and a.type_key='automation.version'
                  and a.projection_action_execution_id is null for update of a,v",
            )
            .bind(p.asset_id)
            .bind(row.id)
            .bind(ae.tenant_id)
            .bind(p.asset_version)
            .fetch_optional(&mut **tx)
            .await?;
            let version = version.ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
            if collab_bridge::limits::canonical_digest(&version.content) != version.config_hash
                || !crate::agent_definition::active_owner(
                    tx,
                    ae.tenant_id,
                    version.owner_principal_id,
                )
                .await?
                || !g
                    .spicedb
                    .asset_projection_matches(
                        &version.asset_id.to_string(),
                        &ae.tenant_id.to_string(),
                        &row.id.to_string(),
                        &version.owner_principal_id.to_string(),
                        g.cfg.relationship_page,
                    )
                    .await
                    .map_err(|_| {
                        Refusal::Unavailable("Automation Version owner 投影不可核验".into())
                    })?
            {
                return Err(Refusal::Precondition(ReasonCode::ProjectionDelayed));
            }
            management_installation(
                g,
                tx,
                ae.tenant_id,
                row.workspace_id,
                row.executor_installation_resource_id,
                row.owner_principal_id,
                &version.content,
            )
            .await?;
            management_grant(g, tx, &row, p).await?;
            let schedule_id = (version
                .content
                .pointer("/trigger/kind")
                .and_then(Value::as_str)
                == Some("SCHEDULE"))
            .then(|| {
                format!(
                    "platform:automation_schedule:{}:{}:{}",
                    ae.tenant_id, row.id, ae.id
                )
            });
            let webhook = webhook_secret::freeze(g, tx, ae, &row).await?;
            sqlx::query("update catalog.automation_definition set pinned_version_asset_id=$2,delegation_id=$3,schedule_id=$4,
                webhook_secret_ref=coalesce($5,webhook_secret_ref),
                state='ENABLED',enabled_at=clock_timestamp(),version=version+1 where resource_id=$1")
                .bind(row.id).bind(p.asset_id).bind(p.delegation_id).bind(&schedule_id).bind(webhook).execute(&mut **tx).await?;
            sqlx::query("update catalog.resource set version=version+1 where id=$1")
                .bind(row.id)
                .execute(&mut **tx)
                .await?;
            schedule::freeze(
                tx,
                ae,
                &row,
                schedule_id.as_deref(),
                Some(&version.content),
                sem,
            )
            .await?;
            Ok(())
        }
        Semantic::AutomationPause | Semantic::AutomationDisable | Semantic::AutomationDelete => {
            if matches!(
                sem,
                Semantic::AutomationDisable | Semantic::AutomationDelete
            ) {
                webhook_secret::freeze(g, tx, ae, &row).await?;
            }
            sqlx::query("update catalog.automation_definition set state=$2,version=version+1 where resource_id=$1")
                .bind(row.id).bind(if sem==Semantic::AutomationPause{"PAUSED"}else{"DISABLED"})
                .execute(&mut **tx).await?;
            sqlx::query("update catalog.resource set version=version+1 where id=$1")
                .bind(row.id)
                .execute(&mut **tx)
                .await?;
            schedule::freeze(tx, ae, &row, None, None, sem).await?;
            if sem == Semantic::AutomationDelete {
                let intents: bool = sqlx::query_scalar("select parameters ?| array['scheduleIntent','webhookSecretIntent'] from admission.action_execution where id=$1")
                    .bind(ae.id).fetch_one(&mut **tx).await?;
                if !intents {
                    tombstone(tx, ae).await?;
                }
            }
            Ok(())
        }
        _ => Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)),
    }
}

async fn management_insert_version(
    tx: &mut Transaction<'_, Postgres>,
    ae: &governance::Execution,
    resource: Uuid,
    content: Value,
) -> Result<(), Refusal> {
    let ordinal:i32=sqlx::query_scalar("select coalesce(max(ordinal),0)+1 from catalog.automation_version where automation_resource_id=$1")
        .bind(resource).fetch_one(&mut **tx).await?;
    let approval = content
        .get("approvalPolicyId")
        .and_then(Value::as_str)
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| invalid_management())?;
    sqlx::query("insert into catalog.asset
        (id,tenant_id,resource_id,type_key,owner_principal_id,producer_principal_id,native_ref,state,version,projection_action_execution_id)
        values($1,$2,$3,'automation.version',$4,$4,$1::text,'DRAFT',1,$1)")
        .bind(ae.id).bind(ae.tenant_id).bind(resource).bind(ae.initiator_principal_id).execute(&mut **tx).await?;
    sqlx::query("insert into catalog.automation_version
        (asset_id,automation_resource_id,ordinal,trigger,action,approval_policy_id,result_target,config_hash,state,approval_policy_version,name)
        values($1,$2,$3,$4,$5,$6,$7,$8,'DRAFT',$9,$10)")
        .bind(ae.id).bind(resource).bind(ordinal).bind(&content["trigger"]).bind(&content["action"])
        .bind(approval).bind(content["resultTarget"].as_str()).bind(collab_bridge::limits::canonical_digest(&content))
        .bind(content.get("approvalPolicyVersion").and_then(Value::as_i64).and_then(|v|i32::try_from(v).ok()))
        .bind(content.get("name").and_then(Value::as_str))
        .execute(&mut **tx).await?;
    Ok(())
}

async fn management_grant(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    row: &ManagementResource,
    p: &governance::Params,
) -> Result<(), Refusal> {
    let run_def = definition(g).await?;
    let grant: Option<Uuid> = sqlx::query_scalar(
        "select id from admission.delegation_grant
        where id=$1 and version=$2 and tenant_id=$3 and workspace_id=$4
          and grantor_principal_id=$5 and installation_resource_id=$6 and state='ACTIVE'
          and valid_from<=clock_timestamp() and expires_at>clock_timestamp() for update",
    )
    .bind(p.delegation_id)
    .bind(p.delegation_version)
    .bind(row.tenant_id)
    .bind(row.workspace_id)
    .bind(row.owner_principal_id)
    .bind(row.executor_installation_resource_id)
    .fetch_optional(&mut **tx)
    .await?;
    if grant.is_none() {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let allowed:bool=sqlx::query_scalar("select exists(select 1 from admission.delegation_grant g
        join admission.delegation_scope scope on scope.delegation_id=g.id
        join catalog.agent_installation i on i.resource_id=g.installation_resource_id
        join catalog.result_exposure_policy exposure on exposure.id=scope.result_exposure_policy_id
          and exposure.version=scope.result_exposure_policy_version
        where g.id=$1 and g.version=$2 and g.tenant_id=$3 and g.workspace_id=$4
          and g.grantor_principal_id=$5 and g.installation_resource_id=$6
          and g.agent_principal_id=i.agent_principal_id and g.state='ACTIVE'
          and g.valid_from<=clock_timestamp() and g.expires_at>clock_timestamp()
          and (g.max_uses is null or g.max_uses>(select count(*) from admission.delegation_use u where u.delegation_id=g.id))
          and scope.action_key=$7 and scope.action_version=$8 and scope.target_type='RESOURCE' and scope.target_id=$9
          and scope.create_workspace_id is null and scope.tool_resource_id is null
          and exposure.tenant_id=$3 and exposure.status='ACTIVE' and exposure.mode='CONSUME_ONLY'
          and exposure.output_schema_hash=any($10) and exposure.redaction_policy=$11)")
        .bind(p.delegation_id).bind(p.delegation_version).bind(row.tenant_id).bind(row.workspace_id)
        .bind(row.owner_principal_id).bind(row.executor_installation_resource_id).bind(ACTION).bind(run_def.version)
        .bind(row.id).bind(crate::governance::delegation::metadata_output_schema_hashes("automation.run")).bind("PLATFORM_METADATA_ONLY").fetch_one(&mut **tx).await?;
    if !allowed {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    // Grant 行锁覆盖 revoke；到期仍按时钟判定，管理 NONE 不读额度或占用次数。
    let agent: Uuid = sqlx::query_scalar(
        "select agent_principal_id from catalog.agent_installation where resource_id=$1",
    )
    .bind(row.executor_installation_resource_id)
    .fetch_one(&mut **tx)
    .await?;
    for principal in [row.owner_principal_id, agent] {
        let checked = g
            .spicedb
            .check(
                "resource",
                &row.id.to_string(),
                "execute",
                &principal.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| Refusal::Unavailable("Automation execute 不可核验".into()))?;
        if checked.zed_token.is_empty() {
            return Err(Refusal::Unavailable(
                "Automation execute 缺原生 checked revision".into(),
            ));
        }
        if !checked.allowed {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
    }
    let valid: bool = sqlx::query_scalar(
        "select valid_from<=clock_timestamp() and expires_at>clock_timestamp()
        from admission.delegation_grant where id=$1 and state='ACTIVE'",
    )
    .bind(p.delegation_id)
    .fetch_one(&mut **tx)
    .await?;
    if !valid {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    Ok(())
}

/// Delegation消费的是已接入Relay→Invocation→Task的原run合同，不走HUMAN管理Semantic。
pub(crate) async fn delegation_target(
    g: &Governance,
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    workspace: Uuid,
    installation: Uuid,
    human: Uuid,
    target: (Uuid, i64),
) -> Result<(), Refusal> {
    let (target, action_version) = target;
    let def = definition(g).await?;
    if i64::from(def.version) != action_version {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let row = management_resource(conn, tenant, target, false)
        .await?
        .filter(|row| {
            row.workspace_id == workspace
                && row.executor_installation_resource_id == installation
                && row.owner_principal_id == human
                && row.state == "ACTIVE"
                && row.projection_action_execution_id.is_none()
        })
        .ok_or(Refusal::Denied(ReasonCode::ScopeGuardFailed))?;
    if !management_projection(g, &row).await? {
        return Err(Refusal::Precondition(ReasonCode::ProjectionDelayed));
    }
    Ok(())
}

#[derive(FromRow)]
struct ManagementVersion {
    asset_id: Uuid,
    owner_principal_id: Uuid,
    state: String,
    projection_action_execution_id: Option<Uuid>,
    config_hash: String,
    content: Value,
}

/// Native lifecycle work cannot inherit the local SYNC transaction's success.
pub(crate) async fn defer_management_dispatch(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "update admission.action_execution
         set dispatch_state=case when parameters ?| array['scheduleIntent','webhookSecretIntent']
           then 'NOT_DISPATCHED' else dispatch_state end
         where id=$1 and gate_state='ALLOWED' and dispatch_state='DISPATCHED'
           and action_key in ('automation.enable','automation.pause','automation.disable','automation.delete','automation.rotate_webhook_secret')
         returning coalesce(parameters ?| array['scheduleIntent','webhookSecretIntent'],false)",
    )
    .bind(id)
    .fetch_one(&mut **tx)
    .await
}

fn management_intents_complete(parameters: &Value) -> bool {
    let intents = ["scheduleIntent", "webhookSecretIntent"];
    intents.iter().any(|key| parameters.get(key).is_some())
        && intents.iter().all(|key| {
            parameters
                .get(key)
                .is_none_or(|intent| intent["complete"] == true)
        })
}

/// Called under the original AE/resource locks, only after native read-back.
/// The last receipt owns the single dispatch/audit terminal and projection unlock.
async fn complete_management_intent(
    tx: &mut Transaction<'_, Postgres>,
    ae: &governance::Execution,
    def: &Definition,
    key: &str,
) -> Result<(), Refusal> {
    let parameters: Value = sqlx::query_scalar(
        "update admission.action_execution set parameters=jsonb_set(parameters,ARRAY[$2,'complete'],'true'::jsonb)
         where id=$1 and parameters ? $2 returning parameters",
    )
    .bind(ae.id).bind(key).fetch_one(&mut **tx).await?;
    if !management_intents_complete(&parameters) {
        governance::record_dispatch(
            tx,
            ae.id,
            def.audit_class(),
            Err(axum::http::StatusCode::SERVICE_UNAVAILABLE),
            Vec::new(),
        )
        .await?;
        return Ok(());
    }
    if ae.action_key == "automation.delete" && parameters["webhookSecretIntent"]["aborting"] != true
    {
        tombstone(tx, ae).await?;
    }
    sqlx::query("update catalog.resource set projection_action_execution_id=null where id=$1 and projection_action_execution_id=$2")
        .bind(ae.target_id).bind(ae.id).execute(&mut **tx).await?;
    let outcome = if parameters["webhookSecretIntent"]["aborting"] == true {
        Err(axum::http::StatusCode::FORBIDDEN)
    } else {
        Ok(())
    };
    governance::record_dispatch(tx, ae.id, def.audit_class(), outcome, Vec::new()).await?;
    Ok(())
}

/// Only the original management transaction / last native receipt reaches this
/// tombstone. Resource permissions and every admitted run remain untouched.
async fn tombstone(
    tx: &mut Transaction<'_, Postgres>,
    ae: &governance::Execution,
) -> Result<(), Refusal> {
    let changed = sqlx::query(
        "update catalog.automation_definition d set state='DELETED',version=d.version+1
        from catalog.resource r where d.resource_id=$1 and r.id=d.resource_id and r.tenant_id=$2
          and d.state='DISABLED' and d.schedule_id is null and d.webhook_secret_ref is null
          and (r.projection_action_execution_id is null or r.projection_action_execution_id=$3)",
    )
    .bind(ae.target_id)
    .bind(ae.tenant_id)
    .bind(ae.id)
    .execute(&mut **tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    Ok(())
}

/// create/publish 的唯一派发入口。native关系写入的未知结果沿同AE读回，不分配新ID。
pub(crate) async fn management_dispatch(
    g: &Governance,
    id: Uuid,
    def: &Definition,
    sem: governance::Semantic,
) -> Result<(), Refusal> {
    use governance::Semantic;
    let mut tx = g.pool.begin().await?;
    let ae = governance::lock_execution(&mut tx, id).await?;
    if ae.gate_state != "ALLOWED"
        || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
    {
        return Ok(());
    }
    let creating = sem == Semantic::AutomationCreate;
    if !creating && sem != Semantic::AutomationPublish {
        drop(tx);
        // Finish credential preparation before touching the previous Schedule.
        // Both native receipts still belong to this original management AE.
        webhook_secret::dispatch(g, id, def).await?;
        let mut tx = g.pool.begin().await?;
        let latest = governance::lock_execution(&mut tx, id).await?;
        let secret = latest
            .parameters
            .as_ref()
            .and_then(|p| p.get("webhookSecretIntent"));
        if secret.is_some_and(|intent| intent["complete"] != true) {
            return Ok(());
        }
        drop(tx);
        return schedule::dispatch(g, id, def, sem).await;
    }
    let active: bool =
        sqlx::query_scalar("select state='ACTIVE' from identity.tenant where id=$1 for update")
            .bind(ae.tenant_id)
            .fetch_optional(&mut *tx)
            .await?
            .unwrap_or(false);
    let row = management_resource(&mut tx, ae.tenant_id, ae.target_id, true)
        .await?
        .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    let version:ManagementVersion=sqlx::query_as("select a.id asset_id,a.owner_principal_id,a.state,
        a.projection_action_execution_id,v.config_hash,jsonb_build_object('trigger',v.trigger,'action',v.action,
          'approvalPolicyId',v.approval_policy_id,'resultTarget',v.result_target)
          || case when v.approval_policy_version is null then '{}'::jsonb else jsonb_build_object('approvalPolicyVersion',v.approval_policy_version) end
          || case when v.name is null then '{}'::jsonb else jsonb_build_object('name',v.name) end content
        from catalog.asset a join catalog.automation_version v on v.asset_id=a.id
        where a.id=$1 and a.tenant_id=$2 and a.resource_id=$3 and a.type_key='automation.version'
          and v.automation_resource_id=$3 for update of a,v")
        .bind(ae.id).bind(ae.tenant_id).bind(row.id).fetch_one(&mut *tx).await?;
    if version.projection_action_execution_id != Some(ae.id)
        || version.state != "DRAFT"
        || collab_bridge::limits::canonical_digest(&version.content) != version.config_hash
        || (creating && row.projection_action_execution_id != Some(ae.id))
    {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let workspace: Option<Uuid> = sqlx::query_scalar(
        "select id from identity.workspace
        where id=$1 and tenant_id=$2 and state='ACTIVE' for update",
    )
    .bind(row.workspace_id)
    .bind(ae.tenant_id)
    .fetch_optional(&mut *tx)
    .await?;
    let valid = active
        && workspace.is_some()
        && crate::agent_definition::active_owner(&mut tx, ae.tenant_id, row.owner_principal_id)
            .await?
        && crate::agent_definition::active_owner(&mut tx, ae.tenant_id, version.owner_principal_id)
            .await?
        && crate::agent_definition::active_owner(&mut tx, ae.tenant_id, ae.initiator_principal_id)
            .await?
        && if creating {
            row.state == "PROVISIONING"
        } else {
            row.state == "ACTIVE"
                && row.projection_action_execution_id.is_none()
                && Some(row.version) == ae.frozen_target_version()
        };
    if !valid {
        return management_abort(g, tx, &ae, def, &row, version.asset_id, creating).await;
    }
    if let Err(error) = management_authorized(g, &mut tx, &ae, def, &row).await {
        return match error {
            Refusal::Unavailable(_) => management_unknown(tx, &ae, def).await,
            _ => management_abort(g, tx, &ae, def, &row, version.asset_id, creating).await,
        };
    }
    if !creating {
        if let Err(error) = management_installation(
            g,
            &mut tx,
            ae.tenant_id,
            row.workspace_id,
            row.executor_installation_resource_id,
            ae.initiator_principal_id,
            &version.content,
        )
        .await
        {
            return match error {
                Refusal::Unavailable(_) => management_unknown(tx, &ae, def).await,
                _ => management_abort(g, tx, &ae, def, &row, version.asset_id, false).await,
            };
        }
    }
    // Resolve from the frozen definition, never the request's principal. Row
    // locks cover revoke/retire while the original AE performs its projection.
    let executor: Option<Uuid> = sqlx::query_scalar(
        "select i.agent_principal_id from catalog.agent_installation i
        join catalog.resource r on r.id=i.resource_id
        join identity.principal p on p.id=i.agent_principal_id
        where i.resource_id=$1 and i.workspace_id=$2 and i.state='ACTIVE'
          and r.tenant_id=$3 and r.home_workspace_id=$2 and r.type_key='agent.installation'
          and r.state='ACTIVE' and r.projection_action_execution_id is null
          and p.tenant_id=$3 and p.kind='AGENT' and p.status='ACTIVE'
        for update of i,r,p",
    )
    .bind(row.executor_installation_resource_id)
    .bind(row.workspace_id)
    .bind(row.tenant_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(executor) = executor else {
        return management_abort(g, tx, &ae, def, &row, version.asset_id, creating).await;
    };
    let parent = match management_projection(g, &row).await {
        Ok(matched) => matched,
        Err(_) => return management_unknown(tx, &ae, def).await,
    };
    if !parent {
        if !creating {
            return management_unknown(tx, &ae, def).await;
        }
        if g.spicedb
            .replace_resource_projection(
                &row.id.to_string(),
                &row.tenant_id.to_string(),
                &row.owner_principal_id.to_string(),
                &row.owner_principal_id.to_string(),
                Some(&row.workspace_id.to_string()),
            )
            .await
            .is_err()
        {
            return management_unknown(tx, &ae, def).await;
        }
    }
    // A publish of an existing definition also reconciles this exact original
    // authority; missing legacy projection is not repaired through a DB seed.
    if project_executor(&g.spicedb, row.id, executor, g.cfg.relationship_page)
        .await
        .is_err()
    {
        return management_unknown(tx, &ae, def).await;
    }
    let asset = match g
        .spicedb
        .asset_projection_matches(
            &version.asset_id.to_string(),
            &row.tenant_id.to_string(),
            &row.id.to_string(),
            &version.owner_principal_id.to_string(),
            g.cfg.relationship_page,
        )
        .await
    {
        Ok(matched) => matched,
        Err(_) => return management_unknown(tx, &ae, def).await,
    };
    if !asset
        && g.spicedb
            .write_asset_projection(
                &version.asset_id.to_string(),
                &row.tenant_id.to_string(),
                &row.id.to_string(),
                &version.owner_principal_id.to_string(),
            )
            .await
            .is_err()
    {
        return management_unknown(tx, &ae, def).await;
    }
    if !matches!(management_projection(g, &row).await, Ok(true))
        || !matches!(
            g.spicedb
                .asset_projection_matches(
                    &version.asset_id.to_string(),
                    &row.tenant_id.to_string(),
                    &row.id.to_string(),
                    &version.owner_principal_id.to_string(),
                    g.cfg.relationship_page
                )
                .await,
            Ok(true)
        )
    {
        return management_unknown(tx, &ae, def).await;
    }
    let proof = match g
        .spicedb
        .check(
            "asset",
            &version.asset_id.to_string(),
            "read",
            &version.owner_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
    {
        Ok(proof) if proof.allowed && !proof.zed_token.is_empty() => proof.zed_token,
        _ => return management_unknown(tx, &ae, def).await,
    };
    sqlx::query(
        "update catalog.asset set projection_action_execution_id=null,version=version+1,
        state=case when $2 then 'DRAFT' else 'PUBLISHED' end where id=$1",
    )
    .bind(version.asset_id)
    .bind(creating)
    .execute(&mut *tx)
    .await?;
    if !creating {
        sqlx::query("update catalog.automation_version set state='PUBLISHED' where asset_id=$1 and state='DRAFT'")
            .bind(version.asset_id).execute(&mut *tx).await?;
    }
    sqlx::query("update catalog.resource set state='ACTIVE',version=version+1,projection_action_execution_id=null where id=$1")
        .bind(row.id).execute(&mut *tx).await?;
    governance::record_dispatch(
        &mut tx,
        ae.id,
        def.audit_class(),
        Ok(()),
        vec![crate::audit::Evidence::new(
            contracts::EvidenceKind::SpicedbZedtoken,
            proof,
        )],
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

async fn management_authorized(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    ae: &governance::Execution,
    def: &Definition,
    row: &ManagementResource,
) -> Result<(), Refusal> {
    let membership: Option<String> = sqlx::query_scalar(
        "select state from identity.workspace_membership
        where workspace_id=$1 and tenant_principal_id=$2 for update",
    )
    .bind(row.workspace_id)
    .bind(ae.initiator_principal_id)
    .fetch_optional(&mut **tx)
    .await?;
    if membership.as_deref() != Some("ACTIVE") {
        let (kind, id) = if membership.is_some() {
            ("tenant", row.tenant_id)
        } else {
            ("workspace", row.workspace_id)
        };
        let checked = g
            .spicedb
            .check(
                kind,
                &id.to_string(),
                "manage",
                &ae.initiator_principal_id.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| Refusal::Unavailable("Automation Workspace 资格不可核验".into()))?;
        if checked.zed_token.is_empty() {
            return Err(Refusal::Unavailable(
                "Automation scope 缺原生 checked revision".into(),
            ));
        }
        if !checked.allowed {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
    }
    let object = if def.permission_object_type == "workspace" {
        row.workspace_id
    } else {
        row.id
    };
    let checked = g
        .spicedb
        .check(
            &def.permission_object_type,
            &object.to_string(),
            &def.permission,
            &ae.initiator_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Automation fresh authorization 不可核验".into()))?;
    if checked.zed_token.is_empty() {
        return Err(Refusal::Unavailable(
            "Automation authorization 缺原生 checked revision".into(),
        ));
    }
    if !checked.allowed {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    Ok(())
}

async fn management_unknown(
    mut tx: Transaction<'_, Postgres>,
    ae: &governance::Execution,
    def: &Definition,
) -> Result<(), Refusal> {
    governance::record_dispatch(
        &mut tx,
        ae.id,
        def.audit_class(),
        Err(axum::http::StatusCode::SERVICE_UNAVAILABLE),
        Vec::new(),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

async fn management_abort(
    g: &Governance,
    mut tx: Transaction<'_, Postgres>,
    ae: &governance::Execution,
    def: &Definition,
    row: &ManagementResource,
    asset: Uuid,
    creating: bool,
) -> Result<(), Refusal> {
    let proof = match g.spicedb.delete_asset_projection(asset).await {
        Ok(proof) if !proof.is_empty() => proof,
        _ => return management_unknown(tx, ae, def).await,
    };
    let mut evidence = vec![crate::audit::Evidence::new(
        contracts::EvidenceKind::SpicedbZedtoken,
        proof,
    )];
    if creating {
        let parent_proof = match g.spicedb.delete_resource_projection(row.id).await {
            Ok(proof) if !proof.is_empty() => proof,
            _ => return management_unknown(tx, ae, def).await,
        };
        evidence.push(crate::audit::Evidence::new(
            contracts::EvidenceKind::SpicedbZedtoken,
            parent_proof,
        ));
        sqlx::query("update catalog.automation_definition set state='DISABLED',version=version+1 where resource_id=$1")
            .bind(row.id).execute(&mut *tx).await?;
        sqlx::query("update catalog.resource set state='FAILED',version=version+1,projection_action_execution_id=null where id=$1")
            .bind(row.id).execute(&mut *tx).await?;
    }
    sqlx::query("update catalog.automation_version set state='RETIRED' where asset_id=$1")
        .bind(asset)
        .execute(&mut *tx)
        .await?;
    sqlx::query("update catalog.asset set state='DELETED',version=version+1,projection_action_execution_id=null where id=$1")
        .bind(asset).execute(&mut *tx).await?;
    governance::record_dispatch(
        &mut tx,
        ae.id,
        def.audit_class(),
        Err(axum::http::StatusCode::FORBIDDEN),
        evidence,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

#[derive(FromRow)]
struct Run {
    resource_id: Uuid,
    tenant_id: Uuid,
    workspace_id: Uuid,
    resource_version: i32,
    owner_principal_id: Uuid,
    human_identity_id: Option<Uuid>,
    executor_installation_resource_id: Uuid,
    agent_principal_id: Uuid,
    delegation_id: Uuid,
    automation_version_asset_id: Uuid,
    automation_version: i32,
    agent_version_asset_id: Uuid,
    projection_generation: i64,
    trigger: Value,
    action: Value,
    approval_policy_id: Option<Uuid>,
    approval_policy_version: Option<i32>,
    result_target: String,
    name: Option<String>,
    config_hash: String,
    enabled_at: DateTime<Utc>,
    version_owner_principal_id: Uuid,
}

// 同一 scope 的真实对象，不从当前 pointer 推断已经冻结的 Invocation。
const RUN: &str = "select r.id resource_id,r.tenant_id,d.workspace_id,r.version resource_version,
    r.owner_principal_id,tm.human_identity_id,i.resource_id executor_installation_resource_id,
    i.agent_principal_id,case when $2::uuid is null then d.delegation_id else invocation.delegation_id end delegation_id,
    v.asset_id automation_version_asset_id,a.version automation_version,p.agent_version_asset_id,
    p.generation projection_generation,v.trigger,v.action,v.approval_policy_id,v.approval_policy_version,
    v.result_target,v.name,v.config_hash,d.enabled_at,a.owner_principal_id version_owner_principal_id
    from catalog.automation_definition d join catalog.resource r on r.id=d.resource_id
    join catalog.resource_type_definition type on type.type_key=r.type_key
    left join catalog.agent_invocation invocation on invocation.id=$2 and invocation.automation_resource_id=r.id
      and invocation.tenant_id=r.tenant_id and invocation.workspace_id=d.workspace_id
    join catalog.automation_version v on v.asset_id=case when $2::uuid is null then d.pinned_version_asset_id
      else invocation.automation_version_asset_id end and v.automation_resource_id=r.id
    join catalog.asset a on a.id=v.asset_id and a.resource_id=r.id and a.tenant_id=r.tenant_id
    join identity.tenant t on t.id=r.tenant_id
    join identity.workspace w on w.id=d.workspace_id and w.tenant_id=t.id
    join identity.principal owner on owner.id=r.owner_principal_id and owner.tenant_id=t.id
    join identity.tenant_membership tm on tm.tenant_principal_id=owner.id and tm.tenant_id=t.id
    join identity.principal version_owner on version_owner.id=a.owner_principal_id and version_owner.tenant_id=t.id
    join identity.tenant_membership version_tm on version_tm.tenant_principal_id=version_owner.id and version_tm.tenant_id=t.id
    join catalog.agent_installation i on i.resource_id=case when $2::uuid is null then d.executor_installation_resource_id
      else invocation.installation_resource_id end and i.workspace_id=w.id
    join catalog.resource ir on ir.id=i.resource_id and ir.tenant_id=t.id and ir.home_workspace_id=w.id
    join identity.principal agent on agent.id=i.agent_principal_id and agent.tenant_id=t.id
    join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
      and p.generation=case when $2::uuid is null then i.active_projection_generation else invocation.projection_generation end
      and p.agent_version_asset_id=case when $2::uuid is null then i.pinned_version_asset_id else invocation.agent_version_asset_id end
    where r.id=$1 and r.type_key='automation' and r.home_workspace_id=w.id
      and r.application_binding_id is null and r.state='ACTIVE' and r.projection_action_execution_id is null
      and type.status='ACTIVE' and d.enabled_at is not null
      and (($2::uuid is null and d.state='ENABLED') or ($2::uuid is not null
        and d.state in ('ENABLED','PAUSED','DISABLED','DELETED') and invocation.id is not null
        and invocation.status in ('CREATED','DISPATCHING','RUNNING','UNKNOWN') and not invocation.cancel_pending))
      and t.state='ACTIVE' and w.state='ACTIVE' and v.state='PUBLISHED' and a.state='PUBLISHED'
      and a.type_key='automation.version' and a.projection_action_execution_id is null
      and owner.kind='HUMAN' and owner.status='ACTIVE' and tm.state='ACTIVE'
      and version_owner.kind='HUMAN' and version_owner.status='ACTIVE' and version_tm.state='ACTIVE'
      and ir.type_key='agent.installation' and ir.state='ACTIVE'
      and (($2::uuid is null and ir.projection_action_execution_id is null and i.state='ACTIVE')
        or ($2::uuid is not null and catalog.agent_generation_admitted(i.resource_id,p.agent_version_asset_id,p.generation)))
      and agent.kind='AGENT' and agent.status='ACTIVE' and p.state='ACTIVE'";

async fn run(
    tx: &mut Transaction<'_, Postgres>,
    resource: Uuid,
    invocation: Option<Uuid>,
) -> Result<Run, Refusal> {
    sqlx::query_as(&format!(
        "{RUN} for update of r,d,a,v,w,owner,tm,version_owner,version_tm,ir,i,agent,p"
    ))
    .bind(resource)
    .bind(invocation)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(Refusal::Precondition(ReasonCode::TargetStateConflict))
}

async fn definition(g: &Governance) -> Result<Definition, Refusal> {
    let meters = configured_run_meters()
        .map_err(|_| Refusal::Blocked(ReasonCode::CapabilityBlocked))?
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    let def = governance::active_definition(&g.pool, ACTION)
        .await?
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    if def.target_type != "RESOURCE"
        || def.tenant_rule != "SESSION_TENANT"
        || def.workspace_rule != "TARGET_HOME_WORKSPACE"
        || def.permission != "execute"
        || def.permission_object_type != "resource"
        || def.execution_mode != "TEMPORAL"
        || def.workflow_kind.is_some()
        || def.confirmation_mode != "NONE"
        || def.approval_policy_id.is_some()
        || def.approval_policy_version.is_some()
        || def.result_exposure != "NONE"
        || def.quota_policy != "CHECK"
        || def.meters != meters
        || def.component_type_key != "core"
        || def.role_template_key.is_some()
        || def.role_template_version.is_some()
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let configured_pool = std::env::var("AGENT_CAPACITY_POOL_KEY")
        .ok()
        .filter(|key| !key.trim().is_empty())
        .ok_or(Refusal::Precondition(ReasonCode::CapabilityBlocked))?;
    let contract: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.action_definition
        where action_key=$1 and version=$2 and status='ACTIVE' and workflow_type=$3
          and capacity_policy='PLATFORM_SLOT' and capacity_pool_key=$4
          and audit_policy='FULL_LIFECYCLE' and obs_correlation_mode='OPERATION_REF'
          and obs_progress_source='TEMPORAL' and obs_terminal_source='TEMPORAL'
          and obs_usage_source='OPENMETER' and obs_cost_source='NONE'
          and obs_redaction_policy='PLATFORM_METADATA_ONLY')",
    )
    .bind(ACTION)
    .bind(def.version)
    .bind(crate::agent_task::WORKFLOW_TYPE)
    .bind(configured_pool)
    .fetch_one(&g.pool)
    .await?;
    if !contract {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    Ok(def)
}

async fn fresh(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    row: &Run,
    def: &Definition,
    operation: Option<Uuid>,
) -> Result<String, Refusal> {
    // Policy selection is immutable version metadata; the child gate runs in
    // AgentTask before Capacity or the first external business side effect.
    if !steps::supported(&row.action)
        || !matches!(
            row.trigger.get("kind").and_then(Value::as_str),
            Some("CHANNEL_MESSAGE" | "MENTION" | "SCHEDULE")
        )
        || row.result_target
            != if row.trigger.get("kind").and_then(Value::as_str) == Some("SCHEDULE") {
                "CHANNEL"
            } else {
                "TRIGGER_THREAD"
            }
        || row.config_hash
            != collab_bridge::limits::canonical_digest(&version_content(
                row.trigger.clone(),
                row.action.clone(),
                row.approval_policy_id,
                row.approval_policy_version,
                &row.result_target,
                row.name.as_deref(),
            ))
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    step_approval::validate_policy(
        tx,
        row.tenant_id,
        row.approval_policy_id,
        row.approval_policy_version,
        false,
    )
    .await?;
    let grant: Option<(Uuid,Uuid,Uuid,Uuid,Uuid,Option<i64>)> = sqlx::query_as(
        "select tenant_id,workspace_id,grantor_principal_id,installation_resource_id,agent_principal_id,max_uses
         from admission.delegation_grant where id=$1 and state='ACTIVE' and valid_from<=clock_timestamp() and expires_at>clock_timestamp()
         for update")
        .bind(row.delegation_id).fetch_optional(&mut **tx).await?;
    let Some((tenant, workspace, human, installation, agent, max_uses)) = grant else {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    };
    if (tenant, workspace, human, installation, agent)
        != (
            row.tenant_id,
            row.workspace_id,
            row.owner_principal_id,
            row.executor_installation_resource_id,
            row.agent_principal_id,
        )
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let scope: bool = sqlx::query_scalar("select exists(select 1 from admission.delegation_scope s
        join catalog.result_exposure_policy p on p.id=s.result_exposure_policy_id and p.version=s.result_exposure_policy_version
        where s.delegation_id=$1 and s.action_key=$2 and s.action_version=$3 and s.target_type='RESOURCE'
          and s.target_id=$4 and s.create_workspace_id is null and s.tool_resource_id is null
          and p.tenant_id=$5 and p.status='ACTIVE' and p.mode='CONSUME_ONLY'
          and p.output_schema_hash=any($6) and p.redaction_policy=$7)")
        .bind(row.delegation_id).bind(ACTION).bind(def.version).bind(row.resource_id).bind(row.tenant_id)
        .bind(crate::governance::delegation::metadata_output_schema_hashes("automation.run")).bind("PLATFORM_METADATA_ONLY").fetch_one(&mut **tx).await?;
    if !scope {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let used: bool = match operation {
        Some(operation) => sqlx::query_scalar("select exists(select 1 from admission.delegation_use where delegation_id=$1 and operation_id=$2)")
            .bind(row.delegation_id).bind(operation).fetch_one(&mut **tx).await?,
        None => false,
    };
    let count: i64 =
        sqlx::query_scalar("select count(*) from admission.delegation_use where delegation_id=$1")
            .bind(row.delegation_id)
            .fetch_one(&mut **tx)
            .await?;
    if !used && max_uses.is_some_and(|max| count >= max) {
        return Err(Refusal::Limit(ReasonCode::QuotaExhausted));
    }
    if operation.is_some() && !used {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let projection = g
        .spicedb
        .resource_projection_matches_in_workspace(
            &row.resource_id.to_string(),
            &row.tenant_id.to_string(),
            &row.owner_principal_id.to_string(),
            Some(&row.workspace_id.to_string()),
            g.cfg.relationship_page,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Automation owner 投影不可核验".into()))?;
    if !projection {
        return Err(Refusal::Precondition(ReasonCode::ProjectionDelayed));
    }
    if !g
        .spicedb
        .asset_projection_matches(
            &row.automation_version_asset_id.to_string(),
            &row.tenant_id.to_string(),
            &row.resource_id.to_string(),
            &row.version_owner_principal_id.to_string(),
            g.cfg.relationship_page,
        )
        .await
        .map_err(|_| Refusal::Unavailable("AutomationVersion owner 投影不可核验".into()))?
    {
        return Err(Refusal::Precondition(ReasonCode::ProjectionDelayed));
    }
    let mut revision = None;
    for (object, permission, subject) in [
        (row.resource_id, "execute", row.owner_principal_id),
        (row.resource_id, "execute", row.agent_principal_id),
        (row.resource_id, "delegate", row.owner_principal_id),
    ] {
        let checked = g
            .spicedb
            .check(
                "resource",
                &object.to_string(),
                permission,
                &subject.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| Refusal::Unavailable("Automation fresh permission 不可核验".into()))?;
        if checked.zed_token.is_empty() {
            return Err(Refusal::Unavailable(
                "Automation permission 缺原生 revision".into(),
            ));
        }
        if !checked.allowed {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
        revision = Some(checked.zed_token);
    }
    // DD-107: the registered meter set is the maximum for this Action. A
    // template publication does not request or consume model capacity/quota.
    let mut effective = def.clone();
    if row
        .action
        .get("kind")
        .and_then(Value::as_str)
        .is_some_and(crate::automation::steps::is_message_kind)
    {
        effective.meters.retain(|meter| meter == "automation.run");
    }
    g.check_automation_quota(row.tenant_id, &effective).await?;
    // 外部 permission、runtime 与 quota 读取可能跨过到期时刻；原 Grant 行锁
    // 阻止 revoke 写入，但不能冻结时钟。每个真实副作用前按当前数据库时钟收口。
    let still_valid: bool = sqlx::query_scalar(
        "select exists(select 1 from admission.delegation_grant
         where id=$1 and state='ACTIVE' and valid_from<=clock_timestamp()
           and expires_at>clock_timestamp())",
    )
    .bind(row.delegation_id)
    .fetch_one(&mut **tx)
    .await?;
    if !still_valid {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    revision.ok_or_else(|| Refusal::Unavailable("Automation permission 未读取".into()))
}

#[derive(FromRow)]
struct FrozenInvocation {
    automation_resource_id: Uuid,
    automation_version_asset_id: Uuid,
    action_execution_id: Uuid,
    operation_id: Uuid,
    action_version: i32,
    agent_version_asset_id: Uuid,
    projection_generation: i64,
    delegation_id: Uuid,
    source_event_id: String,
    root_event_id: String,
    source_kind: String,
}

const FROZEN_INVOCATION_SQL: &str = "select i.automation_resource_id,i.automation_version_asset_id,i.action_execution_id,a.operation_id,
            a.action_version,i.agent_version_asset_id,i.projection_generation,i.delegation_id,
            i.source_event_id,i.root_event_id,i.source_kind
         from catalog.agent_invocation i join admission.action_execution a on a.id=i.action_execution_id
         where i.id=$1 and not i.cancel_pending
           and (($6 and not $5 and $3::text is null and i.status in ('CREATED','DISPATCHING','UNKNOWN')
                 and i.runtime_turn_id is null and i.native_status is null and i.reply_event_id is not distinct from $4::text
                 and exists(select 1 from catalog.automation_version v where v.asset_id=i.automation_version_asset_id
                   and v.automation_resource_id=i.automation_resource_id and v.action->>'kind' IN ('POST_MESSAGE','POST_MESSAGE_STEPS')))
             or (not $6 and not $5 and $3::text is null and $4::text is null and i.status in ('CREATED','DISPATCHING') and i.runtime_turn_id is null)
             or (not $5 and $3::text is not null and i.status in ('RUNNING','UNKNOWN')
               and i.native_status='completed' and i.runtime_turn_id=$3 and i.reply_event_id is not distinct from $4::text)
             or ($5 and $4::text is null and i.status='RUNNING' and i.native_status='inProgress'
               and i.runtime_turn_id=$3 and i.reply_event_id is null))
           and a.action_key=$2 and a.gate_state='ALLOWED' and a.dispatch_state='DISPATCHED'
           and a.tenant_id=i.tenant_id and a.workspace_id=i.workspace_id for update of i,a";

/// Supervisor 的第二次 Tenant-lock 事务内调用：不再次加 Tenant 锁，不借安装准入替代授权。
pub(crate) async fn fresh_invocation(
    state: &ServiceState,
    tx: &mut Transaction<'_, Postgres>,
    invocation: Uuid,
) -> Result<(), Refusal> {
    recheck_invocation(state, tx, invocation, None, None, false, false)
        .await
        .map(|_| ())
}

/// 同一原 operation 的完成回帖副作用；首 turn 的 fence 不允许进入这个阶段。
pub(crate) async fn fresh_reply(
    state: &ServiceState,
    tx: &mut Transaction<'_, Postgres>,
    invocation: Uuid,
    turn_id: &str,
    expected_reply: Option<&str>,
) -> Result<String, Refusal> {
    if turn_id.trim().is_empty() || expected_reply.is_some_and(|reply| reply.trim().is_empty()) {
        return Err(Refusal::Precondition(ReasonCode::TargetStateConflict));
    }
    recheck_invocation(
        state,
        tx,
        invocation,
        Some(turn_id),
        expected_reply,
        false,
        false,
    )
    .await
}

/// Same frozen Automation checks, only for the existing live native tool turn.
pub(crate) async fn fresh_tool(
    state: &ServiceState,
    tx: &mut Transaction<'_, Postgres>,
    invocation: Uuid,
    turn: &str,
) -> Result<String, Refusal> {
    if turn.is_empty() {
        return Err(Refusal::Precondition(ReasonCode::TargetStateConflict));
    }
    recheck_invocation(state, tx, invocation, Some(turn), None, true, false).await
}

async fn recheck_invocation(
    state: &ServiceState,
    tx: &mut Transaction<'_, Postgres>,
    invocation: Uuid,
    completed_turn: Option<&str>,
    expected_reply: Option<&str>,
    tool: bool,
    post_message: bool,
) -> Result<String, Refusal> {
    let g = &state.governance;
    let frozen: Option<FrozenInvocation> = sqlx::query_as(FROZEN_INVOCATION_SQL)
        .bind(invocation)
        .bind(ACTION)
        .bind(completed_turn)
        .bind(expected_reply)
        .bind(tool)
        .bind(post_message)
        .fetch_optional(&mut **tx)
        .await?;
    let Some(frozen) = frozen else {
        return Err(Refusal::Precondition(ReasonCode::TargetStateConflict));
    };
    // 已启动 Workflow 的 Invocation 使用已冻结版本、Installation 与 Grant。
    // pause/disable 只禁止新准入，不用当前 pointer 或 Resource 管理版本撤销在途 run。
    let row = run(tx, frozen.automation_resource_id, Some(invocation)).await?;
    let def = definition(g).await?;
    let ae = governance::lock_execution(tx, frozen.action_execution_id).await?;
    if row.automation_version_asset_id != frozen.automation_version_asset_id
        || row.agent_version_asset_id != frozen.agent_version_asset_id
        || row.projection_generation != frozen.projection_generation
        || row.delegation_id != frozen.delegation_id
        || frozen.action_version != def.version
        || ae.tenant_id != row.tenant_id
        || ae.workspace_id != Some(row.workspace_id)
        || ae.initiator_principal_id != row.owner_principal_id
        || ae.actor_principal_id != row.agent_principal_id
        || ae.target_id != row.resource_id
        || ae
            .frozen_target_version()
            .is_none_or(|version| version <= 0)
        || ae
            .parameters
            .as_ref()
            .and_then(|p| p.get("automationVersionAssetId"))
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
            != Some(frozen.automation_version_asset_id)
        || ae
            .parameters
            .as_ref()
            .and_then(|p| p.get("automationVersion"))
            .and_then(Value::as_i64)
            != Some(i64::from(row.automation_version))
        || ae
            .parameters
            .as_ref()
            .and_then(|p| p.get("agentVersionAssetId"))
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
            != Some(frozen.agent_version_asset_id)
        || ae
            .parameters
            .as_ref()
            .and_then(|p| p.get("projectionGeneration"))
            .and_then(Value::as_i64)
            != Some(frozen.projection_generation)
        || ae
            .parameters
            .as_ref()
            .and_then(|p| p.get("delegationId"))
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
            != Some(frozen.delegation_id)
        || ae
            .parameters
            .as_ref()
            .and_then(|p| p.get("sourceEventId"))
            .and_then(Value::as_str)
            != Some(frozen.source_event_id.as_str())
        || ae
            .parameters
            .as_ref()
            .and_then(|p| p.get("rootEventId"))
            .and_then(Value::as_str)
            != Some(frozen.root_event_id.as_str())
    {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    if frozen.source_kind == "MANUAL" {
        if !manual::frozen_source(&ae, &frozen.source_event_id, &frozen.root_event_id) {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        manual::fresh_owner(
            g,
            tx,
            row.tenant_id,
            row.workspace_id,
            row.resource_id,
            row.owner_principal_id,
        )
        .await?;
    } else if frozen.source_kind == "SCHEDULE" {
        schedule::frozen_source(g, tx, &ae, &frozen).await?;
    } else if frozen.source_kind == "BUZZ_EVENT" {
        let author = ae
            .parameters
            .as_ref()
            .and_then(|p| p.get("sourcePrincipalId"))
            .and_then(Value::as_str)
            .and_then(|p| Uuid::parse_str(p).ok())
            .ok_or(Refusal::Denied(ReasonCode::ScopeGuardFailed))?;
        let pubkey = ae
            .parameters
            .as_ref()
            .and_then(|p| p.get("sourcePubkey"))
            .and_then(Value::as_str)
            .ok_or(Refusal::Denied(ReasonCode::ScopeGuardFailed))?;
        source_human(g, tx, &runtime_scope(&row), author, pubkey).await?;
    } else {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    fresh_executor(state, tx, &row).await?;
    let revision = fresh(g, tx, &row, &def, Some(frozen.operation_id)).await?;
    g.record_automation_decision(tx, &ae, &def, "RECHECK", Ok(revision.clone()))
        .await?;
    Ok(revision)
}

#[derive(FromRow)]
struct RuntimeFence {
    installation_owner: Uuid,
    model_route: Uuid,
    model_owner: Uuid,
    agent_pubkey: String,
    control_pubkey: String,
    agent_locator: String,
    agent_secret_version: i32,
    agent_audience: String,
    channel_id: Uuid,
}

pub(crate) struct RuntimeScope {
    pub tenant_id: Uuid,
    pub workspace_id: Uuid,
    pub executor_installation_resource_id: Uuid,
    pub agent_version_asset_id: Uuid,
    pub projection_generation: i64,
    pub owner_principal_id: Uuid,
    pub agent_principal_id: Uuid,
}

fn runtime_scope(row: &Run) -> RuntimeScope {
    RuntimeScope {
        tenant_id: row.tenant_id,
        workspace_id: row.workspace_id,
        executor_installation_resource_id: row.executor_installation_resource_id,
        agent_version_asset_id: row.agent_version_asset_id,
        projection_generation: row.projection_generation,
        owner_principal_id: row.owner_principal_id,
        agent_principal_id: row.agent_principal_id,
    }
}

async fn fresh_executor(
    state: &ServiceState,
    tx: &mut Transaction<'_, Postgres>,
    row: &Run,
) -> Result<(), Refusal> {
    match row.action.get("kind").and_then(Value::as_str) {
        Some("AGENT_TURN") => fresh_runtime(state, tx, &runtime_scope(row)).await,
        Some("POST_MESSAGE" | "POST_MESSAGE_STEPS") => {
            post_message::fresh(state, tx, &runtime_scope(row)).await
        }
        _ => Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)),
    }
}

/// Called only by the original AgentTask Activity's template branch. The same
/// immutable Automation/Delegation/source checks are repeated before publish.
pub(crate) async fn fresh_post_message(
    state: &ServiceState,
    tx: &mut Transaction<'_, Postgres>,
    invocation: Uuid,
    expected_reply: Option<&str>,
) -> Result<(String, post_message::MessageBinding, String), Refusal> {
    let revision =
        recheck_invocation(state, tx, invocation, None, expected_reply, false, true).await?;
    let resource: Uuid = sqlx::query_scalar(
        "select automation_resource_id from catalog.agent_invocation where id=$1",
    )
    .bind(invocation)
    .fetch_one(&mut **tx)
    .await?;
    let row = run(tx, resource, Some(invocation)).await?;
    if !row
        .action
        .get("kind")
        .and_then(Value::as_str)
        .is_some_and(crate::automation::steps::is_message_kind)
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let binding = post_message::binding(tx, &runtime_scope(&row)).await?;
    let template = row
        .action
        .get("template")
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(invalid_management)?
        .to_owned();
    Ok((template, binding, revision))
}

pub(crate) async fn fresh_runtime(
    state: &ServiceState,
    tx: &mut Transaction<'_, Postgres>,
    row: &RuntimeScope,
) -> Result<(), Refusal> {
    let fence:RuntimeFence=sqlx::query_as("select ir.owner_principal_id installation_owner,
        p.model_route_resource_id model_route,mr.owner_principal_id model_owner,
        a.pubkey agent_pubkey,c.pubkey control_pubkey,a.private_key_secret_ref agent_locator,
        a.private_key_secret_version agent_secret_version,a.private_key_secret_audience agent_audience,w.channel_id
        from catalog.agent_installation i join catalog.resource ir on ir.id=i.resource_id
        join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
          and p.generation=$2 and p.agent_version_asset_id=$3 and p.state='ACTIVE'
        join catalog.agent_memory_binding memory on memory.installation_resource_id=i.resource_id
          and memory.state='ACTIVE' and memory.listing_state='COMPLETE' and memory.head_state='CONSISTENT'
        join identity.buzz_identity_binding a on a.pubkey=memory.agent_buzz_identity_binding_id
          and a.tenant_id=ir.tenant_id and a.principal_id=i.agent_principal_id and a.kind='AGENT'
          and a.custody='SERVER' and a.state='ACTIVE'
        join identity.buzz_identity_binding c on c.pubkey=memory.memory_counterparty_buzz_identity_binding_id
          and c.tenant_id=ir.tenant_id and c.kind='CONTROL' and c.custody='SERVER' and c.state='ACTIVE'
        join projection.tenant_buzz_binding t on t.tenant_id=ir.tenant_id
          and t.control_service_principal_id=c.principal_id and t.state='ACTIVE'
        join projection.workspace_buzz_binding w on w.workspace_id=i.workspace_id and w.state='ACTIVE'
        join catalog.model_route model on model.resource_id=p.model_route_resource_id
        join catalog.resource mr on mr.id=model.resource_id and mr.tenant_id=ir.tenant_id
          and mr.type_key='llm_route' and mr.state='ACTIVE' and mr.projection_action_execution_id is null
          and (mr.home_workspace_id is null or mr.home_workspace_id=i.workspace_id)
        join catalog.agent_model_binding key on key.installation_resource_id=i.resource_id
          and key.projection_generation=p.generation and key.model_route_resource_id=model.resource_id
          and key.secret_status='ACTIVE' and key.native_key_id is not null and key.native_key_revision>0
        join identity.principal owner on owner.id=ir.owner_principal_id and owner.tenant_id=ir.tenant_id
          and owner.kind='HUMAN' and owner.status='ACTIVE'
        join identity.tenant_membership tm on tm.tenant_principal_id=owner.id and tm.tenant_id=ir.tenant_id and tm.state='ACTIVE'
        join identity.principal mo on mo.id=mr.owner_principal_id and mo.tenant_id=ir.tenant_id and mo.kind='HUMAN' and mo.status='ACTIVE'
        join identity.tenant_membership mtm on mtm.tenant_principal_id=mo.id and mtm.tenant_id=ir.tenant_id and mtm.state='ACTIVE'
        where i.resource_id=$1 and ir.tenant_id=$4 and i.workspace_id=$5
          and a.private_key_secret_ref is not null and a.private_key_secret_version>0
          and a.private_key_secret_audience is not null
        for update of ir,p,memory,a,c,t,w,mr,model,key,owner,tm,mo,mtm")
        .bind(row.executor_installation_resource_id).bind(row.projection_generation).bind(row.agent_version_asset_id)
        .bind(row.tenant_id).bind(row.workspace_id).fetch_optional(&mut **tx).await?
        .ok_or(Refusal::Precondition(ReasonCode::BindingNotActive))?;
    let g = &state.governance;
    if !g
        .spicedb
        .resource_projection_matches_in_workspace(
            &row.executor_installation_resource_id.to_string(),
            &row.tenant_id.to_string(),
            &fence.installation_owner.to_string(),
            Some(&row.workspace_id.to_string()),
            g.cfg.relationship_page,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Installation owner 投影不可读".into()))?
        || !g
            .spicedb
            .resource_projection_matches_in_workspace(
                &fence.model_route.to_string(),
                &row.tenant_id.to_string(),
                &fence.model_owner.to_string(),
                sqlx::query_scalar::<_, Option<Uuid>>(
                    "select home_workspace_id from catalog.resource where id=$1",
                )
                .bind(fence.model_route)
                .fetch_one(&mut **tx)
                .await?
                .map(|id| id.to_string())
                .as_deref(),
                g.cfg.relationship_page,
            )
            .await
            .map_err(|_| Refusal::Unavailable("模型 owner 投影不可读".into()))?
    {
        return Err(Refusal::Precondition(ReasonCode::ProjectionDelayed));
    }
    for (kind, object, permission, principal) in [
        (
            "resource",
            fence.model_route,
            "execute",
            row.owner_principal_id,
        ),
        (
            "resource",
            fence.model_route,
            "execute",
            row.agent_principal_id,
        ),
        (
            "resource",
            fence.model_route,
            "discover",
            row.agent_principal_id,
        ),
        (
            "workspace",
            row.workspace_id,
            "discover",
            row.agent_principal_id,
        ),
    ] {
        let checked = g
            .spicedb
            .check(
                kind,
                &object.to_string(),
                permission,
                &principal.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| Refusal::Unavailable("模型/Workspace fresh permission 不可读".into()))?;
        if checked.zed_token.is_empty() {
            return Err(Refusal::Unavailable("模型 permission 缺 revision".into()));
        }
        if !checked.allowed {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
    }
    let prefix = state.secrets.tenant_locator(row.tenant_id, "");
    if !fence
        .agent_locator
        .strip_prefix(&prefix)
        .is_some_and(|suffix| {
            !suffix.is_empty()
                && suffix
                    .split('/')
                    .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
        })
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    crate::server_identity::read_bound_keys(
        &state.secrets,
        &secret_store::SecretRef {
            locator: fence.agent_locator,
            version: u32::try_from(fence.agent_secret_version)
                .map_err(|_| Refusal::Precondition(ReasonCode::BindingNotActive))?,
            audience: fence.agent_audience,
        },
        &fence.agent_pubkey,
    )
    .await
    .map_err(|_| Refusal::Unavailable("Agent SecretRef 不可核验".into()))?;
    // resolve 只读 DB/native，不新开 Tenant-lock 事务；重用同一 key/config/SecretRef 查证。
    crate::model_route::resolve(
        state,
        row.executor_installation_resource_id,
        row.agent_version_asset_id,
        row.projection_generation,
    )
    .await?;
    let (control, _) = crate::tenant_lifecycle::control_client(
        state,
        row.tenant_id,
        crate::tenant_lifecycle::ProjectionDirection::Establish,
    )
    .await
    .map_err(|_| Refusal::Unavailable("Relay CONTROL readback 不可用".into()))?;
    if control.pubkey_hex() != fence.control_pubkey {
        return Err(Refusal::Precondition(ReasonCode::BindingNotActive));
    }
    let channel = fence.channel_id.to_string();
    for scope in [
        collab_bridge::bridge::Scope::Relay,
        collab_bridge::bridge::Scope::Channel(&channel),
    ] {
        let roster = control
            .roster(&state.http, scope)
            .await
            .map_err(|_| Refusal::Unavailable("Agent 原生 Relay roster 不可读".into()))?;
        if !roster
            .iter()
            .any(|member| member.pubkey == fence.agent_pubkey)
        {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
    }
    Ok(())
}

pub(crate) async fn source_human(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    row: &RuntimeScope,
    principal: Uuid,
    pubkey: &str,
) -> Result<(), Refusal> {
    let valid:Option<Uuid>=sqlx::query_scalar("select p.id from identity.principal p
        join identity.tenant_membership tm on tm.tenant_principal_id=p.id and tm.tenant_id=p.tenant_id
        join identity.buzz_identity_binding b on b.principal_id=p.id and b.tenant_id=p.tenant_id
        where p.id=$1 and p.tenant_id=$2 and p.kind='HUMAN' and p.status='ACTIVE'
          and tm.state='ACTIVE' and b.kind='HUMAN' and b.state='ACTIVE' and b.pubkey=$3
        for update of p,tm,b")
        .bind(principal).bind(row.tenant_id).bind(pubkey).fetch_optional(&mut **tx).await?;
    // Relay 的 Channel 可见性仍由原生准入保证；这里不把 CONTROL 读身份当触发 HUMAN。
    if valid.is_none() {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let membership: Option<String> = sqlx::query_scalar(
        "select state from identity.workspace_membership
        where workspace_id=$1 and tenant_principal_id=$2 for update",
    )
    .bind(row.workspace_id)
    .bind(principal)
    .fetch_optional(&mut **tx)
    .await?;
    if membership.as_deref() != Some("ACTIVE") {
        // 与 HUMAN scope guard 同一规则：已有 REVOKING/REVOKED membership 不靠
        // 尚未撤出的 workspace#admin 放行；只保留 Tenant admin 的既有例外。
        let (kind, object) = if membership.is_some() {
            ("tenant", row.tenant_id)
        } else {
            ("workspace", row.workspace_id)
        };
        let checked = g
            .spicedb
            .check(
                kind,
                &object.to_string(),
                "manage",
                &principal.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| Refusal::Unavailable("Relay HUMAN 当前 Workspace 资格不可查证".into()))?;
        if checked.zed_token.is_empty() {
            return Err(Refusal::Unavailable(
                "Relay HUMAN Workspace revision 缺失".into(),
            ));
        }
        if !checked.allowed {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
    }
    Ok(())
}

/// 唯一真实调用入口：同治理对账循环先恢复既有 WorkflowRef，再读 Relay durable 页。
/// 没有可用 Automation/ActionDefinition 时没有触发对象，不替造默认 run 或 Grant。
pub(crate) async fn reconcile(state: &ServiceState, batch: i64) -> Result<(), Refusal> {
    if batch <= 0 {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    let pending:Vec<Uuid>=sqlx::query_scalar("select i.id from catalog.agent_invocation i
        join admission.action_execution a on a.id=i.action_execution_id
        where a.action_key=$1 and a.gate_state='ALLOWED' and a.dispatch_state in ('NOT_DISPATCHED','UNKNOWN')
          and i.automation_resource_id is not null order by a.updated_at,i.id limit $2")
        .bind(ACTION).bind(batch).fetch_all(&state.pool).await?;
    let mut failed = None;
    for id in pending {
        if let Err(error) = dispatch(state, id).await {
            if failed.is_none() {
                failed = Some(error);
            }
        }
    }
    let resources: Vec<Uuid> = sqlx::query_scalar(
        "select d.resource_id from catalog.automation_definition d
        join catalog.resource r on r.id=d.resource_id
        join catalog.resource_type_definition t on t.type_key=r.type_key
        join catalog.automation_version v on v.asset_id=d.pinned_version_asset_id
        left join projection.ingress_checkpoint c on c.source_key=
            'relay:automation:'||d.resource_id::text||':'||d.pinned_version_asset_id::text
        where d.state='ENABLED' and r.state='ACTIVE' and t.status='ACTIVE'
          and v.trigger->>'kind' in ('CHANNEL_MESSAGE','MENTION')
          and r.projection_action_execution_id is null
        order by c.updated_at nulls first,d.resource_id limit $1",
    )
    .bind(batch)
    .fetch_all(&state.pool)
    .await?;
    for resource in resources {
        if let Err(error) = inspect(state, resource, batch).await {
            if failed.is_none() {
                failed = Some(error);
            }
        }
    }
    failed.map_or(Ok(()), Err)
}

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    until: Option<u64>,
    before_id: Option<String>,
}

fn relay_trigger_supported(action: &Value, trigger: &Value) -> bool {
    matches!(
        action.get("kind").and_then(Value::as_str),
        Some("AGENT_TURN" | "POST_MESSAGE" | "POST_MESSAGE_STEPS")
    ) && matches!(
        trigger.get("kind").and_then(Value::as_str),
        Some("CHANNEL_MESSAGE" | "MENTION")
    )
}

async fn inspect(state: &ServiceState, resource: Uuid, batch: i64) -> Result<(), Refusal> {
    let mut conn = state.pool.begin().await?;
    // 没有持有 Tenant/Resource 写锁的网络读取；真正准入之后重新锁所有事实。
    let row: Run = sqlx::query_as(RUN)
        .bind(resource)
        .bind(Option::<Uuid>::None)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::TargetStateConflict))?;
    let def = definition(&state.governance).await?;
    if !relay_trigger_supported(&row.action, &row.trigger) {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    step_approval::validate_policy(
        &mut conn,
        row.tenant_id,
        row.approval_policy_id,
        row.approval_policy_version,
        false,
    )
    .await?;
    let key = format!(
        "relay:automation:{}:{}",
        row.resource_id, row.automation_version_asset_id
    );
    sqlx::query(
        "insert into projection.ingress_checkpoint(source_key,tenant_id,cursor) values($1,$2,$3)
        on conflict(source_key) do nothing",
    )
    .bind(&key)
    .bind(row.tenant_id)
    .bind(
        serde_json::to_string(&Cursor::default())
            .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?,
    )
    .execute(&mut *conn)
    .await?;
    let raw: Option<String> = sqlx::query_scalar(
        "select cursor from projection.ingress_checkpoint
        where source_key=$1 and tenant_id=$2 for update skip locked",
    )
    .bind(&key)
    .bind(row.tenant_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(raw) = raw else {
        return Ok(());
    };
    let cursor: Cursor = serde_json::from_str(&raw)
        .map_err(|_| Refusal::Unavailable("Relay trigger cursor 不可读".into()))?;
    if cursor.until.is_some() != cursor.before_id.is_some()
        || cursor
            .before_id
            .as_ref()
            .is_some_and(|id| nostr::EventId::from_hex(id).is_err())
    {
        return Err(Refusal::Unavailable("Relay trigger cursor 不完整".into()));
    }
    let (client, host) = crate::tenant_lifecycle::control_client(
        state,
        row.tenant_id,
        crate::tenant_lifecycle::ProjectionDirection::Establish,
    )
    .await
    .map_err(|_| Refusal::Unavailable("Relay CONTROL 读取身份不可用".into()))?;
    let transport = reqwest::Url::parse(&state.relay_transport)
        .map_err(|_| Refusal::Precondition(ReasonCode::BindingNotActive))?;
    let document = collab_bridge::limits::fetch_nip11(&state.http, &transport, &host)
        .await
        .map_err(|_| Refusal::Unavailable("Relay 原生 NIP11 上界不可读".into()))?;
    let binding: Option<(Uuid, String)> = sqlx::query_as(
        "select w.channel_id,t.nip11_snapshot_digest
        from projection.workspace_buzz_binding w
        join identity.workspace scope on scope.id=w.workspace_id
        join projection.tenant_buzz_binding t on t.tenant_id=scope.tenant_id
        where w.workspace_id=$1 and scope.tenant_id=$2 and w.state='ACTIVE' and t.state='ACTIVE'",
    )
    .bind(row.workspace_id)
    .bind(row.tenant_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((channel, digest)) = binding else {
        return Err(Refusal::Precondition(ReasonCode::BindingNotActive));
    };
    if digest != document.digest {
        return Err(Refusal::Precondition(ReasonCode::BindingNotActive));
    }
    let limit = batch.min(document.limits.max_limit);
    let mut filter = json!({"kinds":[collab_bridge::kind::KIND_STREAM_MESSAGE],"#h":[channel.to_string()],
        "since":row.enabled_at.timestamp(),"limit":limit});
    if let (Some(until), Some(before)) = (&cursor.until, &cursor.before_id) {
        filter["until"] = json!(until);
        filter["before_id"] = json!(before);
    }
    let page = client
        .query(&state.http, &[filter])
        .await
        .map_err(|_| Refusal::Unavailable("Relay 持久触发页不可读".into()))?;
    let values = page
        .as_array()
        .ok_or_else(|| Refusal::Unavailable("Relay 触发页格式不明".into()))?;
    if i64::try_from(values.len())
        .ok()
        .is_none_or(|count| count > limit)
    {
        return Err(Refusal::Unavailable("Relay 触发页超过已核原生上界".into()));
    }
    let mut last: Option<(u64, String)> = None;
    for value in values {
        let event: Event = serde_json::from_value(value.clone())
            .map_err(|_| Refusal::Unavailable("Relay 触发不是原生 event".into()))?;
        event
            .verify()
            .map_err(|_| Refusal::Unavailable("Relay 触发 event 签名不成立".into()))?;
        let id = event.id.to_hex();
        let time = event.created_at.as_secs();
        let channels: Vec<_> = event
            .tags
            .iter()
            .map(nostr::Tag::as_slice)
            .filter(|tag| tag.first().map(String::as_str) == Some("h"))
            .filter_map(|tag| tag.get(1).map(String::as_str))
            .collect();
        let channel_text = channel.to_string();
        if event.kind.as_u16()
            != u16::try_from(collab_bridge::kind::KIND_STREAM_MESSAGE)
                .map_err(|_| Refusal::Blocked(ReasonCode::CapabilityBlocked))?
            || channels.as_slice() != [channel_text.as_str()]
            || i64::try_from(time)
                .ok()
                .is_none_or(|time| time < row.enabled_at.timestamp())
            || cursor
                .until
                .zip(cursor.before_id.as_ref())
                .is_some_and(|(until, before)| time > until || (time == until && id <= *before))
            || last.as_ref().is_some_and(|(previous, previous_id)| {
                time > *previous || (time == *previous && id <= *previous_id)
            })
        {
            return Err(Refusal::Unavailable(
                "Relay 触发页 scope/order 与原生游标不一致".into(),
            ));
        }
        last = Some((time, id));
        let author:Option<Uuid>=sqlx::query_scalar("select p.id from identity.buzz_identity_binding b
            join identity.principal p on p.id=b.principal_id and p.tenant_id=b.tenant_id
            join identity.tenant_membership tm on tm.tenant_principal_id=p.id and tm.tenant_id=p.tenant_id
            where b.pubkey=$1 and b.tenant_id=$2 and b.kind='HUMAN' and b.state='ACTIVE'
              and p.kind='HUMAN' and p.status='ACTIVE' and tm.state='ACTIVE'")
            .bind(event.pubkey.to_hex()).bind(row.tenant_id).fetch_optional(&mut *conn).await?;
        // AGENT/CONTROL/已撤权 HUMAN 根本不匹配；不能沿用服务读取者作 initiator。
        let Some(author) = author else {
            continue;
        };
        if !matches_event(&mut conn, &row, &event).await? {
            continue;
        }
        admit(state, &row, &def, &event, author).await?;
    }
    // 尾页后重新扫描原生保留历史，业务稳定源 ID 去重；不用 timestamp highwater 漏掉迟到事件。
    let next = if i64::try_from(values.len()).ok() == Some(limit) {
        let (until, before) =
            last.ok_or_else(|| Refusal::Unavailable("Relay 满页缺游标".into()))?;
        Cursor {
            until: Some(until),
            before_id: Some(before),
        }
    } else {
        Cursor::default()
    };
    sqlx::query(
        "update projection.ingress_checkpoint set cursor=$2,updated_at=now() where source_key=$1",
    )
    .bind(&key)
    .bind(
        serde_json::to_string(&next)
            .map_err(|_| Refusal::Unavailable("Relay cursor 不可编码".into()))?,
    )
    .execute(&mut *conn)
    .await?;
    conn.commit().await?;
    Ok(())
}

/// 已发布动作模板按原样进入原生 text input；无字符串插值语言或新 prompt 持久副本。
pub(crate) async fn turn_template(
    pool: &sqlx::PgPool,
    invocation: Uuid,
) -> Result<String, Refusal> {
    let template:Option<String>=sqlx::query_scalar("select v.action->>'template'
        from catalog.agent_invocation i join catalog.automation_version v on v.asset_id=i.automation_version_asset_id
        join catalog.asset a on a.id=v.asset_id and a.resource_id=i.automation_resource_id and a.tenant_id=i.tenant_id
        where i.id=$1 and v.automation_resource_id=i.automation_resource_id
          and v.state='PUBLISHED' and a.state='PUBLISHED' and a.type_key='automation.version'
          and a.projection_action_execution_id is null and v.action->>'kind'='AGENT_TURN'
          and i.status in ('CREATED','DISPATCHING') and not i.cancel_pending")
        .bind(invocation).fetch_optional(pool).await?;
    template
        .filter(|template| !template.trim().is_empty())
        .ok_or(Refusal::Precondition(ReasonCode::TargetStateConflict))
}

async fn matches_event(
    tx: &mut Transaction<'_, Postgres>,
    row: &Run,
    event: &Event,
) -> Result<bool, Refusal> {
    if let Some(prefix) = row.trigger.get("text_prefix") {
        let prefix = prefix
            .as_str()
            .filter(|text| !text.is_empty())
            .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
        if !event.content.starts_with(prefix) {
            return Ok(false);
        }
    }
    match row.trigger.get("kind").and_then(Value::as_str) {
        Some("CHANNEL_MESSAGE") => Ok(true),
        Some("MENTION") => {
            let target = row
                .trigger
                .get("mention_principal_id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
                .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
            if target != row.agent_principal_id {
                return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
            }
            let pubkey: Option<String> = sqlx::query_scalar(
                "select pubkey from identity.buzz_identity_binding
                where tenant_id=$1 and principal_id=$2 and kind='AGENT' and state='ACTIVE'",
            )
            .bind(row.tenant_id)
            .bind(target)
            .fetch_optional(&mut **tx)
            .await?;
            let pubkey = pubkey.ok_or(Refusal::Precondition(ReasonCode::BindingNotActive))?;
            Ok(event.tags.iter().map(nostr::Tag::as_slice).any(|tag| {
                tag.first().map(String::as_str) == Some("p") && tag.get(1) == Some(&pubkey)
            }))
        }
        _ => Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)),
    }
}

async fn admit(
    state: &ServiceState,
    snapshot: &Run,
    def: &Definition,
    event: &Event,
    author: Uuid,
) -> Result<(), Refusal> {
    admit_source(state, snapshot, def, AdmissionSource::Relay(event, author))
        .await
        .map(|_| ())
}

enum AdmissionSource<'a> {
    Relay(&'a Event, Uuid),
    Manual(
        &'a crate::bff::ExecutionContext,
        &'a contracts::ActionCommand,
    ),
}

async fn admit_source(
    state: &ServiceState,
    snapshot: &Run,
    def: &Definition,
    origin: AdmissionSource<'_>,
) -> Result<Uuid, Refusal> {
    let (idempotency, source, root, source_kind, author) = match &origin {
        AdmissionSource::Relay(event, author) => {
            let source = event.id.to_hex();
            let root = collab_bridge::nip10::parse_thread_markers(&event.tags)
                .resolve()
                .map(|(root, _)| root)
                .unwrap_or_else(|| source.clone());
            (
                Uuid::new_v5(&snapshot.resource_id, source.as_bytes()),
                source,
                root,
                "BUZZ_EVENT",
                *author,
            )
        }
        AdmissionSource::Manual(ctx, command) => {
            let key = Uuid::parse_str(&command.idempotency_key)
                .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?;
            let source = manual::source(ctx.tenant_principal_id, snapshot.resource_id, key);
            (
                key,
                source.clone(),
                source,
                "MANUAL",
                ctx.tenant_principal_id,
            )
        }
    };
    let existed: Option<Uuid> = sqlx::query_scalar(
        "select id from admission.action_execution
        where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3",
    )
    .bind(snapshot.tenant_id)
    .bind(snapshot.owner_principal_id)
    .bind(idempotency)
    .fetch_optional(&state.pool)
    .await?;
    if let Some(id) = existed {
        if let AdmissionSource::Manual(_, command) = &origin {
            manual::check_replay(&state.pool, id, command).await?;
        }
        return Ok(id);
    }
    let ready = if snapshot
        .action
        .get("kind")
        .and_then(Value::as_str)
        .is_some_and(crate::automation::steps::is_message_kind)
    {
        Ok(None)
    } else {
        crate::agent_installation::admit_runtime(
            state,
            snapshot.executor_installation_resource_id,
            snapshot.agent_version_asset_id,
            snapshot.projection_generation,
        )
        .await
        .map(Some)
    };
    let mut tx = state.pool.begin().await?;
    let active: bool =
        sqlx::query_scalar("select state='ACTIVE' from identity.tenant where id=$1 for update")
            .bind(snapshot.tenant_id)
            .fetch_one(&mut *tx)
            .await?;
    if !active {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let row = run(&mut tx, snapshot.resource_id, None).await?;
    if row.resource_version != snapshot.resource_version
        || row.automation_version_asset_id != snapshot.automation_version_asset_id
        || row.agent_version_asset_id != snapshot.agent_version_asset_id
        || row.projection_generation != snapshot.projection_generation
    {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    // Tenant 串行边界里再次去重；这里是新 AE，尚不存在可先锁的 execution。
    let existed: Option<Uuid> = sqlx::query_scalar(
        "select id from admission.action_execution
        where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3",
    )
    .bind(row.tenant_id)
    .bind(row.owner_principal_id)
    .bind(idempotency)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(id) = existed {
        if let AdmissionSource::Manual(_, command) = &origin {
            manual::check_replay(&mut *tx, id, command).await?;
        }
        return Ok(id);
    }
    let mut parameters = json!({"targetVersion":row.resource_version,"automationVersionAssetId":row.automation_version_asset_id,
        "automationVersion":row.automation_version,"agentVersionAssetId":row.agent_version_asset_id,
        "projectionGeneration":row.projection_generation,"sourceEventId":source,
        "rootEventId":root,"sourcePrincipalId":author,
        "delegationId":row.delegation_id});
    match &origin {
        AdmissionSource::Relay(event, _) => {
            parameters["sourcePubkey"] = json!(event.pubkey.to_hex())
        }
        AdmissionSource::Manual(ctx, command) => {
            // The BFF proves the HUMAN owner; no client chooses a Grant, pin,
            // Agent actor, Relay event, or output location.
            if row.owner_principal_id != ctx.tenant_principal_id
                || row.human_identity_id != Some(ctx.human_identity_id)
                || command.resource_version != Some(i64::from(row.resource_version))
            {
                return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
            }
            parameters["sourceKind"] = json!(source_kind);
            parameters["manualRequest"] = manual::request(command)?;
        }
    }
    let ae = governance::open_automation_execution(
        &mut tx,
        Actor {
            tenant_id: row.tenant_id,
            principal_id: row.owner_principal_id,
            human_identity_id: row.human_identity_id,
        },
        row.agent_principal_id,
        def,
        &Target {
            id: row.resource_id,
            version: row.resource_version,
            workspace_id: Some(row.workspace_id),
        },
        parameters,
        idempotency,
    )
    .await?;
    let result = async {
        let ready = ready?;
        if ready.is_some_and(|ready| {
            ready.tenant_id != row.tenant_id || ready.workspace_id != row.workspace_id
        }) {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        match &origin {
            AdmissionSource::Relay(event, _) => {
                source_human(
                    &state.governance,
                    &mut tx,
                    &runtime_scope(&row),
                    author,
                    &event.pubkey.to_hex(),
                )
                .await?
            }
            AdmissionSource::Manual(_, _) => {
                manual::fresh_owner(
                    &state.governance,
                    &mut tx,
                    row.tenant_id,
                    row.workspace_id,
                    row.resource_id,
                    row.owner_principal_id,
                )
                .await?
            }
        }
        fresh_executor(state, &mut tx, &row).await?;
        fresh(&state.governance, &mut tx, &row, def, None).await
    }
    .await;
    if source_kind == "MANUAL" {
        if let Err(Refusal::Unavailable(message)) = &result {
            // No invocation/native run has been started: roll back the unknown
            // admission, so the same client key may recheck instead of leaving
            // an EVALUATING AE with no durable executor to reconcile it.
            return Err(Refusal::Unavailable(message.clone()));
        }
    }
    state
        .governance
        .record_automation_decision(
            &mut tx,
            &ae,
            def,
            "ADMISSION",
            result.as_ref().map(Clone::clone),
        )
        .await?;
    if let Err(error) = result {
        tx.commit().await?;
        return if matches!(error, Refusal::Unavailable(_)) {
            Err(error)
        } else {
            Ok(ae.id)
        };
    }
    let invocation = if source_kind == "MANUAL" {
        Uuid::new_v5(&row.resource_id, source.as_bytes())
    } else {
        Uuid::new_v4()
    };
    let workflow = if source_kind == "MANUAL" {
        manual::workflow(row.tenant_id, row.resource_id, &source)
    } else {
        crate::component_task::workflow_id(
            "AGENT_TASK",
            row.tenant_id,
            &invocation.to_string(),
            row.automation_version,
        )
    };
    sqlx::query("insert into catalog.agent_session
        (tenant_id,workspace_id,root_event_id,installation_resource_id,agent_version_asset_id,
         projection_generation,core_memory_state,status,source_kind) values($1,$2,$3,$4,$5,$6,'UNREADABLE','PENDING',$7)
        on conflict(workspace_id,root_event_id,installation_resource_id,projection_generation) do nothing")
        .bind(row.tenant_id).bind(row.workspace_id).bind(&root).bind(row.executor_installation_resource_id)
        .bind(row.agent_version_asset_id).bind(row.projection_generation).bind(source_kind).execute(&mut *tx).await?;
    let same: bool = sqlx::query_scalar(
        "select agent_version_asset_id=$4 and projection_generation=$5
        and status in ('PENDING','ACTIVE') from catalog.agent_session
        where workspace_id=$1 and root_event_id=$2 and installation_resource_id=$3 and projection_generation=$5 for update",
    )
    .bind(row.workspace_id)
    .bind(&root)
    .bind(row.executor_installation_resource_id)
    .bind(row.agent_version_asset_id)
    .bind(row.projection_generation)
    .fetch_one(&mut *tx)
    .await?;
    if !same {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    sqlx::query("insert into catalog.agent_invocation
        (id,tenant_id,workspace_id,root_event_id,source_event_id,installation_resource_id,agent_version_asset_id,
         projection_generation,delegation_id,automation_resource_id,automation_version_asset_id,action_execution_id,workflow_id,status,source_kind)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'CREATED',$14)")
        .bind(invocation).bind(row.tenant_id).bind(row.workspace_id).bind(&root).bind(&source)
        .bind(row.executor_installation_resource_id).bind(row.agent_version_asset_id).bind(row.projection_generation)
        .bind(row.delegation_id).bind(row.resource_id).bind(row.automation_version_asset_id).bind(ae.id).bind(&workflow).bind(source_kind)
        .execute(&mut *tx).await?;
    sqlx::query("insert into projection.workflow_ref
        (workflow_id,workflow_type,workflow_version,kind,tenant_id,workspace_id,operation_id,action_execution_id,projection_state)
        values($1,$2,1,null,$3,$4,$5,$6,'PENDING_START')")
        .bind(&workflow).bind(crate::agent_task::WORKFLOW_TYPE).bind(row.tenant_id).bind(row.workspace_id)
        .bind(ae.operation_id).bind(ae.id).execute(&mut *tx).await?;
    sqlx::query("update admission.action_execution set temporal_workflow_id=$2 where id=$1")
        .bind(ae.id)
        .bind(&workflow)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    dispatch(state, invocation).await?;
    Ok(ae.id)
}

async fn dispatch(state: &ServiceState, id: Uuid) -> Result<(), Refusal> {
    let linked: Option<(Uuid, Uuid)> = sqlx::query_as(
        "select action_execution_id,tenant_id from catalog.agent_invocation
        where id=$1 and automation_resource_id is not null",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?;
    let (ae_id, tenant) = linked.ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    let mut tx = state.pool.begin().await?;
    let ae = governance::lock_execution(&mut tx, ae_id).await?;
    let active: bool =
        sqlx::query_scalar("select state='ACTIVE' from identity.tenant where id=$1 for update")
            .bind(tenant)
            .fetch_one(&mut *tx)
            .await?;
    let def = definition(&state.governance).await?;
    if ae.gate_state != "ALLOWED"
        || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
    {
        return Ok(());
    }
    let frozen: Option<(Uuid, Uuid, Uuid, i64, String)> = sqlx::query_as(
        "select automation_resource_id,
        automation_version_asset_id,agent_version_asset_id,projection_generation,workflow_id
        from catalog.agent_invocation where id=$1 for update",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let (resource, version, agent_version, generation, workflow) =
        frozen.ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    // UNKNOWN 可能已启动；先以唯一 Workflow ID 查 native evidence，绝不在撤权后盲重 Start。
    let observed = state
        .temporal
        .describe(&workflow)
        .await
        .map_err(|_| Refusal::Unavailable("Automation Workflow Describe 不可核验".into()))?;
    if observed.is_none() {
        if !active {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        // The admission is already durable. Disable/delete prevent new runs,
        // not this frozen one; every original Grant/scope check still applies.
        let row = run(&mut tx, resource, Some(id)).await?;
        if row.automation_version_asset_id != version
            || row.agent_version_asset_id != agent_version
            || row.projection_generation != generation
            || ae.action_version != def.version
            || ae
                .frozen_target_version()
                .is_none_or(|version| version <= 0)
        {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
        let used:bool=sqlx::query_scalar("select exists(select 1 from admission.delegation_use where delegation_id=$1 and operation_id=$2)")
            .bind(row.delegation_id).bind(ae.operation_id).fetch_one(&mut *tx).await?;
        if ae
            .parameters
            .as_ref()
            .and_then(|p| p.get("sourceKind"))
            .and_then(Value::as_str)
            == Some("MANUAL")
        {
            let source = ae
                .parameters
                .as_ref()
                .and_then(|p| p.get("sourceEventId"))
                .and_then(Value::as_str)
                .ok_or(Refusal::Denied(ReasonCode::ScopeGuardFailed))?;
            if !manual::frozen_source(&ae, source, source) {
                return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
            }
            manual::fresh_owner(
                &state.governance,
                &mut tx,
                row.tenant_id,
                row.workspace_id,
                row.resource_id,
                row.owner_principal_id,
            )
            .await?;
        }
        fresh_executor(state, &mut tx, &row).await?;
        let revision = fresh(
            &state.governance,
            &mut tx,
            &row,
            &def,
            used.then_some(ae.operation_id),
        )
        .await?;
        state
            .governance
            .record_automation_decision(&mut tx, &ae, &def, "RECHECK", Ok(revision))
            .await?;
        sqlx::query("insert into admission.delegation_use(delegation_id,operation_id) values($1,$2) on conflict do nothing")
            .bind(row.delegation_id).bind(ae.operation_id).execute(&mut *tx).await?;
    }
    let seconds = |key: &str| {
        std::env::var(key)
            .ok()
            .and_then(|v| v.parse::<i64>().ok())
            .filter(|n| *n > 0)
            .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))
    };
    let input = AgentTaskWorkflowInput {
        invocation_id: id.to_string(),
        installation_id: sqlx::query_scalar::<_, Uuid>(
            "select installation_resource_id from catalog.agent_invocation where id=$1",
        )
        .bind(id)
        .fetch_one(&mut *tx)
        .await?
        .to_string(),
        agent_version_asset_id: agent_version.to_string(),
        projection_generation: generation,
        event_base: 0,
        cancel_pending: false,
        heartbeat_timeout_seconds: seconds("WORKER_AGENT_ACTIVITY_HEARTBEAT_TIMEOUT_SECONDS")?,
        heartbeat_interval_seconds: seconds("WORKER_AGENT_ACTIVITY_HEARTBEAT_INTERVAL_SECONDS")?,
        observation_interval_seconds: seconds(
            "WORKER_AGENT_ACTIVITY_OBSERVATION_INTERVAL_SECONDS",
        )?,
    };
    if input.heartbeat_interval_seconds >= input.heartbeat_timeout_seconds {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    let started = crate::component_task::start_typed(
        &state.pool,
        &state.temporal,
        crate::component_task::Launch {
            workflow_id: &workflow,
            workflow_type: crate::agent_task::WORKFLOW_TYPE,
            kind: None,
            tenant_id: tenant,
            action_execution_id: ae.id,
        },
        &input,
    )
    .await;
    let outcome = started.map(|_| ()).map_err(|response| response.status());
    governance::record_dispatch(&mut tx, ae.id, def.audit_class(), outcome, Vec::new()).await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
#[path = "automation/management_evidence.rs"]
mod management_evidence;

#[cfg(test)]
mod run_registration_tests {
    use super::parse_run_meters;

    #[test]
    fn explicit_meter_policy_is_complete_unique_and_order_independent() {
        assert_eq!(
            parse_run_meters(r#"["model_tokens", "automation.run"]"#, "automation_run").unwrap(),
            parse_run_meters(r#"["automation.run", "model_tokens"]"#, "automation_run").unwrap()
        );
        for rejected in [
            "null",
            "{}",
            "[]",
            r#"["automation.run"]"#,
            r#"["model_tokens", "other_tokens"]"#,
            r#"["automation.run", "automation.run"]"#,
            r#"["automation.run", ""]"#,
            r#"["automation.run", " "]"#,
            r#"["automation.run", " model_tokens"]"#,
            r#"["automation.run", 1]"#,
            r#"["automation.run", "automation_run"]"#,
            r#"["automation.run", "model_tokens", "automation_run"]"#,
        ] {
            assert!(
                parse_run_meters(rejected, "automation_run").is_err(),
                "{rejected}"
            );
        }
    }
}

#[cfg(test)]
mod executor_projection_tests {
    use super::*;
    use axum::{
        extract::State,
        http::{StatusCode, Uri},
        response::IntoResponse,
        Json, Router,
    };
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct Native {
        rows: Vec<Value>,
        writes: Vec<Value>,
        lose_ack: bool,
        ignore_write: bool,
        unavailable: bool,
    }

    fn executor(resource: Uuid, agent: Uuid) -> Value {
        json!({"resource":{"objectType":"resource","objectId":resource},"relation":"executor",
            "subject":{"object":{"objectType":"principal","objectId":agent}}})
    }

    async fn native(
        State(state): State<Arc<Mutex<Native>>>,
        uri: Uri,
        Json(body): Json<Value>,
    ) -> axum::response::Response {
        let mut state = state.lock().unwrap();
        if uri.path() == "/v1/relationships/read" {
            assert_eq!(body["consistency"], json!({"fullyConsistent":true}));
            assert_eq!(body["relationshipFilter"]["resourceType"], "resource");
            assert_eq!(body["relationshipFilter"]["optionalRelation"], "executor");
            assert!(
                body["relationshipFilter"]
                    .get("optionalSubjectFilter")
                    .is_none(),
                "must read all prior executors"
            );
            if state.unavailable {
                return StatusCode::SERVICE_UNAVAILABLE.into_response();
            }
            return state
                .rows
                .iter()
                .map(|row| json!({"result":{"relationship":row}}).to_string())
                .collect::<Vec<_>>()
                .join("\n")
                .into_response();
        }
        assert_eq!(uri.path(), "/v1/relationships/write");
        state.writes.push(body.clone());
        if !state.ignore_write {
            for update in body["updates"].as_array().unwrap() {
                let row = &update["relationship"];
                assert_eq!(row["relation"], "executor");
                state.rows.retain(|old| old != row);
                if update["operation"] == "OPERATION_TOUCH" {
                    state.rows.push(row.clone());
                } else {
                    assert_eq!(update["operation"], "OPERATION_DELETE");
                }
            }
        }
        if state.lose_ack {
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
        Json(json!({"writtenAt":{"token":"native-revision"}})).into_response()
    }

    async fn fixture(
        initial: Native,
    ) -> (SpiceDb, Arc<Mutex<Native>>, tokio::task::JoinHandle<()>) {
        let state = Arc::new(Mutex::new(initial));
        let app = Router::new().fallback(native).with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let spice = SpiceDb::for_test(format!("http://{}", listener.local_addr().unwrap()));
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (spice, state, task)
    }

    #[tokio::test]
    async fn explicit_executor_is_projected_and_reentry_does_not_regrant() {
        let resource = Uuid::new_v4();
        let agent = Uuid::new_v4();
        let (spice, state, task) = fixture(Native::default()).await;
        project_executor(&spice, resource, agent, 100)
            .await
            .unwrap();
        project_executor(&spice, resource, agent, 100)
            .await
            .unwrap();
        assert_eq!(state.lock().unwrap().rows, vec![executor(resource, agent)]);
        assert_eq!(state.lock().unwrap().writes.len(), 1);
        task.abort();
    }

    #[tokio::test]
    async fn publish_removes_other_executors_without_touching_owner_permissions() {
        let resource = Uuid::new_v4();
        let agent = Uuid::new_v4();
        let (spice, state, task) = fixture(Native {
            rows: vec![
                executor(resource, Uuid::new_v4()),
                executor(resource, agent),
            ],
            ..Default::default()
        })
        .await;
        project_executor(&spice, resource, agent, 100)
            .await
            .unwrap();
        assert_eq!(state.lock().unwrap().rows, vec![executor(resource, agent)]);
        assert_eq!(
            state.lock().unwrap().writes[0]["updates"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            state.lock().unwrap().writes[0]["updates"][0]["operation"],
            "OPERATION_DELETE"
        );
        task.abort();
    }

    #[tokio::test]
    async fn lost_write_ack_stays_unknown_until_exact_native_readback() {
        let resource = Uuid::new_v4();
        let agent = Uuid::new_v4();
        let (spice, state, task) = fixture(Native {
            lose_ack: true,
            ..Default::default()
        })
        .await;
        assert!(project_executor(&spice, resource, agent, 100)
            .await
            .is_err());
        project_executor(&spice, resource, agent, 100)
            .await
            .unwrap();
        assert_eq!(state.lock().unwrap().writes.len(), 1);
        task.abort();
    }

    #[tokio::test]
    async fn successful_ack_or_unreadable_relationship_is_not_projection_proof() {
        let resource = Uuid::new_v4();
        let agent = Uuid::new_v4();
        let (spice, _, task) = fixture(Native {
            ignore_write: true,
            ..Default::default()
        })
        .await;
        assert!(project_executor(&spice, resource, agent, 100)
            .await
            .is_err());
        task.abort();
        let (spice, state, task) = fixture(Native {
            unavailable: true,
            ..Default::default()
        })
        .await;
        assert!(project_executor(&spice, resource, agent, 100)
            .await
            .is_err());
        assert!(state.lock().unwrap().writes.is_empty());
        task.abort();
        let mut invalid = executor(resource, agent);
        invalid["optionalCaveat"] = json!({"caveatName":"unknown"});
        let (spice, state, task) = fixture(Native {
            rows: vec![invalid],
            ..Default::default()
        })
        .await;
        assert!(project_executor(&spice, resource, agent, 100)
            .await
            .is_err());
        assert!(state.lock().unwrap().writes.is_empty());
        task.abort();
    }
}
