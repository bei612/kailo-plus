//! DD-165, `.design/07` §4.8.9: component usage enters the one Kailo metering,
//! quota and usage view.
//!
//! - Reports: an embedded component (native page entry) reports usage that has
//!   happened (a finished knowledge answer, a started data query, an hourly
//!   storage snapshot) with the binding's own directory client — the same
//!   service identity as the member directory and the notification delivery.
//!   Core writes a `COMPONENT_REPORT` UsageEvent on the binding generation's
//!   usage operation; the existing outbox delivers it to OpenMeter and only a
//!   native `stored_at` commits it. The component cannot name the Customer,
//!   subject or dimensions: they are built here from the binding and the
//!   directory. Nothing is granted and no ActionExecution is created.
//! - Admission: before a knowledge answer or a data query starts, the
//!   component asks. Core reads the Tenant Customer's entitlement (the Tenant
//!   quota) and, when the entitlement metadata carries a member cap, the
//!   member's committed usage in the current period (CHECK, no reservation).
//!   OpenMeter stays the only ledger; Core keeps no balance or usage copy.
//! - Views: every member reads their own usage; Tenant admins and auditors
//!   read the per-component split. Values are read from OpenMeter each time.

use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use std::time::Instant;

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header::CACHE_CONTROL, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use contracts::{
    ComponentBindingUsage, ComponentMeterUsage, ComponentUsageAdmission, ComponentUsageDecision,
    ComponentUsageMeter, ComponentUsagePage, EvidenceKind, MemberUsagePage, MemberUsageState,
    MemberUsageView, MeterUsageState, NativePageCategory, ReasonCode,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgConnection;
use uuid::Uuid;

use crate::{
    audit::Evidence,
    bff::{resolve_execution_context, BffState},
    governance::Refusal,
    openmeter::{self, GroupedUsage, OpenMeter},
    service_api::ServiceState,
    tenant_quota::{self, PlatformFeature, MEMBER_DIMENSION},
};

const BODY_MAX_BYTES: usize = 4 * 1024;
const FUTURE_SKEW_SECONDS: i64 = 300;
const PAST_WINDOW_DAYS: i64 = 7;
const STORAGE_MAX_BYTES: i64 = 1_000_000_000_000_000;
const DEFAULT_RATE_PER_MINUTE: u32 = 1200;
const SOURCE_TYPE: &str = "COMPONENT_REPORT";

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

fn denied() -> Refusal {
    Refusal::Denied(ReasonCode::PermissionDenied)
}

fn unavailable(what: &str) -> Refusal {
    Refusal::Unavailable(format!("component usage: {what}"))
}

/// The service listener's closed answers: malformed input is a plain 400
/// (07 §4.8.9), everything else keeps the governance error body.
fn respond(error: &Refusal) -> Response {
    let mut response = error.respond(None);
    if matches!(error, Refusal::Precondition(ReasonCode::InvalidParameters)) {
        *response.status_mut() = StatusCode::BAD_REQUEST;
    }
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

// ---------------------------------------------------------------------------
// The meter catalog (DD-165(1))
// ---------------------------------------------------------------------------

/// One reportable component meter: the platform meter key, the quota item it
/// is metered under, the presentation category that may report it and whether
/// it carries the member dimension.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ComponentMeter {
    pub meter: &'static str,
    pub feature: &'static str,
    pub category: &'static str,
    pub member: bool,
    pub event_type: &'static str,
}

pub(crate) static COMPONENT_METERS: [ComponentMeter; 3] = [
    ComponentMeter {
        meter: tenant_quota::KNOWLEDGE_ANSWER_METER,
        feature: "knowledge_answers",
        category: "knowledge",
        member: true,
        event_type: "kailo.component.knowledge.answer",
    },
    ComponentMeter {
        meter: tenant_quota::DATA_QUERY_METER,
        feature: "data_queries",
        category: "data_query",
        member: true,
        event_type: "kailo.component.data.query",
    },
    ComponentMeter {
        meter: tenant_quota::FILE_STORAGE_BYTES_METER,
        feature: "file_storage",
        category: "file_storage",
        member: false,
        event_type: "kailo.component.storage.bytes",
    },
];

pub(crate) fn component_meter(meter: &ComponentUsageMeter) -> &'static ComponentMeter {
    let key = match meter {
        ComponentUsageMeter::KnowledgeAnswerCount => tenant_quota::KNOWLEDGE_ANSWER_METER,
        ComponentUsageMeter::DataQueryCount => tenant_quota::DATA_QUERY_METER,
        ComponentUsageMeter::FileStorageBytes => tenant_quota::FILE_STORAGE_BYTES_METER,
    };
    COMPONENT_METERS
        .iter()
        .find(|m| m.meter == key)
        .unwrap_or(&COMPONENT_METERS[0])
}

fn feature_of(meter: &ComponentMeter) -> Result<&'static PlatformFeature, Refusal> {
    tenant_quota::platform_feature(meter.feature).ok_or_else(|| unavailable("quota catalog"))
}

// ---------------------------------------------------------------------------
// Pure rules: the report body
// ---------------------------------------------------------------------------

/// A validated report, ready to store.
#[derive(Debug, PartialEq)]
pub(crate) struct Report {
    pub(crate) typed: contracts::ComponentUsageReport,
    pub(crate) meter: &'static ComponentMeter,
    pub(crate) digest: String,
    pub(crate) occurred_at: DateTime<Utc>,
}

