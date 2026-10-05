//! DD-105 / SS-AGW-02: the original ExtMcp two-phase policy consumer.
//! Session JWT supplies identity only. Admission and disclosure both resolve
//! the original live Invocation, ToolBinding, Delegation and Memory authority.

use std::sync::Arc;

use rmcp::model::{CallToolRequestParams, CallToolResult, ListToolsResult};
use serde_json::{json, Value};
use tonic::{Request, Response, Status};
use uuid::Uuid;

use crate::{
    agent_tool_mcp::{self, wire},
    agent_tool_session::SessionSigner,
    governance::Refusal,
    service_api::ServiceState,
    service_auth::GatewayServiceAuth,
};

#[derive(Clone)]
pub(crate) struct Policy {
    state: ServiceState,
    sessions: Arc<SessionSigner>,
    service: Arc<GatewayServiceAuth>,
}

impl Policy {
    pub(crate) fn new(
        state: ServiceState,
        sessions: Arc<SessionSigner>,
        service: Arc<GatewayServiceAuth>,
    ) -> Self {
        Self {
            state,
            sessions,
            service,
        }
    }

    async fn authenticate<T>(&self, request: &Request<T>) -> Result<(), Status> {
        let mut values = request.metadata().get_all("authorization").iter();
        let value = values
            .next()
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| Status::unauthenticated("SERVICE_AUTH_REQUIRED"))?;
        if values.next().is_some() {
            return Err(Status::unauthenticated("SERVICE_AUTH_REQUIRED"));
        }
        self.service
            .verify(Some(value))
            .await
            .map_err(|error| match error {
                crate::service_auth::ServiceAuthError::KeysUnavailable => {
                    Status::unavailable("DEPENDENCY_UNAVAILABLE")
                }
                _ => Status::unauthenticated("SERVICE_AUTH_REQUIRED"),
            })?;
        Ok(())
    }

    async fn invocation(
        &self,
        authorization: &str,
        services: &[String],
        calling: bool,
    ) -> Result<(Uuid, Option<(Uuid, i64)>), Refusal> {
        let token = authorization
            .strip_prefix("Bearer ")
            .filter(|v| !v.is_empty())
            .ok_or_else(denied)?;
        let session = self.sessions.verify(token).map_err(|_| denied())?;
        let expected = target_name(
            session.scope.installation_resource_id,
            session.scope.projection_generation,
        );
        let invocation =
            crate::agent_tool::session_invocation(&self.state, &session.scope, calling).await?;
        if services == [expected] {
            return Ok((invocation, None));
        }
        let tools = crate::application_tool::request_tools(&self.state, invocation).await?;
        for tool in tools {
            if services
                == [crate::application_binding::gateway::target(
                    tool.binding_id,
                    tool.generation,
                )]
            {
                let mut conn = self.state.pool.acquire().await?;
                crate::application_binding::credentials::require_live(
                    &self.state,
                    &mut conn,
                    tool.binding_id,
                    tool.generation,
                )
                .await?;
                return Ok((invocation, Some((tool.binding_id, tool.generation))));
            }
        }
        Err(denied())
    }

    async fn request(&self, request: &wire::McpRequest) -> Result<wire::McpRequestResult, Refusal> {
        let authorization = session_header(&request.headers)?;
        let validation: Vec<_> = request
            .headers
            .iter()
            .filter(|header| {
                header
                    .key
                    .eq_ignore_ascii_case(crate::application_binding::peer::HEADER)
            })
            .collect();
        if !validation.is_empty() {
            let [header] = validation.as_slice() else {
                return Err(denied());
            };
            let action =
                Uuid::parse_str(std::str::from_utf8(&header.value).map_err(|_| invalid())?)
                    .map_err(|_| invalid())?;
            let probe = optional_header(
                &request.headers,
                crate::application_binding::peer::PROBE_HEADER,
            )?;
            let run = optional_header(
                &request.headers,
                crate::application_binding::peer::RUN_HEADER,
            )?;
            if let Some(index) = probe {
                crate::component_release::peer::authorize(
                    &self.state,
                    authorization,
                    crate::component_release::peer::Probe {
                        action,
                        index: index.parse().map_err(|_| invalid())?,
                        run: run.ok_or_else(invalid)?,
                    },
                    &request.service_names,
                    &request.method,
                    request.mcp_request.as_deref(),
                    false,
                )
                .await?;
            } else {
                if run.is_some() {
                    return Err(invalid());
                }
                crate::application_binding::peer::authorize(
                    &self.state,
                    authorization,
                    action,
                    &request.service_names,
                    &request.method,
                )
                .await?;
            }
            if request.method == "tools/list"
                && request
                    .mcp_request
                    .as_deref()
                    .map(|bytes| {
                        serde_json::from_slice::<Value>(bytes).map(|value| value != json!({}))
                    })
                    .transpose()
                    .map_err(|_| invalid())?
                    .unwrap_or(false)
            {
                return Err(invalid());
            }
            return Ok(wire::McpRequestResult {
                result: Some(wire::mcp_request_result::Result::Pass(wire::Pass {})),
                header_mutation: Some(wire::HeaderMutation {
                    set: Vec::new(),
                    remove: vec![
                        "authorization".into(),
                        "cookie".into(),
                        "proxy-authorization".into(),
                        "idempotency-key".into(),
                        crate::application_binding::peer::HEADER.into(),
                        crate::application_binding::peer::PROBE_HEADER.into(),
                        crate::application_binding::peer::RUN_HEADER.into(),
                        agent_tool_mcp::ACTION_HEADER.into(),
                        agent_tool_mcp::OPERATION_HEADER.into(),
                        agent_tool_mcp::INVOCATION_HEADER.into(),
                    ],
                }),
                metadata: Some(
                    serde_json::from_value(
                        json!({"managementAction":action,"managementBearer":authorization,
                    "probeIndex":probe.unwrap_or(""),"probeRun":run.unwrap_or("")}),
                    )
                    .map_err(|_| invalid())?,
                ),
            });
        }
        let calling = request.method == "tools/call";
        let (invocation, application) = self
            .invocation(authorization, &request.service_names, calling)
            .await?;
        let mut metadata = json!({"invocationId":invocation,"session":authorization});
        let mut normalized_request = None;
        let mut peer_call = false;
        let mut set = vec![wire::McpHeader {
            key: agent_tool_mcp::INVOCATION_HEADER.into(),
            value: invocation.to_string().into_bytes(),
        }];
        match request.method.as_str() {
            "initialize" | "ping" | "notifications/initialized" => {}
            "tools/list" => {
                // This is also checked by the private MCP reader, and again
                // on CheckResponse; an authenticated backend is not a list grant.
                if application.is_none() {
                    crate::agent_tool::invocation_tools(&self.state, invocation).await?;
                }
                let params = request
                    .mcp_request
                    .as_deref()
                    .map(serde_json::from_slice::<Value>)
                    .transpose()
                    .map_err(|_| invalid())?
                    .unwrap_or_else(|| json!({}));
                if !params.as_object().is_some_and(|params| params.is_empty()) {
                    return Err(invalid());
                }
            }
            "tools/call" => {
                let (call, normalized) =
                    tool_call_params(request.mcp_request.as_deref().ok_or_else(invalid)?)?;
                normalized_request = Some(normalized);
                let arguments = call
                    .arguments
                    .map(Value::Object)
                    .unwrap_or_else(|| json!({}));
                let child = if let Some((binding, generation)) = application {
                    let child = crate::application_tool::prepare(
                        &self.state,
                        invocation,
                        binding,
                        generation,
                        &call.name,
                        &arguments,
                    )
                    .await?;
                    let dispatch = crate::application_tool::dispatch(
                        &self.state,
                        invocation,
                        &child,
                        &arguments,
                    )
                    .await?;
                    normalized_request = Some(
                        serde_json::to_vec(
                            &json!({"name":call.name,"arguments":arguments["input"]}),
                        )
                        .map_err(|_| invalid())?,
                    );
                    match dispatch {
                        crate::application_tool::Dispatch::Adapter {
                            external,
                            key,
                            token,
                        } => {
                            metadata["externalExecutionId"] = json!(external);
                            set.extend([
                                wire::McpHeader {
                                    key: "authorization".into(),
                                    value: format!("Bearer {token}").into_bytes(),
                                },
                                wire::McpHeader {
                                    key: "idempotency-key".into(),
                                    value: key.to_string().into_bytes(),
                                },
                            ]);
                        }
                        crate::application_tool::Dispatch::Peer => {
                            peer_call = true;
                        }
                    }
                    child
                } else {
                    crate::agent_memory::tool_arguments(&call.name, &arguments)?;
                    crate::agent_memory::prepare_tool_read(
                        &self.state,
                        invocation,
                        &call.name,
                        &arguments,
                    )
                    .await?
                };
                metadata["childAE"] = json!(child.id);
                metadata["operationId"] = json!(child.operation_id);
                metadata["toolName"] = json!(call.name);
                set.extend([
                    wire::McpHeader {
                        key: agent_tool_mcp::ACTION_HEADER.into(),
                        value: child.id.to_string().into_bytes(),
                    },
                    wire::McpHeader {
                        key: agent_tool_mcp::OPERATION_HEADER.into(),
                        value: child.operation_id.to_string().into_bytes(),
                    },
                ]);
            }
            _ => return Err(invalid()),
        }
        let mut headers = reference_headers(set, calling);
        if application.is_some() && (!calling || peer_call) {
            headers.remove.extend([
                "authorization".into(),
                "cookie".into(),
                "proxy-authorization".into(),
                "idempotency-key".into(),
            ]);
        }
        if peer_call {
            headers.set.clear();
            headers.remove.extend([
                agent_tool_mcp::ACTION_HEADER.into(),
                agent_tool_mcp::OPERATION_HEADER.into(),
                agent_tool_mcp::INVOCATION_HEADER.into(),
            ]);
        }
        Ok(wire::McpRequestResult {
            result: Some(match normalized_request {
                Some(params) => wire::mcp_request_result::Result::Mutated(params),
                None => wire::mcp_request_result::Result::Pass(wire::Pass {}),
            }),
            // Native apply_header_mutation overwrites SET values first and
            // removes afterwards. Never also remove a freshly derived SET.
            header_mutation: Some(headers),
            metadata: Some(serde_json::from_value(metadata).map_err(|_| invalid())?),
        })
    }

    async fn response(
        &self,
        response: &wire::McpResponse,
    ) -> Result<wire::McpResponseResult, Refusal> {
        let metadata: Value = response
            .metadata_context
            .clone()
            .map(serde_json::to_value)
            .transpose()
            .map_err(|_| invalid())?
            .ok_or_else(invalid)?;
        if metadata["managementAction"]
            .as_str()
            .is_some_and(|value| !value.is_empty())
        {
            let bearer = metadata["managementBearer"].as_str().ok_or_else(denied)?;
            if let Some(index) = metadata["probeIndex"]
                .as_str()
                .filter(|index| !index.is_empty())
            {
                crate::component_release::peer::authorize(
                    &self.state,
                    bearer,
                    crate::component_release::peer::Probe {
                        action: uuid(&metadata, "managementAction")?,
                        index: index.parse().map_err(|_| invalid())?,
                        run: metadata["probeRun"].as_str().ok_or_else(invalid)?,
                    },
                    &response.service_names,
                    &response.method,
                    None,
                    true,
                )
                .await?;
            } else {
                crate::application_binding::peer::authorize(
                    &self.state,
                    bearer,
                    uuid(&metadata, "managementAction")?,
                    &response.service_names,
                    &response.method,
                )
                .await?;
            }
            if response.method == "tools/list" {
                let _: ListToolsResult =
                    serde_json::from_slice(&response.mcp_response).map_err(|_| invalid())?;
            }
            return Ok(wire::McpResponseResult {
                result: Some(wire::mcp_response_result::Result::Pass(wire::Pass {})),
            });
        }
        if response.method == "tools/call" {
            let result: CallToolResult =
                serde_json::from_slice(&response.mcp_response).map_err(|_| invalid())?;
            // Only APPLICATION callbacks carry a route-specific native target.
            // Original Core Memory has no APPLICATION child and keeps its path.
            if response
                .service_names
                .iter()
                .any(|name| name.starts_with("application-"))
            {
                crate::application_tool::record_peer_result(
                    &self.state,
                    uuid(&metadata, "invocationId")?,
                    uuid(&metadata, "childAE")?,
                    uuid(&metadata, "operationId")?,
                    metadata["toolName"].as_str().ok_or_else(invalid)?,
                    &response.service_names,
                    &result,
                )
                .await?;
            }
        }
        let authorization = metadata["session"].as_str().ok_or_else(denied)?;
        let (invocation, application) = self
            .invocation(
                authorization,
                &response.service_names,
                response.method == "tools/call",
            )
            .await?;
        if uuid(&metadata, "invocationId")? != invocation {
            return Err(denied());
        }
        match response.method.as_str() {
            "tools/list" => {
                let raw: Value =
                    serde_json::from_slice(&response.mcp_response).map_err(|_| invalid())?;
                if let Some((binding, generation)) = application {
                    let value = crate::application_tool::list(
                        &self.state,
                        invocation,
                        binding,
                        generation,
                        &raw,
                    )
                    .await?;
                    return Ok(mutated(serde_json::to_vec(&value).map_err(|_| invalid())?));
                }
                let result: ListToolsResult =
                    serde_json::from_value(raw.clone()).map_err(|_| invalid())?;
                if result.next_cursor.is_some() {
                    return Err(invalid());
                }
                let names = crate::agent_tool::invocation_tools(&self.state, invocation).await?;
                let mut allowed = Vec::new();
                let mut seen = std::collections::HashSet::new();
                for tool in result.tools {
                    if !seen.insert(tool.name.to_string()) {
                        return Err(invalid());
                    }
                    let original =
                        agent_tool_mcp::schema_tool(&tool.name).map_err(|_| invalid())?;
                    if serde_json::to_value(&original).map_err(|_| invalid())?
                        != serde_json::to_value(&tool).map_err(|_| invalid())?
                    {
                        return Err(invalid());
                    }
                    if names.iter().any(|name| name == tool.name.as_ref()) {
                        allowed.push(original);
                    }
                }
                let filtered = ListToolsResult {
                    tools: allowed,
                    ..Default::default()
                };
                self.sessions
                    .verify(authorization.strip_prefix("Bearer ").ok_or_else(denied)?)
                    .map_err(|_| denied())?;
                Ok(mutated(
                    serde_json::to_vec(&filtered).map_err(|_| invalid())?,
                ))
            }
            "tools/call" => {
                let child = uuid(&metadata, "childAE")?;
                let operation = uuid(&metadata, "operationId")?;
                let name = metadata["toolName"].as_str().ok_or_else(invalid)?;
                let raw: Value =
                    serde_json::from_slice(&response.mcp_response).map_err(|_| invalid())?;
                let result: CallToolResult =
                    serde_json::from_value(raw.clone()).map_err(|_| invalid())?;
                let disclosed = if application.is_some() {
                    crate::application_tool::disclose(
                        &self.state,
                        invocation,
                        child,
                        metadata
                            .get("externalExecutionId")
                            .map(|_| uuid(&metadata, "externalExecutionId"))
                            .transpose()?,
                        operation,
                        name,
                        &result,
                    )
                    .await?
                } else {
                    if result.is_error == Some(true) {
                        return Err(invalid());
                    }
                    let value = result.structured_content.as_ref().ok_or_else(invalid)?;
                    normalize_disclosed_result(&raw, value.clone(), false)?;
                    crate::agent_memory::disclose_tool_result(
                        &self.state,
                        invocation,
                        child,
                        operation,
                        name,
                        value,
                    )
                    .await?;
                    value.clone()
                };
                self.sessions
                    .verify(authorization.strip_prefix("Bearer ").ok_or_else(denied)?)
                    .map_err(|_| denied())?;
                Ok(mutated(
                    serde_json::to_vec(&normalize_disclosed_result(
                        &raw,
                        disclosed,
                        application.is_some(),
                    )?)
                    .map_err(|_| invalid())?,
                ))
            }
            "initialize" | "ping" => Ok(wire::McpResponseResult {
                result: Some(wire::mcp_response_result::Result::Pass(wire::Pass {})),
            }),
            _ => Err(invalid()),
        }
    }
}

