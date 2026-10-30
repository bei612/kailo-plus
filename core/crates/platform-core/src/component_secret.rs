//! DD-169(5), `.design/07` §4.8.11: component secret custody. A component's own
//! business configuration (first: the data query component's data source
//! connections) keeps its sensitive values in the Tenant's OpenBao; the component
//! stores only the `secretId` Core returns. Core neither interprets nor copies the
//! configuration itself (DD-87, DD-138(6)).
//!
//! Caller: the binding's own directory client, the same service identity and
//! preconditions as the member directory and component notifications (07 §4.7.4,
//! §4.8.3). Writes and retirements additionally name the initiating administrator
//! (`issuer`+`subject`), who must be an ACTIVE HUMAN in the directory scope and hold
//! a fully consistent fresh `manage` on the binding scope (Workspace for a Workspace
//! binding, otherwise the Tenant).
//!
//! Not an Action: like the other component service writes (notifications, usage
//! reports) it creates no ActionExecution, Resource or SpiceDB relationship and
//! grants nothing. Each write and retirement appends an `OUTCOME` AuditEvent keyed by
//! the secret id (the gateway probe precedent: a non-catalog action key and the
//! subject's own id as operation); the value, locator and key names never enter
//! audit, logs, errors or responses. Each read is recorded by the OpenBao audit
//! device and verified like connector credential reads (DD-70).

use std::collections::BTreeMap;

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{header::CACHE_CONTROL, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::ReasonCode;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgConnection;
use uuid::Uuid;

use crate::{governance::Refusal, service_api::ServiceState};

/// The one purpose of the first stage (DD-169(5)).
const PURPOSE_DATA_SOURCE_CONNECTION: &str = "DATA_SOURCE_CONNECTION";
/// Upper bound of the canonical JSON of one secret value object.
pub(crate) const MAX_VALUE_BYTES: usize = 64 * 1024;
pub(crate) const MAX_KEYS: usize = 64;
const MAX_KEY_LEN: usize = 64;
/// ACTIVE secrets per binding.
pub(crate) const MAX_ACTIVE_PER_BINDING: i64 = 200;
/// Request bodies larger than this are refused before parsing.
const MAX_BODY_BYTES: usize = MAX_VALUE_BYTES + 8 * 1024;
const WRITE_ACTION: &str = "component_secret.write";
const RETIRE_ACTION: &str = "component_secret.retire";

/// Closed answers of the three endpoints.
#[derive(Debug)]
pub(crate) enum Failure {
    /// 400: malformed body.
    Invalid,
    /// 403: token, preconditions, actor or permission; never distinguished.
    Denied,
    /// 404: unknown, retired or another binding's secret.
    NotFound,
    /// 409: too many ACTIVE secrets for the binding.
    Limit,
    /// 503: OpenBao, SpiceDB, database or identity keys unavailable.
    Unavailable(String),
}

impl From<Refusal> for Failure {
    fn from(error: Refusal) -> Self {
        match error {
            Refusal::Precondition(ReasonCode::InvalidParameters) => Failure::Invalid,
            Refusal::Unavailable(what) => Failure::Unavailable(what),
            _ => Failure::Denied,
        }
    }
}

impl From<sqlx::Error> for Failure {
    fn from(error: sqlx::Error) -> Self {
        Failure::Unavailable(format!("component secret database: {error}"))
    }
}

impl Failure {
    fn status(&self) -> (StatusCode, &'static str) {
        match self {
            Failure::Invalid => (StatusCode::BAD_REQUEST, "INVALID_PARAMETERS"),
            Failure::Denied => (StatusCode::FORBIDDEN, "PERMISSION_DENIED"),
            Failure::NotFound => (StatusCode::NOT_FOUND, "TARGET_NOT_FOUND"),
            Failure::Limit => (StatusCode::CONFLICT, "TARGET_STATE_CONFLICT"),
            Failure::Unavailable(_) => (StatusCode::SERVICE_UNAVAILABLE, "DEPENDENCY_UNAVAILABLE"),
        }
    }

    fn reason(&self) -> &'static str {
        self.status().1
    }
}

