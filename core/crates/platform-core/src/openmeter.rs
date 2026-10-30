//! DD-37/38：固定 namespace 的原生 Customer 接入，不建立本地余额或用量账本。
//! 传输配置只来自受控部署；Customer key 只来自 Core Tenant ID。

use chrono::{DateTime, Utc};
use reqwest::{header, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fmt::Write as _;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("OpenMeter 拒绝 Core service 身份")]
    Denied,
    #[error("OpenMeter 原生前置条件不成立")]
    Precondition,
    #[error("OpenMeter Customer 归属冲突")]
    Conflict,
    #[error("OpenMeter 原生背压")]
    Limit,
    #[error("OpenMeter 结果无法查证")]
    Unknown,
}

/// 原生 v3 BillingCustomer 的引用投影；不持久化账单、联系人或其他正文。
#[derive(Deserialize)]
pub struct Customer {
    pub id: String,
    pub key: String,
    pub deleted_at: Option<DateTime<Utc>>,
    usage_attribution: Option<UsageAttribution>,
}

#[derive(Deserialize)]
struct UsageAttribution {
    subject_keys: Vec<String>,
}

impl Customer {
    pub fn is_active(&self) -> bool {
        self.deleted_at.is_none()
    }

    pub fn is_deleted(&self) -> bool {
        self.deleted_at.is_some_and(|at| at < Utc::now())
    }

    fn validate(self, tenant: Uuid, expected_id: Option<&str>) -> Result<Self, Error> {
        // 原生 customerId 是 ULID；路径段不能由任意响应字符串构造。
        if !valid_customer_id(&self.id)
            || self.key != tenant.to_string()
            || expected_id.is_some_and(|id| id != self.id)
        {
            return Err(Error::Conflict);
        }
        Ok(self)
    }
}

fn valid_customer_id(id: &str) -> bool {
    id.len() == 26
        && id.as_bytes()[0] <= b'7'
        && id
            .bytes()
            .all(|b| b"0123456789ABCDEFGHJKMNPQRSTVWXYZ".contains(&b))
}

#[derive(Deserialize)]
struct CustomerPage {
    data: Vec<Customer>,
    meta: PageMeta,
}

#[derive(Deserialize)]
struct Collection<T> {
    data: Vec<T>,
    meta: PageMeta,
}

#[derive(Deserialize)]
struct Meter {
    id: String,
    key: String,
    deleted_at: Option<DateTime<Utc>>,
    aggregation: String,
    event_type: String,
    value_property: Option<String>,
    dimensions: Option<BTreeMap<String, String>>,
}

/// 原生 Meter 的最小不可变准入投影；数量只来自 durable Gateway 字段。
#[derive(Serialize, Deserialize, PartialEq)]
pub(crate) struct GatewayMeter {
    pub key: String,
    pub id: String,
    pub event_type: String,
    pub value_property: String,
}

/// DD-107：automation.run 只计真实 AgentInvocation，不计模型 HTTP 请求数量。
#[derive(Serialize, Deserialize, PartialEq)]
pub(crate) struct InvocationMeter {
    pub key: String,
    pub id: String,
    pub event_type: String,
}

impl InvocationMeter {
    /// Only the registered Automation action has invocation COUNT usage. A
    /// normal Agent turn still has its native model SUM meters, not a fabricated
    /// automation run. Unknown actions cannot use absence as an exemption.
    pub(crate) fn for_action(action: &str, meter: Option<Self>) -> Result<Option<Self>, Error> {
        match (action, meter) {
            ("automation.run", Some(meter)) if meter.key == "automation.run" => Ok(Some(meter)),
            ("agent.invoke", None) => Ok(None),
            _ => Err(Error::Precondition),
        }
    }
}

/// 19 §6 的两个已定 HUMAN-read meter；配置与 ID 只取原生 OpenMeter。
#[derive(Serialize, Deserialize, PartialEq)]
pub(crate) struct MemoryMeter {
    pub key: String,
    pub id: String,
    pub event_type: String,
    pub value_property: Option<String>,
}

/// Frozen native projection for an ApplicationBinding execution. No locally
/// invented meter, balance or aggregation is accepted.
#[derive(Serialize, Deserialize, PartialEq)]
pub(crate) struct ApplicationMeter {
    pub key: String,
    pub id: String,
    pub event_type: String,
    pub value_property: Option<String>,
}

#[derive(Deserialize)]
struct StoredEventPage {
    data: Vec<StoredEvent>,
    meta: CursorMeta,
}

#[derive(Deserialize)]
struct CursorMeta {
    page: CursorPage,
}

#[derive(Deserialize)]
struct CursorPage {
    next: Option<String>,
}

#[derive(Deserialize)]
struct StoredEvent {
    event: Value,
    stored_at: DateTime<Utc>,
    validation_errors: Option<Vec<Value>>,
}

pub(crate) struct StoredEvidence {
    pub stored_at: DateTime<Utc>,
    pub configuration_warning: bool,
}

/// The only `datacontenttype` the CloudEvents JSON format assumes when the
/// attribute is absent, and the only one fixed OpenMeter v3 reads back.
const JSON_DATA_CONTENT_TYPE: &str = "application/json";

/// DD-08：投递 OpenMeter 的线上形态是冻结 CloudEvent 的确定投影。`data` 中值为
/// null 的成员表示该维度不适用（如 Tenant 级 binding 没有 Workspace）；原生 v3
/// `MeteringEvent.data` 的成员不可为 null，ingest 请求校验会以 400 确定拒绝整条
/// 事件，因此不上送，meter 对缺省维度原生取空值。冻结体不改写：每次重试都是
/// 同一 source/id 与同一投影体，stored 查证也按同一投影比对。
fn wire_event(frozen: &Value) -> Value {
    let mut wire = frozen.clone();
    if let Some(data) = wire.get_mut("data").and_then(Value::as_object_mut) {
        data.retain(|_, value| !value.is_null());
    }
    wire
}

/// 投递被拒时最多读取的原生问题响应字节数，以及摘要中每项文本与参数的上限。
const PROBLEM_BODY_LIMIT: usize = 16 * 1024;
const PROBLEM_TEXT_LIMIT: usize = 160;
const PROBLEM_PARAMETER_LIMIT: usize = 4;

/// 原生问题响应（v3 apierrors）的可记录摘要：只取 `title` 与 invalid parameter 的
/// field/rule/原因首行并逐项截断；不取 `detail`、`instance`，也不复述请求或响应
/// 中的值（原生原因的后续行会带出被拒的值）。
fn problem_summary(body: &[u8]) -> String {
    #[derive(Deserialize)]
    struct Parameter {
        #[serde(default)]
        field: String,
        #[serde(default)]
        rule: Option<String>,
        #[serde(default)]
        reason: String,
    }
    #[derive(Deserialize)]
    struct Problem {
        #[serde(default)]
        title: String,
        #[serde(default)]
        invalid_parameters: Vec<Parameter>,
    }
    fn clip(text: &str) -> String {
        text.lines()
            .next()
            .unwrap_or_default()
            .chars()
            .take(PROBLEM_TEXT_LIMIT)
            .collect()
    }
    let Ok(problem) = serde_json::from_slice::<Problem>(body) else {
        return format!("non-problem body ({} bytes)", body.len());
    };
    let mut summary = format!("title={}", clip(&problem.title));
    for parameter in problem
        .invalid_parameters
        .iter()
        .take(PROBLEM_PARAMETER_LIMIT)
    {
        let _ = write!(
            summary,
            "; field={} rule={} reason={}",
            clip(&parameter.field),
            clip(parameter.rule.as_deref().unwrap_or_default()),
            clip(&parameter.reason)
        );
    }
    let omitted = problem
        .invalid_parameters
        .len()
        .saturating_sub(PROBLEM_PARAMETER_LIMIT);
    if omitted > 0 {
        let _ = write!(summary, "; +{omitted} more");
    }
    summary
}

/// 只读取问题响应的前 `PROBLEM_BODY_LIMIT` 字节；读取失败时只用已读部分。
async fn bounded_body(response: &mut reqwest::Response) -> Vec<u8> {
    let mut body = Vec::new();
    while body.len() < PROBLEM_BODY_LIMIT {
        match response.chunk().await {
            Ok(Some(chunk)) => body.extend_from_slice(&chunk),
            _ => break,
        }
    }
    body.truncate(PROBLEM_BODY_LIMIT);
    body
}

/// Compares the frozen outbox CloudEvent with the event OpenMeter reads back.
///
/// Two read-time projections of the fixed native version are not stored facts:
/// - `time`: createEventsTable::toSQL keeps a ClickHouse DateTime (seconds) and
///   the query encoder spells RFC3339 UTC differently. Compare at the native
///   precision; the outbox occurred_at/body keep the first native completion
///   time and retries never rewrite it.
/// - `datacontenttype`: toAPIMeteringIngestedEvent does not persist it and
///   derives `application/json` for every event that carries data. The
///   CloudEvents JSON format reads an absent attribute as that same type, so
///   both sides are compared on their effective content type; an explicit
///   non-JSON type still conflicts.
/// - null `data` members: never sent (`wire_event`, DD-08), so the frozen side
///   is compared in the same wire projection.
///
/// Every other attribute and the whole `data` object must match exactly.
fn same_stored_event(expected: &Value, actual: Value) -> Result<(), Error> {
    let expected_time = expected
        .get("time")
        .and_then(Value::as_str)
        .and_then(|time| DateTime::parse_from_rfc3339(time).ok())
        .ok_or(Error::Precondition)?;
    let stored_time = actual
        .get("time")
        .and_then(Value::as_str)
        .and_then(|time| DateTime::parse_from_rfc3339(time).ok())
        .ok_or(Error::Conflict)?;
    let Value::Object(mut actual) = actual else {
        return Err(Error::Conflict);
    };
    let Value::Object(mut frozen) = wire_event(expected) else {
        return Err(Error::Precondition);
    };
    for event in [&mut actual, &mut frozen] {
        event.remove("time");
        if event.get("data").is_some_and(|data| !data.is_null()) {
            event
                .entry("datacontenttype")
                .or_insert_with(|| Value::from(JSON_DATA_CONTENT_TYPE));
        }
    }
    if stored_time.timestamp() != expected_time.timestamp()
        || stored_time.timestamp_subsec_nanos() != 0
        || actual != frozen
    {
        return Err(Error::Conflict);
    }
    Ok(())
}

/// 仅本次 HTTP 调用期间持有原生可写字段，不序列化或持久化 Customer 正文。
/// digest 绑定 namespace/Customer/完整期望字段，供已有 AE 派发阶段对账。
pub(crate) struct SubjectProjection {
    tenant: Uuid,
    customer_id: String,
    subject: String,
    body: Value,
    needs_write: bool,
}

impl SubjectProjection {
    pub(crate) fn needs_write(&self) -> bool {
        self.needs_write
    }

    pub(crate) fn digest(&self, namespace: &str) -> Result<String, Error> {
        let projection = serde_json::json!({"namespace": namespace,
            "customerId": self.customer_id, "body": self.body});
        let bytes = serde_json::to_vec(&projection).map_err(|_| Error::Unknown)?;
        Ok(hex::encode(Sha256::digest(bytes)))
    }
}

