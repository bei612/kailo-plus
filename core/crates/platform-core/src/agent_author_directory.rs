//! DD-147(1): the member-readable Agent author directory of one Workspace.
//!
//! Original Buzz 779af8886caae1317b4de962082429867ab61503 shows "managed by <owner>" on every
//! Agent message for any viewer (`formatTimelineMessages.ts`, `MessageAgentOwner.tsx`). The
//! Installation view is SpiceDB `read`-filtered (owner, reader, manager), so ordinary members
//! could not see owners. This route answers the same audience as the Workspace member list
//! (`admit_workspace_scope`): for Installations with an ACTIVE ChannelAgentBinding in that
//! Workspace, only the Agent's public key, its pinned persona display name and the owner's
//! Principal ID and Tenant display name. It grants nothing and carries no other Installation
//! field; author names are still read from Relay kind:0 (DD-117(6)). A draining or failed
//! Installation keeps its line: its past messages still need their owner.
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use sqlx::FromRow;
use uuid::Uuid;

use crate::bff::{resolve_execution_context, BffState};

#[derive(FromRow, Debug, Clone, PartialEq)]
pub(crate) struct AuthorRow {
    pub installation_resource_id: Uuid,
    pub agent_pubkey: String,
    pub persona: Value,
    pub owner_principal_id: Uuid,
    pub owner_display_name: Option<String>,
}

const ROWS: &str = "select i.resource_id as installation_resource_id, agent_identity.pubkey as agent_pubkey,
    coalesce(v.content->'personaIdentity', 'null'::jsonb) as persona, r.owner_principal_id,
    (select owner_identity.display_name from identity.tenant_membership owner_membership
      join identity.human_identity owner_identity on owner_identity.id=owner_membership.human_identity_id
        and owner_identity.status='ACTIVE'
      where owner_membership.tenant_principal_id=r.owner_principal_id and owner_membership.tenant_id=r.tenant_id
        and owner_membership.state='ACTIVE' and btrim(owner_identity.display_name)<>'') as owner_display_name
  from catalog.agent_installation i
  join catalog.resource r on r.id=i.resource_id and r.type_key='agent.installation'
    and r.home_workspace_id=i.workspace_id and r.state<>'DELETED'
  join identity.principal a on a.id=i.agent_principal_id and a.tenant_id=r.tenant_id
    and a.kind='AGENT'
  join catalog.agent_memory_binding memory on memory.installation_resource_id=i.resource_id and memory.state='ACTIVE'
  join identity.buzz_identity_binding agent_identity on agent_identity.pubkey=memory.agent_buzz_identity_binding_id
    and agent_identity.principal_id=a.id and agent_identity.tenant_id=r.tenant_id
    and agent_identity.kind='AGENT' and agent_identity.custody='SERVER' and agent_identity.state='ACTIVE'
  join catalog.agent_version v on v.asset_id=i.pinned_version_asset_id
  where r.tenant_id=$1 and i.workspace_id=$2
    and exists(select 1 from catalog.channel_agent_binding cb where cb.installation_resource_id=i.resource_id
      and cb.workspace_id=i.workspace_id and cb.status='ACTIVE')
  order by i.resource_id";

/// The wire shape of one row (contracts/api/agent_author_directory.schema.json).
pub(crate) fn author_view(row: &AuthorRow) -> Option<Value> {
    if row.agent_pubkey.len() != 64
        || !row
            .agent_pubkey
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return None;
    }
    let mut view = json!({
        "installationResourceId": row.installation_resource_id.to_string(),
        "agentPubkey": row.agent_pubkey,
        "ownerPrincipalId": row.owner_principal_id.to_string(),
    });
    if let Some(name) = row
        .persona
        .get("displayName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        view["agentDisplayName"] = json!(name);
    }
    if let Some(owner) = row
        .owner_display_name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
    {
        view["ownerDisplayName"] = json!(owner);
    }
    Some(view)
}

pub(crate) async fn list(
    State(state): State<BffState>,
    Path(workspace_id): Path<Uuid>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    if let Err(r) = crate::web_transport::admit_workspace_scope(&state, &ctx, workspace_id).await {
        return r.into_response();
    }
    match sqlx::query_as::<_, AuthorRow>(ROWS)
        .bind(ctx.tenant_id)
        .bind(workspace_id)
        .fetch_all(&state.pool)
        .await
    {
        Ok(rows) => {
            // A malformed persisted fact is withheld, never shown as another identity.
            let agents: Vec<Value> = rows.iter().filter_map(author_view).collect();
            (StatusCode::OK, Json(json!({ "agents": agents }))).into_response()
        }
        Err(e) => {
            tracing::warn!(error = %e, "读取 Agent 作者目录失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(persona: Value, owner: Option<&str>) -> AuthorRow {
        AuthorRow {
            installation_resource_id: Uuid::nil(),
            agent_pubkey: "a".repeat(64),
            persona,
            owner_principal_id: Uuid::nil(),
            owner_display_name: owner.map(str::to_owned),
        }
    }

    #[test]
    fn view_carries_only_pubkey_persona_and_owner() {
        let view = author_view(&row(
            json!({"displayName":" Scout ","secret":"x"}),
            Some("Ada"),
        ))
        .unwrap();
        assert_eq!(view["agentDisplayName"], "Scout");
        assert_eq!(view["ownerDisplayName"], "Ada");
        let keys: Vec<&String> = view.as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), 5);
    }

    #[test]
    fn missing_names_are_omitted_and_bad_keys_withheld() {
        let view = author_view(&row(Value::Null, Some("  "))).unwrap();
        assert!(view.get("agentDisplayName").is_none());
        assert!(view.get("ownerDisplayName").is_none());
        let mut bad = row(Value::Null, None);
        bad.agent_pubkey = "Z".repeat(64);
        assert!(author_view(&bad).is_none());
    }
}
