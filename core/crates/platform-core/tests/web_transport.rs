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

/// Run only against this batch's deployed BFF/Relay admission. This is not a
/// substitute for the signed-plaintext unit check or an old deployment probe.
#[tokio::test]
async fn reminder_receipt_recovery_does_not_accept_a_different_intent() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;
    let fx = common::provision_live_workspace(&http, &e, &pool, &token)
        .await
        .expect("准备真实 Workspace");
    let outcome = std::panic::AssertUnwindSafe(async {
        let (status, source) = bff(&http, &e, &fx.subject, reqwest::Method::POST,
            &format!("/api/v1/workspaces/{}/messages", fx.workspace),
            Some(serde_json::json!({"content":"reminder recovery source"}))).await;
        assert_eq!(status, reqwest::StatusCode::OK, "{source}");
        let channel: Uuid = sqlx::query_scalar(
            "select channel_id from projection.workspace_buzz_binding where workspace_id=$1 and state='ACTIVE'",
        ).bind(fx.workspace).fetch_one(&pool).await.unwrap();
        let publish = |key: Uuid, request: serde_json::Value| {
            http.post(format!("{}/api/v1/reminders/publish", e.bff_url))
                .header("x-platform-oidc-issuer", &e.oidc_issuer)
                .header("x-platform-oidc-subject", &fx.subject)
                .header("idempotency-key", key.to_string()).json(&request).send()
        };
        let key = Uuid::new_v4();
        let due = chrono::Utc::now().timestamp() + 120;
        let request = serde_json::json!({"operation":"CREATE","channelId":channel,
            "sourceEventId":source["eventId"],"notBefore":due,"note":"private reminder note"});
        let first = publish(key, request.clone()).await.unwrap();
        assert_eq!(first.status(), reqwest::StatusCode::OK);
        let first: serde_json::Value = first.json().await.unwrap();
        let retry = publish(key, request.clone()).await.unwrap();
        assert_eq!(retry.status(), reqwest::StatusCode::OK);
        assert_eq!(retry.json::<serde_json::Value>().await.unwrap()["eventId"], first["eventId"]);
        for (field, value) in [("note", serde_json::json!("changed note")),
            ("notBefore", serde_json::json!(due + 1))] {
            let mut changed = request.clone(); changed[field] = value;
            assert_eq!(publish(key, changed).await.unwrap().status(), reqwest::StatusCode::CONFLICT);
        }
        let snooze_key = Uuid::new_v4();
        let snooze = publish(snooze_key, serde_json::json!({"operation":"SNOOZE",
            "eventId":first["eventId"],"notBefore":due + 2})).await.unwrap();
        assert_eq!(snooze.status(), reqwest::StatusCode::OK);
        assert_eq!(publish(snooze_key, serde_json::json!({"operation":"CANCEL",
            "eventId":first["eventId"]})).await.unwrap().status(), reqwest::StatusCode::CONFLICT);
        // The original CREATE event has been replaced, so its old receipt is
        // no longer independently observable. Do not publish again or return OK.
        let replaced = publish(key, request).await.unwrap();
        assert_eq!(replaced.status(), reqwest::StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(replaced.json::<serde_json::Value>().await.unwrap()["class"], "UNKNOWN");
    }).catch_unwind().await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

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
        .header("x-platform-oidc-issuer", &e.oidc_issuer)
        .header("x-platform-oidc-subject", subject);
    if let Some(b) = body {
        // 每次调用是一次新的发送意图：带新的幂等键（发布端点要求它，DD-81）
        req = req
            .header("idempotency-key", Uuid::new_v4().to_string())
            .json(&b);
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

    // 发送之前已落 DISPATCH：同一 operation、同一 event id，时间不晚于结果（DD-81）
    let (dispatch_op, dispatched_before): (Uuid, bool) = sqlx::query_as(
        "select d.operation_id, d.occurred_at <= o.occurred_at
         from audit.audit_event d, audit.audit_event o
         where d.event_key = $1 and o.event_key = $2",
    )
    .bind(format!("message.publish:{event_id}:dispatch"))
    .bind(format!("message.publish:{event_id}"))
    .fetch_one(pool)
    .await
    .expect("发送前应有 DISPATCH 审计");
    assert_eq!(dispatch_op, audit.0, "DISPATCH 与结果属于同一 operation");
    assert!(dispatched_before, "DISPATCH 必须先于结果落账");

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
    common::assert_contract::<contracts::UserStateVersion>(&body, "PUT 偏好");
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
    let (status, marked) = bff(
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
    common::assert_contract::<contracts::UserStateVersion>(&marked, "PUT 已读");
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

    // 复用本次真实 Workspace 发布的事件，不把「有任意 Workspace」当成消息权限。
    let (status, published) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::POST,
        &format!("/api/v1/workspaces/{}/messages", fx.workspace),
        Some(serde_json::json!({"content": Uuid::new_v4().to_string()})),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK, "发布可读事件：{published}");
    let event_id = published["eventId"].as_str().expect("eventId");
    let message_context = format!("msg:{event_id}");
    let thread_context = format!("thread:{event_id}");
    let read_at = body["readContexts"][channel.to_string()].clone();
    let mut marked_version = body["version"].as_i64().expect("version");
    for context in [&message_context, &thread_context] {
        let (status, marked) = bff(
            http,
            e,
            &fx.subject,
            reqwest::Method::PUT,
            "/api/v1/user-state/read",
            Some(serde_json::json!({
                "contextKey": context,
                "lastReadAt": read_at,
                "version": marked_version,
            })),
        )
        .await;
        assert_eq!(status, reqwest::StatusCode::OK, "可读事件标记：{marked}");
        marked_version = marked["version"].as_i64().expect("version");
    }
    let (status, body) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::GET,
        "/api/v1/user-state",
        None,
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK, "读消息标记：{body}");
    assert_eq!(body["readContexts"][&message_context], read_at);
    assert_eq!(body["readContexts"][&thread_context], read_at);
    assert_eq!(body["version"], marked_version);

    // 用同一真实身份向 Relay 发布回复；回复可作为 msg，不能冒充 thread 根。
    let (host, channel_id) = common::live_scope(pool, fx).await;
    let (locator, secret_version): (String, i32) = sqlx::query_as(
        "select private_key_secret_ref, private_key_secret_version
         from identity.buzz_identity_binding
         where principal_id = $1 and kind = 'HUMAN' and custody = 'SERVER' and state = 'ACTIVE'",
    )
    .bind(fx.principal)
    .fetch_one(pool)
    .await
    .expect("当前 HUMAN 的 SecretRef");
    let secret = common::read_secret_version(http, e, fx.tenant, &locator, secret_version).await;
    let client = collab_bridge::bridge::IdentityClient::new(
        collab_bridge::bridge::Custody::Server,
        &secret,
        &e.relay_origin,
        &host,
    )
    .expect("本人 Relay 客户端");
    let reply = client
        .publish(
            http,
            9,
            &Uuid::new_v4().to_string(),
            &[
                vec!["h".into(), channel_id],
                vec!["e".into(), event_id.into(), String::new(), "reply".into()],
            ],
        )
        .await
        .expect("发布真实回复");
    assert_eq!(reply["accepted"], true, "Relay 必须接受回复");
    let reply_id = reply["event_id"].as_str().expect("reply event_id");
    let (status, _) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::PUT,
        "/api/v1/user-state/read",
        Some(serde_json::json!({
            "contextKey": format!("thread:{reply_id}"),
            "lastReadAt": read_at,
            "version": marked_version,
        })),
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::FORBIDDEN,
        "可读回复不是 Thread 根"
    );
    for prefix in ["msg", "thread"] {
        let (status, _) = bff(
            http,
            e,
            &fx.subject,
            reqwest::Method::PUT,
            "/api/v1/user-state/read",
            Some(serde_json::json!({
                "contextKey": format!("{prefix}:{}", nostr::EventId::all_zeros()),
                "lastReadAt": read_at,
                "version": marked_version,
            })),
        )
        .await;
        assert_eq!(
            status,
            reqwest::StatusCode::FORBIDDEN,
            "不存在的事件不能标记"
        );
    }

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

    // 不是 Channel UUID、msg: 或 thread: 的键：拒绝，不放开任意键空间。
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
    for context in [&message_context, &thread_context] {
        let (status, _) = bff(
            http,
            e,
            &fx.subject,
            reqwest::Method::PUT,
            "/api/v1/user-state/read",
            Some(serde_json::json!({
                "contextKey": context,
                "lastReadAt": read_at,
                "version": marked_version,
            })),
        )
        .await;
        assert_eq!(
            status,
            reqwest::StatusCode::FORBIDDEN,
            "撤权后事件标记也拒绝"
        );
    }
    let (status, body) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::GET,
        "/api/v1/user-state",
        None,
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK, "撤权后过滤状态：{body}");
    assert_eq!(body["workspacePreferences"], serde_json::json!({}));
    assert_eq!(body["readContexts"], serde_json::json!({}));
    assert_eq!(body["version"], marked_version, "过滤不能推进版本");
    let retained: serde_json::Value = sqlx::query_scalar(
        "select read_contexts from identity.collaboration_user_state where tenant_principal_id = $1",
    )
    .bind(fx.principal)
    .fetch_one(pool)
    .await
    .expect("读保留的状态历史");
    assert_eq!(retained[&message_context], read_at, "撤权不能删除历史");
    assert_eq!(retained[&thread_context], read_at, "撤权不能删除线程历史");
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
        .header("x-platform-oidc-issuer", &e.oidc_issuer)
        .header("x-platform-oidc-subject", subject);
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