/// 固定 native v1 CustomerReplaceUpdate 的可写字段。未知字段或不可回写的
/// annotations 拒绝；不能借 v3 labels 的有损转换抹掉原生系统事实。
fn subject_body(native: Value, tenant: Uuid, id: &str) -> Result<Value, Error> {
    let object = native.as_object().ok_or(Error::Unknown)?;
    if object.get("id").and_then(Value::as_str) != Some(id)
        || object.get("key").and_then(Value::as_str) != Some(tenant.to_string().as_str())
        || object.get("deletedAt").is_some_and(|v| !v.is_null())
        || object.keys().any(|key| {
            !matches!(
                key.as_str(),
                "id" | "key"
                    | "name"
                    | "description"
                    | "metadata"
                    | "usageAttribution"
                    | "primaryEmail"
                    | "currency"
                    | "billingAddress"
                    | "createdAt"
                    | "updatedAt"
                    | "deletedAt"
                    | "annotations"
                    | "currentSubscriptionId"
                    | "subscriptions"
            )
        })
    {
        return Err(Error::Conflict);
    }
    if object.get("annotations").is_some_and(|v| {
        !v.is_null()
            && !v
                .as_object()
                .is_some_and(|annotations| annotations.is_empty())
    }) {
        return Err(Error::Precondition);
    }
    let mut body = serde_json::Map::new();
    for key in [
        "key",
        "name",
        "description",
        "metadata",
        "primaryEmail",
        "currency",
        "billingAddress",
    ] {
        let value = object.get(key).filter(|v| !v.is_null());
        if matches!(key, "key" | "name") && value.is_none() {
            return Err(Error::Unknown);
        }
        if let Some(value) = value {
            let valid = match key {
                "metadata" => value
                    .as_object()
                    .is_some_and(|fields| fields.values().all(Value::is_string)),
                "billingAddress" => value.as_object().is_some_and(|fields| {
                    fields.iter().all(|(key, value)| {
                        matches!(
                            key.as_str(),
                            "city"
                                | "country"
                                | "line1"
                                | "line2"
                                | "phoneNumber"
                                | "postalCode"
                                | "state"
                        ) && (value.is_null() || value.is_string())
                    })
                }),
                _ => value.is_string(),
            };
            if !valid || key == "name" && value.as_str().is_none_or(str::is_empty) {
                return Err(Error::Precondition);
            }
            if key == "billingAddress" {
                // Native encoder omits nil address components after a replace.
                let fields = value
                    .as_object()
                    .ok_or(Error::Unknown)?
                    .iter()
                    .filter(|(_, value)| !value.is_null())
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect();
                body.insert(key.into(), Value::Object(fields));
            } else if key != "metadata"
                || !value.as_object().is_some_and(|fields| fields.is_empty())
            {
                body.insert(key.into(), value.clone());
            }
        }
    }
    let mut subjects = Vec::new();
    if let Some(attribution) = object.get("usageAttribution").filter(|v| !v.is_null()) {
        let attribution = attribution.as_object().ok_or(Error::Unknown)?;
        if attribution.keys().any(|key| key != "subjectKeys") {
            return Err(Error::Precondition);
        }
        let keys = attribution.get("subjectKeys").ok_or(Error::Unknown)?;
        if !keys.is_null() {
            for key in keys.as_array().ok_or(Error::Unknown)? {
                let key = key
                    .as_str()
                    .filter(|key| !key.is_empty())
                    .ok_or(Error::Unknown)?;
                if !key.starts_with(&format!("{tenant}:")) || subjects.iter().any(|old| old == key)
                {
                    return Err(Error::Conflict);
                }
                subjects.push(key.to_owned());
            }
        }
    }
    subjects.sort_unstable();
    body.insert(
        "usageAttribution".into(),
        serde_json::json!({"subjectKeys": subjects}),
    );
    Ok(Value::Object(body))
}

#[derive(Deserialize)]
struct Feature {
    id: String,
    key: String,
    deleted_at: Option<DateTime<Utc>>,
    meter: Option<FeatureMeter>,
}

#[derive(Deserialize)]
struct FeatureMeter {
    id: String,
    filters: Option<BTreeMap<String, serde_json::Value>>,
}

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum EntitlementType {
    Metered,
    Static,
    Boolean,
}

#[derive(Deserialize)]
struct EntitlementAccess {
    #[serde(rename = "type")]
    kind: EntitlementType,
    feature_key: String,
    has_access: bool,
    value: Option<CreditValue>,
}

#[derive(Deserialize)]
struct EntitlementAccessList {
    data: Vec<EntitlementAccess>,
}

#[derive(Deserialize)]
struct CreditValue {
    balance: String,
    usage: String,
    overage: String,
    total_available_grant_amount: String,
    grant_balances: BTreeMap<String, String>,
}

impl CreditValue {
    fn valid(&self) -> bool {
        // 原生 Numeric 是十进制字符串；这里只校验真实响应，不计算或复制余额。
        [
            &self.balance,
            &self.usage,
            &self.overage,
            &self.total_available_grant_amount,
        ]
        .into_iter()
        .chain(self.grant_balances.values())
        .all(|value| valid_numeric(value))
    }
}

/// 原生 Numeric 的十进制字符串形状；只校验，不换算成浮点或另算余额。
fn valid_numeric(value: &str) -> bool {
    let decimal = value.strip_prefix('-').unwrap_or(value);
    let mut parts = decimal.split('.');
    let integer = parts.next().unwrap_or_default();
    let fraction = parts.next();
    !integer.is_empty()
        && integer.bytes().all(|b| b.is_ascii_digit())
        && fraction.is_none_or(|f| !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()))
        && parts.next().is_none()
}

/// `.design/11` §7：一个已登记 meter 在区间内的原生 committed usage 结论。
pub(crate) enum MeterUsage {
    Committed {
        aggregation: String,
        quantity: String,
    },
    NoCommittedUsage {
        aggregation: String,
    },
    WorkspaceDimensionUnavailable {
        aggregation: String,
    },
    NotRegistered,
}

/// DD-165(4)：一个已登记 meter 在区间内按一个维度分行的原生 committed usage。
/// 行值保持 OpenMeter 十进制原文；缺该维度的行（事件未带该维度）单独不计入任何分组。
pub(crate) enum GroupedUsage {
    Committed {
        aggregation: String,
        rows: Vec<(String, String)>,
    },
    NotRegistered,
}

/// 原生 entitlement-access 的读取投影；数值保持 OpenMeter 十进制原文。
pub(crate) struct EntitlementFact {
    pub feature_key: String,
    pub kind: &'static str,
    pub has_access: bool,
    pub balance: Option<String>,
    pub usage: Option<String>,
    pub overage: Option<String>,
}

/// 原生 standard invoice 的读取投影；status 原文由页面按已知值呈现。
pub(crate) struct InvoiceFact {
    pub id: String,
    pub number: Option<String>,
    pub status: String,
    pub currency: Option<String>,
    pub total: Option<String>,
    pub service_period: Option<(String, String)>,
    pub issued_at: Option<String>,
}

/// DD-123：v2 Customer entitlement 的只读投影。数值保持原生，Core 不复制余额或用量。
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeEntitlement {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub feature_key: String,
    pub customer_id: Option<String>,
    pub is_soft_limit: Option<bool>,
    pub issue: Option<NativeIssue>,
    pub issue_after_reset: Option<f64>,
    pub usage_period: Option<NativeUsagePeriod>,
    pub current_usage_period: Option<EntitlementPeriod>,
    pub metadata: Option<BTreeMap<String, String>>,
    pub deleted_at: Option<DateTime<Utc>>,
}

impl NativeEntitlement {
    /// 原生 ID 是 ULID；路径与归属只接受请求的 Customer 与 feature key。
    fn validate(self, customer_id: &str, feature_key: &str) -> Result<Self, Error> {
        if !valid_customer_id(&self.id)
            || self.feature_key != feature_key
            || self
                .customer_id
                .as_deref()
                .is_some_and(|id| id != customer_id)
        {
            return Err(Error::Conflict);
        }
        Ok(self)
    }
}

#[derive(Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct NativeIssue {
    pub amount: f64,
}

#[derive(Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct NativeUsagePeriod {
    pub interval: Option<String>,
    #[serde(rename = "intervalISO")]
    pub interval_iso: Option<String>,
    pub anchor: Option<DateTime<Utc>>,
}

/// 当前周期：结束时刻是下一次按月重置；开始时刻供 DD-165 成员用量按同一周期查询。
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct EntitlementPeriod {
    #[serde(default)]
    pub from: Option<DateTime<Utc>>,
    pub to: DateTime<Utc>,
}

