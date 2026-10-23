//! DD-140 / SF-BUZ-61(2): the original project channel request as a managed
//! Agent proposal. The PLATFORM_NATIVE tool `project_channel_request` is bound
//! to the existing `workspace.create`; a call opens one child ActionExecution of
//! the Agent's turn whose initiator is the Installation owner (actor the AGENT)
//! and which always waits for that owner's approval. Nothing about the
//! Workspace is written before APPROVED; the existing after-approval
//! re-admission, prewrite and dispatch then create it with the owner as
//! creator. Denial, expiry and an unknown outcome never replay the proposal.

use contracts::ReasonCode;
use serde_json::{json, Value};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::governance::{self, Definition, Execution, Policy, Refusal};
use crate::service_api::ServiceState;

pub(crate) const TOOL: &str = "project_channel_request";
pub(crate) const ACTION: &str = "workspace.create";
/// Frozen child parameter: the proposal, its Installation owner and policy.
const KEY: &str = "projectChannelRequest";

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

fn unknown() -> Refusal {
    Refusal::Unavailable("project channel request evidence unavailable".into())
}

/// The admitted `workspace.create` definition this tool proposes. Any drift of
/// its shape (approval, execution, scope) blocks the tool rather than adapting.
pub(crate) async fn definition(pool: &PgPool) -> Result<Definition, Refusal> {
    let def = governance::active_definition(pool, ACTION)
        .await?
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    if def.target_type != "WORKSPACE"
        || def.tenant_rule != "SESSION_TENANT"
        || def.workspace_rule != "TENANT_ONLY"
        || def.confirmation_mode != "NONE"
        || def.approval_policy_id.is_some()
        || def.execution_mode != "TEMPORAL"
        || def.workflow_kind.as_deref() != Some("WORKSPACE_LIFECYCLE")
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    Ok(def)
}

/// Original `parseProjectChannelRequest`: exactly the contract fields and bounds.
pub(crate) fn parse(arguments: &Value) -> Result<contracts::ProjectChannelRequest, Refusal> {
    let request: contracts::ProjectChannelRequest =
        serde_json::from_value(arguments.clone()).map_err(|_| invalid())?;
    let text = |value: &str, max: usize| {
        let count = value.chars().count();
        count >= 1 && count <= max
    };
    let home = Uuid::parse_str(&request.home_channel_id).map_err(|_| invalid())?;
    if serde_json::to_value(&request).map_err(|_| invalid())? != *arguments
        || home.is_nil()
        || home.to_string() != request.home_channel_id
        || !text(&request.name, 120)
        || request
            .description
            .as_deref()
            .is_some_and(|d| !text(d, 2048))
        || request
            .template_name
            .as_deref()
            .is_some_and(|t| !text(t, 300))
        || request.ttl_seconds.is_some_and(|ttl| ttl < 1)
    {
        return Err(invalid());
    }
    Ok(request)
}

pub(crate) fn is_child(ae: &Execution) -> bool {
    ae.action_key == ACTION && frozen(ae).is_some()
}

fn frozen(ae: &Execution) -> Option<&Value> {
    ae.parameters.as_ref()?.get(KEY)
}

/// The exact policy frozen at proposal time; never the definition's (none).
pub(crate) async fn child_policy(pool: &PgPool, ae: &Execution) -> Result<Option<Policy>, Refusal> {
    let Some(frozen) = frozen(ae).filter(|_| ae.action_key == ACTION) else {
        return Ok(None);
    };
    let id = frozen["policyId"]
        .as_str()
        .and_then(|v| Uuid::parse_str(v).ok())
        .ok_or_else(unknown)?;
    let version = frozen["policyVersion"]
        .as_i64()
        .and_then(|v| i32::try_from(v).ok())
        .ok_or_else(unknown)?;
    let policy = governance::exact_policy(pool, id, version).await?;
    if policy.owner_requirement != "TARGET_OWNER" || !policy.role_requirements.is_empty() {
        return Err(unknown());
    }
    Ok(Some(policy))
}

/// The one affected owner: the Installation owner frozen with its version.
pub(crate) fn owners(ae: &Execution) -> Result<Vec<contracts::AffectedOwnerRef>, Refusal> {
    let frozen = frozen(ae).ok_or_else(unknown)?;
    Ok(vec![contracts::AffectedOwnerRef {
        target_type: "RESOURCE".into(),
        target_id: frozen["installationResourceId"]
            .as_str()
            .ok_or_else(unknown)?
            .to_owned(),
        target_version: frozen["installationVersion"].as_i64().ok_or_else(unknown)?,
        owner_principal_id: frozen["ownerPrincipalId"]
            .as_str()
            .ok_or_else(unknown)?
            .to_owned(),
    }])
}

