//! Core 的 service identity 令牌。
//!
//! Core 以部署配置 `OIDC_SERVICE_CLIENT_ID` 指定的 OIDC client 的 client_credentials 取令牌，用于连
//! Temporal（permissions 声明携带 `"<namespace>:<role>"`，`SF-TMP-06`）。
//! 令牌会过期——本部署签发 900 秒；长期运行的进程持一张静态令牌，只是把失败
//! 推迟到第一次续期之后，而那时通常已经没人在看日志了。
//!
//! Worker 侧有一份等价实现（`worker/internal/oidc`）。两处不是重复：它们是两个
//! 进程、两种语言、两个不同的 client_id，共享的是协议而不是代码。
//!
//! MCP 管理调用（DD-137）的令牌另以 OAuth 2.0 `scope` 申请专用 Core MCP 受众，与
//! Temporal、Gateway 管理面等其他用途的令牌分开取得、分开缓存。

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
    /// 申请的 OAuth 2.0 scope；`None` 即不带 scope 的默认令牌。
    scope: Option<String>,
    http: reqwest::Client,
    cached: Mutex<Option<Cached>>,
}

impl TokenSource {
    pub fn from_env() -> Result<Self, String> {
        Self::with_scope(None)
    }

    /// DD-137：MCP 管理调用的令牌。scope 名即部署配置的专用 Core MCP 受众
    /// （`CORE_MCP_AUDIENCE`）；IdP 只在申请该 scope 时签入它。
    pub fn core_mcp() -> Result<Self, String> {
        Self::with_scope(Some(core_mcp_audience()?))
    }

    fn with_scope(scope: Option<String>) -> Result<Self, String> {
        let get = |k: &str| std::env::var(k).map_err(|_| format!("缺少 {k}"));
        Ok(Self {
            inner: Arc::new(Inner {
                token_url: get("OIDC_TOKEN_URL")?,
                client_id: get("OIDC_SERVICE_CLIENT_ID")?,
                secret: get("OIDC_SERVICE_CLIENT_SECRET")?,
                scope,
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
        let mut form = vec![
            ("grant_type", "client_credentials"),
            ("client_id", i.client_id.as_str()),
            ("client_secret", i.secret.as_str()),
        ];
        if let Some(scope) = i.scope.as_deref() {
            form.push(("scope", scope));
        }
        let resp = i.http.post(&i.token_url).form(&form).send().await?;
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

/// DD-137 的专用 Core MCP 受众（同时是申请它的 scope 名）。必须显式配置，且不得与
/// Core service API 受众或 Gateway 管理面受众相同：相同就等于让 MCP 令牌也能调用
/// 那两个面，专用受众失去意义。值只含 scope 允许的可见 ASCII 字符。
pub(crate) fn core_mcp_audience() -> Result<String, String> {
    let value =
        std::env::var("CORE_MCP_AUDIENCE").map_err(|_| "缺少 CORE_MCP_AUDIENCE".to_string())?;
    let distinct = [
        "SERVICE_OIDC_AUDIENCE",
        "OIDC_SERVICE_CLIENT_ID",
        "AGENTGATEWAY_ADMIN_AUDIENCE",
    ]
    .iter()
    .all(|other| std::env::var(other).ok().as_deref() != Some(value.as_str()));
    if !valid_scope_token(&value) || !distinct {
        return Err("CORE_MCP_AUDIENCE 无效".into());
    }
    Ok(value)
}

/// RFC 6749 §3.3 的 scope-token：%x21 / %x23-5B / %x5D-7E，非空。
fn valid_scope_token(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b == 0x21 || (0x23..=0x5B).contains(&b) || (0x5D..=0x7E).contains(&b))
}

#[cfg(test)]
mod tests {
    use super::valid_scope_token;

    #[test]
    fn scope_token_follows_rfc_6749() {
        for ok in ["kailo-core-mcp", "urn:kailo:core-mcp", "a.b_c~d"] {
            assert!(valid_scope_token(ok), "{ok}");
        }
        for bad in [
            "",
            "two words",
            "quote\"d",
            "back\\slash",
            "tab\t",
            "非ascii",
        ] {
            assert!(!valid_scope_token(bad), "{bad}");
        }
    }
}