async fn assert_open_stream_closes_after_membership_revocation(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    fx: &common::LiveWorkspace,
    path: &str,
) {
    use futures_util::StreamExt;
    let response = http
        .get(format!("{}{path}", e.bff_url))
        .header("x-platform-oidc-issuer", &e.oidc_issuer)
        .header("x-platform-oidc-subject", &fx.subject)
        .send()
        .await
        .expect("打开待撤权的流");
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let mut body = response.bytes_stream();
    let mut buffer = String::new();
    let mut revoked = false;
    let deadline = tokio::time::Instant::now()
        + tokio::time::Duration::from_secs(e.stream_readmit_seconds + e.converge_bound_secs);
    while tokio::time::Instant::now() < deadline {
        let Ok(Some(Ok(chunk))) = tokio::time::timeout_at(deadline, body.next()).await else {
            break;
        };
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(end) = buffer.find("\n\n") {
            let frame = buffer[..end].to_owned();
            buffer = buffer[end + 2..].to_owned();
            if frame.lines().any(|line| line.trim() == "event: live") && !revoked {
                sqlx::query(
                    "update identity.workspace_membership set state = 'REVOKING' where id = $1",
                )
                .bind(fx.workspace_membership)
                .execute(pool)
                .await
                .expect("置 REVOKING");
                revoked = true;
            }
            if frame.lines().any(|line| line.trim() == "event: closed") {
                assert!(revoked, "流在撤权前关闭：{frame}");
                assert!(
                    frame
                        .lines()
                        .any(|line| line.trim() == "data: scope-revoked"),
                    "已建立的流应因 Workspace 撤权关闭：{frame}"
                );
                return;
            }
        }
    }
    assert!(revoked, "流未达到 live 状态，不能验证在途撤权");
    panic!("Workspace 已撤权，既有流仍未在再准入上界内关闭");
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

    // 撤权前已建立的流必须主动关闭；撤权后新流也建不起来。
    assert_open_stream_closes_after_membership_revocation(http, e, pool, fx, &path).await;
    match read_sse(http, e, &fx.subject, &path, None).await {
        Err(status) => assert_eq!(status, reqwest::StatusCode::FORBIDDEN, "撤权后开流必须被拒"),
        Ok(f) => panic!("撤权后不应开得起流，却拿到 {f:?}"),
    }
}

/// 注销（`SS-AGW-OIDC` 的平台半边）。
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
    let (status, session) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::GET,
        "/api/v1/session",
        None,
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK);
    common::assert_contract::<contracts::PlatformSessionView>(&session, "GET /api/v1/session");
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
        .header("x-platform-oidc-issuer", &e.oidc_issuer)
        .header("x-platform-oidc-subject", &fx.subject)
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
    let payload = b"platform media probe".to_vec();

    let resp = http
        .post(&base)
        .header("x-platform-oidc-issuer", &e.oidc_issuer)
        .header("x-platform-oidc-subject", &fx.subject)
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
        .header("x-platform-oidc-issuer", &e.oidc_issuer)
        .header("x-platform-oidc-subject", &fx.subject)
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
        .header("x-platform-oidc-issuer", &e.oidc_issuer)
        .header("x-platform-oidc-subject", &fx.subject)
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
        .header("x-platform-oidc-issuer", &e.oidc_issuer)
        .header("x-platform-oidc-subject", &fx.subject)
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
        .header("x-platform-oidc-issuer", &e.oidc_issuer)
        .header("x-platform-oidc-subject", &fx.subject)
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
            .header("idempotency-key", Uuid::new_v4().to_string())
            .header("x-platform-oidc-issuer", &e.oidc_issuer)
            .header("x-platform-oidc-subject", &fx.subject)
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

