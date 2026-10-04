//! DD-66/68, 19 §5/6/8. HUMAN ownership is authority; the Installation
//! AGENT key only signs the native event. Core persists references, not bodies.

use super::{lock_read_context, read_counterparty, unavailable, Binding};
use axum::http::StatusCode;
use collab_bridge::{
    bridge::{Custody, Delivery, IdentityClient},
    limits::fetch_nip11,
    memory::{Head, Reader},
    memory_write::{self, Body, Prepared, WriteError},
};
use contracts::{ActionCommand, ActionSubmission, ErrorClass, EvidenceKind, ReasonCode};
use secret_store::SecretRef;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    audit::{AuditEntry, Evidence},
    bff::{BffState, ExecutionContext},
    governance::{
        Actor, DecisionSubject, Definition, Evaluation, Execution, Governance, Refusal, Target,
    },
};

pub(crate) fn is_action(key: &str) -> bool {
    matches!(
        key,
        "agent.memory.core.replace"
            | "agent.memory.entry.set"
            | "agent.memory.entry.patch"
            | "agent.memory.entry.remove"
    )
}

#[derive(sqlx::FromRow)]
struct Intent {
    action_execution_id: Uuid,
    installation_resource_id: Uuid,
    binding_digest: String,
    native_address: String,
    event_id: String,
    created_at: i64,
    old_head_event_id: Option<String>,
    body_digest: String,
    plaintext_bytes: i64,
    relay_ack: String,
    observed_head_event_id: Option<String>,
    outcome: Option<String>,
}

impl Governance {
    /// Original /api/v1/actions business consumer. The generated command body
    /// is transient: neither Params, history, audit nor outbox receive it.
    pub(crate) async fn submit_memory(
        &self,
        state: &BffState,
        ctx: &ExecutionContext,
        cmd: &ActionCommand,
    ) -> Result<(StatusCode, ActionSubmission), (Refusal, Option<Uuid>)> {
        let result = tokio::time::timeout(
            state.memory_service.agent_memory.read_timeout,
            self.memory_command(state, ctx, cmd),
        )
        .await
        .unwrap_or_else(|_| Err(unavailable("Memory 原 operation 读写/对账超时；禁止重发")));
        // Keep the original operation reachable even when a native dependency
        // failed after write-ahead persistence. No new key or replay path.
        match result {
            Ok(result) => Ok(result),
            Err(error) => match record_attempt_failure(state, ctx, cmd, &error).await {
                Ok(operation) => Err((error, operation)),
                Err(audit_error) => Err((audit_error, None)),
            },
        }
    }

