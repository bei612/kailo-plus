//! Platform-owned 07 §8A deployment fixture, compiled only into the original
//! Core integration-test binary. It does not add a production CLI, HTTP route,
//! alternate Core implementation, registration authority or suite result.
use super::*;
use crate::spicedb::{Consistency, Relationship, SpiceDb, Subject, Write};
use std::{collections::BTreeSet, os::unix::fs::PermissionsExt, path::Path, time::Duration};

type Error = Box<dyn std::error::Error + Send + Sync>;

fn required<'a>(value: &'a Value, key: &str) -> Result<&'a str, Error> {
    value[key]
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.trim() == *s)
        .ok_or_else(|| format!("missing or invalid fixture field: {key}").into())
}

fn id(value: &Value, key: &str) -> Result<Uuid, Error> {
    let id = Uuid::parse_str(required(value, key)?)?;
    if id.is_nil() {
        return Err("nil fixture identity".into());
    }
    Ok(id)
}

fn exact(value: &Value, keys: &[&str]) -> Result<(), Error> {
    let object = value.as_object().ok_or("fixture object required")?;
    if object.len() != keys.len() || keys.iter().any(|key| !object.contains_key(*key)) {
        return Err("fixture contains missing or unknown fields".into());
    }
    Ok(())
}

fn hex_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn prepare(mut input: Value) -> Result<Value, Error> {
    exact(
        &input,
        &[
            "mode",
            "environmentId",
            "databaseName",
            "databaseOwner",
            "productionDatabaseName",
            "spiceDbOrigin",
            "productionSpiceDbOrigin",
            "httpTimeoutSeconds",
            "relationshipPageSize",
            "tenantId",
            "humanIdentityId",
            "humanPrincipalId",
            "approverHumanIdentityId",
            "approverPrincipalId",
            "catalogTenantId",
            "catalogHumanIdentityId",
            "catalogPrincipalId",
            "coreOrigin",
            "productionCoreOrigin",
            "humanTokenFile",
            "catalogTokenFile",
            "approverTokenFile",
            "actionWaitSeconds",
            "actionPollIntervalMillis",
            "readGrantIdempotencyKey",
            "endpoints",
        ],
    )?;
    if input["mode"] != "CONFORMANCE_ONLY"
        || required(&input, "databaseName")? == required(&input, "productionDatabaseName")?
    {
        return Err("isolated fixture boundary refused".into());
    }
    required(&input, "databaseOwner")?;
    let origin = reqwest::Url::parse(required(&input, "spiceDbOrigin")?)?;
    let production = reqwest::Url::parse(required(&input, "productionSpiceDbOrigin")?)?;
    if !matches!(origin.scheme(), "http" | "https")
        || origin.host_str().is_none()
        || !origin.username().is_empty()
        || origin.password().is_some()
        || origin.query().is_some()
        || origin.fragment().is_some()
        || origin.path() != "/"
        || origin.origin() == production.origin()
    {
        return Err("dedicated SpiceDB origin required".into());
    }
    let core = reqwest::Url::parse(required(&input, "coreOrigin")?)?;
    let production_core = reqwest::Url::parse(required(&input, "productionCoreOrigin")?)?;
    if !matches!(core.scheme(), "http" | "https")
        || core.host_str().is_none()
        || !core.username().is_empty()
        || core.password().is_some()
        || core.query().is_some()
        || core.fragment().is_some()
        || core.path() != "/"
        || core.origin() == production_core.origin()
    {
        return Err("dedicated authenticated Core gateway origin required".into());
    }
    for field in ["humanTokenFile", "catalogTokenFile", "approverTokenFile"] {
        required(&input, field)?;
    }
    for field in [
        "httpTimeoutSeconds",
        "relationshipPageSize",
        "actionWaitSeconds",
        "actionPollIntervalMillis",
    ] {
        if input[field]
            .as_u64()
            .is_none_or(|v| v == 0 || v > u32::MAX as u64)
        {
            return Err("explicit bounded fixture transport configuration required".into());
        }
    }
    let mut ids = BTreeSet::new();
    for field in [
        "environmentId",
        "tenantId",
        "humanIdentityId",
        "humanPrincipalId",
        "approverHumanIdentityId",
        "approverPrincipalId",
        "catalogTenantId",
        "catalogHumanIdentityId",
        "catalogPrincipalId",
        "readGrantIdempotencyKey",
    ] {
        if !ids.insert(id(&input, field)?) {
            return Err("fixture identity reused".into());
        }
    }
    let input_digest = collab_bridge::limits::canonical_digest(&input);
    let endpoints = input["endpoints"]
        .as_array_mut()
        .filter(|v| v.len() == 2)
        .ok_or("exactly one source and one receiver required")?;
    let mut roles = BTreeSet::new();
    let mut categories = BTreeSet::new();
    let mut clients = BTreeSet::new();
    for endpoint in endpoints {
        exact(
            endpoint,
            &[
                "role",
                "contractId",
                "releaseId",
                "bindingId",
                "servicePrincipalId",
                "bindingIdempotencyKey",
                "resourceIdempotencyKey",
                "modelCallMode",
                "secretRefs",
                "generation",
                "isolationMode",
                "contractRegistration",
                "manifest",
                "package",
                "bindingConfigSchema",
                "artifactDigest",
                "adapterContractDigest",
                "adapterServiceRef",
                "nativeInstanceRef",
                "nativeScopeRef",
                "nativeResourceRef",
                "nativeType",
                "typeKey",
                "nativeEvidenceRef",
                "nativeEvidenceDigest",
                "serviceAudience",
                "normalizedConfig",
            ],
        )?;
        let role = required(endpoint, "role")?.to_owned();
        if !matches!(role.as_str(), "SOURCE" | "RECEIVER")
            || !roles.insert(role.clone())
            || endpoint["generation"].as_i64().is_none_or(|v| v <= 0)
        {
            return Err("invalid receiver/source role or generation".into());
        }
        if !matches!(
            required(endpoint, "isolationMode")?,
            "DEDICATED_INSTANCE"
                | "NATIVE_TENANT"
                | "NAMESPACE"
                | "RESOURCE_FILTER"
                | "RESOURCE_INSTANCE"
        ) {
            return Err("original binding isolation mode required".into());
        }
        for field in [
            "contractId",
            "releaseId",
            "bindingId",
            "servicePrincipalId",
            "bindingIdempotencyKey",
            "resourceIdempotencyKey",
        ] {
            if !ids.insert(id(endpoint, field)?) {
                return Err("fixture identity reused".into());
            }
        }
        for field in [
            "artifactDigest",
            "adapterContractDigest",
            "nativeEvidenceDigest",
        ] {
            if !hex_digest(required(endpoint, field)?) {
                return Err("exact SHA256 required".into());
            }
        }
        for field in [
            "adapterServiceRef",
            "nativeInstanceRef",
            "nativeScopeRef",
            "nativeResourceRef",
            "nativeType",
            "typeKey",
            "nativeEvidenceRef",
            "serviceAudience",
        ] {
            required(endpoint, field)?;
        }
        let config = &endpoint["normalizedConfig"];
        if !config.is_object() || !clients.insert(required(config, "client_id")?.to_owned()) {
            return Err("distinct delivered SERVICE clients required".into());
        }
        let parsed = crate::capability_contract::receiver_fixture_registration(
            endpoint["contractRegistration"].clone(),
        )
        .map_err(|_| "original capability registration validator refused fixture input")?;
        if !categories.insert(required(&parsed, "category")?.to_owned()) {
            return Err("fixture categories must be distinct".into());
        }
        let manifest = &endpoint["manifest"];
        if role == "RECEIVER" && endpoint["modelCallMode"] != "PLATFORM_LLM_ROUTE" {
            return Err("receiver fixture requires the actual governed model delivery".into());
        }
        let release = crate::component_release::registration(&json!({
            "manifestJson":manifest.to_string(),"packageJson":endpoint["package"].to_string(),
            "bindingConfigSchemaJson":endpoint["bindingConfigSchema"].to_string()
        }))
        .map_err(|_| "original release declaration validator refused fixture input")?;
        if release.id != id(endpoint, "releaseId")?
            || release.adapter_digest != required(endpoint, "artifactDigest")?
            || endpoint["adapterContractDigest"] != manifest["adapterBuildRef"]
            || endpoint["serviceAudience"] != manifest["executionConnector"]["actionTokenAudience"]
            || !crate::capability_contract::schema_validator(
                &release.binding_config_schema,
                &Default::default(),
            )
            .map_err(|_| "original binding schema validator refused fixture input")?
            .is_valid(config)
        {
            return Err("delivered release, artifact or binding configuration differs".into());
        }
        required(manifest, "componentTypeKey")?;
        if !declares(manifest, Some(required(&parsed, "category")?), &role)
            || !manifest["resourceTypeDefinitions"]
                .as_array()
                .is_some_and(|types| {
                    types.iter().any(|kind| {
                        kind["typeKey"] == endpoint["typeKey"]
                            && kind["capabilityCategory"] == parsed["category"]
                            && kind["capabilityContractVersion"] == parsed["version"]
                    })
                })
        {
            return Err("actual manifest does not declare the frozen fixture resource/edge".into());
        }
        endpoint["manifestDigest"] = json!(release.manifest_digest);
        endpoint["packageDigest"] = json!(release.package_digest);
        endpoint["configDigest"] = json!(collab_bridge::limits::canonical_digest(
            &endpoint["normalizedConfig"]
        ));
        endpoint["nativeIdentityDigest"] = json!(collab_bridge::limits::canonical_digest(&json!({
            "instance":endpoint["nativeInstanceRef"],"ref":endpoint["nativeResourceRef"],
            "scope":endpoint["nativeScopeRef"],"type":endpoint["nativeType"]})));
        endpoint["parsedContract"] = parsed;
        let binding = binding_request(endpoint)?;
        let params = crate::governance::Params::from_json(&json!({
            "applicationBindingCreate":binding,"explicitConfirmation":true
        }))
        .ok_or("original binding parameters refused fixture input")?;
        crate::application_binding::validate_params(&params, true)
            .map_err(|_| "original binding request validator refused fixture input")?;
        crate::model_route::application::configuration(
            required(endpoint, "modelCallMode")?,
            &endpoint["normalizedConfig"],
            &binding["capabilityCategories"],
            &endpoint["manifest"],
        )
        .map_err(|_| "original model route configuration refused fixture input")?;
    }
    input["inputDigest"] = json!(input_digest);
    Ok(input)
}

