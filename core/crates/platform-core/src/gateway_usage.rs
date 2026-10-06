//! DD-21、03 §3/8、11 §4：只消费 Gateway 已提交的 usage outbox。
//! 只按写前冻结的 Invocation/operation/专属 Gateway identity 归因；缺任一事实
//! 原记录留在 Gateway、checkpoint 不前移，不从模型名或时间猜测 operation。

use std::collections::HashSet;
use std::time::Duration;

use chrono::{DateTime, Utc};
use contracts::EvidenceKind;
use opentelemetry::metrics::{Counter, Gauge, Meter};
use opentelemetry::KeyValue;
use reqwest::{StatusCode, Url};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::audit::{append, AuditEntry, Evidence};
use crate::oidc::TokenSource;
use crate::openmeter::{GatewayMeter, InvocationMeter, OpenMeter};

/// .design/11 §4 固定的全局持久流；不是 Tenant 或模型配置。
const SOURCE_KEY: &str = "agentgateway-durable-usage-tail";

/// Native outbox 的最小只读投影。正文、attributes、cost 与模型配置均不进入 Core。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Page {
    entries: Vec<Entry>,
    next_cursor: i64,
    #[serde(default)]
    submitted_requests: Option<i64>,
    #[serde(default)]
    pending_requests: Option<i64>,
    #[serde(default)]
    untracked_requests: Option<i64>,
    #[serde(default)]
    request_set_complete: Option<bool>,
    #[serde(default)]
    credential_revoked: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    seq: i64,
    id: Uuid,
    #[serde(default)]
    dispatch_attempt: Option<i64>,
    started_at: DateTime<Utc>,
    completed_at: DateTime<Utc>,
    trace_id: Option<String>,
    agentgateway_user: Option<String>,
    gen_ai: GenAi,
    usage: Usage,
}

/// Only a complete native pagination observation. It has no database state,
/// meter, balance or dispatch authority; callers cannot correlate its partial set.
#[derive(Default)]
struct RequestSet {
    after: i64,
    submitted: Option<i64>,
    ids: HashSet<Uuid>,
    entries: Vec<Entry>,
}

impl RequestSet {
    fn absorb(
        &mut self,
        page: Page,
        trace: &str,
        principal: Uuid,
        batch: i64,
    ) -> Result<bool, &'static str> {
        self.absorb_set(page, Some(trace), principal, batch)
    }

    fn absorb_set(
        &mut self,
        page: Page,
        trace: Option<&str>,
        principal: Uuid,
        batch: i64,
    ) -> Result<bool, &'static str> {
        page.validate(self.after, batch)?;
        if trace.is_none() && page.credential_revoked != Some(true) {
            return Err("Application Gateway credential 尚未原生撤销");
        }
        let count = page
            .submitted_requests
            .filter(|count| *count > 0 || (*count == 0 && trace.is_none()))
            .ok_or("Gateway native dispatch 集合缺失或为空；不能证明零用量")?;
        if page.request_set_complete != Some(true)
            || page.pending_requests != Some(0)
            || page.untracked_requests != Some(0)
            || self.submitted.is_some_and(|known| known != count)
        {
            return Err("Gateway native dispatch/completion 集合尚未完整或分页变化");
        }
        self.submitted = Some(count);
        // Native can cap a configured page limit. Only its empty page proves
        // exhaustion; a short page is not the request-set boundary.
        let exhausted = page.entries.is_empty();
        let user = principal.to_string();
        for entry in page.entries {
            if trace.is_some_and(|trace| entry.trace_id.as_deref() != Some(trace))
                || entry.agentgateway_user.as_deref() != Some(user.as_str())
                || entry.dispatch_attempt.is_none_or(|attempt| attempt < 0)
                || !self.ids.insert(entry.id)
            {
                return Err("Gateway request 缺同 trace/专属身份/持久 attempt 或重复 ID");
            }
            self.entries.push(entry);
        }
        let observed =
            i64::try_from(self.ids.len()).map_err(|_| "Gateway request 集合大小不可核验")?;
        if observed > count {
            return Err("Gateway request 数量超过原生已提交集合");
        }
        self.after = page.next_cursor;
        if exhausted && observed != count {
            return Err("Gateway native completion 页没有覆盖全部已提交请求");
        }
        Ok(exhausted)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenAi {
    provider_name: Option<String>,
    request_model: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Usage {
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    total_tokens: Option<i64>,
}

#[derive(FromRow, PartialEq)]
struct TurnFacts {
    invocation_id: Uuid,
    operation_id: Uuid,
    tenant_id: Uuid,
    workspace_id: Uuid,
    installation_resource_id: Uuid,
    projection_generation: i64,
    config_hash: String,
    gateway_principal_id: Uuid,
    customer_id: String,
    namespace: String,
    subject_key_prefix: String,
    binding_version: i32,
    action_key: String,
    meters: Vec<String>,
}

#[derive(FromRow)]
struct Correlation {
    invocation_id: Option<Uuid>,
    operation_id: Uuid,
    tenant_id: Uuid,
    workspace_id: Option<Uuid>,
    installation_resource_id: Option<Uuid>,
    agent_version_asset_id: Option<Uuid>,
    gateway_principal_id: Uuid,
    customer_id: String,
    namespace: String,
    subject_key: String,
    meter_projection: Value,
    component_binding_id: Option<Uuid>,
    component_release_id: Option<Uuid>,
    component_projection_generation: Option<i64>,
    binding_attribution: bool,
}

#[derive(FromRow)]
struct FrozenTrace {
    gateway_principal_id: Uuid,
    openmeter_customer_id: String,
    openmeter_namespace: String,
    subject_key: String,
    binding_version: i32,
    meter_projection: Value,
    invocation_meter_projection: Option<Value>,
}

#[derive(FromRow)]
struct InvocationUsage {
    tenant_id: Uuid,
    workspace_id: Uuid,
    operation_id: Uuid,
    installation_resource_id: Uuid,
    agent_version_asset_id: Uuid,
    automation_resource_id: Option<Uuid>,
    action_key: String,
    customer_id: String,
    subject_key: String,
    invocation_meter_projection: Option<Value>,
}

#[derive(FromRow)]
struct UncountedInvocation {
    invocation_id: Uuid,
    installation_resource_id: Uuid,
    projection_generation: i64,
    config_hash: String,
    runtime_thread_id: String,
    runtime_turn_id: String,
    native_status: Option<String>,
}

#[derive(FromRow)]
struct SettlementFacts {
    trace_id: String,
    operation_id: Uuid,
    tenant_id: Uuid,
    workspace_id: Uuid,
    gateway_principal_id: Uuid,
    customer_id: String,
    namespace: String,
    subject_key: String,
    meter_projection: Value,
    invocation_meter_projection: Option<Value>,
    action_key: String,
    meters: Vec<String>,
}

#[derive(FromRow)]
struct SettlementEvent {
    id: Uuid,
    source_type: String,
    source_id: Uuid,
    meter_key: String,
    native_turn_id: Option<String>,
}

fn memory_child_meters(
    child: Uuid,
    parameters: &Value,
    dispatch: &str,
    exact_context: bool,
) -> Result<Vec<(String, Uuid, String)>, &'static str> {
    if dispatch != "DISPATCHED" || !exact_context {
        return Err("Memory child 缺同 root/Invocation/turn 的确定读取证据");
    }
    let meters: Vec<crate::openmeter::MemoryMeter> =
        serde_json::from_value(parameters["memoryUsage"]["meters"].clone())
            .map_err(|_| "Memory child 缺冻结原生 meter")?;
    let mut seen = HashSet::new();
    for meter in &meters {
        if meter.id.is_empty()
            || meter.event_type.is_empty()
            || !seen.insert(meter.key.as_str())
            || !matches!(
                (meter.key.as_str(), meter.value_property.as_deref()),
                ("agent_memory_read_count", None)
                    | ("agent_memory_plaintext_bytes", Some("$.plaintext_bytes"))
            )
        {
            return Err("Memory child 原生 meter 集合无效");
        }
    }
    if seen.len() != 2 {
        return Err("Memory child 缺读次数或真实字节 meter");
    }
    Ok(meters
        .into_iter()
        .map(|meter| ("BUZZ_AGENT_MEMORY".to_owned(), child, meter.key))
        .collect())
}

const CORRELATION: &str = "select t.invocation_id,t.operation_id,t.tenant_id,t.workspace_id,
 i.installation_resource_id,i.agent_version_asset_id,t.gateway_principal_id,
 t.openmeter_customer_id customer_id,t.openmeter_namespace namespace,t.subject_key,
 t.meter_projection,NULL::uuid component_binding_id,NULL::uuid component_release_id,
 NULL::bigint component_projection_generation,false binding_attribution
 from projection.agent_model_trace t join catalog.agent_invocation i on i.id=t.invocation_id
 join admission.action_execution a on a.id=i.action_execution_id
 where t.trace_id=$1 and a.operation_id=t.operation_id and a.tenant_id=t.tenant_id
 and a.workspace_id=t.workspace_id and i.tenant_id=t.tenant_id and i.workspace_id=t.workspace_id";

/// 同一准入后的事实；不取 Agent 自报 subject/model/meter 或 Core 运行身份作模型身份。
const TURN_FACTS: &str = "select i.id invocation_id,a.operation_id,i.tenant_id,i.workspace_id,
 i.installation_resource_id,i.projection_generation,p.config_hash,
 b.gateway_principal_id,o.customer_id,o.namespace,o.subject_key_prefix,o.version binding_version,a.action_key,d.meters
 from catalog.agent_invocation i join admission.action_execution a on a.id=i.action_execution_id
 join catalog.action_definition d on d.action_key=a.action_key and d.version=a.action_version
 join catalog.agent_session s on s.workspace_id=i.workspace_id and s.root_event_id=i.root_event_id
   and s.installation_resource_id=i.installation_resource_id
 join catalog.agent_installation installation on installation.resource_id=i.installation_resource_id
 join catalog.resource r on r.id=installation.resource_id and r.tenant_id=i.tenant_id
 join identity.workspace w on w.id=i.workspace_id and w.tenant_id=i.tenant_id
 join catalog.agent_runtime_projection p on p.installation_resource_id=i.installation_resource_id
   and p.generation=i.projection_generation and p.agent_version_asset_id=i.agent_version_asset_id
 join catalog.agent_model_binding b on b.installation_resource_id=i.installation_resource_id
   and b.projection_generation=i.projection_generation
 join identity.principal principal on principal.id=b.gateway_principal_id and principal.tenant_id=i.tenant_id
 join projection.openmeter_binding o on o.tenant_id=i.tenant_id
 join admission.capacity_lease lease on lease.invocation_id=i.id and lease.operation_id=a.operation_id
 join admission.delegation_grant delegation on delegation.id=i.delegation_id
   and delegation.tenant_id=i.tenant_id and delegation.workspace_id=i.workspace_id
   and delegation.installation_resource_id=i.installation_resource_id
   and delegation.grantor_principal_id=a.initiator_principal_id and delegation.agent_principal_id=a.actor_principal_id
 where i.id=$1 and i.status='DISPATCHING' and i.runtime_turn_id is null
 and a.tenant_id=i.tenant_id and a.workspace_id=i.workspace_id and a.gate_state='ALLOWED'
 and d.quota_policy='CHECK' and cardinality(d.meters)>0
 and ((a.action_key='automation.run' and a.target_id=i.automation_resource_id
     and i.automation_resource_id is not null and i.automation_version_asset_id is not null)
   or (a.action_key='agent.invoke' and a.target_id=i.installation_resource_id
     and i.automation_resource_id is null and i.automation_version_asset_id is null))
 and s.status='ACTIVE' and s.runtime_thread_id=$2 and s.projection_generation=i.projection_generation
 and s.agent_version_asset_id=i.agent_version_asset_id
 and installation.state='ACTIVE' and installation.active_projection_generation=i.projection_generation
 and r.state='ACTIVE' and w.state='ACTIVE' and p.state='ACTIVE'
 and b.secret_status='ACTIVE' and b.native_key_id is not null and b.native_key_revision>0
 and principal.kind='SERVICE' and principal.status='ACTIVE' and o.status='ACTIVE'
 and lease.state='HELD' and lease.expires_at>clock_timestamp()
 and delegation.state='ACTIVE' and delegation.valid_from<=clock_timestamp() and delegation.expires_at>clock_timestamp()";

