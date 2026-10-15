//! REQ-23/24: ordered Delay / pinned approval -> native action, executed by AgentTask.
//! This is version validation/projection, not a scheduler or a step executor.
use serde_json::{json, Value};

use super::{invalid_management, Refusal};

/// Frozen timing inputs for the admitted Delay prefix and its independent deadlines.
pub(crate) struct DelayTimings<'a> {
    pub(crate) steps: &'a [(String, i64)],
    pub(crate) timeouts: &'a std::collections::HashMap<String, i64>,
}

fn fields(value: &Value, allowed: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|object| object.keys().all(|key| allowed.contains(&key.as_str())))
}

/// The original Buzz duration units, checked before converting to Temporal seconds.
/// Buzz 779af8886caae1317b4de962082429867ab61503:
/// crates/buzz-workflow/src/executor.rs::parse_duration_secs.
/// Compound input follows desktop/src/features/workflows/ui/workflowDuration.ts::parseDurationSeconds.
pub(crate) fn duration_seconds(value: &str) -> Option<i64> {
    let value = value.trim();
    if value.bytes().all(|ch| ch.is_ascii_digit()) {
        let seconds = value.parse::<i64>().ok()?;
        return (0..=i64::MAX / 1_000_000_000)
            .contains(&seconds)
            .then_some(seconds);
    }
    let mut rest = value;
    let mut previous = 5;
    let mut total = 0i64;
    while !rest.is_empty() {
        rest = rest.trim_start();
        if rest.is_empty() {
            break;
        }
        let end = rest.find(|ch: char| !ch.is_ascii_digit())?;
        let amount: i64 = rest[..end].parse().ok()?;
        rest = rest[end..].trim_start();
        let unit = rest.chars().next()?.to_ascii_lowercase();
        let (order, multiplier) = match unit {
            'w' => (4, 604800),
            'd' => (3, 86400),
            'h' => (2, 3600),
            'm' => (1, 60),
            's' => (0, 1),
            _ => return None,
        };
        if order >= previous {
            return None;
        }
        previous = order;
        total = total.checked_add(amount.checked_mul(multiplier)?)?;
        rest = &rest[unit.len_utf8()..];
    }
    (!value.is_empty() && total <= i64::MAX / 1_000_000_000).then_some(total)
}

/// Original Step.if, limited to the trigger variables Kailo freezes at admission.
/// A step-output reference cannot be evaluated before any effect and is blocked.
fn condition(step: &Value) -> Result<(), Refusal> {
    let Some(expression) = step.get("if") else {
        return Ok(());
    };
    let expression = super::trigger_condition::validate(expression)?;
    let variables = collab_bridge::workflow_condition::condition_variables(expression)
        .map_err(|_| invalid_management())?;
    if variables.iter().any(|variable| {
        !collab_bridge::workflow_condition::TRIGGER_VARIABLES.contains(&variable.as_str())
    }) {
        return Err(Refusal::Blocked(contracts::ReasonCode::CapabilityBlocked));
    }
    Ok(())
}

