//! DD-102 / 03 §3 / 05 §2.8：Catalog 内容与原治理准入同事务固定。
//! 这里不执行业务 adapter、不授予 consume，不把契约 ACTIVE 当 release/binding 可用。

use std::collections::{BTreeMap, BTreeSet};

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::{CapabilityContractPage, ContractElement, ReasonCode};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    bff::{resolve_execution_context, BffState},
    governance::{Definition, Execution, Governance, Params, Refusal, Semantic, Target},
    spicedb::Consistency,
};

pub(crate) const REGISTER: &str = "capability_contract.register";
pub(crate) const APPROVE: &str = "capability_contract.approve";
pub(crate) const DEPRECATE: &str = "capability_contract.deprecate";

fn bad() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}
fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}
fn identifier(value: &str) -> bool {
    let mut chars = value.bytes();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
}

fn reference(raw: &Value) -> Result<(String, i32), Refusal> {
    let value: contracts::CapabilityContractRef =
        serde_json::from_value(raw.clone()).map_err(|_| bad())?;
    let version = i32::try_from(value.contract_version).map_err(|_| bad())?;
    if !identifier(&value.category_key) || value.category_key == "component" || version <= 0 {
        return Err(bad());
    }
    Ok((value.category_key, version))
}

/// 自然键派生通用 Action target，复用角色目标 v5 惯例；没有第二个实体注册表。
fn target_id(tenant: Uuid, category: &str, version: i32) -> Uuid {
    Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!("urn:platform:capability-contract:{tenant}:{category}:{version}").as_bytes(),
    )
}

struct Registration {
    category: String,
    version: i32,
    content: Value,
    schemas: Value,
    vectors: Value,
    schema_digest: String,
    suite_digest: String,
}

/// Fixed jsonschema 0.33.0 uses its built-in meta-schemas; external I/O is disabled
/// at dependency level and here. Only actual supplied documents can satisfy refs.
struct NoExternalSchema;
impl jsonschema::Retrieve for NoExternalSchema {
    fn retrieve(
        &self,
        _: &jsonschema::Uri<String>,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        Err("schema reference is not in the fixed registration".into())
    }
}

pub(crate) fn schema_validator(
    schema: &Value,
    documents: &BTreeMap<String, Value>,
) -> Result<jsonschema::Validator, Refusal> {
    let mut options = jsonschema::options().with_retriever(NoExternalSchema);
    for other in documents.values() {
        if let Some(id) = other.get("$id").and_then(Value::as_str) {
            options = options.with_resource(
                id.to_owned(),
                jsonschema::Resource::from_contents(other.clone()).map_err(|_| bad())?,
            );
        }
    }
    options.build(schema).map_err(|_| bad())
}

fn validate_schemas(documents: &BTreeMap<String, Value>) -> Result<(), Refusal> {
    let mut ids = BTreeSet::new();
    for schema in documents.values() {
        if jsonschema::meta::try_validate(schema)
            .map_err(|_| bad())?
            .is_err()
        {
            return Err(bad());
        }
        if let Some(id) = schema.get("$id") {
            if !ids.insert(id.as_str().ok_or_else(bad)?.to_owned()) {
                return Err(bad());
            }
        }
    }
    for schema in documents.values() {
        schema_validator(schema, documents)?;
    }
    Ok(())
}