fn frozen_invocation_meter(
    action: &str,
    projection: Option<Value>,
) -> Result<Option<InvocationMeter>, &'static str> {
    let meter = projection
        .map(serde_json::from_value)
        .transpose()
        .map_err(|_| "Invocation 冻结 COUNT meter 不可读")?;
    InvocationMeter::for_action(action, meter)
        .map_err(|_| "Invocation COUNT meter 与冻结 Action 来源不一致")
}

fn frozen_turn_meters(
    action: &str,
    projection: Value,
    count_projection: Option<Value>,
    action_meters: &[String],
) -> Result<(Vec<GatewayMeter>, Option<InvocationMeter>), &'static str> {
    let meters: Vec<GatewayMeter> =
        serde_json::from_value(projection).map_err(|_| "计量查证冻结 SUM meter 不可读")?;
    let count = frozen_invocation_meter(action, count_projection)?;
    let mut keys: HashSet<String> = meters.iter().map(|meter| meter.key.clone()).collect();
    let requested: HashSet<String> = action_meters.iter().cloned().collect();
    if meters.is_empty()
        || keys.len() != meters.len()
        || keys.contains("automation.run")
        || count
            .as_ref()
            .is_some_and(|count| !keys.insert(count.key.clone()))
        || requested.len() != action_meters.len()
        || keys != requested
    {
        return Err("计量查证 SUM/COUNT 集合与原 CHECK 动作不一致");
    }
    Ok((meters, count))
}

async fn lock_tenant(
    tx: &mut Transaction<'_, Postgres>,
    invocation: Uuid,
) -> Result<(), &'static str> {
    let execution: Option<Uuid> = sqlx::query_scalar("select a.id from admission.action_execution a
        join catalog.agent_invocation i on i.action_execution_id=a.id where i.id=$1 for update of a")
        .bind(invocation).fetch_optional(&mut **tx).await.map_err(|_| "模型 Action fence 不可核验")?;
    execution.ok_or("模型 Action 不存在")?;
    let active: Option<Uuid> = sqlx::query_scalar("select t.id from identity.tenant t
        join catalog.agent_invocation i on i.tenant_id=t.id where i.id=$1 and t.state='ACTIVE' for update of t")
        .bind(invocation).fetch_optional(&mut **tx).await.map_err(|_| "模型 Tenant fence 不可核验")?;
    active.ok_or("模型 Tenant 不在 ACTIVE")?;
    Ok(())
}

/// SS-COD-TRACE：只在真实 invocation/slot/quota 事实齐备之后、原生模型副作用之前持久。
pub(crate) async fn prepare_turn(
    tx: &mut Transaction<'_, Postgres>,
    openmeter: &OpenMeter,
    projection: &crate::agent_runtime::RuntimeRef,
    invocation: Uuid,
    thread: &str,
) -> Result<String, &'static str> {
    // Invocation DISPATCHING and its mandatory trace share the caller's
    // transaction. A failed CHECK must not strand an unsent turn in UNKNOWN.
    lock_tenant(tx, invocation).await?;
    let facts: TurnFacts = sqlx::query_as(TURN_FACTS)
        .bind(invocation)
        .bind(thread)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| "模型准入事实不可读")?
        .ok_or("模型准入事实不成立")?;
    if facts.installation_resource_id != projection.installation_id
        || facts.projection_generation != projection.generation
        || facts.config_hash != projection.config_hash
        || facts.namespace != openmeter.namespace()
        || facts.subject_key_prefix != format!("{}:", facts.tenant_id)
    {
        return Err("模型 projection/OpenMeter scope 不一致");
    }
    let subject = format!(
        "{}{}",
        facts.subject_key_prefix, facts.installation_resource_id
    );
    let (meters, invocation_meter) = openmeter
        .turn_meters(
            facts.tenant_id,
            &facts.customer_id,
            &subject,
            &facts.action_key,
            &facts.meters,
        )
        .await
        .map_err(|_| "模型实际 meter/Customer subject 映射不可核验")?;
    if !openmeter
        .check_quota(facts.tenant_id, &facts.customer_id, &facts.meters)
        .await
        .map_err(|_| "模型 fresh Quota 不可核验")?
    {
        return Err("模型 fresh Quota 拒绝");
    }
    let trace = Uuid::new_v4().simple().to_string();
    let span = Uuid::new_v4().simple().to_string()[..16].to_owned();
    let inserted=sqlx::query("insert into projection.agent_model_trace
        (invocation_id,trace_id,span_id,operation_id,tenant_id,workspace_id,gateway_principal_id,
         openmeter_customer_id,openmeter_namespace,subject_key,binding_version,meter_projection,invocation_meter_projection)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict(invocation_id) do nothing")
        .bind(facts.invocation_id).bind(&trace).bind(&span).bind(facts.operation_id).bind(facts.tenant_id)
        .bind(facts.workspace_id).bind(facts.gateway_principal_id).bind(&facts.customer_id).bind(&facts.namespace)
        .bind(&subject).bind(facts.binding_version).bind(serde_json::to_value(meters).map_err(|_| "模型 meter 投影不可编码")?)
        .bind(invocation_meter.map(serde_json::to_value).transpose().map_err(|_| "Invocation meter 投影不可编码")?)
        .execute(&mut **tx).await.map_err(|_| "模型 trace 不可持久")?;
    if inserted.rows_affected() != 1 {
        return Err("模型已有 dispatch 意图；只能按原生引用观察");
    }
    usage_audit(
        tx,
        facts.operation_id,
        "model-dispatch-intent",
        "DISPATCH",
        "DISPATCH_INTENT",
        vec![Evidence::new(EvidenceKind::TraceId, &trace)],
    )
    .await?;
    Ok(format!("00-{trace}-{span}-01"))
}

/// 写前意图已提交后重新锁同一生命周期；保持直到 RPC 返回，不让暂停/销毁穿过副作用。
pub(crate) async fn dispatch_guard(
    pool: &PgPool,
    openmeter: &OpenMeter,
    projection: &crate::agent_runtime::RuntimeRef,
    invocation: Uuid,
    thread: &str,
) -> Result<Transaction<'static, Postgres>, &'static str> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|_| "模型 dispatch fence 不可用")?;
    recheck_dispatch(&mut tx, openmeter, projection, invocation, thread).await?;
    Ok(tx)
}

/// Process/原生只读等待之后仍复用同一事务和核证，不新建另一套派发准入。
pub(crate) async fn recheck_dispatch(
    tx: &mut Transaction<'_, Postgres>,
    openmeter: &OpenMeter,
    projection: &crate::agent_runtime::RuntimeRef,
    invocation: Uuid,
    thread: &str,
) -> Result<(), &'static str> {
    lock_tenant(tx, invocation).await?;
    let facts: TurnFacts = sqlx::query_as(TURN_FACTS)
        .bind(invocation)
        .bind(thread)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| "模型 dispatch 事实不可读")?
        .ok_or("模型 dispatch 已撤销")?;
    if facts.installation_resource_id != projection.installation_id
        || facts.projection_generation != projection.generation
        || facts.config_hash != projection.config_hash
    {
        return Err("模型 generation 已失效");
    }
    let frozen: Option<FrozenTrace> = sqlx::query_as(
        "select gateway_principal_id,openmeter_customer_id,openmeter_namespace,subject_key,binding_version,meter_projection,invocation_meter_projection
         from projection.agent_model_trace where invocation_id=$1 and operation_id=$2")
        .bind(invocation).bind(facts.operation_id).fetch_optional(&mut **tx).await
        .map_err(|_| "模型写前 trace 意图不可读")?;
    let Some(FrozenTrace {
        gateway_principal_id: principal,
        openmeter_customer_id: customer,
        openmeter_namespace: namespace,
        subject_key: subject,
        binding_version: version,
        meter_projection: meters,
        invocation_meter_projection: invocation_meter,
    }) = frozen
    else {
        return Err("模型写前 trace 缺失");
    };
    if principal != facts.gateway_principal_id
        || customer != facts.customer_id
        || namespace != facts.namespace
        || namespace != openmeter.namespace()
        || subject
            != format!(
                "{}{}",
                facts.subject_key_prefix, facts.installation_resource_id
            )
        || version != facts.binding_version
    {
        return Err("模型写前 binding/trace 已失效");
    }
    let (frozen, frozen_invocation) =
        frozen_turn_meters(&facts.action_key, meters, invocation_meter, &facts.meters)?;
    let (current, current_invocation) = openmeter
        .turn_meters(
            facts.tenant_id,
            &customer,
            &subject,
            &facts.action_key,
            &facts.meters,
        )
        .await
        .map_err(|_| "模型发派前 meter/Customer 映射不可核验")?;
    if current != frozen
        || current_invocation != frozen_invocation
        || !openmeter
            .check_quota(facts.tenant_id, &customer, &facts.meters)
            .await
            .map_err(|_| "模型发派前 Quota 不可核验")?
    {
        return Err("模型发派前 meter/Quota 已失效");
    }
    // 原生 meter/Quota RPC 也消耗时间。最后以真实时钟读取同一事实，不能借
    // transaction now() 延长 Grant 或 holder，亦不能只在等 Process 锁前查证。
    let final_facts: Option<TurnFacts> = sqlx::query_as(TURN_FACTS)
        .bind(invocation)
        .bind(thread)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| "模型 RPC 前生命周期事实不可读")?;
    if final_facts.as_ref() != Some(&facts) {
        return Err("模型 RPC 前 Grant/Capacity/scope 已失效");
    }
    Ok(())
}

/// 只消费 Task 已唯一查证的 native turn/startedAt，和冻结 meter 同一 outbox。
/// 恢复观察重入保持同一 ID/time/body；缺实际 turn 不创建“运行次数”。
pub(crate) async fn record_invocation_usage(
    pool: &PgPool,
    invocation: Uuid,
    turn: &str,
    started_at: DateTime<Utc>,
) -> Result<(), &'static str> {
    if turn.is_empty() || started_at.timestamp() < 0 || started_at > Utc::now() {
        return Err("Invocation native turn/time 不可核验");
    }
    let mut tx = pool
        .begin()
        .await
        .map_err(|_| "Invocation usage 事务不可用")?;
    let origin: Option<InvocationUsage> = sqlx::query_as(
        "select t.tenant_id,t.workspace_id,t.operation_id,i.installation_resource_id,i.agent_version_asset_id,
            i.automation_resource_id,a.action_key,t.openmeter_customer_id customer_id,t.subject_key,t.invocation_meter_projection
         from projection.agent_model_trace t join catalog.agent_invocation i on i.id=t.invocation_id
         join admission.action_execution a on a.id=i.action_execution_id
         where i.id=$1 and i.runtime_turn_id=$2 and i.status in ('DISPATCHING','RUNNING','UNKNOWN')
           and a.operation_id=t.operation_id and a.tenant_id=t.tenant_id and a.workspace_id=t.workspace_id
           and ((a.action_key='automation.run' and a.target_id=i.automation_resource_id
               and i.automation_resource_id is not null and i.automation_version_asset_id is not null)
             or (a.action_key='agent.invoke' and a.target_id=i.installation_resource_id
               and i.automation_resource_id is null and i.automation_version_asset_id is null))")
        .bind(invocation).bind(turn).fetch_optional(&mut *tx).await.map_err(|_| "Invocation usage 归属不可读")?;
    let Some(origin) = origin else {
        return Err("Invocation usage 没有同 operation 的已绑定 native turn");
    };
    let Some(meter) =
        frozen_invocation_meter(&origin.action_key, origin.invocation_meter_projection)?
    else {
        // The ordinary turn's model events are reconciled by the same durable
        // Gateway ingress. No COUNT producer applies to this native turn.
        return Ok(());
    };
    let id = Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!(
            "{}:AGENT_INVOCATION:{invocation}:{}",
            origin.tenant_id, meter.key
        )
        .as_bytes(),
    );
    let dimensions = json!({"tenant_id":origin.tenant_id,"workspace_id":origin.workspace_id,"operation_id":origin.operation_id,
        "agent_installation_resource_id":origin.installation_resource_id,"agent_version_asset_id":origin.agent_version_asset_id,
        "automation_resource_id":origin.automation_resource_id});
    let event = json!({"specversion":"1.0","id":id,"source":"urn:platform:core:usage",
        "type":meter.event_type,"subject":origin.subject_key,"time":started_at,"datacontenttype":"application/json","data":dimensions});
    sqlx::query("insert into outbox.usage_event
        (id,invocation_id,operation_id,tenant_id,workspace_id,openmeter_customer_id,agent_installation_resource_id,
         source_type,source_id,native_turn_id,meter_key,subject_key,quantity,occurred_at,dimensions,openmeter_event_id,event,settlement_status)
        values($1,$2,$3,$4,$5,$6,$7,'AGENT_INVOCATION',$2,$8,$9,$10,1,$11,$12,$1,$13,'PENDING_PUBLISH')
        on conflict(tenant_id,source_type,source_id,meter_key) do nothing")
        .bind(id).bind(invocation).bind(origin.operation_id).bind(origin.tenant_id).bind(origin.workspace_id)
        .bind(origin.customer_id).bind(origin.installation_resource_id)
        .bind(turn).bind(&meter.key).bind(origin.subject_key).bind(started_at).bind(dimensions).bind(&event)
        .execute(&mut *tx).await.map_err(|_| "Invocation UsageEvent 不可持久")?;
    let frozen: (Uuid, Value, String) = sqlx::query_as(
        "select id,event,native_turn_id from outbox.usage_event
        where tenant_id=$1 and source_type='AGENT_INVOCATION' and source_id=$2 and meter_key=$3",
    )
    .bind(origin.tenant_id)
    .bind(invocation)
    .bind(&meter.key)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| "Invocation usage 幂等事实不可读")?;
    if frozen != (id, event, turn.to_owned()) {
        return Err("Invocation usage 的 native 事实发生冲突");
    }
    usage_audit(
        &mut tx,
        origin.operation_id,
        &format!("usage:{id}:PENDING_PUBLISH"),
        "RECONCILIATION",
        "PENDING_PUBLISH",
        vec![Evidence::new(EvidenceKind::UsageEventId, id)],
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| "Invocation usage 提交结果不明")
}

