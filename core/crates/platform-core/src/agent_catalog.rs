//! DD-131(6): owner names for the Agent and team catalog.
//!
//! Original Buzz 779af8886caae1317b4de962082429867ab61503 `CommunityCatalogDialog.tsx` shows
//! "Added by <owner>" for every catalog entry (`catalogOwnerLabel.ts`). Kailo's catalog is the
//! caller's discoverable AgentDefinitions and `agent.team` Resources (`GET /api/v1/agent-definitions`,
//! `GET /api/v1/agent-teams`), which carry only the owner's Principal ID. This route answers, for
//! at most one page of those Resource IDs, the owner's Principal and ACTIVE Tenant display name —
//! and only for IDs that are ACTIVE catalog Resources of the caller's Tenant that the caller can
//! currently `discover`. It grants nothing; any other ID is silently omitted, so it cannot be used
//! to look up arbitrary Principals.
use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::FromRow;
use uuid::Uuid;

use crate::bff::{resolve_execution_context, BffState};
use crate::governance::Refusal;

#[derive(Deserialize)]
pub struct OwnerQuery {
    /// Comma-separated Resource IDs (one catalog page).
    pub ids: Option<String>,
}

#[derive(FromRow, Debug, Clone, PartialEq)]
pub(crate) struct OwnerRow {
    pub resource_id: Uuid,
    pub owner_principal_id: Uuid,
    pub owner_display_name: Option<String>,
}

const ROWS: &str = "select r.id as resource_id, r.owner_principal_id,
    (select owner_identity.display_name from identity.tenant_membership owner_membership
      join identity.human_identity owner_identity on owner_identity.id=owner_membership.human_identity_id
        and owner_identity.status='ACTIVE'
      where owner_membership.tenant_principal_id=r.owner_principal_id and owner_membership.tenant_id=r.tenant_id
        and owner_membership.state='ACTIVE' and btrim(owner_identity.display_name)<>'') as owner_display_name
  from catalog.resource r
  where r.tenant_id=$1 and r.id=any($2) and r.state='ACTIVE' and r.projection_action_execution_id is null
    and r.type_key in ('agent.definition','agent.team')
  order by r.id";

/// Parses one page of IDs; malformed, duplicate or over-long input is a client error.
pub(crate) fn parse_ids(raw: Option<&str>, limit: usize) -> Option<Vec<Uuid>> {
    let raw = raw?.trim();
    if raw.is_empty() {
        return Some(Vec::new());
    }
    let mut ids = Vec::new();
    for part in raw.split(',') {
        let id = Uuid::parse_str(part.trim()).ok()?;
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    (ids.len() <= limit).then_some(ids)
}

pub(crate) fn owner_view(row: &OwnerRow) -> Value {
    let mut view = json!({
        "resourceId": row.resource_id.to_string(),
        "ownerPrincipalId": row.owner_principal_id.to_string(),
    });
    if let Some(name) = row
        .owner_display_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        view["ownerDisplayName"] = Value::String(name.to_owned());
    }
    view
}

/// `GET /api/v1/agent-catalog/owners?ids=<id>,<id>`
pub(crate) async fn owners(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(q): Query<OwnerQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let limit = usize::try_from(state.governance.cfg.relationship_page).unwrap_or(usize::MAX);
    let Some(ids) = parse_ids(q.ids.as_deref(), limit) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if ids.is_empty() {
        return (StatusCode::OK, Json(json!({ "owners": [] }))).into_response();
    }
    let rows = match sqlx::query_as::<_, OwnerRow>(ROWS)
        .bind(ctx.tenant_id)
        .bind(&ids)
        .fetch_all(&state.pool)
        .await
    {
        Ok(rows) => rows,
        Err(e) => return crate::service_api::unavailable(e),
    };
    let candidates: Vec<String> = rows.iter().map(|r| r.resource_id.to_string()).collect();
    let allowed = match state
        .governance
        .spicedb
        .check_bulk(
            "resource",
            &candidates,
            "discover",
            &ctx.tenant_principal_id.to_string(),
        )
        .await
    {
        Ok(a) => a,
        Err(e) => return Refusal::Unavailable(e.to_string()).respond(None),
    };
    let owners: Vec<Value> = rows
        .iter()
        .filter(|r| allowed.contains(&r.resource_id.to_string()))
        .map(owner_view)
        .collect();
    (StatusCode::OK, Json(json!({ "owners": owners }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_one_bounded_page_without_duplicates() {
        let a = Uuid::from_u128(1);
        let b = Uuid::from_u128(2);
        assert_eq!(
            parse_ids(Some(&format!("{a}, {b},{a}")), 2),
            Some(vec![a, b])
        );
        assert_eq!(parse_ids(Some(""), 2), Some(vec![]));
        assert_eq!(parse_ids(None, 2), None);
        assert_eq!(parse_ids(Some("not-a-uuid"), 2), None);
        assert_eq!(parse_ids(Some(&format!("{a},{b}")), 1), None);
    }

    #[test]
    fn view_carries_only_resource_and_owner() {
        let row = OwnerRow {
            resource_id: Uuid::from_u128(7),
            owner_principal_id: Uuid::from_u128(9),
            owner_display_name: Some(" Ada ".into()),
        };
        let view = owner_view(&row);
        assert_eq!(view["ownerDisplayName"], "Ada");
        assert_eq!(view.as_object().unwrap().len(), 3);
        let blank = owner_view(&OwnerRow {
            owner_display_name: Some("  ".into()),
            ..row
        });
        assert!(blank.get("ownerDisplayName").is_none());
    }
}
