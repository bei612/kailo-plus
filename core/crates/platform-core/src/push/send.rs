//! DD-151(2)(5): the APNs and FCM senders.
//!
//! Provider credentials are deployment configuration kept in OpenBao: the Core config only
//! names their SecretRef (`PUSH_APNS_CREDENTIAL_*`, `PUSH_FCM_CREDENTIAL_*`). They are read
//! into this process' memory, re-read periodically and after an authentication failure (so a
//! rotation needs no restart), and never logged: the credential types print as redacted.

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

/// One provider attempt.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Outcome {
    Delivered,
    /// The provider says the device token is gone: the registration becomes INVALID.
    Invalid,
    /// A definite transient refusal, or failure before the notification request.
    Retry,
    /// Our provider credential was refused: reload it, do not touch the registration.
    ProviderAuth,
    /// A definite refusal of this one notification; not retried.
    Rejected,
    /// The request may have been accepted; never automatically resend.
    Unknown,
}

/// The provider's acceptance is not proof of display on the device.
#[derive(Clone, Debug)]
pub(crate) struct Receipt {
    pub outcome: Outcome,
    pub reference: Option<String>,
    pub retry_after: Duration,
}
impl Receipt {
    pub fn local(outcome: Outcome) -> Self {
        Self {
            outcome,
            reference: None,
            retry_after: Duration::from_secs(60),
        }
    }
}
fn retry_after(response: &reqwest::Response, minimum: u64) -> Duration {
    let header = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok());
    let seconds = header
        .and_then(|s| {
            s.parse::<u64>().ok().or_else(|| {
                chrono::DateTime::parse_from_rfc2822(s)
                    .ok()
                    .map(|at| (at.timestamp() - chrono::Utc::now().timestamp()).max(0) as u64)
            })
        })
        .unwrap_or(minimum);
    Duration::from_secs(seconds.max(minimum))
}
fn transport(error: reqwest::Error) -> Outcome {
    // Connection establishment failed before the request. A timeout/reset after connecting
    // can lose a successful response, so it is not a retryable rejection.
    if error.is_connect() {
        Outcome::Retry
    } else {
        Outcome::Unknown
    }
}

/// Re-read credentials at least this often, so a rotation in OpenBao takes effect.
pub(crate) const CREDENTIAL_TTL: Duration = Duration::from_secs(10 * 60);
/// Apple accepts provider tokens up to an hour old and refuses refreshing more than
/// once every 20 minutes.
const APNS_JWT_REUSE: Duration = Duration::from_secs(40 * 60);

#[derive(Clone)]
pub(crate) struct ApnsCredential {
    pub key_pem: String,
    pub key_id: String,
    pub team_id: String,
    pub bundle_id: String,
    pub sandbox: bool,
}

impl std::fmt::Debug for ApnsCredential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ApnsCredential(<redacted>)")
    }
}

#[derive(Clone, Deserialize)]
pub(crate) struct FcmCredential {
    pub client_email: String,
    pub private_key: String,
    pub token_uri: String,
    pub project_id: String,
}

impl std::fmt::Debug for FcmCredential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("FcmCredential(<redacted>)")
    }
}

/// A device token in memory. Printing it never shows the value.
#[derive(Clone)]
pub(crate) struct DeviceToken(pub String);

impl std::fmt::Debug for DeviceToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DeviceToken(<redacted>)")
    }
}

#[derive(Serialize)]
struct ApnsClaims<'a> {
    iss: &'a str,
    iat: u64,
}

#[derive(Serialize)]
struct FcmClaims<'a> {
    iss: &'a str,
    scope: &'a str,
    aud: &'a str,
    iat: u64,
    exp: u64,
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
}

pub(crate) struct ApnsSender {
    credential: ApnsCredential,
    jwt: Mutex<Option<(String, Instant)>>,
}

impl ApnsSender {
    pub(crate) fn new(credential: ApnsCredential) -> Self {
        Self {
            credential,
            jwt: Mutex::new(None),
        }
    }

