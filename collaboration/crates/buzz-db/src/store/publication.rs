//! DD-81/160: the event writer is the sole delivery authority.
use crate::{error::Result, Db, DbError};
use buzz_core::{
    publication::{
        publication_epoch, publication_max_age_seconds, publication_timestamp_settled,
        timestamp_admitted, timestamp_settled, MergedStatusDelivery, PublicationClaim,
        PublicationPolicy, PublicationSettlement, PUBLICATION_POLICY_VERSION,
    },
    CommunityId,
};
use nostr::Event;
use sqlx::{PgConnection, PgPool};

const FENCE_MIGRATION: &str =
    include_str!("../../../../migrations/0048_publication_writer_fence.sql");

async fn lock_id(
    connection: &mut PgConnection,
    community: CommunityId,
    kind: u16,
    event_id: &str,
) -> Result<()> {
    let prefix = if kind == 1631 {
        "kailo:1631"
    } else {
        "kailo:publication"
    };
    let key = format!("{prefix}:{}:{event_id}", community.as_uuid());
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(key)
        .execute(connection)
        .await?;
    Ok(())
}
async fn lock(connection: &mut PgConnection, community: CommunityId, event: &Event) -> Result<()> {
    lock_id(
        connection,
        community,
        event.kind.as_u16(),
        &event.id.to_hex(),
    )
    .await
}
async fn retained_event(
    connection: &mut PgConnection,
    community: CommunityId,
    id: &[u8],
) -> Result<Option<buzz_core::StoredEvent>> {
    let row=sqlx::query("SELECT id,pubkey,created_at,kind,tags,content,sig,received_at,channel_id FROM public.events WHERE community_id=$1 AND id=$2 ORDER BY created_at DESC LIMIT 1")
        .bind(community.as_uuid()).bind(id).fetch_optional(connection).await?;
    match row {
        None => Ok(None),
        Some(row) => crate::event::row_to_stored_event(row)?
            .map(Some)
            .ok_or_else(|| DbError::InvalidData("unreadable retained publication".into())),
    }
}
async fn database_now(connection: &mut PgConnection) -> Result<i64> {
    Ok(
        sqlx::query_scalar("SELECT floor(extract(epoch FROM clock_timestamp()))::bigint")
            .fetch_one(connection)
            .await?,
    )
}

/// Retain the original Rust 1631 fence for mixed schema rollouts. The mandatory
/// database trigger also covers old binaries, COPY and ordinary event writers.
pub(crate) async fn guard_merged_status_write(
    connection: &mut PgConnection,
    community: CommunityId,
    event: &Event,
) -> Result<()> {
    if event.kind.as_u16() != 1631 {
        return Ok(());
    }
    lock(connection, community, event).await?;
    if crate::event::get_event_by_id_including_deleted_on(
        connection,
        community,
        event.id.as_bytes(),
    )
    .await?
    .is_some()
    {
        return Ok(());
    }
    if !timestamp_admitted(event.created_at.as_secs(), database_now(connection).await?) {
        return Err(DbError::AccessDenied(
            "event timestamp too far from server time".into(),
        ));
    }
    Ok(())
}

