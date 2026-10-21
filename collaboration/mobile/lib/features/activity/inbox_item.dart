import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter/foundation.dart';
import 'package:intl/intl.dart';

import 'feed_item.dart';

/// Inbox filters, mirroring desktop's `InboxFilter` in
/// `desktop/src/features/home/lib/inbox.ts`.
///
/// The original Mobile list also offered Needs Action, Agents and Reminders.
/// Their sources are closed or not designed for Mobile in Kailo (DD-106,
/// DD-125(5); `collab.reminders` is registered for Web/Desktop only), and
/// REQ-21 makes an entry Mobile does not provide invisible rather than empty.
enum InboxFilter { all, mention, thread, activity, drafts }

/// Category ordering used to pick the label for a grouped conversation.
/// Mirrors desktop's `categoryPriority`.
int categoryPriority(String category) {
  return switch (category) {
    'mention' => 1,
    _ => 3,
  };
}

/// Thread reference from NIP-10 tags — desktop's `getThreadReference`.
({String? parentId, String? rootId}) threadReferenceOf(
  List<List<String>> tags,
) {
  List<String>? rootTag;
  List<String>? replyTag;
  for (final tag in tags) {
    if (tag.length >= 4 && tag[0] == 'e') {
      if (tag[3] == 'root') rootTag = tag;
      if (tag[3] == 'reply') replyTag = tag;
    }
  }
  if (replyTag == null) return (parentId: null, rootId: null);
  final parentId = replyTag[1];
  return (parentId: parentId, rootId: rootTag?[1] ?? parentId);
}

/// Broadcast replies surface at the channel top level — desktop's
/// `isBroadcastReply`.
bool isBroadcastReply(List<List<String>> tags) {
  return tags.any(
    (tag) => tag.length >= 2 && tag[0] == 'broadcast' && tag[1] == '1',
  );
}

/// A thread reply that is not broadcast — desktop's `isThreadReply`.
bool isThreadReply(List<List<String>> tags) {
  return threadReferenceOf(tags).parentId != null && !isBroadcastReply(tags);
}

/// Stable conversation identity: `rootId ?? parentId ?? event.id`, except
/// ordinary (non-thread) DM messages, which group by DM channel identity so
/// one DM conversation renders as one row. Mirrors desktop's
/// `getInboxConversationId`.
String inboxConversationId(
  List<List<String>> tags,
  String eventId, {
  String? dmChannelId,
}) {
  final thread = threadReferenceOf(tags);
  final threadId = thread.rootId ?? thread.parentId;
  if (threadId != null) return threadId;
  if (dmChannelId != null) return 'dm:$dmChannelId';
  return eventId;
}

/// One conversation-grouped inbox row. Mirrors desktop's `InboxItem`.
@immutable
class InboxItem {
  /// Stable conversation identity for the thread group.
  final String conversationId;

  /// Representative (latest) event id.
  final String id;

  /// Representative (latest) feed item.
  final FeedItem item;

  /// All events grouped into this conversation, unordered.
  final List<FeedItem> groupItems;

  /// Distinct categories present in the group, priority-sorted.
  final List<String> categories;

  final int latestActivityAt;

  const InboxItem({
    required this.conversationId,
    required this.id,
    required this.item,
    required this.groupItems,
    required this.categories,
    required this.latestActivityAt,
  });

  /// Root id if any grouped event carries thread-reply tags.
  String? get threadRootId {
    for (final candidate in [item, ...groupItems]) {
      if (isThreadReply(candidate.tags)) {
        return threadReferenceOf(candidate.tags).rootId;
      }
    }
    return null;
  }

  /// The event the row should deep-link to: the oldest event in the group
  /// newer than [readAt] (oldest unread), falling back to the latest event.
  FeedItem deepLinkTarget(int? readAt) {
    if (readAt != null) {
      FeedItem? oldestUnread;
      for (final candidate in groupItems) {
        if (candidate.createdAt <= readAt) continue;
        if (oldestUnread == null ||
            candidate.createdAt < oldestUnread.createdAt) {
          oldestUnread = candidate;
        }
      }
      if (oldestUnread != null) return oldestUnread;
    }
    return item;
  }
}

