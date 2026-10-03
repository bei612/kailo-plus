import 'dart:async';
import 'dart:convert';

import 'package:buzz/shared/auth/auth.dart';
import 'package:buzz/shared/platform/platform_api.dart';
import 'package:buzz/shared/platform/platform_config.dart';
import 'package:buzz/shared/platform/platform_device.dart';
import 'package:buzz/shared/platform/platform_display_name.dart';
import 'package:buzz/shared/platform/platform_link.dart';
import 'package:buzz/shared/platform/platform_oidc.dart';
import 'package:buzz/shared/theme/theme_provider.dart';
import 'package:buzz/features/platform/platform_status_text.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nostr/nostr.dart' as nostr;
import 'package:shared_preferences/shared_preferences.dart';

import '../community/community_storage_test.dart';
import 'platform_test_support.dart';

class _UnreadableRefreshStore extends MemoryRefreshStore {
  @override
  Future<String?> load() async =>
      throw const PlatformUnavailable('Secure storage unavailable');
}

/// 模拟 BFF：记录收到的请求，按脚本回答设备登记。
class _Bff {
  _Bff({required this.register});

  /// 第 n 次登记的回答（pubkey → 回应）
  final http.Response Function(int attempt, String pubkey) register;
  final requests = <http.Request>[];
  final registeredPubkeys = <String>[];
  String relayUrl = 'wss://t1.platform.test:8443';
  String? displayName;
  List<Map<String, Object?>> Function(String pubkey)? listDevices;

  /// IdP 是否公布 RFC 7009 撤销端点，以及它的回答
  bool advertisesRevocation = true;
  int revokeStatus = 200;
  final revocations = <Map<String, String>>[];
  int logoutStatus = 200;
  int sessionStatus = 200;
  Future<http.Response?> Function(http.Request)? intercept;

  Future<http.Response> call(http.Request request) async {
    final intercepted = await intercept?.call(request);
    if (intercepted != null) return intercepted;
    if (request.url.path.endsWith('/.well-known/openid-configuration')) {
      return jsonResponse({
        'authorization_endpoint': 'https://idp.test/realms/platform/auth',
        'token_endpoint': 'https://idp.test/realms/platform/token',
        if (advertisesRevocation)
          'revocation_endpoint': 'https://idp.test/realms/platform/revoke',
      });
    }
    if (request.url.path.endsWith('/revoke')) {
      revocations.add(request.bodyFields);
      return jsonResponse(null, revokeStatus);
    }
    final oidc = oidcRoutes(request, refreshed: 'access-2');
    if (oidc != null) return oidc;
    requests.add(request);
    final path = request.url.path;
    if (path == '/api/v1/session') {
      return jsonResponse(sessionView(), sessionStatus);
    }
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
        'communityHost': 't1.platform.test:8443',
      });
    }
    if (path == '/api/v1/platform-info' && displayName != null) {
      return jsonResponse({'displayName': displayName});
    }
    if (path == '/api/v1/logout') {
      return jsonResponse(
        logoutStatus == 200 ? {'revoked': true} : null,
        logoutStatus,
      );
    }
    return jsonResponse(null, 404);
  }
}

