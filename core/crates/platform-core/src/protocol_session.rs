//! DD-90/103: fresh PEP for the original short-lived PROTOCOL Action record.
//! Native file bytes and revision existence stay with the FILE_STORAGE service.
use axum::{
    extract::State,
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Utc};
use contracts::ReasonCode;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    governance::{Execution, Governance, Refusal},
    service_api::ServiceState,
    spicedb::Consistency,
};

#[path = "protocol_session_command.rs"]
pub(crate) mod command;
#[path = "protocol_session_launch.rs"]
pub(crate) mod launch;
#[path = "protocol_session_lifecycle.rs"]
pub(crate) mod lifecycle;
#[path = "protocol_session_maintenance.rs"]
pub(crate) mod maintenance;
#[path = "protocol_session_read.rs"]
pub(crate) mod read;
#[path = "protocol_session_reconcile.rs"]
pub(crate) mod reconcile;
#[path = "protocol_session_write.rs"]
pub(crate) mod write;

pub(crate) const KIND: &str = "file_storage.edit_session";

// These are the original AE's immutable APPLICATION columns, not another
// Execution DTO or a re-resolution through the binding's latest generation.
#[derive(sqlx::FromRow)]
struct ExecutionRefs {
    definition_id: Uuid,
    binding_id: Uuid,
    release_id: Uuid,
    generation: i64,
}
async fn execution_refs(pool: &sqlx::PgPool, id: Uuid) -> Result<ExecutionRefs, Refusal> {
    sqlx::query_as(
        "select action_definition_id definition_id,component_binding_id binding_id,
        component_release_id release_id,component_projection_generation generation
        from admission.action_execution where id=$1 and component_binding_kind='APPLICATION'
          and action_definition_id is not null and component_binding_id is not null
          and component_release_id is not null and component_projection_generation>0",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(denied)
}

fn denied() -> Refusal {
    Refusal::Denied(ReasonCode::PermissionDenied)
}
fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}
fn unknown() -> Refusal {
    Refusal::Unavailable("protocol authorization evidence unavailable".into())
}
fn uuid(value: &Value, field: &str) -> Result<Uuid, Refusal> {
    let text = value[field].as_str().ok_or_else(invalid)?;
    let id = Uuid::parse_str(text).map_err(|_| invalid())?;
    if id.is_nil() || id.to_string() != text {
        return Err(invalid());
    }
    Ok(id)
}

#[derive(sqlx::FromRow)]
pub(crate) struct Session {
    pub(crate) id: Uuid,
    pub(crate) action_execution_id: Uuid,
    pub(crate) application_binding_id: Uuid,
    pub(crate) target: Value,
    pub(crate) admitted_mode: String,
    pub(crate) base_revision: String,
    pub(crate) expires_at: DateTime<Utc>,
    pub(crate) native_session_ref: Option<String>,
    pub(crate) state: String,
    pub(crate) version: i32,
    pub(crate) launch_theme: String,
    pub(crate) launch_locale: String,
    pub(crate) native_write_observation: Option<Value>,
}

#[derive(sqlx::FromRow)]
struct TargetFacts {
    resource_id: Uuid,
    resource_owner: Uuid,
    resource_workspace: Option<Uuid>,
    asset_id: Option<Uuid>,
    asset_owner: Option<Uuid>,
    native_ref: String,
    target_version: i32,
    display_name: String,
    oidc_issuer: String,
    oidc_subject: String,
    adapter_service_ref: String,
    native_instance_ref: String,
    manifest: Value,
}

fn allowed_operation(session: &Session, operation: &str) -> bool {
    session.expires_at > Utc::now()
        && session.target["nativeRevision"] == session.base_revision
        && match operation {
            "OPEN" => session.state == "OPENING",
            "READ" => matches!(
                session.state.as_str(),
                "OPEN" | "DIRTY" | "SAVED" | "READ_ONLY"
            ),
            "WRITE" => {
                session.admitted_mode == "EDIT"
                    && matches!(session.state.as_str(), "OPEN" | "DIRTY" | "SAVED")
            }
            _ => false,
        }
}

