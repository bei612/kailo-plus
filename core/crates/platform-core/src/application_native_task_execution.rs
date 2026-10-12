//! Fresh execution of an already dispatched native task, not HUMAN writer
//! admission and not a second dispatch. Native storage owns step claims/ACKs.
use super::*;
use crate::service_api::ServiceState;
use axum::{
    extract::State,
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Duration, Utc};

pub(crate) async fn duration(
    conn: &mut sqlx::PgConnection,
    ae: &Execution,
) -> Result<Option<i64>, Refusal> {
    if !is_human(ae) || native_execution::is_native_writer(ae) {
        return Ok(None);
    }
    let declaration: Option<Value> = sqlx::query_scalar(
        "select d.implementation_declaration from admission.action_execution a
         join catalog.action_definition d on d.id=a.action_definition_id
           and d.action_key=a.action_key and d.version=a.action_version
           and d.component_release_id=a.component_release_id
         where a.id=$1 and a.tenant_id=$2 and a.operation_id=$3
           and a.parent_action_execution_id is null and a.component_binding_kind='APPLICATION'",
    )
    .bind(ae.id)
    .bind(ae.tenant_id)
    .bind(ae.operation_id)
    .fetch_optional(conn)
    .await?;
    let Some(declaration) = declaration else {
        return Err(denied());
    };
    let Some(seconds) = declaration.get("nativeTaskExecutionTimeoutSeconds") else {
        return Ok(None);
    };
    if declaration["executionMode"] != "TEMPORAL"
        || declaration["workflowType"] != "ComponentTaskWorkflow"
    {
        return Err(denied());
    }
    seconds
        .as_i64()
        .filter(|v| *v > 0)
        .map(Some)
        .ok_or_else(denied)
}