/// DD-92 attribution resolves the native authenticated user against an original
/// frozen binding projection, including revoked projections with late usage.
/// Missing/unknown trace is an attribution gap, never an exemption from billing.
async fn application_correlation(
    tx: &mut Transaction<'_, Postgres>,
    entry: &Entry,
) -> Result<Option<Correlation>, &'static str> {
    let Some(user) = entry
        .agentgateway_user
        .as_deref()
        .and_then(|v| Uuid::parse_str(v).ok())
    else {
        return Ok(None);
    };
    let rows: Vec<Correlation> = sqlx::query_as("select NULL::uuid invocation_id,
        a.operation_id,b.tenant_id,b.workspace_id,NULL::uuid installation_resource_id,
        NULL::uuid agent_version_asset_id,b.service_principal_id gateway_principal_id,
        p.model_projection->>'customerId' customer_id,p.model_projection->>'namespace' namespace,
        p.model_projection->>'subject' subject_key,p.model_projection->'meters' meter_projection,
        b.id component_binding_id,b.component_release_id,p.generation component_projection_generation,
        true binding_attribution
        from projection.application_runtime p join catalog.application_binding b on b.id=p.binding_id
        join admission.action_execution a on a.id=p.action_execution_id and a.target_id=b.id
          and a.action_key='application_binding.create' and a.tenant_id=b.tenant_id
          and a.workspace_id is not distinct from b.workspace_id
        join identity.service_principal s on s.principal_id=b.service_principal_id
          and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
        where b.service_principal_id=$1 and p.model_projection is not null and p.model_dispatch_started
          and p.model_projection->>'gatewayPrincipalId'=s.principal_id::text
          and p.model_projection->>'operationId'=a.operation_id::text
          and p.component_release_id=b.component_release_id")
        .bind(user).fetch_all(&mut **tx).await.map_err(|_|"Application model attribution unavailable")?;
    let mut rows = rows.into_iter();
    let Some(mut origin) = rows.next() else {
        return Ok(None);
    };
    if rows.next().is_some() {
        return Err("Application native identity has ambiguous generations");
    }
    if let Some(trace) = entry.trace_id.as_deref().filter(|s| !s.is_empty()) {
        let parents:Vec<(Uuid,Option<Uuid>)>=sqlx::query_as("select distinct a.operation_id,a.workspace_id
            from admission.action_execution a join admission.external_execution e on e.action_execution_id=a.id
            join identity.principal actor on actor.id=a.actor_principal_id and actor.tenant_id=a.tenant_id
            left join catalog.agent_invocation i on i.id::text=a.parameters->>'invocationId'
              and i.runtime_turn_id=a.parameters->>'runtimeTurnId'
            left join projection.agent_model_trace t on t.invocation_id=i.id and t.operation_id=a.operation_id
            where a.component_binding_id=$1 and a.component_projection_generation=$2
              and a.tenant_id=$3 and ($4::uuid is null or a.workspace_id=$4)
              and (t.trace_id=$5 or (actor.kind='HUMAN' and a.actor_principal_id=a.initiator_principal_id
                and a.parameters->>'componentActionKind'='COMPONENT_ACTION'
                and replace(a.operation_id::text,'-','')=$5)) and a.dispatch_state='DISPATCHED'
              and e.component_binding_id=a.component_binding_id
              and e.component_projection_generation=a.component_projection_generation
              and e.operation_id=a.operation_id")
            .bind(origin.component_binding_id).bind(origin.component_projection_generation)
            .bind(origin.tenant_id).bind(origin.workspace_id).bind(trace)
            .fetch_all(&mut **tx).await.map_err(|_|"Application model parent evidence unavailable")?;
        if let [(operation, workspace)] = parents.as_slice() {
            origin.operation_id = *operation;
            origin.workspace_id = *workspace;
            origin.binding_attribution = false;
        } else {
            return Err("Application supplied trace lacks one exact original operation");
        }
    }
    Ok(Some(origin))
}

/// 来源、scope、meter 和数量在 checkpoint 前一起持久。所有重读只接受同一事件。
async fn correlate(
    tx: &mut Transaction<'_, Postgres>,
    entry: &Entry,
    namespace: &str,
) -> Result<(), &'static str> {
    let trace = entry.trace_id.as_deref().filter(|trace| !trace.is_empty());
    let origin = if let Some(origin) = application_correlation(tx, entry).await? {
        origin
    } else {
        sqlx::query_as::<_, Correlation>(CORRELATION)
            .bind(trace.ok_or("Gateway durable usage 缺 Core trace")?)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|_| "Gateway trace 归因不可读")?
            .ok_or("Gateway trace 没有同 Invocation/operation 写前意图")?
    };
    let gateway_user = origin.gateway_principal_id.to_string();
    if origin.namespace != namespace
        || entry.agentgateway_user.as_deref() != Some(gateway_user.as_str())
    {
        return Err("Gateway usage 专属模型身份/namespace 与写前意图不一致");
    }
    let provider = entry
        .gen_ai
        .provider_name
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or("Gateway usage 缺原生 provider")?;
    let model = entry
        .gen_ai
        .request_model
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or("Gateway usage 缺原生 model")?;
    if [
        entry.usage.input_tokens,
        entry.usage.output_tokens,
        entry.usage.total_tokens,
    ]
    .into_iter()
    .flatten()
    .any(|quantity| quantity < 0)
    {
        return Err("Gateway durable usage 数量不可核验");
    }
    let meters: Vec<GatewayMeter> = serde_json::from_value(origin.meter_projection)
        .map_err(|_| "Gateway usage 冻结 meter 不可读")?;
    if meters.is_empty() {
        return Err("Gateway usage 冻结 meter 为空");
    }
    let dimensions = if let Some(binding) = origin.component_binding_id {
        json!({"tenant_id":origin.tenant_id,"workspace_id":origin.workspace_id,
            "operation_id":origin.operation_id,"component_binding_id":binding,
            "component_release_id":origin.component_release_id,
            "component_projection_generation":origin.component_projection_generation,
            "attribution":if origin.binding_attribution {"BINDING"} else {"OPERATION"},
            "provider":provider,"model":model})
    } else {
        json!({"tenant_id":origin.tenant_id,"workspace_id":origin.workspace_id,
            "operation_id":origin.operation_id,"agent_installation_resource_id":origin.installation_resource_id,
            "agent_version_asset_id":origin.agent_version_asset_id,"provider":provider,"model":model})
    };
    let mut data = dimensions.clone();
    for (key, quantity) in [
        ("inputTokens", entry.usage.input_tokens),
        ("outputTokens", entry.usage.output_tokens),
        ("totalTokens", entry.usage.total_tokens),
    ] {
        if let Some(quantity) = quantity {
            data[key] = quantity.into();
        }
    }
    let mut seen = HashSet::new();
    for meter in meters {
        if !seen.insert(meter.key.clone()) {
            return Err("Gateway usage 冻结 meter 重复");
        }
        let quantity = match meter.value_property.as_str() {
            "$.inputTokens" => entry.usage.input_tokens,
            "$.outputTokens" => entry.usage.output_tokens,
            "$.totalTokens" => entry.usage.total_tokens,
            _ => return Err("Gateway usage 未知原生计量字段"),
        }
        .ok_or("Gateway durable usage 没有该 meter 的实际数量")?;
        let id = Uuid::new_v5(
            &Uuid::NAMESPACE_URL,
            format!(
                "{}:GATEWAY_DURABLE_USAGE:{}:{}",
                origin.tenant_id, entry.id, meter.key
            )
            .as_bytes(),
        );
        let event = json!({"specversion":"1.0","id":id,"source":"urn:platform:core:usage",
            "type":meter.event_type,"subject":origin.subject_key,"time":entry.completed_at,
            "datacontenttype":"application/json","data":data});
        sqlx::query("insert into outbox.usage_event
            (id,invocation_id,operation_id,tenant_id,workspace_id,openmeter_customer_id,
             agent_installation_resource_id,source_type,source_id,native_seq,meter_key,subject_key,quantity,
             occurred_at,dimensions,openmeter_event_id,event,settlement_status,
             component_binding_id,component_release_id,component_projection_generation,openmeter_namespace)
             values($1,$2,$3,$4,$5,$6,$7,'GATEWAY_DURABLE_USAGE',$8,$15,$9,$10,$11,$12,$13,$1,$14,'PENDING_PUBLISH',
                $16,$17,$18,$19)
             on conflict(tenant_id,source_type,source_id,meter_key) do nothing")
            .bind(id).bind(origin.invocation_id).bind(origin.operation_id).bind(origin.tenant_id)
            .bind(origin.workspace_id).bind(&origin.customer_id).bind(origin.installation_resource_id)
            .bind(entry.id).bind(&meter.key).bind(&origin.subject_key).bind(quantity).bind(entry.completed_at)
            .bind(&dimensions).bind(&event).bind(entry.seq)
            .bind(origin.component_binding_id).bind(origin.component_release_id)
            .bind(origin.component_projection_generation).bind(&origin.namespace)
            .execute(&mut **tx).await.map_err(|_| "Gateway UsageEvent 不可持久")?;
        let frozen: (Uuid,Value,i64) = sqlx::query_as("select id,event,native_seq from outbox.usage_event
            where tenant_id=$1 and source_type='GATEWAY_DURABLE_USAGE' and source_id=$2 and meter_key=$3")
            .bind(origin.tenant_id).bind(entry.id).bind(&meter.key).fetch_one(&mut **tx).await
            .map_err(|_| "Gateway UsageEvent 幂等事实不可读")?;
        if frozen != (id, event, entry.seq) {
            return Err("Gateway stable ID 的冻结 usage 内容不一致");
        }
        let mut evidence = vec![
            Evidence::new(EvidenceKind::UsageEventId, id),
            Evidence::new(EvidenceKind::AgentgatewayUsageId, entry.id),
        ];
        if let Some(trace) = trace {
            evidence.push(Evidence::new(EvidenceKind::TraceId, trace));
        }
        usage_audit(
            tx,
            origin.operation_id,
            &format!("usage:{id}:PENDING_PUBLISH"),
            "RECONCILIATION",
            "PENDING_PUBLISH",
            evidence,
        )
        .await?;
    }
    Ok(())
}

/// 同一权威 AuditEvent，与引用和状态写同事务；不建立计量审计的第二份表。
async fn usage_audit(
    tx: &mut Transaction<'_, Postgres>,
    operation: Uuid,
    stage: &str,
    event_type: &str,
    result_code: &str,
    evidence_refs: Vec<Evidence>,
) -> Result<(), &'static str> {
    #[derive(FromRow)]
    struct Facts {
        tenant_id: Uuid,
        workspace_id: Option<Uuid>,
        human_identity_id: Option<Uuid>,
        initiator_principal_id: Uuid,
        actor_principal_id: Uuid,
        action_key: String,
        action_version: i32,
        component_type_key: String,
        target_type: String,
        target_id: Uuid,
        parameter_hash: String,
        result_exposure: String,
        correlation_id: Uuid,
    }
    let facts: Facts = sqlx::query_as("select a.tenant_id,a.workspace_id,m.human_identity_id,
        a.initiator_principal_id,a.actor_principal_id,a.action_key,a.action_version,d.component_type_key,
        d.target_type,a.target_id,a.parameter_hash,d.result_exposure,a.correlation_id
        from admission.action_execution a join catalog.action_definition d
          on d.action_key=a.action_key and d.version=a.action_version
        left join identity.tenant_membership m on m.tenant_id=a.tenant_id and m.tenant_principal_id=a.initiator_principal_id
        where a.operation_id=$1 and a.parent_action_execution_id is null")
        .bind(operation).fetch_one(&mut **tx).await.map_err(|_| "Usage 审计 scope 不可读")?;
    append(
        tx,
        AuditEntry {
            event_key: format!("{operation}:{stage}"),
            tenant_id: Some(facts.tenant_id),
            workspace_id: facts.workspace_id,
            operation_id: operation,
            event_type,
            human_identity_id: facts.human_identity_id,
            initiator_principal_id: Some(facts.initiator_principal_id),
            actor_principal_id: Some(facts.actor_principal_id),
            action_key: &facts.action_key,
            action_version: facts.action_version,
            component_type_key: &facts.component_type_key,
            target_type: Some(&facts.target_type),
            target_id: Some(facts.target_id),
            parameter_hash: &facts.parameter_hash,
            decision: "NONE",
            result_code,
            result_exposure: &facts.result_exposure,
            evidence_refs,
            correlation_id: facts.correlation_id,
        },
    )
    .await
    .map_err(|_| "Usage 审计不可持久")
}

/// BFF 已 fresh 审计授权并核同 operation 后才调用。seq 只是 native 查证位置，
/// 必须回读真实 stable ID/trace/user；本地 UsageEvent 不是 Gateway 存在性的证明。
pub(crate) async fn native_usage_exists(
    seq: i64,
    id: Uuid,
    trace: &str,
    principal: Uuid,
) -> Result<bool, &'static str> {
    if seq <= 0 {
        return Err("Gateway usage 原生 seq 无效");
    }
    let ingress = Ingress::from_env(&opentelemetry::global::meter("platform-core"))
        .map_err(|_| "Gateway usage 原生查证配置不可用")?;
    let page = ingress.read(seq - 1, 1).await?;
    let user = principal.to_string();
    Ok(page.entries.first().is_some_and(|entry| {
        entry.seq == seq
            && entry.id == id
            && entry.trace_id.as_deref() == Some(trace)
            && entry.agentgateway_user.as_deref() == Some(user.as_str())
    }))
}

