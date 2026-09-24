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
    /// 与 Core 同策略的核验令牌（`core/verify/integration-env.sh` 现签）
    pub bao_token: String,
    pub core_identity: String,
    pub relay_origin: String,
    pub operator_key: String,
    pub operator_audience: String,
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
    pub bff_url: String,
    pub oidc_issuer: String,
    pub stream_readmit_seconds: u64,
    pub stream_retry_millis: u64,
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
        bao_token: v("OPENBAO_VERIFY_TOKEN")?,
        core_identity: v("OPENBAO_SERVICE_IDENTITY")?,
        relay_origin: v("RELAY_OPERATOR_API_ORIGIN")?,
        operator_key: v("RELAY_OPERATOR_PRIVATE_KEY")?,
        operator_audience: v("RELAY_OPERATOR_AUDIENCE")?,
        reconcile_bound_secs: v("BUZZ_NIP43_RECONCILE_INTERVAL_SECS")?.parse().ok()?,
        converge_bound_secs: v("VERIFY_CONVERGE_BOUND_SECS")?.parse().ok()?,
        docker_network: v("VERIFY_DOCKER_NETWORK")?,
        zed_env_file: v("VERIFY_ZED_ENV_FILE")?,
        zed_image: v("VERIFY_ZED_IMAGE")?,
        spicedb_in_network: v("VERIFY_SPICEDB_ENDPOINT")?,
        catalog_tenant_slug: v("PLATFORM_CATALOG_TENANT_SLUG")?,
        bff_url: v("VERIFY_BFF_URL")?,
        oidc_issuer: v("OIDC_ISSUER")?,
        stream_readmit_seconds: v("BFF_STREAM_READMIT_SECONDS")?.parse().ok()?,
        stream_retry_millis: v("BFF_STREAM_RETRY_MILLIS")?.parse().ok()?,
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
/// 用与 Core 同策略（`kailo-core`）的核验令牌写：策略给了 `create/update`，这也
/// 顺带证明那条策略确实给出这些能力，而不是写在文件里没生效。
pub async fn put_secret(http: &reqwest::Client, e: &Env, path: &str, value: &str) -> u32 {
    let token = e.bao_token.as_str();

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

/// 夹具 Tenant 在 Relay 上的 Community 随夹具一起退役。
///
/// Core 库里的行删掉之后，没有任何东西再指向那个 Community，而 Relay 的
/// operator 面只能按 owner 列举——CONTROL 身份一删，它就再也找不回来，只会在
/// Relay 里越攒越多。因此必须在删行**之前**、趁还读得到 host 与 owner 时归档。
/// 夹具从未真正开通（伪造 host）时 Relay 回 404，那是没有可退役的东西。
///
/// 失败以返回值交给调用方，而不是当场 panic：panic 会让其后的库表清理一行
/// 都不执行，一次 Relay 侧的失败就变成 Core 库里整组残留。调用方先做完其余
/// 清理，最后再把它报出来。
pub async fn retire_relay_community(e: &Env, pool: &PgPool, tenant: Uuid) -> Result<(), String> {
    let row: Option<(String, String)> = sqlx::query_as(
        "select b.normalized_host, i.pubkey
         from projection.tenant_buzz_binding b
         join identity.buzz_identity_binding i
           on i.tenant_id = b.tenant_id and i.principal_id = b.control_service_principal_id
         where b.tenant_id = $1 and i.custody = 'SERVER'",
    )
    .bind(tenant)
    .fetch_optional(pool)
    .await
    .map_err(|err| format!("读取 TenantBuzzBinding：{err}"))?;
    let Some((host, owner)) = row else {
        return Ok(());
    };
    let operator = kailo_buzz::operator::OperatorIdentity::new(
        &e.operator_key,
        &e.relay_origin,
        &e.operator_audience,
        &e.operator_audience,
    )
    .map_err(|err| format!("operator 身份：{err}"))?;
    match operator
        .archive_community(&reqwest::Client::new(), &host, &owner)
        .await
    {
        Ok(_) | Err(kailo_buzz::operator::OperatorError::Rejected { status: 404, .. }) => Ok(()),
        Err(err) => Err(format!("归档夹具 Community {host} 失败：{err}")),
    }
}

pub async fn cleanup(e: &Env, pool: &PgPool, f: &Fixture) {
    let retired = retire_relay_community(e, pool, f.tenant).await;
    // 按外键依赖的逆序。编排三张表是后加的——夹具清理漏了它们时，库里会攒下
    // 一堆孤立的 ActionExecution 与 WorkflowRef，下一次迁移演练就会撞上。
    //
    // 失败不吞掉：`let _ = ...` 曾经让「审计外键挡住 Tenant 删除」这件事
    // 静默发生，库里攒了几轮租户才被发现。清不掉要当场说出来。
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
        // 收藏/静音/已读挂在 principal 上（外键），必须先于 principal 删除
        "delete from identity.collaboration_user_state where tenant_principal_id in
             (select id from identity.principal where tenant_id = $1)",
        "delete from admission.publish_attempt where tenant_principal_id in
             (select id from identity.principal where tenant_id = $1)",
        "delete from identity.principal where tenant_id = $1",
        "delete from identity.tenant where id = $1",
    ] {
        if let Err(e) = sqlx::query(sql).bind(f.tenant).execute(pool).await {
            eprintln!("夹具清理失败：{sql}\n  {e}");
        }
    }
    if let Err(e) = sqlx::query(
        "delete from identity.human_identity where id not in
         (select human_identity_id from identity.tenant_membership)
         and display_name = 'verify'",
    )
    .execute(pool)
    .await
    {
        eprintln!("夹具清理失败（human_identity）：{e}");
    }

    // 复核而不是相信：上面每一句都可能因为新增的引用而被挡住，而那种失败
    // 只在下一次跑别的用例时才表现出来。
    let left: i64 = sqlx::query_scalar("select count(*) from identity.tenant where id = $1")
        .bind(f.tenant)
        .fetch_one(pool)
        .await
        .unwrap_or(-1);
    assert_eq!(left, 0, "夹具 Tenant {} 没有被清掉", f.tenant);
    if let Err(err) = retired {
        panic!("{err}");
    }
}

