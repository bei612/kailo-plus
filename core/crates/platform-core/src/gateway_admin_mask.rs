//! DD-134(4)：网关配置打码。在 Core 完成，浏览器从不接收原值。
//!
//! 规则按键名与值形状两路生效，宁可多遮不漏：
//! - 敏感键（含 `secret`、`password`、`token`、`apikey`/`api_key`、`authorization`、
//!   `credential`、`privatekey`/`private_key`，或等于 `key`/`keyHash`）的值整体替换；
//!   其中 SecretRef 形状（含 `locator`）只保留 `locator` 与 `version`，文件投递只保留
//!   投递方式。
//! - 任意位置：`file` 键的值只显示投递方式；`Bearer …`、JWT 与常见供应商 key 前缀的
//!   字符串替换为占位；URL 去掉 userinfo、query 与 fragment。

use serde_json::{Map, Value};

/// 固定占位：不携带原值长度或前缀。
pub(crate) const REDACTED: &str = "[REDACTED]";
/// 文件投递只显示方式，不显示路径。
pub(crate) const FILE_DELIVERY: &str = "[FILE]";

fn sensitive_key(key: &str) -> bool {
    let compact: String = key
        .to_ascii_lowercase()
        .chars()
        .filter(|c| *c != '_' && *c != '-')
        .collect();
    compact == "key"
        || compact == "keyhash"
        || compact.ends_with("token")
        || [
            "secret",
            "password",
            "passwd",
            "apikey",
            "credential",
            "privatekey",
            "cookie",
        ]
        .iter()
        .any(|needle| compact.contains(needle))
}

/// `authorization` 既是 header（值是凭据）也是 RBAC 策略名（值是规则对象）：
/// 只遮标量，结构化规则照常递归打码。
fn authorization_key(key: &str) -> bool {
    key.to_ascii_lowercase().contains("authorization")
}

fn looks_secret(text: &str) -> bool {
    let trimmed = text.trim();
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("bearer ") || lower.starts_with("basic ") {
        return true;
    }
    // JWT：三段 base64url，首段是 JSON 对象（eyJ）
    if trimmed.starts_with("eyJ") && trimmed.split('.').count() == 3 && !trimmed.contains(' ') {
        return true;
    }
    ["sk-", "sk_", "pk_", "ghp_", "xox", "AKIA"]
        .iter()
        .any(|prefix| trimmed.starts_with(prefix) && trimmed.len() >= 16 && !trimmed.contains(' '))
}

/// URL 去掉 userinfo、query 与 fragment；不是 URL 时原样返回。
pub(crate) fn sanitize_url(text: &str) -> String {
    let Ok(mut url) = reqwest::Url::parse(text) else {
        return text.to_owned();
    };
    if url.cannot_be_a_base() || url.host_str().is_none() {
        return text.to_owned();
    }
    if url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
    {
        return text.to_owned();
    }
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.set_query(None);
    url.set_fragment(None);
    url.to_string()
}

fn mask_string(text: &str) -> Value {
    if looks_secret(text) {
        return Value::String(REDACTED.into());
    }
    let lower = text.to_ascii_lowercase();
    if [
        "http://",
        "https://",
        "ws://",
        "wss://",
        "postgres://",
        "postgresql://",
        "redis://",
    ]
    .iter()
    .any(|scheme| lower.starts_with(scheme))
    {
        return Value::String(sanitize_url(text));
    }
    Value::String(text.to_owned())
}

/// 敏感键下的值：结构保留到 SecretRef 与文件投递，其余标量一律占位。
fn mask_sensitive(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            if object.contains_key("locator") {
                let mut kept = Map::new();
                for key in ["locator", "version"] {
                    if let Some(value) = object.get(key) {
                        kept.insert(key.into(), value.clone());
                    }
                }
                return Value::Object(kept);
            }
            Value::Object(
                object
                    .iter()
                    .map(|(key, value)| {
                        let masked = if key == "file" {
                            Value::String(FILE_DELIVERY.into())
                        } else {
                            mask_sensitive(value)
                        };
                        (key.clone(), masked)
                    })
                    .collect(),
            )
        }
        Value::Array(values) => Value::Array(values.iter().map(mask_sensitive).collect()),
        Value::Null | Value::Bool(_) => value.clone(),
        _ => Value::String(REDACTED.into()),
    }
}

/// 递归打码一段 Gateway 配置或 ConfigResource 值。
pub(crate) fn mask(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| {
                    let masked = if key == "file" && !value.is_object() && !value.is_null() {
                        Value::String(FILE_DELIVERY.into())
                    } else if sensitive_key(key)
                        || (authorization_key(key) && !value.is_object() && !value.is_array())
                    {
                        mask_sensitive(value)
                    } else {
                        mask(value)
                    };
                    (key.clone(), masked)
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.iter().map(mask).collect()),
        Value::String(text) => mask_string(text),
        _ => value.clone(),
    }
}

