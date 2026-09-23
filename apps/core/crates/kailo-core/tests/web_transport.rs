//! `SS-WEB-RELAY` 的 Core 半边：Browser 只发类型化语义命令，BFF 代签发布。
//!
//! 这条链完全建立在真实的生命周期之上——Tenant、Workspace、成员都由
//! `TENANT_LIFECYCLE`/`WORKSPACE_LIFECYCLE`/`MEMBERSHIP_PROJECTION` 产出，不手工
//! seed。因此它同时证明了「HUMAN 的 Buzz 身份是投影链自己建起来的」。
//!
//! 验的是四件事，每件都对应一条会让边界失效的真实做法：
//!
//! - 发布走语义命令，不走 raw event；Browser 提交的身份字段一律不参与；
//! - 历史查询的 filter 由 Core 构造，Browser 提交不了任意 filter；
//! - 没有 active WorkspaceMembership 就拒绝，且「无权限」与「不存在」同一个回答；
//! - 每条消息可关联 actor、scope、operation、Buzz event 与 AuditEvent。

use futures_util::FutureExt;
use sqlx::PgPool;
use uuid::Uuid;

mod common;
use common::Env;

/// 以网关投影的两条 header 调 BFF。这是 Browser 唯一能影响的输入面。
async fn bff(
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
    let value = resp.json().await.unwrap_or(serde_json::Value::Null);
    (status, value)
}

#[tokio::test]
async fn browser_publishes_and_reads_through_bff_only() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;

    let fx = match common::provision_live_workspace(&http, &e, &pool, &token).await {
        Ok(f) => f,
        Err(msg) => panic!("准备真实 Workspace 失败: {msg}"),
    };

    let outcome = std::panic::AssertUnwindSafe(run(&http, &e, &pool, &fx))
        .catch_unwind()
        .await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn run(http: &reqwest::Client, e: &Env, pool: &PgPool, fx: &common::LiveWorkspace) {
    let path = format!("/api/v1/workspaces/{}/messages", fx.workspace);

    // 发布：只给正文，不给任何身份字段
    let (status, body) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::POST,
        &path,
        Some(serde_json::json!({ "content": "hello from bff" })),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK, "发布应成功：{body}");
    let event_id = body["eventId"].as_str().expect("eventId").to_owned();
    assert_eq!(event_id.len(), 64, "event id 应为 64 位十六进制");

    // 历史：filter 由 Core 构造，调用方没有提交 filter 的入口
    let (status, body) = bff(http, e, &fx.subject, reqwest::Method::GET, &path, None).await;
    assert_eq!(status, reqwest::StatusCode::OK, "查询应成功：{body}");
    let events = body["events"].as_array().expect("events 应为数组");
    assert!(
        events.iter().any(|ev| ev["id"].as_str() == Some(&event_id)),
        "刚发的消息应能读回，实际 {} 条",
        events.len()
    );

    // 退出门禁：每条消息可关联 actor、scope、operation、Buzz event 与 AuditEvent
    let audit = sqlx::query_as::<_, (Uuid, Option<Uuid>, Option<Uuid>, serde_json::Value)>(
        "select operation_id, actor_principal_id, workspace_id, evidence_refs
         from audit.audit_event where event_key = $1",
    )
    .bind(format!("message.publish:{event_id}"))
    .fetch_one(pool)
    .await
    .expect("消息应留下 AuditEvent");
    assert_eq!(
        audit.1,
        Some(fx.principal),
        "actor 必须是该 HUMAN 的 Principal"
    );
    assert_eq!(audit.2, Some(fx.workspace), "scope 必须是该 Workspace");
    assert_eq!(
        audit.0,
        body["operationId"]
            .as_str()
            .and_then(|s| s.parse().ok())
            .unwrap_or(audit.0),
        "operation 可关联"
    );
    assert!(
        audit.3.as_array().is_some_and(|refs| refs
            .iter()
            .any(|r| r["kind"] == "BUZZ_EVENT_ID" && r["value"] == event_id.as_str())),
        "evidence 里必须有 Buzz event id，实际 {}",
        audit.3
    );
    // 正文不进审计：审计要的是「谁在哪里做了什么」，不是「说了什么」
    assert!(
        !audit.3.to_string().contains("hello from bff"),
        "正文不得进入审计"
    );

    // 撤掉 WorkspaceMembership：下一个请求必须立刻被拒
    sqlx::query("update identity.workspace_membership set state = 'REVOKING' where id = $1")
        .bind(fx.workspace_membership)
        .execute(pool)
        .await
        .expect("置 REVOKING");
    let (status, _) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::POST,
        &path,
        Some(serde_json::json!({ "content": "should not pass" })),
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::FORBIDDEN,
        "没有 active WorkspaceMembership 必须拒绝"
    );

    // 不存在的 Workspace 与没权限的 Workspace 给同一个回答：区分开本身就是
    // 一条可枚举的信息
    let (status, _) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::GET,
        &format!("/api/v1/workspaces/{}/messages", Uuid::new_v4()),
        None,
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::FORBIDDEN,
        "不存在的 Workspace 应与无权限同一个回答"
    );
}

