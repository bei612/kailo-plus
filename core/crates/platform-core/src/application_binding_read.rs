//! BFF-only management metadata reader. The selected scope is authorized before
//! querying bindings, and no native/configuration/credential bytes are selected.

use super::*;
use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PageQuery {
    workspace_id: Option<Uuid>,
    offset: Option<i64>,
}

pub(crate) async fn list(
    State(state): State<crate::bff::BffState>,
    headers: HeaderMap,
    Query(query): Query<PageQuery>,
) -> Response {
    let actor = match crate::bff::resolve_execution_context(&state, &headers).await {
        Ok(actor) => actor,
        Err(error) => return error,
    };
    match page(&state, &actor, query).await {
        Ok(page) => Json(page).into_response(),
        Err(error) => error.respond(None),
    }
}

async fn page(
    state: &crate::bff::BffState,
    actor: &crate::bff::ExecutionContext,
    query: PageQuery,
) -> Result<contracts::ApplicationBindingPage, Refusal> {
    let offset = query.offset.unwrap_or(0);
    let limit = i64::from(state.governance.cfg.relationship_page);
    if offset < 0 || limit <= 0 || offset.checked_add(limit).is_none() {
        return Err(invalid());
    }
    // Discovery is not administration: members can open an independent service
    // without obtaining the lifecycle's create/disable permission.
    if let Some(workspace) = query.workspace_id {
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
                    Refusal::Unavailable("Application scope unavailable".into())
                }
            })?;
        if !admitted.contains_key(&workspace) {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
    }
    let scope_id = query.workspace_id.unwrap_or(actor.tenant_id).to_string();
    let discovery = state
        .governance
        .spicedb
        .check(
            if query.workspace_id.is_some() {
                "workspace"
            } else {
                "tenant"
            },
            &scope_id,
            "discover",
            &actor.tenant_principal_id.to_string(),
            crate::spicedb::Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Application discovery unavailable".into()))?;
    if !discovery.allowed || discovery.zed_token.is_empty() {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    // The original lifecycle still determines write authority. A discover-only
    // user never acquires management permission from this metadata response.
    let definition = crate::governance::active_definition(&state.pool, CREATE)
        .await?
        .ok_or_else(blocked)?;
    if definition.target_type != "APPLICATION_BINDING"
        || definition.tenant_rule != "SESSION_TENANT"
        || definition.workspace_rule != "DECLARED_WORKSPACE"
        || definition.permission != "manage"
        || definition.permission_object_type != "tenant"
        || definition.result_exposure != "NONE"
    {
        return Err(blocked());
    }
    let decision = state
        .governance
        .evaluate(
            crate::governance::Actor {
                tenant_id: actor.tenant_id,
                principal_id: actor.tenant_principal_id,
                human_identity_id: Some(actor.human_identity_id),
            },
            &definition,
            &Target {
                id: actor.tenant_id,
                version: 0,
                workspace_id: query.workspace_id,
            },
        )
        .await?;
    let can_create = decision.allowed
        && decision
            .zed_token
            .as_deref()
            .is_some_and(|value| !value.is_empty())
        && crate::capability_registry::action_exposed(CREATE);
    let mut rows: Vec<Value> = sqlx::query_scalar(
        "select jsonb_strip_nulls(jsonb_build_object(
        'bindingId',id,'tenantId',tenant_id,'workspaceId',workspace_id,
        'componentReleaseId',component_release_id,'componentTypeKey',component_type_key,
        'state',state,'version',version,'activeProjectionGeneration',active_projection_generation,
        'capabilityCategories',capability_categories,
        'hasNativePage',exists(select 1 from catalog.component_release release
            where release.id=component_release_id and release.status='APPROVED'
            and release.manifest->'frontendDelivery'->>'mode'='NATIVE_PAGE')))
        from catalog.application_binding
        where tenant_id=$1 and workspace_id is not distinct from $2 order by id offset $3 limit $4",
    )
    .bind(actor.tenant_id)
    .bind(query.workspace_id)
    .bind(offset)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;
    let disable = crate::governance::active_definition(&state.pool, DISABLE).await?;
    for row in &mut rows {
        let available = if crate::capability_registry::action_exposed(DISABLE)
            && matches!(
                row["state"].as_str(),
                Some("PROVISIONING" | "ACTIVE" | "ERROR")
            ) {
            if let Some(disable) = &disable {
                if disable.target_type != "APPLICATION_BINDING"
                    || disable.tenant_rule != "SESSION_TENANT"
                    || disable.workspace_rule != "DECLARED_WORKSPACE"
                    || disable.permission != "manage"
                    || disable.permission_object_type != "tenant"
                    || disable.result_exposure != "NONE"
                {
                    return Err(blocked());
                }
                let check = state
                    .governance
                    .evaluate(
                        crate::governance::Actor {
                            tenant_id: actor.tenant_id,
                            principal_id: actor.tenant_principal_id,
                            human_identity_id: Some(actor.human_identity_id),
                        },
                        disable,
                        &Target {
                            id: uuid(row, "bindingId")?,
                            version: row["version"]
                                .as_i64()
                                .and_then(|version| i32::try_from(version).ok())
                                .ok_or_else(blocked)?,
                            workspace_id: query.workspace_id,
                        },
                    )
                    .await?;
                check.allowed
                    && check
                        .zed_token
                        .as_deref()
                        .is_some_and(|value| !value.is_empty())
            } else {
                false
            }
        } else {
            false
        };
        row["canDisable"] = json!(available);
    }
    let mut value = json!({"bindings":rows,"canCreate":can_create});
    if rows.len() == usize::try_from(limit).map_err(|_| invalid())? {
        value["nextOffset"] = json!(offset + limit);
    }
    let page: contracts::ApplicationBindingPage =
        serde_json::from_value(value.clone()).map_err(|_| blocked())?;
    if serde_json::to_value(&page).map_err(|_| blocked())? != value {
        return Err(blocked());
    }
    Ok(page)
}
