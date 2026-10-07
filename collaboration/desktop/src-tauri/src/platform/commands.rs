//! 前端可调用的平台命令。令牌不出 Rust：前端只拿到 BFF 回应的状态码与正文。

use nostr::{EventBuilder, Kind, Tag};
use reqwest::Method;
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use super::api::{ApiResponse, NativeSession, SignOutReport};
use super::config::{self, PlatformConfig};
use super::oidc;
use crate::app_state::AppState;

/// 设备登记端点（`DD-79`）。持钥证明的 `u` 标签必须指向它。
const REGISTER_PATH: &str = "/api/v1/identity/client-keys";

pub(super) fn require_config(app: &AppHandle) -> Result<PlatformConfig, String> {
    config::load(app)?.ok_or_else(|| "尚未配置平台服务".to_owned())
}

#[tauri::command]
pub(crate) fn platform_get_config(app: AppHandle) -> Result<Option<PlatformConfig>, String> {
    config::load(&app)
}

#[tauri::command]
pub(crate) fn platform_set_config(app: AppHandle, config: PlatformConfig) -> Result<(), String> {
    config::save(&app, &config)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlatformStatus {
    configured: bool,
    /// 本机有访问或刷新令牌。它是否仍被服务端接受，要到下一次调用才知道。
    signed_in: bool,
}

#[tauri::command]
pub(crate) fn platform_status(
    app: AppHandle,
    session: State<'_, NativeSession>,
) -> Result<PlatformStatus, String> {
    Ok(PlatformStatus {
        configured: config::load(&app)?.is_some(),
        signed_in: session.has_credentials()?,
    })
}

#[tauri::command]
pub(crate) async fn platform_sign_in(
    app: AppHandle,
    state: State<'_, AppState>,
    session: State<'_, NativeSession>,
) -> Result<(), String> {
    let cfg = require_config(&app)?;
    let generation = session.begin_sign_in()?;
    let open = |url: &str| {
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|e| format!("无法打开系统浏览器：{e}"))
    };
    let tokens = oidc::sign_in(open, &state.http_client, &cfg, &session.pending).await?;
    session.adopt_for(generation, tokens)
}

#[tauri::command]
pub(crate) fn platform_cancel_sign_in(session: State<'_, NativeSession>) -> Result<(), String> {
    // 即使回调已完成、正等令牌端点，取消也必须阻止迟到令牌落盘。
    session.begin_sign_in()?;
    session.pending.cancel();
    Ok(())
}

/// 注销：先丢弃本机令牌，再以原凭据快照撤销 Core 的 PlatformSession 和 IdP
/// 刷新令牌（[`NativeSession::end_session`]）。服务端未确认不阻止本机退出——本机
/// 不再持有它才是用户要的结果——但如实返回给前端，由它说明服务端未确认。
#[tauri::command]
pub(crate) async fn platform_sign_out(
    app: AppHandle,
    state: State<'_, AppState>,
    session: State<'_, NativeSession>,
) -> Result<SignOutReport, String> {
    super::native_auth::close_all(&app);
    match require_config(&app) {
        Ok(cfg) => {
            let report = session.end_session(&state.http_client, &cfg).await?;
            if report
                != (SignOutReport {
                    core_session_revoked: true,
                    refresh_token_revoked: true,
                })
            {
                eprintln!("platform: 服务端未确认注销：{report:?}");
            }
            Ok(report)
        }
        Err(_) => {
            // 没有部署配置就到不了任何服务端：本机若还持有凭据，服务端未确认
            let held = session.has_credentials();
            session.sign_out().await?;
            let held = held.unwrap_or(true);
            Ok(SignOutReport {
                core_session_revoked: !held,
                refresh_token_revoked: !held,
            })
        }
    }
}

/// 代发一次管理平面请求。只接受 `/api/v1/` 下的路径与常用方法。
#[tauri::command]
pub(crate) async fn platform_api(
    app: AppHandle,
    state: State<'_, AppState>,
    session: State<'_, NativeSession>,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
) -> Result<ApiResponse, String> {
    let method = match method.as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        "PUT" => Method::PUT,
        "DELETE" => Method::DELETE,
        other => return Err(format!("不支持的方法 {other}")),
    };
    let cfg = require_config(&app)?;
    session
        .call(&state.http_client, &cfg, method, &path, body.as_ref())
        .await
}

/// 以本机设备身份登记公钥（`DD-79`）。
///
/// 持钥证明绑定当前 PlatformSession：截获的证明不能在别人的会话里重放。设备私钥
/// 就是本应用在 OS keyring 中的身份密钥，证明在 Rust 侧签名，私钥不出进程。
#[tauri::command]
pub(crate) async fn platform_register_device(
    app: AppHandle,
    state: State<'_, AppState>,
    session: State<'_, NativeSession>,
) -> Result<ApiResponse, String> {
    let cfg = require_config(&app)?;
    let keys = state.signing_keys()?;
    register_device(&session, &state.http_client, &cfg, &keys).await
}

/// 登记一把设备公钥：取当前会话、以该私钥签持钥证明、提交。
pub(crate) async fn register_device(
    session: &NativeSession,
    http: &reqwest::Client,
    cfg: &PlatformConfig,
    keys: &nostr::Keys,
) -> Result<ApiResponse, String> {
    let current = session
        .call(http, cfg, Method::GET, "/api/v1/session", None)
        .await?;
    if current.status != 200 {
        return Ok(current);
    }
    let session_id = current
        .body
        .get("platformSessionId")
        .and_then(|v| v.as_str())
        .ok_or("会话响应缺 platformSessionId")?
        .to_owned();

    let url = cfg.api_url(REGISTER_PATH)?;
    let tag = |parts: [&str; 2]| Tag::parse(parts).map_err(|e| format!("证明标签：{e}"));
    let proof = EventBuilder::new(Kind::HttpAuth, "")
        .tags(vec![
            tag(["u", url.as_str()])?,
            tag(["method", "POST"])?,
            tag(["session", &session_id])?,
        ])
        .sign_with_keys(keys)
        .map_err(|e| format!("签名持钥证明失败：{e}"))?;
    let body = serde_json::json!({ "proof": proof });
    session
        .call(http, cfg, Method::POST, REGISTER_PATH, Some(&body))
        .await
}
