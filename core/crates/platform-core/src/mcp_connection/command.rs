//! DD-149(8), 05 §2.15: the HUMAN-only connector management actions.
//!
//! Each action is a governed SYNC ActionExecution: idempotent by the caller key and a
//! frozen command digest (the transient credential is never part of it), fresh
//! Tenant/Workspace/Resource checks, INTENT/DECISION/DISPATCH/OUTCOME audit. Actions
//! with external effects (OpenBao, SpiceDB) persist their Core facts and a write-ahead
//! `UNKNOWN` dispatch first; the same key re-drives completion, nothing is replayed blind.

use axum::http::StatusCode;
use contracts::{ActionCommand, ActionSubmission, EvidenceKind, ReasonCode};
use serde_json::{json, Value};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use super::{
    conflict, credential, denied, invalid, not_active, projection, scope_failed, unavailable,
    Connection, FrozenTool, Policy, Risk, CREATE, DELETE, DISABLE, ENABLE, POLICY, ROTATE, UPDATE,
};
use crate::audit::Evidence;
use crate::bff::{BffState, ExecutionContext};
use crate::governance::{Actor, Definition, Evaluation, Execution, Refusal, Target};
use crate::mcp_egress::EgressScope;
use crate::spicedb::Consistency;

type Submitted = Result<(StatusCode, ActionSubmission), (Refusal, Option<Uuid>)>;

fn actor(ctx: &ExecutionContext) -> Actor {
    Actor {
        tenant_id: ctx.tenant_id,
        principal_id: ctx.tenant_principal_id,
        human_identity_id: Some(ctx.human_identity_id),
    }
}

fn rejected(reason: ReasonCode) -> Refusal {
    match reason {
        ReasonCode::TargetStateConflict => Refusal::Conflict(reason),
        ReasonCode::CapabilityBlocked => Refusal::Blocked(reason),
        ReasonCode::TargetNotFound
        | ReasonCode::InvalidParameters
        | ReasonCode::BindingNotActive => Refusal::Precondition(reason),
        reason => Refusal::Denied(reason),
    }
}

fn allowed(token: Option<String>) -> Evaluation {
    Evaluation {
        allowed: true,
        scope: "ALLOW",
        authorization: "ALLOW",
        quota: "NOT_APPLICABLE",
        zed_token: token,
        reason: None,
    }
}

fn refused(scope_ok: bool, reason: ReasonCode) -> Evaluation {
    Evaluation {
        allowed: false,
        scope: if scope_ok { "ALLOW" } else { "DENY" },
        authorization: if scope_ok { "DENY" } else { "NOT_APPLICABLE" },
        quota: "NOT_APPLICABLE",
        zed_token: None,
        reason: Some(reason),
    }
}

/// The catalog row must be exactly the 05 §2.15 policy for this key.
fn validate_definition(d: &Definition) -> Result<(), Refusal> {
    let (target, object, permission) = match d.action_key.as_str() {
        CREATE => ("RESOURCE", "tenant", "discover"),
        POLICY => ("TENANT", "tenant", "manage"),
        UPDATE | ROTATE | DISABLE | ENABLE | DELETE => ("RESOURCE", "resource", "manage"),
        _ => return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)),
    };
    if d.component_type_key != "core"
        || d.target_type != target
        || d.tenant_rule != "SESSION_TENANT"
        || d.workspace_rule != "TENANT_ONLY"
        || d.permission != permission
        || d.permission_object_type != object
        || d.execution_mode != "SYNC"
        || d.confirmation_mode != "EXPLICIT"
        || d.approval_policy_id.is_some()
        || d.workflow_kind.is_some()
        || d.result_exposure != "NONE"
        || d.quota_policy != "NONE"
        || !d.meters.is_empty()
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    Ok(())
}

/// Only this action's fields may be present (05 §2.15); the transient credential and
/// OAuth attempt only where the action takes them.
fn validate_fields(cmd: &ActionCommand) -> Result<(), Refusal> {
    let raw = serde_json::to_value(cmd).map_err(|_| invalid())?;
    let allowed: &[&str] = match cmd.action_key.as_str() {
        CREATE => &["mcpConnectionCreate", "mcpConnectionCredential"],
        UPDATE => &["resourceId", "resourceVersion", "mcpConnectionUpdate"],
        ROTATE => &[
            "resourceId",
            "resourceVersion",
            "mcpConnectionCredential",
            "mcpOauthAttemptId",
        ],
        DISABLE | ENABLE | DELETE => &["resourceId", "resourceVersion"],
        POLICY => &["mcpConnectionPolicyUpdate"],
        _ => return Err(invalid()),
    };
    let valid = raw.as_object().is_some_and(|fields| {
        fields.iter().all(|(key, value)| {
            value.is_null()
                || matches!(
                    key.as_str(),
                    "actionKey" | "idempotencyKey" | "explicitConfirmation"
                )
                || allowed.contains(&key.as_str())
        })
    });
    if !valid || cmd.explicit_confirmation != Some(true) {
        return Err(invalid());
    }
    let required = match cmd.action_key.as_str() {
        CREATE => cmd.mcp_connection_create.is_some(),
        UPDATE => cmd.mcp_connection_update.is_some() && cmd.resource_id.is_some(),
        ROTATE | DISABLE | ENABLE | DELETE => {
            cmd.resource_id.is_some() && cmd.resource_version.is_some()
        }
        POLICY => cmd.mcp_connection_policy_update.is_some(),
        _ => false,
    };
    if !required {
        return Err(invalid());
    }
    Ok(())
}

/// The frozen intent: the command without its transient credential value.
fn command_digest(cmd: &ActionCommand) -> Result<String, Refusal> {
    let mut raw = serde_json::to_value(cmd).map_err(|_| invalid())?;
    let fields = raw.as_object_mut().ok_or_else(invalid)?;
    fields.remove("idempotencyKey");
    let credential = fields.remove("mcpConnectionCredential").is_some();
    fields.insert("credentialPresent".into(), Value::Bool(credential));
    Ok(collab_bridge::limits::canonical_digest(&raw))
}

/// `POST /api/v1/actions` consumer for the connector management keys.
pub(crate) async fn submit(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &ActionCommand,
) -> Submitted {
    if ctx.access_mode != contracts::PlatformSessionAccessMode::Full {
        return Err((scope_failed(), None));
    }
    validate_fields(cmd).map_err(|e| (e, None))?;
    let key = Uuid::parse_str(&cmd.idempotency_key).map_err(|_| (invalid(), None))?;
    let frozen = command_digest(cmd).map_err(|e| (e, None))?;
    if let Some(id) = existing(state, ctx, key).await.map_err(|e| (e, None))? {
        return replay(state, ctx, id, cmd, &frozen).await;
    }
    if !crate::capability_registry::action_exposed(&cmd.action_key) {
        return Err((Refusal::Blocked(ReasonCode::CapabilityBlocked), None));
    }
    let definition = crate::governance::active_definition(&state.pool, &cmd.action_key)
        .await
        .map_err(|e| (e.into(), None))?
        .ok_or((Refusal::Blocked(ReasonCode::CapabilityBlocked), None))?;
    validate_definition(&definition).map_err(|e| (e, None))?;
    let intent = Intent {
        definition: &definition,
        key,
        frozen: &frozen,
    };
    match cmd.action_key.as_str() {
        CREATE => create(state, ctx, cmd, &intent).await,
        UPDATE => update(state, ctx, cmd, &intent).await,
        ROTATE => rotate(state, ctx, cmd, &intent).await,
        DISABLE | ENABLE => toggle(state, ctx, cmd, &intent).await,
        DELETE => delete(state, ctx, cmd, &intent).await,
        POLICY => policy(state, ctx, cmd, &intent).await,
        _ => Err((invalid(), None)),
    }
}

struct Intent<'a> {
    definition: &'a Definition,
    key: Uuid,
    frozen: &'a str,
}

async fn existing(
    state: &BffState,
    ctx: &ExecutionContext,
    key: Uuid,
) -> Result<Option<Uuid>, Refusal> {
    Ok(sqlx::query_scalar(
        "select id from admission.action_execution
         where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3",
    )
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .bind(key)
    .fetch_optional(&state.pool)
    .await?)
}

