//! 令牌的持有与管理平面调用。
//!
//! 刷新令牌存 OS keyring（与设备身份同一个 secret store），访问令牌只在内存。
//! 不按到期时间提前刷新——那要一个拍脑袋的提前量；而是在 BFF 回 401 时刷新一次
//! 并重试一次，两次都不行即判为需要重新登录。

use reqwest::Method;
use serde::Serialize;
use std::sync::{Mutex as StateMutex, MutexGuard};
use tokio::sync::Mutex;

use super::config::PlatformConfig;
use super::oidc::{self, OidcError, PendingLogin, TokenResponse};
use crate::app_state::keyring_service;
use crate::secret_store::SecretStore;

/// keyring 中刷新令牌的条目名
const REFRESH_KEY: &str = "platform-refresh-token";

/// 前端可经本模块调用的 BFF 路径前缀。其余一概不代发。
const API_PREFIX: &str = "/api/v1/";

/// 刷新令牌的存放处。应用里是 OS keyring；无图形会话的端到端核验里是内存。
pub(crate) trait RefreshStore: Send + Sync {
    fn load(&self) -> Result<Option<String>, String>;
    fn store(&self, value: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

/// OS keyring，与设备身份同一个 secret store。keyring 不可用时写入失败，登录随之
/// 失败——不退而把长期凭据写成文件。
struct KeyringStore;

impl RefreshStore for KeyringStore {
    fn load(&self) -> Result<Option<String>, String> {
        store().load(REFRESH_KEY)
    }
    fn store(&self, value: &str) -> Result<(), String> {
        store().store(REFRESH_KEY, value)
    }
    fn delete(&self) -> Result<(), String> {
        store().delete(REFRESH_KEY)
    }
}

pub(crate) struct NativeSession {
    state: StateMutex<SessionState>,
    refreshing: Mutex<()>,
    refresh: Box<dyn RefreshStore>,
    pub(crate) pending: PendingLogin,
}

#[derive(Default)]
struct SessionState {
    generation: u64,
    access: Option<String>,
}

impl Default for NativeSession {
    fn default() -> Self {
        Self::with_store(Box::new(KeyringStore))
    }
}

/// BFF 的一次回应，原样交给前端：错误体里的分类、reason code 与 operationId
/// 由前端解读，这里不重新解释。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiResponse {
    pub status: u16,
    pub body: serde_json::Value,
}

/// 一次注销在服务端的结果。本机凭据总会被丢弃；这里只回答服务端是否确认。
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SignOutReport {
    /// Core 以 200 和布尔 `revoked` 回答 `POST /api/v1/logout`（false 为幂等已结束）
    pub core_session_revoked: bool,
    /// IdP 以 200 回答了刷新令牌撤销（RFC 7009），或本机本就没有刷新令牌
    pub refresh_token_revoked: bool,
}

/// 前端据此判断是否要回到登录页。
pub(crate) const NOT_SIGNED_IN: &str = "PLATFORM_NOT_SIGNED_IN";
// 旧操作不代表当前会话已结束，不能触发前端的 onSessionEnded。
const SUPERSEDED: &str = "PLATFORM_OPERATION_SUPERSEDED";

fn store() -> &'static SecretStore {
    SecretStore::shared(keyring_service())
}

impl NativeSession {
    pub(super) fn page_generation(&self) -> Result<u64, String> {
        let state = self.state()?;
        if state.access.is_none() { return Err(NOT_SIGNED_IN.into()); }
        Ok(state.generation)
    }

    pub(super) fn page_generation_matches(&self, generation: u64) -> bool {
        self.state().is_ok_and(|state| state.generation == generation && state.access.is_some())
    }

    pub(crate) fn with_store(refresh: Box<dyn RefreshStore>) -> Self {
        Self {
            state: StateMutex::new(SessionState::default()),
            refreshing: Mutex::new(()),
            refresh,
            pending: PendingLogin::default(),
        }
    }

