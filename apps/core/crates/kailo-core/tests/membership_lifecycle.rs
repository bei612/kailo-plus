//! Stage 1 退出门禁的整条链：
//!
//! > 成员建立与撤权经 `MEMBERSHIP_PROJECTION`/`MEMBERSHIP_REVOCATION` 完成
//! > SpiceDB 与 Channel roster 对账，Core `REVOKING` 在对账完成前即拒绝新动作。
//!
//! 链路：ActionExecution → Core 落 WorkflowRef → Temporal Start → Go Worker
//! 执行 → SpiceDB 关系 → Buzz roster → Core 跃迁成员状态。每一环都是真实
//! 实例：真实 Keycloak、真实 Temporal、真实 SpiceDB、真实 Relay、真实 OpenBao。
//!
//! 三个断言面各自独立取证，不互相背书：
//! - 成员状态查 Core 库
//! - SpiceDB 关系用官方 `zed` CLI 直接问 SpiceDB
//! - roster 用 CONTROL 身份直接问 Relay
//!
//! 没有任何一条断言以「Core 返回了 200」为据。

use futures_util::FutureExt;
use kailo_buzz::bridge::{Custody, IdentityClient, Scope};
use kailo_buzz::operator::OperatorIdentity;
use nostr::Keys;
use sqlx::PgPool;
use std::process::Command;
use uuid::Uuid;

mod common;
use common::{seed_tenant_fixture, seed_workspace_fixture, Env, Fixture};

/// 用官方 zed CLI 直接读 SpiceDB。
///
/// 不复用 Worker 的 Go 客户端，也不查 SpiceDB 的库表：前者会让「Worker 说写了」
/// 给「Worker 写了」背书，后者绕过 API 一致性语义。独立取证要用第三方工具。
///
/// `--consistency-full` 不能省。zed 默认按数据库偏好的 zedtoken 求值，会读到
/// 刚写入之前的 revision——这正是 Go 客户端里换掉默认档位的同一个坑，第一次
/// 写这个探针时它伪装成了「Workflow 说成功但 SpiceDB 里没有关系」。
fn spicedb_has(env: &Env, object: &str, relation: &str, subject: &str) -> bool {
    let out = Command::new("sudo")
        .args([
            "-n",
            "docker",
            "run",
            "--rm",
            "--network",
            &env.docker_network,
            "--env-file",
            &env.zed_env_file,
            "-e",
            &format!("ZED_ENDPOINT={}", env.spicedb_in_network),
            "-e",
            "ZED_INSECURE=true",
            &env.zed_image,
            "relationship",
            "read",
            "--consistency-full",
            object.split(':').next().unwrap(),
        ])
        .output()
        .expect("运行 zed");
    // 探针自己失败时必须当场报错，不能把「没读到」当成「不存在」。
    // 一个坏掉的探针静默返回 false，会伪装成一条真实的安全结论。
    assert!(
        out.status.success(),
        "zed 读取失败：{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8_lossy(&out.stdout);
    let found = text
        .lines()
        .any(|l| l.contains(object) && l.contains(relation) && l.contains(subject));
    if !found {
        eprintln!("zed 未命中 {object}#{relation}@{subject}，当前：\n{text}");
    }
    found
}

async fn wait_for_state(pool: &PgPool, membership: Uuid, want: &str, bound: u64) -> String {
    wait_for_state_in(pool, "identity.tenant_membership", membership, want, bound).await
}

async fn wait_for_state_in(
    pool: &PgPool,
    table: &str,
    membership: Uuid,
    want: &str,
    bound: u64,
) -> String {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(bound);
    loop {
        let last =
            sqlx::query_scalar::<_, String>(&format!("select state from {table} where id = $1"))
                .bind(membership)
                .fetch_one(pool)
                .await
                .expect("读成员状态");
        if last == want || std::time::Instant::now() > deadline {
            return last;
        }
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    }
}

/// 建一条已准入的 ActionExecution。
///
/// 它替代 Stage 2 才有的 Action 准入路径：谁可以邀请或撤销成员是那条路径的
/// 结论，不是本测试要验的东西。Core 的 lifecycle 端点拒绝任何非 ALLOWED 的
/// ActionExecution，因此这一步不能省——也正因为它在测试里而不在 Core 里，
/// Core 没有给自己发准入通行证。
async fn seed_action(pool: &PgPool, f: &Fixture, action_key: &str) -> Uuid {
    seed_action_for(pool, f, action_key, f.membership).await
}

async fn seed_action_for(pool: &PgPool, f: &Fixture, action_key: &str, target: Uuid) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        "insert into admission.action_execution
             (id, operation_id, tenant_id, action_key, action_version,
              initiator_principal_id, actor_principal_id, target_id, parameter_hash,
              gate_state, dispatch_state, correlation_id)
         values ($1, $2, $3, $4, 1, $5, $5, $6, 'verify', 'ALLOWED', 'NOT_DISPATCHED', $7)",
    )
    .bind(id)
    .bind(Uuid::new_v4())
    .bind(f.tenant)
    .bind(action_key)
    .bind(f.control_principal)
    .bind(target)
    .bind(Uuid::new_v4())
    .execute(pool)
    .await
    .expect("建 ActionExecution");
    id
}

