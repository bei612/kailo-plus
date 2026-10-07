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

pub(super) enum SequenceProgress {
    Legacy,
    Ready(usize),
    Waiting,
    Advanced,
    Terminal(TaskStatus),
}

pub(super) async fn sequence_progress(
    state: &ServiceState,
    invocation: &Invocation,
    input: &AgentTaskAdvanceRequest,
) -> Result<SequenceProgress, Refusal> {
    let (action, events): (Value, Vec<String>) = sqlx::query_as(
        "select v.action,i.automation_step_event_ids from catalog.agent_invocation i
         join catalog.automation_version v on v.asset_id=i.automation_version_asset_id
         and v.automation_resource_id=i.automation_resource_id where i.id=$1",
    )
    .bind(invocation.id)
    .fetch_one(&state.pool)
    .await?;
    if !crate::automation::steps::is_sequence(&action) {
        return Ok(SequenceProgress::Legacy);
    }
    crate::automation::steps::message_step(&action, events.len())?;
    let cancel = activity_fence(state, invocation, input, true).await?
        || input.cancel_requested
        || invocation.cancel_pending;
    if let Some(event) = events.last() {
        let accepted: bool = sqlx::query_scalar("select catalog.automation_step_accepted($1,$2)")
            .bind(invocation.id)
            .bind(event)
            .fetch_one(&state.pool)
            .await?;
        if !accepted {
            match reconcile_reply(state, invocation, None, event).await? {
                Some(true) if !cancel => return Ok(SequenceProgress::Advanced),
                Some(true) => (),
                Some(false) => {
                    finish_partial(state, invocation, &events, TaskStatus::Failed).await?;
                    return Ok(SequenceProgress::Terminal(TaskStatus::Failed));
                }
                None => return Ok(SequenceProgress::Waiting),
            }
        }
    }
    if cancel && !events.is_empty() {
        finish_partial(state, invocation, &events, TaskStatus::Canceled).await?;
        return Ok(SequenceProgress::Terminal(TaskStatus::Canceled));
    }
    Ok(SequenceProgress::Ready(events.len()))
}

/// Earlier accepted effects remain visible and referenced. Cancellation/refusal
/// stops only later writes; it never describes a partial run as rolled back.
async fn finish_partial(
    state: &ServiceState,
    invocation: &Invocation,
    expected_events: &[String],
    status: TaskStatus,
) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, invocation.action_execution_id).await?;
    let events: Vec<String> = sqlx::query_scalar(
        "select automation_step_event_ids from catalog.agent_invocation
        where id=$1 and automation_step_event_ids=$2 and reply_event_id is null
        and status in ('DISPATCHING','UNKNOWN') for update",
    )
    .bind(invocation.id)
    .bind(expected_events)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(unknown)?;
    if events.is_empty() {
        return Err(unknown());
    }
    let terminal = crate::governance::wire(&status);
    let evidence = events
        .iter()
        .map(|event| Evidence::new(EvidenceKind::BuzzEventId, event))
        .collect();
    turn_audit(
        state,
        &mut tx,
        &ae,
        invocation.id,
        ("message-sequence:terminal", "OUTCOME", &terminal),
        evidence,
    )
    .await?;
    sqlx::query("update catalog.agent_invocation set status=$2,cancel_pending=cancel_pending or $3,updated_at=now() where id=$1")
        .bind(invocation.id).bind(terminal).bind(status == TaskStatus::Canceled).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