impl Page {
    fn validate(&self, after: i64, batch: i64) -> Result<(), &'static str> {
        if i64::try_from(self.entries.len()).map_err(|_| "Gateway usage 页大小不可核验")? > batch
        {
            return Err("Gateway usage 页超过请求批次");
        }
        let mut previous = after;
        let mut ids = HashSet::new();
        for entry in &self.entries {
            if entry.seq <= previous
                || entry.id.is_nil()
                || !ids.insert(entry.id)
                || entry.completed_at < entry.started_at
            {
                return Err("Gateway usage 顺序、稳定 ID 或完成时间不可核验");
            }
            previous = entry.seq;
        }
        if self.next_cursor != previous {
            return Err("Gateway usage nextCursor 与持久页不一致");
        }
        Ok(())
    }
}

/// 原 Activity 已闭合也仍可按同一 native 引用核验运行次数。这里不 resume、
/// interrupt 或派发 turn，不从本机时间、模型日志数量或空页推断一次运行。
async fn invocation_started_at(
    runtime: &crate::agent_runtime::Supervisor,
    invocation: &UncountedInvocation,
) -> Result<DateTime<Utc>, &'static str> {
    if Uuid::parse_str(&invocation.runtime_thread_id).is_err()
        || Uuid::parse_str(&invocation.runtime_turn_id).is_err()
    {
        return Err("Invocation usage native 引用不可核验");
    }
    let projection = crate::agent_runtime::RuntimeRef {
        installation_id: invocation.installation_resource_id,
        generation: invocation.projection_generation,
        config_hash: invocation.config_hash.clone(),
    };
    let client_id = invocation.invocation_id.to_string();
    let mut cursor = None;
    let mut cursors = HashSet::new();
    let mut matched = None;
    loop {
        let page = runtime
            .turns(
                &projection,
                &invocation.runtime_thread_id,
                cursor.as_deref(),
            )
            .await
            .map_err(|_| "Invocation usage native history 不可读")?;
        let turns = page
            .get("data")
            .and_then(Value::as_array)
            .ok_or("Invocation usage native history 格式不明")?;
        for turn in turns {
            if turn.get("itemsView").and_then(Value::as_str) != Some("full") {
                return Err("Invocation usage native history 不完整");
            }
            let id = turn
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .ok_or("Invocation usage native turn 缺 ID")?;
            let items = turn
                .get("items")
                .and_then(Value::as_array)
                .ok_or("Invocation usage native turn 缺 items")?;
            let correlations = items
                .iter()
                .filter(|item| {
                    item.get("type").and_then(Value::as_str) == Some("userMessage")
                        && item.get("clientId").and_then(Value::as_str) == Some(client_id.as_str())
                })
                .count();
            if id != invocation.runtime_turn_id && correlations == 0 {
                continue;
            }
            if id != invocation.runtime_turn_id || correlations != 1 || matched.is_some() {
                return Err("Invocation usage native turn/clientId 不唯一");
            }
            let status = turn
                .get("status")
                .and_then(Value::as_str)
                .ok_or("Invocation usage native status 不明")?;
            if !matches!(
                status,
                "inProgress" | "completed" | "failed" | "interrupted"
            ) || invocation.native_status.as_deref().is_some_and(|known| {
                matches!(known, "completed" | "failed" | "interrupted") && known != status
            }) {
                return Err("Invocation usage native status 冲突");
            }
            matched = Some(
                turn.get("startedAt")
                    .and_then(Value::as_i64)
                    .filter(|seconds| *seconds > 0)
                    .and_then(|seconds| DateTime::<Utc>::from_timestamp(seconds, 0))
                    .filter(|started| *started <= Utc::now())
                    .ok_or("Invocation usage 缺实际 native startedAt")?,
            );
        }
        match page.get("nextCursor") {
            Some(Value::Null) => return matched.ok_or("Invocation usage 未查到原 native turn"),
            Some(Value::String(next)) if !next.is_empty() && cursors.insert(next.clone()) => {
                cursor = Some(next.clone());
            }
            _ => return Err("Invocation usage native history 游标不明或循环"),
        }
    }
}

pub(crate) struct Ingress {
    http: reqwest::Client,
    endpoint: Url,
    timeout: Duration,
    tokens: TokenSource,
    passes: Counter<u64>,
    unavailable: Gauge<u64>,
    pending_observed: Gauge<u64>,
    oldest_observed_age: Gauge<u64>,
    checkpoint_cursor: Gauge<u64>,
}

impl Ingress {
    pub(crate) fn from_env(meter: &Meter) -> Result<Self, String> {
        let raw =
            std::env::var("AGENTGATEWAY_ADMIN_URL").map_err(|_| "缺少 AGENTGATEWAY_ADMIN_URL")?;
        let mut endpoint = Url::parse(&raw).map_err(|_| "AGENTGATEWAY_ADMIN_URL 无效")?;
        if !matches!(endpoint.scheme(), "http" | "https")
            || endpoint.host_str().is_none()
            || !endpoint.username().is_empty()
            || endpoint.password().is_some()
            || endpoint.query().is_some()
            || endpoint.fragment().is_some()
        {
            return Err("AGENTGATEWAY_ADMIN_URL 必须是无凭据和查询的 HTTP(S) 管理入口".into());
        }
        // API 路径来自 SS-AGW-USAGE；origin/端口只来自同一管理配置投递。
        endpoint
            .path_segments_mut()
            .map_err(|_| "AGENTGATEWAY_ADMIN_URL 不能构造原生路径")?
            .pop_if_empty()
            .extend(["api", "usage", "outbox"]);
        let seconds = std::env::var("AGENTGATEWAY_ADMIN_TIMEOUT_SECONDS")
            .map_err(|_| "缺少 AGENTGATEWAY_ADMIN_TIMEOUT_SECONDS")?
            .parse::<u64>()
            .ok()
            .filter(|value| *value > 0)
            .ok_or("AGENTGATEWAY_ADMIN_TIMEOUT_SECONDS 必须是正整数")?;
        let timeout = Duration::from_secs(seconds);
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(timeout)
            .build()
            .map_err(|_| "Gateway usage HTTP client 构造失败")?;
        Ok(Self {
            http,
            endpoint,
            timeout,
            tokens: TokenSource::from_env()?,
            passes: meter
                .u64_counter("platform.gateway_usage_ingress.passes")
                .with_description("Gateway 持久 usage 读取的实际结果；不是用量或结算次数")
                .build(),
            unavailable: meter
                .u64_gauge("platform.gateway_usage_ingress.unavailable")
                .with_description("持久流当前不可核验或缺归因，1 表示必须对账")
                .build(),
            pending_observed: meter
                .u64_gauge("platform.gateway_usage_ingress.pending_observed")
                .with_description("最后成功读取的未归因页条数；不是全流 backlog 或零用量")
                .build(),
            oldest_observed_age: meter
                .u64_gauge("platform.gateway_usage_ingress.oldest_observed_age")
                .with_unit("s")
                .with_description("最后成功读取的页中最旧未归因 usage 距 native 完成的年龄")
                .build(),
            checkpoint_cursor: meter
                .u64_gauge("platform.gateway_usage_ingress.checkpoint_cursor")
                .with_description("Core 已持久的 native seq 游标；不是已结算用量")
                .build(),
        })
    }

