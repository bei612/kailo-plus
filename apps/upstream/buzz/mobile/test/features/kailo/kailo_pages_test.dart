import 'dart:convert';

import 'package:buzz/features/kailo/kailo_audit_page.dart';
import 'package:buzz/features/kailo/kailo_devices_page.dart';
import 'package:buzz/features/kailo/kailo_members_page.dart';
import 'package:buzz/shared/kailo/kailo_api.dart';
import 'package:buzz/shared/kailo/kailo_platform_text.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:hooks_riverpod/misc.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../shared/kailo/kailo_test_support.dart';

const _thisDevice =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const _otherDevice =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

Future<void> _pump(
  WidgetTester tester,
  Widget page,
  Future<http.Response> Function(http.Request) bff, {
  List<Override> overrides = const [],
  Locale locale = const Locale('en'),
}) async {
  SharedPreferences.setMockInitialValues({
    'kailo.config.v1': jsonEncode(testKailoConfig.toJson()),
  });
  final prefs = await SharedPreferences.getInstance();
  final client = MockClient(bff);
  final store = MemoryRefreshStore()..value = 'refresh-1';
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        savedPrefsProvider.overrideWithValue(prefs),
        kailoHttpClientProvider.overrideWithValue(client),
        kailoSessionProvider.overrideWithValue(
          KailoSession(client: client, refreshStore: store),
        ),
        myPubkeyProvider.overrideWithValue(_thisDevice),
        ...overrides,
      ],
      child: MaterialApp(
        locale: locale,
        supportedLocales: const [Locale('en'), Locale('zh', 'CN')],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        theme: AppTheme.light(),
        home: page,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<http.Response> Function(http.Request) _bff(
  Map<String, http.Response Function(http.Request)> routes,
) => (request) async {
  final oidc = oidcRoutes(request, refreshed: 'access-1');
  if (oidc != null) return oidc;
  final key = '${request.method} ${request.url.path}';
  final handler = routes[key];
  if (handler == null) return jsonResponse(null, 404);
  return handler(request);
};

void main() {
  testWidgets('devices: revoking another device keeps this one signed in', (
    tester,
  ) async {
    var revoked = <String>[];
    await _pump(
      tester,
      const KailoDevicesPage(),
      _bff({
        'GET /api/v1/identity/client-keys': (_) => jsonResponse([
          for (final pk in [_thisDevice, _otherDevice])
            if (!revoked.contains(pk))
              {
                'pubkey': pk,
                'state': 'ACTIVE',
                'createdAt': '2026-09-24T00:00:00Z',
              },
        ]),
        'DELETE /api/v1/identity/client-keys/$_otherDevice': (_) {
          revoked = [_otherDevice];
          return jsonResponse({
            'pubkey': _otherDevice,
            'state': 'REVOKING',
          }, 202);
        },
      }),
    );

    expect(find.textContaining('(This device)'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('kailo-revoke-$_otherDevice')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Revoke'));
    await tester.pumpAndSettle();

    expect(find.text('Device status: Being removed.'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('kailo-device-$_otherDevice')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('kailo-device-$_thisDevice')),
      findsOneWidget,
    );
  });

  testWidgets('devices: a refused revocation shows its reason code', (
    tester,
  ) async {
    await _pump(
      tester,
      const KailoDevicesPage(),
      _bff({
        'GET /api/v1/identity/client-keys': (_) => jsonResponse([
          {
            'pubkey': _otherDevice,
            'state': 'ACTIVE',
            'createdAt': '2026-09-24T00:00:00Z',
          },
        ]),
        'DELETE /api/v1/identity/client-keys/$_otherDevice': (_) =>
            jsonResponse(errorBody('DENIED', 'CLIENT_KEY_NOT_FOUND'), 404),
      }),
    );

    await tester.tap(find.byKey(const ValueKey('kailo-revoke-$_otherDevice')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Revoke'));
    await tester.pumpAndSettle();

    expect(find.textContaining('(CLIENT_KEY_NOT_FOUND)'), findsOneWidget);
  });

  testWidgets('views say "not known" when Kailo answers outside the contract', (
    tester,
  ) async {
    await _pump(
      tester,
      const KailoAuditPage(),
      _bff({'GET /api/v1/audit': (_) => jsonResponse(null, 502)}),
    );

    final text = tester.widget<Text>(
      find.byKey(const ValueKey('kailo-view-error')),
    );
    expect(text.data, contains('not known'));
    expect(
      find.text(kailoText(KailoMessageKey.platformRetry, locale: 'en')),
      findsOneWidget,
    );
  });

  testWidgets('audit lists only what the BFF returns for the caller', (
    tester,
  ) async {
    await _pump(
      tester,
      const KailoAuditPage(),
      _bff({
        'GET /api/v1/audit': (_) => jsonResponse([
          {
            'occurredAt': '2026-09-24T01:02:03Z',
            'eventType': 'INTENT',
            'actionKey': 'identity.client_key.register',
            'decision': 'ALLOW',
            'resultCode': 'ACCEPTED',
          },
        ]),
      }),
    );

    expect(find.text('identity.client_key.register'), findsOneWidget);
    expect(find.textContaining('Intent · ALLOW · ACCEPTED'), findsOneWidget);
  });

  testWidgets('members are listed per person with their key count', (
    tester,
  ) async {
    const workspace = '11111111-1111-4111-8111-111111111111';
    await _pump(
      tester,
      const KailoWorkspacesPage(),
      _bff({
        'GET /api/v1/workspaces': (_) => jsonResponse([
          {'id': workspace, 'slug': 'design', 'name': 'Design'},
        ]),
        'GET /api/v1/workspaces/$workspace/members': (_) => jsonResponse([
          {
            'principalId': '00000000-0000-4000-8000-000000000001',
            'displayName': 'Ada',
            'pubkeys': [_thisDevice, _otherDevice],
            'state': 'ACTIVE',
          },
        ]),
      }),
    );

    await tester.tap(find.text('Design'));
    await tester.pumpAndSettle();

    expect(find.text('Ada'), findsOneWidget);
    expect(find.text('Member · 2 keys'), findsOneWidget);
    expect(find.text('1 member'), findsOneWidget);
  });

  testWidgets('Chinese device page uses the shared status catalog', (
    tester,
  ) async {
    await _pump(
      tester,
      const KailoDevicesPage(),
      _bff({
        'GET /api/v1/identity/client-keys': (_) => jsonResponse([
          {
            'pubkey': _thisDevice,
            'state': 'ACTIVE',
            'createdAt': '2026-09-24T00:00:00Z',
          },
        ]),
      }),
      locale: const Locale('zh', 'CN'),
    );

    expect(find.text('我的设备'), findsOneWidget);
    expect(find.textContaining('(本机)'), findsOneWidget);
    expect(find.textContaining('有效 · 登记于'), findsOneWidget);
  });

  testWidgets('Chinese audit page translates its event type', (tester) async {
    await _pump(
      tester,
      const KailoAuditPage(),
      _bff({
        'GET /api/v1/audit': (_) => jsonResponse([
          {
            'occurredAt': '2026-09-24T01:02:03Z',
            'eventType': 'INTENT',
            'actionKey': 'identity.client_key.register',
            'decision': 'ALLOW',
            'resultCode': 'ACCEPTED',
          },
        ]),
      }),
      locale: const Locale('zh', 'CN'),
    );

    expect(find.text('我的活动记录'), findsOneWidget);
    expect(find.textContaining('意图 · ALLOW · ACCEPTED'), findsOneWidget);
  });

  testWidgets('Chinese member page translates state and counts', (
    tester,
  ) async {
    const workspace = '11111111-1111-4111-8111-111111111111';
    await _pump(
      tester,
      const KailoWorkspacesPage(),
      _bff({
        'GET /api/v1/workspaces': (_) => jsonResponse([
          {'id': workspace, 'slug': 'design', 'name': 'Design'},
        ]),
        'GET /api/v1/workspaces/$workspace/members': (_) => jsonResponse([
          {
            'principalId': '00000000-0000-4000-8000-000000000001',
            'displayName': 'Ada',
            'pubkeys': [_thisDevice, _otherDevice],
            'state': 'ACTIVE',
          },
        ]),
      }),
      locale: const Locale('zh', 'CN'),
    );

    await tester.tap(find.text('Design'));
    await tester.pumpAndSettle();
    expect(find.text('1 位成员'), findsOneWidget);
    expect(find.text('成员 · 2 把密钥'), findsOneWidget);
  });
}
