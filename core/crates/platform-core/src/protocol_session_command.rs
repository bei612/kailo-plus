//! HUMAN producer for the existing file_storage PROTOCOL actions. Native
//! execution is a later continuation of this same AE, never a new operation.
use super::*;
use crate::{
    bff::{BffState, ExecutionContext, HEADER_ISSUER, HEADER_SUBJECT},
    governance::{Actor, Target, EXECUTION_COLUMNS},
};
use axum::http::StatusCode;
use contracts::{ActionCommand, ActionSubmission};

pub(crate) fn is_action(key: &str) -> bool {
    matches!(
        key,
        "file_storage.open_view@v1" | "file_storage.open_edit@v1"
    )
}

fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, Refusal> {
    value[key]
        .as_str()
        .filter(|s| !s.is_empty() && s.trim() == *s)
        .ok_or_else(invalid)
}

fn input(cmd: &ActionCommand) -> Result<(Value, Uuid, i32, Option<Uuid>), Refusal> {
    let raw = serde_json::to_value(cmd).map_err(|_| invalid())?;
    if !is_action(&cmd.action_key)
        || raw.as_object().is_none_or(|m| {
            m.keys().any(|k| {
                !matches!(
                    k.as_str(),
                    "actionKey"
                        | "idempotencyKey"
                        | "workspaceId"
                        | "resourceVersion"
                        | "assetVersion"
                        | "protocolSessionOpen"
                        | "explicitConfirmation"
                )
            })
        })
    {
        return Err(invalid());
    }
    let source = raw["protocolSessionOpen"].clone();
    let typed: contracts::ProtocolSessionOpenInput =
        serde_json::from_value(source.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(typed).map_err(|_| invalid())? != source {
        return Err(invalid());
    }
    let reference = &source["reference"];
    uuid(&source, "applicationBindingId")?;
    if source["projectionGeneration"]
        .as_i64()
        .is_none_or(|value| value <= 0)
    {
        return Err(invalid());
    }
    let _resource = uuid(reference, "resourceId")?;
    for key in [
        "nativeObjectRef",
        "nativeRevision",
        "displayName",
        "mediaType",
    ] {
        text(reference, key)?;
    }
    let (target, version) = if reference.get("assetId").is_some() {
        if cmd.resource_version.is_some() {
            return Err(invalid());
        }
        (uuid(reference, "assetId")?, cmd.asset_version)
    } else {
        if cmd.asset_version.is_some() {
            return Err(invalid());
        }
        (uuid(reference, "resourceId")?, cmd.resource_version)
    };
    let version = version
        .and_then(|v| i32::try_from(v).ok())
        .filter(|v| *v > 0)
        .ok_or_else(invalid)?;
    let workspace = cmd
        .workspace_id
        .as_ref()
        .map(|s| Uuid::parse_str(s).map_err(|_| invalid()))
        .transpose()?;
    if workspace.is_some_and(|id| id.is_nil()) {
        return Err(invalid());
    }
    Ok((source, target, version, workspace))
}

// The same request identity that BFF resolved is frozen as an original locator.
// Multiple external identities for one HUMAN never cause arbitrary selection.
async fn external_identity(
    state: &BffState,
    ctx: &ExecutionContext,
    headers: &HeaderMap,
) -> Result<Uuid, Refusal> {
    let header = |key| {
        let mut values = headers.get_all(key).iter();
        let value = values
            .next()
            .and_then(|v| v.to_str().ok())
            .filter(|v| !v.is_empty())
            .ok_or_else(invalid)?;
        if values.next().is_some() {
            return Err(invalid());
        }
        Ok::<_, Refusal>(value)
    };
    sqlx::query_scalar("select ei.id from identity.external_identity ei
        join identity.identity_provider p on p.id=ei.provider_id and p.issuer=ei.issuer and p.status='ACTIVE'
        join identity.human_identity h on h.id=ei.human_identity_id and h.status='ACTIVE'
        where ei.human_identity_id=$1 and ei.issuer=$2 and ei.subject=$3 and ei.status='ACTIVE'")
        .bind(ctx.human_identity_id).bind(header(HEADER_ISSUER)?).bind(header(HEADER_SUBJECT)?)
        .fetch_optional(&state.pool).await?.ok_or_else(denied)
}

fn expiry() -> Result<DateTime<Utc>, Refusal> {
    let seconds = std::env::var("PROTOCOL_SESSION_TTL_SECONDS")
        .ok()
        .and_then(|s| s.parse::<i64>().ok())
        .filter(|s| *s > 0)
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    Utc::now()
        .checked_add_signed(chrono::Duration::try_seconds(seconds).ok_or_else(invalid)?)
        .ok_or_else(invalid)
}

async fn admitted_submission(
    state: &BffState,
    ae: &Execution,
) -> Result<(StatusCode, ActionSubmission), (Refusal, Option<Uuid>)> {
    let mut descriptor = None;
    if ae.gate_state == "ALLOWED" && ae.dispatch_state == "NOT_DISPATCHED" {
        // This same original intent can continue after ApprovalWorkflow opens
        // its gate. The only native call here is the replay-safe head query;
        // document token creation is separately fenced by Session OPENING.
        admit_session(&state.memory_service, ae)
            .await
            .map_err(|e| (e, Some(ae.operation_id)))?;
        descriptor = launch::once(&state.memory_service, ae)
            .await
            .map_err(|e| (e, Some(ae.operation_id)))?;
    }
    let current = crate::governance::load_execution(&state.pool, ae.id)
        .await
        .map_err(|e| (e.into(), Some(ae.operation_id)))?
        .ok_or((unknown(), Some(ae.operation_id)))?;
    let (status, mut submission) = crate::governance::submission_result(&current)?;
    if launch::load(&state.pool, ae.id)
        .await
        .map_err(|e| (e, Some(ae.operation_id)))?
        .is_some()
    {
        submission.protocol_session_id = Some(ae.id.to_string());
    }
    if let Some(descriptor) = descriptor {
        // This optional value is response-only; later status/intent readback
        // returns the Session locator but cannot recover the original PAT.
        submission.document_launch = Some(
            serde_json::from_value(descriptor).map_err(|_| (unknown(), Some(ae.operation_id)))?,
        );
    }
    Ok((status, submission))
}

pub(crate) async fn submit(
    state: &BffState,
    ctx: &ExecutionContext,
    headers: &HeaderMap,
    cmd: &ActionCommand,
) -> Result<(StatusCode, ActionSubmission), (Refusal, Option<Uuid>)> {
    let result=async {
        let (source,target_id,version,workspace)=input(cmd)?;
        let idempotency=Uuid::parse_str(&cmd.idempotency_key).map_err(|_|invalid())?;
        if idempotency.is_nil(){return Err(invalid());}
        let external=external_identity(state,ctx,headers).await?;
        let hash=collab_bridge::limits::canonical_digest(&json!({"actionKey":cmd.action_key,
            "workspaceId":workspace,"targetVersion":version,"protocolSessionOpen":source,
            "explicitConfirmation":cmd.explicit_confirmation,"externalIdentityId":external}));
        let existing:Option<Execution>=sqlx::query_as(&format!("select {EXECUTION_COLUMNS}
            from admission.action_execution where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3"))
            .bind(ctx.tenant_id).bind(ctx.tenant_principal_id).bind(idempotency).fetch_optional(&state.pool).await?;
        if let Some(ae)=existing {
            if ae.parameter_hash!=hash || ae.action_key!=cmd.action_key {return Err(Refusal::Conflict(ReasonCode::IdempotencyKeyReused));}
            return Ok(ae);
        }
        let actor=Actor{tenant_id:ctx.tenant_id,principal_id:ctx.tenant_principal_id,human_identity_id:Some(ctx.human_identity_id)};
        let mut tx=state.pool.begin().await?;
        let action_version=source["actionVersion"].as_i64().and_then(|v|i32::try_from(v).ok()).filter(|v|*v>0).ok_or_else(invalid)?;
        let (binding,generation,application)=if source["reference"].get("assetId").is_some() {
            crate::application_catalog::definition_for_asset(&mut tx,ctx.tenant_id,workspace,target_id,&cmd.action_key,action_version).await?
        } else {crate::application_catalog::definition_for_resource(&mut tx,ctx.tenant_id,workspace,target_id,&cmd.action_key,action_version).await?};
        if !source_binding_matches(&source,binding,generation) {return Err(denied());}
        let definition=&application.definition;
        if definition.execution_mode!="PROTOCOL" || !(definition.confirmation_mode=="NONE" && cmd.explicit_confirmation.is_none()
            || definition.confirmation_mode=="EXPLICIT" && cmd.explicit_confirmation==Some(true)
            || definition.confirmation_mode=="APPROVAL" && cmd.explicit_confirmation.is_none()) {return Err(denied());}
        let parameters=json!({"protocolSessionOpen":source,"targetType":application.definition.target_type,
            "targetVersion":version,"externalIdentityId":external,"protocolExpiresAt":expiry()?,
            "explicitConfirmation":cmd.explicit_confirmation});
        let application=(binding,generation,application);
        let ae=crate::governance::open_protocol_execution(&mut tx,actor,&application,
            &Target{id:target_id,version,workspace_id:workspace},parameters,hash,idempotency).await?;
        tx.commit().await?;
        Ok::<_,Refusal>(ae)
    }.await;
    let ae = result.map_err(|e| (e, None))?;
    let op = Some(ae.operation_id);
    if ae.gate_state != "EVALUATING" {
        return admitted_submission(state, &ae).await;
    }
    let actor = Actor {
        tenant_id: ctx.tenant_id,
        principal_id: ctx.tenant_principal_id,
        human_identity_id: Some(ctx.human_identity_id),
    };
    let def = crate::governance::exact_definition_for_execution(&state.pool, &ae)
        .await
        .map_err(|e| (e.into(), op))?;
    let (mut evaluation, _) = match fresh_for_governance(&state.governance, &ae).await {
        Ok(fresh) => fresh,
        Err(Refusal::Unavailable(error)) => return Err((Refusal::Unavailable(error), op)),
        Err(refusal) => {
            let evaluation = crate::governance::Evaluation {
                allowed: false,
                scope: "DENY",
                authorization: "DENY",
                quota: "NOT_APPLICABLE",
                zed_token: None,
                reason: Some(refusal.reason()),
            };
            state
                .governance
                .close_gate(
                    &ae,
                    &def,
                    "ADMISSION",
                    "DENIED",
                    &evaluation,
                    &refusal.reason(),
                    actor.human_identity_id,
                )
                .await
                .map_err(|e| (e.into(), op))?;
            return Err((refusal, op));
        }
    };
    if def.confirmation_mode == "APPROVAL" {
        if cmd.explicit_confirmation.is_some() {
            return Err((invalid(), op));
        }
        return state
            .governance
            .request_approval(actor, &ae, &def, &evaluation)
            .await;
    }
    if !(def.confirmation_mode == "NONE" && cmd.explicit_confirmation.is_none()
        || def.confirmation_mode == "EXPLICIT" && cmd.explicit_confirmation == Some(true))
    {
        return Err((invalid(), op));
    }
    state
        .governance
        .check_quota(ae.tenant_id, &def, &mut evaluation)
        .await
        .map_err(|e| (e, op))?;
    if !evaluation.allowed {
        let reason = evaluation
            .reason
            .clone()
            .unwrap_or(ReasonCode::PermissionDenied);
        state
            .governance
            .close_gate(
                &ae,
                &def,
                "ADMISSION",
                "DENIED",
                &evaluation,
                &reason,
                actor.human_identity_id,
            )
            .await
            .map_err(|e| (e.into(), op))?;
        return Err((Refusal::Denied(reason), op));
    }
    let mut tx = state.pool.begin().await.map_err(|e| (e.into(), op))?;
    let locked = crate::governance::lock_execution(&mut tx, ae.id)
        .await
        .map_err(|e| (e.into(), op))?;
    if locked.gate_state == "EVALUATING" {
        sqlx::query("update admission.action_execution set gate_state='ALLOWED',reason_code=null,updated_at=now() where id=$1")
            .bind(ae.id).execute(&mut *tx).await.map_err(|e|(e.into(),op))?;
        crate::governance::record_decision(
            &mut tx,
            &locked.subject(),
            "ADMISSION",
            evaluation.scope,
            evaluation.authorization,
            if def.confirmation_mode == "EXPLICIT" {
                "SATISFIED"
            } else {
                "NOT_REQUIRED"
            },
            evaluation.quota,
            evaluation.zed_token.as_deref(),
            None,
        )
        .await
        .map_err(|e| (e.into(), op))?;
        crate::governance::audit(
            &mut tx,
            &locked,
            &def,
            "admission:decision",
            "DECISION",
            "ALLOW",
            "ALLOWED",
            actor.human_identity_id,
            Vec::new(),
        )
        .await
        .map_err(|e| (e.into(), op))?;
    }
    tx.commit().await.map_err(|e| (e.into(), op))?;
    let ae = crate::governance::load_execution(&state.pool, ae.id)
        .await
        .map_err(|e| (e.into(), op))?
        .ok_or((unknown(), op))?;
    admitted_submission(state, &ae).await
}

pub(super) fn source_binding_matches(source: &Value, binding: Uuid, generation: i64) -> bool {
    source["applicationBindingId"] == json!(binding)
        && source["projectionGeneration"] == json!(generation)
}

#[cfg(test)]
mod source_binding_tests {
    use super::*;
    #[test]
    fn native_menu_source_cannot_select_another_target_binding_or_generation() {
        let binding = Uuid::new_v4();
        let source = json!({"applicationBindingId":binding,"projectionGeneration":3});
        assert!(source_binding_matches(&source, binding, 3));
        assert!(!source_binding_matches(&source, Uuid::new_v4(), 3));
        assert!(!source_binding_matches(&source, binding, 4));
        assert!(!source_binding_matches(&json!({}), binding, 3));
    }
}
