//! DD-125(4), 05 §2.11, V-SCN-135: the original channel Canvas (SF-BUZ-54).
//!
//! The Canvas is a kind 40100 regular event under the Channel's `h` tag whose body is
//! Markdown up to 64 KiB. In Kailo it is management metadata (DD-80): only
//! `workspace.canvas.set` writes it, admitted as a governed SYNC action with Workspace
//! `manage` on an ACTIVE Workspace and an explicit user confirmation. The Tenant CONTROL key
//! is only the signer; initiator and actor stay the admitted HUMAN.
//!
//! The body is a transient command input. Core freezes its SHA-256 and byte length in the
//! ActionExecution and keeps the signed event ID in a write-ahead intent, so an UNKNOWN
//! outcome is reconciled by event ID (DD-81) without the body ever entering Core storage,
//! audit, logs or history. A replay of the same idempotency key never signs a second event;
//! it only reads back the first one.
//!
//! Reads go through the member's own SERVER identity in the admitted Workspace and adopt
//! only the newest 40100 authored by that Tenant's CONTROL key; any other author is ignored
//! (members cannot publish 40100: it is not in `BUZZ_MEMBER_EVENT_KINDS`).

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use collab_bridge::bridge::{Delivery, IdentityClient};
use contracts::{ActionCommand, ActionSubmission, EvidenceKind, ReasonCode};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::{
    audit::{AuditEntry, Evidence},
    bff::{resolve_execution_context, BffState, ExecutionContext},
    governance::{Actor, Definition, Execution, Refusal, Target},
    service_api::ServiceState,
    tenant_lifecycle::{control_client, ProjectionDirection},
    web_transport::{
        actor_keys, admit_workspace, community_client, community_limits, relay_error_response,
        RelayCheck,
    },
};

/// The only action that writes a Canvas (05 §2.11).
pub(crate) const ACTION: &str = "workspace.canvas.set";
/// Original `KIND_CANVAS` (SF-BUZ-54).
pub(crate) const KIND_CANVAS: u16 = 40100;
/// Original Canvas body bound: Markdown up to 64 KiB (SF-BUZ-54, DD-125(4)).
pub(crate) const MAX_CANVAS_BYTES: usize = 64 * 1024;

#[derive(sqlx::FromRow)]
struct Intent {
    action_execution_id: Uuid,
    tenant_id: Uuid,
    workspace_id: Uuid,
    channel_id: Uuid,
    control_pubkey: String,
    event_id: String,
    event_created_at: i64,
    outcome: Option<String>,
}

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

fn unavailable(message: &str) -> Refusal {
    Refusal::Unavailable(message.to_owned())
}

fn actor(ctx: &ExecutionContext) -> Actor {
    Actor {
        tenant_id: ctx.tenant_id,
        principal_id: ctx.tenant_principal_id,
        human_identity_id: Some(ctx.human_identity_id),
    }
}

/// Map an admission refusal reason to its class, as the governed paths do.
fn rejected(reason: Option<ReasonCode>) -> Refusal {
    match reason.unwrap_or(ReasonCode::PermissionDenied) {
        ReasonCode::QuotaExhausted => Refusal::Limit(ReasonCode::QuotaExhausted),
        ReasonCode::RateLimited => Refusal::Limit(ReasonCode::RateLimited),
        ReasonCode::TargetStateConflict => Refusal::Conflict(ReasonCode::TargetStateConflict),
        ReasonCode::CapabilityBlocked => Refusal::Blocked(ReasonCode::CapabilityBlocked),
        ReasonCode::TargetNotFound => Refusal::Precondition(ReasonCode::TargetNotFound),
        reason => Refusal::Denied(reason),
    }
}

/// Hex SHA-256 of the transient body: the only trace of it Core keeps.
pub(crate) fn content_digest(content: &str) -> String {
    hex::encode(Sha256::digest(content.as_bytes()))
}

/// The frozen intent of one command: target, confirmation and the body digest. A replay of
/// the same key must carry the same body (same digest), never another Canvas.
fn command_digest(workspace: Uuid, digest: &str) -> String {
    collab_bridge::limits::canonical_digest(&json!({
        "actionKey": ACTION,
        "workspaceId": workspace,
        "explicitConfirmation": true,
        "contentSha256": digest,
    }))
}

/// The catalog row must be exactly the 05 §2.11 policy; anything else is not this action.
fn validate_definition(d: &Definition) -> Result<(), Refusal> {
    if d.action_key != ACTION
        || d.component_type_key != "core"
        || d.target_type != "WORKSPACE"
        || d.tenant_rule != "SESSION_TENANT"
        || d.workspace_rule != "WORKSPACE_REQUIRED"
        || d.permission != "manage"
        || d.permission_object_type != "workspace"
        || d.execution_mode != "SYNC"
        || d.confirmation_mode != "EXPLICIT"
        || d.approval_policy_id.is_some()
        || d.approval_policy_version.is_some()
        || d.workflow_kind.is_some()
        || d.result_exposure != "NONE"
        || d.quota_policy != "NONE"
        || !d.meters.is_empty()
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    Ok(())
}

