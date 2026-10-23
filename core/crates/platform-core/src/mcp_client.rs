//! DD-149(7)(9): the MCP client Core uses for user-registered external connectors.
//!
//! A small JSON-RPC client for MCP 2025-06-18 (accepting servers that negotiate 2025-03-26 or
//! 2024-11-05) over Streamable HTTP and the legacy HTTP+SSE transport. It is deliberately not
//! rmcp: every byte read is bounded, every connection goes through the pinned egress client
//! of `mcp_egress`, redirects are never followed, the only headers sent are the MCP protocol
//! headers and the connection's own credential (to the endpoint origin only), and errors never
//! echo upstream text.
//!
//! `probe` performs `initialize`, `notifications/initialized` and `tools/list` (at most four
//! pages) and validates the tool list; `call_tool` performs one `tools/call`. Once the
//! `tools/call` request may have left Core, a timeout, a dropped connection or an unreadable
//! response is `OutcomeUnknown` and must never be replayed.

// The connector actions and the relay wire these helpers in; until then only tests use parts.
#![allow(dead_code)]

use std::collections::{HashSet, VecDeque};
use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, CONTENT_TYPE, WWW_AUTHENTICATE};
use reqwest::{RequestBuilder, Response, StatusCode, Url};
use serde_json::{json, Map, Value};

use crate::mcp_egress::{self, EgressError, EgressScope};

pub(crate) const PROTOCOL_VERSION: &str = "2025-06-18";
const SUPPORTED_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SESSION_HEADER: &str = "mcp-session-id";
const PROTOCOL_HEADER: &str = "mcp-protocol-version";
const MAX_PAGES: usize = 4;
const MAX_TOOL_NAME: usize = 128;
const MAX_TITLE_CHARS: usize = 200;
const MAX_DESCRIPTION_CHARS: usize = 4000;
const MAX_INSTRUCTIONS_CHARS: usize = 2000;
const MAX_SERVER_TEXT_CHARS: usize = 200;
const MAX_SESSION_ID_BYTES: usize = 1024;
const MAX_CHALLENGE_VALUE_BYTES: usize = 2048;
/// Ending a session is best effort and must not hold up the answer.
const END_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Transport {
    StreamableHttp,
    Sse,
}

/// The connection's own credential: one header sent only to the endpoint origin.
#[derive(Clone)]
pub(crate) struct Credential {
    /// Lowercase header name, e.g. `authorization` or `x-api-key`.
    pub(crate) header: String,
    /// The header value, e.g. `Bearer xyz`.
    pub(crate) value: String,
}

impl fmt::Debug for Credential {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Credential")
            .field("header", &self.header)
            .field("value", &"<redacted>")
            .finish()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Limits {
    /// Overall bound of one probe or call (and of each HTTP request in it).
    pub(crate) timeout: Duration,
    /// Bytes read per HTTP response or SSE stream.
    pub(crate) max_response_bytes: usize,
    pub(crate) max_tools: usize,
}

impl Limits {
    pub(crate) fn probe() -> Self {
        Self {
            timeout: Duration::from_secs(10),
            max_response_bytes: 1024 * 1024,
            max_tools: 64,
        }
    }

