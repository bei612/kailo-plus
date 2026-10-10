//! HUMAN same-request APPLICATION reads. Native content stays in the component;
//! the existing AE, audit and usage outbox retain only admission and completion.
use super::*;
use crate::application_binding::read_grant::receipt;
use crate::service_api::ServiceState;
use chrono::{DateTime, Utc};

pub(crate) fn is_read(ae: &Execution) -> bool {
    is_human(ae)
        && ae
            .parameters
            .as_ref()
            .is_some_and(|p| p["nativeRead"] == true)
}

/// Claim the original AE before issuing its only bearer. An interrupted signer
/// or lost HTTP response leaves UNKNOWN; neither observation nor retry reissues.
pub(super) async fn admit(
    state: &ServiceState,
    ae: &Execution,
    key: Uuid,
) -> Result<Option<Value>, Refusal> {
    if !is_read(ae) || ae.gate_state != "ALLOWED" {
        return Ok(None);
    }
    let mut tx = state.pool.begin().await?;
    let current = crate::governance::lock_execution(&mut tx, ae.id).await?;
    if current.gate_state != "ALLOWED" || current.dispatch_state != "NOT_DISPATCHED" {
        return Ok(None);
    }
    let def = receipt::frozen_definition(&mut tx, ae.id).await?;
    if def.execution_mode != "SYNC" || def.confirmation_mode != "NONE" {
        return Err(blocked());
    }
    let audience: String = sqlx::query_scalar("select s.audience from admission.action_execution a
        join catalog.application_binding b on b.id=a.component_binding_id and b.tenant_id=a.tenant_id
          and b.state='ACTIVE' and b.active_projection_generation=a.component_projection_generation
          and b.component_release_id=a.component_release_id
        join identity.service_principal s on s.principal_id=b.service_principal_id
          and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
        join identity.principal p on p.id=s.principal_id and p.tenant_id=b.tenant_id and p.kind='SERVICE' and p.status='ACTIVE'
        where a.id=$1 and a.idempotency_key=$2")
        .bind(ae.id).bind(key).fetch_optional(&mut *tx).await?.ok_or_else(denied)?;
    let deadline = current
        .parameters
        .as_ref()
        .and_then(|p| p["nativeReadDeadline"].as_i64())
        .ok_or_else(blocked)?;
    if Utc::now().timestamp() >= deadline {
        return Err(denied());
    }
    sqlx::query("update admission.action_execution set dispatch_state='UNKNOWN',reason_code='EXTERNAL_RESULT_UNKNOWN',
        updated_at=now() where id=$1")
        .bind(ae.id).execute(&mut *tx).await?;
    tx.commit().await?;
    let current = crate::governance::load_execution(&state.pool, ae.id)
        .await?
        .ok_or_else(unavailable)?;
    let token = crate::action_token::issue_native_read(state, &current, &audience, key).await?;
    let claims = crate::action_token::verify(&token, &audience)?;
    let stamp =
        json!({"jti":claims["jti"],"iat":claims["iat"],"exp":claims["exp"],"idempotencyKey":key});
    let mut tx = state.pool.begin().await?;
    let current = crate::governance::lock_execution(&mut tx, ae.id).await?;
    if current.dispatch_state != "UNKNOWN"
        || Utc::now().timestamp() >= deadline
        || current
            .parameters
            .as_ref()
            .is_none_or(|p| p.get("nativeReadToken").is_some())
    {
        return Err(denied());
    }
    sqlx::query(
        "update admission.action_execution set dispatch_state='DISPATCHED',reason_code=null,
        parameters=jsonb_set(parameters,'{nativeReadToken}',$2),updated_at=now() where id=$1",
    )
    .bind(ae.id)
    .bind(stamp)
    .execute(&mut *tx)
    .await?;
    crate::governance::audit(
        &mut tx,
        &current,
        &def,
        "native_read:admitted",
        "DECISION",
        "ALLOW",
        "READ_TOKEN_ISSUED",
        None,
        vec![],
    )
    .await?;
    tx.commit().await?;
    Ok(Some(
        json!({"actionToken":token,"argumentsJson":collab_bridge::limits::canonical_json(
        &current.parameters.as_ref().ok_or_else(unavailable)?["inputArguments"]),"expiresAt":claims["exp"]}),
    ))
}

pub(crate) fn dispatched(ae: &Execution, claims: &Value) -> bool {
    let Some(p) = ae.parameters.as_ref() else {
        return false;
    };
    is_read(ae)
        && ae.gate_state == "ALLOWED"
        && ae.dispatch_state == "DISPATCHED"
        && !p.get("nativeReadReceipt").is_some_and(Value::is_object)
        && claims.get("external_execution_id").is_none()
        && claims["jti"].is_string()
        && claims["jti"] == p["nativeReadToken"]["jti"]
        && claims["exp"].is_number()
        && claims["exp"] == p["nativeReadToken"]["exp"]
        && claims["idempotency_key"].is_string()
        && claims["idempotency_key"] == p["nativeReadToken"]["idempotencyKey"]
}

fn completion(ae: &Execution, raw: &Value, now: DateTime<Utc>) -> Result<(), Refusal> {
    let p = ae.parameters.as_ref().ok_or_else(invalid)?;
    let input = &p["inputArguments"]["input"];
    let at = DateTime::parse_from_rfc3339(raw["completedAt"].as_str().ok_or_else(invalid)?)
        .map_err(|_| invalid())?
        .with_timezone(&Utc);
    let started = DateTime::parse_from_rfc3339(raw["startedAt"].as_str().ok_or_else(invalid)?)
        .map_err(|_| invalid())?
        .with_timezone(&Utc);
    if !is_read(ae)
        || ae.gate_state != "ALLOWED"
        || !matches!(ae.dispatch_state.as_str(), "DISPATCHED" | "UNKNOWN")
        || raw["operationId"] != json!(ae.operation_id)
        || raw["idempotencyKey"] != p["nativeReadToken"]["idempotencyKey"]
        || raw["nativeObjectRef"] != input["nativeObjectRef"]
        || raw["nativeRevision"] != input["nativeRevision"]
        || raw["contentBytes"].as_i64().is_none_or(|v| v < 0)
        || raw["contentSha256"].as_str().is_none_or(|v| {
            v.len() != 64
                || !v
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
        || at > now
        || started > at
        || p["nativeReadToken"]["iat"]
            .as_i64()
            .is_none_or(|v| started.timestamp() < v)
        || p["nativeReadToken"]["exp"]
            .as_i64()
            .is_none_or(|v| started.timestamp() >= v)
    {
        return Err(denied());
    }
    let meters: Vec<crate::openmeter::ApplicationMeter> =
        serde_json::from_value(p["nativeReadBilling"]["meters"].clone()).map_err(|_| blocked())?;
    let values = raw["measurements"].as_array().ok_or_else(invalid)?;
    let mut keys = std::collections::BTreeSet::new();
    if values.len() != meters.len()
        || values.iter().any(|value| {
            let Some(key) = value["meterKey"].as_str() else {
                return true;
            };
            let Some(quantity) = value["quantity"].as_i64().filter(|v| *v >= 0) else {
                return true;
            };
            !keys.insert(key)
                || !meters
                    .iter()
                    .any(|m| m.key == key && (m.value_property.is_some() || quantity == 1))
        })
    {
        return Err(blocked());
    }
    Ok(())
}

/// Late completion is authenticated SERVICE metadata, not renewed HUMAN access.
/// Revocation never discards incurred usage; disclosure has its separate fresh
/// HUMAN observation after this transaction and native ACL check.
pub(super) async fn record(
    state: &ServiceState,
    headers: &axum::http::HeaderMap,
    binding: Uuid,
    raw: &Value,
) -> Result<Value, Refusal> {
    let operation = id(&raw["operationId"])?;
    let mut tx = state.pool.begin().await?;
    let action: Uuid = sqlx::query_scalar(
        "select id from admission.action_execution
        where operation_id=$1 and parent_action_execution_id is null and component_binding_id=$2
          and actor_principal_id=initiator_principal_id and parameters->'nativeRead'='true'",
    )
    .bind(operation)
    .bind(binding)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(denied)?;
    let ae = crate::governance::lock_execution(&mut tx, action).await?;
    completion(&ae, raw, Utc::now())?;
    let p = ae.parameters.as_ref().ok_or_else(invalid)?;
    let pin = &p["nativeReadBilling"];
    let client: String = sqlx::query_scalar("select b.normalized_config->>'client_id'
        from catalog.application_binding b join identity.service_principal s on s.principal_id=b.service_principal_id
          and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
        join identity.principal p on p.id=s.principal_id and p.tenant_id=b.tenant_id and p.kind='SERVICE'
        where b.id=$1 and b.tenant_id=$2 and exists(select 1 from projection.application_runtime r
          where r.binding_id=b.id and r.generation=$3 and r.component_release_id=$4)
          and (select count(*) from catalog.application_binding other
            where other.normalized_config->>'client_id'=b.normalized_config->>'client_id')=1")
        .bind(binding).bind(ae.tenant_id).bind(pin["generation"].as_i64().ok_or_else(invalid)?)
        .bind(id(&pin["releaseId"])?).fetch_optional(&mut *tx).await?.ok_or_else(denied)?;
    let mut values = headers.get_all(axum::http::header::AUTHORIZATION).iter();
    let header = values
        .next()
        .and_then(|v| v.to_str().ok())
        .ok_or_else(denied)?;
    if values.next().is_some() || pin["bindingId"] != json!(binding) {
        return Err(denied());
    }
    state
        .auth
        .verify_binding_client(Some(header), &client)
        .await
        .map_err(|_| denied())?;
    if let Some(previous) = p.get("nativeReadReceipt") {
        if previous != raw {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
    } else {
        sqlx::query("update admission.action_execution set parameters=jsonb_set(parameters,'{nativeReadReceipt}',$2),updated_at=now() where id=$1")
            .bind(ae.id).bind(raw).execute(&mut *tx).await?;
        receipt::record_usage(&mut tx, &ae, raw, pin, ae.id, "HUMAN").await?;
        let def = receipt::frozen_definition(&mut tx, action).await?;
        crate::governance::audit(
            &mut tx,
            &ae,
            &def,
            "native_read:receipt",
            "RECONCILIATION",
            "NONE",
            "NATIVE_RECEIPT_RECORDED",
            None,
            vec![],
        )
        .await?;
    }
    tx.commit().await?;
    if !settle(state, action).await? {
        return Err(unavailable());
    }
    Ok(
        json!({"operationId":operation,"receiptDigest":collab_bridge::limits::canonical_digest(raw)}),
    )
}

async fn settle(state: &ServiceState, action: Uuid) -> Result<bool, Refusal> {
    let ae = crate::governance::load_execution(&state.pool, action)
        .await?
        .ok_or_else(unavailable)?;
    let p = ae.parameters.as_ref().ok_or_else(invalid)?;
    if !is_read(&ae) || !p["nativeReadReceipt"].is_object() {
        return Ok(false);
    }
    let meters: Vec<crate::openmeter::ApplicationMeter> =
        serde_json::from_value(p["nativeReadBilling"]["meters"].clone()).map_err(|_| blocked())?;
    let events: Vec<Uuid> = meters
        .iter()
        .map(|m| {
            Uuid::new_v5(
                &Uuid::NAMESPACE_URL,
                format!(
                    "{}:APPLICATION_ADAPTER_USAGE:{}:{}",
                    ae.tenant_id, ae.id, m.key
                )
                .as_bytes(),
            )
        })
        .collect();
    if !crate::gateway_usage::settle_events(&state.pool, &events, &state.openmeter)
        .await
        .map_err(|_| blocked())?
    {
        return Ok(false);
    }
    let mut tx = state.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, action).await?;
    let committed: i64 = sqlx::query_scalar("select count(*) from outbox.usage_event where id=any($1)
        and operation_id=$2 and tenant_id=$3 and source_id=$4 and settlement_status='COMMITTED' and stored_at is not null")
        .bind(&events).bind(ae.operation_id).bind(ae.tenant_id).bind(ae.id).fetch_one(&mut *tx).await?;
    if committed != i64::try_from(events.len()).map_err(|_| invalid())? {
        return Ok(false);
    }
    let def = receipt::frozen_definition(&mut tx, action).await?;
    crate::governance::audit(
        &mut tx,
        &ae,
        &def,
        "component_action:terminal",
        "OUTCOME",
        "ALLOW",
        "COMPLETED",
        None,
        events
            .iter()
            .map(|id| crate::audit::Evidence::new(contracts::EvidenceKind::UsageEventId, id))
            .collect(),
    )
    .await?;
    sqlx::query("update admission.action_execution set dispatch_state='DISPATCHED',reason_code=null,updated_at=now() where id=$1")
        .bind(action).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(true)
}

/// The original reconciler owns expiry and metering recovery. No source reads
/// occur here. Missing receipts become visible UNKNOWN obligations, never zero.
pub(crate) async fn reconcile(state: &ServiceState, batch: i64) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    let ids: Vec<Uuid> = sqlx::query_scalar("select a.id from admission.action_execution a
        where a.parameters->'nativeRead'='true' and a.parameters->>'componentActionKind'='COMPONENT_ACTION'
          and a.gate_state='ALLOWED' and a.dispatch_state in ('NOT_DISPATCHED','DISPATCHED','UNKNOWN')
          and not exists(select 1 from audit.audit_event e where e.event_key=a.operation_id::text||':component_action:terminal')
        order by coalesce(a.reconcile_last_attempt_at,a.updated_at),a.id limit $1 for update of a skip locked")
        .bind(batch).fetch_all(&mut *tx).await?;
    for action in &ids {
        let ae = crate::governance::lock_execution(&mut tx, *action).await?;
        let p = ae.parameters.as_ref().ok_or_else(invalid)?;
        if ae.dispatch_state == "NOT_DISPATCHED" {
            if p.get("nativeReadToken").is_some() {
                return Err(blocked());
            }
            if p["nativeReadDeadline"]
                .as_i64()
                .is_none_or(|v| v <= Utc::now().timestamp())
            {
                let def = receipt::frozen_definition(&mut tx, *action).await?;
                crate::governance::audit(
                    &mut tx,
                    &ae,
                    &def,
                    "component_action:terminal",
                    "OUTCOME",
                    "DENY",
                    "FAILED",
                    None,
                    vec![],
                )
                .await?;
                sqlx::query("update admission.action_execution set gate_state='DENIED',reason_code='ADMISSION_ABANDONED',reconcile_last_attempt_at=now(),updated_at=now() where id=$1")
                    .bind(action).execute(&mut *tx).await?;
            }
            sqlx::query(
                "update admission.action_execution set reconcile_last_attempt_at=now() where id=$1",
            )
            .bind(action)
            .execute(&mut *tx)
            .await?;
            continue;
        }
        if !p["nativeReadReceipt"].is_object()
            && p["nativeReadToken"]["exp"]
                .as_i64()
                .or_else(|| p["nativeReadDeadline"].as_i64())
                .is_none_or(|v| v <= Utc::now().timestamp())
        {
            sqlx::query("update admission.action_execution set dispatch_state='UNKNOWN',reason_code='EXTERNAL_RESULT_UNKNOWN',updated_at=now() where id=$1")
                .bind(action).execute(&mut *tx).await?;
            let def = receipt::frozen_definition(&mut tx, *action).await?;
            crate::governance::audit(
                &mut tx,
                &ae,
                &def,
                "native_read:expired",
                "RECONCILIATION",
                "NONE",
                "EXTERNAL_RESULT_UNKNOWN",
                None,
                vec![],
            )
            .await?;
        }
        sqlx::query(
            "update admission.action_execution set reconcile_last_attempt_at=now() where id=$1",
        )
        .bind(action)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    for action in ids {
        settle(state, action).await?;
    }
    Ok(())
}

pub(crate) async fn drained(pool: &sqlx::PgPool, binding: Uuid) -> Result<bool, Refusal> {
    sqlx::query_scalar("select not exists(select 1 from admission.action_execution a
        where a.component_binding_id=$1 and a.parameters->'nativeRead'='true'
          and a.gate_state='ALLOWED' and a.dispatch_state in ('DISPATCHED','UNKNOWN')
          and not exists(select 1 from audit.audit_event e where e.event_key=a.operation_id::text||':component_action:terminal'))")
        .bind(binding).fetch_one(pool).await.map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires migrated isolated APPLICATION_EXECUTION_TEST_DATABASE_URL"]
    async fn native_read_sql_freezes_receipt_and_rejects_missing_evidence() {
        use sqlx::Connection;
        let mut conn = PgConnection::connect(
            &std::env::var("APPLICATION_EXECUTION_TEST_DATABASE_URL")
                .expect("isolated database URL"),
        )
        .await
        .unwrap();
        let mut tx = conn.begin().await.unwrap();
        // Exercise the real installed trigger on a temporary AE-shaped row;
        // existing unrelated FK/lifecycle fixtures are not bypassed in production.
        sqlx::raw_sql(r#"
-- NATIVE_READ_SQL_BEGIN
CREATE TEMP TABLE native_read_fixture AS SELECT * FROM admission.action_execution WITH NO DATA;
CREATE TRIGGER native_read_test BEFORE INSERT OR UPDATE ON native_read_fixture FOR EACH ROW EXECUTE FUNCTION admission.guard_native_human_read();
DO $$ DECLARE tenant uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); binding uuid:=gen_random_uuid();
  release uuid:=gen_random_uuid(); resource uuid:=gen_random_uuid(); operation uuid:=gen_random_uuid(); request uuid:=gen_random_uuid();
  receipt jsonb; changed jsonb; field text;
BEGIN
 INSERT INTO identity.tenant(id,slug,name,state) VALUES(tenant,tenant::text,'isolated native read guard','ACTIVE');
 INSERT INTO identity.principal(id,tenant_id,kind,status) VALUES(actor,tenant,'HUMAN','ACTIVE');
 INSERT INTO native_read_fixture(id,operation_id,tenant_id,actor_principal_id,initiator_principal_id,target_id,
   action_definition_id,idempotency_key,gate_state,dispatch_state,component_binding_kind,component_binding_id,
   component_release_id,component_projection_generation,parameters)
 SELECT gen_random_uuid(),operation,tenant,actor,actor,resource,id,request,'ALLOWED','DISPATCHED','APPLICATION',binding,release,1,
   jsonb_build_object('componentActionKind','COMPONENT_ACTION','nativeRead',true,'nativeReadDeadline',floor(extract(epoch FROM now()))::bigint+60,
     'inputArguments',jsonb_build_object('input',jsonb_build_object('nativeObjectRef','file','nativeRevision','fixed')),
     'nativeReadBilling',jsonb_build_object('bindingId',binding,'releaseId',release,'generation',1,'resourceId',resource,
       'meters',jsonb_build_array(jsonb_build_object('key','reads','value_property',null))),
     'nativeReadToken',jsonb_build_object('jti',gen_random_uuid(),'iat',floor(extract(epoch FROM now()))::bigint-1,
       'exp',floor(extract(epoch FROM now()))::bigint+60,'idempotencyKey',request))
 FROM catalog.action_definition WHERE action_key='agent.memory.core.read' AND execution_mode='SYNC' AND confirmation_mode='NONE';
 IF NOT FOUND THEN RAISE EXCEPTION 'original SYNC read fixture definition unavailable'; END IF;
 BEGIN
   UPDATE native_read_fixture SET dispatch_state='NOT_DISPATCHED';
   RAISE EXCEPTION 'accepted claim reset without no-execution evidence';
 EXCEPTION WHEN check_violation THEN NULL; END;
 receipt:=jsonb_build_object('operationId',operation,'idempotencyKey',request,'nativeObjectRef','file','nativeRevision','fixed',
   'contentSha256',repeat('a',64),'contentBytes',7,'startedAt',now(),'completedAt',now(),'measurements',jsonb_build_array(jsonb_build_object('meterKey','reads','quantity',1)));
 FOREACH field IN ARRAY ARRAY['operationId','idempotencyKey','nativeObjectRef','nativeRevision','contentSha256','contentBytes','startedAt','completedAt','measurements'] LOOP
   BEGIN
     UPDATE native_read_fixture SET parameters=jsonb_set(parameters,'{nativeReadReceipt}',receipt-field);
     RAISE EXCEPTION 'accepted missing receipt field %',field;
   EXCEPTION WHEN check_violation THEN NULL; END;
 END LOOP;
 FOREACH changed IN ARRAY ARRAY[
   receipt||jsonb_build_object('operationId',gen_random_uuid()),
   receipt||jsonb_build_object('nativeRevision','another'),
   receipt||jsonb_build_object('body','forbidden'),
   jsonb_set(receipt,'{measurements,0,quantity}','0'),
   receipt||jsonb_build_object('completedAt',now()+interval '1 hour')
 ] LOOP
   BEGIN
     UPDATE native_read_fixture SET parameters=jsonb_set(parameters,'{nativeReadReceipt}',changed);
     RAISE EXCEPTION 'accepted foreign or incomplete receipt';
   EXCEPTION WHEN check_violation THEN NULL; END;
 END LOOP;
 UPDATE native_read_fixture SET parameters=jsonb_set(parameters,'{nativeReadReceipt}',receipt);
 BEGIN
   UPDATE native_read_fixture SET operation_id=gen_random_uuid();
   RAISE EXCEPTION 'accepted changed original operation';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   UPDATE native_read_fixture SET parameters=parameters-'nativeReadReceipt';
   RAISE EXCEPTION 'accepted removed completion evidence';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
-- NATIVE_READ_SQL_END
"#).execute(&mut *tx).await.unwrap();
        tx.rollback().await.unwrap();
    }

    fn fixture() -> (Execution, Value, Value) {
        let now = Utc::now();
        let actor = Uuid::new_v4();
        let operation = Uuid::new_v4();
        let key = Uuid::new_v4();
        let jti = Uuid::new_v4();
        let stamp = json!({"jti":jti,"iat":now.timestamp()-1,"exp":now.timestamp()+60,"idempotencyKey":key});
        let input = json!({"nativeObjectRef":"native-file","nativeRevision":"fixed-version"});
        let receipt = json!({"operationId":operation,"idempotencyKey":key,"nativeObjectRef":"native-file",
            "nativeRevision":"fixed-version","contentSha256":"a".repeat(64),"contentBytes":7,
            "startedAt":now.to_rfc3339(),"completedAt":now.to_rfc3339(),"measurements":[{"meterKey":"read_count","quantity":1}]});
        let ae = Execution {
            id: Uuid::new_v4(),
            operation_id: operation,
            tenant_id: Uuid::new_v4(),
            workspace_id: None,
            action_key: "source.read@v1".into(),
            action_version: 1,
            initiator_principal_id: actor,
            actor_principal_id: actor,
            target_id: Uuid::new_v4(),
            parameter_hash: "frozen".into(),
            parameters: Some(json!({"componentActionKind":KIND,
                "nativeRead":true,"nativeReadToken":stamp,"inputArguments":{"input":input},
                "nativeReadBilling":{"meters":[{"id":"meter","key":"read_count","event_type":"native.read","value_property":null}]}})),
            temporal_workflow_id: None,
            cancel_first_run_id: None,
            approval_workflow_id: None,
            approval_expires_at: None,
            gate_state: "ALLOWED".into(),
            dispatch_state: "DISPATCHED".into(),
            reason_code: None,
            correlation_id: operation,
            updated_at: now,
        };
        (
            ae,
            receipt,
            json!({"jti":jti,"exp":now.timestamp()+60,"idempotency_key":key}),
        )
    }

    #[test]
    fn native_read_completion_is_exact_human_metadata_not_service_or_task() {
        let (ae, receipt, _) = fixture();
        assert!(completion(&ae, &receipt, Utc::now()).is_ok());
        for (field, value) in [
            ("operationId", json!(Uuid::new_v4())),
            ("idempotencyKey", json!(Uuid::new_v4())),
            ("nativeObjectRef", json!("foreign")),
            ("nativeRevision", json!("new-head")),
            ("contentBytes", json!(-1)),
            ("contentSha256", json!("unverified")),
            ("completedAt", json!("invalid")),
            ("startedAt", json!("invalid")),
            ("measurements", json!([])),
            (
                "measurements",
                json!([{"meterKey":"read_count","quantity":0}]),
            ),
        ] {
            let mut changed = receipt.clone();
            changed[field] = value;
            assert!(
                completion(&ae, &changed, Utc::now()).is_err(),
                "accepted changed {field}"
            );
        }
        let mut service = ae.clone();
        service.parameters.as_mut().unwrap()["componentActionKind"] = json!("SERVICE_READ");
        assert!(completion(&service, &receipt, Utc::now()).is_err());
        let mut other = ae.clone();
        other.actor_principal_id = Uuid::new_v4();
        assert!(completion(&other, &receipt, Utc::now()).is_err());
        let mut expired = ae.clone();
        let started = DateTime::parse_from_rfc3339(receipt["startedAt"].as_str().unwrap()).unwrap();
        expired.parameters.as_mut().unwrap()["nativeReadToken"]["exp"] = json!(started.timestamp());
        assert!(completion(&expired, &receipt, Utc::now()).is_err());
        let mut late = receipt.clone();
        late["startedAt"] = json!((started - chrono::Duration::seconds(1)).to_rfc3339());
        assert!(
            completion(&expired, &late, Utc::now()).is_ok(),
            "incurred usage must survive admission-token expiry"
        );
    }

    #[test]
    fn native_read_first_ticket_cannot_replay_unknown_or_completed_content() {
        let (ae, receipt, claims) = fixture();
        assert!(dispatched(&ae, &claims));
        for (field, value) in [
            ("jti", json!(Uuid::new_v4())),
            ("exp", json!(0)),
            ("idempotency_key", json!(Uuid::new_v4())),
            ("external_execution_id", json!(Uuid::new_v4())),
        ] {
            let mut changed = claims.clone();
            changed[field] = value;
            assert!(!dispatched(&ae, &changed), "accepted changed {field}");
        }
        let mut unknown = ae.clone();
        unknown.dispatch_state = "UNKNOWN".into();
        assert!(!dispatched(&unknown, &claims));
        let mut complete = ae.clone();
        complete.parameters.as_mut().unwrap()["nativeReadReceipt"] = receipt;
        assert!(!dispatched(&complete, &claims));
    }
}
