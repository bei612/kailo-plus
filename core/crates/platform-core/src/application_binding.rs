//! DD-88/94: original governed binding lifecycle. The Catalog stores references
//! and projections; the independently deployed adapter remains native authority.

use std::collections::{BTreeMap, BTreeSet};

use contracts::ReasonCode;
use serde_json::{json, Value};
use sqlx::PgConnection;
use uuid::Uuid;

use crate::governance::{Definition, Execution, Params, Refusal, Target};

#[path = "application_binding_gateway.rs"]
pub(crate) mod gateway;
#[path = "application_binding_native.rs"]
pub(crate) mod native;
#[path = "application_binding_pep.rs"]
pub(crate) mod pep;
#[path = "application_binding_projection.rs"]
mod projection;
#[path = "application_binding_read.rs"]
pub(crate) mod read;

pub(crate) const CREATE: &str = "application_binding.create";
pub(crate) const DISABLE: &str = "application_binding.disable";
pub(crate) const KIND: &str = "COMPONENT_BINDING";
pub(crate) const DISABLE_KIND: &str = "COMPONENT_DISABLE";

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

fn blocked() -> Refusal {
    Refusal::Blocked(ReasonCode::CapabilityBlocked)
}

fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}

fn text<'a>(value: &'a Value, field: &str) -> Result<&'a str, Refusal> {
    value[field]
        .as_str()
        .filter(|value| !value.is_empty() && value.trim() == *value)
        .ok_or_else(invalid)
}

fn uuid(value: &Value, field: &str) -> Result<Uuid, Refusal> {
    Uuid::parse_str(text(value, field)?)
        .ok()
        .filter(|id| !id.is_nil())
        .ok_or_else(invalid)
}

fn exact(value: &Value, required: &[&str], optional: &[&str]) -> Result<(), Refusal> {
    let object = value.as_object().ok_or_else(invalid)?;
    if required.iter().any(|key| !object.contains_key(*key))
        || object
            .keys()
            .any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str()))
    {
        return Err(invalid());
    }
    Ok(())
}

// Validated internal facts, not a second wire schema. Transport remains the
// generated ActionCommand; unknown fields are rejected before normalization.
pub(crate) struct Requested {
    id: Uuid,
    release: Uuid,
    service: Uuid,
    adapter_ref: String,
    native_instance: String,
    native_scope: Option<String>,
    isolation: String,
    categories: Vec<Value>,
    config: Value,
    config_digest: String,
    secret_refs: Vec<Value>,
    retain: bool,
}

fn requested(value: &Value) -> Result<Requested, Refusal> {
    exact(
        value,
        &[
            "bindingId",
            "componentReleaseId",
            "servicePrincipalId",
            "adapterServiceRef",
            "nativeInstanceRef",
            "isolationMode",
            "capabilityCategories",
            "normalizedConfigJson",
            "secretRefs",
            "modelCallMode",
            "callIdentityMode",
            "retainOnTenantDelete",
        ],
        &["nativeScopeRef"],
    )?;
    if value["modelCallMode"] != "NONE" || value["callIdentityMode"] != "INSTANCE_SERVICE" {
        return Err(blocked());
    }
    let categories = value["capabilityCategories"]
        .as_array()
        .ok_or_else(invalid)?;
    let mut names = BTreeSet::new();
    if categories.is_empty() {
        return Err(invalid());
    }
    for category in categories {
        exact(category, &["category", "version"], &[])?;
        if !names.insert(text(category, "category")?)
            || category["version"]
                .as_i64()
                .is_none_or(|v| v <= 0 || v > i32::MAX.into())
        {
            return Err(invalid());
        }
    }
    let isolation = text(value, "isolationMode")?;
    if !matches!(
        isolation,
        "DEDICATED_INSTANCE"
            | "NATIVE_TENANT"
            | "NAMESPACE"
            | "RESOURCE_FILTER"
            | "RESOURCE_INSTANCE"
    ) {
        return Err(invalid());
    }
    let config: Value =
        serde_json::from_str(text(value, "normalizedConfigJson")?).map_err(|_| invalid())?;
    if !config.is_object() {
        return Err(invalid());
    }
    let secret_refs = value["secretRefs"].as_array().ok_or_else(invalid)?.clone();
    let mut keys = BTreeSet::new();
    for reference in &secret_refs {
        exact(
            reference,
            &["secretKey", "locator", "version", "audience"],
            &[],
        )?;
        if !keys.insert(text(reference, "secretKey")?)
            || reference["version"]
                .as_u64()
                .is_none_or(|v| v == 0 || v > u32::MAX.into())
        {
            return Err(invalid());
        }
        text(reference, "locator")?;
        text(reference, "audience")?;
    }
    Ok(Requested {
        id: uuid(value, "bindingId")?,
        release: uuid(value, "componentReleaseId")?,
        service: uuid(value, "servicePrincipalId")?,
        adapter_ref: text(value, "adapterServiceRef")?.into(),
        native_instance: text(value, "nativeInstanceRef")?.into(),
        native_scope: value
            .get("nativeScopeRef")
            .map(|_| text(value, "nativeScopeRef").map(str::to_owned))
            .transpose()?,
        isolation: isolation.into(),
        categories: categories.clone(),
        config_digest: collab_bridge::limits::canonical_digest(&config),
        config,
        secret_refs,
        retain: value["retainOnTenantDelete"]
            .as_bool()
            .ok_or_else(invalid)?,
    })
}