fn normalize_disclosed_result(
    raw: &Value,
    disclosed: Value,
    application: bool,
) -> Result<CallToolResult, Refusal> {
    let normalized = if application {
        match disclosed {
            // Legacy native tools return a string as a TextContent block, not
            // structuredContent (whose protocol shape is an object). Preserve
            // only that already schema-checked text; never forward raw blocks.
            Value::String(text) => {
                CallToolResult::success(vec![rmcp::model::ContentBlock::text(text)])
            }
            value => CallToolResult::structured(value),
        }
    } else {
        CallToolResult::structured(disclosed)
    };
    // Core's own Memory endpoint keeps its exact SDK encoding invariant.
    // APPLICATION content is reconstructed solely from the validated business
    // value: upstream text/images/links and execution metadata are not exposed.
    if !application
        && raw.get("content")
            != serde_json::to_value(&normalized)
                .map_err(|_| invalid())?
                .get("content")
    {
        return Err(invalid());
    }
    Ok(normalized)
}

pub(crate) fn target_name(installation: Uuid, generation: i64) -> String {
    format!("platform-{installation}-{generation}")
}

fn reference_headers(set: Vec<wire::McpHeader>, calling: bool) -> wire::HeaderMutation {
    wire::HeaderMutation {
        set,
        remove: if calling {
            Vec::new()
        } else {
            vec![
                agent_tool_mcp::ACTION_HEADER.into(),
                agent_tool_mcp::OPERATION_HEADER.into(),
            ]
        },
    }
}

