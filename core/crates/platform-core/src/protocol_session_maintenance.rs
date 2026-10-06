//! The original governance tick owns short-lived protocol expiry/withdrawal.
//! Normal open/save does not create a Workflow. Unconfirmed writes remain
//! UNKNOWN and are handled only by the original frozen reconcile reference.
use super::*;

fn pending(session: &Session) -> bool {
    session.state == "DIRTY"
        || session
            .native_write_observation
            .as_ref()
            .is_some_and(|value| matches!(value["phase"].as_str(), Some("STARTED" | "UNKNOWN")))
}

pub(super) async fn change(
    state: &ServiceState,
    ae: &Execution,
    session: &Session,
    next: &str,
) -> Result<(), Refusal> {
    let def = crate::governance::exact_definition_for_execution(&state.pool, ae).await?;
    let mut tx = state.pool.begin().await?;
    crate::governance::lock_execution(&mut tx, ae.id).await?;
    let changed = sqlx::query(
        "update admission.protocol_session set state=$2,
        admitted_mode=case when $2='READ_ONLY' then 'VIEW' else admitted_mode end,
        version=version+1,updated_at=now() where id=$1 and version=$3 and state=$4",
    )
    .bind(session.id)
    .bind(next)
    .bind(session.version)
    .bind(&session.state)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() == 1 {
        crate::governance::audit(
            &mut tx,
            ae,
            &def,
            &format!("protocol:{}:{next}", session.version),
            "SESSION",
            "ALLOW",
            next,
            None,
            Vec::new(),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub(super) async fn adapter(
    state: &ServiceState,
    ae: &Execution,
    session: &Session,
) -> Result<crate::application_binding::native::Adapter, Refusal> {
    let refs = execution_refs(&state.pool, ae.id).await?;
    let (service, instance, manifest): (String, String, Value) = sqlx::query_as(
        "select b.adapter_service_ref,
        b.native_instance_ref,r.manifest from catalog.application_binding b
        join catalog.component_release r on r.id=$3
        join projection.application_runtime p on p.binding_id=b.id and p.generation=$4
          and p.component_release_id=r.id and p.normalized_manifest_digest=r.manifest_digest
        where b.id=$1 and b.tenant_id=$2 and b.state in ('ACTIVE','DISABLING')",
    )
    .bind(session.application_binding_id)
    .bind(ae.tenant_id)
    .bind(refs.release_id)
    .bind(refs.generation)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(denied)?;
    crate::application_binding::native::Adapter::resolve(&service, &instance, &manifest)
}

pub(super) async fn revoke(
    state: &ServiceState,
    ae: &Execution,
    session: &Session,
) -> Result<(), Refusal> {
    if ae.dispatch_state == "NOT_DISPATCHED" || native_absence_confirmed(&state.pool, ae).await? {
        return Ok(());
    }
    let args = json!({"protocolSessionId":session.id,"nativeObjectRef":session.target["nativeObjectRef"],
        "idempotencyKey":session.id});
    let value = adapter(state, ae, session)
        .await?
        .call(state, ae, "cancel", session.id, &args)
        .await?;
    let typed: contracts::AdapterProtocolSessionLifecycleResponse =
        serde_json::from_value(value.clone()).map_err(|_| unknown())?;
    if serde_json::to_value(typed).map_err(|_| unknown())? != value
        || value["protocolSessionId"] != json!(session.id)
        || value["nativeObjectRef"] != session.target["nativeObjectRef"]
        || value["nativeState"] != "ABSENT"
        || value.get("nativeSessionRef").is_some()
        || value.get("expiresAt").is_some()
    {
        return Err(unknown());
    }
    let def = crate::governance::exact_definition_for_execution(&state.pool, ae).await?;
    let mut tx = state.pool.begin().await?;
    crate::governance::lock_execution(&mut tx, ae.id).await?;
    let terminal:bool=sqlx::query_scalar("select exists(select 1 from admission.protocol_session s
        join catalog.application_binding b on b.id=s.application_binding_id and b.tenant_id=s.tenant_id
        where s.id=$1 and s.action_execution_id=$1
          and (s.state in ('CLOSED','EXPIRED','REVOKED','FAILED') or b.state='DISABLING'))")
        .bind(ae.id).fetch_one(&mut *tx).await?;
    if !terminal {
        return Err(denied());
    }
    // Original stable audit evidence closes the native ref without a new
    // token table, a secret or repeated revocation once absence was confirmed.
    crate::governance::audit(
        &mut tx,
        ae,
        &def,
        "protocol-pat-revoked",
        "REVOCATION",
        "ALLOW",
        "NATIVE_ABSENCE_CONFIRMED",
        None,
        Vec::new(),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

async fn native_absence_confirmed(pool: &sqlx::PgPool, ae: &Execution) -> Result<bool, Refusal> {
    Ok(sqlx::query_scalar("select exists(select 1 from audit.audit_event e
        where e.event_key=$1::text||':protocol-pat-revoked' and e.operation_id=$1
          and e.tenant_id=$2 and e.workspace_id is not distinct from $3
          and e.action_key=$4 and e.action_version=$5 and e.target_id=$6 and e.parameter_hash=$7
          and e.actor_principal_id=$8 and e.initiator_principal_id=$9
          and e.event_type='REVOCATION' and e.decision='ALLOW' and e.result_code='NATIVE_ABSENCE_CONFIRMED')")
        .bind(ae.operation_id).bind(ae.tenant_id).bind(ae.workspace_id).bind(&ae.action_key)
        .bind(ae.action_version).bind(ae.target_id).bind(&ae.parameter_hash)
        .bind(ae.actor_principal_id).bind(ae.initiator_principal_id).fetch_one(pool).await?)
}

pub(crate) async fn binding_pending(
    conn: &mut sqlx::PgConnection,
    id: Uuid,
) -> Result<bool, Refusal> {
    Ok(sqlx::query_scalar("select exists(select 1 from admission.protocol_session s
        join admission.action_execution a on a.id=s.action_execution_id and a.operation_id=s.operation_id
        where s.application_binding_id=$1 and (s.state not in ('CLOSED','EXPIRED','REVOKED','FAILED')
          or s.native_write_observation->>'phase' in ('STARTED','UNKNOWN')
          or (a.dispatch_state in ('UNKNOWN','DISPATCHED') and not exists(select 1 from audit.audit_event e
            where e.event_key=a.operation_id::text||':protocol-pat-revoked' and e.operation_id=a.operation_id
              and e.tenant_id=a.tenant_id and e.workspace_id is not distinct from a.workspace_id
              and e.action_key=a.action_key and e.action_version=a.action_version and e.target_id=a.target_id
              and e.parameter_hash=a.parameter_hash and e.actor_principal_id=a.actor_principal_id
              and e.initiator_principal_id=a.initiator_principal_id and e.event_type='REVOCATION'
              and e.decision='ALLOW' and e.result_code='NATIVE_ABSENCE_CONFIRMED'))))")
        .bind(id).fetch_one(conn).await?)
}

fn withdrawal_state(session: &Session) -> Option<&'static str> {
    if session.state == "UNKNOWN"
        || matches!(
            session.state.as_str(),
            "CLOSED" | "EXPIRED" | "REVOKED" | "FAILED"
        )
    {
        None
    } else if pending(session) {
        Some("UNKNOWN")
    } else if session.state == "CONFLICT" {
        Some("FAILED")
    } else {
        Some("REVOKED")
    }
}

/// The original binding disable waits for both writer outcome and native PAT
/// absence. It never stops the SERVICE principal before cleanup can finish.
pub(crate) async fn drain_binding(state: &ServiceState, binding: Uuid) -> Result<bool, Refusal> {
    let ids: Vec<Uuid> = sqlx::query_scalar("select s.id from admission.protocol_session s
        join catalog.application_binding b on b.id=s.application_binding_id and b.tenant_id=s.tenant_id
        where b.id=$1 and b.state='DISABLING' order by s.id")
        .bind(binding).fetch_all(&state.pool).await?;
    for id in ids {
        let ae = crate::governance::load_execution(&state.pool, id)
            .await?
            .ok_or_else(denied)?;
        let mut session = launch::load(&state.pool, id).await?.ok_or_else(denied)?;
        if let Some(next) = withdrawal_state(&session) {
            change(state, &ae, &session, next).await?;
            session = launch::load(&state.pool, id).await?.ok_or_else(denied)?;
        }
        if session.state == "UNKNOWN" {
            reconcile::start(state, id).await?;
        }
        revoke(state, &ae, &session).await?;
    }
    let mut conn = state.pool.acquire().await?;
    Ok(!binding_pending(&mut conn, binding).await?)
}

async fn once(state: &ServiceState, id: Uuid) -> Result<(), Refusal> {
    let ae = crate::governance::load_execution(&state.pool, id)
        .await?
        .ok_or_else(denied)?;
    let mut session = launch::load(&state.pool, id).await?.ok_or_else(denied)?;
    if !matches!(
        session.state.as_str(),
        "CLOSED" | "EXPIRED" | "REVOKED" | "FAILED" | "UNKNOWN"
    ) {
        if session.expires_at <= Utc::now() {
            let next = if pending(&session) {
                "UNKNOWN"
            } else if session.state == "CONFLICT" {
                "FAILED"
            } else {
                "EXPIRED"
            };
            change(state, &ae, &session, next).await?;
        } else if matches!(session.state.as_str(), "OPEN" | "SAVED" | "READ_ONLY") {
            match fresh_mode_execution(state, &ae, false).await {
                Ok(_) => {
                    if session.admitted_mode == "EDIT" {
                        let update = permission(
                            &state.governance,
                            if session.target.get("assetId").is_some() {
                                "asset"
                            } else {
                                "resource"
                            },
                            ae.target_id,
                            ae.actor_principal_id,
                            "update",
                        )
                        .await?;
                        if !update.0 {
                            change(state, &ae, &session, "READ_ONLY").await?;
                        }
                    }
                }
                // Only a definite fresh refusal withdraws access. Unavailable
                // authorization/quota evidence is never guessed as revocation.
                Err(Refusal::Denied(_)) => change(state, &ae, &session, "REVOKED").await?,
                Err(error) => return Err(error),
            }
        }
        session = launch::load(&state.pool, id).await?.ok_or_else(denied)?;
    }
    if matches!(
        session.state.as_str(),
        "CLOSED" | "EXPIRED" | "REVOKED" | "FAILED"
    ) {
        revoke(state, &ae, &session).await?;
    } else if session.state == "UNKNOWN" {
        reconcile::start(state, id).await?;
    }
    Ok(())
}

pub(crate) async fn reconcile(state: &ServiceState, batch: i64) -> Result<(), Refusal> {
    // Reuse the original fair AE attempt clock and configured batch. No cron,
    // new scheduler or independent cleanup state is created for protocol TTL.
    let ids:Vec<Uuid>=sqlx::query_scalar("with selected as (
        select a.id from admission.action_execution a join admission.protocol_session s on s.action_execution_id=a.id
        where s.state not in ('CLOSED','EXPIRED','REVOKED','FAILED') or
          (a.dispatch_state in ('UNKNOWN','DISPATCHED') and not exists(select 1 from audit.audit_event e
            where e.event_key=a.operation_id::text||':protocol-pat-revoked'
              and e.operation_id=a.operation_id and e.result_code='NATIVE_ABSENCE_CONFIRMED'))
        order by coalesce(a.reconcile_last_attempt_at,s.created_at),a.id limit $1 for update of a skip locked)
        update admission.action_execution a set reconcile_last_attempt_at=now()
          from selected where a.id=selected.id returning a.id")
        .bind(batch).fetch_all(&state.pool).await?;
    for id in ids {
        if let Err(error) = once(state, id).await {
            tracing::warn!(protocol_session=%id,reason_code=%crate::governance::wire(&error.reason()),
                "ProtocolSession original reference has not converged; no native write is retried");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn binding_withdrawal_never_erases_a_pending_write() {
        let mut value = super::super::reconcile::tests::session("DIRTY");
        value.native_write_observation = Some(json!({"phase":"STARTED"}));
        assert_eq!(withdrawal_state(&value), Some("UNKNOWN"));
        value.state = "UNKNOWN".into();
        value.native_write_observation = Some(json!({"phase":"ACCEPTED"}));
        assert_eq!(withdrawal_state(&value), None);
        value.state = "SAVED".into();
        assert_eq!(withdrawal_state(&value), Some("REVOKED"));
        value.state = "CONFLICT".into();
        assert_eq!(withdrawal_state(&value), Some("FAILED"));
    }
}