async fn start_lifecycle(
    http: &reqwest::Client,
    e: &Env,
    token: &str,
    scope: &str,
    membership: Uuid,
    action: Uuid,
) -> reqwest::StatusCode {
    http.post(format!(
        "{}/service/v1/memberships/lifecycle",
        e.service_url
    ))
    .bearer_auth(token)
    .json(&serde_json::json!({
        "scope": scope,
        "membershipId": membership,
        "actionExecutionId": action,
    }))
    .send()
    .await
    .expect("调用 lifecycle endpoint")
    .status()
}

#[tokio::test]
async fn membership_lifecycle_converges_both_directions() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;

    let control = Keys::generate();
    let member = Keys::generate();
    let member_hex = member.public_key().to_hex();
    let host = format!(
        "l{}.kailo.local",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_micros()
    );

    OperatorIdentity::new(
        &e.operator_key,
        &e.relay_origin,
        &e.operator_audience,
        &e.operator_audience,
    )
    .expect("operator 身份")
    .provision_community(&http, &host, &control.public_key().to_hex())
    .await
    .expect("创建 Community");

    let secret_path = format!("buzz/control/{host}");
    let version = common::put_secret(
        &http,
        &e,
        &secret_path,
        &control.secret_key().to_secret_hex(),
    )
    .await;

    let f = seed_tenant_fixture(
        &pool,
        &host,
        &control.public_key().to_hex(),
        &member_hex,
        &format!("{}/{}/{}", e.bao_namespace, e.bao_mount, secret_path),
        version as i32,
        &e.core_identity,
    )
    .await;

    let outcome = std::panic::AssertUnwindSafe(run(
        &http,
        &e,
        &pool,
        &token,
        &f,
        &control,
        &member_hex,
        &host,
    ))
    .catch_unwind()
    .await;
    // 清理跨三个系统：Core 库、SpiceDB、Relay roster。断言中途失败时前两者
    // 都可能已经写入，只清 Core 会把授权面的残留留给下一次运行。
    let ws_object = workspace_object(&pool, &f).await;
    // BFF 调用建立的会话与夹具绑定的 OIDC 身份不挂在 Tenant 下，先按成员清掉
    for sql in [
        "delete from identity.platform_session where tenant_membership_id in
             (select id from identity.tenant_membership where tenant_id = $1)",
        "delete from identity.external_identity where human_identity_id in
             (select human_identity_id from identity.tenant_membership where tenant_id = $1)",
    ] {
        if let Err(err) = sqlx::query(sql).bind(f.tenant).execute(&pool).await {
            eprintln!("夹具清理失败：{sql}\n  {err}");
        }
    }
    common::cleanup(&e, &pool, &f).await;
    for (object, relation) in [
        (format!("tenant:{}", f.tenant), "member"),
        (ws_object.clone(), "member"),
        (ws_object, "admin"),
    ] {
        spicedb_delete(
            &e,
            &object,
            relation,
            &format!("principal:{}", f.member_principal),
        );
    }
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// 删掉一条关系。清理路径不断言成功：本就可能没写进去。
fn spicedb_delete(env: &Env, object: &str, relation: &str, subject: &str) {
    let _ = Command::new("sudo")
        .args([
            "-n",
            "docker",
            "run",
            "--rm",
            "--network",
            &env.docker_network,
            "--env-file",
            &env.zed_env_file,
            "-e",
            &format!("ZED_ENDPOINT={}", env.spicedb_in_network),
            "-e",
            "ZED_INSECURE=true",
            &env.zed_image,
            "relationship",
            "delete",
            object,
            relation,
            subject,
        ])
        .output();
}

