import 'package:buzz/shared/read_state/read_state_format.dart';
import 'dart:convert';
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:buzz/shared/platform/platform_api.dart';
import 'package:buzz/shared/platform/platform_config.dart';
import 'package:buzz/shared/platform/platform_views.dart';
import 'package:http/testing.dart';
import '../../../shared/platform/platform_test_support.dart';
import 'package:buzz/shared/read_state/read_state_provider.dart';
import 'package:buzz/shared/community/community_provider.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme_provider.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:nostr/nostr.dart' as nostr;
import 'package:shared_preferences/shared_preferences.dart';

/// Drives the production [ReadStateNotifier] (real bookkeeping, real
/// [ReadStateManager]) against an inert fake relay session, so a defect in
/// the forced-unread map removal or the manager-emission path fails here
/// instead of being masked by a fake notifier.
void main() {
  const channelId = '11111111-2222-4333-8444-555555555555';
  const otherChannelId = '22222222-3333-4444-8555-666666666666';
  final msgKey = msgContextKey('ab' * 32);
  final otherMsgKey = msgContextKey('cd' * 32);

  late ProviderContainer container;

  Future<ReadStateNotifier> pumpNotifier({
    Map<String, int> initial = const {},
  }) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final nsec = nostr.Keys.generate().nsec;
    var version = 0;
    final contexts = <String, String>{
      for (final entry in initial.entries)
        entry.key: DateTime.fromMillisecondsSinceEpoch(
          entry.value * 1000,
          isUtc: true,
        ).toIso8601String(),
    };
    final client = MockClient((request) async {
      final oidc = oidcRoutes(request, refreshed: 'a');
      if (oidc != null) return oidc;
      if (request.url.path == '/api/v1/session') {
        return jsonResponse(sessionView());
      }
      if (request.method == 'PUT') {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        if (body['version'] != version) return jsonResponse(null, 409);
        contexts[body['contextKey']] = body['lastReadAt'];
        return jsonResponse({'version': ++version});
      }
      return jsonResponse({'version': version, 'readContexts': contexts});
    });

    container = ProviderContainer(
      overrides: [
        savedPrefsProvider.overrideWithValue(prefs),
        platformConfigProvider.overrideWith(_TestPlatformConfig.new),
        platformSessionViewProvider.overrideWith(
          (ref) async => PlatformSessionView.fromJson(sessionView()),
        ),
        nativeSessionProvider.overrideWithValue(
          NativeSession(
            client: client,
            refreshStore: MemoryRefreshStore()..value = 'r',
          ),
        ),
        relayConfigProvider.overrideWith(() => _FakeRelayConfig(nsec)),
        relaySessionProvider.overrideWith(_FakeRelaySession.new),
        activeCommunityProvider.overrideWith((ref) async => null),
        appLifecycleProvider.overrideWith(_FakeAppLifecycle.new),
      ],
    );
    addTearDown(container.dispose);

    final notifier = container.read(readStateProvider.notifier);
    // Let the async activeCommunity resolution, the resulting rebuild, and
    // the manager initialize() microtasks run.
    await container.read(activeCommunityProvider.future);
    await container.read(platformSessionViewProvider.future);
    for (var i = 0; i < 10 && !container.read(readStateProvider).isReady; i++) {
      await Future<void>.delayed(Duration.zero);
    }
    expect(container.read(readStateProvider).isReady, isTrue);
    return notifier;
  }

  ReadStateState state() => container.read(readStateProvider);

  test('message unread → read → unread round-trips through the real '
      'notifier', () async {
    final notifier = await pumpNotifier();

    // Force the message unread.
    notifier.markContextUnread(msgKey, channelId: channelId);
    expect(state().isForcedUnread(msgKey), isTrue);
    expect(state().locallyForcedChannelIds, {channelId});

    // Mark read: the force flag must drop out of the production map AND the
    // marker must land in the manager's effective contexts.
    expect(await notifier.markContextReadConfirmed(msgKey, 1000), isTrue);
    expect(state().isForcedUnread(msgKey), isFalse);
    expect(state().forcedUnreadContexts, isEmpty);
    expect(state().effectiveTimestamp(msgKey), 1000);

    // Force unread again: read markers are monotonic, so the flag is the
    // only mechanism — it must win even though the marker persists.
    notifier.markContextUnread(msgKey, channelId: channelId);
    expect(state().isForcedUnread(msgKey), isTrue);
    expect(state().effectiveTimestamp(msgKey), 1000);
  });

  test('explicit channel-level Mark read clears forced message entries in '
      'that channel only', () async {
    final notifier = await pumpNotifier();

    notifier.markContextUnread(msgKey, channelId: channelId);
    notifier.markContextUnread(otherMsgKey, channelId: otherChannelId);

    // Channel tile "Mark as read" passes clearForcedMessages: true.
    expect(await notifier.markContextReadConfirmed(channelId, 2000), isTrue);

    expect(state().isForcedUnread(msgKey), isFalse);
    expect(state().isForcedUnread(otherMsgKey), isTrue);
    expect(state().locallyForcedChannelIds, {otherChannelId});
    expect(state().effectiveTimestamp(channelId), 2000);
  });

  test(
    'automatic channel-open read preserves forced message entries',
    () async {
      final notifier = await pumpNotifier(initial: {channelId: 3000});

      notifier.markContextUnread(msgKey, channelId: channelId);

      // Channel open marks the channel read without clearForcedMessages.
      notifier.markContextRead(channelId, 3000);

      expect(state().isForcedUnread(msgKey), isTrue);
      expect(state().locallyForcedChannelIds, {channelId});
      expect(state().effectiveTimestamp(channelId), 3000);
    },
  );

  test('automatic channel-open read still clears a channel-level force for '
      'the same channel', () async {
    final notifier = await pumpNotifier(initial: {channelId: 4000});

    // Channel forced unread from the tile, message forced from the sheet.
    notifier.markContextUnread(channelId, channelId: channelId);
    notifier.markContextUnread(msgKey, channelId: channelId);

    notifier.markContextRead(channelId, 4000);

    // Opening the channel satisfies the channel-scoped force, but the
    // deliberate message-level force survives until acted on.
    expect(state().isForcedUnread(channelId), isFalse);
    expect(state().isForcedUnread(msgKey), isTrue);
    expect(state().locallyForcedChannelIds, {channelId});
  });
}

class _TestPlatformConfig extends PlatformConfigNotifier {
  @override
  PlatformConfig? build() => testPlatformConfig;
}

class _FakeRelayConfig extends RelayConfigNotifier {
  final String nsec;

  _FakeRelayConfig(this.nsec);

  @override
  RelayConfig build() => RelayConfig(baseUrl: 'http://localhost:1', nsec: nsec);
}

/// Relay session that never connects and returns no history, keeping the
/// manager fully local while exercising its real code paths.
class _FakeRelaySession extends RelaySessionNotifier {
  @override
  SessionState build() =>
      const SessionState(status: SessionStatus.disconnected);

  @override
  Future<List<NostrEvent>> fetchHistory(
    NostrFilter filter, {
    Duration timeout = const Duration(seconds: 8),
  }) async => [];

  @override
  Future<void Function()> subscribe(
    NostrFilter filter,
    void Function(NostrEvent) onEvent, {
    void Function(String message)? onClosed,
  }) async => () {};
}

class _FakeAppLifecycle extends AppLifecycleNotifier {
  @override
  AppLifecycleState build() => AppLifecycleState.resumed;
}