/// Versioned data, not executable text. The catalog stores only canonical input
/// and expected output after both have passed the operation's fixed schemas.
/// This proves runnable shape and coverage, never actual adapter conformance.
fn vectors(
    encoded: &str,
    operations: &[Value],
    documents: &BTreeMap<String, Value>,
) -> Result<Value, Refusal> {
    let raw: Value = serde_json::from_str(encoded).map_err(|_| bad())?;
    let typed: contracts::CapabilityConformanceVectors =
        serde_json::from_value(raw.clone()).map_err(|_| bad())?;
    let mut canonical = serde_json::to_value(typed).map_err(|_| bad())?;
    // Generated Rust intentionally shares the other languages' wire shape;
    // serde by itself would discard unknown fields. Never digest that loss.
    if canonical != raw {
        return Err(bad());
    }
    let validators = documents
        .iter()
        .map(|(digest, schema)| Ok((digest.as_str(), schema_validator(schema, documents)?)))
        .collect::<Result<BTreeMap<_, _>, Refusal>>()?;
    let operations: BTreeMap<_, _> = operations
        .iter()
        .map(|op| Ok((op["contractKey"].as_str().ok_or_else(bad)?, op)))
        .collect::<Result<_, Refusal>>()?;
    let cases = canonical["cases"].as_array_mut().ok_or_else(bad)?;
    if cases.is_empty() {
        return Err(bad());
    }
    let mut case_keys = BTreeSet::new();
    let mut covered = BTreeSet::new();
    for case in cases {
        let key = case["caseKey"].as_str().ok_or_else(bad)?.to_owned();
        if !identifier(&key) || !case_keys.insert(key) {
            return Err(bad());
        }
        let steps = case["steps"].as_array_mut().ok_or_else(bad)?;
        if steps.is_empty() {
            return Err(bad());
        }
        let mut step_keys = BTreeSet::new();
        let mut reference_targets = BTreeMap::new();
        for step in steps {
            let key = step["stepKey"].as_str().ok_or_else(bad)?.to_owned();
            if !identifier(&key) || !step_keys.insert(key) {
                return Err(bad());
            }
            match step.get("referenceResourceId") {
                Some(resource) => {
                    let resource =
                        Uuid::parse_str(resource.as_str().ok_or_else(bad)?).map_err(|_| bad())?;
                    if resource.is_nil() {
                        return Err(bad());
                    }
                    let asset = step
                        .get("referenceAssetId")
                        .map(|asset| {
                            Uuid::parse_str(asset.as_str().ok_or_else(bad)?).map_err(|_| bad())
                        })
                        .transpose()?;
                    if asset.is_some_and(|asset| asset.is_nil()) {
                        return Err(bad());
                    }
                    if let Some(previous) = step.get("referenceFromStepKey") {
                        let previous = previous.as_str().ok_or_else(bad)?;
                        if reference_targets.get(previous) != Some(&(resource, asset)) {
                            return Err(bad());
                        }
                    }
                    reference_targets.insert(
                        step["stepKey"].as_str().ok_or_else(bad)?.to_owned(),
                        (resource, asset),
                    );
                }
                None if step.get("referenceAssetId").is_some()
                    || step.get("referenceFromStepKey").is_some() =>
                {
                    return Err(bad())
                }
                None => {}
            }
            let contract_key = step["contractKey"].as_str().ok_or_else(bad)?.to_owned();
            let operation = operations.get(contract_key.as_str()).ok_or_else(bad)?;
            covered.insert(contract_key);
            for (field, digest_field) in [
                ("inputJson", "inputSchemaDigest"),
                ("expectedOutputJson", "outputSchemaDigest"),
            ] {
                let document: Value = serde_json::from_str(step[field].as_str().ok_or_else(bad)?)
                    .map_err(|_| bad())?;
                let digest = operation[digest_field].as_str().ok_or_else(bad)?;
                if !validators.get(digest).ok_or_else(bad)?.is_valid(&document) {
                    return Err(bad());
                }
                // Insignificant JSON whitespace/key ordering is not a new suite.
                step[field] = json!(serde_json::to_string(&document).map_err(|_| bad())?);
            }
        }
    }
    if covered.len() != operations.len() {
        return Err(bad());
    }
    Ok(canonical)
}

