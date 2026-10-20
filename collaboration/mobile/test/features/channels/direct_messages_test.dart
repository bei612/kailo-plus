import 'dart:convert';

import 'package:buzz/features/channels/channel.dart';
import 'package:buzz/features/channels/channel_management_provider.dart';
import 'package:buzz/features/channels/channels_page.dart';
import 'package:buzz/features/channels/channels_provider.dart';
import 'package:buzz/features/channels/channel_actions_sheet.dart';
import 'package:buzz/features/channels/unread_badge/unread_badge_provider.dart';
import 'package:buzz/features/channels/direct_messages.dart';
import 'package:buzz/shared/auth/auth.dart';
import 'package:buzz/shared/platform/platform_api.dart';
import 'package:buzz/shared/platform/platform_config.dart';
import 'package:buzz/shared/platform/platform_oidc.dart';
import 'package:buzz/shared/platform/platform_views.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:buzz/shared/read_state/read_state_provider.dart';
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nostr/nostr.dart' as nostr;
import 'package:shared_preferences/shared_preferences.dart';

import '../../shared/platform/platform_test_support.dart';

part 'direct_message_preferences_cases.dart';
part 'workspace_preferences_cases.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  Future<SharedPreferences> preferences() async {
    SharedPreferences.setMockInitialValues({});
    return SharedPreferences.getInstance();
  }

  mutePreferenceCases(preferences);
  starPreferenceCases(preferences);

  test(
    'fresh HUMAN directory maps multiple keys to two people, not three',
    () async {
      final server = _Server();
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      final dm = await harness.dm;
      final directory = await dm.directory();
      expect(directory.people, hasLength(2));
      expect(directory.people.first.pubkeys, hasLength(2));
      expect(directory.maxParticipants, 2);
      final hydrated = await dm.hydrate([server.native(raw: true)]);
      expect(hydrated.single.memberCount, 2);
      expect(
        hydrated.single.displayLabel(currentPubkey: server.client.public),
        'Bob',
      );
    },
  );

  test('ambiguous keys and repeated participant cursors fail closed', () async {
    final server = _Server()..ambiguous = true;
    final harness = await _Harness.start(server, await preferences());
    addTearDown(harness.container.dispose);
    final dm = await harness.dm;
    await expectLater(dm.directory(), throwsFormatException);
    server.ambiguous = false;
    server.repeatedCursor = true;
    await expectLater(dm.directory(), throwsFormatException);
    expect(server.posts, isEmpty);
  });

  test(
    'unavailable recipient or own second key cannot become another HUMAN',
    () async {
      final server = _Server();
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      final dm = await harness.dm;
      await expectLater(
        dm.openDm(principalIds: [server.principal]),
        throwsFormatException,
      );
      await expectLater(
        dm.openDm(principalIds: ['not-a-current-human']),
        throwsFormatException,
      );
      expect(server.posts, isEmpty);
      expect(dm.pendingCommand, isNull);
    },
  );

  test(
    'lost POST survives restart; explicit reconciliation uses exact bytes/key',
    () async {
      final server = _Server()..losePost = true;
      final prefs = await preferences();
      final first = await _Harness.start(server, prefs);
      final dm = await first.dm;
      await expectLater(
        dm.openDm(principalIds: [_Server.bob]),
        throwsA(isA<PlatformUnavailable>()),
      );
      final frozen = server.posts.single;
      first.container.dispose();
      final resumed = await _Harness.start(server, prefs);
      addTearDown(resumed.container.dispose);
      final original = await resumed.dm;
      expect(jsonEncode(original.pendingCommand!.toJson()), frozen);
      await expectLater(
        original.openDm(principalIds: [_Server.bob]),
        throwsA(isA<DirectMessagePending>()),
      );
      expect(server.posts, [frozen]);
      server.losePost = false;
      await expectLater(
        original.recheck(),
        throwsA(isA<DirectMessagePending>()),
      );
      expect(server.posts, [frozen, frozen]);
      server.completed = true;
      expect((await original.recheck()).id, _Server.target);
      expect(server.posts, [frozen, frozen]);
      expect(original.pendingCommand, isNull);
      expect(
        prefs.getKeys().where(
          (key) => key.startsWith('platform.conversation-open.v1:'),
        ),
        isEmpty,
      );
    },
  );

  test(
    'known receipt uses GET only; mismatched operation or UNKNOWN remains pending',
    () async {
      final server = _Server();
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      final dm = await harness.dm;
      await expectLater(
        dm.openDm(principalIds: [_Server.bob]),
        throwsA(isA<DirectMessagePending>()),
      );
      final key = dm.pendingCommand!.idempotencyKey;
      server.completed = true;
      server.taskOperation = 'different-operation';
      await expectLater(dm.recheck(), throwsFormatException);
      server.taskOperation = _Server.operation;
      server.observation = 'EXTERNAL_RESULT_UNKNOWN';
      await expectLater(dm.recheck(), throwsA(isA<DirectMessagePending>()));
      server.observation = null;
      server.taskDenied = true;
      await expectLater(dm.recheck(), throwsA(isA<PlatformApiError>()));
      expect(server.posts, hasLength(1));
      expect(dm.pendingCommand!.idempotencyKey, key);
    },
  );

  test(
    'completed AE plus original ACTIVE binding and exact native roster confirms existing DM',
    () async {
      final server = _Server()..completed = true;
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      final dm = await harness.dm;
      final channel = await dm.openDm(principalIds: [_Server.bob]);
      expect(channel.isDm, isTrue);
      expect(channel.participantPrincipalIds, [server.principal, _Server.bob]);
      expect(server.binding['operationId'], isNot(_Server.operation));
      expect(server.published, isEmpty);
      expect(dm.pendingCommand, isNull);
    },
  );

  test(
    'wrong participant set, inactive binding or native roster never claims creation',
    () async {
      final server = _Server()..completed = true;
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      final dm = await harness.dm;
      server.wrongParticipants = true;
      await expectLater(
        dm.openDm(principalIds: [_Server.bob]),
        throwsA(isA<DirectMessagePending>()),
      );
      server.wrongParticipants = false;
      server.bindingState = 'RECONCILING';
      await expectLater(dm.recheck(), throwsA(isA<DirectMessagePending>()));
      server.bindingState = 'ACTIVE';
      server.wrongRoster = true;
      server.hidden = true;
      await expectLater(dm.recheck(), throwsA(isA<DirectMessagePending>()));
      expect(server.published, isEmpty);
      expect(dm.pendingCommand, isNotNull);
    },
  );

  test(
    'personal reopen persists exact signed h-only event across lost OK/restart',
    () async {
      final server = _Server()
        ..completed = true
        ..hidden = true
        ..losePublish = true;
      final prefs = await preferences();
      final first = await _Harness.start(server, prefs);
      final dm = await first.dm;
      await expectLater(
        dm.openDm(principalIds: [_Server.bob]),
        throwsA(isA<StateError>()),
      );
      final original = server.published.single;
      expect(original.kind, 41010);
      expect(original.pubkey, server.client.public);
      expect(original.tags, [
        ['h', _Server.target],
      ]);
      expect(original.content, isEmpty);
      expect(nostr.Event.fromMap(original.toJson()).isValid(), isTrue);
      first.container.dispose();
      final resumed = await _Harness.start(server, prefs);
      addTearDown(resumed.container.dispose);
      server.losePublish = false;
      final recovered = await resumed.dm;
      expect((await recovered.recheck()).id, _Server.target);
      expect(server.published, hasLength(2));
      expect(server.published.last.toJson(), original.toJson());
      expect(server.posts, hasLength(1));
      expect(recovered.pendingCommand, isNull);
    },
  );

  test(
    'reopen applied but OK lost is observed, not republished after restart',
    () async {
      final server = _Server()
        ..completed = true
        ..hidden = true
        ..losePublish = true
        ..applyBeforeLostOk = true;
      final prefs = await preferences();
      final first = await _Harness.start(server, prefs);
      await expectLater(
        (await first.dm).openDm(principalIds: [_Server.bob]),
        throwsA(isA<StateError>()),
      );
      first.container.dispose();
      final resumed = await _Harness.start(server, prefs);
      addTearDown(resumed.container.dispose);
      expect((await (await resumed.dm).recheck()).id, _Server.target);
      expect(server.published, hasLength(1));
      expect(server.posts, hasLength(1));
    },
  );

  test(
    'identity switch cannot consume previous actor persisted intent',
    () async {
      final server = _Server();
      final prefs = await preferences();
      final first = await _Harness.start(server, prefs);
      final old = await first.dm;
      await expectLater(
        old.openDm(principalIds: [_Server.bob]),
        throwsA(isA<DirectMessagePending>()),
      );
      first.container.dispose();
      server.principal = '00000000-0000-4000-8000-000000000099';
      final resumed = await _Harness.start(server, prefs);
      addTearDown(resumed.container.dispose);
      expect((await resumed.dm).pendingCommand, isNull);
      expect(
        prefs.getKeys().where(
          (key) => key.startsWith('platform.conversation-open.v1:'),
        ),
        hasLength(1),
      );
      await expectLater(old.recheck(), throwsA(isA<PlatformUnavailable>()));
      expect(server.posts, hasLength(1));
    },
  );

  test(
    'NIP-DV validates signature, relay owner and exact viewer before hiding',
    () {
      final server = _Server()..hidden = true;
      final event = server.visibility;
      expect(
        hiddenDirectMessages(
          [event],
          relayPubkey: server.relay.public,
          viewer: server.client.public,
        ),
        {_Server.target},
      );
      expect(
        () => hiddenDirectMessages(
          [event],
          relayPubkey: server.relay.public,
          viewer: server.peer.public,
        ),
        throwsFormatException,
      );
      expect(
        () => hiddenDirectMessages(
          [event],
          relayPubkey: server.peer.public,
          viewer: server.client.public,
        ),
        throwsFormatException,
      );
      final tampered = NostrEvent.fromJson({
        ...event.toJson(),
        'content': 'tampered',
      });
      expect(
        () => hiddenDirectMessages(
          [tampered],
          relayPubkey: server.relay.public,
          viewer: server.client.public,
        ),
        throwsA(anything),
      );
    },
  );

  testWidgets(
    'opened recipient sheet closes on actor change without reusing selection',
    (tester) async {
      final server = _Server();
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      await harness.dm;
      await harness.container.read(conversationDirectoryProvider.future);
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
                navigationBarWidth: 224,
                systemBottomInset: 0,
                rightInset: 16,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('quick-actions-surface')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('quick-action-new-dm-card')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('new-dm-person-${_Server.bob}')));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('new-dm-selected-${_Server.bob}')),
        findsOneWidget,
      );
      server.principal = '00000000-0000-4000-8000-000000000099';
      harness.container.invalidate(platformSessionViewProvider);
      await harness.container.read(platformSessionViewProvider.future);
      await harness.dm;
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('new-dm-search')), findsNothing);
      expect(server.posts, isEmpty);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'ordinary HUMAN sees original New DM card and recipient keyboard submission',
    (tester) async {
      final server = _Server();
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      await harness.dm;
      await harness.container.read(conversationDirectoryProvider.future);
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
                navigationBarWidth: 224,
                systemBottomInset: 0,
                rightInset: 16,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('quick-actions-surface')));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('quick-action-create-channel-card')),
        findsNothing,
      );
      await tester.tap(find.byKey(const Key('quick-action-new-dm-card')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('new-dm-person-${_Server.bob}')));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('new-dm-selected-${_Server.bob}')),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('new-dm-search')));
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
      expect(server.posts, hasLength(1));
      expect(find.byKey(const Key('new-dm-check-status')), findsOneWidget);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('new-dm-search')))
            .enabled,
        isFalse,
      );
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}

