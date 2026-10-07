//! Native importer write admission for one original DD-89 read Operation.
//! The importer owns synchronization and parsing; Core freezes references only.
use super::*;
use sqlx::{Postgres, Transaction};

const KIND: &str = "SERVICE_READ_RECEIVER";

pub(super) struct Admission {
    pub resource: Uuid,
    pub version: i32,
    pub native_ref: String,
    pub application: ApplicationDefinition,
    pub audience: String,
}

pub(crate) fn is_receiver(ae: &Execution) -> bool {
    ae.actor_principal_id == ae.initiator_principal_id
        && ae
            .parameters
            .as_ref()
            .is_some_and(|p| p["componentActionKind"] == KIND)
}

pub(super) async fn resolve(
    conn: &mut PgConnection,
    identity: &Receiver,
    binding: Uuid,
    batch: &Value,
) -> Result<Admission, Refusal> {
    let resource = uuid(batch, "receiverResourceId")?;
    uuid(batch, "importConfigRef")?;
    uuid(batch, "batchId")?;
    let version = batch["actionVersion"]
        .as_i64()
        .and_then(|v| i32::try_from(v).ok())
        .filter(|v| *v > 0)
        .ok_or_else(invalid)?;
    let (resource_version, native_ref, category, audience): (i32, String, String, String) =
        sqlx::query_as(
            "select r.version,r.native_id,kind.capability_category,service.audience
         from catalog.resource r
         join catalog.resource_type_definition kind on kind.id=r.resource_type_definition_id
           and kind.type_key=r.type_key and kind.status='ACTIVE'
         join catalog.application_binding b on b.id=r.application_binding_id
           and b.component_release_id=kind.component_release_id and b.tenant_id=r.tenant_id
         join identity.service_principal service on service.principal_id=b.service_principal_id
           and service.component_binding_kind='APPLICATION' and service.component_binding_id=b.id
         left join identity.workspace w on w.id=r.home_workspace_id and w.tenant_id=r.tenant_id
         where r.id=$1 and r.application_binding_id=$2 and r.tenant_id=$3
           and r.state='ACTIVE' and r.projection_action_execution_id is null
           and (r.home_workspace_id is null or w.state='ACTIVE')
           and ($4::uuid is null or r.home_workspace_id is null or r.home_workspace_id=$4)
           and b.state='ACTIVE' and b.active_projection_generation=$5
         for share of r,kind,b,service",
        )
        .bind(resource)
        .bind(binding)
        .bind(identity.tenant)
        .bind(identity.workspace)
        .bind(identity.generation)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(denied)?;
    if native_ref.is_empty()
        || audience.is_empty()
        || !declares(&identity.manifest, Some(&category), "RECEIVER")
    {
        return Err(denied());
    }
    let application = crate::application_catalog::exact_definition_for_binding(
        conn,
        binding,
        identity.generation,
        text(batch, "actionKey")?,
        version,
    )
    .await?;
    let def = &application.definition;
    // Native admission is synchronous, not a shortcut around an existing
    // ComponentTaskWorkflow, confirmation or approval obligation.
    if def.target_type != "RESOURCE"
        || def.permission_object_type != "resource"
        || !matches!(def.permission.as_str(), "update" | "delete")
        || def.execution_mode != "SYNC"
        || def.confirmation_mode != "NONE"
        || def.approval_policy_id.is_some()
    {
        return Err(blocked());
    }
    Ok(Admission {
        resource,
        version: resource_version,
        native_ref,
        application,
        audience,
    })
}

pub(super) fn arguments(admission: &Admission, batch: &Value, source: Uuid, read: Uuid) -> Value {
    json!({"targetType":"RESOURCE","targetId":admission.resource,
        "authorizationTargetNativeRef":admission.native_ref,
        "input":{"sourceResourceId":source,"importConfigRef":batch["importConfigRef"],
            "batchId":batch["batchId"],"sourceReadActionExecutionId":read}})
}

