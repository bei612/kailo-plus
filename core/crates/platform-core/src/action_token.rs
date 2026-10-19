//! Production ActionToken issuance inside the original Core. No keys or tokens
//! enter Temporal history or the Catalog. The §8A simulated issuer is separate.

use contracts::ReasonCode;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    governance::{Actor, Execution, Refusal, Target},
    service_api::ServiceState,
};

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, Refusal> {
    value[key]
        .as_str()
        .filter(|s| !s.is_empty() && s.trim() == *s)
        .ok_or_else(invalid)
}

pub(crate) fn management_operation(action: &str, state: &str, operation: &str) -> bool {
    match (action, state) {
        (crate::application_binding::CREATE, "PROVISIONING") => matches!(
            operation,
            "handshake" | "validate_binding" | "resolve_native_scope"
        ),
        (crate::application_binding::CREATE | crate::application_binding::DISABLE, "DISABLING") => {
            matches!(
                operation,
                "observe" | "cancel" | "reconcile" | "extract_usage" | "map_native_status_error"
            )
        }
        _ => false,
    }
}

/// The restricted purpose stored with the production ActionToken key.
const ACTION_TOKEN_PURPOSE: &str = "ACTION_TOKEN";
/// 07 §8A: the restricted purpose stored with Core's isolated conformance
/// signing key; `component_conformance_identity::sign` refuses any other.
pub(crate) const CONFORMANCE_PURPOSE: &str = "COMPONENT_CONFORMANCE";

fn delivery() -> Result<Value, Refusal> {
    signing_delivery("ACTION_TOKEN_SIGNING_FILE")
}