    fn state(&self) -> Result<MutexGuard<'_, SessionState>, String> {
        self.state
            .lock()
            .map_err(|_| "PLATFORM_SESSION_UNAVAILABLE".to_owned())
    }

    /// 在等待浏览器之前固定登录代际；取消、退出及下一次登录都会使它失效。
    pub(crate) fn begin_sign_in(&self) -> Result<u64, String> {
        let mut state = self.state()?;
        state.generation = state.generation.wrapping_add(1);
        Ok(state.generation)
    }

    /// 只接受仍属于该次登录的令牌，迟到回调不恢复已退出的身份。
    pub(crate) fn adopt_for(&self, generation: u64, tokens: TokenResponse) -> Result<(), String> {
        let mut state = self.state()?;
        Self::check_generation(&state, generation)?;
        // 刷新令牌是长期凭据：没有它，下次启动就得重新登录；有它却存不进
        // keyring，就不能假装已经持久登录
        match tokens.refresh_token.as_deref() {
            Some(r) => self.refresh.store(r)?,
            None => self.refresh.delete()?,
        }
        state.access = Some(tokens.access_token);
        Ok(())
    }

    #[cfg(test)]
    pub(crate) async fn adopt(&self, tokens: TokenResponse) -> Result<(), String> {
        self.adopt_for(self.begin_sign_in()?, tokens)
    }

    fn check_generation(state: &SessionState, generation: u64) -> Result<(), String> {
        if state.generation != generation {
            return Err(SUPERSEDED.to_owned());
        }
        Ok(())
    }

    pub(crate) fn has_credentials(&self) -> Result<bool, String> {
        let state = self.state()?;
        Ok(state.access.is_some() || self.refresh.load()?.is_some())
    }

    /// 结束本机的平台登录（`SS-AGW-OIDC` 的原生部分）：先撤销 Core 的
    /// PlatformSession，再请 IdP 作废刷新令牌。先从本机移出这次凭据快照并使在途
    /// 操作失效，远端等待期间不阻塞新登录，也绝不清理新登录的凭据。本机凭据丢
    /// 不掉才返回错误；服务端未确认则如实写进报告。
    pub(crate) async fn end_session(
        &self,
        http: &reqwest::Client,
        cfg: &PlatformConfig,
    ) -> Result<SignOutReport, String> {
        let (mut access, mut refresh, refresh_in_flight) = {
            let mut state = self.state()?;
            state.generation = state.generation.wrapping_add(1);
            self.pending.cancel();
            let refresh = self.refresh.load();
            let access = state.access.take();
            // 已发出的刷新可能已在 IdP 轮换、但尚未回到本机。撤销快照成功也
            // 不能证明那个结果不明的令牌被撤销，报告仍须保持未确认。
            let refresh_in_flight = self.refreshing.try_lock().is_err();
            // 即使读取失败也尝试删除，不让一次读取错误跳过本机退出。
            self.refresh.delete()?;
            (access, refresh, refresh_in_flight)
        };
        let core_session_revoked = match refresh.as_mut() {
            Ok(refresh) => logout_snapshot(http, cfg, &mut access, refresh).await,
            Err(_) => false,
        };
        let refresh_token_revoked = match refresh {
            Ok(Some(token)) => oidc::revoke_refresh_token(http, cfg, &token).await,
            Ok(None) => true,
            Err(_) => false,
        } && !refresh_in_flight;
        Ok(SignOutReport {
            core_session_revoked,
            refresh_token_revoked,
        })
    }

    pub(crate) async fn sign_out(&self) -> Result<(), String> {
        let mut state = self.state()?;
        state.generation = state.generation.wrapping_add(1);
        state.access = None;
        self.pending.cancel();
        self.refresh.delete()
    }

    async fn refresh(
        &self,
        http: &reqwest::Client,
        cfg: &PlatformConfig,
        generation: u64,
        rejected_access: Option<&str>,
    ) -> Result<String, String> {
        // 同一刷新令牌只交换一次；其他401复用已轮换的访问令牌。
        let _refreshing = self.refreshing.lock().await;
        let refresh_token = {
            let state = self.state()?;
            Self::check_generation(&state, generation)?;
            if let Some(access) = state.access.as_ref() {
                if Some(access.as_str()) != rejected_access {
                    return Ok(access.clone());
                }
            }
            self.refresh
                .load()?
                .ok_or_else(|| NOT_SIGNED_IN.to_owned())?
        };
        let result = oidc::refresh(http, cfg, &refresh_token).await;
        let mut state = self.state()?;
        Self::check_generation(&state, generation)?;
        match result {
            Ok(mut tokens) => {
                let access = tokens.access_token.clone();
                // OAuth 刷新可不轮换 refresh_token；缺省不等于撤销原凭据。
                let refresh = tokens.refresh_token.take().unwrap_or(refresh_token);
                self.refresh.store(&refresh)?;
                state.access = Some(tokens.access_token);
                Ok(access)
            }
            // 刷新令牌被 IdP 拒绝（过期、撤销、会话已结束）：只能重新登录
            Err(OidcError::Rejected(_)) => {
                state.generation = state.generation.wrapping_add(1);
                state.access = None;
                self.refresh.delete()?;
                Err(NOT_SIGNED_IN.to_owned())
            }
            // IdP 暂不可达：凭据留着，稍后再试
            Err(e @ OidcError::Unavailable(_)) => Err(e.to_string()),
        }
    }

    /// 以 Bearer 调用一个 BFF 路径。401 时刷新一次并重试一次。
    pub(crate) async fn call(
        &self,
        http: &reqwest::Client,
        cfg: &PlatformConfig,
        method: Method,
        path: &str,
        body: Option<&serde_json::Value>,
    ) -> Result<ApiResponse, String> {
        if !path.starts_with(API_PREFIX) || path.contains("..") {
            return Err(format!("不代发 {API_PREFIX} 之外的路径"));
        }
        let url = cfg.api_url(path)?;
        let (generation, cached) = {
            let state = self.state()?;
            (state.generation, state.access.clone())
        };
        let mut token = match cached {
            Some(t) => t,
            None => self.refresh(http, cfg, generation, None).await?,
        };
        for attempt in 0..2 {
            let mut req = http
                .request(method.clone(), url.clone())
                .bearer_auth(&token);
            if let Some(b) = body {
                req = req.json(b);
            }
            let response = req
                .send()
                .await
                .map_err(|_| "PLATFORM_SERVICE_UNAVAILABLE".to_owned());
            Self::check_generation(&*self.state()?, generation)?;
            let resp = response?;
            let status = resp.status();
            if status == reqwest::StatusCode::UNAUTHORIZED && attempt == 0 {
                token = self.refresh(http, cfg, generation, Some(&token)).await?;
                continue;
            }
            if status == reqwest::StatusCode::UNAUTHORIZED {
                let mut state = self.state()?;
                Self::check_generation(&state, generation)?;
                // 该401也可能比同代际的另一刷新迟到，不能清理新访问令牌。
                if state.access.as_deref() != Some(token.as_str()) {
                    return Err(SUPERSEDED.to_owned());
                }
                state.generation = state.generation.wrapping_add(1);
                state.access = None;
                self.refresh.delete()?;
                return Err(NOT_SIGNED_IN.to_owned());
            }
            let body = if status == reqwest::StatusCode::NO_CONTENT {
                serde_json::Value::Null
            } else {
                resp.json().await.unwrap_or(serde_json::Value::Null)
            };
            Self::check_generation(&*self.state()?, generation)?;
            return Ok(ApiResponse {
                status: status.as_u16(),
                body,
            });
        }
        Err(NOT_SIGNED_IN.to_owned())
    }
}

