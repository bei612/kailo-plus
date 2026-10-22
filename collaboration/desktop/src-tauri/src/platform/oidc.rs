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

use super::config::PlatformConfig;

/// 回调页。只告诉用户可以回到应用，不回显任何参数。
const CALLBACK_HTML: &str =
    "<!doctype html><meta charset=utf-8><title>登录已完成 · Sign-in complete</title>\
<p>登录已完成，可以回到桌面端了。</p><p>Sign-in complete. You can return to the desktop app.</p>";

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
    /// RFC 7009 令牌撤销端点（RFC 8414 的 `revocation_endpoint`）。IdP 不公布时
    /// 本机无法让 IdP 作废刷新令牌，注销只能如实报告未确认。
    #[serde(default)]
    revocation_endpoint: Option<String>,
    /// OIDC RP-Initiated Logout 端点。IdP 不公布时无法结束 WebView 中的 IdP 会话，
    /// 退出只能如实报告未确认（DD-133(6)、`.design/07` §4.7.5「Desktop」）。
    #[serde(default)]
    end_session_endpoint: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// 只在原生认证窗口的登录中使用：作为 WebView IdP 会话的退出提示保存。
    #[serde(default)]
    pub id_token: Option<String>,
}

/// 进行中的登录。只允许一个：新的一次会取消上一次。
#[derive(Default)]
pub(crate) struct PendingLogin(pub Mutex<Option<oneshot::Sender<()>>>);

impl PendingLogin {
    pub(crate) fn cancel(&self) {
        if let Some(cancel) = self.0.lock().ok().and_then(|mut pending| pending.take()) {
            let _ = cancel.send(());
        }
    }
}

struct CallbackServer(tokio::task::JoinHandle<()>);

impl Drop for CallbackServer {
    fn drop(&mut self) {
        self.0.abort();
    }
}

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

async fn discover(http: &reqwest::Client, cfg: &PlatformConfig) -> Result<Discovery, OidcError> {
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
    cfg: &PlatformConfig,
    pending: &PendingLogin,
) -> Result<TokenResponse, String> {
    // 从 discovery 开始就可取消；令牌交换期间取消也不能留下监听任务。
    let (cancel_tx, cancel_rx) = oneshot::channel();
    if let Some(previous) = pending
        .0
        .lock()
        .map_err(|_| "登录状态不可用")?
        .replace(cancel_tx)
    {
        let _ = previous.send(());
    }
    let login = async {
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
        let router =
            Router::new()
                .route("/callback", get(callback))
                .with_state(std::sync::Arc::new(Callback {
                    state: state.clone(),
                    sender: Mutex::new(Some(sender)),
                }));
        let server = CallbackServer(tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        }));

        let mut authorize = Url::parse(&endpoints.authorization_endpoint)
            .map_err(|e| format!("授权端点无效：{e}"))?;
        authorize
            .query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", &cfg.oidc_client_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("scope", "openid")
            .append_pair("state", &state)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256");

        open(authorize.as_str())?;

        let code = receiver
            .await
            .map_err(|_| "本机回调意外结束".to_owned())
            .and_then(|r| r);
        drop(server);
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
    };
    tokio::select! {
        result = login => result,
        _ = cancel_rx => Err("登录已取消".to_owned()),
    }
}

/// 原生认证窗口的回调地址（DD-133(6)、`.design/07` §4.7.5「Desktop」）。窗口导航
/// 到它时被拦截，从不加载、也不在本机监听；原生 client 的 `http://127.0.0.1/*`
/// 回调登记已覆盖它。
pub(crate) const EMBEDDED_SIGN_IN_REDIRECT: &str = "http://127.0.0.1/kailo/embedded-sign-in";
/// RP-Initiated Logout 的回跳地址，同样只被拦截；原生 client 把它登记为
/// `post.logout.redirect.uris`。到达它是 IdP 已结束会话的唯一确认。
pub(crate) const SIGNED_OUT_REDIRECT: &str = "http://127.0.0.1/kailo/signed-out";

