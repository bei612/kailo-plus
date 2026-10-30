//! DD-105 / SS-AGW-02: private PLATFORM_NATIVE Streamable HTTP MCP.
//! rmcp owns the protocol and transport. A Gateway service identity is only a
//! caller identity; the PEP's original Invocation/child ActionExecution remains
//! the authority for every directory/read operation.

use std::sync::Arc;

use axum::{
    extract::{Request, State},
    http::{request::Parts, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::Response,
    Router,
};
use rmcp::{
    model::{
        CallToolRequestParams, CallToolResponse, CallToolResult, ListToolsResult,
        PaginatedRequestParams, ServerCapabilities, ServerInfo, Tool,
    },
    service::RequestContext,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    },
    ErrorData, RoleServer, ServerHandler,
};
use serde_json::Value;
use uuid::Uuid;

use crate::{service_api::ServiceState, service_auth::GatewayServiceAuth};

pub(crate) mod wire {
    tonic::include_proto!("agentgateway.dev.ext_mcp");
}

pub(crate) const PATH: &str = "/service/v1/agent-tools/mcp";
pub(crate) const INVOCATION_HEADER: &str = "x-platform-agent-invocation-id";
pub(crate) const ACTION_HEADER: &str = "x-platform-action-execution-id";
pub(crate) const OPERATION_HEADER: &str = "x-platform-operation-id";

pub(crate) fn router(state: ServiceState, auth: Arc<GatewayServiceAuth>) -> Router {
    let mut config =
        StreamableHttpServerConfig::default().with_allowed_hosts([allowed_host(auth.mcp_url())]);
    // No transport-session cache can carry one Invocation's authority into
    // another call. Native legacy initialize remains supported by rmcp.
    config.legacy_session_mode = false;
    config.json_response = true;
    let service = StreamableHttpService::new(
        move || {
            Ok(MemoryTools {
                state: state.clone(),
            })
        },
        Arc::new(LocalSessionManager::default()),
        config,
    );
    Router::new()
        .nest_service(PATH, service)
        .layer(middleware::from_fn_with_state(auth, authenticate))
}

/// DNS-rebinding allowlist entry for the Core MCP endpoint: the configured
/// host without its port. AgentGateway's MCP backend applies its default
/// automatic hostname rewrite, which sets the upstream authority to the target
/// hostname only (`core-bff`, not `core-bff:8082`); rmcp matches any port when
/// the allowed entry has none, so the hostname itself stays pinned
/// (acceptance batch 5: every thread/start failed with "Forbidden: Host header
/// is not allowed" on `initialize`). The endpoint still requires the Gateway
/// service token on every request. A URL without a host yields an empty
/// entry, which matches no request (fail closed).
fn allowed_host(url: &reqwest::Url) -> String {
    url.host_str().unwrap_or_default().to_owned()
}

async fn authenticate(
    State(auth): State<Arc<GatewayServiceAuth>>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let header =
        single_header(request.headers(), "authorization").map_err(|_| StatusCode::UNAUTHORIZED)?;
    auth.verify(Some(header))
        .await
        .map_err(|error| match error {
            crate::service_auth::ServiceAuthError::KeysUnavailable => {
                StatusCode::SERVICE_UNAVAILABLE
            }
            _ => StatusCode::UNAUTHORIZED,
        })?;
    Ok(next.run(request).await)
}

fn denied() -> ErrorData {
    // CheckResponse is skipped for JSON-RPC errors. Never include arguments,
    // Memory data, native errors, tokens or a SQL error in this branch.
    ErrorData::invalid_request("PERMISSION_DENIED", None)
}

fn unavailable() -> ErrorData {
    ErrorData::internal_error("DEPENDENCY_UNAVAILABLE", None)
}

fn refusal(error: crate::governance::Refusal) -> ErrorData {
    if matches!(error, crate::governance::Refusal::Unavailable(_)) {
        return unavailable();
    }
    ErrorData::invalid_request(
        "TOOL_REJECTED",
        Some(serde_json::json!({
            "reasonCode": error.reason()
        })),
    )
}