    pub(crate) fn call() -> Self {
        Self {
            timeout: Duration::from_secs(30),
            max_response_bytes: 1024 * 1024,
            max_tools: 64,
        }
    }
}

pub(crate) struct Target<'a> {
    pub(crate) url: &'a Url,
    pub(crate) transport: Transport,
    pub(crate) credential: Option<&'a Credential>,
    pub(crate) scope: EgressScope<'a>,
    pub(crate) limits: Limits,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ServerInfo {
    pub(crate) name: Option<String>,
    pub(crate) version: Option<String>,
    pub(crate) protocol_version: String,
    /// Truncated to 2000 characters.
    pub(crate) instructions: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Annotations {
    pub(crate) read_only_hint: Option<bool>,
    pub(crate) destructive_hint: Option<bool>,
    pub(crate) idempotent_hint: Option<bool>,
    pub(crate) open_world_hint: Option<bool>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ProbedTool {
    pub(crate) name: String,
    pub(crate) title: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) input_schema: Value,
    pub(crate) output_schema: Option<Value>,
    pub(crate) annotations: Annotations,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Probe {
    pub(crate) server: ServerInfo,
    pub(crate) tools: Vec<ProbedTool>,
}

/// Failure classes; never carry upstream bodies, messages or credentials.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum McpError {
    Egress(EgressError),
    /// 401 (with the `WWW-Authenticate: Bearer` hints) or 403 (no hints).
    Unauthorized {
        resource_metadata: Option<String>,
        scope: Option<String>,
    },
    Unreachable,
    Protocol(&'static str),
    TooLarge,
    Timeout,
    /// The `tools/call` request may have reached the server; the outcome is not known.
    OutcomeUnknown,
}

impl From<EgressError> for McpError {
    fn from(error: EgressError) -> Self {
        Self::Egress(error)
    }
}

fn transport_error(error: reqwest::Error) -> McpError {
    if error.is_timeout() {
        McpError::Timeout
    } else {
        McpError::Unreachable
    }
}

fn truncate(text: &str, chars: usize) -> String {
    text.chars().take(chars).collect()
}

fn media_type(response: &Response) -> String {
    response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
}

/// Bearer challenge parameters (`resource_metadata`, `scope`) from `WWW-Authenticate`,
/// quoted-string aware; other schemes and parameters are ignored.
fn bearer_challenge(headers: &HeaderMap) -> (Option<String>, Option<String>) {
    let mut resource_metadata = None;
    let mut scope = None;
    for value in headers.get_all(WWW_AUTHENTICATE) {
        let Some(params) = value.to_str().ok().and_then(bearer_params) else {
            continue;
        };
        for (name, value) in params {
            if value.is_empty() || value.len() > MAX_CHALLENGE_VALUE_BYTES {
                continue;
            }
            match name.as_str() {
                "resource_metadata" if resource_metadata.is_none() => {
                    resource_metadata = Some(value)
                }
                "scope" if scope.is_none() => scope = Some(value),
                _ => {}
            }
        }
    }
    (resource_metadata, scope)
}

fn tchar(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b)
}

/// The auth-params of the first `Bearer` challenge in one header value (RFC 9110 §11.6.1).
fn bearer_params(header: &str) -> Option<Vec<(String, String)>> {
    let bytes = header.as_bytes();
    let len = bytes.len();
    let blank = |b: u8| b == b' ' || b == b'\t';
    let mut i = 0;
    let mut in_bearer = false;
    let mut found = false;
    let mut params = Vec::new();
    loop {
        while i < len && (blank(bytes[i]) || bytes[i] == b',') {
            i += 1;
        }
        if i >= len {
            break;
        }
        let start = i;
        while i < len && tchar(bytes[i]) {
            i += 1;
        }
        if i == start {
            break;
        }
        let token = &header[start..i];
        let mut j = i;
        while j < len && blank(bytes[j]) {
            j += 1;
        }
        if j < len && bytes[j] == b'=' {
            i = j + 1;
            while i < len && blank(bytes[i]) {
                i += 1;
            }
            let value = if i < len && bytes[i] == b'"' {
                i += 1;
                let mut value = String::new();
                loop {
                    match bytes.get(i) {
                        None => return found.then_some(params),
                        Some(b'"') => {
                            i += 1;
                            break;
                        }
                        Some(b'\\') if i + 1 < len => {
                            value.push(char::from(bytes[i + 1]));
                            i += 2;
                        }
                        Some(&b) => {
                            value.push(char::from(b));
                            i += 1;
                        }
                    }
                }
                value
            } else {
                let from = i;
                while i < len && tchar(bytes[i]) {
                    i += 1;
                }
                header[from..i].to_owned()
            };
            if in_bearer {
                params.push((token.to_ascii_lowercase(), value));
            }
        } else {
            // A new challenge (auth-scheme) starts.
            if in_bearer {
                break;
            }
            in_bearer = token.eq_ignore_ascii_case("bearer");
            found |= in_bearer;
            i = j;
        }
    }
    found.then_some(params)
}

/// Non-success statuses: never follow redirects; 401 carries the Bearer hints.
fn status_error(response: &Response) -> Option<McpError> {
    let status = response.status();
    if status.is_success() {
        return None;
    }
    Some(match status {
        StatusCode::UNAUTHORIZED => {
            let (resource_metadata, scope) = bearer_challenge(response.headers());
            McpError::Unauthorized {
                resource_metadata,
                scope,
            }
        }
        StatusCode::FORBIDDEN => McpError::Unauthorized {
            resource_metadata: None,
            scope: None,
        },
        status if status.is_redirection() => McpError::Protocol("redirect"),
        status if status.is_server_error() => McpError::Unreachable,
        _ => McpError::Protocol("http-status"),
    })
}

/// One HTTP response read incrementally under the byte bound.
struct Bounded {
    response: Response,
    read: usize,
    limit: usize,
}

impl Bounded {
    fn new(response: Response, limit: usize) -> Result<Self, McpError> {
        if response
            .content_length()
            .is_some_and(|length| length > limit as u64)
        {
            return Err(McpError::TooLarge);
        }
        Ok(Self {
            response,
            read: 0,
            limit,
        })
    }

    async fn chunk(&mut self) -> Result<Option<axum::body::Bytes>, McpError> {
        match self.response.chunk().await {
            Ok(Some(chunk)) => {
                self.read += chunk.len();
                if self.read > self.limit {
                    return Err(McpError::TooLarge);
                }
                Ok(Some(chunk))
            }
            Ok(None) => Ok(None),
            Err(error) => Err(transport_error(error)),
        }
    }

    async fn all(mut self) -> Result<Vec<u8>, McpError> {
        let mut body = Vec::new();
        while let Some(chunk) = self.chunk().await? {
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SseEvent {
    event: String,
    data: String,
}

/// `text/event-stream` framing: `event:` and `data:` fields (multi-line data joined by `\n`),
/// comments ignored, an event dispatched on a blank line.
#[derive(Default)]
struct SseParser {
    line: Vec<u8>,
    event: String,
    data: Vec<String>,
}

impl SseParser {
    fn feed(&mut self, bytes: &[u8], out: &mut VecDeque<SseEvent>) {
        for &b in bytes {
            if b == b'\n' {
                let mut line = std::mem::take(&mut self.line);
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                self.line_done(&String::from_utf8_lossy(&line), out);
            } else {
                self.line.push(b);
            }
        }
    }

    fn line_done(&mut self, line: &str, out: &mut VecDeque<SseEvent>) {
        if line.is_empty() {
            let event = std::mem::take(&mut self.event);
            let data = std::mem::take(&mut self.data);
            if !data.is_empty() {
                out.push_back(SseEvent {
                    event: if event.is_empty() {
                        "message".to_owned()
                    } else {
                        event
                    },
                    data: data.join("\n"),
                });
            }
            return;
        }
        if line.starts_with(':') {
            return;
        }
        let (field, value) = match line.split_once(':') {
            Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
            None => (line, ""),
        };
        match field {
            "event" => self.event = value.to_owned(),
            "data" => self.data.push(value.to_owned()),
            _ => {}
        }
    }
}

struct SseStream {
    body: Bounded,
    parser: SseParser,
    pending: VecDeque<SseEvent>,
}

impl SseStream {
    fn new(response: Response, limit: usize) -> Result<Self, McpError> {
        Ok(Self {
            body: Bounded::new(response, limit)?,
            parser: SseParser::default(),
            pending: VecDeque::new(),
        })
    }

    async fn next(&mut self) -> Result<Option<SseEvent>, McpError> {
        loop {
            if let Some(event) = self.pending.pop_front() {
                return Ok(Some(event));
            }
            match self.body.chunk().await? {
                Some(chunk) => self.parser.feed(&chunk, &mut self.pending),
                None => return Ok(None),
            }
        }
    }
}

/// The response to request `id` inside one received JSON-RPC message; requests and
/// notifications from the server are ignored (`None`).
fn match_response(message: &Value, id: i64) -> Option<Result<Value, McpError>> {
    let object = message.as_object()?;
    if object.contains_key("method") || object.get("id").and_then(Value::as_i64) != Some(id) {
        return None;
    }
    if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Some(Err(McpError::Protocol("jsonrpc-version")));
    }
    if object.contains_key("error") {
        return Some(Err(McpError::Protocol("jsonrpc-error")));
    }
    Some(match object.get("result") {
        Some(result @ Value::Object(_)) => Ok(result.clone()),
        _ => Err(McpError::Protocol("jsonrpc-result")),
    })
}

fn parse_message(data: &[u8]) -> Result<Value, McpError> {
    serde_json::from_slice(data).map_err(|_| McpError::Protocol("json"))
}

/// One MCP session over either transport.
struct Session<'t, 'a> {
    target: &'t Target<'a>,
    /// Pinned client of the URL messages are POSTed to (the endpoint itself for Streamable
    /// HTTP; the announced, same-origin message endpoint for legacy SSE).
    post_client: reqwest::Client,
    post_url: Url,
    protocol: Option<String>,
    session_id: Option<HeaderValue>,
    next_id: i64,
    /// Legacy SSE: the open GET stream responses arrive on.
    stream: Option<SseStream>,
}

impl<'t, 'a> Session<'t, 'a> {
    async fn open(target: &'t Target<'a>) -> Result<Self, McpError> {
        let timeout = target.limits.timeout;
        let client = mcp_egress::client(&target.scope, target.url, timeout).await?;
        let mut session = Self {
            target,
            post_client: client.clone(),
            post_url: target.url.clone(),
            protocol: None,
            session_id: None,
            next_id: 1,
            stream: None,
        };
        if target.transport == Transport::StreamableHttp {
            return Ok(session);
        }
        let request = client
            .get(target.url.clone())
            .header(ACCEPT, "text/event-stream");
        let response = session
            .decorate(request)?
            .send()
            .await
            .map_err(transport_error)?;
        if let Some(error) = status_error(&response) {
            return Err(error);
        }
        if media_type(&response) != "text/event-stream" {
            return Err(McpError::Protocol("content-type"));
        }
        let mut stream = SseStream::new(response, target.limits.max_response_bytes)?;
        let endpoint = loop {
            match stream.next().await? {
                Some(event) if event.event == "endpoint" => break event.data,
                Some(_) => continue,
                None => return Err(McpError::Protocol("sse-endpoint")),
            }
        };
        let post_url = target
            .url
            .join(endpoint.trim())
            .map_err(|_| McpError::Protocol("sse-endpoint"))?;
        if post_url.scheme() != target.url.scheme()
            || post_url.host_str() != target.url.host_str()
            || post_url.port_or_known_default() != target.url.port_or_known_default()
            || !post_url.username().is_empty()
            || post_url.password().is_some()
            || post_url.as_str().len() > 2048
        {
            return Err(McpError::Protocol("sse-endpoint"));
        }
        session.post_client = mcp_egress::client(&target.scope, &post_url, timeout).await?;
        session.post_url = post_url;
        session.stream = Some(stream);
        Ok(session)
    }

    /// The only headers ever added: protocol version, session ID and the credential (every
    /// request of a session targets the endpoint origin).
    fn decorate(&self, mut request: RequestBuilder) -> Result<RequestBuilder, McpError> {
        if let Some(protocol) = &self.protocol {
            request = request.header(PROTOCOL_HEADER, protocol.as_str());
        }
        if let Some(id) = &self.session_id {
            request = request.header(SESSION_HEADER, id.clone());
        }
        if let Some(credential) = self.target.credential {
            let name = HeaderName::from_bytes(credential.header.as_bytes())
                .map_err(|_| McpError::Protocol("credential"))?;
            let mut value = HeaderValue::from_str(&credential.value)
                .map_err(|_| McpError::Protocol("credential"))?;
            value.set_sensitive(true);
            request = request.header(name, value);
        }
        Ok(request)
    }

    async fn post(&self, message: &Value, sent: Option<&AtomicBool>) -> Result<Response, McpError> {
        let body = serde_json::to_vec(message).map_err(|_| McpError::Protocol("json"))?;
        let request = self
            .post_client
            .post(self.post_url.clone())
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json, text/event-stream")
            .body(body);
        let request = self.decorate(request)?;
        if let Some(sent) = sent {
            sent.store(true, Ordering::SeqCst);
        }
        let response = request.send().await.map_err(transport_error)?;
        match status_error(&response) {
            Some(error) => Err(error),
            None => Ok(response),
        }
    }

    async fn request(
        &mut self,
        method: &str,
        params: Value,
        sent: Option<&AtomicBool>,
    ) -> Result<Value, McpError> {
        let id = self.next_id;
        self.next_id += 1;
        let message = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let response = self.post(&message, sent).await?;
        let limit = self.target.limits.max_response_bytes;
        if let Some(stream) = self.stream.as_mut() {
            drop(response);
            while let Some(event) = stream.next().await? {
                if event.event != "message" {
                    continue;
                }
                if let Some(result) = match_response(&parse_message(event.data.as_bytes())?, id) {
                    return result;
                }
            }
            return Err(McpError::Protocol("no-response"));
        }
        if method == "initialize" {
            if let Some(value) = response.headers().get(SESSION_HEADER) {
                let bytes = value.as_bytes();
                if bytes.is_empty()
                    || bytes.len() > MAX_SESSION_ID_BYTES
                    || !bytes.iter().all(|b| (0x21..=0x7e).contains(b))
                {
                    return Err(McpError::Protocol("session-id"));
                }
                self.session_id = Some(value.clone());
            }
        }
        match media_type(&response).as_str() {
            "application/json" => {
                let messages = match parse_message(&Bounded::new(response, limit)?.all().await?)? {
                    Value::Array(items) => items,
                    other => vec![other],
                };
                messages
                    .iter()
                    .find_map(|message| match_response(message, id))
                    .unwrap_or(Err(McpError::Protocol("no-response")))
            }
            "text/event-stream" => {
                let mut stream = SseStream::new(response, limit)?;
                while let Some(event) = stream.next().await? {
                    if event.event != "message" {
                        continue;
                    }
                    if let Some(result) = match_response(&parse_message(event.data.as_bytes())?, id)
                    {
                        return result;
                    }
                }
                Err(McpError::Protocol("no-response"))
            }
            _ => Err(McpError::Protocol("content-type")),
        }
    }

    async fn notify(&mut self, method: &str) -> Result<(), McpError> {
        let message = json!({"jsonrpc": "2.0", "method": method});
        self.post(&message, None).await.map(drop)
    }

    async fn initialize(&mut self) -> Result<ServerInfo, McpError> {
        let params = json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "Kailo", "version": "1"},
        });
        let result = self.request("initialize", params, None).await?;
        let protocol_version = result
            .get("protocolVersion")
            .and_then(Value::as_str)
            .filter(|version| SUPPORTED_VERSIONS.contains(version))
            .ok_or(McpError::Protocol("protocol-version"))?
            .to_owned();
        let text = |value: Option<&Value>, chars: usize| {
            value
                .and_then(Value::as_str)
                .map(|text| truncate(text, chars))
        };
        let info = result.get("serverInfo");
        let server = ServerInfo {
            name: text(info.and_then(|i| i.get("name")), MAX_SERVER_TEXT_CHARS),
            version: text(info.and_then(|i| i.get("version")), MAX_SERVER_TEXT_CHARS),
            protocol_version: protocol_version.clone(),
            instructions: text(result.get("instructions"), MAX_INSTRUCTIONS_CHARS),
        };
        self.protocol = Some(protocol_version);
        self.notify("notifications/initialized").await?;
        Ok(server)
    }

    async fn list_tools(&mut self) -> Result<Vec<ProbedTool>, McpError> {
        let mut tools = Vec::new();
        let mut names = HashSet::new();
        let mut cursor: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let params = match &cursor {
                Some(cursor) => json!({"cursor": cursor}),
                None => json!({}),
            };
            let result = self.request("tools/list", params, None).await?;
            let page = result
                .get("tools")
                .and_then(Value::as_array)
                .ok_or(McpError::Protocol("tools"))?;
            for raw in page {
                let tool = parse_tool(raw)?;
                if !names.insert(tool.name.clone()) {
                    return Err(McpError::Protocol("duplicate-tool"));
                }
                tools.push(tool);
                if tools.len() > self.target.limits.max_tools {
                    return Err(McpError::TooLarge);
                }
            }
            match result.get("nextCursor") {
                None | Some(Value::Null) => return Ok(tools),
                Some(Value::String(next)) => cursor = Some(next.clone()),
                Some(_) => return Err(McpError::Protocol("cursor")),
            }
        }
        Err(McpError::TooLarge)
    }