fn session_header(headers: &[wire::McpHeader]) -> Result<&str, Refusal> {
    let mut values = headers
        .iter()
        .filter(|header| header.key.eq_ignore_ascii_case("authorization"));
    let value = values.next().ok_or_else(denied)?;
    if values.next().is_some() {
        return Err(denied());
    }
    std::str::from_utf8(&value.value).map_err(|_| denied())
}

fn optional_header<'a>(
    headers: &'a [wire::McpHeader],
    name: &str,
) -> Result<Option<&'a str>, Refusal> {
    let mut values = headers
        .iter()
        .filter(|header| header.key.eq_ignore_ascii_case(name));
    let value = values
        .next()
        .map(|header| std::str::from_utf8(&header.value).map_err(|_| invalid()))
        .transpose()?;
    if values.next().is_some() {
        return Err(invalid());
    }
    Ok(value)
}

/// The pinned Codex client emits trace metadata separately from model arguments.
/// It is never an identity, target, operation or idempotency authority. Validate
/// its native shape, then remove it before the native upstream sees params.
/// The original tonic request-size limit bounds these bytes before JSON parsing.
fn tool_call_params(bytes: &[u8]) -> Result<(CallToolRequestParams, Vec<u8>), Refusal> {
    let mut raw: Value = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    let params = raw.as_object_mut().ok_or_else(invalid)?;
    if params
        .keys()
        .any(|key| !matches!(key.as_str(), "name" | "arguments" | "_meta"))
    {
        return Err(invalid());
    }
    if let Some(meta) = params.remove("_meta") {
        let meta = meta.as_object().ok_or_else(invalid)?;
        for (key, value) in meta {
            let valid = match key.as_str() {
                "callId"
                | "threadId"
                | "sessionId"
                | "windowId"
                | "itemId"
                | "codex_bridge_mcp_call_id" => value.as_str().is_some_and(|v| !v.is_empty()),
                "x-codex-turn-metadata" => codex_turn_metadata(value),
                _ => false,
            };
            if !valid {
                return Err(invalid());
            }
        }
    }
    let call = serde_json::from_value(raw.clone()).map_err(|_| invalid())?;
    Ok((call, serde_json::to_vec(&raw).map_err(|_| invalid())?))
}

