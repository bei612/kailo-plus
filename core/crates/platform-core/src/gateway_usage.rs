//! DD-21、03 §3/8、11 §4：只消费 Gateway 已提交的 usage outbox。
//! 当前缺 SS-COD-TRACE 与 meter 归因事实，原记录留在 Gateway、checkpoint 不前移；
//! 不创建不可归因的 UsageEvent，不把空页或认证/传输失败当成零用量。

use std::collections::HashSet;
use std::time::Duration;

use chrono::{DateTime, Utc};
use opentelemetry::metrics::{Counter, Gauge, Meter};
use opentelemetry::KeyValue;
use reqwest::{StatusCode, Url};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::oidc::TokenSource;

/// .design/11 §4 固定的全局持久流；不是 Tenant 或模型配置。
const SOURCE_KEY: &str = "agentgateway-durable-usage-tail";

/// Native outbox 的最小只读投影。正文、attributes、cost 与模型配置均不进入 Core。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Page {
    entries: Vec<Entry>,
    next_cursor: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    seq: i64,
    id: Uuid,
    started_at: DateTime<Utc>,
    completed_at: DateTime<Utc>,
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
        let token = self
            .tokens
            .token()
            .await
            .map_err(|_| "Gateway usage 身份不可用")?;
        let response = self
            .http
            .get(self.endpoint.clone())
            .bearer_auth(token)
            .query(&[("after", after), ("limit", batch)])
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

    /// 由同一治理对账循环调用。多 Core 副本以 checkpoint 行锁互斥；原生请求和
    /// IdP 取 token 合计受现有 admin deadline 约束，不让一个副本永久占住游标。
    pub(crate) async fn reconcile(&self, pool: &PgPool, batch: i64) -> Result<(), &'static str> {
        let result = self.inspect(pool, batch).await;
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

    async fn inspect(&self, pool: &PgPool, batch: i64) -> Result<bool, &'static str> {
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
        // 没有 UsageEvent 持久幂等及全部归因证据，nextCursor 不能先写。崩溃或
        // 身份/上游失败均只重读同一稳定 ID，绝不丢掉未归因记录。
        tx.commit()
            .await
            .map_err(|_| "Gateway usage checkpoint 观察提交不明")?;
        self.pending_observed.record(page.entries.len() as u64, &[]);
        let Some(first) = page.entries.first() else {
            self.oldest_observed_age.record(0, &[]);
            self.unavailable.record(0, &[]);
            tracing::debug!("Gateway usage outbox 无适用对象；不形成计费用量结论");
            return Ok(true);
        };
        let oldest = page
            .entries
            .iter()
            .map(|entry| entry.completed_at)
            .min()
            .ok_or("Gateway usage 页没有可核验的完成时间")?;
        let age = Utc::now()
            .signed_duration_since(oldest)
            .num_seconds()
            .max(0);
        self.oldest_observed_age.record(age as u64, &[]);
        // 当前 producer 没有 Core trace→Session/Invocation/Operation 与 provider
        // meter/reservation 的完整事实；不能用 native trace、时间或 model 名猜。
        tracing::warn!(source_id = %first.id, cursor = after, next_cursor = page.next_cursor,
            state = "UNKNOWN", reason_code = "BILLING_UNAVAILABLE",
            "Gateway durable usage 待对账：缺权威归因与 meter 事实，原 checkpoint 不前移");
        Err("BILLING_UNAVAILABLE：Gateway durable usage 归因待对账，原游标保留")
    }
}
