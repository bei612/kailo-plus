//! DD-92: Application model references consume the original llm_route authority.
//! Native services own their model configuration. Core neither writes it nor
//! borrows an AgentInstallation's provider identity or credentials.

use super::*;

/// A HUMAN component action already has an immutable original operation/AE.
/// Reuse those identifiers for W3C propagation; do not create an Agent trace.
pub(crate) fn human_traceparent(ae: &Execution) -> Option<String> {
    (ae.actor_principal_id == ae.initiator_principal_id
        && ae.parameters.as_ref()?.get("componentActionKind")? == "COMPONENT_ACTION")
        .then(|| {
            format!(
                "00-{}-{}-01",
                ae.operation_id.simple(),
                &ae.id.simple().to_string()[..16]
            )
        })
}
use crate::governance::Execution;

/// Internal validated references. The wire shape remains the shared schema and
/// the approved release's bindingConfigSchema, not a second model directory.
pub(crate) struct Configuration {
    pub(crate) routes: Vec<Uuid>,
    pub(crate) meters: Vec<String>,
}

pub(crate) fn configuration(
    mode: &str,
    config: &Value,
    categories: &Value,
    manifest: &Value,
) -> Result<Option<Configuration>, Refusal> {
    let invalid = || Refusal::Precondition(ReasonCode::InvalidParameters);
    let blocked = || Refusal::Blocked(ReasonCode::CapabilityBlocked);
    let allowed = manifest["allowedModelCallModes"]
        .as_array()
        .ok_or_else(blocked)?;
    if !allowed.iter().any(|value| value.as_str() == Some(mode)) {
        return Err(blocked());
    }
    if mode == "NONE" {
        if config.get("modelGateway").is_some() {
            return Err(invalid());
        }
        return Ok(None);
    }
    if mode != "PLATFORM_LLM_ROUTE" {
        return Err(blocked());
    }
    let value = &config["modelGateway"];
    let schema: Value = serde_json::from_str(include_str!(
        "../../../../contracts/domain/application_model_gateway_config.schema.json"
    ))
    .map_err(|_| unavailable())?;
    if !crate::capability_contract::schema_validator(&schema, &Default::default())?.is_valid(value)
    {
        return Err(invalid());
    }
    let categories = categories.as_array().ok_or_else(invalid)?;
    if categories.is_empty() {
        return Err(invalid());
    }
    let declarations = manifest["capabilityDeclarations"]
        .as_array()
        .ok_or_else(blocked)?;
    for category in categories {
        let matching: Vec<_> = declarations
            .iter()
            .filter(|entry| {
                entry["categoryKey"] == category["category"]
                    && entry["contractVersion"] == category["version"]
            })
            .collect();
        let [declaration] = matching.as_slice() else {
            return Err(blocked());
        };
        if declaration["meter"] != "SUPPORTED" {
            return Err(blocked());
        }
    }
    let meters: Vec<String> =
        serde_json::from_value(value["meterKeys"].clone()).map_err(|_| invalid())?;
    // Gateway model metering is not the native MCP tool's NONE usage source.
    // These references remain constrained by the approved bindingConfigSchema;
    // their actual aggregation/event/quantity mapping is read from OpenMeter.
    if meters.is_empty()
        || meters
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != meters.len()
        || meters
            .iter()
            .any(|key| key.trim().is_empty() || key.trim() != key)
    {
        return Err(blocked());
    }
    let routes: Vec<Uuid> =
        serde_json::from_value(value["routeResourceIds"].clone()).map_err(|_| invalid())?;
    if routes.is_empty()
        || routes
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != routes.len()
        || routes.iter().any(Uuid::is_nil)
    {
        return Err(invalid());
    }
    Ok(Some(Configuration { routes, meters }))
}