fn codex_turn_metadata(value: &Value) -> bool {
    let Some(fields) = value.as_object() else {
        return false;
    };
    fields.iter().all(|(key, value)| match key.as_str() {
        "installation_id"
        | "session_id"
        | "thread_id"
        | "turn_id"
        | "window_id"
        | "context_window_id"
        | "forked_from_thread_id"
        | "parent_thread_id"
        | "subagent_kind"
        | "thread_source"
        | "turn_trigger"
        | "sandbox"
        | "sandbox_mode"
        | "model"
        | "codex_version"
        | "reasoning_effort"
        | "workspace_kind" => value.is_string(),
        "auto_review_enabled"
        | "node_repl_auto_review_required"
        | "node_repl_disabled"
        | "user_input_requested_during_turn"
        | "history_ingest_requested"
        | "analytics_enabled" => value.is_boolean(),
        "window_number" | "forked_from_ordinal_exclusive" => value.as_u64().is_some(),
        "turn_started_at_unix_ms" => value.as_i64().is_some(),
        // SERVER_CODEX has no environments or host workspace. Unknown nested
        // objects cannot smuggle authorization facts through a trace field.
        "workspaces" => value.as_object().is_some_and(|v| v.is_empty()),
        _ => false,
    })
}

fn uuid(value: &Value, key: &str) -> Result<Uuid, Refusal> {
    let raw = value[key].as_str().ok_or_else(denied)?;
    let id = Uuid::parse_str(raw).map_err(|_| denied())?;
    if id.is_nil() || id.to_string() != raw {
        return Err(denied());
    }
    Ok(id)
}

