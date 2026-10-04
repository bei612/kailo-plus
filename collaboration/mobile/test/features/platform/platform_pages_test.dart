import 'dart:convert';

import 'package:buzz/features/platform/platform_audit_page.dart';
import 'package:buzz/features/platform/platform_agent_definitions_page.dart';
import 'package:buzz/features/platform/platform_agent_definition_detail_page.dart';
import 'package:buzz/features/platform/platform_agent_installation_workspaces_page.dart';
import 'package:buzz/features/platform/platform_agent_installation_detail_page.dart';
import 'package:buzz/features/platform/platform_agent_memory_page.dart';
import 'package:buzz/features/platform/platform_automation_detail_page.dart';
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
  group('Automation trigger and result read-only contract', () {
    const page = PlatformAutomationDetailPage(
      workspaceId: 'workspace-1',
      resourceId: 'automation-1',
    );
    const schedule = {
      'kind': 'SCHEDULE',
      'scheduleSpec': {
        'everySeconds': 1800,
        'offsetSeconds': 37,
        'catchupWindowSeconds': 90,
      },
    };
    Map<String, Object?> detail(
      Map<String, Object?> trigger,
      String target, {
      String workspace = 'workspace-1',
      String action = 'AGENT_TURN',
    }) => {
      'automation': {
        'resourceId': 'automation-1',
        'workspaceId': workspace,
        'ownerPrincipalId': 'owner-1',
        'resourceVersion': 1,
        'resourceState': 'ACTIVE',
        'state': 'PAUSED',
        'executorInstallationResourceId': 'installation-1',
        'pinnedVersionAssetId': 'automation-version-1',
      },
      'versions': [
        {
          'assetId': 'automation-version-1',
          'automationResourceId': 'automation-1',
          'assetVersion': 1,
          'ordinal': 1,
          'ownerPrincipalId': 'owner-1',
          'state': 'PUBLISHED',
          'configHash': _thisDevice,
          'content': {
            'trigger': trigger,
            'action': {'kind': action, 'template': 'Authorized template'},
            'resultTarget': target,
          },
        },
      ],
      'delegations': <Object>[],
      'canManage': true,
    };
    Future<void> show(
      WidgetTester tester,
      Map<String, Object?> body, {
      Locale locale = const Locale('en'),
    }) async {
      tester.view.physicalSize = const Size(1000, 2600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await _pump(
        tester,
        page,
        _bff({
          'GET /api/v1/automations/automation-1': (request) {
            expect(request.url.queryParameters, {
              'versionOffset': '0',
              'delegationOffset': '0',
            });
            return jsonResponse(body);
          },
        }),
        locale: locale,
      );
    }

    for (final locale in [const Locale('en'), const Locale('zh', 'CN')]) {
      testWidgets('Schedule channel and seconds are explicit in $locale', (
        tester,
      ) async {
        await show(tester, detail(schedule, 'CHANNEL'), locale: locale);
        expect(
          find.byKey(const ValueKey('platform-automation-detail')),
          findsOneWidget,
        );
        for (final key in [
          PlatformMessageKey.agentsAutomationSchedule,
          PlatformMessageKey.agentsAutomationChannel,
          PlatformMessageKey.agentsAutomationEverySeconds,
          PlatformMessageKey.agentsAutomationOffsetSeconds,
          PlatformMessageKey.agentsAutomationCatchupWindowSeconds,
        ]) {
          expect(
            find.text(platformText(key, locale: locale.toLanguageTag())),
            findsOneWidget,
          );
        }
        for (final value in ['1800', '37', '90']) {
          expect(find.text(value), findsOneWidget);
        }
        expect(find.byType(TextField), findsNothing);
        expect(find.byType(TextFormField), findsNothing);
        expect(
          find.text(
            platformText(
              PlatformMessageKey.agentsAutomationThread,
              locale: locale.toLanguageTag(),
            ),
          ),
          findsNothing,
        );
      });
    }

    for (final locale in [const Locale('en'), const Locale('zh', 'CN')]) {
      for (final (kind, label) in [
        ('AGENT_TURN', PlatformMessageKey.agentsAutomationAgentTurn),
        ('POST_MESSAGE', PlatformMessageKey.agentsAutomationPostMessage),
      ]) {
        testWidgets('$kind action is readable without controls in $locale', (
          tester,
        ) async {
          await show(
            tester,
            detail(schedule, 'CHANNEL', action: kind),
            locale: locale,
          );
          expect(
            find.byKey(const ValueKey('platform-automation-detail')),
            findsOneWidget,
          );
          expect(
            find.text(platformText(label, locale: locale.toLanguageTag())),
            findsOneWidget,
          );
          expect(find.text('Authorized template'), findsOneWidget);
          expect(find.byType(TextField), findsNothing);
          expect(find.byType(TextFormField), findsNothing);
          for (final key in [
            PlatformMessageKey.agentsAutomationPublish,
            PlatformMessageKey.agentsAutomationEnable,
            PlatformMessageKey.agentsAutomationDisable,
          ]) {
            expect(
              find.text(platformText(key, locale: locale.toLanguageTag())),
              findsNothing,
            );
          }
        });
      }
    }
    testWidgets('Unknown action cannot reveal template content', (
      tester,
    ) async {
      await show(tester, detail(schedule, 'CHANNEL', action: 'FUTURE'));
      expect(find.byKey(const ValueKey('platform-view-error')), findsOneWidget);
      expect(find.text('Authorized template'), findsNothing);
    });

    for (final (trigger, label) in [
      (
        {'kind': 'MENTION', 'mentionPrincipalId': 'human-1'},
        PlatformMessageKey.agentsInstallationTriggerMention,
      ),
      (
        {'kind': 'CHANNEL_MESSAGE', 'textPrefix': 'review'},
        PlatformMessageKey.agentsAutomationChannelMessage,
      ),
    ]) {
      testWidgets('Message trigger ${trigger['kind']} keeps thread result', (
        tester,
      ) async {
        await show(tester, detail(trigger, 'TRIGGER_THREAD'));
        expect(find.text(platformText(label, locale: 'en')), findsOneWidget);
        expect(find.text('Trigger thread'), findsOneWidget);
        expect(find.text('Interval (seconds)'), findsNothing);
      });
    }

    for (final (name, trigger, target) in [
      ('schedule thread', schedule, 'TRIGGER_THREAD'),
      (
        'mention channel',
        {'kind': 'MENTION', 'mentionPrincipalId': 'human-1'},
        'CHANNEL',
      ),
      ('message channel', {'kind': 'CHANNEL_MESSAGE'}, 'CHANNEL'),
      ('missing schedule', {'kind': 'SCHEDULE'}, 'CHANNEL'),
      (
        'mixed schedule message',
        {...schedule, 'textPrefix': 'review'},
        'CHANNEL',
      ),
      (
        'message schedule',
        {'kind': 'CHANNEL_MESSAGE', 'scheduleSpec': schedule['scheduleSpec']},
        'TRIGGER_THREAD',
      ),
      (
        'zero interval',
        {
          'kind': 'SCHEDULE',
          'scheduleSpec': {
            'everySeconds': 0,
            'offsetSeconds': 0,
            'catchupWindowSeconds': 90,
          },
        },
        'CHANNEL',
      ),
      (
        'offset outside interval',
        {
          'kind': 'SCHEDULE',
          'scheduleSpec': {
            'everySeconds': 1800,
            'offsetSeconds': 1800,
            'catchupWindowSeconds': 90,
          },
        },
        'CHANNEL',
      ),
      (
        'short catchup',
        {
          'kind': 'SCHEDULE',
          'scheduleSpec': {
            'everySeconds': 1800,
            'offsetSeconds': 37,
            'catchupWindowSeconds': 9,
          },
        },
        'CHANNEL',
      ),
      ('unknown trigger', {'kind': 'FUTURE'}, 'TRIGGER_THREAD'),
      ('unknown target', schedule, 'FUTURE'),
    ]) {
      testWidgets('$name is not a verifiable Automation version', (
        tester,
      ) async {
        await show(tester, detail(trigger, target));
        expect(
          find.byKey(const ValueKey('platform-view-error')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('platform-automation-detail')),
          findsNothing,
        );
        expect(find.text('Authorized template'), findsNothing);
      });
    }
    testWidgets('Foreign workspace cannot reveal Schedule content', (
      tester,
    ) async {
      await show(tester, detail(schedule, 'CHANNEL', workspace: 'workspace-2'));
      expect(find.byKey(const ValueKey('platform-view-error')), findsOneWidget);
      expect(find.text('Authorized template'), findsNothing);
    });
  });

  group('Agent Definition and published Version read-only', () {
    const definition = {
      'resourceId': 'agent-1',
      'stableSlug': 'reviewer',
      'displayName': 'Reviewer',
      'ownerPrincipalId': 'owner-1',
      'resourceVersion': 1,
      'resourceState': 'ACTIVE',
      'status': 'ACTIVE',
      'currentPublishedVersionAssetId': 'version-1',
    };
    const version = {
      'assetId': 'version-1',
      'agentResourceId': 'agent-1',
      'ordinal': 1,
      'assetVersion': 1,
      'ownerPrincipalId': 'owner-1',
      'state': 'PUBLISHED',
      'configHash': _thisDevice,
      'content': {
        'instructions': 'Authorized version instructions',
        'personaIdentity': {'displayName': 'Reviewer'},
        'runtimeProfileKey': 'SERVER_CODEX',
        'modelRouteResourceId': 'route-1',
        'parallelism': 1,
        'replyPolicy': 'reply',
        'skillVersionAssetIds': <Object>[],
        'declaredToolResourceIds': <Object>[],
        'capabilityRequirements': <Object>[],
        'triggerDefaults': ['MENTION'],
        'memoryPolicy': {'coreWrite': 'HUMAN_ONLY', 'coldWrite': 'DISABLED'},
        'turnLimits': {'maxTurnDurationSeconds': 60, 'idleTimeoutSeconds': 60},
      },
    };
    const detail = PlatformAgentDefinitionDetailPage(resourceId: 'agent-1');
    const emptyVersions = {
      'agentResourceId': 'agent-1',
      'resourceVersion': 1,
      'versions': <Object>[],
      'nextOffset': null,
    };

    testWidgets(
      'version history keeps filtered-page cursors and remains read-only',
      (tester) async {
        final offsets = <String?>[];
        final requests = <http.Request>[];
        await _pump(tester, detail, (request) async {
          requests.add(request);
          return _bff({
            'GET /api/v1/agent-definitions/agent-1': (_) => jsonResponse(
              {...definition}..remove('currentPublishedVersionAssetId'),
            ),
            'GET /api/v1/agent-definitions/agent-1/versions': (request) {
              final offset = request.url.queryParameters['offset'];
              offsets.add(offset);
              return jsonResponse(
                offset == '0'
                    ? {...emptyVersions, 'nextOffset': 40}
                    : {
                        ...emptyVersions,
                        'versions': [
                          {
                            ...version,
                            'assetId': 'draft-2',
                            'ordinal': 2,
                            'state': 'DRAFT',
                            'canUpdate': true,
                            'canPublish': true,
                          },
                          {
                            ...version,
                            'assetId': 'retired-3',
                            'ordinal': 3,
                            'state': 'RETIRED',
                          },
                        ],
                      },
              );
            },
          })(request);
        });
        expect(
          find.text('No authorized versions on this page.'),
          findsOneWidget,
        );
        await tester.scrollUntilVisible(
          find.byKey(const ValueKey('platform-agent-versions-next')),
          180,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const ValueKey('platform-agent-versions-next')),
        );
        await tester.pumpAndSettle();
        expect(
          find.byKey(const ValueKey('platform-agent-version-draft-2')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('platform-agent-version-retired-3')),
          findsOneWidget,
        );
        expect(find.textContaining('Draft'), findsOneWidget);
        expect(find.textContaining('Retired'), findsOneWidget);
        expect(find.byType(TextField), findsNothing);
        expect(
          find.byKey(const ValueKey('platform-agent-versions-next')),
          findsNothing,
        );
        await tester.scrollUntilVisible(
          find.byKey(const ValueKey('platform-agent-versions-previous')),
          180,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const ValueKey('platform-agent-versions-previous')),
        );
        await tester.pumpAndSettle();
        expect(
          find.text('No authorized versions on this page.'),
          findsOneWidget,
        );
        expect(offsets, ['0', '40', '0']);
        expect(
          requests
              .where((request) => request.url.path.startsWith('/api/v1/'))
              .every((request) => request.method == 'GET'),
          isTrue,
        );
      },
    );

    for (final (name, page) in [
      (
        'foreign history scope',
        {...emptyVersions, 'agentResourceId': 'other-agent'},
      ),
      ('changed Definition version', {...emptyVersions, 'resourceVersion': 2}),
      ('repeated history cursor', {...emptyVersions, 'nextOffset': 0}),
      (
        'foreign history row',
        {
          ...emptyVersions,
          'versions': [
            {...version, 'agentResourceId': 'other-agent'},
          ],
        },
      ),
      (
        'duplicate history asset',
        {
          ...emptyVersions,
          'versions': [
            version,
            {...version, 'ordinal': 2},
          ],
        },
      ),
      (
        'duplicate history ordinal',
        {
          ...emptyVersions,
          'versions': [
            version,
            {...version, 'assetId': 'other-version'},
          ],
        },
      ),
      (
        'unknown history state',
        {
          ...emptyVersions,
          'versions': [
            {...version, 'state': 'FUTURE'},
          ],
        },
      ),
      (
        'invalid history hash',
        {
          ...emptyVersions,
          'versions': [
            {...version, 'configHash': ''},
          ],
        },
      ),
      (
        'published history claims draft write',
        {
          ...emptyVersions,
          'versions': [
            {...version, 'canUpdate': true},
          ],
        },
      ),
    ]) {
      testWidgets('$name fails closed instead of an empty history', (
        tester,
      ) async {
        await _pump(
          tester,
          detail,
          _bff({
            'GET /api/v1/agent-definitions/agent-1': (_) => jsonResponse(
              {...definition}..remove('currentPublishedVersionAssetId'),
            ),
            'GET /api/v1/agent-definitions/agent-1/versions': (_) =>
                jsonResponse(page),
          }),
        );
        expect(
          find.byKey(const ValueKey('platform-view-error')),
          findsOneWidget,
        );
        expect(find.text('No authorized versions on this page.'), findsNothing);
        expect(
          find.byKey(const ValueKey('platform-agent-version-version-1')),
          findsNothing,
        );
        expect(find.byType(TextField), findsNothing);
      });
    }

    testWidgets(
      'empty authorized directory page preserves next and previous cursors',
      (tester) async {
        final offsets = <String?>[];
        await _pump(
          tester,
          const PlatformAgentDefinitionsPage(),
          _bff({
            'GET /api/v1/agent-definitions': (request) {
              final offset = request.url.queryParameters['offset'];
              offsets.add(offset);
              return jsonResponse(
                offset == '0'
                    ? {'definitions': <Object>[], 'nextOffset': 40}
                    : {
                        'definitions': [definition],
                      },
              );
            },
          }),
        );
        expect(
          find.text('No definitions visible on this page.'),
          findsOneWidget,
        );
        await tester.tap(
          find.byKey(const ValueKey('platform-agent-definitions-next')),
        );
        await tester.pumpAndSettle();
        expect(find.text('Reviewer'), findsOneWidget);
        await tester.tap(
          find.byKey(const ValueKey('platform-agent-definitions-previous')),
        );
        await tester.pumpAndSettle();
        expect(
          find.text('No definitions visible on this page.'),
          findsOneWidget,
        );
        expect(offsets, ['0', '40', '0']);
      },
    );

    testWidgets(
      'directory opens independently authorized exact Version and refresh rereads it',
      (tester) async {
        final reads = <http.Request>[];
        await _pump(tester, const PlatformAgentInstallationWorkspacesPage(), (
          request,
        ) async {
          reads.add(request);
          return _bff({
            'GET /api/v1/workspaces': (_) => jsonResponse(null, 403),
            'GET /api/v1/agent-definitions': (_) => jsonResponse({
              'definitions': [definition],
            }),
            'GET /api/v1/agent-definitions/agent-1': (_) =>
                jsonResponse(definition),
            'GET /api/v1/agent-definitions/agent-1/versions': (_) =>
                jsonResponse(emptyVersions),
            'GET /api/v1/agent-versions/version-1': (_) =>
                jsonResponse(version),
          })(request);
        });
        expect(
          reads.any((r) => r.url.path.startsWith('/api/v1/agent-versions')),
          isFalse,
        );
        await tester.tap(find.byTooltip('View definition'));
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const ValueKey('platform-agent-definition-agent-1')),
        );
        await tester.pumpAndSettle();
        await tester.scrollUntilVisible(
          find.byKey(const ValueKey('platform-agent-version-instructions')),
          180,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.pumpAndSettle();
        expect(find.text('Authorized version instructions'), findsOneWidget);
        expect(find.text('Published'), findsOneWidget);
        expect(find.byType(TextField), findsNothing);
        await tester.tap(find.byTooltip('Refresh').last);
        await tester.pumpAndSettle();
        expect(
          reads.where((r) => r.url.path == '/api/v1/agent-versions/version-1'),
          hasLength(2),
        );
        expect(
          reads
              .where((r) => r.url.path.startsWith('/api/v1/'))
              .every((r) => r.method == 'GET'),
          isTrue,
        );
      },
    );

    testWidgets(
      'absent published pointer is the only no-published-version case',
      (tester) async {
        final reads = <http.Request>[];
        await _pump(tester, detail, (request) async {
          reads.add(request);
          return _bff({
            'GET /api/v1/agent-definitions/agent-1': (_) => jsonResponse(
              {...definition}..remove('currentPublishedVersionAssetId'),
            ),
            'GET /api/v1/agent-definitions/agent-1/versions': (_) =>
                jsonResponse(emptyVersions),
          })(request);
        });
        expect(find.text('No published version.'), findsOneWidget);
        expect(
          find.byKey(const ValueKey('platform-agent-published-version')),
          findsNothing,
        );
        expect(
          reads.any((r) => r.url.path.startsWith('/api/v1/agent-versions')),
          isFalse,
        );
      },
    );

    for (final (name, page) in [
      (
        'unknown Definition status',
        {
          'definitions': [
            {...definition, 'status': 'FUTURE'},
          ],
        },
      ),
      (
        'unknown Resource state',
        {
          'definitions': [
            {...definition, 'resourceState': 'FUTURE'},
          ],
        },
      ),
      (
        'missing owner',
        {
          'definitions': [
            {...definition, 'ownerPrincipalId': ''},
          ],
        },
      ),
      ('repeated cursor', {'definitions': <Object>[], 'nextOffset': 0}),
      (
        'duplicate ID',
        {
          'definitions': [definition, definition],
        },
      ),
    ]) {
      testWidgets('$name cannot become an empty or ready directory', (
        tester,
      ) async {
        await _pump(
          tester,
          const PlatformAgentDefinitionsPage(),
          _bff({'GET /api/v1/agent-definitions': (_) => jsonResponse(page)}),
        );
        expect(
          find.byKey(const ValueKey('platform-view-error')),
          findsOneWidget,
        );
        expect(find.text('No definitions visible on this page.'), findsNothing);
        expect(find.text('Reviewer'), findsNothing);
      });
    }

    for (final (name, reply) in [
      (
        'foreign Definition',
        jsonResponse({...version, 'agentResourceId': 'other-agent'}),
      ),
      ('foreign Asset', jsonResponse({...version, 'assetId': 'other-version'})),
      ('retired pointer', jsonResponse({...version, 'state': 'RETIRED'})),
      ('unknown Version state', jsonResponse({...version, 'state': 'FUTURE'})),
      ('invalid config hash', jsonResponse({...version, 'configHash': ''})),
      ('read denied', jsonResponse(null, 403)),
      (
        'projection unavailable',
        jsonResponse(errorBody('UNAVAILABLE', 'PROJECTION_FAILED'), 503),
      ),
      (
        'explicit UNKNOWN',
        jsonResponse(errorBody('UNKNOWN', 'PERMISSION_DENIED'), 403),
      ),
    ]) {
      testWidgets(
        '$name hides Version body without claiming no published version',
        (tester) async {
          await _pump(
            tester,
            detail,
            _bff({
              'GET /api/v1/agent-definitions/agent-1': (_) =>
                  jsonResponse(definition),
              'GET /api/v1/agent-definitions/agent-1/versions': (_) =>
                  jsonResponse(emptyVersions),
              'GET /api/v1/agent-versions/version-1': (_) => reply,
            }),
          );
          expect(
            find.byKey(const ValueKey('platform-view-error')),
            findsOneWidget,
          );
          expect(find.text('Authorized version instructions'), findsNothing);
          expect(find.text('Published'), findsNothing);
          expect(find.text('No published version.'), findsNothing);
          if (name == 'explicit UNKNOWN') {
            expect(find.textContaining('not known'), findsOneWidget);
          }
          if (name == 'read denied') {
            expect(find.text('Not allowed'), findsOneWidget);
          }
        },
      );
    }
  });

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
      'resourceId': 'installation-1',
      'workspaceId': 'workspace-1',
      'agentResourceId': 'agent-1',
      'pinnedVersionAssetId': 'pinned-asset-1',
      'agentPrincipalId': 'agent-principal-1',
      'agentPrincipalState': 'ACTIVE',
      'ownerPrincipalId': 'owner-1',
      'resourceVersion': 1,
      'resourceState': 'PROVISIONING',
      'state': 'PROVISIONING',
      'channelBinding': {
        'status': 'DISABLED',
        'triggers': ['MENTION', 'MANUAL_ASSIGNMENT'],
        'channelId': 'channel-1',
      },
      'projection': {
        'generation': 1,
        'agentVersionAssetId': 'pinned-asset-1',
        'runtimeProfileKey': 'SERVER_CODEX',
        'configHash':
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'state': 'PENDING',
      },
      'content': 'private-prompt',
      'secretRef': 'private-secret-ref',
      'runtimeIsolationRef': '/private/runtime/root',
    };

    testWidgets(
      'Workspace -> page -> exact detail stays read-only and reports pending projection',
      (tester) async {
        final requests = <http.Request>[];
        await _pump(
          tester,
          const PlatformAgentInstallationWorkspacesPage(),
          _bff({
            'GET /api/v1/workspaces': (request) {
              requests.add(request);
              return jsonResponse([
                {'id': 'workspace-1', 'slug': 'ops', 'name': 'Ops'},
              ]);
            },
            'GET /api/v1/agent-installations': (request) {
              requests.add(request);
              expect(request.url.queryParameters, {
                'workspaceId': 'workspace-1',
                'offset': '0',
              });
              return jsonResponse({
                'installations': [installation],
              });
            },
            'GET /api/v1/agent-installations/installation-1': (request) {
              requests.add(request);
              return jsonResponse(installation);
            },
          }),
        );
        await tester.tap(
          find.byKey(
            const ValueKey('platform-installation-workspace-workspace-1'),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.textContaining('Being installed'), findsOneWidget);
        expect(find.textContaining('pinned-asset-1'), findsOneWidget);
        await tester.tap(
          find.byKey(const ValueKey('platform-installation-installation-1')),
        );
        await tester.pumpAndSettle();
        expect(
          find.byKey(const ValueKey('platform-installation-detail')),
          findsOneWidget,
        );
        expect(find.text('pinned-asset-1'), findsOneWidget);
        expect(find.text('agent-principal-1'), findsOneWidget);
        await tester.scrollUntilVisible(find.text('Projection pending'), 300);
        expect(find.text('Projection pending'), findsOneWidget);
        expect(find.text('SERVER_CODEX'), findsOneWidget);
        expect(find.text('Disabled channel binding'), findsOneWidget);
        for (final label in [
          'Install',
          'Run',
          'Create session',
          'Disable',
          'private-prompt',
          'private-secret-ref',
          '/private/runtime/root',
        ]) {
          expect(find.text(label), findsNothing);
        }
        expect(requests.length, 3);
        expect(requests.every((r) => r.method == 'GET'), isTrue);
        expect(
          requests.any((r) => r.url.path.startsWith('/api/v1/agent-versions/')),
          isFalse,
        );
      },
    );

    testWidgets(
      'authorized empty page continues with the original cursor, then previous rereads',
      (tester) async {
        final offsets = <String?>[];
        await _pump(
          tester,
          const PlatformAgentInstallationWorkspacesPage(),
          _bff({
            'GET /api/v1/workspaces': (_) => jsonResponse([
              {'id': 'workspace-1', 'slug': 'ops', 'name': 'Ops'},
            ]),
            'GET /api/v1/agent-installations': (request) {
              offsets.add(request.url.queryParameters['offset']);
              return jsonResponse(
                request.url.queryParameters['offset'] == '0'
                    ? {'installations': [], 'nextOffset': 9}
                    : {
                        'installations': [installation],
                      },
              );
            },
          }),
        );
        await tester.tap(find.text('Ops'));
        await tester.pumpAndSettle();
        expect(
          find.text('No installations you may read on this page.'),
          findsOneWidget,
        );
        await tester.tap(
          find.byKey(const ValueKey('platform-installations-next')),
        );
        await tester.pumpAndSettle();
        expect(find.textContaining('pinned-asset-1'), findsOneWidget);
        await tester.tap(
          find.byKey(const ValueKey('platform-installations-previous')),
        );
        await tester.pumpAndSettle();
        expect(offsets, ['0', '9', '0']);
      },
    );

    for (final (name, row) in <(String, Map<String, Object?>)>[
      ('cross Workspace', {...installation, 'workspaceId': 'workspace-other'}),
      ('unknown enum', {...installation, 'state': 'FUTURE_STATE'}),
      (
        'different version pin',
        {
          ...installation,
          'projection': {
            ...installation['projection']! as Map<String, Object>,
            'agentVersionAssetId': 'latest-instead-of-pin',
          },
        },
      ),
      (
        'different generation',
        {
          ...installation,
          'state': 'ACTIVE',
          'resourceState': 'ACTIVE',
          'activeProjectionGeneration': 2,
          'projection': {
            ...installation['projection']! as Map<String, Object>,
            'state': 'ACTIVE',
          },
        },
      ),
    ]) {
      testWidgets(
        '$name remains UNKNOWN and does not show a usable or empty page',
        (tester) async {
          await _pump(
            tester,
            const PlatformAgentInstallationWorkspacesPage(),
            _bff({
              'GET /api/v1/workspaces': (_) => jsonResponse([
                {'id': 'workspace-1', 'slug': 'ops', 'name': 'Ops'},
              ]),
              'GET /api/v1/agent-installations': (_) => jsonResponse({
                'installations': [row],
              }),
            }),
          );
          await tester.tap(find.text('Ops'));
          await tester.pumpAndSettle();
          expect(
            find.byKey(const ValueKey('platform-view-error')),
            findsOneWidget,
          );
          expect(find.textContaining('not known'), findsOneWidget);
          expect(find.textContaining('No installations'), findsNothing);
          expect(
            find.byKey(const ValueKey('platform-installation-installation-1')),
            findsNothing,
          );
        },
      );
    }

    for (final (name, reply, label) in [
      ('bare403', jsonResponse(null, 403), 'Not allowed'),
      ('bare404', jsonResponse(null, 404), 'Not available here'),
      (
        'explicitUNKNOWN',
        jsonResponse(errorBody('UNKNOWN', 'PERMISSION_DENIED'), 403),
        'not known',
      ),
      (
        'futureClass',
        jsonResponse(errorBody('FUTURE_CLASS', 'PERMISSION_DENIED'), 403),
        'not known',
      ),
      ('unclassified503', jsonResponse(null, 503), 'not known'),
    ]) {
      testWidgets(
        '$name keeps the actual read conclusion, not an empty installation list',
        (tester) async {
          await _pump(
            tester,
            const PlatformAgentInstallationWorkspacesPage(),
            _bff({
              'GET /api/v1/workspaces': (_) => jsonResponse([
                {'id': 'workspace-1', 'slug': 'ops', 'name': 'Ops'},
              ]),
              'GET /api/v1/agent-installations': (_) => reply,
            }),
          );
          await tester.tap(find.text('Ops'));
          await tester.pumpAndSettle();
          expect(find.textContaining(label), findsOneWidget);
          expect(find.textContaining('No installations'), findsNothing);
          if (label == 'not known') {
            expect(find.textContaining('PERMISSION_DENIED'), findsNothing);
          }
        },
      );
    }

    testWidgets(
      'Chinese management uses the same source labels and renders no write buttons',
      (tester) async {
        await _pump(
          tester,
          const PlatformAgentInstallationWorkspacesPage(),
          _bff({
            'GET /api/v1/workspaces': (_) => jsonResponse([
              {'id': 'workspace-1', 'slug': 'ops', 'name': 'Ops'},
            ]),
            'GET /api/v1/agent-installations': (_) => jsonResponse({
              'installations': [installation],
            }),
          }),
          locale: const Locale('zh', 'CN'),
        );
        await tester.tap(find.text('Ops'));
        await tester.pumpAndSettle();
        expect(find.textContaining('正在安装'), findsOneWidget);
        expect(find.textContaining('精确版本引用'), findsOneWidget);
        expect(find.textContaining('不证明进程此刻健康'), findsOneWidget);
        for (final label in ['安装', '运行', '创建会话', '停用']) {
          expect(find.widgetWithText(FilledButton, label), findsNothing);
        }
      },
    );

    // 已实现的 Memory GET / autoDispose / Navigator 消费边界，复用原 MockClient。
    group('Memory read-only', () {
      final resourceId = installation['resourceId']! as String;
      final workspaceId = installation['workspaceId']! as String;
      final prefix = '/api/v1/agent-installations/$resourceId/memory';
      final scope = {
        'installationResourceId': resourceId,
        'workspaceId': workspaceId,
        'operationId': sessionView()['platformSessionId'],
      };
      final emptyPage = {...scope, 'state': 'COMPLETE', 'entries': <Object>[]};
      const body = '核心 🐝';
      final found = {
        ...scope,
        'slug': 'core',
        'state': 'FOUND',
        'eventId': _otherDevice,
        'createdAt': 1700000000,
        'content': body,
        'contentBytes': utf8.encode(body).length,
      };

      testWidgets(
        'detail opens metadata only; explicit body close/reopen makes a fresh GET',
        (tester) async {
          final requests = <http.Request>[];
          var coreReads = 0;
          await _pump(
            tester,
            PlatformAgentInstallationDetailPage(
              workspaceId: workspaceId,
              resourceId: resourceId,
            ),
            _bff({
              'GET /api/v1/agent-installations/$resourceId': (request) {
                requests.add(request);
                return jsonResponse(installation);
              },
              'GET $prefix/entries': (request) {
                requests.add(request);
                return jsonResponse({
                  ...emptyPage,
                  'entries': [
                    {
                      'slug': 'mem/profile',
                      'eventId': _thisDevice,
                      'createdAt': 1700000000,
                      'tombstone': false,
                    },
                  ],
                });
              },
              'GET $prefix/core': (request) {
                requests.add(request);
                coreReads++;
                final content = '$body $coreReads';
                return jsonResponse({
                  ...found,
                  'createdAt': 1700000000 + coreReads,
                  'eventId': coreReads == 1 ? _otherDevice : _thisDevice,
                  'content': content,
                  'contentBytes': utf8.encode(content).length,
                });
              },
              'GET $prefix/entry': (request) {
                requests.add(request);
                expect(request.url.queryParameters, {'slug': 'mem/profile'});
                return jsonResponse({
                  ...found,
                  'slug': 'mem/profile',
                  'eventId': _thisDevice,
                });
              },
            }),
          );
          expect(requests.length, 1);
          expect(
            requests.any((request) => request.url.path.contains('/memory/')),
            isFalse,
          );
          await tester.scrollUntilVisible(
            find.byKey(const ValueKey('platform-installation-memory')),
            300,
          );
          await tester.pumpAndSettle();
          await tester.tap(
            find.byKey(const ValueKey('platform-installation-memory')),
          );
          await tester.pumpAndSettle();
          expect(requests.map((request) => request.url.path), [
            '/api/v1/agent-installations/$resourceId',
            '$prefix/entries',
          ]);
          expect(
            find.byKey(const ValueKey('platform-memory-content')),
            findsNothing,
          );
          await tester.tap(
            find.byKey(const ValueKey('platform-memory-open-core')),
          );
          await tester.pumpAndSettle();
          expect(find.text('$body 1'), findsOneWidget);
          await tester.tap(find.byKey(const ValueKey('platform-memory-close')));
          await tester.pumpAndSettle();
          expect(find.text('$body 1'), findsNothing);
          expect(
            requests
                .where((request) => request.url.path == '$prefix/entries')
                .length,
            1,
          );
          await tester.tap(
            find.byKey(const ValueKey('platform-memory-open-core')),
          );
          await tester.pumpAndSettle();
          expect(coreReads, 2);
          expect(find.text('$body 1'), findsNothing);
          expect(find.text('$body 2'), findsOneWidget);
          await tester.tap(find.byKey(const ValueKey('platform-memory-close')));
          await tester.pumpAndSettle();
          await tester.scrollUntilVisible(
            find.byKey(const ValueKey('platform-memory-entry-mem/profile')),
            200,
          );
          await tester.pumpAndSettle();
          await tester.tap(
            find.byKey(const ValueKey('platform-memory-entry-mem/profile')),
          );
          await tester.pumpAndSettle();
          expect(find.text(body), findsOneWidget);
          expect(requests.every((request) => request.method == 'GET'), isTrue);
          // 路由离开销毁正文；重新打开也不自动取 core/entry。
          Navigator.of(
            tester.element(find.byType(PlatformAgentMemoryPage)),
          ).pop();
          await tester.pumpAndSettle();
          expect(
            find.byKey(const ValueKey('platform-memory-content')),
            findsNothing,
          );
          expect(find.byType(PlatformAgentMemoryPage), findsNothing);
          expect(requests.length, 5);
          final prefs = await SharedPreferences.getInstance();
          expect(prefs.getKeys(), {'platform.config.v1'});
        },
      );

      for (final (name, changes) in <(String, Map<String, Object?>)>[
        (
          'foreign Installation',
          {'installationResourceId': 'other-installation'},
        ),
        ('foreign Workspace', {'workspaceId': 'other-workspace'}),
        ('foreign slug', {'slug': 'mem/other'}),
        ('unknown state', {'state': 'FUTURE_STATE'}),
        ('missing head', {'eventId': null, 'createdAt': null}),
        ('unpaired head', {'createdAt': null}),
        ('invalid head', {'eventId': 'not-a-native-id'}),
        ('negative native time', {'createdAt': -1}),
        ('missing content', {'content': null}),
        ('UTF-16 instead of UTF-8 bytes', {'contentBytes': body.length}),
        ('negative bytes', {'contentBytes': -1}),
        ('absent with body', {'state': 'ABSENT'}),
        ('unreadable with body', {'state': 'UNREADABLE'}),
      ]) {
        testWidgets('$name never exposes body or confirmed absence', (
          tester,
        ) async {
          await _pump(
            tester,
            PlatformAgentMemoryPage(
              workspaceId: workspaceId,
              resourceId: resourceId,
            ),
            _bff({
              'GET $prefix/entries': (_) => jsonResponse(emptyPage),
              'GET $prefix/core': (_) => jsonResponse({...found, ...changes}),
            }),
          );
          await tester.tap(
            find.byKey(const ValueKey('platform-memory-open-core')),
          );
          await tester.pumpAndSettle();
          expect(
            find.byKey(const ValueKey('platform-view-error')),
            findsOneWidget,
          );
          expect(
            find.byKey(const ValueKey('platform-memory-content')),
            findsNothing,
          );
          expect(find.text(body), findsNothing);
          expect(find.text('Confirmed absent'), findsNothing);
        });
      }

      for (final (state, head, label) in <(String, bool, String)>[
        ('ABSENT', false, 'Confirmed absent'),
        ('ABSENT', true, 'Confirmed absent'),
        ('UNREADABLE', false, 'Unreadable; absence is not confirmed'),
      ]) {
        testWidgets(
          '$state native head=$head keeps its exact read conclusion',
          (tester) async {
            await _pump(
              tester,
              PlatformAgentMemoryPage(
                workspaceId: workspaceId,
                resourceId: resourceId,
              ),
              _bff({
                'GET $prefix/entries': (_) => jsonResponse(emptyPage),
                'GET $prefix/core': (_) => jsonResponse({
                  ...scope,
                  'slug': 'core',
                  'state': state,
                  if (head) 'eventId': _otherDevice,
                  if (head) 'createdAt': 1700000000,
                }),
              }),
            );
            await tester.tap(
              find.byKey(const ValueKey('platform-memory-open-core')),
            );
            await tester.pumpAndSettle();
            expect(find.text(label), findsOneWidget);
            expect(
              find.byKey(const ValueKey('platform-view-error')),
              findsNothing,
            );
            expect(
              find.byKey(const ValueKey('platform-memory-content')),
              findsNothing,
            );
            expect(
              find.text('Tombstone'),
              head ? findsOneWidget : findsNothing,
            );
          },
        );
      }

      for (final (state, label) in [
        ('COMPLETE', 'Complete snapshot contains no cold entries.'),
        (
          'BOUND_EXCEEDED',
          'Native enumeration bound exceeded; completeness is not confirmed.',
        ),
        ('UNKNOWN', 'Listing is unknown; this is not an empty inventory.'),
      ]) {
        testWidgets(
          '$state empty tuple array is not mislabeled as empty inventory',
          (tester) async {
            await _pump(
              tester,
              PlatformAgentMemoryPage(
                workspaceId: workspaceId,
                resourceId: resourceId,
              ),
              _bff({
                'GET $prefix/entries': (_) =>
                    jsonResponse({...emptyPage, 'state': state}),
              }),
            );
            expect(find.text(label), findsOneWidget);
            if (state != 'COMPLETE') {
              expect(
                find.text('Complete snapshot contains no cold entries.'),
                findsNothing,
              );
            }
            expect(
              find.byKey(const ValueKey('platform-memory-content')),
              findsNothing,
            );
          },
        );
      }

      for (final (name, page) in <(String, Map<String, Object?>)>[
        (
          'foreign listing scope',
          {...emptyPage, 'workspaceId': 'other-workspace'},
        ),
        ('unknown listing state', {...emptyPage, 'state': 'FUTURE_STATE'}),
        (
          'unsafe slug',
          {
            ...emptyPage,
            'entries': [
              {
                'slug': 'mem/../secret',
                'eventId': _thisDevice,
                'createdAt': 1700000000,
                'tombstone': false,
              },
            ],
          },
        ),
        (
          'duplicate slug',
          {
            ...emptyPage,
            'entries': [
              for (final eventId in [_thisDevice, _otherDevice])
                {
                  'slug': 'mem/profile',
                  'eventId': eventId,
                  'createdAt': 1700000000,
                  'tombstone': false,
                },
            ],
          },
        ),
      ]) {
        testWidgets('$name is not a readable or empty listing', (tester) async {
          await _pump(
            tester,
            PlatformAgentMemoryPage(
              workspaceId: workspaceId,
              resourceId: resourceId,
            ),
            _bff({'GET $prefix/entries': (_) => jsonResponse(page)}),
          );
          expect(
            find.byKey(const ValueKey('platform-view-error')),
            findsOneWidget,
          );
          expect(
            find.text('Complete snapshot contains no cold entries.'),
            findsNothing,
          );
          expect(
            find.byKey(const ValueKey('platform-memory-entry-mem/profile')),
            findsNothing,
          );
        });
      }

      for (final (reply, label) in [
        (jsonResponse(null, 403), 'Not allowed'),
        (jsonResponse(null, 404), 'Not available here'),
        (
          jsonResponse(errorBody('UNKNOWN', 'PERMISSION_DENIED'), 403),
          'not known',
        ),
      ]) {
        testWidgets('Memory GET keeps the BFF read refusal $label', (
          tester,
        ) async {
          await _pump(
            tester,
            PlatformAgentMemoryPage(
              workspaceId: workspaceId,
              resourceId: resourceId,
            ),
            _bff({'GET $prefix/entries': (_) => reply}),
          );
          expect(find.textContaining(label), findsOneWidget);
          expect(
            find.text('Complete snapshot contains no cold entries.'),
            findsNothing,
          );
        });
      }
    });
  });
}
