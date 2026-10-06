//! DD-90: one original Workflow spans this Session; SAVED closes only a round.
//! Snapshot Activity results freeze later rounds into history. No save replay,
//! latest substitution, second AE or replacement Workflow input is permitted.
use super::*;

fn terminal(session: &Session) -> bool {
    matches!(
        session.state.as_str(),
        "CLOSED" | "EXPIRED" | "REVOKED" | "FAILED"
    )
}
fn pending(session: &Session) -> bool {
    session.state == "DIRTY"
        || session
            .native_write_observation
            .as_ref()
            .is_some_and(|v| matches!(v["phase"].as_str(), Some("STARTED" | "UNKNOWN")))
}
fn round(session: &Session) -> Value {
    let mut value = json!({"sessionVersion":session.version,"state":session.state});
    if let Some(evidence) = &session.native_write_observation {
        value["writeObservation"] = evidence.clone();
    }
    value
}

/// Called after the original UNKNOWN commit and by the existing normal tick.
/// The same stored initial input is used after a lost Start acknowledgement.
pub(crate) async fn start(state: &ServiceState, id: Uuid) -> Result<(), Refusal> {
    let ae = crate::governance::load_execution(&state.pool, id)
        .await?
        .ok_or_else(denied)?;
    let refs = execution_refs(&state.pool, id).await?;
    let mut tx = state.pool.begin().await?;
    let locked = crate::governance::lock_execution(&mut tx, id).await?;
    if locked.gate_state != "ALLOWED" || locked.dispatch_state != "DISPATCHED" {
        return Err(denied());
    }
    let facts: Option<(String, i32, String, Value, Option<Value>)> = sqlx::query_as(
        "select state,version,base_revision,target,reconcile_input from admission.protocol_session
         where id=$1 and action_execution_id=$1 for update",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let (status, version, base, target, stored) = facts.ok_or_else(denied)?;
    if status != "UNKNOWN" {
        return Ok(());
    }
    let target = if let Some(stored) = stored {
        stored
    } else {
        let correlation: Option<String> = sqlx::query_scalar(
            "select last_native_correlation_ref
            from admission.protocol_session where id=$1",
        )
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        let version = version.checked_add(1).ok_or_else(invalid)?;
        let workflow = crate::component_task::workflow_id(
            "protocol_session_reconcile",
            ae.tenant_id,
            &id.to_string(),
            version,
        );
        let input = json!({"actionExecutionId":id,"protocolSessionId":id,"sessionVersion":version,
            "workflowId":workflow,"bindingId":refs.binding_id,"releaseId":refs.release_id,
            "projectionGeneration":refs.generation,"actionDefinitionId":refs.definition_id,
            "baseRevision":base,"nativeObjectRef":target["nativeObjectRef"],
            "correlationRef":correlation.ok_or_else(unknown)?});
        let typed: contracts::ProtocolSessionReconcileTarget =
            serde_json::from_value(input.clone()).map_err(|_| invalid())?;
        if serde_json::to_value(typed).map_err(|_| invalid())? != input {
            return Err(invalid());
        }
        sqlx::query(
            "update admission.protocol_session set reconcile_input=$2,version=$3,updated_at=now()
            where id=$1 and reconcile_input is null and state='UNKNOWN'",
        )
        .bind(id)
        .bind(&input)
        .bind(version)
        .execute(&mut *tx)
        .await?;
        input
    };
    let workflow = target["workflowId"]
        .as_str()
        .ok_or_else(invalid)?
        .to_owned();
    if locked
        .temporal_workflow_id
        .as_deref()
        .is_some_and(|value| value != workflow)
    {
        return Err(denied());
    }
    sqlx::query(
        "update admission.action_execution set temporal_workflow_id=$2,updated_at=now()
        where id=$1 and (temporal_workflow_id is null or temporal_workflow_id=$2)",
    )
    .bind(id)
    .bind(&workflow)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    crate::component_task::start(
        &state.pool,
        &state.temporal,
        &workflow,
        ae.tenant_id,
        id,
        &crate::component_task::ComponentTaskInput {
            kind: lifecycle::RECONCILE.into(),
            target: json!({"protocolSession":target}),
        },
    )
    .await
    .map_err(|_| unknown())?;
    Ok(())
}

async fn original_run(
    state: &ServiceState,
    ae: &Execution,
    target: &Value,
    run: &str,
) -> Result<(), Refusal> {
    if uuid(target, "protocolSessionId")? != ae.id
        || uuid(target, "actionExecutionId")? != ae.id
        || ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "DISPATCHED"
        || target["workflowId"].as_str() != ae.temporal_workflow_id.as_deref()
    {
        return Err(denied());
    }
    let refs = execution_refs(&state.pool, ae.id).await?;
    if target["bindingId"] != json!(refs.binding_id)
        || target["releaseId"] != json!(refs.release_id)
        || target["actionDefinitionId"] != json!(refs.definition_id)
        || target["projectionGeneration"] != json!(refs.generation)
    {
        return Err(denied());
    }
    let stored: Option<Value> = sqlx::query_scalar(
        "select reconcile_input from admission.protocol_session
        where id=$1 and action_execution_id=$1",
    )
    .bind(ae.id)
    .fetch_one(&state.pool)
    .await?;
    if stored.as_ref() != Some(target) {
        return Err(denied());
    }
    let workflow = target["workflowId"].as_str().ok_or_else(invalid)?;
    let first: Option<Option<String>> = sqlx::query_scalar(
        "select run_id from projection.workflow_ref
        where workflow_id=$1 and action_execution_id=$2 and operation_id=$3 and tenant_id=$4
          and workspace_id is not distinct from $5 and workflow_type='ComponentTaskWorkflow'
          and kind=$6 and projection_state in ('PENDING_START','RUNNING','UNKNOWN')",
    )
    .bind(workflow)
    .bind(ae.id)
    .bind(ae.operation_id)
    .bind(ae.tenant_id)
    .bind(ae.workspace_id)
    .bind(lifecycle::RECONCILE)
    .fetch_optional(&state.pool)
    .await?;
    let first = first.flatten().ok_or_else(unknown)?;
    let observed = state
        .temporal
        .describe(workflow)
        .await
        .map_err(|_| unknown())?
        .ok_or_else(unknown)?;
    if !matches!(observed.state, crate::temporal::ObservedState::Open)
        || observed.run_id != run
        || observed.first_run_id.is_empty()
        || (first != observed.first_run_id && first != observed.run_id)
    {
        return Err(denied());
    }
    Ok(())
}

fn accepted_round(session: &Session, frozen: &Value) -> bool {
    session.state == "UNKNOWN"
        && round(session) == *frozen
        && frozen["writeObservation"]["phase"] == "ACCEPTED"
}

fn definite_zero_write_round(session: &Session, frozen: &Value) -> Option<&'static str> {
    if session.state != "UNKNOWN" || round(session) != *frozen {
        return None;
    }
    let evidence = &frozen["writeObservation"];
    if evidence["bytesWritten"] != 0
        || evidence.get("nativeEtag").is_some()
        || evidence.get("resultRevision").is_some()
    {
        return None;
    }
    match evidence["phase"].as_str() {
        Some("FAILED") => Some("FAILED"),
        Some("CONFLICT") => Some("CONFLICT"),
        _ => None,
    }
}