    async fn memory_command(
        &self,
        state: &BffState,
        ctx: &ExecutionContext,
        cmd: &ActionCommand,
    ) -> Result<(StatusCode, ActionSubmission), Refusal> {
        if !is_action(&cmd.action_key)
            || ctx.access_mode != contracts::PlatformSessionAccessMode::Full
        {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        let raw = serde_json::to_value(cmd).map_err(|_| invalid())?;
        let valid = raw.as_object().is_some_and(|fields| {
            fields.iter().all(|(key, value)| {
                value.is_null()
                    || matches!(
                        key.as_str(),
                        "actionKey"
                            | "idempotencyKey"
                            | "resourceId"
                            | "resourceVersion"
                            | "workspaceId"
                            | "memoryWrite"
                    )
            })
        });
        if !valid {
            return Err(invalid());
        }
        let installation = parse_uuid(cmd.resource_id.as_deref().ok_or_else(invalid)?)?;
        let workspace = parse_uuid(cmd.workspace_id.as_deref().ok_or_else(invalid)?)?;
        let version = cmd
            .resource_version
            .and_then(|v| i32::try_from(v).ok())
            .filter(|v| *v > 0)
            .ok_or_else(invalid)?;
        let key = parse_uuid(&cmd.idempotency_key)?;
        let input = raw
            .get("memoryWrite")
            .filter(|v| v.is_object())
            .ok_or_else(invalid)?;
        let slug = input["slug"].as_str().ok_or_else(invalid)?;
        collab_bridge::memory::validate_slug(slug).map_err(|_| invalid())?;
        if (cmd.action_key == "agent.memory.core.replace") != (slug == "core") {
            return Err(invalid());
        }
        let request_digest = collab_bridge::limits::canonical_digest(&raw);
        let existing: Option<Uuid> = sqlx::query_scalar(
            "select id from admission.action_execution where tenant_id=$1
             and initiator_principal_id=$2 and idempotency_key=$3",
        )
        .bind(ctx.tenant_id)
        .bind(ctx.tenant_principal_id)
        .bind(key)
        .fetch_optional(&state.pool)
        .await?;
        if let Some(id) = existing {
            let ae = crate::governance::load_execution(&state.pool, id)
                .await?
                .ok_or_else(|| unavailable("Memory 原 operation 不可查证"))?;
            if ae.action_key != cmd.action_key
                || ae.target_id != installation
                || ae.workspace_id != Some(workspace)
                || ae
                    .parameters
                    .as_ref()
                    .and_then(|p| p["commandDigest"].as_str())
                    != Some(&request_digest)
            {
                return Err(Refusal::Conflict(ReasonCode::IdempotencyKeyReused));
            }
            // Only read the SAME native ID; even no observed event does not
            // authorize regenerating, signing or delivering another event.
            if let Some(refusal) = admission_refusal(&ae)? {
                return Err(refusal);
            }
            return finish(state, Some(ctx), id).await;
        }
        if !crate::capability_registry::action_exposed(&cmd.action_key) {
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        }
        let definition = crate::governance::active_definition(&state.pool, &cmd.action_key)
            .await?
            .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
        validate_definition(&definition)?;
        let mut tx = state.pool.begin().await?;
        let binding = lock_read_context(ctx, installation, &mut tx).await?;
        // The first lookup raced before the Tenant fence. A concurrent caller
        // may now have committed this SAME key. Read its immutable identity,
        // release the Tenant lock, then recover in the normal AE->Tenant order.
        let won: Option<Execution> = sqlx::query_as(&format!(
            "select {} from admission.action_execution where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3",
            crate::governance::EXECUTION_COLUMNS))
            .bind(ctx.tenant_id).bind(ctx.tenant_principal_id).bind(key).fetch_optional(&mut *tx).await?;
        if let Some(ae) = won {
            if ae.action_key != cmd.action_key
                || ae.target_id != installation
                || ae.workspace_id != Some(workspace)
                || ae
                    .parameters
                    .as_ref()
                    .and_then(|p| p["commandDigest"].as_str())
                    != Some(request_digest.as_str())
            {
                return Err(Refusal::Conflict(ReasonCode::IdempotencyKeyReused));
            }
            tx.rollback().await?;
            if let Some(refusal) = admission_refusal(&ae)? {
                return Err(refusal);
            }
            return finish(state, Some(ctx), ae.id).await;
        }
        if binding.workspace_id != workspace || binding.resource_version != version {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
        owner(ctx, &binding, &mut tx).await?;
        let target = Target {
            id: installation,
            version,
            workspace_id: Some(workspace),
        };
        let mut checked = self.evaluate(actor(ctx), &definition, &target).await?;
        let billing = write_billing(state, &binding, &mut tx).await?;
        self.check_quota(ctx.tenant_id, &definition, &mut checked)
            .await?;
        if !checked.allowed {
            return Err(rejected(checked.reason));
        }
        let keys = read_counterparty(&state.memory_service, &binding)
            .await
            .map_err(|_| unavailable("Memory 写 pair/SecretRef 不可查证"))?;
        let reader_client = counterparty_client(state, &binding, &keys)?;
        let nip11 = native_limits(state, &binding).await?;
        let reader = Reader::new(
            &reader_client,
            &keys,
            &binding.agent_pubkey,
            &nip11.limits,
            state.memory_service.agent_memory.limits,
        )
        .map_err(|_| unavailable("Memory native read 不可查证"))?;
        let now = now()?;
        let snapshot = reader
            .inspect(&state.http, now)
            .await
            .map_err(|_| unavailable("Memory 写前完整原生 head 不可查证"))?;
        if snapshot.head_ahead_of_relay {
            super::record(
                &mut tx,
                &binding,
                Some(&snapshot),
                "COMPLETE",
                "HEAD_AHEAD_OF_RELAY",
                "ERROR",
            )
            .await?;
            tx.commit().await?;
            return Err(Refusal::Precondition(ReasonCode::TargetStateConflict));
        }
        let current = if slug == "core" {
            reader.read_core_entry(&state.http, now).await
        } else {
            reader.read_entry(&state.http, slug, now).await
        }
        .map_err(|_| unavailable("Memory 写前原生 body 不可查证"))?;
        let head = current.as_ref().map(|e| &e.head);
        let head_id = input
            .get("expectedHeadEventId")
            .filter(|v| !v.is_null())
            .map(|v| v.as_str().ok_or_else(invalid))
            .transpose()?;
        let expected_state = input["expectedHeadState"].as_str().ok_or_else(invalid)?;
        let found = current.as_ref().is_some_and(|e| e.value.is_some());
        if !matches!(expected_state, "FOUND" | "ABSENT")
            || (expected_state == "FOUND") != found
            || head.map(|h| h.event_id.as_str()) != head_id
        {
            let error = Refusal::Conflict(ReasonCode::TargetStateConflict);
            record_failed_intent(state, ctx, cmd, &error, head, Some(&checked), &mut tx).await?;
            tx.commit().await?;
            return Err(error);
        }
        let body = match input_body(
            &cmd.action_key,
            input,
            current.as_ref().and_then(|e| e.value.as_deref()),
        ) {
            Ok(body) => body,
            Err(error) => {
                record_failed_intent(state, ctx, cmd, &error, head, Some(&checked), &mut tx)
                    .await?;
                tx.commit().await?;
                return Err(error);
            }
        };
        let digest = hex::encode(Sha256::digest(body.to_json_bytes()));
        let agent = agent_keys(state, &binding).await?;
        let prepared = memory_write::prepare(
            &state.http,
            &reader,
            &agent,
            &keys.public_key(),
            body,
            head_id,
            (
                now,
                state
                    .memory_service
                    .agent_memory
                    .limits
                    .relay_timestamp_window_seconds,
            ),
        )
        .await
        .map_err(write_error)?;
        if prepared.plaintext_bytes > state.memory_service.agent_memory.limits.plaintext_bytes {
            return Err(Refusal::Limit(ReasonCode::PayloadTooLarge));
        }
        let bytes = i64::try_from(prepared.plaintext_bytes).map_err(|_| invalid())?;
        let parameters = json!({"commandDigest":request_digest,"slugDigest":hash(slug),
            "targetVersion":version,"platformSessionId":ctx.session_id,"memoryUsage":billing});
        let parameter_hash =
            collab_bridge::limits::canonical_digest(&json!({"actionKey":cmd.action_key,
            "actionVersion":definition.version,"targetId":installation,"parameters":parameters}));
        let ae = crate::governance::open_execution_values(
            &mut tx,
            actor(ctx),
            ctx.tenant_principal_id,
            &definition,
            &target,
            parameters,
            parameter_hash,
            key,
            None,
        )
        .await?;
        crate::governance::record_decision(
            &mut tx,
            &subject(&ae),
            "ADMISSION",
            checked.scope,
            checked.authorization,
            "NOT_APPLICABLE",
            checked.quota,
            checked.zed_token.as_deref(),
            None,
        )
        .await?;
        sqlx::query("update admission.action_execution set gate_state='ALLOWED',updated_at=now() where id=$1")
            .bind(ae.id).execute(&mut *tx).await?;
        sqlx::query("insert into projection.agent_memory_write
            (action_execution_id,installation_resource_id,binding_digest,native_address,event_id,created_at,
             old_head_event_id,body_digest,plaintext_bytes,relay_ack)
            values($1,$2,$3,$4,$5,$6,$7,$8,$9,'UNKNOWN')")
            .bind(ae.id).bind(installation).bind(binding_digest(&binding)).bind(&prepared.native_address)
            .bind(prepared.event_id()).bind(i64::try_from(prepared.created_at()).map_err(|_| invalid())?)
            .bind(prepared.old_head.as_ref().map(|h| &h.event_id)).bind(&digest).bind(bytes)
            .execute(&mut *tx).await?;
        crate::governance::record_dispatch(
            &mut tx,
            ae.id,
            definition.audit_class(),
            Err(StatusCode::SERVICE_UNAVAILABLE),
            vec![Evidence::new(
                EvidenceKind::BuzzEventId,
                prepared.event_id(),
            )],
        )
        .await?;
        tx.commit().await?;
        // This call owns the sole transient event. A second/restarted request
        // never receives Prepared and can only execute finish(), above.
        dispatch(state, ctx, &ae, &definition, &binding, &prepared).await?;
        finish(state, Some(ctx), ae.id).await
    }
}

/// Every explicit failed attempt is recorded through the same Action/Audit
/// authority. No intent means the ONE native deliver could never have run.
async fn record_attempt_failure(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &ActionCommand,
    error: &Refusal,
) -> Result<Option<Uuid>, Refusal> {
    let Ok(key) = parse_uuid(&cmd.idempotency_key) else {
        return Ok(None);
    };
    let mut tx = state.pool.begin().await?;
    let mut existing: Option<Execution> = sqlx::query_as(&format!(
        "select {} from admission.action_execution where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3 for update",
        crate::governance::EXECUTION_COLUMNS))
        .bind(ctx.tenant_id).bind(ctx.tenant_principal_id).bind(key).fetch_optional(&mut *tx).await?;
    let tenant: Option<Uuid> =
        sqlx::query_scalar("select id from identity.tenant where id=$1 for update")
            .bind(ctx.tenant_id)
            .fetch_optional(&mut *tx)
            .await?;
    if tenant.is_none() {
        return Ok(None);
    }
    if existing.is_none() {
        // A concurrent caller may have committed while this one waited for
        // Tenant. Never reverse AE->Tenant by acquiring its AE here.
        let raced: Option<Uuid> = sqlx::query_scalar(
            "select id from admission.action_execution
            where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3",
        )
        .bind(ctx.tenant_id)
        .bind(ctx.tenant_principal_id)
        .bind(key)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(id) = raced {
            tx.rollback().await?;
            tx = state.pool.begin().await?;
            existing = Some(crate::governance::lock_execution(&mut tx, id).await?);
            sqlx::query("select id from identity.tenant where id=$1 for update")
                .bind(ctx.tenant_id)
                .execute(&mut *tx)
                .await?;
        }
    }
    let operation = if let Some(ae) = existing {
        let definition =
            crate::governance::exact_definition(&state.pool, &ae.action_key, ae.action_version)
                .await?;
        let digest = collab_bridge::limits::canonical_digest(
            &serde_json::to_value(cmd).map_err(|_| invalid())?,
        );
        // A repeated UNKNOWN or mismatched body records an attempt, never
        // changes the old admission, signed event, result or native evidence.
        append_failed_audit(&mut tx, ctx, &ae, &definition, error, &digest, None).await?;
        Some(ae.operation_id)
    } else {
        record_failed_intent(state, ctx, cmd, error, None, None, &mut tx).await?
    };
    tx.commit().await?;
    Ok(operation)
}

async fn record_failed_intent(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &ActionCommand,
    error: &Refusal,
    observed_head: Option<&Head>,
    checked: Option<&Evaluation>,
    tx: &mut Transaction<'_, Postgres>,
) -> Result<Option<Uuid>, Refusal> {
    let (Some(target), Some(workspace), Some(version)) = (
        cmd.resource_id
            .as_deref()
            .and_then(|s| Uuid::parse_str(s).ok()),
        cmd.workspace_id
            .as_deref()
            .and_then(|s| Uuid::parse_str(s).ok()),
        cmd.resource_version
            .and_then(|v| i32::try_from(v).ok())
            .filter(|v| *v > 0),
    ) else {
        return Ok(None);
    };
    let scoped: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.resource r
        join catalog.agent_installation i on i.resource_id=r.id
        where r.id=$1 and r.tenant_id=$2 and r.home_workspace_id=$3 and i.workspace_id=$3
        and r.type_key='agent.installation')",
    )
    .bind(target)
    .bind(ctx.tenant_id)
    .bind(workspace)
    .fetch_one(&mut **tx)
    .await?;
    if !scoped {
        return Ok(None);
    }
    let definition = crate::governance::active_definition(&state.pool, &cmd.action_key)
        .await?
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    let raw = serde_json::to_value(cmd).map_err(|_| invalid())?;
    let slug = raw["memoryWrite"]["slug"].as_str();
    let digest = collab_bridge::limits::canonical_digest(&raw);
    let parameters = json!({"commandDigest":digest,"slugDigest":slug.map(hash),
        "targetVersion":version,"platformSessionId":ctx.session_id,
        "refusalClass":error.class_status().0,
        "expectedHeadEventId":raw["memoryWrite"]["expectedHeadEventId"],
        "observedHeadEventId":observed_head.map(|h|&h.event_id)});
    let parameter_hash =
        collab_bridge::limits::canonical_digest(&json!({"actionKey":cmd.action_key,
        "actionVersion":definition.version,"targetId":target,"parameters":parameters}));
    let ae = crate::governance::open_execution_values(
        tx,
        actor(ctx),
        ctx.tenant_principal_id,
        &definition,
        &Target {
            id: target,
            version,
            workspace_id: Some(workspace),
        },
        parameters,
        parameter_hash,
        parse_uuid(&cmd.idempotency_key)?,
        None,
    )
    .await?;
    let unknown = matches!(error, Refusal::Unavailable(_));
    let reason = error.reason();
    // Record only checks that actually ran. NOT_APPLICABLE is the original
    // decision domain for an unperformed check; UNKNOWN is not in that domain.
    crate::governance::record_decision(
        tx,
        &subject(&ae),
        "ADMISSION",
        checked.map_or("NOT_APPLICABLE", |e| e.scope),
        checked.map_or("NOT_APPLICABLE", |e| e.authorization),
        "NOT_APPLICABLE",
        checked.map_or("NOT_APPLICABLE", |e| e.quota),
        checked.and_then(|e| e.zed_token.as_deref()),
        Some(&reason),
    )
    .await?;
    sqlx::query("update admission.action_execution set gate_state=$2,reason_code=$3,updated_at=now() where id=$1")
        .bind(ae.id).bind(if unknown {"EVALUATING"} else {"DENIED"})
        .bind(crate::governance::wire(&reason)).execute(&mut **tx).await?;
    append_failed_audit(tx, ctx, &ae, &definition, error, &digest, observed_head).await?;
    Ok(Some(ae.operation_id))
}

fn admission_refusal(ae: &Execution) -> Result<Option<Refusal>, Refusal> {
    if ae.gate_state == "EVALUATING" {
        return Ok(Some(unavailable(
            "Memory 原准入依赖未知；只查原 operation，不重发",
        )));
    }
    if ae.gate_state == "EXPIRED" {
        return Ok(Some(Refusal::Precondition(ReasonCode::AdmissionAbandoned)));
    }
    if ae.gate_state != "DENIED" {
        return Ok(None);
    }
    let reason = ae
        .reason_code
        .as_deref()
        .and_then(crate::governance::parse)
        .ok_or_else(|| unavailable("Memory 原拒绝原因不可识别"))?;
    let class: ErrorClass = ae
        .parameters
        .as_ref()
        .and_then(|p| p["refusalClass"].as_str())
        .and_then(crate::governance::parse)
        .ok_or_else(|| unavailable("Memory 原拒绝分类不可识别"))?;
    let refusal = match class {
        ErrorClass::Denied => Refusal::Denied(reason),
        ErrorClass::Blocked => Refusal::Blocked(reason),
        ErrorClass::Precondition => Refusal::Precondition(reason),
        ErrorClass::Conflict => Refusal::Conflict(reason),
        ErrorClass::Limit => Refusal::Limit(reason),
        ErrorClass::Unknown => return Err(unavailable("Memory 确定拒绝与未知分类矛盾")),
    };
    Ok(Some(refusal))
}

async fn append_failed_audit(
    tx: &mut Transaction<'_, Postgres>,
    ctx: &ExecutionContext,
    ae: &Execution,
    definition: &Definition,
    error: &Refusal,
    digest: &str,
    head: Option<&Head>,
) -> Result<(), Refusal> {
    crate::audit::append(
        tx,
        AuditEntry {
            event_key: format!("memory-write:{}:pre-dispatch:{}", ae.operation_id, digest),
            tenant_id: Some(ae.tenant_id),
            workspace_id: ae.workspace_id,
            operation_id: ae.operation_id,
            event_type: "DECISION",
            human_identity_id: Some(ctx.human_identity_id),
            initiator_principal_id: Some(ctx.tenant_principal_id),
            actor_principal_id: Some(ctx.tenant_principal_id),
            action_key: &ae.action_key,
            action_version: ae.action_version,
            component_type_key: &definition.component_type_key,
            target_type: Some(&definition.target_type),
            target_id: Some(ae.target_id),
            parameter_hash: &ae.parameter_hash,
            decision: if matches!(error, Refusal::Unavailable(_)) {
                "UNKNOWN"
            } else {
                "DENY"
            },
            result_code: &crate::governance::wire(&error.reason()),
            result_exposure: "NONE",
            evidence_refs: head
                .map(|h| Evidence::new(EvidenceKind::BuzzEventId, &h.event_id))
                .into_iter()
                .collect(),
            correlation_id: ae.correlation_id,
        },
    )
    .await?;
    Ok(())
}

fn validate_definition(d: &Definition) -> Result<(), Refusal> {
    if !is_action(&d.action_key)
        || d.component_type_key != "core"
        || d.permission != "update"
        || d.permission_object_type != "resource"
        || d.target_type != "RESOURCE"
        || d.tenant_rule != "SESSION_TENANT"
        || d.workspace_rule != "WORKSPACE_REQUIRED"
        || d.execution_mode != "SYNC"
        || d.confirmation_mode != "NONE"
        || d.approval_policy_id.is_some()
        || d.approval_policy_version.is_some()
        || d.workflow_kind.is_some()
        || d.result_exposure != "NONE"
        || d.quota_policy != "CHECK"
        || d.meters != ["agent_memory_write_count", "agent_memory_plaintext_bytes"]
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    Ok(())
}

fn input_body(action: &str, input: &Value, current: Option<&str>) -> Result<Body, Refusal> {
    let slug = input["slug"].as_str().ok_or_else(invalid)?;
    let value = input.get("value").filter(|v| !v.is_null());
    let patch = input.get("patch").filter(|v| !v.is_null());
    let base = input.get("baseHash").filter(|v| !v.is_null());
    match action {
        "agent.memory.core.replace" if patch.is_none() && base.is_none() => Ok(Body::Core {
            profile: value.and_then(Value::as_str).ok_or_else(invalid)?.into(),
        }),
        "agent.memory.entry.set" if patch.is_none() && base.is_none() => Ok(Body::Memory {
            slug: slug.into(),
            value: Some(value.and_then(Value::as_str).ok_or_else(invalid)?.into()),
        }),
        "agent.memory.entry.remove"
            if patch.is_none() && base.is_none() && value.is_none() && current.is_some() =>
        {
            Ok(Body::Memory {
                slug: slug.into(),
                value: None,
            })
        }
        "agent.memory.entry.patch" if value.is_none() => {
            let current = current.ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
            let patch = patch.and_then(Value::as_str).ok_or_else(invalid)?;
            let base = base.and_then(Value::as_str).ok_or_else(invalid)?;
            let value = memory_write::apply_memory_patch(current, patch, Some(base)).map_err(
                |e| match e {
                    memory_write::MemoryPatchError::Conflict => {
                        Refusal::Conflict(ReasonCode::TargetStateConflict)
                    }
                    _ => invalid(),
                },
            )?;
            Ok(Body::Memory {
                slug: slug.into(),
                value: Some(value),
            })
        }
        _ => Err(invalid()),
    }
}

async fn owner(
    ctx: &ExecutionContext,
    binding: &Binding,
    conn: &mut PgConnection,
) -> Result<(), Refusal> {
    let owns: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.resource
        where id=$1 and tenant_id=$2 and owner_principal_id=$3 and state='ACTIVE' and version=$4)",
    )
    .bind(binding.installation_resource_id)
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .bind(binding.resource_version)
    .fetch_one(conn)
    .await?;
    if !owns {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    Ok(())
}