pub(crate) fn validate_params(params: &Params, creating: bool) -> Result<(), Refusal> {
    let value = params.to_json();
    if creating {
        exact(
            &value,
            &["applicationBindingCreate", "explicitConfirmation"],
            &["workspaceId"],
        )?;
        requested(&value["applicationBindingCreate"])?;
    } else {
        exact(
            &value,
            &[
                "applicationBindingId",
                "applicationBindingVersion",
                "explicitConfirmation",
            ],
            &[],
        )?;
        uuid(&value, "applicationBindingId")?;
        if value["applicationBindingVersion"]
            .as_i64()
            .is_none_or(|v| v <= 0 || v > i32::MAX.into())
        {
            return Err(invalid());
        }
    }
    if value["explicitConfirmation"] != true {
        return Err(invalid());
    }
    Ok(())
}

async fn approved_release(
    conn: &mut PgConnection,
    tenant: Uuid,
    request: &Requested,
) -> Result<Value, Refusal> {
    let row: Option<(Value, Value, String)> = sqlx::query_as(
        "select r.manifest,r.binding_config_schema,r.manifest_digest
         from catalog.component_release r join catalog.component_definition d
           on d.type_key=r.component_type_key and d.catalog_tenant_id=r.catalog_tenant_id
         where r.id=$1 and r.status='APPROVED' and r.approved_by_action_execution_id is not null
           and d.class='APPLICATION' and d.status='ACTIVE' for share of r,d",
    )
    .bind(request.release)
    .fetch_optional(&mut *conn)
    .await?;
    let (manifest, schema, digest) = row.ok_or_else(blocked)?;
    if collab_bridge::limits::canonical_digest(&manifest) != digest
        || manifest["executionConnector"]["mode"] != "REMOTE_ADAPTER"
        || !matches!(
            manifest["frontendDelivery"]["mode"].as_str(),
            Some("NONE" | "NATIVE_PAGE")
        )
        || manifest["allowedModelCallModes"] != json!(["NONE"])
        || !crate::capability_contract::schema_validator(&schema, &BTreeMap::new())?
            .is_valid(&request.config)
    {
        return Err(blocked());
    }
    if manifest["frontendDelivery"]["mode"] == "NATIVE_PAGE" {
        crate::application_page::entry(&manifest, &request.config)?;
    }
    let implements = manifest["implements"].as_array().ok_or_else(blocked)?;
    for category in &request.categories {
        if !implements.iter().any(|implemented| {
            implemented["categoryKey"] == category["category"]
                && implemented["contractVersion"] == category["version"]
        }) {
            return Err(invalid());
        }
        let contract: Option<Value> = sqlx::query_scalar(
            "select c.content from catalog.capability_contract c join catalog.capability_category k
             on k.category_key=c.category_key and k.catalog_tenant_id=c.catalog_tenant_id
             where c.category_key=$1 and c.contract_version=$2 and c.status='ACTIVE' and k.status='ACTIVE'",
        ).bind(text(category, "category")?).bind(category["version"].as_i64().ok_or_else(invalid)? as i32)
         .fetch_optional(&mut *conn).await?;
        enabled_operations(&manifest, &contract.ok_or_else(blocked)?)?;
    }
    let declarations = manifest["capabilityDeclarations"]
        .as_array()
        .ok_or_else(blocked)?;
    let mut retained = false;
    for category in &request.categories {
        let declaration = declarations
            .iter()
            .find(|d| {
                d["categoryKey"] == category["category"]
                    && d["contractVersion"] == category["version"]
            })
            .ok_or_else(blocked)?;
        match declaration["tenantDelete"].as_str() {
            Some("SUPPORTED") => (),
            Some("RETAIN_ON_TENANT_DELETE") => retained = true,
            _ => return Err(blocked()),
        }
    }
    if request.retain != retained {
        return Err(invalid());
    }
    let secrets = manifest["secretSchema"].as_array().ok_or_else(blocked)?;
    if secrets.len() != request.secret_refs.len() {
        return Err(invalid());
    }
    for reference in &request.secret_refs {
        if !secrets
            .iter()
            .any(|s| s["secretKey"] == reference["secretKey"])
            || !text(reference, "locator")?.starts_with(&format!("tenants/{tenant}/"))
        {
            return Err(invalid());
        }
    }
    // Service identity is registered independently; an arbitrary caller UUID or
    // another binding's machine identity cannot become this adapter's identity.
    let service: bool = sqlx::query_scalar(
        "select exists(select 1 from identity.service_principal s join identity.principal p on p.id=s.principal_id
         where s.principal_id=$1 and p.tenant_id=$2 and p.kind='SERVICE' and p.status='ACTIVE'
           and s.audience=$3 and (s.component_binding_id is null
                or (s.component_binding_kind='APPLICATION' and s.component_binding_id=$4)))",
    ).bind(request.service).bind(tenant).bind(text(&manifest["executionConnector"], "actionTokenAudience")?)
     .bind(request.id).fetch_one(&mut *conn).await?;
    if !service {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    native::Adapter::resolve(&request.adapter_ref, &request.native_instance, &manifest)?;
    Ok(manifest)
}

/// Check only the exact categories selected by this binding. Declarations in
/// other, unselected categories cannot disable an independent native page.
fn enabled_operations(manifest: &Value, contract: &Value) -> Result<(), Refusal> {
    let actions = manifest["actionDefinitions"]
        .as_array()
        .ok_or_else(blocked)?;
    for operation in contract["operationContracts"]
        .as_array()
        .ok_or_else(blocked)?
    {
        let matching: Vec<_> = actions
            .iter()
            .filter(|action| action["actionKey"] == operation["contractKey"])
            .collect();
        if matching.len() != 1
            || matching[0]["executionMode"] != "SYNC"
            || !matches!(
                matching[0]["confirmationMode"].as_str(),
                Some("NONE" | "APPROVAL")
            )
        {
            return Err(blocked());
        }
    }
    Ok(())
}

