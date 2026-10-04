//! DD-105 / 12 §4: short-lived per-Session identity, never an ActionToken.
//! The key is process-local and is never written to a profile or database.
//! Restart requires the original Gateway projection + thread resume/reload;
//! an old signature cannot be turned into new authority by a cache fallback.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use ring::signature::KeyPair;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::service_auth::{GatewayServiceAuth, ServiceAuth};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SessionScope {
    pub(crate) tenant_id: Uuid,
    pub(crate) workspace_id: Uuid,
    pub(crate) installation_resource_id: Uuid,
    pub(crate) agent_principal_id: Uuid,
    pub(crate) agent_version_asset_id: Uuid,
    pub(crate) projection_generation: i64,
    // This is the original Session key, not a new Nostr event. SCHEDULE roots
    // deliberately have a different syntax from BUZZ_EVENT's 64 hex characters.
    pub(crate) root_event_id: String,
}

impl SessionScope {
    fn valid(&self) -> bool {
        [
            self.tenant_id,
            self.workspace_id,
            self.installation_resource_id,
            self.agent_principal_id,
            self.agent_version_asset_id,
        ]
        .iter()
        .all(|id| !id.is_nil())
            && self.projection_generation > 0
            && !self.root_event_id.is_empty()
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Claims {
    iss: String,
    aud: String,
    sub: String,
    iat: u64,
    exp: u64,
    jti: Uuid,
    tenant_id: Uuid,
    workspace_id: Uuid,
    installation_resource_id: Uuid,
    agent_principal_id: Uuid,
    agent_version_asset_id: Uuid,
    projection_generation: i64,
    root_event_id: String,
}

#[derive(Debug, thiserror::Error)]
#[error("Agent Tool Session token 不可核验")]
pub(crate) struct SessionTokenError;

pub(crate) struct VerifiedSession {
    pub(crate) scope: SessionScope,
}

pub(crate) struct SessionSigner {
    issuer: String,
    audience: String,
    lifetime: u64,
    gateway_url: reqwest::Url,
    gateway_name: String,
    kid: String,
    encoding: EncodingKey,
    decoding: DecodingKey,
    public: Value,
}

impl SessionSigner {
    pub(crate) fn from_env(
        worker: &ServiceAuth,
        gateway: Option<&GatewayServiceAuth>,
    ) -> Result<Option<Self>, String> {
        let names = [
            "AGENT_TOOL_SESSION_ISSUER",
            "AGENT_TOOL_SESSION_AUDIENCE",
            "AGENT_TOOL_SESSION_TOKEN_SECONDS",
            "AGENT_TOOL_GATEWAY_URL",
            "AGENT_TOOL_GATEWAY_NAME",
        ];
        let values = names.map(|name| {
            std::env::var(name)
                .ok()
                .filter(|value| !value.trim().is_empty())
        });
        if values.iter().all(Option::is_none) && gateway.is_none() {
            return Ok(None);
        }
        let [Some(issuer), Some(audience), Some(lifetime), Some(url), Some(gateway_name)] = values
        else {
            return Err("Agent Tool Session 与 Gateway service 配置必须完整投递".into());
        };
        let gateway = gateway.ok_or("Agent Tool Session 缺独立 Gateway service 身份")?;
        if worker.shares_identity(&issuer, &audience) || gateway.shares_identity(&issuer, &audience)
        {
            return Err("Agent Tool Session issuer/audience 不得复用 service 身份".into());
        }
        let lifetime: u64 = lifetime
            .parse()
            .map_err(|_| "AGENT_TOOL_SESSION_TOKEN_SECONDS 无效")?;
        let gateway_url = reqwest::Url::parse(&url).map_err(|_| "AGENT_TOOL_GATEWAY_URL 无效")?;
        if lifetime == 0
            || !matches!(gateway_url.scheme(), "http" | "https")
            || gateway_url.host_str().is_none()
            || !gateway_url.username().is_empty()
            || gateway_url.password().is_some()
            || gateway_url.query().is_some()
            || gateway_url.fragment().is_some()
        {
            return Err("Agent Tool Session 时限/URL 无效".into());
        }
        Self::new(issuer, audience, lifetime, gateway_url, gateway_name)
            .map(Some)
            .map_err(|_| "Agent Tool Session signer 初始化失败".into())
    }

    fn new(
        issuer: String,
        audience: String,
        lifetime: u64,
        gateway_url: reqwest::Url,
        gateway_name: String,
    ) -> Result<Self, SessionTokenError> {
        let rng = ring::rand::SystemRandom::new();
        let algorithm = &ring::signature::ECDSA_P256_SHA256_FIXED_SIGNING;
        let private = ring::signature::EcdsaKeyPair::generate_pkcs8(algorithm, &rng)
            .map_err(|_| SessionTokenError)?;
        let pair = ring::signature::EcdsaKeyPair::from_pkcs8(algorithm, private.as_ref(), &rng)
            .map_err(|_| SessionTokenError)?;
        let public = pair.public_key().as_ref();
        let x = URL_SAFE_NO_PAD.encode(&public[1..33]);
        let y = URL_SAFE_NO_PAD.encode(&public[33..65]);
        let kid = Uuid::new_v4().to_string();
        let decoding = DecodingKey::from_ec_components(&x, &y).map_err(|_| SessionTokenError)?;
        Ok(Self {
            issuer,
            audience,
            lifetime,
            gateway_url,
            gateway_name,
            kid: kid.clone(),
            encoding: EncodingKey::from_ec_der(private.as_ref()),
            decoding,
            public: json!({"keys":[{"kty":"EC","crv":"P-256","alg":"ES256",
                "kid":kid,"use":"sig","key_ops":["verify"],"x":x,"y":y}]}),
        })
    }

    pub(crate) fn issuer(&self) -> &str {
        &self.issuer
    }
    pub(crate) fn audience(&self) -> &str {
        &self.audience
    }
    pub(crate) fn gateway_url(&self) -> &reqwest::Url {
        &self.gateway_url
    }
    pub(crate) fn gateway_name(&self) -> &str {
        &self.gateway_name
    }
    pub(crate) fn public_jwks(&self) -> &Value {
        &self.public
    }

    /// The caller must supply the actual frozen Session, not client claims.
    pub(crate) fn issue(&self, scope: &SessionScope) -> Result<String, SessionTokenError> {
        if !scope.valid() {
            return Err(SessionTokenError);
        }
        let now = jsonwebtoken::get_current_timestamp();
        let claims = Claims {
            iss: self.issuer.clone(),
            aud: self.audience.clone(),
            sub: scope.agent_principal_id.to_string(),
            iat: now,
            exp: now.checked_add(self.lifetime).ok_or(SessionTokenError)?,
            jti: Uuid::new_v4(),
            tenant_id: scope.tenant_id,
            workspace_id: scope.workspace_id,
            installation_resource_id: scope.installation_resource_id,
            agent_principal_id: scope.agent_principal_id,
            agent_version_asset_id: scope.agent_version_asset_id,
            projection_generation: scope.projection_generation,
            root_event_id: scope.root_event_id.clone(),
        };
        let mut header = Header::new(Algorithm::ES256);
        header.kid = Some(self.kid.clone());
        jsonwebtoken::encode(&header, &claims, &self.encoding).map_err(|_| SessionTokenError)
    }

    /// Verifies identity only. The PEP must still resolve the exact Session and
    /// active Invocation and freshly authorize every tool/argument/exposure.
    pub(crate) fn verify(&self, token: &str) -> Result<VerifiedSession, SessionTokenError> {
        let header = jsonwebtoken::decode_header(token).map_err(|_| SessionTokenError)?;
        if header.alg != Algorithm::ES256 || header.kid.as_deref() != Some(self.kid.as_str()) {
            return Err(SessionTokenError);
        }
        let mut validation = Validation::new(Algorithm::ES256);
        validation.leeway = 0;
        validation.set_issuer(&[&self.issuer]);
        validation.set_audience(&[&self.audience]);
        validation.set_required_spec_claims(&["iss", "aud", "sub", "exp", "iat"]);
        let claims = jsonwebtoken::decode::<Claims>(token, &self.decoding, &validation)
            .map_err(|_| SessionTokenError)?
            .claims;
        let now = jsonwebtoken::get_current_timestamp();
        if claims.iat > now
            || claims.exp <= now
            || claims.jti.is_nil()
            || claims.exp.checked_sub(claims.iat) != Some(self.lifetime)
            || claims.sub != claims.agent_principal_id.to_string()
        {
            return Err(SessionTokenError);
        }
        let scope = SessionScope {
            tenant_id: claims.tenant_id,
            workspace_id: claims.workspace_id,
            installation_resource_id: claims.installation_resource_id,
            agent_principal_id: claims.agent_principal_id,
            agent_version_asset_id: claims.agent_version_asset_id,
            projection_generation: claims.projection_generation,
            root_event_id: claims.root_event_id,
        };
        if !scope.valid() {
            return Err(SessionTokenError);
        }
        Ok(VerifiedSession { scope })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signer() -> SessionSigner {
        SessionSigner::new(
            "urn:test:session".into(),
            "urn:test:mcp".into(),
            60,
            reqwest::Url::parse("http://gateway.test:8080/mcp").unwrap(),
            "test-gateway".into(),
        )
        .unwrap()
    }

    fn scope() -> SessionScope {
        SessionScope {
            tenant_id: Uuid::new_v4(),
            workspace_id: Uuid::new_v4(),
            installation_resource_id: Uuid::new_v4(),
            agent_principal_id: Uuid::new_v4(),
            agent_version_asset_id: Uuid::new_v4(),
            projection_generation: 1,
            root_event_id: "ab".repeat(32),
        }
    }

    #[test]
    fn session_ticket_round_trips_exact_scope_without_operation_authority() {
        let signer = signer();
        let mut scope = scope();
        for root in [
            "ab".repeat(32),
            "schedule:native-schedule:2026-10-04T07:00:00Z".into(),
        ] {
            scope.root_event_id = root;
            let token = signer.issue(&scope).unwrap();
            let verified = signer.verify(&token).unwrap();
            assert_eq!(verified.scope, scope);
            let raw: Value = serde_json::from_slice(
                &URL_SAFE_NO_PAD
                    .decode(token.split('.').nth(1).unwrap())
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(
                raw["exp"].as_u64().unwrap() - raw["iat"].as_u64().unwrap(),
                60
            );
            assert!(!Uuid::parse_str(raw["jti"].as_str().unwrap())
                .unwrap()
                .is_nil());
            let next = signer.issue(&scope).unwrap();
            assert_eq!(signer.verify(&next).unwrap().scope, scope);
            let next: Value = serde_json::from_slice(
                &URL_SAFE_NO_PAD
                    .decode(next.split('.').nth(1).unwrap())
                    .unwrap(),
            )
            .unwrap();
            assert_ne!(next["jti"], raw["jti"]);
            for forbidden in [
                "operation_id",
                "parameter_hash",
                "exposure",
                "delegation_id",
                "permission",
            ] {
                assert!(raw.get(forbidden).is_none());
            }
        }
        assert!(signer.public_jwks()["keys"][0].get("d").is_none());
        assert_eq!(signer.gateway_name(), "test-gateway");
    }

    #[test]
    fn session_ticket_cannot_survive_signer_restart_or_key_substitution() {
        let original = signer();
        let replacement = signer();
        let token = original.issue(&scope()).unwrap();
        assert!(original.verify(&token).is_ok());
        assert!(replacement.verify(&token).is_err());
        assert_ne!(original.public_jwks(), replacement.public_jwks());
    }

    #[test]
    fn session_ticket_rejects_foreign_identity_time_and_operation_claims() {
        let signer = signer();
        let token = signer.issue(&scope()).unwrap();
        let raw: Value = serde_json::from_slice(
            &URL_SAFE_NO_PAD
                .decode(token.split('.').nth(1).unwrap())
                .unwrap(),
        )
        .unwrap();
        let header = jsonwebtoken::decode_header(&token).unwrap();
        let now = jsonwebtoken::get_current_timestamp();
        for (field, value) in [
            ("iss", json!("foreign")),
            ("aud", json!("foreign")),
            ("sub", json!(Uuid::new_v4())),
            ("jti", json!(Uuid::nil())),
            ("iat", json!(now + 1)),
            ("exp", json!(now)),
            ("operation_id", json!(Uuid::new_v4())),
        ] {
            let mut changed = raw.clone();
            changed[field] = value;
            let signed = jsonwebtoken::encode(&header, &changed, &signer.encoding).unwrap();
            assert!(signer.verify(&signed).is_err(), "{field}");
        }
    }

    #[test]
    fn session_ticket_does_not_default_missing_session_scope() {
        let signer = signer();
        let original = scope();
        let mut changed = original.clone();
        changed.projection_generation = 0;
        assert!(signer.issue(&changed).is_err());
        changed = original.clone();
        changed.root_event_id.clear();
        assert!(signer.issue(&changed).is_err());
        changed = original;
        changed.installation_resource_id = Uuid::nil();
        assert!(signer.issue(&changed).is_err());
    }
}
