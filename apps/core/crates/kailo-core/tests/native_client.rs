//! 原生端的身份链（DD-77/78/79），在真实拓扑上从头走到尾。
//!
//! 原生应用按 RFC 8252 取得令牌，经网关原生入口调用 BFF；在本机生成设备密钥并
//! 以持钥证明登记公钥；`BUZZ_IDENTITY_PROJECTION` 把它投入 roster 后，设备以
//! 自己的私钥**直连 Relay** 发消息；撤销设备后 Relay 拒绝它——准入的执行点是
//! Relay 的 roster，不是 Core 停止签名（DD-75）。

use futures_util::FutureExt;
use kailo_buzz::bridge::{Custody, IdentityClient};
use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};
use sqlx::PgPool;

mod common;
use common::{Env, NativeEnv};

const REGISTER: &str = "/api/v1/identity/client-keys";

/// 经网关原生入口调用：身份只来自 Bearer 令牌，网关验证后投影。
async fn native(
    http: &reqwest::Client,
    n: &NativeEnv,
    token: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<serde_json::Value>,
) -> (reqwest::StatusCode, serde_json::Value) {
    let mut req = http
        .request(method, format!("{}{path}", n.native_url))
        .bearer_auth(token);
    if let Some(b) = body {
        req = req.json(&b);
    }
    let resp = req.send().await.expect("调原生入口");
    let status = resp.status();
    (status, resp.json().await.unwrap_or(serde_json::Value::Null))
}

/// 模拟浏览器入口之后的请求：只有两条已验证的身份 header，没有原生入口标识。
async fn browser(
    http: &reqwest::Client,
    e: &Env,
    subject: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<serde_json::Value>,
) -> (reqwest::StatusCode, serde_json::Value) {
    let mut req = http
        .request(method, format!("{}{path}", e.bff_url))
        .header("x-kailo-oidc-issuer", &e.oidc_issuer)
        .header("x-kailo-oidc-subject", subject);
    if let Some(b) = body {
        req = req.json(&b);
    }
    let resp = req.send().await.expect("调 BFF");
    let status = resp.status();
    (status, resp.json().await.unwrap_or(serde_json::Value::Null))
}

/// NIP-98 持钥证明（DD-79）。字段逐项可变，好让每种伪造各自验一遍。
fn proof(keys: &Keys, url: &str, method: &str, session: &str, at: Timestamp) -> serde_json::Value {
    let event = EventBuilder::new(Kind::Custom(27235), "")
        .tags(vec![
            Tag::parse(["u", url]).expect("u"),
            Tag::parse(["method", method]).expect("method"),
            Tag::parse(["session", session]).expect("session"),
        ])
        .custom_created_at(at)
        .sign_with_keys(keys)
        .expect("签名");
    serde_json::json!({ "proof": event })
}

