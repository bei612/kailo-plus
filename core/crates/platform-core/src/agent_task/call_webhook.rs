//! REQ-24, 06 §9.1: fixed Buzz 779af8886caae1317b4de962082429867ab61503
//! crates/buzz-workflow/src/executor.rs::call_webhook_impl, run by the original
//! AgentTask/Invocation. Core freezes one dispatch intent, sends the request
//! only through the AgentGateway egress listener and records the received HTTP
//! status once. A send whose result cannot be determined stays UNKNOWN and is
//! never sent again; there is no second executor, retry loop or response store.
use super::post_message::{
    activity_fence, current_meter, effect_deadline_refusal, fail_before_dispatch, trigger_context,
    Intent,
};
use super::*;
use crate::{audit::Evidence, automation::webhook_step, governance::Refusal};
use chrono::{DateTime, Utc};
use contracts::ReasonCode;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::{Duration, Instant};

fn unknown() -> Refusal {
    Refusal::Unavailable("Webhook dispatch evidence unavailable".into())
}

/// Each Activity attempt answers well inside the Worker's 30 s Activity
/// deadline: everything before the intent is frozen fits in PREPARE_BUDGET, the
/// single send has its own original 10 s bound, and a slow dependency leaves
/// the invocation CREATED for the next attempt. The send is never cancelled.
const PREPARE_BUDGET: Duration = Duration::from_secs(12);
const STEP_BUDGET: Duration = Duration::from_secs(5);
/// Dependency failures before the intent is frozen are retried this long, from
/// the first time this run reached the step; then the run fails before dispatch.
const PREPARE_BUDGET_SECONDS: f64 = 600.0;

/// One bounded pre-dispatch step: a timeout or a refusal is logged with the
/// step name and reason, never silently folded into "result unknown".
async fn bounded<T>(
    invocation: Uuid,
    step: &'static str,
    budget: Duration,
    future: impl std::future::Future<Output = Result<T, Refusal>>,
) -> Result<T, Refusal> {
    match tokio::time::timeout(budget, future).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => {
            tracing::warn!(%invocation, step, ?error, "call_webhook step refused");
            Err(error)
        }
        Err(_) => {
            let seconds = budget.as_secs();
            tracing::warn!(%invocation, step, seconds, "call_webhook step timed out");
            Err(Refusal::Unavailable(format!("call_webhook {step} timed out")))
        }
    }
}

/// One stable reference per run: call_webhook is the run's single final effect.
fn request_id(invocation: Uuid) -> String {
    Uuid::new_v5(&invocation, b"call_webhook").to_string()
}

enum Dispatched {
    Responded,
    Undetermined,
    NotDelivered(Refusal),
}

struct Prepared {
    method: reqwest::Method,
    url: reqwest::Url,
    origin: (String, u16),
    headers: HeaderMap,
    body: Option<String>,
    digest: String,
}