fn denied() -> Refusal {
    Refusal::Denied(contracts::ReasonCode::PermissionDenied)
}
fn invalid() -> Refusal {
    Refusal::Precondition(contracts::ReasonCode::InvalidParameters)
}

fn error(error: Refusal) -> wire::AuthorizationError {
    let code = match error {
        Refusal::Unavailable(_) => wire::authorization_error::Code::Unknown,
        Refusal::Precondition(_) => wire::authorization_error::Code::Invalid,
        _ => wire::authorization_error::Code::PermissionDenied,
    };
    wire::AuthorizationError {
        code: code as i32,
        reason: if code == wire::authorization_error::Code::Unknown {
            "DEPENDENCY_UNAVAILABLE".into()
        } else {
            "TOOL_REJECTED".into()
        },
        mcp_error: None,
    }
}

fn mutated(bytes: Vec<u8>) -> wire::McpResponseResult {
    wire::McpResponseResult {
        result: Some(wire::mcp_response_result::Result::Mutated(bytes)),
    }
}

#[tonic::async_trait]
impl wire::ext_mcp_server::ExtMcp for Policy {
    async fn check_request(
        &self,
        request: Request<wire::McpRequest>,
    ) -> Result<Response<wire::McpRequestResult>, Status> {
        self.authenticate(&request).await?;
        let result = self
            .request(request.get_ref())
            .await
            .unwrap_or_else(|refusal| wire::McpRequestResult {
                result: Some(wire::mcp_request_result::Result::Error(error(refusal))),
                header_mutation: None,
                metadata: None,
            });
        Ok(Response::new(result))
    }

