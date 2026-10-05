//! DD-13/37/70/71、03 §3/8、09 §1、12 §1：受治理模型投影的实际取用。
//! Gateway 保有配置正文；Core 只保存版本/摘要与 Installation 专属 SecretRef。

use contracts::ReasonCode;
use secret_store::{SecretRef, SecretValue};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    governance::Refusal,
    service_api::ServiceState,
    spicedb::{Consistency, Relationship, Write},
};

type CreateInput = contracts::LlmRouteCreateInput;

fn create_input(params: &crate::governance::Params) -> Result<CreateInput, Refusal> {
    let value = params
        .llm_route_create
        .as_ref()
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let input = frozen_creation_input(value)
        .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let valid_hash = |hash: &str| {
        hash.len() == 64
            && hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    };
    if input.provider.id.is_empty()
        || input.provider.revision <= 0
        || !valid_hash(&input.provider.sha256)
        || input.model.id.is_empty()
        || input.model.revision <= 0
        || !valid_hash(&input.model.sha256)
        || input
            .provider_secret_ref
            .as_ref()
            .is_some_and(|reference| reference.locator.is_empty() || reference.audience.is_empty())
    {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    Ok(input)
}

fn provider_version(input: &CreateInput) -> Result<Option<u32>, Refusal> {
    match (
        &input.provider_credential_mode,
        input.provider_secret_ref.as_ref(),
    ) {
        (contracts::LlmProviderCredentialMode::None, None) => Ok(None),
        (contracts::LlmProviderCredentialMode::SecretRef, Some(reference)) => {
            u32::try_from(reference.version)
                .ok()
                .filter(|version| *version > 0)
                .map(Some)
                .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))
        }
        _ => Err(Refusal::Precondition(ReasonCode::InvalidParameters)),
    }
}

// Admission and frozen intents use the same required credential contract.
// An omitted mode or an explicit null is not evidence of provider authentication.
fn frozen_creation_input(value: &Value) -> Result<CreateInput, Refusal> {
    let input: CreateInput = serde_json::from_value(value.clone()).map_err(|_| unavailable())?;
    if input.provider_credential_mode == contracts::LlmProviderCredentialMode::None
        && value.get("providerSecretRef").is_some()
    {
        return Err(unavailable());
    }
    provider_version(&input)?;
    Ok(input)
}

pub(crate) async fn create_target(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    def: &crate::governance::Definition,
    params: &crate::governance::Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<crate::governance::Target, Refusal> {
    if def.target_type != "RESOURCE"
        || def.permission_object_type != "tenant"
        || def.permission != "create"
        || def.tenant_rule != "SESSION_TENANT"
        || def.workspace_rule != "DECLARED_WORKSPACE"
        || def.execution_mode != "SYNC"
        || def.confirmation_mode != "EXPLICIT"
        || def.quota_policy != "NONE"
        || !def.meters.is_empty()
        || def.workflow_kind.is_some()
        || def.approval_policy_id.is_some()
        || def.approval_policy_version.is_some()
        || def.result_exposure != "NONE"
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let capacity_none: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.action_definition
        where action_key=$1 and version=$2
        and capacity_policy='NONE' and capacity_pool_key is null and workflow_type is null)",
    )
    .bind(&def.action_key)
    .bind(def.version)
    .fetch_one(&mut *conn)
    .await?;
    if !capacity_none {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    create_input(params)?;
    if let Some(workspace) = params.workspace_id {
        let active: Option<Uuid> = sqlx::query_scalar(&format!(
            "select id from identity.workspace where id=$1 and tenant_id=$2 and state='ACTIVE'{}",
            if lock { " for update" } else { "" }
        ))
        .bind(workspace)
        .bind(tenant)
        .fetch_optional(&mut *conn)
        .await?;
        if active.is_none() {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
    }
    Ok(crate::governance::Target {
        id: frozen.unwrap_or_else(Uuid::new_v4),
        version: 0,
        workspace_id: params.workspace_id,
    })
}

pub(crate) async fn create_prewrite(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ae: &crate::governance::Execution,
    def: &crate::governance::Definition,
    params: &crate::governance::Params,
) -> Result<(), Refusal> {
    create_input(params)?;
    if !crate::agent_definition::active_owner(tx, ae.tenant_id, ae.initiator_principal_id).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let registered: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.resource_type_definition
        where type_key='llm_route' and status='ACTIVE' and capability_category is null
        and tenant_delete_action_key='tenant.delete')",
    )
    .fetch_one(&mut **tx)
    .await?;
    if !registered {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    sqlx::query("insert into catalog.resource
        (id,tenant_id,type_key,owner_principal_id,home_workspace_id,component_type_key,native_type,native_id,state,version,projection_action_execution_id)
        values($1,$2,'llm_route',$3,$4,$5,'llm.virtualModel',$1::text,'PROVISIONING',1,$6)")
        .bind(ae.target_id).bind(ae.tenant_id).bind(ae.initiator_principal_id)
        .bind(ae.workspace_id).bind(&def.component_type_key).bind(ae.id).execute(&mut **tx).await?;
    sqlx::query(
        "insert into catalog.model_route_projection(resource_id,action_execution_id,source_refs)
        values($1,$2,$3)",
    )
    .bind(ae.target_id)
    .bind(ae.id)
    .bind(params.llm_route_create.as_ref().ok_or_else(unavailable)?)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[derive(FromRow)]
struct Creation {
    source_refs: Value,
    dispatch_started: bool,
    projection_hashes: Option<Value>,
    credential_hash: Option<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize, FromRow)]
pub(crate) struct FrozenCreation {
    resource_id: Uuid,
    resource_version: i32,
    action_execution_id: Uuid,
    source_refs: Value,
    dispatch_started: bool,
    projection_hashes: Option<Value>,
    credential_hash: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct CreationAbsence {
    kind: String,
    id: String,
    revision: Option<i64>,
    absent: bool,
}

/// Includes PROVISIONING intent before a ConfigResource revision exists. No invented revision.
pub(crate) async fn freeze_creations(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
) -> Result<Vec<FrozenCreation>, sqlx::Error> {
    let orphan: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.resource r
        left join catalog.model_route m on m.resource_id=r.id
        left join catalog.model_route_projection p on p.resource_id=r.id
        where r.tenant_id=$1 and r.type_key='llm_route' and r.state<>'DELETED'
        and m.resource_id is null and p.resource_id is null)",
    )
    .bind(tenant)
    .fetch_one(&mut *conn)
    .await?;
    if orphan {
        return Err(sqlx::Error::Protocol(
            "Route 库存缺原生事实和创建意图".into(),
        ));
    }
    sqlx::query_as(
        "select r.id as resource_id,r.version as resource_version,p.action_execution_id,
        p.source_refs,p.dispatch_started,p.projection_hashes,p.credential_hash
        from catalog.resource r join catalog.model_route_projection p on p.resource_id=r.id
        where r.tenant_id=$1 and r.type_key='llm_route' and r.state<>'DELETED'
        order by r.id for update of r,p",
    )
    .bind(tenant)
    .fetch_all(conn)
    .await
}

