//! DD-37/38：固定 namespace 的原生 Customer 接入，不建立本地余额或用量账本。
//! 传输配置只来自受控部署；Customer key 只来自 Core Tenant ID。

use chrono::{DateTime, Utc};
use reqwest::{header, StatusCode, Url};
use serde::Deserialize;
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