async fn write_billing(
    state: &BffState,
    binding: &Binding,
    conn: &mut PgConnection,
) -> Result<Value, Refusal> {
    let (customer, namespace, prefix, version): (String, String, String, i32) = sqlx::query_as(
        "select customer_id,namespace,subject_key_prefix,version from projection.openmeter_binding
         where tenant_id=$1 and status='ACTIVE' for update",
    )
    .bind(binding.tenant_id)
    .fetch_optional(conn)
    .await?
    .ok_or_else(|| unavailable("BILLING_UNAVAILABLE: Memory write 缺 Customer"))?;
    if namespace != state.memory_service.openmeter.namespace()
        || prefix != format!("{}:", binding.tenant_id)
        || version <= 0
    {
        return Err(unavailable(
            "BILLING_UNAVAILABLE: Memory write binding 不符",
        ));
    }
    let subject = format!("{prefix}{}", binding.installation_resource_id);
    let meters = state
        .memory_service
        .openmeter
        .memory_write_meters(binding.tenant_id, &customer, &subject)
        .await
        .map_err(|_| unavailable("BILLING_UNAVAILABLE: Memory write 原生 meters 不可查证"))?;
    Ok(
        json!({"namespace":namespace,"customer_id":customer,"binding_version":version,"subject":subject,"meters":meters}),
    )
}

