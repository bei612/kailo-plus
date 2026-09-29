//! Workspace 暂停与恢复的端到端核验（`.design/06` §7.3、DD-46、V-SCN-36）。
//!
//! 走真实拓扑：BFF 语义命令 → Tenant scope 上的准入（tenant manage fresh Check）→
//! 同事务置 SUSPENDING/RESTORING → WORKSPACE_LIFECYCLE 在 Worker 上 archive/unarchive
//! Channel（Core 以回读的 kind 39000 查证）→ 跃迁 SUSPENDED/ACTIVE。
//! 夹具只写 OIDC 侧身份与首位 Tenant admin 关系。

use collab_bridge::bridge::{Custody, IdentityClient, Scope};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

mod common;
use common::{bff, reason, state_of, submit, until, Env, LiveMember, LiveWorkspace};

#[tokio::test]
async fn workspace_suspend_fails_closed_and_restore_reopens() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;

    let fx = common::provision_live_workspace(&http, &e, &pool, &token)
        .await
        .expect("开通夹具 Workspace");
    let b = match common::add_tenant_member(&http, &e, &pool, &token, &fx).await {
        Ok(m) => m,
        Err(err) => {
            common::teardown_live_workspace(&e, &pool, &fx).await;
            panic!("开通成员失败：{err}");
        }
    };
    let tenant = format!("tenant:{}", fx.tenant);
    let admin = format!("principal:{}", fx.principal);
    common::zed_relationship(&e, "touch", &tenant, "admin", &admin);

    let outcome = std::panic::AssertUnwindSafe(scenarios(&http, &e, &pool, &fx, &b));
    let result = futures_util::FutureExt::catch_unwind(outcome).await;

    // 场景中途失败时 Workspace 可能停在暂停一侧；拆除不依赖它的状态
    common::zed_relationship(&e, "delete", &tenant, "admin", &admin);
    common::zed_relationship(
        &e,
        "delete",
        &tenant,
        "member",
        &format!("principal:{}", b.principal),
    );
    common::teardown_live_workspace(&e, &pool, &fx).await;
    common::teardown_members(&pool, &fx, &[&b]).await;
    if let Err(p) = result {
        std::panic::resume_unwind(p);
    }
}

fn entry(page: &Value, workspace: Uuid) -> Option<Value> {
    page["workspaces"]
        .as_array()?
        .iter()
        .find(|w| w["id"] == workspace.to_string())
        .cloned()
}

async fn role_entry(http: &reqwest::Client, e: &Env, subject: &str, ws: Uuid) -> Option<Value> {
    let (st, page) = bff(
        http,
        e,
        subject,
        reqwest::Method::GET,
        "/api/v1/role-workspaces",
        None,
    )
    .await;
    assert!(st.is_success(), "角色管理 Workspace 列表失败：{st} {page}");
    common::assert_contract::<contracts::RoleWorkspacePage>(&page, "RoleWorkspacePage");
    entry(&page, ws)
}

async fn enterable(http: &reqwest::Client, e: &Env, subject: &str, ws: Uuid) -> bool {
    let (st, list) = bff(
        http,
        e,
        subject,
        reqwest::Method::GET,
        "/api/v1/workspaces",
        None,
    )
    .await;
    assert!(st.is_success(), "本人 Workspace 列表失败：{st} {list}");
    list.as_array()
        .unwrap()
        .iter()
        .any(|w| w["id"] == ws.to_string())
}

