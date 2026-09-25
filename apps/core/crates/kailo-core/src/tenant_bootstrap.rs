//! 部署引导：建立一个业务 Tenant 与它的首位 Tenant admin（DD-82、ADR-11）。
//!
//! `.design` 没有定义 Tenant 的发起方（没有 `tenant.create` 动作）；邀请（DD-83）要由
//! 持有 Tenant manage 的人签发，而空 Tenant 里没有这样的人。于是「第一个人」只能来自
//! 部署：运维在 Core 容器内执行
//!
//! ```text
//! kailo-core bootstrap-tenant --slug <slug> --name <显示名> \
//!     --admin-subject <IdP subject> --admin-display-name <显示名> --wait-seconds <秒>
//! ```
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

use std::time::{Duration, Instant};

use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgPoolOptions, PgPool};
use uuid::Uuid;

use crate::audit::{append, AuditEntry};
use crate::membership_lifecycle::{
    launch_membership, launch_scope, LifecycleRequest, ScopeLifecycleRequest,
};
use crate::membership_projection::MembershipScope;
use crate::scope_state::ScopeKind;
use crate::spicedb::{SpiceDb, Write};
use crate::temporal::TemporalClient;

/// 部署引导这一 ServicePrincipal 的 audience。它是平台内一个固定身份的名字，
/// 不是部署取值：审计按它归因，换名字就断了历史。
const AUDIENCE: &str = "kailo-deployment-bootstrap";
const ACTION_KEY: &str = "tenant.bootstrap";
/// 轮询生命周期推进的间隔。等待的上界由运维以 `--wait-seconds` 给出。
const POLL: Duration = Duration::from_secs(1);

pub struct Args {
    pub slug: String,
    pub name: String,
    pub admin_subject: String,
    pub admin_display_name: String,
    pub wait: Duration,
}

impl Args {
    /// 参数全部必填，不接受默认值：猜一个 slug 或 subject 就是替运维决定谁掌管
    /// 一个 Tenant。
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
        page: env("SPICEDB_READ_PAGE_LIMIT")?
            .parse()
            .map_err(|_| "SPICEDB_READ_PAGE_LIMIT 必须是正整数")?,
        issuer: env("HUMAN_OIDC_ISSUER")?,
        client_id: env("HUMAN_OIDC_CLIENT_ID")?,
        catalog_slug: env("PLATFORM_CATALOG_TENANT_SLUG")?,
        pool,
    };
    let deadline = Instant::now() + args.wait;
    let initiator = ctx.bootstrap_principal().await?;
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

    // 2. 0→1 判定先于任何写入：已有有效 admin 的 Tenant 里，引导既不登记身份、
    //    不加人，也不授权
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
        .ensure_membership(tenant, human, initiator, &params)
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