/// The same key answers the original operation only; an UNKNOWN dispatch is re-driven
/// with the replayed command (which may carry the transient credential again).
async fn replay(
    state: &BffState,
    ctx: &ExecutionContext,
    id: Uuid,
    cmd: &ActionCommand,
    frozen: &str,
) -> Submitted {
    let ae = crate::governance::load_execution(&state.pool, id)
        .await
        .map_err(|e| (e.into(), None))?
        .ok_or_else(|| (unavailable("operation"), None))?;
    let operation = Some(ae.operation_id);
    if ae.action_key != cmd.action_key
        || ae
            .parameters
            .as_ref()
            .and_then(|p| p["commandDigest"].as_str())
            != Some(frozen)
    {
        return Err((
            Refusal::Conflict(ReasonCode::IdempotencyKeyReused),
            operation,
        ));
    }
    match (ae.gate_state.as_str(), ae.dispatch_state.as_str()) {
        ("DENIED", _) => {
            let reason = ae
                .reason_code
                .as_deref()
                .and_then(crate::governance::parse::<ReasonCode>)
                .unwrap_or(ReasonCode::PermissionDenied);
            Err((rejected(reason), operation))
        }
        ("ALLOWED", "DISPATCHED") => Ok((StatusCode::OK, ae.submission())),
        ("ALLOWED", "UNKNOWN" | "NOT_DISPATCHED") => {
            let value = cmd
                .mcp_connection_credential
                .as_ref()
                .map(|c| c.value.as_str());
            complete(&state.memory_service, ctx.tenant_id, ae.id, value)
                .await
                .map_err(|e| (e, operation))
        }
        _ => Err((unavailable("operation not dispatchable"), operation)),
    }
}

// ---------------------------------------------------------------------------
// Admission
// ---------------------------------------------------------------------------

async fn active_member(
    conn: &mut PgConnection,
    tenant: Uuid,
    principal: Uuid,
) -> Result<bool, Refusal> {
    Ok(sqlx::query_scalar(
        "select exists(select 1 from identity.principal p
         join identity.tenant t on t.id=p.tenant_id
         join identity.tenant_membership tm on tm.tenant_principal_id=p.id
         where p.id=$1 and p.tenant_id=$2 and p.kind='HUMAN' and p.status='ACTIVE'
           and t.state='ACTIVE' and tm.state='ACTIVE')",
    )
    .bind(principal)
    .bind(tenant)
    .fetch_one(conn)
    .await?)
}

/// Fresh SpiceDB check; `Ok(Some(token))` when allowed, `Ok(None)` when denied.
pub(crate) async fn check(
    state: &crate::service_api::ServiceState,
    object_type: &str,
    object: Uuid,
    permission: &str,
    subject: Uuid,
) -> Result<Option<String>, Refusal> {
    let proof = state
        .governance
        .spicedb
        .check(
            object_type,
            &object.to_string(),
            permission,
            &subject.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| unavailable("fresh permission"))?;
    if proof.zed_token.is_empty() {
        return Err(unavailable("permission revision"));
    }
    Ok(proof.allowed.then_some(proof.zed_token))
}

/// DD-149(4): who may register a connector of a given visibility.
pub(crate) async fn may_register(
    state: &crate::service_api::ServiceState,
    conn: &mut PgConnection,
    tenant: Uuid,
    principal: Uuid,
    visibility: &str,
    workspace: Option<Uuid>,
) -> Result<Option<String>, Refusal> {
    if !active_member(conn, tenant, principal).await? {
        return Ok(None);
    }
    match (visibility, workspace) {
        ("TENANT", None) => check(state, "tenant", tenant, "manage", principal).await,
        ("WORKSPACE", Some(workspace)) => {
            let active: bool = sqlx::query_scalar(
                "select exists(select 1 from identity.workspace where id=$1 and tenant_id=$2 and state='ACTIVE')",
            )
            .bind(workspace)
            .bind(tenant)
            .fetch_one(&mut *conn)
            .await?;
            if !active {
                return Ok(None);
            }
            check(state, "workspace", workspace, "manage", principal).await
        }
        ("PERSONAL", None) => {
            if let Some(token) = check(state, "tenant", tenant, "manage", principal).await? {
                return Ok(Some(token));
            }
            let policy = super::tenant_policy(conn, tenant).await?;
            if policy.member_registration != "PERSONAL_ONLY" {
                return Ok(None);
            }
            check(state, "tenant", tenant, "discover", principal).await
        }
        _ => Err(invalid()),
    }
}

