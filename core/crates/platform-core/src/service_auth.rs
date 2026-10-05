//! Worker → Core service API 的调用方认证。
//!
//! 这条路径不经 AgentGateway：网关是 Browser 侧的 OIDC PEP，它的路由以
//! `pathPrefix: /` 整体转发给 BFF，只投影 issuer/subject 两条 header
//! （`SS-AGW-OIDC`）。把服务面挂在同一个 listener 上，等于让任何登录用户能
//! 打到成员状态的写入口；因此服务面自带监听端口、自带认证。
//!
//! 认证用 `apps/01` §9 要求的「最小 service identity」：Worker 持自己的
//! OIDC client（部署配置 `OIDC_WORKER_CLIENT_ID`）以 client_credentials 取令牌，Core 验签并
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

/// DD-105: Gateway's native jwtSign identity is not the Worker's OIDC identity.
/// Only public verification material is mounted into Core. Every request reads
/// the mounted file again; there is no independent verification-key cache.
pub(crate) struct GatewayServiceAuth {
    issuer: String,
    audience: String,
    caller: String,
    jwks_file: std::path::PathBuf,
    max_token_seconds: u64,
    signing_key_file: String,
    key_id: String,
    token_seconds: u64,
    mcp_url: reqwest::Url,
    ext_mcp_url: reqwest::Url,
}