pub(crate) fn action(steps: &Value) -> Result<Value, Refusal> {
    let steps = steps
        .as_array()
        .filter(|steps| !steps.is_empty())
        .ok_or_else(invalid_management)?;
    let mut ids = std::collections::HashSet::new();
    let mut has_approval = false;
    for (index, step) in steps.iter().enumerate() {
        let id = step
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.trim().is_empty())
            .ok_or_else(invalid_management)?;
        if !ids.insert(id)
            || step
                .get("name")
                .is_some_and(|name| name.as_str().is_none_or(|name| name.trim().is_empty()))
        {
            return Err(invalid_management());
        }
        condition(step)?;
        if index + 1 == steps.len() {
            let valid = match step["action"].as_str() {
                Some("send_message") => {
                    fields(
                        step,
                        &["id", "name", "if", "action", "text", "timeout_secs"],
                    ) && step["text"]
                        .as_str()
                        .is_some_and(|text| !text.trim().is_empty())
                }
                Some("add_reaction") => {
                    fields(
                        step,
                        &["id", "name", "if", "action", "emoji", "timeout_secs"],
                    ) && step["emoji"]
                        .as_str()
                        .is_some_and(collab_bridge::bridge::valid_reaction)
                }
                Some("set_channel_topic") => {
                    fields(
                        step,
                        &["id", "name", "if", "action", "topic", "timeout_secs"],
                    ) && step["topic"].is_string()
                }
                Some("call_webhook") => {
                    fields(
                        step,
                        &[
                            "id",
                            "name",
                            "if",
                            "action",
                            "url",
                            "method",
                            "headers",
                            "secretHeaders",
                            "body",
                            "timeout_secs",
                        ],
                    ) && super::webhook_step::valid(step)
                }
                _ => false,
            };
            // Original Step.timeout_secs on the effect: Core enforces it before dispatch.
            if !valid || !valid_timeout(step) {
                return Err(invalid_management());
            }
        } else {
            match step["action"].as_str() {
                Some("delay")
                    if fields(
                        step,
                        &["id", "name", "if", "action", "duration", "timeout_secs"],
                    ) && valid_timeout(step)
                        && step["duration"]
                            .as_str()
                            .and_then(duration_seconds)
                            .is_some() => {}
                Some("request_approval")
                    if !has_approval
                        && fields(
                            step,
                            &["id", "name", "if", "action", "approvalPolicy", "message"],
                        )
                        && step["message"]
                            .as_str()
                            .is_some_and(|text| !text.trim().is_empty())
                        && super::policy_reference(Some(&step["approvalPolicy"]))
                            .is_ok_and(|(id, version)| id.is_some() && version.is_some()) =>
                {
                    has_approval = true;
                }
                _ => return Err(invalid_management()),
            }
        }
    }
    // Same immutable version owns this exact projection and the original steps.
    // Old Core rejects this kind instead of silently skipping the ordered delays.
    let last = steps.last().ok_or_else(invalid_management)?;
    Ok(if last["action"] == "add_reaction" {
        json!({"kind":"ADD_REACTION_STEPS","emoji":last["emoji"],"stepsVersion":2,"steps":steps})
    } else if last["action"] == "set_channel_topic" {
        json!({"kind":"SET_CHANNEL_TOPIC_STEPS","topic":last["topic"],"stepsVersion":2,"steps":steps})
    } else if last["action"] == "call_webhook" {
        json!({"kind":"CALL_WEBHOOK_STEPS","url":last["url"],"stepsVersion":2,"steps":steps})
    } else {
        json!({"kind":"POST_MESSAGE_STEPS","template":last["text"],"stepsVersion":2,"steps":steps})
    })
}

/// REQ-24 ordered message effects. The immutable source remains AutomationVersion;
/// the original AgentTask publishes each effect only after its predecessor's receipt.
pub(crate) fn message_sequence(steps: &Value) -> Result<Value, Refusal> {
    let rows = steps
        .as_array()
        .filter(|rows| !rows.is_empty())
        .ok_or_else(invalid_management)?;
    let mut ids = std::collections::HashSet::new();
    let mut approval_seen = false;
    let mut messages = 0;
    for step in rows {
        let id = step["id"]
            .as_str()
            .filter(|id| !id.trim().is_empty())
            .ok_or_else(invalid_management)?;
        if !ids.insert(id)
            || step
                .get("name")
                .is_some_and(|name| name.as_str().is_none_or(|name| name.trim().is_empty()))
        {
            return Err(invalid_management());
        }
        condition(step)?;
        match step["action"].as_str() {
            Some("send_message")
                if fields(
                    step,
                    &["id", "name", "if", "action", "text", "timeout_secs"],
                ) && valid_timeout(step)
                    && step["text"]
                        .as_str()
                        .is_some_and(|text| !text.trim().is_empty()) =>
            {
                messages += 1
            }
            Some("delay")
                if fields(
                    step,
                    &["id", "name", "if", "action", "duration", "timeout_secs"],
                ) && valid_timeout(step)
                    && step["duration"]
                        .as_str()
                        .and_then(duration_seconds)
                        .is_some() => {}
            Some("request_approval")
                if messages == 0
                    && !approval_seen
                    && fields(
                        step,
                        &["id", "name", "if", "action", "approvalPolicy", "message"],
                    )
                    && step["message"]
                        .as_str()
                        .is_some_and(|message| !message.trim().is_empty())
                    && super::policy_reference(Some(&step["approvalPolicy"]))
                        .is_ok_and(|(id, version)| id.is_some() && version.is_some()) =>
            {
                approval_seen = true
            }
            _ => return Err(invalid_management()),
        }
    }
    let last = rows.last().ok_or_else(invalid_management)?;
    if messages == 0 || last["action"] != "send_message" {
        return Err(invalid_management());
    }
    Ok(json!({"kind":"POST_MESSAGE_STEPS","template":last["text"],"stepsVersion":3,"steps":rows}))
}