/// Validated transient input of one `workspace.canvas.set` command.
struct Command<'a> {
    workspace: Uuid,
    key: Uuid,
    content: &'a str,
}

/// Only the fields this action defines may be present; the body is bounded before any
/// admission work so an oversized Canvas never reaches the signer.
fn parse(cmd: &ActionCommand) -> Result<Command<'_>, Refusal> {
    let raw = serde_json::to_value(cmd).map_err(|_| invalid())?;
    let valid = raw.as_object().is_some_and(|fields| {
        fields.iter().all(|(key, value)| {
            value.is_null()
                || matches!(
                    key.as_str(),
                    "actionKey"
                        | "idempotencyKey"
                        | "workspaceId"
                        | "workspaceCanvas"
                        | "explicitConfirmation"
                )
        })
    });
    if !valid || cmd.action_key != ACTION || cmd.explicit_confirmation != Some(true) {
        return Err(invalid());
    }
    let input = cmd.workspace_canvas.as_ref().ok_or_else(invalid)?;
    if input.content.len() > MAX_CANVAS_BYTES {
        return Err(Refusal::Limit(ReasonCode::PayloadTooLarge));
    }
    let workspace = cmd.workspace_id.as_deref().ok_or_else(invalid)?;
    Ok(Command {
        workspace: Uuid::parse_str(workspace).map_err(|_| invalid())?,
        key: Uuid::parse_str(&cmd.idempotency_key).map_err(|_| invalid())?,
        content: &input.content,
    })
}

/// `POST /api/v1/actions` consumer for `workspace.canvas.set`.
pub(crate) async fn submit(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &ActionCommand,
) -> Result<(StatusCode, ActionSubmission), (Refusal, Option<Uuid>)> {
    if ctx.access_mode != contracts::PlatformSessionAccessMode::Full {
        return Err((Refusal::Denied(ReasonCode::ScopeGuardFailed), None));
    }
    let command = parse(cmd).map_err(|refusal| (refusal, None))?;
    let digest = content_digest(command.content);
    let frozen = command_digest(command.workspace, &digest);
    if let Some(id) = existing(state, ctx, command.key)
        .await
        .map_err(|e| (e, None))?
    {
        return replay(state, ctx, id, command.workspace, &frozen).await;
    }
    if !crate::capability_registry::action_exposed(ACTION) {
        return Err((Refusal::Blocked(ReasonCode::CapabilityBlocked), None));
    }
    let definition = crate::governance::active_definition(&state.pool, ACTION)
        .await
        .map_err(|e| (e.into(), None))?
        .ok_or((Refusal::Blocked(ReasonCode::CapabilityBlocked), None))?;
    validate_definition(&definition).map_err(|refusal| (refusal, None))?;
    let target: Option<(i32, Uuid)> = sqlx::query_as(
        "select w.version, b.channel_id from identity.workspace w
         join projection.workspace_buzz_binding b on b.workspace_id = w.id
         where w.id = $1 and w.tenant_id = $2 and b.state = 'ACTIVE'",
    )
    .bind(command.workspace)
    .bind(ctx.tenant_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| (e.into(), None))?;
    let Some((version, channel)) = target else {
        return Err((Refusal::Precondition(ReasonCode::TargetNotFound), None));
    };
    let target = Target {
        id: command.workspace,
        version,
        workspace_id: Some(command.workspace),
    };
    let mut checked = state
        .governance
        .evaluate(actor(ctx), &definition, &target)
        .await
        .map_err(|e| (e, None))?;
    state
        .governance
        .check_quota(ctx.tenant_id, &definition, &mut checked)
        .await
        .map_err(|e| (e, None))?;
    let parameters = json!({
        "commandDigest": frozen,
        "contentSha256": digest,
        "contentBytes": command.content.len(),
        "channelId": channel,
        "targetVersion": version,
        "platformSessionId": ctx.session_id,
    });
    let parameter_hash = collab_bridge::limits::canonical_digest(&json!({
        "actionKey": ACTION,
        "actionVersion": definition.version,
        "targetId": command.workspace,
        "parameters": parameters,
    }));
    if !checked.allowed {
        let refusal = rejected(checked.reason.clone());
        let operation = record_denied(
            state,
            ctx,
            &definition,
            &target,
            parameters,
            parameter_hash,
            command.key,
            &checked,
        )
        .await
        .map_err(|e| (e, None))?;
        return Err((refusal, operation));
    }
    // CONTROL is only the signer (DD-80). Its key, the binding and the runtime NIP-11 must
    // all be verifiable before anything is persisted or signed.
    let (control, host) = control_client(
        &state.memory_service,
        ctx.tenant_id,
        ProjectionDirection::Establish,
    )
    .await
    .map_err(|_| (unavailable("Canvas CONTROL identity unavailable"), None))?;
    if let Err(check) = community_limits(state, &host).await {
        let refusal = match check {
            RelayCheck::Unavailable => unavailable("Canvas Relay binding unavailable"),
            _ => Refusal::Precondition(ReasonCode::BindingNotActive),
        };
        return Err((refusal, None));
    }
    let channel_tag = vec!["h".to_owned(), channel.to_string()];
    let event = control
        .sign(KIND_CANVAS, command.content, &[channel_tag])
        .map_err(|_| (unavailable("Canvas signature unavailable"), None))?;
    let event_id = event.id.to_hex();
    let created_at = i64::try_from(event.created_at.as_secs()).map_err(|_| (invalid(), None))?;
    let ae = match open_intent(
        state,
        ctx,
        &definition,
        &target,
        parameters,
        parameter_hash,
        command.key,
        &checked,
        Intent {
            action_execution_id: Uuid::nil(),
            tenant_id: ctx.tenant_id,
            workspace_id: command.workspace,
            channel_id: channel,
            control_pubkey: control.pubkey_hex(),
            event_id,
            event_created_at: created_at,
            outcome: None,
        },
        &digest,
        command.content.len(),
    )
    .await
    {
        Ok(ae) => ae,
        // The same key won a concurrent race: answer that operation, never sign twice.
        Err(Opened::Raced) => {
            let id = existing(state, ctx, command.key)
                .await
                .map_err(|e| (e, None))?
                .ok_or_else(|| (unavailable("Canvas operation not verifiable"), None))?;
            return replay(state, ctx, id, command.workspace, &frozen).await;
        }
        Err(Opened::Busy) => {
            return Err((Refusal::Conflict(ReasonCode::TargetStateConflict), None));
        }
        Err(Opened::Failed(refusal)) => return Err((refusal, None)),
    };
    // This request owns the only signed event; a restarted or replayed request never
    // receives it and can only read back (finish).
    deliver(state, &ae, &definition, &control, &event)
        .await
        .map_err(|e| (e, Some(ae.operation_id)))?;
    finish(&state.memory_service, Some(ctx), ae.id)
        .await
        .map_err(|e| (e, Some(ae.operation_id)))
}

