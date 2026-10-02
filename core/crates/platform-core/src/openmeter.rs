//! DD-37/38：固定 namespace 的原生 Customer 接入，不建立本地余额或用量账本。
//! 传输配置只来自受控部署；Customer key 只来自 Core Tenant ID。

use chrono::{DateTime, Utc};
use reqwest::{header, StatusCode, Url};
use serde::Deserialize;
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
            if !valid_resource_key(key) {
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