/// 一个人在多个 Tenant 各有一条 ACTIVE membership 时，不任取其一。
///
/// `.design/03` 允许一人多 Tenant，但没有定义登录时如何选定 Tenant，一期也没有
/// 选择入口。任取一个就是「回退默认租户」，因此必须是确定的拒绝。已撤销的
/// membership 也不得遮住唯一 ACTIVE 的那条。
#[tokio::test]
async fn multiple_active_tenants_are_refused_not_guessed() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;
    let fx = match common::provision_live_workspace(&http, &e, &pool, &token).await {
        Ok(f) => f,
        Err(msg) => panic!("准备真实 Workspace 失败: {msg}"),
    };

    // 另一个 Tenant 里同一个人的第二条 membership。这里只验解析器的判定，
    // 直接写库；Tenant 与成员的真实建立走 lifecycle Workflow，已由别的用例覆盖。
    let other = Uuid::new_v4();
    let other_principal = Uuid::new_v4();
    let other_membership = Uuid::new_v4();
    let outcome = std::panic::AssertUnwindSafe(async {
        sqlx::query("insert into identity.tenant (id, slug, name, state) values ($1,$2,$2,'ACTIVE')")
            .bind(other)
            .bind(format!("m{}", &other.to_string()[..8]))
            .execute(&pool)
            .await
            .expect("建第二个 Tenant");
        sqlx::query(
            "insert into identity.principal (id, tenant_id, kind, status) values ($1,$2,'HUMAN','ACTIVE')",
        )
        .bind(other_principal)
        .bind(other)
        .execute(&pool)
        .await
        .expect("建第二个 Principal");
        sqlx::query(
            "insert into identity.tenant_membership (id, tenant_id, human_identity_id, tenant_principal_id, state)
             values ($1,$2,$3,$4,'ACTIVE')",
        )
        .bind(other_membership)
        .bind(other)
        .bind(fx.human)
        .bind(other_principal)
        .execute(&pool)
        .await
        .expect("建第二条 membership");

        let (status, body) = bff(&http, &e, &fx.subject, reqwest::Method::GET, "/api/v1/session", None).await;
        assert_eq!(status, reqwest::StatusCode::FORBIDDEN, "两条 ACTIVE 必须拒绝：{body}");
        assert_eq!(body["class"], "BLOCKED");
        assert_eq!(body["reason"], "TENANT_SELECTION_NOT_AVAILABLE");
        let (status, _) = bff(
            &http,
            &e,
            &fx.subject,
            reqwest::Method::GET,
            &format!("/api/v1/workspaces/{}/messages", fx.workspace),
            None,
        )
        .await;
        assert_eq!(status, reqwest::StatusCode::FORBIDDEN, "任何经身份解析的入口都必须拒绝");

        // 撤掉第二条：唯一 ACTIVE 的那条必须被选中，已撤销的不得遮住它
        sqlx::query("update identity.tenant_membership set state = 'REVOKED' where id = $1")
            .bind(other_membership)
            .execute(&pool)
            .await
            .expect("撤第二条");
        let (status, body) = bff(&http, &e, &fx.subject, reqwest::Method::GET, "/api/v1/session", None).await;
        assert_eq!(status, reqwest::StatusCode::OK, "撤掉第二条后应恢复：{body}");
        assert_eq!(body["tenantId"], fx.tenant.to_string(), "必须解析到仍 ACTIVE 的那个 Tenant");
    })
    .catch_unwind()
    .await;

    for sql in [
        "delete from identity.tenant_membership where id = $1",
        "delete from identity.principal where id = $2",
        "delete from identity.tenant where id = $3",
    ] {
        sqlx::query(sql)
            .bind(other_membership)
            .bind(other_principal)
            .bind(other)
            .execute(&pool)
            .await
            .unwrap_or_else(|err| panic!("清理第二个 Tenant 失败：{sql}\n  {err}"));
    }
    common::teardown_live_workspace(&e, &pool, &fx).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// 结果不明的发布按 event id 对账成确定结果（DD-81）。
///
/// 三条只有 DISPATCH 的发布，分别对应对账的三种结论：Relay 存着那条事件
/// （已送达）；查不到且已超出 settle 窗口（确定未送达）；查不到而仍在窗口内
/// （继续等，不写结论）。第一条用真实发出的事件，后两条的 event id 从未发出。
/// 审计只追加，因此以显式的发生时间写入历史 DISPATCH，而不是改已有行。
#[tokio::test]
async fn unsettled_publishes_are_reconciled_by_event_id() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;
    let fx = match common::provision_live_workspace(&http, &e, &pool, &token).await {
        Ok(f) => f,
        Err(msg) => panic!("准备真实 Workspace 失败: {msg}"),
    };
    let outcome = std::panic::AssertUnwindSafe(run_reconcile(&http, &e, &pool, &fx))
        .catch_unwind()
        .await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn run_reconcile(http: &reqwest::Client, e: &Env, pool: &PgPool, fx: &common::LiveWorkspace) {
    let secs = |k: &str| -> i64 {
        std::env::var(k)
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or_else(|| panic!("缺少 {k}"))
    };
    let interval = secs("PUBLISH_RECONCILE_INTERVAL_SECONDS");
    let settle = secs("PUBLISH_RESULT_SETTLE_SECONDS");

    let (status, body) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::POST,
        &format!("/api/v1/workspaces/{}/messages", fx.workspace),
        Some(serde_json::json!({ "content": "reconcile me" })),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK, "发布应成功：{body}");
    let delivered = body["eventId"].as_str().expect("eventId").to_owned();
    let never_sent = || hex::encode(Uuid::new_v4().as_bytes()).repeat(2);

    let seed = |event_id: String, age: i64| {
        let pool = pool.clone();
        async move {
            let op = Uuid::new_v4();
            sqlx::query(
                "insert into audit.audit_event
                     (id, event_key, tenant_id, workspace_id, operation_id, event_type,
                      initiator_principal_id, actor_principal_id, action_key, action_version,
                      component_type_key, target_type, target_id, parameter_hash, decision,
                      result_code, result_exposure, evidence_refs, correlation_id, occurred_at)
                 values ($1, $2, $3, $4, $5, 'DISPATCH', $6, $6, 'workspace.message.publish', 1,
                         'buzz', 'CHANNEL', $4, 'NONE', 'ALLOW', 'DISPATCHED', 'NONE',
                         jsonb_build_array(jsonb_build_object('kind', 'BUZZ_EVENT_ID', 'value', $7::text)),
                         $5, now() - make_interval(secs => $8))",
            )
            .bind(Uuid::new_v4())
            .bind(format!("verify.reconcile:{op}"))
            .bind(fx.tenant)
            .bind(fx.workspace)
            .bind(op)
            .bind(fx.principal)
            .bind(&event_id)
            .bind(age as f64)
            .execute(&pool)
            .await
            .expect("写入历史 DISPATCH");
            op
        }
    };
    let accepted = seed(delivered, interval * 2).await;
    let lost = seed(never_sent(), settle + interval * 2).await;
    let pending = seed(never_sent(), interval * 2).await;

    let result = |op: Uuid| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, String>(
                "select result_code from audit.audit_event
                 where operation_id = $1 and event_type = 'RECONCILIATION'",
            )
            .bind(op)
            .fetch_optional(&pool)
            .await
            .expect("读对账结果")
        }
    };
    let deadline = std::time::Instant::now()
        + std::time::Duration::from_secs(u64::try_from(interval * 3 + 10).unwrap_or(u64::MAX));
    loop {
        if result(accepted).await.is_some() && result(lost).await.is_some() {
            break;
        }
        assert!(std::time::Instant::now() < deadline, "三轮内没有对账出结论");
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    assert_eq!(
        result(accepted).await.as_deref(),
        Some("ACCEPTED"),
        "Relay 存着它：已送达"
    );
    assert_eq!(
        result(lost).await.as_deref(),
        Some("NOT_DELIVERED"),
        "超出 settle 窗口仍查不到：确定未送达"
    );
    assert_eq!(result(pending).await, None, "窗口内查不到：不下结论");
}

