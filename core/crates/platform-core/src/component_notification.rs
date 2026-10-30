//! DD-138(4), `.design/03` ComponentNotification, `.design/07` §4.8.3: an
//! embedded component's notification for one Kailo member enters the Kailo
//! inbox. Components never keep their own notification centre, bell or e-mail
//! notifications in Kailo mode; they deliver here instead.
//!
//! Delivery is a Core service-listener write with the member directory's
//! service identity (the binding's own directory client, 07 §4.7.4). It is not
//! an ActionExecution and grants nothing: the recipient (and actor) must
//! already be in the binding's directory scope, the link only resolves inside
//! the component's page origin, and the component still decides with its own
//! ACL what the opened page shows. Core is the only authority; there is no
//! Relay projection. The inbox reads through the BFF and only lists items of
//! bindings that are still ACTIVE and still discoverable by the reader.

use std::collections::{BTreeSet, HashSet};

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header::CACHE_CONTROL, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, SecondsFormat, Utc};
use contracts::ReasonCode;
use serde_json::{json, Value};
use sqlx::PgConnection;
use uuid::Uuid;

use crate::{
    bff::{resolve_execution_context, BffState, ExecutionContext},
    governance::Refusal,
    service_api::ServiceState,
};

const BODY_MAX_BYTES: usize = 16 * 1024;
const KEY_MAX: usize = 128;
const TITLE_MAX: usize = 120;
const SUMMARY_MAX: usize = 280;
const PATH_MAX: usize = 1024;
const FUTURE_SKEW_SECONDS: i64 = 300;
/// 07 §4.8.3: items are kept 90 days after receipt.
pub(crate) const RETENTION_DAYS: i32 = 90;
const DEFAULT_RATE_PER_MINUTE: i64 = 600;
const PAGE_DEFAULT: i64 = 50;
const PAGE_MAX: i64 = 100;
const READ_MAX: usize = 100;
/// Query names that would put a credential into a link (07 §4.8.3).
const CREDENTIAL_QUERY: [&str; 11] = [
    "token",
    "access_token",
    "id_token",
    "refresh_token",
    "code",
    "secret",
    "password",
    "api_key",
    "key",
    "signature",
    "sig",
];

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

fn denied() -> Refusal {
    Refusal::Denied(ReasonCode::PermissionDenied)
}

fn unavailable(what: &str) -> Refusal {
    Refusal::Unavailable(format!("component notification: {what}"))
}

/// The service listener's closed answers: malformed input is a plain 400
/// (07 §4.8.3), everything else keeps the governance error body.
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

/// `[A-Za-z0-9._:-]{1,128}`, unique per binding.
pub(crate) fn idempotency_key(value: &str) -> bool {
    (1..=KEY_MAX).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b':' | b'-'))
}

/// One localized text: 1..=max characters, not blank, no control character.
fn text_ok(value: &str, max: usize) -> bool {
    let count = value.chars().count();
    (1..=max).contains(&count) && !value.trim().is_empty() && !value.chars().any(char::is_control)
}

fn localized_ok(value: &contracts::ComponentText, max: usize) -> bool {
    text_ok(&value.zh_cn, max) && text_ok(&value.en, max)
}

/// A path inside the component page origin (07 §4.8.3): exactly one leading
/// slash, no backslash, whitespace or control character, stays on the origin
/// it is resolved against, and names no credential-like query parameter.
pub(crate) fn component_path(path: &str) -> bool {
    if path.is_empty()
        || path.len() > PATH_MAX
        || !path.starts_with('/')
        || path.starts_with("//")
        || path
            .chars()
            .any(|c| c == '\\' || c.is_whitespace() || c.is_control())
    {
        return false;
    }
    let Ok(base) = reqwest::Url::parse("https://component.invalid/") else {
        return false;
    };
    let Ok(url) = base.join(path) else {
        return false;
    };
    url.origin() == base.origin()
        && url.username().is_empty()
        && url.password().is_none()
        && !url
            .query_pairs()
            .any(|(name, _)| CREDENTIAL_QUERY.contains(&name.to_ascii_lowercase().as_str()))
}

/// A validated delivery, ready to store.
#[derive(Debug, PartialEq)]
pub(crate) struct Delivery {
    pub(crate) value: Value,
    pub(crate) typed: contracts::ComponentNotificationDelivery,
    pub(crate) digest: String,
    pub(crate) occurred_at: DateTime<Utc>,
}

