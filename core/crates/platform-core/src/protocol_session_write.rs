//! 18 §5.4: native writer evidence belongs to its original ProtocolSession.
//! A receipt is not permission to write, a revision query or a replay command.
use super::*;

fn fields(value: &Value) -> Result<(&str, &str, i64), Refusal> {
    let typed: contracts::ProtocolWriteObservation =
        serde_json::from_value(value.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(typed).map_err(|_| invalid())? != *value {
        return Err(invalid());
    }
    let phase = value["phase"].as_str().ok_or_else(invalid)?;
    let correlation = value["correlationRef"]
        .as_str()
        .filter(|s| !s.is_empty() && !s.chars().any(char::is_control))
        .ok_or_else(invalid)?;
    let bytes = value["bytesWritten"]
        .as_i64()
        .filter(|n| *n >= 0)
        .ok_or_else(invalid)?;
    let stamp = value["baseModifiedAt"]
        .as_str()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .ok_or_else(invalid)?;
    if stamp.timestamp_subsec_nanos() != 0
        || stamp.offset().local_minus_utc() != 0
        || value["editors"]
            .as_str()
            .is_none_or(|s| s.chars().any(char::is_control))
        || value.get("nativeEtag").is_some_and(|s| {
            s.as_str()
                .is_none_or(|s| s.is_empty() || s.chars().any(char::is_control))
        })
        || value.get("resultRevision").is_some_and(|s| {
            s.as_str()
                .is_none_or(|s| s.is_empty() || s.chars().any(char::is_control))
        })
    {
        return Err(invalid());
    }
    match phase {
        "STARTED" | "CONFLICT" | "FAILED"
            if bytes == 0
                && value.get("nativeEtag").is_none()
                && value.get("resultRevision").is_none() => {}
        "ACCEPTED"
            if value.get("nativeEtag").is_some() && value.get("resultRevision").is_some() => {}
        "UNKNOWN" if value.get("resultRevision").is_none() => (),
        _ => return Err(invalid()),
    }
    Ok((phase, correlation, bytes))
}

pub(crate) async fn observe(
    state: &ServiceState,
    ae: &Execution,
    session: &Session,
    operation: &str,
    evidence: &Value,
) -> Result<Value, Refusal> {
    let (phase, correlation, _) = fields(evidence)?;
    let native_ref = session.id.to_string();
    if ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "DISPATCHED"
        || session.native_session_ref.as_deref() != Some(native_ref.as_str())
        || (phase == "STARTED" && operation != "WRITE")
        || (phase != "STARTED" && operation != "OBSERVE")
    {
        return Err(denied());
    }
    // Only the before-writer callback fresh-admits update. Observing a known
    // native outcome after revocation cannot grant new permission or erase the
    // original side effect; it returns a receipt without authorization facts.
    if phase == "STARTED" {
        fresh_execution(state, ae).await?;
    }
    let refs = execution_refs(&state.pool, ae.id).await?;
    let mut tx = state.pool.begin().await?;
    let locked = crate::governance::lock_execution(&mut tx, ae.id).await?;
    if locked.gate_state != "ALLOWED"
        || locked.dispatch_state != "DISPATCHED"
        || refs.binding_id != session.application_binding_id
    {
        return Err(denied());
    }
    let current:Session=sqlx::query_as("select id,action_execution_id,application_binding_id,target,
        admitted_mode,base_revision,expires_at,state,version,native_session_ref,launch_theme,launch_locale,
        native_write_observation from admission.protocol_session where id=$1 and action_execution_id=$2 for update")
        .bind(session.id).bind(ae.id).fetch_optional(&mut *tx).await?.ok_or_else(denied)?;
    let previous = current.native_write_observation.as_ref();
    if phase != "STARTED" && previous == Some(evidence) {
        tx.commit().await?;
        return receipt(current.id, &current.state);
    }
    let next = if phase == "STARTED" {
        if current.admitted_mode != "EDIT"
            || current.expires_at <= Utc::now()
            || !matches!(current.state.as_str(), "OPEN" | "SAVED")
            || previous
                .is_some_and(|v| v["phase"] != "ACCEPTED" || v["correlationRef"] == correlation)
        {
            return Err(denied());
        }
        "DIRTY"
    } else {
        let previous = previous.ok_or_else(denied)?;
        if !matches!(current.state.as_str(), "DIRTY" | "UNKNOWN")
            || previous["correlationRef"] != correlation
            || previous["editors"] != evidence["editors"]
            || previous["baseModifiedAt"] != evidence["baseModifiedAt"]
            || !matches!(previous["phase"].as_str(), Some("STARTED" | "UNKNOWN"))
        {
            return Err(denied());
        }
        // UNKNOWN has no direct callback→success shortcut. Later confirmed
        // evidence is retained for the original reconcile workflow to query.
        if current.state == "UNKNOWN" {
            "UNKNOWN"
        } else {
            match phase {
                "ACCEPTED" => "SAVED",
                "UNKNOWN" => "UNKNOWN",
                "CONFLICT" => "CONFLICT",
                "FAILED" => "FAILED",
                _ => return Err(invalid()),
            }
        }
    };
    sqlx::query("update admission.protocol_session set state=$2,last_native_correlation_ref=$3,
        native_write_observation=$4,result_revision=case when $2='SAVED' then $4->>'resultRevision' else result_revision end,
        version=version+1,updated_at=now() where id=$1")
        .bind(current.id).bind(next).bind(correlation).bind(evidence).execute(&mut *tx).await?;
    tx.commit().await?;
    if next == "UNKNOWN" {
        // A lost Start acknowledgement is recovered from this same stored
        // input by the normal tick; it never creates a second save or Workflow.
        if let Err(error) = reconcile::start(state, ae.id).await {
            tracing::warn!(protocol_session=%ae.id,reason_code=%crate::governance::wire(&error.reason()),
                "ProtocolSession reconcile Start remains unconfirmed");
        }
    }
    receipt(current.id, next)
}

fn receipt(id: Uuid, state: &str) -> Result<Value, Refusal> {
    let value: contracts::ProtocolWriteReceipt =
        serde_json::from_value(json!({"protocolSessionId":id,"state":state}))
            .map_err(|_| invalid())?;
    serde_json::to_value(value).map_err(|_| invalid())
}