fn single_header<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str, ErrorData> {
    let mut values = headers.get_all(name).iter();
    let value = values
        .next()
        .and_then(|value| value.to_str().ok())
        .ok_or_else(denied)?;
    if value.is_empty() || values.next().is_some() {
        return Err(denied());
    }
    Ok(value)
}

fn reference(headers: &HeaderMap, name: &str) -> Result<Uuid, ErrorData> {
    let value = single_header(headers, name)?;
    let id = Uuid::parse_str(value).map_err(|_| denied())?;
    if id.is_nil() || id.to_string() != value {
        return Err(denied());
    }
    Ok(id)
}

/// DD-140: the MCP client cannot resolve repository-relative `$ref`s. Inline the
/// exact referenced enum contracts and drop the submission fields this child can
/// never carry (they reference unrelated contracts); the registry hash stays the
/// one of the original contract files (`agent_tool::schema_hashes`).
fn project_channel_request_tool() -> Result<Tool, ErrorData> {
    let parse = |text: &str| serde_json::from_str::<Value>(text).map_err(|_| denied());
    let mut input = parse(include_str!(
        "../../../../contracts/api/project_channel_request.schema.json"
    ))?;
    let visibility = parse(include_str!(
        "../../../../contracts/domain/workspace_visibility.schema.json"
    ))?;
    let field = input
        .pointer_mut("/properties/visibility")
        .ok_or_else(denied)?;
    if field.get("$ref").and_then(Value::as_str)
        != Some("../domain/workspace_visibility.schema.json")
    {
        return Err(denied());
    }
    *field = visibility;
    let mut output = parse(include_str!(
        "../../../../contracts/api/action_submission.schema.json"
    ))?;
    let properties = output
        .get_mut("properties")
        .and_then(Value::as_object_mut)
        .ok_or_else(denied)?;
    for unrelated in ["invitation", "documentLaunch", "webhookSecret"] {
        properties.remove(unrelated).ok_or_else(denied)?;
    }
    for (name, reference, text) in [
        (
            "gateState",
            "../enums/action_gate_state.schema.json",
            include_str!("../../../../contracts/enums/action_gate_state.schema.json"),
        ),
        (
            "dispatchState",
            "../enums/action_dispatch_state.schema.json",
            include_str!("../../../../contracts/enums/action_dispatch_state.schema.json"),
        ),
        (
            "reason",
            "../enums/reason_code.schema.json",
            include_str!("../../../../contracts/enums/reason_code.schema.json"),
        ),
    ] {
        let field = properties.get_mut(name).ok_or_else(denied)?;
        if field.get("$ref").and_then(Value::as_str) != Some(reference) {
            return Err(denied());
        }
        *field = parse(text)?;
    }
    let input = input.as_object().cloned().ok_or_else(denied)?;
    let output = output.as_object().cloned().ok_or_else(denied)?;
    Ok(Tool::new_with_raw(
        crate::project_channel_request::TOOL.to_owned(),
        None,
        Arc::new(input),
    )
    .with_raw_output_schema(Arc::new(output)))
}

