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

use crate::audit::Evidence;
use contracts::EvidenceKind;
use secret_store::{SecretRef, SecretStore};
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
    /// DD-115 (4)：部署登记的引导时限（秒）。OPERATOR 写入意图冻结时以「冻结时刻 +
    /// 时限」为提交截止，过期未绑定即终态。
    pub commit_window_seconds: i64,
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
            commit_window_seconds: match get("RELAY_OPERATOR_COMMIT_WINDOW_SECONDS")?.parse() {
                Ok(seconds) if seconds > 0 => seconds,
                _ => return Err("RELAY_OPERATOR_COMMIT_WINDOW_SECONDS 必须是正整数秒".to_owned()),
            },
        })
    }
}

/// 建立或确认 Catalog Tenant 与 RelayOperatorIdentity，返回 Catalog Tenant ID。
pub async fn ensure(
    pool: &PgPool,
    secrets: &SecretStore,
    audit: &secret_store::AuditObserver,
    cfg: &BootstrapConfig,
    http: &reqwest::Client,
) -> Result<Uuid, String> {
    let tenant = ensure_operator(pool, secrets, audit, cfg, http).await?;
    crate::capability_contract::ensure_builtin_knowledge(pool, tenant).await?;
    Ok(tenant)
}

async fn ensure_operator(
    pool: &PgPool,
    secrets: &SecretStore,
    audit: &secret_store::AuditObserver,
    cfg: &BootstrapConfig,
    http: &reqwest::Client,
) -> Result<Uuid, String> {
    let stores = crate::platform_keys::Stores {
        pool,
        secrets,
        audit,
    };
    // Catalog 也须经正常 TENANT_LIFECYCLE 才成为 ACTIVE。初建的 scope、部署
    // 引导 Principal、ActionExecution 和审计在同一事务内预写；重复启动不改变状态。
    // 已存在的历史 ACTIVE Catalog 缺协作面时，只能走显式 repair 命令，不能在
    // Core 启动时悄悄把它降回 PROVISIONING。
    let tenant = crate::tenant_bootstrap::ensure_catalog(pool, &cfg.catalog_tenant_slug).await?;

    // 投递的私钥决定部署此刻要用的 operator 身份；公钥由它派生，不从配置里
    // 再要一份——两处各存一份必然有一天对不上。
    let secret_hex = cfg.operator_key.trim().to_owned();
    let delivered = collab_bridge::operator::OperatorIdentity::new(
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
            retire_superseded_operator_keys(&stores, cfg, http, tenant).await;
            return Ok(tenant);
        }

        // 投递了另一把：这是部署发起的轮换（`.design/09` 的 RelayOperatorIdentity
        // rotate 行），在引导路径上完成——operator key 本身就是部署引导材料。
        rotate(
            &stores,
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
    // 版本与 audience。写入前先冻结意图（DD-113 (2)），登记与意图 BOUND 同事务。
    let locator = operator_locator(cfg, &pubkey);
    let intent =
        freeze_operator_write(&stores, cfg, tenant, &locator, &pubkey, &secret_hex).await?;
    let version = 1u32;
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("登记 RelayOperatorIdentity 失败: {e}"))?;
    lock_open_intent(&mut tx, intent).await?;
    sqlx::query(
        "insert into identity.relay_operator_identity
             (catalog_tenant_id, pubkey, private_key_secret_ref, private_key_secret_version,
              private_key_secret_audience, audience, relay_operator_api_origin, state)
         values ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
         on conflict (catalog_tenant_id) do nothing",
    )
    .bind(tenant)
    .bind(&pubkey)
    .bind(&locator)
    .bind(version as i32)
    .bind(&cfg.secret_audience)
    .bind(&cfg.operator_audience)
    .bind(&cfg.operator_api_origin)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("登记 RelayOperatorIdentity 失败: {e}"))?;
    let registered: Option<String> = sqlx::query_scalar(
        "select pubkey from identity.relay_operator_identity
         where catalog_tenant_id = $1 and state = 'ACTIVE'",
    )
    .bind(tenant)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| format!("回读 RelayOperatorIdentity 失败: {e}"))?;
    if registered.as_deref() == Some(pubkey.as_str()) {
        finish_intent(&mut tx, intent).await?;
        tx.commit()
            .await
            .map_err(|e| format!("登记 RelayOperatorIdentity 失败: {e}"))?;
    } else {
        // 另一实例已登记别的 key：本次写入未形成 identity，意图保持开放由对账器收敛。
        drop(tx);
    }

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
/// 2. 冻结写入意图（DD-113 (2)），把新 key 写入其独占 locator 的版本 1。
/// 3. 以旧 pubkey 为 CAS 原地推进 pubkey、SecretRef 版本与 version，并在同一事务
///    里写审计。CAS 不中说明另一个 Core 实例已经切过：不覆盖它。
///
/// operator key 只签 operator 面的 NIP-98、不产生 Buzz event，没有需要保留的
/// roster 或历史 binding。旧 key 在部署把它移出 allow-list、Relay 确认拒绝之后，
/// 由下一次引导销毁其独占 locator 并记 RETIRED（DD-113 (4)，
/// [`retire_superseded_operator_keys`]）。
#[allow(clippy::too_many_arguments)]
async fn rotate(
    stores: &crate::platform_keys::Stores<'_>,
    cfg: &BootstrapConfig,
    http: &reqwest::Client,
    tenant: Uuid,
    active: &str,
    delivered: &collab_bridge::operator::OperatorIdentity,
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
    let intent = freeze_operator_write(stores, cfg, tenant, &locator, &pubkey, secret_hex).await?;
    let version = 1u32;

    let mut tx = stores
        .pool
        .begin()
        .await
        .map_err(|e| format!("轮换 RelayOperatorIdentity 失败: {e}"))?;
    let operation = lock_open_intent(&mut tx, intent).await?;
    let old_locator: String = sqlx::query_scalar(
        "select private_key_secret_ref from identity.relay_operator_identity
         where catalog_tenant_id = $1 and pubkey = $2 and state = 'ACTIVE' for update",
    )
    .bind(tenant)
    .bind(active)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| format!("轮换 RelayOperatorIdentity 失败: {e}"))?
    .ok_or_else(|| format!("RelayOperatorIdentity 已不是 {active}：另一实例已切换，不覆盖"))?;
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
    finish_intent(&mut tx, intent).await?;
    // DD-115 (2)：旧 key 在本次轮换中到期，退役审计归属本轮换 operation。
    if !crate::platform_keys::freeze_retirement(&mut tx, &old_locator, operation)
        .await
        .map_err(|e| format!("冻结旧 operator key 的退役失败: {e}"))?
    {
        tracing::error!(old = active, "被替下的 operator key 没有 BOUND 写入意图");
    }
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
            // 新私钥的 KV 版本记在新公钥这条引用上：版本只对它指向的那把钥匙有意义
            evidence_refs: vec![
                Evidence::new(EvidenceKind::BuzzPubkey, active),
                Evidence::versioned(
                    EvidenceKind::BuzzPubkey,
                    pubkey.as_str(),
                    i64::from(version),
                ),
            ],
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

