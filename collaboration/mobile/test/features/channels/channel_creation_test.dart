import 'dart:convert';

import 'package:buzz/features/channels/channel.dart';
import 'package:buzz/features/channels/channel_management_actions.dart';
import 'package:buzz/features/channels/channel_management_provider.dart';
import 'package:buzz/features/channels/channels_page.dart';
import 'package:buzz/features/channels/channels_provider.dart';
import 'package:buzz/shared/auth/auth.dart';
import 'package:buzz/shared/platform/platform_api.dart';
import 'package:buzz/shared/platform/platform_config.dart';
import 'package:buzz/shared/platform/platform_oidc.dart';
import 'package:buzz/shared/platform/platform_views.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../shared/platform/platform_test_support.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<SharedPreferences> preferences() async {
    SharedPreferences.setMockInitialValues({});
    return SharedPreferences.getInstance();
  }

  test('fresh missing create permission never sends a write', () async {
    final server = _Server()..canCreate = false;
    final harness = await _Harness.start(server, await preferences());
    addTearDown(harness.container.dispose);
    final actions = await harness.actions;
    await expectLater(
      actions.createChannel(
        name: 'release-notes',
        channelType: 'stream',
        visibility: 'open',
      ),
      throwsA(isA<PlatformApiError>()),
    );
    expect(server.posts, isEmpty);
    expect(actions.pendingCommand, isNull);
  });

  test(
    'POST response loss survives restart and reconciles exact bytes once',
    () async {
      final server = _Server()..losePostResponse = true;
      final prefs = await preferences();
      final first = await _Harness.start(server, prefs);
      final actions = await first.actions;
      await expectLater(
        actions.createChannel(
          name: 'release-notes',
          channelType: 'stream',
          visibility: 'open',
          description: 'Shipping',
          ttlSeconds: 604800,
        ),
        throwsA(isA<PlatformUnavailable>()),
      );
      final frozen = server.posts.single;
      expect(
        prefs.getKeys().where(
          (key) => key.startsWith('platform.channel-create.v1:'),
        ),
        hasLength(1),
      );
      first.container.dispose();

      final resumed = await _Harness.start(server, prefs);
      addTearDown(resumed.container.dispose);
      final original = await resumed.actions;
      expect(jsonEncode(original.pendingCommand!.toJson()), frozen);
      await expectLater(
        original.createChannel(
          name: 'different',
          channelType: 'stream',
          visibility: 'private',
        ),
        throwsA(isA<ChannelCreationPending>()),
      );
      expect(server.posts, hasLength(1));
      server.losePostResponse = false;
      await expectLater(
        original.recheckCreation(),
        throwsA(isA<ChannelCreationPending>()),
      );
      expect(server.posts, [frozen, frozen]);
      server.completed = true;
      final channel = await original.recheckCreation();
      expect(channel.id, _Server.target);
      expect(server.posts, hasLength(2));
      expect(original.pendingCommand, isNull);
      expect(
        prefs.getKeys().where(
          (key) => key.startsWith('platform.channel-create.v1:'),
        ),
        isEmpty,
      );
    },
  );

  test(
    'known receipt rechecks GET only; denied observation keeps original intent',
    () async {
      final server = _Server();
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      final actions = await harness.actions;
      await expectLater(
        actions.createChannel(
          name: 'release-notes',
          channelType: 'stream',
          visibility: 'private',
        ),
        throwsA(isA<ChannelCreationPending>()),
      );
      final frozen = actions.pendingCommand!.idempotencyKey;
      server.taskDenied = true;
      await expectLater(
        actions.recheckCreation(),
        throwsA(isA<PlatformApiError>()),
      );
      expect(actions.pendingCommand!.idempotencyKey, frozen);
      await expectLater(
        actions.createChannel(
          name: 'new',
          channelType: 'stream',
          visibility: 'open',
        ),
        throwsA(isA<ChannelCreationPending>()),
      );
      expect(server.posts, hasLength(1));
    },
  );

  test(
    'task operation mismatch cannot confirm or clear the original',
    () async {
      final server = _Server();
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      final actions = await harness.actions;
      await expectLater(
        actions.createChannel(
          name: 'release-notes',
          channelType: 'stream',
          visibility: 'open',
        ),
        throwsA(isA<ChannelCreationPending>()),
      );
      server.completed = true;
      server.taskOperation = 'unrelated-operation';
      await expectLater(actions.recheckCreation(), throwsFormatException);
      expect(actions.pendingCommand, isNotNull);
      expect(server.posts, hasLength(1));
    },
  );

  test(
    'completed workflow needs exact active member workspace and native roster',
    () async {
      final server = _Server()..completed = true;
      final harness = await _Harness.start(
        server,
        await preferences(),
        nativeVisible: false,
      );
      addTearDown(harness.container.dispose);
      final actions = await harness.actions;
      server.workspaceId = 'same-name-unrelated-workspace';
      await expectLater(
        actions.createChannel(
          name: 'release-notes',
          channelType: 'stream',
          visibility: 'open',
        ),
        throwsA(isA<ChannelCreationPending>()),
      );
      server.workspaceId = _Server.target;
      server.isMember = false;
      await expectLater(
        actions.recheckCreation(),
        throwsA(isA<ChannelCreationPending>()),
      );
      server.isMember = true;
      await expectLater(
        actions.recheckCreation(),
        throwsA(isA<ChannelCreationPending>()),
      );
      final native =
          harness.container.read(channelsProvider.notifier) as _Channels;
      native.visible = true;
      final channel = await actions.recheckCreation();
      expect(channel.id, _Server.target);
      expect(server.posts, hasLength(1));
    },
  );

  test(
    'unknown task observation never becomes completed despite all resources visible',
    () async {
      final server = _Server()
        ..completed = true
        ..observation = 'PROJECTION_DELAYED';
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      final actions = await harness.actions;
      await expectLater(
        actions.createChannel(
          name: 'release-notes',
          channelType: 'stream',
          visibility: 'open',
        ),
        throwsA(isA<ChannelCreationPending>()),
      );
      server.observation = 'EXTERNAL_RESULT_UNKNOWN';
      await expectLater(
        actions.recheckCreation(),
        throwsA(isA<ChannelCreationPending>()),
      );
      expect(actions.pendingCommand, isNotNull);
    },
  );

  test('actor switch cannot consume another actors persisted intent', () async {
    final server = _Server()..losePostResponse = true;
    final prefs = await preferences();
    final first = await _Harness.start(server, prefs);
    final actions = await first.actions;
    await expectLater(
      actions.createChannel(
        name: 'release-notes',
        channelType: 'stream',
        visibility: 'open',
      ),
      throwsA(isA<PlatformUnavailable>()),
    );
    first.container.dispose();
    final other = await _Harness.start(
      server,
      prefs,
      principal: 'other-principal',
    );
    addTearDown(other.container.dispose);
    expect((await other.actions).pendingCommand, isNull);
    expect(server.posts, hasLength(1));
    expect(
      prefs.getKeys().where(
        (key) => key.startsWith('platform.channel-create.v1:'),
      ),
      hasLength(1),
    );
  });

  testWidgets(
    'original launcher opens original form; accepted action stays pending',
    (tester) async {
      final server = _Server();
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      await harness.actions;
      await harness.container.read(channelCreateRoleProvider.future);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: harness.container,
          child: MaterialApp(
            theme: AppTheme.light(),
            home: const Scaffold(
              body: ChannelQuickActionsLauncher(
                visible: true,
                navigationBarHeight: 56,
                navigationBarBottomGap: 16,
                navigationBarWidth: 180,
                systemBottomInset: 0,
                rightInset: 16,
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.byTooltip('Create or start conversation'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('quick-action-new-dm-card')), findsNothing);
      expect(
        find.byKey(const Key('quick-action-browse-channels-card')),
        findsNothing,
      );
      await tester.tap(
        find.byKey(const Key('quick-action-create-channel-card')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('create-channel-type-ongoing')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('create-channel-visibility-public')),
        findsOneWidget,
      );
      await tester.enterText(
        find.byKey(const Key('create-channel-name')),
        'release-notes',
      );
      await tester.pump();
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('create-channel-outcome')), findsOneWidget);
      expect(find.byKey(const Key('create-channel-recheck')), findsOneWidget);
      expect(server.posts, hasLength(1));
      final pendingName = tester.widget<TextField>(
        find.byKey(const Key('create-channel-name')),
      );
      expect(pendingName.enabled, isFalse);
      expect(pendingName.controller!.text, 'release-notes');
      final outcome = tester.widget<Text>(
        find.byKey(const Key('create-channel-outcome')),
      );
      expect(
        outcome.style!.color,
        AppTheme.light().colorScheme.onSurfaceVariant,
      );
      Navigator.of(
        tester.element(find.byKey(const Key('create-channel-name'))),
      ).pop();
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Create or start conversation'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const Key('quick-action-create-channel-card')),
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('create-channel-name')))
            .controller!
            .text,
        'release-notes',
      );
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('create-channel-name')))
            .enabled,
        isFalse,
      );
      expect(find.byKey(const Key('create-channel-outcome')), findsOneWidget);
      final taskReadsBeforeRecheck = server.taskReads;
      await tester.ensureVisible(
        find.byKey(const Key('create-channel-recheck')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('create-channel-recheck')));
      await tester.pumpAndSettle();
      expect(server.posts, hasLength(1));
      expect(server.taskReads, taskReadsBeforeRecheck + 1);
    },
  );
}