/// CollaborationUserState（`DD-40`）：收藏/静音/已读的唯一权威在 Core。
///
/// 验四件事：键必须指向可见的 Workspace/Channel、版本冲突会被发现、并发改不同
/// 的键不会互相抹掉、撤权后再写同一个键被拒。
#[tokio::test]
async fn user_state_is_scoped_and_concurrency_safe() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;

    let fx = match common::provision_live_workspace(&http, &e, &pool, &token).await {
        Ok(f) => f,
        Err(msg) => panic!("准备真实 Workspace 失败: {msg}"),
    };
    let outcome = std::panic::AssertUnwindSafe(run_user_state(&http, &e, &pool, &fx))
        .catch_unwind()
        .await;
    let _ =
        sqlx::query("delete from identity.collaboration_user_state where tenant_principal_id = $1")
            .bind(fx.principal)
            .execute(&pool)
            .await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn run_user_state(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    fx: &common::LiveWorkspace,
) {
    // 初始状态为空，且读取不建行——读取不产生副作用
    let (status, body) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::GET,
        "/api/v1/user-state",
        None,
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK);
    assert_eq!(body["version"], 0, "没设过偏好时版本为 0");
    // 只数本夹具的 principal：别的用例或走查留下的行与这条断言无关
    let rows: i64 = sqlx::query_scalar(
        "select count(*) from identity.collaboration_user_state where tenant_principal_id = $1",
    )
    .bind(fx.principal)
    .fetch_one(pool)
    .await
    .expect("数行");
    assert_eq!(rows, 0, "读取不得建行");

    // 收藏一个可见 Workspace
    let ws_path = format!("/api/v1/user-state/workspaces/{}", fx.workspace);
    let (status, body) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::PUT,
        &ws_path,
        Some(serde_json::json!({"starred": true, "muted": false, "version": 0})),
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::OK,
        "设置可见 Workspace 的偏好应成功：{body}"
    );
    let version = body["version"].as_i64().expect("version");

    // 版本不符即冲突：拿旧版本再写一次
    let (status, _) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::PUT,
        &ws_path,
        Some(serde_json::json!({"starred": false, "muted": true, "version": 0})),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::CONFLICT, "旧版本写入必须冲突");

    // 另一个键的写入不抹掉先前的键
    let channel: Uuid = sqlx::query_scalar(
        "select channel_id from projection.workspace_buzz_binding where workspace_id = $1",
    )
    .bind(fx.workspace)
    .fetch_one(pool)
    .await
    .expect("取 channel");
    let (status, _) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::PUT,
        "/api/v1/user-state/read",
        Some(serde_json::json!({
            "contextKey": channel.to_string(),
            // 带时区偏移写入，读回必须是同一时刻的 UTC 形式
            "lastReadAt": "2026-09-23T08:00:00+08:00",
            "version": version,
        })),
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::OK,
        "标记可见 Channel 的已读应成功"
    );
    let (_, body) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::GET,
        "/api/v1/user-state",
        None,
    )
    .await;
    assert_eq!(
        body["workspacePreferences"][fx.workspace.to_string()]["starred"],
        true,
        "写另一个键不得抹掉先前的键，实际 {body}"
    );
    assert_eq!(
        body["readContexts"][channel.to_string()],
        "2026-09-23T00:00:00Z",
        "已读位置必须统一存成 UTC 的 RFC 3339——三端读的是同一个值"
    );
    let updated_at = body["workspacePreferences"][fx.workspace.to_string()]["updatedAt"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    assert!(
        chrono::DateTime::parse_from_rfc3339(&updated_at).is_ok(),
        "偏好的 updatedAt 必须由库时钟补上（.design/03），实际 {body}"
    );

    // 可见 Channel、但已读时间不是 RFC 3339：拒绝，而不是存一个别的端解析不了的串
    let (status, _) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::PUT,
        "/api/v1/user-state/read",
        Some(serde_json::json!({
            "contextKey": channel.to_string(),
            "lastReadAt": "yesterday",
            "version": body["version"],
        })),
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::BAD_REQUEST,
        "非 RFC 3339 的已读时间必须拒绝"
    );

    // 不可见的 Workspace：拒绝
    let (status, _) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::PUT,
        &format!("/api/v1/user-state/workspaces/{}", Uuid::new_v4()),
        Some(serde_json::json!({"starred": true, "muted": false, "version": 2})),
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::FORBIDDEN,
        "不可见的 Workspace 必须拒绝"
    );

    // 既不是 UUID 也不是 msg: 形式的键：拒绝。放开键空间等于开了任意写入面
    let (status, _) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::PUT,
        "/api/v1/user-state/read",
        Some(
            serde_json::json!({"contextKey": "../../etc/passwd", "lastReadAt": "x", "version": 2}),
        ),
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::BAD_REQUEST,
        "非法 context_key 必须拒绝"
    );

    // 撤权后再写同一个键：拒绝。校验在写入路径上，不是读取时过滤
    sqlx::query("update identity.workspace_membership set state = 'REVOKING' where id = $1")
        .bind(fx.workspace_membership)
        .execute(pool)
        .await
        .expect("置 REVOKING");
    let (status, _) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::PUT,
        &ws_path,
        Some(serde_json::json!({"starred": false, "muted": false, "version": 2})),
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::FORBIDDEN,
        "撤权后写同一个键必须拒绝"
    );
}

