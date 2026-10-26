//! DD-151(3)(4): which recipient a Relay message notifies, and the content-free payload.
//!
//! DD-151/V-SCN-249 push exclusions take precedence over the original notification
//! reasons: own messages and muted channels/threads never push, including mentions and
//! broadcasts. The caller also excludes already-read messages. Eligible events
//! then follow the original mention, direct-message, followed/authored-thread order.
//! Desktop/Web in-app notifications retain their separate original mute semantics.

use std::collections::{BTreeSet, HashMap};

use serde_json::{json, Value};

/// Original channel message kinds (`EventKind.channelMessageEventKinds`).
pub(crate) const MESSAGE_KINDS: [u64; 4] = [9, 40002, 45001, 45003];

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

/// DD-151 push exclusions, followed by the original eligible-recipient reason order.
pub(crate) fn decide(message: &MessageFacts, recipient: &RecipientView<'_>) -> Option<Reason> {
    if recipient.pubkeys.contains(&message.author)
        || recipient.channel_muted
        || (message.parent_id.is_some() && recipient.thread_muted)
    {
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
    if message.parent_id.is_none() {
        return recipient.direct_message.then_some(Reason::DirectMessage);
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

/// Most notified events remembered per conversation or thread for the badge.
pub(crate) const BADGE_EVENTS_PER_CONTEXT: i64 = MAX_BADGE as i64;
/// Upper bound of the number shown on the app icon.
pub(crate) const MAX_BADGE: u32 = 999;

/// The `read_contexts` key whose read position covers this message (DD-40): the thread for a
/// reply, the channel (Workspace channel or direct message) otherwise.
pub(crate) fn unread_context(message: &MessageFacts) -> String {
    match &message.root_id {
        Some(root) => format!("thread:{root}"),
        None => message.channel_id.to_ascii_lowercase(),
    }
}

/// The recipient's current read positions as Unix seconds, from `read_contexts` (RFC 3339,
/// written by every client through the read-mark route). Unparseable values are ignored.
pub(crate) fn read_marks(read_contexts: &Value) -> HashMap<String, i64> {
    read_contexts
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(key, value)| {
            let at = chrono::DateTime::parse_from_rfc3339(value.as_str()?).ok()?;
            Some((key.to_ascii_lowercase(), at.timestamp()))
        })
        .collect()
}

/// One remembered context: the `read_contexts` key, the channel it lives in and the
/// `created_at` of the notified events in it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct UnreadContext {
    pub context_key: String,
    pub channel_id: String,
    pub event_times: Vec<i64>,
}

/// DD-151(4) badge: notified messages the recipient has not read yet. A message counts while
/// it is newer than both its own context's read position and its channel's (reading the
/// channel after a reply clears it too). Returns the badge and the contexts that are fully
/// read, which the caller forgets.
pub(crate) fn badge(
    contexts: &[UnreadContext],
    marks: &HashMap<String, i64>,
) -> (u32, Vec<String>) {
    let mut total: u64 = 0;
    let mut read = Vec::new();
    for context in contexts {
        let mark = read_position(&context.context_key, &context.channel_id, marks);
        let unread = context.event_times.iter().filter(|t| **t > mark).count() as u64;
        if unread == 0 {
            read.push(context.context_key.clone());
        }
        total += unread;
    }
    (total.min(u64::from(MAX_BADGE)) as u32, read)
}

/// A reply is read if either its thread or channel has advanced past it.
pub(crate) fn read_position(context: &str, channel: &str, marks: &HashMap<String, i64>) -> i64 {
    [
        marks.get(&context.to_ascii_lowercase()),
        marks.get(&channel.to_ascii_lowercase()),
    ]
    .into_iter()
    .flatten()
    .copied()
    .max()
    .unwrap_or(i64::MIN)
}

/// APNs body (DD-151(4)): `aps` alert is the localized fixed text; `kailo_push` holds only ids.
/// `mutable-content` lets the notification extension replace the text after reading the
/// message through the user's own session; `badge` is the unread count, never content.
pub(crate) fn apns_payload(target: &Target, reason: Reason, locale: &str, badge: u32) -> Value {
    json!({
        "aps": {
            "alert": {"body": alert_text(reason, locale)},
            "badge": badge,
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
/// carries only ids, and the Android notification count is the unread badge.
pub(crate) fn fcm_message(target: &Target, reason: Reason, locale: &str, badge: u32) -> Value {
    json!({
        "notification": {"body": alert_text(reason, locale)},
        "data": {
            "tenant_id": target.tenant_id,
            "channel_id": target.channel_id,
            "event_id": target.event_id
        },
        "android": {
            "collapse_key": target.collapse_key,
            "priority": "HIGH",
            "notification": {"notification_count": badge}
        }
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
    fn applies_push_exclusions_before_original_reasons() {
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
        // V-SCN-249: muted channels exclude mentions as well as ordinary messages.
        let muted = RecipientView {
            channel_muted: true,
            ..base.clone()
        };
        assert_eq!(decide(&mention, &muted), None);
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
    fn muted_threads_and_channels_exclude_mentions_broadcasts_and_direct_messages() {
        let keys = me();
        for kind in MESSAGE_KINDS {
            let mut input = event(json!([
                ["h", "c"], ["p", ME], ["broadcast", "1"],
                ["e", ROOT, "", "root"], ["e", ROOT, "", "reply"]
            ]));
            input["kind"] = json!(kind);
            let facts = MessageFacts::from_event(&input).unwrap();
            let base = RecipientView::new(&keys);
            assert_eq!(decide(&facts, &base), Some(Reason::Mention));
            for (channel_muted, thread_muted) in [(true, false), (false, true)] {
                let view = RecipientView {
                    channel_muted,
                    thread_muted,
                    direct_message: true,
                    thread_followed: true,
                    thread_authored: true,
                    ..base.clone()
                };
                assert_eq!(decide(&facts, &view), None, "kind {kind}");
            }
        }
    }

    #[test]
    fn original_forum_posts_and_comments_are_push_messages() {
        let keys = me();
        let mut post = event(json!([["h", "forum"], ["p", ME]]));
        post["kind"] = json!(45001);
        let facts = MessageFacts::from_event(&post).unwrap();
        assert_eq!(decide(&facts, &RecipientView::new(&keys)), Some(Reason::Mention));
        assert_eq!(unread_context(&facts), "forum");
        let mut reply = event(json!([["h", "forum"], ["e", ROOT, "", "reply"]]));
        reply["kind"] = json!(45003);
        let facts = MessageFacts::from_event(&reply).unwrap();
        let view = RecipientView { thread_followed: true, ..RecipientView::new(&keys) };
        assert_eq!(decide(&facts, &view), Some(Reason::Thread));
        assert_eq!(facts.root_id.as_deref(), Some(ROOT));
        assert_eq!(unread_context(&facts), format!("thread:{ROOT}"));
        reply["kind"] = json!(1111);
        assert!(MessageFacts::from_event(&reply).is_none());
    }

    #[test]
    fn payloads_carry_ids_and_fixed_text_only() {
        let facts = MessageFacts::from_event(&event(json!([["h", "chan-1"], ["p", ME]]))).unwrap();
        let target = target("tenant-1", &facts);
        for body in [
            apns_payload(&target, Reason::Mention, "zh-CN", 3),
            fcm_message(&target, Reason::Mention, "en", 3),
        ] {
            let text = body.to_string();
            assert!(!text.contains("secret body text"));
            assert!(text.contains(ID) && text.contains("chan-1") && text.contains("tenant-1"));
        }
        assert_eq!(
            apns_payload(&target, Reason::Mention, "zh-CN", 3)["aps"]["alert"]["body"],
            "有人提及了你"
        );
        assert!(target.collapse_key.len() <= 64);
    }

    #[test]
    fn badge_is_a_number_and_payloads_stay_content_free() {
        let facts = MessageFacts::from_event(&event(json!([["h", "chan-1"], ["p", ME]]))).unwrap();
        let target = target("tenant-1", &facts);
        let apns = apns_payload(&target, Reason::Mention, "en", 7);
        assert_eq!(apns["aps"]["badge"], 7);
        let fcm = fcm_message(&target, Reason::Mention, "en", 7);
        assert_eq!(fcm["android"]["notification"]["notification_count"], 7);
        for body in [apns, fcm] {
            assert!(!body.to_string().contains("secret body text"));
        }
    }

    #[test]
    fn unread_context_is_the_thread_for_replies_and_the_channel_otherwise() {
        let top = MessageFacts::from_event(&event(json!([["h", "CHAN-1"]]))).unwrap();
        assert_eq!(unread_context(&top), "chan-1");
        let reply = MessageFacts::from_event(&event(json!([
            ["h", "chan-1"],
            ["e", ROOT, "", "root"],
            ["e", ROOT, "", "reply"]
        ])))
        .unwrap();
        assert_eq!(unread_context(&reply), format!("thread:{ROOT}"));
    }

    #[test]
    fn read_marks_come_from_rfc3339_read_contexts() {
        let marks = read_marks(&json!({
            "CHAN-1": "2026-01-01T00:00:10Z",
            "thread:ab": "2026-01-01T00:00:20+00:00",
            "bad": "yesterday",
            "num": 5
        }));
        assert_eq!(marks.get("chan-1"), Some(&1_767_225_610));
        assert_eq!(marks.get("thread:ab"), Some(&1_767_225_620));
        assert_eq!(marks.len(), 2);
    }

    #[test]
    fn badge_counts_only_what_is_newer_than_the_read_positions() {
        let channel = UnreadContext {
            context_key: "chan-1".into(),
            channel_id: "chan-1".into(),
            event_times: vec![10, 20, 30],
        };
        let thread = UnreadContext {
            context_key: "thread:ab".into(),
            channel_id: "chan-1".into(),
            event_times: vec![15, 25],
        };
        let contexts = [channel, thread];
        // Nothing read yet: every notified message counts.
        let (n, read) = badge(&contexts, &HashMap::new());
        assert_eq!((n, read.len()), (5, 0));
        // The thread was read up to 25 and the channel up to 20.
        let marks = HashMap::from([("chan-1".to_owned(), 20), ("thread:ab".to_owned(), 25)]);
        let (n, read) = badge(&contexts, &marks);
        assert_eq!(n, 1);
        assert_eq!(read, vec!["thread:ab".to_owned()]);
        // Reading the channel past a reply clears the reply as well.
        let marks = HashMap::from([("chan-1".to_owned(), 30)]);
        let (n, read) = badge(&contexts, &marks);
        assert_eq!(n, 0);
        assert_eq!(read.len(), 2);
        // The icon number is bounded.
        let many = [UnreadContext {
            context_key: "c".into(),
            channel_id: "c".into(),
            event_times: (0..2000).collect(),
        }];
        assert_eq!(badge(&many, &HashMap::new()).0, MAX_BADGE);
    }
}