async fn scenarios(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    fx: &LiveWorkspace,
    b: &LiveMember,
) {
    let a = fx.subject.as_str();
    let ws = fx.workspace;
    let lifecycle =
        |key: &str| json!({"actionKey": key, "idempotencyKey": Uuid::new_v4(), "workspaceId": ws});

    // ---- 1. 入口提示：Tenant admin 在 ACTIVE Workspace 上得到暂停键 ----
    let item = role_entry(http, e, a, ws)
        .await
        .expect("Tenant admin 应能选中该 Workspace");
    assert_eq!(item["state"], "ACTIVE");
    assert_eq!(item["lifecycleActionKey"], "workspace.suspend");

    // ---- 2. 非 Tenant admin 不能发起：权限在所属 Tenant 上判定 ----
    let (st, refused) = submit(http, e, &b.subject, lifecycle("workspace.suspend")).await;
    assert_eq!(st, reqwest::StatusCode::FORBIDDEN, "{refused}");
    assert_eq!(reason(&refused), "PERMISSION_DENIED");
    // 参数闭集：多带 principalId 即拒绝
    let mut extra = lifecycle("workspace.suspend");
    extra["principalId"] = json!(b.principal);
    let (st, bad) = submit(http, e, a, extra).await;
    assert_eq!(st, reqwest::StatusCode::UNPROCESSABLE_ENTITY, "{bad}");
    assert_eq!(reason(&bad), "INVALID_PARAMETERS");
    // 已 ACTIVE 的 Workspace 不能恢复
    let (st, early) = submit(http, e, a, lifecycle("workspace.restore")).await;
    assert_eq!(st, reqwest::StatusCode::CONFLICT, "{early}");
    assert_eq!(reason(&early), "TARGET_STATE_CONFLICT");

    // ---- 3. 暂停：TENANT_ONLY 执行 scope，收敛到 SUSPENDED ----
    let (st, sub) = submit(http, e, a, lifecycle("workspace.suspend")).await;
    assert!(st.is_success(), "workspace.suspend 应被允许：{st} {sub}");
    let ae = Uuid::parse_str(sub["actionExecutionId"].as_str().unwrap()).unwrap();
    let (scope, target): (Option<Uuid>, Uuid) = sqlx::query_as(
        "select workspace_id, target_id from admission.action_execution where id = $1",
    )
    .bind(ae)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        scope, None,
        "从 Tenant scope 发起，不借用被暂停的 Workspace scope"
    );
    assert_eq!(target, ws);
    until(e, "Workspace SUSPENDED", || async {
        (state_of(pool, "identity.workspace", ws).await == "SUSPENDED").then_some(())
    })
    .await;
    let (kind, projection): (Option<String>, String) = sqlx::query_as(
        "select kind, projection_state from projection.workflow_ref where action_execution_id = $1",
    )
    .bind(ae)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(kind.as_deref(), Some("WORKSPACE_LIFECYCLE"));
    assert!(matches!(projection.as_str(), "RUNNING" | "TERMINAL"));

    // ---- 4. 暂停期间 fail closed：不可进入、Workspace scope 新动作被拒、不能再暂停 ----
    assert!(
        !enterable(http, e, a, ws).await,
        "已暂停的 Workspace 不得出现在可进入列表"
    );
    let (st, _) = bff(
        http,
        e,
        a,
        reqwest::Method::GET,
        &format!("/api/v1/workspaces/{ws}/members"),
        None,
    )
    .await;
    assert_eq!(
        st,
        reqwest::StatusCode::FORBIDDEN,
        "已暂停的 Workspace scope 必须拒绝读取"
    );
    let add = json!({"actionKey":"workspace.member.add","idempotencyKey":Uuid::new_v4(),
                     "workspaceId":ws,"principalId":b.principal});
    let (st, refused) = submit(http, e, a, add).await;
    assert_eq!(st, reqwest::StatusCode::FORBIDDEN, "{refused}");
    assert_eq!(reason(&refused), "SCOPE_GUARD_FAILED");
    let (st, again) = submit(http, e, a, lifecycle("workspace.suspend")).await;
    assert_eq!(st, reqwest::StatusCode::CONFLICT, "{again}");
    assert_eq!(reason(&again), "TARGET_STATE_CONFLICT");
    let item = role_entry(http, e, a, ws)
        .await
        .expect("已暂停的 Workspace 仍在管理列表");
    assert_eq!(item["state"], "SUSPENDED");
    assert_eq!(item["lifecycleActionKey"], "workspace.restore");

    // ---- 4b. Relay 一侧：Channel 已归档，持钥身份直连发布被 Relay 拒绝 ----
    // 原生端直连 Relay，Core 不在路径上；暂停对它们生效只能靠 Relay 的归档判定
    let holder = holder(http, e, pool, fx).await;
    // 归档状态与 roster 以 Channel owner（CONTROL）读：成员被清出 roster 后，private
    // Channel 对它连 discovery 都不可见，那正是读取已关闭的表现
    let control = control(http, e, pool, fx).await;
    let (_, channel) = common::live_scope(pool, fx).await;
    assert_eq!(
        control
            .channel_archived(http, &channel)
            .await
            .expect("读 discovery"),
        Some(true),
        "暂停后 Relay 上的 Channel 应已归档"
    );
    // DD-97：归档前 roster 已清空为只剩 CONTROL，原生端的读取随之关闭
    let control_key = control.pubkey_hex();
    let roster = control
        .roster(http, Scope::Channel(&channel))
        .await
        .expect("读 Channel roster");
    assert!(
        roster.iter().all(|r| r.pubkey == control_key)
            && roster.iter().any(|r| r.pubkey == control_key),
        "暂停后 Channel roster 应只剩 CONTROL：{roster:?}"
    );
    let published = holder
        .publish(
            http,
            9,
            "while suspended",
            &[vec!["h".to_owned(), channel.clone()]],
        )
        .await;
    let refused = match &published {
        Ok(v) => v["accepted"] == false,
        Err(collab_bridge::operator::OperatorError::Rejected { .. }) => true,
        Err(_) => false,
    };
    assert!(refused, "归档期间直连发布必须被 Relay 拒绝：{published:?}");

    // ---- 5. 恢复：对账后 ACTIVE，重新可进入 ----
    let (st, sub) = submit(http, e, a, lifecycle("workspace.restore")).await;
    assert!(st.is_success(), "workspace.restore 应被允许：{st} {sub}");
    until(e, "Workspace ACTIVE", || async {
        (state_of(pool, "identity.workspace", ws).await == "ACTIVE").then_some(())
    })
    .await;
    assert!(enterable(http, e, a, ws).await, "恢复后应重新可进入");
    let (_, channel) = common::live_scope(pool, fx).await;
    assert_eq!(
        control
            .channel_archived(http, &channel)
            .await
            .expect("读 discovery"),
        Some(false),
        "恢复后 Relay 上的 Channel 应已解档"
    );
    // DD-97：恢复按 Core 事实重建 roster，ACTIVE 成员的托管身份重新在列
    let roster = control
        .roster(http, Scope::Channel(&channel))
        .await
        .expect("读 Channel roster");
    assert!(
        roster.iter().any(|r| r.pubkey == holder.pubkey_hex()),
        "恢复后 Channel roster 应重新包含 ACTIVE 成员的身份：{roster:?}"
    );
    let published = holder
        .publish(
            http,
            9,
            "after restore",
            &[vec!["h".to_owned(), channel.clone()]],
        )
        .await
        .expect("恢复后直连发布应到达 Relay");
    assert_eq!(
        published["accepted"], true,
        "恢复后直连发布应被接受：{published}"
    );
    let item = role_entry(http, e, a, ws)
        .await
        .expect("恢复后的 Workspace 在管理列表");
    assert_eq!(item["state"], "ACTIVE");
    assert_eq!(item["lifecycleActionKey"], "workspace.suspend");
    // 暂停不动 Resource/owner/relationship：归属关系在恢复后仍成立
    assert!(common::zed_has(
        e,
        &format!("workspace:{ws}"),
        "tenant",
        &format!("tenant:{}", fx.tenant)
    ));
}

