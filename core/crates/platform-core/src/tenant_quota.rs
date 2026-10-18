//! DD-123：Tenant 额度由 Tenant admin 以受治理动作 `tenant.quota.set` 直接设置，
//! OpenMeter 是唯一权威（DD-07/38）。
//!
//! - 只写该 Tenant 唯一 Customer 的 metered entitlement：硬限制（`isSoftLimit=false`）、
//!   按月重置、额度即每期发放量；Core 不建第二套余额或用量账本。
//! - 写入遵循 DD-81：先在 Core 落意图（`admission.tenant_quota_intent`）与 DISPATCH，
//!   再发唯一一次原生写入；以确定 key（Customer + feature）与意图 ID（entitlement
//!   metadata）回读查证。结果不明只对账，绝不盲目重发。
//! - 部署引导幂等登记平台 meter/feature，并为每个 Customer 已 ACTIVE 的业务 Tenant
//!   以同一意图路径建立默认硬限制额度；已有 entitlement 的额度项不覆盖。
//! - `tenant.quota.set` 只经 BFF 的 HUMAN 会话提交；Delegation 只接受 `agent.invoke`、
//!   `automation.run` 与登记过 Agent consumer 的动作，Agent 没有发起它的路径，
//!   `.design/12` 对 Agent 发起所需的审批因此不会被绕开。

use std::collections::BTreeMap;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Response,
};
use chrono::{DateTime, Datelike, SecondsFormat, TimeZone, Utc};
use contracts::{
    EvidenceKind, ReasonCode, SetActionKey, TenantQuotaFeature, TenantQuotaPage, TenantQuotaView,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgConnection, PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::audit::Evidence;
use crate::bff::{resolve_execution_context, BffState};
use crate::governance::{
    self, record_dispatch, Actor, Definition, Execution, Governance, Params, Refusal, Target,
};
use crate::openmeter::{
    self, FeatureShape, MeterShape, NativeEntitlement, NativeEntitlementValue, OpenMeter,
};
use crate::spicedb::Consistency;
use crate::tenant_bootstrap::AUDIENCE;

pub(crate) const ACTION: &str = "tenant.quota.set";
/// 契约 `TenantQuotaSetting.limitPerPeriod` 的上界。
pub(crate) const MAX_LIMIT: i64 = 1_000_000_000_000;
/// entitlement metadata 中的意图键：回读与对账只按它确认「这一次」写入。
pub(crate) const INTENT_METADATA_KEY: &str = "kailo_action_execution_id";
const ORIGIN_METADATA_KEY: &str = "kailo_quota_origin";
const ORIGIN_SET: &str = "SET";
const ORIGIN_DEFAULT: &str = "DEFAULT";

/// 固定平台 meter key（原生 v3 ResourceKey）。部署配置只能引用这些 key：
/// `AGENT_INVOKE_METERS_JSON=["agent_total_tokens"]`、
/// `AUTOMATION_RUN_METERS_JSON=["agent_total_tokens","automation.run"]`、
/// `AUTOMATION_RUN_NATIVE_METER_KEY=automation_run`；记忆读写 meter 与
/// `openmeter.rs` 的 memory meter 核验逐字相同。
pub(crate) const AGENT_TOKENS_METER: &str = "agent_total_tokens";
pub(crate) const AUTOMATION_RUN_METER: &str = "automation_run";
pub(crate) const MEMORY_READ_METER: &str = "agent_memory_read_count";
pub(crate) const MEMORY_WRITE_METER: &str = "agent_memory_write_count";
pub(crate) const MEMORY_BYTES_METER: &str = "agent_memory_plaintext_bytes";

const INSTALLATION_DIMENSION: (&str, &str) = (
    "agent_installation_resource_id",
    "$.agent_installation_resource_id",
);

/// 一个固定平台 meter 的完整原生形状。Core 逐 meter 发 CloudEvent，因此每个
/// event type 在 namespace 内只属于一个未删除 meter。
pub(crate) struct PlatformMeter {
    pub key: &'static str,
    pub name: &'static str,
    pub aggregation: &'static str,
    pub event_type: &'static str,
    pub value_property: Option<&'static str>,
    pub dimensions: &'static [(&'static str, &'static str)],
}

pub(crate) static PLATFORM_METERS: [PlatformMeter; 5] = [
    PlatformMeter {
        key: AGENT_TOKENS_METER,
        name: "Agent model tokens",
        aggregation: "sum",
        event_type: "kailo.agent.model.tokens",
        value_property: Some("$.totalTokens"),
        dimensions: &[
            ("workspace_id", "$.workspace_id"),
            INSTALLATION_DIMENSION,
            ("provider", "$.provider"),
            ("model", "$.model"),
        ],
    },
    PlatformMeter {
        key: AUTOMATION_RUN_METER,
        name: "Automation runs",
        aggregation: "count",
        event_type: "kailo.automation.run",
        value_property: None,
        dimensions: &[
            ("workspace_id", "$.workspace_id"),
            INSTALLATION_DIMENSION,
            ("automation_resource_id", "$.automation_resource_id"),
        ],
    },
    PlatformMeter {
        key: MEMORY_READ_METER,
        name: "Agent memory reads",
        aggregation: "count",
        event_type: "kailo.agent.memory.read",
        value_property: None,
        dimensions: &[("workspace_id", "$.workspace_id"), INSTALLATION_DIMENSION],
    },
    PlatformMeter {
        key: MEMORY_WRITE_METER,
        name: "Agent memory writes",
        aggregation: "count",
        event_type: "kailo.agent.memory.write",
        value_property: None,
        dimensions: &[("workspace_id", "$.workspace_id"), INSTALLATION_DIMENSION],
    },
    PlatformMeter {
        key: MEMORY_BYTES_METER,
        name: "Agent memory plaintext bytes",
        aggregation: "sum",
        event_type: "kailo.agent.memory.bytes",
        value_property: Some("$.plaintext_bytes"),
        dimensions: &[("workspace_id", "$.workspace_id"), INSTALLATION_DIMENSION],
    },
];

/// 一期平台额度项（feature）、它计量的 meter 与默认每月硬限制。
pub(crate) struct PlatformFeature {
    pub quota: TenantQuotaFeature,
    pub key: &'static str,
    pub name: &'static str,
    pub meter: &'static str,
    pub default_limit: i64,
}

pub(crate) static PLATFORM_FEATURES: [PlatformFeature; 3] = [
    PlatformFeature {
        quota: TenantQuotaFeature::AgentTokens,
        key: "agent_tokens",
        name: "Agent tokens",
        meter: AGENT_TOKENS_METER,
        default_limit: 10_000_000,
    },
    PlatformFeature {
        quota: TenantQuotaFeature::AutomationRuns,
        key: "automation_runs",
        name: "Automation runs",
        meter: AUTOMATION_RUN_METER,
        default_limit: 10_000,
    },
    PlatformFeature {
        quota: TenantQuotaFeature::AgentMemoryWrites,
        key: "agent_memory_writes",
        name: "Agent memory writes",
        meter: MEMORY_WRITE_METER,
        default_limit: 100_000,
    },
];

pub(crate) fn feature_key(feature: &TenantQuotaFeature) -> &'static str {
    match feature {
        TenantQuotaFeature::AgentTokens => "agent_tokens",
        TenantQuotaFeature::AutomationRuns => "automation_runs",
        TenantQuotaFeature::AgentMemoryWrites => "agent_memory_writes",
    }
}

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

// ---------------------------------------------------------------------------
// 纯规则：参数、目录形状、请求与回读
// ---------------------------------------------------------------------------