/// 验证实际文档与引用并固定 canonical 内容；不是 adapter 一致性通过证明。
fn registration(raw: &Value) -> Result<Registration, Refusal> {
    let typed: contracts::CapabilityContractRegistration =
        serde_json::from_value(raw.clone()).map_err(|_| bad())?;
    let value = serde_json::to_value(typed).map_err(|_| bad())?;
    let (category, version) = reference(
        &json!({"categoryKey":value["categoryKey"], "contractVersion":value["contractVersion"]}),
    )?;
    let resources = value["resourceTypeFamily"].as_array().ok_or_else(bad)?;
    let operations = value["operationContracts"].as_array().ok_or_else(bad)?;
    let protocol_kinds = value["protocolSessionKinds"].as_array().ok_or_else(bad)?;
    if resources.is_empty()
        || operations.is_empty()
        || (!protocol_kinds.is_empty()
            && (category != "file_storage"
                || protocol_kinds.len() != 1
                || protocol_kinds[0].as_str() != Some(crate::protocol_session::KIND)))
    {
        // Only the actual FILE_STORAGE Session consumer is compiled. Catalog
        // registration must not expose any other, still-unimplemented kind.
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let mut types = BTreeSet::new();
    for resource in resources {
        let kind = resource["kind"].as_str().ok_or_else(bad)?;
        let key = resource["typeKey"].as_str().ok_or_else(bad)?;
        let suffix = key.strip_prefix(&format!("{category}.")).ok_or_else(bad)?;
        if kind.trim().is_empty() || !identifier(suffix) || !types.insert(key.to_owned()) {
            return Err(bad());
        }
    }
    let semantics = &value["contentReferenceSemantics"];
    if [
        "nativeObjectRefRule",
        "nativeRevisionRule",
        "authorizationTargetRule",
    ]
    .iter()
    .any(|key| semantics[*key].as_str().is_none_or(|s| s.trim().is_empty()))
    {
        return Err(bad());
    }
    let declarations = value["requiredDeclarations"].as_array().ok_or_else(bad)?;
    if declarations
        .iter()
        .map(Value::to_string)
        .collect::<BTreeSet<_>>()
        .len()
        != declarations.len()
    {
        return Err(bad());
    }
    let mut documents = BTreeMap::new();
    for document in value["schemaDocuments"].as_array().ok_or_else(bad)? {
        let parsed: Value =
            serde_json::from_str(document.as_str().ok_or_else(bad)?).map_err(|_| bad())?;
        let digest = collab_bridge::limits::canonical_digest(&parsed);
        if documents.insert(digest, parsed).is_some() {
            return Err(bad());
        }
    }
    validate_schemas(&documents)?;
    let mut keys = BTreeSet::new();
    let mut referenced = BTreeSet::new();
    for operation in operations {
        let key = operation["contractKey"].as_str().ok_or_else(bad)?;
        let suffix = format!("@v{version}");
        let verb = key
            .strip_prefix(&format!("{category}."))
            .and_then(|s| s.strip_suffix(&suffix))
            .ok_or_else(bad)?;
        if !identifier(verb)
            || !keys.insert(key)
            || !matches!(operation["targetType"].as_str(), Some("RESOURCE" | "ASSET"))
        {
            return Err(bad());
        }
        for field in ["inputSchemaDigest", "outputSchemaDigest"] {
            let digest = operation[field].as_str().ok_or_else(bad)?;
            if !documents.contains_key(digest) {
                return Err(bad());
            }
            referenced.insert(digest.to_owned());
        }
    }
    if documents.is_empty() || referenced.len() != documents.len() {
        return Err(bad());
    }
    let vectors = vectors(
        value["testVectorsJson"].as_str().ok_or_else(bad)?,
        operations,
        &documents,
    )?;
    let schemas = json!(documents
        .into_iter()
        .map(|(digest, schema)| json!({"digest":digest,"schema":schema}))
        .collect::<Vec<_>>());
    let schema_digest = collab_bridge::limits::canonical_digest(&schemas);
    let suite_digest = collab_bridge::limits::canonical_digest(&vectors);
    // The original documents are Catalog metadata. The list reader never returns them.
    let mut content = value;
    content
        .as_object_mut()
        .ok_or_else(bad)?
        .remove("schemaDocuments");
    content
        .as_object_mut()
        .ok_or_else(bad)?
        .remove("testVectorsJson");
    Ok(Registration {
        category,
        version,
        content,
        schemas,
        vectors,
        schema_digest,
        suite_digest,
    })
}

pub(crate) fn validate_params(sem: Semantic, p: &Params) -> Result<(), Refusal> {
    if p.workspace_id.is_some()
        || p.tenant_id.is_some()
        || p.principal_id.is_some()
        || p.slug.is_some()
        || p.name.is_some()
        || p.invitation_id.is_some()
        || p.original_action_execution_id.is_some()
        || p.resource_id.is_some()
        || p.resource_version.is_some()
        || p.asset_id.is_some()
        || p.asset_version.is_some()
        || p.agent_version_content.is_some()
        || p.delegation_id.is_some()
        || p.delegation_version.is_some()
        || p.delegation_grant.is_some()
        || p.automation_version_content.is_some()
        || p.executor_installation_resource_id.is_some()
        || p.llm_route_create.is_some()
    {
        return Err(bad());
    }
    if sem == Semantic::CapabilityContractRegister {
        if p.capability_contract_ref.is_some() || p.explicit_confirmation != Some(true) {
            return Err(bad());
        }
        registration(
            p.capability_contract_registration
                .as_ref()
                .ok_or_else(bad)?,
        )?;
    } else {
        if p.capability_contract_registration.is_some()
            || p.explicit_confirmation
                != if sem == Semantic::CapabilityContractDeprecate {
                    Some(true)
                } else {
                    None
                }
        {
            return Err(bad());
        }
        reference(p.capability_contract_ref.as_ref().ok_or_else(bad)?)?;
    }
    Ok(())
}

pub(crate) async fn valid_policy(
    conn: &mut PgConnection,
    def: &Definition,
) -> Result<bool, sqlx::Error> {
    let approval = def.action_key == APPROVE;
    if !matches!(def.action_key.as_str(), REGISTER | APPROVE | DEPRECATE)
        || def.target_type != "CAPABILITY_CONTRACT"
        || def.tenant_rule != "SESSION_TENANT"
        || def.workspace_rule != "TENANT_ONLY"
        || def.permission != "manage"
        || def.permission_object_type != "tenant"
        || def.execution_mode != "SYNC"
        || def.workflow_kind.is_some()
        || def.quota_policy != "NONE"
        || !def.meters.is_empty()
        || def.result_exposure != "NONE"
        || def.confirmation_mode != if approval { "APPROVAL" } else { "EXPLICIT" }
        || def.approval_policy_id.is_some() != approval
        || def.approval_policy_version.is_some() != approval
    {
        return Ok(false);
    }
    sqlx::query_scalar("select capacity_policy='NONE' and capacity_pool_key is null and workflow_type is null
        and audit_policy='FULL_LIFECYCLE' and obs_correlation_mode='OPERATION_REF' and obs_progress_source='NONE'
        and obs_terminal_source='SYNC_RESULT' and obs_usage_source='NONE' and obs_cost_source='NONE'
        and obs_redaction_policy='PLATFORM_METADATA_ONLY' and (approval_policy_id is null or exists (
          select 1 from catalog.approval_policy p where p.id=approval_policy_id and p.version=approval_policy_version
           and p.status='ACTIVE' and p.action_key='capability_contract.approve' and p.target_type='CAPABILITY_CONTRACT'
           and p.role_requirements='[{\"selector\":\"TENANT_ADMIN\",\"minDistinct\":1}]'::jsonb
           and p.owner_requirement='NONE' and p.self_approval='DENY'))
        from catalog.action_definition where action_key=$1 and version=$2")
        .bind(&def.action_key).bind(def.version).fetch_one(conn).await
}

pub(crate) async fn target(
    conn: &mut PgConnection,
    tenant: Uuid,
    def: &Definition,
    sem: Semantic,
    p: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    validate_params(sem, p)?;
    if !valid_policy(conn, def).await?
        || !crate::platform_bootstrap::is_catalog_tenant(conn, tenant).await?
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let (category, version) = if sem == Semantic::CapabilityContractRegister {
        let registration = registration(
            p.capability_contract_registration
                .as_ref()
                .ok_or_else(bad)?,
        )?;
        (registration.category, registration.version)
    } else {
        reference(p.capability_contract_ref.as_ref().ok_or_else(bad)?)?
    };
    let id = target_id(tenant, &category, version);
    if frozen.is_some_and(|f| f != id) {
        return Err(conflict());
    }
    let category_row: Option<(Uuid, String, String)> = sqlx::query_as(&format!(
        "select catalog_tenant_id,status,origin from catalog.capability_category where category_key=$1 {}",
        if lock { "for update" } else { "" })).bind(&category).fetch_optional(&mut *conn).await?;
    if category_row
        .as_ref()
        .is_some_and(|(t, state, _)| *t != tenant || state == "RETIRED")
        || (category_row.is_none()
            && matches!(
                category.as_str(),
                "file_storage" | "knowledge" | "data_query"
            ))
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let row: Option<(Uuid, String)> = sqlx::query_as(&format!(
        "select id,status from catalog.capability_contract where category_key=$1 and contract_version=$2 and catalog_tenant_id=$3 {}",
        if lock { "for update" } else { "" })).bind(&category).bind(version).bind(tenant).fetch_optional(conn).await?;
    let expected = match sem {
        Semantic::CapabilityContractRegister => None,
        Semantic::CapabilityContractApprove => Some("DRAFT"),
        Semantic::CapabilityContractDeprecate => Some("ACTIVE"),
        _ => return Err(bad()),
    };
    if match expected {
        None => row.is_some(),
        Some(status) => !row.is_some_and(|(found, state)| found == id && state == status),
    } {
        return Err(conflict());
    }
    Ok(Target {
        id,
        version,
        workspace_id: None,
    })
}

/// DD-102 and EXT-BASE separation: registering A and requesting approval as B
/// must not allow A to complete the approval. The existing self-denial also keeps B out.
fn separated(registrar: Uuid, initiator: Uuid, approver: Uuid) -> bool {
    approver != registrar && approver != initiator
}

pub(crate) async fn approver_separated(
    conn: &mut PgConnection,
    ae: &Execution,
    approver: Uuid,
) -> Result<bool, Refusal> {
    if ae.action_key != APPROVE || ae.workspace_id.is_some() {
        return Ok(false);
    }
    let registrar: Option<Uuid>=sqlx::query_scalar("select r.initiator_principal_id
        from catalog.capability_contract c join admission.action_execution r on r.id=c.registered_by_action_execution_id
        where c.id=$1 and c.catalog_tenant_id=$2 and c.contract_version=$3 and c.status='DRAFT'
          and r.tenant_id=c.catalog_tenant_id and r.workspace_id is null and r.target_id=c.id
          and r.action_key='capability_contract.register' and r.gate_state='ALLOWED' and r.dispatch_state='DISPATCHED'")
        .bind(ae.target_id).bind(ae.tenant_id).bind(ae.frozen_target_version()).fetch_optional(conn).await?;
    Ok(
        registrar
            .is_some_and(|registrar| separated(registrar, ae.initiator_principal_id, approver)),
    )
}

async fn approved(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
) -> Result<(), Refusal> {
    let wf = ae
        .approval_workflow_id
        .as_ref()
        .ok_or_else(|| Refusal::Unavailable("Catalog approval missing".into()))?;
    let row:Option<(bool,Value)>=sqlx::query_as("select status='APPROVED' and consume_deadline>
        clock_timestamp()+make_interval(secs=>$2::bigint),decisions from projection.approval_projection
        where workflow_id=$1 and action_execution_id=$3 and tenant_id=$4")
        .bind(wf).bind(g.cfg.dispatch_margin_seconds).bind(ae.id).bind(ae.tenant_id).fetch_optional(&mut **tx).await?;
    let Some((true, decisions)) = row else {
        return Err(Refusal::Denied(ReasonCode::ApprovalConsumeWindowClosed));
    };
    let decisions: Vec<contracts::DecisionElement> = serde_json::from_value(decisions)
        .map_err(|_| Refusal::Unavailable("Catalog approval decisions unreadable".into()))?;
    for decision in decisions {
        if decision.decision != contracts::ApprovalDecision::Approve
            || !decision
                .satisfied_selectors
                .contains(&contracts::ApprovalSelector::TenantAdmin)
        {
            continue;
        }
        let approver = Uuid::parse_str(&decision.approver_principal_id).map_err(|_| bad())?;
        if !approver_separated(tx, ae, approver).await? {
            continue;
        }
        let active:bool=sqlx::query_scalar("select exists(select 1 from identity.principal p
            join identity.tenant_membership tm on tm.tenant_principal_id=p.id and tm.tenant_id=p.tenant_id
            join identity.tenant t on t.id=p.tenant_id
            where p.id=$1 and p.tenant_id=$2 and p.kind='HUMAN' and p.status='ACTIVE'
              and tm.state='ACTIVE' and t.state='ACTIVE')")
            .bind(approver).bind(ae.tenant_id).fetch_one(&mut **tx).await?;
        if !active {
            continue;
        }
        let fresh = g
            .spicedb
            .check(
                "tenant",
                &ae.tenant_id.to_string(),
                "manage",
                &approver.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| {
                Refusal::Unavailable("Catalog approver authorization unavailable".into())
            })?;
        if fresh.allowed {
            return Ok(());
        }
    }
    Err(Refusal::Denied(ReasonCode::ApproverNotEligible))
}

pub(crate) async fn prewrite(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    sem: Semantic,
    p: &Params,
) -> Result<(), Refusal> {
    if sem == Semantic::CapabilityContractRegister {
        let r = registration(
            p.capability_contract_registration
                .as_ref()
                .ok_or_else(bad)?,
        )?;
        sqlx::query("insert into catalog.capability_category(category_key,catalog_tenant_id,type_key_namespace,origin,registered_by_action_execution_id,status)
            values ($1,$2,$1,'CATALOG_REGISTERED',$3,'DRAFT') on conflict(category_key) do nothing")
            .bind(&r.category).bind(ae.tenant_id).bind(ae.id).execute(&mut **tx).await?;
        sqlx::query("insert into catalog.capability_contract(id,category_key,contract_version,catalog_tenant_id,content,schema_documents,test_vectors,
            schema_set_digest,conformance_suite_digest,origin,registered_by_action_execution_id,status)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'CATALOG_REGISTERED',$10,'DRAFT')")
            .bind(ae.target_id).bind(r.category).bind(r.version).bind(ae.tenant_id).bind(r.content).bind(r.schemas).bind(r.vectors)
            .bind(r.schema_digest).bind(r.suite_digest).bind(ae.id).execute(&mut **tx).await?;
    } else {
        let (category, version) = reference(p.capability_contract_ref.as_ref().ok_or_else(bad)?)?;
        if Some(version) != ae.frozen_target_version() {
            return Err(conflict());
        }
        if sem == Semantic::CapabilityContractApprove {
            approved(g, tx, ae).await?;
        }
        let sql = if sem == Semantic::CapabilityContractApprove {
            "update catalog.capability_contract set status='ACTIVE',approved_by_action_execution_id=$1 where id=$2 and catalog_tenant_id=$3 and status='DRAFT'"
        } else {
            "update catalog.capability_contract set status='DEPRECATED',deprecated_by_action_execution_id=$1 where id=$2 and catalog_tenant_id=$3 and status='ACTIVE'"
        };
        if sqlx::query(sql)
            .bind(ae.id)
            .bind(ae.target_id)
            .bind(ae.tenant_id)
            .execute(&mut **tx)
            .await?
            .rows_affected()
            != 1
        {
            return Err(conflict());
        }
        if sem == Semantic::CapabilityContractApprove {
            sqlx::query("update catalog.capability_category set status='ACTIVE' where category_key=$1 and catalog_tenant_id=$2 and status='DRAFT'")
                .bind(category).bind(ae.tenant_id).execute(&mut **tx).await?;
        }
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct PageQuery {
    offset: Option<i64>,
}

pub async fn list(
    State(state): State<BffState>,
    Query(query): Query<PageQuery>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let offset = query.offset.unwrap_or(0);
    if offset < 0 {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let result=async {
        let mut conn=state.pool.acquire().await?;
        if !crate::platform_bootstrap::is_catalog_tenant(&mut conn,ctx.tenant_id).await? { return Err(Refusal::Denied(ReasonCode::PermissionDenied)); }
        let check=state.governance.spicedb.check("tenant",&ctx.tenant_id.to_string(),"manage",&ctx.tenant_principal_id.to_string(),Consistency::FullyConsistent)
            .await.map_err(|_| Refusal::Unavailable("Catalog authorization unavailable".into()))?;
        if !check.allowed { return Err(Refusal::Denied(ReasonCode::PermissionDenied)); }
        let mut capabilities=BTreeMap::new();
        for key in [REGISTER,APPROVE,DEPRECATE] {
            let def=crate::governance::active_definition(&state.pool,key).await?;
            let allowed=if let Some(def)=def { crate::capability_registry::action_exposed(key) && valid_policy(&mut conn,&def).await? } else { false };
            capabilities.insert(key,allowed);
        }
        let page=state.governance.cfg.role_member_page_limit;
        let limit=page.checked_add(1).ok_or_else(bad)?;
        let mut rows:Vec<(String,i32,String,String,String,Uuid)>=sqlx::query_as("select category_key,contract_version,status,schema_set_digest,conformance_suite_digest,registered_by_action_execution_id
            from catalog.capability_contract where catalog_tenant_id=$1 order by category_key,contract_version limit $2 offset $3")
            .bind(ctx.tenant_id).bind(limit).bind(offset).fetch_all(&mut *conn).await?;
        let more=rows.len() as i64>page;
        rows.truncate(page as usize);
        let mut views=Vec::new();
        for (category,version,status,schema,suite,ae) in rows {
            // Decode through the same generated DTO; unknown catalog enum never becomes ACTIVE.
            let view:ContractElement=serde_json::from_value(json!({"categoryKey":category,"contractVersion":version,"status":status,
                "schemaSetDigest":schema,"conformanceSuiteDigest":suite,"registeredByActionExecutionId":ae,
                "canApprove":status=="DRAFT" && capabilities[APPROVE],"canDeprecate":status=="ACTIVE" && capabilities[DEPRECATE]})).map_err(|_|bad())?;
            views.push(view);
        }
        Ok::<_,Refusal>(CapabilityContractPage { contracts:views,can_register:capabilities[REGISTER],
            next_offset: if more { Some(offset.checked_add(page).ok_or_else(bad)?) } else { None } })
    }.await;
    match result {
        Ok(page) => Json(page).into_response(),
        Err(Refusal::Denied(_)) => StatusCode::FORBIDDEN.into_response(),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

#[cfg(test)]
mod registration_tests {
    use super::*;

    fn vector_input(input: Value, output: Value) -> Value {
        json!({"formatVersion":"V1","cases":[{"caseKey":"read_roundtrip","steps":[{
            "stepKey":"read", "contractKey":"records.read@v1",
            "inputJson":input.to_string(), "expectedOutputJson":output.to_string()
        }]}]})
    }

    fn input(schema: Value) -> Value {
        let digest = collab_bridge::limits::canonical_digest(&schema);
        json!({"categoryKey":"records","contractVersion":1,
            "resourceTypeFamily":[{"typeKey":"records.collection","kind":"COLLECTION"}],
            "operationContracts":[{"contractKey":"records.read@v1","surface":"ACTION",
                "inputSchemaDigest":digest,"outputSchemaDigest":digest,"permission":"read","targetType":"RESOURCE"}],
            "contentReferenceSemantics":{"nativeObjectRefRule":"opaque native ID","nativeRevisionRule":"opaque immutable revision",
                "authorizationTargetRule":"same resource or asset"},"requiredDeclarations":["OBSERVE"],"protocolSessionKinds":[],
            "schemaDocuments":[schema.to_string()],
            "testVectorsJson":vector_input(json!({}),json!({})).to_string()})
    }

    #[test]
    fn only_the_compiled_file_storage_protocol_kind_can_be_registered() {
        let mut value = input(json!({"type":"object"}));
        value["categoryKey"] = json!("file_storage");
        value["resourceTypeFamily"][0]["typeKey"] = json!("file_storage.collection");
        value["operationContracts"][0]["contractKey"] = json!("file_storage.read@v1");
        let mut vectors = vector_input(json!({}), json!({}));
        vectors["cases"][0]["steps"][0]["contractKey"] = json!("file_storage.read@v1");
        value["testVectorsJson"] = json!(vectors.to_string());
        value["protocolSessionKinds"] = json!([crate::protocol_session::KIND]);
        let registered = registration(&value).expect("compiled FILE_STORAGE consumer");
        assert_eq!(registered.category, "file_storage");
        assert_eq!(
            registered.content["protocolSessionKinds"],
            value["protocolSessionKinds"]
        );
        for kinds in [
            json!(["file_storage.future_session"]),
            json!([crate::protocol_session::KIND, crate::protocol_session::KIND]),
            json!([crate::protocol_session::KIND, "UNKNOWN"]),
        ] {
            value["protocolSessionKinds"] = kinds;
            assert!(registration(&value).is_err());
        }
        let mut unrelated = input(json!({"type":"object"}));
        unrelated["protocolSessionKinds"] = json!([crate::protocol_session::KIND]);
        assert!(registration(&unrelated).is_err());
    }

    #[test]
    fn actual_schema_and_vectors_are_content_fixed() {
        let first = registration(&input(
            json!({"type":"object","properties":{"name":{"type":"string"}}}),
        ))
        .expect("actual schema");
        let second = registration(&input(
            json!({"type":"object","properties":{"name":{"type":"integer"}}}),
        ))
        .expect("changed schema");
        assert_ne!(first.schema_digest, second.schema_digest);
        let mut changed = input(json!({"type":"object"}));
        let previous = registration(&changed).expect("actual schema");
        changed["testVectorsJson"] =
            json!(vector_input(json!({}), json!({"ref":"fixed"})).to_string());
        assert_ne!(
            previous.suite_digest,
            registration(&changed).expect("actual vector").suite_digest
        );
        assert!(first.content.get("schemaDocuments").is_none());
        assert!(first.content.get("testVectorsJson").is_none());
    }

    #[test]
    fn malformed_schema_and_external_references_are_rejected() {
        for schema in [
            json!({"type":"object","properties":123}),
            json!({"type":"made_up"}),
            json!({"$ref":"https://example.invalid/not-supplied.json"}),
            json!({"$ref":"file:///not-supplied.json"}),
            json!({"$schema":"https://example.invalid/custom-dialect"}),
        ] {
            assert!(registration(&input(schema)).is_err());
        }
    }

    #[test]
    fn only_fixed_supplied_documents_can_resolve() {
        let schema = json!({"$id":"urn:records:root","type":"object","properties":{"name":{"$ref":"urn:records:name"}}});
        let other = json!({"$id":"urn:records:name","type":"string"});
        let digest = collab_bridge::limits::canonical_digest(&other);
        let mut value = input(schema);
        value["schemaDocuments"]
            .as_array_mut()
            .unwrap()
            .push(json!(other.to_string()));
        value["operationContracts"][0]["outputSchemaDigest"] = json!(digest);
        value["testVectorsJson"] = json!(vector_input(json!({}), json!("result")).to_string());
        assert!(registration(&value).is_ok());
        value["schemaDocuments"].as_array_mut().unwrap().pop();
        assert!(registration(&value).is_err());
    }

    #[test]
    fn executable_vectors_reject_unknown_shape_missing_coverage_and_schema_mismatch() {
        let schema = json!({"type":"object","additionalProperties":false,
            "required":["nativeRef"],"properties":{"nativeRef":{"type":"string"}}});
        let mut value = input(schema);
        let valid = vector_input(
            json!({"nativeRef":"fixture"}),
            json!({"nativeRef":"fixture"}),
        );
        value["testVectorsJson"] = json!(valid.to_string());
        assert!(registration(&value).is_ok());
        for invalid in [
            json!([{"case":"read","expected":"same revision"}]),
            json!({"formatVersion":"V2","cases":valid["cases"]}),
            json!({"formatVersion":"V1","cases":[]}),
            json!({"formatVersion":"V1","cases":[{"caseKey":"empty","steps":[]}]}),
            vector_input(json!({}), json!({"nativeRef":"fixture"})),
            vector_input(json!({"nativeRef":"fixture"}), json!({"nativeRef":false})),
        ] {
            value["testVectorsJson"] = json!(invalid.to_string());
            assert!(registration(&value).is_err(), "{invalid}");
        }
        for (pointer, replacement) in [
            ("/formatVersion", json!("UNKNOWN")),
            ("/cases/0/caseKey", json!("")),
            ("/cases/0/steps/0/contractKey", json!("records.write@v1")),
            ("/cases/0/steps/0/inputJson", json!("not json")),
        ] {
            let mut invalid = valid.clone();
            *invalid.pointer_mut(pointer).unwrap() = replacement;
            value["testVectorsJson"] = json!(invalid.to_string());
            assert!(registration(&value).is_err());
        }
        for pointer in ["", "/cases/0", "/cases/0/steps/0"] {
            let mut invalid = valid.clone();
            invalid
                .pointer_mut(pointer)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .insert("unrecognized".into(), json!(true));
            value["testVectorsJson"] = json!(invalid.to_string());
            assert!(registration(&value).is_err());
        }
        for pointer in ["/cases", "/cases/0/steps"] {
            let mut invalid = valid.clone();
            let items = invalid
                .pointer_mut(pointer)
                .unwrap()
                .as_array_mut()
                .unwrap();
            items.push(items[0].clone());
            value["testVectorsJson"] = json!(invalid.to_string());
            assert!(registration(&value).is_err());
        }
        value["testVectorsJson"] = json!(valid.to_string());
        let mut missing = value["operationContracts"][0].clone();
        missing["contractKey"] = json!("records.write@v1");
        value["operationContracts"]
            .as_array_mut()
            .unwrap()
            .push(missing);
        assert!(registration(&value).is_err());
    }

    #[test]
    fn executable_vector_inner_json_is_canonical_and_case_order_is_preserved() {
        let mut value = input(json!({"type":"object"}));
        let mut vectors = vector_input(json!({"a":1,"b":2}), json!({}));
        value["testVectorsJson"] = json!(vectors.to_string());
        let original = registration(&value).unwrap();
        vectors["cases"][0]["steps"][0]["inputJson"] = json!(" { \"b\" : 2, \"a\" : 1 } ");
        value["testVectorsJson"] = json!(vectors.to_string());
        let reordered = registration(&value).unwrap();
        assert_eq!(original.suite_digest, reordered.suite_digest);
        assert_eq!(original.vectors, reordered.vectors);
        let mut second = vectors["cases"][0]["steps"][0].clone();
        second["stepKey"] = json!("read_again");
        vectors["cases"][0]["steps"]
            .as_array_mut()
            .unwrap()
            .push(second);
        value["testVectorsJson"] = json!(vectors.to_string());
        let ordered = registration(&value).unwrap();
        vectors["cases"][0]["steps"]
            .as_array_mut()
            .unwrap()
            .reverse();
        value["testVectorsJson"] = json!(vectors.to_string());
        assert_ne!(
            ordered.suite_digest,
            registration(&value).unwrap().suite_digest
        );
    }

    #[test]
    fn undeclared_schema_unknown_platform_semantics_and_namespace_rejected() {
        for (path, content) in [
            (
                ["operationContracts", "0", "permission"],
                json!("new_permission"),
            ),
            (["operationContracts", "0", "targetType"], json!("OTHER")),
            (
                ["operationContracts", "0", "inputSchemaDigest"],
                json!("a".repeat(64)),
            ),
        ] {
            let mut value = input(json!({"type":"object"}));
            value[path[0]][0][path[2]] = content;
            assert!(registration(&value).is_err());
        }
        for field in ["requiredDeclarations", "protocolSessionKinds"] {
            let mut value = input(json!({"type":"object"}));
            value[field] = json!(["NEW_KIND"]);
            assert!(registration(&value).is_err());
        }
        let mut value = input(json!({"type":"object"}));
        value["resourceTypeFamily"][0]["typeKey"] = json!("other.collection");
        assert!(registration(&value).is_err());
        value["categoryKey"] = json!("component");
        assert!(registration(&value).is_err());
    }

    #[test]
    fn registrar_cannot_complete_someone_elses_approval() {
        let a = Uuid::from_u128(1);
        let b = Uuid::from_u128(2);
        let c = Uuid::from_u128(3);
        assert!(!separated(a, b, a)); // A registers, B requests, A cannot approve.
        assert!(!separated(a, b, b)); // Existing self_approval DENY is preserved.
        assert!(separated(a, b, c));
        assert!(separated(a, a, b)); // A may request and a different Catalog admin approve.
    }
}
