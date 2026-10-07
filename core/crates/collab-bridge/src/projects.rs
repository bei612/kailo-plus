//! Original Buzz project creation templates and coordinate deletion, fixed at
//! 779af8886caae1317b4de962082429867ab61503:
//! desktop/src/features/projects/projectCreation.ts::buildProjectBootstrapTemplates
//! desktop/src/features/projects/projectDeletion.ts::deleteProject.
use crate::operator::OperatorError;
use contracts::ProjectsPublishRequest;
use nostr::{Event, EventBuilder, Tag, Timestamp};

fn invalid(message: &str) -> OperatorError {
    OperatorError::Sign(message.to_owned())
}

/// Read-only receipt for the exact persisted publication, not merely a JSON id.
/// Missing replaceable events remain unobservable; they never prove rejection.
pub fn publication_observed(
    page: serde_json::Value,
    event_id: &str,
    author: &str,
    expected_kind: i32,
) -> Result<bool, OperatorError> {
    let unverified =
        || OperatorError::NotConverged("Project publication evidence is invalid".into());
    if !matches!(expected_kind, 5 | 30617 | 30621) {
        return Err(unverified());
    }
    let events: Vec<Event> = serde_json::from_value(page).map_err(|_| unverified())?;
    match events.as_slice() {
        [] => Ok(false),
        [event]
            if event.id.to_hex() == event_id
                && event.pubkey.to_hex() == author
                && i32::from(event.kind.as_u16()) == expected_kind
                && event.verify().is_ok() =>
        {
            Ok(true)
        }
        _ => Err(unverified()),
    }
}

/// Original projectCreation.ts::projectDtagFromName. The slug is a native
/// coordinate, not a new platform project identifier.
pub fn project_dtag(name: &str) -> String {
    name.to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .map(str::to_ascii_lowercase)
        .collect::<Vec<_>>()
        .join("-")
}

pub fn publication_kind(request: &ProjectsPublishRequest) -> Result<u16, OperatorError> {
    let operation = serde_json::to_value(&request.operation)
        .map_err(|_| invalid("invalid project operation"))?;
    match operation.as_str() {
        Some("DELETE")
            if request.target_event_id.as_deref().is_some_and(|id| {
                nostr::EventId::from_hex(id).is_ok_and(|parsed| parsed.to_hex() == id)
            }) && request.workspace_id.is_none()
                && request.name.is_none()
                && request.description.is_none()
                && request.visibility.is_none() =>
        {
            Ok(5)
        }
        Some("CREATE_PROJECT" | "CREATE_REPOSITORY") => {
            static LIMITS: std::sync::LazyLock<Option<(u64, u64)>> =
                std::sync::LazyLock::new(|| {
                    let schema: serde_json::Value = serde_json::from_str(include_str!(
                        "../../../../contracts/api/projects_publish_request.schema.json"
                    ))
                    .ok()?;
                    Some((
                        schema["properties"]["name"]["maxLength"].as_u64()?,
                        schema["properties"]["description"]["maxLength"].as_u64()?,
                    ))
                });
            let (name_limit, description_limit) = LIMITS
                .as_ref()
                .ok_or_else(|| invalid("project limits unavailable"))?;
            let name = request
                .name
                .as_deref()
                .ok_or_else(|| invalid("project name missing"))?
                .trim();
            // Contract supplies the bounds; the original SDK counts UTF-8 bytes.
            if request.target_event_id.is_some()
                || request
                    .workspace_id
                    .as_deref()
                    .is_none_or(|value| uuid::Uuid::parse_str(value).is_err())
                || name.is_empty()
                || name.len() as u64 > *name_limit
                || project_dtag(name).is_empty()
                || request
                    .description
                    .as_deref()
                    .unwrap_or_default()
                    .trim()
                    .len() as u64
                    > *description_limit
            {
                return Err(invalid("invalid project creation"));
            }
            if operation.as_str() == Some("CREATE_PROJECT") {
                if !request.visibility.as_ref().is_some_and(|value| {
                    serde_json::to_value(value)
                        .is_ok_and(|value| matches!(value.as_str(), Some("listed" | "unlisted")))
                }) {
                    return Err(invalid("project visibility missing"));
                }
                Ok(30621)
            } else if request.visibility.is_none() {
                Ok(30617)
            } else {
                Err(invalid("repository visibility is not supported"))
            }
        }
        _ => Err(invalid("unsupported project operation")),
    }
}

