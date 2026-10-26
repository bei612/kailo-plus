//! DD-151: short database claims around external requests. A lost SENDING lease is UNKNOWN,
//! never a retry. Provider acceptance and its badge projection commit together.
use super::config::Policy;
use super::{
    decide::MessageFacts,
    send::{Outcome, Receipt},
};
use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool};
use std::collections::{BTreeSet, HashMap};
use uuid::Uuid;

#[derive(sqlx::FromRow, Debug)]
pub(super) struct Intent {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub tenant_principal_id: Uuid,
    pub device_pubkey: String,
    pub registration_version: i32,
    pub platform: String,
    pub provider_target: String,
    pub event_id: String,
    pub channel_id: String,
    pub root_id: Option<String>,
    pub event_created_at: i64,
    pub attempts: i32,
    pub lease_id: Option<Uuid>,
    pub expires_at: DateTime<Utc>,
}
impl Intent {
    pub fn message(&self) -> MessageFacts {
        MessageFacts {
            id: self.event_id.clone(),
            author: String::new(),
            created_at: self.event_created_at as u64,
            channel_id: self.channel_id.clone(),
            broadcast: false,
            mentioned: BTreeSet::new(),
            parent_id: self.root_id.clone(),
            root_id: self.root_id.clone(),
        }
    }
}