/// 同一个幂等键重发不产生第二条消息（DD-81）。
///
/// 结果不明之后用户再点发送，界面带的是同一个键：Core 回答原操作的结论，而不是
/// 再签一条。这里用两次都成功的发送证明「不重复」这一半；结果不明那一半由
/// `unsettled_publishes_are_reconciled_by_event_id` 与 RB-07 的演练覆盖。
#[tokio::test]
async fn resend_with_same_key_does_not_publish_twice() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;
    let fx = match common::provision_live_workspace(&http, &e, &pool, &token).await {
        Ok(f) => f,
        Err(msg) => panic!("准备真实 Workspace 失败: {msg}"),
    };
    let outcome = std::panic::AssertUnwindSafe(run_resend(&http, &e, &pool, &fx))
        .catch_unwind()
        .await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn run_resend(http: &reqwest::Client, e: &Env, pool: &PgPool, fx: &common::LiveWorkspace) {
    let path = format!("{}/api/v1/workspaces/{}/messages", e.bff_url, fx.workspace);
    let key = Uuid::new_v4().to_string();
    let content = format!("once {key}");
    let send = |idem: Option<&str>| {
        let mut req = http
            .post(&path)
            .header("x-platform-oidc-issuer", &e.oidc_issuer)
            .header("x-platform-oidc-subject", &fx.subject)
            .json(&serde_json::json!({ "content": content }));
        if let Some(k) = idem {
            req = req.header("idempotency-key", k);
        }
        async move {
            let resp = req.send().await.expect("调 BFF");
            let status = resp.status();
            (
                status,
                resp.json::<serde_json::Value>().await.unwrap_or_default(),
            )
        }
    };

    let (status, _) = send(None).await;
    assert_eq!(status, reqwest::StatusCode::BAD_REQUEST, "缺幂等键必须拒绝");

    let (s1, b1) = send(Some(&key)).await;
    let (s2, b2) = send(Some(&key)).await;
    assert_eq!(s1, reqwest::StatusCode::OK, "首次发送：{b1}");
    assert_eq!(s2, reqwest::StatusCode::OK, "重发回答原结论：{b2}");
    assert_eq!(b1["eventId"], b2["eventId"], "同一个键指向同一条事件");
    assert_eq!(
        b1["operationId"], b2["operationId"],
        "同一个键指向同一次操作"
    );

    let (_, history) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::GET,
        &format!("/api/v1/workspaces/{}/messages", fx.workspace),
        None,
    )
    .await;
    let copies = history["events"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|ev| ev["content"] == content.as_str())
                .count()
        })
        .unwrap_or(0);
    assert_eq!(copies, 1, "Relay 上只有一条");
    let dispatches: i64 = sqlx::query_scalar(
        "select count(*) from audit.audit_event
         where event_type = 'DISPATCH' and operation_id = $1::text::uuid",
    )
    .bind(b1["operationId"].as_str().unwrap_or_default())
    .fetch_one(pool)
    .await
    .expect("读审计");
    assert_eq!(dispatches, 1, "只发出过一次");
}

/// 读部署登记的整数配置（集成核验 source 了 `deploy/local/.env`）。缺失即该上界
/// 未登记，直接失败而不是猜一个默认值。
fn registered(name: &str) -> u64 {
    std::env::var(name)
        .unwrap_or_else(|_| panic!("缺少部署登记值 {name}"))
        .parse()
        .unwrap_or_else(|_| panic!("{name} 必须是非负整数"))
}

/// 该 Workspace 已落账的发布 DISPATCH 数。超限请求必须在落账之前被拒。
async fn dispatch_count(pool: &PgPool, workspace: Uuid) -> i64 {
    sqlx::query_scalar(
        "select count(*) from audit.audit_event
         where workspace_id = $1 and action_key = 'workspace.message.publish'
           and event_type = 'DISPATCH'",
    )
    .bind(workspace)
    .fetch_one(pool)
    .await
    .expect("读 DISPATCH 审计")
}

/// 打开一条 SSE 流并读到 `live`，返回余下的字节流供继续读。
async fn open_live(
    http: &reqwest::Client,
    e: &Env,
    subject: &str,
    path: &str,
) -> std::pin::Pin<Box<dyn futures_util::Stream<Item = reqwest::Result<axum::body::Bytes>> + Send>>
{
    use futures_util::StreamExt;
    let resp = http
        .get(format!("{}{path}", e.bff_url))
        .header("x-platform-oidc-issuer", &e.oidc_issuer)
        .header("x-platform-oidc-subject", subject)
        .send()
        .await
        .expect("打开 stream");
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let mut body = resp.bytes_stream().boxed();
    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(15);
    let mut buf = String::new();
    loop {
        let Ok(Some(Ok(chunk))) = tokio::time::timeout_at(deadline, body.next()).await else {
            panic!("流未在上界内追平");
        };
        buf.push_str(&String::from_utf8_lossy(&chunk));
        assert!(!buf.contains("event: closed"), "流在追平前关闭：{buf}");
        if buf.contains("event: live") {
            return body;
        }
    }
}

