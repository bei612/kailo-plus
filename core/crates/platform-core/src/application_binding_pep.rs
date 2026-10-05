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

pub(crate) async fn check(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Response {
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
        if current.as_ref()!=Some(&(tenant,workspace,client,audience,status.clone(),lifecycle)) {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        let def=crate::governance::exact_definition_for_execution(&state.pool,&ae).await?;
        let operation=text(&raw,"operation")?;
        let arguments:Value=serde_json::from_str(text(&raw,"argumentsJson")?).map_err(|_|invalid())?;
        let management=crate::action_token::management_operation(&ae.action_key,&status,operation);
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
            let observing=matches!(operation,"observe"|"extract_usage");
            let hash=if observing {collab_bridge::limits::canonical_digest(&json!({"operation":operation,"arguments":arguments}))}
                else {collab_bridge::limits::canonical_digest(&arguments)};
            if !attached || (!observing && (operation!="execute" || status!="ACTIVE")) || raw.get("contentReference").is_some()
                || ae.gate_state!="ALLOWED" || ae.dispatch_state!="DISPATCHED"
                || claims["tenant_id"]!=json!(ae.tenant_id) || claims.get("workspace_id")!=expected_workspace.as_ref()
                || claims["actor_principal_id"]!=json!(ae.actor_principal_id)
                || claims["agent_principal_id"]!=json!(ae.actor_principal_id)
                || claims["initiating_human_principal_id"]!=json!(ae.initiator_principal_id)
                || claims["operation_id"]!=json!(ae.operation_id) || claims["action_key"]!=ae.action_key
                || claims["action_definition_version"]!=ae.action_version || claims["target_type"]!=def.target_type
                || claims["target_id"]!=json!(ae.target_id)
                || (!observing && claims["normalized_parameter_hash"]!=parameters["toolParameterHash"])
                || claims["normalized_parameter_hash"]!=hash
                || claims["result_exposure_policy_id"]!=parameters["resultExposurePolicyId"]
                || claims["result_exposure_policy_version"]!=parameters["resultExposurePolicyVersion"]
                || claims["delegation_id"]!=parameters["delegationId"] || claims["delegation_version"]!=parameters["delegationVersion"]
                || claims["authorization_min_zed_token"].as_str().is_none_or(str::is_empty)
                || (!observing && crate::application_tool::target(&arguments)?!=(def.target_type.as_str(),ae.target_id)) {
                return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
            }
            tx.commit().await?;
            let revision=if observing {
                crate::action_token::observation_revision(&state,&ae,binding,operation,&arguments).await?
            } else {
                let decision=crate::application_tool::fresh_execution(&state.governance,&ae).await?;
                if !decision.allowed {return Err(Refusal::Denied(ReasonCode::PermissionDenied));}
                decision.zed_token.filter(|v|!v.is_empty()).ok_or_else(blocked)?
            };
            let response:contracts::AdapterPepCheckResponse=serde_json::from_value(json!({"actionExecutionId":ae.id,
                "operationId":ae.operation_id,"authorizationMinZedToken":revision}))
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
