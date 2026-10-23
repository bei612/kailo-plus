//! DD-149(6): OAuth 2.1 for user-registered external MCP connectors (MCP authorization,
//! 2025-06-18).
//!
//! Discovery follows the specification: the protected resource metadata (RFC 9728) is taken
//! from the `resource_metadata` hint of the endpoint's 401 challenge or from its well-known
//! URIs; the authorization server metadata (RFC 8414, falling back to OpenID discovery) must
//! name the same issuer and support PKCE `S256`. Dynamic client registration (RFC 7591) asks
//! for a public client; the authorization request and both token requests carry the
//! `resource` indicator (RFC 8707) of the endpoint. Every request of this module builds its
//! own pinned client through `mcp_egress::client` (each endpoint is checked against the
//! platform cap and the Tenant allowlist), responses are JSON bounded to 256 KiB, and errors
//! never carry upstream bodies, tokens or secrets.

// The connector actions and the BFF callback wire these helpers in; until then only tests use
// parts.

use std::fmt;
use std::time::Duration;

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use reqwest::{RequestBuilder, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::mcp_client::{self, Limits, McpError, Target, Transport};
use crate::mcp_egress::{self, EgressError, EgressScope};

const MAX_BODY_BYTES: usize = 256 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const PRM_WELL_KNOWN: &str = "/.well-known/oauth-protected-resource";
const AS_WELL_KNOWN: &str = "/.well-known/oauth-authorization-server";
const OIDC_WELL_KNOWN: &str = "/.well-known/openid-configuration";
const MAX_CLIENT_ID_BYTES: usize = 512;

/// Discovered authorization server of one connector endpoint (stored in Core's DB).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct AuthServer {
    pub(crate) issuer: String,
    #[serde(with = "url_text")]
    pub(crate) authorization_endpoint: Url,
    #[serde(with = "url_text")]
    pub(crate) token_endpoint: Url,
    #[serde(with = "url_text_opt")]
    pub(crate) registration_endpoint: Option<Url>,
    pub(crate) scopes: Vec<String>,
    /// RFC 8707 resource indicator: the canonical endpoint URL.
    pub(crate) resource: String,
}

mod url_text {
    use reqwest::Url;
    use serde::{Deserialize, Deserializer, Serializer};

    pub(super) fn serialize<S: Serializer>(url: &Url, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(url.as_str())
    }

    pub(super) fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Url, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Url::parse(&raw).map_err(serde::de::Error::custom)
    }
}

mod url_text_opt {
    use reqwest::Url;
    use serde::{Deserialize, Deserializer, Serializer};

    pub(super) fn serialize<S: Serializer>(
        url: &Option<Url>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        match url {
            Some(url) => serializer.serialize_some(url.as_str()),
            None => serializer.serialize_none(),
        }
    }

