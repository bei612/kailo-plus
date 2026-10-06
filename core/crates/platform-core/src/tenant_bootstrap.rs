//! 部署引导：建立一个 Tenant（含 Platform Catalog Tenant）与首位 admin
//! （DD-82、ADR-11）。
//!
//! `.design` 没有定义 Tenant 的发起方（没有 `tenant.create` 动作）；邀请（DD-83）要由
//! 持有 Tenant manage 的人签发，而空 Tenant 里没有这样的人。于是「第一个人」只能来自
//! 部署：运维在 Core 容器内执行
//!
//! ```text
//! platform-core bootstrap-tenant --slug <slug> --name <显示名> \
//!     --admin-subject <IdP subject> --admin-display-name <显示名> --wait-seconds <秒>
//! ```
//!
//! 仅旧版 Catalog 被错误地标为 ACTIVE 而没有协作面时，运维显式加
//! `--repair-catalog-id <已核对的 Catalog UUID>`；正常 Tenant 不接受此参数。
//!
//! 它不是网络入口：只有能在 Core 容器里执行命令的人（即已掌握部署的人）能调用，
//! 因此不开任何新的认证面。它也不是后门，约束写在 DD-82：
//!
//! - 只做 0→1：目标 Tenant 已有有效 admin 时，不建成员、不写 admin，原样退出；
//! - 每一步都走平台自己的链：Tenant 经 `TENANT_LIFECYCLE`、成员经
//!   `MEMBERSHIP_PROJECTION`，admin 关系在 Tenant 行锁内写入；
//! - 每一步都有 ActionExecution 与 AuditEvent，发起方是 Catalog Tenant 下的部署引导
//!   ServicePrincipal，关联 ID 取 Tenant ID，按 Tenant 可查出整条引导链。
//!
//! 可重入：任一步中断后以同一参数重跑，从停下的地方继续。

use crate::audit::Evidence;
use contracts::EvidenceKind;
use std::time::{Duration, Instant};

use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgPoolOptions, PgConnection, PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::audit::{append, AuditEntry};
use crate::governance::{record_dispatch, AuditClass, Dispatch};
use crate::membership_lifecycle::{
    launch_membership, launch_scope, LifecycleRequest, ScopeLifecycleRequest, ScopeOperation,
};
use crate::membership_projection::MembershipScope;
use crate::scope_state::ScopeKind;
use crate::spicedb::{RelationshipFilter, SpiceDb, Write};
use crate::temporal::TemporalClient;

/// 部署引导这一 ServicePrincipal 的 audience。它是平台内一个固定身份的名字，
/// 不是部署取值：审计按它归因，换名字就断了历史。
pub(crate) const AUDIENCE: &str = "platform-deployment-bootstrap";
pub(crate) const ACTION_KEY: &str = "tenant.bootstrap";
/// 轮询生命周期推进的间隔。等待的上界由运维以 `--wait-seconds` 给出。
const POLL: Duration = Duration::from_secs(1);

pub struct Args {
    pub slug: String,
    pub name: String,
    pub admin_subject: String,
    pub admin_display_name: String,
    pub wait: Duration,
    /// 旧版把 Catalog 直接置为 ACTIVE 却没有协作面。只在显式指定其确切 ID 时
    /// 允许执行一次历史错误数据修复；普通 bootstrap 永不改变既有 ACTIVE Tenant。
    pub repair_catalog_id: Option<Uuid>,
}

impl Args {
    /// 引导参数全部必填；唯一可选的是旧 Catalog 显式修复标记。猜一个 slug
    /// 或 subject 就是替运维决定谁掌管一个 Tenant。
    pub fn parse(argv: &[String]) -> Result<Self, String> {
        let get = |flag: &str| -> Result<String, String> {
            let i = argv
                .iter()
                .position(|a| a == flag)
                .ok_or_else(|| format!("缺少 {flag}"))?;
            argv.get(i + 1)
                .filter(|v| !v.is_empty() && !v.starts_with("--"))
                .cloned()
                .ok_or_else(|| format!("{flag} 缺值"))
        };
        let wait: u64 = get("--wait-seconds")?
            .parse()
            .map_err(|_| "--wait-seconds 必须是非负整数")?;
        Ok(Self {
            slug: get("--slug")?,
            name: get("--name")?,
            admin_subject: get("--admin-subject")?,
            admin_display_name: get("--admin-display-name")?,
            wait: Duration::from_secs(wait),
            repair_catalog_id: argv
                .iter()
                .position(|a| a == "--repair-catalog-id")
                .map(|i| {
                    argv.get(i + 1)
                        .ok_or("--repair-catalog-id 缺值")
                        .and_then(|v| {
                            Uuid::parse_str(v).map_err(|_| "--repair-catalog-id 必须是 UUID")
                        })
                        .map_err(str::to_owned)
                })
                .transpose()?,
        })
    }
}

/// 引导的终局。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub tenant_id: Uuid,
    pub admin_principal_id: Option<Uuid>,
    /// COMPLETED：声明的人是有效 admin；PENDING：生命周期还在推进，重跑以继续；
    /// INERT：Tenant 已有其他有效 admin，引导不追加
    pub state: &'static str,
}

struct Ctx {
    pool: PgPool,
    temporal: TemporalClient,
    spicedb: SpiceDb,
    openmeter: crate::openmeter::OpenMeter,
    page: u32,
    issuer: String,
    client_id: String,
    catalog_slug: String,
}

fn env(k: &str) -> Result<String, String> {
    std::env::var(k)
        .ok()
        .filter(|v| !v.is_empty())
        .ok_or_else(|| format!("缺少 {k}"))
}

