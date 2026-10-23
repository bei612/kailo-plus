import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/relay/relay.dart';
import '../channels/channel_management_provider.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/profile/user_profile.dart';
import 'channel_messages_provider.dart';
import 'local_message_send_animation_provider.dart';

/// Sends messages by signing an event with the user's nsec and publishing it
/// over the relay's NIP-42-authenticated WebSocket session.
class SendMessage {
  final SignedEventRelay _signedEventRelay;
  final Future<List<ChannelMember>> Function(String channelId) _fetchMembers;
  final Map<String, UserProfile> Function() _readUserCache;
  final void Function(String channelId, NostrEvent event) _addLocalMessage;
  final void Function(String channelId, String eventId)
  _markLocalMessageForAnimation;
  final void Function(String channelId, String eventId) _completeLocalMessage;
  final void Function(String channelId, String eventId) _removeLocalMessage;
  final bool Function()? _isDeliveryValid;
  final UnconfirmedPublishes _unconfirmed;
  final String _relayBaseUrl;

  SendMessage({
    required String relayBaseUrl,
    required SignedEventRelay signedEventRelay,
    required Future<List<ChannelMember>> Function(String channelId)
    fetchMembers,
    required Map<String, UserProfile> Function() readUserCache,
    required void Function(String channelId, NostrEvent event) addLocalMessage,
    void Function(String channelId, String eventId)?
    markLocalMessageForAnimation,
    required void Function(String channelId, String eventId)
    completeLocalMessage,
    required void Function(String channelId, String eventId) removeLocalMessage,
    bool Function()? isDeliveryValid,
    UnconfirmedPublishes? unconfirmed,
  }) : _signedEventRelay = signedEventRelay,
       _relayBaseUrl = relayBaseUrl,
       _unconfirmed = unconfirmed ?? UnconfirmedPublishes(),
       _fetchMembers = fetchMembers,
       _readUserCache = readUserCache,
       _addLocalMessage = addLocalMessage,
       _markLocalMessageForAnimation =
           markLocalMessageForAnimation ?? ((_, _) {}),
       _completeLocalMessage = completeLocalMessage,
       _removeLocalMessage = removeLocalMessage,
       _isDeliveryValid = isDeliveryValid;