pub fn publication_builder(
    request: &ProjectsPublishRequest,
    target: Option<&Event>,
    channel_id: Option<&str>,
    owner: &str,
) -> Result<EventBuilder, OperatorError> {
    let kind = publication_kind(request)?;
    if kind != 5 {
        let channel = channel_id
            .filter(|value| uuid::Uuid::parse_str(value).is_ok_and(|id| id.to_string() == *value))
            .ok_or_else(|| invalid("project home channel unavailable"))?;
        if nostr::PublicKey::from_hex(owner).map_or(true, |key| key.to_hex() != owner)
            || target.is_some()
        {
            return Err(invalid("invalid project creation identity"));
        }
        let name = request.name.as_deref().unwrap_or_default().trim();
        let description = request.description.as_deref().unwrap_or_default().trim();
        let slug = project_dtag(name);
        let mut tags = vec![
            vec!["d".to_owned(), slug.clone()],
            vec!["name".to_owned(), name.to_owned()],
            vec!["buzz-channel".to_owned(), channel.to_owned()],
        ];
        if !description.is_empty() {
            tags.push(vec!["description".to_owned(), description.to_owned()]);
        }
        if kind == 30621 {
            if request.visibility.as_ref().is_some_and(|value| {
                serde_json::to_value(value).is_ok_and(|value| value.as_str() == Some("unlisted"))
            }) {
                tags.push(vec!["buzz-visibility".to_owned(), "unlisted".to_owned()]);
            }
            tags.push(vec!["a".to_owned(), format!("30617:{owner}:{slug}")]);
        }
        let tags = tags
            .into_iter()
            .map(Tag::parse)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| invalid("invalid project tags"))?;
        return if kind == 30621 {
            buzz_sdk::build_project_with_tags("", tags)
        } else {
            buzz_sdk::build_repo_announcement_with_tags(&slug, description, tags)
        }
        .map_err(|error| invalid(&error.to_string()));
    }
    let event = target.ok_or_else(|| invalid("project deletion target missing"))?;
    if request.target_event_id.as_deref() != Some(event.id.to_hex().as_str())
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
    fn publication_receipt_verifies_frozen_actor_kind_hash_and_signature() {
        let keys = Keys::generate();
        for kind in [5, 30617, 30621] {
            let event = EventBuilder::new(nostr::Kind::from(kind as u16), "original")
                .sign_with_keys(&keys)
                .unwrap();
            let id = event.id.to_hex();
            let actor = keys.public_key().to_hex();
            assert!(publication_observed(json!([event]), &id, &actor, kind).unwrap());
            assert!(!publication_observed(json!([]), &id, &actor, kind).unwrap());
            assert!(publication_observed(json!([{"id":id}]), &id, &actor, kind).is_err());
            assert!(publication_observed(json!([event, event]), &id, &actor, kind).is_err());
            assert!(publication_observed(json!([event]), &"a".repeat(64), &actor, kind).is_err());
            assert!(publication_observed(
                json!([event]),
                &id,
                &Keys::generate().public_key().to_hex(),
                kind
            )
            .is_err());
            assert!(publication_observed(
                json!([event]),
                &id,
                &actor,
                if kind == 5 { 30621 } else { 5 }
            )
            .is_err());
            assert!(publication_observed(json!([event]), &id, &actor, 9).is_err());
            let mut forged = event.clone();
            forged.content = "replaced while keeping id and signature".into();
            assert!(publication_observed(json!([forged]), &id, &actor, kind).is_err());
            let mut forged_signature = event.clone();
            forged_signature.sig = EventBuilder::new(nostr::Kind::from(kind as u16), "other")
                .sign_with_keys(&Keys::generate())
                .unwrap()
                .sig;
            assert!(publication_observed(json!([forged_signature]), &id, &actor, kind).is_err());
        }
    }

    #[test]
    fn original_bootstrap_uses_the_real_home_and_signer_for_both_announcements() {
        let owner = Keys::generate();
        let channel = uuid::Uuid::new_v4().to_string();
        for (operation, kind, visibility) in [
            ("CREATE_PROJECT", 30621, Some("listed")),
            ("CREATE_PROJECT", 30621, Some("unlisted")),
            ("CREATE_REPOSITORY", 30617, None),
        ] {
            let mut raw = json!({"operation":operation,"workspaceId":channel,"name":"  My Garden!  ","description":"  Seeds  "});
            if let Some(visibility) = visibility {
                raw["visibility"] = json!(visibility);
            }
            let request: ProjectsPublishRequest = serde_json::from_value(raw).unwrap();
            let event =
                publication_builder(&request, None, Some(&channel), &owner.public_key().to_hex())
                    .unwrap()
                    .sign_with_keys(&owner)
                    .unwrap();
            assert_eq!(event.kind.as_u16(), kind);
            assert_eq!(event.pubkey, owner.public_key());
            assert_eq!(event.content, if kind == 30621 { "" } else { "Seeds" });
            let mut expected = vec![
                vec!["d".to_owned(), "my-garden".to_owned()],
                vec!["name".to_owned(), "My Garden!".to_owned()],
                vec!["buzz-channel".to_owned(), channel.clone()],
                vec!["description".to_owned(), "Seeds".to_owned()],
            ];
            if visibility == Some("unlisted") {
                expected.push(vec!["buzz-visibility".to_owned(), "unlisted".to_owned()]);
            }
            if kind == 30621 {
                expected.push(vec![
                    "a".to_owned(),
                    format!("30617:{}:my-garden", owner.public_key()),
                ]);
            }
            assert_eq!(
                event
                    .tags
                    .iter()
                    .map(|tag| tag.as_slice().to_vec())
                    .collect::<Vec<_>>(),
                expected
            );
            assert!(
                publication_builder(&request, None, None, &owner.public_key().to_hex()).is_err()
            );
            assert!(publication_builder(
                &request,
                None,
                Some("not-a-channel"),
                &owner.public_key().to_hex()
            )
            .is_err());
            assert!(publication_builder(
                &request,
                Some(&event),
                Some(&channel),
                &owner.public_key().to_hex()
            )
            .is_err());
        }
    }

    #[test]
    fn semantic_creation_rejects_mixed_intents_and_original_byte_limit_violations() {
        let valid = json!({"operation":"CREATE_PROJECT","workspaceId":uuid::Uuid::new_v4().to_string(),"name":"Garden","visibility":"listed"});
        for (field, value) in [
            ("name", json!("")),
            ("name", json!("中文")),
            ("name", json!(format!("a{}", "界".repeat(86)))),
            ("description", json!("界".repeat(683))),
            ("workspaceId", json!("not-a-workspace")),
            ("targetEventId", json!("a".repeat(64))),
        ] {
            let mut raw = valid.clone();
            raw[field] = value;
            let request = serde_json::from_value(raw).unwrap();
            assert!(publication_kind(&request).is_err(), "field {field}");
        }
        let mut raw = valid.clone();
        raw.as_object_mut().unwrap().remove("visibility");
        assert!(publication_kind(&serde_json::from_value(raw).unwrap()).is_err());
        let mut raw = valid.clone();
        raw["operation"] = json!("CREATE_REPOSITORY");
        assert!(publication_kind(&serde_json::from_value(raw).unwrap()).is_err());
        let mut raw = valid;
        raw["operation"] = json!("DELETE");
        raw["targetEventId"] = json!("a".repeat(64));
        assert!(publication_kind(&serde_json::from_value(raw).unwrap()).is_err());
        assert!(
            serde_json::from_value::<ProjectsPublishRequest>(json!({"operation":"UNKNOWN"}))
                .is_err()
        );
        assert_eq!(project_dtag(" My___New 世界 Garden! "), "my-new-garden");
        assert_eq!(project_dtag("Kelvin İdea"), "kelvin-i-dea");
    }

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
        let deletion =
            publication_builder(&request, Some(&event), None, &keys.public_key().to_hex())
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
        assert!(publication_builder(&request, None, None, &keys.public_key().to_hex()).is_err());
        let mut wrong = request;
        wrong.target_event_id = Some("a".repeat(64));
        assert!(
            publication_builder(&wrong, Some(&event), None, &keys.public_key().to_hex()).is_err()
        );
    }
}
