import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:flutter/material.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'forum_text.dart';

import '../../shared/relay/relay.dart';
import '../../shared/platform/platform_api.dart';
import '../channels/message_mutations.dart';
import '../channels/send_message_provider.dart';
import '../../shared/custom_emoji/custom_emoji.dart';
import '../../shared/custom_emoji/custom_emoji_provider.dart';
import 'forum_models.dart';

/// Original forum reads use the current authenticated Relay query. Watching config
/// retires cached results on a community/key change; queryRelay fences late responses.
final forumPostsProvider = FutureProvider.autoDispose
    .family<ForumPostsResponse, String>((ref, channelId) async {
      ref.watch(relayConfigProvider);
      final session = ref.read(relaySessionProvider.notifier);
      final events = await session.queryRelay([
        NostrFilter(
          kinds: const [EventKind.forumPost],
          tags: {
            '#h': [channelId],
          },
          limit: 50,
        ),
      ]);
      return ForumPostsResponse.fromEvents(
        events
            .where(
              (e) => e.kind == EventKind.forumPost && e.channelId == channelId,
            )
            .toList(),
      );
    });

/// Resolve a pushed reply by its actual Relay ancestry, then read the original
/// complete forum thread. IDs from notification data never bypass channel scope.
Future<ForumThreadResponse> loadForumThread(
  Future<List<NostrEvent>> Function(List<NostrFilter>) query,
  String channelId,
  String eventId,
) async {
  final visited = <String>{};
  var id = eventId;
  NostrEvent? root;
  for (var depth = 0; depth < 64; depth++) {
    if (!visited.add(id)) throw const FormatException('Cyclic forum ancestry');
    final events = await query([
      NostrFilter(
        kinds: const [EventKind.forumPost, EventKind.forumComment],
        ids: [id],
        tags: {
          '#h': [channelId],
        },
        limit: 1,
      ),
    ]);
    final event = events
        .where(
          (e) =>
              e.id == id &&
              e.channelId == channelId &&
              (e.kind == EventKind.forumPost ||
                  e.kind == EventKind.forumComment),
        )
        .firstOrNull;
    if (event == null) throw const FormatException('Forum target unavailable');
    if (event.kind == EventKind.forumPost) {
      root = event;
      break;
    }
    final thread = event.threadReference;
    final parent = thread.rootId ?? thread.parentId;
    if (parent == null) {
      throw const FormatException('Forum reply has no parent');
    }
    id = parent;
  }
  if (root == null) {
    throw const FormatException('Forum ancestry depth exceeded');
  }
  final replies = <String, NostrEvent>{};
  NostrEvent? cursor;
  for (var page = 0; page < 500; page++) {
    final events = await query([
      NostrFilter(
        kinds: const [EventKind.forumComment],
        tags: {
          '#h': [channelId],
          '#e': [root.id],
        },
        limit: 200,
        extensions: {
          'depth_limit': 64,
          if (cursor != null) 'thread_cursor': cursor.createdAt,
          if (cursor != null) 'thread_cursor_id': cursor.id,
        },
      ),
    ]);
    for (final event in events) {
      if (event.kind == EventKind.forumComment && event.channelId == channelId) {
        replies[event.id] = event;
      }
    }
    if (events.length < 200) {
      return ForumThreadResponse.fromEvents(
        root: root,
        replies: replies.values.toList(),
      );
    }
    final last = events.last;
    if (cursor?.id == last.id) {
      throw const FormatException('Forum cursor did not advance');
    }
    cursor = last;
  }
  throw const FormatException('Forum thread page safety limit');
}

final forumThreadProvider = FutureProvider.autoDispose
    .family<ForumThreadResponse, ({String channelId, String eventId})>((
      ref,
      args,
    ) async {
      ref.watch(relayConfigProvider);
      final session = ref.read(relaySessionProvider.notifier);
      return loadForumThread(
        (filters) => session.queryRelay(filters),
        args.channelId,
        args.eventId,
      );
    });