  /// Send a text message to a channel.
  ///
  /// For thread replies, pass [parentEventId] and optionally [rootEventId].
  /// If [rootEventId] is null it defaults to [parentEventId] (direct reply to
  /// thread head). Tags are built to match the desktop's `buildReplyTags`
  /// convention with `root` / `reply` markers. Pass [mediaTags] to append
  /// relay-validated `imeta` tags and NIP-30 `emoji` tags.
  Future<void> call({
    required String channelId,
    required String content,
    String? parentEventId,
    String? rootEventId,
    List<String>? mentionPubkeys,
    List<List<String>> mediaTags = const [],
  }) async {
    _ensureDeliveryValid();
    // Use explicitly passed pubkeys, or resolve @mentions against
    // channel members to avoid matching the wrong user.
    final explicitMentions =
        mentionPubkeys ?? await _resolveMentions(content, channelId);
    final authorPubkey = _signedEventRelay.pubkey;

    // Normalize mentions: lowercase, deduplicate, exclude self (matching
    // the desktop's normalizeMentionPubkeys).
    final selfLower = authorPubkey?.toLowerCase();
    final seenMentions = <String>{?selfLower};
    final normalizedMentions = <String>[
      for (final pk in explicitMentions)
        if (seenMentions.add(pk.toLowerCase())) pk,
    ];

    final tags = <List<String>>[
      ['h', channelId],
      if (parentEventId != null) ..._buildReplyTags(parentEventId, rootEventId),
      for (final pk in normalizedMentions) ['p', pk],
      ...mediaTags,
    ];

    _ensureDeliveryValid();
    // 同一内容上一次的结果不明：原样重发那个已签名事件，而不是签一条新的
    // ——Relay 若已存储它只回 `duplicate:`，不会出现第二条消息。
    final fingerprint = UnconfirmedPublishes.fingerprint(
      relayBaseUrl: _relayBaseUrl,
      pubkey: authorPubkey,
      kind: EventKind.streamMessage,
      content: content,
      tags: tags,
    );
    final previous = _unconfirmed.lookup(fingerprint);
    NostrEvent? localMessage;
    _UnconfirmedPublish? publication;
    void adoptLocal(NostrEvent event) {
      localMessage = event;
      // EVENT 可以先于 publish 回应；先记录同一原事件，回读才可原子结清。
      _unconfirmed.remember(fingerprint, event);
      publication = _unconfirmed._events[fingerprint];
      if (previous != null) publication!.uncertain = true;
      _markLocalMessageForAnimation(channelId, event.id);
      _addLocalMessage(channelId, event);
    }

    try {
      if (previous != null) {
        adoptLocal(previous);
        await _signedEventRelay.resubmit(previous);
      } else {
        await _signedEventRelay.submit(
          kind: EventKind.streamMessage,
          content: content,
          tags: tags,
          onSigned: adoptLocal,
        );
      }
      final event = localMessage;
      if (event != null) {
        publication!.accepted = true;
        _unconfirmed.settle(fingerprint, event.id);
        _completeLocalMessage(channelId, event.id);
      }
    } catch (error) {
      final event = localMessage;
      if (event != null) {
        if (publication?.accepted == true) {
          // 等待重发回应期间，原事件已由 Relay 流/查询肯定查证。
          _completeLocalMessage(channelId, event.id);
          return;
        }
        _removeLocalMessage(channelId, event.id);
        // 结果不明的事件留着供原样重发；重发时被拒或未发出都不改变「第一次
        // 是否已被存储」这一未知，所以只在确认接受时才丢弃。
        if (error is RelayPublishOutcomeUnknown) {
          publication!.uncertain = true;
        }
        if (publication?.uncertain == true) {
          // 这次拒绝/未发送不能查证第一次是否已存储，继续保留同一事件的不明结果。
          throw RelayPublishOutcomeUnknown(event.id, '$error');
        }
        _unconfirmed.settle(fingerprint, event.id);
      }
      rethrow;
    }
  }

  void _ensureDeliveryValid() {
    if (_isDeliveryValid?.call() == false) {
      throw StateError(
        'Message delivery cancelled because the active community changed',
      );
    }
  }

  /// Resolve @mentions to pubkeys, scoped to channel members.
  ///
  /// Fetches channel members from the relay and matches @names only
  /// against members of that channel. Falls back to the full user cache
  /// if the member fetch fails.
  Future<List<String>> _resolveMentions(
    String content,
    String channelId,
  ) async {
    final mentionPattern = RegExp(r'@(\w+)');
    final matches = mentionPattern.allMatches(content);
    if (matches.isEmpty) return const [];

    // Try to get channel member pubkeys for scoped resolution.
    Set<String>? memberPubkeys;
    try {
      final members = await _fetchMembers(channelId);
      memberPubkeys = {for (final m in members) m.pubkey.toLowerCase()};
    } catch (_) {
      // Non-fatal — fall through to unscoped cache lookup.
    }

    final cache = _readUserCache();
    final pubkeys = <String>{};

    for (final match in matches) {
      final name = match.group(1)?.toLowerCase();
      if (name == null || name.isEmpty) continue;

      for (final profile in cache.values) {
        final displayName = profile.displayName?.toLowerCase();
        if (displayName == null) continue;

        // Match against full display name or first word.
        final firstName = displayName.split(RegExp(r'\s+')).first;
        if (displayName != name && firstName != name) continue;

        // If we have channel members, only match members of this channel.
        if (memberPubkeys != null &&
            !memberPubkeys.contains(profile.pubkey.toLowerCase())) {
          continue;
        }

        pubkeys.add(profile.pubkey);
        break;
      }
    }

    return pubkeys.toList();
  }