#[allow(clippy::too_many_arguments)]
async fn run(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    token: &str,
    f: &Fixture,
    control: &Keys,
    member_hex: &str,
    host: &str,
) {
    let reader = IdentityClient::new(
        Custody::Server,
        &control.secret_key().to_secret_hex(),
        &e.relay_origin,
        host,
    )
    .expect("构造 roster 读取客户端");

    let tenant_object = format!("tenant:{}", f.tenant);
    let subject = format!("principal:{}", f.member_principal);

    // ---- 建立 ----
    //
    // 成员当前是 PROVISIONING：Core 的 fail-closed 状态先成立，投影才开始。
    let action = seed_action(pool, f, "membership.project").await;
    assert_eq!(
        start_lifecycle(http, e, token, "TENANT", f.membership, action).await,
        reqwest::StatusCode::OK,
        "启动建立 Workflow"
    );

    let state = wait_for_state(pool, f.membership, "ACTIVE", e.converge_bound_secs).await;
    assert_eq!(state, "ACTIVE", "建立应收敛到 ACTIVE");

    assert!(
        spicedb_has(e, &tenant_object, "member", &subject),
        "ACTIVE 后 SpiceDB 必须有该关系"
    );
    let roster = reader.roster(http, Scope::Relay).await.expect("读 roster");
    assert!(
        roster.iter().any(|r| r.pubkey == member_hex),
        "ACTIVE 后 roster 必须有该 pubkey，实际 {roster:?}"
    );

    // 重复启动同一 ActionExecution 不产生第二个 workflow ID：固定 ID 加
    // reuse/conflict 三项策略（DD-48）。
    assert_eq!(
        start_lifecycle(http, e, token, "TENANT", f.membership, action).await,
        reqwest::StatusCode::CONFLICT,
        "membership 版本已变，同一 ActionExecution 不应再起新 Workflow"
    );
    let refs: i64 =
        sqlx::query_scalar("select count(*) from projection.workflow_ref where tenant_id = $1")
            .bind(f.tenant)
            .fetch_one(pool)
            .await
            .expect("数 WorkflowRef");
    assert_eq!(refs, 1, "一个 ActionExecution 至多一个业务 Workflow");

    // ---- WORKSPACE scope ----
    //
    // 放在 Tenant 撤权**之前**：Tenant 撤权会把该 Principal 的 Buzz 身份一并置为
    // REVOKED，之后它在任何 Workspace 上都不该还能操作。先撤 Tenant 再建
    // Workspace 成员是现实里不会发生的顺序，拿它当核验只会验出一个假的通过。
    //
    // 同一条链的另一个目标层级：SpiceDB 客体换成 workspace，Buzz 侧从
    // relay roster 换成该 Workspace 绑定的 Channel roster（DD-41、DD-45）。
    // 两个层级共用一个 Workflow kind，靠 input 的 target type 区分——因此
    // 必须各验一遍，只验 TENANT 无法证明 WORKSPACE 那条分支走得通。
    //
    // Channel 由 CONTROL 身份在 Relay 上真实建立（DD-80）。
    let channel_uuid = Uuid::new_v4();
    reader
        .ensure_channel(http, &channel_uuid.to_string(), "workspace-verify")
        .await
        .expect("建立 Channel");

    let (workspace, ws_membership) = seed_workspace_fixture(pool, f, channel_uuid).await;
    let ws_action = seed_action_for(pool, f, "workspace.membership.project", ws_membership).await;
    assert_eq!(
        start_lifecycle(http, e, token, "WORKSPACE", ws_membership, ws_action).await,
        reqwest::StatusCode::OK,
        "启动 Workspace 建立 Workflow"
    );
    let ws_state = wait_for_state_in(
        pool,
        "identity.workspace_membership",
        ws_membership,
        "ACTIVE",
        e.converge_bound_secs,
    )
    .await;
    assert_eq!(ws_state, "ACTIVE", "Workspace 成员应收敛到 ACTIVE");

    assert!(
        spicedb_has(e, &format!("workspace:{workspace}"), "member", &subject),
        "ACTIVE 后 SpiceDB 必须有 workspace 关系"
    );
    let ch_roster = reader
        .roster(http, Scope::Channel(&channel_uuid.to_string()))
        .await
        .expect("读 Channel roster");
    assert!(
        ch_roster.iter().any(|r| r.pubkey == member_hex),
        "ACTIVE 后 Channel roster 必须有该 pubkey，实际 {ch_roster:?}"
    );

    // ---- Workspace 撤权的准入面（V-SCN-35）----
    //
    // 该成员同时持有此 Workspace 的 admin：DD-82 的角色是 relationship，这里以 zed
    // 直接注入，代表撤权之前已授予的角色。另建一位 ACTIVE Tenant 成员作为
    // workspace.member.add 的对象，让请求走到 scope guard 而不是停在目标解析。
    let member_subject = format!("ml-{}", &Uuid::new_v4().to_string()[..8]);
    bind_oidc_subject(pool, e, f, &member_subject).await;
    let other = seed_active_tenant_member(pool, f).await;
    let ws_object = format!("workspace:{workspace}");
    common::zed_relationship(e, "touch", &ws_object, "admin", &subject);
    let add_other = || {
        serde_json::json!({"actionKey":"workspace.member.add","idempotencyKey":Uuid::new_v4(),
            "workspaceId":workspace,"principalId":other})
    };

    // Workspace 撤权：同一条链反向
    sqlx::query(
        "update identity.workspace_membership set state = 'REVOKING', version = version + 1
         where id = $1",
    )
    .bind(ws_membership)
    .execute(pool)
    .await
    .expect("置 Workspace 成员 REVOKING");

    // REVOKING 一成立、投影尚未开始收敛，准入就必须拒绝：workspace#admin 仍在
    // SpiceDB 里，fresh workspace manage 为真，也不能替撤权中的成员放行。
    assert!(
        spicedb_has(e, &ws_object, "admin", &subject),
        "前提：撤权收敛前 workspace#admin 仍在"
    );
    let (st, body) = common::submit(http, e, &member_subject, add_other()).await;
    assert_eq!(
        st,
        reqwest::StatusCode::FORBIDDEN,
        "REVOKING 的 Workspace 成员凭 workspace admin 仍被放行：{body}"
    );
    assert_eq!(common::reason(&body), "SCOPE_GUARD_FAILED", "{body}");
    let ws_action = seed_action_for(pool, f, "workspace.membership.revoke", ws_membership).await;
    assert_eq!(
        start_lifecycle(http, e, token, "WORKSPACE", ws_membership, ws_action).await,
        reqwest::StatusCode::OK,
        "启动 Workspace 撤权 Workflow"
    );
    let ws_state = wait_for_state_in(
        pool,
        "identity.workspace_membership",
        ws_membership,
        "REVOKED",
        e.converge_bound_secs,
    )
    .await;
    assert_eq!(ws_state, "REVOKED", "Workspace 成员应收敛到 REVOKED");
    assert!(
        !spicedb_has(e, &format!("workspace:{workspace}"), "member", &subject),
        "REVOKED 后 SpiceDB 不应再有 workspace 关系"
    );
    let ch_roster = reader
        .roster(http, Scope::Channel(&channel_uuid.to_string()))
        .await
        .expect("读 Channel roster");
    assert!(
        !ch_roster.iter().any(|r| r.pubkey == member_hex),
        "REVOKED 后 Channel roster 不应再有该 pubkey，实际 {ch_roster:?}"
    );
    // Workspace 撤权撤掉此人在该 Workspace 上的全部关系，含角色（DD-82）；撤权
    // 之后，他原有的 workspace admin 也不能再放行。
    assert!(
        !spicedb_has(e, &ws_object, "admin", &subject),
        "REVOKED 后 SpiceDB 不应再有 workspace#admin"
    );
    let (st, body) = common::submit(http, e, &member_subject, add_other()).await;
    assert_eq!(
        st,
        reqwest::StatusCode::FORBIDDEN,
        "已撤的 Workspace 成员仍被放行：{body}"
    );
    assert_eq!(common::reason(&body), "SCOPE_GUARD_FAILED", "{body}");

    // ---- 撤权 ----
    //
    // Core 先置 REVOKING 并立即拒绝新动作，再由 Workflow 撤投影（.design/09
    // 第 5 步）。这一步在真实链路上由撤权动作的准入路径完成。
    let before = sqlx::query_scalar::<_, i32>(
        "update identity.tenant_membership set state = 'REVOKING', version = version + 1
         where id = $1 returning version",
    )
    .bind(f.membership)
    .fetch_one(pool)
    .await
    .expect("置 REVOKING");

    let action = seed_action(pool, f, "membership.revoke").await;
    assert_eq!(
        start_lifecycle(http, e, token, "TENANT", f.membership, action).await,
        reqwest::StatusCode::OK,
        "启动撤权 Workflow（版本 {before}）"
    );

    let state = wait_for_state(pool, f.membership, "REVOKED", e.converge_bound_secs).await;
    assert_eq!(state, "REVOKED", "撤权应收敛到 REVOKED");

    assert!(
        !spicedb_has(e, &tenant_object, "member", &subject),
        "REVOKED 后 SpiceDB 不应再有该关系"
    );
    let roster = reader.roster(http, Scope::Relay).await.expect("读 roster");
    assert!(
        !roster.iter().any(|r| r.pubkey == member_hex),
        "REVOKED 后 roster 不应再有该 pubkey，实际 {roster:?}"
    );

    // 工作台看得到终态：Workflow 未完成最后一次投影即不视为 terminal（06 §3.1）
    let status: String = sqlx::query_scalar(
        "select tp.status from projection.task_projection tp
         join projection.workflow_ref wr on wr.workflow_id = tp.workflow_id
         where wr.tenant_id = $1 and wr.kind = 'MEMBERSHIP_REVOCATION'
         order by tp.updated_at desc limit 1",
    )
    .bind(f.tenant)
    .fetch_one(pool)
    .await
    .expect("读任务投影");
    assert_eq!(status, "COMPLETED", "撤权 Workflow 的终态应已投影");
}