// 注销只使用从本机移出的原凭据；刷新结果不能写回当前 NativeSession。
async fn logout_snapshot(
    http: &reqwest::Client,
    cfg: &PlatformConfig,
    access: &mut Option<String>,
    refresh: &mut Option<String>,
) -> bool {
    let Ok(url) = cfg.api_url("/api/v1/logout") else {
        return false;
    };
    for attempt in 0..2 {
        if access.is_none() {
            let Some(held) = refresh.as_ref() else {
                return false;
            };
            let Ok(tokens) = oidc::refresh(http, cfg, held).await else {
                return false;
            };
            *access = Some(tokens.access_token);
            if tokens.refresh_token.is_some() {
                *refresh = tokens.refresh_token;
            }
        }
        let Some(token) = access.as_ref() else {
            return false;
        };
        let Ok(response) = http.post(url.clone()).bearer_auth(token).send().await else {
            return false;
        };
        if response.status() == reqwest::StatusCode::UNAUTHORIZED && attempt == 0 {
            *access = None;
            continue;
        }
        return response.status() == reqwest::StatusCode::OK
            && response
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|body| body.get("revoked").and_then(serde_json::Value::as_bool))
                .is_some();
    }
    false
}

#[cfg(test)]
mod sign_out_tests {
    //! 注销的服务端两步：Core 撤销 PlatformSession、IdP 作废刷新令牌（RFC 7009）。
    //! 以本机回环上的一个假 IdP + 假 BFF 回答，核对请求内容与未确认时的如实报告。

    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    use axum::extract::{Form, State as AxumState};
    use axum::http::{HeaderMap, StatusCode};
    use axum::routing::{get, post};
    use axum::{Json, Router};

