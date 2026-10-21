import '../../shared/read_state/read_state_format.dart';
import 'inbox_item.dart';

/// Resolves the effective read marker for one inbox row, mirroring desktop's
/// `resolveInboxItemReadAt`:
/// - thread rows use `max(thread:<root>, msg:<id>)`
/// - channel rows use the channel context marker
/// - rows with no channel have no marker
///
/// Markers come from Core's CollaborationUserState (DD-40) through
/// `readStateProvider`; `thread:` positions stay on this device.
int? resolveInboxItemReadAt(
  InboxItem item, {
  required int? Function(String contextId) markerOf,
}) {
  final channelId = item.item.channelId;
  final threadRootId = item.threadRootId;
  if (threadRootId != null) {
    return maxReadAt([
      markerOf(threadContextKey(threadRootId)),
      markerOf(msgContextKey(item.item.id)),
    ]);
  }
  return channelId == null ? null : markerOf(channelId);
}

/// The read context a row's "Mark unread" forces, and the one whose shared
/// marker it reads: the latest grouped message for thread rows, the channel
/// for channel and DM rows.
String? inboxItemReadContext(InboxItem item) {
  if (item.threadRootId != null) return msgContextKey(item.item.id);
  return item.item.channelId;
}

/// Whether the row is read ("done"). A session-local forced-unread flag on the
/// row's context wins (the same mechanism the channel tile and message actions
/// use); otherwise the row is done when no grouped activity is newer than the
/// shared read marker. Rows without a marker stay unread.
///
/// The original kept a per-device "unread"/"done" override list in
/// preferences. Kailo's read authority is Core alone (DD-40), so Mobile does
/// not persist a second one.
bool isInboxItemDone(
  InboxItem item, {
  required int? Function(String contextId) markerOf,
  required bool Function(String contextId) isForcedUnread,
}) {
  final context = inboxItemReadContext(item);
  if (context != null && isForcedUnread(context)) return false;
  final readAt = resolveInboxItemReadAt(item, markerOf: markerOf);
  return readAt != null && item.latestActivityAt <= readAt;
}

/// All event ids identified with the row — desktop's `getGroupedInboxItemIds`.
List<String> groupedInboxItemIds(InboxItem item) {
  return {item.id, item.item.id, ...item.groupItems.map((i) => i.id)}.toList();
}

/// The read positions that marking a row read advances.
///
/// Thread rows advance every grouped reply's shared `msg:` marker — the key
/// Web and Desktop write and read for Inbox thread replies
/// (`inboxReadContext`) — plus the device-local `thread:` marker the original
/// used, plus the channel position of grouped top-level events
/// ([groupedChannelReadTimestamp]). Channel and DM rows advance the channel.
List<({String contextId, int timestamp})> inboxItemReadMarks(InboxItem item) {
  final threadRootId = item.threadRootId;
  final channelId = item.item.channelId;
  if (threadRootId == null) {
    return [
      if (channelId != null)
        (contextId: channelId, timestamp: item.latestActivityAt),
    ];
  }
  final messages = <String, int>{
    // The row's own context, so a session-local "Mark unread" on it is
    // released even when the latest grouped event is the thread root.
    msgContextKey(item.item.id): item.item.createdAt,
    for (final grouped in item.groupItems)
      if (isThreadReply(grouped.tags))
        msgContextKey(grouped.id): grouped.createdAt,
  };
  return [
    for (final entry in messages.entries)
      (contextId: entry.key, timestamp: entry.value),
    (
      contextId: threadContextKey(threadRootId),
      timestamp: item.latestActivityAt,
    ),
    if (groupedChannelReadTimestamp(item) case final channelRead?)
      (contextId: channelRead.channelId, timestamp: channelRead.timestamp),
  ];
}

/// The channel-level timestamp that marking a thread row read should also
/// advance — desktop's `getGroupedChannelReadTimestamp`. Only top-level
/// (non-thread-reply) grouped events count, so marking a thread read cannot
/// swallow unrelated channel messages.
({String channelId, int timestamp})? groupedChannelReadTimestamp(
  InboxItem item,
) {
  final channelId = item.item.channelId;
  if (channelId == null) return null;

  int? timestamp;
  for (final groupItem in item.groupItems) {
    if (groupItem.channelId != channelId || isThreadReply(groupItem.tags)) {
      continue;
    }
    if (timestamp == null || groupItem.createdAt > timestamp) {
      timestamp = groupItem.createdAt;
    }
  }
  return timestamp == null
      ? null
      : (channelId: channelId, timestamp: timestamp);
}
