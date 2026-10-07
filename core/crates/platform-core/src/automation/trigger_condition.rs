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

pub(super) async fn matches(
    trigger: &Value,
    channel: Uuid,
    event: &Event,
) -> Result<bool, Refusal> {
    let Some(filter) = trigger.get("filter") else {
        return Ok(true);
    };
    let expression = validate(filter)?.to_owned();
    // Same fields as fixed Buzz lib.rs::build_trigger_context/event_is_reply.
    // The caller has verified the event, channel and current HUMAN binding.
    let context = TriggerContext {
        text: event.content.clone(),
        author: event.pubkey.to_hex(),
        channel_id: channel.to_string(),
        timestamp: event.created_at.as_secs().to_string(),
        message_id: event.id.to_hex(),
        is_reply: collab_bridge::nip10::parse_thread_markers(&event.tags)
            .reply
            .is_some(),
        ..Default::default()
    };
    // 100ms is the fixed upstream executor::EVAL_TIMEOUT, not a new setting.
    let result = tokio::time::timeout(
        workflow_condition::EVAL_TIMEOUT,
        tokio::task::spawn_blocking(move || {
            workflow_condition::evaluate_condition(&expression, &context, &Default::default())
        }),
    )
    .await;
    match result {
        Ok(Ok(Ok(matched))) => Ok(matched),
        _ => {
            // Original trigger filters skip on evaluation errors/timeouts.
            // Do not log expression diagnostics which can contain source text.
            tracing::warn!("automation trigger condition could not be evaluated; skipping event");
            Ok(false)
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
                matches(&json!({"filter":filter}), channel, &event)
                    .await
                    .unwrap(),
                expected,
                "{filter}"
            );
        }
        assert!(matches(&json!({}), channel, &event).await.unwrap());
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
        assert!(matches(&json!({"filter":filter}), channel, &event)
            .await
            .unwrap());
        assert!(!matches(
            &json!({"filter":format!("trigger_author == \"{forged_actor}\"")}),
            channel,
            &event
        )
        .await
        .unwrap());
        assert!(!matches(&json!({"filter":filter}), Uuid::new_v4(), &event)
            .await
            .unwrap());
        for tags in [
            vec![Tag::parse(["e", &"a".repeat(64), "", "root"]).unwrap()],
            vec![Tag::parse(["e", "bad", "", "reply"]).unwrap()],
        ] {
            let event = super::tests::event("hello", tags);
            assert!(
                matches(&json!({"filter":"!trigger_is_reply"}), channel, &event)
                    .await
                    .unwrap()
            );
        }
    }

    #[tokio::test]
    async fn expression_errors_never_admit_a_trigger() {
        let event = event("private source", vec![]);
        for filter in ["unknown_trigger_field", "@@@", "trigger_text", "1 / 0 > 2"] {
            assert!(!matches(&json!({"filter":filter}), Uuid::new_v4(), &event)
                .await
                .unwrap());
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