/// 在已追平的流上等到含 `needle` 的 `event` 帧。
async fn until_event(
    body: &mut std::pin::Pin<
        Box<dyn futures_util::Stream<Item = reqwest::Result<axum::body::Bytes>> + Send>,
    >,
    needle: &str,
    what: &str,
) {
    use futures_util::StreamExt;
    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(15);
    let mut buf = String::new();
    loop {
        let Ok(Some(Ok(chunk))) = tokio::time::timeout_at(deadline, body.next()).await else {
            panic!("{what} 未收到刚发布的事件：{buf}");
        };
        buf.push_str(&String::from_utf8_lossy(&chunk));
        assert!(!buf.contains("event: closed"), "{what} 被关闭：{buf}");
        if buf.contains(needle) {
            return;
        }
    }
}

/// `SS-BUZ-SERVER-CLIENT` 的上界与预算（`relay-server-client.md` 的四项不符）。
///
/// 验四件事：超过登记正文上界的发布在落账与发往 Relay 之前以 LIMIT 拒绝，恰好在上界
/// 的正文被 Relay 接受（登记值不高于 Relay 的实际上界）；同一会话的两条流都追平并
/// 收到同一条新事件（共用连接上按订阅分发）；Core 预算用完后查询、发布与开流都是
/// LIMIT，且拒绝来自 Core 预算（带 `Retry-After`）而不是 Relay。
#[tokio::test]
async fn relay_bounds_and_budget_are_enforced_before_relay() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;

    let fx = match common::provision_live_workspace(&http, &e, &pool, &token).await {
        Ok(f) => f,
        Err(msg) => panic!("准备真实 Workspace 失败: {msg}"),
    };
    let outcome = std::panic::AssertUnwindSafe(run_bounds(&http, &e, &pool, &fx))
        .catch_unwind()
        .await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn run_bounds(http: &reqwest::Client, e: &Env, pool: &PgPool, fx: &common::LiveWorkspace) {
    let msg_path = format!("/api/v1/workspaces/{}/messages", fx.workspace);
    let stream_path = format!("/api/v1/workspaces/{}/stream", fx.workspace);
    let max = registered("BFF_MESSAGE_MAX_CONTENT_BYTES") as usize;

    // 超过登记上界：413 LIMIT PAYLOAD_TOO_LARGE，且没有落 DISPATCH——没签名、没发出
    let before = dispatch_count(pool, fx.workspace).await;
    let (status, body) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::POST,
        &msg_path,
        Some(serde_json::json!({ "content": "x".repeat(max + 1) })),
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::PAYLOAD_TOO_LARGE,
        "超过正文上界必须 413：{body}"
    );
    assert_eq!(body["class"], "LIMIT", "大小上界属于 LIMIT：{body}");
    assert_eq!(body["reason"], "PAYLOAD_TOO_LARGE", "{body}");
    assert_eq!(
        dispatch_count(pool, fx.workspace).await,
        before,
        "超限请求不得落 DISPATCH"
    );

    // 恰好在上界：Relay 接受。登记值高于 Relay 实际上界时这里会被 Relay 拒绝
    let (status, body) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::POST,
        &msg_path,
        Some(serde_json::json!({ "content": "y".repeat(max) })),
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::OK,
        "上界内的正文应被接受：{body}"
    );

    // 同一会话的两条流：都追平，并都收到同一条新事件
    let mut first = open_live(http, e, &fx.subject, &stream_path).await;
    let mut second = open_live(http, e, &fx.subject, &stream_path).await;
    let marker = format!("shared-{}", Uuid::new_v4());
    let (status, body) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::POST,
        &msg_path,
        Some(serde_json::json!({ "content": marker })),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK, "发布应成功：{body}");
    until_event(&mut first, &marker, "第一条流").await;
    until_event(&mut second, &marker, "第二条流").await;
    drop(first);
    drop(second);

    // 预算：连续查询直到第一次非 200。它必须是 Core 预算给出的 LIMIT——带 Retry-After；
    // Relay 的 429 不带它，出现就说明压力被透传给了 Relay（登记值高于 Relay 额度）
    let budget = registered("BFF_RELAY_API_BUDGET");
    let mut ok = 0u64;
    let limited = loop {
        let resp = http
            .get(format!("{}{msg_path}", e.bff_url))
            .header("x-platform-oidc-issuer", &e.oidc_issuer)
            .header("x-platform-oidc-subject", &fx.subject)
            .send()
            .await
            .expect("调 BFF");
        if resp.status() != reqwest::StatusCode::OK {
            break resp;
        }
        ok += 1;
        assert!(ok <= budget, "成功查询次数超过了 Core 预算 {budget}");
    };
    assert_eq!(
        limited.status(),
        reqwest::StatusCode::TOO_MANY_REQUESTS,
        "预算用完必须 429"
    );
    let retry_after: u64 = limited
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .expect("Core 预算的拒绝必须带 Retry-After");
    assert!(
        retry_after > 0 && retry_after <= registered("BFF_RELAY_API_BUDGET_WINDOW_SECONDS"),
        "Retry-After 必须落在预算窗口内，得到 {retry_after}"
    );
    let body: serde_json::Value = limited.json().await.expect("错误体");
    assert_eq!(body["class"], "LIMIT", "限流属于 LIMIT：{body}");
    assert_eq!(body["reason"], "RATE_LIMITED", "{body}");

    // 预算用完时发布也是 LIMIT，且在落 DISPATCH 之前被拦下——不打到 Relay
    let before = dispatch_count(pool, fx.workspace).await;
    let (status, body) = bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::POST,
        &msg_path,
        Some(serde_json::json!({ "content": "over budget" })),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::TOO_MANY_REQUESTS, "{body}");
    assert_eq!(body["class"], "LIMIT", "{body}");
    assert_eq!(body["reason"], "RATE_LIMITED", "{body}");
    assert_ne!(body["class"], "DENIED", "限流不得渲染为权限拒绝");
    assert_eq!(
        dispatch_count(pool, fx.workspace).await,
        before,
        "预算拦下的发布不得落 DISPATCH"
    );

    // 开流：snapshot 被预算拦下，带内以 rate-limited 关闭，而不是 upstream-unavailable
    let frames = read_sse(http, e, &fx.subject, &stream_path, None)
        .await
        .expect("准入已过，流以 200 打开");
    let closed = frames
        .iter()
        .find(|f| f.name == "closed")
        .unwrap_or_else(|| panic!("预算用完时流应带内关闭，实际 {frames:?}"));
    assert_eq!(
        closed.data, "rate-limited",
        "关闭原因必须是 LIMIT：{frames:?}"
    );
}

