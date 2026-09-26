//! Web 托管 HUMAN 身份的 key revoke 与重建（`.design/09` 的 key revoke/rotate 行）。
//!
//! 在一个经真实生命周期开通的 Workspace 上，以持钥者与 Relay 的实际行为取证：
//!
//! - revoke 的第一句就停签：BFF 代签发布立即被拒，已建立的流在再准入周期内以
//!   `identity-revoked` 关闭；
//! - 旧 pubkey 移出 roster 后，持有旧私钥（KV 旧版本仍在）直连 Relay 发布被拒；
//! - 重建写独立 locator 的 KV 版本，新 pubkey 进入 relay 与 Channel roster 后
//!   ACTIVE，Web 发言恢复且作者是新 pubkey；
//! - CONTROL 身份不经此入口（GAP-BUZ-01），重建必须先撤后建（DD-77）。

use futures_util::FutureExt;
use kailo_buzz::bridge::{Custody, IdentityClient};
use sqlx::PgPool;
use uuid::Uuid;

mod common;
use common::Env;

async fn bff_publish(
    http: &reqwest::Client,
    e: &Env,
    fx: &common::LiveWorkspace,
    content: &str,
) -> (reqwest::StatusCode, serde_json::Value) {
    let resp = http
        .post(format!(
            "{}/api/v1/workspaces/{}/messages",
            e.bff_url, fx.workspace
        ))
        .header("x-kailo-oidc-issuer", &e.oidc_issuer)
        .header("x-kailo-oidc-subject", &fx.subject)
        .header("idempotency-key", Uuid::new_v4().to_string())
        .json(&serde_json::json!({ "content": content }))
        .send()
        .await
        .expect("调 BFF");
    let status = resp.status();
    (status, resp.json().await.unwrap_or(serde_json::Value::Null))
}

async fn seed_action(pool: &PgPool, fx: &common::LiveWorkspace, target: Uuid) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        "insert into admission.action_execution
             (id, operation_id, tenant_id, action_key, action_version,
              initiator_principal_id, actor_principal_id, target_id, parameter_hash,
              gate_state, dispatch_state, correlation_id)
         values ($1, gen_random_uuid(), $2, 'identity.key_rotate', 1, $3, $3, $4, 'verify',
                 'ALLOWED', 'NOT_DISPATCHED', gen_random_uuid())",
    )
    .bind(id)
    .bind(fx.tenant)
    .bind(fx.initiator)
    .bind(target)
    .execute(pool)
    .await
    .expect("建 ActionExecution");
    id
}

async fn call(
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
        .expect("调 service API");
    let status = resp.status();
    (status, resp.json().await.unwrap_or(serde_json::Value::Null))
}

async fn wait_binding(pool: &PgPool, pubkey: &str, want: &str, bound: u64) -> String {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(bound);
    loop {
        let got: String = sqlx::query_scalar(
            "select state from identity.buzz_identity_binding where pubkey = $1",
        )
        .bind(pubkey)
        .fetch_one(pool)
        .await
        .expect("读 binding");
        if got == want || std::time::Instant::now() > deadline {
            return got;
        }
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    }
}

