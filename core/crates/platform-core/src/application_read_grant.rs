//! DD-89: one receiver-initiated read batch uses the original AE, permission,
//! quota and audit authorities. Neither source bytes nor importer state live here.
use super::*;
use crate::{
    application_catalog::ApplicationDefinition, governance::Evaluation, service_api::ServiceState,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
};

const KIND: &str = "SERVICE_READ";

#[path = "application_read_receipt.rs"]
pub(crate) mod receipt;

#[path = "application_read_receiver.rs"]
pub(crate) mod native_receiver;

#[derive(sqlx::FromRow)]
struct Receiver {
    tenant: Uuid,
    workspace: Option<Uuid>,
    principal: Uuid,
    client: String,
    generation: i64,
    manifest: Value,
}

struct Source {
    binding: Uuid,
    generation: i64,
    version: i32,
    native_ref: String,
    application: ApplicationDefinition,
    adapter: native::Adapter,
}

#[derive(PartialEq, sqlx::FromRow)]
struct ReadCaller {
    tenant: Uuid,
    workspace: Option<Uuid>,
    principal: Uuid,
    client: String,
    generation: Option<i64>,
}

/// Authentication of retained operation metadata is separate from fresh read
/// admission. Disabled scope/projections cannot erase the original SERVICE
/// identity, but a missing, rotated or reused client cannot impersonate it.
async fn read_caller(conn: &mut PgConnection, binding: Uuid) -> Result<ReadCaller, Refusal> {
    let caller: ReadCaller = sqlx::query_as(
        "select b.tenant_id as tenant,b.workspace_id as workspace,
            s.principal_id as principal,b.normalized_config->>'client_id' as client,
            b.active_projection_generation as generation
         from catalog.application_binding b
         join identity.service_principal s on s.principal_id=b.service_principal_id
           and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
         join identity.principal p on p.id=s.principal_id and p.tenant_id=b.tenant_id and p.kind='SERVICE'
         where b.id=$1 for share of b,s,p",
    )
    .bind(binding)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(denied)?;
    let count: i64 = sqlx::query_scalar(
        "select count(*) from catalog.application_binding where normalized_config->>'client_id'=$1",
    )
    .bind(&caller.client)
    .fetch_one(conn)
    .await?;
    if caller.client.is_empty() || count != 1 {
        return Err(denied());
    }
    Ok(caller)
}

fn validate_observation_request(
    caller: &ReadCaller,
    ae: &Execution,
    raw: &Value,
    input: &Value,
) -> Result<(), Refusal> {
    let p = ae.parameters.as_ref().ok_or_else(invalid)?;
    let binding = uuid(&p["readBilling"]["RECEIVER"], "bindingId")?;
    let arguments = json!({"targetType":"RESOURCE","targetId":ae.target_id,
        "input":input,"authorizationTargetNativeRef":text(p,"readNativeRoot")?});
    let digest = collab_bridge::limits::canonical_digest(&arguments);
    let command = collab_bridge::limits::canonical_digest(&json!({
        "receiverBindingId":binding,"sourceResourceId":ae.target_id,
        "actionKey":ae.action_key,"actionVersion":ae.action_version,
        "argumentHash":digest,"nativeBatch":raw["nativeBatch"]}));
    if !is_service(ae)
        || caller.tenant != ae.tenant_id
        || caller.workspace != ae.workspace_id
        || caller.principal != ae.actor_principal_id
        || raw["receiverBindingId"] != json!(binding)
        || p["receiverBindingId"] != json!(binding)
        || raw["sourceResourceId"] != json!(ae.target_id)
        || raw["actionKey"] != ae.action_key
        || raw["actionVersion"] != ae.action_version
        || raw["idempotencyKey"] != p["idempotencyKey"]
        || !p["nativeBatch"].is_object()
        || raw["nativeBatch"] != p["nativeBatch"]
        || input != &p["readReference"]
        || input["resourceId"] != json!(ae.target_id)
        || p["toolParameterHash"] != digest
        || p["commandDigest"] != command
        || ae.parameter_hash != command
    {
        return Err(Refusal::Conflict(ReasonCode::IdempotencyKeyReused));
    }
    Ok(())
}

fn denied() -> Refusal {
    Refusal::Denied(ReasonCode::ScopeGuardFailed)
}

fn declares(manifest: &Value, category: Option<&str>, role: &str) -> bool {
    manifest["capabilityDeclarations"]
        .as_array()
        .is_some_and(|items| {
            items.iter().any(|item| {
                category.is_none_or(|category| item["categoryKey"] == category)
                    && (item["readEdge"] == role || item["readEdge"] == "BOTH")
            })
        })
}