    async fn read(&self, after: i64, batch: i64) -> Result<Page, &'static str> {
        self.read_page(after, batch, None).await
    }

    async fn read_page(
        &self,
        after: i64,
        batch: i64,
        trace: Option<&str>,
    ) -> Result<Page, &'static str> {
        self.read_identity_page(after, batch, trace, None).await
    }

    async fn read_identity_page(
        &self,
        after: i64,
        batch: i64,
        trace: Option<&str>,
        principal: Option<Uuid>,
    ) -> Result<Page, &'static str> {
        let token = self
            .tokens
            .token()
            .await
            .map_err(|_| "Gateway usage 身份不可用")?;
        let mut request = self
            .http
            .get(self.endpoint.clone())
            .bearer_auth(token)
            .query(&[("after", after), ("limit", batch)]);
        if let Some(trace) = trace {
            request = request.query(&[("traceId", trace)]);
        }
        if let Some(principal) = principal {
            request = request.query(&[("gatewayUser", principal.to_string())]);
        }
        let response = request
            .send()
            .await
            .map_err(|_| "Gateway usage 请求结果不明")?;
        if matches!(
            response.status(),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
        ) {
            self.tokens.invalidate().await;
            return Err("Gateway usage 拒绝 Core service 身份");
        }
        if response.status() != StatusCode::OK {
            return Err("Gateway usage 持久流不可用");
        }
        let page: Page = response
            .json()
            .await
            .map_err(|_| "Gateway usage 响应不可核验")?;
        page.validate(after, batch)?;
        Ok(page)
    }

    /// A native nonempty dispatch set, not a tail cursor or locally observed
    /// UsageEvent count. The final Codex turn/Capacity fence is supplied by Task.
    async fn completed_requests(
        &self,
        trace: &str,
        principal: Uuid,
        batch: i64,
    ) -> Result<Vec<Entry>, &'static str> {
        if batch <= 0 {
            return Err("Gateway usage 治理对账批次无效");
        }
        let mut requests = RequestSet::default();
        loop {
            let page = self
                .read_identity_page(requests.after, batch, Some(trace), Some(principal))
                .await?;
            if requests.absorb(page, trace, principal, batch)? {
                return Ok(requests.entries);
            }
        }
    }

    async fn application_requests(
        &self,
        principal: Uuid,
        batch: i64,
    ) -> Result<Vec<Entry>, &'static str> {
        if batch <= 0 {
            return Err("Gateway usage 治理对账批次无效");
        }
        let mut requests = RequestSet::default();
        loop {
            let page = self
                .read_identity_page(requests.after, batch, None, Some(principal))
                .await?;
            if requests.absorb_set(page, None, principal, batch)? {
                return Ok(requests.entries);
            }
        }
    }

    async fn attributed_application_requests(
        &self,
        trace: &str,
        principal: Uuid,
        batch: i64,
    ) -> Result<Vec<Entry>, &'static str> {
        let mut requests = RequestSet::default();
        loop {
            let page = self
                .read_identity_page(requests.after, batch, Some(trace), Some(principal))
                .await?;
            // Called only after the original child EE's native terminal proof.
            // No matching trace means no operation-attributed set, NOT zero
            // binding usage: untraced calls retain independent binding billing.
            if requests.submitted.is_none()
                && page.entries.is_empty()
                && page.submitted_requests == Some(0)
                && page.pending_requests == Some(0)
                && page.untracked_requests == Some(0)
            {
                return Ok(Vec::new());
            }
            if requests.absorb(page, trace, principal, batch)? {
                return Ok(requests.entries);
            }
        }
    }

    /// 由同一治理对账循环调用。多 Core 副本以 checkpoint 行锁互斥；原生请求和
    /// IdP 取 token 合计受现有 admin deadline 约束，不让一个副本永久占住游标。
    pub(crate) async fn reconcile(
        &self,
        pool: &PgPool,
        batch: i64,
        openmeter: &OpenMeter,
        runtime: Option<&crate::agent_runtime::Supervisor>,
    ) -> Result<(), &'static str> {
        let counted = self.reconcile_invocation_usage(pool, batch, runtime).await;
        let inspected = self.inspect(pool, batch, openmeter.namespace()).await;
        // 新页缺归因时也继续对账已持久的 outbox，不能让后一条坏来源拖住已有投递。
        let settled = self.settle(pool, batch, openmeter).await;
        let result = counted.and_then(|counted| {
            inspected.and_then(|empty| settled.map(|settled| counted && empty && settled))
        });
        let outcome = match &result {
            Ok(true) => "EMPTY",
            Ok(false) => "BUSY",
            Err(_) => "UNKNOWN",
        };
        self.passes.add(1, &[KeyValue::new("outcome", outcome)]);
        if result.is_err() {
            self.unavailable.record(1, &[]);
        }
        result.map(|_| ())
    }

    async fn reconcile_invocation_usage(
        &self,
        pool: &PgPool,
        batch: i64,
        runtime: Option<&crate::agent_runtime::Supervisor>,
    ) -> Result<bool, &'static str> {
        if batch <= 0 {
            return Err("Invocation usage 治理对账批次无效");
        }
        let pending: Vec<UncountedInvocation> = sqlx::query_as(
            "select i.id invocation_id,i.installation_resource_id,i.projection_generation,
                p.config_hash,s.runtime_thread_id,i.runtime_turn_id,i.native_status
             from catalog.agent_invocation i
             join projection.agent_model_trace t on t.invocation_id=i.id
               and t.tenant_id=i.tenant_id and t.workspace_id=i.workspace_id
             join admission.action_execution a on a.id=i.action_execution_id
               and a.operation_id=t.operation_id and a.tenant_id=t.tenant_id and a.workspace_id=t.workspace_id
             join catalog.agent_session s on s.tenant_id=i.tenant_id and s.workspace_id=i.workspace_id
               and s.root_event_id=i.root_event_id and s.installation_resource_id=i.installation_resource_id
               and s.agent_version_asset_id=i.agent_version_asset_id and s.projection_generation=i.projection_generation
             join catalog.agent_runtime_projection p on p.installation_resource_id=i.installation_resource_id
               and p.generation=i.projection_generation and p.agent_version_asset_id=i.agent_version_asset_id
             where i.status in ('DISPATCHING','RUNNING','UNKNOWN') and a.action_key='automation.run'
               and a.target_id=i.automation_resource_id
               and i.automation_resource_id is not null and i.automation_version_asset_id is not null
               and i.runtime_turn_id is not null and s.runtime_thread_id is not null
               and not exists(select 1 from outbox.usage_event u where u.invocation_id=i.id
                 and u.source_type='AGENT_INVOCATION' and u.source_id=i.id and u.meter_key='automation.run')
             order by i.updated_at,i.id limit $1")
            .bind(batch).fetch_all(pool).await.map_err(|_| "Invocation usage 待对账引用不可读")?;
        if pending.is_empty() {
            return Ok(true);
        }
        let runtime = runtime.ok_or("Invocation usage 缺原 native 只读运行体，保持待对账")?;
        let mut unavailable = false;
        for invocation in pending {
            // 使用现有 ingress deadline 限制整条分页查证，不持数据库锁等原生页。
            let observed =
                tokio::time::timeout(self.timeout, invocation_started_at(runtime, &invocation))
                    .await;
            let recorded = match observed {
                Ok(Ok(started)) => {
                    record_invocation_usage(
                        pool,
                        invocation.invocation_id,
                        &invocation.runtime_turn_id,
                        started,
                    )
                    .await
                }
                Ok(Err(reason)) => Err(reason),
                Err(_) => Err("Invocation usage native 查证超时"),
            };
            if let Err(reason) = recorded {
                unavailable = true;
                tracing::warn!(invocation_id=%invocation.invocation_id,state="UNKNOWN",
                    reason_code="BILLING_UNAVAILABLE",%reason,"Invocation 原计数引用保留，未推测一次运行");
            }
        }
        if unavailable {
            return Err("BILLING_UNAVAILABLE：Invocation 原生计数尚待对账");
        }
        Ok(false)
    }

    async fn inspect(
        &self,
        pool: &PgPool,
        batch: i64,
        namespace: &str,
    ) -> Result<bool, &'static str> {
        if batch <= 0 {
            return Err("Gateway usage 治理对账批次无效");
        }
        // native after 省略即 seq=0；首次建立的是恢复位置，不是零用量事实。
        sqlx::query(
            "insert into projection.ingress_checkpoint(source_key,tenant_id,cursor)
            values($1,null,'0') on conflict(source_key) do nothing",
        )
        .bind(SOURCE_KEY)
        .execute(pool)
        .await
        .map_err(|_| "Gateway usage checkpoint 不可持久")?;
        let mut tx = pool
            .begin()
            .await
            .map_err(|_| "Gateway usage checkpoint 事务不可用")?;
        let checkpoint: Option<(Option<Uuid>, String)> = sqlx::query_as(
            "select tenant_id,cursor from projection.ingress_checkpoint
             where source_key=$1 for update skip locked",
        )
        .bind(SOURCE_KEY)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| "Gateway usage checkpoint 不可读")?;
        let Some((tenant, cursor)) = checkpoint else {
            tx.rollback()
                .await
                .map_err(|_| "Gateway usage checkpoint 解锁不可核验")?;
            return Ok(false);
        };
        let after = cursor
            .parse::<i64>()
            .ok()
            .filter(|seq| *seq >= 0)
            .ok_or("Gateway usage checkpoint 游标不可核验")?;
        if tenant.is_some() || after.to_string() != cursor {
            return Err("Gateway usage checkpoint 与全局持久流不一致");
        }
        self.checkpoint_cursor.record(after as u64, &[]);
        let page = tokio::time::timeout(self.timeout, self.read(after, batch))
            .await
            .map_err(|_| "Gateway usage 读取超时，原游标保留")??;
        self.pending_observed.record(page.entries.len() as u64, &[]);
        for entry in &page.entries {
            if let Err(reason) = correlate(&mut tx, entry, namespace).await {
                self.oldest_observed_age.record(
                    Utc::now()
                        .signed_duration_since(entry.completed_at)
                        .num_seconds()
                        .max(0) as u64,
                    &[],
                );
                tracing::warn!(source_id=%entry.id,cursor=after,state="UNKNOWN",
                    reason_code="BILLING_UNAVAILABLE",%reason,"Gateway usage 原游标保留；没有推测归因");
                return Err(reason);
            }
        }
        sqlx::query("update projection.ingress_checkpoint set cursor=$2 where source_key=$1")
            .bind(SOURCE_KEY)
            .bind(page.next_cursor.to_string())
            .execute(&mut *tx)
            .await
            .map_err(|_| "Gateway usage checkpoint 不可持久")?;
        // 与全部 UsageEvent 同事务推进。202/结算未完成不丢记录，由持久 outbox 收敛。
        tx.commit()
            .await
            .map_err(|_| "Gateway usage/checkpoint 提交结果不明")?;
        self.checkpoint_cursor.record(page.next_cursor as u64, &[]);
        self.oldest_observed_age.record(0, &[]);
        if page.entries.is_empty() {
            tracing::debug!("Gateway usage outbox 无适用对象；不形成计费用量结论");
        }
        Ok(page.entries.is_empty())
    }

    async fn settle(
        &self,
        pool: &PgPool,
        batch: i64,
        openmeter: &OpenMeter,
    ) -> Result<bool, &'static str> {
        if batch <= 0 {
            return Err("Gateway usage 治理对账批次无效");
        }
        let ids: Vec<Uuid> = sqlx::query_scalar("select id from outbox.usage_event
            where settlement_status in ('PENDING_PUBLISH','ACCEPTED','UNKNOWN') order by updated_at,id limit $1")
            .bind(batch).fetch_all(pool).await.map_err(|_| "UsageEvent 待投递集合不可读")?;
        settle_events(pool, &ids, openmeter).await?;
        self.unavailable.record(0, &[]);
        // 仅表示当前 outbox 无待投递对象；不是 turn 请求全集或账单终态。
        Ok(ids.is_empty())
    }
}

/// CHECK completion consumes the actual native dispatch set and the separately
/// acknowledged COUNT when the frozen action is Automation. This is committed metering, not invoice finalization
/// or STRICT reservation release. An empty native set is never zero usage proof.
/// Read-only feature evidence from the same native durable endpoint. A legacy
/// Gateway which does not implement the credential/dispatch fence cannot activate
/// an APPLICATION model binding.
pub(crate) async fn verify_application_reader(principal: Uuid) -> Result<(), &'static str> {
    let ingress = Ingress::from_env(&opentelemetry::global::meter("platform-core"))
        .map_err(|_| "Application native usage reader unavailable")?;
    let batch = std::env::var("GOVERNANCE_RECONCILE_BATCH")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|v| *v > 0)
        .ok_or("Application model reconciliation batch unavailable")?;
    let page = tokio::time::timeout(
        ingress.timeout,
        ingress.read_identity_page(0, batch, None, Some(principal)),
    )
    .await
    .map_err(|_| "Application native usage reader timed out")??;
    if page.credential_revoked.is_none()
        || page.submitted_requests.is_none()
        || page.pending_requests.is_none()
        || page.untracked_requests.is_none()
    {
        return Err("Gateway application dispatch fence unavailable");
    }
    Ok(())
}

