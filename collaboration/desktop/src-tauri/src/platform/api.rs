//! 令牌的持有与管理平面调用。
//!
//! 刷新令牌存 OS keyring（与设备身份同一个 secret store），访问令牌只在内存。
//! 原生认证窗口在应用 WebView 中建立的 IdP 会话，其 ID token 作为退出提示存同一
//! secret store（DD-133(6)、`.design/07` §4.7.5「Desktop」）。
//! 不按到期时间提前刷新——那要一个拍脑袋的提前量；而是在 BFF 回 401 时刷新一次
//! 并重试一次，两次都不行即判为需要重新登录。

use reqwest::Method;
use serde::Serialize;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Mutex as StateMutex, MutexGuard, OnceLock};
use tokio::sync::Mutex;

use super::config::PlatformConfig;
use super::oidc::{self, OidcError, PendingLogin, TokenResponse};
use crate::app_state::keyring_service;
use crate::secret_store::SecretStore;

/// keyring 中刷新令牌的条目名
const REFRESH_KEY: &str = "platform-refresh-token";
/// keyring 中 WebView IdP 会话退出提示（原生认证窗口那次登录的 ID token）的条目名
const EMBEDDED_HINT_KEY: &str = "platform-embedded-id-token";

/// 前端可经本模块调用的 BFF 路径前缀。其余一概不代发。
const API_PREFIX: &str = "/api/v1/";