  /// Build `e`-tags for a thread reply, matching the desktop convention:
  /// - Direct reply to thread head: `["e", id, "", "reply"]`
  /// - Nested reply: `["e", rootId, "", "root"]` + `["e", parentId, "", "reply"]`
  static List<List<String>> _buildReplyTags(
    String parentEventId,
    String? rootEventId,
  ) {
    final root = rootEventId ?? parentEventId;
    if (parentEventId == root) {
      return [
        ['e', root, '', 'reply'],
      ];
    }
    return [
      ['e', root, '', 'root'],
      ['e', parentEventId, '', 'reply'],
    ];
  }
}

/// 已发出而未得到 Relay 确认的消息事件，按「社区 + 作者 + 种类 + 内容 + 标签」索引。
///
/// 用户对同一内容再次发送时取回同一个已签名事件原样重发。它不依赖 Relay 配置
/// 的生命周期：断线重连会重建发送器，但未确认的事件必须跨过重连留下来。
class UnconfirmedPublishes {
  final Map<String, _UnconfirmedPublish> _events = {};

  static String fingerprint({
    required String relayBaseUrl,
    required String? pubkey,
    required int kind,
    required String content,
    required List<List<String>> tags,
  }) => jsonEncode([relayBaseUrl, pubkey?.toLowerCase(), kind, content, tags]);

  NostrEvent? lookup(String fingerprint) => _events[fingerprint]?.event;

  void remember(String fingerprint, NostrEvent event) {
    final existing = _events[fingerprint];
    if (existing?.event.id == event.id) return;
    final publication = _UnconfirmedPublish(event);
    _events[fingerprint] = publication;
  }

  void settle(String fingerprint, String eventId) {
    if (_events[fingerprint]?.event.id == eventId) _events.remove(fingerprint);
  }

  /// 只有当前社区/作者从 Relay 回读的确切原事件，才结清该未确认发布。
  bool settleObserved({
    required String relayBaseUrl,
    required String? pubkey,
    required NostrEvent event,
  }) {
    if (pubkey == null ||
        event.pubkey.toLowerCase() != pubkey.toLowerCase() ||
        event.kind != EventKind.streamMessage) {
      return false;
    }
    final key = fingerprint(
      relayBaseUrl: relayBaseUrl,
      pubkey: pubkey,
      kind: event.kind,
      content: event.content,
      tags: event.tags,
    );
    final publication = _events[key];
    if (publication?.event.id != event.id) return false;
    publication!.accepted = true;
    _events.remove(key);
    return true;
  }
}

// 同一 cache 项由该事件的在途发送共享；移除 Map 项后原回应仍只消费自身事实。
class _UnconfirmedPublish {
  final NostrEvent event;
  bool accepted = false;
  bool uncertain = false;

  _UnconfirmedPublish(this.event);
}

final unconfirmedPublishesProvider = Provider<UnconfirmedPublishes>(
  (ref) => UnconfirmedPublishes(),
);

final sendMessageProvider = Provider<SendMessage>((ref) {
  final config = ref.watch(relayConfigProvider);
  return SendMessage(
    relayBaseUrl: config.baseUrl,
    unconfirmed: ref.read(unconfirmedPublishesProvider),
    signedEventRelay: SignedEventRelay(
      session: ref.read(relaySessionProvider.notifier),
      nsec: config.nsec,
    ),
    fetchMembers: (channelId) =>
        ref.read(channelMembersProvider(channelId).future),
    readUserCache: () => ref.read(userCacheProvider),
    addLocalMessage: (channelId, event) => ref
        .read(channelMessagesProvider(channelId).notifier)
        .addLocalMessage(event),
    markLocalMessageForAnimation: (channelId, eventId) => ref
        .read(localMessageSendAnimationProvider(channelId).notifier)
        .mark(eventId),
    completeLocalMessage: (channelId, eventId) => ref
        .read(channelMessagesProvider(channelId).notifier)
        .completeLocalMessage(eventId),
    removeLocalMessage: (channelId, eventId) => ref
        .read(channelMessagesProvider(channelId).notifier)
        .removeLocalMessage(eventId),
    isDeliveryValid: () {
      final currentConfig = ref.read(relayConfigProvider);
      return currentConfig.baseUrl == config.baseUrl &&
          currentConfig.nsec == config.nsec;
    },
  );
});
