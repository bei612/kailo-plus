import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter/foundation.dart';

/// One Activity event read directly from the relay with this device's key
/// (DD-75). [category] is `mention` (an event p-tagging me) or `activity`
/// (recent DM traffic from others).
///
/// The original feed also carried `needs_action` (workflow kinds 46010–46012)
/// and `agent_activity` (job kinds 43001–43006). Kailo closed the first source
/// (DD-106; DD-125(5) moved Needs action onto the approval projection, whose
/// Mobile consumer is not designed yet) and has no design for the second, so
/// neither is read here.
@immutable
class FeedItem {
  final String id;
  final int kind;
  final String pubkey;
  final String content;
  final int createdAt;
  final String? channelId;
  final List<List<String>> tags;
  final String category;

  const FeedItem({
    required this.id,
    required this.kind,
    required this.pubkey,
    required this.content,
    required this.createdAt,
    required this.channelId,
    required this.tags,
    required this.category,
  });

  /// The message whose thread directly contains this item, when this event is
  /// a reply. For nested replies this is the direct parent, not the outer root.
  String? get threadHeadId {
    for (final tag in tags) {
      if (tag.length >= 4 && tag[0] == 'e' && tag[3] == 'reply') {
        return tag[1];
      }
    }
    return null;
  }

  /// Row headline for an item that is neither a DM, a mention nor a thread.
  String headline({String? locale}) => platformText(
    category == 'mention'
        ? PlatformMessageKey.inboxMentionLabel
        : PlatformMessageKey.inboxChannelUpdate,
    locale: locale,
  );

  /// Trimmed content, with the shared fallback for empty events.
  String displayContent({String? locale}) {
    final trimmed = content.trim();
    if (trimmed.isNotEmpty) return trimmed;
    return platformText(PlatformMessageKey.inboxPreviewEmpty, locale: locale);
  }
}

/// The Activity feed, split by source category.
@immutable
class HomeFeedResponse {
  final List<FeedItem> mentions;
  final List<FeedItem> activity;

  HomeFeedResponse({required this.mentions, required this.activity});

  HomeFeedResponse.empty() : mentions = const [], activity = const [];

  /// All items merged into a single list, sorted newest-first.
  late final List<FeedItem> all = () {
    final items = [...mentions, ...activity];
    items.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return List<FeedItem>.unmodifiable(items);
  }();

  bool get isEmpty => mentions.isEmpty && activity.isEmpty;
}
