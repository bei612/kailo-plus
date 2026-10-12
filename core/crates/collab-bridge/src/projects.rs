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

fn canonical_event_id(id: &str) -> bool {
    nostr::EventId::from_hex(id).is_ok_and(|parsed| parsed.to_hex() == id)
}

pub fn is_self_assignment(request: &ProjectsPublishRequest) -> bool {
    serde_json::to_value(&request.operation).is_ok_and(|value| {
        matches!(
            value.as_str(),
            Some("SELF_ASSIGN_ISSUE" | "SELF_UNASSIGN_ISSUE")
        )
    })
}

pub fn is_other_assignment(request: &ProjectsPublishRequest) -> bool {
    serde_json::to_value(&request.operation)
        .is_ok_and(|value| matches!(value.as_str(), Some("ASSIGN_ISSUE" | "UNASSIGN_ISSUE")))
}

pub fn is_assignment(request: &ProjectsPublishRequest) -> bool {
    is_self_assignment(request) || is_other_assignment(request)
}

/// Fixed issueAssignments.ts uses a display label only. Self p tags come from
/// the authenticated signer; other p tags identify the admitted HUMAN recipient,
/// never a client-selected signing identity.
pub fn assignment_content(request: &ProjectsPublishRequest) -> Result<String, OperatorError> {
    publication_kind(request)?;
    let label = request.assignee_label.as_deref().unwrap_or_default().trim();
    match serde_json::to_value(&request.operation)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .as_deref()
    {
        Some("SELF_ASSIGN_ISSUE" | "ASSIGN_ISSUE") => Ok(format!("Assigned this task to {label}")),
        Some("SELF_UNASSIGN_ISSUE" | "UNASSIGN_ISSUE") => {
            Ok(format!("Unassigned {label} from this task"))
        }
        _ => Err(invalid("not a self assignment")),
    }
}

fn assignment_tags(
    request: &ProjectsPublishRequest,
    issue: &Event,
    owner: &str,
) -> Result<Vec<Tag>, OperatorError> {
    assignment_content(request)?;
    if issue.kind.as_u16() != 1621
        || request.target_event_id.as_deref() != Some(issue.id.to_hex().as_str())
    {
        return Err(invalid("assignment issue mismatch"));
    }
    let repository = comment_repository(issue)?;
    let assignee = if is_other_assignment(request) {
        let recipient = request
            .assignee_pubkey
            .as_deref()
            .ok_or_else(|| invalid("assignee missing"))?;
        // Original authoritative operations are signed by the issue author or
        // repository owner themselves. No client-provided signing identity.
        if recipient == owner
            || (owner != issue.pubkey.to_hex() && Some(owner) != repository.split(':').nth(1))
        {
            return Err(invalid(
                "other assignment requires original author or repository owner",
            ));
        }
        recipient
    } else {
        owner
    };
    let operation =
        serde_json::to_value(&request.operation).map_err(|_| invalid("invalid assignment"))?;
    let label = if matches!(
        operation.as_str(),
        Some("SELF_ASSIGN_ISSUE" | "ASSIGN_ISSUE")
    ) {
        "assignment"
    } else {
        "unassignment"
    };
    let mut tags = vec![
        vec!["e".into(), issue.id.to_hex(), String::new(), "root".into()],
        vec!["a".into(), repository.into()],
        vec!["p".into(), assignee.into()],
        vec!["t".into(), label.into()],
    ];
    if let Some(prior) = &request.prior_event_id {
        tags.push(vec!["prior".into(), prior.clone()]);
    }
    tags.into_iter()
        .map(Tag::parse)
        .collect::<Result<_, _>>()
        .map_err(|_| invalid("invalid assignment tags"))
}

