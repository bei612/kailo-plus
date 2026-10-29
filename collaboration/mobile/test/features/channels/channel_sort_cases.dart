part of 'direct_messages_test.dart';

// DD-150(3): the original per-group sort (Recent / A–Z) is Core `sidebar_sort`,
// a personal version-CAS write (never an action), with the same frozen-request
// and unknown-outcome rules as the custom sections.
void channelSortCases(Future<SharedPreferences> Function() preferences) {
  Future<ChannelSortNotifier> sortReady(_Harness harness) async {
    await harness.dm;
    final notifier = harness.container.read(channelSortProvider.notifier);
    await notifier.refresh();
    return notifier;
  }

  test(
    'group sort reads the default and writes one Core CAS per change',
    () async {
      final server = _Server();
      final harness = await _Harness.start(server, await preferences());
      addTearDown(harness.container.dispose);
      final notifier = await sortReady(harness);
      ChannelSortState read() => harness.container.read(channelSortProvider);
      expect(read().isReady, true);
      expect(read().sortModeFor(kSortGroupChannels), ChannelSortMode.alpha);

      expect(
        await notifier.setSortModeFor(
          kSortGroupChannels,
          ChannelSortMode.recent,
        ),
        true,
      );
      expect(
        jsonDecode(server.sectionRequests.single.split(' ').skip(2).join(' ')),
        {'groupKey': 'channels', 'mode': 'recent', 'version': 0},
      );
      expect(read().sortModeFor(kSortGroupChannels), ChannelSortMode.recent);
      expect(read().sortModeFor(kSortGroupDms), ChannelSortMode.alpha);

      expect(
        await notifier.setSortModeFor(
          kSortGroupChannels,
          ChannelSortMode.recent,
        ),
        true,
        reason: 'already Recent',
      );
      expect(server.sectionRequests, hasLength(1), reason: 'no request');
      expect(
        await notifier.setSortModeFor(
          sectionSortGroupKey('gone'),
          ChannelSortMode.recent,
        ),
        false,
        reason: 'a deleted section is not a live group',
      );
      expect(server.sectionRequests, hasLength(1));
      expect(server.posts, isEmpty, reason: 'not a Governed Action');
    },
  );

  test(
    'an unknown sort write locks new writes; only recheck resends the same bytes',
    () async {
      final server = _Server()..loseSection = true;
      final prefs = await preferences();
      final harness = await _Harness.start(server, prefs);
      addTearDown(harness.container.dispose);
      final notifier = await sortReady(harness);
      expect(
        await notifier.setSortModeFor(kSortGroupDms, ChannelSortMode.recent),
        false,
      );
      final original = server.sectionRequests.single;
      expect(harness.container.read(channelSortProvider).pending, true);
      expect(
        harness.container.read(channelSortProvider).sortModeFor(kSortGroupDms),
        ChannelSortMode.alpha,
        reason: 'nothing optimistic',
      );
      expect(
        prefs.getKeys().where(
          (key) => key.startsWith('platform.sidebar-sort-intent.v1:'),
        ),
        hasLength(1),
      );
      expect(
        await notifier.setSortModeFor(
          kSortGroupStarred,
          ChannelSortMode.recent,
        ),
        false,
      );
      expect(server.sectionRequests, [original], reason: 'no new write');

      server.loseSection = false;
      await notifier.recheck();
      expect(server.sectionRequests, [original, original]);
      final state = harness.container.read(channelSortProvider);
      expect(state.pending, false);
      expect(state.sortModeFor(kSortGroupDms), ChannelSortMode.recent);
      expect(
        prefs.getKeys().where(
          (key) => key.startsWith('platform.sidebar-sort-intent.v1:'),
        ),
        isEmpty,
      );
    },
  );

  test('a definite refusal clears the frozen sort request', () async {
    final server = _Server()..rejectSectionStatus = 422;
    final prefs = await preferences();
    final harness = await _Harness.start(server, prefs);
    addTearDown(harness.container.dispose);
    final notifier = await sortReady(harness);
    expect(
      await notifier.setSortModeFor(kSortGroupChannels, ChannelSortMode.recent),
      false,
    );
    expect(harness.container.read(channelSortProvider).pending, false);
    expect(
      prefs.getKeys().where(
        (key) => key.startsWith('platform.sidebar-sort-intent.v1:'),
      ),
      isEmpty,
    );
  });

  test('sortChannelsForList orders Recent by last message, then by name', () {
    Channel channel(String id, String name, DateTime? last) => Channel(
      id: id,
      name: name,
      channelType: 'stream',
      visibility: 'open',
      description: '',
      createdBy: 'x',
      createdAt: DateTime(2026),
      isMember: true,
      memberCount: 1,
      lastMessageAt: last,
    );
    final list = [
      channel('a', 'beta', null),
      channel('b', 'Alpha', DateTime(2026, 1, 2)),
      channel('c', 'gamma', DateTime(2026, 1, 3)),
      channel('d', 'delta', null),
    ];
    expect(sortChannelsForList(list, ChannelSortMode.alpha).map((c) => c.id), [
      'b',
      'a',
      'd',
      'c',
    ]);
    expect(sortChannelsForList(list, ChannelSortMode.recent).map((c) => c.id), [
      'c',
      'b',
      'a',
      'd',
    ]);
  });
}
