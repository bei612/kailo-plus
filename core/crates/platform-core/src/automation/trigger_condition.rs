//! REQ-23/24, DD-107: original Buzz trigger filter, before existing run admission.
//! No source body is stored, and a match never substitutes for fresh authorization.
use collab_bridge::{workflow_condition, workflow_template::TriggerContext};
use contracts::ReasonCode;
use nostr::Event;
use serde_json::Value;
use uuid::Uuid;

use crate::governance::Refusal;

pub(crate) fn validate(value: &Value) -> Result<&str, Refusal> {
    let expression = value
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    workflow_condition::validate_condition(expression)
        .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?;
    Ok(expression)
}

/// Same fields as fixed Buzz lib.rs::build_trigger_context/event_is_reply.
/// The caller has verified the event, channel and current HUMAN binding; for
/// a reaction it also verified the reacted same-channel message (`target`).
pub(super) fn event_context(channel: Uuid, event: &Event, target: Option<&str>) -> TriggerContext {
    TriggerContext {
        text: event.content.clone(),
        author: event.pubkey.to_hex(),
        channel_id: channel.to_string(),
        timestamp: event.created_at.as_secs().to_string(),
        emoji: target.map(|_| event.content.clone()).unwrap_or_default(),
        message_id: target.map_or_else(|| event.id.to_hex(), str::to_owned),
        is_reply: collab_bridge::nip10::parse_thread_markers(&event.tags)
            .reply
            .is_some(),
        ..Default::default()
    }
}

async fn evaluate(expression: String, context: TriggerContext) -> Option<bool> {
    // 100ms is the fixed upstream executor::EVAL_TIMEOUT, not a new setting.
    let result = tokio::time::timeout(
        workflow_condition::EVAL_TIMEOUT,
        tokio::task::spawn_blocking(move || {
            workflow_condition::evaluate_condition(&expression, &context, &Default::default())
        }),
    )
    .await;
    match result {
        Ok(Ok(Ok(matched))) => Some(matched),
        _ => None,
    }
}

pub(super) async fn matches(
    trigger: &Value,
    channel: Uuid,
    event: &Event,
    target: Option<&str>,
) -> Result<bool, Refusal> {
    let Some(filter) = trigger.get("filter") else {
        return Ok(true);
    };
    let expression = validate(filter)?.to_owned();
    match evaluate(expression, event_context(channel, event, target)).await {
        Some(matched) => Ok(matched),
        None => {
            // Original trigger filters skip on evaluation errors/timeouts.
            // Do not log expression diagnostics which can contain source text.
            tracing::warn!("automation trigger condition could not be evaluated; skipping event");
            Ok(false)
        }
    }
}

/// Fixed Buzz executor.rs step loop `if:` decisions, taken once at admission
/// against the verified trigger context and frozen into the run. A false
/// condition skips the step; an evaluation error fails the run before any
/// effect (`error`), and later conditions are not evaluated.
#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct StepConditions {
    pub(super) skipped: Vec<String>,
    pub(super) error: Option<String>,
}

pub(super) async fn step_conditions(action: &Value, context: &TriggerContext) -> StepConditions {
    let mut decisions = StepConditions::default();
    for step in action["steps"].as_array().into_iter().flatten() {
        let (Some(id), Some(expression)) = (step["id"].as_str(), step.get("if")) else {
            continue;
        };
        match expression.as_str() {
            Some(expression) => match evaluate(expression.to_owned(), context.clone()).await {
                Some(true) => {}
                Some(false) => decisions.skipped.push(id.to_owned()),
                None => {
                    decisions.error = Some(id.to_owned());
                    break;
                }
            },
            None => {
                decisions.error = Some(id.to_owned());
                break;
            }
        }
    }
    decisions
}