#[derive(Deserialize)]
struct GatewayClaims {
    sub: String,
    azp: String,
    iat: u64,
    exp: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GatewayPublicKeys {
    keys: Vec<GatewayPublicKey>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GatewayPublicKey {
    kty: String,
    crv: String,
    alg: String,
    kid: String,
    x: String,
    y: String,
    #[serde(rename = "use")]
    purpose: Option<String>,
    key_ops: Option<Vec<String>>,
}

impl GatewayServiceAuth {
    pub(crate) fn shares_identity(&self, issuer: &str, audience: &str) -> bool {
        self.issuer == issuer || self.audience == audience
    }

    pub(crate) fn from_env(worker: &ServiceAuth) -> Result<Option<Self>, String> {
        let names = [
            "GATEWAY_SERVICE_ISSUER",
            "GATEWAY_SERVICE_AUDIENCE",
            "GATEWAY_SERVICE_CALLER_ID",
            "GATEWAY_SERVICE_JWKS_FILE",
            "GATEWAY_SERVICE_MAX_TOKEN_SECONDS",
            "GATEWAY_SERVICE_SIGNING_KEY_FILE",
            "GATEWAY_SERVICE_KEY_ID",
            "GATEWAY_SERVICE_TOKEN_SECONDS",
            "AGENT_TOOL_MCP_URL",
            "AGENT_TOOL_EXT_MCP_URL",
        ];
        let values = names.map(|name| {
            std::env::var(name)
                .ok()
                .filter(|value| !value.trim().is_empty())
        });
        if values.iter().all(Option::is_none) {
            return Ok(None);
        }
        let [issuer, audience, caller, file, maximum, signing_file, key_id, lifetime, mcp_url, ext_mcp_url] =
            values.map(|value| value.filter(|value| !value.trim().is_empty()));
        let (
            Some(issuer),
            Some(audience),
            Some(caller),
            Some(file),
            Some(maximum),
            Some(signing_file),
            Some(key_id),
            Some(lifetime),
            Some(mcp_url),
            Some(ext_mcp_url),
        ) = (
            issuer,
            audience,
            caller,
            file,
            maximum,
            signing_file,
            key_id,
            lifetime,
            mcp_url,
            ext_mcp_url,
        )
        else {
            return Err("Gateway service authentication 配置不完整".into());
        };
        let max_token_seconds: u64 = maximum
            .parse()
            .map_err(|_| "GATEWAY_SERVICE_MAX_TOKEN_SECONDS 无效")?;
        let token_seconds: u64 = lifetime
            .parse()
            .map_err(|_| "GATEWAY_SERVICE_TOKEN_SECONDS 无效")?;
        let mcp_url = Self::url(&mcp_url)?;
        let ext_mcp_url = Self::url(&ext_mcp_url)?;
        if mcp_url.path() != "/service/v1/agent-tools/mcp" || ext_mcp_url.path() != "/" {
            return Err("Agent Tool transport URL 路径无效".into());
        }
        // Fixed jwtSign backdates iat by ten seconds; ttl is strictly positive.
        if max_token_seconds <= 10
            || token_seconds == 0
            || token_seconds
                .checked_add(10)
                .is_none_or(|age| age > max_token_seconds)
            || issuer == worker.issuer
            || audience == worker.audience
            || caller == worker.caller_client_id
            || !std::path::Path::new(&file).is_absolute()
            || !std::path::Path::new(&signing_file).is_absolute()
        {
            return Err("Gateway service identity 必须独立且有效".into());
        }
        Ok(Some(Self {
            issuer,
            audience,
            caller,
            jwks_file: file.into(),
            max_token_seconds,
            signing_key_file: signing_file,
            key_id,
            token_seconds,
            mcp_url,
            ext_mcp_url,
        }))
    }

    fn url(value: &str) -> Result<reqwest::Url, String> {
        let url = reqwest::Url::parse(value).map_err(|_| "Agent Tool transport URL 无效")?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("Agent Tool transport URL 无效".into());
        }
        Ok(url)
    }

    pub(crate) fn mcp_url(&self) -> &reqwest::Url {
        &self.mcp_url
    }

    pub(crate) fn ext_mcp_url(&self) -> &reqwest::Url {
        &self.ext_mcp_url
    }

    /// Native AgentGateway BackendAuth, not an OAuth flow or a static bearer.
    /// The path is resolved by Gateway; Core never reads the signing key.
    pub(crate) fn backend_auth(&self) -> serde_json::Value {
        serde_json::json!({"jwtSign": {
            "signingKey": {"file": self.signing_key_file},
            "alg": "ES256", "kid": self.key_id,
            "claims": {"iss": self.issuer, "aud": self.audience,
                "sub": self.caller, "azp": self.caller},
            "ttl": format!("{}s", self.token_seconds)
        }})
    }

    /// ADR-12: transport identity is distinct from the per-action bearer.
    /// The existing native signer still owns its private key; Core only
    /// projects the approved adapter's exact audience and header location.
    pub(crate) fn adapter_backend_auth(
        &self,
        audience: &str,
    ) -> Result<serde_json::Value, ServiceAuthError> {
        if audience.is_empty() || audience.trim() != audience || audience == self.audience {
            return Err(ServiceAuthError::TokenInvalid);
        }
        let mut auth = self.backend_auth();
        auth["jwtSign"]["claims"]["aud"] = serde_json::json!(audience);
        auth["jwtSign"]["location"] = serde_json::json!({"header":{
            "name":"x-kailo-gateway-authorization","prefix":"Bearer "}});
        Ok(auth)
    }

    pub(crate) async fn validate_configuration(&self) -> Result<(), ServiceAuthError> {
        let bytes = tokio::fs::read(&self.jwks_file)
            .await
            .map_err(|_| ServiceAuthError::KeysUnavailable)?;
        let keys = Self::public_keys(&bytes)?;
        if !keys.keys.iter().any(|key| key.kid == self.key_id) {
            return Err(ServiceAuthError::KeysUnavailable);
        }
        Ok(())
    }

    pub(crate) async fn verify(&self, header: Option<&str>) -> Result<(), ServiceAuthError> {
        let token = header
            .and_then(|header| header.strip_prefix("Bearer "))
            .filter(|token| !token.is_empty())
            .ok_or(ServiceAuthError::TokenMissing)?;
        let bytes = tokio::fs::read(&self.jwks_file)
            .await
            .map_err(|_| ServiceAuthError::KeysUnavailable)?;
        self.verify_with_keys(token, &bytes, jsonwebtoken::get_current_timestamp())
    }

    fn verify_with_keys(
        &self,
        token: &str,
        bytes: &[u8],
        now: u64,
    ) -> Result<(), ServiceAuthError> {
        let header = decode_header(token).map_err(|_| ServiceAuthError::TokenInvalid)?;
        let kid = header
            .kid
            .as_deref()
            .filter(|kid| !kid.is_empty())
            .ok_or(ServiceAuthError::TokenInvalid)?;
        if header.alg != Algorithm::ES256 {
            return Err(ServiceAuthError::TokenInvalid);
        }
        let keys = Self::public_keys(bytes)?;
        let public = keys
            .keys
            .iter()
            .find(|key| key.kid == kid)
            .ok_or(ServiceAuthError::TokenInvalid)?;
        let key = DecodingKey::from_ec_components(&public.x, &public.y)
            .map_err(|_| ServiceAuthError::KeysUnavailable)?;
        let mut validation = Validation::new(Algorithm::ES256);
        validation.leeway = 0;
        validation.set_issuer(&[&self.issuer]);
        validation.set_audience(&[&self.audience]);
        validation.set_required_spec_claims(&["exp", "iat", "iss", "aud", "sub"]);
        let claims = decode::<GatewayClaims>(token, &key, &validation)
            .map_err(|_| ServiceAuthError::TokenInvalid)?
            .claims;
        if claims.sub != self.caller
            || claims.azp != self.caller
            || claims.iat > now
            || claims.exp <= now
            || !claims
                .exp
                .checked_sub(claims.iat)
                .is_some_and(|lifetime| lifetime > 0 && lifetime <= self.max_token_seconds)
        {
            return Err(ServiceAuthError::TokenInvalid);
        }
        Ok(())
    }

    fn public_keys(bytes: &[u8]) -> Result<GatewayPublicKeys, ServiceAuthError> {
        let keys: GatewayPublicKeys =
            serde_json::from_slice(bytes).map_err(|_| ServiceAuthError::KeysUnavailable)?;
        if keys.keys.is_empty() {
            return Err(ServiceAuthError::KeysUnavailable);
        }
        let mut kids = std::collections::HashSet::new();
        for key in &keys.keys {
            if key.kty != "EC"
                || key.crv != "P-256"
                || key.alg != "ES256"
                || key.purpose.as_deref().is_some_and(|value| value != "sig")
                || key
                    .key_ops
                    .as_ref()
                    .is_some_and(|value| value.as_slice() != ["verify"])
                || key.kid.is_empty()
                || !kids.insert(key.kid.as_str())
            {
                return Err(ServiceAuthError::KeysUnavailable);
            }
            for coordinate in [&key.x, &key.y] {
                if coordinate.len() != 43
                    || !coordinate
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
                {
                    return Err(ServiceAuthError::KeysUnavailable);
                }
            }
            DecodingKey::from_ec_components(&key.x, &key.y)
                .map_err(|_| ServiceAuthError::KeysUnavailable)?;
        }
        Ok(keys)
    }
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
    pub(crate) fn shares_identity(&self, issuer: &str, audience: &str) -> bool {
        self.issuer == issuer || self.audience == audience
    }

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
        self.verify_client(header_value, &self.caller_client_id)
            .await
    }