/// Shape and value rules of `ComponentNotificationDelivery`; unknown fields
/// are refused by comparing the typed round trip with the received value.
pub(crate) fn parse(body: &[u8], now: DateTime<Utc>) -> Result<Delivery, Refusal> {
    if body.len() > BODY_MAX_BYTES {
        return Err(invalid());
    }
    let value: Value = serde_json::from_slice(body).map_err(|_| invalid())?;
    let typed: contracts::ComponentNotificationDelivery =
        serde_json::from_value(value.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(&typed).map_err(|_| invalid())? != value {
        return Err(invalid());
    }
    let person_ok = |person: &contracts::ComponentPersonRef| {
        (1..=1024).contains(&person.issuer.len())
            && (1..=255).contains(&person.subject.len())
            && !person.issuer.chars().any(char::is_control)
            && !person.subject.chars().any(char::is_control)
    };
    if !idempotency_key(&typed.idempotency_key)
        || !person_ok(&typed.recipient)
        || typed.actor.as_ref().is_some_and(|actor| {
            !person_ok(actor)
                || (actor.issuer == typed.recipient.issuer
                    && actor.subject == typed.recipient.subject)
        })
        || !localized_ok(&typed.title, TITLE_MAX)
        || typed
            .summary
            .as_ref()
            .is_some_and(|summary| !localized_ok(summary, SUMMARY_MAX))
        || !component_path(&typed.path)
    {
        return Err(invalid());
    }
    let occurred_at = match typed.occurred_at.as_deref() {
        None => now,
        Some(raw) => {
            let at = DateTime::parse_from_rfc3339(raw)
                .map_err(|_| invalid())?
                .with_timezone(&Utc);
            if at > now + chrono::Duration::seconds(FUTURE_SKEW_SECONDS) {
                return Err(invalid());
            }
            at
        }
    };
    Ok(Delivery {
        digest: collab_bridge::limits::canonical_digest(&value),
        value,
        typed,
        occurred_at,
    })
}

fn category_wire(category: &contracts::ComponentNotificationCategory) -> String {
    crate::governance::wire(category)
}

/// `issuer`+`subject` → the ACTIVE HUMAN Principal of this Tenant (ACTIVE
/// ExternalIdentity, HumanIdentity and TenantMembership), the directory scope
/// of 07 §4.7.4 before the Workspace `discover` check.
pub(crate) async fn member(
    conn: &mut PgConnection,
    tenant: Uuid,
    person: &contracts::ComponentPersonRef,
) -> Result<Option<Uuid>, Refusal> {
    Ok(sqlx::query_scalar(
        "select p.id from identity.external_identity ei
         join identity.human_identity hi on hi.id=ei.human_identity_id and hi.status='ACTIVE'
         join identity.tenant_membership tm on tm.human_identity_id=hi.id
           and tm.tenant_id=$1 and tm.state='ACTIVE'
         join identity.principal p on p.id=tm.tenant_principal_id
           and p.tenant_id=$1 and p.kind='HUMAN' and p.status='ACTIVE'
         where ei.issuer=$2 and ei.subject=$3 and ei.status='ACTIVE'",
    )
    .bind(tenant)
    .bind(&person.issuer)
    .bind(&person.subject)
    .fetch_optional(&mut *conn)
    .await?)
}

fn rate_per_minute() -> i64 {
    std::env::var("COMPONENT_NOTIFICATION_RATE_PER_MINUTE")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|v| (1..=100_000).contains(v))
        .unwrap_or(DEFAULT_RATE_PER_MINUTE)
}

/// Per-binding serialisation of idempotency and the rate window.
pub(crate) fn binding_lock(binding: Uuid) -> i64 {
    let bytes = binding.as_bytes();
    i64::from_be_bytes([
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
    ])
}

/// `POST /service/v1/component-notifications/bindings/{binding}/notifications`.
pub(crate) async fn deliver(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    Path(binding): Path<Uuid>,
    body: Bytes,
) -> Response {
    match store(&state, &headers, binding, &body).await {
        Ok((receipt, created, category)) => {
            tracing::info!(%binding, category = %category, duplicate = !created, "组件通知已接收");
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
            tracing::info!(%binding, reason = ?error.reason(), "组件通知投递被拒绝或不可用");
            respond(&error)
        }
    }
}