    use super::*;
    use crate::platform::oidc::TokenResponse;

    #[derive(Default)]
    struct Fake {
        advertise_revocation: bool,
        revoke_status: u16,
        logout_status: u16,
        logout_body: Option<serde_json::Value>,
        revocations: Vec<HashMap<String, String>>,
        logouts: usize,
        base: String,
        token_status: u16,
        token_error: &'static str,
        omit_rotated_refresh: bool,
        token_requests: usize,
        token_gate: Option<Arc<Gate>>,
        probe_gate: Option<Arc<Gate>>,
        logout_gate: Option<Arc<Gate>>,
    }

    struct Gate {
        entered: tokio::sync::Semaphore,
        release: tokio::sync::Semaphore,
    }

    impl Gate {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                entered: tokio::sync::Semaphore::new(0),
                release: tokio::sync::Semaphore::new(0),
            })
        }

        async fn wait(&self) {
            self.entered.add_permits(1);
            self.release.acquire().await.unwrap().forget();
        }

        async fn arrived(&self) {
            tokio::time::timeout(std::time::Duration::from_secs(5), self.entered.acquire())
                .await
                .unwrap()
                .unwrap()
                .forget();
        }
    }

    type Shared = Arc<Mutex<Fake>>;

    struct Memory(Mutex<Option<String>>);
    impl RefreshStore for Memory {
        fn load(&self) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn store(&self, value: &str) -> Result<(), String> {
            *self.0.lock().unwrap() = Some(value.to_owned());
            Ok(())
        }
        fn delete(&self) -> Result<(), String> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    async fn serve(fake: Shared) -> PlatformConfig {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        fake.lock().unwrap().base = base.clone();
        let app =
            Router::new()
                .route(
                    "/realm/.well-known/openid-configuration",
                    get(|AxumState(f): AxumState<Shared>| async move {
                        let f = f.lock().unwrap();
                        let mut doc = serde_json::json!({
                            "authorization_endpoint": format!("{}/realm/auth", f.base),
                            "token_endpoint": format!("{}/realm/token", f.base),
                        });
                        if f.advertise_revocation {
                            doc["revocation_endpoint"] =
                                serde_json::json!(format!("{}/realm/revoke", f.base));
                        }
                        Json(doc)
                    }),
                )
                .route(
                    "/realm/revoke",
                    post(
                        |AxumState(f): AxumState<Shared>,
                         Form(form): Form<HashMap<String, String>>| async move {
                            let mut f = f.lock().unwrap();
                            f.revocations.push(form);
                            StatusCode::from_u16(f.revoke_status).unwrap()
                        },
                    ),
                )
                .route(
                    "/realm/token",
                    post(|AxumState(f): AxumState<Shared>| async move {
                        let (status, error, omit, gate) = {
                            let mut f = f.lock().unwrap();
                            f.token_requests += 1;
                            (f.token_status, f.token_error, f.omit_rotated_refresh, f.token_gate.clone())
                        };
                        if let Some(gate) = gate { gate.wait().await; }
                        let body = if status == 200 {
                            let mut body = serde_json::json!({ "access_token": "access-2" });
                            if !omit { body["refresh_token"] = "refresh-2".into(); }
                            body
                        } else {
                            serde_json::json!({ "error": error, "error_description": "private IdP diagnostic" })
                        };
                        (StatusCode::from_u16(status).unwrap(), Json(body))
                    }),
                )
                .route(
                    "/api/v1/probe",
                    get(|AxumState(f): AxumState<Shared>, headers: HeaderMap| async move {
                        let gate = f.lock().unwrap().probe_gate.clone();
                        if let Some(gate) = gate { gate.wait().await; }
                        let status = if headers.get("authorization").unwrap() == "Bearer access-1" {
                            StatusCode::UNAUTHORIZED
                        } else { StatusCode::OK };
                        (status, Json(serde_json::json!({ "ok": true })))
                    }),
                )
                .route(
                    "/api/v1/logout",
                    post(|AxumState(f): AxumState<Shared>| async move {
                        let (status, body, gate) = {
                            let mut f = f.lock().unwrap();
                            f.logouts += 1;
                            (f.logout_status, f.logout_body.clone().unwrap_or(serde_json::json!({ "revoked": true })), f.logout_gate.clone())
                        };
                        if let Some(gate) = gate { gate.wait().await; }
                        (
                            StatusCode::from_u16(status).unwrap(),
                            Json(body),
                        )
                    }),
                )
                .with_state(fake);
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        PlatformConfig {
            native_api_url: base.clone(),
            oidc_issuer: format!("{base}/realm"),
            oidc_client_id: "native-client".into(),
        }
    }

    async fn signed_in() -> NativeSession {
        let session = NativeSession::with_store(Box::new(Memory(Mutex::new(None))));
        session
            .adopt(TokenResponse {
                access_token: "access-1".into(),
                refresh_token: Some("refresh-1".into()),
            })
            .await
            .unwrap();
        session
    }

    fn fake(advertise: bool, revoke: u16, logout: u16) -> Shared {
        Arc::new(Mutex::new(Fake {
            advertise_revocation: advertise,
            revoke_status: revoke,
            logout_status: logout,
            token_status: 200,
            ..Fake::default()
        }))
    }

    #[tokio::test]
    async fn sign_out_revokes_the_core_session_and_the_refresh_token() {
        let f = fake(true, 200, 200);
        let cfg = serve(f.clone()).await;
        let session = signed_in().await;

        let report = session
            .end_session(&reqwest::Client::new(), &cfg)
            .await
            .unwrap();

        assert_eq!(
            report,
            SignOutReport {
                core_session_revoked: true,
                refresh_token_revoked: true,
            }
        );
        let f = f.lock().unwrap();
        assert_eq!(f.logouts, 1, "Core 的会话必须先被撤销");
        assert_eq!(f.revocations.len(), 1, "刷新令牌必须在 IdP 作废");
        let form = &f.revocations[0];
        assert_eq!(form["token"], "refresh-1");
        assert_eq!(form["token_type_hint"], "refresh_token");
        assert_eq!(form["client_id"], "native-client");
        assert!(!session.has_credentials().unwrap(), "本机凭据已丢弃");
    }

    #[tokio::test]
    async fn an_unconfirmed_server_side_is_reported_but_local_credentials_go() {
        for (advertise, revoke, logout, core_ok, idp_ok) in [
            (true, 200, 503, false, true),
            (true, 200, 202, false, true),
            (true, 200, 204, false, true),
            (false, 200, 200, true, false),
            (true, 503, 200, true, false),
        ] {
            let cfg = serve(fake(advertise, revoke, logout)).await;
            let session = signed_in().await;

            let report = session
                .end_session(&reqwest::Client::new(), &cfg)
                .await
                .unwrap();

            assert_eq!(
                report,
                SignOutReport {
                    core_session_revoked: core_ok,
                    refresh_token_revoked: idp_ok,
                },
                "advertise={advertise} revoke={revoke} logout={logout}"
            );
            assert!(!session.has_credentials().unwrap());
        }
    }

    fn replacement() -> TokenResponse {
        TokenResponse {
            access_token: "new-login-access".into(),
            refresh_token: Some("new-login-refresh".into()),
        }
    }

    #[tokio::test]
    async fn core_logout_requires_a_boolean_ack_not_merely_http_success() {
        for (body, confirmed) in [
            (serde_json::json!({ "revoked": false }), true),
            (serde_json::json!({ "revoked": "true" }), false),
            (serde_json::json!({}), false),
            (serde_json::Value::Null, false),
        ] {
            let f = fake(true, 200, 200);
            f.lock().unwrap().logout_body = Some(body);
            let cfg = serve(f).await;
            let session = signed_in().await;
            let report = session
                .end_session(&reqwest::Client::new(), &cfg)
                .await
                .unwrap();
            assert_eq!(report.core_session_revoked, confirmed);
            assert!(report.refresh_token_revoked);
            assert!(!session.has_credentials().unwrap());
        }
    }

    async fn probe(session: &NativeSession, cfg: &PlatformConfig) -> Result<ApiResponse, String> {
        session
            .call(
                &reqwest::Client::new(),
                cfg,
                Method::GET,
                "/api/v1/probe",
                None,
            )
            .await
    }

    fn assert_replacement(session: &NativeSession) {
        assert_eq!(
            session.state().unwrap().access.as_deref(),
            Some("new-login-access")
        );
        assert_eq!(
            session.refresh.load().unwrap().as_deref(),
            Some("new-login-refresh")
        );
    }

    #[tokio::test]
    async fn stale_401_does_not_refresh_or_end_a_new_login() {
        let f = fake(true, 200, 200);
        let gate = Gate::new();
        f.lock().unwrap().probe_gate = Some(gate.clone());
        let cfg = serve(f.clone()).await;
        let session = signed_in().await;
        let (result, ()) = tokio::join!(probe(&session, &cfg), async {
            gate.arrived().await;
            session.adopt(replacement()).await.unwrap();
            gate.release.add_permits(1);
        });
        assert_eq!(result.unwrap_err(), SUPERSEDED);
        assert_replacement(&session);
        assert_eq!(f.lock().unwrap().token_requests, 0);
    }

    #[tokio::test]
    async fn stale_refresh_success_or_rejection_cannot_replace_or_erase_a_new_login() {
        for status in [200, 400] {
            let f = fake(true, 200, 200);
            let gate = Gate::new();
            {
                let mut f = f.lock().unwrap();
                f.token_gate = Some(gate.clone());
                f.token_status = status;
                f.token_error = "invalid_grant";
            }
            let cfg = serve(f).await;
            let session = signed_in().await;
            let (result, ()) = tokio::join!(probe(&session, &cfg), async {
                gate.arrived().await;
                session.adopt(replacement()).await.unwrap();
                gate.release.add_permits(1);
            });
            assert_eq!(result.unwrap_err(), SUPERSEDED);
            assert_replacement(&session);
        }
    }

    #[tokio::test]
    async fn late_refresh_and_login_cannot_restore_signed_out_credentials() {
        let f = fake(true, 200, 200);
        let gate = Gate::new();
        f.lock().unwrap().token_gate = Some(gate.clone());
        let cfg = serve(f).await;
        let session = signed_in().await;
        let generation = session.begin_sign_in().unwrap();
        let (result, ()) = tokio::join!(probe(&session, &cfg), async {
            gate.arrived().await;
            session.sign_out().await.unwrap();
            gate.release.add_permits(1);
        });
        assert_eq!(result.unwrap_err(), SUPERSEDED);
        assert_eq!(
            session.adopt_for(generation, replacement()).unwrap_err(),
            SUPERSEDED
        );
        assert!(!session.has_credentials().unwrap());
    }

    #[tokio::test]
    async fn concurrent_401s_share_one_refresh_and_keep_unrotated_refresh_token() {
        let f = fake(true, 200, 200);
        f.lock().unwrap().omit_rotated_refresh = true;
        let cfg = serve(f.clone()).await;
        let session = signed_in().await;
        let (first, second) = tokio::join!(probe(&session, &cfg), probe(&session, &cfg));
        assert_eq!(first.unwrap().status, 200);
        assert_eq!(second.unwrap().status, 200);
        assert_eq!(f.lock().unwrap().token_requests, 1);
        assert_eq!(
            session.refresh.load().unwrap().as_deref(),
            Some("refresh-1")
        );
    }

    #[tokio::test]
    async fn only_explicit_invalid_grant_ends_the_current_session() {
        for (status, error, rejected) in [
            (400, "invalid_grant", true),
            (400, "invalid_client", false),
            (429, "invalid_grant", false),
            (503, "invalid_grant", false),
            (400, "private unexpected body", false),
        ] {
            let f = fake(true, 200, 200);
            {
                let mut f = f.lock().unwrap();
                f.token_status = status;
                f.token_error = error;
            }
            let cfg = serve(f).await;
            let session = signed_in().await;
            let failure = probe(&session, &cfg).await.unwrap_err();
            assert_eq!(failure == NOT_SIGNED_IN, rejected);
            assert_eq!(session.has_credentials().unwrap(), !rejected);
            assert!(!failure.contains(error));
            assert!(!failure.contains("private"));
        }
    }

    #[tokio::test]
    async fn logout_uses_only_its_snapshot_and_does_not_clear_new_login() {
        let f = fake(true, 200, 200);
        let gate = Gate::new();
        f.lock().unwrap().logout_gate = Some(gate.clone());
        let cfg = serve(f.clone()).await;
        let session = signed_in().await;
        let http = reqwest::Client::new();
        let (report, ()) = tokio::join!(session.end_session(&http, &cfg), async {
            gate.arrived().await;
            assert!(!session.has_credentials().unwrap(), "本机先退出，不等网络");
            session.adopt(replacement()).await.unwrap();
            gate.release.add_permits(1);
        });
        assert_eq!(
            report.unwrap(),
            SignOutReport {
                core_session_revoked: true,
                refresh_token_revoked: true
            }
        );
        assert_eq!(f.lock().unwrap().revocations[0]["token"], "refresh-1");
        assert_replacement(&session);
    }

    #[tokio::test]
    async fn logout_during_refresh_reports_unknown_rotation_without_restoring_it() {
        let f = fake(true, 200, 200);
        let gate = Gate::new();
        f.lock().unwrap().token_gate = Some(gate.clone());
        let cfg = serve(f).await;
        let session = signed_in().await;
        let (result, report) = tokio::join!(probe(&session, &cfg), async {
            gate.arrived().await;
            let report = session
                .end_session(&reqwest::Client::new(), &cfg)
                .await
                .unwrap();
            gate.release.add_permits(1);
            report
        });
        assert_eq!(result.unwrap_err(), SUPERSEDED);
        assert!(report.core_session_revoked);
        assert!(!report.refresh_token_revoked);
        assert!(!session.has_credentials().unwrap());
    }
}
