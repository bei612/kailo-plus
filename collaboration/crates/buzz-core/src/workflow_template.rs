//! Original Buzz template expansion shared without the workflow engine.
//! Moved from buzz-workflow/src/executor.rs at upstream
//! 779af8886caae1317b4de962082429867ab61503; no I/O or execution authority.
use nostr::ToBech32;
use serde_json::Value as JsonValue;
use std::collections::HashMap;

/// An invalid filter in the original Buzz template language.
#[derive(Debug, thiserror::Error)]
#[error("template error: {0}")]
pub struct TemplateError(
    /// Original template filter diagnostic, without source content.
    pub String,
);

/// Data extracted from the triggering event, passed to every step.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct TriggerContext {
    /// Message content (message_posted trigger).
    pub text: String,
    /// Pubkey of the event author (hex string).
    pub author: String,
    /// Channel UUID as string.
    pub channel_id: String,
    /// Unix timestamp of the triggering event (as string for template use).
    pub timestamp: String,
    /// Emoji name (reaction_added trigger).
    pub emoji: String,
    /// Event ID of the triggering message (hex string).
    pub message_id: String,
    /// True when the triggering event is itself a threaded reply (carries a
    /// NIP-10 `reply`/`root` marker e-tag). Lets a `message_posted` filter
    /// select only top-level messages via `trigger_is_reply == false`.
    pub is_reply: bool,
    /// Arbitrary webhook body fields (webhook trigger).
    pub webhook_fields: HashMap<String, String>,
}

impl TriggerContext {
    /// Look up a trigger field by name.
    ///
    /// Returns `Some(&str)` for known fields; for webhook triggers, also
    /// checks `webhook_fields`. Returns `None` for unknown names.
    pub fn get_field(&self, name: &str) -> Option<&str> {
        match name {
            "text" => Some(&self.text),
            "author" => Some(&self.author),
            "channel_id" => Some(&self.channel_id),
            "timestamp" => Some(&self.timestamp),
            "emoji" => Some(&self.emoji),
            "message_id" => Some(&self.message_id),
            other => self.webhook_fields.get(other).map(|s| s.as_str()),
        }
    }
}

/// Resolve `{{trigger.X}}` and `{{steps.ID.output.X}}` placeholders in a string.
///
/// Supports filters:
/// - `| truncate(N)` — truncate to N characters
/// - `| npub` — encode a hex pubkey as its full bech32 `npub` (non-pubkey
///   values pass through unchanged); `truncate_pubkey` is a legacy alias
///
/// Unknown `{{keys}}` are left as literal text (no error, no substitution).
pub fn resolve_template(
    template: &str,
    trigger_ctx: &TriggerContext,
    step_outputs: &HashMap<String, JsonValue>,
) -> Result<String, TemplateError> {
    if !template.contains("{{") {
        return Ok(template.to_owned());
    }

    let mut result = String::with_capacity(template.len());
    let mut remaining = template;

    while let Some(start) = remaining.find("{{") {
        result.push_str(&remaining[..start]);
        remaining = &remaining[start + 2..];

        let end = match remaining.find("}}") {
            Some(e) => e,
            None => {
                // Unclosed `{{` — emit literally and stop.
                result.push_str("{{");
                result.push_str(remaining);
                return Ok(result);
            }
        };

        let expr = remaining[..end].trim();
        remaining = &remaining[end + 2..];

        // Split on `|` to extract filters.
        let mut parts = expr.splitn(2, '|');
        let var_path = parts.next().unwrap_or("").trim();
        let filter = parts.next().map(|s| s.trim());

        let raw_value = resolve_variable(var_path, trigger_ctx, step_outputs);

        let value = match (raw_value, filter) {
            (Some(v), Some(f)) => apply_filter(v, f)?,
            (Some(v), None) => v,
            (None, _) => {
                // Unknown variable — emit the original `{{expr}}` literally.
                result.push_str("{{");
                result.push_str(expr);
                result.push_str("}}");
                continue;
            }
        };

        result.push_str(&value);
    }

    result.push_str(remaining);
    Ok(result)
}