/// Shape and value rules of `ComponentUsageReport`; unknown fields are refused
/// by comparing the typed round trip with the received value.
pub(crate) fn parse_report(body: &[u8], now: DateTime<Utc>) -> Result<Report, Refusal> {
    if body.len() > BODY_MAX_BYTES {
        return Err(invalid());
    }
    let value: Value = serde_json::from_slice(body).map_err(|_| invalid())?;
    let typed: contracts::ComponentUsageReport =
        serde_json::from_value(value.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(&typed).map_err(|_| invalid())? != value {
        return Err(invalid());
    }
    let meter = component_meter(&typed.meter_key);
    let quantity_ok = if meter.member {
        typed.quantity == 1
    } else {
        (0..=STORAGE_MAX_BYTES).contains(&typed.quantity)
    };
    if !crate::component_notification::idempotency_key(&typed.idempotency_key)
        || !quantity_ok
        || typed.member.is_some() != meter.member
        || typed.member.as_ref().is_some_and(|m| !person_ok(m))
    {
        return Err(invalid());
    }
    let occurred_at = DateTime::parse_from_rfc3339(&typed.occurred_at)
        .map_err(|_| invalid())?
        .with_timezone(&Utc);
    if occurred_at > now + Duration::seconds(FUTURE_SKEW_SECONDS)
        || occurred_at < now - Duration::days(PAST_WINDOW_DAYS)
    {
        return Err(invalid());
    }
    Ok(Report {
        digest: collab_bridge::limits::canonical_digest(&value),
        typed,
        meter,
        occurred_at,
    })
}

/// The admission request: same member rule as a report.
pub(crate) fn parse_admission(
    body: &[u8],
) -> Result<
    (
        contracts::ComponentUsageAdmissionRequest,
        &'static ComponentMeter,
    ),
    Refusal,
> {
    if body.len() > BODY_MAX_BYTES {
        return Err(invalid());
    }
    let value: Value = serde_json::from_slice(body).map_err(|_| invalid())?;
    let typed: contracts::ComponentUsageAdmissionRequest =
        serde_json::from_value(value.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(&typed).map_err(|_| invalid())? != value {
        return Err(invalid());
    }
    let meter = component_meter(&typed.meter_key);
    if typed.member.is_some() != meter.member
        || typed.member.as_ref().is_some_and(|m| !person_ok(m))
    {
        return Err(invalid());
    }
    Ok((typed, meter))
}

fn person_ok(person: &contracts::ComponentPersonRef) -> bool {
    (1..=1024).contains(&person.issuer.len())
        && (1..=255).contains(&person.subject.len())
        && !person.issuer.chars().any(char::is_control)
        && !person.subject.chars().any(char::is_control)
}

/// The stable source identity of a report: binding + idempotency key. A retry
/// with the same key never yields a second UsageEvent.
pub(crate) fn source_id(binding: Uuid, key: &str) -> Uuid {
    Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!("urn:platform:component-usage:{binding}:{key}").as_bytes(),
    )
}

/// The UsageEvent / OpenMeter event ID, fixed before the first outbox write
/// from the same fields (`03` §8).
pub(crate) fn event_id(tenant: Uuid, source: Uuid, meter: &str) -> Uuid {
    Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!("{tenant}:{SOURCE_TYPE}:{source}:{meter}").as_bytes(),
    )
}

/// The frozen binding facts a report is attributed to.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Attribution {
    pub tenant_id: Uuid,
    pub workspace_id: Option<Uuid>,
    pub binding_id: Uuid,
    pub release_id: Uuid,
    pub generation: i64,
    pub operation_id: Uuid,
    pub customer_id: String,
}

/// Dimensions and CloudEvent of one report. `workspace_id` of a Tenant-level
/// binding stays null in the frozen body and is not sent (DD-08); the subject
/// is the Customer key (the Tenant ID), natively attributed to the Customer.
pub(crate) fn frozen_event(
    attribution: &Attribution,
    report: &Report,
    member: Option<Uuid>,
    id: Uuid,
) -> (Value, Value) {
    let mut dimensions = json!({
        "tenant_id": attribution.tenant_id,
        "workspace_id": attribution.workspace_id,
        "operation_id": attribution.operation_id,
        "component_binding_id": attribution.binding_id,
        "component_release_id": attribution.release_id,
        "component_projection_generation": attribution.generation,
        "attribution": "BINDING",
        "report_digest": report.digest,
    });
    if let Some(member) = member {
        dimensions[MEMBER_DIMENSION] = Value::String(member.to_string());
    }
    let mut data = dimensions.clone();
    if !report.meter.member {
        data["bytes"] = report.typed.quantity.into();
    }
    let event = json!({
        "specversion": "1.0",
        "id": id,
        "source": "urn:platform:core:usage",
        "type": report.meter.event_type,
        "subject": attribution.tenant_id.to_string(),
        "time": report.occurred_at.to_rfc3339_opts(SecondsFormat::Secs, true),
        "datacontenttype": "application/json",
        "data": data,
    });
    (dimensions, event)
}

// ---------------------------------------------------------------------------
// Rate window (per binding, one Core process)
// ---------------------------------------------------------------------------

static WINDOWS: Mutex<Option<HashMap<Uuid, (Instant, u32)>>> = Mutex::new(None);

fn rate_per_minute() -> u32 {
    std::env::var("COMPONENT_USAGE_RATE_PER_MINUTE")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .filter(|v| (1..=100_000).contains(v))
        .unwrap_or(DEFAULT_RATE_PER_MINUTE)
}