/// 平台启动时只建立引导意图，不提前宣称 Catalog ACTIVE。首次插入和意图
/// 同事务；已有行原样返回，历史错误数据只由显式运维命令修复。
pub(crate) async fn ensure_catalog(pool: &PgPool, slug: &str) -> Result<Uuid, String> {
    if !crate::governance::valid_slug(slug) {
        return Err("Platform Catalog Tenant slug 不合法".into());
    }
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let created: Option<Uuid> = sqlx::query_scalar(
        "insert into identity.tenant (id, slug, name, state)
         values ($1, $2, $2, 'PROVISIONING')
         on conflict (slug) do nothing returning id",
    )
    .bind(Uuid::new_v4())
    .bind(slug)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| format!("建立 Catalog Tenant 失败: {e}"))?;
    let tenant = match created {
        Some(tenant) => {
            let initiator = deployment_principal(&mut tx, tenant).await?;
            let params = hex::encode(Sha256::digest(
                json!({ "slug": slug, "source": "platform.bootstrap" })
                    .to_string()
                    .as_bytes(),
            ));
            record_bootstrap(&mut tx, tenant, initiator, "TENANT", tenant, &params).await?;
            tenant
        }
        None => sqlx::query_scalar("select id from identity.tenant where slug = $1")
            .bind(slug)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| format!("读取 Catalog Tenant 失败: {e}"))?,
    };
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(tenant)
}

pub(crate) async fn deployment_principal(
    tx: &mut Transaction<'_, Postgres>,
    catalog: Uuid,
) -> Result<Uuid, String> {
    // 同一个 audience 只有一个部署主体；并发启动/引导在这把表锁后串行。
    sqlx::query("lock table identity.service_principal in share row exclusive mode")
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    let found: Option<(Uuid, Uuid, String, String)> = sqlx::query_as(
        "select sp.principal_id, p.tenant_id, p.kind, p.status
         from identity.service_principal sp
         join identity.principal p on p.id = sp.principal_id
         where sp.audience = $1",
    )
    .bind(AUDIENCE)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    if let Some((id, tenant, kind, status)) = found {
        if tenant != catalog || kind != "SERVICE" || status != "ACTIVE" {
            return Err("部署引导 Principal 不属于 active Catalog service 身份".into());
        }
        return Ok(id);
    }
    let id = Uuid::new_v4();
    sqlx::query(
        "insert into identity.principal (id, tenant_id, kind, status)
         values ($1, $2, 'SERVICE', 'ACTIVE')",
    )
    .bind(id)
    .bind(catalog)
    .execute(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    sqlx::query("insert into identity.service_principal (principal_id, audience) values ($1, $2)")
        .bind(id)
        .bind(AUDIENCE)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    Ok(id)
}

async fn record_bootstrap(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    initiator: Uuid,
    target_type: &str,
    target: Uuid,
    params: &str,
) -> Result<Uuid, String> {
    let ae = Uuid::new_v4();
    let operation = Uuid::new_v4();
    sqlx::query(
        "insert into admission.action_execution
             (id, operation_id, tenant_id, action_key, action_version,
              initiator_principal_id, actor_principal_id, target_id, parameter_hash,
              gate_state, dispatch_state, correlation_id)
         values ($1, $2, $3, $4, 1, $5, $5, $6, $7, 'ALLOWED', 'NOT_DISPATCHED', $3)",
    )
    .bind(ae)
    .bind(operation)
    .bind(tenant)
    .bind(ACTION_KEY)
    .bind(initiator)
    .bind(target)
    .bind(params)
    .execute(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    for (stage, event_type, result) in [
        ("intent", "INTENT", "EVALUATING"),
        ("decision", "DECISION", "ALLOWED"),
    ] {
        append(
            tx,
            entry(
                operation,
                stage,
                event_type,
                tenant,
                initiator,
                target_type,
                target,
                params,
                "ALLOW",
                result,
            ),
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(ae)
}

/// Platform Catalog 的首位 admin 必须使用独立 subject。业务 Tenant 之间的
/// 多成员关系仍由 `.design/03` §2 的 Tenant 选择规则处理；这里只隔离 Catalog。
async fn has_cross_scope_membership(
    conn: &mut PgConnection,
    issuer: &str,
    subject: &str,
    catalog: Uuid,
    target_is_catalog: bool,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "select exists (
           select 1 from identity.external_identity ei
           join identity.tenant_membership tm on tm.human_identity_id = ei.human_identity_id
           where ei.issuer = $1 and ei.subject = $2
             and (($3 and tm.tenant_id <> $4) or (not $3 and tm.tenant_id = $4))
         )",
    )
    .bind(issuer)
    .bind(subject)
    .bind(target_is_catalog)
    .bind(catalog)
    .fetch_one(conn)
    .await
}

/// 先在同一 subject 串行点重验 Catalog 排他，再建立 Principal、Membership 与
/// 引导意图。事务外预检仅用于早拒绝，不能代替这次最终判定。
#[allow(clippy::too_many_arguments)]
async fn prepare_bootstrap_membership(
    pool: &PgPool,
    issuer: &str,
    catalog_slug: &str,
    subject: &str,
    tenant: Uuid,
    human: Uuid,
    initiator: Uuid,
    params: &str,
) -> Result<(Uuid, Uuid, String), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    crate::external_human::lock_subject(&mut tx, issuer, subject)
        .await
        .map_err(|e| format!("锁定引导 subject 失败: {e}"))?;
    if crate::external_human::find(&mut tx, issuer, subject)
        .await
        .map_err(|e| format!("重验引导 subject 失败: {e}"))?
        != Some((human, true))
    {
        return Err("引导 subject 不再对应 active HumanIdentity".into());
    }
    let catalog: Uuid = sqlx::query_scalar("select id from identity.tenant where slug = $1")
        .bind(catalog_slug)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| format!("读取 Catalog Tenant 失败: {e}"))?;
    if has_cross_scope_membership(&mut tx, issuer, subject, catalog, tenant == catalog)
        .await
        .map_err(|e| format!("重验引导 admin subject 失败: {e}"))?
    {
        return Err("Catalog admin 的 OIDC subject 不得绑定业务 Tenant，业务 admin 也不得使用已绑定 Catalog 的 subject".into());
    }
    let found: Option<(Uuid, Uuid, String)> = sqlx::query_as(
        "select id, tenant_principal_id, state from identity.tenant_membership
         where tenant_id = $1 and human_identity_id = $2",
    )
    .bind(tenant)
    .bind(human)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    let result = match found {
        Some((m, p, s)) => (m, p, s),
        None => {
            let (m, p) = (Uuid::new_v4(), Uuid::new_v4());
            sqlx::query(
                "insert into identity.principal (id, tenant_id, kind, status) values ($1, $2, 'HUMAN', 'ACTIVE')",
            )
            .bind(p)
            .bind(tenant)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
            sqlx::query(
                "insert into identity.tenant_membership (id, tenant_id, human_identity_id, tenant_principal_id, state)
                 values ($1, $2, $3, $4, 'PROVISIONING')",
            )
            .bind(m)
            .bind(tenant)
            .bind(human)
            .bind(p)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
            record_bootstrap(&mut tx, tenant, initiator, "TENANT_MEMBERSHIP", m, params).await?;
            (m, p, "PROVISIONING".to_owned())
        }
    };
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(result)
}