/// 规范化 `tenantQuotaSetting`：额度项属一期封闭集合，上限是 0..=MAX_LIMIT 的整数。
pub(crate) fn normalize(setting: &contracts::TenantQuotaSettingClass) -> Result<Value, Refusal> {
    if !(0..=MAX_LIMIT).contains(&setting.limit_per_period) {
        return Err(invalid());
    }
    Ok(json!({
        "feature": feature_key(&setting.feature),
        "limitPerPeriod": setting.limit_per_period,
    }))
}

/// 冻结参数的读回：只接受 `normalize` 的规范形状。
pub(crate) fn setting(p: &Params) -> Result<(&'static str, i64), Refusal> {
    let value = p.tenant_quota_setting.as_ref().ok_or_else(invalid)?;
    let parsed: contracts::TenantQuotaSettingClass =
        serde_json::from_value(value.clone()).map_err(|_| invalid())?;
    if normalize(&parsed)? != *value {
        return Err(invalid());
    }
    Ok((feature_key(&parsed.feature), parsed.limit_per_period))
}

/// DD-123 (1) 的目录形状：目标 Tenant、manage@tenant、SYNC、显式确认、无审批、
/// FULL_LIFECYCLE、quota NONE。目录与语义不一致即阻断。
pub(crate) fn definition_shape(def: &Definition) -> bool {
    def.action_key == ACTION
        && def.component_type_key == "core"
        && def.target_type == "TENANT"
        && def.tenant_rule == "SESSION_TENANT"
        && def.workspace_rule == "TENANT_ONLY"
        && def.permission == "manage"
        && def.permission_object_type == "tenant"
        && def.execution_mode == "SYNC"
        && def.confirmation_mode == "EXPLICIT"
        && def.approval_policy_id.is_none()
        && def.approval_policy_version.is_none()
        && def.workflow_kind.is_none()
        && def.quota_policy == "NONE"
        && def.meters.is_empty()
        && def.result_exposure == "NONE"
        && def.role_template_key.is_none()
        && def.role_template_version.is_none()
}

/// UTC 当月第一天零点：没有既有 entitlement 时的按月重置锚点。
pub(crate) fn month_start(now: DateTime<Utc>) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(now.year(), now.month(), 1, 0, 0, 0)
        .single()
        .unwrap_or(now)
}

/// v2 metered entitlement 的创建/override 请求。`measureUsageFrom` 取锚点所在周期
/// 的开始：调整额度不清零本期已用量（V-SCN-114 把上限调低到已用量以下即耗尽）。
pub(crate) fn entitlement_request(
    feature: &str,
    limit: i64,
    anchor: DateTime<Utc>,
    intent: Uuid,
    origin: &str,
) -> Value {
    json!({
        "type": "metered",
        "featureKey": feature,
        "isSoftLimit": false,
        "usagePeriod": {
            "interval": "MONTH",
            "anchor": anchor.to_rfc3339_opts(SecondsFormat::Secs, true),
        },
        "measureUsageFrom": "CURRENT_PERIOD_START",
        "preserveOverageAtReset": false,
        "issue": { "amount": limit },
        "metadata": {
            (INTENT_METADATA_KEY): intent.to_string(),
            (ORIGIN_METADATA_KEY): origin,
        },
    })
}

/// 原生每期发放量的整数读回；非整数、负数或越界都不是本平台写入的额度。
pub(crate) fn issued_limit(entitlement: &NativeEntitlement) -> Option<i64> {
    let amount = entitlement
        .issue
        .as_ref()
        .map(|issue| issue.amount)
        .or(entitlement.issue_after_reset)?;
    let whole = amount.is_finite() && amount.fract() == 0.0;
    if whole && (0.0..=MAX_LIMIT as f64).contains(&amount) {
        Some(amount as i64)
    } else {
        None
    }
}

fn monthly(entitlement: &NativeEntitlement) -> bool {
    let Some(period) = entitlement.usage_period.as_ref() else {
        return false;
    };
    period.interval.as_deref() == Some("MONTH") || period.interval_iso.as_deref() == Some("P1M")
}

fn intent_of(entitlement: &NativeEntitlement) -> Option<&str> {
    entitlement
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get(INTENT_METADATA_KEY))
        .map(String::as_str)
}

/// 回读查证：确实是这次意图写入的、未删除的按月硬限制，且发放量等于意图上限。
pub(crate) fn matches_intent(entitlement: &NativeEntitlement, intent: Uuid, limit: i64) -> bool {
    entitlement.kind == "metered"
        && entitlement.deleted_at.is_none()
        && entitlement.is_soft_limit == Some(false)
        && intent_of(entitlement) == Some(intent.to_string().as_str())
        && monthly(entitlement)
        && issued_limit(entitlement) == Some(limit)
}

/// 完整历史（含被替换者）里这次意图的原生事实。
#[derive(Debug, PartialEq)]
pub(crate) enum Observed {
    Verified(Box<NativeEntitlement>),
    /// 写入已发生，之后又被另一次设置替换：结果确定为已生效。
    Superseded,
    Absent,
    Inconsistent,
}

pub(crate) fn classify(history: Vec<NativeEntitlement>, intent: Uuid, limit: i64) -> Observed {
    let id = intent.to_string();
    let mut ours: Vec<NativeEntitlement> = history
        .into_iter()
        .filter(|entitlement| intent_of(entitlement) == Some(id.as_str()))
        .collect();
    let Some(entitlement) = ours.pop() else {
        return Observed::Absent;
    };
    if !ours.is_empty() {
        return Observed::Inconsistent;
    }
    if entitlement.deleted_at.is_some() {
        return Observed::Superseded;
    }
    if matches_intent(&entitlement, intent, limit) {
        Observed::Verified(Box::new(entitlement))
    } else {
        Observed::Inconsistent
    }
}

/// 原生确定拒绝（未写入）映射到的稳定原因码。
pub(crate) fn rejection_reason(error: &openmeter::Error) -> ReasonCode {
    match error {
        openmeter::Error::Conflict => ReasonCode::TargetStateConflict,
        openmeter::Error::Limit => ReasonCode::RateLimited,
        openmeter::Error::Denied | openmeter::Error::Precondition | openmeter::Error::Unknown => {
            ReasonCode::DependencyUnavailable
        }
    }
}

/// 页面投影：数值保持原生，没有 entitlement 即原生无访问（CHECK 以 QUOTA_EXHAUSTED
/// 拒绝），没有可展示的上限、用量或重置时间。
pub(crate) fn quota_view(
    feature: TenantQuotaFeature,
    entitlement: Option<&NativeEntitlement>,
    value: Option<&NativeEntitlementValue>,
) -> TenantQuotaView {
    let Some(entitlement) = entitlement else {
        return TenantQuotaView {
            feature,
            hard_limit: true,
            has_access: false,
            limit_per_period: None,
            period_reset_at: None,
            usage: None,
        };
    };
    let reset = entitlement
        .current_usage_period
        .as_ref()
        .map(|period| period.to.to_rfc3339_opts(SecondsFormat::Secs, true));
    TenantQuotaView {
        feature,
        hard_limit: !entitlement.is_soft_limit.unwrap_or(false),
        has_access: value.is_some_and(|value| value.has_access),
        limit_per_period: issued_limit(entitlement),
        period_reset_at: reset,
        usage: value
            .and_then(|value| value.usage)
            .filter(|usage| usage.is_finite() && *usage >= 0.0),
    }
}

fn meter_dimensions(meter: &PlatformMeter) -> BTreeMap<String, String> {
    meter
        .dimensions
        .iter()
        .map(|(name, path)| ((*name).to_owned(), (*path).to_owned()))
        .collect()
}

/// v3 meter 创建请求（固定平台形状）。
pub(crate) fn meter_request(meter: &PlatformMeter) -> Value {
    let mut body = json!({
        "name": meter.name,
        "key": meter.key,
        "aggregation": meter.aggregation,
        "event_type": meter.event_type,
        "dimensions": meter_dimensions(meter),
    });
    if let Some(property) = meter.value_property {
        body["value_property"] = Value::String(property.to_owned());
    }
    body
}

