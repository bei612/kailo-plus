//! 成员投影链的端到端核验：Worker 令牌 → Core service API → CONTROL 代签 →
//! Buzz roster → 查证。
//!
//! 这是 Stage 1 退出门禁「成员建立与撤权完成 Channel roster 对账」中 Buzz 一侧
//! 的证据（`apps/02`、`DD-41`/`DD-45`）。链条上每一环都用真实实例，不打桩：
//! 真实 Keycloak 令牌、真实 OpenBao KV v2 版本、真实 Relay。
//!
//! 被投影的成员刻意用 `custody=CLIENT`：原生端本机持钥，Core 手里没有那把
//! 钥匙。撤权仍然成立，因为执行点是 roster 而不是「平台停止签名」
//! （`DD-75`、`.design/10` §4）。

use futures_util::FutureExt;
use kailo_buzz::bridge::{Custody, IdentityClient, Scope};
use kailo_buzz::operator::OperatorIdentity;
use nostr::Keys;
use sqlx::PgPool;

mod common;
use common::{cleanup, env, put_secret, seed_tenant_fixture, worker_token, Env, Fixture};

async fn project(
    http: &reqwest::Client,
    e: &Env,
    token: &str,
    f: &Fixture,
    version: i32,
    presence: &str,
) -> reqwest::StatusCode {
    http.post(format!(
        "{}/service/v1/membership-projections/buzz",
        e.service_url
    ))
    .bearer_auth(token)
    .json(&serde_json::json!({
        "scope": "TENANT",
        "membershipId": f.membership,
        "membershipVersion": version,
        "presence": presence,
    }))
    .send()
    .await
    .expect("调用投影 endpoint")
    .status()
}

/// 投影一次要到达终态；`SF-BUZ-34` 下 relay roster 快照可能落后，收敛上界是
/// 部署登记的对账间隔。这里替 Activity 的 RetryPolicy 做同一件事——按上界重试，
/// 而不是放宽断言。
async fn project_until_ok(
    http: &reqwest::Client,
    e: &Env,
    token: &str,
    f: &Fixture,
    version: i32,
    presence: &str,
) {
    let deadline =
        std::time::Instant::now() + std::time::Duration::from_secs(e.reconcile_bound_secs * 2 + 4);
    loop {
        let status = project(http, e, token, f, version, presence).await;
        if status.is_success() {
            return;
        }
        assert_eq!(
            status,
            reqwest::StatusCode::SERVICE_UNAVAILABLE,
            "只有「结果不明」才允许重试，得到 {status}"
        );
        assert!(
            std::time::Instant::now() < deadline,
            "在登记的收敛上界内未达到 {presence}"
        );
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
}

#[tokio::test]
async fn membership_projects_to_relay_roster_and_revokes() {
    let Some(e) = env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = worker_token(&http, &e).await;

    let control = Keys::generate();
    let member = Keys::generate();
    let member_hex = member.public_key().to_hex();
    let host = format!(
        "m{}.kailo.local",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_micros()
    );

    // Community 由 operator 建立，owner 是该 Tenant 的 CONTROL 身份
    // （SS-BUZ-OPERATOR：operator 只签名，不持有协作空间）。
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
    let version = put_secret(
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

    // 断言体单独跑：断言失败会 panic，写在这里的清理就跑不到，夹具会留在库里。
    // 留下的 SERVER binding 还会让下一次迁移演练失败（新列为空、三元组约束
    // 不成立）——测试残留会变成门禁故障。捕获 panic 后先清理再重抛。
    let outcome =
        std::panic::AssertUnwindSafe(run(&http, &e, &pool, &token, &f, &control, &member, &host))
            .catch_unwind()
            .await;
    cleanup(&e, &pool, &f).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[allow(clippy::too_many_arguments)]
async fn run(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    token: &str,
    f: &Fixture,
    control: &Keys,
    member: &Keys,
    host: &str,
) {
    let member_hex = member.public_key().to_hex();

    // 读 roster 用的是同一把 CONTROL 身份，但走的是 Core 之外的路径——
    // 不拿 Core 的返回值当证据，直接问 Relay。
    let reader = IdentityClient::new(
        Custody::Server,
        &control.secret_key().to_secret_hex(),
        &e.relay_origin,
        host,
    )
    .expect("构造 roster 读取客户端");

    // 1. 冻结版本不符必须拒绝，且是确定拒绝而非结果不明
    assert_eq!(
        project(http, e, token, f, 999, "PRESENT").await,
        reqwest::StatusCode::NOT_FOUND,
        "membership 版本不符必须拒绝"
    );

    // 2. 建立：投影后 roster 里应有该 pubkey
    project_until_ok(http, e, token, f, 1, "PRESENT").await;
    let roster = reader.roster(http, Scope::Relay).await.expect("读 roster");
    assert!(
        roster.iter().any(|r| r.pubkey == member_hex),
        "投影后应在 roster 中，实际 {roster:?}"
    );

    // 3. 重复执行仍成功——Activity 会重试，Worker 会崩溃重放
    project_until_ok(http, e, token, f, 1, "PRESENT").await;

    // 4. 撤权：roster 移除，且该 pubkey 随即发不出消息。
    //    成员是 CLIENT 托管，Core 手里没有它的私钥；撤权仍然成立，
    //    因为执行点是 roster（DD-75、.design/10 §4）。
    project_until_ok(http, e, token, f, 1, "ABSENT").await;
    let roster = reader.roster(http, Scope::Relay).await.expect("读 roster");
    assert!(
        !roster.iter().any(|r| r.pubkey == member_hex),
        "撤权后不应在 roster 中，实际 {roster:?}"
    );

    let revoked = IdentityClient::new(
        Custody::Server,
        &member.secret_key().to_secret_hex(),
        &e.relay_origin,
        host,
    )
    .expect("构造被撤权身份");
    assert!(
        revoked.roster(http, Scope::Relay).await.is_err(),
        "撤权后该 pubkey 连读都不该被放行"
    );

    // 5. binding 不是 ACTIVE 时拒绝投影：协作面没有准入执行点时不投影
    sqlx::query(
        "update projection.tenant_buzz_binding set state = 'DISABLED' where tenant_id = $1",
    )
    .bind(f.tenant)
    .execute(pool)
    .await
    .expect("停用 binding");
    assert_eq!(
        project(http, e, token, f, 1, "PRESENT").await,
        reqwest::StatusCode::FORBIDDEN,
        "binding 不是 ACTIVE 时必须拒绝"
    );
}