/// v2 entitlement value：只读展示，不据此另算余额。
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeEntitlementValue {
    /// OpenMeter v2 serializes `hasAccess` with `omitempty`
    /// (openmeter/entitlement/snapshot/event.go): an exhausted entitlement omits it.
    #[serde(default)]
    pub has_access: bool,
    pub usage: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntitlementPage {
    total_count: u64,
    page: u64,
    page_size: u64,
    items: Vec<NativeEntitlement>,
}

/// v2 entitlement 列表的单页请求条数；读取总是翻到底。
const ENTITLEMENT_PAGE_SIZE: u64 = 100;

/// 部署引导比对固定平台 meter 所需的原生字段（DD-123）。
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct MeterShape {
    pub id: String,
    pub key: String,
    pub aggregation: String,
    pub event_type: String,
    pub value_property: Option<String>,
    pub dimensions: BTreeMap<String, String>,
}

/// 部署引导比对固定平台 feature 所需的原生字段（DD-123）。
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FeatureShape {
    pub id: String,
    pub meter_id: Option<String>,
    pub filtered: bool,
}

#[derive(Deserialize)]
struct MeterQueryResult {
    data: Vec<MeterQueryRow>,
}

#[derive(Deserialize)]
struct MeterQueryRow {
    value: String,
    dimensions: BTreeMap<String, String>,
}

#[derive(Deserialize)]
struct NativeInvoice {
    id: String,
    number: Option<String>,
    status: String,
    currency: Option<String>,
    totals: Option<NativeInvoiceTotals>,
    service_period: Option<NativePeriod>,
    issued_at: Option<String>,
}

#[derive(Deserialize)]
struct NativeInvoiceTotals {
    total: String,
}

#[derive(Deserialize)]
struct NativePeriod {
    from: String,
    to: String,
}

fn valid_resource_key(key: &str) -> bool {
    !key.is_empty()
        && !key.starts_with('_')
        && !key.ends_with('_')
        && !key.contains("__")
        && key
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

fn valid_meter_key(key: &str) -> bool {
    // 此处是平台语义 selector。automation.run 通过显式部署映射解析到
    // v3 ResourceKey；原生 ID、event_type 与唯一性仍逐次查证。
    !key.is_empty()
}

pub(crate) fn configured_automation_native_meter_key() -> Result<Option<String>, String> {
    match std::env::var("AUTOMATION_RUN_NATIVE_METER_KEY") {
        Err(std::env::VarError::NotPresent) => Ok(None),
        Ok(value) if value.is_empty() => Ok(None),
        Ok(value) if valid_resource_key(&value) => Ok(Some(value)),
        _ => Err("AUTOMATION_RUN_NATIVE_METER_KEY 必须是原生 v3 ResourceKey".into()),
    }
}

fn native_meter_key<'a>(key: &'a str, automation: Option<&'a str>) -> Result<&'a str, Error> {
    if key == "automation.run" {
        automation
            .filter(|key| valid_resource_key(key))
            .ok_or(Error::Precondition)
    } else if automation == Some(key) {
        // 同一个原生 COUNT 不能再以模型 SUM selector 重复登记。
        Err(Error::Precondition)
    } else {
        Ok(key)
    }
}

#[derive(Deserialize)]
struct PageMeta {
    page: Page,
}

#[derive(Deserialize)]
struct Page {
    number: u64,
    size: u64,
    total: u64,
}

pub struct OpenMeter {
    http: reqwest::Client,
    customers: Url,
    namespace: String,
    automation_native_meter_key: Option<String>,
}

impl OpenMeter {
    pub fn from_env() -> Result<Self, String> {
        let address =
            std::env::var("OPENMETER_CUSTOMERS_URL").map_err(|_| "缺少 OPENMETER_CUSTOMERS_URL")?;
        let mut customers =
            Url::parse(&address).map_err(|_| "OPENMETER_CUSTOMERS_URL 不是有效 URL")?;
        if !matches!(customers.scheme(), "http" | "https")
            || customers.host_str().is_none()
            || !customers.username().is_empty()
            || customers.password().is_some()
            || customers.query().is_some()
            || customers.fragment().is_some()
            || !customers
                .path()
                .trim_end_matches('/')
                .ends_with("/customers")
        {
            return Err(
                "OPENMETER_CUSTOMERS_URL 必须为无凭据和查询的原生 Customer 集合 URL".into(),
            );
        }
        let path = customers.path().trim_end_matches('/').to_owned();
        customers.set_path(&path);
        let namespace =
            std::env::var("OPENMETER_NAMESPACE").map_err(|_| "缺少 OPENMETER_NAMESPACE")?;
        if namespace.is_empty()
            || namespace
                .chars()
                .any(|c| c.is_whitespace() || c.is_control())
        {
            return Err("OPENMETER_NAMESPACE 必须是固定非空 namespace".into());
        }
        let seconds: u64 = std::env::var("OPENMETER_HTTP_TIMEOUT_SECONDS")
            .map_err(|_| "缺少 OPENMETER_HTTP_TIMEOUT_SECONDS")?
            .parse()
            .map_err(|_| "OPENMETER_HTTP_TIMEOUT_SECONDS 必须为正整数秒")?;
        if seconds == 0 {
            return Err("OPENMETER_HTTP_TIMEOUT_SECONDS 必须为正整数秒".into());
        }
        let token_file = std::env::var("OPENMETER_CORE_TOKEN_FILE")
            .map_err(|_| "缺少 OPENMETER_CORE_TOKEN_FILE")?;
        let token = std::fs::read_to_string(token_file)
            .map_err(|_| "OpenMeter Core credential 不可读取")?;
        let token = token.trim();
        if token.is_empty() || token.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err("OpenMeter Core credential 无效".into());
        }
        let mut authorization = header::HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|_| "OpenMeter Core credential 不能编码为认证 header")?;
        authorization.set_sensitive(true);
        let mut headers = header::HeaderMap::new();
        headers.insert(header::AUTHORIZATION, authorization);
        let http = reqwest::Client::builder()
            .default_headers(headers)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(seconds))
            .build()
            .map_err(|_| "OpenMeter HTTP client 构造失败")?;
        Ok(Self {
            http,
            customers,
            namespace,
            automation_native_meter_key: configured_automation_native_meter_key()?,
        })
    }

    pub fn namespace(&self) -> &str {
        &self.namespace
    }

    fn customer_url(&self, id: &str) -> Result<Url, Error> {
        if !valid_customer_id(id) {
            return Err(Error::Conflict);
        }
        let mut url = self.customers.clone();
        url.path_segments_mut()
            .map_err(|_| Error::Unknown)?
            .push(id);
        Ok(url)
    }

    fn legacy_customer_url(&self, id: &str) -> Result<Url, Error> {
        if !valid_customer_id(id) {
            return Err(Error::Conflict);
        }
        let prefix = self
            .customers
            .path()
            .strip_suffix("/api/v3/openmeter/customers")
            .ok_or(Error::Precondition)?;
        let mut url = self.customers.clone();
        // 路径是固定上游协议；origin/部署前缀仍来自唯一 Customer 配置。
        url.set_path(&format!("{prefix}/api/v1/customers/{id}"));
        Ok(url)
    }

    /// 调用方持同 Tenant 生命周期锁及真实 Installation/AE 准入事实。
    pub(crate) async fn subject_projection(
        &self,
        tenant: Uuid,
        customer_id: &str,
        installation: Uuid,
    ) -> Result<SubjectProjection, Error> {
        let native: Value = self.read(self.legacy_customer_url(customer_id)?).await?;
        let mut body = subject_body(native, tenant, customer_id)?;
        let subject = format!("{tenant}:{installation}");
        let keys = body["usageAttribution"]["subjectKeys"]
            .as_array_mut()
            .ok_or(Error::Unknown)?;
        let needs_write = !keys
            .iter()
            .any(|key| key.as_str() == Some(subject.as_str()));
        if needs_write {
            keys.push(Value::String(subject.clone()));
            keys.sort_by(|left, right| left.as_str().cmp(&right.as_str()));
        }
        Ok(SubjectProjection {
            tenant,
            customer_id: customer_id.into(),
            subject,
            body,
            needs_write,
        })
    }

    /// 原生 replace 不是 CAS。已有 AE 派发引用必须先落库；方法不盲目重试 PUT。
    pub(crate) async fn write_subject_projection(
        &self,
        projection: &SubjectProjection,
    ) -> Result<(), Error> {
        let response = self
            .http
            .put(self.legacy_customer_url(&projection.customer_id)?)
            .json(&projection.body)
            .send()
            .await
            .map_err(|_| Error::Unknown)?;
        if response.status() != StatusCode::OK {
            return Err(status_error(response.status()));
        }
        Ok(())
    }

    /// 200 或 subject 单独存在不足以完成；原字段、完整集合及 v3 归属都必须吻合。
    pub(crate) async fn verify_subject_projection(
        &self,
        projection: &SubjectProjection,
    ) -> Result<(), Error> {
        let native: Value = self
            .read(self.legacy_customer_url(&projection.customer_id)?)
            .await?;
        let body = subject_body(native, projection.tenant, &projection.customer_id)?;
        if body != projection.body {
            return Err(Error::Unknown);
        }
        let customer = self
            .customer_by_id(&projection.customer_id, projection.tenant)
            .await?
            .ok_or(Error::Unknown)?;
        let expected = projection.body["usageAttribution"]["subjectKeys"]
            .as_array()
            .ok_or(Error::Unknown)?;
        let attribution = customer.usage_attribution.as_ref().ok_or(Error::Unknown)?;
        let mut observed = attribution.subject_keys.clone();
        observed.sort_unstable();
        let expected: Vec<_> = expected
            .iter()
            .map(|key| key.as_str().ok_or(Error::Unknown))
            .collect::<Result<_, _>>()?;
        if !customer.is_active()
            || !observed.iter().any(|key| key == &projection.subject)
            || observed.iter().map(String::as_str).collect::<Vec<_>>() != expected
            || self
                .customer_by_key(projection.tenant)
                .await?
                .is_none_or(|active| active.id != projection.customer_id)
        {
            return Err(Error::Unknown);
        }
        self.verify_subject_owner(
            projection.tenant,
            &projection.customer_id,
            &projection.subject,
        )
        .await?;
        Ok(())
    }

    async fn verify_subject_owner(
        &self,
        tenant: Uuid,
        id: &str,
        subject: &str,
    ) -> Result<(), Error> {
        // Native customer.key takes precedence over subject_keys. A different key-owner
        // must not redirect this subject, even when the expected Customer contains it.
        let mut key_url = self.customers.clone();
        key_url
            .query_pairs_mut()
            .append_pair("filter[key][eq]", subject);
        let key_owners: Vec<Customer> = self.collection(key_url).await?;
        if !key_owners.is_empty() {
            return Err(Error::Conflict);
        }
        let mut subject_url = self.customers.clone();
        subject_url
            .query_pairs_mut()
            .append_pair("filter[usage_attribution_subject_key][eq]", subject);
        let mut owners: Vec<Customer> = self.collection(subject_url).await?;
        if owners.len() != 1 {
            return Err(Error::Conflict);
        }
        let owner = owners
            .pop()
            .ok_or(Error::Unknown)?
            .validate(tenant, Some(id))?;
        if !owner.is_active()
            || !owner.usage_attribution.as_ref().is_some_and(|attribution| {
                attribution.subject_keys.iter().any(|key| key == subject)
            })
        {
            return Err(Error::Conflict);
        }
        Ok(())
    }

    fn collection_url(&self, collection: &str) -> Result<Url, Error> {
        let mut url = self.customers.clone();
        url.path_segments_mut()
            .map_err(|_| Error::Unknown)?
            .pop()
            .push(collection);
        Ok(url)
    }

    async fn read<T: serde::de::DeserializeOwned>(&self, url: Url) -> Result<T, Error> {
        // Path only: the query carries no credential, but keep logs minimal.
        let path = url.path().to_owned();
        let response = self.http.get(url).send().await.map_err(|error| {
            tracing::warn!(path = %path, timeout = error.is_timeout(), connect = error.is_connect(),
                "OpenMeter read transport failed");
            Error::Unknown
        })?;
        if response.status() != StatusCode::OK {
            tracing::warn!(path = %path, status = response.status().as_u16(),
                "OpenMeter read returned a non-OK status");
            return Err(status_error(response.status()));
        }
        response.json().await.map_err(|_| {
            tracing::warn!(path = %path, "OpenMeter read body could not be decoded");
            Error::Unknown
        })
    }

    async fn collection<T: serde::de::DeserializeOwned>(&self, url: Url) -> Result<Vec<T>, Error> {
        let mut data = Vec::new();
        let mut number = 1_u64;
        let mut expected: Option<(u64, u64)> = None;
        loop {
            let mut page_url = url.clone();
            page_url
                .query_pairs_mut()
                .append_pair("page[number]", &number.to_string());
            if let Some((size, _)) = expected {
                page_url
                    .query_pairs_mut()
                    .append_pair("page[size]", &size.to_string());
            }
            let page: Collection<T> = self.read(page_url).await?;
            let meta = page.meta.page;
            let seen = data.len() as u64;
            if meta.number != number
                || meta.size == 0
                || meta.total < seen
                || expected.is_some_and(|old| old != (meta.size, meta.total))
                || page.data.len() as u64 != meta.size.min(meta.total - seen)
            {
                return Err(Error::Unknown);
            }
            expected = Some((meta.size, meta.total));
            data.extend(page.data);
            if data.len() as u64 == meta.total {
                return Ok(data);
            }
            number = number.checked_add(1).ok_or(Error::Unknown)?;
        }
    }

    /// DD-07/38、ADR-14：只消费原生 entitlement/credit，不建立额度账本。
    /// meter 不是 feature key；只接受 Customer 唯一、无未解析维度 filter 的原生关系。
    pub async fn check_quota(
        &self,
        tenant: Uuid,
        customer_id: &str,
        meters: &[String],
    ) -> Result<bool, Error> {
        let customer = self
            .customer_by_id(customer_id, tenant)
            .await?
            .ok_or(Error::Precondition)?;
        if !customer.is_active() || meters.is_empty() {
            return Err(Error::Precondition);
        }
        let mut access_url = self.customer_url(customer_id)?;
        access_url
            .path_segments_mut()
            .map_err(|_| Error::Unknown)?
            .push("entitlement-access");
        let entitlements: EntitlementAccessList = self.read(access_url.clone()).await?;
        let mut keys = HashSet::new();
        if entitlements
            .data
            .iter()
            .any(|e| !valid_resource_key(&e.feature_key) || !keys.insert(&e.feature_key))
        {
            return Err(Error::Unknown);
        }
        // DD-123：额度项是 feature；没有任何未删除 feature 的 meter 只计用量（如记忆
        // 明文字节），不是额度项。动作至少要有一个 meter 落在额度项上，否则仍 fail closed。
        let mut governed = 0_usize;
        for key in meters {
            if !valid_meter_key(key) {
                return Err(Error::Precondition);
            }
            let native_key = native_meter_key(key, self.automation_native_meter_key.as_deref())?;
            let mut meter_url = self.collection_url("meters")?;
            meter_url
                .query_pairs_mut()
                .append_pair("filter[key][eq]", native_key);
            let mut native_meters: Vec<Meter> = self.collection(meter_url).await?;
            let meter = match native_meters.len() {
                0 => return Err(Error::Precondition),
                1 => native_meters.pop().ok_or(Error::Unknown)?,
                _ => return Err(Error::Conflict),
            };
            if meter.key != native_key
                || !valid_customer_id(&meter.id)
                || meter.deleted_at.is_some()
            {
                return Err(Error::Conflict);
            }
            let mut feature_url = self.collection_url("features")?;
            feature_url
                .query_pairs_mut()
                .append_pair("filter[meter_id][oeq]", &meter.id);
            let features: Vec<Feature> = self.collection(feature_url).await?;
            if !features.iter().any(|feature| feature.deleted_at.is_none()) {
                continue;
            }
            governed += 1;
            let mut feature_ids = HashSet::new();
            let mut feature_keys = HashSet::new();
            let mut selected = None;
            for feature in &features {
                if !valid_customer_id(&feature.id)
                    || !valid_resource_key(&feature.key)
                    || !feature_ids.insert(&feature.id)
                    || !feature_keys.insert(&feature.key)
                {
                    return Err(Error::Unknown);
                }
                let reference = feature.meter.as_ref().ok_or(Error::Conflict)?;
                if reference.id != meter.id {
                    return Err(Error::Conflict);
                }
                if feature.deleted_at.is_some() || !keys.contains(&feature.key) {
                    continue;
                }
                if selected.is_some() {
                    return Err(Error::Conflict);
                }
                if reference
                    .filters
                    .as_ref()
                    .is_some_and(|filters| !filters.is_empty())
                {
                    return Err(Error::Precondition);
                }
                selected = Some(&feature.key);
            }
            let Some(feature_key) = selected else {
                return Ok(false);
            };
            let mut value_url = access_url.clone();
            value_url
                .path_segments_mut()
                .map_err(|_| Error::Unknown)?
                .push("features")
                .push(feature_key);
            value_url.query_pairs_mut().append_pair("expand", "value");
            let access: EntitlementAccess = self.read(value_url).await?;
            if access.feature_key != *feature_key {
                return Err(Error::Conflict);
            }
            // 原生 NoAccessValue 映射为 static/false；不是猜测缺失 credit。
            if access.kind == EntitlementType::Static && !access.has_access {
                return Ok(false);
            }
            if access.kind != EntitlementType::Metered {
                return Err(Error::Precondition);
            }
            if !access.value.as_ref().is_some_and(CreditValue::valid) {
                return Err(Error::Unknown);
            }
            // 原生 soft-limit 可以在余额非正时允许。CHECK 不擅自改成 hard-limit。
            if !access.has_access {
                return Ok(false);
            }
        }
        if governed == 0 {
            return Err(Error::Precondition);
        }
        Ok(true)
    }

    /// 只选 Action 已登记的 meter；配置不是由模型名、token 总量或价格猜测。
    /// 同 event_type 多 meter 会让逐 meter CloudEvent 重复入账，因而明确拒绝。
    pub(crate) async fn turn_meters(
        &self,
        tenant: Uuid,
        customer_id: &str,
        subject: &str,
        action: &str,
        keys: &[String],
    ) -> Result<(Vec<GatewayMeter>, Option<InvocationMeter>), Error> {
        self.execution_meters(tenant, customer_id, subject, Some(action), keys, true)
            .await
    }

    /// DD-92: the binding's registered SERVICE uses native Gateway SUM meters;
    /// it is not an Agent invocation and cannot manufacture an invocation count.
    pub(crate) async fn application_model_meters(
        &self,
        tenant: Uuid,
        customer_id: &str,
        subject: &str,
        keys: &[String],
    ) -> Result<Vec<GatewayMeter>, Error> {
        let (meters, _) = self
            .execution_meters(tenant, customer_id, subject, None, keys, true)
            .await?;
        Ok(meters)
    }

    /// DD-107 POST_MESSAGE has exactly the native COUNT meter, not a synthetic
    /// model request. All native Customer/subject/meter uniqueness checks below
    /// are shared with the model producer.
    pub(crate) async fn message_meter(
        &self,
        tenant: Uuid,
        customer_id: &str,
        subject: &str,
    ) -> Result<InvocationMeter, Error> {
        let (models, count) = self
            .execution_meters(
                tenant,
                customer_id,
                subject,
                Some("automation.run"),
                &["automation.run".to_owned()],
                false,
            )
            .await?;
        if !models.is_empty() {
            return Err(Error::Precondition);
        }
        count.ok_or(Error::Precondition)
    }

    async fn execution_meters(
        &self,
        tenant: Uuid,
        customer_id: &str,
        subject: &str,
        action: Option<&str>,
        keys: &[String],
        require_model: bool,
    ) -> Result<(Vec<GatewayMeter>, Option<InvocationMeter>), Error> {
        let customer = self
            .customer_by_id(customer_id, tenant)
            .await?
            .ok_or(Error::Precondition)?;
        if !customer.is_active()
            || !subject.starts_with(&format!("{tenant}:"))
            || !customer
                .usage_attribution
                .as_ref()
                .is_some_and(|a| a.subject_keys.iter().any(|s| s == subject))
            || keys.is_empty()
        {
            return Err(Error::Precondition);
        }
        self.verify_subject_owner(tenant, customer_id, subject)
            .await?;
        let native: Vec<Meter> = self.collection(self.collection_url("meters")?).await?;
        let mut seen = HashSet::new();
        let mut event_types = HashSet::new();
        let mut selected = Vec::new();
        let mut invocation = None;
        for key in keys {
            if !valid_meter_key(key) || !seen.insert(key) {
                return Err(Error::Precondition);
            }
            let native_key = native_meter_key(key, self.automation_native_meter_key.as_deref())?;
            let matches: Vec<_> = native
                .iter()
                .filter(|m| m.key == native_key && m.deleted_at.is_none())
                .collect();
            let [meter] = matches.as_slice() else {
                return Err(Error::Conflict);
            };
            if !valid_customer_id(&meter.id)
                || meter.event_type.is_empty()
                || !event_types.insert(&meter.event_type)
                || native
                    .iter()
                    .filter(|m| m.deleted_at.is_none() && m.event_type == meter.event_type)
                    .count()
                    != 1
            {
                return Err(Error::Precondition);
            }
            // 05 §2.9 的封闭计数键，实际 aggregation/type/id 来自原生 meter。
            if key == "automation.run" {
                if action.is_none() {
                    return Err(Error::Precondition);
                }
                if meter.aggregation != "count"
                    || meter.value_property.is_some()
                    || meter.dimensions.as_ref().is_some_and(|d| {
                        d.values().any(|p| {
                            !matches!(
                                p.as_str(),
                                "$.tenant_id"
                                    | "$.workspace_id"
                                    | "$.operation_id"
                                    | "$.agent_installation_resource_id"
                                    | "$.agent_version_asset_id"
                                    | "$.automation_resource_id"
                            )
                        })
                    })
                {
                    return Err(Error::Precondition);
                }
                invocation = Some(InvocationMeter {
                    key: key.clone(),
                    id: meter.id.clone(),
                    event_type: meter.event_type.clone(),
                });
                continue;
            }
            let property = meter.value_property.as_deref().ok_or(Error::Precondition)?;
            // 精确原生 JSONPath 的三个已存在 usage 字段；不实现第二 JSONPath 引擎。
            if !valid_customer_id(&meter.id)
                || meter.aggregation != "sum"
                || meter.event_type.is_empty()
                || !matches!(
                    property,
                    "$.inputTokens" | "$.outputTokens" | "$.totalTokens"
                )
                || meter.dimensions.as_ref().is_some_and(|d| {
                    d.values().any(|p| {
                        !matches!(
                            p.as_str(),
                            "$.tenant_id"
                                | "$.workspace_id"
                                | "$.operation_id"
                                | "$.provider"
                                | "$.model"
                        ) && !match action {
                            Some(_) => matches!(
                                p.as_str(),
                                "$.agent_installation_resource_id" | "$.agent_version_asset_id"
                            ),
                            None => matches!(
                                p.as_str(),
                                "$.component_binding_id"
                                    | "$.component_release_id"
                                    | "$.component_projection_generation"
                                    | "$.model_call_mode"
                            ),
                        }
                    })
                })
            {
                return Err(Error::Precondition);
            }
            selected.push(GatewayMeter {
                key: key.clone(),
                id: meter.id.clone(),
                event_type: meter.event_type.clone(),
                value_property: property.to_owned(),
            });
        }
        if require_model && selected.is_empty() {
            return Err(Error::Precondition);
        }
        let count = match action {
            Some(action) => InvocationMeter::for_action(action, invocation)?,
            None if invocation.is_none() => None,
            None => return Err(Error::Precondition),
        };
        Ok((selected, count))
    }

    pub(crate) async fn memory_read_meters(
        &self,
        tenant: Uuid,
        customer_id: &str,
        subject: &str,
    ) -> Result<Vec<MemoryMeter>, Error> {
        self.memory_meters(tenant, customer_id, subject, "agent_memory_read_count")
            .await
    }

    pub(crate) async fn memory_write_meters(
        &self,
        tenant: Uuid,
        customer_id: &str,
        subject: &str,
    ) -> Result<Vec<MemoryMeter>, Error> {
        self.memory_meters(tenant, customer_id, subject, "agent_memory_write_count")
            .await
    }

    async fn memory_meters(
        &self,
        tenant: Uuid,
        customer_id: &str,
        subject: &str,
        count_key: &str,
    ) -> Result<Vec<MemoryMeter>, Error> {
        let customer = self
            .customer_by_id(customer_id, tenant)
            .await?
            .ok_or(Error::Precondition)?;
        if !customer.is_active()
            || !customer
                .usage_attribution
                .as_ref()
                .is_some_and(|a| a.subject_keys.iter().any(|s| s == subject))
        {
            return Err(Error::Precondition);
        }
        self.verify_subject_owner(tenant, customer_id, subject)
            .await?;
        let native: Vec<Meter> = self.collection(self.collection_url("meters")?).await?;
        let mut event_types = HashSet::new();
        let mut result = Vec::new();
        for key in [count_key, "agent_memory_plaintext_bytes"] {
            let matched: Vec<_> = native
                .iter()
                .filter(|m| m.key == key && m.deleted_at.is_none())
                .collect();
            let [meter] = matched.as_slice() else {
                return Err(Error::Precondition);
            };
            let shape = if key == count_key {
                meter.aggregation == "count" && meter.value_property.is_none()
            } else {
                meter.aggregation == "sum"
                    && meter.value_property.as_deref() == Some("$.plaintext_bytes")
            };
            if !shape
                || !valid_customer_id(&meter.id)
                || meter.event_type.is_empty()
                || !event_types.insert(&meter.event_type)
                || native
                    .iter()
                    .filter(|m| m.deleted_at.is_none() && m.event_type == meter.event_type)
                    .count()
                    != 1
                || meter.dimensions.as_ref().is_some_and(|d| {
                    d.values().any(|p| {
                        !matches!(
                            p.as_str(),
                            "$.tenant_id"
                                | "$.workspace_id"
                                | "$.operation_id"
                                | "$.agent_installation_resource_id"
                        )
                    })
                })
            {
                return Err(Error::Precondition);
            }
            result.push(MemoryMeter {
                key: key.into(),
                id: meter.id.clone(),
                event_type: meter.event_type.clone(),
                value_property: meter.value_property.clone(),
            });
        }
        Ok(result)
    }

    pub(crate) async fn application_meters(
        &self,
        tenant: Uuid,
        customer_id: &str,
        subject: &str,
        keys: &[String],
    ) -> Result<Vec<ApplicationMeter>, Error> {
        let customer = self
            .customer_by_id(customer_id, tenant)
            .await?
            .ok_or(Error::Precondition)?;
        if !customer.is_active()
            || !customer
                .usage_attribution
                .as_ref()
                .is_some_and(|a| a.subject_keys.iter().any(|s| s == subject))
        {
            return Err(Error::Precondition);
        }
        self.verify_subject_owner(tenant, customer_id, subject)
            .await?;
        let native: Vec<Meter> = self.collection(self.collection_url("meters")?).await?;
        let mut seen = HashSet::new();
        let mut result = Vec::new();
        for key in keys {
            if !seen.insert(key) {
                return Err(Error::Precondition);
            }
            let matched: Vec<_> = native
                .iter()
                .filter(|m| &m.key == key && m.deleted_at.is_none())
                .collect();
            let [meter] = matched.as_slice() else {
                return Err(Error::Precondition);
            };
            if !valid_customer_id(&meter.id)
                || meter.event_type.is_empty()
                || !((meter.aggregation == "count" && meter.value_property.is_none())
                    || (meter.aggregation == "sum"
                        && meter.value_property.as_deref() == Some("$.quantity")))
                || native
                    .iter()
                    .filter(|m| m.deleted_at.is_none() && m.event_type == meter.event_type)
                    .count()
                    != 1
                || meter.dimensions.as_ref().is_some_and(|d| {
                    d.values().any(|p| {
                        !matches!(
                            p.as_str(),
                            "$.tenant_id"
                                | "$.workspace_id"
                                | "$.operation_id"
                                | "$.component_binding_id"
                                | "$.component_release_id"
                                | "$.component_projection_generation"
                                | "$.resource_id"
                        )
                    })
                })
            {
                return Err(Error::Precondition);
            }
            result.push(ApplicationMeter {
                key: key.clone(),
                id: meter.id.clone(),
                event_type: meter.event_type.clone(),
                value_property: meter.value_property.clone(),
            });
        }
        Ok(result)
    }

    /// 调用前已持久同一 CloudEvent。202 仅 ACCEPTED；网络/未知状态只 UNKNOWN。
    /// 上送冻结体的线上投影（`wire_event`）；未被受理时记录状态码与原生问题
    /// 摘要，冻结事件留待同一对账重试。
    pub(crate) async fn publish_usage(&self, event: &Value) -> Result<(), Error> {
        let id = event.get("id").and_then(Value::as_str).unwrap_or_default();
        let mut response = self
            .http
            .post(self.collection_url("events")?)
            .header(header::CONTENT_TYPE, "application/cloudevents+json")
            .json(&wire_event(event))
            .send()
            .await
            .map_err(|error| {
                tracing::warn!(
                    usage_event_id = id,
                    timeout = error.is_timeout(),
                    connect = error.is_connect(),
                    "OpenMeter usage publish transport failed"
                );
                Error::Unknown
            })?;
        let status = response.status();
        if status != StatusCode::ACCEPTED {
            let problem = problem_summary(&bounded_body(&mut response).await);
            tracing::warn!(usage_event_id = id, status = status.as_u16(), problem = %problem,
                "OpenMeter usage publish was not accepted; frozen event kept for reconciliation");
            return Err(status_error(status));
        }
        Ok(())
    }

    /// 按固定 namespace/source/id/subject/type 查真正 stored_at，不拿 202 或 customer
    /// 读时派生值作持久终态。validation_errors 只返回配置告警，不改变已落库事实。
    pub(crate) async fn stored_usage(
        &self,
        expected: &Value,
    ) -> Result<Option<StoredEvidence>, Error> {
        let mut url = self.collection_url("events")?;
        for key in ["id", "source", "subject", "type"] {
            let value = expected
                .get(key)
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .ok_or(Error::Precondition)?;
            url.query_pairs_mut()
                .append_pair(&format!("filter[{key}][eq]"), value);
        }
        let page: StoredEventPage = self.read(url).await?;
        if page.meta.page.next.is_some() || page.data.len() > 1 {
            return Err(Error::Conflict);
        }
        let Some(stored) = page.data.into_iter().next() else {
            return Ok(None);
        };
        same_stored_event(expected, stored.event)?;
        Ok(Some(StoredEvidence {
            stored_at: stored.stored_at,
            configuration_warning: stored.validation_errors.is_some_and(|v| !v.is_empty()),
        }))
    }

    pub async fn customer_by_key(&self, tenant: Uuid) -> Result<Option<Customer>, Error> {
        let response = self
            .http
            .get(self.customers.clone())
            .query(&[("filter[key][eq]", tenant.to_string())])
            .send()
            .await
            .map_err(|_| Error::Unknown)?;
        if response.status() != StatusCode::OK {
            return Err(status_error(response.status()));
        }
        let mut page: CustomerPage = response.json().await.map_err(|_| Error::Unknown)?;
        // 精确 key 的完整集合只有零或一项。不选第一条，不把缺页误判为不存在。
        if page.meta.page.number != 1
            || page.meta.page.size == 0
            || page.meta.page.total != page.data.len() as u64
        {
            return Err(Error::Unknown);
        }
        match page.data.len() {
            0 => Ok(None),
            1 => {
                let customer = page
                    .data
                    .pop()
                    .ok_or(Error::Unknown)?
                    .validate(tenant, None)?;
                if !customer.is_active() {
                    return Err(Error::Conflict);
                }
                Ok(Some(customer))
            }
            _ => Err(Error::Conflict),
        }
    }

    pub async fn customer_by_id(&self, id: &str, tenant: Uuid) -> Result<Option<Customer>, Error> {
        let response = self
            .http
            .get(self.customer_url(id)?)
            .send()
            .await
            .map_err(|_| Error::Unknown)?;
        match response.status() {
            StatusCode::NOT_FOUND => Ok(None),
            StatusCode::OK => {
                let customer: Customer = response.json().await.map_err(|_| Error::Unknown)?;
                Ok(Some(customer.validate(tenant, Some(id))?))
            }
            status => Err(status_error(status)),
        }
    }

    /// 调用方在此之前持久化同一 Workflow/AE 的 DISPATCH。此方法不自动重试 POST。
    pub async fn create_customer(&self, tenant: Uuid) -> Result<Customer, Error> {
        let key = tenant.to_string();
        let response = self
            .http
            .post(self.customers.clone())
            .json(&serde_json::json!({"key": key, "name": key}))
            .send()
            .await
            .map_err(|_| Error::Unknown)?;
        if response.status() != StatusCode::CREATED {
            return Err(status_error(response.status()));
        }
        let customer: Customer = response.json().await.map_err(|_| Error::Unknown)?;
        let customer = customer.validate(tenant, None)?;
        if !customer.is_active() {
            return Err(Error::Conflict);
        }
        Ok(customer)
    }

    /// DD-43/99：只确认原生逻辑退役，不声称 usage/invoice 或历史 subject 被擦除。
    pub async fn retire_customer(&self, id: &str, tenant: Uuid) -> Result<Customer, Error> {
        let observed = self
            .customer_by_id(id, tenant)
            .await?
            .ok_or(Error::Unknown)?;
        if !observed.is_deleted() {
            let response = self
                .http
                .delete(self.customer_url(id)?)
                .send()
                .await
                .map_err(|_| Error::Unknown)?;
            if response.status() != StatusCode::NO_CONTENT {
                return Err(status_error(response.status()));
            }
        }
        let tombstone = self
            .customer_by_id(id, tenant)
            .await?
            .ok_or(Error::Unknown)?;
        if !tombstone.is_deleted() || self.customer_by_key(tenant).await?.is_some() {
            return Err(Error::Unknown);
        }
        Ok(tombstone)
    }

    /// `.design/11` §7、§3：只读该 Tenant 唯一 Customer 的原生 committed usage。
    /// Workspace 归因只在原生 meter 声明 `workspace_id` 维度时才查询，不按时间或
    /// Core 自己的 outbox 推算。空结果是原生确认的「区间内无已存储事件」。
    pub(crate) async fn committed_meter_usage(
        &self,
        customer_id: &str,
        key: &str,
        workspace: Option<Uuid>,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<MeterUsage, Error> {
        if !valid_customer_id(customer_id) {
            return Err(Error::Conflict);
        }
        let Ok(native_key) = native_meter_key(key, self.automation_native_meter_key.as_deref())
        else {
            return Ok(MeterUsage::NotRegistered);
        };
        let mut meter_url = self.collection_url("meters")?;
        meter_url
            .query_pairs_mut()
            .append_pair("filter[key][eq]", native_key);
        let native: Vec<Meter> = self.collection(meter_url).await?;
        let live: Vec<&Meter> = native
            .iter()
            .filter(|m| m.key == native_key && m.deleted_at.is_none())
            .collect();
        let [meter] = live.as_slice() else {
            return Ok(MeterUsage::NotRegistered);
        };
        if !valid_customer_id(&meter.id) {
            return Err(Error::Conflict);
        }
        let aggregation = meter.aggregation.clone();
        let mut dimensions = serde_json::Map::new();
        dimensions.insert(
            "customer_id".into(),
            serde_json::json!({ "eq": customer_id }),
        );
        if let Some(workspace) = workspace {
            if !meter
                .dimensions
                .as_ref()
                .is_some_and(|d| d.contains_key("workspace_id"))
            {
                return Ok(MeterUsage::WorkspaceDimensionUnavailable { aggregation });
            }
            dimensions.insert(
                "workspace_id".into(),
                serde_json::json!({ "eq": workspace.to_string() }),
            );
        }
        let mut query_url = self.collection_url("meters")?;
        query_url
            .path_segments_mut()
            .map_err(|_| Error::Unknown)?
            .push(&meter.id)
            .push("query");
        let response = self
            .http
            .post(query_url)
            .json(&serde_json::json!({
                "from": from.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
                "to": to.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
                "filters": { "dimensions": dimensions },
            }))
            .send()
            .await
            .map_err(|_| Error::Unknown)?;
        if response.status() != StatusCode::OK {
            return Err(status_error(response.status()));
        }
        let result: MeterQueryResult = response.json().await.map_err(|_| Error::Unknown)?;
        match result.data.as_slice() {
            [] => Ok(MeterUsage::NoCommittedUsage { aggregation }),
            [row]
                if row.dimensions.get("customer_id").map(String::as_str) == Some(customer_id)
                    && valid_numeric(&row.value) =>
            {
                Ok(MeterUsage::Committed {
                    aggregation,
                    quantity: row.value.clone(),
                })
            }
            // 单一 Customer 过滤后不应出现多行或别的 Customer；不选第一行。
            _ => Err(Error::Unknown),
        }
    }

    /// DD-165(4)：该 Tenant 唯一 Customer 在区间内按 `group_by` 维度分行的原生
    /// committed usage，可再按一个受控维度等值过滤（成员视图按 `member_principal_id`）。
    /// 维度名只取 Core 固定的平台 meter 维度；结果每行都必须属于该 Customer。
    pub(crate) async fn grouped_meter_usage(
        &self,
        customer_id: &str,
        key: &str,
        group_by: &str,
        filter: Option<(&str, &str)>,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<GroupedUsage, Error> {
        if !valid_customer_id(customer_id)
            || !valid_resource_key(key)
            || !valid_resource_key(group_by)
            || filter.is_some_and(|(name, value)| !valid_resource_key(name) || value.is_empty())
        {
            return Err(Error::Precondition);
        }
        let mut meter_url = self.collection_url("meters")?;
        meter_url
            .query_pairs_mut()
            .append_pair("filter[key][eq]", key);
        let native: Vec<Meter> = self.collection(meter_url).await?;
        let live: Vec<&Meter> = native
            .iter()
            .filter(|m| m.key == key && m.deleted_at.is_none())
            .collect();
        let [meter] = live.as_slice() else {
            return Ok(GroupedUsage::NotRegistered);
        };
        if !valid_customer_id(&meter.id) {
            return Err(Error::Conflict);
        }
        let declared = |name: &str| {
            meter
                .dimensions
                .as_ref()
                .is_some_and(|d| d.contains_key(name))
        };
        if !declared(group_by) || filter.is_some_and(|(name, _)| !declared(name)) {
            return Err(Error::Precondition);
        }
        let mut dimensions = serde_json::Map::new();
        dimensions.insert(
            "customer_id".into(),
            serde_json::json!({ "eq": customer_id }),
        );
        if let Some((name, value)) = filter {
            dimensions.insert(name.into(), serde_json::json!({ "eq": value }));
        }
        let mut query_url = self.collection_url("meters")?;
        query_url
            .path_segments_mut()
            .map_err(|_| Error::Unknown)?
            .push(&meter.id)
            .push("query");
        let response = self
            .http
            .post(query_url)
            .json(&serde_json::json!({
                "from": from.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
                "to": to.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
                "group_by_dimensions": ["customer_id", group_by],
                "filters": { "dimensions": dimensions },
            }))
            .send()
            .await
            .map_err(|_| Error::Unknown)?;
        if response.status() != StatusCode::OK {
            return Err(status_error(response.status()));
        }
        let result: MeterQueryResult = response.json().await.map_err(|_| Error::Unknown)?;
        let mut rows = Vec::with_capacity(result.data.len());
        for row in result.data {
            if row.dimensions.get("customer_id").map(String::as_str) != Some(customer_id)
                || !valid_numeric(&row.value)
            {
                return Err(Error::Unknown);
            }
            if let Some((name, value)) = filter {
                if row
                    .dimensions
                    .get(name)
                    .is_some_and(|actual| actual != value)
                {
                    return Err(Error::Unknown);
                }
            }
            match row.dimensions.get(group_by) {
                Some(value) if !value.is_empty() => rows.push((value.clone(), row.value)),
                _ => {}
            }
        }
        Ok(GroupedUsage::Committed {
            aggregation: meter.aggregation.clone(),
            rows,
        })
    }

    /// `.design/11` §7：原生 entitlement/credit 只读展示，不复制余额。
    pub(crate) async fn entitlement_facts(
        &self,
        tenant: Uuid,
        customer_id: &str,
    ) -> Result<Vec<EntitlementFact>, Error> {
        self.customer_by_id(customer_id, tenant)
            .await?
            .filter(Customer::is_active)
            .ok_or(Error::Precondition)?;
        let mut access_url = self.customer_url(customer_id)?;
        access_url
            .path_segments_mut()
            .map_err(|_| Error::Unknown)?
            .push("entitlement-access");
        let list: EntitlementAccessList = self.read(access_url.clone()).await?;
        let mut seen = HashSet::new();
        let mut facts = Vec::with_capacity(list.data.len());
        for access in list.data {
            if !valid_resource_key(&access.feature_key) || !seen.insert(access.feature_key.clone())
            {
                return Err(Error::Unknown);
            }
            let kind = match access.kind {
                EntitlementType::Metered => "metered",
                EntitlementType::Static => "static",
                EntitlementType::Boolean => "boolean",
            };
            if access.kind != EntitlementType::Metered {
                facts.push(EntitlementFact {
                    feature_key: access.feature_key,
                    kind,
                    has_access: access.has_access,
                    balance: None,
                    usage: None,
                    overage: None,
                });
                continue;
            }
            let mut value_url = access_url.clone();
            value_url
                .path_segments_mut()
                .map_err(|_| Error::Unknown)?
                .push("features")
                .push(&access.feature_key);
            value_url.query_pairs_mut().append_pair("expand", "value");
            let detail: EntitlementAccess = self.read(value_url).await?;
            if detail.feature_key != access.feature_key {
                return Err(Error::Conflict);
            }
            let value = detail
                .value
                .filter(CreditValue::valid)
                .ok_or(Error::Unknown)?;
            facts.push(EntitlementFact {
                feature_key: access.feature_key,
                kind,
                has_access: detail.has_access,
                balance: Some(value.balance),
                usage: Some(value.usage),
                overage: Some(value.overage),
            });
        }
        Ok(facts)
    }

    /// `.design/11` §6：账单状态只读原生 invoice；没有 invoice 不等于已结算或零账单。
    pub(crate) async fn invoice_facts(&self, customer_id: &str) -> Result<Vec<InvoiceFact>, Error> {
        if !valid_customer_id(customer_id) {
            return Err(Error::Conflict);
        }
        let mut url = self.collection_url("billing")?;
        url.path_segments_mut()
            .map_err(|_| Error::Unknown)?
            .push("invoices");
        url.query_pairs_mut()
            .append_pair("filter[customer_id][eq]", customer_id);
        let invoices: Vec<NativeInvoice> = self.collection(url).await?;
        invoices
            .into_iter()
            .map(|invoice| {
                if invoice.id.is_empty()
                    || invoice.status.is_empty()
                    || invoice
                        .totals
                        .as_ref()
                        .is_some_and(|t| !valid_numeric(&t.total))
                {
                    return Err(Error::Unknown);
                }
                Ok(InvoiceFact {
                    id: invoice.id,
                    number: invoice.number,
                    status: invoice.status,
                    currency: invoice.currency,
                    total: invoice.totals.map(|t| t.total),
                    service_period: invoice.service_period.map(|p| (p.from, p.to)),
                    issued_at: invoice.issued_at,
                })
            })
            .collect()
    }

    /// v1/v2 原生路径与 Customer 集合共用唯一配置的 origin 与部署前缀。
    fn native_api_url(&self, segments: &[&str]) -> Result<Url, Error> {
        let prefix = self
            .customers
            .path()
            .strip_suffix("/api/v3/openmeter/customers")
            .ok_or(Error::Precondition)?
            .to_owned();
        let mut url = self.customers.clone();
        url.set_path(&prefix);
        url.path_segments_mut()
            .map_err(|_| Error::Unknown)?
            .pop_if_empty()
            .extend(segments);
        Ok(url)
    }

    fn entitlements_url(&self, customer_id: &str, tail: &[&str]) -> Result<Url, Error> {
        if !valid_customer_id(customer_id) {
            return Err(Error::Conflict);
        }
        let mut segments = vec!["api", "v2", "customers", customer_id, "entitlements"];
        segments.extend_from_slice(tail);
        self.native_api_url(&segments)
    }

    /// DD-123：按确定 key（Customer + feature）读当前 entitlement；404 是原生「无」。
    pub(crate) async fn entitlement(
        &self,
        customer_id: &str,
        feature_key: &str,
    ) -> Result<Option<NativeEntitlement>, Error> {
        if !valid_resource_key(feature_key) {
            return Err(Error::Precondition);
        }
        let response = self
            .http
            .get(self.entitlements_url(customer_id, &[feature_key])?)
            .send()
            .await
            .map_err(|_| Error::Unknown)?;
        match response.status() {
            StatusCode::NOT_FOUND => Ok(None),
            StatusCode::OK => {
                let entitlement: NativeEntitlement =
                    response.json().await.map_err(|_| Error::Unknown)?;
                entitlement.validate(customer_id, feature_key).map(Some)
            }
            status => Err(status_error(status)),
        }
    }

    /// 含已删除（被 override 替换）的完整历史；对账只按意图 ID 查证，不按时间猜。
    pub(crate) async fn entitlement_history(
        &self,
        customer_id: &str,
        feature_key: &str,
    ) -> Result<Vec<NativeEntitlement>, Error> {
        if !valid_resource_key(feature_key) {
            return Err(Error::Precondition);
        }
        let base = self.entitlements_url(customer_id, &[])?;
        let mut items: Vec<NativeEntitlement> = Vec::new();
        let mut number = 1_u64;
        loop {
            let mut url = base.clone();
            url.query_pairs_mut()
                .append_pair("includeDeleted", "true")
                .append_pair("page", &number.to_string())
                .append_pair("pageSize", &ENTITLEMENT_PAGE_SIZE.to_string());
            let page: EntitlementPage = self.read(url).await?;
            let seen = items.len() as u64;
            if page.page != number
                || page.page_size == 0
                || page.total_count < seen
                || page.items.len() as u64 != page.page_size.min(page.total_count - seen)
            {
                return Err(Error::Unknown);
            }
            items.extend(page.items);
            if items.len() as u64 == page.total_count {
                break;
            }
            number = number.checked_add(1).ok_or(Error::Unknown)?;
        }
        items
            .into_iter()
            .filter(|item| item.feature_key == feature_key)
            .map(|item| item.validate(customer_id, feature_key))
            .collect()
    }

    /// 调用方已持久化意图与 DISPATCH；本方法只发一次 POST，不重试。
    pub(crate) async fn create_entitlement(
        &self,
        customer_id: &str,
        body: &Value,
    ) -> Result<NativeEntitlement, Error> {
        let feature_key = body_feature(body)?;
        let url = self.entitlements_url(customer_id, &[])?;
        let response = self
            .http
            .post(url)
            .json(body)
            .send()
            .await
            .map_err(|_| Error::Unknown)?;
        written_entitlement(response, customer_id, feature_key).await
    }

    /// 原生 override 以被替换的确切 entitlement ID 定位；它已被替换或删除时原生拒绝，
    /// 因此并发的另一次设置不会被静默覆盖。只发一次 PUT，不重试。
    pub(crate) async fn override_entitlement(
        &self,
        customer_id: &str,
        replaced_id: &str,
        body: &Value,
    ) -> Result<NativeEntitlement, Error> {
        if !valid_customer_id(replaced_id) {
            return Err(Error::Conflict);
        }
        let feature_key = body_feature(body)?;
        let url = self.entitlements_url(customer_id, &[replaced_id, "override"])?;
        let response = self
            .http
            .put(url)
            .json(body)
            .send()
            .await
            .map_err(|_| Error::Unknown)?;
        written_entitlement(response, customer_id, feature_key).await
    }

    /// 当前周期的原生 access/usage；只读展示，不另算余额。
    pub(crate) async fn entitlement_value(
        &self,
        customer_id: &str,
        feature_key: &str,
    ) -> Result<NativeEntitlementValue, Error> {
        if !valid_resource_key(feature_key) {
            return Err(Error::Precondition);
        }
        let url = self.entitlements_url(customer_id, &[feature_key, "value"])?;
        self.read(url).await
    }

    /// 全部未删除的原生 meter；部署引导以它核对平台 meter 与 event type 唯一性。
    pub(crate) async fn live_meters(&self) -> Result<Vec<MeterShape>, Error> {
        let native: Vec<Meter> = self.collection(self.collection_url("meters")?).await?;
        native
            .into_iter()
            .filter(|meter| meter.deleted_at.is_none())
            .map(|meter| {
                if !valid_customer_id(&meter.id) {
                    return Err(Error::Conflict);
                }
                Ok(MeterShape {
                    id: meter.id,
                    key: meter.key,
                    aggregation: meter.aggregation,
                    event_type: meter.event_type,
                    value_property: meter.value_property,
                    dimensions: meter.dimensions.unwrap_or_default(),
                })
            })
            .collect()
    }

    /// 调用方已持久化引导意图。meter key 原生唯一，重复 POST 只会得到冲突，不会多建。
    pub(crate) async fn create_meter(&self, body: &Value) -> Result<(), Error> {
        self.create_in("meters", body).await
    }

    /// 同 key 的全部未删除 feature；多于一个即原生配置冲突，由调用方拒绝。
    pub(crate) async fn live_features(&self, key: &str) -> Result<Vec<FeatureShape>, Error> {
        if !valid_resource_key(key) {
            return Err(Error::Precondition);
        }
        let mut features_url = self.collection_url("features")?;
        features_url
            .query_pairs_mut()
            .append_pair("filter[key][eq]", key);
        let native: Vec<Feature> = self.collection(features_url).await?;
        native
            .into_iter()
            .filter(|feature| feature.deleted_at.is_none())
            .map(|feature| {
                if !valid_customer_id(&feature.id) || feature.key != key {
                    return Err(Error::Conflict);
                }
                let filtered = feature
                    .meter
                    .as_ref()
                    .and_then(|meter| meter.filters.as_ref())
                    .is_some_and(|filters| !filters.is_empty());
                Ok(FeatureShape {
                    id: feature.id,
                    meter_id: feature.meter.map(|meter| meter.id),
                    filtered,
                })
            })
            .collect()
    }

    /// 调用方已持久化引导意图。feature key 原生唯一，重复 POST 只会得到冲突。
    pub(crate) async fn create_feature(&self, body: &Value) -> Result<(), Error> {
        self.create_in("features", body).await
    }

    async fn create_in(&self, collection: &str, body: &Value) -> Result<(), Error> {
        let response = self
            .http
            .post(self.collection_url(collection)?)
            .json(body)
            .send()
            .await
            .map_err(|_| Error::Unknown)?;
        match response.status() {
            StatusCode::CREATED => Ok(()),
            status => Err(status_error(status)),
        }
    }
}

fn body_feature(body: &Value) -> Result<&str, Error> {
    body.get("featureKey")
        .and_then(Value::as_str)
        .filter(|key| valid_resource_key(key))
        .ok_or(Error::Precondition)
}

/// 写入回应只作线索：201 仍须由调用方按意图 ID 回读查证。被替换对象已不存在
/// 是确定的未写入，归为冲突。
async fn written_entitlement(
    response: reqwest::Response,
    customer_id: &str,
    feature_key: &str,
) -> Result<NativeEntitlement, Error> {
    match response.status() {
        StatusCode::CREATED => {
            let entitlement: NativeEntitlement =
                response.json().await.map_err(|_| Error::Unknown)?;
            entitlement.validate(customer_id, feature_key)
        }
        StatusCode::NOT_FOUND => Err(Error::Conflict),
        status => Err(status_error(status)),
    }
}

fn status_error(status: StatusCode) -> Error {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Error::Denied,
        StatusCode::BAD_REQUEST
        | StatusCode::UNPROCESSABLE_ENTITY
        | StatusCode::PRECONDITION_FAILED => Error::Precondition,
        StatusCode::CONFLICT => Error::Conflict,
        StatusCode::TOO_MANY_REQUESTS => Error::Limit,
        _ => Error::Unknown,
    }
}

