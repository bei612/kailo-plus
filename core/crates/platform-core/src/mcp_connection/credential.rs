//! DD-149(5)(6): connector credentials live only in the Tenant's OpenBao KV. Every
//! credential version owns one CAS=0 locator `mcp-connection/<credential-id>`; the
//! business model keeps only the SecretRef. Values never enter parameters, audit,
//! logs, errors or responses.

use serde_json::{json, Value};
use uuid::Uuid;

use super::{invalid, unavailable, Connection};
use crate::governance::Refusal;
use crate::mcp_client::Credential;
use crate::service_api::ServiceState;

/// Upper bound of one transient credential value (API key, bearer or token JSON).
pub(crate) const MAX_VALUE_BYTES: usize = 16 * 1024;

pub(crate) fn reference_of(value: &Value) -> Result<secret_store::SecretRef, Refusal> {
    let locator = value["locator"]
        .as_str()
        .ok_or_else(|| unavailable("credential ref"))?;
    let version = value["version"]
        .as_u64()
        .and_then(|v| u32::try_from(v).ok())
        .ok_or_else(|| unavailable("credential ref"))?;
    let audience = value["audience"]
        .as_str()
        .ok_or_else(|| unavailable("credential ref"))?;
    Ok(secret_store::SecretRef {
        locator: locator.to_owned(),
        version,
        audience: audience.to_owned(),
    })
}

pub(crate) fn reference_json(reference: &secret_store::SecretRef) -> Value {
    json!({"locator":reference.locator,"version":reference.version,"audience":reference.audience})
}

fn audience() -> Result<String, Refusal> {
    let reader = std::env::var("OPENBAO_SERVICE_IDENTITY").map_err(|_| unavailable("audience"))?;
    if reader.trim().is_empty() {
        return Err(unavailable("audience"));
    }
    Ok(reader)
}

/// The locator a new credential version will own. Callers freeze it (in the admitted
/// ActionExecution or OAuth attempt) before writing.
pub(crate) fn new_reference(
    state: &ServiceState,
    tenant: Uuid,
) -> Result<secret_store::SecretRef, Refusal> {
    Ok(secret_store::SecretRef {
        locator: state
            .secrets
            .tenant_locator(tenant, &format!("mcp-connection/{}", Uuid::new_v4())),
        version: 1,
        audience: audience()?,
    })
}

/// Write the frozen locator once. A replay re-reads and compares; a different stored
/// value is refused, never overwritten.
pub(crate) async fn write(
    state: &ServiceState,
    tenant: Uuid,
    reference: &secret_store::SecretRef,
    value: &str,
) -> Result<(), Refusal> {
    if value.is_empty() || value.len() > MAX_VALUE_BYTES {
        return Err(invalid());
    }
    let _ = tenant;
    let version = state
        .secrets
        .write_once(&reference.locator, "value", value)
        .await
        .map_err(|_| unavailable("credential write"))?;
    if version != reference.version {
        return Err(unavailable("credential version"));
    }
    Ok(())
}

/// Read the exact pinned version through the audited path and verify the OpenBao
/// audit device recorded the read before the value is used.
pub(crate) async fn read(
    state: &ServiceState,
    reference: &secret_store::SecretRef,
    not_before: chrono::DateTime<chrono::Utc>,
) -> Result<secret_store::SecretValue, Refusal> {
    let read = state
        .secrets
        .read_audited(reference, "value")
        .await
        .map_err(|_| unavailable("credential read"))?;
    state
        .audit
        .verify_secret_reads(&[secret_store::AuditedSecretRead {
            reference,
            request_id: &read.request_id,
            role_name: &read.role_name,
            not_before,
        }])
        .await
        .map_err(|_| unavailable("credential read audit"))?;
    Ok(read.value)
}

/// Destroy a retired credential version (rotation, OAuth refresh, delete).
pub(crate) async fn retire(
    state: &ServiceState,
    tenant: Uuid,
    reference: &secret_store::SecretRef,
    unbound: bool,
) -> Result<(), Refusal> {
    state
        .secrets
        .retire_mcp_connection_credential(tenant, reference, unbound)
        .await
        .map_err(|_| unavailable("credential retire"))
}

/// The header a connector sends upstream: API key under its declared header, bearer
/// and OAuth access tokens as `authorization: Bearer`.
pub(crate) fn header_for(
    auth_mode: &str,
    api_key_header: Option<&str>,
    stored: &str,
) -> Result<Option<Credential>, Refusal> {
    let credential = match auth_mode {
        "NONE" => return Ok(None),
        "API_KEY" => Credential {
            header: api_key_header.ok_or_else(invalid)?.to_owned(),
            value: stored.to_owned(),
        },
        "BEARER" => Credential {
            header: "authorization".into(),
            value: format!("Bearer {stored}"),
        },
        "OAUTH" => {
            let tokens: crate::mcp_oauth::TokenSet =
                serde_json::from_str(stored).map_err(|_| unavailable("token set"))?;
            Credential {
                header: "authorization".into(),
                value: format!("Bearer {}", tokens.access_token),
            }
        }
        _ => return Err(invalid()),
    };
    if reqwest::header::HeaderValue::from_str(&credential.value).is_err() {
        return Err(invalid());
    }
    Ok(Some(credential))
}

/// The credential of an existing connector (no OAuth refresh; see `oauth::fresh_credential`).
pub(crate) async fn current(
    state: &ServiceState,
    connection: &Connection,
) -> Result<Option<Credential>, Refusal> {
    if connection.auth_mode == "OAUTH" {
        return super::oauth::fresh_credential(state, connection.tenant_id, connection.resource_id)
            .await;
    }
    let Some(reference) = connection.credential()? else {
        return header_for(
            &connection.auth_mode,
            connection.api_key_header.as_deref(),
            "",
        );
    };
    let value = read(
        state,
        &reference,
        chrono::Utc::now() - chrono::Duration::seconds(5),
    )
    .await?;
    header_for(
        &connection.auth_mode,
        connection.api_key_header.as_deref(),
        value.expose(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headers_never_mix_modes() {
        assert!(header_for("NONE", None, "x").unwrap().is_none());
        let key = header_for("API_KEY", Some("x-api-key"), "k1")
            .unwrap()
            .unwrap();
        assert_eq!(
            (key.header.as_str(), key.value.as_str()),
            ("x-api-key", "k1")
        );
        let bearer = header_for("BEARER", None, "t1").unwrap().unwrap();
        assert_eq!(bearer.value, "Bearer t1");
        assert!(header_for("API_KEY", None, "k").is_err());
        assert!(header_for("BEARER", None, "bad\nvalue").is_err());
        let tokens = serde_json::to_string(&crate::mcp_oauth::TokenSet {
            access_token: "a1".into(),
            token_type: "Bearer".into(),
            refresh_token: Some("r1".into()),
            expires_at: None,
            scope: None,
        })
        .unwrap();
        let oauth = header_for("OAUTH", None, &tokens).unwrap().unwrap();
        assert_eq!(oauth.value, "Bearer a1");
        // A credential's Debug never shows the value.
        assert!(!format!("{oauth:?}").contains("a1"));
    }

    #[test]
    fn references_round_trip() {
        let reference = secret_store::SecretRef {
            locator: "tenants/t/kv/mcp-connection/x".into(),
            version: 1,
            audience: "core".into(),
        };
        let back = reference_of(&reference_json(&reference)).unwrap();
        assert_eq!(back.locator, reference.locator);
        assert_eq!(back.version, 1);
        assert!(reference_of(&json!({"locator":"x"})).is_err());
    }
}
