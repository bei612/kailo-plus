//! Fixed Buzz 779af8886caae1317b4de962082429867ab61503
//! crates/buzz-workflow/src/schema.rs::ActionDef::CallWebhook and
//! executor.rs::call_webhook_impl/check_ssrf, on the governed Kailo path:
//! the request leaves only through AgentGateway (06 §9.1), header secrets are
//! exact same-Tenant SecretRefs read at dispatch, and a definition with this
//! step needs the original elevated authority (WorkflowDef::requires_elevated_authority).
use serde_json::Value;

/// Original desktop workflowFormTypes.ts::WEBHOOK_METHODS.
pub(crate) const METHODS: [&str; 5] = ["POST", "GET", "PUT", "PATCH", "DELETE"];
/// Original call_webhook_impl `Client::builder().timeout(Duration::from_secs(10))`.
pub(crate) const REQUEST_TIMEOUT_SECS: u64 = 10;
/// Original WEBHOOK_MAX_RESPONSE_BYTES; Kailo reads at most this much and keeps none of it.
pub(crate) const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_BODY_BYTES: usize = 1024 * 1024;
const MAX_HEADERS: usize = 32;
const MAX_HEADER_BYTES: usize = 8 * 1024;

/// Original WorkflowDef::requires_elevated_authority: a definition that can send
/// channel data to an arbitrary external destination.
pub(crate) fn requires_elevated_authority(action: &Value) -> bool {
    action["steps"]
        .as_array()
        .is_some_and(|steps| steps.iter().any(|step| step["action"] == "call_webhook"))
}

/// Literal `https://host[:port]` prefix of the original URL. Templates may only
/// follow it (path/query), so no trigger content can choose the destination.
pub(crate) fn origin(url: &str) -> Option<(String, u16)> {
    let rest = url.strip_prefix("https://")?;
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..end];
    if authority.is_empty()
        || authority.contains("{{")
        || authority.contains("}}")
        || authority.contains('@')
        || authority.bytes().any(|b| b.is_ascii_control() || b == b' ')
    {
        return None;
    }
    let parsed = reqwest::Url::parse(&format!("https://{authority}/")).ok()?;
    let host = parsed.host_str()?.to_owned();
    let port = parsed.port_or_known_default()?;
    // A literal non-global address is refused when saved, as at dispatch.
    if let Ok(ip) = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<std::net::IpAddr>()
    {
        if collab_bridge::network::is_private_ip(&ip) {
            return None;
        }
    }
    Some((host, port))
}

fn token(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 256
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
}

/// Framing, hop-by-hop and platform routing headers stay under Core/AgentGateway control.
fn reserved(lower: &str) -> bool {
    let framing = matches!(
        lower,
        "host"
            | "content-length"
            | "transfer-encoding"
            | "connection"
            | "keep-alive"
            | "upgrade"
            | "te"
            | "trailer"
            | "expect"
            | "kailo-request-id"
    );
    framing
        || lower.starts_with("proxy-")
        || lower.starts_with("x-platform-")
        || lower.starts_with("x-kailo-")
}

/// Credential-bearing names must be SecretRefs, never plaintext in a version.
pub(crate) fn credential_name(lower: &str) -> bool {
    matches!(lower, "authorization" | "cookie")
        || ["token", "secret", "password", "api-key", "apikey"]
            .iter()
            .any(|part| lower.contains(part))
}

fn secret_ref(value: &Value) -> bool {
    value.as_object().is_some_and(|object| {
        object.len() == 3
            && object
                .get("locator")
                .and_then(Value::as_str)
                .is_some_and(|locator| !locator.trim().is_empty())
            && object
                .get("version")
                .and_then(Value::as_u64)
                .is_some_and(|version| (1..=u64::from(u32::MAX)).contains(&version))
            && object
                .get("audience")
                .and_then(Value::as_str)
                .is_some_and(|audience| !audience.trim().is_empty())
    })
}

