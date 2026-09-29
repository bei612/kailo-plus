import 'dart:convert';

import 'package:buzz/features/platform/platform_tasks_page.dart';
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:buzz/shared/platform/platform_api.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../shared/platform/platform_test_support.dart';

const _workflow = 'kailo:APPROVAL:t1:ae1:1';

Map<String, dynamic> _task([Map<String, dynamic> over = const {}]) => {
  'operationId': 'op-1',
  'actionExecutionId': 'ae1',
  'actionKey': 'tenant.member.revoke',
  'actionVersion': 1,
  'targetId': 'tg1',
  'gateState': 'ALLOWED',
  'dispatchState': 'DISPATCHED',
  'createdAt': '2026-09-24T00:00:00Z',
  ...over,
};

Map<String, dynamic> _approval([Map<String, dynamic> over = const {}]) => {
  'workflowId': _workflow,
  'actionExecutionId': 'ae1',
  'actionKey': 'tenant.member.revoke',
  'targetType': 'tenant_membership',
  'targetId': 'tg1',
  'initiatorPrincipalId': 'p-init',
  'status': 'WAITING',
  'expiresAt': '2026-09-25T00:00:00Z',
  'decisions': <Object>[],
  'roleRequirements': [
    {'selector': 'TENANT_ADMIN', 'minDistinct': 1},
  ],
  ...over,
};

Future<List<String>> _pump(
  WidgetTester tester,
  Widget page,
  Map<String, Object? Function()> routes, {
  Locale locale = const Locale('en'),
}) async {
  final seen = <String>[];
  SharedPreferences.setMockInitialValues({
    'kailo.config.v1': jsonEncode(testKailoConfig.toJson()),
  });
  final prefs = await SharedPreferences.getInstance();
  final client = MockClient((request) async {
    final oidc = oidcRoutes(request, refreshed: 'access-1');
    if (oidc != null) return oidc;
    final key = '${request.method} ${Uri.decodeComponent(request.url.path)}';
    seen.add(key);
    final route = routes[key];
    return route == null ? jsonResponse(null, 404) : jsonResponse(route());
  });
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        savedPrefsProvider.overrideWithValue(prefs),
        kailoHttpClientProvider.overrideWithValue(client),
        kailoSessionProvider.overrideWithValue(
          KailoSession(
            client: client,
            refreshStore: MemoryRefreshStore()..value = 'refresh-1',
          ),
        ),
      ],
      child: MaterialApp(
        theme: AppTheme.light(),
        locale: locale,
        supportedLocales: const [Locale('en'), Locale('zh', 'CN')],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: page,
      ),
    ),
  );
  await tester.pumpAndSettle();
  return seen;
}

void main() {
  test('结果不明与投影落后不说成功也不说失败；只有 COMPLETED 才是完成', () {
    TaskView t(Map<String, dynamic> over) => TaskView.fromJson(_task(over));
    expect(
      kailoTaskPhase(
        t({
          'workflowId': 'w',
          'taskStatus': 'COMPLETED',
          'observation': 'EXTERNAL_RESULT_UNKNOWN',
        }),
      ),
      startsWith('Outcome not known yet'),
    );
    expect(
      kailoTaskPhase(
        t({
          'workflowId': 'w',
          'taskStatus': 'FAILED',
          'observation': 'PROJECTION_DELAYED',
        }),
      ),
      startsWith('Status may be out of date'),
    );
    expect(kailoTaskPhase(t({'workflowId': 'w'})), 'Started');
    expect(
      kailoTaskPhase(t({'workflowId': 'w', 'taskStatus': 'COMPLETED'})),
      'Completed',
    );
    expect(kailoTaskPhase(t({})), 'Applied');
    expect(kailoTaskPhase(t({'gateState': 'WAITING'})), 'Waiting for approval');
  });

  testWidgets('tasks: list → detail with its approval; read-only', (
    tester,
  ) async {
    final seen = await _pump(tester, const KailoTasksPage(), {
      'GET /api/v1/tasks': () => [
        _task({
          'gateState': 'WAITING',
          'dispatchState': 'NOT_DISPATCHED',
          'reason': 'WAITING_APPROVAL',
          'approvalWorkflowId': _workflow,
        }),
      ],
      'GET /api/v1/tasks/ae1': () => _task({
        'gateState': 'WAITING',
        'dispatchState': 'NOT_DISPATCHED',
        'reason': 'WAITING_APPROVAL',
        'approvalWorkflowId': _workflow,
      }),
      'GET /api/v1/approvals/$_workflow': () => _approval(),
    });

    expect(find.textContaining('Waiting for approval'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('kailo-task-ae1')));
    await tester.pumpAndSettle();

    expect(find.text('op-1'), findsOneWidget);
    expect(
      find.text('Waiting for approval. (WAITING_APPROVAL)'),
      findsOneWidget,
    );
    expect(find.text('Organization admin: at least 1'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('kailo-decide-elsewhere')),
      findsOneWidget,
    );
    // 只读：没有任何写请求，也没有控制按钮
    expect(seen.where((k) => !k.startsWith('GET ')), isEmpty);
    expect(find.byType(TextButton), findsNothing);
    expect(find.byType(FilledButton), findsNothing);
  });

  testWidgets(
    'approvals: pending list, and a delayed projection is not a verdict',
    (tester) async {
      await _pump(tester, const KailoApprovalsPage(), {
        'GET /api/v1/approvals': () => [
          _approval({'observation': 'PROJECTION_DELAYED'}),
        ],
        'GET /api/v1/approvals/$_workflow': () =>
            _approval({'observation': 'PROJECTION_DELAYED'}),
      });

      expect(find.textContaining('Status may be out of date'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('kailo-approval-$_workflow')));
      await tester.pumpAndSettle();
      expect(
        find.text('The status shown may be out of date. (PROJECTION_DELAYED)'),
        findsOneWidget,
      );
      expect(find.textContaining('Waiting for decisions'), findsNothing);
    },
  );

  testWidgets('a failed read is not an empty list', (tester) async {
    await _pump(tester, const KailoTasksPage(), {});
    expect(
      find.text('You have not started any governed action yet.'),
      findsNothing,
    );
    expect(find.byKey(const ValueKey('kailo-view-error')), findsOneWidget);
  });

  testWidgets('task and approval read-only text follows zh-CN locale', (
    tester,
  ) async {
    await _pump(tester, const KailoTasksPage(), {
      'GET /api/v1/tasks': () => [
        _task({'gateState': 'WAITING'}),
      ],
      'GET /api/v1/tasks/ae1': () => _task({'gateState': 'WAITING'}),
    }, locale: const Locale('zh', 'CN'));

    expect(find.text('我的任务'), findsOneWidget);
    expect(find.textContaining('等待审批'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('kailo-task-ae1')));
    await tester.pumpAndSettle();
    expect(find.text('任务'), findsOneWidget);
    expect(find.text('状态'), findsOneWidget);
    expect(find.text('等待审批'), findsOneWidget);
  });
}
