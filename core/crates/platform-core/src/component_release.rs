//! ComponentRelease 的登记内容归 Catalog；套件实际执行归原 ComponentTaskWorkflow。
//! REGISTERED 不授予 binding、工具或前端入口，approve/revoke 不由登记代行。

use std::collections::{BTreeMap, BTreeSet};

use contracts::ReasonCode;
use serde_json::{json, Value};
use sha2::Digest;
use sqlx::PgConnection;
use uuid::Uuid;

use crate::capability_contract::vector;
use crate::governance::{Definition, Execution, Params, Refusal, Target};

#[path = "component_release_approval.rs"]
pub(crate) mod approval;
#[path = "component_release_peer.rs"]
pub(crate) mod peer;

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

/// One Kailo value per key, each mapped to a non-empty native token.
fn native_mapping(value: &Value, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|map| {
        map.len() == keys.len()
            && keys.iter().all(|key| {
                map.get(*key).and_then(Value::as_str).is_some_and(|native| {
                    (1..=64).contains(&native.len())
                        && native
                            .bytes()
                            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
                })
            })
    })
}

/// DD-133: `NONE` keeps the service's own presentation. `KAILO_EMBED` is only
/// for a `NATIVE_PAGE` whose page ships the client-kit/embed tokens and
/// runtime: the theme follows Kailo live, the host resolves the locale, and
/// each mapping names the component's native value for every Kailo value.
fn validate_presentation(manifest: &Value) -> Result<(), Refusal> {
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
    let valid = match presentation["integrationMode"].as_str() {
        Some("NONE") => {
            presentation["themeChangePolicy"] == "NONE"
                && presentation["localeResolutionPolicy"] == "NONE"
                && presentation["themeMapping"] == json!({})
                && presentation["localeMapping"] == json!({})
        }
        Some("KAILO_EMBED") => {
            manifest["frontendDelivery"]["mode"] == "NATIVE_PAGE"
                && presentation["themeChangePolicy"] == "LIVE"
                && presentation["localeResolutionPolicy"] == "BROWSER_RESOLVED"
                && native_mapping(&presentation["themeMapping"], &["LIGHT", "DARK"])
                && native_mapping(&presentation["localeMapping"], &["ZH_CN", "EN"])
        }
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(bad())
    }
}

fn validate_frontend_delivery(manifest: &Value) -> Result<(), Refusal> {
    let frontend = &manifest["frontendDelivery"];
    exact_fields(
        frontend,
        &["mode", "extensionSlots", "editorOrigins"],
        &[
            "nativePageOrigins",
            "launchDescriptorSchemaVersion",
            "nativePageCategory",
        ],
    )?;
    // DD-127(4): a presentation category only labels a NATIVE_PAGE entry.
    if let Some(category) = frontend.get("nativePageCategory") {
        if frontend["mode"] != "NATIVE_PAGE"
            || !matches!(
                category.as_str(),
                Some("file_storage" | "knowledge" | "data_query")
            )
        {
            return Err(bad());
        }
    }
    if frontend["extensionSlots"] != json!([]) || manifest.get("hostApiRange").is_some() {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    match frontend["mode"].as_str() {
        Some("NONE" | "NATIVE_PAGE") => {
            if frontend["editorOrigins"] != json!([])
                || frontend.get("launchDescriptorSchemaVersion").is_some()
            {
                return Err(bad());
            }
            if frontend["mode"] == "NATIVE_PAGE" {
                crate::application_page::release_origins(frontend)?;
            } else if frontend
                .get("nativePageOrigins")
                .is_some_and(|v| v != &json!([]))
            {
                return Err(bad());
            }
        }
        Some("SOURCE_BOUND_PROTOCOL") => {
            if frontend["launchDescriptorSchemaVersion"] != "1" {
                return Err(bad());
            }
            let origins = frontend["editorOrigins"].as_array().ok_or_else(bad)?;
            let mut seen = BTreeSet::new();
            if origins.is_empty()
                || origins.iter().any(|value| {
                    value.as_str().is_none_or(|origin| {
                        !crate::protocol_session::launch::valid_editor_pattern(origin)
                            || !seen.insert(origin)
                    })
                })
            {
                return Err(bad());
            }
            if frontend
                .get("nativePageOrigins")
                .is_some_and(|v| v != &json!([]))
            {
                crate::application_page::release_origins(frontend)?;
            }
        }
        _ => return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)),
    }
    Ok(())
}

/// 07 §2.5/§3, 03 §3, DD-88/DD-94(1): the admission path selects the one
/// source identity of an immutable release. BUILTIN_REFERENCE is the source
/// project at an exact commit (its SOURCE_FACT/SOURCE_SEAM evidence is in 02);
/// EXTERNAL is the vendor/artifact pair with an optional upstream commit.
/// Fields of the other path are refused rather than ignored, so a release can
/// never carry two competing source identities. Both paths still run the same
/// COMPONENT_RELEASE conformance suite and the separate approval.
fn source_identity(manifest: &Value) -> Result<(), Refusal> {
    let commit = |value: &str, exact: bool| {
        value.len() == 40
            && value.bytes().all(|c| {
                c.is_ascii_digit()
                    || (b'a'..=b'f').contains(&c)
                    || (!exact && (b'A'..=b'F').contains(&c))
            })
    };
    match text(manifest, "admissionPath")? {
        "BUILTIN_REFERENCE" => {
            // A reference implementation is self-hosted from its own source;
            // VENDOR_MANAGED storage is reserved for external SaaS (07 §2.6).
            if manifest.get("vendor").is_some()
                || manifest.get("artifactVersion").is_some()
                || manifest["dataStoreIsolation"] == "VENDOR_MANAGED"
            {
                return Err(bad());
            }
            text(manifest, "sourceProject")?;
            // Git object names are lowercase; an abbreviated or re-cased value
            // would make two manifests name the same source differently.
            if !commit(text(manifest, "sourceCommit")?, true) {
                return Err(bad());
            }
        }
        "EXTERNAL" => {
            // EXTERNAL source identity is the vendor/artifact pair. Optional
            // upstream metadata does not substitute for conformance evidence.
            text(manifest, "vendor")?;
            text(manifest, "artifactVersion")?;
            if let Some(value) = manifest.get("sourceCommit") {
                if !commit(value.as_str().ok_or_else(bad)?, false) {
                    return Err(bad());
                }
            }
            if manifest.get("sourceProject").is_some() {
                text(manifest, "sourceProject")?;
            }
        }
        _ => return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)),
    }
    Ok(())
}

