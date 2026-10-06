//! Signed-event builders for desktop write operations.
//!
//! Mirrors the buzz-sdk builder patterns but uses nostr 0.37 API
//! (the desktop is excluded from the workspace which pins nostr 0.36).
//!
//! Mental model:
//!   caller params → build_*() → EventBuilder → submit_event() signs + POSTs
//!
//! Each function validates inputs and returns a nostr::EventBuilder.
//! Signing and submission happen in relay::submit_event.
use nostr::{EventBuilder, EventId, Kind, Tag};
use uuid::Uuid;

mod message_tags;

use message_tags::{
    append_client_tags, append_sent_from_thread_tag, emoji_tags, imeta_tags, mention_reference_tags,
};
// ── Constants ────────────────────────────────────────────────────────────────

/// Maximum content size — matches buzz-sdk (64 KiB).
const MAX_CONTENT_BYTES: usize = 64 * 1024;

/// Maximum mention count — matches buzz-sdk.
const MAX_MENTIONS: usize = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

fn tag(parts: Vec<&str>) -> Result<Tag, String> {
    Tag::parse(parts).map_err(|e| format!("invalid tag: {e}"))
}

fn check_content(content: &str) -> Result<(), String> {
    if content.len() > MAX_CONTENT_BYTES {
        return Err(format!(
            "content exceeds maximum size of {} bytes (got {})",
            MAX_CONTENT_BYTES,
            content.len()
        ));
    }
    Ok(())
}

/// NIP-10 thread reference.
pub struct ThreadRef {
    pub root_event_id: EventId,
    pub parent_event_id: EventId,
}

/// Native forum event kinds from Buzz; not an arbitrary event-kind override.
#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ForumMessageKind {
    Post,
    Reply,
}

fn thread_tags(tr: &ThreadRef) -> Result<Vec<Tag>, String> {
    let root = tr.root_event_id.to_hex();
    let parent = tr.parent_event_id.to_hex();
    if root == parent {
        Ok(vec![tag(vec!["e", &root, "", "reply"])?])
    } else {
        Ok(vec![
            tag(vec!["e", &root, "", "root"])?,
            tag(vec!["e", &parent, "", "reply"])?,
        ])
    }
}

fn mention_tags(mentions: &[&str]) -> Result<Vec<Tag>, String> {
    if mentions.len() > MAX_MENTIONS {
        return Err(format!("too many mentions (max {MAX_MENTIONS})"));
    }
    let mut seen = std::collections::HashSet::new();
    let mut tags = Vec::new();
    for &hex in mentions {
        check_pubkey(hex)?;
        let lower = hex.to_ascii_lowercase();
        if seen.insert(lower.clone()) {
            tags.push(tag(vec!["p", &lower])?);
        }
    }
    Ok(tags)
}

/// Validate a hex pubkey is exactly 64 hex characters.
fn check_pubkey(pubkey: &str) -> Result<(), String> {
    if pubkey.len() != 64 || !pubkey.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!(
            "pubkey must be a 64-character hex string (got {} chars)",
            pubkey.len()
        ));
    }
    Ok(())
}

// ── Messages ─────────────────────────────────────────────────────────────────

/// Kind 9 — stream message.
#[allow(clippy::too_many_arguments)]
pub fn build_message(
    channel_id: Uuid,
    content: &str,
    thread_ref: Option<&ThreadRef>,
    mentions: &[&str],
    media_tags: &[Vec<String>],
    custom_emoji_tags: &[Vec<String>],
    mention_ref_tags: &[Vec<String>],
    link_preview_tags: &[Vec<String>],
    sent_from_thread_tag: Option<&[String]>,
    relay_base: &str,
) -> Result<EventBuilder, String> {
    build_message_with_client_tags(
        channel_id,
        content,
        thread_ref,
        mentions,
        media_tags,
        custom_emoji_tags,
        mention_ref_tags,
        link_preview_tags,
        sent_from_thread_tag,
        relay_base,
        &[],
    )
}