    pub(super) fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<Url>, D::Error> {
        Option::<String>::deserialize(deserializer)?
            .map(|raw| Url::parse(&raw).map_err(serde::de::Error::custom))
            .transpose()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum OAuthError {
    Egress(EgressError),
    Discovery(&'static str),
    Registration(&'static str),
    Token(&'static str),
    /// The grant (code or refresh token) is no longer valid: re-authorization is needed.
    InvalidGrant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum TokenAuth {
    None,
    ClientSecretBasic,
    ClientSecretPost,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ClientRegistration {
    pub(crate) client_id: String,
    pub(crate) client_secret: Option<String>,
    pub(crate) auth: TokenAuth,
}

impl fmt::Debug for ClientRegistration {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ClientRegistration")
            .field("client_id", &self.client_id)
            .field(
                "client_secret",
                &self.client_secret.as_ref().map(|_| "<redacted>"),
            )
            .field("auth", &self.auth)
            .finish()
    }
}

pub(crate) struct Pkce {
    pub(crate) verifier: String,
    pub(crate) challenge: String,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
pub(crate) struct TokenSet {
    pub(crate) access_token: String,
    pub(crate) token_type: String,
    pub(crate) refresh_token: Option<String>,
    /// Unix seconds.
    pub(crate) expires_at: Option<i64>,
    pub(crate) scope: Option<String>,
}

impl fmt::Debug for TokenSet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TokenSet")
            .field("access_token", &"<redacted>")
            .field("token_type", &self.token_type)
            .field(
                "refresh_token",
                &self.refresh_token.as_ref().map(|_| "<redacted>"),
            )
            .field("expires_at", &self.expires_at)
            .field("scope", &self.scope)
            .finish()
    }
}

/// Why one HTTP exchange produced no usable answer.
enum Failure {
    Egress(EgressError),
    Transport,
}

fn json_media_type(response: &reqwest::Response) -> bool {
    let media = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    media == "application/json" || media.ends_with("+json")
}

/// One request on a client pinned to `url`'s host; the body is returned only when it is a
/// bounded JSON object.
async fn exchange_json(
    scope: &EgressScope<'_>,
    url: &Url,
    build: impl FnOnce(&reqwest::Client) -> RequestBuilder,
) -> Result<(StatusCode, Option<Value>), Failure> {
    let client = mcp_egress::client(scope, url, REQUEST_TIMEOUT)
        .await
        .map_err(Failure::Egress)?;
    let mut response = build(&client)
        .header(ACCEPT, "application/json")
        .send()
        .await
        .map_err(|_| Failure::Transport)?;
    let status = response.status();
    if !json_media_type(&response)
        || response
            .content_length()
            .is_some_and(|length| length > MAX_BODY_BYTES as u64)
    {
        return Ok((status, None));
    }
    let mut body = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if body.len() + chunk.len() > MAX_BODY_BYTES {
                    return Ok((status, None));
                }
                body.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(_) => return Err(Failure::Transport),
        }
    }
    let value = serde_json::from_slice::<Value>(&body)
        .ok()
        .filter(Value::is_object);
    Ok((status, value))
}

/// A metadata document: `None` when absent, unreachable or not JSON; egress refusals fail.
async fn metadata(scope: &EgressScope<'_>, url: &Url) -> Result<Option<Value>, OAuthError> {
    match exchange_json(scope, url, |client| client.get(url.clone())).await {
        Ok((status, value)) if status.is_success() => Ok(value),
        Ok(_) | Err(Failure::Transport) => Ok(None),
        Err(Failure::Egress(error)) => Err(OAuthError::Egress(error)),
    }
}

fn well_known(url: &Url, suffix: &str, path: &str) -> Option<Url> {
    Url::parse(&format!(
        "{}{suffix}{path}",
        url.origin().ascii_serialization()
    ))
    .ok()
}

/// RFC 9728 §3.3: the metadata must describe this endpoint: the endpoint URL itself, or its
/// origin or a path prefix of it.
fn resource_matches(resource: &str, endpoint: &Url) -> bool {
    if resource == endpoint.as_str() {
        return true;
    }
    let Ok(resource) = Url::parse(resource) else {
        return false;
    };
    let prefix = resource.path().trim_end_matches('/');
    resource.origin() == endpoint.origin()
        && resource.query().is_none()
        && resource.fragment().is_none()
        && resource.username().is_empty()
        && (prefix.is_empty()
            || endpoint.path() == prefix
            || endpoint
                .path()
                .strip_prefix(prefix)
                .is_some_and(|rest| rest.starts_with('/')))
}

/// An endpoint named by metadata: the connector URL rules and the egress scope apply.
fn metadata_endpoint(
    scope: &EgressScope<'_>,
    document: &Value,
    key: &str,
) -> Result<Option<Url>, OAuthError> {
    let Some(raw) = document.get(key) else {
        return Ok(None);
    };
    let raw = raw.as_str().ok_or(OAuthError::Discovery("endpoint"))?;
    let url = mcp_egress::parse_endpoint(raw).map_err(OAuthError::Egress)?;
    // The authorization endpoint is opened by the browser, never resolved by Core, so the
    // scheme rule is applied here: `http` only where the deployment lists dev CIDRs.
    if url.scheme() != "https" && scope.platform.dev_cidrs.is_empty() {
        return Err(OAuthError::Egress(EgressError::SchemeNotAllowed));
    }
    let host = url.host_str().ok_or(OAuthError::Discovery("endpoint"))?;
    if !mcp_egress::host_permitted(scope, host) {
        return Err(OAuthError::Egress(EgressError::NotInAllowlist));
    }
    Ok(Some(url))
}

fn strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn same_issuer(a: &str, b: &str) -> bool {
    a.trim_end_matches('/') == b.trim_end_matches('/')
}

/// RFC 8414 §3.1 path insertion, then OpenID discovery (path insertion and appending).
async fn authorization_server_metadata(
    scope: &EgressScope<'_>,
    issuer: &str,
) -> Result<Value, OAuthError> {
    let issuer_url = mcp_egress::parse_endpoint(issuer).map_err(OAuthError::Egress)?;
    let path = issuer_url.path().trim_end_matches('/');
    let mut candidates = vec![
        well_known(&issuer_url, AS_WELL_KNOWN, path),
        well_known(&issuer_url, OIDC_WELL_KNOWN, path),
    ];
    if !path.is_empty() {
        candidates.push(
            Url::parse(&format!(
                "{}{path}{OIDC_WELL_KNOWN}",
                issuer_url.origin().ascii_serialization()
            ))
            .ok(),
        );
    }
    for url in candidates.into_iter().flatten() {
        let Some(document) = metadata(scope, &url).await? else {
            continue;
        };
        let named = document.get("issuer").and_then(Value::as_str);
        if !named.is_some_and(|named| same_issuer(named, issuer)) {
            return Err(OAuthError::Discovery("issuer"));
        }
        return Ok(document);
    }
    Err(OAuthError::Discovery("authorization-server-metadata"))
}

pub(crate) async fn discover(
    scope: &EgressScope<'_>,
    endpoint: &Url,
    transport: Transport,
    resource_metadata: Option<&str>,
    challenge_scope: Option<&str>,
) -> Result<AuthServer, OAuthError> {
    let mut metadata_url = resource_metadata.map(str::to_owned);
    let mut scope_hint = challenge_scope.map(str::to_owned);
    if metadata_url.is_none() {
        let target = Target {
            url: endpoint,
            transport,
            credential: None,
            scope: *scope,
            limits: Limits::probe(),
        };
        match mcp_client::handshake(&target).await {
            Err(McpError::Unauthorized {
                resource_metadata: hinted_metadata,
                scope: hinted_scope,
            }) => {
                metadata_url = hinted_metadata;
                scope_hint = scope_hint.or(hinted_scope);
            }
            Err(McpError::Egress(error)) => return Err(OAuthError::Egress(error)),
            // No challenge: the well-known locations still apply.
            _ => {}
        }
    }

    let resource_document = match metadata_url {
        Some(raw) => {
            let url = mcp_egress::parse_endpoint(&raw).map_err(OAuthError::Egress)?;
            metadata(scope, &url)
                .await?
                .ok_or(OAuthError::Discovery("resource-metadata"))?
        }
        None => {
            let path = endpoint.path().trim_end_matches('/');
            let mut candidates = vec![well_known(endpoint, PRM_WELL_KNOWN, path)];
            if !path.is_empty() {
                candidates.push(well_known(endpoint, PRM_WELL_KNOWN, ""));
            }
            let mut found = None;
            for url in candidates.into_iter().flatten() {
                if let Some(document) = metadata(scope, &url).await? {
                    found = Some(document);
                    break;
                }
            }
            found.ok_or(OAuthError::Discovery("resource-metadata"))?
        }
    };
    let resource = resource_document
        .get("resource")
        .and_then(Value::as_str)
        .ok_or(OAuthError::Discovery("resource"))?;
    if !resource_matches(resource, endpoint) {
        return Err(OAuthError::Discovery("resource"));
    }
    let issuer = resource_document
        .get("authorization_servers")
        .and_then(Value::as_array)
        .and_then(|servers| servers.first())
        .and_then(Value::as_str)
        .ok_or(OAuthError::Discovery("authorization-servers"))?;

    let document = authorization_server_metadata(scope, issuer).await?;
    if !strings(document.get("code_challenge_methods_supported"))
        .iter()
        .any(|method| method == "S256")
    {
        return Err(OAuthError::Discovery("pkce-s256"));
    }
    if document.get("response_types_supported").is_some()
        && !strings(document.get("response_types_supported"))
            .iter()
            .any(|kind| kind == "code")
    {
        return Err(OAuthError::Discovery("response-type"));
    }
    let authorization_endpoint = metadata_endpoint(scope, &document, "authorization_endpoint")?
        .ok_or(OAuthError::Discovery("authorization-endpoint"))?;
    let token_endpoint = metadata_endpoint(scope, &document, "token_endpoint")?
        .ok_or(OAuthError::Discovery("token-endpoint"))?;
    let registration_endpoint = metadata_endpoint(scope, &document, "registration_endpoint")?;
    let scopes = match scope_hint {
        Some(hint) => hint.split_whitespace().map(str::to_owned).collect(),
        None => strings(resource_document.get("scopes_supported")),
    };
    Ok(AuthServer {
        issuer: document
            .get("issuer")
            .and_then(Value::as_str)
            .unwrap_or(issuer)
            .to_owned(),
        authorization_endpoint,
        token_endpoint,
        registration_endpoint,
        scopes,
        resource: endpoint.as_str().to_owned(),
    })
}

pub(crate) async fn register(
    scope: &EgressScope<'_>,
    server: &AuthServer,
    redirect_uri: &str,
    client_name: &str,
) -> Result<ClientRegistration, OAuthError> {
    let url = server
        .registration_endpoint
        .as_ref()
        .ok_or(OAuthError::Registration("unsupported"))?;
    let body = json!({
        "client_name": client_name,
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    });
    let (status, document) =
        exchange_json(scope, url, |client| client.post(url.clone()).json(&body))
            .await
            .map_err(|failure| match failure {
                Failure::Egress(error) => OAuthError::Egress(error),
                Failure::Transport => OAuthError::Registration("unreachable"),
            })?;
    if !status.is_success() {
        return Err(OAuthError::Registration("rejected"));
    }
    let document = document.ok_or(OAuthError::Registration("response"))?;
    let client_id = document
        .get("client_id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && id.len() <= MAX_CLIENT_ID_BYTES)
        .ok_or(OAuthError::Registration("client-id"))?
        .to_owned();
    let client_secret = document
        .get("client_secret")
        .and_then(Value::as_str)
        .filter(|secret| !secret.is_empty())
        .map(str::to_owned);
    let method = document
        .get("token_endpoint_auth_method")
        .and_then(Value::as_str)
        .unwrap_or(if client_secret.is_some() {
            "client_secret_basic"
        } else {
            "none"
        });
    let auth = match method {
        "none" => TokenAuth::None,
        "client_secret_basic" => TokenAuth::ClientSecretBasic,
        "client_secret_post" => TokenAuth::ClientSecretPost,
        _ => return Err(OAuthError::Registration("auth-method")),
    };
    if auth != TokenAuth::None && client_secret.is_none() {
        return Err(OAuthError::Registration("client-secret"));
    }
    Ok(ClientRegistration {
        client_id,
        client_secret: if auth == TokenAuth::None {
            None
        } else {
            client_secret
        },
        auth,
    })
}

fn random_url_safe() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("系统随机源不可用");
    URL_SAFE_NO_PAD.encode(bytes)
}

pub(crate) fn pkce() -> Pkce {
    let verifier = random_url_safe();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    Pkce {
        verifier,
        challenge,
    }
}

pub(crate) fn random_state() -> String {
    random_url_safe()
}

pub(crate) fn authorization_url(
    server: &AuthServer,
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    challenge: &str,
) -> Url {
    let mut url = server.authorization_endpoint.clone();
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("response_type", "code")
            .append_pair("client_id", client_id)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("state", state)
            .append_pair("code_challenge", challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("resource", &server.resource);
        if !server.scopes.is_empty() {
            query.append_pair("scope", &server.scopes.join(" "));
        }
    }
    url
}

/// `application/x-www-form-urlencoded` byte serialization (RFC 6749 §2.3.1 for Basic).
fn form_encode(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for b in raw.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => {
                out.push(char::from(b))
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn token_set(document: &Value, previous_refresh: Option<&str>) -> Result<TokenSet, OAuthError> {
    let access_token = document
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|token| !token.is_empty())
        .ok_or(OAuthError::Token("access-token"))?
        .to_owned();
    if !document
        .get("token_type")
        .and_then(Value::as_str)
        .is_some_and(|kind| kind.eq_ignore_ascii_case("bearer"))
    {
        return Err(OAuthError::Token("token-type"));
    }
    let expires_at = document
        .get("expires_in")
        .and_then(Value::as_i64)
        .filter(|seconds| *seconds > 0)
        .map(|seconds| chrono::Utc::now().timestamp().saturating_add(seconds));
    Ok(TokenSet {
        access_token,
        token_type: "Bearer".to_owned(),
        refresh_token: document
            .get("refresh_token")
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
            .or(previous_refresh)
            .map(str::to_owned),
        expires_at,
        scope: document
            .get("scope")
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
}

async fn token_request(
    scope: &EgressScope<'_>,
    server: &AuthServer,
    client: &ClientRegistration,
    mut form: Vec<(&'static str, String)>,
    previous_refresh: Option<&str>,
) -> Result<TokenSet, OAuthError> {
    form.push(("resource", server.resource.clone()));
    let mut basic = None;
    match client.auth {
        TokenAuth::None => form.push(("client_id", client.client_id.clone())),
        TokenAuth::ClientSecretPost => {
            form.push(("client_id", client.client_id.clone()));
            form.push((
                "client_secret",
                client.client_secret.clone().unwrap_or_default(),
            ));
        }
        TokenAuth::ClientSecretBasic => {
            let pair = format!(
                "{}:{}",
                form_encode(&client.client_id),
                form_encode(client.client_secret.as_deref().unwrap_or_default())
            );
            let mut value =
                reqwest::header::HeaderValue::from_str(&format!("Basic {}", STANDARD.encode(pair)))
                    .map_err(|_| OAuthError::Token("client"))?;
            value.set_sensitive(true);
            basic = Some(value);
        }
    }
    let url = &server.token_endpoint;
    let (status, document) = exchange_json(scope, url, |http| {
        let request = http.post(url.clone()).form(&form);
        match basic {
            Some(value) => request.header(AUTHORIZATION, value),
            None => request,
        }
    })
    .await
    .map_err(|failure| match failure {
        Failure::Egress(error) => OAuthError::Egress(error),
        Failure::Transport => OAuthError::Token("unreachable"),
    })?;
    if status.is_success() {
        return token_set(
            &document.ok_or(OAuthError::Token("response"))?,
            previous_refresh,
        );
    }
    let error = document
        .as_ref()
        .and_then(|document| document.get("error"))
        .and_then(Value::as_str);
    if matches!(status, StatusCode::BAD_REQUEST | StatusCode::UNAUTHORIZED)
        && error == Some("invalid_grant")
    {
        return Err(OAuthError::InvalidGrant);
    }
    Err(OAuthError::Token("rejected"))
}

pub(crate) async fn exchange(
    scope: &EgressScope<'_>,
    server: &AuthServer,
    client: &ClientRegistration,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<TokenSet, OAuthError> {
    let form = vec![
        ("grant_type", "authorization_code".to_owned()),
        ("code", code.to_owned()),
        ("redirect_uri", redirect_uri.to_owned()),
        ("code_verifier", verifier.to_owned()),
    ];
    token_request(scope, server, client, form, None).await
}

pub(crate) async fn refresh(
    scope: &EgressScope<'_>,
    server: &AuthServer,
    client: &ClientRegistration,
    refresh_token: &str,
) -> Result<TokenSet, OAuthError> {
    let form = vec![
        ("grant_type", "refresh_token".to_owned()),
        ("refresh_token", refresh_token.to_owned()),
    ];
    token_request(scope, server, client, form, Some(refresh_token)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp_egress::{Cidr, PlatformEgress};
    use axum::{
        body::Bytes,
        extract::State,
        http::{HeaderMap, Method, StatusCode as AxStatus, Uri},
        response::{IntoResponse, Response},
        Json, Router,
    };
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    #[derive(Clone)]
    struct Cfg {
        base: String,
        prm_hint: bool,
        issuer_path: &'static str,
        oidc_only: bool,
        s256: bool,
        prm_resource: Option<String>,
        issuer_override: Option<String>,
        challenge: Option<String>,
        rotate: bool,
        token_type: &'static str,
        registration_method: &'static str,
    }

    #[derive(Default)]
    struct Fake {
        cfg: Mutex<Option<Cfg>>,
        log: Mutex<Vec<(Method, String, HeaderMap)>>,
    }

    impl Fake {
        fn cfg(&self, change: impl FnOnce(&mut Cfg)) {
            change(self.cfg.lock().unwrap().as_mut().unwrap());
        }
        fn paths(&self) -> Vec<String> {
            self.log
                .lock()
                .unwrap()
                .iter()
                .map(|(_, p, _)| p.clone())
                .collect()
        }
    }

    fn form(body: &[u8]) -> HashMap<String, String> {
        let raw = String::from_utf8_lossy(body);
        Url::parse(&format!("http://x/?{raw}"))
            .unwrap()
            .query_pairs()
            .into_owned()
            .collect()
    }

    fn oauth_error(code: &str) -> Response {
        (
            AxStatus::BAD_REQUEST,
            Json(json!({"error": code, "error_description": "upstream detail"})),
        )
            .into_response()
    }

    async fn handle(
        State(fake): State<Arc<Fake>>,
        method: Method,
        uri: Uri,
        headers: HeaderMap,
        body: Bytes,
    ) -> Response {
        fake.log
            .lock()
            .unwrap()
            .push((method.clone(), uri.path().to_owned(), headers.clone()));
        let cfg = fake.cfg.lock().unwrap().clone().unwrap();
        let base = cfg.base.clone();
        let issuer = format!("{base}{}", cfg.issuer_path);
        let as_path = if cfg.oidc_only {
            format!("{}{OIDC_WELL_KNOWN}", cfg.issuer_path)
        } else {
            format!("{AS_WELL_KNOWN}{}", cfg.issuer_path)
        };
        let path = uri.path();
        if method == Method::POST && path == "/mcp" {
            let challenge = if cfg.prm_hint {
                format!(
                    r#"Bearer resource_metadata="{base}{PRM_WELL_KNOWN}/mcp", scope="files:read""#
                )
            } else {
                r#"Bearer realm="mcp""#.to_owned()
            };
            return (AxStatus::UNAUTHORIZED, [("www-authenticate", challenge)]).into_response();
        }
        if method == Method::GET && path == format!("{PRM_WELL_KNOWN}/mcp") {
            return Json(json!({
                "resource": cfg.prm_resource.clone().unwrap_or(format!("{base}/mcp")),
                "authorization_servers": [issuer],
                "scopes_supported": ["files:read", "files:write"],
            }))
            .into_response();
        }
        if method == Method::GET && path == as_path {
            let mut document = json!({
                "issuer": cfg.issuer_override.clone().unwrap_or(issuer),
                "authorization_endpoint": format!("{base}/authorize"),
                "token_endpoint": format!("{base}/token"),
                "registration_endpoint": format!("{base}/register"),
                "response_types_supported": ["code"],
            });
            if cfg.s256 {
                document["code_challenge_methods_supported"] = json!(["plain", "S256"]);
            }
            return Json(document).into_response();
        }
        if method == Method::POST && path == "/register" {
            let request: Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(
                request["redirect_uris"],
                json!(["https://kailo.example.com/cb"])
            );
            assert_eq!(
                request["grant_types"],
                json!(["authorization_code", "refresh_token"])
            );
            assert_eq!(request["response_types"], json!(["code"]));
            assert_eq!(request["token_endpoint_auth_method"], json!("none"));
            assert_eq!(request["client_name"], json!("Kailo"));
            let mut reply = json!({"client_id": "client-1",
                "token_endpoint_auth_method": cfg.registration_method});
            if cfg.registration_method != "none" {
                reply["client_secret"] = json!("s@cret");
            }
            return (AxStatus::CREATED, Json(reply)).into_response();
        }
        if method == Method::POST && path == "/token" {
            let form = form(&body);
            if form.get("resource") != Some(&format!("{base}/mcp")) {
                return oauth_error("invalid_target");
            }
            match cfg.registration_method {
                "client_secret_basic" => {
                    let expected = format!("Basic {}", STANDARD.encode("client-1:s%40cret"));
                    if headers.get("authorization").and_then(|v| v.to_str().ok())
                        != Some(expected.as_str())
                        || form.contains_key("client_secret")
                    {
                        return (
                            AxStatus::UNAUTHORIZED,
                            Json(json!({"error": "invalid_client"})),
                        )
                            .into_response();
                    }
                }
                _ => {
                    if form.get("client_id").map(String::as_str) != Some("client-1") {
                        return (
                            AxStatus::UNAUTHORIZED,
                            Json(json!({"error": "invalid_client"})),
                        )
                            .into_response();
                    }
                }
            }
            let reply = match form.get("grant_type").map(String::as_str) {
                Some("authorization_code") => {
                    let verifier = form.get("code_verifier").cloned().unwrap_or_default();
                    let computed = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
                    if form.get("code").map(String::as_str) != Some("code-1")
                        || form.get("redirect_uri").map(String::as_str)
                            != Some("https://kailo.example.com/cb")
                        || cfg.challenge.as_deref() != Some(computed.as_str())
                    {
                        return oauth_error("invalid_grant");
                    }
                    json!({"access_token": "at-1", "token_type": cfg.token_type,
                        "expires_in": 3600, "refresh_token": "rt-1", "scope": "files:read"})
                }
                Some("refresh_token") => {
                    if form.get("refresh_token").map(String::as_str) != Some("rt-1") {
                        return oauth_error("invalid_grant");
                    }
                    let mut reply = json!({"access_token": "at-2", "token_type": "bearer"});
                    if cfg.rotate {
                        reply["refresh_token"] = json!("rt-2");
                    }
                    reply
                }
                _ => return oauth_error("unsupported_grant_type"),
            };
            return Json(reply).into_response();
        }
        AxStatus::NOT_FOUND.into_response()
    }

    async fn serve() -> (Arc<Fake>, String) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let fake = Arc::new(Fake::default());
        *fake.cfg.lock().unwrap() = Some(Cfg {
            base: base.clone(),
            prm_hint: true,
            issuer_path: "/tenant1",
            oidc_only: false,
            s256: true,
            prm_resource: None,
            issuer_override: None,
            challenge: None,
            rotate: true,
            token_type: "Bearer",
            registration_method: "none",
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

    const REDIRECT: &str = "https://kailo.example.com/cb";

    #[tokio::test]
    async fn mcp_oauth_discovery_via_401_hint() {
        let (fake, base) = serve().await;
        let platform = dev();
        let scope = EgressScope {
            platform: &platform,
            tenant_suffixes: &[],
        };
        let endpoint = Url::parse(&format!("{base}/mcp")).unwrap();
        let server = discover(&scope, &endpoint, Transport::StreamableHttp, None, None)
            .await
            .unwrap();
        assert_eq!(server.issuer, format!("{base}/tenant1"));
        assert_eq!(
            server.authorization_endpoint.as_str(),
            format!("{base}/authorize")
        );
        assert_eq!(server.token_endpoint.as_str(), format!("{base}/token"));
        assert_eq!(
            server.registration_endpoint.as_ref().map(Url::as_str),
            Some(format!("{base}/register").as_str())
        );
        assert_eq!(server.scopes, ["files:read"], "challenge scope wins");
        assert_eq!(server.resource, format!("{base}/mcp"));
        let paths = fake.paths();
        assert_eq!(paths[0], "/mcp");
        assert!(paths.contains(&format!("{AS_WELL_KNOWN}/tenant1")));
        assert!(
            fake.log
                .lock()
                .unwrap()
                .iter()
                .all(|(_, _, h)| h.get("authorization").is_none()),
            "discovery is unauthenticated"
        );

        let stored = serde_json::to_value(&server).unwrap();
        assert_eq!(
            serde_json::from_value::<AuthServer>(stored).unwrap(),
            server
        );

        // An explicit hint skips the unauthenticated initialize.
        fake.log.lock().unwrap().clear();
        let hint = format!("{base}{PRM_WELL_KNOWN}/mcp");
        let server = discover(
            &scope,
            &endpoint,
            Transport::StreamableHttp,
            Some(hint.as_str()),
            None,
        )
        .await
        .unwrap();
        assert_eq!(server.scopes, ["files:read", "files:write"]);
        assert!(!fake.paths().contains(&"/mcp".to_owned()));
    }

    #[tokio::test]
    async fn mcp_oauth_discovery_via_well_known_and_oidc() {
        let (fake, base) = serve().await;
        fake.cfg(|c| {
            c.prm_hint = false;
            c.oidc_only = true;
        });
        let platform = dev();
        let scope = EgressScope {
            platform: &platform,
            tenant_suffixes: &[],
        };
        let endpoint = Url::parse(&format!("{base}/mcp")).unwrap();
        let server = discover(&scope, &endpoint, Transport::StreamableHttp, None, None)
            .await
            .unwrap();
        assert_eq!(server.scopes, ["files:read", "files:write"]);
        assert_eq!(server.issuer, format!("{base}/tenant1"));
        let paths = fake.paths();
        assert!(paths.contains(&format!("{PRM_WELL_KNOWN}/mcp")));
        assert!(
            paths.contains(&format!("{AS_WELL_KNOWN}/tenant1")),
            "RFC 8414 tried first"
        );
        assert_eq!(paths.last().unwrap(), &format!("/tenant1{OIDC_WELL_KNOWN}"));
    }

    #[tokio::test]
    async fn mcp_oauth_discovery_refusals() {
        let (fake, base) = serve().await;
        let platform = dev();
        let scope = EgressScope {
            platform: &platform,
            tenant_suffixes: &[],
        };
        let endpoint = Url::parse(&format!("{base}/mcp")).unwrap();
        let run = || discover(&scope, &endpoint, Transport::StreamableHttp, None, None);

        fake.cfg(|c| c.s256 = false);
        assert_eq!(run().await.unwrap_err(), OAuthError::Discovery("pkce-s256"));
        fake.cfg(|c| {
            c.s256 = true;
            c.prm_resource = Some("https://other.example.com/mcp".to_owned());
        });
        assert_eq!(run().await.unwrap_err(), OAuthError::Discovery("resource"));
        fake.cfg(|c| {
            c.prm_resource = Some(base.clone());
            c.issuer_override = Some("https://evil.example.com".to_owned());
        });
        assert_eq!(
            run().await.unwrap_err(),
            OAuthError::Discovery("issuer"),
            "origin resource ok"
        );
        fake.cfg(|c| c.issuer_override = None);
        assert!(run().await.is_ok());

        let tenant = vec!["example.com".to_owned()];
        let narrowed = EgressScope {
            platform: &platform,
            tenant_suffixes: &tenant,
        };
        assert_eq!(
            discover(&narrowed, &endpoint, Transport::StreamableHttp, None, None)
                .await
                .unwrap_err(),
            OAuthError::Egress(EgressError::NotInAllowlist)
        );

        assert!(resource_matches(
            "https://h.example.com",
            &Url::parse("https://h.example.com/a/mcp").unwrap()
        ));
        assert!(resource_matches(
            "https://h.example.com/a/",
            &Url::parse("https://h.example.com/a/mcp").unwrap()
        ));
        assert!(!resource_matches(
            "https://h.example.com/a/m",
            &Url::parse("https://h.example.com/a/mcp").unwrap()
        ));
        assert!(!resource_matches(
            "https://h.example.com:444/",
            &Url::parse("https://h.example.com/a").unwrap()
        ));
    }

    #[tokio::test]
    async fn mcp_oauth_registration_and_authorization_url() {
        let (_fake, base) = serve().await;
        let platform = dev();
        let scope = EgressScope {
            platform: &platform,
            tenant_suffixes: &[],
        };
        let endpoint = Url::parse(&format!("{base}/mcp")).unwrap();
        let server = discover(&scope, &endpoint, Transport::StreamableHttp, None, None)
            .await
            .unwrap();
        let client = register(&scope, &server, REDIRECT, "Kailo").await.unwrap();
        assert_eq!(client.client_id, "client-1");
        assert_eq!(client.auth, TokenAuth::None);
        assert_eq!(client.client_secret, None);

        let pkce = pkce();
        let url = authorization_url(
            &server,
            &client.client_id,
            REDIRECT,
            "st-1",
            &pkce.challenge,
        );
        let query: HashMap<String, String> = url.query_pairs().into_owned().collect();
        assert_eq!(url.path(), "/authorize");
        assert_eq!(query["response_type"], "code");
        assert_eq!(query["client_id"], "client-1");
        assert_eq!(query["redirect_uri"], REDIRECT);
        assert_eq!(query["state"], "st-1");
        assert_eq!(query["code_challenge"], pkce.challenge);
        assert_eq!(query["code_challenge_method"], "S256");
        assert_eq!(query["resource"], format!("{base}/mcp"));
        assert_eq!(query["scope"], "files:read");
        let mut unscoped = server.clone();
        unscoped.scopes.clear();
        let url = authorization_url(&unscoped, "c", REDIRECT, "s", "x");
        assert!(url.query_pairs().all(|(k, _)| k != "scope"));

        let mut no_dcr = server.clone();
        no_dcr.registration_endpoint = None;
        assert_eq!(
            register(&scope, &no_dcr, REDIRECT, "Kailo")
                .await
                .unwrap_err(),
            OAuthError::Registration("unsupported")
        );
    }

    #[tokio::test]
    async fn mcp_oauth_exchange_and_refresh() {
        let (fake, base) = serve().await;
        let platform = dev();
        let scope = EgressScope {
            platform: &platform,
            tenant_suffixes: &[],
        };
        let endpoint = Url::parse(&format!("{base}/mcp")).unwrap();
        let server = discover(&scope, &endpoint, Transport::StreamableHttp, None, None)
            .await
            .unwrap();
        let client = register(&scope, &server, REDIRECT, "Kailo").await.unwrap();
        let pkce = pkce();
        fake.cfg(|c| c.challenge = Some(pkce.challenge.clone()));

        let wrong = super::pkce();
        assert_eq!(
            exchange(
                &scope,
                &server,
                &client,
                "code-1",
                &wrong.verifier,
                REDIRECT
            )
            .await
            .unwrap_err(),
            OAuthError::InvalidGrant,
            "server verifies PKCE"
        );
        let tokens = exchange(&scope, &server, &client, "code-1", &pkce.verifier, REDIRECT)
            .await
            .unwrap();
        assert_eq!(tokens.access_token, "at-1");
        assert_eq!(tokens.token_type, "Bearer");
        assert_eq!(tokens.refresh_token.as_deref(), Some("rt-1"));
        assert_eq!(tokens.scope.as_deref(), Some("files:read"));
        let now = chrono::Utc::now().timestamp();
        assert!((now + 3590..=now + 3600).contains(&tokens.expires_at.unwrap()));
        let debug = format!("{tokens:?}");
        assert!(!debug.contains("at-1") && !debug.contains("rt-1"));

        let rotated = refresh(&scope, &server, &client, "rt-1").await.unwrap();
        assert_eq!(rotated.access_token, "at-2");
        assert_eq!(rotated.refresh_token.as_deref(), Some("rt-2"));
        assert_eq!(rotated.expires_at, None);
        fake.cfg(|c| c.rotate = false);
        let kept = refresh(&scope, &server, &client, "rt-1").await.unwrap();
        assert_eq!(
            kept.refresh_token.as_deref(),
            Some("rt-1"),
            "old refresh token kept"
        );
        assert_eq!(
            refresh(&scope, &server, &client, "rt-stale")
                .await
                .unwrap_err(),
            OAuthError::InvalidGrant
        );

        let mut other_resource = server.clone();
        other_resource.resource = format!("{base}/other");
        assert_eq!(
            refresh(&scope, &other_resource, &client, "rt-1")
                .await
                .unwrap_err(),
            OAuthError::Token("rejected"),
            "server checks the resource indicator"
        );

        fake.cfg(|c| c.token_type = "mac");
        assert_eq!(
            exchange(&scope, &server, &client, "code-1", &pkce.verifier, REDIRECT)
                .await
                .unwrap_err(),
            OAuthError::Token("token-type")
        );
    }

    #[tokio::test]
    async fn mcp_oauth_client_secret_basic() {
        let (fake, base) = serve().await;
        fake.cfg(|c| c.registration_method = "client_secret_basic");
        let platform = dev();
        let scope = EgressScope {
            platform: &platform,
            tenant_suffixes: &[],
        };
        let endpoint = Url::parse(&format!("{base}/mcp")).unwrap();
        let server = discover(&scope, &endpoint, Transport::StreamableHttp, None, None)
            .await
            .unwrap();
        let client = register(&scope, &server, REDIRECT, "Kailo").await.unwrap();
        assert_eq!(client.auth, TokenAuth::ClientSecretBasic);
        assert_eq!(client.client_secret.as_deref(), Some("s@cret"));
        assert!(!format!("{client:?}").contains("s@cret"));
        let tokens = refresh(&scope, &server, &client, "rt-1").await.unwrap();
        assert_eq!(tokens.access_token, "at-2");
    }

    #[test]
    fn mcp_oauth_metadata_endpoint_rules() {
        let production = PlatformEgress {
            any_public_host: true,
            ..PlatformEgress::default()
        };
        let scope = EgressScope {
            platform: &production,
            tenant_suffixes: &[],
        };
        let document = json!({
            "a": "http://as.example.com/authorize",
            "b": "https://as.example.com/authorize",
            "c": "https://as.example.com/authorize?x=1",
            "d": "https://localhost/authorize",
        });
        assert_eq!(
            metadata_endpoint(&scope, &document, "a").unwrap_err(),
            OAuthError::Egress(EgressError::SchemeNotAllowed)
        );
        assert!(metadata_endpoint(&scope, &document, "b").unwrap().is_some());
        assert_eq!(
            metadata_endpoint(&scope, &document, "c").unwrap_err(),
            OAuthError::Egress(EgressError::InvalidUrl)
        );
        assert_eq!(
            metadata_endpoint(&scope, &document, "d").unwrap_err(),
            OAuthError::Egress(EgressError::HostNotAllowed)
        );
        assert_eq!(
            metadata_endpoint(&scope, &document, "missing").unwrap(),
            None
        );
        let tenant = vec!["vendor.io".to_owned()];
        let narrowed = EgressScope {
            platform: &production,
            tenant_suffixes: &tenant,
        };
        assert_eq!(
            metadata_endpoint(&narrowed, &document, "b").unwrap_err(),
            OAuthError::Egress(EgressError::NotInAllowlist)
        );
    }

    #[test]
    fn mcp_oauth_pkce_and_state() {
        let pkce = pkce();
        assert_eq!(pkce.verifier.len(), 43);
        assert!(pkce
            .verifier
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
        assert_eq!(
            pkce.challenge,
            URL_SAFE_NO_PAD.encode(Sha256::digest(pkce.verifier.as_bytes()))
        );
        assert_ne!(random_state(), random_state());
        assert_eq!(form_encode("a b@c~"), "a+b%40c%7E");
    }
}
