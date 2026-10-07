//! DD-89: native read/import receipts on the existing synchronous AE and usage
//! outbox. No ExternalExecution, Workflow, file body or receiver job mirror.
use super::*;
use crate::openmeter::ApplicationMeter;
use chrono::{DateTime, Utc};

pub(super) async fn billing(
    state: &ServiceState,
    conn: &mut PgConnection,
    tenant: Uuid,
    binding: Uuid,
    generation: i64,
    resource: Uuid,
    definition: &crate::application_catalog::ApplicationDefinition,
) -> Result<Value, Refusal> {
    let def = &definition.definition;
    let mut value = json!({"bindingId":binding,"generation":generation,
        "releaseId":definition.component_release_id,"resourceId":resource,"meters":[]});
    if def.meters.is_empty() {
        let usage_source: String = sqlx::query_scalar(
            "select obs_usage_source from catalog.action_definition where id=$1",
        )
        .bind(definition.definition_id)
        .fetch_one(&mut *conn)
        .await?;
        if def.quota_policy != "NONE" || usage_source != "NONE" {
            return Err(blocked());
        }
        return Ok(value);
    }
    let (customer, namespace, prefix, version): (String, String, String, i32) = sqlx::query_as(
        "select customer_id,namespace,subject_key_prefix,version from projection.openmeter_binding
         where tenant_id=$1 and status='ACTIVE' for share",
    )
    .bind(tenant)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(blocked)?;
    if namespace != state.openmeter.namespace() {
        return Err(blocked());
    }
    let subject = format!("{prefix}{binding}");
    let meters = state
        .openmeter
        .application_meters(tenant, &customer, &subject, &def.meters)
        .await
        .map_err(|_| blocked())?;
    value["meters"] = serde_json::to_value(meters).map_err(|_| invalid())?;
    value["customer_id"] = json!(customer);
    value["namespace"] = json!(namespace);
    value["subject"] = json!(subject);
    value["binding_version"] = json!(version);
    Ok(value)
}

fn timestamp(value: &Value) -> Result<DateTime<Utc>, Refusal> {
    DateTime::parse_from_rfc3339(text(value, "completedAt")?)
        .map(|at| at.with_timezone(&Utc))
        .map_err(|_| invalid())
}