/// Counts new reports of one binding in a 60 s window; over the limit is 429.
fn admit_rate(binding: Uuid, now: Instant, limit: u32) -> bool {
    let Ok(mut guard) = WINDOWS.lock() else {
        return false;
    };
    let windows = guard.get_or_insert_with(HashMap::new);
    windows.retain(|_, (start, _)| now.duration_since(*start).as_secs() < 60);
    let entry = windows.entry(binding).or_insert((now, 0));
    if entry.1 >= limit {
        return false;
    }
    entry.1 += 1;
    true
}

// ---------------------------------------------------------------------------
// Shared: caller, category, member
// ---------------------------------------------------------------------------

/// The binding's directory client proves the caller (07 §4.7.4); the release
/// must be a `KAILO_EMBED` native page whose presentation category reports
/// this meter. Returns the binding's Tenant/Workspace.
async fn caller(
    state: &ServiceState,
    headers: &HeaderMap,
    binding: Uuid,
) -> Result<Caller, Refusal> {
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
        return Err(denied());
    }
    Ok(Caller {
        tenant: entry.tenant_id,
        workspace: entry.workspace_id,
        category: entry.manifest["frontendDelivery"]["nativePageCategory"]
            .as_str()
            .map(str::to_owned),
    })
}

/// The proven caller binding: its Tenant, Workspace and presentation category.
struct Caller {
    tenant: Uuid,
    workspace: Option<Uuid>,
    category: Option<String>,
}

impl Caller {
    /// Only the presentation category a meter belongs to may use it (DD-165(2)).
    fn reports(&self, meter: &ComponentMeter) -> Result<(), Refusal> {
        if self.category.as_deref() == Some(meter.category) {
            Ok(())
        } else {
            Err(denied())
        }
    }
}

/// `issuer`+`subject` → the ACTIVE HUMAN Principal in the binding's directory
/// scope (`07` §4.8.3 recipient rule): Tenant member, and `discover` on the
/// Workspace of a Workspace binding (SpiceDB, fully consistent).
async fn member_in_scope(
    state: &ServiceState,
    tenant: Uuid,
    workspace: Option<Uuid>,
    person: &contracts::ComponentPersonRef,
) -> Result<Uuid, Refusal> {
    let mut conn = state.pool.acquire().await?;
    let principal = crate::component_notification::member(&mut conn, tenant, person)
        .await?
        .ok_or_else(denied)?;
    drop(conn);
    if let Some(workspace) = workspace {
        let workspace = workspace.to_string();
        let principal_id = principal.to_string();
        let items = [crate::spicedb::BulkCheck {
            object_type: "workspace",
            object_id: &workspace,
            permission: "discover",
            principal: &principal_id,
        }];
        let allowed = state
            .governance
            .spicedb
            .check_bulk_principals(&items)
            .await
            .map_err(|_| unavailable("authorization"))?;
        if allowed.len() != 1 || !allowed[0] {
            return Err(denied());
        }
    }
    Ok(principal)
}

/// The Tenant's one ACTIVE Customer in this namespace (same judgement as the
/// Agent CHECK); none is a dependency gap the component retries.
async fn customer(
    conn: &mut PgConnection,
    tenant: Uuid,
    namespace: &str,
) -> Result<String, Refusal> {
    let row: Option<(String, String, String, String, i32)> = sqlx::query_as(
        "select namespace, customer_id, subject_key_prefix, status, version
         from projection.openmeter_binding where tenant_id = $1",
    )
    .bind(tenant)
    .fetch_optional(&mut *conn)
    .await?;
    match row {
        Some((ns, customer, prefix, status, version))
            if ns == namespace
                && prefix == format!("{tenant}:")
                && status == "ACTIVE"
                && version > 0 =>
        {
            Ok(customer)
        }
        _ => Err(unavailable("metering customer not active")),
    }
}

// ---------------------------------------------------------------------------
// POST /service/v1/component-usage/bindings/{binding}/reports
// ---------------------------------------------------------------------------

pub(crate) async fn report(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    Path(binding): Path<Uuid>,
    body: Bytes,
) -> Response {
    match store(&state, &headers, binding, &body).await {
        Ok((receipt, created, meter)) => {
            tracing::info!(%binding, meter, duplicate = !created, "组件用量已接收");
            (
                if created {
                    StatusCode::CREATED
                } else {
                    StatusCode::OK
                },
                [(CACHE_CONTROL, "no-store")],
                Json(receipt),
            )
                .into_response()
        }
        Err(error) => {
            tracing::info!(%binding, reason = ?error.reason(), "组件用量上报被拒绝或不可用");
            respond(&error)
        }
    }
}

