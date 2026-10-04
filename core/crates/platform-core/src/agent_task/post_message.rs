//! DD-107 POST_MESSAGE, on the original AgentTask/Invocation. No Codex RPC,
//! model trace, CapacityLease or stored message body is produced here.
use super::*;
use crate::{audit::Evidence, governance::Refusal};
use chrono::{DateTime, Utc};
use collab_bridge::bridge::{Custody, Delivery, IdentityClient};
use contracts::ReasonCode;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct Intent {
    created_at: DateTime<Utc>,
    customer_id: String,
    namespace: String,
    subject: String,
    binding_version: i32,
    meter: crate::openmeter::InvocationMeter,
}

fn unknown() -> Refusal {
    Refusal::Unavailable("Template publication evidence unavailable".into())
}

async fn activity_fence(
    state: &ServiceState,
    invocation: &Invocation,
    input: &AgentTaskAdvanceRequest,
    allow_cancel: bool,
) -> Result<bool, Refusal> {
    let observed = state
        .temporal
        .activity(&invocation.workflow_id, &input.run_id, &input.activity_id)
        .await
        .map_err(|_| unknown())?;
    let attempt = i32::try_from(input.attempt).map_err(|_| unknown())?;
    if !activity_current(
        &observed,
        invocation.id,
        invocation.projection_generation,
        attempt,
        Utc::now(),
        allow_cancel,
    ) {
        return Err(unknown());
    }
    Ok(observed.workflow_cancel_requested)
}

pub(super) async fn advance(
    state: &ServiceState,
    invocation: &Invocation,
    input: &AgentTaskAdvanceRequest,
) -> Response {
    match execute(state, invocation, input).await {
        Ok((status, reason)) => result(invocation.id, status, reason),
        Err(error) => {
            // Definite pre-publish refusal can close only the still CREATED
            // invocation. An already frozen event is always observed, not retried.
            if definite_reply_refusal(&error)
                && matches!(
                    fail_before_dispatch(state, invocation, &error).await,
                    Ok(true)
                )
            {
                return result(
                    invocation.id,
                    TaskStatus::Failed,
                    &crate::governance::wire(&error.reason()),
                );
            }
            result(
                invocation.id,
                TaskStatus::Running,
                "UNKNOWN_EXTERNAL_RESULT",
            )
        }
    }
}