    pub(crate) fn topic(&self) -> &str {
        &self.credential.bundle_id
    }

    pub(crate) fn target(&self) -> String {
        hex::encode(Sha256::digest(
            format!(
                "APNS:{}:{}:{}",
                self.credential.team_id,
                self.credential.bundle_id,
                if self.credential.sandbox {
                    "development"
                } else {
                    "production"
                }
            )
            .as_bytes(),
        ))
    }

    async fn provider_token(&self) -> Result<String, Outcome> {
        let mut cached = self.jwt.lock().await;
        if let Some((token, at)) = cached.as_ref() {
            if at.elapsed() < APNS_JWT_REUSE {
                return Ok(token.clone());
            }
        }
        let key = jsonwebtoken::EncodingKey::from_ec_pem(self.credential.key_pem.as_bytes())
            .map_err(|_| Outcome::ProviderAuth)?;
        let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::ES256);
        header.kid = Some(self.credential.key_id.clone());
        let claims = ApnsClaims {
            iss: &self.credential.team_id,
            iat: now_secs(),
        };
        let token =
            jsonwebtoken::encode(&header, &claims, &key).map_err(|_| Outcome::ProviderAuth)?;
        *cached = Some((token.clone(), Instant::now()));
        Ok(token)
    }

    pub(crate) async fn send(
        &self,
        http: &reqwest::Client,
        token: &DeviceToken,
        payload: &Value,
        collapse_key: &str,
        intent: uuid::Uuid,
        expires_at: i64,
    ) -> Receipt {
        let bearer = match self.provider_token().await {
            Ok(b) => b,
            Err(outcome) => return Receipt::local(outcome),
        };
        let host = if self.credential.sandbox {
            "api.sandbox.push.apple.com"
        } else {
            "api.push.apple.com"
        };
        let response = http
            .post(format!("https://{host}/3/device/{}", token.0))
            .header("authorization", format!("bearer {bearer}"))
            .header("apns-topic", &self.credential.bundle_id)
            .header("apns-push-type", "alert")
            .header("apns-priority", "10")
            .header("apns-collapse-id", collapse_key)
            // Tracking only: APNs does not promise idempotency for this ID.
            .header("apns-id", intent.to_string())
            .header("apns-expiration", expires_at.to_string())
            .json(payload)
            .timeout(Duration::from_secs(15))
            .send()
            .await;
        match response {
            Ok(response) => {
                let status = response.status().as_u16();
                let retry_after = retry_after(&response, if status >= 500 { 900 } else { 60 });
                let reference = response
                    .headers()
                    .get("apns-id")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| uuid::Uuid::parse_str(v).ok())
                    .map(|v| v.to_string());
                let body: Value = response.json().await.unwrap_or(Value::Null);
                let outcome = classify_apns(status, body["reason"].as_str());
                if outcome == Outcome::ProviderAuth {
                    *self.jwt.lock().await = None;
                }
                Receipt {
                    outcome,
                    reference,
                    retry_after,
                }
            }
            Err(e) => Receipt::local(transport(e)),
        }
    }
}

/// Apple's documented status and reason codes.
pub(crate) fn classify_apns(status: u16, reason: Option<&str>) -> Outcome {
    match (status, reason) {
        (200, _) => Outcome::Delivered,
        (410, _) => Outcome::Invalid,
        (400, Some("BadDeviceToken" | "DeviceTokenNotForTopic")) => Outcome::Invalid,
        (403, Some("Forbidden")) => Outcome::Rejected,
        (403, _) => Outcome::ProviderAuth,
        (429 | 500 | 503, _) => Outcome::Retry,
        _ => Outcome::Rejected,
    }
}

const FCM_SCOPE: &str = "https://www.googleapis.com/auth/firebase.messaging";

pub(crate) struct FcmSender {
    credential: FcmCredential,
    access: Mutex<Option<(String, Instant, Duration)>>,
}

impl FcmSender {
    pub(crate) fn new(credential: FcmCredential) -> Self {
        Self {
            credential,
            access: Mutex::new(None),
        }
    }