async fn store(
    state: &ServiceState,
    headers: &HeaderMap,
    binding: Uuid,
    body: &[u8],
) -> Result<(Value, bool, &'static str), Refusal> {
    // Who is calling comes first: an unauthenticated caller learns nothing
    // about the validation rules.
    let proven = caller(state, headers, binding).await?;
    let report = parse_report(body, Utc::now())?;
    proven.reports(report.meter)?;
    let (tenant, workspace) = (proven.tenant, proven.workspace);
    let member = match &report.typed.member {
        Some(person) => Some(member_in_scope(state, tenant, workspace, person).await?),
        None => None,
    };
    let namespace = state.governance.openmeter.namespace().to_owned();
    let source = source_id(binding, &report.typed.idempotency_key);
    let mut tx = state.pool.begin().await?;
    sqlx::query("select pg_advisory_xact_lock($1)")
        .bind(crate::component_notification::binding_lock(binding))
        .execute(&mut *tx)
        .await?;
    // The binding may have been disabled meanwhile: re-read it under the lock,
    // with the generation and usage operation the report is attributed to.
    let facts: Option<(Option<Uuid>, Uuid, i64, Uuid)> = sqlx::query_as(
        "select b.workspace_id, p.component_release_id, p.generation, origin.operation_id
         from catalog.application_binding b
         join projection.application_runtime p on p.binding_id = b.id
           and p.generation = b.active_projection_generation and p.state = 'ACTIVE'
         join admission.action_execution origin on origin.id = p.action_execution_id
         where b.id = $1 and b.tenant_id = $2 and b.state = 'ACTIVE'",
    )
    .bind(binding)
    .bind(tenant)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((binding_workspace, release, generation, operation)) = facts else {
        return Err(denied());
    };
    if binding_workspace != workspace {
        return Err(denied());
    }
    let existing: Option<(Uuid, Value)> = sqlx::query_as(
        "select id, dimensions from outbox.usage_event
         where tenant_id = $1 and source_type = $2 and source_id = $3",
    )
    .bind(tenant)
    .bind(SOURCE_TYPE)
    .bind(source)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some((id, dimensions)) = existing {
        tx.commit().await?;
        return if dimensions["report_digest"] == Value::String(report.digest.clone()) {
            Ok((
                json!({"usageEventId": id, "duplicate": true}),
                false,
                report.meter.meter,
            ))
        } else {
            Err(Refusal::Conflict(ReasonCode::IdempotencyKeyReused))
        };
    }
    if !admit_rate(binding, Instant::now(), rate_per_minute()) {
        return Err(Refusal::Limit(ReasonCode::RateLimited));
    }
    let customer_id = customer(&mut tx, tenant, &namespace).await?;
    let attribution = Attribution {
        tenant_id: tenant,
        workspace_id: workspace,
        binding_id: binding,
        release_id: release,
        generation,
        operation_id: operation,
        customer_id,
    };
    let id = event_id(tenant, source, report.meter.meter);
    let (dimensions, event) = frozen_event(&attribution, &report, member, id);
    sqlx::query(
        "insert into outbox.usage_event
           (id, operation_id, tenant_id, workspace_id, openmeter_customer_id, source_type, source_id,
            meter_key, subject_key, quantity, occurred_at, dimensions, openmeter_event_id, event,
            settlement_status, openmeter_namespace, component_binding_id, component_release_id,
            component_projection_generation)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $1, $13, 'PENDING_PUBLISH',
                 $14, $15, $16, $17)",
    )
    .bind(id)
    .bind(operation)
    .bind(tenant)
    .bind(workspace)
    .bind(&attribution.customer_id)
    .bind(SOURCE_TYPE)
    .bind(source)
    .bind(report.meter.meter)
    .bind(tenant.to_string())
    .bind(report.typed.quantity)
    .bind(report.occurred_at)
    .bind(&dimensions)
    .bind(&event)
    .bind(&namespace)
    .bind(binding)
    .bind(release)
    .bind(generation)
    .execute(&mut *tx)
    .await?;
    crate::gateway_usage::usage_audit(
        &mut tx,
        operation,
        &format!("usage:{id}:PENDING_PUBLISH"),
        "RECONCILIATION",
        "PENDING_PUBLISH",
        vec![Evidence::new(EvidenceKind::UsageEventId, id)],
    )
    .await
    .map_err(unavailable)?;
    tx.commit().await?;
    let receipt = json!({"usageEventId": id, "duplicate": false});
    let typed: contracts::ComponentUsageReceipt =
        serde_json::from_value(receipt.clone()).map_err(|_| unavailable("contract"))?;
    if serde_json::to_value(&typed).map_err(|_| unavailable("contract"))? != receipt {
        return Err(unavailable("contract"));
    }
    Ok((receipt, true, report.meter.meter))
}

// ---------------------------------------------------------------------------
// POST /service/v1/component-usage/bindings/{binding}/admission
// ---------------------------------------------------------------------------

pub(crate) async fn admission(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    Path(binding): Path<Uuid>,
    body: Bytes,
) -> Response {
    match decide(&state, &headers, binding, &body).await {
        Ok((answer, meter)) => {
            tracing::info!(%binding, meter, decision = ?answer.decision, "组件额度准入");
            crate::presence::no_store(answer)
        }
        Err(error) => {
            tracing::info!(%binding, reason = ?error.reason(), "组件额度准入被拒绝或不可用");
            respond(&error)
        }
    }
}

async fn decide(
    state: &ServiceState,
    headers: &HeaderMap,
    binding: Uuid,
    body: &[u8],
) -> Result<(ComponentUsageAdmission, &'static str), Refusal> {
    let proven = caller(state, headers, binding).await?;
    let (request, meter) = parse_admission(body)?;
    proven.reports(meter)?;
    let (tenant, workspace) = (proven.tenant, proven.workspace);
    let member = match &request.member {
        Some(person) => Some(member_in_scope(state, tenant, workspace, person).await?),
        None => None,
    };
    let openmeter = &state.governance.openmeter;
    let customer_id = {
        let mut conn = state.pool.acquire().await?;
        customer(&mut conn, tenant, openmeter.namespace()).await?
    };
    let feature = feature_of(meter)?;
    let fact = quota_fact(openmeter, &customer_id, feature, member, Utc::now())
        .await
        .map_err(|_| unavailable("OpenMeter quota unreadable"))?;
    Ok((
        ComponentUsageAdmission {
            decision: fact.decision(),
            period_reset_at: fact.reset_at.map(rfc3339),
        },
        meter.meter,
    ))
}

