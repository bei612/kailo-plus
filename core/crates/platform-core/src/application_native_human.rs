//! Native component SERVICE transport plus independently verified HUMAN identity.
//! Platform Actions retain the original admission/execution authority. Native
//! metadata CRUD checks the binding's existing public scope permissions.
use super::*;
use crate::service_api::ServiceState;
use axum::{
    extract::State,
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};

#[derive(sqlx::FromRow, PartialEq)]
struct Binding {
    tenant_id: Uuid,
    workspace_id: Option<Uuid>,
    generation: i64,
    config_digest: String,
    client_id: String,
    adapter_service_ref: String,
    native_instance_ref: String,
    native_scope_ref: String,
    manifest: Value,
}

async fn binding(state: &ServiceState, id: Uuid) -> Result<Binding, Refusal> {
    sqlx::query_as("select b.tenant_id,b.workspace_id,b.active_projection_generation as generation,b.config_digest,
        b.normalized_config->>'client_id' as client_id,b.adapter_service_ref,b.native_instance_ref,b.native_scope_ref,r.manifest
        from catalog.application_binding b join catalog.component_release r on r.id=b.component_release_id
        join identity.tenant t on t.id=b.tenant_id and t.state='ACTIVE'
        join identity.service_principal s on s.principal_id=b.service_principal_id
          and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
        join identity.principal p on p.id=s.principal_id and p.tenant_id=b.tenant_id and p.kind='SERVICE' and p.status='ACTIVE'
        join projection.application_runtime runtime on runtime.binding_id=b.id
          and runtime.generation=b.active_projection_generation and runtime.component_release_id=r.id
          and runtime.normalized_manifest_digest=r.manifest_digest and runtime.state='ACTIVE'
        where b.id=$1 and b.state='ACTIVE' and b.active_projection_generation>0
          and r.status='APPROVED' and r.approved_by_action_execution_id is not null
          and r.manifest->'executionConnector'->>'mode'='REMOTE_ADAPTER'")
        .bind(id).fetch_optional(&state.pool).await?.ok_or_else(blocked)
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str, Refusal> {
    let mut values = headers.get_all(name).iter();
    let value = values
        .next()
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.is_empty())
        .ok_or_else(denied)?;
    if values.next().is_some() {
        return Err(denied());
    }
    Ok(value)
}

fn verified_subject(
    token: &str,
    issuer: &str,
    trust: &Value,
    keys: &JwkSet,
) -> Result<String, Refusal> {
    let audience = trust["audience"]
        .as_str()
        .filter(|v| !v.is_empty())
        .ok_or_else(blocked)?;
    let kid = decode_header(token)
        .map_err(|_| denied())?
        .kid
        .ok_or_else(denied)?;
    let key = keys.find(&kid).ok_or_else(denied)?;
    let alg = match key
        .common
        .key_algorithm
        .and_then(|a| a.to_string().parse().ok())
    {
        Some(
            a @ (Algorithm::RS256
            | Algorithm::RS384
            | Algorithm::RS512
            | Algorithm::ES256
            | Algorithm::ES384
            | Algorithm::EdDSA),
        ) => a,
        _ => return Err(denied()),
    };
    let mut validation = Validation::new(alg);
    validation.set_issuer(&[issuer]);
    validation.set_audience(&[audience]);
    validation.set_required_spec_claims(&["iss", "sub", "aud", "exp"]);
    validation.leeway = 0;
    validation.validate_nbf = true;
    let claims = decode::<Value>(
        token,
        &DecodingKey::from_jwk(key).map_err(|_| denied())?,
        &validation,
    )
    .map_err(|_| denied())?
    .claims;
    // The IdP authenticates a HUMAN; it is not a second instance-permission
    // authority. The caller still resolves this subject through the binding's
    // ACTIVE membership and performs its existing fresh scope/resource check.
    if claims.get("azp").is_some_and(|v| v != audience) {
        return Err(denied());
    }
    claims["sub"]
        .as_str()
        .filter(|v| !v.is_empty() && v.trim() == *v)
        .map(str::to_owned)
        .ok_or_else(denied)
}

async fn human(
    state: &ServiceState,
    current: &Binding,
    id: Uuid,
    token: &str,
) -> Result<Actor, Refusal> {
    let adapter = crate::application_binding::native::Adapter::resolve(
        &current.adapter_service_ref,
        &current.native_instance_ref,
        &current.manifest,
    )?;
    let trust = adapter.native_human_identity(id, current.generation, &current.config_digest)?;
    let provider = super::id(&trust["identityProviderId"])?;
    let issuer: String = sqlx::query_scalar(
        "select issuer from identity.identity_provider where id=$1 and status='ACTIVE'",
    )
    .bind(provider)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(denied)?;
    let path = trust["jwksFile"]
        .as_str()
        .filter(|v| std::path::Path::new(v).is_absolute())
        .ok_or_else(blocked)?;
    // Operator-controlled, binding-fenced public-key delivery, never a URL from the token/request.
    let document: Value =
        serde_json::from_slice(&tokio::fs::read(path).await.map_err(|_| unavailable())?)
            .map_err(|_| blocked())?;
    let list = document["keys"]
        .as_array()
        .filter(|v| !v.is_empty())
        .ok_or_else(blocked)?;
    let mut ids = std::collections::BTreeSet::new();
    if list.iter().any(|key| {
        key.get("d").is_some()
            || key.get("k").is_some()
            || key["kid"]
                .as_str()
                .is_none_or(|id| id.is_empty() || !ids.insert(id))
    }) {
        return Err(blocked());
    }
    let keys: JwkSet = serde_json::from_value(document).map_err(|_| blocked())?;
    let subject = verified_subject(token, &issuer, &trust, &keys)?;
    let mut conn = state.pool.acquire().await?;
    mapped_actor(&mut conn, current.tenant_id, provider, &issuer, &subject).await
}

// The binding selects the tenant, not a browser header or the default-tenant resolver.
async fn mapped_actor(
    conn: &mut PgConnection,
    tenant: Uuid,
    provider: Uuid,
    issuer: &str,
    subject: &str,
) -> Result<Actor, Refusal> {
    let rows: Vec<(Uuid, Uuid)> = sqlx::query_as("select h.id,p.id
        from identity.external_identity e join identity.identity_provider provider on provider.id=e.provider_id and provider.status='ACTIVE'
        join identity.human_identity h on h.id=e.human_identity_id and h.status='ACTIVE'
        join identity.tenant_membership m on m.human_identity_id=h.id and m.state='ACTIVE' and m.tenant_id=$1
        join identity.tenant t on t.id=m.tenant_id and t.state='ACTIVE'
        join identity.principal p on p.id=m.tenant_principal_id and p.tenant_id=m.tenant_id and p.kind='HUMAN' and p.status='ACTIVE'
        where e.provider_id=$2 and e.issuer=$3 and e.subject=$4 and e.status='ACTIVE'")
        .bind(tenant).bind(provider).bind(issuer).bind(subject).fetch_all(conn).await?;
    let [(human, principal)] = rows.as_slice() else {
        return Err(denied());
    };
    Ok(Actor {
        tenant_id: tenant,
        principal_id: *principal,
        human_identity_id: Some(*human),
    })
}

fn request_binding(raw: &Value) -> Result<Uuid, Refusal> {
    let typed: contracts::NativeHumanActionRequest =
        serde_json::from_value(raw.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(typed).map_err(|_| invalid())? != *raw {
        return Err(invalid());
    }
    // The generated shape preserves legacy optional fields; the existing wire
    // contract's exclusive operations are enforced before any authority call.
    if [
        "command",
        "idempotencyKey",
        "resolveResource",
        "authorizeScope",
        "readReceipt",
    ]
    .iter()
    .filter(|key| raw.get(**key).is_some())
    .count()
        != 1
        || (raw.get("sourceResources").is_some() && raw.get("idempotencyKey").is_none())
    {
        return Err(invalid());
    }
    super::id(&raw["bindingId"])
}

pub(crate) async fn handle(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let result = async {
        let Json(raw) = body.map_err(|_| invalid())?;
        let id = request_binding(&raw)?;
        if let Some(receipt) = raw.get("readReceipt") {
            return native_read::record(&state, &headers, id, receipt).await.map(Some);
        }
        let before = binding(&state,id).await?;
        let count: i64 = sqlx::query_scalar("select count(*) from catalog.application_binding where normalized_config->>'client_id'=$1 and state<>'DISABLED'")
            .bind(&before.client_id).fetch_one(&state.pool).await?;
        if count != 1 { return Err(denied()); }
        state.auth.verify_binding_client(Some(header(&headers,"authorization")?), &before.client_id).await
            .map_err(|error| match error { crate::service_auth::ServiceAuthError::KeysUnavailable => unavailable(), _=>denied() })?;
        let token = header(&headers,"x-kailo-native-human-token")?;
        let actor = human(&state,&before,id,token).await?;
        if binding(&state,id).await? != before { return Err(denied()); }
        if let Some(query) = raw.get("authorizeScope") {
            let mut conn = state.pool.acquire().await?;
            let scope = authorize_scope(&mut conn,&state.governance.spicedb,actor,id,&before,query).await?;
            drop(conn);
            let after_actor = human(&state,&before,id,token).await?;
            if binding(&state,id).await? != before || after_actor.principal_id != actor.principal_id
                || after_actor.human_identity_id != actor.human_identity_id { return Err(denied()); }
            return Ok(Some(serde_json::to_value(scope).map_err(|_| unavailable())?));
        }
        if let Some(query) = raw.get("resolveResource") {
            let resource = resolve_resource(&state,actor,id,&before,query).await?;
            let after_actor = human(&state,&before,id,token).await?;
            if binding(&state,id).await? != before || after_actor.principal_id != actor.principal_id
                || after_actor.human_identity_id != actor.human_identity_id { return Err(denied()); }
            return Ok(Some(serde_json::to_value(resource).map_err(|_| unavailable())?));
        }
        let key = match (raw.get("command"),raw.get("idempotencyKey")) {
            (Some(command),None) => {
                let command: ActionCommand = serde_json::from_value(command.clone()).map_err(|_| invalid())?;
                let parsed = normalized(&command)?;
                // Fence the exact existing idempotency key before the original replay path can start it.
                check_existing_binding(&state,actor,parsed.key,id,before.generation).await?;
                submit_inner(&state.governance,actor,&command,Some((id,before.generation)),Some(&state)).await?;
                parsed.key
            },
            (None,Some(key))=>super::id(key)?,
            _=>return Err(invalid()),
        };
        let Some(action) = check_existing_binding(&state,actor,key,id,before.generation).await? else {
            return Ok(None);
        };
        let mut ae = crate::governance::load_execution(&state.pool,action).await?.ok_or_else(unavailable)?;
        if !is_human(&ae) { return Err(denied()); }
        if ae.gate_state == "DENIED" && raw.get("sourceResources").is_some() { return Err(denied()); }
        if ae.gate_state != "DENIED" && !crate::application_tool::fresh_execution_with_sources(&state.governance,&ae,raw.get("sourceResources")).await?.allowed { return Err(denied()); }
        let mut output = json!({"submission":ae.submission(),"inputReference":ae.parameters.as_ref().ok_or_else(unavailable)?["inputArguments"]["input"]});
        if raw.get("command").is_some() && native_read::is_read(&ae) {
            if let Some(admission) = native_read::admit(&state, &ae, key).await? {
                output["readAdmission"] = admission;
                ae = crate::governance::load_execution(&state.pool,action).await?.ok_or_else(unavailable)?;
                output["submission"] = serde_json::to_value(ae.submission()).map_err(|_| unavailable())?;
            }
        }
        let terminal: Option<String> = sqlx::query_scalar("select result_code from audit.audit_event where event_key=$1 and tenant_id=$2 and operation_id=$3 and action_key=$4")
            .bind(format!("{}:component_action:terminal",ae.operation_id)).bind(ae.tenant_id).bind(ae.operation_id).bind(&ae.action_key)
            .fetch_optional(&state.pool).await?;
        if let Some(status) = terminal {
            if !matches!(status.as_str(),"COMPLETED"|"FAILED"|"CANCELED") { return Err(unavailable()); }
            output["terminalStatus"] = json!(status);
            if status == "COMPLETED" && !native_read::is_read(&ae) {
                let native: Option<(String,String)> = sqlx::query_as("select native_type,native_id from admission.external_execution where action_execution_id=$1 and operation_id=$2 and component_binding_id=$3 and platform_status='SUCCEEDED' and terminal_at is not null")
                    .bind(ae.id).bind(ae.operation_id).bind(id).fetch_optional(&state.pool).await?;
                let (kind,reference) = native.ok_or_else(unavailable)?;
                output["nativeType"] = json!(kind); output["nativeId"] = json!(reference);
            }
        }
        // Revocation/config switches cannot authorize disclosure under a stale snapshot.
        let after_actor = human(&state,&before,id,token).await?;
        if binding(&state,id).await? != before || after_actor.principal_id != actor.principal_id
            || after_actor.human_identity_id != actor.human_identity_id { return Err(denied()); }
        let response: contracts::NativeHumanActionResult=serde_json::from_value(output).map_err(|_| unavailable())?;
        Ok(Some(serde_json::to_value(response).map_err(|_| unavailable())?))
    }.await;
    match result {
        Ok(Some(value)) => ([("cache-control", "no-store")], Json(value)).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, [("cache-control", "no-store")]).into_response(),
        Err(error) => error.respond(None),
    }
}

#[derive(sqlx::FromRow, PartialEq)]
struct ScopeFacts {
    tenant_version: i32,
    membership_version: i32,
    workspace_version: Option<i32>,
    workspace_membership_state: Option<String>,
    workspace_membership_version: Option<i32>,
}

async fn scope_facts(
    conn: &mut PgConnection,
    actor: Actor,
    current: &Binding,
) -> Result<ScopeFacts, Refusal> {
    // Read the original identity facts, including a revoked membership. A stale
    // workspace#admin tuple cannot erase that revocation (DD-41/45/46/82).
    sqlx::query_as("select t.version as tenant_version,tm.version as membership_version,
        w.version as workspace_version,wm.state as workspace_membership_state,wm.version as workspace_membership_version
        from identity.tenant t join identity.tenant_membership tm on tm.tenant_id=t.id and tm.state='ACTIVE'
        join identity.principal p on p.id=tm.tenant_principal_id and p.tenant_id=t.id and p.kind='HUMAN' and p.status='ACTIVE'
        join identity.human_identity h on h.id=tm.human_identity_id and h.status='ACTIVE'
        left join identity.workspace w on w.id=$3 and w.tenant_id=t.id and w.state='ACTIVE'
        left join identity.workspace_membership wm on wm.workspace_id=w.id and wm.tenant_principal_id=p.id
        where t.id=$1 and t.state='ACTIVE' and p.id=$2 and ($3::uuid is null or w.id is not null) and h.id=$4")
        .bind(current.tenant_id).bind(actor.principal_id).bind(current.workspace_id).bind(actor.human_identity_id)
        .fetch_optional(conn).await?.ok_or_else(denied)
}

async fn scope_check(
    spicedb: &crate::spicedb::SpiceDb,
    actor: Actor,
    object_type: &str,
    object: Uuid,
    permission: &str,
) -> Result<crate::spicedb::Checked, Refusal> {
    let checked = spicedb
        .check(
            object_type,
            &object.to_string(),
            permission,
            &actor.principal_id.to_string(),
            crate::spicedb::Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| unavailable())?;
    if checked.zed_token.is_empty() {
        return Err(unavailable());
    }
    Ok(checked)
}

async fn authorize_scope(
    conn: &mut PgConnection,
    spicedb: &crate::spicedb::SpiceDb,
    actor: Actor,
    binding_id: Uuid,
    current: &Binding,
    query: &Value,
) -> Result<contracts::NativeHumanScopeResult, Refusal> {
    let permission = query["permission"]
        .as_str()
        .filter(|p| matches!(*p, "discover" | "manage"))
        .ok_or_else(invalid)?;
    if actor.tenant_id != current.tenant_id
        || actor.human_identity_id.is_none()
        || [&current.native_instance_ref, &current.native_scope_ref]
            .iter()
            .any(|v| v.is_empty() || v.trim() != v.as_str())
    {
        return Err(denied());
    }
    let before = scope_facts(conn, actor, current).await?;
    if let Some(workspace) = current.workspace_id {
        if before.workspace_membership_state.as_deref() != Some("ACTIVE") {
            let management = scope_check(spicedb, actor, "workspace", workspace, "manage").await?;
            if !management.allowed {
                return Err(denied());
            }
            // Never-joined admins are allowed by DD-82. Previously joined but
            // no longer ACTIVE requires fresh tenant manage, not stale WS admin.
            if before.workspace_membership_state.is_some()
                && !scope_check(spicedb, actor, "tenant", current.tenant_id, "manage")
                    .await?
                    .allowed
            {
                return Err(denied());
            }
        }
    }
    let (kind, object) = current
        .workspace_id
        .map(|id| ("workspace", id))
        .unwrap_or(("tenant", current.tenant_id));
    let checked = scope_check(spicedb, actor, kind, object, permission).await?;
    if !checked.allowed {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    if scope_facts(conn, actor, current).await? != before {
        return Err(denied());
    }
    let mut scope = json!({"bindingId":binding_id,"generation":current.generation,"tenantId":current.tenant_id,
        "nativeInstanceRef":current.native_instance_ref,"nativeScopeRef":current.native_scope_ref,
        "permission":permission,"checkedRevision":checked.zed_token});
    if let Some(workspace) = current.workspace_id {
        scope["workspaceId"] = json!(workspace);
    }
    serde_json::from_value(json!({"scope":scope})).map_err(|_| unavailable())
}

async fn resource_facts(
    conn: &mut PgConnection,
    actor: Actor,
    binding_id: Uuid,
    current: &Binding,
    query: &Value,
) -> Result<(Target, crate::application_catalog::ApplicationDefinition), Refusal> {
    let text = |field: &str| {
        query[field]
            .as_str()
            .filter(|value| !value.is_empty() && value.trim() == *value)
            .ok_or_else(invalid)
    };
    let kind = text("nativeType")?;
    let reference = text("nativeRef")?;
    let action = text("actionKey")?;
    let version = query["actionVersion"]
        .as_i64()
        .and_then(|v| i32::try_from(v).ok())
        .filter(|v| *v > 0)
        .ok_or_else(invalid)?;
    let workspace = query.get("workspaceId").map(super::id).transpose()?;
    // Two rows are enough to prove ambiguity; never select a first match or
    // construct a new owner/mapping for an unregistered native object.
    let rows: Vec<(Uuid,i32)> = sqlx::query_as("select r.id,r.version from catalog.resource r
        join catalog.application_binding b on b.id=r.application_binding_id and b.tenant_id=r.tenant_id
        join projection.application_runtime p on p.binding_id=b.id and p.generation=b.active_projection_generation
          and p.component_release_id=b.component_release_id and p.state='ACTIVE'
        where r.tenant_id=$1 and r.application_binding_id=$2 and r.native_type=$3 and r.native_id=$4
          and r.state='ACTIVE' and r.projection_action_execution_id is null and b.state='ACTIVE'
          and b.active_projection_generation=$5 and b.native_instance_ref=$6 and b.native_scope_ref=$7
          and (r.home_workspace_id is null or r.home_workspace_id=$8)
          and (b.workspace_id is null or b.workspace_id=$8)
          and ($8::uuid is null or exists(select 1 from identity.workspace w
            where w.id=$8 and w.tenant_id=r.tenant_id and w.state='ACTIVE'))
        order by r.id limit 2 for share of r,b,p")
        .bind(actor.tenant_id).bind(binding_id).bind(kind).bind(reference).bind(current.generation)
        .bind(&current.native_instance_ref).bind(&current.native_scope_ref).bind(workspace)
        .fetch_all(&mut *conn).await?;
    let [(resource, resource_version)] = rows.as_slice() else {
        return Err(denied());
    };
    let target = Target {
        id: *resource,
        version: *resource_version,
        workspace_id: workspace,
    };
    // Selecting an authorized reference is not dispatch. In particular native
    // metadata uses its registered read action, not a fabricated Temporal task.
    // Submit and execution revalidation retain the original facts() gate.
    let (binding, generation, application) = crate::application_catalog::definition_for_resource(
        conn,
        actor.tenant_id,
        workspace,
        target.id,
        action,
        version,
    )
    .await?;
    if binding != binding_id
        || generation != current.generation
        || application.definition.target_type != "RESOURCE"
    {
        return Err(denied());
    }
    Ok((target, application))
}

async fn resolve_resource(
    state: &ServiceState,
    actor: Actor,
    binding_id: Uuid,
    current: &Binding,
    query: &Value,
) -> Result<contracts::NativeHumanResourceResult, Refusal> {
    let mut tx = state.pool.begin().await?;
    let (target, application) = resource_facts(&mut tx, actor, binding_id, current, query).await?;
    let evaluation = state
        .governance
        .evaluate(actor, &application.definition, &target)
        .await?;
    if !evaluation.allowed {
        return Err(Refusal::Denied(
            evaluation.reason.unwrap_or(ReasonCode::PermissionDenied),
        ));
    }
    if [&current.native_instance_ref, &current.native_scope_ref]
        .iter()
        .any(|v| v.is_empty() || v.trim() != v.as_str())
    {
        return Err(blocked());
    }
    let result = serde_json::from_value(json!({"resource":{"resourceId":target.id,"resourceVersion":target.version,
        "nativeType":query["nativeType"],"nativeRef":query["nativeRef"],"nativeInstanceRef":current.native_instance_ref,
        "nativeScopeRef":current.native_scope_ref}})).map_err(|_| unavailable())?;
    tx.commit().await?;
    Ok(result)
}

async fn check_existing_binding(
    state: &ServiceState,
    actor: Actor,
    key: Uuid,
    binding: Uuid,
    generation: i64,
) -> Result<Option<Uuid>, Refusal> {
    let foreign: bool = sqlx::query_scalar("select exists(select 1 from admission.action_execution where component_binding_id=$1 and idempotency_key=$2 and initiator_principal_id<>$3)")
        .bind(binding).bind(key).bind(actor.principal_id).fetch_one(&state.pool).await?;
    if foreign {
        return Err(denied());
    }
    let row: Option<(Uuid,Option<Uuid>,Option<i64>)> = sqlx::query_as("select id,component_binding_id,component_projection_generation from admission.action_execution where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3")
        .bind(actor.tenant_id).bind(actor.principal_id).bind(key).fetch_optional(&state.pool).await?;
    match row {
        None => Ok(None),
        Some((id, Some(actual), Some(epoch))) if actual == binding && epoch == generation => {
            Ok(Some(id))
        }
        _ => Err(denied()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use ring::signature::KeyPair;

    #[test]
    fn native_human_request_keeps_legacy_choices_and_rejects_scope_selection_or_combination() {
        let sample: Value = serde_json::from_str(include_str!(
            "../../../../contracts/samples/native-human-action.sample.json"
        ))
        .unwrap();
        for key in ["request", "resourceRequest", "scopeRequest"] {
            assert!(request_binding(&sample[key]).is_ok(), "{key}");
        }
        for permission in ["query", "read", "unknown"] {
            let mut raw = sample["scopeRequest"].clone();
            raw["authorizeScope"]["permission"] = json!(permission);
            assert!(request_binding(&raw).is_err(), "{permission}");
        }
        for field in ["tenantId", "workspaceId", "nativeScopeRef"] {
            let mut raw = sample["scopeRequest"].clone();
            raw["authorizeScope"][field] = json!(Uuid::new_v4());
            assert!(request_binding(&raw).is_err(), "client selected {field}");
        }
        for field in ["idempotencyKey", "resolveResource", "sourceResources"] {
            let mut raw = sample["scopeRequest"].clone();
            raw[field] = match field {
                "idempotencyKey" => sample["request"][field].clone(),
                "resolveResource" => sample["resourceRequest"][field].clone(),
                _ => json!([{"nativeType":"model","nativeRef":"fixture-model"}]),
            };
            assert!(request_binding(&raw).is_err(), "combined {field}");
        }
        let mut legacy = sample["request"].clone();
        legacy["sourceResources"] = json!([{"nativeType":"model","nativeRef":"fixture-model"}]);
        assert!(request_binding(&legacy).is_ok());
        assert!(
            request_binding(&json!({"bindingId":sample["scopeRequest"]["bindingId"]})).is_err()
        );
    }

    #[tokio::test]
    #[ignore = "requires migrated isolated database"]
    async fn native_resource_selection_uses_exact_registered_scope_and_original_action_facts() {
        use sqlx::Connection;
        let mut conn = PgConnection::connect(
            &std::env::var("APPLICATION_EXECUTION_TEST_DATABASE_URL")
                .expect("isolated database URL"),
        )
        .await
        .unwrap();
        let mut tx = conn.begin().await.unwrap();
        let base = include_str!("../../../verify/application-execution-base.sql")
            .replace("\nBEGIN;\n", "\n")
            .replace("\nCOMMIT;\n", "\n");
        sqlx::raw_sql(&base).execute(&mut *tx).await.unwrap();
        let fixture=include_str!("../../../verify/application-execution-dispatch.sql")
            .replace("manifest:=jsonb_build_object('componentTypeKey',provider,", "manifest:=jsonb_build_object('executionConnector',jsonb_build_object('mode','REMOTE_ADAPTER'),'componentTypeKey',provider,");
        sqlx::raw_sql(&fixture).execute(&mut *tx).await.unwrap();
        let (action, binding_id): (Uuid, Uuid) =
            sqlx::query_as("select child,binding from application_dispatch_fixture")
                .fetch_one(&mut *tx)
                .await
                .unwrap();
        let (tenant,principal,resource):(Uuid,Uuid,Uuid)=sqlx::query_as("select tenant_id,initiator_principal_id,target_id from admission.action_execution where id=$1")
            .bind(action).fetch_one(&mut *tx).await.unwrap();
        let mut current:Binding=sqlx::query_as("select b.tenant_id,b.workspace_id,b.active_projection_generation as generation,b.config_digest,
            coalesce(b.normalized_config->>'client_id','isolated-fixture-client') as client_id,b.adapter_service_ref,b.native_instance_ref,b.native_scope_ref,r.manifest
            from catalog.application_binding b join catalog.component_release r on r.id=b.component_release_id where b.id=$1")
            .bind(binding_id).fetch_one(&mut *tx).await.unwrap();
        let (kind, reference): (String, String) =
            sqlx::query_as("select native_type,native_id from catalog.resource where id=$1")
                .bind(resource)
                .fetch_one(&mut *tx)
                .await
                .unwrap();
        let actor = Actor {
            tenant_id: tenant,
            principal_id: principal,
            human_identity_id: None,
        };
        let query = json!({"actionKey":"isolated.lookup@v1","actionVersion":1,"nativeType":kind,"nativeRef":reference});
        let found = resource_facts(&mut tx, actor, binding_id, &current, &query)
            .await
            .unwrap();
        assert_eq!(found.0.id, resource);
        assert_eq!(found.0.version, 2);
        assert_eq!(found.1.definition.permission, "read");
        assert_eq!(found.1.definition.execution_mode, "PROTOCOL");
        assert!(
            facts(
                &mut tx,
                tenant,
                &found.0,
                "isolated.lookup@v1",
                1,
                "RESOURCE"
            )
            .await
            .is_err(),
            "read selection must not enable Temporal dispatch"
        );
        for field in ["nativeType", "nativeRef", "actionKey"] {
            let mut changed = query.clone();
            changed[field] = json!("unregistered-native-object");
            assert!(
                resource_facts(&mut tx, actor, binding_id, &current, &changed)
                    .await
                    .is_err(),
                "{field}"
            );
        }
        let mut wrong_workspace = query.clone();
        wrong_workspace["workspaceId"] = json!(Uuid::new_v4());
        assert!(
            resource_facts(&mut tx, actor, binding_id, &current, &wrong_workspace)
                .await
                .is_err()
        );
        assert!(resource_facts(
            &mut tx,
            Actor {
                tenant_id: Uuid::new_v4(),
                ..actor
            },
            binding_id,
            &current,
            &query
        )
        .await
        .is_err());
        assert!(
            resource_facts(&mut tx, actor, Uuid::new_v4(), &current, &query)
                .await
                .is_err()
        );
        current.generation += 1;
        assert!(resource_facts(&mut tx, actor, binding_id, &current, &query)
            .await
            .is_err());
        current.generation -= 1;
        current.native_scope_ref.push_str("-changed");
        assert!(resource_facts(&mut tx, actor, binding_id, &current, &query)
            .await
            .is_err());
        tx.rollback().await.unwrap();
    }

    #[tokio::test]
    #[ignore = "requires the existing migrated isolated test database"]
    async fn native_human_mapping_uses_binding_tenant_and_current_identity_chain() {
        use sqlx::Connection;
        let mut conn = sqlx::PgConnection::connect(
            &std::env::var("AGENT_INVOKE_TEST_DATABASE_URL").expect("isolated database URL"),
        )
        .await
        .unwrap();
        let mut tx = conn.begin().await.unwrap();
        let provider = Uuid::new_v4();
        let human = Uuid::new_v4();
        let tenant = Uuid::new_v4();
        let foreign = Uuid::new_v4();
        let principal = Uuid::new_v4();
        let foreign_principal = Uuid::new_v4();
        let issuer = format!("urn:fixture:{provider}");
        let subject = Uuid::new_v4().to_string();
        sqlx::query("insert into identity.identity_provider(id,issuer,client_id,claim_mapping_version,status) values($1,$2,'fixture-native',1,'ACTIVE')").bind(provider).bind(&issuer).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into identity.human_identity(id,display_name,status) values($1,'isolated native human','ACTIVE')").bind(human).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into identity.external_identity(id,provider_id,issuer,subject,human_identity_id,status) values($1,$2,$3,$4,$5,'ACTIVE')").bind(Uuid::new_v4()).bind(provider).bind(&issuer).bind(&subject).bind(human).execute(&mut *tx).await.unwrap();
        for (tenant, principal) in [(tenant, principal), (foreign, foreign_principal)] {
            sqlx::query("insert into identity.tenant(id,slug,name,state) values($1,$2,'isolated native tenant','ACTIVE')").bind(tenant).bind(tenant.to_string()).execute(&mut *tx).await.unwrap();
            sqlx::query("insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'HUMAN','ACTIVE')").bind(principal).bind(tenant).execute(&mut *tx).await.unwrap();
            sqlx::query("insert into identity.tenant_membership(id,tenant_id,human_identity_id,tenant_principal_id,state) values($1,$2,$3,$4,'ACTIVE')").bind(Uuid::new_v4()).bind(tenant).bind(human).bind(principal).execute(&mut *tx).await.unwrap();
        }
        assert_eq!(
            mapped_actor(&mut tx, tenant, provider, &issuer, &subject)
                .await
                .unwrap()
                .principal_id,
            principal
        );
        assert_eq!(
            mapped_actor(&mut tx, foreign, provider, &issuer, &subject)
                .await
                .unwrap()
                .principal_id,
            foreign_principal
        );
        assert!(
            mapped_actor(&mut tx, Uuid::new_v4(), provider, &issuer, &subject)
                .await
                .is_err()
        );
        assert!(
            mapped_actor(&mut tx, tenant, Uuid::new_v4(), &issuer, &subject)
                .await
                .is_err()
        );
        assert!(
            mapped_actor(&mut tx, tenant, provider, &issuer, "unknown-subject")
                .await
                .is_err()
        );
        // Native project/dashboard CRUD uses the binding's original scope and
        // fresh public permissions, not an instance claim or a query Action.
        let workspace = Uuid::new_v4();
        sqlx::query("insert into identity.workspace(id,tenant_id,slug,name,state) values($1,$2,$3,'isolated native workspace','ACTIVE')")
            .bind(workspace).bind(tenant).bind(workspace.to_string()).execute(&mut *tx).await.unwrap();
        let current = Binding {
            tenant_id: tenant,
            workspace_id: Some(workspace),
            generation: 7,
            config_digest: "isolated-native-config".into(),
            client_id: "isolated-native-client".into(),
            adapter_service_ref: "isolated-native-adapter".into(),
            native_instance_ref: "isolated-native-instance".into(),
            native_scope_ref: "isolated-native-project".into(),
            manifest: json!({}),
        };
        let actor = mapped_actor(&mut tx, tenant, provider, &issuer, &subject)
            .await
            .unwrap();
        let observed = std::sync::Arc::new((
            std::sync::atomic::AtomicUsize::new(0),
            std::sync::Mutex::new(Vec::<Value>::new()),
        ));
        let checks = {
            let observed = observed.clone();
            move |Json(request): Json<Value>| {
                let observed = observed.clone();
                async move {
                    use std::sync::atomic::Ordering;
                    assert_eq!(request["consistency"]["fullyConsistent"], true);
                    assert_eq!(
                        request["subject"]["object"]["objectId"],
                        principal.to_string()
                    );
                    assert!(matches!(
                        request["permission"].as_str(),
                        Some("discover" | "manage")
                    ));
                    let mode = observed.0.load(Ordering::SeqCst);
                    let tenant_denied = mode == 3 && request["resource"]["objectType"] == "tenant";
                    observed.1.lock().unwrap().push(request);
                    Json(
                        json!({"checkedAt":{"token":if mode==2 {""} else {"native-scope-fresh"}},
                        "permissionship":if mode==1 || tenant_denied {"PERMISSIONSHIP_NO_PERMISSION"} else {"PERMISSIONSHIP_HAS_PERMISSION"}}),
                    )
                }
            }
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let spicedb =
            crate::spicedb::SpiceDb::for_test(format!("http://{}", listener.local_addr().unwrap()));
        let router =
            axum::Router::new().route("/v1/permissions/check", axum::routing::post(checks));
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let binding_id = Uuid::new_v4();
        let query = json!({"permission":"discover"});
        let scope = serde_json::to_value(
            authorize_scope(&mut tx, &spicedb, actor, binding_id, &current, &query)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(scope["scope"]["bindingId"], json!(binding_id));
        assert_eq!(scope["scope"]["workspaceId"], json!(workspace));
        assert_eq!(scope["scope"]["generation"], 7);
        assert_eq!(scope["scope"]["permission"], "discover");
        // A never-joined workspace administrator is the existing DD-82 case.
        assert_eq!(
            observed
                .1
                .lock()
                .unwrap()
                .iter()
                .map(|request| request["permission"].as_str().unwrap().to_owned())
                .collect::<Vec<_>>(),
            ["manage", "discover"]
        );
        let workspace_membership = Uuid::new_v4();
        sqlx::query("insert into identity.workspace_membership(id,workspace_id,tenant_principal_id,state) values($1,$2,$3,'ACTIVE')")
            .bind(workspace_membership).bind(workspace).bind(principal).execute(&mut *tx).await.unwrap();
        observed.1.lock().unwrap().clear();
        authorize_scope(
            &mut tx,
            &spicedb,
            actor,
            binding_id,
            &current,
            &json!({"permission":"manage"}),
        )
        .await
        .unwrap();
        assert_eq!(observed.1.lock().unwrap().len(), 1);
        use std::sync::atomic::Ordering;
        for mode in [1, 2] {
            observed.0.store(mode, Ordering::SeqCst);
            assert!(
                authorize_scope(&mut tx, &spicedb, actor, binding_id, &current, &query)
                    .await
                    .is_err()
            );
        }
        sqlx::query("update identity.workspace_membership set state='REVOKED',version=version+1 where id=$1")
            .bind(workspace_membership).execute(&mut *tx).await.unwrap();
        // A residual workspace admin tuple must not bypass actual revocation.
        observed.0.store(3, Ordering::SeqCst);
        assert!(
            authorize_scope(&mut tx, &spicedb, actor, binding_id, &current, &query)
                .await
                .is_err()
        );
        observed.0.store(0, Ordering::SeqCst);
        authorize_scope(&mut tx, &spicedb, actor, binding_id, &current, &query)
            .await
            .unwrap();
        assert!(authorize_scope(
            &mut tx,
            &spicedb,
            actor,
            binding_id,
            &current,
            &json!({"permission":"execute"})
        )
        .await
        .is_err());
        assert!(authorize_scope(
            &mut tx,
            &spicedb,
            Actor {
                human_identity_id: Some(Uuid::new_v4()),
                ..actor
            },
            binding_id,
            &current,
            &query
        )
        .await
        .is_err());
        for (disable,restore,id) in [
            ("update identity.human_identity set status='DISABLED' where id=$1","update identity.human_identity set status='ACTIVE' where id=$1",human),
            ("update identity.tenant_membership set state='REVOKED' where tenant_principal_id=$1","update identity.tenant_membership set state='ACTIVE' where tenant_principal_id=$1",principal),
            ("update identity.principal set status='DISABLED' where id=$1","update identity.principal set status='ACTIVE' where id=$1",principal),
            ("update identity.tenant set state='SUSPENDED' where id=$1","update identity.tenant set state='ACTIVE' where id=$1",tenant),
            ("update identity.workspace set state='SUSPENDED' where id=$1","update identity.workspace set state='ACTIVE' where id=$1",workspace),
        ] {
            observed.1.lock().unwrap().clear();
            sqlx::query(disable).bind(id).execute(&mut *tx).await.unwrap();
            assert!(authorize_scope(&mut tx,&spicedb,actor,binding_id,&current,&query).await.is_err(),"{disable}");
            assert!(observed.1.lock().unwrap().is_empty(),"inactive identity cannot reach public permission check");
            sqlx::query(restore).bind(id).execute(&mut *tx).await.unwrap();
        }
        server.abort();
        for (disable,restore,id) in [
            ("update identity.external_identity set status='DISABLED' where human_identity_id=$1","update identity.external_identity set status='ACTIVE' where human_identity_id=$1",human),
            ("update identity.human_identity set status='DISABLED' where id=$1","update identity.human_identity set status='ACTIVE' where id=$1",human),
            ("update identity.identity_provider set status='DISABLED' where id=$1","update identity.identity_provider set status='ACTIVE' where id=$1",provider),
            ("update identity.tenant_membership set state='REVOKED' where tenant_principal_id=$1","update identity.tenant_membership set state='ACTIVE' where tenant_principal_id=$1",principal),
            ("update identity.principal set status='DISABLED' where id=$1","update identity.principal set status='ACTIVE' where id=$1",principal),
            ("update identity.tenant set state='SUSPENDED' where id=$1","update identity.tenant set state='ACTIVE' where id=$1",tenant),
        ] {
            sqlx::query(disable).bind(id).execute(&mut *tx).await.unwrap();
            assert!(mapped_actor(&mut tx,tenant,provider,&issuer,&subject).await.is_err(),"{disable}");
            sqlx::query(restore).bind(id).execute(&mut *tx).await.unwrap();
        }
        tx.rollback().await.unwrap();
    }

    #[test]
    fn native_human_subject_authenticates_without_business_entitlements() {
        let rng = ring::rand::SystemRandom::new();
        let algorithm = &ring::signature::ECDSA_P256_SHA256_ASN1_SIGNING;
        let private = ring::signature::EcdsaKeyPair::generate_pkcs8(algorithm, &rng).unwrap();
        let pair =
            ring::signature::EcdsaKeyPair::from_pkcs8(algorithm, private.as_ref(), &rng).unwrap();
        let public = pair.public_key().as_ref();
        let keys: JwkSet = serde_json::from_value(json!({"keys":[{"kty":"EC","crv":"P-256","alg":"ES256","kid":"ephemeral",
            "x":URL_SAFE_NO_PAD.encode(&public[1..33]),"y":URL_SAFE_NO_PAD.encode(&public[33..65])}]})).unwrap();
        let mut header = jsonwebtoken::Header::new(Algorithm::ES256);
        header.kid = Some("ephemeral".into());
        let key = jsonwebtoken::EncodingKey::from_ec_der(private.as_ref());
        let signed = |claims: &Value| jsonwebtoken::encode(&header, claims, &key).unwrap();
        let now = jsonwebtoken::get_current_timestamp();
        let claims = json!({"iss":"urn:fixture:human-idp","aud":"native-browser","sub":"existing-subject","exp":now+60});
        let trust = json!({"audience":"native-browser"});
        assert_eq!(
            verified_subject(&signed(&claims), "urn:fixture:human-idp", &trust, &keys).unwrap(),
            "existing-subject"
        );
        for field in ["iss", "aud", "sub", "exp"] {
            let mut missing = claims.clone();
            missing.as_object_mut().unwrap().remove(field);
            assert!(
                verified_subject(&signed(&missing), "urn:fixture:human-idp", &trust, &keys)
                    .is_err(),
                "missing {field}"
            );
        }
        for (field, value) in [
            ("iss", json!("urn:foreign:idp")),
            ("aud", json!("service-client")),
            ("sub", json!(" ")),
            ("exp", json!(now - 1)),
            ("nbf", json!(now + 60)),
            ("azp", json!("service-client")),
        ] {
            let mut changed = claims.clone();
            changed[field] = value;
            assert!(
                verified_subject(&signed(&changed), "urn:fixture:human-idp", &trust, &keys)
                    .is_err(),
                "changed {field}"
            );
        }
        // Business-like claims cannot select another principal or scope. The
        // existing mapped_actor/authorize_scope consumers remain authoritative.
        let mut extraneous = claims.clone();
        extraneous["instance"] = json!(["another-instance"]);
        extraneous["roles"] = json!(["admin"]);
        assert_eq!(
            verified_subject(&signed(&extraneous), "urn:fixture:human-idp", &trust, &keys).unwrap(),
            "existing-subject"
        );
    }

    #[test]
    fn native_human_transport_rejects_duplicate_or_missing_identity_headers() {
        let mut headers = HeaderMap::new();
        assert!(header(&headers, "x-kailo-native-human-token").is_err());
        headers.insert(
            "x-kailo-native-human-token",
            "signed-fixture".parse().unwrap(),
        );
        assert_eq!(
            header(&headers, "x-kailo-native-human-token").unwrap(),
            "signed-fixture"
        );
        headers.append(
            "x-kailo-native-human-token",
            "other-fixture".parse().unwrap(),
        );
        assert!(header(&headers, "x-kailo-native-human-token").is_err());
    }
}
