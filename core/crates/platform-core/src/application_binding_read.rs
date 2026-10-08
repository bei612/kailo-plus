//! Human and receiver-SERVICE metadata discovery share native binding facts;
//! neither reader selects content, configuration or credential bytes.

use super::*;
use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PageQuery {
    workspace_id: Option<Uuid>,
    offset: Option<i64>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReadResourceQuery {
    pub(super) direction: contracts::ApplicationReadResourceDirection,
    pub(super) offset: Option<i64>,
    pub(super) category_key: Option<String>,
}

pub(super) type ReadResourceRow = (Uuid, i32, Uuid, Option<Uuid>, Uuid, String, String);

pub(crate) async fn read_resources(
    State(state): State<crate::bff::BffState>,
    headers: HeaderMap,
    Path(binding): Path<Uuid>,
    Query(query): Query<ReadResourceQuery>,
) -> Response {
    let actor = match crate::bff::resolve_execution_context(&state, &headers).await {
        Ok(actor) => actor,
        Err(error) => return error,
    };
    match read_resource_page(&state, &actor, binding, query).await {
        Ok(page) => Json(page).into_response(),
        Err(error) => error.respond(None),
    }
}

pub(super) async fn read_receiver(
    conn: &mut PgConnection,
    tenant: Uuid,
    binding: Uuid,
) -> Result<Option<(i32, Uuid, Option<Uuid>)>, Refusal> {
    Ok(sqlx::query_as(
        "select b.version,b.service_principal_id,b.workspace_id
        from catalog.application_binding b
        join identity.tenant t on t.id=b.tenant_id and t.state='ACTIVE'
        join identity.service_principal s on s.principal_id=b.service_principal_id
          and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
        join identity.principal p on p.id=s.principal_id and p.tenant_id=t.id
          and p.kind='SERVICE' and p.status='ACTIVE'
        join catalog.component_release release on release.id=b.component_release_id and release.status='APPROVED'
        join projection.application_runtime runtime on runtime.binding_id=b.id
          and runtime.generation=b.active_projection_generation and runtime.state='ACTIVE'
          and runtime.component_release_id=b.component_release_id
        where b.id=$1 and b.tenant_id=$2 and b.state='ACTIVE'
          and (b.workspace_id is null or exists(select 1 from identity.workspace w
            where w.id=b.workspace_id and w.tenant_id=t.id and w.state='ACTIVE'))
          and exists(select 1 from jsonb_array_elements(release.manifest->'capabilityDeclarations') d
            where d->>'readEdge' in ('RECEIVER','BOTH'))",
    ).bind(binding).bind(tenant).fetch_optional(conn).await?)
}

pub(super) async fn read_resource_rows(
    conn: &mut PgConnection,
    tenant: Uuid,
    binding: Uuid,
    workspace: Option<Uuid>,
    query: &ReadResourceQuery,
    limit: i64,
) -> Result<Vec<ReadResourceRow>, Refusal> {
    let source = query.direction == contracts::ApplicationReadResourceDirection::Source;
    Ok(sqlx::query_as(
        "select r.id,r.version,b.id,r.home_workspace_id,r.owner_principal_id,r.type_key,r.native_id
        from catalog.resource r
        join catalog.application_binding b on b.id=r.application_binding_id and b.tenant_id=r.tenant_id and b.state='ACTIVE'
        join identity.service_principal s on s.principal_id=b.service_principal_id
          and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
        join identity.principal service on service.id=s.principal_id and service.tenant_id=r.tenant_id
          and service.kind='SERVICE' and service.status='ACTIVE'
        join identity.principal owner on owner.id=r.owner_principal_id and owner.tenant_id=r.tenant_id
        join catalog.component_release release on release.id=b.component_release_id and release.status='APPROVED'
        join projection.application_runtime runtime on runtime.binding_id=b.id
          and runtime.generation=b.active_projection_generation and runtime.state='ACTIVE'
          and runtime.component_release_id=b.component_release_id
        join catalog.resource_type_definition kind on kind.id=r.resource_type_definition_id
          and kind.type_key=r.type_key and kind.component_release_id=b.component_release_id and kind.status='ACTIVE'
        where r.tenant_id=$1 and r.state='ACTIVE' and r.projection_action_execution_id is null
          and ($7::text is null or kind.capability_category=$7)
          and (not $2 or (owner.kind='HUMAN' and owner.status='ACTIVE'
            and exists(select 1 from identity.tenant_membership membership
              where membership.tenant_principal_id=owner.id and membership.tenant_id=r.tenant_id and membership.state='ACTIVE')))
          and length(r.native_id)>0
          and (r.home_workspace_id is null or exists(select 1 from identity.workspace w
            where w.id=r.home_workspace_id and w.tenant_id=r.tenant_id and w.state='ACTIVE'))
          and (b.workspace_id is null or exists(select 1 from identity.workspace w
            where w.id=b.workspace_id and w.tenant_id=r.tenant_id and w.state='ACTIVE'))
          and (($2 and ($3::uuid is null or r.home_workspace_id is null or r.home_workspace_id=$3))
            or (not $2 and b.id=$4))
          and (not $2 or (release.manifest->'executionConnector'->>'mode'='REMOTE_ADAPTER'
            and release.manifest->'executionConnector'->>'adapterProtocolRange'='1'
            and coalesce(release.manifest->'executionConnector'->>'actionTokenAudience','') not in ('','NONE')))
          and exists(select 1 from jsonb_array_elements(release.manifest->'capabilityDeclarations') d
            where d->>'categoryKey'=kind.capability_category
              and d->>'readEdge' in (case when $2 then 'SOURCE' else 'RECEIVER' end,'BOTH'))
        order by r.id offset $5 limit $6",
    ).bind(tenant).bind(source).bind(workspace).bind(binding).bind(query.offset.unwrap_or(0)).bind(limit)
        .bind(query.category_key.as_deref())
        .fetch_all(conn).await?)
}

pub(super) async fn resource_visible(
    spicedb: &crate::spicedb::SpiceDb,
    page: u32,
    tenant: Uuid,
    principal: Uuid,
    permission: &str,
    row: &ReadResourceRow,
) -> Result<bool, Refusal> {
    let workspace = row.3.map(|id| id.to_string());
    if !spicedb
        .resource_projection_matches_in_workspace(
            &row.0.to_string(),
            &tenant.to_string(),
            &row.4.to_string(),
            workspace.as_deref(),
            page,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Resource projection unavailable".into()))?
    {
        return Err(Refusal::Unavailable(
            "Resource projection unavailable".into(),
        ));
    }
    let checked = spicedb
        .check(
            "resource",
            &row.0.to_string(),
            permission,
            &principal.to_string(),
            crate::spicedb::Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Resource permission unavailable".into()))?;
    if checked.zed_token.is_empty() {
        return Err(Refusal::Unavailable(
            "Resource permission unavailable".into(),
        ));
    }
    Ok(checked.allowed)
}

async fn read_resource_page(
    state: &crate::bff::BffState,
    actor: &crate::bff::ExecutionContext,
    binding: Uuid,
    query: ReadResourceQuery,
) -> Result<contracts::ApplicationReadResourcePage, Refusal> {
    let offset = query.offset.unwrap_or(0);
    let limit = i64::from(state.governance.cfg.relationship_page);
    if offset < 0 || limit <= 0 || offset.checked_add(limit).is_none() {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    let receiver = read_receiver(&mut tx, actor.tenant_id, binding)
        .await?
        .ok_or_else(blocked)?;
    crate::governance::installation_permission::human_scope(
        &state.governance,
        &mut tx,
        actor.tenant_id,
        receiver.2,
        actor.tenant_principal_id,
    )
    .await?;
    let source = query.direction == contracts::ApplicationReadResourceDirection::Source;
    let rows =
        read_resource_rows(&mut tx, actor.tenant_id, binding, receiver.2, &query, limit).await?;
    let has_next = rows.len() == usize::try_from(limit).map_err(|_| invalid())?;
    let mut resources = Vec::new();
    for row in rows {
        let (id, version, resource_binding, workspace, _, kind, native_ref) = &row;
        match crate::governance::installation_permission::human_scope(
            &state.governance,
            &mut tx,
            actor.tenant_id,
            *workspace,
            actor.tenant_principal_id,
        )
        .await
        {
            Ok(()) => {}
            Err(Refusal::Denied(_)) => continue,
            Err(error) => return Err(error),
        }
        if !resource_visible(
            &state.governance.spicedb,
            state.governance.cfg.relationship_page,
            actor.tenant_id,
            actor.tenant_principal_id,
            if source { "share" } else { "update" },
            &row,
        )
        .await?
        {
            continue;
        }
        let mut value = json!({"resourceId":id,"version":version,"bindingId":resource_binding,
            "typeKey":kind,"nativeRef":native_ref});
        if let Some(workspace) = workspace {
            value["workspaceId"] = json!(workspace);
        }
        resources.push(value);
    }
    let mut value = json!({"bindingId":binding,"bindingVersion":receiver.0,"servicePrincipalId":receiver.1,
        "tenantId":actor.tenant_id,"direction":query.direction,"resources":resources});
    if let Some(workspace) = receiver.2 {
        value["workspaceId"] = json!(workspace);
    }
    if has_next {
        value["nextOffset"] = json!(offset + limit);
    }
    let page: contracts::ApplicationReadResourcePage =
        serde_json::from_value(value).map_err(|_| blocked())?;
    tx.commit().await?;
    Ok(page)
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
        'hasReadReceiver',state='ACTIVE' and exists(select 1 from catalog.component_release release
            join identity.service_principal service on service.principal_id=application_binding.service_principal_id
              and service.component_binding_kind='APPLICATION' and service.component_binding_id=application_binding.id
            join identity.principal principal on principal.id=service.principal_id
              and principal.tenant_id=application_binding.tenant_id and principal.kind='SERVICE' and principal.status='ACTIVE'
            join projection.application_runtime runtime on runtime.binding_id=application_binding.id
              and runtime.generation=application_binding.active_projection_generation and runtime.state='ACTIVE'
              and runtime.component_release_id=release.id
            where release.id=application_binding.component_release_id and release.status='APPROVED'
            and exists(select 1 from jsonb_array_elements(release.manifest->'capabilityDeclarations') d
                where d->>'readEdge' in ('RECEIVER','BOTH'))),
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
        if !crate::capability_registry::action_exposed(
            crate::governance::installation_permission::READ_GRANT,
        ) || !crate::capability_registry::action_exposed(
            crate::governance::installation_permission::READ_REVOKE,
        ) {
            row["hasReadReceiver"] = json!(false);
        }
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

#[cfg(test)]
mod read_resource_tests {
    use super::*;

    #[test]
    fn directory_query_cannot_select_a_service_identity_or_unknown_direction() {
        let query: ReadResourceQuery =
            serde_json::from_value(json!({"direction":"SOURCE","offset":0})).unwrap();
        assert_eq!(
            query.direction,
            contracts::ApplicationReadResourceDirection::Source
        );
        for value in [
            json!({"direction":"NEW_DIRECTION"}),
            json!({"direction":"SOURCE","servicePrincipalId":Uuid::new_v4()}),
            json!({"direction":"RECEIVER","tenantId":Uuid::new_v4()}),
        ] {
            assert!(serde_json::from_value::<ReadResourceQuery>(value).is_err());
        }
    }

    #[tokio::test]
    #[ignore = "requires isolated SERVICE_PERMISSION_TEST_DATABASE_URL"]
    async fn directory_queries_preserve_missing_binding_and_empty_resource_result() {
        use sqlx::Connection;
        let url = std::env::var("SERVICE_PERMISSION_TEST_DATABASE_URL")
            .expect("isolated DB configuration");
        let mut conn = sqlx::PgConnection::connect(&url).await.unwrap();
        let tenant = Uuid::new_v4();
        let binding = Uuid::new_v4();
        assert!(
            read_receiver(&mut conn, tenant, binding)
                .await
                .unwrap()
                .is_none()
        );
        for source in [true, false] {
            let query = ReadResourceQuery {
                direction: if source {
                    contracts::ApplicationReadResourceDirection::Source
                } else {
                    contracts::ApplicationReadResourceDirection::Receiver
                },
                offset: None,
                category_key: None,
            };
            assert!(
                read_resource_rows(&mut conn, tenant, binding, None, &query, 1)
                    .await
                    .unwrap()
                    .is_empty()
            );
        }
    }
}
