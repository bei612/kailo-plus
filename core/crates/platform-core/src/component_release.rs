//! ComponentRelease 的登记内容归 Catalog；套件实际执行归原 ComponentTaskWorkflow。
//! REGISTERED 不授予 binding、工具或前端入口，approve/revoke 不由登记代行。

use std::collections::{BTreeMap, BTreeSet};

use contracts::ReasonCode;
use serde_json::{json, Value};
use sha2::Digest;
use sqlx::PgConnection;
use uuid::Uuid;

use crate::governance::{Definition, Execution, Params, Refusal, Target};

#[path = "component_release_approval.rs"]
pub(crate) mod approval;

pub(crate) const REGISTER: &str = "component_release.register";
pub(crate) const KIND: &str = "COMPONENT_RELEASE";

fn bad() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

fn exact_fields(value: &Value, required: &[&str], optional: &[&str]) -> Result<(), Refusal> {
    let object = value.as_object().ok_or_else(bad)?;
    if required.iter().any(|key| !object.contains_key(*key))
        || object
            .keys()
            .any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str()))
    {
        return Err(bad());
    }
    Ok(())
}

fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, Refusal> {
    value[key]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(bad)
}

fn digest(value: &str) -> bool {
    value.len() == sha2::Sha256::output_size() * 2
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn identifier(value: &str) -> bool {
    let mut bytes = value.bytes();
    bytes.next().is_some_and(|c| c.is_ascii_lowercase())
        && bytes.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
}

/// Only immutable metadata is retained. Native result bodies remain in the
/// candidate; the report carries exact digests and original execution refs.
pub(crate) struct Registration {
    pub id: Uuid,
    pub component_type_key: String,
    pub version: String,
    pub manifest: Value,
    pub package: Value,
    pub binding_config_schema: Value,
    pub manifest_digest: String,
    pub package_digest: String,
    pub adapter_digest: String,
    pub contracts: Vec<(String, i32)>,
}

// Class/connector combinations are closed design values, not release-supplied
// execution code. Unsupported delivery modes cannot enter this dispatch path.
pub(crate) fn registration(raw: &Value) -> Result<Registration, Refusal> {
    exact_fields(
        raw,
        &["manifestJson", "packageJson", "bindingConfigSchemaJson"],
        &[],
    )?;
    let manifest: Value = serde_json::from_str(text(raw, "manifestJson")?).map_err(|_| bad())?;
    let package: Value = serde_json::from_str(text(raw, "packageJson")?).map_err(|_| bad())?;
    let config: Value =
        serde_json::from_str(text(raw, "bindingConfigSchemaJson")?).map_err(|_| bad())?;
    exact_fields(
        &manifest,
        &[
            "id",
            "componentTypeKey",
            "version",
            "class",
            "platformPortKey",
            "manifestSchemaVersion",
            "bindingConfigSchemaVersion",
            "bindingConfigSchemaDigest",
            "frontendDelivery",
            "executionConnector",
            "admissionPath",
            "implements",
            "capabilityDeclarations",
            "allowedModelCallModes",
            "dataStoreIsolation",
            "dataLocation",
            "secretSchema",
            "targetResourceTypeKeys",
            "resourceTypeDefinitions",
            "actionDefinitions",
            "toolDefinitions",
            "businessObservabilityContract",
            "frontendPresentationContract",
            "adapterBuildRef",
        ],
        &[
            "sourceProject",
            "sourceCommit",
            "vendor",
            "artifactVersion",
            "hostApiRange",
            "adapterProtocolRange",
        ],
    )?;
    let id = Uuid::parse_str(text(&manifest, "id")?).map_err(|_| bad())?;
    let type_key = text(&manifest, "componentTypeKey")?;
    if !identifier(type_key)
        || id.is_nil()
        || text(&manifest, "class")? != "APPLICATION"
        || text(&manifest, "platformPortKey")? != "NONE"
        || text(&manifest, "admissionPath")? != "EXTERNAL"
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    // EXTERNAL source identity is the vendor/artifact pair. Optional upstream
    // metadata does not substitute for the actual conformance evidence.
    text(&manifest, "vendor")?;
    text(&manifest, "artifactVersion")?;
    if let Some(commit) = manifest.get("sourceCommit") {
        let commit = commit.as_str().ok_or_else(bad)?;
        if commit.len() != 40 || !commit.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err(bad());
        }
    }
    if manifest.get("sourceProject").is_some() {
        text(&manifest, "sourceProject")?;
    }
    let version = text(&manifest, "version")?.to_owned();
    let parsed_version = semver::Version::parse(&version).map_err(|_| bad())?;
    if parsed_version.to_string() != version {
        return Err(bad());
    }
    if manifest["manifestSchemaVersion"] != json!(1)
        || manifest["bindingConfigSchemaVersion"]
            .as_i64()
            .is_none_or(|value| value <= 0)
    {
        return Err(bad());
    }
    let frontend = &manifest["frontendDelivery"];
    exact_fields(
        frontend,
        &["mode", "extensionSlots", "editorOrigins"],
        &["nativePageOrigins"],
    )?;
    if !matches!(frontend["mode"].as_str(), Some("NONE" | "NATIVE_PAGE"))
        || frontend["extensionSlots"] != json!([])
        || frontend["editorOrigins"] != json!([])
        || manifest.get("hostApiRange").is_some()
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    if frontend["mode"] == "NATIVE_PAGE" {
        crate::application_page::release_origins(frontend)?;
    } else if frontend
        .get("nativePageOrigins")
        .is_some_and(|value| value != &json!([]))
    {
        return Err(bad());
    }
    let connector = &manifest["executionConnector"];
    exact_fields(
        connector,
        &["mode", "adapterProtocolRange", "actionTokenAudience"],
        &[],
    )?;
    if connector["mode"] != "REMOTE_ADAPTER"
        || connector["adapterProtocolRange"] != "1"
        || manifest["adapterProtocolRange"] != "1"
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    text(connector, "actionTokenAudience")?;
    let adapter_digest = text(&manifest, "adapterBuildRef")?.to_owned();
    if !digest(&adapter_digest) {
        return Err(bad());
    }
    if !matches!(
        text(&manifest, "dataStoreIsolation")?,
        "DEDICATED_INSTANCE" | "DEDICATED_DATABASE" | "VENDOR_MANAGED"
    ) {
        return Err(bad());
    }
    text(&manifest, "dataLocation")?;
    // No model gateway consumer is admitted by this metadata path. A component
    // declaring model use must first have the corresponding governed connector.
    if manifest["allowedModelCallModes"] != json!(["NONE"]) {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let mut secrets = BTreeSet::new();
    for secret in manifest["secretSchema"].as_array().ok_or_else(bad)? {
        exact_fields(
            secret,
            &[
                "secretKey",
                "valueType",
                "lengthOrFormat",
                "rotationClass",
                "deliveryMode",
                "restartRequired",
            ],
            &[],
        )?;
        let key = text(secret, "secretKey")?;
        if !identifier(key)
            || !secrets.insert(key)
            || !matches!(
                text(secret, "rotationClass")?,
                "SERVICE_CREDENTIAL" | "DATA_KEY"
            )
            || secret["restartRequired"].as_bool().is_none()
        {
            return Err(bad());
        }
        for field in ["valueType", "lengthOrFormat", "deliveryMode"] {
            text(secret, field)?;
        }
    }
    let mut contracts = Vec::new();
    let mut seen = BTreeSet::new();
    for contract in manifest["implements"].as_array().ok_or_else(bad)? {
        exact_fields(contract, &["categoryKey", "contractVersion"], &[])?;
        let category = text(contract, "categoryKey")?;
        let version = contract["contractVersion"]
            .as_i64()
            .and_then(|n| i32::try_from(n).ok())
            .filter(|n| *n > 0)
            .ok_or_else(bad)?;
        if !identifier(category)
            || category == "component"
            || !seen.insert((category.to_owned(), version))
        {
            return Err(bad());
        }
        contracts.push((category.to_owned(), version));
    }
    if contracts.is_empty() {
        return Err(bad());
    }
    let declarations = manifest["capabilityDeclarations"]
        .as_array()
        .ok_or_else(bad)?;
    let mut declared = BTreeSet::new();
    for declaration in declarations {
        exact_fields(
            declaration,
            &[
                "categoryKey",
                "contractVersion",
                "cancel",
                "observe",
                "meter",
                "revisionQuery",
                "versionedModel",
                "onlineEditing",
                "readEdge",
                "tenantDelete",
            ],
            &[],
        )?;
        let category = text(declaration, "categoryKey")?;
        let version = declaration["contractVersion"]
            .as_i64()
            .and_then(|value| i32::try_from(value).ok())
            .ok_or_else(bad)?;
        if !seen.contains(&(category.to_owned(), version))
            || !declared.insert((category.to_owned(), version))
        {
            return Err(bad());
        }
        for key in [
            "cancel",
            "observe",
            "meter",
            "revisionQuery",
            "versionedModel",
            "onlineEditing",
        ] {
            if !matches!(text(declaration, key)?, "SUPPORTED" | "UNSUPPORTED") {
                return Err(bad());
            }
        }
        if !matches!(
            text(declaration, "readEdge")?,
            "SOURCE" | "RECEIVER" | "BOTH" | "NONE"
        ) || !matches!(
            text(declaration, "tenantDelete")?,
            "SUPPORTED" | "RETAIN_ON_TENANT_DELETE"
        ) || (declaration["onlineEditing"] == "SUPPORTED"
            && declaration["revisionQuery"] != "SUPPORTED")
        {
            return Err(bad());
        }
    }
    if declared != seen {
        return Err(bad());
    }
    let presentation = &manifest["frontendPresentationContract"];
    exact_fields(
        presentation,
        &[
            "integrationMode",
            "themeMapping",
            "localeMapping",
            "themeChangePolicy",
            "localeResolutionPolicy",
        ],
        &[],
    )?;
    if presentation["integrationMode"] != "NONE"
        || presentation["themeChangePolicy"] != "NONE"
        || presentation["localeResolutionPolicy"] != "NONE"
        || presentation["themeMapping"] != json!({})
        || presentation["localeMapping"] != json!({})
    {
        return Err(bad());
    }
    let observability = &manifest["businessObservabilityContract"];
    exact_fields(
        observability,
        &[
            "correlationSources",
            "businessStateSources",
            "aggregationDimensions",
            "redactionPolicy",
        ],
        &[],
    )?;
    let correlation = observability["correlationSources"]
        .as_array()
        .ok_or_else(bad)?;
    let states = observability["businessStateSources"]
        .as_array()
        .ok_or_else(bad)?;
    if !correlation.contains(&json!("OPERATION_ID"))
        || !states.contains(&json!("NATIVE_STATUS"))
        || correlation.iter().any(|value| {
            !matches!(
                value.as_str(),
                Some("OPERATION_ID" | "NATIVE_REF" | "GATEWAY_REQUEST_LOG")
            )
        })
        || states.iter().any(|value| {
            !matches!(
                value.as_str(),
                Some(
                    "CORE_ACTION"
                        | "BUZZ_EVENT"
                        | "TEMPORAL"
                        | "NATIVE_STATUS"
                        | "AGENTGATEWAY"
                        | "OPENMETER"
                )
            )
        })
        || observability["redactionPolicy"] != "PLATFORM_METADATA_ONLY"
    {
        return Err(bad());
    }
    for dimension in observability["aggregationDimensions"]
        .as_array()
        .ok_or_else(bad)?
    {
        if dimension
            .as_str()
            .is_none_or(|value| value.trim().is_empty())
        {
            return Err(bad());
        }
    }
    exact_fields(
        &package,
        &[
            "componentReleaseId",
            "manifestDigest",
            "webArtifacts",
            "backendDelivery",
        ],
        &[],
    )?;
    let manifest_digest = collab_bridge::limits::canonical_digest(&manifest);
    if package["componentReleaseId"] != json!(id)
        || package["manifestDigest"] != manifest_digest
        || package["webArtifacts"] != json!([])
        || package["backendDelivery"] != "EXTERNAL_SERVICE"
    {
        return Err(bad());
    }
    let package_digest = collab_bridge::limits::canonical_digest(&package);
    if manifest["bindingConfigSchemaDigest"] != collab_bridge::limits::canonical_digest(&config)
        || jsonschema::meta::try_validate(&config)
            .map_err(|_| bad())?
            .is_err()
    {
        return Err(bad());
    }
    crate::capability_contract::schema_validator(&config, &BTreeMap::new())?;
    Ok(Registration {
        id,
        component_type_key: type_key.to_owned(),
        version,
        manifest,
        package,
        binding_config_schema: config,
        manifest_digest,
        package_digest,
        adapter_digest,
        contracts,
    })
}

/// Catalog rows are read from the original authority, not copied into a new
/// category registry. Approval/deprecation races invalidate registration.
pub(crate) async fn active_contracts(
    conn: &mut PgConnection,
    tenant: Uuid,
    registration: &Registration,
) -> Result<Vec<Value>, Refusal> {
    let mut contracts = Vec::new();
    for (category, version) in &registration.contracts {
        let row: Option<(Value, Value, Value, String, String)> = sqlx::query_as(
            "select c.content,c.schema_documents,c.test_vectors,c.schema_set_digest,c.conformance_suite_digest
             from catalog.capability_contract c join catalog.capability_category category using(category_key)
             where c.category_key=$1 and c.contract_version=$2 and c.catalog_tenant_id=$3
               and c.status='ACTIVE' and category.status='ACTIVE' and category.catalog_tenant_id=$3 for share")
            .bind(category).bind(version).bind(tenant).fetch_optional(&mut *conn).await?;
        let Some((content, schemas, vectors, schema_digest, suite_digest)) = row else {
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        };
        if collab_bridge::limits::canonical_digest(&schemas) != schema_digest
            || collab_bridge::limits::canonical_digest(&vectors) != suite_digest
        {
            return Err(Refusal::Unavailable(
                "Catalog contract digest mismatch".into(),
            ));
        }
        contracts.push(
            json!({"content":content,"schemas":schemas,"vectors":vectors,
            "schemaDigest":schema_digest,"suiteDigest":suite_digest}),
        );
    }
    validate_declarations(registration, &contracts)?;
    for contract in &contracts {
        let has_roundtrip = contract["vectors"]["cases"]
            .as_array()
            .ok_or_else(bad)?
            .iter()
            .any(|case| {
                case["steps"].as_array().is_some_and(|steps| {
                    steps
                        .iter()
                        .any(|step| step.get("referenceFromStepKey").is_some())
                })
            });
        if !has_roundtrip {
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        }
    }
    Ok(contracts)
}

// Manifest entries are release declarations, not live business Resources or
// ToolDefinitions. COMPONENT_BINDING instantiates them later in its real scope.
// A declaration cannot smuggle an owner, tenant, Resource ID or credential.
fn validate_declarations(release: &Registration, contracts: &[Value]) -> Result<(), Refusal> {
    let manifest = &release.manifest;
    let resources = manifest["resourceTypeDefinitions"]
        .as_array()
        .ok_or_else(bad)?;
    let actions = manifest["actionDefinitions"].as_array().ok_or_else(bad)?;
    let tools = manifest["toolDefinitions"].as_array().ok_or_else(bad)?;
    let mut resource_keys = BTreeSet::new();
    let mut action_keys = BTreeSet::new();
    let mut tool_keys = BTreeSet::new();
    for resource in resources {
        exact_fields(
            resource,
            &[
                "typeKey",
                "capabilityCategory",
                "capabilityContractVersion",
                "incrementalContracts",
                "llmGatewayContract",
                "transferFormats",
                "tenantDeleteActionKey",
                "status",
            ],
            &[],
        )?;
        let key = text(resource, "typeKey")?;
        if !resource_keys.insert(key.to_owned())
            || resource["status"] != "ACTIVE"
            || resource["llmGatewayContract"] != "NOT_USED"
        {
            return Err(bad());
        }
        // Transfer requires two independently governed cross-Tenant actions;
        // this registration path does not pretend that an arbitrary string is
        // an already registered importer/exporter.
        if resource["transferFormats"] != json!([]) {
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        }
        for incremental in resource["incrementalContracts"]
            .as_array()
            .ok_or_else(bad)?
        {
            exact_fields(
                incremental,
                &[
                    "contractKey",
                    "role",
                    "engine",
                    "stableKeyRule",
                    "revisionRule",
                    "deleteSemantics",
                    "reconciliationTrigger",
                    "readinessSemantics",
                ],
                &[],
            )?;
            if !matches!(
                text(incremental, "role")?,
                "NATIVE_INTERNAL" | "VERSIONED_PUBLICATION"
            ) || !matches!(
                text(incremental, "engine")?,
                "NATIVE" | "VERSIONED_REPUBLISH"
            ) {
                return Err(bad());
            }
            for field in [
                "contractKey",
                "stableKeyRule",
                "revisionRule",
                "deleteSemantics",
                "reconciliationTrigger",
                "readinessSemantics",
            ] {
                text(incremental, field)?;
            }
        }
        text(resource, "tenantDeleteActionKey")?;
    }
    let targets = manifest["targetResourceTypeKeys"]
        .as_array()
        .ok_or_else(bad)?;
    let target_keys: BTreeSet<_> = targets
        .iter()
        .map(|value| value.as_str().map(str::to_owned).ok_or_else(bad))
        .collect::<Result<_, _>>()?;
    if resource_keys.is_empty()
        || target_keys != resource_keys
        || target_keys.len() != targets.len()
    {
        return Err(bad());
    }
    for action in actions {
        exact_fields(
            action,
            &[
                "actionKey",
                "capabilityContractKey",
                "componentTypeKey",
                "targetType",
                "tenantRule",
                "workspaceRule",
                "permission",
                "executionMode",
                "confirmationMode",
                "approvalPolicyId",
                "workflowType",
                "capacityPolicy",
                "capacityPoolKey",
                "quotaPolicy",
                "meters",
                "resultExposurePolicy",
                "auditPolicy",
                "businessObservabilityPolicy",
                "version",
                "status",
                "inputSchemaDigest",
                "outputSchemaDigest",
            ],
            &[],
        )?;
        let key = text(action, "actionKey")?;
        if !action_keys.insert(key.to_owned())
            || action["capabilityContractKey"] != key
            || action["componentTypeKey"] != release.component_type_key
            || action["status"] != "ACTIVE"
            || action["version"]
                .as_i64()
                .is_none_or(|version| version <= 0)
            || action["tenantRule"] != "SESSION_TENANT"
            || !matches!(
                text(action, "workspaceRule")?,
                "TENANT_ONLY"
                    | "WORKSPACE_REQUIRED"
                    | "TARGET_HOME_WORKSPACE"
                    | "DECLARED_WORKSPACE"
            )
            || !matches!(text(action, "targetType")?, "RESOURCE" | "ASSET")
            || !matches!(
                text(action, "executionMode")?,
                "SYNC" | "PROTOCOL" | "TEMPORAL"
            )
            || !matches!(
                text(action, "confirmationMode")?,
                "NONE" | "EXPLICIT" | "APPROVAL"
            )
            || action["capacityPolicy"] != "NATIVE"
            || action["capacityPoolKey"] != "NONE"
            || !matches!(
                text(action, "quotaPolicy")?,
                "NONE" | "CHECK" | "STRICT_RESERVATION"
            )
            || action["auditPolicy"] != "FULL_LIFECYCLE"
        {
            return Err(bad());
        }
        if (action["confirmationMode"] == "APPROVAL") == (action["approvalPolicyId"] == "NONE")
            || (action["executionMode"] == "TEMPORAL")
                != (action["workflowType"] == "ComponentTaskWorkflow")
            || (action["executionMode"] != "TEMPORAL" && action["workflowType"] != "NONE")
        {
            return Err(bad());
        }
        if action["approvalPolicyId"] != "NONE" {
            Uuid::parse_str(text(action, "approvalPolicyId")?).map_err(|_| bad())?;
        }
        let meters = action["meters"].as_array().ok_or_else(bad)?;
        if meters
            .iter()
            .any(|meter| meter.as_str().is_none_or(|key| key.trim().is_empty()))
            || (action["quotaPolicy"] == "NONE" && !meters.is_empty())
        {
            return Err(bad());
        }
        let exposure = &action["resultExposurePolicy"];
        exact_fields(
            exposure,
            &["mode", "outputSchemaHash", "redactionPolicy"],
            &[],
        )?;
        if !matches!(text(exposure, "mode")?, "CONSUME_ONLY" | "READ" | "EXPORT")
            || exposure["outputSchemaHash"] != action["outputSchemaDigest"]
            || exposure["redactionPolicy"] != "PLATFORM_METADATA_ONLY"
        {
            return Err(bad());
        }
        let policy = &action["businessObservabilityPolicy"];
        exact_fields(
            policy,
            &[
                "correlationMode",
                "progressSource",
                "terminalSource",
                "usageSource",
                "costSource",
                "redactionPolicy",
            ],
            &[],
        )?;
        if !matches!(
            text(policy, "correlationMode")?,
            "OPERATION_REF" | "OPERATION_NATIVE_REF"
        ) || !matches!(
            text(policy, "progressSource")?,
            "NONE" | "TEMPORAL" | "NATIVE"
        ) || !matches!(
            text(policy, "terminalSource")?,
            "SYNC_RESULT" | "TEMPORAL" | "NATIVE"
        ) || !matches!(
            text(policy, "usageSource")?,
            "NONE" | "DRIVER" | "OPENMETER"
        ) || !matches!(text(policy, "costSource")?, "NONE" | "OPENMETER")
            || policy["redactionPolicy"] != "PLATFORM_METADATA_ONLY"
        {
            return Err(bad());
        }
    }
    for tool in tools {
        exact_fields(
            tool,
            &[
                "name",
                "source",
                "actionKey",
                "capabilityContractKey",
                "inputSchemaHash",
                "outputSchemaHash",
                "backendRef",
                "status",
            ],
            &[],
        )?;
        let key = text(tool, "capabilityContractKey")?;
        if tool["source"] != "APPLICATION"
            || tool["status"] != "ACTIVE"
            || tool["actionKey"] != key
            || !tool_keys.insert(key.to_owned())
            || !action_keys.contains(key)
        {
            return Err(bad());
        }
        text(tool, "name")?;
        text(tool, "backendRef")?;
    }
    let mut expected_resources = BTreeSet::new();
    let mut expected_actions = BTreeSet::new();
    let mut expected_tools = BTreeSet::new();
    for contract in contracts {
        let content = &contract["content"];
        for required in content["resourceTypeFamily"].as_array().ok_or_else(bad)? {
            let key = text(required, "typeKey")?;
            let resource = resources
                .iter()
                .find(|resource| resource["typeKey"] == key)
                .ok_or_else(bad)?;
            if resource["capabilityCategory"] != content["categoryKey"]
                || resource["capabilityContractVersion"] != content["contractVersion"]
            {
                return Err(bad());
            }
            expected_resources.insert(key.to_owned());
        }
        for operation in content["operationContracts"].as_array().ok_or_else(bad)? {
            let key = text(operation, "contractKey")?;
            let action = actions
                .iter()
                .find(|action| action["actionKey"] == key)
                .ok_or_else(bad)?;
            for (actual, expected) in [
                ("permission", "permission"),
                ("targetType", "targetType"),
                ("inputSchemaDigest", "inputSchemaDigest"),
                ("outputSchemaDigest", "outputSchemaDigest"),
            ] {
                if action[actual] != operation[expected] {
                    return Err(bad());
                }
            }
            expected_actions.insert(key.to_owned());
            if operation["surface"] == "TOOL" {
                let tool = tools
                    .iter()
                    .find(|tool| tool["capabilityContractKey"] == key)
                    .ok_or_else(bad)?;
                if tool["inputSchemaHash"] != operation["inputSchemaDigest"]
                    || tool["outputSchemaHash"] != operation["outputSchemaDigest"]
                {
                    return Err(bad());
                }
                expected_tools.insert(key.to_owned());
            }
        }
    }
    if expected_resources != resource_keys
        || expected_actions != action_keys
        || expected_tools != tool_keys
    {
        return Err(bad());
    }
    Ok(())
}

/// Fixture requests are data delivered with the isolated candidate, not an
/// executable upload and not an administrator's assertion of suite success.
/// The fixed cases below retain the wire semantics of 07 §5.2/§8A; they are not
/// an extensible assertion language or a second workflow scheduler.
fn protocol_fixture(registration: &Registration) -> Result<Value, Refusal> {
    let path = std::env::var("COMPONENT_CONFORMANCE_FIXTURE_FILE")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    let bytes = std::fs::read(path)
        .map_err(|_| Refusal::Unavailable("isolated conformance fixture unavailable".into()))?;
    let fixture: Value = serde_json::from_slice(&bytes).map_err(|_| bad())?;
    exact_fields(&fixture, &["artifactDigest", "steps"], &[])?;
    let typed: contracts::ComponentConformanceFixture =
        serde_json::from_value(fixture.clone()).map_err(|_| bad())?;
    if serde_json::to_value(typed).map_err(|_| bad())? != fixture
        || fixture["artifactDigest"] != registration.adapter_digest
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let steps = fixture["steps"].as_array().ok_or_else(bad)?;
    let cases: &[(&str, &[&str])] = &[
        ("protocol_handshake", &["handshake"]),
        ("protocol_binding", &["validate_binding"]),
        (
            "protocol_scope_idempotency",
            &["resolve_native_scope", "resolve_native_scope"],
        ),
        ("protocol_scope_refused", &["resolve_native_scope"]),
        (
            "protocol_scope_fenced",
            &["resolve_native_scope", "resolve_native_scope"],
        ),
        (
            "protocol_execution_idempotency",
            &["execute", "execute", "observe"],
        ),
        ("protocol_cancel", &["execute", "cancel", "observe"]),
        (
            "protocol_error_mapping",
            &[
                "map_native_status_error",
                "map_native_status_error",
                "map_native_status_error",
                "map_native_status_error",
                "map_native_status_error",
                "map_native_status_error",
            ],
        ),
        ("protocol_redaction", &["map_native_status_error"]),
    ];
    let mut offset = 0;
    let mut error_classes = BTreeSet::new();
    for (case, operations) in cases {
        let mut preceding: Option<(Value, Value)> = None;
        for operation in *operations {
            let step = steps.get(offset).ok_or_else(bad)?;
            if step["caseKey"] != *case
                || step["operation"] != *operation
                || step.get("contractKey").is_some()
            {
                return Err(bad());
            }
            let request: Value =
                serde_json::from_str(text(step, "requestJson")?).map_err(|_| bad())?;
            let expected: Value =
                serde_json::from_str(text(step, "expectedResponseJson")?).map_err(|_| bad())?;
            if !request.is_object()
                || !expected.is_object()
                || request["idempotencyKey"] != step["idempotencyKey"]
            {
                return Err(bad());
            }
            match *case {
                "protocol_handshake" => {
                    if expected["protocolVersion"] != "1"
                        || expected["artifactDigest"] != registration.adapter_digest
                    {
                        return Err(bad());
                    }
                }
                "protocol_scope_idempotency" => {
                    if request["mode"] != "CREATE"
                        || expected["result"] != "FOUND"
                        || request["platformResourceRef"] != expected["platformResourceRef"]
                        || text(&request, "platformResourceRef")?.is_empty()
                    {
                        return Err(bad());
                    }
                    if preceding
                        .as_ref()
                        .is_some_and(|(before, _)| before != &request)
                    {
                        return Err(bad());
                    }
                }
                "protocol_scope_refused" => {
                    if request["mode"] != "CREATE"
                        || expected["result"] != "REFUSED"
                        || request["platformResourceRef"] != expected["platformResourceRef"]
                    {
                        return Err(bad());
                    }
                }
                "protocol_scope_fenced" => {
                    if let Some((before, _)) = &preceding {
                        let mut lookup = request.clone();
                        lookup["mode"] = json!("LOOKUP");
                        if &lookup != before
                            || request["mode"] != "CREATE"
                            || expected["result"] != "REFUSED"
                        {
                            return Err(bad());
                        }
                    } else if request["mode"] != "LOOKUP" || expected["result"] != "ABSENT_FENCED" {
                        return Err(bad());
                    }
                    if request["platformResourceRef"] != expected["platformResourceRef"] {
                        return Err(bad());
                    }
                }
                "protocol_execution_idempotency" | "protocol_cancel" => {
                    if expected["idempotencyKey"] != request["idempotencyKey"] {
                        return Err(bad());
                    }
                    if let Some((before, before_expected)) = &preceding {
                        if before["idempotencyKey"] != request["idempotencyKey"]
                            || before_expected["nativeType"] != expected["nativeType"]
                        {
                            return Err(bad());
                        }
                        if *case == "protocol_execution_idempotency"
                            && *operation == "execute"
                            && before != &request
                        {
                            return Err(bad());
                        }
                    }
                    let cancellable = expected["cancelCapability"] == "SUPPORTED";
                    if !cancellable && expected["cancelCapability"] != "UNSUPPORTED" {
                        return Err(bad());
                    }
                    if *operation == "observe"
                        && expected["platformStatus"]
                            != if *case == "protocol_cancel" && cancellable {
                                "CANCELLED"
                            } else {
                                "SUCCEEDED"
                            }
                    {
                        return Err(bad());
                    }
                    if *case == "protocol_cancel"
                        && *operation == "execute"
                        && expected["platformStatus"] != "RUNNING"
                    {
                        return Err(bad());
                    }
                }
                "protocol_error_mapping" => {
                    let class = text(&expected, "class")?;
                    if !matches!(
                        class,
                        "DENIED" | "BLOCKED" | "PRECONDITION" | "LIMIT" | "CONFLICT" | "UNKNOWN"
                    ) || !error_classes.insert(class.to_owned())
                    {
                        return Err(bad());
                    }
                }
                _ => {}
            }
            preceding = Some((request, expected));
            offset += 1;
        }
    }
    // Permission probes are derived below from actual successful capability
    // requests, not separate user examples that could merely be invalid input.
    if offset != steps.len() {
        return Err(bad());
    }
    Ok(fixture)
}

pub(crate) fn validate_params(params: &Params) -> Result<(), Refusal> {
    let encoded = params.to_json();
    exact_fields(
        &encoded,
        &["componentReleaseRegistration", "explicitConfirmation"],
        &[],
    )?;
    if params.explicit_confirmation != Some(true) {
        return Err(bad());
    }
    registration(
        params
            .component_release_registration
            .as_ref()
            .ok_or_else(bad)?,
    )?;
    Ok(())
}

async fn valid_policy(conn: &mut PgConnection, def: &Definition) -> Result<bool, sqlx::Error> {
    if def.action_key != REGISTER
        || def.target_type != "COMPONENT_RELEASE"
        || def.tenant_rule != "SESSION_TENANT"
        || def.workspace_rule != "TENANT_ONLY"
        || def.permission != "manage"
        || def.permission_object_type != "tenant"
        || def.execution_mode != "TEMPORAL"
        || def.workflow_kind.as_deref() != Some(KIND)
        || def.quota_policy != "NONE"
        || !def.meters.is_empty()
        || def.result_exposure != "NONE"
        || def.confirmation_mode != "EXPLICIT"
        || def.approval_policy_id.is_some()
        || def.approval_policy_version.is_some()
    {
        return Ok(false);
    }
    sqlx::query_scalar(
        "select capacity_policy='NONE' and capacity_pool_key is null
        and workflow_type='ComponentTaskWorkflow' and audit_policy='FULL_LIFECYCLE'
        and obs_correlation_mode='OPERATION_REF' and obs_progress_source='TEMPORAL'
        and obs_terminal_source='TEMPORAL' and obs_usage_source='NONE' and obs_cost_source='NONE'
        and obs_redaction_policy='PLATFORM_METADATA_ONLY'
        from catalog.action_definition where action_key=$1 and version=$2",
    )
    .bind(&def.action_key)
    .bind(def.version)
    .fetch_one(conn)
    .await
}

pub(crate) async fn target(
    conn: &mut PgConnection,
    tenant: Uuid,
    def: &Definition,
    params: &Params,
    frozen: Option<Uuid>,
) -> Result<Target, Refusal> {
    validate_params(params)?;
    if !valid_policy(conn, def).await?
        || !crate::platform_bootstrap::is_catalog_tenant(conn, tenant).await?
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let registration = registration(
        params
            .component_release_registration
            .as_ref()
            .ok_or_else(bad)?,
    )?;
    if frozen.is_some_and(|id| id != registration.id) {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let exists: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.component_release
        where id=$1 or (component_type_key=$2 and version=$3))",
    )
    .bind(registration.id)
    .bind(&registration.component_type_key)
    .bind(&registration.version)
    .fetch_one(&mut *conn)
    .await?;
    if exists {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    active_contracts(conn, tenant, &registration).await?;
    protocol_fixture(&registration)?;
    crate::component_conformance_identity::load(
        &registration.adapter_digest,
        text(
            &registration.manifest["executionConnector"],
            "actionTokenAudience",
        )?,
    )?;
    Ok(Target {
        id: registration.id,
        version: 1,
        workspace_id: None,
    })
}

/// Freeze the actual Catalog vectors and isolated protocol fixture in the
/// original admission transaction. No release row exists before execution.
pub(crate) async fn prewrite(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ae: &Execution,
    params: &Params,
) -> Result<i32, Refusal> {
    let registration = registration(
        params
            .component_release_registration
            .as_ref()
            .ok_or_else(bad)?,
    )?;
    if registration.id != ae.target_id || ae.actor_principal_id != ae.initiator_principal_id {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let contracts = active_contracts(tx, ae.tenant_id, &registration).await?;
    let fixture = protocol_fixture(&registration)?;
    let mut steps = fixture["steps"].as_array().ok_or_else(bad)?.clone();
    let mut contract_digests = Vec::new();
    for contract in &contracts {
        contract_digests.push(collab_bridge::limits::canonical_digest(contract));
        let category = text(&contract["content"], "categoryKey")?;
        let version = contract["content"]["contractVersion"]
            .as_i64()
            .ok_or_else(bad)?;
        for case in contract["vectors"]["cases"].as_array().ok_or_else(bad)? {
            for step in case["steps"].as_array().ok_or_else(bad)? {
                let case_key = format!("{category}:{version}:{}", text(case, "caseKey")?);
                let step_key = text(step, "stepKey")?;
                let key =
                    Uuid::new_v5(&ae.id, format!("{case_key}:{step_key}").as_bytes()).to_string();
                let contract_key = text(step, "contractKey")?;
                // The vector body is interpreted only as capability input. It
                // cannot select an endpoint, credential, protocol verb or code.
                let mut request = json!({"idempotencyKey":key,"contractKey":contract_key,
                    "inputJson":text(step,"inputJson")?});
                for field in ["referenceResourceId", "referenceAssetId"] {
                    if let Some(value) = step.get(field) {
                        request[field] = value.clone();
                    }
                }
                let mut probe = json!({"caseKey":case_key,"stepKey":step_key,"operation":"execute",
                    "contractKey":contract_key,"idempotencyKey":key,
                    "requestJson":serde_json::to_string(&request).map_err(|_|bad())?,
                    "expectedResponseJson":text(step,"expectedOutputJson")?,"expectedHttpStatus":200});
                for field in [
                    "referenceResourceId",
                    "referenceAssetId",
                    "referenceFromStepKey",
                ] {
                    if let Some(value) = step.get(field) {
                        probe[field] = value.clone();
                    }
                }
                steps.push(probe.clone());
                // Repeat the exact request and idempotency key under a distinct
                // simulated actor. A cached success must not bypass permission;
                // only an actual wire DENIED, with no native result, passes.
                probe["stepKey"] = json!(format!("permission-denied:{step_key}"));
                probe.as_object_mut().ok_or_else(bad)?.remove("contractKey");
                probe["expectedHttpStatus"] = json!(403);
                probe["expectedResponseJson"] =
                    json!(json!({"class":"DENIED","reason":"PERMISSION_DENIED"}).to_string());
                steps.push(probe);
            }
        }
    }
    let identity = crate::component_conformance_identity::load(
        &registration.adapter_digest,
        text(
            &registration.manifest["executionConnector"],
            "actionTokenAudience",
        )?,
    )?;
    crate::component_conformance_identity::check_plan(&identity, &steps)?;
    let identity_digest = collab_bridge::limits::canonical_digest(&identity);
    let suite_digest = collab_bridge::limits::canonical_digest(
        &json!({"fixture":fixture,"contracts":contracts,"identityDigest":identity_digest}),
    );
    let workflow =
        crate::component_task::workflow_id(KIND, ae.tenant_id, &registration.id.to_string(), 1);
    let mut plan = json!({"actionExecutionId":ae.id,"operationId":ae.operation_id,
        "workflowId":workflow,"runId":"","componentReleaseId":registration.id,
        "artifactDigest":registration.adapter_digest,"contractDigests":contract_digests,
        "suiteDigest":suite_digest,"planDigest":"","identityDigest":identity_digest,"steps":steps});
    plan["planDigest"] = json!(collab_bridge::limits::canonical_digest(&plan));
    let typed: contracts::ComponentConformancePlan =
        serde_json::from_value(plan.clone()).map_err(|_| bad())?;
    if serde_json::to_value(typed).map_err(|_| bad())? != plan {
        return Err(bad());
    }
    let affected = sqlx::query("update admission.action_execution set component_conformance_plan=$2
        where id=$1 and component_conformance_plan is null and component_conformance_observation is null")
        .bind(ae.id).bind(plan).execute(&mut **tx).await?.rows_affected();
    if affected != 1 {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    Ok(1)
}

pub(crate) async fn start(
    pool: &sqlx::PgPool,
    temporal: &crate::temporal::TemporalClient,
    action: Uuid,
    tenant: Uuid,
    workflow_id: &str,
) -> Result<crate::membership_lifecycle::LifecycleResponse, axum::response::Response> {
    use axum::response::IntoResponse;
    let plan: Option<Value> = sqlx::query_scalar(
        "select component_conformance_plan
        from admission.action_execution where id=$1 and tenant_id=$2 and action_key=$3
          and temporal_workflow_id=$4 and gate_state='ALLOWED'
          and dispatch_state in ('NOT_DISPATCHED','UNKNOWN','DISPATCHED')
          and component_conformance_plan is not null",
    )
    .bind(action)
    .bind(tenant)
    .bind(REGISTER)
    .bind(workflow_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| axum::http::StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    let Some(plan) = plan else {
        return Err(axum::http::StatusCode::CONFLICT.into_response());
    };
    let run_id = crate::component_task::start(
        pool,
        temporal,
        workflow_id,
        tenant,
        action,
        &crate::component_task::ComponentTaskInput {
            kind: KIND.into(),
            target: json!({"release":plan}),
        },
    )
    .await?;
    Ok(crate::membership_lifecycle::LifecycleResponse {
        workflow_id: workflow_id.into(),
        kind: KIND.into(),
        run_id,
    })
}

fn verify_report(plan: &Value, report: &Value) -> Result<(), Refusal> {
    for field in [
        "actionExecutionId",
        "operationId",
        "workflowId",
        "componentReleaseId",
        "artifactDigest",
        "contractDigests",
        "suiteDigest",
        "planDigest",
    ] {
        if report[field] != plan[field] {
            return Err(bad());
        }
    }
    let steps = plan["steps"].as_array().ok_or_else(bad)?;
    let observations = report["observations"].as_array().ok_or_else(bad)?;
    if steps.is_empty() || steps.len() != observations.len() {
        return Err(bad());
    }
    let mut last_native: BTreeMap<String, Value> = BTreeMap::new();
    let mut last_scope: BTreeMap<String, Value> = BTreeMap::new();
    let mut content_references: BTreeMap<(String, String), Value> = BTreeMap::new();
    for (step, observation) in steps.iter().zip(observations) {
        if step["caseKey"] != observation["caseKey"]
            || step["stepKey"] != observation["stepKey"]
            || observation.get("errorClass").is_some()
            || observation["httpStatus"] != step["expectedHttpStatus"]
            || !digest(text(observation, "responseDigest")?)
        {
            return Err(bad());
        }
        let mut request: Value =
            serde_json::from_str(text(step, "requestJson")?).map_err(|_| bad())?;
        let source_reference = step
            .get("referenceFromStepKey")
            .map(|source| {
                content_references
                    .get(&(
                        text(step, "caseKey")?.to_owned(),
                        source.as_str().ok_or_else(bad)?.to_owned(),
                    ))
                    .cloned()
                    .ok_or_else(bad)
            })
            .transpose()?;
        if let Some(reference) = &source_reference {
            request["contentReference"] = reference.clone();
        }
        let actual_operation = text(observation, "operation")?;
        if actual_operation == "reconcile"
            && matches!(
                text(step, "operation")?,
                "execute" | "cancel" | "observe" | "reconcile"
            )
        {
            request = json!({"idempotencyKey":step["idempotencyKey"]});
        } else if actual_operation != text(step, "operation")? {
            return Err(bad());
        }
        let request_digest = collab_bridge::limits::canonical_digest(&request);
        if observation["requestDigest"] != request_digest {
            // CREATE ambiguity is resolved only by LOOKUP of the same frozen
            // platform ref, never another CREATE or a replacement resource.
            if actual_operation != "resolve_native_scope" {
                return Err(bad());
            }
            request["mode"] = json!("LOOKUP");
            if observation["requestDigest"] != collab_bridge::limits::canonical_digest(&request) {
                return Err(bad());
            }
        }
        let expected: Value =
            serde_json::from_str(text(step, "expectedResponseJson")?).map_err(|_| bad())?;
        match step.get("referenceResourceId") {
            Some(_) if step["expectedHttpStatus"] == 403 => {
                if observation.get("contentReference").is_some()
                    || observation.get("nativeObservation").is_some()
                    || observation.get("nativeScopeObservation").is_some()
                    || observation.get("resultDigest").is_some()
                {
                    return Err(bad());
                }
            }
            Some(resource) => {
                let reference = observation.get("contentReference").ok_or_else(bad)?;
                let typed: contracts::ContentReference =
                    serde_json::from_value(reference.clone()).map_err(|_| bad())?;
                if serde_json::to_value(typed).map_err(|_| bad())? != *reference
                    || reference["resourceId"] != *resource
                    || reference.get("assetId") != step.get("referenceAssetId")
                    || observation["nativeObservation"]["platformStatus"] != "SUCCEEDED"
                    || source_reference
                        .as_ref()
                        .is_some_and(|source| source != reference)
                {
                    return Err(bad());
                }
                for field in [
                    "nativeObjectRef",
                    "nativeRevision",
                    "displayName",
                    "mediaType",
                ] {
                    text(reference, field)?;
                }
                content_references.insert(
                    (
                        text(step, "caseKey")?.to_owned(),
                        text(step, "stepKey")?.to_owned(),
                    ),
                    reference.clone(),
                );
            }
            None if observation.get("contentReference").is_some() || source_reference.is_some() => {
                return Err(bad())
            }
            None => {}
        }
        if let Some(scope) = observation.get("nativeScopeObservation") {
            let reference = text(&request, "platformResourceRef")?;
            if actual_operation != "resolve_native_scope"
                || scope["platformResourceRef"] != reference
                || scope["result"] != expected["result"]
                || observation.get("nativeObservation").is_some()
            {
                return Err(bad());
            }
            match text(scope, "result")? {
                "FOUND" => {
                    text(scope, "nativeType")?;
                    text(scope, "nativeRef")?;
                }
                "REFUSED" | "ABSENT_FENCED"
                    if scope.get("nativeType").is_none() && scope.get("nativeRef").is_none() => {}
                _ => return Err(bad()),
            }
            if let Some(previous) = last_scope.get(reference) {
                match text(previous, "result")? {
                    "FOUND" if previous != scope => return Err(bad()),
                    "ABSENT_FENCED"
                        if scope["result"] != "REFUSED" && scope["result"] != "ABSENT_FENCED" =>
                    {
                        return Err(bad())
                    }
                    _ => {}
                }
            }
            last_scope.insert(reference.to_owned(), scope.clone());
        } else if let Some(native) = observation.get("nativeObservation") {
            let key = text(step, "idempotencyKey")?;
            if native["idempotencyKey"] != key || text(native, "nativeType")?.is_empty() {
                return Err(bad());
            }
            // The idempotency probe must identify the one real native effect.
            // An otherwise legal reference-free observation cannot prove it.
            if step["caseKey"] == "protocol_execution_idempotency" {
                text(native, "nativeId")?;
            }
            let status = text(native, "platformStatus")?;
            if !matches!(
                text(native, "cancelCapability")?,
                "SUPPORTED" | "UNSUPPORTED"
            ) {
                return Err(bad());
            }
            match status {
                "SUCCEEDED" | "FAILED" | "CANCELLED" => {
                    text(native, "nativeStatus")?;
                    let observed =
                        chrono::DateTime::parse_from_rfc3339(text(native, "lastObservedAt")?)
                            .map_err(|_| bad())?;
                    let terminal =
                        chrono::DateTime::parse_from_rfc3339(text(native, "terminalAt")?)
                            .map_err(|_| bad())?;
                    if terminal > observed {
                        return Err(bad());
                    }
                }
                "PENDING_DISPATCH" | "RUNNING" if native.get("terminalAt").is_none() => {}
                _ => {
                    return Err(Refusal::Unavailable(
                        "component native terminal evidence incomplete".into(),
                    ))
                }
            }
            if let Some(previous) = last_native.get(key) {
                if previous["nativeType"] != native["nativeType"]
                    || previous["cancelCapability"] != native["cancelCapability"]
                    || (previous.get("nativeId").is_some()
                        && previous["nativeId"] != native["nativeId"])
                    || (previous.get("terminalAt").is_some()
                        && (previous["platformStatus"] != native["platformStatus"]
                            || previous["terminalAt"] != native["terminalAt"]))
                {
                    return Err(bad());
                }
            }
            last_native.insert(key.to_owned(), native.clone());
            if step.get("contractKey").is_some() {
                if status != "SUCCEEDED"
                    || observation["resultDigest"]
                        != collab_bridge::limits::canonical_digest(&expected)
                {
                    return Err(bad());
                }
            } else {
                for field in [
                    "idempotencyKey",
                    "nativeType",
                    "platformStatus",
                    "cancelCapability",
                ] {
                    if expected[field] != native[field] {
                        return Err(bad());
                    }
                }
                for field in ["nativeId", "nativeStatus"] {
                    if expected.get(field).is_some() && expected[field] != native[field] {
                        return Err(bad());
                    }
                }
                if expected.get("terminalAt").is_some() || expected.get("lastObservedAt").is_some()
                {
                    return Err(bad());
                }
            }
        } else if observation["responseDigest"]
            != collab_bridge::limits::canonical_digest(&expected)
            || step.get("contractKey").is_some()
        {
            return Err(bad());
        }
    }
    if last_native.values().any(|native| {
        !matches!(
            native["platformStatus"].as_str(),
            Some("SUCCEEDED" | "FAILED" | "CANCELLED")
        )
    }) {
        return Err(Refusal::Unavailable(
            "component suite retains in-flight native execution".into(),
        ));
    }
    Ok(())
}

/// Derive the exact request from the immutable plan and the fixed typed slot.
/// There is no caller-supplied URL, method, JSON path or general-purpose patch.
fn probe_request(plan: &Value, input: &Value) -> Result<(Value, String, Value), Refusal> {
    let mut presented = input["plan"].clone();
    presented["runId"] = json!("");
    if presented != *plan {
        return Err(bad());
    }
    let index = input["stepIndex"]
        .as_u64()
        .and_then(|v| usize::try_from(v).ok())
        .ok_or_else(bad)?;
    let step = plan["steps"]
        .as_array()
        .and_then(|steps| steps.get(index))
        .ok_or_else(bad)?
        .clone();
    let mut request: Value =
        serde_json::from_str(text(&step, "requestJson")?).map_err(|_| bad())?;
    let mut operation = text(&step, "operation")?.to_owned();
    if let Some(previous) = step.get("referenceFromStepKey") {
        let source = plan["steps"].as_array().ok_or_else(bad)?[..index]
            .iter()
            .find(|candidate| {
                candidate["caseKey"] == step["caseKey"] && candidate["stepKey"] == *previous
            })
            .ok_or_else(bad)?;
        let reference = input.get("contentReference").ok_or_else(bad)?;
        let typed: contracts::ContentReference =
            serde_json::from_value(reference.clone()).map_err(|_| bad())?;
        if serde_json::to_value(typed).map_err(|_| bad())? != *reference
            || source["referenceResourceId"] != step["referenceResourceId"]
            || source.get("referenceAssetId") != step.get("referenceAssetId")
            || reference["resourceId"] != step["referenceResourceId"]
            || reference.get("assetId") != step.get("referenceAssetId")
        {
            return Err(bad());
        }
        for field in [
            "nativeObjectRef",
            "nativeRevision",
            "displayName",
            "mediaType",
        ] {
            text(reference, field)?;
        }
        request["contentReference"] = reference.clone();
    } else if input.get("contentReference").is_some() {
        return Err(bad());
    }
    if input["reconcile"].as_bool() == Some(true) {
        match operation.as_str() {
            "resolve_native_scope" => request["mode"] = json!("LOOKUP"),
            "execute" | "cancel" | "observe" | "reconcile" => {
                operation = "reconcile".into();
                request = json!({"idempotencyKey":step["idempotencyKey"]});
            }
            _ => (),
        }
    }
    Ok((step, operation, request))
}

async fn fresh_suite(
    state: &crate::service_api::ServiceState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ae: &Execution,
    run_id: &str,
) -> Result<(), Refusal> {
    if ae.action_key != REGISTER
        || ae.workspace_id.is_some()
        || ae.gate_state != "ALLOWED"
        || ae.actor_principal_id != ae.initiator_principal_id
        || !crate::platform_bootstrap::is_catalog_tenant(tx, ae.tenant_id).await?
    {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    if ae.dispatch_state != "DISPATCHED" {
        return Err(Refusal::Unavailable(
            "component dispatch observation has not converged".into(),
        ));
    }
    let active: Option<bool> =
        sqlx::query_scalar("select state='ACTIVE' from identity.tenant where id=$1 for share")
            .bind(ae.tenant_id)
            .fetch_optional(&mut **tx)
            .await?;
    if active != Some(true)
        || !crate::agent_definition::active_owner(tx, ae.tenant_id, ae.initiator_principal_id)
            .await?
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let human: bool = sqlx::query_scalar("select exists(select 1 from identity.principal where id=$1 and tenant_id=$2 and kind='HUMAN' and status='ACTIVE')")
        .bind(ae.initiator_principal_id).bind(ae.tenant_id).fetch_one(&mut **tx).await?;
    if !human {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let allowed = state
        .governance
        .spicedb
        .check(
            "tenant",
            &ae.tenant_id.to_string(),
            "manage",
            &ae.initiator_principal_id.to_string(),
            crate::spicedb::Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Catalog authorization unavailable".into()))?;
    if !allowed.allowed {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    current_suite_run(state, tx, ae, run_id).await
}

// Receipt recovery checks the original execution chain without reauthorizing
// or repeating an already committed native suite after an operator is revoked.
async fn current_suite_run(
    state: &crate::service_api::ServiceState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ae: &Execution,
    run_id: &str,
) -> Result<(), Refusal> {
    let workflow = ae.temporal_workflow_id.as_deref().ok_or_else(bad)?;
    let first:Option<Option<String>>=sqlx::query_scalar("select wf.run_id from projection.workflow_ref wf
        join projection.task_projection task using(workflow_id) where wf.workflow_id=$1 and wf.action_execution_id=$2
        and wf.tenant_id=$3 and wf.operation_id=$4 and wf.workflow_type='ComponentTaskWorkflow' and wf.kind='COMPONENT_RELEASE'
        and wf.projection_state='RUNNING' and task.status='RUNNING' and task.run_id=$5")
        .bind(workflow).bind(ae.id).bind(ae.tenant_id).bind(ae.operation_id).bind(run_id).fetch_optional(&mut **tx).await?;
    let Some(Some(first)) = first else {
        return Err(Refusal::Unavailable(
            "component workflow reference unavailable".into(),
        ));
    };
    let native = state
        .temporal
        .describe(workflow)
        .await
        .map_err(|_| Refusal::Unavailable("component Temporal observation unavailable".into()))?
        .ok_or(Refusal::Unavailable(
            "component Temporal execution unavailable".into(),
        ))?;
    verify_suite_run(&first, run_id, &native)
}

fn verify_suite_run(
    first: &str,
    run_id: &str,
    native: &crate::temporal::Observed,
) -> Result<(), Refusal> {
    if !matches!(native.state, crate::temporal::ObservedState::Open)
        || run_id != native.run_id
        || (first != native.first_run_id && first != native.run_id)
        || native.first_run_id.is_empty()
    {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    Ok(())
}

pub(crate) async fn authorize_probe(
    axum::extract::State(state): axum::extract::State<crate::service_api::ServiceState>,
    headers: axum::http::HeaderMap,
    body: Result<
        axum::Json<contracts::ComponentConformanceProbe>,
        axum::extract::rejection::JsonRejection,
    >,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    if let Err(response) = crate::service_api::authorize(&state, &headers).await {
        return response;
    }
    let Ok(axum::Json(probe)) = body else {
        return axum::http::StatusCode::BAD_REQUEST.into_response();
    };
    let result=async {
        let input=serde_json::to_value(probe).map_err(|_|bad())?;
        let action=Uuid::parse_str(text(&input["plan"],"actionExecutionId")?).map_err(|_|bad())?;
        let mut tx=state.pool.begin().await?;
        let ae=crate::governance::lock_execution(&mut tx,action).await?;
        fresh_suite(&state,&mut tx,&ae,text(&input["plan"],"runId")?).await?;
        let def=crate::governance::exact_definition(&state.pool,&ae.action_key,ae.action_version).await?;
        if !valid_policy(&mut tx,&def).await? { return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)); }
        let plan:Value=sqlx::query_scalar("select component_conformance_plan from admission.action_execution where id=$1 and component_conformance_observation is null")
            .bind(ae.id).fetch_optional(&mut *tx).await?.ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
        let (step,operation,request)=probe_request(&plan,&input)?;
        let params=ae.parameters.as_ref().and_then(|v|v.get("params")).and_then(Params::from_json).ok_or_else(bad)?;
        let release=registration(params.component_release_registration.as_ref().ok_or_else(bad)?)?;
        let contracts=active_contracts(&mut tx,ae.tenant_id,&release).await?;
        let digests:Vec<_>=contracts.iter().map(collab_bridge::limits::canonical_digest).collect();
        if plan["contractDigests"] != json!(digests) { return Err(Refusal::Conflict(ReasonCode::TargetStateConflict)); }
        let identity=crate::component_conformance_identity::load(&release.adapter_digest,text(&release.manifest["executionConnector"],"actionTokenAudience")?)?;
        if plan["identityDigest"] != collab_bridge::limits::canonical_digest(&identity) { return Err(Refusal::Conflict(ReasonCode::TargetStateConflict)); }
        let context=crate::component_conformance_identity::context(&identity,&step,&operation)?;
        // These identities only exist in the isolated environment. Never mint a
        // simulated capability credential using the real Catalog tenant/actor.
        if context["tenantId"] == ae.tenant_id.to_string() || context["actorPrincipalId"] == ae.actor_principal_id.to_string() {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        let collides:bool=sqlx::query_scalar("select exists(select 1 from identity.tenant where id=$1)
            or exists(select 1 from identity.principal where id=$2)
            or exists(select 1 from catalog.result_exposure_policy where id=$3)")
            .bind(Uuid::parse_str(text(context,"tenantId")?).map_err(|_|bad())?)
            .bind(Uuid::parse_str(text(context,"actorPrincipalId")?).map_err(|_|bad())?)
            .bind(Uuid::parse_str(text(context,"resultExposurePolicyId")?).map_err(|_|bad())?)
            .fetch_one(&mut *tx).await?;
        if collides { return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed)); }
        let token=crate::component_conformance_identity::sign(&state,&identity,context,ae.id,ae.operation_id,&operation,&request).await?;
        let expected:Value=serde_json::from_str(text(&step,"expectedResponseJson")?).map_err(|_|bad())?;
        let authorization:contracts::ComponentConformanceAuthorization=serde_json::from_value(json!({"token":token,
            "requestDigest":collab_bridge::limits::canonical_digest(&request),"requestJson":collab_bridge::limits::canonical_json(&request),
            "expectedResponseDigest":collab_bridge::limits::canonical_digest(&expected),"operation":operation})).map_err(|_|bad())?;
        tx.commit().await?;
        Ok::<_,Refusal>(authorization)
    }.await;
    match result {
        Ok(value) => (
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            axum::Json(value),
        )
            .into_response(),
        Err(error) => error.respond(None),
    }
}

fn wire_digests(
    request: &Value,
    operation: &str,
    status: i64,
    raw: &str,
) -> Result<contracts::ComponentConformanceWireDigests, Refusal> {
    if !(100..=599).contains(&status) {
        return Err(bad());
    }
    let response: Value = serde_json::from_str(raw).map_err(|_| bad())?;
    let mut out = json!({"requestDigest":collab_bridge::limits::canonical_digest(request),
        "responseDigest":collab_bridge::limits::canonical_digest(&response)});
    if (200..300).contains(&status)
        && matches!(operation, "execute" | "observe" | "cancel" | "reconcile")
    {
        let typed: contracts::AdapterExecutionResponse =
            serde_json::from_value(response.clone()).map_err(|_| bad())?;
        if serde_json::to_value(typed).map_err(|_| bad())? != response {
            return Err(bad());
        }
        if let Some(raw) = response.get("resultJson") {
            if response["execution"]["platformStatus"] != "SUCCEEDED" {
                return Err(bad());
            }
            let result: Value =
                serde_json::from_str(raw.as_str().ok_or_else(bad)?).map_err(|_| bad())?;
            out["resultDigest"] = json!(collab_bridge::limits::canonical_digest(&result));
        }
    }
    serde_json::from_value(out).map_err(|_| bad())
}

/// The response body exists only for this original suite request. It is never
/// logged, put in Temporal, or written to the report. This is not a general
/// normalization endpoint: the original live AE and frozen probe are required.
pub(crate) async fn observe_probe(
    axum::extract::State(state): axum::extract::State<crate::service_api::ServiceState>,
    headers: axum::http::HeaderMap,
    body: Result<
        axum::Json<contracts::ComponentConformanceWireObservation>,
        axum::extract::rejection::JsonRejection,
    >,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    if let Err(response) = crate::service_api::authorize(&state, &headers).await {
        return response;
    }
    let Ok(axum::Json(input)) = body else {
        return axum::http::StatusCode::BAD_REQUEST.into_response();
    };
    let result=async {
        let input=serde_json::to_value(input).map_err(|_|bad())?;
        let probe=&input["probe"];
        let action=Uuid::parse_str(text(&probe["plan"],"actionExecutionId")?).map_err(|_|bad())?;
        let mut tx=state.pool.begin().await?;
        let ae=crate::governance::lock_execution(&mut tx,action).await?;
        fresh_suite(&state,&mut tx,&ae,text(&probe["plan"],"runId")?).await?;
        let def=crate::governance::exact_definition(&state.pool,&ae.action_key,ae.action_version).await?;
        if !valid_policy(&mut tx,&def).await? { return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)); }
        let plan:Value=sqlx::query_scalar("select component_conformance_plan from admission.action_execution where id=$1 and component_conformance_observation is null")
            .bind(ae.id).fetch_optional(&mut *tx).await?.ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
        let (_,operation,request)=probe_request(&plan,probe)?;
        let out=wire_digests(&request,&operation,input["httpStatus"].as_i64().ok_or_else(bad)?,text(&input,"responseJson")?)?;
        tx.commit().await?;
        Ok::<_,Refusal>(out)
    }.await;
    match result {
        Ok(value) => (
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            axum::Json(value),
        )
            .into_response(),
        Err(error) => error.respond(None),
    }
}

pub(crate) async fn record(
    axum::extract::State(state): axum::extract::State<crate::service_api::ServiceState>,
    headers: axum::http::HeaderMap,
    body: Result<
        axum::Json<contracts::ComponentConformanceObservation>,
        axum::extract::rejection::JsonRejection,
    >,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    if let Err(response) = crate::service_api::authorize(&state, &headers).await {
        return response;
    }
    let Ok(axum::Json(observation)) = body else {
        return axum::http::StatusCode::BAD_REQUEST.into_response();
    };
    let result = async {
        let report = serde_json::to_value(observation).map_err(|_| bad())?;
        let action = Uuid::parse_str(text(&report, "actionExecutionId")?).map_err(|_| bad())?;
        let mut tx = state.pool.begin().await?;
        let ae = crate::governance::lock_execution(&mut tx, action).await?;
        if ae.action_key != REGISTER
            || ae.workspace_id.is_some()
            || ae.gate_state != "ALLOWED"
            || ae.actor_principal_id != ae.initiator_principal_id
            || !crate::platform_bootstrap::is_catalog_tenant(&mut tx, ae.tenant_id).await?
        {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
        if ae.dispatch_state != "DISPATCHED" {
            return Err(Refusal::Unavailable(
                "component dispatch observation has not converged".into(),
            ));
        }
        let def =
            crate::governance::exact_definition(&state.pool, &ae.action_key, ae.action_version)
                .await?;
        if !valid_policy(&mut tx, &def).await? {
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        }
        let params = ae
            .parameters
            .as_ref()
            .and_then(|value| value.get("params"))
            .and_then(Params::from_json)
            .ok_or_else(bad)?;
        validate_params(&params)?;
        let release = registration(
            params
                .component_release_registration
                .as_ref()
                .ok_or_else(bad)?,
        )?;
        if release.id != ae.target_id {
            return Err(bad());
        }
        let (plan, previous): (Value, Option<Value>) = sqlx::query_as(
            "select component_conformance_plan,component_conformance_observation
            from admission.action_execution where id=$1",
        )
        .bind(ae.id)
        .fetch_one(&mut *tx)
        .await?;
        verify_report(&plan, &report)?;
        // A retry after the committed write returns the exact original receipt,
        // never creates another release or rewrites its evidence.
        if existing_registration(&mut tx, ae.id, release.id, previous.as_ref(), &report).await? {
            let previous = previous.as_ref().ok_or_else(bad)?;
            if previous["runId"] != report["runId"] {
                current_suite_run(&state, &mut tx, &ae, text(&report, "runId")?).await?;
            }
        } else {
            fresh_suite(&state, &mut tx, &ae, text(&report, "runId")?).await?;
            let current_contracts = active_contracts(&mut tx, ae.tenant_id, &release).await?;
            let digests: Vec<_> = current_contracts
                .iter()
                .map(collab_bridge::limits::canonical_digest)
                .collect();
            if json!(digests) != plan["contractDigests"] {
                return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
            }
            let workflow = ae.temporal_workflow_id.as_deref().ok_or_else(bad)?;
            if report["workflowId"] != workflow {
                return Err(bad());
            }
            persist_registration(&mut tx, &ae, &release, &plan, &report).await?;
            crate::audit::append(
                &mut tx,
                crate::audit::AuditEntry {
                    event_key: format!("{}:component-release:registered", ae.id),
                    tenant_id: Some(ae.tenant_id),
                    workspace_id: None,
                    operation_id: ae.operation_id,
                    event_type: "RECONCILIATION",
                    human_identity_id: None,
                    initiator_principal_id: Some(ae.initiator_principal_id),
                    actor_principal_id: Some(ae.actor_principal_id),
                    action_key: &ae.action_key,
                    action_version: ae.action_version,
                    component_type_key: &def.component_type_key,
                    target_type: Some("COMPONENT_RELEASE"),
                    target_id: Some(release.id),
                    parameter_hash: &ae.parameter_hash,
                    decision: "NONE",
                    result_code: "REGISTERED",
                    result_exposure: &def.result_exposure,
                    evidence_refs: vec![
                        crate::audit::Evidence::new(
                            contracts::EvidenceKind::ActionExecutionId,
                            ae.id,
                        ),
                        crate::audit::Evidence::new(
                            contracts::EvidenceKind::TemporalWorkflowId,
                            workflow,
                        ),
                        crate::audit::Evidence::new(
                            contracts::EvidenceKind::TemporalRunId,
                            text(&report, "runId")?,
                        ),
                    ],
                    correlation_id: ae.correlation_id,
                },
            )
            .await?;
        }
        let receipt: contracts::ComponentReleaseReceipt =
            serde_json::from_value(json!({"actionExecutionId":ae.id,
            "componentReleaseId":release.id,"planDigest":plan["planDigest"],"status":"REGISTERED"}))
            .map_err(|_| bad())?;
        tx.commit().await?;
        Ok::<_, Refusal>(receipt)
    }
    .await;
    match result {
        Ok(receipt) => axum::Json(receipt).into_response(),
        Err(error) => error.respond(None),
    }
}

// Continue-as-new changes only the reporting run, not the frozen plan or any
// observation. The committed report keeps its original run and is never edited.
async fn existing_registration(
    conn: &mut PgConnection,
    action: Uuid,
    release: Uuid,
    previous: Option<&Value>,
    report: &Value,
) -> Result<bool, Refusal> {
    let existing: Option<Uuid> = sqlx::query_scalar(
        "select registered_by_action_execution_id from catalog.component_release where id=$1",
    )
    .bind(release)
    .fetch_optional(&mut *conn)
    .await?;
    match existing {
        None => Ok(false),
        Some(existing)
            if existing == action
                && previous.is_some_and(|value| same_report_evidence(value, report)) =>
        {
            Ok(true)
        }
        Some(_) => Err(Refusal::Conflict(ReasonCode::TargetStateConflict)),
    }
}

fn same_report_evidence(previous: &Value, report: &Value) -> bool {
    let (Some(previous), Some(report)) = (previous.as_object(), report.as_object()) else {
        return false;
    };
    previous.len() == report.len()
        && previous.keys().all(|key| {
            if key == "runId" {
                previous[key]
                    .as_str()
                    .is_some_and(|value| !value.is_empty())
                    && report
                        .get(key)
                        .and_then(Value::as_str)
                        .is_some_and(|value| !value.is_empty())
            } else {
                report.get(key) == previous.get(key)
            }
        })
}

// Called only after fresh admission/workflow checks in record. Keep the report
// and immutable release in the caller's audit transaction; a rejected release
// must never leave an apparent passing report behind.
async fn persist_registration(
    conn: &mut PgConnection,
    ae: &Execution,
    release: &Registration,
    plan: &Value,
    report: &Value,
) -> Result<(), Refusal> {
    verify_report(plan, report)?;
    sqlx::query(
        "update admission.action_execution set component_conformance_observation=$2 where id=$1",
    )
    .bind(ae.id)
    .bind(report)
    .execute(&mut *conn)
    .await?;
    sqlx::query("insert into catalog.component_definition(type_key,catalog_tenant_id,class,platform_port_key,status)
        values($1,$2,'APPLICATION','NONE','ACTIVE') on conflict(type_key) do nothing")
        .bind(&release.component_type_key).bind(ae.tenant_id).execute(&mut *conn).await?;
    let definition: Option<(Uuid, String, String, String)> = sqlx::query_as(
        "select catalog_tenant_id,class,platform_port_key,status
        from catalog.component_definition where type_key=$1 for update",
    )
    .bind(&release.component_type_key)
    .fetch_optional(&mut *conn)
    .await?;
    if definition
        != Some((
            ae.tenant_id,
            "APPLICATION".into(),
            "NONE".into(),
            "ACTIVE".into(),
        ))
    {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    sqlx::query("insert into catalog.component_release(id,component_type_key,catalog_tenant_id,version,manifest,
        component_package,binding_config_schema,manifest_digest,component_package_digest,adapter_build_ref,
        registered_by_action_execution_id,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'REGISTERED')")
        .bind(release.id).bind(&release.component_type_key).bind(ae.tenant_id).bind(&release.version)
        .bind(&release.manifest).bind(&release.package).bind(&release.binding_config_schema)
        .bind(&release.manifest_digest).bind(&release.package_digest).bind(&release.adapter_digest).bind(ae.id)
        .execute(&mut *conn).await?;
    Ok(())
}

#[derive(serde::Deserialize)]
pub(crate) struct PageQuery {
    offset: Option<i64>,
}

pub(crate) async fn list(
    axum::extract::State(state): axum::extract::State<crate::bff::BffState>,
    axum::extract::Query(query): axum::extract::Query<PageQuery>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let ctx = match crate::bff::resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let offset = query.offset.unwrap_or(0);
    if offset < 0 {
        return axum::http::StatusCode::BAD_REQUEST.into_response();
    }
    let result = async {
        let mut conn = state.pool.acquire().await?;
        if !crate::platform_bootstrap::is_catalog_tenant(&mut conn, ctx.tenant_id).await?
            || !crate::agent_definition::active_owner(
                &mut conn,
                ctx.tenant_id,
                ctx.tenant_principal_id,
            )
            .await?
        {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
        let checked = state
            .governance
            .spicedb
            .check(
                "tenant",
                &ctx.tenant_id.to_string(),
                "manage",
                &ctx.tenant_principal_id.to_string(),
                crate::spicedb::Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| Refusal::Unavailable("Catalog authorization unavailable".into()))?;
        if !checked.allowed {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
        let page = state.governance.cfg.role_member_page_limit;
        let mut result = read_releases(&mut conn, ctx.tenant_id, page, offset).await?;
        let definition = crate::governance::active_definition(&state.pool, REGISTER).await?;
        result.can_register = if let Some(definition) = definition {
            crate::capability_registry::action_exposed(REGISTER)
                && valid_policy(&mut conn, &definition).await?
        } else {
            false
        };
        let definition =
            crate::governance::active_definition(&state.pool, approval::APPROVE).await?;
        result.can_approve = Some(if let Some(definition) = definition {
            crate::capability_registry::action_exposed(approval::APPROVE)
                && approval::valid_policy(&mut conn, &definition).await?
        } else {
            false
        });
        Ok::<_, Refusal>(result)
    }
    .await;
    match result {
        Ok(page) => axum::Json(page).into_response(),
        Err(error) => error.respond(None),
    }
}

// Authorization is performed by list before this scope-constrained read.
async fn read_releases(
    conn: &mut PgConnection,
    tenant: Uuid,
    page: i64,
    offset: i64,
) -> Result<contracts::ComponentReleasePage, Refusal> {
    if page <= 0 || offset < 0 {
        return Err(bad());
    }
    let mut rows:Vec<Value>=sqlx::query_scalar("select jsonb_strip_nulls(jsonb_build_object(
            'componentReleaseId',r.id,'componentTypeKey',r.component_type_key,'version',r.version,'status',r.status,
            'artifactDigest',r.adapter_build_ref,'manifestDigest',r.manifest_digest,
            'registeredByActionExecutionId',r.registered_by_action_execution_id,'approvedByActionExecutionId',r.approved_by_action_execution_id,'operationId',ae.operation_id,
            'workflowId',ae.temporal_workflow_id,'suiteDigest',ae.component_conformance_observation->>'suiteDigest'))
            from catalog.component_release r join admission.action_execution ae on ae.id=r.registered_by_action_execution_id
            where r.catalog_tenant_id=$1 and ae.tenant_id=r.catalog_tenant_id
            order by r.component_type_key,r.version,r.id limit $2 offset $3")
            .bind(tenant).bind(page.checked_add(1).ok_or_else(bad)?).bind(offset).fetch_all(&mut *conn).await?;
    let more = rows.len() as i64 > page;
    rows.truncate(page as usize);
    let mut result = json!({"releases":rows,"canRegister":false});
    if more {
        result["nextOffset"] = json!(offset.checked_add(page).ok_or_else(bad)?);
    }
    // Unknown enum or absent immutable evidence is an error, never an
    // invented status or a successful empty catalog.
    serde_json::from_value::<contracts::ComponentReleasePage>(result).map_err(|_| bad())
}

#[cfg(test)]
mod report_tests {
    use super::*;

    #[test]
    fn receipt_recovery_requires_exact_evidence_and_original_open_chain() {
        let previous =
            json!({"runId":"first", "observations":[{"nativeId":"native"}], "planDigest":"plan"});
        let mut report = previous.clone();
        report["runId"] = json!("continued");
        assert!(same_report_evidence(&previous, &report));
        let mut native = crate::temporal::Observed {
            run_id: "continued".into(),
            first_run_id: "first".into(),
            history_length: 1,
            state: crate::temporal::ObservedState::Open,
        };
        assert!(verify_suite_run("first", "continued", &native).is_ok());
        assert!(verify_suite_run("other-chain", "continued", &native).is_err());
        assert!(verify_suite_run("first", "old-run", &native).is_err());
        native.first_run_id.clear();
        assert!(verify_suite_run("first", "continued", &native).is_err());
        native.first_run_id = "first".into();
        native.state = crate::temporal::ObservedState::Closed(contracts::TaskStatus::Completed);
        assert!(verify_suite_run("first", "continued", &native).is_err());
        native.state = crate::temporal::ObservedState::Unrecognized(-1);
        assert!(verify_suite_run("first", "continued", &native).is_err());
        for field in ["runId", "observations", "planDigest"] {
            let mut changed = report.clone();
            changed[field] = Value::Null;
            assert!(!same_report_evidence(&previous, &changed), "{field}");
        }
        report["unrecognized"] = json!(true);
        assert!(!same_report_evidence(&previous, &report));
    }

    #[test]
    fn transient_wire_normalization_uses_existing_core_authority() {
        let mut request:Value=serde_json::from_str(r#"{"z":[1e0,1.2500,-0,1e-6,1e16],"a":{"unicode":"\u2028\u2029","literal":"\\u2028","integer":18446744073709551615}}"#).unwrap();
        let key = Uuid::new_v4();
        request["idempotencyKey"] = json!(key);
        let canonical = collab_bridge::limits::canonical_json(&request);
        assert_eq!(
            hex::encode(sha2::Sha256::digest(canonical.as_bytes())),
            collab_bridge::limits::canonical_digest(&request)
        );
        let result = r#"{"small":1.234e-20,"large":1.234e20,"nested":[{"ordinary":0.1},9007199254740993],"unicode":"\u2028\u2029"}"#;
        let now = chrono::Utc::now().to_rfc3339();
        let native = json!({"idempotencyKey":key,"nativeType":"fixture_task","platformStatus":"SUCCEEDED","cancelCapability":"UNSUPPORTED",
            "nativeId":Uuid::new_v4(),"nativeStatus":"done","lastObservedAt":now,"terminalAt":now});
        let response = json!({"execution":native,"resultJson":result});
        let actual = serde_json::to_value(
            wire_digests(&request, "execute", 200, &response.to_string()).unwrap(),
        )
        .unwrap();
        assert_eq!(
            actual["requestDigest"],
            collab_bridge::limits::canonical_digest(&request)
        );
        assert_eq!(
            actual["responseDigest"],
            collab_bridge::limits::canonical_digest(&response)
        );
        assert_eq!(
            actual["resultDigest"],
            collab_bridge::limits::canonical_digest(
                &serde_json::from_str::<Value>(result).unwrap()
            )
        );
        if let Ok(path) = std::env::var("COMPONENT_CONFORMANCE_CANONICAL_EVIDENCE") {
            std::fs::write(path,serde_json::to_vec(&json!({"requestJson":canonical,"responseJson":response.to_string(),"digests":actual,
                "idempotencyKey":key,"expectedResponseJson":result})).unwrap()).unwrap();
        }
        let mut changed = response;
        changed["execution"]["platformStatus"] = json!("RUNNING");
        assert!(wire_digests(&request, "execute", 200, &changed.to_string()).is_err());
    }

    /// This check consumes Go's real native wire observations. It does not
    /// impersonate production authorization, Temporal or OpenBao: those gates
    /// remain in the handler. All DB fixtures roll back, with triggers enabled.
    #[tokio::test]
    #[ignore = "requires isolated database and actual Go wire evidence"]
    async fn wire_report_persists_original_release_and_scoped_read() {
        use sqlx::{Acquire, Connection};
        let path =
            std::env::var("COMPONENT_CONFORMANCE_WIRE_EVIDENCE").expect("wire evidence path");
        let evidence: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        let plan = &evidence["plan"];
        let report = &evidence["report"];
        assert!(verify_report(plan, report).is_ok());
        let mut conn = sqlx::PgConnection::connect(
            &std::env::var("COMPONENT_CONFORMANCE_TEST_DATABASE_URL")
                .expect("isolated database URL"),
        )
        .await
        .unwrap();
        let mut tx = sqlx::Connection::begin(&mut conn).await.unwrap();
        let tenant = Uuid::new_v4();
        let actor = Uuid::new_v4();
        let action = Uuid::parse_str(plan["actionExecutionId"].as_str().unwrap()).unwrap();
        let operation = Uuid::parse_str(plan["operationId"].as_str().unwrap()).unwrap();
        let release_id = Uuid::parse_str(plan["componentReleaseId"].as_str().unwrap()).unwrap();
        let workflow = plan["workflowId"].as_str().unwrap();
        let run = report["runId"].as_str().unwrap();
        sqlx::query("insert into identity.tenant(id,slug,name,state) values($1,$2,$2,'ACTIVE')")
            .bind(tenant)
            .bind(tenant.to_string())
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'HUMAN','ACTIVE')")
            .bind(actor).bind(tenant).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into identity.relay_operator_identity(catalog_tenant_id,pubkey,private_key_secret_ref,audience,relay_operator_api_origin,state)
            values($1,$2,$2,$2,$2,'PENDING_SECRET')")
            .bind(tenant).bind(Uuid::new_v4().to_string()).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into admission.action_execution(id,operation_id,tenant_id,action_key,action_version,initiator_principal_id,actor_principal_id,
            target_id,parameter_hash,temporal_workflow_id,gate_state,dispatch_state,correlation_id,component_conformance_plan)
            values($1,$2,$3,$4,1,$5,$5,$6,$7,$8,'ALLOWED','DISPATCHED',$9,$10)")
            .bind(action).bind(operation).bind(tenant).bind(REGISTER).bind(actor).bind(release_id)
            .bind(collab_bridge::limits::canonical_digest(plan)).bind(workflow).bind(Uuid::new_v4()).bind(plan)
            .execute(&mut *tx).await.unwrap();
        sqlx::query("insert into projection.workflow_ref(workflow_id,run_id,workflow_type,workflow_version,kind,tenant_id,operation_id,action_execution_id,projection_state)
            values($1,$2,'ComponentTaskWorkflow',1,'COMPONENT_RELEASE',$3,$4,$5,'RUNNING')")
            .bind(workflow).bind(run).bind(tenant).bind(operation).bind(action).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into projection.task_projection(workflow_id,run_id,last_event_id,status) values($1,$2,1,'RUNNING')")
            .bind(workflow).bind(run).execute(&mut *tx).await.unwrap();
        let ae = crate::governance::lock_execution(&mut tx, action)
            .await
            .unwrap();
        let release = Registration {
            id: release_id,
            component_type_key: format!("fixture_{}", Uuid::new_v4().simple()),
            version: Uuid::new_v4().to_string(),
            manifest: json!({}),
            package: json!({}),
            binding_config_schema: json!({}),
            manifest_digest: collab_bridge::limits::canonical_digest(&json!({})),
            package_digest: collab_bridge::limits::canonical_digest(&json!({})),
            adapter_digest: plan["artifactDigest"].as_str().unwrap().to_owned(),
            contracts: vec![],
        };
        let mut forged = report.clone();
        forged["observations"][0]["nativeObservation"]
            .as_object_mut()
            .unwrap()
            .remove("terminalAt");
        assert!(persist_registration(&mut tx, &ae, &release, plan, &forged)
            .await
            .is_err());
        let stored: Option<Value> = sqlx::query_scalar(
            "select component_conformance_observation from admission.action_execution where id=$1",
        )
        .bind(action)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert!(stored.is_none(), "rejected report left evidence behind");
        let mut save = tx.begin().await.unwrap();
        sqlx::query("update projection.task_projection set run_id=$2 where workflow_id=$1")
            .bind(workflow)
            .bind(Uuid::new_v4().to_string())
            .execute(&mut *save)
            .await
            .unwrap();
        assert!(
            persist_registration(&mut save, &ae, &release, plan, report)
                .await
                .is_err(),
            "report from a different run registered"
        );
        save.rollback().await.unwrap();
        let stored: Option<Value> = sqlx::query_scalar(
            "select component_conformance_observation from admission.action_execution where id=$1",
        )
        .bind(action)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert!(
            stored.is_none(),
            "failed registration escaped its transaction"
        );
        persist_registration(&mut tx, &ae, &release, plan, report)
            .await
            .unwrap();
        let stored: Value = sqlx::query_scalar(
            "select component_conformance_observation from admission.action_execution where id=$1",
        )
        .bind(action)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert_eq!(&stored, report);
        if let Ok(path) = std::env::var("COMPONENT_CONFORMANCE_RECOVERY_EVIDENCE") {
            let recovery: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            // The Workflow harness uses its own Temporal run identity. The
            // actual native observations and all frozen identities are equal.
            let mut initial_report = recovery["report"].clone();
            initial_report["runId"] = stored["runId"].clone();
            assert_eq!(stored, initial_report);
            let resumed = &recovery["resumedReport"];
            assert_ne!(recovery["report"]["runId"], resumed["runId"]);
            verify_report(plan, resumed).unwrap();
            assert!(
                existing_registration(&mut tx, action, release_id, Some(&stored), resumed)
                    .await
                    .unwrap()
            );
            assert!(existing_registration(
                &mut tx,
                Uuid::new_v4(),
                release_id,
                Some(&stored),
                resumed
            )
            .await
            .is_err());
            for field in [
                "observations",
                "artifactDigest",
                "contractDigests",
                "suiteDigest",
                "planDigest",
                "operationId",
                "workflowId",
            ] {
                let mut forged = resumed.clone();
                forged[field] = Value::Null;
                assert!(
                    existing_registration(&mut tx, action, release_id, Some(&stored), &forged)
                        .await
                        .is_err(),
                    "{field}"
                );
            }
            let unchanged: Value = sqlx::query_scalar("select component_conformance_observation from admission.action_execution where id=$1")
                .bind(action).fetch_one(&mut *tx).await.unwrap();
            assert_eq!(
                unchanged, stored,
                "receipt recovery rewrote original evidence"
            );
            let count: i64 = sqlx::query_scalar("select count(*) from catalog.component_release where registered_by_action_execution_id=$1")
                .bind(action).fetch_one(&mut *tx).await.unwrap();
            assert_eq!(count, 1, "receipt recovery duplicated registration");
        }
        let visible =
            serde_json::to_value(read_releases(&mut tx, tenant, 1, 0).await.unwrap()).unwrap();
        assert_eq!(
            visible["releases"][0]["componentReleaseId"],
            release_id.to_string()
        );
        assert_eq!(visible["releases"][0]["status"], "REGISTERED");
        assert_eq!(
            visible["releases"][0]["registeredByActionExecutionId"],
            action.to_string()
        );
        let other =
            serde_json::to_value(read_releases(&mut tx, Uuid::new_v4(), 1, 0).await.unwrap())
                .unwrap();
        assert_eq!(other["releases"], json!([]));
        let mut save = tx.begin().await.unwrap();
        assert!(sqlx::query("update admission.action_execution set component_conformance_observation='{}' where id=$1")
            .bind(action).execute(&mut *save).await.is_err(),"immutable report rewritten");
        save.rollback().await.unwrap();
        tx.rollback().await.unwrap();
    }

    fn evidence() -> (Value, Value) {
        let key = Uuid::new_v4().to_string();
        let native_id = Uuid::new_v4().to_string();
        let mut steps = Vec::new();
        let mut observations = Vec::new();
        for (index, operation) in ["execute", "execute", "observe"].iter().enumerate() {
            let request = json!({"idempotencyKey":key});
            let expected = json!({"idempotencyKey":key,"nativeType":"fixture_task",
                "platformStatus":"SUCCEEDED","cancelCapability":"UNSUPPORTED"});
            let mut native = expected.clone();
            native["nativeId"] = json!(native_id);
            native["nativeStatus"] = json!("done");
            native["lastObservedAt"] = json!("2026-10-04T00:00:01Z");
            native["terminalAt"] = json!("2026-10-04T00:00:00Z");
            let step_key = format!("step_{index}");
            steps.push(
                json!({"caseKey":"protocol_execution_idempotency","stepKey":step_key,
                "operation":operation,"idempotencyKey":key,"requestJson":request.to_string(),
                "expectedResponseJson":expected.to_string(),"expectedHttpStatus":200}),
            );
            observations.push(json!({"caseKey":"protocol_execution_idempotency","stepKey":step_key,
                "operation":operation,"requestDigest":collab_bridge::limits::canonical_digest(&request),
                "responseDigest":collab_bridge::limits::canonical_digest(&json!({"execution":native})),
                "httpStatus":200,"nativeObservation":native}));
        }
        let plan = json!({"actionExecutionId":Uuid::new_v4(),"operationId":Uuid::new_v4(),
            "componentReleaseId":Uuid::new_v4(),"workflowId":"isolated-component-workflow",
            "artifactDigest":collab_bridge::limits::canonical_digest(&json!("artifact")),
            "contractDigests":[collab_bridge::limits::canonical_digest(&json!("contract"))],
            "suiteDigest":collab_bridge::limits::canonical_digest(&json!("suite")),
            "planDigest":collab_bridge::limits::canonical_digest(&json!("plan")),"steps":steps});
        let mut report = plan.clone();
        report.as_object_mut().unwrap().remove("steps");
        report["runId"] = json!(Uuid::new_v4());
        report["observations"] = json!(observations);
        (plan, report)
    }

    #[test]
    fn report_matches_original_action_artifact_contract_and_each_wire_step() {
        let (plan, report) = evidence();
        assert!(verify_report(&plan, &report).is_ok());
        for field in [
            "actionExecutionId",
            "operationId",
            "workflowId",
            "componentReleaseId",
            "artifactDigest",
            "contractDigests",
            "suiteDigest",
            "planDigest",
        ] {
            let mut changed = report.clone();
            changed[field] = json!("not-the-original");
            assert!(verify_report(&plan, &changed).is_err(), "{field}");
        }
        for field in [
            "caseKey",
            "stepKey",
            "operation",
            "httpStatus",
            "requestDigest",
            "responseDigest",
        ] {
            let mut changed = report.clone();
            changed["observations"][0][field] = json!("not-the-original");
            assert!(verify_report(&plan, &changed).is_err(), "{field}");
        }
        let mut missing = report.clone();
        missing["observations"].as_array_mut().unwrap().pop();
        assert!(verify_report(&plan, &missing).is_err());
        let mut error = report.clone();
        error["observations"][0]["errorClass"] = json!("UNKNOWN");
        assert!(verify_report(&plan, &error).is_err());
    }

    #[test]
    fn probe_authorization_derives_only_frozen_wire_and_actual_typed_reference() {
        let (mut plan, _) = evidence();
        plan["runId"] = json!("");
        let resource = Uuid::new_v4();
        plan["steps"][0]["referenceResourceId"] = json!(resource);
        plan["steps"][1]["referenceResourceId"] = json!(resource);
        plan["steps"][1]["referenceFromStepKey"] = plan["steps"][0]["stepKey"].clone();
        let reference = json!({"resourceId":resource,"nativeObjectRef":"native-created-object",
            "nativeRevision":"immutable-revision","displayName":"fixture","mediaType":"text/plain"});
        let mut probe = json!({"plan":plan,"stepIndex":1,"contentReference":reference});
        probe["plan"]["runId"] = json!(Uuid::new_v4());
        let (_, operation, request) = probe_request(&plan, &probe).unwrap();
        assert_eq!(operation, "execute");
        assert_eq!(request["contentReference"], reference);
        let mut changed = probe.clone();
        changed["contentReference"]["resourceId"] = json!(Uuid::new_v4());
        assert!(probe_request(&plan, &changed).is_err());
        changed = probe.clone();
        changed["plan"]["steps"][1]["requestJson"] = json!("{}");
        assert!(probe_request(&plan, &changed).is_err());
        changed = probe.clone();
        changed["stepIndex"] = json!(0);
        assert!(probe_request(&plan, &changed).is_err());
        changed = probe.clone();
        changed.as_object_mut().unwrap().remove("contentReference");
        assert!(probe_request(&plan, &changed).is_err());
        probe["reconcile"] = json!(true);
        let (_, operation, request) = probe_request(&plan, &probe).unwrap();
        assert_eq!(operation, "reconcile");
        assert_eq!(
            request,
            json!({"idempotencyKey":plan["steps"][1]["idempotencyKey"]})
        );
    }

    #[test]
    fn idempotency_requires_one_real_native_effect_and_immutable_terminal() {
        let (plan, report) = evidence();
        let mut unidentified = report.clone();
        for observation in unidentified["observations"].as_array_mut().unwrap() {
            observation["nativeObservation"]
                .as_object_mut()
                .unwrap()
                .remove("nativeId");
        }
        assert!(verify_report(&plan, &unidentified).is_err());
        for field in ["nativeId", "terminalAt", "lastObservedAt", "nativeStatus"] {
            let mut missing = report.clone();
            missing["observations"][1]["nativeObservation"]
                .as_object_mut()
                .unwrap()
                .remove(field);
            assert!(verify_report(&plan, &missing).is_err(), "{field}");
        }
        for (field, value) in [
            ("nativeId", json!(Uuid::new_v4())),
            ("nativeType", json!("different_type")),
            ("terminalAt", json!("2026-10-04T00:00:01Z")),
            ("lastObservedAt", json!("2026-10-03T00:00:00Z")),
            ("cancelCapability", json!("UNRECOGNIZED")),
            ("platformStatus", json!("UNKNOWN")),
        ] {
            let mut changed = report.clone();
            changed["observations"][1]["nativeObservation"][field] = value;
            assert!(verify_report(&plan, &changed).is_err(), "{field}");
        }
    }

    #[test]
    fn reconciliation_keeps_original_key_and_business_result_digest() {
        let (mut plan, mut report) = evidence();
        plan["steps"] = json!([plan["steps"][0].clone()]);
        report["observations"] = json!([report["observations"][0].clone()]);
        let step = &mut plan["steps"][0];
        step["caseKey"] = json!("records:1:read");
        step["contractKey"] = json!("records.read@v1");
        let output = json!({"nativeRef":"isolated-object","revision":"immutable-revision"});
        step["expectedResponseJson"] = json!(output.to_string());
        let observation = &mut report["observations"][0];
        observation["caseKey"] = step["caseKey"].clone();
        observation["operation"] = json!("reconcile");
        observation["resultDigest"] = json!(collab_bridge::limits::canonical_digest(&output));
        assert!(verify_report(&plan, &report).is_ok());
        report["observations"][0]["resultDigest"] =
            json!(collab_bridge::limits::canonical_digest(&json!({})));
        assert!(verify_report(&plan, &report).is_err());
        report["observations"][0]["resultDigest"] =
            json!(collab_bridge::limits::canonical_digest(&output));
        report["observations"][0]["requestDigest"] = json!(
            collab_bridge::limits::canonical_digest(&json!({"idempotencyKey":Uuid::new_v4()}))
        );
        assert!(verify_report(&plan, &report).is_err());
    }

    #[test]
    fn typed_reference_roundtrip_binds_the_actual_prior_reference_and_scope() {
        let (mut plan, mut report) = evidence();
        plan["steps"].as_array_mut().unwrap().truncate(2);
        report["observations"].as_array_mut().unwrap().truncate(2);
        let reference = json!({"resourceId":Uuid::new_v4(),"assetId":Uuid::new_v4(),
            "nativeObjectRef":"native-object-created-by-adapter","nativeRevision":"native-revision",
            "displayName":"fixture document","mediaType":"text/plain"});
        for index in 0..2 {
            let step = &mut plan["steps"][index];
            step["caseKey"] = json!("records:1:reference_roundtrip");
            step["contractKey"] = json!("records.read@v1");
            step["referenceResourceId"] = reference["resourceId"].clone();
            step["referenceAssetId"] = reference["assetId"].clone();
            step["expectedResponseJson"] = json!("{}");
            let mut request = json!({"idempotencyKey":step["idempotencyKey"],"referenceResourceId":reference["resourceId"],
                "referenceAssetId":reference["assetId"]});
            step["requestJson"] = json!(request.to_string());
            if index == 1 {
                step["referenceFromStepKey"] = json!("step_0");
                request["contentReference"] = reference.clone();
            }
            let observation = &mut report["observations"][index];
            observation["caseKey"] = step["caseKey"].clone();
            observation["contentReference"] = reference.clone();
            observation["resultDigest"] =
                json!(collab_bridge::limits::canonical_digest(&json!({})));
            observation["requestDigest"] = json!(collab_bridge::limits::canonical_digest(&request));
        }
        assert!(verify_report(&plan, &report).is_ok());
        for field in [
            "resourceId",
            "assetId",
            "nativeObjectRef",
            "nativeRevision",
            "displayName",
            "mediaType",
        ] {
            let mut changed = report.clone();
            changed["observations"][1]["contentReference"][field] = json!("another-value");
            assert!(verify_report(&plan, &changed).is_err(), "{field}");
        }
        let mut invented = report.clone();
        invented["observations"][0]
            .as_object_mut()
            .unwrap()
            .remove("contentReference");
        assert!(verify_report(&plan, &invented).is_err());
        let mut ignored = report.clone();
        let original: Value =
            serde_json::from_str(plan["steps"][1]["requestJson"].as_str().unwrap()).unwrap();
        ignored["observations"][1]["requestDigest"] =
            json!(collab_bridge::limits::canonical_digest(&original));
        assert!(verify_report(&plan, &ignored).is_err());
    }
}
