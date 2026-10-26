//! DD-159 local archive store: one SQLite file per local identity, every event
//! sealed with that identity's archive key (NIP-44 v2, authenticated). Only the
//! channel ID, event ID and timestamp stay in clear for ordering and cleanup.
//!
//! Original: `buzz/desktop/src-tauri/src/archive/store.rs` (per-identity SQLite in
//! the nest). Kailo keeps the channel scope only and encrypts at rest.

use nostr::nips::nip44;
use nostr::{Event, JsonUtil, Keys};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

/// NIP-44 v2 bounds one plaintext at 65535 bytes; larger events are sealed in
/// numbered chunks whose index is inside the authenticated plaintext.
const SEAL_CHUNK: usize = 60_000;

/// Message kinds the settings card may subscribe (DD-159(1)).
pub(crate) const ARCHIVABLE_KINDS: [u16; 9] = [9, 40002, 40003, 7, 5, 9005, 45001, 45003, 40099];
const DELETION_KINDS: [u16; 2] = [5, 9005];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Subscription {
    pub channel_id: String,
    pub kinds: Vec<u16>,
    pub created_at: i64,
    pub last_sync_at: Option<i64>,
    /// `never` | `ok` | `retry` (transient failure) — access loss deletes the row.
    pub last_result: String,
    pub cursor: i64,
    pub event_count: i64,
}

pub(crate) struct ArchiveStore {
    conn: Connection,
    key: Keys,
}

