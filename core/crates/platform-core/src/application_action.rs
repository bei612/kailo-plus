//! DD-90: HUMAN capability actions use the original ComponentTask/AE/EE.
//! Native input is a durable ContentReference, never SQL or result storage.
use crate::{
    application_catalog::ApplicationDefinition,
    bff::{BffState, ExecutionContext},
    governance::{Actor, Evaluation, Execution, Governance, Refusal, Target},
};
use axum::http::StatusCode;
use contracts::{ActionCommand, ActionSubmission, ReasonCode};
use serde_json::{json, Value};
use sqlx::PgConnection;
use uuid::Uuid;

pub(crate) const KIND: &str = "COMPONENT_ACTION";
#[path = "application_native_human.rs"]
pub(crate) mod native_human;
#[path = "application_native_read.rs"]
pub(crate) mod native_read;
fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}
fn denied() -> Refusal {
    Refusal::Denied(ReasonCode::ScopeGuardFailed)
}
fn blocked() -> Refusal {
    Refusal::Blocked(ReasonCode::CapabilityBlocked)
}
fn unavailable() -> Refusal {
    Refusal::Unavailable("original component action evidence unavailable".into())
}
fn id(value: &Value) -> Result<Uuid, Refusal> {
    let text = value.as_str().ok_or_else(invalid)?;
    let id = Uuid::parse_str(text).map_err(|_| invalid())?;
    if id.is_nil() || id.to_string() != text {
        return Err(invalid());
    }
    Ok(id)
}

pub(crate) fn is_human(ae: &Execution) -> bool {
    ae.actor_principal_id == ae.initiator_principal_id
        && ae
            .parameters
            .as_ref()
            .is_some_and(|p| p["componentActionKind"] == KIND)
}

struct Facts {
    binding: Uuid,
    binding_version: i32,
    generation: i64,
    application: ApplicationDefinition,
    target: Target,
}