/// DD-113 (1)：每把 key 独占由其 pubkey 派生的 locator、只写版本 1。同一 key
/// 的重投递因此落在同一冻结意图上；已退役（版本 1 已销毁）的 key 不能再投递，
/// `cas=0` 写入被拒，引导 fail closed。
fn operator_locator(cfg: &BootstrapConfig, pubkey: &str) -> String {
    format!(
        "{}/relay-operator/{}/{pubkey}",
        cfg.secret_mount, cfg.operator_audience
    )
}

/// 冻结（或续用同一投递已冻结的）写入意图，再把私钥写入独占 locator 的版本 1。
/// 同一 key 的重投递就是同一 operation 的重试：版本 1 已可读且派生 pubkey 一致即
/// 续用，不另写。意图冻结时即带提交截止（DD-115 (4)）。
///
/// 遇到同一 Catalog 另一把 key 的未完成意图（DD-115 (5)）：截止已过即终态，以
/// DD-86 的同一实现 fence 并销毁（审计追加到该意图的 operation）后继续；未过则
/// fail closed 并给出截止时刻。本 key 自己的意图已过截止或已被封堵时同样先收敛
/// 它；其版本 1 随之销毁，这把 key 不能再投递。
async fn freeze_operator_write(
    stores: &crate::platform_keys::Stores<'_>,
    cfg: &BootstrapConfig,
    catalog: Uuid,
    locator: &str,
    pubkey: &str,
    secret_hex: &str,
) -> Result<Uuid, String> {
    let open: Option<(Uuid, String, bool, bool, String)> = sqlx::query_as(
        "select id, target_locator, fenced_at is not null, commit_deadline_at <= now(),
                commit_deadline_at::text
         from admission.server_key_provision_intent
         where tenant_id = $1 and key_kind = 'OPERATOR' and finished_at is null",
    )
    .bind(catalog)
    .fetch_optional(stores.pool)
    .await
    .map_err(|e| format!("读 operator 写入意图失败: {e}"))?;
    let intent = match open {
        Some((id, frozen, false, false, _)) if frozen == locator => id,
        Some((id, frozen, fenced, expired, deadline)) => {
            if !fenced && !expired {
                return Err(format!(
                    "另一次 operator 投递的写入意图 {id}（{frozen}）未到提交截止 {deadline}：\
                     截止前重投递那把 key 以完成它，或截止后再投递新 key"
                ));
            }
            match crate::platform_keys::fence_and_destroy_with(stores, id).await {
                "CONVERGED" => {}
                step => {
                    return Err(format!(
                        "已过截止的 operator 写入意图 {id} 未能收敛（{step}），不另写"
                    ))
                }
            }
            if frozen == locator {
                return Err(format!(
                    "投递的 operator key {pubkey} 已过提交截止并已销毁，须投递新 key"
                ));
            }
            insert_operator_intent(stores.pool, cfg, catalog, locator).await?
        }
        None => insert_operator_intent(stores.pool, cfg, catalog, locator).await?,
    };
    let secrets = stores.secrets;
    if secrets
        .observed_version(locator)
        .await
        .map_err(|e| format!("查证 operator 写入目标失败: {e}"))?
        == 0
    {
        // 回应丢失时下一次引导只按同一 locator 查证，不另写。
        let written = secrets
            .write_once(locator, "value", secret_hex)
            .await
            .map_err(|e| format!("写 operator 私钥到 OpenBao 失败: {e}"))?;
        if written != 1 {
            return Err(format!(
                "operator 私钥写入得到版本 {written}，不是独占版本 1"
            ));
        }
    }
    let reference = SecretRef {
        locator: locator.to_owned(),
        version: 1,
        audience: cfg.secret_audience.clone(),
    };
    crate::server_identity::read_bound_keys(secrets, &reference, pubkey)
        .await
        .map_err(|e| format!("operator 写入目标的版本 1 不是投递的 key: {e}"))?;
    Ok(intent)
}