/// Lifecycle-only qualification for a real, not-yet-materialized create. It never grants CRUD.
pub(crate) async fn pending_owner(
    gov: &crate::governance::Governance,
    conn: &mut sqlx::PgConnection,
    row: &crate::agent_definition::Resource,
) -> Result<bool, Refusal> {
    let Some(action) = row.projection_action_execution_id else {
        return Ok(false);
    };
    if row.state != "PROVISIONING" {
        return Ok(false);
    }
    let refs: Option<Value> = sqlx::query_scalar("select p.source_refs from catalog.model_route_projection p
        join catalog.resource r on r.id=p.resource_id
        join admission.action_execution a on a.id=p.action_execution_id
        where r.id=$1 and r.tenant_id=$2 and r.owner_principal_id=$3 and r.type_key='llm_route'
        and r.projection_action_execution_id=$4 and r.state='PROVISIONING'
        and a.id=$4 and a.tenant_id=r.tenant_id and a.target_id=r.id
        and a.workspace_id is not distinct from r.home_workspace_id
        and a.initiator_principal_id=r.owner_principal_id and a.actor_principal_id=a.initiator_principal_id
        and a.action_key='llm_route.create' and a.gate_state='ALLOWED'
        and a.dispatch_state in ('NOT_DISPATCHED','UNKNOWN')
        and p.source_refs is not distinct from a.parameters->'params'->'llmRouteCreate'
        for update of p")
        .bind(row.id).bind(row.tenant_id).bind(row.owner_principal_id).bind(action)
        .fetch_optional(&mut *conn).await?;
    let Some(refs) = refs else {
        return Ok(false);
    };
    frozen_creation_input(&refs)?;
    if !crate::agent_definition::active_owner(conn, row.tenant_id, row.owner_principal_id).await? {
        return Ok(false);
    }
    if gov
        .spicedb
        .resource_projection_matches_in_workspace(
            &row.id.to_string(),
            &row.tenant_id.to_string(),
            &row.owner_principal_id.to_string(),
            row.home_workspace_id.map(|id| id.to_string()).as_deref(),
            gov.cfg.relationship_page,
        )
        .await
        .map_err(|_| unavailable())?
    {
        return Ok(true);
    }
    let id = row.id.to_string();
    let relations = gov
        .spicedb
        .read_native(
            &crate::spicedb::RelationshipFilter {
                object_type: "resource",
                object_id: Some(&id),
                relation: None,
                subject_principal: None,
            },
            gov.cfg.relationship_page,
        )
        .await
        .map_err(|_| unavailable())?;
    // Empty is a positively observed native set, not an unavailable/partial projection.
    if !relations.is_empty() {
        return Ok(false);
    }
    Gateway::from_env()?.creation_absent(row.id).await
}

pub(crate) async fn retire_creations(
    state: &ServiceState,
    tenant: Uuid,
    frozen: &[FrozenCreation],
) -> Result<Vec<CreationAbsence>, Refusal> {
    let mut tx = state.pool.begin().await?;
    let deleting: Option<bool> =
        sqlx::query_scalar("select state='DELETING' from identity.tenant where id=$1 for update")
            .bind(tenant)
            .fetch_optional(&mut *tx)
            .await?;
    if deleting != Some(true) {
        return Err(conflict());
    }
    let current = freeze_creations(&mut tx, tenant).await?;
    if serde_json::to_value(&current).map_err(|_| unavailable())?
        != serde_json::to_value(frozen).map_err(|_| unavailable())?
    {
        return Err(conflict());
    }
    if current.is_empty() {
        return Ok(Vec::new());
    }
    let mut evidence = Vec::new();
    let gateway = Gateway::from_env()?;
    for intent in current {
        let active_consumer: bool = sqlx::query_scalar("select exists(select 1 from catalog.agent_invocation i
            join catalog.agent_model_binding b on b.installation_resource_id=i.installation_resource_id
            and b.projection_generation=i.projection_generation
            where b.model_route_resource_id=$1 and i.status not in ('COMPLETED','FAILED','CANCELED'))")
            .bind(intent.resource_id).fetch_one(&mut *tx).await?;
        if active_consumer {
            return Err(unavailable());
        }
        let input = frozen_creation_input(&intent.source_refs)?;
        let previous: Option<Value> = sqlx::query_scalar(
            "select retired_absence from catalog.model_route_projection
            where resource_id=$1 and action_execution_id=$2 for update",
        )
        .bind(intent.resource_id)
        .bind(intent.action_execution_id)
        .fetch_one(&mut *tx)
        .await?;
        if let Some(previous) = previous {
            let previous: Vec<CreationAbsence> =
                serde_json::from_value(previous).map_err(|_| unavailable())?;
            let credential_absent = match provider_version(&input)? {
                Some(version) => gateway
                    .admin(
                        &[
                            "api",
                            "config",
                            "provider-credentials",
                            &tenant.to_string(),
                            &intent.resource_id.to_string(),
                            &version.to_string(),
                        ],
                        None,
                    )
                    .await?
                    .is_null(),
                None => true,
            };
            if !gateway.creation_absent(intent.resource_id).await? || !credential_absent {
                return Err(unavailable());
            }
            evidence.extend(previous);
            continue;
        }
        let absent = gateway
            .retire_creation(
                tenant,
                intent.resource_id,
                provider_version(&input)?,
                intent.projection_hashes.as_ref(),
            )
            .await?;
        sqlx::query(
            "update catalog.model_route_projection set retired_absence=$2 where resource_id=$1",
        )
        .bind(intent.resource_id)
        .bind(serde_json::to_value(&absent).map_err(|_| unavailable())?)
        .execute(&mut *tx)
        .await?;
        evidence.extend(absent);
    }
    tx.commit().await?;
    Ok(evidence)
}

async fn creation_abort(
    gov: &crate::governance::Governance,
    mut tx: sqlx::Transaction<'_, sqlx::Postgres>,
    ae: &crate::governance::Execution,
    def: &crate::governance::Definition,
    input: &CreateInput,
) -> Result<(), Refusal> {
    let hashes: Option<Value> = sqlx::query_scalar(
        "select projection_hashes from catalog.model_route_projection
        where resource_id=$1 and action_execution_id=$2 for update",
    )
    .bind(ae.target_id)
    .bind(ae.id)
    .fetch_one(&mut *tx)
    .await?;
    let (gateway, version) =
        match Gateway::from_env().and_then(|gateway| Ok((gateway, provider_version(input)?))) {
            Ok(prepared) => prepared,
            Err(_) => return creation_unknown(tx, ae, def).await,
        };
    let absence = match gateway
        .retire_creation(ae.tenant_id, ae.target_id, version, hashes.as_ref())
        .await
    {
        Ok(absence) => absence,
        Err(_) => return creation_unknown(tx, ae, def).await,
    };
    let token = match gov.spicedb.delete_resource_projection(ae.target_id).await {
        Ok(token) if !token.is_empty() => token,
        _ => return creation_unknown(tx, ae, def).await,
    };
    sqlx::query(
        "update catalog.model_route_projection set retired_absence=$2 where resource_id=$1",
    )
    .bind(ae.target_id)
    .bind(serde_json::to_value(absence).map_err(|_| unavailable())?)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "update catalog.resource set state='DELETED',projection_action_execution_id=null,
        version=version+1 where id=$1 and tenant_id=$2 and projection_action_execution_id=$3",
    )
    .bind(ae.target_id)
    .bind(ae.tenant_id)
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    crate::governance::record_dispatch(
        &mut tx,
        ae.id,
        def.audit_class(),
        Err(axum::http::StatusCode::FORBIDDEN),
        vec![crate::audit::Evidence::new(
            contracts::EvidenceKind::SpicedbZedtoken,
            token,
        )],
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

async fn creation_unknown(
    mut tx: sqlx::Transaction<'_, sqlx::Postgres>,
    ae: &crate::governance::Execution,
    def: &crate::governance::Definition,
) -> Result<(), Refusal> {
    crate::governance::record_dispatch(
        &mut tx,
        ae.id,
        def.audit_class(),
        Err(axum::http::StatusCode::SERVICE_UNAVAILABLE),
        Vec::new(),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

async fn creation_fresh(
    gov: &crate::governance::Governance,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ae: &crate::governance::Execution,
) -> Result<bool, Refusal> {
    if !crate::agent_definition::active_owner(tx, ae.tenant_id, ae.initiator_principal_id).await? {
        return Ok(false);
    }
    let scope = gov
        .spicedb
        .check(
            if ae.workspace_id.is_some() {
                "workspace"
            } else {
                "tenant"
            },
            &ae.workspace_id.unwrap_or(ae.tenant_id).to_string(),
            "create",
            &ae.initiator_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| unavailable())?;
    if scope.zed_token.is_empty() {
        return Err(unavailable());
    }
    if !scope.allowed {
        return Ok(false);
    }
    if let Some(workspace) = ae.workspace_id {
        let active: Option<Uuid> = sqlx::query_scalar(
            "select id from identity.workspace
            where id=$1 and tenant_id=$2 and state='ACTIVE' for update",
        )
        .bind(workspace)
        .bind(ae.tenant_id)
        .fetch_optional(&mut **tx)
        .await?;
        if active.is_none() {
            return Ok(false);
        }
        let membership: Option<String> = sqlx::query_scalar(
            "select state from identity.workspace_membership
            where workspace_id=$1 and tenant_principal_id=$2 for update",
        )
        .bind(workspace)
        .bind(ae.initiator_principal_id)
        .fetch_optional(&mut **tx)
        .await?;
        if membership.as_deref() != Some("ACTIVE") {
            let management = gov
                .spicedb
                .check(
                    if membership.is_some() {
                        "tenant"
                    } else {
                        "workspace"
                    },
                    &if membership.is_some() {
                        ae.tenant_id
                    } else {
                        workspace
                    }
                    .to_string(),
                    "manage",
                    &ae.initiator_principal_id.to_string(),
                    Consistency::FullyConsistent,
                )
                .await
                .map_err(|_| unavailable())?;
            if management.zed_token.is_empty() {
                return Err(unavailable());
            }
            if !management.allowed {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

fn pinned_resource(
    rows: &[Value],
    id: &str,
    revision: i64,
    sha256: &str,
) -> Result<Value, Refusal> {
    let mut matching = rows
        .iter()
        .filter(|row| row.get("id").and_then(Value::as_str) == Some(id));
    let row = matching.next().ok_or_else(conflict)?;
    let body = row.get("value").ok_or_else(unavailable)?;
    if matching.next().is_some()
        || row.get("revision").and_then(Value::as_i64) != Some(revision)
        || digest(body)? != sha256
    {
        return Err(conflict());
    }
    Ok(body.clone())
}

async fn desired_route(
    gateway: &Gateway,
    input: &CreateInput,
    id: Uuid,
    file: Option<&str>,
) -> Result<Vec<Value>, Refusal> {
    let mut provider = pinned_resource(
        &gateway.resources("llm.provider").await?,
        &input.provider.id,
        input.provider.revision,
        &input.provider.sha256,
    )?;
    let mut model = pinned_resource(
        &gateway.resources("llm.model").await?,
        &input.model.id,
        input.model.revision,
        &input.model.sha256,
    )?;
    if file.is_none() && !native_provider_without_auth(&provider) {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    // A supplied key must be the only credential source; native defaults/environment cannot win.
    let provider_object = provider.as_object_mut().ok_or_else(unavailable)?;
    if provider_object
        .get("defaults")
        .is_some_and(|value| !value.is_null())
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let params = provider_object
        .get_mut("params")
        .and_then(Value::as_object_mut)
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let endpoint = params
        .get("baseUrl")
        .and_then(Value::as_str)
        .and_then(|value| reqwest::Url::parse(value).ok())
        .ok_or_else(unavailable)?;
    if !matches!(endpoint.scheme(), "http" | "https")
        || endpoint.host_str().is_none()
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
    {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    if let Some(file) = file {
        params.insert("apiKey".into(), json!({"file":file}));
    }
    let provider_object = provider.as_object_mut().ok_or_else(unavailable)?;
    provider_object.insert("name".into(), json!(id));
    let model_object = model.as_object_mut().ok_or_else(unavailable)?;
    if model_object
        .get("provider")
        .and_then(|value| value.get("reference"))
        .and_then(Value::as_str)
        != Some(&input.provider.id)
        || model_object
            .get("authorization")
            .is_none_or(|value| value.is_null())
        || model_object
            .get("auth")
            .is_some_and(|value| !value.is_null())
        || model_object
            .get("requestHeaders")
            .is_some_and(|value| !value.is_null())
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let model_params = model_object
        .get("params")
        .and_then(Value::as_object)
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    if model_params.keys().any(|key| key != "model")
        || !model_params
            .get("model")
            .and_then(Value::as_str)
            .is_some_and(|model| !model.is_empty() && !model.contains('*'))
    {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    model_object.insert("id".into(), json!(id));
    model_object.insert("name".into(), json!(id));
    model_object.insert("provider".into(), json!({"reference":id}));
    Ok(vec![
        json!({"kind":"llm.provider","value":provider}),
        json!({"kind":"llm.model","value":model}),
        json!({"kind":"llm.virtualModel","value":{"name":id,
            "routing":{"weighted":{"targets":[{"model":id}]}}}}),
    ])
}

// Fixed native Custom providers have no ambient provider credential branch.
// Absence is accepted only in the pinned provider body, never inferred from a missing SecretRef.
fn native_provider_without_auth(provider: &Value) -> bool {
    let Some(object) = provider.as_object() else {
        return false;
    };
    let Some(params) = provider.get("params").and_then(Value::as_object) else {
        return false;
    };
    let Some(kind) = provider.get("provider").and_then(Value::as_object) else {
        return false;
    };
    let Some(custom) = kind.get("custom").and_then(Value::as_object) else {
        return false;
    };
    object
        .keys()
        .all(|key| matches!(key.as_str(), "name" | "params" | "provider" | "defaults"))
        && kind.len() == 1
        && custom
            .keys()
            .all(|key| matches!(key.as_str(), "model" | "provider" | "formats"))
        && custom
            .get("formats")
            .and_then(Value::as_array)
            .is_some_and(|formats| !formats.is_empty())
        && provider.get("defaults").is_none_or(Value::is_null)
        && params.get("apiKey").is_none_or(Value::is_null)
        && params
            .keys()
            .all(|key| matches!(key.as_str(), "baseUrl" | "apiKey" | "model" | "tokenize"))
}

pub(crate) async fn create_dispatch(
    gov: &crate::governance::Governance,
    id: Uuid,
    def: &crate::governance::Definition,
) -> Result<(), Refusal> {
    let mut tx = gov.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, id).await?;
    if ae.gate_state != "ALLOWED"
        || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
    {
        return Ok(());
    }
    let active: Option<bool> =
        sqlx::query_scalar("select state='ACTIVE' from identity.tenant where id=$1 for update")
            .bind(ae.tenant_id)
            .fetch_optional(&mut *tx)
            .await?;
    let resource: Option<Uuid> = sqlx::query_scalar(
        "select id from catalog.resource
        where id=$1 and tenant_id=$2 and type_key='llm_route' and state='PROVISIONING'
        and owner_principal_id=$3 and home_workspace_id is not distinct from $4
        and projection_action_execution_id=$5 for update",
    )
    .bind(ae.target_id)
    .bind(ae.tenant_id)
    .bind(ae.initiator_principal_id)
    .bind(ae.workspace_id)
    .bind(ae.id)
    .fetch_optional(&mut *tx)
    .await?;
    let intent: Creation = sqlx::query_as("select source_refs,dispatch_started,projection_hashes,credential_hash
        from catalog.model_route_projection where resource_id=$1 and action_execution_id=$2 for update")
        .bind(ae.target_id).bind(ae.id).fetch_one(&mut *tx).await?;
    if resource.is_none() {
        return if intent.dispatch_started {
            creation_unknown(tx, &ae, def).await
        } else {
            Err(conflict())
        };
    }
    // Configuration/SecretRef failure cannot prove that a previous native write
    // did not happen. Only an intent that has never dispatched may return it directly.
    let prepared: Result<(CreateInput, Gateway, Option<u32>), Refusal> = async {
        let input = frozen_creation_input(&intent.source_refs)?;
        let gateway = Gateway::from_env()?;
        let version = provider_version(&input)?;
        // The configured Tenant namespace/mount is the frozen SecretRef scope authority.
        if let Some(reference) = input.provider_secret_ref.as_ref() {
            let tenant_prefix = gov.secrets.tenant_locator(ae.tenant_id, "");
            let same_tenant_path =
                reference
                    .locator
                    .strip_prefix(&tenant_prefix)
                    .is_some_and(|path| {
                        !path.is_empty()
                            && path.split('/').all(|segment| {
                                !segment.is_empty() && segment != "." && segment != ".."
                            })
                            && !path.bytes().any(|byte| {
                                byte.is_ascii_control()
                                    || matches!(byte, b'\\' | b'%' | b'?' | b'#')
                            })
                    });
            let audience = std::env::var("OPENBAO_SERVICE_IDENTITY").map_err(|_| unavailable())?;
            if !same_tenant_path || reference.audience != audience {
                return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
            }
        }
        Ok((input, gateway, version))
    }
    .await;
    let (input, gateway, version) = match prepared {
        Ok(prepared) => prepared,
        Err(_) if intent.dispatch_started => return creation_unknown(tx, &ae, def).await,
        Err(error) => return Err(error),
    };
    let mut planned = intent.projection_hashes;
    let mut credential_hash = intent.credential_hash;
    let fresh = if active == Some(true) {
        creation_fresh(gov, &mut tx, &ae).await
    } else {
        Ok(false)
    };
    match fresh {
        Ok(true) => {}
        _ if intent.dispatch_started => return creation_unknown(tx, &ae, def).await,
        Ok(false) => return creation_abort(gov, tx, &ae, def, &input).await,
        Err(error) => return Err(error),
    }
    // Recovery must prove the same exact version is still auditably readable;
    // a matching Gateway projection alone cannot establish SecretRef readiness.
    let readable: Result<Option<SecretValue>, Refusal> = async {
        let (Some(reference), Some(version)) = (input.provider_secret_ref.as_ref(), version) else {
            return Ok(None);
        };
        if gov
            .audit
            .enabled_devices()
            .await
            .map_err(|_| unavailable())?
            == 0
        {
            return Err(unavailable());
        }
        let secret = gov
            .secrets
            .read(
                &SecretRef {
                    locator: reference.locator.clone(),
                    version,
                    audience: reference.audience.clone(),
                },
                "value",
            )
            .await
            .map_err(|_| unavailable())?;
        if secret.expose().is_empty() {
            return Err(unavailable());
        }
        Ok(Some(secret))
    }
    .await;
    let secret = match readable {
        Ok(secret) => secret,
        Err(_) if intent.dispatch_started => return creation_unknown(tx, &ae, def).await,
        Err(error) => return Err(error),
    };
    let hash = secret
        .as_ref()
        .map(|secret| hex::encode(Sha256::digest(secret.expose().as_bytes())));
    if intent.dispatch_started && credential_hash != hash {
        return creation_unknown(tx, &ae, def).await;
    }
    if !intent.dispatch_started {
        let file = version
            .map(|version| gateway.credential_file(ae.tenant_id, ae.target_id, version))
            .transpose()?;
        let desired = desired_route(&gateway, &input, ae.target_id, file.as_deref()).await?;
        let hashes = desired
            .iter()
            .map(|resource| {
                Ok((
                    resource["kind"]
                        .as_str()
                        .ok_or_else(unavailable)?
                        .to_owned(),
                    Value::String(digest(&resource["value"])?),
                ))
            })
            .collect::<Result<serde_json::Map<String, Value>, Refusal>>()?;
        sqlx::query(
            "update catalog.model_route_projection set dispatch_started=true,projection_hashes=$2,
            credential_hash=$3 where resource_id=$1 and not dispatch_started",
        )
        .bind(ae.target_id)
        .bind(Value::Object(hashes.clone()))
        .bind(&hash)
        .execute(&mut *tx)
        .await?;
        // Intent survives a crash before either native write. After this point UNKNOWN only observes.
        tx.commit().await?;
        tx = gov.pool.begin().await?;
        let locked = crate::governance::lock_execution(&mut tx, ae.id).await?;
        let tenant: Option<bool> =
            sqlx::query_scalar("select state='ACTIVE' from identity.tenant where id=$1 for update")
                .bind(ae.tenant_id)
                .fetch_optional(&mut *tx)
                .await?;
        let fresh = if locked.gate_state == "ALLOWED" && tenant == Some(true) {
            creation_fresh(gov, &mut tx, &ae).await
        } else {
            Ok(false)
        };
        match fresh {
            Ok(true) => {}
            Ok(false) => return creation_abort(gov, tx, &ae, def, &input).await,
            Err(_) => return creation_unknown(tx, &ae, def).await,
        }
        let projected = gov
            .spicedb
            .replace_resource_projection(
                &ae.target_id.to_string(),
                &ae.tenant_id.to_string(),
                &ae.initiator_principal_id.to_string(),
                &ae.initiator_principal_id.to_string(),
                ae.workspace_id.map(|id| id.to_string()).as_deref(),
            )
            .await;
        let credential = match (projected.is_ok(), version, secret.as_ref(), hash.as_deref()) {
            (true, Some(version), Some(secret), Some(hash)) => {
                gateway
                    .project_credential(ae.tenant_id, ae.target_id, version, secret, hash)
                    .await
            }
            (true, None, None, None) => Ok(()),
            _ => Err(unavailable()),
        };
        if credential.is_err()
            || gateway
                .admin(
                    &["api", "config", "routes", &ae.target_id.to_string()],
                    Some(Value::Array(desired)),
                )
                .await
                .is_err()
        {
            return creation_unknown(tx, &ae, def).await;
        }
        planned = Some(Value::Object(hashes));
        credential_hash = hash;
    }
    let Some(planned) = planned.as_ref() else {
        return creation_unknown(tx, &ae, def).await;
    };
    let observed = match gateway
        .observe_creation(
            ae.tenant_id,
            ae.target_id,
            version,
            planned,
            credential_hash.as_deref(),
        )
        .await
    {
        Ok(Some(observed)) => observed,
        _ => return creation_unknown(tx, &ae, def).await,
    };
    let projected = match gov
        .spicedb
        .resource_projection_matches_in_workspace(
            &ae.target_id.to_string(),
            &ae.tenant_id.to_string(),
            &ae.initiator_principal_id.to_string(),
            ae.workspace_id.map(|id| id.to_string()).as_deref(),
            gov.cfg.relationship_page,
        )
        .await
    {
        Ok(projected) => projected,
        Err(_) => return creation_unknown(tx, &ae, def).await,
    };
    if !projected || active != Some(true) {
        return creation_unknown(tx, &ae, def).await;
    }
    match creation_fresh(gov, &mut tx, &ae).await {
        Ok(true) => {}
        _ => return creation_unknown(tx, &ae, def).await,
    }
    let proof = match gov
        .spicedb
        .check(
            "resource",
            &ae.target_id.to_string(),
            "read",
            &ae.initiator_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
    {
        Ok(proof) => proof,
        Err(_) => return creation_unknown(tx, &ae, def).await,
    };
    if !proof.allowed || proof.zed_token.is_empty() {
        return creation_unknown(tx, &ae, def).await;
    }
    sqlx::query("insert into catalog.model_route(resource_id,action_execution_id,native_revision,native_config_hash)
        values($1,$2,$3,$4)").bind(ae.target_id).bind(ae.id).bind(observed.0).bind(observed.1)
        .execute(&mut *tx).await?;
    sqlx::query("update catalog.resource set state='ACTIVE',version=version+1,projection_action_execution_id=null
        where id=$1 and tenant_id=$2 and projection_action_execution_id=$3")
        .bind(ae.target_id).bind(ae.tenant_id).bind(ae.id).execute(&mut *tx).await?;
    crate::governance::record_dispatch(
        &mut tx,
        ae.id,
        def.audit_class(),
        Ok(()),
        vec![crate::audit::Evidence::new(
            contracts::EvidenceKind::SpicedbZedtoken,
            proof.zed_token,
        )],
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// SecretRef 只传 Core 内部，不能序列化到客户端、Workflow 或配置文件。
pub(crate) struct RuntimeModel {
    pub model: String,
    pub gateway_base_url: String,
    pub secret_ref: SecretRef,
}

/// DD-99：现有 TenantLifecycleSnapshot 的平台库存；这里只保存引用，不保存 key/config 正文。
#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize, FromRow)]
pub(crate) struct FrozenCredential {
    pub installation_resource_id: Uuid,
    pub projection_generation: i64,
    pub workspace_id: Uuid,
    pub agent_principal_id: Uuid,
    pub action_execution_id: Uuid,
    pub gateway_principal_id: Uuid,
    pub secret_locator: String,
    pub secret_version: Option<i32>,
    pub secret_audience: String,
    pub secret_status: String,
    pub native_dispatch_started: bool,
    pub native_key_id: Option<String>,
    pub native_key_revision: Option<i64>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct FrozenRoute {
    pub resource_id: Uuid,
    pub native_id: String,
    pub resource_version: i32,
    pub native_revision: i64,
    pub native_config_hash: String,
    pub credentials: Vec<FrozenCredential>,
}

/// 与已有 Tenant 销毁库存同一快照调用；该函数不激活类型或创建 Resource。
pub(crate) async fn freeze(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
) -> Result<Vec<FrozenRoute>, sqlx::Error> {
    let orphaned: bool = sqlx::query_scalar("select exists(select 1 from catalog.agent_model_binding b
        left join catalog.agent_installation i on i.resource_id=b.installation_resource_id
        left join catalog.resource ir on ir.id=b.installation_resource_id
        left join catalog.model_route m on m.resource_id=b.model_route_resource_id
        left join catalog.resource mr on mr.id=m.resource_id
        where (ir.tenant_id=$1 or mr.tenant_id=$1)
          and (i.resource_id is null or m.resource_id is null or mr.tenant_id is distinct from ir.tenant_id))")
        .bind(tenant).fetch_one(&mut *conn).await?;
    if orphaned {
        return Err(sqlx::Error::Protocol("模型凭据库存归属不完整".into()));
    }
    let routes: Vec<(Uuid, String, i32, i64, String)> = sqlx::query_as(
        "select r.id,r.native_id,r.version,m.native_revision,m.native_config_hash
         from catalog.resource r join catalog.model_route m on m.resource_id=r.id
         where r.tenant_id=$1 and r.type_key='llm_route' order by r.id for update of r,m",
    )
    .bind(tenant)
    .fetch_all(&mut *conn)
    .await?;
    let mut frozen = Vec::with_capacity(routes.len());
    for (resource_id, native_id, resource_version, native_revision, native_config_hash) in routes {
        let credentials = sqlx::query_as(FROZEN_CREDENTIALS)
            .bind(resource_id)
            .fetch_all(&mut *conn)
            .await?;
        frozen.push(FrozenRoute {
            resource_id,
            native_id,
            resource_version,
            native_revision,
            native_config_hash,
            credentials,
        });
    }
    Ok(frozen)
}

const FROZEN_CREDENTIALS: &str = "select b.installation_resource_id,b.projection_generation,
    i.workspace_id,i.agent_principal_id,b.action_execution_id,b.gateway_principal_id,b.secret_locator,b.secret_version,
    b.secret_audience,b.secret_status,b.native_dispatch_started,b.native_key_id,b.native_key_revision
    from catalog.agent_model_binding b join catalog.agent_installation i on i.resource_id=b.installation_resource_id
    where b.model_route_resource_id=$1 order by b.installation_resource_id,b.projection_generation for update of b";

#[derive(serde::Serialize)]
pub(crate) struct NativeAbsence {
    pub kind: String,
    pub id: String,
    pub revision: i64,
    pub absent: bool,
}

/// 原 TENANT_LIFECYCLE drain 之后消费 frozen 库存；返回的只有已查证不存在的 native ID。
/// SecretRef 先 SUPERSEDED，真正销毁/REVOKED 仍由原 Tenant OpenBao namespace 删除证据决定。
pub(crate) async fn retire(
    state: &ServiceState,
    tenant: Uuid,
    route: &FrozenRoute,
) -> Result<Vec<NativeAbsence>, Refusal> {
    let exists: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.resource r
        join catalog.model_route m on m.resource_id=r.id
        join identity.tenant t on t.id=r.tenant_id where r.id=$1 and r.tenant_id=$2
          and r.type_key='llm_route' and r.native_id=$3 and r.version=$4
          and m.native_revision=$5 and m.native_config_hash=$6 and t.state='DELETING')",
    )
    .bind(route.resource_id)
    .bind(tenant)
    .bind(&route.native_id)
    .bind(route.resource_version)
    .bind(route.native_revision)
    .bind(&route.native_config_hash)
    .fetch_one(&state.pool)
    .await?;
    if !exists {
        return Err(conflict());
    }
    let current: Vec<FrozenCredential> = sqlx::query_as(FROZEN_CREDENTIALS)
        .bind(route.resource_id)
        .fetch_all(&state.pool)
        .await?;
    if current.len() != route.credentials.len() {
        return Err(conflict());
    }
    // Only SUPERSEDED and a previously unknown native response may advance during retirement.
    for (current, frozen) in current.iter().zip(&route.credentials) {
        if !matches!(
            current.secret_status.as_str(),
            "PENDING" | "ACTIVE" | "SUPERSEDED"
        ) {
            return Err(unavailable());
        }
        if current.secret_status != frozen.secret_status
            && !(matches!(frozen.secret_status.as_str(), "PENDING" | "ACTIVE")
                && current.secret_status == "SUPERSEDED")
        {
            return Err(conflict());
        }
        let mut current = current.clone();
        let frozen = frozen.clone();
        current.secret_status.clone_from(&frozen.secret_status);
        if frozen.native_dispatch_started
            && frozen.native_key_id.is_none()
            && current.native_key_id.is_some()
            && current.native_key_revision.is_some()
        {
            current.native_key_id = None;
            current.native_key_revision = None;
        }
        if current != frozen {
            return Err(conflict());
        }
    }
    let gateway = Gateway::from_env()?;
    let mut deleted = Vec::new();
    for credential in &current {
        let busy: bool = sqlx::query_scalar(
            "select exists(select 1 from catalog.agent_invocation
            where installation_resource_id=$1 and projection_generation=$2
              and status not in ('COMPLETED','FAILED','CANCELED'))",
        )
        .bind(credential.installation_resource_id)
        .bind(credential.projection_generation)
        .fetch_one(&state.pool)
        .await?;
        if busy {
            return Err(unavailable());
        }
        let secret = match credential.secret_version {
            Some(version) => {
                let expected = state.secrets.tenant_locator(
                    tenant,
                    &format!(
                        "llm-route/{}/{}/{}",
                        route.resource_id,
                        credential.installation_resource_id,
                        credential.projection_generation
                    ),
                );
                if expected != credential.secret_locator {
                    return Err(conflict());
                }
                let reference = SecretRef {
                    locator: expected,
                    version: u32::try_from(version).map_err(|_| unavailable())?,
                    audience: credential.secret_audience.clone(),
                };
                Some(
                    state
                        .secrets
                        .read(&reference, "value")
                        .await
                        .map_err(|_| unavailable())?,
                )
            }
            None if !credential.native_dispatch_started => None,
            None => return Err(unavailable()),
        };
        let desired = secret.as_ref().map(|secret| {
            key_projection(
                &route.native_id,
                tenant,
                credential.workspace_id,
                credential.agent_principal_id,
                credential.gateway_principal_id,
                (
                    credential.installation_resource_id,
                    credential.projection_generation,
                ),
                secret,
            )
        });
        let stored = if let Some(desired) = desired.as_ref() {
            gateway.find_key(desired).await?
        } else {
            gateway
                .require_key_absent(tenant, credential, None, None)
                .await?;
            None
        };
        if let Some((id, revision)) = stored {
            if credential
                .native_key_id
                .as_deref()
                .is_some_and(|frozen| frozen != id)
                || credential
                    .native_key_revision
                    .is_some_and(|frozen| frozen != revision)
            {
                return Err(conflict());
            }
            // Persist an observed response before deletion; replay must not lose a recovered random ID.
            sqlx::query(
                "update catalog.agent_model_binding set native_key_id=$3,native_key_revision=$4
                where installation_resource_id=$1 and projection_generation=$2
                  and native_dispatch_started and native_key_id is null",
            )
            .bind(credential.installation_resource_id)
            .bind(credential.projection_generation)
            .bind(&id)
            .bind(revision)
            .execute(&state.pool)
            .await?;
            gateway.delete("llm.apiKey", &id).await?;
            deleted.push(NativeAbsence {
                kind: "llm.apiKey".into(),
                id,
                revision,
                absent: true,
            });
        } else if let Some((id, revision)) = credential
            .native_key_id
            .clone()
            .zip(credential.native_key_revision)
        {
            deleted.push(NativeAbsence {
                kind: "llm.apiKey".into(),
                id,
                revision,
                absent: true,
            });
        }
        if let Some(desired) = desired.as_ref() {
            if gateway.find_key(desired).await?.is_some() {
                return Err(unavailable());
            }
        }
        gateway
            .require_key_absent(tenant, credential, desired.as_ref(), secret.as_ref())
            .await?;
        if let Some(secret) = secret.as_ref() {
            gateway.require_key_rejected(secret).await?;
        }
        sqlx::query("update catalog.agent_model_binding set secret_status='SUPERSEDED'
            where installation_resource_id=$1 and projection_generation=$2 and secret_status in ('PENDING','ACTIVE')")
            .bind(credential.installation_resource_id).bind(credential.projection_generation)
            .execute(&state.pool).await?;
    }
    let native = gateway.resources("llm.virtualModel").await?;
    let matches: Vec<_> = native
        .iter()
        .filter(|r| r.get("id").and_then(Value::as_str) == Some(route.native_id.as_str()))
        .collect();
    if matches.len() > 1 {
        return Err(unavailable());
    }
    if let Some(row) = matches.first() {
        if row.get("revision").and_then(Value::as_i64) != Some(route.native_revision)
            || digest(row.get("value").ok_or_else(unavailable)?)? != route.native_config_hash
        {
            return Err(conflict());
        }
        gateway.delete("llm.virtualModel", &route.native_id).await?;
    }
    if gateway
        .resources("llm.virtualModel")
        .await?
        .iter()
        .any(|r| r.get("id").and_then(Value::as_str) == Some(route.native_id.as_str()))
    {
        return Err(unavailable());
    }
    let effective = gateway.admin(&["api", "config", "effective"], None).await?;
    if effective
        .pointer("/llm/virtualModels")
        .is_some_and(|models| {
            models.as_array().is_none_or(|models| {
                models.iter().any(|r| {
                    r.get("name").and_then(Value::as_str) == Some(route.native_id.as_str())
                })
            })
        })
    {
        return Err(unavailable());
    }
    deleted.push(NativeAbsence {
        kind: "llm.virtualModel".into(),
        id: route.native_id.clone(),
        revision: route.native_revision,
        absent: true,
    });
    Ok(deleted)
}

#[derive(PartialEq, FromRow)]
struct Route {
    tenant_id: Uuid,
    owner_principal_id: Uuid,
    home_workspace_id: Option<Uuid>,
    native_id: String,
    resource_version: i32,
    native_revision: i64,
    native_config_hash: String,
    creation_source_refs: Option<Value>,
    creation_hashes: Option<Value>,
    credential_hash: Option<String>,
}

#[derive(FromRow)]
struct Binding {
    gateway_principal_id: Uuid,
    secret_locator: String,
    secret_version: Option<i32>,
    secret_audience: String,
    secret_status: String,
    native_dispatch_started: bool,
    native_key_id: Option<String>,
    native_key_revision: Option<i64>,
}

fn unavailable() -> Refusal {
    Refusal::Unavailable("模型原生投影或凭据查证未闭合".into())
}

fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}

fn metering_refusal(error: crate::openmeter::Error) -> Refusal {
    use crate::openmeter::Error;
    match error {
        Error::Denied => Refusal::Denied(ReasonCode::PermissionDenied),
        Error::Precondition => Refusal::Precondition(ReasonCode::BindingNotActive),
        Error::Conflict => conflict(),
        Error::Limit => Refusal::Limit(ReasonCode::RateLimited),
        Error::Unknown => Refusal::Unavailable("OpenMeter subject 结果不可查证".into()),
    }
}

async fn subject_audit(
    state: &ServiceState,
    context: &crate::platform_keys::ActionAuditContext,
    tenant: Uuid,
    action: Uuid,
    event_key: String,
    result: &str,
) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    let target_type = context.target_type.as_deref().ok_or_else(unavailable)?;
    let exposure = context.result_exposure.as_deref().ok_or_else(unavailable)?;
    crate::audit::append(
        &mut tx,
        crate::audit::AuditEntry {
            event_key,
            tenant_id: Some(tenant),
            workspace_id: context.workspace_id,
            operation_id: context.operation_id,
            event_type: if result == "DISPATCH_RESULT_UNKNOWN" {
                "DISPATCH"
            } else {
                "RECONCILIATION"
            },
            human_identity_id: None,
            initiator_principal_id: Some(context.initiator_principal_id),
            actor_principal_id: Some(context.actor_principal_id),
            action_key: &context.action_key,
            action_version: context.action_version,
            component_type_key: "openmeter",
            target_type: Some(target_type),
            target_id: Some(context.target_id),
            parameter_hash: &context.parameter_hash,
            decision: if result == "EXTERNAL_RESULT_UNKNOWN" {
                "UNKNOWN"
            } else {
                "ALLOW"
            },
            result_code: result,
            result_exposure: exposure,
            evidence_refs: vec![crate::audit::Evidence::new(
                contracts::EvidenceKind::ActionExecutionId,
                action,
            )],
            correlation_id: context.correlation_id,
        },
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// DD-38：已有安装 projection 的副作用依赖，不创建 Invocation 或商业账本。
/// lifecycle 保留 Tenant 锁，Core-only 身份只允许此受治理写者；native PUT 没有 CAS。
pub(crate) async fn ensure_usage_subject(
    state: &ServiceState,
    lifecycle: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: Uuid,
    workspace: Option<Uuid>,
    installation: Uuid,
    action: Uuid,
) -> Result<(), Refusal> {
    let binding: Option<(String, String, String, String, i32)> = sqlx::query_as(
        "select namespace,customer_id,subject_key_prefix,status,version
        from projection.openmeter_binding where tenant_id=$1 for no key update",
    )
    .bind(tenant)
    .fetch_optional(&mut **lifecycle)
    .await?;
    let (namespace, customer, prefix, status, version) =
        binding.ok_or(Refusal::Precondition(ReasonCode::BindingNotActive))?;
    if namespace != state.openmeter.namespace()
        || prefix != format!("{tenant}:")
        || status != "ACTIVE"
        || version <= 0
    {
        return Err(conflict());
    }
    let context = crate::platform_keys::action_audit_context(lifecycle, action, tenant).await?;
    if context.target_id != installation
        || context.workspace_id != workspace
        || !matches!(
            context.action_key.as_str(),
            "agent.installation.create" | "application_binding.create"
        )
    {
        return Err(conflict());
    }
    let base = format!(
        "{}:openmeter:customer:{customer}:subject:{installation}",
        context.operation_id
    );
    let dispatch_prefix = format!("{base}:dispatch:");
    let attempts: Vec<String> = sqlx::query_scalar(
        "select event_key from audit.audit_event where tenant_id=$1 and operation_id=$2
        and event_key like $3 order by event_key",
    )
    .bind(tenant)
    .bind(context.operation_id)
    .bind(format!("{dispatch_prefix}%"))
    .fetch_all(&mut **lifecycle)
    .await?;
    if attempts.len() > 1 {
        return Err(unavailable());
    }
    // Unreconciled replace blocks later subject writes under the same Customer lock.
    // Otherwise a second add could erase the first attempt's exact recovery comparison.
    let pending: Vec<String> = sqlx::query_scalar(
        "select d.event_key from audit.audit_event d where d.tenant_id=$1 and d.event_key like $2
        and not exists(select 1 from audit.audit_event v where v.tenant_id=d.tenant_id
          and v.event_key=replace(d.event_key,':dispatch:',':verified:'))",
    )
    .bind(tenant)
    .bind(format!(
        "%:openmeter:customer:{customer}:subject:%:dispatch:%"
    ))
    .fetch_all(&mut **lifecycle)
    .await?;
    if pending.iter().any(|key| !attempts.contains(key)) {
        return Err(unavailable());
    }
    let projection = match state
        .openmeter
        .subject_projection(tenant, &customer, installation)
        .await
    {
        Ok(projection) => projection,
        Err(error) if attempts.is_empty() => return Err(metering_refusal(error)),
        Err(_) => {
            subject_audit(
                state,
                &context,
                tenant,
                action,
                format!("{base}:unknown"),
                "EXTERNAL_RESULT_UNKNOWN",
            )
            .await?;
            return Err(unavailable());
        }
    };
    let hash = projection.digest(&namespace).map_err(metering_refusal)?;
    let dispatch_key = format!("{dispatch_prefix}{hash}");
    let verified_key = format!("{base}:verified:{hash}");
    if let Some(previous) = attempts.first() {
        let previous_verified: bool = sqlx::query_scalar(
            "select exists(select 1 from audit.audit_event where tenant_id=$1 and operation_id=$2 and event_key=$3)")
            .bind(tenant).bind(context.operation_id).bind(previous.replace(":dispatch:", ":verified:"))
            .fetch_one(&mut **lifecycle).await?;
        // Earlier verified writes remain evidence when another legitimate installation
        // later adds a subject. A lost subject is never repaired by replaying old PUT.
        if projection.needs_write() || !previous_verified && previous != &dispatch_key {
            subject_audit(
                state,
                &context,
                tenant,
                action,
                format!("{base}:unknown"),
                "EXTERNAL_RESULT_UNKNOWN",
            )
            .await?;
            return Err(unavailable());
        }
    } else if projection.needs_write() {
        // Commit only native references/digest, not Customer contact/billing fields.
        subject_audit(
            state,
            &context,
            tenant,
            action,
            dispatch_key,
            "DISPATCH_RESULT_UNKNOWN",
        )
        .await?;
        // A transport error is not a failed write: only native readback decides.
        let _write_result = state.openmeter.write_subject_projection(&projection).await;
    }
    if state
        .openmeter
        .verify_subject_projection(&projection)
        .await
        .is_err()
    {
        subject_audit(
            state,
            &context,
            tenant,
            action,
            format!("{base}:unknown"),
            "EXTERNAL_RESULT_UNKNOWN",
        )
        .await?;
        return Err(unavailable());
    }
    subject_audit(state, &context, tenant, action, verified_key, "ACTIVE").await
}

const ROUTE: &str = "select r.tenant_id,r.owner_principal_id,r.home_workspace_id,r.native_id,
    r.version as resource_version,m.native_revision,m.native_config_hash,
    p.source_refs as creation_source_refs,p.projection_hashes as creation_hashes,p.credential_hash
    from catalog.resource r join catalog.model_route m on m.resource_id=r.id
    left join catalog.model_route_projection p on p.resource_id=r.id
    join catalog.resource_type_definition rt on rt.type_key=r.type_key and rt.status='ACTIVE'
      and rt.tenant_delete_action_key='tenant.delete'
    join identity.tenant t on t.id=r.tenant_id and t.state='ACTIVE'
    join identity.principal o on o.id=r.owner_principal_id and o.tenant_id=t.id
      and o.kind='HUMAN' and o.status='ACTIVE'
    join identity.tenant_membership om on om.tenant_principal_id=o.id
      and om.tenant_id=t.id and om.state='ACTIVE'
    where r.id=$1 and r.tenant_id=$2 and r.type_key='llm_route' and r.state='ACTIVE'
      and r.projection_action_execution_id is null";

/// Version 发布与 Installation readiness 共用原 Route/native 投影事实。
/// ConfigResource 存在不注册 llm_route，也不替代 revision/hash/effective 查证。
pub(crate) async fn validate_reference(
    governance: &crate::governance::Governance,
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    human: Uuid,
    id: Uuid,
) -> Result<(), Refusal> {
    let route: Route = sqlx::query_as(ROUTE)
        .bind(id)
        .bind(tenant)
        .fetch_optional(conn)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::BindingNotActive))?;
    if !governance
        .spicedb
        .resource_projection_matches_in_workspace(
            &id.to_string(),
            &tenant.to_string(),
            &route.owner_principal_id.to_string(),
            route
                .home_workspace_id
                .map(|workspace| workspace.to_string())
                .as_deref(),
            governance.cfg.relationship_page,
        )
        .await
        .map_err(|_| unavailable())?
    {
        return Err(unavailable());
    }
    let checked = governance
        .spicedb
        .check(
            "resource",
            &id.to_string(),
            "read",
            &human.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| unavailable())?;
    if checked.zed_token.is_empty() {
        return Err(unavailable());
    }
    if !checked.allowed {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    Gateway::from_env()?.check_route(&route).await
}

/// 同一已有 Installation projection 的凭据生产；没有新 Action/Workflow 权威。
/// 外部 key 创建先写持久 intent。原生 ID 随机，回应丢失只按摘要/scope 查证，
/// 不重发 PUT；未找到确定结果就保持 PENDING，交原 projection 对账。
pub(crate) async fn provision(
    state: &ServiceState,
    installation: Uuid,
    version: Uuid,
    generation: i64,
    action: Uuid,
) -> Result<RuntimeModel, Refusal> {
    let (route_id, tenant, workspace, agent) =
        installation_scope(state, installation, version, generation, Some(action)).await?;
    // Tenant/Workspace 生命周期锁与下方真实 membership 锁共同覆盖外部授信。
    // NO KEY UPDATE 仍阻止状态修改，并允许内层 intent 的外键 KEY SHARE 检查。
    let mut lifecycle = state.pool.begin().await?;
    let active: bool = sqlx::query_scalar(
        "select state='ACTIVE' from identity.tenant where id=$1 for no key update",
    )
    .bind(tenant)
    .fetch_one(&mut *lifecycle)
    .await?;
    if !active {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let workspace_active: bool = sqlx::query_scalar(
        "select state='ACTIVE' from identity.workspace
        where id=$1 and tenant_id=$2 for no key update",
    )
    .bind(workspace)
    .bind(tenant)
    .fetch_one(&mut *lifecycle)
    .await?;
    if !workspace_active {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    installation_scope(state, installation, version, generation, Some(action)).await?;
    let (owner,initiator):(Uuid,Uuid)=sqlx::query_as("select r.owner_principal_id,ae.initiator_principal_id
        from catalog.resource r join admission.action_execution ae on ae.id=r.projection_action_execution_id
        where r.id=$1 and r.tenant_id=$2 and r.home_workspace_id=$3 and r.state='PROVISIONING'
          and ae.id=$4 and ae.tenant_id=r.tenant_id and ae.workspace_id=r.home_workspace_id
          and ae.target_id=r.id and ae.actor_principal_id=ae.initiator_principal_id
          and ae.gate_state='ALLOWED' and ae.dispatch_state='DISPATCHED'
          and ae.action_key='agent.installation.create'
        for no key update of r")
        .bind(installation).bind(tenant).bind(workspace).bind(action)
        .fetch_optional(&mut *lifecycle).await?.ok_or_else(conflict)?;
    let route: Route = sqlx::query_as(&format!("{ROUTE} for no key update of r,m"))
        .bind(route_id)
        .bind(tenant)
        .fetch_optional(&mut *lifecycle)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::BindingNotActive))?;
    let mut humans = vec![owner, initiator, route.owner_principal_id];
    humans.sort_unstable();
    humans.dedup();
    for human in humans {
        if !crate::agent_definition::active_owner(&mut lifecycle, tenant, human).await? {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
    }
    // 17 §6 的安装 Model binding，不是 Version 引用或 asset.consume 的隐式授权。
    // 原安装 AE 已持久冻结 scope/version/AGENT；发起 HUMAN 必须仍有执行与分享权。
    let human_route = checked_route(
        state,
        route_id,
        tenant,
        workspace,
        initiator,
        Consistency::FullyConsistent,
    )
    .await?;
    if human_route != route {
        return Err(conflict());
    }
    let shared = state
        .governance
        .spicedb
        .check(
            "resource",
            &route_id.to_string(),
            "share",
            &initiator.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| unavailable())?;
    if shared.zed_token.is_empty() {
        return Err(unavailable());
    }
    if !shared.allowed {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    crate::service_api::audit_gate(state)
        .await
        .map_err(|_| unavailable())?;
    ensure_usage_subject(
        state,
        &mut lifecycle,
        tenant,
        Some(workspace),
        installation,
        action,
    )
    .await?;
    let written = state
        .governance
        .spicedb
        .write(&["executor", "discoverer"].map(|relation| {
            (
                Write::Touch,
                Relationship {
                    object_type: "resource".into(),
                    object_id: route_id.to_string(),
                    relation: relation.into(),
                    subject_principal: agent.to_string(),
                },
            )
        }))
        .await
        .map_err(|_| unavailable())?;
    if written.is_empty() {
        return Err(unavailable());
    }
    let bound_route = checked_route(
        state,
        route_id,
        tenant,
        workspace,
        agent,
        Consistency::AtLeastAsFresh(&written),
    )
    .await?;
    if bound_route != route {
        return Err(conflict());
    }
    let gateway = Gateway::from_env()?;
    gateway.check_route(&route).await?;
    gateway.check_authentication().await?;
    let audience = std::env::var("OPENBAO_SERVICE_IDENTITY")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(unavailable)?;
    let locator = state.secrets.tenant_locator(
        tenant,
        &format!("llm-route/{route_id}/{installation}/{generation}"),
    );
    let principal = Uuid::new_v5(&Uuid::NAMESPACE_OID, locator.as_bytes());
    let mut intent = state.pool.begin().await?;
    // Registered SERVICE identity is only the restricted gateway caller, never actor/owner.
    sqlx::query(
        "insert into identity.principal(id,tenant_id,kind,status)
        values($1,$2,'SERVICE','ACTIVE') on conflict do nothing",
    )
    .bind(principal)
    .bind(tenant)
    .execute(&mut *intent)
    .await?;
    sqlx::query(
        "insert into identity.service_principal(principal_id,audience)
        values($1,$1::text) on conflict do nothing",
    )
    .bind(principal)
    .execute(&mut *intent)
    .await?;
    sqlx::query(
        "insert into catalog.agent_model_binding
        (installation_resource_id,projection_generation,model_route_resource_id,
         action_execution_id,secret_locator,secret_audience,gateway_principal_id,secret_status)
        values($1,$2,$3,$4,$5,$6,$7,'PENDING') on conflict do nothing",
    )
    .bind(installation)
    .bind(generation)
    .bind(route_id)
    .bind(action)
    .bind(&locator)
    .bind(&audience)
    .bind(principal)
    .execute(&mut *intent)
    .await?;
    intent.commit().await?;
    let binding = binding(state, installation, generation, route_id, Some(action)).await?;
    if binding.secret_locator != locator
        || binding.secret_audience != audience
        || binding.gateway_principal_id != principal
    {
        return Err(conflict());
    }
    // 生命周期/投影的原生行锁与持久意图串行化同一 generation 的外部写入。
    let mut lock = state.pool.begin().await?;
    sqlx::query(
        "select installation_resource_id from catalog.agent_model_binding
        where installation_resource_id=$1 and projection_generation=$2 for update",
    )
    .bind(installation)
    .bind(generation)
    .fetch_one(&mut *lock)
    .await?;
    let binding = binding_tx(&mut lock, installation, generation, route_id, action).await?;
    if !matches!(binding.secret_status.as_str(), "PENDING" | "ACTIVE") {
        return Err(unavailable());
    }
    let secret = if let Some(version) = binding.secret_version {
        read_secret(state, &binding, version, &locator).await?
    } else {
        let reference = SecretRef {
            locator: locator.clone(),
            version: 1,
            audience: audience.clone(),
        };
        // 固定 locator 的一次 CAS 写；既有版本优先读回，崩溃不会换掉 credential。
        let value = match state.secrets.read(&reference, "value").await {
            Ok(value) => value,
            Err(secret_store::SecretError::VersionUnavailable) => {
                let mut bytes = vec![0; Sha256::output_size()];
                getrandom::fill(&mut bytes).map_err(|_| unavailable())?;
                let generated = hex::encode(bytes);
                let written = state
                    .secrets
                    .write_once(&locator, "value", &generated)
                    .await
                    .map_err(|_| unavailable())?;
                if written != 1 {
                    return Err(conflict());
                }
                state
                    .secrets
                    .read(&reference, "value")
                    .await
                    .map_err(|_| unavailable())?
            }
            Err(_) => return Err(unavailable()),
        };
        sqlx::query("update catalog.agent_model_binding set secret_version=1
            where installation_resource_id=$1 and projection_generation=$2 and secret_version is null")
            .bind(installation).bind(generation).execute(&mut *lock).await?;
        value
    };
    if secret.expose().is_empty() {
        return Err(unavailable());
    }
    let key = key_projection(
        &route.native_id,
        tenant,
        workspace,
        agent,
        binding.gateway_principal_id,
        (installation, generation),
        &secret,
    );
    let existing = gateway.find_key(&key).await?;
    if binding.native_key_id.is_some()
        && existing
            != binding
                .native_key_id
                .clone()
                .zip(binding.native_key_revision)
    {
        return Err(conflict());
    }
    if existing.is_none() && binding.native_dispatch_started {
        return Err(unavailable());
    }
    if existing.is_none() {
        // 提交后才跨外部边界；失败/超时均不撤掉已落的 dispatch fence。
        sqlx::query(
            "update catalog.agent_model_binding set native_dispatch_started=true
            where installation_resource_id=$1 and projection_generation=$2",
        )
        .bind(installation)
        .bind(generation)
        .execute(&mut *lock)
        .await?;
        lock.commit().await?;
        gateway.create_key(&key).await?;
    } else {
        lock.commit().await?;
    }
    let (id, revision) = gateway.find_key(&key).await?.ok_or_else(unavailable)?;
    // stored 配置成功仍不等于 runtime reload 成功；真实数据面以专属 key 查询模型。
    gateway.check_model(&route.native_id, &secret).await?;
    let fresh = checked_route(
        state,
        route_id,
        tenant,
        workspace,
        agent,
        Consistency::FullyConsistent,
    )
    .await?;
    if fresh.resource_version != route.resource_version
        || fresh.native_revision != route.native_revision
        || fresh.native_config_hash != route.native_config_hash
    {
        return Err(conflict());
    }
    installation_scope(state, installation, version, generation, Some(action)).await?;
    let changed=sqlx::query("update catalog.agent_model_binding set native_dispatch_started=true,native_key_id=$3,native_key_revision=$4,
        secret_status='ACTIVE' where installation_resource_id=$1 and projection_generation=$2
        and secret_status in ('PENDING','ACTIVE')")
        .bind(installation).bind(generation).bind(id).bind(revision).execute(&state.pool).await?;
    if changed.rows_affected() != 1 {
        return Err(conflict());
    }
    let model = resolve(state, installation, version, generation).await?;
    lifecycle.commit().await?;
    Ok(model)
}

/// 每次 spawn/模型副作用前读同一冻结 generation；PROVISIONING 不伪造 ACTIVE，
/// readiness 调用允许 PROVISIONING，发起 turn 的更严格 admit_runtime 仍由调用方执行。
pub(crate) async fn resolve(
    state: &ServiceState,
    installation: Uuid,
    version: Uuid,
    generation: i64,
) -> Result<RuntimeModel, Refusal> {
    let (route_id, tenant, workspace, agent) =
        installation_scope(state, installation, version, generation, None).await?;
    let route = checked_route(
        state,
        route_id,
        tenant,
        workspace,
        agent,
        Consistency::FullyConsistent,
    )
    .await?;
    let binding = binding(state, installation, generation, route_id, None).await?;
    if binding.secret_status != "ACTIVE"
        || binding.native_key_id.is_none()
        || binding.native_key_revision.is_none()
    {
        return Err(unavailable());
    }
    let expected_locator = state.secrets.tenant_locator(
        tenant,
        &format!("llm-route/{route_id}/{installation}/{generation}"),
    );
    let secret_version = binding.secret_version.ok_or_else(unavailable)?;
    let secret = read_secret(state, &binding, secret_version, &expected_locator).await?;
    let gateway = Gateway::from_env()?;
    gateway.check_route(&route).await?;
    gateway.check_authentication().await?;
    let key = key_projection(
        &route.native_id,
        tenant,
        workspace,
        agent,
        binding.gateway_principal_id,
        (installation, generation),
        &secret,
    );
    let expected = binding
        .native_key_id
        .clone()
        .zip(binding.native_key_revision);
    if gateway.find_key(&key).await? != expected {
        return Err(unavailable());
    }
    gateway.check_model(&route.native_id, &secret).await?;
    installation_scope(state, installation, version, generation, None).await?;
    let fresh = checked_route(
        state,
        route_id,
        tenant,
        workspace,
        agent,
        Consistency::FullyConsistent,
    )
    .await?;
    if fresh.resource_version != route.resource_version
        || fresh.native_config_hash != route.native_config_hash
        || fresh.native_revision != route.native_revision
    {
        return Err(conflict());
    }
    Ok(RuntimeModel {
        model: route.native_id,
        gateway_base_url: gateway.model_base.to_string(),
        secret_ref: SecretRef {
            locator: binding.secret_locator,
            version: u32::try_from(secret_version).map_err(|_| unavailable())?,
            audience: binding.secret_audience,
        },
    })
}

async fn installation_scope(
    state: &ServiceState,
    installation: Uuid,
    version: Uuid,
    generation: i64,
    action: Option<Uuid>,
) -> Result<(Uuid, Uuid, Uuid, Uuid), Refusal> {
    if generation <= 0 {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    sqlx::query_as("select p.model_route_resource_id,r.tenant_id,i.workspace_id,i.agent_principal_id
        from catalog.agent_installation i join catalog.resource r on r.id=i.resource_id
        join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
          and p.generation=$3 and p.agent_version_asset_id=$2 and p.state in ('PENDING','ACTIVE')
        join catalog.agent_version v on v.asset_id=$2 and v.agent_resource_id=i.agent_resource_id
          and v.state in ('PUBLISHED','RETIRED') and i.pinned_version_asset_id=v.asset_id
          and v.content->>'modelRouteResourceId'=p.model_route_resource_id::text
        join identity.tenant t on t.id=r.tenant_id and t.state='ACTIVE'
        join identity.workspace w on w.id=i.workspace_id and w.tenant_id=t.id and w.state='ACTIVE'
        join identity.principal a on a.id=i.agent_principal_id and a.tenant_id=t.id and a.kind='AGENT' and a.status='ACTIVE'
        join identity.principal o on o.id=r.owner_principal_id and o.tenant_id=t.id and o.kind='HUMAN' and o.status='ACTIVE'
        join identity.tenant_membership om on om.tenant_principal_id=o.id and om.tenant_id=t.id and om.state='ACTIVE'
        left join admission.action_execution projection on projection.id=r.projection_action_execution_id
        left join catalog.action_definition definition on definition.action_key=projection.action_key
          and definition.version=projection.action_version
        where i.resource_id=$1 and r.home_workspace_id=w.id and r.type_key='agent.installation'
          and i.state in ('PROVISIONING','ACTIVE') and r.state in ('PROVISIONING','ACTIVE')
          and ((p.state='ACTIVE' and i.state='ACTIVE' and r.state='ACTIVE'
              and i.active_projection_generation=p.generation and r.projection_action_execution_id is null
              and $4::uuid is null)
            or (p.state='PENDING' and i.state='PROVISIONING' and r.state='PROVISIONING'
              and projection.tenant_id=t.id and projection.workspace_id=w.id
              and projection.target_id=r.id and projection.gate_state='ALLOWED'
              and projection.dispatch_state='DISPATCHED'
              and definition.workflow_type='ComponentTaskWorkflow' and definition.workflow_kind='AGENT_INSTALLATION'
              and definition.execution_mode='TEMPORAL' and definition.capacity_policy='NONE'
              and definition.quota_policy='NONE' and cardinality(definition.meters)=0
              and ($4::uuid is null or projection.id=$4)
              and exists(select 1 from projection.workflow_ref f where f.action_execution_id=projection.id
                and f.tenant_id=t.id and f.workspace_id=w.id and f.operation_id=projection.operation_id
                and f.workflow_id=projection.temporal_workflow_id and f.projection_state='RUNNING'
                and f.run_id is not null and f.workflow_type='ComponentTaskWorkflow' and f.kind='AGENT_INSTALLATION')))")
        .bind(installation).bind(version).bind(generation).bind(action)
        .fetch_optional(&state.pool).await?.ok_or_else(unavailable)
}

async fn checked_route(
    state: &ServiceState,
    id: Uuid,
    tenant: Uuid,
    workspace: Uuid,
    agent: Uuid,
    consistency: Consistency<'_>,
) -> Result<Route, Refusal> {
    let route: Route = sqlx::query_as(ROUTE)
        .bind(id)
        .bind(tenant)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::BindingNotActive))?;
    if route.tenant_id != tenant || route.home_workspace_id.is_some_and(|w| w != workspace) {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let spice = &state.governance.spicedb;
    if !spice
        .resource_projection_matches_in_workspace(
            &id.to_string(),
            &tenant.to_string(),
            &route.owner_principal_id.to_string(),
            route.home_workspace_id.map(|w| w.to_string()).as_deref(),
            state.governance.cfg.relationship_page,
        )
        .await
        .map_err(|_| unavailable())?
    {
        return Err(unavailable());
    }
    for (object_type, object, permission) in [
        ("workspace", workspace, "discover"),
        ("resource", id, "discover"),
        ("resource", id, "execute"),
    ] {
        let checked = spice
            .check(
                object_type,
                &object.to_string(),
                permission,
                &agent.to_string(),
                consistency,
            )
            .await
            .map_err(|_| unavailable())?;
        if checked.zed_token.is_empty() {
            return Err(unavailable());
        }
        if !checked.allowed {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
    }
    Ok(route)
}

const BINDING: &str = "select b.gateway_principal_id,b.secret_locator,b.secret_version,b.secret_audience,b.secret_status,b.native_dispatch_started,
    b.native_key_id,b.native_key_revision from catalog.agent_model_binding b
    join catalog.resource r on r.id=b.installation_resource_id
    join identity.principal p on p.id=b.gateway_principal_id and p.tenant_id=r.tenant_id
      and p.kind='SERVICE' and p.status='ACTIVE'
    join identity.service_principal s on s.principal_id=p.id and s.audience=p.id::text
      and s.component_binding_kind is null and s.component_binding_id is null
    where b.installation_resource_id=$1 and b.projection_generation=$2 and b.model_route_resource_id=$3
      and ($4::uuid is null or b.action_execution_id=$4)";

async fn binding(
    state: &ServiceState,
    installation: Uuid,
    generation: i64,
    route: Uuid,
    action: Option<Uuid>,
) -> Result<Binding, Refusal> {
    sqlx::query_as(BINDING)
        .bind(installation)
        .bind(generation)
        .bind(route)
        .bind(action)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(conflict)
}

async fn binding_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    installation: Uuid,
    generation: i64,
    route: Uuid,
    action: Uuid,
) -> Result<Binding, Refusal> {
    sqlx::query_as(BINDING)
        .bind(installation)
        .bind(generation)
        .bind(route)
        .bind(Some(action))
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(conflict)
}

async fn read_secret(
    state: &ServiceState,
    binding: &Binding,
    version: i32,
    expected_locator: &str,
) -> Result<SecretValue, Refusal> {
    let version = u32::try_from(version)
        .ok()
        .filter(|v| *v > 0)
        .ok_or_else(unavailable)?;
    if binding.secret_locator != expected_locator {
        return Err(conflict());
    }
    state
        .secrets
        .read(
            &SecretRef {
                locator: binding.secret_locator.clone(),
                version,
                audience: binding.secret_audience.clone(),
            },
            "value",
        )
        .await
        .map_err(|_| unavailable())
}

fn key_projection(
    model: &str,
    tenant: Uuid,
    workspace: Uuid,
    agent: Uuid,
    service: Uuid,
    projection: (Uuid, i64),
    secret: &SecretValue,
) -> Value {
    let (installation, generation) = projection;
    json!({"keyHash":format!("sha256:{}",hex::encode(Sha256::digest(secret.expose().as_bytes()))),
        "allowedModels":[model],"metadata":{"user":service,"tenantId":tenant,"workspaceId":workspace,
            "agentPrincipalId":agent,"servicePrincipalId":service,"installationResourceId":installation,"projectionGeneration":generation}})
}

pub(crate) struct Gateway {
    admin: reqwest::Url,
    model_base: reqwest::Url,
    timeout: std::time::Duration,
    tokens: crate::oidc::TokenSource,
}

impl Gateway {
    pub(crate) fn from_env() -> Result<Self, Refusal> {
        let url = |name| -> Result<reqwest::Url, Refusal> {
            let raw = std::env::var(name).map_err(|_| unavailable())?;
            let url = reqwest::Url::parse(&raw).map_err(|_| unavailable())?;
            if !matches!(url.scheme(), "http" | "https")
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err(unavailable());
            }
            Ok(url)
        };
        let timeout = std::env::var("AGENTGATEWAY_ADMIN_TIMEOUT_SECONDS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|v| *v > 0)
            .ok_or_else(unavailable)?;
        Ok(Self {
            admin: url("AGENTGATEWAY_ADMIN_URL")?,
            model_base: url("AGENTGATEWAY_MODEL_BASE_URL")?,
            timeout: std::time::Duration::from_secs(timeout),
            tokens: crate::oidc::TokenSource::from_env().map_err(|_| unavailable())?,
        })
    }

    pub(crate) async fn admin(
        &self,
        segments: &[&str],
        body: Option<Value>,
    ) -> Result<Value, Refusal> {
        let mut url = self.admin.clone();
        url.path_segments_mut()
            .map_err(|_| unavailable())?
            .pop_if_empty()
            .extend(segments);
        let bearer = self.tokens.token().await.map_err(|_| unavailable())?;
        let client = reqwest::Client::new();
        let request = match body {
            Some(value) => client.put(url).json(&value),
            None => client.get(url),
        };
        let response = request
            .bearer_auth(bearer)
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|_| unavailable())?;
        if !response.status().is_success() {
            return Err(unavailable());
        }
        response.json().await.map_err(|_| unavailable())
    }

    pub(crate) async fn resources(&self, kind: &str) -> Result<Vec<Value>, Refusal> {
        let body = self
            .admin(&["api", "config", "resources", kind], None)
            .await?;
        let rows = body
            .get("resources")
            .and_then(Value::as_array)
            .ok_or_else(unavailable)?;
        if rows.iter().any(|r| {
            r.get("kind").and_then(Value::as_str) != Some(kind)
                || r.get("id")
                    .and_then(Value::as_str)
                    .is_none_or(str::is_empty)
                || r.get("revision")
                    .and_then(Value::as_i64)
                    .is_none_or(|r| r <= 0)
        }) {
            return Err(unavailable());
        }
        Ok(rows.clone())
    }

    pub(crate) fn credential_file(
        &self,
        tenant: Uuid,
        route: Uuid,
        version: u32,
    ) -> Result<String, Refusal> {
        let root = std::path::PathBuf::from(
            std::env::var("AGENTGATEWAY_PROVIDER_SECRET_DIRECTORY").map_err(|_| unavailable())?,
        );
        if !root.is_absolute()
            || root.parent().is_none()
            || root.components().any(|component| {
                matches!(
                    component,
                    std::path::Component::ParentDir | std::path::Component::CurDir
                )
            })
            || version == 0
        {
            return Err(unavailable());
        }
        root.join(format!("{tenant}.{route}.{version}"))
            .into_os_string()
            .into_string()
            .map_err(|_| unavailable())
    }

    pub(crate) async fn project_credential(
        &self,
        tenant: Uuid,
        route: Uuid,
        version: u32,
        secret: &SecretValue,
        expected_hash: &str,
    ) -> Result<(), Refusal> {
        let observed = self
            .admin(
                &[
                    "api",
                    "config",
                    "provider-credentials",
                    &tenant.to_string(),
                    &route.to_string(),
                    &version.to_string(),
                ],
                Some(json!({"value":secret.expose()})),
            )
            .await?;
        if observed.get("file").and_then(Value::as_str)
            != Some(self.credential_file(tenant, route, version)?.as_str())
            || observed.get("version").and_then(Value::as_u64) != Some(u64::from(version))
            || observed.get("sha256").and_then(Value::as_str) != Some(expected_hash)
        {
            return Err(unavailable());
        }
        Ok(())
    }

    async fn observe_creation(
        &self,
        tenant: Uuid,
        route: Uuid,
        version: Option<u32>,
        hashes: &Value,
        credential_hash: Option<&str>,
    ) -> Result<Option<(i64, String)>, Refusal> {
        match (version, credential_hash) {
            (Some(version), Some(credential_hash)) => {
                let credential = self
                    .admin(
                        &[
                            "api",
                            "config",
                            "provider-credentials",
                            &tenant.to_string(),
                            &route.to_string(),
                            &version.to_string(),
                        ],
                        None,
                    )
                    .await?;
                if credential.is_null() {
                    return Ok(None);
                }
                if credential.get("file").and_then(Value::as_str)
                    != Some(self.credential_file(tenant, route, version)?.as_str())
                    || credential.get("version").and_then(Value::as_u64) != Some(u64::from(version))
                    || credential.get("sha256").and_then(Value::as_str) != Some(credential_hash)
                {
                    return Err(conflict());
                }
            }
            (None, None) => (),
            _ => return Err(conflict()),
        }
        let effective = self.admin(&["api", "config", "effective"], None).await?;
        let mut result = None;
        for (kind, collection) in [
            ("llm.provider", "providers"),
            ("llm.model", "models"),
            ("llm.virtualModel", "virtualModels"),
        ] {
            let rows = self.resources(kind).await?;
            let mut matching = rows.iter().filter(|row| {
                row.get("id").and_then(Value::as_str) == Some(route.to_string().as_str())
            });
            let Some(row) = matching.next() else {
                return Ok(None);
            };
            let value = row.get("value").ok_or_else(unavailable)?;
            let expected = hashes
                .get(kind)
                .and_then(Value::as_str)
                .ok_or_else(unavailable)?;
            if matching.next().is_some() || digest(value)? != expected {
                return Err(conflict());
            }
            if kind == "llm.provider" && version.is_none() && !native_provider_without_auth(value) {
                return Err(conflict());
            }
            let revision = row
                .get("revision")
                .and_then(Value::as_i64)
                .filter(|version| *version > 0)
                .ok_or_else(unavailable)?;
            let values = effective
                .get("llm")
                .and_then(|llm| llm.get(collection))
                .and_then(Value::as_array)
                .ok_or_else(unavailable)?;
            let mut matching = values.iter().filter(|value| {
                value.get("name").and_then(Value::as_str) == Some(route.to_string().as_str())
            });
            let materialized = matching.next().ok_or_else(unavailable)?;
            if matching.next().is_some() || digest(materialized)? != expected {
                return Err(conflict());
            }
            if kind == "llm.virtualModel" {
                result = Some((revision, expected.to_owned()));
            }
        }
        Ok(result)
    }

    async fn retire_creation(
        &self,
        tenant: Uuid,
        route: Uuid,
        version: Option<u32>,
        hashes: Option<&Value>,
    ) -> Result<Vec<CreationAbsence>, Refusal> {
        let mut absent = Vec::new();
        for kind in ["llm.provider", "llm.model", "llm.virtualModel"] {
            let rows = self.resources(kind).await?;
            let mut matching = rows.iter().filter(|row| {
                row.get("id").and_then(Value::as_str) == Some(route.to_string().as_str())
            });
            let row = matching.next();
            if matching.next().is_some() {
                return Err(conflict());
            }
            let revision = if let Some(row) = row {
                let expected = hashes
                    .and_then(|hashes| hashes.get(kind))
                    .and_then(Value::as_str)
                    .ok_or_else(unavailable)?;
                if digest(row.get("value").ok_or_else(unavailable)?)? != expected {
                    return Err(conflict());
                }
                let revision = row
                    .get("revision")
                    .and_then(Value::as_i64)
                    .filter(|version| *version > 0)
                    .ok_or_else(unavailable)?;
                Some(revision)
            } else {
                None
            };
            absent.push(CreationAbsence {
                kind: kind.into(),
                id: route.to_string(),
                revision,
                absent: true,
            });
        }
        // Native tombstones cover all three IDs atomically, including never-created IDs.
        self.admin_delete(&["api", "config", "routes", &route.to_string()])
            .await?;
        if !self.creation_absent(route).await? {
            return Err(unavailable());
        }
        // All native users are gone before destroying the file; old generations are drained upstream.
        if let Some(version) = version {
            self.admin_delete(&[
                "api",
                "config",
                "provider-credentials",
                &tenant.to_string(),
                &route.to_string(),
                &version.to_string(),
            ])
            .await?;
            if !self
                .admin(
                    &[
                        "api",
                        "config",
                        "provider-credentials",
                        &tenant.to_string(),
                        &route.to_string(),
                        &version.to_string(),
                    ],
                    None,
                )
                .await?
                .is_null()
            {
                return Err(unavailable());
            }
            absent.push(CreationAbsence {
                kind: "providerCredential".into(),
                id: format!("{tenant}.{route}.{version}"),
                revision: Some(i64::from(version)),
                absent: true,
            });
        }
        Ok(absent)
    }

    async fn creation_absent(&self, route: Uuid) -> Result<bool, Refusal> {
        let effective = self.admin(&["api", "config", "effective"], None).await?;
        for (kind, collection) in [
            ("llm.provider", "providers"),
            ("llm.model", "models"),
            ("llm.virtualModel", "virtualModels"),
        ] {
            if self.resources(kind).await?.iter().any(|row| {
                row.get("id").and_then(Value::as_str) == Some(route.to_string().as_str())
            }) {
                return Ok(false);
            }
            if let Some(values) = effective.get("llm").and_then(|llm| llm.get(collection)) {
                let values = values.as_array().ok_or_else(unavailable)?;
                if values.iter().any(|value| {
                    value.get("name").and_then(Value::as_str) == Some(route.to_string().as_str())
                }) {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }

    async fn check_route(&self, route: &Route) -> Result<(), Refusal> {
        match (
            &route.creation_source_refs,
            &route.creation_hashes,
            &route.credential_hash,
        ) {
            (Some(source), Some(hashes), credential_hash) => {
                let input = frozen_creation_input(source)?;
                let id = Uuid::parse_str(&route.native_id).map_err(|_| unavailable())?;
                if self
                    .observe_creation(
                        route.tenant_id,
                        id,
                        provider_version(&input)?,
                        hashes,
                        credential_hash.as_deref(),
                    )
                    .await?
                    != Some((route.native_revision, route.native_config_hash.clone()))
                {
                    return Err(conflict());
                }
            }
            (None, None, None) => (),
            _ => return Err(unavailable()),
        }
        let rows = self.resources("llm.virtualModel").await?;
        let matches: Vec<_> = rows
            .iter()
            .filter(|r| r.get("id").and_then(Value::as_str) == Some(route.native_id.as_str()))
            .collect();
        if matches.len() != 1 {
            return Err(unavailable());
        }
        let row = matches[0];
        let value = row.get("value").ok_or_else(unavailable)?;
        if row.get("revision").and_then(Value::as_i64) != Some(route.native_revision)
            || value.get("name").and_then(Value::as_str) != Some(route.native_id.as_str())
            || digest(value)? != route.native_config_hash
        {
            return Err(unavailable());
        }
        // Hybrid effective 配置逐值叠加 ConfigResource；stored 存在不是 reload/执行证据。
        let effective = self.admin(&["api", "config", "effective"], None).await?;
        let models = effective
            .pointer("/llm/virtualModels")
            .and_then(Value::as_array)
            .ok_or_else(unavailable)?;
        let matches: Vec<_> = models
            .iter()
            .filter(|model| {
                model.get("name").and_then(Value::as_str) == Some(route.native_id.as_str())
            })
            .collect();
        if matches.len() != 1 || digest(matches[0])? != route.native_config_hash {
            return Err(unavailable());
        }
        Ok(())
    }

    async fn check_authentication(&self) -> Result<(), Refusal> {
        let effective = self.admin(&["api", "config", "effective"], None).await?;
        let auth = effective
            .pointer("/llm/policies/apiKey")
            .ok_or_else(unavailable)?;
        if auth.get("mode").and_then(Value::as_str) != Some("strict") {
            return Err(unavailable());
        }
        if let Some(location) = auth.get("location") {
            if location
                .pointer("/header/name")
                .and_then(Value::as_str)
                .is_none_or(|name| !name.eq_ignore_ascii_case("authorization"))
                || location.pointer("/header/prefix").and_then(Value::as_str) != Some("Bearer ")
            {
                return Err(unavailable());
            }
        }
        Ok(())
    }

    async fn find_key(&self, desired: &Value) -> Result<Option<(String, i64)>, Refusal> {
        let rows = self.resources("llm.apiKey").await?;
        let mut found = None;
        for row in rows {
            let value = row.get("value").ok_or_else(unavailable)?;
            let same_scope = desired
                .get("metadata")
                .and_then(Value::as_object)
                .ok_or_else(unavailable)?
                .iter()
                .all(|(key, expected)| {
                    value.get("metadata").and_then(|v| v.get(key)) == Some(expected)
                });
            let same_key = value.get("keyHash") == desired.get("keyHash");
            if !same_scope && !same_key {
                continue;
            }
            if !same_scope
                || !same_key
                || value.get("allowedModels") != desired.get("allowedModels")
                || value.get("key").is_some()
                || value
                    .get("budgets")
                    .is_some_and(|v| v.as_array().is_none_or(|v| !v.is_empty()))
                || found.is_some()
            {
                return Err(conflict());
            }
            found = Some((
                row.get("id")
                    .and_then(Value::as_str)
                    .ok_or_else(unavailable)?
                    .into(),
                row.get("revision")
                    .and_then(Value::as_i64)
                    .ok_or_else(unavailable)?,
            ));
        }
        Ok(found)
    }

    async fn create_key(&self, desired: &Value) -> Result<(), Refusal> {
        self.admin(
            &["api", "config", "resources", "llm.apiKey"],
            Some(json!({"resources":[{"value":desired}]})),
        )
        .await?;
        Ok(())
    }

    pub(crate) async fn delete(&self, kind: &str, id: &str) -> Result<(), Refusal> {
        self.admin_delete(&["api", "config", "resources", kind, id])
            .await
    }

    pub(crate) async fn admin_delete(&self, segments: &[&str]) -> Result<(), Refusal> {
        let mut url = self.admin.clone();
        url.path_segments_mut()
            .map_err(|_| unavailable())?
            .pop_if_empty()
            .extend(segments);
        let bearer = self.tokens.token().await.map_err(|_| unavailable())?;
        let response = reqwest::Client::new()
            .delete(url)
            .bearer_auth(bearer)
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|_| unavailable())?;
        // Neither 2xx nor 404 is terminal; retire performs independent stored/effective absence reads.
        if !response.status().is_success() && response.status() != reqwest::StatusCode::NOT_FOUND {
            return Err(unavailable());
        }
        Ok(())
    }

    async fn require_key_absent(
        &self,
        tenant: Uuid,
        credential: &FrozenCredential,
        desired: Option<&Value>,
        secret: Option<&SecretValue>,
    ) -> Result<(), Refusal> {
        let tenant = tenant.to_string();
        let installation = credential.installation_resource_id.to_string();
        let matches = |value: &Value| {
            let metadata = value.get("metadata");
            let scope = metadata
                .and_then(|m| m.get("tenantId"))
                .and_then(Value::as_str)
                == Some(tenant.as_str())
                && metadata
                    .and_then(|m| m.get("installationResourceId"))
                    .and_then(Value::as_str)
                    == Some(installation.as_str())
                && metadata
                    .and_then(|m| m.get("projectionGeneration"))
                    .and_then(Value::as_i64)
                    == Some(credential.projection_generation);
            scope
                || desired.is_some_and(|desired| value.get("keyHash") == desired.get("keyHash"))
                || secret.is_some_and(|secret| {
                    value.get("key").and_then(Value::as_str) == Some(secret.expose())
                })
        };
        if self.resources("llm.apiKey").await?.iter().any(|row| {
            credential
                .native_key_id
                .as_deref()
                .is_some_and(|id| row.get("id").and_then(Value::as_str) == Some(id))
                || row.get("value").is_some_and(&matches)
        }) {
            return Err(unavailable());
        }
        let effective = self.admin(&["api", "config", "effective"], None).await?;
        if effective
            .pointer("/llm/policies/apiKey/keys")
            .is_some_and(|keys| keys.as_array().is_none_or(|keys| keys.iter().any(matches)))
        {
            return Err(unavailable());
        }
        Ok(())
    }

    async fn require_key_rejected(&self, secret: &SecretValue) -> Result<(), Refusal> {
        let mut url = self.model_base.clone();
        url.path_segments_mut()
            .map_err(|_| unavailable())?
            .pop_if_empty()
            .push("models");
        let response = reqwest::Client::new()
            .get(url)
            .bearer_auth(secret.expose())
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|_| unavailable())?;
        // 原生 APIKeyAuthenticationFailure 精确映射 401；200/404/503 不是 credential 失效证据。
        if response.status() != reqwest::StatusCode::UNAUTHORIZED {
            return Err(unavailable());
        }
        Ok(())
    }

    async fn check_model(&self, model: &str, secret: &SecretValue) -> Result<(), Refusal> {
        let mut url = self.model_base.clone();
        url.path_segments_mut()
            .map_err(|_| unavailable())?
            .pop_if_empty()
            .push("models");
        let response = reqwest::Client::new()
            .get(url)
            .bearer_auth(secret.expose())
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|_| unavailable())?;
        if !response.status().is_success() {
            return Err(unavailable());
        }
        let value: Value = response.json().await.map_err(|_| unavailable())?;
        let rows = value
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(unavailable)?;
        if rows.len() != 1 || rows[0].get("id").and_then(Value::as_str) != Some(model) {
            return Err(unavailable());
        }
        // 发现成功只证实当前 credential/route reload，不当 Responses/stream/tool 协议验收。
        Ok(())
    }
}

fn digest(value: &Value) -> Result<String, Refusal> {
    let canonical = crate::agent_version::canonical(value.clone());
    Ok(hex::encode(Sha256::digest(
        serde_json::to_vec(&canonical).map_err(|_| unavailable())?,
    )))
}

#[cfg(test)]
mod provider_auth_checks {
    use super::*;

    fn native_custom() -> Value {
        // Only protocol fields, not a fabricated Tenant/Route or active provider inventory.
        json!({"params":{},"provider":{"custom":{"formats":[{"type":"responses"}]}}})
    }

    #[test]
    fn no_provider_auth_accepts_only_explicit_native_custom_absence() {
        let mut provider = native_custom();
        assert!(native_provider_without_auth(&provider));
        provider["params"]["apiKey"] = Value::Null;
        assert!(native_provider_without_auth(&provider));
        provider["params"]["apiKey"] = json!({});
        assert!(!native_provider_without_auth(&provider));
    }

    #[test]
    fn no_provider_auth_rejects_ambient_and_unknown_provider_shapes() {
        let mut provider = native_custom();
        provider["provider"] = json!({"bedrock":{}});
        assert!(!native_provider_without_auth(&provider));
        provider["provider"] = json!({"unrecognized":{}});
        assert!(!native_provider_without_auth(&provider));
        provider["provider"] = Value::Null;
        assert!(!native_provider_without_auth(&provider));
    }

    #[test]
    fn no_provider_auth_rejects_hidden_credential_sources() {
        let mut provider = native_custom();
        provider["defaults"] = json!({});
        assert!(!native_provider_without_auth(&provider));
        provider.as_object_mut().unwrap().remove("defaults");
        provider["auth"] = json!({});
        assert!(!native_provider_without_auth(&provider));
        provider.as_object_mut().unwrap().remove("auth");
        provider["params"]["awsRegion"] = Value::Null;
        assert!(!native_provider_without_auth(&provider));
    }

    #[test]
    fn no_provider_auth_rejects_missing_or_conflicting_native_capability() {
        let mut provider = native_custom();
        provider["provider"]["custom"]["formats"] = json!([]);
        assert!(!native_provider_without_auth(&provider));
        provider = native_custom();
        provider["provider"]["other"] = Value::Null;
        assert!(!native_provider_without_auth(&provider));
        provider = native_custom();
        provider["provider"]["custom"]["credential"] = Value::Null;
        assert!(!native_provider_without_auth(&provider));
    }

    #[test]
    fn frozen_intent_requires_explicit_mode_and_absent_none_secret_field() {
        // Serialization-only configuration references, never native inventory or business rows.
        let reference = json!({
            "id": Uuid::new_v4().to_string(),
            "revision": 1,
            "sha256": hex::encode(Sha256::digest([])),
        });
        let mut input = json!({
            "provider": reference,
            "model": reference,
            "providerCredentialMode": "NONE",
        });
        assert!(frozen_creation_input(&input).is_ok());
        input["providerSecretRef"] = Value::Null;
        assert!(frozen_creation_input(&input).is_err());
        input.as_object_mut().unwrap().remove("providerSecretRef");
        input["providerCredentialMode"] = json!("UNKNOWN");
        assert!(frozen_creation_input(&input).is_err());
        input
            .as_object_mut()
            .unwrap()
            .remove("providerCredentialMode");
        assert!(frozen_creation_input(&input).is_err());
    }
}