/// 夹具 Tenant admin 的 Web 托管身份，按其 SecretRef 读出私钥后直连 Relay。
async fn holder(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    fx: &LiveWorkspace,
) -> IdentityClient {
    let (locator, version): (String, i32) = sqlx::query_as(
        "select private_key_secret_ref, private_key_secret_version
         from identity.buzz_identity_binding
         where principal_id = $1 and custody = 'SERVER' and state = 'ACTIVE'",
    )
    .bind(fx.principal)
    .fetch_one(pool)
    .await
    .expect("夹具应有 ACTIVE 的 Web 托管身份");
    let (host, _) = common::live_scope(pool, fx).await;
    let secret = common::read_secret_version(http, e, fx.tenant, &locator, version).await;
    IdentityClient::new(Custody::Server, &secret, &e.relay_origin, &host).expect("托管身份客户端")
}

/// 该 Tenant 的 CONTROL 身份（Channel owner），按其 SecretRef 读出私钥后直连 Relay。
async fn control(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    fx: &LiveWorkspace,
) -> IdentityClient {
    let (locator, version): (String, i32) = sqlx::query_as(
        "select private_key_secret_ref, private_key_secret_version
         from identity.buzz_identity_binding
         where tenant_id = $1 and kind = 'CONTROL' and state = 'ACTIVE'",
    )
    .bind(fx.tenant)
    .fetch_one(pool)
    .await
    .expect("夹具 Tenant 应有 ACTIVE 的 CONTROL 身份");
    let (host, _) = common::live_scope(pool, fx).await;
    let secret = common::read_secret_version(http, e, fx.tenant, &locator, version).await;
    IdentityClient::new(Custody::Server, &secret, &e.relay_origin, &host).expect("CONTROL 客户端")
}
