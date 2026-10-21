import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/read_state/read_state_provider.dart';
import '../../shared/relay/relay.dart';
import '../channels/channel.dart';
import '../channels/channels_provider.dart';
import 'feed_item.dart';
import 'inbox_item.dart';
import 'inbox_read_state.dart';

/// Builds the Activity inbox feed directly from the relay with this device's
/// key (DD-75: native clients read the collaboration plane themselves; Core is
/// not on this path).
///
/// Sources mirror desktop's Home inbox (`useHomeFeedQuery` + `get_feed`):
/// - mentions of me on user-visible channel message kinds (also yields thread
///   replies, which the thread filter classifies from NIP-10 tags)
/// - recent DM messages from others (desktop surfaces DMs through p-tags;
///   mobile queries DM channels directly so untagged DM sends still appear)
///
/// Not read here, unlike the original Mobile feed: workflow approvals
/// (46010–46012, closed by DD-106), agent job lifecycle (43001–43006, no
/// Kailo design), notes and forum kinds (Mobile has no surface to open them),
/// and hidden-DM resurfacing (Kailo reopens a DM through the governed
/// `conversation.open` path, not as a side effect of reading).
class ActivityNotifier extends AsyncNotifier<HomeFeedResponse> {
  static const _addressedKinds = EventKind.channelMessageEventKinds;
  static const _dmKinds = [EventKind.streamMessage];

  void Function()? _unsubscribeAddressed;
  final List<void Function()> _unsubscribeDms = [];
  Timer? _liveRefreshTimer;
  Future<void>? _refreshInFlight;
  int? _refreshGeneration;
  bool _refreshQueued = false;
  int _subscriptionGeneration = 0;

  @override
  Future<HomeFeedResponse> build() async {
    ref.watch(relayConfigProvider);
    final sessionState = ref.watch(relaySessionProvider);
    // React to the DM channel set (loading → data, membership changes) so a
    // cold start where channels resolve after the first fetch still surfaces
    // DMs without a manual refresh.
    ref.watch(channelsProvider.select(_dmChannelKey));

    final generation = ++_subscriptionGeneration;
    _clearLiveSubscriptions();
    ref.onDispose(() {
      _subscriptionGeneration += 1;
      _clearLiveSubscriptions();
    });

    final response = await _fetch();
    if (sessionState.status == SessionStatus.connected &&
        generation == _subscriptionGeneration) {
      unawaited(_subscribeLive(generation));
    }
    return response;
  }

  Future<void> _subscribeLive(int generation) async {
    final myPk = ref.read(myPubkeyProvider);
    if (myPk == null || generation != _subscriptionGeneration) return;

    final session = ref.read(relaySessionProvider.notifier);
    final since = DateTime.now().millisecondsSinceEpoch ~/ 1000 - 5;
    try {
      final unsubscribeAddressed = await session.subscribe(
        NostrFilter(
          kinds: _addressedKinds,
          tags: {
            '#p': [myPk],
          },
          since: since,
          limit: 100,
        ),
        (_) => _scheduleLiveRefresh(generation),
      );
      if (generation != _subscriptionGeneration) {
        unsubscribeAddressed();
        return;
      }
      _unsubscribeAddressed = unsubscribeAddressed;

      // The relay rejects a REQ whose explicit `#h` values exceed
      // [kMaxExplicitChannelValues]; batch under the cap so one rejected
      // batch stays isolated to that batch.
      final visibleUnsubscribers = await _subscribeChannelBatches(
        session,
        generation,
        channelIds: _memberDmChannelIds(),
        kinds: _dmKinds,
        since: since,
        onEvent: (_) => _scheduleLiveRefresh(generation),
      );
      if (visibleUnsubscribers == null) return;
      _unsubscribeDms.addAll(visibleUnsubscribers);
    } catch (error) {
      if (generation == _subscriptionGeneration) {
        debugPrint('[ActivityNotifier] live subscription failed: $error');
      }
    }
  }

