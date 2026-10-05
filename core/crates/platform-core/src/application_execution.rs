//! DD-48/51/94: observations of the original ExternalExecution, never a second
//! execution ledger. No execute/retry is issued by this module.
use crate::{
    audit::{self, Evidence},
    governance::{Execution, Refusal},
    openmeter::ApplicationMeter,
    service_api::ServiceState,
};
use chrono::{DateTime, Utc};
use contracts::{EvidenceKind, ReasonCode};
use serde_json::{json, Value};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

fn unavailable() -> Refusal {
    Refusal::Unavailable("APPLICATION execution evidence unavailable".into())
}
fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}

#[derive(sqlx::FromRow)]
struct External {
    id: Uuid,
    action_execution_id: Uuid,
    operation_id: Uuid,
    workflow_id: String,
    tenant_id: Uuid,
    workspace_id: Option<Uuid>,
    component_binding_id: Uuid,
    component_release_id: Uuid,
    component_projection_generation: i64,
    native_type: String,
    native_id: Option<String>,
    idempotency_key: Uuid,
    native_status: Option<String>,
    platform_status: String,
    cancel_capability: String,
    last_observed_at: Option<DateTime<Utc>>,
    terminal_at: Option<DateTime<Utc>>,
    usage_projection: Option<Value>,
    usage_digest: Option<String>,
}