pub(crate) async fn target(
    conn: &mut PgConnection,
    tenant: Uuid,
    def: &Definition,
    params: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    let creating = def.action_key == CREATE;
    validate_params(params, creating)?;
    if !matches!(def.action_key.as_str(), CREATE | DISABLE)
        || def.target_type != "APPLICATION_BINDING"
        || def.tenant_rule != "SESSION_TENANT"
        || def.permission != "manage"
        || def.execution_mode != "TEMPORAL"
        || def.workspace_rule != "DECLARED_WORKSPACE"
        || def.permission_object_type != "tenant"
        || def.workflow_kind.as_deref() != Some(if creating { KIND } else { DISABLE_KIND })
        || def.confirmation_mode != "EXPLICIT"
        || def.result_exposure != "NONE"
        || def.quota_policy != "NONE"
        || !def.meters.is_empty()
    {
        return Err(blocked());
    }
    if crate::platform_bootstrap::is_catalog_tenant(conn, tenant).await? {
        return Err(blocked());
    }
    let value = params.to_json();
    if creating {
        let request = requested(&value["applicationBindingCreate"])?;
        if frozen.is_some_and(|id| id != request.id) {
            return Err(conflict());
        }
        approved_release(conn, tenant, &request).await?;
        let exists: bool = sqlx::query_scalar(
            "select exists(select 1 from catalog.application_binding where id=$1)",
        )
        .bind(request.id)
        .fetch_one(&mut *conn)
        .await?;
        if exists {
            return Err(conflict());
        }
        if let Some(workspace) = params.workspace_id {
            let query = format!("select id from identity.workspace where id=$1 and tenant_id=$2 and state='ACTIVE'{}",
                if lock { " for update" } else { "" });
            let found: Option<Uuid> = sqlx::query_scalar(&query)
                .bind(workspace)
                .bind(tenant)
                .fetch_optional(&mut *conn)
                .await?;
            if found.is_none() {
                return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
            }
        }
        Ok(Target {
            id: request.id,
            version: 0,
            workspace_id: params.workspace_id,
        })
    } else {
        let id = uuid(&value, "applicationBindingId")?;
        if frozen.is_some_and(|original| original != id) {
            return Err(conflict());
        }
        let query = format!(
            "select version,workspace_id from catalog.application_binding
            where id=$1 and tenant_id=$2 and state in ('PROVISIONING','ACTIVE','ERROR'){}",
            if lock { " for update" } else { "" }
        );
        let row: Option<(i32, Option<Uuid>)> = sqlx::query_as(&query)
            .bind(id)
            .bind(tenant)
            .fetch_optional(conn)
            .await?;
        let (version, workspace_id) = row.ok_or_else(conflict)?;
        if value["applicationBindingVersion"] != version {
            return Err(conflict());
        }
        Ok(Target {
            id,
            version,
            workspace_id,
        })
    }
}

