//! Channel and membership enums shared across crates.
//!
//! These live in `buzz-core` (zero I/O deps) so both the SDK (client-side)
//! and the DB layer (server-side) can use the same types without pulling in
//! sqlx/tokio.

use std::fmt;
use std::str::FromStr;

/// Returns the canonical display name for a channel.
///
/// Channel names are rendered with a leading `#` by clients, so surrounding
/// whitespace and user-supplied hash prefixes are removed here to keep the
/// stored name prefix-free.
pub fn canonical_channel_name(name: &str) -> &str {
    name.trim_start_matches(|c: char| c == '#' || c.is_whitespace())
        .trim_end()
}

/// The SDK's pure topic command, not a general metadata-management envelope.
/// An empty topic clears it. Extra, duplicate or malformed tags never qualify.
pub fn topic_change(event: &nostr::Event) -> Option<(uuid::Uuid, &str)> {
    if crate::kind::event_kind_u32(event) != crate::kind::KIND_NIP29_EDIT_METADATA
        || !event.content.is_empty()
        || event.tags.len() != 2
    {
        return None;
    }
    let mut channel = None;
    let mut topic = None;
    for tag in event.tags.iter() {
        let fields = tag.as_slice();
        match fields {
            [key, value] if key == "h" && channel.is_none() => {
                channel = Some(uuid::Uuid::parse_str(value).ok()?);
            }
            [key, value] if key == "topic" && topic.is_none() => topic = Some(value.as_str()),
            _ => return None,
        }
    }
    Some((channel?, topic?))
}

/// Whether a channel is publicly visible or invite-only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelVisibility {
    /// Searchable; anyone can join without an invite.
    Open,
    /// Hidden; requires an invite to join.
    Private,
}

impl ChannelVisibility {
    /// Canonical string representation (matches DB enum and Nostr tags).
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Private => "private",
        }
    }
}

impl fmt::Display for ChannelVisibility {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for ChannelVisibility {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "open" => Ok(Self::Open),
            "private" => Ok(Self::Private),
            other => Err(format!("unknown channel visibility: {other:?}")),
        }
    }
}

/// The functional type of a channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelType {
    /// Linear message stream (the default).
    Stream,
    /// Threaded forum-style discussion.
    Forum,
    /// Direct message conversation.
    Dm,
    /// Internal workflow execution channel.
    Workflow,
}

impl ChannelType {
    /// Canonical string representation (matches DB enum and Nostr tags).
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Stream => "stream",
            Self::Forum => "forum",
            Self::Dm => "dm",
            Self::Workflow => "workflow",
        }
    }
}

impl fmt::Display for ChannelType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for ChannelType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "stream" => Ok(Self::Stream),
            "forum" => Ok(Self::Forum),
            "dm" => Ok(Self::Dm),
            "workflow" => Ok(Self::Workflow),
            other => Err(format!("unknown channel type: {other:?}")),
        }
    }
}

/// A member's role within a channel.
///
/// The hierarchy for permission checks is: Owner > Admin > Member > Guest.
/// Bot is a **separate designation** — it is not part of the linear hierarchy.
/// Use [`MemberRole::permission_level`] for numeric comparisons in authorization.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemberRole {
    /// Full control — can manage members and delete the channel.
    Owner,
    /// Can manage members and channel settings.
    Admin,
    /// Standard participant.
    Member,
    /// Read-only external participant.
    Guest,
    /// Automated agent or integration (not in the role hierarchy).
    Bot,
}

impl MemberRole {
    /// Canonical string representation (matches DB enum and Nostr tags).
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Admin => "admin",
            Self::Member => "member",
            Self::Guest => "guest",
            Self::Bot => "bot",
        }
    }

    /// Elevated roles that only existing owners/admins may grant.
    pub fn is_elevated(&self) -> bool {
        matches!(self, Self::Owner | Self::Admin)
    }

    /// Numeric permission level for authorization comparisons.
    ///
    /// Higher = more privileged. Bot returns 0 (must use explicit grants).
    /// Use `role.permission_level() >= required.permission_level()` for checks.
    pub fn permission_level(self) -> u8 {
        match self {
            Self::Owner => 4,
            Self::Admin => 3,
            Self::Member => 2,
            Self::Guest => 1,
            Self::Bot => 0,
        }
    }

    /// Returns true if this role meets or exceeds the required role's permission level.
    ///
    /// Bot never meets any requirement (returns false for all non-Bot requirements).
    pub fn has_at_least(self, required: MemberRole) -> bool {
        self.permission_level() >= required.permission_level()
    }
}

impl fmt::Display for MemberRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for MemberRole {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "owner" => Ok(Self::Owner),
            "admin" => Ok(Self::Admin),
            "member" => Ok(Self::Member),
            "guest" => Ok(Self::Guest),
            "bot" => Ok(Self::Bot),
            other => Err(format!("unknown member role: {other:?}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::canonical_channel_name;

    #[test]
    fn pure_topic_shape_rejects_management_unknown_duplicate_and_malformed_tags() {
        use nostr::{EventBuilder, Keys, Kind, Tag};
        let keys = Keys::generate();
        let channel = uuid::Uuid::new_v4();
        let h = Tag::parse(["h", &channel.to_string()]).unwrap();
        let topic = Tag::parse(["topic", ""]).unwrap();
        let event = EventBuilder::new(Kind::Custom(9002), "")
            .tags([h.clone(), topic.clone()])
            .sign_with_keys(&keys)
            .unwrap();
        assert_eq!(super::topic_change(&event), Some((channel, "")));
        for tags in [
            vec![
                h.clone(),
                topic.clone(),
                Tag::parse(["name", "override"]).unwrap(),
            ],
            vec![
                h.clone(),
                topic.clone(),
                Tag::parse(["unknown", "value"]).unwrap(),
            ],
            vec![h.clone(), h.clone()],
            vec![topic.clone(), topic.clone()],
            vec![h.clone(), Tag::parse(["topic", "value", "extra"]).unwrap()],
            vec![Tag::parse(["h", "not-a-channel"]).unwrap(), topic.clone()],
            vec![h.clone(), Tag::parse(["purpose", "value"]).unwrap()],
        ] {
            let event = EventBuilder::new(Kind::Custom(9002), "")
                .tags(tags)
                .sign_with_keys(&keys)
                .unwrap();
            assert!(super::topic_change(&event).is_none());
        }
        for (kind, content) in [(9, ""), (9002, "not empty")] {
            let event = EventBuilder::new(Kind::Custom(kind), content)
                .tags([h.clone(), topic.clone()])
                .sign_with_keys(&keys)
                .unwrap();
            assert!(super::topic_change(&event).is_none());
        }
    }

    #[test]
    fn channel_names_trim_whitespace_and_drop_all_leading_hashes() {
        assert_eq!(canonical_channel_name("channel"), "channel");
        assert_eq!(canonical_channel_name("#channel"), "channel");
        assert_eq!(canonical_channel_name("###channel"), "channel");
        assert_eq!(canonical_channel_name("  ###channel  "), "channel");
        assert_eq!(canonical_channel_name("# channel"), "channel");
        assert_eq!(canonical_channel_name("### channel  "), "channel");
        assert_eq!(canonical_channel_name("  ###  "), "");
        assert_eq!(canonical_channel_name("# #"), "");
        assert_eq!(canonical_channel_name("### ###"), "");
        assert_eq!(canonical_channel_name("channel#topic"), "channel#topic");
    }
}
