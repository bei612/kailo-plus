//! DD-37/38：固定 namespace 的原生 Customer 接入，不建立本地余额或用量账本。
//! 传输配置只来自受控部署；Customer key 只来自 Core Tenant ID。

use chrono::{DateTime, Utc};
use reqwest::{header, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
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
        .all(|value| {
            let decimal = value.strip_prefix('-').unwrap_or(value);
            let mut parts = decimal.split('.');
            let integer = parts.next().unwrap_or_default();
            let fraction = parts.next();
            !integer.is_empty()
                && integer.bytes().all(|b| b.is_ascii_digit())
                && fraction.is_none_or(|f| !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()))
                && parts.next().is_none()
        })
    }
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
    // 固定 OpenMeter Meter::Validate 只要求 key 非空。Feature ResourceKey 的
    // 下划线规则不是 meter selector 规则；DD-107 的原计数键含点号。
    // 调用方仍从原生集合查证 exact key/唯一 ID，不翻译或生成别名。
    !key.is_empty()
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
        let response = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|_| Error::Unknown)?;
        if response.status() != StatusCode::OK {
            return Err(status_error(response.status()));
        }
        response.json().await.map_err(|_| Error::Unknown)
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
        for key in meters {
            if !valid_meter_key(key) {
                return Err(Error::Precondition);
            }
            let mut meter_url = self.collection_url("meters")?;
            meter_url
                .query_pairs_mut()
                .append_pair("filter[key][eq]", key);
            let mut native_meters: Vec<Meter> = self.collection(meter_url).await?;
            let meter = match native_meters.len() {
                0 => return Err(Error::Precondition),
                1 => native_meters.pop().ok_or(Error::Unknown)?,
                _ => return Err(Error::Conflict),
            };
            if meter.key != *key || !valid_customer_id(&meter.id) || meter.deleted_at.is_some() {
                return Err(Error::Conflict);
            }
            let mut feature_url = self.collection_url("features")?;
            feature_url
                .query_pairs_mut()
                .append_pair("filter[meter_id][oeq]", &meter.id);
            let features: Vec<Feature> = self.collection(feature_url).await?;
            if features.is_empty() {
                return Err(Error::Precondition);
            }
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
        self.execution_meters(tenant, customer_id, subject, action, keys, true)
            .await
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
                "automation.run",
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
        action: &str,
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
            let matches: Vec<_> = native
                .iter()
                .filter(|m| m.key == *key && m.deleted_at.is_none())
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
                                | "$.agent_installation_resource_id"
                                | "$.agent_version_asset_id"
                                | "$.provider"
                                | "$.model"
                        )
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
        Ok((selected, InvocationMeter::for_action(action, invocation)?))
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

    /// 调用前已持久同一 CloudEvent。202 仅 ACCEPTED；网络/未知状态只 UNKNOWN。
    pub(crate) async fn publish_usage(&self, event: &Value) -> Result<(), Error> {
        let response = self
            .http
            .post(self.collection_url("events")?)
            .header(header::CONTENT_TYPE, "application/cloudevents+json")
            .json(event)
            .send()
            .await
            .map_err(|_| Error::Unknown)?;
        if response.status() != StatusCode::ACCEPTED {
            return Err(status_error(response.status()));
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
        // 固定版本 createEventsTable::toSQL 的 time 是 ClickHouse DateTime（秒）；
        // 查询 encoder 也会使用不同的 RFC3339 UTC 拼写。按原生保存精度比较，
        // 原 outbox 的 occurred_at/body 仍保持第一次原生完成时间，重试不改写。
        let expected_time = expected
            .get("time")
            .and_then(Value::as_str)
            .and_then(|time| DateTime::parse_from_rfc3339(time).ok())
            .ok_or(Error::Precondition)?;
        let stored_time = stored
            .event
            .get("time")
            .and_then(Value::as_str)
            .and_then(|time| DateTime::parse_from_rfc3339(time).ok())
            .ok_or(Error::Conflict)?;
        let mut actual = stored.event;
        let mut frozen = expected.clone();
        actual
            .as_object_mut()
            .ok_or(Error::Conflict)?
            .remove("time");
        frozen
            .as_object_mut()
            .ok_or(Error::Precondition)?
            .remove("time");
        if stored_time.timestamp() != expected_time.timestamp()
            || stored_time.timestamp_subsec_nanos() != 0
            || actual != frozen
        {
            return Err(Error::Conflict);
        }
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
    use super::{valid_meter_key, valid_resource_key};

    #[test]
    fn native_meter_selector_does_not_use_feature_key_rules() {
        assert!(valid_meter_key("automation.run"));
        assert!(valid_meter_key("input_tokens"));
        assert!(!valid_meter_key(""));
        // Feature/entitlement-access 路径继续消费原生 ResourceKey，不一起放宽。
        assert!(!valid_resource_key("automation.run"));
        assert!(valid_resource_key("input_tokens"));
    }
}