/// 给夹具成员绑定一个 OIDC subject，使它能经与网关投影相同的两条 header 调 BFF。
/// Stage 1 不注册登录开户，OIDC 侧的外部身份只能由夹具写（同 `bootstrapped::add_member`）。
async fn bind_oidc_subject(pool: &PgPool, e: &Env, f: &Fixture, subject: &str) {
    let provider: Uuid =
        sqlx::query_scalar("select id from identity.identity_provider where issuer = $1 limit 1")
            .bind(&e.oidc_issuer)
            .fetch_one(pool)
            .await
            .expect("部署 IdP");
    sqlx::query(
        "insert into identity.external_identity (id, provider_id, issuer, subject, human_identity_id, status)
         select $1, $2, $3, $4, human_identity_id, 'ACTIVE'
         from identity.tenant_membership where id = $5",
    )
    .bind(Uuid::new_v4())
    .bind(provider)
    .bind(&e.oidc_issuer)
    .bind(subject)
    .bind(f.membership)
    .execute(pool)
    .await
    .expect("绑定 OIDC subject");
}

/// 同 Tenant 的另一位 ACTIVE HUMAN 成员，只作 Workspace 动作的对象，不经投影。
async fn seed_active_tenant_member(pool: &PgPool, f: &Fixture) -> Uuid {
    let (human, principal) = (Uuid::new_v4(), Uuid::new_v4());
    sqlx::query(
        "insert into identity.human_identity (id, display_name, status) values ($1, 'verify', 'ACTIVE')",
    )
    .bind(human)
    .execute(pool)
    .await
    .expect("建 HumanIdentity");
    sqlx::query(
        "insert into identity.principal (id, tenant_id, kind, status) values ($1, $2, 'HUMAN', 'ACTIVE')",
    )
    .bind(principal)
    .bind(f.tenant)
    .execute(pool)
    .await
    .expect("建 Principal");
    sqlx::query(
        "insert into identity.tenant_membership
             (id, tenant_id, human_identity_id, tenant_principal_id, state)
         values ($1, $2, $3, $4, 'ACTIVE')",
    )
    .bind(Uuid::new_v4())
    .bind(f.tenant)
    .bind(human)
    .bind(principal)
    .execute(pool)
    .await
    .expect("建 TenantMembership");
    principal
}

/// 取该 Tenant 的 Workspace 关系客体，供清理用。
///
/// 在 `common::cleanup` 之前调用：那一步会把 Workspace 行删掉，之后就查不到
/// 该删哪条 SpiceDB 关系了。没有 Workspace 时返回一个不会命中的占位客体——
/// 删除路径本就允许目标不存在。
async fn workspace_object(pool: &PgPool, f: &Fixture) -> String {
    sqlx::query_scalar::<_, Uuid>("select id from identity.workspace where tenant_id = $1 limit 1")
        .bind(f.tenant)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .map(|id| format!("workspace:{id}"))
        .unwrap_or_else(|| format!("workspace:{}", Uuid::nil()))
}