/// Shape of one original call_webhook step (the caller checks id/name/if/timeout).
pub(crate) fn valid(step: &Value) -> bool {
    let Some(url) = step["url"].as_str() else {
        return false;
    };
    if url.len() > 2048 || origin(url).is_none() {
        return false;
    }
    // The rest must still be a URL once the original templates are expanded.
    let probe = url.replace("{{", "x").replace("}}", "x");
    if reqwest::Url::parse(&probe).is_err() {
        return false;
    }
    if step
        .get("method")
        .is_some_and(|method| method.as_str().is_none_or(|m| !METHODS.contains(&m)))
    {
        return false;
    }
    let body = step.get("body");
    if body.is_some_and(|body| body.as_str().is_none_or(|body| body.len() > MAX_BODY_BYTES)) {
        return false;
    }
    let mut names = std::collections::HashSet::new();
    let mut count = 0;
    if let Some(headers) = step.get("headers") {
        let Some(headers) = headers.as_object().filter(|h| !h.is_empty()) else {
            return false;
        };
        for (name, value) in headers {
            let lower = name.to_ascii_lowercase();
            let Some(value) = value.as_str() else {
                return false;
            };
            if !token(name)
                || reserved(&lower)
                || credential_name(&lower)
                || value.len() > MAX_HEADER_BYTES
                || value.bytes().any(|b| matches!(b, b'\r' | b'\n' | 0))
                || !names.insert(lower)
            {
                return false;
            }
            count += 1;
        }
    }
    if let Some(secrets) = step.get("secretHeaders") {
        let Some(secrets) = secrets.as_object().filter(|h| !h.is_empty()) else {
            return false;
        };
        for (name, value) in secrets {
            let lower = name.to_ascii_lowercase();
            if !token(name) || reserved(&lower) || !secret_ref(value) || !names.insert(lower) {
                return false;
            }
            count += 1;
        }
    }
    count <= MAX_HEADERS
}

/// Same-Tenant OpenBao scope and Core audience of every header SecretRef, as the
/// frozen governed Route SecretRef check (model_route).
pub(crate) fn secret_scope(action: &Value, tenant_prefix: &str, audience: &str) -> bool {
    action["steps"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|step| step["action"] == "call_webhook")
        .filter_map(|step| step.get("secretHeaders").and_then(Value::as_object))
        .flat_map(|secrets| secrets.values())
        .all(|reference| {
            reference["audience"].as_str() == Some(audience)
                && reference["locator"]
                    .as_str()
                    .and_then(|locator| locator.strip_prefix(tenant_prefix))
                    .is_some_and(|path| {
                        !path.is_empty()
                            && path.split('/').all(|segment| {
                                !segment.is_empty() && segment != "." && segment != ".."
                            })
                            && !path.bytes().any(|byte| {
                                byte.is_ascii_control()
                                    || matches!(byte, b'\\' | b'%' | b'?' | b'#')
                            })
                    })
        })
}

/// Original check_ssrf: every resolved address must be global unicast. Lookup
/// failure or an empty answer is not a dispatch.
pub(crate) async fn resolve_public(host: &str, port: u16) -> Result<(), bool> {
    let target = format!("{host}:{port}");
    let addresses: Vec<std::net::IpAddr> = tokio::task::spawn_blocking(move || {
        use std::net::ToSocketAddrs;
        target
            .to_socket_addrs()
            .map(|iter| iter.map(|address| address.ip()).collect())
    })
    .await
    .map_err(|_| false)?
    .map_err(|_| false)?;
    if addresses.is_empty() {
        return Err(false);
    }
    if addresses.iter().any(collab_bridge::network::is_private_ip) {
        // Definite: this destination is outside the permitted egress scope.
        return Err(true);
    }
    Ok(())
}

