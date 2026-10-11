//! Core-side transport for the original binding Workflow. Fixed directory
//! references resolve endpoints; neither a BFF payload nor Worker chooses URL,
//! token claims, native instance, scope, or signing key.

use super::*;
use crate::service_api::ServiceState;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Connector {
    RemoteAdapter,
    ProtocolPeer,
}

impl Connector {
    pub(crate) fn from_manifest(manifest: &Value) -> Result<Self, Refusal> {
        let connector = &manifest["executionConnector"];
        match connector["mode"].as_str() {
            Some("REMOTE_ADAPTER")
                if connector["adapterProtocolRange"] == "1"
                    && connector["actionTokenAudience"]
                        .as_str()
                        .is_some_and(|v| !v.is_empty() && v != "NONE") =>
            {
                Ok(Self::RemoteAdapter)
            }
            Some("PROTOCOL_PEER")
                if connector["adapterProtocolRange"] == "NONE"
                    && connector["actionTokenAudience"] == "NONE" =>
            {
                Ok(Self::ProtocolPeer)
            }
            _ => Err(blocked()),
        }
    }

    /// A native MCP return is not evidence of a separately queryable job or
    /// measured usage. Only the approved synchronous contract can use it.
    pub(crate) fn validate_action(self, declaration: &Value) -> Result<(), Refusal> {
        if self == Self::ProtocolPeer {
            let policy = &declaration["businessObservabilityPolicy"];
            if declaration["executionMode"] != "SYNC"
                || declaration["workflowType"] != "NONE"
                || declaration["quotaPolicy"] != "NONE"
                || declaration["meters"] != json!([])
                || policy["terminalSource"] != "SYNC_RESULT"
                || policy["progressSource"] != "NONE"
                || policy["usageSource"] != "NONE"
                || policy["costSource"] != "NONE"
            {
                return Err(blocked());
            }
        }
        Ok(())
    }
}

pub(crate) struct Adapter {
    pub(super) value: Value,
    http: reqwest::Client,
}