fn binding_request(endpoint: &Value) -> Result<Value, Error> {
    Ok(
        json!({"bindingId":endpoint["bindingId"],"componentReleaseId":endpoint["releaseId"],
        "servicePrincipalId":endpoint["servicePrincipalId"],"adapterServiceRef":endpoint["adapterServiceRef"],
        "nativeInstanceRef":endpoint["nativeInstanceRef"],"nativeScopeRef":endpoint["nativeScopeRef"],
        "isolationMode":endpoint["isolationMode"],"capabilityCategories":[{
            "category":endpoint["parsedContract"]["category"],"version":endpoint["parsedContract"]["version"]}],
        "normalizedConfigJson":endpoint["normalizedConfig"].to_string(),"secretRefs":endpoint["secretRefs"],
        "modelCallMode":endpoint["modelCallMode"],"callIdentityMode":"INSTANCE_SERVICE","retainOnTenantDelete":false}),
    )
}

fn private_file(path: &str) -> Result<Vec<u8>, Error> {
    let path = Path::new(path);
    let metadata = std::fs::symlink_metadata(path)?;
    if !path.is_absolute()
        || path.canonicalize()? != path
        || !metadata.is_file()
        || metadata.permissions().mode() & 0o077 != 0
    {
        return Err("private canonical fixture file required".into());
    }
    Ok(std::fs::read(path)?)
}