/// Contextual row label — desktop's `getInboxTypeLabel`:
/// "DM from X" / "Mentioned in" / "Thread in" / "... in", from the shared
/// platform catalog so Mobile and Web/Desktop read the same words (DD-53).
({String text, String? channelLabel}) inboxTypeLabel(
  InboxItem item, {
  required String? channelName,
  required bool isDm,
  required String senderLabel,
  String? locale,
}) {
  String text(
    PlatformMessageKey key, [
    Map<String, Object> variables = const {},
  ]) => platformText(key, locale: locale, variables: variables);

  if (isDm) {
    return (
      text: senderLabel.isNotEmpty
          ? text(PlatformMessageKey.inboxDmFrom, {'sender': senderLabel})
          : text(PlatformMessageKey.inboxDmLabel),
      channelLabel: null,
    );
  }

  final category = item.categories.firstOrNull ?? item.item.category;
  if (category == 'mention') {
    return (
      text: channelName != null
          ? text(PlatformMessageKey.inboxMentionedIn)
          : text(PlatformMessageKey.inboxMentionedLabel),
      channelLabel: channelName,
    );
  }
  if (item.threadRootId != null) {
    return (
      text: channelName != null
          ? text(PlatformMessageKey.inboxThreadIn)
          : text(PlatformMessageKey.inboxThreadLabel),
      channelLabel: channelName,
    );
  }

  final headline = item.item.headline(locale: locale);
  return (
    text: channelName != null
        ? text(PlatformMessageKey.inboxActivityIn, {'activity': headline})
        : headline,
    channelLabel: channelName,
  );
}

/// Whether [item] matches [filter] — desktop's `matchesInboxFilter`.
/// `drafts` is a separate surface and never matches here.
bool matchesInboxFilter(InboxItem item, InboxFilter filter) {
  return switch (filter) {
    InboxFilter.all => true,
    InboxFilter.thread => [
      item.item,
      ...item.groupItems,
    ].any((i) => isThreadReply(i.tags)),
    InboxFilter.mention => item.categories.contains('mention'),
    InboxFilter.activity => item.categories.contains('activity'),
    InboxFilter.drafts => false,
  };
}

/// Group raw feed items into conversation rows sorted by latest activity.
/// [isDmChannel] identifies DM channels so their ordinary top-level messages
/// collapse into one row per DM conversation. Mirrors desktop's
/// `buildInboxItems`.
List<InboxItem> buildInboxItems(
  Iterable<FeedItem> feedItems, {
  bool Function(String channelId)? isDmChannel,
}) {
  final groups = <String, List<FeedItem>>{};
  for (final item in feedItems) {
    final channelId = item.channelId;
    final dmChannelId =
        channelId != null && (isDmChannel?.call(channelId) ?? false)
        ? channelId
        : null;
    final key = inboxConversationId(
      item.tags,
      item.id,
      dmChannelId: dmChannelId,
    );
    groups.putIfAbsent(key, () => []).add(item);
  }

  final rows = <InboxItem>[];
  for (final entry in groups.entries) {
    final items = entry.value;
    var latest = items.first;
    var latestActivityAt = 0;
    for (final item in items) {
      if (item.createdAt > latest.createdAt) latest = item;
      if (item.createdAt > latestActivityAt) latestActivityAt = item.createdAt;
    }
    final categories = items.map((i) => i.category).toSet().toList()
      ..sort((a, b) => categoryPriority(a).compareTo(categoryPriority(b)));

    rows.add(
      InboxItem(
        conversationId: entry.key,
        id: latest.id,
        item: latest,
        groupItems: List.unmodifiable(items),
        categories: List.unmodifiable(categories),
        latestActivityAt: latestActivityAt,
      ),
    );
  }

  rows.sort((a, b) => b.latestActivityAt.compareTo(a.latestActivityAt));
  return rows;
}

/// Inbox list timestamp — desktop's `formatInboxTimestamp`: clock time today,
/// "Yesterday", a short date this year, a dated label otherwise. Words and
/// date patterns follow the selected platform locale.
String inboxTimestamp(int unixSeconds, {String? locale, DateTime? now}) {
  final current = now ?? DateTime.now();
  final date = DateTime.fromMillisecondsSinceEpoch(unixSeconds * 1000);
  final today = DateTime(current.year, current.month, current.day);
  final day = DateTime(date.year, date.month, date.day);
  final dayDiff = (today.difference(day).inHours / 24).round();
  final intlLocale = platformIntlLocale(locale: locale);

  if (dayDiff == 0) return DateFormat.jm(intlLocale).format(date);
  if (dayDiff == 1) {
    return platformText(PlatformMessageKey.chatTimeYesterday, locale: locale);
  }
  return date.year == current.year
      ? DateFormat.MMMd(intlLocale).format(date)
      : DateFormat.yMMMd(intlLocale).format(date);
}
