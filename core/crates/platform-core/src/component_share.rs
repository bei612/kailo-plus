//! DD-164(4) (`.design/02`, `03` §3/§5, `07` §4.7.2/§4.7.4): Kailo is the only
//! authority for who may read or write a component's native object; the
//! component's native ACL is its projection.
//!
//! - A shared native object (Cells folder, WeKnora knowledge base) is a
//!   platform `component.shared_object` Resource on the NATIVE_PAGE binding,
//!   created by the first `component.share.set`. It never becomes a Tool,
//!   search or adapter target.
//! - The component names the object with a ComponentShareIntent (service
//!   listener, directory client identity). The intent grants nothing; reading
//!   it is only for its initiator in a current session.
//! - `component.share.set` (HUMAN, SYNC, EXPLICIT, no approval) replaces the
//!   object's reader/editor relationships. Its authority is here: the intent's
//!   initiator, plus fresh `share` once the Resource exists. The definition
//!   only fixes Tenant `discover`.
//! - Components read the grants in the member directory schema 2 and report
//!   ComponentDirectoryReceipt; the receipt never changes the directory.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{header::CACHE_CONTROL, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, SecondsFormat, Utc};
use contracts::{EvidenceKind, ReasonCode};
use serde_json::{json, Value};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use super::{audit, lock_execution, Definition, Execution, Governance, Params, Refusal, Target};
use crate::bff::{resolve_execution_context, BffState};
use crate::service_api::ServiceState;
use crate::spicedb::{Consistency, Relationship, RelationshipFilter, SpiceDb, Subject, Write};

pub(crate) const TYPE_KEY: &str = "component.shared_object";
pub(crate) const ACTION_KEY: &str = "component.share.set";
/// 07 §4.7.4: an intent is valid for ten minutes.
const INTENT_MINUTES: i64 = 10;
const MAX_GRANTS: usize = 100;
const MAX_NATIVE_ID: usize = 255;
const MAX_NAME: usize = 200;
const MAX_FAILURES: usize = 100;
const MAX_FAILURE_REF: usize = 64;
const READER: &str = "reader";
const EDITOR: &str = "editor";

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

fn denied() -> Refusal {
    Refusal::Denied(ReasonCode::PermissionDenied)
}

fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}

fn not_found() -> Refusal {
    Refusal::Precondition(ReasonCode::TargetNotFound)
}

fn unavailable(what: &str) -> Refusal {
    Refusal::Unavailable(format!("component share: {what}"))
}

/// DD-164(4)①: the shareable native type of a presentation category (phase 1).
pub(crate) fn native_type_for(category: &str) -> Option<&'static str> {
    match category {
        "file_storage" => Some("folder"),
        "knowledge" => Some("knowledge_base"),
        _ => None,
    }
}

/// DD-164(4)③: subject kinds a native type accepts in phase 1.
pub(crate) fn allowed_subjects(native_type: &str) -> &'static [Kind] {
    match native_type {
        "folder" => &[Kind::Principal, Kind::Workspace, Kind::Tenant],
        "knowledge_base" => &[Kind::Workspace, Kind::Tenant],
        _ => &[],
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum Kind {
    Principal,
    Tenant,
    Workspace,
}

impl Kind {
    fn wire(self) -> &'static str {
        match self {
            Self::Principal => "PRINCIPAL",
            Self::Tenant => "TENANT",
            Self::Workspace => "WORKSPACE",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        Some(match text {
            "PRINCIPAL" => Self::Principal,
            "TENANT" => Self::Tenant,
            "WORKSPACE" => Self::Workspace,
            _ => return None,
        })
    }
}

/// One grant of a shared object. `id` is the principal or Workspace; none for
/// the Tenant's members.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct Grant {
    pub kind: Kind,
    pub id: Option<Uuid>,
    pub write: bool,
}

impl Grant {
    fn to_json(self) -> Value {
        let subject = match (self.kind, self.id) {
            (Kind::Principal, Some(id)) => json!({"kind": "PRINCIPAL", "principalId": id}),
            (Kind::Workspace, Some(id)) => json!({"kind": "WORKSPACE", "workspaceId": id}),
            _ => json!({"kind": self.kind.wire()}),
        };
        json!({"subject": subject, "access": if self.write { "WRITE" } else { "READ" }})
    }

    fn from_json(value: &Value) -> Option<Self> {
        let object = value.as_object()?;
        if object.len() != 2 {
            return None;
        }
        let subject = object.get("subject")?.as_object()?;
        let kind = Kind::parse(subject.get("kind")?.as_str()?)?;
        let write = match object.get("access")?.as_str()? {
            "READ" => false,
            "WRITE" => true,
            _ => return None,
        };
        let id = |key: &str| {
            subject
                .get(key)
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
                .filter(|id| !id.is_nil())
        };
        let (id, fields) = match kind {
            Kind::Principal => (Some(id("principalId")?), 2),
            Kind::Workspace => (Some(id("workspaceId")?), 2),
            Kind::Tenant => (None, 1),
        };
        if subject.len() != fields {
            return None;
        }
        Some(Self { kind, id, write })
    }

    /// The SpiceDB relationship that states this grant on `resource`.
    pub(crate) fn relationship(self, resource: Uuid, tenant: Uuid) -> Relationship {
        let subject = match (self.kind, self.id) {
            (Kind::Principal, Some(id)) => Subject::Principal(id.to_string()),
            (Kind::Workspace, Some(id)) => Subject::WorkspaceMembers(id.to_string()),
            _ => Subject::TenantMembers(tenant.to_string()),
        };
        Relationship {
            object_type: "resource".into(),
            object_id: resource.to_string(),
            relation: if self.write { EDITOR } else { READER }.into(),
            subject,
        }
    }
}

/// The frozen parameters of one `component.share.set`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ShareSet {
    pub intent: Uuid,
    pub resource_version: Option<i32>,
    pub grants: Vec<Grant>,
}

/// `ActionCommand.componentShareSet` → canonical parameters: subjects checked
/// for shape, no duplicate subject, at most 100, sorted so the
/// parameter hash does not depend on the order the dialog listed them.
pub(crate) fn normalize(input: &contracts::ComponentShareSet) -> Result<Value, Refusal> {
    let intent = Uuid::parse_str(&input.intent_id).map_err(|_| invalid())?;
    if intent.is_nil() {
        return Err(invalid());
    }
    let version = input
        .resource_version
        .map(|v| i32::try_from(v).ok().filter(|v| *v > 0).ok_or_else(invalid))
        .transpose()?;
    if input.grants.len() > MAX_GRANTS {
        return Err(invalid());
    }
    let mut grants = Vec::with_capacity(input.grants.len());
    let mut subjects = HashSet::new();
    for grant in &input.grants {
        let value = serde_json::to_value(grant).map_err(|_| invalid())?;
        let grant = Grant::from_json(&value).ok_or_else(invalid)?;
        if !subjects.insert((grant.kind, grant.id)) {
            return Err(invalid());
        }
        grants.push(grant);
    }
    grants.sort();
    let mut value = json!({
        "intentId": intent,
        "grants": grants.iter().map(|g| g.to_json()).collect::<Vec<_>>(),
    });
    if let Some(version) = version {
        value["resourceVersion"] = json!(version);
    }
    Ok(value)
}

pub(crate) fn share_set(p: &Params) -> Option<ShareSet> {
    let v = p.component_share_set.as_ref()?;
    let intent = Uuid::parse_str(v.get("intentId")?.as_str()?).ok()?;
    let resource_version = match v.get("resourceVersion") {
        None => None,
        Some(n) => Some(i32::try_from(n.as_i64()?).ok()?),
    };
    let grants = v
        .get("grants")?
        .as_array()?
        .iter()
        .map(Grant::from_json)
        .collect::<Option<Vec<_>>>()?;
    Some(ShareSet {
        intent,
        resource_version,
        grants,
    })
}

/// The parameters are a closed set: only `componentShareSet` and the explicit
/// confirmation of this one action.
pub(super) fn validate_params(p: &Params) -> Result<(), Refusal> {
    let allowed = Params {
        component_share_set: p.component_share_set.clone(),
        explicit_confirmation: p.explicit_confirmation,
        ..Params::default()
    };
    if *p == allowed && p.explicit_confirmation == Some(true) && share_set(p).is_some() {
        Ok(())
    } else {
        Err(invalid())
    }
}

/// The catalogue shape fixed by the migration; drift is BLOCKED.
fn check_definition(def: &Definition) -> Result<(), Refusal> {
    if def.action_key != ACTION_KEY
        || def.target_type != "RESOURCE"
        || def.workspace_rule != "TENANT_ONLY"
        || def.permission != "discover"
        || def.permission_object_type != "tenant"
        || def.execution_mode != "SYNC"
        || def.confirmation_mode != "EXPLICIT"
        || def.workflow_kind.is_some()
        || def.approval_policy_id.is_some()
        || def.quota_policy != "NONE"
        || !def.meters.is_empty()
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow, Debug, Clone)]
pub(crate) struct Intent {
    pub id: Uuid,
    pub application_binding_id: Uuid,
    pub binding_generation: i64,
    pub native_type: String,
    pub native_id: String,
    pub display_name: String,
    pub workspace_id: Option<Uuid>,
    pub initiator_principal_id: Uuid,
    pub expires_at: DateTime<Utc>,
    pub consumed_at: Option<DateTime<Utc>>,
}

impl Intent {
    fn open(&self, now: DateTime<Utc>) -> bool {
        self.consumed_at.is_none() && self.expires_at > now
    }
}

