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
    ) -> Result<Uuid, Refusal> {
        let token = authorization
            .strip_prefix("Bearer ")
            .filter(|v| !v.is_empty())
            .ok_or_else(denied)?;
        let session = self.sessions.verify(token).map_err(|_| denied())?;
        let expected = target_name(
            session.scope.installation_resource_id,
            session.scope.projection_generation,
        );
        if services != [expected] {
            return Err(denied());
        }
        crate::agent_tool::session_invocation(&self.state, &session.scope, calling).await
    }

    async fn request(&self, request: &wire::McpRequest) -> Result<wire::McpRequestResult, Refusal> {
        let authorization = session_header(&request.headers)?;
        let calling = request.method == "tools/call";
        let invocation = self
            .invocation(authorization, &request.service_names, calling)
            .await?;
        let mut metadata = json!({"invocationId":invocation});
        let mut set = vec![wire::McpHeader {
            key: agent_tool_mcp::INVOCATION_HEADER.into(),
            value: invocation.to_string().into_bytes(),
        }];
        match request.method.as_str() {
            "initialize" | "ping" | "notifications/initialized" => {}
            "tools/list" => {
                // This is also checked by the private MCP reader, and again
                // on CheckResponse; an authenticated backend is not a list grant.
                crate::agent_tool::invocation_tools(&self.state, invocation).await?;
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
                let raw: Value =
                    serde_json::from_slice(request.mcp_request.as_deref().ok_or_else(invalid)?)
                        .map_err(|_| invalid())?;
                let call: CallToolRequestParams =
                    serde_json::from_value(raw.clone()).map_err(|_| invalid())?;
                // No caller-supplied AE, operation, target or authorization
                // context may be smuggled through MCP params/_meta.
                if raw.get("_meta").is_some()
                    || raw.as_object().is_none_or(|params| {
                        params
                            .keys()
                            .any(|key| !matches!(key.as_str(), "name" | "arguments"))
                    })
                {
                    return Err(invalid());
                }
                let arguments = call
                    .arguments
                    .map(Value::Object)
                    .unwrap_or_else(|| json!({}));
                crate::agent_memory::tool_arguments(&call.name, &arguments)?;
                let child = crate::agent_memory::prepare_tool_read(
                    &self.state,
                    invocation,
                    &call.name,
                    &arguments,
                )
                .await?;
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
        Ok(wire::McpRequestResult {
            result: Some(wire::mcp_request_result::Result::Pass(wire::Pass {})),
            // Native apply_header_mutation overwrites SET values first and
            // removes afterwards. Never also remove a freshly derived SET.
            header_mutation: Some(reference_headers(set, calling)),
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
        let authorization = metadata["session"].as_str().ok_or_else(denied)?;
        let invocation = self
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
                if result.is_error == Some(true) {
                    return Err(invalid());
                }
                let value = result.structured_content.as_ref().ok_or_else(invalid)?;
                let normalized = CallToolResult::structured(value.clone());
                // Strip no unverified text/images/links: the only content is
                // the SDK's exact JSON representation of the same typed value.
                if raw.get("content")
                    != serde_json::to_value(&normalized)
                        .map_err(|_| invalid())?
                        .get("content")
                {
                    return Err(invalid());
                }
                crate::agent_memory::disclose_tool_result(
                    &self.state,
                    invocation,
                    child,
                    operation,
                    name,
                    value,
                )
                .await?;
                self.sessions
                    .verify(authorization.strip_prefix("Bearer ").ok_or_else(denied)?)
                    .map_err(|_| denied())?;
                Ok(mutated(
                    serde_json::to_vec(&normalized).map_err(|_| invalid())?,
                ))
            }
            "initialize" | "ping" => Ok(wire::McpResponseResult {
                result: Some(wire::mcp_response_result::Result::Pass(wire::Pass {})),
            }),
            _ => Err(invalid()),
        }
    }
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