pub(super) async fn evaluate(
    state: &ServiceState,
    identity: &Receiver,
    admission: &Admission,
) -> Result<Evaluation, Refusal> {
    let check = state
        .governance
        .spicedb
        .check(
            "resource",
            &admission.resource.to_string(),
            &admission.application.definition.permission,
            &identity.principal.to_string(),
            crate::spicedb::Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| Refusal::Unavailable("receiver authorization unavailable".into()))?;
    if check.zed_token.is_empty() {
        return Err(blocked());
    }
    let mut evaluation = Evaluation {
        allowed: check.allowed,
        scope: "ALLOW",
        authorization: if check.allowed { "ALLOW" } else { "DENY" },
        quota: "NOT_APPLICABLE",
        zed_token: Some(check.zed_token),
        reason: if check.allowed {
            None
        } else {
            Some(ReasonCode::PermissionDenied)
        },
    };
    state
        .governance
        .check_quota(
            identity.tenant,
            &admission.application.definition,
            &mut evaluation,
        )
        .await?;
    Ok(evaluation)
}

/// One child is the receiver's real write intent, not a copied importer job.
/// Its parent owns the read Operation and the original SOURCE/RECEIVER usage.
pub(super) async fn admit(
    state: &ServiceState,
    conn: &mut Transaction<'_, Postgres>,
    parent: &Execution,
    identity: &Receiver,
    binding: Uuid,
    admission: &Admission,
    batch: &Value,
) -> Result<Value, Refusal> {
    let p = parent.parameters.as_ref().ok_or_else(invalid)?;
    let id = uuid(p, "receiverActionExecutionId")?;
    let args = arguments(admission, batch, parent.target_id, parent.id);
    let hash = collab_bridge::limits::canonical_digest(&args);
    let def = &admission.application.definition;
    let documents = crate::application_tool::schemas(conn, binding, &def.action_key).await?;
    let schema = documents
        .get(text(
            &admission.application.declaration,
            "inputSchemaDigest",
        )?)
        .ok_or_else(blocked)?;
    if !crate::capability_contract::schema_validator(schema, &documents)?.is_valid(&args["input"]) {
        return Err(invalid());
    }
    let parameters = json!({"componentActionKind":KIND,"toolParameterHash":hash,
        "idempotencyKey":p["idempotencyKey"],"nativeBatch":batch,
        "sourceReadActionExecutionId":parent.id,"sourceResourceId":parent.target_id,
        "receiverBindingId":binding,"receiverGeneration":identity.generation,
        "targetVersion":admission.version});
    let inserted = sqlx::query("insert into admission.action_execution
        (id,operation_id,parent_action_execution_id,tenant_id,workspace_id,action_key,action_version,
         initiator_principal_id,actor_principal_id,target_id,parameter_hash,parameters,
         gate_state,dispatch_state,correlation_id,action_definition_id,component_binding_kind,
         component_binding_id,component_release_id,component_projection_generation)
        values($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,'EVALUATING','NOT_DISPATCHED',$12,$13,'APPLICATION',$14,$15,$16)
        on conflict(id) do nothing")
        .bind(id).bind(parent.operation_id).bind(parent.id).bind(parent.tenant_id).bind(parent.workspace_id)
        .bind(&def.action_key).bind(def.version).bind(identity.principal).bind(admission.resource)
        .bind(&hash).bind(&parameters).bind(parent.correlation_id).bind(admission.application.definition_id)
        .bind(binding).bind(admission.application.component_release_id).bind(identity.generation)
        .execute(&mut **conn).await?.rows_affected() == 1;
    let ae: Execution = sqlx::query_as(&format!(
        "select {} from admission.action_execution where id=$1 for update",
        crate::governance::EXECUTION_COLUMNS
    ))
    .bind(id)
    .fetch_one(&mut **conn)
    .await?;
    if !is_receiver(&ae)
        || ae.operation_id != parent.operation_id
        || ae.parameter_hash != hash
        || ae.parameters.as_ref().is_none_or(|p| {
            let mut frozen = p.clone();
            if let Some(frozen) = frozen.as_object_mut() {
                frozen.remove("readToken");
            }
            frozen != parameters
        })
        || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "DISPATCHED")
    {
        return Err(Refusal::Denied(ReasonCode::ExternalResultUnknown));
    }
    if inserted {
        crate::governance::audit(
            conn,
            &ae,
            def,
            "intent",
            "INTENT",
            "NONE",
            "EVALUATING",
            None,
            vec![],
        )
        .await?;
    }
    let fresh = evaluate(state, identity, admission).await?;
    crate::governance::record_decision(
        conn,
        &crate::governance::DecisionSubject {
            action_execution_id: id,
            operation_id: ae.operation_id,
            tenant_id: ae.tenant_id,
            workspace_id: ae.workspace_id,
            principal_id: ae.actor_principal_id,
            action_key: &ae.action_key,
            action_version: ae.action_version,
            target_id: ae.target_id,
            parameter_hash: &ae.parameter_hash,
        },
        "ADMISSION",
        fresh.scope,
        fresh.authorization,
        "NOT_APPLICABLE",
        fresh.quota,
        fresh.zed_token.as_deref(),
        fresh.reason.as_ref(),
    )
    .await?;
    if !fresh.allowed {
        return Err(Refusal::Denied(
            fresh.reason.unwrap_or(ReasonCode::PermissionDenied),
        ));
    }
    let token = crate::action_token::issue_service_read(
        state,
        &ae,
        def,
        &admission.audience,
        fresh.zed_token.as_deref().ok_or_else(blocked)?,
    )
    .await?;
    let claims = crate::action_token::verify(&token, &admission.audience)?;
    sqlx::query(
        "update admission.action_execution set gate_state='ALLOWED',dispatch_state='DISPATCHED',
        parameters=jsonb_set(parameters,'{readToken}',$2),updated_at=now() where id=$1",
    )
    .bind(id)
    .bind(json!({"jti":claims["jti"],"iat":claims["iat"],"exp":claims["exp"]}))
    .execute(&mut **conn)
    .await?;
    crate::governance::audit(
        conn,
        &ae,
        def,
        &format!("write-token:{}", text(&claims, "jti")?),
        "DECISION",
        "ALLOW",
        "WRITE_TOKEN_ISSUED",
        None,
        vec![],
    )
    .await?;
    Ok(
        json!({"actionExecutionId":id,"actionToken":token,"expiresAt":claims["exp"],
        "argumentsJson":collab_bridge::limits::canonical_json(&args)}),
    )
}

