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
use uuid::Uuid;

struct Env {
    service_url: String,
    token_url: String,
    /// Keycloak 按请求 Host 推导 issuer；令牌里的 iss 必须逐字符等于 Core
    /// 配置的那个，否则验签通过也会因 issuer 不符被拒。本机走发布端口连接，
    /// 因此必须显式带上网内的 Host——与 Relay 的 Community host 同一形状。
    token_host: String,
    worker_secret: String,
    database_url: String,
    bao_addr: String,
    bao_namespace: String,
    bao_mount: String,
    bao_role_id: String,
    bao_secret_id: String,
    core_identity: String,
    relay_origin: String,
    operator_key: String,
    reconcile_bound_secs: u64,
}

fn env() -> Option<Env> {
    let v = |k: &str| std::env::var(k).ok().filter(|s| !s.is_empty());
    Some(Env {
        service_url: v("CORE_SERVICE_URL")?,
        token_url: v("OIDC_TOKEN_URL")?,
        token_host: v("OIDC_TOKEN_HOST")?,
        worker_secret: v("WORKER_CLIENT_SECRET")?,
        database_url: v("DATABASE_URL")?,
        bao_addr: v("OPENBAO_ADDR")?,
        bao_namespace: v("OPENBAO_PLATFORM_NAMESPACE")?,
        bao_mount: v("OPENBAO_KV_MOUNT")?,
        bao_role_id: v("OPENBAO_ROLE_ID")?,
        bao_secret_id: v("OPENBAO_SECRET_ID")?,
        core_identity: v("OPENBAO_SERVICE_IDENTITY")?,
        relay_origin: v("RELAY_OPERATOR_API_ORIGIN")?,
        operator_key: v("RELAY_OPERATOR_PRIVATE_KEY")?,
        reconcile_bound_secs: v("BUZZ_NIP43_RECONCILE_INTERVAL_SECS")?.parse().ok()?,
    })
}

async fn worker_token(http: &reqwest::Client, e: &Env) -> String {
    let body: serde_json::Value = http
        .post(&e.token_url)
        .header(reqwest::header::HOST, &e.token_host)
        .form(&[
            ("grant_type", "client_credentials"),
            ("client_id", "kailo-worker"),
            ("client_secret", &e.worker_secret),
        ])
        .send()
        .await
        .expect("取 Worker 令牌")
        .json()
        .await
        .expect("解析令牌响应");
    body["access_token"]
        .as_str()
        .expect("access_token")
        .to_owned()
}

/// 把 CONTROL 私钥写进 OpenBao 的 KV v2，返回版本号。
///
/// 用 Core 自己的 AppRole 凭据写：策略给了 `create/update`，这也顺带证明
/// 那条策略确实是 Core 能用的那条，而不是写在文件里没生效。
async fn put_secret(http: &reqwest::Client, e: &Env, path: &str, value: &str) -> u32 {
    let login: serde_json::Value = http
        .post(format!("{}/v1/auth/approle/login", e.bao_addr))
        .header("X-Vault-Namespace", &e.bao_namespace)
        .json(&serde_json::json!({"role_id": e.bao_role_id, "secret_id": e.bao_secret_id}))
        .send()
        .await
        .expect("AppRole 登录")
        .json()
        .await
        .expect("解析登录响应");
    let token = login["auth"]["client_token"]
        .as_str()
        .expect("client_token");

    let written: serde_json::Value = http
        .post(format!("{}/v1/{}/data/{path}", e.bao_addr, e.bao_mount))
        .header("X-Vault-Namespace", &e.bao_namespace)
        .header("X-Vault-Token", token)
        .json(&serde_json::json!({"data": {"value": value}}))
        .send()
        .await
        .expect("写 KV")
        .json()
        .await
        .expect("解析写入响应");
    written["data"]["version"].as_u64().expect("version") as u32
}

struct Fixture {
    tenant: Uuid,
    control_principal: Uuid,
    member_principal: Uuid,
    membership: Uuid,
}

