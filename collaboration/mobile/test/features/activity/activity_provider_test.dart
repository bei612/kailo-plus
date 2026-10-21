import 'dart:async';

import 'package:buzz/features/activity/activity_provider.dart';
import 'package:buzz/features/channels/channel.dart';
import 'package:buzz/features/channels/channels_provider.dart';
import 'package:buzz/shared/read_state/read_state_provider.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

/// Records history queries and live subscriptions for Activity tests. It
/// stands in for the device-keyed relay session (DD-75); nothing here goes
/// through the BFF.
class _RecordingSessionNotifier extends RelaySessionNotifier {
  final List<List<NostrFilter>> queries = [];
  final List<NostrFilter> fetches = [];
  final List<NostrEvent> _history = [];
  final List<({NostrFilter filter, void Function(NostrEvent) onEvent})>
  _subscriptions = [];
  bool failNextQueryRelay = false;
  int unsubscribeCount = 0;

  @override
  SessionState build() => const SessionState(status: SessionStatus.connected);

  @override
  Future<List<NostrEvent>> fetchHistory(
    NostrFilter filter, {
    Duration timeout = const Duration(seconds: 8),
  }) async {
    fetches.add(filter);
    return _history.where((event) => _matches(filter, event)).toList();
  }

  @override
  Future<List<NostrEvent>> queryRelay(
    List<NostrFilter> filters, {
    Duration timeout = const Duration(seconds: 8),
  }) async {
    queries.add(filters);
    if (failNextQueryRelay) {
      failNextQueryRelay = false;
      throw StateError('transient HTTP query failure');
    }
    return _history
        .where((event) => filters.any((filter) => _matches(filter, event)))
        .toList();
  }

  @override
  Future<void Function()> subscribe(
    NostrFilter filter,
    void Function(NostrEvent) onEvent, {
    void Function(String message)? onClosed,
  }) async {
    final subscription = (filter: filter, onEvent: onEvent);
    _subscriptions.add(subscription);
    return () {
      unsubscribeCount += 1;
      _subscriptions.remove(subscription);
    };
  }

  List<NostrFilter> get liveFilters => [
    for (final subscription in _subscriptions) subscription.filter,
  ];

  /// Every `#h` value list in the last history query, in order.
  List<List<String>> get lastQueryDmBatches => [
    for (final filter in queries.last)
      if (filter.tags['#h'] case final ids?) ids,
  ];

  void emit(NostrEvent event) {
    _history.add(event);
    for (final subscription in List.of(_subscriptions)) {
      if (_matches(subscription.filter, event)) {
        subscription.onEvent(event);
      }
    }
  }

  void seed(NostrEvent event) => _history.add(event);

  bool _matches(NostrFilter filter, NostrEvent event) {
    if (!filter.kinds.contains(event.kind)) return false;
    for (final entry in filter.tags.entries) {
      final tagName = entry.key.startsWith('#')
          ? entry.key.substring(1)
          : entry.key;
      final matchesTag = event.tags.any(
        (tag) =>
            tag.length > 1 && tag[0] == tagName && entry.value.contains(tag[1]),
      );
      if (!matchesTag) return false;
    }
    return true;
  }
}

/// Channels provider that starts loading and resolves on demand, modelling a
/// cold start where the channel list arrives after Activity's first fetch.
class _LateChannelsNotifier extends ChannelsNotifier {
  final Completer<List<Channel>> _completer = Completer<List<Channel>>();

  @override
  Future<List<Channel>> build() => _completer.future;

  void resolve(List<Channel> channels) => _completer.complete(channels);
}

class _FixedChannelsNotifier extends ChannelsNotifier {
  _FixedChannelsNotifier(this._channels);
  final List<Channel> _channels;

  @override
  Future<List<Channel>> build() async => _channels;
}

class _FixedRelayConfigNotifier extends RelayConfigNotifier {
  @override
  RelayConfig build() => const RelayConfig(baseUrl: 'https://relay.example');
}

class _FixedReadStateNotifier extends ReadStateNotifier {
  _FixedReadStateNotifier(this._state);
  final ReadStateState _state;

  @override
  ReadStateState build() => _state;
}

Channel _channel(String id, {String type = 'stream'}) => Channel(
  id: id,
  name: id,
  channelType: type,
  visibility: 'private',
  description: '',
  createdBy: 'x',
  createdAt: DateTime(2025),
  memberCount: 2,
  isMember: true,
);