/// The proposal is still current: the Installation is ACTIVE at its frozen
/// version and owner, and its channel binding still serves the home channel.
pub(crate) async fn current(conn: &mut PgConnection, ae: &Execution) -> Result<bool, Refusal> {
    let frozen = frozen(ae).ok_or_else(unknown)?;
    let installation = frozen["installationResourceId"]
        .as_str()
        .and_then(|v| Uuid::parse_str(v).ok())
        .ok_or_else(unknown)?;
    let home = frozen["request"]["homeChannelId"]
        .as_str()
        .and_then(|v| Uuid::parse_str(v).ok())
        .ok_or_else(unknown)?;
    let version = frozen["installationVersion"]
        .as_i64()
        .and_then(|v| i32::try_from(v).ok())
        .ok_or_else(unknown)?;
    let owner = frozen["ownerPrincipalId"]
        .as_str()
        .and_then(|v| Uuid::parse_str(v).ok())
        .ok_or_else(unknown)?;
    Ok(owner == ae.initiator_principal_id
        && sqlx::query_scalar(
            "select exists(select 1 from catalog.resource r
            join catalog.agent_installation i on i.resource_id=r.id and i.state='ACTIVE'
            join catalog.channel_agent_binding cb on cb.installation_resource_id=r.id
              and cb.workspace_id=$3 and cb.status='ACTIVE'
            where r.id=$1 and r.tenant_id=$2 and r.type_key='agent.installation' and r.state='ACTIVE'
              and r.version=$4 and r.owner_principal_id=$5 and i.workspace_id=$3)",
        )
        .bind(installation)
        .bind(ae.tenant_id)
        .bind(home)
        .bind(version)
        .bind(owner)
        .fetch_one(&mut *conn)
        .await?)
}

/// `ApprovalView.projectChannelRequest` from the frozen proposal only.
pub(crate) fn view(
    parameters: Option<&Value>,
) -> Option<contracts::ProjectChannelRequestApprovalView> {
    let frozen = parameters?.get(KEY)?;
    Some(contracts::ProjectChannelRequestApprovalView {
        installation_resource_id: frozen["installationResourceId"].as_str()?.to_owned(),
        request: serde_json::from_value(frozen["request"].clone()).ok()?,
    })
}

/// Owner eligibility for the pending list: only the frozen, still-current owner.
pub(crate) async fn approver_eligible(
    pool: &PgPool,
    ae: &Execution,
    tenant: Uuid,
    human: Uuid,
) -> Result<bool, Refusal> {
    if ae.tenant_id != tenant || !is_child(ae) {
        return Ok(false);
    }
    let owner_is_human = owners(ae)?
        .iter()
        .any(|owner| owner.owner_principal_id == human.to_string());
    if !owner_is_human {
        return Ok(false);
    }
    let mut conn = pool.acquire().await?;
    current(&mut conn, ae).await
}

