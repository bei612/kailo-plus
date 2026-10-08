//! DD-98: register a verified reference to an independently owned native object.
//! The delivered evidence and original Resource/Workflow are the only recovery
//! targets. This path never creates, deletes or transfers a native object.
use contracts::ReasonCode;
use serde_json::{json, Value};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use crate::governance::{Actor, Definition, Execution, Params, Refusal, Target};

pub(crate) const CREATE: &str = "resource.create";
pub(crate) const KIND: &str = "RESOURCE_PROVISION";
fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}
fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}
fn blocked() -> Refusal {
    Refusal::Blocked(ReasonCode::CapabilityBlocked)
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, Refusal> {
    value[key]
        .as_str()
        .filter(|s| !s.is_empty() && s.trim() == *s)
        .ok_or_else(invalid)
}

pub(crate) fn validate_params(params: &Params) -> Result<(), Refusal> {
    let value = params.to_json();
    if value.as_object().is_none_or(|map| {
        map.keys()
            .any(|k| !matches!(k.as_str(), "workspaceId" | "resourceCreate"))
    }) {
        return Err(invalid());
    }
    let value = params.resource_create.as_ref().ok_or_else(invalid)?;
    let typed: contracts::ResourceCreate =
        serde_json::from_value(value.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(typed).map_err(|_| invalid())? != *value {
        return Err(invalid());
    }
    for field in ["typeKey", "nativeType", "nativeRef", "evidenceRef"] {
        text(value, field)?;
    }
    let digest = text(value, "evidenceDigest")?;
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(invalid());
    }
    Ok(())
}

/// All values originate from the selected immutable declaration and the active
/// binding, never from browser-supplied instance/scope or another provider.
type BindingSnapshotRow = (
    Uuid,
    i32,
    Uuid,
    i64,
    String,
    String,
    String,
    String,
    Value,
    Uuid,
    Option<Uuid>,
    Uuid,
    String,
    String,
);

async fn snapshot(
    conn: &mut PgConnection,
    tenant: Uuid,
    workspace: Option<Uuid>,
    request: &Value,
) -> Result<Value, Refusal> {
    let row:Option<BindingSnapshotRow>=sqlx::query_as(
        "select b.id,b.version,b.component_release_id,b.active_projection_generation,
          b.adapter_service_ref,b.native_instance_ref,b.native_scope_ref,b.config_digest,
          r.manifest,t.id,b.workspace_id,b.service_principal_id,b.isolation_mode,r.adapter_build_ref from projection.application_category c
         join catalog.application_binding b on b.id=c.binding_id and b.tenant_id=c.tenant_id
         join projection.application_runtime p on p.binding_id=b.id and p.generation=c.generation
         join catalog.component_release r on r.id=b.component_release_id
         join catalog.resource_type_definition t on t.component_release_id=r.id and t.type_key=$3
           and t.capability_category=c.category_key and t.capability_contract_version=c.contract_version
         where c.tenant_id=$1 and (c.workspace_id=$2 or c.workspace_id is null)
           and (c.workspace_id is not null or not exists(select 1 from projection.application_category preferred
             where preferred.tenant_id=c.tenant_id and preferred.workspace_id=$2 and preferred.category_key=c.category_key))
           and b.state='ACTIVE' and p.state='ACTIVE' and r.status='APPROVED' and t.status='ACTIVE'
           and p.component_release_id=b.component_release_id and b.active_projection_generation=c.generation
           and p.normalized_manifest_digest=r.manifest_digest
         order by c.workspace_id nulls last limit 1 for share of b,p,r,t")
        .bind(tenant).bind(workspace).bind(text(request,"typeKey")?).fetch_optional(&mut *conn).await?;
    let (
        binding,
        version,
        release,
        generation,
        service,
        instance,
        scope,
        config,
        manifest,
        type_id,
        binding_workspace,
        principal,
        isolation,
        artifact,
    ) = row.ok_or_else(blocked)?;
    let connector = manifest["executionConnector"]["mode"].as_str();
    if !matches!(connector, Some("PROTOCOL_PEER" | "REMOTE_ADAPTER")) {
        return Err(blocked());
    }
    let mut fact = json!({"bindingId":binding,"bindingVersion":version,"releaseId":release,"generation":generation,
        "adapterServiceRef":service,"nativeInstanceRef":instance,"nativeScopeRef":scope,"configDigest":config,
        "bindingWorkspaceId":binding_workspace,"servicePrincipalId":principal,"isolationMode":isolation,"artifactDigest":artifact,
        "manifestDigest":collab_bridge::limits::canonical_digest(&manifest),"resourceTypeDefinitionId":type_id,
        "componentTypeKey":manifest["componentTypeKey"],"reference":request});
    // Existing peer intents retain their exact frozen representation. Only
    // remote-adapter intents need the new discriminator: older code could
    // never have produced one, and evidence cannot cross connector surfaces.
    if connector == Some("REMOTE_ADAPTER") {
        fact["connectorMode"] = json!("REMOTE_ADAPTER");
    }
    verify_delivery(tenant, &fact)?;
    Ok(fact)
}

fn verify_delivery(tenant: Uuid, frozen: &Value) -> Result<(), Refusal> {
    let path = std::env::var("APPLICATION_ADAPTER_DIRECTORY_FILE")
        .map_err(|_| Refusal::Unavailable("resource evidence delivery missing".into()))?;
    let bytes = std::fs::read(path)
        .map_err(|_| Refusal::Unavailable("resource evidence directory unavailable".into()))?;
    let directory: contracts::ApplicationAdapterDirectory = serde_json::from_slice(&bytes)
        .map_err(|_| Refusal::Unavailable("resource evidence delivery invalid".into()))?;
    let directory = serde_json::to_value(directory).map_err(|_| invalid())?;
    if serde_json::from_slice::<Value>(&bytes).map_err(|_| invalid())? != directory {
        return Err(invalid());
    }
    delivery_match(&directory, tenant, frozen)
}

fn delivery_match(directory: &Value, tenant: Uuid, frozen: &Value) -> Result<(), Refusal> {
    let collection = match frozen.get("connectorMode") {
        None => "protocolPeers",
        Some(mode) if mode == "REMOTE_ADAPTER" => "adapters",
        _ => return Err(blocked()),
    };
    // The original adapter resolver also requires globally unique service
    // references across both transports; registration must not accept a
    // shadow entry that subsequent native calls would reject.
    let mut references = std::collections::BTreeSet::new();
    for entry in ["adapters", "protocolPeers"].into_iter().flat_map(|key| {
        directory
            .get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
    }) {
        if !references.insert(text(entry, "adapterServiceRef")?) {
            return Err(conflict());
        }
    }
    let mut bindings = 0;
    let mut matches = 0;
    for peer in directory[collection]
        .as_array()
        .ok_or_else(|| Refusal::Unavailable("resource evidence delivery missing".into()))?
    {
        if peer["adapterServiceRef"] != frozen["adapterServiceRef"]
            || peer["nativeInstanceRef"] != frozen["nativeInstanceRef"]
        {
            continue;
        }
        if peer["artifactDigest"] != frozen["artifactDigest"] {
            return Err(conflict());
        }
        for binding in peer["bindings"].as_array().ok_or_else(invalid)? {
            if binding["bindingId"] != frozen["bindingId"] {
                continue;
            }
            bindings += 1;
            if binding["tenantId"] != json!(tenant)
                || binding["workspaceId"] != frozen["bindingWorkspaceId"]
                || binding["servicePrincipalId"] != frozen["servicePrincipalId"]
                || binding["isolationMode"] != frozen["isolationMode"]
                || binding["nativeScopeRef"] != frozen["nativeScopeRef"]
                || binding["configDigest"] != frozen["configDigest"]
            {
                return Err(conflict());
            }
            for reference in binding["nativeResources"]
                .as_array()
                .ok_or_else(|| Refusal::Unavailable("resource evidence delivery missing".into()))?
            {
                if reference == &frozen["reference"] {
                    matches += 1;
                }
            }
        }
    }
    if bindings > 1 || matches > 1 {
        return Err(conflict());
    }
    if bindings != 1 || matches != 1 {
        return Err(Refusal::Unavailable(
            "frozen resource evidence not observed".into(),
        ));
    }
    Ok(())
}

fn identity(frozen: &Value) -> String {
    collab_bridge::limits::canonical_digest(&json!({"instance":frozen["nativeInstanceRef"],
        "scope":frozen["nativeScopeRef"],"type":frozen["reference"]["nativeType"],"ref":frozen["reference"]["nativeRef"]}))
}

pub(crate) async fn target(
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    def: &Definition,
    p: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    validate_params(p)?;
    if def.workspace_rule != "DECLARED_WORKSPACE"
        || def.permission != "create"
        || def.target_type != "RESOURCE"
    {
        return Err(blocked());
    }
    if let Some(workspace) = p.workspace_id {
        let query = if lock {
            "select id from identity.workspace where id=$1 and tenant_id=$2 and state='ACTIVE' for update"
        } else {
            "select id from identity.workspace where id=$1 and tenant_id=$2 and state='ACTIVE'"
        };
        if sqlx::query_scalar::<_, Uuid>(query)
            .bind(workspace)
            .bind(tenant)
            .fetch_optional(&mut *conn)
            .await?
            .is_none()
        {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
    }
    let fact = snapshot(
        conn,
        tenant,
        p.workspace_id,
        p.resource_create.as_ref().ok_or_else(invalid)?,
    )
    .await?;
    let existing: Option<(Uuid, Uuid, Uuid, Option<Uuid>, i32, Value)> = sqlx::query_as(
        "select id,tenant_id,owner_principal_id,home_workspace_id,version,reference_provision
         from catalog.resource where native_identity_digest=$1",
    )
    .bind(identity(&fact))
    .fetch_optional(&mut *conn)
    .await?;
    if let Some((id, owner_tenant, owner, home, version, previous)) = existing {
        // Reuse the existing accountable root; create permission cannot claim
        // another user's root or silently change its home Workspace.
        if owner_tenant != tenant
            || owner != initiator
            || home != p.workspace_id
            || previous["frozen"] != fact
            || frozen.is_some_and(|v| v != id)
        {
            return Err(conflict());
        }
        return Ok(Target {
            id,
            version,
            workspace_id: home,
        });
    }
    Ok(Target {
        id: frozen.unwrap_or_else(Uuid::new_v4),
        version: 0,
        workspace_id: p.workspace_id,
    })
}

pub(crate) async fn prewrite(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    p: &Params,
) -> Result<i32, Refusal> {
    let frozen = snapshot(
        tx,
        ae.tenant_id,
        ae.workspace_id,
        p.resource_create.as_ref().ok_or_else(invalid)?,
    )
    .await?;
    if !crate::agent_definition::active_owner(tx, ae.tenant_id, ae.initiator_principal_id).await? {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let old:Option<i32>=sqlx::query_scalar("select version from catalog.resource where id=$1 and tenant_id=$2 and reference_provision->'frozen'=$3")
        .bind(ae.target_id).bind(ae.tenant_id).bind(&frozen).fetch_optional(&mut **tx).await?;
    if let Some(version) = old {
        return Ok(version);
    }
    let definition =
        Uuid::parse_str(text(&frozen, "resourceTypeDefinitionId")?).map_err(|_| invalid())?;
    let binding = Uuid::parse_str(text(&frozen, "bindingId")?).map_err(|_| invalid())?;
    sqlx::query("insert into catalog.resource(id,tenant_id,type_key,home_workspace_id,owner_principal_id,
         component_type_key,application_binding_id,native_type,native_id,state,version,projection_action_execution_id,
         resource_type_definition_id,reference_provision,native_identity_digest)
         values($1,$2,$3,$4,$5,$6,$7,null,null,'PROVISIONING',1,$8,$9,$10,$11)")
        .bind(ae.target_id).bind(ae.tenant_id).bind(text(&frozen["reference"],"typeKey")?).bind(ae.workspace_id)
        .bind(ae.initiator_principal_id).bind(text(&frozen,"componentTypeKey")?).bind(binding).bind(ae.id)
        .bind(definition).bind(json!({"actionExecutionId":ae.id,"frozen":frozen,"cleanupRequired":false})).bind(identity(&frozen)).execute(&mut **tx).await?;
    Ok(1)
}

pub(crate) async fn start(
    pool: &sqlx::PgPool,
    temporal: &crate::temporal::TemporalClient,
    action: Uuid,
    tenant: Uuid,
    workflow: &str,
) -> Result<crate::membership_lifecycle::LifecycleResponse, axum::response::Response> {
    use axum::{http::StatusCode, response::IntoResponse};
    let row: Option<(Uuid,i32,Value)> = sqlx::query_as(
        "select ae.target_id,(ae.parameters->>'targetVersion')::integer,r.reference_provision->'frozen'
        from admission.action_execution ae join catalog.resource r on r.id=ae.target_id and r.tenant_id=ae.tenant_id
        where ae.id=$1 and ae.tenant_id=$2 and ae.action_key='resource.create' and ae.gate_state='ALLOWED' and ae.temporal_workflow_id=$3",
    )
    .bind(action)
    .bind(tenant)
    .bind(workflow)
    .fetch_optional(pool)
    .await
    .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    let (id, version, frozen) = row.ok_or_else(|| StatusCode::CONFLICT.into_response())?;
    let run_id=crate::component_task::start(pool,temporal,workflow,tenant,action,&crate::component_task::ComponentTaskInput{
        kind:KIND.into(),target:json!({"resourceProvision":workflow_target(action,id,workflow,version,&frozen)})
    }).await?;
    Ok(crate::membership_lifecycle::LifecycleResponse {
        workflow_id: workflow.into(),
        kind: KIND.into(),
        run_id,
    })
}

fn workflow_target(action: Uuid, id: Uuid, workflow: &str, version: i32, frozen: &Value) -> Value {
    json!({"actionExecutionId":action,"resourceId":id,"resourceVersion":version,"workflowId":workflow,
        "bindingId":frozen["bindingId"],"bindingVersion":frozen["bindingVersion"],"componentReleaseId":frozen["releaseId"],
        "projectionGeneration":frozen["generation"],"nativeInstanceRef":frozen["nativeInstanceRef"],
        "nativeScopeRef":frozen["nativeScopeRef"],"reference":frozen["reference"]})
}

pub(crate) async fn advance(
    axum::extract::State(state): axum::extract::State<crate::service_api::ServiceState>,
    headers: axum::http::HeaderMap,
    body: Result<
        axum::Json<contracts::ResourceProvisionAdvanceRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> axum::response::Response {
    use axum::{http::StatusCode, response::IntoResponse};
    if let Err(response) = crate::service_api::authorize(&state, &headers).await {
        return response;
    }
    let Ok(axum::Json(input)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    match advance_inner(&state, input).await {
        Ok(value) => axum::Json(value).into_response(),
        Err(error) => error.respond(None),
    }
}

async fn advance_inner(
    state: &crate::service_api::ServiceState,
    input: contracts::ResourceProvisionAdvanceRequest,
) -> Result<Value, Refusal> {
    let value = serde_json::to_value(input).map_err(|_| invalid())?;
    let target = &value["target"];
    let action = Uuid::parse_str(text(target, "actionExecutionId")?).map_err(|_| invalid())?;
    let id = Uuid::parse_str(text(target, "resourceId")?).map_err(|_| invalid())?;
    let ae = crate::governance::load_execution(&state.pool, action)
        .await?
        .ok_or_else(conflict)?;
    if ae.action_key != CREATE
        || ae.target_id != id
        || ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "DISPATCHED"
        || ae.temporal_workflow_id.as_deref() != Some(text(target, "workflowId")?)
    {
        return Err(conflict());
    }
    let original: Value = sqlx::query_scalar(
        "select reference_provision->'frozen' from catalog.resource where id=$1 and tenant_id=$2",
    )
    .bind(id)
    .bind(ae.tenant_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(conflict)?;
    if *target
        != workflow_target(
            action,
            id,
            text(target, "workflowId")?,
            ae.frozen_target_version().ok_or_else(conflict)?,
            &original,
        )
    {
        return Err(conflict());
    }
    let observed = state
        .temporal
        .describe(text(target, "workflowId")?)
        .await
        .map_err(|_| Refusal::Unavailable("resource workflow observation unavailable".into()))?
        .ok_or_else(|| Refusal::Unavailable("resource workflow missing".into()))?;
    let first:Option<String>=sqlx::query_scalar("select run_id from projection.workflow_ref where workflow_id=$1
        and action_execution_id=$2 and tenant_id=$3 and operation_id=$4 and kind=$5 and workflow_type='ComponentTaskWorkflow'")
        .bind(text(target,"workflowId")?).bind(ae.id).bind(ae.tenant_id).bind(ae.operation_id).bind(KIND)
        .fetch_optional(&state.pool).await?.flatten();
    if !matches!(observed.state, crate::temporal::ObservedState::Open)
        || observed.run_id != text(&value, "runId")?
        || observed.first_run_id.is_empty()
        || first
            .as_deref()
            .is_none_or(|first| first != observed.first_run_id && first != observed.run_id)
    {
        return Err(conflict());
    }
    let terminal:Option<String>=sqlx::query_scalar("select result_code from audit.audit_event where event_key=$1 and action_key=$2 and operation_id=$3")
        .bind(format!("{}:resource:terminal",ae.id)).bind(CREATE).bind(ae.operation_id).fetch_optional(&state.pool).await?;
    if let Some(code) = terminal {
        return Ok(
            json!({"resourceId":id,"status":if code=="SUCCEEDED"{"COMPLETED"}else{"FAILED"},"waitingReason":"NONE"}),
        );
    }
    let def = crate::governance::exact_definition(&state.pool, CREATE, ae.action_version).await?;
    let mut tx = state.pool.begin().await?;
    crate::governance::lock_execution(&mut tx, ae.id).await?;
    crate::roles::lock_tenant(&mut tx, ae.tenant_id).await?;
    // Binding rows are locked before Resource rows, matching lifecycle writers.
    // The action's original parameters, not the caller's target payload, select
    // the evidence. A missing delivery remains uncertain, never native absence.
    let parameters: Value =
        sqlx::query_scalar("select parameters from admission.action_execution where id=$1")
            .bind(ae.id)
            .fetch_one(&mut *tx)
            .await?;
    let fresh = snapshot(
        &mut tx,
        ae.tenant_id,
        ae.workspace_id,
        &parameters["params"]["resourceCreate"],
    )
    .await;
    let row:Option<(String,i32,Uuid,Value,Option<Uuid>)>=sqlx::query_as("select state,version,owner_principal_id,reference_provision,(reference_provision->>'actionExecutionId')::uuid
        from catalog.resource where id=$1 and tenant_id=$2 and home_workspace_id is not distinct from $3 for update")
        .bind(id).bind(ae.tenant_id).bind(ae.workspace_id).fetch_optional(&mut *tx).await?;
    let (status, version, owner, mut intent, writer) = row.ok_or_else(conflict)?;
    let frozen = intent["frozen"].clone();
    if !matches!(
        status.as_str(),
        "ACTIVE" | "PROVISIONING" | "UNKNOWN" | "FAILED"
    ) || owner != ae.initiator_principal_id
    {
        return Err(conflict());
    }
    // Only the original producer writes this root's relationships. A distinct
    // idempotency key may observe that root, not replace its owner or intent.
    if writer != Some(ae.id) && status != "ACTIVE" && status != "FAILED" {
        return Ok(
            json!({"resourceId":id,"status":"RUNNING","waitingReason":"PROJECTION_DELAYED"}),
        );
    }
    if intent["cleanupRequired"] == true && writer == Some(ae.id) {
        tx.commit().await?;
        cleanup(state, &ae, &def).await?;
        return Ok(json!({"resourceId":id,"status":"FAILED","waitingReason":"NONE"}));
    }
    let evaluate = state
        .governance
        .evaluate(
            Actor {
                tenant_id: ae.tenant_id,
                principal_id: ae.initiator_principal_id,
                human_identity_id: None,
            },
            &def,
            &Target {
                id,
                version,
                workspace_id: ae.workspace_id,
            },
        )
        .await?;
    let request = &frozen["reference"];
    let refused = value["cancelRequested"] == true
        || !evaluate.allowed
        || status == "FAILED"
        || matches!(
            &fresh,
            Err(Refusal::Denied(_) | Refusal::Conflict(_) | Refusal::Blocked(_))
        )
        || fresh.as_ref().is_ok_and(|current| current != &frozen);
    if refused && (status == "ACTIVE" || writer != Some(ae.id)) {
        terminal_audit(&mut tx, &ae, &def, "FAILED", None).await?;
        tx.commit().await?;
        return Ok(json!({"resourceId":id,"status":"FAILED","waitingReason":"NONE"}));
    }
    if refused && writer == Some(ae.id) {
        intent["cleanupRequired"] = json!(true);
        sqlx::query("update catalog.resource set state='UNKNOWN',reference_provision=$2 where id=$1 and state<>'FAILED'")
            .bind(id).bind(&intent).execute(&mut *tx).await?;
        tx.commit().await?;
        // Persist the fence before deleting projection; no concurrent retry is
        // allowed to restore it after deterministic refusal.
        cleanup(state, &ae, &def).await?;
        return Ok(json!({"resourceId":id,"status":"FAILED","waitingReason":"NONE"}));
    }
    if let Err(error) = fresh {
        sqlx::query("update catalog.resource set state='UNKNOWN' where id=$1 and projection_action_execution_id=$2 and state='PROVISIONING'")
            .bind(id).bind(ae.id).execute(&mut *tx).await?;
        tx.commit().await?;
        return Err(error);
    }
    let owner = owner.to_string();
    let tenant = ae.tenant_id.to_string();
    let resource = id.to_string();
    let workspace = ae.workspace_id.map(|w| w.to_string());
    let projection = async {
        let zed = if status == "ACTIVE" {
            // An existing root's ACL is authoritative. Duplicate registration
            // never replaces its relationships or restores revoked grants.
            let proof = state
                .governance
                .spicedb
                .check(
                    "resource",
                    &resource,
                    "discover",
                    &owner,
                    crate::spicedb::Consistency::FullyConsistent,
                )
                .await
                .map_err(|e| Refusal::Unavailable(e.to_string()))?;
            if !proof.allowed || proof.zed_token.is_empty() {
                return Err(Refusal::Denied(ReasonCode::PermissionDenied));
            }
            proof.zed_token
        } else {
            state
                .governance
                .spicedb
                .replace_resource_projection(
                    &resource,
                    &tenant,
                    &owner,
                    &owner,
                    workspace.as_deref(),
                )
                .await
                .map_err(|e| Refusal::Unavailable(e.to_string()))?
        };
        let checked = state
            .governance
            .spicedb
            .check(
                "resource",
                &resource,
                "discover",
                &owner,
                crate::spicedb::Consistency::AtLeastAsFresh(&zed),
            )
            .await
            .map_err(|e| Refusal::Unavailable(e.to_string()))?;
        if !checked.allowed || checked.zed_token.is_empty() {
            return Err(Refusal::Unavailable(
                "resource projection is not causally visible".into(),
            ));
        }
        verify_delivery(ae.tenant_id, &frozen)?;
        let last = state
            .governance
            .evaluate(
                Actor {
                    tenant_id: ae.tenant_id,
                    principal_id: ae.initiator_principal_id,
                    human_identity_id: None,
                },
                &def,
                &Target {
                    id,
                    version,
                    workspace_id: ae.workspace_id,
                },
            )
            .await?;
        if !last.allowed {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
        Ok::<_, Refusal>(zed)
    }
    .await;
    let zed = match projection {
        Ok(zed) => zed,
        Err(error) => {
            let deterministic = matches!(error, Refusal::Denied(_) | Refusal::Conflict(_));
            if status == "ACTIVE" {
                if deterministic {
                    terminal_audit(&mut tx, &ae, &def, "FAILED", None).await?;
                }
            } else {
                if deterministic {
                    intent["cleanupRequired"] = json!(true);
                }
                sqlx::query("update catalog.resource set state='UNKNOWN',reference_provision=$2 where id=$1")
                    .bind(id).bind(&intent).execute(&mut *tx).await?;
            }
            tx.commit().await?;
            if deterministic && status != "ACTIVE" {
                cleanup(state, &ae, &def).await?;
            }
            if deterministic {
                return Ok(json!({"resourceId":id,"status":"FAILED","waitingReason":"NONE"}));
            }
            return Err(error);
        }
    };
    sqlx::query("update catalog.resource set state='ACTIVE',native_type=$2,native_id=$3,projection_action_execution_id=null,version=case when state='ACTIVE' then version else version+1 end
        where id=$1 and state in ('PROVISIONING','UNKNOWN','ACTIVE')")
        .bind(id).bind(text(request,"nativeType")?).bind(text(request,"nativeRef")?).execute(&mut *tx).await?;
    terminal_audit(&mut tx, &ae, &def, "SUCCEEDED", Some(&zed)).await?;
    tx.commit().await?;
    Ok(json!({"resourceId":id,"status":"COMPLETED","waitingReason":"NONE"}))
}

async fn cleanup(
    state: &crate::service_api::ServiceState,
    ae: &Execution,
    def: &Definition,
) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    crate::governance::lock_execution(&mut tx, ae.id).await?;
    let ready:bool=sqlx::query_scalar("select exists(select 1 from catalog.resource where id=$1 and projection_action_execution_id=$2
        and reference_provision->'cleanupRequired'='true'::jsonb and state in ('UNKNOWN','FAILED') for update)")
        .bind(ae.target_id).bind(ae.id).fetch_one(&mut *tx).await?;
    if !ready {
        return Err(conflict());
    }
    state
        .governance
        .spicedb
        .delete_resource_projection(ae.target_id)
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()))?;
    sqlx::query("update catalog.resource set state='FAILED',version=case when state='FAILED' then version else version+1 end where id=$1")
        .bind(ae.target_id).execute(&mut *tx).await?;
    terminal_audit(&mut tx, ae, def, "FAILED", None).await?;
    tx.commit().await?;
    Ok(())
}

async fn terminal_audit(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    code: &str,
    zed: Option<&str>,
) -> Result<(), Refusal> {
    let mut evidence = vec![crate::audit::Evidence::new(
        contracts::EvidenceKind::ActionExecutionId,
        ae.id,
    )];
    if let Some(zed) = zed {
        evidence.push(crate::audit::Evidence::new(
            contracts::EvidenceKind::SpicedbZedtoken,
            zed,
        ));
    }
    crate::audit::append(
        tx,
        crate::audit::AuditEntry {
            event_key: format!("{}:resource:terminal", ae.id),
            tenant_id: Some(ae.tenant_id),
            workspace_id: ae.workspace_id,
            operation_id: ae.operation_id,
            event_type: "OUTCOME",
            human_identity_id: None,
            initiator_principal_id: Some(ae.initiator_principal_id),
            actor_principal_id: Some(ae.actor_principal_id),
            action_key: CREATE,
            action_version: ae.action_version,
            component_type_key: &def.component_type_key,
            target_type: Some("RESOURCE"),
            target_id: Some(ae.target_id),
            parameter_hash: &ae.parameter_hash,
            decision: "NONE",
            result_code: code,
            result_exposure: "NONE",
            evidence_refs: evidence,
            correlation_id: ae.correlation_id,
        },
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn delivery() -> (Uuid, Value, Value) {
        let tenant = Uuid::new_v4();
        let binding = Uuid::new_v4();
        let principal = Uuid::new_v4();
        let reference = json!({"typeKey":"fixture.collection","nativeType":"model","nativeRef":"published/model-version",
            "evidenceRef":"controlled-delivery-revision","evidenceDigest":"e".repeat(64)});
        let frozen = json!({"adapterServiceRef":"fixture-adapter","nativeInstanceRef":"isolated-instance",
            "bindingId":binding,"bindingWorkspaceId":null,"servicePrincipalId":principal,
            "nativeScopeRef":"isolated-scope","configDigest":"c".repeat(64),"artifactDigest":"a".repeat(64),
            "isolationMode":"DEDICATED_INSTANCE","reference":reference});
        let directory = json!({"protocolPeers":[{"adapterServiceRef":frozen["adapterServiceRef"],
            "nativeInstanceRef":frozen["nativeInstanceRef"],"artifactDigest":frozen["artifactDigest"],
            "bindings":[{"bindingId":binding,"tenantId":tenant,"servicePrincipalId":principal,
                "nativeScopeRef":frozen["nativeScopeRef"],"configDigest":frozen["configDigest"],
                "isolationMode":frozen["isolationMode"],"nativeResources":[reference]}]}]});
        (tenant, frozen, directory)
    }

    #[test]
    fn trusted_reference_requires_exact_owner_scope_artifact_and_evidence() {
        let (tenant, frozen, directory) = delivery();
        assert!(delivery_match(&directory, tenant, &frozen).is_ok());
        for key in [
            "tenantId",
            "workspaceId",
            "servicePrincipalId",
            "nativeScopeRef",
            "configDigest",
            "isolationMode",
        ] {
            let mut altered = directory.clone();
            altered["protocolPeers"][0]["bindings"][0][key] = json!("another-scope");
            assert!(delivery_match(&altered, tenant, &frozen).is_err(), "{key}");
        }
        for key in [
            "typeKey",
            "nativeType",
            "nativeRef",
            "evidenceRef",
            "evidenceDigest",
        ] {
            let mut altered = directory.clone();
            altered["protocolPeers"][0]["bindings"][0]["nativeResources"][0][key] =
                json!("different-evidence");
            assert!(delivery_match(&altered, tenant, &frozen).is_err(), "{key}");
        }
        let mut altered = directory.clone();
        altered["protocolPeers"][0]["artifactDigest"] = json!("b".repeat(64));
        assert!(delivery_match(&altered, tenant, &frozen).is_err());
        let mut altered = directory.clone();
        let duplicate = altered["protocolPeers"][0].clone();
        altered["protocolPeers"]
            .as_array_mut()
            .unwrap()
            .push(duplicate);
        assert!(delivery_match(&altered, tenant, &frozen).is_err());
        let mut altered = directory.clone();
        let reference = frozen["reference"].clone();
        altered["protocolPeers"][0]["bindings"][0]["nativeResources"]
            .as_array_mut()
            .unwrap()
            .push(reference);
        assert!(delivery_match(&altered, tenant, &frozen).is_err());
    }

    #[test]
    fn missing_frozen_evidence_is_unknown_not_native_absence() {
        let (tenant, frozen, mut directory) = delivery();
        directory["protocolPeers"][0]["bindings"][0]["nativeResources"] = json!([]);
        assert!(matches!(
            delivery_match(&directory, tenant, &frozen),
            Err(Refusal::Unavailable(_))
        ));
        let other = Uuid::new_v4();
        assert!(delivery_match(&directory, other, &frozen).is_err());
        directory["protocolPeers"][0]["bindings"][0]
            .as_object_mut()
            .unwrap()
            .remove("nativeResources");
        assert!(matches!(
            delivery_match(&directory, tenant, &frozen),
            Err(Refusal::Unavailable(_))
        ));
        directory.as_object_mut().unwrap().remove("protocolPeers");
        assert!(matches!(
            delivery_match(&directory, tenant, &frozen),
            Err(Refusal::Unavailable(_))
        ));
    }

    #[test]
    fn remote_reference_uses_its_own_delivery_and_rejects_mode_or_scope_drift() {
        let (tenant, mut frozen, mut directory) = delivery();
        frozen["connectorMode"] = json!("REMOTE_ADAPTER");
        // A matching peer is not evidence for a remote-adapter registration.
        assert!(delivery_match(&directory, tenant, &frozen).is_err());
        directory["adapters"] = directory["protocolPeers"].take();
        directory.as_object_mut().unwrap().remove("protocolPeers");
        assert!(delivery_match(&directory, tenant, &frozen).is_ok());
        for mode in [
            json!(null),
            json!(""),
            json!("OTHER"),
            json!("PROTOCOL_PEER"),
        ] {
            let mut altered = frozen.clone();
            altered["connectorMode"] = mode;
            assert!(delivery_match(&directory, tenant, &altered).is_err());
        }
        let mut altered = frozen.clone();
        altered.as_object_mut().unwrap().remove("connectorMode");
        assert!(delivery_match(&directory, tenant, &altered).is_err());
        for field in [
            "tenantId",
            "workspaceId",
            "servicePrincipalId",
            "nativeScopeRef",
            "configDigest",
            "isolationMode",
        ] {
            let mut altered = directory.clone();
            altered["adapters"][0]["bindings"][0][field] = json!("foreign-fact");
            assert!(
                delivery_match(&altered, tenant, &frozen).is_err(),
                "{field}"
            );
        }
        let mut altered = directory.clone();
        altered["protocolPeers"] = altered["adapters"].clone();
        assert!(matches!(
            delivery_match(&altered, tenant, &frozen),
            Err(Refusal::Conflict(_))
        ));
        directory["adapters"][0]["bindings"][0]["nativeResources"] = json!([]);
        assert!(matches!(
            delivery_match(&directory, tenant, &frozen),
            Err(Refusal::Unavailable(_))
        ));
    }

    #[test]
    fn native_identity_is_not_a_provider_or_evidence_alias() {
        let (_, frozen, _) = delivery();
        let mut alias = frozen.clone();
        alias["bindingId"] = json!(Uuid::new_v4());
        alias["reference"]["evidenceDigest"] = json!("f".repeat(64));
        assert_eq!(identity(&frozen), identity(&alias));
        alias["nativeScopeRef"] = json!("different-scope");
        assert_ne!(identity(&frozen), identity(&alias));
    }

    #[tokio::test]
    #[ignore = "requires isolated migrated empty RESOURCE_PROVISION database"]
    async fn original_producer_freezes_one_accountable_reference() {
        for mode in ["PROTOCOL_PEER", "REMOTE_ADAPTER"] {
            original_producer_for_connector(mode).await;
        }
    }

    async fn original_producer_for_connector(mode: &str) {
        use sqlx::Connection;
        let mut connection = sqlx::PgConnection::connect(
            &std::env::var("RESOURCE_PROVISION_TEST_DATABASE_URL").expect("isolated database URL"),
        )
        .await
        .unwrap();
        let mut tx = connection.begin().await.unwrap();
        let base = include_str!("../../../verify/application-execution-base.sql")
            .replace("\nBEGIN;\n", "\n")
            .replace("\nCOMMIT;\n", "\n");
        sqlx::raw_sql(&base).execute(&mut *tx).await.unwrap();
        let fixture = include_str!("../../../verify/application-execution-dispatch.sql");
        let needle = "'resourceTypeDefinitions',jsonb_build_array(resource_type));";
        assert_eq!(fixture.matches(needle).count(), 1);
        let fixture=fixture.replace(needle,&format!("'resourceTypeDefinitions',jsonb_build_array(resource_type),'executionConnector',jsonb_build_object('mode','{mode}')); "));
        sqlx::raw_sql(&fixture).execute(&mut *tx).await.unwrap();
        let (tenant,binding,principal,instance,scope,config,artifact):(Uuid,Uuid,Uuid,String,String,String,String)=sqlx::query_as(
            "select b.tenant_id,b.id,b.service_principal_id,b.native_instance_ref,b.native_scope_ref,b.config_digest,r.adapter_build_ref
             from catalog.application_binding b join catalog.component_release r on r.id=b.component_release_id where b.state='ACTIVE'")
            .fetch_one(&mut *tx).await.unwrap();
        let human:Uuid=sqlx::query_scalar("select owner_principal_id from catalog.resource where application_binding_id=$1 limit 1")
            .bind(binding).fetch_one(&mut *tx).await.unwrap();
        let request = json!({"typeKey":"retire_plain.collection","nativeType":"collection","nativeRef":"second-existing-object",
            "evidenceRef":"isolated-controlled-delivery","evidenceDigest":"d".repeat(64)});
        let mut directory = json!({"adapters":[],"protocolPeers":[{"adapterServiceRef":"isolated-adapter","mcpUrl":"https://isolated.invalid/mcp",
            "nativeInstanceRef":instance,"artifactDigest":artifact,"timeoutSeconds":1,"maxResponseBytes":1024,
            "bindings":[{"bindingId":binding,"tenantId":tenant,"servicePrincipalId":principal,"nativeScopeRef":scope,
                "configDigest":config,"isolationMode":"DEDICATED_INSTANCE","nativeResources":[request]}]}]});
        if mode == "REMOTE_ADAPTER" {
            let mut entry = directory["protocolPeers"][0].clone();
            entry.as_object_mut().unwrap().remove("mcpUrl");
            entry["baseUrl"] = json!("https://isolated.invalid/");
            entry["actionTokenAudience"] = json!("isolated-adapter");
            entry["secretReaders"] = json!([]);
            directory = json!({"adapters":[entry]});
        }
        let path = std::env::temp_dir().join(format!("resource-reference-{}.json", Uuid::new_v4()));
        std::fs::write(&path, serde_json::to_vec(&directory).unwrap()).unwrap();
        let previous = std::env::var_os("APPLICATION_ADAPTER_DIRECTORY_FILE");
        std::env::set_var("APPLICATION_ADAPTER_DIRECTORY_FILE", &path);
        let params = Params::from_json(&json!({"resourceCreate":request})).unwrap();
        validate_params(&params).unwrap();
        let def:Definition=sqlx::query_as(&format!("select {} from catalog.action_definition where action_key=$1 and component_release_id is null",crate::governance::DEFINITION_COLUMNS))
            .bind(CREATE).fetch_one(&mut *tx).await.unwrap();
        let resolved = target(&mut tx, tenant, human, &def, &params, None, true)
            .await
            .unwrap();
        let ae_id = Uuid::new_v4();
        sqlx::query("insert into admission.action_execution(id,operation_id,tenant_id,action_key,action_version,
            initiator_principal_id,actor_principal_id,target_id,parameter_hash,parameters,gate_state,dispatch_state,correlation_id)
            values($1,$1,$2,$3,1,$4,$4,$5,$6,$7,'EVALUATING','NOT_DISPATCHED',$1)")
            .bind(ae_id).bind(tenant).bind(CREATE).bind(human).bind(resolved.id).bind("b".repeat(64))
            .bind(json!({"targetVersion":0,"params":params.to_json()})).execute(&mut *tx).await.unwrap();
        let ae: Execution = sqlx::query_as(&format!(
            "select {} from admission.action_execution where id=$1",
            crate::governance::EXECUTION_COLUMNS
        ))
        .bind(ae_id)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert_eq!(prewrite(&mut tx, &ae, &params).await.unwrap(), 1);
        assert_eq!(prewrite(&mut tx, &ae, &params).await.unwrap(), 1);
        let duplicate = target(&mut tx, tenant, human, &def, &params, None, true)
            .await
            .unwrap();
        assert_eq!(duplicate.id, resolved.id);
        assert!(matches!(
            target(&mut tx, tenant, Uuid::new_v4(), &def, &params, None, true).await,
            Err(Refusal::Conflict(_))
        ));
        let stored: (String, Option<String>, Value) = sqlx::query_as(
            "select state,native_id,reference_provision from catalog.resource where id=$1",
        )
        .bind(resolved.id)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert_eq!(stored.0, "PROVISIONING");
        assert_eq!(stored.1, None);
        assert_eq!(stored.2["frozen"]["bindingId"], json!(binding));
        assert_eq!(stored.2["frozen"]["reference"], request);
        assert_eq!(
            stored.2["frozen"]["connectorMode"],
            if mode == "REMOTE_ADAPTER" {
                json!(mode)
            } else {
                Value::Null
            }
        );
        // Read back through the real definition resolver only after projection
        // metadata closes; this SQL portion proves constraints, not SpiceDB E2E.
        sqlx::query("update admission.action_execution set gate_state='ALLOWED',dispatch_state='DISPATCHED' where id=$1")
            .bind(ae_id).execute(&mut *tx).await.unwrap();
        sqlx::query("update catalog.resource set state='ACTIVE',native_type=$2,native_id=$3,version=2,projection_action_execution_id=null where id=$1")
            .bind(resolved.id).bind("collection").bind("second-existing-object").execute(&mut *tx).await.unwrap();
        assert!(crate::application_catalog::definition_for_resource(
            &mut tx,
            tenant,
            None,
            resolved.id,
            "isolated.lookup@v1",
            1
        )
        .await
        .is_ok());
        // Changed delivery never silently updates the original root.
        let mut changed = params.to_json();
        changed["resourceCreate"]["evidenceDigest"] = json!("e".repeat(64));
        assert!(target(
            &mut tx,
            tenant,
            human,
            &def,
            &Params::from_json(&changed).unwrap(),
            None,
            true
        )
        .await
        .is_err());
        tx.rollback().await.unwrap();
        match previous {
            Some(value) => std::env::set_var("APPLICATION_ADAPTER_DIRECTORY_FILE", value),
            None => std::env::remove_var("APPLICATION_ADAPTER_DIRECTORY_FILE"),
        };
        std::fs::remove_file(path).unwrap();
    }
}