/// Authenticated native receiver calls the original PEP immediately before its
/// existing Create/StartDelete. A source read grant alone never admits a write.
pub(crate) async fn authorize(
    state: &ServiceState,
    conn: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    binding: Uuid,
    claims: &Value,
    operation: &str,
    args: &Value,
) -> Result<String, Refusal> {
    validate_claims(ae, claims, operation, args)?;
    if !is_receiver(ae) {
        return Err(denied());
    }
    let p = ae.parameters.as_ref().ok_or_else(invalid)?;
    let identity = receiver(conn, binding).await?;
    if p["receiverBindingId"] != json!(binding)
        || p["receiverGeneration"] != identity.generation
        || identity.tenant != ae.tenant_id
        || identity.workspace != ae.workspace_id
        || identity.principal != ae.actor_principal_id
    {
        return Err(denied());
    }
    let parent: Option<Value>=sqlx::query_scalar("select p.parameters from admission.action_execution p
        join admission.action_execution c on c.parent_action_execution_id=p.id
        where c.id=$1 and p.id=$2 and p.operation_id=c.operation_id and p.tenant_id=c.tenant_id
          and p.parameters->>'componentActionKind'='SERVICE_READ'
          and p.parameters->>'receiverActionExecutionId'=c.id::text
          and p.gate_state='ALLOWED' and p.dispatch_state='DISPATCHED'
          and not exists(select 1 from audit.audit_event e where e.event_key=p.operation_id::text||':service_read:terminal')")
        .bind(ae.id).bind(uuid(p,"sourceReadActionExecutionId")?).fetch_optional(&mut **conn).await?;
    let parent = parent.ok_or_else(denied)?;
    if parent["nativeBatch"] != p["nativeBatch"]
        || !parent["readReceipts"]["SOURCE"].is_object()
        || parent["readReceipts"]["RECEIVER"].is_object()
        || parent["readToken"]["exp"]
            .as_i64()
            .is_none_or(|exp| exp <= chrono::Utc::now().timestamp())
    {
        return Err(denied());
    }
    let admission = resolve(conn, &identity, binding, &p["nativeBatch"]).await?;
    let attached: bool = sqlx::query_scalar(
        "select exists(select 1 from admission.action_execution
        where id=$1 and component_binding_id=$2 and component_release_id=$3
        and component_projection_generation=$4 and action_definition_id=$5)",
    )
    .bind(ae.id)
    .bind(binding)
    .bind(admission.application.component_release_id)
    .bind(identity.generation)
    .bind(admission.application.definition_id)
    .fetch_one(&mut **conn)
    .await?;
    if !attached
        || admission.resource != ae.target_id
        || p["targetVersion"] != admission.version
        || *args
            != arguments(
                &admission,
                &p["nativeBatch"],
                uuid(p, "sourceResourceId")?,
                uuid(p, "sourceReadActionExecutionId")?,
            )
    {
        return Err(denied());
    }
    let fresh = evaluate(state, &identity, &admission).await?;
    crate::governance::record_decision(
        conn,
        &crate::governance::DecisionSubject {
            action_execution_id: ae.id,
            operation_id: ae.operation_id,
            tenant_id: ae.tenant_id,
            workspace_id: ae.workspace_id,
            principal_id: ae.actor_principal_id,
            action_key: &ae.action_key,
            action_version: ae.action_version,
            target_id: ae.target_id,
            parameter_hash: &ae.parameter_hash,
        },
        "ADMISSION",
        fresh.scope,
        fresh.authorization,
        "NOT_APPLICABLE",
        fresh.quota,
        fresh.zed_token.as_deref(),
        fresh.reason.as_ref(),
    )
    .await?;
    if !fresh.allowed {
        return Err(Refusal::Denied(
            fresh.reason.unwrap_or(ReasonCode::PermissionDenied),
        ));
    }
    fresh.zed_token.ok_or_else(blocked)
}

