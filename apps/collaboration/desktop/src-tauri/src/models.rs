use std::collections::HashMap;

use serde::{Deserialize, Deserializer, Serialize};

#[derive(Serialize)]
pub struct IdentityInfo {
    pub pubkey: String,
    pub display_name: String,
    /// Durable location of the active identity key.
    pub storage: String,
    /// True when the app booted with an ephemeral key because the OS keyring
    /// was empty despite a prior successful migration (key was externally
    /// deleted). The frontend routes to the nsec re-import step when true.
    /// Mutually exclusive with `locked`.
    pub lost: bool,
    /// True when the app booted with an ephemeral key because the OS keyring
    /// holding the identity is unreachable this boot (keyring locked or
    /// unavailable). The real key still exists in the keyring; the frontend
    /// shows a "unlock the keyring and relaunch" screen. Mutually exclusive
    /// with `lost`.
    pub locked: bool,
}

#[derive(Serialize, Deserialize)]
pub struct ProfileInfo {
    pub pubkey: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub about: Option<String>,
    pub nip05_handle: Option<String>,
    pub owner_pubkey: Option<String>,
    /// `true` when a real kind:0 event was found on the relay; `false` for the
    /// synthesized fallback returned when no metadata event exists.  The
    /// onboarding gate uses this to distinguish "new user with no profile" from
    /// "returning user whose display_name happens to be empty".
    pub has_profile_event: bool,
}

#[derive(Serialize, Deserialize)]
pub struct UserProfileSummaryInfo {
    pub display_name: Option<String>,
    /// Kind-0 `name` field, carried separately from `display_name` so clients
    /// can match @mention text against either alias (agents and the CLI
    /// resolve mentions server-side against `display_name` *or* `name`).
    #[serde(default)]
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub nip05_handle: Option<String>,
    pub owner_pubkey: Option<String>,
    #[serde(default)]
    pub is_agent: bool,
}

