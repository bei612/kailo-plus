//! DD-90 / 18 §5.1: original PAT observation and revocation, not a new
//! authorization path for file content or a way to replay a lost launch.
use super::*;

pub(crate) const RECONCILE: &str = "PROTOCOL_SESSION_RECONCILE";

fn revoke_allowed(session: &Session) -> bool {
    matches!(
        session.state.as_str(),
        "CLOSED" | "EXPIRED" | "REVOKED" | "FAILED"
    ) || session.expires_at <= Utc::now()
}

async fn revocation_allowed(state: &ServiceState, session: &Session) -> Result<bool, Refusal> {
    if revoke_allowed(session) {
        return Ok(true);
    }
    // Withdrawal revokes the original PAT, not the pending writer outcome.
    // That outcome remains UNKNOWN until its same Workflow has evidence.
    Ok(sqlx::query_scalar("select exists(select 1 from catalog.application_binding b
        join admission.protocol_session s on s.application_binding_id=b.id and s.tenant_id=b.tenant_id
        where s.id=$1 and b.state='DISABLING')")
        .bind(session.id).fetch_one(&state.pool).await?)
}

// The historical admission proves only ownership of this already-issued PAT.
// Current HUMAN authorization is deliberately not renewed for an observation
// or revocation; normal OPEN/READ/WRITE still use fresh_execution instead.
async fn original_reference(
    state: &ServiceState,
    ae: &Execution,
    session: &Session,
    audience: Option<&str>,
) -> Result<(String, String), Refusal> {
    if session.id != ae.id
        || session.action_execution_id != ae.id
        || !matches!(
            ae.action_key.as_str(),
            "file_storage.open_view@v1" | "file_storage.open_edit@v1"
        )
        || ae.actor_principal_id != ae.initiator_principal_id
        || !matches!(ae.dispatch_state.as_str(), "UNKNOWN" | "DISPATCHED")
    {
        return Err(denied());
    }
    let facts:Option<(String,String)>=sqlx::query_as("select decision.zed_token,s.audience
        from admission.protocol_session ps
        join admission.action_execution a on a.id=ps.action_execution_id and a.operation_id=ps.operation_id
          and a.tenant_id=ps.tenant_id and a.workspace_id is not distinct from ps.workspace_id
          and a.actor_principal_id=ps.actor_principal_id and a.initiator_principal_id=ps.initiating_human_principal_id
          and a.component_binding_id=ps.application_binding_id and a.component_binding_kind='APPLICATION'
        join catalog.action_definition d on d.id=a.action_definition_id and d.action_key=a.action_key
          and d.version=a.action_version and d.component_release_id=a.component_release_id
          and d.execution_mode='PROTOCOL' and d.capacity_policy='NATIVE'
        join catalog.application_binding b on b.id=ps.application_binding_id and b.tenant_id=ps.tenant_id
          and (b.workspace_id is null or b.workspace_id=ps.workspace_id)
          and b.component_release_id=a.component_release_id and b.state in ('ACTIVE','DISABLING')
        join projection.application_runtime p on p.binding_id=b.id and p.generation=a.component_projection_generation
          and p.component_release_id=a.component_release_id
        join identity.service_principal s on s.principal_id=b.service_principal_id
          and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
        join identity.principal service on service.id=s.principal_id and service.tenant_id=ps.tenant_id
          and service.kind='SERVICE' and service.status='ACTIVE'
        join lateral (select ad.zed_token from admission.action_decision ad
          where ad.action_execution_id=a.id and ad.operation_id=a.operation_id
            and ad.scope_decision='ALLOW' and ad.authorization_decision='ALLOW'
            and ad.zed_token is not null and ad.zed_token<>'' order by ad.decided_at desc limit 1) decision on true
        where ps.id=$1 and ps.token_revocation_key=ps.id
          and (ps.state<>'UNKNOWN' or exists(select 1 from projection.workflow_ref w
            where w.action_execution_id=a.id and w.operation_id=a.operation_id
              and w.tenant_id=a.tenant_id and w.workspace_id is not distinct from a.workspace_id
              and w.workflow_type='ComponentTaskWorkflow' and w.kind=$2
              and w.projection_state in ('PENDING_START','RUNNING','UNKNOWN')))")
        .bind(session.id).bind(RECONCILE).fetch_optional(&state.pool).await?;
    let (revision, expected) = facts.ok_or_else(denied)?;
    if audience.is_some_and(|value| value != expected) {
        return Err(denied());
    }
    Ok((revision, expected))
}

pub(crate) async fn authorize(
    state: &ServiceState,
    ae: &Execution,
    audience: &str,
    operation: &str,
    args: &Value,
) -> Result<String, Refusal> {
    let typed: contracts::AdapterProtocolSessionLifecycleRequest =
        serde_json::from_value(args.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(typed).map_err(|_| invalid())? != *args
        || !matches!(operation, "observe" | "cancel")
        || args["protocolSessionId"] != json!(ae.id)
        || args["idempotencyKey"] != json!(ae.id)
    {
        return Err(invalid());
    }
    let session = launch::load(&state.pool, ae.id).await?.ok_or_else(denied)?;
    if args["nativeObjectRef"] != session.target["nativeObjectRef"]
        || (operation == "cancel" && !revocation_allowed(state, &session).await?)
    {
        return Err(denied());
    }
    Ok(original_reference(state, ae, &session, Some(audience))
        .await?
        .0)
}

pub(crate) async fn metadata(
    state: &ServiceState,
    ae: &Execution,
    session: &Session,
    operation: &str,
) -> Result<Value, Refusal> {
    if !matches!(operation, "TOKEN_OBSERVE" | "TOKEN_REVOKE")
        || (operation == "TOKEN_REVOKE" && !revocation_allowed(state, session).await?)
    {
        return Err(denied());
    }
    original_reference(state, ae, session, None).await?;
    let requested: String = sqlx::query_scalar(
        "select requested_mode from admission.protocol_session
        where id=$1 and action_execution_id=$1 and state=$2 and expires_at=$3",
    )
    .bind(session.id)
    .bind(&session.state)
    .bind(session.expires_at)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(denied)?;
    let typed:contracts::ProtocolSessionLifecyclePepResponse=serde_json::from_value(json!({
        "decision":"ALLOW","protocolSessionId":session.id,"nativeObjectRef":session.target["nativeObjectRef"],
        "requestedMode":requested,"expiresAt":session.expires_at})).map_err(|_|invalid())?;
    serde_json::to_value(typed).map_err(|_| invalid())
}

/// Original writer-outcome evidence, not permission for a new content read.
/// The exact accepted native callback is queried again before UNKNOWN can
/// become SAVED; a STARTED/partial outcome has no synthesized result revision.
pub(crate) async fn authorize_revision(
    state: &ServiceState,
    ae: &Execution,
    audience: &str,
    args: &Value,
) -> Result<String, Refusal> {
    let typed: contracts::AdapterQueryRevisionRequest =
        serde_json::from_value(args.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(typed).map_err(|_| invalid())? != *args {
        return Err(invalid());
    }
    let session = launch::load(&state.pool, ae.id).await?.ok_or_else(denied)?;
    let evidence = session
        .native_write_observation
        .as_ref()
        .filter(|value| value["phase"] == "ACCEPTED")
        .ok_or_else(unknown)?;
    if session.state != "UNKNOWN"
        || args
            != &json!({"nativeObjectRef":session.target["nativeObjectRef"],
        "idempotencyKey":session.id,"protocolReconcile":{"protocolSessionId":session.id,
            "baseRevision":session.base_revision,"writeObservation":evidence}})
    {
        return Err(denied());
    }
    Ok(original_reference(state, ae, &session, Some(audience))
        .await?
        .0)
}
