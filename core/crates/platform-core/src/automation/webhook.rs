//! DD-116 (DD-107, 06 §9): the WEBHOOK trigger. AgentGateway's public listener
//! forwards `POST /hooks/{automation_resource_id}` here; the Standard Webhooks
//! signature over `{id}.{timestamp}.{body}` is the only credential. A valid,
//! fresh and first-seen delivery is recorded and admitted as `automation.run`;
//! anything else creates no ActionExecution. Fixed Buzz
//! 779af8886caae1317b4de962082429867ab61503 crates/buzz-relay/src/api/bridge.rs
//! ::workflow_webhook maps the JSON body to TriggerContext.webhook_fields.
use super::*;
use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::Engine;
use sha2::Digest;
use std::collections::HashMap;

/// Upper bound of one stored, untrusted delivery body.
pub(crate) const MAX_BODY_BYTES: usize = 256 * 1024;
/// DD-116 (2): the signed timestamp must be within five minutes of now.
const WINDOW_SECONDS: i64 = 300;
const SECRET_PREFIX: &str = "whsec_";

/// Deployment public base of the AgentGateway webhook listener; without it a
/// WEBHOOK version is not offered (CAPABILITY_BLOCKED).
pub(crate) fn public_base() -> Option<String> {
    let raw = std::env::var("AUTOMATION_WEBHOOK_PUBLIC_BASE_URL").ok()?;
    let url = reqwest::Url::parse(&raw).ok()?;
    let usable = matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none();
    usable.then(|| raw.trim_end_matches('/').to_owned())
}

pub(crate) fn url_for(resource: Uuid) -> Option<String> {
    public_base().map(|base| format!("{base}/hooks/{resource}"))
}

/// Standard Webhooks display form of the stored 32-byte key (hex in OpenBao).
pub(crate) fn display(stored: &str) -> Option<String> {
    let bytes = hex::decode(stored).ok().filter(|bytes| bytes.len() == 32)?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("{SECRET_PREFIX}{encoded}"))
}

/// The four trailing characters of the displayed secret; never the key itself.
pub(crate) fn hint(display: &str) -> String {
    let chars: Vec<char> = display.chars().collect();
    chars[chars.len().saturating_sub(4)..].iter().collect()
}

/// `webhook-id`: 1–256 visible ASCII characters.
fn delivery_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && value.bytes().all(|b| (0x21..=0x7e).contains(&b))
}

/// HMAC-SHA256 over `{id}.{timestamp}.{body}`; any `v1,<base64>` entry may match.
pub(crate) fn verify(key: &[u8], id: &str, timestamp: &str, body: &[u8], signatures: &str) -> bool {
    let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, key);
    let mut message = Vec::with_capacity(id.len() + timestamp.len() + body.len() + 2);
    message.extend_from_slice(id.as_bytes());
    message.push(b'.');
    message.extend_from_slice(timestamp.as_bytes());
    message.push(b'.');
    message.extend_from_slice(body);
    signatures
        .split(' ')
        .filter_map(|entry| entry.strip_prefix("v1,"))
        .filter_map(|encoded| base64::engine::general_purpose::STANDARD.decode(encoded).ok())
        .any(|signature| ring::hmac::verify(&key, &message, &signature).is_ok())
}

fn fresh(timestamp: &str, now: i64) -> bool {
    timestamp
        .parse::<i64>()
        .is_ok_and(|signed| (now - signed).abs() <= WINDOW_SECONDS)
}

/// Original workflow_webhook: an empty body has no fields; a non-empty body
/// must be JSON; top-level object fields become `webhook_fields`.
pub(crate) fn body_json(body: &[u8]) -> Result<Option<Value>, ()> {
    if body.is_empty() {
        return Ok(None);
    }
    serde_json::from_slice(body).map(Some).map_err(|_| ())
}

pub(crate) fn fields(payload: Option<&Value>) -> HashMap<String, String> {
    payload
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .map(|(key, value)| {
            let value = match value {
                Value::String(text) => text.clone(),
                other => other.to_string(),
            };
            (key.clone(), value)
        })
        .collect()
}

/// The run's frozen source: one deterministic reference per delivery.
pub(super) fn idempotency(resource: Uuid, delivery: &str) -> Uuid {
    Uuid::new_v5(&resource, format!("webhook:{delivery}").as_bytes())
}

