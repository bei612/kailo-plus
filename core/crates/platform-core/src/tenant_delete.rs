//! DD-43/91/99/109：Worker 只推进准入已冻结的 TenantLifecycleSnapshot。
//! 外部事实留在 provider；Core 持久保存不可逆派发、稳定引用及缺席证据。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::{EvidenceKind, TenantDeleteAdvanceRequest, TenantDeleteAdvanceResult};
use secret_store::{PlatformKey, SecretStore};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::audit::{self, AuditEntry, Evidence};
use crate::service_api::{audit_gate, authorize, unavailable, ServiceState};

#[derive(Clone)]
pub struct DeletionTransport {
    origin: String,
    http: reqwest::Client,
}

impl DeletionTransport {
    pub fn from_env() -> Result<Option<Self>, Box<dyn std::error::Error>> {
        let origin = match std::env::var("BUZZ_DELETION_API_URL") {
            Err(std::env::VarError::NotPresent) => return Ok(None),
            other => other?,
        };
        let url = reqwest::Url::parse(&origin)?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("BUZZ_DELETION_API_URL 必须是无凭据与路径的 HTTP(S) origin".into());
        }
        let seconds: u64 = std::env::var("BUZZ_DELETION_HTTP_TIMEOUT_SECONDS")?.parse()?;
        if seconds == 0 {
            return Err("BUZZ_DELETION_HTTP_TIMEOUT_SECONDS 必须为正整数".into());
        }
        Ok(Some(Self {
            origin,
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(seconds))
                .build()?,
        }))
    }
}

/// 复用准入与实际派发的同一检查。旧 platform locator 不由 Tenant namespace
/// 删除覆盖；尚未收敛的密钥写者也不能与 namespace 销毁并发。
pub(crate) async fn secrets_ready(
    secrets: &SecretStore,
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
) -> Result<bool, sqlx::Error> {
    let pending: bool = sqlx::query_scalar(
        "select exists(select 1 from admission.server_key_provision_intent
                       where tenant_id = $1 and ((finished_at is null and destroyed_at is null)
                           or (fenced_at is not null and destroyed_at is null)))
             or exists(select 1 from admission.secret_ref_rehome
                       where tenant_id = $1 and state not in ('RETIRED','FAILED'))",
    )
    .bind(tenant)
    .fetch_one(&mut *conn)
    .await?;
    if pending {
        return Ok(false);
    }
    let refs: Vec<(String, String, String, Option<i32>)> = sqlx::query_as(
        "select kind,state,private_key_secret_ref,private_key_secret_version
         from identity.buzz_identity_binding where tenant_id = $1 and custody = 'SERVER'",
    )
    .bind(tenant)
    .fetch_all(&mut *conn)
    .await?;
    for (kind, state, locator, version) in refs {
        let owns = match kind.as_str() {
            "HUMAN" => secrets.owns_platform_key(PlatformKey::Human, tenant, &locator),
            "CONTROL" => secrets.owns_platform_key(PlatformKey::Control, tenant, &locator),
            "AGENT" => locator
                .strip_prefix(&secrets.tenant_locator(tenant, ""))
                .is_some_and(|suffix| {
                    !suffix.is_empty()
                        && suffix
                            .split('/')
                            .all(|part| !part.is_empty() && part != "." && part != "..")
                }),
            _ => false,
        };
        if owns {
            continue;
        }
        // REVOKED 只证明不能再签名，不证明 platform 旧版本已销毁。仅接受同一
        // locator/version 的既有退休或销毁终态；缺证据仍拒绝，不能借 namespace 删除冒充。
        if state != "REVOKED" || !secrets.is_legacy_identity_locator(tenant, &locator) {
            return Ok(false);
        }
        let retired: bool = sqlx::query_scalar(
            "select exists(select 1 from admission.secret_ref_rehome
                           where tenant_id = $1 and old_locator = $2 and old_version = $3
                             and state = 'RETIRED' and old_ref_status = 'REVOKED')
                 or exists(select 1 from admission.server_key_provision_intent
                           where tenant_id = $1 and target_locator = $2 and key_kind = $4
                             and $3 = 1 and (destroyed_at is not null or retired_at is not null))",
        )
        .bind(tenant)
        .bind(&locator)
        .bind(version)
        .bind(kind)
        .fetch_one(&mut *conn)
        .await?;
        if !retired {
            return Ok(false);
        }
    }
    Ok(true)
}

/// DD-99：只冻结现有 Agent 库存的 scope、版本及原生引用，不复制配置/记忆正文。
/// 可变运行状态由原 Invocation/Workflow 观察，不能塞进不可变 inventory 后再改写。
pub(crate) async fn frozen_agent_inventory(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
) -> Result<Value, crate::governance::Refusal> {
    let mut inventory: Value = sqlx::query_scalar(
        "select jsonb_build_object(
          'automations', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
            select d.resource_id,d.workspace_id,d.executor_installation_resource_id,d.delegation_id,
                   d.pinned_version_asset_id,d.schedule_id,d.webhook_secret_ref,d.state,d.version,d.enabled_at
            from catalog.automation_definition d join catalog.resource r on r.id=d.resource_id
            where r.tenant_id=$1 order by d.resource_id for update of d) x),
          'automation_versions', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
            select v.asset_id,v.automation_resource_id,v.ordinal,v.approval_policy_id,
                   v.result_target,v.config_hash,v.state
            from catalog.automation_version v join catalog.resource r on r.id=v.automation_resource_id
            where r.tenant_id=$1 order by v.automation_resource_id,v.ordinal for update of v) x),
          'automation_schedule_refs', (select coalesce(jsonb_agg(x.id order by x.id),'[]'::jsonb) from (
            select d.schedule_id id from catalog.automation_definition d join catalog.resource r on r.id=d.resource_id
              where r.tenant_id=$1 and d.schedule_id is not null
            union select ae.parameters#>>'{scheduleIntent,id}' from admission.action_execution ae
              where ae.tenant_id=$1 and ae.action_key='automation.enable' and ae.parameters#>>'{scheduleIntent,id}' is not null
            union select ae.parameters#>>'{scheduleIntent,oldId}' from admission.action_execution ae
              where ae.tenant_id=$1 and ae.action_key in ('automation.enable','automation.pause','automation.disable')
                and ae.parameters#>>'{scheduleIntent,oldId}' is not null) x),
          'installations', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
            select i.resource_id,i.workspace_id,i.agent_resource_id,i.pinned_version_asset_id,
                   i.agent_principal_id,i.runtime_isolation_ref
            from catalog.agent_installation i join catalog.resource r on r.id=i.resource_id
            where r.tenant_id=$1 order by i.resource_id for update of i) x),
          'runtime_projections', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
            select p.installation_resource_id,p.generation,p.agent_version_asset_id,
                   p.model_route_resource_id,p.gateway_resource_ids,p.config_hash
            from catalog.agent_runtime_projection p join catalog.resource r on r.id=p.installation_resource_id
            where r.tenant_id=$1 order by p.installation_resource_id,p.generation for update of p) x),
          'channel_bindings', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
            select b.installation_resource_id,b.workspace_id,b.triggers
            from catalog.channel_agent_binding b join catalog.resource r on r.id=b.installation_resource_id
            where r.tenant_id=$1 order by b.installation_resource_id for update of b) x),
          'memory_bindings', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
            select b.installation_resource_id,b.agent_buzz_identity_binding_id,
                   b.memory_counterparty_buzz_identity_binding_id,b.version
            from catalog.agent_memory_binding b join catalog.resource r on r.id=b.installation_resource_id
            where r.tenant_id=$1 order by b.installation_resource_id for update of b) x),
          'sessions', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
            select tenant_id,workspace_id,root_event_id,source_kind,installation_resource_id,
                   agent_version_asset_id,projection_generation
            from catalog.agent_session where tenant_id=$1
            order by workspace_id,root_event_id,installation_resource_id for update) x),
          'invocations', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
            select id,tenant_id,workspace_id,root_event_id,source_event_id,source_kind,schedule_id,scheduled_at,installation_resource_id,
                   agent_version_asset_id,projection_generation,parent_invocation_id,
                   delegation_id,automation_version_asset_id,action_execution_id,workflow_id
            from catalog.agent_invocation where tenant_id=$1 order by id for update) x),
          'delegation_grants', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
            select id,tenant_id,workspace_id,grantor_principal_id,installation_resource_id,
                   agent_principal_id,valid_from,expires_at,max_uses,action_execution_id
            from admission.delegation_grant where tenant_id=$1 order by id for update) x),
          'delegation_scopes', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
            select s.delegation_id,s.action_key,s.action_version,s.target_type,s.target_id,
                   s.create_workspace_id,s.tool_resource_id,
                   s.result_exposure_policy_id,s.result_exposure_policy_version
            from admission.delegation_scope s join admission.delegation_grant g on g.id=s.delegation_id
            where g.tenant_id=$1
            order by s.delegation_id,s.action_key,s.action_version,s.target_type,s.target_id,
                     s.create_workspace_id,s.tool_resource_id for update of s) x),
          'delegation_uses', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
            select u.delegation_id,u.operation_id,u.first_dispatch_at
            from admission.delegation_use u join admission.delegation_grant g on g.id=u.delegation_id
            where g.tenant_id=$1 order by u.delegation_id,u.operation_id for update of u) x),
          'result_exposure_policies', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
            select id,tenant_id,version
            from catalog.result_exposure_policy where tenant_id=$1 order by id,version for update) x))",
    )
    .bind(tenant)
    .fetch_one(&mut *conn)
    .await?;
    let routes = crate::model_route::freeze(conn, tenant).await?;
    let creates = crate::model_route::freeze_creations(conn, tenant).await?;
    inventory
        .as_object_mut()
        .ok_or_else(|| crate::governance::Refusal::Unavailable("Agent inventory 不是对象".into()))?
        .insert(
            "model_routes".into(),
            serde_json::to_value(routes)
                .map_err(|e| crate::governance::Refusal::Unavailable(e.to_string()))?,
        );
    inventory
        .as_object_mut()
        .ok_or_else(|| crate::governance::Refusal::Unavailable("Agent inventory 不是对象".into()))?
        .insert(
            "model_route_creates".into(),
            serde_json::to_value(creates)
                .map_err(|error| crate::governance::Refusal::Unavailable(error.to_string()))?,
        );
    Ok(inventory)
}

fn agent_rows<'a>(inventory: &'a Value, category: &str) -> Result<&'a [Value], sqlx::Error> {
    inventory
        .get(category)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .ok_or_else(|| sqlx::Error::Protocol(format!("冻结 Agent inventory 缺少 {category}")))
}

