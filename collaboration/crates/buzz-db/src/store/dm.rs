//! Direct message channel persistence.
//!
//! DMs are channels with channel_type='dm' and visibility='private'.
//! Participant sets are immutable -- adding a member creates a NEW DM.

use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::channel::ChannelRecord;
use crate::error::{DbError, Result};
use crate::Db;
use buzz_core::CommunityId;
use buzz_datastore_tracing::datastore_span;

// -- Public structs -----------------------------------------------------------

/// A DM conversation with its participant list.
#[derive(Debug, Clone)]
pub struct DmRecord {
    /// The underlying channel ID.
    pub channel_id: Uuid,
    /// All active participants in this DM.
    pub participants: Vec<DmParticipant>,
    /// When the last message was sent (approximated by channel updated_at).
    pub last_message_at: Option<DateTime<Utc>>,
    /// When the DM was created.
    pub created_at: DateTime<Utc>,
}

/// A single participant in a DM.
#[derive(Debug, Clone)]
pub struct DmParticipant {
    /// Compressed public key bytes.
    pub pubkey: Vec<u8>,
    /// Optional display name from the users table.
    pub display_name: Option<String>,
    /// Member role string (always "member" for DMs).
    pub role: String,
}

// -- Pure helpers -------------------------------------------------------------

/// Compute a stable SHA-256 fingerprint for a set of participant pubkeys.
///
/// Pubkeys are sorted lexicographically before hashing so that the same set
/// of participants always produces the same hash regardless of input order.
/// No separator is used because all pubkeys are fixed-width 32-byte values.
pub fn compute_participant_hash(pubkeys: &[&[u8]]) -> [u8; 32] {
    let mut sorted: Vec<&[u8]> = pubkeys.to_vec();
    sorted.sort_unstable();
    sorted.dedup();

    let mut hasher = Sha256::new();
    for pk in sorted {
        hasher.update(pk);
    }
    hasher.finalize().into()
}

// -- DB functions -------------------------------------------------------------

/// A Core-authorized mapping of immutable human participants to current device keys.
/// This is projection metadata, not a second conversation or message store.
pub struct GovernedDmProjection {
    /// Core's stable native channel reference.
    pub channel_id: Uuid,
    /// Sorted immutable participant Principal references (not device keys).
    pub principals: Vec<Uuid>,
    /// Monotonic Core roster revision.
    pub generation: i64,
    /// Current Principal-to-key mapping, sorted by Principal then key.
    pub keys: Vec<(Uuid, Vec<u8>)>,
    /// Original human creator key; never the CONTROL signer.
    pub created_by: Vec<u8>,
}

