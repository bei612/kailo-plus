//! DD-151(3)(4): which recipient a Relay message notifies, and the content-free payload.
//!
//! Pure functions only, so the original `shouldNotifyForEvent` order is testable without a
//! database or Relay: broadcast and mentions win over a muted channel; a muted channel ends
//! the rest; then direct messages; then replies in a muted thread stop, and replies in a
//! followed or authored thread notify. Top-level messages in an ordinary channel do not push
//! (the unread badge covers them); that is the DD-151(3) recipient set.

use std::collections::BTreeSet;

use serde_json::{json, Value};

/// Original channel message kinds (`EventKind.channelMessageEventKinds`).
pub(crate) const MESSAGE_KINDS: [u64; 2] = [9, 40002];

/// Why a recipient is notified. It selects the localized system text; nothing else of the
/// message reaches the provider.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Reason {
    Mention,
    DirectMessage,
    Thread,
}

/// The parts of a Relay event the decision reads. The body (`content`) is deliberately absent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MessageFacts {
    pub id: String,
    pub author: String,
    pub created_at: u64,
    pub channel_id: String,
    pub broadcast: bool,
    pub mentioned: BTreeSet<String>,
    pub parent_id: Option<String>,
    pub root_id: Option<String>,
}

impl MessageFacts {
    /// Read the facts from a Relay event; `None` for anything that is not a well-formed
    /// channel message (wrong kind, missing `h`, bad ids).
    pub(crate) fn from_event(event: &Value) -> Option<Self> {
        let kind = event.get("kind")?.as_u64()?;
        if !MESSAGE_KINDS.contains(&kind) {
            return None;
        }
        let id = hex64(event.get("id")?.as_str()?)?;
        let author = hex64(event.get("pubkey")?.as_str()?)?;
        let created_at = event.get("created_at")?.as_u64()?;
        let tags: Vec<Vec<&str>> = event
            .get("tags")?
            .as_array()?
            .iter()
            .filter_map(|tag| {
                tag.as_array()
                    .map(|parts| parts.iter().filter_map(Value::as_str).collect())
            })
            .collect();
        let channel_id = tags
            .iter()
            .find(|t| t.first() == Some(&"h") && t.len() >= 2)
            .map(|t| t[1].to_owned())?;
        let broadcast = tags
            .iter()
            .any(|t| t.first() == Some(&"broadcast") && t.get(1) == Some(&"1"));
        let mentioned = tags
            .iter()
            .filter(|t| t.first() == Some(&"p") && t.len() >= 2)
            .filter_map(|t| hex64(t[1]))
            .collect();
        // Desktop/mobile convention: the `reply` marker is the parent, `root` the root;
        // without a reply marker the event is top level.
        let marked = |marker: &str| {
            tags.iter()
                .find(|t| t.first() == Some(&"e") && t.len() >= 4 && t[3] == marker)
                .and_then(|t| hex64(t[1]))
        };
        let parent_id = marked("reply");
        let root_id = parent_id
            .as_ref()
            .map(|parent| marked("root").unwrap_or(parent.clone()));
        Some(Self {
            id,
            author,
            created_at,
            channel_id,
            broadcast,
            mentioned,
            parent_id,
            root_id,
        })
    }
}

fn hex64(value: &str) -> Option<String> {
    let lower = value.to_ascii_lowercase();
    (lower.len() == 64 && lower.bytes().all(|b| b.is_ascii_hexdigit())).then_some(lower)
}

/// What the recipient's current preferences and facts say about this message.
#[derive(Clone, Debug)]
pub(crate) struct RecipientView<'a> {
    /// Every ACTIVE public key of the recipient (Web SERVER key and device keys).
    pub pubkeys: &'a BTreeSet<String>,
    /// The channel is a private conversation the recipient takes part in.
    pub direct_message: bool,
    /// `workspace_preferences.muted` or `conversation_preferences.muted`.
    pub channel_muted: bool,
    pub thread_muted: bool,
    pub thread_followed: bool,
    /// The thread root was written by one of the recipient's keys.
    pub thread_authored: bool,
}