/// 一个完全由真实生命周期产出的 Workspace 夹具。
///
/// 与 `seed_tenant_fixture` 的区别是它**不手工 seed 任何 Buzz 事实**：Tenant、
/// Workspace、两级成员都经各自的 Workflow 产出，HUMAN 的 Buzz 身份因此是投影链
/// 自己建起来的。只有 OIDC 侧的三张表是手工写的——Stage 1 不注册登录开户。
pub struct LiveWorkspace {
    /// Catalog Tenant 下的发起方 SERVICE Principal。它不属于夹具 Tenant，
    /// 按 Tenant 清理够不着它，必须单独删。
    pub initiator: Uuid,
    pub tenant: Uuid,
    pub workspace: Uuid,
    pub principal: Uuid,
    pub human: Uuid,
    pub subject: String,
    pub workspace_membership: Uuid,
    pub provider: Uuid,
}

/// 启动一条生命周期 Workflow 并等它把目标推到 `want`。
struct AwaitTarget<'a> {
    endpoint: &'a str,
    body: serde_json::Value,
    table: &'a str,
    id: Uuid,
    want: &'a str,
}

async fn start_and_wait(
    http: &reqwest::Client,
    e: &Env,
    token: &str,
    pool: &PgPool,
    t: AwaitTarget<'_>,
) -> Result<(), String> {
    let AwaitTarget {
        endpoint,
        body,
        table,
        id,
        want,
    } = t;
    let status = http
        .post(format!("{}{endpoint}", e.service_url))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|err| err.to_string())?
        .status();
    if !status.is_success() {
        return Err(format!("{endpoint} 返回 {status}"));
    }
    let deadline =
        std::time::Instant::now() + std::time::Duration::from_secs(e.converge_bound_secs);
    loop {
        let got: String = sqlx::query_scalar(&format!("select state from {table} where id = $1"))
            .bind(id)
            .fetch_one(pool)
            .await
            .map_err(|err| err.to_string())?;
        if got == want {
            return Ok(());
        }
        if std::time::Instant::now() > deadline {
            return Err(format!("{table}/{id} 停在 {got}，未到 {want}"));
        }
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    }
}

