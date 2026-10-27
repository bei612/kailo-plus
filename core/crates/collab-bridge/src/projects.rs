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

/// Original repository/channel management (useAttachProjectRepository,
/// useBindProjectRepositoryChannel, useAddProjectChannel): each republishes
/// the signer's verified current announcement head, never creates one.
fn announcement_patch(request: &ProjectsPublishRequest) -> Option<&'static str> {
    match serde_json::to_value(&request.operation).ok()?.as_str()? {
        "ATTACH_REPOSITORY" => Some("ATTACH_REPOSITORY"),
        "BIND_REPOSITORY_CHANNEL" => Some("BIND_REPOSITORY_CHANNEL"),
        "ADD_PROJECT_CHANNEL" => Some("ADD_PROJECT_CHANNEL"),
        _ => None,
    }
}

pub fn is_announcement_patch(request: &ProjectsPublishRequest) -> bool {
    announcement_patch(request).is_some()
}

/// The member patch of a 30621 names no Channel: like a deletion it is a
/// Community-global announcement write.
pub fn is_repository_attachment(request: &ProjectsPublishRequest) -> bool {
    announcement_patch(request) == Some("ATTACH_REPOSITORY")
}

/// NIP-MP rule `member-cap` and the original related-stream cap.
const MAX_PROJECT_MEMBERS: usize = 64;
const MAX_PROJECT_RELATED_CHANNELS: usize = 64;
const PROJECT_RELATED_CHANNEL_TAG: &str = "buzz-related-channel";

/// Original buildProjectPatchTemplate member check: `30617:<lowercase owner>:<d>`.
fn repository_coordinate(value: &str) -> bool {
    let mut parts = value.splitn(3, ':');
    parts.next() == Some("30617")
        && parts.next().is_some_and(canonical_pubkey)
        && parts
            .next()
            .is_some_and(|d| !d.is_empty() && d.len() <= 1_024)
}

fn canonical_channel(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}

/// Fixed projectRepositoryCreation.ts::buildProjectPatchTemplate /
/// buildRepositoryChannelBindingTemplate and
/// projectChannelCreation.ts::buildProjectRelatedChannelPatchTemplate over the
/// verified current head: every other tag and the content stay verbatim.
fn announcement_patch_builder(
    operation: &str,
    request: &ProjectsPublishRequest,
    head: Option<&Event>,
    channel_id: Option<&str>,
    owner: &str,
) -> Result<EventBuilder, OperatorError> {
    let head = head.ok_or_else(|| invalid("announcement head missing"))?;
    let expected_kind: u16 = if operation == "BIND_REPOSITORY_CHANNEL" {
        30617
    } else {
        30621
    };
    if !canonical_pubkey(owner)
        || head.pubkey.to_hex() != owner
        || head.kind.as_u16() != expected_kind
        || request.target_event_id.as_deref() != Some(head.id.to_hex().as_str())
        || head.verify().is_err()
    {
        return Err(invalid("Only the owner can change this announcement."));
    }
    let tags: Vec<Vec<String>> = head
        .tags
        .iter()
        .map(|tag| tag.as_slice().to_vec())
        .collect();
    let named = |tag: &Vec<String>, name: &str| tag.first().is_some_and(|key| key == name);
    let patched = match operation {
        "ATTACH_REPOSITORY" => {
            if channel_id.is_some() {
                return Err(invalid("repository attachment names no channel"));
            }
            let address = request
                .repository_address
                .as_deref()
                .filter(|value| repository_coordinate(value))
                .ok_or_else(|| invalid("Repository address is invalid."))?;
            let mut hints = std::collections::HashMap::new();
            let mut addresses = Vec::new();
            for tag in tags.iter().filter(|tag| named(tag, "a")) {
                let Some(value) = tag.get(1).filter(|value| !value.is_empty()) else {
                    continue;
                };
                addresses.push(value.clone());
                if let Some(hint) = tag.get(2).filter(|hint| !hint.is_empty()) {
                    hints.insert(value.clone(), hint.clone());
                }
            }
            if addresses.iter().any(|value| value == address) {
                return Err(invalid("This repository is already part of the project."));
            }
            addresses.push(address.to_owned());
            let unique: std::collections::HashSet<&String> = addresses.iter().collect();
            if addresses.len() > MAX_PROJECT_MEMBERS {
                return Err(invalid(
                    "A project cannot contain more than 64 repositories.",
                ));
            }
            if unique.len() != addresses.len() {
                return Err(invalid("A project cannot contain duplicate repositories."));
            }
            if addresses.iter().any(|value| !repository_coordinate(value)) {
                return Err(invalid("Repository address is invalid."));
            }
            // JavaScript's default sort compares UTF-16 code units.
            addresses.sort_by(|left, right| left.encode_utf16().cmp(right.encode_utf16()));
            let mut patched: Vec<Vec<String>> = tags
                .iter()
                .filter(|tag| !named(tag, "a"))
                .cloned()
                .collect();
            patched.extend(addresses.into_iter().map(|value| match hints.get(&value) {
                Some(hint) => vec!["a".to_owned(), value, hint.clone()],
                None => vec!["a".to_owned(), value],
            }));
            patched
        }
        "BIND_REPOSITORY_CHANNEL" => {
            let channel = channel_id
                .filter(|value| canonical_channel(value))
                .ok_or_else(|| invalid("Repository access channel is invalid."))?;
            if first_tag(head, "buzz-channel") == Some(channel) {
                return Err(invalid("Repository access already uses this channel."));
            }
            let mut patched: Vec<Vec<String>> = tags
                .iter()
                .filter(|tag| !named(tag, "buzz-channel"))
                .cloned()
                .collect();
            patched.push(vec!["buzz-channel".to_owned(), channel.to_owned()]);
            patched
        }
        "ADD_PROJECT_CHANNEL" => {
            let channel = channel_id
                .filter(|value| canonical_channel(value))
                .ok_or_else(|| invalid("Project channel is invalid."))?;
            if first_tag(head, "buzz-channel") == Some(channel) {
                return Err(invalid("That channel is already this project's home."));
            }
            let related = tags
                .iter()
                .filter(|tag| named(tag, PROJECT_RELATED_CHANNEL_TAG))
                .filter_map(|tag| tag.get(1))
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>();
            if related.iter().any(|value| value.as_str() == channel) {
                return Err(invalid("That channel is already part of this project."));
            }
            if related.len() >= MAX_PROJECT_RELATED_CHANNELS {
                return Err(invalid(
                    "A project cannot contain more than 64 extra channels.",
                ));
            }
            let mut patched = tags;
            patched.push(vec![
                PROJECT_RELATED_CHANNEL_TAG.to_owned(),
                channel.to_owned(),
            ]);
            patched
        }
        _ => return Err(invalid("unsupported announcement change")),
    };
    let patched = patched
        .into_iter()
        .map(Tag::parse)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| invalid("invalid announcement tags"))?;
    let timestamp = head
        .created_at
        .as_secs()
        .checked_add(1)
        .ok_or_else(|| invalid("announcement timestamp overflow"))?
        .max(Timestamp::now().as_secs());
    let builder = if expected_kind == 30621 {
        // Layer A validation of the full patched envelope, as the original
        // validateProjectEventEnvelope runs before signing.
        buzz_sdk::build_project_with_tags(head.content.as_str(), patched)
            .map_err(|error| invalid(&error.to_string()))?
    } else {
        EventBuilder::new(nostr::Kind::from(expected_kind), head.content.as_str()).tags(patched)
    };
    // Keep every original tag verbatim, including a signer's own `p`.
    Ok(builder
        .custom_created_at(Timestamp::from_secs(timestamp))
        .allow_self_tagging())
}

/// Fixed pullRequestReviews.ts::updateProjectPullRequestStatus lifecycle kinds.
/// Merged (1631) is reached through git, never through this UI operation: the
/// DD-118 merge signs it with [`merged_status_publication_builder`].
pub const PULL_REQUEST_STATUS_KINDS: [u16; 3] = [1630, 1632, 1633];
const PULL_REQUEST_STATUS_HISTORY_KINDS: [u16; 4] = [1630, 1631, 1632, 1633];

pub fn is_pull_request_status(request: &ProjectsPublishRequest) -> bool {
    serde_json::to_value(&request.operation)
        .is_ok_and(|value| value.as_str() == Some("SET_PULL_REQUEST_STATUS"))
}

/// Fixed projectPullRequests.mjs labels. NIP-34 has no review kind: review
/// requests, decisions and inline comments are labeled kind-1 PR comments.
pub const PR_REVIEW_REQUEST_LABEL: &str = "review-request";
pub const PR_APPROVAL_LABEL: &str = "approval";
pub const PR_CHANGES_REQUESTED_LABEL: &str = "changes-requested";
pub const PR_INLINE_COMMENT_LABEL: &str = "inline-comment";
/// pullRequestReviews.ts REVIEW_DECISION_DETAILS.approve.content: the signed
/// content of an approval without a summary (protocol text, not UI copy).
pub const PR_APPROVAL_CONTENT: &str = "Approved these changes";
/// Original normalizeProjectPullRequestCommentAnchor path bound (UTF-16 units).
const PR_ANCHOR_PATH_LIMIT: usize = 4_096;
/// JavaScript Number.isSafeInteger upper bound for the original anchor line.
const PR_ANCHOR_LINE_LIMIT: i64 = 9_007_199_254_740_991;

/// Fixed pullRequestReviews.ts::submitProjectPullRequestReview("approve").
pub fn is_pull_request_approval(request: &ProjectsPublishRequest) -> bool {
    serde_json::to_value(&request.operation)
        .is_ok_and(|value| value.as_str() == Some("APPROVE_PULL_REQUEST"))
}

/// hooks.ts ProjectPullRequestCommentDecision "request-changes".
fn requests_changes(request: &ProjectsPublishRequest) -> bool {
    serde_json::to_value(&request.review_decision)
        .is_ok_and(|value| value.as_str() == Some("request-changes"))
}

