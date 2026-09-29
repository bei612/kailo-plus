//! Core 的 service identity 令牌。
//!
//! Core 以 `kailo-core` 这个 OIDC client 的 client_credentials 取令牌，用于连
//! Temporal（permissions 声明携带 `"<namespace>:<role>"`，`SF-TMP-06`）。
//! 令牌会过期——本部署签发 900 秒；长期运行的进程持一张静态令牌，只是把失败
//! 推迟到第一次续期之后，而那时通常已经没人在看日志了。
//!
//! Worker 侧有一份等价实现（`worker/internal/oidc`）。两处不是重复：它们是两个
//! 进程、两种语言、两个不同的 client_id，共享的是协议而不是代码。

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tokio::sync::Mutex;

#[derive(Debug, thiserror::Error)]
pub enum TokenError {
    #[error("取服务令牌失败: HTTP {0}")]
    Rejected(u16),
    #[error("IdP 不可达: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("令牌响应里没有 access_token")]
    Malformed,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
}

struct Cached {
    token: String,
    till: Instant,
}

/// 按需取令牌并在到期前复用。`Clone` 共享同一份缓存。
#[derive(Clone)]
pub struct TokenSource {
    inner: Arc<Inner>,
}

struct Inner {
    token_url: String,
    client_id: String,
    secret: String,
    http: reqwest::Client,
    cached: Mutex<Option<Cached>>,
}

impl TokenSource {
    pub fn from_env() -> Result<Self, String> {
        let get = |k: &str| std::env::var(k).map_err(|_| format!("缺少 {k}"));
        Ok(Self {
            inner: Arc::new(Inner {
                token_url: get("OIDC_TOKEN_URL")?,
                client_id: get("OIDC_SERVICE_CLIENT_ID")?,
                secret: get("OIDC_SERVICE_CLIENT_SECRET")?,
                http: reqwest::Client::new(),
                cached: Mutex::new(None),
            }),
        })
    }

    /// 丢弃缓存的令牌。对端以认证失败拒绝它时调用：IdP 轮换了签名密钥，或令牌
    /// 在到期临界被判过期，此后同一张令牌永远不会再被接受。
    pub async fn invalidate(&self) {
        *self.inner.cached.lock().await = None;
    }

    pub async fn token(&self) -> Result<String, TokenError> {
        let i = &self.inner;
        let mut cached = i.cached.lock().await;
        // 用到声明的到期时刻为止。临界时刻或 IdP 轮换签名密钥后被对端拒绝的
        // 令牌，由调用方 invalidate 后重取——不靠一个猜出来的提前量。
        if let Some(c) = cached.as_ref() {
            if Instant::now() < c.till {
                return Ok(c.token.clone());
            }
        }
        let resp = i
            .http
            .post(&i.token_url)
            .form(&[
                ("grant_type", "client_credentials"),
                ("client_id", i.client_id.as_str()),
                ("client_secret", i.secret.as_str()),
            ])
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(TokenError::Rejected(resp.status().as_u16()));
        }
        let body: TokenResponse = resp.json().await?;
        if body.access_token.is_empty() {
            return Err(TokenError::Malformed);
        }
        *cached = Some(Cached {
            token: body.access_token.clone(),
            till: Instant::now() + Duration::from_secs(body.expires_in),
        });
        Ok(body.access_token)
    }
}
