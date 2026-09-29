//! Native relay session for finite backend reads.
//!
//! Owns an authenticated relay socket over which backend commands (unread
//! catch-up today) multiplex bounded REQ/EOSE reads, so a batch of per-channel
//! requests shares one NIP-42 handshake instead of opening a socket each.
//!
//! Built on `buzz-ws-client`, which owns the wire format and the NIP-42
//! handshake. That crate is request/response shaped (one caller, `next_event`
//! off a buffer); the session lifecycle lives here instead of being pushed down
//! into it, because `buzz-cli` and `buzz-test-client` consume that crate and do
//! not want subscription bookkeeping.

use std::{collections::HashMap, sync::Arc, time::Duration};

use buzz_ws_client_pkg::{NostrWsConnection, RelayMessage};
use nostr::{Event, Keys};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_util::sync::CancellationToken;

/// Backoff floor for reconnect attempts.
const RECONNECT_BASE_DELAY: Duration = Duration::from_millis(500);
/// Backoff ceiling. Matches the renderer session's ceiling so a relay outage
/// produces one retry cadence across the app rather than two competing ones.
const RECONNECT_MAX_DELAY: Duration = Duration::from_secs(30);
/// How long a read may block before the loop re-checks cancellation. Not a
/// connection timeout: an idle relay is normal, so a lapsed read just loops.
const READ_TIMEOUT: Duration = Duration::from_secs(30);

/// An in-flight finite read: a filter under a fresh relay subscription id.
#[derive(Clone)]
struct Subscription {
    id: String,
    filter: serde_json::Value,
}

/// A session owned by one command invocation. Dropping the lease shuts the
/// socket down, so the connection can never outlive the request that opened
/// it.
pub(crate) struct SessionLease {
    session: Arc<RelaySession>,
}

impl std::ops::Deref for SessionLease {
    type Target = RelaySession;

    fn deref(&self) -> &Self::Target {
        &self.session
    }
}

impl SessionLease {
    /// Clones the underlying handle for a task that outlives this binding, as
    /// the catch-up fan-out does. Only the lease cancels the session, so the
    /// clone must not outlive it.
    pub(crate) fn handle(&self) -> Arc<RelaySession> {
        Arc::clone(&self.session)
    }
}

impl Drop for SessionLease {
    fn drop(&mut self) {
        self.session.shutdown();
    }
}

/// Opens a session against `relay_url` authenticated as `keys`. The session
/// reconnects with exponential backoff and re-sends every still-pending read,
/// so a socket drop mid-request does not fail the request.
pub(crate) fn open_session(relay_url: String, keys: Keys) -> SessionLease {
    let (wake, wake_rx) = mpsc::channel(1);
    let session = Arc::new(RelaySession {
        pending_reads: Arc::new(Mutex::new(Vec::new())),
        requests: Arc::new(Mutex::new(HashMap::new())),
        wake,
        cancel: CancellationToken::new(),
    });

    tauri::async_runtime::spawn(run_session(relay_url, keys, Arc::clone(&session), wake_rx));

    SessionLease { session }
}

pub(crate) struct RelaySession {
    pending_reads: Arc<Mutex<Vec<Subscription>>>,
    requests: Arc<Mutex<HashMap<String, PendingRequest>>>,
    wake: mpsc::Sender<()>,
    cancel: CancellationToken,
}

struct PendingRequest {
    events: Vec<Event>,
    complete: oneshot::Sender<Result<Vec<Event>, String>>,
}

impl RelaySession {
    /// Fetches one finite page over this session. Request ids are fresh, so a
    /// CLOSED for one page can never leak into another.
    pub(crate) async fn fetch_events(
        &self,
        filter: serde_json::Value,
        timeout: Duration,
    ) -> Result<Vec<Event>, String> {
        let id = format!("native-fetch-{}", uuid::Uuid::new_v4());
        let (complete, result) = oneshot::channel();
        self.requests.lock().await.insert(
            id.clone(),
            PendingRequest {
                events: Vec::new(),
                complete,
            },
        );
        self.pending_reads.lock().await.push(Subscription {
            id: id.clone(),
            filter,
        });
        let _ = self.wake.try_send(());

        let outcome = tokio::select! {
            _ = self.cancel.cancelled() => Err("relay session cancelled".to_string()),
            value = tokio::time::timeout(timeout, result) => match value {
                Ok(Ok(value)) => value,
                Ok(Err(_)) => Err("relay request ended before EOSE".to_string()),
                Err(_) => Err("relay request timed out".to_string()),
            }
        };
        self.requests.lock().await.remove(&id);
        self.retire(&id).await;
        outcome
    }

    /// Drops `id` from the pending reads and wakes the loop so it CLOSEs the
    /// relay subscription if it is still open.
    async fn retire(&self, id: &str) {
        self.pending_reads
            .lock()
            .await
            .retain(|subscription| subscription.id != id);
        // A full channel already means "reconcile pending", so a failed send
        // is success: the loop has not yet consumed the previous wake.
        let _ = self.wake.try_send(());
    }