async fn insert_operator_intent(
    pool: &PgPool,
    cfg: &BootstrapConfig,
    catalog: Uuid,
    locator: &str,
) -> Result<Uuid, String> {
    sqlx::query_scalar(
        "insert into admission.server_key_provision_intent
             (key_kind, origin, operation_id, tenant_id, principal_id, target_locator,
              commit_deadline_at)
         values ('OPERATOR', 'PROVISIONED', $1, $2, null, $3,
                 now() + make_interval(secs => $4::bigint))
         returning id",
    )
    .bind(Uuid::new_v4())
    .bind(catalog)
    .bind(locator)
    .bind(cfg.commit_window_seconds)
    .fetch_one(pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(d) if d.is_unique_violation() => format!(
            "operator locator {locator} 已有写入意图（该 key 曾投递且已终结），须投递新 key"
        ),
        e => format!("冻结 operator 写入意图失败: {e}"),
    })
}

/// 在登记事务里锁住仍开放、未 fence 的意图，返回其 operation。
async fn lock_open_intent(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    intent: Uuid,
) -> Result<Uuid, String> {
    sqlx::query_scalar(
        "select operation_id from admission.server_key_provision_intent
         where id = $1 and finished_at is null and fenced_at is null
           and now() < commit_deadline_at for update",
    )
    .bind(intent)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("锁定 operator 写入意图失败: {e}"))?
    .ok_or_else(|| "operator 写入意图已被封堵、终结或过了提交截止，不登记".to_owned())
}

async fn finish_intent(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    intent: Uuid,
) -> Result<(), String> {
    let done = sqlx::query(
        "update admission.server_key_provision_intent set finished_at = now()
         where id = $1 and finished_at is null and fenced_at is null",
    )
    .bind(intent)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("终结 operator 写入意图失败: {e}"))?;
    if done.rows_affected() != 1 {
        return Err("operator 写入意图未能与登记同事务终结".to_owned());
    }
    Ok(())
}