class _Server {
  static const execution = '00000000-0000-4000-8000-000000000021';
  static const operation = '00000000-0000-4000-8000-000000000022';
  static const target = '00000000-0000-4000-8000-000000000023';
  bool canCreate = true;
  bool losePostResponse = false;
  bool taskDenied = false;
  bool completed = false;
  bool isMember = true;
  String taskOperation = operation;
  String workspaceId = target;
  String? observation;
  int taskReads = 0;
  String principal = sessionView()['tenantPrincipalId']! as String;
  final posts = <String>[];

  Map<String, Object?> get actor => {
    ...sessionView(),
    'tenantPrincipalId': principal,
  };
  Future<http.Response> respond(http.Request request) async {
    switch (request.url.path) {
      case '/api/v1/session':
        return jsonResponse(actor);
      case '/api/v1/role-workspaces':
        return jsonResponse({
          'workspaces': [],
          if (canCreate) 'createActionKey': 'workspace.create',
        });
      case '/api/v1/actions':
        posts.add(request.body);
        if (losePostResponse) {
          throw http.ClientException('Response lost after POST');
        }
        return jsonResponse({
          'actionExecutionId': execution,
          'operationId': operation,
          'actionKey': 'workspace.create',
          'gateState': 'ALLOWED',
          'dispatchState': 'DISPATCHED',
          'workflowId': 'original-workflow',
        }, 202);
      case '/api/v1/tasks/$execution':
        taskReads += 1;
        if (taskDenied) {
          return jsonResponse(errorBody('DENIED', 'SCOPE_GUARD_FAILED'), 403);
        }
        return jsonResponse({
          'actionExecutionId': execution,
          'operationId': taskOperation,
          'actionKey': 'workspace.create',
          'actionVersion': 1,
          'targetId': target,
          'createdAt': '2026-10-12T00:00:00Z',
          'gateState': 'ALLOWED',
          'dispatchState': 'DISPATCHED',
          'workflowKind': 'WORKSPACE_LIFECYCLE',
          'workflowId': 'original-workflow',
          'taskStatus': completed ? 'COMPLETED' : 'RUNNING',
          if (observation != null) 'observation': observation,
        });
      case '/api/v1/workspaces':
        return jsonResponse([
          {
            'id': workspaceId,
            'name': 'release-notes',
            'slug': (jsonDecode(posts.last) as Map<String, dynamic>)['slug'],
            'isMember': isMember,
          },
        ]);
      default:
        throw StateError(
          'Unexpected request ${request.method} ${request.url.path}',
        );
    }
  }
}