/// Read template input only after the ordinary automation/source admission.
/// The signed output event ID freezes the expanded bytes before dispatch;
/// recovery observes that event and never expands or sends it a second time.
async fn native_template(
    state: &ServiceState,
    invocation: &Invocation,
    channel: Uuid,
    template: &str,
    expected_author: Option<&str>,
    action_kind: &str,
) -> Result<String, Refusal> {
    if !template.contains("{{") {
        return render_native_content(template, &Default::default(), action_kind);
    }
    let mut context = collab_bridge::workflow_template::TriggerContext {
        channel_id: channel.to_string(),
        ..Default::default()
    };
    match invocation.source_kind.as_str() {
        "BUZZ_EVENT" => {
            let expected_author =
                expected_author.ok_or(Refusal::Denied(ReasonCode::ScopeGuardFailed))?;
            let (control, _) = crate::tenant_lifecycle::control_client(
                state,
                invocation.tenant_id,
                crate::tenant_lifecycle::ProjectionDirection::Establish,
            )
            .await
            .map_err(|_| unknown())?;
            let source = control
                .source_message(
                    &state.http,
                    &invocation.source_event_id,
                    &channel.to_string(),
                    &invocation.root_event_id,
                )
                .await
                .map_err(|_| unknown())?;
            if source.author != expected_author {
                return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
            }
            context.text = source.content;
            context.author = source.author;
            context.timestamp = source.timestamp.to_string();
            context.message_id = invocation.source_event_id.clone();
            context.is_reply = invocation.source_event_id != invocation.root_event_id;
        }
        "SCHEDULE" => {
            // The existing admission checked this frozen nominal timestamp.
            context.timestamp = DateTime::parse_from_rfc3339(&invocation.source_event_id)
                .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?
                .timestamp()
                .to_string();
        }
        // A governed manual run has no fabricated Relay author or message.
        "MANUAL" => {}
        _ => return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed)),
    }
    render_native_content(template, &context, action_kind)
}