pub(crate) async fn committed_application(
    pool: &PgPool,
    openmeter: &OpenMeter,
    binding: Uuid,
    generation: i64,
) -> Result<Option<Value>, &'static str> {
    let (principal, namespace, projection):(Uuid,String,Value)=sqlx::query_as(
        "select b.service_principal_id,p.model_projection->>'namespace',p.model_projection
         from catalog.application_binding b join projection.application_runtime p on p.binding_id=b.id
         where b.id=$1 and p.generation=$2 and b.state='DISABLING' and p.model_dispatch_started")
        .bind(binding).bind(generation).fetch_one(pool).await.map_err(|_|"Application model drain scope unavailable")?;
    if namespace != openmeter.namespace() {
        return Err("Application model namespace mismatch");
    }
    let batch = std::env::var("GOVERNANCE_RECONCILE_BATCH")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|v| *v > 0)
        .ok_or("Application model reconciliation batch unavailable")?;
    let ingress = Ingress::from_env(&opentelemetry::global::meter("platform-core"))
        .map_err(|_| "Application native usage reader unavailable")?;
    let entries = tokio::time::timeout(
        ingress.timeout,
        ingress.application_requests(principal, batch),
    )
    .await
    .map_err(|_| "Application native usage observation timed out")??;
    let meters: Vec<GatewayMeter> = serde_json::from_value(projection["meters"].clone())
        .map_err(|_| "Application frozen meters unavailable")?;
    if meters.is_empty() {
        return Err("Application frozen meter set is empty");
    }
    let mut tx = pool
        .begin()
        .await
        .map_err(|_| "Application usage transaction unavailable")?;
    let mut expected = HashSet::new();
    for entry in &entries {
        correlate(&mut tx, entry, &namespace).await?;
        for meter in &meters {
            expected.insert((entry.id, meter.key.clone()));
        }
    }
    let rows:Vec<(Uuid,String,bool)>=sqlx::query_as(
        "select source_id,meter_key,settlement_status='COMMITTED' and stored_at is not null
         from outbox.usage_event where component_binding_id=$1 and component_projection_generation=$2
           and source_type='GATEWAY_DURABLE_USAGE'")
        .bind(binding).bind(generation).fetch_all(&mut *tx).await.map_err(|_|"Application stored usage unavailable")?;
    let observed: HashSet<_> = rows.iter().map(|(id, key, _)| (*id, key.clone())).collect();
    tx.commit()
        .await
        .map_err(|_| "Application usage commit outcome unknown")?;
    if observed != expected || rows.iter().any(|(_, _, committed)| !*committed) {
        return Ok(None);
    }
    let mut ids: Vec<_> = entries.iter().map(|e| e.id).collect();
    ids.sort_unstable();
    Ok(Some(
        json!({"gatewayPrincipalId":principal,"generation":generation,
        "credentialRevoked":true,"submittedRequests":ids.len(),
        "requestSetDigest":collab_bridge::limits::canonical_digest(&json!(ids))}),
    ))
}

/// The HUMAN component Workflow waits on its own original operation's native
/// dispatch set and the same outbox stored-at receipts as Agent invocations.
pub(crate) async fn committed_application_action(
    pool: &PgPool,
    openmeter: &OpenMeter,
    action: Uuid,
) -> Result<bool, &'static str> {
    let facts: Option<(Uuid, Uuid, i64, Uuid, String, Value)> = sqlx::query_as(
        "select a.operation_id,b.id,p.generation,b.service_principal_id,
           p.model_projection->>'namespace',p.model_projection->'meters'
         from admission.action_execution a
         join identity.principal actor on actor.id=a.actor_principal_id and actor.tenant_id=a.tenant_id
         join admission.external_execution e on e.action_execution_id=a.id and e.operation_id=a.operation_id
         join catalog.application_binding b on b.id=a.component_binding_id
         join projection.application_runtime p on p.binding_id=b.id and p.generation=a.component_projection_generation
         where a.id=$1 and actor.kind='HUMAN' and a.actor_principal_id=a.initiator_principal_id
           and a.parameters->>'componentActionKind'='COMPONENT_ACTION' and a.dispatch_state='DISPATCHED'
           and e.component_binding_id=b.id and e.component_projection_generation=p.generation
           and e.terminal_at is not null and e.platform_status in ('SUCCEEDED','FAILED','CANCELLED')
           and b.model_call_mode='PLATFORM_LLM_ROUTE' and p.model_dispatch_started")
        .bind(action).fetch_optional(pool).await.map_err(|_| "HUMAN model operation unavailable")?;
    let Some((operation, binding, generation, principal, namespace, meters)) = facts else {
        let mode: Option<String> = sqlx::query_scalar(
            "select b.model_call_mode from admission.action_execution a
            join catalog.application_binding b on b.id=a.component_binding_id where a.id=$1",
        )
        .bind(action)
        .fetch_optional(pool)
        .await
        .map_err(|_| "HUMAN model scope unavailable")?;
        return Ok(mode.as_deref() == Some("NONE"));
    };
    if namespace != openmeter.namespace() {
        return Err("HUMAN model namespace mismatch");
    }
    let batch = std::env::var("GOVERNANCE_RECONCILE_BATCH")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|v| *v > 0)
        .ok_or("HUMAN model reconciliation batch unavailable")?;
    let ingress = Ingress::from_env(&opentelemetry::global::meter("platform-core"))
        .map_err(|_| "HUMAN model native reader unavailable")?;
    let entries = tokio::time::timeout(
        ingress.timeout,
        ingress.attributed_application_requests(&operation.simple().to_string(), principal, batch),
    )
    .await
    .map_err(|_| "HUMAN model usage observation timed out")??;
    let meters: Vec<GatewayMeter> =
        serde_json::from_value(meters).map_err(|_| "HUMAN model frozen meters unavailable")?;
    if meters.is_empty() {
        return Err("HUMAN model frozen meter set empty");
    }
    let mut tx = pool
        .begin()
        .await
        .map_err(|_| "HUMAN model usage transaction unavailable")?;
    let mut expected = HashSet::new();
    for entry in &entries {
        correlate(&mut tx, entry, &namespace).await?;
        for meter in &meters {
            expected.insert((entry.id, meter.key.clone()));
        }
    }
    let rows: Vec<(Uuid, String, bool)> = sqlx::query_as(
        "select source_id,meter_key,
        settlement_status='COMMITTED' and stored_at is not null from outbox.usage_event
        where operation_id=$1 and component_binding_id=$2 and component_projection_generation=$3
          and source_type='GATEWAY_DURABLE_USAGE' and dimensions->>'attribution'='OPERATION'",
    )
    .bind(operation)
    .bind(binding)
    .bind(generation)
    .fetch_all(&mut *tx)
    .await
    .map_err(|_| "HUMAN model stored usage unavailable")?;
    tx.commit()
        .await
        .map_err(|_| "HUMAN model usage commit unknown")?;
    Ok(rows.iter().all(|(_, _, committed)| *committed)
        && rows
            .iter()
            .map(|(id, key, _)| (*id, key.clone()))
            .collect::<HashSet<_>>()
            == expected)
}

async fn application_model_children(
    pool: &PgPool,
    ingress: &Ingress,
    invocation: Uuid,
    turn: &str,
    facts: &SettlementFacts,
    batch: i64,
) -> Result<Vec<Uuid>, &'static str> {
    let bindings:Vec<(Uuid,i64,Uuid,Value)>=sqlx::query_as(
        "select distinct b.id,p.generation,b.service_principal_id,p.model_projection->'meters'
         from admission.action_execution child
         join admission.external_execution e on e.action_execution_id=child.id
         join catalog.agent_invocation i on i.id::text=child.parameters->>'invocationId'
           and i.runtime_turn_id=child.parameters->>'runtimeTurnId'
         join catalog.application_binding b on b.id=child.component_binding_id
         join projection.application_runtime p on p.binding_id=b.id and p.generation=child.component_projection_generation
         where i.id=$1 and i.runtime_turn_id=$2 and child.operation_id=$3
           and child.dispatch_state='DISPATCHED' and p.model_dispatch_started
           and b.model_call_mode='PLATFORM_LLM_ROUTE'
           and e.component_binding_id=b.id and e.component_projection_generation=p.generation
           and e.terminal_at is not null and e.platform_status in ('SUCCEEDED','FAILED','CANCELLED')")
        .bind(invocation).bind(turn).bind(facts.operation_id).fetch_all(pool).await
        .map_err(|_|"Application model child projections unavailable")?;
    let mut ids = Vec::new();
    for (binding, generation, principal, meters) in bindings {
        let entries = tokio::time::timeout(
            ingress.timeout,
            ingress.attributed_application_requests(&facts.trace_id, principal, batch),
        )
        .await
        .map_err(|_| "Application model child usage observation timed out")??;
        let meters: Vec<GatewayMeter> =
            serde_json::from_value(meters).map_err(|_| "Application model meters unavailable")?;
        if meters.is_empty() {
            return Err("Application model meter set is empty");
        }
        let mut tx = pool
            .begin()
            .await
            .map_err(|_| "Application model child transaction unavailable")?;
        for entry in &entries {
            correlate(&mut tx, entry, &facts.namespace).await?;
            let rows: Vec<(Uuid, String)> = sqlx::query_as(
                "select id,meter_key from outbox.usage_event
                 where source_type='GATEWAY_DURABLE_USAGE' and source_id=$1
                   and component_binding_id=$2 and component_projection_generation=$3
                   and operation_id=$4 and dimensions->>'attribution'='OPERATION'",
            )
            .bind(entry.id)
            .bind(binding)
            .bind(generation)
            .bind(facts.operation_id)
            .fetch_all(&mut *tx)
            .await
            .map_err(|_| "Application model child event set unavailable")?;
            let found: HashSet<_> = rows.iter().map(|(_, key)| key.as_str()).collect();
            let expected: HashSet<_> = meters.iter().map(|m| m.key.as_str()).collect();
            if found != expected || rows.len() != meters.len() {
                return Err("Application model child event set mismatch");
            }
            ids.extend(rows.into_iter().map(|(id, _)| id));
        }
        tx.commit()
            .await
            .map_err(|_| "Application model child usage commit unknown")?;
    }
    Ok(ids)
}

