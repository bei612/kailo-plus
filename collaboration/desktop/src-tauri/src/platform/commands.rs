//! 前端可调用的平台命令。令牌不出 Rust：前端只拿到 BFF 回应的状态码与正文。

use std::collections::BTreeMap;

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
    let generation = session.begin_sign_in().await?;
    let open = |url: &str| {
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|e| format!("无法打开系统浏览器：{e}"))
    };
    let tokens = oidc::sign_in(open, &state.http_client, &cfg, &session.pending).await?;
    session.adopt_for(generation, tokens).await
}

#[tauri::command]
pub(crate) async fn platform_cancel_sign_in(
    session: State<'_, NativeSession>,
) -> Result<(), String> {
    // 即使回调已完成、正等令牌端点，取消也必须阻止迟到令牌落盘。
    session.begin_sign_in().await?;
    session.pending.cancel();
    Ok(())
}

/// 注销：先丢弃本机令牌，再以原凭据快照撤销 Core 的 PlatformSession 和 IdP
/// 刷新令牌，最后以不可见窗口结束应用 WebView 中的 IdP 会话
/// （[`NativeSession::end_session`]、`.design/07` §4.7.5「Desktop」）。服务端未确认不
/// 阻止本机退出——本机不再持有它才是用户要的结果——但如实返回给前端，由它说明
/// 服务端未确认。
#[tauri::command]
pub(crate) async fn platform_sign_out(
    app: AppHandle,
    state: State<'_, AppState>,
    session: State<'_, NativeSession>,
) -> Result<SignOutReport, String> {
    super::native_auth::close_all(&app);
    let result = async {
        match require_config(&app) {
            Ok(cfg) => {
                let browser = super::native_auth::WindowLogoutBrowser::new(&app, &cfg);
                let report = session
                    .end_session(&state.http_client, &cfg, &browser)
                    .await?;
                if report
                    != (SignOutReport {
                        core_session_revoked: true,
                        refresh_token_revoked: true,
                        embedded_idp_session_ended: true,
                    })
                {
                    eprintln!("platform: 服务端未确认注销：{report:?}");
                }
                Ok(report)
            }
            Err(_) => {
                // 没有部署配置就到不了任何服务端：本机若还持有凭据，服务端未确认
                let held = session.has_credentials();
                let hint_held = session.sign_out().await?;
                let held = held.unwrap_or(true);
                Ok(SignOutReport {
                    core_session_revoked: !held,
                    refresh_token_revoked: !held,
                    embedded_idp_session_ended: !hint_held,
                })
            }
        }
    }
    .await;
    result
}

/// 前端可附带的唯一额外请求头：一次发布意图的幂等键（DD-81、DD-142）。
const IDEMPOTENCY_KEY_HEADER: &str = "idempotency-key";

/// 前端请求头白名单。只放行 `Idempotency-Key`（名字按 HTTP 规则大小写不敏感，且只能出现
/// 一次），值必须是规范的小写连字符 UUID——与 Core 解析的形状相同。任何其他头一律拒绝，
/// 不静默丢弃：鉴权、Host、Cookie 等只由 Rust 侧决定。
fn idempotency_key_from_headers(
    headers: Option<&BTreeMap<String, String>>,
) -> Result<Option<uuid::Uuid>, String> {
    let Some(headers) = headers else {
        return Ok(None);
    };
    let mut key = None;
    for (name, value) in headers {
        if !name.eq_ignore_ascii_case(IDEMPOTENCY_KEY_HEADER) {
            return Err(format!("不代发请求头 {name}"));
        }
        if key.is_some() {
            return Err("Idempotency-Key 重复".to_owned());
        }
        let parsed = uuid::Uuid::parse_str(value)
            .ok()
            .filter(|id| id.hyphenated().to_string() == *value)
            .ok_or("Idempotency-Key 不是规范 UUID")?;
        key = Some(parsed);
    }
    Ok(key)
}

/// 代发一次管理平面请求。只接受 `/api/v1/` 下的路径与常用方法；额外请求头只放行
/// `Idempotency-Key`（[`idempotency_key_from_headers`]）。
#[tauri::command]
pub(crate) async fn platform_api(
    app: AppHandle,
    state: State<'_, AppState>,
    session: State<'_, NativeSession>,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
    headers: Option<BTreeMap<String, String>>,
) -> Result<ApiResponse, String> {
    let method = match method.as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        "PUT" => Method::PUT,
        "DELETE" => Method::DELETE,
        other => return Err(format!("不支持的方法 {other}")),
    };
    let idempotency_key = idempotency_key_from_headers(headers.as_ref())?;
    let cfg = require_config(&app)?;
    session
        .call_idempotent(
            &state.http_client,
            &cfg,
            method,
            &path,
            body.as_ref(),
            idempotency_key,
        )
        .await
}