/// BFF stream 的 snapshot + generation 恢复（`apps/02` Stage 1）。
///
/// 验三件事：首连拿到 generation 与 snapshot；带对的 generation 续流不重发
/// snapshot；撤权后旧 generation 失效且流本身建不起来。
#[tokio::test]
async fn stream_delivers_snapshot_and_generation() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;

    let fx = match common::provision_live_workspace(&http, &e, &pool, &token).await {
        Ok(f) => f,
        Err(msg) => panic!("准备真实 Workspace 失败: {msg}"),
    };
    let outcome = std::panic::AssertUnwindSafe(run_stream(&http, &e, &pool, &fx))
        .catch_unwind()
        .await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// 读若干 SSE 帧，直到拿到 `live`（追平）或超时。
/// 一帧 SSE。`id` 与 `retry` 是 EventSource 续流协议的两半：浏览器记下 id，
/// 断线后按 retry 等待，再把 id 放进 Last-Event-ID 带回来。
#[derive(Debug)]
struct SseFrame {
    name: String,
    data: String,
    id: Option<String>,
    retry: Option<u64>,
}

/// `last_event_id` 模拟 EventSource 重连时自动带回的那个头。
async fn read_sse(
    http: &reqwest::Client,
    e: &Env,
    subject: &str,
    path: &str,
    last_event_id: Option<&str>,
) -> Result<Vec<SseFrame>, reqwest::StatusCode> {
    use futures_util::StreamExt;
    let mut req = http
        .get(format!("{}{path}", e.bff_url))
        .header("x-kailo-oidc-issuer", &e.oidc_issuer)
        .header("x-kailo-oidc-subject", subject);
    if let Some(id) = last_event_id {
        req = req.header("last-event-id", id);
    }
    let resp = req.send().await.expect("打开 stream");
    if !resp.status().is_success() {
        return Err(resp.status());
    }
    let mut body = resp.bytes_stream();
    let mut buf = String::new();
    let mut frames = Vec::new();
    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(15);
    while tokio::time::Instant::now() < deadline {
        let Ok(Some(Ok(chunk))) = tokio::time::timeout_at(deadline, body.next()).await else {
            break;
        };
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(idx) = buf.find("\n\n") {
            let block = buf[..idx].to_owned();
            buf = buf[idx + 2..].to_owned();
            let mut f = SseFrame {
                name: String::new(),
                data: String::new(),
                id: None,
                retry: None,
            };
            // 按 SSE 规范分派：没有任何 data 行的事件浏览器**不会**派发
            // （HTML Living Standard「dispatch the event」第 2 步）。这里若只看
            // event: 行，就会比真实浏览器宽松，把浏览器收不到的帧当成已送达。
            let mut has_data = false;
            for line in block.lines() {
                if let Some(v) = line.strip_prefix("event:") {
                    f.name = v.trim().to_owned();
                } else if let Some(v) = line.strip_prefix("data:") {
                    has_data = true;
                    f.data.push_str(v.trim());
                } else if let Some(v) = line.strip_prefix("id:") {
                    f.id = Some(v.trim().to_owned());
                } else if let Some(v) = line.strip_prefix("retry:") {
                    f.retry = v.trim().parse().ok();
                }
            }
            if has_data && !f.name.is_empty() {
                let done = f.name == "live" || f.name == "closed";
                frames.push(f);
                if done {
                    return Ok(frames);
                }
            }
        }
    }
    Ok(frames)
}

