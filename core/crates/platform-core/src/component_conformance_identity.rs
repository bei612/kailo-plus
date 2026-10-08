//! §8A isolated test identity, never a production ActionToken issuer.
//! The original Catalog HUMAN action authorizes running a suite; simulated
//! capability actors/policies remain in the developer environment. In particular
//! registration's result NONE is not translated into a delegation policy.

use contracts::ReasonCode;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::governance::Refusal;

fn refused() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

fn nonempty<'a>(value: &'a Value, key: &str) -> Result<&'a str, Refusal> {
    value[key]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(refused)
}

pub(crate) fn load(artifact: &str, production_audience: &str) -> Result<Value, Refusal> {
    let file = std::env::var("COMPONENT_CONFORMANCE_IDENTITY_FILE")
        .map_err(|_| Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    let bytes = std::fs::read(file)
        .map_err(|_| Refusal::Unavailable("isolated identity delivery unavailable".into()))?;
    let identity: contracts::ComponentConformanceIdentity =
        serde_json::from_slice(&bytes).map_err(|_| refused())?;
    let value = serde_json::to_value(identity).map_err(|_| refused())?;
    // Exact round-trip rejects unknown fields instead of letting a signed
    // configuration have two meanings across consumers.
    if serde_json::from_slice::<Value>(&bytes).map_err(|_| refused())? != value {
        return Err(refused());
    }
    validate(&value, artifact, production_audience)?;
    Ok(value)
}

fn validate(value: &Value, artifact: &str, production_audience: &str) -> Result<(), Refusal> {
    if value["artifactDigest"] != artifact
        || nonempty(value, "audience")? == production_audience
        || value["tokenSeconds"].as_u64().is_none_or(|v| v == 0)
        || value["secretVersion"]
            .as_u64()
            .is_none_or(|v| v == 0 || v > u32::MAX.into())
        || !nonempty(value, "secretLocator")?.starts_with("platform/")
        || !std::path::Path::new(nonempty(value, "jwksFile")?).is_absolute()
    {
        return Err(refused());
    }
    for key in ["issuer", "secretAudience", "privateKeyField"] {
        nonempty(value, key)?;
    }
    let contexts = value["contexts"]
        .as_array()
        .filter(|c| !c.is_empty())
        .ok_or_else(refused)?;
    let mut unique = std::collections::BTreeSet::new();
    for context in contexts {
        let key = (
            nonempty(context, "caseKey")?,
            nonempty(context, "stepKey")?,
            nonempty(context, "operation")?,
        );
        if !unique.insert(key) {
            return Err(refused());
        }
        for field in ["tenantId", "actorPrincipalId"] {
            if Uuid::parse_str(nonempty(context, field)?)
                .map_err(|_| refused())?
                .is_nil()
            {
                return Err(refused());
            }
        }
        for field in ["workspaceId", "targetId", "externalExecutionId"] {
            if context.get(field).is_some()
                && Uuid::parse_str(nonempty(context, field)?)
                    .map_err(|_| refused())?
                    .is_nil()
            {
                return Err(refused());
            }
        }
        if context["actionDefinitionVersion"]
            .as_u64()
            .is_none_or(|v| v == 0)
        {
            return Err(refused());
        }
        result_policy_id(context)?;
        nonempty(context, "actionKey")?;
        nonempty(context, "authorizationMinZedToken")?;
        if context["operation"] == "execute" {
            nonempty(context, "externalExecutionId")?;
        }
        if !matches!(
            nonempty(context, "targetType")?,
            "TENANT" | "WORKSPACE" | "RESOURCE" | "ASSET" | "APPLICATION_BINDING"
        ) {
            return Err(refused());
        }
    }
    Ok(())
}

// Match the existing production binding-create token, not merely an operation
// called handshake. Every business context retains its required policy pair.
pub(crate) fn result_policy_id(context: &Value) -> Result<Option<Uuid>, Refusal> {
    if context["targetType"] == "APPLICATION_BINDING" {
        if context["actionKey"] != crate::application_binding::CREATE
            || !matches!(
                context["operation"].as_str(),
                Some("handshake" | "validate_binding")
            )
            || context.get("resultExposurePolicyId").is_some()
            || context.get("resultExposurePolicyVersion").is_some()
            || context.get("externalExecutionId").is_some()
            || Uuid::parse_str(nonempty(context, "targetId")?)
                .map_err(|_| refused())?
                .is_nil()
        {
            return Err(refused());
        }
        return Ok(None);
    }
    let policy =
        Uuid::parse_str(nonempty(context, "resultExposurePolicyId")?).map_err(|_| refused())?;
    if policy.is_nil()
        || context["resultExposurePolicyVersion"]
            .as_u64()
            .is_none_or(|v| v == 0)
    {
        return Err(refused());
    }
    Ok(Some(policy))
}

pub(crate) fn context<'a>(
    identity: &'a Value,
    step: &Value,
    operation: &str,
) -> Result<&'a Value, Refusal> {
    let found = identity["contexts"]
        .as_array()
        .ok_or_else(refused)?
        .iter()
        .find(|context| {
            context["caseKey"] == step["caseKey"]
                && context["stepKey"] == step["stepKey"]
                && context["operation"] == operation
        })
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    if let Some(contract) = step.get("contractKey") {
        if found["actionKey"] != *contract {
            return Err(refused());
        }
    }
    if let Some(resource) = step.get("referenceResourceId") {
        let (kind, target) = step
            .get("referenceAssetId")
            .map_or(("RESOURCE", resource), |asset| ("ASSET", asset));
        if found["targetType"] != kind || found["targetId"] != *target {
            return Err(refused());
        }
    }
    Ok(found)
}