    /// Best effort: Streamable HTTP sessions are ended with DELETE; a legacy SSE session ends
    /// when its stream is dropped.
    async fn end(mut self) {
        self.stream = None;
        if self.target.transport != Transport::StreamableHttp || self.session_id.is_none() {
            return;
        }
        let request = self.post_client.delete(self.post_url.clone());
        if let Ok(request) = self.decorate(request) {
            let _ = tokio::time::timeout(END_TIMEOUT, request.send()).await;
        }
    }
}

fn valid_tool_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_TOOL_NAME
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
}

fn object_schema(value: &Value) -> bool {
    value.is_object() && value.get("type").and_then(Value::as_str) == Some("object")
}

fn parse_tool(raw: &Value) -> Result<ProbedTool, McpError> {
    let name = raw
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| valid_tool_name(name))
        .ok_or(McpError::Protocol("tool-name"))?
        .to_owned();
    let input_schema = raw
        .get("inputSchema")
        .filter(|schema| object_schema(schema))
        .ok_or(McpError::Protocol("tool-input-schema"))?
        .clone();
    let output_schema = match raw.get("outputSchema") {
        None | Some(Value::Null) => None,
        Some(schema) if object_schema(schema) => Some(schema.clone()),
        Some(_) => return Err(McpError::Protocol("tool-output-schema")),
    };
    let annotations = raw.get("annotations").and_then(Value::as_object);
    let hint = |key: &str| {
        annotations
            .and_then(|a| a.get(key))
            .and_then(Value::as_bool)
    };
    let title = raw
        .get("title")
        .or_else(|| annotations.and_then(|a| a.get("title")))
        .and_then(Value::as_str)
        .map(|title| truncate(title, MAX_TITLE_CHARS));
    Ok(ProbedTool {
        name,
        title,
        description: raw
            .get("description")
            .and_then(Value::as_str)
            .map(|text| truncate(text, MAX_DESCRIPTION_CHARS)),
        input_schema,
        output_schema,
        annotations: Annotations {
            read_only_hint: hint("readOnlyHint"),
            destructive_hint: hint("destructiveHint"),
            idempotent_hint: hint("idempotentHint"),
            open_world_hint: hint("openWorldHint"),
        },
    })
}