async fn existing(
    state: &BffState,
    ctx: &ExecutionContext,
    key: Uuid,
) -> Result<Option<Uuid>, Refusal> {
    Ok(sqlx::query_scalar(
        "select id from admission.action_execution
         where tenant_id = $1 and initiator_principal_id = $2 and idempotency_key = $3",
    )
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .bind(key)
    .fetch_optional(&state.pool)
    .await?)
}

/// The same key answers the original operation only. Another target or body is a reuse.
async fn replay(
    state: &BffState,
    ctx: &ExecutionContext,
    id: Uuid,
    workspace: Uuid,
    frozen: &str,
) -> Result<(StatusCode, ActionSubmission), (Refusal, Option<Uuid>)> {
    let ae = crate::governance::load_execution(&state.pool, id)
        .await
        .map_err(|e| (e.into(), None))?
        .ok_or_else(|| (unavailable("Canvas operation not verifiable"), None))?;
    let operation = Some(ae.operation_id);
    if ae.action_key != ACTION
        || ae.target_id != workspace
        || ae
            .parameters
            .as_ref()
            .and_then(|p| p["commandDigest"].as_str())
            != Some(frozen)
    {
        return Err((
            Refusal::Conflict(ReasonCode::IdempotencyKeyReused),
            operation,
        ));
    }
    if ae.gate_state == "DENIED" {
        let reason = ae
            .reason_code
            .as_deref()
            .and_then(crate::governance::parse::<ReasonCode>);
        return Err((rejected(reason), operation));
    }
    finish(&state.memory_service, Some(ctx), ae.id)
        .await
        .map_err(|e| (e, operation))
}