async fn settle_zero_write_round(
    state: &ServiceState,
    ae: &Execution,
    session: &Session,
    frozen: &Value,
    next: &str,
) -> Result<(), Refusal> {
    let def = crate::governance::exact_definition_for_execution(&state.pool, ae).await?;
    let mut tx = state.pool.begin().await?;
    crate::governance::lock_execution(&mut tx, ae.id).await?;
    let evidence = &frozen["writeObservation"];
    let changed = sqlx::query(
        "update admission.protocol_session set state=$4,version=version+1,updated_at=now()
        where id=$1 and version=$2 and state='UNKNOWN' and native_write_observation=$3
          and last_native_correlation_ref=$3->>'correlationRef'",
    )
    .bind(session.id)
    .bind(session.version)
    .bind(evidence)
    .bind(next)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() == 1 {
        crate::governance::audit(
            &mut tx,
            ae,
            &def,
            &format!("protocol-revision:{}", session.version),
            "SESSION",
            "ALLOW",
            if next == "FAILED" {
                "NATIVE_ZERO_WRITE_FAILED"
            } else {
                "NATIVE_TIMESTAMP_CONFLICT"
            },
            None,
            Vec::new(),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

async fn query_round(
    state: &ServiceState,
    ae: &Execution,
    session: &Session,
    frozen: &Value,
) -> Result<(), Refusal> {
    // The authenticated original writer already proved these closed zero-byte
    // outcomes. They do not invent a revision or need a latest-head query.
    if let Some(next) = definite_zero_write_round(session, frozen) {
        return settle_zero_write_round(state, ae, session, frozen, next).await;
    }
    if !accepted_round(session, frozen) {
        return Ok(());
    }
    let evidence = &frozen["writeObservation"];
    let args = json!({"nativeObjectRef":session.target["nativeObjectRef"],"idempotencyKey":session.id,
        "protocolReconcile":{"protocolSessionId":session.id,"baseRevision":session.base_revision,"writeObservation":evidence}});
    // Adapter.call uses the original fresh ActionToken query-revision path.
    // A STARTED/partial write has no invented revision to query as success.
    let response = maintenance::adapter(state, ae, session)
        .await?
        .call(state, ae, "query_revision", session.id, &args)
        .await?;
    let typed: contracts::AdapterQueryRevisionResponse =
        serde_json::from_value(response.clone()).map_err(|_| unknown())?;
    if serde_json::to_value(typed).map_err(|_| unknown())? != response
        || response["nativeObjectRef"] != session.target["nativeObjectRef"]
        || response["nativeRevision"] != evidence["resultRevision"]
        || response["protocolSessionId"] != json!(session.id)
        || response["correlationRef"] != evidence["correlationRef"]
    {
        return Err(unknown());
    }
    let def = crate::governance::exact_definition_for_execution(&state.pool, ae).await?;
    let mut tx = state.pool.begin().await?;
    crate::governance::lock_execution(&mut tx, ae.id).await?;
    let changed = sqlx::query(
        "update admission.protocol_session set state='SAVED',result_revision=$4,
        version=version+1,updated_at=now() where id=$1 and version=$2 and state='UNKNOWN'
          and native_write_observation=$3 and last_native_correlation_ref=$3->>'correlationRef'",
    )
    .bind(session.id)
    .bind(session.version)
    .bind(evidence)
    .bind(response["nativeRevision"].as_str().ok_or_else(unknown)?)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() == 1 {
        crate::governance::audit(
            &mut tx,
            ae,
            &def,
            &format!("protocol-revision:{}", session.version),
            "SESSION",
            "ALLOW",
            "NATIVE_REVISION_CONFIRMED",
            None,
            Vec::new(),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn advance(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<
        Json<contracts::ProtocolSessionReconcileRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Response {
    if let Err(response) = crate::service_api::authorize(&state, &headers).await {
        return response;
    }
    let Ok(Json(input)) = body else {
        return axum::http::StatusCode::BAD_REQUEST.into_response();
    };
    let result=async {
        let input=serde_json::to_value(input).map_err(|_|invalid())?;
        let target=&input["target"];
        let id=uuid(target,"actionExecutionId")?;
        let run=input["runId"].as_str().ok_or_else(invalid)?;
        Uuid::parse_str(run).map_err(|_|invalid())?;
        let ae=crate::governance::load_execution(&state.pool,id).await?.ok_or_else(denied)?;
        original_run(&state,&ae,target,run).await?;
        let mut session=launch::load(&state.pool,id).await?.ok_or_else(denied)?;
        if input["cancelRequested"]==true && !terminal(&session) && !pending(&session)
            && matches!(session.state.as_str(),"OPEN"|"SAVED"|"READ_ONLY"|"CONFLICT") {
            maintenance::change(&state,&ae,&session,"REVOKED").await?;
            session=launch::load(&state.pool,id).await?.ok_or_else(denied)?;
        }
        if let Some(frozen)=input.get("round") {
            query_round(&state,&ae,&session,frozen).await?;
            session=launch::load(&state.pool,id).await?.ok_or_else(denied)?;
        }
        let (status,waiting)=if terminal(&session) && !pending(&session) {
            maintenance::revoke(&state,&ae,&session).await?;
            (if session.state=="FAILED" {"FAILED"}else if input["cancelRequested"]==true {"CANCELED"}else{"COMPLETED"},"NONE")
        }else{("RUNNING",if session.state=="UNKNOWN" {"UNKNOWN_EXTERNAL_RESULT"}else{"PROTOCOL_SESSION_OPEN"})};
        let response:contracts::ProtocolSessionReconcileResult=serde_json::from_value(json!({
            "protocolSessionId":id,"round":round(&session),"status":status,"waitingReason":waiting}))
            .map_err(|_|invalid())?;
        serde_json::to_value(response).map_err(|_|invalid())
    }.await;
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => error.respond(None),
    }
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    pub(in crate::protocol_session) fn session(state: &str) -> Session {
        Session {
            id: Uuid::from_u128(1),
            action_execution_id: Uuid::from_u128(1),
            application_binding_id: Uuid::from_u128(2),
            target: json!({"nativeObjectRef":"node","nativeRevision":"base"}),
            admitted_mode: "EDIT".into(),
            base_revision: "base".into(),
            expires_at: Utc::now(),
            state: state.into(),
            version: 7,
            native_session_ref: Some("native".into()),
            launch_theme: "LIGHT".into(),
            launch_locale: "EN".into(),
            native_write_observation: None,
        }
    }
    #[test]
    fn saved_is_not_session_terminal_or_a_new_query_round() {
        let value = session("SAVED");
        assert!(!terminal(&value));
        assert!(!accepted_round(&value, &round(&value)));
    }
    #[test]
    fn query_only_matches_the_history_frozen_original_accepted_round() {
        let mut value = session("UNKNOWN");
        value.native_write_observation = Some(json!({"phase":"ACCEPTED","resultRevision":"r2"}));
        let frozen = round(&value);
        assert!(accepted_round(&value, &frozen));
        value.version += 1;
        assert!(!accepted_round(&value, &frozen));
        value.version -= 1;
        value.native_write_observation.as_mut().unwrap()["resultRevision"] = json!("r3");
        assert!(!accepted_round(&value, &frozen));
    }
    #[test]
    fn terminal_never_erases_an_unconfirmed_write() {
        let mut value = session("REVOKED");
        value.native_write_observation = Some(json!({"phase":"STARTED"}));
        assert!(terminal(&value));
        assert!(pending(&value));
    }
    #[test]
    fn late_zero_byte_outcomes_use_only_the_history_frozen_writer_evidence() {
        let mut value = session("UNKNOWN");
        for phase in ["FAILED", "CONFLICT"] {
            value.native_write_observation = Some(json!({"phase":phase,"bytesWritten":0}));
            let frozen = round(&value);
            assert_eq!(definite_zero_write_round(&value, &frozen), Some(phase));
            value.native_write_observation.as_mut().unwrap()["bytesWritten"] = json!(1);
            assert_eq!(definite_zero_write_round(&value, &round(&value)), None);
            assert_eq!(definite_zero_write_round(&value, &frozen), None);
        }
    }
}