Future<ProviderContainer> _container(
  _Bff bff, {
  MemoryDeviceKeyStore? keys,
}) async {
  SharedPreferences.setMockInitialValues({
    'platform.config.v1': jsonEncode(testPlatformConfig.toJson()),
  });
  final prefs = await SharedPreferences.getInstance();
  final client = MockClient(bff.call);
  final container = ProviderContainer(
    overrides: [
      savedPrefsProvider.overrideWithValue(prefs),
      platformHttpClientProvider.overrideWithValue(client),
      nativeSessionProvider.overrideWithValue(
        NativeSession(client: client, refreshStore: MemoryRefreshStore()),
      ),
      deviceKeyStoreProvider.overrideWithValue(keys ?? MemoryDeviceKeyStore()),
      communityStorageProvider.overrideWithValue(
        CommunityStorage(secure: FakeSecureStorage()),
      ),
      platformBrowserProvider.overrideWithValue(
        PlatformBrowser(
          open: (uri) async {
            final state = uri.queryParameters['state'];
            _callbacks.add(
              Uri.parse('$platformRedirectUri?code=c&state=$state'),
            );
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

    await container.read(platformLinkProvider.notifier).signIn();

    expect(
      container.read(platformLinkProvider).phase,
      PlatformLinkPhase.linked,
    );
    final post = bff.requests.firstWhere((r) => r.method == 'POST');
    final proof = nostr.Event.fromMap(
      (jsonDecode(post.body) as Map)['proof'] as Map<String, dynamic>,
    );
    expect(proof.kind, 27235);
    expect(proof.isValid(), isTrue);
    expect(proof.tags, [
      ['u', 'https://platform.test:8443/api/v1/identity/client-keys'],
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

      await container.read(platformLinkProvider.notifier).signIn();

      expect(polls, 2);
      expect(
        container.read(platformLinkProvider).phase,
        PlatformLinkPhase.linked,
      );
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

    await container.read(platformLinkProvider.notifier).signIn();

    expect(
      container.read(platformLinkProvider).phase,
      PlatformLinkPhase.awaitingActivation,
    );
    expect(container.read(platformLinkProvider).manualRecheck, isTrue);
    expect(
      bff.requests.where(
        (r) => r.method == 'GET' && r.url.path.endsWith('client-keys'),
      ),
      isEmpty,
    );
    final link = container.read(platformLinkProvider.notifier);
    await Future.wait([link.reconcile(), link.reconcile()]);
    expect(
      container.read(platformLinkProvider).phase,
      PlatformLinkPhase.linked,
    );
    expect(bff.registeredPubkeys, hasLength(2));
  });

  test('the display name comes from the BFF after sign-in, cached per server '
      '(DD-111)', () async {
    final bff = _Bff(register: (_, pk) => _status(pk, 'ACTIVE', 200))
      ..displayName = '  协作平台  ';
    final container = await _container(bff);
    // 登录之前没有可读的部署：只有中性文案
    expect(container.read(platformDisplayNameProvider), isNull);

    await container.read(platformLinkProvider.notifier).signIn();
    await pumpEventQueue();

    expect(container.read(platformDisplayNameProvider), '协作平台');
    final prefs = container.read(savedPrefsProvider);
    expect(
      prefs.getString(
        'platform.display-name:${testPlatformConfig.nativeApiUrl}',
      ),
      '协作平台',
    );
    // 注销后（含重新启动，即从缓存重建）同一服务器仍显示缓存值；换一台服务器不串名
    await container.read(platformLinkProvider.notifier).signOut();
    container.invalidate(platformDisplayNameProvider);
    expect(container.read(platformDisplayNameProvider), '协作平台');
    await container
        .read(platformConfigProvider.notifier)
        .save(
          PlatformConfig(
            nativeApiUrl: 'https://other.platform.test:8443',
            oidcIssuer: testPlatformConfig.oidcIssuer,
            oidcClientId: testPlatformConfig.oidcClientId,
          ),
        );
    expect(container.read(platformDisplayNameProvider), isNull);
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

    await container.read(platformLinkProvider.notifier).signIn();

    expect(bff.registeredPubkeys.first, revoked);
    expect(bff.registeredPubkeys.last, isNot(revoked));
    expect(nostr.Keys(keys.nsec!).public, bff.registeredPubkeys.last);
    expect(
      container.read(platformLinkProvider).phase,
      PlatformLinkPhase.linked,
    );
  });

  test('a contract refusal is a failure with its reason code', () async {
    final bff = _Bff(
      register: (_, _) =>
          jsonResponse(errorBody('LIMIT', 'CLIENT_KEY_LIMIT_REACHED'), 429),
    );
    final container = await _container(bff);

    await container.read(platformLinkProvider.notifier).signIn();

    final state = container.read(platformLinkProvider);
    expect(state.phase, PlatformLinkPhase.failed);
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

        await container.read(platformLinkProvider.notifier).signIn();

        final state = container.read(platformLinkProvider);
        expect(state.phase, PlatformLinkPhase.outcomeUnknown);
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
      await container.read(platformLinkProvider.notifier).signIn();

      await container.read(platformLinkProvider.notifier).signOut();

      expect(bff.requests.last.url.path, '/api/v1/logout');
      // 设备的刷新令牌在 IdP 作废（RFC 7009），而不只是从本机删掉
      expect(bff.revocations, [
        {
          'token': 'refresh-2',
          'token_type_hint': 'refresh_token',
          'client_id': testPlatformConfig.oidcClientId,
        },
      ]);
      expect(
        await container.read(nativeSessionProvider).hasCredentials(),
        isFalse,
      );
      expect(
        (await container.read(authProvider.future)).status,
        AuthStatus.unauthenticated,
      );
      final state = container.read(platformLinkProvider);
      expect(state.phase, PlatformLinkPhase.signedOut);
      expect(state.signOutUnconfirmed, isFalse);
      expect(keys.nsec, isNotNull);
    },
  );

  group('a server-side sign-out that is not confirmed is not called done', () {
    final cases = <String, void Function(_Bff)>{
      'Core did not answer the logout': (bff) => bff.logoutStatus = 503,
      'Core returned an unconfirmed acceptance': (bff) =>
          bff.logoutStatus = 202,
      'the IdP publishes no revocation endpoint': (bff) =>
          bff.advertisesRevocation = false,
      'the IdP refused the revocation': (bff) => bff.revokeStatus = 503,
    };
    for (final MapEntry(key: name, value: arrange) in cases.entries) {
      test(name, () async {
        final bff = _Bff(register: (_, pk) => _status(pk, 'ACTIVE', 200));
        final container = await _container(bff);
        await container.read(platformLinkProvider.notifier).signIn();
        arrange(bff);

        await container.read(platformLinkProvider.notifier).signOut();

        // 本机总是退出：凭据与协作连接都不在了
        expect(
          await container.read(nativeSessionProvider).hasCredentials(),
          isFalse,
        );
        expect(
          (await container.read(authProvider.future)).status,
          AuthStatus.unauthenticated,
        );
        final state = container.read(platformLinkProvider);
        expect(state.phase, PlatformLinkPhase.signedOut);
        expect(state.signOutUnconfirmed, isTrue);
        expect(
          platformOutcomeText(state, locale: 'en'),
          platformText(
            PlatformMessageKey.nativeSignOutServerUnconfirmed,
            locale: 'en',
          ),
        );
      });
    }
  });

  test(
    'late authorization exchange cannot restore a signed-out session',
    () async {
      final started = Completer<void>();
      final answer = Completer<http.Response>();
      final bff = _Bff(register: (_, pk) => _status(pk, 'ACTIVE', 200))
        ..intercept = (request) async {
          if (request.url.path.endsWith('/token')) {
            started.complete();
            return answer.future;
          }
          return null;
        };
      final container = await _container(bff);
      final link = container.read(platformLinkProvider.notifier);
      final signingIn = link.signIn();
      await started.future;
      await link.signOut();
      answer.complete(
        jsonResponse({'access_token': 'late', 'refresh_token': 'late-refresh'}),
      );
      await signingIn;
      await pumpEventQueue();
      expect(
        await container.read(nativeSessionProvider).hasCredentials(),
        isFalse,
      );
      expect(
        container.read(platformLinkProvider).phase,
        PlatformLinkPhase.signedOut,
      );
      expect(bff.registeredPubkeys, isEmpty);
      expect(
        (await container.read(authProvider.future)).status,
        AuthStatus.unauthenticated,
      );
    },
  );

  test('late registration cannot connect a signed-out community', () async {
    final started = Completer<void>();
    final answer = Completer<http.Response>();
    String? pubkey;
    final bff = _Bff(register: (_, pk) => _status(pk, 'ACTIVE', 200))
      ..intercept = (request) async {
        if (request.url.path == platformRegisterPath &&
            request.method == 'POST') {
          pubkey =
              ((jsonDecode(request.body) as Map)['proof'] as Map)['pubkey']
                  as String;
          started.complete();
          return answer.future;
        }
        return null;
      };
    final container = await _container(bff);
    final link = container.read(platformLinkProvider.notifier);
    final signingIn = link.signIn();
    await started.future;
    await link.signOut();
    answer.complete(_status(pubkey!, 'ACTIVE', 200));
    await signingIn;
    expect(
      container.read(platformLinkProvider).phase,
      PlatformLinkPhase.signedOut,
    );
    expect(
      (await container.read(authProvider.future)).status,
      AuthStatus.unauthenticated,
    );
    expect(
      bff.requests.where((r) => r.url.path == '/api/v1/native/community'),
      isEmpty,
    );
  });

  test('canceling registration ignores its later ACTIVE answer', () async {
    final started = Completer<void>();
    final answer = Completer<http.Response>();
    String? pubkey;
    final bff = _Bff(register: (_, pk) => _status(pk, 'ACTIVE', 200))
      ..intercept = (request) async {
        if (request.url.path == platformRegisterPath &&
            request.method == 'POST') {
          pubkey =
              ((jsonDecode(request.body) as Map)['proof'] as Map)['pubkey']
                  as String;
          started.complete();
          return answer.future;
        }
        return null;
      };
    final container = await _container(bff);
    final link = container.read(platformLinkProvider.notifier);
    final signingIn = link.signIn();
    await started.future;
    link.cancel();
    answer.complete(_status(pubkey!, 'ACTIVE', 200));
    await signingIn;
    expect(
      container.read(platformLinkProvider).phase,
      PlatformLinkPhase.signedOut,
    );
    expect(
      (await container.read(authProvider.future)).status,
      AuthStatus.unauthenticated,
    );
    expect(
      bff.requests.where((r) => r.url.path == '/api/v1/native/community'),
      isEmpty,
    );
  });

  test('invalidated identity drops the already connected community', () async {
    final bff = _Bff(register: (_, pk) => _status(pk, 'ACTIVE', 200));
    final container = await _container(bff);
    final link = container.read(platformLinkProvider.notifier);
    await link.signIn();
    bff.sessionStatus = 401;
    await link.reconcile();
    expect(
      container.read(platformLinkProvider).phase,
      PlatformLinkPhase.signedOut,
    );
    expect(
      await container.read(nativeSessionProvider).hasCredentials(),
      isFalse,
    );
    expect(
      (await container.read(authProvider.future)).status,
      AuthStatus.unauthenticated,
    );
  });

  test('registration must confirm this device, not another pubkey', () async {
    final bff = _Bff(
      register: (_, _) => _status(nostr.Keys.generate().public, 'ACTIVE', 200),
    );
    final container = await _container(bff);
    await container.read(platformLinkProvider.notifier).signIn();
    expect(
      container.read(platformLinkProvider).phase,
      PlatformLinkPhase.outcomeUnknown,
    );
    expect(
      (await container.read(authProvider.future)).status,
      AuthStatus.unauthenticated,
    );
  });

  test(
    'a known UNKNOWN contract is not presented as failure or native text',
    () async {
      final bff = _Bff(
        register: (_, _) =>
            jsonResponse(errorBody('UNKNOWN', 'DEPENDENCY_UNAVAILABLE'), 503),
      );
      final container = await _container(bff);
      await container.read(platformLinkProvider.notifier).signIn();
      final state = container.read(platformLinkProvider);
      expect(state.phase, PlatformLinkPhase.outcomeUnknown);
      expect(
        platformOutcomeText(state, locale: 'en'),
        platformPhaseText(PlatformLinkPhase.outcomeUnknown, locale: 'en'),
      );
      expect(
        platformOutcomeText(
          const PlatformLinkState(
            PlatformLinkPhase.failed,
            detail: 'native secret diagnostic',
          ),
          locale: 'en',
        ),
        isNot(contains('native secret diagnostic')),
      );
    },
  );

  test(
    'late refresh cannot rewrite credentials after local sign-out',
    () async {
      final started = Completer<void>();
      final answer = Completer<http.Response>();
      final store = MemoryRefreshStore();
      final client = MockClient((request) async {
        if (request.url.path.endsWith('/token')) {
          started.complete();
          return answer.future;
        }
        return oidcRoutes(request, refreshed: 'unused') ??
            jsonResponse(null, 401);
      });
      final session = NativeSession(client: client, refreshStore: store);
      await session.adopt(
        const OidcTokens(accessToken: 'expired', refreshToken: 'refresh'),
      );
      final pending = session.send(
        testPlatformConfig,
        PlatformMethod.get,
        '/api/v1/session',
      );
      final refused = expectLater(pending, throwsA(isA<PlatformUnavailable>()));
      await started.future;
      await session.discardCredentials();
      answer.complete(
        jsonResponse({'access_token': 'late', 'refresh_token': 'late-refresh'}),
      );
      await refused;
      expect(store.value, isNull);
      expect(await session.hasCredentials(), isFalse);
    },
  );

  test('an older 401 cannot clear a newer login', () async {
    final started = Completer<void>();
    final answer = Completer<http.Response>();
    final store = MemoryRefreshStore();
    final client = MockClient((request) async {
      if (request.headers['Authorization'] == 'Bearer old') {
        started.complete();
        return answer.future;
      }
      return jsonResponse(sessionView());
    });
    final session = NativeSession(client: client, refreshStore: store);
    await session.adopt(
      const OidcTokens(accessToken: 'old', refreshToken: 'old-refresh'),
    );
    final pending = session.send(
      testPlatformConfig,
      PlatformMethod.get,
      '/api/v1/session',
    );
    final refused = expectLater(pending, throwsA(isA<PlatformUnavailable>()));
    await started.future;
    await session.adopt(
      const OidcTokens(accessToken: 'new', refreshToken: 'new-refresh'),
    );
    answer.complete(jsonResponse(null, 401));
    await refused;
    expect(store.value, 'new-refresh');
    expect(
      (await session.send(
        testPlatformConfig,
        PlatformMethod.get,
        '/api/v1/session',
      )).status,
      200,
    );
  });

  test('an older logout never clears or revokes a newer login', () async {
    final started = Completer<void>();
    final answer = Completer<http.Response>();
    final revocations = <String>[];
    final store = MemoryRefreshStore();
    final client = MockClient((request) async {
      if (request.url.path == '/api/v1/logout') {
        expect(request.headers['Authorization'], 'Bearer old');
        started.complete();
        return answer.future;
      }
      if (request.url.path.endsWith('/.well-known/openid-configuration')) {
        return jsonResponse({
          'authorization_endpoint': 'https://idp.test/realms/platform/auth',
          'token_endpoint': 'https://idp.test/realms/platform/token',
          'revocation_endpoint': 'https://idp.test/realms/platform/revoke',
        });
      }
      if (request.url.path.endsWith('/revoke')) {
        revocations.add(request.bodyFields['token']!);
        return jsonResponse(null);
      }
      return jsonResponse(sessionView());
    });
    final session = NativeSession(client: client, refreshStore: store);
    await session.adopt(
      const OidcTokens(accessToken: 'old', refreshToken: 'old-refresh'),
    );
    final ending = session.endSession(testPlatformConfig);
    await started.future;
    expect(await session.hasCredentials(), isFalse);
    await session.adopt(
      const OidcTokens(accessToken: 'new', refreshToken: 'new-refresh'),
    );
    answer.complete(jsonResponse({'revoked': false}));
    expect((await ending).confirmed, isTrue);
    expect(revocations, ['old-refresh']);
    expect(store.value, 'new-refresh');
    expect(
      (await session.send(
        testPlatformConfig,
        PlatformMethod.get,
        '/api/v1/session',
      )).status,
      200,
    );
  });

  test(
    'a refresh without rotation keeps the old refresh token through logout',
    () async {
      var logouts = 0;
      final bff = _Bff(register: (_, pk) => _status(pk, 'ACTIVE', 200))
        ..intercept = (request) async {
          if (request.url.path.endsWith('/token')) {
            return jsonResponse({'access_token': 'refreshed'});
          }
          if (request.url.path == '/api/v1/logout') {
            return ++logouts == 1
                ? jsonResponse(null, 401)
                : jsonResponse({'revoked': true});
          }
          if (request.headers['Authorization'] == 'Bearer expired') {
            return jsonResponse(null, 401);
          }
          return null;
        };
      final store = MemoryRefreshStore();
      final session = NativeSession(
        client: MockClient(bff.call),
        refreshStore: store,
      );
      await session.adopt(
        const OidcTokens(accessToken: 'expired', refreshToken: 'old-refresh'),
      );
      expect(
        (await session.send(
          testPlatformConfig,
          PlatformMethod.get,
          '/api/v1/session',
        )).status,
        200,
      );
      expect(store.value, 'old-refresh');
      expect((await session.endSession(testPlatformConfig)).confirmed, isTrue);
      expect(bff.revocations.single['token'], 'old-refresh');
      expect(store.value, isNull);
    },
  );

  test(
    'logout cannot confirm revocation of an in-flight refresh rotation',
    () async {
      final started = Completer<void>();
      final answer = Completer<http.Response>();
      final bff = _Bff(register: (_, pk) => _status(pk, 'ACTIVE', 200))
        ..sessionStatus = 401
        ..intercept = (request) async {
          if (request.url.path.endsWith('/token')) {
            started.complete();
            return answer.future;
          }
          return null;
        };
      final store = MemoryRefreshStore();
      final session = NativeSession(
        client: MockClient(bff.call),
        refreshStore: store,
      );
      await session.adopt(
        const OidcTokens(accessToken: 'expired', refreshToken: 'old-refresh'),
      );
      final pending = session.send(
        testPlatformConfig,
        PlatformMethod.get,
        '/api/v1/session',
      );
      final refused = expectLater(pending, throwsA(isA<PlatformUnavailable>()));
      await started.future;
      final report = await session.endSession(testPlatformConfig);
      expect(report.coreSessionRevoked, isTrue);
      expect(report.refreshTokenRevoked, isFalse);
      expect(report.confirmed, isFalse);
      expect(bff.revocations.single['token'], 'old-refresh');
      answer.complete(
        jsonResponse({
          'access_token': 'late',
          'refresh_token': 'rotated-refresh',
        }),
      );
      await refused;
      expect(store.value, isNull);
    },
  );

  test('only HTTP 400 invalid_grant invalidates refresh credentials', () async {
    final bff = _Bff(register: (_, pk) => _status(pk, 'ACTIVE', 200))
      ..sessionStatus = 401
      ..intercept = (request) async => request.url.path.endsWith('/token')
          ? jsonResponse({'error': 'invalid_grant'}, 400)
          : null;
    final store = MemoryRefreshStore();
    final session = NativeSession(
      client: MockClient(bff.call),
      refreshStore: store,
    );
    await session.adopt(
      const OidcTokens(accessToken: 'expired', refreshToken: 'old-refresh'),
    );
    await expectLater(
      session.send(testPlatformConfig, PlatformMethod.get, '/api/v1/session'),
      throwsA(isA<PlatformNotSignedIn>()),
    );
    expect(store.value, isNull);
  });

  for (final (status, error) in [
    (429, 'rate-limited native diagnostic'),
    (400, 'invalid_client'),
    (401, 'invalid_grant'),
    (400, null),
  ]) {
    test(
      'HTTP $status/$error does not invalidate refresh credentials or expose native error',
      () async {
        final bff = _Bff(register: (_, pk) => _status(pk, 'ACTIVE', 200))
          ..sessionStatus = 401
          ..intercept = (request) async => request.url.path.endsWith('/token')
              ? jsonResponse({'error': error}, status)
              : null;
        final store = MemoryRefreshStore();
        final session = NativeSession(
          client: MockClient(bff.call),
          refreshStore: store,
        );
        await session.adopt(
          const OidcTokens(accessToken: 'expired', refreshToken: 'old-refresh'),
        );
        await expectLater(
          session.send(
            testPlatformConfig,
            PlatformMethod.get,
            '/api/v1/session',
          ),
          throwsA(
            isA<PlatformUnavailable>().having(
              (failure) => failure.message,
              'diagnostic',
              isNot(contains(error ?? 'null')),
            ),
          ),
        );
        expect(store.value, 'old-refresh');
      },
    );
  }

  test(
    'logout still deletes local credentials when reading them fails',
    () async {
      final store = _UnreadableRefreshStore();
      final session = NativeSession(
        client: MockClient((_) async => jsonResponse(null, 503)),
        refreshStore: store,
      );
      await session.adopt(
        const OidcTokens(accessToken: 'old', refreshToken: 'old-refresh'),
      );
      await expectLater(
        session.endSession(testPlatformConfig),
        throwsA(isA<PlatformUnavailable>()),
      );
      expect(store.value, isNull);
    },
  );

  test(
    'logout withdraws the collaboration surface before remote confirmation',
    () async {
      final started = Completer<void>();
      final answer = Completer<http.Response>();
      final bff = _Bff(register: (_, pk) => _status(pk, 'ACTIVE', 200));
      final container = await _container(bff);
      final link = container.read(platformLinkProvider.notifier);
      await link.signIn();
      bff.intercept = (request) async {
        if (request.url.path == '/api/v1/logout') {
          started.complete();
          return answer.future;
        }
        return null;
      };
      final ending = link.signOut();
      await started.future;
      await pumpEventQueue();
      final phaseWhilePending = container.read(platformLinkProvider).phase;
      final unconfirmedWhilePending = container
          .read(platformLinkProvider)
          .signOutUnconfirmed;
      final authWhilePending = (await container.read(
        authProvider.future,
      )).status;
      answer.complete(jsonResponse({'revoked': true}));
      await ending;
      expect(phaseWhilePending, PlatformLinkPhase.outcomeUnknown);
      expect(unconfirmedWhilePending, isFalse);
      expect(authWhilePending, AuthStatus.unauthenticated);
    },
  );

  test('unconfigured devices are not offered sign-in', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final container = ProviderContainer(
      overrides: [savedPrefsProvider.overrideWithValue(prefs)],
    );
    addTearDown(container.dispose);
    expect(container.read(platformConfigProvider), isNull);
    expect(
      container.read(platformLinkProvider).phase,
      PlatformLinkPhase.unconfigured,
    );
  });
}
