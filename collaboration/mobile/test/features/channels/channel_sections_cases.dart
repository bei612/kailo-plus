part of 'direct_messages_test.dart';

// DD-150(3): channel mute is the Workspace preference and custom sections are
// Core `sidebar_sections`, both personal version-CAS writes (never actions).
void channelSectionCases(Future<SharedPreferences> Function() preferences) {
  Future<ChannelSectionsNotifier> sectionsReady(_Harness harness) async {
    await harness.dm;
    final notifier = harness.container.read(channelSectionsProvider.notifier);
    await notifier.refresh();
    return notifier;
  }

  test(
    'channel Mute writes the workspace preference and keeps Star as read',
    () async {
      final server = _Server()
        ..workspaceMuted = false
        ..workspaceStarred = true;
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      await harness.dm;
      final notifier = harness.container.read(
        collaborationPreferencesProvider.notifier,
      );
      await notifier.refresh();
      expect(
        harness.container
            .read(collaborationPreferencesProvider)
            .channelMuted(_Server.workspace, isDm: false),
        false,
      );
      await notifier.setWorkspaceMuted(_Server.workspace, true);
      expect(jsonDecode(server.starPuts.single), {
        'muted': true,
        'starred': true,
        'version': 0,
      });
      final state = harness.container.read(collaborationPreferencesProvider);
      expect(state.workspaceMuted(_Server.workspace), true);
      expect(state.starred(_Server.workspace), true);
      expect(server.mutePuts, isEmpty, reason: 'not the DM preference');
      expect(server.posts, isEmpty, reason: 'not a Governed Action');
    },
  );

  test(
    'create, assign, rename, reorder and delete sections through Core CAS',
    () async {
      final server = _Server();
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      final notifier = await sectionsReady(harness);
      ChannelSectionsState read() =>
          harness.container.read(channelSectionsProvider);
      expect(read().isReady, true);
      expect(read().sections, isEmpty);

      final first = await notifier.createSection('  Focus  ');
      expect(first, isNotNull);
      expect(read().sections.single.name, 'Focus');
      expect(read().sections.single.order, 0);
      final second = await notifier.createSection('Later');
      expect(read().sections.map((row) => row.id), [first, second]);
      expect(read().sections.last.order, 1);

      expect(await notifier.assignChannel(_Server.workspace, second), true);
      expect(read().sectionOf(_Server.workspace), second);
      expect(
        jsonDecode(server.sectionRequests.last.split(' ').skip(2).join(' ')),
        {'channelKey': _Server.workspace, 'sectionId': second, 'version': 2},
      );

      expect(await notifier.renameSection(second!, 'Soon'), true);
      expect(read().sections.last.name, 'Soon');
      expect(read().sections.last.order, 1, reason: 'rename keeps order');

      expect(await notifier.moveSection(second, up: true), true);
      expect(read().sections.map((row) => row.id), [second, first]);
      expect(
        await notifier.moveSection(second, up: true),
        false,
        reason: 'already first: no request',
      );

      final before = server.sectionRequests.length;
      expect(await notifier.deleteSection(second), true);
      expect(server.sectionRequests.length, before + 1);
      expect(server.sectionRequests.last, startsWith('DELETE '));
      expect(read().sections.map((row) => row.id), [first]);
      expect(read().sectionOf(_Server.workspace), isNull);
      expect(server.posts, isEmpty, reason: 'not a Governed Action');
    },
  );

  test(
    'an unknown section write locks new writes; only recheck resends the same bytes',
    () async {
      final server = _Server()..loseSection = true;
      final prefs = await preferences();
      final harness = await _Harness.start(server, prefs);
      addTearDown(harness.container.dispose);
      final notifier = await sectionsReady(harness);
      expect(await notifier.createSection('Focus'), isNull);
      final original = server.sectionRequests.single;
      expect(harness.container.read(channelSectionsProvider).pending, true);
      expect(harness.container.read(channelSectionsProvider).sections, isEmpty);
      expect(
        prefs.getKeys().where(
          (key) => key.startsWith('platform.sidebar-section-intent.v1:'),
        ),
        hasLength(1),
      );

      await notifier.refresh();
      expect(await notifier.createSection('Other'), isNull);
      expect(server.sectionRequests, [original], reason: 'no new write');

      server.loseSection = false;
      await notifier.recheck();
      expect(server.sectionRequests, [original, original]);
      final state = harness.container.read(channelSectionsProvider);
      expect(state.pending, false);
      expect(state.sections.single.name, 'Focus');
      expect(
        prefs.getKeys().where(
          (key) => key.startsWith('platform.sidebar-section-intent.v1:'),
        ),
        isEmpty,
      );
    },
  );

  test(
    'a committed lost write is fenced by the advanced version, never resent',
    () async {
      final server = _Server()
        ..loseSection = true
        ..applySectionBeforeLost = true;
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      final notifier = await sectionsReady(harness);
      expect(await notifier.createSection('Focus'), isNull);
      server.loseSection = false;
      await notifier.recheck();
      expect(server.sectionRequests, hasLength(1));
      final state = harness.container.read(channelSectionsProvider);
      expect(state.pending, false);
      expect(state.sections.single.name, 'Focus');
    },
  );

  test('a definite refusal clears the intent and changes nothing', () async {
    final server = _Server()..rejectSectionStatus = 403;
    final prefs = await preferences();
    final harness = await _Harness.start(server, prefs);
    addTearDown(harness.container.dispose);
    final notifier = await sectionsReady(harness);
    expect(await notifier.assignChannel(_Server.workspace, null), false);
    final state = harness.container.read(channelSectionsProvider);
    expect(state.pending, false);
    expect(state.writable, true);
    expect(
      prefs.getKeys().where(
        (key) => key.startsWith('platform.sidebar-section-intent.v1:'),
      ),
      isEmpty,
    );
  });
}