async fn record_denied(
    state: &BffState,
    ctx: &ExecutionContext,
    intent: &Intent<'_>,
    target: &Target,
    parameters: Value,
    evaluation: &Evaluation,
) -> Option<Uuid> {
    let result: Result<Option<Uuid>, Refusal> = async {
        let mut tx = state.pool.begin().await?;
        let hash = parameter_hash(intent.definition, target.id, &parameters);
        let ae = match crate::governance::open_execution_values(
            &mut tx,
            actor(ctx),
            ctx.tenant_principal_id,
            intent.definition,
            target,
            parameters,
            hash,
            intent.key,
            None,
        )
        .await
        {
            Ok(ae) => ae,
            Err(sqlx::Error::Database(e)) if e.is_unique_violation() => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        let reason = evaluation.reason.clone().unwrap_or(ReasonCode::PermissionDenied);
        crate::governance::record_decision(
            &mut tx,
            &ae.subject(),
            "ADMISSION",
            evaluation.scope,
            evaluation.authorization,
            "NOT_APPLICABLE",
            evaluation.quota,
            evaluation.zed_token.as_deref(),
            Some(&reason),
        )
        .await?;
        sqlx::query(
            "update admission.action_execution set gate_state='DENIED',reason_code=$2,updated_at=now() where id=$1",
        )
        .bind(ae.id)
        .bind(crate::governance::wire(&reason))
        .execute(&mut *tx)
        .await?;
        crate::governance::audit(
            &mut tx,
            &ae,
            intent.definition,
            "decision",
            "DECISION",
            "DENY",
            &crate::governance::wire(&reason),
            Some(ctx.human_identity_id),
            Vec::new(),
        )
        .await?;
        tx.commit().await?;
        Ok(Some(ae.operation_id))
    }
    .await;
    result.unwrap_or_else(|error| {
        tracing::warn!(error = ?error, "connector denial record unavailable");
        None
    })
}

fn parameter_hash(def: &Definition, target: Uuid, parameters: &Value) -> String {
    collab_bridge::limits::canonical_digest(&json!({"actionKey":def.action_key,
        "actionVersion":def.version,"targetId":target,"parameters":parameters}))
}

/// Open the admitted execution in the caller's transaction with its ALLOW decision.
async fn open_allowed(
    tx: &mut Transaction<'_, Postgres>,
    ctx: &ExecutionContext,
    intent: &Intent<'_>,
    target: &Target,
    parameters: Value,
    evaluation: &Evaluation,
) -> Result<Execution, Refusal> {
    let hash = parameter_hash(intent.definition, target.id, &parameters);
    let ae = match crate::governance::open_execution_values(
        tx,
        actor(ctx),
        ctx.tenant_principal_id,
        intent.definition,
        target,
        parameters,
        hash,
        intent.key,
        None,
    )
    .await
    {
        Ok(ae) => ae,
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => return Err(conflict()),
        Err(e) => return Err(e.into()),
    };
    crate::governance::record_decision(
        tx,
        &ae.subject(),
        "ADMISSION",
        evaluation.scope,
        evaluation.authorization,
        "NOT_APPLICABLE",
        evaluation.quota,
        evaluation.zed_token.as_deref(),
        None,
    )
    .await?;
    sqlx::query("update admission.action_execution set gate_state='ALLOWED',reason_code=null,updated_at=now() where id=$1")
        .bind(ae.id)
        .execute(&mut **tx)
        .await?;
    let evidence = evaluation
        .zed_token
        .iter()
        .map(|token| Evidence::new(EvidenceKind::SpicedbZedtoken, token))
        .collect();
    crate::governance::audit(
        tx,
        &ae,
        intent.definition,
        "decision",
        "DECISION",
        "ALLOW",
        "ALLOWED",
        Some(ctx.human_identity_id),
        evidence,
    )
    .await?;
    Ok(crate::governance::lock_execution(tx, ae.id).await?)
}

/// Write-ahead: external effects follow; their result is UNKNOWN until completion.
async fn write_ahead(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
) -> Result<(), Refusal> {
    crate::governance::record_dispatch(
        tx,
        ae.id,
        def.audit_class(),
        Err(StatusCode::SERVICE_UNAVAILABLE),
        Vec::new(),
    )
    .await?;
    Ok(())
}

/// Close a local (same-transaction) action: DISPATCHED and OUTCOME together.
async fn finish_local(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    outcome: &str,
    evidence: Vec<Evidence>,
) -> Result<(), Refusal> {
    crate::governance::record_dispatch(tx, ae.id, def.audit_class(), Ok(()), evidence.clone())
        .await?;
    let current = crate::governance::lock_execution(tx, ae.id).await?;
    crate::governance::audit(
        tx, &current, def, "outcome", "OUTCOME", "ALLOW", outcome, None, evidence,
    )
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Probe-backed validation shared by create and update
// ---------------------------------------------------------------------------

pub(crate) struct Confirmed {
    pub(crate) server: Value,
    pub(crate) digest: String,
    pub(crate) tools: Vec<FrozenTool>,
}

/// Re-probe and freeze the confirmed selection (DD-149(7)): the digest must equal what
/// the user confirmed; only probed tools; AUTO only for read-only; lowering the risk
/// below the annotation suggestion needs an explicit per-tool declaration.
pub(crate) fn confirm(
    probe: &crate::mcp_client::Probe,
    digest: &str,
    selections: &[contracts::McpToolSelection],
) -> Result<Confirmed, Refusal> {
    let fresh = crate::mcp_client::tools_digest(&probe.tools);
    if fresh != digest {
        return Err(conflict());
    }
    let mut seen = std::collections::HashSet::new();
    let mut tools = Vec::new();
    for selection in selections {
        if !seen.insert(selection.upstream_name.as_str()) {
            return Err(invalid());
        }
        let probed = probe
            .tools
            .iter()
            .find(|tool| tool.name == selection.upstream_name)
            .ok_or_else(invalid)?;
        if !selection.enabled {
            continue;
        }
        if !super::valid_upstream_name(&probed.name) {
            return Err(invalid());
        }
        let risk = Risk::parse(&super::wire(&selection.risk)).ok_or_else(invalid)?;
        let policy = Policy::parse(&super::wire(&selection.call_policy)).ok_or_else(invalid)?;
        let suggested = Risk::suggested(&probed.annotations);
        let declared = selection.risk_declared.unwrap_or(false);
        if !policy.allowed_for(risk) || (risk < suggested && !declared) {
            return Err(invalid());
        }
        tools.push(FrozenTool {
            upstream_name: probed.name.clone(),
            title: probed.title.clone(),
            description: probed.description.clone(),
            input_schema: probed.input_schema.clone(),
            output_schema: probed.output_schema.clone(),
            annotations: super::annotations_json(&probed.annotations),
            risk: risk.wire().into(),
            call_policy: policy.wire().into(),
            risk_declared: risk < suggested && declared,
        });
    }
    if tools.is_empty() || tools.len() > super::MAX_TOOLS {
        return Err(invalid());
    }
    let listed: Vec<Value> = probe
        .tools
        .iter()
        .map(|tool| json!({"name":tool.name,"digest":probed_digest(tool)}))
        .collect();
    let server = json!({"name":probe.server.name,"version":probe.server.version,
        "protocolVersion":probe.server.protocol_version,"tools":listed});
    Ok(Confirmed {
        server,
        digest: fresh,
        tools,
    })
}

/// Digest of everything the model or the call contract sees of one upstream tool.
pub(crate) fn probed_digest(tool: &crate::mcp_client::ProbedTool) -> String {
    collab_bridge::limits::canonical_digest(
        &json!({"title":tool.title,"description":tool.description,
        "inputSchema":tool.input_schema,"outputSchema":tool.output_schema,
        "annotations":super::annotations_json(&tool.annotations)}),
    )
}

/// Probe failures as user-meaningful reasons: egress outside the allowlist is
/// PERMISSION_DENIED, any other egress or protocol refusal INVALID_PARAMETERS, a
/// refused credential BINDING_NOT_ACTIVE, an unreachable service DEPENDENCY_UNAVAILABLE.
pub(crate) fn probe_refusal(error: crate::mcp_client::McpError) -> Refusal {
    use crate::mcp_client::McpError;
    match error {
        McpError::Egress(crate::mcp_egress::EgressError::NotInAllowlist) => denied(),
        McpError::Egress(crate::mcp_egress::EgressError::ResolutionFailed) => {
            unavailable("endpoint name not resolvable")
        }
        McpError::Egress(_) => invalid(),
        McpError::Unauthorized { .. } => not_active(),
        McpError::TooLarge => Refusal::Limit(ReasonCode::PayloadTooLarge),
        McpError::Protocol(_) => invalid(),
        McpError::Timeout => Refusal::Limit(ReasonCode::StepTimeout),
        McpError::Unreachable | McpError::OutcomeUnknown => unavailable("endpoint unreachable"),
    }
}

pub(crate) async fn fresh_probe(
    url: &reqwest::Url,
    transport: crate::mcp_client::Transport,
    credential: Option<&crate::mcp_client::Credential>,
    scope: EgressScope<'_>,
) -> Result<crate::mcp_client::Probe, Refusal> {
    let target = crate::mcp_client::Target {
        url,
        transport,
        credential,
        scope,
        limits: crate::mcp_client::Limits::probe(),
    };
    crate::mcp_client::probe(&target)
        .await
        .map_err(probe_refusal)
}

// ---------------------------------------------------------------------------
// mcp_connection.create
// ---------------------------------------------------------------------------

fn transient(cmd: &ActionCommand) -> Option<&str> {
    cmd.mcp_connection_credential
        .as_ref()
        .map(|c| c.value.as_str())
}

async fn create(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &ActionCommand,
    intent: &Intent<'_>,
) -> Submitted {
    let service = &state.memory_service;
    let input = cmd
        .mcp_connection_create
        .as_ref()
        .ok_or((invalid(), None))?;
    let name = input.display_name.trim();
    let visibility = super::wire(&input.visibility);
    let auth_mode = super::wire(&input.auth_mode);
    let workspace = input
        .workspace_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| (invalid(), None))?;
    let oauth_attempt = input
        .oauth_attempt_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| (invalid(), None))?;
    let header = input.api_key_header.as_deref();
    let shape = !name.is_empty()
        && name.chars().count() <= 80
        && (visibility == "WORKSPACE") == workspace.is_some()
        && (auth_mode == "API_KEY") == header.is_some()
        && header.is_none_or(super::valid_api_key_header)
        && matches!(auth_mode.as_str(), "API_KEY" | "BEARER") == transient(cmd).is_some()
        && (auth_mode == "OAUTH") == oauth_attempt.is_some()
        && (auth_mode == "OAUTH" || input.shared_authorization_consent.is_none());
    if !shape {
        return Err((invalid(), None));
    }
    if auth_mode == "OAUTH"
        && visibility != "PERSONAL"
        && input.shared_authorization_consent != Some(true)
    {
        return Err((invalid(), None));
    }
    let url =
        crate::mcp_egress::parse_endpoint(&input.endpoint_url).map_err(|_| (invalid(), None))?;
    let transport = super::transport(&super::wire(&input.transport)).ok_or((invalid(), None))?;
    let resource = Uuid::new_v4();
    let target = Target {
        id: resource,
        version: 0,
        workspace_id: None,
    };
    let summary = json!({"commandDigest":intent.frozen,"endpointHost":url.host_str(),
        "visibility":visibility,"workspaceId":workspace,"authMode":auth_mode,"toolsDigest":input.tools_digest});
    let mut conn = state.pool.acquire().await.map_err(|e| (e.into(), None))?;
    let token = may_register(
        service,
        &mut conn,
        ctx.tenant_id,
        ctx.tenant_principal_id,
        &visibility,
        workspace,
    )
    .await
    .map_err(|e| (e, None))?;
    let Some(token) = token else {
        let evaluation = refused(true, ReasonCode::PermissionDenied);
        let op = record_denied(state, ctx, intent, &target, summary, &evaluation).await;
        return Err((denied(), op));
    };
    let platform = super::platform_egress().map_err(|e| (e, None))?;
    let policy = super::tenant_policy(&mut conn, ctx.tenant_id)
        .await
        .map_err(|e| (e, None))?;
    let scope = EgressScope {
        platform: &platform,
        tenant_suffixes: &policy.egress_host_suffixes,
    };
    if !crate::mcp_egress::host_permitted(&scope, url.host_str().unwrap_or_default()) {
        let evaluation = refused(true, ReasonCode::PermissionDenied);
        let op = record_denied(state, ctx, intent, &target, summary, &evaluation).await;
        return Err((denied(), op));
    }
    // OAuth: the attempt is this HUMAN's, completed, unconsumed and for this endpoint.
    let attempt = match oauth_attempt {
        Some(id) => Some(
            super::oauth::completed_attempt(
                &mut conn,
                ctx,
                id,
                &input.endpoint_url,
                &super::wire(&input.transport),
                None,
            )
            .await
            .map_err(|e| (e, None))?,
        ),
        None => None,
    };
    drop(conn);
    let probe_credential = match (&attempt, transient(cmd)) {
        (Some(attempt), _) => super::oauth::attempt_credential(service, attempt)
            .await
            .map_err(|e| (e, None))?,
        (None, Some(value)) => {
            credential::header_for(&auth_mode, header, value).map_err(|e| (e, None))?
        }
        (None, None) => None,
    };
    let probe = fresh_probe(&url, transport, probe_credential.as_ref(), scope)
        .await
        .map_err(|e| (e, None))?;
    let confirmed = confirm(&probe, &input.tools_digest, &input.tools).map_err(|e| (e, None))?;

    let mut tx = state.pool.begin().await.map_err(|e| (e.into(), None))?;
    if !crate::roles::lock_tenant(&mut tx, ctx.tenant_id)
        .await
        .map_err(|e| (e.into(), None))?
    {
        return Err((scope_failed(), None));
    }
    let slug = super::allocate_slug(&mut tx, ctx.tenant_id, name)
        .await
        .map_err(|e| (e, None))?;
    let reference = match (&attempt, auth_mode.as_str()) {
        (Some(attempt), _) => Some(attempt.credential.clone()),
        (None, "API_KEY" | "BEARER") => {
            Some(credential::new_reference(service, ctx.tenant_id).map_err(|e| (e, None))?)
        }
        _ => None,
    };
    let mut parameters = summary;
    parameters["slug"] = json!(slug);
    parameters["credentialRef"] = reference
        .as_ref()
        .map(credential::reference_json)
        .unwrap_or(Value::Null);
    let ae = open_allowed(
        &mut tx,
        ctx,
        intent,
        &target,
        parameters,
        &allowed(Some(token)),
    )
    .await
    .map_err(|e| (e, None))?;
    let op = Some(ae.operation_id);
    let oauth_json = attempt.as_ref().map(|a| a.oauth_json());
    sqlx::query(
        "insert into catalog.resource(id,tenant_id,type_key,home_workspace_id,owner_principal_id,component_type_key,
         native_type,native_id,state,version,projection_action_execution_id)
         values($1,$2,'mcp.connection',$3,$4,'core','mcp.connection',$1::text,'PROVISIONING',1,$5)",
    )
    .bind(resource)
    .bind(ctx.tenant_id)
    .bind(workspace)
    .bind(ctx.tenant_principal_id)
    .bind(ae.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| (e.into(), op))?;
    sqlx::query(
        "insert into catalog.mcp_connection(resource_id,tenant_id,slug,display_name,endpoint_url,endpoint_host,
         transport,auth_mode,api_key_header,visibility,workspace_id,credential_ref,credential_updated_at,oauth,
         shared_authorization_consent,active_generation,state,version,created_by_action_execution_id)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,case when $12::jsonb is null then null else now() end,$13,$14,1,'ACTIVE',1,$15)",
    )
    .bind(resource)
    .bind(ctx.tenant_id)
    .bind(&slug)
    .bind(name)
    .bind(url.as_str())
    .bind(url.host_str().unwrap_or_default().to_ascii_lowercase())
    .bind(super::wire(&input.transport))
    .bind(&auth_mode)
    .bind(header)
    .bind(&visibility)
    .bind(workspace)
    .bind(reference.as_ref().map(credential::reference_json))
    .bind(oauth_json)
    .bind(input.shared_authorization_consent.unwrap_or(false))
    .bind(ae.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| (e.into(), op))?;
    insert_generation(&mut tx, resource, 1, &confirmed, ae.id)
        .await
        .map_err(|e| (e, op))?;
    for tool in &confirmed.tools {
        insert_tool(
            &mut tx,
            ctx.tenant_id,
            resource,
            &slug,
            workspace,
            ctx.tenant_principal_id,
            tool,
            1,
            ae.id,
        )
        .await
        .map_err(|e| (e, op))?;
    }
    record_health(&mut tx, resource, "OK", Some(&confirmed.digest), &probe)
        .await
        .map_err(|e| (e, op))?;
    if let Some(attempt) = &attempt {
        super::oauth::consume_attempt(&mut tx, attempt.id, ae.id)
            .await
            .map_err(|e| (e, op))?;
    }
    write_ahead(&mut tx, &ae, intent.definition)
        .await
        .map_err(|e| (e, op))?;
    tx.commit().await.map_err(|e| (e.into(), op))?;
    complete(service, ctx.tenant_id, ae.id, transient(cmd))
        .await
        .map_err(|e| (e, op))
}