impl StepConditions {
    /// Freeze the decisions into the run's ActionExecution parameters.
    pub(super) fn freeze(&self, parameters: &mut Value) {
        if !self.skipped.is_empty() {
            parameters["automationSkippedSteps"] = serde_json::json!(self.skipped);
        }
        if let Some(step) = &self.error {
            parameters["automationStepConditionError"] = serde_json::json!(step);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};
    use serde_json::json;

    fn event(text: &str, tags: Vec<Tag>) -> Event {
        EventBuilder::new(Kind::Custom(9), text)
            .tags(tags)
            .sign_with_keys(&Keys::generate())
            .unwrap()
    }

    #[tokio::test]
    async fn step_conditions_freeze_skips_and_stop_at_the_first_error() {
        let context = event_context(Uuid::new_v4(), &event("deploy now", vec![]), None);
        let action = json!({"steps":[
            {"id":"keep","if":"str_contains(trigger_text, \"deploy\")","action":"delay","duration":"1s"},
            {"id":"skip","if":"trigger_is_reply","action":"send_message","text":"x"},
            {"id":"plain","action":"send_message","text":"y"}]});
        let decisions = step_conditions(&action, &context).await;
        assert_eq!(
            decisions,
            StepConditions {
                skipped: vec!["skip".into()],
                error: None
            }
        );
        let mut parameters = json!({});
        decisions.freeze(&mut parameters);
        assert_eq!(parameters, json!({"automationSkippedSteps":["skip"]}));
        let failing = json!({"steps":[
            {"id":"bad","if":"str_len(trigger_text, trigger_text) > 0","action":"delay","duration":"1s"},
            {"id":"later","if":"false","action":"send_message","text":"z"}]});
        let decisions = step_conditions(&failing, &context).await;
        assert_eq!(
            decisions,
            StepConditions {
                skipped: vec![],
                error: Some("bad".into())
            }
        );
        let mut parameters = json!({});
        decisions.freeze(&mut parameters);
        assert_eq!(parameters, json!({"automationStepConditionError":"bad"}));
        assert_eq!(
            step_conditions(&json!({"kind":"AGENT_TURN"}), &context).await,
            StepConditions::default()
        );
    }

    #[tokio::test]
    async fn original_text_operators_match_real_content() {
        let event = event("deploy 演示", vec![]);
        let channel = Uuid::new_v4();
        for (filter, expected) in [
            (r#"str_contains(trigger_text, "演示")"#, true),
            (r#"!str_contains(trigger_text, "演示")"#, false),
            (r#"str_starts_with(trigger_text, "deploy")"#, true),
            (r#"str_ends_with(trigger_text, "演示")"#, true),
            (r#"trigger_text == "deploy 演示""#, true),
            (r#"trigger_text != "deploy 演示""#, false),
            ("str_len(trigger_text) > 0", true),
            ("str_len(trigger_text) == 0", false),
        ] {
            assert_eq!(
                matches(&json!({"filter":filter}), channel, &event, None)
                    .await
                    .unwrap(),
                expected,
                "{filter}"
            );
        }
        assert!(matches(&json!({}), channel, &event, None).await.unwrap());
    }

    #[tokio::test]
    async fn original_context_uses_signer_native_channel_and_valid_nip10_reply() {
        let forged_actor = "f".repeat(64);
        let event = event(
            "hello",
            vec![
                Tag::parse(["actor", &forged_actor]).unwrap(),
                Tag::parse(["e", &"a".repeat(64), "", "reply"]).unwrap(),
            ],
        );
        let channel = Uuid::new_v4();
        let filter = format!(
            "trigger_author == \"{}\" && trigger_channel_id == \"{}\" && trigger_message_id == \"{}\" && trigger_timestamp == \"{}\" && trigger_is_reply",
            event.pubkey.to_hex(), channel, event.id.to_hex(), event.created_at.as_secs(),
        );
        assert!(matches(&json!({"filter":filter}), channel, &event, None)
            .await
            .unwrap());
        assert!(!matches(
            &json!({"filter":format!("trigger_author == \"{forged_actor}\"")}),
            channel,
            &event,
            None
        )
        .await
        .unwrap());
        assert!(
            !matches(&json!({"filter":filter}), Uuid::new_v4(), &event, None)
                .await
                .unwrap()
        );
        for tags in [
            vec![Tag::parse(["e", &"a".repeat(64), "", "root"]).unwrap()],
            vec![Tag::parse(["e", "bad", "", "reply"]).unwrap()],
        ] {
            let event = super::tests::event("hello", tags);
            assert!(matches(
                &json!({"filter":"!trigger_is_reply"}),
                channel,
                &event,
                None
            )
            .await
            .unwrap());
        }
    }

    #[tokio::test]
    async fn reaction_context_exposes_emoji_and_reacted_message() {
        // Fixed Buzz build_trigger_context: emoji = reaction content,
        // message_id = NIP-25 reacted message, not the reaction event.
        let target = "c".repeat(64);
        let event = event("🚀", vec![Tag::parse(["e", &target]).unwrap()]);
        let channel = Uuid::new_v4();
        let filter = format!(
            "trigger_emoji == \"🚀\" && trigger_message_id == \"{target}\" && trigger_text == \"🚀\""
        );
        assert!(
            matches(&json!({"filter":filter}), channel, &event, Some(&target))
                .await
                .unwrap()
        );
        let reaction_id = format!("trigger_message_id == \"{}\"", event.id.to_hex());
        assert!(!matches(
            &json!({"filter":reaction_id}),
            channel,
            &event,
            Some(&target)
        )
        .await
        .unwrap());
        assert!(!matches(
            &json!({"filter":"trigger_emoji == \"🚀\""}),
            channel,
            &event,
            None
        )
        .await
        .unwrap());
    }

    #[tokio::test]
    async fn expression_errors_never_admit_a_trigger() {
        let event = event("private source", vec![]);
        for filter in ["unknown_trigger_field", "@@@", "trigger_text", "1 / 0 > 2"] {
            assert!(
                !matches(&json!({"filter":filter}), Uuid::new_v4(), &event, None)
                    .await
                    .unwrap()
            );
        }
        for filter in [
            json!(null),
            json!(""),
            json!("   "),
            json!("x".repeat(4097)),
            json!("界".repeat(1366)),
            json!("(true &&"),
        ] {
            assert!(validate(&filter).is_err(), "{filter}");
        }
    }
}
