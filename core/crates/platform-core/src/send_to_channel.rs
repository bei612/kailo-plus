//! DD-125(1) 原 Buzz “Send to channel”（SF-BUZ-56(2)）。
//!
//! 固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的 Desktop 只对本人（或本人
//! Agent）的线程回复提供该菜单项：以本人身份发一条新的顶层 kind:9，复制回复的正文与
//! emoji/imeta/link-preview/mention 标签，重算 `p` 提及并排除源作者，另带
//! `buzz:sent-from-thread`（根事件 ID 与至多 64 字符摘录）。原实现位于
//! `desktop/src/features/messages/lib/{sendToChannelSemantics,sentFromThread,
//! canSendToChannel}.ts` 与 `desktop/src-tauri/src/events/message_tags.rs`。
//!
//! Web 不持钥、也不得提交原始标签：Browser 只给出源回复的事件 ID，本模块在当前
//! Channel 以本人身份回读源回复、其根与两者最新的作者编辑，按原规则计算正文与标签。
//! “本人 Agent” 映射为本人是其 Installation owner（DD-125(1)）。签名、DISPATCH 与
//! 对账沿用 `web_transport::publish` 的 DD-81 路径，不新增 Relay kind 或动作键。

use std::collections::HashSet;

use axum::{http::StatusCode, response::Response};
use collab_bridge::bridge::{
    message_kind, parse_thread_markers, IdentityClient, KIND_STREAM_MESSAGE_EDIT,
};
use contracts::{ErrorClass, ReasonCode};
use uuid::Uuid;

use crate::bff::{BffState, ExecutionContext};
use crate::web_transport::{error_body, read_message_event, relay_error_response};

pub(crate) const SENT_FROM_THREAD_TAG: &str = "buzz:sent-from-thread";
const MENTION_SNAPSHOT_TAG: &str = "buzz:mention-snapshot";
const THREAD_ROOT_EXCERPT_MAX_LENGTH: usize = 64;
const SHAREABLE_TAG_KINDS: [&str; 4] = ["emoji", "imeta", "link-preview", "mention"];

/// The signed body of the new top-level message, all derived from Relay evidence.
#[derive(Debug, PartialEq)]
pub(crate) struct Prepared {
    pub content: String,
    pub tags: Vec<Vec<String>>,
    pub mentions: Vec<String>,
}

/// A request naming a source carries nothing else: body, tags and audience come
/// only from the re-read source, never from the browser.
pub(crate) fn valid_request(request: &contracts::WebPublishMessageRequest) -> bool {
    let Some(id) = request.send_to_channel_source_event_id.as_deref() else {
        return true;
    };
    let canonical = nostr::EventId::from_hex(id).is_ok_and(|parsed| parsed.to_hex() == id);
    let stream = match &request.message_type {
        Some(kind) => *kind == contracts::WebMessageType::Stream,
        None => true,
    };
    canonical
        && stream
        && request.parent_event_id.is_none()
        && request.edit_event_id.is_none()
        && request.delete_event_id.is_none()
        && request.content.is_empty()
        && request.attachments.as_ref().is_none_or(Vec::is_empty)
        && request.mention_pubkeys.as_ref().is_none_or(Vec::is_empty)
        && request
            .mention_installation_ids
            .as_ref()
            .is_none_or(Vec::is_empty)
}

fn tag_name(tag: &[String]) -> &str {
    tag.first().map(String::as_str).unwrap_or_default()
}

fn is_agent_address(tag: &[String]) -> bool {
    tag_name(tag) == "mention" && tag.get(2).is_some_and(|marker| marker == "agent-address")
}

