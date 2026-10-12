//! Same-request native writer admission for an already dispatched AE/EE.
//! This never starts a workflow or calls execute. Native storage owns the
//! single-use byte-step claim; repeated admission cannot replace that fence.
use super::*;
use crate::service_api::ServiceState;
use axum::http::HeaderMap;
use chrono::{Datelike, Utc};

pub(crate) fn is_native_writer(ae: &Execution) -> bool {
    is_human(ae)
        && ae.parameters.as_ref().is_some_and(|p| {
            p["nativeControlInput"] == true
                && p["inputArguments"]["input"].get("nativeIntentId").is_some()
        })
}

pub(super) async fn admit(
    state: &ServiceState,
    headers: &HeaderMap,
    binding: Uuid,
    request: &Value,
) -> Result<Value, Refusal> {
    let execution = id(&request["actionExecutionId"])?;
    let external = id(&request["externalExecutionId"])?;
    let intent = id(&request["nativeIntentId"])?;
    let ae = crate::governance::load_execution(&state.pool, execution)
        .await?
        .ok_or_else(denied)?;
    let actor = native_human::authenticate_execution(state, headers, binding, &ae).await?;
    let input = &ae.parameters.as_ref().ok_or_else(denied)?["inputArguments"]["input"];
    if !is_native_writer(&ae) || id(&input["nativeIntentId"])? != intent {
        return Err(denied());
    }
    let (key, audience, revision, deadline) = authorize(state, &ae, external, binding).await?;
    let token = crate::action_token::issue_native_execution(
        state, &ae, external, key, &audience, revision, deadline,
    )
    .await?;
    // Authenticator revocation or native membership changes during signing are
    // not permission to disclose a bearer issued under the former identity.
    let after = native_human::authenticate_execution(state, headers, binding, &ae).await?;
    if actor.principal_id != after.principal_id
        || actor.human_identity_id != after.human_identity_id
    {
        return Err(denied());
    }
    authorize(state, &ae, external, binding).await?;
    let claims = crate::action_token::verify(&token, &audience)?;
    let expires_at = admission_expiry(&claims, Utc::now().timestamp())?;
    Ok(
        json!({"submission":ae.submission(),"nativeExecutionAdmission":{
        "actionToken":token,"argumentsJson":collab_bridge::limits::canonical_json(
            &ae.parameters.as_ref().ok_or_else(denied)?["inputArguments"]),"expiresAt":expires_at}}),
    )
}