/// The existing binding management caller checks both execution and sharing
/// authority before it can delegate a route to the binding's SERVICE. A tenant
/// binding cannot silently borrow a workspace-scoped route.
async fn authorize_routes(
    state: &ServiceState,
    ae: &Execution,
    configuration: &Configuration,
) -> Result<Vec<Route>, Refusal> {
    let mut routes = Vec::new();
    for id in &configuration.routes {
        let route: Route = sqlx::query_as(ROUTE)
            .bind(id)
            .bind(ae.tenant_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or(Refusal::Precondition(ReasonCode::BindingNotActive))?;
        if route.home_workspace_id.is_some() && route.home_workspace_id != ae.workspace_id {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        if !state
            .governance
            .spicedb
            .resource_projection_matches_in_workspace(
                &id.to_string(),
                &ae.tenant_id.to_string(),
                &route.owner_principal_id.to_string(),
                route.home_workspace_id.map(|id| id.to_string()).as_deref(),
                state.governance.cfg.relationship_page,
            )
            .await
            .map_err(|_| unavailable())?
        {
            return Err(unavailable());
        }
        for permission in ["discover", "execute", "share"] {
            let checked = state
                .governance
                .spicedb
                .check(
                    "resource",
                    &id.to_string(),
                    permission,
                    &ae.initiator_principal_id.to_string(),
                    Consistency::FullyConsistent,
                )
                .await
                .map_err(|_| unavailable())?;
            if checked.zed_token.is_empty() {
                return Err(unavailable());
            }
            if !checked.allowed {
                return Err(Refusal::Denied(ReasonCode::PermissionDenied));
            }
        }
        routes.push(route);
    }
    Ok(routes)
}

#[derive(FromRow)]
struct Scope {
    tenant_id: Uuid,
    workspace_id: Option<Uuid>,
    service_principal_id: Uuid,
    service_audience: String,
    adapter_service_ref: String,
    native_instance_ref: String,
    native_scope_ref: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
    component_release_id: Uuid,
    generation: i64,
    state: String,
    model_call_mode: String,
    config: Value,
    config_digest: String,
    categories: Value,
    manifest: Value,
    action_execution_id: Uuid,
    operation_id: Uuid,
    model_projection: Option<Value>,
    model_delivery_receipt: Option<Value>,
    model_state: Option<String>,
    model_dispatch_started: bool,
}

async fn scope(
    state: &ServiceState,
    binding: Uuid,
    generation: Option<i64>,
) -> Result<Scope, Refusal> {
    sqlx::query_as("select b.tenant_id,b.workspace_id,b.service_principal_id,s.audience as service_audience,
        b.adapter_service_ref,b.native_instance_ref,
        coalesce(b.native_scope_ref,p.observation->>'nativeScopeRef') as native_scope_ref,a.created_at,
        b.component_release_id,p.generation,b.state,b.model_call_mode,
        b.normalized_config as config,b.config_digest,b.capability_categories as categories,
        r.manifest,p.action_execution_id,a.operation_id,p.model_projection,p.model_delivery_receipt,p.model_state,
        p.model_dispatch_started
        from catalog.application_binding b join projection.application_runtime p on p.binding_id=b.id
        join catalog.component_release r on r.id=p.component_release_id
        join admission.action_execution a on a.id=p.action_execution_id
        join identity.service_principal s on s.principal_id=b.service_principal_id
          and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
        where b.id=$1 and ($2::bigint is null or p.generation=$2)
          and p.component_release_id=b.component_release_id
          and (b.native_scope_ref is null or b.native_scope_ref=p.observation->>'nativeScopeRef')
          and a.action_key='application_binding.create' and a.target_id=b.id
          and a.tenant_id=b.tenant_id and a.workspace_id is not distinct from b.workspace_id
        order by p.generation desc limit 1")
        .bind(binding).bind(generation).fetch_optional(&state.pool).await?
        .ok_or_else(conflict)
}

fn reference(projection: &Value) -> Result<SecretRef, Refusal> {
    let value = &projection["secretRef"];
    let locator = value["locator"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(unavailable)?;
    let audience = value["audience"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(unavailable)?;
    let version = value["version"]
        .as_u64()
        .and_then(|v| u32::try_from(v).ok())
        .filter(|v| *v > 0)
        .ok_or_else(unavailable)?;
    Ok(SecretRef {
        locator: locator.into(),
        audience: audience.into(),
        version,
    })
}

/// The original COMPONENT_BINDING action owns this projection and every native
/// side effect. A lost key-create ACK is reconciled against the exact native
/// key hash/metadata; an absent uncertain key is never recreated.
pub(crate) async fn provision(state: &ServiceState, ae: &Execution) -> Result<(), Refusal> {
    let current = scope(state, ae.target_id, None).await?;
    let Some(config) = configuration(
        &current.model_call_mode,
        &current.config,
        &current.categories,
        &current.manifest,
    )?
    else {
        return Ok(());
    };
    if current.state != "PROVISIONING"
        || current.action_execution_id != ae.id
        || current.tenant_id != ae.tenant_id
        || current.workspace_id != ae.workspace_id
        || ae.action_key != "application_binding.create"
        || ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "DISPATCHED"
    {
        return Err(conflict());
    }
    let routes = authorize_routes(state, ae, &config).await?;
    let gateway = Gateway::from_env()?;
    gateway.check_authentication().await?;
    check_policy(state, &gateway).await?;
    crate::gateway_usage::verify_application_reader(current.service_principal_id)
        .await
        .map_err(|_| unavailable())?;
    crate::service_api::audit_gate(state)
        .await
        .map_err(|_| unavailable())?;
    let customer: Option<(String, String)> = sqlx::query_as(
        "select customer_id,subject_key_prefix from projection.openmeter_binding
         where tenant_id=$1 and status='ACTIVE'",
    )
    .bind(ae.tenant_id)
    .fetch_optional(&state.pool)
    .await?;
    let (customer, prefix) = customer.ok_or_else(unavailable)?;
    if prefix != format!("{}:", ae.tenant_id) {
        return Err(conflict());
    }
    let subject = format!("{prefix}{}", ae.target_id);
    let meters = state
        .openmeter
        .application_model_meters(ae.tenant_id, &customer, &subject, &config.meters)
        .await
        .map_err(|_| unavailable())?;
    let mut native_models = Vec::new();
    let mut frozen_routes = Vec::new();
    for (id, route) in config.routes.iter().zip(&routes) {
        gateway.check_route(route).await?;
        native_models.push(route.native_id.clone());
        frozen_routes.push(
            json!({"resourceId":id,"resourceVersion":route.resource_version,
            "nativeId":route.native_id,"nativeRevision":route.native_revision,
            "nativeConfigHash":route.native_config_hash}),
        );
    }
    native_models.sort();
    native_models.dedup();
    if native_models.len() != routes.len() {
        return Err(conflict());
    }
    let locator = state.secrets.tenant_locator(
        ae.tenant_id,
        &format!("application-model/{}/{}", ae.target_id, current.generation),
    );
    let adapter = crate::application_binding::native::Adapter::resolve(
        &current.adapter_service_ref,
        &current.native_instance_ref,
        &current.manifest,
    )?;
    let (reader, deliveries) =
        adapter.model_reader_delivery(current.service_principal_id, ae.target_id)?;
    if reader["audience"] != current.service_audience
        || current.service_audience == state.secret_audience
    {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let native_scope = current
        .native_scope_ref
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or(Refusal::Precondition(ReasonCode::ProjectionDelayed))?;
    let challenges = match current.model_projection.as_ref() {
        Some(existing) => existing["deliveryChallenges"].clone(),
        None => {
            let mut challenges = Vec::new();
            for route in &config.routes {
                let mut nonce = [0_u8; 32];
                getrandom::fill(&mut nonce).map_err(|_| unavailable())?;
                challenges
                    .push(json!({"routeResourceId":route,"verificationNonce":hex::encode(nonce)}));
            }
            json!(challenges)
        }
    };
    let mut admission_policy = policy(state)?["conditional"][0].clone();
    admission_policy
        .as_object_mut()
        .ok_or_else(unavailable)?
        .remove("condition");
    let projection = json!({"tenantId":ae.tenant_id,"workspaceId":ae.workspace_id,
        "bindingId":ae.target_id,"componentReleaseId":current.component_release_id,
        "generation":current.generation,"gatewayPrincipalId":current.service_principal_id,
        "operationId":current.operation_id,"configDigest":current.config_digest,
        "routeResourceIds":config.routes,"routes":frozen_routes,"nativeModels":native_models,
        "meterKeys":config.meters,"meters":meters,"customerId":customer,"subject":subject,
        "namespace":state.openmeter.namespace(),"modelAdmissionPolicy":admission_policy,
        "nativeScopeRef":native_scope,"secretReader":reader,"deliveryChallenges":challenges,
        "serviceSecretRef":{"locator":locator,"version":1,"audience":current.service_audience},
        "secretRef":{"locator":locator,"version":1,"audience":state.secret_audience}});
    let mut tx = state.pool.begin().await?;
    let frozen: Option<Option<Value>> = sqlx::query_scalar(
        "select p.model_projection from projection.application_runtime p
         join catalog.application_binding b on b.id=p.binding_id
         where p.binding_id=$1 and p.generation=$2 and p.action_execution_id=$3
           and b.state='PROVISIONING' and b.projection_action_execution_id=$3
         for update of b,p",
    )
    .bind(ae.target_id)
    .bind(current.generation)
    .bind(ae.id)
    .fetch_optional(&mut *tx)
    .await?;
    match frozen.ok_or_else(conflict)? {
        Some(frozen) if frozen != projection => return Err(conflict()),
        Some(_) => {}
        None => {
            sqlx::query("update projection.application_runtime set model_projection=$3,model_state='PENDING'
                where binding_id=$1 and generation=$2")
                .bind(ae.target_id).bind(current.generation).bind(&projection).execute(&mut *tx).await?;
        }
    }
    // Persist every touched reference before the first external relationship.
    tx.commit().await?;
    let mut tx = state.pool.begin().await?;
    let live: Option<Uuid> = sqlx::query_scalar(
        "select b.id from catalog.application_binding b
        join projection.application_runtime p on p.binding_id=b.id and p.generation=$2
        where b.id=$1 and b.state='PROVISIONING' and b.projection_action_execution_id=$3
          and p.model_projection=$4 for update of b,p",
    )
    .bind(ae.target_id)
    .bind(current.generation)
    .bind(ae.id)
    .bind(&projection)
    .fetch_optional(&mut *tx)
    .await?;
    if live != Some(ae.target_id) {
        return Err(conflict());
    }
    // Serialize route grants with the original binding lifecycle. Once disable
    // owns the binding row this writer cannot re-grant the service identity.
    for id in &config.routes {
        let token = state
            .governance
            .spicedb
            .write(&["discoverer", "executor"].map(|relation| {
                (
                    Write::Touch,
                    Relationship {
                        object_type: "resource".into(),
                        object_id: id.to_string(),
                        relation: relation.into(),
                        subject_principal: current.service_principal_id.to_string(),
                    },
                )
            }))
            .await
            .map_err(|_| unavailable())?;
        if token.is_empty() {
            return Err(unavailable());
        }
    }
    // Persist the exact locator and generation before a CAS write to OpenBao.
    tx.commit().await?;
    let secret_ref = reference(&projection)?;
    let secret = match state.secrets.read(&secret_ref, "value").await {
        Ok(value) => value,
        Err(secret_store::SecretError::VersionUnavailable) => {
            let mut bytes = vec![0; Sha256::output_size()];
            getrandom::fill(&mut bytes).map_err(|_| unavailable())?;
            let value = hex::encode(bytes);
            if state
                .secrets
                .write_once(&secret_ref.locator, "value", &value)
                .await
                .map_err(|_| unavailable())?
                != 1
            {
                return Err(conflict());
            }
            state
                .secrets
                .read(&secret_ref, "value")
                .await
                .map_err(|_| unavailable())?
        }
        Err(_) => return Err(unavailable()),
    };
    if secret.expose().is_empty() {
        return Err(unavailable());
    }
    let desired = native_key(&projection, &secret);
    let mut tx = state.pool.begin().await?;
    let row: Option<(bool,Option<String>,Option<i64>)> = sqlx::query_as(
        "select p.model_dispatch_started,p.model_native_key_id,p.model_native_key_revision
         from projection.application_runtime p join catalog.application_binding b on b.id=p.binding_id
         where p.binding_id=$1 and p.generation=$2 and p.model_projection=$3
           and b.state='PROVISIONING' and b.projection_action_execution_id=$4
           and p.model_state in ('PENDING','ACTIVE') for update of b,p")
        .bind(ae.target_id).bind(current.generation).bind(&projection).bind(ae.id)
        .fetch_optional(&mut *tx).await?;
    let (dispatched, id, revision) = row.ok_or_else(conflict)?;
    let existing = gateway.find_key(&desired).await?;
    if id.is_some() && existing != id.zip(revision) {
        return Err(conflict());
    }
    if existing.is_none() && dispatched {
        return Err(unavailable());
    }
    let create = existing.is_none();
    if create {
        sqlx::query(
            "update projection.application_runtime set model_dispatch_started=true
            where binding_id=$1 and generation=$2",
        )
        .bind(ae.target_id)
        .bind(current.generation)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    if create {
        gateway.create_key(&desired).await?;
    }
    let (id, revision) = gateway.find_key(&desired).await?.ok_or_else(unavailable)?;
    gateway.check_models(&native_models, &secret).await?;
    // A lost commit acknowledgement reuses the immutable verified receipt. It
    // does not require rereading a rotated audit file or rewriting native keys.
    let receipt = match current.model_delivery_receipt.as_ref() {
        Some(receipt) => receipt.clone(),
        None => verify_model_delivery(state, &current, &projection, &deliveries, &secret).await?,
    };
    authorize_routes(state, ae, &config).await?;
    let changed = sqlx::query("update projection.application_runtime p set model_state='ACTIVE',
        model_dispatch_started=true,model_native_key_id=$3,model_native_key_revision=$4,
        model_delivery_receipt=$7
        from catalog.application_binding b where p.binding_id=$1 and p.generation=$2 and b.id=p.binding_id
          and b.state='PROVISIONING' and b.projection_action_execution_id=$5
          and p.model_projection=$6 and p.model_state in ('PENDING','ACTIVE')")
        .bind(ae.target_id).bind(current.generation).bind(id).bind(revision).bind(ae.id)
        .bind(projection).bind(receipt).execute(&state.pool).await?;
    if changed.rows_affected() != 1 {
        return Err(conflict());
    }
    Ok(())
}

/// A configured flag or an HTTP acknowledgement is not proof of this value.
/// The original native credential reader answers the frozen random challenge;
/// the original OpenBao audit observer independently verifies the service read.
async fn verify_model_delivery(
    state: &ServiceState,
    current: &Scope,
    projection: &Value,
    deliveries: &[Value],
    secret: &SecretValue,
) -> Result<Value, Refusal> {
    let delayed = || Refusal::Precondition(ReasonCode::ProjectionDelayed);
    let expected: Vec<_> = deliveries
        .iter()
        .filter(|receipt| receipt["generation"] == projection["generation"])
        .collect();
    let challenges = projection["deliveryChallenges"]
        .as_array()
        .ok_or_else(delayed)?;
    if expected.len() != challenges.len() || challenges.is_empty() {
        return Err(delayed());
    }
    let reference = SecretRef {
        locator: projection["serviceSecretRef"]["locator"]
            .as_str()
            .ok_or_else(delayed)?
            .into(),
        version: projection["serviceSecretRef"]["version"]
            .as_u64()
            .and_then(|value| u32::try_from(value).ok())
            .filter(|value| *value > 0)
            .ok_or_else(delayed)?,
        audience: current.service_audience.clone(),
    };
    let role = projection["secretReader"]["roleName"]
        .as_str()
        .ok_or_else(delayed)?;
    let mut requests = std::collections::BTreeSet::new();
    let mut native_models = std::collections::BTreeSet::new();
    let mut receipts = Vec::new();
    for challenge in challenges {
        let mut matches = expected
            .iter()
            .copied()
            .filter(|receipt| receipt["routeResourceId"] == challenge["routeResourceId"]);
        let receipt = matches.next().ok_or_else(delayed)?;
        if matches.next().is_some() {
            return Err(delayed());
        }
        for key in [
            "bindingId",
            "generation",
            "configDigest",
            "servicePrincipalId",
            "nativeScopeRef",
        ] {
            let wanted = if key == "servicePrincipalId" {
                &projection["gatewayPrincipalId"]
            } else {
                &projection[key]
            };
            if &receipt[key] != wanted {
                return Err(delayed());
            }
        }
        if receipt["secretRef"] != projection["serviceSecretRef"]
            || receipt["verificationNonce"] != challenge["verificationNonce"]
        {
            return Err(delayed());
        }
        let scope = receipt["nativeScopeRef"].as_str().ok_or_else(delayed)?;
        let model = receipt["nativeModelRef"]
            .as_str()
            .filter(|v| !v.is_empty() && !v.contains('\0'))
            .ok_or_else(delayed)?;
        let nonce = challenge["verificationNonce"]
            .as_str()
            .ok_or_else(delayed)?;
        let proof = receipt["nativeProof"]
            .as_str()
            .and_then(|v| hex::decode(v).ok())
            .ok_or_else(delayed)?;
        if scope.contains('\0')
            || nonce.len() != 64
            || hex::decode(nonce).is_err()
            || !native_models.insert(model)
        {
            return Err(delayed());
        }
        let message = format!("application-model-key:v1\0{scope}\0{model}\0{nonce}");
        ring::hmac::verify(
            &ring::hmac::Key::new(ring::hmac::HMAC_SHA256, secret.expose().as_bytes()),
            message.as_bytes(),
            &proof,
        )
        .map_err(|_| delayed())?;
        let request = receipt["requestId"].as_str().ok_or_else(delayed)?;
        Uuid::parse_str(request).map_err(|_| delayed())?;
        requests.insert(request);
        receipts.push(receipt.clone());
    }
    // One Agent read may render several route-specific handoffs of the same KV
    // version; verify each distinct native request only once, never fabricate it.
    let reads: Vec<_> = requests
        .into_iter()
        .map(|request_id| secret_store::AuditedSecretRead {
            reference: &reference,
            request_id,
            role_name: role,
            not_before: current.created_at,
        })
        .collect();
    state
        .audit
        .verify_secret_reads(&reads)
        .await
        .map_err(|_| delayed())?;
    Ok(json!(receipts))
}

fn native_key(projection: &Value, secret: &SecretValue) -> Value {
    json!({"keyHash":format!("sha256:{}",hex::encode(Sha256::digest(secret.expose().as_bytes()))),
        "allowedModels":projection["nativeModels"],"metadata":{
            "user":projection["gatewayPrincipalId"],"servicePrincipalId":projection["gatewayPrincipalId"],
            "tenantId":projection["tenantId"],"workspaceId":projection["workspaceId"],
            "componentBindingId":projection["bindingId"],"componentReleaseId":projection["componentReleaseId"],
            "projectionGeneration":projection["generation"],"modelAdmissionPolicy":projection["modelAdmissionPolicy"]}})
}

/// Revocation never resends a model call. The original native ConfigResource
/// tombstone fences provider dispatch; its complete durable set then settles
/// through the existing Core usage outbox before the generation can close.
pub(crate) async fn revoke(state: &ServiceState, ae: &Execution) -> Result<(), Refusal> {
    let generations:Vec<i64>=sqlx::query_scalar("select generation from projection.application_runtime
        where binding_id=$1 and model_projection is not null and model_state<>'REVOKED' order by generation")
        .bind(ae.target_id).fetch_all(&state.pool).await?;
    if generations.is_empty() {
        return Ok(());
    }
    let gateway = Gateway::from_env()?;
    for generation in generations {
        let current = scope(state, ae.target_id, Some(generation)).await?;
        if current.state != "DISABLING"
            || current.tenant_id != ae.tenant_id
            || current.workspace_id != ae.workspace_id
            || !matches!(
                ae.action_key.as_str(),
                "application_binding.disable" | "application_binding.create"
            )
        {
            return Err(conflict());
        }
        let projection = current.model_projection.as_ref().ok_or_else(conflict)?;
        let receipt = if current.model_dispatch_started {
            let secret = state
                .secrets
                .read(&reference(projection)?, "value")
                .await
                .map_err(|_| unavailable())?;
            let desired = native_key(projection, &secret);
            if let Some((id, _)) = gateway.find_key(&desired).await? {
                gateway.delete("llm.apiKey", &id).await?;
            }
            // Absence alone is not a fence: the native outbox reader separately
            // requires this exact service identity's durable key tombstones.
            if gateway.find_key(&desired).await?.is_some() {
                return Err(unavailable());
            }
            gateway.require_key_rejected(&secret).await?;
            crate::gateway_usage::committed_application(
                &state.pool,
                &state.openmeter,
                ae.target_id,
                generation,
            )
            .await
            .map_err(|_| unavailable())?
            .ok_or_else(unavailable)?
        } else {
            json!({"generation":generation,"dispatchStarted":false})
        };
        let config = configuration(
            &current.model_call_mode,
            &current.config,
            &current.categories,
            &current.manifest,
        )?
        .ok_or_else(conflict)?;
        for id in config.routes {
            let token = state
                .governance
                .spicedb
                .write(&["discoverer", "executor"].map(|relation| {
                    (
                        Write::Delete,
                        Relationship {
                            object_type: "resource".into(),
                            object_id: id.to_string(),
                            relation: relation.into(),
                            subject_principal: current.service_principal_id.to_string(),
                        },
                    )
                }))
                .await
                .map_err(|_| unavailable())?;
            if token.is_empty() {
                return Err(unavailable());
            }
        }
        let rows=sqlx::query("update projection.application_runtime p set model_state='REVOKED',model_usage_receipt=$3
            from catalog.application_binding b where p.binding_id=$1 and p.generation=$2 and b.id=p.binding_id
              and b.state='DISABLING' and p.model_projection=$4 and p.model_state in ('PENDING','ACTIVE')")
            .bind(ae.target_id).bind(generation).bind(receipt).bind(projection).execute(&state.pool).await?;
        if rows.rows_affected() != 1 {
            return Err(conflict());
        }
    }
    Ok(())
}

/// Fixed native ExtAuthz HTTP encoding. The authorization body consists only
/// of verified apiKey metadata and request routing metadata, never model input.
fn policy(state: &ServiceState) -> Result<Value, Refusal> {
    let auth = state
        .gateway_service_auth
        .as_ref()
        .ok_or_else(unavailable)?;
    let mut endpoint = auth.mcp_url().clone();
    endpoint.set_path("/");
    Ok(json!({"conditional":[{
        "condition":"has(apiKey.componentBindingId)",
        "host":endpoint.as_str(),
        "failureMode":"deny",
        "includeRequestHeaders":["content-type"],
        "policies":{"backendAuth":auth.backend_auth()},
        "protocol":{"http":{
            "path":"'/service/v1/application-models/check'",
            "body":"{'bindingId': apiKey.componentBindingId, 'gatewayPrincipalId': apiKey.servicePrincipalId, 'generation': apiKey.projectionGeneration, 'method': request.method, 'path': request.path, 'traceparent': ('traceparent' in request.headers) ? request.headers['traceparent'] : ''}",
            "addRequestHeaders":{"content-type":"'application/json'"}
        }}
    }]}))
}

async fn check_policy(state: &ServiceState, gateway: &Gateway) -> Result<(), Refusal> {
    let effective = gateway.admin(&["api", "config", "effective"], None).await?;
    if effective.pointer("/llm/policies/extAuthz") != Some(&policy(state)?) {
        return Err(unavailable());
    }
    Ok(())
}

/// Native Gateway machine identity authenticates this request; its verified
/// apiKey metadata is then resolved against the original binding generation.
/// The user's bearer and model request body are not forwarded to this endpoint.
pub(crate) async fn check(
    axum::extract::State(state): axum::extract::State<ServiceState>,
    headers: axum::http::HeaderMap,
    body: Result<axum::Json<Value>, axum::extract::rejection::JsonRejection>,
) -> axum::response::Response {
    use axum::{http::StatusCode, response::IntoResponse};
    let Some(auth) = state.gateway_service_auth.as_ref() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let mut authorizations = headers.get_all(axum::http::header::AUTHORIZATION).iter();
    let authorization = authorizations.next().and_then(|v| v.to_str().ok());
    if authorizations.next().is_some() || auth.verify(authorization).await.is_err() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(axum::Json(raw)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Ok(input) = serde_json::from_value::<contracts::ApplicationModelAdmission>(raw.clone())
    else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if serde_json::to_value(&input).ok().as_ref() != Some(&raw) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match admit(&state, &input).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(error) => error.respond(None),
    }
}

async fn admit(
    state: &ServiceState,
    input: &contracts::ApplicationModelAdmission,
) -> Result<(), Refusal> {
    let denied = || Refusal::Denied(ReasonCode::PermissionDenied);
    let binding = Uuid::parse_str(&input.binding_id).map_err(|_| denied())?;
    let service = Uuid::parse_str(&input.gateway_principal_id).map_err(|_| denied())?;
    if binding.is_nil() || service.is_nil() || input.generation <= 0 {
        return Err(denied());
    }
    let current = scope(state, binding, Some(input.generation)).await?;
    if current.service_principal_id != service || current.model_call_mode != "PLATFORM_LLM_ROUTE" {
        return Err(denied());
    }
    let projection = current.model_projection.as_ref().ok_or_else(denied)?;
    let gateway = Gateway::from_env()?;
    let mut models_url = gateway.model_base.clone();
    models_url
        .path_segments_mut()
        .map_err(|_| unavailable())?
        .pop_if_empty()
        .push("models");
    let discovery = input.method == "GET" && input.path == models_url.path();
    if !(current.state == "ACTIVE" && current.model_state.as_deref() == Some("ACTIVE")
        || discovery
            && current.state == "PROVISIONING"
            && current.model_state.as_deref() == Some("PENDING"))
    {
        return Err(denied());
    }
    let live: bool = sqlx::query_scalar("select exists(select 1 from catalog.application_binding b
        join projection.application_runtime p on p.binding_id=b.id and p.generation=$2
        join identity.tenant t on t.id=b.tenant_id and t.state='ACTIVE'
        join identity.principal s on s.id=b.service_principal_id and s.tenant_id=t.id
          and s.kind='SERVICE' and s.status='ACTIVE'
        join identity.service_principal sp on sp.principal_id=s.id
          and sp.component_binding_kind='APPLICATION' and sp.component_binding_id=b.id
        join catalog.component_release r on r.id=p.component_release_id and r.status='APPROVED'
        where b.id=$1 and p.model_projection=$3 and p.model_dispatch_started
          and ((b.state='ACTIVE' and p.state='ACTIVE' and b.active_projection_generation=p.generation
                and p.model_delivery_receipt is not null)
            or ($4 and b.state='PROVISIONING' and p.state='PENDING'))
          and (b.workspace_id is null or exists(select 1 from identity.workspace w
             where w.id=b.workspace_id and w.tenant_id=t.id and w.state='ACTIVE')))")
        .bind(binding).bind(input.generation).bind(projection).bind(discovery)
        .fetch_one(&state.pool).await?;
    if !live {
        return Err(denied());
    }
    let Some(config) = configuration(
        &current.model_call_mode,
        &current.config,
        &current.categories,
        &current.manifest,
    )?
    else {
        return Err(denied());
    };
    for (index, id) in config.routes.iter().enumerate() {
        let route: Route = sqlx::query_as(ROUTE)
            .bind(id)
            .bind(current.tenant_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(denied)?;
        if route.home_workspace_id.is_some() && route.home_workspace_id != current.workspace_id {
            return Err(denied());
        }
        let frozen = &projection["routes"][index];
        if frozen["resourceId"] != json!(id)
            || frozen["resourceVersion"] != route.resource_version
            || frozen["nativeRevision"] != route.native_revision
            || frozen["nativeConfigHash"] != route.native_config_hash
        {
            return Err(denied());
        }
        for permission in ["discover", "execute"] {
            let proof = state
                .governance
                .spicedb
                .check(
                    "resource",
                    &id.to_string(),
                    permission,
                    &service.to_string(),
                    Consistency::FullyConsistent,
                )
                .await
                .map_err(|_| unavailable())?;
            if !proof.allowed || proof.zed_token.is_empty() {
                return Err(denied());
            }
        }
    }
    let mut caller_attribution = None;
    let mut caller_evidence = Vec::new();
    let mut caller_audits = Vec::new();
    if !discovery {
        if input.method != "POST" {
            return Err(denied());
        }
        // Correlation is optional. When present it must resolve to a real live
        // action in this exact binding, never to caller-supplied scope/identity.
        if !input.traceparent.is_empty() {
            let trace = trace_id(&input.traceparent).ok_or_else(denied)?;
            let actions: Vec<Uuid> = sqlx::query_scalar(
                "select distinct a.id from admission.action_execution a
                join admission.external_execution e on e.action_execution_id=a.id
                join identity.principal actor on actor.id=a.actor_principal_id and actor.tenant_id=a.tenant_id
                left join catalog.agent_invocation i on i.id::text=a.parameters->>'invocationId'
                  and i.runtime_turn_id=a.parameters->>'runtimeTurnId'
                left join projection.agent_model_trace t on t.invocation_id=i.id and t.operation_id=a.operation_id
                where a.component_binding_id=$1 and a.component_projection_generation=$2
                  and a.tenant_id=$3 and ($4::uuid is null or a.workspace_id=$4)
                  and (t.trace_id=$5 or (actor.kind='HUMAN' and a.actor_principal_id=a.initiator_principal_id
                    and a.parameters->>'componentActionKind'='COMPONENT_ACTION'
                    and replace(a.operation_id::text,'-','')=$5))
                  and a.gate_state='ALLOWED' and a.dispatch_state='DISPATCHED'
                  and e.operation_id=a.operation_id and e.component_binding_id=a.component_binding_id
                  and e.component_projection_generation=a.component_projection_generation
                  and e.platform_status in ('PENDING_DISPATCH','RUNNING','UNKNOWN')",
            )
            .bind(binding)
            .bind(input.generation)
            .bind(current.tenant_id)
            .bind(current.workspace_id)
            .bind(trace)
            .fetch_all(&state.pool)
            .await?;
            if actions.is_empty() {
                return Err(denied());
            }
            for id in actions {
                let ae = crate::governance::load_execution(&state.pool, id)
                    .await?
                    .ok_or_else(denied)?;
                if human_traceparent(&ae).is_some_and(|parent| trace_id(&parent) != Some(trace)) {
                    return Err(denied());
                }
                if !crate::application_tool::fresh_execution(&state.governance, &ae)
                    .await?
                    .allowed
                {
                    return Err(denied());
                }
                let attribution = (ae.operation_id, ae.initiator_principal_id, ae.workspace_id);
                if caller_attribution.is_some_and(|previous| previous != attribution) {
                    return Err(denied());
                }
                caller_attribution = Some(attribution);
                caller_evidence.push(crate::audit::Evidence::new(
                    contracts::EvidenceKind::ActionExecutionId,
                    ae.id,
                ));
                let definition =
                    crate::governance::exact_definition_for_execution(&state.pool, &ae).await?;
                caller_audits.push((ae, definition));
            }
        }
        let customer = projection["customerId"].as_str().ok_or_else(unavailable)?;
        if !state
            .openmeter
            .check_quota(current.tenant_id, customer, &config.meters)
            .await
            .map_err(|_| unavailable())?
        {
            return Err(Refusal::Denied(ReasonCode::QuotaExhausted));
        }
    }
    crate::service_api::audit_gate(state)
        .await
        .map_err(|_| unavailable())?;
    let origin = crate::governance::load_execution(&state.pool, current.action_execution_id)
        .await?
        .ok_or_else(unavailable)?;
    let mut evidence = vec![crate::audit::Evidence::new(
        contracts::EvidenceKind::ActionExecutionId,
        origin.id,
    )];
    evidence.extend(caller_evidence);
    if caller_audits.is_empty() {
        let definition =
            crate::governance::exact_definition_for_execution(&state.pool, &origin).await?;
        caller_audits.push((origin, definition));
    }
    if let Some(trace) = trace_id(&input.traceparent) {
        evidence.push(crate::audit::Evidence::new(
            contracts::EvidenceKind::TraceId,
            trace,
        ));
    }
    let mut tx = state.pool.begin().await?;
    let admission_id = Uuid::new_v4();
    for (caller, definition) in caller_audits {
        crate::audit::append(
            &mut tx,
            crate::audit::AuditEntry {
                event_key: format!("application-model-admission:{admission_id}:{}", caller.id),
                tenant_id: Some(caller.tenant_id),
                workspace_id: caller.workspace_id,
                operation_id: caller.operation_id,
                event_type: "ACCESS",
                human_identity_id: None,
                initiator_principal_id: Some(caller.initiator_principal_id),
                actor_principal_id: Some(service),
                action_key: &caller.action_key,
                action_version: caller.action_version,
                component_type_key: &definition.component_type_key,
                target_type: Some(&definition.target_type),
                target_id: Some(caller.target_id),
                parameter_hash: &caller.parameter_hash,
                decision: "ALLOW",
                result_code: if discovery {
                    "MODEL_DISCOVERY_ADMITTED"
                } else {
                    "MODEL_CALL_ADMITTED"
                },
                result_exposure: "NONE",
                evidence_refs: evidence.clone(),
                correlation_id: caller.operation_id,
            },
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

fn trace_id(traceparent: &str) -> Option<&str> {
    let mut parts = traceparent.split('-');
    let (Some(version), Some(trace), Some(span), Some(flags), None) = (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) else {
        return None;
    };
    if version != "00"
        || trace.len() != 32
        || span.len() != 16
        || flags.len() != 2
        || ![trace, span, flags].into_iter().all(|s| {
            s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
        || trace.bytes().all(|b| b == b'0')
        || span.bytes().all(|b| b == b'0')
    {
        return None;
    }
    Some(trace)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_references_need_exact_release_category_and_nonempty_unique_sets() {
        let category = json!([{"category":"knowledge","version":1}]);
        let manifest = json!({"allowedModelCallModes":["NONE","PLATFORM_LLM_ROUTE"],
            "capabilityDeclarations":[{"categoryKey":"knowledge","contractVersion":1,"meter":"SUPPORTED"}]});
        let config = json!({"modelGateway":{"routeResourceIds":[Uuid::new_v4()],
            "meterKeys":["model_input_tokens"]}});
        assert!(configuration("PLATFORM_LLM_ROUTE", &config, &category, &manifest).is_ok());
        assert!(configuration("NONE", &config, &category, &manifest).is_err());
        assert!(configuration("SELF_MANAGED_MODEL", &config, &category, &manifest).is_err());
        let mut unsupported = manifest.clone();
        unsupported["capabilityDeclarations"][0]["meter"] = json!("UNSUPPORTED");
        assert!(configuration("PLATFORM_LLM_ROUTE", &config, &category, &unsupported).is_err());
        assert!(configuration("PLATFORM_LLM_ROUTE", &config, &json!([]), &manifest).is_err());
        for field in ["routeResourceIds", "meterKeys"] {
            let mut empty = config.clone();
            empty["modelGateway"][field] = json!([]);
            assert!(configuration("PLATFORM_LLM_ROUTE", &empty, &category, &manifest).is_err());
            let mut duplicate = config.clone();
            duplicate["modelGateway"][field] = json!([
                config["modelGateway"][field][0],
                config["modelGateway"][field][0]
            ]);
            assert!(configuration("PLATFORM_LLM_ROUTE", &duplicate, &category, &manifest).is_err());
        }
    }

    #[test]
    fn optional_correlation_never_accepts_unknown_trace_encoding() {
        let trace = Uuid::new_v4().simple().to_string();
        let parent = format!("00-{trace}-0123456789abcdef-01");
        assert_eq!(trace_id(&parent), Some(trace.as_str()));
        for bad in [
            "",
            "00-00000000000000000000000000000000-0123456789abcdef-01",
            "00-0123456789abcdef0123456789abcdef-0000000000000000-01",
            "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01-extra",
        ] {
            assert_eq!(trace_id(bad), None);
        }
    }

    #[tokio::test]
    #[ignore = "requires an isolated migrated APPLICATION_MODEL_TEST_DATABASE_URL with original base fixture"]
    async fn original_projection_refuses_unproved_model_activation_and_drain() {
        use sqlx::{Acquire, Connection};
        let mut conn = sqlx::PgConnection::connect(
            &std::env::var("APPLICATION_MODEL_TEST_DATABASE_URL").expect("isolated database URL"),
        )
        .await
        .unwrap();
        let mut tx = Connection::begin(&mut conn).await.unwrap();
        sqlx::raw_sql(include_str!(
            "../../../verify/application-execution-dispatch.sql"
        ))
        .execute(&mut *tx)
        .await
        .unwrap();
        // Constraint facts only, not a signed native report or real model call.
        // Reuse the original release, action and category fixtures without
        // changing their authority or disabling any production trigger.
        sqlx::raw_sql(r#"
DO $$
DECLARE source catalog.application_binding%ROWTYPE; binding uuid:=gen_random_uuid();
 service uuid:=gen_random_uuid(); ae uuid:=gen_random_uuid(); route uuid:=gen_random_uuid();
 model jsonb; receipt jsonb;
BEGIN
 SELECT b.* INTO STRICT source FROM catalog.application_binding b
 JOIN application_dispatch_fixture f ON f.binding=b.id;
 INSERT INTO identity.principal(id,tenant_id,kind,status)
 VALUES(service,source.tenant_id,'SERVICE','ACTIVE');
 INSERT INTO identity.service_principal(principal_id,audience)
 VALUES(service,'isolated-model-receiver');
 INSERT INTO admission.action_execution(id,operation_id,tenant_id,action_key,action_version,
   initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id)
 SELECT ae,ae,a.tenant_id,a.action_key,a.action_version,a.initiator_principal_id,a.actor_principal_id,
   binding,a.parameter_hash,'ALLOWED','DISPATCHED',ae FROM admission.action_execution a
 WHERE a.id=source.created_by_action_execution_id;
 INSERT INTO catalog.application_binding(id,tenant_id,component_type_key,component_release_id,service_principal_id,
   adapter_service_ref,native_instance_ref,isolation_mode,call_identity_mode,capability_categories,normalized_config,
   config_digest,secret_refs,model_call_mode,retain_on_tenant_delete,state,version,created_by_action_execution_id,projection_action_execution_id)
 VALUES(binding,source.tenant_id,source.component_type_key,source.component_release_id,service,
   source.adapter_service_ref,source.native_instance_ref,source.isolation_mode,source.call_identity_mode,
   source.capability_categories,source.normalized_config,source.config_digest,source.secret_refs,
   'PLATFORM_LLM_ROUTE',false,'PROVISIONING',1,ae,ae);
 UPDATE identity.service_principal SET component_binding_kind='APPLICATION',component_binding_id=binding
 WHERE principal_id=service;
 INSERT INTO projection.application_runtime(binding_id,generation,component_release_id,normalized_manifest_digest,
   adapter_contract_digest,state,action_execution_id)
 SELECT binding,1,p.component_release_id,p.normalized_manifest_digest,p.adapter_contract_digest,'PENDING',ae
 FROM projection.application_runtime p WHERE p.binding_id=source.id AND p.generation=1;
 model:=jsonb_build_object('gatewayPrincipalId',service,'operationId',ae,'tenantId',source.tenant_id,
   'workspaceId',NULL,'configDigest',source.config_digest,'meters',jsonb_build_array(jsonb_build_object('key','model_tokens')),
   'routeResourceIds',jsonb_build_array(route),'nativeScopeRef','42',
   'secretRef',jsonb_build_object('locator','isolated/kv/model','version',1,'audience','isolated-core'),
   'serviceSecretRef',jsonb_build_object('locator','isolated/kv/model','version',1,'audience','isolated-model-receiver'),
   'secretReader',jsonb_build_object('servicePrincipalId',service,'audience','isolated-model-receiver','roleName','isolated-reader'),
   'deliveryChallenges',jsonb_build_array(jsonb_build_object('routeResourceId',route,'verificationNonce',repeat('b',64))));
 receipt:=jsonb_build_array(jsonb_build_object('bindingId',binding,'generation',1,'configDigest',source.config_digest,
   'servicePrincipalId',service,'nativeScopeRef','42','routeResourceId',route,'nativeModelRef',gen_random_uuid(),
   'secretRef',model->'serviceSecretRef','requestId',gen_random_uuid(),
   'verificationNonce',repeat('b',64),'nativeProof',repeat('c',64)));
 UPDATE projection.application_runtime SET model_projection=model,model_state='PENDING' WHERE binding_id=binding;
 BEGIN
   UPDATE projection.application_runtime SET model_state='ACTIVE' WHERE binding_id=binding;
   RAISE EXCEPTION 'model activated without durable dispatch and native key';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   UPDATE projection.application_runtime SET model_projection=jsonb_set(model,'{gatewayPrincipalId}',to_jsonb(gen_random_uuid()))
   WHERE binding_id=binding;
   RAISE EXCEPTION 'model projection changed binding identity';
 EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE projection.application_runtime SET model_dispatch_started=true,model_native_key_id='isolated-native-key',
   model_native_key_revision=1 WHERE binding_id=binding;
 BEGIN
   UPDATE projection.application_runtime SET model_state='ACTIVE' WHERE binding_id=binding;
   RAISE EXCEPTION 'native key alone activated without service delivery';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   UPDATE projection.application_runtime SET model_delivery_receipt=jsonb_set(receipt,'{0,verificationNonce}',to_jsonb(repeat('d',64))),
     model_state='ACTIVE' WHERE binding_id=binding;
   RAISE EXCEPTION 'stale challenge activated model';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   UPDATE projection.application_runtime SET model_delivery_receipt=jsonb_set(receipt,'{0,secretRef,audience}','"isolated-core"'),
     model_state='ACTIVE' WHERE binding_id=binding;
   RAISE EXCEPTION 'Core reader was accepted as native service delivery';
 EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE projection.application_runtime SET model_delivery_receipt=receipt,model_state='ACTIVE' WHERE binding_id=binding;
 BEGIN
   UPDATE projection.application_runtime SET model_delivery_receipt=NULL WHERE binding_id=binding;
   RAISE EXCEPTION 'verified delivery receipt erased';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   UPDATE projection.application_runtime SET model_dispatch_started=false WHERE binding_id=binding;
   RAISE EXCEPTION 'model dispatch intent became replayable';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   UPDATE projection.application_runtime SET model_state='REVOKED',
     model_usage_receipt=jsonb_build_object('generation',1,'dispatchStarted',false) WHERE binding_id=binding;
   RAISE EXCEPTION 'dispatched model closed without native request-set proof';
 EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE projection.application_runtime SET model_state='REVOKED',model_usage_receipt=jsonb_build_object(
   'generation',1,'credentialRevoked',true,'gatewayPrincipalId',service,'requestSetDigest',repeat('a',64),
   'submittedRequests',0) WHERE binding_id=binding;
 BEGIN
   UPDATE projection.application_runtime SET model_usage_receipt=jsonb_set(model_usage_receipt,'{submittedRequests}','1')
   WHERE binding_id=binding;
   RAISE EXCEPTION 'native model closure receipt mutated';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
"#).execute(&mut *tx).await.unwrap();
        let mut down = tx.begin().await.unwrap();
        let refused = sqlx::raw_sql(include_str!(
            "../../../migrations/20261005021000_application_model_route.down.sql"
        ))
        .execute(&mut *down)
        .await
        .expect_err("rollback must retain native model facts");
        assert_eq!(
            refused
                .as_database_error()
                .and_then(|e| e.code())
                .as_deref(),
            Some("23514")
        );
        down.rollback().await.unwrap();
        tx.rollback().await.unwrap();
    }
}