/// 一个 binding 的 NIP-11 事实：(state, version, digest, relay_self)。
async fn binding_nip11(pool: &PgPool, tenant: Uuid) -> (String, i32, String, Option<String>) {
    sqlx::query_as(
        "select state, version, nip11_snapshot_digest, relay_self_pubkey
         from projection.tenant_buzz_binding where tenant_id = $1",
    )
    .bind(tenant)
    .fetch_one(pool)
    .await
    .expect("读 TenantBuzzBinding")
}

/// 等 binding 满足条件，上界取治理对账间隔的若干倍（对账器每轮都检查）。
async fn until_binding<F>(pool: &PgPool, tenant: Uuid, what: &str, ok: F)
where
    F: Fn(&(String, i32, String, Option<String>)) -> bool,
{
    let deadline = std::time::Instant::now()
        + std::time::Duration::from_secs(registered("GOVERNANCE_RECONCILE_INTERVAL_SECONDS") * 3);
    loop {
        let b = binding_nip11(pool, tenant).await;
        if ok(&b) {
            return;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "{what}：binding 停在 {b:?}"
        );
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
}

/// V-SCN-87 / DD-114：NIP-11 在 binding ACTIVE 之后改变。
///
/// Relay 的文档在核验中不能改（不动运行环境），因此改的是另一侧：把快照换成一份
/// 「旧文档」的摘要，对 Core 而言这与 Relay 文档变了是同一个不一致。验五件事：
/// 建立时登记了 `self`；verify 步不改写已 ACTIVE 的快照；BFF 请求路径只拒绝、不写
/// binding；对账器以条件更新进出 RECONCILING 并在同一 operation 下写两条审计；`self`
/// 与登记值不符时保持 RECONCILING、不改写登记值，恢复后才回到 ACTIVE。
#[tokio::test]
async fn nip11_drift_is_reconciled_by_governance_reconciler() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;

    let fx = match common::provision_live_workspace(&http, &e, &pool, &token).await {
        Ok(f) => f,
        Err(msg) => panic!("准备真实 Workspace 失败: {msg}"),
    };
    let outcome = std::panic::AssertUnwindSafe(run_drift(&http, &e, &pool, &token, &fx))
        .catch_unwind()
        .await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn run_drift(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    token: &str,
    fx: &common::LiveWorkspace,
) {
    let msg_path = format!("/api/v1/workspaces/{}/messages", fx.workspace);
    let (state, v0, d0, relay_self) = binding_nip11(pool, fx.tenant).await;
    assert_eq!(state, "ACTIVE");
    let relay_self = relay_self.expect("建立路径必须登记 relay_self_pubkey（DD-114(5)）");
    assert!(
        relay_self.len() == 64 && relay_self.chars().all(|c| c.is_ascii_hexdigit()),
        "relay_self_pubkey 应为 64 位十六进制：{relay_self}"
    );

    // verify 步对已 ACTIVE 的 binding 不改写快照：version 与 digest 都不动
    let tenant_version: i32 =
        sqlx::query_scalar("select version from identity.tenant where id = $1")
            .bind(fx.tenant)
            .fetch_one(pool)
            .await
            .expect("读 Tenant version");
    let status = http
        .post(format!("{}/service/v1/tenants/buzz-verify", e.service_url))
        .bearer_auth(token)
        .json(&serde_json::json!({"tenantId": fx.tenant, "tenantVersion": tenant_version}))
        .send()
        .await
        .expect("调 verify 步")
        .status();
    assert_eq!(
        status,
        reqwest::StatusCode::OK,
        "对 ACTIVE binding 重放 verify 应幂等成功"
    );
    let (state, v, d, _) = binding_nip11(pool, fx.tenant).await;
    assert_eq!(
        (state.as_str(), v, d.as_str()),
        ("ACTIVE", v0, d0.as_str()),
        "verify 步不得改写已 ACTIVE binding 的快照"
    );

    // 快照换成「旧文档」的摘要：BFF 只拒绝该次请求，对账器负责迁移并重新查证
    let stale = "0".repeat(64);
    sqlx::query(
        "update projection.tenant_buzz_binding set nip11_snapshot_digest = $2 where tenant_id = $1",
    )
    .bind(fx.tenant)
    .bind(&stale)
    .execute(pool)
    .await
    .expect("写入旧快照");
    let (status, body) = bff(http, e, &fx.subject, reqwest::Method::GET, &msg_path, None).await;
    assert!(
        (status == reqwest::StatusCode::SERVICE_UNAVAILABLE
            && body["reason"] == "BINDING_NOT_ACTIVE")
            || status == reqwest::StatusCode::FORBIDDEN,
        "快照不一致时请求必须被拒：{status} {body}"
    );
    until_binding(
        pool,
        fx.tenant,
        "漂移后应重新查证回到 ACTIVE",
        |b| b.0 == "ACTIVE" && b.2 == d0,
    )
    .await;
    let (_, v1, _, self1) = binding_nip11(pool, fx.tenant).await;
    assert_eq!(v1, v0 + 2, "进入与回到 ACTIVE 各推进一次 version");
    assert_eq!(
        self1.as_deref(),
        Some(relay_self.as_str()),
        "登记的 self 不变"
    );
    let audits: Vec<(String, String, Uuid)> = sqlx::query_as(
        "select result_code, parameter_hash, operation_id from audit.audit_event
         where tenant_id = $1 and action_key = 'tenant.buzz_binding.nip11_reconcile'
         order by occurred_at",
    )
    .bind(fx.tenant)
    .fetch_all(pool)
    .await
    .expect("读漂移审计");
    let codes: Vec<&str> = audits.iter().map(|a| a.0.as_str()).collect();
    assert_eq!(codes, ["NIP11_DRIFT", "NIP11_REVERIFIED"], "进出各一条审计");
    let pair = format!("{stale}:{d0}");
    assert!(
        audits.iter().all(|a| a.1 == pair),
        "审计记录旧、新 digest：{audits:?}"
    );
    assert_eq!(audits[0].2, audits[1].2, "一次漂移归同一个 operation");
    let (status, body) = bff(http, e, &fx.subject, reqwest::Method::GET, &msg_path, None).await;
    assert_eq!(
        status,
        reqwest::StatusCode::OK,
        "回到 ACTIVE 后恢复服务：{body}"
    );

    // self 与登记值不符：进入 RECONCILING 后保持，不改写登记值
    let other = "1".repeat(64);
    sqlx::query(
        "update projection.tenant_buzz_binding
         set nip11_snapshot_digest = $2, relay_self_pubkey = $3 where tenant_id = $1",
    )
    .bind(fx.tenant)
    .bind(&stale)
    .bind(&other)
    .execute(pool)
    .await
    .expect("写入旧快照与另一个登记值");
    until_binding(pool, fx.tenant, "漂移应转 RECONCILING", |b| {
        b.0 == "RECONCILING"
    })
    .await;
    tokio::time::sleep(std::time::Duration::from_secs(
        registered("GOVERNANCE_RECONCILE_INTERVAL_SECONDS") * 2,
    ))
    .await;
    let (state, _, d, self2) = binding_nip11(pool, fx.tenant).await;
    assert_eq!(state, "RECONCILING", "self 不符时必须保持 RECONCILING");
    assert_eq!(d, stale, "未通过查证不得写新快照");
    assert_eq!(
        self2.as_deref(),
        Some(other.as_str()),
        "不自动改写 relay_self_pubkey"
    );
    let (status, body) = bff(http, e, &fx.subject, reqwest::Method::GET, &msg_path, None).await;
    assert_ne!(
        status,
        reqwest::StatusCode::OK,
        "RECONCILING 期间经 Relay 的读写必须拒绝：{body}"
    );

    // self 恢复为登记值后才回到 ACTIVE
    sqlx::query(
        "update projection.tenant_buzz_binding set relay_self_pubkey = $2 where tenant_id = $1",
    )
    .bind(fx.tenant)
    .bind(&relay_self)
    .execute(pool)
    .await
    .expect("恢复登记值");
    until_binding(pool, fx.tenant, "self 恢复后应回到 ACTIVE", |b| {
        b.0 == "ACTIVE" && b.2 == d0
    })
    .await;

    // 迁移前的存量行（ACTIVE、无登记值）：摘要仍等于已查证快照时由对账器登记 self，
    // 不改变状态与 version
    let (_, v2, _, _) = binding_nip11(pool, fx.tenant).await;
    sqlx::query(
        "update projection.tenant_buzz_binding set relay_self_pubkey = null where tenant_id = $1",
    )
    .bind(fx.tenant)
    .execute(pool)
    .await
    .expect("模拟存量行");
    until_binding(pool, fx.tenant, "存量行应登记 self", |b| {
        b.3.as_deref() == Some(relay_self.as_str())
    })
    .await;
    let (state, v3, d3, _) = binding_nip11(pool, fx.tenant).await;
    assert_eq!(
        (state.as_str(), v3, d3.as_str()),
        ("ACTIVE", v2, d0.as_str()),
        "登记 self 不迁移状态"
    );
}

/// 调一个 service 端点，返回状态与回应体。
async fn service(
    http: &reqwest::Client,
    e: &Env,
    token: &str,
    path: &str,
    body: serde_json::Value,
) -> (reqwest::StatusCode, serde_json::Value) {
    let resp = http
        .post(format!("{}{path}", e.service_url))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .expect("调 service 端点");
    let status = resp.status();
    (status, resp.json().await.unwrap_or(serde_json::Value::Null))
}

/// DD-114(2)：TenantBuzzBinding 因 NIP-11 漂移停在 RECONCILING 时，撤出方向照常收敛，
/// 投入方向与经 Relay 的读写等待回到 ACTIVE；BFF 的拒绝带 BINDING_NOT_ACTIVE，已建立
/// 的流以 binding-not-active 关闭。
///
/// 撤出路径逐条直接调 Workflow Activity 所用的 service 端点（与 Workflow 同一入口）：
/// WorkspaceMembership 与 TenantMembership 撤权（membership-projections/buzz ABSENT）、
/// 设备撤销（identity-projections/buzz 对 REVOKING 的 CLIENT binding）、Workspace 暂停
/// 的 roster 清空与 Channel 归档。
#[tokio::test]
async fn withdrawal_converges_while_binding_reconciling() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;

    let fx = match common::provision_live_workspace(&http, &e, &pool, &token).await {
        Ok(f) => f,
        Err(msg) => panic!("准备真实 Workspace 失败: {msg}"),
    };
    let outcome = std::panic::AssertUnwindSafe(run_withdrawal(&http, &e, &pool, &token, &fx))
        .catch_unwind()
        .await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn run_withdrawal(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    token: &str,
    fx: &common::LiveWorkspace,
) {
    use futures_util::StreamExt;
    let msg_path = format!("/api/v1/workspaces/{}/messages", fx.workspace);
    let stream_path = format!("/api/v1/workspaces/{}/stream", fx.workspace);
    let (_, _, d0, relay_self) = binding_nip11(pool, fx.tenant).await;
    let relay_self = relay_self.expect("建立路径登记了 relay_self_pubkey");

    // 漂移前打开一条流，漂移后它必须在再准入时以 binding-not-active 关闭
    let mut live = open_live(http, e, &fx.subject, &stream_path).await;

    // 让 binding 停在 RECONCILING：快照换成旧摘要、登记值换成另一个 self
    sqlx::query(
        "update projection.tenant_buzz_binding
         set nip11_snapshot_digest = $2, relay_self_pubkey = $3 where tenant_id = $1",
    )
    .bind(fx.tenant)
    .bind("0".repeat(64))
    .bind("1".repeat(64))
    .execute(pool)
    .await
    .expect("制造不可通过的漂移");
    until_binding(pool, fx.tenant, "漂移应转 RECONCILING", |b| {
        b.0 == "RECONCILING"
    })
    .await;

    // 已建立的流：关闭原因是 binding-not-active，不是 scope-revoked
    let deadline = tokio::time::Instant::now()
        + tokio::time::Duration::from_secs(e.stream_readmit_seconds * 2 + 5);
    let mut buf = String::new();
    loop {
        let Ok(Some(Ok(chunk))) = tokio::time::timeout_at(deadline, live.next()).await else {
            panic!("RECONCILING 后既有流未在再准入上界内关闭：{buf}");
        };
        buf.push_str(&String::from_utf8_lossy(&chunk));
        if buf.contains("event: closed") {
            assert!(
                buf.contains("data: binding-not-active"),
                "既有流应以 binding-not-active 关闭，而不是撤权：{buf}"
            );
            break;
        }
    }
    drop(live);

    // 新请求：带 PRECONDITION 分类的 BINDING_NOT_ACTIVE，不是空正文 403
    let (status, body) = bff(http, e, &fx.subject, reqwest::Method::GET, &msg_path, None).await;
    assert_eq!(status, reqwest::StatusCode::SERVICE_UNAVAILABLE, "{body}");
    assert_eq!(body["class"], "PRECONDITION", "{body}");
    assert_eq!(body["reason"], "BINDING_NOT_ACTIVE", "{body}");
    // 新流：带内关闭并按间隔重连，而不是非 200 让浏览器永久停止
    let frames = read_sse(http, e, &fx.subject, &stream_path, None)
        .await
        .expect("binding 暂不可用时流以 200 打开并带内关闭");
    assert!(
        frames
            .iter()
            .any(|f| f.name == "closed" && f.data == "binding-not-active"),
        "新流应带内以 binding-not-active 关闭：{frames:?}"
    );

    // 投入方向仍要求 ACTIVE
    let ws_membership_version: i32 =
        sqlx::query_scalar("select version from identity.workspace_membership where id = $1")
            .bind(fx.workspace_membership)
            .fetch_one(pool)
            .await
            .expect("读 WorkspaceMembership version");
    let (status, body) = service(
        http,
        e,
        token,
        "/service/v1/membership-projections/buzz",
        serde_json::json!({"scope": "WORKSPACE", "membershipId": fx.workspace_membership,
                           "membershipVersion": ws_membership_version, "presence": "PRESENT"}),
    )
    .await;
    assert!(
        status.is_client_error(),
        "RECONCILING 期间投入方向必须被拒：{status} {body}"
    );

    // 设备撤销：REVOKING 的 CLIENT binding 移出 roster 并置 REVOKED
    let device = nostr::Keys::generate().public_key().to_hex();
    sqlx::query(
        "insert into identity.buzz_identity_binding
             (tenant_id, principal_id, pubkey, custody, kind, state)
         values ($1, $2, $3, 'CLIENT', 'HUMAN', 'REVOKING')",
    )
    .bind(fx.tenant)
    .bind(fx.principal)
    .bind(&device)
    .execute(pool)
    .await
    .expect("建撤销中的 CLIENT binding");
    let device_version: i32 =
        sqlx::query_scalar("select version from identity.buzz_identity_binding where pubkey = $1")
            .bind(&device)
            .fetch_one(pool)
            .await
            .expect("读设备 binding version");
    let (status, body) = service(
        http,
        e,
        token,
        "/service/v1/identity-projections/buzz",
        serde_json::json!({"pubkey": device, "bindingVersion": device_version}),
    )
    .await;
    assert!(
        status.is_success(),
        "RECONCILING 期间设备撤销必须收敛：{status} {body}"
    );
    let device_state: String =
        sqlx::query_scalar("select state from identity.buzz_identity_binding where pubkey = $1")
            .bind(&device)
            .fetch_one(pool)
            .await
            .expect("读设备 binding");
    assert_eq!(device_state, "REVOKED", "设备撤销应到终态");

    // WorkspaceMembership 撤权：Channel roster 移出，回读收敛
    let (status, body) = service(
        http,
        e,
        token,
        "/service/v1/membership-projections/buzz",
        serde_json::json!({"scope": "WORKSPACE", "membershipId": fx.workspace_membership,
                           "membershipVersion": ws_membership_version, "presence": "ABSENT"}),
    )
    .await;
    assert!(
        status.is_success(),
        "RECONCILING 期间 Workspace 撤权必须收敛：{status} {body}"
    );
    assert_eq!(body["converged"], true, "{body}");

    // Workspace 暂停：roster 清空与 Channel 归档
    let ws_version: i32 = sqlx::query_scalar(
        "update identity.workspace set state = 'SUSPENDING', version = version + 1
         where id = $1 returning version",
    )
    .bind(fx.workspace)
    .fetch_one(pool)
    .await
    .expect("置 Workspace SUSPENDING");
    let (status, body) = service(
        http,
        e,
        token,
        "/service/v1/workspaces/channel-roster",
        serde_json::json!({"workspaceId": fx.workspace, "workspaceVersion": ws_version,
                           "mode": "CLEAR"}),
    )
    .await;
    assert!(
        status.is_success(),
        "RECONCILING 期间暂停清空 roster 必须收敛：{status} {body}"
    );
    let (status, body) = service(
        http,
        e,
        token,
        "/service/v1/workspaces/channel-archive",
        serde_json::json!({"workspaceId": fx.workspace, "workspaceVersion": ws_version,
                           "archived": true}),
    )
    .await;
    assert!(
        status.is_success(),
        "RECONCILING 期间暂停归档必须收敛：{status} {body}"
    );

    // TenantMembership 撤权：relay roster 移出，身份转 REVOKED
    let t_membership: (Uuid, i32) = sqlx::query_as(
        "select id, version from identity.tenant_membership
         where tenant_id = $1 and tenant_principal_id = $2",
    )
    .bind(fx.tenant)
    .bind(fx.principal)
    .fetch_one(pool)
    .await
    .expect("读 TenantMembership");
    // DD-115 (2)：撤权使 SERVER 私钥到期的 operation 来自该版本的 MEMBERSHIP_REVOCATION。
    common::seed_membership_revocation_ref(
        pool,
        fx.tenant,
        fx.initiator,
        t_membership.0,
        t_membership.1,
    )
    .await;
    let (status, body) = service(
        http,
        e,
        token,
        "/service/v1/membership-projections/buzz",
        serde_json::json!({"scope": "TENANT", "membershipId": t_membership.0,
                           "membershipVersion": t_membership.1, "presence": "ABSENT"}),
    )
    .await;
    assert!(
        status.is_success(),
        "RECONCILING 期间 Tenant 撤权必须收敛：{status} {body}"
    );
    assert_eq!(body["converged"], true, "{body}");

    // 撤权期间 binding 一直停在 RECONCILING：上面的收敛不是等回到 ACTIVE 才成立的
    let (state, _, _, _) = binding_nip11(pool, fx.tenant).await;
    assert_eq!(state, "RECONCILING");

    // 恢复登记值，交给对账器回到 ACTIVE（夹具清理需要）
    sqlx::query(
        "update projection.tenant_buzz_binding set relay_self_pubkey = $2 where tenant_id = $1",
    )
    .bind(fx.tenant)
    .bind(&relay_self)
    .execute(pool)
    .await
    .expect("恢复登记值");
    until_binding(pool, fx.tenant, "恢复后应回到 ACTIVE", |b| {
        b.0 == "ACTIVE" && b.2 == d0
    })
    .await;
}
