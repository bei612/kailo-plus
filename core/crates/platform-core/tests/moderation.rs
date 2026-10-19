//! DD-125(2) 社区审核的端到端核验（V-SCN-127/128/129/130）。
//!
//! 审核入口与受审计读取只对 Tenant manage；非 admin 与对本人的封禁以
//! PERMISSION_DENIED 拒绝并留下 DENIED 的 ActionExecution；Tenant admin 的禁言由 CONTROL
//! 对目标全部公钥签 9042，经 Relay 限制列表回读一致才 DISPATCHED，解除同样回读。
//!
//! 走真实拓扑：BFF 经网关身份 header、SpiceDB fresh Check、Relay（CONTROL 经 NIP-98）。
//! 夹具只写 OIDC 侧身份与首位 admin 关系（夹具 Tenant 不经部署引导）。

use reqwest::{Method, StatusCode};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

mod common;
use common::{bff, reason, submit, until, Env, LiveMember, LiveWorkspace};

#[tokio::test]
async fn moderation_admits_tenant_admins_and_converges_on_relay_restrictions() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;
    let fx = common::provision_live_workspace(&http, &e, &pool, &token)
        .await
        .expect("开通夹具 Workspace");
    let member = match common::add_tenant_member(&http, &e, &pool, &token, &fx).await {
        Ok(member) => member,
        Err(err) => {
            common::teardown_live_workspace(&e, &pool, &fx).await;
            panic!("开通成员失败：{err}");
        }
    };
    let tenant = format!("tenant:{}", fx.tenant);
    let admin = format!("principal:{}", fx.principal);
    common::zed_relationship(&e, "touch", &tenant, "admin", &admin);

    let outcome = std::panic::AssertUnwindSafe(scenarios(&http, &e, &pool, &fx, &member));
    let result = futures_util::FutureExt::catch_unwind(outcome).await;

    // 清理：admin 关系撤回、夹具拆除——无论场景成败
    common::zed_relationship(&e, "delete", &tenant, "admin", &admin);
    common::teardown_live_workspace(&e, &pool, &fx).await;
    common::teardown_members(&pool, &fx, &[&member]).await;
    if let Err(panic) = result {
        std::panic::resume_unwind(panic);
    }
}

async fn pubkey_of(e: &Env, pool: &PgPool, principal: Uuid) -> String {
    until(e, "HUMAN 公钥 ACTIVE", || async {
        sqlx::query_scalar::<_, String>(
            "select pubkey from identity.buzz_identity_binding
             where principal_id = $1 and kind = 'HUMAN' and state = 'ACTIVE'
             order by created_at limit 1",
        )
        .bind(principal)
        .fetch_optional(pool)
        .await
        .expect("读 HUMAN 公钥")
    })
    .await
}

fn command(key: &str, member: Value) -> Value {
    json!({"actionKey": key, "idempotencyKey": Uuid::new_v4(), "explicitConfirmation": true,
        "moderationMember": member})
}

async fn get(http: &reqwest::Client, e: &Env, subject: &str, path: &str) -> (StatusCode, Value) {
    bff(http, e, subject, Method::GET, path, None).await
}

fn lists(page: &Value, pubkey: &str) -> Option<Value> {
    let items = page["items"].as_array()?;
    items.iter().find(|row| row["pubkey"] == json!(pubkey)).cloned()
}