/// The existing batch reconciler alone settles the child after both native
/// receipts and metering. Expiry is UNKNOWN, not a failed write to retry.
pub(super) async fn settle(
    tx: &mut Transaction<'_, Postgres>,
    parent: &Execution,
    complete: bool,
) -> Result<(), Refusal> {
    let p = parent.parameters.as_ref().ok_or_else(invalid)?;
    if p.get("nativeBatch").is_none() {
        return Ok(());
    }
    let ae = crate::governance::lock_execution(tx, uuid(p, "receiverActionExecutionId")?).await?;
    if !is_receiver(&ae)
        || ae.operation_id != parent.operation_id
        || ae
            .parameters
            .as_ref()
            .is_none_or(|p| p["sourceReadActionExecutionId"] != json!(parent.id))
    {
        return Err(denied());
    }
    let def = receipt::frozen_definition(tx, ae.id).await?;
    sqlx::query("update admission.action_execution set dispatch_state=$2,reason_code=$3,updated_at=now() where id=$1")
        .bind(ae.id).bind(if complete {"DISPATCHED"} else {"UNKNOWN"})
        .bind(if complete {None} else {Some(crate::governance::wire(&ReasonCode::ExternalResultUnknown))})
        .execute(&mut **tx).await?;
    crate::governance::audit(
        tx,
        &ae,
        &def,
        if complete {
            "service_receiver:terminal"
        } else {
            "service_receiver:expired"
        },
        if complete {
            "OUTCOME"
        } else {
            "RECONCILIATION"
        },
        if complete { "ALLOW" } else { "NONE" },
        if complete {
            "COMPLETED"
        } else {
            "EXTERNAL_RESULT_UNKNOWN"
        },
        None,
        vec![],
    )
    .await?;
    Ok(())
}

