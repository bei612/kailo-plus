//! Binding-scoped native credentials use the existing OpenBao read/audit and
//! Gateway file projection. No credential values enter Catalog or route JSON.

use super::*;
use crate::{model_route::Gateway, service_api::ServiceState};
use sha2::{Digest, Sha256};

struct Credential<'a> {
    key: &'a str,
    reference: secret_store::SecretRef,
    header: &'a str,
    prefix: &'a str,
    schema: Value,
}

fn unavailable() -> Refusal {
    Refusal::Unavailable("native credential evidence unavailable".into())
}

fn plan<'a>(
    binding: &'a Value,
    manifest: &Value,
    fact: &'a Value,
    generation: i64,
) -> Result<Vec<Credential<'a>>, Refusal> {
    let refs = binding["secretRefs"].as_array().ok_or_else(invalid)?;
    let declarations = manifest["secretSchema"].as_array().ok_or_else(invalid)?;
    let mappings = fact
        .get("nativeCredentials")
        .map(|v| v.as_array().map(Vec::as_slice).ok_or_else(invalid))
        .transpose()?
        .unwrap_or(&[]);
    if refs.len() != declarations.len()
        || refs.len() != mappings.len()
        || (!refs.is_empty() && fact["credentialGeneration"].as_i64() != Some(generation))
    {
        return Err(blocked());
    }
    for field in [
        "bindingId",
        "tenantId",
        "servicePrincipalId",
        "configDigest",
        "isolationMode",
    ] {
        if fact[field] != binding[field] {
            return Err(blocked());
        }
    }
    if fact.get("workspaceId") != binding.get("workspaceId") {
        return Err(blocked());
    }
    if binding
        .get("nativeScopeRef")
        .is_some_and(|scope| scope != &fact["nativeScopeRef"])
    {
        return Err(blocked());
    }
    credential_plan(uuid(binding, "tenantId")?, refs, declarations, mappings)
}

fn credential_plan<'a>(
    tenant: Uuid,
    refs: &'a [Value],
    declarations: &[Value],
    mappings: &'a [Value],
) -> Result<Vec<Credential<'a>>, Refusal> {
    if refs.len() != declarations.len() || refs.len() != mappings.len() {
        return Err(blocked());
    }
    let mut keys = BTreeSet::new();
    let mut headers = BTreeSet::new();
    let mut result = Vec::new();
    for reference in refs {
        let key = text(reference, "secretKey")?;
        let matches: Vec<_> = mappings.iter().filter(|m| m["secretKey"] == key).collect();
        let [mapping] = matches.as_slice() else {
            return Err(blocked());
        };
        let declarations: Vec<_> = declarations
            .iter()
            .filter(|d| d["secretKey"] == key)
            .collect();
        let [declaration] = declarations.as_slice() else {
            return Err(blocked());
        };
        for field in ["locator", "version", "audience"] {
            if mapping[field] != reference[field] {
                return Err(blocked());
            }
        }
        // The supported transport is a native HTTP credential, not a DATA_KEY
        // or an arbitrary environment/file installation into a third party.
        if declaration["rotationClass"] != "SERVICE_CREDENTIAL"
            || declaration["deliveryMode"] != "FILE"
            || declaration["valueType"] != "STRING"
            || declaration["restartRequired"] != false
        {
            return Err(blocked());
        }
        let schema: Value =
            serde_json::from_str(text(declaration, "lengthOrFormat")?).map_err(|_| blocked())?;
        // The existing textual length/format field is consumed as an explicit
        // string schema here. Unknown vocabulary is not silently ignored by a
        // permissive validator; regex is the supported format constraint.
        if schema.get("type").and_then(Value::as_str) != Some("string")
            || schema.as_object().is_none_or(|fields| {
                fields.keys().any(|key| {
                    !matches!(key.as_str(), "type" | "minLength" | "maxLength" | "pattern")
                })
            })
            || jsonschema::meta::try_validate(&schema)
                .map_err(|_| blocked())?
                .is_err()
        {
            return Err(blocked());
        }
        crate::capability_contract::schema_validator(&schema, &BTreeMap::new())?;
        let header = text(mapping, "header")?;
        let prefix = mapping["prefix"].as_str().ok_or_else(invalid)?;
        let parsed =
            reqwest::header::HeaderName::from_bytes(header.as_bytes()).map_err(|_| invalid())?;
        if header != parsed.as_str()
            || !keys.insert(key)
            || !headers.insert(header)
            || matches!(
                header,
                "cookie"
                    | "host"
                    | "connection"
                    | "content-length"
                    | "transfer-encoding"
                    | "mcp-session-id"
            )
            || header.starts_with("x-platform-")
            || header.starts_with("proxy-")
            || !prefix.is_ascii()
            || prefix.contains(['\r', '\n'])
        {
            return Err(invalid());
        }
        let locator = text(reference, "locator")?;
        if !locator.starts_with(&format!("tenants/{tenant}/"))
            || locator
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
            || locator.contains(['?', '#', '%', '\\'])
            || locator.chars().any(char::is_whitespace)
        {
            return Err(blocked());
        }
        result.push(Credential {
            key,
            reference: secret_store::SecretRef {
                locator: locator.into(),
                audience: text(reference, "audience")?.into(),
                version: u32::try_from(
                    reference["version"]
                        .as_u64()
                        .filter(|v| *v > 0)
                        .ok_or_else(invalid)?,
                )
                .map_err(|_| invalid())?,
            },
            header,
            prefix,
            schema,
        });
    }
    Ok(result)
}