fn render_native_content(
    template: &str,
    context: &collab_bridge::workflow_template::TriggerContext,
    action_kind: &str,
) -> Result<String, Refusal> {
    let content = collab_bridge::workflow_template::resolve_template(
        template,
        context,
        &std::collections::HashMap::new(),
    )
    .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let valid = match action_kind {
        "SET_CHANNEL_TOPIC_STEPS" => true,
        "ADD_REACTION_STEPS" => collab_bridge::bridge::valid_reaction(&content),
        "POST_MESSAGE" | "POST_MESSAGE_STEPS" => !content.trim().is_empty(),
        _ => false,
    };
    if !valid {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    Ok(content)
}

pub(super) async fn activity_fence(
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
    sequence_ordinal: Option<usize>,
) -> Response {
    match execute(state, invocation, input, sequence_ordinal).await {
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
    sequence_ordinal: Option<usize>,
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
        None if !cancel && (invocation.status == "CREATED" || sequence_ordinal.is_some()) => {
            let (event, final_effect) = publish(state, invocation, input, sequence_ordinal).await?;
            if !final_effect {
                // The next original Activity reconciles this event before timers
                // or the following effect. Never publish a second step here.
                return Ok((TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT"));
            }
            event
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
        where id=$1 and status in ('CREATED','DISPATCHING') and action_execution_id=$2 and reply_event_id is null
        and post_message_intent is null and runtime_turn_id is null and native_status is null
        and not exists(select 1 from unnest(automation_step_event_ids) e where not catalog.automation_step_accepted(id,e))",
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
    sequence_ordinal: Option<usize>,
) -> Result<(String, bool), Refusal> {
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
    let (action, binding, revision) =
        crate::automation::fresh_channel_action(state, &mut tx, invocation.id, None).await?;
    let sequence = crate::automation::steps::is_sequence(&action);
    let sequence_events: Vec<String> = sqlx::query_scalar(
        "select automation_step_event_ids from catalog.agent_invocation where id=$1",
    )
    .bind(invocation.id)
    .fetch_one(&mut *tx)
    .await?;
    if sequence && sequence_ordinal != Some(sequence_events.len()) {
        return Err(unknown());
    }
    let sequence_step = if sequence {
        Some(crate::automation::steps::message_step(
            &action,
            sequence_events.len(),
        )?)
    } else {
        None
    };
    let final_effect = !sequence
        || crate::automation::steps::message_step(&action, sequence_events.len() + 1).is_err();
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
    let timestamp = u64::try_from(created_at.timestamp()).map_err(|_| unknown())?;
    let action_kind = action["kind"].as_str().ok_or_else(unknown)?;
    let source_author = ae
        .parameters
        .as_ref()
        .and_then(|parameters| parameters["sourcePubkey"].as_str());
    let template = match action_kind {
        "ADD_REACTION_STEPS" => &action["emoji"],
        "SET_CHANNEL_TOPIC_STEPS" => &action["topic"],
        "POST_MESSAGE" | "POST_MESSAGE_STEPS" => {
            sequence_step.map_or(&action["template"], |step| &step["text"])
        }
        _ => return Err(unknown()),
    };
    let content = native_template(
        state,
        invocation,
        binding.channel_id,
        template.as_str().ok_or_else(unknown)?,
        source_author,
        action_kind,
    )
    .await?;
    let event = if action["kind"] == "ADD_REACTION_STEPS" {
        if invocation.source_kind != "BUZZ_EVENT" {
            return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
        }
        client.sign_reaction_at(&invocation.source_event_id, &content, timestamp)
    } else if action["kind"] == "SET_CHANNEL_TOPIC_STEPS" {
        client.sign_channel_topic_at(binding.channel_id, &content, timestamp)
    } else if let Some(step) = sequence_step {
        client.sign_workflow_step_result_at(
            &binding.channel_id.to_string(),
            &content,
            reply_ancestry(invocation),
            Uuid::new_v5(
                &invocation.id,
                step["id"].as_str().ok_or_else(unknown)?.as_bytes(),
            ),
            timestamp,
        )
    } else {
        client.sign_channel_result_at(
            &binding.channel_id.to_string(),
            &content,
            reply_ancestry(invocation),
            matches!(invocation.source_kind.as_str(), "SCHEDULE" | "MANUAL")
                .then_some(invocation.id),
            timestamp,
        )
    }
    .map_err(|_| unknown())?;
    let event_id = event.id.to_hex();
    let admitted = client.admit().map_err(|_| unknown())?;
    let metadata = serde_json::to_value(&intent).map_err(|_| unknown())?;
    let changed = if sequence {
        sqlx::query("update catalog.agent_invocation set automation_step_event_ids=array_append(automation_step_event_ids,$2),
         reply_event_id=case when $5 then $2 else null end,post_message_intent=case when $5 then $3::jsonb else null end,
         status='DISPATCHING',updated_at=now() where id=$1 and status in ('CREATED','DISPATCHING','UNKNOWN') and not cancel_pending
         and reply_event_id is null and post_message_intent is null and runtime_turn_id is null and native_status is null
         and automation_step_event_ids=$4 and not exists(select 1 from unnest(automation_step_event_ids) e where not catalog.automation_step_accepted(id,e))")
         .bind(invocation.id).bind(&event_id).bind(&metadata).bind(&sequence_events).bind(final_effect).execute(&mut *tx).await?
    } else {
        sqlx::query("update catalog.agent_invocation set reply_event_id=$2,post_message_intent=$3,
        status='DISPATCHING',updated_at=now() where id=$1 and status='CREATED' and not cancel_pending
        and reply_event_id is null and post_message_intent is null and runtime_turn_id is null and native_status is null")
        .bind(invocation.id).bind(&event_id).bind(&metadata).execute(&mut *tx).await?
    };
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
        let (current_action, current_binding, _) = crate::automation::fresh_channel_action(
            state,
            &mut guard,
            invocation.id,
            final_effect.then_some(event_id.as_str()),
        )
        .await?;
        if current_binding != binding || current_action != action {
            return Err(unknown());
        }
        if sequence {
            let current: Vec<String> = sqlx::query_scalar(
                "select automation_step_event_ids from catalog.agent_invocation where id=$1",
            )
            .bind(invocation.id)
            .fetch_one(&mut *guard)
            .await?;
            let mut expected = sequence_events.clone();
            expected.push(event_id.clone());
            if current != expected {
                return Err(unknown());
            }
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
    Ok((event_id, final_effect))
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
    fn native_message_expands_original_buzz_trigger_variables() {
        let context = collab_bridge::workflow_template::TriggerContext {
            text: "发布检查通过".into(),
            author: "author-reference".into(),
            channel_id: Uuid::new_v4().to_string(),
            timestamp: "1791352800".into(),
            message_id: "source-reference".into(),
            ..Default::default()
        };
        assert_eq!(
            render_native_content(
                "{{trigger.author}}: {{trigger.text | truncate(4)}} / {{trigger.message_id}} @ {{trigger.timestamp}}",
                &context,
                "POST_MESSAGE",
            ).unwrap(),
            "author-reference: 发布检查 / source-reference @ 1791352800",
        );
        assert_eq!(
            render_native_content("{{trigger.channel_id}}", &context, "POST_MESSAGE").unwrap(),
            context.channel_id,
        );
    }

    #[test]
    fn native_message_keeps_source_text_untrusted_and_nonrecursive() {
        let context = collab_bridge::workflow_template::TriggerContext {
            text: "{{trigger.author}}".into(),
            author: "must-not-be-expanded".into(),
            ..Default::default()
        };
        assert_eq!(
            render_native_content("{{trigger.text}}", &context, "POST_MESSAGE").unwrap(),
            "{{trigger.author}}"
        );
        assert_eq!(
            render_native_content("literal {{unknown.key}}", &context, "POST_MESSAGE").unwrap(),
            "literal {{unknown.key}}"
        );
    }

    #[test]
    fn native_message_refuses_invalid_filter_and_empty_expansion() {
        let context = collab_bridge::workflow_template::TriggerContext::default();
        for template in [
            "{{trigger.text}}",
            "{{trigger.text | truncate(no)}}",
            "{{trigger.text | unsupported}}",
        ] {
            assert!(matches!(
                render_native_content(template, &context, "POST_MESSAGE"),
                Err(Refusal::Precondition(ReasonCode::InvalidParameters))
            ));
        }
        assert_eq!(
            render_native_content("unchanged literal", &context, "POST_MESSAGE").unwrap(),
            "unchanged literal"
        );
    }

    #[test]
    fn native_topic_and_reaction_expand_original_buzz_trigger_templates() {
        let context = collab_bridge::workflow_template::TriggerContext {
            text: "👍".into(),
            author: "发布负责人".into(),
            ..Default::default()
        };
        assert_eq!(
            render_native_content(
                "{{trigger.author}}: {{trigger.text}}",
                &context,
                "SET_CHANNEL_TOPIC_STEPS"
            )
            .unwrap(),
            "发布负责人: 👍"
        );
        assert_eq!(
            render_native_content("{{trigger.text}}", &context, "ADD_REACTION_STEPS").unwrap(),
            "👍"
        );
        let empty = collab_bridge::workflow_template::TriggerContext::default();
        assert_eq!(
            render_native_content("{{trigger.text}}", &empty, "SET_CHANNEL_TOPIC_STEPS").unwrap(),
            ""
        );
        assert_eq!(
            render_native_content("", &empty, "SET_CHANNEL_TOPIC_STEPS").unwrap(),
            ""
        );
        for kind in ["SET_CHANNEL_TOPIC_STEPS", "ADD_REACTION_STEPS"] {
            assert!(
                render_native_content("{{trigger.text | unsupported}}", &context, kind).is_err()
            );
        }
        assert!(render_native_content("{{trigger.text}}", &empty, "ADD_REACTION_STEPS").is_err());
        let mut too_long = context.clone();
        // Derive the boundary from the same contract as the production signer.
        let schema: Value = serde_json::from_str(include_str!(
            "../../../../../contracts/domain/automation_step.schema.json"
        ))
        .unwrap();
        too_long.text =
            "👍".repeat(schema["properties"]["emoji"]["maxLength"].as_u64().unwrap() as usize + 1);
        assert!(
            render_native_content("{{trigger.text}}", &too_long, "ADD_REACTION_STEPS").is_err()
        );
        assert!(render_native_content("literal", &context, "UNKNOWN").is_err());
    }

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

    #[tokio::test]
    #[ignore = "requires disposable migrated AGENT_INVOKE_TEST_DATABASE_URL; all fixture facts roll back"]
    async fn ordered_message_guard_requires_same_operation_receipts_before_advancing() {
        let pool = sqlx::PgPool::connect(&std::env::var("AGENT_INVOKE_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        let tenant = crate::agent_task::receipt_tests::fixture(&mut tx).await;
        // Reuse the existing real Catalog fixture, not replacement tables or a
        // disabled trigger. Only original receipt evidence is injected here;
        // this is not a live Relay/SpiceDB/Temporal end-to-end verification.
        sqlx::raw_sql(&r#"DO $$
        DECLARE tenant uuid:='__TENANT__'; workspace uuid; installation uuid; agent uuid; owner uuid;
          version uuid; route uuid; resource uuid:=gen_random_uuid(); asset uuid:=gen_random_uuid();
          grant_id uuid:=gen_random_uuid(); grant_action uuid:=gen_random_uuid(); run_action uuid:=gen_random_uuid();
          invocation uuid:=gen_random_uuid();
        BEGIN
          SELECT i.workspace_id,i.resource_id,i.agent_principal_id,r.owner_principal_id,i.pinned_version_asset_id,p.model_route_resource_id
            INTO workspace,installation,agent,owner,version,route
            FROM catalog.agent_installation i JOIN catalog.resource r ON r.id=i.resource_id
            JOIN catalog.agent_runtime_projection p ON p.installation_resource_id=i.resource_id AND p.generation=1
            WHERE r.tenant_id=tenant ORDER BY i.resource_id LIMIT 1;
          INSERT INTO catalog.agent_runtime_projection(installation_resource_id,generation,agent_version_asset_id,runtime_profile_key,model_route_resource_id,gateway_resource_ids,effective_fields,config_hash,state)
            VALUES(installation,2,version,'session-dispatch-fixture',route,ARRAY[route],jsonb_build_array(jsonb_build_object('fieldKey','runtimeProfileKey','requestedValueHash',repeat('a',64),'effectiveValueHash',repeat('a',64),'reasonCode',NULL)),repeat('a',64),'ACTIVE');
          UPDATE catalog.agent_installation SET state='ACTIVE',active_projection_generation=2 WHERE resource_id=installation;
          UPDATE catalog.resource SET state='ACTIVE' WHERE id=installation;
          INSERT INTO catalog.agent_session(tenant_id,workspace_id,root_event_id,installation_resource_id,agent_version_asset_id,projection_generation,core_memory_state,status)
            VALUES(tenant,workspace,repeat('d',64),installation,version,2,'ABSENT','PENDING');
          INSERT INTO admission.action_execution(id,operation_id,tenant_id,workspace_id,action_key,action_version,initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id)
            VALUES(grant_action,gen_random_uuid(),tenant,workspace,'agent.delegation.grant',1,owner,owner,installation,repeat('a',64),'ALLOWED','DISPATCHED',gen_random_uuid());
          INSERT INTO admission.delegation_grant(id,tenant_id,workspace_id,grantor_principal_id,installation_resource_id,agent_principal_id,valid_from,expires_at,state,version,action_execution_id)
            VALUES(grant_id,tenant,workspace,owner,installation,agent,now(),now()+interval '1 day','ACTIVE',1,grant_action);
          INSERT INTO catalog.resource(id,tenant_id,type_key,home_workspace_id,owner_principal_id,component_type_key,native_type,native_id,state,version)
            VALUES(resource,tenant,'automation',workspace,owner,'core','automation',resource::text,'ACTIVE',1);
          INSERT INTO catalog.automation_definition(resource_id,workspace_id,executor_installation_resource_id,delegation_id,state,version)
            VALUES(resource,workspace,installation,grant_id,'DRAFT',1);
          INSERT INTO catalog.asset(id,tenant_id,resource_id,type_key,owner_principal_id,native_ref,state,version)
            VALUES(asset,tenant,resource,'automation.version',owner,asset::text,'DRAFT',1);
          INSERT INTO catalog.automation_version(asset_id,automation_resource_id,ordinal,trigger,action,result_target,config_hash,state)
            VALUES(asset,resource,1,'{"kind":"CHANNEL_MESSAGE"}',
              '{"kind":"POST_MESSAGE_STEPS","template":"third","stepsVersion":3,"steps":[{"id":"one","action":"send_message","text":"first"},{"id":"two","action":"send_message","text":"second"},{"id":"three","action":"send_message","text":"third"}]}',
              'TRIGGER_THREAD',repeat('a',64),'DRAFT');
          INSERT INTO admission.action_execution(id,operation_id,tenant_id,workspace_id,action_key,action_version,initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id)
            VALUES(run_action,gen_random_uuid(),tenant,workspace,'automation.run',1,owner,agent,resource,repeat('a',64),'ALLOWED','DISPATCHED',gen_random_uuid());
          INSERT INTO catalog.agent_invocation(id,tenant_id,workspace_id,root_event_id,source_event_id,installation_resource_id,agent_version_asset_id,projection_generation,action_execution_id,workflow_id,status,delegation_id,automation_resource_id,automation_version_asset_id)
            VALUES(invocation,tenant,workspace,repeat('d',64),repeat('e',64),installation,version,2,run_action,'sequence-fixture:'||invocation,'CREATED',grant_id,resource,asset);
        END $$;"#.replace("__TENANT__", &tenant.to_string())).execute(&mut *tx).await.unwrap();
        let (invocation, action): (Uuid, Uuid) = sqlx::query_as("select id,action_execution_id from catalog.agent_invocation where tenant_id=$1 and automation_resource_id is not null")
            .bind(tenant).fetch_one(&mut *tx).await.unwrap();
        let first = "a".repeat(64);
        let second = "b".repeat(64);
        let append = "update catalog.agent_invocation set status='DISPATCHING',automation_step_event_ids=array_append(automation_step_event_ids,$2) where id=$1";
        sqlx::query(append)
            .bind(invocation)
            .bind(&first)
            .execute(&mut *tx)
            .await
            .unwrap();
        for sql in [
            "update catalog.agent_invocation set automation_step_event_ids=array_append(automation_step_event_ids,$2) where id=$1",
            "update catalog.agent_invocation set automation_step_event_ids=ARRAY[$2] where id=$1",
            "update catalog.agent_invocation set status='CANCELED',cancel_pending=true where id=$1 and $2<>''",
            "update catalog.agent_invocation set status='COMPLETED' where id=$1 and $2<>''",
        ] {
            sqlx::query("savepoint sequence_guard").execute(&mut *tx).await.unwrap();
            let error = sqlx::query(sql).bind(invocation).bind(&second).execute(&mut *tx).await.unwrap_err();
            assert_eq!(error.as_database_error().and_then(|error| error.code()).as_deref(), Some("23514"));
            sqlx::query("rollback to savepoint sequence_guard").execute(&mut *tx).await.unwrap();
            sqlx::query("release savepoint sequence_guard").execute(&mut *tx).await.unwrap();
        }
        let ae = crate::governance::lock_execution(&mut tx, action)
            .await
            .unwrap();
        for (event, ordinal) in [(&first, 0), (&second, 1)] {
            crate::audit::append(
                &mut tx,
                crate::audit::AuditEntry {
                    event_key: format!("sequence-fixture:{invocation}:{ordinal}"),
                    tenant_id: Some(tenant),
                    workspace_id: ae.workspace_id,
                    operation_id: ae.operation_id,
                    event_type: "RECONCILIATION",
                    human_identity_id: None,
                    initiator_principal_id: Some(ae.initiator_principal_id),
                    actor_principal_id: Some(ae.actor_principal_id),
                    action_key: &ae.action_key,
                    action_version: ae.action_version,
                    component_type_key: "core",
                    target_type: Some("RESOURCE"),
                    target_id: Some(ae.target_id),
                    parameter_hash: &ae.parameter_hash,
                    decision: "ALLOW",
                    result_code: "ACCEPTED",
                    result_exposure: "NONE",
                    evidence_refs: vec![
                        Evidence::new(EvidenceKind::ActionExecutionId, ae.id),
                        Evidence::new(EvidenceKind::BuzzEventId, event),
                    ],
                    correlation_id: ae.correlation_id,
                },
            )
            .await
            .unwrap();
            if ordinal == 0 {
                sqlx::query(append)
                    .bind(invocation)
                    .bind(&second)
                    .execute(&mut *tx)
                    .await
                    .unwrap();
                let stale: bool = sqlx::query_scalar("select exists(select 1 from catalog.agent_invocation where id=$1 and automation_step_event_ids=$2)")
                    .bind(invocation).bind(vec![first.clone()]).fetch_one(&mut *tx).await.unwrap();
                assert!(
                    !stale,
                    "a late terminal observer must not match a newer effect"
                );
            }
        }
        sqlx::query(
            "update catalog.agent_invocation set status='CANCELED',cancel_pending=true where id=$1",
        )
        .bind(invocation)
        .execute(&mut *tx)
        .await
        .unwrap();
        let retained: Vec<String> = sqlx::query_scalar(
            "select automation_step_event_ids from catalog.agent_invocation where id=$1",
        )
        .bind(invocation)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert_eq!(retained, [first, second]);
        tx.rollback().await.unwrap();
    }
}