async fn allowed_action(
    pool: &PgPool,
    tenant: Uuid,
    initiator: Uuid,
    target: Uuid,
) -> Result<Uuid, String> {
    let id = Uuid::new_v4();
    sqlx::query(
        "insert into admission.action_execution
             (id, operation_id, tenant_id, action_key, action_version,
              initiator_principal_id, actor_principal_id, target_id, parameter_hash,
              gate_state, dispatch_state, correlation_id)
         values ($1, $2, $3, 'verify.provision', 1, $4, $4, $5, 'verify',
                 'ALLOWED', 'NOT_DISPATCHED', $6)",
    )
    .bind(id)
    .bind(Uuid::new_v4())
    .bind(tenant)
    .bind(initiator)
    .bind(target)
    .bind(Uuid::new_v4())
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

pub async fn provision_live_workspace(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    token: &str,
) -> Result<LiveWorkspace, String> {
    let subject = format!("verify-{}", &Uuid::new_v4().to_string()[..8]);
    provision_live_workspace_for(http, e, pool, token, &subject).await
}

/// 同上，但 OIDC subject 由调用方给定。
///
/// 真实浏览器走查要用 IdP 里一个真能登录的用户，它的 subject 由 IdP 签发、
/// 不能由夹具编造；其余一切——Tenant、Workspace、两级成员、Buzz binding——
/// 仍走与集成测试完全相同的 lifecycle Workflow。
pub async fn provision_live_workspace_for(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    token: &str,
    subject: &str,
) -> Result<LiveWorkspace, String> {
    // 标识先分配好：开通中途失败时，已建出的部分（Tenant、Community、Workflow
    // 引用）按同一份标识拆掉，不在库和 Relay 里留下半开通的残骸
    let mut fx = LiveWorkspace {
        initiator: Uuid::new_v4(),
        tenant: Uuid::new_v4(),
        workspace: Uuid::new_v4(),
        principal: Uuid::new_v4(),
        human: Uuid::new_v4(),
        subject: subject.to_owned(),
        workspace_membership: Uuid::new_v4(),
        provider: Uuid::new_v4(),
    };
    match provision_steps(http, e, pool, token, &mut fx).await {
        Ok(()) => Ok(fx),
        Err(msg) => {
            eprintln!("开通失败，拆除已建部分：{msg}");
            teardown_live_workspace(e, pool, &fx).await;
            Err(msg)
        }
    }
}

async fn provision_steps(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    token: &str,
    fx: &mut LiveWorkspace,
) -> Result<(), String> {
    let catalog: Uuid = sqlx::query_scalar("select id from identity.tenant where slug = $1")
        .bind(&e.catalog_tenant_slug)
        .fetch_one(pool)
        .await
        .map_err(|err| format!("Catalog Tenant 应由平台引导建立: {err}"))?;
    let initiator = fx.initiator;
    sqlx::query("insert into identity.principal (id, tenant_id, kind, status) values ($1,$2,'SERVICE','ACTIVE')")
        .bind(initiator).bind(catalog).execute(pool).await.map_err(|e| e.to_string())?;

    // Tenant
    let tenant = fx.tenant;
    let slug = format!("v{}", &tenant.to_string()[..8]);
    sqlx::query(
        "insert into identity.tenant (id, slug, name, state) values ($1,$2,$2,'PROVISIONING')",
    )
    .bind(tenant)
    .bind(&slug)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    let action = allowed_action(pool, tenant, initiator, tenant).await?;
    start_and_wait(
        http,
        e,
        token,
        pool,
        AwaitTarget {
            endpoint: "/service/v1/scopes/lifecycle",
            body: serde_json::json!({"kind":"TENANT","id":tenant,"actionExecutionId":action}),
            table: "identity.tenant",
            id: tenant,
            want: "ACTIVE",
        },
    )
    .await?;

    // Workspace
    let workspace = fx.workspace;
    sqlx::query("insert into identity.workspace (id, tenant_id, slug, name, state) values ($1,$2,$3,$3,'PROVISIONING')")
        .bind(workspace).bind(tenant).bind(format!("w{}", &workspace.to_string()[..8]))
        .execute(pool).await.map_err(|e| e.to_string())?;
    let action = allowed_action(pool, tenant, initiator, workspace).await?;
    start_and_wait(
        http,
        e,
        token,
        pool,
        AwaitTarget {
            endpoint: "/service/v1/scopes/lifecycle",
            body: serde_json::json!({"kind":"WORKSPACE","id":workspace,"actionExecutionId":action}),
            table: "identity.workspace",
            id: workspace,
            want: "ACTIVE",
        },
    )
    .await?;

    // OIDC 侧身份：Stage 1 不注册登录开户，这三张表由夹具写
    let human = fx.human;
    let subject = fx.subject.clone();
    sqlx::query("insert into identity.human_identity (id, display_name, status) values ($1,'verify','ACTIVE')")
        .bind(human).execute(pool).await.map_err(|e| e.to_string())?;
    sqlx::query("insert into identity.identity_provider (id, issuer, client_id, claim_mapping_version, status)
                 values ($1,$2,$3,1,'ACTIVE') on conflict (issuer, client_id) do nothing")
        .bind(fx.provider).bind(&e.oidc_issuer).bind(&subject)
        .execute(pool).await.map_err(|e| e.to_string())?;
    let provider: Uuid = sqlx::query_scalar(
        "select id from identity.identity_provider where issuer=$1 and client_id=$2",
    )
    .bind(&e.oidc_issuer)
    .bind(&subject)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    fx.provider = provider;
    sqlx::query("insert into identity.external_identity (id, provider_id, issuer, subject, human_identity_id, status)
                 values ($1,$2,$3,$4,$5,'ACTIVE')")
        .bind(Uuid::new_v4()).bind(provider).bind(&e.oidc_issuer).bind(&subject).bind(human)
        .execute(pool).await.map_err(|e| e.to_string())?;

    // Tenant 成员
    let principal = fx.principal;
    sqlx::query("insert into identity.principal (id, tenant_id, kind, status) values ($1,$2,'HUMAN','ACTIVE')")
        .bind(principal).bind(tenant).execute(pool).await.map_err(|e| e.to_string())?;
    let membership = Uuid::new_v4();
    sqlx::query("insert into identity.tenant_membership (id, tenant_id, human_identity_id, tenant_principal_id, state)
                 values ($1,$2,$3,$4,'PROVISIONING')")
        .bind(membership).bind(tenant).bind(human).bind(principal)
        .execute(pool).await.map_err(|e| e.to_string())?;
    let action = allowed_action(pool, tenant, initiator, membership).await?;
    start_and_wait(http, e, token, pool, AwaitTarget {
        endpoint: "/service/v1/memberships/lifecycle",
        body: serde_json::json!({"scope":"TENANT","membershipId":membership,"actionExecutionId":action}),
        table: "identity.tenant_membership",
        id: membership,
        want: "ACTIVE",
    })
    .await?;

    // Workspace 成员
    let workspace_membership = fx.workspace_membership;
    sqlx::query(
        "insert into identity.workspace_membership (id, workspace_id, tenant_principal_id, state)
                 values ($1,$2,$3,'PROVISIONING')",
    )
    .bind(workspace_membership)
    .bind(workspace)
    .bind(principal)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    let action = allowed_action(pool, tenant, initiator, workspace_membership).await?;
    start_and_wait(http, e, token, pool, AwaitTarget {
        endpoint: "/service/v1/memberships/lifecycle",
        body: serde_json::json!({"scope":"WORKSPACE","membershipId":workspace_membership,"actionExecutionId":action}),
        table: "identity.workspace_membership",
        id: workspace_membership,
        want: "ACTIVE",
    })
    .await?;

    Ok(())
}

pub async fn teardown_live_workspace(e: &Env, pool: &PgPool, fx: &LiveWorkspace) {
    let retired = retire_relay_community(e, pool, fx.tenant).await;
    // SpiceDB 侧：Workspace 归属与两级成员关系
    for (object, relation, subject) in [
        (
            format!("workspace:{}", fx.workspace),
            "tenant",
            format!("tenant:{}", fx.tenant),
        ),
        (
            format!("workspace:{}", fx.workspace),
            "member",
            format!("principal:{}", fx.principal),
        ),
        (
            format!("tenant:{}", fx.tenant),
            "member",
            format!("principal:{}", fx.principal),
        ),
    ] {
        let _ = std::process::Command::new("sudo")
            .args([
                "-n",
                "docker",
                "run",
                "--rm",
                "--network",
                &e.docker_network,
                "--env-file",
                &e.zed_env_file,
                "-e",
                &format!("ZED_ENDPOINT={}", e.spicedb_in_network),
                "-e",
                "ZED_INSECURE=true",
                &e.zed_image,
                "relationship",
                "delete",
                &object,
                relation,
                &subject,
            ])
            .output();
    }
    for sql in [
        "delete from identity.platform_session where human_identity_id = $2",
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
        // 收藏/静音/已读挂在 principal 上（外键），必须先于 principal 删除
        "delete from identity.collaboration_user_state where tenant_principal_id in
             (select id from identity.principal where tenant_id = $1)",
        "delete from admission.publish_attempt where tenant_principal_id in
             (select id from identity.principal where tenant_id = $1)",
        "delete from identity.principal where tenant_id = $1",
        "delete from identity.tenant where id = $1",
        "delete from identity.external_identity where human_identity_id = $2",
        "delete from identity.human_identity where id = $2",
        "delete from identity.identity_provider where id = $3",
    ] {
        if let Err(err) = sqlx::query(sql)
            .bind(fx.tenant)
            .bind(fx.human)
            .bind(fx.provider)
            .execute(pool)
            .await
        {
            eprintln!("夹具清理失败：{sql}\n  {err}");
        }
    }
    if let Err(err) = sqlx::query("delete from identity.principal where id = $1")
        .bind(fx.initiator)
        .execute(pool)
        .await
    {
        eprintln!("夹具清理失败（发起方 Principal）：{err}");
    }
    let left: i64 = sqlx::query_scalar(
        "select (select count(*) from identity.tenant where id = $1)
              + (select count(*) from identity.principal where id = $2)",
    )
    .bind(fx.tenant)
    .bind(fx.initiator)
    .fetch_one(pool)
    .await
    .unwrap_or(-1);
    assert_eq!(
        left, 0,
        "夹具 Tenant {} 或发起方 Principal {} 没有被清掉",
        fx.tenant, fx.initiator
    );
    if let Err(err) = retired {
        panic!("{err}");
    }
}

/// 原生端核验所需的环境（DD-78）。与 `Env` 分开：只有原生端用例需要它。
pub struct NativeEnv {
    /// 网关原生入口
    pub native_url: String,
    /// IdP 的本机发布地址；请求时以 `idp_host` 作 Host，令牌 `iss` 才与配置一致
    pub keycloak_url: String,
    pub idp_host: String,
    pub realm: String,
    pub native_client_id: String,
    pub user: String,
    pub user_password_file: String,
    pub admin_user: String,
    pub admin_password_file: String,
    pub proof_window_secs: u64,
    pub keys_per_principal: usize,
}

pub fn native_env() -> Option<NativeEnv> {
    if std::env::var("KAILO_INTEGRATION").as_deref() != Ok("1") {
        return None;
    }
    let v = |k: &str| std::env::var(k).ok().filter(|s| !s.is_empty());
    Some(NativeEnv {
        native_url: v("VERIFY_NATIVE_URL")?,
        keycloak_url: v("VERIFY_KEYCLOAK_URL")?,
        idp_host: v("OIDC_TOKEN_HOST")?,
        realm: v("OIDC_REALM")?,
        native_client_id: v("OIDC_NATIVE_CLIENT_ID")?,
        user: v("VERIFY_USER")?,
        user_password_file: v("VERIFY_USER_PASSWORD_FILE")?,
        admin_user: v("KEYCLOAK_ADMIN_USER")?,
        admin_password_file: v("VERIFY_KEYCLOAK_ADMIN_PASSWORD_FILE")?,
        proof_window_secs: v("BFF_CLIENT_KEY_PROOF_WINDOW_SECONDS")?.parse().ok()?,
        keys_per_principal: v("BFF_CLIENT_KEYS_PER_PRINCIPAL")?.parse().ok()?,
    })
}

fn read_secret(path: &str) -> String {
    std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("读 {path} 失败: {e}"))
        .trim()
        .to_owned()
}

/// IdP 为核验用户签发的 subject。它由 IdP 决定，夹具编造不出来。
pub async fn idp_subject(http: &reqwest::Client, n: &NativeEnv) -> String {
    let token: serde_json::Value = http
        .post(format!(
            "{}/realms/master/protocol/openid-connect/token",
            n.keycloak_url
        ))
        .form(&[
            ("grant_type", "password"),
            ("client_id", "admin-cli"),
            ("username", n.admin_user.as_str()),
            ("password", read_secret(&n.admin_password_file).as_str()),
        ])
        .send()
        .await
        .expect("取 IdP 管理令牌")
        .json()
        .await
        .expect("管理令牌 JSON");
    let users: Vec<serde_json::Value> = http
        .get(format!("{}/admin/realms/{}/users", n.keycloak_url, n.realm))
        .query(&[("username", n.user.as_str()), ("exact", "true")])
        .bearer_auth(token["access_token"].as_str().expect("access_token"))
        .send()
        .await
        .expect("查 IdP 用户")
        .json()
        .await
        .expect("IdP 用户 JSON");
    assert_eq!(users.len(), 1, "用户名 {} 应恰好对应 1 个 IdP 用户", n.user);
    users[0]["id"].as_str().expect("id").to_owned()
}

/// 像原生应用那样取访问令牌：RFC 8252 授权码 + PKCE，本机回环 redirect。
///
/// 回环地址不真的监听：IdP 把授权码放在 302 的 Location 里，读出来即可。IdP 的
/// 会话 cookie 手工携带——测试不为这一处引入 cookie 依赖。
pub async fn native_access_token(n: &NativeEnv) -> String {
    use base64::Engine as _;
    use sha2::Digest as _;
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("http client");
    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let verifier = b64.encode(Uuid::new_v4().as_bytes().repeat(3));
    let challenge = b64.encode(sha2::Sha256::digest(verifier.as_bytes()));
    let redirect = "http://127.0.0.1:53682/callback";
    // IdP 页面里的地址是对外名字；换成本机发布地址，Host 保持对外名字
    let local = |url: &str| {
        let u = reqwest::Url::parse(url).expect("IdP 地址");
        format!(
            "{}{}{}",
            n.keycloak_url,
            u.path(),
            u.query().map(|q| format!("?{q}")).unwrap_or_default()
        )
    };
    let mut cookies: Vec<String> = Vec::new();
    let mut keep = |resp: &reqwest::Response| {
        for c in resp.headers().get_all(reqwest::header::SET_COOKIE) {
            if let Some(pair) = c.to_str().ok().and_then(|s| s.split(';').next()) {
                cookies.push(pair.to_owned());
            }
        }
    };

    let auth = http
        .get(format!(
            "{}/realms/{}/protocol/openid-connect/auth",
            n.keycloak_url, n.realm
        ))
        .header(reqwest::header::HOST, &n.idp_host)
        .query(&[
            ("response_type", "code"),
            ("client_id", n.native_client_id.as_str()),
            ("redirect_uri", redirect),
            ("scope", "openid"),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
        ])
        .send()
        .await
        .expect("打开授权页");
    keep(&auth);
    let page = auth.text().await.expect("授权页");
    let action = page
        .split("action=\"")
        .nth(1)
        .and_then(|s| s.split('"').next())
        .expect("登录表单 action")
        .replace("&amp;", "&");
    let login = http
        .post(local(&action))
        .header(reqwest::header::HOST, &n.idp_host)
        .header(reqwest::header::COOKIE, cookies.join("; "))
        .form(&[
            ("username", n.user.as_str()),
            ("password", read_secret(&n.user_password_file).as_str()),
        ])
        .send()
        .await
        .expect("提交登录");
    let location = login
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    assert!(
        location.starts_with(redirect),
        "登录后应回到回环地址，得到 {location}"
    );
    let code = reqwest::Url::parse(&location)
        .expect("回调地址")
        .query_pairs()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.into_owned())
        .expect("授权码");
    let token: serde_json::Value = http
        .post(format!(
            "{}/realms/{}/protocol/openid-connect/token",
            n.keycloak_url, n.realm
        ))
        .header(reqwest::header::HOST, &n.idp_host)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", n.native_client_id.as_str()),
            ("code", code.as_str()),
            ("redirect_uri", redirect),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await
        .expect("换取令牌")
        .json()
        .await
        .expect("令牌 JSON");
    token["access_token"]
        .as_str()
        .expect("access_token")
        .to_owned()
}

/// 夹具 Workspace 的 Community host 与 Channel ID：直连 Relay 的核验要用它们。
pub async fn live_scope(pool: &PgPool, fx: &LiveWorkspace) -> (String, String) {
    let host: String = sqlx::query_scalar(
        "select normalized_host from projection.tenant_buzz_binding where tenant_id = $1",
    )
    .bind(fx.tenant)
    .fetch_one(pool)
    .await
    .expect("Community host");
    let channel: Uuid = sqlx::query_scalar(
        "select channel_id from projection.workspace_buzz_binding where workspace_id = $1",
    )
    .bind(fx.workspace)
    .fetch_one(pool)
    .await
    .expect("Channel");
    (host, channel.to_string())
}

/// 按 SecretRef 的 locator 与版本读回 KV v2 里的值。
///
/// 只用于核验「旧版本仍在、但它对应的 pubkey 已被 Relay 拒绝」这类断言：
/// 核验要以持钥者的身份去试，而持钥者手里就是这个值。
pub async fn read_secret_version(
    http: &reqwest::Client,
    e: &Env,
    locator: &str,
    version: i32,
) -> String {
    let token = e.bao_token.as_str();
    // locator = <namespace>/<mount>/<path>
    let mut parts = locator.splitn(3, '/');
    let (ns, mount, path) = (
        parts.next().expect("namespace"),
        parts.next().expect("mount"),
        parts.next().expect("path"),
    );
    let read: serde_json::Value = http
        .get(format!("{}/v1/{mount}/data/{path}", e.bao_addr))
        .query(&[("version", version.to_string())])
        .header("X-Vault-Namespace", ns)
        .header("X-Vault-Token", token)
        .send()
        .await
        .expect("读 KV")
        .json()
        .await
        .expect("解析读取响应");
    read["data"]["data"]["value"]
        .as_str()
        .expect("KV 值")
        .to_owned()
}