#[cfg(test)]
mod meter_key_tests {
    use super::{native_meter_key, valid_meter_key, valid_resource_key};

    #[test]
    fn logical_meter_selector_and_native_resource_key_are_distinct() {
        assert!(valid_meter_key("automation.run"));
        assert!(valid_meter_key("input_tokens"));
        assert!(!valid_meter_key(""));
        // Feature/entitlement-access 路径继续消费原生 ResourceKey，不一起放宽。
        assert!(!valid_resource_key("automation.run"));
        assert!(valid_resource_key("input_tokens"));
    }

    #[test]
    fn automation_count_requires_explicit_valid_native_mapping() {
        assert_eq!(
            native_meter_key("automation.run", Some("automation_run")).unwrap(),
            "automation_run"
        );
        assert!(native_meter_key("automation.run", None).is_err());
        assert!(native_meter_key("automation.run", Some("automation.run")).is_err());
        assert!(native_meter_key("automation_run", Some("automation_run")).is_err());
        assert_eq!(
            native_meter_key("model_tokens", Some("automation_run")).unwrap(),
            "model_tokens"
        );
        assert_eq!(
            native_meter_key("model_tokens", None).unwrap(),
            "model_tokens"
        );
    }

    #[tokio::test]
    #[ignore = "requires the isolated APPLICATION database and dispatch fixture"]
    async fn application_preflight_failure_rolls_back_original_dispatch() {
        use super::OpenMeter;
        use axum::{
            http::{StatusCode, Uri},
            response::IntoResponse,
            Json, Router,
        };
        use serde_json::json;
        use sqlx::{Acquire, Connection};
        use std::sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            Arc,
        };
        use uuid::Uuid;
        const CUSTOMER: &str = "00000000000000000000000001";
        let mut conn = sqlx::PgConnection::connect(
            &std::env::var("APPLICATION_EXECUTION_TEST_DATABASE_URL")
                .expect("isolated database URL"),
        )
        .await
        .unwrap();
        let mut outer = sqlx::Connection::begin(&mut conn).await.unwrap();
        let fixture = include_str!("../../../verify/application-execution-dispatch.sql");
        sqlx::raw_sql(fixture).execute(&mut *outer).await.unwrap();
        let (child, binding, release, workflow, ee): (Uuid, Uuid, Uuid, String, Uuid) =
            sqlx::query_as(
                "select child,binding,release,workflow,ee from application_dispatch_fixture",
            )
            .fetch_one(&mut *outer)
            .await
            .unwrap();
        let tenant = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
        let customer = json!({"id":CUSTOMER,"key":tenant,
            "usage_attribution":{"subject_keys":[format!("isolated:{binding}")]}});
        let reject = Arc::new(AtomicBool::new(true));
        let requests = Arc::new(AtomicUsize::new(0));
        let handler_reject = reject.clone();
        let handler_requests = requests.clone();
        let app = Router::new().fallback(move |uri: Uri| {
            let customer = customer.clone();
            let reject = handler_reject.clone();
            let requests = handler_requests.clone();
            async move {
                requests.fetch_add(1, Ordering::SeqCst);
                if reject.load(Ordering::SeqCst) {
                    return StatusCode::SERVICE_UNAVAILABLE.into_response();
                }
                let url = reqwest::Url::parse(&format!("http://localhost{uri}")).unwrap();
                let page = |data: Vec<serde_json::Value>| json!({"meta":{"page":{"number":1,"size":100,"total":data.len()}},"data":data});
                let value = if url.path().ends_with(CUSTOMER) {
                    customer
                } else if url.path().ends_with("/customers") {
                    if url.query_pairs().any(|(key,_)| key == "filter[key][eq]") {
                        page(vec![])
                    } else { page(vec![customer]) }
                } else if url.path().ends_with("/meters") {
                    page(vec![json!({"id":"00000000000000000000000002","key":"native_read_count",
                        "aggregation":"count","event_type":"native.read"})])
                } else { panic!("unexpected native request: {uri}") };
                Json(value).into_response()
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = OpenMeter {
            http: reqwest::Client::new(),
            customers: reqwest::Url::parse(&format!("http://{address}/api/v3/openmeter/customers"))
                .unwrap(),
            namespace: "isolated".into(),
            automation_native_meter_key: None,
        };
        for first in [true, false] {
            let mut tx = outer.begin().await.unwrap();
            let ae = crate::governance::lock_execution(&mut tx, child)
                .await
                .unwrap();
            assert_eq!(ae.dispatch_state, "NOT_DISPATCHED");
            let key: Uuid = sqlx::query_scalar(
                "select idempotency_key from admission.action_execution where id=$1",
            )
            .bind(child)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
            assert_eq!(key, child, "retry must retain the original admission key");
            sqlx::query(
                "update admission.action_execution set dispatch_state='DISPATCHED' where id=$1",
            )
            .bind(child)
            .execute(&mut *tx)
            .await
            .unwrap();
            sqlx::query("insert into admission.external_execution(id,operation_id,workflow_id,action_execution_id,
                tenant_id,component_binding_id,component_binding_version,component_release_id,component_projection_generation,
                protocol_operation,native_type,idempotency_key,request_digest,platform_status,cancel_capability)
                values($1,$2,$3,$2,$4,$5,2,$6,1,'execute','document.lookup',$1,$7,'PENDING_DISPATCH','UNSUPPORTED')")
                .bind(ee).bind(child).bind(&workflow).bind(tenant).bind(binding).bind(release).bind("b".repeat(64))
                .execute(&mut *tx).await.unwrap();
            let result =
                crate::application_execution::prepare_in_transaction(&client, &mut tx, &ae, ee)
                    .await;
            if first {
                assert!(
                    result.is_err(),
                    "actual native HTTP failure must reject preparation"
                );
                assert!(
                    requests.load(Ordering::SeqCst) > 0,
                    "must reach the real OpenMeter client"
                );
                tx.rollback().await.unwrap();
                let absent: bool = sqlx::query_scalar(
                    "select not exists(select 1 from admission.external_execution where id=$1)",
                )
                .bind(ee)
                .fetch_one(&mut *outer)
                .await
                .unwrap();
                assert!(
                    absent,
                    "failed dispatch cannot retain EE or its usage projection"
                );
                reject.store(false, Ordering::SeqCst);
            } else {
                result.unwrap();
                let frozen: bool = sqlx::query_scalar("select usage_projection->'meters'->0->>'key'='native_read_count' from admission.external_execution where id=$1")
                    .bind(ee).fetch_one(&mut *tx).await.unwrap();
                assert!(frozen);
                let changed = sqlx::query("update admission.external_execution set platform_status='UNKNOWN'
                    where id=$1 and platform_status='PENDING_DISPATCH' and usage_projection is not null")
                    .bind(ee).execute(&mut *tx).await.unwrap();
                assert_eq!(changed.rows_affected(), 1);
                tx.commit().await.unwrap();
            }
        }
        let final_state: (String,String) = sqlx::query_as("select a.dispatch_state,e.platform_status
            from admission.action_execution a join admission.external_execution e on e.action_execution_id=a.id where a.id=$1")
            .bind(child).fetch_one(&mut *outer).await.unwrap();
        assert_eq!(final_state, ("DISPATCHED".into(), "UNKNOWN".into()));
        outer.rollback().await.unwrap();
        server.abort();
    }

    #[tokio::test]
    async fn quota_and_message_consume_same_native_count_mapping() {
        use super::OpenMeter;
        use axum::{http::Uri, Json, Router};
        use serde_json::json;
        const CUSTOMER: &str = "00000000000000000000000001";
        const METER: &str = "00000000000000000000000002";
        const FEATURE: &str = "00000000000000000000000003";
        let tenant = uuid::Uuid::new_v4();
        let subject = format!("{tenant}:workspace");
        let customer =
            json!({"id":CUSTOMER,"key":tenant,"usage_attribution":{"subject_keys":[subject]}});
        let access = json!({"feature_key":"automation_runs","type":"metered","has_access":true,
            "value":{"balance":"0","usage":"0","overage":"0","total_available_grant_amount":"0","grant_balances":{}}});
        let app = Router::new().fallback(move |uri: Uri| {
            let customer = customer.clone();
            let access = access.clone();
            async move {
                let url = reqwest::Url::parse(&format!("http://localhost{uri}")).unwrap();
                let filters: std::collections::BTreeMap<_,_> = url.query_pairs().collect();
                let path = url.path();
                let page = |data: Vec<serde_json::Value>| json!({"meta":{"page":{"number":1,"size":100,"total":data.len()}},"data":data});
                let value = if path.ends_with("/entitlement-access/features/automation_runs") {
                    access
                } else if path.ends_with("/entitlement-access") {
                    json!({"data":[access]})
                } else if path.ends_with(CUSTOMER) {
                    customer
                } else if path.ends_with("/customers") {
                    if filters.contains_key("filter[key][eq]") { page(vec![]) } else { page(vec![customer]) }
                } else if path.ends_with("/meters") {
                    // The real v3 API rejects dotted keys. Return no match for an
                    // unmapped logical selector, rather than accepting a fake API.
                    if filters.get("filter[key][eq]").is_some_and(|v| v != "automation_run") {
                        page(vec![])
                    } else {
                        page(vec![json!({"id":METER,"key":"automation_run","aggregation":"count","event_type":"kailo.automation.run"})])
                    }
                } else if path.ends_with("/features") && filters.get("filter[meter_id][oeq]").is_some_and(|v| v == METER) {
                    page(vec![json!({"id":FEATURE,"key":"automation_runs","meter":{"id":METER}})])
                } else {
                    panic!("unexpected native request: {uri}")
                };
                Json(value)
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let mut client = OpenMeter {
            http: reqwest::Client::new(),
            customers: reqwest::Url::parse(&format!("http://{address}/api/v3/openmeter/customers"))
                .unwrap(),
            namespace: "test".into(),
            automation_native_meter_key: Some("automation_run".into()),
        };
        assert!(client
            .check_quota(tenant, CUSTOMER, &["automation.run".into()])
            .await
            .unwrap());
        let count = client
            .message_meter(tenant, CUSTOMER, &subject)
            .await
            .unwrap();
        assert_eq!(count.key, "automation.run");
        assert_eq!(count.id, METER);
        assert_eq!(count.event_type, "kailo.automation.run");
        client.automation_native_meter_key = None;
        assert!(client
            .check_quota(tenant, CUSTOMER, &["automation.run".into()])
            .await
            .is_err());
        assert!(client
            .message_meter(tenant, CUSTOMER, &subject)
            .await
            .is_err());
        server.abort();
    }
}

#[cfg(test)]
mod entitlement_value_tests {
    use super::NativeEntitlementValue;

    #[test]
    fn exhausted_value_omits_has_access() {
        let exhausted: NativeEntitlementValue = serde_json::from_str(
            r#"{"balance":0,"overage":0,"totalAvailableGrantAmount":0,"usage":0,"grantBalances":{}}"#,
        )
        .unwrap();
        assert!(!exhausted.has_access);
        assert_eq!(exhausted.usage, Some(0.0));
        let open: NativeEntitlementValue =
            serde_json::from_str(r#"{"hasAccess":true,"balance":9995,"usage":5}"#).unwrap();
        assert!(open.has_access);
    }
}

#[cfg(test)]
mod stored_event_tests {
    use super::{problem_summary, same_stored_event, wire_event, Error, OpenMeter};
    use axum::{
        body::Bytes,
        http::{StatusCode, Uri},
        response::IntoResponse,
        Json, Router,
    };
    use serde_json::{json, Value};
    use std::sync::{Arc, Mutex};

    /// Frozen exactly as the Gateway ingress writes a Tenant-level binding's
    /// `component_model_tokens` event: the binding has no Workspace.
    fn frozen_tenant_binding_tokens() -> Value {
        json!({"specversion":"1.0","source":"urn:platform:core:usage",
            "id":"8f0e7d5c-4b1a-5a2e-9c3d-2e1f0a9b8c7d","type":"kailo.component.model.tokens",
            "subject":"tenant:binding","time":"2026-10-20T17:30:00+00:00",
            "datacontenttype":"application/json",
            "data":{"tenant_id":"tenant","workspace_id":null,"operation_id":"operation",
                "component_binding_id":"binding","component_release_id":"release",
                "component_projection_generation":1,"model_call_mode":"PLATFORM_LLM_ROUTE",
                "attribution":"BINDING","provider":"openai","model":"m","totalTokens":42}})
    }

    /// The fixed native v3 problem shape for a request-body schema rejection;
    /// the reason's later lines echo the rejected value.
    fn native_null_rejection() -> Value {
        json!({"type":"about:blank","status":400,"title":"Bad Request",
            "instance":"/api/v3/openmeter/events","detail":"detail-marker",
            "invalid_parameters":[{"field":"/data/workspace_id","source":"body",
                "reason":"Value is not nullable\nValue:\n  \"value-marker\""}]})
    }

    #[test]
    fn wire_form_omits_only_null_data_members() {
        let frozen = frozen_tenant_binding_tokens();
        let wire = wire_event(&frozen);
        assert!(wire["data"].get("workspace_id").is_none());
        let mut expected = frozen.clone();
        expected["data"]
            .as_object_mut()
            .unwrap()
            .remove("workspace_id");
        assert_eq!(wire, expected);
        // The frozen outbox body itself is untouched.
        assert!(frozen["data"]["workspace_id"].is_null());
        let agent = frozen_memory_read();
        assert_eq!(wire_event(&agent), agent);
    }

    #[test]
    fn stored_read_back_matches_the_wire_form_of_a_frozen_null_dimension() {
        let frozen = frozen_tenant_binding_tokens();
        let mut native = wire_event(&frozen);
        native["time"] = json!("2026-10-20T17:30:00Z");
        same_stored_event(&frozen, native.clone()).unwrap();
        let mut filled = native.clone();
        filled["data"]["workspace_id"] = json!("workspace");
        assert!(matches!(
            same_stored_event(&frozen, filled),
            Err(Error::Conflict)
        ));
        let mut changed = native;
        changed["data"]["totalTokens"] = json!(43);
        assert!(matches!(
            same_stored_event(&frozen, changed),
            Err(Error::Conflict)
        ));
    }

    #[test]
    fn problem_summary_keeps_status_reason_and_drops_values() {
        let body = serde_json::to_vec(&native_null_rejection()).unwrap();
        let summary = problem_summary(&body);
        assert!(summary.contains("title=Bad Request"));
        assert!(summary.contains("field=/data/workspace_id"));
        assert!(summary.contains("reason=Value is not nullable"));
        assert!(!summary.contains("detail-marker"));
        assert!(!summary.contains("value-marker"));
        assert_eq!(
            problem_summary(b"<html>secret</html>"),
            "non-problem body (19 bytes)"
        );
        let many = json!({"title":"t".repeat(400),"invalid_parameters":
            (0..6).map(|n| json!({"field":format!("/f{n}"),"reason":"r"})).collect::<Vec<_>>()});
        let summary = problem_summary(&serde_json::to_vec(&many).unwrap());
        assert!(summary.starts_with(&format!("title={}", "t".repeat(160))));
        assert!(!summary.contains(&"t".repeat(161)));
        assert!(summary.contains("field=/f3") && !summary.contains("field=/f4"));
        assert!(summary.ends_with("; +2 more"));
    }

    /// A local stand-in for the fixed native ingest: it rejects any null `data`
    /// member exactly as the v3 request validator does, and records each body.
    #[tokio::test]
    async fn publish_sends_the_wire_form_and_surfaces_a_native_rejection() {
        let posted = Arc::new(Mutex::new(Vec::<Value>::new()));
        let seen = Arc::clone(&posted);
        let app = Router::new().fallback(move |uri: Uri, body: Bytes| {
            let seen = Arc::clone(&seen);
            async move {
                assert!(uri.path().ends_with("/api/v3/openmeter/events"));
                let event: Value = serde_json::from_slice(&body).unwrap();
                let rejected = event["type"] == "reject"
                    || event["data"]
                        .as_object()
                        .is_some_and(|data| data.values().any(Value::is_null));
                seen.lock().unwrap().push(event);
                if rejected {
                    (StatusCode::BAD_REQUEST, Json(native_null_rejection())).into_response()
                } else {
                    StatusCode::ACCEPTED.into_response()
                }
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = OpenMeter {
            http: reqwest::Client::new(),
            customers: reqwest::Url::parse(&format!("http://{address}/api/v3/openmeter/customers"))
                .unwrap(),
            namespace: "test".into(),
            automation_native_meter_key: None,
        };
        let frozen = frozen_tenant_binding_tokens();
        client.publish_usage(&frozen).await.unwrap();
        // Retries send the identical projected body under the same event ID.
        client.publish_usage(&frozen).await.unwrap();
        let mut rejected = frozen.clone();
        rejected["type"] = json!("reject");
        assert!(matches!(
            client.publish_usage(&rejected).await,
            Err(Error::Precondition)
        ));
        let posted = posted.lock().unwrap();
        assert_eq!(posted.len(), 3);
        assert_eq!(posted[0], wire_event(&frozen));
        assert_eq!(posted[0], posted[1]);
        assert!(posted[0]["data"].get("workspace_id").is_none());
        server.abort();
    }

    /// Frozen exactly as the Memory read outbox writes it: no datacontenttype.
    fn frozen_memory_read() -> Value {
        json!({"specversion":"1.0","source":"urn:platform:core:usage",
            "id":"366f736c-f1b7-5994-a027-908152195452","type":"kailo.agent.memory.read",
            "subject":"tenant:installation","time":"2026-10-20T06:35:04+00:00",
            "data":{"action_key":"agent.memory.entry.list","native_event_ids":[],
                "plaintext_bytes":0,"read_outcome":"COMPLETE"}})
    }

    /// The fixed OpenMeter v3 read form of the same event: seconds-precision
    /// `Z` time and a derived `application/json` content type.
    fn native_read_form(frozen: &Value) -> Value {
        let mut native = frozen.clone();
        native["time"] = json!("2026-10-20T06:35:04Z");
        native["datacontenttype"] = json!("application/json");
        native
    }

    #[test]
    fn absent_content_type_matches_the_native_derived_json_type() {
        let frozen = frozen_memory_read();
        same_stored_event(&frozen, native_read_form(&frozen)).unwrap();
    }

    #[test]
    fn explicit_json_content_type_still_matches() {
        let mut frozen = frozen_memory_read();
        frozen["datacontenttype"] = json!("application/json");
        same_stored_event(&frozen, native_read_form(&frozen)).unwrap();
    }

    #[test]
    fn content_type_data_and_time_differences_conflict() {
        let frozen = frozen_memory_read();
        let mut text = frozen.clone();
        text["datacontenttype"] = json!("text/plain");
        assert!(matches!(
            same_stored_event(&text, native_read_form(&frozen)),
            Err(Error::Conflict)
        ));
        let mut data = native_read_form(&frozen);
        data["data"]["plaintext_bytes"] = json!(1);
        assert!(matches!(
            same_stored_event(&frozen, data),
            Err(Error::Conflict)
        ));
        let mut extra = native_read_form(&frozen);
        extra["dataschema"] = json!("urn:other");
        assert!(matches!(
            same_stored_event(&frozen, extra),
            Err(Error::Conflict)
        ));
        let mut fraction = native_read_form(&frozen);
        fraction["time"] = json!("2026-10-20T06:35:04.5Z");
        assert!(matches!(
            same_stored_event(&frozen, fraction),
            Err(Error::Conflict)
        ));
        let mut untimed = frozen.clone();
        untimed.as_object_mut().unwrap().remove("time");
        assert!(matches!(
            same_stored_event(&untimed, native_read_form(&frozen)),
            Err(Error::Precondition)
        ));
    }

    #[tokio::test]
    async fn stored_usage_reads_back_a_memory_event_without_content_type() {
        let frozen = frozen_memory_read();
        let native = native_read_form(&frozen);
        let expected_filters = frozen.clone();
        let app = Router::new().fallback(move |uri: Uri| {
            let native = native.clone();
            let frozen = expected_filters.clone();
            async move {
                let url = reqwest::Url::parse(&format!("http://localhost{uri}")).unwrap();
                assert!(url.path().ends_with("/api/v3/openmeter/events"));
                for key in ["id", "source", "subject", "type"] {
                    let filter = format!("filter[{key}][eq]");
                    assert!(url
                        .query_pairs()
                        .any(|(k, v)| k == filter.as_str() && v == frozen[key].as_str().unwrap()));
                }
                Json(
                    json!({"data":[{"customer":{"id":"00000000000000000000000001"},
                    "event":native,"ingested_at":"2026-10-20T06:35:04Z",
                    "stored_at":"2026-10-20T06:35:05Z"}],
                    "meta":{"page":{"next":null,"previous":null,"size":20}}}),
                )
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = OpenMeter {
            http: reqwest::Client::new(),
            customers: reqwest::Url::parse(&format!("http://{address}/api/v3/openmeter/customers"))
                .unwrap(),
            namespace: "test".into(),
            automation_native_meter_key: None,
        };
        let evidence = client.stored_usage(&frozen).await.unwrap().unwrap();
        assert_eq!(evidence.stored_at.to_rfc3339(), "2026-10-20T06:35:05+00:00");
        assert!(!evidence.configuration_warning);
        server.abort();
    }
}