/// What one session does after `initialize` and `notifications/initialized`.
enum Program<'c> {
    Handshake,
    Probe,
    Call {
        name: &'c str,
        arguments: Map<String, Value>,
    },
}

enum Outcome {
    Server(ServerInfo),
    Probe(Probe),
    Call(Value),
}

async fn run_program<'t, 'a>(
    slot: &mut Option<Session<'t, 'a>>,
    target: &'t Target<'a>,
    program: Program<'_>,
    sent: Option<&AtomicBool>,
) -> Result<Outcome, McpError> {
    let session = slot.insert(Session::open(target).await?);
    let server = session.initialize().await?;
    match program {
        Program::Handshake => Ok(Outcome::Server(server)),
        Program::Probe => {
            let tools = session.list_tools().await?;
            Ok(Outcome::Probe(Probe { server, tools }))
        }
        Program::Call { name, arguments } => {
            let params = json!({"name": name, "arguments": arguments});
            session
                .request("tools/call", params, sent)
                .await
                .map(Outcome::Call)
        }
    }
}

/// Run a program on a fresh session under the overall deadline, then end the session outside
/// the deadline so a slow DELETE never turns an answer into a failure.
async fn with_session(
    target: &Target<'_>,
    program: Program<'_>,
    sent: Option<&AtomicBool>,
) -> Result<Outcome, McpError> {
    let mut slot = None;
    let outcome = tokio::time::timeout(
        target.limits.timeout,
        run_program(&mut slot, target, program, sent),
    )
    .await;
    if let Some(session) = slot {
        session.end().await;
    }
    outcome.unwrap_or(Err(McpError::Timeout))
}

/// `initialize` and `notifications/initialized` only; OAuth discovery uses it without a
/// credential to obtain the 401 challenge.
pub(crate) async fn handshake(target: &Target<'_>) -> Result<ServerInfo, McpError> {
    match with_session(target, Program::Handshake, None).await? {
        Outcome::Server(server) => Ok(server),
        _ => Err(McpError::Protocol("program")),
    }
}

pub(crate) async fn probe(target: &Target<'_>) -> Result<Probe, McpError> {
    match with_session(target, Program::Probe, None).await? {
        Outcome::Probe(probe) => Ok(probe),
        _ => Err(McpError::Protocol("program")),
    }
}

