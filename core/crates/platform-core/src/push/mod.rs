//! DD-151: Mobile push through the platform's own channel.
//!
//! * `PushRegistration` (this module): the device's own push preference, registered from the
//!   device itself over the native listener with a NIP-98 proof signed by its CLIENT key
//!   (DD-79). It is a personal device setting under DD-40 version CAS, not a Governed Action.
//!   The provider token is written once to the Tenant's OpenBao (`push-token/<uuid>`); the
//!   database keeps only its SHA-256 and the SecretRef. No response, log or audit echoes it.
//! * `worker`: Core reads the Tenant's Relay as CONTROL, decides recipients with the original
//!   `shouldNotifyForEvent` order and the current preferences (`decide`), re-checks each
//!   recipient's eligibility and delivers content-free notifications (`send`).
//! * The deployment configures provider credentials as OpenBao SecretRefs; a missing one makes
//!   that platform `NOT_CONFIGURED` and the client keeps the original "unavailable" branch.

mod config;
pub(crate) mod decide;
mod intent;
mod scan;
pub(crate) mod send;
mod token_intent;
mod unread;
pub(crate) mod worker;

use axum::{
    extract::{rejection::JsonRejection, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::{ErrorClass, EvidenceKind, ReasonCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::audit::{AuditEntry, Evidence};
use crate::bff::{resolve_execution_context, BffState, ExecutionContext};
use crate::web_transport::error_body;

pub(crate) const REGISTRATION_PATH: &str = "/api/v1/push/registration";
pub(crate) const CAPABILITY_PATH: &str = "/api/v1/push/capability";

/// Upper bound of one provider token (FCM tokens are a few hundred bytes).
const MAX_TOKEN_BYTES: usize = 4096;

/// Which provider SecretRefs the deployment configured. Only presence is reported.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct CredentialRefs {
    pub apns: Option<(String, u32)>,
    pub fcm: Option<(String, u32)>,
}

impl CredentialRefs {
    pub(crate) fn from_env() -> Self {
        let pair = |prefix: &str| {
            let locator = std::env::var(format!("{prefix}_LOCATOR")).ok()?;
            let version = std::env::var(format!("{prefix}_VERSION"))
                .ok()?
                .parse()
                .ok()?;
            (!locator.trim().is_empty() && version > 0).then_some((locator, version))
        };
        Self {
            apns: pair("PUSH_APNS_CREDENTIAL"),
            fcm: pair("PUSH_FCM_CREDENTIAL"),
        }
    }

    pub(crate) fn platform(&self, platform: &str) -> Option<&(String, u32)> {
        match platform {
            "APNS" => self.apns.as_ref(),
            "FCM" => self.fcm.as_ref(),
            _ => None,
        }
    }
}

fn availability(configured: bool) -> &'static str {
    if configured {
        "CONFIGURED"
    } else {
        "NOT_CONFIGURED"
    }
}

fn refuse(status: StatusCode, class: ErrorClass, reason: ReasonCode) -> Response {
    error_body(status, class, reason, None)
}

fn invalid() -> Response {
    refuse(
        StatusCode::BAD_REQUEST,
        ErrorClass::Precondition,
        ReasonCode::InvalidParameters,
    )
}

fn unavailable() -> Response {
    refuse(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorClass::Precondition,
        ReasonCode::DependencyUnavailable,
    )
}

async fn native_context(
    state: &BffState,
    headers: &HeaderMap,
) -> Result<ExecutionContext, Response> {
    let ctx = resolve_execution_context(state, headers).await?;
    crate::native::require_native(headers)?;
    Ok(ctx)
}

/// GET /api/v1/push/capability (DD-151(2)).
pub async fn capability(State(state): State<BffState>, headers: HeaderMap) -> Response {
    if let Err(r) = native_context(&state, &headers).await {
        return r;
    }
    let refs = CredentialRefs::from_env();
    (
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(json!({
            "apns": availability(refs.apns.is_some()),
            "fcm": availability(refs.fcm.is_some()),
        })),
    )
        .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegistrationRequest {
    proof: Value,
    platform: String,
    app_id: String,
    token: String,
    locale: String,
    enabled: bool,
    expected_version: i64,
}

impl std::fmt::Debug for RegistrationRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RegistrationRequest")
            .field("platform", &self.platform)
            .field("app_id", &self.app_id)
            .field("token", &"<redacted>")
            .field("locale", &self.locale)
            .field("enabled", &self.enabled)
            .field("expected_version", &self.expected_version)
            .finish()
    }
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegistrationView {
    device_pubkey: String,
    platform: String,
    app_id: String,
    locale: String,
    enabled: bool,
    state: String,
    version: i32,
    updated_at: chrono::DateTime<chrono::Utc>,
}

type ViewRow = (
    String,
    String,
    String,
    String,
    bool,
    String,
    i32,
    chrono::DateTime<chrono::Utc>,
);

fn view(row: ViewRow) -> RegistrationView {
    let (device_pubkey, platform, app_id, locale, enabled, state, version, updated_at) = row;
    RegistrationView {
        device_pubkey,
        platform,
        app_id,
        locale,
        enabled,
        state,
        version,
        updated_at,
    }
}

/// Request-shape checks that need no database (DD-151(1)).
pub(crate) fn valid_shape(
    platform: &str,
    app_id: &str,
    token: &str,
    locale: &str,
    expected: i64,
) -> bool {
    let app_ok = !app_id.is_empty()
        && app_id.len() <= 200
        && app_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
    let token_ok = match platform {
        // APNs device tokens are hex (32 bytes today, Apple reserves growth).
        "APNS" => (64..=200).contains(&token.len()) && token.bytes().all(|b| b.is_ascii_hexdigit()),
        "FCM" => {
            !token.is_empty()
                && token.len() <= MAX_TOKEN_BYTES
                && token.bytes().all(|b| b.is_ascii_graphic())
        }
        _ => false,
    };
    app_ok && token_ok && matches!(locale, "en" | "zh-CN") && expected >= 0
}

/// The digest kept in the database instead of the token.
pub(crate) fn token_digest(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceQuery {
    device_pubkey: String,
}

/// GET /api/v1/push/registration?devicePubkey=… — this device's registration, if any.
pub async fn get_registration(
    State(state): State<BffState>,
    headers: HeaderMap,
    query: Result<Query<DeviceQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let ctx = match native_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let Ok(Query(query)) = query else {
        return invalid();
    };
    let device = query.device_pubkey.to_ascii_lowercase();
    if device.len() != 64 || !device.bytes().all(|b| b.is_ascii_hexdigit()) {
        return invalid();
    }
    let row: Result<Option<ViewRow>, _> = sqlx::query_as(
        "select device_pubkey, platform, app_id, locale, enabled, state, version, updated_at
           from identity.push_registration
          where tenant_id = $1 and device_pubkey = $2 and tenant_principal_id = $3",
    )
    .bind(ctx.tenant_id)
    .bind(&device)
    .bind(ctx.tenant_principal_id)
    .fetch_optional(&state.pool)
    .await;
    match row {
        Ok(Some(row)) => no_store(view(row)),
        Ok(None) => refuse(
            StatusCode::NOT_FOUND,
            ErrorClass::Precondition,
            ReasonCode::TargetNotFound,
        ),
        Err(e) => {
            tracing::warn!(error = %e, "读推送登记失败");
            unavailable()
        }
    }
}

fn no_store<T: Serialize>(body: T) -> Response {
    (
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(body),
    )
        .into_response()
}

type ExistingRow = (
    i32,
    Option<String>,
    Option<String>,
    Option<i32>,
    Option<String>,
);

/// PUT /api/v1/push/registration (DD-151(1)).
pub async fn put_registration(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: Result<Json<RegistrationRequest>, JsonRejection>,
) -> Response {
    let ctx = match native_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let Ok(Json(req)) = body else {
        return invalid();
    };
    if !valid_shape(
        &req.platform,
        &req.app_id,
        &req.token,
        &req.locale,
        req.expected_version,
    ) {
        return invalid();
    }
    let Ok(proof) = serde_json::from_value::<nostr::Event>(req.proof.clone()) else {
        return refuse(
            StatusCode::FORBIDDEN,
            ErrorClass::Denied,
            ReasonCode::ClientKeyProofInvalid,
        );
    };
    match crate::client_keys::nip98_proof_valid(&state, &ctx, &proof, REGISTRATION_PATH, "PUT")
        .await
    {
        Ok(true) => {}
        Ok(false) => {
            return refuse(
                StatusCode::FORBIDDEN,
                ErrorClass::Denied,
                ReasonCode::ClientKeyProofInvalid,
            )
        }
        Err(e) => {
            tracing::warn!(error = %e, "推送登记证明核验失败");
            return unavailable();
        }
    }
    let device = proof.pubkey.to_hex();
    // The provider must be configured for this deployment; otherwise the client keeps the
    // original unavailable branch and nothing is stored.
    if CredentialRefs::from_env().platform(&req.platform).is_none() {
        return refuse(
            StatusCode::CONFLICT,
            ErrorClass::Precondition,
            ReasonCode::SurfaceCapabilityUnavailable,
        );
    }
    match apply(&state, &ctx, &device, &req).await {
        Ok(view) => no_store(view),
        Err(r) => r,
    }
}

async fn apply(
    state: &BffState,
    ctx: &ExecutionContext,
    device: &str,
    req: &RegistrationRequest,
) -> Result<RegistrationView, Response> {
    let db = |e: sqlx::Error| {
        tracing::warn!(error = %e, "推送登记写入失败");
        unavailable()
    };
    // The device key must be the caller's own ACTIVE CLIENT key in this Tenant (DD-79).
    let active: Option<(i32,)> = sqlx::query_as(
        "select 1 from identity.buzz_identity_binding
          where tenant_id = $1 and principal_id = $2 and pubkey = $3
            and custody = 'CLIENT' and state = 'ACTIVE'",
    )
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .bind(device)
    .fetch_optional(&state.pool)
    .await
    .map_err(db)?;
    if active.is_none() {
        return Err(refuse(
            StatusCode::FORBIDDEN,
            ErrorClass::Denied,
            ReasonCode::ClientKeyNotFound,
        ));
    }
    let policy =
        config::Policy::parse(&std::env::var("PUSH_DELIVERY_POLICY").map_err(|_| unavailable())?)
            .map_err(|_| unavailable())?;
    let digest = token_digest(&req.token);
    let existing: Option<ExistingRow> = sqlx::query_as(
        "select version, token_digest, token_secret_locator, token_secret_version, token_secret_audience
           from identity.push_registration where tenant_id = $1 and device_pubkey = $2",
    )
    .bind(ctx.tenant_id)
    .bind(device)
    .fetch_optional(&state.pool)
    .await
    .map_err(db)?;
    let current_version = existing.as_ref().map_or(0, |row| i64::from(row.0));
    if current_version != req.expected_version {
        return Err(refuse(
            StatusCode::CONFLICT,
            ErrorClass::Precondition,
            ReasonCode::TargetStateConflict,
        ));
    }
    let old_ref = existing
        .as_ref()
        .and_then(|(_, _, locator, version, audience)| {
            Some(secret_store::SecretRef {
                locator: locator.clone()?,
                version: u32::try_from((*version)?).ok()?,
                audience: audience.clone()?,
            })
        });
    let same_token = existing.as_ref().and_then(|row| row.1.as_deref()) == Some(digest.as_str())
        && old_ref.is_some();
    // A new token gets its own write-once locator; the same token keeps its reference.
    let reference = if same_token {
        old_ref.clone().expect("checked above")
    } else {
        let reference = secret_store::SecretRef {
            locator: state
                .secrets
                .tenant_locator(ctx.tenant_id, &format!("push-token/{}", Uuid::new_v4())),
            version: 1,
            audience: state.memory_service.secret_audience.clone(),
        };
        // Persist ownership before OpenBao; every error/crash remains discoverable.
        token_intent::prepare(&state.pool, ctx.tenant_id, device, &reference, &policy)
            .await
            .map_err(db)?;
        let version = state
            .secrets
            .write_once(&reference.locator, "value", &req.token)
            .await
            .map_err(|_| unavailable())?;
        if version != 1 {
            return Err(unavailable());
        }
        reference
    };
    let mut tx = state.pool.begin().await.map_err(db)?;
    // The pre-write check cannot authorize the post-I/O mutation. Lock all exact facts
    // again so revocation and binding have a definite transaction ordering.
    if !intent::lock_device(&mut tx, ctx.tenant_id, ctx.tenant_principal_id, device)
        .await
        .map_err(db)?
    {
        return Err(refuse(
            StatusCode::FORBIDDEN,
            ErrorClass::Denied,
            ReasonCode::ClientKeyNotFound,
        ));
    }
    // Serialize exact registration mutation before acquiring token-intent ownership.
    sqlx::query("select pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("push-registration:{}:{device}", ctx.tenant_id))
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    sqlx::query("select version from identity.push_registration where tenant_id=$1 and device_pubkey=$2 for update")
        .bind(ctx.tenant_id).bind(device).execute(&mut *tx).await.map_err(db)?;
    if !token_intent::bind(&mut tx, ctx.tenant_id, device, &reference)
        .await
        .map_err(db)?
    {
        return Err(unavailable());
    }
    let row: Option<ViewRow> = sqlx::query_as(
        "insert into identity.push_registration
             (tenant_id, device_pubkey, tenant_principal_id, platform, app_id, locale,
              token_digest, token_secret_locator, token_secret_version, token_secret_audience,
              enabled, state)
         select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE'
          where $12=0 or exists(select 1 from identity.push_registration where tenant_id=$1 and device_pubkey=$2)
         on conflict (tenant_id, device_pubkey) do update set
              tenant_principal_id = excluded.tenant_principal_id,
              platform = excluded.platform, app_id = excluded.app_id, locale = excluded.locale,
              token_digest = excluded.token_digest,
              token_secret_locator = excluded.token_secret_locator,
              token_secret_version = excluded.token_secret_version,
              token_secret_audience = excluded.token_secret_audience,
              enabled = excluded.enabled, state = 'ACTIVE',
              version = identity.push_registration.version + 1, updated_at = now()
           where identity.push_registration.version = $12
         returning device_pubkey, platform, app_id, locale, enabled, state, version, updated_at",
    )
    .bind(ctx.tenant_id)
    .bind(device)
    .bind(ctx.tenant_principal_id)
    .bind(&req.platform)
    .bind(&req.app_id)
    .bind(&req.locale)
    .bind(&digest)
    .bind(&reference.locator)
    .bind(reference.version as i32)
    .bind(&reference.audience)
    .bind(req.enabled)
    .bind(req.expected_version as i32)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?;
    let Some(row) = row else {
        // Rollback leaves PREPARING for the persistent fencing consumer.
        return Err(refuse(
            StatusCode::CONFLICT,
            ErrorClass::Precondition,
            ReasonCode::TargetStateConflict,
        ));
    };
    let operation = Uuid::new_v4();
    let parameter_hash = hex::encode(Sha256::digest(
        format!(
            "{}|{}|{}|{}",
            req.platform, req.app_id, req.locale, req.enabled
        )
        .as_bytes(),
    ));
    crate::audit::append(
        &mut tx,
        AuditEntry {
            event_key: format!("push-registration:{operation}"),
            tenant_id: Some(ctx.tenant_id),
            workspace_id: None,
            operation_id: operation,
            event_type: "OUTCOME",
            human_identity_id: Some(ctx.human_identity_id),
            initiator_principal_id: Some(ctx.tenant_principal_id),
            actor_principal_id: Some(ctx.tenant_principal_id),
            action_key: "push.registration.put",
            action_version: 1,
            component_type_key: "core",
            target_type: Some("PRINCIPAL"),
            target_id: Some(ctx.tenant_principal_id),
            parameter_hash: &parameter_hash,
            decision: "ALLOW",
            result_code: if req.enabled {
                "PUSH_ENABLED"
            } else {
                "PUSH_DISABLED"
            },
            result_exposure: "NONE",
            evidence_refs: vec![Evidence::new(
                EvidenceKind::PlatformSessionId,
                ctx.session_id,
            )],
            correlation_id: operation,
        },
    )
    .await
    .map_err(db)?;
    if let Some(old) = old_ref.filter(|old| old.locator != reference.locator) {
        token_intent::retire(&mut tx, &old.locator)
            .await
            .map_err(db)?;
    }
    tx.commit().await.map_err(db)?;
    Ok(view(row))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shapes_are_checked_before_anything_is_stored() {
        let apns = "a".repeat(64);
        assert!(valid_shape("APNS", "chat.kailo.mobile", &apns, "zh-CN", 0));
        assert!(!valid_shape(
            "APNS",
            "chat.kailo.mobile",
            "not-hex",
            "en",
            0
        ));
        assert!(!valid_shape("APNS", "chat kailo", &apns, "en", 0));
        assert!(!valid_shape("APNS", "chat.kailo", &apns, "fr", 0));
        assert!(!valid_shape("WEBPUSH", "chat.kailo", &apns, "en", 0));
        assert!(!valid_shape("APNS", "chat.kailo", &apns, "en", -1));
        assert!(valid_shape(
            "FCM",
            "chat.kailo.mobile",
            "fcm:APA91b-token_value",
            "en",
            3
        ));
        assert!(!valid_shape(
            "FCM",
            "chat.kailo.mobile",
            "with space",
            "en",
            3
        ));
        assert!(!valid_shape(
            "FCM",
            "chat.kailo.mobile",
            &"x".repeat(MAX_TOKEN_BYTES + 1),
            "en",
            3
        ));
    }

    #[test]
    fn only_the_digest_of_a_token_is_kept_and_requests_print_redacted() {
        let token = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
        let digest = token_digest(token);
        assert_eq!(digest.len(), 64);
        assert_ne!(digest, token);
        let request: RegistrationRequest = serde_json::from_value(json!({
            "proof": {}, "platform": "APNS", "appId": "chat.kailo", "token": token,
            "locale": "en", "enabled": true, "expectedVersion": 0
        }))
        .unwrap();
        assert!(!format!("{request:?}").contains(token));
        assert!(serde_json::from_value::<RegistrationRequest>(json!({
            "proof": {}, "platform": "APNS", "appId": "chat.kailo", "token": token,
            "locale": "en", "enabled": true, "expectedVersion": 0, "extra": 1
        }))
        .is_err());
    }

    #[test]
    fn credential_presence_is_all_the_capability_reports() {
        let refs = CredentialRefs {
            apns: Some(("ns/kv/push/apns".into(), 2)),
            fcm: None,
        };
        assert!(refs.platform("APNS").is_some());
        assert!(refs.platform("FCM").is_none());
        assert_eq!(availability(refs.apns.is_some()), "CONFIGURED");
        assert_eq!(availability(refs.fcm.is_some()), "NOT_CONFIGURED");
    }
}
