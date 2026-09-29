//! 令牌的持有与管理平面调用。
//!
//! 刷新令牌存 OS keyring（与设备身份同一个 secret store），访问令牌只在内存。
//! 不按到期时间提前刷新——那要一个拍脑袋的提前量；而是在 BFF 回 401 时刷新一次
//! 并重试一次，两次都不行即判为需要重新登录。

use reqwest::Method;
use serde::Serialize;
use tokio::sync::Mutex;

use super::config::KailoConfig;
use super::oidc::{self, OidcError, PendingLogin, TokenResponse};
use crate::app_state::keyring_service;
use crate::secret_store::SecretStore;

/// keyring 中刷新令牌的条目名
const REFRESH_KEY: &str = "kailo-refresh-token";

/// 前端可经本模块调用的 BFF 路径前缀。其余一概不代发。
const API_PREFIX: &str = "/api/v1/";

/// 刷新令牌的存放处。应用里是 OS keyring；无图形会话的端到端核验里是内存。
pub(crate) trait RefreshStore: Send + Sync {
    fn load(&self) -> Result<Option<String>, String>;
    fn store(&self, value: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

/// OS keyring，与设备身份同一个 secret store。keyring 不可用时写入失败，登录随之
/// 失败——不退而把长期凭据写成文件。
struct KeyringStore;

impl RefreshStore for KeyringStore {
    fn load(&self) -> Result<Option<String>, String> {
        store().load(REFRESH_KEY)
    }
    fn store(&self, value: &str) -> Result<(), String> {
        store().store(REFRESH_KEY, value)
    }
    fn delete(&self) -> Result<(), String> {
        store().delete(REFRESH_KEY)
    }
}

pub(crate) struct KailoSession {
    access: Mutex<Option<String>>,
    refresh: Box<dyn RefreshStore>,
    pub(crate) pending: PendingLogin,
}

impl Default for KailoSession {
    fn default() -> Self {
        Self::with_store(Box::new(KeyringStore))
    }
}

/// BFF 的一次回应，原样交给前端：错误体里的分类、reason code 与 operationId
/// 由前端解读，这里不重新解释。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiResponse {
    pub status: u16,
    pub body: serde_json::Value,
}

/// 前端据此判断是否要回到登录页。
pub(crate) const NOT_SIGNED_IN: &str = "KAILO_NOT_SIGNED_IN";

fn store() -> &'static SecretStore {
    SecretStore::shared(keyring_service())
}

impl KailoSession {
    pub(crate) fn with_store(refresh: Box<dyn RefreshStore>) -> Self {
        Self {
            access: Mutex::new(None),
            refresh,
            pending: PendingLogin::default(),
        }
    }

    pub(crate) async fn adopt(&self, tokens: TokenResponse) -> Result<(), String> {
        // 刷新令牌是长期凭据：没有它，下次启动就得重新登录；有它却存不进
        // keyring，就不能假装已经持久登录
        match tokens.refresh_token.as_deref() {
            Some(r) => self.refresh.store(r)?,
            None => self.refresh.delete()?,
        }
        *self.access.lock().await = Some(tokens.access_token);
        Ok(())
    }

    pub(crate) fn has_credentials(&self) -> Result<bool, String> {
        Ok(self.refresh.load()?.is_some())
    }

    pub(crate) async fn sign_out(&self) -> Result<(), String> {
        *self.access.lock().await = None;
        self.refresh.delete()
    }

    async fn refresh(&self, http: &reqwest::Client, cfg: &KailoConfig) -> Result<String, String> {
        let Some(refresh_token) = self.refresh.load()? else {
            return Err(NOT_SIGNED_IN.to_owned());
        };
        match oidc::refresh(http, cfg, &refresh_token).await {
            Ok(tokens) => {
                let access = tokens.access_token.clone();
                self.adopt(tokens).await?;
                Ok(access)
            }
            // 刷新令牌被 IdP 拒绝（过期、撤销、会话已结束）：只能重新登录
            Err(OidcError::Rejected(_)) => {
                self.sign_out().await?;
                Err(NOT_SIGNED_IN.to_owned())
            }
            // IdP 暂不可达：凭据留着，稍后再试
            Err(e @ OidcError::Unavailable(_)) => Err(e.to_string()),
        }
    }

    /// 以 Bearer 调用一个 BFF 路径。401 时刷新一次并重试一次。
    pub(crate) async fn call(
        &self,
        http: &reqwest::Client,
        cfg: &KailoConfig,
        method: Method,
        path: &str,
        body: Option<&serde_json::Value>,
    ) -> Result<ApiResponse, String> {
        if !path.starts_with(API_PREFIX) || path.contains("..") {
            return Err(format!("不代发 {API_PREFIX} 之外的路径"));
        }
        let url = cfg.api_url(path)?;
        let cached = self.access.lock().await.clone();
        let mut token = match cached {
            Some(t) => t,
            None => self.refresh(http, cfg).await?,
        };
        for attempt in 0..2 {
            let mut req = http.request(method.clone(), url.clone()).bearer_auth(&token);
            if let Some(b) = body {
                req = req.json(b);
            }
            let resp = req
                .send()
                .await
                .map_err(|e| format!("Kailo 服务不可达：{e}"))?;
            let status = resp.status();
            if status == reqwest::StatusCode::UNAUTHORIZED && attempt == 0 {
                token = self.refresh(http, cfg).await?;
                continue;
            }
            if status == reqwest::StatusCode::UNAUTHORIZED {
                self.sign_out().await?;
                return Err(NOT_SIGNED_IN.to_owned());
            }
            let body = if status == reqwest::StatusCode::NO_CONTENT {
                serde_json::Value::Null
            } else {
                resp.json().await.unwrap_or(serde_json::Value::Null)
            };
            return Ok(ApiResponse {
                status: status.as_u16(),
                body,
            });
        }
        Err(NOT_SIGNED_IN.to_owned())
    }
}
