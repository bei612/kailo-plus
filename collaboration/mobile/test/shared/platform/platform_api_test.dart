import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:buzz/shared/platform/platform_api.dart';
import 'package:buzz/shared/platform/platform_oidc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'platform_test_support.dart';

void main() {
  test('refreshes once on 401 and retries once with the new token', () async {
    final seen = <String>[];
    final client = MockClient((request) async {
      final oidc = oidcRoutes(request, refreshed: 'access-2');
      if (oidc != null) return oidc;
      final auth = request.headers['Authorization']!;
      seen.add(auth);
      return auth == 'Bearer access-2'
          ? jsonResponse(sessionView())
          : jsonResponse(null, 401);
    });
    final store = MemoryRefreshStore()..value = 'refresh-1';
    final session = NativeSession(client: client, refreshStore: store);
    await session.adopt(
      const OidcTokens(accessToken: 'access-1', refreshToken: 'refresh-1'),
    );

    final response = await session.send(
      testPlatformConfig,
      PlatformMethod.get,
      '/api/v1/session',
    );

    expect(response.status, 200);
    expect(seen, ['Bearer access-1', 'Bearer access-2']);
    expect(store.value, 'refresh-2');
  });

  test('a second 401 discards credentials and asks for sign-in', () async {
    final client = MockClient((request) async {
      return oidcRoutes(request, refreshed: 'access-2') ??
          jsonResponse(null, 401);
    });
    final store = MemoryRefreshStore()..value = 'refresh-1';
    final session = NativeSession(client: client, refreshStore: store);

    await expectLater(
      session.send(testPlatformConfig, PlatformMethod.get, '/api/v1/session'),
      throwsA(isA<PlatformNotSignedIn>()),
    );
    expect(store.value, isNull);
  });

  test('an unreachable IdP keeps the refresh token', () async {
    final client = MockClient((request) async {
      if (request.url.host == 'idp.test') {
        throw http.ClientException('down');
      }
      return jsonResponse(null, 401);
    });
    final store = MemoryRefreshStore()..value = 'refresh-1';
    final session = NativeSession(client: client, refreshStore: store);

    await expectLater(
      session.send(testPlatformConfig, PlatformMethod.get, '/api/v1/session'),
      throwsA(isA<PlatformUnavailable>()),
    );
    expect(store.value, 'refresh-1');
  });

  test('only /api/v1/ paths are sent', () async {
    final session = NativeSession(
      client: MockClient((_) async => fail('must not send')),
      refreshStore: MemoryRefreshStore()..value = 'r',
    );
    for (final path in ['/admin', '/api/v1/../admin', 'https://evil/api/v1/']) {
      await expectLater(
        session.send(testPlatformConfig, PlatformMethod.get, path),
        throwsArgumentError,
      );
    }
  });

  test('error bodies are read through the contract, unknown ones are not', () {
    expect(
      PlatformResponse(
        403,
        errorBody('DENIED', 'CLIENT_KEY_PROOF_INVALID'),
      ).error?.reason,
      ReasonCode.CLIENT_KEY_PROOF_INVALID,
    );
    // 本端不认识的 reason code：不猜，交给调用方当作结果不明
    expect(
      PlatformResponse(403, errorBody('DENIED', 'SOMETHING_NEW')).error,
      isNull,
    );
    expect(const PlatformResponse(502, null).error, isNull);
  });
}