async fn intent(
    conn: &mut PgConnection,
    tenant: Uuid,
    id: Uuid,
    lock: bool,
) -> Result<Option<Intent>, sqlx::Error> {
    sqlx::query_as(&format!(
        "select id,application_binding_id,binding_generation,native_type,native_id,display_name,
           workspace_id,initiator_principal_id,expires_at,consumed_at
         from catalog.component_share_intent where id=$1 and tenant_id=$2{}",
        if lock { " for update" } else { "" }
    ))
    .bind(id)
    .bind(tenant)
    .fetch_optional(conn)
    .await
}

/// The NATIVE_PAGE binding an intent points at, as it is now.
#[derive(sqlx::FromRow, Debug, Clone)]
pub(crate) struct BindingNow {
    pub workspace_id: Option<Uuid>,
    pub generation: i64,
    pub component_type_key: String,
    pub category: Option<String>,
}

async fn binding_now(
    conn: &mut PgConnection,
    tenant: Uuid,
    binding: Uuid,
) -> Result<Option<BindingNow>, sqlx::Error> {
    sqlx::query_as(
        "select b.workspace_id,b.active_projection_generation as generation,b.component_type_key,
           r.manifest#>>'{frontendDelivery,nativePageCategory}' as category
         from catalog.application_binding b
         join identity.tenant t on t.id=b.tenant_id and t.state='ACTIVE'
         join catalog.component_release r on r.id=b.component_release_id and r.status='APPROVED'
         join projection.application_runtime p on p.binding_id=b.id
           and p.generation=b.active_projection_generation and p.component_release_id=r.id
           and p.state='ACTIVE'
         left join identity.workspace w on w.id=b.workspace_id and w.tenant_id=b.tenant_id
         where b.id=$1 and b.tenant_id=$2 and b.state='ACTIVE' and b.active_projection_generation>0
           and r.manifest#>>'{frontendDelivery,mode}'='NATIVE_PAGE'
           and (b.workspace_id is null or w.state='ACTIVE')",
    )
    .bind(binding)
    .bind(tenant)
    .fetch_optional(conn)
    .await
}

/// The intent still points at the same binding generation and a native type
/// that binding's presentation category may share.
fn intent_matches(intent: &Intent, binding: &BindingNow) -> bool {
    binding.generation == intent.binding_generation
        && binding.category.as_deref().and_then(native_type_for)
            == Some(intent.native_type.as_str())
}

#[derive(sqlx::FromRow, Debug, Clone)]
pub(crate) struct Shared {
    pub id: Uuid,
    pub version: i32,
    pub owner_principal_id: Uuid,
    pub state: String,
    pub projection_action_execution_id: Option<Uuid>,
}

async fn shared(
    conn: &mut PgConnection,
    tenant: Uuid,
    binding: Uuid,
    native_type: &str,
    native_id: &str,
    lock: bool,
) -> Result<Option<Shared>, sqlx::Error> {
    sqlx::query_as(&format!(
        "select id,version,owner_principal_id,state,projection_action_execution_id
         from catalog.resource
         where tenant_id=$1 and application_binding_id=$2 and type_key=$3
           and native_type=$4 and native_id=$5{}",
        if lock { " for update" } else { "" }
    ))
    .bind(tenant)
    .bind(binding)
    .bind(TYPE_KEY)
    .bind(native_type)
    .bind(native_id)
    .fetch_optional(conn)
    .await
}

/// Reader/editor subjects of a shared object, read fully consistent; `true`
/// for editor. Object arrows (tenant, home_workspace) and the owner are not
/// grants and are left out.
pub(crate) async fn grants_of(
    spicedb: &SpiceDb,
    resource: Uuid,
    page: u32,
) -> Result<Vec<(Subject, bool)>, crate::spicedb::SpiceDbError> {
    let id = resource.to_string();
    let rows = spicedb
        .read(
            &RelationshipFilter {
                object_type: "resource",
                object_id: Some(&id),
                relation: None,
                subject_principal: None,
            },
            page,
        )
        .await?;
    Ok(rows
        .into_iter()
        .filter_map(|r| match r.relation.as_str() {
            READER => Some((r.subject, false)),
            EDITOR => Some((r.subject, true)),
            _ => None,
        })
        .collect())
}

/// The grants as the dialog shows them (owner excluded), editor winning.
fn view_grants(relationships: &[(Subject, bool)], owner: Uuid, tenant: Uuid) -> Vec<Grant> {
    let mut grants: BTreeMap<(Kind, Option<Uuid>), bool> = BTreeMap::new();
    for (subject, write) in relationships {
        let key = match subject {
            Subject::Principal(id) => match Uuid::parse_str(id) {
                Ok(p) if p != owner => (Kind::Principal, Some(p)),
                _ => continue,
            },
            Subject::WorkspaceMembers(id) => match Uuid::parse_str(id) {
                Ok(w) => (Kind::Workspace, Some(w)),
                Err(_) => continue,
            },
            Subject::TenantMembers(id) if *id == tenant.to_string() => (Kind::Tenant, None),
            Subject::TenantMembers(_) => continue,
        };
        *grants.entry(key).or_insert(false) |= *write;
    }
    grants
        .into_iter()
        .map(|((kind, id), write)| Grant { kind, id, write })
        .collect()
}

// ---------------------------------------------------------------------------
// Governance hooks
// ---------------------------------------------------------------------------

/// `resolve_target`: the existing Resource for the intent's object, or a new
/// id (version 0) before the first share. Tenant-only scope.
pub(super) async fn target(
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    def: &Definition,
    p: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    check_definition(def)?;
    let set = share_set(p).ok_or_else(invalid)?;
    let intent = intent(conn, tenant, set.intent, lock)
        .await?
        .filter(|i| i.initiator_principal_id == initiator)
        .ok_or_else(not_found)?;
    if !intent.open(Utc::now()) {
        return Err(conflict());
    }
    if binding_now(conn, tenant, intent.application_binding_id)
        .await?
        .filter(|b| intent_matches(&intent, b))
        .is_none()
    {
        return Err(conflict());
    }
    match shared(
        conn,
        tenant,
        intent.application_binding_id,
        &intent.native_type,
        &intent.native_id,
        lock,
    )
    .await?
    {
        Some(r) => {
            if r.state != "ACTIVE"
                || r.projection_action_execution_id.is_some()
                || set.resource_version != Some(r.version)
                || frozen.is_some_and(|f| f != r.id)
            {
                return Err(conflict());
            }
            Ok(Target {
                id: r.id,
                version: r.version,
                workspace_id: None,
            })
        }
        None => {
            if set.resource_version.is_some() {
                return Err(conflict());
            }
            Ok(Target {
                id: frozen.unwrap_or_else(Uuid::new_v4),
                version: 0,
                workspace_id: None,
            })
        }
    }
}

/// The share authority (DD-164(4)③): the intent's initiator, an ACTIVE HUMAN
/// member; subjects allowed for the native type, same Tenant and ACTIVE, never
/// the owner; fresh `share` once the Resource exists.
pub(super) async fn gate(
    g: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    p: &Params,
) -> Result<(), Refusal> {
    if !crate::agent_definition::active_owner(conn, tenant, initiator).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let set = share_set(p).ok_or_else(invalid)?;
    let intent = intent(conn, tenant, set.intent, false)
        .await?
        .filter(|i| i.initiator_principal_id == initiator)
        .ok_or_else(not_found)?;
    let binding = binding_now(conn, tenant, intent.application_binding_id)
        .await?
        .filter(|b| intent_matches(&intent, b))
        .ok_or_else(conflict)?;
    let existing = shared(
        conn,
        tenant,
        intent.application_binding_id,
        &intent.native_type,
        &intent.native_id,
        false,
    )
    .await?;
    let owner = existing
        .as_ref()
        .map(|r| r.owner_principal_id)
        .unwrap_or(initiator);
    subjects_admissible(
        conn,
        tenant,
        &intent.native_type,
        &binding,
        owner,
        &set.grants,
    )
    .await?;
    if let Some(r) = existing {
        let checked = g
            .spicedb
            .check(
                "resource",
                &r.id.to_string(),
                "share",
                &initiator.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|e| Refusal::Unavailable(e.to_string()))?;
        if !checked.allowed {
            return Err(denied());
        }
    }
    Ok(())
}

/// Phase 1 subject rules plus the binding scope: a Workspace binding's object
/// is shared only with people or that Workspace.
fn subjects_shape_ok(native_type: &str, binding_workspace: Option<Uuid>, grants: &[Grant]) -> bool {
    let allowed = allowed_subjects(native_type);
    grants.iter().all(|g| {
        allowed.contains(&g.kind)
            && match (binding_workspace, g.kind) {
                (Some(_), Kind::Tenant) => false,
                (Some(w), Kind::Workspace) => g.id == Some(w),
                _ => true,
            }
    })
}