pub(super) async fn advance(
    state: &ServiceState,
    invocation: &Invocation,
    input: &AgentTaskAdvanceRequest,
) -> Response {
    match execute(state, invocation, input).await {
        Ok((status, reason)) => result(invocation.id, status, &reason),
        Err(error) => {
            tracing::warn!(invocation = %invocation.id, ?error, "call_webhook not dispatched");
            // Only a still-CREATED invocation without a frozen intent can close
            // here: a definite refusal, or dependencies failing past the budget.
            let definite = definite_reply_refusal(&error)
                || (matches!(error, Refusal::Unavailable(_))
                    && prepare_expired(state, invocation).await);
            if definite
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
) -> Result<(TaskStatus, String), Refusal> {
    let id = invocation.id;
    let deadline = Instant::now() + PREPARE_BUDGET;
    let fence = bounded(id, "activity_fence", STEP_BUDGET, async {
        activity_fence(state, invocation, input, true).await
    })
    .await?;
    let cancel = fence || input.cancel_requested || invocation.cancel_pending;
    match invocation.status.as_str() {
        "COMPLETED" => return Ok((TaskStatus::Completed, "NONE".into())),
        "FAILED" => return Ok((TaskStatus::Failed, "NONE".into())),
        "CANCELED" => return Ok((TaskStatus::Canceled, "NONE".into())),
        "CREATED" | "DISPATCHING" | "UNKNOWN" => (),
        _ => return Err(unknown()),
    }
    if invocation.runtime_turn_id.is_some()
        || invocation.native_status.is_some()
        || invocation.reply_event_id.is_some()
    {
        return Err(unknown());
    }
    let (intent, outcome): (Option<Value>, Option<Value>) = sqlx::query_as(
        "select webhook_intent,webhook_outcome from catalog.agent_invocation where id=$1",
    )
    .bind(invocation.id)
    .fetch_one(&state.pool)
    .await?;
    match (intent.is_some(), outcome.is_some()) {
        (false, _) => {
            if cancel {
                sqlx::query(
                    "update catalog.agent_invocation set cancel_pending=true,updated_at=now()
                     where id=$1 and status='CREATED'",
                )
                .bind(invocation.id)
                .execute(&state.pool)
                .await?;
                return if cancel_before_dispatch(state, invocation).await? {
                    Ok((TaskStatus::Canceled, "NONE".into()))
                } else {
                    Err(unknown())
                };
            }
            if invocation.status != "CREATED" {
                return Err(unknown());
            }
            effect_started(state, invocation).await?;
            effect_deadline_refusal(state, invocation, None).await?;
            match dispatch(state, invocation, input, deadline).await? {
                Dispatched::Responded => {}
                Dispatched::Undetermined => {
                    return Ok((TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT".into()));
                }
                Dispatched::NotDelivered(reason) => {
                    let reason = crate::governance::wire(&reason.reason());
                    return Ok((TaskStatus::Failed, reason));
                }
            }
        }
        (true, false) => {
            // A previous attempt froze the intent and may have sent the request.
            bounded(
                id,
                "undetermined",
                STEP_BUDGET,
                undetermined(state, invocation),
            )
            .await?;
            return Ok((TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT".into()));
        }
        (true, true) => {}
    }
    let usage = bounded(
        id,
        "record_count",
        STEP_BUDGET,
        record_count(state, invocation),
    )
    .await?;
    let settled = bounded(id, "settle_usage", STEP_BUDGET, async {
        crate::gateway_usage::settle_events(&state.pool, &[usage], &state.openmeter)
            .await
            .map_err(|_| unknown())
    })
    .await?;
    if !settled {
        return Ok((TaskStatus::Running, "BILLING_UNAVAILABLE".into()));
    }
    bounded(id, "finish", STEP_BUDGET, finish(state, invocation, usage)).await
}

/// The first time this run reached its webhook step (shared with Step.timeout_secs).
async fn effect_started(state: &ServiceState, invocation: &Invocation) -> Result<(), Refusal> {
    sqlx::query(
        "update catalog.agent_invocation i set automation_effect_starts=i.automation_effect_starts
          ||jsonb_build_object(v.action->'steps'->(-1)->>'id',to_jsonb(clock_timestamp())),updated_at=now()
         from catalog.automation_version v
         where i.id=$1 and v.asset_id=i.automation_version_asset_id
           and v.automation_resource_id=i.automation_resource_id and v.action->>'kind'='CALL_WEBHOOK_STEPS'
           and not i.automation_effect_starts ? (v.action->'steps'->(-1)->>'id')
           and i.status='CREATED' and i.webhook_intent is null",
    )
    .bind(invocation.id)
    .execute(&state.pool)
    .await?;
    Ok(())
}

/// Pre-dispatch dependency failures have outlived PREPARE_BUDGET_SECONDS.
async fn prepare_expired(state: &ServiceState, invocation: &Invocation) -> bool {
    sqlx::query_scalar::<_, Option<bool>>(
        "select (i.automation_effect_starts->>(v.action->'steps'->(-1)->>'id'))::timestamptz
            +make_interval(secs=>$2)<clock_timestamp()
         from catalog.agent_invocation i join catalog.automation_version v
           on v.asset_id=i.automation_version_asset_id and v.automation_resource_id=i.automation_resource_id
         where i.id=$1 and i.status='CREATED' and i.webhook_intent is null",
    )
    .bind(invocation.id)
    .bind(PREPARE_BUDGET_SECONDS)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten()
    .flatten()
    .unwrap_or(false)
}

/// Original executor.rs expansion of url/headers/body with the verified trigger
/// context. The literal origin and header names cannot be changed by templates.
async fn prepare(
    state: &ServiceState,
    invocation: &Invocation,
    channel: Uuid,
    expected_author: Option<&str>,
    step: &Value,
) -> Result<Prepared, Refusal> {
    let invalid = || Refusal::Precondition(ReasonCode::InvalidParameters);
    let url = step["url"].as_str().ok_or_else(invalid)?;
    let origin = webhook_step::origin(url).ok_or_else(invalid)?;
    let plain: Vec<(String, String)> = step
        .get("headers")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .map(|(name, value)| -> Result<(String, String), Refusal> {
            Ok((name.clone(), value.as_str().ok_or_else(invalid)?.to_owned()))
        })
        .collect::<Result<_, Refusal>>()?;
    let body = step.get("body").and_then(Value::as_str);
    let templated = url.contains("{{")
        || body.is_some_and(|body| body.contains("{{"))
        || plain.iter().any(|(_, value)| value.contains("{{"));
    let context = if templated {
        trigger_context(state, invocation, channel, expected_author).await?
    } else {
        Default::default()
    };
    let outputs = HashMap::new();
    let render = |template: &str| {
        collab_bridge::workflow_template::resolve_template(template, &context, &outputs)
            .map_err(|_| invalid())
    };
    let rendered = render(url)?;
    let Some(url) = webhook_step::expanded_url(&rendered, &origin) else {
        return Err(invalid());
    };
    let method = step["method"].as_str().unwrap_or("POST");
    if !webhook_step::METHODS.contains(&method) {
        return Err(invalid());
    }
    let mut headers = HeaderMap::new();
    let mut digest_headers = Vec::new();
    for (name, value) in &plain {
        let value = render(value.as_str())?;
        let header: HeaderName = name.parse().map_err(|_| invalid())?;
        let header_value = HeaderValue::from_str(&value).map_err(|_| invalid())?;
        digest_headers.push(format!("{}:{}", header.as_str(), value));
        headers.insert(header, header_value);
    }
    if let Some(secrets) = step.get("secretHeaders").and_then(Value::as_object) {
        // Secret values never enter the digest, intent, audit or trace.
        for name in secrets.keys() {
            digest_headers.push(format!("{}:<secret>", name.to_ascii_lowercase()));
        }
    }
    digest_headers.sort();
    let body = body.map(render).transpose()?;
    let mut hasher = Sha256::new();
    hasher.update(method.as_bytes());
    hasher.update(b"\n");
    hasher.update(url.as_str().as_bytes());
    hasher.update(b"\n");
    hasher.update(digest_headers.join("\n").as_bytes());
    hasher.update(b"\n");
    hasher.update(Sha256::digest(body.as_deref().unwrap_or("").as_bytes()));
    Ok(Prepared {
        method: method.parse().map_err(|_| invalid())?,
        url,
        origin,
        headers,
        body,
        digest: hex::encode(hasher.finalize()),
    })
}

/// Exact same-Tenant Core SecretRefs, read at dispatch only (DD-70).
async fn secret_headers(
    state: &ServiceState,
    tenant: Uuid,
    action: &Value,
    step: &Value,
) -> Result<HeaderMap, Refusal> {
    let invalid = || Refusal::Precondition(ReasonCode::InvalidParameters);
    let mut headers = HeaderMap::new();
    let Some(secrets) = step.get("secretHeaders").and_then(Value::as_object) else {
        return Ok(headers);
    };
    if !webhook_step::secret_scope(
        action,
        &state.secrets.tenant_locator(tenant, ""),
        &state.secret_audience,
    ) {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    for (name, reference) in secrets {
        let version = reference["version"]
            .as_u64()
            .and_then(|version| u32::try_from(version).ok())
            .filter(|version| *version > 0)
            .ok_or_else(invalid)?;
        let value = state
            .secrets
            .read(
                &secret_store::SecretRef {
                    locator: reference["locator"]
                        .as_str()
                        .ok_or_else(unknown)?
                        .to_owned(),
                    version,
                    audience: reference["audience"]
                        .as_str()
                        .ok_or_else(unknown)?
                        .to_owned(),
                },
                "value",
            )
            .await
            .map_err(|_| Refusal::Unavailable("Webhook header secret unavailable".into()))?;
        let mut header = HeaderValue::from_str(value.expose()).map_err(|_| invalid())?;
        header.set_sensitive(true);
        let name: HeaderName = name.parse().map_err(|_| invalid())?;
        headers.insert(name, header);
    }
    Ok(headers)
}

/// This run's frozen call_webhook step, read without row locks.
async fn frozen_step(state: &ServiceState, invocation: &Invocation) -> Result<Value, Refusal> {
    let (version_action, parameters): (Value, Option<Value>) = sqlx::query_as(
        "select v.action,ae.parameters from catalog.agent_invocation i
         join catalog.automation_version v on v.asset_id=i.automation_version_asset_id
         and v.automation_resource_id=i.automation_resource_id
         join admission.action_execution ae on ae.id=i.action_execution_id where i.id=$1",
    )
    .bind(invocation.id)
    .fetch_one(&state.pool)
    .await?;
    let action = crate::automation::steps::run_action(&version_action, parameters.as_ref())?
        .ok_or_else(unknown)?;
    action["steps"]
        .as_array()
        .and_then(|steps| steps.last())
        .filter(|step| step["action"] == "call_webhook")
        .cloned()
        .ok_or_else(unknown)
}

async fn dispatch(
    state: &ServiceState,
    invocation: &Invocation,
    input: &AgentTaskAdvanceRequest,
    deadline: Instant,
) -> Result<Dispatched, Refusal> {
    let id = invocation.id;
    // Never more than what is left of this attempt's preparation budget.
    let left = || {
        deadline
            .saturating_duration_since(Instant::now())
            .min(STEP_BUDGET)
    };
    bounded(id, "activity_fence", left(), async {
        activity_fence(state, invocation, input, false).await.map(|_| ())
    })
    .await?;
    bounded(id, "audit_gate", left(), async {
        crate::service_api::audit_gate(state)
            .await
            .map_err(|_| Refusal::Unavailable("audit devices unavailable".into()))
    })
    .await?;
    let egress = crate::automation::webhook_egress()?;
    let tokens = crate::oidc::TokenSource::from_env()
        .map_err(|_| Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    // The request leaves only through AgentGateway: no system proxy, no redirect.
    let timeout = Duration::from_secs(webhook_step::REQUEST_TIMEOUT_SECS);
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(timeout)
        .build()
        .map_err(|_| unknown())?;
    // Network-only preparation happens before any row lock: the frozen step,
    // the original check_ssrf, header SecretRefs and Core's egress credential.
    let frozen = bounded(
        id,
        "frozen_step",
        left(),
        frozen_step(state, invocation),
    )
    .await?;
    let origin = webhook_step::origin(frozen["url"].as_str().unwrap_or_default())
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let host = origin.0.as_str();
    let lookup = webhook_step::resolve_public(host, origin.1);
    match tokio::time::timeout(left(), lookup).await {
        Ok(Ok(())) => {}
        Ok(Err(true)) => {
            tracing::warn!(invocation = %id, host, "call_webhook destination is not public");
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        Ok(Err(false)) => {
            tracing::warn!(invocation = %id, host, "call_webhook destination unresolved");
            return Err(Refusal::Precondition(ReasonCode::TargetNotFound));
        }
        Err(_) => {
            tracing::warn!(invocation = %id, host, "call_webhook DNS timed out");
            return Err(Refusal::Unavailable("call_webhook dns timed out".into()));
        }
    }
    let secrets = bounded(id, "secret_headers", left(), async {
        let action = json!({"steps":[frozen.clone()]});
        secret_headers(state, invocation.tenant_id, &action, &frozen).await
    })
    .await?;
    let bearer = bounded(id, "egress_token", left(), async {
        tokens
            .token()
            .await
            .map_err(|_| Refusal::Unavailable("Core egress credential unavailable".into()))
    })
    .await?;
    let mut tx = state.pool.begin().await?;
    let ae = bounded(id, "lock", left(), async {
        let ae = crate::governance::lock_execution(&mut tx, invocation.action_execution_id).await?;
        sqlx::query("select id from identity.tenant where id=$1 for no key update")
            .bind(invocation.tenant_id)
            .fetch_one(&mut *tx)
            .await?;
        Ok::<_, Refusal>(ae)
    })
    .await?;
    // The same fresh admission as every native effect, including the original
    // elevated authority (automation::fresh) for this exact frozen run.
    let (action, binding, revision) = bounded(id, "fresh_admission", left(), async {
        crate::automation::fresh_channel_action(state, &mut tx, invocation.id, None).await
    })
    .await?;
    if action["kind"] != "CALL_WEBHOOK_STEPS" {
        return Err(unknown());
    }
    let step = action["steps"]
        .as_array()
        .and_then(|steps| steps.last())
        .filter(|step| step["action"] == "call_webhook" && **step == frozen)
        .ok_or_else(unknown)?
        .clone();
    let source_author = ae
        .parameters
        .as_ref()
        .and_then(|parameters| parameters["sourcePubkey"].as_str());
    let channel = binding.channel_id;
    let prepared = bounded(id, "trigger_context", left(), async {
        prepare(state, invocation, channel, source_author, &step).await
    })
    .await?;
    let mut headers = prepared.headers.clone();
    headers.extend(secrets);
    if Instant::now() >= deadline {
        tracing::warn!(invocation = %id, "call_webhook preparation used its attempt budget");
        return Err(Refusal::Unavailable("call_webhook preparation over budget".into()));
    }
    let created_at = DateTime::from_timestamp(Utc::now().timestamp(), 0).ok_or_else(unknown)?;
    let usage = bounded(id, "usage_meter", left(), async {
        current_meter(state, &mut tx, invocation, created_at).await
    })
    .await?;
    let request = request_id(invocation.id);
    let authority = format!("{}:{}", prepared.origin.0, prepared.origin.1);
    let usage_value = serde_json::to_value(&usage).map_err(|_| unknown())?;
    let intent = json!({"usage":usage_value,"request_digest":prepared.digest,
        "destination":authority.clone()});
    let changed = sqlx::query(
        "update catalog.agent_invocation set webhook_request_id=$2,webhook_intent=$3,
         status='DISPATCHING',updated_at=now() where id=$1 and status='CREATED' and not cancel_pending
         and webhook_intent is null and reply_event_id is null and post_message_intent is null
         and runtime_turn_id is null and native_status is null",
    )
    .bind(invocation.id)
    .bind(&request)
    .bind(&intent)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(unknown());
    }
    let evidence = vec![
        Evidence::new(EvidenceKind::ActionExecutionId, ae.id),
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
            &format!("webhook:{request}:dispatch"),
            "DISPATCH",
            "DISPATCHED",
        ),
        evidence.clone(),
    )
    .await?;
    tx.commit().await?;
    // Only this call won the intent CAS. Recheck once more under the same locks
    // and hold them across the single send, as the original native publication.
    let prepared_guard = async {
        activity_fence(state, invocation, input, false).await?;
        let mut guard = state.pool.begin().await?;
        crate::governance::lock_execution(&mut guard, ae.id).await?;
        sqlx::query("select id from identity.tenant where id=$1 for no key update")
            .bind(invocation.tenant_id)
            .fetch_one(&mut *guard)
            .await?;
        if current_meter(state, &mut guard, invocation, created_at).await? != usage {
            return Err(unknown());
        }
        let (current_action, current_binding, _) =
            crate::automation::fresh_channel_action(state, &mut guard, invocation.id, None).await?;
        if current_action != action || current_binding != binding {
            return Err(unknown());
        }
        Ok::<_, Refusal>(guard)
    }
    .await;
    let mut guard = match prepared_guard {
        Ok(guard) => guard,
        Err(error) => {
            // This live sender has not sent and never will: definite non-delivery.
            tracing::warn!(invocation = %id, step = "dispatch_recheck", ?error, "call_webhook not sent");
            not_delivered(state, invocation, &ae, &request, evidence, &error).await?;
            return Ok(Dispatched::NotDelivered(error));
        }
    };
    let mut target = egress;
    target.set_path(prepared.url.path());
    target.set_query(prepared.url.query());
    let credential = format!("Bearer {bearer}");
    let mut proxy_credential = HeaderValue::from_str(&credential).map_err(|_| unknown())?;
    proxy_credential.set_sensitive(true);
    let mut request_builder = client
        .request(prepared.method.clone(), target)
        .headers(headers)
        .header("x-platform-egress-authority", &authority)
        .header("kailo-request-id", &request)
        .header(reqwest::header::PROXY_AUTHORIZATION, proxy_credential);
    if let Some(body) = prepared.body.clone() {
        request_builder = request_builder.body(body);
    }
    match request_builder.send().await {
        // AgentGateway refused Core's own egress credential before forwarding.
        Ok(response) if response.status().as_u16() == 407 => {
            tokens.invalidate().await;
            guard.rollback().await?;
            let error = Refusal::Unavailable("AgentGateway egress refused Core".into());
            not_delivered(state, invocation, &ae, &request, evidence, &error).await?;
            Ok(Dispatched::NotDelivered(error))
        }
        Ok(mut response) => {
            let status = response.status().as_u16();
            // Original WEBHOOK_MAX_RESPONSE_BYTES bound; nothing of it is kept.
            let mut read = 0usize;
            while let Ok(Some(chunk)) = response.chunk().await {
                read += chunk.len();
                if read > webhook_step::MAX_RESPONSE_BYTES {
                    break;
                }
            }
            let changed = sqlx::query(
                "update catalog.agent_invocation set webhook_outcome=$2,updated_at=now()
                 where id=$1 and webhook_request_id=$3 and webhook_outcome is null
                 and status in ('DISPATCHING','UNKNOWN')",
            )
            .bind(invocation.id)
            .bind(json!({"status":status}))
            .bind(&request)
            .execute(&mut *guard)
            .await?;
            if changed.rows_affected() != 1 {
                return Err(unknown());
            }
            turn_audit(
                state,
                &mut guard,
                &ae,
                invocation.id,
                (
                    &format!("webhook:{request}:outcome"),
                    "OUTCOME",
                    "RESPONDED",
                ),
                evidence,
            )
            .await?;
            guard.commit().await?;
            Ok(Dispatched::Responded)
        }
        // Core never reached AgentGateway: nothing left this process.
        Err(error) if error.is_connect() || error.is_builder() => {
            guard.rollback().await?;
            let error = Refusal::Unavailable("AgentGateway egress unreachable".into());
            not_delivered(state, invocation, &ae, &request, evidence, &error).await?;
            Ok(Dispatched::NotDelivered(error))
        }
        // Timeout or a broken exchange: the destination may have acted on it.
        Err(_) => {
            guard.rollback().await?;
            undetermined(state, invocation).await?;
            Ok(Dispatched::Undetermined)
        }
    }
}

async fn not_delivered(
    state: &ServiceState,
    invocation: &Invocation,
    ae: &crate::governance::Execution,
    request: &str,
    evidence: Vec<Evidence>,
    error: &Refusal,
) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    crate::governance::lock_execution(&mut tx, ae.id).await?;
    let changed = sqlx::query(
        "update catalog.agent_invocation set status='FAILED',updated_at=now()
         where id=$1 and webhook_request_id=$2 and webhook_outcome is null and status='DISPATCHING'",
    )
    .bind(invocation.id)
    .bind(request)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(unknown());
    }
    let def =
        crate::governance::exact_definition(&state.pool, &ae.action_key, ae.action_version).await?;
    state
        .governance
        .record_automation_decision(&mut tx, ae, &def, "RECHECK", Err(error))
        .await?;
    turn_audit(
        state,
        &mut tx,
        ae,
        invocation.id,
        (
            &format!("webhook:{request}:outcome"),
            "OUTCOME",
            "NOT_DELIVERED",
        ),
        evidence,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// The request may have been sent and no response was recorded: UNKNOWN, kept
/// for reconciliation and never resent (06 §9 terminal discipline).
async fn undetermined(state: &ServiceState, invocation: &Invocation) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, invocation.action_execution_id).await?;
    let request: Option<String> = sqlx::query_scalar(
        "update catalog.agent_invocation set status='UNKNOWN',updated_at=now()
         where id=$1 and status='DISPATCHING' and webhook_intent is not null and webhook_outcome is null
         returning webhook_request_id",
    )
    .bind(invocation.id)
    .fetch_optional(&mut *tx)
    .await?
    .flatten();
    if let Some(request) = request {
        turn_audit(
            state,
            &mut tx,
            &ae,
            invocation.id,
            (
                &format!("webhook:{request}:undetermined"),
                "RECONCILIATION",
                "UNKNOWN",
            ),
            vec![
                Evidence::new(EvidenceKind::ActionExecutionId, ae.id),
                Evidence::new(EvidenceKind::TemporalWorkflowId, &invocation.workflow_id),
            ],
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

async fn record_count(state: &ServiceState, invocation: &Invocation) -> Result<Uuid, Refusal> {
    let mut tx = state.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, invocation.action_execution_id).await?;
    let (intent, request, automation_resource_id): (Value, String, Uuid) = sqlx::query_as(
        "select webhook_intent,webhook_request_id,automation_resource_id from catalog.agent_invocation
         where id=$1 and action_execution_id=$2 and webhook_outcome is not null for update",
    )
    .bind(invocation.id)
    .bind(ae.id)
    .fetch_one(&mut *tx)
    .await?;
    let usage: Intent = serde_json::from_value(intent["usage"].clone()).map_err(|_| unknown())?;
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
        "automation_resource_id":automation_resource_id,"webhook_request_id":request});
    let cloud = json!({"specversion":"1.0","id":id,"source":"urn:platform:core:usage","type":usage.meter.event_type,
        "subject":usage.subject,"time":usage.created_at,"datacontenttype":"application/json","data":dimensions});
    sqlx::query("insert into outbox.usage_event(id,invocation_id,operation_id,tenant_id,workspace_id,openmeter_customer_id,
        openmeter_namespace,agent_installation_resource_id,source_type,source_id,meter_key,subject_key,quantity,occurred_at,
        dimensions,openmeter_event_id,event,settlement_status)
        values($1,$2,$3,$4,$5,$6,$7,$8,'AGENT_INVOCATION',$2,'automation.run',$9,1,$10,$11,$1,$12,'PENDING_PUBLISH')
        on conflict(tenant_id,source_type,source_id,meter_key) do nothing")
        .bind(id).bind(invocation.id).bind(ae.operation_id).bind(invocation.tenant_id).bind(invocation.workspace_id)
        .bind(&usage.customer_id).bind(&usage.namespace).bind(invocation.installation_resource_id).bind(&usage.subject)
        .bind(usage.created_at).bind(&dimensions).bind(&cloud).execute(&mut *tx).await?;
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
            Evidence::new(EvidenceKind::ActionExecutionId, ae.id),
        ],
    )
    .await?;
    tx.commit().await?;
    Ok(id)
}

async fn finish(
    state: &ServiceState,
    invocation: &Invocation,
    usage: Uuid,
) -> Result<(TaskStatus, String), Refusal> {
    let mut tx = state.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, invocation.action_execution_id).await?;
    let committed: bool = sqlx::query_scalar(
        "select exists(select 1 from outbox.usage_event where id=$1
        and invocation_id=$2 and operation_id=$3 and tenant_id=$4 and workspace_id=$5
        and settlement_status='COMMITTED' and stored_at is not null)",
    )
    .bind(usage)
    .bind(invocation.id)
    .bind(ae.operation_id)
    .bind(invocation.tenant_id)
    .bind(invocation.workspace_id)
    .fetch_one(&mut *tx)
    .await?;
    if !committed {
        return Err(unknown());
    }
    let changed = sqlx::query(
        "update catalog.agent_invocation set status='COMPLETED',updated_at=now()
        where id=$1 and status in ('DISPATCHING','UNKNOWN') and webhook_outcome is not null
        and reply_event_id is null and runtime_turn_id is null and native_status is null",
    )
    .bind(invocation.id)
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
        ("webhook:terminal", "OUTCOME", "COMPLETED"),
        vec![
            Evidence::new(EvidenceKind::UsageEventId, usage),
            Evidence::new(EvidenceKind::OpenmeterEventId, usage),
        ],
    )
    .await?;
    tx.commit().await?;
    Ok((TaskStatus::Completed, "NONE".into()))
}