    fn shutdown(&self) {
        self.cancel.cancel();
    }
}

async fn run_session(
    relay_url: String,
    keys: Keys,
    session: Arc<RelaySession>,
    mut wake_rx: mpsc::Receiver<()>,
) {
    let mut delay = RECONNECT_BASE_DELAY;
    loop {
        if session.cancel.is_cancelled() {
            return;
        }

        match NostrWsConnection::connect_authenticated(&relay_url, &keys, None).await {
            Ok(conn) => {
                // A connection that authenticated is healthy regardless of how
                // long it then lived, so backoff resets here rather than on
                // clean exit — a socket that drops after one event must not
                // inherit the previous failure's delay.
                delay = RECONNECT_BASE_DELAY;
                run_connection(conn, &session, &mut wake_rx).await;
            }
            Err(error) => {
                eprintln!("buzz-desktop: native_relay_client: connect failed: {error}");
            }
        }

        if session.cancel.is_cancelled() {
            return;
        }
        tokio::select! {
            _ = session.cancel.cancelled() => return,
            _ = tokio::time::sleep(delay) => {}
        }
        delay = (delay * 2).min(RECONNECT_MAX_DELAY);
    }
}

/// Drives one connected socket until it drops or the session is cancelled.
async fn run_connection(
    mut conn: NostrWsConnection,
    session: &RelaySession,
    wake_rx: &mut mpsc::Receiver<()>,
) {
    // Subscription ids currently open ON THIS SOCKET. Deliberately local: a new
    // socket has none, so reconnect re-sends every pending read without any
    // explicit "resubscribe" path that could drift from the normal one.
    let mut open: HashMap<String, serde_json::Value> = HashMap::new();

    if !reconcile(&mut conn, session, &mut open).await {
        return;
    }

    loop {
        tokio::select! {
            _ = session.cancel.cancelled() => {
                let _ = conn.disconnect().await;
                return;
            }
            Some(()) = wake_rx.recv() => {
                if !reconcile(&mut conn, session, &mut open).await {
                    return;
                }
            }
            message = conn.next_event(READ_TIMEOUT) => {
                match message {
                    Ok(RelayMessage::Event { subscription_id, event }) => {
                        // A CLOSE races in flight with events already queued at
                        // the relay, so drop events for ids no longer open.
                        if !open.contains_key(&subscription_id) {
                            continue;
                        }
                        // Reject forged events before retaining them, bounding
                        // memory at the transport seam.
                        if event.verify().is_err() {
                            continue;
                        }
                        if let Some(request) = session
                            .requests
                            .lock()
                            .await
                            .get_mut(&subscription_id)
                        {
                            request.events.push(*event);
                        }
                    }
                    Ok(RelayMessage::Closed { subscription_id, message }) => {
                        // A CLOSED for a subscription this socket is not
                        // running is stale — our own CLOSE raced it.
                        if open.remove(&subscription_id).is_none() {
                            continue;
                        }
                        if let Some(request) = session.requests.lock().await.remove(&subscription_id) {
                            let _ = request.complete.send(Err(format!("relay closed request: {message}")));
                        }
                        session.retire(&subscription_id).await;
                    }
                    Ok(RelayMessage::Eose { subscription_id }) => {
                        if let Some(request) = session.requests.lock().await.remove(&subscription_id) {
                            let _ = request.complete.send(Ok(request.events));
                            session.retire(&subscription_id).await;
                        }
                    }
                    Ok(_) => {}
                    Err(error) => {
                        if !is_read_timeout(&error) {
                            eprintln!("buzz-desktop: native_relay_client: read failed: {error}");
                            return;
                        }
                    }
                }
            }
        }
    }
}

/// Brings the socket's open subscriptions in line with the pending reads.
///
/// Returns false when the socket failed and the caller should reconnect.
async fn reconcile(
    conn: &mut NostrWsConnection,
    session: &RelaySession,
    open: &mut HashMap<String, serde_json::Value>,
) -> bool {
    let desired = session.pending_reads.lock().await.clone();

    for id in open.keys().cloned().collect::<Vec<_>>() {
        if desired.iter().any(|s| s.id == id) {
            continue;
        }
        if conn
            .send_raw(&serde_json::json!(["CLOSE", id]))
            .await
            .is_err()
        {
            return false;
        }
        open.remove(&id);
    }

    for sub in desired {
        if open.contains_key(&sub.id) {
            continue;
        }
        if conn
            .send_raw(&serde_json::json!(["REQ", sub.id, sub.filter]))
            .await
            .is_err()
        {
            return false;
        }
        open.insert(sub.id, sub.filter);
    }

    true
}

/// A lapsed read is an idle relay, not a failure. Distinguished by variant
/// rather than by message text so a reworded error cannot turn every idle
/// period into a reconnect storm.
fn is_read_timeout(error: &buzz_ws_client_pkg::WsClientError) -> bool {
    matches!(error, buzz_ws_client_pkg::WsClientError::Timeout)
}

#[cfg(test)]
#[path = "native_relay_client_tests.rs"]
mod tests;