/// The original review decisions: an approval, or a review comment that
/// requests changes. Both need the original reviewer authority and ordering.
pub fn is_pull_request_review_decision(request: &ProjectsPublishRequest) -> bool {
    is_pull_request_approval(request) || requests_changes(request)
}

/// Review comments that name the review head (`c`): decisions and inline
/// line comments. Ordinary PR comments carry no commit.
pub fn is_pull_request_review_comment(request: &ProjectsPublishRequest) -> bool {
    is_pull_request_review_decision(request) || request.anchor_path.is_some()
}

/// Original normalizeProjectPullRequestCommentAnchor: validate, never
/// normalize, an attacker-controlled path; side is old/new; line is a safe
/// positive integer. All three fields together or none.
fn comment_anchor(
    request: &ProjectsPublishRequest,
) -> Result<Option<(&str, &'static str, i64)>, OperatorError> {
    let bad = || invalid("Comment location is invalid.");
    let side = serde_json::to_value(&request.anchor_side).map_err(|_| bad())?;
    let side = match side.as_str() {
        None if side.is_null() => None,
        Some("old") => Some("old"),
        Some("new") => Some("new"),
        _ => return Err(bad()),
    };
    match (request.anchor_path.as_deref(), side, request.anchor_line) {
        (None, None, None) => Ok(None),
        (Some(path), Some(side), Some(line)) => {
            let units = path.encode_utf16().count();
            if units == 0
                || units > PR_ANCHOR_PATH_LIMIT
                || path.starts_with('/')
                || path.contains('\\')
                || path.contains('\0')
                || path
                    .split('/')
                    .any(|segment| segment.is_empty() || segment == "." || segment == "..")
                || !(1..=PR_ANCHOR_LINE_LIMIT).contains(&line)
            {
                return Err(bad());
            }
            Ok(Some((path, side, line)))
        }
        _ => Err(bad()),
    }
}

/// Signed content of a project comment: the trimmed body, or for an approval
/// without a summary the original default text.
pub fn comment_content(request: &ProjectsPublishRequest) -> String {
    let body = request.body.as_deref().unwrap_or_default().trim();
    if is_pull_request_approval(request) && body.is_empty() {
        return PR_APPROVAL_CONTENT.to_owned();
    }
    body.to_owned()
}

fn first_tag<'a>(event: &'a Event, name: &str) -> Option<&'a str> {
    event
        .tags
        .iter()
        .map(Tag::as_slice)
        .find(|tag| tag.first().is_some_and(|field| field == name))
        .and_then(|tag| tag.get(1))
        .map(String::as_str)
}

fn names_root(event: &Event, root: &Event) -> bool {
    let id = root.id.to_hex();
    event.tags.iter().any(|tag| {
        let fields = tag.as_slice();
        fields
            .first()
            .is_some_and(|name| name == "e" || name == "E")
            && fields.get(1) == Some(&id)
    })
}

/// Original projectPullRequests.mjs::trustedUpdatesForPullRequest: a 1619
/// signed by the review author or repository owner whose `E` is the review.
pub fn pull_request_update_trusted(pull_request: &Event, event: &Event) -> bool {
    let Ok((owner, author)) = pull_request_status_actors(pull_request) else {
        return false;
    };
    let signer = event.pubkey.to_hex();
    event.kind.as_u16() == 1619
        && event.verify().is_ok()
        && (signer == owner || signer == author)
        && first_tag(event, "E") == Some(pull_request.id.to_hex().as_str())
}

/// Original eventToProjectPullRequest `commit`: `c` of the newest trusted
/// update, else of the review itself.
pub fn pull_request_head(pull_request: &Event, latest_update: Option<&Event>) -> Option<String> {
    first_tag(latest_update.unwrap_or(pull_request), "c").map(str::to_owned)
}

/// Original canReviewProjectPullRequest status rule: only an Open or Draft
/// review takes decisions (statusFromEvent: 1631 Merged, 1632 Closed).
pub fn pull_request_reviewable(latest_status: Option<&Event>) -> bool {
    !latest_status.is_some_and(|event| matches!(event.kind.as_u16(), 1631 | 1632))
}

/// Original reviewersForPullRequest root part: `p` tags on the review.
pub fn pull_request_root_reviewer(pull_request: &Event, signer: &str) -> bool {
    pull_request.tags.iter().any(|tag| {
        let fields = tag.as_slice();
        fields.first().is_some_and(|name| name == "p")
            && fields
                .get(1)
                .is_some_and(|key| key.to_lowercase() == signer)
    })
}

/// Original reviewersForPullRequest comment part: a review request signed by
/// the review author or repository owner whose `p` tags name `signer`.
pub fn review_request_names(pull_request: &Event, event: &Event, signer: &str) -> bool {
    let Ok((owner, author)) = pull_request_status_actors(pull_request) else {
        return false;
    };
    let actor = event.pubkey.to_hex();
    event.kind.as_u16() == 1
        && event.verify().is_ok()
        && (actor == owner || actor == author)
        && names_root(event, pull_request)
        && event.tags.iter().any(|tag| {
            let fields = tag.as_slice();
            fields.first().is_some_and(|name| name == "t")
                && fields
                    .get(1)
                    .is_some_and(|label| label.to_lowercase() == PR_REVIEW_REQUEST_LABEL)
        })
        && event.tags.iter().any(|tag| {
            let fields = tag.as_slice();
            fields.first().is_some_and(|name| name == "p")
                && fields
                    .get(1)
                    .is_some_and(|key| key.to_lowercase() == signer)
        })
}

fn pull_request_status_kind(request: &ProjectsPublishRequest) -> Result<u16, OperatorError> {
    let status = serde_json::to_value(&request.pull_request_status)
        .map_err(|_| invalid("invalid review status"))?;
    match status.as_str() {
        Some("open") => Ok(1630),
        Some("draft") => Ok(1633),
        Some("closed") => Ok(1632),
        _ => Err(invalid("invalid review status")),
    }
}

/// Original projectIssues.mjs::allowedActorsForRoot: the review author and the
/// owner of the repository its `a` tag names. Nobody else changes its lifecycle.
pub fn pull_request_status_actors(pull_request: &Event) -> Result<(String, String), OperatorError> {
    if pull_request.kind.as_u16() != 1618 {
        return Err(invalid("review status target is not a review"));
    }
    let repository = comment_repository(pull_request)?;
    let owner = repository.split(':').nth(1).unwrap_or_default().to_owned();
    Ok((owner, pull_request.pubkey.to_hex()))
}

/// Original projectPullRequests.mjs::latestStatusForPullRequest trust rule.
pub fn pull_request_status_trusted(pull_request: &Event, event: &Event) -> bool {
    let Ok((owner, author)) = pull_request_status_actors(pull_request) else {
        return false;
    };
    let signer = event.pubkey.to_hex();
    let kind = event.kind.as_u16();
    PULL_REQUEST_STATUS_HISTORY_KINDS.contains(&kind)
        && event.verify().is_ok()
        && (signer == owner || signer == author)
        && event.tags.iter().any(|tag| {
            let fields = tag.as_slice();
            fields
                .first()
                .is_some_and(|name| name == "e" || name == "E")
                && fields.get(1) == Some(&pull_request.id.to_hex())
        })
}

/// Same shape as `buzz pr status` / the original desktop write: root `e`, the
/// repository `a`, then `p` for the repository owner and the review author.
fn pull_request_status_tags(pull_request: &Event) -> Result<Vec<Tag>, OperatorError> {
    let repository = comment_repository(pull_request)?;
    let (owner, author) = pull_request_status_actors(pull_request)?;
    let mut recipients = vec![owner.to_lowercase()];
    if !recipients.contains(&author.to_lowercase()) {
        recipients.push(author.to_lowercase());
    }
    let mut tags = vec![
        vec![
            "e".to_owned(),
            pull_request.id.to_hex(),
            String::new(),
            "root".to_owned(),
        ],
        vec!["a".to_owned(), repository.to_owned()],
    ];
    tags.extend(recipients.into_iter().map(|key| vec!["p".to_owned(), key]));
    tags.into_iter()
        .map(Tag::parse)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| invalid("invalid review status tags"))
}

/// Fixed pullRequestReviews.ts::updateProjectPullRequestStatus. `latest` is the
/// review's newest trusted lifecycle event, which keeps whole-second writes
/// ordered (projectPullRequests.mjs::nextProjectPullRequestStatusCreatedAt).
pub fn status_publication_builder(
    request: &ProjectsPublishRequest,
    pull_request: &Event,
    latest: Option<&Event>,
    signer: &str,
) -> Result<EventBuilder, OperatorError> {
    let kind = publication_kind(request)?;
    if !PULL_REQUEST_STATUS_KINDS.contains(&kind)
        || request.target_event_id.as_deref() != Some(pull_request.id.to_hex().as_str())
        || pull_request.verify().is_err()
        || nostr::PublicKey::from_hex(signer).map_or(true, |key| key.to_hex() != signer)
    {
        return Err(invalid("invalid review status target"));
    }
    let (owner, author) = pull_request_status_actors(pull_request)?;
    if signer != owner && signer != author {
        return Err(invalid(
            "review status requires the review author or repository owner",
        ));
    }
    let builder = EventBuilder::new(nostr::Kind::from(kind), "")
        .tags(pull_request_status_tags(pull_request)?)
        .allow_self_tagging()
        .custom_created_at(next_status_created_at(pull_request, latest)?);
    Ok(builder)
}

/// projectPullRequests.mjs::nextProjectPullRequestStatusCreatedAt: one second
/// after the review's newest trusted lifecycle event, never before now.
fn next_status_created_at(
    pull_request: &Event,
    latest: Option<&Event>,
) -> Result<Timestamp, OperatorError> {
    let Some(event) = latest else {
        return Ok(Timestamp::now());
    };
    if !pull_request_status_trusted(pull_request, event) {
        return Err(invalid("invalid previous review status evidence"));
    }
    let next = event
        .created_at
        .as_secs()
        .checked_add(1)
        .ok_or_else(|| invalid("review status timestamp overflow"))?;
    Ok(Timestamp::from_secs(next).max(Timestamp::now()))
}

