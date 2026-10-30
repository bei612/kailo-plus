//! DD-138(6) (`07` §4.8.5): the component admin surfaces the Kailo admin area
//! lists. Declarations come only from the pinned APPROVED `KAILO_EMBED` native
//! page release of an ACTIVE binding; each item is returned only after a fresh
//! `manage` check on the object its `requiredPermission` names. No URL,
//! component type, configuration or credential leaves this endpoint; opening a
//! surface goes through the native page descriptor under the same check.
use std::collections::HashMap;

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};
use contracts::ReasonCode;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    bff::{BffState, ExecutionContext},
    governance::Refusal,
};

/// Bounded: the admin area lists the bindings of one Tenant and one Workspace.
const MAX_BINDINGS: i64 = 64;

const SURFACES_SQL: &str = "select b.id,b.workspace_id,r.manifest
     from catalog.application_binding b join catalog.component_release r on r.id=b.component_release_id
     join projection.application_runtime p on p.binding_id=b.id and p.generation=b.active_projection_generation
       and p.component_release_id=r.id and p.normalized_manifest_digest=r.manifest_digest and p.state='ACTIVE'
     join catalog.component_definition d on d.type_key=r.component_type_key and d.catalog_tenant_id=r.catalog_tenant_id
     join identity.tenant t on t.id=b.tenant_id
     where b.tenant_id=$1 and (b.workspace_id is null or b.workspace_id=$2)
       and b.state='ACTIVE' and b.active_projection_generation>0
       and r.status='APPROVED' and r.approved_by_action_execution_id is not null
       and d.class='APPLICATION' and d.status='ACTIVE' and t.state='ACTIVE'
       and r.manifest->'frontendDelivery'->>'mode'='NATIVE_PAGE'
       and r.manifest->'frontendPresentationContract'->>'integrationMode'='KAILO_EMBED'
       and jsonb_typeof(r.manifest->'frontendPresentationContract'->'adminSurfaces')='array'
     order by b.workspace_id nulls first,b.id limit $3";

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ListQuery {
    workspace_id: Option<Uuid>,
}