pub async fn run(args: Args) -> Result<Outcome, String> {
    if !crate::governance::valid_slug(&args.slug) || args.name.trim().is_empty() {
        return Err("slug 只接受小写字母、数字与连字符，显示名不能为空".into());
    }
    let pool = PgPoolOptions::new()
        .max_connections(
            env("CORE_DB_MAX_CONNECTIONS")?
                .parse()
                .map_err(|_| "CORE_DB_MAX_CONNECTIONS 必须是正整数")?,
        )
        .connect(&env("DATABASE_URL")?)
        .await
        .map_err(|e| format!("连 Core 库: {e}"))?;
    let ctx = Ctx {
        temporal: TemporalClient::from_env(crate::oidc::TokenSource::from_env()?).await?,
        spicedb: SpiceDb::from_env(reqwest::Client::new())?,
        openmeter: crate::openmeter::OpenMeter::from_env()?,
        page: env("SPICEDB_READ_PAGE_LIMIT")?
            .parse()
            .map_err(|_| "SPICEDB_READ_PAGE_LIMIT 必须是正整数")?,
        issuer: env("HUMAN_OIDC_ISSUER")?,
        client_id: env("HUMAN_OIDC_CLIENT_ID")?,
        catalog_slug: env("PLATFORM_CATALOG_TENANT_SLUG")?,
        pool,
    };
    let deadline = Instant::now() + args.wait;
    ctx.assert_bootstrap_subject_exclusive(&args.slug, &args.admin_subject)
        .await?;
    let initiator = ctx.bootstrap_principal().await?;
    if let Some(expected) = args.repair_catalog_id {
        ctx.repair_legacy_catalog(&args, expected, initiator)
            .await?;
    }
    let params = hex::encode(Sha256::digest(
        json!({ "slug": args.slug, "adminSubject": args.admin_subject })
            .to_string()
            .as_bytes(),
    ));

    // 1. Tenant：不存在即以 PROVISIONING 建立并经 TENANT_LIFECYCLE 开通
    let tenant = ctx.ensure_tenant(&args, initiator, &params).await?;
    if !ctx.wait_state("identity.tenant", tenant, deadline).await? {
        return Ok(Outcome {
            tenant_id: tenant,
            admin_principal_id: None,
            state: "PENDING",
        });
    }

    // 2. 0→1 判定先于身份/授权写入：已有有效 admin 的 Tenant 里，引导既不登记
    //    身份、不加人，也不授权。声明的同一 admin 可补齐 DD-38 的原生 Customer；
    //    此步骤有自己的原 tenant.bootstrap AE，而不是重开已终态的 Tenant Workflow。
    let mut conn = ctx.pool.acquire().await.map_err(|e| e.to_string())?;
    let effective =
        crate::roles::effective_tenant_admins(&mut conn, &ctx.spicedb, tenant, ctx.page)
            .await
            .map_err(|e| format!("读有效 admin: {e:?}"))?;
    drop(conn);
    let existing: Option<Uuid> = sqlx::query_scalar(
        "select tm.tenant_principal_id from identity.tenant_membership tm
         join identity.external_identity ei on ei.human_identity_id = tm.human_identity_id
         where tm.tenant_id = $1 and ei.issuer = $2 and ei.subject = $3",
    )
    .bind(tenant)
    .bind(&ctx.issuer)
    .bind(&args.admin_subject)
    .fetch_optional(&ctx.pool)
    .await
    .map_err(|e| e.to_string())?;
    if let Some(p) = existing.filter(|p| effective.contains(p)) {
        ctx.ensure_metering_customer(tenant, p, initiator, &args.admin_subject)
            .await?;
        return Ok(Outcome {
            tenant_id: tenant,
            admin_principal_id: Some(p),
            state: "COMPLETED",
        });
    }
    if !effective.is_empty() {
        return Ok(Outcome {
            tenant_id: tenant,
            admin_principal_id: None,
            state: "INERT",
        });
    }

    // 3. 首位成员：登记其外部身份（provisioning fact），经 MEMBERSHIP_PROJECTION 开通
    let human = ctx.ensure_human(&args).await?;
    let (principal, membership) = ctx
        .ensure_membership(tenant, human, &args.admin_subject, initiator, &params)
        .await?;
    if !ctx
        .wait_state("identity.tenant_membership", membership, deadline)
        .await?
    {
        return Ok(Outcome {
            tenant_id: tenant,
            admin_principal_id: None,
            state: "PENDING",
        });
    }

    // 4. admin 关系：Tenant 行锁内再判一次 0，写入与留痕同事务
    ctx.grant_first_admin(tenant, principal, initiator, &params)
        .await
}

#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CustomerBootstrapIntent {
    tenant_id: Uuid,
    namespace: String,
    admin_principal_id: Uuid,
    issuer: String,
    subject: String,
}

/// 原部署 ServicePrincipal 的固定 Customer 意图。调用方已按 AE → Tenant 持锁；
/// 这里锁 exact HUMAN 身份/membership 并 fresh Check，不把 service 凭据当业务权限。
pub(crate) async fn metering_context(
    conn: &mut PgConnection,
    spicedb: &SpiceDb,
    action: Uuid,
    tenant: Uuid,
    namespace: &str,
) -> Result<(crate::platform_keys::ActionAuditContext, String), crate::openmeter::Error> {
    use crate::openmeter::Error;
    let row: Option<(serde_json::Value, String)> = sqlx::query_as(
        "select ae.parameters, ae.parameter_hash from admission.action_execution ae
         join identity.service_principal sp on sp.principal_id=ae.initiator_principal_id
         join identity.principal p on p.id=sp.principal_id
         where ae.id=$1 and ae.tenant_id=$2 and ae.target_id=$2
           and ae.action_key=$3 and ae.action_version=1
           and ae.actor_principal_id=ae.initiator_principal_id
           and ae.gate_state='ALLOWED'
           and ae.dispatch_state in ('NOT_DISPATCHED','UNKNOWN','DISPATCHED')
           and ae.temporal_workflow_id is null
           and sp.audience=$4 and p.kind='SERVICE' and p.status='ACTIVE'
         for update of p,sp",
    )
    .bind(action)
    .bind(tenant)
    .bind(ACTION_KEY)
    .bind(AUDIENCE)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|_| Error::Unknown)?;
    let (parameters, hash) = row.ok_or(Error::Denied)?;
    let intent: CustomerBootstrapIntent =
        serde_json::from_value(parameters.clone()).map_err(|_| Error::Conflict)?;
    if intent.tenant_id != tenant
        || intent.namespace != namespace
        || intent.issuer.is_empty()
        || intent.subject.is_empty()
        || hex::encode(Sha256::digest(parameters.to_string().as_bytes())) != hash
    {
        return Err(Error::Conflict);
    }
    let token = customer_admin(conn, spicedb, &intent).await?;
    let context = crate::platform_keys::action_audit_context(conn, action, tenant)
        .await
        .map_err(|_| Error::Unknown)?;
    Ok((context, token))
}