  /// Subscribes to a channel-scoped live feed split into batches that never
  /// exceed [kMaxExplicitChannelValues] explicit `#h` values. Each batch is
  /// its own subscription owned by [generation]. The generation is checked
  /// before every `subscribe` and immediately after each await, so teardown
  /// mid-setup disposes everything this call already opened and stops issuing
  /// REQs. A single batch's rejection is isolated so later batches still
  /// register.
  ///
  /// Returns the accumulated unsubscribers for the caller to retain, or `null`
  /// if a newer generation superseded this call.
  Future<List<void Function()>?> _subscribeChannelBatches(
    RelaySessionNotifier session,
    int generation, {
    required List<String> channelIds,
    required List<int> kinds,
    required int since,
    required void Function(NostrEvent) onEvent,
  }) async {
    final unsubscribers = <void Function()>[];
    void closeAll() {
      for (final unsubscribe in unsubscribers) {
        unsubscribe();
      }
    }

    for (final batch in _channelBatches(channelIds)) {
      if (generation != _subscriptionGeneration) {
        closeAll();
        return null;
      }
      try {
        final unsubscribe = await session.subscribe(
          NostrFilter(
            kinds: kinds,
            tags: {'#h': batch},
            since: since,
            limit: 100,
          ),
          onEvent,
        );
        if (generation != _subscriptionGeneration) {
          unsubscribe();
          closeAll();
          return null;
        }
        unsubscribers.add(unsubscribe);
      } catch (error) {
        if (generation != _subscriptionGeneration) {
          closeAll();
          return null;
        }
        debugPrint(
          '[ActivityNotifier] channel batch subscription failed: $error',
        );
      }
    }
    if (generation != _subscriptionGeneration) {
      closeAll();
      return null;
    }
    return unsubscribers;
  }

  void _scheduleLiveRefresh(int generation) {
    if (generation != _subscriptionGeneration) return;
    _liveRefreshTimer?.cancel();
    _liveRefreshTimer = Timer(
      const Duration(milliseconds: 50),
      () => unawaited(_queueRefresh(generation)),
    );
  }

  Future<void> _queueRefresh(int generation) {
    if (generation != _subscriptionGeneration) return Future.value();
    _refreshQueued = true;
    final inFlight = _refreshInFlight;
    if (_refreshGeneration == generation && inFlight != null) {
      return inFlight;
    }

    _refreshGeneration = generation;
    final future = _drainRefreshQueue(generation);
    _refreshInFlight = future;
    return future;
  }

  Future<void> _drainRefreshQueue(int generation) async {
    try {
      do {
        _refreshQueued = false;
        try {
          final next = await _fetch();
          if (generation != _subscriptionGeneration) return;
          state = AsyncData(next);
        } catch (error) {
          if (generation != _subscriptionGeneration) return;
          debugPrint(
            '[ActivityNotifier] inbox refresh failed; retaining feed: $error',
          );
        }
      } while (_refreshQueued && generation == _subscriptionGeneration);
    } finally {
      if (_refreshGeneration == generation) {
        _refreshInFlight = null;
        _refreshGeneration = null;
        _refreshQueued = false;
      }
    }
  }

  void _clearLiveSubscriptions() {
    _liveRefreshTimer?.cancel();
    _liveRefreshTimer = null;
    _refreshInFlight = null;
    _refreshGeneration = null;
    _refreshQueued = false;
    _unsubscribeAddressed?.call();
    _unsubscribeAddressed = null;
    for (final unsubscribe in _unsubscribeDms) {
      unsubscribe();
    }
    _unsubscribeDms.clear();
  }

  /// Stable identity for the joined DM channel set: null while channels are
  /// loading, otherwise the sorted member-DM ids. Keeps unrelated channel
  /// updates from refetching the feed.
  static String? _dmChannelKey(AsyncValue<List<Channel>> channels) {
    final value = channels.asData?.value;
    if (value == null) return null;
    final ids = [
      for (final channel in value)
        if (channel.isDm && channel.isMember) channel.id,
    ]..sort();
    return ids.join(',');
  }

  /// DM channels come from the channel list, which already drops DMs that
  /// are hidden, ended or no longer match their Core conversation binding.
  /// While it is still loading the DM source is skipped, and build() rebuilds
  /// when it resolves (see the channelsProvider watch above).
  List<String> _memberDmChannelIds() => [
    for (final channel
        in ref.read(channelsProvider).asData?.value ?? const <Channel>[])
      if (channel.isDm && channel.isMember) channel.id,
  ];

  static Iterable<List<String>> _channelBatches(
    List<String> channelIds,
  ) sync* {
    for (
      var start = 0;
      start < channelIds.length;
      start += kMaxExplicitChannelValues
    ) {
      final end = start + kMaxExplicitChannelValues < channelIds.length
          ? start + kMaxExplicitChannelValues
          : channelIds.length;
      yield channelIds.sublist(start, end);
    }
  }

