//! The original Adapter Protocol callback authenticates a binding, never a
//! global audience. Lifecycle-only operations retain their exact management
//! action and state; this is not an ACTIVE exemption for business tools.

use super::*;
use crate::service_api::ServiceState;
use axum::{
    extract::State,
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};

type BindingIdentity = (Uuid, Option<Uuid>, String, String, String, Option<Uuid>);

// Transport classification only; the ActionExecution remains the authority.
// Business reads cannot borrow the DISABLING/system-observation exception.
fn business_operation(
    operation: &str,
    status: &str,
) -> Result<contracts::AdapterProtocolOperation, Refusal> {
    use contracts::AdapterProtocolOperation::*;
    match (operation, status) {
        ("observe", "ACTIVE" | "DISABLING") => Ok(Observe),
        ("extract_usage", "ACTIVE" | "DISABLING") => Ok(ExtractUsage),
        ("execute", "ACTIVE") => Ok(Execute),
        ("query_revision", "ACTIVE") => Ok(QueryRevision),
        ("map_native_status_error", "ACTIVE") => Ok(MapNativeStatusError),
        _ => Err(Refusal::Denied(ReasonCode::ScopeGuardFailed)),
    }
}

/// Native object identity comes from the authorized Resource and its current
/// binding, never from the adapter's submitted arguments or UI configuration.
async fn authorized_resource(
    state: &ServiceState,
    ae: &crate::governance::Execution,
    binding: Uuid,
) -> Result<Value, Refusal> {
    let row: Option<(Uuid, String, String, String, String)> = sqlx::query_as(
        "select r.id,r.native_type,r.native_id,b.native_instance_ref,b.native_scope_ref
         from catalog.resource r
         join catalog.application_binding b on b.id=r.application_binding_id and b.tenant_id=r.tenant_id
         join projection.application_runtime p on p.binding_id=b.id and p.generation=b.active_projection_generation
           and p.component_release_id=b.component_release_id and p.state='ACTIVE'
         join admission.action_execution a on a.id=$4 and a.target_id=r.id and a.tenant_id=r.tenant_id
           and a.component_binding_id=b.id and a.component_release_id=b.component_release_id
           and a.component_projection_generation=b.active_projection_generation
         where r.id=$1 and r.tenant_id=$2 and r.application_binding_id=$3 and r.state='ACTIVE'
           and r.projection_action_execution_id is null and b.state='ACTIVE'",
    )
    .bind(ae.target_id)
    .bind(ae.tenant_id)
    .bind(binding)
    .bind(ae.id)
    .fetch_optional(&state.pool)
    .await?;
    let (resource, kind, reference, instance, scope) = row.ok_or_else(blocked)?;
    if [&kind, &reference, &instance, &scope]
        .iter()
        .any(|value| value.is_empty() || value.trim() != value.as_str())
    {
        return Err(blocked());
    }
    Ok(
        json!({"resourceId":resource,"nativeType":kind,"nativeRef":reference,
        "nativeInstanceRef":instance,"nativeScopeRef":scope}),
    )
}