async fn permission(
    g: &Governance,
    object: &str,
    target: Uuid,
    human: Uuid,
    permission: &str,
) -> Result<(bool, String), Refusal> {
    let checked = g
        .spicedb
        .check(
            object,
            &target.to_string(),
            permission,
            &human.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| unknown())?;
    if checked.zed_token.is_empty() {
        return Err(unknown());
    }
    Ok((checked.allowed, checked.zed_token))
}

/// Also used by admission/launch. A stored ALLOWED is not a permission cache.
pub(crate) async fn fresh_for_governance(
    g: &Governance,
    ae: &Execution,
) -> Result<(crate::governance::Evaluation, Value), Refusal> {
    fresh_for_mode(g, ae, true).await
}

// Losing update is not losing read. The original action declaration and
// target still match exactly; a VIEW re-check never changes that definition.
async fn fresh_for_mode(
    g: &Governance,
    ae: &Execution,
    require_update: bool,
) -> Result<(crate::governance::Evaluation, Value), Refusal> {
    let def = crate::governance::exact_definition_for_execution(&g.pool, ae).await?;
    if !matches!(ae.gate_state.as_str(), "EVALUATING" | "WAITING" | "ALLOWED")
        || ae.actor_principal_id != ae.initiator_principal_id
        || def.execution_mode != "PROTOCOL"
        || !matches!(
            def.action_key.as_str(),
            "file_storage.open_view@v1" | "file_storage.open_edit@v1"
        )
        || !matches!(def.target_type.as_str(), "RESOURCE" | "ASSET")
        || def.permission
            != if def.action_key == "file_storage.open_edit@v1" {
                "update"
            } else {
                "read"
            }
    {
        return Err(denied());
    }
    let facts:TargetFacts=sqlx::query_as("select r.id resource_id,r.owner_principal_id resource_owner,
        r.home_workspace_id resource_workspace,asset.id asset_id,asset.owner_principal_id asset_owner,
        case when d.target_type='ASSET' then asset.native_ref else r.native_id end native_ref,
        case when d.target_type='ASSET' then asset.version else r.version end target_version,
        h.display_name,ei.issuer oidc_issuer,ei.subject oidc_subject,
        b.adapter_service_ref,b.native_instance_ref,release.manifest
        from admission.action_execution a
        join catalog.action_definition d on d.id=a.action_definition_id and d.action_key=a.action_key
          and d.version=a.action_version and d.status='ACTIVE' and d.component_release_id=a.component_release_id
          and d.capacity_policy='NATIVE'
        left join catalog.asset asset on d.target_type='ASSET' and asset.id=a.target_id and asset.tenant_id=a.tenant_id
          and asset.state='ACTIVE' and asset.projection_action_execution_id is null
        join catalog.resource r on r.id=case when d.target_type='RESOURCE' then a.target_id else asset.resource_id end
          and r.tenant_id=a.tenant_id and r.state='ACTIVE' and r.projection_action_execution_id is null
          and (r.home_workspace_id is null or r.home_workspace_id=a.workspace_id)
        join catalog.resource_type_definition ty on ty.id=r.resource_type_definition_id
          and ty.type_key=r.type_key and ty.component_release_id=a.component_release_id
          and ty.capability_category='file_storage' and ty.status='ACTIVE'
        join catalog.application_binding b on b.id=a.component_binding_id and b.id=r.application_binding_id
          and b.tenant_id=a.tenant_id and (b.workspace_id is null or b.workspace_id=a.workspace_id)
          and b.state='ACTIVE' and b.active_projection_generation=a.component_projection_generation
          and b.component_release_id=a.component_release_id
        join projection.application_runtime p on p.binding_id=b.id and p.generation=a.component_projection_generation
          and p.component_release_id=a.component_release_id and p.state='ACTIVE'
        join catalog.component_release release on release.id=a.component_release_id and release.status='APPROVED'
          and release.manifest_digest=p.normalized_manifest_digest
        join identity.tenant t on t.id=a.tenant_id and t.state='ACTIVE'
        left join identity.workspace w on w.id=a.workspace_id and w.tenant_id=a.tenant_id
        join identity.principal human on human.id=a.actor_principal_id and human.tenant_id=a.tenant_id
          and human.kind='HUMAN' and human.status='ACTIVE'
        join identity.tenant_membership m on m.tenant_principal_id=human.id and m.tenant_id=human.tenant_id and m.state='ACTIVE'
        join identity.human_identity h on h.id=m.human_identity_id and h.status='ACTIVE'
        join identity.external_identity ei on ei.human_identity_id=h.id
          and ei.id::text=a.parameters->>'externalIdentityId' and ei.status='ACTIVE'
        join identity.identity_provider provider on provider.id=ei.provider_id
          and provider.issuer=ei.issuer and provider.status='ACTIVE'
        where a.id=$1 and a.component_binding_kind='APPLICATION' and a.initiator_principal_id=a.actor_principal_id
          and a.gate_state in ('EVALUATING','WAITING','ALLOWED') and (a.workspace_id is null or w.state='ACTIVE')")
        .bind(ae.id).fetch_optional(&g.pool).await?.ok_or_else(denied)?;
    let source = ae.parameters.as_ref().ok_or_else(invalid)?;
    let refs = execution_refs(&g.pool, ae.id).await?;
    if !command::source_binding_matches(
        &source["protocolSessionOpen"],
        refs.binding_id,
        refs.generation,
    ) {
        return Err(denied());
    }
    let reference = &source["protocolSessionOpen"]["reference"];
    if reference["resourceId"] != json!(facts.resource_id)
        || reference.get("assetId") != facts.asset_id.map(|id| json!(id)).as_ref()
        || facts.native_ref.is_empty()
        || facts.display_name.is_empty()
        || ae.frozen_target_version() != Some(facts.target_version)
        || crate::application_binding::native::Connector::from_manifest(&facts.manifest)?
            != crate::application_binding::native::Connector::RemoteAdapter
        || !facts.manifest["capabilityDeclarations"]
            .as_array()
            .ok_or_else(denied)?
            .iter()
            .any(|d| {
                d["categoryKey"] == "file_storage"
                    && d["onlineEditing"] == "SUPPORTED"
                    && d["revisionQuery"] == "SUPPORTED"
            })
    {
        return Err(denied());
    }
    let mut conn = g.pool.acquire().await?;
    if !crate::agent_definition::active_owner(&mut conn, ae.tenant_id, facts.resource_owner).await?
        || !g
            .spicedb
            .resource_projection_matches_in_workspace(
                &facts.resource_id.to_string(),
                &ae.tenant_id.to_string(),
                &facts.resource_owner.to_string(),
                facts.resource_workspace.map(|id| id.to_string()).as_deref(),
                g.cfg.relationship_page,
            )
            .await
            .map_err(|_| unknown())?
    {
        return Err(denied());
    }
    if let Some(asset) = facts.asset_id {
        let owner = facts.asset_owner.ok_or_else(denied)?;
        if !crate::agent_definition::active_owner(&mut conn, ae.tenant_id, owner).await?
            || !g
                .spicedb
                .asset_projection_matches(
                    &asset.to_string(),
                    &ae.tenant_id.to_string(),
                    &facts.resource_id.to_string(),
                    &owner.to_string(),
                    g.cfg.relationship_page,
                )
                .await
                .map_err(|_| unknown())?
        {
            return Err(denied());
        }
    }
    drop(conn);
    if let Some(workspace) = ae.workspace_id {
        let member: Option<String> = sqlx::query_scalar(
            "select m.state from identity.workspace_membership m
            join identity.workspace w on w.id=m.workspace_id and w.tenant_id=$3
            where m.workspace_id=$1 and m.tenant_principal_id=$2",
        )
        .bind(workspace)
        .bind(ae.actor_principal_id)
        .bind(ae.tenant_id)
        .fetch_optional(&g.pool)
        .await?;
        if member.as_deref() != Some("ACTIVE") {
            let manage = if member.is_some() {
                ("tenant", ae.tenant_id)
            } else {
                ("workspace", workspace)
            };
            if !permission(g, manage.0, manage.1, ae.actor_principal_id, "manage")
                .await?
                .0
            {
                return Err(denied());
            }
        }
    }
    let object = if facts.asset_id.is_some() {
        "asset"
    } else {
        "resource"
    };
    let (read, mut proof) =
        permission(g, object, ae.target_id, ae.actor_principal_id, "read").await?;
    if !read {
        return Err(denied());
    }
    if require_update && def.permission == "update" {
        let checked = permission(g, object, ae.target_id, ae.actor_principal_id, "update").await?;
        if !checked.0 {
            return Err(denied());
        }
        proof = checked.1;
    }
    let evaluation = crate::governance::Evaluation {
        allowed: true,
        scope: "ALLOW",
        authorization: "ALLOW",
        quota: "NOT_APPLICABLE",
        zed_token: Some(proof),
        reason: None,
    };
    Ok((
        evaluation,
        json!({"displayName":facts.display_name,"nativeTargetRef":facts.native_ref,
        "oidcIssuer":facts.oidc_issuer,"oidcSubject":facts.oidc_subject,
        "adapterServiceRef":facts.adapter_service_ref,"nativeInstanceRef":facts.native_instance_ref,
        "manifest":facts.manifest}),
    ))
}

pub(crate) async fn fresh_execution(
    state: &ServiceState,
    ae: &Execution,
) -> Result<(crate::governance::Evaluation, Value), Refusal> {
    fresh_mode_execution(state, ae, true).await
}

async fn fresh_mode_execution(
    state: &ServiceState,
    ae: &Execution,
    require_update: bool,
) -> Result<(crate::governance::Evaluation, Value), Refusal> {
    if ae.gate_state != "ALLOWED" {
        return Err(denied());
    }
    let (mut evaluation, facts) = fresh_for_mode(&state.governance, ae, require_update).await?;
    let def = crate::governance::exact_definition_for_execution(&state.pool, ae).await?;
    state
        .governance
        .check_quota(ae.tenant_id, &def, &mut evaluation)
        .await?;
    if !evaluation.allowed {
        return Err(Refusal::Denied(
            evaluation
                .reason
                .clone()
                .unwrap_or(ReasonCode::QuotaExhausted),
        ));
    }
    Ok((evaluation, facts))
}

/// A HUMAN pre-launch revision query uses the same original protocol intent and
/// fresh read/confirmation. It cannot borrow an Agent delegation or NONE
/// lifecycle observation exception, and does not dispatch the document token.
pub(crate) async fn revision_read(
    state: &ServiceState,
    ae: &Execution,
    audience: &str,
    args: &Value,
) -> Result<String, Refusal> {
    if args.get("protocolReconcile").is_some() {
        return lifecycle::authorize_revision(state, ae, audience, args).await;
    }
    if ae.gate_state != "ALLOWED" || ae.dispatch_state != "NOT_DISPATCHED" {
        return Err(denied());
    }
    let typed: contracts::AdapterQueryRevisionRequest =
        serde_json::from_value(args.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(typed).map_err(|_| invalid())? != *args
        || args["idempotencyKey"] != json!(ae.id)
    {
        return Err(invalid());
    }
    let (_, facts) = fresh_execution(state, ae).await?;
    let parameters = ae.parameters.as_ref().ok_or_else(invalid)?;
    let reference = &parameters["protocolSessionOpen"]["reference"];
    if args["nativeObjectRef"] != reference["nativeObjectRef"]
        || args["authorizationTargetNativeRef"] != facts["nativeTargetRef"]
        || (reference.get("assetId").is_some()
            && args["nativeObjectRef"] != facts["nativeTargetRef"])
    {
        return Err(denied());
    }
    let expected:Option<String>=sqlx::query_scalar("select s.audience from admission.action_execution a
        join catalog.application_binding b on b.id=a.component_binding_id and b.state='ACTIVE'
        join identity.service_principal s on s.principal_id=b.service_principal_id
          and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
        join identity.principal p on p.id=s.principal_id and p.tenant_id=a.tenant_id and p.kind='SERVICE' and p.status='ACTIVE'
        where a.id=$1").bind(ae.id).fetch_optional(&state.pool).await?;
    if expected.as_deref() != Some(audience) {
        return Err(denied());
    }
    let def = crate::governance::exact_definition_for_execution(&state.pool, ae).await?;
    let mut tx = state.pool.begin().await?;
    crate::application_catalog::approval::lock_parent(&mut tx, ae).await?;
    if !crate::roles::lock_tenant(&mut tx, ae.tenant_id).await? {
        return Err(denied());
    }
    let locked = crate::governance::lock_execution(&mut tx, ae.id).await?;
    if locked.gate_state != "ALLOWED" || locked.dispatch_state != "NOT_DISPATCHED" {
        return Err(denied());
    }
    crate::application_catalog::approval::require_consumable(
        &state.governance,
        &mut tx,
        &locked,
        &def,
    )
    .await?;
    tx.commit().await?;
    // Read is independently required even for EDIT, whose action permission is
    // update. The query may not convert an update-only grant into content read.
    let checked = permission(
        &state.governance,
        &def.permission_object_type,
        ae.target_id,
        ae.actor_principal_id,
        "read",
    )
    .await?;
    if !checked.0 {
        return Err(denied());
    }
    Ok(checked.1)
}

/// Admit the original short-lived entity only after the actual adapter head
/// query. Historical VIEW is not certified by this current-head response: the
/// native PAT producer must still prove and serve the exact base VersionId.
pub(crate) async fn admit_session(state: &ServiceState, ae: &Execution) -> Result<Uuid, Refusal> {
    if ae.gate_state != "ALLOWED" || ae.dispatch_state != "NOT_DISPATCHED" {
        return Err(denied());
    }
    let refs = execution_refs(&state.pool, ae.id).await?;
    let parameters = ae.parameters.as_ref().ok_or_else(invalid)?;
    let input = &parameters["protocolSessionOpen"];
    let reference = &input["reference"];
    let expires = parameters["protocolExpiresAt"]
        .as_str()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|s| s.with_timezone(&Utc))
        .filter(|s| *s > Utc::now())
        .ok_or_else(denied)?;
    let def = crate::governance::exact_definition_for_execution(&state.pool, ae).await?;
    let (_, facts) = fresh_execution(state, ae).await?;
    let arguments = json!({"nativeObjectRef":reference["nativeObjectRef"],
        "authorizationTargetNativeRef":facts["nativeTargetRef"],"idempotencyKey":ae.id});
    let adapter = crate::application_binding::native::Adapter::resolve(
        facts["adapterServiceRef"].as_str().ok_or_else(invalid)?,
        facts["nativeInstanceRef"].as_str().ok_or_else(invalid)?,
        &facts["manifest"],
    )?;
    let response = adapter
        .call(state, ae, "query_revision", ae.id, &arguments)
        .await?;
    let typed: contracts::AdapterQueryRevisionResponse =
        serde_json::from_value(response.clone()).map_err(|_| unknown())?;
    if serde_json::to_value(typed).map_err(|_| unknown())? != response
        || response["nativeObjectRef"] != reference["nativeObjectRef"]
        || response["nativeRevision"]
            .as_str()
            .is_none_or(str::is_empty)
    {
        return Err(unknown());
    }
    let conflict = def.action_key == "file_storage.open_edit@v1"
        && response["nativeRevision"] != reference["nativeRevision"];
    // No original root/session lock is held over the adapter's two Core PEP
    // callbacks. Re-check identity, permissions and generation after the read.
    fresh_execution(state, ae).await?;
    let mut tx = state.pool.begin().await?;
    crate::application_catalog::approval::lock_parent(&mut tx, ae).await?;
    if !crate::roles::lock_tenant(&mut tx, ae.tenant_id).await? {
        return Err(denied());
    }
    let locked = crate::governance::lock_execution(&mut tx, ae.id).await?;
    if locked.gate_state != "ALLOWED" || locked.dispatch_state != "NOT_DISPATCHED" {
        return Err(denied());
    }
    crate::application_catalog::approval::require_consumable(
        &state.governance,
        &mut tx,
        &locked,
        &def,
    )
    .await?;
    if conflict {
        crate::governance::record_dispatch(
            &mut tx,
            ae.id,
            def.audit_class(),
            Err(axum::http::StatusCode::CONFLICT),
            Vec::new(),
        )
        .await?;
        tx.commit().await?;
        return Err(Refusal::Precondition(ReasonCode::TargetStateConflict));
    }
    // The AE UUID is only this one-to-one technical locator. Tenant, actor,
    // target, revision and expiry are all frozen facts, not derivable authority.
    let mode = if def.action_key == "file_storage.open_edit@v1" {
        "EDIT"
    } else {
        "VIEW"
    };
    sqlx::query(
        "insert into admission.protocol_session
        (id,operation_id,action_execution_id,kind,tenant_id,workspace_id,actor_principal_id,
         initiating_human_principal_id,application_binding_id,target,requested_mode,admitted_mode,
         token_revocation_key,launch_theme,launch_locale,base_revision,state,expires_at,version)
        values($1,$2,$1,$3,$4,$5,$6,$6,$7,$8,$9,$9,$1,$10,$11,$12,'ADMITTED',$13,1)
        on conflict(action_execution_id) do nothing",
    )
    .bind(ae.id)
    .bind(ae.operation_id)
    .bind(KIND)
    .bind(ae.tenant_id)
    .bind(ae.workspace_id)
    .bind(ae.actor_principal_id)
    .bind(refs.binding_id)
    .bind(reference)
    .bind(mode)
    .bind(input["theme"].as_str().ok_or_else(invalid)?)
    .bind(match input["locale"].as_str() {
        Some("en") => "EN",
        Some("zh-CN") => "ZH_CN",
        _ => return Err(invalid()),
    })
    .bind(reference["nativeRevision"].as_str().ok_or_else(invalid)?)
    .bind(expires)
    .execute(&mut *tx)
    .await?;
    let valid: bool = sqlx::query_scalar(
        "select exists(select 1 from admission.protocol_session
        where id=$1 and action_execution_id=$1 and operation_id=$2 and target=$3
          and application_binding_id=$4 and expires_at=$5 and requested_mode=$6)",
    )
    .bind(ae.id)
    .bind(ae.operation_id)
    .bind(reference)
    .bind(refs.binding_id)
    .bind(expires)
    .bind(mode)
    .fetch_one(&mut *tx)
    .await?;
    if !valid {
        return Err(denied());
    }
    tx.commit().await?;
    Ok(ae.id)
}

pub(crate) async fn pep_check(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    raw: Value,
) -> Response {
    let result=async {
        let typed:contracts::ProtocolSessionPepRequest=serde_json::from_value(raw.clone()).map_err(|_|invalid())?;
        if serde_json::to_value(typed).map_err(|_|invalid())?!=raw {return Err(invalid());}
        let binding=uuid(&raw,"bindingId")?;
        let session_id=uuid(&raw,"protocolSessionId")?;
        let mut authorizations=headers.get_all(axum::http::header::AUTHORIZATION).iter();
        let authorization=authorizations.next().and_then(|h|h.to_str().ok()).ok_or_else(invalid)?;
        if authorizations.next().is_some(){return Err(invalid());}
        let lifecycle=matches!(raw["nativeOperation"].as_str(),Some("TOKEN_OBSERVE"|"TOKEN_REVOKE"));
        let evidence=raw.get("writeObservation").is_some() || lifecycle;
        let client:String=sqlx::query_scalar("select b.normalized_config->>'client_id'
            from catalog.application_binding b join identity.principal p on p.id=b.service_principal_id
              and p.tenant_id=b.tenant_id and p.kind='SERVICE' and p.status='ACTIVE'
            join identity.service_principal s on s.principal_id=p.id and s.component_binding_kind='APPLICATION'
              and s.component_binding_id=b.id
            where b.id=$1 and (b.state='ACTIVE' or ($2 and b.state='DISABLING'))")
            .bind(binding).bind(evidence).fetch_optional(&state.pool).await?.ok_or_else(denied)?;
        let unique:i64=sqlx::query_scalar("select count(*) from catalog.application_binding
            where normalized_config->>'client_id'=$1 and state<>'DISABLED'")
            .bind(&client).fetch_one(&state.pool).await?;
        if unique!=1 {return Err(denied());}
        state.auth.verify_binding_client(Some(authorization),&client).await.map_err(|e|match e {
            crate::service_auth::ServiceAuthError::KeysUnavailable=>unknown(),_=>denied()})?;
        let session:Session=sqlx::query_as("select id,action_execution_id,application_binding_id,target,
            admitted_mode,base_revision,expires_at,state,version,native_session_ref,launch_theme,launch_locale,
            native_write_observation from admission.protocol_session
            where id=$1 and application_binding_id=$2 and kind=$3")
            .bind(session_id).bind(binding).bind(KIND).fetch_optional(&state.pool).await?.ok_or_else(denied)?;
        if session.application_binding_id!=binding || raw["nativeObjectRef"]!=session.target["nativeObjectRef"]
        {return Err(denied());}
        let ae=crate::governance::load_execution(&state.pool,session.action_execution_id).await?.ok_or_else(denied)?;
        let operation=raw["nativeOperation"].as_str().ok_or_else(invalid)?;
        if lifecycle {
            if raw.get("writeObservation").is_some() {return Err(invalid());}
            return lifecycle::metadata(&state,&ae,&session,operation).await;
        }
        if evidence {
            return write::observe(&state,&ae,&session,operation,&raw["writeObservation"]).await;
        }
        if !allowed_operation(&session,operation) {return Err(denied());}
        if (operation=="OPEN" && !matches!(ae.dispatch_state.as_str(),"UNKNOWN"|"DISPATCHED"))
            || (operation!="OPEN" && (ae.dispatch_state!="DISPATCHED" || session.native_session_ref.is_none())) {
            return Err(denied());
        }
        let (evaluation,facts)=fresh_mode_execution(&state,&ae,operation!="READ").await?;
        let mut admitted_mode=session.admitted_mode.as_str();
        if operation=="READ" && admitted_mode=="EDIT" {
            let update=permission(&state.governance,if session.target.get("assetId").is_some(){"asset"}else{"resource"},
                ae.target_id,ae.actor_principal_id,"update").await?;
            if !update.0 {admitted_mode="VIEW";}
        }
        let export=permission(&state.governance,if session.target.get("assetId").is_some(){"asset"}else{"resource"},
            ae.target_id,ae.actor_principal_id,"export").await?;
        // The final query fences any concurrent revocation/disable/expiry which
        // happened while checking SpiceDB. It is not native revision evidence.
        let current:bool=sqlx::query_scalar("select exists(select 1 from admission.protocol_session s
            join catalog.application_binding b on b.id=s.application_binding_id and b.state='ACTIVE'
              and b.normalized_config->>'client_id'=$2
            where s.id=$1 and s.state=$3 and s.expires_at>clock_timestamp())")
            .bind(session.id).bind(client).bind(&session.state).fetch_one(&state.pool).await?;
        if !current {return Err(denied());}
        let mut body=json!({"decision":"ALLOW",
            "platformHumanId":ae.actor_principal_id,"displayName":facts["displayName"],
            "oidcIssuer":facts["oidcIssuer"],"oidcSubject":facts["oidcSubject"],
            "admittedMode":admitted_mode,"minZedToken":evaluation.zed_token.ok_or_else(unknown)?,
            "baseRevision":session.base_revision,"expiresAt":session.expires_at,"exportAllowed":export.0,
            "postMessageOrigin":crate::application_page::origin(&std::env::var("PUBLIC_ORIGIN").map_err(|_|unknown())?)?});
        if let Some(reference)=session.native_session_ref {body["nativeSessionRef"]=json!(reference);}
        let response:contracts::ProtocolSessionPepResponse=serde_json::from_value(body)
            .map_err(|_|invalid())?;
        serde_json::to_value(response).map_err(|_|invalid())
    }.await;
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => error.respond(None),
    }
}