async fn insert_generation(
    tx: &mut Transaction<'_, Postgres>,
    resource: Uuid,
    generation: i32,
    confirmed: &Confirmed,
    action: Uuid,
) -> Result<(), Refusal> {
    sqlx::query(
        "insert into catalog.mcp_connection_generation(resource_id,generation,server_info,tools_digest,tools,action_execution_id)
         values($1,$2,$3,$4,$5,$6)",
    )
    .bind(resource)
    .bind(generation)
    .bind(&confirmed.server)
    .bind(&confirmed.digest)
    .bind(serde_json::to_value(&confirmed.tools).map_err(|_| invalid())?)
    .bind(action)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn insert_tool(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    connection: Uuid,
    slug: &str,
    workspace: Option<Uuid>,
    owner: Uuid,
    tool: &FrozenTool,
    first_generation: i32,
    action: Uuid,
) -> Result<Uuid, Refusal> {
    let policy = Policy::parse(&tool.call_policy).ok_or_else(invalid)?;
    let action_key = policy.action_key();
    let id = super::tool_resource_id(connection, tool, action_key, first_generation);
    sqlx::query(
        "insert into catalog.resource(id,tenant_id,type_key,home_workspace_id,owner_principal_id,component_type_key,
         native_type,native_id,state,version,projection_action_execution_id)
         values($1,$2,'tool.definition',$3,$4,'core','tool.definition',$1::text,'PROVISIONING',1,$5)",
    )
    .bind(id)
    .bind(tenant)
    .bind(workspace)
    .bind(owner)
    .bind(action)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "insert into catalog.tool_definition(resource_id,name,source,action_key,capability_contract_key,
         input_schema_hash,output_schema_hash,backend_ref,status,mcp_connection_id,upstream_name,risk,risk_declared,
         first_generation,title,description,input_schema,output_schema,annotations)
         values($1,$2,'USER_REGISTERED_EXTERNAL',$3,null,$4,$5,$6,'PROVISIONING',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
    )
    .bind(id)
    .bind(super::tool_name(slug, &tool.upstream_name))
    .bind(action_key)
    .bind(super::input_schema_hash(&tool.input_schema))
    .bind(super::output_schema_hash())
    .bind(super::BACKEND_REF)
    .bind(connection)
    .bind(&tool.upstream_name)
    .bind(&tool.risk)
    .bind(tool.risk_declared)
    .bind(first_generation)
    .bind(&tool.title)
    .bind(&tool.description)
    .bind(&tool.input_schema)
    .bind(&tool.output_schema)
    .bind(&tool.annotations)
    .execute(&mut **tx)
    .await?;
    Ok(id)
}