/// Apply a governed DM projection in the command event's transaction.
///
/// Channel identity is stable across key rotation. Old generations cannot add
/// revoked keys back; equal generations must have exactly the same payload.
/// Returns every historical key so replay can finish cache/subscription eviction
/// even after a crash between commit and notification.
pub async fn project_governed_dm(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: CommunityId,
    control_key: &[u8],
    projection: &GovernedDmProjection,
) -> Result<Vec<Vec<u8>>> {
    let invalid = || DbError::InvalidData("invalid governed DM projection".into());
    let control_role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM relay_members WHERE community_id=$1 AND pubkey=$2 FOR SHARE",
    )
    .bind(community_id.as_uuid())
    .bind(hex::encode(control_key))
    .fetch_optional(&mut **tx)
    .await?;
    if control_role.as_deref() != Some("owner") {
        return Err(DbError::AccessDenied(
            "DM projection requires CONTROL owner".into(),
        ));
    }
    if projection.channel_id.is_nil()
        || !(2..=9).contains(&projection.principals.len())
        || projection.principals.iter().any(Uuid::is_nil)
        || projection.principals.windows(2).any(|p| p[0] >= p[1])
        || projection.generation <= 0
        || projection.created_by.len() != 32
        || projection.created_by == control_key
    {
        return Err(invalid());
    }
    let mut seen = std::collections::BTreeSet::new();
    let mut digest = Sha256::new();
    for principal in &projection.principals {
        digest.update(principal.as_bytes());
    }
    digest.update(&projection.created_by);
    for (principal, key) in &projection.keys {
        if projection.principals.binary_search(principal).is_err()
            || key.len() != 32
            || key == control_key
            || !seen.insert(key)
        {
            return Err(invalid());
        }
        digest.update(principal.as_bytes());
        digest.update(key);
        // Lock the source roster fact against concurrent relay-member removal.
        let role: Option<String> = sqlx::query_scalar(
            "SELECT role FROM relay_members WHERE community_id=$1 AND pubkey=$2 FOR SHARE",
        )
        .bind(community_id.as_uuid())
        .bind(hex::encode(key))
        .fetch_optional(&mut **tx)
        .await?;
        if role.as_deref() != Some("member") {
            return Err(DbError::AccessDenied(
                "DM key is not an active human relay member".into(),
            ));
        }
    }
    if projection.keys.windows(2).any(|p| p[0] >= p[1]) {
        return Err(invalid());
    }
    let digest = digest.finalize().to_vec();
    let name = if projection.principals.len() == 2 {
        "DM".to_owned()
    } else {
        format!("Group DM ({})", projection.principals.len())
    };
    let inserted = sqlx::query(
        "INSERT INTO channels (id,community_id,name,channel_type,visibility,created_by,
          platform_dm_principals,platform_dm_generation,platform_dm_digest)
         VALUES ($1,$2,$3,'dm','private',$4,$5,$6,$7)
         ON CONFLICT (community_id,id) DO NOTHING",
    )
    .bind(projection.channel_id)
    .bind(community_id.as_uuid())
    .bind(name)
    .bind(&projection.created_by)
    .bind(&projection.principals)
    .bind(projection.generation)
    .bind(&digest)
    .execute(&mut **tx)
    .await?
    .rows_affected()
        == 1;
    let row = sqlx::query(
        "SELECT platform_dm_principals,platform_dm_generation,platform_dm_digest,
                channel_type::text AS kind,visibility::text AS visibility,deleted_at
         FROM channels WHERE community_id=$1 AND id=$2 FOR UPDATE",
    )
    .bind(community_id.as_uuid())
    .bind(projection.channel_id)
    .fetch_one(&mut **tx)
    .await?;
    let principals: Option<Vec<Uuid>> = row.try_get("platform_dm_principals")?;
    let generation: Option<i64> = row.try_get("platform_dm_generation")?;
    let stored_digest: Option<Vec<u8>> = row.try_get("platform_dm_digest")?;
    if principals.as_ref() != Some(&projection.principals)
        || row.try_get::<String, _>("kind")? != "dm"
        || row.try_get::<String, _>("visibility")? != "private"
        || row
            .try_get::<Option<DateTime<Utc>>, _>("deleted_at")?
            .is_some()
        || generation.is_none_or(|g| g > projection.generation)
        || (generation == Some(projection.generation) && stored_digest.as_ref() != Some(&digest))
    {
        return Err(DbError::AccessDenied(
            "DM projection reference or generation conflict".into(),
        ));
    }
    if inserted || generation != Some(projection.generation) {
        let active_keys: Vec<Vec<u8>> =
            projection.keys.iter().map(|(_, key)| key.clone()).collect();
        sqlx::query(
            "UPDATE channel_members SET removed_at=now(),removed_by=$3
             WHERE community_id=$1 AND channel_id=$2 AND removed_at IS NULL
               AND NOT (pubkey=ANY($4::bytea[]))",
        )
        .bind(community_id.as_uuid())
        .bind(projection.channel_id)
        .bind(control_key)
        .bind(&active_keys)
        .execute(&mut **tx)
        .await?;
        for key in active_keys {
            sqlx::query(
                "INSERT INTO channel_members (community_id,channel_id,pubkey,role,invited_by)
                 VALUES ($1,$2,$3,'member',$4)
                 ON CONFLICT (community_id,channel_id,pubkey) DO UPDATE
                 SET removed_at=NULL,removed_by=NULL,role='member'",
            )
            .bind(community_id.as_uuid())
            .bind(projection.channel_id)
            .bind(key)
            .bind(&projection.created_by)
            .execute(&mut **tx)
            .await?;
        }
        sqlx::query(
            "UPDATE channels SET platform_dm_generation=$3,platform_dm_digest=$4
             WHERE community_id=$1 AND id=$2",
        )
        .bind(community_id.as_uuid())
        .bind(projection.channel_id)
        .bind(projection.generation)
        .bind(digest)
        .execute(&mut **tx)
        .await?;
    }
    sqlx::query_scalar("SELECT pubkey FROM channel_members WHERE community_id=$1 AND channel_id=$2")
        .bind(community_id.as_uuid())
        .bind(projection.channel_id)
        .fetch_all(&mut **tx)
        .await
        .map_err(Into::into)
}