fn rfc3339(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// One quota item as OpenMeter states it now, for one member when given.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct QuotaFact {
    /// No entitlement, or the entitlement has no access (DD-123: hard limit).
    pub tenant_exhausted: bool,
    pub member_limit: Option<i64>,
    pub member_used: Option<f64>,
    pub reset_at: Option<DateTime<Utc>>,
}

impl QuotaFact {
    pub(crate) fn decision(&self) -> ComponentUsageDecision {
        if self.tenant_exhausted {
            ComponentUsageDecision::TenantQuotaExhausted
        } else if member_reached(self.member_limit, self.member_used) {
            ComponentUsageDecision::MemberQuotaExhausted
        } else {
            ComponentUsageDecision::Allowed
        }
    }

    pub(crate) fn member_state(&self) -> MemberUsageState {
        if self.tenant_exhausted {
            MemberUsageState::TenantExhausted
        } else if member_reached(self.member_limit, self.member_used) {
            MemberUsageState::MemberLimitReached
        } else {
            MemberUsageState::Available
        }
    }
}

/// A member cap is reached when the member's committed usage this period is
/// not below it. A cap without a readable usage never reaches this point:
/// the read fails and the caller refuses as dependency unavailable.
pub(crate) fn member_reached(limit: Option<i64>, used: Option<f64>) -> bool {
    match (limit, used) {
        (Some(limit), Some(used)) => used >= limit as f64,
        _ => false,
    }
}

/// Reads the entitlement, its access and (for a member) the member's
/// committed usage in the entitlement's current period.
pub(crate) async fn quota_fact(
    openmeter: &OpenMeter,
    customer_id: &str,
    feature: &PlatformFeature,
    member: Option<Uuid>,
    now: DateTime<Utc>,
) -> Result<QuotaFact, openmeter::Error> {
    let Some(entitlement) = openmeter.entitlement(customer_id, feature.key).await? else {
        return Ok(QuotaFact {
            tenant_exhausted: true,
            member_limit: None,
            member_used: None,
            reset_at: None,
        });
    };
    let value = openmeter
        .entitlement_value(customer_id, feature.key)
        .await?;
    let member_limit =
        tenant_quota::member_limit(&entitlement).map_err(|_| openmeter::Error::Unknown)?;
    let reset_at = entitlement.current_usage_period.as_ref().map(|p| p.to);
    let member_used = match member {
        Some(member) if feature.member_limit => {
            let from = entitlement
                .current_usage_period
                .as_ref()
                .and_then(|p| p.from)
                .ok_or(openmeter::Error::Unknown)?;
            Some(member_usage(openmeter, customer_id, feature.meter, member, from, now).await?)
        }
        _ => None,
    };
    Ok(QuotaFact {
        tenant_exhausted: !value.has_access,
        member_limit: if member.is_some() { member_limit } else { None },
        member_used,
        reset_at,
    })
}