class _Server {
  static const bob = '00000000-0000-4000-8000-000000000010';
  static const target = '00000000-0000-4000-8000-000000000020';
  static const workspace = '00000000-0000-4000-8000-000000000030';
  static const execution = 'original-dm-execution';
  static const operation = 'current-dm-operation';
  final client = nostr.Keys('01'.padLeft(64, '0'));
  final secondClient = nostr.Keys('02'.padLeft(64, '0'));
  final peer = nostr.Keys('03'.padLeft(64, '0'));
  final relay = nostr.Keys('04'.padLeft(64, '0'));
  String principal = sessionView()['tenantPrincipalId']! as String;
  String taskOperation = operation;
  String bindingState = 'ACTIVE';
  String? observation;
  bool completed = false;
  bool losePost = false;
  bool taskDenied = false;
  bool ambiguous = false;
  bool repeatedCursor = false;
  bool wrongParticipants = false;
  bool wrongRoster = false;
  bool hidden = false;
  bool losePublish = false;
  bool applyBeforeLostOk = false;
  bool muted = false;
  bool starred = true;
  int preferenceVersion = 0;
  int? snapshotVersion;
  bool loseMute = false;
  bool applyMuteBeforeLost = false;
  bool failPreferenceRead = false;
  bool conflictMute = false;
  int? rejectMuteStatus;
  bool workspaceMember = true;
  bool workspaceVisible = true;
  bool wrongWorkspaceRoster = false;
  bool workspaceArchived = false;
  bool includeWorkspace = false;
  bool workspaceMuted = true;
  bool workspaceStarred = false;
  bool loseStar = false;
  bool applyStarBeforeLost = false;
  int? rejectStarStatus;
  final mutePuts = <String>[];
  final starPuts = <String>[];
  final readPuts = <String>[];
  final readContexts = <String, String>{};
  bool loseRead = false;
  final history = <NostrEvent>[];
  final live = <void Function(NostrEvent)>[];
  final posts = <String>[];
  final published = <NostrEvent>[];
  Map<String, Object?> get actor => {
    ...sessionView(),
    'tenantPrincipalId': principal,
  };
  List<String> get keys => [client.public, secondClient.public, peer.public];
  Map<String, Object?> get binding => {
    'id': target,
    'channelId': target,
    'version': 1,
    'state': bindingState,
    'operationId': 'original-binding-creation-operation',
    'participantPrincipalIds': [
      principal,
      wrongParticipants ? 'another-human' : bob,
    ],
  };
  NostrEvent event(int kind, List<List<String>> tags) => NostrEvent.fromJson(
    nostr.Event.from(
      kind: kind,
      content: '',
      tags: tags,
      secretKey: nostr.Nip19.decode(payload: relay.nsec).data,
      createdAt: 1760000000,
    ).toMap(),
  );
  NostrEvent get metadata => event(39000, [
    ['d', target],
    ['name', 'DM'],
    ['t', 'dm'],
    ['private'],
    for (final key in keys) ['p', key],
  ]);
  NostrEvent get roster => event(39002, [
    ['d', target],
    for (final key in wrongRoster ? [client.public, peer.public] : keys)
      ['p', key],
  ]);
  NostrEvent get visibility => event(30622, [
    ['d', client.public],
    ['p', client.public],
    if (hidden) ['h', target],
  ]);
  NostrEvent get workspaceMetadata => event(39000, [
    ['d', workspace],
    ['name', 'Workspace'],
    ['t', 'stream'],
    ['private'],
    if (workspaceArchived) ['archived', 'true'],
  ]);
  NostrEvent get workspaceRoster => event(39002, [
    ['d', workspace],
    if (!wrongWorkspaceRoster) ['p', client.public],
    ['p', peer.public],
  ]);
  Channel nativeWorkspace() => Channel(
    id: workspace,
    name: 'Workspace',
    channelType: 'stream',
    visibility: 'private',
    description: '',
    createdBy: relay.public,
    createdAt: DateTime(2026),
    isMember: true,
    memberCount: 2,
  );
  Channel native({bool raw = false}) => Channel(
    id: target,
    name: 'DM',
    channelType: 'dm',
    visibility: 'private',
    description: '',
    createdBy: relay.public,
    createdAt: DateTime(2026),
    isMember: true,
    memberCount: raw ? 3 : 2,
    participants: raw ? [] : ['Tester', 'Bob'],
    participantPubkeys: raw ? keys : [client.public, peer.public],
    participantPrincipalIds: raw ? [] : [principal, bob],
  );
  Future<http.Response> respond(http.Request request) async {
    switch (request.url.path) {
      case '/api/v1/session':
        return jsonResponse(actor);
      case '/api/v1/role-workspaces':
        return jsonResponse({'workspaces': []});
      case '/api/v1/conversation-participants':
        return jsonResponse({
          'maxParticipants': 2,
          'items': [
            {
              'principalId': principal,
              'displayName': 'Tester',
              'pubkeys': [client.public, secondClient.public],
            },
            {
              'principalId': bob,
              'displayName': 'Bob',
              'pubkeys': [ambiguous ? client.public : peer.public],
            },
          ],
          if (repeatedCursor) 'nextCursor': 'same-cursor',
        });
      case '/api/v1/conversations':
        return jsonResponse({
          'items': [binding],
        });
      case '/api/v1/workspaces':
        return jsonResponse([
          if (workspaceVisible)
            {
              'id': workspace,
              'name': 'Workspace',
              'slug': 'workspace',
              'isMember': workspaceMember,
              'visibility': 'private',
            },
        ]);
      case '/api/v1/user-state':
        if (failPreferenceRead) throw http.ClientException('read unavailable');
        return jsonResponse({
          'version': snapshotVersion ?? preferenceVersion,
          'conversationPreferences': {
            target: {'muted': muted, 'starred': starred},
          },
          'readContexts': readContexts,
          'workspacePreferences': {
            workspace: {'muted': workspaceMuted, 'starred': workspaceStarred},
          },
          'projectPreferences': {},
        });
      case '/api/v1/user-state/read':
        final read = ReadMarkRequest.fromJson(jsonDecode(request.body));
        readPuts.add(request.body);
        if (loseRead) throw const PlatformUnavailable('Read response lost');
        if (!workspaceMember || read.contextKey != workspace) {
          return jsonResponse(null, 403);
        }
        if (read.version != preferenceVersion) return jsonResponse(null, 409);
        readContexts[read.contextKey] = read.lastReadAt;
        return jsonResponse({'version': ++preferenceVersion});
      case '/api/v1/user-state/conversations/$target':
        expect(request.method, 'PUT');
        mutePuts.add(request.body);
        if (rejectMuteStatus != null) {
          return http.Response('', rejectMuteStatus!);
        }
        final preference = ConversationPreferenceRequest.fromJson(
          jsonDecode(request.body),
        );
        if (conflictMute || preference.version != preferenceVersion) {
          return http.Response('', 409);
        }
        if (loseMute && !applyMuteBeforeLost) {
          throw http.ClientException('lost preference response');
        }
        muted = preference.muted;
        starred = preference.starred;
        ++preferenceVersion;
        if (loseMute) throw http.ClientException('lost committed response');
        return jsonResponse({'version': preferenceVersion});
      case '/api/v1/user-state/workspaces/$workspace':
        expect(request.method, 'PUT');
        starPuts.add(request.body);
        if (rejectStarStatus != null) {
          return http.Response('', rejectStarStatus!);
        }
        final preference = WorkspacePreferenceRequest.fromJson(
          jsonDecode(request.body),
        );
        if (preference.version != preferenceVersion) {
          return http.Response('', 409);
        }
        if (loseStar && !applyStarBeforeLost) {
          throw http.ClientException('lost star response');
        }
        workspaceMuted = preference.muted;
        workspaceStarred = preference.starred;
        ++preferenceVersion;
        if (loseStar) {
          throw http.ClientException('lost committed star response');
        }
        return jsonResponse({'version': preferenceVersion});
      case '/api/v1/actions':
        posts.add(request.body);
        if (losePost) throw http.ClientException('lost after POST');
        return jsonResponse({
          'actionExecutionId': execution,
          'operationId': operation,
          'actionKey': 'conversation.open',
          'gateState': 'ALLOWED',
          'dispatchState': 'DISPATCHED',
          'workflowId': 'original-conversation-projection',
        }, 202);
      case '/api/v1/tasks/$execution':
        if (taskDenied) {
          return jsonResponse(errorBody('DENIED', 'SCOPE_GUARD_FAILED'), 403);
        }
        return jsonResponse({
          'actionExecutionId': execution,
          'operationId': taskOperation,
          'actionKey': 'conversation.open',
          'actionVersion': 1,
          'targetId': target,
          'createdAt': '2026-10-12T00:00:00Z',
          'gateState': 'ALLOWED',
          'dispatchState': 'DISPATCHED',
          'workflowId': 'original-conversation-projection',
          'workflowKind': 'CONVERSATION_PROJECTION',
          'taskStatus': completed ? 'COMPLETED' : 'RUNNING',
          if (observation != null) 'observation': observation,
        });
      default:
        throw StateError('Unexpected ${request.method} ${request.url.path}');
    }
  }
}