pub(crate) async fn validate_input_reference(
    conn: &mut PgConnection,
    tenant: Uuid,
    binding: Uuid,
    generation: i64,
    workspace: Option<Uuid>,
    reference: &Value,
) -> Result<(), Refusal> {
    let admitted = receiver(conn, binding).await?;
    if admitted.tenant != tenant
        || admitted.workspace != workspace
        || admitted.generation != generation
        || !declares(&admitted.manifest, Some("knowledge"), "RECEIVER")
    {
        return Err(denied());
    }
    let (manifest,category): (Value,String)=sqlx::query_as("select release.manifest,kind.capability_category
        from catalog.resource r
        join catalog.application_binding b on b.id=r.application_binding_id and b.tenant_id=r.tenant_id and b.state='ACTIVE'
        join catalog.component_release release on release.id=b.component_release_id and release.status='APPROVED'
        join catalog.resource_type_definition kind on kind.id=r.resource_type_definition_id
          and kind.component_release_id=b.component_release_id and kind.status='ACTIVE'
        left join identity.workspace w on w.id=r.home_workspace_id and w.tenant_id=r.tenant_id
        where r.id=$1 and r.tenant_id=$2 and r.state='ACTIVE' and r.projection_action_execution_id is null
          and (r.home_workspace_id is null or w.state='ACTIVE')
          and ($3::uuid is null or r.home_workspace_id is null or r.home_workspace_id=$3)
          and ($4::uuid is null or exists(select 1 from catalog.asset a where a.id=$4
            and a.resource_id=r.id and a.tenant_id=r.tenant_id and a.state='ACTIVE'
            and a.projection_action_execution_id is null)) for share of r,b,release,kind")
        .bind(uuid(reference,"resourceId")?).bind(tenant).bind(workspace)
        .bind(reference.get("assetId").map(|_|uuid(reference,"assetId")).transpose()?)
        .fetch_optional(&mut *conn).await?.ok_or_else(denied)?;
    if !declares(&manifest, Some(&category), "SOURCE") {
        return Err(denied());
    }
    Ok(())
}

async fn receiver(conn: &mut PgConnection, binding: Uuid) -> Result<Receiver, Refusal> {
    let row: Receiver = sqlx::query_as(
        "select b.tenant_id as tenant,b.workspace_id as workspace,
        s.principal_id as principal,b.normalized_config->>'client_id' as client,
        b.active_projection_generation as generation,r.manifest
        from catalog.application_binding b
        join identity.tenant t on t.id=b.tenant_id and t.state='ACTIVE'
        join identity.service_principal s on s.principal_id=b.service_principal_id
          and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
        join identity.principal p on p.id=s.principal_id and p.tenant_id=b.tenant_id
          and p.kind='SERVICE' and p.status='ACTIVE'
        join catalog.component_release r on r.id=b.component_release_id and r.status='APPROVED'
        join projection.application_runtime projection on projection.binding_id=b.id
          and projection.generation=b.active_projection_generation and projection.state='ACTIVE'
          and projection.component_release_id=b.component_release_id
        left join identity.workspace w on w.id=b.workspace_id and w.tenant_id=b.tenant_id
        where b.id=$1 and b.state='ACTIVE' and (b.workspace_id is null or w.state='ACTIVE')
        for share of b,s,p,t,r,projection",
    )
    .bind(binding)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(denied)?;
    if row.client.is_empty() || !declares(&row.manifest, None, "RECEIVER") {
        return Err(blocked());
    }
    let count: i64 = sqlx::query_scalar(
        "select count(*) from catalog.application_binding
        where normalized_config->>'client_id'=$1 and state<>'DISABLED'",
    )
    .bind(&row.client)
    .fetch_one(&mut *conn)
    .await?;
    if count != 1 {
        return Err(denied());
    }
    Ok(row)
}

/// Only the receiving binding's own SERVICE identity can discover its current
/// reader grants. This is metadata, not a read token or a second grant authority;
/// request_read_grant and the source PEP still authorize every actual batch.
pub(crate) async fn read_resources(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    Path(binding): Path<Uuid>,
    Query(query): Query<super::read::ReadResourceQuery>,
) -> Response {
    match service_resource_page(&state, &headers, binding, query).await {
        Ok(page) => Json(page).into_response(),
        Err(error) => error.respond(None),
    }
}

async fn service_resource_page(
    state: &ServiceState,
    headers: &HeaderMap,
    binding: Uuid,
    query: super::read::ReadResourceQuery,
) -> Result<contracts::ApplicationReadResourcePage, Refusal> {
    let mut authorization = headers.get_all(axum::http::header::AUTHORIZATION).iter();
    let header = authorization
        .next()
        .and_then(|value| value.to_str().ok())
        .ok_or_else(denied)?;
    if authorization.next().is_some() {
        return Err(denied());
    }
    // Do not retain binding locks while acquiring the Tenant lifecycle lock.
    let mut tx = state.pool.begin().await?;
    let caller = read_caller(&mut tx, binding).await?;
    state
        .auth
        .verify_binding_client(Some(header), &caller.client)
        .await
        .map_err(|error| match error {
            crate::service_auth::ServiceAuthError::KeysUnavailable => {
                Refusal::Unavailable("adapter identity keys unavailable".into())
            }
            _ => Refusal::Denied(ReasonCode::PermissionDenied),
        })?;
    tx.rollback().await?;

    let mut tx = state.pool.begin().await?;
    if !crate::roles::lock_tenant(&mut tx, caller.tenant).await? {
        return Err(denied());
    }
    let admitted = receiver(&mut tx, binding).await?;
    validate_current_receiver(&caller, &admitted)?;
    let page = read_service_resource_page(
        &mut tx,
        &state.governance.spicedb,
        state.governance.cfg.relationship_page,
        &admitted,
        binding,
        &query,
    )
    .await?;
    tx.commit().await?;
    Ok(page)
}

async fn read_service_resource_page(
    conn: &mut PgConnection,
    spicedb: &crate::spicedb::SpiceDb,
    relationship_page: u32,
    admitted: &Receiver,
    binding: Uuid,
    query: &super::read::ReadResourceQuery,
) -> Result<contracts::ApplicationReadResourcePage, Refusal> {
    let limit = i64::from(relationship_page);
    let offset = service_directory_offset(query, limit)?;
    let (version, principal, workspace) =
        super::read::read_receiver(conn, admitted.tenant, binding)
            .await?
            .ok_or_else(denied)?;
    let rows =
        super::read::read_resource_rows(conn, admitted.tenant, binding, workspace, query, limit)
            .await?;
    let has_next = rows.len() == usize::try_from(limit).map_err(|_| invalid())?;
    let mut resources = Vec::new();
    for row in rows {
        if !super::read::resource_visible(
            spicedb,
            relationship_page,
            admitted.tenant,
            principal,
            "read",
            &row,
        )
        .await?
        {
            continue;
        }
        let (id, resource_version, resource_binding, home_workspace, _, kind, native_ref) = row;
        let mut value = json!({"resourceId":id,"version":resource_version,
            "bindingId":resource_binding,"typeKey":kind,"nativeRef":native_ref});
        if let Some(home_workspace) = home_workspace {
            value["workspaceId"] = json!(home_workspace);
        }
        resources.push(value);
    }
    let mut value = json!({"bindingId":binding,"bindingVersion":version,
        "servicePrincipalId":principal,"tenantId":admitted.tenant,
        "direction":query.direction,"resources":resources});
    if let Some(workspace) = workspace {
        value["workspaceId"] = json!(workspace);
    }
    if has_next {
        value["nextOffset"] = json!(offset + limit);
    }
    let page = serde_json::from_value(value).map_err(|_| blocked())?;
    Ok(page)
}

fn service_directory_offset(
    query: &super::read::ReadResourceQuery,
    limit: i64,
) -> Result<i64, Refusal> {
    let offset = query.offset.unwrap_or(0);
    if query.direction != contracts::ApplicationReadResourceDirection::Source
        || offset < 0
        || limit <= 0
        || offset.checked_add(limit).is_none()
    {
        return Err(invalid());
    }
    Ok(offset)
}

fn validate_current_receiver(caller: &ReadCaller, admitted: &Receiver) -> Result<(), Refusal> {
    if admitted.tenant != caller.tenant
        || admitted.workspace != caller.workspace
        || admitted.principal != caller.principal
        || admitted.client != caller.client
        || Some(admitted.generation) != caller.generation
    {
        return Err(denied());
    }
    Ok(())
}

async fn source(
    conn: &mut PgConnection,
    receiver: &Receiver,
    resource: Uuid,
    key: &str,
    version: i32,
) -> Result<Source, Refusal> {
    let (binding, generation, resource_version, category, manifest, adapter_ref, native_instance, native_ref):
        (Uuid,i64,i32,String,Value,String,String,String) = sqlx::query_as(
        "select b.id,b.active_projection_generation,r.version,kind.capability_category,
            release.manifest,b.adapter_service_ref,b.native_instance_ref,r.native_id
         from catalog.resource r
         join catalog.application_binding b on b.id=r.application_binding_id and b.tenant_id=r.tenant_id
         join identity.service_principal service on service.principal_id=b.service_principal_id
           and service.component_binding_kind='APPLICATION' and service.component_binding_id=b.id
         join identity.principal principal on principal.id=service.principal_id and principal.tenant_id=b.tenant_id
           and principal.kind='SERVICE' and principal.status='ACTIVE'
         join catalog.component_release release on release.id=b.component_release_id and release.status='APPROVED'
         join catalog.resource_type_definition kind on kind.id=r.resource_type_definition_id
           and kind.type_key=r.type_key and kind.component_release_id=b.component_release_id and kind.status='ACTIVE'
         left join identity.workspace w on w.id=r.home_workspace_id and w.tenant_id=r.tenant_id
         where r.id=$1 and r.tenant_id=$2 and r.state='ACTIVE' and r.projection_action_execution_id is null
           and b.state='ACTIVE' and (r.home_workspace_id is null or w.state='ACTIVE')
           and ($3::uuid is null or r.home_workspace_id is null or r.home_workspace_id=$3)
         for share of r,b,release,kind,service,principal")
        .bind(resource).bind(receiver.tenant).bind(receiver.workspace).fetch_optional(&mut *conn).await?.ok_or_else(denied)?;
    if !declares(&manifest, Some(&category), "SOURCE")
        || native::Connector::from_manifest(&manifest)? != native::Connector::RemoteAdapter
    {
        return Err(blocked());
    }
    let application = crate::application_catalog::exact_definition_for_binding(
        conn, binding, generation, key, version,
    )
    .await?;
    let def = &application.definition;
    if def.target_type != "RESOURCE"
        || def.permission_object_type != "resource"
        || !matches!(def.permission.as_str(), "read" | "discover")
        || def.execution_mode != "SYNC"
        || def.confirmation_mode != "NONE"
        || def.approval_policy_id.is_some()
    {
        return Err(blocked());
    }
    if native_ref.is_empty() {
        return Err(blocked());
    }
    let adapter = native::Adapter::resolve(&adapter_ref, &native_instance, &manifest)?;
    Ok(Source {
        binding,
        generation,
        version: resource_version,
        native_ref,
        application,
        adapter,
    })
}

async fn evaluate(
    state: &ServiceState,
    receiver: &Receiver,
    source: &Source,
    resource: Uuid,
) -> Result<Evaluation, Refusal> {
    let mut evaluation = Evaluation {
        allowed: true,
        scope: "ALLOW",
        authorization: "ALLOW",
        quota: "NOT_APPLICABLE",
        zed_token: None,
        reason: None,
    };
    // Every batch needs read, including a list action whose public permission
    // mapping additionally requires discover. No reader relation is invented.
    for permission in ["read", source.application.definition.permission.as_str()]
        .into_iter()
        .collect::<BTreeSet<_>>()
    {
        let check = state
            .governance
            .spicedb
            .check(
                "resource",
                &resource.to_string(),
                permission,
                &receiver.principal.to_string(),
                crate::spicedb::Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| Refusal::Unavailable("service read authorization unavailable".into()))?;
        if check.zed_token.is_empty() {
            return Err(blocked());
        }
        evaluation.zed_token = Some(check.zed_token);
        if !check.allowed {
            evaluation.allowed = false;
            evaluation.authorization = "DENY";
            evaluation.reason = Some(ReasonCode::PermissionDenied);
            break;
        }
    }
    state
        .governance
        .check_quota(
            receiver.tenant,
            &source.application.definition,
            &mut evaluation,
        )
        .await?;
    Ok(evaluation)
}

pub(crate) fn is_service(ae: &Execution) -> bool {
    ae.actor_principal_id == ae.initiator_principal_id
        && ae
            .parameters
            .as_ref()
            .is_some_and(|parameters| parameters["componentActionKind"] == KIND)
}

fn native_batch(raw: &Value) -> Result<Option<&Value>, Refusal> {
    let batch = raw.get("nativeBatch");
    let legacy = raw.get("receiverActionExecutionId").is_some();
    if batch.is_some() == legacy || legacy != raw.get("receiverArgumentsJson").is_some() {
        return Err(invalid());
    }
    Ok(batch)
}

/// The original governance reconciler owns the deadline. An expired bearer
/// cannot prove whether the receiver obtained bytes; quarantine the existing
/// execution as UNKNOWN, never retry the read or assert a terminal outcome.
pub(crate) async fn reconcile_expired(state: &ServiceState, batch: i64) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "select a.id from admission.action_execution a
         where a.parameters->>'componentActionKind'='SERVICE_READ'
           and a.gate_state='ALLOWED' and a.dispatch_state='DISPATCHED'
           and not exists(select 1 from audit.audit_event e
               where e.event_key=a.operation_id::text||':service_read:terminal')
           and case when jsonb_typeof(a.parameters->'readToken'->'exp')='number'
             then (a.parameters->'readToken'->>'exp')::numeric<=extract(epoch from now())
             else true end
         order by a.updated_at,a.id limit $1 for update of a skip locked",
    )
    .bind(batch)
    .fetch_all(&mut *tx)
    .await?;
    for id in ids {
        let ae = crate::governance::lock_execution(&mut tx, id).await?;
        // The immutable definition is historical evidence. A Tenant receiver
        // legitimately reads a Workspace source; neither source withdrawal nor
        // the user/Agent scope rule can erase this read batch's expiry audit.
        let def = receipt::frozen_definition(&mut tx, id).await?;
        sqlx::query(
            "update admission.action_execution set dispatch_state='UNKNOWN',
             reason_code=$2,updated_at=now(),reconcile_last_attempt_at=now() where id=$1",
        )
        .bind(id)
        .bind(crate::governance::wire(&ReasonCode::ExternalResultUnknown))
        .execute(&mut *tx)
        .await?;
        crate::governance::audit(
            &mut tx,
            &ae,
            &def,
            "service_read:expired",
            "RECONCILIATION",
            "NONE",
            "EXTERNAL_RESULT_UNKNOWN",
            None,
            vec![],
        )
        .await?;
        native_receiver::settle(&mut tx, &ae, false).await?;
    }
    tx.commit().await?;
    // Metering unavailability must not prevent deadline quarantine.
    receipt::reconcile(state, batch).await
}

