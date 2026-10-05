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

impl Adapter {
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
        let token = if matches!(ae.action_key.as_str(), super::CREATE | super::DISABLE) {
            crate::action_token::issue_binding_management(state, ae, audience, operation, arguments)
                .await?
        } else {
            crate::action_token::issue_application_observation(
                state, ae, audience, operation, arguments,
            )
            .await?
        };
        let origin = text(&self.value, "baseUrl")?.trim_end_matches('/');
        let mut response = self
            .http
            .post(format!("{origin}/platform-adapter/v1/{operation}"))
            .bearer_auth(&token)
            .header("Idempotency-Key", key.to_string())
            .json(arguments)
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