pub(crate) async fn committed_turn(
    pool: &PgPool,
    openmeter: &OpenMeter,
    invocation: Uuid,
    turn: &str,
    native_status: &str,
) -> Result<Option<(Vec<Uuid>, Vec<Evidence>)>, &'static str> {
    if !matches!(native_status, "completed" | "failed" | "interrupted") {
        return Err("计量查证缺确定 native turn 终态");
    }
    let facts: SettlementFacts = sqlx::query_as(
        "select t.trace_id,t.operation_id,t.tenant_id,t.workspace_id,t.gateway_principal_id,
           t.openmeter_customer_id customer_id,t.openmeter_namespace namespace,t.subject_key,
           t.meter_projection,t.invocation_meter_projection,a.action_key,d.meters
         from projection.agent_model_trace t join catalog.agent_invocation i on i.id=t.invocation_id
         join admission.action_execution a on a.id=i.action_execution_id
         join catalog.action_definition d on d.action_key=a.action_key and d.version=a.action_version
         join admission.capacity_lease l on l.invocation_id=i.id and l.operation_id=a.operation_id
         where i.id=$1 and i.runtime_turn_id=$2 and i.native_status=$3 and i.status in ('RUNNING','UNKNOWN')
           and ((a.action_key='automation.run' and a.target_id=i.automation_resource_id
               and i.automation_resource_id is not null and i.automation_version_asset_id is not null)
             or (a.action_key='agent.invoke' and a.target_id=i.installation_resource_id
               and i.automation_resource_id is null and i.automation_version_asset_id is null))
           and a.operation_id=t.operation_id
           and a.tenant_id=t.tenant_id and a.workspace_id=t.workspace_id
           and i.tenant_id=t.tenant_id and i.workspace_id=t.workspace_id
           and a.gate_state='ALLOWED' and d.quota_policy='CHECK'
           and l.tenant_id=i.tenant_id and l.workspace_id=i.workspace_id and l.workflow_id=i.workflow_id
           and l.state='RELEASED' and l.native_release_confirmed_at is not null
           and l.terminal_event_id is not null and l.terminal_event_at is not null")
        .bind(invocation).bind(turn).bind(native_status).fetch_optional(pool).await
        .map_err(|_| "计量查证的原 Invocation/operation/Capacity 不可读")?
        .ok_or("计量查证缺同 scope 的已释放 native/Temporal holder")?;
    if facts.namespace != openmeter.namespace() {
        return Err("计量查证 namespace 与冻结 trace 不一致");
    }
    let (meters, count) = frozen_turn_meters(
        &facts.action_key,
        facts.meter_projection.clone(),
        facts.invocation_meter_projection.clone(),
        &facts.meters,
    )?;
    let batch = std::env::var("GOVERNANCE_RECONCILE_BATCH")
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value > 0)
        .ok_or("计量查证缺现有治理对账批次投递")?;
    let ingress = Ingress::from_env(&opentelemetry::global::meter("platform-core"))
        .map_err(|_| "计量查证缺现有 Gateway 原生读取投递")?;
    let entries = tokio::time::timeout(
        ingress.timeout,
        ingress.completed_requests(&facts.trace_id, facts.gateway_principal_id, batch),
    )
    .await
    .map_err(|_| "Gateway 请求全集查证超时；保留原用量待对账")??;
    let mut expected = HashSet::new();
    if let Some(count) = count {
        expected.insert(("AGENT_INVOCATION".to_owned(), invocation, count.key));
    }
    let mut evidence = vec![Evidence::new(EvidenceKind::TraceId, &facts.trace_id)];
    let mut tx = pool.begin().await.map_err(|_| "计量全集关联事务不可用")?;
    for entry in &entries {
        // Reuses exactly the global ingress attribution, native quantities and
        // stable event identities; it does not create another source or ledger.
        correlate(&mut tx, entry, &facts.namespace).await?;
        for meter in &meters {
            expected.insert((
                "GATEWAY_DURABLE_USAGE".to_owned(),
                entry.id,
                meter.key.clone(),
            ));
        }
        evidence.push(Evidence::new(EvidenceKind::AgentgatewayUsageId, entry.id));
    }
    // The same root Operation also owns its governed Memory read children.
    // Do not filter them out of the Invocation set or mistake their usage for
    // model SUM/Automation COUNT. An uncertain child still blocks completion.
    let children: Vec<(Uuid, Value, String, bool)> = sqlx::query_as(
        "select c.id,c.parameters,c.dispatch_state,coalesce(
           c.gate_state='ALLOWED' and c.operation_id=parent.operation_id
           and c.tenant_id=parent.tenant_id and c.workspace_id=parent.workspace_id
           and c.initiator_principal_id=parent.initiator_principal_id
           and c.actor_principal_id=parent.actor_principal_id
           and c.target_id=i.installation_resource_id
           and c.parameters->>'invocationId'=i.id::text
           and c.parameters->>'runtimeTurnId'=i.runtime_turn_id
           and c.parameters->'memoryUsage'->>'namespace'=$2
           and c.parameters->'memoryUsage'->>'customer_id'=$3
           and c.parameters->'memoryUsage'->>'subject'=$4,false)
         from catalog.agent_invocation i
         join admission.action_execution parent on parent.id=i.action_execution_id
           and parent.parent_action_execution_id is null
         join admission.action_execution c on c.parent_action_execution_id=parent.id
         where i.id=$1 and c.action_key in ('agent.memory.entry.list','agent.memory.entry.read')",
    )
    .bind(invocation)
    .bind(&facts.namespace)
    .bind(&facts.customer_id)
    .bind(&facts.subject_key)
    .fetch_all(&mut *tx)
    .await
    .map_err(|_| "Memory child 用量集合不可读")?;
    for (child, parameters, dispatch, exact) in children {
        expected.extend(memory_child_meters(child, &parameters, &dispatch, exact)?);
    }
    let events: Vec<SettlementEvent> = sqlx::query_as(
        "select id,source_type,source_id,meter_key,native_turn_id from outbox.usage_event
         where invocation_id=$1 and operation_id=$2 and tenant_id=$3 and workspace_id=$4
           and openmeter_customer_id=$5 and openmeter_namespace=$6 and subject_key=$7 order by id",
    )
    .bind(invocation)
    .bind(facts.operation_id)
    .bind(facts.tenant_id)
    .bind(facts.workspace_id)
    .bind(&facts.customer_id)
    .bind(&facts.namespace)
    .bind(&facts.subject_key)
    .fetch_all(&mut *tx)
    .await
    .map_err(|_| "计量全集的持久 UsageEvent 不可读")?;
    if events.len() != expected.len() {
        return Err("计量全集缺 SUM/COUNT 事件或包含额外来源");
    }
    let mut ids = Vec::with_capacity(events.len());
    let mut memory_ids = Vec::new();
    for event in events {
        if !expected.remove(&(event.source_type.clone(), event.source_id, event.meter_key))
            || (event.source_type == "AGENT_INVOCATION"
                && event.native_turn_id.as_deref() != Some(turn))
        {
            return Err("计量全集的 source/meter/native turn 不一致");
        }
        if event.source_type == "BUZZ_AGENT_MEMORY" {
            // The migration binds frozen quantity/head/outcome to this exact
            // child's ACCESS audit. Recheck that authority, not just the type.
            let verified: bool = sqlx::query_scalar(
                "select exists(select 1 from outbox.usage_event u
                 join admission.action_execution c on c.id=u.source_id
                 join audit.audit_event a on a.event_key='memory-child:'||c.id::text||':read'
                   and a.event_type='ACCESS' and a.decision='ALLOW'
                   and a.operation_id=c.operation_id and a.tenant_id=c.tenant_id
                   and a.workspace_id=c.workspace_id and a.target_id=c.target_id
                   and a.actor_principal_id=c.actor_principal_id
                   and a.initiator_principal_id=c.initiator_principal_id
                   and a.action_key=c.action_key and a.action_version=c.action_version
                   and a.parameter_hash=c.parameter_hash
                 where u.id=$1 and u.invocation_id=$2
                   and u.dimensions->>'read_outcome'=a.result_code
                   and a.result_code in ('FOUND','ABSENT','COMPLETE')
                   and u.dimensions->>'slug_digest'=c.parameters->>'slugDigest'
                   and not exists(select 1 from jsonb_array_elements_text(u.dimensions->'native_event_ids') n(id)
                     where n.id !~ '^[0-9a-f]{64}$' or not exists(
                       select 1 from jsonb_array_elements(a.evidence_refs) e(value)
                       where e.value->>'kind'='BuzzEventId' and e.value->>'value'=n.id)))",
            ).bind(event.id).bind(invocation).fetch_one(&mut *tx).await
                .map_err(|_| "Memory child 原生内容证据不可读")?;
            if !verified {
                return Err("Memory child 原生内容与冻结读取不一致");
            }
            memory_ids.push(event.id);
        }
        ids.push(event.id);
        evidence.push(Evidence::new(EvidenceKind::UsageEventId, event.id));
        evidence.push(Evidence::new(EvidenceKind::OpenmeterEventId, event.id));
    }
    tx.commit().await.map_err(|_| "计量全集关联提交结果不明")?;
    for id in crate::application_execution::committed_children(pool, invocation, turn).await? {
        ids.push(id);
        evidence.push(Evidence::new(EvidenceKind::UsageEventId, id));
        evidence.push(Evidence::new(EvidenceKind::OpenmeterEventId, id));
    }
    for id in application_model_children(pool, &ingress, invocation, turn, &facts, batch).await? {
        ids.push(id);
        evidence.push(Evidence::new(EvidenceKind::UsageEventId, id));
        evidence.push(Evidence::new(EvidenceKind::OpenmeterEventId, id));
    }
    if !settle_events(pool, &ids, openmeter).await? {
        return Ok(None);
    }
    for id in memory_ids {
        let (event, stored_at): (Value, DateTime<Utc>) = sqlx::query_as(
            "select event,stored_at from outbox.usage_event where id=$1
             and settlement_status='COMMITTED' and stored_at is not null",
        )
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|_| "Memory child stored_at 不可读")?;
        let native = openmeter
            .stored_usage(&event)
            .await
            .map_err(|_| "Memory child 原生 stored_at 尚未可查证")?;
        if !native
            .is_some_and(|native| native.stored_at == stored_at && !native.configuration_warning)
        {
            return Ok(None);
        }
    }
    Ok(Some((ids, evidence)))
}

/// The same outbox publisher serves the exact UsageEvents of a governed read.
/// Only native stored_at can close each event; an accepted enqueue, absent ID,
/// or a row held by another reconciler is not a completed read charge.
pub(crate) async fn settle_events(
    pool: &PgPool,
    ids: &[Uuid],
    openmeter: &OpenMeter,
) -> Result<bool, &'static str> {
    let mut unavailable = false;
    let mut committed = true;
    for id in ids {
        let mut tx = pool
            .begin()
            .await
            .map_err(|_| "UsageEvent 对账事务不可用")?;
        let row: Option<(Value,String,Uuid,Uuid,String)> = sqlx::query_as("select u.event,u.openmeter_namespace,
                u.operation_id,u.source_id,u.source_type
                from outbox.usage_event u
                where u.id=$1 and u.settlement_status in ('PENDING_PUBLISH','ACCEPTED','UNKNOWN') for update of u skip locked")
                .bind(id).fetch_optional(&mut *tx).await.map_err(|_| "UsageEvent 对账事实不可读")?;
        let Some((event, namespace, operation, source_id, source_type)) = row else {
            let already_committed: bool = sqlx::query_scalar(
                "select exists(select 1 from outbox.usage_event
                    where id=$1 and settlement_status='COMMITTED' and stored_at is not null)",
            )
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| "UsageEvent 已提交事实不可读")?;
            committed &= already_committed;
            continue;
        };
        if !matches!(
            source_type.as_str(),
            "GATEWAY_DURABLE_USAGE"
                | "AGENT_INVOCATION"
                | "BUZZ_AGENT_MEMORY"
                | "APPLICATION_ADAPTER_USAGE"
        ) {
            return Err("UsageEvent source 不可核验");
        }
        let evidence = if namespace == openmeter.namespace() {
            openmeter.stored_usage(&event).await
        } else {
            Err(crate::openmeter::Error::Conflict)
        };
        let (next, stored_at) = match evidence {
            Ok(Some(evidence)) => {
                if evidence.configuration_warning {
                    tracing::warn!(usage_event_id=%id,reason_code="BILLING_UNAVAILABLE",
                            "OpenMeter event 已 stored_at；读时配置告警不重判持久事实或声称账单已结算");
                }
                ("COMMITTED", Some(evidence.stored_at))
            }
            // The native 202 only enqueues into Kafka's producer; a later
            // delivery failure has no HTTP acknowledgement. DD-08 retries
            // this frozen CloudEvent through the two native deduplicators,
            // never the model call or a new event identity. Only stored_at
            // ends delivery reconciliation, including after ACCEPTED.
            Ok(None) => match openmeter.publish_usage(&event).await {
                Ok(()) => ("ACCEPTED", None),
                Err(_) => {
                    unavailable = true;
                    ("UNKNOWN", None)
                }
            },
            Err(_) => {
                unavailable = true;
                ("UNKNOWN", None)
            }
        };
        committed &= delivery_committed(next, stored_at);
        sqlx::query("update outbox.usage_event set settlement_status=$2,stored_at=$3,updated_at=now() where id=$1")
                .bind(id).bind(next).bind(stored_at).execute(&mut *tx).await
                .map_err(|_| "UsageEvent 对账结果不可持久")?;
        let mut evidence = vec![
            Evidence::new(EvidenceKind::UsageEventId, id),
            Evidence::new(EvidenceKind::OpenmeterEventId, id),
        ];
        if source_type == "GATEWAY_DURABLE_USAGE" {
            evidence.push(Evidence::new(EvidenceKind::AgentgatewayUsageId, source_id));
        } else if source_type == "BUZZ_AGENT_MEMORY" {
            evidence.push(Evidence::new(
                EvidenceKind::OriginalActionExecutionId,
                source_id,
            ));
        }
        usage_audit(
            &mut tx,
            operation,
            &format!("usage:{id}:{next}"),
            "RECONCILIATION",
            next,
            evidence,
        )
        .await?;
        tx.commit()
            .await
            .map_err(|_| "UsageEvent 对账提交结果不明")?;
    }
    if unavailable {
        return Err("BILLING_UNAVAILABLE：OpenMeter usage 投递/查证结果不明");
    }
    Ok(committed)
}