/// Fixed project_git_workflow.rs::build_merged_status_event tags: the
/// lifecycle `e` / `a` / `p` tags, then `merge-commit` and `r` naming the
/// merge commit.
fn merged_tags(pull_request: &Event, merge_commit: &str) -> Result<Vec<Tag>, OperatorError> {
    let bad = || invalid("invalid merge commit");
    if !commit_id(merge_commit) {
        return Err(bad());
    }
    let mut tags = pull_request_status_tags(pull_request)?;
    for name in ["merge-commit", "r"] {
        tags.push(Tag::parse([name, merge_commit]).map_err(|_| bad())?);
    }
    Ok(tags)
}

/// Fixed project_git_workflow.rs::build_merged_status_event.
///
/// The repository owner's 1631 once the merge reached the target branch, empty
/// content. The Desktop caller's `status_created_at` is the review's newest
/// trusted lifecycle event here (`latest`), exactly as for 1630/1632/1633.
pub fn merged_status_publication_builder(
    pull_request: &Event,
    latest: Option<&Event>,
    signer: &str,
    merge_commit: &str,
) -> Result<EventBuilder, OperatorError> {
    let (owner, _) = pull_request_status_actors(pull_request)?;
    if signer != owner {
        return Err(invalid("merged status requires the repository owner"));
    }
    let builder = EventBuilder::new(nostr::Kind::from(1631), "")
        .tags(merged_tags(pull_request, merge_commit)?)
        .allow_self_tagging()
        .custom_created_at(next_status_created_at(pull_request, latest)?);
    Ok(builder)
}