fn same_agent_inventory(mut current: Value, mut frozen: Value) -> Result<bool, sqlx::Error> {
    // Additive Schedule metadata cannot invalidate an older, Buzz-only snapshot.
    // Any new native reference or non-Buzz source still fails the original fence.
    if frozen.get("automation_schedule_refs").is_none() {
        if !current
            .get("automation_schedule_refs")
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty)
        {
            return Ok(false);
        }
        current
            .as_object_mut()
            .ok_or_else(|| sqlx::Error::Protocol("Agent inventory 不是对象".into()))?
            .remove("automation_schedule_refs");
        for category in ["sessions", "invocations"] {
            let old = agent_rows(&frozen, category)?;
            let rows = current
                .get_mut(category)
                .and_then(Value::as_array_mut)
                .ok_or_else(|| sqlx::Error::Protocol("Agent source inventory 缺失".into()))?;
            if rows.len() != old.len() {
                return Ok(false);
            }
            for (row, old) in rows.iter_mut().zip(old) {
                if old.get("source_kind").is_none() {
                    if row.get("source_kind").and_then(Value::as_str) != Some("BUZZ_EVENT") {
                        return Ok(false);
                    }
                    row.as_object_mut()
                        .ok_or_else(|| sqlx::Error::Protocol("Agent source 不是对象".into()))?
                        .remove("source_kind");
                }
                for key in ["schedule_id", "scheduled_at"] {
                    if old.get(key).is_none() {
                        if row.get(key).is_some_and(|v| !v.is_null()) {
                            return Ok(false);
                        }
                        row.as_object_mut()
                            .ok_or_else(|| sqlx::Error::Protocol("Agent source 不是对象".into()))?
                            .remove(key);
                    }
                }
            }
        }
    }
    // An old snapshot may omit the newly introduced category only when there are no new intents.
    if frozen.get("model_route_creates").is_none() {
        if current
            .get("model_route_creates")
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty)
        {
            current
                .as_object_mut()
                .ok_or_else(|| sqlx::Error::Protocol("Agent inventory 不是对象".into()))?
                .remove("model_route_creates");
        } else {
            return Ok(false);
        }
    }
    let current_routes = current
        .get_mut("model_routes")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| sqlx::Error::Protocol("当前 model route inventory 缺失".into()))?;
    let frozen_routes = frozen
        .get_mut("model_routes")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| sqlx::Error::Protocol("冻结 model route inventory 缺失".into()))?;
    if current_routes.len() != frozen_routes.len() {
        return Ok(false);
    }
    for (current, frozen) in current_routes.iter_mut().zip(frozen_routes) {
        let current_credentials = current
            .get_mut("credentials")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| sqlx::Error::Protocol("当前 credential inventory 缺失".into()))?;
        let frozen_credentials = frozen
            .get_mut("credentials")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| sqlx::Error::Protocol("冻结 credential inventory 缺失".into()))?;
        if current_credentials.len() != frozen_credentials.len() {
            return Ok(false);
        }
        for (current, frozen) in current_credentials.iter_mut().zip(frozen_credentials) {
            let current = current
                .as_object_mut()
                .ok_or_else(|| sqlx::Error::Protocol("当前 credential 不是对象".into()))?;
            let frozen = frozen
                .as_object_mut()
                .ok_or_else(|| sqlx::Error::Protocol("冻结 credential 不是对象".into()))?;
            let original = frozen.get("secret_status").and_then(Value::as_str);
            let now = current.get("secret_status").and_then(Value::as_str);
            if !matches!(
                original,
                Some("PENDING" | "ACTIVE" | "SUPERSEDED" | "REVOKED")
            ) || !(now == original
                || (matches!(original, Some("PENDING" | "ACTIVE")) && now == Some("SUPERSEDED")))
            {
                return Ok(false);
            }
            // 固定 dispatch fence 的 UNKNOWN random ID 仅由原 Gateway handler
            // 查证并补全；scope/SecretRef/revision 之外的字节仍必须逐值相等。
            if frozen.get("native_key_id") == Some(&Value::Null)
                && frozen.get("native_key_revision") == Some(&Value::Null)
                && frozen.get("native_dispatch_started") == Some(&Value::Bool(true))
                && current
                    .get("native_key_id")
                    .and_then(Value::as_str)
                    .is_some_and(|id| !id.is_empty())
                && current
                    .get("native_key_revision")
                    .and_then(Value::as_i64)
                    .is_some_and(|version| version > 0)
            {
                current.insert("native_key_id".into(), Value::Null);
                current.insert("native_key_revision".into(), Value::Null);
            }
            current.remove("secret_status");
            frozen.remove("secret_status");
        }
    }
    Ok(current == frozen)
}

#[derive(sqlx::FromRow)]
struct DrainingInvocation {
    id: Uuid,
    workflow_id: String,
    action_execution_id: Uuid,
    status: String,
    native_status: Option<String>,
    reply_event_id: Option<String>,
    canceled_before_dispatch: bool,
    workflow_state: String,
    task_status: Option<String>,
    task_run_id: Option<String>,
    observation_gap: bool,
}

impl DrainingInvocation {
    fn terminal_matches(&self, status: &str, run: &str) -> bool {
        let native = match (status, self.native_status.as_deref()) {
            ("COMPLETED", Some("completed")) => self
                .reply_event_id
                .as_deref()
                .is_some_and(|id| !id.is_empty()),
            ("FAILED", Some("failed")) | ("CANCELED", Some("interrupted")) => true,
            ("CANCELED", None) => self.canceled_before_dispatch,
            _ => false,
        };
        native
            && self.status == status
            && self.workflow_state == "TERMINAL"
            && self.task_status.as_deref() == Some(status)
            && !run.is_empty()
            && self.task_run_id.as_deref() == Some(run)
            && !self.observation_gap
    }
}

/// 取消 intent 固定同一 Temporal execution chain，先落库再发请求。
/// 请求已接受或 history 有取消事件都不是 Invocation/usage 的终态证据。
async fn agent_cancel_chain(
    state: &ServiceState,
    deletion: &Delete,
    invocation: &DrainingInvocation,
    observed: &crate::temporal::Observed,
) -> Result<String, sqlx::Error> {
    if observed.first_run_id.is_empty() || observed.run_id.is_empty() {
        return Err(sqlx::Error::Protocol(
            "Agent Workflow 缺少原生 run 引用".into(),
        ));
    }
    let mut tx = state.pool.begin().await?;
    let _ = crate::roles::lock_tenant(&mut tx, deletion.tenant_id).await?;
    let durable = load(&mut tx, deletion.tenant_id, deletion.snapshot_id)
        .await?
        .ok_or_else(|| sqlx::Error::Protocol("Agent drain 的删除快照缺失".into()))?;
    if durable.subprocess_state == "DELETED" || !durable.irreversible_dispatch_started {
        return Err(sqlx::Error::Protocol("Agent drain 已失去删除准入".into()));
    }
    let mut drain = durable
        .provider_evidence
        .get("AGENT_DRAIN")
        .cloned()
        .unwrap_or_else(|| json!({"cancel_chains":{}}));
    let chains = drain
        .get_mut("cancel_chains")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| sqlx::Error::Protocol("Agent cancel chain 证据不合结构".into()))?;
    let key = invocation.id.to_string();
    if let Some(chain) = chains.get(&key) {
        if chain.get("workflow_id").and_then(Value::as_str) != Some(&invocation.workflow_id)
            || chain.get("first_run_id").and_then(Value::as_str) != Some(&observed.first_run_id)
        {
            return Err(sqlx::Error::Protocol(
                "Agent Workflow 已偏离冻结执行链".into(),
            ));
        }
        return Ok(observed.first_run_id.clone());
    }
    chains.insert(
        key,
        json!({"workflow_id":invocation.workflow_id,"first_run_id":observed.first_run_id}),
    );
    sqlx::query("update admission.tenant_delete_subprocess set provider_evidence=provider_evidence || $2::jsonb where id=$1")
        .bind(deletion.subprocess_id).bind(json!({"AGENT_DRAIN":drain})).execute(&mut *tx).await?;
    let open = matches!(observed.state, crate::temporal::ObservedState::Open);
    deletion
        .audit(
            &mut tx,
            &format!("agent-chain:{}", invocation.id),
            if open { "DISPATCH" } else { "RECONCILIATION" },
            if open { "DISPATCH_PENDING" } else { "OBSERVED" },
            vec![
                Evidence::new(EvidenceKind::TemporalWorkflowId, &invocation.workflow_id),
                Evidence::new(EvidenceKind::TemporalFirstRunId, &observed.first_run_id),
                Evidence::new(
                    EvidenceKind::OriginalActionExecutionId,
                    invocation.action_execution_id,
                ),
            ],
        )
        .await?;
    tx.commit().await?;
    Ok(observed.first_run_id.clone())
}