async fn subjects_admissible(
    conn: &mut PgConnection,
    tenant: Uuid,
    native_type: &str,
    binding: &BindingNow,
    owner: Uuid,
    grants: &[Grant],
) -> Result<(), Refusal> {
    if !subjects_shape_ok(native_type, binding.workspace_id, grants) {
        return Err(invalid());
    }
    let principals: Vec<Uuid> = grants
        .iter()
        .filter(|g| g.kind == Kind::Principal)
        .filter_map(|g| g.id)
        .collect();
    if principals.contains(&owner) {
        return Err(invalid());
    }
    if !principals.is_empty() {
        let found: i64 = sqlx::query_scalar(
            "select count(distinct p.id) from identity.principal p
             join identity.tenant_membership tm on tm.tenant_principal_id=p.id
               and tm.tenant_id=$1 and tm.state='ACTIVE'
             join identity.human_identity hi on hi.id=tm.human_identity_id and hi.status='ACTIVE'
             where p.tenant_id=$1 and p.kind='HUMAN' and p.status='ACTIVE' and p.id=any($2)",
        )
        .bind(tenant)
        .bind(&principals)
        .fetch_one(&mut *conn)
        .await?;
        if usize::try_from(found).ok() != Some(principals.len()) {
            return Err(not_found());
        }
    }
    let workspaces: Vec<Uuid> = grants
        .iter()
        .filter(|g| g.kind == Kind::Workspace)
        .filter_map(|g| g.id)
        .collect();
    if !workspaces.is_empty() {
        let found: i64 = sqlx::query_scalar(
            "select count(*) from identity.workspace where tenant_id=$1 and state='ACTIVE' and id=any($2)",
        )
        .bind(tenant)
        .bind(&workspaces)
        .fetch_one(&mut *conn)
        .await?;
        if usize::try_from(found).ok() != Some(workspaces.len()) {
            return Err(not_found());
        }
    }
    Ok(())
}

/// Inside the admission transaction: consume the intent, then create the
/// Resource (first share) or fence and advance the existing one. The fence is
/// this ActionExecution until the dispatch has written and verified SpiceDB.
pub(super) async fn prewrite(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    p: &Params,
) -> Result<(), Refusal> {
    let set = share_set(p).ok_or_else(invalid)?;
    let intent = intent(tx, ae.tenant_id, set.intent, true)
        .await?
        .filter(|i| i.initiator_principal_id == ae.initiator_principal_id && i.open(Utc::now()))
        .ok_or_else(conflict)?;
    let binding = binding_now(tx, ae.tenant_id, intent.application_binding_id)
        .await?
        .filter(|b| intent_matches(&intent, b))
        .ok_or_else(conflict)?;
    let consumed = sqlx::query(
        "update catalog.component_share_intent set consumed_at=now(),consumed_by_action_execution_id=$2
         where id=$1 and consumed_at is null",
    )
    .bind(intent.id)
    .bind(ae.id)
    .execute(&mut **tx)
    .await?;
    if consumed.rows_affected() != 1 {
        return Err(conflict());
    }
    match ae.frozen_target_version() {
        Some(0) => {
            let inserted = sqlx::query(
                "insert into catalog.resource
                   (id,tenant_id,type_key,home_workspace_id,owner_principal_id,component_type_key,
                    application_binding_id,native_type,native_id,state,version,projection_action_execution_id)
                 values($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',1,$10)",
            )
            .bind(ae.target_id)
            .bind(ae.tenant_id)
            .bind(TYPE_KEY)
            .bind(intent.workspace_id.or(binding.workspace_id))
            .bind(ae.initiator_principal_id)
            .bind(&binding.component_type_key)
            .bind(intent.application_binding_id)
            .bind(&intent.native_type)
            .bind(&intent.native_id)
            .bind(ae.id)
            .execute(&mut **tx)
            .await;
            match inserted {
                Ok(_) => {}
                // Another first share of the same object won the race.
                Err(sqlx::Error::Database(e)) if e.code().as_deref() == Some("23505") => {
                    return Err(conflict())
                }
                Err(e) => return Err(e.into()),
            }
        }
        Some(version) => {
            let bumped = sqlx::query(
                "update catalog.resource set version=version+1,projection_action_execution_id=$4
                 where id=$1 and tenant_id=$2 and version=$3 and type_key=$5 and state='ACTIVE'
                   and projection_action_execution_id is null",
            )
            .bind(ae.target_id)
            .bind(ae.tenant_id)
            .bind(version)
            .bind(ae.id)
            .bind(TYPE_KEY)
            .execute(&mut **tx)
            .await?;
            if bumped.rows_affected() != 1 {
                return Err(conflict());
            }
        }
        None => return Err(conflict()),
    }
    Ok(())
}

async fn tenant_active(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query_scalar::<_, bool>(
        "select state='ACTIVE' from identity.tenant where id=$1 for update",
    )
    .bind(tenant)
    .fetch_optional(&mut **tx)
    .await?
    .unwrap_or(false))
}