pub(crate) fn check_plan(identity: &Value, steps: &[Value]) -> Result<(), Refusal> {
    for (index, step) in steps.iter().enumerate() {
        let operation = nonempty(step, "operation")?;
        let principal = context(identity, step, operation)?;
        let request: Value =
            serde_json::from_str(nonempty(step, "requestJson")?).map_err(|_| refused())?;
        parameter_hash(principal, operation, &request)?;
        if nonempty(step, "stepKey")?.starts_with("permission-denied:") {
            let previous = steps
                .get(index.checked_sub(1).ok_or_else(refused)?)
                .ok_or_else(refused)?;
            let original = context(identity, previous, operation)?;
            if step["requestJson"] != previous["requestJson"]
                || step["caseKey"] != previous["caseKey"]
                || principal["actorPrincipalId"] == original["actorPrincipalId"]
            {
                return Err(refused());
            }
            for field in [
                "tenantId",
                "workspaceId",
                "actionKey",
                "actionDefinitionVersion",
                "targetType",
                "targetId",
                "resultExposurePolicyId",
                "resultExposurePolicyVersion",
                "externalExecutionId",
            ] {
                if principal.get(field) != original.get(field) {
                    return Err(refused());
                }
            }
        }
        if matches!(operation, "execute" | "cancel" | "observe" | "reconcile") {
            context(identity, step, "reconcile")?;
        }
    }
    Ok(())
}

// Same parameter binding as production APPLICATION execute. Non-execution
// protocol operations retain ADR-12's operation+arguments domain separation.
fn parameter_hash(context: &Value, operation: &str, parameters: &Value) -> Result<String, Refusal> {
    if operation != "execute" {
        return Ok(collab_bridge::limits::canonical_digest(
            &json!({"operation":operation,"arguments":parameters}),
        ));
    }
    let envelope = parameters.as_object().ok_or_else(refused)?;
    if envelope.len() != 3 || parameters["actionKey"] != context["actionKey"] {
        return Err(refused());
    }
    let key = Uuid::parse_str(nonempty(parameters, "idempotencyKey")?).map_err(|_| refused())?;
    if key.is_nil() {
        return Err(refused());
    }
    let (kind, target) = crate::application_tool::target(&parameters["arguments"])?;
    if context["targetType"] != kind || context["targetId"] != target.to_string() {
        return Err(refused());
    }
    Ok(collab_bridge::limits::canonical_digest(
        &parameters["arguments"],
    ))
}

