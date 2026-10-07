// Kailo's admitted native kind sets are preserved while sharing thread presentation.
// The huddle kind is a parsing constant from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/constants/kinds.ts; it does not enable a route or subscription.
export const KIND_HUDDLE_STARTED = 48100;
export const KIND_DELETION = 5;
export const KIND_REACTION = 7;
export const KIND_STREAM_MESSAGE = 9;
// Buzz-native deletion. The relay soft-deletes the target and emits a
// kind:40099 system message. Treated as a deletion marker alongside kind:5.
export const KIND_NIP29_DELETE_EVENT = 9005;
export const KIND_STREAM_MESSAGE_V2 = 40002;
export const KIND_STREAM_MESSAGE_EDIT = 40003;
export const KIND_CHANNEL_THREAD_SUMMARY = 39005;
export const KIND_CHANNEL_WINDOW_BOUNDS = 39006;
export const KIND_SYSTEM_MESSAGE = 40099;
export const KIND_MEMBER_ADDED_NOTIFICATION = 44100;
export const KIND_MEMBER_REMOVED_NOTIFICATION = 44101;
// NIP-DV: relay-signed per-viewer DM visibility snapshot (d=viewer pubkey,
// h-tags = currently-hidden DM channel ids).
export const KIND_DM_VISIBILITY = 30622;
export const KIND_DM_OPEN = 41010;
export const KIND_DM_HIDE = 41012;

// Human-visible "new content" message kinds. Used as the unread trigger set
// (sidebar badges, catch-up queries). Deletions and system messages are
// deliberately excluded: they can land after the last human-visible message
// and would otherwise create phantom unreads. Mirrors the native channel
// activity / unread catch-up kind set.
export const CHANNEL_MESSAGE_EVENT_KINDS = [
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
] as const;

// Keep this in sync with the native `get_feed` mention query (kind 9 only).
export const HOME_MENTION_EVENT_KINDS = [KIND_STREAM_MESSAGE];

// Live channel subscription kinds. Mirrors CHANNEL_REPAIR_KINDS in
// src-tauri/src/commands/channel_reconnect_repair.rs (coupling test in
// relayReconnectReplay.test.mjs).
export const CHANNEL_EVENT_KINDS = [
  KIND_DELETION, // 5 — NIP-09 event deletions
  KIND_NIP29_DELETE_EVENT, // 9005 — NIP-29 / Buzz-native deletions
  ...CHANNEL_MESSAGE_EVENT_KINDS,
  KIND_STREAM_MESSAGE_EDIT,
  KIND_SYSTEM_MESSAGE, // 40099 — system messages (join, leave, etc.)
] as const;

// Auxiliary (non-row) timeline kinds: deletion markers that hide an existing
// message rather than rendering their own row. They are matched by `#e`
// reference over the loaded message ids, so a late deletion for a visible old
// message still applies.
export const CHANNEL_AUX_EVENT_KINDS = [
  KIND_REACTION,
  KIND_STREAM_MESSAGE_EDIT,
  KIND_DELETION, // 5 — NIP-09 event deletions
  KIND_NIP29_DELETE_EVENT, // 9005 — NIP-29 / Buzz-native deletions
] as const;

// Visible content kinds a channel window / thread returns as their own rows.
// Mirrors the native timeline kind set.
export const CHANNEL_TIMELINE_CONTENT_KINDS = [
  KIND_STREAM_MESSAGE, // 9
  KIND_STREAM_MESSAGE_V2, // 40002
  KIND_SYSTEM_MESSAGE, // 40099 — system rows (join/leave/channel-created)
] as const;

// Timeline kinds that are NOT conversational: relay-signed system rows
// (channel-created, member-joined). These render in the timeline but must not
// count toward the channel's unread pill — a freshly created channel carries
// one channel_created + N member_joined system rows that would otherwise show
// as phantom unreads ("4 unread, 1 message").
const NON_CONVERSATIONAL_UNREAD_KINDS: ReadonlySet<number> = new Set([
  KIND_SYSTEM_MESSAGE, // 40099
]);

// Whether a timeline message kind should count toward unread tallies. An
// undefined kind (optimistic/pending rows whose kind has not populated) is
// treated as conversational so a legitimately unread message is never dropped.
export function isConversationalUnreadKind(kind: number | undefined): boolean {
  return kind === undefined || !NON_CONVERSATIONAL_UNREAD_KINDS.has(kind);
}