pub(crate) async fn check(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Response {
    // The two original protocol request variants are closed machine schemas.
    // A Session callback authenticates the binding, not an Agent's ActionToken.
    let body = match body {
        Ok(Json(raw)) if raw.get("protocolSessionId").is_some() => {
            return crate::protocol_session::pep_check(State(state), headers, raw).await
        }
        other => other,
    };
    let result=async {
        let Json(raw)=body.map_err(|_|invalid())?;
        let parsed:contracts::AdapterPepCheckRequest=serde_json::from_value(raw.clone()).map_err(|_|invalid())?;
        if serde_json::to_value(parsed).map_err(|_|invalid())?!=raw {return Err(invalid());}
        let binding=uuid(&raw,"bindingId")?;
        let mut headers=headers.get_all(axum::http::header::AUTHORIZATION).iter();
        let header=headers.next().and_then(|value|value.to_str().ok()).ok_or_else(invalid)?;
        if headers.next().is_some() {return Err(invalid());}
        let identity:Option<BindingIdentity>=sqlx::query_as(
            "select b.tenant_id,b.workspace_id,b.normalized_config->>'client_id',s.audience,b.state,
                    b.projection_action_execution_id
             from catalog.application_binding b join identity.service_principal s on s.principal_id=b.service_principal_id
               and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
             join identity.principal p on p.id=s.principal_id and p.tenant_id=b.tenant_id
               and p.kind='SERVICE' and p.status='ACTIVE'
             where b.id=$1 and b.state in ('PROVISIONING','ACTIVE','DISABLING')")
            .bind(binding).fetch_optional(&state.pool).await?;
        let (tenant,workspace,client,audience,status,lifecycle)=identity.ok_or_else(blocked)?;
        // Duplicate configured client ownership is an invalid deployment, not
        // permission to pick the first matching ServicePrincipal.
        let clients:i64=sqlx::query_scalar("select count(*) from catalog.application_binding
            where normalized_config->>'client_id'=$1 and state<>'DISABLED'")
            .bind(&client).fetch_one(&state.pool).await?;
        if clients!=1 {return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));}
        state.auth.verify_binding_client(Some(header),&client).await.map_err(|error|match error {
            crate::service_auth::ServiceAuthError::KeysUnavailable=>Refusal::Unavailable("adapter identity keys unavailable".into()),
            _=>Refusal::Denied(ReasonCode::PermissionDenied),
        })?;
        let claims=crate::action_token::verify(text(&raw,"actionToken")?,&audience)?;
        let mut tx=state.pool.begin().await?;
        // Native receiver writes share the read root's lock order with receipt
        // settlement and repeated grant admission: root, child, then binding.
        let parent:Option<Uuid>=sqlx::query_scalar("select parent_action_execution_id from admission.action_execution
            where id=$1 and parameters->>'componentActionKind'='SERVICE_READ_RECEIVER'")
            .bind(uuid(&claims,"action_execution_id")?).fetch_optional(&mut *tx).await?.flatten();
        if let Some(parent)=parent { crate::governance::lock_execution(&mut tx,parent).await?; }
        let ae=crate::governance::lock_execution(&mut tx,uuid(&claims,"action_execution_id")?).await?;
        // Original root/AE before binding lock order: disable uses this same
        // order. Re-read after token verification so a revoked/rekeyed identity
        // cannot borrow the pre-authentication snapshot.
        let current:Option<BindingIdentity>=sqlx::query_as(
            "select b.tenant_id,b.workspace_id,b.normalized_config->>'client_id',s.audience,b.state,
                    b.projection_action_execution_id
             from catalog.application_binding b join identity.service_principal s on s.principal_id=b.service_principal_id
               and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
             join identity.principal p on p.id=s.principal_id and p.tenant_id=b.tenant_id
               and p.kind='SERVICE' and p.status='ACTIVE'
             where b.id=$1 and b.state in ('PROVISIONING','ACTIVE','DISABLING') for share of b,s,p")
            .bind(binding).fetch_optional(&mut *tx).await?;
        if current.as_ref()!=Some(&(tenant,workspace,client,audience.clone(),status.clone(),lifecycle)) {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        let operation=text(&raw,"operation")?;
        let arguments:Value=serde_json::from_str(text(&raw,"argumentsJson")?).map_err(|_|invalid())?;
        if super::read_grant::native_receiver::is_receiver(&ae) {
            if status!="ACTIVE" || raw.get("contentReference").is_some() { return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed)); }
            let revision=super::read_grant::native_receiver::authorize(&state,&mut tx,&ae,binding,&claims,operation,&arguments).await?;
            tx.commit().await?;
            let response:contracts::AdapterPepCheckResponse=serde_json::from_value(json!({"actionExecutionId":ae.id,
                "operationId":ae.operation_id,"authorizationMinZedToken":revision})).map_err(|_|invalid())?;
            return Ok(response);
        }
        if super::read_grant::is_service(&ae) {
            if status!="ACTIVE" || raw.get("contentReference").is_some() { return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed)); }
            let revision=super::read_grant::authorize(&state,&ae,binding,&claims,operation,&arguments).await?;
            tx.commit().await?;
            let response:contracts::AdapterPepCheckResponse=serde_json::from_value(json!({"actionExecutionId":ae.id,
                "operationId":ae.operation_id,"authorizationMinZedToken":revision})).map_err(|_|invalid())?;
            return Ok(response);
        }
        let def=crate::governance::exact_definition_for_execution(&state.pool,&ae).await?;
        let management=crate::action_token::management_operation(&ae.action_key,&status,operation);
        if def.execution_mode=="PROTOCOL" {
            let observing=matches!(operation,"observe"|"cancel")
                || (operation=="query_revision" && arguments.get("protocolReconcile").is_some());
            let parameters=ae.parameters.as_ref().ok_or_else(invalid)?;
            let expected_workspace=ae.workspace_id.map(|id|json!(id));
            let attached:bool=sqlx::query_scalar("select exists(select 1 from admission.action_execution a
                join catalog.application_binding b on b.id=a.component_binding_id and b.component_release_id=a.component_release_id
                where a.id=$1 and b.id=$2 and b.tenant_id=a.tenant_id
                  and (b.state='ACTIVE' or ($3 and b.state='DISABLING'))
                  and (b.workspace_id is null or b.workspace_id=a.workspace_id)
                  and b.active_projection_generation=a.component_projection_generation)")
                .bind(ae.id).bind(binding).bind(observing).fetch_one(&mut *tx).await?;
            if !attached || (!observing && status!="ACTIVE")
                || !matches!(operation,"query_revision"|"execute"|"observe"|"cancel") || raw.get("contentReference").is_some()
                || claims["tenant_id"]!=json!(ae.tenant_id) || claims.get("workspace_id")!=expected_workspace.as_ref()
                || claims["actor_principal_id"]!=json!(ae.actor_principal_id) || claims["initiating_human_principal_id"]!=json!(ae.initiator_principal_id)
                || claims["operation_id"]!=json!(ae.operation_id) || claims["action_key"]!=ae.action_key
                || claims["action_definition_version"]!=ae.action_version || claims["target_type"]!=def.target_type
                || claims["target_id"]!=json!(ae.target_id) || claims.get("agent_principal_id").is_some()
                || claims.get("delegation_id").is_some() || claims.get("delegation_version").is_some()
                || claims.get("result_exposure_policy_id").is_some() || claims.get("result_exposure_policy_version").is_some()
                || claims["normalized_parameter_hash"]!=collab_bridge::limits::canonical_digest(&json!({"operation":operation,"arguments":arguments}))
                || claims["authorization_min_zed_token"].as_str().is_none_or(str::is_empty)
                || parameters["protocolSessionOpen"].is_null() {return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));}
            tx.commit().await?;
            let revision=if matches!(operation,"observe"|"cancel") {
                crate::protocol_session::lifecycle::authorize(&state,&ae,&audience,operation,&arguments).await?
            }else if operation=="query_revision" {
                crate::protocol_session::revision_read(&state,&ae,&audience,&arguments).await?
            }else{crate::protocol_session::launch::authorize(&state,&ae,&audience,&arguments).await?};
            let response:contracts::AdapterPepCheckResponse=serde_json::from_value(json!({"actionExecutionId":ae.id,
                "operationId":ae.operation_id,"authorizationMinZedToken":revision})).map_err(|_|invalid())?;
            return Ok(response);
        }
        if !management {
            let parameters=ae.parameters.as_ref().ok_or_else(invalid)?;
            let attached:bool=sqlx::query_scalar("select exists(select 1 from admission.action_execution a
                join catalog.application_binding b on b.id=a.component_binding_id
                  and b.component_release_id=a.component_release_id
                where a.id=$1 and a.component_binding_kind='APPLICATION' and b.id=$2 and b.tenant_id=a.tenant_id
                  and (b.workspace_id is null or b.workspace_id=a.workspace_id)
                  and b.state in ('ACTIVE','DISABLING') and b.active_projection_generation=a.component_projection_generation)")
                .bind(ae.id).bind(binding).fetch_one(&mut *tx).await?;
            let expected_workspace=ae.workspace_id.map(|id|json!(id));
            let operation_kind=business_operation(operation,&status)?;
            let executing=operation_kind==contracts::AdapterProtocolOperation::Execute;
            // Pure status/error mapping is not execution or native revision
            // lookup. Bind its own operation+arguments and retain the exact
            // business AE, policy and fresh authorization below.
            let hash=if executing {collab_bridge::limits::canonical_digest(&arguments)}
                else {collab_bridge::limits::canonical_digest(&json!({"operation":operation,"arguments":arguments}))};
            if !attached || raw.get("contentReference").is_some()
                || ae.gate_state!="ALLOWED" || ae.dispatch_state!="DISPATCHED"
                || claims["tenant_id"]!=json!(ae.tenant_id) || claims.get("workspace_id")!=expected_workspace.as_ref()
                || claims["actor_principal_id"]!=json!(ae.actor_principal_id)
                || (if crate::application_action::is_human(&ae) {claims.get("agent_principal_id").is_some()
                    || claims.get("delegation_id").is_some() || claims.get("delegation_version").is_some()}
                    else {claims["agent_principal_id"]!=json!(ae.actor_principal_id)})
                || claims["initiating_human_principal_id"]!=json!(ae.initiator_principal_id)
                || claims["operation_id"]!=json!(ae.operation_id) || claims["action_key"]!=ae.action_key
                || claims["action_definition_version"]!=ae.action_version || claims["target_type"]!=def.target_type
                || claims["target_id"]!=json!(ae.target_id)
                || (executing && claims["normalized_parameter_hash"]!=parameters["toolParameterHash"])
                || claims["normalized_parameter_hash"]!=hash
                || claims["result_exposure_policy_id"]!=parameters["resultExposurePolicyId"]
                || claims["result_exposure_policy_version"]!=parameters["resultExposurePolicyVersion"]
                || claims["delegation_id"]!=parameters["delegationId"] || claims["delegation_version"]!=parameters["delegationVersion"]
                || claims["authorization_min_zed_token"].as_str().is_none_or(str::is_empty)
                || (executing && crate::application_tool::target(&arguments)?!=(def.target_type.as_str(),ae.target_id)) {
                return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
            }
            if crate::application_action::is_human(&ae) && executing {
                // A signed preflight ticket is unusable until the original
                // transaction has frozen this exact EE/key/hash. It cannot be
                // presented with another key to start a second native request.
                let frozen:bool=sqlx::query_scalar("select exists(select 1 from admission.external_execution e
                    join projection.workflow_ref w on w.workflow_id=e.workflow_id and w.action_execution_id=e.action_execution_id
                      and w.workflow_type='ComponentTaskWorkflow' and w.kind='COMPONENT_ACTION'
                    where e.id=$1 and e.idempotency_key=$2 and e.action_execution_id=$3 and e.operation_id=$4
                      and e.component_binding_id=$5 and e.tenant_id=$6 and e.request_digest=$7
                      and e.platform_status in ('UNKNOWN','RUNNING') and e.usage_projection is not null)")
                    .bind(uuid(&claims,"external_execution_id")?).bind(uuid(&claims,"idempotency_key")?)
                    .bind(ae.id).bind(ae.operation_id).bind(binding).bind(ae.tenant_id).bind(&hash)
                    .fetch_one(&mut *tx).await?;
                if !frozen{return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));}
                crate::application_catalog::approval::require_consumed(
                    &state.governance,&mut tx,&ae,&def,
                ).await?;
            }
            tx.commit().await?;
            let revision=if matches!(operation_kind,contracts::AdapterProtocolOperation::Observe|contracts::AdapterProtocolOperation::ExtractUsage) {
                crate::action_token::observation_revision(&state,&ae,binding,operation,&arguments).await?
            } else if operation_kind==contracts::AdapterProtocolOperation::QueryRevision {
                let (_,revision)=crate::application_tool::fresh_revision_read(&state,&ae,&arguments).await?;
                revision
            } else {
                let decision=crate::application_tool::fresh_execution(&state.governance,&ae).await?;
                if !decision.allowed {return Err(Refusal::Denied(ReasonCode::PermissionDenied));}
                decision.zed_token.filter(|v|!v.is_empty()).ok_or_else(blocked)?
            };
            let mut response=json!({"actionExecutionId":ae.id,
                "operationId":ae.operation_id,"authorizationMinZedToken":revision});
            if executing && def.target_type=="RESOURCE" {
                response["targetResource"]=authorized_resource(&state,&ae,binding).await?;
            }
            let response:contracts::AdapterPepCheckResponse=serde_json::from_value(response)
                .map_err(|_|invalid())?;
            return Ok(response);
        }
        let expected_workspace=workspace.map(|id|json!(id));
        if !management || Some(ae.id)!=lifecycle || ae.target_id!=binding
            || ae.tenant_id!=tenant || ae.workspace_id!=workspace
            || ae.actor_principal_id!=ae.initiator_principal_id || ae.gate_state!="ALLOWED" || ae.dispatch_state!="DISPATCHED"
            || def.result_exposure!="NONE" || def.target_type!="APPLICATION_BINDING"
            || def.permission!="manage" || def.permission_object_type!="tenant"
            || def.tenant_rule!="SESSION_TENANT" || def.workspace_rule!="DECLARED_WORKSPACE"
            || raw.get("contentReference").is_some()
            || claims["tenant_id"]!=json!(tenant) || claims.get("workspace_id")!=expected_workspace.as_ref()
            || claims["actor_principal_id"]!=json!(ae.actor_principal_id)
            || claims["initiating_human_principal_id"]!=json!(ae.initiator_principal_id)
            || claims["operation_id"]!=json!(ae.operation_id) || claims["action_key"]!=ae.action_key
            || claims["action_definition_version"]!=ae.action_version || claims["target_type"]!=def.target_type
            || claims["target_id"]!=json!(binding)
            || claims["normalized_parameter_hash"]!=collab_bridge::limits::canonical_digest(&json!({"operation":operation,"arguments":arguments}))
            || claims.get("result_exposure_policy_id").is_some() || claims.get("result_exposure_policy_version").is_some()
            || claims.get("delegation_id").is_some() || claims.get("delegation_version").is_some()
            || claims.get("agent_principal_id").is_some()
            || claims["authorization_min_zed_token"].as_str().is_none_or(str::is_empty)
        {return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));}
        tx.commit().await?;
        let revision=if status=="DISABLING" && matches!(operation,"observe"|"extract_usage") {
            crate::action_token::lifecycle_observation_revision(&state,&ae,operation,&arguments).await?
        } else {
            let decision=state.governance.evaluate(crate::governance::Actor{tenant_id:tenant,
                principal_id:ae.actor_principal_id,human_identity_id:None},&def,
                &Target{id:binding,version:0,workspace_id:workspace}).await?;
            if !decision.allowed {return Err(Refusal::Denied(decision.reason.unwrap_or(ReasonCode::PermissionDenied)));}
            decision.zed_token.filter(|value|!value.is_empty()).ok_or_else(blocked)?
        };
        let response:contracts::AdapterPepCheckResponse=serde_json::from_value(json!({
            "actionExecutionId":ae.id,"operationId":ae.operation_id,"authorizationMinZedToken":revision}))
            .map_err(|_|invalid())?;
        Ok::<_,Refusal>(response)
    }.await;
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => error.respond(None),
    }
}