fn contextual_claims(
    context: &Value,
    action: Uuid,
    operation: Uuid,
    protocol_operation: &str,
    parameters: &Value,
) -> Result<Value, Refusal> {
    if context["operation"] != protocol_operation {
        return Err(refused());
    }
    let mut claims = json!({"tenant_id":context["tenantId"],"actor_principal_id":context["actorPrincipalId"],
        "initiating_human_principal_id":context["actorPrincipalId"],
        "operation_id":operation,"action_execution_id":action,
        "action_key":context["actionKey"],"action_definition_version":context["actionDefinitionVersion"],
        "target_type":context["targetType"],
        "normalized_parameter_hash":parameter_hash(context,protocol_operation,parameters)?,
        "authorization_min_zed_token":nonempty(context,"authorizationMinZedToken")?});
    if let Some(policy) = result_policy_id(context)? {
        claims["result_exposure_policy_id"] = json!(policy);
        claims["result_exposure_policy_version"] = context["resultExposurePolicyVersion"].clone();
    }
    for (source, destination) in [("workspaceId", "workspace_id"), ("targetId", "target_id")] {
        if let Some(value) = context.get(source) {
            claims[destination] = value.clone();
        }
    }
    if protocol_operation == "execute" {
        claims["external_execution_id"] = json!(nonempty(context, "externalExecutionId")?);
        claims["idempotency_key"] = parameters["idempotencyKey"].clone();
    }
    Ok(claims)
}

