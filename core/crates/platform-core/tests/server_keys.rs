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

use collab_bridge::bridge::{Custody, IdentityClient};
use futures_util::FutureExt;
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
        .header("x-platform-oidc-issuer", &e.oidc_issuer)
        .header("x-platform-oidc-subject", &fx.subject)
        .header("idempotency-key", Uuid::new_v4().to_string())
        .json(&serde_json::json!({ "content": content }))
        .send()
        .await
        .expect("调 BFF");
    let status = resp.status();
    (status, resp.json().await.unwrap_or(serde_json::Value::Null))
}

/// 已准入的 ActionExecution。发起方须按动作语义给出：建钥是授予可签名身份，
/// Core 在写入 OpenBao 前后都要求发起方仍是同 Tenant 的 ACTIVE 成员，因此由本人发起；
/// 撤销是收回，只做通用准入。
async fn seed_action(
    pool: &PgPool,
    fx: &common::LiveWorkspace,
    initiator: Uuid,
    target: Uuid,
    action_key: &str,
) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        "insert into admission.action_execution
             (id, operation_id, tenant_id, action_key, action_version,
              initiator_principal_id, actor_principal_id, target_id, parameter_hash,
              gate_state, dispatch_state, correlation_id)
         values ($1, gen_random_uuid(), $2, $5, 1, $3, $3, $4, 'verify',
                 'ALLOWED', 'NOT_DISPATCHED', gen_random_uuid())",
    )
    .bind(id)
    .bind(fx.tenant)
    .bind(initiator)
    .bind(target)
    .bind(action_key)
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