pub(super) fn admission_expiry(claims: &Value, now: i64) -> Result<String, Refusal> {
    let expires = claims["exp"]
        .as_i64()
        .filter(|expires| *expires > now)
        .ok_or_else(denied)?;
    let expires = chrono::DateTime::<Utc>::from_timestamp(expires, 0).ok_or_else(denied)?;
    if !(0..=9999).contains(&expires.year()) {
        return Err(denied());
    }
    Ok(expires.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

// Used both at ticket delivery and by execute PEP immediately before native
// byte steps. All identities, workflow and meter links come from the original
// persisted execution, not caller-selected claims or current generation.
pub(crate) async fn authorize(
    state: &ServiceState,
    ae: &Execution,
    external: Uuid,
    binding: Uuid,
) -> Result<(Uuid, String, String, i64), Refusal> {
    if !is_native_writer(ae) {
        return Err(denied());
    }
    let p = ae.parameters.as_ref().ok_or_else(denied)?;
    id(&p["inputArguments"]["input"]["nativeIntentId"])?;
    let deadline = p["inputArguments"]["input"]["nativeDeadline"]
        .as_i64()
        .ok_or_else(denied)?;
    authorize_retained(state, ae, external, binding, deadline).await
}

// The two callers first establish either the current HUMAN writer intent or
// the separately declared retained native task. Neither caller can use an
// observation ticket or an arbitrary native reference as execution authority.
pub(super) async fn authorize_retained(
    state: &ServiceState,
    ae: &Execution,
    external: Uuid,
    binding: Uuid,
    deadline: i64,
) -> Result<(Uuid, String, String, i64), Refusal> {
    let p = ae.parameters.as_ref().ok_or_else(denied)?;
    if deadline <= Utc::now().timestamp() {
        return Err(denied());
    }
    let mut tx = state.pool.begin().await?;
    let locked = crate::governance::lock_execution(&mut tx, ae.id).await?;
    let facts = execution_facts(&mut tx, &locked).await?;
    if facts.binding != binding
        || locked.parameters != ae.parameters
        || locked.parameter_hash != ae.parameter_hash
    {
        return Err(denied());
    }
    let row: Option<(Uuid, String, String, String)> = sqlx::query_as(
        "select e.idempotency_key,e.workflow_id,w.run_id,s.audience
         from admission.external_execution e
         join projection.workflow_ref w on w.workflow_id=e.workflow_id and w.action_execution_id=e.action_execution_id
           and w.tenant_id=e.tenant_id and w.operation_id=e.operation_id and w.kind='COMPONENT_ACTION'
           and w.workflow_type='ComponentTaskWorkflow'
         join catalog.application_binding b on b.id=e.component_binding_id and b.tenant_id=e.tenant_id and b.state='ACTIVE'
         join identity.service_principal s on s.principal_id=b.service_principal_id
           and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
         join identity.principal principal on principal.id=s.principal_id and principal.tenant_id=b.tenant_id
           and principal.kind='SERVICE' and principal.status='ACTIVE'
         where e.id=$1 and e.action_execution_id=$2 and e.operation_id=$3 and e.component_binding_id=$4
           and e.request_digest=$5 and e.workflow_id=$6
           and e.platform_status in ('UNKNOWN','RUNNING') and e.terminal_at is null
           and not exists(select 1 from audit.audit_event terminal
             where terminal.event_key=$3::text||':component_action:terminal' and terminal.tenant_id=e.tenant_id)
         for share of e,w,b,s,principal")
        .bind(external).bind(ae.id).bind(ae.operation_id).bind(binding)
        .bind(collab_bridge::limits::canonical_digest(&p["inputArguments"]))
        .bind(&ae.temporal_workflow_id).fetch_optional(&mut *tx).await?;
    let (key, workflow, first_run, audience) = row.ok_or_else(denied)?;
    crate::application_catalog::approval::require_consumed(
        &state.governance,
        &mut tx,
        &locked,
        &facts.application.definition,
    )
    .await?;
    validate_reference_and_policy(
        &mut tx,
        ae.tenant_id,
        &facts,
        &p["inputArguments"]["input"],
        id(&p["resultExposurePolicyId"])?,
        p["resultExposurePolicyVersion"]
            .as_i64()
            .and_then(|v| i32::try_from(v).ok())
            .ok_or_else(denied)?,
    )
    .await?;
    let mut fresh = state
        .governance
        .evaluate(
            Actor {
                tenant_id: ae.tenant_id,
                principal_id: ae.initiator_principal_id,
                human_identity_id: None,
            },
            &facts.application.definition,
            &facts.target,
        )
        .await?;
    state
        .governance
        .check_quota(ae.tenant_id, &facts.application.definition, &mut fresh)
        .await?;
    if !fresh.allowed {
        return Err(denied());
    }
    let revision = fresh
        .zed_token
        .filter(|v| !v.is_empty())
        .ok_or_else(unavailable)?;
    let observed = state
        .temporal
        .describe(&workflow)
        .await
        .map_err(|_| unavailable())?
        .ok_or_else(unavailable)?;
    if !matches!(observed.state, crate::temporal::ObservedState::Open)
        || first_run.is_empty()
        || observed.first_run_id != first_run
        || state
            .temporal
            .execution_cancel_requested(&workflow, &first_run)
            .await
            .map_err(|_| unavailable())?
        || deadline <= Utc::now().timestamp()
    {
        return Err(denied());
    }
    tx.commit().await?;
    Ok((key, audience, revision, deadline))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_writer_expiry_serializes_verified_unix_claim_as_contract_datetime() {
        let expiry = admission_expiry(&json!({"exp": 1791716460}), 1791716400).unwrap();
        assert_eq!(expiry, "2026-10-11T11:01:00.000Z");
        assert_eq!(
            chrono::DateTime::parse_from_rfc3339(&expiry)
                .unwrap()
                .timestamp(),
            1791716460
        );
        for claims in [
            json!({}),
            json!({"exp": "1791716460"}),
            json!({"exp": 1791716400}),
            json!({"exp": 1791716399}),
            json!({"exp": 253402300800_i64}),
            json!({"exp": i64::MAX}),
        ] {
            assert!(admission_expiry(&claims, 1791716400).is_err());
        }
    }
}