#[allow(clippy::too_many_arguments)]
async fn seed(
    pool: &PgPool,
    host: &str,
    control_pubkey: &str,
    member_pubkey: &str,
    secret_path: &str,
    secret_version: i32,
    audience: &str,
) -> Fixture {
    let f = Fixture {
        tenant: Uuid::new_v4(),
        control_principal: Uuid::new_v4(),
        member_principal: Uuid::new_v4(),
        membership: Uuid::new_v4(),
    };
    let human = Uuid::new_v4();
    sqlx::query(
        "insert into identity.tenant (id, slug, name, state) values ($1, $2, $2, 'ACTIVE')",
    )
    .bind(f.tenant)
    .bind(format!("t-{}", &f.tenant.to_string()[..8]))
    .execute(pool)
    .await
    .expect("建 Tenant");
    for (id, kind) in [
        (f.control_principal, "SERVICE"),
        (f.member_principal, "HUMAN"),
    ] {
        sqlx::query(
            "insert into identity.principal (id, tenant_id, kind, status)
             values ($1, $2, $3, 'ACTIVE')",
        )
        .bind(id)
        .bind(f.tenant)
        .bind(kind)
        .execute(pool)
        .await
        .expect("建 Principal");
    }
    sqlx::query(
        "insert into identity.human_identity (id, display_name, status) values ($1, 'verify', 'ACTIVE')",
    )
    .bind(human)
    .execute(pool)
    .await
    .expect("建 HumanIdentity");
    // PROVISIONING：投影尚未对账，成员还不能执行任何动作（DD-45）
    sqlx::query(
        "insert into identity.tenant_membership
             (id, tenant_id, human_identity_id, tenant_principal_id, state)
         values ($1, $2, $3, $4, 'PROVISIONING')",
    )
    .bind(f.membership)
    .bind(f.tenant)
    .bind(human)
    .bind(f.member_principal)
    .execute(pool)
    .await
    .expect("建 TenantMembership");

    // CONTROL：SERVER 托管，三列 SecretRef 俱全
    sqlx::query(
        "insert into identity.buzz_identity_binding
             (tenant_id, principal_id, pubkey, custody, private_key_secret_ref,
              private_key_secret_version, private_key_secret_audience, kind, state)
         values ($1, $2, $3, 'SERVER', $4, $5, $6, 'CONTROL', 'ACTIVE')",
    )
    .bind(f.tenant)
    .bind(f.control_principal)
    .bind(control_pubkey)
    .bind(secret_path)
    .bind(secret_version)
    .bind(audience)
    .execute(pool)
    .await
    .expect("建 CONTROL binding");

    // 成员：CLIENT 托管，Core 手里没有它的私钥——撤权照样成立（DD-75）
    sqlx::query(
        "insert into identity.buzz_identity_binding
             (tenant_id, principal_id, pubkey, custody, kind, state)
         values ($1, $2, $3, 'CLIENT', 'HUMAN', 'ACTIVE')",
    )
    .bind(f.tenant)
    .bind(f.member_principal)
    .bind(member_pubkey)
    .execute(pool)
    .await
    .expect("建成员 binding");

    sqlx::query(
        "insert into projection.tenant_buzz_binding
             (tenant_id, community_id, normalized_host, control_service_principal_id,
              require_relay_membership, allow_nip_oa_auth, pubkey_allowlist_enabled,
              nip11_snapshot_digest, nip11_observed_at, state)
         values ($1, $2, $3, $4, true, false, false, 'verify-digest', now(), 'ACTIVE')",
    )
    .bind(f.tenant)
    .bind(Uuid::new_v4())
    .bind(host)
    .bind(f.control_principal)
    .execute(pool)
    .await
    .expect("建 TenantBuzzBinding");
    f
}

async fn cleanup(pool: &PgPool, f: &Fixture) {
    for sql in [
        "delete from projection.tenant_buzz_binding where tenant_id = $1",
        "delete from identity.buzz_identity_binding where tenant_id = $1",
        "delete from identity.tenant_membership where tenant_id = $1",
        "delete from identity.principal where tenant_id = $1",
        "delete from identity.tenant where id = $1",
    ] {
        let _ = sqlx::query(sql).bind(f.tenant).execute(pool).await;
    }
    let _ = sqlx::query(
        "delete from identity.human_identity where id not in
         (select human_identity_id from identity.tenant_membership)
         and display_name = 'verify'",
    )
    .execute(pool)
    .await;
}

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
        "kailo-local",
        "kailo-local",
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

    let f = seed(
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
    cleanup(&pool, &f).await;
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