    pub(crate) fn target(&self) -> String {
        hex::encode(Sha256::digest(
            format!("FCM:{}", self.credential.project_id).as_bytes(),
        ))
    }

    async fn access_token(&self, http: &reqwest::Client) -> Result<String, Outcome> {
        let mut cached = self.access.lock().await;
        if let Some((token, at, ttl)) = cached.as_ref() {
            if at.elapsed() < *ttl {
                return Ok(token.clone());
            }
        }
        let key = jsonwebtoken::EncodingKey::from_rsa_pem(self.credential.private_key.as_bytes())
            .map_err(|_| Outcome::ProviderAuth)?;
        let iat = now_secs();
        let claims = FcmClaims {
            iss: &self.credential.client_email,
            scope: FCM_SCOPE,
            aud: &self.credential.token_uri,
            iat,
            exp: iat + 3600,
        };
        let assertion = jsonwebtoken::encode(
            &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256),
            &claims,
            &key,
        )
        .map_err(|_| Outcome::ProviderAuth)?;
        let response = http
            .post(&self.credential.token_uri)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                ("assertion", assertion.as_str()),
            ])
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|_| Outcome::Retry)?;
        let status = response.status().as_u16();
        if status != 200 {
            return Err(if status >= 500 {
                Outcome::Retry
            } else {
                Outcome::ProviderAuth
            });
        }
        let body: Value = response.json().await.map_err(|_| Outcome::Retry)?;
        let token = body["access_token"]
            .as_str()
            .ok_or(Outcome::ProviderAuth)?
            .to_owned();
        let lifetime = body["expires_in"]
            .as_u64()
            .unwrap_or(3600)
            .saturating_sub(120)
            .max(60);
        *cached = Some((token.clone(), Instant::now(), Duration::from_secs(lifetime)));
        Ok(token)
    }

    pub(crate) async fn send(
        &self,
        http: &reqwest::Client,
        token: &DeviceToken,
        message: &Value,
        expires_at: i64,
    ) -> Receipt {
        let access = match self.access_token(http).await {
            Ok(a) => a,
            Err(outcome) => return Receipt::local(outcome),
        };
        let mut message = message.clone();
        message["token"] = Value::String(token.0.clone());
        message["android"]["ttl"] =
            Value::String(format!("{}s", (expires_at - now_secs() as i64).max(0)));
        message["apns"]["headers"]["apns-expiration"] = Value::String(expires_at.to_string());
        let response = http
            .post(format!(
                "https://fcm.googleapis.com/v1/projects/{}/messages:send",
                self.credential.project_id
            ))
            .bearer_auth(access)
            .json(&serde_json::json!({ "message": message }))
            .timeout(Duration::from_secs(15))
            .send()
            .await;
        match response {
            Ok(response) => {
                let status = response.status().as_u16();
                let retry_after = retry_after(&response, 60);
                let body: Value = response.json().await.unwrap_or(Value::Null);
                let reference = body["name"]
                    .as_str()
                    .filter(|name| {
                        name.len() <= 512
                            && name.starts_with(&format!(
                                "projects/{}/messages/",
                                self.credential.project_id
                            ))
                    })
                    .map(str::to_owned);
                let outcome = if status == 200 && reference.is_none() {
                    Outcome::Unknown
                } else {
                    classify_fcm(status, &body)
                };
                if outcome == Outcome::ProviderAuth {
                    *self.access.lock().await = None;
                }
                Receipt {
                    outcome,
                    reference,
                    retry_after,
                }
            }
            Err(e) => Receipt::local(transport(e)),
        }
    }
}