async fn store(
    state: &ServiceState,
    headers: &HeaderMap,
    binding: Uuid,
    body: &[u8],
) -> Result<(Value, bool, String), Refusal> {
    let header = crate::component_directory::bearer(headers)?;
    let core_client = std::env::var("OIDC_SERVICE_CLIENT_ID").ok();

    // Who is calling comes first: an unauthenticated caller learns nothing
    // about the validation rules or the recipients.
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
    if entry.manifest["frontendPresentationContract"]["integrationMode"] != "KAILO_EMBED" {
        return Err(denied());
    }
    let delivery = parse(body, Utc::now())?;
    let recipient = member(&mut tx, entry.tenant_id, &delivery.typed.recipient)
        .await?
        .ok_or_else(denied)?;
    let actor = match &delivery.typed.actor {
        Some(actor) => Some(
            member(&mut tx, entry.tenant_id, actor)
                .await?
                .filter(|actor| *actor != recipient)
                .ok_or_else(denied)?,
        ),
        None => None,
    };
    tx.commit().await?;

    // Workspace binding: only people who can discover that Workspace are in
    // the directory scope (SpiceDB, fully consistent). No lock is held here.
    if let Some(workspace) = entry.workspace_id {
        let workspace = workspace.to_string();
        let principals: Vec<String> = std::iter::once(recipient)
            .chain(actor)
            .map(|p| p.to_string())
            .collect();
        let items: Vec<crate::spicedb::BulkCheck<'_>> = principals
            .iter()
            .map(|principal| crate::spicedb::BulkCheck {
                object_type: "workspace",
                object_id: &workspace,
                permission: "discover",
                principal,
            })
            .collect();
        let allowed = state
            .governance
            .spicedb
            .check_bulk_principals(&items)
            .await
            .map_err(|_| unavailable("authorization"))?;
        if allowed.len() != items.len() || allowed.iter().any(|ok| !ok) {
            return Err(denied());
        }
    }

    let category = category_wire(&delivery.typed.category);
    let mut tx = state.pool.begin().await?;
    sqlx::query("select pg_advisory_xact_lock($1)")
        .bind(binding_lock(binding))
        .execute(&mut *tx)
        .await?;
    // The binding may have been disabled meanwhile: re-read it under the lock.
    let active: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.application_binding where id=$1 and state='ACTIVE')",
    )
    .bind(binding)
    .fetch_one(&mut *tx)
    .await?;
    if !active {
        return Err(denied());
    }
    let existing: Option<(Uuid, String)> = sqlx::query_as(
        "select id,content_digest from identity.component_notification
         where application_binding_id=$1 and idempotency_key=$2",
    )
    .bind(binding)
    .bind(&delivery.typed.idempotency_key)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some((id, digest)) = existing {
        tx.commit().await?;
        return if digest == delivery.digest {
            Ok((
                json!({"notificationId": id, "duplicate": true}),
                false,
                category,
            ))
        } else {
            Err(Refusal::Conflict(ReasonCode::IdempotencyKeyReused))
        };
    }
    let recent: i64 = sqlx::query_scalar(
        "select count(*) from identity.component_notification
         where application_binding_id=$1 and received_at > now() - interval '60 seconds'",
    )
    .bind(binding)
    .fetch_one(&mut *tx)
    .await?;
    if recent >= rate_per_minute() {
        return Err(Refusal::Limit(ReasonCode::RateLimited));
    }
    let id = Uuid::new_v4();
    let summary = delivery
        .typed
        .summary
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(|_| invalid())?;
    sqlx::query(
        "insert into identity.component_notification
           (id,tenant_id,application_binding_id,workspace_id,recipient_principal_id,actor_principal_id,
            idempotency_key,content_digest,category,title,summary,path,occurred_at)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    )
    .bind(id)
    .bind(entry.tenant_id)
    .bind(binding)
    .bind(entry.workspace_id)
    .bind(recipient)
    .bind(actor)
    .bind(&delivery.typed.idempotency_key)
    .bind(&delivery.digest)
    .bind(&category)
    .bind(serde_json::to_value(&delivery.typed.title).map_err(|_| invalid())?)
    .bind(summary)
    .bind(&delivery.typed.path)
    .bind(delivery.occurred_at)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    let receipt = json!({"notificationId": id, "duplicate": false});
    let typed: contracts::ComponentNotificationReceipt =
        serde_json::from_value(receipt.clone()).map_err(|_| unavailable("contract"))?;
    if serde_json::to_value(&typed).map_err(|_| unavailable("contract"))? != receipt {
        return Err(unavailable("contract"));
    }
    Ok((receipt, true, category))
}