pub(crate) async fn record_health(
    conn: &mut PgConnection,
    resource: Uuid,
    health: &str,
    digest: Option<&str>,
    probe: &crate::mcp_client::Probe,
) -> Result<(), Refusal> {
    sqlx::query(
        "insert into projection.mcp_connection_health(resource_id,health,checked_at,observed_tools_digest,server_name,server_version)
         values($1,$2,now(),$3,$4,$5)
         on conflict(resource_id) do update set health=excluded.health,checked_at=excluded.checked_at,
           observed_tools_digest=coalesce(excluded.observed_tools_digest,projection.mcp_connection_health.observed_tools_digest),
           server_name=coalesce(excluded.server_name,projection.mcp_connection_health.server_name),
           server_version=coalesce(excluded.server_version,projection.mcp_connection_health.server_version)",
    )
    .bind(resource)
    .bind(health)
    .bind(digest)
    .bind(&probe.server.name)
    .bind(&probe.server.version)
    .execute(conn)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// mcp_connection.update
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct ToolRow {
    resource_id: Uuid,
    upstream_name: String,
    action_key: String,
    first_generation: i32,
}

async fn active_tools(conn: &mut PgConnection, connection: Uuid) -> Result<Vec<ToolRow>, Refusal> {
    Ok(sqlx::query_as(
        "select t.resource_id,t.upstream_name,t.action_key,t.first_generation
         from catalog.tool_definition t where t.mcp_connection_id=$1 and t.status<>'DELETED'
         order by t.resource_id",
    )
    .bind(connection)
    .fetch_all(conn)
    .await?)
}

/// Load the target connector for a Resource-targeted action and check `manage`.
async fn target_connector(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &ActionCommand,
    intent: &Intent<'_>,
    states: &[&str],
) -> Result<(Connection, Target, String), (Refusal, Option<Uuid>)> {
    let id = cmd
        .resource_id
        .as_deref()
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or((invalid(), None))?;
    let version = cmd
        .resource_version
        .and_then(|v| i32::try_from(v).ok())
        .ok_or((invalid(), None))?;
    let mut conn = state.pool.acquire().await.map_err(|e| (e.into(), None))?;
    let connection = super::load(&mut conn, ctx.tenant_id, id, false)
        .await
        .map_err(|e| (e, None))?
        .ok_or((Refusal::Precondition(ReasonCode::TargetNotFound), None))?;
    let target = Target {
        id,
        version,
        workspace_id: None,
    };
    let summary = json!({"commandDigest":intent.frozen,"targetVersion":version});
    let member = active_member(&mut conn, ctx.tenant_id, ctx.tenant_principal_id)
        .await
        .map_err(|e| (e, None))?;
    let token = if member {
        check(
            &state.memory_service,
            "resource",
            id,
            "manage",
            ctx.tenant_principal_id,
        )
        .await
        .map_err(|e| (e, None))?
    } else {
        None
    };
    let Some(token) = token else {
        let evaluation = refused(
            member,
            if member {
                ReasonCode::PermissionDenied
            } else {
                ReasonCode::ScopeGuardFailed
            },
        );
        let op = record_denied(state, ctx, intent, &target, summary, &evaluation).await;
        return Err((if member { denied() } else { scope_failed() }, op));
    };
    if connection.resource_version != version
        || connection.projection_action_execution_id.is_some()
        || !states.contains(&connection.state.as_str())
    {
        let evaluation = Evaluation {
            reason: Some(ReasonCode::TargetStateConflict),
            ..refused(true, ReasonCode::TargetStateConflict)
        };
        let op = record_denied(state, ctx, intent, &target, summary, &evaluation).await;
        return Err((conflict(), op));
    }
    Ok((connection, target, token))
}

async fn update(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &ActionCommand,
    intent: &Intent<'_>,
) -> Submitted {
    let service = &state.memory_service;
    let input = cmd
        .mcp_connection_update
        .as_ref()
        .ok_or((invalid(), None))?;
    let (connection, target, token) =
        target_connector(state, ctx, cmd, intent, &["ACTIVE"]).await?;
    let visibility = super::wire(&input.visibility);
    let workspace = input
        .workspace_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| (invalid(), None))?;
    // Workspace-scoped connectors keep their Workspace; others switch between
    // PERSONAL and TENANT only (the home Workspace of a Resource is immutable).
    let same_scope = if connection.visibility == "WORKSPACE" {
        visibility == "WORKSPACE" && workspace == connection.workspace_id
    } else {
        visibility != "WORKSPACE" && workspace.is_none()
    };
    if !same_scope
        || (connection.auth_mode != "OAUTH" && input.shared_authorization_consent.is_some())
        || (connection.auth_mode == "OAUTH"
            && visibility != "PERSONAL"
            && input.shared_authorization_consent != Some(true))
    {
        return Err((invalid(), None));
    }
    if visibility != connection.visibility {
        let mut conn = state.pool.acquire().await.map_err(|e| (e.into(), None))?;
        if may_register(
            service,
            &mut conn,
            ctx.tenant_id,
            ctx.tenant_principal_id,
            &visibility,
            workspace,
        )
        .await
        .map_err(|e| (e, None))?
        .is_none()
        {
            return Err((denied(), None));
        }
    }
    let platform = super::platform_egress().map_err(|e| (e, None))?;
    let policy = {
        let mut conn = state.pool.acquire().await.map_err(|e| (e.into(), None))?;
        super::tenant_policy(&mut conn, ctx.tenant_id)
            .await
            .map_err(|e| (e, None))?
    };
    let scope = EgressScope {
        platform: &platform,
        tenant_suffixes: &policy.egress_host_suffixes,
    };
    let url = connection.url().map_err(|e| (e, None))?;
    let credential = credential::current(service, &connection)
        .await
        .map_err(|e| (e, None))?;
    let probe = fresh_probe(
        &url,
        connection.transport().map_err(|e| (e, None))?,
        credential.as_ref(),
        scope,
    )
    .await
    .map_err(|e| (e, None))?;
    let confirmed = confirm(&probe, &input.tools_digest, &input.tools).map_err(|e| (e, None))?;
    let generation = connection.active_generation + 1;

    let mut tx = state.pool.begin().await.map_err(|e| (e.into(), None))?;
    let locked = super::load(&mut tx, ctx.tenant_id, connection.resource_id, true)
        .await
        .map_err(|e| (e, None))?
        .filter(|c| {
            c.version == connection.version
                && c.state == "ACTIVE"
                && c.projection_action_execution_id.is_none()
        })
        .ok_or((conflict(), None))?;
    let existing = active_tools(&mut tx, locked.resource_id)
        .await
        .map_err(|e| (e, None))?;
    let mut kept = Vec::new();
    let mut added = Vec::new();
    for tool in &confirmed.tools {
        let action_key = Policy::parse(&tool.call_policy)
            .ok_or((invalid(), None))?
            .action_key();
        let same = existing.iter().find(|row| {
            row.upstream_name == tool.upstream_name
                && row.action_key == action_key
                && super::tool_resource_id(
                    locked.resource_id,
                    tool,
                    action_key,
                    row.first_generation,
                ) == row.resource_id
        });
        match same {
            Some(row) => kept.push(row.resource_id),
            None => added.push(tool.clone()),
        }
    }
    let retired: Vec<Uuid> = existing
        .iter()
        .map(|row| row.resource_id)
        .filter(|id| !kept.contains(id))
        .collect();
    let parameters = json!({"commandDigest":intent.frozen,"targetVersion":target.version,
        "generation":generation,"toolsDigest":confirmed.digest,"visibility":visibility,
        "previousVisibility":locked.visibility,"retiredTools":retired,"keptTools":kept});
    let ae = open_allowed(
        &mut tx,
        ctx,
        intent,
        &target,
        parameters,
        &allowed(Some(token)),
    )
    .await
    .map_err(|e| (e, None))?;
    let op = Some(ae.operation_id);
    insert_generation(&mut tx, locked.resource_id, generation, &confirmed, ae.id)
        .await
        .map_err(|e| (e, op))?;
    sqlx::query(
        "update catalog.mcp_connection set active_generation=$2,visibility=$3,shared_authorization_consent=$4,
         version=version+1,updated_at=now() where resource_id=$1",
    )
    .bind(locked.resource_id)
    .bind(generation)
    .bind(&visibility)
    .bind(input.shared_authorization_consent.unwrap_or(false))
    .execute(&mut *tx)
    .await
    .map_err(|e| (e.into(), op))?;
    sqlx::query(
        "update catalog.resource set version=version+1,projection_action_execution_id=$2 where id=$1",
    )
    .bind(locked.resource_id)
    .bind(ae.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| (e.into(), op))?;
    for tool in &added {
        insert_tool(
            &mut tx,
            ctx.tenant_id,
            locked.resource_id,
            &locked.slug,
            locked.workspace_id,
            locked.owner_principal_id,
            tool,
            generation,
            ae.id,
        )
        .await
        .map_err(|e| (e, op))?;
    }
    retire_tools(&mut tx, &retired).await.map_err(|e| (e, op))?;
    record_health(
        &mut tx,
        locked.resource_id,
        "OK",
        Some(&confirmed.digest),
        &probe,
    )
    .await
    .map_err(|e| (e, op))?;
    write_ahead(&mut tx, &ae, intent.definition)
        .await
        .map_err(|e| (e, op))?;
    tx.commit().await.map_err(|e| (e.into(), op))?;
    complete(service, ctx.tenant_id, ae.id, None)
        .await
        .map_err(|e| (e, op))
}

