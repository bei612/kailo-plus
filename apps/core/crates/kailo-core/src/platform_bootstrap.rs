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

use kailo_secrets::{SecretRef, SecretStore};
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
    http: &reqwest::Client,
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

    // 投递的私钥决定部署此刻要用的 operator 身份；公钥由它派生，不从配置里
    // 再要一份——两处各存一份必然有一天对不上。
    let secret_hex = cfg.operator_key.trim().to_owned();
    let delivered = kailo_buzz::operator::OperatorIdentity::new(
        &secret_hex,
        &cfg.operator_api_origin,
        &cfg.operator_audience,
        &cfg.operator_audience,
    )
    .map_err(|e| format!("operator 私钥不可用: {e}"))?;
    let pubkey = delivered.pubkey_hex();

    let existing = sqlx::query!(
        "select pubkey, private_key_secret_ref, private_key_secret_version,
                private_key_secret_audience, audience, relay_operator_api_origin
         from identity.relay_operator_identity
         where catalog_tenant_id = $1 and state = 'ACTIVE'",
        tenant
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("读 RelayOperatorIdentity 失败: {e}"))?;
    if let Some(active) = existing {
        if active.audience != cfg.operator_audience
            || active.relay_operator_api_origin != cfg.operator_api_origin
        {
            return Err("在用的 RelayOperatorIdentity 与部署 audience/origin 不一致".to_owned());
        }

        // 投递的就是在用的那把：私钥和 Relay 当前准入仍须重新查证。
        if active.pubkey == pubkey {
            let reference = SecretRef {
                locator: active.private_key_secret_ref,
                version: active.private_key_secret_version.unwrap_or_default() as u32,
                audience: active.private_key_secret_audience.unwrap_or_default(),
            };
            crate::server_identity::read_bound_keys(secrets, &reference, &pubkey)
                .await
                .map_err(|e| format!("在用的 RelayOperatorIdentity 私钥不可用: {e}"))?;
            delivered
                .probe(http)
                .await
                .map_err(|e| format!("在用的 RelayOperatorIdentity 未被 Relay 接受: {e}"))?;
            return Ok(tenant);
        }

        // 投递了另一把：这是部署发起的轮换（`.design/09` 的 RelayOperatorIdentity
        // rotate 行），在引导路径上完成——operator key 本身就是部署引导材料。
        rotate(
            pool,
            secrets,
            cfg,
            http,
            tenant,
            &active.pubkey,
            &delivered,
            &secret_hex,
        )
        .await?;
        return Ok(tenant);
    }

    // 首次登记前先查证 Relay 的实际 allow-list；拒绝或响应不明时既不写 KV，
    // 也不建立看似 ACTIVE 却无法创建 Community 的身份。
    delivered
        .probe(http)
        .await
        .map_err(|e| format!("首次投递的 RelayOperatorIdentity 未被 Relay 接受: {e}"))?;

    // 私钥只在这一段内存里出现，随后被写进 OpenBao；落库的只有 locator、
    // 版本与 audience。
    let locator = operator_locator(cfg, &pubkey);
    let version = secrets
        .write(&locator, "value", &secret_hex)
        .await
        .map_err(|e| format!("写 operator 私钥到 OpenBao 失败: {e}"))?;
    let reference = SecretRef {
        locator: locator.clone(),
        version,
        audience: cfg.secret_audience.clone(),
    };
    crate::server_identity::read_bound_keys(secrets, &reference, &pubkey)
        .await
        .map_err(|e| format!("新 RelayOperatorIdentity 私钥读回失败: {e}"))?;

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

    // 并发引导时另一实例可能先插入，ON CONFLICT DO NOTHING 不代表这把新
    // 投递的 key 已经成为部署的 operator。只以库中实际生效的 ACTIVE 行为准；
    // 不同公钥或不可读的定版私钥都拒绝进入 serving 状态。
    let active = sqlx::query!(
        "select pubkey, private_key_secret_ref, private_key_secret_version,
                private_key_secret_audience, audience, relay_operator_api_origin
         from identity.relay_operator_identity
         where catalog_tenant_id = $1 and state = 'ACTIVE'",
        tenant
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("回读 RelayOperatorIdentity 失败: {e}"))?
    .ok_or_else(|| "RelayOperatorIdentity 未成为 ACTIVE，不启动 Core".to_owned())?;
    if active.pubkey != pubkey {
        return Err(format!(
            "RelayOperatorIdentity 并发登记了另一把公钥 {}，投递公钥 {pubkey} 未生效",
            active.pubkey
        ));
    }
    if active.audience != cfg.operator_audience
        || active.relay_operator_api_origin != cfg.operator_api_origin
    {
        return Err("生效的 RelayOperatorIdentity 与部署 audience/origin 不一致".to_owned());
    }
    let active_ref = SecretRef {
        locator: active.private_key_secret_ref,
        version: active.private_key_secret_version.unwrap_or_default() as u32,
        audience: active.private_key_secret_audience.unwrap_or_default(),
    };
    crate::server_identity::read_bound_keys(secrets, &active_ref, &pubkey)
        .await
        .map_err(|e| format!("生效的 RelayOperatorIdentity 私钥不可用: {e}"))?;

    tracing::info!(
        catalog_tenant = %tenant,
        pubkey,
        secret_version = version,
        "平台引导完成"
    );
    Ok(tenant)
}

