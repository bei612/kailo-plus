//! Worker → Core service API 的调用方认证。
//!
//! 这条路径不经 AgentGateway：网关是 Browser 侧的 OIDC PEP，它的路由以
//! `pathPrefix: /` 整体转发给 BFF，只投影 issuer/subject 两条 header
//! （`SS-AGW-OIDC`）。把服务面挂在同一个 listener 上，等于让任何登录用户能
//! 打到成员状态的写入口；因此服务面自带监听端口、自带认证。
//!
//! 认证用 `apps/01` §9 要求的「最小 service identity」：Worker 持自己的
//! OIDC client（`kailo-worker`）以 client_credentials 取令牌，Core 验签并
//! 逐条核对 issuer、audience、授权方与有效期。五项任一不成立即拒绝。

use std::sync::Arc;

use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use tokio::sync::RwLock;

#[derive(Debug, thiserror::Error)]
pub enum ServiceAuthError {
    #[error("缺少 Authorization: Bearer 令牌")]
    TokenMissing,
    #[error("令牌不可验证")]
    TokenInvalid,
    #[error("签名密钥不可得")]
    KeysUnavailable,
}

/// 令牌里被本模块判定用到的声明。其余声明一概不读——读了就会有人想拿它
/// 做业务授权，而 service identity 只认证服务，不表达 HUMAN/AGENT 权限
/// （`DD-37`、`.design/03` §9）。
#[derive(Debug, Deserialize)]
struct ServiceClaims {
    /// 授权方（Keycloak 对 client_credentials 令牌填发起客户端的 client_id）
    azp: String,
}

/// service API 的认证器。
pub struct ServiceAuth {
    issuer: String,
    audience: String,
    /// 允许调用的 client_id。只有一个：Worker。别的服务要调就显式加进来，
    /// 不做通配——通配等于「本 realm 任何客户端都能写成员状态」。
    caller_client_id: String,
    jwks_uri: String,
    http: reqwest::Client,
    cached: RwLock<Option<Arc<JwkSet>>>,
}

impl ServiceAuth {
    /// 五个配置项都不接受默认值：任一缺失都说明服务面没被正确接上，
    /// 此时以某个猜测值启动就是把认证边界交给巧合。
    pub fn from_env() -> Result<Self, String> {
        let get = |k: &str| std::env::var(k).map_err(|_| format!("缺少 {k}"));
        Ok(Self {
            issuer: get("SERVICE_OIDC_ISSUER")?,
            audience: get("SERVICE_OIDC_AUDIENCE")?,
            caller_client_id: get("SERVICE_CALLER_CLIENT_ID")?,
            jwks_uri: get("SERVICE_OIDC_JWKS_URI")?,
            http: reqwest::Client::new(),
            cached: RwLock::new(None),
        })
    }

    /// 校验一个 Bearer 令牌，通过则返回授权方 client_id。
    pub async fn verify(&self, header_value: Option<&str>) -> Result<String, ServiceAuthError> {
        let token = header_value
            .and_then(|v| v.strip_prefix("Bearer "))
            .filter(|t| !t.is_empty())
            .ok_or(ServiceAuthError::TokenMissing)?;

        let kid = decode_header(token)
            .map_err(|_| ServiceAuthError::TokenInvalid)?
            .kid
            .ok_or(ServiceAuthError::TokenInvalid)?;

        // 先用缓存的 JWKS；找不到该 kid 再刷新一次。轮换会引入新 kid，
        // 每次请求都拉 JWKS 会把 IdP 变成同步依赖。
        let mut jwks = self.jwks(false).await?;
        if jwks.find(&kid).is_none() {
            jwks = self.jwks(true).await?;
        }
        let jwk = jwks.find(&kid).ok_or(ServiceAuthError::TokenInvalid)?;

        // 算法白名单取自密钥自身声明的算法，且只接受非对称签名。
        // 不读令牌头里的 alg：那是攻击者可控的字段，按它选算法就是经典的
        // alg 混淆漏洞（HMAC 冒充，甚至 none）。
        let alg = match jwk
            .common
            .key_algorithm
            .and_then(|a| a.to_string().parse().ok())
        {
            Some(a @ (Algorithm::RS256 | Algorithm::RS384 | Algorithm::RS512))
            | Some(a @ (Algorithm::ES256 | Algorithm::ES384))
            | Some(a @ Algorithm::EdDSA) => a,
            _ => return Err(ServiceAuthError::TokenInvalid),
        };

        let key = DecodingKey::from_jwk(jwk).map_err(|_| ServiceAuthError::TokenInvalid)?;
        let mut validation = Validation::new(alg);
        validation.set_issuer(&[&self.issuer]);
        validation.set_audience(&[&self.audience]);
        // exp 由库默认校验；显式要求它存在，免得无过期令牌被接受
        validation.set_required_spec_claims(&["exp", "iss", "aud"]);

        let data = decode::<ServiceClaims>(token, &key, &validation)
            .map_err(|_| ServiceAuthError::TokenInvalid)?;

        // audience 说明「这张票是开给 Core 的」，azp 说明「是谁来敲的」。
        // 两者都要：同 realm 内别的客户端也可能被配上同一 audience。
        if data.claims.azp != self.caller_client_id {
            return Err(ServiceAuthError::TokenInvalid);
        }
        Ok(data.claims.azp)
    }

    async fn jwks(&self, refresh: bool) -> Result<Arc<JwkSet>, ServiceAuthError> {
        if !refresh {
            if let Some(cached) = self.cached.read().await.clone() {
                return Ok(cached);
            }
        }
        let fetched: JwkSet = self
            .http
            .get(&self.jwks_uri)
            .send()
            .await
            .map_err(|_| ServiceAuthError::KeysUnavailable)?
            .json()
            .await
            .map_err(|_| ServiceAuthError::KeysUnavailable)?;
        let fetched = Arc::new(fetched);
        *self.cached.write().await = Some(Arc::clone(&fetched));
        Ok(fetched)
    }
}