/// The SYNC dispatch: persist the UNKNOWN intent first, then write SpiceDB
/// (first share: tenant/owner/home projection; always: the full reader/editor
/// set), read it back, clear the fence and record the outcome. A retry after
/// UNKNOWN rewrites the same frozen set idempotently.
pub(super) async fn dispatch(g: &Governance, id: Uuid, def: &Definition) -> Result<(), Refusal> {
    let mut tx = g.pool.begin().await?;
    let ae = lock_execution(&mut tx, id).await?;
    if ae.gate_state != "ALLOWED"
        || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
    {
        return Ok(());
    }
    let first = ae.dispatch_state == "NOT_DISPATCHED";
    if first {
        sqlx::query("update admission.action_execution set dispatch_state='UNKNOWN',updated_at=now() where id=$1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        audit(
            &mut tx,
            &ae,
            def,
            "share-dispatch-intent",
            "DISPATCH",
            "ALLOW",
            "DISPATCH_RESULT_UNKNOWN",
            None,
            Vec::new(),
        )
        .await?;
    }
    tx.commit().await?;

    let mut tx = g.pool.begin().await?;
    let ae = lock_execution(&mut tx, id).await?;
    if ae.gate_state != "ALLOWED" || ae.dispatch_state != "UNKNOWN" {
        return Ok(());
    }
    if !crate::roles::lock_tenant(&mut tx, ae.tenant_id).await? {
        return Err(conflict());
    }
    let active = tenant_active(&mut tx, ae.tenant_id).await?;
    let set = ae
        .params()
        .as_ref()
        .and_then(share_set)
        .ok_or_else(conflict)?;
    let created = ae.frozen_target_version() == Some(0);
    let resource: Option<(i32, Uuid, Option<Uuid>)> = sqlx::query_as(
        "select version,owner_principal_id,home_workspace_id from catalog.resource
         where id=$1 and tenant_id=$2 and type_key=$3 and state='ACTIVE'
           and projection_action_execution_id=$4 for update",
    )
    .bind(ae.target_id)
    .bind(ae.tenant_id)
    .bind(TYPE_KEY)
    .bind(ae.id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((_, owner, home)) = resource else {
        tx.commit().await?;
        return Err(conflict());
    };
    let fresh = if first && active {
        let scoped =
            crate::agent_definition::active_owner(&mut tx, ae.tenant_id, ae.initiator_principal_id)
                .await?;
        // An existing object still needs the initiator's `share` at dispatch time.
        let shares = created
            || g.spicedb
                .check(
                    "resource",
                    &ae.target_id.to_string(),
                    "share",
                    &ae.initiator_principal_id.to_string(),
                    Consistency::FullyConsistent,
                )
                .await
                .map_err(|e| Refusal::Unavailable(e.to_string()))?
                .allowed;
        scoped && shares
    } else {
        active
    };
    if !fresh {
        if first {
            // Certainly nothing written: release the fence (or drop the not yet
            // projected Resource) and record ABORTED with its DISPATCH audit.
            if created {
                sqlx::query("delete from catalog.resource where id=$1 and projection_action_execution_id=$2")
                    .bind(ae.target_id)
                    .bind(ae.id)
                    .execute(&mut *tx)
                    .await?;
            } else {
                sqlx::query("update catalog.resource set projection_action_execution_id=null where id=$1 and projection_action_execution_id=$2")
                    .bind(ae.target_id)
                    .bind(ae.id)
                    .execute(&mut *tx)
                    .await?;
            }
            super::record_dispatch(
                &mut tx,
                ae.id,
                def.audit_class(),
                Err(StatusCode::CONFLICT),
                Vec::new(),
            )
            .await?;
            audit(
                &mut tx,
                &ae,
                def,
                "share-outcome",
                "OUTCOME",
                "DENY",
                "NOT_APPLIED",
                None,
                Vec::new(),
            )
            .await?;
            tx.commit().await?;
            return Ok(());
        }
        tx.commit().await?;
        return Err(conflict());
    }

    let resource = ae.target_id.to_string();
    let tenant = ae.tenant_id.to_string();
    let owner_text = owner.to_string();
    if created {
        let home = home.map(|w| w.to_string());
        match g
            .spicedb
            .replace_resource_projection(
                &resource,
                &tenant,
                &owner_text,
                &owner_text,
                home.as_deref(),
            )
            .await
        {
            Ok(token) if !token.is_empty() => {}
            _ => {
                tx.commit().await?;
                return Err(unavailable("projection"));
            }
        }
    }
    let desired: Vec<Relationship> = set
        .grants
        .iter()
        .map(|g| g.relationship(ae.target_id, ae.tenant_id))
        .collect();
    let current = match grant_relationships(g, &resource).await {
        Ok(current) => current,
        Err(error) => {
            tx.commit().await?;
            return Err(error);
        }
    };
    let writes = grant_writes(&current, &desired);
    if !writes.is_empty() {
        match g.spicedb.write(&writes).await {
            Ok(token) if !token.is_empty() => {}
            _ => {
                tx.commit().await?;
                return Err(unavailable("grants"));
            }
        }
    }
    let observed = match grant_relationships(g, &resource).await {
        Ok(observed) => observed,
        Err(error) => {
            tx.commit().await?;
            return Err(error);
        }
    };
    let as_set = |rs: &[Relationship]| rs.iter().map(|r| r.to_string()).collect::<BTreeSet<_>>();
    if as_set(&observed) != as_set(&desired) {
        audit(
            &mut tx,
            &ae,
            def,
            "share-prior-unknown",
            "RECONCILIATION",
            "NONE",
            "DISPATCH_RESULT_UNKNOWN",
            None,
            Vec::new(),
        )
        .await?;
        tx.commit().await?;
        return Err(unavailable("grants read back"));
    }
    let proof = match g
        .spicedb
        .check(
            "resource",
            &resource,
            "share",
            &owner_text,
            Consistency::FullyConsistent,
        )
        .await
    {
        Ok(proof) if proof.allowed && !proof.zed_token.is_empty() => proof,
        _ => {
            tx.commit().await?;
            return Err(unavailable("owner projection"));
        }
    };
    let released = sqlx::query(
        "update catalog.resource set projection_action_execution_id=null
         where id=$1 and tenant_id=$2 and projection_action_execution_id=$3",
    )
    .bind(ae.target_id)
    .bind(ae.tenant_id)
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    if released.rows_affected() != 1 {
        return Err(conflict());
    }
    let mut evidence = vec![crate::audit::Evidence::new(
        EvidenceKind::SpicedbZedtoken,
        &proof.zed_token,
    )];
    evidence.push(crate::audit::Evidence::new(
        EvidenceKind::SpicedbRelationship,
        format!("resource:{resource}#owner@principal:{owner_text}"),
    ));
    evidence.extend(
        desired
            .iter()
            .map(|r| crate::audit::Evidence::new(EvidenceKind::SpicedbRelationship, r)),
    );
    let recorded =
        super::record_dispatch(&mut tx, ae.id, def.audit_class(), Ok(()), evidence.clone()).await?;
    if recorded.settled {
        audit(
            &mut tx,
            &ae,
            def,
            "share-outcome",
            "OUTCOME",
            "ALLOW",
            "COMPONENT_SHARE_SET",
            None,
            evidence,
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// The object's current reader/editor relationships.
async fn grant_relationships(g: &Governance, resource: &str) -> Result<Vec<Relationship>, Refusal> {
    Ok(g.spicedb
        .read(
            &RelationshipFilter {
                object_type: "resource",
                object_id: Some(resource),
                relation: None,
                subject_principal: None,
            },
            g.cfg.relationship_page,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()))?
        .into_iter()
        .filter(|r| matches!(r.relation.as_str(), READER | EDITOR))
        .collect())
}

/// Touch every desired grant, delete every other reader/editor grant.
fn grant_writes(current: &[Relationship], desired: &[Relationship]) -> Vec<(Write, Relationship)> {
    let mut writes: Vec<(Write, Relationship)> = desired
        .iter()
        .filter(|r| !current.contains(r))
        .map(|r| (Write::Touch, r.clone()))
        .collect();
    writes.extend(
        current
            .iter()
            .filter(|r| !desired.contains(r))
            .map(|r| (Write::Delete, r.clone())),
    );
    writes
}

// ---------------------------------------------------------------------------
// Service listener: intents and receipts (directory client identity)
// ---------------------------------------------------------------------------

/// Closed answers on the service listener: malformed input is a plain 400.
fn respond_service(error: &Refusal) -> Response {
    let mut response = error.respond(None);
    if matches!(error, Refusal::Precondition(ReasonCode::InvalidParameters)) {
        *response.status_mut() = StatusCode::BAD_REQUEST;
    }
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// Strict request decoding: the generated type plus a round trip, so unknown
/// fields are refused.
fn decode<T: serde::de::DeserializeOwned + serde::Serialize>(body: &[u8]) -> Result<T, Refusal> {
    let raw: Value = serde_json::from_slice(body).map_err(|_| invalid())?;
    let typed: T = serde_json::from_value(raw.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(&typed).map_err(|_| invalid())? != raw {
        return Err(invalid());
    }
    Ok(typed)
}

fn visible_text(value: &str, max: usize) -> bool {
    let count = value.chars().count();
    (1..=max).contains(&count) && !value.chars().any(|c| c.is_control() || c.is_whitespace())
}

fn display_text(value: &str, max: usize) -> bool {
    let count = value.chars().count();
    (1..=max).contains(&count)
        && value.trim() == value
        && !value.is_empty()
        && !value.chars().any(char::is_control)
}

/// Validated intent input, before any database read.
pub(crate) fn intent_input(
    request: &contracts::ComponentShareIntentRequest,
) -> Result<(String, Option<Uuid>), Refusal> {
    let native_type = serde_json::to_value(&request.native_type)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .ok_or_else(invalid)?;
    if !visible_text(&request.native_id, MAX_NATIVE_ID)
        || !display_text(&request.name, MAX_NAME)
        || request.initiator.issuer.is_empty()
        || request.initiator.subject.is_empty()
    {
        return Err(invalid());
    }
    let workspace = request
        .workspace_id
        .as_deref()
        .map(|w| Uuid::parse_str(w).map_err(|_| invalid()))
        .transpose()?;
    Ok((native_type, workspace))
}

/// `POST /service/v1/component-directory/bindings/{binding}/share-intents`.
pub(crate) async fn create_intent(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    Path(binding): Path<Uuid>,
    body: Bytes,
) -> Response {
    match store_intent(&state, &headers, binding, &body).await {
        Ok(created) => {
            tracing::info!(%binding, "组件分享意图已登记");
            (
                StatusCode::CREATED,
                [(CACHE_CONTROL, "no-store")],
                Json(created),
            )
                .into_response()
        }
        Err(error) => {
            tracing::info!(%binding, reason = ?error.reason(), "组件分享意图被拒绝或不可用");
            respond_service(&error)
        }
    }
}

async fn store_intent(
    state: &ServiceState,
    headers: &HeaderMap,
    binding: Uuid,
    body: &[u8],
) -> Result<Value, Refusal> {
    let header = crate::component_directory::bearer(headers)?;
    let core_client = std::env::var("OIDC_SERVICE_CLIENT_ID").ok();
    let mut tx = state.pool.begin().await?;
    let entry = crate::component_directory::authorize(
        state,
        &mut tx,
        header,
        binding,
        core_client.as_deref(),
    )
    .await?;
    let request: contracts::ComponentShareIntentRequest = decode(body)?;
    let (native_type, workspace) = intent_input(&request)?;
    let now_binding = binding_now(&mut tx, entry.tenant_id, binding)
        .await?
        .ok_or_else(denied)?;
    if now_binding.category.as_deref().and_then(native_type_for) != Some(native_type.as_str()) {
        return Err(invalid());
    }
    // The object lives in the binding's own Workspace when the binding has one.
    let workspace = match (entry.workspace_id, workspace) {
        (Some(scope), None) => Some(scope),
        (Some(scope), Some(w)) if w == scope => Some(scope),
        (Some(_), Some(_)) => return Err(denied()),
        (None, w) => w,
    };
    if let Some(workspace) = workspace {
        let active: bool = sqlx::query_scalar(
            "select exists(select 1 from identity.workspace where id=$1 and tenant_id=$2 and state='ACTIVE')",
        )
        .bind(workspace)
        .bind(entry.tenant_id)
        .fetch_one(&mut *tx)
        .await?;
        if !active {
            return Err(denied());
        }
    }
    let initiator: Option<Uuid> = sqlx::query_scalar(
        "select p.id from identity.external_identity ei
         join identity.human_identity hi on hi.id=ei.human_identity_id and hi.status='ACTIVE'
         join identity.tenant_membership tm on tm.human_identity_id=hi.id
           and tm.tenant_id=$1 and tm.state='ACTIVE'
         join identity.principal p on p.id=tm.tenant_principal_id
           and p.tenant_id=$1 and p.kind='HUMAN' and p.status='ACTIVE'
         where ei.issuer=$2 and ei.subject=$3 and ei.status='ACTIVE'",
    )
    .bind(entry.tenant_id)
    .bind(&request.initiator.issuer)
    .bind(&request.initiator.subject)
    .fetch_optional(&mut *tx)
    .await?;
    let initiator = initiator.ok_or_else(denied)?;
    // A Workspace binding's directory scope is that Workspace's `discover`.
    if let Some(scope) = entry.workspace_id {
        let checked = state
            .governance
            .spicedb
            .check(
                "workspace",
                &scope.to_string(),
                "discover",
                &initiator.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| unavailable("authorization"))?;
        if !checked.allowed {
            return Err(denied());
        }
    }
    sqlx::query("delete from catalog.component_share_intent where expires_at < now() - interval '1 day' and id in (
        select id from catalog.component_share_intent where expires_at < now() - interval '1 day' limit 100)")
        .execute(&mut *tx)
        .await?;
    let id = Uuid::new_v4();
    let expires_at: DateTime<Utc> = sqlx::query_scalar(
        "insert into catalog.component_share_intent
           (id,tenant_id,application_binding_id,binding_generation,native_type,native_id,display_name,
            workspace_id,initiator_principal_id,expires_at)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+make_interval(mins => $10::int))
         returning expires_at",
    )
    .bind(id)
    .bind(entry.tenant_id)
    .bind(binding)
    .bind(now_binding.generation)
    .bind(&native_type)
    .bind(&request.native_id)
    .bind(&request.name)
    .bind(workspace)
    .bind(initiator)
    .bind(INTENT_MINUTES as i32)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    let created = json!({"intentId": id, "expiresAt": rfc3339(expires_at)});
    let typed: contracts::ComponentShareIntentCreated =
        serde_json::from_value(created.clone()).map_err(|_| unavailable("contract"))?;
    if serde_json::to_value(&typed).map_err(|_| unavailable("contract"))? != created {
        return Err(unavailable("contract"));
    }
    Ok(created)
}

fn rfc3339(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Validated receipt input.
pub(crate) fn receipt_input(
    request: &contracts::ComponentDirectoryReceiptRequest,
) -> Result<DateTime<Utc>, Refusal> {
    let applied = DateTime::parse_from_rfc3339(&request.applied_at)
        .map_err(|_| invalid())?
        .with_timezone(&Utc);
    let version_ok = request.directory_version.len() == 64
        && request
            .directory_version
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    let failures_ok = request.failures.len() <= MAX_FAILURES
        && request.failures.iter().all(|f| {
            visible_text(&f.component_receipt_failure_ref, MAX_FAILURE_REF)
                && (1..=64).contains(&f.reason_code.len())
                && f.reason_code
                    .bytes()
                    .next()
                    .is_some_and(|b| b.is_ascii_uppercase())
                && f.reason_code
                    .bytes()
                    .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
        });
    if !matches!(request.schema, 1 | 2) || !version_ok || !failures_ok {
        return Err(invalid());
    }
    Ok(applied)
}

/// `PUT /service/v1/component-directory/bindings/{binding}/receipt`.
pub(crate) async fn put_receipt(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    Path(binding): Path<Uuid>,
    body: Bytes,
) -> Response {
    match store_receipt(&state, &headers, binding, &body).await {
        Ok(()) => {
            tracing::info!(%binding, "组件成员目录收敛回执已记录");
            (StatusCode::NO_CONTENT, [(CACHE_CONTROL, "no-store")]).into_response()
        }
        Err(error) => {
            tracing::info!(%binding, reason = ?error.reason(), "组件收敛回执被拒绝或不可用");
            respond_service(&error)
        }
    }
}

async fn store_receipt(
    state: &ServiceState,
    headers: &HeaderMap,
    binding: Uuid,
    body: &[u8],
) -> Result<(), Refusal> {
    let header = crate::component_directory::bearer(headers)?;
    let core_client = std::env::var("OIDC_SERVICE_CLIENT_ID").ok();
    let mut tx = state.pool.begin().await?;
    let entry = crate::component_directory::authorize(
        state,
        &mut tx,
        header,
        binding,
        core_client.as_deref(),
    )
    .await?;
    let request: contracts::ComponentDirectoryReceiptRequest = decode(body)?;
    let applied = receipt_input(&request)?;
    let outcome = serde_json::to_value(&request.outcome)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .ok_or_else(invalid)?;
    let failures = serde_json::to_value(&request.failures).map_err(|_| invalid())?;
    sqlx::query(
        "insert into catalog.component_directory_receipt
           (application_binding_id,tenant_id,receipt_schema,receipt_version,outcome,failures,applied_at,received_at)
         values($1,$2,$3,$4,$5,$6,$7,now())
         on conflict (application_binding_id) do update set
           receipt_schema=excluded.receipt_schema, receipt_version=excluded.receipt_version,
           outcome=excluded.outcome, failures=excluded.failures, applied_at=excluded.applied_at,
           received_at=now()",
    )
    .bind(binding)
    .bind(entry.tenant_id)
    .bind(i32::try_from(request.schema).map_err(|_| invalid())?)
    .bind(&request.directory_version)
    .bind(&outcome)
    .bind(failures)
    .bind(applied)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// BFF: the share dialog and the binding manager's receipt view
// ---------------------------------------------------------------------------

/// `GET /api/v1/component-shares/intents/{intent_id}`: only for the intent's
/// initiator in a current session; anything else is 404.
pub(crate) async fn intent_view(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    match view(&state, ctx.tenant_id, ctx.tenant_principal_id, id).await {
        Ok(Some(body)) => ([(CACHE_CONTROL, "no-store")], Json(body)).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, [(CACHE_CONTROL, "no-store")]).into_response(),
        Err(error) => error.respond(None),
    }
}

async fn view(
    state: &BffState,
    tenant: Uuid,
    principal: Uuid,
    id: Uuid,
) -> Result<Option<Value>, Refusal> {
    let mut conn = state.pool.acquire().await?;
    let Some(intent) = intent(&mut conn, tenant, id, false)
        .await?
        .filter(|i| i.initiator_principal_id == principal && i.open(Utc::now()))
    else {
        return Ok(None);
    };
    let Some(binding) = binding_now(&mut conn, tenant, intent.application_binding_id)
        .await?
        .filter(|b| intent_matches(&intent, b))
    else {
        return Ok(None);
    };
    let existing = shared(
        &mut conn,
        tenant,
        intent.application_binding_id,
        &intent.native_type,
        &intent.native_id,
        false,
    )
    .await?
    .filter(|r| r.state == "ACTIVE");
    drop(conn);
    let allowed: Vec<&str> = allowed_subjects(&intent.native_type)
        .iter()
        .filter(|kind| !(binding.workspace_id.is_some() && **kind == Kind::Tenant))
        .map(|kind| kind.wire())
        .collect();
    let mut body = json!({
        "intentId": intent.id,
        "bindingId": intent.application_binding_id,
        "nativePageCategory": binding.category,
        "nativeType": intent.native_type,
        "name": intent.display_name,
        "allowedSubjects": allowed,
        "grants": [],
        "canShare": true,
        "expiresAt": rfc3339(intent.expires_at),
    });
    if let Some(workspace) = intent.workspace_id.or(binding.workspace_id) {
        body["workspaceId"] = json!(workspace);
    }
    if let Some(r) = existing {
        let relationships = grants_of(
            &state.governance.spicedb,
            r.id,
            state.governance.cfg.relationship_page,
        )
        .await
        .map_err(|_| unavailable("authorization"))?;
        let checked = state
            .governance
            .spicedb
            .check(
                "resource",
                &r.id.to_string(),
                "share",
                &principal.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| unavailable("authorization"))?;
        body["resourceId"] = json!(r.id);
        body["resourceVersion"] = json!(r.version);
        body["ownerPrincipalId"] = json!(r.owner_principal_id);
        body["canShare"] = json!(checked.allowed);
        body["grants"] = Value::Array(
            view_grants(&relationships, r.owner_principal_id, tenant)
                .into_iter()
                .map(Grant::to_json)
                .collect(),
        );
    } else {
        body["ownerPrincipalId"] = json!(principal);
    }
    let typed: contracts::ComponentShareIntentView =
        serde_json::from_value(body.clone()).map_err(|_| unavailable("contract"))?;
    if serde_json::to_value(&typed).map_err(|_| unavailable("contract"))? != body {
        return Err(unavailable("contract"));
    }
    Ok(Some(body))
}

/// The deployment's component read interval (07 §4.7.4, default 60 s).
fn read_interval_seconds() -> i64 {
    std::env::var("COMPONENT_DIRECTORY_INTERVAL_SECONDS")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|v| (10..=3600).contains(v))
        .unwrap_or(60)
}

#[derive(sqlx::FromRow, Debug, Clone, Default)]
pub(crate) struct ReceiptRow {
    pub served_schema: Option<i32>,
    pub served_version: Option<String>,
    pub served_version_since: Option<DateTime<Utc>>,
    pub served_at: Option<DateTime<Utc>>,
    pub receipt_schema: Option<i32>,
    pub receipt_version: Option<String>,
    pub outcome: Option<String>,
    pub failures: Value,
    pub applied_at: Option<DateTime<Utc>>,
    pub received_at: Option<DateTime<Utc>>,
}

/// DD-164(4)⑥: compare the last receipt with what was last served.
pub(crate) fn receipt_state(
    row: Option<&ReceiptRow>,
    now: DateTime<Utc>,
    interval: i64,
) -> &'static str {
    let Some(row) = row else { return "NO_RECEIPT" };
    let Some(version) = row.receipt_version.as_deref() else {
        return "NO_RECEIPT";
    };
    if row.outcome.as_deref() == Some("FAILED") {
        return "FAILED";
    }
    let window = chrono::Duration::seconds(2 * interval);
    let (Some(served), Some(at), Some(since)) = (
        row.served_version.as_deref(),
        row.served_at,
        row.served_version_since,
    ) else {
        return "NOT_CONVERGED";
    };
    if now - at > window {
        return "NOT_CONVERGED";
    }
    if served == version && row.served_schema == row.receipt_schema {
        return "CONVERGED";
    }
    if now - since <= window {
        "PENDING"
    } else {
        "NOT_CONVERGED"
    }
}

/// `GET /api/v1/application-bindings/{id}/directory-receipt` (fresh binding `manage`).
pub(crate) async fn receipt_view(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    match receipt(&state, ctx.tenant_id, ctx.tenant_principal_id, id).await {
        Ok(body) => ([(CACHE_CONTROL, "no-store")], Json(body)).into_response(),
        Err(error) => error.respond(None),
    }
}

async fn receipt(
    state: &BffState,
    tenant: Uuid,
    principal: Uuid,
    id: Uuid,
) -> Result<Value, Refusal> {
    let scope: Option<Option<Uuid>> = sqlx::query_scalar(
        "select workspace_id from catalog.application_binding where id=$1 and tenant_id=$2 and state<>'DISABLED'",
    )
    .bind(id)
    .bind(tenant)
    .fetch_optional(&state.pool)
    .await?;
    let scope = scope.ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    let (object_type, object) = match scope {
        Some(w) => ("workspace", w),
        None => ("tenant", tenant),
    };
    let checked = state
        .governance
        .spicedb
        .check(
            object_type,
            &object.to_string(),
            "manage",
            &principal.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| unavailable("authorization"))?;
    if !checked.allowed {
        return Err(denied());
    }
    let row: Option<ReceiptRow> = sqlx::query_as(
        "select served_schema,served_version,served_version_since,served_at,receipt_schema,receipt_version,
           outcome,failures,applied_at,received_at
         from catalog.component_directory_receipt where application_binding_id=$1 and tenant_id=$2",
    )
    .bind(id)
    .bind(tenant)
    .fetch_optional(&state.pool)
    .await?;
    let state_text = receipt_state(row.as_ref(), Utc::now(), read_interval_seconds());
    let mut body = json!({"bindingId": id, "state": state_text});
    if let Some(row) = row.filter(|r| r.receipt_version.is_some()) {
        body["schema"] = json!(row.receipt_schema);
        body["receiptVersion"] = json!(row.receipt_version);
        if let Some(served) = &row.served_version {
            body["currentVersion"] = json!(served);
        }
        if let Some(at) = row.applied_at {
            body["appliedAt"] = json!(rfc3339(at));
        }
        if let Some(at) = row.received_at {
            body["receivedAt"] = json!(rfc3339(at));
        }
        body["failures"] = row.failures.clone();
    }
    let typed: contracts::ComponentDirectoryReceiptView =
        serde_json::from_value(body.clone()).map_err(|_| unavailable("contract"))?;
    if serde_json::to_value(&typed).map_err(|_| unavailable("contract"))? != body {
        return Err(unavailable("contract"));
    }
    Ok(body)
}

// ---------------------------------------------------------------------------
// Service listener: adoption of existing native shares (DD-164(4)⑧)
// ---------------------------------------------------------------------------

const ADOPT_ACTION: &str = "component.share.adopt";

/// Validated adoption grants: shape, no duplicate subject, at most 100, sorted.
pub(crate) fn adoption_grants(
    grants: &[contracts::ComponentShareGrant],
) -> Result<Vec<Grant>, Refusal> {
    if grants.len() > MAX_GRANTS {
        return Err(invalid());
    }
    let mut out = Vec::with_capacity(grants.len());
    let mut subjects = HashSet::new();
    for grant in grants {
        let value = serde_json::to_value(grant).map_err(|_| invalid())?;
        let grant = Grant::from_json(&value).ok_or_else(invalid)?;
        if !subjects.insert((grant.kind, grant.id)) {
            return Err(invalid());
        }
        out.push(grant);
    }
    out.sort();
    Ok(out)
}

fn adoption_answer(
    resource: Uuid,
    owner: Uuid,
    adopted: bool,
    grants: &[Grant],
) -> Result<Value, Refusal> {
    let body = json!({
        "resourceId": resource,
        "ownerPrincipalId": owner,
        "adopted": adopted,
        "grants": grants.iter().map(|g| g.to_json()).collect::<Vec<_>>(),
    });
    let typed: contracts::ComponentShareAdoptionResult =
        serde_json::from_value(body.clone()).map_err(|_| unavailable("contract"))?;
    if serde_json::to_value(&typed).map_err(|_| unavailable("contract"))? != body {
        return Err(unavailable("contract"));
    }
    Ok(body)
}

/// `POST /service/v1/component-directory/bindings/{binding}/share-adoptions`.
pub(crate) async fn adopt(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    Path(binding): Path<Uuid>,
    body: Bytes,
) -> Response {
    match store_adoption(&state, &headers, binding, &body).await {
        Ok(answer) => {
            tracing::info!(%binding, adopted = %answer["adopted"], "既有原生共享采纳已应答");
            (StatusCode::OK, [(CACHE_CONTROL, "no-store")], Json(answer)).into_response()
        }
        Err(error) => {
            tracing::info!(%binding, reason = ?error.reason(), "既有原生共享采纳被拒绝或不可用");
            respond_service(&error)
        }
    }
}

#[derive(sqlx::FromRow)]
struct Adoption {
    tenant_id: Uuid,
    owner_principal_id: Uuid,
    grants: Value,
    completed_at: Option<DateTime<Utc>>,
    home_workspace_id: Option<Uuid>,
    state: String,
    service_principal_id: Uuid,
    component_type_key: String,
}

async fn adoption(
    conn: &mut PgConnection,
    resource: Uuid,
) -> Result<Option<Adoption>, sqlx::Error> {
    sqlx::query_as(
        "select a.tenant_id,a.owner_principal_id,a.grants,a.completed_at,r.home_workspace_id,r.state,
           b.service_principal_id,b.component_type_key
         from catalog.component_share_adoption a
         join catalog.resource r on r.id=a.resource_id
         join catalog.application_binding b on b.id=a.application_binding_id and b.tenant_id=a.tenant_id
         where a.resource_id=$1",
    )
    .bind(resource)
    .fetch_optional(conn)
    .await
}

#[allow(clippy::too_many_arguments)]
fn adoption_audit<'a>(
    resource: Uuid,
    tenant: Uuid,
    stage: &str,
    event_type: &'a str,
    result_code: &'a str,
    owner: Uuid,
    service: Uuid,
    component_type_key: &'a str,
    parameter_hash: &'a str,
    evidence: Vec<crate::audit::Evidence>,
) -> crate::audit::AuditEntry<'a> {
    crate::audit::AuditEntry {
        event_key: format!("share-adopt:{resource}:{stage}"),
        tenant_id: Some(tenant),
        workspace_id: None,
        operation_id: resource,
        event_type,
        human_identity_id: None,
        initiator_principal_id: Some(owner),
        actor_principal_id: Some(service),
        action_key: ADOPT_ACTION,
        action_version: 1,
        component_type_key,
        target_type: Some("RESOURCE"),
        target_id: Some(resource),
        parameter_hash,
        decision: "ALLOW",
        result_code,
        result_exposure: "NONE",
        evidence_refs: evidence,
        correlation_id: resource,
    }
}

async fn store_adoption(
    state: &ServiceState,
    headers: &HeaderMap,
    binding: Uuid,
    body: &[u8],
) -> Result<Value, Refusal> {
    let header = crate::component_directory::bearer(headers)?;
    let core_client = std::env::var("OIDC_SERVICE_CLIENT_ID").ok();
    let mut tx = state.pool.begin().await?;
    let entry = crate::component_directory::authorize(
        state,
        &mut tx,
        header,
        binding,
        core_client.as_deref(),
    )
    .await?;
    let request: contracts::ComponentShareAdoptionRequest = decode(body)?;
    let native_type = serde_json::to_value(&request.native_type)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .ok_or_else(invalid)?;
    if !visible_text(&request.native_id, MAX_NATIVE_ID)
        || !display_text(&request.name, MAX_NAME)
        || request.owner.issuer.is_empty()
        || request.owner.subject.is_empty()
    {
        return Err(invalid());
    }
    let grants = adoption_grants(&request.grants)?;
    let now_binding = binding_now(&mut tx, entry.tenant_id, binding)
        .await?
        .ok_or_else(denied)?;
    if now_binding.category.as_deref().and_then(native_type_for) != Some(native_type.as_str()) {
        return Err(invalid());
    }
    let workspace = request
        .workspace_id
        .as_deref()
        .map(|w| Uuid::parse_str(w).map_err(|_| invalid()))
        .transpose()?;
    let workspace = match (entry.workspace_id, workspace) {
        (Some(scope), None) => Some(scope),
        (Some(scope), Some(w)) if w == scope => Some(scope),
        (Some(_), Some(_)) => return Err(denied()),
        (None, w) => w,
    };
    if let Some(workspace) = workspace {
        let active: bool = sqlx::query_scalar(
            "select exists(select 1 from identity.workspace where id=$1 and tenant_id=$2 and state='ACTIVE')",
        )
        .bind(workspace)
        .bind(entry.tenant_id)
        .fetch_one(&mut *tx)
        .await?;
        if !active {
            return Err(denied());
        }
    }
    let owner: Option<Uuid> = sqlx::query_scalar(
        "select p.id from identity.external_identity ei
         join identity.human_identity hi on hi.id=ei.human_identity_id and hi.status='ACTIVE'
         join identity.tenant_membership tm on tm.human_identity_id=hi.id
           and tm.tenant_id=$1 and tm.state='ACTIVE'
         join identity.principal p on p.id=tm.tenant_principal_id
           and p.tenant_id=$1 and p.kind='HUMAN' and p.status='ACTIVE'
         where ei.issuer=$2 and ei.subject=$3 and ei.status='ACTIVE'",
    )
    .bind(entry.tenant_id)
    .bind(&request.owner.issuer)
    .bind(&request.owner.subject)
    .fetch_optional(&mut *tx)
    .await?;
    let owner = owner.ok_or_else(denied)?;
    if let Some(scope) = entry.workspace_id {
        let checked = state
            .governance
            .spicedb
            .check(
                "workspace",
                &scope.to_string(),
                "discover",
                &owner.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| unavailable("authorization"))?;
        if !checked.allowed {
            return Err(denied());
        }
    }
    // Serialise adoptions of one native object; the unique (binding, type, id)
    // constraint is the backstop.
    sqlx::query("select pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!(
            "share-adopt:{binding}:{native_type}:{}",
            request.native_id
        ))
        .execute(&mut *tx)
        .await?;
    if let Some(existing) = shared(
        &mut tx,
        entry.tenant_id,
        binding,
        &native_type,
        &request.native_id,
        true,
    )
    .await?
    {
        let pending: Option<Option<DateTime<Utc>>> = sqlx::query_scalar(
            "select completed_at from catalog.component_share_adoption where resource_id=$1",
        )
        .bind(existing.id)
        .fetch_optional(&mut *tx)
        .await?;
        tx.commit().await?;
        return match (existing.state.as_str(), pending) {
            // An adoption that has not finished: finish it with its frozen grants.
            ("PROVISIONING", Some(None)) => finish_adoption(state, existing.id).await,
            ("ACTIVE", _) => {
                let relationships = grants_of(
                    &state.governance.spicedb,
                    existing.id,
                    state.governance.cfg.relationship_page,
                )
                .await
                .map_err(|_| unavailable("authorization"))?;
                let current =
                    view_grants(&relationships, existing.owner_principal_id, entry.tenant_id);
                adoption_answer(existing.id, existing.owner_principal_id, false, &current)
            }
            _ => Err(conflict()),
        };
    }
    subjects_admissible(
        &mut tx,
        entry.tenant_id,
        &native_type,
        &now_binding,
        owner,
        &grants,
    )
    .await?;
    let resource = Uuid::new_v4();
    sqlx::query(
        "insert into catalog.resource
           (id,tenant_id,type_key,home_workspace_id,owner_principal_id,component_type_key,
            application_binding_id,native_type,native_id,state,version)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,'PROVISIONING',1)",
    )
    .bind(resource)
    .bind(entry.tenant_id)
    .bind(TYPE_KEY)
    .bind(workspace)
    .bind(owner)
    .bind(&now_binding.component_type_key)
    .bind(binding)
    .bind(&native_type)
    .bind(&request.native_id)
    .execute(&mut *tx)
    .await?;
    let frozen = Value::Array(grants.iter().map(|g| g.to_json()).collect());
    sqlx::query(
        "insert into catalog.component_share_adoption
           (resource_id,tenant_id,application_binding_id,owner_principal_id,grants)
         values($1,$2,$3,$4,$5)",
    )
    .bind(resource)
    .bind(entry.tenant_id)
    .bind(binding)
    .bind(owner)
    .bind(&frozen)
    .execute(&mut *tx)
    .await?;
    let service: Uuid = sqlx::query_scalar(
        "select service_principal_id from catalog.application_binding where id=$1",
    )
    .bind(binding)
    .fetch_one(&mut *tx)
    .await?;
    let digest = collab_bridge::limits::canonical_digest(&frozen);
    crate::audit::append(
        &mut tx,
        adoption_audit(
            resource,
            entry.tenant_id,
            "intent",
            "INTENT",
            "COMPONENT_SHARE_ADOPTION_PENDING",
            owner,
            service,
            &now_binding.component_type_key,
            &digest,
            Vec::new(),
        ),
    )
    .await?;
    tx.commit().await?;
    finish_adoption(state, resource).await
}

