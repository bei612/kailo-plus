//! DD-25/50/66/67：Installation 的运行查证；不从 HUMAN membership 推断 AGENT 准入。
//! Core 事实、私钥归属、fresh SpiceDB 与原生 roster 串联，任一缺失都不能启动 turn。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use collab_bridge::bridge::{Presence, Scope};
use contracts::{
    AgentInstallationAdvanceRequest, AgentInstallationAdvanceResult,
    ContentClass as AgentVersionContent, ReasonCode, TaskStatus,
};
use secret_store::{PlatformKey, SecretRef};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgConnection, PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    governance::{Definition, Execution, Governance, Params, Refusal, Target},
    service_api::{authorize, unavailable, ServiceState},
    spicedb::{Consistency, Relationship, Write},
};

const CREATE_ACTION: &str = "agent.installation.create";
const KIND: &str = "AGENT_INSTALLATION";
const EFFECTIVE_FIELDS: [&str; 7] = [
    "instructions",
    "runtimeProfileKey",
    "modelRouteResourceId",
    "memoryPolicy",
    "turnLimits",
    "parallelism",
    "replyPolicy",
];

/// Existing ActionCommand pins both parent Resource and immutable Version; no
/// second registration endpoint and no implicit current-published pointer.
pub(crate) async fn target(
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    def: &Definition,
    params: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    if def.action_key != CREATE_ACTION
        || def.target_type != "RESOURCE"
        || def.tenant_rule != "SESSION_TENANT"
        || def.workspace_rule != "WORKSPACE_REQUIRED"
        || def.permission_object_type != "workspace"
        || def.permission != "create"
        || def.execution_mode != "TEMPORAL"
        || def.workflow_kind.as_deref() != Some(KIND)
        || !matches!(
            def.confirmation_mode.as_str(),
            "NONE" | "EXPLICIT" | "APPROVAL"
        )
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let workspace = params.workspace_id.ok_or_else(invalid)?;
    let parent = params.resource_id.ok_or_else(invalid)?;
    let version = params.asset_id.ok_or_else(invalid)?;
    let active: Option<bool> = sqlx::query_scalar(&format!(
        "select w.state='ACTIVE' and t.state='ACTIVE' from identity.workspace w
         join identity.tenant t on t.id=w.tenant_id where w.id=$1 and w.tenant_id=$2{}",
        if lock { " for update of t,w" } else { "" }
    ))
    .bind(workspace)
    .bind(tenant)
    .fetch_optional(&mut *conn)
    .await?;
    if active != Some(true)
        || !crate::agent_definition::active_owner(conn, tenant, initiator).await?
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let definition = crate::agent_definition::resource(conn, tenant, parent, lock)
        .await?
        .filter(|r| {
            r.state == "ACTIVE"
                && r.projection_action_execution_id.is_none()
                && params.resource_version == Some(r.version)
        })
        .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    let definition_active: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.agent_definition
        where resource_id=$1 and status='ACTIVE')",
    )
    .bind(parent)
    .fetch_one(&mut *conn)
    .await?;
    if !definition_active {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let version = crate::agent_version::version(conn, tenant, version, lock)
        .await?
        .filter(|v| {
            v.agent_resource_id == definition.id
                && v.state == "PUBLISHED"
                && v.asset_state == "PUBLISHED"
                && v.projection_action_execution_id.is_none()
                && params.asset_version == Some(v.version)
        })
        .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    if !crate::agent_definition::active_owner(conn, tenant, definition.owner_principal_id).await?
        || !crate::agent_definition::active_owner(conn, tenant, version.owner_principal_id).await?
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    Ok(Target {
        id: frozen.unwrap_or_else(Uuid::new_v4),
        version: 0,
        workspace_id: Some(workspace),
    })
}

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