/// Inspect the actual function and all attached partitions, not a migration
/// version or a configuration promise. A disabled/changed guard cannot advertise
/// authority. The transaction's table lock prevents trigger DDL during observation
/// while allowing normal RowExclusive INSERT transactions to make progress.
async fn fence_ready(connection: &mut PgConnection) -> Result<bool> {
    let exists: bool = sqlx::query_scalar("SELECT to_regclass('public.events') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.communities') AND attname='publication_epoch' AND atttypid='uuid'::regtype AND attnotnull AND NOT attisdropped)")
        .fetch_one(&mut *connection).await?;
    if !exists {
        return Ok(false);
    }
    sqlx::query("LOCK TABLE public.events IN SHARE UPDATE EXCLUSIVE MODE")
        .execute(&mut *connection)
        .await?;
    let body = FENCE_MIGRATION
        .split("$publication_guard$")
        .nth(1)
        .expect("embedded publication migration function body")
        .trim();
    let ready: bool = sqlx::query_scalar(
        r#"
        SELECT current_setting('session_replication_role')='origin'
        AND EXISTS(SELECT 1 FROM pg_class WHERE oid='public.events'::regclass AND relkind='p')
        AND NOT EXISTS (
          SELECT 1 FROM pg_partition_tree('public.events'::regclass) tree
          WHERE NOT EXISTS (
            SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
            JOIN pg_namespace n ON n.oid=p.pronamespace
            JOIN pg_language l ON l.oid=p.prolang
            WHERE t.tgrelid=tree.relid AND t.tgname='events_publication_fence'
              AND t.tgenabled IN ('O','A') AND t.tgtype=7 AND NOT t.tgdeferrable
              AND t.tgnargs=0 AND t.tgqual IS NULL AND t.tgconstraint=0
              AND n.nspname='public' AND p.proname='events_publication_guard'
              AND l.lanname='plpgsql' AND NOT p.prosecdef AND p.proconfig IS NULL
              AND btrim(p.prosrc, E' \n\r\t')= $1
          )
        )
    "#,
    )
    .bind(body)
    .fetch_one(&mut *connection)
    .await?;
    Ok(ready)
}

async fn current_epoch(
    connection: &mut PgConnection,
    community: CommunityId,
) -> Result<Option<String>> {
    let row: Option<uuid::Uuid> = sqlx::query_scalar("SELECT publication_epoch FROM public.communities WHERE id=$1 AND archived_at IS NULL AND deleted_at IS NULL AND deletion_state='active' FOR SHARE")
        .bind(community.as_uuid()).fetch_optional(connection).await?;
    Ok(row.map(|id| id.to_string()))
}
async fn publication_policy(pool: &PgPool, community: CommunityId) -> Result<PublicationPolicy> {
    let connection = crate::observability::acquire_writer(
        pool,
        crate::observability::WriterOperation::Authorization,
    )
    .await?;
    let mut tx = sqlx::Transaction::begin(connection, None).await?;
    let ready = fence_ready(tx.as_mut()).await?;
    let epoch = if ready {
        current_epoch(tx.as_mut(), community).await?
    } else {
        None
    };
    let policy = PublicationPolicy {
        version: PUBLICATION_POLICY_VERSION,
        epoch: epoch.clone().unwrap_or_default(),
        max_age_seconds: publication_max_age_seconds(9).expect("ordinary storage window"),
        ready: ready && epoch.is_some(),
    };
    tx.commit().await?;
    Ok(policy)
}

async fn publication_settlement(
    pool: &PgPool,
    community: CommunityId,
    claim: &PublicationClaim,
) -> Result<PublicationSettlement> {
    if claim.validate().is_err() || claim.community_id != community.as_uuid().to_string() {
        return Err(DbError::InvalidData("invalid publication claim".into()));
    }
    let connection = crate::observability::acquire_writer(
        pool,
        crate::observability::WriterOperation::Authorization,
    )
    .await?;
    let mut tx = sqlx::Transaction::begin(connection, None).await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
        .execute(tx.as_mut())
        .await?;
    // Readiness precedes the per-event lock: no writer waits for this table lock.
    let ready = fence_ready(tx.as_mut()).await?;
    lock_id(tx.as_mut(), community, claim.kind, &claim.event_id).await?;
    let epoch = if ready {
        current_epoch(tx.as_mut(), community).await?
    } else {
        None
    };
    let active:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM communities WHERE id=$1 AND archived_at IS NULL AND deleted_at IS NULL AND deletion_state='active')")
        .bind(community.as_uuid()).fetch_one(&mut *tx).await?;
    if !active {
        return Err(DbError::AccessDenied("community unavailable".into()));
    }
    let id = hex::decode(&claim.event_id)
        .map_err(|_| DbError::InvalidData("invalid publication id".into()))?;
    let stored = retained_event(tx.as_mut(), community, &id).await?;
    if let Some(row) = &stored {
        if !claim.matches_event(&row.event, row.channel_id) {
            return Err(DbError::InvalidData("publication evidence mismatch".into()));
        }
    }
    let observed_at = database_now(tx.as_mut()).await?;
    let settled = ready
        && epoch.as_deref() == Some(claim.epoch.as_str())
        && claim.non_expiring
        && publication_timestamp_settled(claim.kind, claim.created_at, observed_at);
    let result = PublicationSettlement {
        claim: claim.clone(),
        accepted: stored.is_some(),
        settled,
        observed_at,
    };
    tx.commit().await?;
    Ok(result)
}