async fn agent_keys(state: &BffState, binding: &Binding) -> Result<nostr::Keys, Refusal> {
    let reference = SecretRef {
        locator: binding
            .agent_locator
            .clone()
            .ok_or_else(|| unavailable("Memory AGENT SecretRef 缺失"))?,
        version: binding
            .agent_secret_version
            .and_then(|v| u32::try_from(v).ok())
            .filter(|v| *v > 0)
            .ok_or_else(|| unavailable("Memory AGENT SecretRef version 缺失"))?,
        audience: binding
            .agent_audience
            .clone()
            .ok_or_else(|| unavailable("Memory AGENT SecretRef audience 缺失"))?,
    };
    if reference.audience != state.memory_service.secret_audience
        || reference.locator
            != state.secrets.tenant_locator(
                binding.tenant_id,
                &format!(
                    "buzz-agent/installation/{}",
                    binding.installation_resource_id
                ),
            )
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    crate::server_identity::read_bound_keys(&state.secrets, &reference, &binding.agent_pubkey)
        .await
        .map_err(|_| unavailable("Memory AGENT key 不可查证"))
}

fn counterparty_client(
    state: &BffState,
    binding: &Binding,
    keys: &nostr::Keys,
) -> Result<IdentityClient, Refusal> {
    IdentityClient::new(
        Custody::Server,
        &keys.secret_key().to_secret_hex(),
        &state.relay_transport,
        &binding.normalized_host,
    )
    .map(|client| client.with_budget(state.relay_budget.clone()))
    .map_err(|_| unavailable("Memory CONTROL read transport 不可查证"))
}

