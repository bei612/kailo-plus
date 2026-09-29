import 'dart:async';
import 'dart:convert';

import 'package:buzz/shared/platform/platform_oidc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:pointycastle/digests/sha256.dart';

import 'platform_test_support.dart';

void main() {
  test('PKCE challenge is the S256 of the verifier and never repeats', () {
    final a = generatePkce();
    final b = generatePkce();
    expect(a.verifier.length, greaterThanOrEqualTo(43));
    final digest = SHA256Digest().process(utf8.encode(a.verifier));
    expect(a.challenge, base64Url.encode(digest).replaceAll('=', ''));
    expect(a.verifier, isNot(b.verifier));
  });

  test('authorization code flow sends PKCE and exchanges the code', () async {
    final tokenForms = <Map<String, String>>[];
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/token')) {
        tokenForms.add(request.bodyFields);
        return jsonResponse({
          'access_token': 'access-1',
          'refresh_token': 'refresh-1',
        });
      }
      return oidcRoutes(request, refreshed: 'unused')!;
    });
    final callbacks = StreamController<Uri>();
    addTearDown(callbacks.close);

    Uri? authorize;
    final tokens = await signInWithAuthorizationCode(
      client: client,
      config: testKailoConfig,
      redirectUri: kailoRedirectUri,
      open: (uri) async {
        authorize = uri;
        final state = uri.queryParameters['state']!;
        // 别人的回调（state 不符）不被消费
        callbacks.add(Uri.parse('$kailoRedirectUri?code=forged&state=other'));
        callbacks.add(Uri.parse('$kailoRedirectUri?code=c-1&state=$state'));
      },
      callbacks: callbacks.stream,
      cancelled: Completer<void>().future,
    );

    final query = authorize!.queryParameters;
    expect(query['response_type'], 'code');
    expect(query['client_id'], 'kailo-native');
    expect(query['redirect_uri'], kailoRedirectUri);
    expect(query['code_challenge_method'], 'S256');
    expect(tokens.accessToken, 'access-1');
    expect(tokens.refreshToken, 'refresh-1');
    final form = tokenForms.single;
    expect(form['grant_type'], 'authorization_code');
    expect(form['code'], 'c-1');
    expect(form['redirect_uri'], kailoRedirectUri);
    expect(pkceChallenge(form['code_verifier']!), query['code_challenge']);
  });

  test(
    'cancelling the wait ends the sign-in without a token request',
    () async {
      var tokenRequests = 0;
      final client = MockClient((request) async {
        if (request.url.path.endsWith('/token')) tokenRequests++;
        return oidcRoutes(request, refreshed: 'x')!;
      });
      final cancel = Completer<void>();
      final result = signInWithAuthorizationCode(
        client: client,
        config: testKailoConfig,
        redirectUri: kailoRedirectUri,
        open: (_) async => cancel.complete(),
        callbacks: const Stream.empty(),
        cancelled: cancel.future,
      );
      await expectLater(result, throwsA(isA<OidcCancelled>()));
      expect(tokenRequests, 0);
    },
  );

  test('token endpoint 4xx is a rejection, 5xx is unavailability', () async {
    Future<Object> refreshWith(int status) async {
      final client = MockClient((request) async {
        if (request.url.path.endsWith('/token')) {
          return jsonResponse({'error': 'invalid_grant'}, status);
        }
        return oidcRoutes(request, refreshed: 'x')!;
      });
      try {
        await refreshOidcTokens(client, testKailoConfig, 'r');
        return 'no error';
      } on OidcFailure catch (e) {
        return e;
      }
    }

    expect(await refreshWith(400), isA<OidcRejected>());
    expect(await refreshWith(503), isA<OidcUnavailable>());
  });

  test('an unreachable IdP is unavailability, not rejection', () async {
    final client = MockClient((_) async => throw http.ClientException('down'));
    await expectLater(
      refreshOidcTokens(client, testKailoConfig, 'r'),
      throwsA(isA<OidcUnavailable>()),
    );
  });
}