/// 一次进行中的窗口内授权：授权地址交给窗口，其余留在 Rust 侧。
pub(crate) struct EmbeddedAuthorization {
    pub url: Url,
    state: String,
    verifier: String,
    token_endpoint: String,
}

/// 地址恰为某个被拦截的回环地址（http、127.0.0.1、无端口、同一路径）。
fn is_redirect(url: &Url, redirect: &str) -> bool {
    let Ok(expected) = Url::parse(redirect) else {
        return false;
    };
    url.scheme() == expected.scheme()
        && url.host_str() == expected.host_str()
        && url.port() == expected.port()
        && url.path() == expected.path()
        && url.username().is_empty()
        && url.password().is_none()
}

/// 以原生 public client 在应用 WebView 中登录：PKCE S256、`state`、`scope=openid`，
/// 回调是被拦截的 [`EMBEDDED_SIGN_IN_REDIRECT`]。授权端点必须在 issuer origin 上，
/// 因为窗口只允许导航到那里。
pub(crate) async fn embedded_authorization(
    http: &reqwest::Client,
    cfg: &PlatformConfig,
) -> Result<EmbeddedAuthorization, String> {
    let endpoints = discover(http, cfg).await.map_err(|e| e.to_string())?;
    let issuer = Url::parse(&cfg.oidc_issuer).map_err(|e| format!("issuer 无效：{e}"))?;
    let mut url =
        Url::parse(&endpoints.authorization_endpoint).map_err(|e| format!("授权端点无效：{e}"))?;
    if url.origin() != issuer.origin() {
        return Err("授权端点不在 issuer origin 上".to_owned());
    }
    let (verifier, challenge) = pkce()?;
    let state = random_b64(16)?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &cfg.oidc_client_id)
        .append_pair("redirect_uri", EMBEDDED_SIGN_IN_REDIRECT)
        .append_pair("scope", "openid")
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");
    Ok(EmbeddedAuthorization {
        url,
        state,
        verifier,
        token_endpoint: endpoints.token_endpoint,
    })
}

impl EmbeddedAuthorization {
    /// 一次窗口导航是否是本次授权的回调：不是返回 `None`；是则返回授权码，或在
    /// `state` 不符、IdP 报错、缺授权码时返回失败（不回显 IdP 的诊断文本）。
    pub(crate) fn callback(&self, url: &Url) -> Option<Result<String, String>> {
        if !is_redirect(url, EMBEDDED_SIGN_IN_REDIRECT) {
            return None;
        }
        let query: HashMap<String, String> = url.query_pairs().into_owned().collect();
        if query.get("state") != Some(&self.state) {
            return Some(Err("PLATFORM_NATIVE_PAGE_STATE_MISMATCH".to_owned()));
        }
        Some(
            query
                .get("code")
                .filter(|code| !code.is_empty())
                .cloned()
                .ok_or_else(|| "PLATFORM_NATIVE_PAGE_SIGN_IN_FAILED".to_owned()),
        )
    }

    /// 换取令牌，只交回 ID token。访问令牌与刷新令牌随返回值丢弃，不撤销：
    /// 撤销刷新令牌会在会话中没有其他 client 时让 IdP 删除整个用户会话。
    pub(crate) async fn exchange(
        &self,
        http: &reqwest::Client,
        cfg: &PlatformConfig,
        code: &str,
    ) -> Result<String, String> {
        let tokens = token_request(
            http,
            &self.token_endpoint,
            &[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("redirect_uri", EMBEDDED_SIGN_IN_REDIRECT),
                ("client_id", &cfg.oidc_client_id),
                ("code_verifier", &self.verifier),
            ],
        )
        .await
        .map_err(|e| e.to_string())?;
        tokens
            .id_token
            .filter(|token| !token.is_empty())
            .ok_or_else(|| "令牌响应缺 id_token".to_owned())
    }
}