/// 打码后的 canonical JSON 文本（键有序），供契约中的 `*Json` 字段使用。
pub(crate) fn masked_json(value: &Value) -> String {
    collab_bridge::limits::canonical_json(&mask(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sensitive_keys_are_replaced_whole() {
        let masked = mask(&json!({
            "name": "route-a",
            "apiKey": "sk-live-1234567890abcdef",
            "client_secret": "s3cr3t",
            "Authorization": "Bearer abc",
            "password": 12345,
            "key": "raw",
            "keyHash": "sha256:abcd",
            "nested": {"token": {"value": "x", "expiresIn": 3600}}
        }));
        assert_eq!(masked["name"], "route-a");
        for key in [
            "apiKey",
            "client_secret",
            "Authorization",
            "password",
            "key",
            "keyHash",
        ] {
            assert_eq!(masked[key], REDACTED, "{key}");
        }
        assert_eq!(masked["nested"]["token"]["value"], REDACTED);
        assert_eq!(masked["nested"]["token"]["expiresIn"], REDACTED);
        assert!(!masked.to_string().contains("s3cr3t"));
        assert!(!masked.to_string().contains("abcd"));
    }

    #[test]
    fn model_limits_and_policy_rules_stay_readable() {
        let masked = mask(&json!({"maxTokens": 4096, "tokenize": true,
            "mcpAuthorization": {"rules": ["mcp.tool.name == 'a'"]},
            "headers": {"authorization": "Basic dXNlcjpwYXNz"}}));
        assert_eq!(masked["maxTokens"], 4096);
        assert_eq!(masked["tokenize"], true);
        assert_eq!(
            masked["mcpAuthorization"]["rules"][0],
            "mcp.tool.name == 'a'"
        );
        assert_eq!(masked["headers"]["authorization"], REDACTED);
    }

    #[test]
    fn secret_ref_keeps_locator_and_version_only() {
        let masked = mask(&json!({"providerSecretRef": {
            "locator": "tenants/t/kv/route", "version": 3, "audience": "core"}}));
        assert_eq!(
            masked["providerSecretRef"],
            json!({"locator": "tenants/t/kv/route", "version": 3})
        );
    }

    #[test]
    fn backend_auth_keeps_structure_and_hides_file_path() {
        let masked = mask(&json!({"policies": {"backendAuth": {"credentials": [{
            "location": {"header": {"name": "Authorization", "prefix": "Bearer "}},
            "key": {"file": "/run/secrets/tenant.route.1"}}]}}}));
        let credential = &masked["policies"]["backendAuth"]["credentials"][0];
        assert_eq!(credential["key"]["file"], FILE_DELIVERY);
        assert!(!masked.to_string().contains("/run/secrets"));
        assert!(credential["location"]["header"].is_object());
    }

    #[test]
    fn file_delivery_outside_sensitive_keys_is_hidden() {
        let masked = mask(&json!({"params": {"apiKey": {"file": "/a/b"}}, "tls": {"file": "/c"}}));
        assert_eq!(masked["params"]["apiKey"]["file"], FILE_DELIVERY);
        assert_eq!(masked["tls"]["file"], FILE_DELIVERY);
    }

    #[test]
    fn bearer_jwt_and_vendor_keys_are_hidden_anywhere() {
        let masked = mask(&json!({"headers": [
            {"name": "x-a", "value": "Bearer abc.def"},
            {"name": "x-b", "value": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln"},
            {"name": "x-c", "value": "sk-proj-0123456789abcdef"},
            {"name": "x-d", "value": "plain text value"}]}));
        assert_eq!(masked["headers"][0]["value"], REDACTED);
        assert_eq!(masked["headers"][1]["value"], REDACTED);
        assert_eq!(masked["headers"][2]["value"], REDACTED);
        assert_eq!(masked["headers"][3]["value"], "plain text value");
    }

    #[test]
    fn urls_lose_userinfo_query_and_fragment() {
        let masked = mask(
            &json!({"baseUrl": "https://user:pw@api.example.com/v1?key=abc#frag",
            "host": "http://mcp.internal:8080/mcp"}),
        );
        assert_eq!(masked["baseUrl"], "https://api.example.com/v1");
        assert_eq!(masked["host"], "http://mcp.internal:8080/mcp");
        assert_eq!(
            sanitize_url("postgres://u:p@db:5432/x?sslmode=require"),
            "postgres://db:5432/x"
        );
        assert_eq!(sanitize_url("not a url"), "not a url");
    }

    #[test]
    fn masked_json_is_canonical() {
        assert_eq!(
            masked_json(&json!({"b": 1, "a": {"token": "t"}})),
            r#"{"a":{"token":"[REDACTED]"},"b":1}"#
        );
    }
}