/// Original `applyEditTagOverlay`: imeta always from the edit, p joins, emoji
/// replaced only when the edit supplies any, authored mentions replaced only by an
/// edit carrying the snapshot marker; every structural tag stays the original's.
pub(crate) fn apply_edit_tag_overlay(
    original: &[Vec<String>],
    edit: &[Vec<String>],
) -> Vec<Vec<String>> {
    let edit_has_emoji = edit.iter().any(|tag| tag_name(tag) == "emoji");
    let has_snapshot = edit.iter().any(|tag| tag_name(tag) == MENTION_SNAPSHOT_TAG);
    let mut merged = Vec::new();
    for tag in original {
        let name = tag_name(tag);
        let replaced = name == "imeta"
            || edit_has_emoji && name == "emoji"
            || has_snapshot && name == "mention" && !is_agent_address(tag);
        if !replaced {
            merged.push(tag.clone());
        }
    }
    for tag in edit {
        if matches!(tag_name(tag), "imeta" | "p" | MENTION_SNAPSHOT_TAG) {
            merged.push(tag.clone());
        }
    }
    for tag in edit {
        if tag_name(tag) == "emoji" {
            merged.push(tag.clone());
        }
    }
    for tag in edit {
        if tag_name(tag) == "mention" && !is_agent_address(tag) {
            merged.push(tag.clone());
        }
    }
    merged
}

fn normalize_pubkey(value: &str) -> String {
    value.trim().to_lowercase()
}

fn tag_value(tag: &[String]) -> String {
    normalize_pubkey(tag.get(1).map(String::as_str).unwrap_or_default())
}

fn is_pubkey(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Original `getSendToChannelSemantics`. Returns the recomputed mention pubkeys (source
/// authors excluded) and the copied semantic tags. The original legacy branch for an
/// edit without a mention snapshot orders mentions by display names found in the body;
/// Core has no profile names, so that branch keeps the notified `p` set unfiltered.
pub(crate) fn semantics(
    source_authors: &[String],
    tags: &[Vec<String>],
    edited: bool,
) -> (Vec<String>, Vec<Vec<String>>) {
    let authors: HashSet<String> = source_authors
        .iter()
        .map(|key| normalize_pubkey(key.as_str()))
        .collect();
    let has_snapshot = edited && tags.iter().any(|tag| tag_name(tag) == MENTION_SNAPSHOT_TAG);
    let notified: HashSet<String> = tags
        .iter()
        .filter(|tag| tag_name(tag) == "p")
        .map(|tag| tag_value(tag.as_slice()))
        .collect();
    let mut effective: Option<HashSet<String>> = None;
    if has_snapshot {
        let mut current = HashSet::new();
        for tag in tags {
            let agent_listed = is_agent_address(tag) && notified.contains(&tag_value(tag));
            let listed = tag.len() == 2 || agent_listed;
            if tag_name(tag) == "mention" && listed && is_pubkey(&tag_value(tag)) {
                current.insert(tag_value(tag));
            }
        }
        effective = Some(current);
    }
    let suppressed = tags
        .iter()
        .any(|tag| tag.len() == 2 && tag[0] == "link-preview" && tag[1] == "none");
    let audience_tag = if has_snapshot { "mention" } else { "p" };
    let mut seen = HashSet::new();
    let mut mentions = Vec::new();
    let mut semantic = Vec::new();
    for tag in tags {
        let name = tag_name(tag);
        if name == audience_tag {
            let key = tag_value(tag);
            let current = effective.as_ref().is_none_or(|set| set.contains(&key));
            if is_pubkey(&key) && !authors.contains(&key) && current && seen.insert(key.clone()) {
                mentions.push(key);
            }
            if name == "p" {
                continue;
            }
        }
        if !SHAREABLE_TAG_KINDS.contains(&name) {
            continue;
        }
        let marker = tag.len() == 2 && name == "link-preview" && tag[1] == "none";
        if name == "link-preview" && suppressed && !marker {
            continue;
        }
        semantic.push(tag.clone());
    }
    (mentions, semantic)
}

fn is_control(c: char) -> bool {
    let code = u32::from(c);
    code <= 0x1f || (0x7f..=0x9f).contains(&code)
}

/// `/\|\|[^|]*(?:\|(?!\|)[^|]*)*\|\|/g` → " ": a spoiler span ends at the first `||`.
fn strip_spoilers(input: &[char]) -> Vec<char> {
    let mut out = Vec::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        if input[i] == '|' && input.get(i + 1) == Some(&'|') {
            let end = input.len().saturating_sub(1);
            let close = (i + 2..end).find(|&j| input[j] == '|' && input[j + 1] == '|');
            if let Some(j) = close {
                out.push(' ');
                i = j + 2;
                continue;
            }
        }
        out.push(input[i]);
        i += 1;
    }
    out
}

/// `[label](target)` starting at `i`: returns (closing bracket, closing paren).
fn markdown_link_at(input: &[char], i: usize) -> Option<(usize, usize)> {
    if input.get(i) != Some(&'[') {
        return None;
    }
    let close = (i + 1..input.len()).find(|&j| input[j] == ']')?;
    if input.get(close + 1) != Some(&'(') {
        return None;
    }
    let paren = (close + 2..input.len()).find(|&j| input[j] == ')')?;
    Some((close, paren))
}

/// `/!\[[^\]]*\]\([^)]*\)/g` → " ".
fn strip_images(input: &[char]) -> Vec<char> {
    let mut out = Vec::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        if input[i] == '!' {
            if let Some((_, paren)) = markdown_link_at(input, i + 1) {
                out.push(' ');
                i = paren + 1;
                continue;
            }
        }
        out.push(input[i]);
        i += 1;
    }
    out
}

