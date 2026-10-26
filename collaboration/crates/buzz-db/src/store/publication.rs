//! DD-81/160: the event writer is the sole delivery authority.
use crate::{error::Result, Db, DbError};
use buzz_core::{
    publication::{timestamp_admitted, timestamp_settled, MergedStatusDelivery},
    CommunityId,
};
use chrono::Utc;
use nostr::Event;
use sqlx::{PgConnection, PgPool};

async fn lock(connection: &mut PgConnection, community: CommunityId, event: &Event) -> Result<()> {
    let key = format!("kailo:1631:{}:{}", community.as_uuid(), event.id);
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(key)
        .execute(connection)
        .await?;
    Ok(())
}

/// Called inside every ordinary event insertion transaction. A request that
/// passed ingest before a long wait must be re-admitted behind the same fence
/// as absence observations before it can insert a merged status.
pub(crate) async fn guard_merged_status_write(
    connection: &mut PgConnection,
    community: CommunityId,
    event: &Event,
) -> Result<()> {
    if event.kind.as_u16() != 1631 {
        return Ok(());
    }
    lock(connection, community, event).await?;
    if !timestamp_admitted(event.created_at.as_secs(), Utc::now().timestamp()) {
        return Err(DbError::AccessDenied(
            "event timestamp too far from server time".into(),
        ));
    }
    Ok(())
}

/// Observe the original signed 1631 from the writer, including soft deletion,
/// while excluding all same-event inserts. The caller still owns HTTP admission.
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
    lock(tx.as_mut(), community, event).await?;
    let active:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM communities WHERE id=$1 AND archived_at IS NULL AND deleted_at IS NULL AND deletion_state='active')")
        .bind(community.as_uuid()).fetch_one(&mut *tx).await?;
    if !active {
        return Err(DbError::AccessDenied("community unavailable".into()));
    }
    let stored = crate::event::get_event_by_id_including_deleted_on(
        tx.as_mut(),
        community,
        event.id.as_bytes(),
    )
    .await?;
    if stored.as_ref().is_some_and(|row| row.event != *event) {
        return Err(DbError::InvalidData("publication evidence mismatch".into()));
    }
    let result = MergedStatusDelivery {
        event_id: event.id.to_hex(),
        community_id: community.as_uuid().to_string(),
        accepted: stored.is_some(),
        settled: timestamp_settled(event.created_at.as_secs(), Utc::now().timestamp()),
    };
    tx.commit().await?;
    Ok(result)
}
impl Db {
    /// Narrow writer observation; no event content is returned to the caller.
    #[buzz_datastore_tracing::datastore_span(name = "merged_status_delivery", system = "postgresql")]
    pub async fn merged_status_delivery(
        &self,
        community: CommunityId,
        event: &Event,
    ) -> Result<MergedStatusDelivery> {
        merged_status_delivery(&self.pool, community, event).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
        for commit in [true, false] {
            let event = status(&keys, Timestamp::now().as_secs() + u64::from(commit));
            let mut tx = pool.begin().await.unwrap();
            crate::event::insert_event_in_transaction(&mut tx, community, &event, None)
                .await
                .unwrap();
            let mut observation = Box::pin(merged_status_delivery(&pool, community, &event));
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
        let event = status(&keys, Timestamp::now().as_secs() - 899);
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
}
