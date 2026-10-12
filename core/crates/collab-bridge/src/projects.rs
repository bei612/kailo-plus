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
    if !matches!(expected_kind, 5 | 1621 | 30617 | 30621) {
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
    if operation.as_str() != Some("CREATE_ISSUE")
        && (request.title.is_some() || request.body.is_some() || request.category.is_some())
    {
        return Err(invalid("issue fields on another project operation"));
    }
    match operation.as_str() {
        Some("CREATE_ISSUE") => {
            let schema: serde_json::Value = serde_json::from_str(include_str!(
                "../../../../contracts/api/projects_publish_request.schema.json"
            ))
            .map_err(|_| invalid("issue limits unavailable"))?;
            let limit = schema["properties"]["title"]["maxLength"]
                .as_u64()
                .ok_or_else(|| invalid("issue limits unavailable"))?;
            let title = request
                .title
                .as_deref()
                .ok_or_else(|| invalid("issue title missing"))?
                .trim();
            if title.is_empty()
                || title.encode_utf16().count() as u64 > limit
                || request.body.is_none()
                || !request.target_event_id.as_deref().is_some_and(|id| {
                    nostr::EventId::from_hex(id).is_ok_and(|parsed| parsed.to_hex() == id)
                })
                || request.workspace_id.is_some()
                || request.name.is_some()
                || request.description.is_some()
                || request.visibility.is_some()
                || !request.category.as_ref().is_some_and(|category| {
                    serde_json::to_value(category).is_ok_and(|value| {
                        matches!(
                            value.as_str(),
                            Some("issue" | "change-request" | "improvement")
                        )
                    })
                })
            {
                return Err(invalid("invalid issue creation"));
            }
            Ok(1621)
        }
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
    if kind == 1621 {
        let event = target.ok_or_else(|| invalid("issue repository missing"))?;
        if channel_id.is_some()
            || nostr::PublicKey::from_hex(owner).map_or(true, |key| key.to_hex() != owner)
            || request.target_event_id.as_deref() != Some(event.id.to_hex().as_str())
            || event.kind.as_u16() != 30617
            || event.verify().is_err()
        {
            return Err(invalid("invalid issue repository evidence"));
        }
        let slug = event
            .tags
            .identifier()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| invalid("issue repository coordinate missing"))?;
        let category = serde_json::to_value(&request.category)
            .map_err(|_| invalid("invalid issue category"))?;
        let tags = vec![
            vec![
                "a".to_owned(),
                format!("30617:{}:{slug}", event.pubkey.to_hex()),
            ],
            vec!["p".to_owned(), event.pubkey.to_hex()],
            vec![
                "subject".to_owned(),
                request
                    .title
                    .as_deref()
                    .unwrap_or_default()
                    .trim()
                    .to_owned(),
            ],
            vec![
                "t".to_owned(),
                category
                    .as_str()
                    .ok_or_else(|| invalid("issue category missing"))?
                    .to_owned(),
            ],
        ]
        .into_iter()
        .map(Tag::parse)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| invalid("invalid issue tags"))?;
        // Fixed desktop buildGitIssueTags counts UTF-16, unlike SDK's byte limit.
        // Body bounds come from current Relay admission, not SDK's static limit.
        return Ok(EventBuilder::new(
            nostr::Kind::from(kind),
            request.body.as_deref().unwrap_or_default().trim(),
        )
        .tags(tags));
    }
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

