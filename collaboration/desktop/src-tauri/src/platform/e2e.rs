//! 桌面端平台接入的端到端核验，对运行中的平台本地拓扑执行。
//!
//! 走的是应用自己的代码：登录（PKCE、state、回环回调、换令牌）、设备登记、
//! Community 连接事实、以设备私钥经 Relay 读写（`relay::query_relay_at_with_keys`
//! 与 `relay::submit_event_at_with_keys`，即桌面端发消息的那条路径）。唯一的替身
//! 是浏览器：一个按 IdP 登录表单作答的模拟浏览器，代替用户在系统浏览器里的操作。
//!
//! 需要一个真实 Workspace（其成员是 `PLATFORM_E2E_USER`），由
//! 本仓库的 `core/verify/desktop-e2e.sh` 准备并传入环境变量后以
//! `cargo test --lib platform::e2e -- --ignored` 运行。

use std::time::{Duration, Instant};

use nostr::{Keys, Tag};
use reqwest::Method;

use super::api::{NativeSession, RefreshStore};
use super::commands::register_device;
use super::config::PlatformConfig;
use super::oidc;

#[derive(Clone, Default)]
struct MemoryStore(std::sync::Arc<std::sync::Mutex<Option<String>>>);

impl RefreshStore for MemoryStore {
    fn load(&self) -> Result<Option<String>, String> {
        Ok(self.0.lock().map_err(|e| e.to_string())?.clone())
    }
    fn store(&self, value: &str) -> Result<(), String> {
        *self.0.lock().map_err(|e| e.to_string())? = Some(value.to_owned());
        Ok(())
    }
    fn delete(&self) -> Result<(), String> {
        *self.0.lock().map_err(|e| e.to_string())? = None;
        Ok(())
    }
}

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("缺少 {name}"))
}

/// 模拟用户在浏览器里的操作：打开授权页，按登录表单填入口令，跟随回到回环
/// 地址的重定向。cookie 手工携带：只有这一个站点、两次请求。
async fn browse(authorize: String, user: String, password: String) {
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("http client");
    let page = http.get(&authorize).send().await.expect("打开授权页");
    let cookies: Vec<String> = page
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|c| c.to_str().ok()?.split(';').next().map(str::to_owned))
        .collect();
    let html = page.text().await.expect("授权页");
    let action = html
        .split("action=\"")
        .nth(1)
        .and_then(|s| s.split('"').next())
        .expect("登录表单 action")
        .replace("&amp;", "&");
    let login = http
        .post(&action)
        .header(reqwest::header::COOKIE, cookies.join("; "))
        .form(&[("username", user.as_str()), ("password", password.as_str())])
        .send()
        .await
        .expect("提交登录");
    let back = login
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .expect("登录后应重定向回回环地址")
        .to_owned();
    assert!(back.starts_with("http://127.0.0.1:"), "回到的不是回环地址");
    http.get(&back).send().await.expect("访问回环回调");
}