/// FCM v1 errors: the token is gone only on UNREGISTERED (404) or a sender mismatch.
pub(crate) fn classify_fcm(status: u16, body: &Value) -> Outcome {
    let codes: Vec<&str> = body["error"]["details"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|d| d["errorCode"].as_str())
        .collect();
    let has = |code: &str| codes.contains(&code);
    match status {
        200 if body["name"]
            .as_str()
            .is_some_and(|name| name.starts_with("projects/") && name.contains("/messages/")) =>
        {
            Outcome::Delivered
        }
        200 => Outcome::Unknown,
        _ if has("UNREGISTERED") || has("SENDER_ID_MISMATCH") => Outcome::Invalid,
        401 | 403 => Outcome::ProviderAuth,
        429 | 500 | 503 => Outcome::Retry,
        _ if has("UNAVAILABLE") || has("INTERNAL") || has("QUOTA_EXCEEDED") => Outcome::Retry,
        _ => Outcome::Rejected,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn apns_statuses_map_to_registration_effects() {
        assert_eq!(classify_apns(200, None), Outcome::Delivered);
        assert_eq!(classify_apns(410, Some("Unregistered")), Outcome::Invalid);
        assert_eq!(classify_apns(400, Some("BadDeviceToken")), Outcome::Invalid);
        assert_eq!(
            classify_apns(400, Some("PayloadTooLarge")),
            Outcome::Rejected
        );
        assert_eq!(
            classify_apns(403, Some("ExpiredProviderToken")),
            Outcome::ProviderAuth
        );
        assert_eq!(classify_apns(429, None), Outcome::Retry);
        assert_eq!(classify_apns(503, None), Outcome::Retry);
    }

    #[test]
    fn fcm_errors_map_to_registration_effects() {
        let unregistered = json!({"error": {"details": [{"errorCode": "UNREGISTERED"}]}});
        assert_eq!(classify_fcm(200, &json!({})), Outcome::Unknown);
        assert_eq!(
            classify_fcm(200, &json!({"name":"projects/p/messages/m"})),
            Outcome::Delivered
        );
        assert_eq!(classify_fcm(404, &json!({})), Outcome::Rejected);
        assert_eq!(classify_fcm(404, &unregistered), Outcome::Invalid);
        assert_eq!(classify_fcm(400, &unregistered), Outcome::Invalid);
        assert_eq!(classify_fcm(401, &json!({})), Outcome::ProviderAuth);
        assert_eq!(classify_fcm(429, &json!({})), Outcome::Retry);
        assert_eq!(
            classify_fcm(
                400,
                &json!({"error": {"details": [{"errorCode": "INVALID_ARGUMENT"}]}})
            ),
            Outcome::Rejected
        );
    }

    #[tokio::test]
    async fn response_lost_after_request_is_unknown_and_retry_after_is_honored() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut bytes = [0; 4096];
            assert!(stream.read(&mut bytes).await.unwrap() > 0);
            // A provider can accept and then lose its response. Closing here models exactly
            // that ambiguity; the client must not schedule another provider request.
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let error = client
            .post(format!("http://{address}/send"))
            .body("content-free")
            .send()
            .await
            .unwrap_err();
        server.await.unwrap();
        assert_eq!(transport(error), Outcome::Unknown);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut bytes = [0; 4096];
            stream.read(&mut bytes).await.unwrap();
            stream.write_all(b"HTTP/1.1 429 Too Many Requests\r\nRetry-After: 1200\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
        });
        let response = client
            .post(format!("http://{address}/send"))
            .send()
            .await
            .unwrap();
        assert_eq!(retry_after(&response, 60), Duration::from_secs(1200));
        server.await.unwrap();
    }

    #[test]
    fn secrets_never_print() {
        let apns = ApnsCredential {
            key_pem: "-----BEGIN PRIVATE KEY-----SECRET".into(),
            key_id: "KID".into(),
            team_id: "TEAM".into(),
            bundle_id: "chat.kailo".into(),
            sandbox: false,
        };
        let fcm = FcmCredential {
            client_email: "x@y".into(),
            private_key: "SECRET".into(),
            token_uri: "https://oauth2.googleapis.com/token".into(),
            project_id: "p".into(),
        };
        let token = DeviceToken("device-token-value".into());
        let printed = format!("{apns:?} {fcm:?} {token:?}");
        assert!(!printed.contains("SECRET") && !printed.contains("device-token-value"));
    }
}