/// Step ids whose original `if` was false at this run's admission. The frozen
/// set lives in the run's ActionExecution parameters; absence means none.
pub(crate) fn skipped(parameters: Option<&Value>) -> Result<Vec<String>, Refusal> {
    let Some(value) = parameters.and_then(|p| p.get("automationSkippedSteps")) else {
        return Ok(Vec::new());
    };
    let ids = value
        .as_array()
        .filter(|ids| !ids.is_empty())
        .ok_or_else(invalid_management)?;
    ids.iter()
        .map(|id| {
            id.as_str()
                .map(str::to_owned)
                .ok_or_else(invalid_management)
        })
        .collect()
}

/// This run's executable projection: the immutable version without the steps
/// frozen as skipped. Steps after the last remaining effect only delay or gate
/// nothing and are dropped; `None` means no side effect remains.
pub(crate) fn effective(action: &Value, skipped: &[String]) -> Result<Option<Value>, Refusal> {
    if skipped.is_empty() {
        return Ok(Some(action.clone()));
    }
    if !supported(action) {
        return Err(invalid_management());
    }
    let steps = action["steps"].as_array().ok_or_else(invalid_management)?;
    if skipped
        .iter()
        .any(|id| !steps.iter().any(|step| step["id"] == id.as_str()))
    {
        return Err(invalid_management());
    }
    let mut kept: Vec<Value> = steps
        .iter()
        .filter(|step| !skipped.iter().any(|id| step["id"] == id.as_str()))
        .cloned()
        .collect();
    while kept
        .last()
        .is_some_and(|step| matches!(step["action"].as_str(), Some("delay" | "request_approval")))
    {
        kept.pop();
    }
    if kept.is_empty() {
        return Ok(None);
    }
    let kept = Value::Array(kept);
    if is_sequence(action) {
        message_sequence(&kept).map(Some)
    } else {
        self::action(&kept).map(Some)
    }
}

/// The run's executable projection from its version action and AE parameters.
pub(crate) fn run_action(
    action: &Value,
    parameters: Option<&Value>,
) -> Result<Option<Value>, Refusal> {
    effective(action, &skipped(parameters)?)
}

pub(crate) fn is_sequence(action: &Value) -> bool {
    action["stepsVersion"] == 3
}

fn valid_timeout(step: &Value) -> bool {
    step.get("timeout_secs").is_none_or(|value| {
        value
            .as_i64()
            .is_some_and(|seconds| seconds > 0 && seconds <= i64::MAX / 1_000_000_000)
    })
}

const EFFECTS: [&str; 4] = [
    "send_message",
    "add_reaction",
    "set_channel_topic",
    "call_webhook",
];

/// Original Step.timeout_secs of an effect step (send_message, add_reaction,
/// set_channel_topic, call_webhook); `None` keeps the existing unbounded behaviour.
pub(crate) fn effect_timeout(step: &Value) -> Option<i64> {
    if step["action"]
        .as_str()
        .is_some_and(|action| EFFECTS.contains(&action))
    {
        step["timeout_secs"].as_i64()
    } else {
        None
    }
}

pub(crate) fn delay_timeouts(action: &Value) -> std::collections::HashMap<String, i64> {
    action["steps"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|step| {
            (step["action"] == "delay")
                .then(|| {
                    Some((
                        step["id"].as_str()?.to_owned(),
                        step["timeout_secs"].as_i64()?,
                    ))
                })
                .flatten()
        })
        .collect()
}

