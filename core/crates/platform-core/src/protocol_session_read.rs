//! The original initiating HUMAN may read authorized Session metadata; this
//! endpoint never repeats a launch or returns its credential-bearing form.
use super::*;
use crate::bff::BffState;
use axum::extract::Path;

pub(crate) async fn get(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let actor = match crate::bff::resolve_execution_context(&state, &headers).await {
        Ok(value) => value,
        Err(error) => return error,
    };
    let result = async {
        let ae = crate::governance::load_execution(&state.pool, id).await?.ok_or_else(denied)?;
        if ae.tenant_id != actor.tenant_id || ae.initiator_principal_id != actor.tenant_principal_id
            || ae.actor_principal_id != actor.tenant_principal_id || ae.gate_state != "ALLOWED" {
            return Err(denied());
        }
        // Metadata reads do not acquire an update permission, quota or a new
        // admission. They still recheck original scope/projection and read.
        let (_, facts) = fresh_for_mode(&state.governance, &ae, false).await?;
        let session = launch::load(&state.pool, id).await?.ok_or_else(denied)?;
        let config: Value = sqlx::query_scalar("select normalized_config from catalog.application_binding
            where id=$1 and tenant_id=$2 and state='ACTIVE'")
            .bind(session.application_binding_id).bind(ae.tenant_id).fetch_optional(&state.pool).await?.ok_or_else(denied)?;
        let origin = launch::editor_configuration(&facts["manifest"], &config)?;
        let result: Option<String> = sqlx::query_scalar("select result_revision from admission.protocol_session
            where id=$1 and action_execution_id=$1 and version=$2")
            .bind(id).bind(session.version).fetch_optional(&state.pool).await?.ok_or_else(unknown)?;
        let mut value = json!({"protocolSessionId":session.id,"actionExecutionId":ae.id,
            "applicationBindingId":session.application_binding_id,"tenantId":ae.tenant_id,
            "reference":session.target,"baseRevision":session.base_revision,"state":session.state,
            "admittedMode":session.admitted_mode,"launchTheme":session.launch_theme,
            "launchLocale":match session.launch_locale.as_str(){"EN"=>"en","ZH_CN"=>"zh-CN",_=>return Err(invalid())},
            "expiresAt":session.expires_at,"version":session.version,"effectiveEditorOrigins":[origin]});
        if let Some(workspace) = ae.workspace_id {value["workspaceId"] = json!(workspace);}
        if let Some(revision) = result {value["resultRevision"] = json!(revision);}
        let typed: contracts::ProtocolSessionView = serde_json::from_value(value.clone()).map_err(|_|invalid())?;
        if serde_json::to_value(typed).map_err(|_|invalid())? != value {return Err(invalid());}
        Ok::<_, Refusal>(value)
    }.await;
    match result {
        Ok(value) => (
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            Json(value),
        )
            .into_response(),
        Err(error) => error.respond(None),
    }
}
