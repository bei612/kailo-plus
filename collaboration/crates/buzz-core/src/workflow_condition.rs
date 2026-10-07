//! Original Buzz condition evaluation, without workflow or I/O authority.
//! Extracted from buzz-workflow/src/executor.rs at
//! 779af8886caae1317b4de962082429867ab61503.
use crate::workflow_template::TriggerContext;
use evalexpr::HashMapContext;
use serde_json::Value as JsonValue;
use std::collections::HashMap;

/// Original expression diagnostic. Callers must not persist source context.
#[derive(Debug, thiserror::Error)]
#[error("condition error: {0}")]
pub struct ConditionError(pub String);

/// Build an `evalexpr::HashMapContext` from trigger context and step outputs.
///
/// Variable names use underscores (not dots) because `evalexpr` does not
/// support dotted identifiers:
///
/// | YAML reference                    | evalexpr variable         |
/// |-----------------------------------|---------------------------|
/// | `trigger.text`                    | `trigger_text`            |
/// | `trigger.author`                  | `trigger_author`          |
/// | `trigger.channel_id`              | `trigger_channel_id`      |
/// | `trigger.timestamp`               | `trigger_timestamp`       |
/// | `trigger.emoji`                   | `trigger_emoji`           |
/// | `trigger.message_id`              | `trigger_message_id`      |
/// | `trigger.is_reply`                | `trigger_is_reply` (bool) |
/// | `steps.STEP_ID.output.FIELD`      | `steps_STEP_ID_output_FIELD` |
///
/// Also registers string helper functions that the `cron` crate's `evalexpr` v11
/// does not include by default:
/// - `str_contains(haystack, needle)` → bool
/// - `str_starts_with(s, prefix)` → bool
/// - `str_ends_with(s, suffix)` → bool
/// - `str_len(s)` → int
pub fn build_eval_context(
    trigger_ctx: &TriggerContext,
    step_outputs: &HashMap<String, JsonValue>,
) -> Result<HashMapContext, ConditionError> {
    use evalexpr::*;

    let mut ctx = HashMapContext::new();

    // evalexpr v11 does not ship str_contains / str_starts_with / str_ends_with.
    // Register them as custom functions so workflow YAML can use them.

    ctx.set_function(
        "str_contains".into(),
        Function::new(|args| {
            let args = args.as_fixed_len_tuple(2)?;
            let haystack = args[0].as_string()?;
            let needle = args[1].as_string()?;
            Ok(Value::Boolean(haystack.contains(needle.as_str())))
        }),
    )
    .map_err(|e| ConditionError(e.to_string()))?;

    ctx.set_function(
        "str_starts_with".into(),
        Function::new(|args| {
            let args = args.as_fixed_len_tuple(2)?;
            let s = args[0].as_string()?;
            let prefix = args[1].as_string()?;
            Ok(Value::Boolean(s.starts_with(prefix.as_str())))
        }),
    )
    .map_err(|e| ConditionError(e.to_string()))?;

    ctx.set_function(
        "str_ends_with".into(),
        Function::new(|args| {
            let args = args.as_fixed_len_tuple(2)?;
            let s = args[0].as_string()?;
            let suffix = args[1].as_string()?;
            Ok(Value::Boolean(s.ends_with(suffix.as_str())))
        }),
    )
    .map_err(|e| ConditionError(e.to_string()))?;

    ctx.set_function(
        "str_len".into(),
        Function::new(|arg| {
            let s = arg.as_string()?;
            Ok(Value::Int(s.len() as i64))
        }),
    )
    .map_err(|e| ConditionError(e.to_string()))?;

    // Register webhook fields first as `trigger_FIELD` so that standard trigger
    // fields inserted below always take precedence and cannot be spoofed.
    for (key, val) in &trigger_ctx.webhook_fields {
        // Skip any key that would collide with a standard trigger_ or steps_ variable.
        if key.starts_with("trigger_") || key.starts_with("steps_") {
            continue;
        }
        let var_name = format!("trigger_{key}");
        ctx.set_value(var_name, Value::String(val.clone()))
            .map_err(|e| ConditionError(e.to_string()))?;
    }

    let trigger_fields = [
        ("trigger_text", trigger_ctx.text.as_str()),
        ("trigger_author", trigger_ctx.author.as_str()),
        ("trigger_channel_id", trigger_ctx.channel_id.as_str()),
        ("trigger_timestamp", trigger_ctx.timestamp.as_str()),
        ("trigger_emoji", trigger_ctx.emoji.as_str()),
        ("trigger_message_id", trigger_ctx.message_id.as_str()),
    ];

    for (name, val) in &trigger_fields {
        ctx.set_value((*name).into(), Value::String((*val).to_owned()))
            .map_err(|e| ConditionError(e.to_string()))?;
    }

    // `trigger_is_reply` is boolean (not a string field), so a filter can read
    // `trigger_is_reply == false` to fire only on top-level messages.
    ctx.set_value(
        "trigger_is_reply".into(),
        Value::Boolean(trigger_ctx.is_reply),
    )
    .map_err(|e| ConditionError(e.to_string()))?;

    for (step_id, output) in step_outputs {
        if let JsonValue::Object(map) = output {
            for (field, val) in map {
                let var_name = format!("steps_{step_id}_output_{field}");
                let eval_val = json_value_to_eval(val);
                ctx.set_value(var_name, eval_val)
                    .map_err(|e| ConditionError(e.to_string()))?;
            }
        }
    }

    Ok(ctx)
}

/// Convert a `serde_json::Value` to an `evalexpr::Value`.
fn json_value_to_eval(v: &JsonValue) -> evalexpr::Value {
    use evalexpr::Value as EV;
    match v {
        JsonValue::String(s) => EV::String(s.clone()),
        JsonValue::Bool(b) => EV::Boolean(*b),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                EV::Int(i)
            } else if let Some(f) = n.as_f64() {
                EV::Float(f)
            } else {
                EV::String(n.to_string())
            }
        }
        JsonValue::Null => EV::Empty,
        other => EV::String(other.to_string()),
    }
}

/// Original executor expression byte limit.
pub const MAX_EXPR_LEN: usize = 4096;
/// Fixed Buzz executor's maximum evaluation wall-clock time.
pub const EVAL_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(100);

/// Parse a configured expression without fabricating triggering message data.
pub fn validate_condition(expr: &str) -> Result<(), ConditionError> {
    if expr.len() > MAX_EXPR_LEN {
        return Err(ConditionError(format!(
            "condition expression exceeds {} byte limit",
            MAX_EXPR_LEN
        )));
    }
    evalexpr::build_operator_tree(expr)
        .map(|_| ())
        .map_err(|error| ConditionError(error.to_string()))
}

/// Evaluate the original expression against the original typed context.
/// Async hosts keep the original executor's bounded blocking-task wrapper.
pub fn evaluate_condition(
    expr: &str,
    trigger_ctx: &TriggerContext,
    step_outputs: &HashMap<String, JsonValue>,
) -> Result<bool, ConditionError> {
    validate_condition(expr)?;
    let context = build_eval_context(trigger_ctx, step_outputs)?;
    evalexpr::eval_boolean_with_context(expr, &context)
        .map_err(|error| ConditionError(error.to_string()))
}