async fn wait_device(
    session: &NativeSession,
    http: &reqwest::Client,
    cfg: &PlatformConfig,
    pubkey: &str,
    want: Option<&str>,
    bound: Duration,
) {
    let start = Instant::now();
    loop {
        let r = session
            .call(http, cfg, Method::GET, "/api/v1/identity/client-keys", None)
            .await
            .expect("列出设备");
        // 已撤销的设备不再出现在列表里：期望「不在列表」即 None
        let state = r
            .body
            .as_array()
            .and_then(|a| a.iter().find(|k| k["pubkey"] == pubkey))
            .and_then(|k| k["state"].as_str())
            .map(str::to_owned);
        if state.as_deref() == want {
            return;
        }
        assert!(
            start.elapsed() < bound,
            "设备停在 {state:?}，未在 {bound:?} 内到 {want:?}"
        );
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

#[tokio::test]
#[ignore = "端到端核验：需要运行中的本地拓扑与真实 Workspace，见模块说明"]
async fn desktop_signs_in_registers_device_and_publishes_through_relay() {
    let cfg = PlatformConfig {
        native_api_url: env("PLATFORM_E2E_NATIVE_URL"),
        oidc_issuer: env("PLATFORM_E2E_OIDC_ISSUER"),
        oidc_client_id: env("PLATFORM_E2E_CLIENT_ID"),
    };
    let user = env("PLATFORM_E2E_USER");
    let password = std::fs::read_to_string(env("PLATFORM_E2E_PASSWORD_FILE"))
        .expect("读口令文件")
        .trim()
        .to_owned();
    let bound = Duration::from_secs(env("PLATFORM_E2E_CONVERGE_SECS").parse().expect("秒数"));
    let state = crate::app_state::build_app_state();
    let http = state.http_client.clone();
    let refresh_store = MemoryStore::default();
    let session = NativeSession::with_store(Box::new(refresh_store.clone()));

    // 1. RFC 8252 登录
    let open = |url: &str| {
        tokio::spawn(browse(url.to_owned(), user.clone(), password.clone()));
        Ok(())
    };
    let tokens = oidc::sign_in(open, &http, &cfg, &session.pending)
        .await
        .expect("登录");
    session.adopt(tokens).await.expect("保存令牌");

    // 2. 设备登记：本机生成的私钥，持钥证明绑定当前会话
    let device = Keys::generate();
    let pubkey = device.public_key().to_hex();
    let r = register_device(&session, &http, &cfg, &device)
        .await
        .expect("登记");
    assert_eq!(r.status, 202, "登记应被受理：{}", r.body);
    wait_device(&session, &http, &cfg, &pubkey, Some("ACTIVE"), bound).await;

    // 3. Community 连接事实
    let facts = session
        .call(&http, &cfg, Method::GET, "/api/v1/native/community", None)
        .await
        .expect("连接事实");
    assert_eq!(facts.status, 200, "{}", facts.body);
    let relay_url = facts.body["relayUrl"]
        .as_str()
        .expect("relayUrl")
        .to_owned();
    let api_base = crate::relay::relay_http_base_url(&relay_url);

    // 4. 以设备私钥直连 Relay：找到自己所在的 Channel 并发消息
    let rosters = crate::relay::query_relay_at_with_keys(
        &state,
        &api_base,
        &[serde_json::json!({ "kinds": [39002], "#p": [pubkey] })],
        &device,
        None,
    )
    .await
    .expect("读 roster");
    let channel = rosters
        .iter()
        .find_map(|e| {
            e.tags
                .iter()
                .find(|t| t.as_slice().first().map(String::as_str) == Some("d"))
                .and_then(|t| t.as_slice().get(1).cloned())
        })
        .expect("设备应已在所属 Workspace 的 Channel roster 上");
    let channel_id: uuid::Uuid = channel.parse().expect("Channel id");
    let builder = crate::events::build_message(
        channel_id,
        "from platform desktop",
        None,
        &[],
        &[],
        &[],
        &[],
        &[],
        None,
        &api_base,
    )
    .expect("构造消息");
    crate::relay::submit_event_at_with_keys(builder, &state, &api_base, &device)
        .await
        .expect("设备直连 Relay 发消息应被接受");

    // 5. 直连不等于能治理：自建 Channel 被 Relay 拒绝（DD-80）
    let rogue = nostr::EventBuilder::new(nostr::Kind::Custom(9007), "").tags(vec![
        Tag::parse(["h", &uuid::Uuid::new_v4().to_string()]).expect("h"),
        Tag::parse(["name", "rogue"]).expect("name"),
        Tag::parse(["visibility", "private"]).expect("visibility"),
    ]);
    let created = crate::relay::submit_event_at_with_keys(rogue, &state, &api_base, &device).await;
    assert!(created.is_err(), "设备不得自建 Channel：{created:?}");

    // 6. 撤销本设备后 Relay 拒绝它
    let revoked = session
        .call(
            &http,
            &cfg,
            Method::DELETE,
            &format!("/api/v1/identity/client-keys/{pubkey}"),
            None,
        )
        .await
        .expect("撤销");
    assert_eq!(revoked.status, 202, "{}", revoked.body);
    wait_device(&session, &http, &cfg, &pubkey, None, bound).await;
    let after = crate::events::build_message(
        channel_id,
        "after revocation",
        None,
        &[],
        &[],
        &[],
        &[],
        &[],
        None,
        &api_base,
    )
    .expect("构造消息");
    let rejected = crate::relay::submit_event_at_with_keys(after, &state, &api_base, &device).await;
    // 拒绝必须来自 Relay（HTTP 4xx 或 accepted=false），而不是连不上
    let error = rejected.expect_err("撤销后 Relay 必须拒绝这台设备");
    assert!(
        error.starts_with("relay returned 4") || error.starts_with("relay rejected event:"),
        "撤销后的拒绝应来自 Relay：{error}"
    );
    println!("撤销后发布的结果：{error}");

    // 7. 注销：撤销 Core 会话、在 IdP 作废刷新令牌、丢弃本机凭据
    let held = refresh_store
        .load()
        .expect("读刷新令牌")
        .expect("应持有刷新令牌");
    let report = session.end_session(&http, &cfg).await.expect("注销");
    assert!(
        report.core_session_revoked && report.refresh_token_revoked,
        "Core 与 IdP 都应确认结束登录：{report:?}"
    );
    assert!(!session.has_credentials().expect("读凭据"));
    let reused = oidc::refresh(&http, &cfg, &held).await;
    assert!(
        matches!(reused, Err(oidc::OidcError::Rejected(_))),
        "注销后原刷新令牌必须被 IdP 拒绝（不输出响应中的凭据）"
    );
}
