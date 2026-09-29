import 'dart:async';
import 'dart:convert';

import 'package:buzz/shared/auth/auth.dart';
import 'package:buzz/shared/platform/platform_api.dart';
import 'package:buzz/shared/platform/platform_config.dart';
import 'package:buzz/shared/platform/platform_device.dart';
import 'package:buzz/shared/platform/platform_link.dart';
import 'package:buzz/shared/platform/platform_oidc.dart';
import 'package:buzz/shared/theme/theme_provider.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nostr/nostr.dart' as nostr;
import 'package:shared_preferences/shared_preferences.dart';

import '../community/community_storage_test.dart';
import 'platform_test_support.dart';

/// 模拟 BFF：记录收到的请求，按脚本回答设备登记。
class _Bff {
  _Bff({required this.register});

  /// 第 n 次登记的回答（pubkey → 回应）
  final http.Response Function(int attempt, String pubkey) register;
  final requests = <http.Request>[];
  final registeredPubkeys = <String>[];
  String relayUrl = 'wss://t1.kailo.test:8443';
  List<Map<String, Object?>> Function(String pubkey)? listDevices;

  Future<http.Response> call(http.Request request) async {
    final oidc = oidcRoutes(request, refreshed: 'access-2');
    if (oidc != null) return oidc;
    requests.add(request);
    final path = request.url.path;
    if (path == '/api/v1/session') return jsonResponse(sessionView());
    if (path == '/api/v1/identity/client-keys' && request.method == 'POST') {
      final proof = (jsonDecode(request.body) as Map)['proof'] as Map;
      final pubkey = proof['pubkey'] as String;
      registeredPubkeys.add(pubkey);
      return register(registeredPubkeys.length, pubkey);
    }
    if (path == '/api/v1/identity/client-keys') {
      return jsonResponse(listDevices!(registeredPubkeys.last));
    }
    if (path == '/api/v1/native/community') {
      return jsonResponse({
        'relayUrl': relayUrl,
        'communityHost': 't1.kailo.test:8443',
      });
    }
    if (path == '/api/v1/logout') return jsonResponse(null, 204);
    return jsonResponse(null, 404);
  }
}

