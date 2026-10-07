//! Original projectDeletion.ts::deleteProject, Buzz
//! 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/projectDeletion.ts.
use crate::operator::OperatorError;
use contracts::ProjectsPublishRequest;
use nostr::{Event, EventBuilder, Timestamp};

fn invalid(message: &str) -> OperatorError {
    OperatorError::Sign(message.to_owned())
}

pub fn publication_builder(
    request: &ProjectsPublishRequest,
    target: Option<&Event>,
) -> Result<EventBuilder, OperatorError> {
    if serde_json::to_value(&request.operation)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .as_deref()
        != Some("DELETE")
    {
        return Err(invalid("unsupported project operation"));
    }
    let event = target.ok_or_else(|| invalid("project deletion target missing"))?;
    if request.target_event_id != event.id.to_hex()
        || !matches!(event.kind.as_u16(), 30621 | 30617)
        || event.verify().is_err()
    {
        return Err(invalid("invalid project deletion target"));
    }
    // Relay decides its immutable author/NIP-OA owner relation, never an
    // editable profile or a Human alias joining distinct device key owners.
    let slug = event
        .tags
        .identifier()
        .ok_or_else(|| invalid("project coordinate missing"))?;
    let timestamp = event
        .created_at
        .as_secs()
        .checked_add(1)
        .ok_or_else(|| invalid("project timestamp overflow"))?
        .max(Timestamp::now().as_secs());
    buzz_sdk::build_delete_addressable(u32::from(event.kind.as_u16()), &event.pubkey.to_hex(), slug)
        .map(|builder| builder.custom_created_at(Timestamp::from_secs(timestamp)))
        .map_err(|error| invalid(&error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{Keys, Tag};
    use serde_json::json;

    #[test]
    fn project_tombstone_targets_only_real_head_and_dominates_its_time() {
        let keys = Keys::generate();
        let event =
            buzz_sdk::build_project_with_tags("", vec![Tag::parse(["d", "garden"]).unwrap()])
                .unwrap()
                .sign_with_keys(&keys)
                .unwrap();
        let request: ProjectsPublishRequest =
            serde_json::from_value(json!({"operation":"DELETE","targetEventId":event.id.to_hex()}))
                .unwrap();
        let deletion = publication_builder(&request, Some(&event))
            .unwrap()
            .sign_with_keys(&keys)
            .unwrap();
        assert_eq!(deletion.kind.as_u16(), 5);
        assert_eq!(deletion.tags.len(), 1);
        assert_eq!(
            deletion.tags.iter().next().unwrap().as_slice(),
            ["a", &format!("30621:{}:garden", keys.public_key())]
        );
        assert!(deletion.created_at > event.created_at);
        assert!(publication_builder(&request, None).is_err());
        let mut wrong = request;
        wrong.target_event_id = "a".repeat(64);
        assert!(publication_builder(&wrong, Some(&event)).is_err());
    }
}