/// A refused admission is still an audited ActionExecution (FULL_LIFECYCLE).
#[allow(clippy::too_many_arguments)]
async fn record_denied(
    state: &BffState,
    ctx: &ExecutionContext,
    definition: &Definition,
    target: &Target,
    parameters: Value,
    parameter_hash: String,
    key: Uuid,
    checked: &crate::governance::Evaluation,
) -> Result<Option<Uuid>, Refusal> {
    let mut tx = state.pool.begin().await?;
    let ae = match crate::governance::open_execution_values(
        &mut tx,
        actor(ctx),
        ctx.tenant_principal_id,
        definition,
        target,
        parameters,
        parameter_hash,
        key,
        None,
    )
    .await
    {
        Ok(ae) => ae,
        // A concurrent request with the same key or target recorded first; nothing to add.
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let reason = checked
        .reason
        .clone()
        .unwrap_or(ReasonCode::PermissionDenied);
    crate::governance::record_decision(
        &mut tx,
        &ae.subject(),
        "ADMISSION",
        checked.scope,
        checked.authorization,
        "NOT_APPLICABLE",
        checked.quota,
        checked.zed_token.as_deref(),
        Some(&reason),
    )
    .await?;
    sqlx::query(
        "update admission.action_execution
         set gate_state = 'DENIED', reason_code = $2, updated_at = now() where id = $1",
    )
    .bind(ae.id)
    .bind(crate::governance::wire(&reason))
    .execute(&mut *tx)
    .await?;
    let result = crate::governance::wire(&reason);
    let stage = Stage {
        key: "decision",
        event_type: "DECISION",
        decision: "DENY",
        result: &result,
    };
    audit(&mut tx, &ae, definition, stage, Vec::new()).await?;
    tx.commit().await?;
    Ok(Some(ae.operation_id))
}

enum Opened {
    /// Another request already holds this idempotency key.
    Raced,
    /// Another admission is in flight on the same Workspace.
    Busy,
    Failed(Refusal),
}

impl From<sqlx::Error> for Opened {
    fn from(e: sqlx::Error) -> Self {
        Opened::Failed(e.into())
    }
}

/// Admission, the write-ahead intent with the signed event ID and the UNKNOWN dispatch are
/// one transaction: either the event may be delivered and reconciled, or nothing exists.
#[allow(clippy::too_many_arguments)]
async fn open_intent(
    state: &BffState,
    ctx: &ExecutionContext,
    definition: &Definition,
    target: &Target,
    parameters: Value,
    parameter_hash: String,
    key: Uuid,
    checked: &crate::governance::Evaluation,
    intent: Intent,
    digest: &str,
    bytes: usize,
) -> Result<Execution, Opened> {
    let mut tx = state.pool.begin().await?;
    let ae = match crate::governance::open_execution_values(
        &mut tx,
        actor(ctx),
        ctx.tenant_principal_id,
        definition,
        target,
        parameters,
        parameter_hash,
        key,
        None,
    )
    .await
    {
        Ok(ae) => ae,
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            let busy = e.constraint() == Some("action_execution_one_pending_per_target");
            return Err(if busy { Opened::Busy } else { Opened::Raced });
        }
        Err(e) => return Err(e.into()),
    };
    crate::governance::record_decision(
        &mut tx,
        &ae.subject(),
        "ADMISSION",
        checked.scope,
        checked.authorization,
        "NOT_APPLICABLE",
        checked.quota,
        checked.zed_token.as_deref(),
        None,
    )
    .await?;
    sqlx::query(
        "update admission.action_execution
         set gate_state = 'ALLOWED', reason_code = null, updated_at = now() where id = $1",
    )
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    let stage = Stage {
        key: "decision",
        event_type: "DECISION",
        decision: "ALLOW",
        result: "ALLOWED",
    };
    audit(&mut tx, &ae, definition, stage, Vec::new())
        .await
        .map_err(Opened::Failed)?;
    let bytes = i32::try_from(bytes).map_err(|_| Opened::Failed(invalid()))?;
    sqlx::query(
        "insert into admission.workspace_canvas_intent
             (action_execution_id, tenant_id, workspace_id, channel_id, control_pubkey,
              event_id, event_created_at, content_sha256, content_bytes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(ae.id)
    .bind(intent.tenant_id)
    .bind(intent.workspace_id)
    .bind(intent.channel_id)
    .bind(&intent.control_pubkey)
    .bind(&intent.event_id)
    .bind(intent.event_created_at)
    .bind(digest)
    .bind(bytes)
    .execute(&mut *tx)
    .await?;
    crate::governance::record_dispatch(
        &mut tx,
        ae.id,
        definition.audit_class(),
        Err(StatusCode::SERVICE_UNAVAILABLE),
        vec![Evidence::new(EvidenceKind::BuzzEventId, &intent.event_id)],
    )
    .await?;
    tx.commit().await?;
    Ok(ae)
}

/// The one delivery of the signed event. Its acknowledgement is evidence only; the result
/// is settled by reading the event back (finish).
async fn deliver(
    state: &BffState,
    ae: &Execution,
    definition: &Definition,
    control: &IdentityClient,
    event: &nostr::Event,
) -> Result<(), Refusal> {
    let admitted = control
        .admit()
        .map_err(|_| unavailable("Canvas Relay budget unavailable"))?;
    let ack = match control.deliver(&state.relay_http, event, admitted).await {
        Delivery::Accepted => "ACCEPTED",
        Delivery::Rejected(why) => {
            tracing::warn!(reason = %why, "Relay rejected the Canvas event");
            "REJECTED"
        }
        Delivery::Limited(_, why) => {
            tracing::warn!(reason = %why, "Relay limited the Canvas event before reading it");
            "NOT_DELIVERED"
        }
        Delivery::Unknown(why) => {
            tracing::warn!(error = %why, "Canvas delivery outcome unknown; reading back");
            "UNKNOWN"
        }
    };
    let evidence = vec![Evidence::new(EvidenceKind::BuzzEventId, event.id.to_hex())];
    let mut tx = state.pool.begin().await?;
    let current = crate::governance::lock_execution(&mut tx, ae.id).await?;
    sqlx::query(
        "update admission.workspace_canvas_intent set relay_ack = $2
         where action_execution_id = $1 and relay_ack = 'UNKNOWN'",
    )
    .bind(ae.id)
    .bind(ack)
    .execute(&mut *tx)
    .await?;
    let stage = Stage::outcome("ack", ack);
    audit(&mut tx, &current, definition, stage, evidence.clone()).await?;
    let refused = match ack {
        "REJECTED" => Some(ReasonCode::PublishRejected),
        "NOT_DELIVERED" => Some(ReasonCode::RateLimited),
        _ => None,
    };
    if let Some(reason) = refused {
        settle_not_written(&mut tx, &current, definition, reason, evidence).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Relay explicitly refused or limited the event: the Canvas did not change. The dispatch
/// is aborted with that definite reason; a new attempt needs a new key.
async fn settle_not_written(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    definition: &Definition,
    reason: ReasonCode,
    evidence: Vec<Evidence>,
) -> Result<(), Refusal> {
    sqlx::query(
        "update admission.workspace_canvas_intent
         set outcome = 'NOT_WRITTEN', settled_at = now()
         where action_execution_id = $1 and outcome is null",
    )
    .bind(ae.id)
    .execute(&mut **tx)
    .await?;
    crate::governance::record_dispatch(
        tx,
        ae.id,
        definition.audit_class(),
        Err(StatusCode::CONFLICT),
        evidence,
    )
    .await?;
    sqlx::query(
        "update admission.action_execution set reason_code = $2, updated_at = now()
         where id = $1 and gate_state = 'ALLOWED' and dispatch_state = 'ABORTED'",
    )
    .bind(ae.id)
    .bind(crate::governance::wire(&reason))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Read-only recovery shared by the request, its idempotent replays and the reconciler.
/// Present at Relay by verified event ID: DISPATCHED. A filtered absence or a failed
/// read stays UNKNOWN, even after the timestamp window. Only delivery's explicit
/// refusal or pre-ingest limit can establish NOT_WRITTEN.
async fn finish(
    service: &ServiceState,
    ctx: Option<&ExecutionContext>,
    id: Uuid,
) -> Result<(StatusCode, ActionSubmission), Refusal> {
    let mut tx = service.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, id).await?;
    if ctx.is_some_and(|ctx| {
        ae.tenant_id != ctx.tenant_id || ae.initiator_principal_id != ctx.tenant_principal_id
    }) {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let definition =
        crate::governance::exact_definition(&service.pool, &ae.action_key, ae.action_version)
            .await?;
    validate_definition(&definition)?;
    match (ae.gate_state.as_str(), ae.dispatch_state.as_str()) {
        ("ALLOWED", "DISPATCHED") => return Ok((StatusCode::OK, ae.submission())),
        ("ALLOWED", "ABORTED") => return Err(not_written(&ae)),
        ("ALLOWED", "UNKNOWN") => {}
        _ => return Err(unavailable("Canvas operation is not dispatchable")),
    }
    let intent: Intent = sqlx::query_as(
        "select action_execution_id, tenant_id, workspace_id, channel_id, control_pubkey,
                event_id, event_created_at, outcome
         from admission.workspace_canvas_intent where action_execution_id = $1 for update",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    if intent.action_execution_id != ae.id
        || intent.tenant_id != ae.tenant_id
        || Some(intent.workspace_id) != ae.workspace_id
        || intent.outcome.is_some()
    {
        return Err(unavailable(
            "Canvas intent does not belong to this execution",
        ));
    }
    // Withdraw also reads while the binding re-verifies NIP-11: settling an already signed
    // event is not a new write into the Community.
    let control = control_client(service, ae.tenant_id, ProjectionDirection::Withdraw).await;
    let observed = match control {
        Ok((control, _)) if control.pubkey_hex() == intent.control_pubkey => control
            .event_exists(&service.relay_http, &intent.event_id)
            .await
            .ok(),
        _ => None,
    };
    if !apply_observation(&mut tx, &ae, &definition, &intent, observed).await? {
        tx.commit().await?;
        return Ok((StatusCode::ACCEPTED, ae.submission()));
    }
    tx.commit().await?;
    let current = crate::governance::load_execution(&service.pool, id)
        .await?
        .ok_or_else(|| unavailable("Canvas operation not verifiable"))?;
    if current.dispatch_state == "ABORTED" {
        return Err(not_written(&current));
    }
    Ok((StatusCode::OK, current.submission()))
}

/// Only verified positive observation changes the existing intent. Missing and
/// unavailable ordinary reads have identical UNKNOWN semantics at every age.
async fn apply_observation(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ae: &Execution,
    definition: &Definition,
    intent: &Intent,
    observed: Option<bool>,
) -> Result<bool, Refusal> {
    if observed != Some(true) {
        return Ok(false);
    }
    let evidence = vec![Evidence::new(EvidenceKind::BuzzEventId, &intent.event_id)];
    sqlx::query(
        "update admission.workspace_canvas_intent
         set relay_ack = 'ACCEPTED', outcome = 'VERIFIED', settled_at = now()
         where action_execution_id = $1 and outcome is null",
    )
    .bind(ae.id)
    .execute(&mut **tx)
    .await?;
    audit(
        tx,
        ae,
        definition,
        Stage::outcome("verify", "VERIFIED"),
        evidence.clone(),
    )
    .await?;
    crate::governance::record_dispatch(tx, ae.id, definition.audit_class(), Ok(()), evidence)
        .await?;
    Ok(true)
}

/// A definite "the Canvas did not change": the caller may try again with a new key.
fn not_written(ae: &Execution) -> Refusal {
    let reason = ae
        .reason_code
        .as_deref()
        .and_then(crate::governance::parse::<ReasonCode>);
    match reason {
        Some(ReasonCode::PublishRejected) => Refusal::Denied(ReasonCode::PublishRejected),
        Some(ReasonCode::RateLimited) => Refusal::Limit(ReasonCode::RateLimited),
        _ => Refusal::Precondition(ReasonCode::DependencyUnavailable),
    }
}

/// Called by the existing publication reconciler tick (DD-81) with its batch.
/// It only reads back fixed event IDs; it never signs or delivers.
pub(crate) async fn reconcile(state: &ServiceState, batch: i64) -> Result<(), String> {
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "with selected as (
           select a.id from admission.action_execution a
           join admission.workspace_canvas_intent i on i.action_execution_id = a.id
           where a.action_key = $2 and a.gate_state = 'ALLOWED' and a.dispatch_state = 'UNKNOWN'
             and i.outcome is null
           order by coalesce(a.reconcile_last_attempt_at, a.updated_at), a.id
           limit $1 for update of a skip locked)
         update admission.action_execution a set reconcile_last_attempt_at = now()
         from selected where a.id = selected.id returning a.id",
    )
    .bind(batch)
    .bind(ACTION)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    for id in ids {
        if let Err(error) = finish(state, None, id).await {
            tracing::warn!(action_execution_id = %id,
                reason_code = %crate::governance::wire(&error.reason()),
                "Canvas event reconciliation incomplete; no re-sign or re-delivery");
        }
    }
    Ok(())
}

/// One lifecycle audit step of this action: its stable key suffix and recorded result.
struct Stage<'a> {
    key: &'a str,
    event_type: &'a str,
    decision: &'a str,
    result: &'a str,
}

impl<'a> Stage<'a> {
    fn outcome(key: &'a str, result: &'a str) -> Self {
        Self {
            key,
            event_type: "OUTCOME",
            decision: "ALLOW",
            result,
        }
    }
}

async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    definition: &Definition,
    stage: Stage<'_>,
    evidence: Vec<Evidence>,
) -> Result<(), Refusal> {
    crate::audit::append(
        tx,
        AuditEntry {
            event_key: format!("canvas-set:{}:{}", ae.operation_id, stage.key),
            tenant_id: Some(ae.tenant_id),
            workspace_id: ae.workspace_id,
            operation_id: ae.operation_id,
            event_type: stage.event_type,
            human_identity_id: None,
            initiator_principal_id: Some(ae.initiator_principal_id),
            actor_principal_id: Some(ae.actor_principal_id),
            action_key: &ae.action_key,
            action_version: ae.action_version,
            component_type_key: &definition.component_type_key,
            target_type: Some(&definition.target_type),
            target_id: Some(ae.target_id),
            parameter_hash: &ae.parameter_hash,
            decision: stage.decision,
            result_code: stage.result,
            result_exposure: "NONE",
            evidence_refs: evidence,
            correlation_id: ae.correlation_id,
        },
    )
    .await?;
    Ok(())
}

/// The newest CONTROL-authored Canvas among Relay rows; anything else is ignored.
fn adopted<'a>(
    events: &'a [nostr::Event],
    channel: &str,
    control: &str,
) -> Option<&'a nostr::Event> {
    events
        .iter()
        .filter(|event| {
            event.kind.as_u16() == KIND_CANVAS
                && event.pubkey.to_hex() == control
                && event.verify().is_ok()
                && event.content.len() <= MAX_CANVAS_BYTES
                && single_channel_scope(event, channel)
        })
        .max_by(|a, b| {
            a.created_at
                .cmp(&b.created_at)
                .then_with(|| b.id.to_hex().cmp(&a.id.to_hex()))
        })
}