#[derive(Serialize, Deserialize)]
pub struct UsersBatchResponse {
    pub profiles: HashMap<String, UserProfileSummaryInfo>,
    pub missing: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct UserSearchResultInfo {
    pub pubkey: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub nip05_handle: Option<String>,
    pub owner_pubkey: Option<String>,
    #[serde(default)]
    pub is_agent: bool,
}

#[derive(Serialize, Deserialize)]
pub struct SearchUsersResponse {
    pub users: Vec<UserSearchResultInfo>,
    pub next_cursor: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ChannelInfo {
    pub id: String,
    pub name: String,
    pub channel_type: String,
    pub visibility: String,
    #[serde(deserialize_with = "deserialize_null_string_as_empty")]
    pub description: String,
    pub topic: Option<String>,
    pub purpose: Option<String>,
    pub member_count: i64,
    #[serde(default)]
    pub member_pubkeys: Vec<String>,
    pub last_message_at: Option<String>,
    pub archived_at: Option<String>,
    #[serde(default)]
    pub participants: Vec<String>,
    #[serde(default)]
    pub participant_pubkeys: Vec<String>,
    #[serde(default = "default_true")]
    pub is_member: bool,
    pub ttl_seconds: Option<i32>,
    pub ttl_deadline: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ChannelDetailInfo {
    pub id: String,
    pub name: String,
    pub channel_type: String,
    pub visibility: String,
    #[serde(deserialize_with = "deserialize_null_string_as_empty")]
    pub description: String,
    pub topic: Option<String>,
    pub topic_set_by: Option<String>,
    pub topic_set_at: Option<String>,
    pub purpose: Option<String>,
    pub purpose_set_by: Option<String>,
    pub purpose_set_at: Option<String>,
    pub created_by: String,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    pub member_count: i64,
    pub topic_required: bool,
    pub max_members: Option<i32>,
    pub nip29_group_id: Option<String>,
    pub ttl_seconds: Option<i32>,
    pub ttl_deadline: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ChannelMemberInfo {
    pub pubkey: String,
    pub role: String,
    #[serde(default)]
    pub is_agent: bool,
    /// Optional — kind:39002 events do not carry per-member join timestamps,
    /// so this is `None` when populated from a NIP-29 members event.
    #[serde(default)]
    pub joined_at: Option<String>,
    pub display_name: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ChannelMembersResponse {
    pub members: Vec<ChannelMemberInfo>,
    pub next_cursor: Option<String>,
}

/// Per-item classification of a home feed entry.
///
/// This is the wire contract for `FeedItem.category` in the desktop frontend
/// (`desktop/src/shared/api/types.ts`): a mention item lives in the plural
/// `mentions` section of [`FeedSections`] but carries the singular `mention`
/// category.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FeedItemCategory {
    Mention,
}

#[derive(Serialize, Deserialize)]
pub struct FeedItemInfo {
    pub id: String,
    pub kind: u32,
    pub pubkey: String,
    pub content: String,
    pub created_at: u64,
    pub channel_id: Option<String>,
    pub channel_name: String,
    #[serde(default)]
    pub channel_type: Option<String>,
    pub tags: Vec<Vec<String>>,
    pub category: FeedItemCategory,
}

#[derive(Serialize, Deserialize)]
pub struct FeedSections {
    pub mentions: Vec<FeedItemInfo>,
}

#[derive(Serialize, Deserialize)]
pub struct FeedMeta {
    pub since: i64,
    pub total: u64,
    pub generated_at: i64,
}

#[derive(Serialize, Deserialize)]
pub struct FeedResponse {
    pub feed: FeedSections,
    pub meta: FeedMeta,
}

#[derive(Serialize, Deserialize)]
pub struct SearchHitInfo {
    pub event_id: String,
    pub content: String,
    pub kind: u32,
    pub pubkey: String,
    pub channel_id: Option<String>,
    pub channel_name: Option<String>,
    pub created_at: u64,
    pub score: f64,
}

#[derive(Serialize, Deserialize)]
pub struct SearchResponse {
    pub hits: Vec<SearchHitInfo>,
    pub found: u64,
}

#[derive(Serialize, Deserialize)]
pub struct SendChannelMessageResponse {
    pub event_id: String,
    pub parent_event_id: Option<String>,
    pub root_event_id: Option<String>,
    pub depth: u32,
    pub created_at: i64,
}

/// Forward keyset pagination cursor for `get_thread_replies`.
///
/// Thread replies routinely share a `created_at` second (bursty threads), so
/// the cursor must carry the last reply's `event_id` as a tiebreak alongside
/// its `created_at`. A timestamp-only cursor advances past the entire tied
/// second after one page and silently drops every tied reply beyond the page
/// limit — the "missed messages" bug this read-path work fixes. The relay
/// keysets on `(event_created_at, event_id)` to match.
#[derive(Serialize, Deserialize, Clone)]
pub struct ThreadCursor {
    /// `created_at` of the last reply already loaded (Unix seconds).
    pub created_at: i64,
    /// Hex event id of that last reply — the tiebreak within a shared second.
    pub event_id: String,
}

/// Response for `get_thread_replies` — the full reply subtree under a root
/// event, fetched server-side from `thread_metadata` (NOT assembled from the
/// channel cache). `events` are raw Nostr events in chronological order;
/// `next_cursor` is the composite `(created_at, event_id)` of the last event
/// when a full page was returned, for forward keyset paging, else `None`.
#[derive(Serialize, Deserialize)]
pub struct ThreadRepliesResponse {
    pub events: Vec<serde_json::Value>,
    pub next_cursor: Option<ThreadCursor>,
}

/// Composite backward keyset cursor for channel-timeline paging via the bridge
/// (`get_channel_window`). The relay orders `created_at DESC, id ASC`
/// and advances past a tied second with `id > before_id`, so the event id is the
/// tiebreak that lets paging escape a second denser than one WS page —
/// the case a bare `until` cursor cannot advance through.
#[derive(Serialize, Deserialize, Clone)]
pub struct ChannelPageCursor {
    /// `created_at` of the last (oldest) message already loaded (Unix seconds).
    pub created_at: i64,
    /// Hex event id of that message — the `before_id` tiebreak within a second.
    pub event_id: String,
}

fn deserialize_null_string_as_empty<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

fn default_true() -> bool {
    true
}

/// Response payload for `get_channels`. When the caller supplies a hash that
/// matches the computed stable hash, `channels` is `None` so the multi-MB
/// channel list is not serialized across IPC. `last_messages` is always
/// included — it is cheap and changes frequently (every new message).
#[derive(Serialize)]
pub struct GetChannelsPayload {
    pub hash: String,
    /// `None` on a not-modified response (hash matched); `Some` with the full
    /// sorted list otherwise.
    pub channels: Option<Vec<ChannelInfo>>,
    /// Map of channel id → ISO-8601 timestamp of its most recent message.
    /// Empty for channels with no messages.
    pub last_messages: std::collections::HashMap<String, String>,
}

// ── Social / Contact list ───────────────────────────────────────────────────
