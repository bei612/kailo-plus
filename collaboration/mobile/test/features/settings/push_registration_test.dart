import 'dart:async';

import 'package:buzz/shared/deeplink/deep_link.dart';
import 'package:buzz/shared/platform/platform_api.dart';
import 'package:buzz/shared/push/push_bridge.dart';
import 'package:buzz/shared/push/push_registration.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:nostr/nostr.dart' as nostr;

class _FakeBridge implements PushBridge {
  final _tokens = StreamController<String>.broadcast();
  final _opened = StreamController<MessageDeepLink>.broadcast();
  int registrations = 0;
  String token = 'ab' * 32;

  @override
  Future<PushAuthorizationStatus?> authorizationStatus() async =>
      PushAuthorizationStatus.authorized;

  @override
  Future<bool> openNotificationSettings() async => true;

  @override
  Future<void> startRegistration() async {
    registrations++;
    scheduleMicrotask(() => _tokens.add(token));
  }

  @override
  Stream<String> get tokens => _tokens.stream;

  @override
  Stream<MessageDeepLink> get opened => _opened.stream;

  @override
  Future<MessageDeepLink?> takePendingOpen() async => null;

  final presentations = <List<PushPresentationCommunity>>[];

  @override
  Future<void> syncPresentation(
    List<PushPresentationCommunity> communities,
  ) async => presentations.add(communities);
}

const _session = {
  'accessMode': 'FULL',
  'displayName': 'Dana',
  'humanIdentityId': '00000000-0000-4000-8000-000000000001',
  'platformSessionId': '00000000-0000-4000-8000-000000000002',
  'tenantId': '00000000-0000-4000-8000-000000000003',
  'tenantMembershipId': '00000000-0000-4000-8000-000000000004',
  'tenantPrincipalId': '00000000-0000-4000-8000-000000000005',
  'expiresAt': '2026-10-31T00:00:00Z',
  'issuedAt': '2026-10-30T00:00:00Z',
  'status': 'ACTIVE',
};