pub(super) async fn receiver_billing(
    conn: &mut PgConnection,
    execution: Uuid,
    key: Uuid,
    binding: Uuid,
    generation: i64,
    resource: Uuid,
) -> Result<Value, Refusal> {
    // Parsing already has an immutable native EE obligation. Transfer its exact
    // measurement projection into this batch, never re-resolve a later tariff.
    let (release,mut projection):(Uuid,Value)=sqlx::query_as("select component_release_id,usage_projection
        from admission.external_execution where action_execution_id=$1 and idempotency_key=$2
          and component_binding_id=$3 and component_projection_generation=$4 and usage_projection is not null for share")
        .bind(execution).bind(key).bind(binding).bind(generation).fetch_optional(conn).await?.ok_or_else(blocked)?;
    projection.as_object_mut().ok_or_else(blocked)?.extend([
        ("bindingId".into(), json!(binding)),
        ("generation".into(), json!(generation)),
        ("releaseId".into(), json!(release)),
        ("resourceId".into(), json!(resource)),
    ]);
    Ok(projection)
}

fn validate(ae: &Execution, raw: &Value, now: DateTime<Utc>) -> Result<(), Refusal> {
    let p = ae.parameters.as_ref().ok_or_else(invalid)?;
    let role = text(raw, "role")?;
    let pinned = &p["readBilling"][role];
    text(raw, "nativeObjectRef")?;
    text(raw, "nativeRevision")?;
    if !is_service(ae)
        || !matches!(role, "SOURCE" | "RECEIVER")
        || ae.gate_state != "ALLOWED"
        || !matches!(ae.dispatch_state.as_str(), "DISPATCHED" | "UNKNOWN")
        || raw["operationId"] != json!(ae.operation_id)
        || raw["bindingId"] != pinned["bindingId"]
        || raw["idempotencyKey"] != p["idempotencyKey"]
        || raw["contentBytes"].as_i64().is_none_or(|bytes| bytes < 0)
        || raw["contentSha256"].as_str().is_none_or(|digest| {
            digest.len() != 64
                || !digest
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        })
        || timestamp(raw)? > now
    {
        return Err(denied());
    }
    let at = timestamp(raw)?;
    if role == "SOURCE" {
        if raw["nativeObjectRef"] != p["readReference"]["nativeObjectRef"]
            || raw["nativeRevision"] != p["readReference"]["nativeRevision"]
            || p["readToken"]["iat"]
                .as_i64()
                .is_none_or(|iat| at.timestamp() < iat)
            || p["readToken"]["exp"]
                .as_i64()
                .is_none_or(|exp| at.timestamp() >= exp)
        {
            return Err(denied());
        }
    } else {
        let source = &p["readReceipts"]["SOURCE"];
        if !source.is_object()
            || source["contentSha256"] != raw["contentSha256"]
            || source["contentBytes"] != raw["contentBytes"]
            || at < timestamp(source)?
        {
            return Err(denied());
        }
    }
    let meters: Vec<ApplicationMeter> =
        serde_json::from_value(pinned["meters"].clone()).map_err(|_| blocked())?;
    let values = raw["measurements"].as_array().ok_or_else(invalid)?;
    let mut keys = std::collections::BTreeSet::new();
    if values.len() != meters.len()
        || values.iter().any(|value| {
            let Some(key) = value["meterKey"].as_str() else {
                return true;
            };
            let Some(quantity) = value["quantity"].as_i64().filter(|quantity| *quantity >= 0)
            else {
                return true;
            };
            !keys.insert(key)
                || !meters.iter().any(|meter| {
                    meter.key == key && (meter.value_property.is_some() || quantity == 1)
                })
        })
    {
        return Err(blocked());
    }
    Ok(())
}

async fn usage(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ae: &Execution,
    raw: &Value,
) -> Result<(), Refusal> {
    let p = ae.parameters.as_ref().ok_or_else(invalid)?;
    let role = text(raw, "role")?;
    let pin = &p["readBilling"][role];
    let meters: Vec<ApplicationMeter> =
        serde_json::from_value(pin["meters"].clone()).map_err(|_| blocked())?;
    let source = if role == "SOURCE" {
        ae.id
    } else {
        uuid(p, "receiverActionExecutionId")?
    };
    let at = timestamp(raw)?;
    for meter in meters {
        let quantity = raw["measurements"]
            .as_array()
            .ok_or_else(invalid)?
            .iter()
            .find(|value| value["meterKey"] == meter.key)
            .and_then(|value| value["quantity"].as_i64())
            .ok_or_else(invalid)?;
        let id = Uuid::new_v5(
            &Uuid::NAMESPACE_URL,
            format!(
                "{}:APPLICATION_ADAPTER_USAGE:{}:{}",
                ae.tenant_id, source, meter.key
            )
            .as_bytes(),
        );
        let dimensions = json!({"tenant_id":ae.tenant_id,"workspace_id":ae.workspace_id,"operation_id":ae.operation_id,
            "component_binding_id":pin["bindingId"],"component_release_id":pin["releaseId"],
            "component_projection_generation":pin["generation"],"resource_id":pin["resourceId"],
            "read_action_execution_id":ae.id,"read_role":role});
        let mut data = dimensions.clone();
        if meter.value_property.is_some() {
            data["quantity"] = json!(quantity);
        }
        let event = json!({"specversion":"1.0","source":"urn:platform:core:usage","id":id,
            "type":meter.event_type,"subject":pin["subject"],"time":at,"data":data});
        sqlx::query("insert into outbox.usage_event(id,operation_id,tenant_id,workspace_id,openmeter_customer_id,
            source_type,source_id,meter_key,subject_key,quantity,occurred_at,dimensions,openmeter_event_id,event,
            settlement_status,openmeter_namespace,component_binding_id,component_release_id,component_projection_generation)
            values($1,$2,$3,$4,$5,'APPLICATION_ADAPTER_USAGE',$6,$7,$8,$9,$10,$11,$1,$12,'PENDING_PUBLISH',$13,$14,$15,$16)
            on conflict(tenant_id,source_type,source_id,meter_key) do nothing")
            .bind(id).bind(ae.operation_id).bind(ae.tenant_id).bind(ae.workspace_id)
            .bind(pin["customer_id"].as_str()).bind(source).bind(&meter.key).bind(pin["subject"].as_str())
            .bind(quantity).bind(at).bind(&dimensions).bind(&event).bind(pin["namespace"].as_str())
            .bind(uuid(pin,"bindingId")?).bind(uuid(pin,"releaseId")?).bind(pin["generation"].as_i64().ok_or_else(invalid)?)
            .execute(&mut **tx).await?;
        let previous: Value =
            sqlx::query_scalar("select event from outbox.usage_event where id=$1")
                .bind(id)
                .fetch_one(&mut **tx)
                .await?;
        if previous != event {
            return Err(conflict());
        }
    }
    Ok(())
}

pub(crate) async fn record(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let result=async {
        let Json(raw)=body.map_err(|_|invalid())?;
        let typed:contracts::AdapterReadReceipt=serde_json::from_value(raw.clone()).map_err(|_|invalid())?;
        if serde_json::to_value(typed).map_err(|_|invalid())?!=raw {return Err(invalid());}
        let binding=uuid(&raw,"bindingId")?;
        let operation=uuid(&raw,"operationId")?;
        let role=text(&raw,"role")?;
        let mut tx=state.pool.begin().await?;
        let id:Uuid=sqlx::query_scalar("select id from admission.action_execution where operation_id=$1
            and parent_action_execution_id is null and parameters->>'componentActionKind'='SERVICE_READ'")
            .bind(operation).fetch_optional(&mut *tx).await?.ok_or_else(denied)?;
        let ae=crate::governance::lock_execution(&mut tx,id).await?;
        validate(&ae,&raw,Utc::now())?;
        let p=ae.parameters.as_ref().ok_or_else(invalid)?;
        let pin=&p["readBilling"][role];
        let client:String=sqlx::query_scalar("select normalized_config->>'client_id' from catalog.application_binding
            where id=$1 and tenant_id=$2 and state in ('ACTIVE','DISABLING') and active_projection_generation=$3
              and component_release_id=$4")
            .bind(binding).bind(ae.tenant_id).bind(pin["generation"].as_i64().ok_or_else(invalid)?)
            .bind(uuid(pin,"releaseId")?).fetch_optional(&mut *tx).await?.ok_or_else(denied)?;
        let clients:i64=sqlx::query_scalar("select count(*) from catalog.application_binding
            where normalized_config->>'client_id'=$1 and state<>'DISABLED'")
            .bind(&client).fetch_one(&mut *tx).await?;
        if client.is_empty() || clients!=1 {return Err(denied());}
        let mut values=headers.get_all(axum::http::header::AUTHORIZATION).iter();
        let header=values.next().and_then(|v|v.to_str().ok()).ok_or_else(denied)?;
        if values.next().is_some() {return Err(denied());}
        state.auth.verify_binding_client(Some(header),&client).await.map_err(|_|denied())?;
        let existing=&p["readReceipts"][role];
        if !existing.is_null() {
            let mut old=existing.clone();
            let mut new=raw.clone();
            old.as_object_mut().ok_or_else(invalid)?.remove("completedAt");
            new.as_object_mut().ok_or_else(invalid)?.remove("completedAt");
            if old!=new {return Err(conflict());}
        } else {
            let mut receipts=p.get("readReceipts").cloned().unwrap_or_else(||json!({}));
            receipts[role]=raw.clone();
            sqlx::query("update admission.action_execution set parameters=jsonb_set(parameters,'{readReceipts}',$2),updated_at=now()
                where id=$1").bind(id).bind(receipts).execute(&mut *tx).await?;
            usage(&mut tx,&ae,&raw).await?;
            let def=frozen_definition(&mut tx,id).await?;
            crate::governance::audit(&mut tx,&ae,&def,&format!("service_read:receipt:{role}"),
                "RECONCILIATION","NONE","NATIVE_RECEIPT_RECORDED",None,vec![]).await?;
        }
        tx.commit().await?;
        Ok::<_,Refusal>(json!({"operationId":operation,"receiptDigest":collab_bridge::limits::canonical_digest(&raw)}))
    }.await;
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => error.respond(None),
    }
}

pub(super) async fn frozen_definition(
    conn: &mut PgConnection,
    id: Uuid,
) -> Result<Definition, Refusal> {
    sqlx::query_as(&format!("select {} from catalog.action_definition d where exists(
        select 1 from admission.action_execution a where a.id=$1 and a.action_definition_id=d.id
        and a.component_release_id=d.component_release_id and a.action_key=d.action_key and a.action_version=d.version)",
        crate::governance::DEFINITION_COLUMNS)).bind(id).fetch_one(conn).await.map_err(Into::into)
}

/// The receiver's original async EE still owns native parsing. Its measurements
/// are charged once by the SYNC read operation, not charged again under the
/// initiating human operation when the ordinary EE observer extracts usage.
pub(crate) async fn receiver_usage(
    conn: &mut PgConnection,
    receiver_action: Uuid,
    key: Uuid,
    raw: &Value,
) -> Result<Option<bool>, Refusal> {
    let row:Option<(Uuid,Value,bool)>=sqlx::query_as("select a.operation_id,coalesce(a.parameters->'readReceipts'->'RECEIVER','null'::jsonb),
        exists(select 1 from audit.audit_event e where e.event_key=a.operation_id::text||':service_read:terminal')
        from admission.action_execution a where a.parameters->>'componentActionKind'='SERVICE_READ'
          and a.parameters->>'receiverActionExecutionId'=$1 and a.parameters->>'idempotencyKey'=$2")
        .bind(receiver_action.to_string()).bind(key.to_string()).fetch_optional(conn).await?;
    let Some((_operation, receipt, committed)) = row else {
        return Ok(None);
    };
    if !receipt.is_object() {
        return Ok(Some(false));
    }
    if raw["nativeId"] != receipt["nativeObjectRef"] {
        return Err(conflict());
    }
    let expected = receipt["measurements"].as_array().ok_or_else(invalid)?;
    let actual = raw["measurements"].as_array().ok_or_else(invalid)?;
    if expected.len() != actual.len()
        || actual.iter().any(|item| {
            !expected.iter().any(|entry| {
                item["meterKey"] == entry["meterKey"]
                    && item["quantity"] == entry["quantity"]
                    && item["occurredAt"] == receipt["completedAt"]
            })
        })
    {
        return Err(conflict());
    }
    Ok(Some(committed))
}

pub(crate) async fn receiver_settled(
    pool: &sqlx::PgPool,
    receiver_action: Uuid,
    key: Uuid,
    native_id: Option<&str>,
) -> Result<Option<bool>, Refusal> {
    sqlx::query_scalar("select coalesce(a.parameters->'readReceipts'->'RECEIVER'->>'nativeObjectRef'=$3
        and exists(select 1 from audit.audit_event e where e.event_key=a.operation_id::text||':service_read:terminal'),false)
        from admission.action_execution a where a.parameters->>'componentActionKind'='SERVICE_READ'
        and a.parameters->>'receiverActionExecutionId'=$1 and a.parameters->>'idempotencyKey'=$2")
        .bind(receiver_action.to_string()).bind(key.to_string()).bind(native_id)
        .fetch_optional(pool).await.map_err(Into::into)
}

/// Existing Agent child settlement consumes the receiver's native measurement
/// under the read batch operation. It must not expect a second EE-sourced bill.
pub(crate) async fn receiver_events(
    pool: &sqlx::PgPool,
    external: Uuid,
) -> Result<Option<Vec<(Uuid, String)>>, Refusal> {
    let batch:Option<(Uuid,Uuid,bool)>=sqlx::query_as("select a.id,a.operation_id,
        coalesce(a.parameters->'readReceipts'->'RECEIVER'->>'nativeObjectRef'=e.native_id
          and exists(select 1 from audit.audit_event x where x.event_key=a.operation_id::text||':service_read:terminal'),false)
        from admission.external_execution e join admission.action_execution a
          on a.parameters->>'receiverActionExecutionId'=e.action_execution_id::text
          and a.parameters->>'idempotencyKey'=e.idempotency_key::text
        where e.id=$1 and a.parameters->>'componentActionKind'='SERVICE_READ'
          and a.tenant_id=e.tenant_id
          and a.parameters->'readBilling'->'RECEIVER'->>'bindingId'=e.component_binding_id::text
          and a.parameters->'readBilling'->'RECEIVER'->>'releaseId'=e.component_release_id::text
          and a.parameters->'readBilling'->'RECEIVER'->>'generation'=e.component_projection_generation::text")
        .bind(external).fetch_optional(pool).await?;
    let Some((read, operation, complete)) = batch else {
        return Ok(None);
    };
    if !complete {
        return Err(blocked());
    }
    let events=sqlx::query_as("select u.id,u.meter_key from outbox.usage_event u
        join admission.external_execution e on e.action_execution_id=u.source_id
        where e.id=$1 and u.source_type='APPLICATION_ADAPTER_USAGE'
          and u.operation_id=$2 and u.tenant_id=e.tenant_id
          and u.component_binding_id=e.component_binding_id and u.component_release_id=e.component_release_id
          and u.component_projection_generation=e.component_projection_generation
          and u.dimensions->>'read_action_execution_id'=$3 and u.dimensions->>'read_role'='RECEIVER'
          and u.settlement_status='COMMITTED' and u.stored_at is not null")
        .bind(external).bind(operation).bind(read.to_string()).fetch_all(pool).await?;
    Ok(Some(events))
}

/// Reconcile metadata and the same original UsageEvents only. This function
/// never fetches source bytes, uploads a file, re-enqueues parsing or renews a
/// read token. Missing native receipts stay UNKNOWN after the existing expiry.
pub(super) async fn reconcile(state: &ServiceState, batch: i64) -> Result<(), Refusal> {
    let ids:Vec<Uuid>=sqlx::query_scalar("with selected as (
        select a.id from admission.action_execution a
        where a.parameters->>'componentActionKind'='SERVICE_READ' and a.gate_state='ALLOWED'
          and a.dispatch_state in ('DISPATCHED','UNKNOWN') and a.parameters ? 'readReceipts'
          and not exists(select 1 from audit.audit_event e where e.event_key=a.operation_id::text||':service_read:terminal')
        order by coalesce(a.reconcile_last_attempt_at,a.updated_at),a.id limit $1 for update of a skip locked)
        update admission.action_execution a set reconcile_last_attempt_at=now()
        from selected where selected.id=a.id returning a.id")
        .bind(batch).fetch_all(&state.pool).await?;
    for id in ids {
        let Some(ae) = crate::governance::load_execution(&state.pool, id).await? else {
            continue;
        };
        let p = ae.parameters.as_ref().ok_or_else(invalid)?;
        let mut expected = Vec::new();
        let mut complete = true;
        for role in ["SOURCE", "RECEIVER"] {
            if !p["readReceipts"][role].is_object() {
                complete = false;
                continue;
            }
            let source = if role == "SOURCE" {
                id
            } else {
                uuid(p, "receiverActionExecutionId")?
            };
            let meters: Vec<ApplicationMeter> =
                serde_json::from_value(p["readBilling"][role]["meters"].clone())
                    .map_err(|_| blocked())?;
            for meter in meters {
                expected.push(Uuid::new_v5(
                    &Uuid::NAMESPACE_URL,
                    format!(
                        "{}:APPLICATION_ADAPTER_USAGE:{}:{}",
                        ae.tenant_id, source, meter.key
                    )
                    .as_bytes(),
                ));
            }
        }
        if !crate::gateway_usage::settle_events(&state.pool, &expected, &state.openmeter)
            .await
            .map_err(|_| blocked())?
            || !complete
        {
            continue;
        }
        let mut tx = state.pool.begin().await?;
        let ae = crate::governance::lock_execution(&mut tx, id).await?;
        let committed:i64=sqlx::query_scalar("select count(*) from outbox.usage_event
            where id=any($1) and operation_id=$2 and tenant_id=$3 and settlement_status='COMMITTED' and stored_at is not null")
            .bind(&expected).bind(ae.operation_id).bind(ae.tenant_id).fetch_one(&mut *tx).await?;
        if committed != i64::try_from(expected.len()).map_err(|_| invalid())? {
            continue;
        }
        let def = frozen_definition(&mut tx, id).await?;
        let evidence = expected
            .iter()
            .map(|id| crate::audit::Evidence::new(contracts::EvidenceKind::UsageEventId, id))
            .collect();
        crate::governance::audit(
            &mut tx,
            &ae,
            &def,
            "service_read:terminal",
            "OUTCOME",
            "ALLOW",
            "COMPLETED",
            None,
            evidence,
        )
        .await?;
        sqlx::query("update admission.action_execution set dispatch_state='DISPATCHED',reason_code=null,updated_at=now() where id=$1")
            .bind(id).execute(&mut *tx).await?;
        tx.commit().await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires migrated isolated APPLICATION_EXECUTION_TEST_DATABASE_URL"]
    async fn read_receipt_sql_guards_use_exact_roles_and_native_evidence() {
        use sqlx::Connection;
        let mut conn = PgConnection::connect(
            &std::env::var("APPLICATION_EXECUTION_TEST_DATABASE_URL")
                .expect("isolated database URL"),
        )
        .await
        .unwrap();
        sqlx::raw_sql(r#"
CREATE TEMP TABLE read_receipt_fixture AS SELECT * FROM admission.action_execution WITH NO DATA;
CREATE TRIGGER receipt_test BEFORE UPDATE ON read_receipt_fixture FOR EACH ROW EXECUTE FUNCTION admission.guard_service_read_receipts();
INSERT INTO read_receipt_fixture(id,operation_id,parameters) VALUES(gen_random_uuid(),gen_random_uuid(),
  jsonb_build_object('componentActionKind','SERVICE_READ','idempotencyKey',gen_random_uuid(),
    'readReference',jsonb_build_object('nativeObjectRef','native-file','nativeRevision','exact-version'),
    'readToken',jsonb_build_object('iat',extract(epoch FROM now())::bigint-1,'exp',extract(epoch FROM now())::bigint+60),
    'readBilling',jsonb_build_object('SOURCE',jsonb_build_object('bindingId',gen_random_uuid(),'meters','[]'::jsonb),
      'RECEIVER',jsonb_build_object('bindingId',gen_random_uuid(),'meters','[]'::jsonb))));
UPDATE read_receipt_fixture SET parameters=parameters||jsonb_build_object('readReceipts',jsonb_build_object('SOURCE',
  jsonb_build_object('role','SOURCE','bindingId',parameters->'readBilling'->'SOURCE'->'bindingId',
    'operationId',operation_id,'idempotencyKey',parameters->'idempotencyKey','nativeObjectRef','native-file',
    'nativeRevision','exact-version','contentSha256',repeat('a',64),'contentBytes',7,'completedAt',now(),'measurements','[]'::jsonb)));
DO $$ BEGIN
 BEGIN
   UPDATE read_receipt_fixture SET parameters=jsonb_set(parameters,'{readReceipts,SOURCE,contentSha256}','null');
   RAISE EXCEPTION 'accepted mutated source receipt';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   UPDATE read_receipt_fixture SET parameters=jsonb_set(parameters,'{readReceipts,RECEIVER}',parameters->'readReceipts'->'SOURCE');
   RAISE EXCEPTION 'source impersonated receiver';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE read_receipt_fixture SET parameters=jsonb_set(parameters,'{readReceipts,RECEIVER}',
  (parameters->'readReceipts'->'SOURCE')||jsonb_build_object('role','RECEIVER',
    'bindingId',parameters->'readBilling'->'RECEIVER'->'bindingId','nativeObjectRef','native-import','nativeRevision','completed-version'));
CREATE TEMP TABLE read_usage_fixture AS SELECT * FROM outbox.usage_event WITH NO DATA;
CREATE TRIGGER usage_test BEFORE INSERT ON read_usage_fixture FOR EACH ROW EXECUTE FUNCTION projection.guard_application_usage();
DO $$ BEGIN
 BEGIN
   INSERT INTO read_usage_fixture(source_type) VALUES('APPLICATION_ADAPTER_USAGE');
   RAISE EXCEPTION 'accepted usage without native fact';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
CREATE TEMP TABLE read_binding_fixture AS SELECT * FROM catalog.application_binding WITH NO DATA;
CREATE TRIGGER drained_test BEFORE UPDATE ON read_binding_fixture FOR EACH ROW EXECUTE FUNCTION catalog.guard_application_usage_drained();
INSERT INTO read_binding_fixture(id,state) VALUES(gen_random_uuid(),'ACTIVE');
UPDATE read_binding_fixture SET state='DISABLED';
"#).execute(&mut conn).await.unwrap();
    }

    fn fixture() -> (Execution, Value, DateTime<Utc>) {
        let now = Utc::now();
        let operation = Uuid::new_v4();
        let source = Uuid::new_v4();
        let receiver = Uuid::new_v4();
        let key = Uuid::new_v4();
        let actor = Uuid::new_v4();
        let receipt = json!({"bindingId":source,"operationId":operation,"role":"SOURCE","idempotencyKey":key,
            "nativeObjectRef":"native-file","nativeRevision":"immutable-version","contentSha256":"a".repeat(64),
            "contentBytes":7,"completedAt":now.to_rfc3339(),"measurements":[{"meterKey":"native_count","quantity":1}]});
        let meters = json!([{"id":"native-meter","key":"native_count","event_type":"native.read","value_property":null}]);
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
            parameters: Some(json!({
                "componentActionKind":"SERVICE_READ","idempotencyKey":key,
                "readToken":{"iat":now.timestamp()-1,"exp":now.timestamp()+1},
                "readReference":{"nativeObjectRef":"native-file","nativeRevision":"immutable-version"},
                "readBilling":{"SOURCE":{"bindingId":source,"meters":meters},"RECEIVER":{"bindingId":receiver,"meters":meters}},
                "readReceipts":{"SOURCE":receipt}})),
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
        (ae, receipt, now)
    }

    #[test]
    fn source_receipt_cannot_change_batch_binding_revision_or_meter_obligation() {
        let (ae, receipt, now) = fixture();
        assert!(validate(&ae, &receipt, now).is_ok());
        for (field, value) in [
            ("role", json!("RECEIVER")),
            ("bindingId", json!(Uuid::new_v4())),
            ("operationId", json!(Uuid::new_v4())),
            ("idempotencyKey", json!(Uuid::new_v4())),
            ("nativeRevision", json!("other")),
            ("nativeObjectRef", json!("other")),
            ("contentSha256", json!("bad")),
            ("contentBytes", json!(-1)),
            ("measurements", json!([])),
            (
                "measurements",
                json!([{"meterKey":"native_count","quantity":0}]),
            ),
        ] {
            let mut changed = receipt.clone();
            changed[field] = value;
            assert!(validate(&ae, &changed, now).is_err(), "{field}");
        }
        let mut expired = ae;
        expired.parameters.as_mut().unwrap()["readToken"]["exp"] = json!(now.timestamp());
        assert!(validate(&expired, &receipt, now).is_err());
    }

    #[test]
    fn receiver_requires_same_source_bytes_but_its_own_identity_and_native_object() {
        let (mut ae, mut receipt, now) = fixture();
        receipt["role"] = json!("RECEIVER");
        receipt["bindingId"] =
            ae.parameters.as_ref().unwrap()["readBilling"]["RECEIVER"]["bindingId"].clone();
        receipt["nativeObjectRef"] = json!("imported-document");
        receipt["nativeRevision"] = json!("completed-native-revision");
        assert!(validate(&ae, &receipt, now).is_ok());
        for (field, value) in [
            ("contentSha256", json!("b".repeat(64))),
            ("contentBytes", json!(8)),
        ] {
            let mut changed = receipt.clone();
            changed[field] = value;
            assert!(validate(&ae, &changed, now).is_err());
        }
        ae.parameters.as_mut().unwrap()["readReceipts"] = json!({});
        assert!(validate(&ae, &receipt, now).is_err());
    }
}