/// Observe original 1631, including soft deletion. Positive evidence is available
/// without an epoch; absence needs the signed current epoch and live DB guard.
pub async fn merged_status_delivery(
    pool: &PgPool,
    community: CommunityId,
    event: &Event,
) -> Result<MergedStatusDelivery> {
    buzz_core::publication::merged_status_repository(event, &event.pubkey)
        .map_err(|s| DbError::InvalidData(s.into()))?;
    let connection = crate::observability::acquire_writer(
        pool,
        crate::observability::WriterOperation::Authorization,
    )
    .await?;
    let mut tx = sqlx::Transaction::begin(connection, None).await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
        .execute(tx.as_mut())
        .await?;
    let ready = fence_ready(tx.as_mut()).await?;
    lock(tx.as_mut(), community, event).await?;
    let active:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM communities WHERE id=$1 AND archived_at IS NULL AND deleted_at IS NULL AND deletion_state='active')")
        .bind(community.as_uuid()).fetch_one(&mut *tx).await?;
    if !active {
        return Err(DbError::AccessDenied("community unavailable".into()));
    }
    let stored = retained_event(tx.as_mut(), community, event.id.as_bytes()).await?;
    if stored
        .as_ref()
        .is_some_and(|row| row.event.id != event.id || row.event.verify().is_err())
    {
        return Err(DbError::InvalidData("publication evidence mismatch".into()));
    }
    let epoch = if ready {
        current_epoch(tx.as_mut(), community).await?
    } else {
        None
    };
    let result = MergedStatusDelivery {
        event_id: event.id.to_hex(),
        community_id: community.as_uuid().to_string(),
        accepted: stored.is_some(),
        settled: ready
            && epoch.as_deref().is_some_and(|epoch| {
                publication_epoch(event)
                    .is_ok_and(|signed| signed.is_some_and(|id| id.to_string() == epoch))
            })
            && timestamp_settled(event.created_at.as_secs(), database_now(tx.as_mut()).await?),
    };
    tx.commit().await?;
    Ok(result)
}
impl Db {
    /// Narrow writer observation; no event content is returned to the caller.
    pub async fn merged_status_delivery(
        &self,
        community: CommunityId,
        event: &Event,
    ) -> Result<MergedStatusDelivery> {
        merged_status_delivery(&self.pool, community, event).await
    }
    /// Community publication capability is backed by the live database catalog.
    pub async fn publication_policy(&self, community: CommunityId) -> Result<PublicationPolicy> {
        publication_policy(&self.pool, community).await
    }
    /// Caller verifies the original author and Core attestation before this read.
    pub async fn publication_settlement(
        &self,
        community: CommunityId,
        claim: &PublicationClaim,
    ) -> Result<PublicationSettlement> {
        publication_settlement(&self.pool, community, claim).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::publication::PUBLICATION_EPOCH_TAG;
    use chrono::Utc;
    use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};
    use std::time::Duration;
    async fn fixture() -> (PgPool, CommunityId, Keys) {
        let url = std::env::var("BUZZ_TEST_DATABASE_URL")
            .expect("explicit isolated publication database");
        let pool = PgPool::connect(&url).await.unwrap();
        crate::migration::run_migrations(&pool).await.unwrap();
        let community = CommunityId::from_uuid(uuid::Uuid::new_v4());
        sqlx::query("INSERT INTO communities(id,host) VALUES($1,$2)")
            .bind(community.as_uuid())
            .bind(format!("publication-{}.example", community.as_uuid()))
            .execute(&pool)
            .await
            .unwrap();
        (pool, community, Keys::generate())
    }
    fn status(keys: &Keys, created: u64) -> Event {
        EventBuilder::new(Kind::Custom(1631), "")
            .tags([Tag::parse(["a", &format!("30617:{}:repo", keys.public_key())]).unwrap()])
            .custom_created_at(Timestamp::from(created))
            .sign_with_keys(keys)
            .unwrap()
    }
    #[tokio::test]
    #[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL"]
    async fn delivery_waits_for_original_writer_commit_and_rollback() {
        let (pool, community, keys) = fixture().await;
        let observers = sqlx::postgres::PgPoolOptions::new()
            .after_connect(|connection, _| {
                Box::pin(async move {
                    sqlx::query("SET default_transaction_isolation='repeatable read'")
                        .execute(connection)
                        .await?;
                    Ok(())
                })
            })
            .connect(&std::env::var("BUZZ_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        let created = Timestamp::now().as_secs();
        for commit in [true, false] {
            let event = status(&keys, created + u64::from(commit));
            let mut tx = pool.begin().await.unwrap();
            crate::event::insert_event_in_transaction(&mut tx, community, &event, None)
                .await
                .unwrap();
            let mut observation = Box::pin(merged_status_delivery(&observers, community, &event));
            assert!(
                tokio::time::timeout(Duration::from_millis(100), &mut observation)
                    .await
                    .is_err(),
                "proof must wait for the original transaction"
            );
            if commit {
                tx.commit().await.unwrap();
            } else {
                tx.rollback().await.unwrap();
            }
            let proof = tokio::time::timeout(Duration::from_secs(5), observation)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(proof.accepted, commit);
            assert!(!proof.settled);
        }
    }
    #[tokio::test]
    #[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL"]
    async fn delivery_identity_is_verified_event_id_not_randomized_signature_bytes() {
        let (pool, community, keys) = fixture().await;
        let original = status(&keys, Timestamp::now().as_secs());
        crate::event::insert_event(&pool, community, &original, None)
            .await
            .unwrap();
        let mut signed_again = original.clone();
        signed_again.sig = keys.sign_schnorr(&nostr::secp256k1::Message::from_digest(
            original.id.to_bytes(),
        ));
        assert_ne!(signed_again.sig, original.sig);
        assert!(signed_again.verify().is_ok());
        assert_eq!(signed_again.id, original.id);
        assert!(
            merged_status_delivery(&pool, community, &signed_again)
                .await
                .unwrap()
                .accepted
        );
        signed_again.content = "changed".into();
        assert!(merged_status_delivery(&pool, community, &signed_again)
            .await
            .is_err());
    }
    #[tokio::test]
    #[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL"]
    async fn delivery_retains_evidence_after_status_and_its_deletion_are_deleted() {
        let (pool, community, keys) = fixture().await;
        let event = status(&keys, Timestamp::now().as_secs());
        crate::event::insert_event(&pool, community, &event, None)
            .await
            .unwrap();
        let deletion = EventBuilder::new(Kind::EventDeletion, "")
            .tags([Tag::event(event.id)])
            .sign_with_keys(&keys)
            .unwrap();
        crate::event::insert_event(&pool, community, &deletion, None)
            .await
            .unwrap();
        crate::event::soft_delete_event(&pool, community, event.id.as_bytes())
            .await
            .unwrap();
        crate::event::soft_delete_event(&pool, community, deletion.id.as_bytes())
            .await
            .unwrap();
        assert!(
            crate::event::get_event_by_id(&pool, community, event.id.as_bytes())
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            crate::event::get_event_by_id(&pool, community, deletion.id.as_bytes())
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            merged_status_delivery(&pool, community, &event)
                .await
                .unwrap()
                .accepted
        );
        let (_, other, _) = fixture().await;
        assert!(
            !merged_status_delivery(&pool, other, &event)
                .await
                .unwrap()
                .accepted
        );
        sqlx::query("UPDATE communities SET archived_at=now() WHERE id=$1")
            .bind(community.as_uuid())
            .execute(&pool)
            .await
            .unwrap();
        assert!(merged_status_delivery(&pool, community, &event)
            .await
            .is_err());
    }
    #[tokio::test]
    #[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL"]
    async fn late_writer_rechecks_original_admission_after_same_event_fence() {
        let (pool, community, keys) = fixture().await;
        let epoch = publication_policy(&pool, community).await.unwrap().epoch;
        let event = EventBuilder::new(Kind::Custom(1631), "")
            .tags([
                Tag::parse(["a", &format!("30617:{}:repo", keys.public_key())]).unwrap(),
                Tag::parse([PUBLICATION_EPOCH_TAG, &epoch]).unwrap(),
            ])
            .custom_created_at(Timestamp::from(Timestamp::now().as_secs() - 899))
            .sign_with_keys(&keys)
            .unwrap();
        assert!(timestamp_admitted(
            event.created_at.as_secs(),
            Utc::now().timestamp()
        ));
        let mut fence = pool.begin().await.unwrap();
        lock(fence.as_mut(), community, &event).await.unwrap();
        let mut writer = Box::pin(crate::event::insert_event(&pool, community, &event, None));
        assert!(
            tokio::time::timeout(Duration::from_millis(100), &mut writer)
                .await
                .is_err()
        );
        tokio::time::timeout(Duration::from_secs(4), async {
            while !timestamp_settled(event.created_at.as_secs(), Utc::now().timestamp()) {
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .unwrap();
        fence.commit().await.unwrap();
        assert!(
            writer.await.is_err(),
            "an old request admitted before waiting must not commit after a settled observation"
        );
        let proof = merged_status_delivery(&pool, community, &event)
            .await
            .unwrap();
        assert!(!proof.accepted);
        assert!(proof.settled);
        let mut tx = pool.begin().await.unwrap();
        assert!(
            crate::event::insert_event_in_transaction(&mut tx, community, &event, None)
                .await
                .is_err()
        );
        tx.rollback().await.unwrap();
        assert!(crate::event::insert_event_with_thread_metadata(
            &pool, community, &event, None, None
        )
        .await
        .is_err());
    }
    fn publication(keys: &Keys, kind: u16, created_at: u64, epoch: Option<&str>) -> Event {
        let tags = epoch
            .map(|epoch| Tag::parse([PUBLICATION_EPOCH_TAG, epoch]).unwrap())
            .into_iter()
            .collect::<Vec<_>>();
        EventBuilder::new(Kind::Custom(kind), "publication test")
            .tags(tags)
            .custom_created_at(Timestamp::from(created_at))
            .sign_with_keys(keys)
            .unwrap()
    }
    fn claim(community: CommunityId, event: &Event, epoch: &str) -> PublicationClaim {
        PublicationClaim {
            event_id: event.id.to_hex(),
            community_id: community.as_uuid().to_string(),
            pubkey: event.pubkey.to_hex(),
            kind: event.kind.as_u16(),
            channel_id: None,
            created_at: event.created_at.as_secs(),
            non_expiring: true,
            epoch: epoch.into(),
        }
    }
    /// Bypass Rust insertion helpers exactly as an old binary/COPY-capable SQL writer can.
    async fn raw_insert(
        connection: &mut PgConnection,
        community: CommunityId,
        event: &Event,
    ) -> std::result::Result<u64, sqlx::Error> {
        sqlx::query("INSERT INTO events(community_id,id,pubkey,created_at,kind,tags,content,sig,received_at) VALUES($1,$2,$3,to_timestamp($4),$5,$6,$7,$8,now()) ON CONFLICT DO NOTHING")
            .bind(community.as_uuid()).bind(event.id.as_bytes().as_slice()).bind(event.pubkey.to_bytes().as_slice())
            .bind(event.created_at.as_secs() as f64).bind(i32::from(event.kind.as_u16()))
            .bind(serde_json::to_value(&event.tags).unwrap()).bind(&event.content).bind(event.sig.as_ref())
            .execute(connection).await.map(|result| result.rows_affected())
    }
    #[tokio::test]
    #[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL"]
    async fn ordinary_raw_writers_enforce_windows_and_signed_epochs_without_guc() {
        let (pool, community, keys) = fixture().await;
        let policy = publication_policy(&pool, community).await.unwrap();
        assert!(policy.ready);
        assert_eq!(policy.max_age_seconds, 960);
        let mut conn = pool.acquire().await.unwrap();
        let now = database_now(&mut conn).await.unwrap() as u64;
        for kind in [
            1, 5, 7, 9, 1618, 1621, 1630, 1631, 1632, 1633, 9002, 40003, 45001, 45003,
        ] {
            let limit = publication_max_age_seconds(kind).unwrap();
            let fresh = publication(&keys, kind, now, Some(&policy.epoch));
            assert_eq!(raw_insert(&mut conn, community, &fresh).await.unwrap(), 1);
            assert_eq!(raw_insert(&mut conn, community, &fresh).await.unwrap(), 0);
            let late = publication(&keys, kind, now - limit - 1, Some(&policy.epoch));
            assert!(
                raw_insert(&mut conn, community, &late).await.is_err(),
                "kind {kind} bypassed storage fence"
            );
            let future = publication(&keys, kind, now + limit + 60, None);
            assert!(raw_insert(&mut conn, community, &future).await.is_err());
        }
        // Original Relay-generated outbox's 900..960-second retry interval remains.
        let notice = publication(&keys, 9, now - 930, None);
        assert_eq!(raw_insert(&mut conn, community, &notice).await.unwrap(), 1);
        let wrong = publication(&keys, 9, now, Some(&uuid::Uuid::new_v4().to_string()));
        assert!(raw_insert(&mut conn, community, &wrong).await.is_err());
        let duplicate = EventBuilder::new(Kind::Custom(9), "duplicate epoch")
            .tags([
                Tag::parse([PUBLICATION_EPOCH_TAG, policy.epoch.as_str()]).unwrap(),
                Tag::parse([PUBLICATION_EPOCH_TAG, policy.epoch.as_str()]).unwrap(),
            ])
            .sign_with_keys(&keys)
            .unwrap();
        assert!(raw_insert(&mut conn, community, &duplicate).await.is_err());
    }
    #[tokio::test]
    #[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL"]
    async fn ordinary_settlement_waits_for_old_writer_and_retains_deleted_identity() {
        let (pool, community, keys) = fixture().await;
        let policy = publication_policy(&pool, community).await.unwrap();
        for commit in [true, false] {
            let event = publication(
                &keys,
                if commit { 9 } else { 1 },
                Timestamp::now().as_secs(),
                Some(&policy.epoch),
            );
            let frozen = claim(community, &event, &policy.epoch);
            let mut tx = pool.begin().await.unwrap();
            raw_insert(tx.as_mut(), community, &event).await.unwrap();
            let mut proof = Box::pin(publication_settlement(&pool, community, &frozen));
            assert!(tokio::time::timeout(Duration::from_millis(100), &mut proof)
                .await
                .is_err());
            if commit {
                tx.commit().await.unwrap();
            } else {
                tx.rollback().await.unwrap();
            }
            let result = tokio::time::timeout(Duration::from_secs(5), proof)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(result.accepted, commit);
            assert!(!result.settled);
            if commit {
                crate::event::soft_delete_event(&pool, community, event.id.as_bytes())
                    .await
                    .unwrap();
                sqlx::query(
                    "UPDATE communities SET publication_epoch=gen_random_uuid() WHERE id=$1",
                )
                .bind(community.as_uuid())
                .execute(&pool)
                .await
                .unwrap();
                assert!(
                    publication_settlement(&pool, community, &frozen)
                        .await
                        .unwrap()
                        .accepted
                );
                let mut conn = pool.acquire().await.unwrap();
                assert_eq!(
                    raw_insert(&mut conn, community, &event).await.unwrap(),
                    0,
                    "existing tombstone preserves old-epoch duplicate"
                );
                // Restore only the fixture's epoch so the independent rollback case can insert.
                sqlx::query("UPDATE communities SET publication_epoch=$1 WHERE id=$2")
                    .bind(uuid::Uuid::parse_str(&policy.epoch).unwrap())
                    .bind(community.as_uuid())
                    .execute(&pool)
                    .await
                    .unwrap();
            }
        }
    }
    #[tokio::test]
    #[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL"]
    async fn ordinary_settlement_refuses_disabled_guard_old_schema_and_old_epoch() {
        let (pool, community, keys) = fixture().await;
        let policy = publication_policy(&pool, community).await.unwrap();
        let event = publication(
            &keys,
            9,
            Timestamp::now().as_secs() - 1000,
            Some(&policy.epoch),
        );
        let frozen = claim(community, &event, &policy.epoch);
        assert!(publication_settlement(&pool, community, &frozen)
            .await
            .unwrap()
            .proves_absence_for(&frozen));
        sqlx::query("UPDATE communities SET publication_epoch=gen_random_uuid() WHERE id=$1")
            .bind(community.as_uuid())
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            !publication_settlement(&pool, community, &frozen)
                .await
                .unwrap()
                .settled,
            "old epoch must never authorize a resend"
        );
        let current = publication_policy(&pool, community).await.unwrap();
        let new_event = publication(
            &keys,
            9,
            Timestamp::now().as_secs() - 1000,
            Some(&current.epoch),
        );
        let current_claim = claim(community, &new_event, &current.epoch);
        // A disabled parent or even one actual partition invalidates policy.
        for relation in ["public.events".to_string(),sqlx::query_scalar::<_,String>("SELECT relid::regclass::text FROM pg_partition_tree('events') WHERE isleaf LIMIT 1").fetch_one(&pool).await.unwrap()] {
            let mut tx=pool.begin().await.unwrap();
            sqlx::query(&format!("ALTER TABLE {relation} DISABLE TRIGGER events_publication_fence")).execute(&mut *tx).await.unwrap();
            assert!(!fence_ready(tx.as_mut()).await.unwrap());
            tx.rollback().await.unwrap();
        }
        sqlx::query("ALTER TABLE events DISABLE TRIGGER events_publication_fence")
            .execute(&pool)
            .await
            .unwrap();
        assert!(!publication_policy(&pool, community).await.unwrap().ready);
        assert!(
            !publication_settlement(&pool, community, &current_claim)
                .await
                .unwrap()
                .settled
        );
        sqlx::query("ALTER TABLE events ENABLE TRIGGER events_publication_fence")
            .execute(&pool)
            .await
            .unwrap();
        assert!(publication_settlement(&pool, community, &current_claim)
            .await
            .unwrap()
            .proves_absence_for(&current_claim));
        let mut tx = pool.begin().await.unwrap();
        sqlx::query("ALTER TABLE communities RENAME COLUMN publication_epoch TO unavailable_epoch")
            .execute(&mut *tx)
            .await
            .unwrap();
        assert!(!fence_ready(tx.as_mut()).await.unwrap());
        tx.rollback().await.unwrap();
    }
    #[tokio::test]
    #[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL"]
    async fn ordinary_late_raw_writer_rechecks_after_observer_lock() {
        let (pool, community, keys) = fixture().await;
        let epoch = publication_policy(&pool, community).await.unwrap().epoch;
        let event = publication(&keys, 1, Timestamp::now().as_secs() - 959, Some(&epoch));
        let frozen = claim(community, &event, &epoch);
        let mut held = pool.begin().await.unwrap();
        lock_id(held.as_mut(), community, 1, &event.id.to_hex())
            .await
            .unwrap();
        let mut connection = pool.acquire().await.unwrap();
        let mut writer = Box::pin(raw_insert(&mut connection, community, &event));
        assert!(
            tokio::time::timeout(Duration::from_millis(100), &mut writer)
                .await
                .is_err()
        );
        tokio::time::timeout(Duration::from_secs(4), async {
            while !publication_timestamp_settled(
                1,
                event.created_at.as_secs(),
                database_now(held.as_mut()).await.unwrap(),
            ) {
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .unwrap();
        held.commit().await.unwrap();
        assert!(
            writer.await.is_err(),
            "old binary's late raw insert must fail after lock release"
        );
        assert!(publication_settlement(&pool, community, &frozen)
            .await
            .unwrap()
            .proves_absence_for(&frozen));
    }
    #[tokio::test]
    #[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL"]
    async fn ordinary_copy_partition_guard_and_original_floor_probe_are_live() {
        let (pool, community, keys) = fixture().await;
        let epoch = publication_policy(&pool, community).await.unwrap().epoch;
        let mut connection = pool.acquire().await.unwrap();
        for age in [0, 1000] {
            let event = publication(&keys, 1, Timestamp::now().as_secs() - age, Some(&epoch));
            let fields = [
                community.as_uuid().to_string(),
                format!("\\x{}", event.id),
                format!("\\x{}", event.pubkey),
                chrono::DateTime::from_timestamp(event.created_at.as_secs() as i64, 0)
                    .unwrap()
                    .to_rfc3339(),
                "1".into(),
                serde_json::to_string(&event.tags).unwrap(),
                event.content.clone(),
                format!("\\x{}", event.sig),
                Utc::now().to_rfc3339(),
            ];
            let csv = fields
                .iter()
                .map(|field| format!("\"{}\"", field.replace('"', "\"\"")))
                .collect::<Vec<_>>()
                .join(",")
                + "\n";
            let mut copy=connection.copy_in_raw("COPY events(community_id,id,pubkey,created_at,kind,tags,content,sig,received_at) FROM STDIN WITH(FORMAT CSV)").await.unwrap();
            copy.send(csv.as_bytes()).await.unwrap();
            let result = copy.finish().await;
            assert_eq!(
                result.is_ok(),
                age == 0,
                "COPY must enforce the same storage window"
            );
        }
        drop(connection);
        let armed = Db::connect_writer_pool(&crate::DbConfig {
            database_url: std::env::var("BUZZ_TEST_DATABASE_URL").unwrap(),
            ..Default::default()
        })
        .await
        .unwrap();
        crate::replica_fence::verify_floor_guard_behavior(&armed)
            .await
            .unwrap();
        armed.close().await;
    }
    #[tokio::test]
    #[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL"]
    async fn malformed_retained_row_is_never_absence_evidence() {
        let (pool, community, keys) = fixture().await;
        let epoch = publication_policy(&pool, community).await.unwrap().epoch;
        let event = publication(&keys, 9, Timestamp::now().as_secs(), Some(&epoch));
        let frozen = claim(community, &event, &epoch);
        let mut connection = pool.acquire().await.unwrap();
        raw_insert(&mut connection, community, &event)
            .await
            .unwrap();
        sqlx::query("UPDATE events SET tags='[1]'::jsonb WHERE community_id=$1 AND id=$2")
            .bind(community.as_uuid())
            .bind(event.id.as_bytes().as_slice())
            .execute(&mut *connection)
            .await
            .unwrap();
        drop(connection);
        assert!(publication_settlement(&pool, community, &frozen)
            .await
            .is_err());
    }
}