/// One `ActionTokenSigningDelivery` document named by `variable`: versioned
/// OpenBao references and the Agent-rendered public JWKS path, never a key.
fn signing_delivery(variable: &str) -> Result<Value, Refusal> {
    let path =
        std::env::var(variable).map_err(|_| Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    let bytes = std::fs::read(path)
        .map_err(|_| Refusal::Unavailable("signing delivery unavailable".into()))?;
    let parsed: contracts::ActionTokenSigningDelivery =
        serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    let value = serde_json::to_value(parsed).map_err(|_| invalid())?;
    if serde_json::from_slice::<Value>(&bytes).map_err(|_| invalid())? != value
        || !text(&value, "secretLocator")?.starts_with("platform/")
        || !std::path::Path::new(text(&value, "jwksFile")?).is_absolute()
        || value["tokenSeconds"].as_i64().is_none_or(|v| v <= 0)
        || value["secretVersion"]
            .as_u64()
            .is_none_or(|v| v == 0 || v > u32::MAX.into())
    {
        return Err(invalid());
    }
    Ok(value)
}

/// Deployment-only first-key initialization. No HTTP listener, business action,
/// identity registration or binding transition is reachable from this command.
/// Keys remain in the original versioned OpenBao authority; the public-only
/// record is consumed by the existing OpenBao Agent template transport.
pub(crate) async fn bootstrap_signing() -> Result<Value, String> {
    let config = delivery().map_err(|_| "ActionToken signing configuration invalid")?;
    let public_locator = std::env::var("ACTION_TOKEN_PUBLIC_JWKS_LOCATOR")
        .map_err(|_| "Missing ACTION_TOKEN_PUBLIC_JWKS_LOCATOR")?;
    if !initial_delivery(&config, &public_locator)? {
        return Err("ActionToken initial key delivery refused; rotation is not bootstrap".into());
    }
    initialize(&config, &public_locator, ACTION_TOKEN_PURPOSE).await
}

/// 07 §8A, ADR-19: deployment-only first-key initialization of Core's isolated
/// conformance signing identity, the key `component_conformance_identity::sign`
/// uses for suite probes. Same versioned OpenBao authority, one-write CAS and
/// public-only export as the ActionToken key, but its own private and public
/// locators, issuer, public file and purpose `COMPONENT_CONFORMANCE`: it can
/// neither be nor alias the production ActionToken key. No listener, identity,
/// binding or suite result is created; the Agent renders the public JWKS.
pub(crate) async fn bootstrap_conformance_signing() -> Result<Value, String> {
    let config = signing_delivery("COMPONENT_CONFORMANCE_SIGNING_FILE")
        .map_err(|_| "conformance signing configuration invalid")?;
    let public_locator = std::env::var("COMPONENT_CONFORMANCE_PUBLIC_JWKS_LOCATOR")
        .map_err(|_| "Missing COMPONENT_CONFORMANCE_PUBLIC_JWKS_LOCATOR")?;
    // When the production ActionToken delivery is configured, nothing of it
    // may be shared: key, public export, issuer or public file.
    let production = std::env::var_os("ACTION_TOKEN_SIGNING_FILE")
        .map(|_| delivery())
        .transpose()
        .map_err(|_| "ActionToken signing configuration invalid")?;
    let production_public = std::env::var("ACTION_TOKEN_PUBLIC_JWKS_LOCATOR").ok();
    let shared = shares_action_token(
        &config,
        &public_locator,
        production.as_ref(),
        production_public.as_deref(),
    );
    if shared || !initial_delivery(&config, &public_locator)? {
        return Err("conformance initial key delivery refused: shared or not initial".into());
    }
    initialize(&config, &public_locator, CONFORMANCE_PURPOSE).await
}

/// Whether a conformance signing delivery reuses anything of the production
/// ActionToken delivery: private key, issuer, public file or either locator.
fn shares_action_token(
    config: &Value,
    public_locator: &str,
    production: Option<&Value>,
    production_public: Option<&str>,
) -> bool {
    let action = production.is_some_and(|action| {
        ["secretLocator", "issuer", "jwksFile"]
            .iter()
            .any(|key| action[*key] == config[*key])
            || action["secretLocator"] == public_locator
    });
    let public = production_public
        .is_some_and(|locator| config["secretLocator"] == locator || public_locator == locator);
    action || public
}

/// Initial-version delivery rules shared by both signing keys.
fn initial_delivery(config: &Value, public_locator: &str) -> Result<bool, String> {
    let audience = std::env::var("OPENBAO_SERVICE_IDENTITY")
        .map_err(|_| "Missing OPENBAO_SERVICE_IDENTITY")?;
    let initial = config["secretAudience"] == audience.as_str()
        && config["secretVersion"] == 1
        && config["privateKeyField"] != "purpose"
        && public_locator.starts_with("platform/")
        && config["secretLocator"] != public_locator
        && !["SERVICE_OIDC_ISSUER", "GATEWAY_SERVICE_ISSUER"]
            .iter()
            .any(|name| {
                std::env::var(name)
                    .ok()
                    .is_some_and(|issuer| config["issuer"] == issuer.as_str())
            });
    Ok(initial)
}

async fn initialize(config: &Value, public_locator: &str, purpose: &str) -> Result<Value, String> {
    let secrets = secret_store::SecretStore::from_env()?;
    let audit = secret_store::AuditObserver::from_env()?;
    secrets
        .connect()
        .await
        .map_err(|_| "ActionToken secret credential unavailable")?;
    let result = async {
        audit
            .connect()
            .await
            .map_err(|_| "ActionToken audit credential unavailable")?;
        if audit
            .enabled_devices()
            .await
            .map_err(|_| "ActionToken audit unavailable")?
            == 0
        {
            return Err("ActionToken initialization requires an enabled audit device".to_owned());
        }
        bootstrap_signing_key(&secrets, config, public_locator, purpose).await
    }
    .await;
    // Do not leave either one-use bootstrap session alive on a partial failure.
    let audit_closed = audit.revoke_current().await;
    let secrets_closed = secrets.revoke_current().await;
    if audit_closed.is_err() || secrets_closed.is_err() {
        return Err("ActionToken bootstrap credential revocation incomplete".into());
    }
    result
}

async fn bootstrap_signing_key(
    secrets: &secret_store::SecretStore,
    config: &Value,
    public_locator: &str,
    purpose: &str,
) -> Result<Value, String> {
    let field = text(config, "privateKeyField").map_err(|_| "Invalid private key field")?;
    let locator = text(config, "secretLocator").map_err(|_| "Invalid private key reference")?;
    let current = secrets
        .observed_version(locator)
        .await
        .map_err(|_| "ActionToken private key version unavailable")?;
    if current == 0 {
        let private = fresh_signing_key().map_err(|_| "ActionToken key generation failed")?;
        let version = secrets
            .write_once_fields(locator, &[("purpose", purpose), (field, &private)])
            .await
            .map_err(|_| "ActionToken initial write unconfirmed; observe the same reference")?;
        if version != 1 {
            return Err("ActionToken initial version mismatch".into());
        }
    } else if current != 1 {
        return Err("ActionToken existing version is not an initial key".into());
    }
    let reference = secret_store::SecretRef {
        locator: locator.into(),
        version: 1,
        audience: text(config, "secretAudience")
            .map_err(|_| "Invalid key audience")?
            .into(),
    };
    let stored = secrets
        .read(&reference, "purpose")
        .await
        .map_err(|_| "ActionToken key purpose unavailable")?;
    if stored.expose() != purpose {
        return Err("ActionToken key purpose mismatch".into());
    }
    let private = secrets
        .read(&reference, field)
        .await
        .map_err(|_| "ActionToken private key unavailable")?;
    let public = public_signing_key(private.expose(), reference.version)
        .map_err(|_| "ActionToken private key is not the expected ES256 key")?;
    let public =
        serde_json::to_string(&public).map_err(|_| "ActionToken public encoding failed")?;
    let public_version = secrets
        .write_once(public_locator, "value", &public)
        .await
        .map_err(|_| "ActionToken public export unconfirmed; observe the same reference")?;
    if public_version != 1 {
        return Err("ActionToken public export is not an initial version".into());
    }
    Ok(
        json!({"secretLocator":locator,"secretVersion":reference.version,
        "publicJwksLocator":public_locator,"publicJwksVersion":public_version,
        "jwksFile":config["jwksFile"],"purpose":purpose,"bindingActivated":false}),
    )
}

const PKCS8_PEM_TAG: &str = "PRIVATE KEY";

fn fresh_signing_key() -> Result<String, ()> {
    let random = ring::rand::SystemRandom::new();
    let private = ring::signature::EcdsaKeyPair::generate_pkcs8(
        &ring::signature::ECDSA_P256_SHA256_FIXED_SIGNING,
        &random,
    )
    .map_err(|_| ())?;
    // PKCS#8 PEM is the exact format consumed by the existing ActionToken signer.
    Ok(pem::encode_config(
        &pem::Pem::new(PKCS8_PEM_TAG, private.as_ref()),
        pem::EncodeConfig::new().set_line_ending(pem::LineEnding::LF),
    ))
}

fn public_signing_key(private: &str, version: u32) -> Result<Value, ()> {
    use base64::Engine;
    use ring::signature::KeyPair;
    let parsed = pem::parse(private).map_err(|_| ())?;
    if parsed.tag() != PKCS8_PEM_TAG {
        return Err(());
    }
    let pair = ring::signature::EcdsaKeyPair::from_pkcs8(
        &ring::signature::ECDSA_P256_SHA256_FIXED_SIGNING,
        parsed.contents(),
        &ring::rand::SystemRandom::new(),
    )
    .map_err(|_| ())?;
    let point = pair.public_key().as_ref();
    let encode = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    Ok(json!({"keys":[{"kty":"EC","crv":"P-256","alg":"ES256",
        "kid":version.to_string(),"use":"sig","key_ops":["verify"],
        "x":encode.encode(point.get(1..33).ok_or(())?),
        "y":encode.encode(point.get(33..65).ok_or(())?)}]}))
}

pub(crate) fn native_read_deadline() -> Result<i64, Refusal> {
    chrono::Utc::now()
        .timestamp()
        .checked_add(delivery()?["tokenSeconds"].as_i64().ok_or_else(invalid)?)
        .ok_or_else(invalid)
}

/// Only the exact NONE management definition admits absent policy references.
/// Protocol operations cannot turn a content action into a management action.
pub(crate) async fn issue_binding_management(
    state: &ServiceState,
    ae: &Execution,
    audience: &str,
    protocol_operation: &str,
    arguments: &Value,
) -> Result<String, Refusal> {
    if !matches!(
        ae.action_key.as_str(),
        crate::application_binding::CREATE | crate::application_binding::DISABLE
    ) || !matches!(
        protocol_operation,
        "handshake"
            | "validate_binding"
            | "resolve_native_scope"
            | "observe"
            | "cancel"
            | "reconcile"
            | "extract_usage"
            | "map_native_status_error"
    ) || ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "DISPATCHED"
        || ae.actor_principal_id != ae.initiator_principal_id
    {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let def =
        crate::governance::exact_definition(&state.pool, &ae.action_key, ae.action_version).await?;
    if def.result_exposure != "NONE"
        || def.target_type != "APPLICATION_BINDING"
        || def.permission != "manage"
        || def.workspace_rule != "DECLARED_WORKSPACE"
        || def.permission_object_type != "tenant"
        || def.tenant_rule != "SESSION_TENANT"
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    // The caller never selects a different provider by changing aud/arguments.
    // Resolve the original lifecycle's immutable generation from Catalog facts,
    // including during DISABLING when new business calls are already stopped.
    let binding: Option<(String,String)> = sqlx::query_as(
        "select s.audience,b.state
         from catalog.application_binding b
         join identity.service_principal s on s.principal_id=b.service_principal_id
           and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
         join identity.principal principal on principal.id=s.principal_id
           and principal.tenant_id=b.tenant_id and principal.kind='SERVICE' and principal.status='ACTIVE'
         join projection.application_runtime p on p.binding_id=b.id
           and p.component_release_id=b.component_release_id
         where b.id=$1 and b.tenant_id=$2 and b.workspace_id is not distinct from $3
           and b.projection_action_execution_id=$4
           and ((b.state='PROVISIONING' and p.action_execution_id=$4 and p.state='PENDING')
             or (b.state='DISABLING' and ((b.active_projection_generation is not null and p.generation=b.active_projection_generation)
                 or (b.active_projection_generation is null and p.action_execution_id=b.created_by_action_execution_id))
                 and p.state in ('PENDING','ACTIVE','REVOKED')))")
        .bind(ae.target_id).bind(ae.tenant_id).bind(ae.workspace_id).bind(ae.id)
        .fetch_optional(&state.pool).await?;
    let (expected_audience, binding_state) =
        binding.ok_or(Refusal::Denied(ReasonCode::ScopeGuardFailed))?;
    if expected_audience != audience
        || !management_operation(&ae.action_key, &binding_state, protocol_operation)
    {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let revision = if binding_state == "DISABLING"
        && matches!(
            protocol_operation,
            "observe" | "extract_usage" | "reconcile"
        ) {
        lifecycle_observation_revision(state, ae, protocol_operation, arguments).await?
    } else {
        let evaluated = state
            .governance
            .evaluate(
                Actor {
                    tenant_id: ae.tenant_id,
                    principal_id: ae.actor_principal_id,
                    human_identity_id: None,
                },
                &def,
                &Target {
                    id: ae.target_id,
                    version: 0,
                    workspace_id: ae.workspace_id,
                },
            )
            .await?;
        if !evaluated.allowed {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
        evaluated
            .zed_token
            .filter(|v| !v.is_empty())
            .ok_or_else(invalid)?
    };
    let mut claims = json!({"tenant_id":ae.tenant_id,"actor_principal_id":ae.actor_principal_id,
        "initiating_human_principal_id":ae.initiator_principal_id,
        "operation_id":ae.operation_id,"action_execution_id":ae.id,
        "action_key":ae.action_key,"action_definition_version":ae.action_version,
        "target_type":def.target_type,"target_id":ae.target_id,
        "normalized_parameter_hash":collab_bridge::limits::canonical_digest(&json!({"operation":protocol_operation,"arguments":arguments}))});
    if let Some(workspace) = ae.workspace_id {
        claims["workspace_id"] = json!(workspace);
    }
    claims["authorization_min_zed_token"] = json!(revision);
    sign_claims(state, audience, claims).await
}

async fn sign_claims(
    state: &ServiceState,
    audience: &str,
    claims: Value,
) -> Result<String, Refusal> {
    sign_claims_before(state, audience, claims, None).await
}

async fn sign_claims_before(
    state: &ServiceState,
    audience: &str,
    claims: Value,
    deadline: Option<i64>,
) -> Result<String, Refusal> {
    sign_claims_frozen_before(state, audience, claims, deadline, None).await
}

async fn sign_claims_frozen_before(
    state: &ServiceState,
    audience: &str,
    mut claims: Value,
    deadline: Option<i64>,
    frozen: Option<&Value>,
) -> Result<String, Refusal> {
    let config = delivery()?;
    let issuer = text(&config, "issuer")?;
    if audience.is_empty()
        || state.auth.shares_identity(issuer, audience)
        || state
            .gateway_service_auth
            .as_ref()
            .is_some_and(|auth| auth.shares_identity(issuer, audience))
        || text(&config, "secretAudience")? != state.secret_audience
    {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let version = u32::try_from(config["secretVersion"].as_u64().ok_or_else(invalid)?)
        .map_err(|_| invalid())?;
    let reference = secret_store::SecretRef {
        locator: text(&config, "secretLocator")?.into(),
        version,
        audience: state.secret_audience.clone(),
    };
    let purpose = state
        .secrets
        .read(&reference, "purpose")
        .await
        .map_err(|_| Refusal::Unavailable("ActionToken signing purpose unavailable".into()))?;
    if purpose.expose() != "ACTION_TOKEN" {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let key = state
        .secrets
        .read(&reference, text(&config, "privateKeyField")?)
        .await
        .map_err(|_| Refusal::Unavailable("ActionToken signing key unavailable".into()))?;
    let encoding = EncodingKey::from_ec_pem(key.expose().as_bytes()).map_err(|_| invalid())?;
    let now = chrono::Utc::now().timestamp();
    let expires = now
        .checked_add(config["tokenSeconds"].as_i64().ok_or_else(invalid)?)
        .ok_or_else(invalid)?;
    let expires = deadline.map_or(expires, |deadline| expires.min(deadline));
    if expires <= now {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let (jti, issued, expires) = if let Some(stamp) = frozen {
        let jti = Uuid::parse_str(text(stamp, "jti")?).map_err(|_| invalid())?;
        if jti.is_nil() {
            return Err(invalid());
        }
        let issued = stamp["iat"].as_i64().ok_or_else(invalid)?;
        let expires = stamp["exp"].as_i64().ok_or_else(invalid)?;
        if issued > now || issued >= expires || expires <= now {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
        (jti, issued, expires)
    } else {
        (Uuid::new_v4(), now, expires)
    };
    claims["jti"] = json!(jti);
    claims["iss"] = json!(issuer);
    claims["aud"] = json!(audience);
    claims["iat"] = json!(issued);
    claims["exp"] = json!(expires);
    let kid = version.to_string();
    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some(kid.clone());
    let token = jsonwebtoken::encode(&header, &claims, &encoding).map_err(|_| invalid())?;
    let published: jsonwebtoken::jwk::JwkSet = serde_json::from_slice(
        &std::fs::read(text(&config, "jwksFile")?)
            .map_err(|_| Refusal::Unavailable("ActionToken JWKS delivery unavailable".into()))?,
    )
    .map_err(|_| invalid())?;
    if published
        .keys
        .iter()
        .filter(|key| key.common.key_id.as_deref() == Some(kid.as_str()))
        .count()
        != 1
    {
        return Err(Refusal::Precondition(ReasonCode::ProjectionDelayed));
    }
    let decoding =
        DecodingKey::from_jwk(published.find(&kid).ok_or_else(invalid)?).map_err(|_| invalid())?;
    let mut validation = Validation::new(Algorithm::ES256);
    validation.set_issuer(&[issuer]);
    validation.set_audience(&[audience]);
    validation.leeway = 0;
    let verified = jsonwebtoken::decode::<Value>(&token, &decoding, &validation)
        .map_err(|_| Refusal::Precondition(ReasonCode::ProjectionDelayed))?;
    if verified.claims != claims {
        return Err(invalid());
    }
    Ok(token)
}

/// DD-89 SERVICE reads retain the original batch's token identity and expiry
/// on retry. They neither borrow a human identity nor create an Agent delegation.
pub(crate) async fn issue_service_read(
    state: &ServiceState,
    ae: &crate::governance::Execution,
    definition: &crate::governance::Definition,
    audience: &str,
    zed: &str,
) -> Result<String, Refusal> {
    if !(crate::application_binding::read_grant::is_service(ae)
        || crate::application_binding::read_grant::native_receiver::is_receiver(ae))
        || zed.is_empty()
    {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let parameters = ae.parameters.as_ref().ok_or_else(invalid)?;
    let mut claims = json!({"tenant_id":ae.tenant_id,"actor_principal_id":ae.actor_principal_id,
        "operation_id":ae.operation_id,"action_execution_id":ae.id,"target_type":definition.target_type,
        "target_id":ae.target_id,"action_key":ae.action_key,"action_definition_version":ae.action_version,
        "authorization_min_zed_token":zed,"normalized_parameter_hash":parameters["toolParameterHash"],
        "idempotency_key":parameters["idempotencyKey"]});
    if let Some(workspace) = ae.workspace_id {
        claims["workspace_id"] = json!(workspace);
    }
    sign_claims_frozen_before(state, audience, claims, None, parameters.get("readToken")).await
}

/// Business claims are issued only for the frozen original child and envelope.
/// The transport strips target from the capability input; the Adapter rebuilds
/// that same typed envelope from these signed target claims for PEP comparison.
pub(crate) async fn issue_application(
    state: &ServiceState,
    ae: &Execution,
    arguments: &Value,
    external: Uuid,
    key: Uuid,
) -> Result<(String, String), Refusal> {
    if crate::application_action::is_human(ae) {
        return Err(invalid());
    }
    issue_application_intent(state, ae, arguments, external, key).await
}

pub(crate) async fn issue_component_action(
    state: &ServiceState,
    ae: &Execution,
    arguments: &Value,
    external: Uuid,
    key: Uuid,
) -> Result<(String, String), Refusal> {
    if !crate::application_action::is_human(ae) {
        return Err(invalid());
    }
    issue_application_intent(state, ae, arguments, external, key).await
}

pub(crate) async fn issue_native_task(
    state: &ServiceState,
    ae: &Execution,
    external: Uuid,
    key: Uuid,
    audience: &str,
    revision: String,
    deadline: i64,
) -> Result<String, Refusal> {
    let expected = crate::application_action::native_task::deadline(
        &mut *state.pool.acquire().await?,
        ae,
        external,
    )
    .await?
    .ok_or_else(invalid)?;
    if expected.timestamp() != deadline || external.is_nil() || key.is_nil() || revision.is_empty()
    {
        return Err(invalid());
    }
    let p = ae.parameters.as_ref().ok_or_else(invalid)?;
    let claims = application_claims(
        ae,
        p,
        p["toolParameterHash"].clone(),
        revision,
        Some((external, key)),
    )?;
    sign_claims_before(state, audience, claims, Some(deadline)).await
}

pub(crate) async fn issue_native_execution(
    state: &ServiceState,
    ae: &Execution,
    external: Uuid,
    key: Uuid,
    audience: &str,
    revision: String,
    deadline: i64,
) -> Result<String, Refusal> {
    if !crate::application_action::native_execution::is_native_writer(ae)
        || external.is_nil()
        || key.is_nil()
        || revision.is_empty()
    {
        return Err(invalid());
    }
    let p = ae.parameters.as_ref().ok_or_else(invalid)?;
    let claims = application_claims(
        ae,
        p,
        p["toolParameterHash"].clone(),
        revision,
        Some((external, key)),
    )?;
    sign_claims_before(state, audience, claims, Some(deadline)).await
}

/// The native HUMAN request owns a first-only synchronous read, not an EE.
/// Its original admission caller atomically fences issuance before calling us.
pub(crate) async fn issue_native_read(
    state: &ServiceState,
    ae: &Execution,
    audience: &str,
    key: Uuid,
) -> Result<String, Refusal> {
    if !crate::application_action::native_read::is_read(ae)
        || ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "UNKNOWN"
    {
        return Err(invalid());
    }
    let decision = crate::application_action::fresh_execution(&state.governance, ae).await?;
    if !decision.allowed {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let p = ae.parameters.as_ref().ok_or_else(invalid)?;
    let mut claims = application_claims(
        ae,
        p,
        p["toolParameterHash"].clone(),
        decision
            .zed_token
            .filter(|v| !v.is_empty())
            .ok_or_else(invalid)?,
        None,
    )?;
    claims["idempotency_key"] = json!(key);
    sign_claims(state, audience, claims).await
}

async fn issue_application_intent(
    state: &ServiceState,
    ae: &Execution,
    arguments: &Value,
    external: Uuid,
    key: Uuid,
) -> Result<(String, String), Refusal> {
    if external.is_nil() || key.is_nil() {
        return Err(invalid());
    }
    let parameters = ae.parameters.as_ref().ok_or_else(invalid)?;
    let (kind, target) = crate::application_tool::target(arguments)?;
    if target != ae.target_id
        || parameters["targetType"] != kind
        || parameters["toolParameterHash"] != collab_bridge::limits::canonical_digest(arguments)
        || ae.gate_state != "ALLOWED"
        || ae.dispatch_state
            != if crate::application_action::is_human(ae) {
                "DISPATCHED"
            } else {
                "NOT_DISPATCHED"
            }
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let evaluation = crate::application_tool::fresh_execution(&state.governance, ae).await?;
    let revision = evaluation
        .zed_token
        .filter(|v| !v.is_empty())
        .ok_or_else(invalid)?;
    if !evaluation.allowed {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let audience:Option<String>=sqlx::query_scalar("select s.audience from admission.action_execution a
        join catalog.application_binding b on b.id=a.component_binding_id and b.tenant_id=a.tenant_id
          and (b.workspace_id is null or b.workspace_id=a.workspace_id) and b.state='ACTIVE'
          and b.active_projection_generation=a.component_projection_generation and b.component_release_id=a.component_release_id
        join identity.service_principal s on s.principal_id=b.service_principal_id
          and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
        join identity.principal p on p.id=s.principal_id and p.tenant_id=b.tenant_id and p.kind='SERVICE' and p.status='ACTIVE'
        where a.id=$1 and a.component_binding_kind='APPLICATION'")
        .bind(ae.id).fetch_optional(&state.pool).await?;
    let audience = audience.ok_or(Refusal::Denied(ReasonCode::BindingNotActive))?;
    let claims = application_claims(
        ae,
        parameters,
        parameters["toolParameterHash"].clone(),
        revision,
        Some((external, key)),
    )?;
    let token = sign_claims(state, &audience, claims).await?;
    Ok((token, audience))
}

/// A native revision query is a fresh business read, never an observation of a
/// retired actor or a NONE lifecycle exception. Reuse the original child claims
/// and sign only the canonical query intent for its exact binding audience.
pub(crate) async fn issue_query_revision(
    state: &ServiceState,
    ae: &Execution,
    audience: &str,
    arguments: &Value,
) -> Result<String, Refusal> {
    let definition = crate::governance::exact_definition_for_execution(&state.pool, ae).await?;
    if definition.execution_mode == "PROTOCOL" {
        let revision =
            crate::protocol_session::revision_read(state, ae, audience, arguments).await?;
        let parameters = ae.parameters.as_ref().ok_or_else(invalid)?;
        let deadline = parameters["protocolExpiresAt"]
            .as_str()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|time| time.timestamp())
            .ok_or_else(invalid)?;
        let mut claims = json!({"tenant_id":ae.tenant_id,"actor_principal_id":ae.actor_principal_id,
            "initiating_human_principal_id":ae.initiator_principal_id,"operation_id":ae.operation_id,
            "action_execution_id":ae.id,"action_key":ae.action_key,"action_definition_version":ae.action_version,
            "target_type":definition.target_type,"target_id":ae.target_id,
            "normalized_parameter_hash":collab_bridge::limits::canonical_digest(&json!({"operation":"query_revision","arguments":arguments})),
            "authorization_min_zed_token":revision});
        if let Some(workspace) = ae.workspace_id {
            claims["workspace_id"] = json!(workspace);
        }
        // Reconciliation is bounded by the existing short-lived ActionToken
        // configuration, but may inspect an original outcome after Session
        // expiry. It cannot grant file access or renew the document PAT.
        return sign_claims_before(
            state,
            audience,
            claims,
            if arguments.get("protocolReconcile").is_some() {
                None
            } else {
                Some(deadline)
            },
        )
        .await;
    }
    let (facts, revision) =
        crate::application_tool::fresh_revision_read(state, ae, arguments).await?;
    if audience != facts.audience {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let hash = collab_bridge::limits::canonical_digest(&json!({
        "operation":"query_revision", "arguments":arguments,
    }));
    sign_claims(
        state,
        audience,
        application_claims(
            ae,
            ae.parameters.as_ref().ok_or_else(invalid)?,
            json!(hash),
            revision,
            None,
        )?,
    )
    .await
}

pub(crate) async fn issue_protocol_launch(
    state: &ServiceState,
    ae: &Execution,
    audience: &str,
    arguments: &Value,
) -> Result<String, Refusal> {
    let revision =
        crate::protocol_session::launch::authorize(state, ae, audience, arguments).await?;
    let definition = crate::governance::exact_definition_for_execution(&state.pool, ae).await?;
    let parameters = ae.parameters.as_ref().ok_or_else(invalid)?;
    let deadline = parameters["protocolExpiresAt"]
        .as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|time| time.timestamp())
        .ok_or_else(invalid)?;
    let mut claims = json!({"tenant_id":ae.tenant_id,"actor_principal_id":ae.actor_principal_id,
        "initiating_human_principal_id":ae.initiator_principal_id,"operation_id":ae.operation_id,
        "action_execution_id":ae.id,"action_key":ae.action_key,"action_definition_version":ae.action_version,
        "target_type":definition.target_type,"target_id":ae.target_id,
        "normalized_parameter_hash":collab_bridge::limits::canonical_digest(&json!({"operation":"execute","arguments":arguments})),
        "authorization_min_zed_token":revision});
    if let Some(workspace) = ae.workspace_id {
        claims["workspace_id"] = json!(workspace);
    }
    sign_claims_before(state, audience, claims, Some(deadline)).await
}

/// An expired/revoked Session can still observe or revoke its original native
/// PAT. This short ticket has no content operation and cannot mint a new PAT.
pub(crate) async fn issue_protocol_lifecycle(
    state: &ServiceState,
    ae: &Execution,
    audience: &str,
    operation: &str,
    arguments: &Value,
) -> Result<String, Refusal> {
    let revision =
        crate::protocol_session::lifecycle::authorize(state, ae, audience, operation, arguments)
            .await?;
    let definition = crate::governance::exact_definition_for_execution(&state.pool, ae).await?;
    let mut claims = json!({"tenant_id":ae.tenant_id,"actor_principal_id":ae.actor_principal_id,
        "initiating_human_principal_id":ae.initiator_principal_id,"operation_id":ae.operation_id,
        "action_execution_id":ae.id,"action_key":ae.action_key,"action_definition_version":ae.action_version,
        "target_type":definition.target_type,"target_id":ae.target_id,
        "normalized_parameter_hash":collab_bridge::limits::canonical_digest(&json!({"operation":operation,"arguments":arguments})),
        "authorization_min_zed_token":revision});
    if let Some(workspace) = ae.workspace_id {
        claims["workspace_id"] = json!(workspace);
    }
    sign_claims(state, audience, claims).await
}

fn application_claims(
    ae: &Execution,
    parameters: &Value,
    hash: Value,
    revision: String,
    intent: Option<(Uuid, Uuid)>,
) -> Result<Value, Refusal> {
    let kind = text(parameters, "targetType")?;
    let mut claims = json!({"tenant_id":ae.tenant_id,"actor_principal_id":ae.actor_principal_id,
        "agent_principal_id":ae.actor_principal_id,"initiating_human_principal_id":ae.initiator_principal_id,
        "operation_id":ae.operation_id,"action_execution_id":ae.id,"action_key":ae.action_key,
        "action_definition_version":ae.action_version,"target_type":kind,"target_id":ae.target_id,
        "normalized_parameter_hash":hash,"authorization_min_zed_token":revision,
        "delegation_id":parameters["delegationId"],"delegation_version":parameters["delegationVersion"],
        "result_exposure_policy_id":parameters["resultExposurePolicyId"],
        "result_exposure_policy_version":parameters["resultExposurePolicyVersion"]});
    if crate::application_action::is_human(ae) {
        let object = claims.as_object_mut().ok_or_else(invalid)?;
        object.remove("agent_principal_id");
        object.remove("delegation_id");
        object.remove("delegation_version");
    }
    if let Some(workspace) = ae.workspace_id {
        claims["workspace_id"] = json!(workspace);
    }
    if let Some((external, key)) = intent {
        if external.is_nil() || key.is_nil() {
            return Err(invalid());
        }
        claims["external_execution_id"] = json!(external);
        claims["idempotency_key"] = json!(key);
    }
    Ok(claims)
}

/// System observation of an already dispatched intent, not renewed permission
/// for its original actor. The closed reference schema contains no content.
pub(crate) async fn observation_revision(
    state: &ServiceState,
    ae: &Execution,
    binding: Uuid,
    operation: &str,
    args: &Value,
) -> Result<String, Refusal> {
    if !matches!(operation, "observe" | "extract_usage")
        || ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "DISPATCHED"
    {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let parsed: contracts::AdapterExecutionReference =
        serde_json::from_value(args.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(parsed).map_err(|_| invalid())? != *args {
        return Err(invalid());
    }
    let retained_native = crate::application_action::native_execution::is_native_writer(ae) || {
        let mut connection = state.pool.acquire().await?;
        crate::application_action::native_task::duration(&mut connection, ae)
            .await?
            .is_some()
    };
    let revision:Option<String>=sqlx::query_scalar("select d.zed_token from admission.external_execution e
        join admission.action_execution a on a.id=e.action_execution_id and a.operation_id=e.operation_id
        join admission.action_execution root on root.id=coalesce(a.parent_action_execution_id,a.id) and root.operation_id=a.operation_id
          and root.parent_action_execution_id is null
        join projection.workflow_ref w on w.action_execution_id=root.id and w.workflow_id=e.workflow_id
        join catalog.application_binding b on b.id=e.component_binding_id and ($9 or b.component_release_id=e.component_release_id)
          and b.state in ('ACTIVE','DISABLING')
        join projection.application_runtime p on p.binding_id=b.id and p.generation=e.component_projection_generation
          and p.component_release_id=e.component_release_id
        join admission.action_decision d on d.action_execution_id=a.id and d.operation_id=a.operation_id
          and d.scope_decision='ALLOW' and d.authorization_decision='ALLOW' and d.zed_token is not null and d.zed_token<>''
        where a.id=$1 and e.id=$2 and e.component_binding_id=$3 and e.tenant_id=$4
          and (a.parent_action_execution_id is not null or
            (a.actor_principal_id=a.initiator_principal_id and a.parameters->>'componentActionKind'='COMPONENT_ACTION'
             and w.workflow_type='ComponentTaskWorkflow' and w.kind='COMPONENT_ACTION'))
          and e.workspace_id is not distinct from $5 and e.idempotency_key=$6 and e.native_type=$7
          and e.native_id is not distinct from $8 and a.component_binding_id=e.component_binding_id
          and a.component_projection_generation=e.component_projection_generation and a.component_release_id=e.component_release_id
        order by d.decided_at desc limit 1")
        .bind(ae.id).bind(Uuid::parse_str(text(args,"externalExecutionId")?).map_err(|_|invalid())?)
        .bind(binding).bind(ae.tenant_id).bind(ae.workspace_id)
        .bind(Uuid::parse_str(text(args,"idempotencyKey")?).map_err(|_|invalid())?).bind(text(args,"nativeType")?)
        .bind(args.get("nativeId").and_then(Value::as_str))
        .bind(retained_native).fetch_optional(&state.pool).await?;
    revision.ok_or(Refusal::Denied(ReasonCode::ScopeGuardFailed))
}

pub(crate) async fn issue_application_observation(
    state: &ServiceState,
    ae: &Execution,
    audience: &str,
    operation: &str,
    args: &Value,
) -> Result<String, Refusal> {
    let binding:Option<Uuid>=sqlx::query_scalar("select b.id from admission.action_execution a
        join catalog.application_binding b on b.id=a.component_binding_id
        join identity.service_principal s on s.principal_id=b.service_principal_id
          and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id and s.audience=$2
        join identity.principal p on p.id=s.principal_id and p.tenant_id=b.tenant_id and p.status='ACTIVE'
        where a.id=$1 and a.component_binding_kind='APPLICATION'")
        .bind(ae.id).bind(audience).fetch_optional(&state.pool).await?;
    let revision =
        observation_revision(state, ae, binding.ok_or_else(invalid)?, operation, args).await?;
    let hash = json!(collab_bridge::limits::canonical_digest(
        &json!({"operation":operation,"arguments":args})
    ));
    let claims = application_claims(
        ae,
        ae.parameters.as_ref().ok_or_else(invalid)?,
        hash,
        revision,
        None,
    )?;
    sign_claims(state, audience, claims).await
}

pub(crate) async fn lifecycle_observation_revision(
    state: &ServiceState,
    ae: &Execution,
    operation: &str,
    args: &Value,
) -> Result<String, Refusal> {
    if !matches!(operation, "observe" | "extract_usage" | "reconcile")
        || !matches!(
            ae.action_key.as_str(),
            crate::application_binding::CREATE | crate::application_binding::DISABLE
        )
        || ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "DISPATCHED"
    {
        return Err(invalid());
    }
    if operation == "reconcile" {
        let parsed: contracts::AdapterBindingReconcileRequest =
            serde_json::from_value(args.clone()).map_err(|_| invalid())?;
        if serde_json::to_value(parsed).map_err(|_| invalid())? != *args
            || args["bindingId"] != json!(ae.target_id)
            || args["idempotencyKey"] != json!(ae.id)
            || args["generation"].as_i64().is_none_or(|v| v <= 0)
        {
            return Err(invalid());
        }
        // System observation retains the original lifecycle decision. A
        // revoked human cannot stop reconciliation, nor use it for new work.
        let revision: Option<String> = sqlx::query_scalar("select d.zed_token
            from catalog.application_binding b join projection.application_runtime p on p.binding_id=b.id
              and p.generation=$5 and p.component_release_id=b.component_release_id
            join admission.action_decision d on d.action_execution_id=b.projection_action_execution_id
              and d.scope_decision='ALLOW' and d.authorization_decision='ALLOW' and d.zed_token is not null and d.zed_token<>''
            where b.id=$1 and b.tenant_id=$2 and b.workspace_id is not distinct from $3
              and b.projection_action_execution_id=$4 and b.state='DISABLING'
              and p.generation=coalesce(b.active_projection_generation,
                (select generation from projection.application_runtime where binding_id=b.id and action_execution_id=b.created_by_action_execution_id))
              and b.config_digest=$6 and b.native_instance_ref=$7 and b.native_scope_ref=$8
            order by d.decided_at desc limit 1")
            .bind(ae.target_id).bind(ae.tenant_id).bind(ae.workspace_id).bind(ae.id)
            .bind(args["generation"].as_i64().ok_or_else(invalid)?)
            .bind(text(args,"configDigest")?).bind(text(args,"nativeInstanceRef")?).bind(text(args,"nativeScopeRef")?)
            .fetch_optional(&state.pool).await?;
        return revision.ok_or(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let parsed: contracts::AdapterExecutionReference =
        serde_json::from_value(args.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(parsed).map_err(|_| invalid())? != *args {
        return Err(invalid());
    }
    let revision:Option<String>=sqlx::query_scalar("select d.zed_token from catalog.application_binding b
        join admission.external_execution e on e.component_binding_id=b.id and e.tenant_id=b.tenant_id
        join projection.application_runtime p on p.binding_id=b.id and p.generation=e.component_projection_generation
          and p.component_release_id=e.component_release_id
        join admission.action_execution child on child.id=e.action_execution_id and child.operation_id=e.operation_id
        join admission.action_execution root on root.id=coalesce(child.parent_action_execution_id,child.id)
        join projection.workflow_ref w on w.action_execution_id=root.id and w.workflow_id=e.workflow_id
        join admission.action_decision d on d.action_execution_id=b.projection_action_execution_id
          and d.scope_decision='ALLOW' and d.authorization_decision='ALLOW' and d.zed_token is not null and d.zed_token<>''
        where b.id=$1 and b.tenant_id=$2 and b.workspace_id is not distinct from $3 and b.state='DISABLING'
          and b.projection_action_execution_id=$4 and e.id=$5 and e.idempotency_key=$6
          and e.native_type=$7 and e.native_id is not distinct from $8 order by d.decided_at desc limit 1")
        .bind(ae.target_id).bind(ae.tenant_id).bind(ae.workspace_id).bind(ae.id)
        .bind(Uuid::parse_str(text(args,"externalExecutionId")?).map_err(|_|invalid())?)
        .bind(Uuid::parse_str(text(args,"idempotencyKey")?).map_err(|_|invalid())?)
        .bind(text(args,"nativeType")?).bind(args.get("nativeId").and_then(Value::as_str))
        .fetch_optional(&state.pool).await?;
    revision.ok_or(Refusal::Denied(ReasonCode::ScopeGuardFailed))
}

/// Validate the original Core token with its delivered public keys. Verification
/// never reads a private key, issues another token, or trusts a supplied digest.
pub(crate) fn verify(token: &str, audience: &str) -> Result<Value, Refusal> {
    let config = delivery()?;
    let issuer = text(&config, "issuer")?;
    let header = jsonwebtoken::decode_header(token).map_err(|_| invalid())?;
    let kid = header.kid.as_deref().ok_or_else(invalid)?;
    if header.alg != Algorithm::ES256 || kid.parse::<u32>().is_err() || kid == "0" {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let published: jsonwebtoken::jwk::JwkSet = serde_json::from_slice(
        &std::fs::read(text(&config, "jwksFile")?)
            .map_err(|_| Refusal::Unavailable("ActionToken JWKS delivery unavailable".into()))?,
    )
    .map_err(|_| invalid())?;
    if published
        .keys
        .iter()
        .filter(|key| key.common.key_id.as_deref() == Some(kid))
        .count()
        != 1
    {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let decoding =
        DecodingKey::from_jwk(published.find(kid).ok_or_else(invalid)?).map_err(|_| invalid())?;
    let mut validation = Validation::new(Algorithm::ES256);
    validation.set_issuer(&[issuer]);
    validation.set_audience(&[audience]);
    validation.leeway = 0;
    validation.set_required_spec_claims(&["exp", "iat", "iss", "aud", "jti"]);
    let claims = jsonwebtoken::decode::<Value>(token, &decoding, &validation)
        .map_err(|_| Refusal::Denied(ReasonCode::PermissionDenied))?
        .claims;
    let issued = claims["iat"].as_i64().ok_or_else(invalid)?;
    let expires = claims["exp"].as_i64().ok_or_else(invalid)?;
    if issued > chrono::Utc::now().timestamp()
        || expires <= issued
        || expires - issued > config["tokenSeconds"].as_i64().ok_or_else(invalid)?
        || claims["aud"] != audience
        || Uuid::parse_str(text(&claims, "jti")?).is_err()
    {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    Ok(claims)
}

#[cfg(test)]
mod application_intent_tests {
    use super::*;

    #[test]
    fn conformance_signing_never_shares_the_action_token_delivery() {
        let action = json!({"secretLocator":"platform/kv/action-token","issuer":"https://action",
            "jwksFile":"/delivery/action-token/jwks.json"});
        let suite = json!({"secretLocator":"platform/kv/conformance","issuer":"https://suite",
            "jwksFile":"/delivery/conformance/jwks.json"});
        let public = "platform/kv/conformance-jwks";
        let other = Some("platform/kv/action-jwks");
        assert!(!shares_action_token(&suite, public, Some(&action), other));
        assert!(!shares_action_token(&suite, public, None, None));
        for key in ["secretLocator", "issuer", "jwksFile"] {
            let mut reused = suite.clone();
            reused[key] = action[key].clone();
            assert!(
                shares_action_token(&reused, public, Some(&action), other),
                "{key}"
            );
        }
        let private = "platform/kv/action-token";
        assert!(shares_action_token(&suite, private, Some(&action), other));
        assert!(shares_action_token(&suite, public, None, Some(public)));
        assert!(shares_action_token(
            &suite,
            public,
            None,
            Some("platform/kv/conformance")
        ));
    }

    #[test]
    fn bootstrap_public_key_verifies_the_original_pem_signer_without_private_fields() {
        let private = fresh_signing_key().unwrap();
        let public = public_signing_key(&private, 1).unwrap();
        assert_eq!(public["keys"][0]["kid"], "1");
        assert_eq!(public["keys"][0].as_object().unwrap().len(), 8);
        let keyset: jsonwebtoken::jwk::JwkSet = serde_json::from_value(public).unwrap();
        let mut header = Header::new(Algorithm::ES256);
        header.kid = Some("1".into());
        let claims = json!({"iss":"action-fixture","aud":"adapter-fixture",
            "exp":chrono::Utc::now().timestamp()+60});
        let token = jsonwebtoken::encode(
            &header,
            &claims,
            &EncodingKey::from_ec_pem(private.as_bytes()).unwrap(),
        )
        .unwrap();
        let mut validation = Validation::new(Algorithm::ES256);
        validation.set_issuer(&["action-fixture"]);
        validation.set_audience(&["adapter-fixture"]);
        let verified = jsonwebtoken::decode::<Value>(
            &token,
            &DecodingKey::from_jwk(keyset.find("1").unwrap()).unwrap(),
            &validation,
        )
        .unwrap();
        assert_eq!(verified.claims, claims);
        assert!(public_signing_key("not-a-private-key", 1).is_err());
        let other = public_signing_key(&fresh_signing_key().unwrap(), 1).unwrap();
        let other: jsonwebtoken::jwk::JwkSet = serde_json::from_value(other).unwrap();
        assert!(jsonwebtoken::decode::<Value>(
            &token,
            &DecodingKey::from_jwk(other.find("1").unwrap()).unwrap(),
            &validation
        )
        .is_err());
    }

    fn execution(human: bool) -> Execution {
        let initiator = Uuid::new_v4();
        Execution {
            id: Uuid::new_v4(),
            operation_id: Uuid::new_v4(),
            tenant_id: Uuid::new_v4(),
            workspace_id: Some(Uuid::new_v4()),
            action_key: "fixture.read@v1".into(),
            action_version: 1,
            initiator_principal_id: initiator,
            actor_principal_id: if human { initiator } else { Uuid::new_v4() },
            target_id: Uuid::new_v4(),
            parameter_hash: "frozen-admission-hash".into(),
            parameters: Some(
                json!({"targetType":"RESOURCE", "delegationId":Uuid::new_v4(),
                "delegationVersion":3,"resultExposurePolicyId":Uuid::new_v4(),
                "resultExposurePolicyVersion":2,
                "componentActionKind":if human {crate::application_action::KIND}else{"AGENT_TOOL"}}),
            ),
            temporal_workflow_id: None,
            cancel_first_run_id: None,
            approval_workflow_id: None,
            approval_expires_at: None,
            gate_state: "ALLOWED".into(),
            dispatch_state: if human {
                "DISPATCHED"
            } else {
                "NOT_DISPATCHED"
            }
            .into(),
            reason_code: None,
            correlation_id: Uuid::new_v4(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn both_actors_sign_the_same_native_intent_without_changing_scope_or_delegation() {
        for human in [false, true] {
            let ae = execution(human);
            let parameters = ae.parameters.as_ref().unwrap();
            let external = Uuid::new_v4();
            let key = Uuid::new_v4();
            let arguments =
                json!({"target":{"resourceId":ae.target_id},"input":{"nativeObjectRef":"fixture"}});
            let hash = json!(collab_bridge::limits::canonical_digest(&arguments));
            let claims = application_claims(
                &ae,
                parameters,
                hash.clone(),
                "fresh".into(),
                Some((external, key)),
            )
            .unwrap();
            assert_eq!(claims["external_execution_id"], json!(external));
            assert_eq!(claims["idempotency_key"], json!(key));
            assert_eq!(claims["normalized_parameter_hash"], hash);
            assert_eq!(claims["action_execution_id"], json!(ae.id));
            assert_eq!(claims["operation_id"], json!(ae.operation_id));
            assert_eq!(claims["tenant_id"], json!(ae.tenant_id));
            assert_eq!(claims["workspace_id"], json!(ae.workspace_id));
            assert_eq!(claims["target_id"], json!(ae.target_id));
            assert_eq!(claims["actor_principal_id"], json!(ae.actor_principal_id));
            assert_eq!(
                claims["result_exposure_policy_id"],
                parameters["resultExposurePolicyId"]
            );
            assert_eq!(
                claims["result_exposure_policy_version"],
                parameters["resultExposurePolicyVersion"]
            );
            if human {
                assert!(claims.get("agent_principal_id").is_none());
                assert!(claims.get("delegation_id").is_none());
                assert!(claims.get("delegation_version").is_none());
            } else {
                assert_eq!(claims["agent_principal_id"], json!(ae.actor_principal_id));
                assert_eq!(claims["delegation_id"], parameters["delegationId"]);
                assert_eq!(
                    claims["delegation_version"],
                    parameters["delegationVersion"]
                );
            }
        }
    }

    #[test]
    fn native_intent_refuses_nil_execution_or_key_for_both_actors() {
        for human in [false, true] {
            let ae = execution(human);
            for intent in [(Uuid::nil(), Uuid::new_v4()), (Uuid::new_v4(), Uuid::nil())] {
                assert!(application_claims(
                    &ae,
                    ae.parameters.as_ref().unwrap(),
                    json!("frozen"),
                    "fresh".into(),
                    Some(intent)
                )
                .is_err());
            }
        }
    }

    #[test]
    fn revision_and_observation_claims_do_not_create_an_execution_intent() {
        for human in [false, true] {
            let ae = execution(human);
            let claims = application_claims(
                &ae,
                ae.parameters.as_ref().unwrap(),
                json!("signed-read-or-observation-intent"),
                "fresh".into(),
                None,
            )
            .unwrap();
            assert!(claims.get("external_execution_id").is_none());
            assert!(claims.get("idempotency_key").is_none());
        }
    }
}
