//! RFC 8252 原生应用登录：系统浏览器、回环回调、PKCE S256 与 `state`。
//!
//! 登录不设超时：用户在 IdP 上可能要花任意长的时间（多因素、找口令），一个
//! 写死的时限只会把正常登录判为失败。取而代之的是可取消——前端随时可以放弃
//! 这次等待（`cancel`），回环监听随之关闭。

use std::collections::HashMap;
use std::sync::Mutex;

use axum::extract::{Query, State as AxumState};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use url::Url;

use super::config::KailoConfig;

/// 回调页。只告诉用户可以回到应用，不回显任何参数。
const CALLBACK_HTML: &str = "<!doctype html><meta charset=utf-8><title>Kailo</title>\
<p>登录已完成，可以回到 Kailo 桌面端了。</p><p>Sign-in complete. You can return to Kailo.</p>";

/// 令牌请求的失败分两种，对调用方意义相反：IdP 明确拒绝（刷新令牌过期或被撤销，
/// 只能重新登录）与 IdP 暂不可达（稍后再试，不能因此丢掉凭据）。
#[derive(Debug)]
pub(crate) enum OidcError {
    Rejected(String),
    Unavailable(String),
}

impl std::fmt::Display for OidcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Rejected(m) | Self::Unavailable(m) => f.write_str(m),
        }
    }
}

#[derive(Debug, Deserialize)]
struct Discovery {
    authorization_endpoint: String,
    token_endpoint: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
}

/// 进行中的登录。只允许一个：新的一次会取消上一次。
#[derive(Default)]
pub(crate) struct PendingLogin(pub Mutex<Option<oneshot::Sender<()>>>);

struct Callback {
    state: String,
    sender: Mutex<Option<oneshot::Sender<Result<String, String>>>>,
}