fn no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn respond(error: &Failure) -> Response {
    if let Failure::Unavailable(what) = error {
        tracing::warn!(error = %what, "组件凭据托管依赖不可用");
    }
    let (status, reason) = error.status();
    no_store((status, Json(json!({ "reason": reason }))).into_response())
}

fn ok(status: StatusCode, body: Value) -> Response {
    no_store((status, Json(body)).into_response())
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Actor {
    pub issuer: String,
    pub subject: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WriteBody {
    purpose: String,
    actor: Actor,
    value: Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RetireBody {
    actor: Actor,
}

/// A parsed write. `value` is the canonical JSON (keys sorted); it is only ever
/// handed to OpenBao. No `Debug`: nothing should be able to print it.
pub(crate) struct Write {
    pub purpose: &'static str,
    pub actor: Actor,
    pub value: String,
    /// SHA-256 over purpose and sorted key names (never values), for audit.
    pub parameter_hash: String,
}

fn actor_ok(actor: &Actor) -> bool {
    let fine = |value: &str, max: usize| {
        !value.is_empty() && value.len() <= max && !value.chars().any(char::is_control)
    };
    fine(&actor.issuer, 2048) && fine(&actor.subject, 255)
}

fn key_ok(key: &str) -> bool {
    (1..=MAX_KEY_LEN).contains(&key.len())
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn parameter_hash(purpose: &str, keys: &[&str]) -> String {
    let mut hash = Sha256::new();
    hash.update(purpose.as_bytes());
    for key in keys {
        hash.update([0u8]);
        hash.update(key.as_bytes());
    }
    hex::encode(hash.finalize())
}

pub(crate) fn parse_write(body: &[u8]) -> Result<Write, Failure> {
    if body.len() > MAX_BODY_BYTES {
        return Err(Failure::Invalid);
    }
    let parsed: WriteBody = serde_json::from_slice(body).map_err(|_| Failure::Invalid)?;
    if parsed.purpose != PURPOSE_DATA_SOURCE_CONNECTION || !actor_ok(&parsed.actor) {
        return Err(Failure::Invalid);
    }
    let Value::Object(object) = parsed.value else {
        return Err(Failure::Invalid);
    };
    if object.is_empty() || object.len() > MAX_KEYS {
        return Err(Failure::Invalid);
    }
    let mut canonical = BTreeMap::new();
    for (key, value) in object {
        let Value::String(text) = value else {
            return Err(Failure::Invalid);
        };
        if !key_ok(&key) {
            return Err(Failure::Invalid);
        }
        canonical.insert(key, text);
    }
    let value = serde_json::to_string(&canonical).map_err(|_| Failure::Invalid)?;
    if value.len() > MAX_VALUE_BYTES {
        return Err(Failure::Invalid);
    }
    let keys: Vec<&str> = canonical.keys().map(String::as_str).collect();
    Ok(Write {
        purpose: PURPOSE_DATA_SOURCE_CONNECTION,
        parameter_hash: parameter_hash(PURPOSE_DATA_SOURCE_CONNECTION, &keys),
        actor: parsed.actor,
        value,
    })
}

pub(crate) fn parse_retire(body: &[u8]) -> Result<Actor, Failure> {
    if body.len() > 16 * 1024 {
        return Err(Failure::Invalid);
    }
    let parsed: RetireBody = serde_json::from_slice(body).map_err(|_| Failure::Invalid)?;
    if !actor_ok(&parsed.actor) {
        return Err(Failure::Invalid);
    }
    Ok(parsed.actor)
}

/// The value object a read returns, from the stored canonical JSON. A stored value
/// that is not such an object is a broken record, not a user error.
pub(crate) fn value_object(stored: &str) -> Result<Value, Failure> {
    match serde_json::from_str::<Value>(stored) {
        Ok(Value::Object(object))
            if !object.is_empty() && object.values().all(Value::is_string) =>
        {
            Ok(Value::Object(object))
        }
        _ => Err(Failure::Unavailable("component secret value shape".into())),
    }
}

/// `component-secret/<binding>/<secret>` under the Tenant namespace.
pub(crate) fn locator_path(binding: Uuid, secret: Uuid) -> String {
    format!("component-secret/{binding}/{secret}")
}

fn audience() -> Result<String, Failure> {
    let reader = std::env::var("OPENBAO_SERVICE_IDENTITY")
        .map_err(|_| Failure::Unavailable("component secret audience".into()))?;
    if reader.trim().is_empty() {
        return Err(Failure::Unavailable("component secret audience".into()));
    }
    Ok(reader)
}

// ---------------------------------------------------------------------------
// Caller, actor and permission
// ---------------------------------------------------------------------------

struct Caller {
    tenant_id: Uuid,
    workspace_id: Option<Uuid>,
}

/// The binding's directory client with the 07 §4.8.3 preconditions.
async fn caller(
    state: &ServiceState,
    headers: &HeaderMap,
    binding: Uuid,
) -> Result<Caller, Failure> {
    let header = crate::component_directory::bearer(headers)?;
    let core_client = std::env::var("OIDC_SERVICE_CLIENT_ID").ok();
    let mut tx = state.pool.begin().await?;
    sqlx::query("set transaction isolation level repeatable read, read only")
        .execute(&mut *tx)
        .await?;
    let entry = crate::component_directory::authorize(
        state,
        &mut tx,
        header,
        binding,
        core_client.as_deref(),
    )
    .await?;
    tx.commit().await?;
    if entry.manifest["frontendPresentationContract"]["integrationMode"] != "KAILO_EMBED" {
        return Err(Failure::Denied);
    }
    Ok(Caller {
        tenant_id: entry.tenant_id,
        workspace_id: entry.workspace_id,
    })
}

/// `issuer`+`subject` → the ACTIVE HUMAN Principal and HumanIdentity of this Tenant
/// (the 07 §4.8.3 recipient rule before the Workspace check).
async fn member(
    conn: &mut PgConnection,
    tenant: Uuid,
    actor: &Actor,
) -> Result<Option<(Uuid, Uuid)>, sqlx::Error> {
    sqlx::query_as(
        "select p.id,hi.id from identity.external_identity ei
         join identity.human_identity hi on hi.id=ei.human_identity_id and hi.status='ACTIVE'
         join identity.tenant_membership tm on tm.human_identity_id=hi.id
           and tm.tenant_id=$1 and tm.state='ACTIVE'
         join identity.principal p on p.id=tm.tenant_principal_id
           and p.tenant_id=$1 and p.kind='HUMAN' and p.status='ACTIVE'
         where ei.issuer=$2 and ei.subject=$3 and ei.status='ACTIVE'",
    )
    .bind(tenant)
    .bind(&actor.issuer)
    .bind(&actor.subject)
    .fetch_optional(&mut *conn)
    .await
}

/// The SpiceDB checks a write or retirement needs, fully consistent: Workspace
/// `discover` (directory scope) and `manage` on the binding scope.
pub(crate) fn permission_checks(
    tenant: Uuid,
    workspace: Option<Uuid>,
) -> Vec<(&'static str, String, &'static str)> {
    match workspace {
        Some(workspace) => vec![
            ("workspace", workspace.to_string(), "discover"),
            ("workspace", workspace.to_string(), "manage"),
        ],
        None => vec![("tenant", tenant.to_string(), "manage")],
    }
}

struct Initiator {
    principal: Uuid,
    human: Uuid,
}

async fn administrator(
    state: &ServiceState,
    caller: &Caller,
    actor: &Actor,
) -> Result<Initiator, Failure> {
    let mut conn = state.pool.acquire().await?;
    let (principal, human) = member(&mut conn, caller.tenant_id, actor)
        .await?
        .ok_or(Failure::Denied)?;
    drop(conn);
    let checks = permission_checks(caller.tenant_id, caller.workspace_id);
    let principal_text = principal.to_string();
    let items: Vec<crate::spicedb::BulkCheck<'_>> = checks
        .iter()
        .map(
            |(object_type, object_id, permission)| crate::spicedb::BulkCheck {
                object_type,
                object_id,
                permission,
                principal: &principal_text,
            },
        )
        .collect();
    let allowed = state
        .governance
        .spicedb
        .check_bulk_principals(&items)
        .await
        .map_err(|_| Failure::Unavailable("component secret authorization".into()))?;
    if allowed.len() != items.len() || allowed.iter().any(|ok| !ok) {
        return Err(Failure::Denied);
    }
    Ok(Initiator { principal, human })
}

/// Per-binding serialisation of the ACTIVE limit.
fn binding_lock(binding: Uuid) -> i64 {
    let bytes = binding.as_bytes();
    // Distinct from the notification lock on the same binding.
    i64::from_be_bytes([
        bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    ])
}

struct AuditFact<'a> {
    secret: Uuid,
    action: &'a str,
    parameter_hash: &'a str,
    result: &'a str,
}

async fn audit(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    caller: &Caller,
    binding: Uuid,
    initiator: &Initiator,
    fact: AuditFact<'_>,
) -> Result<(), sqlx::Error> {
    crate::audit::append(
        tx,
        crate::audit::AuditEntry {
            event_key: format!("component-secret:{}:{}", fact.secret, fact.action),
            tenant_id: Some(caller.tenant_id),
            workspace_id: caller.workspace_id,
            operation_id: fact.secret,
            event_type: "OUTCOME",
            human_identity_id: Some(initiator.human),
            initiator_principal_id: Some(initiator.principal),
            actor_principal_id: Some(initiator.principal),
            action_key: fact.action,
            action_version: 1,
            component_type_key: "core",
            target_type: Some("COMPONENT_SECRET"),
            target_id: Some(fact.secret),
            parameter_hash: fact.parameter_hash,
            decision: "ALLOW",
            result_code: fact.result,
            result_exposure: "NONE",
            evidence_refs: vec![crate::audit::Evidence::new(
                contracts::EvidenceKind::ApplicationBindingId,
                binding,
            )],
            correlation_id: fact.secret,
        },
    )
    .await
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// `POST /service/v1/component-secrets/bindings/{binding}/secrets`.
pub(crate) async fn write(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    Path(binding): Path<Uuid>,
    body: Bytes,
) -> Response {
    match store(&state, &headers, binding, &body).await {
        Ok(receipt) => {
            tracing::info!(%binding, secret = %receipt["secretId"], "组件凭据已托管");
            ok(StatusCode::CREATED, receipt)
        }
        Err(error) => {
            tracing::info!(%binding, reason = error.reason(), "组件凭据写入被拒绝或不可用");
            respond(&error)
        }
    }
}

async fn store(
    state: &ServiceState,
    headers: &HeaderMap,
    binding: Uuid,
    body: &[u8],
) -> Result<Value, Failure> {
    // Who is calling comes first: an unauthenticated caller learns nothing about
    // the validation rules.
    let caller = caller(state, headers, binding).await?;
    let write = parse_write(body)?;
    let initiator = administrator(state, &caller, &write.actor).await?;
    let audience = audience()?;

    let active: i64 = sqlx::query_scalar(
        "select count(*) from catalog.component_secret
         where application_binding_id=$1 and state='ACTIVE'",
    )
    .bind(binding)
    .fetch_one(&state.pool)
    .await?;
    if active >= MAX_ACTIVE_PER_BINDING {
        return Err(Failure::Limit);
    }

    let secret = Uuid::new_v4();
    let reference = secret_store::SecretRef {
        locator: state
            .secrets
            .tenant_locator(caller.tenant_id, &locator_path(binding, secret)),
        version: 1,
        audience,
    };
    let version = state
        .secrets
        .write_once(&reference.locator, "value", &write.value)
        .await
        .map_err(|_| Failure::Unavailable("component secret write".into()))?;
    if version != 1 {
        return Err(Failure::Unavailable("component secret version".into()));
    }

    let registered = register(
        state, &caller, binding, &initiator, &write, secret, &reference,
    )
    .await;
    match registered {
        Ok(created_at) => Ok(json!({
            "secretId": secret,
            "version": 1,
            "createdAt": created_at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        })),
        Err(error) => {
            // Nothing references the written version: destroy it so no value stays
            // in OpenBao without a ComponentSecret. A failed destroy leaves an
            // unreferenced version in the Tenant namespace (destroyed with it).
            if let Err(destroy) = state
                .secrets
                .retire_component_secret(caller.tenant_id, &reference, true)
                .await
            {
                tracing::warn!(%binding, %secret, error = %destroy, "未登记的组件凭据版本销毁失败");
            }
            Err(error)
        }
    }
}

async fn register(
    state: &ServiceState,
    caller: &Caller,
    binding: Uuid,
    initiator: &Initiator,
    write: &Write,
    secret: Uuid,
    reference: &secret_store::SecretRef,
) -> Result<chrono::DateTime<chrono::Utc>, Failure> {
    let mut tx = state.pool.begin().await?;
    sqlx::query("select pg_advisory_xact_lock($1)")
        .bind(binding_lock(binding))
        .execute(&mut *tx)
        .await?;
    // The binding may have been disabled meanwhile: re-read it under the lock.
    let active_binding: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.application_binding where id=$1 and state='ACTIVE')",
    )
    .bind(binding)
    .fetch_one(&mut *tx)
    .await?;
    if !active_binding {
        return Err(Failure::Denied);
    }
    let active: i64 = sqlx::query_scalar(
        "select count(*) from catalog.component_secret
         where application_binding_id=$1 and state='ACTIVE'",
    )
    .bind(binding)
    .fetch_one(&mut *tx)
    .await?;
    if active >= MAX_ACTIVE_PER_BINDING {
        return Err(Failure::Limit);
    }
    let created_at: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
        "insert into catalog.component_secret
           (id,tenant_id,application_binding_id,purpose,secret_locator,secret_version,
            secret_audience,state,created_by_principal_id)
         values($1,$2,$3,$4,$5,$6,$7,'ACTIVE',$8)
         returning created_at",
    )
    .bind(secret)
    .bind(caller.tenant_id)
    .bind(binding)
    .bind(write.purpose)
    .bind(&reference.locator)
    .bind(reference.version as i32)
    .bind(&reference.audience)
    .bind(initiator.principal)
    .fetch_one(&mut *tx)
    .await?;
    audit(
        &mut tx,
        caller,
        binding,
        initiator,
        AuditFact {
            secret,
            action: WRITE_ACTION,
            parameter_hash: &write.parameter_hash,
            result: "SECRET_WRITTEN",
        },
    )
    .await?;
    tx.commit().await?;
    Ok(created_at)
}

#[derive(sqlx::FromRow)]
struct Stored {
    tenant_id: Uuid,
    secret_locator: String,
    secret_version: i32,
    secret_audience: String,
    state: String,
}

async fn stored(
    state: &ServiceState,
    binding: Uuid,
    secret: Uuid,
) -> Result<Option<Stored>, Failure> {
    Ok(sqlx::query_as(
        "select tenant_id,secret_locator,secret_version,secret_audience,state
         from catalog.component_secret where id=$1 and application_binding_id=$2",
    )
    .bind(secret)
    .bind(binding)
    .fetch_optional(&state.pool)
    .await?)
}

fn reference_of(row: &Stored) -> Result<secret_store::SecretRef, Failure> {
    Ok(secret_store::SecretRef {
        locator: row.secret_locator.clone(),
        version: u32::try_from(row.secret_version)
            .map_err(|_| Failure::Unavailable("component secret version".into()))?,
        audience: row.secret_audience.clone(),
    })
}

/// `POST /service/v1/component-secrets/bindings/{binding}/secrets/{secret}/read`.
pub(crate) async fn read(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    Path((binding, secret)): Path<(Uuid, Uuid)>,
) -> Response {
    match fetch(&state, &headers, binding, secret).await {
        Ok(body) => {
            tracing::info!(%binding, %secret, "组件凭据已读取");
            ok(StatusCode::OK, body)
        }
        Err(error) => {
            tracing::info!(%binding, %secret, reason = error.reason(), "组件凭据读取被拒绝或不可用");
            respond(&error)
        }
    }
}

async fn fetch(
    state: &ServiceState,
    headers: &HeaderMap,
    binding: Uuid,
    secret: Uuid,
) -> Result<Value, Failure> {
    let caller = caller(state, headers, binding).await?;
    let row = stored(state, binding, secret)
        .await?
        .filter(|row| row.state == "ACTIVE" && row.tenant_id == caller.tenant_id)
        .ok_or(Failure::NotFound)?;
    let reference = reference_of(&row)?;
    let not_before = chrono::Utc::now();
    let read = state
        .secrets
        .read_audited(&reference, "value")
        .await
        .map_err(|_| Failure::Unavailable("component secret read".into()))?;
    state
        .audit
        .verify_secret_reads(&[secret_store::AuditedSecretRead {
            reference: &reference,
            request_id: &read.request_id,
            role_name: &read.role_name,
            not_before,
        }])
        .await
        .map_err(|_| Failure::Unavailable("component secret read audit".into()))?;
    let value = value_object(read.value.expose())?;
    // Retired while the read was in flight: the value is no longer handed out.
    let still: Option<String> = sqlx::query_scalar(
        "select state from catalog.component_secret where id=$1 and application_binding_id=$2",
    )
    .bind(secret)
    .bind(binding)
    .fetch_optional(&state.pool)
    .await?;
    if still.as_deref() != Some("ACTIVE") {
        return Err(Failure::NotFound);
    }
    Ok(json!({ "secretId": secret, "version": reference.version, "value": value }))
}

/// `POST /service/v1/component-secrets/bindings/{binding}/secrets/{secret}/retire`.
pub(crate) async fn retire(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    Path((binding, secret)): Path<(Uuid, Uuid)>,
    body: Bytes,
) -> Response {
    match withdraw(&state, &headers, binding, secret, &body).await {
        Ok(body) => {
            tracing::info!(%binding, %secret, "组件凭据已撤销");
            ok(StatusCode::OK, body)
        }
        Err(error) => {
            tracing::info!(%binding, %secret, reason = error.reason(), "组件凭据撤销被拒绝或不可用");
            respond(&error)
        }
    }
}

async fn withdraw(
    state: &ServiceState,
    headers: &HeaderMap,
    binding: Uuid,
    secret: Uuid,
    body: &[u8],
) -> Result<Value, Failure> {
    let caller = caller(state, headers, binding).await?;
    let actor = parse_retire(body)?;
    let initiator = administrator(state, &caller, &actor).await?;
    let row = stored(state, binding, secret)
        .await?
        .filter(|row| row.tenant_id == caller.tenant_id)
        .ok_or(Failure::NotFound)?;
    let reference = reference_of(&row)?;
    // Destroy first: a RETIRED record must never point at a readable value. A
    // repeated retirement re-runs the destroy, which is idempotent for version 1.
    state
        .secrets
        .retire_component_secret(caller.tenant_id, &reference, true)
        .await
        .map_err(|_| Failure::Unavailable("component secret destroy".into()))?;
    if row.state == "ACTIVE" {
        let mut tx = state.pool.begin().await?;
        let updated = sqlx::query(
            "update catalog.component_secret
             set state='RETIRED',retired_at=now(),retired_by_principal_id=$3
             where id=$1 and application_binding_id=$2 and state='ACTIVE'",
        )
        .bind(secret)
        .bind(binding)
        .bind(initiator.principal)
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() == 1 {
            audit(
                &mut tx,
                &caller,
                binding,
                &initiator,
                AuditFact {
                    secret,
                    action: RETIRE_ACTION,
                    parameter_hash: &parameter_hash(RETIRE_ACTION, &[]),
                    result: "SECRET_RETIRED",
                },
            )
            .await?;
        }
        tx.commit().await?;
    }
    Ok(json!({ "secretId": secret, "state": "RETIRED" }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(value: Value) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "purpose": "DATA_SOURCE_CONNECTION",
            "actor": {"issuer": "https://idp.example", "subject": "u-1"},
            "value": value,
        }))
        .unwrap()
    }

    #[test]
    fn write_body_is_canonical_and_hash_has_no_values() {
        let write = parse_write(&body(json!({"password": "p1", "accessToken": "t"}))).unwrap();
        assert_eq!(write.value, r#"{"accessToken":"t","password":"p1"}"#);
        assert_eq!(write.purpose, "DATA_SOURCE_CONNECTION");
        let other = parse_write(&body(json!({"password": "other", "accessToken": "x"}))).unwrap();
        // Same key names, different values: the audit hash must not reveal values.
        assert_eq!(write.parameter_hash, other.parameter_hash);
        assert_eq!(write.parameter_hash.len(), 64);
    }

    #[test]
    fn write_body_rejects_bad_shapes() {
        let invalid = |raw: Vec<u8>| matches!(parse_write(&raw), Err(Failure::Invalid));
        assert!(invalid(body(json!({}))));
        assert!(invalid(body(json!("text"))));
        assert!(invalid(body(json!({"password": 1}))));
        assert!(invalid(body(json!({"pass-word": "x"}))));
        assert!(invalid(body(json!({"": "x"}))));
        assert!(invalid(body(json!({"a".repeat(65): "x"}))));
        let many: serde_json::Map<String, Value> =
            (0..65).map(|i| (format!("k{i}"), json!("v"))).collect();
        assert!(invalid(body(Value::Object(many))));
        assert!(invalid(body(
            json!({"credentials": "x".repeat(MAX_VALUE_BYTES)})
        )));
        // Unknown fields and other purposes are refused.
        assert!(invalid(
            serde_json::to_vec(&json!({
                "purpose": "DATA_SOURCE_CONNECTION",
                "actor": {"issuer": "i", "subject": "s"},
                "value": {"password": "x"},
                "extra": true,
            }))
            .unwrap()
        ));
        assert!(invalid(
            serde_json::to_vec(&json!({
                "purpose": "OTHER",
                "actor": {"issuer": "i", "subject": "s"},
                "value": {"password": "x"},
            }))
            .unwrap()
        ));
        assert!(invalid(
            serde_json::to_vec(&json!({
                "purpose": "DATA_SOURCE_CONNECTION",
                "actor": {"issuer": "", "subject": "s"},
                "value": {"password": "x"},
            }))
            .unwrap()
        ));
        assert!(invalid(b"not json".to_vec()));
    }

    #[test]
    fn write_body_accepts_limits() {
        let many: serde_json::Map<String, Value> =
            (0..64).map(|i| (format!("k_{i}"), json!("v"))).collect();
        assert!(parse_write(&body(Value::Object(many))).is_ok());
        assert!(parse_write(&body(json!({"a".repeat(64): "x"}))).is_ok());
    }

    #[test]
    fn retire_body_is_strict() {
        let actor = parse_retire(br#"{"actor":{"issuer":"i","subject":"s"}}"#).unwrap();
        assert_eq!(actor.subject, "s");
        assert!(parse_retire(br#"{"actor":{"issuer":"i","subject":"s"},"x":1}"#).is_err());
        assert!(parse_retire(br#"{"actor":{"issuer":"i"}}"#).is_err());
        assert!(parse_retire(br#"{"actor":{"issuer":"i","subject":"a\u0000"}}"#).is_err());
    }

    #[test]
    fn stored_value_must_be_a_string_object() {
        assert!(value_object(r#"{"password":"x"}"#).is_ok());
        assert!(matches!(value_object("{}"), Err(Failure::Unavailable(_))));
        assert!(matches!(
            value_object(r#"{"a":1}"#),
            Err(Failure::Unavailable(_))
        ));
        assert!(matches!(value_object("x"), Err(Failure::Unavailable(_))));
    }

    #[test]
    fn manage_is_checked_on_the_binding_scope() {
        let tenant = Uuid::new_v4();
        let workspace = Uuid::new_v4();
        assert_eq!(
            permission_checks(tenant, None),
            vec![("tenant", tenant.to_string(), "manage")]
        );
        assert_eq!(
            permission_checks(tenant, Some(workspace)),
            vec![
                ("workspace", workspace.to_string(), "discover"),
                ("workspace", workspace.to_string(), "manage"),
            ]
        );
    }

    #[test]
    fn locator_is_binding_scoped() {
        let binding = Uuid::new_v4();
        let secret = Uuid::new_v4();
        assert_eq!(
            locator_path(binding, secret),
            format!("component-secret/{binding}/{secret}")
        );
    }

    #[test]
    fn failures_map_to_closed_statuses() {
        assert_eq!(Failure::Invalid.status().0, StatusCode::BAD_REQUEST);
        assert_eq!(Failure::Denied.status().0, StatusCode::FORBIDDEN);
        assert_eq!(Failure::NotFound.status().0, StatusCode::NOT_FOUND);
        assert_eq!(Failure::Limit.status().0, StatusCode::CONFLICT);
        assert_eq!(
            Failure::Unavailable("x".into()).status().0,
            StatusCode::SERVICE_UNAVAILABLE
        );
        let response = respond(&Failure::Denied);
        assert_eq!(response.headers()[CACHE_CONTROL], "no-store");
    }
}