async fn drain_agents(state: &ServiceState, deletion: &Delete) -> Result<bool, sqlx::Error> {
    let inventory = deletion
        .frozen_inventory
        .get("agent_inventory")
        .ok_or_else(|| sqlx::Error::Protocol("冻结清单缺少 Agent 适用性".into()))?;
    let frozen = agent_rows(inventory, "invocations")?;
    let mut tx = state.pool.begin().await?;
    let current: Option<(String, i32)> =
        sqlx::query_as("select state,version from identity.tenant where id=$1 for update")
            .bind(deletion.tenant_id)
            .fetch_optional(&mut *tx)
            .await?;
    if current != Some(("DELETING".into(), deletion.tenant_version + 1)) {
        return Ok(false);
    }
    let actual = frozen_agent_inventory(&mut tx, deletion.tenant_id)
        .await
        .map_err(|e| sqlx::Error::Protocol(format!("{e:?}")))?;
    if !same_agent_inventory(actual, inventory.clone())? {
        return Ok(false);
    }
    // Grant 生命周期可收紧，Scope/Use 及原 Action/Audit 引用仍保留在同一冻结清单。
    // 与首次 dispatch 共用 Tenant 锁；暂停/删除过程中不存在新 Use 的合法写者。
    sqlx::query(
        "update admission.delegation_grant set state='REVOKING',version=version+1
        where tenant_id=$1 and state='ACTIVE'",
    )
    .bind(deletion.tenant_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("update catalog.agent_installation set state='DRAINING' where resource_id in
        (select id from catalog.resource where tenant_id=$1) and state not in ('DRAINING','DISABLED')")
        .bind(deletion.tenant_id).execute(&mut *tx).await?;
    sqlx::query("update catalog.channel_agent_binding set status='DISABLED' where installation_resource_id in
        (select id from catalog.resource where tenant_id=$1) and status<>'DISABLED'")
        .bind(deletion.tenant_id).execute(&mut *tx).await?;
    sqlx::query("update catalog.agent_invocation set cancel_pending=true,updated_at=now()
        where tenant_id=$1 and status not in ('COMPLETED','FAILED','CANCELED') and not cancel_pending")
        .bind(deletion.tenant_id).execute(&mut *tx).await?;
    let invocations: Vec<DrainingInvocation> = sqlx::query_as(
        "select i.id,i.workflow_id,i.action_execution_id,i.status,i.native_status,i.reply_event_id,
                (i.status='CANCELED' and i.cancel_pending and i.runtime_turn_id is null
                 and i.native_status is null and i.reply_event_id is null
                 and not exists(select 1 from projection.agent_model_trace t where t.invocation_id=i.id)
                 and not exists(select 1 from outbox.usage_event u
                   where u.invocation_id=i.id or u.operation_id=a.operation_id)
                 and exists(select 1 from admission.capacity_lease l
                   where l.invocation_id=i.id and l.operation_id=a.operation_id
                     and l.tenant_id=i.tenant_id and l.workspace_id=i.workspace_id
                     and l.workflow_id=i.workflow_id and l.state='RELEASED'
                     and l.native_release_confirmed_at is not null
                     and l.terminal_event_id is not null and l.terminal_event_at is not null))
                as canceled_before_dispatch,
                w.projection_state as workflow_state,p.status as task_status,p.run_id as task_run_id,
                coalesce(p.observation_gap,true) as observation_gap
         from catalog.agent_invocation i
         join admission.action_execution a on a.id=i.action_execution_id
              and a.tenant_id=i.tenant_id and a.workspace_id=i.workspace_id
         join projection.workflow_ref w on w.workflow_id=i.workflow_id and w.tenant_id=i.tenant_id
              and w.workspace_id=i.workspace_id and w.action_execution_id=i.action_execution_id
              and w.workflow_type='AgentTaskWorkflow' and w.kind is null
         left join projection.task_projection p on p.workflow_id=w.workflow_id
         where i.tenant_id=$1 order by i.id",
    ).bind(deletion.tenant_id).fetch_all(&mut *tx).await?;
    if invocations.len() != frozen.len() {
        return Ok(false);
    }
    let durable = load(&mut tx, deletion.tenant_id, deletion.snapshot_id)
        .await?
        .ok_or_else(|| sqlx::Error::Protocol("Agent drain 快照已丢失".into()))?;
    if let Some(evidence) = durable.provider_evidence.get("AGENT_DRAIN") {
        let receipts = evidence.get("invocations").and_then(Value::as_array);
        if evidence.get("drained") == Some(&Value::Bool(true))
            && evidence.get("inventory_digest").and_then(Value::as_str)
                == Some(&deletion.inventory_digest)
            && receipts.is_some_and(|receipts| {
                receipts.len() == invocations.len()
                    && invocations.iter().all(|invocation| {
                        receipts.iter().any(|receipt| {
                            receipt.get("invocation_id").and_then(Value::as_str)
                                == Some(&invocation.id.to_string())
                                && receipt.get("workflow_id").and_then(Value::as_str)
                                    == Some(&invocation.workflow_id)
                                && receipt
                                    .get("first_run_id")
                                    .and_then(Value::as_str)
                                    .is_some_and(|run| !run.is_empty())
                                && receipt
                                    .get("status")
                                    .and_then(Value::as_str)
                                    .zip(receipt.get("run_id").and_then(Value::as_str))
                                    .is_some_and(|(status, run)| {
                                        invocation.terminal_matches(status, run)
                                    })
                        })
                    })
            })
        {
            tx.commit().await?;
            return Ok(true);
        }
    }
    tx.commit().await?;
    let mut drained = true;
    let mut receipts = Vec::new();
    let mut refs = Vec::new();
    for invocation in invocations {
        let observed = match state.temporal.describe(&invocation.workflow_id).await {
            Ok(Some(observed)) => observed,
            _ => {
                drained = false;
                continue;
            }
        };
        let first_run = agent_cancel_chain(state, deletion, &invocation, &observed).await?;
        let terminal = match &observed.state {
            crate::temporal::ObservedState::Closed(contracts::TaskStatus::Completed) => {
                Some("COMPLETED")
            }
            crate::temporal::ObservedState::Closed(contracts::TaskStatus::Failed) => Some("FAILED"),
            crate::temporal::ObservedState::Closed(contracts::TaskStatus::Canceled) => {
                Some("CANCELED")
            }
            _ => None,
        };
        if let Some(status) =
            terminal.filter(|status| invocation.terminal_matches(status, &observed.run_id))
        {
            receipts.push(
                json!({"invocation_id":invocation.id,"workflow_id":invocation.workflow_id,
                "first_run_id":first_run,"run_id":observed.run_id,"status":status}),
            );
            refs.extend([
                Evidence::new(EvidenceKind::TemporalWorkflowId, &invocation.workflow_id),
                Evidence::new(EvidenceKind::TemporalFirstRunId, first_run),
                Evidence::new(EvidenceKind::TemporalRunId, observed.run_id),
            ]);
        } else {
            drained = false;
            if matches!(observed.state, crate::temporal::ObservedState::Open) {
                let recorded = state
                    .temporal
                    .cancel_request_recorded(
                        &invocation.workflow_id,
                        &first_run,
                        deletion.action_execution_id,
                    )
                    .await;
                if matches!(recorded, Ok(false)) {
                    // 相同请求 ID + 首次 run fence；接收/超时都等下一轮原工作流观察。
                    let _ = state
                        .temporal
                        .request_cancel(
                            &invocation.workflow_id,
                            &first_run,
                            deletion.action_execution_id,
                        )
                        .await;
                }
            }
        }
    }
    if !drained {
        return Ok(false);
    }
    let mut tx = state.pool.begin().await?;
    let _ = crate::roles::lock_tenant(&mut tx, deletion.tenant_id).await?;
    let durable = load(&mut tx, deletion.tenant_id, deletion.snapshot_id)
        .await?
        .ok_or_else(|| sqlx::Error::Protocol("Agent drain 快照已丢失".into()))?;
    let mut evidence = durable
        .provider_evidence
        .get("AGENT_DRAIN")
        .cloned()
        .unwrap_or_else(|| json!({"cancel_chains":{}}));
    let object = evidence
        .as_object_mut()
        .ok_or_else(|| sqlx::Error::Protocol("Agent drain 证据不是对象".into()))?;
    object.insert("drained".into(), Value::Bool(true));
    object.insert(
        "inventory_digest".into(),
        Value::String(deletion.inventory_digest.clone()),
    );
    object.insert("invocations".into(), Value::Array(receipts));
    sqlx::query("update admission.tenant_delete_subprocess set provider_evidence=provider_evidence || $2::jsonb where id=$1 and state<>'DELETED'")
        .bind(deletion.subprocess_id).bind(json!({"AGENT_DRAIN":evidence})).execute(&mut *tx).await?;
    deletion
        .audit(&mut tx, "AGENT_DRAIN", "RECONCILIATION", "DRAINED", refs)
        .await?;
    tx.commit().await?;
    Ok(true)
}

async fn retire_schedules(state: &ServiceState, deletion: &Delete) -> Result<bool, sqlx::Error> {
    let frozen = deletion
        .frozen_inventory
        .pointer("/agent_inventory/automation_schedule_refs")
        .cloned();
    // Before Schedule existed, an absent category is compatible only with no
    // persisted native Schedule intent/reference. Never invent an absence receipt.
    let frozen = if let Some(value) = frozen {
        value
    } else {
        let exists:bool=sqlx::query_scalar("select exists(select 1 from catalog.automation_definition d join catalog.resource r on r.id=d.resource_id
            where r.tenant_id=$1 and d.schedule_id is not null) or exists(select 1 from admission.action_execution
            where tenant_id=$1 and parameters ? 'scheduleIntent')")
            .bind(deletion.tenant_id).fetch_one(&state.pool).await?;
        if exists {
            return Ok(false);
        }
        json!([])
    };
    let ids: Vec<String> =
        serde_json::from_value(frozen).map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
    for id in &ids {
        let mut tx = state.pool.begin().await?;
        let current: Option<(String, i32)> =
            sqlx::query_as("select state,version from identity.tenant where id=$1 for update")
                .bind(deletion.tenant_id)
                .fetch_optional(&mut *tx)
                .await?;
        let durable = load(&mut tx, deletion.tenant_id, deletion.snapshot_id)
            .await?
            .ok_or_else(|| sqlx::Error::Protocol("Schedule 删除原 subprocess 缺失".into()))?;
        if current != Some(("DELETING".into(), deletion.tenant_version + 1))
            || !durable.irreversible_dispatch_started
            || durable.inventory_digest != deletion.inventory_digest
        {
            return Ok(false);
        }
        let observed = state
            .temporal
            .describe_schedule(id)
            .await
            .map_err(|_| sqlx::Error::Protocol("Schedule 删除 Describe 未知".into()))?;
        if observed.is_none() {
            tx.commit().await?;
            continue;
        }
        let started: Vec<String> = serde_json::from_value(
            durable
                .provider_evidence
                .pointer("/TEMPORAL_SCHEDULES/dispatched")
                .cloned()
                .unwrap_or_else(|| json!([])),
        )
        .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
        if started.contains(id) {
            return Ok(false);
        }
        let mut started = started;
        started.push(id.clone());
        sqlx::query("update admission.tenant_delete_subprocess set provider_evidence=provider_evidence||jsonb_build_object('TEMPORAL_SCHEDULES',$2::jsonb) where id=$1")
            .bind(durable.subprocess_id).bind(json!({"dispatched":started,"inventory_digest":deletion.inventory_digest,"deleted":false}))
            .execute(&mut *tx).await?;
        tx.commit().await?;
        let mut guard = state.pool.begin().await?;
        let current: Option<(String, i32)> =
            sqlx::query_as("select state,version from identity.tenant where id=$1 for update")
                .bind(deletion.tenant_id)
                .fetch_optional(&mut *guard)
                .await?;
        if current != Some(("DELETING".into(), deletion.tenant_version + 1)) {
            return Ok(false);
        }
        if state.temporal.delete_schedule(id).await.is_err() {
            return Ok(false);
        }
        // ACK 不充当缺席证据；只能查同 native ID。
        if state
            .temporal
            .describe_schedule(id)
            .await
            .map_err(|_| sqlx::Error::Protocol("Schedule 删除结果未知".into()))?
            .is_some()
        {
            return Ok(false);
        }
        guard.commit().await?;
    }
    let mut tx = state.pool.begin().await?;
    let durable = load(&mut tx, deletion.tenant_id, deletion.snapshot_id)
        .await?
        .ok_or_else(|| sqlx::Error::Protocol("Schedule 删除原 subprocess 缺失".into()))?;
    let mut evidence = durable
        .provider_evidence
        .get("TEMPORAL_SCHEDULES")
        .cloned()
        .unwrap_or_else(|| json!({"dispatched":[]}));
    let object = evidence
        .as_object_mut()
        .ok_or_else(|| sqlx::Error::Protocol("Schedule 删除证据损坏".into()))?;
    object.insert("deleted".into(), Value::Bool(true));
    object.insert(
        "inventory_digest".into(),
        Value::String(deletion.inventory_digest.clone()),
    );
    object.insert("native_absence".into(), json!(ids));
    // Keep every pre-RPC dispatch flag even after native absence was confirmed.
    // A later reappearance cannot authorize a second delete of that exact ID.
    sqlx::query("update admission.tenant_delete_subprocess set provider_evidence=provider_evidence||jsonb_build_object('TEMPORAL_SCHEDULES',$2::jsonb) where id=$1")
        .bind(durable.subprocess_id).bind(evidence).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(true)
}

async fn retire_agents(state: &ServiceState, deletion: &Delete) -> Result<bool, sqlx::Error> {
    if !drain_agents(state, deletion).await? {
        return Ok(false);
    }
    let inventory = deletion
        .frozen_inventory
        .get("agent_inventory")
        .ok_or_else(|| sqlx::Error::Protocol("冻结清单缺少 Agent 适用性".into()))?;
    let installations = agent_rows(inventory, "installations")?;
    let mut retired = Vec::new();
    for installation in installations {
        let id: Uuid = serde_json::from_value(installation["resource_id"].clone())
            .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
        let Some(runtime) = state.agent_runtime.as_ref() else {
            return Ok(false);
        };
        if let Err(error) = runtime.retirement(&state.pool, id).await {
            tracing::warn!(tenant_id = %deletion.tenant_id, installation_id = %id, error = %error, "Agent 隔离运行状态销毁未查证");
            return Ok(false);
        }
        retired.push(id);
    }
    persist(
        state,
        deletion,
        Some((
            "AGENT_RUNTIME",
            json!({"deleted":true,
        "inventory_digest":deletion.inventory_digest,"installations":retired}),
        )),
    )
    .await?;
    let mut tx = state.pool.begin().await?;
    let durable = load(&mut tx, deletion.tenant_id, deletion.snapshot_id)
        .await?
        .ok_or_else(|| sqlx::Error::Protocol("Agent Gateway 销毁快照已丢失".into()))?;
    tx.commit().await?;
    if durable.provider_evidence.pointer("/GATEWAY/deleted") == Some(&Value::Bool(true))
        && durable
            .provider_evidence
            .pointer("/GATEWAY/inventory_digest")
            .and_then(Value::as_str)
            == Some(&deletion.inventory_digest)
    {
        // 已查证的 native absence 可在 namespace 销毁后恢复，不能再读已删 SecretRef。
        return Ok(true);
    }
    let routes: Vec<crate::model_route::FrozenRoute> = serde_json::from_value(
        inventory
            .get("model_routes")
            .cloned()
            .ok_or_else(|| sqlx::Error::Protocol("冻结模型库存缺失".into()))?,
    )
    .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
    let mut absent = Vec::new();
    for route in routes {
        match crate::model_route::retire(state, deletion.tenant_id, &route).await {
            Ok(evidence) => absent.extend(evidence),
            Err(error) => {
                tracing::warn!(tenant_id = %deletion.tenant_id, route_id = %route.resource_id, error = ?error, "Gateway 模型/凭据销毁未查证");
                return Ok(false);
            }
        }
    }
    let creates: Vec<crate::model_route::FrozenCreation> = serde_json::from_value(
        inventory
            .get("model_route_creates")
            .cloned()
            .unwrap_or_else(|| json!([])),
    )
    .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
    let create_absence = match crate::model_route::retire_creations(
        state,
        deletion.tenant_id,
        &creates,
    )
    .await
    {
        Ok(evidence) => evidence,
        Err(error) => {
            tracing::warn!(tenant_id=%deletion.tenant_id,error=?error,"Gateway 创建意图销毁未查证");
            return Ok(false);
        }
    };
    persist(
        state,
        deletion,
        Some((
            "GATEWAY",
            json!({"deleted":true,
        "inventory_digest":deletion.inventory_digest,"native_absence":absent,"creation_absence":create_absence}),
        )),
    )
    .await?;
    Ok(true)
}

#[derive(sqlx::FromRow)]
struct Delete {
    snapshot_id: Uuid,
    subprocess_id: Uuid,
    tenant_id: Uuid,
    tenant_version: i32,
    action_execution_id: Uuid,
    inventory_digest: String,
    frozen_inventory: Value,
    irreversible_dispatch_started: bool,
    subprocess_state: String,
    snapshot_state: String,
    provider_evidence: Value,
    canceled: bool,
    operation_id: Uuid,
    initiator_principal_id: Uuid,
    actor_principal_id: Uuid,
    action_version: i32,
    parameter_hash: String,
    correlation_id: Uuid,
}

/// 关系销毁前的原生观察证据，仅供同一删除链的受限读取；不是当前写权限。
#[derive(serde::Deserialize, serde::Serialize)]
struct LifecycleReaders {
    snapshot_id: Uuid,
    tenant_version: i32,
    inventory_digest: String,
    readers: Vec<LifecycleReader>,
}

#[derive(serde::Deserialize, serde::Serialize)]
struct LifecycleReader {
    principal_id: Uuid,
    revisions: Vec<String>,
}

impl LifecycleReaders {
    fn matches(&self, snapshot: Uuid, version: i32, digest: &str) -> bool {
        self.snapshot_id == snapshot
            && self.tenant_version == version
            && self.inventory_digest == digest
            && !self.readers.is_empty()
            && self.readers.iter().all(|reader| {
                !reader.revisions.is_empty()
                    && reader.revisions.iter().all(|revision| !revision.is_empty())
            })
    }

    fn evidence(&self) -> Vec<Evidence> {
        self.readers
            .iter()
            .flat_map(|reader| reader.revisions.iter())
            .map(|revision| Evidence::new(EvidenceKind::SpicedbZedtoken, revision))
            .collect()
    }
}

/// 调用方已持有 Tenant 与当前 HUMAN membership 锁。原生关系销毁后不再重新
/// 推断角色：只消费销毁前与同一 snapshot/operation 原子持久化的观察证据。
pub(crate) async fn lifecycle_reader_eligible(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    principal: Uuid,
    action_execution_id: Option<Uuid>,
) -> Result<bool, sqlx::Error> {
    let rows: Vec<(Uuid, Uuid, i32, String, Value, Uuid, Uuid)> = sqlx::query_as(
        "select s.id,p.id,s.tenant_version,s.inventory_digest,
                p.provider_evidence->'LIFECYCLE_READERS',a.id,a.operation_id
         from admission.tenant_lifecycle_snapshot s
         join identity.tenant t on t.id=s.tenant_id
         join admission.tenant_delete_subprocess p on p.tenant_lifecycle_snapshot_id=s.id
              and p.tenant_id=s.tenant_id and p.subject='PLATFORM_CORE' and p.mode='PLATFORM_CORE_CHAIN'
         join admission.action_execution a on a.id=s.action_execution_id
              and a.tenant_id=s.tenant_id and a.target_id=s.tenant_id
              and a.action_key='tenant.delete' and a.gate_state='ALLOWED'
         join projection.workflow_ref w on w.action_execution_id=a.id
              and w.workflow_id=a.temporal_workflow_id and w.tenant_id=s.tenant_id
              and w.kind='TENANT_LIFECYCLE'
         where s.tenant_id=$1 and ($2::uuid is null or a.id=$2)
           and t.state='DELETING' and s.state='DELETING' and s.tenant_version=t.version-1
           and s.irreversible_dispatch_started and p.state in ('RUNNING','UNKNOWN')
           and p.provider_evidence ? 'LIFECYCLE_READERS'",
    )
    .bind(tenant)
    .bind(action_execution_id)
    .fetch_all(&mut *conn)
    .await?;
    for (snapshot, subprocess, version, digest, value, execution, operation) in rows {
        let readers: LifecycleReaders =
            serde_json::from_value(value).map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
        if !readers.matches(snapshot, version, &digest)
            || !readers
                .readers
                .iter()
                .any(|reader| reader.principal_id == principal)
        {
            continue;
        }
        let mut evidence = readers.evidence();
        evidence.extend([
            Evidence::new(EvidenceKind::TenantLifecycleSnapshotId, snapshot),
            Evidence::new(EvidenceKind::TenantDeleteSubprocessId, subprocess),
            Evidence::new(EvidenceKind::ActionExecutionId, execution),
        ]);
        let recorded: bool = sqlx::query_scalar(
            "select exists(select 1 from audit.audit_event
             where event_key=$1 and tenant_id=$2 and operation_id=$3
               and action_key='tenant.delete' and result_code='ADMITTED'
               and evidence_refs @> $4::jsonb)",
        )
        .bind(format!("tenant-delete:{subprocess}:lifecycle-readers"))
        .bind(tenant)
        .bind(operation)
        .bind(audit::evidence_json(&evidence))
        .fetch_one(&mut *conn)
        .await?;
        if recorded {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn freeze_lifecycle_readers(
    state: &ServiceState,
    tx: &mut Transaction<'_, Postgres>,
    deletion: &Delete,
) -> Result<Option<LifecycleReaders>, sqlx::Error> {
    let tenant_id = deletion.tenant_id.to_string();
    let admins = state
        .governance
        .spicedb
        .read(
            &crate::spicedb::RelationshipFilter {
                object_type: "tenant",
                object_id: Some(&tenant_id),
                relation: Some("admin"),
                subject_principal: None,
            },
            state.governance.cfg.relationship_page,
        )
        .await
        .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
    let mut readers = std::collections::BTreeMap::<Uuid, Vec<String>>::new();
    for admin in admins {
        let principal = Uuid::parse_str(&admin.subject_principal)
            .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
        if !crate::agent_definition::active_owner(tx, deletion.tenant_id, principal).await? {
            continue;
        }
        let check = state
            .governance
            .spicedb
            .check(
                "tenant",
                &tenant_id,
                "manage",
                &admin.subject_principal,
                crate::spicedb::Consistency::FullyConsistent,
            )
            .await
            .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
        if !check.allowed || check.zed_token.is_empty() {
            return Ok(None);
        }
        readers.entry(principal).or_default().push(check.zed_token);
    }
    let mut owners: Vec<contracts::AffectedOwnerRef> =
        serde_json::from_value(deletion.frozen_inventory["resource_owner_versions"].clone())
            .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
    owners.extend(
        serde_json::from_value::<Vec<contracts::AffectedOwnerRef>>(
            deletion.frozen_inventory["asset_owner_versions"].clone(),
        )
        .map_err(|e| sqlx::Error::Protocol(e.to_string()))?,
    );
    if !crate::agent_definition::validate_frozen_owners(
        &state.governance,
        tx,
        deletion.tenant_id,
        &owners,
    )
    .await
    .map_err(|e| sqlx::Error::Protocol(format!("{e:?}")))?
    {
        return Ok(None);
    }
    for owner in owners {
        let kind = match owner.target_type.as_str() {
            "RESOURCE" => "resource",
            "ASSET" => "asset",
            _ => return Ok(None),
        };
        let principal = Uuid::parse_str(&owner.owner_principal_id)
            .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
        let check = state
            .governance
            .spicedb
            .check(
                kind,
                &owner.target_id,
                "read",
                &owner.owner_principal_id,
                crate::spicedb::Consistency::FullyConsistent,
            )
            .await
            .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
        if !check.allowed || check.zed_token.is_empty() {
            return Ok(None);
        }
        readers.entry(principal).or_default().push(check.zed_token);
    }
    if readers.is_empty() {
        return Ok(None);
    }
    Ok(Some(LifecycleReaders {
        snapshot_id: deletion.snapshot_id,
        tenant_version: deletion.tenant_version,
        inventory_digest: deletion.inventory_digest.clone(),
        readers: readers
            .into_iter()
            .map(|(principal_id, revisions)| LifecycleReader {
                principal_id,
                revisions,
            })
            .collect(),
    }))
}

impl Delete {
    fn result(&self) -> TenantDeleteAdvanceResult {
        TenantDeleteAdvanceResult {
            snapshot_id: self.snapshot_id.to_string(),
            subprocess_id: self.subprocess_id.to_string(),
            irreversible_dispatch_started: self.irreversible_dispatch_started,
            completed: self.subprocess_state == "DELETED" && self.irreversible_dispatch_started,
            canceled: self.canceled && !self.irreversible_dispatch_started,
            native_request_id: self
                .provider_evidence
                .pointer("/BUZZ/request_id")
                .and_then(Value::as_str)
                .map(str::to_owned),
            native_inventory_digest: self
                .provider_evidence
                .pointer("/BUZZ/inventory_digest")
                .and_then(Value::as_str)
                .map(str::to_owned),
        }
    }

    async fn audit(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        stage: &str,
        event_type: &str,
        result_code: &str,
        mut refs: Vec<Evidence>,
    ) -> Result<(), sqlx::Error> {
        refs.push(Evidence::new(
            EvidenceKind::TenantLifecycleSnapshotId,
            self.snapshot_id,
        ));
        refs.push(Evidence::new(
            EvidenceKind::TenantDeleteSubprocessId,
            self.subprocess_id,
        ));
        refs.push(Evidence::new(
            EvidenceKind::ActionExecutionId,
            self.action_execution_id,
        ));
        audit::append(
            tx,
            AuditEntry {
                event_key: format!("tenant-delete:{}:{stage}", self.subprocess_id),
                tenant_id: Some(self.tenant_id),
                workspace_id: None,
                operation_id: self.operation_id,
                event_type,
                human_identity_id: None,
                initiator_principal_id: Some(self.initiator_principal_id),
                actor_principal_id: Some(self.actor_principal_id),
                action_key: "tenant.delete",
                action_version: self.action_version,
                component_type_key: "CORE_INTERNAL",
                target_type: Some("TENANT"),
                target_id: Some(self.tenant_id),
                parameter_hash: &self.parameter_hash,
                decision: "ALLOW",
                result_code,
                result_exposure: "NONE",
                evidence_refs: refs,
                correlation_id: self.correlation_id,
            },
        )
        .await
    }
}

async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    snapshot: Uuid,
) -> Result<Option<Delete>, sqlx::Error> {
    sqlx::query_as(
        "select s.id as snapshot_id,p.id as subprocess_id,s.tenant_id,s.tenant_version,
                s.action_execution_id,s.inventory_digest,s.frozen_inventory,
                s.irreversible_dispatch_started,p.state as subprocess_state,
                s.state as snapshot_state,p.provider_evidence,
                exists(select 1 from audit.audit_event e
                       where e.event_key = 'tenant-delete:' || p.id::text || ':canceled') as canceled,
                a.operation_id,a.initiator_principal_id,a.actor_principal_id,
                a.action_version,a.parameter_hash,a.correlation_id
         from admission.tenant_lifecycle_snapshot s
         join admission.tenant_delete_subprocess p on p.tenant_lifecycle_snapshot_id = s.id
              and p.tenant_id = s.tenant_id and p.subject = 'PLATFORM_CORE'
              and p.mode = 'PLATFORM_CORE_CHAIN'
         join admission.action_execution a on a.id = s.action_execution_id
              and a.tenant_id = s.tenant_id and a.target_id = s.tenant_id
              and a.action_key = 'tenant.delete' and a.gate_state = 'ALLOWED'
         join projection.workflow_ref w on w.action_execution_id = a.id
              and w.workflow_id = a.temporal_workflow_id
              and w.tenant_id = s.tenant_id and w.kind = 'TENANT_LIFECYCLE'
         where s.id = $1 and s.tenant_id = $2 for update of s,p"
    ).bind(snapshot).bind(tenant).fetch_optional(&mut **tx).await
}

pub async fn advance(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<TenantDeleteAdvanceRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(response) = authorize(&state, &headers).await {
        return response;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let (Ok(tenant), Ok(snapshot), Ok(version)) = (
        Uuid::parse_str(&req.tenant_id),
        Uuid::parse_str(&req.snapshot_id),
        i32::try_from(req.tenant_version),
    ) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    match advance_inner(&state, tenant, snapshot, version, req.cancel_requested).await {
        Ok(Some(result)) => Json(result).into_response(),
        Ok(None) => StatusCode::CONFLICT.into_response(),
        Err(error) => unavailable(error),
    }
}

async fn advance_inner(
    state: &ServiceState,
    tenant: Uuid,
    snapshot: Uuid,
    version: i32,
    cancel: bool,
) -> Result<Option<TenantDeleteAdvanceResult>, sqlx::Error> {
    let mut tx = state.pool.begin().await?;
    let current: Option<(String, i32)> =
        sqlx::query_as("select state,version from identity.tenant where id = $1 for update")
            .bind(tenant)
            .fetch_optional(&mut *tx)
            .await?;
    let Some(mut deletion) = load(&mut tx, tenant, snapshot).await? else {
        return Ok(None);
    };
    if tenant == state.catalog_tenant
        || deletion.tenant_version.checked_add(1) != Some(version)
        || deletion.inventory_digest
            != hex::encode(Sha256::digest(
                deletion.frozen_inventory.to_string().as_bytes(),
            ))
    {
        return Ok(None);
    }
    if deletion.canceled || deletion.subprocess_state == "DELETED" {
        return Ok(Some(deletion.result()));
    }
    if current != Some(("DELETING".to_owned(), version)) || deletion.snapshot_state != "DELETING" {
        return Ok(None);
    }
    if cancel && !deletion.irreversible_dispatch_started {
        sqlx::query(
            "update identity.tenant set state = 'SUSPENDED',version = version + 1 where id = $1",
        )
        .bind(tenant)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "update admission.tenant_lifecycle_snapshot set state = 'SUSPENDED' where id = $1",
        )
        .bind(snapshot)
        .execute(&mut *tx)
        .await?;
        deletion
            .audit(&mut tx, "canceled", "RECONCILIATION", "CANCELED", vec![])
            .await?;
        tx.commit().await?;
        deletion.canceled = true;
        return Ok(Some(deletion.result()));
    }
    if !deletion.irreversible_dispatch_started {
        // 身份引用冻结和秘钥写者都在不可逆分界前重新查证；缺处理器不会派发。
        let current_inventory =
            crate::governance::frozen_delete_inventory(&mut tx, tenant, deletion.tenant_version)
                .await;
        if current_inventory.ok().as_ref() != Some(&deletion.frozen_inventory)
            || !secrets_ready(&state.secrets, &mut tx, tenant).await?
            || state.deletion_transport.is_none()
        {
            mark_unknown(&mut tx, &deletion).await?;
            tx.commit().await?;
            return Ok(Some(deletion.result()));
        }
        let readers = match freeze_lifecycle_readers(state, &mut tx, &deletion).await {
            Ok(Some(readers)) => readers,
            result => {
                if let Err(error) = result {
                    tracing::warn!(tenant_id = %tenant, error = %error, "生命周期读取资格未查证");
                }
                mark_unknown(&mut tx, &deletion).await?;
                tx.commit().await?;
                return Ok(Some(deletion.result()));
            }
        };
        let checkpoint = json!({"LIFECYCLE_READERS": readers});
        sqlx::query("update admission.tenant_delete_subprocess set provider_evidence=provider_evidence || $2::jsonb where id=$1")
            .bind(deletion.subprocess_id).bind(&checkpoint).execute(&mut *tx).await?;
        deletion
            .audit(
                &mut tx,
                "lifecycle-readers",
                "RECONCILIATION",
                "ADMITTED",
                readers.evidence(),
            )
            .await?;
        deletion
            .provider_evidence
            .as_object_mut()
            .ok_or_else(|| sqlx::Error::Protocol("删除 provider evidence 不是对象".into()))?
            .insert(
                "LIFECYCLE_READERS".into(),
                checkpoint["LIFECYCLE_READERS"].clone(),
            );
        sqlx::query("update admission.tenant_lifecycle_snapshot set irreversible_dispatch_started = true where id = $1")
            .bind(snapshot).execute(&mut *tx).await?;
        deletion
            .audit(&mut tx, "dispatch", "DISPATCH", "DISPATCHED", vec![])
            .await?;
        deletion.irreversible_dispatch_started = true;
    }
    let readers = deletion
        .provider_evidence
        .get("LIFECYCLE_READERS")
        .cloned()
        .map(serde_json::from_value::<LifecycleReaders>);
    if !matches!(readers, Some(Ok(ref readers)) if readers.matches(
        deletion.snapshot_id, deletion.tenant_version, &deletion.inventory_digest,
    )) {
        mark_unknown(&mut tx, &deletion).await?;
        tx.commit().await?;
        return Ok(Some(deletion.result()));
    }
    sqlx::query("update admission.tenant_delete_subprocess set state = 'RUNNING',version = version + 1 where id = $1")
        .bind(deletion.subprocess_id).execute(&mut *tx).await?;
    tx.commit().await?;

    // drain 未证实前保留 runtime、模型 credential、Buzz Memory 与 namespace，
    // 让原 AgentTaskWorkflow 继续 interrupt/usage/capacity 对账，绝不抹掉 UNKNOWN。
    match retire_schedules(state, &deletion).await {
        Ok(true) => {}
        result => {
            if let Err(error) = result {
                tracing::warn!(tenant_id=%tenant,error=%error,"Schedule 库存销毁未查证");
            }
            persist(state, &deletion, None).await?;
            return reload_result(state, tenant, snapshot).await;
        }
    }
    match retire_agents(state, &deletion).await {
        Ok(true) => {}
        result => {
            if let Err(error) = result {
                tracing::warn!(tenant_id = %tenant, error = %error, "Agent 库存销毁未对账");
            }
            persist(state, &deletion, None).await?;
            return reload_result(state, tenant, snapshot).await;
        }
    }
    let Some(transport) = &state.deletion_transport else {
        persist(state, &deletion, None).await?;
        return reload_result(state, tenant, snapshot).await;
    };
    // 原生处理器幂等且相互独立，某一个 UNKNOWN 不把其他类别的确定证据抹掉。
    match buzz(state, transport, &deletion).await {
        Ok(evidence) => persist(state, &deletion, Some(("BUZZ", evidence))).await?,
        Err(error) => {
            tracing::warn!(tenant_id = %tenant, error, "Buzz 删除未对账");
            persist(state, &deletion, None).await?;
        }
    }
    let mut spicedb_evidence = serde_json::Map::new();
    let workspaces: Vec<Uuid> =
        sqlx::query_scalar("select id from identity.workspace where tenant_id = $1 order by id")
            .bind(tenant)
            .fetch_all(&state.pool)
            .await?;
    let mut relationships_absent = true;
    let mut owners: Vec<contracts::AffectedOwnerRef> =
        serde_json::from_value(deletion.frozen_inventory["resource_owner_versions"].clone())
            .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
    owners.extend(
        serde_json::from_value::<Vec<contracts::AffectedOwnerRef>>(
            deletion.frozen_inventory["asset_owner_versions"].clone(),
        )
        .map_err(|e| sqlx::Error::Protocol(e.to_string()))?,
    );
    let owned_objects: Vec<(&str, Uuid)> = owners
        .into_iter()
        .map(|r| {
            let kind = match r.target_type.as_str() {
                "RESOURCE" => "resource",
                "ASSET" => "asset",
                _ => return Err(sqlx::Error::Protocol("冻结 owner 对象类型未知".into())),
            };
            Uuid::parse_str(&r.target_id)
                .map(|id| (kind, id))
                .map_err(|e| sqlx::Error::Protocol(e.to_string()))
        })
        .collect::<Result<_, _>>()?;
    for (kind, id) in std::iter::once(("tenant", tenant))
        .chain(workspaces.iter().map(|id| ("workspace", *id)))
        .chain(owned_objects.iter().copied())
    {
        match state
            .governance
            .spicedb
            .delete_object(&transport.http, kind, id)
            .await
        {
            Ok(token) => {
                spicedb_evidence.insert(format!("{kind}:{id}"), Value::String(token));
            }
            Err(error) => {
                relationships_absent = false;
                tracing::warn!(tenant_id = %tenant, error = %error, "SpiceDB 删除未对账");
            }
        }
    }
    if relationships_absent {
        persist(
            state,
            &deletion,
            Some((
                "SPICEDB",
                json!({"deleted":true,"revisions":spicedb_evidence}),
            )),
        )
        .await?;
    } else {
        persist(state, &deletion, None).await?;
    }
    if audit_gate(state).await.is_ok() {
        match state.secrets.delete_tenant(tenant).await {
            Ok(true) => {
                persist(
                    state,
                    &deletion,
                    Some(("OPENBAO", json!({"deleted":true,"namespace_id":tenant}))),
                )
                .await?
            }
            Ok(false) => persist(state, &deletion, None).await?,
            Err(error) => {
                tracing::warn!(tenant_id = %tenant, error = %error, "OpenBao namespace 删除未对账");
                persist(state, &deletion, None).await?;
            }
        }
    } else {
        persist(state, &deletion, None).await?;
    }
    if let Err(error) = retire_openmeter(state, &deletion).await {
        tracing::warn!(tenant_id = %tenant, error, "OpenMeter Customer 退役未对账");
        persist(state, &deletion, None).await?;
    }
    finish(state, &deletion).await?;
    reload_result(state, tenant, snapshot).await
}

async fn reload_result(
    state: &ServiceState,
    tenant: Uuid,
    snapshot: Uuid,
) -> Result<Option<TenantDeleteAdvanceResult>, sqlx::Error> {
    let mut tx = state.pool.begin().await?;
    Ok(load(&mut tx, tenant, snapshot).await?.map(|d| d.result()))
}

async fn persist(
    state: &ServiceState,
    deletion: &Delete,
    provider: Option<(&str, Value)>,
) -> Result<(), sqlx::Error> {
    let mut tx = state.pool.begin().await?;
    let terminal: Option<String> = sqlx::query_scalar(
        "select state from admission.tenant_delete_subprocess where id = $1 for update",
    )
    .bind(deletion.subprocess_id)
    .fetch_optional(&mut *tx)
    .await?;
    if terminal.as_deref() == Some("DELETED") {
        return Ok(());
    }
    if let Some((kind, evidence)) = provider {
        let refs = if kind == "BUZZ" {
            native_refs(&evidence)
        } else if kind == "SPICEDB" {
            evidence
                .get("revisions")
                .and_then(Value::as_object)
                .into_iter()
                .flat_map(|m| m.values())
                .filter_map(Value::as_str)
                .map(|token| Evidence::new(EvidenceKind::SpicedbZedtoken, token))
                .collect()
        } else {
            vec![]
        };
        sqlx::query("update admission.tenant_delete_subprocess set provider_evidence = provider_evidence || $2::jsonb where id = $1")
            .bind(deletion.subprocess_id).bind(json!({kind:evidence})).execute(&mut *tx).await?;
        deletion
            .audit(&mut tx, kind, "RECONCILIATION", "DELETED", refs)
            .await?;
    } else {
        mark_unknown(&mut tx, deletion).await?;
    }
    tx.commit().await
}

async fn mark_unknown(
    tx: &mut Transaction<'_, Postgres>,
    deletion: &Delete,
) -> Result<(), sqlx::Error> {
    sqlx::query("update admission.tenant_delete_subprocess set state = 'UNKNOWN',version = version + 1 where id = $1 and state <> 'DELETED'")
        .bind(deletion.subprocess_id).execute(&mut **tx).await?;
    deletion
        .audit(tx, "unknown", "RECONCILIATION", "RESULT_UNKNOWN", vec![])
        .await
}

fn native_refs(evidence: &Value) -> Vec<Evidence> {
    [
        ("request_id", EvidenceKind::BuzzDeletionRequestId),
        (
            "inventory_digest",
            EvidenceKind::BuzzDeletionInventoryDigest,
        ),
    ]
    .into_iter()
    .filter_map(|(key, kind)| {
        evidence
            .get(key)
            .and_then(Value::as_str)
            .map(|value| Evidence::new(kind, value))
    })
    .collect()
}

async fn native_reference(
    state: &ServiceState,
    deletion: &Delete,
    request_id: Uuid,
    digest: Option<&str>,
) -> Result<(), sqlx::Error> {
    let evidence = json!({"request_id":request_id,"inventory_digest":digest});
    let mut tx = state.pool.begin().await?;
    // 重试先观察同一请求不能清除已经确定的 digest；原生 abort 后的新请求
    // 则不能继承旧请求的 digest。两者与引用列表在同一行更新中仲裁。
    let written = sqlx::query("update admission.tenant_delete_subprocess set external_execution_ids = case
        when external_execution_ids @> $2::jsonb then external_execution_ids else external_execution_ids || $2::jsonb end,
        provider_evidence = provider_evidence || case
            when provider_evidence #>> '{BUZZ,request_id}' = $3::jsonb #>> '{BUZZ,request_id}'
                and $3::jsonb #> '{BUZZ,inventory_digest}' = 'null'::jsonb
            then jsonb_set($3::jsonb, '{BUZZ,inventory_digest}',
                coalesce(provider_evidence #> '{BUZZ,inventory_digest}', 'null'::jsonb))
            else $3::jsonb end
        where id = $1 and state <> 'DELETED'")
        .bind(deletion.subprocess_id).bind(json!([request_id])).bind(json!({"BUZZ":evidence}))
        .execute(&mut *tx).await?;
    if written.rows_affected() != 0 {
        let stage = match digest {
            Some(digest) => format!("native:{request_id}:digest:{digest}"),
            None => format!("native:{request_id}:observed"),
        };
        deletion
            .audit(
                &mut tx,
                &stage,
                "RECONCILIATION",
                "DISPATCHED",
                native_refs(&evidence),
            )
            .await?;
    }
    tx.commit().await
}

async fn buzz(
    state: &ServiceState,
    transport: &DeletionTransport,
    deletion: &Delete,
) -> Result<Value, String> {
    let binding = deletion
        .frozen_inventory
        .get("tenant_buzz_binding")
        .ok_or("缺少冻结 Buzz binding")?;
    let host = binding
        .get("normalized_host")
        .and_then(Value::as_str)
        .ok_or("缺少冻结 host")?;
    let community = binding
        .get("community_id")
        .and_then(Value::as_str)
        .ok_or("缺少冻结 Community ID")?;
    let control = binding
        .get("control_pubkey")
        .and_then(Value::as_str)
        .ok_or("缺少冻结 CONTROL pubkey")?;
    let operator = crate::tenant_lifecycle::load_operator(state)
        .await
        .map_err(|_| "operator 身份不可用")?;
    let requests = operator
        .list_community_deletions(&transport.http, &transport.origin, host)
        .await
        .map_err(|e| e.to_string())?;
    let requests = requests.as_array().ok_or("native list 不是完整请求数组")?;
    if requests.len() > 1 {
        return Err("同一 host 存在多个非 aborted 请求".into());
    }
    let mut request = match requests.first() {
        Some(request) => request.clone(),
        None => operator
            .submit_community_deletion(
                &transport.http,
                &transport.origin,
                host,
                deletion.subprocess_id,
            )
            .await
            .map_err(|e| e.to_string())?,
    };
    if request.get("community_host").and_then(Value::as_str) != Some(host)
        || request.get("community_id").and_then(Value::as_str) != Some(community)
    {
        return Err("原生请求目标不匹配冻结清单".into());
    }
    let request_id = request
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or("native request ID 无效")?;
    // 已知引用先落库；即使恢复 freeze 再次超时，也不丢掉已知请求或伪造 digest。
    native_reference(state, deletion, request_id, None)
        .await
        .map_err(|e| e.to_string())?;
    if request.get("stage").and_then(Value::as_str) == Some("submitted") {
        if request.get("requested_by").and_then(Value::as_str)
            != Some(&deletion.subprocess_id.to_string())
        {
            return Err("其他 operator 的 submitted 请求尚未冻结清单".into());
        }
        // 原生 submit 对同一 requested_by/host 的 submitted 请求恢复冻结，
        // 不创建第二条删除请求；第一次冻结 HTTP 回应丢失也走这条观察后的路径。
        request = operator
            .submit_community_deletion(
                &transport.http,
                &transport.origin,
                host,
                deletion.subprocess_id,
            )
            .await
            .map_err(|e| e.to_string())?;
        if request.get("id").and_then(Value::as_str) != Some(&request_id.to_string()) {
            return Err("恢复冻结返回了其他 native 请求".into());
        }
    }
    let digest = request
        .get("inventory_digest")
        .and_then(Value::as_str)
        .filter(|d| {
            d.len() == 64
                && d.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
        .ok_or("native inventory digest 未确定")?;
    // 即使 run 的 HTTP 回应丢失，native ID 和 digest 已在副作用前进入持久历史。
    native_reference(state, deletion, request_id, Some(digest))
        .await
        .map_err(|e| e.to_string())?;
    let mut inspection = operator
        .inspect_community_deletion(&transport.http, &transport.origin, request_id)
        .await
        .map_err(|e| e.to_string())?;
    if inspection.pointer("/request/blocked_reason") != Some(&Value::Null) {
        return Err("native 请求已 blocked 或缺少 block 事实".into());
    }
    let native = inspection.get("request").ok_or("inspection 缺少原生请求")?;
    if native.get("community_host").and_then(Value::as_str) != Some(host)
        || native.get("community_id").and_then(Value::as_str) != Some(community)
        || native.get("id").and_then(Value::as_str) != Some(&request_id.to_string())
        || native.get("inventory_digest").and_then(Value::as_str) != Some(digest)
        || !matches!(
            native.get("stage").and_then(Value::as_str),
            Some(
                "inventoried"
                    | "approved"
                    | "fenced"
                    | "drained"
                    | "bindings_removed"
                    | "postgres_purged"
                    | "cache_purged"
                    | "logically_verified"
                    | "retention_pending"
            )
        )
    {
        return Err("inspection 目标、清单或阶段不合冻结合同".into());
    }
    let retained_cas = retained_cas_summary(
        inspection
            .pointer("/request/inventory_manifest/retained_cas")
            .ok_or("native 冻结清单缺少共享 CAS 保留证据")?,
    )?;
    if inspection.get("approval") == Some(&Value::Null) {
        operator
            .approve_community_deletion(
                &transport.http,
                &transport.origin,
                request_id,
                digest,
                deletion.action_execution_id,
            )
            .await
            .map_err(|e| e.to_string())?;
        inspection = operator
            .inspect_community_deletion(&transport.http, &transport.origin, request_id)
            .await
            .map_err(|e| e.to_string())?;
    }
    // 批准必须属于此次 Core 准入，不能先运行再以事后校验拒绝旧批准。
    if inspection
        .pointer("/approval/inventory_digest")
        .and_then(Value::as_str)
        != Some(digest)
        || inspection
            .pointer("/approval/approved_by")
            .and_then(Value::as_str)
            != Some(&deletion.action_execution_id.to_string())
    {
        return Err("原生批准不属于本次删除 ActionExecution".into());
    }
    if inspection.pointer("/request/stage").and_then(Value::as_str) != Some("retention_pending") {
        // run 错误不是失败终态，始终再 inspect 同一 native ID。
        let _ = operator
            .run_community_deletion(&transport.http, &transport.origin, request_id)
            .await;
        inspection = operator
            .inspect_community_deletion(&transport.http, &transport.origin, request_id)
            .await
            .map_err(|e| e.to_string())?;
    }
    if inspection.pointer("/request/stage").and_then(Value::as_str) != Some("retention_pending")
        || inspection.pointer("/request/blocked_reason") != Some(&Value::Null)
        || inspection.pointer("/request/id").and_then(Value::as_str)
            != Some(&request_id.to_string())
        || inspection
            .pointer("/request/inventory_digest")
            .and_then(Value::as_str)
            != Some(digest)
        || inspection
            .pointer("/approval/inventory_digest")
            .and_then(Value::as_str)
            != Some(digest)
        || inspection
            .pointer("/approval/approved_by")
            .and_then(Value::as_str)
            != Some(&deletion.action_execution_id.to_string())
    {
        return Err("原生逻辑删除终态或批准引用未成立".into());
    }
    if inspection.pointer("/request/inventory_manifest/retained_cas") != Some(&retained_cas) {
        return Err("native 保留证据不属于同一冻结清单".into());
    }
    let checkpoints = inspection
        .get("checkpoints")
        .and_then(Value::as_array)
        .ok_or("native 缺少完整检查点列表")?;
    let retention = checkpoints
        .iter()
        .filter(|checkpoint| {
            checkpoint.get("unit_key").and_then(Value::as_str)
                == Some("retention_physical_expiry_pending")
        })
        .collect::<Vec<_>>();
    if retention.len() != 1
        || retention[0].get("stage").and_then(Value::as_str) != Some("logically_verified")
        || retention[0].get("status").and_then(Value::as_str) != Some("completed")
        || retention[0]
            .pointer("/detail/inventory_digest")
            .and_then(Value::as_str)
            != Some(digest)
        || retention[0].pointer("/detail/retained_cas") != Some(&retained_cas)
    {
        return Err("native 物理保留检查点缺失或不合冻结摘要".into());
    }
    let communities = operator
        .list_owned_communities(&transport.http, control)
        .await
        .map_err(|e| e.to_string())?;
    if communities.iter().any(|row| row.host == host) {
        return Err("operator 仍列出被冻结 Community".into());
    }
    Ok(
        json!({"deleted":true,"request_id":request_id,"inventory_digest":digest,
        "native_stage":"retention_pending","control_owner_host_absent":true,
        "retained_items":["community_tombstone","deletion_evidence","detached_product_feedback",
            "detached_rate_limit_violations","shared_cas_media_thumbnails_git_packs"],
        "retained_cas":retained_cas,
        "shared_cas_physically_reclaimed":false}),
    )
}

/// Only native inventory metadata is copied; no CAS object keys or bodies.
fn retained_cas_summary(value: &Value) -> Result<Value, String> {
    let object_count = value
        .get("object_count")
        .and_then(Value::as_u64)
        .ok_or("共享 CAS 保留对象数未确定")?;
    let total_bytes = value
        .get("total_bytes")
        .and_then(Value::as_u64)
        .ok_or("共享 CAS 保留字节数未确定")?;
    let keys_digest = value
        .get("keys_digest")
        .and_then(Value::as_str)
        .filter(|s| {
            s.len() == 64
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
        .ok_or("共享 CAS 保留版本摘要未确定")?;
    let empty_digest = hex::encode(Sha256::digest([]));
    if (object_count == 0 && (total_bytes != 0 || keys_digest != empty_digest))
        || (object_count != 0 && keys_digest == empty_digest)
    {
        return Err("共享 CAS 空清单证据矛盾".into());
    }
    Ok(json!({"object_count":object_count,"total_bytes":total_bytes,"keys_digest":keys_digest}))
}

/// 同一冻结引用的逻辑退役：native tombstone 与 active key 缺席同时成立才收口。
async fn retire_openmeter(state: &ServiceState, deletion: &Delete) -> Result<(), &'static str> {
    let frozen = deletion
        .frozen_inventory
        .get("openmeter_binding")
        .ok_or("冻结清单缺少 OpenMeter 适用性")?;
    let namespace = frozen
        .get("namespace")
        .and_then(Value::as_str)
        .ok_or("冻结 namespace 缺失")?;
    let customer_id = frozen
        .get("customer_id")
        .and_then(Value::as_str)
        .ok_or("冻结 Customer ID 缺失")?;
    let prefix = frozen
        .get("subject_key_prefix")
        .and_then(Value::as_str)
        .ok_or("冻结 subject 前缀缺失")?;
    let version = frozen
        .get("version")
        .and_then(Value::as_i64)
        .and_then(|v| i32::try_from(v).ok())
        .ok_or("冻结 binding version 缺失")?;
    let retired_version = version.checked_add(1).ok_or("binding version 耗尽")?;
    if namespace != state.openmeter.namespace()
        || frozen.get("status").and_then(Value::as_str) != Some("ACTIVE")
        || frozen.get("tenant_id").and_then(Value::as_str) != Some(&deletion.tenant_id.to_string())
        || prefix != format!("{}:", deletion.tenant_id)
    {
        return Err("OpenMeter 冻结引用归属不符");
    }
    let current: Option<(String, String, String, String, i32)> = sqlx::query_as(
        "select namespace,customer_id,subject_key_prefix,status,version
         from projection.openmeter_binding where tenant_id = $1",
    )
    .bind(deletion.tenant_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| "OpenMeter binding 不可读取")?;
    let Some((current_ns, current_id, current_prefix, status, current_version)) = current else {
        return Err("OpenMeter binding 已丢失");
    };
    if current_ns != namespace
        || current_id != customer_id
        || current_prefix != prefix
        || !((status == "ACTIVE" && current_version == version)
            || (status == "REVOKED" && current_version == retired_version))
    {
        return Err("OpenMeter binding 已偏离冻结版本");
    }
    // native DELETE 是固定源码中的逻辑退役。HTTP 204 不是终态，client 回读墓碑与精确 key。
    let tombstone = state
        .openmeter
        .retire_customer(customer_id, deletion.tenant_id)
        .await
        .map_err(|_| "OpenMeter native 退役或回读未成立")?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| "OpenMeter 退役事务不可用")?;
    let written = sqlx::query(
        "update projection.openmeter_binding set status = 'REVOKED',
           version = case when status = 'ACTIVE' then version + 1 else version end
         where tenant_id = $1 and namespace = $2 and customer_id = $3 and subject_key_prefix = $4
           and ((status = 'ACTIVE' and version = $5) or (status = 'REVOKED' and version = $6))",
    )
    .bind(deletion.tenant_id)
    .bind(namespace)
    .bind(customer_id)
    .bind(prefix)
    .bind(version)
    .bind(retired_version)
    .execute(&mut *tx)
    .await
    .map_err(|_| "OpenMeter binding 退役未写入")?;
    if written.rows_affected() != 1 {
        return Err("OpenMeter binding 退役版本冲突");
    }
    let evidence = json!({"deleted":true,"namespace":namespace,"customer_id":customer_id,
        "deleted_at":tombstone.deleted_at,"active_key_absent":true,
        "retained_items":["customer_tombstone","historical_usage","billing_facts"]});
    let recorded = sqlx::query(
        "update admission.tenant_delete_subprocess set provider_evidence = provider_evidence || $2::jsonb
         where id = $1 and state <> 'DELETED'",
    ).bind(deletion.subprocess_id).bind(json!({"OPENMETER":evidence}))
        .execute(&mut *tx).await.map_err(|_| "OpenMeter 终态引用未写入")?;
    if recorded.rows_affected() != 1 {
        return Err("删除子流程已经终结或丢失");
    }
    deletion
        .audit(&mut tx, "OPENMETER", "RECONCILIATION", "DELETED", vec![])
        .await
        .map_err(|_| "OpenMeter 退役审计未写入")?;
    tx.commit().await.map_err(|_| "OpenMeter 退役提交结果不明")
}

async fn finish(state: &ServiceState, deletion: &Delete) -> Result<(), sqlx::Error> {
    let mut tx = state.pool.begin().await?;
    let current: Option<(String, i32)> =
        sqlx::query_as("select state,version from identity.tenant where id = $1 for update")
            .bind(deletion.tenant_id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some(durable) = load(&mut tx, deletion.tenant_id, deletion.snapshot_id).await? else {
        return Ok(());
    };
    if durable.subprocess_state == "DELETED" {
        return Ok(());
    }
    // Old or incomplete provider evidence must never become a new success.
    if durable
        .provider_evidence
        .pointer("/BUZZ/deleted")
        .and_then(Value::as_bool)
        == Some(true)
        && (retained_cas_summary(&durable.provider_evidence["BUZZ"]["retained_cas"]).is_err()
            || durable
                .provider_evidence
                .pointer("/BUZZ/shared_cas_physically_reclaimed")
                .and_then(Value::as_bool)
                != Some(false))
    {
        mark_unknown(&mut tx, &durable).await?;
        return tx.commit().await;
    }
    if !durable.irreversible_dispatch_started
        || current != Some(("DELETING".into(), deletion.tenant_version + 1))
        || durable.provider_evidence.pointer("/AGENT_DRAIN/drained") != Some(&Value::Bool(true))
        || [
            "AGENT_DRAIN",
            "AGENT_RUNTIME",
            "GATEWAY",
            "TEMPORAL_SCHEDULES",
        ]
        .iter()
        .any(|kind| {
            durable
                .provider_evidence
                .get(*kind)
                .and_then(|v| v.get("inventory_digest"))
                .and_then(Value::as_str)
                != Some(&durable.inventory_digest)
        })
        || durable
            .frozen_inventory
            .get("openmeter_binding")
            .and_then(Value::as_object)
            .is_none()
        || durable
            .provider_evidence
            .pointer("/OPENMETER/deleted")
            .and_then(Value::as_bool)
            != Some(true)
        || durable.provider_evidence.pointer("/OPENMETER/customer_id")
            != durable
                .frozen_inventory
                .pointer("/openmeter_binding/customer_id")
        || durable.provider_evidence.pointer("/OPENMETER/namespace")
            != durable
                .frozen_inventory
                .pointer("/openmeter_binding/namespace")
        || [
            "BUZZ",
            "SPICEDB",
            "OPENBAO",
            "AGENT_RUNTIME",
            "GATEWAY",
            "TEMPORAL_SCHEDULES",
        ]
        .iter()
        .any(|kind| {
            durable
                .provider_evidence
                .get(*kind)
                .and_then(|v| v.get("deleted"))
                .and_then(Value::as_bool)
                != Some(true)
        })
    {
        return Ok(());
    }
    let agents = durable
        .frozen_inventory
        .get("agent_inventory")
        .ok_or_else(|| sqlx::Error::Protocol("删除终态缺少冻结 Agent 库存".into()))?;
    let actual = frozen_agent_inventory(&mut tx, deletion.tenant_id)
        .await
        .map_err(|e| sqlx::Error::Protocol(format!("{e:?}")))?;
    if !same_agent_inventory(actual, agents.clone())?
        || sqlx::query_scalar::<_, bool>(
            "select exists(select 1 from catalog.agent_invocation
            where tenant_id=$1 and status not in ('COMPLETED','FAILED','CANCELED'))",
        )
        .bind(deletion.tenant_id)
        .fetch_one(&mut *tx)
        .await?
    {
        mark_unknown(&mut tx, &durable).await?;
        return tx.commit().await;
    }
    // 历史 operation、Workflow、审计和外部引用不删除；保留的 FK 目标是
    // DISABLED/REVOKED 墓碑，不再是可用身份、scope 或 binding。
    for sql in [
        "update admission.delegation_grant set state='REVOKED',version=version+1 where tenant_id=$1 and state in ('ACTIVE','REVOKING')",
        "update catalog.result_exposure_policy set status='RETIRED' where tenant_id=$1 and status='ACTIVE'",
        "update catalog.agent_installation set state='DISABLED',active_projection_generation=null where resource_id in (select id from catalog.resource where tenant_id=$1)",
        "update catalog.agent_runtime_projection set state='REVOKED' where installation_resource_id in (select id from catalog.resource where tenant_id=$1) and state<>'REVOKED'",
        "update catalog.channel_agent_binding set status='DISABLED' where installation_resource_id in (select id from catalog.resource where tenant_id=$1) and status<>'DISABLED'",
        "update catalog.agent_memory_binding set state='REVOKED',version=version+1 where installation_resource_id in (select id from catalog.resource where tenant_id=$1) and state<>'REVOKED'",
        "update catalog.agent_model_binding set secret_status='REVOKED' where installation_resource_id in (select id from catalog.resource where tenant_id=$1) and secret_status<>'REVOKED'",
        "update catalog.agent_session set status='CLOSED' where tenant_id=$1 and status<>'CLOSED'",
        "update catalog.automation_definition set state='DISABLED',pinned_version_asset_id=null,version=version+1 where resource_id in (select id from catalog.resource where tenant_id=$1)",
        "update catalog.automation_version set state='RETIRED' where automation_resource_id in (select id from catalog.resource where tenant_id=$1) and state<>'RETIRED'",
        "update catalog.agent_definition set status='DELETED',current_published_version_asset_id=null where resource_id in (select id from catalog.resource where tenant_id=$1)",
        "update catalog.agent_version set state='RETIRED' where asset_id in (select id from catalog.asset where tenant_id=$1) and state<>'RETIRED'",
        "update catalog.asset set state='DELETED',version=version+1,projection_action_execution_id=null where tenant_id=$1 and state<>'DELETED'",
        "update catalog.resource set state='DELETED',version=version+1,projection_action_execution_id=null where tenant_id=$1 and state<>'DELETED'",
        "delete from identity.collaboration_user_state where tenant_principal_id in (select id from identity.principal where tenant_id = $1)",
        "delete from admission.publish_attempt where tenant_principal_id in (select id from identity.principal where tenant_id = $1)",
        "update identity.platform_session set status = 'REVOKED' where tenant_membership_id in (select id from identity.tenant_membership where tenant_id = $1) and status = 'ACTIVE'",
        "update identity.tenant_membership set state = 'REVOKED',version = version + 1 where tenant_id = $1 and state <> 'REVOKED'",
        "update identity.workspace_membership set state = 'REVOKED',version = version + 1 where workspace_id in (select id from identity.workspace where tenant_id = $1) and state <> 'REVOKED'",
        "update identity.principal set status = 'DISABLED' where tenant_id = $1 and status <> 'DISABLED'",
        "update identity.buzz_identity_binding set state = 'REVOKED',private_key_secret_status = case when custody = 'SERVER' then 'REVOKED' else null end,version = version + 1 where tenant_id = $1 and (state <> 'REVOKED' or private_key_secret_status is distinct from case when custody = 'SERVER' then 'REVOKED' else null end)",
        "update projection.workspace_buzz_binding set state = 'DISABLED',version = version + 1 where workspace_id in (select id from identity.workspace where tenant_id = $1) and state <> 'DISABLED'",
        "update projection.tenant_buzz_binding set state = 'DISABLED',version = version + 1 where tenant_id = $1 and state <> 'DISABLED'",
        "update identity.tenant_invitation set state = 'REVOKED',revoked_at = now(),version = version + 1 where tenant_id = $1 and state = 'ISSUED'",
    ] { sqlx::query(sql).bind(deletion.tenant_id).execute(&mut *tx).await?; }
    sqlx::query("update identity.tenant set state = 'DELETED',version = version + 1 where id = $1")
        .bind(deletion.tenant_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("update admission.tenant_lifecycle_snapshot set state = 'DELETED' where id = $1")
        .bind(deletion.snapshot_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("update admission.tenant_delete_subprocess set state = 'DELETED',provider_evidence = provider_evidence || '{\"CORE\":{\"deleted\":true}}'::jsonb,version = version + 1 where id = $1")
        .bind(deletion.subprocess_id).execute(&mut *tx).await?;
    durable
        .audit(
            &mut tx,
            "completed",
            "RECONCILIATION",
            "DELETED",
            native_refs(&durable.provider_evidence["BUZZ"]),
        )
        .await?;
    tx.commit().await
}