pub(crate) fn message_step(action: &Value, ordinal: usize) -> Result<&Value, Refusal> {
    if !is_sequence(action) || !supported(action) {
        return Err(invalid_management());
    }
    action["steps"]
        .as_array()
        .ok_or_else(invalid_management)?
        .iter()
        .filter(|step| step["action"] == "send_message")
        .nth(ordinal)
        .ok_or_else(invalid_management)
}

/// Prefix for the existing native Timer history reader. Later timers cannot run
/// before the intervening publication is positively reconciled.
pub(crate) fn delays_through_message(
    action: &Value,
    ordinal: usize,
) -> Result<Vec<(String, i64)>, Refusal> {
    if !is_sequence(action) {
        return delays(action);
    }
    message_step(action, ordinal)?;
    let mut messages = 0;
    let mut result = Vec::new();
    for step in action["steps"].as_array().ok_or_else(invalid_management)? {
        if step["action"] == "send_message" {
            if messages == ordinal {
                break;
            }
            messages += 1;
        } else if step["action"] == "delay" {
            result.push((
                step["id"]
                    .as_str()
                    .ok_or_else(invalid_management)?
                    .to_owned(),
                step["duration"]
                    .as_str()
                    .and_then(duration_seconds)
                    .ok_or_else(invalid_management)?,
            ));
        }
    }
    Ok(result)
}

pub(crate) fn is_native_kind(kind: &str) -> bool {
    matches!(
        kind,
        "POST_MESSAGE"
            | "POST_MESSAGE_STEPS"
            | "ADD_REACTION_STEPS"
            | "SET_CHANNEL_TOPIC_STEPS"
            | "CALL_WEBHOOK_STEPS"
    )
}

/// Only one policy-backed gate is currently executable. The immutable step is
/// the source; the existing version columns remain its policy projection.
pub(crate) fn approval(native_action: &Value) -> Option<&Value> {
    native_action
        .get("steps")?
        .as_array()?
        .iter()
        .find(|step| step["action"] == "request_approval")
}

pub(crate) fn delays_before_approval(native_action: &Value) -> Option<usize> {
    native_action
        .get("steps")?
        .as_array()?
        .iter()
        .position(|step| step["action"] == "request_approval")
}

pub(crate) fn supported(action_value: &Value) -> bool {
    match action_value.get("stepsVersion") {
        None => {
            fields(action_value, &["kind", "template"])
                && matches!(
                    action_value["kind"].as_str(),
                    Some("AGENT_TURN" | "POST_MESSAGE")
                )
                && action_value["template"]
                    .as_str()
                    .is_some_and(|text| !text.trim().is_empty())
        }
        Some(version) if version == 2 => {
            action(&action_value["steps"]).is_ok_and(|expected| expected == *action_value)
        }
        Some(version) if version == 3 => {
            message_sequence(&action_value["steps"]).is_ok_and(|expected| expected == *action_value)
        }
        Some(_) => false,
    }
}

pub(crate) fn expose(content: &mut Value, native_action: &Value) -> Result<(), Refusal> {
    if !supported(native_action) {
        return Err(invalid_management());
    }
    if native_action.get("stepsVersion").is_some() {
        content
            .as_object_mut()
            .ok_or_else(invalid_management)?
            .remove("action");
        content["formatVersion"] = native_action["stepsVersion"].clone();
        content["steps"] = native_action["steps"].clone();
    }
    Ok(())
}