Future<ProviderContainer> _container(
  _Bff bff, {
  MemoryDeviceKeyStore? keys,
}) async {
  SharedPreferences.setMockInitialValues({
    'kailo.config.v1': jsonEncode(testKailoConfig.toJson()),
  });
  final prefs = await SharedPreferences.getInstance();
  final client = MockClient(bff.call);
  final container = ProviderContainer(
    overrides: [
      savedPrefsProvider.overrideWithValue(prefs),
      kailoHttpClientProvider.overrideWithValue(client),
      kailoSessionProvider.overrideWithValue(
        KailoSession(client: client, refreshStore: MemoryRefreshStore()),
      ),
      deviceKeyStoreProvider.overrideWithValue(keys ?? MemoryDeviceKeyStore()),
      communityStorageProvider.overrideWithValue(
        CommunityStorage(secure: FakeSecureStorage()),
      ),
      kailoBrowserProvider.overrideWithValue(
        KailoBrowser(
          open: (uri) async {
            final state = uri.queryParameters['state'];
            _callbacks.add(Uri.parse('$kailoRedirectUri?code=c&state=$state'));
          },
          callbacks: () => _callbacks.stream,
        ),
      ),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

final _callbacks = StreamController<Uri>.broadcast();

http.Response _status(String pubkey, String state, [int code = 202]) =>
    jsonResponse({
      'pubkey': pubkey,
      'state': state,
      if (state == 'RECONCILING') 'recheckAfterMillis': 1,
    }, code);

void main() {
  test('sign-in registers this device with a session-bound proof, then '
      'connects the community to the device key', () async {
    final bff = _Bff(register: (_, pk) => _status(pk, 'ACTIVE', 200));
    final keys = MemoryDeviceKeyStore();
    final container = await _container(bff, keys: keys);

    await container.read(kailoLinkProvider.notifier).signIn();

    expect(container.read(kailoLinkProvider).phase, KailoLinkPhase.linked);
    final post = bff.requests.firstWhere((r) => r.method == 'POST');
    final proof = nostr.Event.fromMap(
      (jsonDecode(post.body) as Map)['proof'] as Map<String, dynamic>,
    );
    expect(proof.kind, 27235);
    expect(proof.isValid(), isTrue);
    expect(proof.tags, [
      ['u', 'https://kailo.test:8443/api/v1/identity/client-keys'],
      ['method', 'POST'],
      ['session', sessionView()['platformSessionId']],
    ]);
    final device = nostr.Keys(keys.nsec!);
    expect(proof.pubkey, device.public);
    expect(post.headers['Authorization'], 'Bearer access-2');

    final auth = await container.read(authProvider.future);
    expect(auth.status, AuthStatus.authenticated);
    expect(auth.community?.relayUrl, bff.relayUrl);
    expect(auth.community?.nsec, device.nsec);
  });

  test(
    'waits for RECONCILING to become ACTIVE before connecting',
    () async {
      var polls = 0;
      final bff = _Bff(register: (_, pk) => _status(pk, 'RECONCILING'))
        ..listDevices = (pk) {
          polls++;
          return [
            {
              'pubkey': pk,
              'state': polls < 2 ? 'RECONCILING' : 'ACTIVE',
              'createdAt': '2026-09-24T00:00:00Z',
            },
          ];
        };
      final container = await _container(bff);

      await container.read(kailoLinkProvider.notifier).signIn();

      expect(polls, 2);
      expect(container.read(kailoLinkProvider).phase, KailoLinkPhase.linked);
    },
    timeout: const Timeout(Duration(seconds: 20)),
  );

  test('does not guess a polling interval when the server omits it', () async {
    final bff = _Bff(
      register: (attempt, pk) => jsonResponse({
        'pubkey': pk,
        'state': attempt == 1 ? 'RECONCILING' : 'ACTIVE',
      }, attempt == 1 ? 202 : 200),
    );
    final container = await _container(bff);

    await container.read(kailoLinkProvider.notifier).signIn();

    expect(
      container.read(kailoLinkProvider).phase,
      KailoLinkPhase.awaitingActivation,
    );
    expect(container.read(kailoLinkProvider).manualRecheck, isTrue);
    expect(
      bff.requests.where(
        (r) => r.method == 'GET' && r.url.path.endsWith('client-keys'),
      ),
      isEmpty,
    );
    final link = container.read(kailoLinkProvider.notifier);
    await Future.wait([link.reconcile(), link.reconcile()]);
    expect(container.read(kailoLinkProvider).phase, KailoLinkPhase.linked);
    expect(bff.registeredPubkeys, hasLength(2));
  });

  test('a revoked device key is replaced, never revived', () async {
    final bff = _Bff(
      register: (attempt, pk) => attempt == 1
          ? jsonResponse(errorBody('CONFLICT', 'CLIENT_KEY_ALREADY_BOUND'), 409)
          : _status(pk, 'ACTIVE', 200),
    );
    final keys = MemoryDeviceKeyStore()..nsec = nostr.Keys.generate().nsec;
    final revoked = nostr.Keys(keys.nsec!).public;
    final container = await _container(bff, keys: keys);

    await container.read(kailoLinkProvider.notifier).signIn();

    expect(bff.registeredPubkeys.first, revoked);
    expect(bff.registeredPubkeys.last, isNot(revoked));
    expect(nostr.Keys(keys.nsec!).public, bff.registeredPubkeys.last);
    expect(container.read(kailoLinkProvider).phase, KailoLinkPhase.linked);
  });

  test('a contract refusal is a failure with its reason code', () async {
    final bff = _Bff(
      register: (_, _) =>
          jsonResponse(errorBody('LIMIT', 'CLIENT_KEY_LIMIT_REACHED'), 429),
    );
    final container = await _container(bff);

    await container.read(kailoLinkProvider.notifier).signIn();

    final state = container.read(kailoLinkProvider);
    expect(state.phase, KailoLinkPhase.failed);
    expect(state.error?.reason.name, 'CLIENT_KEY_LIMIT_REACHED');
    expect(
      (await container.read(authProvider.future)).status,
      AuthStatus.unauthenticated,
    );
  });

  test(
    'an answer outside the contract is neither success nor failure',
    () async {
      for (final answer in [
        jsonResponse(null, 502),
        jsonResponse(errorBody('DENIED', 'SOMETHING_NEW'), 403),
      ]) {
        final bff = _Bff(register: (_, _) => answer);
        final container = await _container(bff);

        await container.read(kailoLinkProvider.notifier).signIn();

        final state = container.read(kailoLinkProvider);
        expect(state.phase, KailoLinkPhase.outcomeUnknown);
        expect(state.error, isNull);
      }
    },
  );

  test(
    'sign-out drops tokens and the community but keeps the device key',
    () async {
      final bff = _Bff(register: (_, pk) => _status(pk, 'ACTIVE', 200));
      final keys = MemoryDeviceKeyStore();
      final container = await _container(bff, keys: keys);
      await container.read(kailoLinkProvider.notifier).signIn();

      await container.read(kailoLinkProvider.notifier).signOut();

      expect(bff.requests.last.url.path, '/api/v1/logout');
      expect(
        await container.read(kailoSessionProvider).hasCredentials(),
        isFalse,
      );
      expect(
        (await container.read(authProvider.future)).status,
        AuthStatus.unauthenticated,
      );
      expect(keys.nsec, isNotNull);
    },
  );

  test('unconfigured devices are not offered sign-in', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final container = ProviderContainer(
      overrides: [savedPrefsProvider.overrideWithValue(prefs)],
    );
    addTearDown(container.dispose);
    expect(container.read(kailoConfigProvider), isNull);
    expect(
      container.read(kailoLinkProvider).phase,
      KailoLinkPhase.unconfigured,
    );
  });
}