/// 一条长期凭据（刷新令牌或退出提示）的存放处。应用里是 OS keyring；无图形会话的
/// 端到端核验里是内存。
pub(crate) trait RefreshStore: Send + Sync {
    fn load(&self) -> Result<Option<String>, String>;
    fn store(&self, value: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

/// OS keyring，与设备身份同一个 secret store。keyring 不可用时写入失败，登录随之
/// 失败——不退而把长期凭据写成文件。
struct KeyringStore(&'static str);

impl RefreshStore for KeyringStore {
    fn load(&self) -> Result<Option<String>, String> {
        store().load(self.0)
    }
    fn store(&self, value: &str) -> Result<(), String> {
        store().store(self.0, value)
    }
    fn delete(&self) -> Result<(), String> {
        store().delete(self.0)
    }
}

/// 退出时结束应用 WebView 中 IdP 会话的那个不可见窗口。应用里是 Tauri 窗口
/// （`native_auth::WindowLogoutBrowser`），测试里是假实现。
pub(crate) trait LogoutBrowser: Send + Sync {
    /// 导航到 RP-Initiated Logout 地址；只有到达被拦截的回跳地址才返回 true。
    fn end_session<'a>(&'a self, url: url::Url) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>>;
}

/// DD-159: erase local copies at the same lifecycle boundary as credentials.
pub(crate) trait SessionArchive: Send + Sync {
    fn erase(&self) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>>;
}

pub(crate) struct NativeSession {
    lifecycle: Mutex<()>,
    archive: OnceLock<Box<dyn SessionArchive>>,
    state: StateMutex<SessionState>,
    refreshing: Mutex<()>,
    refresh: Box<dyn RefreshStore>,
    /// WebView IdP 会话的退出提示；新的一次覆盖旧值，退出时取出并删除
    embedded_hint: Box<dyn RefreshStore>,
    pub(crate) pending: PendingLogin,
}

#[derive(Default)]
struct SessionState {
    generation: u64,
    access: Option<String>,
    retired: bool,
}

impl Default for NativeSession {
    fn default() -> Self {
        Self::with_stores(
            Box::new(KeyringStore(REFRESH_KEY)),
            Box::new(KeyringStore(EMBEDDED_HINT_KEY)),
        )
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
    /// 应用 WebView 中的 IdP 会话已由 RP-Initiated Logout 确认结束（窗口到达被拦截的
    /// 回跳地址），或本机没有退出提示——即从未经原生认证窗口建立该会话
    /// （`.design/07` §4.7.5「Desktop」）。只有它为 true，组件才会收到 back-channel 退出。
    pub embedded_idp_session_ended: bool,
}

/// 前端据此判断是否要回到登录页。
pub(crate) const NOT_SIGNED_IN: &str = "PLATFORM_NOT_SIGNED_IN";
// 旧操作不代表当前会话已结束，不能触发前端的 onSessionEnded。
const SUPERSEDED: &str = "PLATFORM_OPERATION_SUPERSEDED";

fn store() -> &'static SecretStore {
    SecretStore::shared(keyring_service())
}

impl NativeSession {
    pub(crate) fn page_generation(&self) -> Result<u64, String> {
        let state = self.state()?;
        if state.access.is_none() {
            return Err(NOT_SIGNED_IN.into());
        }
        Ok(state.generation)
    }

    pub(crate) fn page_generation_matches(&self, generation: u64) -> bool {
        self.state()
            .is_ok_and(|state| state.generation == generation && state.access.is_some())
    }

    pub(crate) fn with_stores(
        refresh: Box<dyn RefreshStore>,
        embedded_hint: Box<dyn RefreshStore>,
    ) -> Self {
        Self {
            lifecycle: Mutex::new(()),
            archive: OnceLock::new(),
            state: StateMutex::new(SessionState::default()),
            refreshing: Mutex::new(()),
            refresh,
            embedded_hint,
            pending: PendingLogin::default(),
        }
    }

    pub(crate) fn set_archive(&self, archive: Box<dyn SessionArchive>) -> Result<(), String> {
        self.archive
            .set(archive)
            .map_err(|_| "archive lifecycle already installed".to_owned())
    }

    async fn erase_archive(&self) -> Result<(), String> {
        match self.archive.get() {
            Some(archive) => archive.erase().await,
            None => Ok(()),
        }
    }

    /// 保存原生认证窗口那次登录的 ID token，覆盖旧值。只在该窗口打开时的登录
    /// 代际仍有效时保存：期间已退出或换了登录，迟到的提示不落盘。
    pub(crate) fn store_embedded_hint(
        &self,
        generation: u64,
        id_token: &str,
    ) -> Result<(), String> {
        let state = self.state()?;
        if state.generation != generation || state.access.is_none() {
            return Err(SUPERSEDED.to_owned());
        }
        self.embedded_hint.store(id_token)
    }

    fn state(&self) -> Result<MutexGuard<'_, SessionState>, String> {
        self.state
            .lock()
            .map_err(|_| "PLATFORM_SESSION_UNAVAILABLE".to_owned())
    }

    /// 在等待浏览器之前固定登录代际；取消、退出及下一次登录都会使它失效。
    pub(crate) async fn begin_sign_in(&self) -> Result<u64, String> {
        let _lifecycle = self.lifecycle.lock().await;
        let mut state = self.state()?;
        state.generation = state.generation.wrapping_add(1);
        Ok(state.generation)
    }

    /// 只接受仍属于该次登录的令牌，迟到回调不恢复已退出的身份。
    pub(crate) async fn adopt_for(
        &self,
        generation: u64,
        tokens: TokenResponse,
    ) -> Result<(), String> {
        let _lifecycle = self.lifecycle.lock().await;
        let retired = {
            let mut state = self.state()?;
            Self::check_generation(&state, generation)?;
            // No archive command may start under old credentials while cleanup waits
            // for an already-running sync. A failed erase cannot admit the new login.
            state.access = None;
            state.retired = true;
            self.refresh.delete()
        };
        let erased = self.erase_archive().await;
        retired?;
        erased?;
        let mut state = self.state()?;
        Self::check_generation(&state, generation)?;
        // 刷新令牌是长期凭据：没有它，下次启动就得重新登录；有它却存不进
        // keyring，就不能假装已经持久登录
        match tokens.refresh_token.as_deref() {
            Some(r) => self.refresh.store(r)?,
            None => self.refresh.delete()?,
        }
        state.access = Some(tokens.access_token);
        state.retired = false;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) async fn adopt(&self, tokens: TokenResponse) -> Result<(), String> {
        self.adopt_for(self.begin_sign_in().await?, tokens).await
    }

    fn check_generation(state: &SessionState, generation: u64) -> Result<(), String> {
        if state.generation != generation {
            return Err(SUPERSEDED.to_owned());
        }
        Ok(())
    }

    pub(crate) fn has_credentials(&self) -> Result<bool, String> {
        let state = self.state()?;
        Ok(!state.retired && (state.access.is_some() || self.refresh.load()?.is_some()))
    }

    /// 结束本机的平台登录（`SS-AGW-OIDC` 的原生部分）：先撤销 Core 的
    /// PlatformSession，再请 IdP 作废刷新令牌。先从本机移出这次凭据快照并使在途
    /// 操作失效，远端等待期间不阻塞新登录，也绝不清理新登录的凭据。本机凭据丢
    /// 不掉才返回错误；服务端未确认则如实写进报告。
    pub(crate) async fn end_session(
        &self,
        http: &reqwest::Client,
        cfg: &PlatformConfig,
        browser: &dyn LogoutBrowser,
    ) -> Result<SignOutReport, String> {
        let lifecycle = self.lifecycle.lock().await;
        let (mut access, mut refresh, refresh_in_flight, hint, local_clear) = {
            let mut state = self.state()?;
            state.generation = state.generation.wrapping_add(1);
            self.pending.cancel();
            let refresh = self.refresh.load();
            let access = state.access.take();
            state.retired = true;
            // 已发出的刷新可能已在 IdP 轮换、但尚未回到本机。撤销快照成功也
            // 不能证明那个结果不明的令牌被撤销，报告仍须保持未确认。
            let refresh_in_flight = self.refreshing.try_lock().is_err();
            // 即使读取失败也尝试删除，不让一次读取错误跳过本机退出。
            let refresh_deleted = self.refresh.delete();
            // 退出提示同样先移出本机：不论 IdP 是否确认都不再保留（07 §4.7.5）。
            let hint = self.embedded_hint.load();
            let hint_deleted = self.embedded_hint.delete();
            (
                access,
                refresh,
                refresh_in_flight,
                hint,
                refresh_deleted.and(hint_deleted),
            )
        };
        // Erase before any remote logout wait. New logins may proceed afterwards;
        // a late logout response must never erase their archive.
        let erased = self.erase_archive().await;
        drop(lifecycle);
        local_clear?;
        erased?;
        let core_session_revoked = match refresh.as_mut() {
            Ok(refresh) => logout_snapshot(http, cfg, &mut access, refresh).await,
            Err(_) => false,
        };
        let refresh_token_revoked = match refresh {
            Ok(Some(token)) => oidc::revoke_refresh_token(http, cfg, &token).await,
            Ok(None) => true,
            Err(_) => false,
        } && !refresh_in_flight;
        // 在 Core 与刷新令牌之后结束 WebView 中的 IdP 会话：IdP 随即对其中的组件
        // client 投递 back-channel logout_token（DD-133(6)）。没有提示即没有该会话。
        let embedded_idp_session_ended = match hint {
            Ok(None) => true,
            Ok(Some(id_token)) => match oidc::end_session_url(http, cfg, &id_token).await {
                Ok(url) => browser.end_session(url).await,
                Err(_) => false,
            },
            Err(_) => false,
        };
        Ok(SignOutReport {
            core_session_revoked,
            refresh_token_revoked,
            embedded_idp_session_ended,
        })
    }

    /// 没有部署配置时的本机退出：丢弃令牌与退出提示，返回提示是否存在过
    /// （存在而无法结束即未确认）。
    pub(crate) async fn sign_out(&self) -> Result<bool, String> {
        let _lifecycle = self.lifecycle.lock().await;
        let (hint_held, local_clear) = {
            let mut state = self.state()?;
            state.generation = state.generation.wrapping_add(1);
            state.access = None;
            state.retired = true;
            self.pending.cancel();
            let hint_held = !matches!(self.embedded_hint.load(), Ok(None));
            let hint_deleted = self.embedded_hint.delete();
            let refresh_deleted = self.refresh.delete();
            (hint_held, hint_deleted.and(refresh_deleted))
        };
        let erased = self.erase_archive().await;
        local_clear?;
        erased?;
        Ok(hint_held)
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
            if state.retired {
                return Err(NOT_SIGNED_IN.into());
            }
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
        let _lifecycle = self.lifecycle.lock().await;
        Self::check_generation(&*self.state()?, generation)?;
        match result {
            Ok(mut tokens) => {
                let mut state = self.state()?;
                let access = tokens.access_token.clone();
                // OAuth 刷新可不轮换 refresh_token；缺省不等于撤销原凭据。
                let refresh = tokens.refresh_token.take().unwrap_or(refresh_token);
                self.refresh.store(&refresh)?;
                state.access = Some(tokens.access_token);
                Ok(access)
            }
            // 刷新令牌被 IdP 拒绝（过期、撤销、会话已结束）：只能重新登录
            Err(OidcError::Rejected(_)) => {
                let local_clear = {
                    let mut state = self.state()?;
                    state.generation = state.generation.wrapping_add(1);
                    state.access = None;
                    state.retired = true;
                    self.refresh.delete()
                };
                let erased = self.erase_archive().await;
                local_clear?;
                erased?;
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
        let (resp, generation) = self.send(http, cfg, method, path, body).await?;
        let status = resp.status();
        let body = if status == reqwest::StatusCode::NO_CONTENT {
            serde_json::Value::Null
        } else {
            resp.json().await.unwrap_or(serde_json::Value::Null)
        };
        Self::check_generation(&*self.state()?, generation)?;
        Ok(ApiResponse {
            status: status.as_u16(),
            body,
        })
    }

    /// The same authenticated request, handing back the raw response (DD-139 avatar bytes).
    /// `http` decides redirect handling; a non-JSON body never passes through `call`.
    pub(crate) async fn call_raw(
        &self,
        http: &reqwest::Client,
        cfg: &PlatformConfig,
        path: &str,
    ) -> Result<(reqwest::Response, u64), String> {
        self.send(http, cfg, Method::GET, path, None).await
    }

    /// Bearer request with one refresh-and-retry on 401; returns the response and its generation.
    async fn send(
        &self,
        http: &reqwest::Client,
        cfg: &PlatformConfig,
        method: Method,
        path: &str,
        body: Option<&serde_json::Value>,
    ) -> Result<(reqwest::Response, u64), String> {
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
                let _lifecycle = self.lifecycle.lock().await;
                let local_clear = {
                    let mut state = self.state()?;
                    Self::check_generation(&state, generation)?;
                    // 该401也可能比同代际的另一刷新迟到，不能清理新访问令牌。
                    if state.access.as_deref() != Some(token.as_str()) {
                        return Err(SUPERSEDED.to_owned());
                    }
                    state.generation = state.generation.wrapping_add(1);
                    state.access = None;
                    state.retired = true;
                    self.refresh.delete()
                };
                let erased = self.erase_archive().await;
                local_clear?;
                erased?;
                return Err(NOT_SIGNED_IN.to_owned());
            }
            return Ok((resp, generation));
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
        advertise_end_session: bool,
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
        reject_refreshed_access: bool,
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

    /// 没有退出提示时不得打开任何窗口。
    struct NoWindow;
    impl LogoutBrowser for NoWindow {
        fn end_session<'a>(
            &'a self,
            _: url::Url,
        ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
            panic!("没有退出提示时不能打开退出窗口")
        }
    }

    /// 记录收到的退出地址并回答事先给定的结果。
    struct Window {
        confirms: bool,
        opened: Mutex<Vec<url::Url>>,
    }
    impl LogoutBrowser for Window {
        fn end_session<'a>(
            &'a self,
            url: url::Url,
        ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
            self.opened.lock().unwrap().push(url);
            Box::pin(async move { self.confirms })
        }
    }

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
                        if f.advertise_end_session {
                            doc["end_session_endpoint"] =
                                serde_json::json!(format!("{}/realm/logout", f.base));
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
                        let status = if f.lock().unwrap().reject_refreshed_access || headers.get("authorization").unwrap() == "Bearer access-1" {
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
        let session = NativeSession::with_stores(
            Box::new(Memory(Mutex::new(None))),
            Box::new(Memory(Mutex::new(None))),
        );
        session
            .adopt(TokenResponse {
                access_token: "access-1".into(),
                refresh_token: Some("refresh-1".into()),
                id_token: None,
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
            .end_session(&reqwest::Client::new(), &cfg, &NoWindow)
            .await
            .unwrap();

        assert_eq!(
            report,
            SignOutReport {
                core_session_revoked: true,
                refresh_token_revoked: true,
                embedded_idp_session_ended: true,
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
                .end_session(&reqwest::Client::new(), &cfg, &NoWindow)
                .await
                .unwrap();

            assert_eq!(
                report,
                SignOutReport {
                    core_session_revoked: core_ok,
                    refresh_token_revoked: idp_ok,
                    embedded_idp_session_ended: true,
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
            id_token: None,
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
                .end_session(&reqwest::Client::new(), &cfg, &NoWindow)
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
        let generation = session.begin_sign_in().await.unwrap();
        let (result, ()) = tokio::join!(probe(&session, &cfg), async {
            gate.arrived().await;
            session.sign_out().await.unwrap();
            gate.release.add_permits(1);
        });
        assert_eq!(result.unwrap_err(), SUPERSEDED);
        assert_eq!(
            session
                .adopt_for(generation, replacement())
                .await
                .unwrap_err(),
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
        let (report, ()) = tokio::join!(session.end_session(&http, &cfg, &NoWindow), async {
            gate.arrived().await;
            assert!(!session.has_credentials().unwrap(), "本机先退出，不等网络");
            session.adopt(replacement()).await.unwrap();
            gate.release.add_permits(1);
        });
        assert_eq!(
            report.unwrap(),
            SignOutReport {
                core_session_revoked: true,
                refresh_token_revoked: true,
                embedded_idp_session_ended: true,
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
                .end_session(&reqwest::Client::new(), &cfg, &NoWindow)
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

    async fn with_hint(session: &NativeSession) {
        let generation = session.page_generation().unwrap();
        session.store_embedded_hint(generation, "hint-1").unwrap();
    }

    #[tokio::test]
    async fn sign_out_ends_the_webview_idp_session_with_the_stored_hint() {
        let f = fake(true, 200, 200);
        f.lock().unwrap().advertise_end_session = true;
        let cfg = serve(f.clone()).await;
        let session = signed_in().await;
        with_hint(&session).await;
        let window = Window {
            confirms: true,
            opened: Mutex::new(vec![]),
        };
        let report = session
            .end_session(&reqwest::Client::new(), &cfg, &window)
            .await
            .unwrap();
        assert_eq!(
            report,
            SignOutReport {
                core_session_revoked: true,
                refresh_token_revoked: true,
                embedded_idp_session_ended: true,
            }
        );
        let opened = window.opened.lock().unwrap();
        assert_eq!(opened.len(), 1);
        assert_eq!(opened[0].path(), "/realm/logout");
        let params: HashMap<String, String> = opened[0].query_pairs().into_owned().collect();
        assert_eq!(params["id_token_hint"], "hint-1");
        assert_eq!(params["client_id"], "native-client");
        assert_eq!(
            params["post_logout_redirect_uri"],
            oidc::SIGNED_OUT_REDIRECT
        );
        assert_eq!(
            session.embedded_hint.load().unwrap(),
            None,
            "提示随退出删除"
        );
        // Core 与刷新令牌照常先结束
        let f = f.lock().unwrap();
        assert_eq!(f.logouts, 1);
        assert_eq!(f.revocations.len(), 1);
    }

    #[tokio::test]
    async fn an_unconfirmed_idp_end_session_is_reported_and_the_hint_still_goes() {
        // 窗口未到达回跳地址；IdP 未公布 end_session_endpoint（不开窗口）
        for (advertise, confirms, opens) in [(true, false, 1), (false, true, 0)] {
            let f = fake(true, 200, 200);
            f.lock().unwrap().advertise_end_session = advertise;
            let cfg = serve(f).await;
            let session = signed_in().await;
            with_hint(&session).await;
            let window = Window {
                confirms,
                opened: Mutex::new(vec![]),
            };
            let report = session
                .end_session(&reqwest::Client::new(), &cfg, &window)
                .await
                .unwrap();
            assert!(!report.embedded_idp_session_ended, "advertise={advertise}");
            assert!(report.core_session_revoked && report.refresh_token_revoked);
            assert_eq!(window.opened.lock().unwrap().len(), opens);
            assert_eq!(session.embedded_hint.load().unwrap(), None);
        }
    }

    #[tokio::test]
    async fn a_late_hint_cannot_outlive_sign_out_or_a_new_login() {
        let session = signed_in().await;
        let generation = session.page_generation().unwrap();
        session.sign_out().await.unwrap();
        assert_eq!(
            session.store_embedded_hint(generation, "late").unwrap_err(),
            SUPERSEDED
        );
        session.adopt(replacement()).await.unwrap();
        assert!(session.store_embedded_hint(generation, "late").is_err());
        assert_eq!(session.embedded_hint.load().unwrap(), None);
        // 新的一次覆盖旧值
        let current = session.page_generation().unwrap();
        session.store_embedded_hint(current, "first").unwrap();
        session.store_embedded_hint(current, "second").unwrap();
        assert_eq!(
            session.embedded_hint.load().unwrap().as_deref(),
            Some("second")
        );
        assert!(session.sign_out().await.unwrap(), "退出报告提示曾存在");
        assert_eq!(session.embedded_hint.load().unwrap(), None);
    }
    include!("api_archive_tests.rs");
}