#[derive(Debug, PartialEq)]
pub(crate) enum Registration {
    Registered(String),
    Absent,
    Conflict(&'static str),
}

/// 已有原生 meter 与固定形状逐字比较；同 key 不同形状或 event type 被他人占用都不改写。
pub(crate) fn meter_registration(live: &[MeterShape], meter: &PlatformMeter) -> Registration {
    let same_key: Vec<&MeterShape> = live.iter().filter(|m| m.key == meter.key).collect();
    let same_event = live
        .iter()
        .filter(|m| m.event_type == meter.event_type)
        .count();
    match same_key.as_slice() {
        [native]
            if native.aggregation == meter.aggregation
                && native.event_type == meter.event_type
                && native.value_property.as_deref() == meter.value_property
                && native.dimensions == meter_dimensions(meter)
                && same_event == 1 =>
        {
            Registration::Registered(native.id.clone())
        }
        [_] => Registration::Conflict("原生 meter 与固定平台形状不一致"),
        [] if same_event > 0 => Registration::Conflict("event type 已被另一原生 meter 占用"),
        [] => Registration::Absent,
        _ => Registration::Conflict("同 key 有多个未删除原生 meter"),
    }
}

/// feature 必须唯一、无维度 filter，且指向本平台 meter。
pub(crate) fn feature_registration(live: &[FeatureShape], meter_id: &str) -> Registration {
    match live {
        [feature] if feature.meter_id.as_deref() == Some(meter_id) && !feature.filtered => {
            Registration::Registered(feature.id.clone())
        }
        [] => Registration::Absent,
        _ => Registration::Conflict("平台 feature 与固定 meter 关系不一致"),
    }
}

// ---------------------------------------------------------------------------
// 意图持久化与唯一一次原生写入
// ---------------------------------------------------------------------------

#[derive(FromRow, Debug, Clone)]
pub(crate) struct Intent {
    pub action_execution_id: Uuid,
    pub feature_key: String,
    pub limit_per_period: i64,
    pub openmeter_customer_id: String,
    pub dispatch_started: bool,
    pub outcome: Option<String>,
}

const INTENT_COLUMNS: &str = "action_execution_id, feature_key, limit_per_period,
     openmeter_customer_id, dispatch_started, outcome";

async fn lock_intent(
    tx: &mut Transaction<'_, Postgres>,
    action_execution_id: Uuid,
) -> Result<Option<Intent>, sqlx::Error> {
    sqlx::query_as(&format!(
        "select {INTENT_COLUMNS} from admission.tenant_quota_intent
         where action_execution_id = $1 for update"
    ))
    .bind(action_execution_id)
    .fetch_optional(&mut **tx)
    .await
}

/// 该 Tenant 唯一 ACTIVE Customer 引用（同 CHECK 准入的 binding 判据）。
async fn active_customer(
    conn: &mut PgConnection,
    tenant: Uuid,
    namespace: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(String, String, String, String, i32)> = sqlx::query_as(
        "select namespace, customer_id, subject_key_prefix, status, version
         from projection.openmeter_binding where tenant_id = $1",
    )
    .bind(tenant)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((stored_namespace, customer, prefix, status, version)) = row else {
        return Ok(None);
    };
    let active = stored_namespace == namespace
        && prefix == format!("{tenant}:")
        && status == "ACTIVE"
        && version > 0;
    Ok(active.then_some(customer))
}

/// 写前计划：只读当前 entitlement。已有即 override（继承其周期锚点），没有即创建。
pub(crate) struct Plan {
    pub replaced: Option<String>,
    pub request: Value,
}

async fn plan(
    openmeter: &OpenMeter,
    intent: &Intent,
    origin: &str,
) -> Result<Plan, openmeter::Error> {
    let current = openmeter
        .entitlement(&intent.openmeter_customer_id, &intent.feature_key)
        .await?;
    let anchor = current
        .as_ref()
        .and_then(|entitlement| entitlement.usage_period.as_ref())
        .and_then(|period| period.anchor)
        .unwrap_or_else(|| month_start(Utc::now()));
    Ok(Plan {
        replaced: current.map(|entitlement| entitlement.id),
        request: entitlement_request(
            &intent.feature_key,
            intent.limit_per_period,
            anchor,
            intent.action_execution_id,
            origin,
        ),
    })
}

/// 计划随 dispatch_started 一起落库；提交之后才可发原生写入。
async fn persist_plan(
    tx: &mut Transaction<'_, Postgres>,
    intent: &Intent,
    plan: &Plan,
) -> Result<(), sqlx::Error> {
    let changed = sqlx::query(
        "update admission.tenant_quota_intent
         set dispatch_started = true, request = $2, replaced_entitlement_id = $3
         where action_execution_id = $1 and not dispatch_started",
    )
    .bind(intent.action_execution_id)
    .bind(&plan.request)
    .bind(&plan.replaced)
    .execute(&mut **tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(sqlx::Error::Protocol("额度意图已开始派发".into()));
    }
    Ok(())
}

async fn settle_intent(
    tx: &mut Transaction<'_, Postgres>,
    action_execution_id: Uuid,
    outcome: &str,
    entitlement: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update admission.tenant_quota_intent
         set outcome = $2, entitlement_id = $3, settled_at = now()
         where action_execution_id = $1 and outcome is null",
    )
    .bind(action_execution_id)
    .bind(outcome)
    .bind(entitlement)
    .execute(&mut **tx)
    .await
    .map(|_| ())
}

/// 唯一一次原生写入之后（或对账时）的确定结论。
#[derive(Debug, PartialEq)]
pub(crate) enum Applied {
    Verified(Box<NativeEntitlement>),
    Superseded,
    Rejected(ReasonCode),
    Unknown,
}

/// 只读对账：完整历史按意图 ID 查证，再以确定 key 确认当前即这一条。
async fn observe(openmeter: &OpenMeter, intent: &Intent) -> Applied {
    let customer = intent.openmeter_customer_id.as_str();
    let feature = intent.feature_key.as_str();
    let history = match openmeter.entitlement_history(customer, feature).await {
        Ok(history) => history,
        Err(_) => return Applied::Unknown,
    };
    let limit = intent.limit_per_period;
    match classify(history, intent.action_execution_id, limit) {
        Observed::Verified(entitlement) => match openmeter.entitlement(customer, feature).await {
            Ok(Some(current)) if current.id == entitlement.id => Applied::Verified(entitlement),
            _ => Applied::Unknown,
        },
        Observed::Superseded => Applied::Superseded,
        Observed::Absent | Observed::Inconsistent => Applied::Unknown,
    }
}

/// 发唯一一次 create/override，再回读。确定的 4xx 是未写入；其余只能对账。
async fn send(openmeter: &OpenMeter, intent: &Intent, plan: &Plan) -> Applied {
    let customer = intent.openmeter_customer_id.as_str();
    let body = &plan.request;
    let written = match plan.replaced.as_deref() {
        None => openmeter.create_entitlement(customer, body).await,
        Some(old) => openmeter.override_entitlement(customer, old, body).await,
    };
    match written {
        Ok(_) | Err(openmeter::Error::Unknown) => observe(openmeter, intent).await,
        Err(error) => match observe(openmeter, intent).await {
            applied @ (Applied::Verified(_) | Applied::Superseded) => applied,
            _ => Applied::Rejected(rejection_reason(&error)),
        },
    }
}

// ---------------------------------------------------------------------------
// tenant.quota.set：目标、准入落定与派发
// ---------------------------------------------------------------------------