// ---------------------------------------------------------------------------
// BFF: the reader's own inbox items
// ---------------------------------------------------------------------------

/// Bindings with items for this reader that are still ACTIVE and whose
/// Workspace (or Tenant) the reader can still discover, fully consistent.
async fn visible_bindings(state: &BffState, ctx: &ExecutionContext) -> Result<Vec<Uuid>, Refusal> {
    let rows: Vec<(Uuid, Option<Uuid>)> = sqlx::query_as(
        "select distinct n.application_binding_id,b.workspace_id
         from identity.component_notification n
         join catalog.application_binding b on b.id=n.application_binding_id
           and b.tenant_id=n.tenant_id and b.state='ACTIVE'
         where n.tenant_id=$1 and n.recipient_principal_id=$2
           and n.received_at > now() - make_interval(days => $3)",
    )
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .bind(RETENTION_DAYS)
    .fetch_all(&state.pool)
    .await?;
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let principal = ctx.tenant_principal_id.to_string();
    let mut allowed = Vec::new();
    if rows.iter().any(|(_, workspace)| workspace.is_none()) {
        let tenant = state
            .governance
            .spicedb
            .check(
                "tenant",
                &ctx.tenant_id.to_string(),
                "discover",
                &principal,
                crate::spicedb::Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| unavailable("authorization"))?;
        if tenant.allowed {
            allowed.extend(
                rows.iter()
                    .filter(|(_, workspace)| workspace.is_none())
                    .map(|(binding, _)| *binding),
            );
        }
    }
    let workspaces: Vec<String> = rows
        .iter()
        .filter_map(|(_, workspace)| workspace.map(|w| w.to_string()))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    if !workspaces.is_empty() {
        let discoverable = state
            .governance
            .spicedb
            .check_bulk("workspace", &workspaces, "discover", &principal)
            .await
            .map_err(|_| unavailable("authorization"))?;
        allowed.extend(
            rows.iter()
                .filter(|(_, workspace)| {
                    workspace.is_some_and(|w| discoverable.contains(&w.to_string()))
                })
                .map(|(binding, _)| *binding),
        );
    }
    Ok(allowed)
}

#[derive(sqlx::FromRow)]
struct Row {
    id: Uuid,
    application_binding_id: Uuid,
    workspace_id: Option<Uuid>,
    category: String,
    title: Value,
    summary: Option<Value>,
    path: String,
    actor_principal_id: Option<Uuid>,
    actor_name: Option<String>,
    actor_subject: Option<String>,
    native_page_category: Option<String>,
    occurred_at: DateTime<Utc>,
    received_at: DateTime<Utc>,
    read_at: Option<DateTime<Utc>>,
}