/// This write runs inside the original admission transaction, after the same
/// HUMAN scope/permission evaluation. No adapter side effect precedes it.
pub(crate) async fn prewrite(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ae: &Execution,
    params: &Params,
) -> Result<i32, Refusal> {
    let creating = ae.action_key == CREATE;
    validate_params(params, creating)?;
    if ae.actor_principal_id != ae.initiator_principal_id {
        return Err(blocked());
    }
    let human: bool = sqlx::query_scalar(
        "select exists(select 1 from identity.principal
        where id=$1 and tenant_id=$2 and kind='HUMAN' and status='ACTIVE')",
    )
    .bind(ae.initiator_principal_id)
    .bind(ae.tenant_id)
    .fetch_one(&mut **tx)
    .await?;
    if !human {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    if creating {
        let request = requested(&params.to_json()["applicationBindingCreate"])?;
        if request.id != ae.target_id || params.workspace_id != ae.workspace_id {
            return Err(conflict());
        }
        let manifest = approved_release(tx, ae.tenant_id, &request).await?;
        // Retire and create serialize on these exact original category rows,
        // in category-key order. The SQL trigger repeats this for every writer.
        let mut categories = request.categories.clone();
        categories.sort_by(|a, b| a["category"].as_str().cmp(&b["category"].as_str()));
        let version: i32 = sqlx::query_scalar("insert into catalog.application_binding
            (id,tenant_id,workspace_id,component_type_key,component_release_id,service_principal_id,
             adapter_service_ref,native_instance_ref,native_scope_ref,isolation_mode,call_identity_mode,
             capability_categories,normalized_config,config_digest,secret_refs,model_call_mode,
             retain_on_tenant_delete,state,version,created_by_action_execution_id,projection_action_execution_id)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'INSTANCE_SERVICE',$11,$12,$13,$14,'NONE',$15,
                'PROVISIONING',1,$16,$16) returning version")
            .bind(request.id).bind(ae.tenant_id).bind(ae.workspace_id).bind(text(&manifest,"componentTypeKey")?)
            .bind(request.release).bind(request.service).bind(&request.adapter_ref).bind(&request.native_instance)
            .bind(&request.native_scope).bind(&request.isolation).bind(json!(categories)).bind(&request.config)
            .bind(&request.config_digest).bind(json!(request.secret_refs)).bind(request.retain).bind(ae.id)
            .fetch_one(&mut **tx).await?;
        let assigned = sqlx::query("update identity.service_principal set component_binding_kind='APPLICATION',component_binding_id=$1
            where principal_id=$2 and component_binding_id is null")
            .bind(request.id).bind(request.service).execute(&mut **tx).await?;
        if assigned.rows_affected() != 1 {
            return Err(conflict());
        }
        sqlx::query("insert into projection.application_runtime
            (binding_id,generation,component_release_id,normalized_manifest_digest,adapter_contract_digest,state,action_execution_id,validation_keys)
            values ($1,$2,$3,$4,$5,'PENDING',$6,$7)")
            .bind(request.id).bind(i64::from(version)).bind(request.release)
            .bind(collab_bridge::limits::canonical_digest(&manifest)).bind(text(&manifest,"adapterBuildRef")?)
            .bind(ae.id).bind(json!({"handshake":Uuid::new_v4(),"validate_binding":Uuid::new_v4()}))
            .execute(&mut **tx).await?;
        Ok(version)
    } else {
        let value = params.to_json();
        if uuid(&value, "applicationBindingId")? != ae.target_id {
            return Err(conflict());
        }
        let version: Option<i32> = sqlx::query_scalar(
            "update catalog.application_binding
            set state='DISABLING',version=version+1,projection_action_execution_id=$1
            where id=$2 and tenant_id=$3 and workspace_id is not distinct from $4
              and version=$5 and state in ('PROVISIONING','ACTIVE','ERROR') returning version",
        )
        .bind(ae.id)
        .bind(ae.target_id)
        .bind(ae.tenant_id)
        .bind(ae.workspace_id)
        .bind(
            value["applicationBindingVersion"]
                .as_i64()
                .ok_or_else(invalid)? as i32,
        )
        .fetch_optional(&mut **tx)
        .await?;
        version.ok_or_else(conflict)
    }
}

pub(crate) async fn start(
    pool: &sqlx::PgPool,
    temporal: &crate::temporal::TemporalClient,
    action: Uuid,
    tenant: Uuid,
    workflow_id: &str,
) -> Result<crate::membership_lifecycle::LifecycleResponse, axum::response::Response> {
    use axum::{http::StatusCode, response::IntoResponse};
    let row: Option<(Uuid,i32,String)> = sqlx::query_as("select b.id,b.version,ae.action_key
        from admission.action_execution ae join catalog.application_binding b
          on b.id=ae.target_id and b.tenant_id=ae.tenant_id and b.workspace_id is not distinct from ae.workspace_id
        where ae.id=$1 and ae.tenant_id=$2 and ae.temporal_workflow_id=$3 and ae.gate_state='ALLOWED'
          and ae.action_key in ('application_binding.create','application_binding.disable')
          and b.projection_action_execution_id=ae.id
          and ae.dispatch_state in ('NOT_DISPATCHED','UNKNOWN','DISPATCHED')")
        .bind(action).bind(tenant).bind(workflow_id).fetch_optional(pool).await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    let (binding, version, key) = row.ok_or_else(|| StatusCode::CONFLICT.into_response())?;
    let kind = if key == CREATE { KIND } else { DISABLE_KIND };
    let run_id=crate::component_task::start(pool,temporal,workflow_id,tenant,action,
        &crate::component_task::ComponentTaskInput {kind:kind.into(),target:json!({"applicationBinding":{
            "actionExecutionId":action,"bindingId":binding,"bindingVersion":version,"workflowId":workflow_id}})}).await?;
    Ok(crate::membership_lifecycle::LifecycleResponse {
        workflow_id: workflow_id.into(),
        kind: kind.into(),
        run_id,
    })
}

/// The Worker supplies only the original target and current Temporal run. It
/// cannot upload a native observation, mark a projection ready, or choose the
/// adapter endpoint. Body/config/credential material stays outside history.
pub(crate) async fn advance(
    axum::extract::State(state): axum::extract::State<crate::service_api::ServiceState>,
    headers: axum::http::HeaderMap,
    body: Result<
        axum::Json<contracts::ApplicationBindingAdvanceRequest>,
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
    let result=async {
        let input=serde_json::to_value(input).map_err(|_|invalid())?;
        let target=&input["target"];
        let id=uuid(target,"bindingId")?;
        let action=uuid(target,"actionExecutionId")?;
        let version=target["bindingVersion"].as_i64().filter(|v|*v>0).ok_or_else(invalid)?;
        let run=text(&input,"runId")?;
        Uuid::parse_str(run).map_err(|_|invalid())?;
        let ae=crate::governance::load_execution(&state.pool,action).await?.ok_or_else(conflict)?;
        if ae.target_id!=id || !matches!(ae.action_key.as_str(),CREATE|DISABLE)
            || ae.gate_state!="ALLOWED" || ae.dispatch_state!="DISPATCHED"
            || ae.temporal_workflow_id.as_deref()!=Some(text(target,"workflowId")?) {
            return Err(conflict());
        }
        let workflow=text(target,"workflowId")?;
        let kind=if ae.action_key==CREATE {KIND} else {DISABLE_KIND};
        let first:Option<Option<String>>=sqlx::query_scalar(
            "select run_id from projection.workflow_ref where workflow_id=$1 and tenant_id=$2
             and action_execution_id=$3 and operation_id=$4 and workflow_type='ComponentTaskWorkflow' and kind=$5")
            .bind(workflow).bind(ae.tenant_id).bind(ae.id).bind(ae.operation_id).bind(kind)
            .fetch_optional(&state.pool).await?;
        let first=first.flatten().ok_or_else(||Refusal::Unavailable("binding workflow reference unavailable".into()))?;
        let observed=state.temporal.describe(workflow).await
            .map_err(|_|Refusal::Unavailable("binding Temporal observation unavailable".into()))?
            .ok_or_else(||Refusal::Unavailable("binding Temporal execution missing".into()))?;
        if !matches!(observed.state,crate::temporal::ObservedState::Open)
            || observed.run_id!=run || observed.first_run_id.is_empty()
            || (first!=observed.first_run_id && first!=observed.run_id) {return Err(conflict());}
        let current:Option<(String,i32,Uuid)>=sqlx::query_as(
            "select state,version,projection_action_execution_id from catalog.application_binding
             where id=$1 and tenant_id=$2 and workspace_id is not distinct from $3")
            .bind(id).bind(ae.tenant_id).bind(ae.workspace_id).fetch_optional(&state.pool).await?;
        let (status,current_version,owner)=current.ok_or_else(conflict)?;
        if i64::from(current_version)<version {return Err(conflict());}
        {
            // A dropped HTTP acknowledgement is recovered from the committed
            // original lifecycle outcome; no native validation is replayed.
            let terminal:Option<String>=sqlx::query_scalar(
                "select result_code from audit.audit_event where event_key=$1
                 and operation_id=$2 and target_id=$3 and action_key=$4")
                .bind(format!("{}:binding:terminal",ae.id)).bind(ae.operation_id).bind(id).bind(&ae.action_key)
                .fetch_optional(&state.pool).await?;
            if let Some(result)=terminal {
                let status=match result.as_str() {"SUCCEEDED"=>"COMPLETED","CANCELLED"=>"CANCELED",_=>return Err(conflict())};
                return Ok(json!({"bindingId":id,"status":status,"waitingReason":"NONE"}));
            }
        }
        if owner!=action {
            if ae.action_key!=CREATE {return Err(conflict());}
            if finish_superseded_create(&state,&ae).await? {
                return Ok(json!({"bindingId":id,"status":"CANCELED","waitingReason":"NONE"}));
            }
            return Ok(json!({"bindingId":id,"status":"RUNNING","waitingReason":"PROJECTION_DELAYED"}));
        }
        if (ae.action_key==CREATE && status=="ACTIVE") || status=="DISABLED" {
            return Err(Refusal::Precondition(ReasonCode::ProjectionDelayed));
        }
        if input["cancelRequested"]==true && ae.action_key==CREATE {
            sqlx::query("update catalog.application_binding set state='DISABLING',version=version+1
                where id=$1 and projection_action_execution_id=$2 and state='PROVISIONING'")
                .bind(id).bind(action).execute(&state.pool).await?;
        } else if status=="PROVISIONING" && ae.action_key==CREATE {
            observe_generation(&state,&ae).await?;
            projection::prepare(&state,&ae).await?;
            projection::permissions(&state,&ae).await?;
            projection::metering(&state,&ae).await?;
            gateway::publish(&state,&ae).await?;
            finish_generation(&state,&ae,true).await?;
            return Ok(json!({"bindingId":id,"status":"COMPLETED","waitingReason":"NONE"}));
        }
        if status=="DISABLING" || (input["cancelRequested"]==true && ae.action_key==CREATE) {
            projection::revoke(&state,&ae).await?;
            gateway::revoke(&state,&ae).await?;
            let executions:Vec<Uuid>=sqlx::query_scalar("select id from admission.external_execution
                where component_binding_id=$1 and tenant_id=$2 order by id")
                .bind(id).bind(ae.tenant_id).fetch_all(&state.pool).await?;
            for execution in executions {
                if !crate::application_execution::observe(&state,&ae,execution).await? {
                    return Ok(json!({"bindingId":id,"status":"RUNNING","waitingReason":"UNKNOWN_EXTERNAL_RESULT"}));
                }
            }
            finish_generation(&state,&ae,false).await?;
            let status=if ae.action_key==CREATE {"CANCELED"} else {"COMPLETED"};
            return Ok(json!({"bindingId":id,"status":status,"waitingReason":"NONE"}));
        }
        Ok::<Value,Refusal>(json!({"bindingId":id,"status":"RUNNING","waitingReason":"PROJECTION_DELAYED"}))
    }.await;
    match result {
        Ok(value) => {
            match serde_json::from_value::<contracts::ApplicationBindingAdvanceResult>(value) {
                Ok(value) => axum::Json(value).into_response(),
                Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
            }
        }
        Err(error) => error.respond(None),
    }
}

/// An independently governed disable may take over a still-PROVISIONING
/// create. Only its actual committed terminal settles that original create;
/// the old worker cannot restore the route or manufacture a cancellation ACK.
async fn finish_superseded_create(
    state: &crate::service_api::ServiceState,
    ae: &Execution,
) -> Result<bool, Refusal> {
    let mut tx = state.pool.begin().await?;
    crate::governance::lock_execution(&mut tx, ae.id).await?;
    let ready:bool=sqlx::query_scalar("select exists(select 1 from catalog.application_binding b
        join admission.action_execution withdrawal on withdrawal.id=b.projection_action_execution_id
          and withdrawal.action_key='application_binding.disable' and withdrawal.target_id=b.id
          and withdrawal.tenant_id=b.tenant_id and withdrawal.workspace_id is not distinct from b.workspace_id
          and withdrawal.gate_state='ALLOWED' and withdrawal.dispatch_state='DISPATCHED'
        join audit.audit_event terminal on terminal.event_key=withdrawal.id::text||':binding:terminal'
          and terminal.operation_id=withdrawal.operation_id and terminal.target_id=b.id
          and terminal.action_key=withdrawal.action_key and terminal.result_code='SUCCEEDED'
        where b.id=$1 and b.created_by_action_execution_id=$2 and b.tenant_id=$3
          and b.workspace_id is not distinct from $4 and b.state='DISABLED')")
        .bind(ae.target_id).bind(ae.id).bind(ae.tenant_id).bind(ae.workspace_id).fetch_one(&mut *tx).await?;
    if !ready {
        return Ok(false);
    }
    let def =
        crate::governance::exact_definition(&state.pool, &ae.action_key, ae.action_version).await?;
    crate::audit::append(
        &mut tx,
        crate::audit::AuditEntry {
            event_key: format!("{}:binding:terminal", ae.id),
            tenant_id: Some(ae.tenant_id),
            workspace_id: ae.workspace_id,
            operation_id: ae.operation_id,
            event_type: "RECONCILIATION",
            human_identity_id: None,
            initiator_principal_id: Some(ae.initiator_principal_id),
            actor_principal_id: Some(ae.actor_principal_id),
            action_key: &ae.action_key,
            action_version: ae.action_version,
            component_type_key: &def.component_type_key,
            target_type: Some("APPLICATION_BINDING"),
            target_id: Some(ae.target_id),
            parameter_hash: &ae.parameter_hash,
            decision: "NONE",
            result_code: "CANCELLED",
            result_exposure: &def.result_exposure,
            evidence_refs: vec![crate::audit::Evidence::new(
                contracts::EvidenceKind::ActionExecutionId,
                ae.id,
            )],
            correlation_id: ae.correlation_id,
        },
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

/// Finalize only the already delivered, exactly observed generation. Binding,
/// category/Tool projections and the original lifecycle audit commit together;
/// losing the HTTP acknowledgement reads this same outcome on the next round.
async fn finish_generation(
    state: &crate::service_api::ServiceState,
    ae: &Execution,
    activate: bool,
) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    let current = crate::governance::lock_execution(&mut tx, ae.id).await?;
    if current.gate_state != "ALLOWED"
        || current.dispatch_state != "DISPATCHED"
        || current.operation_id != ae.operation_id
        || current.target_id != ae.target_id
    {
        return Err(conflict());
    }
    let expected = if activate {
        "PROVISIONING"
    } else {
        "DISABLING"
    };
    let row:Option<(i32,Uuid,Value)>=sqlx::query_as("select version,component_release_id,capability_categories
        from catalog.application_binding where id=$1 and tenant_id=$2
          and workspace_id is not distinct from $3 and projection_action_execution_id=$4 and state=$5
        for update")
        .bind(ae.target_id).bind(ae.tenant_id).bind(ae.workspace_id).bind(ae.id).bind(expected)
        .fetch_optional(&mut *tx).await?;
    let (version, release, categories) = row.ok_or_else(conflict)?;
    let definition =
        crate::governance::exact_definition(&state.pool, &ae.action_key, ae.action_version).await?;
    if activate {
        if ae.action_key != CREATE {
            return Err(conflict());
        }
        let decision = state
            .governance
            .evaluate(
                crate::governance::Actor {
                    tenant_id: ae.tenant_id,
                    principal_id: ae.initiator_principal_id,
                    human_identity_id: None,
                },
                &definition,
                &Target {
                    id: ae.target_id,
                    version,
                    workspace_id: ae.workspace_id,
                },
            )
            .await?;
        if !decision.allowed || decision.zed_token.as_deref().is_none_or(str::is_empty) {
            return Err(Refusal::Denied(
                decision.reason.unwrap_or(ReasonCode::PermissionDenied),
            ));
        }
        let projection:Option<(i64,Value)>=sqlx::query_as("select p.generation,p.observation
            from projection.application_runtime p
            join catalog.component_release r on r.id=p.component_release_id and r.status='APPROVED'
            join catalog.application_binding b on b.id=p.binding_id and b.component_release_id=r.id
            join identity.service_principal s on s.principal_id=b.service_principal_id
              and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
            join identity.principal principal on principal.id=s.principal_id
              and principal.tenant_id=b.tenant_id and principal.kind='SERVICE' and principal.status='ACTIVE'
            where p.binding_id=$1 and p.action_execution_id=$2 and p.state='PENDING'
              and p.normalized_manifest_digest=r.manifest_digest and p.observation is not null
              and p.observation->>'bindingId'=b.id::text
              and p.observation->>'tenantId'=b.tenant_id::text
              and p.observation->>'workspaceId' is not distinct from b.workspace_id::text
              and p.observation->>'configDigest'=b.config_digest
              and p.observation->>'nativeInstanceRef'=b.native_instance_ref
              and s.audience=r.manifest->'executionConnector'->>'actionTokenAudience'
              and (not exists(select 1 from catalog.resource tool join catalog.tool_definition d on d.resource_id=tool.id
                    where tool.application_binding_id=b.id and d.source='APPLICATION')
                   or (p.native_gateway_route_id is not null and p.gateway_config_hash is not null and p.gateway_state='ACTIVE'))
            for update of p")
            .bind(ae.target_id).bind(ae.id).fetch_optional(&mut *tx).await?;
        let (generation, observation) =
            projection.ok_or(Refusal::Precondition(ReasonCode::ProjectionDelayed))?;
        let scope = text(&observation, "nativeScopeRef")?;
        for category in categories.as_array().ok_or_else(blocked)? {
            let key = text(category, "category")?;
            let contract = category["version"]
                .as_i64()
                .and_then(|v| i32::try_from(v).ok())
                .ok_or_else(blocked)?;
            let active:bool=sqlx::query_scalar("select exists(select 1 from catalog.capability_contract c
                join catalog.capability_category k on k.category_key=c.category_key
                where c.category_key=$1 and c.contract_version=$2 and c.status='ACTIVE' and k.status='ACTIVE')")
                .bind(key).bind(contract).fetch_one(&mut *tx).await?;
            if !active {
                return Err(blocked());
            }
            sqlx::query(
                "insert into projection.application_category
                (tenant_id,workspace_id,category_key,contract_version,binding_id,generation)
                values($1,$2,$3,$4,$5,$6) on conflict do nothing",
            )
            .bind(ae.tenant_id)
            .bind(ae.workspace_id)
            .bind(key)
            .bind(contract)
            .bind(ae.target_id)
            .bind(generation)
            .execute(&mut *tx)
            .await?;
            let exact: bool = sqlx::query_scalar(
                "select exists(select 1 from projection.application_category
                where tenant_id=$1 and workspace_id is not distinct from $2 and category_key=$3
                  and contract_version=$4 and binding_id=$5 and generation=$6)",
            )
            .bind(ae.tenant_id)
            .bind(ae.workspace_id)
            .bind(key)
            .bind(contract)
            .bind(ae.target_id)
            .bind(generation)
            .fetch_one(&mut *tx)
            .await?;
            if !exact {
                return Err(conflict());
            }
        }
        sqlx::query(
            "update projection.application_runtime set state='ACTIVE'
            where binding_id=$1 and generation=$2 and action_execution_id=$3 and state='PENDING'",
        )
        .bind(ae.target_id)
        .bind(generation)
        .bind(ae.id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("update catalog.resource set state='ACTIVE',version=version+1
            where application_binding_id=$1 and projection_action_execution_id=$2 and state='PROVISIONING'")
            .bind(ae.target_id).bind(ae.id).execute(&mut *tx).await?;
        sqlx::query("update catalog.tool_definition set status='ACTIVE'
            where source='APPLICATION' and application_projection_generation=$2 and status='PROVISIONING'
              and resource_id in(select id from catalog.resource where application_binding_id=$1 and state='ACTIVE')")
            .bind(ae.target_id).bind(generation).execute(&mut *tx).await?;
        sqlx::query("update catalog.application_binding set state='ACTIVE',version=version+1,
            native_scope_ref=$3,active_projection_generation=$4
            where id=$1 and projection_action_execution_id=$2 and state='PROVISIONING' and version=$5
              and component_release_id=$6")
            .bind(ae.target_id).bind(ae.id).bind(scope).bind(generation).bind(version).bind(release)
            .execute(&mut *tx).await?;
    } else {
        let pending:bool=sqlx::query_scalar("select exists(select 1 from projection.application_runtime
            where binding_id=$1 and native_gateway_route_id is not null and gateway_state is distinct from 'REVOKED')
            or exists(select 1 from projection.application_category where binding_id=$1)
            or exists(select 1 from admission.external_execution where component_binding_id=$1
                and platform_status not in ('SUCCEEDED','FAILED','CANCELLED'))")
            .bind(ae.target_id).fetch_one(&mut *tx).await?;
        if pending {
            return Err(Refusal::Precondition(ReasonCode::ProjectionDelayed));
        }
        sqlx::query(
            "update catalog.resource set state='RETAINED_READ_ONLY',version=version+1
            where application_binding_id=$1 and state in ('PROVISIONING','ACTIVE')",
        )
        .bind(ae.target_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "update catalog.tool_definition set status='DELETED' where source='APPLICATION'
            and status<>'DELETED' and resource_id in(select id from catalog.resource
              where application_binding_id=$1 and state='RETAINED_READ_ONLY')",
        )
        .bind(ae.target_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("update projection.application_runtime set state='REVOKED' where binding_id=$1 and state<>'REVOKED'")
            .bind(ae.target_id).execute(&mut *tx).await?;
        // The original DB guards independently require every EE terminal and
        // each applicable UsageEvent COMMITTED; a race cannot bypass draining.
        sqlx::query(
            "update catalog.application_binding set state='DISABLED',version=version+1
            where id=$1 and projection_action_execution_id=$2 and state='DISABLING' and version=$3",
        )
        .bind(ae.target_id)
        .bind(ae.id)
        .bind(version)
        .execute(&mut *tx)
        .await?;
        // DD-88/03: stop this exact binding's platform SERVICE identity only
        // after its native references and usage are closed. External service
        // processes, private data and historical identities remain untouched.
        sqlx::query(
            "update identity.principal p set status='DISABLED'
            from identity.service_principal s join catalog.application_binding b
              on b.service_principal_id=s.principal_id and s.component_binding_kind='APPLICATION'
                and s.component_binding_id=b.id
            where b.id=$1 and b.tenant_id=$2 and b.state='DISABLED'
              and p.id=s.principal_id and p.tenant_id=b.tenant_id and p.kind='SERVICE'
              and p.status='ACTIVE'",
        )
        .bind(ae.target_id)
        .bind(ae.tenant_id)
        .execute(&mut *tx)
        .await?;
    }
    crate::audit::append(
        &mut tx,
        crate::audit::AuditEntry {
            event_key: format!("{}:binding:terminal", ae.id),
            tenant_id: Some(ae.tenant_id),
            workspace_id: ae.workspace_id,
            operation_id: ae.operation_id,
            event_type: "RECONCILIATION",
            human_identity_id: None,
            initiator_principal_id: Some(ae.initiator_principal_id),
            actor_principal_id: Some(ae.actor_principal_id),
            action_key: &ae.action_key,
            action_version: ae.action_version,
            component_type_key: &definition.component_type_key,
            target_type: Some("APPLICATION_BINDING"),
            target_id: Some(ae.target_id),
            parameter_hash: &ae.parameter_hash,
            decision: "NONE",
            result_code: if !activate && ae.action_key == CREATE {
                "CANCELLED"
            } else {
                "SUCCEEDED"
            },
            result_exposure: &definition.result_exposure,
            evidence_refs: vec![crate::audit::Evidence::new(
                contracts::EvidenceKind::ActionExecutionId,
                ae.id,
            )],
            correlation_id: ae.correlation_id,
        },
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

async fn observe_generation(
    state: &crate::service_api::ServiceState,
    ae: &Execution,
) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    let row:Option<(Value,Value,Value,Option<Value>)>=sqlx::query_as(
        "select jsonb_strip_nulls(jsonb_build_object('bindingId',b.id,'bindingVersion',b.version,
            'tenantId',b.tenant_id,'workspaceId',b.workspace_id,'componentReleaseId',b.component_release_id,
            'servicePrincipalId',b.service_principal_id,'adapterServiceRef',b.adapter_service_ref,
            'nativeInstanceRef',b.native_instance_ref,'nativeScopeRef',b.native_scope_ref,
            'isolationMode',b.isolation_mode,'configDigest',b.config_digest,
            'normalizedConfig',b.normalized_config,'secretRefs',b.secret_refs)),r.manifest,p.validation_keys,p.observation
         from catalog.application_binding b join projection.application_runtime p on p.binding_id=b.id
          and p.action_execution_id=b.created_by_action_execution_id
         join catalog.component_release r on r.id=b.component_release_id and r.status='APPROVED'
         where b.id=$1 and b.tenant_id=$2 and b.workspace_id is not distinct from $3
          and b.projection_action_execution_id=$4 and b.state='PROVISIONING' and p.state='PENDING'
          and p.normalized_manifest_digest=r.manifest_digest for share of b,p,r")
        .bind(ae.target_id).bind(ae.tenant_id).bind(ae.workspace_id).bind(ae.id).fetch_optional(&mut *tx).await?;
    let (binding, manifest, keys, previous) = row.ok_or_else(conflict)?;
    if previous.is_some() {
        tx.commit().await?;
        return Ok(());
    }
    tx.commit().await?;
    let observed = native::validate(state, ae, &binding, &manifest, &keys).await?;
    let mut tx = state.pool.begin().await?;
    let current:Option<Value>=sqlx::query_scalar(
        "select p.observation from catalog.application_binding b join projection.application_runtime p on p.binding_id=b.id
         where b.id=$1 and b.projection_action_execution_id=$2 and b.version=$3 and b.state='PROVISIONING'
          and p.action_execution_id=$2 and p.state='PENDING' and p.validation_keys=$4 for update of b,p")
        .bind(ae.target_id).bind(ae.id).bind(binding["bindingVersion"].as_i64().ok_or_else(invalid)? as i32)
        .bind(&keys).fetch_optional(&mut *tx).await?.ok_or_else(conflict)?;
    if let Some(current) = current {
        if current != observed {
            return Err(conflict());
        }
    } else {
        sqlx::query("update projection.application_runtime set observation=$1
            where binding_id=$2 and action_execution_id=$3 and state='PENDING' and observation is null")
            .bind(&observed).bind(ae.target_id).bind(ae.id).execute(&mut *tx).await?;
        let def =
            crate::governance::exact_definition(&state.pool, &ae.action_key, ae.action_version)
                .await?;
        crate::audit::append(
            &mut tx,
            crate::audit::AuditEntry {
                event_key: format!("{}:binding:validation", ae.id),
                tenant_id: Some(ae.tenant_id),
                workspace_id: ae.workspace_id,
                operation_id: ae.operation_id,
                event_type: "RECONCILIATION",
                human_identity_id: None,
                initiator_principal_id: Some(ae.initiator_principal_id),
                actor_principal_id: Some(ae.actor_principal_id),
                action_key: &ae.action_key,
                action_version: ae.action_version,
                component_type_key: &def.component_type_key,
                target_type: Some("APPLICATION_BINDING"),
                target_id: Some(ae.target_id),
                parameter_hash: &ae.parameter_hash,
                decision: "NONE",
                result_code: "SUCCEEDED",
                result_exposure: &def.result_exposure,
                evidence_refs: vec![crate::audit::Evidence::new(
                    contracts::EvidenceKind::ActionExecutionId,
                    ae.id,
                )],
                correlation_id: ae.correlation_id,
            },
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod binding_admission_tests {
    use super::*;

    #[test]
    fn selected_category_cannot_publish_an_unimplemented_execution_mode() {
        let contract = json!({"operationContracts":[{"contractKey":"files.read@v1"}]});
        let manifest = json!({"actionDefinitions":[{"actionKey":"files.read@v1","executionMode":"SYNC","confirmationMode":"NONE"},
            {"actionKey":"optional.edit@v1","executionMode":"TEMPORAL","confirmationMode":"EXPLICIT"}]});
        enabled_operations(&manifest, &contract).unwrap();
        for (field, value) in [
            ("executionMode", "TEMPORAL"),
            ("executionMode", "PROTOCOL"),
            ("executionMode", "UNKNOWN"),
            ("confirmationMode", "EXPLICIT"),
            ("confirmationMode", "UNKNOWN"),
        ] {
            let mut changed = manifest.clone();
            changed["actionDefinitions"][0][field] = json!(value);
            assert!(enabled_operations(&changed, &contract).is_err());
        }
        let mut approval = manifest.clone();
        approval["actionDefinitions"][0]["confirmationMode"] = json!("APPROVAL");
        enabled_operations(&approval, &contract).unwrap();
        let mut missing = manifest;
        missing["actionDefinitions"] = json!([]);
        assert!(enabled_operations(&missing, &contract).is_err());
    }
}