/// The PEP's tools/call: validate, admit within the turn's Delegation, open the
/// owner-approved child and start its approval. Returns the child.
pub(crate) async fn prepare(
    state: &ServiceState,
    invocation: Uuid,
    arguments: &Value,
) -> Result<Execution, Refusal> {
    let request = parse(arguments)?;
    let argument_hash = collab_bridge::limits::canonical_digest(arguments);
    let def = definition(&state.pool).await?;
    let mut tx = state.pool.begin().await?;
    let (context, parent) =
        crate::agent_tool::invocation_context(state, &mut tx, invocation, true).await?;
    let tool = crate::agent_tool::bound_tools(
        &state.governance,
        &mut tx,
        context.tenant_id,
        context.installation_resource_id,
        context.projection_generation,
        context.agent_principal_id,
    )
    .await?
    .into_iter()
    .find(|tool| tool.name == TOOL)
    .ok_or(Refusal::Denied(ReasonCode::PermissionDenied))?;
    crate::agent_tool::tool_admission(state, &mut tx, &context, &parent, &tool, &def).await?;
    // DD-140 (2): the home channel is this Installation's own bound Workspace.
    if request.home_channel_id != context.workspace_id.to_string() {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let owner = crate::agent_tool::installation_owner(
        &mut tx,
        context.tenant_id,
        context.installation_resource_id,
    )
    .await?;
    let installation_version: i32 = sqlx::query_scalar(
        "select r.version from catalog.resource r
        join catalog.channel_agent_binding cb on cb.installation_resource_id=r.id
          and cb.workspace_id=$3 and cb.status='ACTIVE'
        where r.id=$1 and r.tenant_id=$2 and r.state='ACTIVE' and r.type_key='agent.installation'",
    )
    .bind(context.installation_resource_id)
    .bind(context.tenant_id)
    .bind(context.workspace_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(Refusal::Denied(ReasonCode::ScopeGuardFailed))?;
    let policy: (Uuid, i32) = sqlx::query_as(
        "select id,version from catalog.approval_policy
        where action_key=$1 and target_type='RESOURCE' and owner_requirement='TARGET_OWNER'
          and role_requirements='[]'::jsonb and tenant_id is null and status='ACTIVE'",
    )
    .bind(ACTION)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    // One proposal per turn and normalized input: a retried call answers the
    // same child instead of opening a second one.
    let key = Uuid::new_v5(
        &parent.id,
        format!(
            "{TOOL}:{}:{argument_hash}",
            context.runtime_turn_id.as_deref().unwrap_or_default()
        )
        .as_bytes(),
    );
    let existing: Option<Uuid> = sqlx::query_scalar(
        "select id from admission.action_execution
        where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3",
    )
    .bind(context.tenant_id)
    .bind(owner)
    .bind(key)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(existing) = existing {
        drop(tx);
        return governance::load_execution(&state.pool, existing)
            .await?
            .ok_or_else(unknown);
    }
    let slug = format!("project-{}", &key.simple().to_string()[..12]);
    let mut channel = json!({"channelType":"stream"});
    if let Some(description) = &request.description {
        channel["description"] = json!(description);
    }
    if let Some(ttl) = request.ttl_seconds {
        channel["ttlSeconds"] = json!(ttl);
    }
    let command: contracts::ActionCommand = serde_json::from_value(json!({
        "actionKey": ACTION, "idempotencyKey": key.to_string(), "name": request.name,
        "slug": slug, "workspaceVisibility": request.visibility, "workspaceChannel": channel,
    }))
    .map_err(|_| invalid())?;
    let frozen = json!({
        "policyId": policy.0, "policyVersion": policy.1,
        "installationResourceId": context.installation_resource_id,
        "installationVersion": installation_version, "ownerPrincipalId": owner,
        "invocationId": context.id, "toolResourceId": tool.resource_id,
        "toolParameterHash": argument_hash, "request": request,
    });
    let ae = governance::open_project_channel_child(
        &mut tx, &parent, owner, &def, &command, KEY, frozen, key,
    )
    .await?;
    tx.commit().await?;
    match state.governance.decide_opened(ae.id).await {
        Ok(_) => {}
        // Definite refusals closed the child's gate; dependency failures leave
        // it EVALUATING for the reconciler, never replayed as a new proposal.
        Err((Refusal::Unavailable(error), _)) => return Err(Refusal::Unavailable(error)),
        Err((refusal, _)) => return Err(refusal),
    }
    governance::load_execution(&state.pool, ae.id)
        .await?
        .ok_or_else(unknown)
}

/// The tool result: the child's own submission, read from the database.
pub(crate) async fn result(
    state: &ServiceState,
    action: Uuid,
    operation: Uuid,
) -> Result<Value, Refusal> {
    let ae = governance::load_execution(&state.pool, action)
        .await?
        .ok_or_else(unknown)?;
    if ae.operation_id != operation || !is_child(&ae) {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    serde_json::to_value(ae.submission()).map_err(|_| unknown())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> Value {
        json!({"homeChannelId":"6f1d2c3b-4a59-4e7f-8a9b-0c1d2e3f4a5b","name":"design-review","visibility":"open"})
    }

    #[test]
    fn accepts_the_original_shape_and_rejects_extra_fields_and_bounds() {
        assert!(parse(&request()).is_ok());
        let mut full = request();
        full["description"] = json!("why");
        full["ttlSeconds"] = json!(3600);
        full["templateName"] = json!("Project home");
        assert!(parse(&full).is_ok());
        for (key, value) in [
            ("extra", json!(true)),
            ("name", json!("")),
            ("name", json!("x".repeat(121))),
            ("description", json!("x".repeat(2049))),
            ("templateName", json!("x".repeat(301))),
            ("ttlSeconds", json!(0)),
            ("visibility", json!("public")),
            ("homeChannelId", json!("not-a-uuid")),
            (
                "homeChannelId",
                json!("6F1D2C3B-4A59-4E7F-8A9B-0C1D2E3F4A5B"),
            ),
        ] {
            let mut bad = request();
            bad[key] = value;
            assert!(parse(&bad).is_err(), "{key} accepted");
        }
        let mut missing = request();
        missing.as_object_mut().unwrap().remove("name");
        assert!(parse(&missing).is_err());
    }

    #[test]
    fn the_view_carries_only_the_frozen_installation_and_request() {
        let parameters = json!({"projectChannelRequest": {"installationResourceId":"6f1d2c3b-4a59-4e7f-8a9b-0c1d2e3f4a5b",
            "policyId":"x","ownerPrincipalId":"y","request":request()}});
        let view = view(Some(&parameters)).unwrap();
        assert_eq!(view.request.name, "design-review");
        let wire = serde_json::to_value(&view).unwrap();
        assert!(wire.get("policyId").is_none() && wire.get("ownerPrincipalId").is_none());
        assert!(super::view(Some(&json!({"params":{}}))).is_none());
    }

    #[test]
    fn the_native_map_is_closed() {
        assert_eq!(crate::agent_tool::native_action_key(TOOL), Some(ACTION));
        assert_eq!(crate::agent_tool::native_action_key(ACTION), None);
        assert!(crate::agent_tool::NATIVE_TOOLS.contains(&TOOL));
    }
}