/// Find an existing DM by its participant hash.
///
/// Returns `None` if no matching DM exists or if it has been deleted.
pub async fn find_dm_by_participants(
    pool: &PgPool,
    community_id: CommunityId,
    participant_hash: &[u8],
) -> Result<Option<ChannelRecord>> {
    let row = sqlx::query(
        r#"
        SELECT id, name, channel_type::text AS channel_type, visibility::text AS visibility,
               description, canvas,
               created_by, created_at, updated_at, archived_at, deleted_at,
               nip29_group_id, topic_required, max_members,
               topic, topic_set_by, topic_set_at,
               purpose, purpose_set_by, purpose_set_at
        FROM channels
        WHERE community_id = $1
          AND participant_hash = $2
          AND channel_type = 'dm'
          AND deleted_at IS NULL
        LIMIT 1
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(participant_hash)
    .fetch_optional(pool)
    .await?;

    row.map(row_to_channel_record).transpose()
}

/// Create a new DM channel for the given participant pubkeys, or return the
/// existing one if a DM with the same participant set already exists.
///
/// Rules:
/// - `participants` must contain 2-9 entries (enforced here).
/// - `created_by` must be one of the participants.
/// - The operation is idempotent: same participant set -> same channel returned.
pub async fn create_dm(
    pool: &PgPool,
    community_id: CommunityId,
    participants: &[&[u8]],
    created_by: &[u8],
) -> Result<ChannelRecord> {
    if participants.len() < 2 {
        return Err(DbError::InvalidData(
            "DM requires at least 2 participants".to_string(),
        ));
    }
    if participants.len() > 9 {
        return Err(DbError::InvalidData(
            "DM supports at most 9 participants".to_string(),
        ));
    }
    for pk in participants {
        if pk.len() != 32 {
            return Err(DbError::InvalidData(format!(
                "pubkey must be 32 bytes, got {}",
                pk.len()
            )));
        }
    }

    let hash = compute_participant_hash(participants);

    let mut tx = pool.begin().await?;

    // Idempotency check inside the transaction.
    let existing = sqlx::query(
        r#"
        SELECT id, name, channel_type::text AS channel_type, visibility::text AS visibility,
               description, canvas,
               created_by, created_at, updated_at, archived_at, deleted_at,
               nip29_group_id, topic_required, max_members,
               topic, topic_set_by, topic_set_at,
               purpose, purpose_set_by, purpose_set_at
        FROM channels
        WHERE community_id = $1
          AND participant_hash = $2
          AND channel_type = 'dm'
          AND deleted_at IS NULL
        LIMIT 1
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(hash.as_slice())
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(row) = existing {
        tx.commit().await?;
        return row_to_channel_record(row);
    }

    // Name the DM based on participant count.
    let name = if participants.len() == 2 {
        "DM".to_string()
    } else {
        format!("Group DM ({})", participants.len())
    };

    let id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO channels
            (id, community_id, name, channel_type, visibility, created_by, participant_hash)
        VALUES ($1, $2, $3, 'dm', 'private', $4, $5)
        "#,
    )
    .bind(id)
    .bind(community_id.as_uuid())
    .bind(&name)
    .bind(created_by)
    .bind(hash.as_slice())
    .execute(&mut *tx)
    .await?;

    // Add all participants as members with role='member'.
    for pk in participants {
        sqlx::query(
            r#"
            INSERT INTO channel_members (community_id, channel_id, pubkey, role, invited_by)
            VALUES ($1, $2, $3, 'member', $4)
            ON CONFLICT (community_id, channel_id, pubkey) DO UPDATE SET
                removed_at = NULL,
                removed_by = NULL,
                role = EXCLUDED.role
            "#,
        )
        .bind(community_id.as_uuid())
        .bind(id)
        .bind(*pk)
        .bind(created_by)
        .execute(&mut *tx)
        .await?;
    }

    let row = sqlx::query(
        r#"
        SELECT id, name, channel_type::text AS channel_type, visibility::text AS visibility,
               description, canvas,
               created_by, created_at, updated_at, archived_at, deleted_at,
               nip29_group_id, topic_required, max_members,
               topic, topic_set_by, topic_set_at,
               purpose, purpose_set_by, purpose_set_at
        FROM channels WHERE community_id = $1 AND id = $2
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;

    let record = row_to_channel_record(row)?;
    tx.commit().await?;
    Ok(record)
}

/// List all DM conversations for a given user, ordered by most recent activity.
///
/// Includes participant details for each DM. Supports cursor-based pagination
/// using `updated_at` ordering.
pub async fn list_dms_for_user(
    pool: &PgPool,
    community_id: CommunityId,
    pubkey: &[u8],
    limit: u32,
    cursor: Option<Uuid>,
) -> Result<Vec<DmRecord>> {
    let limit = limit.min(200) as i64;

    // Resolve cursor to a timestamp for keyset pagination.
    let cursor_ts: Option<DateTime<Utc>> = if let Some(cid) = cursor {
        let row =
            sqlx::query("SELECT updated_at FROM channels WHERE community_id = $1 AND id = $2")
                .bind(community_id.as_uuid())
                .bind(cid)
                .fetch_optional(pool)
                .await?;
        row.map(|r| r.try_get::<DateTime<Utc>, _>("updated_at"))
            .transpose()?
    } else {
        None
    };

    // Fetch DM channel IDs where this user is an active member.
    let channel_rows = if let Some(ts) = cursor_ts {
        sqlx::query(
            r#"
            SELECT c.id, c.created_at, c.updated_at
            FROM channels c
            JOIN channel_members cm
                ON c.community_id = cm.community_id
               AND c.id = cm.channel_id
               AND cm.pubkey = $2
               AND cm.removed_at IS NULL
               AND cm.hidden_at IS NULL
            WHERE c.community_id = $1
              AND c.channel_type = 'dm'
              AND c.deleted_at IS NULL
              AND c.updated_at < $3
            ORDER BY c.updated_at DESC
            LIMIT $4
            "#,
        )
        .bind(community_id.as_uuid())
        .bind(pubkey)
        .bind(ts)
        .bind(limit)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query(
            r#"
            SELECT c.id, c.created_at, c.updated_at
            FROM channels c
            JOIN channel_members cm
                ON c.community_id = cm.community_id
               AND c.id = cm.channel_id
               AND cm.pubkey = $2
               AND cm.removed_at IS NULL
               AND cm.hidden_at IS NULL
            WHERE c.community_id = $1
              AND c.channel_type = 'dm'
              AND c.deleted_at IS NULL
            ORDER BY c.updated_at DESC
            LIMIT $3
            "#,
        )
        .bind(community_id.as_uuid())
        .bind(pubkey)
        .bind(limit)
        .fetch_all(pool)
        .await?
    };

    let mut results = Vec::with_capacity(channel_rows.len());

    for row in channel_rows {
        let channel_id: Uuid = row.try_get("id")?;
        let created_at: DateTime<Utc> = row.try_get("created_at")?;
        let updated_at: DateTime<Utc> = row.try_get("updated_at")?;

        // Fetch participants for this DM.
        let member_rows = sqlx::query(
            r#"
            SELECT cm.pubkey, cm.role::text AS role, u.display_name
            FROM channel_members cm
            LEFT JOIN users u
              ON u.community_id = cm.community_id
             AND u.pubkey = cm.pubkey
            WHERE cm.community_id = $1
              AND cm.channel_id = $2
              AND cm.removed_at IS NULL
            ORDER BY cm.joined_at ASC
            "#,
        )
        .bind(community_id.as_uuid())
        .bind(channel_id)
        .fetch_all(pool)
        .await?;

        let participants: Vec<DmParticipant> = member_rows
            .into_iter()
            .map(|r| -> Result<DmParticipant> {
                Ok(DmParticipant {
                    pubkey: r.try_get("pubkey")?,
                    display_name: r.try_get("display_name")?,
                    role: r.try_get("role")?,
                })
            })
            .collect::<Result<Vec<_>>>()?;

        results.push(DmRecord {
            channel_id,
            participants,
            last_message_at: Some(updated_at),
            created_at,
        });
    }

    Ok(results)
}

/// Open or retrieve a DM for the given set of participants.
///
/// `created_by` is automatically added to `pubkeys` if not already present,
/// ensuring the caller is always a participant in their own DM.
///
/// Returns `(channel, was_created)`:
/// - `was_created = true`  -- a new DM was created.
/// - `was_created = false` -- an existing DM was returned.
pub async fn open_dm(
    pool: &PgPool,
    community_id: CommunityId,
    pubkeys: &[&[u8]],
    created_by: &[u8],
) -> Result<(ChannelRecord, bool)> {
    // Merge created_by into the participant set (dedup handled by compute_participant_hash).
    let mut all: Vec<&[u8]> = pubkeys.to_vec();
    if !all.contains(&created_by) {
        all.push(created_by);
    }

    // Enforce max before hitting the DB.
    if all.len() > 9 {
        return Err(DbError::InvalidData(
            "DM supports at most 9 participants".to_string(),
        ));
    }

    let hash = compute_participant_hash(&all);

    // Check for existing DM first (fast path, no transaction).
    if let Some(existing) = find_dm_by_participants(pool, community_id, &hash).await? {
        // Clear hidden_at for the caller so the DM reappears in their sidebar.
        unhide_dm(pool, community_id, existing.id, created_by).await?;
        return Ok((existing, false));
    }

    // Create new DM.
    let channel = create_dm(pool, community_id, &all, created_by).await?;

    Ok((channel, true))
}

// -- Hide / unhide ------------------------------------------------------------

/// Hide a DM for a specific user by setting `hidden_at = NOW()`.
///
/// The DM is not deleted — it can be restored by opening a new DM with the
/// same participants (which clears `hidden_at`). Returns an error if the user
/// is not an active member of the channel.
pub async fn hide_dm(
    pool: &PgPool,
    community_id: CommunityId,
    channel_id: Uuid,
    pubkey: &[u8],
) -> Result<()> {
    let result = sqlx::query(
        r#"
        UPDATE channel_members
        SET hidden_at = NOW()
        WHERE community_id = $1 AND channel_id = $2 AND pubkey = $3 AND removed_at IS NULL
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(channel_id)
    .bind(pubkey)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(DbError::NotFound(format!(
            "no active membership for channel {channel_id}"
        )));
    }

    Ok(())
}

/// Unhide a DM for a specific user by clearing `hidden_at`.
///
/// This is called automatically when a user re-opens a DM via [`open_dm`].
/// It is a no-op if the membership is not currently hidden.
pub async fn unhide_dm(
    pool: &PgPool,
    community_id: CommunityId,
    channel_id: Uuid,
    pubkey: &[u8],
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE channel_members
        SET hidden_at = NULL
        WHERE community_id = $1 AND channel_id = $2 AND pubkey = $3 AND removed_at IS NULL
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(channel_id)
    .bind(pubkey)
    .execute(pool)
    .await?;

    Ok(())
}

/// Return the channel IDs of all DMs the given user currently has hidden
/// (`hidden_at IS NOT NULL`) while still being an active member. Used to build
/// the relay-signed NIP-DV visibility snapshot.
pub async fn list_hidden_dms(
    pool: &PgPool,
    community_id: CommunityId,
    pubkey: &[u8],
) -> Result<Vec<Uuid>> {
    let rows = sqlx::query(
        r#"
        SELECT cm.channel_id
        FROM channel_members cm
        JOIN channels c
          ON c.community_id = cm.community_id
         AND c.id = cm.channel_id
        WHERE cm.community_id = $1
          AND cm.pubkey = $2
          AND cm.removed_at IS NULL
          AND cm.hidden_at IS NOT NULL
          AND c.channel_type = 'dm'
          AND c.deleted_at IS NULL
        ORDER BY cm.channel_id
        "#,
    )
    .bind(community_id.as_uuid())
    .bind(pubkey)
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|r| r.try_get::<Uuid, _>("channel_id").map_err(Into::into))
        .collect()
}

// -- Row mapping --------------------------------------------------------------

fn row_to_channel_record(row: sqlx::postgres::PgRow) -> Result<ChannelRecord> {
    let id: Uuid = row.try_get("id")?;
    let topic_required: bool = row.try_get("topic_required")?;

    Ok(ChannelRecord {
        id,
        name: row.try_get("name")?,
        channel_type: row.try_get("channel_type")?,
        visibility: row.try_get("visibility")?,
        description: row.try_get("description")?,
        canvas: row.try_get("canvas")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        archived_at: row.try_get("archived_at")?,
        deleted_at: row.try_get("deleted_at")?,
        nip29_group_id: row.try_get("nip29_group_id")?,
        topic_required,
        max_members: row.try_get("max_members")?,
        topic: row.try_get("topic").unwrap_or(None),
        topic_set_by: row.try_get("topic_set_by").unwrap_or(None),
        topic_set_at: row.try_get("topic_set_at").unwrap_or(None),
        purpose: row.try_get("purpose").unwrap_or(None),
        purpose_set_by: row.try_get("purpose_set_by").unwrap_or(None),
        purpose_set_at: row.try_get("purpose_set_at").unwrap_or(None),
        ttl_seconds: row.try_get("ttl_seconds").unwrap_or(None),
        ttl_deadline: row.try_get("ttl_deadline").unwrap_or(None),
    })
}

// -- Db API -------------------------------------------------------------------

impl Db {
    /// Find an existing DM by its participant hash.
    #[datastore_span(name = "find_dm_by_participants", system = "postgresql")]
    pub async fn find_dm_by_participants(
        &self,
        community_id: CommunityId,
        participant_hash: &[u8],
    ) -> Result<Option<ChannelRecord>> {
        crate::dm::find_dm_by_participants(&self.pool, community_id, participant_hash).await
    }

    /// Create or return an existing DM channel.
    #[datastore_span(name = "create_dm", system = "postgresql")]
    pub async fn create_dm(
        &self,
        community_id: CommunityId,
        participants: &[&[u8]],
        created_by: &[u8],
    ) -> Result<ChannelRecord> {
        crate::dm::create_dm(&self.pool, community_id, participants, created_by).await
    }

    /// List all DMs for a user.
    #[datastore_span(name = "list_dms_for_user", system = "postgresql")]
    pub async fn list_dms_for_user(
        &self,
        community_id: CommunityId,
        pubkey: &[u8],
        limit: u32,
        cursor: Option<Uuid>,
    ) -> Result<Vec<DmRecord>> {
        crate::dm::list_dms_for_user(&self.pool, community_id, pubkey, limit, cursor).await
    }

    /// Open or retrieve a DM for the given participants.
    #[datastore_span(name = "open_dm", system = "postgresql")]
    pub async fn open_dm(
        &self,
        community_id: CommunityId,
        pubkeys: &[&[u8]],
        created_by: &[u8],
    ) -> Result<(ChannelRecord, bool)> {
        crate::dm::open_dm(&self.pool, community_id, pubkeys, created_by).await
    }

    /// Hide a DM channel for a specific user.
    ///
    /// The DM is not deleted — it can be restored by opening a new DM with
    /// the same participants.
    #[datastore_span(name = "hide_dm", system = "postgresql")]
    pub async fn hide_dm(
        &self,
        community_id: CommunityId,
        channel_id: Uuid,
        pubkey: &[u8],
    ) -> Result<()> {
        crate::dm::hide_dm(&self.pool, community_id, channel_id, pubkey).await
    }

    /// Unhide a DM channel for a specific user.
    #[datastore_span(name = "unhide_dm", system = "postgresql")]
    pub async fn unhide_dm(
        &self,
        community_id: CommunityId,
        channel_id: Uuid,
        pubkey: &[u8],
    ) -> Result<()> {
        crate::dm::unhide_dm(&self.pool, community_id, channel_id, pubkey).await
    }

    /// List the channel IDs of all DMs the given user currently has hidden.
    #[datastore_span(name = "list_hidden_dms", system = "postgresql")]
    pub async fn list_hidden_dms(
        &self,
        community_id: CommunityId,
        pubkey: &[u8],
    ) -> Result<Vec<Uuid>> {
        crate::dm::list_hidden_dms(&self.pool, community_id, pubkey).await
    }
}

// -- Tests --------------------------------------------------------------------

#[cfg(test)]
mod postgres_tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn governed_dm_keeps_control_out_and_converges_rotated_keys() {
        let pool = PgPool::connect(&crate::test_support::database_url())
            .await
            .unwrap();
        let db = Db::from_pool(pool.clone());
        let host = format!("dm-{}.invalid", Uuid::new_v4());
        let community = db.ensure_configured_community(&host).await.unwrap().id;
        let control = nostr::Keys::generate().public_key().to_bytes().to_vec();
        let first = nostr::Keys::generate().public_key().to_bytes().to_vec();
        let second = nostr::Keys::generate().public_key().to_bytes().to_vec();
        let rotated = nostr::Keys::generate().public_key().to_bytes().to_vec();
        let mut principals = vec![Uuid::new_v4(), Uuid::new_v4()];
        principals.sort_unstable();
        let mut tx = pool.begin().await.unwrap();
        for (key, role) in [
            (&control, "owner"),
            (&first, "member"),
            (&second, "member"),
            (&rotated, "member"),
        ] {
            sqlx::query("insert into relay_members(community_id,pubkey,role) values($1,$2,$3)")
                .bind(community.as_uuid())
                .bind(hex::encode(key))
                .bind(role)
                .execute(&mut *tx)
                .await
                .unwrap();
        }
        let mut projection = GovernedDmProjection {
            channel_id: Uuid::new_v4(),
            principals: principals.clone(),
            generation: 1,
            keys: vec![
                (principals[0], first.clone()),
                (principals[1], second.clone()),
            ],
            created_by: first.clone(),
        };
        project_governed_dm(&mut tx, community, &control, &projection)
            .await
            .unwrap();
        assert!(project_governed_dm(&mut tx, community, &first, &projection)
            .await
            .is_err());
        let active = |channel| {
            sqlx::query_scalar::<_,Vec<u8>>("select pubkey from channel_members where community_id=$1 and channel_id=$2 and removed_at is null order by pubkey").bind(community.as_uuid()).bind(channel)
        };
        let keys = active(projection.channel_id)
            .fetch_all(&mut *tx)
            .await
            .unwrap();
        assert_eq!(keys.len(), 2);
        assert!(!keys.contains(&control));
        projection.generation += 1;
        projection.keys = vec![
            (principals[0], rotated.clone()),
            (principals[1], second.clone()),
        ];
        project_governed_dm(&mut tx, community, &control, &projection)
            .await
            .unwrap();
        project_governed_dm(&mut tx, community, &control, &projection)
            .await
            .unwrap();
        let keys = active(projection.channel_id)
            .fetch_all(&mut *tx)
            .await
            .unwrap();
        assert!(!keys.contains(&first));
        assert!(keys.contains(&rotated));
        assert!(keys.contains(&second));
        projection.generation -= 1;
        assert!(
            project_governed_dm(&mut tx, community, &control, &projection)
                .await
                .is_err()
        );
        projection.generation += 1;
        projection.keys[0].1 = control.clone();
        assert!(
            project_governed_dm(&mut tx, community, &control, &projection)
                .await
                .is_err()
        );
        tx.rollback().await.unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn participant_hash_is_order_independent() {
        let a = [1u8; 32];
        let b = [2u8; 32];
        let h1 = compute_participant_hash(&[&a, &b]);
        let h2 = compute_participant_hash(&[&b, &a]);
        assert_eq!(h1, h2, "hash must be the same regardless of input order");
    }

    #[test]
    fn participant_hash_deduplicates() {
        let a = [1u8; 32];
        let h1 = compute_participant_hash(&[&a, &a]);
        let h2 = compute_participant_hash(&[&a]);
        assert_eq!(h1, h2, "duplicate pubkeys should be deduped before hashing");
    }

    #[test]
    fn participant_hash_differs_for_different_sets() {
        let a = [1u8; 32];
        let b = [2u8; 32];
        let c = [3u8; 32];
        let h_ab = compute_participant_hash(&[&a, &b]);
        let h_ac = compute_participant_hash(&[&a, &c]);
        assert_ne!(h_ab, h_ac);
    }

    #[test]
    fn participant_hash_returns_32_bytes() {
        let a = [0u8; 32];
        let b = [255u8; 32];
        let h = compute_participant_hash(&[&a, &b]);
        assert_eq!(h.len(), 32);
    }
}
