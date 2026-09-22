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
use common::{seed_tenant_fixture, Env, Fixture};

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
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(bound);
    loop {
        let last = sqlx::query_scalar::<_, String>(
            "select state from identity.tenant_membership where id = $1",
        )
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
    .bind(f.membership)
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
    f: &Fixture,
    action: Uuid,
) -> reqwest::StatusCode {
    http.post(format!(
        "{}/service/v1/memberships/lifecycle",
        e.service_url
    ))
    .bearer_auth(token)
    .json(&serde_json::json!({
        "scope": "TENANT",
        "membershipId": f.membership,
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
        "kailo-local",
        "kailo-local",
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
    common::cleanup(&pool, &f).await;
    spicedb_delete(
        &e,
        &format!("tenant:{}", f.tenant),
        "member",
        &format!("principal:{}", f.member_principal),
    );
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
        start_lifecycle(http, e, token, f, action).await,
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
        start_lifecycle(http, e, token, f, action).await,
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
        start_lifecycle(http, e, token, f, action).await,
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
         where wr.tenant_id = $1 and wr.kind = 'MEMBERSHIP_REVOCATION'",
    )
    .bind(f.tenant)
    .fetch_one(pool)
    .await
    .expect("读任务投影");
    assert_eq!(status, "COMPLETED", "撤权 Workflow 的终态应已投影");
}