fn delivery_committed(status: &str, stored_at: Option<DateTime<Utc>>) -> bool {
    status == "COMMITTED" && stored_at.is_some()
}

#[cfg(test)]
mod usage_tests {
    use super::{delivery_committed, frozen_turn_meters, memory_child_meters, Page, RequestSet};
    use chrono::Utc;
    use serde_json::{json, Value};
    use uuid::Uuid;

    // Protocol-only inputs to the same production guard, added after the live
    // consumer. These create no Tenant, Invocation, meter, model call or UsageEvent.
    fn page(entries: Vec<Value>, cursor: i64, submitted: i64) -> Page {
        serde_json::from_value(json!({
            "entries": entries, "nextCursor": cursor,
            "submittedRequests": submitted, "pendingRequests": 0,
            "untrackedRequests": 0, "requestSetComplete": true
        }))
        .expect("native Page field types")
    }

    #[test]
    fn memory_child_set_requires_both_frozen_meters_and_certain_same_turn() {
        let child = Uuid::new_v4();
        let parameters = json!({"memoryUsage":{"meters":[
            {"key":"agent_memory_read_count","id":"count","event_type":"read","value_property":null},
            {"key":"agent_memory_plaintext_bytes","id":"bytes","event_type":"read","value_property":"$.plaintext_bytes"}
        ]}});
        let expected = memory_child_meters(child, &parameters, "DISPATCHED", true).unwrap();
        assert_eq!(expected.len(), 2);
        assert!(expected
            .iter()
            .all(|(source, id, _)| source == "BUZZ_AGENT_MEMORY" && *id == child));
        for dispatch in ["UNKNOWN", "NOT_DISPATCHED"] {
            assert!(memory_child_meters(child, &parameters, dispatch, true).is_err());
        }
        assert!(memory_child_meters(child, &parameters, "DISPATCHED", false).is_err());
        let mut changed = parameters.clone();
        changed["memoryUsage"]["meters"]
            .as_array_mut()
            .unwrap()
            .pop();
        assert!(memory_child_meters(child, &changed, "DISPATCHED", true).is_err());
        changed["memoryUsage"]["meters"][0]["key"] = json!("automation.run");
        assert!(memory_child_meters(child, &changed, "DISPATCHED", true).is_err());
    }

    fn entry(id: Uuid, seq: i64, trace: &str, principal: Uuid) -> Value {
        let observed = Utc::now();
        json!({
            "id":id,"seq":seq,"dispatchAttempt":0,
            "startedAt":observed,"completedAt":observed,
            "traceId":trace,"agentgatewayUser":principal,
            "genAi":{"providerName":null,"requestModel":null},
            "usage":{"inputTokens":null,"outputTokens":null,"totalTokens":null}
        })
    }

    #[test]
    fn native_set_requires_every_short_page_and_empty_exhaustion() {
        let trace = Uuid::new_v4().simple().to_string();
        let principal = Uuid::new_v4();
        let mut set = RequestSet::default();
        // A native-capped short page is not exhaustion, even though batch=2.
        assert!(!set
            .absorb(
                page(vec![entry(Uuid::new_v4(), 1, &trace, principal)], 1, 2),
                &trace,
                principal,
                2
            )
            .expect("first native page"));
        assert!(!set
            .absorb(
                page(vec![entry(Uuid::new_v4(), 2, &trace, principal)], 2, 2),
                &trace,
                principal,
                2
            )
            .expect("second native page"));
        assert!(set
            .absorb(page(vec![], 2, 2), &trace, principal, 2)
            .expect("exhausted native set"));
        assert_eq!(set.ids.len(), 2);
        assert_eq!(set.entries.len(), 2);
    }

    #[test]
    fn empty_native_set_and_missing_completion_page_never_prove_zero_usage() {
        let trace = Uuid::new_v4().simple().to_string();
        let principal = Uuid::new_v4();
        assert!(RequestSet::default()
            .absorb(page(vec![], 0, 0), &trace, principal, 2)
            .is_err());
        let mut set = RequestSet::default();
        assert!(!set
            .absorb(
                page(vec![entry(Uuid::new_v4(), 1, &trace, principal)], 1, 2),
                &trace,
                principal,
                2
            )
            .expect("partial native page"));
        assert!(set
            .absorb(page(vec![], 1, 2), &trace, principal, 2)
            .is_err());
    }

    #[test]
    fn application_empty_set_requires_native_revocation_not_missing_requests() {
        let principal = Uuid::new_v4();
        for revoked in [None, Some(false)] {
            let mut snapshot = page(vec![], 0, 0);
            snapshot.credential_revoked = revoked;
            assert!(RequestSet::default()
                .absorb_set(snapshot, None, principal, 2)
                .is_err());
        }
        let mut snapshot = page(vec![], 0, 0);
        snapshot.credential_revoked = Some(true);
        assert!(RequestSet::default()
            .absorb_set(snapshot, None, principal, 2)
            .expect("native tombstone and complete dispatch set"));
        let mut pending = page(vec![], 0, 1);
        pending.credential_revoked = Some(true);
        pending.pending_requests = Some(1);
        assert!(RequestSet::default()
            .absorb_set(pending, None, principal, 2)
            .is_err());
    }

    #[test]
    fn application_generation_set_does_not_borrow_an_agent_request_on_same_trace() {
        let trace = Uuid::new_v4().simple().to_string();
        let application = Uuid::new_v4();
        let agent = Uuid::new_v4();
        let mut snapshot = page(vec![entry(Uuid::new_v4(), 1, &trace, agent)], 1, 1);
        snapshot.credential_revoked = Some(true);
        assert!(RequestSet::default()
            .absorb_set(snapshot, None, application, 2)
            .is_err());

        // A binding's native outbox also contains requests without any Agent
        // trace. They remain binding attribution, not a made-up Invocation.
        let mut native = entry(Uuid::new_v4(), 1, &trace, application);
        native["traceId"] = Value::Null;
        let mut snapshot = page(vec![native], 1, 1);
        snapshot.credential_revoked = Some(true);
        let mut set = RequestSet::default();
        assert!(!set.absorb_set(snapshot, None, application, 2).unwrap());
        let mut end = page(vec![], 1, 1);
        end.credential_revoked = Some(true);
        assert!(set.absorb_set(end, None, application, 2).unwrap());
        assert_eq!(set.entries.len(), 1);
        assert!(set.entries[0].trace_id.is_none());
    }

    #[test]
    fn changing_pending_legacy_or_missing_native_snapshot_is_unknown() {
        let trace = Uuid::new_v4().simple().to_string();
        let principal = Uuid::new_v4();
        let id = Uuid::new_v4();
        let mut set = RequestSet::default();
        assert!(!set
            .absorb(
                page(vec![entry(id, 1, &trace, principal)], 1, 2),
                &trace,
                principal,
                2
            )
            .expect("partial native page"));
        assert!(set
            .absorb(
                page(vec![entry(Uuid::new_v4(), 2, &trace, principal)], 2, 3),
                &trace,
                principal,
                2
            )
            .is_err());
        for counter in ["pendingRequests", "untrackedRequests"] {
            let mut snapshot = json!({
                "entries":[entry(Uuid::new_v4(), 1, &trace, principal)],
                "nextCursor":1,"submittedRequests":1,
                "pendingRequests":0,"untrackedRequests":0,"requestSetComplete":true
            });
            snapshot[counter] = 1.into();
            let page = serde_json::from_value(snapshot).expect("native counters");
            assert!(RequestSet::default()
                .absorb(page, &trace, principal, 2)
                .is_err());
        }
        let legacy =
            serde_json::from_value(json!({"entries":[],"nextCursor":0})).expect("legacy Page");
        assert!(RequestSet::default()
            .absorb(legacy, &trace, principal, 2)
            .is_err());
    }

    #[test]
    fn repeated_request_id_cannot_reenter_attribution_as_another_effect() {
        let trace = Uuid::new_v4().simple().to_string();
        let principal = Uuid::new_v4();
        let id = Uuid::new_v4();
        let mut set = RequestSet::default();
        assert!(!set
            .absorb(
                page(vec![entry(id, 1, &trace, principal)], 1, 1),
                &trace,
                principal,
                1
            )
            .expect("first native request"));
        assert!(set
            .absorb(
                page(vec![entry(id, 2, &trace, principal)], 2, 1),
                &trace,
                principal,
                1
            )
            .is_err());
        assert_eq!(set.entries.len(), 1);
    }

    #[test]
    fn missing_attempt_wrong_scope_or_cursor_cannot_complete_the_set() {
        let trace = Uuid::new_v4().simple().to_string();
        let principal = Uuid::new_v4();
        for field in ["dispatchAttempt", "traceId", "agentgatewayUser"] {
            let mut native = entry(Uuid::new_v4(), 1, &trace, principal);
            native[field] = Value::Null;
            assert!(RequestSet::default()
                .absorb(page(vec![native], 1, 1), &trace, principal, 1)
                .is_err());
        }
        assert!(RequestSet::default()
            .absorb(
                page(vec![entry(Uuid::new_v4(), 1, &trace, principal)], 0, 1),
                &trace,
                principal,
                1
            )
            .is_err());
    }

    #[test]
    fn accepted_enqueue_is_not_native_committed_metering() {
        assert!(!delivery_committed("ACCEPTED", None));
        assert!(!delivery_committed("UNKNOWN", None));
        assert!(!delivery_committed("COMMITTED", None));
        assert!(!delivery_committed("ACCEPTED", Some(Utc::now())));
        assert!(delivery_committed("COMMITTED", Some(Utc::now())));
    }

    #[test]
    fn ordinary_turn_freezes_only_registered_model_sum_without_count() {
        let sum = json!([{"key":"model.tokens", "id":"native-meter", "event_type":"native.model",
            "value_property":"$.totalTokens"}]);
        let (meters, count) = frozen_turn_meters(
            "agent.invoke",
            sum.clone(),
            None,
            &["model.tokens".to_owned()],
        )
        .expect("ordinary native SUM projection");
        assert_eq!(meters.len(), 1);
        assert!(count.is_none());
        assert!(frozen_turn_meters(
            "agent.invoke",
            sum.clone(),
            Some(Value::Null),
            &["model.tokens".to_owned()]
        )
        .is_err());
        assert!(frozen_turn_meters("agent.invoke", sum, None, &[]).is_err());
        assert!(frozen_turn_meters("agent.invoke", json!([]), None, &[]).is_err());
    }

    #[test]
    fn automation_cannot_drop_count_and_ordinary_cannot_borrow_it() {
        let sum = json!([{"key":"model.tokens", "id":"native-meter", "event_type":"native.model",
            "value_property":"$.totalTokens"}]);
        let count =
            json!({"key":"automation.run", "id":"native-count", "event_type":"native.automation"});
        let keys = ["model.tokens".to_owned(), "automation.run".to_owned()];
        assert!(
            frozen_turn_meters("automation.run", sum.clone(), Some(count.clone()), &keys).is_ok()
        );
        assert!(frozen_turn_meters(
            "automation.run",
            sum.clone(),
            None,
            &["model.tokens".to_owned()]
        )
        .is_err());
        assert!(
            frozen_turn_meters("agent.invoke", sum.clone(), Some(count.clone()), &keys).is_err()
        );
        assert!(frozen_turn_meters("future.invoke", sum, Some(count), &keys).is_err());
    }

    #[test]
    fn ordinary_null_is_not_a_meter_or_unknown_action_exemption() {
        let sum = json!([{"key":"model.tokens", "id":"native-meter", "event_type":"native.model",
            "value_property":"$.totalTokens"}]);
        let keys = ["model.tokens".to_owned()];
        assert!(frozen_turn_meters("future.invoke", sum.clone(), None, &keys).is_err());
        assert!(frozen_turn_meters(
            "agent.invoke",
            sum.clone(),
            None,
            &["model.tokens".to_owned(), "model.tokens".to_owned()]
        )
        .is_err());
        assert!(frozen_turn_meters(
            "agent.invoke",
            json!([sum[0].clone(), sum[0].clone()]),
            None,
            &keys
        )
        .is_err());
        assert!(
            frozen_turn_meters("agent.invoke", sum, None, &["different.tokens".to_owned()])
                .is_err()
        );
    }
}