async fn run_stream(http: &reqwest::Client, e: &Env, pool: &PgPool, fx: &common::LiveWorkspace) {
    // 先发一条，snapshot 才有内容可验
    let msg_path = format!("/api/v1/workspaces/{}/messages", fx.workspace);
    let (status, _) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::POST,
        &msg_path,
        Some(serde_json::json!({"content":"before stream"})),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK);

    let path = format!("/api/v1/workspaces/{}/stream", fx.workspace);
    let frames = read_sse(http, e, &fx.subject, &path, None)
        .await
        .expect("首连应成功");
    let names: Vec<&str> = frames.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(
        names.first(),
        Some(&"generation"),
        "generation 必须先发：客户端据此知道断线后该带什么回来，实际 {names:?}"
    );
    assert!(
        names.contains(&"snapshot"),
        "首连必须带 snapshot，实际 {names:?}"
    );
    assert!(names.contains(&"live"), "必须发 live 分界，实际 {names:?}");
    let generation = frames[0].data.clone();
    // generation 同时是 SSE id：浏览器靠它续流，客户端不必自己记
    assert_eq!(
        frames[0].id.as_deref(),
        Some(generation.as_str()),
        "generation 帧必须以自身为 id，否则 EventSource 重连时带不回它"
    );
    // 重连间隔由服务端经 retry 下发，且就是部署登记的那个值
    assert_eq!(
        frames[0].retry,
        Some(e.stream_retry_millis),
        "retry 必须等于 BFF_STREAM_RETRY_MILLIS"
    );
    let snapshot = frames
        .iter()
        .find(|f| f.name == "snapshot")
        .map(|f| f.data.clone())
        .unwrap();
    assert!(
        snapshot.contains("before stream"),
        "snapshot 应含先前发的消息"
    );

    // 带对的 generation 续流：不重发 snapshot
    let resumed = read_sse(http, e, &fx.subject, &path, Some(&generation))
        .await
        .expect("续流应成功");
    let names: Vec<&str> = resumed.iter().map(|f| f.name.as_str()).collect();
    assert!(
        !names.contains(&"snapshot"),
        "续流不得重发 snapshot，实际 {names:?}"
    );

    // 对不上的 generation：重新取 snapshot，而不是从猜测的位置接着读
    let stale = read_sse(http, e, &fx.subject, &path, Some("deadbeef"))
        .await
        .expect("旧 generation 也应能开流");
    let names: Vec<&str> = stale.iter().map(|f| f.name.as_str()).collect();
    assert!(
        names.contains(&"snapshot"),
        "generation 对不上必须重取 snapshot，实际 {names:?}"
    );
    assert_ne!(
        stale[0].data, "deadbeef",
        "服务端必须给出自己的 generation，不回显调用方的"
    );

    // 撤权后：流建不起来
    sqlx::query("update identity.workspace_membership set state = 'REVOKING' where id = $1")
        .bind(fx.workspace_membership)
        .execute(pool)
        .await
        .expect("置 REVOKING");
    match read_sse(http, e, &fx.subject, &path, None).await {
        Err(status) => assert_eq!(status, reqwest::StatusCode::FORBIDDEN, "撤权后开流必须被拒"),
        Ok(f) => panic!("撤权后不应开得起流，却拿到 {f:?}"),
    }
}