    async fn check_response(
        &self,
        response: Request<wire::McpResponse>,
    ) -> Result<Response<wire::McpResponseResult>, Status> {
        self.authenticate(&response).await?;
        let result = self
            .response(response.get_ref())
            .await
            .unwrap_or_else(|refusal| wire::McpResponseResult {
                result: Some(wire::mcp_response_result::Result::Error(error(refusal))),
            });
        Ok(Response::new(result))
    }
}

#[cfg(test)]
mod tool_pep_tests {
    use super::*;

    #[test]
    fn response_reconstruction_uses_disclosed_value_not_upstream_envelope() {
        let business = json!({"answer":"allowed"});
        let raw = json!({"structuredContent":{
            "execution":{"nativeId":"private-native-id"},
            "resultJson":"{\"answer\":\"allowed\"}"},
            "content":[{"type":"text","text":"unvalidated text"}],
            "_meta":{"private":"not-for-disclosure"}});
        let result = normalize_disclosed_result(&raw, business.clone(), true).unwrap();
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::to_value(CallToolResult::structured(business.clone())).unwrap()
        );
        let memory = serde_json::to_value(CallToolResult::structured(business.clone())).unwrap();
        assert!(normalize_disclosed_result(&memory, business.clone(), false).is_ok());
        assert!(normalize_disclosed_result(&raw, business, false).is_err());
        let native = normalize_disclosed_result(&raw, json!("native result"), true).unwrap();
        assert!(native.structured_content.is_none());
        assert_eq!(native.content.len(), 1);
        assert_eq!(native.content[0].as_text().unwrap().text, "native result");
    }

    #[test]
    fn pinned_codex_metadata_is_validated_then_removed_not_used_as_authority() {
        let arguments = json!({"entryId":"mem/example"});
        let wire = json!({"name":"agent.memory.entry.read","arguments":arguments,"_meta":{
            "callId":"call-native","threadId":"thread-native","sessionId":"session-native",
            "windowId":"window-native","itemId":"item-native","codex_bridge_mcp_call_id":"trace-native",
            "x-codex-turn-metadata":{"session_id":"session-native","thread_id":"thread-native",
                "turn_id":"turn-native","thread_source":"user","codex_version":"fixed",
                "model":"fixture","reasoning_effort":"low","node_repl_disabled":true,
                "node_repl_auto_review_required":false,"auto_review_enabled":false,
                "turn_started_at_unix_ms":1}}});
        let (call, forwarded) = tool_call_params(&serde_json::to_vec(&wire).unwrap()).unwrap();
        assert_eq!(
            call.arguments.unwrap(),
            arguments.as_object().unwrap().clone()
        );
        assert_eq!(
            serde_json::from_slice::<Value>(&forwarded).unwrap(),
            json!({"name":"agent.memory.entry.read","arguments":arguments})
        );
        for field in [
            "actionExecutionId",
            "operationId",
            "target",
            "actorPrincipalId",
            "tenantId",
        ] {
            let mut forged = wire.clone();
            forged["_meta"][field] = json!(Uuid::new_v4());
            assert!(tool_call_params(&serde_json::to_vec(&forged).unwrap()).is_err());
            let mut nested = wire.clone();
            nested["_meta"]["x-codex-turn-metadata"][field] = json!(Uuid::new_v4());
            assert!(tool_call_params(&serde_json::to_vec(&nested).unwrap()).is_err());
        }
        for wrong in [
            Value::Null,
            json!([]),
            json!({"callId":{"operationId":"forged"}}),
            json!({"x-codex-turn-metadata":{"node_repl_disabled":"true"}}),
        ] {
            let mut malformed = wire.clone();
            malformed["_meta"] = wrong;
            assert!(tool_call_params(&serde_json::to_vec(&malformed).unwrap()).is_err());
        }
    }

    #[test]
    fn derived_references_survive_native_set_then_remove_order() {
        for calling in [false, true] {
            let mut keys = vec![agent_tool_mcp::INVOCATION_HEADER];
            if calling {
                keys.extend([
                    agent_tool_mcp::ACTION_HEADER,
                    agent_tool_mcp::OPERATION_HEADER,
                ]);
            }
            let headers = reference_headers(
                keys.iter()
                    .map(|key| wire::McpHeader {
                        key: (*key).into(),
                        value: Uuid::new_v4().to_string().into_bytes(),
                    })
                    .collect(),
                calling,
            );
            assert!(headers
                .set
                .iter()
                .all(|set| !headers.remove.contains(&set.key)));
            assert_eq!(headers.remove.len(), if calling { 0 } else { 2 });
            assert_eq!(headers.set.len(), if calling { 3 } else { 1 });
        }
    }

    #[test]
    fn duplicate_session_header_and_noncanonical_reference_are_rejected() {
        let header = || wire::McpHeader {
            key: "Authorization".into(),
            value: b"Bearer session".to_vec(),
        };
        assert_eq!(session_header(&[header()]).unwrap(), "Bearer session");
        assert!(session_header(&[header(), header()]).is_err());
        assert!(uuid(&json!({"id":Uuid::nil()}), "id").is_err());
        let id = Uuid::new_v4();
        assert_eq!(uuid(&json!({"id":id}), "id").unwrap(), id);
        assert!(uuid(&json!({"id":id.to_string().to_uppercase()}), "id").is_err());
        assert_eq!(
            error(Refusal::Unavailable("private native detail".into())).reason,
            "DEPENDENCY_UNAVAILABLE"
        );
    }
}
