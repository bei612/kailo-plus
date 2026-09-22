//! 端到端核验共用的夹具。
//!
//! 两个测试文件（membership_projection、membership_lifecycle）验的是同一条链的
//! 不同切面，夹具只写一份——两份会慢慢分叉，而分叉的夹具会让两边验的其实不是
//! 同一个系统。

#![allow(dead_code)]

use sqlx::PgPool;
use uuid::Uuid;

pub struct Env {
    pub service_url: String,
    pub token_url: String,
    /// Keycloak 按请求 Host 推导 issuer；令牌里的 iss 必须逐字符等于 Core
    /// 配置的那个，否则验签通过也会因 issuer 不符被拒。本机走发布端口连接，
    /// 因此必须显式带上网内的 Host——与 Relay 的 Community host 同一形状。
    pub token_host: String,
    pub worker_secret: String,
    pub database_url: String,
    pub bao_addr: String,
    pub bao_namespace: String,
    pub bao_mount: String,
    pub bao_role_id: String,
    pub bao_secret_id: String,
    pub core_identity: String,
    pub relay_origin: String,
    pub operator_key: String,
    pub reconcile_bound_secs: u64,
    /// 整条链的收敛上界。它比单个投影的上界大：Workflow 要串起 SpiceDB、
    /// roster 与状态跃迁三步，其中 roster 那步自身就以对账间隔为界。
    pub converge_bound_secs: u64,
    /// 独立取证用：直接问 SpiceDB 的 zed CLI 怎么跑。
    pub docker_network: String,
    pub zed_env_file: String,
    pub zed_image: String,
    pub spicedb_in_network: String,
    /// 平台引导建立的 Catalog Tenant 的 slug
    pub catalog_tenant_slug: String,
}

/// 集成核验要显式开启（`KAILO_INTEGRATION=1`），不按「某个环境变量碰巧存在」
/// 来判断——那些变量名与产品侧同名，而部署里它们指向网内地址。
pub fn env() -> Option<Env> {
    if std::env::var("KAILO_INTEGRATION").as_deref() != Ok("1") {
        return None;
    }
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
        converge_bound_secs: v("VERIFY_CONVERGE_BOUND_SECS")?.parse().ok()?,
        docker_network: v("VERIFY_DOCKER_NETWORK")?,
        zed_env_file: v("VERIFY_ZED_ENV_FILE")?,
        zed_image: v("VERIFY_ZED_IMAGE")?,
        spicedb_in_network: v("VERIFY_SPICEDB_ENDPOINT")?,
        catalog_tenant_slug: v("PLATFORM_CATALOG_TENANT_SLUG")?,
    })
}

pub async fn worker_token(http: &reqwest::Client, e: &Env) -> String {
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
pub async fn put_secret(http: &reqwest::Client, e: &Env, path: &str, value: &str) -> u32 {
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

pub struct Fixture {
    pub tenant: Uuid,
    pub control_principal: Uuid,
    pub member_principal: Uuid,
    pub membership: Uuid,
}

/// 在既有 Tenant 夹具上加一个 Workspace 与它的 Channel 绑定。
///
/// `channel_id` 必须是 Relay 分配的 UUID（SF-BUZ-33），由调用方先用 CONTROL
/// 身份建 Channel 再从 kind 39002 的 `d` 标签取得——这里不接受自造的 UUID，
/// 那会让 roster 投影发到一个不存在的 Channel 上。
pub async fn seed_workspace_fixture(pool: &PgPool, f: &Fixture, channel_id: Uuid) -> (Uuid, Uuid) {
    let workspace = Uuid::new_v4();
    let membership = Uuid::new_v4();
    sqlx::query(
        "insert into identity.workspace (id, tenant_id, slug, name, state)
         values ($1, $2, $3, $3, 'ACTIVE')",
    )
    .bind(workspace)
    .bind(f.tenant)
    .bind(format!("w-{}", &workspace.to_string()[..8]))
    .execute(pool)
    .await
    .expect("建 Workspace");

    // PROVISIONING：投影尚未对账，成员还不能进入该 Workspace（DD-41）
    sqlx::query(
        "insert into identity.workspace_membership
             (id, workspace_id, tenant_principal_id, state)
         values ($1, $2, $3, 'PROVISIONING')",
    )
    .bind(membership)
    .bind(workspace)
    .bind(f.member_principal)
    .execute(pool)
    .await
    .expect("建 WorkspaceMembership");

    sqlx::query(
        "insert into projection.workspace_buzz_binding (workspace_id, channel_id, state)
         values ($1, $2, 'ACTIVE')",
    )
    .bind(workspace)
    .bind(channel_id)
    .execute(pool)
    .await
    .expect("建 WorkspaceBuzzBinding");
    (workspace, membership)
}

#[allow(clippy::too_many_arguments)]
pub async fn seed_tenant_fixture(
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

pub async fn cleanup(pool: &PgPool, f: &Fixture) {
    // 按外键依赖的逆序。编排三张表是后加的——夹具清理漏了它们时，库里会攒下
    // 一堆孤立的 ActionExecution 与 WorkflowRef，下一次迁移演练就会撞上。
    for sql in [
        "delete from projection.workspace_buzz_binding where workspace_id in
             (select id from identity.workspace where tenant_id = $1)",
        "delete from identity.workspace_membership where workspace_id in
             (select id from identity.workspace where tenant_id = $1)",
        "delete from projection.task_projection where workflow_id in
             (select workflow_id from projection.workflow_ref where tenant_id = $1)",
        "delete from projection.workflow_ref where tenant_id = $1",
        "delete from admission.action_execution where tenant_id = $1",
        "delete from projection.tenant_buzz_binding where tenant_id = $1",
        "delete from identity.buzz_identity_binding where tenant_id = $1",
        "delete from identity.tenant_membership where tenant_id = $1",
        "delete from identity.workspace where tenant_id = $1",
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