async fn retire_tools(tx: &mut Transaction<'_, Postgres>, tools: &[Uuid]) -> Result<(), Refusal> {
    if tools.is_empty() {
        return Ok(());
    }
    sqlx::query("update catalog.resource set state='DELETED',version=version+1 where id=any($1::uuid[]) and type_key='tool.definition'")
        .bind(tools.to_vec())
        .execute(&mut **tx)
        .await?;
    sqlx::query(
        "update catalog.tool_definition set status='DELETED' where resource_id=any($1::uuid[])",
    )
    .bind(tools.to_vec())
    .execute(&mut **tx)
    .await?;
    sqlx::query("update catalog.tool_binding set status='REVOKED' where tool_resource_id=any($1::uuid[]) and status<>'REVOKED'")
        .bind(tools.to_vec())
        .execute(&mut **tx)
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// mcp_connection.rotate_credential
// ---------------------------------------------------------------------------

async fn rotate(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &ActionCommand,
    intent: &Intent<'_>,
) -> Submitted {
    let service = &state.memory_service;
    let (connection, target, token) =
        target_connector(state, ctx, cmd, intent, &["ACTIVE", "DISABLED"]).await?;
    let attempt_id = cmd
        .mcp_oauth_attempt_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| (invalid(), None))?;
    let shape = match connection.auth_mode.as_str() {
        "API_KEY" | "BEARER" => transient(cmd).is_some() && attempt_id.is_none(),
        "OAUTH" => transient(cmd).is_none() && attempt_id.is_some(),
        _ => false,
    };
    if !shape {
        return Err((invalid(), None));
    }
    let mut conn = state.pool.acquire().await.map_err(|e| (e.into(), None))?;
    let attempt = match attempt_id {
        Some(id) => Some(
            super::oauth::completed_attempt(
                &mut conn,
                ctx,
                id,
                &connection.endpoint_url,
                &connection.transport,
                Some(connection.resource_id),
            )
            .await
            .map_err(|e| (e, None))?,
        ),
        None => None,
    };
    let platform = super::platform_egress().map_err(|e| (e, None))?;
    let policy = super::tenant_policy(&mut conn, ctx.tenant_id)
        .await
        .map_err(|e| (e, None))?;
    drop(conn);
    let scope = EgressScope {
        platform: &platform,
        tenant_suffixes: &policy.egress_host_suffixes,
    };
    let credential_header = match (&attempt, transient(cmd)) {
        (Some(attempt), _) => super::oauth::attempt_credential(service, attempt)
            .await
            .map_err(|e| (e, None))?,
        (None, Some(value)) => credential::header_for(
            &connection.auth_mode,
            connection.api_key_header.as_deref(),
            value,
        )
        .map_err(|e| (e, None))?,
        _ => None,
    };
    let url = connection.url().map_err(|e| (e, None))?;
    let probe = fresh_probe(
        &url,
        connection.transport().map_err(|e| (e, None))?,
        credential_header.as_ref(),
        scope,
    )
    .await
    .map_err(|e| (e, None))?;
    let mut tx = state.pool.begin().await.map_err(|e| (e.into(), None))?;
    let locked = super::load(&mut tx, ctx.tenant_id, connection.resource_id, true)
        .await
        .map_err(|e| (e, None))?
        .filter(|c| c.version == connection.version && c.projection_action_execution_id.is_none())
        .ok_or((conflict(), None))?;
    let reference = match &attempt {
        Some(attempt) => attempt.credential.clone(),
        None => credential::new_reference(service, ctx.tenant_id).map_err(|e| (e, None))?,
    };
    let previous = locked.credential_ref.clone();
    let parameters = json!({"commandDigest":intent.frozen,"targetVersion":target.version,
        "credentialRef":credential::reference_json(&reference),"previousCredentialRef":previous});
    let ae = open_allowed(
        &mut tx,
        ctx,
        intent,
        &target,
        parameters,
        &allowed(Some(token)),
    )
    .await
    .map_err(|e| (e, None))?;
    let op = Some(ae.operation_id);
    sqlx::query(
        "update catalog.mcp_connection set credential_ref=$2,credential_updated_at=now(),oauth=coalesce($3,oauth),
         version=version+1,updated_at=now() where resource_id=$1",
    )
    .bind(locked.resource_id)
    .bind(credential::reference_json(&reference))
    .bind(attempt.as_ref().map(|a| a.oauth_json()))
    .execute(&mut *tx)
    .await
    .map_err(|e| (e.into(), op))?;
    sqlx::query("update catalog.resource set version=version+1,projection_action_execution_id=$2 where id=$1")
        .bind(locked.resource_id)
        .bind(ae.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (e.into(), op))?;
    if let Some(attempt) = &attempt {
        super::oauth::consume_attempt(&mut tx, attempt.id, ae.id)
            .await
            .map_err(|e| (e, op))?;
    }
    record_health(&mut tx, locked.resource_id, "OK", None, &probe)
        .await
        .map_err(|e| (e, op))?;
    write_ahead(&mut tx, &ae, intent.definition)
        .await
        .map_err(|e| (e, op))?;
    tx.commit().await.map_err(|e| (e.into(), op))?;
    complete(service, ctx.tenant_id, ae.id, transient(cmd))
        .await
        .map_err(|e| (e, op))
}

// ---------------------------------------------------------------------------
// mcp_connection.disable / enable (local, same transaction)
// ---------------------------------------------------------------------------