/// DD-113 (4)：已被轮换替下的 operator key（轮换时已冻结 `retire_operation_id`），
/// 在 Relay 确认拒绝以它签的 operator 请求之后才退役：`destroy` 其独占 locator，
/// metadata 查证后记 RETIRED，审计追加到该轮换 operation（`platform_keys::retire_bound_key`）。
/// Relay 仍接受（部署尚未移出 allow-list）、探针结果不明或 OpenBao 不可查证时保持
/// BOUND 并告警，由下一次引导重试；这一步不阻断 Core 启动。
async fn retire_superseded_operator_keys(
    stores: &crate::platform_keys::Stores<'_>,
    cfg: &BootstrapConfig,
    http: &reqwest::Client,
    catalog: Uuid,
) {
    use crate::platform_keys::{retire_bound_key, Retirement};
    use secret_store::PlatformKey;

    let superseded: Vec<String> = match sqlx::query_scalar(
        "select i.target_locator from admission.server_key_provision_intent i
         where i.tenant_id = $1 and i.key_kind = 'OPERATOR' and i.finished_at is not null
           and i.fenced_at is null and i.destroyed_at is null and i.retired_at is null
           and i.retire_operation_id is not null
           and not exists (select 1 from identity.relay_operator_identity o
                           where o.private_key_secret_ref = i.target_locator)",
    )
    .bind(catalog)
    .fetch_all(stores.pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!(error = %e, "读取已替下的 operator 意图失败");
            return;
        }
    };
    for locator in superseded {
        let old_pubkey = locator.rsplit('/').next().unwrap_or_default().to_owned();
        let rejected = match stores
            .secrets
            .bound_version_one_destroyed(PlatformKey::Operator, catalog, &locator)
            .await
        {
            // 上一次销毁已生效而库内提交丢失：只按 metadata 补记。
            Ok(true) => true,
            Ok(false) => old_key_rejected(stores, cfg, http, &locator, &old_pubkey).await,
            Err(e) => {
                tracing::warn!(error = %e, old_pubkey, "旧 operator locator 的 metadata 不可查证");
                false
            }
        };
        if !rejected {
            continue;
        }
        match retire_bound_key(stores, PlatformKey::Operator, catalog, &locator).await {
            Ok(Retirement::Retired) => {
                tracing::info!(old_pubkey, "已替下的 operator key 已销毁并查证")
            }
            Ok(other) => tracing::warn!(?other, old_pubkey, "已替下的 operator key 未能退役"),
            Err(e) => {
                tracing::warn!(error = %e, old_pubkey, "旧 operator 退役未能落库，下一次引导按 metadata 补记")
            }
        }
    }
}

/// 以旧 key 签一次 operator 请求：只有 Relay 的 401/403 是「已拒绝」的证据。
async fn old_key_rejected(
    stores: &crate::platform_keys::Stores<'_>,
    cfg: &BootstrapConfig,
    http: &reqwest::Client,
    locator: &str,
    old_pubkey: &str,
) -> bool {
    let reference = SecretRef {
        locator: locator.to_owned(),
        version: 1,
        audience: cfg.secret_audience.clone(),
    };
    let keys = match crate::server_identity::read_bound_keys(stores.secrets, &reference, old_pubkey)
        .await
    {
        Ok(keys) => keys,
        Err(e) => {
            tracing::warn!(error = %e, old_pubkey, "旧 operator 私钥不可读，暂不退役");
            return false;
        }
    };
    let old = match collab_bridge::operator::OperatorIdentity::new(
        &keys.secret_key().to_secret_hex(),
        &cfg.operator_api_origin,
        &cfg.operator_audience,
        &cfg.operator_audience,
    ) {
        Ok(old) => old,
        Err(e) => {
            tracing::warn!(error = %e, old_pubkey, "旧 operator 身份不可构造");
            return false;
        }
    };
    match old.probe(http).await {
        Err(collab_bridge::operator::OperatorError::Rejected {
            status: 401 | 403, ..
        }) => true,
        Ok(()) => {
            tracing::warn!(
                old_pubkey,
                "旧 operator key 仍被 Relay 接受：先移出 allow-list，旧 key 保留"
            );
            false
        }
        Err(e) => {
            tracing::warn!(error = %e, old_pubkey, "旧 operator key 的拒绝未查证，保留");
            false
        }
    }
}

/// 该 Tenant 是否本部署的 Platform Catalog Tenant。权威是引导时建立的
/// RelayOperatorIdentity：它以 `catalog_tenant_id` 为主键归属 Catalog（`.design/03`
/// §2），每个部署只有一个。业务 Tenant 的暂停与恢复只在 Catalog 会话中准入（DD-96）。
pub(crate) async fn is_catalog_tenant(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "select exists (select 1 from identity.relay_operator_identity where catalog_tenant_id = $1)",
    )
    .bind(tenant)
    .fetch_one(conn)
    .await
}