/// Original projectIssues.mjs::assignmentStateForIssue, reduced only for the
/// authenticated assignee. Caller supplies complete, signed same-repository
/// activity, not a filtered short page. No platform assignment state is stored.
pub fn assignment_head(
    issue: &Event,
    events: &[Event],
    owner: &str,
) -> Result<Option<String>, OperatorError> {
    let repository = comment_repository(issue)?;
    let repo_owner = repository.split(':').nth(1).unwrap_or_default();
    let mut events: Vec<_> = events.iter().collect();
    events.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
    let mut groups: [Vec<(&Event, Option<String>)>; 3] = Default::default();
    for event in events {
        if !comment_activity_matches(issue, event, &event.pubkey.to_hex())
            || !event.tags.iter().any(|tag| {
                tag.as_slice().first().is_some_and(|v| v == "e")
                    && tag.as_slice().get(1) == Some(&issue.id.to_hex())
            })
        {
            continue;
        }
        let values = |name: &str| {
            event
                .tags
                .iter()
                .filter_map(move |tag| {
                    let fields = tag.as_slice();
                    (fields.first().is_some_and(|v| v == name))
                        .then(|| fields.get(1))
                        .flatten()
                        .filter(|v| !v.is_empty())
                        .cloned()
                })
                .collect::<Vec<_>>()
        };
        let labels = values("t");
        if labels.iter().any(|v| v == "assignment") == labels.iter().any(|v| v == "unassignment") {
            continue;
        }
        let recipients: Vec<_> = values("p").into_iter().map(|v| v.to_lowercase()).collect();
        if !recipients.iter().any(|v| v == owner) {
            continue;
        }
        let signer = event.pubkey.to_hex();
        if signer == issue.pubkey.to_hex() || signer == repo_owner {
            groups[1].push((event, None));
        } else if recipients.len() == 1 && recipients[0] == signer {
            let prior: Vec<_> = event
                .tags
                .iter()
                .filter(|tag| tag.as_slice().first().is_some_and(|v| v == "prior"))
                .collect();
            if prior.is_empty() {
                groups[0].push((event, None));
            } else if prior.len() == 1 {
                if let Some(id) = prior[0]
                    .as_slice()
                    .get(1)
                    .filter(|id| canonical_event_id(&id.to_lowercase()))
                {
                    groups[2].push((event, Some(id.to_lowercase())));
                }
            }
        }
    }
    let mut head = None;
    for (event, prior) in groups.into_iter().flatten() {
        if prior.is_some() && prior != head {
            continue;
        }
        head = Some(event.id.to_hex());
    }
    Ok(head)
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
    if !matches!(expected_kind, 1 | 5 | 1621 | 30617 | 30621) {
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
    if !is_assignment(request)
        && (request.assignee_label.is_some() || request.prior_event_id.is_some())
    {
        return Err(invalid("assignment fields on another project operation"));
    }
    if !is_other_assignment(request) && request.assignee_pubkey.is_some() {
        return Err(invalid("other assignee on another project operation"));
    }
    if operation.as_str() != Some("CREATE_ISSUE")
        && (request.title.is_some() || request.category.is_some())
        || !matches!(
            operation.as_str(),
            Some("CREATE_ISSUE" | "CREATE_ISSUE_COMMENT" | "CREATE_PULL_REQUEST_COMMENT")
        ) && request.body.is_some()
        || !matches!(
            operation.as_str(),
            Some("CREATE_ISSUE_COMMENT" | "CREATE_PULL_REQUEST_COMMENT")
        ) && (request.mentions.is_some() || request.attachments.is_some())
    {
        return Err(invalid("issue fields on another project operation"));
    }
    match operation.as_str() {
        Some("SELF_ASSIGN_ISSUE" | "SELF_UNASSIGN_ISSUE" | "ASSIGN_ISSUE" | "UNASSIGN_ISSUE") => {
            let label = request.assignee_label.as_deref().unwrap_or_default().trim();
            if is_other_assignment(request)
                && (request.prior_event_id.is_some()
                    || !request.assignee_pubkey.as_deref().is_some_and(|key| {
                        nostr::PublicKey::from_hex(key).is_ok_and(|parsed| parsed.to_hex() == key)
                    }))
            {
                return Err(invalid("invalid other HUMAN assignment"));
            }
            if label.is_empty()
                || label.chars().count() > 128
                || !request
                    .target_event_id
                    .as_deref()
                    .is_some_and(canonical_event_id)
                || request
                    .prior_event_id
                    .as_deref()
                    .is_some_and(|id| !canonical_event_id(id))
                || request.workspace_id.is_some()
                || request.name.is_some()
                || request.description.is_some()
                || request.visibility.is_some()
            {
                return Err(invalid("invalid self assignment"));
            }
            Ok(1)
        }
        Some("CREATE_ISSUE_COMMENT" | "CREATE_PULL_REQUEST_COMMENT") => {
            if request
                .body
                .as_deref()
                .is_none_or(|body| body.trim().is_empty())
                || !request.target_event_id.as_deref().is_some_and(|id| {
                    nostr::EventId::from_hex(id).is_ok_and(|parsed| parsed.to_hex() == id)
                })
                || request.workspace_id.is_some()
                || request.name.is_some()
                || request.description.is_some()
                || request.visibility.is_some()
                || request
                    .mentions
                    .as_deref()
                    .unwrap_or_default()
                    .iter()
                    .any(|key| {
                        nostr::PublicKey::from_hex(key)
                            .map_or(true, |parsed| parsed.to_hex() != *key)
                    })
            {
                return Err(invalid("invalid issue comment"));
            }
            Ok(1)
        }
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
    if kind == 1 {
        return Err(invalid("issue comment requires signed activity evidence"));
    }
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

/// Fixed Buzz hooks.ts::createProjectIssueComment: retain the original root,
/// repository and ordered recipient union. Callers supply only validated media.
pub fn comment_target_kind(request: &ProjectsPublishRequest) -> Result<u16, OperatorError> {
    match serde_json::to_value(&request.operation)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .as_deref()
    {
        Some(
            "CREATE_ISSUE_COMMENT"
            | "SELF_ASSIGN_ISSUE"
            | "SELF_UNASSIGN_ISSUE"
            | "ASSIGN_ISSUE"
            | "UNASSIGN_ISSUE",
        ) => Ok(1621),
        Some("CREATE_PULL_REQUEST_COMMENT") => Ok(1618),
        _ => Err(invalid("invalid comment operation")),
    }
}

pub fn comment_repository(issue: &Event) -> Result<&str, OperatorError> {
    if !matches!(issue.kind.as_u16(), 1618 | 1621) || issue.verify().is_err() {
        return Err(invalid("invalid comment issue"));
    }
    let coordinate = issue
        .tags
        .iter()
        .find(|tag| tag.as_slice().first().is_some_and(|field| field == "a"))
        .and_then(|tag| tag.as_slice().get(1))
        .map(String::as_str)
        .ok_or_else(|| invalid("comment repository missing"))?;
    let mut parts = coordinate.splitn(3, ':');
    if parts.next() != Some("30617")
        || !parts.next().is_some_and(|key| {
            nostr::PublicKey::from_hex(key).is_ok_and(|parsed| parsed.to_hex() == key)
        })
        || parts.next().is_none_or(str::is_empty)
    {
        return Err(invalid("invalid comment repository"));
    }
    Ok(coordinate)
}

pub fn comment_activity_matches(issue: &Event, event: &Event, owner: &str) -> bool {
    let Ok(repository) = comment_repository(issue) else {
        return false;
    };
    event.kind.as_u16() == 1
        && event.verify().is_ok()
        && event.pubkey.to_hex() == owner
        && event
            .tags
            .iter()
            .find(|tag| tag.as_slice().first().is_some_and(|name| name == "a"))
            .and_then(|tag| tag.as_slice().get(1))
            .map(String::as_str)
            == Some(repository)
        && event.tags.iter().any(|tag| {
            let fields = tag.as_slice();
            fields
                .first()
                .is_some_and(|name| name == "e" || name == "E")
                && fields
                    .get(1)
                    .is_some_and(|value| value == &issue.id.to_hex())
        })
}

fn comment_tags(
    request: &ProjectsPublishRequest,
    issue: &Event,
    media_tags: &[Vec<String>],
) -> Result<Vec<Tag>, OperatorError> {
    if publication_kind(request)? != 1
        || comment_target_kind(request)? != issue.kind.as_u16()
        || request.target_event_id.as_deref() != Some(issue.id.to_hex().as_str())
    {
        return Err(invalid("comment issue mismatch"));
    }
    let repository = comment_repository(issue)?;
    let repository_owner = repository.split(':').nth(1).unwrap_or_default();
    let mut recipients = vec![repository_owner.to_owned()];
    let issue_author = issue.pubkey.to_hex();
    for key in std::iter::once(issue_author.as_str())
        .chain(issue.tags.iter().filter_map(|tag| {
            let fields = tag.as_slice();
            (fields.first().is_some_and(|name| name == "p"))
                .then(|| fields.get(1).map(String::as_str))
                .flatten()
        }))
        .chain(
            request
                .mentions
                .as_deref()
                .unwrap_or_default()
                .iter()
                .map(String::as_str),
        )
    {
        let key = key.to_lowercase();
        if !recipients.contains(&key) {
            recipients.push(key);
        }
    }
    let mut tags = vec![
        vec![
            "e".to_owned(),
            issue.id.to_hex(),
            String::new(),
            "root".to_owned(),
        ],
        vec!["a".to_owned(), repository.to_owned()],
    ];
    tags.extend(recipients.into_iter().map(|key| vec!["p".to_owned(), key]));
    tags.extend_from_slice(media_tags);
    tags.into_iter()
        .map(Tag::parse)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| invalid("invalid comment tags"))
}

pub fn comment_publication_builder(
    request: &ProjectsPublishRequest,
    issue: &Event,
    latest: Option<&Event>,
    owner: &str,
    media_tags: &[Vec<String>],
) -> Result<EventBuilder, OperatorError> {
    if nostr::PublicKey::from_hex(owner).map_or(true, |key| key.to_hex() != owner) {
        return Err(invalid("invalid comment author"));
    }
    let assignment = is_assignment(request);
    let tags = if assignment {
        if !media_tags.is_empty() {
            return Err(invalid("assignment media is not supported"));
        }
        assignment_tags(request, issue, owner)?
    } else {
        comment_tags(request, issue, media_tags)?
    };
    // Original ordinary PR comments use signing time; only Tasks and review
    // decisions have an activity-based monotonic timestamp. No decision here.
    if issue.kind.as_u16() == 1618 && latest.is_some() {
        return Err(invalid(
            "ordinary review comment has no previous timestamp evidence",
        ));
    }
    let created_at = match latest {
        Some(event) if comment_activity_matches(issue, event, owner) => Timestamp::from_secs(
            event
                .created_at
                .as_secs()
                .checked_add(1)
                .ok_or_else(|| invalid("comment timestamp overflow"))?,
        )
        .max(Timestamp::now()),
        Some(_) => return Err(invalid("invalid previous comment evidence")),
        None => Timestamp::now(),
    };
    Ok(EventBuilder::new(
        nostr::Kind::from(1),
        if assignment {
            assignment_content(request)?
        } else {
            request
                .body
                .as_deref()
                .unwrap_or_default()
                .trim()
                .to_owned()
        },
    )
    .tags(tags)
    .allow_self_tagging()
    .custom_created_at(created_at))
}

pub fn comment_publication_matches(
    request: &ProjectsPublishRequest,
    issue: &Event,
    event: &Event,
    media_tags: &[Vec<String>],
) -> Result<bool, OperatorError> {
    if event.kind.as_u16() != 1 || event.verify().is_err() {
        return Err(invalid("invalid retained comment"));
    }
    let assignment = is_assignment(request);
    if assignment && !media_tags.is_empty() {
        return Err(invalid("assignment media is not supported"));
    }
    let content = if assignment {
        assignment_content(request)?
    } else {
        request
            .body
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_owned()
    };
    let tags = if assignment {
        assignment_tags(request, issue, &event.pubkey.to_hex())?
    } else {
        comment_tags(request, issue, media_tags)?
    };
    Ok(event.content == content && event.tags.iter().eq(tags.iter()))
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
    #[test]
    fn other_human_assignment_requires_original_authority_and_exact_recipient() {
        use super::*;
        let author = nostr::Keys::generate();
        let repo_owner = nostr::Keys::generate();
        let member = nostr::Keys::generate();
        let assignee = nostr::Keys::generate().public_key().to_hex();
        let issue = EventBuilder::new(nostr::Kind::from(1621), "task")
            .tags([Tag::parse(["a", &format!("30617:{}:repo", repo_owner.public_key())]).unwrap()])
            .sign_with_keys(&author)
            .unwrap();
        let mut request: ProjectsPublishRequest = serde_json::from_value(serde_json::json!({
            "operation":"ASSIGN_ISSUE", "targetEventId":issue.id.to_hex(),
            "assigneePubkey":assignee, "assigneeLabel":" Colleague 🪴 "
        }))
        .unwrap();
        for signer in [&author, &repo_owner] {
            let event = comment_publication_builder(
                &request,
                &issue,
                None,
                &signer.public_key().to_hex(),
                &[],
            )
            .unwrap()
            .sign_with_keys(signer)
            .unwrap();
            assert_eq!(event.content, "Assigned this task to Colleague 🪴");
            assert_eq!(event.pubkey, signer.public_key());
            assert_eq!(
                event
                    .tags
                    .iter()
                    .map(|tag| tag.as_slice().to_vec())
                    .collect::<Vec<_>>(),
                vec![
                    vec![
                        "e".to_owned(),
                        issue.id.to_hex(),
                        String::new(),
                        "root".into()
                    ],
                    vec![
                        "a".into(),
                        format!("30617:{}:repo", repo_owner.public_key())
                    ],
                    vec!["p".into(), assignee.clone()],
                    vec!["t".into(), "assignment".into()],
                ]
            );
            assert!(comment_publication_matches(&request, &issue, &event, &[]).unwrap());
            let mut changed = request.clone();
            changed.assignee_pubkey = Some(member.public_key().to_hex());
            assert!(!comment_publication_matches(&changed, &issue, &event, &[]).unwrap());
            changed = request.clone();
            changed.operation =
                serde_json::from_value(serde_json::json!("UNASSIGN_ISSUE")).unwrap();
            assert!(!comment_publication_matches(&changed, &issue, &event, &[]).unwrap());
            let unassign = comment_publication_builder(
                &changed,
                &issue,
                Some(&event),
                &signer.public_key().to_hex(),
                &[],
            )
            .unwrap()
            .sign_with_keys(signer)
            .unwrap();
            assert!(unassign.created_at > event.created_at);
            assert!(comment_publication_matches(&changed, &issue, &unassign, &[]).unwrap());
        }
        assert!(comment_publication_builder(
            &request,
            &issue,
            None,
            &member.public_key().to_hex(),
            &[]
        )
        .is_err());
        request.assignee_pubkey = Some(author.public_key().to_hex());
        assert!(comment_publication_builder(
            &request,
            &issue,
            None,
            &author.public_key().to_hex(),
            &[]
        )
        .is_err());
        request.assignee_pubkey = Some(assignee);
        request.prior_event_id = Some(issue.id.to_hex());
        assert!(publication_kind(&request).is_err());
        request.prior_event_id = None;
        request.operation = serde_json::from_value(serde_json::json!("SELF_ASSIGN_ISSUE")).unwrap();
        assert!(publication_kind(&request).is_err());
    }
    use super::*;
    use nostr::{Keys, Tag};
    use serde_json::json;

    #[test]
    fn self_assignment_uses_original_causal_heads_and_exact_retained_event() {
        let repo_owner = Keys::generate();
        let member = Keys::generate();
        let stranger = Keys::generate();
        let self_key = member.public_key().to_hex();
        let address = format!("30617:{}:garden", repo_owner.public_key());
        let issue = EventBuilder::new(nostr::Kind::from(1621), "issue")
            .tags([Tag::parse(["a", &address]).unwrap()])
            .sign_with_keys(&repo_owner)
            .unwrap();
        let request = |operation: &str, prior: Option<String>| {
            let mut value = json!({"operation":operation,"targetEventId":issue.id.to_hex(),"assigneeLabel":"  Me 🪴  "});
            if let Some(prior) = prior {
                value["priorEventId"] = json!(prior);
            }
            serde_json::from_value::<ProjectsPublishRequest>(value).unwrap()
        };
        let assign = request("SELF_ASSIGN_ISSUE", None);
        let first = comment_publication_builder(&assign, &issue, None, &self_key, &[])
            .unwrap()
            .sign_with_keys(&member)
            .unwrap();
        assert_eq!(first.content, "Assigned this task to Me 🪴");
        let tags: Vec<_> = first
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect();
        assert_eq!(
            tags,
            vec![
                vec!["e".into(), issue.id.to_hex(), "".into(), "root".into()],
                vec!["a".into(), address.clone()],
                vec!["p".into(), self_key.clone()],
                vec!["t".into(), "assignment".into()]
            ]
        );
        assert_eq!(
            assignment_head(&issue, std::slice::from_ref(&first), &self_key).unwrap(),
            Some(first.id.to_hex())
        );
        let unassign = request("SELF_UNASSIGN_ISSUE", Some(first.id.to_hex()));
        let second = comment_publication_builder(&unassign, &issue, Some(&first), &self_key, &[])
            .unwrap()
            .sign_with_keys(&member)
            .unwrap();
        assert!(second.created_at > first.created_at);
        assert_eq!(second.content, "Unassigned Me 🪴 from this task");
        assert!(comment_publication_matches(&unassign, &issue, &second, &[]).unwrap());
        assert!(!comment_publication_matches(&assign, &issue, &second, &[]).unwrap());
        // Owner decisions precede causal self operations even if a self signer
        // selected a future timestamp. The old head cannot supersede them.
        let owner_decision = EventBuilder::new(nostr::Kind::from(1), "owner")
            .tags([
                Tag::parse(["e", &issue.id.to_hex(), "", "root"]).unwrap(),
                Tag::parse(["a", &address]).unwrap(),
                Tag::parse(["p", &self_key]).unwrap(),
                Tag::parse(["t", "assignment"]).unwrap(),
            ])
            .custom_created_at(Timestamp::from_secs(1))
            .sign_with_keys(&repo_owner)
            .unwrap();
        let activity = vec![first.clone(), second.clone(), owner_decision.clone()];
        assert_eq!(
            assignment_head(&issue, &activity, &self_key).unwrap(),
            Some(owner_decision.id.to_hex())
        );
        assert_ne!(
            unassign.prior_event_id,
            assignment_head(&issue, &activity, &self_key).unwrap()
        );
        let current = request("SELF_UNASSIGN_ISSUE", Some(owner_decision.id.to_hex()));
        let last = comment_publication_builder(&current, &issue, Some(&second), &self_key, &[])
            .unwrap()
            .sign_with_keys(&member)
            .unwrap();
        let mut activity = activity;
        activity.push(last.clone());
        assert_eq!(
            assignment_head(&issue, &activity, &self_key).unwrap(),
            Some(last.id.to_hex())
        );
        // Retained equality is against the original event, not today's head.
        assert!(comment_publication_matches(&unassign, &issue, &second, &[]).unwrap());
        for field in ["t", "p", "e", "a", "prior"] {
            let tags = last
                .tags
                .iter()
                .map(|tag| {
                    let mut values = tag.as_slice().to_vec();
                    if values[0] == field {
                        values[1] = "f".repeat(64);
                    }
                    Tag::parse(values).unwrap()
                })
                .collect::<Vec<_>>();
            let changed = EventBuilder::new(nostr::Kind::from(1), &last.content)
                .tags(tags)
                .allow_self_tagging()
                .sign_with_keys(&member)
                .unwrap();
            assert!(
                !comment_publication_matches(&current, &issue, &changed, &[]).unwrap(),
                "{field}"
            );
        }
        let changed = EventBuilder::new(nostr::Kind::from(1), "changed body")
            .tags(last.tags.iter().cloned())
            .allow_self_tagging()
            .sign_with_keys(&member)
            .unwrap();
        assert!(!comment_publication_matches(&current, &issue, &changed, &[]).unwrap());
        let foreign = EventBuilder::new(nostr::Kind::from(1), "foreign assignment")
            .tags(owner_decision.tags.iter().cloned())
            .allow_self_tagging()
            .sign_with_keys(&stranger)
            .unwrap();
        assert_eq!(
            assignment_head(&issue, &[foreign], &self_key).unwrap(),
            None
        );
        let mut invalid = serde_json::to_value(&assign).unwrap();
        invalid["body"] = json!("cannot disguise a comment");
        assert!(publication_kind(&serde_json::from_value(invalid).unwrap()).is_err());
        let mut invalid = assign.clone();
        invalid.assignee_label = Some("🪴".repeat(129));
        assert!(publication_kind(&invalid).is_err());
        invalid.assignee_label = Some("🪴".repeat(128));
        assert_eq!(publication_kind(&invalid).unwrap(), 1);
    }

    #[test]
    fn publication_receipt_verifies_frozen_actor_kind_hash_and_signature() {
        let keys = Keys::generate();
        for kind in [1, 5, 1621, 30617, 30621] {
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
    fn original_pull_request_comment_keeps_typed_root_media_and_ordinary_timestamp() {
        let repository_owner = Keys::generate();
        let author = Keys::generate();
        let repository = format!("30617:{}:garden", repository_owner.public_key());
        let target = EventBuilder::new(nostr::Kind::from(1618), "pull request")
            .tags([
                Tag::parse(["a", repository.as_str()]).unwrap(),
                Tag::parse(["p", author.public_key().to_hex().as_str()]).unwrap(),
            ])
            .sign_with_keys(&repository_owner)
            .unwrap();
        let request: ProjectsPublishRequest = serde_json::from_value(json!({
            "operation":"CREATE_PULL_REQUEST_COMMENT","targetEventId":target.id.to_hex(),
            "body":"  Review ![image](original-media)  ","mentions":[author.public_key().to_hex()]
        }))
        .unwrap();
        let media = vec![vec!["imeta".to_owned(), "url original-media".to_owned()]];
        let before = Timestamp::now();
        let event = comment_publication_builder(
            &request,
            &target,
            None,
            &author.public_key().to_hex(),
            &media,
        )
        .unwrap()
        .sign_with_keys(&author)
        .unwrap();
        assert_eq!(comment_target_kind(&request).unwrap(), 1618);
        assert_eq!(event.kind.as_u16(), 1);
        assert_eq!(event.content, "Review ![image](original-media)");
        assert!(event.created_at >= before && event.created_at <= Timestamp::now());
        assert_eq!(
            event
                .tags
                .iter()
                .map(|tag| tag.as_slice().to_vec())
                .collect::<Vec<_>>(),
            vec![
                vec![
                    "e".to_owned(),
                    target.id.to_hex(),
                    String::new(),
                    "root".to_owned()
                ],
                vec!["a".to_owned(), repository.clone()],
                vec!["p".to_owned(), repository_owner.public_key().to_hex()],
                vec!["p".to_owned(), author.public_key().to_hex()],
                media[0].clone(),
            ]
        );
        assert!(comment_publication_matches(&request, &target, &event, &media).unwrap());
        let mut changed = request.clone();
        changed.body = Some("different".into());
        assert!(!comment_publication_matches(&changed, &target, &event, &media).unwrap());
        assert!(!comment_publication_matches(&request, &target, &event, &[]).unwrap());
        let issue = EventBuilder::new(nostr::Kind::from(1621), "issue")
            .tags([Tag::parse(["a", repository.as_str()]).unwrap()])
            .sign_with_keys(&repository_owner)
            .unwrap();
        changed = request.clone();
        changed.target_event_id = Some(issue.id.to_hex());
        assert!(comment_publication_builder(
            &changed,
            &issue,
            None,
            &author.public_key().to_hex(),
            &media
        )
        .is_err());
        assert!(comment_publication_builder(
            &request,
            &target,
            Some(&event),
            &author.public_key().to_hex(),
            &media
        )
        .is_err());
        let mut forged = target.clone();
        forged.content = "unsigned".into();
        assert!(comment_publication_builder(
            &request,
            &forged,
            None,
            &author.public_key().to_hex(),
            &media
        )
        .is_err());
    }

    #[test]
    fn original_issue_comment_keeps_recipients_media_and_same_author_ordering() {
        let repository_owner = Keys::generate();
        let issue_owner = Keys::generate();
        let author = Keys::generate();
        let mentioned = Keys::generate().public_key().to_hex();
        let repository = format!("30617:{}:garden", repository_owner.public_key());
        let issue = EventBuilder::new(nostr::Kind::from(1621), "issue")
            .tags([
                Tag::parse(["a", repository.as_str()]).unwrap(),
                Tag::parse(["p", mentioned.as_str()]).unwrap(),
                Tag::parse(["p", &issue_owner.public_key().to_hex()]).unwrap(),
            ])
            .sign_with_keys(&issue_owner)
            .unwrap();
        let request: ProjectsPublishRequest = serde_json::from_value(json!({
            "operation":"CREATE_ISSUE_COMMENT", "targetEventId":issue.id.to_hex(),
            "body":"  Comment ![image](original-media)  ",
            "mentions":[mentioned,repository_owner.public_key().to_hex()], "attachments":[]
        }))
        .unwrap();
        let media = vec![vec!["imeta".to_owned(), "url original-media".to_owned()]];
        let previous = EventBuilder::new(nostr::Kind::from(1), "previous")
            .tags([
                Tag::parse(["a", repository.as_str()]).unwrap(),
                Tag::parse(["e", &issue.id.to_hex(), "", "root"]).unwrap(),
            ])
            .custom_created_at(Timestamp::from_secs(Timestamp::now().as_secs() + 20))
            .sign_with_keys(&author)
            .unwrap();
        let event = comment_publication_builder(
            &request,
            &issue,
            Some(&previous),
            &author.public_key().to_hex(),
            &media,
        )
        .unwrap()
        .sign_with_keys(&author)
        .unwrap();
        assert_eq!(event.kind.as_u16(), 1);
        assert_eq!(event.content, "Comment ![image](original-media)");
        assert_eq!(
            event.created_at.as_secs(),
            previous.created_at.as_secs() + 1
        );
        assert_eq!(
            event
                .tags
                .iter()
                .map(|tag| tag.as_slice().to_vec())
                .collect::<Vec<_>>(),
            vec![
                vec![
                    "e".to_owned(),
                    issue.id.to_hex(),
                    String::new(),
                    "root".to_owned()
                ],
                vec!["a".to_owned(), repository],
                vec!["p".to_owned(), repository_owner.public_key().to_hex()],
                vec!["p".to_owned(), issue_owner.public_key().to_hex()],
                vec!["p".to_owned(), mentioned],
                media[0].clone(),
            ]
        );
        assert!(comment_publication_matches(&request, &issue, &event, &media).unwrap());
        let mut changed = request.clone();
        changed.body = Some("different body under same key".into());
        assert!(!comment_publication_matches(&changed, &issue, &event, &media).unwrap());
        changed = request.clone();
        changed.mentions = Some(vec![Keys::generate().public_key().to_hex()]);
        assert!(!comment_publication_matches(&changed, &issue, &event, &media).unwrap());
        assert!(!comment_publication_matches(&request, &issue, &event, &[]).unwrap());
        assert!(
            publication_builder(&request, Some(&issue), None, &author.public_key().to_hex())
                .is_err()
        );
        for (key, tags) in [
            (
                &issue_owner,
                previous.tags.iter().cloned().collect::<Vec<_>>(),
            ),
            (
                &author,
                vec![
                    Tag::parse([
                        "a",
                        &format!("30617:{}:another-repo", repository_owner.public_key()),
                    ])
                    .unwrap(),
                    Tag::parse(["e", &issue.id.to_hex()]).unwrap(),
                ],
            ),
            (
                &author,
                vec![
                    Tag::parse(["a", comment_repository(&issue).unwrap()]).unwrap(),
                    Tag::parse(["e", &"a".repeat(64)]).unwrap(),
                ],
            ),
        ] {
            let unrelated = EventBuilder::new(nostr::Kind::from(1), "unrelated")
                .tags(tags)
                .sign_with_keys(key)
                .unwrap();
            assert!(comment_publication_builder(
                &request,
                &issue,
                Some(&unrelated),
                &author.public_key().to_hex(),
                &media
            )
            .is_err());
        }
        let mut forged = previous.clone();
        forged.content = "unsigned replacement".into();
        assert!(comment_publication_builder(
            &request,
            &issue,
            Some(&forged),
            &author.public_key().to_hex(),
            &media
        )
        .is_err());
        let mut forged_issue = issue.clone();
        forged_issue.content = "unsigned issue".into();
        assert!(comment_publication_builder(
            &request,
            &forged_issue,
            None,
            &author.public_key().to_hex(),
            &media
        )
        .is_err());
    }

    #[test]
    fn issue_comment_rejects_mixed_operations_and_empty_body() {
        let value = json!({"operation":"CREATE_ISSUE_COMMENT","targetEventId":"b".repeat(64),"body":"comment"});
        assert_eq!(
            publication_kind(&serde_json::from_value(value.clone()).unwrap()).unwrap(),
            1
        );
        for (field, rejected) in [
            ("body", json!(" \n ")),
            ("targetEventId", json!("invalid")),
            ("workspaceId", json!(uuid::Uuid::new_v4())),
            ("title", json!("issue title")),
            ("category", json!("issue")),
            ("name", json!("repo")),
            ("description", json!("description")),
            ("visibility", json!("listed")),
            ("mentions", json!(["invalid"])),
        ] {
            let mut invalid = value.clone();
            invalid[field] = rejected;
            assert!(
                publication_kind(&serde_json::from_value(invalid).unwrap()).is_err(),
                "{field}"
            );
        }
        for operation in [
            "DELETE",
            "CREATE_PROJECT",
            "CREATE_REPOSITORY",
            "CREATE_ISSUE",
        ] {
            let mut invalid = value.clone();
            invalid["operation"] = json!(operation);
            invalid["mentions"] = json!([]);
            assert!(
                publication_kind(&serde_json::from_value(invalid).unwrap()).is_err(),
                "{operation}"
            );
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
