//! REQ-23/24: ordered Delay / pinned approval -> native action, executed by AgentTask.
//! This is version validation/projection, not a scheduler or a step executor.
use serde_json::{json, Value};

use super::{invalid_management, Refusal};

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
        if index + 1 == steps.len() {
            let valid = match step["action"].as_str() {
                Some("send_message") => {
                    fields(step, &["id", "name", "action", "text"])
                        && step["text"]
                            .as_str()
                            .is_some_and(|text| !text.trim().is_empty())
                }
                Some("add_reaction") => {
                    fields(step, &["id", "name", "action", "emoji"])
                        && step["emoji"]
                            .as_str()
                            .is_some_and(collab_bridge::bridge::valid_reaction)
                }
                Some("set_channel_topic") => {
                    fields(step, &["id", "name", "action", "topic"]) && step["topic"].is_string()
                }
                _ => false,
            };
            if !valid {
                return Err(invalid_management());
            }
        } else {
            match step["action"].as_str() {
                Some("delay")
                    if fields(step, &["id", "name", "action", "duration"])
                        && step["duration"]
                            .as_str()
                            .and_then(duration_seconds)
                            .is_some() => {}
                Some("request_approval")
                    if !has_approval
                        && fields(step, &["id", "name", "action", "approvalPolicy", "message"])
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
    } else {
        json!({"kind":"POST_MESSAGE_STEPS","template":last["text"],"stepsVersion":2,"steps":steps})
    })
}

pub(crate) fn is_native_kind(kind: &str) -> bool {
    matches!(
        kind,
        "POST_MESSAGE" | "POST_MESSAGE_STEPS" | "ADD_REACTION_STEPS" | "SET_CHANNEL_TOPIC_STEPS"
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
        content["formatVersion"] = json!(2);
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
    fn unsupported_or_ambiguous_steps_never_become_an_executable_message() {
        for steps in [
            json!([]),
            json!([{"id":"wait","action":"delay","duration":"1s"}]),
            json!([{"id":"same","action":"delay","duration":"1s"},{"id":"same","action":"send_message","text":"hello"}]),
            json!([{"id":"wait","action":"delay","duration":"-1"},{"id":"reply","action":"send_message","text":"hello"}]),
            json!([{"id":"reply","action":"send_message","text":"hello","if":"true"}]),
            json!([{"id":"reply","action":"send_message","text":"hello","timeout_secs":10}]),
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
