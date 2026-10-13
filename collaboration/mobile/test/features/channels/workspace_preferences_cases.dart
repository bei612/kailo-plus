part of 'direct_messages_test.dart';

void starPreferenceCases(Future<SharedPreferences> Function() preferences) {
  Future<CollaborationPreferenceNotifier> ready(_Harness harness) async {
    await harness.dm;
    final notifier = harness.container.read(
      collaborationPreferencesProvider.notifier,
    );
    await notifier.refresh();
    return notifier;
  }

  test(
    'stream Star/Unstar preserves latest workspace mute and DM preferences through shared CAS',
    () async {
      final server = _Server();
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      final notifier = await ready(harness);
      server.workspaceMuted = false;
      await notifier.setStarred(_Server.workspace, true);
      expect(jsonDecode(server.starPuts.single), {
        'muted': false,
        'starred': true,
        'version': 0,
      });
      expect(
        harness.container
            .read(collaborationPreferencesProvider)
            .starred(_Server.workspace),
        true,
      );
      await notifier.setMuted(_Server.target, true);
      expect(jsonDecode(server.mutePuts.single), {
        'muted': true,
        'starred': true,
        'version': 1,
      });
      await notifier.setStarred(_Server.workspace, false);
      expect(jsonDecode(server.starPuts.last), {
        'muted': false,
        'starred': false,
        'version': 2,
      });
      expect(server.muted, true);
      expect(server.starred, true);
      expect(
        server.published,
        isEmpty,
        reason: 'No NIP78 preference authority',
      );
    },
  );

  test(
    'stream UNKNOWN survives restart and 403; same bytes replay only on explicit recheck',
    () async {
      final server = _Server()..loseStar = true;
      final prefs = await preferences();
      final first = await _Harness.start(server, prefs);
      await (await ready(first)).setStarred(_Server.workspace, true);
      final original = server.starPuts.single;
      expect(
        first.container
            .read(collaborationPreferencesProvider)
            .starred(_Server.workspace),
        isNull,
      );
      final key = prefs.getKeys().singleWhere(
        (key) => key.startsWith('platform.conversation-preference.v1:'),
      );
      expect(
        jsonDecode(prefs.getString(key)!)['workspaceId'],
        _Server.workspace,
      );
      first.container.dispose();
      final resumed = await _Harness.start(server, prefs);
      addTearDown(resumed.container.dispose);
      final notifier = await ready(resumed);
      await notifier.refresh();
      await notifier.setMuted(_Server.target, true);
      expect(server.starPuts, [original]);
      expect(server.mutePuts, isEmpty);
      server.loseStar = false;
      server.rejectStarStatus = 403;
      await notifier.recheck();
      expect(server.starPuts, [original, original]);
      expect(prefs.getString(key), isNotNull);
      expect(
        resumed.container.read(collaborationPreferencesProvider).pendingId,
        _Server.workspace,
      );
      ++server.preferenceVersion;
      await notifier.recheck();
      expect(server.starPuts, [original, original]);
      expect(prefs.getString(key), isNull);
      expect(
        resumed.container
            .read(collaborationPreferencesProvider)
            .starred(_Server.workspace),
        false,
      );
    },
  );

  test(
    'stream recovery never PUTs before original intent storage succeeds',
    () async {
      final server = _Server();
      final prefs = _FailingPreferences(await preferences());
      final harness = await _Harness.start(server, prefs);
      addTearDown(harness.container.dispose);
      final notifier = await ready(harness);
      await notifier.setStarred(_Server.workspace, true);
      await notifier.recheck();
      expect(server.starPuts, isEmpty);
      prefs.failWrites = false;
      await notifier.recheck();
      expect(server.starPuts, hasLength(1));
      expect(
        harness.container
            .read(collaborationPreferencesProvider)
            .starred(_Server.workspace),
        true,
      );
    },
  );

  test(
    'old v1 DM intent blocks stream writes and remains readable until shared version advances',
    () async {
      final server = _Server()..loseMute = true;
      final prefs = await preferences();
      final first = await _Harness.start(server, prefs);
      await (await ready(first)).setMuted(_Server.target, true);
      final key = prefs.getKeys().singleWhere(
        (key) => key.startsWith('platform.conversation-preference.v1:'),
      );
      final stored = prefs.getString(key)!;
      expect(jsonDecode(stored)['conversationId'], _Server.target);
      expect(jsonDecode(stored).containsKey('workspaceId'), false);
      first.container.dispose();
      final resumed = await _Harness.start(server, prefs);
      addTearDown(resumed.container.dispose);
      final notifier = await ready(resumed);
      await notifier.setStarred(_Server.workspace, true);
      expect(server.starPuts, isEmpty);
      expect(prefs.getString(key), stored);
      ++server.preferenceVersion;
      await notifier.refresh();
      await notifier.setStarred(_Server.workspace, true);
      expect(jsonDecode(server.starPuts.single)['version'], 1);
    },
  );

  test(
    'stream admission rejects revoked member, missing workspace, stale roster and archived metadata',
    () async {
      final server = _Server();
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      final notifier = await ready(harness);
      server.workspaceMember = false;
      await notifier.setStarred(_Server.workspace, true);
      expect(server.starPuts, isEmpty);
      server.workspaceMember = true;
      await notifier.refresh();
      server.workspaceVisible = false;
      await notifier.setStarred(_Server.workspace, true);
      expect(server.starPuts, isEmpty);
      server.workspaceVisible = true;
      await notifier.refresh();
      server.wrongWorkspaceRoster = true;
      await notifier.setStarred(_Server.workspace, true);
      expect(server.starPuts, isEmpty);
      server.wrongWorkspaceRoster = false;
      await notifier.refresh();
      server.workspaceArchived = true;
      await notifier.setStarred(_Server.workspace, true);
      expect(server.starPuts, isEmpty);
    },
  );

  test(
    'committed lost star readback and actor switch fence stale CAS without repeat PUT',
    () async {
      final server = _Server()
        ..loseStar = true
        ..applyStarBeforeLost = true;
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      final notifier = await ready(harness);
      await notifier.setStarred(_Server.workspace, true);
      await notifier.recheck();
      expect(server.starPuts, hasLength(1));
      expect(
        harness.container
            .read(collaborationPreferencesProvider)
            .starred(_Server.workspace),
        true,
      );
      server.loseStar = false;
      server.principal = '00000000-0000-4000-8000-000000000099';
      await notifier.setStarred(_Server.workspace, false);
      expect(server.starPuts, hasLength(1));
      expect(
        harness.container
            .read(collaborationPreferencesProvider)
            .starred(_Server.workspace),
        isNull,
      );
    },
  );

  testWidgets(
    'original stream quick action is confirmed Star/Unstar; DM has no Star and stream has no mute',
    (tester) async {
      final server = _Server();
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      await ready(harness);
      Widget sheet(Channel channel) => UncontrolledProviderScope(
        container: harness.container,
        child: MaterialApp(
          theme: AppTheme.light(),
          home: Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                key: const Key('open-channel-actions'),
                onPressed: () => showChannelActionsSheet(
                  context: context,
                  channel: channel,
                  isUnread: false,
                ),
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      );
      await tester.pumpWidget(sheet(server.nativeWorkspace()));
      await tester.tap(find.byKey(const Key('open-channel-actions')));
      await tester.pumpAndSettle();
      expect(find.text('Star'), findsOneWidget);
      expect(find.text('Mark Unread'), findsOneWidget);
      expect(find.byKey(const Key('channel-action-mute')), findsNothing);
      await tester.tap(find.text('Star'));
      await tester.pumpAndSettle();
      expect(server.starPuts, hasLength(1));
      expect(server.workspaceStarred, true);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpWidget(sheet(server.nativeWorkspace()));
      await tester.tap(find.byKey(const Key('open-channel-actions')));
      await tester.pumpAndSettle();
      expect(find.text('Unstar'), findsOneWidget);
      await tester.tap(find.text('Unstar'));
      await tester.pumpAndSettle();
      expect(server.workspaceStarred, false);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpWidget(sheet(server.native()));
      await tester.tap(find.byKey(const Key('open-channel-actions')));
      await tester.pumpAndSettle();
      expect(find.text('Star'), findsNothing);
      expect(find.text('Unstar'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: harness.container,
          child: MaterialApp(
            theme: AppTheme.light(),
            home: Scaffold(
              body: Builder(
                builder: (context) => Localizations.override(
                  context: context,
                  locale: const Locale('zh', 'CN'),
                  child: ChannelActionsSheet(
                    channel: server.nativeWorkspace(),
                    isUnread: true,
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('收藏'), findsOneWidget);
      expect(find.text('标为已读'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'original Starred section is stream-only exclusive, collapsible and returns channel on confirmed Unstar',
    (tester) async {
      final server = _Server()
        ..includeWorkspace = true
        ..workspaceStarred = true;
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      final notifier = await ready(harness);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: harness.container,
          child: MaterialApp(
            theme: AppTheme.light(),
            home: ChannelsPage(
              settingsPageBuilder: (_) => const SizedBox.shrink(),
              onSettingsTransitionProgress: (_) {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      Finder section(String title) => find.ancestor(
        of: find.text(title),
        matching: find.byWidgetPredicate(
          (widget) => widget.runtimeType.toString() == '_ChannelSection',
        ),
      );
      expect(find.text('Workspace'), findsOneWidget);
      expect(
        find.descendant(
          of: section('Starred'),
          matching: find.text('Workspace'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(of: section('Starred'), matching: find.text('Bob')),
        findsNothing,
      );
      expect(
        find.descendant(
          of: section('Channels'),
          matching: find.text('Workspace'),
        ),
        findsNothing,
      );
      await tester.tap(find.text('Starred'));
      await tester.pumpAndSettle();
      expect(find.text('Workspace').hitTestable(), findsNothing);
      await tester.tap(find.text('Starred'));
      await tester.pumpAndSettle();
      await notifier.setStarred(_Server.workspace, false);
      await tester.pumpAndSettle();
      expect(find.text('Starred'), findsNothing);
      expect(
        find.descendant(
          of: section('Channels'),
          matching: find.text('Workspace'),
        ),
        findsOneWidget,
      );
      expect(find.text('Workspace'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