void main() {
  final keys = nostr.Keys.generate();

  Map<String, Object?> view({required bool enabled, required int version}) => {
    'devicePubkey': keys.public,
    'platform': 'APNS',
    'appId': 'chat.kailo.mobile',
    'locale': 'zh-CN',
    'enabled': enabled,
    'state': 'ACTIVE',
    'version': version,
    'updatedAt': '2026-10-30T08:00:00Z',
  };

  ({ProviderContainer container, List<(PlatformMethod, String, Object?)> calls})
  harness({
    required String apns,
    required PlatformResponse Function(PlatformMethod, String, Object?) put,
    _FakeBridge? bridge,
    String? relayUrl = 'wss://relay.example.test',
  }) {
    final calls = <(PlatformMethod, String, Object?)>[];
    final deps = PushRegistrationDeps(
      send: (method, path, {body}) async {
        calls.add((method, path, body));
        if (path == pushCapabilityPath) {
          return PlatformResponse(200, {'apns': apns, 'fcm': 'NOT_CONFIGURED'});
        }
        if (path == '/api/v1/session') {
          return const PlatformResponse(200, _session);
        }
        if (method == PlatformMethod.put) return put(method, path, body);
        return const PlatformResponse(404, {});
      },
      deviceKeys: () async => keys,
      appId: () async => 'chat.kailo.mobile',
      apiUri: (path) => Uri.parse('https://native.example.test$path'),
      locale: () => 'zh-CN',
      relayUrl: () => relayUrl,
    );
    final container = ProviderContainer(
      overrides: [
        pushRegistrationDepsProvider.overrideWithValue(deps),
        pushBridgeProvider.overrideWithValue(bridge ?? _FakeBridge()),
      ],
    );
    addTearDown(container.dispose);
    return (container: container, calls: calls);
  }

  Future<DevicePushState> loaded(ProviderContainer container) async {
    container.read(pushRegistrationProvider);
    for (
      var i = 0;
      i < 20 && container.read(pushRegistrationProvider).loading;
      i++
    ) {
      await Future<void>.delayed(Duration.zero);
    }
    return container.read(pushRegistrationProvider);
  }

  test(
    'an unconfigured deployment keeps the original unavailable state',
    () async {
      final h = harness(
        apns: 'NOT_CONFIGURED',
        put: (_, _, _) => fail('no PUT'),
      );
      final state = await loaded(h.container);
      expect(state.available, isFalse);
      await h.container
          .read(pushRegistrationProvider.notifier)
          .setEnabled(true);
      expect(h.calls.where((c) => c.$1 == PlatformMethod.put), isEmpty);
    },
  );

  test(
    'turning on registers this device token once with a device-key proof',
    () async {
      Object? sent;
      final bridge = _FakeBridge();
      final h = harness(
        apns: 'CONFIGURED',
        bridge: bridge,
        put: (_, _, body) {
          sent = body;
          return PlatformResponse(200, view(enabled: true, version: 1));
        },
      );
      expect((await loaded(h.container)).available, isTrue);
      await h.container
          .read(pushRegistrationProvider.notifier)
          .setEnabled(true);
      final state = h.container.read(pushRegistrationProvider);
      expect(state.effectiveEnabled, isTrue);
      expect(state.version, 1);
      expect(bridge.registrations, 1);
      final body = sent! as Map<String, Object?>;
      expect(body['token'], bridge.token);
      expect(body['expectedVersion'], 0);
      expect(body['platform'], 'APNS');
      expect(body['locale'], 'zh-CN');
      final proof = body['proof']! as Map<String, dynamic>;
      expect(proof['kind'], 27235);
      expect(proof['pubkey'], keys.public);
      final tags = (proof['tags'] as List)
          .map((t) => (t as List).cast<String>())
          .toList();
      expect(tags, anyElement(equals(['method', 'PUT'])));
      expect(
        tags,
        anyElement(
          equals(['u', 'https://native.example.test$pushRegistrationPath']),
        ),
      );
      expect(
        tags,
        anyElement(equals(['session', '00000000-0000-4000-8000-000000000002'])),
      );
      // The same token arriving again (APNs echo) does not re-register.
      await h.container
          .read(pushRegistrationProvider.notifier)
          .tokenChanged(bridge.token);
      expect(h.calls.where((c) => c.$1 == PlatformMethod.put), hasLength(1));
    },
  );

  test(
    'turning on lets the notification extension read through this device only',
    () async {
      final bridge = _FakeBridge();
      final h = harness(
        apns: 'CONFIGURED',
        bridge: bridge,
        put: (_, _, _) => PlatformResponse(200, view(enabled: true, version: 1)),
      );
      await loaded(h.container);
      // Nothing registered yet: the extension is given nothing.
      expect(bridge.presentations.last, isEmpty);
      await h.container
          .read(pushRegistrationProvider.notifier)
          .setEnabled(true);
      expect(bridge.presentations.last, [
        PushPresentationCommunity(
          tenantId: '00000000-0000-4000-8000-000000000003',
          relayUrl: 'wss://relay.example.test',
          devicePubkey: keys.public,
          deviceSecret: keys.secret,
        ),
      ]);
      final native = bridge.presentations.last.single.toNative();
      expect(native['id'], '00000000-0000-4000-8000-000000000003');
      expect(native['policies'], isEmpty);
      expect(native.values.whereType<String>(), isNot(contains(keys.secret)));
    },
  );

  test('turning off, or no Relay connection, removes the extension key', () async {
    final bridge = _FakeBridge();
    final h = harness(
      apns: 'CONFIGURED',
      bridge: bridge,
      put: (_, _, _) => PlatformResponse(200, view(enabled: false, version: 2)),
    );
    await loaded(h.container);
    await h.container.read(pushRegistrationProvider.notifier).setEnabled(false);
    expect(bridge.presentations.last, isEmpty);

    final offline = _FakeBridge();
    final h2 = harness(
      apns: 'CONFIGURED',
      bridge: offline,
      relayUrl: null,
      put: (_, _, _) => PlatformResponse(200, view(enabled: true, version: 1)),
    );
    await loaded(h2.container);
    await h2.container
        .read(pushRegistrationProvider.notifier)
        .setEnabled(true);
    expect(offline.presentations, everyElement(isEmpty));
  });

  test('a stale version is re-read instead of overwritten', () async {
    final h = harness(
      apns: 'CONFIGURED',
      put: (_, _, _) => const PlatformResponse(409, {'class': 'PRECONDITION'}),
    );
    await loaded(h.container);
    await h.container.read(pushRegistrationProvider.notifier).setEnabled(true);
    final state = h.container.read(pushRegistrationProvider);
    expect(state.outcome, PushRegistrationOutcome.failed);
    expect(state.effectiveEnabled, isFalse);
    // capability + registration read twice: the initial load and the post-conflict re-read.
    expect(h.calls.where((c) => c.$2 == pushCapabilityPath), hasLength(2));
  });

  test('a lost response is reported as not confirmed and re-read', () async {
    final h = harness(
      apns: 'CONFIGURED',
      put: (_, _, _) => throw Exception('connection reset'),
    );
    await loaded(h.container);
    await h.container.read(pushRegistrationProvider.notifier).setEnabled(true);
    expect(
      h.container.read(pushRegistrationProvider).outcome,
      PushRegistrationOutcome.notConfirmed,
    );
  });

  test('notification taps carry ids only into the deep-link pipeline', () {
    expect(
      pushNotificationLink({
        'eventId': 'e1',
        'communityId': 't',
        'channelId': 'c1',
      }),
      const MessageDeepLink(channelId: 'c1', messageId: 'e1'),
    );
    expect(pushNotificationLink({'eventId': '', 'channelId': 'c1'}), isNull);
    expect(pushNotificationLink('nope'), isNull);
  });
}