NostrEvent _event(
  String id, {
  int createdAt = 1_700_000_000,
  int kind = 9,
  String pubkey = 'other_pk',
  String channelId = 'channel-1',
  bool addressed = true,
}) => NostrEvent(
  id: id,
  pubkey: pubkey,
  createdAt: createdAt,
  kind: kind,
  tags: [
    if (addressed) ['p', 'me_pk'],
    ['h', channelId],
  ],
  content: 'Hello',
  sig: '',
);

ProviderContainer _container(
  _RecordingSessionNotifier session, {
  ChannelsNotifier Function()? channels,
  List<Override> extra = const [],
}) {
  final container = ProviderContainer(
    overrides: [
      relayConfigProvider.overrideWith(_FixedRelayConfigNotifier.new),
      myPubkeyProvider.overrideWithValue('me_pk'),
      relaySessionProvider.overrideWith(() => session),
      channelsProvider.overrideWith(
        channels ?? () => _FixedChannelsNotifier(const <Channel>[]),
      ),
      ...extra,
    ],
  );
  addTearDown(container.dispose);
  return container;
}

Future<void> _waitFor(bool Function() predicate) async {
  for (var attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
  fail('Condition was not reached before timeout');
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('reads mentions on channel message kinds only', () async {
    final session = _RecordingSessionNotifier();
    final container = _container(session);

    await container.read(channelsProvider.future);
    await container.read(activityProvider.future);

    final mention = session.queries.single.single;
    expect(mention.kinds, EventKind.channelMessageEventKinds);
    expect(mention.tags, {
      '#p': ['me_pk'],
    });
    // Closed or undesigned sources are never read (DD-106, DD-125(5)).
    for (final kind in [1, 43001, 43006, 45001, 45003, 46010, 46012, 30300]) {
      expect(mention.kinds, isNot(contains(kind)));
    }
  });

  test('drops self-authored and unaddressed mentions', () async {
    final session = _RecordingSessionNotifier()
      ..seed(_event('m1', createdAt: 10))
      ..seed(_event('own', createdAt: 20, pubkey: 'ME_PK'))
      ..seed(_event('v2', createdAt: 30, kind: 40002));
    final container = _container(session);

    await container.read(channelsProvider.future);
    final feed = await container.read(activityProvider.future);

    expect(feed.mentions.map((item) => item.id), ['v2', 'm1']);
    expect(feed.activity, isEmpty);
  });

  test('refetches and includes DMs when channels resolve after first '
      'fetch (cold start)', () async {
    final session = _RecordingSessionNotifier();
    final channels = _LateChannelsNotifier();
    final container = _container(session, channels: () => channels);

    // Cold start: channels still loading, so the first fetch has no DM ids.
    await container.read(activityProvider.future);
    expect(session.queries.single, hasLength(1));

    channels.resolve([_channel('dm1', type: 'dm')]);
    await container.read(channelsProvider.future);
    await container.read(activityProvider.future);

    expect(session.queries, hasLength(2));
    expect(session.lastQueryDmBatches, [
      ['dm1'],
    ]);
  });

  test('does not query DMs when the resolved channel list has none', () async {
    final session = _RecordingSessionNotifier();
    final container = _container(
      session,
      channels: () => _FixedChannelsNotifier([_channel('general')]),
    );

    await container.read(channelsProvider.future);
    await container.read(activityProvider.future);

    expect(session.lastQueryDmBatches, isEmpty);
  });

  test('DM traffic from others is activity, tagged DMs mentions', () async {
    final session = _RecordingSessionNotifier()
      ..seed(_event('dm-plain', channelId: 'dm1', addressed: false))
      ..seed(_event('dm-tagged', createdAt: 1_700_000_001, channelId: 'dm1'))
      ..seed(
        _event('dm-own', channelId: 'dm1', pubkey: 'me_pk', addressed: false),
      );
    final container = _container(
      session,
      channels: () => _FixedChannelsNotifier([_channel('dm1', type: 'dm')]),
    );

    await container.read(channelsProvider.future);
    final feed = await container.read(activityProvider.future);

    expect(feed.activity.map((item) => item.id), ['dm-plain']);
    expect(feed.mentions.map((item) => item.id), ['dm-tagged']);
  });

  test('splits DM history and live filters under the relay #h cap', () async {
    final dms = [
      for (var i = 0; i < kMaxExplicitChannelValues + 1; i++)
        _channel('dm$i', type: 'dm'),
    ];
    final session = _RecordingSessionNotifier();
    final container = _container(
      session,
      channels: () => _FixedChannelsNotifier(dms),
    );

    await container.read(channelsProvider.future);
    await container.read(activityProvider.future);

    expect(session.lastQueryDmBatches.map((batch) => batch.length), [
      kMaxExplicitChannelValues,
      1,
    ]);
    await _waitFor(() => session.liveFilters.length == 3);
    final liveDmBatches = [
      for (final filter in session.liveFilters)
        if (filter.tags['#h'] case final ids?) ids.length,
    ];
    expect(liveDmBatches, [kMaxExplicitChannelValues, 1]);
  });

  test('falls back to websocket history when the HTTP batch fails', () async {
    final session = _RecordingSessionNotifier()
      ..seed(_event('fallback-mention'))
      ..failNextQueryRelay = true;
    final container = _container(session);

    await container.read(channelsProvider.future);
    final feed = await container.read(activityProvider.future);

    expect(session.fetches, hasLength(1));
    expect(feed.mentions.map((item) => item.id), ['fallback-mention']);
  });

  test('refreshes the inbox when addressed activity arrives', () async {
    final session = _RecordingSessionNotifier();
    final container = _container(session);

    await container.read(channelsProvider.future);
    await container.read(activityProvider.future);
    await _waitFor(() => session.liveFilters.isNotEmpty);
    expect(container.read(inboxItemsProvider), isEmpty);

    session.emit(_event('live-mention', kind: 40002));

    await _waitFor(() => container.read(inboxItemsProvider).isNotEmpty);
    expect(container.read(inboxItemsProvider).single.id, 'live-mention');
  });

  test('disposing the feed closes its live subscriptions', () async {
    final session = _RecordingSessionNotifier();
    final container = ProviderContainer(
      overrides: [
        relayConfigProvider.overrideWith(_FixedRelayConfigNotifier.new),
        myPubkeyProvider.overrideWithValue('me_pk'),
        relaySessionProvider.overrideWith(() => session),
        channelsProvider.overrideWith(
          () => _FixedChannelsNotifier([_channel('dm1', type: 'dm')]),
        ),
      ],
    );

    await container.read(channelsProvider.future);
    await container.read(activityProvider.future);
    await _waitFor(() => session.liveFilters.length == 2);

    container.dispose();
    expect(session.unsubscribeCount, 2);
    expect(session.liveFilters, isEmpty);
  });

  group('unreadInboxItemCountProvider', () {
    ProviderContainer countContainer(ReadStateState readState) {
      final session = _RecordingSessionNotifier()
        ..seed(_event('m1', createdAt: 50))
        ..seed(_event('m2', createdAt: 60, channelId: 'channel-2'));
      return _container(
        session,
        extra: [
          readStateProvider.overrideWith(
            () => _FixedReadStateNotifier(readState),
          ),
        ],
      );
    }

    test('stays zero until the Core read authority is ready', () async {
      final container = countContainer(
        const ReadStateState(
          isReady: false,
          pubkey: 'me_pk',
          contexts: {},
          version: 1,
        ),
      );
      await container.read(channelsProvider.future);
      await container.read(activityProvider.future);

      expect(container.read(unreadInboxItemCountProvider), 0);
    });

    test('counts rows newer than their shared read marker', () async {
      final container = countContainer(
        const ReadStateState(
          isReady: true,
          pubkey: 'me_pk',
          contexts: {'channel-1': 50},
          version: 1,
        ),
      );
      await container.read(channelsProvider.future);
      await container.read(activityProvider.future);

      expect(container.read(unreadInboxItemCountProvider), 1);
    });

    test('a session-local Mark unread counts again', () async {
      final container = countContainer(
        const ReadStateState(
          isReady: true,
          pubkey: 'me_pk',
          contexts: {'channel-1': 50, 'channel-2': 60},
          version: 1,
          forcedUnreadContexts: {'channel-2': 'channel-2'},
        ),
      );
      await container.read(channelsProvider.future);
      await container.read(activityProvider.future);

      expect(container.read(unreadInboxItemCountProvider), 1);
    });
  });
}