async fn load(conn: &mut PgConnection, id: Uuid) -> Result<External, Refusal> {
    sqlx::query_as("select id,action_execution_id,operation_id,workflow_id,tenant_id,workspace_id,
        component_binding_id,component_release_id,component_projection_generation,native_type,native_id,
        idempotency_key,native_status,platform_status,cancel_capability,last_observed_at,terminal_at,
        usage_projection,usage_digest from admission.external_execution where id=$1 for update")
        .bind(id).fetch_optional(conn).await?.ok_or_else(conflict)
}

/// Before the real outbound execute, freeze the registered action's exact
/// native meter projection. An explicit empty meter set is not fabricated zero.
/// The caller commits this together with the original dispatch fence; a failed
/// native lookup must not leave a committed, never-sent execution intent.
pub(crate) async fn prepare_in_transaction(
    openmeter: &crate::openmeter::OpenMeter,
    tx: &mut Transaction<'_, Postgres>,
    child: &Execution,
    id: Uuid,
) -> Result<(), Refusal> {
    let current = crate::governance::lock_execution(tx, child.id).await?;
    let ee = load(tx, id).await?;
    if ee.action_execution_id != current.id
        || ee.operation_id != current.operation_id
        || ee.tenant_id != current.tenant_id
        || ee.workspace_id != current.workspace_id
        || current.gate_state != "ALLOWED"
        || current.dispatch_state != "DISPATCHED"
    {
        return Err(conflict());
    }
    if ee.usage_projection.is_some() {
        return Ok(());
    }
    if ee.platform_status != "PENDING_DISPATCH" {
        return Err(conflict());
    }
    let (meters, quota, usage_source): (Vec<String>, String, String) = sqlx::query_as(
        "select meters,quota_policy,obs_usage_source from catalog.action_definition
        where component_release_id=$1 and action_key=$2 and version=$3",
    )
    .bind(ee.component_release_id)
    .bind(&current.action_key)
    .bind(current.action_version)
    .fetch_one(&mut **tx)
    .await?;
    let projection = if meters.is_empty() {
        if quota != "NONE" || usage_source != "NONE" {
            return Err(unavailable());
        }
        json!({"meters":[]})
    } else {
        let (customer, namespace, prefix, version): (String,String,String,i32) = sqlx::query_as(
            "select customer_id,namespace,subject_key_prefix,version from projection.openmeter_binding
             where tenant_id=$1 and status='ACTIVE' for share")
            .bind(ee.tenant_id).fetch_optional(&mut **tx).await?.ok_or_else(unavailable)?;
        if namespace != openmeter.namespace() {
            return Err(unavailable());
        }
        let subject = format!("{prefix}{}", ee.component_binding_id);
        let native = openmeter
            .application_meters(ee.tenant_id, &customer, &subject, &meters)
            .await
            .map_err(|_| unavailable())?;
        json!({"meters":native,"customer_id":customer,"namespace":namespace,
            "subject":subject,"binding_version":version})
    };
    sqlx::query("update admission.external_execution set usage_projection=$2 where id=$1 and usage_projection is null")
        .bind(id).bind(projection).execute(&mut **tx).await?;
    Ok(())
}

fn terminal(status: &str) -> bool {
    matches!(status, "SUCCEEDED" | "FAILED" | "CANCELLED")
}

struct Observed {
    status: String,
    native_id: Option<String>,
    native_status: Option<String>,
    at: DateTime<Utc>,
    terminal_at: Option<DateTime<Utc>>,
}

fn observation(ee: &External, raw: &Value, now: DateTime<Utc>) -> Result<Observed, Refusal> {
    let parsed: contracts::AdapterExecutionObservation =
        serde_json::from_value(raw.clone()).map_err(|_| unavailable())?;
    if serde_json::to_value(parsed).map_err(|_| unavailable())? != *raw
        || raw["idempotencyKey"] != json!(ee.idempotency_key)
        || raw["nativeType"] != ee.native_type
        || raw["cancelCapability"] != ee.cancel_capability
    {
        return Err(conflict());
    }
    let status = raw["platformStatus"]
        .as_str()
        .ok_or_else(unavailable)?
        .to_owned();
    if status == "PENDING_DISPATCH" {
        return Err(unavailable());
    }
    let nonempty = |key| {
        raw.get(key)
            .map(|v| {
                v.as_str()
                    .filter(|s| !s.is_empty() && s.trim() == *s)
                    .map(str::to_owned)
                    .ok_or_else(unavailable)
            })
            .transpose()
    };
    let native_id = nonempty("nativeId")?;
    let native_status = nonempty("nativeStatus")?;
    if ee
        .native_id
        .as_ref()
        .is_some_and(|id| Some(id) != native_id.as_ref())
    {
        return Err(conflict());
    }
    let date = |key| {
        raw.get(key)
            .map(|v| {
                v.as_str()
                    .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                    .map(|t| t.with_timezone(&Utc))
                    .ok_or_else(unavailable)
            })
            .transpose()
    };
    let at = date("lastObservedAt")?.ok_or_else(unavailable)?;
    let terminal_at = date("terminalAt")?;
    if at > now
        || ee.last_observed_at.is_some_and(|old| at < old)
        || terminal(&status) != terminal_at.is_some()
        || terminal_at.is_some_and(|t| t > at)
        || (terminal(&status) && (native_id.is_none() || native_status.is_none()))
    {
        return Err(unavailable());
    }
    Ok(Observed {
        status,
        native_id,
        native_status,
        at,
        terminal_at,
    })
}

async fn audit_observation(
    tx: &mut Transaction<'_, Postgres>,
    ee: &External,
    status: &str,
    digest: &str,
) -> Result<(), Refusal> {
    let ae = crate::governance::lock_execution(tx, ee.action_execution_id).await?;
    let (component, exposure, target_type): (String,String,String) = sqlx::query_as("select component_type_key,result_exposure,target_type
        from catalog.action_definition where component_release_id=$1 and action_key=$2 and version=$3")
        .bind(ee.component_release_id).bind(&ae.action_key).bind(ae.action_version).fetch_one(&mut **tx).await?;
    let evidence = audit::evidence_json(&[
        Evidence::new(EvidenceKind::ActionExecutionId, ae.id),
        Evidence::new(EvidenceKind::TemporalWorkflowId, &ee.workflow_id),
    ]);
    sqlx::query("insert into audit.audit_event(id,event_key,tenant_id,workspace_id,operation_id,event_type,
        initiator_principal_id,actor_principal_id,action_key,action_version,component_type_key,target_type,target_id,
        parameter_hash,decision,result_code,result_exposure,evidence_refs,correlation_id,
        external_execution_id,component_binding_id,component_release_id,component_projection_generation)
        values($1,$2,$3,$4,$5,'RECONCILIATION',$6,$7,$8,$9,$10,$21,$11,$12,'NONE',$13,$14,$15,$16,
            $17,$18,$19,$20) on conflict(event_key) do nothing")
        .bind(Uuid::new_v4()).bind(format!("external-execution:{}:{status}:{digest}",ee.id))
        .bind(ee.tenant_id).bind(ee.workspace_id).bind(ee.operation_id).bind(ae.initiator_principal_id)
        .bind(ae.actor_principal_id).bind(&ae.action_key).bind(ae.action_version).bind(component)
        .bind(ae.target_id).bind(&ae.parameter_hash).bind(status).bind(exposure).bind(evidence)
        .bind(ae.correlation_id).bind(ee.id).bind(ee.component_binding_id).bind(ee.component_release_id)
        .bind(ee.component_projection_generation).bind(target_type).execute(&mut **tx).await?;
    Ok(())
}

/// Only the authenticated original response/observe caller supplies metadata.
/// HTTP success, cancel acceptance or absent native ID cannot create a terminal.
pub(crate) async fn record_observation(
    state: &ServiceState,
    id: Uuid,
    raw: &Value,
) -> Result<String, Refusal> {
    let mut tx = state.pool.begin().await?;
    let ae_id: Uuid = sqlx::query_scalar(
        "select action_execution_id from admission.external_execution where id=$1",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    crate::governance::lock_execution(&mut tx, ae_id).await?;
    let ee = load(&mut tx, id).await?;
    let observed = observation(&ee, raw, Utc::now())?;
    if ee.terminal_at.is_some() {
        if ee.platform_status != observed.status
            || ee.native_id != observed.native_id
            || ee.native_status != observed.native_status
            || ee.terminal_at != observed.terminal_at
        {
            return Err(conflict());
        }
        return Ok(ee.platform_status);
    }
    if ee.usage_projection.is_none() {
        return Err(unavailable());
    }
    let digest = collab_bridge::limits::canonical_digest(raw);
    sqlx::query(
        "update admission.external_execution set native_id=$2,native_status=$3,platform_status=$4,
        last_observed_at=$5,terminal_at=$6,response_digest=$7 where id=$1",
    )
    .bind(id)
    .bind(observed.native_id)
    .bind(observed.native_status)
    .bind(&observed.status)
    .bind(observed.at)
    .bind(observed.terminal_at)
    .bind(&digest)
    .execute(&mut *tx)
    .await?;
    audit_observation(&mut tx, &ee, &observed.status, &digest).await?;
    tx.commit().await?;
    Ok(observed.status)
}

fn usage(
    ee: &External,
    raw: &Value,
) -> Result<Vec<(ApplicationMeter, i64, DateTime<Utc>)>, Refusal> {
    let parsed: contracts::AdapterExecutionUsage =
        serde_json::from_value(raw.clone()).map_err(|_| unavailable())?;
    if serde_json::to_value(parsed).map_err(|_| unavailable())? != *raw
        || raw["externalExecutionId"] != json!(ee.id)
        || raw["idempotencyKey"] != json!(ee.idempotency_key)
        || raw["nativeType"] != ee.native_type
        || raw.get("nativeId").and_then(Value::as_str) != ee.native_id.as_deref()
        || !terminal(&ee.platform_status)
    {
        return Err(conflict());
    }
    let meters: Vec<ApplicationMeter> = serde_json::from_value(
        ee.usage_projection.as_ref().ok_or_else(unavailable)?["meters"].clone(),
    )
    .map_err(|_| unavailable())?;
    let values = raw["measurements"].as_array().ok_or_else(unavailable)?;
    if values.len() != meters.len() {
        return Err(unavailable());
    }
    let mut keys = std::collections::BTreeSet::new();
    if values
        .iter()
        .any(|v| v["meterKey"].as_str().is_none_or(|k| !keys.insert(k)))
    {
        return Err(unavailable());
    }
    meters
        .into_iter()
        .map(|meter| {
            let value = values
                .iter()
                .find(|v| v["meterKey"] == meter.key)
                .ok_or_else(unavailable)?;
            let quantity = value["quantity"]
                .as_i64()
                .filter(|q| *q >= 0)
                .ok_or_else(unavailable)?;
            let occurred = value["occurredAt"]
                .as_str()
                .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
                .map(|t| t.with_timezone(&Utc))
                .filter(|t| Some(*t) <= ee.last_observed_at)
                .ok_or_else(unavailable)?;
            if meter.value_property.is_none() && quantity != 1 {
                return Err(unavailable());
            }
            Ok((meter, quantity, occurred))
        })
        .collect()
}

/// Extracted native quantities go to the same deterministic UsageEvent/outbox.
/// Retries preserve event identity/body; only original OpenMeter stored_at closes it.
pub(crate) async fn record_usage(
    state: &ServiceState,
    id: Uuid,
    raw: &Value,
) -> Result<bool, Refusal> {
    let mut tx = state.pool.begin().await?;
    let ae_id: Uuid = sqlx::query_scalar(
        "select action_execution_id from admission.external_execution where id=$1",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    crate::governance::lock_execution(&mut tx, ae_id).await?;
    let ee = load(&mut tx, id).await?;
    let values = usage(&ee, raw)?;
    let digest = collab_bridge::limits::canonical_digest(raw);
    if ee
        .usage_digest
        .as_ref()
        .is_some_and(|previous| previous != &digest)
    {
        return Err(conflict());
    }
    let billing = ee.usage_projection.as_ref().ok_or_else(unavailable)?;
    let target: Uuid =
        sqlx::query_scalar("select target_id from admission.action_execution where id=$1")
            .bind(ee.action_execution_id)
            .fetch_one(&mut *tx)
            .await?;
    let dimensions = json!({"tenant_id":ee.tenant_id,"workspace_id":ee.workspace_id,"operation_id":ee.operation_id,
        "component_binding_id":ee.component_binding_id,"component_release_id":ee.component_release_id,
        "component_projection_generation":ee.component_projection_generation,"resource_id":target});
    let mut ids = Vec::new();
    for (meter, quantity, occurred) in values {
        let event_id = Uuid::new_v5(
            &Uuid::NAMESPACE_URL,
            format!(
                "{}:APPLICATION_ADAPTER_USAGE:{}:{}",
                ee.tenant_id, id, meter.key
            )
            .as_bytes(),
        );
        let mut data = dimensions.clone();
        if meter.value_property.is_some() {
            data["quantity"] = json!(quantity);
        }
        let event = json!({"specversion":"1.0","source":"urn:platform:core:usage","id":event_id,
            "type":meter.event_type,"subject":billing["subject"],"time":occurred,"data":data});
        sqlx::query("insert into outbox.usage_event(id,operation_id,tenant_id,workspace_id,openmeter_customer_id,
            source_type,source_id,meter_key,subject_key,quantity,occurred_at,dimensions,openmeter_event_id,event,
            settlement_status,openmeter_namespace,component_binding_id,component_release_id,component_projection_generation)
            values($1,$2,$3,$4,$5,'APPLICATION_ADAPTER_USAGE',$6,$7,$8,$9,$10,$11,$1,$12,'PENDING_PUBLISH',$13,$14,$15,$16)
            on conflict(tenant_id,source_type,source_id,meter_key) do nothing")
            .bind(event_id).bind(ee.operation_id).bind(ee.tenant_id).bind(ee.workspace_id)
            .bind(billing["customer_id"].as_str()).bind(id).bind(&meter.key).bind(billing["subject"].as_str())
            .bind(quantity).bind(occurred).bind(&dimensions).bind(&event).bind(billing["namespace"].as_str())
            .bind(ee.component_binding_id).bind(ee.component_release_id).bind(ee.component_projection_generation)
            .execute(&mut *tx).await?;
        let previous: Value =
            sqlx::query_scalar("select event from outbox.usage_event where id=$1")
                .bind(event_id)
                .fetch_one(&mut *tx)
                .await?;
        if previous != event {
            return Err(conflict());
        }
        ids.push(event_id);
    }
    sqlx::query("update admission.external_execution set usage_digest=$2,usage_observed_at=clock_timestamp()
        where id=$1 and usage_digest is null")
        .bind(id).bind(&digest).execute(&mut *tx).await?;
    audit_observation(&mut tx, &ee, "USAGE_OBSERVED", &digest).await?;
    tx.commit().await?;
    crate::gateway_usage::settle_events(&state.pool, &ids, &state.openmeter)
        .await
        .map_err(|_| unavailable())
}

/// Withdrawal observes the frozen generation using its current management AE;
/// it never signs the revoked original business authorization or retries execute.
pub(crate) async fn observe(
    state: &ServiceState,
    lifecycle: &Execution,
    id: Uuid,
) -> Result<bool, Refusal> {
    let mut tx = state.pool.begin().await?;
    let ee = load(&mut tx, id).await?;
    let management = matches!(
        lifecycle.action_key.as_str(),
        crate::application_binding::CREATE | crate::application_binding::DISABLE
    ) && lifecycle.target_id == ee.component_binding_id;
    let original_child = lifecycle.id == ee.action_execution_id
        && lifecycle.operation_id == ee.operation_id
        && lifecycle.workspace_id == ee.workspace_id;
    if (!management && !original_child)
        || lifecycle.tenant_id != ee.tenant_id
        || lifecycle.gate_state != "ALLOWED"
        || lifecycle.dispatch_state != "DISPATCHED"
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    if terminal(&ee.platform_status)
        && (no_meter_obligation(ee.usage_projection.as_ref())? || ee.usage_digest.is_some())
    {
        tx.commit().await?;
        return settle_recorded(state, &ee).await;
    }
    let (binding,manifest):(Value,Value)=sqlx::query_as("select jsonb_build_object(
            'adapterServiceRef',b.adapter_service_ref,'nativeInstanceRef',b.native_instance_ref),r.manifest
        from projection.application_runtime p join catalog.component_release r on r.id=p.component_release_id
        join catalog.application_binding b on b.id=p.binding_id and b.component_release_id=p.component_release_id
        where p.binding_id=$1 and p.generation=$2 and p.component_release_id=$3")
        .bind(ee.component_binding_id).bind(ee.component_projection_generation).bind(ee.component_release_id)
        .fetch_one(&mut *tx).await?;
    tx.commit().await?;
    let adapter = crate::application_binding::native::Adapter::resolve(
        binding["adapterServiceRef"]
            .as_str()
            .ok_or_else(unavailable)?,
        binding["nativeInstanceRef"]
            .as_str()
            .ok_or_else(unavailable)?,
        &manifest,
    )?;
    let mut args = json!({"externalExecutionId":id,"idempotencyKey":ee.idempotency_key,
        "nativeType":ee.native_type});
    if let Some(native_id) = ee.native_id {
        args["nativeId"] = json!(native_id);
    }
    let typed: contracts::AdapterExecutionReference =
        serde_json::from_value(args.clone()).map_err(|_| unavailable())?;
    if serde_json::to_value(typed).map_err(|_| unavailable())? != args {
        return Err(unavailable());
    }
    if !terminal(&ee.platform_status) {
        let raw = adapter
            .call(state, lifecycle, "observe", ee.idempotency_key, &args)
            .await?;
        if !terminal(&record_observation(state, id, &raw).await?) {
            return Ok(false);
        }
        args["nativeId"] = raw["nativeId"].clone();
    }
    // The frozen definition explicitly declares NONE + no meters. This is
    // not a zero-usage report and must not require an unsupported native API.
    if no_meter_obligation(ee.usage_projection.as_ref())? {
        return Ok(true);
    }
    let report = adapter
        .call(state, lifecycle, "extract_usage", ee.idempotency_key, &args)
        .await?;
    record_usage(state, id, &report).await
}

/// Once quantities are frozen, reconciliation uses the original outbox body;
/// it never demands another native report or new authorization for old work.
async fn settle_recorded(state: &ServiceState, ee: &External) -> Result<bool, Refusal> {
    let meters: Vec<ApplicationMeter> = serde_json::from_value(
        ee.usage_projection.as_ref().ok_or_else(unavailable)?["meters"].clone(),
    )
    .map_err(|_| unavailable())?;
    if meters.is_empty() {
        return Ok(true);
    }
    if ee.usage_digest.is_none() || !terminal(&ee.platform_status) {
        return Err(unavailable());
    }
    let events: Vec<(Uuid, String)> = sqlx::query_as(
        "select id,meter_key from outbox.usage_event
        where source_type='APPLICATION_ADAPTER_USAGE' and source_id=$1 and tenant_id=$2
          and operation_id=$3 and component_binding_id=$4 and component_release_id=$5
          and component_projection_generation=$6 and workspace_id is not distinct from $7",
    )
    .bind(ee.id)
    .bind(ee.tenant_id)
    .bind(ee.operation_id)
    .bind(ee.component_binding_id)
    .bind(ee.component_release_id)
    .bind(ee.component_projection_generation)
    .bind(ee.workspace_id)
    .fetch_all(&state.pool)
    .await?;
    let expected: std::collections::BTreeSet<_> = meters.iter().map(|m| m.key.as_str()).collect();
    let actual: std::collections::BTreeSet<_> =
        events.iter().map(|(_, key)| key.as_str()).collect();
    if expected != actual || meters.len() != events.len() {
        return Err(unavailable());
    }
    let ids: Vec<_> = events.into_iter().map(|(id, _)| id).collect();
    crate::gateway_usage::settle_events(&state.pool, &ids, &state.openmeter)
        .await
        .map_err(|_| unavailable())
}

/// Original parent settlement includes every actual Application tool child,
/// even when its native execution or usage reply was lost. No principal/time
/// heuristic and no model subject substitution can complete this set.
pub(crate) async fn reconcile_turn(
    state: &ServiceState,
    invocation: Uuid,
    turn: &str,
) -> Result<bool, Refusal> {
    let rows:Vec<(Uuid,Uuid)>=sqlx::query_as("select e.id,c.id
        from catalog.agent_invocation i join admission.action_execution parent on parent.id=i.action_execution_id
        join admission.action_execution c on c.parent_action_execution_id=parent.id
        join admission.external_execution e on e.action_execution_id=c.id
        where i.id=$1 and i.runtime_turn_id=$2
          and e.operation_id=parent.operation_id and e.tenant_id=parent.tenant_id
          and e.workspace_id=parent.workspace_id and e.workflow_id=i.workflow_id
          and c.operation_id=parent.operation_id and c.tenant_id=parent.tenant_id
          and c.workspace_id=parent.workspace_id and c.actor_principal_id=parent.actor_principal_id
          and c.initiator_principal_id=parent.initiator_principal_id
          and c.parameters->>'invocationId'=i.id::text and c.parameters->>'runtimeTurnId'=$2
        order by e.id")
        .bind(invocation).bind(turn).fetch_all(&state.pool).await?;
    let mut settled = true;
    for (execution, child) in rows {
        let child = crate::governance::load_execution(&state.pool, child)
            .await?
            .ok_or_else(conflict)?;
        if !observe(state, &child, execution).await? {
            settled = false;
        }
    }
    Ok(settled)
}

pub(crate) async fn committed_children(
    pool: &sqlx::PgPool,
    invocation: Uuid,
    turn: &str,
) -> Result<Vec<Uuid>, &'static str> {
    let rows:Vec<(Uuid,Option<Value>,Option<String>,bool)>=sqlx::query_as(
        "select e.id,e.usage_projection,e.usage_digest,coalesce(
            e.platform_status in ('SUCCEEDED','FAILED','CANCELLED') and e.terminal_at is not null
            and e.operation_id=parent.operation_id and e.tenant_id=parent.tenant_id
            and e.workspace_id=parent.workspace_id and e.workflow_id=i.workflow_id
            and c.operation_id=parent.operation_id and c.tenant_id=parent.tenant_id
            and c.workspace_id=parent.workspace_id and c.initiator_principal_id=parent.initiator_principal_id
            and c.actor_principal_id=parent.actor_principal_id and c.gate_state='ALLOWED'
            and c.dispatch_state='DISPATCHED' and c.parameters->>'invocationId'=i.id::text
            and c.parameters->>'runtimeTurnId'=$2,false)
         from catalog.agent_invocation i join admission.action_execution parent on parent.id=i.action_execution_id
         join admission.action_execution c on c.parent_action_execution_id=parent.id
         join admission.external_execution e on e.action_execution_id=c.id
         where i.id=$1 and i.runtime_turn_id=$2")
        .bind(invocation).bind(turn).fetch_all(pool).await.map_err(|_|"Application child set unavailable")?;
    let mut result = Vec::new();
    for (id, projection, digest, exact) in rows {
        if !exact {
            return Err("Application child native usage unresolved");
        }
        if !no_meter_obligation(projection.as_ref()).map_err(|_| "Application meters missing")?
            && digest.is_none()
        {
            return Err("Application child native usage unresolved");
        }
        let meters: Vec<ApplicationMeter> = serde_json::from_value(
            projection.ok_or("Application meters missing")?["meters"].clone(),
        )
        .map_err(|_| "Application meter projection invalid")?;
        let events:Vec<(Uuid,String)>=sqlx::query_as("select u.id,u.meter_key from outbox.usage_event u
            join admission.external_execution e on e.id=u.source_id
            where e.id=$1 and u.source_type='APPLICATION_ADAPTER_USAGE' and u.operation_id=e.operation_id
              and u.tenant_id=e.tenant_id and u.workspace_id is not distinct from e.workspace_id
              and u.component_binding_id=e.component_binding_id and u.component_release_id=e.component_release_id
              and u.component_projection_generation=e.component_projection_generation")
            .bind(id).fetch_all(pool).await.map_err(|_|"Application usage set unavailable")?;
        let expected: std::collections::BTreeSet<_> =
            meters.iter().map(|m| m.key.as_str()).collect();
        let actual: std::collections::BTreeSet<_> =
            events.iter().map(|(_, key)| key.as_str()).collect();
        if expected != actual || meters.len() != events.len() {
            return Err("Application usage set incomplete");
        }
        result.extend(events.into_iter().map(|(id, _)| id));
    }
    Ok(result)
}

fn no_meter_obligation(projection: Option<&Value>) -> Result<bool, Refusal> {
    let meters = projection
        .and_then(|p| p.get("meters"))
        .and_then(Value::as_array)
        .ok_or_else(unavailable)?;
    Ok(meters.is_empty())
}

#[cfg(test)]
mod execution_tests {
    use super::*;

    fn source() -> External {
        External {
            id: Uuid::new_v4(),
            action_execution_id: Uuid::new_v4(),
            operation_id: Uuid::new_v4(),
            workflow_id: "platform:AGENT_TASK:fixture".into(),
            tenant_id: Uuid::new_v4(),
            workspace_id: Some(Uuid::new_v4()),
            component_binding_id: Uuid::new_v4(),
            component_release_id: Uuid::new_v4(),
            component_projection_generation: 1,
            native_type: "actual-read".into(),
            native_id: Some("read-1".into()),
            idempotency_key: Uuid::new_v4(),
            native_status: None,
            platform_status: "UNKNOWN".into(),
            cancel_capability: "UNSUPPORTED".into(),
            last_observed_at: None,
            terminal_at: None,
            usage_digest: None,
            usage_projection: Some(json!({"meters":[{"key":"read_count","id":"native-meter",
                "event_type":"native.read","value_property":null}]})),
        }
    }

    fn observed(ee: &External) -> Value {
        json!({"idempotencyKey":ee.idempotency_key,"nativeType":ee.native_type,"nativeId":"read-1",
            "nativeStatus":"done","platformStatus":"SUCCEEDED","cancelCapability":"UNSUPPORTED",
            "lastObservedAt":"2026-01-01T00:00:01Z","terminalAt":"2026-01-01T00:00:00Z"})
    }

    fn report(ee: &External) -> Value {
        json!({"externalExecutionId":ee.id,"idempotencyKey":ee.idempotency_key,"nativeType":ee.native_type,
            "nativeId":"read-1","measurements":[{"meterKey":"read_count","quantity":1,
                "occurredAt":"2026-01-01T00:00:00Z"}]})
    }

    #[test]
    fn observation_requires_same_intent_and_native_terminal_evidence() {
        let ee = source();
        let raw = observed(&ee);
        assert!(observation(&ee, &raw, Utc::now()).is_ok());
        for (field, value) in [
            ("idempotencyKey", json!(Uuid::new_v4())),
            ("nativeType", json!("other")),
            ("nativeId", json!("other-read")),
            ("cancelCapability", json!("SUPPORTED")),
            ("platformStatus", json!("QUEUED")),
            ("terminalAt", Value::Null),
        ] {
            let mut changed = raw.clone();
            changed[field] = value;
            assert!(observation(&ee, &changed, Utc::now()).is_err(), "{field}");
        }
        let mut changed = raw.clone();
        changed.as_object_mut().unwrap().remove("nativeStatus");
        assert!(observation(&ee, &changed, Utc::now()).is_err());
        let mut changed = raw;
        changed["body"] = json!("unexpected payload");
        assert!(observation(&ee, &changed, Utc::now()).is_err());
    }

    #[test]
    fn cancel_acceptance_and_missing_id_remain_nonterminal() {
        let mut ee = source();
        ee.native_id = None;
        let mut raw = observed(&ee);
        raw["platformStatus"] = json!("RUNNING");
        raw["nativeStatus"] = json!("cancel accepted");
        raw.as_object_mut().unwrap().remove("terminalAt");
        raw.as_object_mut().unwrap().remove("nativeId");
        assert_eq!(
            observation(&ee, &raw, Utc::now()).unwrap().status,
            "RUNNING"
        );
        raw["terminalAt"] = json!("2026-01-01T00:00:00Z");
        assert!(observation(&ee, &raw, Utc::now()).is_err());
    }

    #[test]
    fn usage_needs_exact_complete_native_meter_set_not_zero_fallback() {
        let mut ee = source();
        ee.platform_status = "SUCCEEDED".into();
        ee.last_observed_at = Some(
            DateTime::parse_from_rfc3339("2026-01-01T00:00:01Z")
                .unwrap()
                .with_timezone(&Utc),
        );
        ee.terminal_at = ee.last_observed_at;
        let raw = report(&ee);
        assert_eq!(usage(&ee, &raw).unwrap()[0].1, 1);
        for values in [
            json!([]),
            json!([{"meterKey":"other","quantity":1,"occurredAt":"2026-01-01T00:00:00Z"}]),
            json!([{"meterKey":"read_count","quantity":0,"occurredAt":"2026-01-01T00:00:00Z"}]),
            json!([{"meterKey":"read_count","quantity":1,"occurredAt":"2026-01-01T00:00:02Z"}]),
        ] {
            let mut changed = raw.clone();
            changed["measurements"] = values;
            assert!(usage(&ee, &changed).is_err());
        }
        let mut changed = raw;
        changed["externalExecutionId"] = json!(Uuid::new_v4());
        assert!(usage(&ee, &changed).is_err());
    }

    #[test]
    fn no_meter_obligation_requires_explicit_frozen_empty_set() {
        assert!(no_meter_obligation(Some(&json!({"meters":[]}))).unwrap());
        assert!(!no_meter_obligation(source().usage_projection.as_ref()).unwrap());
        assert!(no_meter_obligation(None).is_err());
        assert!(no_meter_obligation(Some(&json!({}))).is_err());
    }
}