/// 以核验 root 凭据只读 Tenant namespace 内某 locator 的 KV metadata。
async fn tenant_kv_metadata(
    http: &reqwest::Client,
    e: &Env,
    tenant: Uuid,
    locator: &str,
) -> serde_json::Value {
    let b = bao(tenant);
    let path = locator
        .strip_prefix(&format!("{}/{}/", b.child, e.bao_mount))
        .expect("locator 属于该 Tenant KV");
    kv_metadata(http, e, &b, path).await
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
    let initial: (String, bool) = sqlx::query_as(
        "select target_locator, finished_at is not null
         from admission.server_key_provision_intent
         where tenant_id = $1 and principal_id = $2
           and source_membership_id is not null",
    )
    .bind(fx.tenant)
    .bind(fx.principal)
    .fetch_one(pool)
    .await
    .expect("初建 HUMAN 必须在写 OpenBao 前冻结成员 Workflow 意图");
    assert_eq!(initial.0, locator);
    assert!(initial.1, "初建 binding 与意图须原子收敛");
    assert_eq!(old_version, 1, "初建 HUMAN 只接受 KV 版本 1");
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
    // CONTROL 经 Tenant 建立查证 ACTIVE 时，其绑定版本引用同句转 ACTIVE；夹具
    // HUMAN 经成员投影 ACTIVE 时同理（`.design/03` SecretRef 状态机）。
    let statuses: Vec<(String, Option<String>)> = sqlx::query_as(
        "select kind, private_key_secret_status from identity.buzz_identity_binding
         where tenant_id = $1 and custody = 'SERVER' and state = 'ACTIVE' order by kind",
    )
    .bind(fx.tenant)
    .fetch_all(pool)
    .await
    .expect("SERVER 身份的引用状态");
    assert_eq!(
        statuses,
        vec![
            ("CONTROL".to_owned(), Some("ACTIVE".to_owned())),
            ("HUMAN".to_owned(), Some("ACTIVE".to_owned())),
        ],
        "ACTIVE 身份的私钥引用不能停在 PENDING"
    );

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

    let a = seed_action(
        pool,
        fx,
        fx.initiator,
        control_principal,
        "identity.key_revoke",
    )
    .await;
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
    let a = seed_action(
        pool,
        fx,
        fx.principal,
        fx.principal,
        "identity.key_provision",
    )
    .await;
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
    let wrong = seed_action(pool, fx, fx.initiator, fx.workspace, "identity.key_revoke").await;
    let (status, _) = call(
        http,
        e,
        token,
        "/service/v1/identities/server-keys/revoke",
        serde_json::json!({ "pubkey": old, "actionExecutionId": wrong }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::FORBIDDEN);

    // 已准入但语义不同的动作也不能借来撤销 Web 托管身份。
    let wrong_action = seed_action(
        pool,
        fx,
        fx.principal,
        fx.principal,
        "identity.key_provision",
    )
    .await;
    let (status, _) = call(
        http,
        e,
        token,
        "/service/v1/identities/server-keys/revoke",
        serde_json::json!({ "pubkey": old, "actionExecutionId": wrong_action }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::FORBIDDEN);
    assert_eq!(wait_binding(pool, &old, "ACTIVE", 0).await, "ACTIVE");

    // ---- revoke ----
    let stream = http
        .get(format!(
            "{}/api/v1/workspaces/{}/stream",
            e.bff_url, fx.workspace
        ))
        .header("x-platform-oidc-issuer", &e.oidc_issuer)
        .header("x-platform-oidc-subject", &fx.subject)
        .send()
        .await
        .expect("开流");
    assert!(stream.status().is_success(), "流应开得起来");
    let mut stream = stream.bytes_stream();

    // 撤钥会按 DD-113 删除并销毁旧版本：持钥者的旧私钥在撤钥前取出。
    let old_secret = common::read_secret_version(http, e, fx.tenant, &locator, old_version).await;
    let revoke = seed_action(pool, fx, fx.initiator, fx.principal, "identity.key_revoke").await;
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
    common::until(e, "撤钥 Workflow 终态", || async {
        let state: Option<String> = sqlx::query_scalar(
            "select projection_state from projection.workflow_ref where workflow_id = $1",
        )
        .bind(body["workflowId"].as_str().unwrap())
        .fetch_optional(pool)
        .await
        .unwrap();
        (state.as_deref() == Some("TERMINAL")).then_some(())
    })
    .await;
    let (status, completed_retry) = call(
        http,
        e,
        token,
        "/service/v1/identities/server-keys/revoke",
        serde_json::json!({ "pubkey": old, "actionExecutionId": revoke }),
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::OK,
        "终态重发只交回引用：{completed_retry}"
    );
    assert_eq!(completed_retry["workflowId"], body["workflowId"]);
    assert!(completed_retry["runId"].is_null(), "终态重发不新建 run");
    // DD-113 (3)：REVOKING 时 delete、REVOKED 后 destroy，metadata 查证后意图
    // RETIRED、引用 REVOKED，审计追加到撤钥 operation。
    common::until(e, "撤钥旧版本退役", || async {
        let status: Option<String> = sqlx::query_scalar(
            "select private_key_secret_status from identity.buzz_identity_binding
             where pubkey = $1",
        )
        .bind(&old)
        .fetch_one(pool)
        .await
        .unwrap();
        (status.as_deref() == Some("REVOKED")).then_some(())
    })
    .await;
    let retired: bool = sqlx::query_scalar(
        "select retired_at is not null from admission.server_key_provision_intent
         where target_locator = $1 and key_kind = 'HUMAN'",
    )
    .bind(&locator)
    .fetch_one(pool)
    .await
    .expect("旧 locator 的写入意图");
    assert!(retired, "旧版本销毁查证后意图须 RETIRED");
    let metadata = tenant_kv_metadata(http, e, fx.tenant, &locator).await;
    assert_eq!(metadata["data"]["current_version"], 1);
    assert_eq!(
        metadata.pointer("/data/versions/1/destroyed"),
        Some(&serde_json::Value::Bool(true)),
        "REVOKED 后旧版本须已 destroy"
    );
    assert_ne!(
        metadata.pointer("/data/versions/1/deletion_time"),
        Some(&serde_json::Value::String(String::new())),
        "REVOKING 时须先 delete"
    );
    let revoke_operation: Uuid =
        sqlx::query_scalar("select operation_id from admission.action_execution where id = $1")
            .bind(revoke)
            .fetch_one(pool)
            .await
            .expect("撤钥 operation");
    let retired_audits: i64 = sqlx::query_scalar(
        "select count(*) from audit.audit_event
         where operation_id = $1 and event_key like '%:platform-key-retired:%'
           and result_code = 'RETIRED'",
    )
    .bind(revoke_operation)
    .fetch_one(pool)
    .await
    .expect("退役审计");
    assert_eq!(retired_audits, 1, "退役审计追加到撤钥 operation 且只有一条");

    // 持有旧私钥的人直连 Relay：该 pubkey 已不在 roster 上
    let (host, channel) = common::live_scope(pool, fx).await;
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
        Err(collab_bridge::operator::OperatorError::Rejected { .. }) => true,
        Err(_) => false,
    };
    assert!(
        refused,
        "revoke 后旧 pubkey 直连发布必须被拒：{published:?}"
    );

    // ---- 重建 ----
    let wrong_action =
        seed_action(pool, fx, fx.initiator, fx.principal, "identity.key_revoke").await;
    let (status, _) = call(
        http,
        e,
        token,
        "/service/v1/identities/server-keys/provision",
        serde_json::json!({ "principalId": fx.principal, "actionExecutionId": wrong_action }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::FORBIDDEN);
    let untracked = seed_action(
        pool,
        fx,
        fx.principal,
        fx.principal,
        "identity.key_provision",
    )
    .await;
    sqlx::query("update admission.action_execution set dispatch_state = 'UNKNOWN' where id = $1")
        .bind(untracked)
        .execute(pool)
        .await
        .expect("模拟旧版结果不明但无固定 WorkflowRef 的动作");
    let (status, _) = call(
        http,
        e,
        token,
        "/service/v1/identities/server-keys/provision",
        serde_json::json!({ "principalId": fx.principal, "actionExecutionId": untracked }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::CONFLICT);
    let untracked_intents: i64 = sqlx::query_scalar(
        "select count(*) from admission.server_key_provision_intent where action_execution_id = $1",
    )
    .bind(untracked)
    .fetch_one(pool)
    .await
    .expect("结果不明动作的意图行数");
    assert_eq!(untracked_intents, 0, "无固定证据时不得补造写入意图");
    // 建钥是授予：发起方不是本 Tenant 的 ACTIVE 成员时，写 OpenBao 前即拒绝且不留意图
    let outsider = seed_action(
        pool,
        fx,
        fx.initiator,
        fx.principal,
        "identity.key_provision",
    )
    .await;
    let (status, _) = call(
        http,
        e,
        token,
        "/service/v1/identities/server-keys/provision",
        serde_json::json!({ "principalId": fx.principal, "actionExecutionId": outsider }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::CONFLICT);
    let outsider_intents: i64 = sqlx::query_scalar(
        "select count(*) from admission.server_key_provision_intent where action_execution_id = $1",
    )
    .bind(outsider)
    .fetch_one(pool)
    .await
    .expect("非成员发起的建钥意图行数");
    assert_eq!(outsider_intents, 0, "非成员发起的建钥不得落写入意图");
    let provision = seed_action(
        pool,
        fx,
        fx.principal,
        fx.principal,
        "identity.key_provision",
    )
    .await;
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
    assert!(new_locator.ends_with(&format!("/buzz-human/provision/{provision}")));
    assert_eq!(new_version, 1, "一次重建只接受 KV 版本 1");
    assert!(old_version > 0, "旧 binding 必须钉住具体版本");
    let intent: (String, bool) = sqlx::query_as(
        "select target_locator, finished_at is not null
         from admission.server_key_provision_intent where action_execution_id = $1",
    )
    .bind(provision)
    .fetch_one(pool)
    .await
    .expect("重建意图须先于 OpenBao 写入落库");
    assert_eq!(intent.0, new_locator);
    assert!(intent.1, "WorkflowRef 与 binding 提交后意图须收敛");
    let written_key =
        common::read_secret_version(http, e, fx.tenant, &new_locator, new_version).await;
    assert_eq!(
        nostr::Keys::parse(&written_key)
            .expect("钉定的私钥可解析")
            .public_key()
            .to_hex(),
        new,
        "binding pubkey 必须从写入后读回的私钥推导"
    );
    assert_eq!(
        wait_binding(pool, &new, "ACTIVE", e.converge_bound_secs).await,
        "ACTIVE"
    );
    common::until(e, "重建 Workflow 终态", || async {
        let state: Option<String> = sqlx::query_scalar(
            "select projection_state from projection.workflow_ref where workflow_id = $1",
        )
        .bind(body["workflowId"].as_str().unwrap())
        .fetch_optional(pool)
        .await
        .unwrap();
        (state.as_deref() == Some("TERMINAL")).then_some(())
    })
    .await;
    let (status, completed_retry) = call(
        http,
        e,
        token,
        "/service/v1/identities/server-keys/provision",
        serde_json::json!({ "principalId": fx.principal, "actionExecutionId": provision }),
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::OK,
        "终态重发只交回引用：{completed_retry}"
    );
    assert_eq!(completed_retry["workflowId"], body["workflowId"]);
    assert!(completed_retry["runId"].is_null(), "终态重发不新建 run");
    let provision_workflow_id = body["workflowId"].clone();

    let (status, body) = bff_publish(http, e, fx, "after rotation").await;
    assert_eq!(status, reqwest::StatusCode::OK, "重建后应恢复发言：{body}");
    let event_id = body["eventId"].as_str().expect("eventId").to_owned();
    let history: serde_json::Value = http
        .get(format!(
            "{}/api/v1/workspaces/{}/messages",
            e.bff_url, fx.workspace
        ))
        .header("x-platform-oidc-issuer", &e.oidc_issuer)
        .header("x-platform-oidc-subject", &fx.subject)
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
         where tenant_id = $1 and target_id = $2
           and action_key in ('identity.key_revoke', 'identity.key_provision')
           and result_code in ('REVOKING', 'RECONCILING')",
    )
    .bind(fx.tenant)
    .bind(fx.principal)
    .fetch_one(pool)
    .await
    .expect("读审计");
    assert_eq!(audited, 2, "revoke 与重建各一条，重发不复制");

    // 模拟升级前已经原子保存 binding + WorkflowRef、却仍为 NOT_DISPATCHED 的
    // 历史 Action。新版本只能恢复原引用，不能为同一准入另写私钥或意图。
    sqlx::query("delete from admission.server_key_provision_intent where action_execution_id = $1")
        .bind(provision)
        .execute(pool)
        .await
        .expect("移除测试夹具的新式意图以模拟旧版数据");
    sqlx::query(
        "update admission.action_execution set dispatch_state = 'NOT_DISPATCHED',
                reason_code = null where id = $1",
    )
    .bind(provision)
    .execute(pool)
    .await
    .expect("冻结旧版未派发状态");
    let (status, legacy_retry) = call(
        http,
        e,
        token,
        "/service/v1/identities/server-keys/provision",
        serde_json::json!({ "principalId": fx.principal, "actionExecutionId": provision }),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK, "旧版同键重发应恢复原引用");
    assert_eq!(legacy_retry["workflowId"], provision_workflow_id);
    assert!(
        legacy_retry["runId"].is_null(),
        "旧版已终态 Workflow 不重启"
    );
    let dispatch: String =
        sqlx::query_scalar("select dispatch_state from admission.action_execution where id = $1")
            .bind(provision)
            .fetch_one(pool)
            .await
            .expect("读取旧版 Action 派发状态");
    assert_eq!(dispatch, "DISPATCHED");
    let new_intents: i64 = sqlx::query_scalar(
        "select count(*) from admission.server_key_provision_intent where action_execution_id = $1",
    )
    .bind(provision)
    .fetch_one(pool)
    .await
    .expect("读取意图行数");
    assert_eq!(new_intents, 0, "旧版恢复不得补造新的 OpenBao 写入意图");
}

// ---- V-SCN-70 / DD-86：写入 OpenBao 之后、binding 提交之前的故障 ----
//
// 夹具只构造「写入意图已冻结、外部写入已发生或在途」这一刻的持久事实：
// ActionExecution 停在 ALLOWED/UNKNOWN、意图行冻结确定 locator，KV 由核验
// root 凭据在该 Tenant namespace 以 `cas=0` 写入版本 1。随后改变撤权、暂停或
// 竞争 binding 的事实，把意图的 created_at 推过准入对账上界，交给 Core 既有的
// 治理对账器收敛；测试本身不调用任何 fence/destroy 入口。

struct Bao {
    child: String,
    root: String,
}

fn bao(tenant: Uuid) -> Bao {
    let parent = std::env::var("OPENBAO_TENANT_PARENT_NAMESPACE").expect("Tenant namespace 根");
    let credentials = std::fs::read_to_string(
        std::env::var("VERIFY_OPENBAO_ROOT_TOKEN_FILE").expect("核验凭据路径"),
    )
    .expect("读取核验凭据");
    let credentials: serde_json::Value = serde_json::from_str(&credentials).expect("解析核验凭据");
    Bao {
        child: format!("{parent}/{tenant}"),
        root: credentials["root_token"]
            .as_str()
            .expect("核验 root token")
            .to_owned(),
    }
}

async fn kv_put(
    http: &reqwest::Client,
    e: &Env,
    b: &Bao,
    path: &str,
    value: &str,
    cas: u32,
) -> reqwest::StatusCode {
    http.post(format!("{}/v1/{}/data/{path}", e.bao_addr, e.bao_mount))
        .header("X-Vault-Namespace", &b.child)
        .header("X-Vault-Token", &b.root)
        .json(&serde_json::json!({"data": {"value": value}, "options": {"cas": cas}}))
        .send()
        .await
        .expect("写 Tenant KV")
        .status()
}

async fn kv_metadata(http: &reqwest::Client, e: &Env, b: &Bao, path: &str) -> serde_json::Value {
    http.get(format!("{}/v1/{}/metadata/{path}", e.bao_addr, e.bao_mount))
        .header("X-Vault-Namespace", &b.child)
        .header("X-Vault-Token", &b.root)
        .send()
        .await
        .expect("读 KV metadata")
        .error_for_status()
        .expect("KV metadata 可读")
        .json()
        .await
        .expect("解析 KV metadata")
}

/// 新 HUMAN Principal 与给定状态的 TenantMembership，不经成员 Workflow：
/// `ACTIVE`/`REVOKED` 都不是任何对账器的收敛起点，夹具不会被旁路推进。
async fn orphan_principal(
    pool: &PgPool,
    fx: &common::LiveWorkspace,
    state: &str,
) -> common::LiveMember {
    let m = common::LiveMember {
        principal: Uuid::new_v4(),
        human: Uuid::new_v4(),
        subject: String::new(),
        membership: Uuid::new_v4(),
    };
    sqlx::query("insert into identity.human_identity (id, display_name, status) values ($1,'verify','ACTIVE')")
        .bind(m.human)
        .execute(pool)
        .await
        .expect("夹具 HumanIdentity");
    sqlx::query("insert into identity.principal (id, tenant_id, kind, status) values ($1,$2,'HUMAN','ACTIVE')")
        .bind(m.principal)
        .bind(fx.tenant)
        .execute(pool)
        .await
        .expect("夹具 Principal");
    sqlx::query(
        "insert into identity.tenant_membership (id, tenant_id, human_identity_id, tenant_principal_id, state)
         values ($1,$2,$3,$4,$5)",
    )
    .bind(m.membership)
    .bind(fx.tenant)
    .bind(m.human)
    .bind(m.principal)
    .bind(state)
    .execute(pool)
    .await
    .expect("夹具 TenantMembership");
    m
}

struct Orphan {
    action: Uuid,
    operation: Uuid,
    path: String,
    locator: String,
}

/// 与 `server_keys::prewrite_secret_intent` 提交后的持久事实同形：UNKNOWN 与
/// 意图同在，locator 由 ActionExecution ID 唯一确定。
async fn orphan_intent(
    pool: &PgPool,
    e: &Env,
    fx: &common::LiveWorkspace,
    b: &Bao,
    principal: Uuid,
) -> Orphan {
    let action = Uuid::new_v4();
    let operation = Uuid::new_v4();
    let path = format!("buzz-human/provision/{action}");
    let locator = format!("{}/{}/{path}", b.child, e.bao_mount);
    let mut tx = pool.begin().await.expect("意图夹具事务");
    sqlx::query(
        "insert into admission.action_execution
             (id, operation_id, tenant_id, action_key, action_version,
              initiator_principal_id, actor_principal_id, target_id, parameter_hash,
              gate_state, dispatch_state, reason_code, correlation_id)
         values ($1,$2,$3,'identity.key_provision',1,$4,$4,$4,'verify-orphan',
                 'ALLOWED','UNKNOWN','EXTERNAL_RESULT_UNKNOWN',gen_random_uuid())",
    )
    .bind(action)
    .bind(operation)
    .bind(fx.tenant)
    .bind(principal)
    .execute(&mut *tx)
    .await
    .expect("夹具 ActionExecution");
    sqlx::query(
        "insert into admission.server_key_provision_intent
             (action_execution_id, key_kind, origin, operation_id, tenant_id, principal_id,
              target_locator)
         values ($1,'HUMAN','PROVISIONED',$5,$2,$3,$4)",
    )
    .bind(action)
    .bind(fx.tenant)
    .bind(principal)
    .bind(&locator)
    .bind(operation)
    .execute(&mut *tx)
    .await
    .expect("夹具写入意图");
    tx.commit().await.expect("提交意图夹具");
    Orphan {
        action,
        operation,
        path,
        locator,
    }
}

async fn make_overdue(pool: &PgPool, actions: &[Uuid]) {
    let stale_after: i64 = std::env::var("ADMISSION_EVALUATION_TIMEOUT_SECONDS")
        .expect("准入对账超时配置")
        .parse()
        .expect("准入对账超时须为秒数");
    let moved = sqlx::query(
        "update admission.server_key_provision_intent
         set created_at = now() - make_interval(secs => $2::bigint)
         where action_execution_id = any($1)",
    )
    .bind(actions)
    .bind(stale_after.checked_add(1).expect("对账超时上界"))
    .execute(pool)
    .await
    .expect("把意图推过准入对账上界");
    assert_eq!(moved.rows_affected(), actions.len() as u64);
}

/// 对账器按部署登记的间隔与批量轮转选批（公平轮转，`governance_reconcile`）。
/// 等待上界由此刻仍开放的托管身份意图数推导：每条意图至少再被选中两轮。
async fn reconcile_bound(e: &Env, pool: &PgPool) -> std::time::Duration {
    let setting = |name: &str| -> u64 {
        std::env::var(name)
            .unwrap_or_else(|_| panic!("缺少 {name}"))
            .parse()
            .unwrap_or_else(|_| panic!("{name} 须为正整数"))
    };
    let interval = setting("GOVERNANCE_RECONCILE_INTERVAL_SECONDS");
    let batch = setting("GOVERNANCE_RECONCILE_BATCH").max(1);
    let open: i64 = sqlx::query_scalar(
        "select count(*) from admission.server_key_provision_intent
         where finished_at is null and source_membership_id is null",
    )
    .fetch_one(pool)
    .await
    .expect("统计开放意图");
    let rounds = 2 * (u64::try_from(open).unwrap_or(0).div_ceil(batch) + 1);
    std::time::Duration::from_secs(e.converge_bound_secs.max(interval * rounds + 20))
}

type IntentState = (bool, bool, bool);

async fn intent_state(pool: &PgPool, action: Uuid) -> IntentState {
    sqlx::query_as(
        "select fenced_at is not null, destroyed_at is not null, finished_at is not null
         from admission.server_key_provision_intent where action_execution_id = $1",
    )
    .bind(action)
    .fetch_one(pool)
    .await
    .expect("读写入意图")
}

async fn wait_destroyed(e: &Env, pool: &PgPool, o: &Orphan, why: &str) {
    let deadline = std::time::Instant::now() + reconcile_bound(e, pool).await;
    loop {
        let state = intent_state(pool, o.action).await;
        if state == (true, true, true) {
            return;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "{why}: 意图未收敛为 DESTROYED，(fenced, destroyed, finished)={state:?}"
        );
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    }
}

/// 等对账器对该意图完成至少一整轮：选批时写入的尝试时间变化两次，说明第一次
/// 选中后的处理已经结束（同一 Core 的选批按轮串行）。
async fn wait_two_attempts(e: &Env, pool: &PgPool, action: Uuid) {
    let attempt = || async {
        sqlx::query_scalar::<_, Option<chrono::DateTime<chrono::Utc>>>(
            "select reconcile_last_attempt_at from admission.server_key_provision_intent
             where action_execution_id = $1",
        )
        .bind(action)
        .fetch_one(pool)
        .await
        .expect("读对账尝试时间")
    };
    let deadline = std::time::Instant::now() + reconcile_bound(e, pool).await;
    let mut seen = Vec::new();
    while seen.len() < 2 {
        if let Some(at) = attempt().await {
            if seen.last() != Some(&at) {
                seen.push(at);
            }
        }
        assert!(
            std::time::Instant::now() < deadline,
            "对账器未在上界内两次选中意图 {action}"
        );
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    }
}

async fn assert_destroyed(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    b: &Bao,
    o: &Orphan,
    why: &str,
) {
    let metadata = kv_metadata(http, e, b, &o.path).await;
    assert_eq!(
        metadata["data"]["current_version"], 1,
        "{why}: 只能有版本 1"
    );
    assert_eq!(
        metadata.pointer("/data/versions/1/destroyed"),
        Some(&serde_json::Value::Bool(true)),
        "{why}: metadata 须查证版本 1 已销毁"
    );
    let referenced: i64 = sqlx::query_scalar(
        "select count(*) from identity.buzz_identity_binding where private_key_secret_ref = $1",
    )
    .bind(&o.locator)
    .fetch_one(pool)
    .await
    .expect("读 binding 引用");
    assert_eq!(referenced, 0, "{why}: 已销毁的写入不得形成 binding");
    let (dispatch, reason): (String, Option<String>) = sqlx::query_as(
        "select dispatch_state, reason_code from admission.action_execution where id = $1",
    )
    .bind(o.action)
    .fetch_one(pool)
    .await
    .expect("读原动作");
    assert_eq!(
        (dispatch.as_str(), reason.as_deref()),
        ("ABORTED", Some("TARGET_STATE_CONFLICT")),
        "{why}: 托管身份建钥动作以确定冲突终结"
    );
    let audits: Vec<(String, String, String, String, Uuid)> = sqlx::query_as(
        "select event_type, result_code, component_type_key, target_type, target_id
         from audit.audit_event where operation_id = $1 and event_key = $2",
    )
    .bind(o.operation)
    .bind(format!("{}:server-human-orphan-destroyed", o.operation))
    .fetch_all(pool)
    .await
    .expect("读对账审计");
    assert_eq!(
        audits.len(),
        1,
        "{why}: 原 operation 追加且只追加一条对账审计"
    );
    let (event_type, result, component, target_type, _) = &audits[0];
    assert_eq!(
        (
            event_type.as_str(),
            result.as_str(),
            component.as_str(),
            target_type.as_str()
        ),
        ("RECONCILIATION", "DESTROYED", "buzz", "PRINCIPAL"),
        "{why}"
    );
}

#[tokio::test]
async fn orphan_provision_intents_are_fenced_destroyed_and_audited() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;
    let fx = match common::provision_live_workspace(&http, &e, &pool, &token).await {
        Ok(f) => f,
        Err(msg) => panic!("准备真实 Workspace 失败: {msg}"),
    };
    let mut members = Vec::new();
    let outcome = std::panic::AssertUnwindSafe(run_orphans(&http, &e, &pool, &fx, &mut members))
        .catch_unwind()
        .await;
    // 暂停场景失败时也先把夹具 Tenant 恢复为可拆除的 ACTIVE
    let _ = sqlx::query(
        "update identity.tenant set state = 'ACTIVE' where id = $1 and state = 'SUSPENDED'",
    )
    .bind(fx.tenant)
    .execute(&pool)
    .await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    let refs: Vec<&common::LiveMember> = members.iter().collect();
    common::teardown_members(&pool, &fx, &refs).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn run_orphans(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    fx: &common::LiveWorkspace,
    members: &mut Vec<common::LiveMember>,
) {
    let b = bao(fx.tenant);
    let key = || nostr::Keys::generate().secret_key().to_secret_hex();

    // 1. Tenant 暂停：成员仍 ACTIVE、没有其他 binding，只有 Tenant 状态变了。
    let suspended = orphan_principal(pool, fx, "ACTIVE").await;
    let paused = orphan_intent(pool, e, fx, &b, suspended.principal).await;
    members.push(suspended);
    assert!(kv_put(http, e, &b, &paused.path, &key(), 0)
        .await
        .is_success());
    sqlx::query(
        "update identity.tenant set state = 'SUSPENDED' where id = $1 and state = 'ACTIVE'",
    )
    .bind(fx.tenant)
    .execute(pool)
    .await
    .expect("写入后 Tenant 被暂停");
    make_overdue(pool, &[paused.action]).await;
    wait_destroyed(e, pool, &paused, "tenant-suspended").await;
    let restored = sqlx::query(
        "update identity.tenant set state = 'ACTIVE' where id = $1 and state = 'SUSPENDED'",
    )
    .bind(fx.tenant)
    .execute(pool)
    .await
    .expect("恢复夹具 Tenant");
    assert_eq!(restored.rows_affected(), 1);
    assert_destroyed(http, e, pool, &b, &paused, "tenant-suspended").await;

    // 2. 成员撤权：写入已落盘（响应是否到达写入方无关）后 TenantMembership 撤销。
    let revoked = orphan_principal(pool, fx, "REVOKED").await;
    let landed = orphan_intent(pool, e, fx, &b, revoked.principal).await;
    assert!(kv_put(http, e, &b, &landed.path, &key(), 0)
        .await
        .is_success());
    // 3. 竞争：原写入仍在途，fence 的 CAS 先争到版本 1；之后到达的原写入必须失败。
    // 同一 Principal 未终结意图唯一，故另建一位撤权成员；它没有任何 KV 写入。
    let racer = orphan_principal(pool, fx, "REVOKED").await;
    let raced = orphan_intent(pool, e, fx, &b, racer.principal).await;
    members.push(racer);
    // 4. 另一 binding 胜出：夹具 HUMAN 已有经成员 Workflow 建立的 ACTIVE SERVER 身份。
    let (winner, winner_ref): (String, String) = sqlx::query_as(
        "select pubkey, private_key_secret_ref from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2 and kind = 'HUMAN'
           and custody = 'SERVER' and state = 'ACTIVE'",
    )
    .bind(fx.tenant)
    .bind(fx.principal)
    .fetch_one(pool)
    .await
    .expect("夹具已有的 SERVER 身份");
    let beaten = orphan_intent(pool, e, fx, &b, fx.principal).await;
    assert!(kv_put(http, e, &b, &beaten.path, &key(), 0)
        .await
        .is_success());
    // 反例 5：钉定 locator 已被 binding 引用时不得 fence 或销毁。
    let bound_principal = orphan_principal(pool, fx, "REVOKED").await;
    let bound = orphan_intent(pool, e, fx, &b, bound_principal.principal).await;
    let bound_key = nostr::Keys::generate();
    assert!(kv_put(
        http,
        e,
        &b,
        &bound.path,
        &bound_key.secret_key().to_secret_hex(),
        0
    )
    .await
    .is_success());
    sqlx::query(
        "insert into identity.buzz_identity_binding
             (tenant_id, principal_id, pubkey, custody, private_key_secret_ref,
              private_key_secret_version, private_key_secret_audience,
              private_key_secret_status, kind, state)
         values ($1,$2,$3,'SERVER',$4,1,$5,'SUPERSEDED','HUMAN','REVOKED')",
    )
    .bind(fx.tenant)
    .bind(bound_principal.principal)
    .bind(bound_key.public_key().to_hex())
    .bind(&bound.locator)
    .bind(&e.core_identity)
    .execute(pool)
    .await
    .expect("夹具：引用该 locator 的 binding");
    members.push(bound_principal);
    // 反例 6：metadata 版本大于 1 不是可终结的孤儿，保持 FENCED 不销毁。
    let multi_principal = orphan_principal(pool, fx, "REVOKED").await;
    let multi = orphan_intent(pool, e, fx, &b, multi_principal.principal).await;
    members.push(multi_principal);
    assert!(kv_put(http, e, &b, &multi.path, &key(), 0)
        .await
        .is_success());
    assert!(kv_put(http, e, &b, &multi.path, &key(), 1)
        .await
        .is_success());
    members.push(revoked);

    make_overdue(
        pool,
        &[
            landed.action,
            raced.action,
            beaten.action,
            bound.action,
            multi.action,
        ],
    )
    .await;
    wait_destroyed(e, pool, &landed, "member-revoked").await;
    assert_destroyed(http, e, pool, &b, &landed, "member-revoked").await;

    wait_destroyed(e, pool, &raced, "fence-wins").await;
    assert_destroyed(http, e, pool, &b, &raced, "fence-wins").await;
    assert_eq!(
        kv_put(http, e, &b, &raced.path, &key(), 0).await,
        reqwest::StatusCode::BAD_REQUEST,
        "fence 争到版本 1 后，迟到的原写入不能再以 cas=0 成功"
    );
    let metadata = kv_metadata(http, e, &b, &raced.path).await;
    assert_eq!(metadata["data"]["current_version"], 1, "迟到写入不追加版本");

    wait_destroyed(e, pool, &beaten, "binding-won").await;
    assert_destroyed(http, e, pool, &b, &beaten, "binding-won").await;
    let (state, locator): (String, String) = sqlx::query_as(
        "select state, private_key_secret_ref from identity.buzz_identity_binding where pubkey = $1",
    )
    .bind(&winner)
    .fetch_one(pool)
    .await
    .expect("胜出的 binding");
    assert_eq!(
        (state.as_str(), locator.as_str()),
        ("ACTIVE", winner_ref.as_str()),
        "清理孤儿不触碰胜出的身份"
    );

    wait_two_attempts(e, pool, bound.action).await;
    assert_eq!(
        intent_state(pool, bound.action).await,
        (false, false, false),
        "被 binding 引用的 locator 不 fence、不终结"
    );
    let metadata = kv_metadata(http, e, &b, &bound.path).await;
    assert_eq!(
        metadata.pointer("/data/versions/1/destroyed"),
        Some(&serde_json::Value::Bool(false)),
        "未查证 binding 引用前不得销毁"
    );

    wait_two_attempts(e, pool, multi.action).await;
    assert_eq!(
        intent_state(pool, multi.action).await,
        (true, false, false),
        "版本大于 1 时保持 FENCED"
    );
    let metadata = kv_metadata(http, e, &b, &multi.path).await;
    assert_eq!(metadata["data"]["current_version"], 2);
    for version in ["1", "2"] {
        assert_eq!(
            metadata.pointer(&format!("/data/versions/{version}/destroyed")),
            Some(&serde_json::Value::Bool(false)),
            "版本 {version} 不能被当作孤儿销毁"
        );
    }
    let dispatch: String =
        sqlx::query_scalar("select dispatch_state from admission.action_execution where id = $1")
            .bind(multi.action)
            .fetch_one(pool)
            .await
            .expect("读原动作");
    assert_eq!(dispatch, "UNKNOWN", "不能终结时原动作保持 UNKNOWN");
}

// ---- V-SCN-86 / DD-113：退役与孤儿写入的故障注入 ----
//
// 回应丢失由 `common::DropResponseProxy` 注入：请求真实送达本地 OpenBao 并被处理，
// 请求方只得到传输错误。部署中的 Core 不重启就不能改道经过代理，因此由测试代替
// Core 发出那次回应丢失的请求，随后只让真实 Core 按 locator 与 metadata 收敛。

#[allow(clippy::too_many_arguments)]
async fn lossy_kv(
    proxy: &common::DropResponseProxy,
    e: &Env,
    namespace: &str,
    root: &str,
    op: &str,
    path: &str,
    body: serde_json::Value,
    want: &str,
) {
    proxy
        .send_losing_response(
            common::lossy_client()
                .post(proxy.url(&format!("/v1/{}/{op}/{path}", e.bao_mount)))
                .header("X-Vault-Namespace", namespace)
                .header("X-Vault-Token", root)
                .json(&body),
            want,
        )
        .await;
}

/// 撤钥两段的回应丢失：`delete` 已生效而回应丢失、`delete` 与 `destroy` 都已生效
/// 而回应丢失。binding 以撤钥动作置 `REVOKING` 并预写固定 WorkflowRef（与
/// `server_keys::revoke_server_key` 提交后的持久事实同形），随后直接驱动身份投影
/// service API，不启动 Workflow，避免与注入竞争。
#[tokio::test]
async fn human_revoke_lost_responses_converge_by_metadata() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;
    let fx = match common::provision_live_workspace(&http, &e, &pool, &token).await {
        Ok(f) => f,
        Err(msg) => panic!("准备真实 Workspace 失败: {msg}"),
    };
    let mut members = Vec::new();
    let outcome =
        std::panic::AssertUnwindSafe(run_lost_revoke(&http, &e, &pool, &token, &fx, &mut members))
            .catch_unwind()
            .await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    let refs: Vec<&common::LiveMember> = members.iter().collect();
    common::teardown_members(&pool, &fx, &refs).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn run_lost_revoke(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    token: &str,
    fx: &common::LiveWorkspace,
    members: &mut Vec<common::LiveMember>,
) {
    let b = bao(fx.tenant);
    let proxy = common::DropResponseProxy::start(&e.bao_addr);
    let member = common::add_tenant_member(http, e, pool, token, fx)
        .await
        .expect("开通第二位 Tenant 成员");
    let second = member.principal;
    members.push(member);
    for (principal, inject_destroy) in [(fx.principal, false), (second, true)] {
        let (pubkey, locator, version): (String, String, i32) = sqlx::query_as(
            "select pubkey, private_key_secret_ref, version from identity.buzz_identity_binding
             where tenant_id = $1 and principal_id = $2 and kind = 'HUMAN'
               and custody = 'SERVER' and state = 'ACTIVE'",
        )
        .bind(fx.tenant)
        .bind(principal)
        .fetch_one(pool)
        .await
        .expect("成员的 SERVER 身份");
        let path = locator
            .strip_prefix(&format!("{}/{}/", b.child, e.bao_mount))
            .expect("独占 locator")
            .to_owned();
        let revoke = seed_action(pool, fx, fx.initiator, principal, "identity.key_revoke").await;
        let mut tx = pool.begin().await.expect("撤钥夹具事务");
        let revoking: i32 = sqlx::query_scalar(
            "update identity.buzz_identity_binding set state = 'REVOKING', version = version + 1
             where pubkey = $1 and version = $2 and state = 'ACTIVE' returning version",
        )
        .bind(&pubkey)
        .bind(version)
        .fetch_one(&mut *tx)
        .await
        .expect("停签");
        let workflow = format!(
            "platform:BUZZ_IDENTITY_PROJECTION:{}:{pubkey}:{revoking}",
            fx.tenant
        );
        sqlx::query(
            "insert into projection.workflow_ref
             (workflow_id, workflow_type, workflow_version, kind, tenant_id,
              operation_id, action_execution_id, projection_state)
             select $1, 'ComponentTaskWorkflow', 1, 'BUZZ_IDENTITY_PROJECTION', $2,
                    ae.operation_id, ae.id, 'PENDING_START'
             from admission.action_execution ae where ae.id = $3",
        )
        .bind(&workflow)
        .bind(fx.tenant)
        .bind(revoke)
        .execute(&mut *tx)
        .await
        .expect("撤钥 WorkflowRef");
        tx.commit().await.expect("提交撤钥夹具");

        lossy_kv(
            &proxy,
            e,
            &b.child,
            &b.root,
            "delete",
            &path,
            serde_json::json!({"versions": [1]}),
            "HTTP/1.1 204",
        )
        .await;
        if inject_destroy {
            lossy_kv(
                &proxy,
                e,
                &b.child,
                &b.root,
                "destroy",
                &path,
                serde_json::json!({"versions": [1]}),
                "HTTP/1.1 204",
            )
            .await;
        }
        let before = kv_metadata(http, e, &b, &path).await;
        assert_ne!(
            before.pointer("/data/versions/1/deletion_time"),
            Some(&serde_json::Value::String(String::new())),
            "回应丢失的 delete 已生效"
        );

        let deadline = std::time::Instant::now() + reconcile_bound(e, pool).await;
        loop {
            let (status, body) = call(
                http,
                e,
                token,
                "/service/v1/identity-projections/buzz",
                serde_json::json!({ "pubkey": pubkey, "bindingVersion": revoking }),
            )
            .await;
            if status == reqwest::StatusCode::OK && body["state"] == "REVOKED" {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "撤钥未收敛：{status} {body}"
            );
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        }
        // 终态重放：按确定的下一版本找回，不重复销毁或审计
        let (status, body) = call(
            http,
            e,
            token,
            "/service/v1/identity-projections/buzz",
            serde_json::json!({ "pubkey": pubkey, "bindingVersion": revoking }),
        )
        .await;
        assert_eq!(
            (status, body["state"].clone()),
            (reqwest::StatusCode::OK, "REVOKED".into())
        );

        let (state, status): (String, Option<String>) = sqlx::query_as(
            "select state, private_key_secret_status from identity.buzz_identity_binding
             where pubkey = $1",
        )
        .bind(&pubkey)
        .fetch_one(pool)
        .await
        .expect("撤钥后的 binding");
        assert_eq!(
            (state.as_str(), status.as_deref()),
            ("REVOKED", Some("REVOKED"))
        );
        let retired: bool = sqlx::query_scalar(
            "select retired_at is not null from admission.server_key_provision_intent
             where target_locator = $1",
        )
        .bind(&locator)
        .fetch_one(pool)
        .await
        .expect("写入意图");
        assert!(retired, "metadata 查证后意图须 RETIRED");
        let after = kv_metadata(http, e, &b, &path).await;
        assert_eq!(after["data"]["current_version"], 1, "不追加版本");
        assert_eq!(
            after.pointer("/data/versions/1/destroyed"),
            Some(&serde_json::Value::Bool(true))
        );
        let audits: i64 = sqlx::query_scalar(
            "select count(*) from audit.audit_event ev
             join admission.action_execution ae on ae.operation_id = ev.operation_id
             where ae.id = $1 and ev.event_key like '%:platform-key-retired:%'",
        )
        .bind(revoke)
        .fetch_one(pool)
        .await
        .expect("退役审计");
        assert_eq!(audits, 1, "退役审计只有一条");
    }
}

struct ControlFixture {
    tenant: Uuid,
    initiator: Uuid,
    operation: Uuid,
}

/// 一个 PROVISIONING 的 Tenant 与其建立 operation（ActionExecution + 固定
/// WorkflowRef），不启动 Workflow：由测试直接驱动 `buzz-provision` 服务面。
async fn control_fixture(pool: &PgPool, stale_terminal: bool) -> (ControlFixture, Uuid, Uuid) {
    let tenant = Uuid::new_v4();
    common::record_tenant_namespace_fixture(tenant).expect("登记夹具 namespace");
    let initiator = Uuid::new_v4();
    sqlx::query(
        "insert into identity.tenant (id, slug, name, state) values ($1, $2, 'verify', 'PROVISIONING')",
    )
    .bind(tenant)
    .bind(format!("verify-ctl-{}", &tenant.simple().to_string()[..12]))
    .execute(pool)
    .await
    .expect("夹具 Tenant");
    sqlx::query("insert into identity.principal (id, tenant_id, kind, status) values ($1,$2,'HUMAN','ACTIVE')")
        .bind(initiator)
        .bind(tenant)
        .execute(pool)
        .await
        .expect("夹具发起者");
    let mut ops = Vec::new();
    for (version, terminal) in [(1, false), (0, stale_terminal)] {
        let action = Uuid::new_v4();
        let operation = Uuid::new_v4();
        sqlx::query(
            "insert into admission.action_execution
                 (id, operation_id, tenant_id, action_key, action_version,
                  initiator_principal_id, actor_principal_id, target_id, parameter_hash,
                  gate_state, dispatch_state, correlation_id)
             values ($1,$2,$3,'verify.tenant.provision',1,$4,$4,$3,'verify-control',
                     'ALLOWED','DISPATCHED',gen_random_uuid())",
        )
        .bind(action)
        .bind(operation)
        .bind(tenant)
        .bind(initiator)
        .execute(pool)
        .await
        .expect("夹具 Tenant 建立动作");
        sqlx::query(
            "insert into projection.workflow_ref
             (workflow_id, workflow_type, workflow_version, kind, tenant_id,
              operation_id, action_execution_id, projection_state)
             values ($1,'ComponentTaskWorkflow',1,'TENANT_LIFECYCLE',$2,$3,$4,$5)",
        )
        .bind(format!(
            "platform:TENANT_LIFECYCLE:{tenant}:{tenant}:{version}"
        ))
        .bind(tenant)
        .bind(operation)
        .bind(action)
        .bind(if terminal {
            "TERMINAL"
        } else {
            "PENDING_START"
        })
        .execute(pool)
        .await
        .expect("夹具 Tenant 建立 WorkflowRef");
        ops.push((operation, action));
    }
    (
        ControlFixture {
            tenant,
            initiator,
            operation: ops[0].0,
        },
        ops[1].0,
        ops[1].1,
    )
}

async fn control_teardown(e: &Env, pool: &PgPool, f: &ControlFixture) {
    if let Err(err) = common::retire_relay_community(e, pool, f.tenant).await {
        eprintln!("{err}");
    }
    common::purge_tenant_rows(pool, f.tenant).await;
    let _ = f.initiator;
}

/// 冻结一条 CONTROL 写入意图（与 `platform_keys::freeze_control_intent` 提交后的
/// 持久事实同形），返回 (意图 ID, locator 相对路径, 私钥)。
async fn freeze_control(
    pool: &PgPool,
    e: &Env,
    b: &Bao,
    tenant: Uuid,
    operation: Uuid,
    action: Uuid,
) -> (Uuid, String, nostr::Keys) {
    let keys = nostr::Keys::generate();
    let path = format!("buzz-control/{}", keys.public_key().to_hex());
    let principal = Uuid::new_v4();
    sqlx::query("insert into identity.principal (id, tenant_id, kind, status) values ($1,$2,'SERVICE','ACTIVE')")
        .bind(principal)
        .bind(tenant)
        .execute(pool)
        .await
        .expect("CONTROL Principal");
    let id: Uuid = sqlx::query_scalar(
        "insert into admission.server_key_provision_intent
             (key_kind, origin, operation_id, action_execution_id, tenant_id, principal_id,
              target_locator)
         values ('CONTROL', 'PROVISIONED', $1, $2, $3, $4, $5) returning id",
    )
    .bind(operation)
    .bind(action)
    .bind(tenant)
    .bind(principal)
    .bind(format!("{}/{}/{path}", b.child, e.bao_mount))
    .fetch_one(pool)
    .await
    .expect("CONTROL 写入意图");
    (id, path, keys)
}

async fn provision_control(
    http: &reqwest::Client,
    e: &Env,
    token: &str,
    tenant: Uuid,
) -> (reqwest::StatusCode, serde_json::Value) {
    call(
        http,
        e,
        token,
        "/service/v1/tenants/buzz-provision",
        serde_json::json!({ "tenantId": tenant, "tenantVersion": 1 }),
    )
    .await
}

async fn orphan_audit_count(pool: &PgPool, operation: Uuid, marker: &str, intent: Uuid) -> i64 {
    sqlx::query_scalar(
        "select count(*) from audit.audit_event
         where operation_id = $1 and event_key = $2 and result_code = 'DESTROYED'",
    )
    .bind(operation)
    .bind(format!("{operation}:{marker}:{intent}"))
    .fetch_one(pool)
    .await
    .expect("孤儿审计")
}

/// DD-113 (2) 的 CONTROL 三条路径：另一 operation 已终态的未绑定写入由治理对账器
/// fence 后销毁；同一 operation 的重试续用回应丢失但已落盘的写入；同一 operation
/// 冻结的 locator 上不是该 pubkey 的私钥时 fence 后销毁、再为本 operation 写新 key。
#[tokio::test]
async fn control_orphan_writes_are_reused_or_destroyed() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;
    let proxy = common::DropResponseProxy::start(&e.bao_addr);
    for reuse in [true, false] {
        let (f, stale_operation, stale_action) = control_fixture(&pool, true).await;
        let outcome = std::panic::AssertUnwindSafe(run_control(
            &http,
            &e,
            &pool,
            &token,
            &proxy,
            &f,
            stale_operation,
            stale_action,
            reuse,
        ))
        .catch_unwind()
        .await;
        control_teardown(&e, &pool, &f).await;
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_control(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    token: &str,
    proxy: &common::DropResponseProxy,
    f: &ControlFixture,
    stale_operation: Uuid,
    stale_action: Uuid,
    reuse: bool,
) {
    let b = bao(f.tenant);
    // 1. 另一 operation（已终态）遗留的未完成意图：本 operation 不处置它，503。
    let (stale, stale_path, stale_keys) =
        freeze_control(pool, e, &b, f.tenant, stale_operation, stale_action).await;
    let (status, _) = provision_control(http, e, token, f.tenant).await;
    assert_eq!(
        status,
        reqwest::StatusCode::SERVICE_UNAVAILABLE,
        "他人意图未收敛时不另写"
    );
    let bindings: i64 = sqlx::query_scalar(
        "select count(*) from identity.buzz_identity_binding where tenant_id = $1",
    )
    .bind(f.tenant)
    .fetch_one(pool)
    .await
    .expect("binding 计数");
    assert_eq!(bindings, 0);
    // 该 operation 的写入其实已落盘（namespace 已由上一次调用收敛）。
    assert!(kv_put(
        http,
        e,
        &b,
        &stale_path,
        &stale_keys.secret_key().to_secret_hex(),
        0
    )
    .await
    .is_success());
    make_overdue_intent(pool, stale).await;
    let deadline = std::time::Instant::now() + reconcile_bound(e, pool).await;
    loop {
        let (fenced, destroyed, finished): (bool, bool, bool) = sqlx::query_as(
            "select fenced_at is not null, destroyed_at is not null, finished_at is not null
             from admission.server_key_provision_intent where id = $1",
        )
        .bind(stale)
        .fetch_one(pool)
        .await
        .expect("他人意图");
        if (fenced, destroyed, finished) == (true, true, true) {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "对账器未收敛他人孤儿写入"
        );
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    }
    let metadata = kv_metadata(http, e, &b, &stale_path).await;
    assert_eq!(metadata["data"]["current_version"], 1);
    assert_eq!(
        metadata.pointer("/data/versions/1/destroyed"),
        Some(&serde_json::Value::Bool(true))
    );
    assert_eq!(
        orphan_audit_count(pool, stale_operation, "control-orphan-destroyed", stale).await,
        1,
        "审计追加到遗留写入的原 operation"
    );

    // 2. 本 operation 已冻结的意图。
    let action: Uuid =
        sqlx::query_scalar("select id from admission.action_execution where operation_id = $1")
            .bind(f.operation)
            .fetch_one(pool)
            .await
            .expect("本 operation 的动作");
    let (frozen, path, keys) = freeze_control(pool, e, &b, f.tenant, f.operation, action).await;
    if reuse {
        // 写入已落盘而回应丢失：重试只查证并续用，不生成新 key。
        lossy_kv(
            proxy,
            e,
            &b.child,
            &b.root,
            "data",
            &path,
            serde_json::json!({"data": {"value": keys.secret_key().to_secret_hex()},
                               "options": {"cas": 0}}),
            "HTTP/1.1 200",
        )
        .await;
    } else {
        // 冻结的 locator 上是另一把私钥（不是该 pubkey）：不能续用。
        let other = nostr::Keys::generate();
        assert!(
            kv_put(http, e, &b, &path, &other.secret_key().to_secret_hex(), 0)
                .await
                .is_success()
        );
    }
    let deadline = std::time::Instant::now() + reconcile_bound(e, pool).await;
    let body = loop {
        let (status, body) = provision_control(http, e, token, f.tenant).await;
        if status == reqwest::StatusCode::OK {
            break body;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "CONTROL 未建立：{status} {body}"
        );
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    };
    let pubkey = keys.public_key().to_hex();
    let (bound_pubkey, bound_ref, status): (String, String, Option<String>) = sqlx::query_as(
        "select pubkey, private_key_secret_ref, private_key_secret_status
         from identity.buzz_identity_binding where tenant_id = $1 and kind = 'CONTROL'",
    )
    .bind(f.tenant)
    .fetch_one(pool)
    .await
    .expect("CONTROL binding");
    assert_eq!(body["controlPubkey"], bound_pubkey);
    assert_eq!(status.as_deref(), Some("PENDING"), "查证前引用为 PENDING");
    let finished: bool = sqlx::query_scalar(
        "select finished_at is not null and destroyed_at is null
         from admission.server_key_provision_intent where target_locator = $1",
    )
    .bind(&bound_ref)
    .fetch_one(pool)
    .await
    .expect("绑定的意图");
    assert!(finished, "binding 与意图 BOUND 同事务");
    let metadata = kv_metadata(http, e, &b, &path).await;
    if reuse {
        assert_eq!(bound_pubkey, pubkey, "续用已落盘的写入，不生成新 key");
        assert_eq!(
            metadata.pointer("/data/versions/1/destroyed"),
            Some(&serde_json::Value::Bool(false))
        );
    } else {
        assert_ne!(bound_pubkey, pubkey, "不可续用的写入不形成 binding");
        assert_eq!(metadata["data"]["current_version"], 1, "不追加版本");
        assert_eq!(
            metadata.pointer("/data/versions/1/destroyed"),
            Some(&serde_json::Value::Bool(true)),
            "不可续用的写入须 fence 后销毁"
        );
        assert_eq!(
            orphan_audit_count(pool, f.operation, "control-orphan-destroyed", frozen).await,
            1
        );
    }
}

async fn make_overdue_intent(pool: &PgPool, id: Uuid) {
    let stale_after: i64 = std::env::var("ADMISSION_EVALUATION_TIMEOUT_SECONDS")
        .expect("准入对账超时配置")
        .parse()
        .expect("准入对账超时须为秒数");
    sqlx::query(
        "update admission.server_key_provision_intent
         set created_at = now() - make_interval(secs => $2::bigint) where id = $1",
    )
    .bind(id)
    .bind(stale_after + 1)
    .execute(pool)
    .await
    .expect("推过对账上界");
}

/// DD-113 (2) 的 OPERATOR 孤儿：投递写入了独占 locator，但引导未登记（未重试或
/// 投递了另一把 key）。超过准入对账上界后由治理对账器 fence 后销毁并查证。
#[tokio::test]
async fn operator_orphan_write_is_destroyed_by_reconciler() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let catalog: Uuid =
        sqlx::query_scalar("select catalog_tenant_id from identity.relay_operator_identity")
            .fetch_one(&pool)
            .await
            .expect("Catalog Tenant");
    let root = bao(catalog).root;
    let keys = nostr::Keys::generate();
    let path = format!(
        "relay-operator/{}/{}",
        e.operator_audience,
        keys.public_key().to_hex()
    );
    let locator = format!("{}/{}/{path}", e.bao_namespace, e.bao_mount);
    let operation = Uuid::new_v4();
    // 截止未到：这次投递可能仍在提交，对账器不得触碰（DD-115 (4)）。
    let intent: Uuid = sqlx::query_scalar(
        "insert into admission.server_key_provision_intent
             (key_kind, origin, operation_id, tenant_id, principal_id, target_locator,
              commit_deadline_at)
         values ('OPERATOR', 'PROVISIONED', $1, $2, null, $3, now() + interval '1 day')
         returning id",
    )
    .bind(operation)
    .bind(catalog)
    .bind(&locator)
    .fetch_one(&pool)
    .await
    .expect("OPERATOR 写入意图（同一 Catalog 须无其他未完成投递）");
    let platform = Bao {
        child: e.bao_namespace.clone(),
        root: root.clone(),
    };
    assert!(kv_put(
        &http,
        &e,
        &platform,
        &path,
        &keys.secret_key().to_secret_hex(),
        0
    )
    .await
    .is_success());
    // 超过准入对账上界、但提交截止未到：不是终态。等对账器完整跑过两轮后仍 OPEN。
    make_overdue_intent(&pool, intent).await;
    let rounds = reconcile_bound(&e, &pool).await;
    tokio::time::sleep(rounds / 2).await;
    let untouched: (bool, bool) = sqlx::query_as(
        "select fenced_at is null, finished_at is null
         from admission.server_key_provision_intent where id = $1",
    )
    .bind(intent)
    .fetch_one(&pool)
    .await
    .expect("截止前的 OPERATOR 意图");
    // 截止已过：引导已确定不会再提交，即为终态。
    sqlx::query(
        "update admission.server_key_provision_intent
         set commit_deadline_at = now() - interval '1 second' where id = $1",
    )
    .bind(intent)
    .execute(&pool)
    .await
    .expect("推过提交截止");
    let deadline = std::time::Instant::now() + reconcile_bound(&e, &pool).await;
    let converged = loop {
        let state: (bool, bool, bool) = sqlx::query_as(
            "select fenced_at is not null, destroyed_at is not null, finished_at is not null
             from admission.server_key_provision_intent where id = $1",
        )
        .bind(intent)
        .fetch_one(&pool)
        .await
        .expect("OPERATOR 意图");
        if state == (true, true, true) {
            break true;
        }
        if std::time::Instant::now() >= deadline {
            break false;
        }
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    };
    let metadata = kv_metadata(&http, &e, &platform, &path).await;
    let audits = orphan_audit_count(&pool, operation, "operator-orphan-destroyed", intent).await;
    // 断言前先清掉夹具：意图行与 KV metadata 都只属于本用例。
    sqlx::query("delete from admission.server_key_provision_intent where id = $1")
        .bind(intent)
        .execute(&pool)
        .await
        .expect("清理 OPERATOR 意图");
    let purged = http
        .delete(format!("{}/v1/{}/metadata/{path}", e.bao_addr, e.bao_mount))
        .header("X-Vault-Namespace", &e.bao_namespace)
        .header("X-Vault-Token", &root)
        .send()
        .await
        .expect("清理 OPERATOR 夹具 KV");
    assert!(purged.status().is_success());
    assert_eq!(
        untouched,
        (true, true),
        "提交截止前对账器不得隔离 OPERATOR 意图"
    );
    assert!(converged, "对账器未在上界内收敛 OPERATOR 孤儿写入");
    assert_eq!(metadata["data"]["current_version"], 1);
    assert_eq!(
        metadata.pointer("/data/versions/1/destroyed"),
        Some(&serde_json::Value::Bool(true))
    );
    assert_eq!(audits, 1, "审计追加到该投递 operation");
}

/// DD-115 (3)：成员撤权投影使 SERVER HUMAN binding `REVOKED` 时同事务冻结退役
/// operation，并在 roster 移出查证后 delete 与 destroy；投影没做完的（此处以持久
/// 事实构造：REVOKED、意图 BOUND、退役 operation 已冻结，且 destroy 已生效而回应
/// 丢失）由治理对账器补做，审计都追加到成员撤权 operation。
#[tokio::test]
async fn membership_revocation_retires_server_keys() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;
    let fx = match common::provision_live_workspace(&http, &e, &pool, &token).await {
        Ok(f) => f,
        Err(msg) => panic!("准备真实 Workspace 失败: {msg}"),
    };
    let mut members = Vec::new();
    let outcome = std::panic::AssertUnwindSafe(run_member_retirement(
        &http,
        &e,
        &pool,
        &token,
        &fx,
        &mut members,
    ))
    .catch_unwind()
    .await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    let refs: Vec<&common::LiveMember> = members.iter().collect();
    common::teardown_members(&pool, &fx, &refs).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn assert_retired_to(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    b: &Bao,
    locator: &str,
    operation: Uuid,
    why: &str,
) {
    let (state, status): (String, Option<String>) = sqlx::query_as(
        "select state, private_key_secret_status from identity.buzz_identity_binding
         where private_key_secret_ref = $1",
    )
    .bind(locator)
    .fetch_one(pool)
    .await
    .expect("撤权后的 binding");
    assert_eq!(
        (state.as_str(), status.as_deref()),
        ("REVOKED", Some("REVOKED")),
        "{why}"
    );
    let (retired, frozen): (bool, Option<Uuid>) = sqlx::query_as(
        "select retired_at is not null, retire_operation_id
         from admission.server_key_provision_intent where target_locator = $1",
    )
    .bind(locator)
    .fetch_one(pool)
    .await
    .expect("写入意图");
    assert!(retired, "{why}: 意图须 RETIRED");
    assert_eq!(
        frozen,
        Some(operation),
        "{why}: 退役 operation 须是成员撤权 operation"
    );
    let path = locator
        .strip_prefix(&format!("{}/{}/", b.child, e.bao_mount))
        .expect("独占 locator");
    let metadata = kv_metadata(http, e, b, path).await;
    assert_eq!(metadata["data"]["current_version"], 1, "{why}");
    assert_eq!(
        metadata.pointer("/data/versions/1/destroyed"),
        Some(&serde_json::Value::Bool(true)),
        "{why}: 版本 1 须已销毁"
    );
    let audits: i64 = sqlx::query_scalar(
        "select count(*) from audit.audit_event
         where operation_id = $1 and event_key like '%:platform-key-retired:%'
           and result_code = 'RETIRED'",
    )
    .bind(operation)
    .fetch_one(pool)
    .await
    .expect("退役审计");
    assert_eq!(audits, 1, "{why}: 退役审计追加到成员撤权 operation");
}

async fn run_member_retirement(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    token: &str,
    fx: &common::LiveWorkspace,
    members: &mut Vec<common::LiveMember>,
) {
    let b = bao(fx.tenant);
    let proxy = common::DropResponseProxy::start(&e.bao_addr);
    for projected in [true, false] {
        let member = common::add_tenant_member(http, e, pool, token, fx)
            .await
            .expect("开通 Tenant 成员");
        let (principal, membership) = (member.principal, member.membership);
        members.push(member);
        let version: i32 =
            sqlx::query_scalar("select version from identity.tenant_membership where id = $1")
                .bind(membership)
                .fetch_one(pool)
                .await
                .expect("成员关系版本");
        let (pubkey, locator): (String, String) = sqlx::query_as(
            "select pubkey, private_key_secret_ref from identity.buzz_identity_binding
             where tenant_id = $1 and principal_id = $2 and custody = 'SERVER' and state = 'ACTIVE'",
        )
        .bind(fx.tenant)
        .bind(principal)
        .fetch_one(pool)
        .await
        .expect("成员的 SERVER 身份");
        let operation = common::seed_membership_revocation_ref(
            pool,
            fx.tenant,
            fx.initiator,
            membership,
            version,
        )
        .await;
        if projected {
            // 真实投影：roster 移出查证后同一次调用完成 delete、destroy 与 RETIRED。
            let deadline = std::time::Instant::now() + reconcile_bound(e, pool).await;
            loop {
                let (status, body) = call(
                    http,
                    e,
                    token,
                    "/service/v1/membership-projections/buzz",
                    serde_json::json!({"scope": "TENANT", "membershipId": membership,
                                       "membershipVersion": version, "presence": "ABSENT"}),
                )
                .await;
                if status == reqwest::StatusCode::OK {
                    break;
                }
                assert_eq!(status, reqwest::StatusCode::SERVICE_UNAVAILABLE, "{body}");
                assert!(
                    std::time::Instant::now() < deadline,
                    "成员撤权未收敛：{body}"
                );
                tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            }
            assert_retired_to(http, e, pool, &b, &locator, operation, "projection").await;
        } else {
            // 投影在 REVOKED 与冻结之后、destroy 回应之前中断：destroy 已生效而回应丢失。
            let mut tx = pool.begin().await.expect("中断夹具事务");
            sqlx::query(
                "update identity.buzz_identity_binding
                 set state = 'REVOKED', version = version + 1,
                     private_key_secret_status = 'SUPERSEDED'
                 where pubkey = $1 and state = 'ACTIVE'",
            )
            .bind(&pubkey)
            .execute(&mut *tx)
            .await
            .expect("REVOKED");
            let frozen = sqlx::query(
                "update admission.server_key_provision_intent set retire_operation_id = $2
                 where target_locator = $1 and finished_at is not null and retired_at is null",
            )
            .bind(&locator)
            .bind(operation)
            .execute(&mut *tx)
            .await
            .expect("冻结退役 operation");
            assert_eq!(frozen.rows_affected(), 1);
            tx.commit().await.expect("提交中断夹具");
            let path = locator
                .strip_prefix(&format!("{}/{}/", b.child, e.bao_mount))
                .expect("独占 locator")
                .to_owned();
            lossy_kv(
                &proxy,
                e,
                &b.child,
                &b.root,
                "destroy",
                &path,
                serde_json::json!({"versions": [1]}),
                "HTTP/1.1 204",
            )
            .await;
            let deadline = std::time::Instant::now() + reconcile_bound(e, pool).await;
            loop {
                let retired: bool = sqlx::query_scalar(
                    "select retired_at is not null from admission.server_key_provision_intent
                     where target_locator = $1",
                )
                .bind(&locator)
                .fetch_one(pool)
                .await
                .expect("意图");
                if retired {
                    break;
                }
                assert!(std::time::Instant::now() < deadline, "对账器未补做退役");
                tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            }
            assert_retired_to(http, e, pool, &b, &locator, operation, "reconciler").await;
        }
    }
}

/// DD-115 (6)：DD-113 之前的轮换遗留在 operator 前缀下、既无引用也无意图的 locator，
/// 对账器只读列出后补建 BACKFILLED 且已到期的意图并销毁查证；版本大于 1 的不补建、
/// 不销毁。
#[tokio::test]
async fn unrecorded_operator_locators_are_backfilled_and_retired() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let catalog: Uuid =
        sqlx::query_scalar("select catalog_tenant_id from identity.relay_operator_identity")
            .fetch_one(&pool)
            .await
            .expect("Catalog Tenant");
    let root = bao(catalog).root;
    let platform = Bao {
        child: e.bao_namespace.clone(),
        root: root.clone(),
    };
    let legacy = |pubkey: String| {
        format!(
            "relay-operator/{}/{pubkey}/{}",
            e.operator_audience,
            Uuid::new_v4()
        )
    };
    let single = legacy(nostr::Keys::generate().public_key().to_hex());
    let double = legacy(nostr::Keys::generate().public_key().to_hex());
    let value = || nostr::Keys::generate().secret_key().to_secret_hex();
    assert!(kv_put(&http, &e, &platform, &single, &value(), 0)
        .await
        .is_success());
    assert!(kv_put(&http, &e, &platform, &double, &value(), 0)
        .await
        .is_success());
    assert!(kv_put(&http, &e, &platform, &double, &value(), 1)
        .await
        .is_success());
    let locator = |path: &str| format!("{}/{}/{path}", e.bao_namespace, e.bao_mount);

    let deadline = std::time::Instant::now() + reconcile_bound(&e, &pool).await;
    let retired = loop {
        let row: Option<(String, Option<Uuid>, Option<Uuid>, bool)> = sqlx::query_as(
            "select origin, operation_id, retire_operation_id, retired_at is not null
             from admission.server_key_provision_intent where target_locator = $1",
        )
        .bind(locator(&single))
        .fetch_optional(&pool)
        .await
        .expect("遗留 locator 的意图");
        if matches!(row, Some((_, _, _, true))) || std::time::Instant::now() >= deadline {
            break row;
        }
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    };
    let single_meta = kv_metadata(&http, &e, &platform, &single).await;
    let double_meta = kv_metadata(&http, &e, &platform, &double).await;
    let double_recorded: i64 = sqlx::query_scalar(
        "select count(*) from admission.server_key_provision_intent where target_locator = $1",
    )
    .bind(locator(&double))
    .fetch_one(&pool)
    .await
    .expect("版本 2 的意图计数");
    let audits = match &retired {
        Some((_, _, Some(op), _)) => sqlx::query_scalar::<_, i64>(
            "select count(*) from audit.audit_event
             where operation_id = $1 and event_key like '%:platform-key-retired:%'",
        )
        .bind(op)
        .fetch_one(&pool)
        .await
        .expect("退役审计"),
        _ => 0,
    };
    // 断言前先清掉只属于本用例的夹具
    sqlx::query("delete from admission.server_key_provision_intent where target_locator = any($1)")
        .bind(vec![locator(&single), locator(&double)])
        .execute(&pool)
        .await
        .expect("清理遗留意图");
    for path in [&single, &double] {
        let purged = http
            .delete(format!("{}/v1/{}/metadata/{path}", e.bao_addr, e.bao_mount))
            .header("X-Vault-Namespace", &e.bao_namespace)
            .header("X-Vault-Token", &root)
            .send()
            .await
            .expect("清理遗留 KV");
        assert!(purged.status().is_success());
    }
    let Some((origin, operation, retire_operation, true)) = retired else {
        panic!("对账器未在上界内退役遗留 operator locator：{retired:?}");
    };
    assert_eq!(origin, "BACKFILLED");
    assert_eq!(operation, None, "存量行不以派生值占位 operation");
    assert!(retire_operation.is_some(), "退役 operation 为该轮对账");
    assert_eq!(
        single_meta.pointer("/data/versions/1/destroyed"),
        Some(&serde_json::Value::Bool(true))
    );
    assert_eq!(audits, 1);
    assert_eq!(double_recorded, 0, "版本大于 1 的遗留 locator 不补建意图");
    for version in ["1", "2"] {
        assert_eq!(
            double_meta.pointer(&format!("/data/versions/{version}/destroyed")),
            Some(&serde_json::Value::Bool(false)),
            "版本大于 1 的遗留 locator 保持原状"
        );
    }
}
