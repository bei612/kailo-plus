part of 'direct_messages_test.dart';

void mutePreferenceCases(Future<SharedPreferences> Function() preferences) {
  Future<CollaborationPreferenceNotifier> ready(_Harness harness) async {
    await harness.dm;
    final notifier = harness.container.read(
      collaborationPreferencesProvider.notifier,
    );
    await notifier.refresh();
    return notifier;
  }

  test(
    'DM mute/unmute uses confirmed CAS and preserves another-end starred',
    () async {
      final server = _Server();
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      final notifier = await ready(harness);
      expect(
        harness.container
            .read(collaborationPreferencesProvider)
            .muted(_Server.target),
        false,
      );
      server.starred = false;
      await notifier.setMuted(_Server.target, true);
      expect(jsonDecode(server.mutePuts.single), {
        'muted': true,
        'starred': false,
        'version': 0,
      });
      expect(
        harness.container
            .read(collaborationPreferencesProvider)
            .muted(_Server.target),
        true,
      );
      await notifier.setMuted(_Server.target, false);
      expect(server.preferenceVersion, 2);
      expect(server.starred, false);
      expect(
        harness.container.read(collaborationPreferencesProvider).pendingId,
        isNull,
      );
      expect(
        server.published,
        isEmpty,
        reason: 'No NIP78 preference authority',
      );
    },
  );

  test(
    'lost mute response persists; refresh never PUTs and explicit same-version recheck uses same bytes',
    () async {
      final server = _Server()..loseMute = true;
      final prefs = await preferences();
      final first = await _Harness.start(server, prefs);
      await (await ready(first)).setMuted(_Server.target, true);
      final original = server.mutePuts.single;
      expect(
        first.container.read(collaborationPreferencesProvider).pendingId,
        _Server.target,
      );
      expect(
        first.container
            .read(collaborationPreferencesProvider)
            .muted(_Server.target),
        isNull,
      );
      first.container.dispose();
      final resumed = await _Harness.start(server, prefs);
      addTearDown(resumed.container.dispose);
      final notifier = await ready(resumed);
      expect(server.mutePuts, [original]);
      server.failPreferenceRead = true;
      await notifier.recheck();
      expect(
        resumed.container.read(collaborationPreferencesProvider).pendingId,
        _Server.target,
      );
      expect(server.mutePuts, [original]);
      server.failPreferenceRead = false;
      await notifier.refresh();
      await notifier.setMuted(_Server.target, false);
      expect(server.mutePuts, [original]);
      server.loseMute = false;
      await notifier.recheck();
      expect(server.mutePuts, [original, original]);
      expect(
        resumed.container
            .read(collaborationPreferencesProvider)
            .muted(_Server.target),
        true,
      );
      expect(
        prefs.getKeys().where(
          (key) => key.startsWith('platform.conversation-preference.v1:'),
        ),
        isEmpty,
      );
    },
  );

  test(
    'committed-but-lost response and unrelated higher version never replay old CAS',
    () async {
      final server = _Server()
        ..loseMute = true
        ..applyMuteBeforeLost = true;
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      final notifier = await ready(harness);
      await notifier.setMuted(_Server.target, true);
      expect(
        harness.container.read(collaborationPreferencesProvider).pendingId,
        _Server.target,
      );
      server.starred = false;
      ++server.preferenceVersion;
      await notifier.recheck();
      expect(server.mutePuts, hasLength(1));
      expect(server.starred, false);
      expect(
        harness.container.read(collaborationPreferencesProvider).pendingId,
        isNull,
      );
      expect(
        harness.container
            .read(collaborationPreferencesProvider)
            .muted(_Server.target),
        true,
      );
    },
  );

  test(
    'old UNKNOWN survives same-version recheck 403 until authoritative version advances',
    () async {
      final server = _Server()..loseMute = true;
      final prefs = await preferences();
      final first = await _Harness.start(server, prefs);
      await (await ready(first)).setMuted(_Server.target, true);
      final original = server.mutePuts.single;
      first.container.dispose();
      server.loseMute = false;
      server.rejectMuteStatus = 403;
      final resumed = await _Harness.start(server, prefs);
      addTearDown(resumed.container.dispose);
      final notifier = await ready(resumed);
      await notifier.recheck();
      expect(server.mutePuts, [original, original]);
      expect(
        resumed.container.read(collaborationPreferencesProvider).pendingId,
        _Server.target,
      );
      expect(
        prefs.getKeys().where(
          (key) => key.startsWith('platform.conversation-preference.v1:'),
        ),
        isNotEmpty,
      );
      await notifier.setMuted(_Server.target, false);
      expect(server.mutePuts, [original, original]);
      ++server.preferenceVersion;
      await notifier.recheck();
      expect(server.mutePuts, [original, original]);
      expect(
        resumed.container.read(collaborationPreferencesProvider).pendingId,
        isNull,
      );
      expect(
        resumed.container
            .read(collaborationPreferencesProvider)
            .muted(_Server.target),
        false,
      );
    },
  );

  test(
    'failed original intent storage cannot PUT, including explicit recovery',
    () async {
      final server = _Server();
      final prefs = _FailingPreferences(await preferences());
      final harness = await _Harness.start(server, prefs);
      addTearDown(harness.container.dispose);
      final notifier = await ready(harness);
      await notifier.setMuted(_Server.target, true);
      expect(server.mutePuts, isEmpty);
      expect(
        harness.container.read(collaborationPreferencesProvider).pendingId,
        _Server.target,
      );
      await notifier.recheck();
      expect(server.mutePuts, isEmpty);
      prefs.failWrites = false;
      await notifier.recheck();
      expect(server.mutePuts, hasLength(1));
      expect(
        harness.container
            .read(collaborationPreferencesProvider)
            .muted(_Server.target),
        true,
      );
    },
  );

  test(
    'CAS conflict never auto overwrites; stale snapshot and revoked roster never permit PUT',
    () async {
      final server = _Server()..preferenceVersion = 3;
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      final notifier = await ready(harness);
      server.conflictMute = true;
      await notifier.setMuted(_Server.target, true);
      expect(server.mutePuts, hasLength(1));
      expect(
        harness.container.read(collaborationPreferencesProvider).pendingId,
        isNull,
      );
      server.snapshotVersion = 2;
      await notifier.refresh();
      expect(
        harness.container
            .read(collaborationPreferencesProvider)
            .muted(_Server.target),
        isNull,
      );
      await notifier.setMuted(_Server.target, true);
      expect(server.mutePuts, hasLength(1));
      server.snapshotVersion = null;
      server.conflictMute = false;
      await notifier.refresh();
      server.wrongRoster = true;
      await notifier.setMuted(_Server.target, true);
      expect(server.mutePuts, hasLength(1));
    },
  );

  test(
    'actor switch fences old pending intent; repeated tap writes only one CAS',
    () async {
      final server = _Server();
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      final notifier = await ready(harness);
      await Future.wait([
        notifier.setMuted(_Server.target, true),
        notifier.setMuted(_Server.target, true),
      ]);
      expect(server.mutePuts, hasLength(1));
      server.loseMute = true;
      await notifier.setMuted(_Server.target, false);
      server.principal = '00000000-0000-4000-8000-000000000099';
      harness.container.invalidate(platformSessionViewProvider);
      await harness.container.read(platformSessionViewProvider.future);
      await ready(harness);
      expect(
        harness.container.read(collaborationPreferencesProvider).pendingId,
        isNull,
      );
      expect(server.mutePuts, hasLength(2));
    },
  );

  testWidgets(
    'original DM action tile and list bellOff consume Core mute; an unadmitted channel mute stays inert',
    (tester) async {
      final server = _Server()..muted = true;
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      await ready(harness);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: harness.container,
          child: MaterialApp(
            theme: AppTheme.light(),
            home: Scaffold(
              body: ChannelActionsSheet(
                channel: server.native(),
                isUnread: false,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Unmute channel'), findsOneWidget);
      expect(
        tester
            .widget<ListTile>(find.byKey(const Key('channel-action-mute')))
            .onTap,
        isNotNull,
      );
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: harness.container,
          child: MaterialApp(
            theme: AppTheme.light(),
            home: Scaffold(
              body: ChannelActionsSheet(
                channel: Channel(
                  id: _Server.target,
                  name: 'Channel',
                  channelType: 'channel',
                  visibility: 'private',
                  description: '',
                  createdBy: server.relay.public,
                  createdAt: DateTime(2026),
                  memberCount: 2,
                ),
                isUnread: false,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      // DD-150(3): a Workspace channel's mute is its workspace preference; a
      // channel Core has not admitted has no readback, so the tile is inert.
      expect(
        tester
            .widget<ListTile>(find.byKey(const Key('channel-action-mute')))
            .onTap,
        isNull,
      );
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
      expect(
        find.byKey(const Key('channel-muted-${_Server.target}')),
        findsOneWidget,
      );
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  test(
    'real DM catch-up/live mute suppresses ordinary unread, keeps original own mention and unmute',
    () async {
      final server = _Server()..muted = true;
      NostrEvent message(String id, {bool mention = false}) => NostrEvent(
        id: id,
        pubkey: server.peer.public,
        createdAt: 1760000010,
        kind: 9,
        tags: [
          ['h', _Server.target],
          if (mention) ['p', server.client.public],
        ],
        content: 'message',
        sig: '',
      );
      server.history.add(message('catch-up-muted'));
      final harness = await _Harness.start(
        server,
        await preferences(),
        realChannels: true,
      );
      addTearDown(harness.container.dispose);
      final notifier = await ready(harness);
      await harness.container.read(channelsProvider.future);
      await Future<void>.delayed(Duration.zero);
      final channels = harness.container.read(channelsProvider.notifier);
      expect(channels.observedUnreadEventsByChannel[_Server.target], isNull);
      for (final callback in [...server.live]) {
        callback(message('live-muted'));
      }
      expect(channels.observedUnreadEventsByChannel[_Server.target], isNull);
      for (final callback in [...server.live]) {
        callback(message('live-mentioned', mention: true));
      }
      expect(channels.observedUnreadEventsByChannel[_Server.target]!.keys, [
        'live-mentioned',
      ]);
      expect(harness.container.read(unreadBadgeProvider).highPriorityCount, 1);
      await notifier.setMuted(_Server.target, false);
      for (final callback in [...server.live]) {
        callback(message('live-unmuted'));
      }
      expect(
        channels.observedUnreadEventsByChannel[_Server.target]!.keys,
        contains('live-unmuted'),
      );
      server.failPreferenceRead = true;
      await notifier.refresh();
      for (final callback in [...server.live]) {
        callback(message('unknown-not-unmuted'));
      }
      expect(
        channels.observedUnreadEventsByChannel[_Server.target]!.keys,
        isNot(contains('unknown-not-unmuted')),
      );
    },
  );
}

class _FailingPreferences extends Fake implements SharedPreferences {
  _FailingPreferences(this.inner);
  final SharedPreferences inner;
  bool failWrites = true;
  @override
  String? getString(String key) => inner.getString(key);
  @override
  Future<bool> setString(String key, String value) async =>
      failWrites ? false : await inner.setString(key, value);
  @override
  Future<bool> remove(String key) => inner.remove(key);
}
