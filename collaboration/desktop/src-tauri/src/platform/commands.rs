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

/// DD-131 快照包上传可用的媒体类型；其余不代发。
const SNAPSHOT_MEDIA_TYPES: [&str; 3] =
    ["application/json", "image/png", "application/octet-stream"];

/// `X-Snapshot-Filename` 只用于让 Core 拒绝旧 `.persona.*`：限可见 ASCII，至多 255 字节。
fn checked_snapshot_filename(value: Option<String>) -> Result<Option<String>, String> {
    match value {
        None => Ok(None),
        Some(name)
            if !name.is_empty()
                && name.len() <= 255
                && name.bytes().all(|b| (0x20..0x7f).contains(&b)) =>
        {
            Ok(Some(name))
        }
        Some(_) => Err("快照文件名不合规".to_owned()),
    }
}

/// 把字节回应编成 `native.ts::decodeBytesReply` 约定的帧：2 字节状态码、2 字节
/// Content-Type 长度（大端）、Content-Type、正文。正文不经 JSON 数组。
fn bytes_frame(response: super::api::BytesResponse) -> tauri::ipc::Response {
    let content_type = response.content_type.unwrap_or_default();
    let content_type = if content_type.len() > usize::from(u16::MAX) {
        String::new()
    } else {
        content_type
    };
    let mut frame = Vec::with_capacity(4 + content_type.len() + response.body.len());
    frame.extend_from_slice(&response.status.to_be_bytes());
    frame.extend_from_slice(&(content_type.len() as u16).to_be_bytes());
    frame.extend_from_slice(content_type.as_bytes());
    frame.extend_from_slice(&response.body);
    tauri::ipc::Response::new(frame)
}

/// DD-131：代发快照包的上传（POST 原始字节）或 ExportPackage 下载（GET）。路径仍限
/// `/api/v1/`，鉴权、刷新与代际规则与 `platform_api` 相同；令牌不出 Rust。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn platform_api_bytes(
    app: AppHandle,
    state: State<'_, AppState>,
    session: State<'_, NativeSession>,
    method: String,
    path: String,
    body: Option<Vec<u8>>,
    content_type: Option<String>,
    snapshot_filename: Option<String>,
) -> Result<tauri::ipc::Response, String> {
    let method = match method.as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        other => return Err(format!("不支持的方法 {other}")),
    };
    if let Some(kind) = content_type.as_deref() {
        if !SNAPSHOT_MEDIA_TYPES.contains(&kind) {
            return Err(format!("不代发 {kind} 正文"));
        }
    }
    let filename = checked_snapshot_filename(snapshot_filename)?;
    let upload = match (&body, content_type.as_deref()) {
        (Some(data), Some(kind)) => Some((data.as_slice(), kind)),
        (None, None) => None,
        _ => return Err("正文与 Content-Type 须同时给出".to_owned()),
    };
    let cfg = require_config(&app)?;
    let response = session
        .call_bytes(
            &state.http_client,
            &cfg,
            method,
            &path,
            upload,
            filename.as_deref(),
        )
        .await?;
    Ok(bytes_frame(response))
}

/// `platform_api_save` 的结果：BFF 状态码、是否写入了用户选定的文件、非 2xx 时的错误体。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveReport {
    status: u16,
    saved: bool,
    body: serde_json::Value,
}

/// 只保留可见 ASCII 的文件名字符，去掉路径分隔与控制字符。
fn save_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c| c == '.' || c == ' ');
    if trimmed.is_empty() {
        "snapshot".to_owned()
    } else {
        trimmed.chars().take(200).collect()
    }
}

/// DD-131：以本人会话下载一个 READY 的 ExportPackage（Asset `read`，Core 逐次授权），经
/// 原生保存对话框写入用户选定的文件。字节不经前端；只代发 ExportPackage 内容路径。
#[tauri::command]
pub(crate) async fn platform_api_save(
    app: AppHandle,
    state: State<'_, AppState>,
    session: State<'_, NativeSession>,
    path: String,
    suggested_filename: String,
) -> Result<SaveReport, String> {
    let rest = path
        .strip_prefix("/api/v1/export-packages/")
        .and_then(|rest| rest.strip_suffix("/content"))
        .ok_or_else(|| "只保存 ExportPackage 内容".to_owned())?;
    if rest.is_empty() || !rest.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return Err("只保存 ExportPackage 内容".to_owned());
    }
    let cfg = require_config(&app)?;
    let response = session
        .call_bytes(&state.http_client, &cfg, Method::GET, &path, None, None)
        .await?;
    if !(200..300).contains(&response.status) {
        let body = serde_json::from_slice(&response.body).unwrap_or(serde_json::Value::Null);
        return Ok(SaveReport {
            status: response.status,
            saved: false,
            body,
        });
    }
    let filename = save_filename(&suggested_filename);
    let extension = std::path::Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_owned);
    let extensions: Vec<&str> = extension.as_deref().into_iter().collect();
    let saved = crate::commands::export_util::save_bytes_with_dialog(
        &app,
        &filename,
        "Agent snapshot",
        &extensions,
        &response.body,
    )
    .await?;
    Ok(SaveReport {
        status: response.status,
        saved,
        body: serde_json::Value::Null,
    })
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