impl ArchiveStore {
    pub(crate) fn open(conn: Connection, key: Keys) -> Result<Self, String> {
        conn.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS subscription(
               channel_id TEXT PRIMARY KEY,
               kinds TEXT NOT NULL,
               created_at INTEGER NOT NULL,
               last_sync_at INTEGER,
               last_result TEXT NOT NULL DEFAULT 'never',
               cursor INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE IF NOT EXISTS archived_event(
               event_id TEXT PRIMARY KEY,
               channel_id TEXT NOT NULL,
               created_at INTEGER NOT NULL,
               sealed TEXT NOT NULL);
             CREATE INDEX IF NOT EXISTS archived_event_channel ON archived_event(channel_id, created_at);",
        )
        .map_err(|e| format!("local archive schema: {e}"))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS deleted_event(
               event_id TEXT NOT NULL, channel_id TEXT NOT NULL,
               PRIMARY KEY(event_id,channel_id));
             CREATE TABLE IF NOT EXISTS sync_page(
               channel_id TEXT PRIMARY KEY, until_time INTEGER NOT NULL,
               before_id TEXT NOT NULL, newest_time INTEGER NOT NULL);",
        )
        .map_err(|e| format!("local archive sync schema: {e}"))?;
        Ok(Self { conn, key })
    }

    pub(crate) fn subscribe(
        &self,
        channel_id: &str,
        kinds: &[u16],
        now: i64,
    ) -> Result<(), String> {
        let kinds = normalized_kinds(kinds)?;
        self.conn
            .execute(
                "INSERT INTO subscription(channel_id,kinds,created_at) VALUES(?1,?2,?3)
                 ON CONFLICT(channel_id) DO UPDATE SET kinds=excluded.kinds",
                params![channel_id, kinds_text(&kinds), now],
            )
            .map(|_| ())
            .map_err(|e| format!("local archive subscribe: {e}"))
    }

    /// Removes the subscription and every archived copy of that channel.
    pub(crate) fn unsubscribe(&self, channel_id: &str) -> Result<(), String> {
        self.conn
            .execute(
                "DELETE FROM deleted_event WHERE channel_id=?1",
                params![channel_id],
            )
            .and_then(|_| {
                self.conn.execute(
                    "DELETE FROM sync_page WHERE channel_id=?1",
                    params![channel_id],
                )
            })
            .map_err(|e| format!("local archive unsubscribe: {e}"))?;
        self.conn
            .execute(
                "DELETE FROM archived_event WHERE channel_id=?1",
                params![channel_id],
            )
            .and_then(|_| {
                self.conn.execute(
                    "DELETE FROM subscription WHERE channel_id=?1",
                    params![channel_id],
                )
            })
            .map(|_| ())
            .map_err(|e| format!("local archive unsubscribe: {e}"))
    }

    pub(crate) fn subscriptions(&self) -> Result<Vec<Subscription>, String> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT s.channel_id,s.kinds,s.created_at,s.last_sync_at,s.last_result,s.cursor,
                        (SELECT count(*) FROM archived_event e WHERE e.channel_id=s.channel_id)
                 FROM subscription s ORDER BY s.created_at, s.channel_id",
            )
            .map_err(|e| format!("local archive list: {e}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok(Subscription {
                    channel_id: row.get(0)?,
                    kinds: parse_kinds(&row.get::<_, String>(1)?),
                    created_at: row.get(2)?,
                    last_sync_at: row.get(3)?,
                    last_result: row.get(4)?,
                    cursor: row.get(5)?,
                    event_count: row.get(6)?,
                })
            })
            .map_err(|e| format!("local archive list: {e}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("local archive list: {e}"))
    }

    pub(crate) fn subscription(&self, channel_id: &str) -> Result<Option<Subscription>, String> {
        Ok(self
            .subscriptions()?
            .into_iter()
            .find(|s| s.channel_id == channel_id))
    }

    /// Stores relay-returned events of `channel_id`, sealed. Deletions (5/9005)
    /// remove the archived copies of the events they target. An explicit `h`
    /// must match. For kind 5/7 without `h`, the authenticated single-channel
    /// Relay query supplies the channel, just as buzz-core's filter uses the
    /// persisted target-derived channel_id for these events.
    pub(crate) fn ingest(&self, channel_id: &str, events: &[Event]) -> Result<usize, String> {
        let mut stored = 0;
        for event in events {
            let has_channel = event
                .tags
                .iter()
                .any(|tag| tag.as_slice().first().is_some_and(|s| s == "h"));
            let in_channel = event.tags.iter().any(|tag| {
                let s = tag.as_slice();
                s.len() >= 2 && s[0] == "h" && s[1] == channel_id
            }) || (!has_channel && matches!(event.kind.as_u16(), 5 | 7));
            if !in_channel
                || !ARCHIVABLE_KINDS.contains(&event.kind.as_u16())
                || event.verify().is_err()
            {
                continue;
            }
            if DELETION_KINDS.contains(&event.kind.as_u16()) {
                for tag in event.tags.iter() {
                    let s = tag.as_slice();
                    if s.len() >= 2 && s[0] == "e" {
                        self.conn.execute(
                            "INSERT OR IGNORE INTO deleted_event(event_id,channel_id) VALUES(?1,?2)",
                            params![s[1], channel_id],
                        ).map_err(|e| format!("local archive tombstone: {e}"))?;
                        self.conn
                            .execute(
                                "DELETE FROM archived_event WHERE event_id=?1 AND channel_id=?2",
                                params![s[1], channel_id],
                            )
                            .map_err(|e| format!("local archive delete: {e}"))?;
                    }
                }
            }
            let sealed = self.seal(&event.as_json())?;
            stored += self
                .conn
                .execute(
                    "INSERT OR IGNORE INTO archived_event(event_id,channel_id,created_at,sealed)
                     SELECT ?1,?2,?3,?4 WHERE NOT EXISTS
                     (SELECT 1 FROM deleted_event WHERE event_id=?1 AND channel_id=?2)",
                    params![
                        event.id.to_hex(),
                        channel_id,
                        event.created_at.as_secs() as i64,
                        sealed
                    ],
                )
                .map_err(|e| format!("local archive insert: {e}"))?;
        }
        Ok(stored)
    }

    pub(crate) fn page_cursor(
        &self,
        channel_id: &str,
    ) -> Result<Option<(i64, String, i64)>, String> {
        self.conn
            .query_row(
                "SELECT until_time,before_id,newest_time FROM sync_page WHERE channel_id=?1",
                params![channel_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|e| format!("local archive page: {e}"))
    }

    pub(crate) fn save_page(
        &self,
        channel_id: &str,
        until: i64,
        before_id: &str,
        newest: i64,
    ) -> Result<(), String> {
        self.conn.execute(
            "INSERT INTO sync_page(channel_id,until_time,before_id,newest_time) VALUES(?1,?2,?3,?4)
             ON CONFLICT(channel_id) DO UPDATE SET until_time=?2,before_id=?3,newest_time=?4",
            params![channel_id, until, before_id, newest],
        ).map(|_| ()).map_err(|e| format!("local archive page: {e}"))
    }

    pub(crate) fn finish_pages(
        &self,
        channel_id: &str,
        cursor: i64,
        at: i64,
    ) -> Result<(), String> {
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        self.record_sync(channel_id, "ok", Some(cursor), at)?;
        tx.execute(
            "DELETE FROM sync_page WHERE channel_id=?1",
            params![channel_id],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub(crate) fn record_sync(
        &self,
        channel_id: &str,
        result: &str,
        cursor: Option<i64>,
        now: i64,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE subscription SET last_sync_at=?2,last_result=?3,cursor=max(cursor,coalesce(?4,cursor)) WHERE channel_id=?1",
                params![channel_id, now, result, cursor],
            )
            .map(|_| ())
            .map_err(|e| format!("local archive record: {e}"))
    }

    /// Opens archived events of a channel, newest first.
    pub(crate) fn read(&self, channel_id: &str, limit: u32) -> Result<Vec<Event>, String> {
        let mut statement = self
            .conn
            .prepare("SELECT sealed FROM archived_event WHERE channel_id=?1 ORDER BY created_at DESC, event_id LIMIT ?2")
            .map_err(|e| format!("local archive read: {e}"))?;
        let sealed = statement
            .query_map(params![channel_id, limit], |row| row.get::<_, String>(0))
            .map_err(|e| format!("local archive read: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("local archive read: {e}"))?;
        sealed
            .iter()
            .map(|value| {
                self.open_sealed(value).and_then(|json| {
                    let event =
                        Event::from_json(json).map_err(|_| "archived event corrupt".to_string())?;
                    // Chunk authentication also needs the signed whole-event
                    // binding: valid chunks from two events must not splice.
                    event
                        .verify()
                        .map_err(|_| "archived event corrupt".to_string())?;
                    Ok(event)
                })
            })
            .collect()
    }

    #[cfg(test)]
    pub(crate) fn has_event(&self, event_id: &str) -> Result<bool, String> {
        self.conn
            .query_row(
                "SELECT 1 FROM archived_event WHERE event_id=?1",
                params![event_id],
                |_| Ok(()),
            )
            .optional()
            .map(|found| found.is_some())
            .map_err(|e| format!("local archive lookup: {e}"))
    }

    fn seal(&self, plaintext: &str) -> Result<String, String> {
        let chunks: Vec<&str> = split_utf8(plaintext, SEAL_CHUNK);
        let total = chunks.len();
        chunks
            .iter()
            .enumerate()
            .map(|(index, chunk)| {
                nip44::encrypt(
                    self.key.secret_key(),
                    &self.key.public_key(),
                    format!("{index}/{total}:{chunk}"),
                    nip44::Version::V2,
                )
                .map_err(|_| "local archive seal failed".to_string())
            })
            .collect::<Result<Vec<_>, _>>()
            .map(|parts| parts.join("."))
    }

    fn open_sealed(&self, sealed: &str) -> Result<String, String> {
        let parts: Vec<&str> = sealed.split('.').collect();
        let total = parts.len();
        let mut out = String::new();
        for (index, part) in parts.iter().enumerate() {
            let plain = nip44::decrypt(self.key.secret_key(), &self.key.public_key(), part)
                .map_err(|_| "local archive open failed".to_string())?;
            let prefix = format!("{index}/{total}:");
            let body = plain
                .strip_prefix(&prefix)
                .ok_or("local archive chunk out of order")?;
            out.push_str(body);
        }
        Ok(out)
    }
}

fn split_utf8(text: &str, max: usize) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = text;
    while rest.len() > max {
        let mut cut = max;
        while !rest.is_char_boundary(cut) {
            cut -= 1;
        }
        let (head, tail) = rest.split_at(cut);
        out.push(head);
        rest = tail;
    }
    out.push(rest);
    out
}

fn normalized_kinds(kinds: &[u16]) -> Result<Vec<u16>, String> {
    let mut out: Vec<u16> = kinds.to_vec();
    out.sort_unstable();
    out.dedup();
    if out.is_empty() || out.iter().any(|kind| !ARCHIVABLE_KINDS.contains(kind)) {
        return Err("local archive kinds outside the archivable set".into());
    }
    Ok(out)
}

fn kinds_text(kinds: &[u16]) -> String {
    kinds
        .iter()
        .map(u16::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

fn parse_kinds(text: &str) -> Vec<u16> {
    text.split(',')
        .filter_map(|value| value.parse().ok())
        .collect()
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;