fn random_b64(len: usize) -> Result<String, String> {
    let mut buf = vec![0u8; len];
    getrandom::getrandom(&mut buf).map_err(|e| format!("取随机数失败：{e}"))?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

/// PKCE：verifier 为 32 字节随机数的 base64url，challenge 为其 SHA-256 的 base64url
/// （RFC 7636 §4.2 的 S256）。
fn pkce() -> Result<(String, String), String> {
    let verifier = random_b64(32)?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    Ok((verifier, challenge))
}

async fn discover(http: &reqwest::Client, cfg: &KailoConfig) -> Result<Discovery, OidcError> {
    let url = format!(
        "{}/.well-known/openid-configuration",
        cfg.oidc_issuer.trim_end_matches('/')
    );
    let resp = http
        .get(&url)
        .send()
        .await
        .map_err(|e| OidcError::Unavailable(format!("无法连接 IdP：{e}")))?;
    if !resp.status().is_success() {
        return Err(OidcError::Unavailable(format!(
            "IdP discovery 返回 HTTP {}",
            resp.status()
        )));
    }
    resp.json()
        .await
        .map_err(|e| OidcError::Unavailable(format!("IdP discovery 文档无法解析：{e}")))
}

async fn callback(
    Query(query): Query<HashMap<String, String>>,
    AxumState(state): AxumState<std::sync::Arc<Callback>>,
) -> Response {
    // state 不符的请求不是这次登录的回调：不消费它，等真正的那一次
    if query.get("state") != Some(&state.state) {
        return (axum::http::StatusCode::NOT_FOUND, "Not found").into_response();
    }
    let result = match query.get("code").filter(|c| !c.is_empty()) {
        Some(code) => Ok(code.clone()),
        None => Err(query
            .get("error_description")
            .or_else(|| query.get("error"))
            .cloned()
            .unwrap_or_else(|| "IdP 回调没有带授权码".to_owned())),
    };
    if let Some(sender) = state.sender.lock().ok().and_then(|mut s| s.take()) {
        let _ = sender.send(result);
    }
    Html(CALLBACK_HTML).into_response()
}

/// 走完一次授权码登录，返回令牌。
///
/// `open` 负责把授权地址交给用户的浏览器：应用里是系统浏览器，端到端核验里是
/// 一个按 IdP 登录表单作答的模拟浏览器。其余一切——PKCE、state、回环回调、
/// 换取令牌——两者走同一份代码。
pub(crate) async fn sign_in(
    open: impl FnOnce(&str) -> Result<(), String>,
    http: &reqwest::Client,
    cfg: &KailoConfig,
    pending: &PendingLogin,
) -> Result<TokenResponse, String> {
    let endpoints = discover(http, cfg).await.map_err(|e| e.to_string())?;
    let (verifier, challenge) = pkce()?;
    let state = random_b64(16)?;

    // RFC 8252 §7.3：回环 IP 字面量，端口由系统分配
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("无法启动本机回调：{e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    let (sender, receiver) = oneshot::channel();
    let router = Router::new()
        .route("/callback", get(callback))
        .with_state(std::sync::Arc::new(Callback {
            state: state.clone(),
            sender: Mutex::new(Some(sender)),
        }));
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    let mut authorize =
        Url::parse(&endpoints.authorization_endpoint).map_err(|e| format!("授权端点无效：{e}"))?;
    authorize
        .query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &cfg.oidc_client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("scope", "openid")
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");

    let (cancel_tx, cancel_rx) = oneshot::channel();
    if let Some(previous) = pending
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .replace(cancel_tx)
    {
        let _ = previous.send(());
    }

    if let Err(e) = open(authorize.as_str()) {
        server.abort();
        return Err(e);
    }

    let code = tokio::select! {
        r = receiver => r.map_err(|_| "本机回调意外结束".to_owned()).and_then(|r| r),
        _ = cancel_rx => Err("登录已取消".to_owned()),
    };
    server.abort();
    let code = code?;

    token_request(
        http,
        &endpoints.token_endpoint,
        &[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &redirect_uri),
            ("client_id", &cfg.oidc_client_id),
            ("code_verifier", &verifier),
        ],
    )
    .await
    .map_err(|e| e.to_string())
}

/// 以刷新令牌换新的访问令牌。
pub(crate) async fn refresh(
    http: &reqwest::Client,
    cfg: &KailoConfig,
    refresh_token: &str,
) -> Result<TokenResponse, OidcError> {
    let endpoints = discover(http, cfg).await?;
    token_request(
        http,
        &endpoints.token_endpoint,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", &cfg.oidc_client_id),
        ],
    )
    .await
}

async fn token_request(
    http: &reqwest::Client,
    endpoint: &str,
    form: &[(&str, &str)],
) -> Result<TokenResponse, OidcError> {
    let resp = http
        .post(endpoint)
        .form(form)
        .send()
        .await
        .map_err(|e| OidcError::Unavailable(format!("令牌端点不可达：{e}")))?;
    if !resp.status().is_success() {
        // 错误体可能含 IdP 的诊断文本，但不含令牌；只取 error 字段
        let status = resp.status();
        let error = resp
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_owned))
            .unwrap_or_default();
        // 4xx 是 IdP 的判定（invalid_grant 等）；5xx 是它暂时不可用
        let message = format!("令牌端点回 HTTP {status} {error}");
        return Err(if status.is_client_error() {
            OidcError::Rejected(message)
        } else {
            OidcError::Unavailable(message)
        });
    }
    resp.json()
        .await
        .map_err(|e| OidcError::Unavailable(format!("令牌响应无法解析：{e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_is_s256_of_verifier() {
        let (verifier, challenge) = pkce().unwrap();
        assert!(verifier.len() >= 43, "RFC 7636 要求至少 43 个字符");
        assert_eq!(
            challenge,
            URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
        );
        let (other, _) = pkce().unwrap();
        assert_ne!(verifier, other, "每次登录的 verifier 不同");
    }
}