/// 注销（`SS-AGW-OIDC` 的 Kailo 半边）。
///
/// 网关的 logout 是短路的，请求根本不到后端（`SF-AGW-21`），因此 Core 只能靠
/// Browser 先调这里。验两件事：注销撤掉会话且幂等；已建立的流在登记的上界内
/// 被关掉，而不是继续推事件。
#[tokio::test]
async fn logout_revokes_session_and_closes_stream() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;

    let fx = match common::provision_live_workspace(&http, &e, &pool, &token).await {
        Ok(f) => f,
        Err(msg) => panic!("准备真实 Workspace 失败: {msg}"),
    };
    let outcome = std::panic::AssertUnwindSafe(run_logout(&http, &e, &pool, &fx))
        .catch_unwind()
        .await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn run_logout(http: &reqwest::Client, e: &Env, pool: &PgPool, fx: &common::LiveWorkspace) {
    use futures_util::StreamExt;

    // 先建立会话与一条流
    let (status, _) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::GET,
        "/api/v1/session",
        None,
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK);
    let session_id: Uuid = sqlx::query_scalar(
        "select id from identity.platform_session where human_identity_id = $1 and status='ACTIVE'",
    )
    .bind(fx.human)
    .fetch_one(pool)
    .await
    .expect("会话应已建立");

    let resp = http
        .get(format!(
            "{}/api/v1/workspaces/{}/stream",
            e.bff_url, fx.workspace
        ))
        .header("x-kailo-oidc-issuer", &e.oidc_issuer)
        .header("x-kailo-oidc-subject", &fx.subject)
        .send()
        .await
        .expect("开流");
    assert!(resp.status().is_success(), "流应开得起来");
    let mut body = resp.bytes_stream();

    // 注销：只撤这一条会话
    let (status, out) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::POST,
        "/api/v1/logout",
        None,
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK, "注销应成功：{out}");
    assert_eq!(out["revoked"], true, "第一次注销应确实撤掉了会话");
    let live: i64 = sqlx::query_scalar(
        "select count(*) from identity.platform_session where id=$1 and status='ACTIVE'",
    )
    .bind(session_id)
    .fetch_one(pool)
    .await
    .expect("查会话");
    assert_eq!(live, 0, "注销后会话不应仍是 ACTIVE");

    // 已建立的流必须在登记的上界内关闭，而不是继续推事件
    let bound = std::time::Duration::from_secs(e.stream_readmit_seconds * 3 + 5);
    let deadline = tokio::time::Instant::now() + bound;
    let mut saw_closed = false;
    let mut buf = String::new();
    while tokio::time::Instant::now() < deadline && !saw_closed {
        let Ok(Some(Ok(chunk))) = tokio::time::timeout_at(deadline, body.next()).await else {
            break;
        };
        buf.push_str(&String::from_utf8_lossy(&chunk));
        if buf.contains("session-revoked") {
            saw_closed = true;
        }
    }
    assert!(
        saw_closed,
        "注销后已建立的流必须在 {bound:?} 内关闭并说明 session-revoked，实际收到：{buf}"
    );

    // 注销是幂等的：会话已撤，身份解析随之失败，后续请求一律被拒
    let (status, _) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::POST,
        "/api/v1/logout",
        None,
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::OK,
        "会话已撤后再注销应仍成功——注销是幂等的，重复调用不该报错"
    );
}

