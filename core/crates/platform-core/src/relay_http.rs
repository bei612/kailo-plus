//! DD-81: bound ordinary Relay HTTP observations without changing publication outcomes.
use std::time::Duration;

fn duration(raw: &str) -> Result<Duration, &'static str> {
    const INVALID: &str = "BUZZ_RELAY_HTTP_TIMEOUT_SECONDS 必须是正整数秒";
    if raw.is_empty() || raw.starts_with('0') || !raw.bytes().all(|b| b.is_ascii_digit()) {
        return Err(INVALID);
    }
    let seconds = raw.parse::<i32>().map_err(|_| INVALID)?;
    let value = Duration::from_secs(u64::try_from(seconds).map_err(|_| INVALID)?);
    if seconds == 0 || std::time::Instant::now().checked_add(value).is_none() {
        return Err(INVALID);
    }
    Ok(value)
}

fn client(timeout: Duration) -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        // An origin-signed request cannot delegate its result to a redirect.
        .redirect(reqwest::redirect::Policy::none())
        // Total request deadline includes connection, sending and consuming the body.
        .timeout(timeout)
        .build()
}

pub(crate) fn from_env() -> Result<reqwest::Client, Box<dyn std::error::Error>> {
    let raw = std::env::var("BUZZ_RELAY_HTTP_TIMEOUT_SECONDS")
        .map_err(|_| "缺少 BUZZ_RELAY_HTTP_TIMEOUT_SECONDS")?;
    Ok(client(duration(&raw)?)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use collab_bridge::bridge::{Custody, Delivery, IdentityClient};
    use nostr::{EventBuilder, Keys, Kind};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn server(stall: bool) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 8192];
            let received = socket.read(&mut request).await.unwrap();
            assert!(received > 0, "the consumer must send an HTTP request");
            if stall {
                socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\nContent-Type: application/json\r\n\r\n[").await.unwrap();
                std::future::pending::<()>().await;
            } else {
                socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n[]").await.unwrap();
            }
        });
        (origin, task)
    }

    fn identity(origin: &str, keys: &Keys) -> IdentityClient {
        IdentityClient::new(
            Custody::Server,
            &keys.secret_key().to_secret_hex(),
            origin,
            "deadline.example",
        )
        .unwrap()
    }

    #[test]
    fn deployment_deadline_requires_a_positive_representable_value() {
        for value in ["", "0", "-1", "+1", "1.5", " 1", "18446744073709551616"] {
            assert!(duration(value).is_err(), "{value}");
        }
        assert_eq!(duration("7").unwrap(), Duration::from_secs(7));
    }

    #[tokio::test]
    async fn ordinary_relay_consumers_bound_stalled_response_bodies() {
        let http = client(Duration::from_millis(100)).unwrap();
        let keys = Keys::generate();
        let (origin, server) = server(true).await;
        let reader = identity(&origin, &keys);
        let result = tokio::time::timeout(Duration::from_secs(2), reader.query(&http, &[])).await;
        server.abort();
        assert!(result
            .expect("query body must reach the configured deadline")
            .is_err());

        let (origin, server) = self::server(true).await;
        let writer = identity(&origin, &keys);
        let event = EventBuilder::new(Kind::TextNote, "deadline fixture")
            .sign_with_keys(&keys)
            .unwrap();
        let admitted = writer.admit().unwrap();
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            writer.deliver(&http, &event, admitted),
        )
        .await;
        server.abort();
        assert!(matches!(
            result.expect("ACK body must reach the configured deadline"),
            Delivery::Unknown(_)
        ));

        let (origin, server) = self::server(true).await;
        let transport = reqwest::Url::parse(&origin).unwrap();
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            collab_bridge::limits::fetch_nip11(&http, &transport, "deadline.example"),
        )
        .await;
        server.abort();
        assert!(result
            .expect("NIP-11 body must reach the configured deadline")
            .is_err());

        let (origin, server) = self::server(false).await;
        let reader = identity(&origin, &keys);
        assert_eq!(
            reader.query(&http, &[]).await.unwrap(),
            serde_json::json!([])
        );
        server.await.unwrap();
    }
}