async fn toggle(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &ActionCommand,
    intent: &Intent<'_>,
) -> Submitted {
    let enable = cmd.action_key == ENABLE;
    let from = if enable { "DISABLED" } else { "ACTIVE" };
    let (connection, target, token) = target_connector(state, ctx, cmd, intent, &[from]).await?;
    if enable {
        // DD-149(5): the egress policy is decided fresh when the connector returns.
        let platform = super::platform_egress().map_err(|e| (e, None))?;
        let mut conn = state.pool.acquire().await.map_err(|e| (e.into(), None))?;
        let policy = super::tenant_policy(&mut conn, ctx.tenant_id)
            .await
            .map_err(|e| (e, None))?;
        drop(conn);
        let scope = EgressScope {
            platform: &platform,
            tenant_suffixes: &policy.egress_host_suffixes,
        };
        let url = connection.url().map_err(|e| (e, None))?;
        crate::mcp_egress::resolve(&scope, &url)
            .await
            .map_err(|_| (denied(), None))?;
    }
    let mut tx = state.pool.begin().await.map_err(|e| (e.into(), None))?;
    let locked = super::load(&mut tx, ctx.tenant_id, connection.resource_id, true)
        .await
        .map_err(|e| (e, None))?
        .filter(|c| {
            c.version == connection.version
                && c.state == from
                && c.projection_action_execution_id.is_none()
        })
        .ok_or((conflict(), None))?;
    let parameters = json!({"commandDigest":intent.frozen,"targetVersion":target.version});
    let ae = open_allowed(
        &mut tx,
        ctx,
        intent,
        &target,
        parameters,
        &allowed(Some(token)),
    )
    .await
    .map_err(|e| (e, None))?;
    let op = Some(ae.operation_id);
    sqlx::query("update catalog.mcp_connection set state=$2,version=version+1,updated_at=now() where resource_id=$1")
        .bind(locked.resource_id)
        .bind(if enable { "ACTIVE" } else { "DISABLED" })
        .execute(&mut *tx)
        .await
        .map_err(|e| (e.into(), op))?;
    sqlx::query("update catalog.resource set version=version+1 where id=$1")
        .bind(locked.resource_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (e.into(), op))?;
    finish_local(
        &mut tx,
        &ae,
        intent.definition,
        if enable { "ENABLED" } else { "DISABLED" },
        Vec::new(),
    )
    .await
    .map_err(|e| (e, op))?;
    let ae = crate::governance::lock_execution(&mut tx, ae.id)
        .await
        .map_err(|e| (e.into(), op))?;
    tx.commit().await.map_err(|e| (e.into(), op))?;
    Ok((StatusCode::OK, ae.submission()))
}

// ---------------------------------------------------------------------------
// mcp_connection.delete
// ---------------------------------------------------------------------------

async fn delete(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &ActionCommand,
    intent: &Intent<'_>,
) -> Submitted {
    let (connection, target, token) =
        target_connector(state, ctx, cmd, intent, &["ACTIVE", "DISABLED"]).await?;
    let mut tx = state.pool.begin().await.map_err(|e| (e.into(), None))?;
    let locked = super::load(&mut tx, ctx.tenant_id, connection.resource_id, true)
        .await
        .map_err(|e| (e, None))?
        .filter(|c| {
            c.version == connection.version
                && c.state != "DELETED"
                && c.projection_action_execution_id.is_none()
        })
        .ok_or((conflict(), None))?;
    let tools = active_tools(&mut tx, locked.resource_id)
        .await
        .map_err(|e| (e, None))?;
    let ids: Vec<Uuid> = tools.iter().map(|t| t.resource_id).collect();
    let parameters = json!({"commandDigest":intent.frozen,"targetVersion":target.version,
        "retiredTools":ids,"credentialRef":locked.credential_ref,
        "oauthClientSecretRef":locked.oauth.as_ref().and_then(|o| o.pointer("/client/secretRef")).cloned()});
    let ae = open_allowed(
        &mut tx,
        ctx,
        intent,
        &target,
        parameters,
        &allowed(Some(token)),
    )
    .await
    .map_err(|e| (e, None))?;
    let op = Some(ae.operation_id);
    retire_tools(&mut tx, &ids).await.map_err(|e| (e, op))?;
    sqlx::query("update catalog.mcp_connection set state='DELETED',version=version+1,updated_at=now() where resource_id=$1")
        .bind(locked.resource_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (e.into(), op))?;
    sqlx::query("update catalog.resource set state='DELETED',version=version+1,projection_action_execution_id=$2 where id=$1")
        .bind(locked.resource_id)
        .bind(ae.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (e.into(), op))?;
    write_ahead(&mut tx, &ae, intent.definition)
        .await
        .map_err(|e| (e, op))?;
    tx.commit().await.map_err(|e| (e.into(), op))?;
    complete(&state.memory_service, ctx.tenant_id, ae.id, None)
        .await
        .map_err(|e| (e, op))
}

// ---------------------------------------------------------------------------
// mcp_connection.policy.update
// ---------------------------------------------------------------------------

async fn policy(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &ActionCommand,
    intent: &Intent<'_>,
) -> Submitted {
    let input = cmd
        .mcp_connection_policy_update
        .as_ref()
        .ok_or((invalid(), None))?;
    let platform = super::platform_egress().map_err(|e| (e, None))?;
    let mut suffixes = Vec::new();
    for raw in &input.egress_host_suffixes {
        let suffix = crate::mcp_egress::normalize_suffix(raw).ok_or((invalid(), None))?;
        if !platform.permits_suffix(&suffix) {
            return Err((invalid(), None));
        }
        if !suffixes.contains(&suffix) {
            suffixes.push(suffix);
        }
    }
    if suffixes.len() > 64 {
        return Err((invalid(), None));
    }
    let target = Target {
        id: ctx.tenant_id,
        version: 0,
        workspace_id: None,
    };
    let registration = super::wire(&input.member_registration);
    let parameters = json!({"commandDigest":intent.frozen,"memberRegistration":registration,"egressHostSuffixes":suffixes});
    let mut conn = state.pool.acquire().await.map_err(|e| (e.into(), None))?;
    let member = active_member(&mut conn, ctx.tenant_id, ctx.tenant_principal_id)
        .await
        .map_err(|e| (e, None))?;
    drop(conn);
    let token = if member {
        check(
            &state.memory_service,
            "tenant",
            ctx.tenant_id,
            "manage",
            ctx.tenant_principal_id,
        )
        .await
        .map_err(|e| (e, None))?
    } else {
        None
    };
    let Some(token) = token else {
        let evaluation = refused(
            member,
            if member {
                ReasonCode::PermissionDenied
            } else {
                ReasonCode::ScopeGuardFailed
            },
        );
        let op = record_denied(state, ctx, intent, &target, parameters, &evaluation).await;
        return Err((if member { denied() } else { scope_failed() }, op));
    };
    let mut tx = state.pool.begin().await.map_err(|e| (e.into(), None))?;
    if !crate::roles::lock_tenant(&mut tx, ctx.tenant_id)
        .await
        .map_err(|e| (e.into(), None))?
    {
        return Err((scope_failed(), None));
    }
    let ae = open_allowed(
        &mut tx,
        ctx,
        intent,
        &target,
        parameters,
        &allowed(Some(token)),
    )
    .await
    .map_err(|e| (e, None))?;
    let op = Some(ae.operation_id);
    sqlx::query(
        "insert into catalog.mcp_connection_policy(tenant_id,member_registration,egress_host_suffixes,version,action_execution_id)
         values($1,$2,$3,1,$4)
         on conflict(tenant_id) do update set member_registration=excluded.member_registration,
           egress_host_suffixes=excluded.egress_host_suffixes,version=catalog.mcp_connection_policy.version+1,
           action_execution_id=excluded.action_execution_id,updated_at=now()",
    )
    .bind(ctx.tenant_id)
    .bind(&registration)
    .bind(&suffixes)
    .bind(ae.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| (e.into(), op))?;
    finish_local(
        &mut tx,
        &ae,
        intent.definition,
        "POLICY_UPDATED",
        Vec::new(),
    )
    .await
    .map_err(|e| (e, op))?;
    let ae = crate::governance::lock_execution(&mut tx, ae.id)
        .await
        .map_err(|e| (e.into(), op))?;
    tx.commit().await.map_err(|e| (e.into(), op))?;
    Ok((StatusCode::OK, ae.submission()))
}

// ---------------------------------------------------------------------------
// Completion of the external effects (first request, replay, reconciler)
// ---------------------------------------------------------------------------