class _Harness {
  _Harness(this.container);
  final ProviderContainer container;
  Future<ChannelActions> get actions =>
      container.read(channelActionsProvider.future);
  static Future<_Harness> start(
    _Server server,
    SharedPreferences prefs, {
    bool nativeVisible = true,
    String? principal,
  }) async {
    if (principal != null) server.principal = principal;
    final session = NativeSession(
      client: MockClient(server.respond),
      refreshStore: MemoryRefreshStore(),
    );
    await session.adopt(
      const OidcTokens(
        accessToken: 'fixture-access',
        refreshToken: 'fixture-refresh',
      ),
    );
    final container = ProviderContainer(
      overrides: [
        savedPrefsProvider.overrideWithValue(prefs),
        platformConfigProvider.overrideWith(_Config.new),
        authProvider.overrideWith(_Auth.new),
        currentPubkeyProvider.overrideWithValue('fixture-pubkey'),
        nativeSessionProvider.overrideWithValue(session),
        platformSessionViewProvider.overrideWith(
          (ref) => PlatformSessionView.fromJson(server.actor),
        ),
        relaySessionProvider.overrideWith(_Relay.new),
        channelsProvider.overrideWith(() => _Channels(nativeVisible)),
      ],
    );
    await container.read(authProvider.future);
    return _Harness(container);
  }
}

class _Config extends PlatformConfigNotifier {
  @override
  PlatformConfig? build() => testPlatformConfig;
}

class _Auth extends AuthNotifier {
  @override
  Future<AuthState> build() async => AuthState(
    status: AuthStatus.authenticated,
    community: Community(
      id: 'fixture-tenant-community',
      name: 'Fixture',
      relayUrl: 'https://relay.test',
      addedAt: DateTime(2026),
    ),
  );
}

class _Relay extends RelaySessionNotifier {
  @override
  SessionState build() => const SessionState(status: SessionStatus.connected);
}

class _Channels extends ChannelsNotifier {
  _Channels(this.visible);
  bool visible;
  List<Channel> get channels => [
    if (visible)
      Channel(
        id: _Server.target,
        name: 'release-notes',
        channelType: 'stream',
        visibility: 'private',
        description: '',
        createdBy: 'control',
        createdAt: DateTime(2026),
        memberCount: 1,
        isMember: true,
      ),
  ];
  @override
  Future<List<Channel>> build() async => channels;
  @override
  Future<void> refresh() async => state = AsyncData(channels);
}