fn conformance_plan<'a>(
    tenant: Uuid,
    manifest: &Value,
    environment: &'a Value,
) -> Result<Vec<Credential<'a>>, Refusal> {
    let references = environment
        .get("nativeCredentials")
        .map(|value| value.as_array().map(Vec::as_slice).ok_or_else(invalid))
        .transpose()?
        .unwrap_or(&[]);
    let declarations = manifest["secretSchema"].as_array().ok_or_else(invalid)?;
    // Conformance has no ApplicationBinding yet. Its frozen deployment input
    // supplies the same SecretRef/header mapping, scoped to the Catalog tenant.
    credential_plan(tenant, references, declarations, references)
}

pub(crate) fn validate_conformance(
    tenant: Uuid,
    manifest: &Value,
    environment: &Value,
) -> Result<(), Refusal> {
    let plan = conformance_plan(tenant, manifest, environment)?;
    if !plan.is_empty() {
        let reader = std::env::var("OPENBAO_SERVICE_IDENTITY").map_err(|_| blocked())?;
        if reader.is_empty()
            || plan
                .iter()
                .any(|credential| credential.reference.audience != reader)
        {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
    }
    Ok(())
}

pub(crate) async fn prepare_conformance(
    state: &ServiceState,
    ae: &Execution,
    manifest: &Value,
    environment: &Value,
) -> Result<Value, Refusal> {
    if ae.action_key != crate::component_release::REGISTER
        || ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "DISPATCHED"
    {
        return Err(conflict());
    }
    validate_conformance(ae.tenant_id, manifest, environment)?;
    let plan = conformance_plan(ae.tenant_id, manifest, environment)?;
    project_credentials(
        state,
        ae,
        Uuid::new_v5(&ae.id, b"component-conformance-credential"),
        1,
        plan,
    )
    .await
}

fn projection_id(binding: Uuid, generation: i64, key: &str) -> Uuid {
    Uuid::new_v5(
        &binding,
        format!("native-mcp-credential:{generation}:{key}").as_bytes(),
    )
}

pub(super) fn validate_admission(
    binding: &Value,
    manifest: &Value,
    adapter: &native::Adapter,
) -> Result<(), Refusal> {
    let facts: Vec<_> = adapter.value["bindings"]
        .as_array()
        .ok_or_else(blocked)?
        .iter()
        .filter(|f| f["bindingId"] == binding["bindingId"])
        .collect();
    let [fact] = facts.as_slice() else {
        return Err(blocked());
    };
    // This original create writer creates version/projection generation one.
    let plan = plan(binding, manifest, fact, 1)?;
    if !plan.is_empty() {
        let reader = std::env::var("OPENBAO_SERVICE_IDENTITY").map_err(|_| blocked())?;
        if reader.is_empty()
            || plan
                .iter()
                .any(|credential| credential.reference.audience != reader)
        {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
    }
    Ok(())
}

pub(super) async fn prepare(
    state: &ServiceState,
    ae: &Execution,
    generation: i64,
    binding: &Value,
    manifest: &Value,
    adapter: &native::Adapter,
) -> Result<Value, Refusal> {
    if uuid(binding, "bindingId")? != ae.target_id
        || uuid(binding, "tenantId")? != ae.tenant_id
        || ae.action_key != CREATE
        || ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "DISPATCHED"
    {
        return Err(conflict());
    }
    let definition =
        crate::governance::exact_definition(&state.pool, &ae.action_key, ae.action_version).await?;
    let admission = state
        .governance
        .evaluate(
            crate::governance::Actor {
                tenant_id: ae.tenant_id,
                principal_id: ae.initiator_principal_id,
                human_identity_id: None,
            },
            &definition,
            &Target {
                id: ae.target_id,
                workspace_id: ae.workspace_id,
                version: i32::try_from(binding["bindingVersion"].as_i64().ok_or_else(invalid)?)
                    .map_err(|_| invalid())?,
            },
        )
        .await?;
    if !admission.allowed {
        return Err(Refusal::Denied(
            admission.reason.unwrap_or(ReasonCode::PermissionDenied),
        ));
    }
    let facts: Vec<_> = adapter.value["bindings"]
        .as_array()
        .ok_or_else(blocked)?
        .iter()
        .filter(|f| f["bindingId"] == binding["bindingId"])
        .collect();
    let [fact] = facts.as_slice() else {
        return Err(blocked());
    };
    let plan = plan(binding, manifest, fact, generation)?;
    project_credentials(state, ae, ae.target_id, generation, plan).await
}

async fn project_credentials(
    state: &ServiceState,
    ae: &Execution,
    scope: Uuid,
    generation: i64,
    plan: Vec<Credential<'_>>,
) -> Result<Value, Refusal> {
    let gateway = Gateway::from_env()?;
    let mut observations = Vec::new();
    for credential in plan {
        // read_audited keeps the original audience equality check. A credential
        // assigned to another service is not readable through this Core path.
        let read = state
            .secrets
            .read_audited(&credential.reference, "value")
            .await
            .map_err(|_| unavailable())?;
        if read.value.expose().is_empty()
            || !crate::capability_contract::schema_validator(&credential.schema, &BTreeMap::new())?
                .is_valid(&Value::String(read.value.expose().into()))
            || reqwest::header::HeaderValue::from_str(&format!(
                "{}{}",
                credential.prefix,
                read.value.expose()
            ))
            .is_err()
        {
            return Err(invalid());
        }
        state
            .audit
            .verify_secret_reads(&[secret_store::AuditedSecretRead {
                reference: &credential.reference,
                request_id: &read.request_id,
                role_name: &read.role_name,
                not_before: ae.updated_at,
            }])
            .await
            .map_err(|_| unavailable())?;
        let id = projection_id(scope, generation, credential.key);
        let hash = hex::encode(Sha256::digest(read.value.expose().as_bytes()));
        gateway
            .project_credential(
                ae.tenant_id,
                id,
                credential.reference.version,
                &read.value,
                &hash,
            )
            .await?;
        observations.push(json!({"secretKey":credential.key,"projectionId":id,"version":credential.reference.version,
            "file":gateway.credential_file(ae.tenant_id,id,credential.reference.version)?,"sha256":hash,
            "header":credential.header,"prefix":credential.prefix,
            "secretRefDigest":collab_bridge::limits::canonical_digest(&json!({"locator":credential.reference.locator,
                "version":credential.reference.version,"audience":credential.reference.audience})),
            "readRequestId":read.request_id}));
    }
    Ok(Value::Array(observations))
}

pub(crate) fn backend_auth(observations: &Value) -> Result<Option<Value>, Refusal> {
    let observations = observations.as_array().ok_or_else(invalid)?;
    if observations.is_empty() {
        return Ok(None);
    }
    let credentials:Vec<_>=observations.iter().map(|o|Ok(json!({
        "location":{"header":{"name":text(o,"header")?,"prefix":o["prefix"].as_str().ok_or_else(invalid)?}},
        "key":{"file":text(o,"file")?}}))).collect::<Result<_,Refusal>>()?;
    Ok(Some(json!({"credentials":credentials})))
}

/// A rotated/deleted OpenBao version or substituted directory/file cannot
/// silently keep authorizing new calls with a cached native credential.
pub(crate) async fn require_live(
    state: &ServiceState,
    conn: &mut PgConnection,
    binding_id: Uuid,
    generation: i64,
) -> Result<(), Refusal> {
    let row:Option<(Value,Value,Value,chrono::DateTime<chrono::Utc>)>=sqlx::query_as(
        "select jsonb_strip_nulls(jsonb_build_object('bindingId',b.id,'tenantId',b.tenant_id,
          'workspaceId',b.workspace_id,'servicePrincipalId',b.service_principal_id,
          'configDigest',b.config_digest,'isolationMode',b.isolation_mode,'secretRefs',b.secret_refs,
          'adapterServiceRef',b.adapter_service_ref,'nativeInstanceRef',b.native_instance_ref,
          'nativeScopeRef',b.native_scope_ref)),
          r.manifest,p.observation,original.updated_at
        from catalog.application_binding b join projection.application_runtime p on p.binding_id=b.id
          and p.generation=b.active_projection_generation and p.component_release_id=b.component_release_id
        join catalog.component_release r on r.id=b.component_release_id and r.status='APPROVED'
        join admission.action_execution original on original.id=p.action_execution_id
          and original.target_id=b.id and original.action_key='application_binding.create'
        where b.id=$1 and b.state='ACTIVE' and p.generation=$2 and p.state='ACTIVE'
          and p.gateway_state='ACTIVE' for share of b,p")
        .bind(binding_id).bind(generation).fetch_optional(&mut *conn).await?;
    let (binding, manifest, observation, not_before) = row.ok_or_else(blocked)?;
    if native::Connector::from_manifest(&manifest)? == native::Connector::RemoteAdapter {
        return Ok(());
    }
    let tenant = uuid(&binding, "tenantId")?;
    let adapter = native::Adapter::resolve(
        text(&binding, "adapterServiceRef")?,
        text(&binding, "nativeInstanceRef")?,
        &manifest,
    )?;
    let facts: Vec<_> = adapter.value["bindings"]
        .as_array()
        .ok_or_else(blocked)?
        .iter()
        .filter(|f| f["bindingId"] == binding["bindingId"])
        .collect();
    let [fact] = facts.as_slice() else {
        return Err(blocked());
    };
    let planned = plan(&binding, &manifest, fact, generation)?;
    let observed = observation["nativeCredentials"]
        .as_array()
        .ok_or_else(unavailable)?;
    if observed.len() != planned.len() {
        return Err(unavailable());
    }
    let gateway = Gateway::from_env()?;
    for credential in planned {
        let matches: Vec<_> = observed
            .iter()
            .filter(|v| v["secretKey"] == credential.key)
            .collect();
        let [expected] = matches.as_slice() else {
            return Err(unavailable());
        };
        let id = projection_id(binding_id, generation, credential.key);
        let reference_digest = collab_bridge::limits::canonical_digest(
            &json!({"locator":credential.reference.locator,
            "version":credential.reference.version,"audience":credential.reference.audience}),
        );
        if expected["projectionId"] != id.to_string()
            || expected["version"] != credential.reference.version
            || expected["header"] != credential.header
            || expected["prefix"] != credential.prefix
            || expected["secretRefDigest"] != reference_digest
        {
            return Err(unavailable());
        }
        let read = state
            .secrets
            .read_audited(&credential.reference, "value")
            .await
            .map_err(|_| unavailable())?;
        state
            .audit
            .verify_secret_reads(&[secret_store::AuditedSecretRead {
                reference: &credential.reference,
                request_id: &read.request_id,
                role_name: &read.role_name,
                not_before,
            }])
            .await
            .map_err(|_| unavailable())?;
        let hash = hex::encode(Sha256::digest(read.value.expose().as_bytes()));
        if expected["sha256"] != hash {
            return Err(unavailable());
        }
        let projected = gateway
            .admin(
                &[
                    "api",
                    "config",
                    "provider-credentials",
                    &tenant.to_string(),
                    &id.to_string(),
                    &credential.reference.version.to_string(),
                ],
                None,
            )
            .await?;
        if projected["sha256"] != hash
            || projected["version"] != credential.reference.version
            || projected["file"]
                != gateway.credential_file(tenant, id, credential.reference.version)?
        {
            return Err(unavailable());
        }
    }
    Ok(())
}

pub(super) async fn retire(conn: &mut PgConnection, ae: &Execution) -> Result<(), Refusal> {
    let rows:Vec<(i64,Value)>=sqlx::query_as("select p.generation,b.secret_refs
        from catalog.application_binding b join projection.application_runtime p on p.binding_id=b.id
        join catalog.component_release r on r.id=p.component_release_id
        where b.id=$1 and b.tenant_id=$2 and b.projection_action_execution_id=$3 and b.state='DISABLING'
          and r.manifest->'executionConnector'->>'mode'='PROTOCOL_PEER'")
        .bind(ae.target_id).bind(ae.tenant_id).bind(ae.id).fetch_all(&mut *conn).await?;
    if rows.is_empty() {
        return Ok(());
    }
    let gateway = Gateway::from_env()?;
    for (generation, refs) in rows {
        for reference in refs.as_array().ok_or_else(unavailable)? {
            let id = projection_id(ae.target_id, generation, text(reference, "secretKey")?);
            let version = reference["version"]
                .as_u64()
                .filter(|v| *v > 0 && *v <= u32::MAX.into())
                .ok_or_else(unavailable)?;
            let tenant = ae.tenant_id.to_string();
            let id = id.to_string();
            let version = version.to_string();
            let path = [
                "api",
                "config",
                "provider-credentials",
                &tenant,
                &id,
                &version,
            ];
            gateway.admin_delete(&path).await?;
            if !gateway.admin(&path, None).await?.is_null() {
                return Err(unavailable());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod credential_tests {
    use super::*;

    fn fixture() -> (Value, Value, Value) {
        let tenant = Uuid::from_u128(1);
        let reference = json!({"secretKey":"native_account","locator":format!("tenants/{tenant}/kv/binding-one"),
            "version":2,"audience":"core"});
        let binding = json!({"bindingId":Uuid::from_u128(2),"tenantId":tenant,
            "servicePrincipalId":Uuid::from_u128(3),"configDigest":"config","isolationMode":"SHARED",
            "secretRefs":[reference]});
        let manifest = json!({"secretSchema":[{"secretKey":"native_account","rotationClass":"SERVICE_CREDENTIAL",
            "deliveryMode":"FILE","valueType":"STRING","restartRequired":false,
            "lengthOrFormat":"{\"type\":\"string\",\"minLength\":1}"}]});
        let mut fact = binding.clone();
        fact.as_object_mut().unwrap().remove("secretRefs");
        fact["credentialGeneration"] = json!(5);
        let mut mapping = reference;
        mapping["header"] = json!("authorization");
        mapping["prefix"] = json!("Bearer ");
        fact["nativeCredentials"] = json!([mapping]);
        (binding, manifest, fact)
    }

    #[test]
    fn conformance_credentials_use_exact_declared_native_reference() {
        let (binding, manifest, fact) = fixture();
        let tenant = uuid(&binding, "tenantId").unwrap();
        let environment = json!({"nativeCredentials":fact["nativeCredentials"]});
        let credentials = conformance_plan(tenant, &manifest, &environment).unwrap();
        assert_eq!(credentials.len(), 1);
        assert_eq!(credentials[0].reference.version, 2);
        assert_eq!(credentials[0].reference.audience, "core");
        assert_eq!(credentials[0].header, "authorization");
        assert_eq!(credentials[0].prefix, "Bearer ");
        assert!(conformance_plan(tenant, &manifest, &json!({})).is_err());
        assert!(conformance_plan(Uuid::from_u128(99), &manifest, &environment).is_err());
        for (field, value) in [
            ("version", json!(0)),
            ("secretKey", json!("undeclared")),
            ("header", json!("cookie")),
            ("prefix", json!("Bearer \r\n")),
        ] {
            let mut wrong = environment.clone();
            wrong["nativeCredentials"][0][field] = value;
            assert!(
                conformance_plan(tenant, &manifest, &wrong).is_err(),
                "{field}"
            );
        }
        // Old public peers remain readable only when their release declares
        // no native secret. An authenticated peer never falls back to this.
        assert!(
            conformance_plan(tenant, &json!({"secretSchema":[]}), &json!({}))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn conformance_uses_gateway_file_auth_and_distinct_projection_scope() {
        let action = Uuid::from_u128(5);
        let scope = Uuid::new_v5(&action, b"component-conformance-credential");
        assert_ne!(
            projection_id(scope, 1, "native_account"),
            projection_id(action, 1, "native_account")
        );
        let observations = json!([{"file":"/fixture/native-credential","header":"authorization","prefix":"Bearer "}]);
        let auth = backend_auth(&observations).unwrap().unwrap();
        assert_eq!(
            auth,
            json!({"credentials":[{"location":{"header":{"name":"authorization","prefix":"Bearer "}},"key":{"file":"/fixture/native-credential"}}]})
        );
        assert!(backend_auth(&json!([{ "header":"authorization", "prefix":"Bearer " }])).is_err());
    }

    #[test]
    fn native_credential_plan_requires_exact_binding_version_and_audience() {
        let (binding, manifest, fact) = fixture();
        assert_eq!(plan(&binding, &manifest, &fact, 5).unwrap().len(), 1);
        for field in [
            "bindingId",
            "tenantId",
            "servicePrincipalId",
            "configDigest",
            "isolationMode",
        ] {
            let mut wrong = fact.clone();
            wrong[field] = json!("another-binding");
            assert!(plan(&binding, &manifest, &wrong, 5).is_err(), "{field}");
        }
        for (field, value) in [
            ("locator", json!("tenants/other/kv/key")),
            ("version", json!(3)),
            ("audience", json!("other-service")),
        ] {
            let mut wrong = fact.clone();
            wrong["nativeCredentials"][0][field] = value;
            assert!(plan(&binding, &manifest, &wrong, 5).is_err(), "{field}");
        }
        assert!(plan(&binding, &manifest, &fact, 6).is_err());
        let mut wrong = fact.clone();
        wrong["workspaceId"] = json!(Uuid::from_u128(4));
        assert!(plan(&binding, &manifest, &wrong, 5).is_err());
        let mut scoped = binding.clone();
        scoped["nativeScopeRef"] = json!("native-account-a");
        let mut other = fact.clone();
        other["nativeScopeRef"] = json!("native-account-b");
        assert!(plan(&scoped, &manifest, &other, 5).is_err());
        let mut wrong = fact.clone();
        wrong["nativeCredentials"] = json!([]);
        assert!(plan(&binding, &manifest, &wrong, 5).is_err());
    }

    #[test]
    fn native_credential_transport_cannot_claim_data_key_or_default_auth() {
        let (binding, manifest, fact) = fixture();
        for (field, value) in [
            ("rotationClass", json!("DATA_KEY")),
            ("deliveryMode", json!("ENV")),
            ("restartRequired", json!(true)),
            ("lengthOrFormat", json!("unparsed-format")),
        ] {
            let mut wrong = manifest.clone();
            wrong["secretSchema"][0][field] = value;
            assert!(plan(&binding, &wrong, &fact, 5).is_err(), "{field}");
        }
        for schema in [
            json!({"type":"string","format":"unknown-native-format"}),
            json!({"type":"string","$ref":"https://unregistered.invalid/schema"}),
            json!({"type":"string","minLength":-1}),
        ] {
            let mut wrong = manifest.clone();
            wrong["secretSchema"][0]["lengthOrFormat"] = json!(schema.to_string());
            assert!(plan(&binding, &wrong, &fact, 5).is_err());
        }
        for header in [
            "cookie",
            "host",
            "mcp-session-id",
            "x-platform-action-execution-id",
            "proxy-authorization",
            "Authorization",
        ] {
            let mut wrong = fact.clone();
            wrong["nativeCredentials"][0]["header"] = json!(header);
            assert!(plan(&binding, &manifest, &wrong, 5).is_err(), "{header}");
        }
        let mut bare = binding.clone();
        bare["secretRefs"] = json!([]);
        let mut bare_fact = fact;
        bare_fact
            .as_object_mut()
            .unwrap()
            .remove("nativeCredentials");
        bare_fact
            .as_object_mut()
            .unwrap()
            .remove("credentialGeneration");
        assert!(plan(&bare, &json!({"secretSchema":[]}), &bare_fact, 5)
            .unwrap()
            .is_empty());
        assert!(backend_auth(&json!([])).unwrap().is_none());
    }

    #[test]
    fn native_file_projection_is_binding_generation_and_key_specific() {
        let binding = Uuid::from_u128(2);
        let id = projection_id(binding, 5, "native_account");
        assert_eq!(id, projection_id(binding, 5, "native_account"));
        assert_ne!(id, projection_id(Uuid::from_u128(3), 5, "native_account"));
        assert_ne!(id, projection_id(binding, 6, "native_account"));
        assert_ne!(id, projection_id(binding, 5, "another_key"));
        let auth=backend_auth(&json!([{"file":"/controlled/tenant.binding.version","header":"authorization","prefix":"Bearer "}])).unwrap().unwrap();
        assert_eq!(
            auth,
            json!({"credentials":[{"location":{"header":{"name":"authorization","prefix":"Bearer "}},
            "key":{"file":"/controlled/tenant.binding.version"}}]})
        );
        assert!(auth.get("passthrough").is_none());
    }
}