/// 以新投递的 operator 私钥原地替换在用的那把（`.design/09` 的
/// RelayOperatorIdentity rotate 行）。
///
/// 顺序决定安全性：
///
/// 1. **先查证 Relay 已接受新 key**。部署必须先把新 pubkey 与旧的并列放进
///    `RELAY_OPERATOR_PUBKEYS`；没放就切换，Core 从此创建不了任何 Community，而
///    这要等到下一次建 Tenant 才暴露。查证不过即拒绝启动（fail closed），库与
///    OpenBao 都没有动过，还原投递文件即可回到原状。
/// 2. 写新 KV 版本，只记版本号。
/// 3. 以旧 pubkey 为 CAS 原地推进 pubkey、SecretRef 版本与 version，并在同一事务
///    里写审计。CAS 不中说明另一个 Core 实例已经切过：不覆盖它。
///
/// operator key 只签 operator 面的 NIP-98、不产生 Buzz event，没有需要保留的
/// roster 或历史 binding；旧 KV 路径留在 OpenBao 里，由运维按 RB-02 处置。
#[allow(clippy::too_many_arguments)]
async fn rotate(
    pool: &PgPool,
    secrets: &SecretStore,
    cfg: &BootstrapConfig,
    http: &reqwest::Client,
    tenant: Uuid,
    active: &str,
    delivered: &kailo_buzz::operator::OperatorIdentity,
    secret_hex: &str,
) -> Result<(), String> {
    let pubkey = delivered.pubkey_hex();
    delivered.probe(http).await.map_err(|e| {
        format!(
            "新投递的 operator key {pubkey} 未被 Relay 接受（{e}）：先把它与在用的 {active} \
             并列放进 RELAY_OPERATOR_PUBKEYS 并重建 Relay，再启动 Core"
        )
    })?;

    let locator = operator_locator(cfg, &pubkey);
    let version = secrets
        .write(&locator, "value", secret_hex)
        .await
        .map_err(|e| format!("写 operator 私钥到 OpenBao 失败: {e}"))?;
    let reference = SecretRef {
        locator: locator.clone(),
        version,
        audience: cfg.secret_audience.clone(),
    };
    crate::server_identity::read_bound_keys(secrets, &reference, &pubkey)
        .await
        .map_err(|e| format!("轮换后的 RelayOperatorIdentity 私钥读回失败: {e}"))?;

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("轮换 RelayOperatorIdentity 失败: {e}"))?;
    let row = sqlx::query!(
        "update identity.relay_operator_identity
         set pubkey = $3, private_key_secret_ref = $4, private_key_secret_version = $5,
             private_key_secret_audience = $6, version = version + 1
         where catalog_tenant_id = $1 and pubkey = $2 and state = 'ACTIVE'
         returning version",
        tenant,
        active,
        pubkey,
        locator,
        version as i32,
        cfg.secret_audience,
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| format!("轮换 RelayOperatorIdentity 失败: {e}"))?
    .ok_or_else(|| format!("RelayOperatorIdentity 已不是 {active}：另一实例已切换，不覆盖"))?;

    let operation = Uuid::new_v4();
    crate::audit::append(
        &mut tx,
        crate::audit::AuditEntry {
            event_key: format!("relay_operator.rotate:{active}:{pubkey}"),
            tenant_id: Some(tenant),
            workspace_id: None,
            operation_id: operation,
            event_type: "OUTCOME",
            human_identity_id: None,
            initiator_principal_id: None,
            actor_principal_id: None,
            action_key: "relay_operator.rotate",
            action_version: 1,
            component_type_key: "buzz",
            target_type: Some("RELAY_OPERATOR_IDENTITY"),
            target_id: Some(tenant),
            parameter_hash: &pubkey,
            decision: "ALLOW",
            result_code: "ROTATED",
            result_exposure: "NONE",
            evidence_refs: serde_json::json!([
                { "kind": "BUZZ_PUBKEY", "value": active },
                { "kind": "BUZZ_PUBKEY", "value": pubkey },
                { "kind": "SECRET_VERSION", "value": version },
            ]),
            correlation_id: operation,
        },
    )
    .await
    .map_err(|e| format!("写轮换审计失败: {e}"))?;
    tx.commit()
        .await
        .map_err(|e| format!("轮换 RelayOperatorIdentity 失败: {e}"))?;

    tracing::info!(
        catalog_tenant = %tenant,
        old = active,
        new = pubkey,
        secret_version = version,
        identity_version = row.version,
        "RelayOperatorIdentity 已轮换"
    );
    Ok(())
}

/// 每次投递占用独立 KV 路径；即使部署日后轮换回同一公钥，OpenBao 的
/// max_versions 也不会在写入时自动淘汰仍被旧执行钉住的版本。
fn operator_locator(cfg: &BootstrapConfig, pubkey: &str) -> String {
    format!(
        "{}/relay-operator/{}/{pubkey}/{}",
        cfg.secret_mount,
        cfg.operator_audience,
        Uuid::new_v4()
    )
}