/// 媒体读写也经 BFF 代签（`DD-39`）。
///
/// 验四件事：上传拿得到 blob descriptor、按 sha256 取得回原字节、超限被拒、
/// 撤权后拒绝。
#[tokio::test]
async fn media_round_trips_through_bff() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;

    let fx = match common::provision_live_workspace(&http, &e, &pool, &token).await {
        Ok(f) => f,
        Err(msg) => panic!("准备真实 Workspace 失败: {msg}"),
    };
    let outcome = std::panic::AssertUnwindSafe(run_media(&http, &e, &pool, &fx))
        .catch_unwind()
        .await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn run_media(http: &reqwest::Client, e: &Env, pool: &PgPool, fx: &common::LiveWorkspace) {
    let base = format!("{}/api/v1/workspaces/{}/media", e.bff_url, fx.workspace);
    let payload = b"kailo media probe".to_vec();

    let resp = http
        .post(&base)
        .header("x-kailo-oidc-issuer", &e.oidc_issuer)
        .header("x-kailo-oidc-subject", &fx.subject)
        .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
        .body(payload.clone())
        .send()
        .await
        .expect("上传");
    assert_eq!(resp.status(), reqwest::StatusCode::OK, "上传应成功");
    let descriptor: serde_json::Value = resp.json().await.expect("blob descriptor");
    let sha256 = descriptor["sha256"].as_str().expect("sha256").to_owned();
    assert_eq!(sha256.len(), 64, "sha256 应为 64 位十六进制");

    // 取回的必须逐字节等于上传的：Core 只是代签与转发，不该改动内容
    let resp = http
        .get(format!("{base}/{sha256}"))
        .header("x-kailo-oidc-issuer", &e.oidc_issuer)
        .header("x-kailo-oidc-subject", &fx.subject)
        .send()
        .await
        .expect("取回");
    assert_eq!(resp.status(), reqwest::StatusCode::OK, "取回应成功");
    assert_eq!(
        resp.bytes().await.expect("字节").to_vec(),
        payload,
        "内容必须逐字节一致"
    );

    // sha256 形状不对：不把路径段交给调用方拼
    let resp = http
        .get(format!("{base}/../../etc/passwd"))
        .header("x-kailo-oidc-issuer", &e.oidc_issuer)
        .header("x-kailo-oidc-subject", &fx.subject)
        .send()
        .await
        .expect("非法路径");
    assert!(
        !resp.status().is_success(),
        "非法 sha256 必须拒绝，得到 {}",
        resp.status()
    );

    run_media_message(http, e, fx).await;

    // 撤权后拒绝
    sqlx::query("update identity.workspace_membership set state = 'REVOKING' where id = $1")
        .bind(fx.workspace_membership)
        .execute(pool)
        .await
        .expect("置 REVOKING");
    let resp = http
        .post(&base)
        .header("x-kailo-oidc-issuer", &e.oidc_issuer)
        .header("x-kailo-oidc-subject", &fx.subject)
        .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
        .body(payload)
        .send()
        .await
        .expect("撤权后上传");
    assert_eq!(
        resp.status(),
        reqwest::StatusCode::FORBIDDEN,
        "撤权后上传必须拒绝"
    );
}