/// After the `tools/call` body may have left Core only explicit refusals keep their class;
/// everything else is an unknown outcome.
fn after_send(error: McpError, sent: &AtomicBool) -> McpError {
    if !sent.load(Ordering::SeqCst) {
        return error;
    }
    match error {
        McpError::Unauthorized { .. }
        | McpError::Protocol("redirect" | "jsonrpc-error" | "http-status") => error,
        _ => McpError::OutcomeUnknown,
    }
}

pub(crate) async fn call_tool(
    target: &Target<'_>,
    name: &str,
    arguments: Map<String, Value>,
) -> Result<Value, McpError> {
    let sent = AtomicBool::new(false);
    match with_session(target, Program::Call { name, arguments }, Some(&sent)).await {
        Ok(Outcome::Call(result)) => Ok(result),
        Ok(_) => Err(McpError::Protocol("program")),
        Err(error) => Err(after_send(error, &sent)),
    }
}

/// Digest of the confirmed tool list (order independent).
pub(crate) fn tools_digest(tools: &[ProbedTool]) -> String {
    let mut sorted: Vec<&ProbedTool> = tools.iter().collect();
    sorted.sort_by(|a, b| a.name.cmp(&b.name));
    let items = sorted
        .into_iter()
        .map(|tool| {
            json!({
                "name": tool.name,
                "title": tool.title,
                "description": tool.description,
                "inputSchema": tool.input_schema,
                "outputSchema": tool.output_schema,
                "annotations": {
                    "readOnlyHint": tool.annotations.read_only_hint,
                    "destructiveHint": tool.annotations.destructive_hint,
                    "idempotentHint": tool.annotations.idempotent_hint,
                    "openWorldHint": tool.annotations.open_world_hint,
                },
            })
        })
        .collect();
    collab_bridge::limits::canonical_digest(&Value::Array(items))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp_egress::{Cidr, PlatformEgress};
    use axum::{
        body::{Body, Bytes},
        extract::State,
        http::{HeaderMap as AxHeaders, Method, StatusCode as AxStatus, Uri},
        response::{IntoResponse, Response as AxResponse},
        Router,
    };
    use std::sync::{Arc, Mutex};
    use tokio::sync::mpsc;

    #[derive(Clone)]
    struct Cfg {
        sse_responses: bool,
        session: Option<&'static str>,
        protocol: &'static str,
        tools: Vec<Value>,
        page_size: usize,
        call_delay: Option<Duration>,
        status: Option<(u16, Vec<(&'static str, String)>)>,
        endpoint_event: String,
        jsonrpc_error_on_call: bool,
    }

    impl Default for Cfg {
        fn default() -> Self {
            Self {
                sse_responses: false,
                session: None,
                protocol: "2025-06-18",
                tools: vec![tool("search", Some(true)), tool("delete_file", None)],
                page_size: usize::MAX,
                call_delay: None,
                status: None,
                endpoint_event: "/messages?sid=7".to_owned(),
                jsonrpc_error_on_call: false,
            }
        }
    }

    fn tool(name: &str, read_only: Option<bool>) -> Value {
        let mut tool = json!({
            "name": name,
            "description": format!("{name} things"),
            "inputSchema": {"type": "object", "properties": {"q": {"type": "string"}}},
        });
        if let Some(read_only) = read_only {
            tool["annotations"] = json!({"readOnlyHint": read_only, "title": "Search"});
        }
        tool
    }

    #[derive(Debug, Clone)]
    struct Seen {
        method: Method,
        path: String,
        headers: AxHeaders,
        rpc: Option<String>,
    }

    #[derive(Default)]
    struct Fake {
        cfg: Mutex<Cfg>,
        log: Mutex<Vec<Seen>>,
        sse: Mutex<Option<mpsc::UnboundedSender<String>>>,
    }

    impl Fake {
        fn seen(&self) -> Vec<Seen> {
            self.log.lock().unwrap().clone()
        }
    }

    async fn answer(cfg: &Cfg, message: &Value) -> Option<Value> {
        let id = message.get("id")?.clone();
        let method = message
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let result = match method {
            "initialize" => json!({
                "protocolVersion": cfg.protocol,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "fake", "version": "1.2.3"},
                "instructions": "x".repeat(3000),
            }),
            "tools/list" => {
                let page: usize = message["params"]["cursor"]
                    .as_str()
                    .and_then(|c| c.strip_prefix('p'))
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(0);
                let start = page.saturating_mul(cfg.page_size).min(cfg.tools.len());
                let end = start.saturating_add(cfg.page_size).min(cfg.tools.len());
                let mut result = json!({"tools": cfg.tools[start..end]});
                if end < cfg.tools.len() {
                    result["nextCursor"] = json!(format!("p{}", page + 1));
                }
                result
            }
            "tools/call" => {
                if let Some(delay) = cfg.call_delay {
                    tokio::time::sleep(delay).await;
                }
                if cfg.jsonrpc_error_on_call {
                    return Some(json!({"jsonrpc": "2.0", "id": id,
                        "error": {"code": -32000, "message": "upstream secret detail"}}));
                }
                let name = message["params"]["name"].as_str().unwrap_or_default();
                json!({
                    "content": [{"type": "text", "text": format!("called {name} with {}", message["params"]["arguments"])}],
                    "isError": name == "fail",
                })
            }
            _ => {
                return Some(json!({"jsonrpc": "2.0", "id": id,
                    "error": {"code": -32601, "message": "no"}}))
            }
        };
        Some(json!({"jsonrpc": "2.0", "id": id, "result": result}))
    }

    /// Pretty JSON split over several `data:` lines, preceded by noise the client ignores.
    fn sse_reply(reply: &Value) -> String {
        let mut out = String::from(": keep-alive\n\n");
        out.push_str("event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\",\"params\":{}}\n\n");
        out.push_str(&format!(
            "data: {}\n\n",
            json!({"jsonrpc": "2.0", "id": reply["id"], "method": "sampling/createMessage", "params": {}})
        ));
        for line in serde_json::to_string_pretty(reply).unwrap().lines() {
            out.push_str(&format!("data: {line}\r\n"));
        }
        out.push_str("\r\n");
        out
    }

    async fn handle(
        State(fake): State<Arc<Fake>>,
        method: Method,
        uri: Uri,
        headers: AxHeaders,
        body: Bytes,
    ) -> AxResponse {
        let message: Option<Value> = serde_json::from_slice(&body).ok();
        fake.log.lock().unwrap().push(Seen {
            method: method.clone(),
            path: uri.path().to_owned(),
            headers: headers.clone(),
            rpc: message
                .as_ref()
                .and_then(|m| m.get("method"))
                .and_then(Value::as_str)
                .map(str::to_owned),
        });
        let cfg = fake.cfg.lock().unwrap().clone();
        if let Some((code, extra)) = &cfg.status {
            let mut response = AxStatus::from_u16(*code).unwrap().into_response();
            for (name, value) in extra {
                response.headers_mut().append(*name, value.parse().unwrap());
            }
            return response;
        }
        match (method, uri.path()) {
            (Method::GET, "/sse") => {
                let (tx, rx) = mpsc::unbounded_channel::<String>();
                tx.send(format!("event: endpoint\ndata: {}\n\n", cfg.endpoint_event))
                    .unwrap();
                *fake.sse.lock().unwrap() = Some(tx);
                let stream = futures_util::stream::unfold(rx, |mut rx| async move {
                    rx.recv()
                        .await
                        .map(|chunk| (Ok::<_, std::convert::Infallible>(chunk), rx))
                });
                (
                    [("content-type", "text/event-stream")],
                    Body::from_stream(stream),
                )
                    .into_response()
            }
            (Method::POST, "/messages") => {
                let message = message.unwrap_or_default();
                if let Some(reply) = answer(&cfg, &message).await {
                    let tx = fake.sse.lock().unwrap().clone().unwrap();
                    let _ = tx.send(format!("event: message\ndata: {reply}\n\n"));
                }
                AxStatus::ACCEPTED.into_response()
            }
            (Method::DELETE, "/mcp") => AxStatus::NO_CONTENT.into_response(),
            (Method::POST, "/mcp") => {
                let message = message.unwrap_or_default();
                let Some(reply) = answer(&cfg, &message).await else {
                    return AxStatus::ACCEPTED.into_response();
                };
                let mut response = if cfg.sse_responses {
                    ([("content-type", "text/event-stream")], sse_reply(&reply)).into_response()
                } else {
                    axum::Json(reply).into_response()
                };
                if let (Some(id), Some("initialize")) = (cfg.session, message["method"].as_str()) {
                    response
                        .headers_mut()
                        .insert("mcp-session-id", id.parse().unwrap());
                }
                response
            }
            _ => AxStatus::NOT_FOUND.into_response(),
        }
    }

    async fn serve(cfg: Cfg) -> (Arc<Fake>, String) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let fake = Arc::new(Fake {
            cfg: Mutex::new(cfg),
            ..Fake::default()
        });
        let router = Router::new().fallback(handle).with_state(fake.clone());
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        (fake, base)
    }

    fn dev() -> PlatformEgress {
        PlatformEgress {
            any_public_host: true,
            host_suffixes: Vec::new(),
            dev_cidrs: vec![Cidr::parse("127.0.0.0/8").unwrap()],
            deny_cidrs: Vec::new(),
        }
    }

    fn credential() -> Credential {
        Credential {
            header: "x-api-key".to_owned(),
            value: "secret-key-1".to_owned(),
        }
    }

    fn target<'a>(
        url: &'a Url,
        platform: &'a PlatformEgress,
        credential: Option<&'a Credential>,
        transport: Transport,
        limits: Limits,
    ) -> Target<'a> {
        Target {
            url,
            transport,
            credential,
            scope: EgressScope {
                platform,
                tenant_suffixes: &[],
            },
            limits,
        }
    }

    fn url(base: &str, path: &str) -> Url {
        Url::parse(&format!("{base}{path}")).unwrap()
    }

    #[tokio::test]
    async fn mcp_client_probe_streamable_json() {
        let (fake, base) = serve(Cfg::default()).await;
        let (platform, cred, url) = (dev(), credential(), url(&base, "/mcp"));
        let t = target(
            &url,
            &platform,
            Some(&cred),
            Transport::StreamableHttp,
            Limits::probe(),
        );
        let probe = probe(&t).await.unwrap();
        assert_eq!(probe.server.name.as_deref(), Some("fake"));
        assert_eq!(probe.server.version.as_deref(), Some("1.2.3"));
        assert_eq!(probe.server.protocol_version, "2025-06-18");
        assert_eq!(
            probe.server.instructions.as_ref().unwrap().chars().count(),
            2000
        );
        assert_eq!(probe.tools.len(), 2);
        assert_eq!(probe.tools[0].name, "search");
        assert_eq!(probe.tools[0].title.as_deref(), Some("Search"));
        assert_eq!(probe.tools[0].annotations.read_only_hint, Some(true));
        assert_eq!(probe.tools[1].annotations, Annotations::default());

        let seen = fake.seen();
        let rpcs: Vec<_> = seen
            .iter()
            .map(|s| s.rpc.clone().unwrap_or_default())
            .collect();
        assert_eq!(
            rpcs,
            ["initialize", "notifications/initialized", "tools/list"]
        );
        for (i, s) in seen.iter().enumerate() {
            assert_eq!(s.headers.get("x-api-key").unwrap(), "secret-key-1");
            assert_eq!(s.headers.get("user-agent").unwrap(), "Kailo-Connector/1");
            assert_eq!(
                s.headers.get("mcp-protocol-version").is_some(),
                i > 0,
                "protocol header only after initialize"
            );
            assert!(s.headers.get("mcp-session-id").is_none());
        }
        assert!(
            seen.iter().all(|s| s.method == Method::POST),
            "no DELETE without a session"
        );
    }

    #[tokio::test]
    async fn mcp_client_probe_streamable_sse_with_session() {
        let (fake, base) = serve(Cfg {
            sse_responses: true,
            session: Some("sess-42"),
            protocol: "2025-03-26",
            page_size: 1,
            ..Cfg::default()
        })
        .await;
        let (platform, url) = (dev(), url(&base, "/mcp"));
        let t = target(
            &url,
            &platform,
            None,
            Transport::StreamableHttp,
            Limits::probe(),
        );
        let probe = probe(&t).await.unwrap();
        assert_eq!(probe.server.protocol_version, "2025-03-26");
        let names: Vec<_> = probe.tools.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, ["search", "delete_file"], "two pages followed");

        let seen = fake.seen();
        let last = seen.last().unwrap();
        assert_eq!(last.method, Method::DELETE);
        assert_eq!(last.headers.get("mcp-session-id").unwrap(), "sess-42");
        for s in &seen[1..] {
            assert_eq!(s.headers.get("mcp-session-id").unwrap(), "sess-42");
            assert_eq!(s.headers.get("mcp-protocol-version").unwrap(), "2025-03-26");
            assert!(s.headers.get("x-api-key").is_none());
        }
        assert_eq!(
            seen.iter()
                .filter(|s| s.rpc.as_deref() == Some("tools/list"))
                .count(),
            2
        );
    }

    #[tokio::test]
    async fn mcp_client_legacy_sse_probe_and_call() {
        let (fake, base) = serve(Cfg {
            protocol: "2024-11-05",
            ..Cfg::default()
        })
        .await;
        let (platform, cred, url) = (dev(), credential(), url(&base, "/sse"));
        let t = target(
            &url,
            &platform,
            Some(&cred),
            Transport::Sse,
            Limits::probe(),
        );
        let probe = probe(&t).await.unwrap();
        assert_eq!(probe.server.protocol_version, "2024-11-05");
        assert_eq!(probe.tools.len(), 2);

        let mut args = Map::new();
        args.insert("q".to_owned(), json!("kailo"));
        let t = target(&url, &platform, Some(&cred), Transport::Sse, Limits::call());
        let result = call_tool(&t, "search", args).await.unwrap();
        assert_eq!(result["isError"], json!(false));
        assert_eq!(
            result["content"][0]["text"],
            json!("called search with {\"q\":\"kailo\"}")
        );

        let seen = fake.seen();
        assert!(seen
            .iter()
            .any(|s| s.method == Method::GET && s.path == "/sse"));
        assert!(seen.iter().any(|s| s.path == "/messages"));
        for s in &seen {
            assert_eq!(
                s.headers.get("x-api-key").unwrap(),
                "secret-key-1",
                "{}",
                s.path
            );
            assert!(s.path == "/sse" || s.path == "/messages");
        }
    }

    #[tokio::test]
    async fn mcp_client_legacy_sse_cross_origin_endpoint_refused() {
        let (other, other_base) = serve(Cfg::default()).await;
        let (_fake, base) = serve(Cfg {
            endpoint_event: format!("{other_base}/messages"),
            ..Cfg::default()
        })
        .await;
        let (platform, cred, url) = (dev(), credential(), url(&base, "/sse"));
        let t = target(
            &url,
            &platform,
            Some(&cred),
            Transport::Sse,
            Limits::probe(),
        );
        assert_eq!(
            probe(&t).await.unwrap_err(),
            McpError::Protocol("sse-endpoint")
        );
        assert!(
            other.seen().is_empty(),
            "credential never leaves the endpoint origin"
        );
    }

    #[tokio::test]
    async fn mcp_client_unauthorized_and_forbidden() {
        let challenge = r#"Bearer realm="mcp", error="invalid_token", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", scope="files:read files:write""#;
        let (_fake, base) = serve(Cfg {
            status: Some((401, vec![("www-authenticate", challenge.to_owned())])),
            ..Cfg::default()
        })
        .await;
        let (platform, url) = (dev(), url(&base, "/mcp"));
        let t = target(
            &url,
            &platform,
            None,
            Transport::StreamableHttp,
            Limits::probe(),
        );
        assert_eq!(
            probe(&t).await.unwrap_err(),
            McpError::Unauthorized {
                resource_metadata: Some(
                    "https://mcp.example.com/.well-known/oauth-protected-resource/mcp".to_owned()
                ),
                scope: Some("files:read files:write".to_owned()),
            }
        );

        let (_fake, base) = serve(Cfg {
            status: Some((403, Vec::new())),
            ..Cfg::default()
        })
        .await;
        let url = self::url(&base, "/mcp");
        let t = target(
            &url,
            &platform,
            None,
            Transport::StreamableHttp,
            Limits::probe(),
        );
        assert_eq!(
            probe(&t).await.unwrap_err(),
            McpError::Unauthorized {
                resource_metadata: None,
                scope: None
            }
        );
    }

    #[test]
    fn mcp_client_www_authenticate_parsing() {
        let parse = |raw: &str| {
            let mut headers = HeaderMap::new();
            headers.append(WWW_AUTHENTICATE, raw.parse().unwrap());
            bearer_challenge(&headers)
        };
        assert_eq!(
            parse(
                r#"Basic realm="a, b", Bearer scope="x \"y\"", resource_metadata="https://h.example.com/prm", error=invalid_token"#
            ),
            (
                Some("https://h.example.com/prm".to_owned()),
                Some("x \"y\"".to_owned())
            )
        );
        assert_eq!(
            parse(r#"Bearer error="invalid_token", Basic resource_metadata="https://other/""#),
            (None, None),
            "parameters of a later scheme are not Bearer's"
        );
        assert_eq!(parse(r#"Basic realm="x""#), (None, None));
        assert_eq!(parse("bearer scope=a"), (None, Some("a".to_owned())));
        assert_eq!(parse(r#"Bearer scope="unterminated"#), (None, None));
    }

    #[tokio::test]
    async fn mcp_client_redirect_not_followed() {
        let (other, other_base) = serve(Cfg::default()).await;
        let (_fake, base) = serve(Cfg {
            status: Some((307, vec![("location", format!("{other_base}/mcp"))])),
            ..Cfg::default()
        })
        .await;
        let (platform, cred, url) = (dev(), credential(), url(&base, "/mcp"));
        let t = target(
            &url,
            &platform,
            Some(&cred),
            Transport::StreamableHttp,
            Limits::probe(),
        );
        assert_eq!(probe(&t).await.unwrap_err(), McpError::Protocol("redirect"));
        assert!(other.seen().is_empty());
    }

    #[tokio::test]
    async fn mcp_client_oversize_and_too_many_tools() {
        let mut big = tool("big", None);
        big["description"] = json!("d".repeat(8192));
        let (_fake, base) = serve(Cfg {
            tools: vec![big],
            ..Cfg::default()
        })
        .await;
        let (platform, url) = (dev(), url(&base, "/mcp"));
        let limits = Limits {
            max_response_bytes: 6000,
            ..Limits::probe()
        };
        let t = target(&url, &platform, None, Transport::StreamableHttp, limits);
        assert_eq!(probe(&t).await.unwrap_err(), McpError::TooLarge);

        let tools = (0..5).map(|i| tool(&format!("t{i}"), None)).collect();
        let (_fake, base) = serve(Cfg {
            tools,
            page_size: 1,
            ..Cfg::default()
        })
        .await;
        let url = self::url(&base, "/mcp");
        let t = target(
            &url,
            &platform,
            None,
            Transport::StreamableHttp,
            Limits::probe(),
        );
        assert_eq!(
            probe(&t).await.unwrap_err(),
            McpError::TooLarge,
            "more than four pages"
        );
        let limits = Limits {
            max_tools: 2,
            ..Limits::probe()
        };
        let t = target(&url, &platform, None, Transport::StreamableHttp, limits);
        assert_eq!(
            probe(&t).await.unwrap_err(),
            McpError::TooLarge,
            "more than max_tools"
        );
    }

    #[tokio::test]
    async fn mcp_client_call_timeout_after_send_is_unknown() {
        let (fake, base) = serve(Cfg {
            call_delay: Some(Duration::from_secs(5)),
            ..Cfg::default()
        })
        .await;
        let (platform, url) = (dev(), url(&base, "/mcp"));
        let limits = Limits {
            timeout: Duration::from_millis(800),
            ..Limits::call()
        };
        let t = target(&url, &platform, None, Transport::StreamableHttp, limits);
        assert_eq!(
            call_tool(&t, "search", Map::new()).await.unwrap_err(),
            McpError::OutcomeUnknown
        );
        assert!(fake
            .seen()
            .iter()
            .any(|s| s.rpc.as_deref() == Some("tools/call")));
    }

    #[tokio::test]
    async fn mcp_client_call_results_and_errors() {
        let (_fake, base) = serve(Cfg::default()).await;
        let (platform, url) = (dev(), url(&base, "/mcp"));
        let t = target(
            &url,
            &platform,
            None,
            Transport::StreamableHttp,
            Limits::call(),
        );
        let result = call_tool(&t, "fail", Map::new()).await.unwrap();
        assert_eq!(result["isError"], json!(true), "tool errors are results");

        let (_fake, base) = serve(Cfg {
            jsonrpc_error_on_call: true,
            ..Cfg::default()
        })
        .await;
        let url = self::url(&base, "/mcp");
        let t = target(
            &url,
            &platform,
            None,
            Transport::StreamableHttp,
            Limits::call(),
        );
        let error = call_tool(&t, "search", Map::new()).await.unwrap_err();
        assert_eq!(error, McpError::Protocol("jsonrpc-error"));
        assert!(!format!("{error:?}").contains("secret"));

        let (_fake, base) = serve(Cfg {
            protocol: "2023-01-01",
            ..Cfg::default()
        })
        .await;
        let url = self::url(&base, "/mcp");
        let t = target(
            &url,
            &platform,
            None,
            Transport::StreamableHttp,
            Limits::call(),
        );
        assert_eq!(
            call_tool(&t, "search", Map::new()).await.unwrap_err(),
            McpError::Protocol("protocol-version"),
            "refused before tools/call: the specific error"
        );
    }

    #[tokio::test]
    async fn mcp_client_egress_refusal() {
        let (fake, base) = serve(Cfg::default()).await;
        let platform = PlatformEgress {
            any_public_host: true,
            ..PlatformEgress::default()
        };
        let url = url(&base, "/mcp");
        let t = target(
            &url,
            &platform,
            None,
            Transport::StreamableHttp,
            Limits::probe(),
        );
        assert_eq!(
            probe(&t).await.unwrap_err(),
            McpError::Egress(EgressError::SchemeNotAllowed)
        );
        assert!(fake.seen().is_empty());
    }

    #[tokio::test]
    async fn mcp_client_rejects_invalid_tool_lists() {
        let cases = [
            vec![json!({"name": "bad name", "inputSchema": {"type": "object"}})],
            vec![json!({"name": "x".repeat(129), "inputSchema": {"type": "object"}})],
            vec![json!({"name": "ok", "inputSchema": {"type": "string"}})],
            vec![json!({"name": "ok"})],
            vec![json!({"name": "ok", "inputSchema": {"type": "object"}, "outputSchema": []})],
            vec![tool("dup", None), tool("dup", Some(true))],
        ];
        let platform = dev();
        for tools in cases {
            let (_fake, base) = serve(Cfg {
                tools,
                ..Cfg::default()
            })
            .await;
            let url = url(&base, "/mcp");
            let t = target(
                &url,
                &platform,
                None,
                Transport::StreamableHttp,
                Limits::probe(),
            );
            assert!(matches!(probe(&t).await, Err(McpError::Protocol(_))));
        }
    }

    #[test]
    fn mcp_client_sse_parser() {
        let mut parser = SseParser::default();
        let mut out = VecDeque::new();
        parser.feed(
            b": comment\r\nevent: endpoint\r\ndata: /m?x=1\r\n\r\ndata: a\nda",
            &mut out,
        );
        parser.feed(b"ta:b\n\nevent: ping\n\n", &mut out);
        assert_eq!(
            Vec::from(out),
            vec![
                SseEvent {
                    event: "endpoint".into(),
                    data: "/m?x=1".into()
                },
                SseEvent {
                    event: "message".into(),
                    data: "a\nb".into()
                },
            ]
        );
    }

    #[test]
    fn mcp_client_tools_digest_and_redaction() {
        let parse = |v: Value| parse_tool(&v).unwrap();
        let a = parse(tool("a", Some(true)));
        let b = parse(tool("b", None));
        let digest = tools_digest(&[a.clone(), b.clone()]);
        assert_eq!(digest.len(), 64);
        assert_eq!(
            digest,
            tools_digest(&[b.clone(), a.clone()]),
            "order independent"
        );
        let mut changed = b.clone();
        changed.annotations.destructive_hint = Some(false);
        assert_ne!(digest, tools_digest(&[a.clone(), changed]));
        let long = parse(json!({"name": "l", "title": "t".repeat(500),
            "description": "d".repeat(5000), "inputSchema": {"type": "object"}}));
        assert_eq!(long.title.unwrap().len(), 200);
        assert_eq!(long.description.unwrap().len(), 4000);

        let debug = format!("{:?}", credential());
        assert!(debug.contains("x-api-key") && !debug.contains("secret-key-1"));
    }
}
