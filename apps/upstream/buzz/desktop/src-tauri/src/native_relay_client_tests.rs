//! Lifecycle tests for [`super`]'s finite-read relay session.

use super::*;
use futures_util::{SinkExt, StreamExt};
use nostr::EventBuilder;
use tokio_tungstenite::tungstenite::protocol::Message;

/// Minimal relay that completes the NIP-42 handshake, reports every REQ and
/// CLOSE in wire order, and emits EVENT/EOSE/CLOSED frames only when the test
/// asks it to.
///
/// A real socket rather than a fake `NostrWsConnection`, because the
/// properties under test (multiplexing, CLOSE-after-completion, teardown)
/// live in the lifecycle between frames. Same `accept_async` stub shape as
/// `native_websocket.rs`'s live-TCP tests.
async fn stub_relay() -> (String, mpsc::Receiver<Frame>, mpsc::Sender<StubCommand>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind stub relay");
    let address = listener.local_addr().expect("stub relay address");
    let (req_tx, req_rx) = mpsc::channel(16);
    let (closed_tx, mut closed_rx) = mpsc::channel::<StubCommand>(4);

    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.expect("accept");
        let mut socket = tokio_tungstenite::accept_async(stream)
            .await
            .expect("websocket handshake");

        socket
            .send(Message::Text(r#"["AUTH","stub-challenge"]"#.into()))
            .await
            .expect("send challenge");

        loop {
            tokio::select! {
                incoming = socket.next() => {
                    let Some(Ok(Message::Text(text))) = incoming else { return };
                    let Ok(frame) = serde_json::from_str::<serde_json::Value>(&text) else {
                        continue;
                    };
                    match frame[0].as_str() {
                        Some("AUTH") => {
                            let id = frame[1]["id"].as_str().unwrap_or_default();
                            socket
                                .send(Message::Text(
                                    serde_json::json!(["OK", id, true, ""]).to_string().into(),
                                ))
                                .await
                                .expect("send auth ok");
                        }
                        Some("REQ") => {
                            let id = frame[1].as_str().unwrap_or_default().to_string();
                            if req_tx.send(Frame::Req(id)).await.is_err() {
                                return;
                            }
                        }
                        Some("CLOSE") => {
                            let id = frame[1].as_str().unwrap_or_default().to_string();
                            if req_tx.send(Frame::Close(id)).await.is_err() {
                                return;
                            }
                        }
                        _ => {}
                    }
                }
                Some(command) = closed_rx.recv() => {
                    let frame = match command {
                        StubCommand::Closed(id, message) => {
                            serde_json::json!(["CLOSED", id, message])
                        }
                        StubCommand::Eose(id) => serde_json::json!(["EOSE", id]),
                        StubCommand::Event(id, event) => {
                            serde_json::json!(["EVENT", id, event])
                        }
                    };
                    socket
                        .send(Message::Text(frame.to_string().into()))
                        .await
                        .expect("send stub frame");
                }
            }
        }
    });

    (format!("ws://{address}"), req_rx, closed_tx)
}

/// A client→relay frame the stub observed, in wire order.
#[derive(Debug, PartialEq, Eq)]
enum Frame {
    Req(String),
    Close(String),
}

/// A relay→client frame the test asks the stub to emit.
enum StubCommand {
    Closed(String, String),
    Eose(String),
    Event(String, serde_json::Value),
}

async fn next_frame(frames: &mut mpsc::Receiver<Frame>, label: &str) -> Frame {
    tokio::time::timeout(Duration::from_secs(10), frames.recv())
        .await
        .unwrap_or_else(|_| panic!("timed out waiting for {label}"))
        .unwrap_or_else(|| panic!("stub relay closed before {label}"))
}

/// Waits for the next REQ, tolerating the CLOSE frames a reconcile sends
/// first. Asserting on `Frame::Req` directly would couple every test to
/// whether a particular reconcile also had cleanup to do.
async fn next_req(frames: &mut mpsc::Receiver<Frame>, label: &str) -> String {
    loop {
        if let Frame::Req(id) = next_frame(frames, label).await {
            return id;
        }
    }
}

fn spawn_fetch(session: Arc<RelaySession>) -> tokio::task::JoinHandle<Result<Vec<Event>, String>> {
    tokio::spawn(async move {
        session
            .fetch_events(
                serde_json::json!({ "kinds": [9], "limit": 500 }),
                Duration::from_secs(10),
            )
            .await
    })
}