/// RP-Initiated Logout 地址：`end_session_endpoint` 带 `id_token_hint`、`client_id`
/// 与被拦截的 [`SIGNED_OUT_REDIRECT`]。端点必须公布且在 issuer origin 上。
pub(crate) async fn end_session_url(
    http: &reqwest::Client,
    cfg: &PlatformConfig,
    id_token_hint: &str,
) -> Result<Url, String> {
    let endpoints = discover(http, cfg).await.map_err(|e| e.to_string())?;
    let issuer = Url::parse(&cfg.oidc_issuer).map_err(|e| format!("issuer 无效：{e}"))?;
    let mut url = Url::parse(
        endpoints
            .end_session_endpoint
            .as_deref()
            .ok_or("IdP 未公布 end_session_endpoint")?,
    )
    .map_err(|e| format!("end_session_endpoint 无效：{e}"))?;
    if url.origin() != issuer.origin() {
        return Err("end_session_endpoint 不在 issuer origin 上".to_owned());
    }
    url.query_pairs_mut()
        .append_pair("id_token_hint", id_token_hint)
        .append_pair("client_id", &cfg.oidc_client_id)
        .append_pair("post_logout_redirect_uri", SIGNED_OUT_REDIRECT);
    Ok(url)
}

/// 退出窗口里一次导航的判定。
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum LogoutNavigation {
    /// issuer origin 上的中间页，放行
    Continue,
    /// 到达被拦截的回跳地址：IdP 已结束会话
    Confirmed,
    /// 其他任何地址：不加载，退出未确认
    Rejected,
}

pub(crate) fn logout_navigation(url: &Url, issuer_origin: &url::Origin) -> LogoutNavigation {
    if is_redirect(url, SIGNED_OUT_REDIRECT) {
        LogoutNavigation::Confirmed
    } else if matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
        && &url.origin() == issuer_origin
    {
        LogoutNavigation::Continue
    } else {
        LogoutNavigation::Rejected
    }
}