fn rfc3339(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn view(row: Row) -> Value {
    let mut item = json!({
        "notificationId": row.id,
        "bindingId": row.application_binding_id,
        "category": row.category,
        "title": row.title,
        "path": row.path,
        "occurredAt": rfc3339(row.occurred_at),
        "receivedAt": rfc3339(row.received_at),
    });
    if let Some(workspace) = row.workspace_id {
        item["workspaceId"] = json!(workspace);
    }
    if let Some(category) = row.native_page_category {
        item["nativePageCategory"] = json!(category);
    }
    if let Some(summary) = row.summary {
        item["summary"] = summary;
    }
    if let Some(actor) = row.actor_principal_id {
        item["actorPrincipalId"] = json!(actor);
        if let Some(name) = row.actor_name.filter(|n| !n.trim().is_empty()) {
            item["actorDisplayName"] = json!(name.trim());
        }
        if let Some(picture) =
            crate::component_directory::member_picture(row.actor_subject.as_deref())
        {
            item["actorPicture"] = json!(picture);
        }
    }
    if let Some(read) = row.read_at {
        item["readAt"] = json!(rfc3339(read));
    }
    item
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PageQuery {
    limit: Option<i64>,
    cursor: Option<Uuid>,
}

/// `GET /api/v1/inbox/component-notifications`.
pub(crate) async fn list(
    State(state): State<BffState>,
    headers: HeaderMap,
    query: Result<Query<PageQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let Ok(Query(query)) = query else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let limit = query.limit.unwrap_or(PAGE_DEFAULT);
    if !(1..=PAGE_MAX).contains(&limit) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match page(&state, &ctx, limit, query.cursor).await {
        Ok(body) => ([(CACHE_CONTROL, "no-store")], Json(body)).into_response(),
        Err(error) => error.respond(None),
    }
}

async fn page(
    state: &BffState,
    ctx: &ExecutionContext,
    limit: i64,
    cursor: Option<Uuid>,
) -> Result<Value, Refusal> {
    let bindings = visible_bindings(state, ctx).await?;
    if bindings.is_empty() {
        return Ok(json!({"items": [], "unreadCount": 0}));
    }
    let rows: Vec<Row> = sqlx::query_as(
        "select n.id,n.application_binding_id,n.workspace_id,n.category,n.title,n.summary,n.path,
           n.actor_principal_id,hi.display_name as actor_name,
           (select min(ei.subject) from identity.external_identity ei
             where ei.human_identity_id=hi.id and ei.status='ACTIVE') as actor_subject,
           r.manifest->'frontendDelivery'->>'nativePageCategory' as native_page_category,
           n.occurred_at,n.received_at,n.read_at
         from identity.component_notification n
         join catalog.application_binding b on b.id=n.application_binding_id
         join catalog.component_release r on r.id=b.component_release_id
         left join identity.tenant_membership tm on tm.tenant_principal_id=n.actor_principal_id
           and tm.tenant_id=n.tenant_id
         left join identity.human_identity hi on hi.id=tm.human_identity_id
         where n.tenant_id=$1 and n.recipient_principal_id=$2
           and n.application_binding_id=any($3)
           and n.received_at > now() - make_interval(days => $4)
           and ($5::uuid is null or (n.received_at,n.id) < (
             select c.received_at,c.id from identity.component_notification c
             where c.id=$5 and c.tenant_id=$1 and c.recipient_principal_id=$2))
         order by n.received_at desc,n.id desc
         limit $6",
    )
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .bind(&bindings)
    .bind(RETENTION_DAYS)
    .bind(cursor)
    .bind(limit + 1)
    .fetch_all(&state.pool)
    .await?;
    let unread: i64 = sqlx::query_scalar(
        "select count(*) from identity.component_notification
         where tenant_id=$1 and recipient_principal_id=$2 and read_at is null
           and application_binding_id=any($3)
           and received_at > now() - make_interval(days => $4)",
    )
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .bind(&bindings)
    .bind(RETENTION_DAYS)
    .fetch_one(&state.pool)
    .await?;
    let more = rows.len() as i64 > limit;
    let rows: Vec<Row> = rows.into_iter().take(limit as usize).collect();
    let next = rows.last().filter(|_| more).map(|row| row.id);
    let mut body = json!({
        "items": rows.into_iter().map(view).collect::<Vec<_>>(),
        "unreadCount": unread,
    });
    if let Some(next) = next {
        body["nextCursor"] = json!(next.to_string());
    }
    let typed: contracts::ComponentNotificationPage =
        serde_json::from_value(body.clone()).map_err(|_| unavailable("contract"))?;
    if serde_json::to_value(&typed).map_err(|_| unavailable("contract"))? != body {
        return Err(unavailable("contract"));
    }
    Ok(body)
}

/// `POST /api/v1/inbox/component-notifications/read`: the recipient's own
/// read marks (personal state like Channel read positions; no
/// ActionExecution). Unknown, foreign or invisible ids change nothing.
pub(crate) async fn mark_read(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: Result<
        Json<contracts::ComponentNotificationReadRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let Ok(Json(request)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let ids: Option<Vec<Uuid>> = request
        .notification_ids
        .iter()
        .map(|id| Uuid::parse_str(id).ok())
        .collect();
    let Some(ids) = ids.filter(|ids| {
        (1..=READ_MAX).contains(&ids.len()) && ids.iter().collect::<HashSet<_>>().len() == ids.len()
    }) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let result = sqlx::query(
        "update identity.component_notification set read_at=greatest(now(),received_at)
         where tenant_id=$1 and recipient_principal_id=$2 and id=any($3) and read_at is null",
    )
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .bind(&ids)
    .execute(&state.pool)
    .await;
    match result {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => Refusal::from(error).respond(None),
    }
}

/// 07 §4.8.3 retention: items older than 90 days leave the store. Called from
/// the publication reconciler tick, in bounded batches.
pub(crate) async fn sweep(pool: &sqlx::PgPool, batch: i64) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        "delete from identity.component_notification where id in (
           select id from identity.component_notification
           where received_at < now() - make_interval(days => $1)
           order by received_at limit $2)",
    )
    .bind(RETENTION_DAYS)
    .bind(batch)
    .execute(pool)
    .await?
    .rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    type Edit = Box<dyn Fn(&mut Value)>;

    /// The resolved link for a stored path against the page origin; `None` when it
    /// would leave that origin (the inbox then shows the item without opening it).
    fn resolve_in_origin(origin: &str, path: &str) -> Option<String> {
        if !component_path(path) {
            return None;
        }
        let base = reqwest::Url::parse(origin).ok()?;
        let url = base.join(path).ok()?;
        (url.origin() == base.origin()).then(|| url.to_string())
    }

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-23T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn body() -> Value {
        json!({
            "idempotencyKey": "cells.share.0123abcd",
            "recipient": {"issuer": "https://idp.test/realms/kailo", "subject": "sub-r"},
            "actor": {"issuer": "https://idp.test/realms/kailo", "subject": "sub-a"},
            "category": "SHARED",
            "title": {"ZH_CN": "Ada 与你分享了 报告.docx", "EN": "Ada shared report.docx with you"},
            "summary": {"ZH_CN": "位于 /项目", "EN": "In /Projects"},
            "path": "/ws-kailo/Projects/report.docx?open=1",
            "occurredAt": "2026-10-23T09:59:00Z",
        })
    }

    fn bytes(value: &Value) -> Vec<u8> {
        serde_json::to_vec(value).unwrap()
    }

    #[test]
    fn a_complete_delivery_parses_with_a_stable_digest() {
        let parsed = parse(&bytes(&body()), now()).unwrap();
        assert_eq!(
            parsed.digest,
            collab_bridge::limits::canonical_digest(&body())
        );
        assert_eq!(parsed.occurred_at.to_rfc3339(), "2026-10-23T09:59:00+00:00");
        // Key order on the wire does not change the digest.
        let reordered: Value =
            serde_json::from_str(&serde_json::to_string(&body()).unwrap()).unwrap();
        assert_eq!(
            parse(&bytes(&reordered), now()).unwrap().digest,
            parsed.digest
        );
        let mut minimal = body();
        let map = minimal.as_object_mut().unwrap();
        map.remove("actor");
        map.remove("summary");
        map.remove("occurredAt");
        let parsed = parse(&bytes(&minimal), now()).unwrap();
        assert_eq!(parsed.occurred_at, now());
    }

    #[test]
    fn every_out_of_contract_delivery_is_refused() {
        let cases: Vec<Edit> = vec![
            Box::new(|v: &mut Value| v["unknown"] = json!(1)),
            Box::new(|v: &mut Value| v["category"] = json!("INVITED")),
            Box::new(|v: &mut Value| v["idempotencyKey"] = json!("")),
            Box::new(|v: &mut Value| v["idempotencyKey"] = json!("a b")),
            Box::new(|v: &mut Value| v["idempotencyKey"] = json!("x".repeat(129))),
            Box::new(|v: &mut Value| v["title"] = json!({"ZH_CN": "只有中文"})),
            Box::new(|v: &mut Value| v["title"]["EN"] = json!("   ")),
            Box::new(|v: &mut Value| v["title"]["EN"] = json!("x".repeat(121))),
            Box::new(|v: &mut Value| v["title"]["ZH_CN"] = json!("line\nbreak")),
            Box::new(|v: &mut Value| v["summary"]["EN"] = json!("y".repeat(281))),
            Box::new(|v: &mut Value| v["title"]["FR"] = json!("Bonjour")),
            Box::new(|v: &mut Value| v["path"] = json!("https://evil.test/x")),
            Box::new(|v: &mut Value| v["path"] = json!("//evil.test/x")),
            Box::new(|v: &mut Value| v["path"] = json!("relative/x")),
            Box::new(|v: &mut Value| v["path"] = json!("/a\\b")),
            Box::new(|v: &mut Value| v["path"] = json!("/a b")),
            Box::new(|v: &mut Value| v["path"] = json!("/x?access_token=abc")),
            Box::new(|v: &mut Value| v["path"] = json!("/x?Token=abc")),
            Box::new(|v: &mut Value| v["path"] = json!("/x?a=1&SIG=2")),
            Box::new(|v: &mut Value| v["path"] = json!(format!("/{}", "p".repeat(1024)))),
            Box::new(|v: &mut Value| v["occurredAt"] = json!("2026-10-23T10:06:00Z")),
            Box::new(|v: &mut Value| v["occurredAt"] = json!("yesterday")),
            Box::new(|v: &mut Value| v["actor"] = v["recipient"].clone()),
            Box::new(|v: &mut Value| v["recipient"]["subject"] = json!("")),
            Box::new(|v: &mut Value| v["recipient"]["extra"] = json!("x")),
        ];
        for (index, edit) in cases.iter().enumerate() {
            let mut value = body();
            edit(&mut value);
            assert!(
                parse(&bytes(&value), now()).is_err(),
                "case {index} accepted: {value}"
            );
        }
        assert!(parse(b"not json", now()).is_err());
        assert!(parse(&vec![b' '; BODY_MAX_BYTES + 1], now()).is_err());
    }

    #[test]
    fn paths_stay_inside_the_component_origin() {
        for ok in [
            "/",
            "/ws-kailo/Projects/report.docx",
            "/platform/knowledge-bases/42?tab=docs#top",
            "/home/7f3c?open=thread",
            "/%E9%A1%B9%E7%9B%AE",
        ] {
            assert!(component_path(ok), "refused {ok}");
            assert_eq!(
                resolve_in_origin("https://files.kailo.test", ok)
                    .map(|url| url.starts_with("https://files.kailo.test/")),
                Some(true)
            );
        }
        for bad in [
            "",
            "x",
            "//other.test",
            "/\\other.test",
            "/a\tb",
            "/a\u{7f}",
            "/?code=1",
            "/?password=1",
            "/?api_key=1",
        ] {
            assert!(!component_path(bad), "accepted {bad:?}");
            assert_eq!(resolve_in_origin("https://files.kailo.test", bad), None);
        }
    }

    #[test]
    fn idempotency_keys_follow_the_wire_rule() {
        assert!(idempotency_key("cells.share:abc-DEF_09"));
        assert!(idempotency_key(&"k".repeat(128)));
        for bad in ["", "a/b", "a b", "ä", "a\n"] {
            assert!(!idempotency_key(bad), "accepted {bad:?}");
        }
    }

    #[test]
    fn the_rate_limit_is_a_bounded_deployment_value() {
        std::env::remove_var("COMPONENT_NOTIFICATION_RATE_PER_MINUTE");
        assert_eq!(rate_per_minute(), DEFAULT_RATE_PER_MINUTE);
    }

    #[test]
    fn views_carry_no_component_identity_and_optional_fields_are_omitted() {
        let row = Row {
            id: Uuid::nil(),
            application_binding_id: Uuid::nil(),
            workspace_id: None,
            category: "MENTIONED".into(),
            title: json!({"ZH_CN": "提及", "EN": "Mention"}),
            summary: None,
            path: "/x".into(),
            actor_principal_id: None,
            actor_name: Some("ignored without actor".into()),
            actor_subject: None,
            native_page_category: Some("file_storage".into()),
            occurred_at: now(),
            received_at: now(),
            read_at: None,
        };
        let value = view(row);
        let typed: contracts::ComponentNotificationView =
            serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(typed).unwrap(), value);
        for absent in [
            "summary",
            "actorPrincipalId",
            "actorDisplayName",
            "readAt",
            "workspaceId",
        ] {
            assert!(value.get(absent).is_none(), "{absent} present");
        }
        let text = value.to_string();
        for forbidden in ["componentTypeKey", "cells", "weknora", "wren", "token"] {
            assert!(!text.contains(forbidden), "{forbidden} leaked");
        }
        assert_eq!(value["receivedAt"], "2026-10-23T10:00:00.000Z");
    }

    /// The database half of V-SCN-227 against a disposable migrated database:
    /// idempotency, actor/recipient guard, retention sweep and the reader's
    /// own read marks.
    #[tokio::test]
    #[ignore = "requires COMPONENT_NOTIFICATION_TEST_DATABASE_URL pointing at a disposable migrated database"]
    async fn storage_constraints_and_retention() {
        use sqlx::Connection;
        let url = std::env::var("COMPONENT_NOTIFICATION_TEST_DATABASE_URL")
            .expect("isolated database URL");
        let mut conn = sqlx::PgConnection::connect(&url).await.unwrap();
        let mut tx = conn.begin().await.unwrap();
        let tenant = Uuid::new_v4();
        sqlx::query("insert into identity.tenant(id,slug,name,state) values($1,$2,'Notify fixture','ACTIVE')")
            .bind(tenant).bind(tenant.to_string()).execute(&mut *tx).await.unwrap();
        let provider = Uuid::new_v4();
        let issuer = format!("urn:fixture:{provider}");
        sqlx::query("insert into identity.identity_provider(id,issuer,client_id,claim_mapping_version,status) values($1,$2,'fixture-notify',1,'ACTIVE')")
            .bind(provider).bind(&issuer).execute(&mut *tx).await.unwrap();
        let mut people = Vec::new();
        for _ in 0..2 {
            let (human, principal) = (Uuid::new_v4(), Uuid::new_v4());
            sqlx::query("insert into identity.human_identity(id,display_name,status) values($1,'Fixture Person','ACTIVE')")
                .bind(human).execute(&mut *tx).await.unwrap();
            sqlx::query("insert into identity.external_identity(id,provider_id,issuer,subject,human_identity_id,status) values($1,$2,$3,$4,$5,'ACTIVE')")
                .bind(Uuid::new_v4()).bind(provider).bind(&issuer).bind(human.to_string()).bind(human)
                .execute(&mut *tx).await.unwrap();
            sqlx::query("insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'HUMAN','ACTIVE')")
                .bind(principal).bind(tenant).execute(&mut *tx).await.unwrap();
            sqlx::query("insert into identity.tenant_membership(id,tenant_id,human_identity_id,tenant_principal_id,state) values($1,$2,$3,$4,'ACTIVE')")
                .bind(Uuid::new_v4()).bind(tenant).bind(human).bind(principal)
                .execute(&mut *tx).await.unwrap();
            people.push((human, principal));
        }
        // member() resolves issuer+subject to the Tenant principal.
        let person = contracts::ComponentPersonRef {
            issuer: issuer.clone(),
            subject: people[0].0.to_string(),
        };
        assert_eq!(
            member(&mut tx, tenant, &person).await.unwrap(),
            Some(people[0].1)
        );
        let stranger = contracts::ComponentPersonRef {
            issuer: issuer.clone(),
            subject: "nobody".into(),
        };
        assert_eq!(member(&mut tx, tenant, &stranger).await.unwrap(), None);
        assert_eq!(
            member(&mut tx, Uuid::new_v4(), &person).await.unwrap(),
            None
        );

        // The table refuses a self-notifying actor and keeps one row per key.
        // A disposable database has no binding fixture to reference; the
        // binding foreign key is lifted inside this rolled-back transaction
        // only, so the remaining constraints are exercised on their own.
        sqlx::query(
            "alter table identity.component_notification
            drop constraint component_notification_application_binding_id_fkey",
        )
        .execute(&mut *tx)
        .await
        .unwrap();
        let binding = Uuid::new_v4();
        let insert = |key: &'static str, actor: Option<Uuid>, received: &'static str| {
            sqlx::query("insert into identity.component_notification
                (id,tenant_id,application_binding_id,recipient_principal_id,actor_principal_id,idempotency_key,
                 content_digest,category,title,path,occurred_at,received_at)
                values($1,$2,$3,$4,$5,$6,$7,'SHARED','{\"ZH_CN\":\"a\",\"EN\":\"a\"}'::jsonb,'/x',now(),$8::timestamptz)")
                .bind(Uuid::new_v4()).bind(tenant).bind(binding).bind(people[0].1).bind(actor).bind(key)
                .bind("0".repeat(64)).bind(received)
        };
        insert("k1", Some(people[1].1), "2026-10-23T00:00:00Z")
            .execute(&mut *tx)
            .await
            .unwrap();
        let mut sp = tx.begin().await.unwrap();
        assert!(insert("k1", None, "2026-10-23T00:00:00Z")
            .execute(&mut *sp)
            .await
            .is_err());
        sp.rollback().await.unwrap();
        let mut sp = tx.begin().await.unwrap();
        assert!(insert("k2", Some(people[0].1), "2026-10-23T00:00:00Z")
            .execute(&mut *sp)
            .await
            .is_err());
        sp.rollback().await.unwrap();
        insert("old", None, "2020-01-01T00:00:00Z")
            .execute(&mut *tx)
            .await
            .unwrap();
        let swept = sqlx::query(
            "delete from identity.component_notification where id in (
            select id from identity.component_notification where tenant_id=$1
              and received_at < now() - make_interval(days => $2))",
        )
        .bind(tenant)
        .bind(RETENTION_DAYS)
        .execute(&mut *tx)
        .await
        .unwrap()
        .rows_affected();
        assert_eq!(swept, 1);
        tx.rollback().await.unwrap();
    }
}