async fn scenarios(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    fx: &LiveWorkspace,
    member: &LiveMember,
) {
    let admin_key = pubkey_of(e, pool, fx.principal).await;
    let member_key = pubkey_of(e, pool, member.principal).await;

    // ---- 1. 入口提示只对 Tenant manage（原版只对 Community owner/admin 显示）----
    let (st, body) = get(http, e, &fx.subject, "/api/v1/moderation/access").await;
    assert_eq!(st, StatusCode::OK, "{body}");
    assert_eq!(body["canModerate"], json!(true));
    let (st, body) = get(http, e, &member.subject, "/api/v1/moderation/access").await;
    assert_eq!(st, StatusCode::OK, "{body}");
    assert_eq!(body["canModerate"], json!(false));

    // ---- 2. 成员读不到限制列表（V-SCN-129）----
    let (st, body) = get(http, e, &member.subject, "/api/v1/moderation/restricted").await;
    assert_eq!(st, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(reason(&body), "PERMISSION_DENIED");

    // ---- 3. 非 admin 封禁、admin 封禁本人：PERMISSION_DENIED（V-SCN-128）----
    let ban = command("moderation.ban", json!({"targetPubkey": admin_key}));
    let (st, body) = submit(http, e, &member.subject, ban).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(reason(&body), "PERMISSION_DENIED");
    let denied: i64 = sqlx::query_scalar(
        "select count(*) from admission.action_execution
         where tenant_id = $1 and action_key = 'moderation.ban' and gate_state = 'DENIED'",
    )
    .bind(fx.tenant)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(denied, 1, "拒绝的准入也留下 ActionExecution");
    let own = command("moderation.ban", json!({"targetPubkey": admin_key}));
    let (st, body) = submit(http, e, &fx.subject, own).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(reason(&body), "PERMISSION_DENIED");
    let unknown = command("moderation.ban", json!({"targetPubkey": "f".repeat(64)}));
    let (st, body) = submit(http, e, &fx.subject, unknown).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(reason(&body), "TARGET_NOT_FOUND");
    let untimed = command("moderation.timeout", json!({"targetPubkey": member_key}));
    let (st, body) = submit(http, e, &fx.subject, untimed).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(reason(&body), "INVALID_PARAMETERS");

    // ---- 4. admin 禁言成员 1 小时：CONTROL 签 9042，回读一致才 DISPATCHED（V-SCN-127）----
    let key = Uuid::new_v4();
    let target = json!({"targetPubkey": member_key, "timeoutDuration": "ONE_HOUR"});
    let timeout = json!({"actionKey": "moderation.timeout", "idempotencyKey": key,
        "explicitConfirmation": true, "moderationMember": target});
    let (st, body) = submit(http, e, &fx.subject, timeout.clone()).await;
    assert_eq!(st, StatusCode::OK, "{body}");
    assert_eq!(body["dispatchState"], json!("DISPATCHED"));
    // 同一键重放只回答原 operation；同键异参即 IDEMPOTENCY_KEY_REUSED
    let (st, again) = submit(http, e, &fx.subject, timeout.clone()).await;
    assert_eq!(st, StatusCode::OK, "{again}");
    assert_eq!(again["operationId"], body["operationId"]);
    let mut changed = timeout;
    changed["moderationMember"]["timeoutDuration"] = json!("ONE_DAY");
    let (st, body) = submit(http, e, &fx.subject, changed).await;
    assert_eq!(st, StatusCode::CONFLICT, "{body}");
    assert_eq!(reason(&body), "IDEMPOTENCY_KEY_REUSED");
    let (st, page) = get(http, e, &fx.subject, "/api/v1/moderation/restricted").await;
    assert_eq!(st, StatusCode::OK, "{page}");
    let row = lists(&page, &member_key).expect("禁言经 Relay 限制列表回读");
    assert_eq!(row["principalId"], json!(member.principal.to_string()));
    assert!(row["mutedUntil"].is_string(), "{row}");

    // ---- 5. 解除禁言：回读不再列出 ----
    let lift = command("moderation.untimeout", json!({"targetPubkey": member_key}));
    let (st, body) = submit(http, e, &fx.subject, lift).await;
    assert_eq!(st, StatusCode::OK, "{body}");
    assert_eq!(body["dispatchState"], json!("DISPATCHED"));
    let (st, page) = get(http, e, &fx.subject, "/api/v1/moderation/restricted").await;
    assert_eq!(st, StatusCode::OK, "{page}");
    assert!(lists(&page, &member_key).is_none(), "{page}");

    // ---- 6. 每次审核读取都是受审计的敏感读取 ----
    let reads: i64 = sqlx::query_scalar(
        "select count(*) from audit.audit_event
         where tenant_id = $1 and event_type = 'ACCESS'
           and action_key = 'moderation.restricted.read'",
    )
    .bind(fx.tenant)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(reads, 2, "两次成功读取各一条 ACCESS，被拒的读取不读 Relay");
}