#[tokio::test]
async fn native_device_key_is_admitted_by_relay_then_revoked() {
    let (Some(e), Some(n)) = (common::env(), common::native_env()) else {
        return;
    };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;
    let subject = common::idp_subject(&http, &n).await;
    let fx = match common::provision_live_workspace_for(&http, &e, &pool, &token, &subject).await {
        Ok(f) => f,
        Err(msg) => panic!("准备真实 Workspace 失败: {msg}"),
    };
    let outcome = std::panic::AssertUnwindSafe(run(&http, &e, &n, &pool, &fx))
        .catch_unwind()
        .await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn run(
    http: &reqwest::Client,
    e: &Env,
    n: &NativeEnv,
    pool: &PgPool,
    fx: &common::LiveWorkspace,
) {
    let access = common::native_access_token(n).await;

    // 原生入口与浏览器入口之后是同一个 BFF：解析出同一个人
    let (status, session) = native(
        http,
        n,
        &access,
        reqwest::Method::GET,
        "/api/v1/session",
        None,
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::OK,
        "原生入口应能解析身份：{session}"
    );
    assert_eq!(session["tenantId"], fx.tenant.to_string());
    let session_id = session["platformSessionId"]
        .as_str()
        .expect("会话 ID")
        .to_owned();

    // 令牌不带或伪造：网关在 BFF 之前拒绝
    let no_token = http
        .get(format!("{}/api/v1/session", n.native_url))
        .send()
        .await
        .expect("无令牌请求");
    assert_eq!(
        no_token.status(),
        reqwest::StatusCode::UNAUTHORIZED,
        "strict 模式必须拒绝无令牌请求"
    );

    let device = Keys::generate();
    let url = format!("{}{REGISTER}", n.native_url);
    let now = Timestamp::now();

    // 浏览器入口不能登记设备：浏览器没有持钥方，也不该有这个入口
    let (status, body) = browser(
        http,
        e,
        &fx.subject,
        reqwest::Method::POST,
        REGISTER,
        Some(proof(&device, &url, "POST", &session_id, now)),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::FORBIDDEN);
    assert_eq!(body["reason"], "NATIVE_SURFACE_REQUIRED", "{body}");

    // 三种伪造的持钥证明，各对应一种真实滥用
    for (why, bad) in [
        (
            "绑定别人的会话",
            proof(
                &device,
                &url,
                "POST",
                &uuid::Uuid::new_v4().to_string(),
                now,
            ),
        ),
        (
            "方法不是 POST",
            proof(&device, &url, "GET", &session_id, now),
        ),
        (
            "过期的证明",
            proof(
                &device,
                &url,
                "POST",
                &session_id,
                Timestamp::from_secs(now.as_secs() - n.proof_window_secs - 60),
            ),
        ),
    ] {
        let (status, body) =
            native(http, n, &access, reqwest::Method::POST, REGISTER, Some(bad)).await;
        assert_eq!(
            status,
            reqwest::StatusCode::FORBIDDEN,
            "{why} 必须拒绝：{body}"
        );
        assert_eq!(body["reason"], "CLIENT_KEY_PROOF_INVALID", "{why}：{body}");
    }

    // 正路：登记后由 Workflow 投入 roster，状态收敛到 ACTIVE
    let (status, body) = native(
        http,
        n,
        &access,
        reqwest::Method::POST,
        REGISTER,
        Some(proof(&device, &url, "POST", &session_id, now)),
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::ACCEPTED,
        "登记应被受理：{body}"
    );
    assert_eq!(body["state"], "RECONCILING");
    let pubkey = device.public_key().to_hex();
    wait_for(
        http,
        n,
        &access,
        &pubkey,
        Some("ACTIVE"),
        e.converge_bound_secs,
    )
    .await;

    // 同一设备重复登记：幂等，不起第二条 Workflow
    let (status, body) = native(
        http,
        n,
        &access,
        reqwest::Method::POST,
        REGISTER,
        Some(proof(&device, &url, "POST", &session_id, Timestamp::now())),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK, "{body}");
    assert_eq!(body["state"], "ACTIVE");

    // 成员页按人聚合：同一个人名下既有 Web 的公钥也有这台设备的
    let (_, members) = native(
        http,
        n,
        &access,
        reqwest::Method::GET,
        &format!("/api/v1/workspaces/{}/members", fx.workspace),
        None,
    )
    .await;
    let me = members
        .as_array()
        .and_then(|m| {
            m.iter()
                .find(|r| r["principalId"] == fx.principal.to_string())
        })
        .expect("成员页应有本人");
    let keys = me["pubkeys"].as_array().expect("pubkeys");
    assert_eq!(keys.len(), 2, "本人应有 Web 与设备两把公钥：{me}");
    assert!(keys.iter().any(|k| k == &pubkey));

    // 设备以自己的私钥直连 Relay 发布：准入由 Relay 按 roster 判定。
    // 这里用 Server 托管标记构造客户端，是因为测试进程在扮演原生端自己签名。
    let (host, channel) = scope_of(pool, fx).await;
    let as_device = IdentityClient::new(
        Custody::Server,
        &device.secret_key().to_secret_hex(),
        &e.relay_origin,
        &host,
    )
    .expect("设备客户端");
    as_device
        .publish_channel_message(http, &channel, "from a native device", &[])
        .await
        .expect("登记后的设备应能直连 Relay 发布");

    // 在浏览器入口撤销这台设备（设备丢了，应当能在任一端撤掉）
    let (status, body) = browser(
        http,
        e,
        &fx.subject,
        reqwest::Method::DELETE,
        &format!("{REGISTER}/{pubkey}"),
        None,
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::ACCEPTED,
        "撤销应被受理：{body}"
    );
    assert_eq!(body["state"], "REVOKING");
    wait_for(http, n, &access, &pubkey, None, e.converge_bound_secs).await;

    let rejected = as_device
        .publish_channel_message(http, &channel, "after revocation", &[])
        .await;
    assert!(rejected.is_err(), "撤销后 Relay 必须拒绝这台设备");

    // 只撤了这一台：同一个人的 Web 身份照常发布
    let (status, body) = browser(
        http,
        e,
        &fx.subject,
        reqwest::Method::POST,
        &format!("/api/v1/workspaces/{}/messages", fx.workspace),
        Some(serde_json::json!({ "content": "web still works" })),
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::OK,
        "撤销设备不得影响 Web：{body}"
    );

    // 已撤销的公钥不复活
    let (status, body) = native(
        http,
        n,
        &access,
        reqwest::Method::POST,
        REGISTER,
        Some(proof(&device, &url, "POST", &session_id, Timestamp::now())),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::CONFLICT, "{body}");
    assert_eq!(body["reason"], "CLIENT_KEY_ALREADY_BOUND");
}

/// 轮询本人的设备列表，直到该公钥到达 `want`（`None` 表示已不在列表中）。
async fn wait_for(
    http: &reqwest::Client,
    n: &NativeEnv,
    token: &str,
    pubkey: &str,
    want: Option<&str>,
    bound_secs: u64,
) {
    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(bound_secs);
    loop {
        let (_, list) = native(http, n, token, reqwest::Method::GET, REGISTER, None).await;
        let state = list
            .as_array()
            .and_then(|l| l.iter().find(|k| k["pubkey"] == pubkey))
            .and_then(|k| k["state"].as_str())
            .map(str::to_owned);
        if state.as_deref() == want {
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "{bound_secs} 秒内未收敛到 {want:?}，当前 {state:?}"
        );
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    }
}

async fn scope_of(pool: &PgPool, fx: &common::LiveWorkspace) -> (String, String) {
    let host: String = sqlx::query_scalar(
        "select normalized_host from projection.tenant_buzz_binding where tenant_id = $1",
    )
    .bind(fx.tenant)
    .fetch_one(pool)
    .await
    .expect("Community host");
    let channel: uuid::Uuid = sqlx::query_scalar(
        "select channel_id from projection.workspace_buzz_binding where workspace_id = $1",
    )
    .bind(fx.workspace)
    .fetch_one(pool)
    .await
    .expect("Channel");
    (host, channel.to_string())
}