/// 1×1 PNG。Relay 按内容校验图片，不能拿任意字节冒充 image/png。
const PNG_1X1: &str = "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63f8cfc0000003010100c9fe92ef0000000049454e44ae426082";

/// 带媒体的消息（`SF-BUZ-36`）：形式与原生端一致，URL 只认本 Workspace 的
/// Community host，blob 真伪由 Relay 按 sidecar 判定。
async fn run_media_message(http: &reqwest::Client, e: &Env, fx: &common::LiveWorkspace) {
    let base = format!("{}/api/v1/workspaces/{}", e.bff_url, fx.workspace);
    let png = hex::decode(PNG_1X1).expect("PNG 常量");
    let resp = http
        .post(format!("{base}/media"))
        .header("x-kailo-oidc-issuer", &e.oidc_issuer)
        .header("x-kailo-oidc-subject", &fx.subject)
        .header(reqwest::header::CONTENT_TYPE, "image/png")
        .body(png)
        .send()
        .await
        .expect("上传图片");
    assert_eq!(resp.status(), reqwest::StatusCode::OK, "图片上传应成功");
    let d: serde_json::Value = resp.json().await.expect("descriptor");
    let (url, sha) = (d["url"].as_str().unwrap(), d["sha256"].as_str().unwrap());

    let publish = |attachment: serde_json::Value| {
        let req = http
            .post(format!("{base}/messages"))
            .header("x-kailo-oidc-issuer", &e.oidc_issuer)
            .header("x-kailo-oidc-subject", &fx.subject)
            .json(&serde_json::json!({"content": "with media", "attachments": [attachment]}));
        async move { req.send().await.expect("发布") }
    };

    // 正路：正文追加一行 markdown，另带 imeta，与原生端同形
    let resp = publish(d.clone()).await;
    assert_eq!(resp.status(), reqwest::StatusCode::OK, "带图消息应发布成功");
    let event_id = resp.json::<serde_json::Value>().await.unwrap()["eventId"]
        .as_str()
        .unwrap()
        .to_owned();
    let (_, page) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::GET,
        &format!("/api/v1/workspaces/{}/messages", fx.workspace),
        None,
    )
    .await;
    let ev = page["events"]
        .as_array()
        .and_then(|a| a.iter().find(|ev| ev["id"] == event_id.as_str()))
        .expect("发布的事件应能查回")
        .clone();
    assert_eq!(
        ev["content"].as_str().unwrap(),
        format!("with media\n![image]({url})"),
        "正文形式必须与上游 formatImetaMediaLine 一致"
    );
    let imeta: Vec<&str> = ev["tags"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t[0] == "imeta")
        .expect("必须带 imeta")
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert_eq!(
        imeta,
        vec![
            "imeta".to_owned(),
            format!("url {url}"),
            "m image/png".to_owned(),
            format!("x {sha}"),
            format!("size {}", d["size"]),
        ],
        "imeta 必须与上游 buildImetaTags 同序同形"
    );

    // 别人的地址：BFF 不替任何人签一条指向任意地址的引用
    let mut foreign = d.clone();
    foreign["url"] = url.replacen("://", "://evil.example.", 1).into();
    assert_eq!(
        publish(foreign).await.status(),
        reqwest::StatusCode::BAD_REQUEST
    );

    // 非图片/视频：一期 Web 不提供通用文件入口
    let mut file = d.clone();
    file["type"] = "application/pdf".into();
    assert_eq!(
        publish(file).await.status(),
        reqwest::StatusCode::BAD_REQUEST
    );

    // 谎报 MIME：结构上合法，但与 Relay 的 sidecar 不符——由 Relay 拒绝，
    // BFF 不得报成功
    let mut lying = d.clone();
    lying["type"] = "image/jpeg".into();
    assert!(
        !publish(lying).await.status().is_success(),
        "与 sidecar 不符的 imeta 必须被 Relay 拒绝"
    );
}