/// Kind 9 — stream message with internal client marker tags.
///
/// This is intentionally narrower than arbitrary extra tags: callers can add
/// only `["client", ...]` tags, which are useful for idempotency markers but
/// cannot forge channel/thread/mention metadata.
#[allow(clippy::too_many_arguments)]
pub fn build_message_with_client_tags(
    channel_id: Uuid,
    content: &str,
    thread_ref: Option<&ThreadRef>,
    mentions: &[&str],
    media_tags: &[Vec<String>],
    custom_emoji_tags: &[Vec<String>],
    mention_ref_tags: &[Vec<String>],
    link_preview_tags: &[Vec<String>],
    sent_from_thread_tag: Option<&[String]>,
    relay_base: &str,
    client_tags: &[Vec<String>],
) -> Result<EventBuilder, String> {
    build_message_for_surface(
        channel_id,
        content,
        thread_ref,
        mentions,
        media_tags,
        custom_emoji_tags,
        mention_ref_tags,
        link_preview_tags,
        sent_from_thread_tag,
        relay_base,
        client_tags,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn build_message_for_surface(
    channel_id: Uuid,
    content: &str,
    thread_ref: Option<&ThreadRef>,
    mentions: &[&str],
    media_tags: &[Vec<String>],
    custom_emoji_tags: &[Vec<String>],
    mention_ref_tags: &[Vec<String>],
    link_preview_tags: &[Vec<String>],
    sent_from_thread_tag: Option<&[String]>,
    relay_base: &str,
    client_tags: &[Vec<String>],
    forum_kind: Option<ForumMessageKind>,
) -> Result<EventBuilder, String> {
    let kind = match forum_kind {
        None => 9,
        Some(ForumMessageKind::Post) if thread_ref.is_none() => 45001,
        Some(ForumMessageKind::Reply) if thread_ref.is_some() => 45003,
        Some(_) => return Err("forum post/reply thread reference mismatch".into()),
    };
    if sent_from_thread_tag.is_some() && thread_ref.is_some() {
        return Err("sent-from-thread provenance requires a top-level message".into());
    }
    check_content(content)?;
    let mut tags = vec![tag(vec!["h", &channel_id.to_string()])?];
    if let Some(tr) = thread_ref {
        tags.extend(thread_tags(tr)?);
    }
    tags.extend(mention_tags(mentions)?);
    imeta_tags(media_tags, &mut tags)?;
    emoji_tags(custom_emoji_tags, &mut tags)?;
    mention_reference_tags(mention_ref_tags, &mut tags)?;
    crate::link_preview_tags::append(link_preview_tags, relay_base, &mut tags)?;
    append_sent_from_thread_tag(sent_from_thread_tag, &mut tags)?;
    append_client_tags(client_tags, &mut tags)?;
    Ok(EventBuilder::new(Kind::Custom(kind), content).tags(tags))
}

pub struct MessageEditTags<'a> {
    pub media: &'a [Vec<String>],
    pub custom_emoji: &'a [Vec<String>],
    pub mentions: &'a [&'a str],
    pub mention_refs: Option<&'a [Vec<String>]>,
}

/// Kind 40003 — edit a message with full content, media, emoji, mentions,
/// and optional monotonic link-preview suppression.
pub fn build_message_edit(
    channel_id: Uuid,
    target_event_id: EventId,
    content: &str,
    edit_tags: MessageEditTags<'_>,
    suppress_link_previews: bool,
) -> Result<EventBuilder, String> {
    check_content(content)?;
    let mut tags = vec![
        tag(vec!["h", &channel_id.to_string()])?,
        tag(vec!["e", &target_event_id.to_hex()])?,
    ];
    tags.extend(mention_tags(edit_tags.mentions)?);
    imeta_tags(edit_tags.media, &mut tags)?;
    emoji_tags(edit_tags.custom_emoji, &mut tags)?;
    if let Some(mention_refs) = edit_tags.mention_refs {
        mention_reference_tags(mention_refs, &mut tags)?;
        tags.push(tag(vec!["buzz:mention-snapshot"])?);
    }
    if suppress_link_previews {
        tags.push(tag(vec!["link-preview", "none"])?);
    }
    Ok(EventBuilder::new(Kind::Custom(40003), content).tags(tags))
}

#[cfg(test)]
mod forum_tests {
    use super::*;

    #[test]
    fn forum_events_preserve_channel_thread_and_signer_evidence() {
        let keys = nostr::Keys::generate();
        let channel = Uuid::new_v4();
        let root = EventId::from_hex("11".repeat(32)).unwrap();
        let reference = ThreadRef {
            root_event_id: root,
            parent_event_id: root,
        };
        for (kind, thread, expected) in [
            (None, None, 9),
            (Some(ForumMessageKind::Post), None, 45001),
            (Some(ForumMessageKind::Reply), Some(&reference), 45003),
        ] {
            let event = build_message_for_surface(
                channel,
                "body",
                thread,
                &[],
                &[],
                &[],
                &[],
                &[],
                None,
                "",
                &[],
                kind,
            )
            .unwrap()
            .sign_with_keys(&keys)
            .unwrap();
            assert_eq!(event.kind.as_u16(), expected);
            assert_eq!(event.pubkey, keys.public_key());
            event.verify().unwrap();
            assert!(event
                .tags
                .iter()
                .any(|tag| tag.as_slice() == ["h", &channel.to_string()]));
            if expected == 45003 {
                assert!(event
                    .tags
                    .iter()
                    .any(|tag| tag.as_slice() == ["e", &root.to_hex(), "", "reply"]));
            }
        }
        assert!(build_message_for_surface(
            channel,
            "body",
            Some(&reference),
            &[],
            &[],
            &[],
            &[],
            &[],
            None,
            "",
            &[],
            Some(ForumMessageKind::Post)
        )
        .is_err());
        assert!(build_message_for_surface(
            channel,
            "body",
            None,
            &[],
            &[],
            &[],
            &[],
            &[],
            None,
            "",
            &[],
            Some(ForumMessageKind::Reply)
        )
        .is_err());
    }
}
