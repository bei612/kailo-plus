import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/mentions/agent_identity_provider.dart';
import '../../shared/relay/relay.dart';
import '../../shared/utils/string_utils.dart';
import 'channel.dart';
import 'channels_provider.dart';

/// Channel 的读取面。Kailo 里 Channel 与 roster 只由 Core 经 Tenant CONTROL 变更
/// （`DD-80`）：成员不建 Channel、不加人、不改元数据、不发表情回应，这些写入口
/// 在移动端一律不存在。

@immutable
class ChannelMember {
  final String pubkey;
  final String role;
  final DateTime joinedAt;
  final String? displayName;

  const ChannelMember({
    required this.pubkey,
    required this.role,
    required this.joinedAt,
    this.displayName,
  });

  bool get isBot => role == 'bot';
  bool get isOwner => role == 'owner';
  bool get isElevated => role == 'owner' || role == 'admin';

  String labelFor(String? currentPubkey) {
    if (currentPubkey != null &&
        currentPubkey.toLowerCase() == pubkey.toLowerCase()) {
      return 'You';
    }
    if (displayName case final name? when name.trim().isNotEmpty) {
      return name.trim();
    }
    return shortPubkey(pubkey);
  }
}

String _channelMemberSnapshotKey({
  required String relayBaseUrl,
  required String? pubkey,
  required String channelId,
}) =>
    '${relayBaseUrl.toLowerCase()}::${pubkey?.toLowerCase() ?? 'anon'}::$channelId';

class _ChannelMembersSnapshotCache {
  final _membersByKey = <String, List<ChannelMember>>{};

  List<ChannelMember>? read({
    required String relayBaseUrl,
    required String? pubkey,
    required String channelId,
  }) =>
      _membersByKey[_channelMemberSnapshotKey(
        relayBaseUrl: relayBaseUrl,
        pubkey: pubkey,
        channelId: channelId,
      )];

  void write({
    required String relayBaseUrl,
    required String? pubkey,
    required String channelId,
    required List<ChannelMember> members,
  }) {
    _membersByKey[_channelMemberSnapshotKey(
      relayBaseUrl: relayBaseUrl,
      pubkey: pubkey,
      channelId: channelId,
    )] = List.unmodifiable(
      members,
    );
  }
}

final _channelMembersSnapshotCacheProvider =
    Provider<_ChannelMembersSnapshotCache>((ref) {
      return _ChannelMembersSnapshotCache();
    });

/// Uses the relay-backed member list when connected, but keeps the channel
/// snapshot visible while a reconnect temporarily interrupts the refresh.
///
/// The provider retains its current value while disconnected and also keeps a
/// relay/account/channel-scoped snapshot for consumers that mount during the
/// reconnect window. An empty member list is authoritative only after a
/// connected fetch completes.
List<ChannelMember> channelMembersForAutocomplete({
  required AsyncValue<List<ChannelMember>> membersAsync,
  required SessionStatus sessionStatus,
  required List<ChannelMember> cachedMembers,
}) {
  final loadedMembers = membersAsync.asData?.value;
  if (loadedMembers == null) return cachedMembers;
  if (sessionStatus != SessionStatus.connected && loadedMembers.isEmpty) {
    return cachedMembers;
  }
  return loadedMembers;
}

/// The signing identity used for events: this device's key.
final currentPubkeyProvider = Provider<String?>(
  (ref) => ref.watch(myPubkeyProvider)?.toLowerCase(),
);

