//! DD-118(6)/DD-160: native dispatch receipts, not repository content authority.
//! SQLite FULL commits the frozen ref update and append-only evidence before I/O.
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
                phase TEXT NOT NULL, outcome TEXT NOT NULL, at INTEGER NOT NULL DEFAULT(unixepoch()));")
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
        tx.commit()
            .map_err(|_| WriteError::at(UNKNOWN, &intent.key))
    }
}