/// A finite request completes on wire EOSE with only the verified events
/// delivered for its id, and the session then CLOSEs the relay subscription.
#[tokio::test]
async fn finite_fetch_completes_on_eose_and_drops_forged_events() {
    let (relay_url, mut frames, commands) = stub_relay().await;
    let lease = open_session(relay_url, Keys::generate());
    let fetch = spawn_fetch(lease.handle());
    let request_id = next_req(&mut frames, "the finite fetch REQ").await;

    let relay_keys = Keys::generate();
    let mut forged = EventBuilder::text_note("forged page event")
        .sign_with_keys(&relay_keys)
        .unwrap();
    forged.content = "tampered after signing".into();
    commands
        .send(StubCommand::Event(
            request_id.clone(),
            serde_json::to_value(forged).unwrap(),
        ))
        .await
        .unwrap();
    let fetched = EventBuilder::text_note("page event")
        .sign_with_keys(&relay_keys)
        .unwrap();
    commands
        .send(StubCommand::Event(
            request_id.clone(),
            serde_json::to_value(&fetched).unwrap(),
        ))
        .await
        .unwrap();
    commands
        .send(StubCommand::Eose(request_id.clone()))
        .await
        .unwrap();

    assert_eq!(fetch.await.unwrap().unwrap(), vec![fetched]);
    assert_eq!(
        next_frame(&mut frames, "finite fetch CLOSE").await,
        Frame::Close(request_id)
    );
}

/// Concurrent requests share one socket under distinct ids, and each
/// completes with only its own events.
#[tokio::test]
async fn concurrent_fetches_multiplex_on_one_socket() {
    let (relay_url, mut frames, commands) = stub_relay().await;
    let lease = open_session(relay_url, Keys::generate());
    let first = spawn_fetch(lease.handle());
    let first_id = next_req(&mut frames, "the first REQ").await;
    let second = spawn_fetch(lease.handle());
    let second_id = next_req(&mut frames, "the second REQ").await;
    assert_ne!(first_id, second_id);

    let relay_keys = Keys::generate();
    let for_second = EventBuilder::text_note("second page")
        .sign_with_keys(&relay_keys)
        .unwrap();
    commands
        .send(StubCommand::Event(
            second_id.clone(),
            serde_json::to_value(&for_second).unwrap(),
        ))
        .await
        .unwrap();
    commands.send(StubCommand::Eose(second_id)).await.unwrap();
    commands.send(StubCommand::Eose(first_id)).await.unwrap();

    assert_eq!(second.await.unwrap().unwrap(), vec![for_second]);
    assert_eq!(first.await.unwrap().unwrap(), Vec::<Event>::new());
}

/// A relay CLOSED fails the request with the relay's reason, and the id is
/// not re-requested: the socket already dropped it, so no CLOSE follows.
#[tokio::test]
async fn relay_closed_fails_the_request_without_reopening_it() {
    let (relay_url, mut frames, commands) = stub_relay().await;
    let lease = open_session(relay_url, Keys::generate());
    let fetch = spawn_fetch(lease.handle());
    let request_id = next_req(&mut frames, "the finite fetch REQ").await;

    commands
        .send(StubCommand::Closed(
            request_id,
            "restricted: not a member".into(),
        ))
        .await
        .unwrap();

    let error = fetch.await.unwrap().unwrap_err();
    assert!(error.contains("restricted: not a member"), "{error}");
    assert!(
        tokio::time::timeout(Duration::from_millis(500), frames.recv())
            .await
            .is_err(),
        "a CLOSED request must be neither reopened nor CLOSEd again"
    );
}

/// Dropping the lease cancels the session, so an in-flight read ends instead
/// of holding a socket past the command that opened it.
#[tokio::test]
async fn dropping_the_lease_cancels_in_flight_reads() {
    let (relay_url, mut frames, _commands) = stub_relay().await;
    let lease = open_session(relay_url, Keys::generate());
    let fetch = spawn_fetch(lease.handle());
    next_req(&mut frames, "the finite fetch REQ").await;

    drop(lease);

    assert_eq!(fetch.await.unwrap().unwrap_err(), "relay session cancelled");
}