/// Build [ChannelDetails] from a kind:39000 metadata event.
///
/// Exposed as a pure function so the mapping can be unit-tested without
/// Riverpod / WebSocket scaffolding. Make sure all fields parsed by
/// [ChannelData.fromEvent] that exist on [ChannelDetails] are propagated —
/// any omission silently drops state when [Channel.mergeDetails] is called.
@visibleForTesting
ChannelDetails channelDetailsFromEvent(NostrEvent event) {
  final data = ChannelData.fromEvent(event);
  final eventTime = DateTime.fromMillisecondsSinceEpoch(
    event.createdAt * 1000,
    isUtc: true,
  );
  return ChannelDetails(
    id: data.id,
    name: data.name,
    channelType: data.channelType,
    visibility: data.visibility,
    description: data.description,
    topic: data.topic,
    createdBy: event.pubkey,
    createdAt: eventTime,
    memberCount: 0,
    // Same archival-timestamp convention as `_channelFromMeta` — the event's
    // `createdAt` is when the relay republished the metadata. Without this,
    // `Channel.mergeDetails(details)` would clobber the archived state set
    // on the base channel and the detail view would show compose/manage
    // actions for expired/archived channels.
    archivedAt: data.isArchived ? eventTime : null,
  );
}

/// Single channel's metadata via kind:39000.
final channelDetailsProvider = FutureProvider.family<ChannelDetails, String>((
  ref,
  channelId,
) async {
  final session = ref.watch(relaySessionProvider.notifier);
  final events = await session.fetchHistory(
    NostrFilter(
      kinds: [39000],
      tags: {
        '#d': [channelId],
      },
      limit: 1,
    ),
  );
  if (events.isEmpty) {
    throw Exception('Channel not found: $channelId');
  }
  return channelDetailsFromEvent(events.first);
});

/// Channel members from kind:39002 NIP-29 members event.
final channelMembersProvider = FutureProvider.autoDispose
    .family<List<ChannelMember>, String>((ref, channelId) async {
      ref.watch(
        channelMembershipUpdateProvider(
          channelId,
        ).select((update) => update.version),
      );
      final relayBaseUrl = ref.watch(relayConfigProvider).baseUrl;
      final pubkey = ref.watch(myPubkeyProvider)?.toLowerCase();
      final snapshotCache = ref.read(_channelMembersSnapshotCacheProvider);
      // Re-fetch only after reconnect completes. During the disconnected
      // interval this provider has no session dependency, so its current value
      // remains visible to every consumer rather than becoming AsyncData([]).
      ref.listen(relaySessionProvider, (previous, next) {
        if (next.status == SessionStatus.connected &&
            previous?.status != SessionStatus.connected) {
          ref.invalidateSelf();
        }
      });
      final sessionState = ref.read(relaySessionProvider);
      if (sessionState.status != SessionStatus.connected) {
        final cachedMembers = snapshotCache.read(
          relayBaseUrl: relayBaseUrl,
          pubkey: pubkey,
          channelId: channelId,
        );
        if (cachedMembers != null) return cachedMembers;
        final channelListMembers = ref
            .read(channelsProvider.notifier)
            .cachedMembersForChannel(channelId);
        if (channelListMembers.isNotEmpty) {
          snapshotCache.write(
            relayBaseUrl: relayBaseUrl,
            pubkey: pubkey,
            channelId: channelId,
            members: channelListMembers,
          );
          return channelListMembers;
        }
        return const [];
      }
      final session = ref.read(relaySessionProvider.notifier);
      final events = await session.fetchHistory(
        NostrFilters.channelMembers(channelId),
      );
      if (events.isEmpty) {
        snapshotCache.write(
          relayBaseUrl: relayBaseUrl,
          pubkey: pubkey,
          channelId: channelId,
          members: const [],
        );
        return const [];
      }
      final event = events.first;
      final joinedAt = DateTime.fromMillisecondsSinceEpoch(
        event.createdAt * 1000,
        isUtc: true,
      );
      final members = membersFromEvent(event)
          .map(
            (m) => ChannelMember(
              pubkey: m.pubkey,
              role: m.role,
              joinedAt: joinedAt,
            ),
          )
          .toList();
      snapshotCache.write(
        relayBaseUrl: relayBaseUrl,
        pubkey: pubkey,
        channelId: channelId,
        members: members,
      );
      return members;
    });