/// A forum event delivery bound to the community where composition began.
///
/// Attachment uploads can outlive their route. Capturing the relay identity,
/// signing key, and emoji palette prevents a queued draft from being delivered
/// to a different community after the user switches relays.
class ForumEventDelivery {
  final ProviderContainer _container;
  final String _relayUrl;
  final String? _nsec;
  final SendMessage _send;
  final NativeSession _session;
  final int _generation;
  final List<CustomEmoji> _customEmoji;

  ForumEventDelivery._({
    required ProviderContainer container,
    required String relayUrl,
    required String? nsec,
    required SendMessage send,
    required NativeSession session,
    required int generation,
    required List<CustomEmoji> customEmoji,
  }) : _container = container,
       _relayUrl = relayUrl,
       _nsec = nsec,
       _send = send,
       _session = session,
       _generation = generation,
       _customEmoji = customEmoji;

  /// Captures the active community dependencies for a future delivery.
  factory ForumEventDelivery.capture(ProviderContainer container) {
    final config = container.read(relayConfigProvider);
    return ForumEventDelivery._(
      container: container,
      relayUrl: config.baseUrl,
      nsec: config.nsec,
      send: container.read(sendMessageProvider),
      session: container.read(nativeSessionProvider),
      generation: container.read(nativeSessionProvider).credentialGeneration,
      customEmoji: List<CustomEmoji>.unmodifiable(
        container.read(customEmojiListProvider),
      ),
    );
  }

  /// Creates a new forum post (kind:45001).
  Future<void> createPost({
    required String channelId,
    required String content,
    List<String> mentionPubkeys = const [],
    List<List<String>> mediaTags = const [],
  }) async {
    await _submit(
      kind: EventKind.forumPost,
      channelId: channelId,
      content: content,
      mentionPubkeys: mentionPubkeys,
      mediaTags: mediaTags,
    );
    _container.invalidate(forumPostsProvider(channelId));
  }

  /// Creates a reply to a forum post (kind:45003).
  Future<void> createReply({
    required String channelId,
    required String parentEventId,
    required String content,
    List<String> mentionPubkeys = const [],
    List<List<String>> mediaTags = const [],
  }) async {
    await _submit(
      kind: EventKind.forumComment,
      channelId: channelId,
      parentEventId: parentEventId,
      content: content,
      mentionPubkeys: mentionPubkeys,
      mediaTags: mediaTags,
    );
    _container.invalidate(forumPostsProvider(channelId));
    _container.invalidate(
      forumThreadProvider((channelId: channelId, eventId: parentEventId)),
    );
  }

  Future<void> _submit({
    required int kind,
    required String channelId,
    required String content,
    String? parentEventId,
    required List<String> mentionPubkeys,
    required List<List<String>> mediaTags,
  }) async {
    final currentConfig = _container.read(relayConfigProvider);
    if (_session.credentialGeneration != _generation ||
        currentConfig.baseUrl != _relayUrl ||
        currentConfig.nsec != _nsec) {
      throw StateError(
        'Forum delivery cancelled because the active community changed',
      );
    }

    await _send(
      kind: kind,
      channelId: channelId,
      parentEventId: parentEventId,
      content: content,
      mentionPubkeys: mentionPubkeys,
      mediaTags: [...mediaTags, ...buildCustomEmojiTags(content, _customEmoji)],
    );
  }
}

/// Deletes a forum post or reply and invalidates relevant caches.
Future<bool> deleteForumEvent(
  WidgetRef ref, {
  required String channelId,
  required String eventId,
  String? rootEventId,
}) async {
  final actions = ref.read(messageMutationsProvider);
  try {
    await actions.deleteMessage(channelId: channelId, eventId: eventId);
  } catch (error) {
    if (ref.context.mounted) {
      ScaffoldMessenger.maybeOf(ref.context)?.showSnackBar(
        SnackBar(
          content: Text(
            forumText(
              ref.context,
              error is RelayPublishOutcomeUnknown
                  ? PlatformMessageKey.messagesActionsDeleteUnknown
                  : PlatformMessageKey.messagesActionsDeleteFailed,
            ),
          ),
        ),
      );
    }
    return false;
  }
  ref.invalidate(forumPostsProvider(channelId));
  if (rootEventId != null) {
    ref.invalidate(
      forumThreadProvider((channelId: channelId, eventId: rootEventId)),
    );
  }
  return true;
}