/// DD-127: a native-page-only release opens the service's own page and nothing
/// else. It declares no capability, domain definition or secret, so there is
/// no adapter to test and no conformance fixture to freeze. Its adapterBuildRef
/// slot carries the deployed native service artifact digest. DD-128: its model
/// call modes are a non-empty subset of {NONE, PLATFORM_LLM_ROUTE} (checked with
/// every release below); SELF_MANAGED_MODEL needs an adapter usage report.
fn native_page(manifest: &Value) -> Result<(), Refusal> {
    if manifest["frontendDelivery"]["mode"] != "NATIVE_PAGE"
        || manifest["frontendDelivery"]
            .get("nativePageCategory")
            .is_none()
        || !manifest["allowedModelCallModes"]
            .as_array()
            .is_some_and(|modes| {
                !modes.is_empty()
                    && modes
                        .iter()
                        .all(|mode| matches!(mode.as_str(), Some("NONE" | "PLATFORM_LLM_ROUTE")))
            })
        || [
            "implements",
            "capabilityDeclarations",
            "secretSchema",
            "targetResourceTypeKeys",
            "resourceTypeDefinitions",
            "actionDefinitions",
            "toolDefinitions",
        ]
        .iter()
        .any(|key| manifest[*key] != json!([]))
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    Ok(())
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
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    source_identity(&manifest)?;
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
    validate_frontend_delivery(&manifest)?;
    let connector = &manifest["executionConnector"];
    exact_fields(
        connector,
        &["mode", "adapterProtocolRange", "actionTokenAudience"],
        &[],
    )?;
    // DD-127: a native page entry has no connector (None); see native_page().
    let connector_kind = if crate::application_binding::native::native_page_only(&manifest) {
        native_page(&manifest)?;
        None
    } else {
        Some(crate::application_binding::native::Connector::from_manifest(&manifest)?)
    };
    if manifest["adapterProtocolRange"] != connector["adapterProtocolRange"] {
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
    // DD-92: declarations expose only installed model consumers. The binding
    // still verifies selected categories, native route/quota/key and usage fence.
    let modes = manifest["allowedModelCallModes"]
        .as_array()
        .ok_or_else(bad)?;
    if modes.is_empty()
        || modes
            .iter()
            .any(|mode| !matches!(mode.as_str(), Some("NONE" | "PLATFORM_LLM_ROUTE")))
        || modes
            .iter()
            .filter_map(Value::as_str)
            .collect::<BTreeSet<_>>()
            .len()
            != modes.len()
    {
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
    if contracts.is_empty() != connector_kind.is_none() {
        return Err(bad());
    }
    // DD-127(4): a capability release may label its entry only as one of the
    // categories it implements.
    if let Some(category) = manifest["frontendDelivery"].get("nativePageCategory") {
        if connector_kind.is_some()
            && !contracts
                .iter()
                .any(|(implemented, _)| category.as_str() == Some(implemented.as_str()))
        {
            return Err(bad());
        }
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
        if connector_kind == Some(crate::application_binding::native::Connector::ProtocolPeer)
            && (declaration["cancel"] != "UNSUPPORTED"
                || declaration["observe"] != "UNSUPPORTED"
                || declaration["meter"] != "UNSUPPORTED"
                || declaration["revisionQuery"] != "UNSUPPORTED"
                || declaration["onlineEditing"] != "UNSUPPORTED"
                || declaration["readEdge"] != "NONE")
        {
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        }
    }
    if declared != seen {
        return Err(bad());
    }
    validate_presentation(&manifest)?;
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
        || !(match connector_kind {
            Some(crate::application_binding::native::Connector::RemoteAdapter) => {
                states.contains(&json!("NATIVE_STATUS"))
            }
            Some(crate::application_binding::native::Connector::ProtocolPeer) => {
                states.contains(&json!("CORE_ACTION")) && states.contains(&json!("AGENTGATEWAY"))
            }
            // Only the Core binding lifecycle exists for a native page entry.
            None => states.contains(&json!("CORE_ACTION")),
        })
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
    // DD-127: registration() proved every declaration list empty.
    if crate::application_binding::native::native_page_only(&registration.manifest) {
        return Ok(contracts);
    }
    validate_declarations(registration, &contracts)?;
    for contract in &contracts {
        if crate::application_binding::native::Connector::from_manifest(&registration.manifest)?
            == crate::application_binding::native::Connector::ProtocolPeer
        {
            if contract["content"]["operationContracts"]
                .as_array()
                .ok_or_else(bad)?
                .iter()
                .any(|operation| operation["surface"] != "TOOL")
            {
                return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
            }
            continue;
        }
        if !vector::has_roundtrip(&contract["vectors"]) {
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
        crate::application_binding::native::Connector::from_manifest(manifest)?
            .validate_action(action)?;
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
            &["nativeTaskExecutionTimeoutSeconds"],
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
        if let Some(seconds) = action.get("nativeTaskExecutionTimeoutSeconds") {
            if action["executionMode"] != "TEMPORAL"
                || action["workflowType"] != "ComponentTaskWorkflow"
                || seconds.as_i64().is_none_or(|value| value <= 0)
            {
                return Err(bad());
            }
        }
        // DD-124(6): phase one registers no component-specific meter. Model
        // usage is metered by the platform meter fixed with Core, so every
        // APPLICATION action declares no meter and no quota policy.
        if action["meters"] != json!([]) || action["quotaPolicy"] != "NONE" {
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
    validate_protocol_fixture(registration, fixture)
}

fn validate_protocol_fixture(
    registration: &Registration,
    fixture: Value,
) -> Result<Value, Refusal> {
    exact_fields(
        &fixture,
        &["artifactDigest", "steps"],
        &["nativeReceivers", "preconditions"],
    )?;
    let typed: contracts::ComponentConformanceFixture =
        serde_json::from_value(fixture.clone()).map_err(|_| bad())?;
    if serde_json::to_value(typed).map_err(|_| bad())? != fixture
        || fixture["artifactDigest"] != registration.adapter_digest
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let steps = fixture["steps"].as_array().ok_or_else(bad)?;
    let existing_reference = !registration.manifest["implements"]
        .as_array()
        .ok_or_else(bad)?
        .is_empty();
    let cancel_supported = !existing_reference
        || registration.manifest["capabilityDeclarations"]
            .as_array()
            .ok_or_else(bad)?
            .iter()
            .any(|declaration| declaration["cancel"] == "SUPPORTED");
    // DD-98: capability services register existing native references. The
    // DD-101 example with implements=[] still proves real CREATE and fencing.
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
        if existing_reference && case.starts_with("protocol_scope_") {
            continue;
        }
        if *case == "protocol_cancel" && !cancel_supported {
            continue;
        }
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
                    if *case == "protocol_cancel" && !cancellable {
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
    // DD-127: no adapter, so neither a protocol fixture nor an isolated
    // conformance identity applies to a native page entry.
    if crate::application_binding::native::native_page_only(&registration.manifest) {
        return Ok(Target {
            id: registration.id,
            version: 1,
            workspace_id: None,
        });
    }
    if crate::application_binding::native::Connector::from_manifest(&registration.manifest)?
        == crate::application_binding::native::Connector::ProtocolPeer
    {
        peer::environment(&registration)?;
        return Ok(Target {
            id: registration.id,
            version: 1,
            workspace_id: None,
        });
    }
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
    if crate::application_binding::native::native_page_only(&registration.manifest) {
        return native_page_prewrite(tx, ae, &registration).await;
    }
    if crate::application_binding::native::Connector::from_manifest(&registration.manifest)?
        == crate::application_binding::native::Connector::ProtocolPeer
    {
        return peer::prewrite(tx, ae, &registration, &contracts).await;
    }
    let fixture = protocol_fixture(&registration)?;
    // DD-124(1): fixture values are only the candidate's natively created
    // identifiers. They are frozen into the plan before any token is signed.
    let preconditions = vector::fixture_values(&fixture, &contracts)?;
    let mut steps = fixture["steps"].as_array().ok_or_else(bad)?.clone();
    let mut native_cases = BTreeSet::new();
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
                let v2 = vector::is_v2(&contract["vectors"]);
                // DD-124(3)(4): every step of a RECEIVER case runs in the
                // isolated deployment.
                let receiver = v2 && vector::is_receiver(case)?;
                let (input, expected, bindings, keyed) = if v2 {
                    vector::freeze_step(step, &case_key, &preconditions)?
                } else {
                    let input = text(step, "inputJson")?.to_owned();
                    let expected = text(step, "expectedOutputJson")?.to_owned();
                    (input, expected, Vec::new(), None)
                };
                // DD-124(4): a target named by a precondition is frozen as the
                // fixture's Resource id, never chosen by the vector.
                let mut references = serde_json::Map::new();
                for field in [
                    "referenceResourceId",
                    "referenceAssetId",
                    "referenceFromStepKey",
                ] {
                    if let Some(value) = step.get(field) {
                        references.insert(field.to_owned(), value.clone());
                    }
                }
                if let Some(resource) = keyed {
                    references.insert("referenceResourceId".to_owned(), json!(resource));
                }
                // The vector body is interpreted only as capability input. It
                // cannot select an endpoint, credential, protocol verb or code.
                let mut request = json!({"idempotencyKey":key,"contractKey":contract_key,
                    "inputJson":input});
                for field in ["referenceResourceId", "referenceAssetId"] {
                    if let Some(value) = references.get(field) {
                        request[field] = value.clone();
                    }
                }
                let mut probe = json!({"caseKey":case_key,"stepKey":step_key,"operation":"execute",
                    "contractKey":contract_key,"idempotencyKey":key,
                    "requestJson":serde_json::to_string(&request).map_err(|_|bad())?,
                    "expectedResponseJson":expected,"expectedHttpStatus":200});
                // DD-124(2): only CAPTURE declarations remain; their values are
                // substituted by Core before signing and before comparison.
                if !bindings.is_empty() {
                    probe["bindings"] = json!(bindings);
                }
                if let Some(captures) = step.get("captures") {
                    probe["captures"] = captures.clone();
                }
                let native = registration.manifest["resourceTypeDefinitions"]
                    .as_array()
                    .ok_or_else(bad)?
                    .iter()
                    .flat_map(|resource| {
                        resource["incrementalContracts"]
                            .as_array()
                            .into_iter()
                            .flatten()
                    })
                    .any(|incremental| {
                        incremental["contractKey"] == contract_key
                            && incremental["role"] == "NATIVE_INTERNAL"
                            && incremental["engine"] == "NATIVE"
                    });
                // A NATIVE_MANAGED key is only ever observed in the receiver
                // direction; a V2 vector must place it in a RECEIVER case.
                if v2 && native && !receiver {
                    return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
                }
                if native || receiver {
                    let mappings: Vec<_> = fixture["nativeReceivers"]
                        .as_array()
                        .ok_or_else(bad)?
                        .iter()
                        .filter(|entry| {
                            entry["caseKey"] == case_key
                                && entry["stepKey"] == step_key
                                && entry["contractKey"] == contract_key
                        })
                        .collect();
                    if mappings.len() != 1
                        || !native_cases.insert((case_key.clone(), step_key.to_owned()))
                    {
                        return Err(bad());
                    }
                    let mut original = mappings[0]["request"].clone();
                    original["idempotencyKey"] = json!(key);
                    // The frozen input already carries the fixture's
                    // precondition values; only own captures stay declared.
                    let frozen: Value = serde_json::from_str(&input).map_err(|_| bad())?;
                    // A native batch is started by the candidate for its exact
                    // import configuration; an APPLICATION receiver action is
                    // admitted by the isolated Core and names none.
                    let configured = if native {
                        original.get("importConfigRef").is_some()
                            && frozen["importConfigRef"] == original["importConfigRef"]
                    } else {
                        original.get("importConfigRef").is_none()
                    };
                    if !configured
                        || chrono::DateTime::parse_from_rfc3339(text(&original, "expiresAt")?)
                            .map_err(|_| bad())?
                            <= chrono::Utc::now()
                    {
                        return Err(bad());
                    }
                    probe["operation"] = json!("receiver_start");
                    probe["requestJson"] = json!(collab_bridge::limits::canonical_json(&original));
                    probe["nativeReceiverInputJson"] = json!(input);
                }
                for (field, value) in &references {
                    probe[field.as_str()] = value.clone();
                }
                steps.push(probe.clone());
                // Repeat the exact request and idempotency key under a distinct
                // simulated actor. A cached success must not bypass permission;
                // only an actual wire DENIED, with no native result, passes.
                probe["stepKey"] = json!(format!("permission-denied:{step_key}"));
                probe.as_object_mut().ok_or_else(bad)?.remove("contractKey");
                probe
                    .as_object_mut()
                    .ok_or_else(bad)?
                    .remove("nativeReceiverInputJson");
                // The denied replay sends the same substituted request: keep the
                // INPUT bindings only; a refused step captures nothing. A
                // receiver request is never substituted, so it keeps none.
                let replay: Vec<_> = if native || receiver {
                    Vec::new()
                } else {
                    bindings
                        .iter()
                        .filter(|binding| binding["side"] == "INPUT")
                        .cloned()
                        .collect()
                };
                let object = probe.as_object_mut().ok_or_else(bad)?;
                object.remove("bindings");
                object.remove("captures");
                if !replay.is_empty() {
                    probe["bindings"] = json!(replay);
                }
                probe["expectedHttpStatus"] = json!(403);
                probe["expectedResponseJson"] =
                    json!(json!({"class":"DENIED","reason":"PERMISSION_DENIED"}).to_string());
                steps.push(probe);
            }
        }
    }
    if fixture.get("nativeReceivers").is_some_and(|entries| {
        entries
            .as_array()
            .is_none_or(|entries| entries.len() != native_cases.len())
    }) {
        return Err(bad());
    }
    let identity = crate::component_conformance_identity::load(
        &registration.adapter_digest,
        text(
            &registration.manifest["executionConnector"],
            "actionTokenAudience",
        )?,
    )?;
    for step in &mut steps {
        if step["operation"] != "execute" {
            continue;
        }
        let request: Value = serde_json::from_str(text(step, "requestJson")?).map_err(|_| bad())?;
        if request.get("contractKey").is_some() {
            let context =
                crate::component_conformance_identity::context(&identity, step, "execute")?;
            step["requestJson"] = json!(collab_bridge::limits::canonical_json(
                &production_probe_execute(&request, context)?,
            ));
        }
    }
    crate::component_conformance_identity::check_plan(&identity, &steps)?;
    // DD-124(4): receiver steps are observed only from the isolated deployment
    // of this Core build that runs the APPROVED source release; a plan without
    // them carries no receiver environment.
    let receiving = steps
        .iter()
        .any(|step| step["operation"] == "receiver_start");
    let environment = identity.get("receiverEnvironment").cloned();
    if receiving != environment.is_some() {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    if let Some(environment) = &environment {
        receiver_source(tx, ae.tenant_id, environment, true).await?;
    }
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
    if let Some(environment) = environment {
        plan["receiverEnvironment"] = environment;
    }
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

/// DD-127: the original ComponentTask freezes an empty suite for a native page
/// entry: no step, no contract digest. Its identity is the release's own
/// native page origins and service artifact; record() writes REGISTERED from
/// the same Workflow's report, and approval stays the separate action.
async fn native_page_prewrite(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ae: &Execution,
    registration: &Registration,
) -> Result<i32, Refusal> {
    let identity = json!({"executionConnector":"NONE",
        "nativePageOrigins":registration.manifest["frontendDelivery"]["nativePageOrigins"],
        "artifactDigest":registration.adapter_digest});
    let identity_digest = collab_bridge::limits::canonical_digest(&identity);
    let workflow =
        crate::component_task::workflow_id(KIND, ae.tenant_id, &registration.id.to_string(), 1);
    let mut plan = json!({"actionExecutionId":ae.id,"operationId":ae.operation_id,
        "workflowId":workflow,"runId":"","componentReleaseId":registration.id,
        "artifactDigest":registration.adapter_digest,"contractDigests":[],
        "suiteDigest":collab_bridge::limits::canonical_digest(
            &json!({"steps":[],"contracts":[],"identityDigest":identity_digest})),
        "planDigest":"","identityDigest":identity_digest,"steps":[]});
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

/// DD-124(4): the isolated receiver deployment named by a plan runs this Core
/// build (`build`) and the production Catalog's APPROVED release of a category
/// that declares the source read edge, at its registered artifact and manifest.
/// A later approval re-checks only the source release, not the Core build.
pub(crate) async fn receiver_source(
    conn: &mut PgConnection,
    tenant: Uuid,
    environment: &Value,
    build: bool,
) -> Result<(), Refusal> {
    exact_fields(
        environment,
        &[
            "isolatedCoreBuildId",
            "sourceReleaseId",
            "sourceArtifactDigest",
            "sourceManifestDigest",
        ],
        &[],
    )?;
    let commit = text(environment, "isolatedCoreBuildId")?;
    if commit.len() != 40
        || !commit
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        || !digest(text(environment, "sourceArtifactDigest")?)
        || !digest(text(environment, "sourceManifestDigest")?)
    {
        return Err(bad());
    }
    if build && commit != crate::platform_build_info::core_build_id()? {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let source = Uuid::parse_str(text(environment, "sourceReleaseId")?).map_err(|_| bad())?;
    let row: Option<(Value, String, String)> = sqlx::query_as(
        "select manifest,adapter_build_ref,manifest_digest from catalog.component_release
        where id=$1 and catalog_tenant_id=$2 and status='APPROVED' for share",
    )
    .bind(source)
    .bind(tenant)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((manifest, artifact, manifest_digest)) = row else {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    };
    let declared = manifest["capabilityDeclarations"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|item| matches!(item["readEdge"].as_str(), Some("SOURCE" | "BOTH")));
    if !declared {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    if environment["sourceArtifactDigest"] != artifact
        || environment["sourceManifestDigest"] != manifest_digest
    {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    Ok(())
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
    // DD-127: only a plan frozen without any contract has no step.
    if steps.is_empty() != (plan["contractDigests"] == json!([]))
        || steps.len() != observations.len()
    {
        return Err(bad());
    }
    let mut last_native: BTreeMap<String, Value> = BTreeMap::new();
    let mut last_scope: BTreeMap<String, Value> = BTreeMap::new();
    let mut content_references: BTreeMap<(String, String), Value> = BTreeMap::new();
    let mut captured: BTreeMap<(String, String), String> = BTreeMap::new();
    // DD-124(4): every identifier the isolated Core generated for a receiver
    // step is absent from the frozen plan, which carries every fixture value.
    let frozen = collab_bridge::limits::canonical_json(plan);
    // DD-124(3)(4): a RECEIVER case as a whole carries the source reads.
    let mut receiving = BTreeSet::new();
    let mut reading = BTreeSet::new();
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
        let mut expected: Value =
            serde_json::from_str(text(step, "expectedResponseJson")?).map_err(|_| bad())?;
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
            apply_probe_reference(&mut request, reference)?;
        }
        let case = text(step, "caseKey")?;
        let receiver_step = matches!(
            text(step, "operation")?,
            "receiver_start" | "receiver_observe"
        );
        if receiver_step {
            // A receiver request is never substituted; its captures are
            // re-derived from its own isolated evidence below. A refused or
            // unfinished receiver observation carries none.
            if observation["httpStatus"] != 200 && observation.get("captures").is_some() {
                return Err(bad());
            }
        } else {
            // DD-124(2): the values come only from earlier recorded
            // observations; this step's own captures are recorded after its
            // substitution.
            let values = vector::recorded_values(step, case, &captured)?;
            vector::apply(step, &values, &mut request, &mut expected)?;
            for (key, value) in vector::observed(step, observation)? {
                if captured.insert((case.to_owned(), key), value).is_some() {
                    return Err(bad());
                }
            }
        }
        let actual_operation = text(observation, "operation")?;
        if actual_operation == "reconcile"
            && matches!(
                text(step, "operation")?,
                "execute" | "cancel" | "observe" | "reconcile"
            )
        {
            request = json!({"idempotencyKey":step["idempotencyKey"]});
        } else if actual_operation == "receiver_observe" && step["operation"] == "receiver_start" {
            // Exact same frozen request: observing never selects another
            // native batch or extends the original first-dispatch deadline.
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
        if matches!(actual_operation, "receiver_start" | "receiver_observe")
            && observation["httpStatus"] == 200
        {
            let native = observation
                .get("nativeReceiverObservation")
                .ok_or_else(bad)?;
            validate_receiver_observation(&request, native)?;
            if native["completed"] != true
                || expected != json!({})
                || observation.get("nativeObservation").is_some()
                || observation.get("nativeScopeObservation").is_some()
                || observation.get("bindingDigest").is_some()
                || observation.get("contentReference").is_some()
                || observation.get("resultDigest").is_some()
                || source_reference.is_some()
            {
                return Err(bad());
            }
            // DD-124(4): the admission the isolated Core actually produced
            // equals the frozen input with the case's earlier and this step's
            // own captured identifiers, which are exactly the recorded ones.
            // A step that reads no source has no admission evidence: it
            // captures nothing and its input is not compared.
            receiving.insert(case.to_owned());
            let reads = native["readOperations"].as_array().ok_or_else(bad)?;
            let values = if reads.is_empty() {
                if step.get("captures").is_some() {
                    return Err(bad());
                }
                Vec::new()
            } else {
                reading.insert(case.to_owned());
                let (read, admitted) = vector::receiver_admission(step, native)?;
                let values = vector::receiver_values(step, read, &admitted)?;
                let mut known: Vec<(String, String)> = captured
                    .iter()
                    .filter(|((owner, _), _)| owner == case)
                    .map(|((_, key), value)| (key.clone(), value.clone()))
                    .collect();
                known.extend(values.iter().cloned());
                if vector::receiver_input(step, &known)? != admitted {
                    return Err(bad());
                }
                values
            };
            vector::receiver_recorded(observation, &values)?;
            // The isolated Core generated these in this run; none may be a
            // value the plan or its fixture could have supplied.
            let mut generated = vec![text(native, "nativeBatchId")?];
            for read in native["readOperations"].as_array().ok_or_else(bad)? {
                for field in [
                    "actionExecutionId",
                    "receiverActionExecutionId",
                    "operationId",
                ] {
                    generated.push(text(read, field)?);
                }
            }
            if generated.iter().any(|id| frozen.contains(id)) {
                return Err(bad());
            }
            for (key, value) in values {
                if captured.insert((case.to_owned(), key), value).is_some() {
                    return Err(bad());
                }
            }
            continue;
        }
        if observation.get("nativeReceiverObservation").is_some() {
            return Err(bad());
        }
        if actual_operation == "validate_binding"
            && observation["httpStatus"]
                .as_i64()
                .is_some_and(|status| (200..300).contains(&status))
        {
            if plan["connectorKind"] == "PROTOCOL_PEER"
                || observation["bindingDigest"]
                    != collab_bridge::limits::canonical_digest(&expected)
                || observation.get("nativeObservation").is_some()
                || observation.get("nativeScopeObservation").is_some()
                || observation.get("contentReference").is_some()
                || observation.get("resultDigest").is_some()
                || step.get("contractKey").is_some()
                || source_reference.is_some()
                || step.get("referenceResourceId").is_some()
            {
                return Err(bad());
            }
            continue;
        }
        if observation.get("bindingDigest").is_some() {
            return Err(bad());
        }
        if plan["connectorKind"] == "PROTOCOL_PEER" {
            if observation["httpStatus"] != 0
                || observation["mcpResultKind"] != "RESULT"
                || step["expectedMcpResultKind"] != "RESULT"
                || observation.get("nativeObservation").is_some()
                || observation.get("nativeScopeObservation").is_some()
                || observation.get("contentReference").is_some()
                || source_reference.is_some()
                || (if step["operation"] == "mcp_call" {
                    &observation["resultDigest"]
                } else {
                    &observation["responseDigest"]
                }) != &json!(collab_bridge::limits::canonical_digest(&expected))
            {
                return Err(bad());
            }
            continue;
        }
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
    if receiving != reading {
        return Err(bad());
    }
    Ok(())
}

/// Derive the exact request from the immutable plan and the fixed typed slot.
/// There is no caller-supplied URL, method, JSON path or general-purpose patch.
fn apply_probe_reference(request: &mut Value, reference: &Value) -> Result<(), Refusal> {
    if request["arguments"]["input"] != json!({}) {
        return Err(bad());
    }
    request["arguments"]["input"] = reference.clone();
    Ok(())
}

// The vector is input data, not another execute protocol. Target selection is
// frozen from the isolated identity delivery before signing or wire dispatch.
fn production_probe_execute(request: &Value, context: &Value) -> Result<Value, Refusal> {
    let key = text(request, "contractKey")?;
    if context["actionKey"] != key {
        return Err(bad());
    }
    let target_field = match text(context, "targetType")? {
        "RESOURCE" => "resourceId",
        "ASSET" => "assetId",
        _ => return Err(bad()),
    };
    let target = Uuid::parse_str(text(context, "targetId")?).map_err(|_| bad())?;
    if target.is_nil() {
        return Err(bad());
    }
    let input: Value = serde_json::from_str(text(request, "inputJson")?).map_err(|_| bad())?;
    Ok(
        json!({"idempotencyKey":text(request,"idempotencyKey")?,"actionKey":key,
        "arguments":{"target":{(target_field):target},"input":input}}),
    )
}

fn validate_probe_input(
    contracts: &[Value],
    operation: &str,
    request: &Value,
) -> Result<(), Refusal> {
    if operation != "execute" || request.get("actionKey").is_none() {
        return Ok(());
    }
    let key = text(request, "actionKey")?;
    let mut matches = contracts.iter().flat_map(|contract| {
        contract["content"]["operationContracts"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(move |operation| operation["contractKey"] == key)
            .map(move |operation| (contract, operation))
    });
    let (contract, declared) = matches.next().ok_or_else(bad)?;
    if matches.next().is_some() {
        return Err(bad());
    }
    let documents: BTreeMap<String, Value> =
        serde_json::from_value(contract["schemas"].clone()).map_err(|_| bad())?;
    let schema = documents
        .get(text(declared, "inputSchemaDigest")?)
        .ok_or_else(bad)?;
    let input = request["arguments"].get("input").ok_or_else(bad)?;
    if !crate::capability_contract::schema_validator(schema, &documents)?.is_valid(input) {
        return Err(bad());
    }
    Ok(())
}

fn probe_request(plan: &Value, input: &Value) -> Result<(Value, String, Value, Value), Refusal> {
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
    let mut expected: Value =
        serde_json::from_str(text(&step, "expectedResponseJson")?).map_err(|_| bad())?;
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
        apply_probe_reference(&mut request, reference)?;
    } else if input.get("contentReference").is_some() {
        return Err(bad());
    }
    // DD-124(2): substitute the captured values before the token is signed
    // (the parameter hash covers them) and before the expectation is digested.
    // A receiver request is never substituted (DD-124(4)): its own capture
    // declarations describe the isolated admission and are checked on record.
    let receiver = matches!(operation.as_str(), "receiver_start" | "receiver_observe");
    if step.get("bindings").is_some() && !receiver {
        let values = vector::probe_values(&step, input)?;
        vector::apply(&step, &values, &mut request, &mut expected)?;
    } else if input.get("captures").is_some() {
        return Err(bad());
    }
    if input["reconcile"].as_bool() == Some(true) {
        match operation.as_str() {
            "resolve_native_scope" => request["mode"] = json!("LOOKUP"),
            "execute" | "cancel" | "observe" | "reconcile" => {
                operation = "reconcile".into();
                request = json!({"idempotencyKey":step["idempotencyKey"]});
            }
            "receiver_start" | "receiver_observe" => operation = "receiver_observe".into(),
            _ => (),
        }
    }
    Ok((step, operation, request, expected))
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
    if serde_json::to_value(&probe)
        .ok()
        .is_some_and(|value| value["plan"]["connectorKind"] == "PROTOCOL_PEER")
    {
        return peer::run_probe(&state, probe).await;
    }
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
        let (step,operation,request,expected)=probe_request(&plan,&input)?;
        // DD-124(4): the isolated deployment must still run this Core build and
        // the APPROVED source release the frozen plan names.
        if matches!(operation.as_str(),"receiver_start"|"receiver_observe") {
            receiver_source(&mut tx,ae.tenant_id,plan.get("receiverEnvironment").ok_or_else(bad)?,true).await?;
        }
        let params=ae.parameters.as_ref().and_then(|v|v.get("params")).and_then(Params::from_json).ok_or_else(bad)?;
        let release=registration(params.component_release_registration.as_ref().ok_or_else(bad)?)?;
        let contracts=active_contracts(&mut tx,ae.tenant_id,&release).await?;
        let digests:Vec<_>=contracts.iter().map(collab_bridge::limits::canonical_digest).collect();
        if plan["contractDigests"] != json!(digests) { return Err(Refusal::Conflict(ReasonCode::TargetStateConflict)); }
        if step.get("contractKey").is_some() && !matches!(operation.as_str(), "receiver_start" | "receiver_observe") {
            validate_probe_input(&contracts,&operation,&request)?;
        }
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
            .bind(crate::component_conformance_identity::result_policy_id(context)?)
            .fetch_one(&mut *tx).await?;
        if collides { return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed)); }
        let token=crate::component_conformance_identity::sign(&state,&identity,context,ae.id,ae.operation_id,&operation,&request).await?;
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

// OpenBao creates a new request ID for each real read. Preserve the complete
// response digest for evidence, but compare only the fixed binding metadata.
// This is the one closed protocol case, not a configurable JSON matcher.
fn binding_comparison(request: &Value, response: &Value) -> Result<Value, Refusal> {
    let typed: contracts::AdapterBindingObservation =
        serde_json::from_value(response.clone()).map_err(|_| bad())?;
    if serde_json::to_value(typed).map_err(|_| bad())? != *response {
        return Err(bad());
    }
    for field in [
        "bindingId",
        "tenantId",
        "workspaceId",
        "nativeInstanceRef",
        "isolationMode",
        "configDigest",
    ] {
        if request.get(field) != response.get(field) {
            return Err(bad());
        }
    }
    if request
        .get("nativeScopeRef")
        .is_some_and(|scope| scope != &response["nativeScopeRef"])
        || text(response, "nativeScopeRef").is_err()
        || response["secretRefDigest"]
            != collab_bridge::limits::canonical_digest(&request["secretRefs"])
    {
        return Err(bad());
    }
    let refs = request["secretRefs"].as_array().ok_or_else(bad)?;
    let reads = response["secretReads"].as_array().ok_or_else(bad)?;
    if refs.len() != reads.len() {
        return Err(bad());
    }
    let mut keys = BTreeSet::new();
    for read in reads {
        let key = text(read, "secretKey")?;
        let id = Uuid::parse_str(text(read, "requestId")?).map_err(|_| bad())?;
        let matching: Vec<_> = refs
            .iter()
            .filter(|reference| reference["secretKey"] == key)
            .collect();
        if !keys.insert(key)
            || id.is_nil()
            || matching.len() != 1
            || read["version"].as_u64().is_none_or(|version| version == 0)
            || text(read, "audience").is_err()
        {
            return Err(bad());
        }
        if read["version"] != matching[0]["version"] || read["audience"] != matching[0]["audience"]
        {
            return Err(bad());
        }
    }
    let mut fixed = response.clone();
    for read in fixed["secretReads"].as_array_mut().ok_or_else(bad)? {
        read.as_object_mut().ok_or_else(bad)?.remove("requestId");
    }
    Ok(fixed)
}

fn wire_digests(
    step: &Value,
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
    if (200..300).contains(&status) && matches!(operation, "receiver_start" | "receiver_observe") {
        validate_receiver_observation(request, &response)?;
        // DD-124(4): a receiver step's captures come only from the completed
        // run the isolated Core admitted; they are re-derived on record.
        if response["completed"] == true && step.get("captures").is_some() {
            let (read, input) = vector::receiver_admission(step, &response)?;
            let values = vector::receiver_values(step, read, &input)?;
            if let Some(captures) = vector::receiver_wire(&values) {
                out["captures"] = captures;
            }
        }
        out["nativeReceiverObservation"] = response.clone();
    }
    if (200..300).contains(&status) && operation == "validate_binding" {
        out["bindingDigest"] = json!(collab_bridge::limits::canonical_digest(
            &binding_comparison(request, &response)?,
        ));
    }
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
            let mut result: Value =
                serde_json::from_str(raw.as_str().ok_or_else(bad)?).map_err(|_| bad())?;
            crate::application_tool::citation_output(&response, &result)?;
            // DD-124: captured only from this actual SUCCEEDED response with
            // its native status; a self-captured position is normalized.
            if let Some(captures) = vector::capture(step, &response, Some(&mut result))? {
                out["captures"] = json!(captures);
            }
            out["resultDigest"] = json!(collab_bridge::limits::canonical_digest(&result));
        } else if response.get("contentReferences").is_some() {
            return Err(bad());
        }
    }
    serde_json::from_value(out).map_err(|_| bad())
}

fn validate_receiver_observation(request: &Value, observation: &Value) -> Result<(), Refusal> {
    let typed: contracts::ComponentNativeReceiverObservation =
        serde_json::from_value(observation.clone()).map_err(|_| bad())?;
    if serde_json::to_value(typed).map_err(|_| bad())? != *observation
        || observation["request"] != *request
    {
        return Err(bad());
    }
    let batch = Uuid::parse_str(text(observation, "nativeBatchId")?).map_err(|_| bad())?;
    let started =
        chrono::DateTime::parse_from_rfc3339(text(observation, "startedAt")?).map_err(|_| bad())?;
    let finished = observation
        .get("finishedAt")
        .map(|value| {
            chrono::DateTime::parse_from_rfc3339(value.as_str().ok_or_else(bad)?).map_err(|_| bad())
        })
        .transpose()?;
    let reads = observation["readOperations"].as_array().ok_or_else(bad)?;
    // DD-124(4): a native batch names its import configuration and admits one
    // SERVICE receiver per read. An isolated APPLICATION receiver action names
    // none; it is the single anchor of every read, carried by its request. A
    // step of a RECEIVER case that reads no source (read, export, search,
    // delete) completes without reads: the case as a whole carries them.
    let batched = request.get("importConfigRef").is_some();
    if batch.is_nil()
        || started > chrono::Utc::now()
        || finished.is_some_and(|at| at < started || at > chrono::Utc::now())
        || (observation["completed"] == true
            && (finished.is_none() || (batched && reads.is_empty())))
    {
        return Err(bad());
    }
    text(observation, "nativeStatus")?;
    let mut anchor: Option<&str> = None;
    let mut operations = BTreeSet::new();
    let mut executions = BTreeSet::new();
    let mut keys = BTreeSet::new();
    for read in reads {
        for field in [
            "actionExecutionId",
            "receiverActionExecutionId",
            "operationId",
            "sourceBindingId",
        ] {
            if Uuid::parse_str(text(read, field)?)
                .map_err(|_| bad())?
                .is_nil()
            {
                return Err(bad());
            }
        }
        let receiver_execution = text(read, "receiverActionExecutionId")?;
        if !operations.insert(text(read, "operationId")?)
            || !executions.insert(text(read, "actionExecutionId")?)
        {
            return Err(bad());
        }
        if batched {
            if !executions.insert(receiver_execution)
                || read["nativeBatch"]["batchId"] != observation["nativeBatchId"]
                || read["nativeBatch"]["importConfigRef"] != request["importConfigRef"]
                || read["readRequest"]["nativeBatch"] != read["nativeBatch"]
                || read["readRequest"]
                    .get("receiverActionExecutionId")
                    .is_some()
            {
                return Err(bad());
            }
        } else if read.get("nativeBatch").is_some()
            || read["readRequest"].get("nativeBatch").is_some()
            || read["readRequest"]["receiverActionExecutionId"] != receiver_execution
            || text(&read["readRequest"], "receiverArgumentsJson").is_err()
            || anchor.is_some_and(|anchor| anchor != receiver_execution)
        {
            return Err(bad());
        }
        anchor = Some(receiver_execution);
        if read["receiverGeneration"] != request["generation"]
            || read["readRequest"]["sourceResourceId"] != read["sourceResourceId"]
            || read["readRequest"]["receiverBindingId"] != request["bindingId"]
            || read["readRequest"]
                .get("observeActionExecutionId")
                .is_some()
            || Uuid::parse_str(text(read, "sourceResourceId")?)
                .map_err(|_| bad())?
                .is_nil()
        {
            return Err(bad());
        }
        let source = &read["sourceReceipt"];
        let receiver = &read["receiverReceipt"];
        if source["role"] != "SOURCE"
            || receiver["role"] != "RECEIVER"
            || source["bindingId"] != read["sourceBindingId"]
            || receiver["bindingId"] != request["bindingId"]
            || source["operationId"] != read["operationId"]
            || receiver["operationId"] != read["operationId"]
            || read["readRequest"]["idempotencyKey"] != source["idempotencyKey"]
            || !keys.insert(text(source, "idempotencyKey")?)
        {
            return Err(bad());
        }
        for field in ["idempotencyKey", "contentSha256", "contentBytes"] {
            if source[field] != receiver[field] {
                return Err(bad());
            }
        }
        for receipt in [source, receiver] {
            if Uuid::parse_str(text(receipt, "idempotencyKey")?)
                .map_err(|_| bad())?
                .is_nil()
                || !digest(text(receipt, "contentSha256")?)
                || receipt["contentBytes"].as_u64().is_none()
            {
                return Err(bad());
            }
            text(receipt, "nativeObjectRef")?;
            text(receipt, "nativeRevision")?;
            let completed = chrono::DateTime::parse_from_rfc3339(text(receipt, "completedAt")?)
                .map_err(|_| bad())?;
            if completed > chrono::Utc::now() || finished.is_some_and(|at| completed > at) {
                return Err(bad());
            }
        }
    }
    // The anchoring receiver action is not one of its own SOURCE reads.
    if let Some(anchor) = anchor.filter(|_| !batched) {
        if !executions.insert(anchor) {
            return Err(bad());
        }
    }
    Ok(())
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
        let (step,operation,request,_)=probe_request(&plan,probe)?;
        let out=wire_digests(&step,&request,&operation,input["httpStatus"].as_i64().ok_or_else(bad)?,text(&input,"responseJson")?)?;
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
            // DD-124(4): receiver evidence is accepted only while the isolated
            // deployment is this Core build and the source release is APPROVED.
            if let Some(environment) = plan.get("receiverEnvironment") {
                receiver_source(&mut tx, ae.tenant_id, environment, true).await?;
            }
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
    if plan["connectorKind"] == "PROTOCOL_PEER" {
        // Worker observations alone cannot invent a completed native probe.
        // Each result must have reached the original authenticated Core SDK
        // consumer and its same-operation audit before Catalog is written.
        for index in 0..plan["steps"].as_array().ok_or_else(bad)?.len() {
            let recorded: bool = sqlx::query_scalar(
                "select exists(select 1 from audit.audit_event
                where event_key=$1 and tenant_id=$2 and operation_id=$3 and action_key=$4
                  and action_version=$5 and target_id=$6 and parameter_hash=$7
                  and event_type='RESULT' and decision='ALLOW' and result_code='SUCCEEDED')",
            )
            .bind(format!("{}:mcp-probe:{index}:result", ae.operation_id))
            .bind(ae.tenant_id)
            .bind(ae.operation_id)
            .bind(&ae.action_key)
            .bind(ae.action_version)
            .bind(ae.target_id)
            .bind(&ae.parameter_hash)
            .fetch_one(&mut *conn)
            .await?;
            if !recorded {
                return Err(Refusal::Unavailable(
                    "native MCP probe result unresolved".into(),
                ));
            }
        }
    }
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

    /// The original call shape: a frozen step without DD-124 captures.
    fn wire_digests(
        request: &Value,
        operation: &str,
        status: i64,
        raw: &str,
    ) -> Result<contracts::ComponentConformanceWireDigests, Refusal> {
        super::wire_digests(&json!({}), request, operation, status, raw)
    }

    #[test]
    fn receiver_wire_keeps_real_batch_and_bilateral_read_identity() {
        let binding = Uuid::new_v4();
        let source = Uuid::new_v4();
        let operation = Uuid::new_v4();
        let key = Uuid::new_v4();
        let resource = Uuid::new_v4();
        let request = json!({"bindingId":binding,"generation":3,"idempotencyKey":Uuid::new_v4(),
            "importConfigRef":Uuid::new_v4(),"expiresAt":"2026-10-11T01:00:00.000Z"});
        let batch = json!({"batchId":Uuid::new_v4(),"importConfigRef":request["importConfigRef"],
            "receiverResourceId":Uuid::new_v4(),"actionKey":"knowledge.sync_apply@v2","actionVersion":2});
        let receipt = json!({"bindingId":source,"operationId":operation,"idempotencyKey":key,"role":"SOURCE",
            "nativeObjectRef":"source-reference","nativeRevision":"retained-revision","contentSha256":"a".repeat(64),
            "contentBytes":0,"completedAt":"2026-01-01T00:00:01Z","measurements":[]});
        let mut receiver = receipt.clone();
        receiver["bindingId"] = json!(binding);
        receiver["role"] = json!("RECEIVER");
        let read = json!({"actionExecutionId":Uuid::new_v4(),"receiverActionExecutionId":Uuid::new_v4(),
            "receiverGeneration":3,"operationId":operation,"sourceBindingId":source,"sourceResourceId":resource,
            "nativeBatch":batch,"sourceReceipt":receipt,"receiverReceipt":receiver,
            "readRequest":{"receiverBindingId":binding,"sourceResourceId":resource,"actionKey":"file_storage.read@v2",
            "actionVersion":1,"inputJson":"{}","idempotencyKey":key,"nativeBatch":batch}});
        let observation = json!({"request":request,"nativeBatchId":batch["batchId"],"nativeStatus":"success",
            "startedAt":"2026-01-01T00:00:00Z","finishedAt":"2026-01-01T00:00:02Z","completed":true,"readOperations":[read]});
        assert!(validate_receiver_observation(&request, &observation).is_ok());
        for scenario in [
            "foreign-batch",
            "wrong-generation",
            "duplicate-operation",
            "missing-reads",
            "changed-receipt",
            "lookup-in-proof",
        ] {
            let mut changed = observation.clone();
            match scenario {
                "foreign-batch" => changed["nativeBatchId"] = json!(Uuid::new_v4()),
                "wrong-generation" => changed["readOperations"][0]["receiverGeneration"] = json!(4),
                "duplicate-operation" => changed["readOperations"]
                    .as_array_mut()
                    .unwrap()
                    .push(read.clone()),
                "missing-reads" => changed["readOperations"] = json!([]),
                "changed-receipt" => {
                    changed["readOperations"][0]["receiverReceipt"]["contentBytes"] = json!(1)
                }
                _ => {
                    changed["readOperations"][0]["readRequest"]["observeActionExecutionId"] =
                        json!(Uuid::new_v4())
                }
            }
            assert!(
                validate_receiver_observation(&request, &changed).is_err(),
                "{scenario}"
            );
        }
        // This validates only wire identity. Worker must separately query the
        // isolated Core's original authenticated receipt/usage authority.
    }

    #[test]
    fn binding_wire_compares_fixed_metadata_without_predicting_read_ids() {
        let reference =
            json!({"secretKey":"connection", "version":1, "audience":"isolated-adapter"});
        let request = json!({"bindingId":Uuid::new_v4(), "tenantId":Uuid::new_v4(),
            "nativeInstanceRef":"isolated-instance", "nativeScopeRef":"isolated-scope",
            "isolationMode":"DEDICATED_INSTANCE", "configDigest":"a".repeat(64),
            "secretRefs":[reference.clone()]});
        let mut response = request.clone();
        response.as_object_mut().unwrap().remove("secretRefs");
        response["artifactDigest"] = json!("b".repeat(64));
        response["secretRefDigest"] = json!(collab_bridge::limits::canonical_digest(
            &request["secretRefs"]
        ));
        response["executionMappings"] = json!([]);
        let mut read = reference;
        read["requestId"] = json!(Uuid::new_v4());
        response["secretReads"] = json!([read]);
        let first = wire_digests(&request, "validate_binding", 200, &response.to_string()).unwrap();
        response["secretReads"][0]["requestId"] = json!(Uuid::new_v4());
        let second =
            wire_digests(&request, "validate_binding", 200, &response.to_string()).unwrap();
        assert_eq!(first.binding_digest, second.binding_digest);
        assert_ne!(first.response_digest, second.response_digest);
        for (field, value) in [
            ("requestId", json!(Uuid::nil())),
            ("requestId", json!("invalid")),
            ("version", json!(2)),
            ("audience", json!("other")),
        ] {
            let mut changed = response.clone();
            changed["secretReads"][0][field] = value;
            assert!(wire_digests(&request, "validate_binding", 200, &changed.to_string()).is_err());
        }
        let mut missing = response.clone();
        missing["secretReads"][0]
            .as_object_mut()
            .unwrap()
            .remove("requestId");
        assert!(wire_digests(&request, "validate_binding", 200, &missing.to_string()).is_err());
        let mut wrong_scope = response.clone();
        wrong_scope["nativeScopeRef"] = json!("other");
        assert!(wire_digests(&request, "validate_binding", 200, &wrong_scope.to_string()).is_err());
        let mut changed = response.clone();
        changed["artifactDigest"] = json!("c".repeat(64));
        assert_ne!(
            first.binding_digest,
            wire_digests(&request, "validate_binding", 200, &changed.to_string())
                .unwrap()
                .binding_digest
        );
        assert!(wire_digests(
            &request,
            "validate_binding",
            403,
            &json!({"class":"DENIED"}).to_string()
        )
        .unwrap()
        .binding_digest
        .is_none());
    }

    fn existing_reference_fixture(cancel: bool) -> (Registration, Value) {
        let artifact = collab_bridge::limits::canonical_digest(&json!({}));
        let registration = Registration {
            id: Uuid::new_v4(),
            component_type_key: "fixture".into(),
            version: "1.0.0".into(),
            manifest: json!({"implements":[{"categoryKey":"knowledge","version":"1"}],"capabilityDeclarations":[{"cancel":if cancel {"SUPPORTED"} else {"UNSUPPORTED"}}]}),
            package: json!({}),
            binding_config_schema: json!({}),
            manifest_digest: artifact.clone(),
            package_digest: artifact.clone(),
            adapter_digest: artifact.clone(),
            contracts: vec![],
        };
        let key = Uuid::new_v4();
        let request = json!({"idempotencyKey":key});
        let native = json!({"idempotencyKey":key,"nativeType":"fixture_task",
            "cancelCapability":"UNSUPPORTED","platformStatus":"SUCCEEDED"});
        let mut steps = Vec::new();
        let mut push = |case: &str, operation: &str, expected: Value| {
            steps.push(json!({"caseKey":case,"stepKey":steps.len().to_string(),
                "operation":operation,"idempotencyKey":key,
                "requestJson":request.to_string(),"expectedResponseJson":expected.to_string(),
                "expectedHttpStatus":200}));
        };
        push(
            "protocol_handshake",
            "handshake",
            json!({"protocolVersion":"1","artifactDigest":artifact}),
        );
        push("protocol_binding", "validate_binding", json!({}));
        for operation in ["execute", "execute", "observe"] {
            push("protocol_execution_idempotency", operation, native.clone());
        }
        if cancel {
            for operation in ["execute", "cancel", "observe"] {
                let mut observation = native.clone();
                observation["cancelCapability"] = json!("SUPPORTED");
                observation["platformStatus"] = json!(if operation == "observe" {
                    "CANCELLED"
                } else {
                    "RUNNING"
                });
                push("protocol_cancel", operation, observation);
            }
        }
        for class in [
            "DENIED",
            "BLOCKED",
            "PRECONDITION",
            "LIMIT",
            "CONFLICT",
            "UNKNOWN",
        ] {
            push(
                "protocol_error_mapping",
                "map_native_status_error",
                json!({"class":class}),
            );
        }
        push(
            "protocol_redaction",
            "map_native_status_error",
            json!({"class":"UNKNOWN"}),
        );
        (
            registration,
            json!({"artifactDigest":artifact,"steps":steps}),
        )
    }

    #[test]
    fn existing_reference_protocol_requires_all_applicable_wire_cases() {
        let (registration, fixture) = existing_reference_fixture(false);
        validate_protocol_fixture(&registration, fixture.clone()).unwrap();
        for index in 0..fixture["steps"].as_array().unwrap().len() {
            let mut incomplete = fixture.clone();
            incomplete["steps"].as_array_mut().unwrap().remove(index);
            assert!(
                validate_protocol_fixture(&registration, incomplete).is_err(),
                "missing step {index}"
            );
        }
        let mut wrong_artifact = fixture.clone();
        wrong_artifact["artifactDigest"] = json!(collab_bridge::limits::canonical_digest(
            &json!({"different":true})
        ));
        assert!(validate_protocol_fixture(&registration, wrong_artifact).is_err());
        let mut creation = fixture.clone();
        let mut step = creation["steps"][0].clone();
        step["caseKey"] = json!("protocol_scope_idempotency");
        step["operation"] = json!("resolve_native_scope");
        creation["steps"].as_array_mut().unwrap().insert(2, step);
        assert!(validate_protocol_fixture(&registration, creation).is_err());
        let mut unexpected_cancel = fixture.clone();
        let (_, cancellable) = existing_reference_fixture(true);
        unexpected_cancel["steps"]
            .as_array_mut()
            .unwrap()
            .insert(5, cancellable["steps"][5].clone());
        assert!(validate_protocol_fixture(&registration, unexpected_cancel).is_err());
    }

    #[test]
    fn existing_reference_protocol_cancel_requires_declared_supported_evidence() {
        let (registration, fixture) = existing_reference_fixture(true);
        validate_protocol_fixture(&registration, fixture.clone()).unwrap();
        for index in 5..8 {
            let mut incomplete = fixture.clone();
            incomplete["steps"].as_array_mut().unwrap().remove(index);
            assert!(validate_protocol_fixture(&registration, incomplete).is_err());
        }
        let (_, uncancellable) = existing_reference_fixture(false);
        assert!(validate_protocol_fixture(&registration, uncancellable).is_err());
        let mut unsupported = fixture;
        let mut observation: Value = serde_json::from_str(
            unsupported["steps"][5]["expectedResponseJson"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        observation["cancelCapability"] = json!("UNSUPPORTED");
        unsupported["steps"][5]["expectedResponseJson"] = json!(observation.to_string());
        assert!(validate_protocol_fixture(&registration, unsupported).is_err());
    }

    #[test]
    fn example_protocol_retains_creation_fencing_and_cancellation_evidence() {
        let (mut registration, mut fixture) = existing_reference_fixture(true);
        registration.manifest["implements"] = json!([]);
        assert!(validate_protocol_fixture(&registration, fixture.clone()).is_err());
        let key = Uuid::new_v4();
        let reference = Uuid::new_v4();
        let create = json!({"idempotencyKey":key,"mode":"CREATE","platformResourceRef":reference});
        let lookup = json!({"idempotencyKey":key,"mode":"LOOKUP","platformResourceRef":reference});
        let cases = [
            ("protocol_scope_idempotency", create.clone(), "FOUND"),
            ("protocol_scope_idempotency", create.clone(), "FOUND"),
            ("protocol_scope_refused", create.clone(), "REFUSED"),
            ("protocol_scope_fenced", lookup, "ABSENT_FENCED"),
            ("protocol_scope_fenced", create, "REFUSED"),
        ];
        for (index, (case, request, result)) in cases.into_iter().enumerate() {
            fixture["steps"].as_array_mut().unwrap().insert(index + 2, json!({
                "caseKey":case,"stepKey":format!("scope-{index}"),"operation":"resolve_native_scope",
                "idempotencyKey":key,"requestJson":request.to_string(),
                "expectedResponseJson":json!({"result":result,"platformResourceRef":reference}).to_string(),
                "expectedHttpStatus":200
            }));
        }
        validate_protocol_fixture(&registration, fixture.clone()).unwrap();
        for index in 2..7 {
            let mut missing = fixture.clone();
            missing["steps"].as_array_mut().unwrap().remove(index);
            assert!(validate_protocol_fixture(&registration, missing).is_err());
        }
        for index in 10..13 {
            let mut missing = fixture.clone();
            missing["steps"].as_array_mut().unwrap().remove(index);
            assert!(validate_protocol_fixture(&registration, missing).is_err());
        }
    }

    #[test]
    fn admission_path_selects_exactly_one_source_identity() {
        let commit = "0123456789abcdef0123456789abcdef01234567";
        let builtin = json!({"admissionPath":"BUILTIN_REFERENCE","sourceProject":"kailo-plus/knowledge",
            "sourceCommit":commit,"dataStoreIsolation":"DEDICATED_INSTANCE"});
        source_identity(&builtin).unwrap();
        let external = json!({"admissionPath":"EXTERNAL","vendor":"Example","artifactVersion":"2.1",
            "dataStoreIsolation":"VENDOR_MANAGED"});
        source_identity(&external).unwrap();
        let mut with_upstream = external.clone();
        with_upstream["sourceCommit"] = json!(commit.to_uppercase());
        with_upstream["sourceProject"] = json!("example/upstream");
        source_identity(&with_upstream).unwrap();
        let without = |field: &str| {
            let mut value = builtin.clone();
            value.as_object_mut().unwrap().remove(field);
            value
        };
        let with = |field: &str, value: Value| {
            let mut changed = builtin.clone();
            changed[field] = value;
            changed
        };
        for invalid in [
            without("sourceCommit"),
            without("sourceProject"),
            with("sourceProject", json!(" ")),
            with("sourceCommit", json!(&commit[..39])),
            with("sourceCommit", json!(format!("{commit}0"))),
            with("sourceCommit", json!(commit.to_uppercase())),
            with("sourceCommit", json!(commit.replace('a', "g"))),
            with("sourceCommit", json!(40)),
            // Mixed identities: a reference build cannot also claim a vendor
            // artifact or vendor-managed storage.
            with("vendor", json!("Example")),
            with("artifactVersion", json!("2.1")),
            with("dataStoreIsolation", json!("VENDOR_MANAGED")),
        ] {
            assert!(source_identity(&invalid).is_err(), "{invalid}");
        }
        for invalid in [
            json!({"admissionPath":"EXTERNAL","artifactVersion":"2.1"}),
            json!({"admissionPath":"EXTERNAL","vendor":"Example"}),
            json!({"admissionPath":"EXTERNAL","vendor":"Example","artifactVersion":"2.1","sourceCommit":"abc"}),
        ] {
            assert!(source_identity(&invalid).is_err(), "{invalid}");
        }
        for path in [json!("PLATFORM"), json!(null), json!("builtin_reference")] {
            let mut unknown = builtin.clone();
            unknown["admissionPath"] = path;
            assert!(matches!(
                source_identity(&unknown),
                Err(Refusal::Blocked(_)) | Err(Refusal::Precondition(_))
            ));
        }
    }

    fn native_page_registration(change: impl Fn(&mut Value)) -> Result<Registration, Refusal> {
        let config = json!({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object",
            "additionalProperties":false,"required":["nativePageUrl"],
            "properties":{"nativePageUrl":{"type":"string","minLength":1}}});
        let mut manifest = json!({"id":"7d3c1e52-6a0b-5f5e-9c1d-2b7f4e8a9c10","componentTypeKey":"cells",
            "version":"1.0.0","class":"APPLICATION","platformPortKey":"NONE","manifestSchemaVersion":1,
            "admissionPath":"BUILTIN_REFERENCE","sourceProject":"kailo-plus/file-storage",
            "sourceCommit":"0123456789abcdef0123456789abcdef01234567","bindingConfigSchemaVersion":1,
            "bindingConfigSchemaDigest":collab_bridge::limits::canonical_digest(&config),
            "adapterProtocolRange":"NONE",
            "frontendDelivery":{"mode":"NATIVE_PAGE","extensionSlots":[],"editorOrigins":[],
                "nativePageOrigins":["http://192.168.0.193:58092"],"nativePageCategory":"file_storage"},
            "executionConnector":{"mode":"NONE","adapterProtocolRange":"NONE","actionTokenAudience":"NONE"},
            "adapterBuildRef":"8ddc3582521e7bb036ce2409163998739210deebdf719de86fd9e8203c0372cf",
            "implements":[],"capabilityDeclarations":[],"allowedModelCallModes":["NONE"],
            "dataStoreIsolation":"DEDICATED_INSTANCE","dataLocation":"dedicated native service",
            "secretSchema":[],"targetResourceTypeKeys":[],"resourceTypeDefinitions":[],
            "actionDefinitions":[],"toolDefinitions":[],
            "businessObservabilityContract":{"correlationSources":["OPERATION_ID"],
                "businessStateSources":["CORE_ACTION"],"aggregationDimensions":["tenant_id"],
                "redactionPolicy":"PLATFORM_METADATA_ONLY"},
            "frontendPresentationContract":{"integrationMode":"NONE","themeMapping":{},"localeMapping":{},
                "themeChangePolicy":"NONE","localeResolutionPolicy":"NONE"}});
        change(&mut manifest);
        let package = json!({"componentReleaseId":manifest["id"],
            "manifestDigest":collab_bridge::limits::canonical_digest(&manifest),
            "webArtifacts":[],"backendDelivery":"EXTERNAL_SERVICE"});
        registration(
            &json!({"manifestJson":manifest.to_string(),"packageJson":package.to_string(),
            "bindingConfigSchemaJson":config.to_string()}),
        )
    }

    #[test]
    fn native_page_release_needs_no_connector_or_capability() {
        // DD-127: implements=[], NATIVE_PAGE and connector NONE register with
        // the deployed service digest and no contract to test.
        let release = native_page_registration(|_| {}).unwrap();
        assert!(release.contracts.is_empty());
        assert!(crate::application_binding::native::native_page_only(
            &release.manifest
        ));
        let declared = |key: &'static str, value: Value| {
            move |manifest: &mut Value| manifest[key] = value.clone()
        };
        // DD-128: an entry may route its native model calls through the
        // platform; it can never self-report usage without an adapter.
        for modes in [
            json!(["NONE", "PLATFORM_LLM_ROUTE"]),
            json!(["PLATFORM_LLM_ROUTE"]),
        ] {
            assert!(native_page_registration(declared("allowedModelCallModes", modes)).is_ok());
        }
        for refused in [
            native_page_registration(declared(
                "implements",
                json!([{"categoryKey":"file_storage","contractVersion":2}]),
            )),
            native_page_registration(declared(
                "allowedModelCallModes",
                json!(["NONE", "SELF_MANAGED_MODEL"]),
            )),
            native_page_registration(declared("allowedModelCallModes", json!([]))),
            native_page_registration(declared(
                "allowedModelCallModes",
                json!(["PLATFORM_LLM_ROUTE", "PLATFORM_LLM_ROUTE"]),
            )),
            native_page_registration(declared(
                "secretSchema",
                json!([{"secretKey":"cells_bearer","valueType":"STRING","lengthOrFormat":"{}",
                    "rotationClass":"SERVICE_CREDENTIAL","deliveryMode":"FILE","restartRequired":false}]),
            )),
            native_page_registration(declared(
                "targetResourceTypeKeys",
                json!(["file_storage.space"]),
            )),
            native_page_registration(declared("adapterProtocolRange", json!("1"))),
            native_page_registration(declared(
                "frontendDelivery",
                json!({"mode":"NONE","extensionSlots":[],"editorOrigins":[]}),
            )),
            // DD-127(4): the entry must name one of the three presentation
            // categories.
            native_page_registration(declared(
                "frontendDelivery",
                json!({"mode":"NATIVE_PAGE","extensionSlots":[],"editorOrigins":[],
                    "nativePageOrigins":["http://192.168.0.193:58092"]}),
            )),
            native_page_registration(declared(
                "frontendDelivery",
                json!({"mode":"NATIVE_PAGE","extensionSlots":[],"editorOrigins":[],
                    "nativePageOrigins":["http://192.168.0.193:58092"],"nativePageCategory":"cells"}),
            )),
            native_page_registration(declared(
                "executionConnector",
                json!({"mode":"NONE","adapterProtocolRange":"NONE","actionTokenAudience":"kailo-adapter"}),
            )),
            native_page_registration(declared(
                "businessObservabilityContract",
                json!({"correlationSources":["OPERATION_ID"],"businessStateSources":["NATIVE_STATUS"],
                    "aggregationDimensions":[],"redactionPolicy":"PLATFORM_METADATA_ONLY"}),
            )),
        ] {
            assert!(refused.is_err());
        }
    }

    #[test]
    fn native_page_declares_kailo_embed_presentation_truthfully() {
        // DD-133: a native page entry that ships client-kit/embed declares
        // KAILO_EMBED with live theme, host-resolved locale and both mappings.
        let embed = json!({"integrationMode":"KAILO_EMBED",
            "themeMapping":{"LIGHT":"light","DARK":"dark"},
            "localeMapping":{"ZH_CN":"zh-CN","EN":"en-US"},
            "themeChangePolicy":"LIVE","localeResolutionPolicy":"BROWSER_RESOLVED"});
        let presenting = |contract: Value| {
            move |manifest: &mut Value| manifest["frontendPresentationContract"] = contract.clone()
        };
        assert!(native_page_registration(presenting(embed.clone())).is_ok());
        let changed = |key: &str, value: Value| {
            let mut contract = embed.clone();
            contract[key] = value;
            contract
        };
        for refused in [
            changed("themeChangePolicy", json!("NEXT_LAUNCH")),
            changed("localeResolutionPolicy", json!("NONE")),
            changed("themeMapping", json!({"LIGHT":"light"})),
            changed(
                "themeMapping",
                json!({"LIGHT":"light","DARK":"dark","SEPIA":"sepia"}),
            ),
            changed("themeMapping", json!({"LIGHT":"light","DARK":""})),
            changed("localeMapping", json!({"ZH_CN":"zh CN","EN":"en"})),
            changed("integrationMode", json!("HOST_API_REMOTE")),
            json!({"integrationMode":"NONE","themeMapping":{"LIGHT":"light","DARK":"dark"},
                "localeMapping":{},"themeChangePolicy":"NONE","localeResolutionPolicy":"NONE"}),
        ] {
            assert!(native_page_registration(presenting(refused)).is_err());
        }
        // KAILO_EMBED describes a NATIVE_PAGE only.
        let mut manifest = json!({"frontendDelivery":{"mode":"NONE"},
            "frontendPresentationContract":embed});
        assert!(validate_presentation(&manifest).is_err());
        manifest["frontendDelivery"]["mode"] = json!("NATIVE_PAGE");
        assert!(validate_presentation(&manifest).is_ok());
    }

    #[test]
    fn native_page_suite_is_empty_only_without_contracts() {
        let plan = json!({"actionExecutionId":"a","operationId":"o","workflowId":"w",
            "componentReleaseId":"r","artifactDigest":"d","contractDigests":[],"suiteDigest":"s",
            "planDigest":"p","steps":[]});
        let mut report = plan.clone();
        report["observations"] = json!([]);
        verify_report(&plan, &report).unwrap();
        let mut contracted = plan;
        contracted["contractDigests"] = json!(["c"]);
        let mut report = contracted.clone();
        report["observations"] = json!([]);
        assert!(verify_report(&contracted, &report).is_err());
    }

    #[test]
    fn source_bound_protocol_registration_keeps_closed_frontend_contract() {
        let valid = json!({"frontendDelivery":{"mode":"SOURCE_BOUND_PROTOCOL","extensionSlots":[],
            "editorOrigins":["https://*.office.example.test"],"launchDescriptorSchemaVersion":"1",
            "nativePageOrigins":["http://192.168.0.193:8080"]}});
        validate_frontend_delivery(&valid).unwrap();
        for changed in [
            json!({"mode":"SOURCE_BOUND_PROTOCOL","extensionSlots":[],"editorOrigins":[] ,"launchDescriptorSchemaVersion":"1"}),
            json!({"mode":"SOURCE_BOUND_PROTOCOL","extensionSlots":[],"editorOrigins":["https://editor.example.test/path"],"launchDescriptorSchemaVersion":"1"}),
            json!({"mode":"SOURCE_BOUND_PROTOCOL","extensionSlots":[],"editorOrigins":["https://editor.example.test"],"launchDescriptorSchemaVersion":"2"}),
            json!({"mode":"SOURCE_BOUND_PROTOCOL","extensionSlots":["undeclared"],"editorOrigins":["https://editor.example.test"],"launchDescriptorSchemaVersion":"1"}),
            json!({"mode":"SOURCE_BOUND_PROTOCOL","extensionSlots":[],"editorOrigins":["https://editor.example.test"],"launchDescriptorSchemaVersion":"1","nativePageOrigins":["*"]}),
            json!({"mode":"NONE","extensionSlots":[],"editorOrigins":[],"launchDescriptorSchemaVersion":"1"}),
        ] {
            assert!(validate_frontend_delivery(&json!({"frontendDelivery":changed})).is_err());
        }
        validate_frontend_delivery(
            &json!({"frontendDelivery":{"mode":"NONE","extensionSlots":[],"editorOrigins":[]}}),
        )
        .unwrap();
        // DD-127(4): a presentation category appears only with NATIVE_PAGE.
        let mut labelled = valid;
        labelled["frontendDelivery"]["nativePageCategory"] = json!("file_storage");
        assert!(validate_frontend_delivery(&labelled).is_err());
    }

    #[test]
    fn native_mcp_report_requires_real_protocol_result_not_adapter_status() {
        let expected = json!({"rows":[1]});
        let request = json!({"name":"declared-read","arguments":{"query":"fixture"}});
        let plan = json!({"connectorKind":"PROTOCOL_PEER","steps":[{
            "caseKey":"read","stepKey":"query","operation":"mcp_call",
            "requestJson":collab_bridge::limits::canonical_json(&request),
            "expectedResponseJson":collab_bridge::limits::canonical_json(&expected),
            "expectedHttpStatus":0,"expectedMcpResultKind":"RESULT"}]});
        let observation = json!({"caseKey":"read","stepKey":"query","operation":"mcp_call",
            "requestDigest":collab_bridge::limits::canonical_digest(&request),
            "responseDigest":collab_bridge::limits::canonical_digest(&json!({"structuredContent":expected})),
            "resultDigest":collab_bridge::limits::canonical_digest(&expected),"httpStatus":0,"mcpResultKind":"RESULT"});
        let report = json!({"observations":[observation]});
        verify_report(&plan, &report).unwrap();
        for (field, value) in [
            ("httpStatus", json!(200)),
            ("mcpResultKind", json!("ERROR")),
            ("nativeObservation", json!({"platformStatus":"SUCCEEDED"})),
            ("resultDigest", json!("0".repeat(64))),
            ("operation", json!("reconcile")),
        ] {
            let mut changed = report.clone();
            changed["observations"][0][field] = value;
            assert!(verify_report(&plan, &changed).is_err(), "{field}");
        }
    }

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
        let mut citations = response.clone();
        let reference = json!({"resourceId":Uuid::new_v4(), "nativeObjectRef":"native-source",
            "nativeRevision":"source-revision", "displayName":"source", "mediaType":"text/plain"});
        citations["contentReferences"] = json!([reference]);
        citations["resultJson"] =
            json!(json!({"citations":citations["contentReferences"]}).to_string());
        assert!(wire_digests(&request, "execute", 200, &citations.to_string()).is_ok());
        let mut missing = citations.clone();
        missing.as_object_mut().unwrap().remove("contentReferences");
        assert!(wire_digests(&request, "execute", 200, &missing.to_string()).is_err());
        citations["contentReferences"][0]["nativeRevision"] = json!("different-source-revision");
        assert!(wire_digests(&request, "execute", 200, &citations.to_string()).is_err());
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
    fn binding_report_requires_core_comparison_and_keeps_raw_digest() {
        let (mut plan, mut report) = evidence();
        let expected = json!({"nativeInstanceRef":"isolated-instance"});
        plan["steps"][0]["caseKey"] = json!("protocol_binding");
        plan["steps"][0]["operation"] = json!("validate_binding");
        plan["steps"][0]["expectedResponseJson"] = json!(expected.to_string());
        report["observations"][0]["caseKey"] = json!("protocol_binding");
        report["observations"][0]["operation"] = json!("validate_binding");
        report["observations"][0]
            .as_object_mut()
            .unwrap()
            .remove("nativeObservation");
        report["observations"][0]["bindingDigest"] =
            json!(collab_bridge::limits::canonical_digest(&expected));
        assert!(verify_report(&plan, &report).is_ok());
        let mut missing = report.clone();
        missing["observations"][0]
            .as_object_mut()
            .unwrap()
            .remove("bindingDigest");
        missing["observations"][0]["responseDigest"] =
            json!(collab_bridge::limits::canonical_digest(&expected));
        assert!(verify_report(&plan, &missing).is_err());
        let mut misplaced = report.clone();
        misplaced["observations"][1]["bindingDigest"] =
            report["observations"][0]["bindingDigest"].clone();
        assert!(verify_report(&plan, &misplaced).is_err());
        report["observations"][0]["bindingDigest"] = json!("0".repeat(64));
        assert!(verify_report(&plan, &report).is_err());
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
        let mut frozen: Value =
            serde_json::from_str(plan["steps"][1]["requestJson"].as_str().unwrap()).unwrap();
        frozen["arguments"] = json!({"target":{"resourceId":resource},"input":{}});
        plan["steps"][1]["requestJson"] = json!(frozen.to_string());
        let reference = json!({"resourceId":resource,"nativeObjectRef":"native-created-object",
            "nativeRevision":"immutable-revision","displayName":"fixture","mediaType":"text/plain"});
        let mut probe = json!({"plan":plan,"stepIndex":1,"contentReference":reference});
        probe["plan"]["runId"] = json!(Uuid::new_v4());
        let (_, operation, request, _) = probe_request(&plan, &probe).unwrap();
        assert_eq!(operation, "execute");
        assert_eq!(request["arguments"]["input"], reference);
        assert!(request.get("contentReference").is_none());
        assert!(request.get("inputJson").is_none());
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
        let (_, operation, request, _) = probe_request(&plan, &probe).unwrap();
        assert_eq!(operation, "reconcile");
        assert_eq!(
            request,
            json!({"idempotencyKey":plan["steps"][1]["idempotencyKey"]})
        );
    }

    #[test]
    fn capability_vectors_freeze_the_production_execute_envelope() {
        let resource = Uuid::new_v4();
        let request = json!({"idempotencyKey":Uuid::new_v4(),"contractKey":"knowledge.read@v1",
            "referenceResourceId":resource,"inputJson":"{}"});
        let context =
            json!({"actionKey":"knowledge.read@v1","targetType":"RESOURCE","targetId":resource});
        let actual = production_probe_execute(&request, &context).unwrap();
        assert_eq!(
            actual,
            json!({"idempotencyKey":request["idempotencyKey"],"actionKey":"knowledge.read@v1",
            "arguments":{"target":{"resourceId":resource},"input":{}}})
        );
        assert_eq!(
            crate::application_tool::target(&actual["arguments"]).unwrap(),
            ("RESOURCE", resource)
        );
        let mut changed = context.clone();
        changed["actionKey"] = json!("knowledge.delete@v1");
        assert!(production_probe_execute(&request, &changed).is_err());
        changed = context.clone();
        changed["targetType"] = json!("TENANT");
        assert!(production_probe_execute(&request, &changed).is_err());
    }

    #[test]
    fn materialized_reference_is_validated_against_the_exact_registered_input_schema() {
        let schema: Value = serde_json::from_str(include_str!(
            "../../../../contracts/domain/content_reference.schema.json"
        ))
        .unwrap();
        let digest = collab_bridge::limits::canonical_digest(&schema);
        let contracts = vec![json!({"content":{"operationContracts":[{
            "contractKey":"knowledge.read@v1","inputSchemaDigest":digest
        }]},"schemas":{(digest):schema}})];
        let reference = json!({"resourceId":Uuid::new_v4(),"nativeObjectRef":"native-observed-document",
            "nativeRevision":"native-observed-revision","displayName":"document","mediaType":"text/plain"});
        let mut request = json!({"actionKey":"knowledge.read@v1","arguments":{"input":{}}});
        assert!(validate_probe_input(&contracts, "execute", &request).is_err());
        apply_probe_reference(&mut request, &reference).unwrap();
        assert!(validate_probe_input(&contracts, "execute", &request).is_ok());
        let mut incomplete = reference.clone();
        incomplete.as_object_mut().unwrap().remove("nativeRevision");
        request["arguments"]["input"] = incomplete;
        assert!(validate_probe_input(&contracts, "execute", &request).is_err());
        request["arguments"]["input"] = reference.clone();
        request["actionKey"] = json!("knowledge.export@v1");
        assert!(validate_probe_input(&contracts, "execute", &request).is_err());
        assert!(
            apply_probe_reference(&mut request, &reference).is_err(),
            "never discard explicit frozen input"
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
            let mut request = json!({"idempotencyKey":step["idempotencyKey"],"actionKey":"records.read@v1",
                "arguments":{"target":{"assetId":reference["assetId"]},"input":{}}});
            step["requestJson"] = json!(request.to_string());
            if index == 1 {
                step["referenceFromStepKey"] = json!("step_0");
                apply_probe_reference(&mut request, &reference).unwrap();
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

    fn terminal(key: Uuid) -> Value {
        json!({"idempotencyKey":key,"nativeType":"version","platformStatus":"SUCCEEDED",
            "cancelCapability":"UNSUPPORTED","nativeStatus":"Finished",
            "lastObservedAt":"2026-10-18T00:00:00Z","terminalAt":"2026-10-18T00:00:00Z"})
    }

    /// A V2 write captures its published revision from the typed slot; the
    /// later read and its permission-denied replay send that value (V-SCN-118).
    fn captured_suite() -> (Value, Value, Value) {
        let hash = collab_bridge::limits::canonical_digest;
        let resource = Uuid::new_v4();
        let case = "file_storage:2:native_file";
        let reference = json!({"resourceId":resource,"nativeObjectRef":"native-node",
            "nativeRevision":"published","displayName":"conformance.txt",
            "mediaType":"text/plain"});
        let captures = json!([{"key":"published_revision","value":"published"}]);
        let binding = json!({"source":"CAPTURE","key":"published_revision","side":"INPUT",
            "pointer":"/nativeRevision"});
        let write_key = Uuid::new_v4();
        let read_key = Uuid::new_v4();
        let write = json!({"idempotencyKey":write_key,"actionKey":"file_storage.write@v2",
            "arguments":{"target":{"resourceId":resource},"input":{"resourceId":resource}}});
        let frozen = json!({"idempotencyKey":read_key,"actionKey":"file_storage.read@v2",
            "arguments":{"target":{"resourceId":resource},"input":{"resourceId":resource,
                "nativeRevision":"{{CAPTURE:published_revision}}"}}});
        let mut sent = frozen.clone();
        sent["arguments"]["input"]["nativeRevision"] = json!("published");
        let output = json!({"text":"marker"});
        let denied = json!({"class":"DENIED","reason":"PERMISSION_DENIED"});
        let steps = json!([
            {"caseKey":case,"stepKey":"write","operation":"execute",
                "contractKey":"file_storage.write@v2","idempotencyKey":write_key,
                "requestJson":write.to_string(),"expectedResponseJson":"{}",
                "expectedHttpStatus":200,"referenceResourceId":resource,
                "captures":[{"key":"published_revision",
                    "slot":"CONTENT_REFERENCE_NATIVE_REVISION"}]},
            {"caseKey":case,"stepKey":"read","operation":"execute",
                "contractKey":"file_storage.read@v2","idempotencyKey":read_key,
                "requestJson":frozen.to_string(),"expectedResponseJson":output.to_string(),
                "expectedHttpStatus":200,"referenceResourceId":resource,"bindings":[binding]},
            {"caseKey":case,"stepKey":"permission-denied:read","operation":"execute",
                "idempotencyKey":read_key,"requestJson":frozen.to_string(),
                "expectedResponseJson":denied.to_string(),"expectedHttpStatus":403,
                "referenceResourceId":resource,"bindings":[binding]}
        ]);
        let observations = json!([
            {"caseKey":case,"stepKey":"write","operation":"execute",
                "requestDigest":hash(&write),"responseDigest":"a".repeat(64),"httpStatus":200,
                "contentReference":reference,"captures":captures,
                "resultDigest":hash(&json!({})),"nativeObservation":terminal(write_key)},
            {"caseKey":case,"stepKey":"read","operation":"execute",
                "requestDigest":hash(&sent),"responseDigest":"a".repeat(64),"httpStatus":200,
                "contentReference":reference,"resultDigest":hash(&output),
                "nativeObservation":terminal(read_key)},
            {"caseKey":case,"stepKey":"permission-denied:read","operation":"execute",
                "requestDigest":hash(&sent),"responseDigest":hash(&denied),"httpStatus":403}
        ]);
        let plan = json!({"actionExecutionId":Uuid::new_v4(),"operationId":Uuid::new_v4(),
            "componentReleaseId":Uuid::new_v4(),"workflowId":"isolated-component-workflow",
            "artifactDigest":"b".repeat(64),"contractDigests":["c".repeat(64)],
            "suiteDigest":"d".repeat(64),"planDigest":"e".repeat(64),"runId":"","steps":steps});
        let mut report = plan.clone();
        report.as_object_mut().unwrap().remove("steps");
        report["runId"] = json!(Uuid::new_v4());
        report["observations"] = observations;
        (plan, report, captures)
    }

    #[test]
    fn captured_revision_is_substituted_before_signing_and_rechecked_on_record() {
        let (plan, report, captures) = captured_suite();
        verify_report(&plan, &report).unwrap();
        // Core signs the substituted request; the denied replay sends the same.
        let mut probe = json!({"plan":plan,"stepIndex":1,"captures":captures});
        probe["plan"]["runId"] = json!(Uuid::new_v4());
        let (_, _, read, expected) = probe_request(&plan, &probe).unwrap();
        assert_eq!(read["arguments"]["input"]["nativeRevision"], "published");
        assert_eq!(expected, json!({"text":"marker"}));
        probe["stepIndex"] = json!(2);
        let (_, _, replay, _) = probe_request(&plan, &probe).unwrap();
        assert_eq!(replay, read);
        let mut missing = probe.clone();
        missing.as_object_mut().unwrap().remove("captures");
        assert!(probe_request(&plan, &missing).is_err());
        let mut unexpected = probe.clone();
        unexpected["stepIndex"] = json!(0);
        assert!(probe_request(&plan, &unexpected).is_err());
        // The recorded capture must equal the typed slot, exist exactly where
        // declared, and be the value the later requests actually carried.
        let mut drifted = report.clone();
        drifted["observations"][0]["captures"][0]["value"] = json!("head");
        assert!(verify_report(&plan, &drifted).is_err());
        let mut absent = report.clone();
        absent["observations"][0]
            .as_object_mut()
            .unwrap()
            .remove("captures");
        assert!(verify_report(&plan, &absent).is_err());
        let mut stray = report.clone();
        stray["observations"][1]["captures"] = captures.clone();
        assert!(verify_report(&plan, &stray).is_err());
        let mut head = report.clone();
        head["observations"][0]["captures"][0]["value"] = json!("head");
        head["observations"][0]["contentReference"]["nativeRevision"] = json!("head");
        assert!(verify_report(&plan, &head).is_err());
        let original: Value =
            serde_json::from_str(plan["steps"][1]["requestJson"].as_str().unwrap()).unwrap();
        let mut unsubstituted = report.clone();
        unsubstituted["observations"][1]["requestDigest"] =
            json!(collab_bridge::limits::canonical_digest(&original));
        assert!(verify_report(&plan, &unsubstituted).is_err());
    }

    /// A completed DD-124(4) receiver step: a native batch (`batched`) whose
    /// receiver admission binds its own batch and SOURCE read execution, or an
    /// isolated APPLICATION ingest that anchors its read and captures the
    /// receiver's own document reference.
    fn receiver_suite(batched: bool) -> (Value, Value) {
        let hash = collab_bridge::limits::canonical_digest;
        let (binding, source_binding, operation) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let (receiver_resource, source_resource) = (Uuid::new_v4(), Uuid::new_v4());
        let (execution, child, key) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let (batch, import, step_key) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let mut request = json!({"bindingId":binding,"generation":3,"idempotencyKey":step_key,
            "expiresAt":"2999-01-01T00:00:00Z"});
        let receipt = json!({"bindingId":source_binding,"operationId":operation,
            "idempotencyKey":key,"role":"SOURCE","nativeObjectRef":"source-node",
            "nativeRevision":"source-version",
            "contentSha256":"a".repeat(64),"contentBytes":34,"completedAt":"2026-10-18T00:00:01Z",
            "measurements":[]});
        let mut receiver = receipt.clone();
        receiver["bindingId"] = json!(binding);
        receiver["role"] = json!("RECEIVER");
        receiver["nativeObjectRef"] = json!("knowledge-document");
        receiver["nativeRevision"] = json!("2026-10-18T00:00:01.000001Z");
        let reference = json!({"resourceId":source_resource,"nativeObjectRef":"source-node",
            "nativeRevision":"source-version","displayName":"conformance.md",
            "mediaType":"text/markdown"});
        let mut read = json!({"actionExecutionId":execution,"receiverActionExecutionId":child,
            "receiverGeneration":3,"operationId":operation,"sourceBindingId":source_binding,
            "sourceResourceId":source_resource,"sourceReceipt":receipt,"receiverReceipt":receiver,
            "readRequest":{"receiverBindingId":binding,"sourceResourceId":source_resource,
                "actionKey":"file_storage.read@v2","actionVersion":1,"idempotencyKey":key,
                "inputJson":reference.to_string()}});
        let (contract, input, bindings, captures) = if batched {
            request["importConfigRef"] = json!(import);
            let native = json!({"receiverResourceId":receiver_resource,"importConfigRef":import,
                "batchId":batch,"actionKey":"knowledge.sync_apply@v3","actionVersion":1});
            read["nativeBatch"] = native.clone();
            read["readRequest"]["nativeBatch"] = native;
            let input = json!({"sourceResourceId":source_resource,"importConfigRef":import,
                "batchId":"{{CAPTURE:batch}}",
                "sourceReadActionExecutionId":"{{CAPTURE:read_execution}}"});
            let bindings = json!([
                {"source":"CAPTURE","key":"batch","side":"INPUT","pointer":"/batchId"},
                {"source":"CAPTURE","key":"read_execution","side":"INPUT",
                    "pointer":"/sourceReadActionExecutionId"}]);
            let captures = json!([{"key":"batch","slot":"GENERATED_REF","pointer":"/batchId"},
                {"key":"read_execution","slot":"ACTION_EXECUTION_ID"}]);
            ("knowledge.sync_apply@v3", input, bindings, captures)
        } else {
            let arguments = json!({"target":{"resourceId":receiver_resource},"input":reference});
            read["readRequest"]["receiverActionExecutionId"] = json!(child);
            read["readRequest"]["receiverArgumentsJson"] =
                json!(collab_bridge::limits::canonical_json(&arguments));
            let captures = json!([
                {"key":"document","slot":"CONTENT_REFERENCE_NATIVE_OBJECT_REF"},
                {"key":"document_revision","slot":"CONTENT_REFERENCE_NATIVE_REVISION"}]);
            ("knowledge.ingest@v3", reference, json!([]), captures)
        };
        let native = json!({"request":request,"nativeBatchId":batch,"nativeStatus":"success",
            "startedAt":"2026-10-18T00:00:00Z","finishedAt":"2026-10-18T00:00:02Z",
            "completed":true,"readOperations":[read]});
        let case = "knowledge:3:receiver";
        let mut step = json!({"caseKey":case,"stepKey":"receive","operation":"receiver_start",
            "contractKey":contract,"idempotencyKey":step_key,
            "requestJson":collab_bridge::limits::canonical_json(&request),
            "expectedResponseJson":"{}","expectedHttpStatus":200,
            "referenceResourceId":receiver_resource,"nativeReceiverInputJson":input.to_string(),
            "captures":captures});
        if batched {
            step["bindings"] = bindings;
        }
        let values = if batched {
            json!([{"key":"batch","value":batch},{"key":"read_execution","value":execution}])
        } else {
            json!([{"key":"document","value":"knowledge-document"},
                {"key":"document_revision","value":"2026-10-18T00:00:01.000001Z"}])
        };
        let observation = json!({"caseKey":case,"stepKey":"receive","operation":"receiver_start",
            "requestDigest":hash(&request),"responseDigest":hash(&native),"httpStatus":200,
            "nativeReceiverObservation":native,"captures":values});
        let plan = json!({"actionExecutionId":Uuid::new_v4(),"operationId":Uuid::new_v4(),
            "componentReleaseId":Uuid::new_v4(),"workflowId":"isolated-component-workflow",
            "artifactDigest":"b".repeat(64),"contractDigests":["c".repeat(64)],
            "suiteDigest":"d".repeat(64),"planDigest":"e".repeat(64),"runId":"","steps":[step]});
        let mut report = plan.clone();
        report.as_object_mut().unwrap().remove("steps");
        report["runId"] = json!(Uuid::new_v4());
        report["observations"] = json!([observation]);
        (plan, report)
    }

    #[test]
    fn receiver_step_accepts_only_its_own_isolated_admission_and_identifiers() {
        for batched in [true, false] {
            let (plan, report) = receiver_suite(batched);
            verify_report(&plan, &report).unwrap();
            let native = &report["observations"][0]["nativeReceiverObservation"];
            // Core derives the same values from the actual wire response.
            let step = &plan["steps"][0];
            let request: Value =
                serde_json::from_str(step["requestJson"].as_str().unwrap()).unwrap();
            let digests =
                super::wire_digests(step, &request, "receiver_start", 200, &native.to_string())
                    .unwrap();
            assert_eq!(
                serde_json::to_value(digests).unwrap()["captures"],
                report["observations"][0]["captures"]
            );
            let mut drifted = report.clone();
            drifted["observations"][0]["captures"][1]["value"] = json!(Uuid::new_v4());
            assert!(verify_report(&plan, &drifted).is_err(), "{batched}");
            let mut absent = report.clone();
            absent["observations"][0]
                .as_object_mut()
                .unwrap()
                .remove("captures");
            assert!(verify_report(&plan, &absent).is_err(), "{batched}");
            // The admission consumed exactly the frozen input.
            let mut other = plan.clone();
            let mut input: Value =
                serde_json::from_str(step["nativeReceiverInputJson"].as_str().unwrap()).unwrap();
            let field = if batched {
                "sourceResourceId"
            } else {
                "nativeRevision"
            };
            input[field] = json!("another-source");
            other["steps"][0]["nativeReceiverInputJson"] = json!(input.to_string());
            assert!(verify_report(&other, &report).is_err(), "{batched}");
            // An identifier the plan or fixture could have supplied is not
            // evidence the isolated Core generated it in this run.
            let mut predicted = plan.clone();
            let mut claimed = report.clone();
            let execution = native["readOperations"][0]["actionExecutionId"].clone();
            predicted["workflowId"] = execution.clone();
            claimed["workflowId"] = execution;
            assert!(verify_report(&predicted, &claimed).is_err(), "{batched}");
            let mut unfinished = report.clone();
            unfinished["observations"][0]["nativeReceiverObservation"]["completed"] = json!(false);
            assert!(verify_report(&plan, &unfinished).is_err(), "{batched}");
        }
    }

    /// DD-124(3)(4): every step of a RECEIVER case is observed from the
    /// isolated deployment; a step that reads no source completes without
    /// reads and captures nothing, but the case as a whole must carry reads.
    #[test]
    fn receiver_case_carries_its_reads_across_steps() {
        let hash = collab_bridge::limits::canonical_digest;
        let (mut plan, mut report) = receiver_suite(false);
        let ingest = plan["steps"][0].clone();
        let key = Uuid::new_v4();
        let mut request: Value =
            serde_json::from_str(ingest["requestJson"].as_str().unwrap()).unwrap();
        request["idempotencyKey"] = json!(key);
        let input = json!({"resourceId":ingest["referenceResourceId"],
            "nativeObjectRef":"{{CAPTURE:document}}",
            "nativeRevision":"{{CAPTURE:document_revision}}",
            "displayName":"conformance.md","mediaType":"text/markdown"});
        let delete = json!({"caseKey":ingest["caseKey"],"stepKey":"delete",
            "operation":"receiver_start","contractKey":"knowledge.delete@v3",
            "idempotencyKey":key,"requestJson":collab_bridge::limits::canonical_json(&request),
            "expectedResponseJson":"{}","expectedHttpStatus":200,
            "referenceResourceId":ingest["referenceResourceId"],
            "nativeReceiverInputJson":input.to_string(),"bindings":[
                {"source":"CAPTURE","key":"document","side":"INPUT","pointer":"/nativeObjectRef"},
                {"source":"CAPTURE","key":"document_revision","side":"INPUT",
                    "pointer":"/nativeRevision"}]});
        let native = json!({"request":request,"nativeBatchId":Uuid::new_v4(),
            "nativeStatus":"completed","startedAt":"2026-10-18T00:00:03Z",
            "finishedAt":"2026-10-18T00:00:04Z","completed":true,"readOperations":[]});
        let observation = json!({"caseKey":ingest["caseKey"],"stepKey":"delete",
            "operation":"receiver_start","requestDigest":hash(&request),
            "responseDigest":hash(&native),"httpStatus":200,"nativeReceiverObservation":native});
        plan["steps"].as_array_mut().unwrap().push(delete);
        report["observations"]
            .as_array_mut()
            .unwrap()
            .push(observation);
        verify_report(&plan, &report).unwrap();
        // A readless step has no admission evidence to capture from.
        let mut capturing = plan.clone();
        capturing["steps"][1]["captures"] =
            json!([{"key":"gone","slot":"CONTENT_REFERENCE_NATIVE_OBJECT_REF"}]);
        assert!(verify_report(&capturing, &report).is_err());
        // Without the ingest the case carries no read at all.
        let mut readless = plan.clone();
        readless["steps"].as_array_mut().unwrap().remove(0);
        let mut unread = report.clone();
        unread["observations"].as_array_mut().unwrap().remove(0);
        assert!(verify_report(&readless, &unread).is_err());
        // A native batch still completes only with its own reads.
        let (_, batched) = receiver_suite(true);
        let mut empty = batched["observations"][0]["nativeReceiverObservation"].clone();
        empty["readOperations"] = json!([]);
        assert!(validate_receiver_observation(&empty["request"].clone(), &empty).is_err());
    }

    #[test]
    fn application_receiver_reads_share_one_isolated_anchor() {
        let (plan, report) = receiver_suite(false);
        let native = &report["observations"][0]["nativeReceiverObservation"];
        let request = &native["request"];
        assert!(validate_receiver_observation(request, native).is_ok());
        let mut batched = native.clone();
        batched["readOperations"][0]["nativeBatch"] = json!({"batchId":native["nativeBatchId"]});
        assert!(validate_receiver_observation(request, &batched).is_err());
        let mut unanchored = native.clone();
        unanchored["readOperations"][0]["readRequest"]
            .as_object_mut()
            .unwrap()
            .remove("receiverActionExecutionId");
        assert!(validate_receiver_observation(request, &unanchored).is_err());
        let mut second = native.clone();
        let mut read = native["readOperations"][0].clone();
        read["actionExecutionId"] = json!(Uuid::new_v4());
        read["operationId"] = json!(Uuid::new_v4());
        read["sourceReceipt"]["operationId"] = read["operationId"].clone();
        read["receiverReceipt"]["operationId"] = read["operationId"].clone();
        let key = Uuid::new_v4();
        read["readRequest"]["idempotencyKey"] = json!(key);
        read["sourceReceipt"]["idempotencyKey"] = json!(key);
        read["receiverReceipt"]["idempotencyKey"] = json!(key);
        second["readOperations"]
            .as_array_mut()
            .unwrap()
            .push(read.clone());
        assert!(validate_receiver_observation(request, &second).is_ok());
        let mut foreign = second.clone();
        foreign["readOperations"][1]["receiverActionExecutionId"] = json!(Uuid::new_v4());
        foreign["readOperations"][1]["readRequest"]["receiverActionExecutionId"] =
            foreign["readOperations"][1]["receiverActionExecutionId"].clone();
        assert!(validate_receiver_observation(request, &foreign).is_err());
        let mut own = native.clone();
        own["readOperations"][0]["receiverActionExecutionId"] =
            native["readOperations"][0]["actionExecutionId"].clone();
        own["readOperations"][0]["readRequest"]["receiverActionExecutionId"] =
            native["readOperations"][0]["actionExecutionId"].clone();
        assert!(validate_receiver_observation(request, &own).is_err());
        // The anchored arguments name the receiver Resource of the step.
        let mut retargeted = report.clone();
        let encoded = native["readOperations"][0]["readRequest"]["receiverArgumentsJson"]
            .as_str()
            .unwrap();
        let mut arguments: Value = serde_json::from_str(encoded).unwrap();
        arguments["target"]["resourceId"] = json!(Uuid::new_v4());
        let observed = &mut retargeted["observations"][0]["nativeReceiverObservation"];
        observed["readOperations"][0]["readRequest"]["receiverArgumentsJson"] =
            json!(arguments.to_string());
        assert!(verify_report(&plan, &retargeted).is_err());
        // A receiver request is never substituted by a probe.
        let mut probe = json!({"plan":plan,"stepIndex":0,
            "captures":[{"key":"document","value":"knowledge-document"}]});
        probe["plan"]["runId"] = json!(Uuid::new_v4());
        assert!(probe_request(&plan, &probe).is_err());
        probe.as_object_mut().unwrap().remove("captures");
        let (_, operation, request, expected) = probe_request(&plan, &probe).unwrap();
        assert_eq!(operation, "receiver_start");
        assert_eq!(request, native["request"]);
        assert_eq!(expected, json!({}));
    }

    #[test]
    fn wire_capture_reads_only_the_declared_slot_of_a_native_terminal() {
        let (plan, _, captures) = captured_suite();
        let step = &plan["steps"][0];
        let request: Value = serde_json::from_str(step["requestJson"].as_str().unwrap()).unwrap();
        let key = Uuid::parse_str(step["idempotencyKey"].as_str().unwrap()).unwrap();
        let mut response = json!({"execution":terminal(key),"resultJson":"{}",
            "contentReference":{"resourceId":step["referenceResourceId"],
                "nativeObjectRef":"native-node","nativeRevision":"published",
                "displayName":"conformance.txt","mediaType":"text/plain"}});
        let raw = response.to_string();
        let digests = super::wire_digests(step, &request, "execute", 200, &raw).unwrap();
        let digests = serde_json::to_value(digests).unwrap();
        assert_eq!(digests["captures"], captures);
        // DD-124(5): a terminal without its native status is not evidence.
        response["execution"]
            .as_object_mut()
            .unwrap()
            .remove("nativeStatus");
        let raw = response.to_string();
        let digests = super::wire_digests(step, &request, "execute", 200, &raw).unwrap();
        assert!(serde_json::to_value(digests)
            .unwrap()
            .get("captures")
            .is_none());
    }
}