/// Binding drainage, including native work without an EE (for
/// example a component's synchronous continuation of a platform permission).
/// The adapter fences its original dedicated native job before observation.
/// Missing/old adapter support must keep DISABLING; never infer an empty set.
pub(crate) async fn reconcile_binding(
    state: &ServiceState,
    ae: &Execution,
) -> Result<Option<Value>, Refusal> {
    let (reference, service, manifest): (Value, String, Value) = sqlx::query_as(
        "select jsonb_build_object('bindingId',b.id,'generation',p.generation,
            'configDigest',b.config_digest,'nativeInstanceRef',b.native_instance_ref,
            'nativeScopeRef',b.native_scope_ref,'idempotencyKey',$4::uuid),b.adapter_service_ref,r.manifest
         from catalog.application_binding b join catalog.component_release r on r.id=b.component_release_id
         join projection.application_runtime p on p.binding_id=b.id and p.component_release_id=b.component_release_id
         where b.id=$1 and b.tenant_id=$2 and b.workspace_id is not distinct from $3
           and b.projection_action_execution_id=$4 and b.state='DISABLING'
           and ((b.active_projection_generation is not null and p.generation=b.active_projection_generation)
             or (b.active_projection_generation is null and p.action_execution_id=b.created_by_action_execution_id))")
        .bind(ae.target_id).bind(ae.tenant_id).bind(ae.workspace_id).bind(ae.id)
        .fetch_one(&state.pool).await?;
    if Connector::from_manifest(&manifest)? == Connector::ProtocolPeer {
        return Ok(None);
    }
    let typed: contracts::AdapterBindingReconcileRequest =
        serde_json::from_value(reference.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(typed).map_err(|_| invalid())? != reference {
        return Err(invalid());
    }
    let adapter = Adapter::resolve(&service, text(&reference, "nativeInstanceRef")?, &manifest)?;
    let result = adapter
        .call(state, ae, "reconcile", ae.id, &reference)
        .await?;
    reconcile_complete(&reference, &result)?;
    Ok(Some(result))
}

pub(super) fn reconcile_complete(reference: &Value, result: &Value) -> Result<bool, Refusal> {
    let parsed: contracts::AdapterBindingReconcileResponse =
        serde_json::from_value(result.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(parsed).map_err(|_| invalid())? != *result
        || result["reference"] != *reference
        || reference["generation"].as_i64().is_none_or(|v| v <= 0)
    {
        return Err(invalid());
    }
    let mut keys = BTreeSet::new();
    let mut complete = result["complete"] == true;
    let now = chrono::Utc::now();
    for item in result["observations"].as_array().ok_or_else(invalid)? {
        let key = text(item, "idempotencyKey")?;
        if Uuid::parse_str(key).map_or(true, |id| id.is_nil())
            || !keys.insert((text(item, "nativeType")?, key))
        {
            return Err(invalid());
        }
        let last = chrono::DateTime::parse_from_rfc3339(text(item, "lastObservedAt")?)
            .map_err(|_| invalid())?;
        // Match the original ExternalExecution observation boundary: a
        // future timestamp is not evidence available to this disable.
        if last > now {
            return Err(invalid());
        }
        if matches!(
            text(item, "platformStatus")?,
            "SUCCEEDED" | "FAILED" | "CANCELLED"
        ) {
            text(item, "nativeId")?;
            text(item, "nativeStatus")?;
            let terminal = chrono::DateTime::parse_from_rfc3339(text(item, "terminalAt")?)
                .map_err(|_| invalid())?;
            if terminal > last {
                return Err(invalid());
            }
        } else {
            if item.get("terminalAt").is_some() {
                return Err(invalid());
            }
            complete = false;
        }
    }
    Ok(complete)
}

impl Adapter {
    pub(crate) fn native_human_identity(
        &self,
        binding: Uuid,
        generation: i64,
        config_digest: &str,
    ) -> Result<Value, Refusal> {
        let rows: Vec<_> = self.value["nativeHumanIdentities"]
            .as_array()
            .ok_or_else(blocked)?
            .iter()
            .filter(|row| row["bindingId"] == json!(binding))
            .collect();
        let [row] = rows.as_slice() else {
            return Err(blocked());
        };
        if row["generation"] != generation || row["configDigest"] != config_digest {
            return Err(blocked());
        }
        Ok((*row).clone())
    }
    /// Same controlled reader registration as binding secrets. These are only
    /// delivery facts: the model lifecycle still verifies the native proof and
    /// the original OpenBao request/response audit pair before activation.
    pub(crate) fn model_reader_delivery(
        &self,
        principal: Uuid,
        binding: Uuid,
    ) -> Result<(Value, Vec<Value>), Refusal> {
        let readers: Vec<_> = self.value["secretReaders"]
            .as_array()
            .ok_or_else(blocked)?
            .iter()
            .filter(|reader| reader["servicePrincipalId"] == json!(principal))
            .collect();
        let [reader] = readers.as_slice() else {
            return Err(blocked());
        };
        text(reader, "roleName")?;
        text(reader, "audience")?;
        let deliveries = self
            .value
            .get("modelCredentialDeliveries")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|delivery| delivery["bindingId"] == json!(binding))
            .cloned()
            .collect();
        Ok(((*reader).clone(), deliveries))
    }

    pub(super) fn mcp_url(&self) -> Result<reqwest::Url, Refusal> {
        let url = reqwest::Url::parse(text(&self.value, "mcpUrl")?).map_err(|_| blocked())?;
        if !matches!(url.scheme(), "https" | "http")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(invalid());
        }
        Ok(url)
    }

    pub(crate) fn resolve(
        reference: &str,
        native_instance: &str,
        manifest: &Value,
    ) -> Result<Self, Refusal> {
        let path = std::env::var("APPLICATION_ADAPTER_DIRECTORY_FILE").map_err(|_| blocked())?;
        let bytes = std::fs::read(path)
            .map_err(|_| Refusal::Unavailable("adapter directory unavailable".into()))?;
        let typed: contracts::ApplicationAdapterDirectory =
            serde_json::from_slice(&bytes).map_err(|_| invalid())?;
        let directory = serde_json::to_value(typed).map_err(|_| invalid())?;
        if serde_json::from_slice::<Value>(&bytes).map_err(|_| invalid())? != directory {
            return Err(invalid());
        }
        let connector = Connector::from_manifest(manifest)?;
        let entries = directory[match connector {
            Connector::RemoteAdapter => "adapters",
            Connector::ProtocolPeer => "protocolPeers",
        }]
        .as_array()
        .ok_or_else(blocked)?;
        let mut refs = BTreeSet::new();
        if directory["adapters"]
            .as_array()
            .ok_or_else(invalid)?
            .iter()
            .chain(
                directory
                    .get("protocolPeers")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten(),
            )
            .any(|entry| {
                text(entry, "adapterServiceRef").is_err()
                    || !refs.insert(entry["adapterServiceRef"].clone().to_string())
            })
        {
            return Err(invalid());
        }
        let value = entries
            .iter()
            .find(|entry| entry["adapterServiceRef"] == reference)
            .cloned()
            .ok_or_else(blocked)?;
        if value["nativeInstanceRef"] != native_instance
            || value["artifactDigest"] != manifest["adapterBuildRef"]
            || (connector == Connector::RemoteAdapter
                && value["actionTokenAudience"]
                    != manifest["executionConnector"]["actionTokenAudience"])
        {
            return Err(blocked());
        }
        let url = reqwest::Url::parse(text(
            &value,
            if connector == Connector::RemoteAdapter {
                "baseUrl"
            } else {
                "mcpUrl"
            },
        )?)
        .map_err(|_| invalid())?;
        if !matches!(url.scheme(), "https" | "http")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || (connector == Connector::RemoteAdapter && url.path() != "/")
            || value["maxResponseBytes"]
                .as_u64()
                .is_none_or(|v| v == 0 || v > usize::MAX as u64)
        {
            return Err(invalid());
        }
        let seconds = value["timeoutSeconds"]
            .as_u64()
            .filter(|v| *v > 0)
            .ok_or_else(invalid)?;
        let http = reqwest::Client::builder()
            .http1_only()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(seconds))
            .build()
            .map_err(|_| Refusal::Unavailable("adapter transport unavailable".into()))?;
        Ok(Self { value, http })
    }

    /// The caller has already committed the original governed lifecycle intent.
    /// An HTTP 2xx is only transport success; the lifecycle validates typed
    /// scope/native observation and its terminal evidence before any projection.
    pub(crate) async fn call(
        &self,
        state: &ServiceState,
        ae: &Execution,
        operation: &str,
        key: Uuid,
        arguments: &Value,
    ) -> Result<Value, Refusal> {
        if arguments["idempotencyKey"] != json!(key) {
            return Err(invalid());
        }
        let audience = text(&self.value, "actionTokenAudience")?;
        let protocol = crate::governance::exact_definition_for_execution(&state.pool, ae)
            .await?
            .execution_mode
            == "PROTOCOL";
        let protocol_launch = operation == "execute" && protocol;
        let token = if matches!(ae.action_key.as_str(), super::CREATE | super::DISABLE) {
            crate::action_token::issue_binding_management(state, ae, audience, operation, arguments)
                .await?
        } else if protocol_launch {
            crate::action_token::issue_protocol_launch(state, ae, audience, arguments).await?
        } else if protocol && matches!(operation, "observe" | "cancel") {
            crate::action_token::issue_protocol_lifecycle(state, ae, audience, operation, arguments)
                .await?
        } else if operation == "query_revision" {
            crate::action_token::issue_query_revision(state, ae, audience, arguments).await?
        } else {
            crate::action_token::issue_application_observation(
                state, ae, audience, operation, arguments,
            )
            .await?
        };
        self.send(
            operation,
            key,
            arguments,
            &token,
            operation == "query_revision" || protocol,
            None,
        )
        .await
    }

    /// The caller has committed the original EE's UNKNOWN dispatch fence.
    /// This does not mint another identity or retry the native execution.
    pub(crate) async fn execute_prepared(
        &self,
        ae: &Execution,
        key: Uuid,
        arguments: &Value,
        token: &str,
    ) -> Result<Value, Refusal> {
        let envelope =
            json!({"idempotencyKey":key,"actionKey":ae.action_key,"arguments":arguments});
        let trace = crate::model_route::application::human_traceparent(ae);
        self.send("execute", key, &envelope, token, false, trace.as_deref())
            .await
    }

    async fn send(
        &self,
        operation: &str,
        key: Uuid,
        arguments: &Value,
        token: &str,
        canonical_body: bool,
        traceparent: Option<&str>,
    ) -> Result<Value, Refusal> {
        let origin = text(&self.value, "baseUrl")?.trim_end_matches('/');
        let request = self
            .http
            .post(format!("{origin}/platform-adapter/v1/{operation}"))
            .bearer_auth(token)
            .header("Idempotency-Key", key.to_string());
        let request = if let Some(traceparent) = traceparent {
            request.header("traceparent", traceparent)
        } else {
            request
        };
        // The revision endpoint compares exactly the same bytes used in the
        // signed parameter hash; no parallel serializer or target envelope.
        let request = if canonical_body {
            request
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(collab_bridge::limits::canonical_json(arguments))
        } else {
            request.json(arguments)
        };
        let mut response = request
            .send()
            .await
            .map_err(|_| Refusal::Unavailable("adapter response unknown".into()))?;
        if !response.status().is_success() {
            return Err(Refusal::Unavailable(
                "adapter did not supply a verifiable observation".into(),
            ));
        }
        let limit = self.value["maxResponseBytes"]
            .as_u64()
            .ok_or_else(invalid)?;
        if response
            .content_length()
            .is_some_and(|length| length > limit)
        {
            return Err(Refusal::Unavailable(
                "adapter response exceeds delivered limit".into(),
            ));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| Refusal::Unavailable("adapter response incomplete".into()))?
        {
            if body
                .len()
                .checked_add(chunk.len())
                .is_none_or(|length| length as u64 > limit)
            {
                return Err(Refusal::Unavailable(
                    "adapter response exceeds delivered limit".into(),
                ));
            }
            body.extend_from_slice(&chunk);
        }
        if body
            .windows(token.len())
            .any(|window| window == token.as_bytes())
        {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
        serde_json::from_slice(&body)
            .map_err(|_| Refusal::Unavailable("adapter observation malformed".into()))
    }
}

