//! DD-151: persist a SecretRef before write_once, then bind or fence/destroy version one.
//! The existing secret-store retirement primitive performs CAS=0 fencing and metadata
//! verification. Server-key intents cannot be reused: those carry different key authority.
use super::config::Policy;
use crate::service_api::ServiceState;
use sqlx::PgConnection;
use uuid::Uuid;

pub(super) async fn prepare(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    device: &str,
    r: &secret_store::SecretRef,
    policy: &Policy,
) -> Result<(), sqlx::Error> {
    sqlx::query("insert into admission.push_token_intent(locator,tenant_id,audience,device_pubkey,lease_until) values($1,$2,$3,$4,now()+make_interval(secs=>$5))")
 .bind(&r.locator).bind(tenant).bind(&r.audience).bind(device).bind(policy.token_prepare_lease_seconds).execute(pool).await?;
    Ok(())
}
pub(super) async fn bind(
    conn: &mut PgConnection,
    tenant: Uuid,
    device: &str,
    r: &secret_store::SecretRef,
) -> Result<bool, sqlx::Error> {
    let changed = sqlx::query(
        "update admission.push_token_intent set state='BOUND',updated_at=now()
 where locator=$1 and tenant_id=$2 and device_pubkey=$3 and audience=$4
 and (state='BOUND' or (state='PREPARING' and lease_until>now()))",
    )
    .bind(&r.locator)
    .bind(tenant)
    .bind(device)
    .bind(&r.audience)
    .execute(conn)
    .await?
    .rows_affected();
    Ok(changed == 1)
}
pub(super) async fn retire(conn: &mut PgConnection, locator: &str) -> Result<(), sqlx::Error> {
    sqlx::query("update admission.push_token_intent set state='RETIRING',next_attempt_at=now(),updated_at=now() where locator=$1 and state<>'RETIRED'")
 .bind(locator).execute(conn).await?;
    Ok(())
}
pub(super) async fn claim_retirement(
    pool: &sqlx::PgPool,
    policy: &Policy,
) -> Result<Vec<(String, Uuid, String)>, sqlx::Error> {
    // Freeze before external I/O: a late registration cannot bind this locator anymore.
    // Unique CAS=0 means a writer racing the fence cannot resurrect the destroyed version.
    let rows:Vec<(String,Uuid,String)>=sqlx::query_as("update admission.push_token_intent set state='RETIRING',
 next_attempt_at=now()+make_interval(secs=>least($1::numeric,$2::numeric*power(2,least(failures,ceil(log(2,greatest(1,$1::numeric/$2::numeric))))))::double precision),failures=case when failures<2147483647 then failures+1 else failures end,updated_at=now()
 where locator in(select i.locator from admission.push_token_intent i where
 ((i.state='PREPARING' and i.lease_until<=now()) or (i.state='RETIRING' and i.next_attempt_at<=now()))
 and not exists(select 1 from identity.push_registration r where r.token_secret_locator=i.locator)
 order by next_attempt_at for update skip locked limit $3) returning locator,tenant_id,audience")
 .bind(policy.token_retry_max_seconds).bind(policy.token_retry_base_seconds).bind(policy.retirement_batch_size).fetch_all(pool).await?;
    Ok(rows)
}
pub(super) async fn sweep(state: &ServiceState, policy: &Policy) -> Result<(), sqlx::Error> {
    let rows = claim_retirement(&state.pool, policy).await?;
    for (locator, tenant, audience) in rows {
        let reference = secret_store::SecretRef {
            locator,
            version: 1,
            audience,
        };
        if state
            .secrets
            .retire_push_token(tenant, &reference, true)
            .await
            .is_ok()
        {
            sqlx::query("update admission.push_token_intent set state='RETIRED',updated_at=now() where locator=$1 and state='RETIRING'")
   .bind(&reference.locator).execute(&state.pool).await?;
        } else {
            tracing::warn!(%tenant,"推送令牌退休等待元数据查证，持久退避后重试");
        }
    }
    Ok(())
}