/// `/\[([^\]]+)\]\([^)]*\)/g` → "$1" (the label must be non-empty).
fn unwrap_links(input: &[char]) -> Vec<char> {
    let mut out = Vec::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        if let Some((close, paren)) = markdown_link_at(input, i) {
            if close > i + 1 {
                out.extend_from_slice(&input[i + 1..close]);
                i = paren + 1;
                continue;
            }
        }
        out.push(input[i]);
        i += 1;
    }
    out
}

/// Index after `http://` or `https://` at `at` when at least one non-space follows.
fn url_body_at(input: &[char], at: usize) -> Option<usize> {
    for scheme in ["https://", "http://"] {
        let scheme: Vec<char> = scheme.chars().collect();
        let body = at + scheme.len();
        let matches = input.len() > body && input[at..body] == scheme[..];
        if matches && !input[body].is_whitespace() {
            return Some(body);
        }
    }
    None
}

/// `/<?https?:\/\/\S+>?/g` → " ".
fn strip_urls(input: &[char]) -> Vec<char> {
    let mut out = Vec::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        let bracketed = if input[i] == '<' {
            url_body_at(input, i + 1)
        } else {
            None
        };
        if let Some(mut end) = bracketed.or_else(|| url_body_at(input, i)) {
            while end < input.len() && !input[end].is_whitespace() {
                end += 1;
            }
            out.push(' ');
            i = end;
            continue;
        }
        out.push(input[i]);
        i += 1;
    }
    out
}

/// Original `summarizeThreadRoot`: a plain-text excerpt of at most 64 characters.
pub(crate) fn summarize_thread_root(content: &str) -> Option<String> {
    let chars: Vec<char> = content
        .chars()
        .map(|c| if is_control(c) { ' ' } else { c })
        .collect();
    let chars = strip_urls(&unwrap_links(&strip_images(&strip_spoilers(&chars))));
    let text: String = chars
        .into_iter()
        .map(|c| if "`*_~>#|".contains(c) { ' ' } else { c })
        .collect();
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return None;
    }
    let characters: Vec<char> = normalized.chars().collect();
    if characters.len() <= THREAD_ROOT_EXCERPT_MAX_LENGTH {
        return Some(normalized);
    }
    let clipped = &characters[..THREAD_ROOT_EXCERPT_MAX_LENGTH - 1];
    let excerpt = match clipped.iter().rposition(|c| *c == ' ') {
        Some(space) if space > 32 => &clipped[..space],
        _ => clipped,
    };
    let excerpt: String = excerpt.iter().collect();
    Some(format!("{}…", excerpt.trim_end()))
}

/// Original `buildSentFromThreadTag`.
pub(crate) fn sent_from_thread_tag(root: &str, excerpt: Option<&str>) -> Vec<String> {
    let mut tag = vec![SENT_FROM_THREAD_TAG.to_owned(), root.to_owned()];
    if let Some(excerpt) = excerpt.map(str::trim).filter(|value| !value.is_empty()) {
        tag.push(excerpt.to_owned());
    }
    tag
}

fn tags_of(event: &nostr::Event) -> Vec<Vec<String>> {
    event
        .tags
        .iter()
        .map(|tag| tag.as_slice().to_vec())
        .collect()
}

