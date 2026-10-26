import 'dart:async';

import 'package:buzz/shared/deeplink/deep_link.dart';
import 'package:client_kit/shared/contracts/contracts.dart';
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
  PushPlatform? platform = PushPlatform.APNS;
  final permissionRequests = <bool>[];
  @override
  Future<PushPlatform?> deliveryPlatform() async => platform;
  @override
  Stream<void> get authorizationChanges => const Stream.empty();

  @override
  Future<PushAuthorizationStatus?> authorizationStatus() async =>
      PushAuthorizationStatus.authorized;

  @override
  Future<bool> openNotificationSettings() async => true;

  @override
  Future<void> startRegistration({bool requestPermission = true}) async {
    registrations++;
    permissionRequests.add(requestPermission);
    scheduleMicrotask(() => _tokens.add(token));
  }

  @override
  Stream<String> get tokens => _tokens.stream;

  @override
  Stream<MessageDeepLink> get opened => _opened.stream;

  @override
  Future<MessageDeepLink?> takePendingOpen() async => null;
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
    String fcm = 'NOT_CONFIGURED',
    bool Function()? isCurrent,
    required FutureOr<PlatformResponse> Function(PlatformMethod, String, Object?) put,
    _FakeBridge? bridge,
  }) {
    final calls = <(PlatformMethod, String, Object?)>[];
    final deps = PushRegistrationDeps(
      isCurrent: isCurrent ?? () => true,
      send: (method, path, {body}) async {
        calls.add((method, path, body));
        if (path == pushCapabilityPath) {
          return PlatformResponse(200, {'apns': apns, 'fcm': fcm});
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

  test('Android uses only the configured native FCM SDK and matching Core capability', () async {
    final bridge = _FakeBridge()..platform = PushPlatform.FCM;
    Object? sent;
    final h = harness(apns: 'NOT_CONFIGURED', fcm: 'CONFIGURED', bridge: bridge,
      put: (_, _, body) { sent = body; return PlatformResponse(200, {...view(enabled: true, version: 1), 'platform': 'FCM'}); });
    expect((await loaded(h.container)).available, isTrue);
    await h.container.read(pushRegistrationProvider.notifier).setEnabled(true);
    expect((sent! as Map)['platform'], 'FCM');
    expect(h.container.read(pushRegistrationProvider).effectiveEnabled, isTrue);
  });

  test('missing native Firebase configuration stays unavailable even when Core FCM is configured', () async {
    final bridge = _FakeBridge()..platform = null;
    final h = harness(apns: 'CONFIGURED', fcm: 'CONFIGURED', bridge: bridge, put: (_, _, _) => fail('no PUT'));
    expect((await loaded(h.container)).available, isFalse);
    await h.container.read(pushRegistrationProvider.notifier).setEnabled(true);
    expect(bridge.registrations, 0);
    expect(h.calls, isEmpty);
  });

  test('an Android artifact cannot borrow configured APNs capability', () async {
    final h = harness(apns: 'CONFIGURED', bridge: _FakeBridge()..platform = PushPlatform.FCM, put: (_, _, _) => fail('no PUT'));
    expect((await loaded(h.container)).available, isFalse);
  });

  test('a replaced NativeSession cannot submit a token captured by the old login', () async {
    var current = true;
    final h = harness(apns: 'CONFIGURED', isCurrent: () => current, put: (_, _, _) => fail('old login PUT'));
    await loaded(h.container);
    current = false;
    await h.container.read(pushRegistrationProvider.notifier).setEnabled(true);
    expect(h.calls.where((c) => c.$1 == PlatformMethod.put), isEmpty);
  });

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

  test('FCM rotation during the first PUT is registered afterwards with the returned CAS version', () async {
    final bridge = _FakeBridge()..platform = PushPlatform.FCM;
    final entered = Completer<void>();
    final firstResponse = Completer<PlatformResponse>();
    var writes = 0;
    final h = harness(apns: 'NOT_CONFIGURED', fcm: 'CONFIGURED', bridge: bridge,
      put: (_, _, body) {
        writes++;
        if (writes == 1) { entered.complete(); return firstResponse.future; }
        return PlatformResponse(200, {...view(enabled: true, version: 2), 'platform': 'FCM'});
      });
    await loaded(h.container);
    final controller = h.container.read(pushRegistrationProvider.notifier);
    final enabling = controller.setEnabled(true);
    await entered.future;
    await controller.tokenChanged('rotated-fcm-token');
    expect(writes, 1);
    firstResponse.complete(PlatformResponse(200, {...view(enabled: true, version: 1), 'platform': 'FCM'}));
    await enabling;
    for (var i = 0; i < 20 && h.container.read(pushRegistrationProvider).version != 2; i++) {
      await Future<void>.delayed(Duration.zero);
    }
    final puts = h.calls.where((c) => c.$1 == PlatformMethod.put).toList();
    expect(puts, hasLength(2));
    expect((puts[1].$3! as Map)['token'], 'rotated-fcm-token');
    expect((puts[1].$3! as Map)['expectedVersion'], 1);
    expect((puts[1].$3! as Map)['platform'], 'FCM');
  });

  test('switching off does not prompt for OS display permission', () async {
    final bridge = _FakeBridge();
    final h = harness(apns: 'CONFIGURED', bridge: bridge,
      put: (_, _, _) => PlatformResponse(200, view(enabled: false, version: 1)));
    await loaded(h.container);
    await h.container.read(pushRegistrationProvider.notifier).setEnabled(false);
    expect(bridge.permissionRequests, [false]);
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

  for (final pendingAt in ['read', 'write']) {
    test(
      'identity change retires a late registration $pendingAt result',
      () async {
        final late = Completer<PlatformResponse>();
        final entered = Completer<void>();
        final bridge = _FakeBridge();
        final otherKeys = nostr.Keys.generate();
        PushRegistrationDeps deps(nostr.Keys identity, {required bool old}) =>
            PushRegistrationDeps(
              isCurrent: () => true,
              send: (method, path, {body}) async {
                if (path == pushCapabilityPath) {
                  return const PlatformResponse(200, {
                    'apns': 'CONFIGURED',
                    'fcm': 'NOT_CONFIGURED',
                  });
                }
                if (path == '/api/v1/session') {
                  return const PlatformResponse(200, _session);
                }
                final writing = method == PlatformMethod.put;
                if (old &&
                    ((pendingAt == 'write' && writing) ||
                        (pendingAt == 'read' && !writing))) {
                  if (!entered.isCompleted) {
                    entered.complete();
                  }
                  return late.future;
                }
                return const PlatformResponse(404, {});
              },
              deviceKeys: () async => identity,
              appId: () async => 'chat.kailo.mobile',
              apiUri: (path) => Uri.parse('https://native.example.test$path'),
              locale: () => 'en',
            );
        final original = deps(keys, old: true);
        final replacement = deps(otherKeys, old: false);
        final container = ProviderContainer(
          overrides: [
            pushRegistrationDepsProvider.overrideWithValue(original),
            pushBridgeProvider.overrideWithValue(bridge),
          ],
        );
        addTearDown(container.dispose);
        container.read(pushRegistrationProvider);
        Future<void>? pending;
        if (pendingAt == 'write') {
          await loaded(container);
          pending = container
              .read(pushRegistrationProvider.notifier)
              .setEnabled(true);
        }
        await entered.future;
        container.updateOverrides([
          pushRegistrationDepsProvider.overrideWithValue(replacement),
          pushBridgeProvider.overrideWithValue(bridge),
        ]);
        await loaded(container);
        late.complete(PlatformResponse(200, view(enabled: true, version: 99)));
        await pending;
        await Future<void>.delayed(Duration.zero);
        final current = container.read(pushRegistrationProvider);
        expect(current.devicePubkey, otherKeys.public);
        expect(current.version, 0);
        expect(current.effectiveEnabled, isFalse);
      },
    );
  }

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