    /// Adapter callbacks use the same IdP/JWKS verifier, but their expected
    /// client must be resolved from the exact binding by the caller. This does
    /// not add any client to Worker routes or make audience a principal lookup.
    pub(crate) async fn verify_binding_client(
        &self,
        header_value: Option<&str>,
        client_id: &str,
    ) -> Result<(), ServiceAuthError> {
        if client_id.is_empty() || client_id == self.caller_client_id {
            return Err(ServiceAuthError::TokenInvalid);
        }
        self.verify_client(header_value, client_id)
            .await
            .map(|_| ())
    }

    async fn verify_client(
        &self,
        header_value: Option<&str>,
        expected_client: &str,
    ) -> Result<String, ServiceAuthError> {
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
        if data.claims.azp != expected_client {
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

#[cfg(test)]
mod gateway_tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use ring::signature::KeyPair;
    use serde_json::{json, Value};

    fn fixture() -> (GatewayServiceAuth, jsonwebtoken::EncodingKey, Value, Value) {
        // Ephemeral test-only signing material: never persisted or logged and
        // unrelated to any deployment identity or OpenBao SecretRef.
        let rng = ring::rand::SystemRandom::new();
        let algorithm = &ring::signature::ECDSA_P256_SHA256_ASN1_SIGNING;
        let private = ring::signature::EcdsaKeyPair::generate_pkcs8(algorithm, &rng).unwrap();
        let pair =
            ring::signature::EcdsaKeyPair::from_pkcs8(algorithm, private.as_ref(), &rng).unwrap();
        let public = pair.public_key().as_ref();
        let keys = json!({"keys": [{"kty":"EC","crv":"P-256","alg":"ES256",
            "kid":"ephemeral", "use":"sig", "key_ops":["verify"],
            "x":URL_SAFE_NO_PAD.encode(&public[1..33]),
            "y":URL_SAFE_NO_PAD.encode(&public[33..65])}]});
        let now = jsonwebtoken::get_current_timestamp();
        let claims = json!({"iss":"urn:test:gateway","aud":"urn:test:core-mcp",
            "sub":"test-gateway","azp":"test-gateway","iat":now-10,"exp":now+60});
        let auth = GatewayServiceAuth {
            issuer: "urn:test:gateway".into(),
            audience: "urn:test:core-mcp".into(),
            caller: "test-gateway".into(),
            jwks_file: "/not-used-in-unit-test".into(),
            max_token_seconds: 70,
            signing_key_file: "/gateway-only/test-key".into(),
            key_id: "ephemeral".into(),
            token_seconds: 60,
            mcp_url: GatewayServiceAuth::url("http://core.test:8081/service/v1/agent-tools/mcp")
                .unwrap(),
            ext_mcp_url: GatewayServiceAuth::url("http://core.test:8081/").unwrap(),
        };
        (
            auth,
            jsonwebtoken::EncodingKey::from_ec_der(private.as_ref()),
            keys,
            claims,
        )
    }

    fn signed(key: &jsonwebtoken::EncodingKey, claims: &Value) -> String {
        let mut header = jsonwebtoken::Header::new(Algorithm::ES256);
        header.kid = Some("ephemeral".into());
        jsonwebtoken::encode(&header, claims, key).unwrap()
    }

    #[test]
    fn gateway_native_signer_identity_and_public_key_are_exact() {
        let (auth, key, keys, claims) = fixture();
        let encoded = serde_json::to_vec(&keys).unwrap();
        let now = jsonwebtoken::get_current_timestamp();
        assert!(auth
            .verify_with_keys(&signed(&key, &claims), &encoded, now)
            .is_ok());
        for field in ["iss", "aud", "sub", "azp"] {
            let mut changed = claims.clone();
            changed[field] = json!("worker-or-other-caller");
            assert!(
                auth.verify_with_keys(&signed(&key, &changed), &encoded, now)
                    .is_err(),
                "{field}"
            );
        }
        for field in ["iss", "aud", "sub", "azp", "iat", "exp"] {
            let mut changed = claims.clone();
            changed.as_object_mut().unwrap().remove(field);
            assert!(
                auth.verify_with_keys(&signed(&key, &changed), &encoded, now)
                    .is_err(),
                "missing {field}"
            );
        }
    }

    #[test]
    fn gateway_native_expiry_and_maximum_include_backdate() {
        let (auth, key, keys, claims) = fixture();
        let encoded = serde_json::to_vec(&keys).unwrap();
        let now = jsonwebtoken::get_current_timestamp();
        for (iat, exp) in [(now + 1, now + 60), (now - 10, now), (now - 11, now + 60)] {
            let mut changed = claims.clone();
            changed["iat"] = json!(iat);
            changed["exp"] = json!(exp);
            assert!(auth
                .verify_with_keys(&signed(&key, &changed), &encoded, now)
                .is_err());
        }
        let projection = auth.backend_auth();
        assert_eq!(projection["jwtSign"]["alg"], "ES256");
        assert_eq!(projection["jwtSign"]["ttl"], "60s");
        assert_eq!(projection["jwtSign"]["claims"]["sub"], "test-gateway");
        assert!(projection["jwtSign"]["claims"].get("iat").is_none());
        assert_eq!(auth.ext_mcp_url().authority(), "core.test:8081");
    }

    #[test]
    fn gateway_jwks_rejects_private_material_duplicate_and_revoked_key() {
        let (auth, key, keys, claims) = fixture();
        let token = signed(&key, &claims);
        let now = jsonwebtoken::get_current_timestamp();
        for field in ["d", "p", "k", "unknownPrivateField"] {
            let mut changed = keys.clone();
            changed["keys"][0][field] = json!("not-a-secret-test-marker");
            assert!(auth
                .verify_with_keys(&token, &serde_json::to_vec(&changed).unwrap(), now)
                .is_err());
        }
        let mut duplicate = keys.clone();
        duplicate["keys"]
            .as_array_mut()
            .unwrap()
            .push(keys["keys"][0].clone());
        assert!(auth
            .verify_with_keys(&token, &serde_json::to_vec(&duplicate).unwrap(), now)
            .is_err());
        assert!(auth
            .verify_with_keys(&token, br#"{"keys":[]}"#, now)
            .is_err());
        let mut rotated = keys;
        rotated["keys"][0]["kid"] = json!("replacement");
        assert!(auth
            .verify_with_keys(&token, &serde_json::to_vec(&rotated).unwrap(), now)
            .is_err());
    }
}