/// Retries after a later item in a native SyncLog failed observe the same batch;
/// they do not reacquire a token for an already written item.
pub(super) async fn observation(
    state: &ServiceState,
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    identity: &Receiver,
    admission: &Admission,
    source: &Source,
) -> Result<Option<Value>, Refusal> {
    let p = ae.parameters.as_ref().ok_or_else(invalid)?;
    let terminal: bool = sqlx::query_scalar(
        "select exists(select 1 from audit.audit_event
        where event_key=$1 and operation_id=$2 and tenant_id=$3 and result_code='COMPLETED')",
    )
    .bind(format!("{}:service_read:terminal", ae.operation_id))
    .bind(ae.operation_id)
    .bind(ae.tenant_id)
    .fetch_one(&mut **tx)
    .await?;
    let Some(outcome) = observed_outcome(
        p,
        &ae.dispatch_state,
        terminal,
        chrono::Utc::now().timestamp(),
    )?
    else {
        return Ok(None);
    };
    // Observing an existing outcome is not another billable read/write. It
    // still needs fresh scope and permission, but must not require new quota
    // after the original operation has consumed its allowance.
    for (resource, permission) in [
        (ae.target_id, "read"),
        (
            ae.target_id,
            source.application.definition.permission.as_str(),
        ),
        (
            admission.resource,
            admission.application.definition.permission.as_str(),
        ),
    ]
    .into_iter()
    .collect::<BTreeSet<_>>()
    {
        let check = state
            .governance
            .spicedb
            .check(
                "resource",
                &resource.to_string(),
                permission,
                &identity.principal.to_string(),
                crate::spicedb::Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| {
                Refusal::Unavailable("native read outcome authorization unavailable".into())
            })?;
        if !check.allowed || check.zed_token.is_empty() {
            return Err(denied());
        }
    }
    let mut response = json!({"actionExecutionId":ae.id,"operationId":ae.operation_id,
        "sourceBindingId":source.binding,"outcome":outcome});
    if terminal {
        response["receiverReceipt"] = p["readReceipts"]["RECEIVER"].clone();
    }
    Ok(Some(response))
}

fn observed_outcome(
    p: &Value,
    dispatch: &str,
    terminal: bool,
    now: i64,
) -> Result<Option<&'static str>, Refusal> {
    Ok(Some(if terminal {
        if !p["readReceipts"]["SOURCE"].is_object() || !p["readReceipts"]["RECEIVER"].is_object() {
            return Err(blocked());
        }
        "COMPLETED"
    } else if p["readReceipts"]["RECEIVER"].is_object() {
        "PENDING"
    } else if dispatch == "UNKNOWN" || p["readToken"]["exp"].as_i64().is_some_and(|exp| exp <= now)
    {
        "UNKNOWN"
    } else {
        return Ok(None);
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_retry_never_renews_a_completed_or_unknown_write() {
        let mut p = json!({"readToken":{"exp":200}});
        assert_eq!(
            observed_outcome(&p, "DISPATCHED", false, 100).unwrap(),
            None
        );
        assert_eq!(
            observed_outcome(&p, "UNKNOWN", false, 100).unwrap(),
            Some("UNKNOWN")
        );
        assert_eq!(
            observed_outcome(&p, "DISPATCHED", false, 200).unwrap(),
            Some("UNKNOWN")
        );
        p["readReceipts"] = json!({"SOURCE":{}});
        assert!(observed_outcome(&p, "DISPATCHED", true, 100).is_err());
        p["readReceipts"]["RECEIVER"] = json!({});
        assert_eq!(
            observed_outcome(&p, "DISPATCHED", false, 100).unwrap(),
            Some("PENDING")
        );
        assert_eq!(
            observed_outcome(&p, "UNKNOWN", true, 300).unwrap(),
            Some("COMPLETED")
        );
        p["readReceipts"].as_object_mut().unwrap().remove("SOURCE");
        assert!(observed_outcome(&p, "DISPATCHED", true, 100).is_err());
    }
}