fn first_tag<'a>(event: &'a nostr::Event, name: &str) -> Option<&'a str> {
    let tag = event
        .tags
        .iter()
        .map(nostr::Tag::as_slice)
        .find(|tag| tag_name(tag) == name)?;
    tag.get(1).map(String::as_str)
}

/// Original `applyMessageEdits` selection: the newest edit signed by the target's
/// author in the same channel. Returns (body, tags, edited).
fn overlay(
    target: &nostr::Event,
    edits: &[nostr::Event],
    channel: &str,
) -> (String, Vec<Vec<String>>, bool) {
    let target_id = target.id.to_hex();
    let latest = edits
        .iter()
        .filter(|edit| {
            edit.kind.as_u16() == KIND_STREAM_MESSAGE_EDIT as u16
                && edit.pubkey == target.pubkey
                && first_tag(edit, "e") == Some(target_id.as_str())
                && first_tag(edit, "h") == Some(channel)
        })
        .max_by_key(|edit| (edit.created_at, edit.id));
    match latest {
        Some(edit) => {
            let tags = apply_edit_tag_overlay(&tags_of(target), &tags_of(edit));
            (edit.content.clone(), tags, true)
        }
        None => (target.content.clone(), tags_of(target), false),
    }
}

fn invalid_source() -> Response {
    error_body(
        StatusCode::BAD_REQUEST,
        ErrorClass::Precondition,
        ReasonCode::InvalidParameters,
        None,
    )
}

fn invalid_evidence() -> Response {
    error_body(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorClass::Precondition,
        ReasonCode::DependencyUnavailable,
        None,
    )
}

/// Original `canManageMessageForCurrentUser`: the reply is the caller's own (any of
/// the Principal's Buzz identities, DD-77) or signed by an Agent whose Installation
/// the caller owns. Anything else is refused before signing.
async fn author_admitted(
    state: &BffState,
    ctx: &ExecutionContext,
    author: &nostr::PublicKey,
) -> Result<bool, Response> {
    sqlx::query_scalar(
        "select exists(
             select 1 from identity.buzz_identity_binding b
             where b.tenant_id=$1 and b.pubkey=$2 and b.kind='HUMAN' and b.principal_id=$3)
           or exists(
             select 1 from identity.buzz_identity_binding b
             join catalog.agent_installation i on i.agent_principal_id=b.principal_id
             join catalog.resource r on r.id=i.resource_id and r.tenant_id=b.tenant_id
               and r.type_key='agent.installation'
             where b.tenant_id=$1 and b.pubkey=$2 and b.kind='AGENT'
               and r.owner_principal_id=$3)",
    )
    .bind(ctx.tenant_id)
    .bind(author.to_hex())
    .bind(ctx.tenant_principal_id)
    .fetch_one(&state.pool)
    .await
    .map_err(crate::service_api::unavailable)
}

/// Recomputed mentions stay HUMAN identities admitted to the destination, the same
/// rule as `mentionPubkeys`. Agent keys cannot trigger an Installation from here:
/// that requires the explicit Installation mention admission, which this copy
/// does not carry; their display-only `mention` tags are still copied.
async fn admitted_human_mentions(
    state: &BffState,
    ctx: &ExecutionContext,
    destination: (Option<Uuid>, Option<Uuid>),
    keys: &[String],
) -> Result<Vec<String>, Response> {
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    let (workspace, conversation) = destination;
    let found: Vec<String> = sqlx::query_scalar(
        "select b.pubkey from identity.buzz_identity_binding b
         join identity.principal p on p.id=b.principal_id and p.tenant_id=b.tenant_id
           and p.kind='HUMAN' and p.status='ACTIVE'
         join identity.tenant_membership tm on tm.tenant_principal_id=p.id
           and tm.tenant_id=p.tenant_id and tm.state='ACTIVE'
         join identity.human_identity h on h.id=tm.human_identity_id and h.status='ACTIVE'
         where b.tenant_id=$1 and b.kind='HUMAN' and b.state='ACTIVE' and b.pubkey=any($2)
           and (($3::uuid is not null and exists(select 1 from identity.workspace_membership wm
             join identity.workspace w on w.id=wm.workspace_id and w.tenant_id=b.tenant_id
               and w.state='ACTIVE'
             where wm.workspace_id=$3 and wm.tenant_principal_id=p.id and wm.state='ACTIVE'))
           or ($4::uuid is not null and exists(
             select 1 from projection.conversation_buzz_binding c
             where c.id=$4 and c.tenant_id=b.tenant_id and c.state='ACTIVE'
               and p.id=any(c.participant_principal_ids)
               and c.projected_keys @>
                 jsonb_build_array(jsonb_build_array(p.id::text,b.pubkey)))))",
    )
    .bind(ctx.tenant_id)
    .bind(keys)
    .bind(workspace)
    .bind(conversation)
    .fetch_all(&state.pool)
    .await
    .map_err(crate::service_api::unavailable)?;
    // Keep the source's mention order.
    let admitted = keys
        .iter()
        .filter(|key| found.contains(key))
        .cloned()
        .collect();
    Ok(admitted)
}