/// The expanded URL keeps the literal origin checked at save time.
pub(crate) fn expanded_url(url: &str, origin: &(String, u16)) -> Option<reqwest::Url> {
    let mut parsed = reqwest::Url::parse(url).ok()?;
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.host_str()? != origin.0
        || parsed.port_or_known_default()? != origin.1
    {
        return None;
    }
    parsed.set_fragment(None);
    Some(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn reference(version: u64) -> Value {
        json!({"locator":"t/kv/hook","version":version,"audience":"core"})
    }

    #[test]
    fn original_webhook_step_keeps_destination_literal_and_secrets_out_of_versions() {
        let url = "https://hooks.example.com/notify?c={{trigger.channel_id}}";
        let base = json!({"id":"hook","action":"call_webhook","url":url});
        assert!(valid(&base));
        let expected = Some(("hooks.example.com".to_owned(), 443));
        assert_eq!(origin(url), expected);
        let mut full = base.clone();
        full["method"] = json!("PUT");
        full["headers"] = json!({"Content-Type":"application/json","X-By":"{{trigger.author}}"});
        full["secretHeaders"] = json!({"Authorization":reference(1)});
        full["body"] = json!("{\"text\":\"{{trigger.text}}\"}");
        assert!(valid(&full));
        for url in [
            "http://hooks.example.com/notify",
            "https://{{trigger.text}}/notify",
            "https://hooks.{{trigger.text}}.com/",
            "https://user:pass@hooks.example.com/",
            "https://127.0.0.1/",
            "https://10.0.0.8:8443/",
            "https://[::1]/",
            "https:///",
        ] {
            let mut invalid = base.clone();
            invalid["url"] = json!(url);
            assert!(!valid(&invalid), "{url}");
        }
        let mut extra = reference(1);
        extra["value"] = json!("x");
        let invalid_fields = [
            ("method", json!("TRACE")),
            ("headers", json!({})),
            ("headers", json!({"Authorization":"Bearer plain"})),
            ("headers", json!({"X-Api-Key":"plain"})),
            ("headers", json!({"Host":"internal"})),
            ("headers", json!({"X-Platform-Tenant":"forged"})),
            ("headers", json!({"Bad Name":"v"})),
            ("headers", json!({"X-Split":"a\r\nInjected: b"})),
            ("secretHeaders", json!({"Authorization":"plain"})),
            ("secretHeaders", json!({"Authorization":reference(0)})),
            ("secretHeaders", json!({"Authorization":extra})),
            ("body", json!(1)),
        ];
        for (key, value) in invalid_fields {
            let mut invalid = base.clone();
            invalid[key] = value;
            assert!(!valid(&invalid), "{key}");
        }
        let mut duplicate = base;
        duplicate["headers"] = json!({"x-signature-id":"1"});
        duplicate["secretHeaders"] = json!({"X-Signature-Id":reference(1)});
        assert!(!valid(&duplicate));
    }

    #[test]
    fn webhook_secrets_must_be_same_tenant_core_references() {
        let secret = json!({"locator":"tenants/t1/kv/hook","version":2,"audience":"core"});
        let step = json!({"id":"hook","action":"call_webhook","url":"https://h.example.com/",
            "secretHeaders":{"Authorization":secret}});
        let action = json!({"steps":[step]});
        assert!(requires_elevated_authority(&action));
        assert!(secret_scope(&action, "tenants/t1/kv/", "core"));
        assert!(!secret_scope(&action, "tenants/t2/kv/", "core"));
        assert!(!secret_scope(&action, "tenants/t1/kv/", "other"));
        let mut escape = action.clone();
        let locator = &mut escape["steps"][0]["secretHeaders"]["Authorization"]["locator"];
        *locator = json!("tenants/t1/kv/../t2/hook");
        assert!(!secret_scope(&escape, "tenants/t1/kv/", "core"));
        let message = json!({"steps":[{"id":"m","action":"send_message","text":"x"}]});
        assert!(!requires_elevated_authority(&message));
    }

    #[test]
    fn expanded_url_cannot_move_the_saved_origin() {
        let origin = ("hooks.example.com".to_owned(), 443);
        let kept = expanded_url("https://hooks.example.com/a?b=c#frag", &origin);
        assert!(kept.is_some_and(|url| url.fragment().is_none()));
        assert!(expanded_url("https://hooks.example.com:8443/a", &origin).is_none());
        assert!(expanded_url("https://other.example.com/a", &origin).is_none());
        assert!(expanded_url("http://hooks.example.com/a", &origin).is_none());
    }
}