async fn check(
    gov: &Governance,
    principal: Uuid,
    object_type: &str,
    object: Uuid,
    permission: &str,
) -> Result<String, Refusal> {
    let proof = gov
        .spicedb
        .check(
            object_type,
            &object.to_string(),
            permission,
            &principal.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Installation fresh authorization 不可查证".into()))?;
    if proof.zed_token.is_empty() {
        return Err(Refusal::Unavailable(
            "Installation authorization 缺 checked revision".into(),
        ));
    }
    if !proof.allowed {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    Ok(proof.zed_token)
}

/// Called inside the existing admission transaction. The ActionExecution owns
/// every identity/projection intent before any OpenBao, SpiceDB or Buzz write.
pub(crate) async fn prewrite(
    gov: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    params: &Params,
) -> Result<i32, Refusal> {
    let workspace = ae.workspace_id.ok_or_else(invalid)?;
    let parent = params.resource_id.ok_or_else(invalid)?;
    let version_id = params.asset_id.ok_or_else(invalid)?;
    check(
        gov,
        ae.initiator_principal_id,
        "workspace",
        workspace,
        "create",
    )
    .await?;
    check(
        gov,
        ae.initiator_principal_id,
        "asset",
        version_id,
        "consume",
    )
    .await?;
    let member: Option<i32> = sqlx::query_scalar(
        "select 1 from identity.workspace_membership
        where workspace_id=$1 and tenant_principal_id=$2 and state='ACTIVE' for update",
    )
    .bind(workspace)
    .bind(ae.initiator_principal_id)
    .fetch_optional(&mut **tx)
    .await?;
    if member.is_none() {
        check(
            gov,
            ae.initiator_principal_id,
            "workspace",
            workspace,
            "manage",
        )
        .await?;
    }
    if !crate::agent_definition::active_owner(tx, ae.tenant_id, ae.initiator_principal_id).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let registered: bool = sqlx::query_scalar("select exists(select 1 from catalog.resource_type_definition
        where type_key='agent.installation' and status='ACTIVE' and tenant_delete_action_key='tenant.delete'
          and jsonb_path_exists(incremental_contracts,'$[*] ? (@.role == \"NATIVE_INTERNAL\" && @.engine == \"NATIVE\")'))")
        .fetch_one(&mut **tx).await?;
    if !registered {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let version = crate::agent_version::version(tx, ae.tenant_id, version_id, true)
        .await?
        .filter(|v| {
            v.agent_resource_id == parent
                && v.state == "PUBLISHED"
                && v.asset_state == "PUBLISHED"
                && v.projection_action_execution_id.is_none()
                && params.asset_version == Some(v.version)
        })
        .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    let content: AgentVersionContent =
        serde_json::from_value(version.content.clone()).map_err(|_| invalid())?;
    let (requested, content_hash) = crate::agent_version::content(&content)?;
    if version.config_hash != content_hash {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    if !content.skill_version_asset_ids.is_empty() || !content.declared_tool_resource_ids.is_empty()
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let route = Uuid::parse_str(&content.model_route_resource_id).map_err(|_| invalid())?;
    let route_scope: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.resource
        where id=$1 and tenant_id=$2 and type_key='llm_route'
          and (home_workspace_id is null or home_workspace_id=$3))",
    )
    .bind(route)
    .bind(ae.tenant_id)
    .bind(workspace)
    .fetch_one(&mut **tx)
    .await?;
    if !route_scope {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let mut triggers = Vec::new();
    for trigger in &content.trigger_defaults {
        let value = serde_json::to_value(trigger).map_err(|_| invalid())?;
        let value = value
            .as_str()
            .filter(|v| matches!(*v, "MENTION" | "MANUAL_ASSIGNMENT"))
            .ok_or_else(invalid)?
            .to_owned();
        if !triggers.contains(&value) {
            triggers.push(value);
        }
    }
    if triggers.is_empty() {
        return Err(invalid());
    }
    let mut fields = Vec::new();
    for key in EFFECTIVE_FIELDS {
        let value = requested.get(key).ok_or_else(invalid)?;
        let hash = hex::encode(Sha256::digest(
            serde_json::to_vec(value).map_err(|_| invalid())?,
        ));
        fields.push(serde_json::json!({"fieldKey":key,"requestedValueHash":hash,
            "effectiveValueHash":null,"source":"AGENT_VERSION","reasonCode":"PROJECTION_FAILED"}));
    }
    // Only a pending requested projection. Native model/permissions/runtime and
    // memory must still be proven by the existing readiness consumer.
    let projection = crate::agent_version::canonical(serde_json::json!({
        "installationResourceId":ae.target_id,"generation":1,"agentVersionAssetId":version_id,
        "runtimeProfileKey":content.runtime_profile_key,"modelRouteResourceId":route,
        "gatewayResourceIds":[route],"skillRootRef":null,"effectiveFields":fields}));
    let hash = hex::encode(Sha256::digest(
        serde_json::to_vec(&projection).map_err(|_| invalid())?,
    ));
    let principal = Uuid::new_v4();
    sqlx::query(
        "insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'AGENT','ACTIVE')",
    )
    .bind(principal)
    .bind(ae.tenant_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query("insert into catalog.resource(id,tenant_id,type_key,home_workspace_id,owner_principal_id,
        component_type_key,native_type,native_id,state,version,projection_action_execution_id)
        values($1,$2,'agent.installation',$3,$4,'core','agent.installation',$1::text,'PROVISIONING',1,$5)")
        .bind(ae.target_id).bind(ae.tenant_id).bind(workspace).bind(ae.initiator_principal_id)
        .bind(ae.id).execute(&mut **tx).await?;
    sqlx::query(
        "insert into catalog.agent_installation(resource_id,workspace_id,agent_resource_id,
        pinned_version_asset_id,agent_principal_id,runtime_isolation_ref,state)
        values($1,$2,$3,$4,$5,$1::text,'PROVISIONING')",
    )
    .bind(ae.target_id)
    .bind(workspace)
    .bind(parent)
    .bind(version_id)
    .bind(principal)
    .execute(&mut **tx)
    .await?;
    sqlx::query("insert into catalog.channel_agent_binding(workspace_id,installation_resource_id,triggers,status)
        values($1,$2,$3,'DISABLED')")
        .bind(workspace).bind(ae.target_id).bind(triggers).execute(&mut **tx).await?;
    sqlx::query(
        "insert into catalog.agent_runtime_projection(installation_resource_id,generation,
        agent_version_asset_id,runtime_profile_key,model_route_resource_id,gateway_resource_ids,
        effective_fields,config_hash,state) values($1,1,$2,$3,$4,$5,$6,$7,'PENDING')",
    )
    .bind(ae.target_id)
    .bind(version_id)
    .bind(&content.runtime_profile_key)
    .bind(route)
    .bind(vec![route])
    .bind(serde_json::Value::Array(fields))
    .bind(hash)
    .execute(&mut **tx)
    .await?;
    Ok(1)
}

#[derive(Serialize)]
struct InstallationEnvelope {
    installation: contracts::AgentInstallationWorkflowTarget,
}

pub(crate) async fn start(
    pool: &PgPool,
    temporal: &crate::temporal::TemporalClient,
    action: Uuid,
    tenant: Uuid,
    workflow_id: &str,
) -> Result<crate::membership_lifecycle::LifecycleResponse, Response> {
    let target: Option<(Uuid, Uuid, i64)> = sqlx::query_as("select i.resource_id,i.pinned_version_asset_id,p.generation
        from catalog.agent_installation i join catalog.resource r on r.id=i.resource_id
        join admission.action_execution ae on ae.id=r.projection_action_execution_id
        join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
          and p.agent_version_asset_id=i.pinned_version_asset_id and p.state='PENDING'
        where ae.id=$1 and ae.tenant_id=$2 and ae.target_id=i.resource_id and ae.workspace_id=i.workspace_id
          and ae.action_key=$3 and ae.gate_state='ALLOWED' and ae.dispatch_state in ('NOT_DISPATCHED','UNKNOWN','DISPATCHED')
          and i.state='PROVISIONING' and r.state='PROVISIONING' and r.tenant_id=ae.tenant_id
          and ae.temporal_workflow_id=$4")
        .bind(action).bind(tenant).bind(CREATE_ACTION).bind(workflow_id).fetch_optional(pool).await.map_err(unavailable)?;
    let Some((installation, version, generation)) = target else {
        return Err(StatusCode::CONFLICT.into_response());
    };
    let expected = crate::component_task::workflow_id(KIND, tenant, &installation.to_string(), 1);
    if expected != workflow_id || generation != 1 {
        return Err(StatusCode::CONFLICT.into_response());
    }
    let input = crate::component_task::ComponentTaskInput {
        kind: KIND.into(),
        target: InstallationEnvelope {
            installation: contracts::AgentInstallationWorkflowTarget {
                action_execution_id: action.to_string(),
                installation_id: installation.to_string(),
                agent_version_asset_id: version.to_string(),
                projection_generation: generation,
            },
        },
    };
    let run_id =
        crate::component_task::start(pool, temporal, workflow_id, tenant, action, &input).await?;
    Ok(crate::membership_lifecycle::LifecycleResponse {
        workflow_id: workflow_id.into(),
        kind: KIND.into(),
        run_id,
    })
}

#[derive(FromRow)]
struct Creation {
    tenant_id: Uuid,
    workspace_id: Uuid,
    owner_principal_id: Uuid,
    agent_resource_id: Uuid,
    pinned_version_asset_id: Uuid,
    agent_principal_id: Uuid,
    state: String,
    resource_state: String,
    projection_action_execution_id: Option<Uuid>,
}

const CREATION: &str = "select r.tenant_id,i.workspace_id,r.owner_principal_id,i.agent_resource_id,
    i.pinned_version_asset_id,i.agent_principal_id,i.state,r.state as resource_state,r.projection_action_execution_id
    from catalog.agent_installation i join catalog.resource r on r.id=i.resource_id
    where i.resource_id=$1 and r.type_key='agent.installation' and r.home_workspace_id=i.workspace_id";

/// Only the authenticated Worker advances the existing ActionExecution and
/// ComponentTaskWorkflow. A successful HTTP response is not installation ready.
pub(crate) async fn advance(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<AgentInstallationAdvanceRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(response) = authorize(&state, &headers).await {
        return response;
    }
    let Ok(Json(input)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let (Ok(id), Ok(action), Ok(version), Ok(_)) = (
        Uuid::parse_str(&input.installation_id),
        Uuid::parse_str(&input.action_execution_id),
        Uuid::parse_str(&input.agent_version_asset_id),
        Uuid::parse_str(&input.run_id),
    ) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if input.projection_generation != 1 {
        return StatusCode::CONFLICT.into_response();
    }
    let ae = match crate::governance::load_execution(&state.pool, action).await {
        Ok(Some(ae)) => ae,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(error) => return unavailable(error),
    };
    if ae.target_id != id
        || ae.action_key != CREATE_ACTION
        || ae.temporal_workflow_id.as_deref() != Some(input.workflow_id.as_str())
    {
        return StatusCode::CONFLICT.into_response();
    }
    let reference: Option<Option<String>> = match sqlx::query_scalar(
        "select run_id from projection.workflow_ref where workflow_id=$1 and tenant_id=$2
         and action_execution_id=$3 and operation_id=$4 and workflow_type=$5 and kind=$6",
    )
    .bind(&input.workflow_id)
    .bind(ae.tenant_id)
    .bind(action)
    .bind(ae.operation_id)
    .bind(crate::component_task::WORKFLOW_TYPE)
    .bind(KIND)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(value) => value,
        Err(error) => return unavailable(error),
    };
    let Some(Some(first_run)) = reference else {
        return creation_result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT");
    };
    let observed = match state.temporal.describe(&input.workflow_id).await {
        Ok(Some(observed)) => observed,
        _ => return creation_result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT"),
    };
    if !matches!(observed.state, crate::temporal::ObservedState::Open)
        || observed.run_id != input.run_id
        || observed.first_run_id.is_empty()
        || (first_run != observed.first_run_id && first_run != observed.run_id)
    {
        return StatusCode::CONFLICT.into_response();
    }
    let row: Creation = match sqlx::query_as(CREATION)
        .bind(id)
        .fetch_optional(&state.pool)
        .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(error) => return unavailable(error),
    };
    if row.tenant_id != ae.tenant_id
        || Some(row.workspace_id) != ae.workspace_id
        || row.pinned_version_asset_id != version
    {
        return StatusCode::CONFLICT.into_response();
    }
    if row.state == "ACTIVE"
        && row.resource_state == "ACTIVE"
        && row.projection_action_execution_id.is_none()
        && ae.dispatch_state == "DISPATCHED"
    {
        // The lifecycle terminal is initialization evidence, not merely an
        // ACTIVE row inherited from another action or projection generation.
        let ready: bool = match sqlx::query_scalar(
            "select exists(select 1 from catalog.agent_installation i
            join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
              and p.generation=i.active_projection_generation and p.state='ACTIVE'
            where i.resource_id=$1 and p.agent_version_asset_id=$2 and p.generation=$3)",
        )
        .bind(id)
        .bind(version)
        .bind(input.projection_generation)
        .fetch_one(&state.pool)
        .await
        {
            Ok(ready) => ready,
            Err(error) => return unavailable(error),
        };
        if ready {
            return creation_result(id, TaskStatus::Completed, "NONE");
        }
    }
    if input.cancel_requested {
        // Stop new admission immediately. Native key/model/roster retirement is
        // not proven by cancel accepted or by killing a child; remain UNKNOWN.
        let mut tx = match state.pool.begin().await {
            Ok(tx) => tx,
            Err(error) => return unavailable(error),
        };
        if let Err(error) = sqlx::query(
            "update catalog.agent_installation set state='DRAINING'
            where resource_id=$1 and pinned_version_asset_id=$2 and state='PROVISIONING'",
        )
        .bind(id)
        .bind(version)
        .execute(&mut *tx)
        .await
        {
            return unavailable(error);
        }
        if let Err(error) = sqlx::query(
            "update catalog.channel_agent_binding set status='DISABLED'
            where installation_resource_id=$1",
        )
        .bind(id)
        .execute(&mut *tx)
        .await
        {
            return unavailable(error);
        }
        if let Err(error) = tx.commit().await {
            return unavailable(error);
        }
        if let Some(runtime) = &state.agent_runtime {
            let _ = runtime.stop(id).await;
        }
        return creation_result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT");
    }
    match create_projection(&state, id, action).await {
        Ok(()) => {}
        Err(error) => {
            tracing::warn!(installation=%id,reason=?error.reason(),"Installation creation 对账未闭合");
            return creation_result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT");
        }
    }
    match initialize(&state, id, version, input.projection_generation, true).await {
        Ok(()) => creation_result(id, TaskStatus::Completed, "NONE"),
        Err(error) => {
            tracing::warn!(installation=%id,reason=?error.reason(),"Installation readiness 未闭合");
            creation_result(id, TaskStatus::Running, "UNKNOWN_EXTERNAL_RESULT")
        }
    }
}

fn creation_result(id: Uuid, status: TaskStatus, waiting: &str) -> Response {
    Json(AgentInstallationAdvanceResult {
        installation_id: id.to_string(),
        status,
        waiting_reason: waiting.into(),
    })
    .into_response()
}

/// Reuses the already admitted immutable action and native identity primitive.
/// Row locks serialize competing advances and fence Tenant/Workspace changes
/// throughout external projection; an unknown write is only read/converged at
/// its original deterministic reference on the next round.
async fn create_projection(
    state: &ServiceState,
    installation: Uuid,
    action: Uuid,
) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, action).await?;
    let tenant_active: Option<bool> =
        sqlx::query_scalar("select state='ACTIVE' from identity.tenant where id=$1 for update")
            .bind(ae.tenant_id)
            .fetch_optional(&mut *tx)
            .await?;
    let workspace_active: Option<bool> = sqlx::query_scalar(
        "select state='ACTIVE' from identity.workspace
        where id=$1 and tenant_id=$2 for update",
    )
    .bind(ae.workspace_id)
    .bind(ae.tenant_id)
    .fetch_optional(&mut *tx)
    .await?;
    if tenant_active != Some(true) || workspace_active != Some(true) {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let def =
        crate::governance::exact_definition(&state.pool, &ae.action_key, ae.action_version).await?;
    let row: Creation = sqlx::query_as(&format!("{CREATION} for update of i,r"))
        .bind(installation)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    if ae.action_key != CREATE_ACTION
        || def.action_key != CREATE_ACTION
        || def.target_type != "RESOURCE"
        || def.tenant_rule != "SESSION_TENANT"
        || def.workspace_rule != "WORKSPACE_REQUIRED"
        || def.permission_object_type != "workspace"
        || def.permission != "create"
        || def.execution_mode != "TEMPORAL"
        || def.workflow_kind.as_deref() != Some(KIND)
        || !matches!(
            def.confirmation_mode.as_str(),
            "NONE" | "EXPLICIT" | "APPROVAL"
        )
        || ae.target_id != installation
        || ae.tenant_id != row.tenant_id
        || ae.workspace_id != Some(row.workspace_id)
        || ae.actor_principal_id != ae.initiator_principal_id
        || ae.gate_state != "ALLOWED"
        || !matches!(
            ae.dispatch_state.as_str(),
            "NOT_DISPATCHED" | "UNKNOWN" | "DISPATCHED"
        )
        || row.state != "PROVISIONING"
        || row.resource_state != "PROVISIONING"
        || row.projection_action_execution_id != Some(action)
    {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let params = ae
        .parameters
        .as_ref()
        .and_then(|v| v.get("params"))
        .and_then(Params::from_json)
        .ok_or_else(invalid)?;
    if params.resource_id != Some(row.agent_resource_id)
        || params.asset_id != Some(row.pinned_version_asset_id)
        || params.workspace_id != Some(row.workspace_id)
    {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    // This is the already persisted installation for this exact AE, not a new
    // install. Retirement may advance management versions and clear the parent
    // pointer, but it cannot change this installation's immutable Version pin.
    let definition =
        crate::agent_definition::resource(&mut tx, row.tenant_id, row.agent_resource_id, true)
            .await?
            .filter(|r| r.state == "ACTIVE" && r.projection_action_execution_id.is_none())
            .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    let definition_active: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.agent_definition
        where resource_id=$1 and status='ACTIVE')",
    )
    .bind(definition.id)
    .fetch_one(&mut *tx)
    .await?;
    let version =
        crate::agent_version::version(&mut tx, row.tenant_id, row.pinned_version_asset_id, true)
            .await?
            .filter(|v| {
                v.agent_resource_id == definition.id
                    && matches!(v.state.as_str(), "PUBLISHED" | "RETIRED")
                    && v.asset_state == v.state
                    && v.projection_action_execution_id.is_none()
            })
            .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    if !definition_active
        || !crate::agent_definition::active_owner(&mut tx, row.tenant_id, ae.initiator_principal_id)
            .await?
        || !crate::agent_definition::active_owner(
            &mut tx,
            row.tenant_id,
            definition.owner_principal_id,
        )
        .await?
        || !crate::agent_definition::active_owner(
            &mut tx,
            row.tenant_id,
            version.owner_principal_id,
        )
        .await?
        || !crate::agent_definition::active_owner(&mut tx, row.tenant_id, row.owner_principal_id)
            .await?
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let agent: Option<i32> = sqlx::query_scalar(
        "select 1 from identity.principal
        where id=$1 and tenant_id=$2 and kind='AGENT' and status='ACTIVE' for update",
    )
    .bind(row.agent_principal_id)
    .bind(row.tenant_id)
    .fetch_optional(&mut *tx)
    .await?;
    if agent.is_none() {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    dispatched(state, &ae, &def).await?;
    check(
        &state.governance,
        ae.initiator_principal_id,
        "workspace",
        row.workspace_id,
        "create",
    )
    .await?;
    check(
        &state.governance,
        ae.initiator_principal_id,
        "asset",
        row.pinned_version_asset_id,
        "consume",
    )
    .await?;
    let member: Option<i32> = sqlx::query_scalar(
        "select 1 from identity.workspace_membership
        where workspace_id=$1 and tenant_principal_id=$2 and state='ACTIVE' for update",
    )
    .bind(row.workspace_id)
    .bind(ae.initiator_principal_id)
    .fetch_optional(&mut *tx)
    .await?;
    if member.is_none() {
        check(
            &state.governance,
            ae.initiator_principal_id,
            "workspace",
            row.workspace_id,
            "manage",
        )
        .await?;
    }
    crate::service_api::audit_gate(state)
        .await
        .map_err(|_| Refusal::Unavailable("Installation OpenBao audit 未查证".into()))?;
    let locator = state.secrets.tenant_locator(
        row.tenant_id,
        &format!("buzz-agent/installation/{installation}"),
    );
    // The committed Resource projection intent and immutable Installation IDs
    // freeze this locator. This primitive performs CAS=0, then reads version 1;
    // it never retries an unknown write as a second key or locator.
    let pubkey = crate::server_keys::read_or_write_provision_key(state, &locator)
        .await
        .map_err(|_| Refusal::Unavailable("Installation AGENT key 查证不明".into()))?;
    sqlx::query("insert into identity.buzz_identity_binding(tenant_id,principal_id,pubkey,custody,
        private_key_secret_ref,private_key_secret_version,private_key_secret_audience,private_key_secret_status,
        kind,state,version) values($1,$2,$3,'SERVER',$4,1,$5,'ACTIVE','AGENT','RECONCILING',1)
        on conflict(pubkey) do nothing")
        .bind(row.tenant_id).bind(row.agent_principal_id).bind(&pubkey).bind(&locator)
        .bind(&state.secret_audience).execute(&mut *tx).await?;
    let bound: bool = sqlx::query_scalar("select exists(select 1 from identity.buzz_identity_binding
        where tenant_id=$1 and principal_id=$2 and pubkey=$3 and custody='SERVER' and kind='AGENT'
          and private_key_secret_ref=$4 and private_key_secret_version=1 and private_key_secret_audience=$5
          and private_key_secret_status='ACTIVE' and state in ('RECONCILING','ACTIVE'))")
        .bind(row.tenant_id).bind(row.agent_principal_id).bind(&pubkey).bind(&locator)
        .bind(&state.secret_audience).fetch_one(&mut *tx).await?;
    if !bound {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let (control, _) = crate::tenant_lifecycle::control_client(
        state,
        row.tenant_id,
        crate::tenant_lifecycle::ProjectionDirection::Establish,
    )
    .await
    .map_err(|_| Refusal::Unavailable("Installation CONTROL binding 未就绪".into()))?;
    let channel: Uuid = sqlx::query_scalar(
        "select wb.channel_id from projection.workspace_buzz_binding wb
        where wb.workspace_id=$1 and wb.state='ACTIVE' for update",
    )
    .bind(row.workspace_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(Refusal::Unavailable(
        "Installation Channel projection 未就绪".into(),
    ))?;
    sqlx::query("insert into catalog.agent_memory_binding(installation_resource_id,agent_buzz_identity_binding_id,
        memory_counterparty_buzz_identity_binding_id,listing_state,head_state,state,version)
        values($1,$2,$3,'UNKNOWN','UNKNOWN','PROVISIONING',1) on conflict do nothing")
        .bind(installation).bind(&pubkey).bind(control.pubkey_hex()).execute(&mut *tx).await?;
    let memory: bool = sqlx::query_scalar("select exists(select 1 from catalog.agent_memory_binding
        where installation_resource_id=$1 and agent_buzz_identity_binding_id=$2
          and memory_counterparty_buzz_identity_binding_id=$3 and state in ('PROVISIONING','ACTIVE','ERROR'))")
        .bind(installation).bind(&pubkey).bind(control.pubkey_hex()).fetch_one(&mut *tx).await?;
    if !memory {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let observed =
        crate::agent_memory::reconcile(state, &mut tx, installation, &state.agent_memory).await?;
    let memory_ready: bool = sqlx::query_scalar("select exists(select 1 from catalog.agent_memory_binding
        where installation_resource_id=$1 and state='ACTIVE' and listing_state='COMPLETE' and head_state='CONSISTENT')")
        .bind(installation).fetch_one(&mut *tx).await?;
    if !observed || !memory_ready {
        // Persist the actual identity and counterparty, but do not expose a
        // member in native Channel discovery without the required memory facts.
        projection_audit(
            &mut tx,
            &ae,
            &def,
            "identity",
            "INSTALLATION_IDENTITY_BOUND",
            vec![crate::audit::Evidence::new(
                contracts::EvidenceKind::BuzzPubkey,
                pubkey,
            )],
        )
        .await?;
        tx.commit().await?;
        return Ok(());
    }
    state
        .governance
        .spicedb
        .replace_resource_projection(
            &installation.to_string(),
            &row.tenant_id.to_string(),
            &row.owner_principal_id.to_string(),
            &row.owner_principal_id.to_string(),
            Some(&row.workspace_id.to_string()),
        )
        .await
        .map_err(|_| Refusal::Unavailable("Installation SpiceDB projection 结果不明".into()))?;
    state
        .governance
        .spicedb
        .write(&[(
            Write::Touch,
            Relationship {
                object_type: "workspace".into(),
                object_id: row.workspace_id.to_string(),
                relation: "member".into(),
                subject_principal: row.agent_principal_id.to_string(),
            },
        )])
        .await
        .map_err(|_| Refusal::Unavailable("Installation Workspace projection 结果不明".into()))?;
    if !state
        .governance
        .spicedb
        .resource_projection_matches_in_workspace(
            &installation.to_string(),
            &row.tenant_id.to_string(),
            &row.owner_principal_id.to_string(),
            Some(&row.workspace_id.to_string()),
            state.governance.cfg.relationship_page,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Installation projection 回读不明".into()))?
    {
        return Err(Refusal::Unavailable(
            "Installation projection 回读不一致".into(),
        ));
    }
    check(
        &state.governance,
        row.agent_principal_id,
        "workspace",
        row.workspace_id,
        "discover",
    )
    .await?;
    control
        .converge(&state.http, Scope::Relay, &pubkey, Presence::Present)
        .await
        .map_err(|_| Refusal::Unavailable("Installation Relay roster 结果不明".into()))?;
    control
        .converge(
            &state.http,
            Scope::Channel(&channel.to_string()),
            &pubkey,
            Presence::Present,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Installation Channel roster 结果不明".into()))?;
    // No trigger is enabled here. Readiness alone activates ChannelAgentBinding.
    sqlx::query(
        "update identity.buzz_identity_binding set state='ACTIVE'
        where pubkey=$1 and principal_id=$2 and state='RECONCILING'",
    )
    .bind(&pubkey)
    .bind(row.agent_principal_id)
    .execute(&mut *tx)
    .await?;
    projection_audit(
        &mut tx,
        &ae,
        &def,
        "roster",
        "INSTALLATION_IDENTITY_PROJECTED",
        vec![crate::audit::Evidence::new(
            contracts::EvidenceKind::BuzzPubkey,
            pubkey,
        )],
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

// Temporal Start is dispatch; initialization is the later business result. A
// recorded run also covers the short interval before the dispatch writeback.
// No approval boolean or post-consume deadline is a second admission authority.
async fn dispatched(state: &ServiceState, ae: &Execution, def: &Definition) -> Result<(), Refusal> {
    let workflow = ae.temporal_workflow_id.as_deref().ok_or_else(invalid)?;
    let run: Option<Option<String>> = sqlx::query_scalar(
        "select run_id from projection.workflow_ref
        where workflow_id=$1 and action_execution_id=$2 and tenant_id=$3 and operation_id=$4
          and workflow_type='ComponentTaskWorkflow' and kind='AGENT_INSTALLATION'
          and projection_state='RUNNING'",
    )
    .bind(workflow)
    .bind(ae.id)
    .bind(ae.tenant_id)
    .bind(ae.operation_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some(Some(run)) = run else {
        return Err(Refusal::Unavailable("Installation dispatch 未查证".into()));
    };
    let observed = state
        .temporal
        .describe(workflow)
        .await
        .map_err(|_| Refusal::Unavailable("Installation Temporal run 不可查证".into()))?
        .ok_or(Refusal::Unavailable(
            "Installation Temporal run 缺失".into(),
        ))?;
    if !matches!(observed.state, crate::temporal::ObservedState::Open)
        || observed.first_run_id.is_empty()
        || (run != observed.first_run_id && run != observed.run_id)
    {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    match (
        &ae.approval_workflow_id,
        def.approval_policy_id,
        def.approval_policy_version,
    ) {
        (None, None, None) if def.confirmation_mode != "APPROVAL" => Ok(()),
        (Some(workflow), Some(_), Some(_)) => {
            let consumed: bool = sqlx::query_scalar("select exists(select 1 from projection.approval_projection p
                join projection.workflow_ref f on f.workflow_id=p.workflow_id
                where p.workflow_id=$1 and f.workflow_type='ApprovalWorkflow' and f.action_execution_id=$2
                  and f.tenant_id=$3 and f.operation_id=$4 and f.run_id is not null
                  and p.status='CONSUMED' and p.consumed_at is not null)")
                .bind(workflow).bind(ae.id).bind(ae.tenant_id).bind(ae.operation_id)
                .fetch_one(&state.pool).await?;
            if consumed {
                Ok(())
            } else {
                Err(Refusal::Unavailable(
                    "Installation 等待原 Temporal Approval consume 查证".into(),
                ))
            }
        }
        _ => Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)),
    }
}

async fn projection_audit(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    phase: &str,
    result: &str,
    evidence: Vec<crate::audit::Evidence>,
) -> Result<(), sqlx::Error> {
    crate::audit::append(
        tx,
        crate::audit::AuditEntry {
            event_key: format!("{}:installation:{phase}", ae.id),
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
            target_type: Some("RESOURCE"),
            target_id: Some(ae.target_id),
            parameter_hash: &ae.parameter_hash,
            decision: "NONE",
            result_code: result,
            result_exposure: &def.result_exposure,
            evidence_refs: evidence,
            correlation_id: ae.correlation_id,
        },
    )
    .await
}

/// 仅 Core 内部传递的已查证引用；无 prompt、credential 或第二份记忆正文。
pub(crate) struct RuntimeFacts {
    pub tenant_id: Uuid,
    pub workspace_id: Uuid,
    snapshot: InstallationRow,
    pub projection_config_hash: String,
    pub content: AgentVersionContent,
}

#[derive(FromRow, PartialEq)]
struct InstallationRow {
    tenant_id: Uuid,
    workspace_id: Uuid,
    owner_principal_id: Uuid,
    agent_principal_id: Uuid,
    resource_version: i32,
    projection_action_execution_id: Option<Uuid>,
    config_hash: String,
    version_config_hash: String,
    runtime_profile_key: String,
    model_route_resource_id: Uuid,
    gateway_resource_ids: Vec<Uuid>,
    skill_root_ref: Option<String>,
    effective_fields: serde_json::Value,
    content: serde_json::Value,
    agent_pubkey: String,
    agent_locator: String,
    agent_secret_version: i32,
    agent_audience: String,
    agent_binding_version: i32,
    counterparty_pubkey: String,
    counterparty_locator: String,
    counterparty_secret_version: i32,
    counterparty_audience: String,
    counterparty_binding_version: i32,
    channel_id: Uuid,
    normalized_host: String,
    memory_version: i32,
}

const READY_ROW: &str = "select r.tenant_id,i.workspace_id,r.owner_principal_id,i.agent_principal_id,
    r.version as resource_version,r.projection_action_execution_id,p.config_hash,v.content,
    v.config_hash as version_config_hash,p.runtime_profile_key,p.model_route_resource_id,
    p.gateway_resource_ids,p.skill_root_ref,p.effective_fields,
    a.pubkey as agent_pubkey,a.private_key_secret_ref as agent_locator,
    a.private_key_secret_version as agent_secret_version,a.private_key_secret_audience as agent_audience,
    a.version as agent_binding_version,c.pubkey as counterparty_pubkey,
    c.private_key_secret_ref as counterparty_locator,
    c.private_key_secret_version as counterparty_secret_version,
    c.private_key_secret_audience as counterparty_audience,c.version as counterparty_binding_version,
    wb.channel_id,tb.normalized_host,m.version as memory_version
  from catalog.agent_installation i
  join catalog.resource r on r.id=i.resource_id
  join identity.tenant t on t.id=r.tenant_id and t.state='ACTIVE'
  join identity.workspace w on w.id=i.workspace_id and w.tenant_id=t.id and w.state='ACTIVE'
  join identity.principal owner on owner.id=r.owner_principal_id
    and owner.tenant_id=t.id and owner.kind='HUMAN' and owner.status='ACTIVE'
  join identity.tenant_membership om on om.tenant_principal_id=owner.id
    and om.tenant_id=t.id and om.state='ACTIVE'
  join identity.principal agent on agent.id=i.agent_principal_id
    and agent.tenant_id=t.id and agent.kind='AGENT' and agent.status='ACTIVE'
  join catalog.resource dr on dr.id=i.agent_resource_id and dr.tenant_id=t.id
    and dr.state='ACTIVE' and dr.projection_action_execution_id is null
  join catalog.agent_definition d on d.resource_id=dr.id and d.status='ACTIVE'
  join catalog.agent_version v on v.asset_id=i.pinned_version_asset_id
    and v.agent_resource_id=d.resource_id and v.state in ('PUBLISHED','RETIRED')
  join catalog.asset av on av.id=v.asset_id and av.tenant_id=t.id
    and av.state in ('PUBLISHED','RETIRED') and av.projection_action_execution_id is null
  join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
    and p.generation=$3 and p.agent_version_asset_id=v.asset_id
  join catalog.channel_agent_binding cb on cb.installation_resource_id=i.resource_id
    and cb.workspace_id=w.id and (cb.status='ACTIVE' or ($4::boolean and cb.status='DISABLED'))
  join catalog.agent_memory_binding m on m.installation_resource_id=i.resource_id
    and m.state='ACTIVE' and m.listing_state='COMPLETE' and m.head_state='CONSISTENT'
  join identity.buzz_identity_binding a on a.pubkey=m.agent_buzz_identity_binding_id
    and a.principal_id=agent.id and a.tenant_id=t.id and a.kind='AGENT'
    and a.custody='SERVER' and a.state='ACTIVE' and a.private_key_secret_status='ACTIVE'
  join projection.tenant_buzz_binding tb on tb.tenant_id=t.id and tb.state='ACTIVE'
    and tb.require_relay_membership and not tb.allow_nip_oa_auth and not tb.pubkey_allowlist_enabled
  join identity.buzz_identity_binding c on c.pubkey=m.memory_counterparty_buzz_identity_binding_id
    and c.tenant_id=t.id and c.principal_id=tb.control_service_principal_id and c.kind='CONTROL'
    and c.custody='SERVER' and c.state='ACTIVE' and c.private_key_secret_status='ACTIVE'
  join projection.workspace_buzz_binding wb on wb.workspace_id=w.id and wb.state='ACTIVE'
  where i.resource_id=$1 and i.pinned_version_asset_id=$2 and r.type_key='agent.installation'
    and r.home_workspace_id=w.id
    and ((not $4::boolean and i.state='ACTIVE' and r.state='ACTIVE'
          and p.state='ACTIVE' and i.active_projection_generation=p.generation
          and r.projection_action_execution_id is null)
      or ($4::boolean and i.state='PROVISIONING' and r.state='PROVISIONING' and p.state='PENDING'
          and exists(select 1 from admission.action_execution ae
            join catalog.action_definition d on d.action_key=ae.action_key and d.version=ae.action_version
            join projection.workflow_ref f on f.action_execution_id=ae.id and f.tenant_id=t.id
              and f.operation_id=ae.operation_id and f.workflow_id=ae.temporal_workflow_id
              and f.workflow_type='ComponentTaskWorkflow' and f.kind='AGENT_INSTALLATION'
              and f.projection_state='RUNNING' and f.run_id is not null
            where ae.id=r.projection_action_execution_id and ae.tenant_id=t.id
              and ae.workspace_id=w.id and ae.target_id=r.id and ae.gate_state='ALLOWED'
              and ae.dispatch_state in ('NOT_DISPATCHED','UNKNOWN','DISPATCHED')
              and d.execution_mode='TEMPORAL' and d.workflow_type='ComponentTaskWorkflow'
              and d.workflow_kind='AGENT_INSTALLATION' and d.capacity_policy='NONE'
              and d.quota_policy='NONE' and cardinality(d.meters)=0)))";

/// 每次 runtime/模型/工具副作用前重做；它不替代父 Action、Delegation、Quota 或 Capacity。
pub(crate) async fn admit_runtime(
    state: &ServiceState,
    installation: Uuid,
    version: Uuid,
    generation: i64,
) -> Result<RuntimeFacts, Refusal> {
    runtime_facts(state, installation, version, generation, false).await
}

// PROVISIONING 只供已有治理意图的初始化消费者，不是 turn 准入的宽松路径。
async fn runtime_facts(
    state: &ServiceState,
    installation: Uuid,
    version: Uuid,
    generation: i64,
    provisioning: bool,
) -> Result<RuntimeFacts, Refusal> {
    if generation <= 0 {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    let row: InstallationRow = sqlx::query_as(READY_ROW)
        .bind(installation)
        .bind(version)
        .bind(generation)
        .bind(provisioning)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::TargetStateConflict))?;
    let content: AgentVersionContent = serde_json::from_value(row.content.clone())
        .map_err(|_| Refusal::Unavailable("已发布 AgentVersion 不符合共享契约".into()))?;
    verify_projection(
        &row,
        installation,
        version,
        generation,
        &content,
        provisioning,
    )?;
    let mut tx = state.pool.begin().await?;
    crate::agent_version::validate_references(
        &state.governance,
        &mut tx,
        row.tenant_id,
        row.owner_principal_id,
        &content,
    )
    .await?;
    tx.commit().await?;
    let agent_secret = secret(
        &row.agent_locator,
        row.agent_secret_version,
        &row.agent_audience,
    )?;
    let counterparty_secret = secret(
        &row.counterparty_locator,
        row.counterparty_secret_version,
        &row.counterparty_audience,
    )?;
    let tenant_prefix = state.secrets.tenant_locator(row.tenant_id, "");
    let suffix = row
        .agent_locator
        .strip_prefix(&tenant_prefix)
        .ok_or(Refusal::Denied(ReasonCode::ScopeGuardFailed))?;
    if suffix.is_empty()
        || suffix
            .split('/')
            .any(|s| s.is_empty() || s == "." || s == "..")
        || !state.secrets.owns_platform_key(
            PlatformKey::Control,
            row.tenant_id,
            &row.counterparty_locator,
        )
        || row.agent_pubkey == row.counterparty_pubkey
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    crate::server_identity::read_bound_keys(&state.secrets, &agent_secret, &row.agent_pubkey)
        .await
        .map_err(|_| Refusal::Unavailable("AGENT SecretRef 与公钥查证未闭合".into()))?;
    crate::server_identity::read_bound_keys(
        &state.secrets,
        &counterparty_secret,
        &row.counterparty_pubkey,
    )
    .await
    .map_err(|_| Refusal::Unavailable("CONTROL SecretRef 与公钥查证未闭合".into()))?;
    // 首次安装的 model binding 由下方已有 provision 消费者建立；这里仍查证
    // Installation/Workspace 投影。ACTIVE 与最终激活必须包含 fresh model 权限。
    runtime_authorization(state, installation, &row, !provisioning).await?;
    let (control, host) = crate::tenant_lifecycle::control_client(
        state,
        row.tenant_id,
        crate::tenant_lifecycle::ProjectionDirection::Establish,
    )
    .await
    .map_err(|_| Refusal::Unavailable("CONTROL/Relay binding 未就绪".into()))?;
    if host != row.normalized_host || control.pubkey_hex() != row.counterparty_pubkey {
        return Err(Refusal::Unavailable("CONTROL generation 已变化".into()));
    }
    let channel_id = row.channel_id.to_string();
    for scope in [Scope::Relay, Scope::Channel(&channel_id)] {
        let roster = control
            .roster(&state.http, scope)
            .await
            .map_err(|_| Refusal::Unavailable("Agent roster 查证结果不明".into()))?;
        if !roster.iter().any(|entry| entry.pubkey == row.agent_pubkey) {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
    }
    // 网络查证期间撤权/升级不能让旧快照变成可执行证据。重读同一 generation 和版本。
    let current: InstallationRow = sqlx::query_as(READY_ROW)
        .bind(installation)
        .bind(version)
        .bind(generation)
        .bind(provisioning)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(Refusal::Denied(ReasonCode::ScopeGuardFailed))?;
    if current != row {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    Ok(RuntimeFacts {
        tenant_id: row.tenant_id,
        workspace_id: row.workspace_id,
        projection_config_hash: row.config_hash.clone(),
        content,
        snapshot: row,
    })
}

// 首次查证与 ACTIVE 写入都使用同一 fresh 边界；返回原生 revision 给终态审计。
async fn runtime_authorization(
    state: &ServiceState,
    installation: Uuid,
    row: &InstallationRow,
    model_ready: bool,
) -> Result<Vec<crate::audit::Evidence>, Refusal> {
    let spice = &state.governance.spicedb;
    if !spice
        .resource_projection_matches_in_workspace(
            &installation.to_string(),
            &row.tenant_id.to_string(),
            &row.owner_principal_id.to_string(),
            Some(&row.workspace_id.to_string()),
            state.governance.cfg.relationship_page,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()))?
    {
        return Err(Refusal::Unavailable(
            "Installation 的 SpiceDB 投影不一致".into(),
        ));
    }
    let mut evidence = Vec::new();
    let mut permissions = vec![("workspace", row.workspace_id, "discover")];
    if model_ready {
        permissions.extend([
            ("resource", row.model_route_resource_id, "discover"),
            ("resource", row.model_route_resource_id, "execute"),
        ]);
    }
    for (object_type, object, permission) in permissions {
        let checked = spice
            .check(
                object_type,
                &object.to_string(),
                permission,
                &row.agent_principal_id.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|e| Refusal::Unavailable(e.to_string()))?;
        if checked.zed_token.is_empty() {
            return Err(Refusal::Unavailable(
                "Agent runtime authorization 缺 checked revision".into(),
            ));
        }
        if !checked.allowed {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
        evidence.push(crate::audit::Evidence::new(
            contracts::EvidenceKind::SpicedbZedtoken,
            checked.zed_token,
        ));
    }
    Ok(evidence)
}

fn verify_projection(
    row: &InstallationRow,
    installation: Uuid,
    version: Uuid,
    generation: i64,
    content: &AgentVersionContent,
    pending: bool,
) -> Result<(), Refusal> {
    let unavailable =
        || Refusal::Unavailable("Agent runtime effective 投影与固定版本不一致".into());
    let (requested, hash) = crate::agent_version::content(content)?;
    if hash != row.version_config_hash
        || row.runtime_profile_key != content.runtime_profile_key
        || row.model_route_resource_id.to_string() != content.model_route_resource_id
        || row.gateway_resource_ids.is_empty()
        || row.skill_root_ref.is_some() && content.skill_version_asset_ids.is_empty()
    {
        return Err(unavailable());
    }
    let fields = row.effective_fields.as_array().ok_or_else(unavailable)?;
    if fields.len() != EFFECTIVE_FIELDS.len() {
        return Err(unavailable());
    }
    let mut keys = std::collections::HashSet::new();
    for field in fields {
        let key = field
            .get("fieldKey")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(unavailable)?;
        if !keys.insert(key)
            || !matches!(
                field.get("source").and_then(serde_json::Value::as_str),
                Some("AGENT_VERSION" | "WORKSPACE_POLICY" | "CHANNEL_BINDING" | "RUNTIME_DEFAULT")
            )
        {
            return Err(unavailable());
        }
    }
    // PENDING 允许原安装 AE 初始化候选并核对原生加载值；ACTIVE/turn 则必须
    // 全部 effective。RuntimeProfile 的上界验证不冒充尚无消费者的策略执行。
    for key in EFFECTIVE_FIELDS {
        let field = fields
            .iter()
            .find(|field| field.get("fieldKey").and_then(serde_json::Value::as_str) == Some(key))
            .ok_or_else(unavailable)?;
        let value = requested.get(key).ok_or_else(unavailable)?;
        let hash = hex::encode(Sha256::digest(
            serde_json::to_vec(value).map_err(|_| unavailable())?,
        ));
        if field
            .get("requestedValueHash")
            .and_then(serde_json::Value::as_str)
            != Some(&hash)
        {
            return Err(unavailable());
        }
        match field.get("effectiveValueHash") {
            Some(serde_json::Value::String(effective))
                if effective == &hash
                    && supports_effective_field(content, key)
                    && field
                        .get("reasonCode")
                        .is_some_and(serde_json::Value::is_null) => {}
            Some(serde_json::Value::Null)
                if pending
                    && matches!(
                        field.get("reasonCode").and_then(serde_json::Value::as_str),
                        Some(
                            "PROJECTION_FAILED" | "RUNTIME_NOT_READY" | "NOT_SUPPORTED_BY_RUNTIME"
                        )
                    ) => {}
            _ => return Err(unavailable()),
        }
    }
    if projection_hash(
        row,
        installation,
        version,
        generation,
        &row.effective_fields,
    )? != row.config_hash
    {
        return Err(unavailable());
    }
    Ok(())
}

fn projection_hash(
    row: &InstallationRow,
    installation: Uuid,
    version: Uuid,
    generation: i64,
    fields: &serde_json::Value,
) -> Result<String, Refusal> {
    let projection = crate::agent_version::canonical(serde_json::json!({
        "installationResourceId": installation, "generation": generation,
        "agentVersionAssetId": version, "runtimeProfileKey": row.runtime_profile_key,
        "modelRouteResourceId": row.model_route_resource_id,
        "gatewayResourceIds": row.gateway_resource_ids, "skillRootRef": row.skill_root_ref,
        "effectiveFields": fields
    }));
    Ok(hex::encode(Sha256::digest(
        serde_json::to_vec(&projection).map_err(|_| invalid())?,
    )))
}

// Only the actual consumers below establish support; a RuntimeProfile key in
// the directory alone does not define reply semantics or grant Memory writes.
fn supports_effective_field(content: &AgentVersionContent, key: &str) -> bool {
    match key {
        // runtime_facts checks the SERVER_CODEX profile contract; ensure then
        // verifies the loaded instructions/model route through config/read.
        "instructions" | "runtimeProfileKey" | "modelRouteResourceId" => true,
        // Both consumers load this Invocation's immutable Version: Capacity
        // serializes parallelism; Task observes native time and interrupts.
        "parallelism" | "turnLimits" => true,
        // HUMAN writes use their governed owner path; Codex memories and MCP
        // are disabled/read back by ensure. Other Agent write modes need their
        // own actual admission/approval consumer and cannot borrow this proof.
        "memoryPolicy" => {
            content.memory_policy.core_write == contracts::AgentMemoryCoreWrite::HumanOnly
                && content.memory_policy.cold_write == contracts::AgentMemoryColdWrite::Disabled
        }
        // The same release contract must explicitly map this exact key to the
        // implemented thread-only consumer. Missing/unknown/broadcast mappings
        // do not become effective merely because replyPolicies contains a key.
        "replyPolicy" => crate::agent_version::runtime_profile(content).is_ok(),
        _ => false,
    }
}

// Candidate only: it becomes evidence after ensure's native config/read and the
// locked CAS below. Unimplemented execution/write policies remain unavailable.
fn initialization_fields(
    row: &InstallationRow,
    installation: Uuid,
    version: Uuid,
    generation: i64,
    content: &AgentVersionContent,
) -> Result<(serde_json::Value, String), Refusal> {
    let mut fields = row.effective_fields.clone();
    let entries = fields.as_array_mut().ok_or_else(invalid)?;
    for field in entries {
        let key = field
            .get("fieldKey")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(invalid)?;
        if supports_effective_field(content, key) {
            let hash = field
                .get("requestedValueHash")
                .cloned()
                .ok_or_else(invalid)?;
            field["effectiveValueHash"] = hash;
            field["reasonCode"] = serde_json::Value::Null;
        } else {
            field["effectiveValueHash"] = serde_json::Value::Null;
            field["reasonCode"] = serde_json::json!("NOT_SUPPORTED_BY_RUNTIME");
        }
    }
    let hash = projection_hash(row, installation, version, generation, &fields)?;
    Ok((fields, hash))
}

fn secret(locator: &str, version: i32, audience: &str) -> Result<SecretRef, Refusal> {
    let version = u32::try_from(version)
        .ok()
        .filter(|v| *v > 0)
        .ok_or(Refusal::Unavailable("绑定缺精确 SecretRef version".into()))?;
    if locator.is_empty() || audience.is_empty() {
        return Err(Refusal::Unavailable("绑定缺 SecretRef/audience".into()));
    }
    Ok(SecretRef {
        locator: locator.into(),
        version,
        audience: audience.into(),
    })
}

/// 已有治理对账器的消费者。空库存不造安装；ACTIVE 重启恢复只重建同代进程。
pub(crate) async fn reconcile(
    state: &ServiceState,
    batch: i64,
) -> Result<Vec<&'static str>, String> {
    let Some(runtime) = state.agent_runtime.as_ref() else {
        return Ok(Vec::new());
    };
    let healthy = runtime.healthy_installations().await;
    let pending: Vec<(Uuid, Uuid, i64, bool)> = sqlx::query_as(
        "select i.resource_id,p.agent_version_asset_id,p.generation,i.state='PROVISIONING'
         from catalog.agent_installation i join catalog.resource r on r.id=i.resource_id
         join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
           and p.agent_version_asset_id=i.pinned_version_asset_id
         join identity.tenant t on t.id=r.tenant_id and t.state='ACTIVE'
         join identity.workspace w on w.id=i.workspace_id and w.tenant_id=t.id and w.state='ACTIVE'
         left join admission.action_execution ae on ae.id=r.projection_action_execution_id
         where (i.state='PROVISIONING' and r.state='PROVISIONING' and p.state='PENDING'
                  and ae.gate_state='ALLOWED' and ae.dispatch_state in ('NOT_DISPATCHED','UNKNOWN','DISPATCHED'))
           or (i.state='ACTIVE' and r.state='ACTIVE' and p.state='ACTIVE'
                  and p.generation=i.active_projection_generation
                  and not i.resource_id=any($2::uuid[]))
         order by ae.updated_at nulls last,i.resource_id,p.generation limit $1",
    )
    .bind(batch)
    .bind(&healthy)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    let mut outcomes = Vec::with_capacity(pending.len());
    for (installation, version, generation, provisioning) in pending {
        match initialize(state, installation, version, generation, provisioning).await {
            Ok(()) => outcomes.push("agent.runtime.ready"),
            Err(error) => {
                // UNKNOWN 留在原有意图中重查，不把 spawn/timeout 写成业务失败或终态。
                tracing::warn!(%installation,generation,reason=?error.reason(),
                    "Agent runtime 初始化未闭合；禁止启动新 turn");
                outcomes.push("agent.runtime.unverified");
                if provisioning {
                    sqlx::query("update admission.action_execution ae set updated_at=now()
                        from catalog.resource r where r.id=$1 and ae.id=r.projection_action_execution_id
                          and ae.gate_state='ALLOWED' and ae.dispatch_state in ('NOT_DISPATCHED','UNKNOWN','DISPATCHED')")
                        .bind(installation).execute(&state.pool).await.map_err(|e| e.to_string())?;
                }
            }
        }
    }
    Ok(outcomes)
}

async fn initialize(
    state: &ServiceState,
    installation: Uuid,
    version: Uuid,
    generation: i64,
    provisioning: bool,
) -> Result<(), Refusal> {
    let runtime = state
        .agent_runtime
        .as_ref()
        .ok_or(Refusal::Unavailable("Agent runtime 未投递".into()))?;
    let facts = runtime_facts(state, installation, version, generation, provisioning).await?;
    crate::service_api::audit_gate(state)
        .await
        .map_err(|_| Refusal::Unavailable("审计 sink 未就绪".into()))?;
    let admission = if provisioning {
        Some(initialization_admission(state, installation, &facts).await?)
    } else {
        None
    };
    let model = if let Some((ae, _, _)) = &admission {
        crate::model_route::provision(state, installation, version, generation, ae.id).await?
    } else {
        crate::model_route::resolve(state, installation, version, generation).await?
    };
    let (effective_fields, effective_hash) = if provisioning {
        initialization_fields(
            &facts.snapshot,
            installation,
            version,
            generation,
            &facts.content,
        )?
    } else {
        (
            facts.snapshot.effective_fields.clone(),
            facts.projection_config_hash.clone(),
        )
    };
    let token = state
        .secrets
        .read(&model.secret_ref, "value")
        .await
        .map_err(|_| Refusal::Unavailable("Agent 模型 SecretRef 不可查证".into()))?;
    let projection = crate::agent_runtime::Projection {
        installation_id: installation,
        generation,
        config_hash: effective_hash.clone(),
        model: model.model,
        gateway_base_url: model.gateway_base_url,
        instructions: facts.content.instructions.clone(),
    };
    // 回读关键 config 成立才可推进；既有进程匹配同代/hash 时不重启，不发 turn。
    runtime
        .ensure(&state.pool, &projection, token.expose())
        .await
        .map_err(|_| Refusal::Unavailable("Agent runtime 原生初始化结果不明".into()))?;
    let current = runtime_facts(state, installation, version, generation, provisioning).await?;
    if current.snapshot != facts.snapshot {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let Some((ae, def, _)) = admission else {
        return Ok(());
    };
    let mut tx = state.pool.begin().await?;
    let locked = crate::governance::lock_execution(&mut tx, ae.id).await?;
    // 与暂停/撤权遵循同一锁顺序；网络期间发生的变更必须在原事务边界再次拒绝。
    let tenant_active: bool =
        sqlx::query_scalar("select state='ACTIVE' from identity.tenant where id=$1 for update")
            .bind(facts.tenant_id)
            .fetch_one(&mut *tx)
            .await?;
    let workspace_active: bool = sqlx::query_scalar(
        "select state='ACTIVE' from identity.workspace where id=$1 and tenant_id=$2 for update",
    )
    .bind(facts.workspace_id)
    .bind(facts.tenant_id)
    .fetch_one(&mut *tx)
    .await?;
    if !tenant_active
        || !workspace_active
        || locked.gate_state != "ALLOWED"
        || !matches!(
            locked.dispatch_state.as_str(),
            "NOT_DISPATCHED" | "UNKNOWN" | "DISPATCHED"
        )
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    // 撤权写者持有同一 membership 行锁；不能把事务外的 ACTIVE/授权快照用于激活。
    let mut humans = vec![
        locked.initiator_principal_id,
        facts.snapshot.owner_principal_id,
    ];
    humans.sort_unstable();
    humans.dedup();
    for human in humans {
        if !crate::agent_definition::active_owner(&mut tx, facts.tenant_id, human).await? {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
    }
    let mut locked_row: InstallationRow = sqlx::query_as(&format!(
        "{READY_ROW} for update of i,r,p,agent,dr,d,av,v,cb,m,a,c,tb,wb"
    ))
    .bind(installation)
    .bind(version)
    .bind(generation)
    .bind(provisioning)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    if locked_row != facts.snapshot {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let proof = initialization_authorization(state, installation, &facts, &locked, &def).await?;
    let mut evidence = runtime_authorization(state, installation, &locked_row, true).await?;
    evidence.push(crate::audit::Evidence::new(
        contracts::EvidenceKind::SpicedbZedtoken,
        proof,
    ));
    if locked_row.effective_fields != effective_fields {
        let changed = sqlx::query(
            "update catalog.agent_runtime_projection set effective_fields=$4,config_hash=$5
            where installation_resource_id=$1 and generation=$2 and agent_version_asset_id=$3
              and state='PENDING' and config_hash=$6 and effective_fields=$7",
        )
        .bind(installation)
        .bind(generation)
        .bind(version)
        .bind(&effective_fields)
        .bind(&effective_hash)
        .bind(&locked_row.config_hash)
        .bind(&locked_row.effective_fields)
        .execute(&mut *tx)
        .await?;
        if changed.rows_affected() != 1 {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
        locked_row.effective_fields = effective_fields;
        locked_row.config_hash = effective_hash;
        verify_projection(
            &locked_row,
            installation,
            version,
            generation,
            &facts.content,
            true,
        )?;
        projection_audit(
            &mut tx,
            &locked,
            &def,
            "config",
            "INSTALLATION_RUNTIME_PARTIAL",
            evidence.clone(),
        )
        .await?;
    }
    // A successful initialize proves only loaded fields, not policy execution.
    // Preserve those facts even when missing consumers prevent ACTIVE/trigger.
    if let Err(reason) = verify_projection(
        &locked_row,
        installation,
        version,
        generation,
        &facts.content,
        false,
    ) {
        tx.commit().await?;
        return Err(reason);
    }
    let changed = sqlx::query(
        "update catalog.resource r set state='ACTIVE',version=version+1,
            projection_action_execution_id=null where r.id=$1 and r.tenant_id=$2
            and r.home_workspace_id=$3 and r.version=$4 and r.state='PROVISIONING'
            and r.projection_action_execution_id=$5",
    )
    .bind(installation)
    .bind(facts.tenant_id)
    .bind(facts.workspace_id)
    .bind(facts.snapshot.resource_version)
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let changed = sqlx::query(
        "update catalog.agent_runtime_projection set state='ACTIVE'
        where installation_resource_id=$1 and generation=$2 and agent_version_asset_id=$3
          and state='PENDING' and config_hash=$4",
    )
    .bind(installation)
    .bind(generation)
    .bind(version)
    .bind(&locked_row.config_hash)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let changed = sqlx::query(
        "update catalog.agent_installation set state='ACTIVE',active_projection_generation=$2
        where resource_id=$1 and state='PROVISIONING' and pinned_version_asset_id=$3",
    )
    .bind(installation)
    .bind(generation)
    .bind(version)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let changed = sqlx::query(
        "update catalog.channel_agent_binding set status='ACTIVE'
        where installation_resource_id=$1 and workspace_id=$2 and status='DISABLED'",
    )
    .bind(installation)
    .bind(facts.workspace_id)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    projection_audit(
        &mut tx,
        &locked,
        &def,
        "ready",
        "INSTALLATION_ACTIVE",
        evidence,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

async fn initialization_admission(
    state: &ServiceState,
    installation: Uuid,
    facts: &RuntimeFacts,
) -> Result<
    (
        crate::governance::Execution,
        crate::governance::Definition,
        String,
    ),
    Refusal,
> {
    let action = facts
        .snapshot
        .projection_action_execution_id
        .ok_or(Refusal::Precondition(ReasonCode::TargetStateConflict))?;
    let ae = crate::governance::load_execution(&state.pool, action)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    let def =
        crate::governance::exact_definition(&state.pool, &ae.action_key, ae.action_version).await?;
    let actor_active:bool=sqlx::query_scalar("select exists(select 1 from identity.principal a
        join identity.tenant_membership m on m.tenant_principal_id=a.id and m.tenant_id=a.tenant_id
          and m.state='ACTIVE' where a.id=$1 and a.tenant_id=$2 and a.kind='HUMAN' and a.status='ACTIVE')")
        .bind(ae.initiator_principal_id).bind(facts.tenant_id).fetch_one(&state.pool).await?;
    if !actor_active {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let proof = initialization_authorization(state, installation, facts, &ae, &def).await?;
    Ok((ae, def, proof))
}

async fn initialization_authorization(
    state: &ServiceState,
    installation: Uuid,
    facts: &RuntimeFacts,
    ae: &crate::governance::Execution,
    def: &crate::governance::Definition,
) -> Result<String, Refusal> {
    if Some(ae.id) != facts.snapshot.projection_action_execution_id
        || ae.tenant_id != facts.tenant_id
        || ae.workspace_id != Some(facts.workspace_id)
        || ae.target_id != installation
        || ae.gate_state != "ALLOWED"
        || !matches!(
            ae.dispatch_state.as_str(),
            "NOT_DISPATCHED" | "UNKNOWN" | "DISPATCHED"
        )
        || ae.actor_principal_id != ae.initiator_principal_id
        || ae.action_key != def.action_key
        || ae.action_version != def.version
        || def.action_key != CREATE_ACTION
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    dispatched(state, ae, def).await?;
    let params = ae
        .parameters
        .as_ref()
        .and_then(|v| v.get("params"))
        .and_then(Params::from_json)
        .ok_or_else(invalid)?;
    let version = params.asset_id.ok_or_else(invalid)?;
    let pinned: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.agent_installation
        where resource_id=$1 and pinned_version_asset_id=$2 and workspace_id=$3)",
    )
    .bind(installation)
    .bind(version)
    .bind(facts.workspace_id)
    .fetch_one(&state.pool)
    .await?;
    if !pinned {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    check(
        &state.governance,
        ae.initiator_principal_id,
        "asset",
        version,
        "consume",
    )
    .await?;
    let member: bool = sqlx::query_scalar(
        "select exists(select 1 from identity.workspace_membership
        where workspace_id=$1 and tenant_principal_id=$2 and state='ACTIVE')",
    )
    .bind(facts.workspace_id)
    .bind(ae.initiator_principal_id)
    .fetch_one(&state.pool)
    .await?;
    if !member {
        check(
            &state.governance,
            ae.initiator_principal_id,
            "workspace",
            facts.workspace_id,
            "manage",
        )
        .await?;
    }
    let object = match def.permission_object_type.as_str() {
        "workspace" => facts.workspace_id,
        "resource" => installation,
        "tenant" => facts.tenant_id,
        _ => return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)),
    };
    let checked = state
        .governance
        .spicedb
        .check(
            &def.permission_object_type,
            &object.to_string(),
            &def.permission,
            &ae.initiator_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Installation fresh authorization 不可查证".into()))?;
    if checked.zed_token.is_empty() {
        return Err(Refusal::Unavailable(
            "Installation fresh authorization 缺 checked revision".into(),
        ));
    }
    if !checked.allowed {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    Ok(checked.zed_token)
}

#[cfg(test)]
mod effective_field_tests {
    use super::*;

    #[test]
    fn partial_fields_converge_without_claiming_unimplemented_policy() {
        // Pure projection values only: no catalog entry, business object,
        // runtime default, database, native process or admission is created.
        let mut content = AgentVersionContent {
            capability_requirements: Vec::new(),
            declared_tool_resource_ids: Vec::new(),
            instructions: EFFECTIVE_FIELDS[0].into(),
            memory_policy: contracts::ContentMemoryPolicy {
                core_write: contracts::AgentMemoryCoreWrite::HumanOnly,
                cold_write: contracts::AgentMemoryColdWrite::Disabled,
            },
            model_route_resource_id: Uuid::nil().to_string(),
            parallelism: 1,
            persona_identity: contracts::ContentPersonaIdentity {
                display_name: EFFECTIVE_FIELDS[0].into(),
                avatar_url: None,
                description: None,
            },
            reply_policy: EFFECTIVE_FIELDS[6].into(),
            runtime_profile_key: EFFECTIVE_FIELDS[1].into(),
            skill_version_asset_ids: Vec::new(),
            trigger_defaults: Vec::new(),
            turn_limits: contracts::ContentTurnLimits {
                idle_timeout_seconds: 1,
                max_turn_duration_seconds: 1,
            },
        };
        assert!(supports_effective_field(&content, "parallelism"));
        assert!(supports_effective_field(&content, "turnLimits"));
        assert!(!supports_effective_field(&content, "replyPolicy"));
        for core_write in [
            contracts::AgentMemoryCoreWrite::HumanOnly,
            contracts::AgentMemoryCoreWrite::AgentWithApproval,
        ] {
            for cold_write in [
                contracts::AgentMemoryColdWrite::Disabled,
                contracts::AgentMemoryColdWrite::InvocationScoped,
            ] {
                content.memory_policy = contracts::ContentMemoryPolicy {
                    core_write: core_write.clone(),
                    cold_write: cold_write.clone(),
                };
                assert_eq!(
                    supports_effective_field(&content, "memoryPolicy"),
                    core_write == contracts::AgentMemoryCoreWrite::HumanOnly
                        && cold_write == contracts::AgentMemoryColdWrite::Disabled,
                );
            }
        }
        content.memory_policy = contracts::ContentMemoryPolicy {
            core_write: contracts::AgentMemoryCoreWrite::HumanOnly,
            cold_write: contracts::AgentMemoryColdWrite::Disabled,
        };
        let (requested, version_config_hash) = crate::agent_version::content(&content).unwrap();
        let mut fields = EFFECTIVE_FIELDS
            .iter()
            .map(|key| {
                let hash = hex::encode(Sha256::digest(
                    serde_json::to_vec(&requested[*key]).unwrap(),
                ));
                serde_json::json!({"fieldKey":key,"requestedValueHash":hash,
                    "effectiveValueHash":null,"source":"AGENT_VERSION",
                    "reasonCode":"PROJECTION_FAILED"})
            })
            .collect::<Vec<_>>();
        let field = fields.first_mut().unwrap();
        field["effectiveValueHash"] = field["requestedValueHash"].clone();
        field["reasonCode"] = serde_json::Value::Null;
        let mut row = InstallationRow {
            tenant_id: Uuid::nil(),
            workspace_id: Uuid::nil(),
            owner_principal_id: Uuid::nil(),
            agent_principal_id: Uuid::nil(),
            resource_version: 1,
            projection_action_execution_id: None,
            config_hash: String::new(),
            version_config_hash,
            runtime_profile_key: content.runtime_profile_key.clone(),
            model_route_resource_id: Uuid::nil(),
            gateway_resource_ids: vec![Uuid::nil()],
            skill_root_ref: None,
            effective_fields: serde_json::Value::Array(fields),
            content: requested,
            agent_pubkey: String::new(),
            agent_locator: String::new(),
            agent_secret_version: 0,
            agent_audience: String::new(),
            agent_binding_version: 0,
            counterparty_pubkey: String::new(),
            counterparty_locator: String::new(),
            counterparty_secret_version: 0,
            counterparty_audience: String::new(),
            counterparty_binding_version: 0,
            channel_id: Uuid::nil(),
            normalized_host: String::new(),
            memory_version: 0,
        };
        let before = row.effective_fields.clone();
        let (fields, hash) =
            initialization_fields(&row, Uuid::nil(), Uuid::nil(), 1, &content).unwrap();
        for (old, new) in before
            .as_array()
            .unwrap()
            .iter()
            .zip(fields.as_array().unwrap())
        {
            assert_eq!(new["requestedValueHash"], old["requestedValueHash"]);
            assert_eq!(new["source"], old["source"]);
            if new["fieldKey"] == "replyPolicy" {
                assert!(new["effectiveValueHash"].is_null());
                assert_eq!(new["reasonCode"], "NOT_SUPPORTED_BY_RUNTIME");
            } else {
                assert_eq!(new["effectiveValueHash"], new["requestedValueHash"]);
                assert!(new["reasonCode"].is_null());
            }
        }
        row.effective_fields = fields;
        row.config_hash = hash;
        assert!(verify_projection(&row, Uuid::nil(), Uuid::nil(), 1, &content, true).is_ok());
        assert!(verify_projection(&row, Uuid::nil(), Uuid::nil(), 1, &content, false).is_err());
        let reply = row
            .effective_fields
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|field| field["fieldKey"] == "replyPolicy")
            .unwrap();
        reply["effectiveValueHash"] = reply["requestedValueHash"].clone();
        reply["reasonCode"] = serde_json::Value::Null;
        row.config_hash =
            projection_hash(&row, Uuid::nil(), Uuid::nil(), 1, &row.effective_fields).unwrap();
        assert!(verify_projection(&row, Uuid::nil(), Uuid::nil(), 1, &content, true).is_err());
    }
}