async fn authenticated_session(
    http: &reqwest::Client,
    input: &Value,
    token_field: &str,
    tenant_field: &str,
    human_field: &str,
    principal_field: &str,
) -> Result<String, Error> {
    let token = String::from_utf8(private_file(required(input, token_field)?)?)?;
    let token = token.trim().to_owned();
    if token.is_empty() || token.chars().any(char::is_whitespace) {
        return Err("invalid delivered access token".into());
    }
    // Use the original authenticated gateway. Never synthesize Core's trusted
    // upstream OIDC headers or impersonate a principal from fixture JSON.
    let response = http
        .get(format!("{}api/v1/session", required(input, "coreOrigin")?))
        .bearer_auth(&token)
        .send()
        .await?;
    if !response.status().is_success() {
        return Err("real isolated session refused".into());
    }
    let session: Value = response.json().await?;
    if session["tenantId"] != input[tenant_field]
        || session["humanIdentityId"] != input[human_field]
        || session["tenantPrincipalId"] != input[principal_field]
        || session["accessMode"] != "FULL"
    {
        return Err("real isolated session does not match frozen identity".into());
    }
    Ok(token)
}

#[derive(sqlx::FromRow)]
struct ActionFact {
    id: Uuid,
    operation_id: Uuid,
    target_id: Uuid,
    action_key: String,
    actor_principal_id: Uuid,
    parameters: Value,
    parameter_hash: String,
    gate_state: String,
    dispatch_state: String,
    approval_workflow_id: Option<String>,
}