/// Compare the original accepted issue, without requiring its replaceable repo
/// head to remain current. Core separately checks the persisted parent event id.
pub fn issue_publication_matches(
    request: &ProjectsPublishRequest,
    event: &Event,
) -> Result<bool, OperatorError> {
    if publication_kind(request)? != 1621 || event.kind.as_u16() != 1621 || event.verify().is_err()
    {
        return Err(invalid("invalid issue publication evidence"));
    }
    let tags = event
        .tags
        .iter()
        .map(|tag| tag.as_slice())
        .collect::<Vec<_>>();
    let [address, recipient, subject, category] = tags.as_slice() else {
        return Ok(false);
    };
    if address.len() != 2
        || recipient.len() != 2
        || subject.len() != 2
        || category.len() != 2
        || address[0] != "a"
        || recipient[0] != "p"
        || subject[0] != "subject"
        || category[0] != "t"
    {
        return Ok(false);
    }
    let mut coordinate = address[1].splitn(3, ':');
    let Some(kind) = coordinate.next() else {
        return Ok(false);
    };
    let Some(owner) = coordinate.next() else {
        return Ok(false);
    };
    let Some(slug) = coordinate.next() else {
        return Ok(false);
    };
    if kind != "30617"
        || slug.is_empty()
        || recipient[1] != owner
        || nostr::PublicKey::from_hex(owner).map_or(true, |key| key.to_hex() != owner)
    {
        return Ok(false);
    }
    let requested_category =
        serde_json::to_value(&request.category).map_err(|_| invalid("invalid issue category"))?;
    Ok(
        event.content == request.body.as_deref().unwrap_or_default().trim()
            && subject[1] == request.title.as_deref().unwrap_or_default().trim()
            && Some(category[1].as_str()) == requested_category.as_str(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{Keys, Tag};
    use serde_json::json;

    #[test]
    fn publication_receipt_verifies_frozen_actor_kind_hash_and_signature() {
        let keys = Keys::generate();
        for kind in [5, 1621, 30617, 30621] {
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
    fn original_issue_creation_uses_verified_repository_and_distinct_signer() {
        let repo_owner = Keys::generate();
        let actor = Keys::generate();
        let repo = EventBuilder::new(nostr::Kind::from(30617), "repository")
            .tags([Tag::parse(["d", "garden"]).unwrap()])
            .sign_with_keys(&repo_owner)
            .unwrap();
        for category in ["issue", "change-request", "improvement"] {
            for body in ["", "  Markdown body  "] {
                let request: ProjectsPublishRequest = serde_json::from_value(json!({
                    "operation":"CREATE_ISSUE", "targetEventId":repo.id.to_hex(),
                    "title":"  任务 🪴  ", "body":body, "category":category
                }))
                .unwrap();
                let event =
                    publication_builder(&request, Some(&repo), None, &actor.public_key().to_hex())
                        .unwrap()
                        .sign_with_keys(&actor)
                        .unwrap();
                assert_eq!(event.kind.as_u16(), 1621);
                assert_eq!(event.pubkey, actor.public_key());
                assert_eq!(event.content, body.trim());
                assert_eq!(
                    event
                        .tags
                        .iter()
                        .map(|tag| tag.as_slice().to_vec())
                        .collect::<Vec<_>>(),
                    vec![
                        vec![
                            "a".to_owned(),
                            format!("30617:{}:garden", repo_owner.public_key())
                        ],
                        vec!["p".to_owned(), repo_owner.public_key().to_hex()],
                        vec!["subject".to_owned(), "任务 🪴".to_owned()],
                        vec!["t".to_owned(), category.to_owned()],
                    ]
                );
                assert!(publication_observed(
                    json!([event]),
                    &event.id.to_hex(),
                    &actor.public_key().to_hex(),
                    1621
                )
                .unwrap());
                assert!(issue_publication_matches(&request, &event).unwrap());
                for (field, value) in [
                    ("title", json!("Different")),
                    ("body", json!("Different body")),
                    (
                        "category",
                        json!(if category == "issue" {
                            "improvement"
                        } else {
                            "issue"
                        }),
                    ),
                ] {
                    let mut changed = serde_json::to_value(&request).unwrap();
                    changed[field] = value;
                    assert!(!issue_publication_matches(
                        &serde_json::from_value(changed).unwrap(),
                        &event
                    )
                    .unwrap());
                }
                let mut tampered = event.clone();
                tampered.content = "tampered".into();
                assert!(issue_publication_matches(&request, &tampered).is_err());
                assert!(publication_builder(
                    &request,
                    Some(&repo),
                    Some(&uuid::Uuid::new_v4().to_string()),
                    &actor.public_key().to_hex()
                )
                .is_err());
                assert!(
                    publication_builder(&request, None, None, &actor.public_key().to_hex())
                        .is_err()
                );
                let mut forged = repo.clone();
                forged.content = "forged".into();
                assert!(publication_builder(
                    &request,
                    Some(&forged),
                    None,
                    &actor.public_key().to_hex()
                )
                .is_err());
                let mut wrong_id = request.clone();
                wrong_id.target_event_id = Some("a".repeat(64));
                assert!(publication_builder(
                    &wrong_id,
                    Some(&repo),
                    None,
                    &actor.public_key().to_hex()
                )
                .is_err());
                let wrong_kind = EventBuilder::new(nostr::Kind::from(30621), "")
                    .tags([Tag::parse(["d", "garden"]).unwrap()])
                    .sign_with_keys(&repo_owner)
                    .unwrap();
                wrong_id.target_event_id = Some(wrong_kind.id.to_hex());
                assert!(publication_builder(
                    &wrong_id,
                    Some(&wrong_kind),
                    None,
                    &actor.public_key().to_hex()
                )
                .is_err());
            }
        }
        for tags in [vec![], vec![Tag::parse(["d", ""]).unwrap()]] {
            let missing = EventBuilder::new(nostr::Kind::from(30617), "")
                .tags(tags)
                .sign_with_keys(&repo_owner)
                .unwrap();
            let request = serde_json::from_value(json!({"operation":"CREATE_ISSUE","targetEventId":missing.id.to_hex(),"title":"Title","body":"","category":"issue"})).unwrap();
            assert!(publication_builder(
                &request,
                Some(&missing),
                None,
                &actor.public_key().to_hex()
            )
            .is_err());
        }
    }

    #[test]
    fn issue_creation_rejects_mixed_intents_and_counts_original_utf16_subject() {
        let valid = json!({"operation":"CREATE_ISSUE","targetEventId":"a".repeat(64),"title":"Title","body":"","category":"issue"});
        for field in ["title", "body", "category", "targetEventId"] {
            let mut raw = valid.clone();
            raw.as_object_mut().unwrap().remove(field);
            assert!(
                publication_kind(&serde_json::from_value(raw).unwrap()).is_err(),
                "missing {field}"
            );
        }
        for (field, value) in [
            ("title", json!("  ")),
            ("title", json!("🪴".repeat(129))),
            ("workspaceId", json!(uuid::Uuid::new_v4().to_string())),
            ("name", json!("name")),
            ("description", json!("description")),
            ("visibility", json!("listed")),
            ("targetEventId", json!("A".repeat(64))),
        ] {
            let mut raw = valid.clone();
            raw[field] = value;
            assert!(
                publication_kind(&serde_json::from_value(raw).unwrap()).is_err(),
                "invalid {field}"
            );
        }
        for title in ["界".repeat(256), "🪴".repeat(128)] {
            let mut raw = valid.clone();
            raw["title"] = json!(title);
            assert_eq!(
                publication_kind(&serde_json::from_value(raw).unwrap()).unwrap(),
                1621
            );
        }
        for operation in ["DELETE", "CREATE_PROJECT", "CREATE_REPOSITORY"] {
            for (field, value) in [
                ("title", json!("Title")),
                ("body", json!("")),
                ("category", json!("issue")),
            ] {
                let mut raw = if operation == "DELETE" {
                    json!({"operation":operation,"targetEventId":"a".repeat(64)})
                } else {
                    json!({"operation":operation,"workspaceId":uuid::Uuid::new_v4().to_string(),"name":"Garden"})
                };
                if operation == "CREATE_PROJECT" {
                    raw["visibility"] = json!("listed");
                }
                raw[field] = value;
                assert!(publication_kind(&serde_json::from_value(raw).unwrap()).is_err());
            }
        }
        let mut raw = valid;
        raw["category"] = json!("other");
        assert!(serde_json::from_value::<ProjectsPublishRequest>(raw).is_err());
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