pub(crate) async fn list(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> Response {
    let actor = match crate::bff::resolve_execution_context(&state, &headers).await {
        Ok(actor) => actor,
        Err(error) => return error,
    };
    match surfaces(&state, &actor, query.workspace_id).await {
        Ok(page) => (
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            Json(page),
        )
            .into_response(),
        Err(error) => error.respond(None),
    }
}

/// One admin-surface entry as the contract carries it: binding, Workspace,
/// presentation category (the source label) and the declaration itself.
pub(crate) fn entry(
    binding: Uuid,
    workspace: Option<Uuid>,
    manifest: &Value,
    surface: &Value,
) -> Value {
    let mut item = json!({"bindingId":binding,"surface":surface});
    if let Some(workspace) = workspace {
        item["workspaceId"] = json!(workspace);
    }
    if let Some(category) = manifest["frontendDelivery"]["nativePageCategory"].as_str() {
        item["nativePageCategory"] = json!(category);
    }
    item
}

async fn surfaces(
    state: &BffState,
    actor: &ExecutionContext,
    workspace: Option<Uuid>,
) -> Result<contracts::AdminSurfacePage, Refusal> {
    if let Some(workspace) = workspace {
        let admitted = crate::web_transport::workspace_admissions(state, actor, &[workspace])
            .await
            .map_err(|error| match error {
                crate::web_transport::AdmissionFailure::Denied => {
                    Refusal::Denied(ReasonCode::PermissionDenied)
                }
                crate::web_transport::AdmissionFailure::BindingNotActive => {
                    Refusal::Precondition(ReasonCode::BindingNotActive)
                }
                crate::web_transport::AdmissionFailure::Unavailable => {
                    Refusal::Unavailable("Admin surface scope unavailable".into())
                }
            })?;
        if !admitted.contains_key(&workspace) {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
    }
    let rows: Vec<(Uuid, Option<Uuid>, Value)> = sqlx::query_as(SURFACES_SQL)
        .bind(actor.tenant_id)
        .bind(workspace)
        .bind(MAX_BINDINGS)
        .fetch_all(&state.pool)
        .await?;
    // One fresh check per distinct object; an unavailable check fails the whole
    // list rather than returning a partial one that looks complete.
    let mut granted: HashMap<(&'static str, Uuid), bool> = HashMap::new();
    let mut items = Vec::new();
    for (binding, binding_workspace, manifest) in rows {
        let declared = manifest["frontendPresentationContract"]["adminSurfaces"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        for surface in declared {
            let target = crate::application_page::admin_surface_object(
                &surface,
                actor.tenant_id,
                binding_workspace,
            )?;
            let allowed = match granted.get(&target) {
                Some(allowed) => *allowed,
                None => {
                    let checked = state
                        .governance
                        .spicedb
                        .check(
                            target.0,
                            &target.1.to_string(),
                            "manage",
                            &actor.tenant_principal_id.to_string(),
                            crate::spicedb::Consistency::FullyConsistent,
                        )
                        .await
                        .map_err(|_| {
                            Refusal::Unavailable("Admin surface check unavailable".into())
                        })?;
                    if checked.zed_token.is_empty() {
                        return Err(Refusal::Unavailable(
                            "Admin surface check unavailable".into(),
                        ));
                    }
                    granted.insert(target, checked.allowed);
                    checked.allowed
                }
            };
            if allowed {
                items.push(entry(binding, binding_workspace, &manifest, &surface));
            }
        }
    }
    let value = json!({"items":items});
    let typed: contracts::AdminSurfacePage = serde_json::from_value(value.clone())
        .map_err(|_| Refusal::Unavailable("Admin surface declaration unavailable".into()))?;
    if serde_json::to_value(&typed)
        .map_err(|_| Refusal::Unavailable("Admin surface declaration unavailable".into()))?
        != value
    {
        return Err(Refusal::Unavailable(
            "Admin surface declaration unavailable".into(),
        ));
    }
    Ok(typed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn surface(permission: &str) -> Value {
        json!({"key":"models.catalog","adminCategory":"MODELS","path":"/platform/admin/models",
            "requiredPermission":permission,"access":"READ_ONLY",
            "title":{"ZH_CN":"模型","EN":"Models"}})
    }

    #[test]
    fn admin_surface_permission_names_the_scope_it_manages() {
        // DD-138(6), V-SCN-269: a Workspace binding's BINDING_MANAGE is that
        // Workspace's manage; TENANT_MANAGE is always the Tenant.
        let tenant = Uuid::new_v4();
        let workspace = Uuid::new_v4();
        let object = crate::application_page::admin_surface_object;
        assert_eq!(
            object(&surface("BINDING_MANAGE"), tenant, Some(workspace)).ok(),
            Some(("workspace", workspace))
        );
        assert_eq!(
            object(&surface("BINDING_MANAGE"), tenant, None).ok(),
            Some(("tenant", tenant))
        );
        assert_eq!(
            object(&surface("TENANT_MANAGE"), tenant, Some(workspace)).ok(),
            Some(("tenant", tenant))
        );
        assert!(object(&surface("DISCOVER"), tenant, None).is_err());
    }

    #[test]
    fn admin_surface_entry_carries_no_url_type_or_config() {
        let binding = Uuid::new_v4();
        let workspace = Uuid::new_v4();
        let manifest = json!({"componentTypeKey":"weknora",
            "frontendDelivery":{"mode":"NATIVE_PAGE","nativePageCategory":"knowledge",
                "nativePageOrigins":["https://knowledge.example.test"]},
            "frontendPresentationContract":{"integrationMode":"KAILO_EMBED",
                "adminSurfaces":[surface("BINDING_MANAGE")]}});
        let item = entry(
            binding,
            Some(workspace),
            &manifest,
            &surface("BINDING_MANAGE"),
        );
        assert_eq!(
            item,
            json!({"bindingId":binding,"workspaceId":workspace,"nativePageCategory":"knowledge",
                "surface":surface("BINDING_MANAGE")})
        );
        let typed: contracts::AdminSurfacePage =
            serde_json::from_value(json!({"items":[item.clone()]})).expect("contract shape");
        assert_eq!(
            serde_json::to_value(typed).expect("serialize"),
            json!({"items":[item]})
        );
        let tenant_item = entry(binding, None, &manifest, &surface("TENANT_MANAGE")).to_string();
        assert!(!tenant_item.contains("weknora") && !tenant_item.contains("example.test"));
    }

    #[test]
    fn declared_admin_surface_needs_kailo_embed_native_page() {
        let manifest = |mode: &str, integration: &str| {
            json!({"frontendDelivery":{"mode":mode},
                "frontendPresentationContract":{"integrationMode":integration,
                    "adminSurfaces":[surface("BINDING_MANAGE")]}})
        };
        let declared = crate::application_page::declared_admin_surface;
        assert!(declared(&manifest("NATIVE_PAGE", "KAILO_EMBED"), "models.catalog").is_some());
        assert!(declared(&manifest("NATIVE_PAGE", "KAILO_EMBED"), "models.other").is_none());
        assert!(declared(&manifest("NATIVE_PAGE", "NONE"), "models.catalog").is_none());
        assert!(declared(
            &manifest("SOURCE_BOUND_PROTOCOL", "KAILO_EMBED"),
            "models.catalog"
        )
        .is_none());
    }
}