async fn execute(
    state: &ServiceState,
    invocation: &Invocation,
    input: &AgentTaskAdvanceRequest,
) -> Result<(TaskStatus, &'static str), Refusal> {
    let cancel = activity_fence(state, invocation, input, true).await?
        || input.cancel_requested
        || invocation.cancel_pending;
    match invocation.status.as_str() {
        "COMPLETED" => return Ok((TaskStatus::Completed, "NONE")),
        "FAILED" => return Ok((TaskStatus::Failed, "NONE")),
        "CANCELED" => return Ok((TaskStatus::Canceled, "NONE")),
        "CREATED" | "DISPATCHING" | "RUNNING" | "UNKNOWN" => (),
        _ => return Err(unknown()),
    }
    if invocation.runtime_turn_id.is_some() || invocation.native_status.is_some() {
        return Err(unknown());
    }
    if cancel {
        sqlx::query(
            "update catalog.agent_invocation set cancel_pending=true,updated_at=now()
            where id=$1 and status in ('CREATED','DISPATCHING','RUNNING','UNKNOWN')",
        )
        .bind(invocation.id)
        .execute(&state.pool)
        .await?;
        if cancel_before_dispatch(state, invocation).await? {
            return Ok((TaskStatus::Canceled, "NONE"));
        }
    }
    let event = match invocation.reply_event_id.as_deref() {
        Some(event) => event.to_owned(),
        None if !cancel && invocation.status == "CREATED" => {
            publish(state, invocation, input).await?
        }
        None => return Err(unknown()),
    };
    match reconcile_reply(state, invocation, None, &event).await? {
        Some(false) => finish(state, invocation, &event, None, TaskStatus::Failed).await,
        Some(true) => {
            let id = record_count(state, invocation, &event).await?;
            if !crate::gateway_usage::settle_events(&state.pool, &[id], &state.openmeter)
                .await
                .map_err(|_| unknown())?
            {
                return Ok((TaskStatus::Running, "BILLING_UNAVAILABLE"));
            }
            finish(state, invocation, &event, Some(id), TaskStatus::Completed).await
        }
        None => Ok((TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT")),
    }
}

async fn fail_before_dispatch(
    state: &ServiceState,
    invocation: &Invocation,
    refusal: &Refusal,
) -> Result<bool, Refusal> {
    let mut tx = state.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, invocation.action_execution_id).await?;
    sqlx::query("select id from identity.tenant where id=$1 for no key update")
        .bind(invocation.tenant_id)
        .fetch_one(&mut *tx)
        .await?;
    let changed = sqlx::query(
        "update catalog.agent_invocation set status='FAILED',updated_at=now()
        where id=$1 and status='CREATED' and action_execution_id=$2 and reply_event_id is null
        and post_message_intent is null and runtime_turn_id is null and native_status is null",
    )
    .bind(invocation.id)
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Ok(false);
    }
    let def =
        crate::governance::exact_definition(&state.pool, &ae.action_key, ae.action_version).await?;
    state
        .governance
        .record_automation_decision(&mut tx, &ae, &def, "RECHECK", Err(refusal))
        .await?;
    turn_audit(
        state,
        &mut tx,
        &ae,
        invocation.id,
        ("post-message:refused", "OUTCOME", "NOT_DELIVERED"),
        vec![Evidence::new(EvidenceKind::ActionExecutionId, ae.id)],
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

async fn current_meter(
    state: &ServiceState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    invocation: &Invocation,
    created_at: DateTime<Utc>,
) -> Result<Intent, Refusal> {
    let (customer, namespace, prefix, version): (String, String, String, i32) = sqlx::query_as(
        "select customer_id,namespace,subject_key_prefix,version from projection.openmeter_binding
         where tenant_id=$1 and status='ACTIVE' for share",
    )
    .bind(invocation.tenant_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(unknown)?;
    if namespace != state.openmeter.namespace() {
        return Err(unknown());
    }
    let subject = format!("{prefix}{}", invocation.installation_resource_id);
    let meter = state
        .openmeter
        .message_meter(invocation.tenant_id, &customer, &subject)
        .await
        .map_err(|_| unknown())?;
    Ok(Intent {
        created_at,
        customer_id: customer,
        namespace,
        subject,
        binding_version: version,
        meter,
    })
}

async fn publish(
    state: &ServiceState,
    invocation: &Invocation,
    input: &AgentTaskAdvanceRequest,
) -> Result<String, Refusal> {
    activity_fence(state, invocation, input, false).await?;
    crate::service_api::audit_gate(state)
        .await
        .map_err(|_| unknown())?;
    let mut tx = state.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, invocation.action_execution_id).await?;
    sqlx::query("select id from identity.tenant where id=$1 for no key update")
        .bind(invocation.tenant_id)
        .fetch_one(&mut *tx)
        .await?;
    let (text, binding, revision) =
        crate::automation::fresh_post_message(state, &mut tx, invocation.id, None).await?;
    if binding.agent_locator
        != state.secrets.tenant_locator(
            invocation.tenant_id,
            &format!(
                "buzz-agent/installation/{}",
                invocation.installation_resource_id
            ),
        )
        || binding.agent_audience != state.secret_audience
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let keys = crate::server_identity::read_bound_keys(
        &state.secrets,
        &secret_store::SecretRef {
            locator: binding.agent_locator.clone(),
            version: u32::try_from(binding.agent_secret_version).map_err(|_| unknown())?,
            audience: binding.agent_audience.clone(),
        },
        &binding.agent_pubkey,
    )
    .await
    .map_err(|_| unknown())?;
    let client = IdentityClient::new(
        Custody::Server,
        &keys.secret_key().to_secret_hex(),
        &state.relay_transport,
        &binding.normalized_host,
    )
    .map_err(|_| unknown())?;
    let transport = reqwest::Url::parse(&state.relay_transport).map_err(|_| unknown())?;
    let nip11 =
        collab_bridge::limits::fetch_nip11(&state.http, &transport, &binding.normalized_host)
            .await
            .map_err(|_| unknown())?;
    if nip11.digest != binding.nip11_snapshot_digest {
        return Err(Refusal::Precondition(ReasonCode::BindingNotActive));
    }
    let created_at = DateTime::from_timestamp(Utc::now().timestamp(), 0).ok_or_else(unknown)?;
    let intent = current_meter(state, &mut tx, invocation, created_at).await?;
    let event = client
        .sign_channel_result_at(
            &binding.channel_id.to_string(),
            &text,
            reply_ancestry(invocation),
            (invocation.source_kind == "SCHEDULE").then_some(invocation.id),
            u64::try_from(created_at.timestamp()).map_err(|_| unknown())?,
        )
        .map_err(|_| unknown())?;
    let event_id = event.id.to_hex();
    let admitted = client.admit().map_err(|_| unknown())?;
    let metadata = serde_json::to_value(&intent).map_err(|_| unknown())?;
    let changed=sqlx::query("update catalog.agent_invocation set reply_event_id=$2,post_message_intent=$3,
        status='DISPATCHING',updated_at=now() where id=$1 and status='CREATED' and not cancel_pending
        and reply_event_id is null and post_message_intent is null and runtime_turn_id is null and native_status is null")
        .bind(invocation.id).bind(&event_id).bind(&metadata).execute(&mut *tx).await?;
    if changed.rows_affected() != 1 {
        return Err(unknown());
    }
    let evidence = vec![
        Evidence::new(EvidenceKind::ActionExecutionId, ae.id),
        Evidence::new(EvidenceKind::BuzzEventId, &event_id),
        Evidence::new(EvidenceKind::BuzzPubkey, &binding.agent_pubkey),
        Evidence::new(EvidenceKind::SpicedbZedtoken, revision),
        Evidence::new(EvidenceKind::TemporalWorkflowId, &invocation.workflow_id),
        Evidence::new(EvidenceKind::TemporalRunId, &input.run_id),
    ];
    turn_audit(
        state,
        &mut tx,
        &ae,
        invocation.id,
        (
            &format!("reply:{event_id}:dispatch"),
            "DISPATCH",
            "DISPATCHED",
        ),
        evidence.clone(),
    )
    .await?;
    tx.commit().await?;
    // Only this call won the intent CAS. Subsequent Activity attempts can only
    // query its stable ID, including a crash before the one deliver call.
    let prepared = async {
        activity_fence(state, invocation, input, false).await?;
        let mut guard = state.pool.begin().await?;
        crate::governance::lock_execution(&mut guard, ae.id).await?;
        sqlx::query("select id from identity.tenant where id=$1 for no key update")
            .bind(invocation.tenant_id)
            .fetch_one(&mut *guard)
            .await?;
        if current_meter(state, &mut guard, invocation, created_at).await? != intent {
            return Err(unknown());
        }
        let (current_text, current_binding, _) = crate::automation::fresh_post_message(
            state,
            &mut guard,
            invocation.id,
            Some(&event_id),
        )
        .await?;
        if current_binding != binding || current_text != text {
            return Err(unknown());
        }
        Ok::<_, Refusal>(guard)
    }
    .await;
    let mut guard = match prepared {
        Ok(guard) => guard,
        Err(error) => {
            // This live sender has not entered deliver. Dependency uncertainty
            // cannot erase that local no-dispatch proof. If persisting the proof
            // fails, recovery still keeps the durable intent UNKNOWN.
            let mut tx = state.pool.begin().await?;
            crate::governance::lock_execution(&mut tx, ae.id).await?;
            turn_audit(
                state,
                &mut tx,
                &ae,
                invocation.id,
                (
                    &format!("reply:{event_id}:outcome"),
                    "OUTCOME",
                    "NOT_DELIVERED",
                ),
                evidence,
            )
            .await?;
            tx.commit().await?;
            return Err(error);
        }
    };
    let outcome = match client.deliver(&state.http, &event, admitted).await {
        Delivery::Accepted => Some("ACCEPTED"),
        Delivery::Rejected(_) => Some("REJECTED"),
        Delivery::Limited(_, _) => Some("NOT_DELIVERED"),
        Delivery::Unknown(_) => None,
    };
    if let Some(outcome) = outcome {
        turn_audit(
            state,
            &mut guard,
            &ae,
            invocation.id,
            (&format!("reply:{event_id}:outcome"), "OUTCOME", outcome),
            evidence,
        )
        .await?;
    }
    guard.commit().await?;
    Ok(event_id)
}

async fn record_count(
    state: &ServiceState,
    invocation: &Invocation,
    event: &str,
) -> Result<Uuid, Refusal> {
    let mut tx = state.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, invocation.action_execution_id).await?;
    let (raw, automation_resource_id): (Value, Uuid) = sqlx::query_as(
        "select post_message_intent,automation_resource_id from catalog.agent_invocation
        where id=$1 and reply_event_id=$2 and action_execution_id=$3 for update",
    )
    .bind(invocation.id)
    .bind(event)
    .bind(ae.id)
    .fetch_one(&mut *tx)
    .await?;
    let intent: Intent = serde_json::from_value(raw).map_err(|_| unknown())?;
    let id = Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!(
            "{}:AGENT_INVOCATION:{}:automation.run",
            invocation.tenant_id, invocation.id
        )
        .as_bytes(),
    );
    let dimensions = json!({"tenant_id":invocation.tenant_id,"workspace_id":invocation.workspace_id,"operation_id":ae.operation_id,
        "agent_installation_resource_id":invocation.installation_resource_id,"agent_version_asset_id":invocation.agent_version_asset_id,
        "automation_resource_id":automation_resource_id,"buzz_event_id":event});
    let cloud = json!({"specversion":"1.0","id":id,"source":"urn:platform:core:usage","type":intent.meter.event_type,
        "subject":intent.subject,"time":intent.created_at,"datacontenttype":"application/json","data":dimensions});
    sqlx::query("insert into outbox.usage_event(id,invocation_id,operation_id,tenant_id,workspace_id,openmeter_customer_id,
        openmeter_namespace,agent_installation_resource_id,source_type,source_id,meter_key,subject_key,quantity,occurred_at,
        dimensions,openmeter_event_id,event,settlement_status)
        values($1,$2,$3,$4,$5,$6,$7,$8,'AGENT_INVOCATION',$2,'automation.run',$9,1,$10,$11,$1,$12,'PENDING_PUBLISH')
        on conflict(tenant_id,source_type,source_id,meter_key) do nothing")
        .bind(id).bind(invocation.id).bind(ae.operation_id).bind(invocation.tenant_id).bind(invocation.workspace_id)
        .bind(intent.customer_id).bind(intent.namespace).bind(invocation.installation_resource_id).bind(intent.subject)
        .bind(intent.created_at).bind(dimensions).bind(&cloud).execute(&mut *tx).await?;
    let actual: (Uuid, Value) = sqlx::query_as(
        "select id,event from outbox.usage_event where tenant_id=$1
        and source_type='AGENT_INVOCATION' and source_id=$2 and meter_key='automation.run'",
    )
    .bind(invocation.tenant_id)
    .bind(invocation.id)
    .fetch_one(&mut *tx)
    .await?;
    if actual != (id, cloud) {
        return Err(unknown());
    }
    turn_audit(
        state,
        &mut tx,
        &ae,
        invocation.id,
        (
            &format!("usage:{id}:prepared"),
            "RECONCILIATION",
            "PENDING_PUBLISH",
        ),
        vec![
            Evidence::new(EvidenceKind::UsageEventId, id),
            Evidence::new(EvidenceKind::BuzzEventId, event),
        ],
    )
    .await?;
    tx.commit().await?;
    Ok(id)
}

async fn finish(
    state: &ServiceState,
    invocation: &Invocation,
    event: &str,
    usage: Option<Uuid>,
    status: TaskStatus,
) -> Result<(TaskStatus, &'static str), Refusal> {
    let mut tx = state.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, invocation.action_execution_id).await?;
    let mut evidence = vec![Evidence::new(EvidenceKind::BuzzEventId, event)];
    if let Some(id) = usage {
        let committed: bool = sqlx::query_scalar(
            "select exists(select 1 from outbox.usage_event where id=$1
            and invocation_id=$2 and operation_id=$3 and tenant_id=$4 and workspace_id=$5
            and settlement_status='COMMITTED' and stored_at is not null)",
        )
        .bind(id)
        .bind(invocation.id)
        .bind(ae.operation_id)
        .bind(invocation.tenant_id)
        .bind(invocation.workspace_id)
        .fetch_one(&mut *tx)
        .await?;
        if !committed {
            return Err(unknown());
        }
        evidence.push(Evidence::new(EvidenceKind::UsageEventId, id));
        evidence.push(Evidence::new(EvidenceKind::OpenmeterEventId, id));
    } else if status == TaskStatus::Completed {
        return Err(unknown());
    }
    let terminal = crate::governance::wire(&status);
    let changed = sqlx::query(
        "update catalog.agent_invocation set status=$3,updated_at=now()
        where id=$1 and reply_event_id=$2 and status in ('DISPATCHING','RUNNING','UNKNOWN')
        and post_message_intent is not null and runtime_turn_id is null and native_status is null",
    )
    .bind(invocation.id)
    .bind(event)
    .bind(&terminal)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(unknown());
    }
    turn_audit(
        state,
        &mut tx,
        &ae,
        invocation.id,
        ("post-message:terminal", "OUTCOME", &terminal),
        evidence,
    )
    .await?;
    tx.commit().await?;
    Ok((status, "NONE"))
}

#[cfg(test)]
mod post_message_tests {
    use super::*;

    #[test]
    fn frozen_intent_contains_only_exact_native_meter_metadata() {
        let raw = json!({"created_at":"2026-10-04T00:00:00Z", "customer_id":"fixture",
            "namespace":"fixture", "subject":"fixture:installation", "binding_version":1,
            "meter":{"key":"automation.run","id":"native-count","event_type":"run"}});
        let decoded: Intent = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(serde_json::to_value(decoded).unwrap(), raw);
        for field in ["body", "model_trace_id", "native_turn_id"] {
            let mut bad = raw.clone();
            bad[field] = json!("not an intent field");
            assert!(serde_json::from_value::<Intent>(bad).is_err());
        }
    }
}