pub(crate) fn schema_tool(name: &str) -> Result<Tool, ErrorData> {
    if name == crate::project_channel_request::TOOL {
        return project_channel_request_tool();
    }
    let (input, output) = match name {
        "agent.memory.entry.list" => (
            include_str!("../../../../contracts/domain/agent_memory_entry_list_input.schema.json"),
            include_str!("../../../../contracts/api/agent_memory_entry_page.schema.json"),
        ),
        "agent.memory.entry.read" => (
            include_str!("../../../../contracts/domain/agent_memory_entry_read_input.schema.json"),
            include_str!("../../../../contracts/api/agent_memory_read_view.schema.json"),
        ),
        _ => return Err(denied()),
    };
    let input: serde_json::Map<String, Value> =
        serde_json::from_str(input).map_err(|_| denied())?;
    let mut output: serde_json::Map<String, Value> =
        serde_json::from_str(output).map_err(|_| denied())?;
    if name == "agent.memory.entry.list" {
        // The MCP client cannot resolve repository-relative schema files.
        // Embed this exact, non-recursive contract instead of inventing a
        // parallel entry DTO or silently omitting its output shape.
        let mut entry: Value = serde_json::from_str(include_str!(
            "../../../../contracts/api/agent_memory_entry_view.schema.json"
        ))
        .map_err(|_| denied())?;
        // DD-125(10): the reference view is HUMAN-management only. The tool
        // result keeps its original shape, so its advertised schema does too.
        entry
            .get_mut("properties")
            .and_then(Value::as_object_mut)
            .and_then(|properties| properties.remove("outgoingRefs"))
            .ok_or_else(denied)?;
        let properties = output
            .get_mut("properties")
            .and_then(Value::as_object_mut)
            .ok_or_else(denied)?;
        properties.remove("references").ok_or_else(denied)?;
        let items = properties
            .get_mut("entries")
            .and_then(|entries| entries.get_mut("items"))
            .ok_or_else(denied)?;
        if items.get("$ref").and_then(Value::as_str) != Some("agent_memory_entry_view.schema.json")
        {
            return Err(denied());
        }
        *items = entry;
    }
    Ok(Tool::new_with_raw(name.to_owned(), None, Arc::new(input))
        .with_raw_output_schema(Arc::new(output)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_host_allowlist_is_the_configured_hostname_without_port() {
        let url = reqwest::Url::parse("http://core-bff:8082/service/v1/agent-tools/mcp").unwrap();
        assert_eq!(allowed_host(&url), "core-bff");
        let config = StreamableHttpServerConfig::default().with_allowed_hosts([allowed_host(&url)]);
        assert_eq!(config.allowed_hosts, vec!["core-bff".to_string()]);
        let bare = reqwest::Url::parse("http://core-bff/service/v1/agent-tools/mcp").unwrap();
        assert_eq!(allowed_host(&bare), "core-bff");
    }

    #[test]
    fn platform_mcp_decision_references_are_unique_canonical_and_non_nil() {
        let mut headers = HeaderMap::new();
        assert!(reference(&headers, ACTION_HEADER).is_err());
        let id = Uuid::new_v4();
        headers.insert(ACTION_HEADER, id.to_string().parse().unwrap());
        assert_eq!(reference(&headers, ACTION_HEADER).unwrap(), id);
        headers.append(ACTION_HEADER, id.to_string().parse().unwrap());
        assert!(reference(&headers, ACTION_HEADER).is_err());
        headers.insert(ACTION_HEADER, Uuid::nil().to_string().parse().unwrap());
        assert!(reference(&headers, ACTION_HEADER).is_err());
        headers.insert(ACTION_HEADER, id.simple().to_string().parse().unwrap());
        assert!(reference(&headers, ACTION_HEADER).is_err());
        headers.insert("authorization", "Bearer test-marker".parse().unwrap());
        headers.append("authorization", "Bearer another-marker".parse().unwrap());
        assert!(single_header(&headers, "authorization").is_err());
    }

    #[test]
    fn platform_mcp_schemas_are_original_contracts_with_resolved_entry_reference() {
        let list = schema_tool("agent.memory.entry.list").unwrap();
        let read = schema_tool("agent.memory.entry.read").unwrap();
        assert_eq!(list.input_schema["additionalProperties"], false);
        assert_eq!(list.input_schema["properties"], serde_json::json!({}));
        assert_eq!(read.input_schema["required"], serde_json::json!(["slug"]));
        let mut entry: Value = serde_json::from_str(include_str!(
            "../../../../contracts/api/agent_memory_entry_view.schema.json"
        ))
        .unwrap();
        // The HUMAN-only reference view never appears in the tool contract.
        let properties = entry["properties"].as_object_mut().unwrap();
        assert!(properties.remove("outgoingRefs").is_some());
        let output = list.output_schema.unwrap();
        assert_eq!(output["properties"]["entries"]["items"], entry);
        assert!(output["properties"].get("references").is_none());
        assert!(!serde_json::to_string(&*output).unwrap().contains("$ref"));
        assert!(schema_tool("agent.memory.core.replace").is_err());
        assert!(schema_tool("unknown").is_err());
    }

    #[test]
    fn platform_mcp_errors_preserve_unknown_without_native_details() {
        let error = refusal(crate::governance::Refusal::Unavailable(
            "private-native-detail-marker".into(),
        ));
        let value = serde_json::to_value(error).unwrap();
        assert_eq!(value["message"], "DEPENDENCY_UNAVAILABLE");
        assert!(!value.to_string().contains("private-native-detail-marker"));
        let denied = refusal(crate::governance::Refusal::Denied(
            contracts::ReasonCode::PermissionDenied,
        ));
        assert_eq!(
            serde_json::to_value(denied).unwrap()["data"]["reasonCode"],
            "PERMISSION_DENIED"
        );
    }
}

#[derive(Clone)]
struct MemoryTools {
    state: ServiceState,
}

impl ServerHandler for MemoryTools {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
    }

    async fn list_tools(
        &self,
        request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        if request.is_some_and(|request| request.cursor.is_some()) {
            return Err(denied());
        }
        let parts = context.extensions.get::<Parts>().ok_or_else(denied)?;
        let invocation = reference(&parts.headers, INVOCATION_HEADER)?;
        let names = crate::agent_tool::invocation_tools(&self.state, invocation)
            .await
            .map_err(refusal)?;
        let mut tools = Vec::with_capacity(names.len());
        for name in &names {
            if crate::mcp_connection::tool::is_connector_name(name) {
                // DD-149: the frozen, labelled schema of the confirmed generation.
                tools.push(
                    crate::mcp_connection::tool::schema(&self.state, invocation, name)
                        .await
                        .map_err(refusal)?,
                );
            } else {
                tools.push(schema_tool(name)?);
            }
        }
        Ok(ListToolsResult::with_all_items(tools))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        if request.input_responses.is_some() || request.request_state.is_some() {
            return Err(denied());
        }
        let parts = context.extensions.get::<Parts>().ok_or_else(denied)?;
        let action = reference(&parts.headers, ACTION_HEADER)?;
        let operation = reference(&parts.headers, OPERATION_HEADER)?;
        if crate::mcp_connection::tool::is_connector_name(request.name.as_ref()) {
            // DD-149: relay the PEP-admitted child to the third party; the result is
            // labelled untrusted content and its digest is what the PEP discloses.
            let result = crate::mcp_connection::tool::relay(
                &self.state,
                action,
                operation,
                request.name.as_ref(),
                request.arguments.unwrap_or_default(),
            )
            .await
            .map_err(refusal)?;
            return Ok(result.into());
        }
        if request.name.as_ref() == crate::project_channel_request::TOOL {
            // DD-140: the PEP already opened the owner-approved child; the result
            // is only that child's own submission, never an execution here.
            let result = crate::project_channel_request::result(&self.state, action, operation)
                .await
                .map_err(refusal)?;
            return Ok(CallToolResult::structured(result).into());
        }
        // The operation header is only a reference to compare with the original
        // admitted child; it never supplies Tenant/Workspace/Installation scope.
        let exact: bool = sqlx::query_scalar(
            "select exists(select 1 from admission.action_execution
            where id=$1 and operation_id=$2 and action_key=$3 and gate_state='ALLOWED')",
        )
        .bind(action)
        .bind(operation)
        .bind(request.name.as_ref())
        .fetch_one(&self.state.pool)
        .await
        .map_err(|_| unavailable())?;
        if !exact {
            return Err(denied());
        }
        let arguments = Value::Object(request.arguments.unwrap_or_default());
        let result = crate::agent_memory::execute_tool_read(
            &self.state,
            action,
            request.name.as_ref(),
            &arguments,
        )
        .await
        .map_err(refusal)?;
        Ok(CallToolResult::structured(result).into())
    }
}