/// 目标是会话 Tenant 本身；Platform Catalog 没有业务额度。
pub(crate) async fn target(
    conn: &mut PgConnection,
    tenant: Uuid,
    def: &Definition,
    p: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    if !definition_shape(def) {
        tracing::error!(action = %def.action_key, "tenant.quota.set 的目录形状与语义不一致");
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    setting(p)?;
    if frozen.is_some_and(|id| id != tenant)
        || crate::platform_bootstrap::is_catalog_tenant(&mut *conn, tenant).await?
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let version: Option<i32> = sqlx::query_scalar(&format!(
        "select version from identity.tenant where id = $1 and state = 'ACTIVE'{}",
        if lock { " for update" } else { "" }
    ))
    .bind(tenant)
    .fetch_optional(&mut *conn)
    .await?;
    let version = version.ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    Ok(Target {
        id: tenant,
        version,
        workspace_id: None,
    })
}

/// 准入落定事务内冻结意图：额度项、上限与此刻唯一 ACTIVE Customer。
pub(crate) async fn prewrite(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    p: &Params,
) -> Result<(), Refusal> {
    let (feature, limit) = setting(p)?;
    let namespace = g.openmeter.namespace();
    let customer = active_customer(tx, ae.tenant_id, namespace)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::BindingNotActive))?;
    sqlx::query(
        "insert into admission.tenant_quota_intent
             (action_execution_id, tenant_id, feature_key, limit_per_period, origin,
              openmeter_namespace, openmeter_customer_id)
         values ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(ae.id)
    .bind(ae.tenant_id)
    .bind(feature)
    .bind(limit)
    .bind(ORIGIN_SET)
    .bind(namespace)
    .bind(customer)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// 唯一原生写入之前的 fresh 重新准入：发起人仍是 ACTIVE HUMAN 成员且 fresh
/// tenant manage 成立。返回 checked revision；不成立返回 None。
async fn fresh_manage(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
) -> Result<Option<String>, Refusal> {
    let member: Option<i32> = sqlx::query_scalar(
        "select 1 from identity.principal p
         join identity.tenant_membership tm on tm.tenant_principal_id = p.id
         where p.id = $1 and p.tenant_id = $2 and p.kind = 'HUMAN' and p.status = 'ACTIVE'
           and tm.tenant_id = $2 and tm.state = 'ACTIVE'
         for update of tm",
    )
    .bind(ae.initiator_principal_id)
    .bind(ae.tenant_id)
    .fetch_optional(&mut **tx)
    .await?;
    if member.is_none() {
        return Ok(None);
    }
    let checked = g
        .spicedb
        .check(
            "tenant",
            &ae.tenant_id.to_string(),
            "manage",
            &ae.initiator_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()))?;
    if !checked.allowed {
        return Ok(None);
    }
    if checked.zed_token.is_empty() {
        let missing = "tenant.quota.set 缺 checked revision";
        return Err(Refusal::Unavailable(missing.into()));
    }
    Ok(Some(checked.zed_token))
}

/// 未发出任何原生写入的确定拒绝：意图记 REJECTED，派发中止并保留原因码。
async fn abort(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    reason: ReasonCode,
    evidence: Vec<Evidence>,
) -> Result<(), sqlx::Error> {
    settle_intent(tx, ae.id, "REJECTED", None).await?;
    let refused = Err(StatusCode::CONFLICT);
    let class = def.audit_class();
    let recorded = record_dispatch(tx, ae.id, class, refused, evidence.clone()).await?;
    if !recorded.settled {
        return Ok(());
    }
    let code = governance::wire(&reason);
    sqlx::query("update admission.action_execution set reason_code = $2 where id = $1")
        .bind(ae.id)
        .bind(&code)
        .execute(&mut **tx)
        .await?;
    governance::audit(
        tx, ae, def, "outcome", "OUTCOME", "DENY", &code, None, evidence,
    )
    .await
}

