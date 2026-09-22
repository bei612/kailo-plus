//! 平台引导：Catalog Tenant 与 RelayOperatorIdentity。
//!
//! `TENANT_LIFECYCLE` 创建 Community 时要取「Platform Catalog Tenant 的 active
//! RelayOperatorIdentity」（`.design/09` 第 3 步）。这两样东西本身不能由
//! `TENANT_LIFECYCLE` 创建——那是先有鸡还是先有蛋。它们与 OpenBao 的 AppRole
//! 同属部署引导material，在 Core 启动时建立。
//!
//! 引导是幂等的：已存在即原样返回。它也是 fail-closed 的前置——没有 operator
//! 身份就永远创建不了任何 Tenant，此时让 Core「起来但做不了事」比拒绝启动更糟，
//! 因为前者要等到第一次建 Tenant 才暴露。
//!
//! operator 私钥从受控投递面（挂载的文件）读入，写进 OpenBao 后只把返回的版本号
//! 记成 SecretRef；私钥值不进数据库、不进日志（`DD-70`、`.design/03` §9）。

use kailo_secrets::SecretStore;
use sqlx::PgPool;
use uuid::Uuid;

/// 引导所需的部署事实。每一项都不接受默认值——猜一个 origin 或 audience 会让
/// NIP-98 的签名目标对不上，而上游只会回一个不区分成因的拒绝。
pub struct BootstrapConfig {
    pub catalog_tenant_slug: String,
    /// operator 私钥。经 env_file 投递——compose 非 swarm 模式的 `secrets` 只是
    /// bind mount，uid/gid/mode 全被忽略，而本镜像以非 root 运行、宿主文件是
    /// 0600，因此挂进来也读不到。
    pub operator_key: String,
    /// operator API 的 audience：这把钥匙服务哪个部署
    pub operator_audience: String,
    /// 签名目标的 origin，必须逐字符等于 Relay 侧配置的那个（`SS-BUZ-OPERATOR`）
    pub operator_api_origin: String,
    /// SecretRef 的 locator 前缀：`<namespace>/<mount>`
    pub secret_mount: String,
    /// 允许取用该 secret 的 service identity
    pub secret_audience: String,
}

impl BootstrapConfig {
    pub fn from_env() -> Result<Self, String> {
        let get = |k: &str| std::env::var(k).map_err(|_| format!("缺少 {k}"));
        Ok(Self {
            catalog_tenant_slug: get("PLATFORM_CATALOG_TENANT_SLUG")?,
            operator_key: get("RELAY_OPERATOR_PRIVATE_KEY")?,
            operator_audience: get("RELAY_OPERATOR_AUDIENCE")?,
            operator_api_origin: get("RELAY_OPERATOR_API_ORIGIN")?,
            secret_mount: format!(
                "{}/{}",
                get("OPENBAO_PLATFORM_NAMESPACE")?,
                get("OPENBAO_KV_MOUNT")?
            ),
            secret_audience: get("OPENBAO_SERVICE_IDENTITY")?,
        })
    }
}

/// 建立或确认 Catalog Tenant 与 RelayOperatorIdentity，返回 Catalog Tenant ID。
pub async fn ensure(
    pool: &PgPool,
    secrets: &SecretStore,
    cfg: &BootstrapConfig,
) -> Result<Uuid, String> {
    // Catalog Tenant 直接是 ACTIVE：它不经 TENANT_LIFECYCLE，也没有协作面——
    // 它只承载平台自己的 binding 与凭据（`.design/09` 第 3 步）。
    let tenant: Uuid = sqlx::query_scalar!(
        "insert into identity.tenant (id, slug, name, state)
         values ($1, $2, $2, 'ACTIVE')
         on conflict (slug) do update set slug = excluded.slug
         returning id",
        Uuid::new_v4(),
        cfg.catalog_tenant_slug,
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("建立 Catalog Tenant 失败: {e}"))?;

    // 已有 active 身份即完成。轮换是另一件事：它要生成新密钥、写新版本、
    // 并按重叠窗口切换，不在引导路径上（`.design/03` §9）。
    let existing = sqlx::query_scalar!(
        "select pubkey from identity.relay_operator_identity
         where catalog_tenant_id = $1 and state = 'ACTIVE'",
        tenant
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("读 RelayOperatorIdentity 失败: {e}"))?;
    if existing.is_some() {
        return Ok(tenant);
    }

    // 私钥只在这一段内存里出现，随后被写进 OpenBao；落库的只有 locator、
    // 版本与 audience。
    let secret_hex = cfg.operator_key.trim().to_owned();
    // 公钥由私钥派生，不从配置里再要一份——两处各存一份必然有一天对不上。
    let pubkey = kailo_buzz::operator::OperatorIdentity::new(
        &secret_hex,
        &cfg.operator_api_origin,
        &cfg.operator_audience,
        &cfg.operator_audience,
    )
    .map_err(|e| format!("operator 私钥不可用: {e}"))?
    .pubkey_hex();

    let locator = format!(
        "{}/relay-operator/{}",
        cfg.secret_mount, cfg.operator_audience
    );
    let version = secrets
        .write(&locator, "value", &secret_hex)
        .await
        .map_err(|e| format!("写 operator 私钥到 OpenBao 失败: {e}"))?;

    sqlx::query!(
        "insert into identity.relay_operator_identity
             (catalog_tenant_id, pubkey, private_key_secret_ref, private_key_secret_version,
              private_key_secret_audience, audience, relay_operator_api_origin, state)
         values ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
         on conflict (catalog_tenant_id) do nothing",
        tenant,
        pubkey,
        locator,
        version as i32,
        cfg.secret_audience,
        cfg.operator_audience,
        cfg.operator_api_origin,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("登记 RelayOperatorIdentity 失败: {e}"))?;

    tracing::info!(
        catalog_tenant = %tenant,
        pubkey,
        secret_version = version,
        "平台引导完成"
    );
    Ok(tenant)
}