pub(crate) async fn request(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let result = async {
        let Json(raw)=body.map_err(|_|invalid())?;
        let parsed: contracts::AdapterReadGrantRequest=serde_json::from_value(raw.clone()).map_err(|_|invalid())?;
        if serde_json::to_value(parsed).map_err(|_|invalid())? != raw { return Err(invalid()); }
        let binding=uuid(&raw,"receiverBindingId")?;
        let native_batch=native_batch(&raw)?;
        let receiver_execution=raw.get("receiverActionExecutionId").map(|_|uuid(&raw,"receiverActionExecutionId")).transpose()?;
        let target=uuid(&raw,"sourceResourceId")?;
        let key=uuid(&raw,"idempotencyKey")?;
        let action=text(&raw,"actionKey")?;
        let version=raw["actionVersion"].as_i64().and_then(|value|i32::try_from(value).ok()).filter(|value|*value>0).ok_or_else(invalid)?;
        let input: Value=serde_json::from_str(text(&raw,"inputJson")?).map_err(|_|invalid())?;
        let receiver_arguments: Option<Value>=raw.get("receiverArgumentsJson")
            .map(|_|serde_json::from_str(text(&raw,"receiverArgumentsJson")?).map_err(|_|invalid())).transpose()?;
        let mut authorization=headers.get_all(axum::http::header::AUTHORIZATION).iter();
        let header=authorization.next().and_then(|value|value.to_str().ok()).ok_or_else(invalid)?;
        if authorization.next().is_some() { return Err(invalid()); }
        let mut tx=state.pool.begin().await?;
        let caller=read_caller(&mut tx,binding).await?;
        state.auth.verify_binding_client(Some(header),&caller.client).await.map_err(|error|match error {
            crate::service_auth::ServiceAuthError::KeysUnavailable=>Refusal::Unavailable("adapter identity keys unavailable".into()),
            _=>Refusal::Denied(ReasonCode::PermissionDenied),
        })?;
        tx.rollback().await?;
        let mut tx=state.pool.begin().await?;
        let previous: Option<Uuid>=sqlx::query_scalar("select id from admission.action_execution
            where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3")
            .bind(caller.tenant).bind(caller.principal).bind(key).fetch_optional(&mut *tx).await?;
        let previous=match previous {
            Some(id)=>Some(crate::governance::lock_execution(&mut tx,id).await?),
            None=>None,
        };
        if let (Some(ae),Some(_))=(&previous,native_batch) {
            if read_caller(&mut tx,binding).await?!=caller {return Err(denied());}
            validate_observation_request(&caller,ae,&raw,&input)?;
            if let Some(observed)=native_receiver::observation(&mut tx,ae).await? {
                tx.commit().await?;
                return serde_json::from_value::<contracts::AdapterReadGrantResponse>(observed).map_err(|_|invalid());
            }
        }
        // Drop historical AE/binding locks before resuming the original new
        // admission order: parent/AE -> Tenant -> active receiver. Otherwise
        // a metadata lookup could invert disable/receipt lock ordering.
        tx.rollback().await?;
        let initial=caller;
        let initial_generation=initial.generation.ok_or_else(denied)?;
        let mut tx=state.pool.begin().await?;
        // The admitted receiver is provenance, not an AE parent: a SERVICE
        // batch must not impersonate the receiver's HUMAN/AGENT actor. DD-89
        // creates its own root Operation under the original AE authority.
        let parent: Option<(Uuid,Uuid,String)>=if let Some(receiver_execution)=receiver_execution { Some(sqlx::query_as("select operation_id,target_id,parameters->>'toolParameterHash'
            from admission.action_execution where id=$1 and tenant_id=$2
            and ($3::uuid is null or workspace_id=$3) and component_binding_kind='APPLICATION'
            and component_binding_id=$4 and component_projection_generation=$5
            and gate_state='ALLOWED' and dispatch_state='DISPATCHED' for update")
            .bind(receiver_execution).bind(initial.tenant).bind(initial.workspace).bind(binding)
            .bind(initial_generation).fetch_optional(&mut *tx).await?.ok_or_else(denied)?) } else { None };
        let previous: Option<Uuid>=sqlx::query_scalar("select id from admission.action_execution
            where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3")
            .bind(initial.tenant).bind(initial.principal).bind(key).fetch_optional(&mut *tx).await?;
        let previous=match previous {
            Some(id)=>Some(crate::governance::lock_execution(&mut tx,id).await?),
            None=>None,
        };
        if !crate::roles::lock_tenant(&mut tx,initial.tenant).await? { return Err(denied()); }
        let receiver=receiver(&mut tx,binding).await?;
        validate_current_receiver(&initial,&receiver)?;
        if input["resourceId"]!=json!(target) { return Err(denied()); }
        if let Some((_,parent_target,parent_hash))=&parent {
            let args=receiver_arguments.as_ref().ok_or_else(invalid)?;
            if collab_bridge::limits::canonical_digest(args)!=*parent_hash
                || args["target"]["resourceId"]!=json!(parent_target) || args["input"]!=input { return Err(denied()); }
        }
        let native=if let Some(batch)=native_batch {
            Some(native_receiver::resolve(&mut tx,&receiver,binding,batch).await?)
        } else { None };
        let source=source(&mut tx,&receiver,target,action,version).await?;
        let arguments=json!({"targetType":"RESOURCE","targetId":target,"input":input,
            "authorizationTargetNativeRef":source.native_ref});
        let digest=collab_bridge::limits::canonical_digest(&arguments);
        let mut command_value=json!({"receiverBindingId":binding,
            "sourceResourceId":target,"actionKey":action,"actionVersion":version,"argumentHash":digest});
        if let Some(batch)=native_batch { command_value["nativeBatch"]=batch.clone(); }
        else { command_value["receiverActionExecutionId"]=json!(receiver_execution); }
        let command=collab_bridge::limits::canonical_digest(&command_value);
        let documents=crate::application_tool::schemas(&mut tx,source.binding,action).await?;
        let schema=documents.get(text(&source.application.declaration,"inputSchemaDigest")?).ok_or_else(blocked)?;
        if !crate::capability_contract::schema_validator(schema,&documents)?.is_valid(&arguments["input"]) { return Err(invalid()); }
        let id=if let Some(ae)=previous {
            if !is_service(&ae) || ae.parameters.as_ref().is_none_or(|p|p["commandDigest"]!=command) {
                return Err(Refusal::Conflict(ReasonCode::IdempotencyKeyReused));
            }
            if ae.gate_state=="DENIED" { return Err(Refusal::Denied(ReasonCode::PermissionDenied)); }
            ae.id
        } else {
            let id=Uuid::new_v4();
            let operation=Uuid::new_v4();
            let source_billing=receipt::billing(&state,&mut tx,receiver.tenant,source.binding,
                source.generation,target,&source.application).await?;
            let receiver_execution=receiver_execution.unwrap_or_else(Uuid::new_v4);
            let receiver_operation=parent.as_ref().map_or(operation,|p|p.0);
            let receiver_billing=if let Some(native)=&native {
                receipt::billing(&state,&mut tx,receiver.tenant,binding,receiver.generation,
                    native.resource,&native.application).await?
            } else {
                receipt::receiver_billing(&mut tx,receiver_execution,key,binding,
                    receiver.generation,parent.as_ref().ok_or_else(invalid)?.1).await?
            };
            let mut parameters=json!({"componentActionKind":KIND,"commandDigest":command,"toolParameterHash":digest,
                "receiverBindingId":binding,"receiverActionExecutionId":receiver_execution,
                "receiverOperationId":receiver_operation,
                "receiverGeneration":receiver.generation,"targetVersion":source.version,"idempotencyKey":key,
                "readMode":if source.application.definition.permission=="discover" {"DISCOVER"} else {"READ"},
                "readNativeRoot":source.native_ref,
                "readReference":input,"readBilling":{"SOURCE":source_billing,"RECEIVER":receiver_billing}});
            if let Some(native)=&native {
                parameters["nativeBatch"]=native_batch.cloned().ok_or_else(invalid)?;
                parameters["receiverTargetVersion"]=json!(native.version);
                parameters["receiverDefinitionId"]=json!(native.application.definition_id);
            }
            let inserted=sqlx::query("insert into admission.action_execution
                (id,operation_id,tenant_id,workspace_id,action_key,action_version,initiator_principal_id,actor_principal_id,
                 target_id,parameter_hash,parameters,idempotency_key,gate_state,dispatch_state,correlation_id,
                 action_definition_id,component_binding_kind,component_binding_id,component_release_id,component_projection_generation)
                values($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,'EVALUATING','NOT_DISPATCHED',$2,$12,'APPLICATION',$13,$14,$15)
                on conflict(tenant_id,initiator_principal_id,idempotency_key) where idempotency_key is not null do nothing")
                .bind(id).bind(operation).bind(receiver.tenant).bind(receiver.workspace).bind(action).bind(version)
                .bind(receiver.principal).bind(target).bind(&command).bind(parameters).bind(key)
                .bind(source.application.definition_id).bind(source.binding).bind(source.application.component_release_id).bind(source.generation)
                .execute(&mut *tx).await?;
            if inserted.rows_affected()!=1 { return Err(Refusal::Conflict(ReasonCode::IdempotencyKeyReused)); }
            let ae=crate::governance::lock_execution(&mut tx,id).await?;
            crate::governance::audit(&mut tx,&ae,&source.application.definition,"intent","INTENT","NONE","EVALUATING",None,vec![]).await?;
            id
        };
        let ae=crate::governance::lock_execution(&mut tx,id).await?;
        let attached:bool=sqlx::query_scalar("select exists(select 1 from admission.action_execution where id=$1
            and component_binding_id=$2 and component_release_id=$3 and component_projection_generation=$4 and action_definition_id=$5)")
            .bind(id).bind(source.binding).bind(source.application.component_release_id).bind(source.generation)
            .bind(source.application.definition_id).fetch_one(&mut *tx).await?;
        if !attached || ae.parameters.as_ref().is_none_or(|p|p["receiverGeneration"]!=receiver.generation
            || p["targetVersion"]!=source.version) { return Err(denied()); }
        if let Some(native)=&native {
            if ae.parameters.as_ref().is_none_or(|p|p["receiverTargetVersion"]!=native.version
                || p["receiverDefinitionId"]!=json!(native.application.definition_id)) { return Err(denied()); }
        }
        let fresh=evaluate(&state,&receiver,&source,target).await?;
        crate::governance::record_decision(&mut tx,&crate::governance::DecisionSubject {
            action_execution_id:id,operation_id:ae.operation_id,tenant_id:ae.tenant_id,workspace_id:ae.workspace_id,
            principal_id:ae.actor_principal_id,action_key:action,action_version:version,target_id:target,parameter_hash:&ae.parameter_hash,
        },"ADMISSION",fresh.scope,fresh.authorization,"NOT_APPLICABLE",fresh.quota,fresh.zed_token.as_deref(),fresh.reason.as_ref()).await?;
        if !fresh.allowed {
            // A fresh denial prevents another disclosure, but cannot erase an
            // already issued read's usage/evidence obligations.
            sqlx::query("update admission.action_execution set
                gate_state=case when gate_state='ALLOWED' then gate_state else 'DENIED' end,
                dispatch_state=case when gate_state='ALLOWED' then 'UNKNOWN' else dispatch_state end,
                updated_at=now() where id=$1")
                .bind(id).execute(&mut *tx).await?;
            crate::governance::audit(&mut tx,&ae,&source.application.definition,"denied","DECISION","DENY","PERMISSION_DENIED",None,vec![]).await?;
            tx.commit().await?;
            return Err(Refusal::Denied(fresh.reason.unwrap_or(ReasonCode::PermissionDenied)));
        }
        let audience=text(&source.adapter.value,"actionTokenAudience")?;
        let token=crate::action_token::issue_service_read(&state,&ae,&source.application.definition,audience,
            fresh.zed_token.as_deref().ok_or_else(blocked)?).await?;
        let claims=crate::action_token::verify(&token,audience)?;
        let stamp=json!({"jti":claims["jti"],"iat":claims["iat"],"exp":claims["exp"]});
        sqlx::query("update admission.action_execution set gate_state='ALLOWED',dispatch_state='DISPATCHED',
            parameters=jsonb_set(parameters,'{readToken}', $2),updated_at=now() where id=$1")
            .bind(id).bind(stamp).execute(&mut *tx).await?;
        // The event key records this token's stable jti; no bearer is retained.
        crate::governance::audit(&mut tx,&ae,&source.application.definition,&format!("read-token:{}",text(&claims,"jti")?),
            "DECISION","ALLOW","READ_TOKEN_ISSUED",None,vec![]).await?;
        let receiver_write=if let Some(native)=&native {
            Some(native_receiver::admit(&state,&mut tx,&ae,&receiver,binding,native,
                native_batch.ok_or_else(invalid)?).await?)
        } else { None };
        let endpoint=reqwest::Url::parse(text(&source.adapter.value,"baseUrl")?).map_err(|_|blocked())?
            .join("platform-adapter/v1/execute").map_err(|_|blocked())?.to_string();
        tx.commit().await?;
        let mut response=json!({"actionExecutionId":id,
            "operationId":ae.operation_id,"sourceBindingId":source.binding,"endpoint":endpoint,"actionToken":token,
            "expiresAt":claims["exp"],"argumentsJson":collab_bridge::limits::canonical_json(&json!({
                "actionKey":action,"idempotencyKey":key,"arguments":arguments}))});
        if let Some(write)=receiver_write { response["receiverWrite"]=write; }
        let response: contracts::AdapterReadGrantResponse=serde_json::from_value(response).map_err(|_|invalid())?;
        Ok::<_,Refusal>(response)
    }.await;
    match result {
        Ok(response) => Json(response).into_response(),
        Err(error) => error.respond(None),
    }
}

/// Called only after the original source-binding OIDC authentication and AE lock.
pub(crate) async fn authorize(
    state: &ServiceState,
    ae: &Execution,
    source_binding: Uuid,
    claims: &Value,
    operation: &str,
    arguments: &Value,
) -> Result<String, Refusal> {
    validate_claims(ae, claims, operation, arguments)?;
    let p = ae.parameters.as_ref().ok_or_else(invalid)?;
    let mut tx = state.pool.begin().await?;
    let receiver = receiver(&mut tx, uuid(p, "receiverBindingId")?).await?;
    if receiver.principal != ae.actor_principal_id
        || receiver.tenant != ae.tenant_id
        || receiver.workspace != ae.workspace_id
        || p["receiverGeneration"] != receiver.generation
    {
        return Err(denied());
    }
    let receiver_active: bool = sqlx::query_scalar(
        "select exists(select 1 from admission.action_execution
        where id=$1 and tenant_id=$2 and operation_id=$3 and component_binding_kind='APPLICATION'
        and component_binding_id=$4 and component_projection_generation=$5
        and gate_state='ALLOWED' and dispatch_state='DISPATCHED')",
    )
    .bind(uuid(p, "receiverActionExecutionId")?)
    .bind(receiver.tenant)
    .bind(uuid(p, "receiverOperationId")?)
    .bind(uuid(p, "receiverBindingId")?)
    .bind(receiver.generation)
    .fetch_one(&mut *tx)
    .await?;
    if !receiver_active {
        return Err(denied());
    }
    let source = source(
        &mut tx,
        &receiver,
        ae.target_id,
        &ae.action_key,
        ae.action_version,
    )
    .await?;
    if arguments["authorizationTargetNativeRef"] != source.native_ref {
        return Err(denied());
    }
    let attached: bool=sqlx::query_scalar("select exists(select 1 from admission.action_execution where id=$1
        and component_binding_id=$2 and component_release_id=$3 and component_projection_generation=$4 and action_definition_id=$5)")
        .bind(ae.id).bind(source.binding).bind(source.application.component_release_id).bind(source.generation)
        .bind(source.application.definition_id).fetch_one(&mut *tx).await?;
    if source.binding != source_binding || !attached || p["targetVersion"] != source.version {
        return Err(denied());
    }
    let evaluation = evaluate(state, &receiver, &source, ae.target_id).await?;
    if !evaluation.allowed {
        return Err(Refusal::Denied(
            evaluation.reason.unwrap_or(ReasonCode::PermissionDenied),
        ));
    }
    tx.commit().await?;
    evaluation.zed_token.ok_or_else(blocked)
}

fn validate_claims(
    ae: &Execution,
    claims: &Value,
    operation: &str,
    arguments: &Value,
) -> Result<(), Refusal> {
    let p = ae.parameters.as_ref().ok_or_else(invalid)?;
    if !(is_service(ae) || native_receiver::is_receiver(ae))
        || operation != "execute"
        || ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "DISPATCHED"
        || claims["actor_principal_id"] != json!(ae.actor_principal_id)
        || claims["tenant_id"] != json!(ae.tenant_id)
        || claims["operation_id"] != json!(ae.operation_id)
        || claims["action_key"] != ae.action_key
        || claims["action_execution_id"] != json!(ae.id)
        || claims["action_definition_version"] != ae.action_version
        || claims["target_type"] != "RESOURCE"
        || claims["target_id"] != json!(ae.target_id)
        || claims.get("workspace_id") != ae.workspace_id.map(|id| json!(id)).as_ref()
        || claims["authorization_min_zed_token"]
            .as_str()
            .is_none_or(str::is_empty)
        || [
            "initiating_human_principal_id",
            "agent_principal_id",
            "delegation_id",
            "delegation_version",
            "result_exposure_policy_id",
            "result_exposure_policy_version",
        ]
        .iter()
        .any(|key| claims.get(*key).is_some())
        || claims["normalized_parameter_hash"] != p["toolParameterHash"]
        || claims["idempotency_key"] != p["idempotencyKey"]
        || claims["normalized_parameter_hash"] != collab_bridge::limits::canonical_digest(arguments)
        || claims["jti"] != p["readToken"]["jti"]
        || claims["exp"] != p["readToken"]["exp"]
        || arguments["targetType"] != "RESOURCE"
        || arguments["targetId"] != json!(ae.target_id)
    {
        return Err(denied());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_directory_rejects_receiver_direction_and_invalid_pages() {
        let query = |direction, offset| super::super::read::ReadResourceQuery {
            direction,
            offset,
            category_key: None,
        };
        use contracts::ApplicationReadResourceDirection::{Receiver, Source};
        assert_eq!(
            service_directory_offset(&query(Source, None), 16).unwrap(),
            0
        );
        assert_eq!(
            service_directory_offset(&query(Source, Some(16)), 16).unwrap(),
            16
        );
        for (direction, offset, limit) in [
            (Receiver, None, 16),
            (Source, Some(-1), 16),
            (Source, Some(i64::MAX), 16),
            (Source, None, 0),
        ] {
            assert!(service_directory_offset(&query(direction, offset), limit).is_err());
        }
    }

    #[test]
    fn service_directory_rechecks_all_authenticated_binding_identity_facts() {
        let (caller, _, _, _) = retained_observation();
        let current = || Receiver {
            tenant: caller.tenant,
            workspace: caller.workspace,
            principal: caller.principal,
            client: caller.client.clone(),
            generation: caller.generation.unwrap(),
            manifest: json!({}),
        };
        assert!(validate_current_receiver(&caller, &current()).is_ok());
        for field in ["tenant", "workspace", "principal", "client", "generation"] {
            let mut altered = current();
            match field {
                "tenant" => altered.tenant = Uuid::new_v4(),
                "workspace" => altered.workspace = None,
                "principal" => altered.principal = Uuid::new_v4(),
                "client" => altered.client.push_str("-rotated"),
                "generation" => altered.generation += 1,
                _ => unreachable!(),
            }
            assert!(
                validate_current_receiver(&caller, &altered).is_err(),
                "{field}"
            );
        }
    }

    #[tokio::test]
    #[ignore = "requires the existing migrated isolated database; fixtures roll back"]
    async fn service_directory_reads_real_scoped_rows_and_fresh_service_permissions() {
        use sqlx::Connection;
        use std::sync::{
            Arc,
            atomic::{AtomicU8, AtomicUsize, Ordering},
        };
        let mut conn = PgConnection::connect(
            &std::env::var("APPLICATION_EXECUTION_TEST_DATABASE_URL").expect("isolated database"),
        )
        .await
        .unwrap();
        let mut tx = conn.begin().await.unwrap();
        let base = include_str!("../../../verify/application-execution-base.sql")
            .replace("\nBEGIN;\n", "\n")
            .replace("\nCOMMIT;", "\n");
        sqlx::raw_sql(&base).execute(&mut *tx).await.unwrap();
        let (registration, bindings) =
            include_str!("../../../verify/application-execution-dispatch.sql")
                .split_once("DO $$\nDECLARE provider text; release uuid; binding uuid;")
                .unwrap();
        let registration = registration.replace(
            "'resourceTypeDefinitions',jsonb_build_array(resource_type));",
            "'resourceTypeDefinitions',jsonb_build_array(resource_type),\n\
             'executionConnector',jsonb_build_object('mode','REMOTE_ADAPTER','adapterProtocolRange','1','actionTokenAudience','isolated-reader'),\n\
             'capabilityDeclarations',jsonb_build_array(jsonb_build_object('categoryKey','retire_plain','readEdge','BOTH')));",
        );
        // Reuse the original dispatch fixture with its constraints enabled;
        // distinct workspace bindings keep the native category uniqueness rule.
        let bindings = format!("DO $$\nDECLARE provider text; release uuid; binding uuid;{bindings}")
            .replacen("create_ae uuid;", "workspace uuid; create_ae uuid;", 1)
            .replace("FOREACH provider IN ARRAY ARRAY['catalog_fixture_two'] LOOP", "FOREACH provider IN ARRAY ARRAY['catalog_fixture_one','catalog_fixture_two'] LOOP")
            .replacen("binding:=gen_random_uuid();", "workspace:=gen_random_uuid(); INSERT INTO identity.workspace(id,tenant_id,slug,name,state) VALUES(workspace,tenant,provider,provider,'ACTIVE'); binding:=gen_random_uuid();", 1)
            .replace("id,operation_id,tenant_id,action_key", "id,operation_id,tenant_id,workspace_id,action_key")
            .replace(",tenant,'", ",tenant,workspace,'")
            .replace("application_binding(id,tenant_id,component_type_key", "application_binding(id,tenant_id,workspace_id,component_type_key")
            .replace("VALUES(binding,tenant,provider", "VALUES(binding,tenant,workspace,provider")
            .replace("application_category(tenant_id,category_key", "application_category(tenant_id,workspace_id,category_key")
            .replace("VALUES(tenant,'retire_plain'", "VALUES(tenant,workspace,'retire_plain'")
            .replace("catalog.resource(id,tenant_id,type_key", "catalog.resource(id,tenant_id,home_workspace_id,type_key")
            .replace("kind,tenant_id,operation_id", "kind,tenant_id,workspace_id,operation_id")
            .replace("'COMPONENT_BINDING',tenant,business_ae", "'COMPONENT_BINDING',tenant,workspace,business_ae")
            .replace("'isolated-instance'", "provider||'-instance'")
            .replace("'{}',repeat('6',64)", "jsonb_build_object('client_id',provider),repeat('6',64)")
            .replace("repeat('f',64)", "encode(sha256(convert_to(format('{\"instance\":%s,\"ref\":%s,\"scope\":%s,\"type\":%s}',frozen->'nativeInstanceRef',frozen->'reference'->'nativeRef',frozen->'nativeScopeRef',frozen->'reference'->'nativeType'),'UTF8')),'hex')");
        sqlx::raw_sql(&format!("{registration}{bindings}"))
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("update identity.service_principal s set component_binding_kind='APPLICATION',component_binding_id=b.id from catalog.application_binding b where b.service_principal_id=s.principal_id")
            .execute(&mut *tx).await.unwrap();
        let binding: Uuid = sqlx::query_scalar("select id from catalog.application_binding where component_type_key='catalog_fixture_one'")
            .fetch_one(&mut *tx).await.unwrap();
        let caller = read_caller(&mut tx, binding).await.unwrap();
        let admitted = receiver(&mut tx, binding).await.unwrap();
        validate_current_receiver(&caller, &admitted).unwrap();
        let mut query = super::super::read::ReadResourceQuery {
            direction: contracts::ApplicationReadResourceDirection::Source,
            offset: None,
            category_key: Some("retire_plain".into()),
        };
        let scoped = super::super::read::read_resource_rows(
            &mut tx,
            admitted.tenant,
            binding,
            admitted.workspace,
            &query,
            16,
        )
        .await
        .unwrap();
        assert_eq!(scoped.len(), 1);
        let all = super::super::read::read_resource_rows(
            &mut tx,
            admitted.tenant,
            binding,
            None,
            &query,
            16,
        )
        .await
        .unwrap();
        assert_eq!(all.len(), 2);
        assert!(
            super::super::read::read_resource_rows(
                &mut tx,
                Uuid::new_v4(),
                binding,
                None,
                &query,
                16
            )
            .await
            .unwrap()
            .is_empty()
        );
        query.category_key = Some("unavailable-category".into());
        assert!(
            super::super::read::read_resource_rows(
                &mut tx,
                admitted.tenant,
                binding,
                None,
                &query,
                16
            )
            .await
            .unwrap()
            .is_empty()
        );
        query.category_key = Some("retire_plain".into());
        let observed = Arc::new((
            scoped[0].clone(),
            admitted.principal,
            AtomicU8::new(0),
            AtomicUsize::new(0),
        ));
        let relationships = {
            let observed = observed.clone();
            let tenant = admitted.tenant;
            move |Json(request): Json<Value>| {
                let observed = observed.clone();
                async move {
                    assert_eq!(request["consistency"]["fullyConsistent"], true);
                    assert_eq!(
                        request["relationshipFilter"]["optionalResourceId"],
                        observed.0.0.to_string()
                    );
                    let owner = if observed.2.load(Ordering::SeqCst) == 3 {
                        Uuid::new_v4()
                    } else {
                        observed.0.4
                    };
                    let mut facts =
                        vec![("owner", "principal", owner), ("tenant", "tenant", tenant)];
                    facts.extend(observed.0.3.map(|id| ("home_workspace", "workspace", id)));
                    assert_eq!(request["optionalLimit"], 1);
                    let offset = request["optionalCursor"]["token"]
                        .as_str()
                        .map(|token| token.parse::<usize>().unwrap())
                        .unwrap_or(0);
                    facts.into_iter().enumerate().skip(offset).take(1).map(|(index, (relation, kind, id))| json!({"result":{"relationship":{
                        "resource":{"objectType":"resource","objectId":observed.0.0},"relation":relation,
                        "subject":{"object":{"objectType":kind,"objectId":id}}
                    },"afterResultCursor":{"token":(index + 1).to_string()}}}).to_string()).collect::<Vec<_>>().join("\n")
                }
            }
        };
        let checks = {
            let observed = observed.clone();
            move |Json(request): Json<Value>| {
                let observed = observed.clone();
                async move {
                    assert_eq!(request["consistency"]["fullyConsistent"], true);
                    assert_eq!(request["permission"], "read");
                    assert_eq!(
                        request["subject"]["object"]["objectId"],
                        observed.1.to_string()
                    );
                    observed.3.fetch_add(1, Ordering::SeqCst);
                    let mode = observed.2.load(Ordering::SeqCst);
                    Json(
                        json!({"checkedAt":{"token":if mode == 2 { "" } else { "fresh-read" }},
                        "permissionship":if mode == 1 { "PERMISSIONSHIP_NO_PERMISSION" } else { "PERMISSIONSHIP_HAS_PERMISSION" }}),
                    )
                }
            }
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let spicedb =
            crate::spicedb::SpiceDb::for_test(format!("http://{}", listener.local_addr().unwrap()));
        let router = axum::Router::new()
            .route("/v1/relationships/read", axum::routing::post(relationships))
            .route("/v1/permissions/check", axum::routing::post(checks));
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let page = read_service_resource_page(&mut tx, &spicedb, 1, &admitted, binding, &query)
            .await
            .unwrap();
        let page = serde_json::to_value(page).unwrap();
        assert_eq!(page["resources"].as_array().unwrap().len(), 1);
        assert_eq!(page["resources"][0]["bindingId"], json!(binding));
        assert_eq!(page["nextOffset"], 1);
        observed.2.store(1, Ordering::SeqCst);
        let denied_page = serde_json::to_value(
            read_service_resource_page(&mut tx, &spicedb, 1, &admitted, binding, &query)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(denied_page["resources"], json!([]));
        assert_eq!(denied_page["nextOffset"], 1);
        for mode in [2, 3] {
            observed.2.store(mode, Ordering::SeqCst);
            assert!(
                read_service_resource_page(&mut tx, &spicedb, 1, &admitted, binding, &query)
                    .await
                    .is_err()
            );
        }
        assert_eq!(observed.3.load(Ordering::SeqCst), 3);
        query.offset = Some(1);
        let end = serde_json::to_value(
            read_service_resource_page(&mut tx, &spicedb, 1, &admitted, binding, &query)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(end["resources"], json!([]));
        assert!(end.get("nextOffset").is_none());
        server.abort();
        tx.rollback().await.unwrap();
    }

    fn retained_observation() -> (ReadCaller, Execution, Value, Value) {
        let caller = ReadCaller {
            tenant: Uuid::new_v4(),
            workspace: Some(Uuid::new_v4()),
            principal: Uuid::new_v4(),
            client: "retained-receiver-fixture".into(),
            generation: Some(2),
        };
        let binding = Uuid::new_v4();
        let target = Uuid::new_v4();
        let key = Uuid::new_v4();
        let input = json!({"resourceId":target,"nativeObjectRef":"original-node","nativeRevision":"fixed-version"});
        let batch = json!({"receiverResourceId":Uuid::new_v4(),"importConfigRef":Uuid::new_v4(),
            "batchId":Uuid::new_v4(),"actionKey":"knowledge.sync_apply@v2","actionVersion":1});
        let arguments = json!({"targetType":"RESOURCE","targetId":target,"input":input,
            "authorizationTargetNativeRef":"retained-source-root"});
        let digest = collab_bridge::limits::canonical_digest(&arguments);
        let raw = json!({"receiverBindingId":binding,"sourceResourceId":target,
            "actionKey":"file_storage.read@v1","actionVersion":1,"nativeBatch":batch,
            "idempotencyKey":key,"inputJson":collab_bridge::limits::canonical_json(&input)});
        let command = collab_bridge::limits::canonical_digest(&json!({"receiverBindingId":binding,
            "sourceResourceId":target,"actionKey":raw["actionKey"],"actionVersion":1,
            "argumentHash":digest,"nativeBatch":batch}));
        let operation = Uuid::new_v4();
        let ae = Execution {
            id: Uuid::new_v4(),
            operation_id: operation,
            tenant_id: caller.tenant,
            workspace_id: caller.workspace,
            action_key: "file_storage.read@v1".into(),
            action_version: 1,
            initiator_principal_id: caller.principal,
            actor_principal_id: caller.principal,
            target_id: target,
            parameter_hash: command.clone(),
            parameters: Some(json!({"componentActionKind":KIND,"commandDigest":command,
                "toolParameterHash":digest,"receiverBindingId":binding,"nativeBatch":batch,
                "idempotencyKey":key,"readReference":input,"readNativeRoot":"retained-source-root",
                "readBilling":{"RECEIVER":{"bindingId":binding}},"readToken":{"exp":1}})),
            temporal_workflow_id: None,
            cancel_first_run_id: None,
            approval_workflow_id: None,
            approval_expires_at: None,
            gate_state: "ALLOWED".into(),
            dispatch_state: "UNKNOWN".into(),
            reason_code: Some("EXTERNAL_RESULT_UNKNOWN".into()),
            correlation_id: operation,
            updated_at: chrono::Utc::now(),
        };
        (caller, ae, raw, input)
    }

    #[test]
    fn retained_observation_requires_original_service_scope_and_command() {
        let (caller, ae, raw, input) = retained_observation();
        assert!(validate_observation_request(&caller, &ae, &raw, &input).is_ok());
        for field in ["receiverBindingId", "sourceResourceId", "idempotencyKey"] {
            let mut altered = raw.clone();
            altered[field] = json!(Uuid::new_v4());
            assert!(
                validate_observation_request(&caller, &ae, &altered, &input).is_err(),
                "{field}"
            );
        }
        for (field, value) in [
            ("actionKey", json!("another.read@v1")),
            ("actionVersion", json!(2)),
            ("nativeBatch", json!({"batchId":Uuid::new_v4()})),
        ] {
            let mut altered = raw.clone();
            altered[field] = value;
            assert!(
                validate_observation_request(&caller, &ae, &altered, &input).is_err(),
                "{field}"
            );
        }
        let mut altered_input = input.clone();
        altered_input["nativeRevision"] = json!("another-version");
        assert!(validate_observation_request(&caller, &ae, &raw, &altered_input).is_err());
        for field in ["tenant", "workspace", "principal"] {
            let (mut altered, _, _, _) = retained_observation();
            altered.tenant = caller.tenant;
            altered.workspace = caller.workspace;
            altered.principal = caller.principal;
            match field {
                "tenant" => altered.tenant = Uuid::new_v4(),
                "workspace" => altered.workspace = None,
                _ => altered.principal = Uuid::new_v4(),
            }
            assert!(
                validate_observation_request(&altered, &ae, &raw, &input).is_err(),
                "{field}"
            );
        }
    }

    #[test]
    fn retained_observation_does_not_reconstruct_missing_or_changed_provenance() {
        for field in [
            "componentActionKind",
            "receiverBindingId",
            "nativeBatch",
            "readReference",
            "readNativeRoot",
            "toolParameterHash",
            "commandDigest",
            "idempotencyKey",
            "readBilling",
        ] {
            let (caller, mut ae, raw, input) = retained_observation();
            ae.parameters
                .as_mut()
                .unwrap()
                .as_object_mut()
                .unwrap()
                .remove(field);
            assert!(
                validate_observation_request(&caller, &ae, &raw, &input).is_err(),
                "{field}"
            );
        }
        let (caller, mut ae, raw, input) = retained_observation();
        ae.parameter_hash = "different-frozen-command".into();
        assert!(validate_observation_request(&caller, &ae, &raw, &input).is_err());
        let (caller, mut ae, raw, input) = retained_observation();
        ae.initiator_principal_id = Uuid::new_v4();
        assert!(validate_observation_request(&caller, &ae, &raw, &input).is_err());
    }

    #[test]
    fn native_sync_does_not_borrow_or_mix_a_human_parent() {
        let native = json!({"nativeBatch":{"receiverResourceId":Uuid::new_v4(),
            "importConfigRef":Uuid::new_v4(),"batchId":Uuid::new_v4(),
            "actionKey":"knowledge.sync_apply@v2","actionVersion":1}});
        assert!(native_batch(&native).unwrap().is_some());
        let legacy =
            json!({"receiverActionExecutionId":Uuid::new_v4(),"receiverArgumentsJson":"{}"});
        assert!(native_batch(&legacy).unwrap().is_none());
        for invalid in [
            json!({}),
            json!({"receiverArgumentsJson":"{}"}),
            json!({"receiverActionExecutionId":Uuid::new_v4()}),
            json!({"nativeBatch":native["nativeBatch"],"receiverArgumentsJson":"{}"}),
            json!({"nativeBatch":native["nativeBatch"],"receiverActionExecutionId":Uuid::new_v4(),"receiverArgumentsJson":"{}"}),
        ] {
            assert!(
                native_batch(&invalid).is_err(),
                "mixed or incomplete admission: {invalid}"
            );
        }
    }

    #[tokio::test]
    #[ignore = "requires migrated isolated APPLICATION_EXECUTION_TEST_DATABASE_URL"]
    async fn service_read_queries_reject_absent_scope_with_valid_sql() {
        use sqlx::Connection;
        let mut conn = PgConnection::connect(
            &std::env::var("APPLICATION_EXECUTION_TEST_DATABASE_URL")
                .expect("isolated database URL"),
        )
        .await
        .unwrap();
        assert!(matches!(
            receiver(&mut conn, Uuid::new_v4()).await,
            Err(Refusal::Denied(_))
        ));
        assert!(matches!(
            read_caller(&mut conn, Uuid::new_v4()).await,
            Err(Refusal::Denied(_))
        ));
        let (_, ae, _, _) = retained_observation();
        let mut tx = conn.begin().await.unwrap();
        assert!(matches!(
            native_receiver::observation(&mut tx, &ae).await,
            Err(Refusal::Denied(_))
        ));
        tx.rollback().await.unwrap();
        let admitted = Receiver {
            tenant: Uuid::new_v4(),
            workspace: None,
            principal: Uuid::new_v4(),
            client: "unregistered-fixture".into(),
            generation: 1,
            manifest: json!({}),
        };
        assert!(matches!(
            source(
                &mut conn,
                &admitted,
                Uuid::new_v4(),
                "file_storage.read@v1",
                1
            )
            .await,
            Err(Refusal::Denied(_))
        ));
    }

    #[test]
    fn read_edge_is_explicit_and_category_specific() {
        let manifest = json!({"capabilityDeclarations":[{"categoryKey":"SOURCE_CATEGORY","readEdge":"SOURCE"},
            {"categoryKey":"RECEIVER_CATEGORY","readEdge":"RECEIVER"}]});
        assert!(declares(&manifest, Some("SOURCE_CATEGORY"), "SOURCE"));
        assert!(declares(&manifest, None, "RECEIVER"));
        assert!(!declares(&manifest, Some("RECEIVER_CATEGORY"), "SOURCE"));
        assert!(!declares(&manifest, Some("missing"), "SOURCE"));
        assert!(!declares(&json!({}), None, "SOURCE"));
    }

    #[test]
    fn service_claims_never_borrow_human_or_agent_authority_or_another_batch() {
        let id = Uuid::new_v4();
        let tenant = Uuid::new_v4();
        let actor = Uuid::new_v4();
        let target = Uuid::new_v4();
        let operation = Uuid::new_v4();
        let key = Uuid::new_v4();
        let jti = Uuid::new_v4();
        let arguments = json!({"targetType":"RESOURCE","targetId":target,"input":{"nativeObjectRef":"immutable-source"},
            "authorizationTargetNativeRef":"authorized-root"});
        let hash = collab_bridge::limits::canonical_digest(&arguments);
        let ae = Execution {
            id,
            operation_id: operation,
            tenant_id: tenant,
            workspace_id: None,
            action_key: "source.read@v1".into(),
            action_version: 1,
            initiator_principal_id: actor,
            actor_principal_id: actor,
            target_id: target,
            parameter_hash: hash.clone(),
            parameters: Some(
                json!({"componentActionKind":KIND,"toolParameterHash":hash,"idempotencyKey":key,
                "readToken":{"jti":jti,"exp":100}}),
            ),
            temporal_workflow_id: None,
            cancel_first_run_id: None,
            approval_workflow_id: None,
            approval_expires_at: None,
            gate_state: "ALLOWED".into(),
            dispatch_state: "DISPATCHED".into(),
            reason_code: None,
            correlation_id: operation,
            updated_at: chrono::Utc::now(),
        };
        let claims = json!({"tenant_id":tenant,"actor_principal_id":actor,"operation_id":operation,
            "action_execution_id":id,"action_key":ae.action_key,"action_definition_version":1,"target_type":"RESOURCE",
            "target_id":target,"normalized_parameter_hash":hash,"idempotency_key":key,"jti":jti,"exp":100,
            "authorization_min_zed_token":"fresh-source-read"});
        assert!(validate_claims(&ae, &claims, "execute", &arguments).is_ok());
        for field in [
            "initiating_human_principal_id",
            "agent_principal_id",
            "delegation_id",
            "result_exposure_policy_id",
        ] {
            let mut changed = claims.clone();
            changed[field] = json!(actor);
            assert!(
                validate_claims(&ae, &changed, "execute", &arguments).is_err(),
                "{field}"
            );
        }
        for field in [
            "tenant_id",
            "actor_principal_id",
            "operation_id",
            "target_id",
            "idempotency_key",
            "jti",
        ] {
            let mut changed = claims.clone();
            changed[field] = json!(Uuid::new_v4());
            assert!(
                validate_claims(&ae, &changed, "execute", &arguments).is_err(),
                "{field}"
            );
        }
        let mut changed = arguments.clone();
        changed["authorizationTargetNativeRef"] = json!("another-root");
        assert!(validate_claims(&ae, &claims, "execute", &changed).is_err());
        assert!(validate_claims(&ae, &claims, "observe", &arguments).is_err());
    }
}