// The original DISPATCH audit and EE are committed together before execute.
// No AE parameter/hash is rewritten, and fresh calls never reset the clock.
pub(crate) async fn deadline(
    conn: &mut sqlx::PgConnection,
    ae: &Execution,
    external: Uuid,
) -> Result<Option<DateTime<Utc>>, Refusal> {
    let Some(seconds) = duration(conn, ae).await? else {
        return Ok(None);
    };
    let dispatched: Option<DateTime<Utc>> = sqlx::query_scalar(
        "select event.occurred_at from admission.external_execution e
         join admission.action_execution a on a.id=e.action_execution_id
           and a.tenant_id=e.tenant_id and a.operation_id=e.operation_id
           and a.component_binding_id=e.component_binding_id and a.component_release_id=e.component_release_id
           and a.component_projection_generation=e.component_projection_generation
           and a.workspace_id is not distinct from e.workspace_id
         join audit.audit_event event on event.event_key=a.operation_id::text||':component_action:dispatch'
           and event.tenant_id=a.tenant_id and event.operation_id=a.operation_id
           and event.workspace_id is not distinct from a.workspace_id
           and event.initiator_principal_id=a.initiator_principal_id and event.actor_principal_id=a.actor_principal_id
           and event.action_key=a.action_key and event.action_version=a.action_version
           and event.target_id=a.target_id and event.target_type=(select d.target_type from catalog.action_definition d where d.id=a.action_definition_id)
           and event.parameter_hash=a.parameter_hash
           and event.correlation_id=a.correlation_id and event.event_type='DISPATCH'
           and event.decision='ALLOW' and event.result_code='DISPATCH_RESULT_UNKNOWN'
         where e.id=$1 and a.id=$2 and a.tenant_id=$3 and a.operation_id=$4
           and a.parent_action_execution_id is null and a.gate_state='ALLOWED' and a.dispatch_state='DISPATCHED'
           and e.protocol_operation='execute' and e.platform_status in ('UNKNOWN','RUNNING')
           and e.terminal_at is null and jsonb_typeof(e.usage_projection->'meters')='array'")
        .bind(external).bind(ae.id).bind(ae.tenant_id).bind(ae.operation_id)
        .fetch_optional(conn).await?;
    let expiry = dispatched
        .ok_or_else(denied)?
        .checked_add_signed(Duration::try_seconds(seconds).ok_or_else(denied)?)
        .filter(|value| *value > Utc::now())
        .ok_or_else(denied)?;
    // JWT seconds and the persisted native deadline use the same lower bound.
    Ok(Some(
        DateTime::from_timestamp(expiry.timestamp(), 0).ok_or_else(denied)?,
    ))
}

pub(crate) fn timestamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub(crate) async fn authorize(
    state: &ServiceState,
    ae: &Execution,
    external: Uuid,
    binding: Uuid,
) -> Result<(Uuid, String, String, DateTime<Utc>), Refusal> {
    let expiry = deadline(&mut *state.pool.acquire().await?, ae, external)
        .await?
        .ok_or_else(denied)?;
    let (key, audience, revision, _) =
        native_execution::authorize_retained(state, ae, external, binding, expiry.timestamp())
            .await?;
    Ok((key, audience, revision, expiry))
}

async fn authenticate(
    state: &ServiceState,
    headers: &HeaderMap,
    ae: &Execution,
    binding: Uuid,
) -> Result<(), Refusal> {
    let client: Option<String> = sqlx::query_scalar(
        "select b.normalized_config->>'client_id' from admission.action_execution a
         join catalog.application_binding b on b.id=a.component_binding_id and b.tenant_id=a.tenant_id
           and b.state='ACTIVE'
         join identity.service_principal s on s.principal_id=b.service_principal_id
           and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
         join identity.principal p on p.id=s.principal_id and p.tenant_id=b.tenant_id
           and p.kind='SERVICE' and p.status='ACTIVE'
         where a.id=$1 and b.id=$2 and a.tenant_id=$3 and a.component_binding_kind='APPLICATION'")
        .bind(ae.id).bind(binding).bind(ae.tenant_id).fetch_optional(&state.pool).await?;
    let client = client.filter(|v| !v.is_empty()).ok_or_else(denied)?;
    let count: i64 = sqlx::query_scalar("select count(*) from catalog.application_binding where normalized_config->>'client_id'=$1 and state<>'DISABLED'")
        .bind(&client).fetch_one(&state.pool).await?;
    let mut values = headers.get_all(axum::http::header::AUTHORIZATION).iter();
    let bearer = values
        .next()
        .and_then(|v| v.to_str().ok())
        .ok_or_else(denied)?;
    if count != 1 || values.next().is_some() {
        return Err(denied());
    }
    state
        .auth
        .verify_binding_client(Some(bearer), &client)
        .await
        .map_err(|error| match error {
            crate::service_auth::ServiceAuthError::KeysUnavailable => unavailable(),
            _ => denied(),
        })
}

async fn retained_reference(
    state: &ServiceState,
    ae: &Execution,
    binding: Uuid,
    reference: &Value,
) -> Result<(Uuid, Uuid, bool), Refusal> {
    let external = id(&reference["externalExecutionId"])?;
    let key = id(&reference["idempotencyKey"])?;
    let kind = reference["nativeType"]
        .as_str()
        .filter(|v| !v.is_empty())
        .ok_or_else(denied)?;
    let native = reference["nativeId"]
        .as_str()
        .filter(|v| !v.is_empty() && v.trim() == *v)
        .ok_or_else(denied)?;
    let retained: Option<Option<String>> = sqlx::query_scalar(
        "select native_id from admission.external_execution
         where id=$1 and action_execution_id=$2 and component_binding_id=$3 and tenant_id=$4
           and operation_id=$5 and idempotency_key=$6 and native_type=$7
           and protocol_operation='execute' and platform_status in ('RUNNING','UNKNOWN') and terminal_at is null")
        .bind(external).bind(ae.id).bind(binding).bind(ae.tenant_id).bind(ae.operation_id)
        .bind(key).bind(kind).fetch_optional(&state.pool).await?;
    match retained {
        Some(Some(value)) if value == native => Ok((external, key, true)),
        Some(None) => Ok((external, key, false)),
        _ => Err(denied()),
    }
}

pub(crate) async fn handle(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let result = async {
        let Json(raw) = body.map_err(|_| invalid())?;
        let typed: contracts::NativeTaskExecutionAdmissionRequest = serde_json::from_value(raw.clone()).map_err(|_| invalid())?;
        if serde_json::to_value(typed).map_err(|_| invalid())? != raw { return Err(invalid()); }
        let binding = id(&raw["bindingId"])?;
        let ae = crate::governance::load_execution(&state.pool, id(&raw["actionExecutionId"])?).await?.ok_or_else(denied)?;
        authenticate(&state, &headers, &ae, binding).await?;
        let (external, key, ready) = retained_reference(&state, &ae, binding, &raw["execution"]).await?;
        let (confirmed, audience, revision, expiry) = authorize(&state, &ae, external, binding).await?;
        if key != confirmed || raw["nativeTaskDeadline"] != timestamp(expiry) { return Err(denied()); }
        if !ready {
            return Ok(json!({"state":"PENDING_REFERENCE","nativeTaskDeadline":timestamp(expiry)}));
        }
        let token = crate::action_token::issue_native_task(&state, &ae, external, key, &audience, revision, expiry.timestamp()).await?;
        authenticate(&state, &headers, &ae, binding).await?;
        if retained_reference(&state, &ae, binding, &raw["execution"]).await? != (external,key,true) {
            return Err(denied());
        }
        authorize(&state, &ae, external, binding).await?;
        let claims = crate::action_token::verify(&token, &audience)?;
        let expires = native_execution::admission_expiry(&claims, Utc::now().timestamp())?;
        Ok::<_, Refusal>(json!({"state":"ADMITTED","actionToken":token,"argumentsJson":collab_bridge::limits::canonical_json(
            &ae.parameters.as_ref().ok_or_else(denied)?["inputArguments"]),
            "expiresAt":expires,"nativeTaskDeadline":timestamp(expiry)}))
    }.await;
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => error.respond(None),
    }
}
