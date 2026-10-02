import 'dart:convert';

import 'package:buzz/features/platform/platform_audit_page.dart';
import 'package:buzz/features/platform/platform_agent_installation_workspaces_page.dart';
import 'package:buzz/features/platform/platform_devices_page.dart';
import 'package:buzz/features/platform/platform_members_page.dart';
import 'package:buzz/shared/platform/platform_api.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
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

import '../../shared/platform/platform_test_support.dart';

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
    'platform.config.v1': jsonEncode(testPlatformConfig.toJson()),
  });
  final prefs = await SharedPreferences.getInstance();
  final client = MockClient(bff);
  final store = MemoryRefreshStore()..value = 'refresh-1';
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        savedPrefsProvider.overrideWithValue(prefs),
        platformHttpClientProvider.overrideWithValue(client),
        nativeSessionProvider.overrideWithValue(
          NativeSession(client: client, refreshStore: store),
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
      const PlatformDevicesPage(),
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
    await tester.tap(
      find.byKey(const ValueKey('platform-revoke-$_otherDevice')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Revoke'));
    await tester.pumpAndSettle();

    expect(find.text('Device status: Being removed.'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('platform-device-$_otherDevice')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('platform-device-$_thisDevice')),
      findsOneWidget,
    );
  });

  testWidgets('devices: a refused revocation shows its reason code', (
    tester,
  ) async {
    await _pump(
      tester,
      const PlatformDevicesPage(),
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

    await tester.tap(
      find.byKey(const ValueKey('platform-revoke-$_otherDevice')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Revoke'));
    await tester.pumpAndSettle();

    expect(find.textContaining('(CLIENT_KEY_NOT_FOUND)'), findsOneWidget);
  });

  testWidgets(
    'views say "not known" when the platform answers outside the contract',
    (tester) async {
      await _pump(
        tester,
        const PlatformAuditPage(),
        _bff({'GET /api/v1/audit': (_) => jsonResponse(null, 502)}),
      );

      final text = tester.widget<Text>(
        find.byKey(const ValueKey('platform-view-error')),
      );
      expect(text.data, contains('not known'));
      expect(
        find.text(platformText(PlatformMessageKey.platformRetry, locale: 'en')),
        findsOneWidget,
      );
    },
  );

  testWidgets('audit lists only what the BFF returns for the caller', (
    tester,
  ) async {
    await _pump(
      tester,
      const PlatformAuditPage(),
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
      const PlatformWorkspacesPage(),
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
      const PlatformDevicesPage(),
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
      const PlatformAuditPage(),
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
      const PlatformWorkspacesPage(),
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

  // 产品消费者已实现后，走真实 NativeSession / BFF GET / Navigator 接缝。
  group('Installation read-only management', () {
    const installation = {
      'resourceId': 'installation-1', 'workspaceId': 'workspace-1',
      'agentResourceId': 'agent-1', 'pinnedVersionAssetId': 'pinned-asset-1',
      'agentPrincipalId': 'agent-principal-1', 'agentPrincipalState': 'ACTIVE',
      'ownerPrincipalId': 'owner-1', 'resourceVersion': 1,
      'resourceState': 'PROVISIONING', 'state': 'PROVISIONING',
      'channelBinding': {
        'status': 'DISABLED', 'triggers': ['MENTION', 'MANUAL_ASSIGNMENT'],
        'channelId': 'channel-1',
      },
      'projection': {
        'generation': 1, 'agentVersionAssetId': 'pinned-asset-1',
        'runtimeProfileKey': 'SERVER_CODEX',
        'configHash': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'state': 'PENDING',
      },
      'content': 'private-prompt', 'secretRef': 'private-secret-ref',
      'runtimeIsolationRef': '/private/runtime/root',
    };

    testWidgets('Workspace -> page -> exact detail stays read-only and reports pending projection', (tester) async {
      final requests = <http.Request>[];
      await _pump(tester, const PlatformAgentInstallationWorkspacesPage(), _bff({
        'GET /api/v1/workspaces': (request) {
          requests.add(request);
          return jsonResponse([{'id': 'workspace-1', 'slug': 'ops', 'name': 'Ops'}]);
        },
        'GET /api/v1/agent-installations': (request) {
          requests.add(request);
          expect(request.url.queryParameters, {'workspaceId': 'workspace-1', 'offset': '0'});
          return jsonResponse({'installations': [installation]});
        },
        'GET /api/v1/agent-installations/installation-1': (request) {
          requests.add(request);
          return jsonResponse(installation);
        },
      }));
      await tester.tap(find.byKey(const ValueKey('platform-installation-workspace-workspace-1')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Being installed'), findsOneWidget);
      expect(find.textContaining('pinned-asset-1'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('platform-installation-installation-1')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('platform-installation-detail')), findsOneWidget);
      expect(find.text('pinned-asset-1'), findsOneWidget);
      expect(find.text('agent-principal-1'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Projection pending'), 300);
      expect(find.text('Projection pending'), findsOneWidget);
      expect(find.text('SERVER_CODEX'), findsOneWidget);
      expect(find.text('Disabled channel binding'), findsOneWidget);
      for (final label in ['Install', 'Run', 'Create session', 'Disable',
        'private-prompt', 'private-secret-ref', '/private/runtime/root']) {
        expect(find.text(label), findsNothing);
      }
      expect(requests.length, 3);
      expect(requests.every((r) => r.method == 'GET'), isTrue);
      expect(requests.any((r) => r.url.path.startsWith('/api/v1/agent-versions/')), isFalse);
    });

    testWidgets('authorized empty page continues with the original cursor, then previous rereads', (tester) async {
      final offsets = <String?>[];
      await _pump(tester, const PlatformAgentInstallationWorkspacesPage(), _bff({
        'GET /api/v1/workspaces': (_) => jsonResponse([{'id': 'workspace-1', 'slug': 'ops', 'name': 'Ops'}]),
        'GET /api/v1/agent-installations': (request) {
          offsets.add(request.url.queryParameters['offset']);
          return jsonResponse(request.url.queryParameters['offset'] == '0'
            ? {'installations': [], 'nextOffset': 9}
            : {'installations': [installation]});
        },
      }));
      await tester.tap(find.text('Ops'));
      await tester.pumpAndSettle();
      expect(find.text('No installations you may read on this page.'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('platform-installations-next')));
      await tester.pumpAndSettle();
      expect(find.textContaining('pinned-asset-1'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('platform-installations-previous')));
      await tester.pumpAndSettle();
      expect(offsets, ['0', '9', '0']);
    });

    for (final (name, row) in <(String, Map<String, Object?>)>[
      ('cross Workspace', {...installation, 'workspaceId': 'workspace-other'}),
      ('unknown enum', {...installation, 'state': 'FUTURE_STATE'}),
      ('different version pin', {...installation, 'projection': {
        ...installation['projection']! as Map<String, Object>,
        'agentVersionAssetId': 'latest-instead-of-pin',
      }}),
      ('different generation', {...installation, 'state': 'ACTIVE', 'resourceState': 'ACTIVE',
        'activeProjectionGeneration': 2, 'projection': {
          ...installation['projection']! as Map<String, Object>, 'state': 'ACTIVE',
        }}),
    ]) {
      testWidgets('$name remains UNKNOWN and does not show a usable or empty page', (tester) async {
        await _pump(tester, const PlatformAgentInstallationWorkspacesPage(), _bff({
          'GET /api/v1/workspaces': (_) => jsonResponse([{'id': 'workspace-1', 'slug': 'ops', 'name': 'Ops'}]),
          'GET /api/v1/agent-installations': (_) => jsonResponse({'installations': [row]}),
        }));
        await tester.tap(find.text('Ops'));
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('platform-view-error')), findsOneWidget);
        expect(find.textContaining('not known'), findsOneWidget);
        expect(find.textContaining('No installations'), findsNothing);
        expect(find.byKey(const ValueKey('platform-installation-installation-1')), findsNothing);
      });
    }

    for (final (name, reply, label) in [
      ('bare403', jsonResponse(null, 403), 'Not allowed'),
      ('bare404', jsonResponse(null, 404), 'Not available here'),
      ('explicitUNKNOWN', jsonResponse(errorBody('UNKNOWN', 'PERMISSION_DENIED'), 403), 'not known'),
      ('futureClass', jsonResponse(errorBody('FUTURE_CLASS', 'PERMISSION_DENIED'), 403), 'not known'),
      ('unclassified503', jsonResponse(null, 503), 'not known'),
    ]) {
      testWidgets('$name keeps the actual read conclusion, not an empty installation list', (tester) async {
        await _pump(tester, const PlatformAgentInstallationWorkspacesPage(), _bff({
          'GET /api/v1/workspaces': (_) => jsonResponse([{'id': 'workspace-1', 'slug': 'ops', 'name': 'Ops'}]),
          'GET /api/v1/agent-installations': (_) => reply,
        }));
        await tester.tap(find.text('Ops'));
        await tester.pumpAndSettle();
        expect(find.textContaining(label), findsOneWidget);
        expect(find.textContaining('No installations'), findsNothing);
        if (label == 'not known') expect(find.textContaining('PERMISSION_DENIED'), findsNothing);
      });
    }

    testWidgets('Chinese management uses the same source labels and renders no write buttons', (tester) async {
      await _pump(tester, const PlatformAgentInstallationWorkspacesPage(), _bff({
        'GET /api/v1/workspaces': (_) => jsonResponse([{'id': 'workspace-1', 'slug': 'ops', 'name': 'Ops'}]),
        'GET /api/v1/agent-installations': (_) => jsonResponse({'installations': [installation]}),
      }), locale: const Locale('zh', 'CN'));
      await tester.tap(find.text('Ops'));
      await tester.pumpAndSettle();
      expect(find.textContaining('正在安装'), findsOneWidget);
      expect(find.textContaining('精确版本引用'), findsOneWidget);
      expect(find.textContaining('不证明进程此刻健康'), findsOneWidget);
      for (final label in ['安装', '运行', '创建会话', '停用']) {
        expect(find.widgetWithText(FilledButton, label), findsNothing);
      }
    });
  });
}