/// Native validation is read-only. Its stable keys were committed in the
/// original projection before transport; lost responses repeat validation of
/// that exact candidate, never create another native scope or default tenant.
pub(super) async fn validate(
    state: &ServiceState,
    ae: &Execution,
    binding: &Value,
    manifest: &Value,
    keys: &Value,
) -> Result<Value, Refusal> {
    if Connector::from_manifest(manifest)? == Connector::ProtocolPeer {
        return peer::validate(state, ae, binding, manifest).await;
    }
    let adapter = Adapter::resolve(
        text(binding, "adapterServiceRef")?,
        text(binding, "nativeInstanceRef")?,
        manifest,
    )?;
    let handshake_key = uuid(keys, "handshake")?;
    let handshake=adapter.call(state,ae,"handshake",handshake_key,&json!({
        "idempotencyKey":handshake_key,"componentReleaseId":binding["componentReleaseId"],
        "componentTypeKey":manifest["componentTypeKey"],"protocolRange":manifest["adapterProtocolRange"]})).await?;
    if handshake["protocolVersion"] != "1"
        || handshake["artifactDigest"] != manifest["adapterBuildRef"]
    {
        return Err(blocked());
    }
    let key = uuid(keys, "validate_binding")?;
    let mut args = binding.clone();
    args["idempotencyKey"] = json!(key);
    let observed = adapter
        .call(state, ae, "validate_binding", key, &args)
        .await?;
    let parsed: contracts::AdapterBindingObservation =
        serde_json::from_value(observed.clone()).map_err(|_| invalid())?;
    let validated = serde_json::to_value(parsed).map_err(|_| invalid())?;
    if validated != observed
        || observed["bindingId"] != binding["bindingId"]
        || observed["tenantId"] != binding["tenantId"]
        || observed.get("workspaceId") != binding.get("workspaceId")
        || observed["nativeInstanceRef"] != binding["nativeInstanceRef"]
        || observed["isolationMode"] != binding["isolationMode"]
        || observed["configDigest"] != binding["configDigest"]
        || observed["artifactDigest"] != manifest["adapterBuildRef"]
        || observed["secretRefDigest"]
            != collab_bridge::limits::canonical_digest(&binding["secretRefs"])
        || binding
            .get("nativeScopeRef")
            .is_some_and(|expected| *expected != observed["nativeScopeRef"])
        || text(&observed, "nativeScopeRef").is_err()
    {
        return Err(Refusal::Precondition(ReasonCode::ProjectionDelayed));
    }
    let mappings = observed["executionMappings"]
        .as_array()
        .ok_or_else(invalid)?;
    let actions = manifest["actionDefinitions"]
        .as_array()
        .ok_or_else(invalid)?;
    if mappings.len() != actions.len() {
        return Err(blocked());
    }
    let mut mapped = BTreeSet::new();
    for mapping in mappings {
        let key = text(mapping, "actionKey")?;
        let version = mapping["actionVersion"]
            .as_i64()
            .filter(|v| *v > 0)
            .ok_or_else(invalid)?;
        if !mapped.insert((key, version))
            || text(mapping, "nativeType").is_err()
            || !actions
                .iter()
                .any(|a| a["actionKey"] == key && a["version"] == version)
        {
            return Err(blocked());
        }
        let (category, _) = key.split_once('.').ok_or_else(invalid)?;
        let category = manifest["capabilityDeclarations"]
            .as_array()
            .ok_or_else(invalid)?
            .iter()
            .find(|entry| entry["categoryKey"] == category)
            .ok_or_else(blocked)?;
        if mapping["cancelCapability"] == "SUPPORTED" && category["cancel"] != "SUPPORTED" {
            return Err(blocked());
        }
    }
    let refs = binding["secretRefs"].as_array().ok_or_else(invalid)?;
    let reads = observed["secretReads"].as_array().ok_or_else(invalid)?;
    if refs.len() != reads.len() {
        return Err(Refusal::Precondition(ReasonCode::ProjectionDelayed));
    }
    let directory = adapter.value["secretReaders"]
        .as_array()
        .ok_or_else(invalid)?;
    let mut matched = BTreeSet::new();
    let mut expected = Vec::new();
    for reference in refs {
        let key = text(reference, "secretKey")?;
        let read = reads
            .iter()
            .find(|read| read["secretKey"] == key)
            .ok_or_else(invalid)?;
        if !matched.insert(key)
            || read["version"] != reference["version"]
            || read["audience"] != reference["audience"]
        {
            return Err(Refusal::Precondition(ReasonCode::ProjectionDelayed));
        }
        let readers: Vec<_> = directory
            .iter()
            .filter(|reader| {
                reader["servicePrincipalId"] == binding["servicePrincipalId"]
                    && reader["audience"] == reference["audience"]
            })
            .collect();
        if readers.len() != 1 {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
        expected.push((
            secret_store::SecretRef {
                locator: text(reference, "locator")?.into(),
                version: u32::try_from(reference["version"].as_u64().ok_or_else(invalid)?)
                    .map_err(|_| invalid())?,
                audience: text(reference, "audience")?.into(),
            },
            text(read, "requestId")?,
            text(readers[0], "roleName")?,
        ));
    }
    let expected: Vec<_> = expected
        .iter()
        .map(
            |(reference, request_id, role_name)| secret_store::AuditedSecretRead {
                reference,
                request_id,
                role_name,
                not_before: ae.updated_at,
            },
        )
        .collect();
    state
        .audit
        .verify_secret_reads(&expected)
        .await
        .map_err(|_| Refusal::Unavailable("binding secret read audit unavailable".into()))?;
    Ok(observed)
}

#[cfg(test)]
mod binding_reconcile_tests {
    use super::*;

    #[test]
    fn native_binding_reconcile_requires_complete_exact_terminal_evidence() {
        let reference = json!({"bindingId":Uuid::new_v4(),"generation":2,
            "configDigest":"a".repeat(64),"nativeInstanceRef":"native","nativeScopeRef":"scope","idempotencyKey":Uuid::new_v4()});
        let terminal = json!({"idempotencyKey":Uuid::new_v4(),"nativeType":"job","nativeId":"original-task",
            "nativeStatus":"Finished","platformStatus":"SUCCEEDED","cancelCapability":"UNSUPPORTED",
            "lastObservedAt":"2026-10-10T00:00:01Z","terminalAt":"2026-10-10T00:00:00Z"});
        let baseline = json!({"reference":reference,"complete":true,"observations":[terminal]});
        assert!(reconcile_complete(&reference, &baseline).unwrap());
        for scenario in [
            "incomplete",
            "unknown",
            "wrong-generation",
            "duplicate",
            "missing-terminal",
            "future-terminal",
            "future-observation",
            "future-unknown-observation",
            "extra",
        ] {
            let mut result = baseline.clone();
            match scenario {
                "incomplete" => result["complete"] = json!(false),
                "unknown" => {
                    result["observations"][0]["platformStatus"] = json!("UNKNOWN");
                    result["observations"][0]
                        .as_object_mut()
                        .unwrap()
                        .remove("terminalAt");
                }
                "wrong-generation" => result["reference"]["generation"] = json!(1),
                "duplicate" => result["observations"]
                    .as_array_mut()
                    .unwrap()
                    .push(terminal.clone()),
                "missing-terminal" => {
                    result["observations"][0]
                        .as_object_mut()
                        .unwrap()
                        .remove("terminalAt");
                }
                "future-terminal" => {
                    result["observations"][0]["terminalAt"] = json!("2026-10-11T00:00:00Z")
                }
                "future-observation" | "future-unknown-observation" => {
                    let future = (chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339();
                    result["observations"][0]["lastObservedAt"] = json!(future);
                    result["observations"][0]["terminalAt"] = json!(future);
                    if scenario == "future-unknown-observation" {
                        result["observations"][0]["platformStatus"] = json!("UNKNOWN");
                        result["observations"][0]
                            .as_object_mut()
                            .unwrap()
                            .remove("terminalAt");
                    }
                }
                "extra" => result["drained"] = json!(true),
                _ => unreachable!(),
            }
            let outcome = reconcile_complete(&reference, &result);
            if matches!(
                scenario,
                "future-observation" | "future-unknown-observation"
            ) {
                assert!(outcome.is_err(), "{scenario}");
            } else {
                assert!(!matches!(outcome, Ok(true)), "{scenario}");
            }
        }
    }
}