pub(super) async fn claim_scan(
    pool: &PgPool,
    tenant: Uuid,
    policy: &Policy,
) -> Result<Option<(Uuid, i64, Vec<String>)>, sqlx::Error> {
    // Start at now: do not fan out history when a Tenant first enables push.
    sqlx::query("insert into projection.push_cursor(tenant_id,since) values($1,floor(extract(epoch from now()))::bigint) on conflict do nothing")
        .bind(tenant).execute(pool).await?;
    let lease = Uuid::new_v4();
    let row:Option<(i64,Vec<String>)>=sqlx::query_as("update projection.push_cursor set lease_id=$2,lease_until=now()+make_interval(secs=>$3) where tenant_id=$1 and (lease_until is null or lease_until<=now()) returning since,seen_ids")
        .bind(tenant).bind(lease).bind(policy.lease_seconds).fetch_optional(pool).await?;
    Ok(row.map(|(since, seen)| (lease, since, seen)))
}
pub(super) async fn renew_scan(
    pool: &PgPool,
    tenant: Uuid,
    lease: Uuid,
    policy: &Policy,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("update projection.push_cursor set lease_until=now()+make_interval(secs=>$3) where tenant_id=$1 and lease_id=$2 and lease_until>now()")
        .bind(tenant).bind(lease).bind(policy.lease_seconds).execute(pool).await?.rows_affected()==1)
}
pub(super) async fn enqueue(
    pool: &PgPool,
    tenant: Uuid,
    lease: Uuid,
    message: &MessageFacts,
    targets: &[(&str, String)],
    policy: &Policy,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let owned=sqlx::query("update projection.push_cursor set lease_until=now()+make_interval(secs=>$3) where tenant_id=$1 and lease_id=$2 and lease_until>now()")
        .bind(tenant).bind(lease).bind(policy.lease_seconds).execute(&mut *tx).await?.rows_affected();
    if owned != 1 {
        return Ok(false);
    }
    for (platform, provider) in targets {
        // References only. Message and authorization facts are reread for each attempt.
        sqlx::query("insert into projection.push_send_intent(id,tenant_id,tenant_principal_id,device_pubkey,registration_version,platform,provider_target,event_id,channel_id,root_id,event_created_at,expires_at)
            select gen_random_uuid(),r.tenant_id,r.tenant_principal_id,r.device_pubkey,r.version,r.platform,$3,$4,$5,$6,$7::bigint,
            least(to_timestamp($7::bigint)+make_interval(secs=>$8),now()+make_interval(secs=>$8)) from identity.push_registration r join identity.tenant t on t.id=r.tenant_id
            where r.tenant_id=$1 and r.platform=$2 and r.state='ACTIVE' and r.enabled and t.state='ACTIVE'
            and to_timestamp($7::bigint)+make_interval(secs=>$8)>now() on conflict(tenant_id,device_pubkey,event_id) do nothing")
            .bind(tenant).bind(platform).bind(provider).bind(&message.id).bind(&message.channel_id)
            .bind(&message.root_id).bind(message.created_at as i64).bind(policy.notification_ttl_seconds).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(true)
}
pub(super) async fn checkpoint_scan(
    pool: &PgPool,
    tenant: Uuid,
    lease: Uuid,
    since: i64,
    seen: &[String],
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("update projection.push_cursor set since=$3,seen_ids=$4,lease_until=null,lease_id=null,updated_at=now()
        where tenant_id=$1 and lease_id=$2 and lease_until>now()")
        .bind(tenant).bind(lease).bind(since).bind(seen).execute(pool).await?.rows_affected()==1)
}

pub(super) async fn recover(conn: &mut PgConnection, policy: &Policy) -> Result<(), sqlx::Error> {
    // Only claims which have NOT crossed the durable send boundary can be reclaimed.
    sqlx::query("update projection.push_send_intent set state=case when state='SENDING' then 'UNKNOWN' else 'PREPARED' end,
 result_code=case when state='SENDING' then 'RESPONSE_UNKNOWN' else result_code end, updated_at=now()
 where state in ('CLAIMED','SENDING') and lease_until <= now()")
 .execute(&mut *conn).await?;
    sqlx::query("update projection.push_send_intent i set state='CANCELLED',result_code='EXPIRED_OR_REVOKED',updated_at=now()
 where state in ('PREPARED','RETRY') and (expires_at<=now() or attempts>=$1 or not exists (
 select 1 from identity.push_registration r join identity.tenant t on t.id=r.tenant_id
 where r.tenant_id=i.tenant_id and r.device_pubkey=i.device_pubkey and r.version=i.registration_version
 and r.state='ACTIVE' and r.enabled and t.state='ACTIVE'))")
 .bind(policy.max_attempts).execute(&mut *conn).await?;
    Ok(())
}

pub(super) async fn claim(
    pool: &PgPool,
    tenant: Uuid,
    policy: &Policy,
) -> Result<Option<Intent>, sqlx::Error> {
    let lease = Uuid::new_v4();
    sqlx::query_as(
        "update projection.push_send_intent set state='CLAIMED',lease_id=$2,
 lease_until=now()+make_interval(secs=>$3),updated_at=now()
 where id=(select id from projection.push_send_intent where tenant_id=$1
 and state in ('PREPARED','RETRY') and next_attempt_at<=now() and expires_at>now() and attempts<$4
 order by next_attempt_at,created_at,id for update skip locked limit 1) returning *",
    )
    .bind(tenant)
    .bind(lease)
    .bind(policy.lease_seconds)
    .bind(policy.max_attempts)
    .fetch_optional(pool)
    .await
}

pub(super) async fn cancel(pool: &PgPool, i: &Intent, reason: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update projection.push_send_intent set state='CANCELLED',result_code=$3,updated_at=now()
 where id=$1 and lease_id=$2 and state='CLAIMED'",
    )
    .bind(i.id)
    .bind(i.lease_id)
    .bind(reason)
    .execute(pool)
    .await?;
    Ok(())
}
pub(super) async fn defer(pool: &PgPool, i: &Intent, policy: &Policy) -> Result<(), sqlx::Error> {
    sqlx::query("update projection.push_send_intent set state='PREPARED',next_attempt_at=now()+make_interval(secs=>$3),updated_at=now()
 where id=$1 and lease_id=$2 and state='CLAIMED'")
 .bind(i.id).bind(i.lease_id).bind(policy.retry_base_seconds).execute(pool).await?;
    Ok(())
}

/// Locks the exact authorization rows only for the local state transition. Revocation
/// linearizes either before this boundary (no send) or after it (an in-flight send).
pub(super) async fn lock_device(
    conn: &mut PgConnection,
    tenant: Uuid,
    principal: Uuid,
    device: &str,
) -> Result<bool, sqlx::Error> {
    let tenant_ok: Option<Uuid> = sqlx::query_scalar(
        "select id from identity.tenant where id=$1 and state='ACTIVE' for share",
    )
    .bind(tenant)
    .fetch_optional(&mut *conn)
    .await?;
    if tenant_ok.is_none() {
        return Ok(false);
    }
    let member:Option<Uuid>=sqlx::query_scalar("select id from identity.tenant_membership where tenant_id=$1 and tenant_principal_id=$2 and state='ACTIVE' for share")
 .bind(tenant).bind(principal).fetch_optional(&mut *conn).await?;
    if member.is_none() {
        return Ok(false);
    }
    let key:Option<String>=sqlx::query_scalar("select pubkey from identity.buzz_identity_binding where tenant_id=$1 and principal_id=$2 and pubkey=$3 and custody='CLIENT' and state='ACTIVE' for share")
 .bind(tenant).bind(principal).bind(device).fetch_optional(conn).await?;
    Ok(key.is_some())
}

async fn lock_channel(conn: &mut PgConnection, i: &Intent) -> Result<bool, sqlx::Error> {
    let Ok(channel) = i.channel_id.parse::<Uuid>() else {
        return Ok(false);
    };
    let workspace:Option<Uuid>=sqlx::query_scalar("select b.workspace_id from projection.workspace_buzz_binding b join identity.workspace w on w.id=b.workspace_id where b.channel_id=$1 and w.tenant_id=$2 and w.state='ACTIVE' and b.state='ACTIVE' for share of b,w")
 .bind(channel).bind(i.tenant_id).fetch_optional(&mut *conn).await?;
    if let Some(workspace) = workspace {
        let member:Option<Uuid>=sqlx::query_scalar("select id from identity.workspace_membership where workspace_id=$1 and tenant_principal_id=$2 and state='ACTIVE' for share")
  .bind(workspace).bind(i.tenant_principal_id).fetch_optional(conn).await?;
        return Ok(member.is_some());
    }
    let conversation:Option<Uuid>=sqlx::query_scalar("select id from projection.conversation_buzz_binding where channel_id=$1 and tenant_id=$2 and state='ACTIVE' and $3=any(participant_principal_ids) for share")
 .bind(channel).bind(i.tenant_id).bind(i.tenant_principal_id).fetch_optional(conn).await?;
    Ok(conversation.is_some())
}

/// Reserve the per-device rate window and the durable send boundary in one short transaction.
pub(super) async fn begin_send(
    pool: &PgPool,
    i: &Intent,
    collapse: &str,
    policy: &Policy,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    if !lock_device(
        &mut tx,
        i.tenant_id,
        i.tenant_principal_id,
        &i.device_pubkey,
    )
    .await?
    {
        return Ok(false);
    }
    let registration:Option<i32>=sqlx::query_scalar("select version from identity.push_registration where tenant_id=$1 and device_pubkey=$2 and tenant_principal_id=$3 and state='ACTIVE' and enabled for update")
 .bind(i.tenant_id).bind(&i.device_pubkey).bind(i.tenant_principal_id).fetch_optional(&mut *tx).await?;
    if registration != Some(i.registration_version) || !lock_channel(&mut tx, i).await? {
        return Ok(false);
    }
    // Only a real prior send can fold this eligible notification. Queued Relay references
    // may turn out ineligible; they must never suppress an earlier eligible mention.
    let collapsed:bool=sqlx::query_scalar("select exists(select 1 from projection.push_delivery_window where tenant_id=$1 and device_pubkey=$2 and collapse_key=$3 and last_sent_at>=now()-make_interval(secs=>$4))")
        .bind(i.tenant_id).bind(&i.device_pubkey).bind(collapse).bind(policy.collapse_seconds).fetch_one(&mut *tx).await?;
    if collapsed {
        sqlx::query("update projection.push_send_intent set state='CANCELLED',result_code='COLLAPSED',updated_at=now() where id=$1 and lease_id=$2 and state='CLAIMED'")
            .bind(i.id).bind(i.lease_id).execute(&mut *tx).await?;
        tx.commit().await?;
        return Ok(false);
    }
    let allowed:bool=sqlx::query_scalar("select not exists(select 1 from projection.push_delivery_window where tenant_id=$1 and device_pubkey=$2 and collapse_key='*' and window_start>=now()-make_interval(secs=>$3) and window_count>=$4)")
        .bind(i.tenant_id).bind(&i.device_pubkey).bind(policy.device_window_seconds).bind(policy.device_attempt_limit).fetch_one(&mut *tx).await?;
    if !allowed {
        return Ok(false);
    }
    let changed=sqlx::query("update projection.push_send_intent set state='SENDING',attempts=attempts+1,lease_until=now()+make_interval(secs=>$3),updated_at=now()
 where id=$1 and lease_id=$2 and state='CLAIMED' and lease_until>now() and expires_at>now() and attempts<$4")
 .bind(i.id).bind(i.lease_id).bind(policy.lease_seconds).bind(policy.max_attempts).execute(&mut *tx).await?.rows_affected();
    if changed != 1 {
        return Ok(false);
    }
    // Count attempts, including UNKNOWN, so process crashes cannot evade the rate limit.
    sqlx::query("insert into projection.push_delivery_window (tenant_id,device_pubkey,collapse_key,last_sent_at,window_start,window_count)
 values($1,$2,$3,now(),now(),1),($1,$2,'*',now(),now(),1)
 on conflict(tenant_id,device_pubkey,collapse_key) do update set last_sent_at=now(),
 window_start=case when push_delivery_window.window_start<now()-make_interval(secs=>$4) then now() else push_delivery_window.window_start end,
 window_count=case when push_delivery_window.window_start<now()-make_interval(secs=>$4) then 1 else push_delivery_window.window_count+1 end")
 .bind(i.tenant_id).bind(&i.device_pubkey).bind(collapse).bind(policy.device_window_seconds).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(true)
}

pub(super) async fn finish(
    pool: &PgPool,
    i: &Intent,
    receipt: &Receipt,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    // Match the authorization -> registration -> intent order used by begin_send.
    let authorized = lock_device(
        &mut tx,
        i.tenant_id,
        i.tenant_principal_id,
        &i.device_pubkey,
    )
    .await?;
    let registration:Option<i32>=sqlx::query_scalar("select version from identity.push_registration where tenant_id=$1 and device_pubkey=$2 and state='ACTIVE' and enabled for update")
        .bind(i.tenant_id).bind(&i.device_pubkey).fetch_optional(&mut *tx).await?;
    let live = registration == Some(i.registration_version);
    // Late responses are evidence only for the original attempt, never for a newer lease.
    let status = match receipt.outcome {
        Outcome::Delivered => "ACCEPTED",
        Outcome::Unknown => "UNKNOWN",
        Outcome::Retry | Outcome::ProviderAuth => "RETRY",
        Outcome::Invalid | Outcome::Rejected => "REJECTED",
    };
    let changed = sqlx::query(
        "update projection.push_send_intent set state=$3,provider_reference=$4,result_code=$5,
 next_attempt_at=now()+make_interval(secs=>$6),updated_at=now()
 where id=$1 and lease_id=$2 and state in ('SENDING','UNKNOWN')",
    )
    .bind(i.id)
    .bind(i.lease_id)
    .bind(status)
    .bind(&receipt.reference)
    .bind(format!("{:?}", receipt.outcome))
    .bind(receipt.retry_after.as_secs_f64())
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if changed != 1 {
        return Ok(false);
    }
    if receipt.outcome == Outcome::Invalid {
        sqlx::query("update identity.push_registration set state='INVALID',version=version+1,updated_at=now() where tenant_id=$1 and device_pubkey=$2 and version=$3 and state='ACTIVE'")
  .bind(i.tenant_id).bind(&i.device_pubkey).bind(i.registration_version).execute(&mut *tx).await?;
    }
    if receipt.outcome == Outcome::Delivered {
        // No resurrection after Tenant/device/member revocation, or a token rotation.
        if live && authorized && lock_channel(&mut tx, i).await? {
            let positions:Option<serde_json::Value>=sqlx::query_scalar("select read_contexts from identity.collaboration_user_state where tenant_principal_id=$1")
   .bind(i.tenant_principal_id).fetch_optional(&mut *tx).await?;
            let marks = positions.map_or_else(HashMap::new, |v| super::decide::read_marks(&v));
            super::unread::record(
                &mut tx,
                i.tenant_id,
                i.tenant_principal_id,
                &i.message(),
                &marks,
            )
            .await?;
        }
    }
    tx.commit().await?;
    Ok(true)
}

#[cfg(test)]
#[path = "intent_tests.rs"]
mod tests;
