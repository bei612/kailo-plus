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

fn delivery() -> Result<Value, Refusal> {
    let path = std::env::var("ACTION_TOKEN_SIGNING_FILE")
        .map_err(|_| Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    let bytes = std::fs::read(path)
        .map_err(|_| Refusal::Unavailable("ActionToken signing delivery unavailable".into()))?;
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
        && matches!(protocol_operation, "observe" | "extract_usage")
    {
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
    if !crate::application_binding::read_grant::is_service(ae) || zed.is_empty() {
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
) -> Result<(String, String), Refusal> {
    if crate::application_action::is_human(ae) {
        return Err(invalid());
    }
    issue_application_intent(state, ae, arguments, None).await
}

pub(crate) async fn issue_component_action(
    state: &ServiceState,
    ae: &Execution,
    arguments: &Value,
    external: Uuid,
    key: Uuid,
) -> Result<(String, String), Refusal> {
    if !crate::application_action::is_human(ae) || external.is_nil() || key.is_nil() {
        return Err(invalid());
    }
    issue_application_intent(state, ae, arguments, Some((external, key))).await
}

async fn issue_application_intent(
    state: &ServiceState,
    ae: &Execution,
    arguments: &Value,
    intent: Option<(Uuid, Uuid)>,
) -> Result<(String, String), Refusal> {
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
    let mut claims = application_claims(
        ae,
        parameters,
        parameters["toolParameterHash"].clone(),
        revision,
    )?;
    if let Some((external, key)) = intent {
        claims["external_execution_id"] = json!(external);
        claims["idempotency_key"] = json!(key);
    }
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
    let revision:Option<String>=sqlx::query_scalar("select d.zed_token from admission.external_execution e
        join admission.action_execution a on a.id=e.action_execution_id and a.operation_id=e.operation_id
        join admission.action_execution root on root.id=coalesce(a.parent_action_execution_id,a.id) and root.operation_id=a.operation_id
          and root.parent_action_execution_id is null
        join projection.workflow_ref w on w.action_execution_id=root.id and w.workflow_id=e.workflow_id
        join catalog.application_binding b on b.id=e.component_binding_id and b.component_release_id=e.component_release_id
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
        .bind(args.get("nativeId").and_then(Value::as_str)).fetch_optional(&state.pool).await?;
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
    )?;
    sign_claims(state, audience, claims).await
}

pub(crate) async fn lifecycle_observation_revision(
    state: &ServiceState,
    ae: &Execution,
    operation: &str,
    args: &Value,
) -> Result<String, Refusal> {
    if !matches!(operation, "observe" | "extract_usage")
        || !matches!(
            ae.action_key.as_str(),
            crate::application_binding::CREATE | crate::application_binding::DISABLE
        )
        || ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "DISPATCHED"
    {
        return Err(invalid());
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