impl<'a> RecipientView<'a> {
    pub(crate) fn new(pubkeys: &'a BTreeSet<String>) -> Self {
        Self {
            pubkeys,
            direct_message: false,
            channel_muted: false,
            thread_muted: false,
            thread_followed: false,
            thread_authored: false,
        }
    }
}

/// The original order (`shouldNotifyForEvent`), narrowed to the DD-151(3) push set.
pub(crate) fn decide(message: &MessageFacts, recipient: &RecipientView<'_>) -> Option<Reason> {
    if recipient.pubkeys.contains(&message.author) {
        return None;
    }
    if message.broadcast
        || message
            .mentioned
            .iter()
            .any(|p| recipient.pubkeys.contains(p))
    {
        return Some(Reason::Mention);
    }
    if recipient.channel_muted {
        return None;
    }
    if message.parent_id.is_none() {
        return recipient.direct_message.then_some(Reason::DirectMessage);
    }
    if recipient.thread_muted {
        return None;
    }
    if recipient.direct_message {
        return Some(Reason::DirectMessage);
    }
    (recipient.thread_followed || recipient.thread_authored).then_some(Reason::Thread)
}

/// Localized system text (DD-151(4)): fixed strings, never message content or names.
pub(crate) fn alert_text(reason: Reason, locale: &str) -> &'static str {
    match (reason, locale) {
        (Reason::Mention, "zh-CN") => "有人提及了你",
        (Reason::Mention, _) => "Someone mentioned you",
        (Reason::DirectMessage, "zh-CN") => "你有一条新私信",
        (Reason::DirectMessage, _) => "You have a new direct message",
        (Reason::Thread, "zh-CN") => "你关注的线程有新回复",
        (Reason::Thread, _) => "New reply in a thread you follow",
    }
}

/// The opaque navigation target and collapse key the provider carries.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Target {
    pub tenant_id: String,
    pub channel_id: String,
    pub event_id: String,
    /// Same conversation or thread collapses into one visible notification.
    pub collapse_key: String,
}

pub(crate) fn target(tenant_id: &str, message: &MessageFacts) -> Target {
    let collapse_key = match &message.root_id {
        Some(root) => format!("t:{}", &root[..32]),
        None => format!(
            "c:{}",
            message.channel_id.chars().take(36).collect::<String>()
        ),
    };
    Target {
        tenant_id: tenant_id.to_owned(),
        channel_id: message.channel_id.clone(),
        event_id: message.id.clone(),
        collapse_key,
    }
}

/// APNs body (DD-151(4)): `aps` alert is the localized fixed text; `kailo_push` holds only ids.
/// `mutable-content` lets the notification extension replace the text after reading the
/// message through the user's own session.
pub(crate) fn apns_payload(target: &Target, reason: Reason, locale: &str) -> Value {
    json!({
        "aps": {
            "alert": {"body": alert_text(reason, locale)},
            "sound": "default",
            "thread-id": target.collapse_key,
            "mutable-content": 1
        },
        "kailo_push": {
            "tenant_id": target.tenant_id,
            "channel_id": target.channel_id,
            "event_id": target.event_id
        }
    })
}