impl Ctx {
    async fn bootstrap_principal(&self) -> Result<Uuid, String> {
        let catalog: Uuid = sqlx::query_scalar("select id from identity.tenant where slug = $1")
            .bind(&self.catalog_slug)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| e.to_string())?
            .ok_or("Catalog Tenant 不存在：Core 尚未完成平台引导")?;
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        // 并发的两次引导争同一个 audience：表锁让它们先后执行，后到的读到先到的那一行
        sqlx::query("lock table identity.service_principal in share row exclusive mode")
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        let found: Option<Uuid> = sqlx::query_scalar(
            "select principal_id from identity.service_principal where audience = $1",
        )
        .bind(AUDIENCE)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let id = match found {
            Some(id) => id,
            None => {
                let id = Uuid::new_v4();
                sqlx::query(
                    "insert into identity.principal (id, tenant_id, kind, status)
                     values ($1, $2, 'SERVICE', 'ACTIVE')",
                )
                .bind(id)
                .bind(catalog)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
                sqlx::query(
                    "insert into identity.service_principal (principal_id, audience) values ($1, $2)",
                )
                .bind(id)
                .bind(AUDIENCE)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
                id
            }
        };
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
            "ACTIVE" => Ok(tenant),
            "PROVISIONING" => {
                let ae = self.step_execution(tenant, tenant).await?;
                let started = launch_scope(
                    &self.pool,
                    &self.temporal,
                    &ScopeLifecycleRequest {
                        kind: ScopeKind::Tenant,
                        id: tenant,
                        action_execution_id: ae,
                    },
                )
                .await;
                self.dispatched(ae, started.map(|_| ()).map_err(|r| r.status()))
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

    /// 启动结论写回 ActionExecution。Start 结果不明时保持 NOT_DISPATCHED，重跑
    /// 以同一 workflow ID 收敛（DD-48）。
    async fn dispatched(
        &self,
        ae: Uuid,
        started: Result<(), axum::http::StatusCode>,
    ) -> Result<(), String> {
        match started {
            Ok(()) | Err(axum::http::StatusCode::CONFLICT) => {}
            Err(s) => {
                return Err(format!(
                    "生命周期 Workflow 启动未确认（HTTP {s}），重跑以继续"
                ))
            }
        }
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        let row: Option<(Uuid, Uuid, Uuid, Uuid, String)> = sqlx::query_as(
            "update admission.action_execution set dispatch_state = 'DISPATCHED', updated_at = now()
             where id = $1 and dispatch_state <> 'DISPATCHED'
             returning operation_id, tenant_id, initiator_principal_id, target_id, parameter_hash",
        )
        .bind(ae)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        if let Some((operation, tenant, initiator, target, params)) = row {
            let workflow: Option<String> = sqlx::query_scalar(
                "select workflow_id from projection.workflow_ref where action_execution_id = $1",
            )
            .bind(ae)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
            let target_type = if target == tenant {
                "TENANT"
            } else {
                "TENANT_MEMBERSHIP"
            };
            let mut e = entry(
                operation,
                "dispatch",
                "DISPATCH",
                tenant,
                initiator,
                target_type,
                target,
                &params,
                "ALLOW",
                "DISPATCHED",
            );
            e.evidence_refs = json!([
                { "kind": "DEPLOYMENT_BOOTSTRAP", "value": AUDIENCE },
                { "kind": "TEMPORAL_WORKFLOW_ID", "value": workflow },
            ]);
            append(&mut tx, e).await.map_err(|e| e.to_string())?;
        }
        tx.commit().await.map_err(|e| e.to_string())
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
        initiator: Uuid,
        params: &str,
    ) -> Result<(Uuid, Uuid), String> {
        let found: Option<(Uuid, Uuid, String)> = sqlx::query_as(
            "select id, tenant_principal_id, state from identity.tenant_membership
             where tenant_id = $1 and human_identity_id = $2",
        )
        .bind(tenant)
        .bind(human)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        let (membership, principal, state) = match found {
            Some((m, p, s)) => (m, p, s),
            None => {
                let (m, p) = (Uuid::new_v4(), Uuid::new_v4());
                let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
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
                self.record(&mut tx, tenant, initiator, "TENANT_MEMBERSHIP", m, params)
                    .await?;
                tx.commit().await.map_err(|e| e.to_string())?;
                (m, p, "PROVISIONING".to_owned())
            }
        };
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
                self.dispatched(ae, started.map(|_| ()).map_err(|r| r.status()))
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
        sqlx::query(
            "update admission.action_execution set dispatch_state = 'DISPATCHED' where id = $1",
        )
        .bind(ae)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let operation: Uuid =
            sqlx::query_scalar("select operation_id from admission.action_execution where id = $1")
                .bind(ae)
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        for (stage, event_type, result) in [
            ("dispatch", "DISPATCH", "DISPATCHED"),
            ("outcome", "OUTCOME", "ROLE_GRANTED"),
        ] {
            let mut e = entry(
                operation,
                stage,
                event_type,
                tenant,
                initiator,
                "TENANT_ROLE",
                target,
                params,
                "ALLOW",
                result,
            );
            e.evidence_refs = json!([
                { "kind": "DEPLOYMENT_BOOTSTRAP", "value": AUDIENCE },
                { "kind": "SPICEDB_ZEDTOKEN", "value": token },
                { "kind": "SPICEDB_RELATIONSHIP", "value": format!("tenant:{tenant}#{}@principal:{principal}", crate::roles::TENANT_MANAGE_RELATION) },
            ]);
            append(&mut tx, e).await.map_err(|e| e.to_string())?;
        }
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
        component_type_key: "core",
        target_type: Some(target_type),
        target_id: Some(target),
        parameter_hash: params,
        decision,
        result_code: result,
        result_exposure: "NONE",
        evidence_refs: json!([{ "kind": "DEPLOYMENT_BOOTSTRAP", "value": AUDIENCE }]),
        correlation_id: tenant,
    }
}