pub(super) fn source(resource: Uuid, delivery: &str) -> String {
    format!("webhook:{resource}:{}", idempotency(resource, delivery))
}

/// Same exact delivery, owner-initiated, no Relay author: the frozen WEBHOOK source.
pub(crate) fn frozen_source(ae: &governance::Execution, source_id: &str, root: &str) -> bool {
    let Some(p) = ae.parameters.as_ref() else {
        return false;
    };
    let Some(delivery) = p.get("webhookDeliveryId").and_then(Value::as_str) else {
        return false;
    };
    let expected = source(ae.target_id, delivery);
    ae.action_key == ACTION
        && delivery_id(delivery)
        && source_id == expected
        && root == expected
        && p.get("sourceKind").and_then(Value::as_str) == Some("WEBHOOK")
        && p.get("sourcePrincipalId").and_then(Value::as_str)
            == Some(ae.initiator_principal_id.to_string().as_str())
        && p.get("sourceEventId").and_then(Value::as_str) == Some(source_id)
        && p.get("rootEventId").and_then(Value::as_str) == Some(root)
        && p.get("sourcePubkey").is_none()
}

/// The stored, untrusted body of this run's delivery, as the original context.
pub(crate) async fn trigger_fields(
    pool: &sqlx::PgPool,
    action_execution: Uuid,
) -> Result<HashMap<String, String>, Refusal> {
    let payload: Option<Option<Value>> = sqlx::query_scalar(
        "select d.payload from admission.action_execution ae
         join catalog.automation_webhook_delivery d on d.tenant_id=ae.tenant_id
           and d.automation_resource_id=ae.target_id and d.delivery_id=ae.parameters->>'webhookDeliveryId'
         where ae.id=$1 and ae.parameters->>'sourceKind'='WEBHOOK'",
    )
    .bind(action_execution)
    .fetch_optional(pool)
    .await?;
    let payload = payload.ok_or(Refusal::Denied(ReasonCode::ScopeGuardFailed))?;
    Ok(fields(payload.as_ref()))
}

#[derive(FromRow)]
struct Receiver {
    tenant_id: Uuid,
    state: String,
    trigger_kind: Option<String>,
    webhook_secret_ref: Option<Value>,
}

fn status(code: StatusCode) -> Response {
    (code, Json(json!({"accepted":code == StatusCode::ACCEPTED}))).into_response()
}

fn rejected(reason: &'static str) -> Response {
    // DD-116 (2): no record, ActionExecution or audit; only the counted event.
    tracing::info!(reason, "automation webhook rejected");
    status(StatusCode::UNAUTHORIZED)
}