/// 以刷新令牌换新的访问令牌。
pub(crate) async fn refresh(
    http: &reqwest::Client,
    cfg: &PlatformConfig,
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

/// 请 IdP 作废刷新令牌（RFC 7009 §2.1，公共客户端以 `client_id` 标识自己）。
///
/// 只有 IdP 以 200 回答才算确认（§2.2：已失效的令牌同样回 200）。没有公布撤销
/// 端点、不可达或其他回答一律返回 false——调用方不得把它说成已撤销。
pub(crate) async fn revoke_refresh_token(
    http: &reqwest::Client,
    cfg: &PlatformConfig,
    refresh_token: &str,
) -> bool {
    let Ok(endpoints) = discover(http, cfg).await else {
        return false;
    };
    let Some(endpoint) = endpoints.revocation_endpoint else {
        return false;
    };
    match http
        .post(&endpoint)
        .form(&[
            ("token", refresh_token),
            ("token_type_hint", "refresh_token"),
            ("client_id", cfg.oidc_client_id.as_str()),
        ])
        .send()
        .await
    {
        Ok(resp) => resp.status() == reqwest::StatusCode::OK,
        Err(_) => false,
    }
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
        // 只识别协议错误码，不把不受信任的诊断正文返回给 WebView。
        let status = resp.status();
        let error = resp
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_owned))
            .unwrap_or_default();
        // invalid_grant 才证明这份 grant 无效。429、客户端配置错误、代理4xx
        // 或非协议正文都不能证明刷新令牌被撤销，不因此删除本机凭据。
        let message = format!("令牌端点回 HTTP {status}");
        return Err(
            if status == reqwest::StatusCode::BAD_REQUEST && error == "invalid_grant" {
                OidcError::Rejected(message)
            } else {
                OidcError::Unavailable(message)
            },
        );
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

    #[tokio::test]
    async fn cancellation_during_discovery_does_not_open_a_browser() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let entered = std::sync::Arc::new(tokio::sync::Notify::new());
        let signal = entered.clone();
        let router = Router::new().route(
            "/realm/.well-known/openid-configuration",
            get(move || {
                let signal = signal.clone();
                async move {
                    signal.notify_one();
                    std::future::pending::<String>().await
                }
            }),
        );
        let server = CallbackServer(tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap()
        }));
        let cfg = PlatformConfig {
            native_api_url: base.clone(),
            oidc_issuer: format!("{base}/realm"),
            oidc_client_id: "test".into(),
        };
        let pending = PendingLogin::default();
        let http = reqwest::Client::new();
        let (result, ()) = tokio::join!(
            sign_in(|_| panic!("取消后不能打开浏览器"), &http, &cfg, &pending),
            async {
                tokio::time::timeout(std::time::Duration::from_secs(5), entered.notified())
                    .await
                    .unwrap();
                pending.cancel();
            }
        );
        assert_eq!(result.unwrap_err(), "登录已取消");
        drop(server);
    }

    /// 假 IdP：discovery 可选公布 end_session_endpoint，令牌端点记录表单并回固定令牌。
    async fn fake_idp(
        end_session: Option<&str>,
        token_body: serde_json::Value,
    ) -> (
        PlatformConfig,
        std::sync::Arc<Mutex<Vec<HashMap<String, String>>>>,
        CallbackServer,
    ) {
        use axum::routing::post;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let forms = std::sync::Arc::new(Mutex::new(Vec::new()));
        let seen = forms.clone();
        let mut doc = serde_json::json!({
            "authorization_endpoint": format!("{base}/realm/auth"),
            "token_endpoint": format!("{base}/realm/token"),
        });
        if let Some(path) = end_session {
            doc["end_session_endpoint"] = if path.starts_with("http") {
                serde_json::json!(path)
            } else {
                serde_json::json!(format!("{base}{path}"))
            };
        }
        let router = Router::new()
            .route(
                "/realm/.well-known/openid-configuration",
                get(move || {
                    let doc = doc.clone();
                    async move { axum::Json(doc) }
                }),
            )
            .route(
                "/realm/token",
                post(
                    move |axum::extract::Form(form): axum::extract::Form<
                        HashMap<String, String>,
                    >| {
                        let body = token_body.clone();
                        seen.lock().unwrap().push(form);
                        async move { axum::Json(body) }
                    },
                ),
            );
        let server = CallbackServer(tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap()
        }));
        let cfg = PlatformConfig {
            native_api_url: base.clone(),
            oidc_issuer: format!("{base}/realm"),
            oidc_client_id: "native-client".into(),
        };
        (cfg, forms, server)
    }

    fn query(url: &Url) -> HashMap<String, String> {
        url.query_pairs().into_owned().collect()
    }

    #[tokio::test]
    async fn embedded_sign_in_uses_the_intercepted_loopback_and_keeps_only_the_id_token() {
        let (cfg, forms, _server) = fake_idp(
            None,
            serde_json::json!({"access_token":"dropped-access","refresh_token":"dropped-refresh","id_token":"hint-1"}),
        )
        .await;
        let http = reqwest::Client::new();
        let authorization = embedded_authorization(&http, &cfg).await.unwrap();
        let params = query(&authorization.url);
        assert_eq!(params["redirect_uri"], EMBEDDED_SIGN_IN_REDIRECT);
        assert_eq!(params["client_id"], "native-client");
        assert_eq!(params["scope"], "openid");
        assert_eq!(params["code_challenge_method"], "S256");
        let state = params["state"].clone();

        // 不是回调：交给导航白名单判断
        for other in [
            "http://127.0.0.1:8080/kailo/embedded-sign-in?code=c",
            "http://127.0.0.1/kailo/other?code=c",
            "https://127.0.0.1/kailo/embedded-sign-in?code=c",
            "http://localhost/kailo/embedded-sign-in?code=c",
        ] {
            assert!(
                authorization
                    .callback(&Url::parse(other).unwrap())
                    .is_none(),
                "{other}"
            );
        }
        let at = |q: &str| Url::parse(&format!("{EMBEDDED_SIGN_IN_REDIRECT}?{q}")).unwrap();
        assert!(authorization
            .callback(&at("state=forged&code=c"))
            .unwrap()
            .is_err());
        assert!(authorization
            .callback(&at(&format!(
                "state={state}&error=login_required&error_description=private"
            )))
            .unwrap()
            .is_err_and(|e| !e.contains("private")));
        let code = authorization
            .callback(&at(&format!("state={state}&code=the-code&iss=x")))
            .unwrap()
            .unwrap();
        assert_eq!(code, "the-code");

        let hint = authorization.exchange(&http, &cfg, &code).await.unwrap();
        assert_eq!(hint, "hint-1", "只交回 ID token");
        let form = &forms.lock().unwrap()[0];
        assert_eq!(form["grant_type"], "authorization_code");
        assert_eq!(form["redirect_uri"], EMBEDDED_SIGN_IN_REDIRECT);
        assert_eq!(form["code"], "the-code");
        assert!(!form["code_verifier"].is_empty());
    }

    #[tokio::test]
    async fn embedded_sign_in_without_an_id_token_is_a_failure() {
        let (cfg, _, _server) = fake_idp(
            None,
            serde_json::json!({"access_token":"a","refresh_token":"r"}),
        )
        .await;
        let http = reqwest::Client::new();
        let authorization = embedded_authorization(&http, &cfg).await.unwrap();
        assert!(authorization.exchange(&http, &cfg, "c").await.is_err());
    }

    #[tokio::test]
    async fn end_session_url_carries_the_hint_and_the_intercepted_return() {
        let (cfg, _, _server) = fake_idp(Some("/realm/logout"), serde_json::json!({})).await;
        let http = reqwest::Client::new();
        let url = end_session_url(&http, &cfg, "hint-1").await.unwrap();
        assert_eq!(url.path(), "/realm/logout");
        let params = query(&url);
        assert_eq!(params["id_token_hint"], "hint-1");
        assert_eq!(params["client_id"], "native-client");
        assert_eq!(params["post_logout_redirect_uri"], SIGNED_OUT_REDIRECT);

        let (missing, _, _server) = fake_idp(None, serde_json::json!({})).await;
        assert!(end_session_url(&http, &missing, "hint-1").await.is_err());
        let (elsewhere, _, _server) =
            fake_idp(Some("https://other.example/logout"), serde_json::json!({})).await;
        assert!(end_session_url(&http, &elsewhere, "hint-1").await.is_err());
    }

    #[test]
    fn logout_navigation_confirms_only_the_intercepted_return() {
        let issuer = Url::parse("https://idp.example/realms/k").unwrap().origin();
        let judge = |u: &str| logout_navigation(&Url::parse(u).unwrap(), &issuer);
        assert_eq!(
            judge("https://idp.example/realms/k/protocol/openid-connect/logout"),
            LogoutNavigation::Continue
        );
        assert_eq!(
            judge("http://127.0.0.1/kailo/signed-out"),
            LogoutNavigation::Confirmed
        );
        assert_eq!(
            judge("http://127.0.0.1/kailo/signed-out?state=x"),
            LogoutNavigation::Confirmed
        );
        for rejected in [
            "http://127.0.0.1:9/kailo/signed-out",
            "http://127.0.0.1/kailo/embedded-sign-in",
            "https://other.example/",
            "https://user:pw@idp.example/",
            "data:text/html,x",
        ] {
            assert_eq!(judge(rejected), LogoutNavigation::Rejected, "{rejected}");
        }
    }
}