async fn native_limits(
    state: &BffState,
    binding: &Binding,
) -> Result<collab_bridge::limits::Nip11Document, Refusal> {
    crate::service_api::audit_gate(&state.memory_service)
        .await
        .map_err(|_| unavailable("Memory audit 不可用"))?;
    let transport = reqwest::Url::parse(&state.relay_transport)
        .map_err(|_| unavailable("Memory Relay transport 不可用"))?;
    let nip11 = fetch_nip11(&state.http, &transport, &binding.normalized_host)
        .await
        .map_err(|_| unavailable("Memory NIP11 不可查证"))?;
    if binding.nip11_snapshot_digest.as_deref() != Some(nip11.digest.as_str()) {
        return Err(Refusal::Denied(ReasonCode::BindingNotActive));
    }
    Ok(nip11)
}

async fn dispatch(
    state: &BffState,
    ctx: &ExecutionContext,
    original: &Execution,
    definition: &Definition,
    original_binding: &Binding,
    prepared: &Prepared,
) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, original.id).await?;
    let binding = lock_read_context(ctx, ae.target_id, &mut tx).await?;
    owner(ctx, &binding, &mut tx).await?;
    if ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "UNKNOWN"
        || binding.resource_version != original_binding.resource_version
        || binding_digest(&binding) != binding_digest(original_binding)
    {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let mut checked = state
        .governance
        .evaluate(
            actor(ctx),
            definition,
            &Target {
                id: ae.target_id,
                version: binding.resource_version,
                workspace_id: Some(binding.workspace_id),
            },
        )
        .await?;
    if ae.parameters.as_ref().and_then(|p| p.get("memoryUsage"))
        != Some(&write_billing(state, &binding, &mut tx).await?)
    {
        return Err(unavailable("BILLING_UNAVAILABLE: Memory write pin 已改变"));
    }
    read_counterparty(&state.memory_service, &binding)
        .await
        .map_err(|_| unavailable("Memory dispatch pair 已失效"))?;
    native_limits(state, &binding).await?;
    state
        .governance
        .check_quota(ae.tenant_id, definition, &mut checked)
        .await?;
    crate::governance::record_decision(
        &mut tx,
        &subject(&ae),
        "RECHECK",
        checked.scope,
        checked.authorization,
        "NOT_APPLICABLE",
        checked.quota,
        checked.zed_token.as_deref(),
        checked.reason.as_ref(),
    )
    .await?;
    if !checked.allowed {
        return Err(rejected(checked.reason));
    }
    let keys = agent_keys(state, &binding).await?;
    let agent = IdentityClient::new(
        Custody::Server,
        &keys.secret_key().to_secret_hex(),
        &state.relay_transport,
        &binding.normalized_host,
    )
    .map_err(|_| unavailable("Memory AGENT dispatch transport 不可用"))?
    .with_budget(state.relay_budget.clone());
    let session_current: bool = sqlx::query_scalar(
        "select exists(select 1 from identity.platform_session
        where id=$1 and status='ACTIVE' and expires_at>clock_timestamp())",
    )
    .bind(ctx.session_id)
    .fetch_one(&mut *tx)
    .await?;
    if !session_current {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    // Hold the original lifecycle/member/key fence through the ONE external call.
    let delivery = tokio::time::timeout(
        state.memory_service.agent_memory.read_timeout,
        prepared.deliver(&state.http, &agent),
    )
    .await;
    let ack = match delivery {
        Ok(Ok(Delivery::Accepted)) => "ACCEPTED",
        Ok(Ok(Delivery::Rejected(_))) => "REJECTED",
        _ => "UNKNOWN",
    };
    sqlx::query("update projection.agent_memory_write set relay_ack=$2 where action_execution_id=$1 and relay_ack='UNKNOWN'")
        .bind(ae.id).bind(ack).execute(&mut *tx).await?;
    memory_audit(
        &mut tx,
        &ae,
        definition,
        "ack",
        ack,
        &[Evidence::new(
            EvidenceKind::BuzzEventId,
            prepared.event_id(),
        )],
    )
    .await?;
    if ack == "REJECTED" {
        crate::governance::record_dispatch(
            &mut tx,
            ae.id,
            definition.audit_class(),
            Err(StatusCode::CONFLICT),
            Vec::new(),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Both idempotent HTTP requests and the existing governance reconciler call
/// this read-only native recovery. There is no deliver/re-sign branch here.
async fn finish(
    state: &BffState,
    ctx: Option<&ExecutionContext>,
    id: Uuid,
) -> Result<(StatusCode, ActionSubmission), Refusal> {
    let mut tx = state.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, id).await?;
    if ctx.is_some_and(|ctx| {
        ae.tenant_id != ctx.tenant_id || ae.initiator_principal_id != ctx.tenant_principal_id
    }) {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let definition =
        crate::governance::exact_definition(&state.pool, &ae.action_key, ae.action_version).await?;
    validate_definition(&definition)?;
    let intent: Intent = sqlx::query_as(
        "select * from projection.agent_memory_write where action_execution_id=$1 for update",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    if intent.action_execution_id != ae.id {
        return Err(unavailable("Memory 原 native intent 不属于同执行"));
    }
    if intent.relay_ack == "REJECTED" {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    if ae.gate_state != "ALLOWED" || !matches!(ae.dispatch_state.as_str(), "UNKNOWN" | "DISPATCHED")
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let binding = recovery_binding(state, ctx, &ae, &definition, &mut tx).await?;
    if binding_digest(&binding) != intent.binding_digest
        || intent.installation_resource_id != ae.target_id
    {
        return Err(unavailable("Memory UNKNOWN 原 pair 已变化"));
    }
    let keys = read_counterparty(&state.memory_service, &binding)
        .await
        .map_err(|_| unavailable("Memory 原 pair secret 不可查证"))?;
    let client = counterparty_client(state, &binding, &keys)?;
    let nip11 = native_limits(state, &binding).await?;
    let reader = Reader::new(
        &client,
        &keys,
        &binding.agent_pubkey,
        &nip11.limits,
        state.memory_service.agent_memory.limits,
    )
    .map_err(|_| unavailable("Memory 原 native head 不可查证"))?;
    let observed = memory_write::observed_event(
        &state.http,
        &client,
        &keys,
        &binding.agent_pubkey,
        memory_write::ExpectedEvent {
            event_id: &intent.event_id,
            created_at: u64::try_from(intent.created_at).map_err(|_| invalid())?,
            plaintext_bytes: usize::try_from(intent.plaintext_bytes).map_err(|_| invalid())?,
            body_digest: &intent.body_digest,
        },
    )
    .await
    .map_err(|_| unavailable("Memory 固定 event 原生查证未知"))?;
    if observed.as_ref().is_some_and(|body| {
        hash(body.slug())
            != ae
                .parameters
                .as_ref()
                .and_then(|p| p["slugDigest"].as_str())
                .unwrap_or("")
    }) {
        return Err(unavailable("Memory 固定 event slug 不匹配"));
    }
    if observed.is_none() && intent.relay_ack != "ACCEPTED" {
        return Err(unavailable("Memory 原 event 未获 ACK/原生证据；禁止重发"));
    }
    let head = memory_write::head_at_address(&state.http, &reader, &intent.native_address, now()?)
        .await
        .map_err(|_| unavailable("Memory 写后完整 head 对账未知"))?
        .ok_or_else(|| unavailable("Memory 写后 head 集合为空；结果未知"))?;
    let observed_outcome = if head.event_id == intent.event_id {
        "VERIFIED"
    } else {
        "CONFLICT"
    };
    let outcome = match intent.outcome.as_deref() {
        Some("VERIFIED") => "VERIFIED",
        Some("CONFLICT") => "CONFLICT",
        None => observed_outcome,
        _ => return Err(unavailable("Memory 原结果未知")),
    };
    // Keep the FIRST verified native head: later writes do not replace the
    // old action's immutable result, usage or dispatch evidence.
    let observed_id = intent
        .observed_head_event_id
        .as_deref()
        .unwrap_or(&head.event_id);
    if intent.observed_head_event_id.is_none() {
        sqlx::query("update projection.agent_memory_write set relay_ack='ACCEPTED',observed_head_event_id=$2,outcome=$3
            where action_execution_id=$1 and observed_head_event_id is null")
            .bind(ae.id).bind(observed_id).bind(outcome).execute(&mut *tx).await?;
        let evidence = native_evidence(&intent, observed_id);
        memory_audit(&mut tx, &ae, &definition, "verify", outcome, &evidence).await?;
        write_usage(&mut tx, &ae, &intent, outcome, &evidence).await?;
    }
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "select id from outbox.usage_event where source_type='BUZZ_AGENT_MEMORY'
        and source_id=$1 and tenant_id=$2 and operation_id=$3 order by id",
    )
    .bind(ae.id)
    .bind(ae.tenant_id)
    .bind(ae.operation_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    let stored = tokio::time::timeout(
        state.memory_service.agent_memory.read_timeout,
        super::confirm_memory_usage(&state.memory_service, &ae, &ids),
    )
    .await;
    if !matches!(stored, Ok(Ok(true))) {
        return Err(unavailable(
            "BILLING_UNAVAILABLE: Memory write 无原生 stored 证据",
        ));
    }
    let mut tx = state.pool.begin().await?;
    let current = crate::governance::lock_execution(&mut tx, ae.id).await?;
    recovery_binding(state, ctx, &ae, &definition, &mut tx).await?;
    crate::governance::record_dispatch(
        &mut tx,
        ae.id,
        definition.audit_class(),
        Ok(()),
        native_evidence(&intent, observed_id),
    )
    .await?;
    if outcome == "CONFLICT" {
        // The event really was published; do not lie by calling it ABORTED.
        // Its BUSINESS result is still a conflict, including on Task refresh.
        sqlx::query(
            "update admission.action_execution set reason_code=$2,updated_at=now()
            where id=$1 and gate_state='ALLOWED' and dispatch_state='DISPATCHED'",
        )
        .bind(ae.id)
        .bind(crate::governance::wire(&ReasonCode::TargetStateConflict))
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    if outcome == "CONFLICT" {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let current = crate::governance::load_execution(&state.pool, current.id)
        .await?
        .ok_or_else(|| unavailable("Memory operation 不可查证"))?;
    Ok((StatusCode::OK, current.submission()))
}

async fn write_usage(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    intent: &Intent,
    outcome: &str,
    evidence: &[Evidence],
) -> Result<(), Refusal> {
    let billing = ae
        .parameters
        .as_ref()
        .and_then(|p| p.get("memoryUsage"))
        .ok_or_else(invalid)?;
    let meters: Vec<crate::openmeter::MemoryMeter> =
        serde_json::from_value(billing["meters"].clone()).map_err(|_| invalid())?;
    let occurred: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("select date_trunc('second',clock_timestamp())")
            .fetch_one(&mut **tx)
            .await?;
    let ids: Vec<&str> = evidence
        .iter()
        .filter(|e| e.kind == EvidenceKind::BuzzEventId)
        .map(|e| e.value.as_str())
        .collect();
    let dimensions = json!({"tenant_id":ae.tenant_id,"workspace_id":ae.workspace_id,"operation_id":ae.operation_id,
        "agent_installation_resource_id":ae.target_id,"plaintext_bytes":intent.plaintext_bytes,"action_key":ae.action_key,
        "slug_digest":ae.parameters.as_ref().and_then(|p|p.get("slugDigest")),"write_outcome":outcome,"native_event_ids":ids});
    for meter in meters {
        let quantity = match meter.key.as_str() {
            "agent_memory_write_count" => 1,
            "agent_memory_plaintext_bytes" => intent.plaintext_bytes,
            _ => return Err(invalid()),
        };
        let id = Uuid::new_v5(
            &Uuid::NAMESPACE_URL,
            format!("{}:BUZZ_AGENT_MEMORY:{}:{}", ae.tenant_id, ae.id, meter.key).as_bytes(),
        );
        let event = json!({"specversion":"1.0","source":"urn:platform:core:usage","id":id,"type":meter.event_type,
            "subject":billing["subject"],"time":occurred.to_rfc3339(),"data":dimensions});
        sqlx::query("insert into outbox.usage_event
            (id,operation_id,tenant_id,workspace_id,openmeter_customer_id,agent_installation_resource_id,
             source_type,source_id,meter_key,subject_key,quantity,occurred_at,dimensions,openmeter_event_id,event,
             settlement_status,openmeter_namespace)
            values($1,$2,$3,$4,$5,$6,'BUZZ_AGENT_MEMORY',$7,$8,$9,$10,$11,$12,$1,$13,'PENDING_PUBLISH',$14)")
            .bind(id).bind(ae.operation_id).bind(ae.tenant_id).bind(ae.workspace_id).bind(billing["customer_id"].as_str())
            .bind(ae.target_id).bind(ae.id).bind(meter.key).bind(billing["subject"].as_str()).bind(quantity)
            .bind(occurred).bind(&dimensions).bind(event).bind(billing["namespace"].as_str()).execute(&mut **tx).await?;
    }
    Ok(())
}

async fn memory_audit(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    stage: &str,
    result: &str,
    evidence: &[Evidence],
) -> Result<(), Refusal> {
    crate::audit::append(
        tx,
        AuditEntry {
            event_key: format!("memory-write:{}:{stage}", ae.operation_id),
            tenant_id: Some(ae.tenant_id),
            workspace_id: ae.workspace_id,
            operation_id: ae.operation_id,
            event_type: "OUTCOME",
            human_identity_id: None,
            initiator_principal_id: Some(ae.initiator_principal_id),
            actor_principal_id: Some(ae.actor_principal_id),
            action_key: &ae.action_key,
            action_version: ae.action_version,
            component_type_key: &def.component_type_key,
            target_type: Some(&def.target_type),
            target_id: Some(ae.target_id),
            parameter_hash: &ae.parameter_hash,
            decision: "ALLOW",
            result_code: result,
            result_exposure: "NONE",
            evidence_refs: evidence.to_vec(),
            correlation_id: ae.correlation_id,
        },
    )
    .await?;
    Ok(())
}

fn native_evidence(intent: &Intent, head_id: &str) -> Vec<Evidence> {
    intent
        .old_head_event_id
        .iter()
        .map(String::as_str)
        .chain([intent.event_id.as_str(), head_id])
        .map(|id| Evidence::new(EvidenceKind::BuzzEventId, id))
        .collect()
}

async fn recovery_binding(
    state: &BffState,
    ctx: Option<&ExecutionContext>,
    ae: &Execution,
    definition: &Definition,
    tx: &mut Transaction<'_, Postgres>,
) -> Result<Binding, Refusal> {
    if let Some(ctx) = ctx {
        let binding = lock_read_context(ctx, ae.target_id, tx).await?;
        owner(ctx, &binding, tx).await?;
        super::read_permission(state, ctx, &binding, definition).await?;
        return Ok(binding);
    }
    // This path only observes the already signed event and reconciles the SAME
    // UsageEvent. It never signs, publishes, or discloses plaintext. Expiring an
    // original browser session must not orphan an acknowledged external effect.
    if !crate::roles::lock_tenant(tx, ae.tenant_id).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let binding = super::binding(tx, ae.target_id, false).await?;
    if binding.tenant_id != ae.tenant_id
        || Some(binding.workspace_id) != ae.workspace_id
        || binding.memory_state != "ACTIVE"
        || binding.agent_binding_state != "ACTIVE"
        || binding.counterparty_binding_state != "ACTIVE"
        || binding.agent_secret_status.as_deref() != Some("ACTIVE")
        || binding.counterparty_secret_status.as_deref() != Some("ACTIVE")
    {
        return Err(unavailable("Memory UNKNOWN 原受控 pair 已失效"));
    }
    Ok(binding)
}

/// Called by the EXISTING governance reconciliation tick and batch config.
/// Missing native evidence stays UNKNOWN, rotates through the original attempt
/// timestamp and remains owned by RB-05; no timer, retry publisher or new state.
pub(crate) async fn reconcile(state: &BffState, batch: i64) -> Result<(), Refusal> {
    let ids: Vec<Uuid> = sqlx::query_scalar("with selected as (
        select a.id from admission.action_execution a join projection.agent_memory_write w on w.action_execution_id=a.id
        where a.gate_state='ALLOWED' and a.dispatch_state='UNKNOWN' and w.relay_ack<>'REJECTED'
        order by coalesce(a.reconcile_last_attempt_at,a.updated_at),a.id limit $1 for update of a skip locked)
        update admission.action_execution a set reconcile_last_attempt_at=now() from selected where a.id=selected.id returning a.id")
        .bind(batch).fetch_all(&state.pool).await?;
    for id in ids {
        let result = tokio::time::timeout(
            state.memory_service.agent_memory.read_timeout,
            finish(state, None, id),
        )
        .await
        .unwrap_or_else(|_| Err(unavailable("Memory 固定 event 对账超时")));
        if let Err(error) = result {
            tracing::warn!(action_execution_id=%id,reason_code=%crate::governance::wire(&error.reason()),
                state="UNKNOWN","Memory 原 event/head/usage 尚未收敛；禁止重签重发");
        }
    }
    Ok(())
}
fn binding_digest(b: &Binding) -> String {
    collab_bridge::limits::canonical_digest(
        &json!({"tenant":b.tenant_id,"workspace":b.workspace_id,
        "installation":b.installation_resource_id,
        "agent":b.agent_pubkey,"counterparty":b.counterparty_pubkey,"agentLocator":b.agent_locator,
        "agentVersion":b.agent_secret_version,"agentAudience":b.agent_audience,"counterpartyLocator":b.counterparty_locator,
        "counterpartyVersion":b.counterparty_secret_version,"counterpartyAudience":b.counterparty_audience,
        "host":b.normalized_host,"nip11":b.nip11_snapshot_digest}),
    )
}
fn subject(ae: &Execution) -> DecisionSubject<'_> {
    DecisionSubject {
        action_execution_id: ae.id,
        operation_id: ae.operation_id,
        tenant_id: ae.tenant_id,
        workspace_id: ae.workspace_id,
        principal_id: ae.initiator_principal_id,
        action_key: &ae.action_key,
        action_version: ae.action_version,
        target_id: ae.target_id,
        parameter_hash: &ae.parameter_hash,
    }
}
fn actor(ctx: &ExecutionContext) -> Actor {
    Actor {
        tenant_id: ctx.tenant_id,
        principal_id: ctx.tenant_principal_id,
        human_identity_id: Some(ctx.human_identity_id),
    }
}
fn hash(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}
fn now() -> Result<u64, Refusal> {
    u64::try_from(chrono::Utc::now().timestamp()).map_err(|_| invalid())
}
fn parse_uuid(value: &str) -> Result<Uuid, Refusal> {
    Uuid::parse_str(value).map_err(|_| invalid())
}
fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}
fn rejected(reason: Option<ReasonCode>) -> Refusal {
    match reason.unwrap_or(ReasonCode::PermissionDenied) {
        ReasonCode::QuotaExhausted => Refusal::Limit(ReasonCode::QuotaExhausted),
        ReasonCode::RateLimited => Refusal::Limit(ReasonCode::RateLimited),
        ReasonCode::TargetStateConflict => Refusal::Conflict(ReasonCode::TargetStateConflict),
        ReasonCode::CapabilityBlocked => Refusal::Blocked(ReasonCode::CapabilityBlocked),
        reason => Refusal::Denied(reason),
    }
}
fn write_error(error: WriteError) -> Refusal {
    match error {
        WriteError::HeadConflict => Refusal::Conflict(ReasonCode::TargetStateConflict),
        WriteError::Native(collab_bridge::memory::MemoryError::BoundExceeded) => {
            Refusal::Limit(ReasonCode::PayloadTooLarge)
        }
        WriteError::HeadAheadOfRelay => Refusal::Precondition(ReasonCode::TargetStateConflict),
        _ => unavailable("Memory native prepare 不可查证"),
    }
}