async fn customer_admin(
    conn: &mut PgConnection,
    spicedb: &SpiceDb,
    intent: &CustomerBootstrapIntent,
) -> Result<String, crate::openmeter::Error> {
    use crate::openmeter::Error;
    let tenant = intent.tenant_id;
    let active: Option<bool> = sqlx::query_scalar(
        "select true from identity.tenant_membership tm
         join identity.principal p on p.id=tm.tenant_principal_id
         join identity.human_identity h on h.id=tm.human_identity_id
         join identity.external_identity ei on ei.human_identity_id=h.id
         where tm.tenant_id=$1 and tm.tenant_principal_id=$2 and tm.state='ACTIVE'
           and p.tenant_id=tm.tenant_id and p.kind='HUMAN' and p.status='ACTIVE'
           and h.status='ACTIVE' and ei.status='ACTIVE'
           and ei.issuer=$3 and ei.subject=$4
         for update of tm,p,h,ei",
    )
    .bind(tenant)
    .bind(intent.admin_principal_id)
    .bind(&intent.issuer)
    .bind(&intent.subject)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|_| Error::Unknown)?;
    if active != Some(true) {
        return Err(Error::Denied);
    }
    let checked = spicedb
        .check(
            "tenant",
            &tenant.to_string(),
            "manage",
            &intent.admin_principal_id.to_string(),
            crate::spicedb::Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| Error::Unknown)?;
    if !checked.allowed {
        return Err(Error::Denied);
    }
    if checked.zed_token.is_empty() {
        return Err(Error::Unknown);
    }
    Ok(checked.zed_token)
}

impl Ctx {
    async fn ensure_metering_customer(
        &self,
        tenant: Uuid,
        admin: Uuid,
        initiator: Uuid,
        subject: &str,
    ) -> Result<(), String> {
        let intent = CustomerBootstrapIntent {
            tenant_id: tenant,
            namespace: self.openmeter.namespace().to_owned(),
            admin_principal_id: admin,
            issuer: self.issuer.clone(),
            subject: subject.to_owned(),
        };
        let parameters = serde_json::to_value(&intent).map_err(|_| "Customer 引导参数不合合同")?;
        let hash = hex::encode(Sha256::digest(parameters.to_string().as_bytes()));
        // 唯一 Tenant Customer 意图不因重试、暂停恢复或配置变化换键。
        // 已 fence 的旧 Operation 只读 exact native key，不派第二次 POST。
        let key = Uuid::new_v5(
            &Uuid::NAMESPACE_URL,
            format!("urn:platform:tenant:{tenant}:openmeter-customer").as_bytes(),
        );
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        let version: Option<i32> = sqlx::query_scalar(
            "select version from identity.tenant where id=$1 and state='ACTIVE' for update",
        )
        .bind(tenant)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let version = version.ok_or("Customer 引导只接受原 ACTIVE Tenant")?;
        customer_admin(&mut tx, &self.spicedb, &intent)
            .await
            .map_err(|_| {
                "声明的 admin 身份或 fresh Tenant manage 未成立，未准入 Customer 初始化"
            })?;
        let found: Option<(Uuid, String, Option<serde_json::Value>)> = sqlx::query_as(
            "select id,parameter_hash,parameters from admission.action_execution
             where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3",
        )
        .bind(tenant)
        .bind(initiator)
        .bind(key)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let action = match found {
            Some((id, frozen_hash, frozen))
                if frozen_hash == hash && frozen.as_ref() == Some(&parameters) =>
            {
                id
            }
            Some(_) => {
                return Err("原 Customer 引导意图与本次 scope/config 不一致，不重建或重派发".into())
            }
            None => {
                let action =
                    record_bootstrap(&mut tx, tenant, initiator, "TENANT", tenant, &hash).await?;
                sqlx::query("update admission.action_execution set parameters=$2,idempotency_key=$3 where id=$1")
                    .bind(action)
                    .bind(&parameters)
                    .bind(key)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
                action
            }
        };
        // 准备事务不锁旧 AE，避免 Tenant → AE 的重入倒序；尚未派副作用。
        // 消费方提交后以原 AE → Tenant → exact HUMAN 行锁重验授权。
        tx.commit().await.map_err(|e| e.to_string())?;
        crate::tenant_lifecycle::reconcile_bootstrap_customer(
            &self.pool,
            &self.openmeter,
            &self.spicedb,
            &crate::tenant_lifecycle::TenantStepRequest {
                tenant_id: tenant,
                tenant_version: version,
            },
            action,
        )
        .await
        .map_err(|response| {
            format!(
                "Customer 对账未闭合（HTTP {}）；重跑只消费原 Operation",
                response.status()
            )
        })
    }

    async fn assert_bootstrap_subject_exclusive(
        &self,
        target_slug: &str,
        subject: &str,
    ) -> Result<(), String> {
        let catalog: Uuid = sqlx::query_scalar("select id from identity.tenant where slug = $1")
            .bind(&self.catalog_slug)
            .fetch_one(&self.pool)
            .await
            .map_err(|e| format!("读取 Catalog Tenant 失败: {e}"))?;
        let mut conn = self.pool.acquire().await.map_err(|e| e.to_string())?;
        let other = has_cross_scope_membership(
            &mut conn,
            &self.issuer,
            subject,
            catalog,
            target_slug == self.catalog_slug,
        )
        .await
        .map_err(|e| format!("核对引导 admin subject 失败: {e}"))?;
        if other {
            return Err("Catalog admin 的 OIDC subject 不得绑定业务 Tenant，业务 admin 也不得使用已绑定 Catalog 的 subject".into());
        }
        Ok(())
    }