async fn facts(
    conn: &mut PgConnection,
    tenant: Uuid,
    target: &Target,
    key: &str,
    action_version: i32,
    target_type: &str,
) -> Result<Facts, Refusal> {
    let Target {
        id: target,
        version: target_version,
        workspace_id: workspace,
    } = *target;
    let (binding, generation, application) = match target_type {
        "RESOURCE" => {
            crate::application_catalog::definition_for_resource(
                conn,
                tenant,
                workspace,
                target,
                key,
                action_version,
            )
            .await?
        }
        "ASSET" => {
            crate::application_catalog::definition_for_asset(
                conn,
                tenant,
                workspace,
                target,
                key,
                action_version,
            )
            .await?
        }
        _ => return Err(invalid()),
    };
    let definition = &application.definition;
    if definition.target_type != target_type
        || !(definition.execution_mode == "TEMPORAL"
            && definition.workflow_kind.as_deref() == Some(KIND)
            || definition.execution_mode == "SYNC"
                && definition.workflow_kind.is_none()
                && definition.confirmation_mode == "NONE"
                && matches!(definition.permission.as_str(), "read" | "export"))
        || !matches!(definition.confirmation_mode.as_str(), "NONE" | "APPROVAL")
    {
        return Err(blocked());
    }
    let version:Option<i32>=match target_type {
        "RESOURCE"=>sqlx::query_scalar("select version from catalog.resource where id=$1 and tenant_id=$2 and state='ACTIVE' and projection_action_execution_id is null for share")
            .bind(target).bind(tenant).fetch_optional(&mut *conn).await?,
        "ASSET"=>sqlx::query_scalar("select version from catalog.asset where id=$1 and tenant_id=$2 and state='ACTIVE' and projection_action_execution_id is null for share")
            .bind(target).bind(tenant).fetch_optional(&mut *conn).await?,
        _=>return Err(invalid()),
    };
    if version != Some(target_version) {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let binding_version:Option<i32>=sqlx::query_scalar("select b.version from catalog.application_binding b
        join catalog.component_release release on release.id=b.component_release_id and release.status='APPROVED'
        where b.id=$1 and b.tenant_id=$2 and b.state='ACTIVE' and b.active_projection_generation=$3
          and release.manifest->'executionConnector'->>'mode'='REMOTE_ADAPTER' for share of b,release")
        .bind(binding).bind(tenant).bind(generation).fetch_optional(&mut *conn).await?;
    let binding_version = binding_version.ok_or_else(blocked)?;
    if let Some(workspace) = workspace {
        let active:bool=sqlx::query_scalar("select exists(select 1 from identity.workspace where id=$1 and tenant_id=$2 and state='ACTIVE')")
            .bind(workspace).bind(tenant).fetch_one(&mut *conn).await?;
        if !active {
            return Err(denied());
        }
    }
    Ok(Facts {
        binding,
        binding_version,
        generation,
        application,
        target: Target {
            id: target,
            version: target_version,
            workspace_id: workspace,
        },
    })
}

/// The parent-free HUMAN root has its own exact definition and frozen binding.
/// A marker in JSON alone is never proof: callers recheck these stored joins.
pub(crate) async fn fresh_execution(g: &Governance, ae: &Execution) -> Result<Evaluation, Refusal> {
    if !is_human(ae) {
        return Err(denied());
    }
    let p = ae.parameters.as_ref().ok_or_else(invalid)?;
    let mut tx = g.pool.begin().await?;
    let f = facts(
        &mut tx,
        ae.tenant_id,
        &Target {
            id: ae.target_id,
            version: ae.frozen_target_version().ok_or_else(invalid)?,
            workspace_id: ae.workspace_id,
        },
        &ae.action_key,
        ae.action_version,
        p["targetType"].as_str().ok_or_else(invalid)?,
    )
    .await?;
    let exact:bool=sqlx::query_scalar("select exists(select 1 from admission.action_execution
        where id=$1 and tenant_id=$2 and actor_principal_id=initiator_principal_id and parent_action_execution_id is null
          and component_binding_kind='APPLICATION' and component_binding_id=$3 and component_projection_generation=$4
          and component_release_id=$5 and action_definition_id=$6)")
        .bind(ae.id).bind(ae.tenant_id).bind(f.binding).bind(f.generation)
        .bind(f.application.component_release_id).bind(f.application.definition_id).fetch_one(&mut *tx).await?;
    if !exact || p["bindingVersion"] != f.binding_version {
        return Err(denied());
    }
    validate_reference_and_policy(
        &mut tx,
        ae.tenant_id,
        &f,
        &p["inputArguments"]["input"],
        id(&p["resultExposurePolicyId"])?,
        p["resultExposurePolicyVersion"]
            .as_i64()
            .and_then(|v| i32::try_from(v).ok())
            .ok_or_else(invalid)?,
    )
    .await?;
    let mut result = g
        .evaluate(
            Actor {
                tenant_id: ae.tenant_id,
                principal_id: ae.initiator_principal_id,
                human_identity_id: None,
            },
            &f.application.definition,
            &f.target,
        )
        .await?;
    if native_read::is_read(ae) && p.get("nativeReadReceipt").is_none() {
        g.check_quota(ae.tenant_id, &f.application.definition, &mut result)
            .await?;
    }
    tx.commit().await?;
    Ok(result)
}

async fn validate_reference_and_policy(
    conn: &mut PgConnection,
    tenant: Uuid,
    f: &Facts,
    reference: &Value,
    policy: Uuid,
    version: i32,
) -> Result<(), Refusal> {
    let resource = id(&reference["resourceId"])?;
    if f.application.definition.target_type == "ASSET" {
        let parent: Option<Uuid> = sqlx::query_scalar(
            "select resource_id from catalog.asset where id=$1 and tenant_id=$2 and state='ACTIVE'",
        )
        .bind(f.target.id)
        .bind(tenant)
        .fetch_optional(&mut *conn)
        .await?;
        if parent != Some(resource) || reference["assetId"] != json!(f.target.id) {
            return Err(denied());
        }
    } else if matches!(
        f.application.definition.action_key.as_str(),
        "knowledge.ingest@v1" | "knowledge.ingest@v2"
    ) {
        // An import targets the receiver knowledge base, while its typed
        // reference identifies the source. Neither ID can substitute for the
        // other's authority. The SERVICE read batch checks its grant afresh.
        crate::application_binding::read_grant::validate_input_reference(
            conn,
            tenant,
            f.binding,
            f.generation,
            f.target.workspace_id,
            reference,
        )
        .await?;
    } else if resource != f.target.id || reference.get("assetId").is_some() {
        return Err(denied());
    }
    let valid:bool=sqlx::query_scalar("select exists(select 1 from catalog.result_exposure_policy
        where id=$1 and version=$2 and tenant_id=$3 and status='ACTIVE' and mode=$4 and output_schema_hash=$5
          and redaction_policy='PLATFORM_METADATA_ONLY')")
        .bind(policy).bind(version).bind(tenant).bind(&f.application.definition.result_exposure)
        .bind(f.application.declaration["outputSchemaDigest"].as_str().ok_or_else(invalid)?)
        .fetch_one(&mut *conn).await?;
    if !valid {
        return Err(denied());
    }
    Ok(())
}

struct FrozenCommand {
    raw: Value,
    arguments: Value,
    key: Uuid,
    workspace: Option<Uuid>,
    target: Uuid,
    version: i32,
    kind: &'static str,
    action_version: i32,
}

fn normalized(cmd: &ActionCommand) -> Result<FrozenCommand, Refusal> {
    let raw = serde_json::to_value(cmd).map_err(|_| invalid())?;
    if raw.as_object().is_none_or(|fields| {
        fields.iter().any(|(k, v)| {
            !v.is_null()
                && !matches!(
                    k.as_str(),
                    "actionKey"
                        | "idempotencyKey"
                        | "workspaceId"
                        | "resourceId"
                        | "resourceVersion"
                        | "assetId"
                        | "assetVersion"
                        | "componentAction"
                )
        })
    }) {
        return Err(invalid());
    }
    let input = &raw["componentAction"];
    let typed: contracts::ComponentActionInput =
        serde_json::from_value(input.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(typed).map_err(|_| invalid())? != *input {
        return Err(invalid());
    }
    let reference = &input["inputReference"];
    // The component will verify native identity/revision. The platform prevents
    // cross-target/reference substitution before any native request is issued.
    for field in ["nativeObjectRef", "nativeRevision"] {
        if reference[field]
            .as_str()
            .is_none_or(|v| v.is_empty() || v.trim() != v)
        {
            return Err(invalid());
        }
    }
    let (target, version, kind) = match (&cmd.resource_id, &cmd.asset_id) {
        (Some(_), None) => (id(&raw["resourceId"])?, cmd.resource_version, "RESOURCE"),
        (None, Some(_)) => (id(&raw["assetId"])?, cmd.asset_version, "ASSET"),
        _ => return Err(invalid()),
    };
    let version = version
        .and_then(|v| i32::try_from(v).ok())
        .filter(|v| *v > 0)
        .ok_or_else(invalid)?;
    if (kind == "RESOURCE"
        && !matches!(
            cmd.action_key.as_str(),
            "knowledge.ingest@v1" | "knowledge.ingest@v2"
        )
        && (reference["resourceId"] != json!(target) || reference.get("assetId").is_some()))
        || (kind == "ASSET" && reference["assetId"] != json!(target))
    {
        return Err(invalid());
    }
    let target_field = if kind == "RESOURCE" {
        "resourceId"
    } else {
        "assetId"
    };
    let arguments = json!({"target":{(target_field):target},"input":reference});
    let key = id(&raw["idempotencyKey"])?;
    let workspace = cmd
        .workspace_id
        .as_ref()
        .map(|_| id(&raw["workspaceId"]))
        .transpose()?;
    let action_version = input["actionVersion"]
        .as_i64()
        .and_then(|v| i32::try_from(v).ok())
        .filter(|v| *v > 0)
        .ok_or_else(invalid)?;
    Ok(FrozenCommand {
        raw,
        arguments,
        key,
        workspace,
        target,
        version,
        kind,
        action_version,
    })
}

pub(crate) async fn submit(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &ActionCommand,
) -> Result<(StatusCode, ActionSubmission), (Refusal, Option<Uuid>)> {
    if ctx.access_mode != contracts::PlatformSessionAccessMode::Full {
        return Err((denied(), None));
    }
    match submit_inner(
        &state.governance,
        Actor {
            tenant_id: ctx.tenant_id,
            principal_id: ctx.tenant_principal_id,
            human_identity_id: Some(ctx.human_identity_id),
        },
        cmd,
        None,
        None,
    )
    .await
    {
        Ok(result) => Ok(result),
        Err(error) => {
            let operation = sqlx::query_scalar(
                "select operation_id from admission.action_execution
                where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3",
            )
            .bind(ctx.tenant_id)
            .bind(ctx.tenant_principal_id)
            .bind(Uuid::parse_str(&cmd.idempotency_key).ok())
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
            Err((error, operation))
        }
    }
}

async fn replay(
    state: &Governance,
    action: Uuid,
    key: &str,
    digest: &str,
) -> Result<(StatusCode, ActionSubmission), Refusal> {
    let ae = crate::governance::load_execution(&state.pool, action)
        .await?
        .ok_or_else(unavailable)?;
    if !is_human(&ae)
        || ae.action_key != key
        || ae
            .parameters
            .as_ref()
            .is_none_or(|p| p["commandDigest"] != digest)
    {
        return Err(Refusal::Conflict(ReasonCode::IdempotencyKeyReused));
    }
    if native_read::is_read(&ae) {
        // A retried native HTTP request observes its original AE. It must not
        // issue another content ticket, even if the first acknowledgement was lost.
        return Ok((StatusCode::ACCEPTED, ae.submission()));
    } else if ae.gate_state == "ALLOWED" {
        start(state, &ae).await?;
    } else if ae.gate_state == "WAITING" {
        state.ensure_approval_started(ae.id).await;
    } else if ae.gate_state == "EVALUATING" {
        let def = crate::governance::exact_definition_for_execution(&state.pool, &ae).await?;
        if def.confirmation_mode != "APPROVAL" {
            return Err(unavailable());
        }
        let mut evaluation = fresh_execution(state, &ae).await?;
        state
            .check_quota(ae.tenant_id, &def, &mut evaluation)
            .await?;
        return state
            .request_approval(
                Actor {
                    tenant_id: ae.tenant_id,
                    principal_id: ae.initiator_principal_id,
                    human_identity_id: None,
                },
                &ae,
                &def,
                &evaluation,
            )
            .await
            .map_err(|(error, _)| error);
    }
    let ae = crate::governance::load_execution(&state.pool, action)
        .await?
        .ok_or_else(unavailable)?;
    Ok((StatusCode::ACCEPTED, ae.submission()))
}

pub(super) async fn submit_inner(
    state: &Governance,
    actor: Actor,
    cmd: &ActionCommand,
    required_binding: Option<(Uuid, i64)>,
    native: Option<&crate::service_api::ServiceState>,
) -> Result<(StatusCode, ActionSubmission), Refusal> {
    let FrozenCommand {
        raw,
        arguments,
        key,
        workspace,
        target,
        version,
        kind,
        action_version,
    } = normalized(cmd)?;
    let request_digest = collab_bridge::limits::canonical_digest(&raw);
    let existing:Option<Uuid>=sqlx::query_scalar("select id from admission.action_execution where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3")
        .bind(actor.tenant_id).bind(actor.principal_id).bind(key).fetch_optional(&state.pool).await?;
    if let Some(id) = existing {
        return replay(state, id, &cmd.action_key, &request_digest).await;
    }
    let mut tx = state.pool.begin().await?;
    if !crate::roles::lock_tenant(&mut tx, actor.tenant_id).await? {
        return Err(denied());
    }
    if let Some((binding, _)) = required_binding {
        // Native browser retries can survive a login change. Serialize this check
        // with the original tenant admission transaction, before creating an AE.
        let foreign: bool = sqlx::query_scalar("select exists(select 1 from admission.action_execution where component_binding_id=$1 and idempotency_key=$2 and initiator_principal_id<>$3)")
            .bind(binding).bind(key).bind(actor.principal_id).fetch_one(&mut *tx).await?;
        if foreign {
            return Err(denied());
        }
    }
    let existing:Option<Uuid>=sqlx::query_scalar("select id from admission.action_execution where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3")
        .bind(actor.tenant_id).bind(actor.principal_id).bind(key).fetch_optional(&mut *tx).await?;
    if let Some(existing) = existing {
        tx.rollback().await?;
        return replay(state, existing, &cmd.action_key, &request_digest).await;
    }
    let f = facts(
        &mut tx,
        actor.tenant_id,
        &Target {
            id: target,
            version,
            workspace_id: workspace,
        },
        &cmd.action_key,
        action_version,
        kind,
    )
    .await?;
    if required_binding.is_some_and(|expected| expected != (f.binding, f.generation)) {
        return Err(denied());
    }
    let def = &f.application.definition;
    let synchronous = def.execution_mode == "SYNC";
    if synchronous && (native.is_none() || required_binding.is_none() || kind != "RESOURCE") {
        return Err(blocked());
    }
    let documents = crate::application_tool::schemas(&mut tx, f.binding, &cmd.action_key).await?;
    let digest = f.application.declaration["inputSchemaDigest"]
        .as_str()
        .ok_or_else(invalid)?;
    let input = documents.get(digest).ok_or_else(invalid)?;
    if !crate::capability_contract::schema_validator(input, &documents)?
        .is_valid(&arguments["input"])
    {
        return Err(invalid());
    }
    let exposure = &raw["componentAction"];
    let policy = id(&exposure["resultExposurePolicyId"])?;
    let policy_version = exposure["resultExposurePolicyVersion"]
        .as_i64()
        .and_then(|v| i32::try_from(v).ok())
        .filter(|v| *v > 0)
        .ok_or_else(invalid)?;
    validate_reference_and_policy(
        &mut tx,
        actor.tenant_id,
        &f,
        &arguments["input"],
        policy,
        policy_version,
    )
    .await?;
    let mut evaluation = state.evaluate(actor, def, &f.target).await?;
    state
        .check_quota(actor.tenant_id, def, &mut evaluation)
        .await?;
    let ae_id = Uuid::new_v4();
    let operation = Uuid::new_v4();
    let wf = (!synchronous)
        .then(|| crate::component_task::workflow_id(KIND, actor.tenant_id, &ae_id.to_string(), 1));
    let mut parameters = json!({"componentActionKind":KIND,"commandDigest":request_digest,"inputArguments":arguments,
        "toolParameterHash":collab_bridge::limits::canonical_digest(&arguments),"targetType":kind,"targetVersion":version,
        "bindingVersion":f.binding_version,"resultExposurePolicyId":policy,"resultExposurePolicyVersion":policy_version});
    if synchronous {
        parameters["nativeRead"] = json!(true);
        parameters["nativeReadDeadline"] = json!(crate::action_token::native_read_deadline()?);
        parameters["nativeReadBilling"] = crate::application_binding::read_grant::receipt::billing(
            native.ok_or_else(blocked)?,
            &mut tx,
            actor.tenant_id,
            f.binding,
            f.generation,
            target,
            &f.application,
        )
        .await?;
    }
    let hash = collab_bridge::limits::canonical_digest(
        &json!({"actionKey":def.action_key,"actionVersion":def.version,"targetId":target,"parameters":parameters}),
    );
    sqlx::query("insert into admission.action_execution
        (id,operation_id,tenant_id,workspace_id,action_key,action_version,initiator_principal_id,actor_principal_id,
         target_id,parameter_hash,parameters,idempotency_key,gate_state,dispatch_state,correlation_id,
         action_definition_id,component_binding_kind,component_binding_id,component_release_id,component_projection_generation,temporal_workflow_id)
        values($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,'EVALUATING','NOT_DISPATCHED',$2,$12,'APPLICATION',$13,$14,$15,$16)")
        .bind(ae_id).bind(operation).bind(actor.tenant_id).bind(workspace).bind(&def.action_key).bind(def.version)
        .bind(actor.principal_id).bind(target).bind(hash).bind(parameters).bind(key)
        .bind(f.application.definition_id).bind(f.binding).bind(f.application.component_release_id).bind(f.generation).bind(&wf)
        .execute(&mut *tx).await?;
    let ae = crate::governance::lock_execution(&mut tx, ae_id).await?;
    crate::governance::audit(
        &mut tx,
        &ae,
        def,
        "intent",
        "INTENT",
        "NONE",
        "EVALUATING",
        actor.human_identity_id,
        vec![],
    )
    .await?;
    crate::governance::record_decision(
        &mut tx,
        &crate::governance::DecisionSubject {
            action_execution_id: ae.id,
            operation_id: ae.operation_id,
            tenant_id: ae.tenant_id,
            workspace_id: ae.workspace_id,
            principal_id: ae.initiator_principal_id,
            action_key: &ae.action_key,
            action_version: ae.action_version,
            target_id: ae.target_id,
            parameter_hash: &ae.parameter_hash,
        },
        "ADMISSION",
        evaluation.scope,
        evaluation.authorization,
        "NOT_APPLICABLE",
        evaluation.quota,
        evaluation.zed_token.as_deref(),
        evaluation.reason.as_ref(),
    )
    .await?;
    let gate = if !evaluation.allowed {
        "DENIED"
    } else if def.confirmation_mode == "APPROVAL" {
        "EVALUATING"
    } else {
        "ALLOWED"
    };
    sqlx::query("update admission.action_execution set gate_state=$2,reason_code=$3,updated_at=now() where id=$1")
        .bind(ae_id).bind(gate).bind(evaluation.reason.as_ref().map(crate::governance::wire)).execute(&mut *tx).await?;
    let ae = crate::governance::lock_execution(&mut tx, ae_id).await?;
    tx.commit().await?;
    if evaluation.allowed && def.confirmation_mode == "APPROVAL" {
        return state
            .request_approval(actor, &ae, def, &evaluation)
            .await
            .map_err(|(e, _)| e);
    }
    if evaluation.allowed && !synchronous {
        start(state, &ae).await?;
    }
    let ae = crate::governance::load_execution(&state.pool, ae_id)
        .await?
        .ok_or_else(unavailable)?;
    Ok((StatusCode::ACCEPTED, ae.submission()))
}

/// Same-ID recovery is delegated to the original ComponentTask Start routine.
/// A Workflow launch is not evidence that the native action has executed.
pub(crate) async fn start(g: &Governance, ae: &Execution) -> Result<(), Refusal> {
    if !is_human(ae) || native_read::is_read(ae) || ae.gate_state != "ALLOWED" {
        return Err(denied());
    }
    let frozen:Option<(Uuid,i32,Uuid,i64,String)>=sqlx::query_as("select a.component_binding_id,
        (a.parameters->>'bindingVersion')::integer,a.component_release_id,a.component_projection_generation,a.temporal_workflow_id
        from admission.action_execution a where a.id=$1 and a.component_binding_kind='APPLICATION'
          and a.parent_action_execution_id is null and a.actor_principal_id=a.initiator_principal_id
          and a.gate_state='ALLOWED' and a.dispatch_state in ('NOT_DISPATCHED','UNKNOWN','DISPATCHED')")
        .bind(ae.id).fetch_optional(&g.pool).await?;
    let (binding, version, release, generation, workflow) = frozen.ok_or_else(denied)?;
    if workflow != crate::component_task::workflow_id(KIND, ae.tenant_id, &ae.id.to_string(), 1) {
        return Err(denied());
    }
    let target = json!({"actionExecutionId":ae.id,"workflowId":workflow,"bindingId":binding,
        "bindingVersion":version,"componentReleaseId":release,"projectionGeneration":generation});
    crate::component_task::start(
        &g.pool,
        &g.temporal,
        &workflow,
        ae.tenant_id,
        ae.id,
        &crate::component_task::ComponentTaskInput {
            kind: KIND.into(),
            target: json!({"componentAction":target}),
        },
    )
    .await
    .map_err(|_| unavailable())?;
    sqlx::query(
        "update admission.action_execution set dispatch_state='DISPATCHED',updated_at=now()
        where id=$1 and gate_state='ALLOWED' and dispatch_state in ('NOT_DISPATCHED','UNKNOWN')",
    )
    .bind(ae.id)
    .execute(&g.pool)
    .await?;
    // The normal ApprovalWorkflow remains the consume authority. The native
    // consumer also waits for its CONSUMED projection before any dispatch.
    g.consume(ae.id).await;
    Ok(())
}

pub(crate) async fn advance(
    axum::extract::State(state): axum::extract::State<crate::service_api::ServiceState>,
    headers: axum::http::HeaderMap,
    body: Result<
        axum::Json<contracts::ComponentActionAdvanceRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    if let Err(response) = crate::service_api::authorize(&state, &headers).await {
        return response;
    }
    let Ok(axum::Json(input)) = body else {
        return invalid().respond(None);
    };
    match advance_inner(&state, input).await {
        Ok(value) => axum::Json(value).into_response(),
        Err(error) => error.respond(None),
    }
}

fn result(action: Uuid, status: &str, reason: &str) -> Value {
    json!({"actionExecutionId":action,"status":status,"waitingReason":reason})
}

async fn finish(
    state: &crate::service_api::ServiceState,
    ae: &Execution,
    status: &str,
    reason: &str,
    unsent: bool,
) -> Result<Value, Refusal> {
    let def = crate::governance::exact_definition_for_execution(&state.pool, ae).await?;
    let mut tx = state.pool.begin().await?;
    crate::governance::lock_execution(&mut tx, ae.id).await?;
    let dispatched: bool = sqlx::query_scalar(
        "select exists(select 1 from admission.external_execution where action_execution_id=$1)",
    )
    .bind(ae.id)
    .fetch_one(&mut *tx)
    .await?;
    if unsent && dispatched {
        return Err(unavailable());
    }
    crate::governance::audit(
        &mut tx,
        ae,
        &def,
        "component_action:terminal",
        "OUTCOME",
        "ALLOW",
        status,
        None,
        vec![],
    )
    .await?;
    tx.commit().await?;
    Ok(result(ae.id, status, reason))
}

async fn reconcile(
    state: &crate::service_api::ServiceState,
    ae: &Execution,
    external: Uuid,
) -> Result<Value, Refusal> {
    if !crate::application_execution::observe(state, ae, external).await? {
        return Ok(result(ae.id, "RUNNING", "UNKNOWN_EXTERNAL_RESULT"));
    }
    if !crate::gateway_usage::committed_application_action(&state.pool, &state.openmeter, ae.id)
        .await
        .map_err(|_| unavailable())?
    {
        return Ok(result(ae.id, "RUNNING", "BILLING_UNAVAILABLE"));
    }
    let status: String = sqlx::query_scalar(
        "select platform_status from admission.external_execution
        where id=$1 and action_execution_id=$2 and operation_id=$3 and tenant_id=$4",
    )
    .bind(external)
    .bind(ae.id)
    .bind(ae.operation_id)
    .bind(ae.tenant_id)
    .fetch_one(&state.pool)
    .await?;
    match status.as_str() {
        "SUCCEEDED" => finish(state, ae, "COMPLETED", "NONE", false).await,
        "FAILED" => finish(state, ae, "FAILED", "NONE", false).await,
        "CANCELLED" => finish(state, ae, "CANCELED", "NONE", false).await,
        _ => Ok(result(ae.id, "RUNNING", "UNKNOWN_EXTERNAL_RESULT")),
    }
}

async fn advance_inner(
    state: &crate::service_api::ServiceState,
    input: contracts::ComponentActionAdvanceRequest,
) -> Result<Value, Refusal> {
    let raw = serde_json::to_value(input).map_err(|_| invalid())?;
    let target = &raw["target"];
    let ae = crate::governance::load_execution(&state.pool, id(&target["actionExecutionId"])?)
        .await?
        .ok_or_else(unavailable)?;
    if !is_human(&ae) || ae.gate_state != "ALLOWED" || ae.dispatch_state != "DISPATCHED" {
        return Err(denied());
    }
    let wf = ae.temporal_workflow_id.as_deref().ok_or_else(unavailable)?;
    let frozen:Option<(Uuid,Uuid,i64)>=sqlx::query_as("select component_binding_id,component_release_id,component_projection_generation
        from admission.action_execution where id=$1 and component_binding_kind='APPLICATION' and parent_action_execution_id is null")
        .bind(ae.id).fetch_optional(&state.pool).await?;
    let (binding, release, generation) = frozen.ok_or_else(denied)?;
    let parameters = ae.parameters.as_ref().ok_or_else(unavailable)?;
    if *target
        != json!({"actionExecutionId":ae.id,"workflowId":wf,"bindingId":binding,
        "bindingVersion":parameters["bindingVersion"],"componentReleaseId":release,"projectionGeneration":generation})
    {
        return Err(denied());
    }
    let observed = state
        .temporal
        .describe(wf)
        .await
        .map_err(|_| unavailable())?
        .ok_or_else(unavailable)?;
    let first:Option<String>=sqlx::query_scalar("select run_id from projection.workflow_ref where workflow_id=$1
        and action_execution_id=$2 and tenant_id=$3 and operation_id=$4 and kind=$5 and workflow_type='ComponentTaskWorkflow'")
        .bind(wf).bind(ae.id).bind(ae.tenant_id).bind(ae.operation_id).bind(KIND).fetch_optional(&state.pool).await?.flatten();
    if !matches!(observed.state, crate::temporal::ObservedState::Open)
        || raw["runId"] != observed.run_id
        || observed.first_run_id.is_empty()
        || first
            .as_ref()
            .is_none_or(|v| *v != observed.first_run_id && *v != observed.run_id)
    {
        return Err(denied());
    }
    let terminal: Option<String> = sqlx::query_scalar(
        "select result_code from audit.audit_event where event_key=$1
        and action_key=$2 and operation_id=$3 and tenant_id=$4",
    )
    .bind(format!("{}:component_action:terminal", ae.operation_id))
    .bind(&ae.action_key)
    .bind(ae.operation_id)
    .bind(ae.tenant_id)
    .fetch_optional(&state.pool)
    .await?;
    if let Some(status) = terminal {
        if !matches!(status.as_str(), "COMPLETED" | "FAILED" | "CANCELED") {
            return Err(unavailable());
        }
        return Ok(result(ae.id, &status, "NONE"));
    }
    let external:Option<Uuid>=sqlx::query_scalar("select id from admission.external_execution where action_execution_id=$1 and operation_id=$2")
        .bind(ae.id).bind(ae.operation_id).fetch_optional(&state.pool).await?;
    if let Some(external) = external {
        return reconcile(state, &ae, external).await;
    }
    if raw["cancelRequested"] == true {
        return finish(state, &ae, "CANCELED", "NONE", true).await;
    }
    let evaluation = match fresh_execution(&state.governance, &ae).await {
        Ok(value) => value,
        Err(Refusal::Unavailable(message)) => return Err(Refusal::Unavailable(message)),
        Err(_) => return finish(state, &ae, "FAILED", "PERMISSION_DENIED", true).await,
    };
    if !evaluation.allowed {
        return finish(state, &ae, "FAILED", "PERMISSION_DENIED", true).await;
    }
    let def = crate::governance::exact_definition_for_execution(&state.pool, &ae).await?;
    if def.confirmation_mode == "APPROVAL" {
        state.governance.consume(ae.id).await;
        let status: Option<String> = sqlx::query_scalar(
            "select status from projection.approval_projection
            where workflow_id=$1 and action_execution_id=$2",
        )
        .bind(&ae.approval_workflow_id)
        .bind(ae.id)
        .fetch_optional(&state.pool)
        .await?;
        match status.as_deref() {
            Some("CONSUMED") => {}
            Some("DENIED" | "EXPIRED" | "CANCELLED" | "INVALIDATED") => {
                return finish(state, &ae, "FAILED", "APPROVAL_INVALIDATED", true).await;
            }
            _ => return Ok(result(ae.id, "RUNNING", "APPROVAL_PENDING")),
        }
    }
    let arguments = &parameters["inputArguments"];
    let external = Uuid::new_v4();
    let key = Uuid::new_v4();
    let (token, audience) =
        crate::action_token::issue_component_action(state, &ae, arguments, external, key).await?;
    let mut tx = state.pool.begin().await?;
    let locked = crate::governance::lock_execution(&mut tx, ae.id).await?;
    let terminal: Option<String> = sqlx::query_scalar(
        "select result_code from audit.audit_event
        where event_key=$1 and tenant_id=$2 and operation_id=$3 and action_key=$4",
    )
    .bind(format!("{}:component_action:terminal", ae.operation_id))
    .bind(ae.tenant_id)
    .bind(ae.operation_id)
    .bind(&ae.action_key)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(status) = terminal {
        if !matches!(status.as_str(), "COMPLETED" | "FAILED" | "CANCELED") {
            return Err(unavailable());
        }
        tx.rollback().await?;
        return Ok(result(ae.id, &status, "NONE"));
    }
    // Serialise duplicate Activities on the real AE. A losing caller observes
    // the exact EE; it cannot emit a second execute after the winner commits.
    let existing:Option<Uuid>=sqlx::query_scalar("select id from admission.external_execution where action_execution_id=$1 and operation_id=$2")
        .bind(ae.id).bind(ae.operation_id).fetch_optional(&mut *tx).await?;
    if let Some(existing) = existing {
        tx.rollback().await?;
        return reconcile(state, &ae, existing).await;
    }
    if !crate::roles::lock_tenant(&mut tx, ae.tenant_id).await? {
        return Err(denied());
    }
    let f = facts(
        &mut tx,
        ae.tenant_id,
        &Target {
            id: ae.target_id,
            version: ae.frozen_target_version().ok_or_else(invalid)?,
            workspace_id: ae.workspace_id,
        },
        &ae.action_key,
        ae.action_version,
        parameters["targetType"].as_str().ok_or_else(invalid)?,
    )
    .await?;
    if f.binding != binding
        || f.generation != generation
        || f.application.component_release_id != release
        || parameters["bindingVersion"] != f.binding_version
    {
        return Err(denied());
    }
    validate_reference_and_policy(
        &mut tx,
        ae.tenant_id,
        &f,
        &arguments["input"],
        id(&parameters["resultExposurePolicyId"])?,
        parameters["resultExposurePolicyVersion"]
            .as_i64()
            .and_then(|v| i32::try_from(v).ok())
            .ok_or_else(invalid)?,
    )
    .await?;
    let mut fresh = state
        .governance
        .evaluate(
            Actor {
                tenant_id: ae.tenant_id,
                principal_id: ae.initiator_principal_id,
                human_identity_id: None,
            },
            &def,
            &f.target,
        )
        .await?;
    state
        .governance
        .check_quota(ae.tenant_id, &def, &mut fresh)
        .await?;
    if !fresh.allowed {
        return Err(Refusal::Denied(
            fresh.reason.unwrap_or(ReasonCode::PermissionDenied),
        ));
    }
    if let Err(error) = crate::application_catalog::approval::require_consumed(
        &state.governance,
        &mut tx,
        &locked,
        &def,
    )
    .await
    {
        tx.rollback().await?;
        if matches!(error, Refusal::Unavailable(_)) {
            return Err(error);
        }
        return finish(state, &ae, "FAILED", "APPROVAL_INVALIDATED", true).await;
    }
    let (service,instance,manifest,mappings):(String,String,Value,Value)=sqlx::query_as("select b.adapter_service_ref,b.native_instance_ref,r.manifest,p.observation->'executionMappings'
        from catalog.application_binding b join catalog.component_release r on r.id=b.component_release_id
        join projection.application_runtime p on p.binding_id=b.id and p.generation=b.active_projection_generation and p.component_release_id=r.id
        where b.id=$1 and b.state='ACTIVE' and p.state='ACTIVE' and p.generation=$2 and r.id=$3 for share of b,p,r")
        .bind(binding).bind(generation).bind(release).fetch_one(&mut *tx).await?;
    let mapping = mappings
        .as_array()
        .ok_or_else(unavailable)?
        .iter()
        .filter(|m| m["actionKey"] == ae.action_key && m["actionVersion"] == ae.action_version)
        .collect::<Vec<_>>();
    if mapping.len() != 1 {
        return Err(unavailable());
    }
    let native = mapping[0]["nativeType"]
        .as_str()
        .filter(|v| !v.is_empty())
        .ok_or_else(unavailable)?;
    let cancel = mapping[0]["cancelCapability"]
        .as_str()
        .filter(|v| matches!(*v, "SUPPORTED" | "UNSUPPORTED"))
        .ok_or_else(unavailable)?;
    let adapter =
        crate::application_binding::native::Adapter::resolve(&service, &instance, &manifest)?;
    sqlx::query("insert into admission.external_execution(id,operation_id,workflow_id,action_execution_id,
        tenant_id,workspace_id,component_binding_id,component_binding_version,component_release_id,
        component_projection_generation,protocol_operation,native_type,idempotency_key,request_digest,platform_status,cancel_capability)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'execute',$11,$12,$13,'PENDING_DISPATCH',$14)")
        .bind(external).bind(ae.operation_id).bind(wf).bind(ae.id).bind(ae.tenant_id).bind(ae.workspace_id)
        .bind(binding).bind(f.binding_version).bind(release).bind(generation).bind(native).bind(key)
        .bind(collab_bridge::limits::canonical_digest(arguments)).bind(cancel).execute(&mut *tx).await?;
    crate::application_execution::prepare_in_transaction(&state.openmeter, &mut tx, &ae, external)
        .await?;
    crate::action_token::verify(&token, &audience)?;
    sqlx::query("update admission.external_execution set platform_status='UNKNOWN' where id=$1 and platform_status='PENDING_DISPATCH' and usage_projection is not null")
        .bind(external).execute(&mut *tx).await?;
    crate::governance::audit(
        &mut tx,
        &ae,
        &def,
        "component_action:dispatch",
        "DISPATCH",
        "ALLOW",
        "DISPATCH_RESULT_UNKNOWN",
        None,
        vec![],
    )
    .await?;
    tx.commit().await?;
    let response = adapter
        .execute_prepared(&ae, key, arguments, &token)
        .await?;
    let parsed: contracts::AdapterExecutionResponse =
        serde_json::from_value(response.clone()).map_err(|_| unavailable())?;
    if serde_json::to_value(parsed).map_err(|_| unavailable())? != response {
        return Err(unavailable());
    }
    crate::application_execution::record_observation(state, external, &response["execution"])
        .await?;
    reconcile(state, &ae, external).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn command() -> Value {
        let resource = Uuid::new_v4();
        json!({"actionKey":"fixture.query","idempotencyKey":Uuid::new_v4(),"resourceId":resource,"resourceVersion":2,
            "componentAction":{"actionVersion":1,"inputReference":{"resourceId":resource,"nativeObjectRef":"stored-view",
                "nativeRevision":"frozen-revision","displayName":"View","mediaType":"application/json"},
                "resultExposurePolicyId":Uuid::new_v4(),"resultExposurePolicyVersion":1}})
    }
    #[test]
    fn human_component_command_freezes_only_same_target_native_reference() {
        let raw = command();
        let parsed: ActionCommand = serde_json::from_value(raw.clone()).unwrap();
        let FrozenCommand {
            arguments,
            target,
            version,
            kind,
            ..
        } = normalized(&parsed).unwrap();
        assert_eq!(kind, "RESOURCE");
        assert_eq!(version, 2);
        assert_eq!(arguments["target"]["resourceId"], json!(target));
        assert_eq!(arguments["input"], raw["componentAction"]["inputReference"]);
        for (key, value) in [
            ("resourceVersion", json!(0)),
            ("assetId", json!(Uuid::new_v4())),
            ("sourceEventId", json!("body")),
        ] {
            let mut changed = raw.clone();
            changed[key] = value;
            let parsed: ActionCommand = serde_json::from_value(changed).unwrap();
            assert!(normalized(&parsed).is_err(), "{key}");
        }
        let mut changed = raw;
        changed["componentAction"]["inputReference"]["resourceId"] = json!(Uuid::new_v4());
        assert!(normalized(&serde_json::from_value(changed).unwrap()).is_err());
    }

    #[test]
    fn ingest_freezes_source_reference_without_replacing_receiver_target() {
        let mut raw = command();
        let source = Uuid::new_v4();
        raw["componentAction"]["inputReference"]["resourceId"] = json!(source);
        for action in ["knowledge.ingest@v1", "knowledge.ingest@v2"] {
            raw["actionKey"] = json!(action);
            let frozen = normalized(&serde_json::from_value(raw.clone()).unwrap()).unwrap();
            assert_eq!(frozen.arguments["target"]["resourceId"], raw["resourceId"]);
            assert_eq!(frozen.arguments["input"]["resourceId"], json!(source));
        }
        for action in [
            "knowledge.read@v1",
            "knowledge.read@v2",
            "knowledge.ingest@v3",
        ] {
            raw["actionKey"] = json!(action);
            assert!(normalized(&serde_json::from_value(raw.clone()).unwrap()).is_err());
        }
    }

    #[tokio::test]
    #[ignore = "requires migrated isolated database with application-execution-base.sql"]
    async fn human_component_facts_use_exact_temporal_definition_and_scope() {
        use sqlx::Connection;
        let mut conn = sqlx::PgConnection::connect(
            &std::env::var("APPLICATION_EXECUTION_TEST_DATABASE_URL")
                .expect("isolated database URL"),
        )
        .await
        .unwrap();
        let mut tx = conn.begin().await.unwrap();
        // Reuse the original governed Catalog/Resource fixture, changing only
        // its declared execution mode and matching workflow projection. This
        // still executes every original constraint; no trigger is disabled.
        let fixture=include_str!("../../../verify/application-execution-dispatch.sql")
            .replace("'executionMode','PROTOCOL'","'executionMode','TEMPORAL'")
            .replace("'workflowType','NONE'","'workflowType','ComponentTaskWorkflow'")
            .replace("manifest:=jsonb_build_object('componentTypeKey',provider,", "manifest:=jsonb_build_object('executionConnector',jsonb_build_object('mode','REMOTE_ADAPTER'),'componentTypeKey',provider,")
            .replace("'read','resource','PROTOCOL','NONE'","'read','resource','TEMPORAL','NONE'")
            .replace("NULL,NULL,'NATIVE',NULL,action", "'ComponentTaskWorkflow','COMPONENT_ACTION','NATIVE',NULL,action")
            .replace("'COMPONENT_BINDING',tenant,business_ae", "'COMPONENT_ACTION',tenant,business_ae");
        sqlx::raw_sql(&fixture).execute(&mut *tx).await.unwrap();
        let (action, binding, release): (Uuid, Uuid, Uuid) =
            sqlx::query_as("select child,binding,release from application_dispatch_fixture")
                .fetch_one(&mut *tx)
                .await
                .unwrap();
        let (tenant, resource): (Uuid, Uuid) = sqlx::query_as(
            "select tenant_id,target_id from admission.action_execution where id=$1",
        )
        .bind(action)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        // Re-registration uses the actual production writer and must retain
        // the exact approved declaration rather than replace it by key alone.
        crate::application_catalog::register_release_definitions(&mut tx, release)
            .await
            .unwrap();
        let current = facts(
            &mut tx,
            tenant,
            &Target {
                id: resource,
                version: 2,
                workspace_id: None,
            },
            "isolated.lookup@v1",
            1,
            "RESOURCE",
        )
        .await
        .unwrap();
        assert_eq!(current.binding, binding);
        assert_eq!(current.application.component_release_id, release);
        assert_eq!(
            current.application.definition.workflow_kind.as_deref(),
            Some(KIND)
        );
        assert!(facts(
            &mut tx,
            tenant,
            &Target {
                id: resource,
                version: 1,
                workspace_id: None
            },
            "isolated.lookup@v1",
            1,
            "RESOURCE"
        )
        .await
        .is_err());
        assert!(facts(
            &mut tx,
            Uuid::new_v4(),
            &Target {
                id: resource,
                version: 2,
                workspace_id: None
            },
            "isolated.lookup@v1",
            1,
            "RESOURCE"
        )
        .await
        .is_err());
        assert!(facts(
            &mut tx,
            tenant,
            &Target {
                id: resource,
                version: 2,
                workspace_id: Some(Uuid::new_v4())
            },
            "isolated.lookup@v1",
            1,
            "RESOURCE"
        )
        .await
        .is_err());
        tx.rollback().await.unwrap();
    }
}