class _Harness {
  const _Harness(this.container);
  final ProviderContainer container;
  Future<DirectMessages> get dm =>
      container.read(directMessagesProvider.future);
  static Future<_Harness> start(
    _Server server,
    SharedPreferences prefs, {
    bool realChannels = false,
  }) async {
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
        myPubkeyProvider.overrideWithValue(server.client.public),
        relayConfigProvider.overrideWith(
          () => _ConfigRelay(server.client.nsec),
        ),
        nativeSessionProvider.overrideWithValue(session),
        platformSessionViewProvider.overrideWith(
          (ref) => PlatformSessionView.fromJson(server.actor),
        ),
        relaySessionProvider.overrideWith(() => _Relay(server)),
        if (!realChannels)
          channelsProvider.overrideWith(() => _Channels(server)),
        appLifecycleProvider.overrideWith(_Lifecycle.new),
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

class _ConfigRelay extends RelayConfigNotifier {
  _ConfigRelay(this.nsec);
  final String nsec;
  @override
  RelayConfig build() => RelayConfig(baseUrl: 'https://relay.test', nsec: nsec);
}

class _Auth extends AuthNotifier {
  @override
  Future<AuthState> build() async => AuthState(
    status: AuthStatus.authenticated,
    community: Community(
      id: 'fixture-community',
      name: 'Fixture',
      relayUrl: 'https://relay.test',
      addedAt: DateTime(2026),
    ),
  );
}

class _Relay extends RelaySessionNotifier {
  _Relay(this.server);
  final _Server server;
  @override
  SessionState build() => const SessionState(status: SessionStatus.connected);
  @override
  Future<List<NostrEvent>> fetchHistory(
    NostrFilter filter, {
    Duration timeout = const Duration(seconds: 8),
  }) async {
    if (filter.kinds.contains(39000)) {
      return [
        for (final event in [
          server.metadata,
          if (server.includeWorkspace ||
              filter.tags['#d']?.contains(_Server.workspace) == true)
            server.workspaceMetadata,
        ])
          if (filter.tags['#d'] == null ||
              filter.tags['#d']!.contains(event.getTagValue('d')))
            event,
      ];
    }
    if (filter.kinds.contains(39002)) {
      return [
        for (final event in [server.roster, server.workspaceRoster])
          if (filter.tags['#d'] == null ||
              filter.tags['#d']!.contains(event.getTagValue('d')))
            event,
      ];
    }
    if (filter.kinds.contains(30622)) return [server.visibility];
    if (filter.kinds.any(EventKind.channelMessageEventKinds.contains)) {
      return server.history;
    }
    throw StateError('Unexpected native filter ${filter.kinds}');
  }

  @override
  Future<List<NostrEvent>> queryRelay(
    List<NostrFilter> filters, {
    Duration timeout = const Duration(seconds: 8),
  }) async => [
    for (final filter in filters)
      ...(await fetchHistory(filter, timeout: timeout)),
  ];

  @override
  Future<void Function()> subscribe(
    NostrFilter filter,
    void Function(NostrEvent) onEvent, {
    void Function(String)? onClosed,
  }) async {
    server.live.add(onEvent);
    return () => server.live.remove(onEvent);
  }

  @override
  Future<NostrEvent> publish(
    NostrEvent event, {
    Duration timeout = const Duration(seconds: 8),
  }) async {
    server.published.add(event);
    if (server.applyBeforeLostOk) server.hidden = false;
    if (server.losePublish) throw StateError('lost native OK');
    server.hidden = false;
    return event;
  }
}

class _Lifecycle extends AppLifecycleNotifier {
  @override
  AppLifecycleState build() => AppLifecycleState.resumed;
}

class _Channels extends ChannelsNotifier {
  _Channels(this.server);
  final _Server server;
  @override
  Future<List<Channel>> build() async => [
    server.native(),
    if (server.includeWorkspace) server.nativeWorkspace(),
  ];
  @override
  Future<void> refresh() async => state = AsyncData([
    server.native(),
    if (server.includeWorkspace) server.nativeWorkspace(),
  ]);
  @override
  List<ChannelMember> cachedMembersForChannel(String channelId) => [
    for (final key in server.keys)
      ChannelMember(pubkey: key, role: 'member', joinedAt: DateTime(2026)),
  ];
}