/// Only Core reads the dedicated versioned private key. Publication is checked
/// against the Agent-delivered JWKS on every issue, so switching the signing
/// version before public-key delivery fails closed. No file/public-key endpoint
/// is created here and no private key or resulting token is persisted.
pub(crate) async fn sign(
    state: &crate::service_api::ServiceState,
    identity: &Value,
    context: &Value,
    action: Uuid,
    operation: Uuid,
    protocol_operation: &str,
    parameters: &Value,
) -> Result<String, Refusal> {
    let issuer = nonempty(identity, "issuer")?;
    let audience = nonempty(identity, "audience")?;
    if state.auth.shares_identity(issuer, audience)
        || state
            .gateway_service_auth
            .as_ref()
            .is_some_and(|auth| auth.shares_identity(issuer, audience))
        || nonempty(identity, "secretAudience")? != state.secret_audience
    {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let version = u32::try_from(identity["secretVersion"].as_u64().ok_or_else(refused)?)
        .map_err(|_| refused())?;
    let reference = secret_store::SecretRef {
        locator: nonempty(identity, "secretLocator")?.into(),
        version,
        audience: state.secret_audience.clone(),
    };
    // The key itself carries its restricted purpose at the same KV version.
    // Reusing a production/session private-key record is not a fallback.
    let purpose = state
        .secrets
        .read(&reference, "purpose")
        .await
        .map_err(|_| Refusal::Unavailable("isolated signing purpose unavailable".into()))?;
    if purpose.expose() != "COMPONENT_CONFORMANCE" {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let key = state
        .secrets
        .read(&reference, nonempty(identity, "privateKeyField")?)
        .await
        .map_err(|_| Refusal::Unavailable("isolated signing key unavailable".into()))?;
    let encoding = EncodingKey::from_ec_pem(key.expose().as_bytes()).map_err(|_| refused())?;
    let now = chrono::Utc::now().timestamp();
    let duration = i64::try_from(identity["tokenSeconds"].as_u64().ok_or_else(refused)?)
        .map_err(|_| refused())?;
    let expiry = now.checked_add(duration).ok_or_else(refused)?;
    let mut claims = contextual_claims(context, action, operation, protocol_operation, parameters)?;
    for (field, value) in [
        ("jti", json!(Uuid::new_v4())),
        ("iss", json!(issuer)),
        ("aud", json!(audience)),
        ("iat", json!(now)),
        ("exp", json!(expiry)),
    ] {
        claims[field] = value;
    }
    let kid = version.to_string();
    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some(kid.clone());
    let token = jsonwebtoken::encode(&header, &claims, &encoding).map_err(|_| refused())?;
    let published: jsonwebtoken::jwk::JwkSet = serde_json::from_slice(
        &std::fs::read(nonempty(identity, "jwksFile")?)
            .map_err(|_| Refusal::Unavailable("isolated JWKS delivery unavailable".into()))?,
    )
    .map_err(|_| refused())?;
    if published
        .keys
        .iter()
        .filter(|key| key.common.key_id.as_deref() == Some(kid.as_str()))
        .count()
        != 1
    {
        return Err(Refusal::Precondition(ReasonCode::ProjectionDelayed));
    }
    let public = published
        .find(&kid)
        .ok_or(Refusal::Precondition(ReasonCode::ProjectionDelayed))?;
    let decoding = DecodingKey::from_jwk(public).map_err(|_| refused())?;
    let mut validation = Validation::new(Algorithm::ES256);
    validation.set_issuer(&[issuer]);
    validation.set_audience(&[audience]);
    validation.leeway = 0;
    let verified = jsonwebtoken::decode::<Value>(&token, &decoding, &validation)
        .map_err(|_| Refusal::Precondition(ReasonCode::ProjectionDelayed))?;
    if verified.claims != claims {
        return Err(refused());
    }
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> Value {
        json!({"artifactDigest":"candidate-artifact","issuer":"isolated-issuer","audience":"isolated-adapter",
            "tokenSeconds":30,"secretLocator":"platform/kv/isolated-suite","secretVersion":2,
            "secretAudience":"core-only","privateKeyField":"privateKey","jwksFile":"/fixture/jwks.json",
            "contexts":[{"caseKey":"roundtrip","stepKey":"consume","operation":"execute",
                "tenantId":Uuid::new_v4(),"actorPrincipalId":Uuid::new_v4(),"actionKey":"document.read",
                "authorizationMinZedToken":"isolated-pep-revision","externalExecutionId":Uuid::new_v4(),
                "actionDefinitionVersion":1,"targetType":"RESOURCE","targetId":Uuid::new_v4(),
                "resultExposurePolicyId":Uuid::new_v4(),"resultExposurePolicyVersion":1}]})
    }

    fn binding_identity(operation: &str) -> Value {
        let mut value = identity();
        let context = &mut value["contexts"][0];
        context["operation"] = json!(operation);
        context["actionKey"] = json!(crate::application_binding::CREATE);
        context["targetType"] = json!("APPLICATION_BINDING");
        for field in [
            "resultExposurePolicyId",
            "resultExposurePolicyVersion",
            "externalExecutionId",
        ] {
            context.as_object_mut().unwrap().remove(field);
        }
        value
    }

    #[test]
    fn binding_management_preserves_production_none_without_business_authority() {
        for operation in ["handshake", "validate_binding"] {
            let value = binding_identity(operation);
            assert!(validate(&value, "candidate-artifact", "production-adapter").is_ok());
            let context = &value["contexts"][0];
            assert_eq!(result_policy_id(context).unwrap(), None);
            let parameters = json!({"idempotencyKey":Uuid::new_v4()});
            let claims = contextual_claims(
                context,
                Uuid::new_v4(),
                Uuid::new_v4(),
                operation,
                &parameters,
            )
            .unwrap();
            assert_eq!(claims["target_type"], "APPLICATION_BINDING");
            assert_eq!(claims["target_id"], context["targetId"]);
            assert_eq!(claims["action_key"], crate::application_binding::CREATE);
            assert_eq!(
                claims["actor_principal_id"],
                claims["initiating_human_principal_id"]
            );
            assert_eq!(
                claims["normalized_parameter_hash"],
                collab_bridge::limits::canonical_digest(
                    &json!({"operation":operation,"arguments":parameters})
                )
            );
            for field in [
                "result_exposure_policy_id",
                "result_exposure_policy_version",
                "external_execution_id",
                "idempotency_key",
                "agent_principal_id",
                "delegation_id",
            ] {
                assert!(claims.get(field).is_none(), "{field}");
            }
            assert!(contextual_claims(
                context,
                Uuid::new_v4(),
                Uuid::new_v4(),
                "query_revision",
                &parameters
            )
            .is_err());
        }
    }

    #[test]
    fn none_is_only_the_exact_binding_create_management_context() {
        let original = binding_identity("handshake");
        for (field, replacement) in [
            ("actionKey", json!(crate::application_binding::DISABLE)),
            ("operation", json!("execute")),
            ("operation", json!("query_revision")),
            ("operation", json!("resolve_native_scope")),
            ("targetType", json!("RESOURCE")),
            ("targetId", json!(Uuid::nil())),
            ("targetId", Value::Null),
            ("resultExposurePolicyId", json!(Uuid::new_v4())),
            ("resultExposurePolicyId", Value::Null),
            ("resultExposurePolicyVersion", json!(1)),
            ("resultExposurePolicyVersion", Value::Null),
            ("externalExecutionId", json!(Uuid::new_v4())),
            ("externalExecutionId", Value::Null),
        ] {
            let mut changed = original.clone();
            changed["contexts"][0][field] = replacement;
            assert!(
                validate(&changed, "candidate-artifact", "production-adapter").is_err(),
                "{field}"
            );
        }
        let mut business = identity();
        assert!(result_policy_id(&business["contexts"][0])
            .unwrap()
            .is_some());
        business["contexts"][0]["operation"] = json!("handshake");
        assert!(validate(&business, "candidate-artifact", "production-adapter").is_ok());
        for field in ["resultExposurePolicyId", "resultExposurePolicyVersion"] {
            let mut missing = business.clone();
            missing["contexts"][0]
                .as_object_mut()
                .unwrap()
                .remove(field);
            assert!(
                validate(&missing, "candidate-artifact", "production-adapter").is_err(),
                "{field}"
            );
        }
    }

    #[test]
    fn isolated_context_cannot_reuse_production_audience_or_unknown_scope() {
        let value = identity();
        assert!(validate(&value, "candidate-artifact", "production-adapter").is_ok());
        for (key, replacement) in [
            ("audience", json!("production-adapter")),
            ("artifactDigest", json!("other")),
            ("secretLocator", json!("tenant/kv/key")),
            ("secretVersion", json!(0)),
            ("tokenSeconds", json!(0)),
            ("jwksFile", json!("relative.json")),
        ] {
            let mut changed = value.clone();
            changed[key] = replacement;
            assert!(
                validate(&changed, "candidate-artifact", "production-adapter").is_err(),
                "{key}"
            );
        }
        let mut duplicate = value.clone();
        duplicate["contexts"]
            .as_array_mut()
            .unwrap()
            .push(value["contexts"][0].clone());
        assert!(validate(&duplicate, "candidate-artifact", "production-adapter").is_err());
    }

    #[test]
    fn dynamic_reference_target_and_contract_select_exact_mock_context() {
        let value = identity();
        let mut step = json!({"caseKey":"roundtrip","stepKey":"consume","contractKey":"document.read",
            "referenceResourceId":value["contexts"][0]["targetId"]});
        assert!(context(&value, &step, "execute").is_ok());
        assert!(context(&value, &step, "reconcile").is_err());
        step["referenceResourceId"] = json!(Uuid::new_v4());
        assert!(context(&value, &step, "execute").is_err());
        step["referenceResourceId"] = value["contexts"][0]["targetId"].clone();
        step["contractKey"] = json!("document.export");
        assert!(context(&value, &step, "execute").is_err());
    }

    #[test]
    fn capability_execute_matches_production_claims_and_parameter_binding() {
        let value = identity();
        let context = &value["contexts"][0];
        let input = json!({"resourceId":context["targetId"],"nativeObjectRef":"native-document",
            "nativeRevision":"original-version","displayName":"document","mediaType":"text/plain"});
        let request = json!({"idempotencyKey":Uuid::new_v4(),"actionKey":context["actionKey"],
            "arguments":{"target":{"resourceId":context["targetId"]},"input":input}});
        let claims =
            contextual_claims(context, Uuid::new_v4(), Uuid::new_v4(), "execute", &request)
                .unwrap();
        assert_eq!(
            claims["normalized_parameter_hash"],
            collab_bridge::limits::canonical_digest(&request["arguments"])
        );
        assert_eq!(
            claims["initiating_human_principal_id"],
            context["actorPrincipalId"]
        );
        assert_eq!(
            claims["external_execution_id"],
            context["externalExecutionId"]
        );
        assert_eq!(claims["idempotency_key"], request["idempotencyKey"]);
        assert_eq!(
            claims["authorization_min_zed_token"],
            context["authorizationMinZedToken"]
        );
        assert!(claims.get("agent_principal_id").is_none());
        assert!(claims.get("delegation_id").is_none());
        let mut wrong = request.clone();
        wrong["arguments"]["target"]["resourceId"] = json!(Uuid::new_v4());
        assert!(parameter_hash(context, "execute", &wrong).is_err());
        wrong = request.clone();
        wrong["actionKey"] = json!("different.action");
        assert!(parameter_hash(context, "execute", &wrong).is_err());
        let old_wire = json!({"idempotencyKey":request["idempotencyKey"],"contractKey":context["actionKey"],"inputJson":input.to_string()});
        assert!(parameter_hash(context, "execute", &old_wire).is_err());
        let mut missing_revision = context.clone();
        missing_revision
            .as_object_mut()
            .unwrap()
            .remove("authorizationMinZedToken");
        assert!(contextual_claims(
            &missing_revision,
            Uuid::new_v4(),
            Uuid::new_v4(),
            "execute",
            &request
        )
        .is_err());
        assert_eq!(
            parameter_hash(context, "query_revision", &input).unwrap(),
            collab_bridge::limits::canonical_digest(
                &json!({"operation":"query_revision","arguments":input})
            )
        );
    }
}