async fn retained_action(
    conn: &mut PgConnection,
    input: &Value,
    key: Uuid,
) -> Result<Option<ActionFact>, Error> {
    Ok(sqlx::query_as("select id,operation_id,target_id,action_key,actor_principal_id,parameters,parameter_hash,gate_state,dispatch_state,approval_workflow_id
        from admission.action_execution where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3")
        .bind(id(input,"tenantId")?).bind(id(input,"humanPrincipalId")?).bind(key).fetch_optional(conn).await?)
}

fn action_matches(action: &ActionFact, command: &Value, actor: Uuid) -> Result<(), Error> {
    let mut params = command.as_object().ok_or("action object required")?.clone();
    params.remove("actionKey");
    params.remove("idempotencyKey");
    if action.action_key != required(command, "actionKey")?
        || action.actor_principal_id != actor
        || action.parameters["params"] != Value::Object(params)
    {
        return Err("retained action differs from frozen original command".into());
    }
    Ok(())
}

/// The original owner submits one immutable Temporal decision. self_approval
/// permits this HUMAN to decide; it does not mean automatic approval. The
/// original endpoint fixes Update ID to workflow + principal. An uncertain
/// submission is observed on reentry, never repeated by this fixture.
async fn approve_read_grant(
    http: &reqwest::Client,
    input: &Value,
    token: &str,
    action: &ActionFact,
) -> Result<(), Error> {
    let owner = &action.parameters["permissionApprovalOwner"];
    if action.action_key != "resource.grant_read"
        || action.gate_state != "WAITING"
        || json!(action.actor_principal_id) != input["humanPrincipalId"]
        || action.dispatch_state != "NOT_DISPATCHED"
        || owner["targetType"] != "RESOURCE"
        || owner["targetId"] != json!(action.target_id)
        || owner["targetVersion"] != action.parameters["params"]["resourceVersion"]
        || owner["ownerPrincipalId"] != input["humanPrincipalId"]
    {
        return Err("grant approval is not this authenticated native resource owner".into());
    }
    let workflow = action
        .approval_workflow_id
        .as_deref()
        .ok_or("grant approval reference missing")?;
    let mut url = reqwest::Url::parse(required(input, "coreOrigin")?)?;
    url.path_segments_mut()
        .map_err(|_| "approval URL cannot be a base")?
        .pop_if_empty()
        .extend(["api", "v1", "approvals", workflow]);
    let response = http.get(url.clone()).bearer_auth(token).send().await?;
    if !response.status().is_success() {
        return Err("original owner approval observation unavailable".into());
    }
    let view: Value = response.json().await?;
    if view["workflowId"] != workflow
        || view["actionExecutionId"] != json!(action.id)
        || view["actionKey"] != "resource.grant_read"
        || view["targetType"] != "RESOURCE"
        || view["targetId"] != json!(action.target_id)
        || !view["observation"].is_null()
    {
        return Err("original owner approval observation differs or is unknown".into());
    }
    let decisions = view["decisions"]
        .as_array()
        .ok_or("approval decisions missing")?;
    if let Some(decision) = decisions
        .iter()
        .find(|d| d["approverPrincipalId"] == input["humanPrincipalId"])
    {
        return if decision["decision"] == "APPROVE" {
            Ok(())
        } else {
            Err("original owner already refused this grant".into())
        };
    }
    if view["status"] != "WAITING" && view["status"] != "REQUESTED" {
        return Err("original owner approval is not open".into());
    }
    url.path_segments_mut()
        .map_err(|_| "approval URL cannot be a base")?
        .push("decision");
    let response = http
        .post(url)
        .bearer_auth(token)
        .json(&json!({"decision":"APPROVE"}))
        .send()
        .await?;
    if !response.status().is_success() {
        return Err("original fresh owner approval refused or unresolved".into());
    }
    let outcome: Value = response.json().await?;
    if outcome["admitted"] != true
        || outcome["decision"] != "APPROVE"
        || outcome["approverPrincipalId"] != input["humanPrincipalId"]
    {
        return Err("original owner approval did not admit this decision".into());
    }
    Ok(())
}

/// Only the original action endpoint may create the business AE/Operation and
/// dispatch Temporal. Existing intent (including UNKNOWN) is observed, not sent
/// again. A transport error after first submission only polls that same key.
async fn execute_action(
    conn: &mut PgConnection,
    http: &reqwest::Client,
    input: &Value,
    token: &str,
    command: &Value,
) -> Result<(ActionFact, bool), Error> {
    let (terminal_stage, expected_result) = match required(command, "actionKey")? {
        "application_binding.create" => ("binding:terminal", "SUCCEEDED"),
        "resource.create" => ("resource:terminal", "SUCCEEDED"),
        "resource.grant_read" => ("permission-outcome", "SERVICE_READ_GRANTED"),
        _ => return Err("not a receiver setup action".into()),
    };
    let key = id(command, "idempotencyKey")?;
    let actor = id(input, "humanPrincipalId")?;
    let mut fact = retained_action(conn, input, key).await?;
    let submitted = fact.is_none();
    if submitted {
        let response = http
            .post(format!("{}api/v1/actions", required(input, "coreOrigin")?))
            .bearer_auth(token)
            .json(command)
            .send()
            .await;
        // Do not print a response body, session or delivery secrets. A rejected
        // command is a real failure, not an invitation to mutate/retry the key.
        if let Ok(response) = response {
            if !response.status().is_success() {
                return Err(
                    format!("original action endpoint refused: {}", response.status()).into(),
                );
            }
        }
    }
    let deadline = tokio::time::Instant::now()
        + Duration::from_secs(input["actionWaitSeconds"].as_u64().unwrap());
    let mut owner_decision_attempted = false;
    loop {
        if let Some(action) = fact {
            action_matches(&action, command, actor)?;
            if matches!(action.gate_state.as_str(), "DENIED" | "REVOKED")
                || action.dispatch_state == "ABORTED"
            {
                return Err("original action admission denied".into());
            }
            if submitted
                && action.action_key == "resource.grant_read"
                && action.gate_state == "WAITING"
                && !owner_decision_attempted
            {
                // Wait for the original history projection, not a fabricated
                // approval row. Once called, uncertainty never loops a POST.
                let ready: bool = sqlx::query_scalar(
                    "select exists(select 1 from projection.approval_projection
                    where action_execution_id=$1 and tenant_id=$2 and workflow_id=$3)",
                )
                .bind(action.id)
                .bind(id(input, "tenantId")?)
                .bind(&action.approval_workflow_id)
                .fetch_one(&mut *conn)
                .await?;
                if ready {
                    owner_decision_attempted = true;
                    approve_read_grant(http, input, token, &action).await?;
                }
            }
            let terminal: Option<String> = sqlx::query_scalar("select result_code from audit.audit_event
                where event_key=$1 and tenant_id=$2 and operation_id=$3 and target_id=$4
                  and action_key=$5 and parameter_hash=$6 and actor_principal_id=$7 and initiator_principal_id=$7")
                .bind(format!("{}:{terminal_stage}",if terminal_stage == "permission-outcome" {action.operation_id} else {action.id})).bind(id(input,"tenantId")?)
                .bind(action.operation_id).bind(action.target_id).bind(&action.action_key)
                .bind(&action.parameter_hash).bind(actor).fetch_optional(&mut *conn).await?;
            if let Some(result) = terminal {
                if result != expected_result
                    || action.gate_state != "ALLOWED"
                    || action.dispatch_state != "DISPATCHED"
                {
                    return Err("original lifecycle did not succeed".into());
                }
                return Ok((action, submitted));
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("original action remains unresolved; observe the same key, never create a replacement".into());
        }
        tokio::time::sleep(Duration::from_millis(
            input["actionPollIntervalMillis"].as_u64().unwrap(),
        ))
        .await;
        fact = retained_action(conn, input, key).await?;
    }
}

/// Existing Core test-binary entry, not a second bootstrap API. The dedicated
/// deployment must already contain real IdP sessions, Catalog/business tenants,
/// SERVICE clients and approved capability contracts. The sole synthetic part
/// is the explicitly marked isolated release-directory prerequisite in the SQL
/// companion; it is not release conformance/approval evidence for production.
///
/// Actual bindings, model delivery and resources use Action Admission + Temporal
/// and their original terminal audits. Failure retains those original intents.
/// Never reseed a revoked permission. A partial fixture must be investigated via
/// its actual AE; rebuilding is limited to the explicitly owned isolated DB and
/// SpiceDB deployment, never a shared/production store.
#[tokio::test]
#[ignore = "requires isolated real IdP/Core/Worker/native artifacts; never a conformance PASS"]
async fn bootstrap_native_receiver_environment() -> Result<(), Error> {
    use sqlx::Connection;
    let input = prepare(serde_json::from_slice(&private_file(&std::env::var(
        "APPLICATION_RECEIVER_BOOTSTRAP_FILE",
    )?)?)?)?;
    if std::env::var("SPICEDB_HTTP_URL")?.trim_end_matches('/')
        != required(&input, "spiceDbOrigin")?.trim_end_matches('/')
    {
        return Err("SpiceDB consumer configuration differs from frozen fixture".into());
    }
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(
            input["httpTimeoutSeconds"].as_u64().unwrap(),
        ))
        .build()?;
    let spice = SpiceDb::from_env(http.clone())?;
    let page = input["relationshipPageSize"].as_u64().unwrap() as u32;
    let mut conn =
        PgConnection::connect(&std::env::var("APPLICATION_EXECUTION_TEST_DATABASE_URL")?).await?;
    let (database,owner,current_user,comment):(String,String,String,Option<String>) = sqlx::query_as(
        "select current_database(),pg_get_userbyid(datdba),current_user,shobj_description(oid,'pg_database')
         from pg_database where datname=current_database()").fetch_one(&mut conn).await?;
    let marker = format!(
        "KAILO_CONFORMANCE_ONLY:{}:{}",
        required(&input, "environmentId")?,
        required(&input, "inputDigest")?
    );
    if database != required(&input, "databaseName")?
        || owner != required(&input, "databaseOwner")?
        || current_user != owner
        || comment.as_deref() != Some(&marker)
    {
        return Err("isolated database identity/owner/immutable input marker refused".into());
    }
    // A connection-scoped fixture lock serializes this exact setup without
    // holding production tenant row locks across the real HTTP/Worker calls.
    let locked: bool = sqlx::query_scalar("select pg_try_advisory_lock(hashtextextended($1,0))")
        .bind(format!(
            "receiver-fixture:{}",
            required(&input, "environmentId")?
        ))
        .fetch_one(&mut conn)
        .await?;
    if !locked {
        return Err("same isolated setup already running".into());
    }
    if !crate::platform_bootstrap::is_catalog_tenant(&mut conn, id(&input, "catalogTenantId")?)
        .await?
        || crate::platform_bootstrap::is_catalog_tenant(&mut conn, id(&input, "tenantId")?).await?
    {
        return Err("actual Catalog and business tenant boundaries differ".into());
    }
    let token = authenticated_session(
        &http,
        &input,
        "humanTokenFile",
        "tenantId",
        "humanIdentityId",
        "humanPrincipalId",
    )
    .await?;
    let _catalog = authenticated_session(
        &http,
        &input,
        "catalogTokenFile",
        "catalogTenantId",
        "catalogHumanIdentityId",
        "catalogPrincipalId",
    )
    .await?;
    let _approver = authenticated_session(
        &http,
        &input,
        "approverTokenFile",
        "catalogTenantId",
        "approverHumanIdentityId",
        "approverPrincipalId",
    )
    .await?;
    for principal in ["catalogPrincipalId", "approverPrincipalId"] {
        let check = spice
            .check(
                "tenant",
                required(&input, "catalogTenantId")?,
                "manage",
                required(&input, principal)?,
                Consistency::FullyConsistent,
            )
            .await?;
        if !check.allowed || check.zed_token.is_empty() {
            return Err("actual Catalog administrator authorization refused".into());
        }
    }
    let endpoints = input["endpoints"].as_array().unwrap();
    let mut tx = conn.begin().await?;
    for endpoint in endpoints {
        let contract = &endpoint["parsedContract"];
        let matches: bool = sqlx::query_scalar(
            "select exists(select 1 from catalog.capability_contract
            where id=$1 and category_key=$2 and contract_version=$3 and catalog_tenant_id=$4
              and content=$5 and schema_documents=$6 and test_vectors=$7 and schema_set_digest=$8
              and conformance_suite_digest=$9 and status='ACTIVE')",
        )
        .bind(id(endpoint, "contractId")?)
        .bind(required(contract, "category")?)
        .bind(
            contract["version"]
                .as_i64()
                .ok_or("contract version missing")? as i32,
        )
        .bind(id(&input, "catalogTenantId")?)
        .bind(&contract["content"])
        .bind(&contract["schemas"])
        .bind(&contract["vectors"])
        .bind(required(contract, "schemaDigest")?)
        .bind(required(contract, "suiteDigest")?)
        .fetch_one(&mut *tx)
        .await?;
        if !matches {
            return Err(
                "actual approved capability contract missing or differs; no seed/approval bypass"
                    .into(),
            );
        }
    }
    sqlx::query("select set_config('kailo.receiver_fixture_input',$1,true)")
        .bind(input.to_string())
        .execute(&mut *tx)
        .await?;
    sqlx::raw_sql(include_str!("receiver-environment-bootstrap.sql"))
        .execute(&mut *tx)
        .await?;
    for endpoint in endpoints {
        crate::application_catalog::register_release_definitions(
            &mut tx,
            id(endpoint, "releaseId")?,
        )
        .await
        .map_err(|_| "original declaration writer refused fixture")?;
    }
    tx.commit().await?;

    let mut resources = Vec::new();
    for endpoint in endpoints {
        let command = json!({"actionKey":"application_binding.create",
            "idempotencyKey":endpoint["bindingIdempotencyKey"],"explicitConfirmation":true,
            "applicationBindingCreate":binding_request(endpoint)?});
        let (binding_action, _) =
            execute_action(&mut conn, &http, &input, &token, &command).await?;
        let matches: bool = sqlx::query_scalar("select exists(select 1 from catalog.application_binding b
            join projection.application_runtime p on p.binding_id=b.id and p.generation=b.active_projection_generation
            where b.id=$1 and b.tenant_id=$2 and b.component_release_id=$3 and b.service_principal_id=$4
              and b.normalized_config=$5 and b.native_instance_ref=$6 and b.native_scope_ref=$7
              and b.active_projection_generation=$8 and b.state='ACTIVE' and p.state='ACTIVE'
              and b.created_by_action_execution_id=$9 and b.isolation_mode=$10
              and b.model_call_mode=$11 and b.secret_refs=$12
              and (b.model_call_mode='NONE' or (p.model_state='ACTIVE' and p.model_delivery_receipt is not null)))")
            .bind(id(endpoint,"bindingId")?).bind(id(&input,"tenantId")?).bind(id(endpoint,"releaseId")?)
            .bind(id(endpoint,"servicePrincipalId")?).bind(&endpoint["normalizedConfig"])
            .bind(required(endpoint,"nativeInstanceRef")?).bind(required(endpoint,"nativeScopeRef")?)
            .bind(endpoint["generation"].as_i64().unwrap()).bind(binding_action.id)
            .bind(required(endpoint,"isolationMode")?).bind(required(endpoint,"modelCallMode")?).bind(&endpoint["secretRefs"])
            .fetch_one(&mut conn).await?;
        if !matches || binding_action.target_id != id(endpoint, "bindingId")? {
            return Err("actual binding/model delivery not active for frozen facts".into());
        }
        let command = json!({"actionKey":"resource.create","idempotencyKey":endpoint["resourceIdempotencyKey"],
            "resourceCreate":{"typeKey":endpoint["typeKey"],"nativeType":endpoint["nativeType"],
            "nativeRef":endpoint["nativeResourceRef"],"evidenceRef":endpoint["nativeEvidenceRef"],
            "evidenceDigest":endpoint["nativeEvidenceDigest"]}});
        let (action, submitted) =
            execute_action(&mut conn, &http, &input, &token, &command).await?;
        let resource_exact:bool = sqlx::query_scalar("select exists(select 1 from catalog.resource
            where id=$1 and tenant_id=$2 and application_binding_id=$3 and owner_principal_id=$4
              and type_key=$5 and native_type=$6 and native_id=$7 and native_identity_digest=$8
              and reference_provision->>'actionExecutionId'=$9::uuid::text
              and state='ACTIVE' and home_workspace_id is null
              and (projection_action_execution_id is null or exists(select 1 from admission.action_execution a
                where a.id=projection_action_execution_id and a.tenant_id=$2 and a.target_id=$1
                  and a.initiator_principal_id=$4 and a.actor_principal_id=$4
                  and a.action_key='resource.grant_read' and a.idempotency_key=$10)))")
            .bind(action.target_id).bind(id(&input,"tenantId")?).bind(id(endpoint,"bindingId")?)
            .bind(id(&input,"humanPrincipalId")?).bind(required(endpoint,"typeKey")?)
            .bind(required(endpoint,"nativeType")?).bind(required(endpoint,"nativeResourceRef")?)
            .bind(required(endpoint,"nativeIdentityDigest")?).bind(action.id)
            .bind(id(&input,"readGrantIdempotencyKey")?).fetch_one(&mut conn).await?;
        if !resource_exact {
            return Err("actual native resource differs from frozen reference".into());
        }
        resources.push((endpoint, action, submitted));
    }
    let tenant = required(&input, "tenantId")?;
    let owner = required(&input, "humanPrincipalId")?;
    let receiving = endpoints.iter().find(|e| e["role"] == "RECEIVER").unwrap();
    let principal = required(receiving, "servicePrincipalId")?;
    let source = resources
        .iter()
        .find(|(endpoint, _, _)| endpoint["role"] == "SOURCE")
        .unwrap()
        .1
        .target_id;
    let receiver_resource = resources
        .iter()
        .find(|(endpoint, _, _)| endpoint["role"] == "RECEIVER")
        .unwrap()
        .1
        .target_id;
    let retained_grant =
        retained_action(&mut conn, &input, id(&input, "readGrantIdempotencyKey")?).await?;
    let grant_params = if let Some(action) = retained_grant {
        let params = &action.parameters["params"];
        if params["resourceId"] != json!(source)
            || params["principalId"] != json!(principal)
            || params["receiverResource"]["id"] != json!(receiver_resource)
        {
            return Err("retained reader grant belongs to different native resources".into());
        }
        params.clone()
    } else {
        let source_version: i32 = sqlx::query_scalar(
            "select version from catalog.resource where id=$1 and tenant_id=$2 and state='ACTIVE'",
        )
        .bind(source)
        .bind(id(&input, "tenantId")?)
        .fetch_one(&mut conn)
        .await?;
        let receiver_version: i32 = sqlx::query_scalar(
            "select version from catalog.resource where id=$1 and tenant_id=$2 and state='ACTIVE'",
        )
        .bind(receiver_resource)
        .bind(id(&input, "tenantId")?)
        .fetch_one(&mut conn)
        .await?;
        json!({"resourceId":source,"resourceVersion":source_version,"principalId":principal,
            "receiverResource":{"id":receiver_resource,"version":receiver_version}})
    };
    let mut grant_command = grant_params;
    grant_command["actionKey"] = json!("resource.grant_read");
    grant_command["idempotencyKey"] = input["readGrantIdempotencyKey"].clone();
    let (grant_action, _) =
        execute_action(&mut conn, &http, &input, &token, &grant_command).await?;
    for (endpoint, action, submitted) in &resources {
        let resource = action.target_id.to_string();
        if *submitted && endpoint["role"] == "RECEIVER" {
            // Only the isolated fixture's explicit permission prerequisite.
            // Resource ownership itself was written by the real lifecycle.
            // An existing action never re-grants a later revoked permission.
            let relations: &[&str] = &["editor", "deleter"];
            let updates: Vec<_> = relations
                .iter()
                .map(|relation| {
                    (
                        Write::Touch,
                        Relationship {
                            object_type: "resource".into(),
                            object_id: resource.clone(),
                            relation: (*relation).into(),
                            subject: Subject::Principal(principal.into()),
                        },
                    )
                })
                .collect();
            spice.write(&updates).await?;
        }
        if !spice
            .resource_projection_matches(&resource, tenant, owner, page)
            .await?
        {
            return Err("original resource ownership projection differs".into());
        }
        let permissions: &[&str] = if endpoint["role"] == "SOURCE" {
            &["read"]
        } else {
            &["update", "delete"]
        };
        for permission in permissions {
            let result = spice
                .check(
                    "resource",
                    &resource,
                    permission,
                    principal,
                    Consistency::FullyConsistent,
                )
                .await?;
            if !result.allowed || result.zed_token.is_empty() {
                return Err(
                    "original fresh permission check refused; never repair a revoked fixture"
                        .into(),
                );
            }
        }
    }
    let mut tx = conn.begin().await?;
    let current = receiver(&mut tx, id(receiving, "bindingId")?)
        .await
        .map_err(|_| "original receiver lookup refused fixture")?;
    if current.principal != id(receiving, "servicePrincipalId")?
        || current.generation != receiving["generation"].as_i64().unwrap()
    {
        return Err("original receiver identity differs".into());
    }
    tx.commit().await?;
    println!(
        "{}",
        json!({"mode":"CONFORMANCE_ONLY","environmentId":input["environmentId"],
        "inputDigest":input["inputDigest"],"setup":"READY","conformanceExecuted":false,
        "readGrantActionExecutionId":grant_action.id,"readGrantOperationId":grant_action.operation_id,
        "resources":resources.iter().map(|(endpoint,action,_)|json!({
            "role":endpoint["role"],"bindingId":endpoint["bindingId"],"resourceId":action.target_id,
            "resourceActionExecutionId":action.id,"resourceOperationId":action.operation_id
        })).collect::<Vec<_>>()})
    );
    Ok(())
}

#[test]
fn retained_receiver_setup_action_requires_exact_actor_and_command() {
    let actor = Uuid::new_v4();
    let command = json!({"actionKey":"resource.grant_read","idempotencyKey":Uuid::new_v4(),
        "resourceId":Uuid::new_v4(),"resourceVersion":1,"principalId":Uuid::new_v4(),
        "receiverResource":{"id":Uuid::new_v4(),"version":1}});
    let mut params = command.as_object().unwrap().clone();
    params.remove("actionKey");
    params.remove("idempotencyKey");
    let mut fact = ActionFact {
        id: Uuid::new_v4(),
        operation_id: Uuid::new_v4(),
        target_id: Uuid::new_v4(),
        action_key: "resource.grant_read".into(),
        actor_principal_id: actor,
        parameters: json!({"params":params,"permissionReadEdge":{"receiverGeneration":1}}),
        parameter_hash: "retained".into(),
        gate_state: "ALLOWED".into(),
        dispatch_state: "UNKNOWN".into(),
        approval_workflow_id: None,
    };
    assert!(action_matches(&fact, &command, actor).is_ok());
    assert!(action_matches(&fact, &command, Uuid::new_v4()).is_err());
    let mut changed = command.clone();
    changed["receiverResource"]["id"] = json!(Uuid::new_v4());
    assert!(action_matches(&fact, &changed, actor).is_err());
    changed = command.clone();
    changed["resourceVersion"] = json!(2);
    assert!(action_matches(&fact, &changed, actor).is_err());
    fact.action_key = "resource.revoke_read".into();
    assert!(action_matches(&fact, &command, actor).is_err());
}

#[tokio::test]
async fn receiver_owner_approval_uses_original_http_decision_and_refuses_unknown() {
    use std::sync::{
        atomic::{AtomicU8, AtomicUsize, Ordering},
        Arc,
    };
    let actor = Uuid::new_v4();
    let target = Uuid::new_v4();
    let action_id = Uuid::new_v4();
    let workflow = "approval-original-receiver-grant";
    let state = Arc::new((AtomicU8::new(0), AtomicUsize::new(0), AtomicUsize::new(0)));
    let get = {
        let state = state.clone();
        move |headers: HeaderMap| {
            let state = state.clone();
            async move {
                assert_eq!(headers["authorization"], "Bearer isolated-owner-session");
                state.1.fetch_add(1, Ordering::SeqCst);
                let mode = state.0.load(Ordering::SeqCst);
                let mut view = json!({"workflowId":workflow,"actionExecutionId":action_id,
                    "actionKey":"resource.grant_read","targetType":"RESOURCE","targetId":target,
                    "status":"WAITING","decisions":[]});
                match mode {
                    1 => view["actionExecutionId"] = json!(Uuid::new_v4()),
                    2 => view["observation"] = json!("EXTERNAL_RESULT_UNKNOWN"),
                    3 | 4 => {
                        view["decisions"] = json!([{"approverPrincipalId":actor,
                        "decision":if mode == 3 {"APPROVE"} else {"DENY"}}])
                    }
                    5 => view["status"] = json!("EXPIRED"),
                    _ => (),
                }
                Json(view)
            }
        }
    };
    let post = {
        let state = state.clone();
        move |headers: HeaderMap, Json(body): Json<Value>| {
            let state = state.clone();
            async move {
                assert_eq!(headers["authorization"], "Bearer isolated-owner-session");
                assert_eq!(body, json!({"decision":"APPROVE"}));
                state.2.fetch_add(1, Ordering::SeqCst);
                let mode = state.0.load(Ordering::SeqCst);
                if mode == 6 {
                    return axum::http::StatusCode::SERVICE_UNAVAILABLE.into_response();
                }
                Json(
                    json!({"admitted":mode != 7,"decision":"APPROVE","status":"APPROVED",
                    "approverPrincipalId":if mode == 8 {Uuid::new_v4()} else {actor}}),
                )
                .into_response()
            }
        }
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let input = json!({"coreOrigin":format!("http://{}/",listener.local_addr().unwrap()),
        "humanPrincipalId":actor});
    let router = axum::Router::new()
        .route(
            &format!("/api/v1/approvals/{workflow}"),
            axum::routing::get(get),
        )
        .route(
            &format!("/api/v1/approvals/{workflow}/decision"),
            axum::routing::post(post),
        );
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let mut action = ActionFact {
        id: action_id,
        operation_id: Uuid::new_v4(),
        target_id: target,
        action_key: "resource.grant_read".into(),
        actor_principal_id: actor,
        parameter_hash: "frozen-original".into(),
        gate_state: "WAITING".into(),
        dispatch_state: "NOT_DISPATCHED".into(),
        approval_workflow_id: Some(workflow.into()),
        parameters: json!({"params":{"resourceVersion":1},"permissionApprovalOwner":{
            "targetType":"RESOURCE","targetId":target,"targetVersion":1,"ownerPrincipalId":actor}}),
    };
    approve_read_grant(&http, &input, "isolated-owner-session", &action)
        .await
        .unwrap();
    assert_eq!(state.2.load(Ordering::SeqCst), 1);
    for mode in 1..=5 {
        state.0.store(mode, Ordering::SeqCst);
        let result = approve_read_grant(&http, &input, "isolated-owner-session", &action).await;
        assert_eq!(result.is_ok(), mode == 3, "observation mode {mode}");
        assert_eq!(
            state.2.load(Ordering::SeqCst),
            1,
            "observation cannot resend approval"
        );
    }
    for mode in 6..=8 {
        state.0.store(mode, Ordering::SeqCst);
        assert!(
            approve_read_grant(&http, &input, "isolated-owner-session", &action)
                .await
                .is_err()
        );
        assert_eq!(
            state.2.load(Ordering::SeqCst),
            usize::from(mode) - 4,
            "one attempt only"
        );
    }
    let read_count = state.1.load(Ordering::SeqCst);
    action.parameters["permissionApprovalOwner"]["ownerPrincipalId"] = json!(Uuid::new_v4());
    assert!(
        approve_read_grant(&http, &input, "isolated-owner-session", &action)
            .await
            .is_err()
    );
    action.parameters["permissionApprovalOwner"]["ownerPrincipalId"] = json!(actor);
    action.parameters["permissionApprovalOwner"]["targetVersion"] = json!(2);
    assert!(
        approve_read_grant(&http, &input, "isolated-owner-session", &action)
            .await
            .is_err()
    );
    action.parameters["permissionApprovalOwner"]["targetVersion"] = json!(1);
    action.dispatch_state = "UNKNOWN".into();
    assert!(
        approve_read_grant(&http, &input, "isolated-owner-session", &action)
            .await
            .is_err()
    );
    assert_eq!(
        state.1.load(Ordering::SeqCst),
        read_count,
        "invalid frozen context must not make HTTP calls"
    );
    assert_eq!(state.2.load(Ordering::SeqCst), 4);
    server.abort();
}
