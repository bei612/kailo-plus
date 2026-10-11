//! DD-102 / 03 §3 / 05 §2.8：Catalog 内容与原治理准入同事务固定。
//! 这里不执行业务 adapter、不授予 consume，不把契约 ACTIVE 当 release/binding 可用。

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

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
// DD-108: this action is only written by the in-process deployment bootstrap.
// It is deliberately absent from the network action registry and definitions.
const BOOTSTRAP: &str = "capability_contract.bootstrap";

fn builtin_knowledge() -> Result<Registration, Refusal> {
    let raw = serde_json::from_str(include_str!(
        "../../../../contracts/adapter/knowledge.v1/registration.json"
    ))
    .map_err(|_| bad())?;
    registration(&raw)
}

fn builtin_data_query() -> Result<Registration, Refusal> {
    let raw = serde_json::from_str(include_str!(
        "../../../../contracts/adapter/data_query.v1/registration.json"
    ))
    .map_err(|_| bad())?;
    registration(&raw)
}

fn builtin_file_storage() -> Result<Registration, Refusal> {
    let raw = serde_json::from_str(include_str!(
        "../../../../contracts/adapter/file_storage.v1/registration.json"
    ))
    .map_err(|_| bad())?;
    registration(&raw)
}

/// Seed data is compiled into the same Core that validates Catalog content.
/// A deployment may install the missing v1 once; it cannot reactivate a retired
/// category, replace a registered contract, or approve a component release.
pub(crate) async fn ensure_builtin_contracts(
    pool: &sqlx::PgPool,
    tenant: Uuid,
) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for seed in [
        builtin_knowledge(),
        builtin_data_query(),
        builtin_file_storage(),
    ] {
        bootstrap_contract(
            &mut tx,
            tenant,
            seed.map_err(|_| "compiled capability contract is invalid")?,
        )
        .await?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

async fn bootstrap_contract(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    seed: Registration,
) -> Result<(), String> {
    let catalog: Option<Uuid> = sqlx::query_scalar(
        "select t.id from identity.tenant t where t.id=$1
         and t.state in ('PROVISIONING','ACTIVE') and exists (
           select 1 from identity.relay_operator_identity o
           where o.catalog_tenant_id=t.id and o.state='ACTIVE') for update",
    )
    .bind(tenant)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    if catalog != Some(tenant) {
        return Err("capability bootstrap requires the original Catalog deployment scope".into());
    }
    let id = target_id(tenant, &seed.category, seed.version);
    let existing: Option<(Uuid, String, Value, Value, Value, String, String)> = sqlx::query_as(
        "select catalog_tenant_id,origin,content,schema_documents,test_vectors,
                schema_set_digest,conformance_suite_digest
         from catalog.capability_contract where category_key=$1 and contract_version=$2",
    )
    .bind(&seed.category)
    .bind(seed.version)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    if let Some((owner, origin, content, schemas, vectors, schema, suite)) = existing {
        if owner != tenant
            || origin != "PLATFORM_SEED"
            || content != seed.content
            || schemas != seed.schemas
            || vectors != seed.vectors
            || schema != seed.schema_digest
            || suite != seed.suite_digest
        {
            return Err(
                "compiled capability contract conflicts with immutable Catalog content".into(),
            );
        }
        // Deliberately do not update state: later governance remains authoritative.
        return Ok(());
    }
    let category_exists: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.capability_category where category_key=$1)",
    )
    .bind(&seed.category)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    if category_exists {
        return Err("capability contract bootstrap is zero-to-one only".into());
    }
    let actor = crate::tenant_bootstrap::deployment_principal(tx, tenant).await?;
    let ae = Uuid::new_v4();
    let operation = Uuid::new_v4();
    let parameters = json!({"categoryKey":seed.category,"contractVersion":seed.version,
        "schemaSetDigest":seed.schema_digest,"conformanceSuiteDigest":seed.suite_digest});
    let hash = collab_bridge::limits::canonical_digest(&parameters);
    sqlx::query(
        "insert into admission.action_execution
          (id,operation_id,tenant_id,action_key,action_version,initiator_principal_id,
           actor_principal_id,target_id,parameter_hash,parameters,gate_state,dispatch_state,correlation_id)
         values($1,$2,$3,$4,1,$5,$5,$6,$7,$8,'ALLOWED','DISPATCHED',$2)",
    )
    .bind(ae).bind(operation).bind(tenant).bind(BOOTSTRAP).bind(actor).bind(id)
    .bind(&hash).bind(parameters).execute(&mut **tx).await.map_err(|e| e.to_string())?;
    sqlx::query(
        "insert into catalog.capability_category
          (category_key,catalog_tenant_id,type_key_namespace,origin,status,bootstrap_action_execution_id)
         values($1,$2,$1,'PLATFORM_SEED','ACTIVE',$3)",
    )
    .bind(&seed.category).bind(tenant).bind(ae)
    .execute(&mut **tx).await.map_err(|e| e.to_string())?;
    sqlx::query(
        "insert into catalog.capability_contract
          (id,category_key,contract_version,catalog_tenant_id,content,schema_documents,test_vectors,
           schema_set_digest,conformance_suite_digest,origin,bootstrap_action_execution_id,status)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,'PLATFORM_SEED',$10,'ACTIVE')",
    )
    .bind(id)
    .bind(&seed.category)
    .bind(seed.version)
    .bind(tenant)
    .bind(seed.content)
    .bind(seed.schemas)
    .bind(seed.vectors)
    .bind(seed.schema_digest)
    .bind(seed.suite_digest)
    .bind(ae)
    .execute(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    for (stage, event_type, result) in [
        ("intent", "INTENT", "EVALUATING"),
        ("decision", "DECISION", "ALLOWED"),
        ("outcome", "OUTCOME", "SUCCEEDED"),
    ] {
        crate::audit::append(
            tx,
            crate::audit::AuditEntry {
                event_key: format!("{operation}:{stage}"),
                tenant_id: Some(tenant),
                workspace_id: None,
                operation_id: operation,
                event_type,
                human_identity_id: None,
                initiator_principal_id: Some(actor),
                actor_principal_id: Some(actor),
                action_key: BOOTSTRAP,
                action_version: 1,
                component_type_key: "core",
                target_type: Some("CAPABILITY_CONTRACT"),
                target_id: Some(id),
                parameter_hash: &hash,
                decision: "ALLOW",
                result_code: result,
                result_exposure: "NONE",
                evidence_refs: vec![crate::audit::Evidence::new(
                    contracts::EvidenceKind::ActionExecutionId,
                    ae,
                )],
                correlation_id: operation,
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

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

/// Used only after full offline validation: the original compiler asks for
/// dependencies of operation roots, rather than preloading unrelated documents.
struct SchemaDependencies {
    documents: BTreeMap<String, (String, Value)>,
    consumed: Arc<Mutex<BTreeSet<String>>>,
}
impl jsonschema::Retrieve for SchemaDependencies {
    fn retrieve(
        &self,
        uri: &jsonschema::Uri<String>,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        let (digest, document) = self
            .documents
            .get(uri.as_str())
            .ok_or("schema reference is not in the fixed registration")?;
        self.consumed
            .lock()
            .map_err(|_| "schema dependency tracking failed")?
            .insert(digest.clone());
        Ok(document.clone())
    }
}

pub(crate) fn schema_validator(
    schema: &Value,
    documents: &BTreeMap<String, Value>,
) -> Result<jsonschema::Validator, Refusal> {
    let mut options = jsonschema::options().with_retriever(NoExternalSchema);
    for other in documents.values() {
        if let Some(id) = other.get("$id").and_then(Value::as_str) {
            // The registry URI already locates this document. Reapplying its
            // relative top-level $id would duplicate the path before resolving
            // child $refs. Only the compiler copy loses that redundant $id;
            // nested identifiers and the stored/digested document stay intact.
            let mut resource = other.clone();
            resource.as_object_mut().ok_or_else(bad)?.remove("$id");
            options = options.with_resource(
                id.to_owned(),
                jsonschema::Resource::from_contents(resource).map_err(|_| bad())?,
            );
        }
    }
    let mut root = schema.clone();
    if let Some(id) = schema.get("$id").and_then(Value::as_str) {
        options = options.with_base_uri(id.to_owned());
        root.as_object_mut().ok_or_else(bad)?.remove("$id");
    }
    options.build(&root).map_err(|_| bad())
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
                // This input is the actual typed result of an earlier native
                // step, not its empty registration-time placeholder. Validate
                // it against the fixed schema when authorizing the wire call.
                let deferred_reference =
                    field == "inputJson" && step.get("referenceFromStepKey").is_some();
                if if deferred_reference {
                    document != json!({})
                } else {
                    !validators.get(digest).ok_or_else(bad)?.is_valid(&document)
                } {
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
    if documents.is_empty() {
        return Err(bad());
    }
    // Full schema validation above includes every fixed document. For auxiliary
    // consumption, preload only the operation roots and let the same compiler
    // request actual dependencies. An isolated cycle cannot consume itself.
    if referenced.len() != documents.len() {
        let registry = jsonschema::Registry::options()
            .retriever(NoExternalSchema)
            .build(std::iter::empty::<(&str, jsonschema::Resource)>())
            .map_err(|_| bad())?;
        let mut supplied = BTreeMap::new();
        for (digest, document) in &documents {
            if let Some(id) = document.get("$id").and_then(Value::as_str) {
                let uri = registry
                    .try_resolver(id)
                    .map_err(|_| bad())?
                    .base_uri()
                    .to_string();
                let mut resource = document.clone();
                resource.as_object_mut().ok_or_else(bad)?.remove("$id");
                if supplied.insert(uri, (digest.clone(), resource)).is_some() {
                    return Err(bad());
                }
            }
        }
        let consumed = Arc::new(Mutex::new(BTreeSet::new()));
        for root in &referenced {
            let mut options = jsonschema::options().with_retriever(SchemaDependencies {
                documents: supplied.clone(),
                consumed: Arc::clone(&consumed),
            });
            for digest in &referenced {
                let document = &documents[digest];
                if let Some(id) = document.get("$id").and_then(Value::as_str) {
                    let mut resource = document.clone();
                    resource.as_object_mut().ok_or_else(bad)?.remove("$id");
                    options = options.with_resource(
                        id.to_owned(),
                        jsonschema::Resource::from_contents(resource).map_err(|_| bad())?,
                    );
                }
            }
            let mut schema = documents[root].clone();
            if let Some(id) = documents[root].get("$id").and_then(Value::as_str) {
                options = options.with_base_uri(id.to_owned());
                schema.as_object_mut().ok_or_else(bad)?.remove("$id");
            }
            options.build(&schema).map_err(|_| bad())?;
        }
        let consumed = consumed.lock().map_err(|_| bad())?;
        if documents
            .keys()
            .any(|digest| !referenced.contains(digest) && !consumed.contains(digest))
        {
            return Err(bad());
        }
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

#[derive(sqlx::FromRow)]
struct ContractRow {
    category_key: String,
    contract_version: i32,
    status: String,
    schema_set_digest: String,
    conformance_suite_digest: String,
    registered_by_action_execution_id: Option<Uuid>,
    bootstrap_action_execution_id: Option<Uuid>,
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
        let mut rows:Vec<ContractRow>=sqlx::query_as("select category_key,contract_version,status,schema_set_digest,conformance_suite_digest,registered_by_action_execution_id,bootstrap_action_execution_id
            from catalog.capability_contract where catalog_tenant_id=$1 order by category_key,contract_version limit $2 offset $3")
            .bind(ctx.tenant_id).bind(limit).bind(offset).fetch_all(&mut *conn).await?;
        let more=rows.len() as i64>page;
        rows.truncate(page as usize);
        let mut views=Vec::new();
        for row in rows {
            // Decode through the same generated DTO; unknown catalog enum never becomes ACTIVE.
            let view:ContractElement=serde_json::from_value(json!({"categoryKey":row.category_key,"contractVersion":row.contract_version,"status":row.status,
                "schemaSetDigest":row.schema_set_digest,"conformanceSuiteDigest":row.conformance_suite_digest,"registeredByActionExecutionId":row.registered_by_action_execution_id,"bootstrapActionExecutionId":row.bootstrap_action_execution_id,
                "canApprove":row.status=="DRAFT" && capabilities[APPROVE],"canDeprecate":row.status=="ACTIVE" && capabilities[DEPRECATE]})).map_err(|_|bad())?;
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
    use sqlx::Acquire;

    #[test]
    fn prior_native_reference_defers_only_the_empty_input_slot() {
        let schema: Value = serde_json::from_str(include_str!(
            "../../../../contracts/domain/content_reference.schema.json"
        ))
        .unwrap();
        let empty = json!({"type":"object","additionalProperties":false});
        let reference_digest = collab_bridge::limits::canonical_digest(&schema);
        let empty_digest = collab_bridge::limits::canonical_digest(&empty);
        let documents = BTreeMap::from([
            (reference_digest.clone(), schema),
            (empty_digest.clone(), empty),
        ]);
        let operations = vec![
            json!({"contractKey":"records.create@v1","inputSchemaDigest":empty_digest,"outputSchemaDigest":empty_digest}),
            json!({"contractKey":"records.read@v1","inputSchemaDigest":reference_digest,"outputSchemaDigest":empty_digest}),
        ];
        let resource = Uuid::new_v4();
        let mut value = json!({"formatVersion":"V1","cases":[{"caseKey":"references","steps":[
            {"stepKey":"create","contractKey":"records.create@v1","inputJson":"{}","expectedOutputJson":"{}","referenceResourceId":resource},
            {"stepKey":"read","contractKey":"records.read@v1","inputJson":"{}","expectedOutputJson":"{}","referenceResourceId":resource,"referenceFromStepKey":"create"}
        ]}]});
        assert!(vectors(&value.to_string(), &operations, &documents).is_ok());
        value["cases"][0]["steps"][1]["inputJson"] =
            json!("{\"nativeObjectRef\":\"caller-selected\"}");
        assert!(vectors(&value.to_string(), &operations, &documents).is_err());
        value["cases"][0]["steps"][1]["inputJson"] = json!("{}");
        value["cases"][0]["steps"][1]
            .as_object_mut()
            .unwrap()
            .remove("referenceFromStepKey");
        assert!(vectors(&value.to_string(), &operations, &documents).is_err());
    }

    #[test]
    fn builtin_knowledge_has_all_five_fixed_permissions_and_reference_sequence() {
        let raw: Value = serde_json::from_str(include_str!(
            "../../../../contracts/adapter/knowledge.v1/registration.json"
        ))
        .unwrap();
        let typed: contracts::CapabilityContractRegistration =
            serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(serde_json::to_value(typed).unwrap(), raw);
        let documents: BTreeMap<_, _> = raw["schemaDocuments"]
            .as_array()
            .unwrap()
            .iter()
            .map(|document| {
                let value: Value = serde_json::from_str(document.as_str().unwrap()).unwrap();
                jsonschema::meta::try_validate(&value).unwrap().unwrap();
                (collab_bridge::limits::canonical_digest(&value), value)
            })
            .collect();
        validate_schemas(&documents).expect("seed JSON schemas");
        vectors(
            raw["testVectorsJson"].as_str().unwrap(),
            raw["operationContracts"].as_array().unwrap(),
            &documents,
        )
        .expect("seed reference vectors");
        let seed =
            builtin_knowledge().expect("compiled seed passes the original registration validator");
        assert_eq!(seed.category, "knowledge");
        assert_eq!(seed.version, 1);
        let keys: BTreeMap<_, _> = seed.content["operationContracts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|op| {
                (
                    op["contractKey"].as_str().unwrap(),
                    op["permission"].as_str().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            keys,
            BTreeMap::from([
                ("knowledge.search@v1", "consume"),
                ("knowledge.read@v1", "read"),
                ("knowledge.export@v1", "export"),
                ("knowledge.ingest@v1", "update"),
                ("knowledge.delete@v1", "delete"),
            ])
        );
        let steps = seed.vectors["cases"][0]["steps"].as_array().unwrap();
        assert_eq!(steps.first().unwrap()["stepKey"], "ingest");
        assert_eq!(steps.last().unwrap()["stepKey"], "delete");
        for step in steps
            .iter()
            .filter(|step| matches!(step["stepKey"].as_str(), Some("read" | "export" | "delete")))
        {
            assert_eq!(step["referenceFromStepKey"], "ingest");
        }
    }

    #[test]
    fn builtin_data_query_uses_only_the_three_existing_native_consumers() {
        let seed = builtin_data_query().expect("compiled data-query schema and vectors");
        assert_eq!(seed.category, "data_query");
        assert_eq!(seed.version, 1);
        let keys: BTreeMap<_, _> = seed.content["operationContracts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|op| {
                (
                    op["contractKey"].as_str().unwrap(),
                    op["permission"].as_str().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            keys,
            BTreeMap::from([
                ("data_query.query@v1", "execute"),
                ("data_query.dry_run@v1", "execute"),
                ("data_query.describe@v1", "read"),
            ])
        );
        assert_eq!(seed.content["protocolSessionKinds"], json!([]));
        let documents: BTreeMap<String, Value> = seed
            .schemas
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| {
                (
                    entry["digest"].as_str().unwrap().to_owned(),
                    entry["schema"].clone(),
                )
            })
            .collect();
        let query = &seed.content["operationContracts"][0];
        let schema = &documents[query["inputSchemaDigest"].as_str().unwrap()];
        let validator = schema_validator(schema, &documents).unwrap();
        let reference = json!({"resourceId":Uuid::new_v4(),"nativeObjectRef":"opaque native intent",
            "nativeRevision":"a".repeat(64),"displayName":"query","mediaType":"application/json"});
        assert!(validator.is_valid(&reference));
        let mut credential_override = reference.clone();
        credential_override["secretRef"] = json!("caller-selected");
        assert!(!validator.is_valid(&credential_override));
        let mut invalid_revision = reference;
        invalid_revision["nativeRevision"] = json!("unknown");
        assert!(!validator.is_valid(&invalid_revision));
    }

    #[test]
    fn builtin_file_storage_preserves_seven_native_contracts_and_reference_closure() {
        let raw: Value = serde_json::from_str(include_str!(
            "../../../../contracts/adapter/file_storage.v1/registration.json"
        ))
        .unwrap();
        let typed: contracts::CapabilityContractRegistration =
            serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(serde_json::to_value(typed).unwrap(), raw);
        let supplied: BTreeMap<String, Value> = raw["schemaDocuments"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| {
                let schema: Value = serde_json::from_str(entry.as_str().unwrap()).unwrap();
                (collab_bridge::limits::canonical_digest(&schema), schema)
            })
            .collect();
        validate_schemas(&supplied).expect("original offline resolver compiles native schema refs");
        let seed =
            builtin_file_storage().expect("original registration consumes the file-storage seed");
        assert_eq!((seed.category.as_str(), seed.version), ("file_storage", 1));
        let operations = seed.content["operationContracts"].as_array().unwrap();
        let permissions: BTreeMap<_, _> = operations
            .iter()
            .map(|op| {
                (
                    op["contractKey"].as_str().unwrap(),
                    op["permission"].as_str().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            permissions,
            BTreeMap::from([
                ("file_storage.list@v1", "discover"),
                ("file_storage.read@v1", "read"),
                ("file_storage.list_revisions@v1", "read"),
                ("file_storage.export@v1", "export"),
                ("file_storage.write@v1", "update"),
                ("file_storage.delete@v1", "delete"),
                ("file_storage.share@v1", "share"),
            ])
        );
        let documents: BTreeMap<String, Value> = seed
            .schemas
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| {
                (
                    entry["digest"].as_str().unwrap().to_owned(),
                    entry["schema"].clone(),
                )
            })
            .collect();
        // All operation schemas remain the actual files; the only shared result
        // is the existing HUMAN/AGENT citations shape, not SERVICE list_output.
        let sources = [
            include_str!("../../../../contracts/adapter/file_storage.v1/list_input.schema.json"),
            include_str!("../../../../contracts/adapter/file_storage.v1/read_input.schema.json"),
            include_str!("../../../../contracts/adapter/file_storage.v1/read_output.schema.json"),
            include_str!(
                "../../../../contracts/adapter/file_storage.v1/list_revisions_input.schema.json"
            ),
            include_str!(
                "../../../../contracts/adapter/file_storage.v1/list_revisions_output.schema.json"
            ),
            include_str!("../../../../contracts/adapter/file_storage.v1/export_input.schema.json"),
            include_str!("../../../../contracts/adapter/file_storage.v1/export_output.schema.json"),
            include_str!("../../../../contracts/adapter/file_storage.v1/write_input.schema.json"),
            include_str!("../../../../contracts/adapter/file_storage.v1/write_output.schema.json"),
            include_str!("../../../../contracts/adapter/file_storage.v1/delete_input.schema.json"),
            include_str!("../../../../contracts/adapter/file_storage.v1/delete_output.schema.json"),
            include_str!("../../../../contracts/adapter/file_storage.v1/share_input.schema.json"),
            include_str!("../../../../contracts/adapter/file_storage.v1/share_output.schema.json"),
            include_str!("../../../../contracts/domain/content_reference.schema.json"),
        ];
        assert_eq!(documents.len(), sources.len());
        for source in sources {
            let schema: Value = serde_json::from_str(source).unwrap();
            assert_eq!(
                documents.get(&collab_bridge::limits::canonical_digest(&schema)),
                Some(&schema)
            );
        }
        let step = &seed.vectors["cases"][0]["steps"][1];
        let output: Value =
            serde_json::from_str(step["expectedOutputJson"].as_str().unwrap()).unwrap();
        let reference = output["citations"][0].clone();
        for key in ["file_storage.read@v1", "file_storage.export@v1"] {
            let operation = operations
                .iter()
                .find(|op| op["contractKey"] == key)
                .unwrap();
            let schema = &documents[operation["inputSchemaDigest"].as_str().unwrap()];
            let validator = schema_validator(schema, &documents).unwrap();
            assert!(validator.is_valid(&reference));
            let mut asset = reference.clone();
            asset["assetId"] = json!(Uuid::new_v4());
            assert!(
                !validator.is_valid(&asset),
                "do not replace native input with looser ContentReference"
            );
        }
        let list = operations
            .iter()
            .find(|op| op["contractKey"] == "file_storage.list@v1")
            .unwrap();
        let validator = schema_validator(
            &documents[list["outputSchemaDigest"].as_str().unwrap()],
            &documents,
        )
        .unwrap();
        assert!(validator.is_valid(&output));
        assert!(validator.is_valid(&json!({"citations":[]})));
        assert!(!validator.is_valid(&json!({"items":[]})));
        let mut malformed = output;
        malformed["citations"][0]
            .as_object_mut()
            .unwrap()
            .remove("nativeRevision");
        assert!(!validator.is_valid(&malformed));
        let reference_digest = collab_bridge::limits::canonical_digest(
            &serde_json::from_str::<Value>(sources[13]).unwrap(),
        );
        let mut missing = raw.clone();
        missing["schemaDocuments"]
            .as_array_mut()
            .unwrap()
            .retain(|doc| {
                collab_bridge::limits::canonical_digest(
                    &serde_json::from_str::<Value>(doc.as_str().unwrap()).unwrap(),
                ) != reference_digest
            });
        assert!(registration(&missing).is_err());
        let mut unused = raw.clone();
        unused["schemaDocuments"]
            .as_array_mut()
            .unwrap()
            .push(json!(json!({"type":"boolean"}).to_string()));
        assert!(registration(&unused).is_err());
        let cycle = [
            json!({"$id":"domain/cycle-a.schema.json","type":"object","properties":{"child":{"$ref":"cycle-b.schema.json"}}}),
            json!({"$id":"domain/cycle-b.schema.json","type":"object","properties":{"child":{"$ref":"cycle-a.schema.json"}}}),
        ];
        let mut unused_cycle = raw.clone();
        for schema in &cycle {
            unused_cycle["schemaDocuments"]
                .as_array_mut()
                .unwrap()
                .push(json!(schema.to_string()));
        }
        assert!(registration(&unused_cycle).is_err());
        let mut reachable_cycle = input(
            json!({"type":"object","properties":{"child":{"$ref":"domain/cycle-a.schema.json"}}}),
        );
        for schema in &cycle {
            reachable_cycle["schemaDocuments"]
                .as_array_mut()
                .unwrap()
                .push(json!(schema.to_string()));
        }
        assert!(registration(&reachable_cycle).is_ok());
        let mut duplicate = raw.clone();
        let mut duplicate_id: Value = serde_json::from_str(sources[13]).unwrap();
        duplicate_id["description"] = json!("conflicting same schema identity");
        duplicate["schemaDocuments"]
            .as_array_mut()
            .unwrap()
            .push(json!(duplicate_id.to_string()));
        assert!(registration(&duplicate).is_err());
        let mut external = raw;
        let document = external["schemaDocuments"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|doc| {
                serde_json::from_str::<Value>(doc.as_str().unwrap()).unwrap()["title"]
                    == "FileStorageListRevisionsOutput"
            })
            .unwrap();
        let mut schema: Value = serde_json::from_str(document.as_str().unwrap()).unwrap();
        schema["properties"]["citations"]["items"]["$ref"] =
            json!("https://unregistered.invalid/reference");
        *document = json!(schema.to_string());
        assert!(registration(&external).is_err());
    }

    #[test]
    fn native_sync_contract_preserves_all_existing_knowledge_operations() {
        let raw: Value = serde_json::from_str(include_str!(
            "../../../../contracts/adapter/knowledge.v2/registration.json"
        ))
        .unwrap();
        let registered = registration(&raw).expect("v2 uses the existing Catalog validator");
        assert_eq!(registered.version, 2);
        let operations: BTreeMap<_, _> = registered.content["operationContracts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|op| {
                (
                    op["contractKey"].as_str().unwrap(),
                    op["permission"].as_str().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            operations,
            BTreeMap::from([
                ("knowledge.search@v2", "consume"),
                ("knowledge.read@v2", "read"),
                ("knowledge.export@v2", "export"),
                ("knowledge.ingest@v2", "update"),
                ("knowledge.delete@v2", "delete"),
                ("knowledge.sync_apply@v2", "update"),
                ("knowledge.sync_retire@v2", "delete"),
            ])
        );
        assert_eq!(
            builtin_knowledge().unwrap().version,
            1,
            "published v1 bootstrap is unchanged"
        );
        let reference_schema: Value = serde_json::from_str(include_str!(
            "../../../../contracts/domain/content_reference.schema.json"
        ))
        .unwrap();
        let reference_digest = collab_bridge::limits::canonical_digest(&reference_schema);
        for operation in registered.content["operationContracts"].as_array().unwrap() {
            if matches!(
                operation["contractKey"].as_str(),
                Some(
                    "knowledge.ingest@v2"
                        | "knowledge.read@v2"
                        | "knowledge.export@v2"
                        | "knowledge.delete@v2"
                )
            ) {
                assert_eq!(operation["inputSchemaDigest"], reference_digest);
            }
        }
        let steps = registered.vectors["cases"][0]["steps"].as_array().unwrap();
        let source: Value = serde_json::from_str(steps[0]["inputJson"].as_str().unwrap()).unwrap();
        let reference: contracts::ContentReference =
            serde_json::from_value(source.clone()).unwrap();
        assert_eq!(serde_json::to_value(reference).unwrap(), source);
        assert_ne!(source["resourceId"], steps[0]["referenceResourceId"]);
        for step in steps
            .iter()
            .filter(|step| matches!(step["stepKey"].as_str(), Some("read" | "export" | "delete")))
        {
            assert_eq!(step["referenceFromStepKey"], "ingest");
            assert_eq!(step["referenceResourceId"], steps[0]["referenceResourceId"]);
        }
        let mut legacy = raw.clone();
        let mut vectors: Value =
            serde_json::from_str(legacy["testVectorsJson"].as_str().unwrap()).unwrap();
        vectors["cases"][0]["steps"][0]["inputJson"] =
            json!(r#"{"title":"conformance","text":"body"}"#);
        legacy["testVectorsJson"] = json!(vectors.to_string());
        assert!(
            registration(&legacy).is_err(),
            "Core must not admit document bodies as ingest parameters"
        );
    }

    #[tokio::test]
    #[ignore = "requires isolated database with current migrations; transaction always rolled back"]
    async fn builtin_knowledge_bootstrap_is_audited_idempotent_and_cannot_reactivate() {
        let pool =
            sqlx::PgPool::connect(&std::env::var("TEST_DATABASE_URL").expect("isolated database"))
                .await
                .unwrap();
        let mut tx = pool.begin().await.unwrap();
        let tenant = Uuid::new_v4();
        sqlx::query(
            "insert into identity.tenant(id,slug,name,state) values($1,$2,'seed fixture','ACTIVE')",
        )
        .bind(tenant)
        .bind(format!("seed-{}", tenant.simple()))
        .execute(&mut *tx)
        .await
        .unwrap();
        sqlx::query("insert into identity.relay_operator_identity(catalog_tenant_id,pubkey,private_key_secret_ref,audience,relay_operator_api_origin,state,private_key_secret_version,private_key_secret_audience)
            values($1,$2,'fixture-reference','fixture-audience','https://relay.invalid','ACTIVE',1,'fixture-service')")
            .bind(tenant).bind(format!("{:0>64}", tenant.simple())).execute(&mut *tx).await.unwrap();
        bootstrap_contract(&mut tx, tenant, builtin_knowledge().unwrap())
            .await
            .unwrap();
        bootstrap_contract(&mut tx, tenant, builtin_knowledge().unwrap())
            .await
            .unwrap();
        let row: (String, Option<Uuid>, Option<Uuid>, Option<Uuid>) = sqlx::query_as(
            "select status,registered_by_action_execution_id,approved_by_action_execution_id,bootstrap_action_execution_id
             from catalog.capability_contract where category_key='knowledge' and catalog_tenant_id=$1")
            .bind(tenant).fetch_one(&mut *tx).await.unwrap();
        assert_eq!(row.0, "ACTIVE");
        assert!(row.1.is_none() && row.2.is_none() && row.3.is_some());
        let (actions, audits): (i64, i64) = sqlx::query_as(
            "select (select count(*) from admission.action_execution where tenant_id=$1 and action_key=$2),
                    (select count(*) from audit.audit_event where tenant_id=$1 and action_key=$2)")
            .bind(tenant).bind(BOOTSTRAP).fetch_one(&mut *tx).await.unwrap();
        assert_eq!((actions, audits), (1, 3));
        bootstrap_contract(&mut tx, tenant, builtin_data_query().unwrap())
            .await
            .unwrap();
        bootstrap_contract(&mut tx, tenant, builtin_data_query().unwrap())
            .await
            .unwrap();
        let counts: (i64, i64) = sqlx::query_as(
            "select (select count(*) from admission.action_execution where tenant_id=$1 and action_key=$2),
                    (select count(*) from audit.audit_event where tenant_id=$1 and action_key=$2)")
            .bind(tenant).bind(BOOTSTRAP).fetch_one(&mut *tx).await.unwrap();
        assert_eq!(counts, (2, 6));
        let query_seed: (String, Uuid) = sqlx::query_as(
            "select status,bootstrap_action_execution_id from catalog.capability_contract
             where category_key='data_query' and contract_version=1 and catalog_tenant_id=$1",
        )
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert_eq!(query_seed.0, "ACTIVE");
        let providers_before: (i64, i64) = sqlx::query_as(
            "select (select count(*) from catalog.component_release),
                    (select count(*) from catalog.application_binding)",
        )
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        bootstrap_contract(&mut tx, tenant, builtin_file_storage().unwrap())
            .await
            .unwrap();
        bootstrap_contract(&mut tx, tenant, builtin_file_storage().unwrap())
            .await
            .unwrap();
        let counts: (i64, i64, i64, i64) = sqlx::query_as(
            "select (select count(*) from admission.action_execution where tenant_id=$1 and action_key=$2),
                    (select count(*) from audit.audit_event where tenant_id=$1 and action_key=$2),
                    (select count(*) from catalog.component_release),
                    (select count(*) from catalog.application_binding)")
            .bind(tenant).bind(BOOTSTRAP).fetch_one(&mut *tx).await.unwrap();
        assert_eq!((counts.0, counts.1), (3, 9));
        assert_eq!(
            (counts.2, counts.3),
            providers_before,
            "seed does not register or activate any provider"
        );
        let file_seed: (String, Uuid) = sqlx::query_as(
            "select status,bootstrap_action_execution_id from catalog.capability_contract
             where category_key='file_storage' and contract_version=1 and catalog_tenant_id=$1",
        )
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert_eq!(file_seed.0, "ACTIVE");
        for (owner, version, expected) in [
            (tenant, 1, true),
            (tenant, 2, false),
            (Uuid::new_v4(), 1, false),
        ] {
            let accepted: bool = sqlx::query_scalar(
                "select catalog.valid_capability_seed_bootstrap($1,$2,'file_storage',$3,$4)",
            )
            .bind(file_seed.1)
            .bind(owner)
            .bind(version)
            .bind(target_id(tenant, "file_storage", 1))
            .fetch_one(&mut *tx)
            .await
            .unwrap();
            assert_eq!(accepted, expected);
        }
        {
            let mut rollback = tx.begin().await.unwrap();
            let refused = sqlx::raw_sql(include_str!(
                "../../../migrations/20261011010000_capability_file_storage_seed.down.sql"
            ))
            .execute(&mut *rollback)
            .await
            .unwrap_err();
            assert_eq!(
                refused.as_database_error().unwrap().code().as_deref(),
                Some("23514")
            );
            rollback.rollback().await.unwrap();
        }
        let mut conflicting_file = builtin_file_storage().unwrap();
        conflicting_file.content["requiredDeclarations"] = json!([]);
        assert!(bootstrap_contract(&mut tx, tenant, conflicting_file)
            .await
            .is_err());
        let query_target = target_id(tenant, "data_query", 1);
        {
            // Revert must not orphan an installed immutable seed. Use the
            // actual down migration in a savepoint, not a copied predicate.
            let mut rollback = tx.begin().await.unwrap();
            let refused = sqlx::raw_sql(include_str!(
                "../../../migrations/20261010040000_capability_data_query_seed.down.sql"
            ))
            .execute(&mut *rollback)
            .await
            .unwrap_err();
            assert_eq!(
                refused.as_database_error().unwrap().code().as_deref(),
                Some("23514")
            );
            rollback.rollback().await.unwrap();
        }
        for (category, version, expected) in [
            ("data_query", 1, true),
            ("data_query", 2, false),
            ("unknown", 1, false),
        ] {
            let accepted: bool = sqlx::query_scalar(
                "select catalog.valid_capability_seed_bootstrap($1,$2,$3,$4,$5)",
            )
            .bind(query_seed.1)
            .bind(tenant)
            .bind(category)
            .bind(version)
            .bind(query_target)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
            assert_eq!(accepted, expected);
        }
        let mut conflicting = builtin_data_query().unwrap();
        conflicting.content["requiredDeclarations"] = json!([]);
        assert!(bootstrap_contract(&mut tx, tenant, conflicting)
            .await
            .is_err());
        let target = target_id(tenant, "knowledge", 1);
        let accepted: bool = sqlx::query_scalar(
            "select catalog.valid_capability_seed_bootstrap($1,$2,'knowledge',1,$3)",
        )
        .bind(row.3)
        .bind(Uuid::new_v4())
        .bind(target)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert!(!accepted);
        let actor = Uuid::new_v4();
        let deprecation = Uuid::new_v4();
        sqlx::query("insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'HUMAN','ACTIVE')")
            .bind(actor).bind(tenant).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into admission.action_execution(id,operation_id,tenant_id,action_key,action_version,
            initiator_principal_id,actor_principal_id,target_id,parameter_hash,parameters,gate_state,dispatch_state,correlation_id)
            values($1,$1,$2,'capability_contract.deprecate',1,$3,$3,$4,$5,'{\"targetVersion\":1}','ALLOWED','DISPATCHED',$1)")
            .bind(deprecation).bind(tenant).bind(actor).bind(target).bind("a".repeat(64)).execute(&mut *tx).await.unwrap();
        sqlx::query("update catalog.capability_contract set status='DEPRECATED',deprecated_by_action_execution_id=$1 where id=$2")
            .bind(deprecation).bind(target).execute(&mut *tx).await.unwrap();
        bootstrap_contract(&mut tx, tenant, builtin_knowledge().unwrap())
            .await
            .unwrap();
        let status: String =
            sqlx::query_scalar("select status from catalog.capability_contract where id=$1")
                .bind(target)
                .fetch_one(&mut *tx)
                .await
                .unwrap();
        assert_eq!(status, "DEPRECATED");
        tx.rollback().await.unwrap();
    }

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
