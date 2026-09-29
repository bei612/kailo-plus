//! `.design/03` §2：ACTIVE membership 不得把停用或跨 Tenant 的 Principal 解析成会话身份。

use identity::{resolve, session, IdentityError};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

#[tokio::test]
async fn identity_requires_an_active_human_principal_in_the_same_tenant() {
    if std::env::var("PLATFORM_INTEGRATION").as_deref() != Ok("1") {
        return;
    }
    let database_url = std::env::var("DATABASE_URL").expect("隔离核验库 DATABASE_URL");
    let pool = PgPool::connect(&database_url)
        .await
        .expect("连接隔离核验库");
    let ids = Ids::new();
    seed(&pool, &ids).await.expect("建立隔离身份夹具");
    let result = verify(&pool, &ids).await;
    cleanup(&pool, &ids).await.expect("删除隔离身份夹具");
    if let Err(message) = result {
        panic!("身份作用域核验失败：{message}");
    }
}

struct Ids {
    provider: Uuid,
    external: Uuid,
    human: Uuid,
    tenant: Uuid,
    other_tenant: Uuid,
    principal: Uuid,
    membership: Uuid,
    issuer: String,
    subject: String,
}

impl Ids {
    fn new() -> Self {
        let provider = Uuid::new_v4();
        Self {
            provider,
            external: Uuid::new_v4(),
            human: Uuid::new_v4(),
            tenant: Uuid::new_v4(),
            other_tenant: Uuid::new_v4(),
            principal: Uuid::new_v4(),
            membership: Uuid::new_v4(),
            issuer: format!("scope-issuer-{provider}"),
            subject: format!("scope-subject-{provider}"),
        }
    }
}

async fn seed(pool: &PgPool, ids: &Ids) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("insert into identity.identity_provider (id, issuer, client_id, claim_mapping_version, status) values ($1, $2, 'scope-fixture', 1, 'ACTIVE')")
        .bind(ids.provider)
        .bind(&ids.issuer)
        .execute(&mut *tx)
        .await?;
    sqlx::query("insert into identity.human_identity (id, display_name, status) values ($1, 'scope-fixture', 'ACTIVE')")
        .bind(ids.human)
        .execute(&mut *tx)
        .await?;
    sqlx::query("insert into identity.external_identity (id, provider_id, issuer, subject, human_identity_id, status) values ($1, $2, $3, $4, $5, 'ACTIVE')")
        .bind(ids.external)
        .bind(ids.provider)
        .bind(&ids.issuer)
        .bind(&ids.subject)
        .bind(ids.human)
        .execute(&mut *tx)
        .await?;
    for tenant in [ids.tenant, ids.other_tenant] {
        sqlx::query(
            "insert into identity.tenant (id, slug, name, state) values ($1, $2, $2, 'ACTIVE')",
        )
        .bind(tenant)
        .bind(format!("scope-{tenant}"))
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("insert into identity.principal (id, tenant_id, kind, status) values ($1, $2, 'HUMAN', 'ACTIVE')")
        .bind(ids.principal)
        .bind(ids.tenant)
        .execute(&mut *tx)
        .await?;
    sqlx::query("insert into identity.tenant_membership (id, tenant_id, human_identity_id, tenant_principal_id, state) values ($1, $2, $3, $4, 'ACTIVE')")
        .bind(ids.membership)
        .bind(ids.tenant)
        .bind(ids.human)
        .bind(ids.principal)
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

async fn verify(pool: &PgPool, ids: &Ids) -> Result<(), String> {
    let resolved = resolve(pool, Some(&ids.issuer), Some(&ids.subject))
        .await
        .map_err(|error| format!("正常身份被拒绝：{error}"))?;
    if resolved.tenant_id != ids.tenant.to_string()
        || resolved.tenant_principal_id != ids.principal.to_string()
    {
        return Err("正常身份解析到了错误 Tenant 或 Principal".into());
    }
    let ttl: i64 = std::env::var("PLATFORM_SESSION_TTL_SECONDS")
        .map_err(|error| error.to_string())?
        .parse()
        .map_err(|error: std::num::ParseIntError| error.to_string())?;
    let established = session::ensure(pool, ids.human, ids.membership, ttl)
        .await
        .map_err(|error| error.to_string())?;
    if !session::is_live(pool, established.id)
        .await
        .map_err(|error| error.to_string())?
    {
        return Err("正常 Principal 的会话不可用".into());
    }

    sqlx::query("update identity.principal set status = 'DISABLED' where id = $1")
        .bind(ids.principal)
        .execute(pool)
        .await
        .map_err(|error| error.to_string())?;
    if !matches!(
        resolve(pool, Some(&ids.issuer), Some(&ids.subject)).await,
        Err(IdentityError::PrincipalNotActive)
    ) {
        return Err("停用 Principal 仍能取得执行身份".into());
    }
    if session::is_live(pool, established.id)
        .await
        .map_err(|error| error.to_string())?
    {
        return Err("停用 Principal 的既有流会话仍然有效".into());
    }

    sqlx::query("update identity.principal set status = 'ACTIVE', kind = 'AGENT' where id = $1")
        .bind(ids.principal)
        .execute(pool)
        .await
        .map_err(|error| error.to_string())?;
    if !matches!(
        resolve(pool, Some(&ids.issuer), Some(&ids.subject)).await,
        Err(IdentityError::PrincipalNotActive)
    ) {
        return Err("AGENT Principal 被当作 HUMAN 取得执行身份".into());
    }
    if session::is_live(pool, established.id)
        .await
        .map_err(|error| error.to_string())?
    {
        return Err("AGENT Principal 的既有流会话仍然有效".into());
    }

    let mismatch = sqlx::query("insert into identity.tenant_membership (id, tenant_id, human_identity_id, tenant_principal_id, state) values ($1, $2, $3, $4, 'ACTIVE')")
        .bind(Uuid::new_v4())
        .bind(ids.other_tenant)
        .bind(ids.human)
        .bind(ids.principal)
        .execute(pool)
        .await;
    let rejected_by_fk = matches!(
        &mismatch,
        Err(sqlx::Error::Database(error)) if error.code().as_deref() == Some("23503")
    );
    if !rejected_by_fk {
        return Err(format!("跨 Tenant membership 未被数据库拒绝：{mismatch:?}"));
    }
    Ok(())
}

async fn cleanup(pool: &PgPool, ids: &Ids) -> Result<(), sqlx::Error> {
    let mut tx: Transaction<'_, Postgres> = pool.begin().await?;
    sqlx::query("delete from identity.platform_session where tenant_membership_id = $1")
        .bind(ids.membership)
        .execute(&mut *tx)
        .await?;
    sqlx::query("delete from identity.tenant_membership where id = $1")
        .bind(ids.membership)
        .execute(&mut *tx)
        .await?;
    sqlx::query("delete from identity.principal where id = $1")
        .bind(ids.principal)
        .execute(&mut *tx)
        .await?;
    sqlx::query("delete from identity.external_identity where id = $1")
        .bind(ids.external)
        .execute(&mut *tx)
        .await?;
    sqlx::query("delete from identity.human_identity where id = $1")
        .bind(ids.human)
        .execute(&mut *tx)
        .await?;
    sqlx::query("delete from identity.identity_provider where id = $1")
        .bind(ids.provider)
        .execute(&mut *tx)
        .await?;
    for tenant in [ids.tenant, ids.other_tenant] {
        sqlx::query("delete from identity.tenant where id = $1")
            .bind(tenant)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await
}