/// DD-139: a candidate's 07 §4.7.3 Tenant avatar, read under this device's platform session.
///
/// Only the avatar route path is accepted; its single redirect is followed only to this
/// deployment's `/api/v1/profile/media/<sha256>` (no-redirect client, so the bearer never leaves
/// the native API origin). The image is returned as a `data:` URL for in-memory display and is
/// never written to disk. A 404 (other Tenant, revoked, no avatar) is `None`: initials remain.
#[tauri::command]
pub(crate) async fn platform_avatar(
    app: AppHandle,
    state: State<'_, AppState>,
    session: State<'_, NativeSession>,
    path: String,
) -> Result<Option<String>, String> {
    if !is_avatar_path(&path) {
        return Err("不代发头像路由之外的路径".to_owned());
    }
    let cfg = require_config(&app)?;
    let http = &state.media_fetch_client;
    let (first, _) = session.call_raw(http, &cfg, &path).await?;
    if first.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if first.status() != reqwest::StatusCode::FOUND {
        return Err(format!("头像路由返回 {}", first.status().as_u16()));
    }
    let Some(location) = first
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .filter(|location| is_profile_media_path(location))
    else {
        return Err("头像路由的跳转目标不是本部署的资料媒体".to_owned());
    };
    let (media, _) = session.call_raw(http, &cfg, &location).await?;
    if media.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !media.status().is_success() {
        return Err(format!("资料媒体返回 {}", media.status().as_u16()));
    }
    let content_type = media
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .filter(|value| value.starts_with("image/"))
        .ok_or("资料媒体不是图片")?;
    let bytes = crate::commands::link_preview::read_limited_bytes(
        media,
        crate::commands::link_preview::MAX_IMAGE_FETCH_BYTES,
    )
    .await?;
    use base64::Engine as _;
    Ok(Some(format!(
        "data:{content_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )))
}

/// 原版快照包上限：Agent PNG 10 MiB、团队 PNG 50 MiB（DD-131(2)(3)）。
const MAX_EXPORT_PACKAGE_BYTES: usize = 50 * 1024 * 1024;

/// DD-42、DD-131(2)：取一个 READY 的 ExportPackage。只代发本部署的导出包下载路由；是否可读由
/// BFF 对该 Asset 的 `read` 判定，不接受任意路径。返回字节与是否为 PNG。
async fn export_package_bytes(
    app: &AppHandle,
    state: &AppState,
    session: &NativeSession,
    asset_id: &str,
) -> Result<(Vec<u8>, bool), String> {
    let path = export_package_path(asset_id).ok_or("导出包 ID 无效")?;
    let cfg = require_config(app)?;
    let (response, _) = session
        .call_raw(&state.media_fetch_client, &cfg, &path)
        .await?;
    if !response.status().is_success() {
        return Err(format!("导出包下载返回 {}", response.status().as_u16()));
    }
    let png = match response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
    {
        Some("image/png") => true,
        Some("application/json") => false,
        _ => return Err("导出包不是快照格式".to_owned()),
    };
    let bytes =
        crate::commands::link_preview::read_limited_bytes(response, MAX_EXPORT_PACKAGE_BYTES)
            .await?;
    Ok((bytes, png))
}

/// 经原生保存对话框保存一个 READY 的 ExportPackage。
#[tauri::command]
pub(crate) async fn platform_export_package_save(
    app: AppHandle,
    state: State<'_, AppState>,
    session: State<'_, NativeSession>,
    asset_id: String,
    file_name: String,
) -> Result<bool, String> {
    let (bytes, png) = export_package_bytes(&app, &state, &session, &asset_id).await?;
    let name = crate::commands::media_filename::sanitize_filename(&file_name);
    let extension = if png { "png" } else { "json" };
    crate::commands::export_util::save_bytes_with_dialog(
        &app,
        &name,
        "Agent snapshot",
        &[extension],
        &bytes,
    )
    .await
}

/// DD-131(7)：原版“复制”所需的包字节（以原始 ArrayBuffer 回到前端，由其写入剪贴板）。
#[tauri::command]
pub(crate) async fn platform_export_package_read(
    app: AppHandle,
    state: State<'_, AppState>,
    session: State<'_, NativeSession>,
    asset_id: String,
) -> Result<tauri::ipc::Response, String> {
    let (bytes, _) = export_package_bytes(&app, &state, &session, &asset_id).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn export_package_path(asset_id: &str) -> Option<String> {
    let id = uuid::Uuid::parse_str(asset_id).ok()?;
    (id.hyphenated().to_string() == asset_id)
        .then(|| format!("/api/v1/export-packages/{id}/content"))
}

fn is_avatar_path(path: &str) -> bool {
    path.strip_prefix("/api/v1/identity/avatars/")
        .is_some_and(|subject| {
            !subject.is_empty()
                && subject.bytes().all(|b| {
                    b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~' | b'%')
                })
                && !subject.contains("..")
        })
}

fn is_profile_media_path(path: &str) -> bool {
    path.strip_prefix("/api/v1/profile/media/")
        .is_some_and(|sha| sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit()))
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

#[cfg(test)]
mod avatar_path_tests {
    use super::{is_avatar_path, is_profile_media_path};

    #[test]
    fn only_the_avatar_route_and_its_media_target_are_accepted() {
        assert!(is_avatar_path("/api/v1/identity/avatars/abc-123%40idp"));
        assert!(!is_avatar_path("/api/v1/identity/avatars/"));
        assert!(!is_avatar_path("/api/v1/identity/avatars/a/../../session"));
        assert!(!is_avatar_path("/api/v1/session"));
        assert!(!is_avatar_path("/api/v1/identity/avatars/a?x=1"));
        assert!(is_profile_media_path(&format!(
            "/api/v1/profile/media/{}",
            "a".repeat(64)
        )));
        assert!(!is_profile_media_path(
            "https://evil.example/api/v1/profile/media/aa"
        ));
        assert!(!is_profile_media_path(&format!(
            "/api/v1/profile/media/{}",
            "g".repeat(64)
        )));
    }
}

#[cfg(test)]
mod export_package_tests {
    #[test]
    fn export_package_path_accepts_only_a_canonical_asset_id() {
        let id = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";
        assert_eq!(
            super::export_package_path(id).as_deref(),
            Some("/api/v1/export-packages/3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b/content")
        );
        for bad in [
            "../x",
            "3E4F5A6B-7C8D-4E9F-8A1B-2C3D4E5F6A7B",
            "3e4f5a6b7c8d4e9f8a1b2c3d4e5f6a7b",
            "",
        ] {
            assert!(super::export_package_path(bad).is_none());
        }
    }
}

#[cfg(test)]
mod platform_api_header_tests {
    use std::collections::BTreeMap;

    use super::idempotency_key_from_headers;

    const KEY: &str = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";

    fn headers(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
            .collect()
    }

    #[test]
    fn no_headers_forward_nothing() {
        assert_eq!(idempotency_key_from_headers(None), Ok(None));
        assert_eq!(idempotency_key_from_headers(Some(&headers(&[]))), Ok(None));
    }

    #[test]
    fn only_a_canonical_idempotency_key_is_forwarded() {
        for name in ["Idempotency-Key", "idempotency-key", "IDEMPOTENCY-KEY"] {
            let key = idempotency_key_from_headers(Some(&headers(&[(name, KEY)])))
                .expect("whitelisted header")
                .expect("key");
            assert_eq!(key.hyphenated().to_string(), KEY);
        }
        for bad in [
            "",
            "not-a-uuid",
            "3E4F5A6B-7C8D-4E9F-8A1B-2C3D4E5F6A7B",
            "3e4f5a6b7c8d4e9f8a1b2c3d4e5f6a7b",
            "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b\r\nX-Injected: 1",
        ] {
            assert!(
                idempotency_key_from_headers(Some(&headers(&[("Idempotency-Key", bad)]))).is_err()
            );
        }
    }

    #[test]
    fn any_other_header_is_refused() {
        for name in [
            "Authorization",
            "Cookie",
            "Host",
            "Content-Type",
            "X-Forwarded-For",
            "Idempotency-Key ",
            "Idempotency_Key",
        ] {
            assert!(idempotency_key_from_headers(Some(&headers(&[(name, KEY)]))).is_err());
            // Not silently dropped beside an allowed key either.
            assert!(idempotency_key_from_headers(Some(&headers(&[
                ("Idempotency-Key", KEY),
                (name, KEY)
            ])))
            .is_err());
        }
    }

    #[test]
    fn a_repeated_key_under_another_casing_is_refused() {
        assert!(idempotency_key_from_headers(Some(&headers(&[
            ("Idempotency-Key", KEY),
            ("idempotency-key", KEY)
        ])))
        .is_err());
    }
}