/// Write the adopted object's projection and frozen grants, read them back,
/// then make the Resource ACTIVE and audit COMPONENT_SHARE_ADOPTED. Every step
/// is idempotent; a failure leaves the adoption PROVISIONING for the
/// component's retry.
async fn finish_adoption(state: &ServiceState, resource: Uuid) -> Result<Value, Refusal> {
    let mut conn = state.pool.acquire().await?;
    let a = adoption(&mut conn, resource)
        .await?
        .ok_or_else(|| unavailable("adoption"))?;
    drop(conn);
    let grants: Vec<Grant> = a
        .grants
        .as_array()
        .ok_or_else(|| unavailable("adoption"))?
        .iter()
        .map(Grant::from_json)
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| unavailable("adoption"))?;
    if a.completed_at.is_some() || a.state != "PROVISIONING" {
        return adoption_answer(resource, a.owner_principal_id, true, &grants);
    }
    let id = resource.to_string();
    let tenant = a.tenant_id.to_string();
    let owner = a.owner_principal_id.to_string();
    let home = a.home_workspace_id.map(|w| w.to_string());
    let spicedb = &state.governance.spicedb;
    match spicedb
        .replace_resource_projection(&id, &tenant, &owner, &owner, home.as_deref())
        .await
    {
        Ok(token) if !token.is_empty() => {}
        _ => return Err(unavailable("projection")),
    }
    let desired: Vec<Relationship> = grants
        .iter()
        .map(|g| g.relationship(resource, a.tenant_id))
        .collect();
    let current = grant_relationships(&state.governance, &id).await?;
    let writes = grant_writes(&current, &desired);
    if !writes.is_empty() {
        match spicedb.write(&writes).await {
            Ok(token) if !token.is_empty() => {}
            _ => return Err(unavailable("grants")),
        }
    }
    let as_set = |rs: &[Relationship]| rs.iter().map(|r| r.to_string()).collect::<BTreeSet<_>>();
    if as_set(&grant_relationships(&state.governance, &id).await?) != as_set(&desired) {
        return Err(unavailable("grants read back"));
    }
    let proof = match spicedb
        .check(
            "resource",
            &id,
            "share",
            &owner,
            Consistency::FullyConsistent,
        )
        .await
    {
        Ok(proof) if proof.allowed && !proof.zed_token.is_empty() => proof,
        _ => return Err(unavailable("owner projection")),
    };
    let mut tx = state.pool.begin().await?;
    let activated = sqlx::query(
        "update catalog.resource set state='ACTIVE' where id=$1 and type_key=$2 and state='PROVISIONING'",
    )
    .bind(resource)
    .bind(TYPE_KEY)
    .execute(&mut *tx)
    .await?;
    sqlx::query("update catalog.component_share_adoption set completed_at=now() where resource_id=$1 and completed_at is null")
        .bind(resource)
        .execute(&mut *tx)
        .await?;
    if activated.rows_affected() == 1 {
        let mut evidence = vec![
            crate::audit::Evidence::new(EvidenceKind::SpicedbZedtoken, &proof.zed_token),
            crate::audit::Evidence::new(
                EvidenceKind::SpicedbRelationship,
                format!("resource:{id}#owner@principal:{owner}"),
            ),
        ];
        evidence.extend(
            desired
                .iter()
                .map(|r| crate::audit::Evidence::new(EvidenceKind::SpicedbRelationship, r)),
        );
        let digest = collab_bridge::limits::canonical_digest(&a.grants);
        crate::audit::append(
            &mut tx,
            adoption_audit(
                resource,
                a.tenant_id,
                "outcome",
                "OUTCOME",
                "COMPONENT_SHARE_ADOPTED",
                a.owner_principal_id,
                a.service_principal_id,
                &a.component_type_key,
                &digest,
                evidence,
            ),
        )
        .await?;
    }
    tx.commit().await?;
    adoption_answer(resource, a.owner_principal_id, true, &grants)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grant(kind: &str, id: Option<Uuid>, access: &str) -> contracts::ComponentShareGrant {
        let mut subject = json!({"kind": kind});
        match kind {
            "PRINCIPAL" => subject["principalId"] = json!(id.unwrap()),
            "WORKSPACE" => subject["workspaceId"] = json!(id.unwrap()),
            _ => {}
        }
        serde_json::from_value(json!({"subject": subject, "access": access})).unwrap()
    }

    fn input(
        grants: Vec<contracts::ComponentShareGrant>,
        version: Option<i64>,
    ) -> contracts::ComponentShareSet {
        contracts::ComponentShareSet {
            grants,
            intent_id: Uuid::new_v4().to_string(),
            resource_version: version,
        }
    }

    #[test]
    fn adoption_grants_are_closed_and_tenant_write_is_allowed() {
        let w = Uuid::new_v4();
        let ok = adoption_grants(&[
            grant("WORKSPACE", Some(w), "READ"),
            grant("TENANT", None, "WRITE"),
        ])
        .unwrap();
        assert_eq!(ok[0].kind, Kind::Tenant);
        assert!(ok[0].write);
        assert!(adoption_grants(&[
            grant("WORKSPACE", Some(w), "READ"),
            grant("WORKSPACE", Some(w), "WRITE")
        ])
        .is_err());
        let many: Vec<_> = (0..101)
            .map(|_| grant("PRINCIPAL", Some(Uuid::new_v4()), "READ"))
            .collect();
        assert!(adoption_grants(&many).is_err());
        let answer = adoption_answer(Uuid::new_v4(), Uuid::new_v4(), true, &ok).unwrap();
        assert_eq!(answer["adopted"], true);
        assert_eq!(
            answer["grants"][0],
            json!({"subject": {"kind": "TENANT"}, "access": "WRITE"})
        );
    }

    #[test]
    fn normalized_grants_are_canonical_and_closed() {
        let (p, w) = (Uuid::new_v4(), Uuid::new_v4());
        let a = normalize(&input(
            vec![
                grant("WORKSPACE", Some(w), "WRITE"),
                grant("TENANT", None, "READ"),
                grant("PRINCIPAL", Some(p), "READ"),
            ],
            None,
        ))
        .unwrap();
        let kinds: Vec<_> = a["grants"]
            .as_array()
            .unwrap()
            .iter()
            .map(|g| g["subject"]["kind"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(kinds, ["PRINCIPAL", "TENANT", "WORKSPACE"]);
        assert!(a.get("resourceVersion").is_none());
        let params = Params {
            component_share_set: Some(a.clone()),
            explicit_confirmation: Some(true),
            ..Params::default()
        };
        let set = share_set(&params).unwrap();
        assert_eq!(set.grants.len(), 3);
        assert!(validate_params(&params).is_ok());
        // Unconfirmed or carrying other parameters: refused.
        let mut unconfirmed = params.clone();
        unconfirmed.explicit_confirmation = None;
        assert!(validate_params(&unconfirmed).is_err());
        let mut extra = params.clone();
        extra.resource_id = Some(Uuid::new_v4());
        assert!(validate_params(&extra).is_err());
    }

    #[test]
    fn out_of_contract_grants_are_refused() {
        let p = Uuid::new_v4();
        // DD-164(4)③ (design 1c803580): every Tenant member may also get WRITE.
        let all = normalize(&input(vec![grant("TENANT", None, "WRITE")], None)).unwrap();
        assert_eq!(all["grants"][0]["access"], "WRITE");
        // Duplicate subject; zero version; too many grants.
        assert!(normalize(&input(
            vec![
                grant("PRINCIPAL", Some(p), "READ"),
                grant("PRINCIPAL", Some(p), "WRITE")
            ],
            None
        ))
        .is_err());
        assert!(normalize(&input(vec![], Some(0))).is_err());
        let many = (0..101)
            .map(|_| grant("PRINCIPAL", Some(Uuid::new_v4()), "READ"))
            .collect();
        assert!(normalize(&input(many, None)).is_err());
        // A PRINCIPAL subject carrying a workspace id is a shape error.
        let bad: contracts::ComponentShareGrant = serde_json::from_value(json!({
            "subject": {"kind": "PRINCIPAL", "principalId": p, "workspaceId": p}, "access": "READ"
        }))
        .unwrap();
        assert!(normalize(&input(vec![bad], None)).is_err());
        let missing: contracts::ComponentShareGrant =
            serde_json::from_value(json!({"subject": {"kind": "WORKSPACE"}, "access": "READ"}))
                .unwrap();
        assert!(normalize(&input(vec![missing], None)).is_err());
    }

    #[test]
    fn subject_kinds_follow_the_native_type_and_binding_scope() {
        let w = Uuid::new_v4();
        let person = Grant {
            kind: Kind::Principal,
            id: Some(Uuid::new_v4()),
            write: true,
        };
        let tenant = Grant {
            kind: Kind::Tenant,
            id: None,
            write: false,
        };
        let ws = Grant {
            kind: Kind::Workspace,
            id: Some(w),
            write: true,
        };
        assert!(subjects_shape_ok("folder", None, &[person, tenant, ws]));
        // Phase 1: knowledge bases are shared with Workspaces and the Tenant only.
        assert!(!subjects_shape_ok("knowledge_base", None, &[person]));
        assert!(subjects_shape_ok("knowledge_base", None, &[tenant, ws]));
        // A Workspace binding shares only with people or its own Workspace.
        assert!(!subjects_shape_ok("folder", Some(w), &[tenant]));
        assert!(subjects_shape_ok("folder", Some(w), &[person, ws]));
        let other = Grant {
            kind: Kind::Workspace,
            id: Some(Uuid::new_v4()),
            write: false,
        };
        assert!(!subjects_shape_ok("folder", Some(w), &[other]));
        assert_eq!(native_type_for("file_storage"), Some("folder"));
        assert_eq!(native_type_for("knowledge"), Some("knowledge_base"));
        assert_eq!(native_type_for("data_query"), None);
    }

    #[test]
    fn grants_map_to_reader_and_editor_relationships() {
        let (r, t, p, w) = (
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
        );
        let read = Grant {
            kind: Kind::Principal,
            id: Some(p),
            write: false,
        }
        .relationship(r, t);
        assert_eq!(
            read.to_string(),
            format!("resource:{r}#reader@principal:{p}")
        );
        let write = Grant {
            kind: Kind::Workspace,
            id: Some(w),
            write: true,
        }
        .relationship(r, t);
        assert_eq!(
            write.to_string(),
            format!("resource:{r}#editor@workspace:{w}#member")
        );
        let all = Grant {
            kind: Kind::Tenant,
            id: None,
            write: false,
        }
        .relationship(r, t);
        assert_eq!(
            all.to_string(),
            format!("resource:{r}#reader@tenant:{t}#member")
        );
        let all_write = Grant {
            kind: Kind::Tenant,
            id: None,
            write: true,
        }
        .relationship(r, t);
        assert_eq!(
            all_write.to_string(),
            format!("resource:{r}#editor@tenant:{t}#member")
        );
        // Replacing: keep what stays, touch what is new, delete what left.
        let old = Grant {
            kind: Kind::Principal,
            id: Some(Uuid::new_v4()),
            write: true,
        }
        .relationship(r, t);
        let writes = grant_writes(&[read.clone(), old.clone()], &[read.clone(), write.clone()]);
        assert_eq!(writes.len(), 2);
        assert!(matches!(&writes[0], (Write::Touch, rel) if *rel == write));
        assert!(matches!(&writes[1], (Write::Delete, rel) if *rel == old));
    }

    #[test]
    fn dialog_grants_hide_the_owner_and_let_editor_win() {
        let (owner, p, w, t) = (
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
        );
        let rels = vec![
            (Subject::Principal(owner.to_string()), true),
            (Subject::Principal(p.to_string()), false),
            (Subject::Principal(p.to_string()), true),
            (Subject::WorkspaceMembers(w.to_string()), false),
            (Subject::TenantMembers(t.to_string()), false),
            (Subject::TenantMembers(Uuid::new_v4().to_string()), false),
        ];
        let grants = view_grants(&rels, owner, t);
        assert_eq!(
            grants,
            vec![
                Grant {
                    kind: Kind::Principal,
                    id: Some(p),
                    write: true
                },
                Grant {
                    kind: Kind::Tenant,
                    id: None,
                    write: false
                },
                Grant {
                    kind: Kind::Workspace,
                    id: Some(w),
                    write: false
                },
            ]
        );
    }

    fn receipt_request(value: Value) -> contracts::ComponentDirectoryReceiptRequest {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn receipts_are_bounded_and_carry_no_personal_data() {
        let ok = receipt_request(json!({
            "schema": 2, "directoryVersion": "a".repeat(64), "appliedAt": "2026-10-30T10:00:00.000Z",
            "outcome": "APPLIED", "failures": [{"kind": "SHARE", "ref": Uuid::new_v4(), "reasonCode": "NATIVE_OBJECT_MISSING"}]
        }));
        assert!(receipt_input(&ok).is_ok());
        for bad in [
            json!({"schema": 3, "directoryVersion": "a".repeat(64), "appliedAt": "2026-10-30T10:00:00Z", "outcome": "APPLIED", "failures": []}),
            json!({"schema": 2, "directoryVersion": "A".repeat(64), "appliedAt": "2026-10-30T10:00:00Z", "outcome": "APPLIED", "failures": []}),
            json!({"schema": 2, "directoryVersion": "a".repeat(64), "appliedAt": "yesterday", "outcome": "APPLIED", "failures": []}),
            json!({"schema": 2, "directoryVersion": "a".repeat(64), "appliedAt": "2026-10-30T10:00:00Z", "outcome": "FAILED",
                   "failures": [{"kind": "MEMBER", "ref": "alice@example.com has no account", "reasonCode": "X"}]}),
            json!({"schema": 2, "directoryVersion": "a".repeat(64), "appliedAt": "2026-10-30T10:00:00Z", "outcome": "FAILED",
                   "failures": [{"kind": "MEMBER", "ref": "x", "reasonCode": "lower"}]}),
        ] {
            assert!(receipt_input(&receipt_request(bad)).is_err());
        }
        // Unknown fields are refused by the strict decoder.
        assert!(decode::<contracts::ComponentDirectoryReceiptRequest>(
            br#"{"schema":2,"directoryVersion":"x","appliedAt":"x","outcome":"APPLIED","failures":[],"extra":1}"#
        )
        .is_err());
    }

    #[test]
    fn receipt_state_compares_with_what_was_served() {
        let now = Utc::now();
        let v = "a".repeat(64);
        let base = ReceiptRow {
            served_schema: Some(2),
            served_version: Some(v.clone()),
            served_version_since: Some(now - chrono::Duration::seconds(30)),
            served_at: Some(now - chrono::Duration::seconds(30)),
            receipt_schema: Some(2),
            receipt_version: Some(v.clone()),
            outcome: Some("APPLIED".into()),
            failures: json!([]),
            applied_at: Some(now),
            received_at: Some(now),
        };
        assert_eq!(receipt_state(None, now, 60), "NO_RECEIPT");
        assert_eq!(receipt_state(Some(&base), now, 60), "CONVERGED");
        let failed = ReceiptRow {
            outcome: Some("FAILED".into()),
            ..base.clone()
        };
        assert_eq!(receipt_state(Some(&failed), now, 60), "FAILED");
        let newer = ReceiptRow {
            served_version: Some("b".repeat(64)),
            ..base.clone()
        };
        assert_eq!(receipt_state(Some(&newer), now, 60), "PENDING");
        let stale = ReceiptRow {
            served_version_since: Some(now - chrono::Duration::seconds(300)),
            ..newer.clone()
        };
        assert_eq!(receipt_state(Some(&stale), now, 60), "NOT_CONVERGED");
        // The component stopped reading: not converged even if it once matched.
        let stopped = ReceiptRow {
            served_at: Some(now - chrono::Duration::seconds(300)),
            ..base.clone()
        };
        assert_eq!(receipt_state(Some(&stopped), now, 60), "NOT_CONVERGED");
    }

    #[test]
    fn intent_input_is_bounded() {
        let request = |native_id: &str, name: &str| -> contracts::ComponentShareIntentRequest {
            serde_json::from_value(json!({
                "nativeType": "folder", "nativeId": native_id, "name": name,
                "initiator": {"issuer": "https://idp.test/realms/kailo", "subject": "s"}
            }))
            .unwrap()
        };
        assert_eq!(
            intent_input(&request("node-1", "报告")).unwrap().0,
            "folder"
        );
        assert!(intent_input(&request("", "x")).is_err());
        assert!(intent_input(&request("a b", "x")).is_err());
        assert!(intent_input(&request(&"x".repeat(256), "x")).is_err());
        assert!(intent_input(&request("n", " padded")).is_err());
        assert!(intent_input(&request("n", &"名".repeat(201))).is_err());
    }
}