#[cfg(test)]
mod revision_pep_tests {
    use super::*;

    #[test]
    fn revision_read_requires_active_business_binding_not_observation_exception() {
        assert_eq!(
            business_operation("query_revision", "ACTIVE").unwrap(),
            contracts::AdapterProtocolOperation::QueryRevision
        );
        assert_eq!(
            business_operation("execute", "ACTIVE").unwrap(),
            contracts::AdapterProtocolOperation::Execute
        );
        for (operation, kind) in [
            ("observe", contracts::AdapterProtocolOperation::Observe),
            (
                "extract_usage",
                contracts::AdapterProtocolOperation::ExtractUsage,
            ),
        ] {
            assert_eq!(business_operation(operation, "DISABLING").unwrap(), kind);
        }
        for status in ["PROVISIONING", "DISABLING", "DISABLED", "UNKNOWN"] {
            assert!(business_operation("query_revision", status).is_err());
        }
        assert!(business_operation("query_revision_other", "ACTIVE").is_err());
    }

    #[test]
    fn pure_native_error_mapping_retains_active_business_scope() {
        assert_eq!(
            business_operation("map_native_status_error", "ACTIVE").unwrap(),
            contracts::AdapterProtocolOperation::MapNativeStatusError
        );
        for status in ["PROVISIONING", "DISABLING", "DISABLED", "UNKNOWN"] {
            assert!(business_operation("map_native_status_error", status).is_err());
        }
        for operation in [
            "map_native_status_error_other",
            "handshake",
            "validate_binding",
        ] {
            assert!(business_operation(operation, "ACTIVE").is_err());
        }
    }
}