pub(crate) fn delays(native_action: &Value) -> Result<Vec<(String, i64)>, Refusal> {
    if !supported(native_action) {
        return Err(invalid_management());
    }
    let Some(steps) = native_action.get("steps").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    steps
        .iter()
        .take(steps.len() - 1)
        .filter(|step| step["action"] == "delay")
        .map(|step| {
            Ok((
                step["id"]
                    .as_str()
                    .ok_or_else(invalid_management)?
                    .to_owned(),
                step["duration"]
                    .as_str()
                    .and_then(duration_seconds)
                    .ok_or_else(invalid_management)?,
            ))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delay_deadline_preserves_duration_and_rejects_unexecuted_action_controls() {
        let source = json!([
            {"id":"wait","action":"delay","duration":"62s","timeout_secs":5},
            {"id":"last","action":"send_message","text":"after delay"}
        ]);
        for projected in [action(&source).unwrap(), message_sequence(&source).unwrap()] {
            assert!(supported(&projected));
            assert_eq!(delays(&projected).unwrap(), vec![("wait".into(), 62)]);
            assert_eq!(delay_timeouts(&projected).get("wait"), Some(&5));
            let mut exposed = json!({});
            expose(&mut exposed, &projected).unwrap();
            assert_eq!(exposed["steps"], source);
        }
        for value in [
            json!(0),
            json!(-1),
            json!(1.5),
            json!("5s"),
            json!(null),
            json!(i64::MAX),
        ] {
            let mut invalid = source.clone();
            invalid[0]["timeout_secs"] = value;
            assert!(action(&invalid).is_err());
            assert!(message_sequence(&invalid).is_err());
        }
        // Effect-step timeout_secs is executed since ec2e4b8d; `from` is still an
        // original control Kailo does not execute, so it must stay rejected.
        let mut unsupported = source;
        unsupported[1]["from"] = json!("unbound");
        assert!(action(&unsupported).is_err());
        assert!(message_sequence(&unsupported).is_err());
    }

    #[test]
    fn ordered_messages_preserve_each_effect_and_do_not_run_later_timers_early() {
        let source = json!([
            {"id":"prepare","action":"delay","duration":"1s"},
            {"id":"first","action":"send_message","text":"same text"},
            {"id":"between","action":"delay","duration":"2s"},
            {"id":"last","action":"send_message","text":"same text"}
        ]);
        let value = message_sequence(&source).unwrap();
        assert!(supported(&value));
        assert!(
            action(&source).is_err(),
            "legacy version must not silently execute only last message"
        );
        assert_eq!(message_step(&value, 0).unwrap()["id"], "first");
        assert_eq!(message_step(&value, 1).unwrap()["id"], "last");
        assert!(message_step(&value, 2).is_err());
        assert_eq!(
            delays_through_message(&value, 0).unwrap(),
            vec![("prepare".into(), 1)]
        );
        assert_eq!(
            delays_through_message(&value, 1).unwrap(),
            vec![("prepare".into(), 1), ("between".into(), 2)]
        );
        let mut content = json!({});
        expose(&mut content, &value).unwrap();
        assert_eq!(content, json!({"formatVersion":3,"steps":source}));
        let mut wrong = value.clone();
        wrong["stepsVersion"] = json!(2);
        assert!(!supported(&wrong));
        wrong = value;
        wrong["template"] = json!("discarded prior effects");
        assert!(!supported(&wrong));
    }

    #[test]
    fn sequence_keeps_unimplemented_actions_and_late_approval_closed() {
        for steps in [
            json!([{"id":"m","action":"send_message","text":"first"},{"id":"d","action":"delay","duration":"1s"}]),
            json!([{"id":"m","action":"send_message","text":"first"},{"id":"m","action":"send_message","text":"second"}]),
            json!([{"id":"m","action":"send_message","text":"first"},{"id":"approval","action":"request_approval","message":"late",
                "approvalPolicy":{"id":"00000000-0000-4000-8000-000000000001","version":1}},
                {"id":"last","action":"send_message","text":"last"}]),
            json!([{"id":"dm","action":"send_dm","to":"owner","text":"not a HUMAN identity"},{"id":"m","action":"send_message","text":"last"}]),
        ] {
            assert!(message_sequence(&steps).is_err(), "{steps}");
        }
    }

    #[test]
    fn topic_preserves_clearing_without_becoming_a_message_or_management_command() {
        for topic in ["Release discussion", ""] {
            let steps = json!([{"id":"wait","action":"delay","duration":"1s"},
                {"id":"topic","action":"set_channel_topic","topic":topic}]);
            let projected = action(&steps).unwrap();
            assert_eq!(projected["kind"], "SET_CHANNEL_TOPIC_STEPS");
            assert_eq!(projected["topic"], topic);
            assert!(projected.get("template").is_none());
            assert!(is_native_kind("SET_CHANNEL_TOPIC_STEPS"));
            assert!(supported(&projected));
            let mut content = json!({});
            expose(&mut content, &projected).unwrap();
            assert_eq!(content, json!({"formatVersion":2,"steps":steps}));
            for field in ["nameOverride", "visibility", "channelId", "text"] {
                let mut invalid = steps.clone();
                invalid[1][field] = json!("not a topic");
                assert!(action(&invalid).is_err());
            }
        }
        assert!(action(&json!([{"id":"topic","action":"set_channel_topic"}])).is_err());
    }

    #[test]
    fn reaction_preserves_native_action_without_fabricating_message_text() {
        let steps = json!([{"id":"wait","action":"delay","duration":"1s"},
            {"id":"react","action":"add_reaction","emoji":"👍"}]);
        let projected = action(&steps).unwrap();
        assert_eq!(projected["kind"], "ADD_REACTION_STEPS");
        assert_eq!(projected["emoji"], "👍");
        assert!(projected.get("template").is_none());
        assert!(supported(&projected));
        assert_eq!(delays(&projected).unwrap(), vec![("wait".into(), 1)]);
        for invalid in [
            json!([{"id":"react","action":"add_reaction","emoji":""}]),
            json!([{"id":"react","action":"add_reaction","emoji":"👍","target":"invented"}]),
            json!([{"id":"react","action":"add_reaction","emoji":"👍"},{"id":"message","action":"send_message","text":"second effect"}]),
        ] {
            assert!(action(&invalid).is_err());
        }
    }

    #[test]
    fn webhook_is_the_final_effect_with_its_original_fields_and_deadline() {
        let steps = json!([{"id":"wait","action":"delay","duration":"1s"},
            {"id":"hook","name":"Notify","if":"trigger_is_reply","action":"call_webhook",
             "url":"https://hooks.example.com/notify","method":"POST","timeout_secs":30,
             "headers":{"Content-Type":"application/json"},
             "secretHeaders":{"Authorization":{"locator":"t/kv/hook","version":1,"audience":"core"}},
             "body":"{\"text\":\"{{trigger.text}}\"}"}]);
        let projected = action(&steps).unwrap();
        assert_eq!(projected["kind"], "CALL_WEBHOOK_STEPS");
        assert_eq!(projected["url"], "https://hooks.example.com/notify");
        assert!(projected.get("template").is_none());
        assert!(is_native_kind("CALL_WEBHOOK_STEPS"));
        assert!(supported(&projected));
        assert!(super::super::webhook_step::requires_elevated_authority(
            &projected
        ));
        assert_eq!(effect_timeout(&steps[1]), Some(30));
        assert_eq!(delays(&projected).unwrap(), vec![("wait".into(), 1)]);
        let mut content = json!({});
        expose(&mut content, &projected).unwrap();
        assert_eq!(content, json!({"formatVersion":2,"steps":steps}));
        for invalid in [
            json!([{"id":"hook","action":"call_webhook"}]),
            json!([{"id":"hook","action":"call_webhook","url":"https://h.example.com/","target":"x"}]),
            json!([{"id":"hook","action":"call_webhook","url":"https://h.example.com/"},
                {"id":"message","action":"send_message","text":"second effect"}]),
            json!([{"id":"hook","action":"call_webhook","url":"https://h.example.com/"},
                {"id":"wait","action":"delay","duration":"1s"}]),
        ] {
            assert!(action(&invalid).is_err());
        }
        // Not an ordered message sequence (format 3) step.
        assert!(message_sequence(&steps).is_err());
    }

    #[test]
    fn approval_preserves_policy_message_and_timer_order_without_copying_an_executor() {
        let steps = json!([
            {"id":"before","action":"delay","duration":"1s"},
            {"id":"approval","name":"Review","action":"request_approval",
             "approvalPolicy":{"id":"00000000-0000-4000-8000-000000000001","version":2},"message":"Review this reply"},
            {"id":"after","action":"delay","duration":"2s"},
            {"id":"reply","action":"send_message","text":"Approved reply"}
        ]);
        let projected = action(&steps).unwrap();
        assert!(supported(&projected));
        assert_eq!(delays_before_approval(&projected), Some(1));
        assert_eq!(approval(&projected), Some(&steps[1]));
        assert_eq!(
            delays(&projected).unwrap(),
            vec![("before".into(), 1), ("after".into(), 2)]
        );
        let mut exposed = json!({});
        expose(&mut exposed, &projected).unwrap();
        assert_eq!(exposed["steps"], steps);
        for field in ["from", "timeout", "timeout_secs", "if"] {
            let mut invalid = steps.clone();
            invalid[1][field] = json!("unbound");
            assert!(action(&invalid).is_err(), "{field}");
        }
        for replacement in [
            json!(null),
            json!({"id":"00000000-0000-4000-8000-000000000001"}),
            json!({"id":"00000000-0000-0000-0000-000000000000","version":2}),
            json!({"id":"00000000-0000-4000-8000-000000000001","version":0}),
        ] {
            let mut invalid = steps.clone();
            invalid[1]["approvalPolicy"] = replacement;
            assert!(action(&invalid).is_err());
        }
        let mut duplicate = steps.clone();
        duplicate[2] = steps[1].clone();
        duplicate[2]["id"] = json!("another-approval");
        assert!(action(&duplicate).is_err());
        let mut empty_message = steps;
        empty_message[1]["message"] = json!(" ");
        assert!(action(&empty_message).is_err());
    }

    #[test]
    fn original_order_and_ids_survive_the_existing_immutable_version_projection() {
        let steps = json!([
            {"id":"first","name":"Wait","action":"delay","duration":"1m 2s"},
            {"id":"second","action":"delay","duration":"0"},
            {"id":"reply","name":"Reply","action":"send_message","text":"hello"}
        ]);
        let projected = action(&steps).unwrap();
        assert_eq!(projected["kind"], "POST_MESSAGE_STEPS");
        assert!(supported(&projected));
        assert_eq!(
            delays(&projected).unwrap(),
            vec![("first".into(), 62), ("second".into(), 0)]
        );
        let mut content = json!({"action":projected});
        expose(&mut content, &projected).unwrap();
        assert_eq!(content, json!({"formatVersion":2,"steps":steps}));
        let mut corrupt = projected.clone();
        corrupt["template"] = json!("different effect");
        assert!(!supported(&corrupt));
        corrupt = projected.clone();
        corrupt["kind"] = json!("POST_MESSAGE");
        assert!(!supported(&corrupt), "old readers must never skip Delay");
    }

    #[test]
    fn removing_a_delay_preserves_the_final_step_identity_without_flattening_history() {
        let only_message =
            json!([{"id":"reply","name":"Reply","action":"send_message","text":"hello"}]);
        let value = action(&only_message).unwrap();
        assert!(supported(&value));
        assert!(delays(&value).unwrap().is_empty());
        assert!(supported(
            &json!({"kind":"POST_MESSAGE","template":"legacy"})
        ));
        assert!(supported(&json!({"kind":"AGENT_TURN","template":"legacy"})));
    }

    #[test]
    fn original_step_conditions_admit_only_trigger_variables() {
        let message = |condition: &str| {
            json!([{"id":"wait","if":condition,"action":"delay","duration":"1s"},
                {"id":"reply","if":condition,"action":"send_message","text":"hello"}])
        };
        for accepted in [
            r#"str_contains(trigger_text, "deploy")"#,
            "trigger_is_reply == false",
            r#"trigger_author == "aa" && str_len(trigger_emoji) > 0"#,
            "true",
        ] {
            assert!(action(&message(accepted)).is_ok(), "{accepted}");
            assert!(message_sequence(&message(accepted)).is_ok(), "{accepted}");
            assert_eq!(
                action(&message(accepted)).unwrap()["steps"],
                message(accepted)
            );
        }
        for blocked in [r#"steps_wait_output_status == "done""#, "unknown_variable"] {
            assert!(matches!(
                action(&message(blocked)),
                Err(Refusal::Blocked(contracts::ReasonCode::CapabilityBlocked))
            ));
        }
        for invalid in ["", "(trigger_is_reply", "trigger_is_reply)"] {
            assert!(
                matches!(action(&message(invalid)), Err(Refusal::Precondition(_))),
                "{invalid}"
            );
        }
    }

    #[test]
    fn frozen_skips_reproject_the_same_version_kind_or_leave_no_effect() {
        let sequence = message_sequence(&json!([
            {"id":"wait","action":"delay","duration":"1s"},
            {"id":"first","if":"trigger_is_reply","action":"send_message","text":"first"},
            {"id":"pause","action":"delay","duration":"2s"},
            {"id":"last","if":"trigger_is_reply == false","action":"send_message","text":"last"}
        ]))
        .unwrap();
        let first_only = effective(&sequence, &["last".into()]).unwrap().unwrap();
        assert_eq!(first_only["kind"], "POST_MESSAGE_STEPS");
        assert_eq!(first_only["template"], "first");
        assert_eq!(first_only["steps"].as_array().unwrap().len(), 2);
        assert!(supported(&first_only));
        let last_only = effective(&sequence, &["first".into()]).unwrap().unwrap();
        assert_eq!(
            delays_through_message(&last_only, 0).unwrap(),
            vec![("wait".into(), 1), ("pause".into(), 2)]
        );
        assert_eq!(
            effective(&sequence, &["first".into(), "last".into()]).unwrap(),
            None
        );
        assert_eq!(effective(&sequence, &[]).unwrap(), Some(sequence.clone()));
        assert!(effective(&sequence, &["missing".into()]).is_err());
        let reaction = action(&json!([{"id":"wait","action":"delay","duration":"1s"},
            {"id":"react","if":"true","action":"add_reaction","emoji":"👍"}]))
        .unwrap();
        assert_eq!(effective(&reaction, &["react".into()]).unwrap(), None);
        assert_eq!(
            effective(&reaction, &["wait".into()]).unwrap().unwrap()["steps"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            skipped(Some(&json!({"automationSkippedSteps":["a"]}))).unwrap(),
            vec!["a".to_owned()]
        );
        assert_eq!(skipped(Some(&json!({}))).unwrap(), Vec::<String>::new());
        for invalid in [
            json!({"automationSkippedSteps":[]}),
            json!({"automationSkippedSteps":[1]}),
            json!({"automationSkippedSteps":"a"}),
        ] {
            assert!(skipped(Some(&invalid)).is_err());
        }
    }

    #[test]
    fn effect_step_timeouts_are_original_positive_seconds() {
        for step in [
            json!({"id":"reply","action":"send_message","text":"hello","timeout_secs":10}),
            json!({"id":"react","action":"add_reaction","emoji":"👍","timeout_secs":10}),
            json!({"id":"topic","action":"set_channel_topic","topic":"","timeout_secs":10}),
        ] {
            assert!(action(&json!([step.clone()])).is_ok(), "{step}");
            assert_eq!(effect_timeout(&step), Some(10));
            let mut invalid = step.clone();
            invalid["timeout_secs"] = json!("10");
            assert!(action(&json!([invalid])).is_err());
        }
        let sequence = json!([
            {"id":"first","action":"send_message","text":"first","timeout_secs":5},
            {"id":"last","action":"send_message","text":"last"}
        ]);
        assert!(message_sequence(&sequence).is_ok());
        assert_eq!(effect_timeout(&sequence[1]), None);
        assert_eq!(
            effect_timeout(&json!({"id":"wait","action":"delay","duration":"1s","timeout_secs":5})),
            None
        );
    }

    #[test]
    fn unsupported_or_ambiguous_steps_never_become_an_executable_message() {
        for steps in [
            json!([]),
            json!([{"id":"wait","action":"delay","duration":"1s"}]),
            json!([{"id":"same","action":"delay","duration":"1s"},{"id":"same","action":"send_message","text":"hello"}]),
            json!([{"id":"wait","action":"delay","duration":"-1"},{"id":"reply","action":"send_message","text":"hello"}]),
            json!([{"id":"reply","action":"send_message","text":"hello","timeout_secs":0}]),
        ] {
            assert!(action(&steps).is_err(), "{steps}");
        }
        for bad in [
            "",
            "1y",
            "1m 2h",
            "1s1s",
            "+1",
            "9223372037",
            "999999999999999999999w",
        ] {
            assert!(duration_seconds(bad).is_none(), "{bad}");
        }
        assert_eq!(duration_seconds("1w 2d 3h 4m 5s"), Some(788645));
    }
}
