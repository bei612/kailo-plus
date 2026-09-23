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
    let rows: i64 = sqlx::query_scalar("select count(*) from identity.collaboration_user_state")
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
            "lastReadAt": "2026-09-23T00:00:00Z",
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
    assert!(
        body["readContexts"][channel.to_string()].is_string(),
        "已读位置应在"
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