    /// 旧版启动已把 Catalog 置为 ACTIVE，却没有 Community/CONTROL。只响应显式
    /// 指定确切 ID 的运维命令，在行锁和严格空集检查后修复错误数据；不把该操作
    /// 加进正常 Tenant 状态机，也不允许任何业务 Tenant 借用它。
    async fn repair_legacy_catalog(
        &self,
        args: &Args,
        expected: Uuid,
        initiator: Uuid,
    ) -> Result<(), String> {
        if args.slug != self.catalog_slug {
            return Err("--repair-catalog-id 仅接受 Platform Catalog Tenant 的 slug".into());
        }
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        let found: Option<(Uuid, String)> =
            sqlx::query_as("select id, state from identity.tenant where slug = $1 for update")
                .bind(&self.catalog_slug)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        let (catalog, state) = found.ok_or("Catalog Tenant 不存在")?;
        if catalog != expected {
            return Err("Catalog Tenant ID 与运维显式确认的 ID 不一致".into());
        }
        if state == "PROVISIONING" {
            let intent: bool = sqlx::query_scalar(
                "select exists(select 1 from admission.action_execution
                 where tenant_id = $1 and target_id = $1 and action_key = $2
                   and gate_state = 'ALLOWED')",
            )
            .bind(catalog)
            .bind(ACTION_KEY)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
            if !intent {
                return Err("Catalog PROVISIONING 但缺引导意图，拒绝接管".into());
            }
            return Ok(());
        }
        if state != "ACTIVE" {
            return Err(format!("Catalog Tenant 处于 {state}，修复拒绝改变状态"));
        }
        let binding: Option<String> = sqlx::query_scalar(
            "select state from projection.tenant_buzz_binding where tenant_id = $1",
        )
        .bind(catalog)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        if let Some(state) = binding {
            // 幂等重跑只接受完整 ACTIVE 协作面；中间态与 ACTIVE Tenant 的组合
            // 是不一致数据，不能当成修复已经结束。
            let control_ready: bool = sqlx::query_scalar(
                "select exists (
                   select 1 from projection.tenant_buzz_binding b
                   join identity.buzz_identity_binding i
                     on i.tenant_id = b.tenant_id
                    and i.principal_id = b.control_service_principal_id
                   where b.tenant_id = $1 and b.state = 'ACTIVE'
                     and i.kind = 'CONTROL' and i.state = 'ACTIVE'
                 )",
            )
            .bind(catalog)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
            if state == "ACTIVE" && control_ready {
                return Ok(());
            }
            return Err("旧 Catalog 已有未完成的协作面投影，拒绝再次修复".into());
        }
        let populated: bool = sqlx::query_scalar(
            "select exists(select 1 from identity.buzz_identity_binding where tenant_id = $1)
                 or exists(select 1 from identity.tenant_membership where tenant_id = $1)
                 or exists(select 1 from identity.workspace where tenant_id = $1)
                 or exists(select 1 from identity.tenant_invitation where tenant_id = $1)
                 or exists(select 1 from identity.principal
                           where tenant_id = $1 and kind <> 'SERVICE')
                 or exists(select 1 from admission.action_execution
                           where tenant_id = $1)",
        )
        .bind(catalog)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        if populated {
            return Err(
                "旧 Catalog 已有成员、身份、Workspace、邀请或 ActionExecution，拒绝修复".into(),
            );
        }
        let catalog_object = catalog.to_string();
        let admin = self
            .spicedb
            .read(
                &RelationshipFilter {
                    object_type: "tenant",
                    object_id: Some(&catalog_object),
                    relation: Some(crate::roles::TENANT_MANAGE_RELATION),
                    subject_principal: None,
                },
                self.page,
            )
            .await
            .map_err(|e| format!("核对 Catalog admin 关系失败: {e}"))?;
        if !admin.is_empty() {
            return Err("旧 Catalog 已有 admin 关系，拒绝修复".into());
        }
        let params = hex::encode(Sha256::digest(
            json!({ "catalogTenantId": catalog, "repair": "legacy-active-without-buzz" })
                .to_string()
                .as_bytes(),
        ));
        let ae = record_bootstrap(&mut tx, catalog, initiator, "TENANT", catalog, &params).await?;
        let operation: Uuid =
            sqlx::query_scalar("select operation_id from admission.action_execution where id = $1")
                .bind(ae)
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        sqlx::query(
            "update identity.tenant set state = 'PROVISIONING', version = version + 1
             where id = $1 and state = 'ACTIVE'",
        )
        .bind(catalog)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        append(
            &mut tx,
            entry(
                operation,
                "historical_repair",
                "OUTCOME",
                catalog,
                initiator,
                "TENANT",
                catalog,
                &params,
                "ALLOW",
                "LEGACY_CATALOG_REPAIR",
            ),
        )
        .await
        .map_err(|e| e.to_string())?;
        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn bootstrap_principal(&self) -> Result<Uuid, String> {
        let catalog: Uuid = sqlx::query_scalar("select id from identity.tenant where slug = $1")
            .bind(&self.catalog_slug)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| e.to_string())?
            .ok_or("Catalog Tenant 不存在：Core 尚未完成平台引导")?;
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        let id = deployment_principal(&mut tx, catalog).await?;
        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(id)
    }

    /// 一条引导步骤的 ActionExecution 与 INTENT/DECISION 审计。门禁直接 ALLOWED：
    /// 准入依据是部署权限本身，不是某个 Tenant 内的 SpiceDB 关系——此刻那个
    /// Tenant 里还没有任何人。
    async fn record(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        tenant: Uuid,
        initiator: Uuid,
        target_type: &str,
        target: Uuid,
        params: &str,
    ) -> Result<Uuid, String> {
        record_bootstrap(tx, tenant, initiator, target_type, target, params).await
    }

    async fn ensure_tenant(
        &self,
        args: &Args,
        initiator: Uuid,
        params: &str,
    ) -> Result<Uuid, String> {
        let found: Option<(Uuid, String)> =
            sqlx::query_as("select id, state from identity.tenant where slug = $1")
                .bind(&args.slug)
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| e.to_string())?;
        let (tenant, state) = match found {
            Some(t) => t,
            None => {
                let tenant = Uuid::new_v4();
                let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
                sqlx::query(
                    "insert into identity.tenant (id, slug, name, state) values ($1, $2, $3, 'PROVISIONING')",
                )
                .bind(tenant)
                .bind(&args.slug)
                .bind(args.name.trim())
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("建立 Tenant: {e}"))?;
                self.record(&mut tx, tenant, initiator, "TENANT", tenant, params)
                    .await?;
                tx.commit().await.map_err(|e| e.to_string())?;
                (tenant, "PROVISIONING".to_owned())
            }
        };
        match state.as_str() {
            "ACTIVE" => {
                if args.slug == self.catalog_slug {
                    let ready: bool = sqlx::query_scalar(
                        "select exists (
                           select 1 from projection.tenant_buzz_binding b
                           join identity.buzz_identity_binding i
                             on i.tenant_id = b.tenant_id
                            and i.principal_id = b.control_service_principal_id
                           where b.tenant_id = $1 and b.state = 'ACTIVE'
                             and i.kind = 'CONTROL' and i.state = 'ACTIVE'
                         )",
                    )
                    .bind(tenant)
                    .fetch_one(&self.pool)
                    .await
                    .map_err(|e| e.to_string())?;
                    if !ready {
                        return Err(
                            "Catalog Tenant ACTIVE 但协作面未查证；须显式修复，不能引导 admin"
                                .into(),
                        );
                    }
                }
                Ok(tenant)
            }
            "PROVISIONING" => {
                let ae = self.step_execution(tenant, tenant).await?;
                let started = launch_scope(
                    &self.pool,
                    &self.temporal,
                    &ScopeLifecycleRequest {
                        kind: ScopeKind::Tenant,
                        id: tenant,
                        action_execution_id: ae,
                        operation: ScopeOperation::Provision,
                    },
                )
                .await;
                self.dispatched(ae, "TENANT", started.map(|_| ()).map_err(|r| r.status()))
                    .await?;
                Ok(tenant)
            }
            other => Err(format!("Tenant {} 处于 {other}，引导不改变它", args.slug)),
        }
    }

    /// 本 Tenant 上某个 target 的引导 ActionExecution（由 `record` 建立）。
    async fn step_execution(&self, tenant: Uuid, target: Uuid) -> Result<Uuid, String> {
        sqlx::query_scalar(
            "select id from admission.action_execution
             where tenant_id = $1 and target_id = $2 and action_key = $3 and gate_state = 'ALLOWED'
             order by created_at desc limit 1",
        )
        .bind(tenant)
        .bind(target)
        .bind(ACTION_KEY)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("{target} 缺引导的 ActionExecution：它不是由引导建立的，引导不接管"))
    }

    /// 启动结论经统一的派发记录写回 ActionExecution。结果不明记 UNKNOWN、确定的
    /// 拒绝记 ABORTED，二者都让引导停下：重跑以同一 workflow ID 收敛（DD-48）。
    async fn dispatched(
        &self,
        ae: Uuid,
        target_type: &str,
        started: Result<(), axum::http::StatusCode>,
    ) -> Result<(), String> {
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        let recorded = record_dispatch(
            &mut tx,
            ae,
            AuditClass::core(target_type),
            started,
            vec![Evidence::new(EvidenceKind::DeploymentBootstrap, AUDIENCE)],
        )
        .await
        .map_err(|e| e.to_string())?;
        tx.commit().await.map_err(|e| e.to_string())?;
        match recorded.outcome {
            Dispatch::Dispatched => Ok(()),
            Dispatch::Unknown => {
                Err("生命周期 Workflow 启动结果不明，重跑以同一 workflow ID 收敛".into())
            }
            Dispatch::Aborted => Err(format!(
                "生命周期 Workflow 启动被确定拒绝（{started:?}），派发已中止"
            )),
        }
    }

    async fn wait_state(&self, table: &str, id: Uuid, deadline: Instant) -> Result<bool, String> {
        loop {
            let state: String =
                sqlx::query_scalar(&format!("select state from {table} where id = $1"))
                    .bind(id)
                    .fetch_one(&self.pool)
                    .await
                    .map_err(|e| e.to_string())?;
            match state.as_str() {
                "ACTIVE" => return Ok(true),
                "PROVISIONING" if Instant::now() < deadline => tokio::time::sleep(POLL).await,
                "PROVISIONING" => return Ok(false),
                other => return Err(format!("{table}/{id} 进入 {other}，引导停止")),
            }
        }
    }

    /// 声明的 subject 在本部署 IdP 下的 HumanIdentity。它就是 `.design/09` §5 所说的
    /// provisioning fact：首次登录时身份解析据此找到这个人。
    async fn ensure_human(&self, args: &Args) -> Result<Uuid, String> {
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        let human = crate::external_human::ensure(
            &mut tx,
            &self.issuer,
            &self.client_id,
            &args.admin_subject,
            &args.admin_display_name,
        )
        .await
        .map_err(|e| format!("登记外部身份: {e}"))?
        .ok_or("该 subject 的外部身份或 HumanIdentity 已停用，引导不重建它")?;
        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(human)
    }

    async fn ensure_membership(
        &self,
        tenant: Uuid,
        human: Uuid,
        subject: &str,
        initiator: Uuid,
        params: &str,
    ) -> Result<(Uuid, Uuid), String> {
        let (membership, principal, state) = prepare_bootstrap_membership(
            &self.pool,
            &self.issuer,
            &self.catalog_slug,
            subject,
            tenant,
            human,
            initiator,
            params,
        )
        .await?;
        match state.as_str() {
            "ACTIVE" => Ok((principal, membership)),
            "PROVISIONING" => {
                let ae = self.step_execution(tenant, membership).await?;
                let started = launch_membership(
                    &self.pool,
                    &self.temporal,
                    &LifecycleRequest {
                        scope: MembershipScope::Tenant,
                        membership_id: membership,
                        action_execution_id: ae,
                    },
                )
                .await;
                self.dispatched(
                    ae,
                    "TENANT_MEMBERSHIP",
                    started.map(|_| ()).map_err(|r| r.status()),
                )
                .await?;
                Ok((principal, membership))
            }
            // 已撤权的人不由引导恢复：成员的恢复只经邀请兑换与 admin 确认（DD-83）
            other => Err(format!(
                "此人在该 Tenant 的成员关系处于 {other}，引导不恢复成员；恢复经邀请（DD-83）"
            )),
        }
    }

    async fn grant_first_admin(
        &self,
        tenant: Uuid,
        principal: Uuid,
        initiator: Uuid,
        params: &str,
    ) -> Result<Outcome, String> {
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        crate::roles::lock_tenant(&mut tx, tenant)
            .await
            .map_err(|e| e.to_string())?;
        let effective =
            crate::roles::effective_tenant_admins(&mut tx, &self.spicedb, tenant, self.page)
                .await
                .map_err(|e| format!("读有效 admin: {e:?}"))?;
        if effective.contains(&principal) {
            return Ok(Outcome {
                tenant_id: tenant,
                admin_principal_id: Some(principal),
                state: "COMPLETED",
            });
        }
        if !effective.is_empty() {
            return Ok(Outcome {
                tenant_id: tenant,
                admin_principal_id: None,
                state: "INERT",
            });
        }
        let (key, version): (String, i32) = sqlx::query_as(
            "select role_key, version from catalog.role_template
             where role_key = 'TENANT_ADMIN' and status = 'ACTIVE'",
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| format!("Catalog 缺 active 的 TENANT_ADMIN 模板: {e}"))?;
        let t = crate::roles::template(&mut tx, &key, version)
            .await
            .map_err(|e| e.to_string())?;
        if !t.grants_tenant_manage() {
            return Err(
                "TENANT_ADMIN 模板不授予 tenant manage：引导不写一个造不出 admin 的关系".into(),
            );
        }
        let target = crate::roles::target_id(&t, tenant, principal);
        let rels = t.expand(tenant, principal);
        let ae = self
            .record(&mut tx, tenant, initiator, "TENANT_ROLE", target, params)
            .await?;
        // 写失败即整笔回滚：没有留下「已派发」的假象；写其实已生效的情形在重跑时
        // 以「此人已是有效 admin」收敛
        let token = self
            .spicedb
            .write(
                &rels
                    .iter()
                    .cloned()
                    .map(|r| (Write::Touch, r))
                    .collect::<Vec<_>>(),
            )
            .await
            .map_err(|e| format!("写 admin 关系结果不明，重跑以收敛: {e}"))?;
        let evidence = vec![
            Evidence::new(EvidenceKind::DeploymentBootstrap, AUDIENCE),
            Evidence::new(EvidenceKind::SpicedbZedtoken, &token),
            Evidence::new(
                EvidenceKind::SpicedbRelationship,
                format!(
                    "tenant:{tenant}#{}@principal:{principal}",
                    crate::roles::TENANT_MANAGE_RELATION
                ),
            ),
        ];
        // 同步写入：「派发」就是这次已确认的 SpiceDB 写，与 OUTCOME 同事务成立
        record_dispatch(
            &mut tx,
            ae,
            AuditClass::core("TENANT_ROLE"),
            Ok(()),
            evidence.clone(),
        )
        .await
        .map_err(|e| e.to_string())?;
        let operation: Uuid =
            sqlx::query_scalar("select operation_id from admission.action_execution where id = $1")
                .bind(ae)
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        let mut e = entry(
            operation,
            "outcome",
            "OUTCOME",
            tenant,
            initiator,
            "TENANT_ROLE",
            target,
            params,
            "ALLOW",
            "ROLE_GRANTED",
        );
        e.evidence_refs = evidence;
        append(&mut tx, e).await.map_err(|e| e.to_string())?;
        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(Outcome {
            tenant_id: tenant,
            admin_principal_id: Some(principal),
            state: "COMPLETED",
        })
    }
}