/// Re-read the source reply, its root and their latest author edits in the admitted
/// channel, check authorship, and derive the new message (original semantics).
/// `destination` is the admitted (Workspace, conversation) pair, exactly one set.
pub(crate) async fn prepare(
    state: &BffState,
    ctx: &ExecutionContext,
    client: &IdentityClient,
    channel: &str,
    source_id: &str,
    destination: (Option<Uuid>, Option<Uuid>),
) -> Result<Prepared, Response> {
    let source = read_message_event(state, client, channel, source_id).await?;
    if source.kind.as_u16() != message_kind(&contracts::WebMessageType::Stream) {
        return Err(invalid_source());
    }
    let Some((root_id, _)) = parse_thread_markers(&source.tags).resolve() else {
        return Err(invalid_source());
    };
    if !author_admitted(state, ctx, &source.pubkey).await? {
        return Err(error_body(
            StatusCode::FORBIDDEN,
            ErrorClass::Denied,
            ReasonCode::PermissionDenied,
            None,
        ));
    }
    let root = read_message_event(state, client, channel, &root_id).await?;
    let filter = |target: &nostr::Event| {
        serde_json::json!({
            "kinds": [KIND_STREAM_MESSAGE_EDIT], "#h": [channel],
            "#e": [target.id.to_hex()], "authors": [target.pubkey.to_hex()], "limit": 1,
        })
    };
    let page = client
        .query(&state.http, &[filter(&source), filter(&root)])
        .await
        .map_err(|error| relay_error_response(&error, None))?;
    let edits: Vec<nostr::Event> = serde_json::from_value(page).map_err(|_| invalid_evidence())?;
    if edits.len() > 2 || edits.iter().any(|edit| edit.verify().is_err()) {
        return Err(invalid_evidence());
    }
    let (body, tags, edited) = overlay(&source, &edits, channel);
    let (root_body, _, _) = overlay(&root, &edits, channel);
    let (mentions, mut semantic) = semantics(&[source.pubkey.to_hex()], &tags, edited);
    let mentions = admitted_human_mentions(state, ctx, destination, &mentions).await?;
    let excerpt = summarize_thread_root(&root_body);
    let thread_tag = sent_from_thread_tag(&root.id.to_hex(), excerpt.as_deref());
    semantic.push(thread_tag);
    Ok(Prepared {
        content: body,
        tags: semantic,
        mentions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tag(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn copies_only_semantic_tags_and_excludes_the_source_author() {
        let author = "a".repeat(64);
        let other = "b".repeat(64);
        let reply = "c".repeat(64);
        let tags = [
            tag(&["h", "channel"]),
            tag(&["e", &reply, "", "reply"]),
            tag(&["p", &author]),
            tag(&["p", &other]),
            tag(&["p", &other]),
            tag(&["imeta", "url https://relay.test/media/x.png"]),
            tag(&["emoji", "wave", "https://relay.test/media/w.png"]),
            tag(&["mention", &other]),
            tag(&["link-preview", "snapshot"]),
            tag(&["client", "marker"]),
        ];
        let (mentions, semantic) = semantics(&[author], &tags, false);
        assert_eq!(mentions, vec![other.clone()]);
        assert_eq!(
            semantic,
            vec![
                tag(&["imeta", "url https://relay.test/media/x.png"]),
                tag(&["emoji", "wave", "https://relay.test/media/w.png"]),
                tag(&["mention", &other]),
                tag(&["link-preview", "snapshot"]),
            ]
        );
    }

    #[test]
    fn preview_suppression_drops_snapshots_but_keeps_the_marker() {
        let tags = [
            tag(&["link-preview", "snapshot", "x"]),
            tag(&["link-preview", "none"]),
        ];
        let (_, semantic) = semantics(&[], &tags, false);
        assert_eq!(semantic, vec![tag(&["link-preview", "none"])]);
    }

    #[test]
    fn an_edit_snapshot_is_the_complete_current_audience() {
        let kept = "d".repeat(64);
        let dropped = "e".repeat(64);
        let tags = [
            tag(&["p", &dropped]),
            tag(&["p", &kept]),
            tag(&["buzz:mention-snapshot"]),
            tag(&["mention", &kept]),
        ];
        let (mentions, semantic) = semantics(&[], &tags, true);
        assert_eq!(mentions, vec![kept.clone()]);
        assert_eq!(semantic, vec![tag(&["mention", &kept])]);
    }

    #[test]
    fn edit_overlay_matches_the_original_merge() {
        let original = [
            tag(&["h", "c"]),
            tag(&["imeta", "old"]),
            tag(&["emoji", "a", "u"]),
            tag(&["mention", "m1"]),
            tag(&["mention", "m2", "agent-address"]),
        ];
        let edit = [
            tag(&["h", "forged"]),
            tag(&["imeta", "new"]),
            tag(&["p", "p1"]),
            tag(&["buzz:mention-snapshot"]),
            tag(&["mention", "m3"]),
        ];
        assert_eq!(
            apply_edit_tag_overlay(&original, &edit),
            vec![
                tag(&["h", "c"]),
                tag(&["emoji", "a", "u"]),
                tag(&["mention", "m2", "agent-address"]),
                tag(&["imeta", "new"]),
                tag(&["p", "p1"]),
                tag(&["buzz:mention-snapshot"]),
                tag(&["mention", "m3"]),
            ]
        );
    }

    #[test]
    fn root_excerpt_follows_the_original_truncation() {
        assert_eq!(summarize_thread_root("  \n "), None);
        let markdown = "**Ship** the [plan](https://x.test) ||secret|| ![i](a.png) now";
        assert_eq!(
            summarize_thread_root(markdown),
            Some("Ship the plan now".into())
        );
        let links = "see <https://example.test/a> and https://b.test";
        assert_eq!(summarize_thread_root(links), Some("see and".into()));
        let long = "word ".repeat(30);
        let excerpt = summarize_thread_root(&long).unwrap();
        assert!(excerpt.chars().count() <= THREAD_ROOT_EXCERPT_MAX_LENGTH);
        assert_eq!(excerpt, format!("{}…", "word ".repeat(12).trim_end()));
    }

    #[test]
    fn sent_from_thread_tag_omits_an_empty_excerpt() {
        let root = "f".repeat(64);
        let bare = sent_from_thread_tag(&root, None);
        assert_eq!(bare, tag(&[SENT_FROM_THREAD_TAG, &root]));
        let quoted = sent_from_thread_tag(&root, Some(" hi "));
        assert_eq!(quoted, tag(&[SENT_FROM_THREAD_TAG, &root, "hi"]));
    }

    #[test]
    fn a_source_request_carries_nothing_else() {
        let id = "a".repeat(64);
        let request = |value: serde_json::Value| {
            serde_json::from_value::<contracts::WebPublishMessageRequest>(value).unwrap()
        };
        let base = serde_json::json!({"content": "", "sendToChannelSourceEventId": id});
        assert!(valid_request(&request(base.clone())));
        for (key, value) in [
            ("content", serde_json::json!("x")),
            ("parentEventId", serde_json::json!(id)),
            ("editEventId", serde_json::json!(id)),
            ("mentionPubkeys", serde_json::json!([id])),
            (
                "sendToChannelSourceEventId",
                serde_json::json!("A".repeat(64)),
            ),
            ("messageType", serde_json::json!("FORUM_POST")),
        ] {
            let mut invalid = base.clone();
            invalid[key] = value;
            assert!(!valid_request(&request(invalid)), "{key}");
        }
    }
}