#[tokio::test]
async fn server_key_is_revoked_then_reprovisioned() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;

    let fx = match common::provision_live_workspace(&http, &e, &pool, &token).await {
        Ok(f) => f,
        Err(msg) => panic!("准备真实 Workspace 失败: {msg}"),
    };
    let outcome = std::panic::AssertUnwindSafe(run(&http, &e, &pool, &token, &fx))
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
    pool: &PgPool,
    token: &str,
    fx: &common::LiveWorkspace,
) {
    use futures_util::StreamExt;

    let (old, locator, old_version, old_audience): (String, String, i32, String) = sqlx::query_as(
        "select pubkey, private_key_secret_ref, private_key_secret_version,
                private_key_secret_audience
         from identity.buzz_identity_binding
         where principal_id = $1 and custody = 'SERVER' and state = 'ACTIVE'",
    )
    .bind(fx.principal)
    .fetch_one(pool)
    .await
    .expect("夹具应已有 ACTIVE 的 Web 托管身份");
    let (status, body) = bff_publish(http, e, fx, "before rotation").await;
    assert_eq!(status, reqwest::StatusCode::OK, "轮换前应能发言：{body}");

    // ---- 拒绝面 ----
    // CONTROL 不经此入口：GAP-BUZ-01
    let (control, control_principal, control_ref, control_version, control_audience): (
        String,
        Uuid,
        String,
        i32,
        String,
    ) = sqlx::query_as(
        "select pubkey, principal_id, private_key_secret_ref,
                private_key_secret_version, private_key_secret_audience
         from identity.buzz_identity_binding
         where tenant_id = $1 and kind = 'CONTROL' and state = 'ACTIVE'",
    )
    .bind(fx.tenant)
    .fetch_one(pool)
    .await
    .expect("CONTROL binding");

    // 一个 ACTIVE HUMAN binding 若错指向 CONTROL 私钥，BFF 绝不能以 CONTROL
    // 身份替用户发布。错绑只改夹具行，恢复后再继续真实轮换链。
    sqlx::query(
        "update identity.buzz_identity_binding
         set private_key_secret_ref = $2, private_key_secret_version = $3,
             private_key_secret_audience = $4
         where pubkey = $1",
    )
    .bind(&old)
    .bind(&control_ref)
    .bind(control_version)
    .bind(&control_audience)
    .execute(pool)
    .await
    .expect("注入错绑 SecretRef");
    let (status, _) = bff_publish(http, e, fx, "wrong identity secret").await;
    assert_eq!(status, reqwest::StatusCode::SERVICE_UNAVAILABLE);

    // 同一错绑在 RECONCILING 时也不能把 pubkey 投入 roster 或宣布 ACTIVE。
    let reconciling_version: i32 = sqlx::query_scalar(
        "update identity.buzz_identity_binding
         set state = 'RECONCILING', version = version + 1
         where pubkey = $1 returning version",
    )
    .bind(&old)
    .fetch_one(pool)
    .await
    .expect("注入待投影状态");
    let (status, _) = call(
        http,
        e,
        token,
        "/service/v1/identity-projections/buzz",
        serde_json::json!({ "pubkey": old, "bindingVersion": reconciling_version }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        wait_binding(pool, &old, "RECONCILING", 0).await,
        "RECONCILING"
    );
    sqlx::query(
        "update identity.buzz_identity_binding
         set state = 'ACTIVE', version = version + 1,
             private_key_secret_ref = $2, private_key_secret_version = $3,
             private_key_secret_audience = $4
         where pubkey = $1",
    )
    .bind(&old)
    .bind(&locator)
    .bind(old_version)
    .bind(&old_audience)
    .execute(pool)
    .await
    .expect("恢复原 HUMAN SecretRef");
    let (status, body) = bff_publish(http, e, fx, "after binding restore").await;
    assert_eq!(
        status,
        reqwest::StatusCode::OK,
        "恢复后应能以 HUMAN 发言：{body}"
    );

    let a = seed_action(pool, fx, control_principal).await;
    let (status, _) = call(
        http,
        e,
        token,
        "/service/v1/identities/server-keys/revoke",
        serde_json::json!({ "pubkey": control, "actionExecutionId": a }),
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::CONFLICT,
        "CONTROL 轮换受 GAP-BUZ-01 阻断"
    );
    // 先撤后建：仍有 ACTIVE 的 SERVER 身份时不重建
    let a = seed_action(pool, fx, fx.principal).await;
    let (status, _) = call(
        http,
        e,
        token,
        "/service/v1/identities/server-keys/provision",
        serde_json::json!({ "principalId": fx.principal, "actionExecutionId": a }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::CONFLICT, "DD-77：先撤后建");
    // 准入的 target 必须是该 Principal
    let wrong = seed_action(pool, fx, fx.workspace).await;
    let (status, _) = call(
        http,
        e,
        token,
        "/service/v1/identities/server-keys/revoke",
        serde_json::json!({ "pubkey": old, "actionExecutionId": wrong }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::FORBIDDEN);

    // ---- revoke ----
    let stream = http
        .get(format!(
            "{}/api/v1/workspaces/{}/stream",
            e.bff_url, fx.workspace
        ))
        .header("x-kailo-oidc-issuer", &e.oidc_issuer)
        .header("x-kailo-oidc-subject", &fx.subject)
        .send()
        .await
        .expect("开流");
    assert!(stream.status().is_success(), "流应开得起来");
    let mut stream = stream.bytes_stream();

    let revoke = seed_action(pool, fx, fx.principal).await;
    let (status, body) = call(
        http,
        e,
        token,
        "/service/v1/identities/server-keys/revoke",
        serde_json::json!({ "pubkey": old, "actionExecutionId": revoke }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK, "{body}");
    // 停签是 revoke 的第一句，不等 Workflow
    let (status, _) = bff_publish(http, e, fx, "during rotation").await;
    assert_eq!(status, reqwest::StatusCode::FORBIDDEN, "REVOKING 起即停签");
    // 同一准入重发回答同一个 Workflow
    let (status, again) = call(
        http,
        e,
        token,
        "/service/v1/identities/server-keys/revoke",
        serde_json::json!({ "pubkey": old, "actionExecutionId": revoke }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK);
    assert_eq!(again["workflowId"], body["workflowId"]);

    // 已建立的流在再准入周期内关闭。两个执行点谁先到都算：BFF 的再准入发现
    // 订阅所用的身份不再 ACTIVE（identity-revoked），或 Relay 在该 pubkey 移出
    // Channel roster 后自己关掉订阅。Relay 可达时通常是后者先到；Relay 不可达、
    // roster 移除按轮等待时只剩前者（RB-03）。
    let closed = |b: &str| b.contains("identity-revoked") || b.contains("channel access revoked");
    let bound = std::time::Duration::from_secs(e.stream_readmit_seconds * 3 + 5);
    let deadline = tokio::time::Instant::now() + bound;
    let mut buf = String::new();
    while tokio::time::Instant::now() < deadline && !closed(&buf) {
        let Ok(Some(Ok(chunk))) = tokio::time::timeout_at(deadline, stream.next()).await else {
            break;
        };
        buf.push_str(&String::from_utf8_lossy(&chunk));
    }
    assert!(
        closed(&buf),
        "revoke 后已建立的流必须在 {bound:?} 内关闭，实际收到：{buf}"
    );

    assert_eq!(
        wait_binding(pool, &old, "REVOKED", e.converge_bound_secs).await,
        "REVOKED"
    );
    // 持有旧私钥的人直连 Relay：该 pubkey 已不在 roster 上
    let (host, channel) = common::live_scope(pool, fx).await;
    let old_secret = common::read_secret_version(http, e, &locator, old_version).await;
    let as_holder = IdentityClient::new(Custody::Server, &old_secret, &e.relay_origin, &host)
        .expect("旧私钥客户端");
    let published = as_holder
        .publish(
            http,
            9,
            "with a revoked key",
            &[vec!["h".to_owned(), channel.clone()]],
        )
        .await;
    // Relay 的判定是拒绝（accepted=false 或 4xx），而不是传输失败——后者证明不了任何事
    let refused = match &published {
        Ok(v) => v["accepted"] == false,
        Err(kailo_buzz::operator::OperatorError::Rejected { .. }) => true,
        Err(_) => false,
    };
    assert!(
        refused,
        "revoke 后旧 pubkey 直连发布必须被拒：{published:?}"
    );

    // ---- 重建 ----
    let provision = seed_action(pool, fx, fx.principal).await;
    let (status, body) = call(
        http,
        e,
        token,
        "/service/v1/identities/server-keys/provision",
        serde_json::json!({ "principalId": fx.principal, "actionExecutionId": provision }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK, "{body}");
    let (status, again) = call(
        http,
        e,
        token,
        "/service/v1/identities/server-keys/provision",
        serde_json::json!({ "principalId": fx.principal, "actionExecutionId": provision }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK);
    assert_eq!(
        again["workflowId"], body["workflowId"],
        "同一准入不另起执行"
    );

    let (new, new_locator, new_version): (String, String, i32) = sqlx::query_as(
        "select pubkey, private_key_secret_ref, private_key_secret_version
         from identity.buzz_identity_binding
         where principal_id = $1 and custody = 'SERVER' and state <> 'REVOKED'",
    )
    .bind(fx.principal)
    .fetch_one(pool)
    .await
    .expect("应已建立新的 Web 托管身份");
    assert_ne!(new, old, "换私钥必然换 pubkey");
    assert_ne!(
        new_locator, locator,
        "新身份必须写独立 KV 路径，避免版本上限淘汰旧引用"
    );
    assert!(new_locator.ends_with(&format!("/{new}")));
    assert!(
        new_version > 0 && old_version > 0,
        "两个 binding 都必须钉住具体版本"
    );
    assert_eq!(
        wait_binding(pool, &new, "ACTIVE", e.converge_bound_secs).await,
        "ACTIVE"
    );

    let (status, body) = bff_publish(http, e, fx, "after rotation").await;
    assert_eq!(status, reqwest::StatusCode::OK, "重建后应恢复发言：{body}");
    let event_id = body["eventId"].as_str().expect("eventId").to_owned();
    let history: serde_json::Value = http
        .get(format!(
            "{}/api/v1/workspaces/{}/messages",
            e.bff_url, fx.workspace
        ))
        .header("x-kailo-oidc-issuer", &e.oidc_issuer)
        .header("x-kailo-oidc-subject", &fx.subject)
        .send()
        .await
        .expect("读历史")
        .json()
        .await
        .expect("解析历史");
    let authored = history["events"]
        .as_array()
        .and_then(|evs| evs.iter().find(|ev| ev["id"] == event_id.as_str()))
        .map(|ev| ev["pubkey"].clone());
    assert_eq!(
        authored,
        Some(serde_json::Value::String(new.clone())),
        "新消息的作者是新 pubkey"
    );

    // 两次决定各一条审计，指向各自的 pubkey
    let audited: i64 = sqlx::query_scalar(
        "select count(*) from audit.audit_event
         where tenant_id = $1 and target_id = $2 and action_key = 'identity.key_rotate'
           and result_code in ('REVOKING', 'RECONCILING')",
    )
    .bind(fx.tenant)
    .bind(fx.principal)
    .fetch_one(pool)
    .await
    .expect("读审计");
    assert_eq!(audited, 2, "revoke 与重建各一条，重发不复制");
}