/// FCM v1 `message` (without `token`): notification body is the localized fixed text, data
/// carries only ids.
pub(crate) fn fcm_message(target: &Target, reason: Reason, locale: &str) -> Value {
    json!({
        "notification": {"body": alert_text(reason, locale)},
        "data": {
            "tenant_id": target.tenant_id,
            "channel_id": target.channel_id,
            "event_id": target.event_id
        },
        "android": {"collapse_key": target.collapse_key, "priority": "HIGH"}
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ME: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const OTHER: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const ROOT: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const ID: &str = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

    fn event(tags: Value) -> Value {
        json!({"id": ID, "pubkey": OTHER, "created_at": 1_767_225_600u64, "kind": 9,
               "tags": tags, "content": "secret body text", "sig": "00"})
    }

    fn me() -> BTreeSet<String> {
        BTreeSet::from([ME.to_owned()])
    }

    #[test]
    fn reads_channel_thread_and_mentions_without_the_body() {
        let facts = MessageFacts::from_event(&event(json!([
            ["h", "chan-1"],
            ["p", ME.to_uppercase()],
            ["e", ROOT, "", "root"],
            ["e", ROOT, "", "reply"]
        ])))
        .unwrap();
        assert_eq!(facts.channel_id, "chan-1");
        assert!(facts.mentioned.contains(ME));
        assert_eq!(facts.root_id.as_deref(), Some(ROOT));
        assert!(!format!("{facts:?}").contains("secret body text"));
        assert!(MessageFacts::from_event(&json!({"kind": 7})).is_none());
        assert!(
            MessageFacts::from_event(&event(json!([["p", ME]]))).is_none(),
            "no h tag"
        );
    }

    #[test]
    fn follows_the_original_order() {
        let keys = me();
        let top = MessageFacts::from_event(&event(json!([["h", "c"]]))).unwrap();
        let mention = MessageFacts::from_event(&event(json!([["h", "c"], ["p", ME]]))).unwrap();
        let reply = MessageFacts::from_event(&event(json!([
            ["h", "c"],
            ["e", ROOT, "", "root"],
            ["e", ROOT, "", "reply"]
        ])))
        .unwrap();
        let base = RecipientView::new(&keys);
        // Mentions win even over a muted channel.
        let muted = RecipientView {
            channel_muted: true,
            ..base.clone()
        };
        assert_eq!(decide(&mention, &muted), Some(Reason::Mention));
        assert_eq!(decide(&top, &muted), None);
        // Ordinary top-level channel traffic does not push; a DM does.
        assert_eq!(decide(&top, &base), None);
        let dm = RecipientView {
            direct_message: true,
            ..base.clone()
        };
        assert_eq!(decide(&top, &dm), Some(Reason::DirectMessage));
        let dm_muted = RecipientView {
            channel_muted: true,
            ..dm.clone()
        };
        assert_eq!(decide(&top, &dm_muted), None);
        // Threads: muted stops, followed or authored notifies.
        assert_eq!(decide(&reply, &base), None);
        let followed = RecipientView {
            thread_followed: true,
            ..base.clone()
        };
        assert_eq!(decide(&reply, &followed), Some(Reason::Thread));
        let authored = RecipientView {
            thread_authored: true,
            ..base.clone()
        };
        assert_eq!(decide(&reply, &authored), Some(Reason::Thread));
        let thread_muted = RecipientView {
            thread_muted: true,
            thread_followed: true,
            ..base.clone()
        };
        assert_eq!(decide(&reply, &thread_muted), None);
        // Own messages never notify, from any of the recipient's keys.
        let own = MessageFacts {
            author: ME.to_owned(),
            ..mention.clone()
        };
        assert_eq!(decide(&own, &base), None);
    }

    #[test]
    fn payloads_carry_ids_and_fixed_text_only() {
        let facts = MessageFacts::from_event(&event(json!([["h", "chan-1"], ["p", ME]]))).unwrap();
        let target = target("tenant-1", &facts);
        for body in [
            apns_payload(&target, Reason::Mention, "zh-CN"),
            fcm_message(&target, Reason::Mention, "en"),
        ] {
            let text = body.to_string();
            assert!(!text.contains("secret body text"));
            assert!(text.contains(ID) && text.contains("chan-1") && text.contains("tenant-1"));
        }
        assert_eq!(
            apns_payload(&target, Reason::Mention, "zh-CN")["aps"]["alert"]["body"],
            "有人提及了你"
        );
        assert!(target.collapse_key.len() <= 64);
    }
}