/// Original Canvas scope: exactly one two-element `h` tag naming this Channel.
fn single_channel_scope(event: &nostr::Event, channel: &str) -> bool {
    let mut scopes = event
        .tags
        .iter()
        .map(nostr::Tag::as_slice)
        .filter(|tag| tag.first().is_some_and(|name| name == "h"));
    let first = scopes.next();
    scopes.next().is_none() && first.is_some_and(|tag| tag.len() == 2 && tag[1] == channel)
}

/// `GET /api/v1/workspaces/{workspace_id}/canvas` (V-SCN-135).
pub async fn read(
    State(state): State<BffState>,
    Path(workspace_id): Path<Uuid>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let scope = match admit_workspace(&state, &ctx, workspace_id).await {
        Ok(scope) => scope,
        Err(response) => return response,
    };
    let control: Option<String> = match sqlx::query_scalar(
        "select i.pubkey from projection.tenant_buzz_binding b
         join identity.buzz_identity_binding i
           on i.tenant_id = b.tenant_id and i.principal_id = b.control_service_principal_id
         where b.tenant_id = $1 and b.normalized_host = $2 and b.state = 'ACTIVE'
           and i.state = 'ACTIVE' and i.custody = 'SERVER'",
    )
    .bind(ctx.tenant_id)
    .bind(&scope.community_host)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(value) => value,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    let Some(control) = control else {
        return RelayCheck::Mismatch.into_response();
    };
    let keys = match actor_keys(&state, &ctx).await {
        Ok(keys) => keys,
        Err(response) => return response,
    };
    let client = match community_client(&state, &keys, &scope.community_host) {
        Ok(client) => client,
        Err(response) => return response,
    };
    if let Err(error) = community_limits(&state, &scope.community_host).await {
        return error.into_response();
    }
    let filter = json!({"kinds": [KIND_CANVAS], "#h": [scope.channel_id],
        "authors": [control], "limit": 1});
    let page = match client.query(&state.relay_http, &[filter]).await {
        Ok(page) => page,
        Err(error) => return relay_error_response(&error, None),
    };
    let Ok(events) = serde_json::from_value::<Vec<nostr::Event>>(page) else {
        return StatusCode::BAD_GATEWAY.into_response();
    };
    let mut view = contracts::WebChannelCanvasView {
        workspace_id: workspace_id.to_string(),
        content: None,
        event_id: None,
        created_at: None,
        set_action_key: None,
    };
    if let Some(event) = adopted(&events, &scope.channel_id, &control) {
        view.content = Some(event.content.clone());
        view.event_id = Some(event.id.to_hex());
        view.created_at = i64::try_from(event.created_at.as_secs())
            .ok()
            .and_then(|secs| chrono::DateTime::from_timestamp(secs, 0))
            .map(|t| t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
    }
    match offered(&state, &ctx, workspace_id).await {
        Ok(true) => view.set_action_key = Some(ACTION.to_owned()),
        Ok(false) => {}
        Err(response) => return response,
    }
    // The read is external I/O: answer only if the same admission still holds.
    match admit_workspace(&state, &ctx, workspace_id).await {
        Ok(current)
            if current.channel_id == scope.channel_id
                && current.community_host == scope.community_host
                && current.admission_epoch == scope.admission_epoch =>
        {
            Json(view).into_response()
        }
        Ok(_) => RelayCheck::Mismatch.into_response(),
        Err(response) => response,
    }
}

/// The edit hint (original canEditNarrative): the catalog row is open, the Workspace is
/// ACTIVE and a fresh Workspace `manage` check holds. Submission re-admits regardless.
async fn offered(
    state: &BffState,
    ctx: &ExecutionContext,
    workspace: Uuid,
) -> Result<bool, Response> {
    if !crate::capability_registry::action_exposed(ACTION) {
        return Ok(false);
    }
    let definition = crate::governance::active_definition(&state.pool, ACTION)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    if definition.is_none_or(|d| validate_definition(&d).is_err()) {
        return Ok(false);
    }
    let active: Option<i32> = sqlx::query_scalar(
        "select 1 from identity.workspace where id = $1 and tenant_id = $2 and state = 'ACTIVE'",
    )
    .bind(workspace)
    .bind(ctx.tenant_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    if active.is_none() {
        return Ok(false);
    }
    let allowed = state
        .governance
        .spicedb
        .check_bulk(
            "workspace",
            &[workspace.to_string()],
            "manage",
            &ctx.tenant_principal_id.to_string(),
        )
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    Ok(allowed.contains(&workspace.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn canvas(keys: &nostr::Keys, channel: &str, content: &str, at: u64) -> nostr::Event {
        nostr::EventBuilder::new(nostr::Kind::Custom(KIND_CANVAS), content)
            .tags([nostr::Tag::parse(["h", channel]).unwrap()])
            .custom_created_at(nostr::Timestamp::from(at))
            .sign_with_keys(keys)
            .unwrap()
    }

    #[test]
    fn reads_adopt_only_the_newest_control_canvas_of_this_channel() {
        let control = nostr::Keys::generate();
        let member = nostr::Keys::generate();
        let channel = Uuid::new_v4().to_string();
        let other = Uuid::new_v4().to_string();
        let events = vec![
            canvas(&control, &channel, "old", 10),
            canvas(&control, &channel, "current", 20),
            // A newer member-signed 40100 must never be adopted (V-SCN-135).
            canvas(&member, &channel, "forged", 30),
            canvas(&control, &other, "other channel", 40),
        ];
        let picked = adopted(&events, &channel, &control.public_key().to_hex()).unwrap();
        assert_eq!(picked.content, "current");
        assert!(adopted(&events[2..3], &channel, &control.public_key().to_hex()).is_none());
    }

    #[test]
    fn command_digest_freezes_target_and_body_without_the_body() {
        let workspace = Uuid::new_v4();
        let a = command_digest(workspace, &content_digest("# One"));
        assert_eq!(a, command_digest(workspace, &content_digest("# One")));
        assert_ne!(a, command_digest(workspace, &content_digest("# Two")));
        assert_ne!(a, command_digest(Uuid::new_v4(), &content_digest("# One")));
        assert!(!a.contains("One"));
    }

    fn command(value: Value) -> ActionCommand {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn parse_accepts_only_the_canvas_fields_with_explicit_confirmation() {
        let workspace = Uuid::new_v4();
        let base = json!({"actionKey": ACTION, "idempotencyKey": Uuid::new_v4(),
            "workspaceId": workspace, "explicitConfirmation": true,
            "workspaceCanvas": {"content": "# Canvas"}});
        let parsed = command(base.clone());
        let ok = parse(&parsed).ok().unwrap();
        assert_eq!(ok.workspace, workspace);
        assert_eq!(ok.content, "# Canvas");
        let mut unconfirmed = base.clone();
        unconfirmed
            .as_object_mut()
            .unwrap()
            .remove("explicitConfirmation");
        assert!(parse(&command(unconfirmed)).is_err());
        let mut extra = base.clone();
        extra["name"] = json!("not a canvas field");
        assert!(parse(&command(extra)).is_err());
        let mut missing = base.clone();
        missing.as_object_mut().unwrap().remove("workspaceCanvas");
        assert!(parse(&command(missing)).is_err());
        let mut large = base;
        large["workspaceCanvas"]["content"] = json!("x".repeat(MAX_CANVAS_BYTES + 1));
        assert!(matches!(
            parse(&command(large)),
            Err(Refusal::Limit(ReasonCode::PayloadTooLarge))
        ));
    }

    #[tokio::test]
    #[ignore = "requires PUBLICATION_ABSENCE_TEST_DATABASE_URL pointing at an isolated migrated database"]
    async fn historical_absence_canvas_replay_stays_unknown_until_positive_evidence() {
        let mut tx = crate::agent_profile::tests::absence_fixture().await;
        let id: Uuid =
            sqlx::query_scalar("select id from absence_fixture where label='canvas-false'")
                .fetch_one(&mut *tx)
                .await
                .unwrap();
        let ae = crate::governance::lock_execution(&mut tx, id)
            .await
            .unwrap();
        assert_eq!(ae.dispatch_state, "UNKNOWN");
        assert!(ae.reason_code.is_none());
        let definition: Definition = sqlx::query_as(&format!(
            "select {} from catalog.action_definition where action_key=$1 and version=1",
            crate::governance::DEFINITION_COLUMNS
        ))
        .bind(ACTION)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        let intent: Intent = sqlx::query_as("select action_execution_id,tenant_id,workspace_id,channel_id,control_pubkey,event_id,event_created_at,outcome from admission.workspace_canvas_intent where action_execution_id=$1").bind(id).fetch_one(&mut *tx).await.unwrap();
        assert_eq!(
            intent.event_created_at, 1,
            "old signed time cannot establish absence"
        );
        for observed in [Some(false), None] {
            assert!(
                !apply_observation(&mut tx, &ae, &definition, &intent, observed)
                    .await
                    .unwrap()
            );
            let current = crate::governance::lock_execution(&mut tx, id)
                .await
                .unwrap();
            assert_eq!(current.dispatch_state, "UNKNOWN");
            let outcome: Option<String> = sqlx::query_scalar("select outcome from admission.workspace_canvas_intent where action_execution_id=$1").bind(id).fetch_one(&mut *tx).await.unwrap();
            assert!(outcome.is_none());
        }
        assert!(
            apply_observation(&mut tx, &ae, &definition, &intent, Some(true))
                .await
                .unwrap()
        );
        let current = crate::governance::lock_execution(&mut tx, id)
            .await
            .unwrap();
        assert_eq!(current.dispatch_state, "DISPATCHED");
        let audit: Vec<(String,String)> = sqlx::query_as("select event_type,result_code from audit.audit_event where operation_id=$1 order by event_key").bind(ae.operation_id).fetch_all(&mut *tx).await.unwrap();
        assert!(audit.contains(&("RECONCILIATION".into(), "NOT_DELIVERED".into())));
        assert!(audit.contains(&("RECONCILIATION".into(), "UNKNOWN".into())));
        assert!(audit.contains(&("OUTCOME".into(), "VERIFIED".into())));
        sqlx::query("savepoint cannot_restore_false_negative")
            .execute(&mut *tx)
            .await
            .unwrap();
        assert!(
            sqlx::raw_sql(include_str!(
                "../../../migrations/20261101010000_publication_absence_correction.down.sql"
            ))
            .execute(&mut *tx)
            .await
            .is_err(),
            "rollback cannot revive the false terminal"
        );
        sqlx::query("rollback to savepoint cannot_restore_false_negative")
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.rollback().await.unwrap();
    }
}
