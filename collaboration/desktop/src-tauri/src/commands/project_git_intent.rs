//! DD-118(6)/DD-160: native dispatch receipts, not repository content authority.
//! SQLite FULL commits the frozen ref update and append-only evidence before I/O.
use nostr::{Event, JsonUtil};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

use super::project_git_write::{Request, WriteError, FAILED, UNKNOWN};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct Intent {
    pub key: String,
    pub request: Request,
    pub old: Option<String>,
    pub new: Option<String>,
    pub author: Option<(String, String, i64)>,
    pub result: String,
    pub event: Option<String>,
    pub event_result: Option<String>,
    /// Frozen from the admitted Relay before the first publication side effect.
    #[serde(default)]
    pub event_community_id: Option<String>,
}

pub(super) struct Journal(Connection);
impl Journal {
    pub fn open(path: &Path) -> Result<Self, WriteError> {
        let conn = Connection::open(path).map_err(|_| WriteError::new(FAILED))?;
        conn.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS intent(key TEXT PRIMARY KEY, repository TEXT NOT NULL,
                ref TEXT NOT NULL, payload TEXT NOT NULL, pending INTEGER NOT NULL);
            CREATE UNIQUE INDEX IF NOT EXISTS one_pending ON intent(repository,ref) WHERE pending=1;
            CREATE TABLE IF NOT EXISTS evidence(seq INTEGER PRIMARY KEY, key TEXT NOT NULL,
                phase TEXT NOT NULL, outcome TEXT NOT NULL, at INTEGER NOT NULL DEFAULT(unixepoch()));
            CREATE TABLE IF NOT EXISTS publication_evidence(seq INTEGER PRIMARY KEY, key TEXT NOT NULL,
                event TEXT NOT NULL, phase TEXT NOT NULL, outcome TEXT NOT NULL, at INTEGER NOT NULL DEFAULT(unixepoch()));")
            .map_err(|_| WriteError::new(FAILED))?;
        Ok(Self(conn))
    }
    pub fn find(&self, key: &str, request: &Request) -> Result<Option<Intent>, WriteError> {
        let raw: Option<String> = self
            .0
            .query_row("SELECT payload FROM intent WHERE key=?1", [key], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|_| WriteError::new(FAILED))?;
        if let Some(raw) = raw {
            let intent: Intent = serde_json::from_str(&raw).map_err(|_| WriteError::new(FAILED))?;
            if intent.request != *request {
                return Err(WriteError::new("IDEMPOTENCY_KEY_REUSED"));
            }
            return Ok(Some(intent));
        }
        let raw: Option<String> = self
            .0
            .query_row(
                "SELECT payload FROM intent WHERE repository=?1 AND ref=?2 AND pending=1",
                params![request.repository, request.branch],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| WriteError::new(FAILED))?;
        if let Some(raw) = raw {
            let intent: Intent = serde_json::from_str(&raw).map_err(|_| WriteError::new(FAILED))?;
            // A restarted webview cannot replace an outstanding native intent.
            if intent.request != *request {
                return Err(WriteError::at(UNKNOWN, &intent.key));
            }
            return Ok(Some(intent));
        }
        Ok(None)
    }
    pub fn save(&self, intent: &Intent, phase: &str) -> Result<(), WriteError> {
        let payload =
            serde_json::to_string(intent).map_err(|_| WriteError::at(UNKNOWN, &intent.key))?;
        let pending = intent.result == "DISPATCHED"
            || intent.result == "NOT_DELIVERED"
            || intent.result == "ACCEPTED"
                && intent.request.operation == "MERGE"
                && !matches!(
                    intent.event_result.as_deref(),
                    Some("ACCEPTED" | "REJECTED")
                );
        let tx = self
            .0
            .unchecked_transaction()
            .map_err(|_| WriteError::at(UNKNOWN, &intent.key))?;
        let previous: Option<String> = tx
            .query_row(
                "SELECT payload FROM intent WHERE key=?1",
                [&intent.key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| WriteError::at(UNKNOWN, &intent.key))?;
        if let Some(previous) = previous {
            let frozen: Intent = serde_json::from_str(&previous)
                .map_err(|_| WriteError::at(UNKNOWN, &intent.key))?;
            // Persisted identities are immutable even if a caller races or
            // accidentally presents a stale in-memory copy to the journal.
            if frozen.request != intent.request
                || frozen.old != intent.old
                || frozen.new != intent.new
                || frozen.author != intent.author
            {
                return Err(WriteError::at("IDEMPOTENCY_KEY_REUSED", &intent.key));
            }
            if frozen.event_community_id.is_some() && frozen.event_community_id != intent.event_community_id {
                return Err(WriteError::at(UNKNOWN, &intent.key));
            }
            if frozen.event.is_some()
                && frozen.event != intent.event
                && !same_publication_retry(&frozen, intent, phase)
            {
                return Err(WriteError::at(UNKNOWN, &intent.key));
            }
            if frozen.result == "ACCEPTED" && intent.result != "ACCEPTED"
                || matches!(
                    frozen.event_result.as_deref(),
                    Some("ACCEPTED" | "REJECTED")
                ) && frozen.event_result != intent.event_result
            {
                return Err(WriteError::at(UNKNOWN, &intent.key));
            }
            // Older app versions persisted the signed attempt only in the
            // intent row. Preserve that exact evidence before a permitted retry
            // replaces it, even when this database predates publication_evidence.
            if let Some(event) = &frozen.event {
                tx.execute("INSERT INTO publication_evidence(key,event,phase,outcome) SELECT ?1,?2,'EVENT_PREVIOUS_ATTEMPT',?3 WHERE NOT EXISTS(SELECT 1 FROM publication_evidence WHERE key=?1 AND event=?2)",
                    params![intent.key,event,frozen.event_result.as_deref().unwrap_or("DISPATCHED")]).map_err(|_|WriteError::at(UNKNOWN,&intent.key))?;
            }
        }
        tx.execute("INSERT INTO intent VALUES(?1,?2,?3,?4,?5) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,pending=excluded.pending",
            params![intent.key,intent.request.repository,intent.request.branch,payload,pending]).map_err(|_|WriteError::at(UNKNOWN,&intent.key))?;
        let outcome = if phase.starts_with("EVENT_") {
            intent.event_result.as_deref().unwrap_or("DISPATCHED")
        } else {
            &intent.result
        };
        tx.execute(
            "INSERT INTO evidence(key,phase,outcome) VALUES(?1,?2,?3)",
            params![intent.key, phase, outcome],
        )
        .map_err(|_| WriteError::at(UNKNOWN, &intent.key))?;
        if phase.starts_with("EVENT_") {
            if let Some(event) = &intent.event {
                tx.execute(
                    "INSERT INTO publication_evidence(key,event,phase,outcome) VALUES(?1,?2,?3,?4)",
                    params![intent.key, event, phase, outcome],
                )
                .map_err(|_| WriteError::at(UNKNOWN, &intent.key))?;
            }
        }
        tx.commit()
            .map_err(|_| WriteError::at(UNKNOWN, &intent.key))
    }
}

// DD-81 permits a new signed attempt only after the previous attempt is
// definitely NOT_DELIVERED. Its business payload, signer and merge stay fixed.
fn same_publication_retry(old: &Intent, next: &Intent, phase: &str) -> bool {
    if old.event_result.as_deref() != Some("NOT_DELIVERED")
        || next.event_result.as_deref() != Some("DISPATCHED")
        || phase != "EVENT_DISPATCH"
    {
        return false;
    }
    let events = old
        .event
        .as_deref()
        .zip(next.event.as_deref())
        .and_then(|(a, b)| Event::from_json(a).ok().zip(Event::from_json(b).ok()));
    events.is_some_and(|(a, b)| {
        a.verify().is_ok()
            && b.verify().is_ok()
            && a.kind.as_u16() == 1631
            && b.kind == a.kind
            && b.pubkey == a.pubkey
            && b.content == a.content
            && b.tags == a.tags
            && b.created_at >= a.created_at
    })
}