/// 已发出（或已开始）的写入的确定结论；结果不明只记 UNKNOWN 交给对账。
async fn finish(
    mut tx: Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    applied: Applied,
    evidence: Vec<Evidence>,
) -> Result<(), Refusal> {
    let class = def.audit_class();
    let (outcome, entitlement, result) = match &applied {
        Applied::Verified(entitlement) => (
            "VERIFIED",
            Some(entitlement.id.as_str()),
            "TENANT_QUOTA_SET",
        ),
        Applied::Superseded => ("SUPERSEDED", None, "TENANT_QUOTA_SUPERSEDED"),
        Applied::Rejected(reason) => {
            abort(&mut tx, ae, def, reason.clone(), evidence).await?;
            tx.commit().await?;
            return Ok(());
        }
        Applied::Unknown => {
            let unknown = Err(StatusCode::SERVICE_UNAVAILABLE);
            record_dispatch(&mut tx, ae.id, class, unknown, evidence).await?;
            tx.commit().await?;
            return Ok(());
        }
    };
    settle_intent(&mut tx, ae.id, outcome, entitlement).await?;
    record_dispatch(&mut tx, ae.id, class, Ok(()), evidence.clone()).await?;
    governance::audit(
        &mut tx, ae, def, "outcome", "OUTCOME", "ALLOW", result, None, evidence,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

async fn lock_tenant_active(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
) -> Result<bool, sqlx::Error> {
    let active: Option<bool> =
        sqlx::query_scalar("select state='ACTIVE' from identity.tenant where id=$1 for update")
            .bind(tenant)
            .fetch_optional(&mut **tx)
            .await?;
    Ok(active == Some(true))
}

/// `tenant.quota.set` 的派发（准入落定后与对账作业共用）。锁序 AE → Tenant → 意图。
pub(crate) async fn dispatch(g: &Governance, id: Uuid, def: &Definition) -> Result<(), Refusal> {
    let mut tx = g.pool.begin().await?;
    let ae = governance::lock_execution(&mut tx, id).await?;
    if ae.gate_state != "ALLOWED"
        || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
    {
        return Ok(());
    }
    let active = lock_tenant_active(&mut tx, ae.tenant_id).await?;
    let intent = lock_intent(&mut tx, ae.id)
        .await?
        .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    let mut evidence = vec![Evidence::new(EvidenceKind::ActionExecutionId, ae.id)];
    if intent.dispatch_started {
        // 已落写前意图：不论上次是否真正发出，只对账，不重写。
        let applied = observe(&g.openmeter, &intent).await;
        return finish(tx, &ae, def, applied, evidence).await;
    }
    let token = if active {
        fresh_manage(g, &mut tx, &ae).await?
    } else {
        None
    };
    let Some(token) = token else {
        abort(&mut tx, &ae, def, ReasonCode::PermissionDenied, evidence).await?;
        tx.commit().await?;
        return Ok(());
    };
    evidence.push(Evidence::new(EvidenceKind::SpicedbZedtoken, &token));
    let customer = active_customer(&mut tx, ae.tenant_id, g.openmeter.namespace()).await?;
    if customer.as_deref() != Some(intent.openmeter_customer_id.as_str()) {
        abort(&mut tx, &ae, def, ReasonCode::BindingNotActive, evidence).await?;
        tx.commit().await?;
        return Ok(());
    }
    let Ok(frozen) = plan(&g.openmeter, &intent, ORIGIN_SET).await else {
        // 尚未发出任何写入：OpenMeter 不可读即确定中止，不留给对账稍后补写。
        let reason = ReasonCode::DependencyUnavailable;
        abort(&mut tx, &ae, def, reason, evidence).await?;
        tx.commit().await?;
        return Ok(());
    };
    persist_plan(&mut tx, &intent, &frozen).await?;
    governance::audit(
        &mut tx,
        &ae,
        def,
        "dispatch-intent",
        "DISPATCH",
        "ALLOW",
        "DISPATCH_INTENT",
        None,
        evidence.clone(),
    )
    .await?;
    // 意图先于唯一原生写入持久化；此后崩溃也只会对账。
    tx.commit().await?;
    let mut tx = g.pool.begin().await?;
    let locked = governance::lock_execution(&mut tx, ae.id).await?;
    let active = lock_tenant_active(&mut tx, ae.tenant_id).await?;
    if locked.gate_state != "ALLOWED" || !active {
        let reason = ReasonCode::TargetStateConflict;
        abort(&mut tx, &ae, def, reason, evidence).await?;
        tx.commit().await?;
        return Ok(());
    }
    let applied = send(&g.openmeter, &intent, &frozen).await;
    finish(tx, &ae, def, applied, evidence).await
}

// ---------------------------------------------------------------------------
// 读路由：GET /api/v1/tenant/quotas
// ---------------------------------------------------------------------------

async fn read_quota(
    openmeter: &OpenMeter,
    customer: &str,
    feature: &PlatformFeature,
) -> Result<TenantQuotaView, openmeter::Error> {
    let entitlement = openmeter.entitlement(customer, feature.key).await?;
    let value = match &entitlement {
        Some(_) => Some(openmeter.entitlement_value(customer, feature.key).await?),
        None => None,
    };
    let quota = feature.quota.clone();
    Ok(quota_view(quota, entitlement.as_ref(), value.as_ref()))
}

/// 页面给出设置入口的唯一判据：与提交同一准入的 fresh tenant manage 结论。只读的
/// auditor（有 audit 而无 manage）不得到入口；它不是授权票据，提交时仍完整重新准入。
pub(crate) fn set_action_key(manage_allowed: bool) -> Option<SetActionKey> {
    manage_allowed.then_some(SetActionKey::TenantQuotaSet)
}

/// 一次性可用性提示：目录开放、定义形状、非 Catalog、scope guard 与 fresh tenant
/// manage，与 `tenant.quota.set` 的准入同一条判定。
async fn set_offer(g: &Governance, actor: Actor) -> Result<Option<SetActionKey>, Refusal> {
    if !crate::capability_registry::action_exposed(ACTION) {
        return Ok(None);
    }
    let Some(def) = governance::active_definition(&g.pool, ACTION).await? else {
        return Ok(None);
    };
    if !definition_shape(&def) {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let mut conn = g.pool.acquire().await?;
    if crate::platform_bootstrap::is_catalog_tenant(&mut conn, actor.tenant_id).await? {
        return Ok(None);
    }
    drop(conn);
    let target = Target {
        id: actor.tenant_id,
        version: 0,
        workspace_id: None,
    };
    let evaluation = g.evaluate(actor, &def, &target).await?;
    Ok(set_action_key(evaluation.allowed))
}

/// `GET /api/v1/tenant/quotas`（DD-123 (5)）：上限、已用与剩余只对 Tenant admin 与
/// auditor 可见（tenant `audit` = auditor + admin，每次 fresh Check）。数值直接读
/// OpenMeter，不经 Core 副本。
pub(crate) async fn quotas(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    if let Err(response) = crate::audit_views::authorize_scope(&state, &ctx, None).await {
        return response;
    }
    let openmeter = &state.governance.openmeter;
    let customer = match state.pool.acquire().await {
        Ok(mut conn) => active_customer(&mut conn, ctx.tenant_id, openmeter.namespace()).await,
        Err(error) => Err(error),
    };
    let customer = match customer {
        Ok(Some(customer)) => customer,
        Ok(None) => return Refusal::Precondition(ReasonCode::BindingNotActive).respond(None),
        Err(error) => return Refusal::from(error).respond(None),
    };
    let mut quotas = Vec::with_capacity(PLATFORM_FEATURES.len());
    for feature in &PLATFORM_FEATURES {
        match read_quota(openmeter, &customer, feature).await {
            Ok(view) => quotas.push(view),
            Err(_) => return Refusal::Unavailable("OpenMeter 额度不可读".into()).respond(None),
        }
    }
    let actor = Actor {
        tenant_id: ctx.tenant_id,
        principal_id: ctx.tenant_principal_id,
        human_identity_id: Some(ctx.human_identity_id),
    };
    // 入口只是提示：判定不可核验时按不可设置呈现，不影响只读额度事实。
    let set_action_key = match set_offer(&state.governance, actor).await {
        Ok(key) => key,
        Err(error) => {
            let reason = governance::wire(&error.reason());
            tracing::warn!(reason = %reason, "额度设置入口不可核验，按不可设置呈现");
            None
        }
    };
    crate::presence::no_store(TenantQuotaPage {
        quotas,
        set_action_key,
    })
}

// ---------------------------------------------------------------------------
// 部署引导：平台 meter/feature 与默认额度（V-SCN-113）
// ---------------------------------------------------------------------------

fn digest(parameters: &Value) -> String {
    hex::encode(Sha256::digest(parameters.to_string().as_bytes()))
}

fn urn_key(urn: &str) -> Uuid {
    Uuid::new_v5(&Uuid::NAMESPACE_URL, urn.as_bytes())
}

/// 引导意图：按确定幂等键找回原 AE；参数不一致即拒绝，不另起或改写。
async fn bootstrap_action(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    initiator: Uuid,
    key: Uuid,
    target: (&str, Uuid),
    parameters: &Value,
) -> Result<Uuid, String> {
    let hash = digest(parameters);
    let found: Option<(Uuid, String, Option<Value>)> = sqlx::query_as(
        "select id, parameter_hash, parameters from admission.action_execution
         where tenant_id = $1 and initiator_principal_id = $2 and idempotency_key = $3",
    )
    .bind(tenant)
    .bind(initiator)
    .bind(key)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    if let Some((id, frozen_hash, frozen)) = found {
        return if frozen_hash == hash && frozen.as_ref() == Some(parameters) {
            Ok(id)
        } else {
            Err("原平台额度引导意图与本构建不一致，不重建或重派发".into())
        };
    }
    let (target_type, target_id) = target;
    let id = crate::tenant_bootstrap::record_bootstrap(
        tx,
        tenant,
        initiator,
        target_type,
        target_id,
        &hash,
    )
    .await?;
    sqlx::query(
        "update admission.action_execution set parameters = $2, idempotency_key = $3
         where id = $1",
    )
    .bind(id)
    .bind(parameters)
    .bind(key)
    .execute(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

/// 引导 AE 的派发与结果审计：`started` 同 `record_dispatch`，`result` 非空时追加
/// OUTCOME。与原生工具登记同一形状。
async fn bootstrap_settle(
    pool: &PgPool,
    action: Uuid,
    target: (&str, Uuid),
    started: Result<(), StatusCode>,
    result: Option<(&str, &str)>,
) -> Result<(), String> {
    let (target_type, target_id) = target;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let evidence = vec![
        Evidence::new(EvidenceKind::DeploymentBootstrap, AUDIENCE),
        Evidence::new(EvidenceKind::ActionExecutionId, action),
    ];
    let class = governance::AuditClass::core(target_type);
    record_dispatch(&mut tx, action, class, started, evidence.clone())
        .await
        .map_err(|e| e.to_string())?;
    if let Some((decision, code)) = result {
        let (operation, tenant, initiator, hash): (Uuid, Uuid, Uuid, String) = sqlx::query_as(
            "select operation_id, tenant_id, initiator_principal_id, parameter_hash
             from admission.action_execution where id = $1",
        )
        .bind(action)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let mut entry = crate::tenant_bootstrap::entry(
            operation,
            "outcome",
            "OUTCOME",
            tenant,
            initiator,
            target_type,
            target_id,
            &hash,
            decision,
            code,
        );
        entry.evidence_refs = evidence;
        crate::audit::append(&mut tx, entry)
            .await
            .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

/// DD-123 (3)：幂等登记固定平台 meter 与 feature。已登记且形状一致即不另起意图；
/// 不一致只报告，不改写原生对象。meter/feature key 原生唯一，结果不明时重跑的
/// 同一 POST 只会得到冲突而不会多建，随后按 key 回读收敛。
pub(crate) async fn ensure_platform_meters(
    pool: &PgPool,
    openmeter: &OpenMeter,
    catalog: Uuid,
    initiator: Uuid,
) -> Result<(), String> {
    for meter in &PLATFORM_METERS {
        ensure_meter(pool, openmeter, catalog, initiator, meter).await?;
    }
    for feature in &PLATFORM_FEATURES {
        ensure_feature(pool, openmeter, catalog, initiator, feature).await?;
    }
    Ok(())
}

async fn ensure_meter(
    pool: &PgPool,
    openmeter: &OpenMeter,
    catalog: Uuid,
    initiator: Uuid,
    meter: &PlatformMeter,
) -> Result<(), String> {
    let key = meter.key;
    let native = |e: openmeter::Error| format!("平台 meter {key}: {e}");
    let live = openmeter.live_meters().await.map_err(native)?;
    match meter_registration(&live, meter) {
        Registration::Registered(_) => return Ok(()),
        Registration::Conflict(reason) => return Err(format!("平台 meter {key}: {reason}")),
        Registration::Absent => {}
    }
    let parameters = meter_request(meter);
    let target_id = urn_key(&format!("urn:platform:meter:{key}"));
    let target = ("OPENMETER_METER", target_id);
    let ikey = urn_key(&format!("urn:platform:openmeter:meter-intent:{key}"));
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let action = bootstrap_action(&mut tx, catalog, initiator, ikey, target, &parameters).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    // 写前 DISPATCH：结果不明在先，回读确认后才记确定派发。
    let unknown = Err(StatusCode::SERVICE_UNAVAILABLE);
    bootstrap_settle(pool, action, target, unknown, None).await?;
    let created = openmeter.create_meter(&parameters).await;
    let live = openmeter.live_meters().await.map_err(native)?;
    if let Registration::Registered(_) = meter_registration(&live, meter) {
        let result = Some(("ALLOW", "OPENMETER_METER_REGISTERED"));
        return bootstrap_settle(pool, action, target, Ok(()), result).await;
    }
    Err(match created {
        Err(error) => format!("平台 meter {key} 未闭合，重跑以收敛: {error}"),
        Ok(()) => format!("平台 meter {key} 回读未闭合，重跑以收敛"),
    })
}

async fn ensure_feature(
    pool: &PgPool,
    openmeter: &OpenMeter,
    catalog: Uuid,
    initiator: Uuid,
    feature: &PlatformFeature,
) -> Result<(), String> {
    let key = feature.key;
    let native = |e: openmeter::Error| format!("平台 feature {key}: {e}");
    let meters = openmeter.live_meters().await.map_err(native)?;
    let meter = PLATFORM_METERS
        .iter()
        .find(|meter| meter.key == feature.meter)
        .ok_or("平台 feature 引用了未登记的 meter")?;
    let Registration::Registered(meter_id) = meter_registration(&meters, meter) else {
        return Err(format!("平台 feature {key} 的 meter 未登记"));
    };
    let live = openmeter.live_features(key).await.map_err(native)?;
    match feature_registration(&live, &meter_id) {
        Registration::Registered(_) => return Ok(()),
        Registration::Conflict(reason) => return Err(format!("平台 feature {key}: {reason}")),
        Registration::Absent => {}
    }
    let parameters = json!({
        "name": feature.name,
        "key": key,
        "meter": { "id": meter_id },
    });
    let target_id = urn_key(&format!("urn:platform:feature:{key}"));
    let target = ("OPENMETER_FEATURE", target_id);
    let ikey = urn_key(&format!("urn:platform:openmeter:feature-intent:{key}"));
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let action = bootstrap_action(&mut tx, catalog, initiator, ikey, target, &parameters).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    let unknown = Err(StatusCode::SERVICE_UNAVAILABLE);
    bootstrap_settle(pool, action, target, unknown, None).await?;
    let created = openmeter.create_feature(&parameters).await;
    let live = openmeter.live_features(key).await.map_err(native)?;
    if let Registration::Registered(_) = feature_registration(&live, &meter_id) {
        let result = Some(("ALLOW", "OPENMETER_FEATURE_REGISTERED"));
        return bootstrap_settle(pool, action, target, Ok(()), result).await;
    }
    Err(match created {
        Err(error) => format!("平台 feature {key} 未闭合，重跑以收敛: {error}"),
        Ok(()) => format!("平台 feature {key} 回读未闭合，重跑以收敛"),
    })
}

/// DD-123 (3)、V-SCN-113：Customer ACTIVE 的业务 Tenant 逐额度项幂等建立默认硬限制。
/// 已有任何 entitlement 的额度项不覆盖；已落意图的只对账。所有项都尝试一次，
/// 任一未闭合即返回错误，由重跑继续。
pub(crate) async fn ensure_default_quotas(
    pool: &PgPool,
    openmeter: &OpenMeter,
    tenant: Uuid,
    initiator: Uuid,
) -> Result<(), String> {
    let mut pending = Vec::new();
    for feature in &PLATFORM_FEATURES {
        if let Err(error) = ensure_default(pool, openmeter, tenant, initiator, feature).await {
            pending.push(error);
        }
    }
    if pending.is_empty() {
        Ok(())
    } else {
        Err(pending.join("；"))
    }
}

async fn ensure_default(
    pool: &PgPool,
    openmeter: &OpenMeter,
    tenant: Uuid,
    initiator: Uuid,
    feature: &PlatformFeature,
) -> Result<(), String> {
    let key = feature.key;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let customer = active_customer(&mut conn, tenant, openmeter.namespace())
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Customer 未 ACTIVE；默认额度由重跑补齐")?;
    let existing: Option<Intent> = sqlx::query_as(&format!(
        "select {INTENT_COLUMNS} from admission.tenant_quota_intent
         where tenant_id = $1 and feature_key = $2 and origin = $3
           and outcome is distinct from 'REJECTED'"
    ))
    .bind(tenant)
    .bind(key)
    .bind(ORIGIN_DEFAULT)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    drop(conn);
    let native = |e: openmeter::Error| format!("默认额度 {key}: {e}");
    let intent = match existing {
        Some(intent) if intent.outcome.is_some() => return Ok(()),
        Some(intent) => intent,
        None => {
            // 已有额度（管理员设置或此前引导）：默认值不覆盖，也不另起意图。
            if openmeter
                .entitlement(&customer, key)
                .await
                .map_err(native)?
                .is_some()
            {
                return Ok(());
            }
            match default_intent(pool, openmeter, tenant, initiator, feature, &customer).await? {
                Some(intent) => intent,
                None => return Ok(()),
            }
        }
    };
    let action = intent.action_execution_id;
    let target = ("TENANT", tenant);
    let applied = if intent.dispatch_started {
        observe(openmeter, &intent).await
    } else {
        let frozen = plan(openmeter, &intent, ORIGIN_DEFAULT)
            .await
            .map_err(native)?;
        let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
        if frozen.replaced.is_some() {
            // 意图落库后出现了别的 entitlement：默认值不覆盖，确定未写入。
            settle_intent(&mut tx, action, "PREEXISTING", None)
                .await
                .map_err(|e| e.to_string())?;
            tx.commit().await.map_err(|e| e.to_string())?;
            let refused = Err(StatusCode::CONFLICT);
            let result = Some(("DENY", "TENANT_QUOTA_PREEXISTING"));
            return bootstrap_settle(pool, action, target, refused, result).await;
        }
        persist_plan(&mut tx, &intent, &frozen)
            .await
            .map_err(|e| e.to_string())?;
        tx.commit().await.map_err(|e| e.to_string())?;
        let unknown = Err(StatusCode::SERVICE_UNAVAILABLE);
        bootstrap_settle(pool, action, target, unknown, None).await?;
        send(openmeter, &intent, &frozen).await
    };
    settle_default(pool, &intent, target, applied, key).await
}

/// 在 Tenant 行锁内落默认额度意图：Tenant ACTIVE、Customer 未变，且同额度项没有
/// 未拒绝的默认意图。幂等键随此前被确定拒绝的次数推进，拒绝之后的重跑另起意图。
async fn default_intent(
    pool: &PgPool,
    openmeter: &OpenMeter,
    tenant: Uuid,
    initiator: Uuid,
    feature: &PlatformFeature,
    customer: &str,
) -> Result<Option<Intent>, String> {
    let key = feature.key;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    if !lock_tenant_active(&mut tx, tenant)
        .await
        .map_err(|e| e.to_string())?
    {
        return Err("默认额度只建立在 ACTIVE 业务 Tenant".into());
    }
    let current = active_customer(&mut tx, tenant, openmeter.namespace())
        .await
        .map_err(|e| e.to_string())?;
    if current.as_deref() != Some(customer) {
        return Err("Customer 在引导期间变化，重跑以收敛".into());
    }
    let (open, rejected): (i64, i64) = sqlx::query_as(
        "select count(*) filter (where outcome is distinct from 'REJECTED'),
                count(*) filter (where outcome = 'REJECTED')
         from admission.tenant_quota_intent
         where tenant_id = $1 and feature_key = $2 and origin = $3",
    )
    .bind(tenant)
    .bind(key)
    .bind(ORIGIN_DEFAULT)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    if open > 0 {
        // 并发引导已落意图：交给它（或下一次重跑）收敛。
        return Ok(None);
    }
    let parameters = json!({
        "tenantId": tenant,
        "featureKey": key,
        "limitPerPeriod": feature.default_limit,
        "origin": ORIGIN_DEFAULT,
        "attempt": rejected,
        "source": "platform.bootstrap",
    });
    let urn = format!("urn:platform:tenant:{tenant}:default-quota:{key}:{rejected}");
    let ikey = urn_key(&urn);
    let target = ("TENANT", tenant);
    let action = bootstrap_action(&mut tx, tenant, initiator, ikey, target, &parameters).await?;
    sqlx::query(
        "insert into admission.tenant_quota_intent
             (action_execution_id, tenant_id, feature_key, limit_per_period, origin,
              openmeter_namespace, openmeter_customer_id)
         values ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(action)
    .bind(tenant)
    .bind(key)
    .bind(feature.default_limit)
    .bind(ORIGIN_DEFAULT)
    .bind(openmeter.namespace())
    .bind(customer)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    let intent = lock_intent(&mut tx, action)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("默认额度意图未落库")?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(Some(intent))
}

async fn settle_default(
    pool: &PgPool,
    intent: &Intent,
    target: (&str, Uuid),
    applied: Applied,
    key: &str,
) -> Result<(), String> {
    let action = intent.action_execution_id;
    let (outcome, entitlement, result) = match &applied {
        Applied::Verified(entitlement) => (
            "VERIFIED",
            Some(entitlement.id.as_str()),
            ("ALLOW", "TENANT_QUOTA_DEFAULT_SET"),
        ),
        Applied::Superseded => ("SUPERSEDED", None, ("ALLOW", "TENANT_QUOTA_SUPERSEDED")),
        Applied::Rejected(_) => ("REJECTED", None, ("DENY", "TENANT_QUOTA_REJECTED")),
        Applied::Unknown => return Err(format!("默认额度 {key} 结果不明；重跑只对账，不重写")),
    };
    let started = if outcome == "REJECTED" {
        Err(StatusCode::CONFLICT)
    } else {
        Ok(())
    };
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    settle_intent(&mut tx, action, outcome, entitlement)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    bootstrap_settle(pool, action, target, started, Some(result)).await?;
    if let Applied::Rejected(reason) = applied {
        let code = governance::wire(&reason);
        return Err(format!("默认额度 {key} 被拒绝（{code}），重跑另起意图"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::openmeter::{EntitlementPeriod, NativeIssue, NativeUsagePeriod};

    const NATIVE_ID: &str = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

    fn definition() -> Definition {
        Definition {
            action_key: ACTION.into(),
            version: 1,
            component_type_key: "core".into(),
            target_type: "TENANT".into(),
            tenant_rule: "SESSION_TENANT".into(),
            workspace_rule: "TENANT_ONLY".into(),
            permission: "manage".into(),
            permission_object_type: "tenant".into(),
            confirmation_mode: "EXPLICIT".into(),
            approval_policy_id: None,
            approval_policy_version: None,
            workflow_kind: None,
            result_exposure: "NONE".into(),
            execution_mode: "SYNC".into(),
            quota_policy: "NONE".into(),
            meters: Vec::new(),
            role_template_key: None,
            role_template_version: None,
        }
    }

    fn entitlement(intent: Uuid, limit: f64) -> NativeEntitlement {
        let mut metadata = BTreeMap::new();
        metadata.insert(INTENT_METADATA_KEY.to_owned(), intent.to_string());
        NativeEntitlement {
            id: NATIVE_ID.into(),
            kind: "metered".into(),
            feature_key: "agent_tokens".into(),
            customer_id: None,
            is_soft_limit: Some(false),
            issue: Some(NativeIssue { amount: limit }),
            issue_after_reset: Some(limit),
            usage_period: Some(NativeUsagePeriod {
                interval: Some("MONTH".into()),
                interval_iso: Some("P1M".into()),
                anchor: None,
            }),
            current_usage_period: None,
            metadata: Some(metadata),
            deleted_at: None,
        }
    }

    #[test]
    fn default_table_matches_dd123() {
        let defaults: Vec<(&str, &str, i64)> = PLATFORM_FEATURES
            .iter()
            .map(|feature| (feature.key, feature.meter, feature.default_limit))
            .collect();
        assert_eq!(
            defaults,
            vec![
                ("agent_tokens", "agent_total_tokens", 10_000_000),
                ("automation_runs", "automation_run", 10_000),
                ("agent_memory_writes", "agent_memory_write_count", 100_000),
            ]
        );
        for feature in &PLATFORM_FEATURES {
            assert_eq!(feature_key(&feature.quota), feature.key);
            assert!(PLATFORM_METERS.iter().any(|m| m.key == feature.meter));
        }
        let mut event_types: Vec<&str> = PLATFORM_METERS.iter().map(|m| m.event_type).collect();
        event_types.sort_unstable();
        event_types.dedup();
        assert_eq!(event_types.len(), PLATFORM_METERS.len());
    }

    #[test]
    fn platform_meters_satisfy_core_consumer_shapes() {
        let body = |key: &str| {
            PLATFORM_METERS
                .iter()
                .find(|meter| meter.key == key)
                .map(meter_request)
                .unwrap_or_default()
        };
        assert_eq!(body(AGENT_TOKENS_METER)["value_property"], "$.totalTokens");
        assert_eq!(body(AGENT_TOKENS_METER)["aggregation"], "sum");
        assert!(body(AUTOMATION_RUN_METER).get("value_property").is_none());
        assert_eq!(body(AUTOMATION_RUN_METER)["aggregation"], "count");
        assert_eq!(
            body(MEMORY_BYTES_METER)["value_property"],
            "$.plaintext_bytes"
        );
        assert_eq!(body(MEMORY_READ_METER)["aggregation"], "count");
        assert_eq!(body(MEMORY_WRITE_METER)["aggregation"], "count");
    }

    #[test]
    fn entitlement_request_is_monthly_hard_limit_with_intent_metadata() {
        let intent = Uuid::new_v4();
        let anchor = month_start(Utc::now());
        let body = entitlement_request("agent_tokens", 42, anchor, intent, ORIGIN_SET);
        assert_eq!(body["type"], "metered");
        assert_eq!(body["featureKey"], "agent_tokens");
        assert_eq!(body["isSoftLimit"], false);
        assert_eq!(body["usagePeriod"]["interval"], "MONTH");
        assert_eq!(body["measureUsageFrom"], "CURRENT_PERIOD_START");
        assert_eq!(body["issue"]["amount"], 42);
        assert_eq!(body["metadata"][INTENT_METADATA_KEY], intent.to_string());
        assert_eq!(body["metadata"][ORIGIN_METADATA_KEY], "SET");
        assert_eq!(anchor.day(), 1);
        assert_eq!(anchor.timestamp() % 86_400, 0);
    }

    #[test]
    fn readback_requires_exact_intent_hard_monthly_limit() {
        let intent = Uuid::new_v4();
        assert!(matches_intent(&entitlement(intent, 42.0), intent, 42));
        assert!(!matches_intent(&entitlement(intent, 42.0), intent, 41));
        let foreign = entitlement(Uuid::new_v4(), 42.0);
        assert!(!matches_intent(&foreign, intent, 42));
        let mut soft = entitlement(intent, 42.0);
        soft.is_soft_limit = Some(true);
        assert!(!matches_intent(&soft, intent, 42));
        let mut daily = entitlement(intent, 42.0);
        daily.usage_period = Some(NativeUsagePeriod {
            interval: Some("DAY".into()),
            interval_iso: Some("P1D".into()),
            anchor: None,
        });
        assert!(!matches_intent(&daily, intent, 42));
        assert_eq!(issued_limit(&entitlement(intent, 1.5)), None);
        assert_eq!(issued_limit(&entitlement(intent, -1.0)), None);
    }

    #[test]
    fn classify_never_treats_absence_as_a_reason_to_rewrite() {
        let intent = Uuid::new_v4();
        assert_eq!(classify(Vec::new(), intent, 42), Observed::Absent);
        let other = entitlement(Uuid::new_v4(), 42.0);
        assert_eq!(classify(vec![other], intent, 42), Observed::Absent);
        let ours = entitlement(intent, 42.0);
        let verified = Observed::Verified(Box::new(ours.clone()));
        assert_eq!(classify(vec![ours.clone()], intent, 42), verified);
        let mut replaced = ours.clone();
        replaced.deleted_at = Some(Utc::now());
        assert_eq!(classify(vec![replaced], intent, 42), Observed::Superseded);
        let twice = vec![ours.clone(), ours];
        assert_eq!(classify(twice, intent, 42), Observed::Inconsistent);
    }

    #[test]
    fn definite_native_refusals_keep_stable_reason_codes() {
        let reason = |error| rejection_reason(&error);
        assert_eq!(
            reason(openmeter::Error::Conflict),
            ReasonCode::TargetStateConflict
        );
        assert_eq!(reason(openmeter::Error::Limit), ReasonCode::RateLimited);
        assert_eq!(
            reason(openmeter::Error::Denied),
            ReasonCode::DependencyUnavailable
        );
        assert_eq!(
            reason(openmeter::Error::Precondition),
            ReasonCode::DependencyUnavailable
        );
    }

    #[test]
    fn setting_is_closed_and_bounded() {
        let parse = |limit: i64| {
            normalize(&contracts::TenantQuotaSettingClass {
                feature: TenantQuotaFeature::AutomationRuns,
                limit_per_period: limit,
            })
        };
        let zero = json!({"feature": "automation_runs", "limitPerPeriod": 0});
        assert_eq!(parse(0).ok(), Some(zero));
        assert!(parse(MAX_LIMIT).is_ok());
        assert!(parse(-1).is_err());
        assert!(parse(MAX_LIMIT + 1).is_err());
    }

    #[test]
    fn catalog_shape_is_exactly_dd123() {
        assert!(definition_shape(&definition()));
        let mut approval = definition();
        approval.confirmation_mode = "APPROVAL".into();
        assert!(!definition_shape(&approval));
        let mut quota = definition();
        quota.quota_policy = "CHECK".into();
        assert!(!definition_shape(&quota));
        let mut audit = definition();
        audit.permission = "audit".into();
        assert!(!definition_shape(&audit));
    }

    #[test]
    fn quota_view_shows_native_values_without_inventing_limits() {
        let none = quota_view(TenantQuotaFeature::AgentTokens, None, None);
        assert!(!none.has_access && none.hard_limit);
        assert_eq!(none.limit_per_period, None);
        assert_eq!(none.usage, None);
        let mut native = entitlement(Uuid::new_v4(), 10.0);
        let reset = Utc::now();
        native.current_usage_period = Some(EntitlementPeriod { to: reset });
        let value = NativeEntitlementValue {
            has_access: false,
            usage: Some(12.0),
        };
        let feature = TenantQuotaFeature::AgentTokens;
        let view = quota_view(feature, Some(&native), Some(&value));
        assert_eq!(view.limit_per_period, Some(10));
        assert_eq!(view.usage, Some(12.0));
        assert!(view.hard_limit && !view.has_access);
        let expected = reset.to_rfc3339_opts(SecondsFormat::Secs, true);
        assert_eq!(view.period_reset_at, Some(expected));
    }

    #[test]
    fn only_tenant_managers_get_the_set_entry() {
        // Tenant admin：fresh tenant manage 成立，页面带唯一设置入口。
        let admin = TenantQuotaPage {
            quotas: Vec::new(),
            set_action_key: set_action_key(true),
        };
        let admin = serde_json::to_value(admin).unwrap_or_default();
        assert_eq!(admin["setActionKey"], ACTION);
        // Auditor：只有 audit 而无 manage，只读额度，不得到入口字段。
        let auditor = TenantQuotaPage {
            quotas: Vec::new(),
            set_action_key: set_action_key(false),
        };
        let auditor = serde_json::to_value(auditor).unwrap_or_default();
        assert!(auditor.get("setActionKey").is_none());
        assert_eq!(auditor["quotas"], json!([]));
    }

    #[test]
    fn existing_native_objects_are_compared_not_rewritten() {
        let meter = &PLATFORM_METERS[0];
        let shape = |key: &str, event: &str| MeterShape {
            id: NATIVE_ID.into(),
            key: key.into(),
            aggregation: meter.aggregation.into(),
            event_type: event.into(),
            value_property: meter.value_property.map(str::to_owned),
            dimensions: meter_dimensions(meter),
        };
        assert_eq!(meter_registration(&[], meter), Registration::Absent);
        let exact = [shape(meter.key, meter.event_type)];
        let registered = Registration::Registered(NATIVE_ID.into());
        assert_eq!(meter_registration(&exact, meter), registered);
        let taken = [shape("legacy_tokens", meter.event_type)];
        assert!(matches!(
            meter_registration(&taken, meter),
            Registration::Conflict(_)
        ));
        let drifted = [shape(meter.key, "other.event")];
        assert!(matches!(
            meter_registration(&drifted, meter),
            Registration::Conflict(_)
        ));
        let feature = |meter_id: &str, filtered: bool| FeatureShape {
            id: NATIVE_ID.into(),
            meter_id: Some(meter_id.into()),
            filtered,
        };
        assert_eq!(feature_registration(&[], "m"), Registration::Absent);
        let linked = [feature("m", false)];
        assert!(matches!(
            feature_registration(&linked, "m"),
            Registration::Registered(_)
        ));
        let other = [feature("other", false)];
        assert!(matches!(
            feature_registration(&other, "m"),
            Registration::Conflict(_)
        ));
        let filtered = [feature("m", true)];
        assert!(matches!(
            feature_registration(&filtered, "m"),
            Registration::Conflict(_)
        ));
    }
}