pub(crate) async fn receive(
    State(state): State<crate::bff::BffState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Ok(resource) = Uuid::parse_str(&id) else {
        return status(StatusCode::NOT_FOUND);
    };
    if body.len() > MAX_BODY_BYTES {
        return status(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let header = |name: &str| headers.get(name).and_then(|value| value.to_str().ok());
    let (Some(delivery), Some(timestamp), Some(signatures)) = (
        header("webhook-id"),
        header("webhook-timestamp"),
        header("webhook-signature"),
    ) else {
        return rejected("missing signature headers");
    };
    if !delivery_id(delivery) || !fresh(timestamp, Utc::now().timestamp()) {
        return rejected("delivery id or timestamp outside the window");
    }
    let receiver: Option<Receiver> = match sqlx::query_as(
        "select r.tenant_id,d.state,v.trigger->>'kind' trigger_kind,d.webhook_secret_ref
         from catalog.resource r join catalog.automation_definition d on d.resource_id=r.id
         left join catalog.automation_version v on v.asset_id=d.pinned_version_asset_id
           and v.automation_resource_id=r.id
         where r.id=$1 and r.type_key='automation' and r.state='ACTIVE'",
    )
    .bind(resource)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(receiver) => receiver,
        Err(_) => return status(StatusCode::SERVICE_UNAVAILABLE),
    };
    // DD-116 (6): not ENABLED (including PAUSED), not WEBHOOK or no ACTIVE key: 404.
    let Some(receiver) = receiver.filter(|r| {
        r.state == "ENABLED"
            && r.trigger_kind.as_deref() == Some("WEBHOOK")
            && r.webhook_secret_ref.is_some()
    }) else {
        return status(StatusCode::NOT_FOUND);
    };
    let reference = receiver.webhook_secret_ref.unwrap_or_default();
    let prefix = state.secrets.tenant_locator(
        receiver.tenant_id,
        &format!("automation-webhook/{resource}/"),
    );
    let (Some(locator), Some(version), Some(audience)) = (
        reference["locator"]
            .as_str()
            .filter(|locator| locator.starts_with(&prefix)),
        reference["version"]
            .as_u64()
            .and_then(|version| u32::try_from(version).ok()),
        reference["audience"].as_str(),
    ) else {
        return status(StatusCode::NOT_FOUND);
    };
    let secret = match state
        .secrets
        .read(
            &secret_store::SecretRef {
                locator: locator.to_owned(),
                version,
                audience: audience.to_owned(),
            },
            "value",
        )
        .await
    {
        Ok(secret) => secret,
        Err(_) => return status(StatusCode::SERVICE_UNAVAILABLE),
    };
    let Some(key) = hex::decode(secret.expose())
        .ok()
        .filter(|key| key.len() == 32)
    else {
        return status(StatusCode::SERVICE_UNAVAILABLE);
    };
    if !verify(&key, delivery, timestamp, &body, signatures) {
        return rejected("signature mismatch");
    }
    let Ok(payload) = body_json(&body) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let digest = hex::encode(sha2::Sha256::digest(&body));
    // DD-116 (3): one delivery per automation; a retry of the same delivery may
    // re-enter the idempotent admission, a different body under it may not.
    let recorded: Result<Option<String>, sqlx::Error> = sqlx::query_scalar(
        "insert into catalog.automation_webhook_delivery
         (tenant_id,automation_resource_id,delivery_id,signed_at,payload,payload_sha256)
         values($1,$2,$3,to_timestamp($4),$5,$6)
         on conflict(automation_resource_id,delivery_id) do update set delivery_id=excluded.delivery_id
         returning payload_sha256",
    )
    .bind(receiver.tenant_id)
    .bind(resource)
    .bind(delivery)
    .bind(timestamp.parse::<f64>().unwrap_or_default())
    .bind(&payload)
    .bind(&digest)
    .fetch_one(&state.pool)
    .await
    .map(Some);
    match recorded {
        Ok(Some(stored)) if stored == digest => {}
        Ok(_) => return status(StatusCode::CONFLICT),
        Err(_) => return status(StatusCode::SERVICE_UNAVAILABLE),
    }
    let context = collab_bridge::workflow_template::TriggerContext {
        webhook_fields: fields(payload.as_ref()),
        ..Default::default()
    };
    match admit(&state.memory_service, resource, delivery, &context).await {
        Ok(_) => status(StatusCode::ACCEPTED),
        Err(Refusal::Unavailable(_)) => status(StatusCode::SERVICE_UNAVAILABLE),
        // Original workflow_webhook: a refused run is indistinguishable from none.
        Err(_) => status(StatusCode::NOT_FOUND),
    }
}

async fn admit(
    state: &ServiceState,
    resource: Uuid,
    delivery: &str,
    context: &collab_bridge::workflow_template::TriggerContext,
) -> Result<Uuid, Refusal> {
    let mut tx = state.pool.begin().await?;
    let snapshot = run(&mut tx, resource, None).await?;
    tx.commit().await?;
    if snapshot.trigger.get("kind").and_then(Value::as_str) != Some("WEBHOOK") {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let def = definition(&state.governance).await?;
    let conditions = super::trigger_condition::step_conditions(&snapshot.action, context).await;
    admit_source(
        state,
        &snapshot,
        &def,
        AdmissionSource::Webhook(delivery),
        conditions,
    )
    .await
}

/// DD-116 (5): the plaintext key exists in exactly one response — the first
/// submission that created or rotated it. The reveal is fenced once in the
/// frozen intent; a lost response leaves only rotation.
pub(crate) async fn reveal(
    g: &Governance,
    ae: &governance::Execution,
) -> Option<contracts::WebhookSecretClass> {
    const KEYS: [&str; 2] = ["automation.enable", "automation.rotate_webhook_secret"];
    if !KEYS.contains(&ae.action_key.as_str()) || ae.dispatch_state != "DISPATCHED" {
        return None;
    }
    let intent = ae.parameters.as_ref()?.get("webhookSecretIntent")?;
    if intent["newStatus"] != "ACTIVE" || intent["revealed"] == true {
        return None;
    }
    let reference = &intent["newRef"];
    let secret_ref = secret_store::SecretRef {
        locator: reference["locator"].as_str()?.to_owned(),
        version: reference["version"]
            .as_u64()
            .and_then(|version| u32::try_from(version).ok())?,
        audience: reference["audience"].as_str()?.to_owned(),
    };
    let fenced = sqlx::query(
        "update admission.action_execution set parameters=jsonb_set(parameters,'{webhookSecretIntent,revealed}','true'::jsonb)
         where id=$1 and parameters->'webhookSecretIntent'->>'newStatus'='ACTIVE'
           and parameters->'webhookSecretIntent'->'newRef'=$2::jsonb
           and coalesce(parameters->'webhookSecretIntent'->'revealed','false'::jsonb)<>'true'::jsonb
           and exists(select 1 from catalog.automation_definition d
             where d.resource_id=$3 and d.webhook_secret_ref=$2::jsonb)",
    )
    .bind(ae.id)
    .bind(reference)
    .bind(ae.target_id)
    .execute(&g.pool)
    .await
    .ok()?;
    if fenced.rows_affected() != 1 {
        return None;
    }
    let value = g.secrets.read(&secret_ref, "value").await.ok()?;
    let secret = display(value.expose())?;
    Some(contracts::WebhookSecretClass {
        automation_resource_id: ae.target_id.to_string(),
        hint: hint(&secret),
        secret,
        url: url_for(ae.target_id),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sign(key: &[u8], id: &str, timestamp: &str, body: &[u8]) -> String {
        let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, key);
        let message = format!("{id}.{timestamp}.{}", String::from_utf8_lossy(body));
        let tag = ring::hmac::sign(&key, message.as_bytes());
        format!(
            "v1,{}",
            base64::engine::general_purpose::STANDARD.encode(tag.as_ref())
        )
    }

    #[test]
    fn standard_webhooks_signature_covers_id_timestamp_and_body() {
        let key = [7u8; 32];
        let body = br#"{"service":"deploy"}"#;
        let signature = sign(&key, "msg_1", "1700000000", body);
        assert!(verify(&key, "msg_1", "1700000000", body, &signature));
        let rotated = format!("v1,AAAA {signature}");
        assert!(verify(&key, "msg_1", "1700000000", body, &rotated));
        assert!(!verify(&key, "msg_2", "1700000000", body, &signature));
        assert!(!verify(&key, "msg_1", "1700000001", body, &signature));
        assert!(!verify(&key, "msg_1", "1700000000", b"{}", &signature));
        assert!(!verify(&[8u8; 32], "msg_1", "1700000000", body, &signature));
        assert!(!verify(&key, "msg_1", "1700000000", body, "v2,abc"));
    }

    #[test]
    fn timestamp_window_and_delivery_ids_are_bounded() {
        assert!(fresh("1000", 1300));
        assert!(fresh("1600", 1300));
        assert!(!fresh("999", 1300));
        assert!(!fresh("not-a-number", 1300));
        assert!(delivery_id("msg_2KWPBgLlAfxdpx2AI54pPJ85f4W"));
        assert!(!delivery_id(""));
        assert!(!delivery_id("has space"));
        assert!(!delivery_id(&"x".repeat(257)));
    }

    #[test]
    fn original_body_fields_and_display_secret() {
        assert_eq!(body_json(b""), Ok(None));
        assert!(body_json(b"not json").is_err());
        let payload = body_json(br#"{"service":"api","count":2,"ok":true}"#).unwrap();
        let fields = fields(payload.as_ref());
        assert_eq!(fields["service"], "api");
        assert_eq!(fields["count"], "2");
        assert_eq!(fields["ok"], "true");
        assert!(super::fields(body_json(b"[1]").unwrap().as_ref()).is_empty());
        let secret = display(&"ab".repeat(32)).unwrap();
        assert!(secret.starts_with("whsec_"));
        assert_eq!(secret.len(), 6 + 44);
        assert_eq!(hint(&secret), secret[secret.len() - 4..]);
        assert!(display("abcd").is_none());
        let resource = Uuid::new_v4();
        assert_eq!(source(resource, "d1"), source(resource, "d1"));
        assert_ne!(source(resource, "d1"), source(resource, "d2"));
    }
}
