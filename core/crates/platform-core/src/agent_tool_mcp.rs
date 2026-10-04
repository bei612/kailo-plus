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
    let url = auth.mcp_url();
    let authority = url.authority();
    let mut config =
        StreamableHttpServerConfig::default().with_allowed_hosts([authority.to_owned()]);
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

pub(crate) fn schema_tool(name: &str) -> Result<Tool, ErrorData> {
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
        let entry: Value = serde_json::from_str(include_str!(
            "../../../../contracts/api/agent_memory_entry_view.schema.json"
        ))
        .map_err(|_| denied())?;
        let items = output
            .get_mut("properties")
            .and_then(|properties| properties.get_mut("entries"))
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
        let entry: Value = serde_json::from_str(include_str!(
            "../../../../contracts/api/agent_memory_entry_view.schema.json"
        ))
        .unwrap();
        assert_eq!(
            list.output_schema.unwrap()["properties"]["entries"]["items"],
            entry
        );
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
        let tools = names
            .iter()
            .map(|name| schema_tool(name))
            .collect::<Result<Vec<_>, _>>()?;
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