#[allow(clippy::too_many_arguments)]
fn entry<'a>(
    operation: Uuid,
    stage: &str,
    event_type: &'a str,
    tenant: Uuid,
    initiator: Uuid,
    target_type: &'a str,
    target: Uuid,
    params: &'a str,
    decision: &'a str,
    result: &'a str,
) -> AuditEntry<'a> {
    let class = AuditClass::core(target_type);
    AuditEntry {
        event_key: format!("{operation}:{stage}"),
        tenant_id: Some(tenant),
        workspace_id: None,
        operation_id: operation,
        event_type,
        human_identity_id: None,
        initiator_principal_id: Some(initiator),
        actor_principal_id: Some(initiator),
        action_key: ACTION_KEY,
        action_version: 1,
        component_type_key: class.component_type_key,
        target_type: Some(class.target_type),
        target_id: Some(target),
        parameter_hash: params,
        decision,
        result_code: result,
        result_exposure: class.result_exposure,
        evidence_refs: vec![Evidence::new(EvidenceKind::DeploymentBootstrap, AUDIENCE)],
        correlation_id: tenant,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn isolated_pool() -> PgPool {
        let expected =
            std::env::var("PLATFORM_ISOLATED_TEST_DB_NAME").expect("显式指定隔离核验库名称");
        let url =
            std::env::var("PLATFORM_ISOLATED_TEST_DATABASE_URL").expect("显式指定隔离核验库 URL");
        let pool = PgPool::connect(&url).await.expect("连接隔离核验库");
        let actual: String = sqlx::query_scalar("select current_database()")
            .fetch_one(&pool)
            .await
            .expect("读取当前数据库");
        assert_eq!(actual, expected, "禁止对非指定隔离库写入");
        let business = std::env::var("CORE_DB_NAME").expect("必须提供业务库名称作为防误写比较");
        assert_ne!(actual, business, "禁止把业务库当作隔离核验库");
        pool
    }

    async fn test_human(pool: &PgPool, issuer: &str, client_id: &str, subject: &str) -> Uuid {
        let mut tx = pool.begin().await.unwrap();
        let human = crate::external_human::ensure(&mut tx, issuer, client_id, subject, subject)
            .await
            .unwrap()
            .unwrap();
        tx.commit().await.unwrap();
        human
    }

    fn base_args() -> Vec<String> {
        [
            "--slug",
            "platform-catalog",
            "--name",
            "Catalog",
            "--admin-subject",
            "platform-admin",
            "--admin-display-name",
            "Platform Admin",
            "--wait-seconds",
            "0",
        ]
        .map(str::to_owned)
        .to_vec()
    }

    #[test]
    fn catalog_repair_requires_exact_uuid_argument() {
        let args = base_args();
        assert!(Args::parse(&args).unwrap().repair_catalog_id.is_none());

        let mut args = args;
        args.extend(["--repair-catalog-id".to_owned(), "not-a-uuid".to_owned()]);
        assert_eq!(
            Args::parse(&args).err().as_deref(),
            Some("--repair-catalog-id 必须是 UUID")
        );

        *args.last_mut().unwrap() = Uuid::nil().to_string();
        assert_eq!(
            Args::parse(&args).unwrap().repair_catalog_id,
            Some(Uuid::nil())
        );
    }

    #[tokio::test]
    #[ignore = "需显式指定全新且独立的 PostgreSQL 核验库"]
    async fn catalog_prewrite_and_admin_subject_exclusivity() {
        let pool = isolated_pool().await;
        let slug = format!("catalog-{}", Uuid::new_v4().simple());
        let catalog = ensure_catalog(&pool, &slug).await.expect("初建 Catalog");
        assert_eq!(
            ensure_catalog(&pool, &slug).await.expect("重复启动"),
            catalog
        );
        let state: String = sqlx::query_scalar("select state from identity.tenant where id = $1")
            .bind(catalog)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(state, "PROVISIONING");
        let (execution, operation, initiator): (Uuid, Uuid, Uuid) = sqlx::query_as(
            "select id, operation_id, initiator_principal_id
             from admission.action_execution
             where tenant_id = $1 and target_id = $1 and action_key = $2",
        )
        .bind(catalog)
        .bind(ACTION_KEY)
        .fetch_one(&pool)
        .await
        .expect("生命周期启动前的准入事实");
        assert_ne!(execution, Uuid::nil());
        let subject: (Uuid, String, String) = sqlx::query_as(
            "select p.tenant_id, p.kind, p.status from identity.principal p where p.id = $1",
        )
        .bind(initiator)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(subject, (catalog, "SERVICE".into(), "ACTIVE".into()));
        let audit: (i64, i64) = sqlx::query_as(
            "select count(*), count(distinct event_type)
             from audit.audit_event where tenant_id = $1 and operation_id = $2",
        )
        .bind(catalog)
        .bind(operation)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(audit, (2, 2), "只能有一组 INTENT/DECISION");

        let business = Uuid::new_v4();
        sqlx::query(
            "insert into identity.tenant (id, slug, name, state) values ($1, $2, '隔离验证', 'ACTIVE')",
        )
        .bind(business)
        .bind(format!("business-{}", Uuid::new_v4().simple()))
        .execute(&pool)
        .await
        .unwrap();
        let issuer = std::env::var("HUMAN_OIDC_ISSUER").unwrap();
        let client_id = std::env::var("HUMAN_OIDC_CLIENT_ID").unwrap();
        let catalog_subject = format!("catalog-admin-{}", Uuid::new_v4());
        let catalog_human = test_human(&pool, &issuer, &client_id, &catalog_subject).await;
        let first = prepare_bootstrap_membership(
            &pool,
            &issuer,
            &slug,
            &catalog_subject,
            catalog,
            catalog_human,
            initiator,
            "catalog-admin-test",
        )
        .await
        .expect("Catalog subject 首次建立成员");
        assert_eq!(first.2, "PROVISIONING");
        assert_eq!(
            prepare_bootstrap_membership(
                &pool,
                &issuer,
                &slug,
                &catalog_subject,
                catalog,
                catalog_human,
                initiator,
                "catalog-admin-test",
            )
            .await
            .expect("同 Tenant 幂等重试"),
            first
        );
        assert!(
            prepare_bootstrap_membership(
                &pool,
                &issuer,
                &slug,
                &catalog_subject,
                business,
                catalog_human,
                initiator,
                "business-admin-test",
            )
            .await
            .is_err(),
            "Catalog 已绑定 subject 不能再成为业务 Tenant bootstrap admin"
        );

        let business_subject = format!("business-admin-{}", Uuid::new_v4());
        let business_human = test_human(&pool, &issuer, &client_id, &business_subject).await;
        prepare_bootstrap_membership(
            &pool,
            &issuer,
            &slug,
            &business_subject,
            business,
            business_human,
            initiator,
            "business-admin-test",
        )
        .await
        .expect("业务 subject 首次建立成员");
        assert!(
            prepare_bootstrap_membership(
                &pool,
                &issuer,
                &slug,
                &business_subject,
                catalog,
                business_human,
                initiator,
                "catalog-admin-test",
            )
            .await
            .is_err(),
            "业务已绑定 subject 不能再成为 Catalog bootstrap admin"
        );

        let racing_subject = format!("racing-admin-{}", Uuid::new_v4());
        let racing_human = test_human(&pool, &issuer, &client_id, &racing_subject).await;
        let mut conn = pool.acquire().await.unwrap();
        assert!(
            !has_cross_scope_membership(&mut conn, &issuer, &racing_subject, catalog, true)
                .await
                .unwrap()
        );
        assert!(
            !has_cross_scope_membership(&mut conn, &issuer, &racing_subject, catalog, false)
                .await
                .unwrap()
        );
        drop(conn);
        let (catalog_result, business_result) = tokio::join!(
            prepare_bootstrap_membership(
                &pool,
                &issuer,
                &slug,
                &racing_subject,
                catalog,
                racing_human,
                initiator,
                "racing-admin-test",
            ),
            prepare_bootstrap_membership(
                &pool,
                &issuer,
                &slug,
                &racing_subject,
                business,
                racing_human,
                initiator,
                "racing-admin-test",
            )
        );
        assert_ne!(catalog_result.is_ok(), business_result.is_ok());
        let (memberships, principals): (i64, i64) = sqlx::query_as(
            "select (select count(*) from identity.tenant_membership where human_identity_id = $1),
                    (select count(*) from identity.principal where id in
                       (select tenant_principal_id from identity.tenant_membership where human_identity_id = $1))",
        )
        .bind(racing_human)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!((memberships, principals), (1, 1));
    }
}