/// A member's committed usage of a member-dimension meter in [from, to).
async fn member_usage(
    openmeter: &OpenMeter,
    customer_id: &str,
    meter: &str,
    member: Uuid,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<f64, openmeter::Error> {
    if to <= from {
        return Ok(0.0);
    }
    let principal = member.to_string();
    match openmeter
        .grouped_meter_usage(
            customer_id,
            meter,
            MEMBER_DIMENSION,
            Some((MEMBER_DIMENSION, &principal)),
            from,
            to,
        )
        .await?
    {
        GroupedUsage::NotRegistered => Err(openmeter::Error::Precondition),
        GroupedUsage::Committed { rows, .. } => sum_rows(&rows, Some(&principal)),
    }
}

/// Sums native decimal rows; a row of another group value is a native
/// inconsistency, never silently dropped or counted.
pub(crate) fn sum_rows(
    rows: &[(String, String)],
    only: Option<&str>,
) -> Result<f64, openmeter::Error> {
    let mut total = 0.0;
    for (group, value) in rows {
        if only.is_some_and(|only| only != group) {
            return Err(openmeter::Error::Unknown);
        }
        let value: f64 = value.parse().map_err(|_| openmeter::Error::Unknown)?;
        if !value.is_finite() || value < 0.0 {
            return Err(openmeter::Error::Unknown);
        }
        total += value;
    }
    Ok(total)
}

// ---------------------------------------------------------------------------
// ExtAuthz: component model calls (DD-165(3), DD-128(3))
// ---------------------------------------------------------------------------

/// The CHECK of a component model call against the Tenant quota item
/// `component_tokens`, with the same native mapping as the Agent CHECK:
/// no access is `QUOTA_EXHAUSTED` (429), an unreadable OpenMeter is 503.
pub(crate) async fn model_tokens_check(state: &ServiceState, tenant: Uuid) -> Result<(), Refusal> {
    let openmeter = &state.governance.openmeter;
    let customer_id = {
        let mut conn = state.pool.acquire().await?;
        customer(&mut conn, tenant, openmeter.namespace()).await?
    };
    let meters = [tenant_quota::COMPONENT_MODEL_TOKENS_METER.to_owned()];
    model_check_result(openmeter.check_quota(tenant, &customer_id, &meters).await)
}

pub(crate) fn model_check_result(result: Result<bool, openmeter::Error>) -> Result<(), Refusal> {
    match result {
        Ok(true) => Ok(()),
        Ok(false) => Err(Refusal::Limit(ReasonCode::QuotaExhausted)),
        Err(openmeter::Error::Denied | openmeter::Error::Precondition) => {
            Err(Refusal::Precondition(ReasonCode::BindingNotActive))
        }
        Err(openmeter::Error::Conflict) => Err(Refusal::Conflict(ReasonCode::TargetStateConflict)),
        Err(openmeter::Error::Limit) => Err(Refusal::Limit(ReasonCode::RateLimited)),
        Err(openmeter::Error::Unknown) => Err(unavailable("OpenMeter quota unreadable")),
    }
}

// ---------------------------------------------------------------------------
// BFF: GET /api/v1/usage/me
// ---------------------------------------------------------------------------

/// DD-165(4)「我的用量」: every member reads their own usage of the quota items
/// with a member dimension. No Tenant limit or Tenant usage is shown.
pub(crate) async fn my_usage(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let openmeter = &state.governance.openmeter;
    let customer_id = match state.pool.acquire().await {
        Ok(mut conn) => customer(&mut conn, ctx.tenant_id, openmeter.namespace())
            .await
            .ok(),
        Err(error) => return Refusal::from(error).respond(None),
    };
    let now = Utc::now();
    let mut items = Vec::new();
    for feature in tenant_quota::PLATFORM_FEATURES
        .iter()
        .filter(|feature| feature.member_limit)
    {
        let fact = match customer_id.as_deref() {
            Some(customer_id) => quota_fact(
                openmeter,
                customer_id,
                feature,
                Some(ctx.tenant_principal_id),
                now,
            )
            .await
            .ok(),
            None => None,
        };
        items.push(member_view(feature, fact.as_ref()));
    }
    crate::presence::no_store(MemberUsagePage { items })
}

pub(crate) fn member_view(feature: &PlatformFeature, fact: Option<&QuotaFact>) -> MemberUsageView {
    let Some(fact) = fact else {
        return MemberUsageView {
            feature: feature.quota.clone(),
            state: MemberUsageState::Unavailable,
            used: None,
            member_limit_per_period: None,
            period_reset_at: None,
        };
    };
    MemberUsageView {
        feature: feature.quota.clone(),
        state: fact.member_state(),
        used: fact.member_used,
        member_limit_per_period: fact.member_limit,
        period_reset_at: fact.reset_at.map(rfc3339),
    }
}

// ---------------------------------------------------------------------------
// BFF: GET /api/v1/usage/components?from=&to=
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub(crate) struct WindowQuery {
    from: String,
    to: String,
}

/// The component meters of the per-component view, in display order.
pub(crate) const VIEW_METERS: [&str; 4] = [
    tenant_quota::COMPONENT_MODEL_TOKENS_METER,
    tenant_quota::KNOWLEDGE_ANSWER_METER,
    tenant_quota::DATA_QUERY_METER,
    tenant_quota::FILE_STORAGE_BYTES_METER,
];

/// DD-165(4): Tenant admins and auditors (Tenant `audit`, fresh) read the
/// committed usage of each component meter split by binding.
pub(crate) async fn component_usage(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(query): Query<WindowQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let parse = |s: &str| DateTime::parse_from_rfc3339(s).map(|t| t.with_timezone(&Utc));
    let (from, to) = match (parse(&query.from), parse(&query.to)) {
        (Ok(from), Ok(to)) if from < to => (from, to),
        _ => return Refusal::Precondition(ReasonCode::InvalidParameters).respond(None),
    };
    if let Err(response) = crate::audit_views::authorize_scope(&state, &ctx, None).await {
        return response;
    }
    let openmeter = &state.governance.openmeter;
    let customer_id = match state.pool.acquire().await {
        Ok(mut conn) => customer(&mut conn, ctx.tenant_id, openmeter.namespace())
            .await
            .ok(),
        Err(error) => return Refusal::from(error).respond(None),
    };
    let bindings: Vec<(Uuid, Option<Uuid>, Option<String>)> = match sqlx::query_as(
        "select b.id, b.workspace_id, r.manifest->'frontendDelivery'->>'nativePageCategory'
         from catalog.application_binding b
         join catalog.component_release r on r.id = b.component_release_id
         where b.tenant_id = $1",
    )
    .bind(ctx.tenant_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => rows,
        Err(error) => return Refusal::from(error).respond(None),
    };
    let known: BTreeMap<String, (Option<Uuid>, Option<String>)> = bindings
        .into_iter()
        .map(|(id, workspace, category)| (id.to_string(), (workspace, category)))
        .collect();
    let mut meters = Vec::with_capacity(VIEW_METERS.len());
    for meter in VIEW_METERS {
        let Some(customer_id) = customer_id.as_deref() else {
            meters.push(meter_unavailable(meter));
            continue;
        };
        let grouped = openmeter
            .grouped_meter_usage(customer_id, meter, "component_binding_id", None, from, to)
            .await;
        meters.push(match grouped {
            Ok(GroupedUsage::NotRegistered) => ComponentMeterUsage {
                meter_key: meter.to_owned(),
                aggregation: None,
                state: MeterUsageState::MeterNotRegistered,
                bindings: Vec::new(),
            },
            Ok(GroupedUsage::Committed { aggregation, rows }) => {
                component_meter_view(meter, aggregation, &rows, &known)
            }
            Err(error) => {
                tracing::warn!(error = %error, meter, "OpenMeter 组件用量不可查证");
                meter_unavailable(meter)
            }
        });
    }
    crate::presence::no_store(ComponentUsagePage {
        from: rfc3339(from),
        to: rfc3339(to),
        meters,
    })
}

fn meter_unavailable(meter: &str) -> ComponentMeterUsage {
    ComponentMeterUsage {
        meter_key: meter.to_owned(),
        aggregation: None,
        state: MeterUsageState::Unavailable,
        bindings: Vec::new(),
    }
}

fn category(value: Option<&str>) -> Option<NativePageCategory> {
    match value {
        Some("file_storage") => Some(NativePageCategory::FileStorage),
        Some("knowledge") => Some(NativePageCategory::Knowledge),
        Some("data_query") => Some(NativePageCategory::DataQuery),
        _ => None,
    }
}

/// Rows of bindings of this Tenant only; a row naming a binding Core does not
/// know for this Tenant makes the meter unverifiable rather than misattributed.
pub(crate) fn component_meter_view(
    meter: &str,
    aggregation: String,
    rows: &[(String, String)],
    known: &BTreeMap<String, (Option<Uuid>, Option<String>)>,
) -> ComponentMeterUsage {
    let mut bindings = Vec::with_capacity(rows.len());
    for (binding, quantity) in rows {
        let Some((workspace, page)) = known.get(binding) else {
            return meter_unavailable(meter);
        };
        bindings.push(ComponentBindingUsage {
            binding_id: binding.clone(),
            native_page_category: category(page.as_deref()),
            workspace_id: workspace.map(|w| w.to_string()),
            quantity: quantity.clone(),
        });
    }
    ComponentMeterUsage {
        meter_key: meter.to_owned(),
        state: if bindings.is_empty() {
            MeterUsageState::NoCommittedUsage
        } else {
            MeterUsageState::Committed
        },
        aggregation: Some(aggregation),
        bindings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(value: Value) -> Vec<u8> {
        serde_json::to_vec(&value).unwrap_or_default()
    }

    fn person() -> Value {
        json!({"issuer": "https://idp.example/realms/kailo", "subject": "user-1"})
    }

    #[test]
    fn report_rules_follow_the_meter() {
        let now = Utc::now();
        let at = rfc3339(now);
        let answer = json!({"idempotencyKey": "weknora.answer.abc", "meterKey": "knowledge_answer_count",
            "quantity": 1, "occurredAt": at, "member": person()});
        let parsed = parse_report(&body(answer.clone()), now).expect("valid answer");
        assert_eq!(parsed.meter.meter, "knowledge_answer_count");
        assert!(parsed.meter.member);
        // count meter: exactly 1 and a member
        let mut two = answer.clone();
        two["quantity"] = 2.into();
        assert!(parse_report(&body(two), now).is_err());
        let mut anonymous = answer.clone();
        if let Some(object) = anonymous.as_object_mut() {
            object.remove("member");
        }
        assert!(parse_report(&body(anonymous), now).is_err());
        // storage: bytes, never a member
        let storage = json!({"idempotencyKey": "cells.storage.2026103010", "meterKey": "file_storage_bytes",
            "quantity": 123_456, "occurredAt": at});
        assert!(parse_report(&body(storage.clone()), now).is_ok());
        let mut attributed = storage.clone();
        attributed["member"] = person();
        assert!(parse_report(&body(attributed), now).is_err());
        let mut negative = storage.clone();
        negative["quantity"] = (-1).into();
        assert!(parse_report(&body(negative), now).is_err());
        // unknown fields, the model meter, bad keys and times are refused
        let mut extra = storage.clone();
        extra["customerId"] = "x".into();
        assert!(parse_report(&body(extra), now).is_err());
        let mut model = storage.clone();
        model["meterKey"] = "component_model_tokens".into();
        assert!(parse_report(&body(model), now).is_err());
        let mut key = storage.clone();
        key["idempotencyKey"] = "bad key".into();
        assert!(parse_report(&body(key), now).is_err());
        let mut future = storage.clone();
        future["occurredAt"] = rfc3339(now + Duration::minutes(10)).into();
        assert!(parse_report(&body(future), now).is_err());
        let mut old = storage;
        old["occurredAt"] = rfc3339(now - Duration::days(8)).into();
        assert!(parse_report(&body(old), now).is_err());
    }

    #[test]
    fn same_key_same_body_same_digest_and_source() {
        let now = Utc::now();
        let report = json!({"idempotencyKey": "wren.ask.q1", "meterKey": "data_query_count",
            "quantity": 1, "occurredAt": rfc3339(now), "member": person()});
        let a = parse_report(&body(report.clone()), now).expect("valid");
        let b = parse_report(&body(report), now).expect("valid");
        assert_eq!(a.digest, b.digest);
        let binding = Uuid::new_v4();
        assert_eq!(
            source_id(binding, "wren.ask.q1"),
            source_id(binding, "wren.ask.q1")
        );
        assert_ne!(
            source_id(binding, "wren.ask.q1"),
            source_id(Uuid::new_v4(), "wren.ask.q1")
        );
    }

    #[test]
    fn frozen_event_is_built_from_binding_facts_only() {
        let now = Utc::now();
        let report = parse_report(
            &body(
                json!({"idempotencyKey": "cells.storage.h1", "meterKey": "file_storage_bytes",
                "quantity": 42, "occurredAt": rfc3339(now)}),
            ),
            now,
        )
        .expect("valid");
        let attribution = Attribution {
            tenant_id: Uuid::new_v4(),
            workspace_id: None,
            binding_id: Uuid::new_v4(),
            release_id: Uuid::new_v4(),
            generation: 3,
            operation_id: Uuid::new_v4(),
            customer_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV".into(),
        };
        let id = Uuid::new_v4();
        let (dimensions, event) = frozen_event(&attribution, &report, None, id);
        assert_eq!(event["subject"], attribution.tenant_id.to_string());
        assert_eq!(event["type"], "kailo.component.storage.bytes");
        assert_eq!(event["id"], id.to_string());
        assert_eq!(event["data"]["bytes"], 42);
        assert_eq!(dimensions["attribution"], "BINDING");
        assert_eq!(dimensions["component_projection_generation"], 3);
        assert!(dimensions["workspace_id"].is_null());
        assert!(dimensions.get(MEMBER_DIMENSION).is_none());
        let member = Uuid::new_v4();
        let answer = parse_report(
            &body(
                json!({"idempotencyKey": "k", "meterKey": "knowledge_answer_count",
                "quantity": 1, "occurredAt": rfc3339(now), "member": person()}),
            ),
            now,
        )
        .expect("valid");
        let (dimensions, event) = frozen_event(&attribution, &answer, Some(member), id);
        assert_eq!(dimensions[MEMBER_DIMENSION], member.to_string());
        assert!(event["data"].get("bytes").is_none());
        assert_eq!(event["type"], "kailo.component.knowledge.answer");
    }

    #[test]
    fn meters_belong_to_one_category_and_quota_item() {
        for meter in &COMPONENT_METERS {
            let feature = feature_of(meter).expect("quota item");
            assert_eq!(feature.meter, meter.meter);
            assert_eq!(feature.member_limit, meter.member);
            let registered = tenant_quota::PLATFORM_METERS
                .iter()
                .find(|m| m.key == meter.meter)
                .expect("platform meter");
            assert_eq!(registered.event_type, meter.event_type);
        }
        let categories: Vec<&str> = COMPONENT_METERS.iter().map(|m| m.category).collect();
        assert_eq!(categories, vec!["knowledge", "data_query", "file_storage"]);
    }

    #[test]
    fn decisions_follow_tenant_then_member() {
        let fact = |exhausted, limit, used| QuotaFact {
            tenant_exhausted: exhausted,
            member_limit: limit,
            member_used: used,
            reset_at: None,
        };
        use ComponentUsageDecision as D;
        assert_eq!(fact(false, None, Some(9.0)).decision(), D::Allowed);
        assert_eq!(fact(false, Some(2), Some(1.0)).decision(), D::Allowed);
        assert_eq!(
            fact(false, Some(2), Some(2.0)).decision(),
            D::MemberQuotaExhausted
        );
        assert_eq!(
            fact(false, Some(0), Some(0.0)).decision(),
            D::MemberQuotaExhausted
        );
        assert_eq!(
            fact(true, Some(2), Some(0.0)).decision(),
            D::TenantQuotaExhausted
        );
        assert_eq!(
            fact(true, None, None).member_state(),
            MemberUsageState::TenantExhausted
        );
        assert_eq!(
            fact(false, Some(1), Some(1.0)).member_state(),
            MemberUsageState::MemberLimitReached
        );
    }

    #[test]
    fn member_rows_must_be_the_member_and_native_decimals() {
        let me = "11111111-1111-1111-1111-111111111111";
        let rows = vec![
            (me.to_owned(), "2".to_owned()),
            (me.to_owned(), "1.5".to_owned()),
        ];
        assert_eq!(sum_rows(&rows, Some(me)).ok(), Some(3.5));
        let other = vec![("someone".to_owned(), "1".to_owned())];
        assert!(sum_rows(&other, Some(me)).is_err());
        let bad = vec![(me.to_owned(), "x".to_owned())];
        assert!(sum_rows(&bad, Some(me)).is_err());
        assert_eq!(sum_rows(&[], Some(me)).ok(), Some(0.0));
    }

    #[test]
    fn component_view_never_misattributes_rows() {
        let binding = Uuid::new_v4();
        let workspace = Uuid::new_v4();
        let mut known = BTreeMap::new();
        known.insert(
            binding.to_string(),
            (Some(workspace), Some("knowledge".to_owned())),
        );
        let rows = vec![(binding.to_string(), "7".to_owned())];
        let view = component_meter_view("knowledge_answer_count", "count".into(), &rows, &known);
        assert_eq!(view.state, MeterUsageState::Committed);
        assert_eq!(
            view.bindings[0].native_page_category,
            Some(NativePageCategory::Knowledge)
        );
        assert_eq!(view.bindings[0].workspace_id, Some(workspace.to_string()));
        assert_eq!(view.bindings[0].quantity, "7");
        let foreign = vec![(Uuid::new_v4().to_string(), "1".to_owned())];
        let view = component_meter_view("knowledge_answer_count", "count".into(), &foreign, &known);
        assert_eq!(view.state, MeterUsageState::Unavailable);
        assert!(view.bindings.is_empty());
        let empty = component_meter_view("data_query_count", "count".into(), &[], &known);
        assert_eq!(empty.state, MeterUsageState::NoCommittedUsage);
    }

    #[test]
    fn model_call_check_maps_native_answers() {
        assert!(model_check_result(Ok(true)).is_ok());
        let exhausted = model_check_result(Ok(false))
            .err()
            .map(|r| r.class_status().1);
        assert_eq!(exhausted, Some(StatusCode::TOO_MANY_REQUESTS));
        assert!(matches!(
            model_check_result(Err(openmeter::Error::Unknown)),
            Err(Refusal::Unavailable(_))
        ));
        assert!(matches!(
            model_check_result(Err(openmeter::Error::Precondition)),
            Err(Refusal::Precondition(ReasonCode::BindingNotActive))
        ));
    }

    #[test]
    fn rate_window_is_per_binding() {
        let now = Instant::now();
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        assert!(admit_rate(a, now, 2));
        assert!(admit_rate(a, now, 2));
        assert!(!admit_rate(a, now, 2));
        assert!(admit_rate(b, now, 2));
    }
}