/// Compare an accepted lifecycle receipt with the immutable review it targets.
pub fn status_publication_matches(
    request: &ProjectsPublishRequest,
    pull_request: &Event,
    event: &Event,
) -> Result<bool, OperatorError> {
    let kind = publication_kind(request)?;
    if !PULL_REQUEST_STATUS_KINDS.contains(&kind) || event.verify().is_err() {
        return Err(invalid("invalid review status evidence"));
    }
    let tags = pull_request_status_tags(pull_request)?;
    Ok(event.kind.as_u16() == kind
        && event.content.is_empty()
        && request.target_event_id.as_deref() == Some(pull_request.id.to_hex().as_str())
        && event.tags.iter().eq(tags.iter()))
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

fn canonical_pubkey(key: &str) -> bool {
    nostr::PublicKey::from_hex(key).is_ok_and(|parsed| parsed.to_hex() == key)
}

/// NIP-34 `c` / `merge-base`: a SHA-1 or SHA-256 object id in lowercase hex.
fn commit_id(value: &str) -> bool {
    matches!(value.len(), 40 | 64)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// A review branch name as the contract bounds it: one git ref name, never
/// whitespace or control characters a tag value could smuggle.
fn review_branch(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= 255
        && !value.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// Original projectModels.ts::getCloneUrls with
/// lib/projectCloneUrl.ts::effectiveCloneUrls: the announcement's first `clone`
/// tag, else the Relay-hosted `<community origin>/git/<owner>/<d>` the
/// original derives from the active relay.
fn repository_clone_urls(repository: &Event, community_host: &str, d: &str) -> Vec<String> {
    let advertised = repository
        .tags
        .iter()
        .map(Tag::as_slice)
        .find(|tag| tag.first().is_some_and(|name| name == "clone"))
        .map(|tag| {
            tag.iter()
                .skip(1)
                .filter(|url| !url.is_empty())
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if !advertised.is_empty() || community_host.is_empty() {
        return advertised;
    }
    let owner = repository.pubkey.to_hex();
    vec![format!("https://{community_host}/git/{owner}/{d}")]
}

/// Fixed Buzz desktop/src/features/projects/pullRequestMutations.ts::
/// projectPullRequestTags: repository address, the owner and requested
/// reviewers (normalized, first occurrence kept), subject, compare head, the
/// repository clone URLs, compare and base branches, and the merge base when
/// known.
fn pull_request_tags(
    request: &ProjectsPublishRequest,
    owner: &str,
    d: &str,
    clone: &[String],
) -> Vec<Vec<String>> {
    let owner = owner.trim().to_lowercase();
    let mut recipients = vec![owner.clone()];
    for key in request.reviewers.as_deref().unwrap_or_default() {
        let key = key.trim().to_lowercase();
        if !recipients.contains(&key) {
            recipients.push(key);
        }
    }
    let value = |field: &Option<String>| field.as_deref().unwrap_or_default().to_owned();
    let mut tags = vec![vec!["a".to_owned(), format!("30617:{owner}:{d}")]];
    tags.extend(recipients.into_iter().map(|key| vec!["p".to_owned(), key]));
    let title = value(&request.title).trim().to_owned();
    tags.push(vec!["subject".to_owned(), title]);
    tags.push(vec!["c".to_owned(), value(&request.commit)]);
    let mut clone_tag = vec!["clone".to_owned()];
    clone_tag.extend_from_slice(clone);
    tags.push(clone_tag);
    tags.push(vec!["branch-name".to_owned(), value(&request.branch_name)]);
    tags.push(vec![
        "target-branch".to_owned(),
        value(&request.target_branch),
    ]);
    if let Some(base) = request.merge_base.as_deref() {
        tags.push(vec!["merge-base".to_owned(), base.to_owned()]);
    }
    tags
}

/// Original publishProjectPullRequest: the 1618 review of a branch already on
/// the repository, signed by the person, content = trimmed body. `repository`
/// is the trusted current 30617 announcement `targetEventId` names.
pub fn pull_request_publication_builder(
    request: &ProjectsPublishRequest,
    repository: &Event,
    signer: &str,
    community_host: &str,
) -> Result<EventBuilder, OperatorError> {
    if publication_kind(request)? != 1618
        || !canonical_pubkey(signer)
        || request.target_event_id.as_deref() != Some(repository.id.to_hex().as_str())
        || repository.kind.as_u16() != 30617
        || repository.verify().is_err()
    {
        return Err(invalid("invalid review repository evidence"));
    }
    let d = repository
        .tags
        .identifier()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid("review repository coordinate missing"))?;
    let clone = repository_clone_urls(repository, community_host, d);
    if clone.is_empty() {
        return Err(invalid("This project has no clone URL."));
    }
    let tags = pull_request_tags(request, &repository.pubkey.to_hex(), d, &clone)
        .into_iter()
        .map(Tag::parse)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| invalid("invalid review tags"))?;
    // The owner opening a review on their own repository still tags
    // themselves, exactly like the original.
    Ok(EventBuilder::new(
        nostr::Kind::from(1618),
        request.body.as_deref().unwrap_or_default().trim(),
    )
    .tags(tags)
    .allow_self_tagging())
}

/// Compare an accepted review with the retained request. The clone URLs are
/// taken from the event itself: the repository announcement may have changed
/// since, and the request never carried them.
pub fn pull_request_publication_matches(
    request: &ProjectsPublishRequest,
    event: &Event,
) -> Result<bool, OperatorError> {
    if publication_kind(request)? != 1618 || event.kind.as_u16() != 1618 || event.verify().is_err()
    {
        return Err(invalid("invalid review publication evidence"));
    }
    let tags = event
        .tags
        .iter()
        .map(|tag| tag.as_slice().to_vec())
        .collect::<Vec<_>>();
    let Some(address) = tags.first().filter(|tag| tag.len() == 2 && tag[0] == "a") else {
        return Ok(false);
    };
    let mut coordinate = address[1].splitn(3, ':');
    let kind = coordinate.next();
    let (Some(owner), Some(d)) = (coordinate.next(), coordinate.next()) else {
        return Ok(false);
    };
    if kind != Some("30617") {
        return Ok(false);
    }
    let clone = tags
        .iter()
        .find(|tag| tag.first().is_some_and(|name| name == "clone"));
    let Some(clone) = clone else {
        return Ok(false);
    };
    let expected = pull_request_tags(request, owner, d, &clone[1..]);
    let body = request.body.as_deref().unwrap_or_default().trim();
    Ok(event.content == body && tags == expected)
}

/// Fixed Buzz pullRequestMutations.ts::projectPullRequestUpdateTags.
fn pull_request_update_tags(request: &ProjectsPublishRequest, root: &Event, clone: &[String]) -> Result<Vec<Vec<String>>, OperatorError> {
    let (owner, author) = pull_request_status_actors(root)?;
    let mut tags = vec![vec!["a".into(), comment_repository(root)?], vec!["p".into(), owner.clone()]];
    if owner != author { tags.push(vec!["p".into(), author.clone()]); }
    tags.extend([vec!["E".into(), root.id.to_hex()], vec!["P".into(), author],
        vec!["c".into(), request.commit.clone().ok_or_else(|| invalid("review commit missing"))?]]);
    let mut clones = vec!["clone".into()]; clones.extend_from_slice(clone); tags.push(clones);
    if let Some(base) = &request.merge_base { tags.push(vec!["merge-base".into(), base.clone()]); }
    Ok(tags)
}

/// The author or repository owner updates a review. Neither caller tags nor a
/// frontend URL are accepted; both immutable root and current repository are signed evidence.
pub fn pull_request_update_builder(request: &ProjectsPublishRequest, root: &Event, repository: &Event,
    latest: Option<&Event>, signer: &str, community_host: &str) -> Result<EventBuilder, OperatorError> {
    let (owner, author) = pull_request_status_actors(root)?;
    let coordinate = comment_repository(root)?;
    let slug = coordinate.splitn(3, ':').nth(2).ok_or_else(|| invalid("review repository missing"))?;
    if publication_kind(request)? != 1619 || root.verify().is_err()
        || request.target_event_id.as_deref() != Some(root.id.to_hex().as_str())
        || signer != owner && signer != author || repository.kind.as_u16() != 30617
        || repository.pubkey.to_hex() != owner || repository.tags.identifier() != Some(slug)
        || repository.verify().is_err() || latest.is_some_and(|event| !pull_request_update_trusted(root,event)) {
        return Err(invalid("invalid review update evidence"));
    }
    let mut clone = latest.unwrap_or(root).tags.iter().map(Tag::as_slice).find(|tag|tag.first().is_some_and(|name|name=="clone"))
        .map(|tag|tag[1..].to_vec()).unwrap_or_default();
    if clone.is_empty() { clone = repository_clone_urls(repository, community_host, slug); }
    let tags = pull_request_update_tags(request,root,&clone)?.into_iter().map(Tag::parse)
        .collect::<Result<Vec<_>,_>>().map_err(|_|invalid("invalid review update tags"))?;
    let created = latest.map(|event|event.created_at.as_secs().checked_add(1).ok_or_else(||invalid("review update time overflow")))
        .transpose()?.unwrap_or_default().max(Timestamp::now().as_secs());
    Ok(EventBuilder::new(nostr::Kind::from(1619), "").tags(tags).allow_self_tagging()
        .custom_created_at(Timestamp::from_secs(created)))
}

/// Reconcile the immutable original update; the repository may have changed
/// since sending. Its clone metadata is frozen in the signed event, not read anew.
pub fn pull_request_update_matches(request: &ProjectsPublishRequest, root: &Event, event: &Event) -> Result<bool, OperatorError> {
    if publication_kind(request)? != 1619 || request.target_event_id.as_deref() != Some(root.id.to_hex().as_str())
        || !pull_request_update_trusted(root,event) || event.content != "" || buzz_core::publication::publication_epoch(event).is_err() {
        return Ok(false);
    }
    let tags=event.tags.iter().map(Tag::as_slice).filter(|tag|tag.first().is_none_or(|name|name!="kailo:publication"))
        .map(|tag|tag.to_vec()).collect::<Vec<_>>();
    let Some(clone)=tags.iter().find(|tag|tag.first().is_some_and(|name|name=="clone")) else {return Ok(false)};
    Ok(tags==pull_request_update_tags(request,root,&clone[1..])?)
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
    if !matches!(
        expected_kind,
        1 | 5 | 1618 | 1619 | 1621 | 1630 | 1631 | 1632 | 1633 | 30617 | 30621
    ) {
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
    if !is_pull_request_status(request) && request.pull_request_status.is_some() {
        return Err(invalid("review status on another project operation"));
    }
    let op = operation.as_str().unwrap_or_default();
    if op != "ATTACH_REPOSITORY" && request.repository_address.is_some()
        || op != "CREATE_REPOSITORY" && request.clone_url.is_some()
    {
        return Err(invalid(
            "repository management fields on another project operation",
        ));
    }
    let comment = matches!(op, "CREATE_ISSUE_COMMENT" | "CREATE_PULL_REQUEST_COMMENT");
    let titled = matches!(op, "CREATE_ISSUE" | "CREATE_PULL_REQUEST");
    let approval = op == "APPROVE_PULL_REQUEST";
    let bodied = titled || comment || approval;
    if !titled && request.title.is_some()
        || op != "CREATE_ISSUE" && request.category.is_some()
        || !bodied && request.body.is_some()
        || !comment && (request.mentions.is_some() || request.attachments.is_some())
    {
        return Err(invalid("issue fields on another project operation"));
    }
    if op != "CREATE_PULL_REQUEST"
        && (request.branch_name.is_some()
            || request.target_branch.is_some()
            || op != "UPDATE_PULL_REQUEST" && request.merge_base.is_some()
            || request.reviewers.is_some())
    {
        return Err(invalid("review fields on another project operation"));
    }
    // The review head (`c`) rides on review creation and the original review
    // comments only; decisions and line anchors only on review comments.
    let commit_allowed = matches!(
        op,
        "CREATE_PULL_REQUEST" | "UPDATE_PULL_REQUEST" | "CREATE_PULL_REQUEST_COMMENT" | "APPROVE_PULL_REQUEST"
    );
    let review_comment_fields = request.review_decision.is_some()
        || request.anchor_path.is_some()
        || request.anchor_side.is_some()
        || request.anchor_line.is_some();
    if !commit_allowed && request.commit.is_some()
        || op != "CREATE_PULL_REQUEST_COMMENT" && review_comment_fields
    {
        return Err(invalid(
            "review comment fields on another project operation",
        ));
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
        Some("SET_PULL_REQUEST_STATUS") => {
            if !request
                .target_event_id
                .as_deref()
                .is_some_and(canonical_event_id)
                || request.workspace_id.is_some()
                || request.name.is_some()
                || request.description.is_some()
                || request.visibility.is_some()
            {
                return Err(invalid("invalid review status"));
            }
            pull_request_status_kind(request)
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
            // Original createProjectPullRequestComment: a line anchor or a
            // change request needs the review head; ordinary comments have none.
            let anchored = comment_anchor(request)?.is_some();
            let review = anchored || requests_changes(request);
            if request.review_decision.is_some() && !requests_changes(request)
                || review != request.commit.is_some()
                || request
                    .commit
                    .as_deref()
                    .is_some_and(|value| !commit_id(value))
            {
                return Err(invalid("A review commit is required for review comments."));
            }
            Ok(1)
        }
        Some("APPROVE_PULL_REQUEST") => {
            // Original submitProjectPullRequestReview: the review and the head
            // it approves; the optional summary is the body.
            if !request
                .target_event_id
                .as_deref()
                .is_some_and(canonical_event_id)
                || request.workspace_id.is_some()
                || request.name.is_some()
                || request.description.is_some()
                || request.visibility.is_some()
                || !request.commit.as_deref().is_some_and(commit_id)
            {
                return Err(invalid("The review has no commit to inspect."));
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
        Some("UPDATE_PULL_REQUEST") => {
            if !request.target_event_id.as_deref().is_some_and(canonical_event_id)
                || !request.commit.as_deref().is_some_and(commit_id)
                || request.merge_base.as_deref().is_some_and(|base| !commit_id(base))
                || request.workspace_id.is_some() || request.name.is_some()
                || request.description.is_some() || request.visibility.is_some() {
                return Err(invalid("invalid review update"));
            }
            Ok(1619)
        }
        Some("CREATE_PULL_REQUEST") => {
            let schema: serde_json::Value = serde_json::from_str(include_str!(
                "../../../../contracts/api/projects_publish_request.schema.json"
            ))
            .map_err(|_| invalid("review limits unavailable"))?;
            let limit = schema["properties"]["title"]["maxLength"]
                .as_u64()
                .ok_or_else(|| invalid("review limits unavailable"))?;
            let title = request
                .title
                .as_deref()
                .ok_or_else(|| invalid("review title missing"))?
                .trim();
            let branch = request.branch_name.as_deref().unwrap_or_default();
            let target = request.target_branch.as_deref().unwrap_or_default();
            let reviewers = request.reviewers.as_deref().unwrap_or_default();
            // Original publishProjectPullRequest: nonempty title of at most 256
            // UTF-16 units, base and compare branches differ.
            if title.is_empty()
                || title.encode_utf16().count() as u64 > limit
                || request.body.is_none()
                || !request
                    .target_event_id
                    .as_deref()
                    .is_some_and(canonical_event_id)
                || request.workspace_id.is_some()
                || request.name.is_some()
                || request.description.is_some()
                || request.visibility.is_some()
                || !review_branch(branch)
                || !review_branch(target)
                || branch == target
                || !request.commit.as_deref().is_some_and(commit_id)
                || request
                    .merge_base
                    .as_deref()
                    .is_some_and(|base| !commit_id(base))
                || reviewers.iter().any(|key| !canonical_pubkey(key))
            {
                return Err(invalid("invalid review creation"));
            }
            Ok(1618)
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
            static LIMITS: std::sync::LazyLock<Option<(u64, u64, u64)>> =
                std::sync::LazyLock::new(|| {
                    let schema: serde_json::Value = serde_json::from_str(include_str!(
                        "../../../../contracts/api/projects_publish_request.schema.json"
                    ))
                    .ok()?;
                    Some((
                        schema["properties"]["name"]["maxLength"].as_u64()?,
                        schema["properties"]["description"]["maxLength"].as_u64()?,
                        schema["properties"]["cloneUrl"]["maxLength"].as_u64()?,
                    ))
                });
            let (name_limit, description_limit, clone_url_limit) = LIMITS
                .as_ref()
                .ok_or_else(|| invalid("project limits unavailable"))?;
            // Original AddProjectRepositoryDialog Clone URL: announcement
            // metadata only, never fetched by Kailo (DD-118 reads by coordinate).
            if request.clone_url.as_deref().is_some_and(|url| {
                url.len() as u64 > *clone_url_limit
                    || url.len() <= "https://".len()
                    || !url.starts_with("https://")
                    || url.chars().any(|c| c.is_whitespace() || c.is_control())
            }) {
                return Err(invalid("invalid repository clone URL"));
            }
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
        Some("ATTACH_REPOSITORY") => {
            if !request
                .target_event_id
                .as_deref()
                .is_some_and(canonical_event_id)
                || !request
                    .repository_address
                    .as_deref()
                    .is_some_and(repository_coordinate)
                || request.workspace_id.is_some()
                || request.name.is_some()
                || request.description.is_some()
                || request.visibility.is_some()
            {
                return Err(invalid("invalid repository attachment"));
            }
            Ok(30621)
        }
        Some(op @ ("BIND_REPOSITORY_CHANNEL" | "ADD_PROJECT_CHANNEL")) => {
            if !request
                .target_event_id
                .as_deref()
                .is_some_and(canonical_event_id)
                || !request
                    .workspace_id
                    .as_deref()
                    .is_some_and(canonical_channel)
                || request.name.is_some()
                || request.description.is_some()
                || request.visibility.is_some()
            {
                return Err(invalid("invalid announcement channel"));
            }
            Ok(if op == "BIND_REPOSITORY_CHANNEL" {
                30617
            } else {
                30621
            })
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
    if let Some(operation) = announcement_patch(request) {
        return announcement_patch_builder(operation, request, target, channel_id, owner);
    }
    if kind == 1 {
        return Err(invalid("issue comment requires signed activity evidence"));
    }
    if matches!(kind, 1618 | 1619) {
        return Err(invalid("review creation needs its repository evidence"));
    }
    if PULL_REQUEST_STATUS_KINDS.contains(&kind) {
        return Err(invalid("review status requires its review evidence"));
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
        // Original buildGitIssueTags always tags the repository owner. nostr's
        // builder drops a signer's own `p` tag unless self tagging is allowed,
        // which made an owner's task differ from issue_publication_matches.
        return Ok(EventBuilder::new(
            nostr::Kind::from(kind),
            request.body.as_deref().unwrap_or_default().trim(),
        )
        .tags(tags)
        .allow_self_tagging());
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
        } else if let Some(url) = request.clone_url.as_deref() {
            // Original buildAddedRepositoryEventTemplatesFromHead: `clone`
            // after the description, announcement metadata only.
            tags.push(vec!["clone".to_owned(), url.to_owned()]);
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
        Some("CREATE_PULL_REQUEST_COMMENT" | "APPROVE_PULL_REQUEST") => Ok(1618),
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
    // Original submitProjectPullRequestReview tags only the repository owner
    // and the review author; comments add the review's recipients and mentions.
    let approval = is_pull_request_approval(request);
    if approval && !media_tags.is_empty() {
        return Err(invalid("approval media is not supported"));
    }
    let carried: Vec<&str> = if approval {
        Vec::new()
    } else {
        issue
            .tags
            .iter()
            .filter_map(|tag| {
                let fields = tag.as_slice();
                (fields.first().is_some_and(|name| name == "p"))
                    .then(|| fields.get(1).map(String::as_str))
                    .flatten()
            })
            .collect()
    };
    for key in std::iter::once(issue_author.as_str()).chain(carried).chain(
        request
            .mentions
            .as_deref()
            .unwrap_or_default()
            .iter()
            .map(String::as_str),
    ) {
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
    let commit = request.commit.as_deref().unwrap_or_default();
    let label = |value: &str| vec!["t".to_owned(), value.to_owned()];
    let head = || vec!["c".to_owned(), commit.to_owned()];
    if approval {
        tags.extend([label(PR_APPROVAL_LABEL), head()]);
    }
    // Original hooks.ts::createProjectPullRequestComment ordering: inline
    // anchor tags, then the change-request label (with `c` unless anchored).
    let anchor = comment_anchor(request)?;
    if let Some((path, side, line)) = anchor {
        tags.extend([
            label(PR_INLINE_COMMENT_LABEL),
            head(),
            vec!["file".to_owned(), path.to_owned()],
            vec!["side".to_owned(), side.to_owned()],
            vec!["line".to_owned(), line.to_string()],
        ]);
    }
    if requests_changes(request) {
        tags.push(label(PR_CHANGES_REQUESTED_LABEL));
        if anchor.is_none() {
            tags.push(head());
        }
    }
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
    // decisions have an activity-based monotonic timestamp. A decision is
    // ordered after the signer's newest activity on the review, so it
    // supersedes that signer's earlier decision (reviewDecisionsForPullRequest
    // keeps the latest per author; nextProjectPullRequestReviewCreatedAt).
    if issue.kind.as_u16() == 1618 && latest.is_some() && !is_pull_request_review_decision(request)
    {
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
            comment_content(request)
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
        comment_content(request)
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
    fn review_status_follows_original_actors_tags_kinds_and_ordering() {
        use super::*;
        let author = nostr::Keys::generate();
        let repo_owner = nostr::Keys::generate();
        let stranger = nostr::Keys::generate();
        let repository = format!("30617:{}:repo", repo_owner.public_key());
        let review = EventBuilder::new(nostr::Kind::from(1618), "review")
            .tags([Tag::parse(["a", &repository]).unwrap()])
            .sign_with_keys(&author)
            .unwrap();
        let request = |status: &str| -> ProjectsPublishRequest {
            serde_json::from_value(serde_json::json!({
                "operation":"SET_PULL_REQUEST_STATUS", "targetEventId":review.id.to_hex(),
                "pullRequestStatus":status
            }))
            .unwrap()
        };
        for (status, kind) in [("open", 1630), ("draft", 1633), ("closed", 1632)] {
            assert_eq!(publication_kind(&request(status)).unwrap(), kind);
            assert!(publication_builder(&request(status), Some(&review), None, "x").is_err());
            for signer in [&author, &repo_owner] {
                let event = status_publication_builder(
                    &request(status),
                    &review,
                    None,
                    &signer.public_key().to_hex(),
                )
                .unwrap()
                .sign_with_keys(signer)
                .unwrap();
                assert_eq!(event.kind.as_u16(), kind);
                assert!(event.content.is_empty());
                assert_eq!(
                    event
                        .tags
                        .iter()
                        .map(|tag| tag.as_slice().to_vec())
                        .collect::<Vec<_>>(),
                    vec![
                        vec![
                            "e".to_owned(),
                            review.id.to_hex(),
                            String::new(),
                            "root".into()
                        ],
                        vec!["a".into(), repository.clone()],
                        vec!["p".into(), repo_owner.public_key().to_hex()],
                        vec!["p".into(), author.public_key().to_hex()],
                    ]
                );
                assert!(status_publication_matches(&request(status), &review, &event).unwrap());
                assert!(pull_request_status_trusted(&review, &event));
            }
        }
        // allowedActorsForRoot: nobody else may sign the lifecycle.
        assert!(status_publication_builder(
            &request("closed"),
            &review,
            None,
            &stranger.public_key().to_hex()
        )
        .is_err());
        // The newest trusted status orders a same-second write after it.
        let future = Timestamp::now().as_secs() + 120;
        let latest = EventBuilder::new(nostr::Kind::from(1632), "")
            .tags([Tag::parse(["e", &review.id.to_hex(), "", "root"]).unwrap()])
            .custom_created_at(Timestamp::from_secs(future))
            .sign_with_keys(&repo_owner)
            .unwrap();
        let reopened = status_publication_builder(
            &request("open"),
            &review,
            Some(&latest),
            &author.public_key().to_hex(),
        )
        .unwrap()
        .sign_with_keys(&author)
        .unwrap();
        assert_eq!(reopened.created_at.as_secs(), future + 1);
        let untrusted = EventBuilder::new(nostr::Kind::from(1632), "")
            .tags([Tag::parse(["e", &review.id.to_hex(), "", "root"]).unwrap()])
            .sign_with_keys(&stranger)
            .unwrap();
        assert!(!pull_request_status_trusted(&review, &untrusted));
        assert!(status_publication_builder(
            &request("open"),
            &review,
            Some(&untrusted),
            &author.public_key().to_hex()
        )
        .is_err());
        // A lifecycle event for another review never matches this request.
        let other = EventBuilder::new(nostr::Kind::from(1618), "other")
            .tags([Tag::parse(["a", &repository]).unwrap()])
            .sign_with_keys(&author)
            .unwrap();
        let foreign = status_publication_builder(
            &serde_json::from_value(serde_json::json!({
                "operation":"SET_PULL_REQUEST_STATUS", "targetEventId":other.id.to_hex(),
                "pullRequestStatus":"closed"
            }))
            .unwrap(),
            &other,
            None,
            &author.public_key().to_hex(),
        )
        .unwrap()
        .sign_with_keys(&author)
        .unwrap();
        assert!(!status_publication_matches(&request("closed"), &review, &foreign).unwrap());
        // Status fields never ride on another operation, and tasks are not reviews.
        let mut comment: ProjectsPublishRequest = serde_json::from_value(serde_json::json!({
            "operation":"CREATE_PULL_REQUEST_COMMENT", "targetEventId":review.id.to_hex(),
            "body":"hi"
        }))
        .unwrap();
        comment.pull_request_status = request("open").pull_request_status;
        assert!(publication_kind(&comment).is_err());
        let task = EventBuilder::new(nostr::Kind::from(1621), "task")
            .tags([Tag::parse(["a", &repository]).unwrap()])
            .sign_with_keys(&author)
            .unwrap();
        assert!(pull_request_status_actors(&task).is_err());
    }

    #[test]
    fn repository_owner_issue_keeps_original_owner_recipient_and_matches() {
        use super::*;
        let owner = nostr::Keys::generate();
        let repository = EventBuilder::new(nostr::Kind::from(30617), "")
            .tags([Tag::parse(["d", "repo"]).unwrap()])
            .sign_with_keys(&owner)
            .unwrap();
        let request: ProjectsPublishRequest = serde_json::from_value(serde_json::json!({
            "operation":"CREATE_ISSUE", "targetEventId":repository.id.to_hex(),
            "title":" Owner task ", "body":"Owner body", "category":"issue"
        }))
        .unwrap();
        let event = publication_builder(
            &request,
            Some(&repository),
            None,
            &owner.public_key().to_hex(),
        )
        .unwrap()
        .sign_with_keys(&owner)
        .unwrap();
        let tags = event
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect::<Vec<_>>();
        assert_eq!(tags[1], vec!["p".to_owned(), owner.public_key().to_hex()]);
        assert_eq!(tags.len(), 4);
        assert!(issue_publication_matches(&request, &event).unwrap());
    }

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
        for kind in [1, 5, 1618, 1621, 30617, 30621] {
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

    #[test]
    fn repository_and_channel_management_patch_only_the_owned_current_head() {
        let keys = Keys::generate();
        let owner = keys.public_key().to_hex();
        let other = Keys::generate().public_key().to_hex();
        let home = "11111111-1111-4111-8111-111111111111";
        let channel = "22222222-2222-4222-8222-222222222222";
        let first = format!("30617:{owner}:zeta");
        let hinted = format!("30617:{other}:alpha");
        let added = format!("30617:{owner}:mobile-app");
        let project = buzz_sdk::build_project_with_tags(
            "project body",
            [
                vec!["d", "garden"],
                vec!["name", "Garden"],
                vec!["a", first.as_str()],
                vec!["buzz-channel", home],
                vec!["x-unknown", "kept"],
                vec!["a", hinted.as_str(), "wss://relay.example"],
            ]
            .into_iter()
            .map(|tag| Tag::parse(tag).unwrap())
            .collect(),
        )
        .unwrap()
        .sign_with_keys(&keys)
        .unwrap();
        let tags = |event: &Event| -> Vec<Vec<String>> {
            event
                .tags
                .iter()
                .map(|tag| tag.as_slice().to_vec())
                .collect()
        };
        let strings = |rows: &[Vec<&str>]| -> Vec<Vec<String>> {
            rows.iter()
                .map(|row| row.iter().map(|value| (*value).to_owned()).collect())
                .collect()
        };

        // Original buildProjectPatchTemplate: other tags in place, members sorted, hints kept.
        let attach: ProjectsPublishRequest = serde_json::from_value(json!({
            "operation":"ATTACH_REPOSITORY","targetEventId":project.id.to_hex(),"repositoryAddress":added
        }))
        .unwrap();
        assert_eq!(publication_kind(&attach).unwrap(), 30621);
        assert!(is_repository_attachment(&attach) && is_announcement_patch(&attach));
        let patched = publication_builder(&attach, Some(&project), None, &owner)
            .unwrap()
            .sign_with_keys(&keys)
            .unwrap();
        assert_eq!(patched.kind.as_u16(), 30621);
        assert_eq!(patched.content, "project body");
        assert!(patched.created_at > project.created_at);
        let mut members = vec![
            vec!["a".to_owned(), first.clone()],
            vec![
                "a".to_owned(),
                hinted.clone(),
                "wss://relay.example".to_owned(),
            ],
            vec!["a".to_owned(), added.clone()],
        ];
        members.sort_by(|left, right| left[1].cmp(&right[1]));
        let mut expected = strings(&[
            vec!["d", "garden"],
            vec!["name", "Garden"],
            vec!["buzz-channel", home],
            vec!["x-unknown", "kept"],
        ]);
        expected.extend(members);
        assert_eq!(tags(&patched), expected);
        // A member already present, a channel, a non-owner and a stale head all refuse.
        let mut again = attach.clone();
        again.repository_address = Some(first.clone());
        assert!(publication_builder(&again, Some(&project), None, &owner).is_err());
        assert!(publication_builder(&attach, Some(&project), Some(channel), &owner).is_err());
        assert!(publication_builder(&attach, Some(&project), None, &other).is_err());
        let mut stale = attach;
        stale.target_event_id = Some("a".repeat(64));
        assert!(publication_builder(&stale, Some(&project), None, &owner).is_err());
        for bad in [
            json!({"operation":"ATTACH_REPOSITORY","targetEventId":project.id.to_hex(),"repositoryAddress":format!("30617:{}:repo", "A".repeat(64))}),
            json!({"operation":"ATTACH_REPOSITORY","targetEventId":project.id.to_hex(),"repositoryAddress":added,"workspaceId":channel}),
            json!({"operation":"CREATE_PROJECT","workspaceId":home,"name":"Garden","visibility":"listed","repositoryAddress":added}),
            json!({"operation":"CREATE_PROJECT","workspaceId":home,"name":"Garden","visibility":"listed","cloneUrl":"https://relay.example/repo.git"}),
            json!({"operation":"CREATE_REPOSITORY","workspaceId":home,"name":"Garden","cloneUrl":"http://relay.example/repo.git"}),
            json!({"operation":"ADD_PROJECT_CHANNEL","targetEventId":project.id.to_hex()}),
        ] {
            assert!(publication_kind(&serde_json::from_value(bad).unwrap()).is_err());
        }

        // Original buildProjectRelatedChannelPatchTemplate: append, never the home or a duplicate.
        let related: ProjectsPublishRequest = serde_json::from_value(json!({
            "operation":"ADD_PROJECT_CHANNEL","targetEventId":project.id.to_hex(),"workspaceId":channel
        }))
        .unwrap();
        assert_eq!(publication_kind(&related).unwrap(), 30621);
        assert!(!is_repository_attachment(&related));
        let linked = publication_builder(&related, Some(&project), Some(channel), &owner)
            .unwrap()
            .sign_with_keys(&keys)
            .unwrap();
        let mut expected = tags(&project);
        expected.push(vec!["buzz-related-channel".to_owned(), channel.to_owned()]);
        assert_eq!(tags(&linked), expected);
        assert!(publication_builder(&related, Some(&project), Some(home), &owner).is_err());
        let mut relinked = related;
        relinked.target_event_id = Some(linked.id.to_hex());
        assert!(publication_builder(&relinked, Some(&linked), Some(channel), &owner).is_err());

        // Original buildRepositoryChannelBindingTemplate: replace only `buzz-channel`.
        let repository = buzz_sdk::build_repo_announcement_with_tags(
            "mobile-app",
            "Mobile",
            [
                vec!["name", "Mobile app"],
                vec!["buzz-channel", home],
                vec!["description", "Mobile"],
                vec!["clone", "https://relay.example/mobile.git"],
            ]
            .into_iter()
            .map(|tag| Tag::parse(tag).unwrap())
            .collect(),
        )
        .unwrap()
        .sign_with_keys(&keys)
        .unwrap();
        let bind: ProjectsPublishRequest = serde_json::from_value(json!({
            "operation":"BIND_REPOSITORY_CHANNEL","targetEventId":repository.id.to_hex(),"workspaceId":channel
        }))
        .unwrap();
        assert_eq!(publication_kind(&bind).unwrap(), 30617);
        let bound = publication_builder(&bind, Some(&repository), Some(channel), &owner)
            .unwrap()
            .sign_with_keys(&keys)
            .unwrap();
        assert_eq!(bound.kind.as_u16(), 30617);
        assert_eq!(bound.content, "Mobile");
        assert_eq!(
            tags(&bound),
            strings(&[
                vec!["d", "mobile-app"],
                vec!["name", "Mobile app"],
                vec!["description", "Mobile"],
                vec!["clone", "https://relay.example/mobile.git"],
                vec!["buzz-channel", channel],
            ])
        );
        assert!(publication_builder(&bind, Some(&repository), Some(home), &owner).is_err());
        assert!(publication_builder(&bind, Some(&project), Some(channel), &owner).is_err());

        // Original optional Clone URL rides only on a new repository, after its description.
        let created: ProjectsPublishRequest = serde_json::from_value(json!({
            "operation":"CREATE_REPOSITORY","workspaceId":home,"name":"Mobile app","description":"Mobile",
            "cloneUrl":"https://relay.example/mobile.git"
        }))
        .unwrap();
        let created = publication_builder(&created, None, Some(home), &owner)
            .unwrap()
            .sign_with_keys(&keys)
            .unwrap();
        assert_eq!(
            tags(&created),
            strings(&[
                vec!["d", "mobile-app"],
                vec!["name", "Mobile app"],
                vec!["buzz-channel", home],
                vec!["description", "Mobile"],
                vec!["clone", "https://relay.example/mobile.git"],
            ])
        );
    }

    fn review_tags(event: &Event) -> Vec<Vec<String>> {
        event
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect()
    }

    fn tag(name: &str, value: &str) -> Vec<String> {
        vec![name.to_owned(), value.to_owned()]
    }

    #[test]
    fn review_creation_signs_the_original_tags_after_original_validation() {
        let owner = Keys::generate();
        let author = Keys::generate();
        let reviewer = Keys::generate();
        let owner_hex = owner.public_key().to_hex();
        let reviewer_hex = reviewer.public_key().to_hex();
        let repository = EventBuilder::new(nostr::Kind::from(30617), "")
            .tags([Tag::parse(["d", "repo"]).unwrap()])
            .sign_with_keys(&owner)
            .unwrap();
        let commit = "c".repeat(40);
        let base = "b".repeat(64);
        let value = json!({
            "operation":"CREATE_PULL_REQUEST", "targetEventId":repository.id.to_hex(),
            "title":"  Add feature  ", "body":" Details \n", "branchName":"feature/x",
            "targetBranch":"main", "commit":commit, "mergeBase":base,
            "reviewers":[reviewer_hex, owner_hex]
        });
        let request: ProjectsPublishRequest = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(publication_kind(&request).unwrap(), 1618);
        assert!(publication_builder(&request, Some(&repository), None, &owner_hex).is_err());
        let signer = author.public_key().to_hex();
        let host = "relay.example";
        let event = pull_request_publication_builder(&request, &repository, &signer, host)
            .unwrap()
            .sign_with_keys(&author)
            .unwrap();
        assert_eq!(event.kind.as_u16(), 1618);
        assert_eq!(event.content, "Details");
        // No clone tag on the announcement: the original derives the
        // Relay-hosted repository URL; the owner precedes reviewers once.
        let derived = format!("https://relay.example/git/{owner_hex}/repo");
        let expected = [
            tag("a", &format!("30617:{owner_hex}:repo")),
            tag("p", &owner_hex),
            tag("p", &reviewer_hex),
            tag("subject", "Add feature"),
            tag("c", &commit),
            tag("clone", &derived),
            tag("branch-name", "feature/x"),
            tag("target-branch", "main"),
            tag("merge-base", &base),
        ];
        assert_eq!(review_tags(&event), expected);
        assert!(pull_request_publication_matches(&request, &event).unwrap());

        // Advertised clone URLs win, and the owner reviewing their own
        // repository still tags themselves.
        let advertised = EventBuilder::new(nostr::Kind::from(30617), "")
            .tags([
                Tag::parse(["d", "repo"]).unwrap(),
                Tag::parse(["clone", "https://git.example/r.git", ""]).unwrap(),
            ])
            .sign_with_keys(&owner)
            .unwrap();
        let mut own = request.clone();
        own.target_event_id = Some(advertised.id.to_hex());
        own.merge_base = None;
        own.reviewers = None;
        let event = pull_request_publication_builder(&own, &advertised, &owner_hex, host)
            .unwrap()
            .sign_with_keys(&owner)
            .unwrap();
        let expected = [
            tag("a", &format!("30617:{owner_hex}:repo")),
            tag("p", &owner_hex),
            tag("subject", "Add feature"),
            tag("c", &commit),
            tag("clone", "https://git.example/r.git"),
            tag("branch-name", "feature/x"),
            tag("target-branch", "main"),
        ];
        assert_eq!(review_tags(&event), expected);
        assert!(pull_request_publication_matches(&own, &event).unwrap());
        let mut retitled = own.clone();
        retitled.title = Some("Other".into());
        assert!(!pull_request_publication_matches(&retitled, &event).unwrap());
        assert!(pull_request_publication_builder(&request, &advertised, &signer, "x").is_err());

        let invalid_values = [
            ("branchName", json!("main")),
            ("branchName", json!("bad name")),
            ("targetBranch", json!("x".repeat(256))),
            ("commit", json!("C".repeat(40))),
            ("mergeBase", json!("x")),
            ("reviewers", json!(["ABC"])),
            ("title", json!("  ")),
            ("title", json!("x".repeat(257))),
            ("mentions", json!([reviewer_hex])),
            ("category", json!("issue")),
            ("workspaceId", json!(uuid::Uuid::new_v4())),
        ];
        for (field, bad) in invalid_values {
            let mut invalid = value.clone();
            invalid[field] = bad;
            let invalid: ProjectsPublishRequest = serde_json::from_value(invalid).unwrap();
            assert!(publication_kind(&invalid).is_err(), "{field}");
        }
        for field in [
            "body",
            "commit",
            "branchName",
            "targetBranch",
            "targetEventId",
        ] {
            let mut missing = value.clone();
            missing.as_object_mut().unwrap().remove(field);
            let missing: ProjectsPublishRequest = serde_json::from_value(missing).unwrap();
            assert!(publication_kind(&missing).is_err(), "{field}");
        }
        // Review fields never ride on another operation.
        let issue = json!({
            "operation":"CREATE_ISSUE", "targetEventId":repository.id.to_hex(), "title":"t",
            "body":"", "category":"issue", "branchName":"feature/x"
        });
        let issue: ProjectsPublishRequest = serde_json::from_value(issue).unwrap();
        assert!(publication_kind(&issue).is_err());
    }

    #[test]
    fn merged_status_is_the_owner_signed_original_1631() {
        let owner = Keys::generate();
        let author = Keys::generate();
        let owner_hex = owner.public_key().to_hex();
        let author_hex = author.public_key().to_hex();
        let repository = format!("30617:{owner_hex}:repo");
        let review = EventBuilder::new(nostr::Kind::from(1618), "review")
            .tags([Tag::parse(["a", &repository]).unwrap()])
            .sign_with_keys(&author)
            .unwrap();
        let commit = "e".repeat(40);
        let before = Timestamp::now().as_secs();
        let event = merged_status_publication_builder(&review, None, &owner_hex, &commit)
            .unwrap()
            .sign_with_keys(&owner)
            .unwrap();
        assert_eq!(event.kind.as_u16(), 1631);
        assert!(event.content.is_empty());
        assert!(event.created_at.as_secs() >= before);
        let root = vec![
            "e".to_owned(),
            review.id.to_hex(),
            String::new(),
            "root".to_owned(),
        ];
        let expected = [
            root,
            tag("a", &repository),
            tag("p", &owner_hex),
            tag("p", &author_hex),
            tag("merge-commit", &commit),
            tag("r", &commit),
        ];
        assert_eq!(review_tags(&event), expected);
        assert!(pull_request_status_trusted(&review, &event));
        let id = event.id.to_hex();
        assert!(publication_observed(json!([event]), &id, &owner_hex, 1631).unwrap());

        // Only the repository owner merges; the review author does not.
        assert!(merged_status_publication_builder(&review, None, &author_hex, &commit).is_err());
        assert!(merged_status_publication_builder(&review, None, &owner_hex, "abc").is_err());

        // The owner's own review tags the owner once, and the status is ordered
        // after the newest trusted lifecycle event.
        let own = EventBuilder::new(nostr::Kind::from(1618), "own")
            .tags([Tag::parse(["a", &repository]).unwrap()])
            .sign_with_keys(&owner)
            .unwrap();
        let future = Timestamp::now().as_secs() + 120;
        let closed = EventBuilder::new(nostr::Kind::from(1632), "")
            .tags([Tag::parse(["e", &own.id.to_hex(), "", "root"]).unwrap()])
            .custom_created_at(Timestamp::from_secs(future))
            .sign_with_keys(&owner)
            .unwrap();
        let merged = merged_status_publication_builder(&own, Some(&closed), &owner_hex, &commit)
            .unwrap()
            .sign_with_keys(&owner)
            .unwrap();
        assert_eq!(merged.created_at.as_secs(), future + 1);
        let owners = review_tags(&merged)
            .into_iter()
            .filter(|tag| tag[0] == "p")
            .count();
        assert_eq!(owners, 1);
    }

    #[test]
    fn review_decisions_and_line_comments_keep_the_original_labeled_shape() {
        let owner = Keys::generate();
        let author = Keys::generate();
        let reviewer = Keys::generate();
        let owner_hex = owner.public_key().to_hex();
        let author_hex = author.public_key().to_hex();
        let reviewer_hex = reviewer.public_key().to_hex();
        let signer = reviewer_hex.as_str();
        let repository = format!("30617:{owner_hex}:repo");
        let head = "a".repeat(40);
        let review = EventBuilder::new(nostr::Kind::from(1618), "review")
            .tags([
                Tag::parse(["a", repository.as_str()]).unwrap(),
                Tag::parse(["p", owner_hex.as_str()]).unwrap(),
                Tag::parse(["p", reviewer_hex.as_str()]).unwrap(),
                Tag::parse(["c", head.as_str()]).unwrap(),
            ])
            .sign_with_keys(&author)
            .unwrap();
        let root = vec![
            "e".to_owned(),
            review.id.to_hex(),
            String::new(),
            "root".to_owned(),
        ];

        // submitProjectPullRequestReview: owner and author recipients, the
        // approval label and the approved head; no summary signs the default.
        let approve: ProjectsPublishRequest = serde_json::from_value(json!({
            "operation":"APPROVE_PULL_REQUEST","targetEventId":review.id.to_hex(),"commit":head
        }))
        .unwrap();
        assert_eq!(publication_kind(&approve).unwrap(), 1);
        assert_eq!(comment_target_kind(&approve).unwrap(), 1618);
        assert!(is_pull_request_review_decision(&approve));
        let event = comment_publication_builder(&approve, &review, None, signer, &[])
            .unwrap()
            .sign_with_keys(&reviewer)
            .unwrap();
        assert_eq!(event.content, PR_APPROVAL_CONTENT);
        assert_eq!(
            review_tags(&event),
            vec![
                root.clone(),
                tag("a", &repository),
                tag("p", &owner_hex),
                tag("p", &author_hex),
                tag("t", PR_APPROVAL_LABEL),
                tag("c", &head),
            ]
        );
        assert!(comment_publication_matches(&approve, &review, &event, &[]).unwrap());
        let mut summary = approve.clone();
        summary.body = Some("  Looks good  ".into());
        assert_eq!(comment_content(&summary), "Looks good");
        assert!(!comment_publication_matches(&summary, &review, &event, &[]).unwrap());
        let media = vec![vec!["imeta".to_owned(), "url original-media".to_owned()]];
        let with_media = comment_publication_builder(&approve, &review, None, signer, &media);
        assert!(with_media.is_err());

        // A decision follows the signer's newest activity on the review.
        let future = Timestamp::now().as_secs() + 120;
        let earlier = EventBuilder::new(nostr::Kind::from(1), "earlier")
            .tags([
                Tag::parse(["e", review.id.to_hex().as_str(), "", "root"]).unwrap(),
                Tag::parse(["a", repository.as_str()]).unwrap(),
            ])
            .custom_created_at(Timestamp::from_secs(future))
            .sign_with_keys(&reviewer)
            .unwrap();
        let ordered = comment_publication_builder(&approve, &review, Some(&earlier), signer, &[])
            .unwrap()
            .sign_with_keys(&reviewer)
            .unwrap();
        assert_eq!(ordered.created_at.as_secs(), future + 1);

        // createProjectPullRequestComment: recipients, inline anchor tags, then
        // the change-request label without a second `c`.
        let inline: ProjectsPublishRequest = serde_json::from_value(json!({
            "operation":"CREATE_PULL_REQUEST_COMMENT","targetEventId":review.id.to_hex(),
            "body":" Rename this ","commit":head,"reviewDecision":"request-changes",
            "anchorPath":"src/lib.rs","anchorSide":"new","anchorLine":12
        }))
        .unwrap();
        assert_eq!(publication_kind(&inline).unwrap(), 1);
        assert!(is_pull_request_review_comment(&inline));
        let event = comment_publication_builder(&inline, &review, None, signer, &[])
            .unwrap()
            .sign_with_keys(&reviewer)
            .unwrap();
        assert_eq!(event.content, "Rename this");
        let recipients = vec![
            root.clone(),
            tag("a", &repository),
            tag("p", &owner_hex),
            tag("p", &author_hex),
            tag("p", &reviewer_hex),
        ];
        let mut expected = recipients.clone();
        expected.extend([
            tag("t", PR_INLINE_COMMENT_LABEL),
            tag("c", &head),
            tag("file", "src/lib.rs"),
            tag("side", "new"),
            tag("line", "12"),
            tag("t", PR_CHANGES_REQUESTED_LABEL),
        ]);
        assert_eq!(review_tags(&event), expected);
        assert!(comment_publication_matches(&inline, &review, &event, &[]).unwrap());

        // Change request on the conversation: label then the reviewed head.
        let mut general = inline.clone();
        general.anchor_path = None;
        general.anchor_side = None;
        general.anchor_line = None;
        let event = comment_publication_builder(&general, &review, None, signer, &[])
            .unwrap()
            .sign_with_keys(&reviewer)
            .unwrap();
        let mut expected = recipients.clone();
        expected.extend([tag("t", PR_CHANGES_REQUESTED_LABEL), tag("c", &head)]);
        assert_eq!(review_tags(&event), expected);

        // A plain line comment is not a decision: signing time, no label.
        let mut line = inline.clone();
        line.review_decision = None;
        assert!(!is_pull_request_review_decision(&line));
        assert!(is_pull_request_review_comment(&line));
        let unordered = comment_publication_builder(&line, &review, Some(&earlier), signer, &[]);
        assert!(unordered.is_err());
        let event = comment_publication_builder(&line, &review, None, signer, &[])
            .unwrap()
            .sign_with_keys(&reviewer)
            .unwrap();
        let mut expected = recipients;
        expected.extend([
            tag("t", PR_INLINE_COMMENT_LABEL),
            tag("c", &head),
            tag("file", "src/lib.rs"),
            tag("side", "new"),
            tag("line", "12"),
        ]);
        assert_eq!(review_tags(&event), expected);

        let comment = json!({
            "operation":"CREATE_PULL_REQUEST_COMMENT","targetEventId":review.id.to_hex(),
            "body":"note","commit":head,"anchorPath":"src/lib.rs","anchorSide":"old","anchorLine":3
        });
        let parse = |value: serde_json::Value| -> ProjectsPublishRequest {
            serde_json::from_value(value).unwrap()
        };
        assert_eq!(publication_kind(&parse(comment.clone())).unwrap(), 1);
        for (field, bad) in [
            ("anchorPath", json!("/src/lib.rs")),
            ("anchorPath", json!("src/../lib.rs")),
            ("anchorPath", json!("src//lib.rs")),
            ("anchorPath", json!("src\\lib.rs")),
            ("anchorPath", json!("src/./lib.rs")),
            ("anchorPath", json!("x".repeat(4_097))),
            ("anchorLine", json!(0)),
            ("commit", json!("x")),
        ] {
            let mut invalid = comment.clone();
            invalid[field] = bad;
            assert!(publication_kind(&parse(invalid)).is_err(), "{field}");
        }
        for field in ["anchorSide", "anchorLine", "commit"] {
            let mut missing = comment.clone();
            missing.as_object_mut().unwrap().remove(field);
            assert!(publication_kind(&parse(missing)).is_err(), "{field}");
        }
        // Ordinary comments carry no head; review fields stay on their operation.
        let mut ordinary = comment.clone();
        for field in ["anchorPath", "anchorSide", "anchorLine"] {
            ordinary.as_object_mut().unwrap().remove(field);
        }
        assert!(publication_kind(&parse(ordinary.clone())).is_err());
        ordinary.as_object_mut().unwrap().remove("commit");
        assert_eq!(publication_kind(&parse(ordinary.clone())).unwrap(), 1);
        let mut issue = ordinary.clone();
        issue["operation"] = json!("CREATE_ISSUE_COMMENT");
        issue["reviewDecision"] = json!("request-changes");
        assert!(publication_kind(&parse(issue)).is_err());
        let approval = json!({
            "operation":"APPROVE_PULL_REQUEST","targetEventId":review.id.to_hex(),"commit":head
        });
        for (field, bad) in [
            ("mentions", json!([])),
            ("reviewDecision", json!("request-changes")),
            ("anchorPath", json!("src/lib.rs")),
            ("title", json!("t")),
            ("commit", json!("A".repeat(40))),
        ] {
            let mut invalid = approval.clone();
            invalid[field] = bad;
            assert!(publication_kind(&parse(invalid)).is_err(), "{field}");
        }
        let mut headless = approval;
        headless.as_object_mut().unwrap().remove("commit");
        assert!(publication_kind(&parse(headless)).is_err());
    }

    #[test]
    fn review_head_reviewers_and_lifecycle_follow_original_trust() {
        let owner = Keys::generate();
        let author = Keys::generate();
        let reviewer = Keys::generate();
        let stranger = Keys::generate();
        let owner_hex = owner.public_key().to_hex();
        let reviewer_hex = reviewer.public_key().to_hex();
        let stranger_hex = stranger.public_key().to_hex();
        let repository = format!("30617:{owner_hex}:repo");
        let review = EventBuilder::new(nostr::Kind::from(1618), "review")
            .tags([
                Tag::parse(["a", repository.as_str()]).unwrap(),
                Tag::parse(["c", "a".repeat(40).as_str()]).unwrap(),
            ])
            .sign_with_keys(&author)
            .unwrap();
        let id = review.id.to_hex();
        let update = |keys: &Keys, commit: &str| {
            EventBuilder::new(nostr::Kind::from(1619), "")
                .tags([
                    Tag::parse(["a", repository.as_str()]).unwrap(),
                    Tag::parse(["E", id.as_str()]).unwrap(),
                    Tag::parse(["c", commit]).unwrap(),
                ])
                .sign_with_keys(keys)
                .unwrap()
        };
        assert_eq!(pull_request_head(&review, None), Some("a".repeat(40)));
        let trusted = update(&author, &"b".repeat(40));
        assert!(pull_request_update_trusted(&review, &trusted));
        assert_eq!(
            pull_request_head(&review, Some(&trusted)),
            Some("b".repeat(40))
        );
        assert!(!pull_request_update_trusted(
            &review,
            &update(&stranger, &"c".repeat(40))
        ));

        let status = |kind: u16| {
            EventBuilder::new(nostr::Kind::from(kind), "")
                .tags([Tag::parse(["e", id.as_str(), "", "root"]).unwrap()])
                .sign_with_keys(&owner)
                .unwrap()
        };
        assert!(pull_request_reviewable(None));
        assert!(pull_request_reviewable(Some(&status(1630))));
        assert!(pull_request_reviewable(Some(&status(1633))));
        assert!(!pull_request_reviewable(Some(&status(1631))));
        assert!(!pull_request_reviewable(Some(&status(1632))));

        assert!(!pull_request_root_reviewer(&review, &reviewer_hex));
        let request = |keys: &Keys| {
            EventBuilder::new(nostr::Kind::from(1), "Requested a review")
                .tags([
                    Tag::parse(["e", id.as_str(), "", "root"]).unwrap(),
                    Tag::parse(["a", repository.as_str()]).unwrap(),
                    Tag::parse(["p", reviewer_hex.as_str()]).unwrap(),
                    Tag::parse(["t", PR_REVIEW_REQUEST_LABEL]).unwrap(),
                ])
                .sign_with_keys(keys)
                .unwrap()
        };
        assert!(review_request_names(
            &review,
            &request(&owner),
            &reviewer_hex
        ));
        assert!(review_request_names(
            &review,
            &request(&author),
            &reviewer_hex
        ));
        assert!(!review_request_names(
            &review,
            &request(&stranger),
            &reviewer_hex
        ));
        assert!(!review_request_names(
            &review,
            &request(&owner),
            &stranger_hex
        ));
    }
    #[test]
    fn original_review_update_producer_and_immutable_receipt() {
        let owner=Keys::generate(); let author=Keys::generate(); let stranger=Keys::generate();
        let coordinate=format!("30617:{}:repo",owner.public_key().to_hex());
        let repository=EventBuilder::new(nostr::Kind::from(30617), "").tags([
            Tag::parse(["d","repo"]).unwrap(),Tag::parse(["clone","https://community.test/original.git"]).unwrap()
        ]).sign_with_keys(&owner).unwrap();
        let root=EventBuilder::new(nostr::Kind::from(1618), "review").tags([
            Tag::parse(["a",coordinate.as_str()]).unwrap(),Tag::parse(["c","a".repeat(40).as_str()]).unwrap(),
            Tag::parse(["clone","https://community.test/root.git"]).unwrap()
        ]).sign_with_keys(&author).unwrap();
        let latest=EventBuilder::new(nostr::Kind::from(1619), "").tags([
            Tag::parse(["E",root.id.to_hex().as_str()]).unwrap(),Tag::parse(["c","b".repeat(40).as_str()]).unwrap(),
            Tag::parse(["clone","https://community.test/latest.git"]).unwrap()
        ]).custom_created_at(Timestamp::from_secs(Timestamp::now().as_secs()+10)).sign_with_keys(&owner).unwrap();
        let request:ProjectsPublishRequest=serde_json::from_value(serde_json::json!({"operation":"UPDATE_PULL_REQUEST",
            "targetEventId":root.id.to_hex(),"commit":"c".repeat(40),"mergeBase":"a".repeat(40)})).unwrap();
        assert_eq!(publication_kind(&request).unwrap(),1619);
        let built=pull_request_update_builder(&request,&root,&repository,Some(&latest),&author.public_key().to_hex(),"community.test")
            .unwrap().sign_with_keys(&author).unwrap();
        assert_eq!(built.created_at.as_secs(),latest.created_at.as_secs()+1);
        assert_eq!(first_tag(&built,"clone"),Some("https://community.test/latest.git"));
        assert!(pull_request_update_matches(&request,&root,&built).unwrap());
        let epoch=buzz_core::publication::PUBLICATION_EPOCH_TAG;
        let with_epoch=EventBuilder::new(nostr::Kind::from(1619), "").tags(built.tags.iter().cloned().chain([
            Tag::parse([epoch,"11111111-1111-4111-8111-111111111111"]).unwrap()
        ])).allow_self_tagging().sign_with_keys(&author).unwrap();
        assert!(pull_request_update_matches(&request,&root,&with_epoch).unwrap());
        assert!(pull_request_update_builder(&request,&root,&repository,None,&stranger.public_key().to_hex(),"community.test").is_err());
        let mut changed=request.clone();changed.commit=Some("d".repeat(40));
        assert!(!pull_request_update_matches(&changed,&root,&built).unwrap());
        changed=request.clone();changed.body=Some("injected".into());assert!(publication_kind(&changed).is_err());
        let forged=EventBuilder::new(nostr::Kind::from(1619), "").tags(built.tags.iter().cloned()).allow_self_tagging()
            .sign_with_keys(&stranger).unwrap();
        assert!(!pull_request_update_matches(&request,&root,&forged).unwrap());
    }

}