/// Resolve a single variable path to its string value.
fn resolve_variable(
    path: &str,
    trigger_ctx: &TriggerContext,
    step_outputs: &HashMap<String, JsonValue>,
) -> Option<String> {
    if let Some(field) = path.strip_prefix("trigger.") {
        return trigger_ctx.get_field(field).map(|s| s.to_owned());
    }

    // Pattern: `steps.STEP_ID.output.FIELD`
    if let Some(rest) = path.strip_prefix("steps.") {
        let mut parts = rest.splitn(3, '.');
        let step_id = parts.next()?;
        let middle = parts.next()?; // must be "output"
        let field = parts.next()?;

        if middle != "output" {
            return None;
        }

        let output = step_outputs.get(step_id)?;
        return json_get_str(output, field);
    }

    None
}

/// Navigate a JSON value by a single key and return it as a string.
fn json_get_str(value: &JsonValue, key: &str) -> Option<String> {
    match value {
        JsonValue::Object(map) => {
            let v = map.get(key)?;
            Some(json_to_string(v))
        }
        _ => None,
    }
}

/// Convert a JSON value to a plain string for template substitution.
fn json_to_string(v: &JsonValue) -> String {
    match v {
        JsonValue::String(s) => s.clone(),
        JsonValue::Bool(b) => b.to_string(),
        JsonValue::Number(n) => n.to_string(),
        JsonValue::Null => String::new(),
        other => other.to_string(),
    }
}

/// Apply a filter expression to a resolved value.
fn apply_filter(value: String, filter: &str) -> Result<String, TemplateError> {
    let filter = filter.trim();

    if let Some(inner) = filter
        .strip_prefix("truncate(")
        .and_then(|s| s.strip_suffix(')'))
    {
        let n: usize = inner
            .trim()
            .parse()
            .map_err(|_| TemplateError(format!("truncate() requires a number, got: {inner}")))?;
        let truncated: String = value.chars().take(n).collect();
        return Ok(truncated);
    }

    // `npub` (alias `truncate_pubkey`): full bech32 npub — truncated prefixes are grindable.
    if filter == "npub" || filter == "truncate_pubkey" {
        if let Ok(pk) = nostr::PublicKey::from_hex(&value) {
            return Ok(pk.to_bech32().unwrap_or(value));
        }
        return Ok(value);
    }

    Err(TemplateError(format!("unknown filter: {filter}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn original_templates_preserve_unicode_webhook_and_step_outputs() {
        let context = TriggerContext {
            text: "你好 world".into(),
            webhook_fields: HashMap::from([("service".into(), "source".into())]),
            ..Default::default()
        };
        let outputs = HashMap::from([(
            "gate".into(),
            json!({"approved":true, "count":3, "empty":null}),
        )]);
        assert_eq!(resolve_template("{{trigger.text | truncate(2)}} {{trigger.service}} {{steps.gate.output.approved}}/{{steps.gate.output.count}}/{{steps.gate.output.empty}}", &context, &outputs).unwrap(), "你好 source true/3/");
    }

    #[test]
    fn original_pubkey_filter_and_legacy_alias_keep_full_npub() {
        let pubkey = nostr::Keys::generate().public_key();
        let context = TriggerContext {
            author: pubkey.to_hex(),
            ..Default::default()
        };
        for filter in ["npub", "truncate_pubkey"] {
            assert_eq!(
                resolve_template(
                    &format!("{{{{trigger.author | {filter}}}}}"),
                    &context,
                    &HashMap::new()
                )
                .unwrap(),
                pubkey.to_bech32().unwrap()
            );
        }
    }

    #[test]
    fn original_unknown_literals_and_errors_are_unchanged() {
        let context = TriggerContext {
            text: "{{trigger.author}}".into(),
            ..Default::default()
        };
        for literal in [
            "",
            "no template",
            "{{unknown.value}}",
            "unfinished {{trigger.text",
            "{{steps.missing.output.value}}",
        ] {
            assert_eq!(
                resolve_template(literal, &context, &HashMap::new()).unwrap(),
                literal
            );
        }
        assert_eq!(
            resolve_template("{{trigger.text}}", &context, &HashMap::new()).unwrap(),
            "{{trigger.author}}"
        );
        for template in [
            "{{trigger.text | truncate(no)}}",
            "{{trigger.text | unknown}}",
        ] {
            assert!(resolve_template(template, &context, &HashMap::new()).is_err());
        }
    }
}