/// Drive the frozen effects of an admitted create/update/rotate/delete to DISPATCHED.
/// Every step is idempotent: OpenBao CAS=0 writes compare, SpiceDB writes TOUCH/DELETE
/// and read back, Core rows move only forward. A missing transient credential keeps the
/// operation UNKNOWN (only the original caller holds it).
pub(crate) async fn complete(
    state: &crate::service_api::ServiceState,
    tenant: Uuid,
    action: Uuid,
    transient: Option<&str>,
) -> Result<(StatusCode, ActionSubmission), Refusal> {
    let ae = crate::governance::load_execution(&state.pool, action)
        .await?
        .ok_or_else(|| unavailable("operation"))?;
    if ae.tenant_id != tenant || !super::is_action(&ae.action_key) {
        return Err(scope_failed());
    }
    if ae.gate_state == "ALLOWED" && ae.dispatch_state == "DISPATCHED" {
        return Ok((StatusCode::OK, ae.submission()));
    }
    if ae.gate_state != "ALLOWED"
        || !matches!(ae.dispatch_state.as_str(), "UNKNOWN" | "NOT_DISPATCHED")
    {
        return Err(unavailable("operation not dispatchable"));
    }
    let def =
        crate::governance::exact_definition(&state.pool, &ae.action_key, ae.action_version).await?;
    let parameters = ae.parameters.clone().unwrap_or(Value::Null);
    let mut conn = state.pool.acquire().await?;
    let connection = super::load(&mut conn, tenant, ae.target_id, false)
        .await?
        .ok_or_else(|| unavailable("connector"))?;
    drop(conn);
    let gov = &state.governance;
    let mut evidence = Vec::new();
    match ae.action_key.as_str() {
        CREATE | UPDATE => {
            if ae.action_key == CREATE
                && matches!(connection.auth_mode.as_str(), "API_KEY" | "BEARER")
            {
                let reference = connection
                    .credential()?
                    .ok_or_else(|| unavailable("credential ref"))?;
                match transient {
                    Some(value) => credential::write(state, tenant, &reference, value).await?,
                    None => {
                        // Only an already written value lets a reconciler finish.
                        credential::read(state, &reference, ae.updated_at).await?;
                    }
                }
            }
            let shared_connection = connection.visibility == "TENANT";
            let token = projection::project(
                gov,
                connection.resource_id,
                tenant,
                connection.owner_principal_id,
                connection.workspace_id,
                shared_connection,
                false,
            )
            .await?;
            evidence.push(Evidence::new(EvidenceKind::SpicedbZedtoken, &token));
            let mut conn = state.pool.acquire().await?;
            let tools = active_tools(&mut conn, connection.resource_id).await?;
            drop(conn);
            for tool in &tools {
                projection::project(
                    gov,
                    tool.resource_id,
                    tenant,
                    connection.owner_principal_id,
                    connection.workspace_id,
                    shared_connection,
                    true,
                )
                .await?;
            }
            if let Some(retired) = parameters["retiredTools"].as_array() {
                for id in retired
                    .iter()
                    .filter_map(|v| v.as_str())
                    .filter_map(|v| Uuid::parse_str(v).ok())
                {
                    projection::withdraw(gov, id).await?;
                }
            }
        }
        ROTATE => {
            let reference = connection
                .credential()?
                .ok_or_else(|| unavailable("credential ref"))?;
            if connection.auth_mode != "OAUTH" {
                match transient {
                    Some(value) => credential::write(state, tenant, &reference, value).await?,
                    None => {
                        credential::read(state, &reference, ae.updated_at).await?;
                    }
                }
            }
            if let Some(previous) = parameters
                .get("previousCredentialRef")
                .filter(|v| !v.is_null())
            {
                let previous = credential::reference_of(previous)?;
                if previous.locator != reference.locator {
                    credential::retire(state, tenant, &previous, true).await?;
                }
            }
        }
        DELETE => {
            if let Some(retired) = parameters["retiredTools"].as_array() {
                for id in retired
                    .iter()
                    .filter_map(|v| v.as_str())
                    .filter_map(|v| Uuid::parse_str(v).ok())
                {
                    projection::withdraw(gov, id).await?;
                }
            }
            projection::withdraw(gov, connection.resource_id).await?;
            for key in ["credentialRef", "oauthClientSecretRef"] {
                if let Some(reference) = parameters.get(key).filter(|v| !v.is_null()) {
                    credential::retire(state, tenant, &credential::reference_of(reference)?, true)
                        .await?;
                }
            }
        }
        _ => return Err(invalid()),
    }
    let mut tx = state.pool.begin().await?;
    let current = crate::governance::lock_execution(&mut tx, ae.id).await?;
    if current.dispatch_state == "DISPATCHED" {
        tx.commit().await?;
        return Ok((StatusCode::OK, current.submission()));
    }
    let resource_state = if ae.action_key == DELETE {
        "DELETED"
    } else {
        "ACTIVE"
    };
    sqlx::query(
        "update catalog.resource set state=$3,projection_action_execution_id=null
         where projection_action_execution_id=$1 and tenant_id=$2 and state in ('PROVISIONING','ACTIVE','DELETED')",
    )
    .bind(ae.id)
    .bind(tenant)
    .bind(resource_state)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "update catalog.resource set state='ACTIVE',projection_action_execution_id=null
         where projection_action_execution_id=$1 and tenant_id=$2 and type_key='tool.definition' and state='PROVISIONING'",
    )
    .bind(ae.id)
    .bind(tenant)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "update catalog.tool_definition t set status='ACTIVE' from catalog.resource r
         where r.id=t.resource_id and t.mcp_connection_id=$1 and t.status='PROVISIONING' and r.state='ACTIVE'",
    )
    .bind(connection.resource_id)
    .execute(&mut *tx)
    .await?;
    let outcome = match ae.action_key.as_str() {
        CREATE => "CREATED",
        UPDATE => "GENERATION_CONFIRMED",
        ROTATE => "CREDENTIAL_ROTATED",
        _ => "DELETED",
    };
    finish_local(&mut tx, &current, &def, outcome, evidence).await?;
    let done = crate::governance::lock_execution(&mut tx, ae.id).await?;
    tx.commit().await?;
    if done.dispatch_state != "DISPATCHED" {
        return Err(not_active());
    }
    Ok((StatusCode::OK, done.submission()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command(key: &str) -> ActionCommand {
        serde_json::from_value(
            json!({"actionKey":key,"idempotencyKey":Uuid::new_v4(),"explicitConfirmation":true,
            "resourceId":Uuid::new_v4(),"resourceVersion":1}),
        )
        .unwrap()
    }

    #[test]
    fn fields_are_closed_per_action() {
        assert!(validate_fields(&command(DISABLE)).is_ok());
        let mut extra = command(DISABLE);
        extra.workspace_id = Some(Uuid::new_v4().to_string());
        assert!(validate_fields(&extra).is_err());
        let mut credential = command(DISABLE);
        credential.mcp_connection_credential =
            Some(contracts::McpConnectionCredentialInput { value: "k".into() });
        assert!(validate_fields(&credential).is_err());
        let mut unconfirmed = command(DELETE);
        unconfirmed.explicit_confirmation = None;
        assert!(validate_fields(&unconfirmed).is_err());
        assert!(validate_fields(&command(UPDATE)).is_err());
    }

    #[test]
    fn digest_excludes_the_transient_credential_and_key() {
        let mut a = command(ROTATE);
        a.mcp_connection_credential = Some(contracts::McpConnectionCredentialInput {
            value: "one".into(),
        });
        let mut b = a.clone();
        b.mcp_connection_credential = Some(contracts::McpConnectionCredentialInput {
            value: "two".into(),
        });
        b.idempotency_key = Uuid::new_v4().to_string();
        assert_eq!(command_digest(&a).unwrap(), command_digest(&b).unwrap());
        let mut c = a.clone();
        c.mcp_connection_credential = None;
        assert_ne!(command_digest(&a).unwrap(), command_digest(&c).unwrap());
    }
}