  Future<HomeFeedResponse> _fetch() async {
    final myPk = ref.read(myPubkeyProvider);
    if (myPk == null) return HomeFeedResponse.empty();

    final session = ref.read(relaySessionProvider.notifier);
    final dmChannelIds = _memberDmChannelIds();

    final filters = <NostrFilter>[
      // Mentions of me on user-visible channel content.
      NostrFilter(
        kinds: _addressedKinds,
        tags: {
          '#p': [myPk],
        },
        limit: 50,
      ),
      // Recent DM traffic (filtered to other senders below).
      for (final batch in _channelBatches(dmChannelIds))
        NostrFilter(kinds: _dmKinds, tags: {'#h': batch}, limit: 30),
    ];

    // The HTTP bridge keeps each NIP-01 filter's independent limit while
    // executing the batch with bounded server-side concurrency. One request
    // here replaces simultaneous websocket history subscriptions that would
    // otherwise compete with channel and preference startup sync.
    final events = await _queryWithWebSocketFallback(session, filters);

    final me = myPk.toLowerCase();
    bool isFromOther(NostrEvent e) => e.pubkey.toLowerCase() != me;
    bool isAddressedToMe(NostrEvent event) => event.tags.any(
      (tag) => tag.length > 1 && tag[0] == 'p' && tag[1].toLowerCase() == me,
    );

    final dmChannelIdSet = dmChannelIds.toSet();

    // Dedupe across sources by event id, keeping the higher-priority
    // category (mention > activity).
    final byId = <String, FeedItem>{};
    void add(Iterable<NostrEvent> events, String category) {
      for (final event in events) {
        final existing = byId[event.id];
        if (existing != null &&
            categoryPriority(existing.category) <= categoryPriority(category)) {
          continue;
        }
        byId[event.id] = _feedItem(event, category: category);
      }
    }

    add(
      events.where(
        (event) =>
            _addressedKinds.contains(event.kind) &&
            isAddressedToMe(event) &&
            isFromOther(event),
      ),
      'mention',
    );
    add(
      events.where(
        (event) =>
            _dmKinds.contains(event.kind) &&
            dmChannelIdSet.contains(event.channelId) &&
            isFromOther(event),
      ),
      'activity',
    );

    final items = byId.values.toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));

    return HomeFeedResponse(
      mentions: [
        for (final i in items)
          if (i.category == 'mention') i,
      ],
      activity: [
        for (final i in items)
          if (i.category == 'activity') i,
      ],
    );
  }

  Future<List<NostrEvent>> _queryWithWebSocketFallback(
    RelaySessionNotifier session,
    List<NostrFilter> filters,
  ) async {
    try {
      return await session.queryRelay(filters);
    } catch (error) {
      debugPrint(
        '[ActivityNotifier] batched history query failed; '
        'using bounded websocket fallback: $error',
      );
    }

    const fallbackConcurrency = 4;
    final events = <NostrEvent>[];
    for (var start = 0; start < filters.length; start += fallbackConcurrency) {
      final end = start + fallbackConcurrency < filters.length
          ? start + fallbackConcurrency
          : filters.length;
      final results = await Future.wait(
        filters.sublist(start, end).map((filter) async {
          try {
            return await session.fetchHistory(filter);
          } catch (_) {
            return const <NostrEvent>[];
          }
        }),
      );
      for (final result in results) {
        events.addAll(result);
      }
    }
    return events;
  }

  FeedItem _feedItem(NostrEvent event, {required String category}) {
    return FeedItem(
      id: event.id,
      kind: event.kind,
      pubkey: event.pubkey,
      content: event.content,
      createdAt: event.createdAt,
      channelId: event.channelId,
      tags: event.tags,
      category: category,
    );
  }

  Future<void> refresh() async {
    await _queueRefresh(_subscriptionGeneration);
  }
}

final activityProvider =
    AsyncNotifierProvider<ActivityNotifier, HomeFeedResponse>(
      ActivityNotifier.new,
    );

/// Conversation-grouped inbox rows derived from the raw feed. DM messages
/// group by DM channel so one conversation renders as one row.
final inboxItemsProvider = Provider<List<InboxItem>>((ref) {
  final feed = ref.watch(activityProvider).value;
  if (feed == null) return const [];
  final dmChannelIds = {
    for (final channel
        in ref.watch(channelsProvider).asData?.value ?? const <Channel>[])
      if (channel.isDm) channel.id,
  };
  return buildInboxItems(feed.all, isDmChannel: dmChannelIds.contains);
});

/// Number of unread Activity rows, for the tab's unread dot — the original
/// `_unreadInboxItemCountProvider`. Zero until the Core read authority has
/// loaded, so a cold start never flashes every row as unread.
final unreadInboxItemCountProvider = Provider<int>((ref) {
  final readState = ref.watch(readStateProvider);
  if (!readState.isReady) return 0;
  final items = ref.watch(inboxItemsProvider);
  return items
      .where(
        (item) => !isInboxItemDone(
          item,
          markerOf: readState.effectiveTimestamp,
          isForcedUnread: readState.isForcedUnread,
        ),
      )
      .length;
});
