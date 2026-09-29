import 'dart:async';

import 'package:fake_async/fake_async.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:buzz/features/channels/channel_management_provider.dart';
import 'package:buzz/features/channels/channels_provider.dart';
import 'package:buzz/shared/relay/relay.dart';

part 'channels_provider_live_cases.dart';
part 'channels_provider_terminal_cases.dart';

/// Tests for [ChannelsNotifier] in the pure-Nostr world.
///
/// The provider loads membership-backed channels first:
///   1. paginated kind:39002 memberships tagged `#p:<my-pubkey>`
///   2. kind:39000 metadata for those channel ids
/// then layers chunked live subscriptions on the `#h` tag. Browse channels
/// separately triggers paginated kind:39000 open-channel discovery.
///
/// Tests stub out the relay session by overriding [relaySessionProvider] with
/// a [_FakeRelaySession] that returns canned events from [fetchHistory] and
/// records [subscribe] calls so we can assert filter shapes and emit live
/// events on demand.
void main() {
  const myPk = 'me';

  test(
    'paginates memberships when the relay caps responses below limit',
    () async {
      final firstPage = List.generate(
        100,
        (index) => _membership(
          '${index.toString().padLeft(8, '0')}-0000-4000-8000-000000000000',
          myPk,
        ),
      );
      final finalChannelId = '99999999-9999-4999-8999-999999999999';
      final finalMembership = _membership(finalChannelId, myPk);
      final session = _FakeRelaySession(
        memberships: const [],
        membershipPages: [
          firstPage,
          [finalMembership],
        ],
        metadata: [_meta(id: finalChannelId, name: 'last-membership')],
      );
      final container = _buildContainer(session: session);
      addTearDown(container.dispose);

      final channels = await container.read(channelsProvider.future);

      expect(channels.single.id, finalChannelId);
      expect(channels.single.isMember, isTrue);
      expect(session.membershipQueryFilters, hasLength(3));
      expect(session.membershipQueryFilters.first.until, isNull);
      expect(session.membershipQueryFilters.first.extensions, isEmpty);
      expect(session.membershipQueryFilters[1].until, firstPage.last.createdAt);
      expect(
        session.membershipQueryFilters[1].extensions['before_id'],
        firstPage.last.id,
      );
      expect(
        session.membershipQueryFilters.last.extensions['before_id'],
        finalMembership.id,
      );
    },
  );

  test('stops membership pagination when the relay repeats a page', () async {
    final repeatedPage = List.generate(
      500,
      (index) => _membership(
        '${index.toString().padLeft(8, '0')}-0000-4000-8000-000000000000',
        myPk,
      ),
    );
    final session = _FakeRelaySession(
      memberships: const [],
      membershipPages: [repeatedPage],
      repeatLastMembershipPage: true,
      maxMembershipPageRequests: 2,
    );
    final container = _buildContainer(session: session);
    addTearDown(container.dispose);

    expect(await container.read(channelsProvider.future), isEmpty);
    expect(session.membershipRequestCount, 2);
  });

  test('a newer ordinary refresh owns the installed membership list', () async {
    final session = _FakeRelaySession(
      memberships: [_membership(_channelA, myPk)],
      metadata: [_meta(id: _channelA, name: 'joined-a')],
    );
    final container = _buildContainer(session: session);
    addTearDown(container.dispose);

    await container.read(channelsProvider.future);

    session.pauseNextMemberCountQuery();
    final olderRefresh = container.read(channelsProvider.notifier).refresh();
    await session.nextMemberCountQueryStarted;

    session.memberships = [_membership(_channelB, myPk)];
    session.metadata = [_meta(id: _channelB, name: 'joined-b')];
    await container.read(channelsProvider.notifier).refresh();

    session.resumePausedMemberCountQuery();
    await olderRefresh;
    await _settle();

    expect(
      container
          .read(channelsProvider)
          .requireValue
          .map((channel) => channel.id),
      [_channelB],
      reason: 'an older ordinary refresh overwrote the newer membership list',
    );
    expect(session.activeChannels, {_channelB});
  });

  test(
    'a newer refresh owns the list over an older reconnect backstop',
    () async {
      final session = _FakeRelaySession(
        memberships: [_membership(_channelA, myPk)],
        metadata: [_meta(id: _channelA, name: 'joined-a')],
      );
      final container = _buildContainer(session: session);
      addTearDown(container.dispose);

      await container.read(channelsProvider.future);

      session.pauseNextMemberCountQuery();
      session.setStatus(SessionStatus.reconnecting);
      session.setStatus(SessionStatus.connected);
      await session.nextMemberCountQueryStarted;

      session.memberships = [_membership(_channelB, myPk)];
      session.metadata = [_meta(id: _channelB, name: 'joined-b')];
      await container.read(channelsProvider.notifier).refresh();

      session.resumePausedMemberCountQuery();
      await _settle();

      expect(
        container
            .read(channelsProvider)
            .requireValue
            .map((channel) => channel.id),
        [_channelB],
        reason:
            'an older reconnect backstop overwrote the newer membership list',
      );
      expect(session.activeChannels, {_channelB});
    },
  );

  test('an ordinary membership refresh retires an older catch-up', () async {
    final session = _FakeRelaySession(
      memberships: [_membership(_channelA, myPk)],
      metadata: [_meta(id: _channelA, name: 'joined-a')],
    );
    final container = _buildContainer(session: session);
    addTearDown(container.dispose);

    await container.read(channelsProvider.future);

    // Same relay, same identity. Only the refresh generation separates the
    // parked catch-up from the membership list the user is looking at, which
    // is the window the post-join membership refresh opens.
    session.recentMessages = const [
      NostrEvent(
        id: 'mention-in-a',
        pubkey: 'alice',
        createdAt: 50,
        kind: 9,
        tags: [
          ['h', _channelA],
          ['p', myPk],
        ],
        content: 'direct mention in channel A',
        sig: 'sig',
      ),
    ];
    session.pauseNextUnreadCatchUpQuery();
    final staleRefresh = container.read(channelsProvider.notifier).refresh();
    await session.nextUnreadCatchUpQueryStarted;

    session.memberships = [_membership(_channelB, myPk)];
    session.metadata = [_meta(id: _channelB, name: 'joined-b')];
    await container.read(channelsProvider.notifier).refresh();
    await _settle();

    session.resumePausedUnreadCatchUpQuery();
    await staleRefresh;
    await _settle();

    final notifier = container.read(channelsProvider.notifier);
    expect(
      notifier.latestObservedByChannel,
      isNot(contains(_channelA)),
      reason:
          'a superseded ordinary refresh wrote unread state for a channel the '
          'user has left: ${notifier.latestObservedByChannel}',
    );
    expect(
      notifier.observedUnreadEventsByChannel,
      isNot(contains(_channelA)),
      reason:
          'a superseded ordinary refresh wrote unread events for a channel the '
          'user has left: ${notifier.observedUnreadEventsByChannel}',
    );
  });

  test('a newer refresh retires a parked backstop catch-up', () async {
    final session = _FakeRelaySession(
      memberships: [_membership(_channelA, myPk)],
      metadata: [_meta(id: _channelA, name: 'joined-a')],
    );
    final container = _buildContainer(session: session);
    addTearDown(container.dispose);

    await container.read(channelsProvider.future);

    session.recentMessages = const [
      NostrEvent(
        id: 'mention-in-a',
        pubkey: 'alice',
        createdAt: 50,
        kind: 9,
        tags: [
          ['h', _channelA],
          ['p', myPk],
        ],
        content: 'direct mention in channel A',
        sig: 'sig',
      ),
    ];
    session.pauseNextUnreadCatchUpQuery();
    // Reconnecting runs the backstop refresh, which never fetches the
    // directory, so this is the path that carried no lifecycle token at all.
    session.setStatus(SessionStatus.reconnecting);
    session.setStatus(SessionStatus.connected);
    await session.nextUnreadCatchUpQueryStarted;

    session.memberships = [_membership(_channelB, myPk)];
    session.metadata = [_meta(id: _channelB, name: 'joined-b')];
    await container.read(channelsProvider.notifier).refresh();
    await _settle();

    session.resumePausedUnreadCatchUpQuery();
    await _settle();

    final notifier = container.read(channelsProvider.notifier);
    expect(
      notifier.latestObservedByChannel,
      isNot(contains(_channelA)),
      reason:
          'a superseded backstop refresh wrote unread state for a channel the '
          'user has left: ${notifier.latestObservedByChannel}',
    );
    expect(
      notifier.observedUnreadEventsByChannel,
      isNot(contains(_channelA)),
      reason:
          'a superseded backstop refresh wrote unread events for a channel the '
          'user has left: ${notifier.observedUnreadEventsByChannel}',
    );
  });

  test(
    'community switch discards a parked catch-up from an ordinary refresh',
    () async {
      final session = _FakeRelaySession(
        memberships: [_membership(_channelA, myPk)],
        metadata: [_meta(id: _channelA, name: 'community-a-general')],
      );
      final container = _buildContainer(session: session);
      addTearDown(container.dispose);

      await container.read(channelsProvider.future);

      session.recentMessages = const [
        NostrEvent(
          id: 'mention-in-a',
          pubkey: 'alice',
          createdAt: 50,
          kind: 9,
          tags: [
            ['h', _channelA],
            ['p', myPk],
          ],
          content: 'direct mention in community A',
          sig: 'sig',
        ),
      ];
      session.pauseNextUnreadCatchUpQuery();
      final staleRefresh = container.read(channelsProvider.notifier).refresh();
      await session.nextUnreadCatchUpQueryStarted;

      session.memberships = [_membership(_channelB, myPk)];
      session.metadata = [_meta(id: _channelB, name: 'community-b-general')];
      container
          .read(relayConfigProvider.notifier)
          .update(baseUrl: 'https://community-b.example');
      await container.read(channelsProvider.future);
      await _settle();

      session.resumePausedUnreadCatchUpQuery();
      await staleRefresh;
      await _settle();

      final notifier = container.read(channelsProvider.notifier);
      expect(
        notifier.latestObservedByChannel,
        isNot(contains(_channelA)),
        reason:
            'community A unread state landed in community B: '
            '${notifier.latestObservedByChannel}',
      );
    },
  );

  test(
    'identity switch discards a parked catch-up from an ordinary refresh',
    () async {
      final session = _FakeRelaySession(
        memberships: [_membership(_channelA, myPk)],
        metadata: [_meta(id: _channelA, name: 'first-identity-general')],
      );
      final container = _buildContainer(session: session);
      addTearDown(container.dispose);

      await container.read(channelsProvider.future);

      session.recentMessages = const [
        NostrEvent(
          id: 'mention-in-a',
          pubkey: 'alice',
          createdAt: 50,
          kind: 9,
          tags: [
            ['h', _channelA],
            ['p', myPk],
          ],
          content: 'direct mention for the first identity',
          sig: 'sig',
        ),
      ];
      session.pauseNextUnreadCatchUpQuery();
      final staleRefresh = container.read(channelsProvider.notifier).refresh();
      await session.nextUnreadCatchUpQueryStarted;

      session.memberships = [_membership(_channelB, _otherPk)];
      session.metadata = [_meta(id: _channelB, name: 'second-identity-joined')];
      container.read(_testPubkeyProvider.notifier).set(_otherPk);
      await container.read(channelsProvider.future);
      await _settle();

      session.resumePausedUnreadCatchUpQuery();
      await staleRefresh;
      await _settle();

      final notifier = container.read(channelsProvider.notifier);
      expect(
        notifier.latestObservedByChannel,
        isNot(contains(_channelA)),
        reason:
            'first identity unread state landed on the second identity: '
            '${notifier.latestObservedByChannel}',
      );
    },
  );

  test('a disconnected community switch retires a parked catch-up', () async {
    final session = _FakeRelaySession(
      memberships: [_membership(_channelA, myPk)],
      metadata: [_meta(id: _channelA, name: 'community-a-general')],
    );
    final container = _buildContainer(session: session);
    addTearDown(container.dispose);

    await container.read(channelsProvider.future);

    session.recentMessages = const [
      NostrEvent(
        id: 'mention-in-a',
        pubkey: 'alice',
        createdAt: 50,
        kind: 9,
        tags: [
          ['h', _channelA],
          ['p', myPk],
        ],
        content: 'direct mention in community A',
        sig: 'sig',
      ),
    ];
    session.pauseNextUnreadCatchUpQuery();
    final started = session.nextUnreadCatchUpQueryStarted;
    final staleRefresh = container.read(channelsProvider.notifier).refresh();
    await started;

    // Switch community while the session is down, so the new scope runs no
    // refresh of its own. This is the arm that shows the single generation
    // counter is sufficient: the rebuild's disposal bumps it even though no
    // new refresh does.
    session.setStatus(SessionStatus.disconnected);
    container
        .read(relayConfigProvider.notifier)
        .update(baseUrl: 'https://community-b.example');
    await _settle();

    session.resumePausedUnreadCatchUpQuery();
    await staleRefresh;
    await _settle();

    final notifier = container.read(channelsProvider.notifier);
    expect(
      notifier.latestObservedByChannel,
      isNot(contains(_channelA)),
      reason:
          'community A unread state survived a disconnected switch: '
          '${notifier.latestObservedByChannel}',
    );
  });

  test('a catch-up that records nothing does not repaint the list', () async {
    final session = _FakeRelaySession(
      memberships: [_membership(_channelA, myPk)],
      metadata: [_meta(id: _channelA, name: 'joined-a')],
    );
    final container = _buildContainer(session: session);
    addTearDown(container.dispose);

    await container.read(channelsProvider.future);

    // No unread events to record, so the catch-up has nothing to publish.
    // The catch-up is detached, so its query starts inside the refresh: hold
    // the started future before awaiting the refresh or the one-shot slot is
    // already claimed and reset by the time we ask for it.
    session.pauseNextUnreadCatchUpQuery();
    final started = session.nextUnreadCatchUpQueryStarted;
    await container.read(channelsProvider.notifier).refresh();
    await started;
    await _settle();

    final emissions = <int>[];
    final subscription = container.listen(
      channelsProvider,
      (_, next) => emissions.add(next.requireValue.length),
      fireImmediately: false,
    );
    addTearDown(subscription.close);

    session.resumePausedUnreadCatchUpQuery();
    await _settle();

    expect(
      emissions,
      isEmpty,
      reason: 'an empty unread catch-up republished provider state: $emissions',
    );
  });

  test('community switch drops unread state recorded before it', () async {
    final session = _FakeRelaySession(
      memberships: [_membership(_channelA, myPk)],
      metadata: [_meta(id: _channelA, name: 'community-a-general')],
    );
    final container = _buildContainer(session: session);
    addTearDown(container.dispose);

    await container.read(channelsProvider.future);

    // A live mention in community A records unread state the badges read.
    session.emit(
      const NostrEvent(
        id: 'mention-in-a',
        pubkey: 'alice',
        createdAt: 50,
        kind: 9,
        tags: [
          ['h', _channelA],
          ['p', myPk],
        ],
        content: 'direct mention in community A',
        sig: 'sig',
      ),
    );
    await _settle();
    final notifier = container.read(channelsProvider.notifier);
    expect(
      notifier.latestObservedByChannel,
      contains(_channelA),
      reason: 'precondition: community A unread state was never recorded',
    );

    session.memberships = [_membership(_channelB, myPk)];
    session.metadata = [_meta(id: _channelB, name: 'community-b-general')];
    container
        .read(relayConfigProvider.notifier)
        .update(baseUrl: 'https://community-b.example');
    await container.read(channelsProvider.future);
    await _settle();

    expect(
      notifier.latestObservedByChannel,
      isNot(contains(_channelA)),
      reason:
          'community A unread state survived into community B: '
          '${notifier.latestObservedByChannel}',
    );
    expect(
      notifier.observedUnreadEventsByChannel,
      isNot(contains(_channelA)),
      reason:
          'community A unread events survived into community B: '
          '${notifier.observedUnreadEventsByChannel}',
    );
  });

  test('never queries a public channel directory', () async {
    final session = _FakeRelaySession(
      memberships: [_membership(_channelA, myPk)],
      metadata: [_meta(id: _channelA, name: 'general')],
    );
    final container = _buildContainer(session: session);
    addTearDown(container.dispose);

    await container.read(channelsProvider.future);
    final initialMembershipRequests = session.membershipRequestCount;

    session.setStatus(SessionStatus.reconnecting);
    session.setStatus(SessionStatus.connected);
    await _waitUntil(
      () => session.membershipRequestCount > initialMembershipRequests,
    );
    await container.read(channelsProvider.notifier).refresh();

    expect(session.directoryQueryFilters, isEmpty);
  });

  test(
    'seeds members from the channel-list snapshot during reconnect',
    () async {
      final session = _FakeRelaySession(
        memberships: [_membership(_channelA, myPk, additionalPubkey: 'alice')],
        metadata: [_meta(id: _channelA, name: 'general')],
      );
      final container = _buildContainer(session: session);
      addTearDown(container.dispose);

      await container.read(channelsProvider.future);
      final memberQueryCount = session.historyFilters
          .where(
            (filter) =>
                filter.kinds.contains(39002) && filter.tags['#d'] != null,
          )
          .length;

      session.setStatus(SessionStatus.reconnecting);
      final members = await container.read(
        channelMembersProvider(_channelA).future,
      );

      expect(members.map((member) => member.pubkey), [myPk, 'alice']);
      expect(
        session.historyFilters
            .where(
              (filter) =>
                  filter.kinds.contains(39002) && filter.tags['#d'] != null,
            )
            .length,
        memberQueryCount,
      );
    },
  );

  _liveSubscriptionTests();
  _terminalSubscriptionTests();

  test('retains channel-list member snapshots for immediate reuse', () async {
    final joinedAt = DateTime.fromMillisecondsSinceEpoch(1000, isUtc: true);
    final session = _FakeRelaySession(
      memberships: [_membership(_channelA, myPk, additionalPubkey: 'alice')],
      metadata: [_meta(id: _channelA, name: 'general')],
    );
    final container = _buildContainer(session: session);
    addTearDown(container.dispose);

    await container.read(channelsProvider.future);
    final members = container
        .read(channelsProvider.notifier)
        .cachedMembersForChannel(_channelA);

    expect(members, hasLength(2));
    expect(members.map((member) => member.pubkey), [myPk, 'alice']);
    expect(members.every((member) => member.joinedAt == joinedAt), isTrue);
  });

  test('live channel events update channel lastMessageAt', () async {
    final session = _FakeRelaySession(
      memberships: [_membership(_channelA, myPk)],
      metadata: [_meta(id: _channelA, name: 'general', createdAt: 10)],
    );
    final container = _buildContainer(session: session);
    addTearDown(container.dispose);

    await container.read(channelsProvider.future);

    // Emit a live message event on channelA.
    session.emit(
      NostrEvent(
        id: 'event-1',
        pubkey: 'alice',
        createdAt: 20,
        kind: EventKind.streamMessageV2,
        tags: const [
          ['h', _channelA],
        ],
        content: 'new message',
        sig: 'sig',
      ),
    );

    final channels = container.read(channelsProvider).value!;
    expect(channels.single.lastMessageAt?.millisecondsSinceEpoch, 20 * 1000);
  });

  test(
    'loads all channel timestamps through one batched relay query',
    () async {
      final session = _FakeRelaySession(
        memberships: [
          _membership(_channelA, myPk),
          _membership(_channelB, myPk),
        ],
        metadata: [
          _meta(id: _channelA, name: 'general'),
          _meta(id: _channelB, name: 'design'),
        ],
        recentMessages: const [
          NostrEvent(
            id: 'stream-message',
            pubkey: 'alice',
            createdAt: 30,
            kind: EventKind.streamMessageV2,
            tags: [
              ['h', _channelA],
            ],
            content: 'hello',
            sig: 'sig',
          ),
          NostrEvent(
            id: 'design-message',
            pubkey: 'alice',
            createdAt: 40,
            kind: 9,
            tags: [
              ['h', _channelB],
            ],
            content: 'hello design',
            sig: 'sig',
          ),
        ],
      );
      final container = _buildContainer(session: session);
      addTearDown(container.dispose);

      final channels = await container.read(channelsProvider.future);

      await _waitUntil(() => session.queryBatches.length == 2);
      expect(session.queryBatches, hasLength(2));
      expect(session.queryBatches.first, hasLength(2));
      expect(
        session.queryBatches.first
            .map((filter) => filter.tags['#h']!.single)
            .toSet(),
        {_channelA, _channelB},
      );
      expect(session.queryBatches.last, hasLength(2));
      expect(
        session.queryBatches.last.every(
          (filter) => filter.limit == 1000 && filter.since == 0,
        ),
        isTrue,
      );
      expect(
        session.historyFilters.where((filter) {
          final kinds = filter.kinds.toSet();
          return kinds.length == EventKind.channelMessageEventKinds.length &&
              kinds.containsAll(EventKind.channelMessageEventKinds);
        }),
        isEmpty,
      );
      expect(
        channels.firstWhere((channel) => channel.id == _channelA).lastMessageAt,
        DateTime.fromMillisecondsSinceEpoch(30 * 1000, isUtc: true),
      );
      expect(
        channels.firstWhere((channel) => channel.id == _channelB).lastMessageAt,
        DateTime.fromMillisecondsSinceEpoch(40 * 1000, isUtc: true),
      );
    },
  );

  test('archived kind:39000 metadata sets Channel.isArchived', () async {
    // Core 归档 Channel 后 Relay 以 `["archived", "true"]` 重发 kind:39000；
    // Channel 需要 `archivedAt != null`，列表才会把它藏起来。
    final session = _FakeRelaySession(
      memberships: [_membership(_channelA, myPk), _membership(_channelB, myPk)],
      metadata: [
        _meta(id: _channelA, name: 'active'),
        _meta(id: _channelB, name: 'archived', archived: true),
      ],
    );
    final container = _buildContainer(session: session);
    addTearDown(container.dispose);

    final channels = await container.read(channelsProvider.future);
    final expired = channels.firstWhere((c) => c.name == 'archived');
    expect(expired.isArchived, isTrue);
    // The active channel must not be flagged archived.
    final active = channels.firstWhere((c) => c.name == 'active');
    expect(active.isArchived, isFalse);
  });

  test(
    'archive transition invalidates cached channelDetailsProvider',
    () async {
      // If a channel is opened (caching its ChannelDetails) and then gets
      // archived, the cached details
      // — built from the pre-archive kind:39000 — would clobber the newer
      // archivedAt set on the base Channel during `mergeDetails`. We invalidate
      // the details provider when the archived state flips so the next
      // mergeDetails sees fresh data.
      final session = _FakeRelaySession(
        memberships: [_membership(_channelA, myPk)],
        metadata: [_meta(id: _channelA, name: 'active')],
      );
      final container = _buildContainer(session: session);
      addTearDown(container.dispose);

      // Initial load.
      final initial = await container.read(channelsProvider.future);
      expect(initial.single.isArchived, isFalse);

      // Prime the detail cache.
      final detailsFiltersBefore = session.historyFilters
          .where((f) => f.kinds.contains(39000) && f.tags['#d'] != null)
          .length;
      await container.read(channelDetailsProvider(_channelA).future);
      final detailsFetchesAfterPrime =
          session.historyFilters
              .where((f) => f.kinds.contains(39000) && f.tags['#d'] != null)
              .length -
          detailsFiltersBefore;
      expect(detailsFetchesAfterPrime, 1);

      // Simulate the reaper auto-archiving the channel by swapping the
      // metadata the fake returns, then refreshing the channels provider.
      session.metadata
        ..clear()
        ..add(_meta(id: _channelA, name: 'active', archived: true));
      await container.read(channelsProvider.notifier).refresh();
      final refreshed = container.read(channelsProvider).value!;
      expect(refreshed.single.isArchived, isTrue);

      // Take a fresh baseline AFTER the refresh — the refresh itself issues a
      // `kinds:[39000], #d:[id]` query as part of channel metadata refetch and
      // we must not count that toward our invalidation assertion. Only the
      // fetch triggered by the second `channelDetailsProvider` read should be
      // attributed to invalidation.
      final detailsFiltersAfterRefresh = session.historyFilters
          .where((f) => f.kinds.contains(39000) && f.tags['#d'] != null)
          .length;

      // Reading the details provider again must trigger a fresh fetch — proving
      // the prior cache was invalidated by the archive transition. Without
      // invalidation, Riverpod would return the cached pre-archive details and
      // no new `kinds:[39000], #d:[id]` filter would be sent.
      await container.read(channelDetailsProvider(_channelA).future);
      final detailsFetchesFromInvalidation =
          session.historyFilters
              .where((f) => f.kinds.contains(39000) && f.tags['#d'] != null)
              .length -
          detailsFiltersAfterRefresh;
      expect(detailsFetchesFromInvalidation, greaterThan(0));
    },
  );

  test(
    'keeps cached channels and live subscriptions during reconnect',
    () async {
      final session = _FakeRelaySession(
        memberships: [_membership(_channelA, myPk)],
        metadata: [_meta(id: _channelA, name: 'general')],
      );
      final container = _buildContainer(session: session);
      addTearDown(container.dispose);

      final initial = await container.read(channelsProvider.future);
      expect(initial.single.name, 'general');
      await _waitUntil(() => session.subscribeFilters.length == 1);
      expect(session.subscribeFilters, hasLength(1));

      session.setStatus(SessionStatus.reconnecting);
      final reconnecting = await container.read(channelsProvider.future);

      expect(reconnecting.single.name, 'general');
      expect(session.subscribeFilters, hasLength(1));
      expect(session.unsubscribeCount, 0);
    },
  );

  test(
    'refreshes cached channels after a disconnected community switch',
    () async {
      final session = _FakeRelaySession(
        memberships: [_membership(_channelA, myPk)],
        metadata: [_meta(id: _channelA, name: 'general')],
      );
      final container = _buildContainer(session: session);
      addTearDown(container.dispose);

      expect(
        (await container.read(channelsProvider.future)).single.name,
        'general',
      );

      session.setStatus(SessionStatus.disconnected);
      session.memberships = [_membership(_channelB, myPk)];
      session.metadata = [_meta(id: _channelB, name: 'random')];
      container
          .read(relayConfigProvider.notifier)
          .update(baseUrl: 'https://new-community.example');
      await Future<void>.delayed(Duration.zero);
      expect(container.read(channelsProvider).value?.single.name, 'general');

      session.setStatus(SessionStatus.connected);
      await Future<void>.delayed(Duration.zero);

      expect(container.read(channelsProvider).value?.single.name, 'random');
    },
  );

  test('recovers an initial fetch failure after reconnecting', () async {
    final session = _FakeRelaySession(
      memberships: [_membership(_channelA, myPk)],
      metadata: [_meta(id: _channelA, name: 'general')],
      membershipFailures: 1,
    );
    final container = _buildContainer(session: session);
    addTearDown(container.dispose);

    await expectLater(container.read(channelsProvider.future), throwsException);

    session.setStatus(SessionStatus.reconnecting);
    session.setStatus(SessionStatus.connected);
    await Future<void>.delayed(Duration.zero);

    final recovered = await container.read(channelsProvider.future);
    expect(recovered.single.name, 'general');
  });

  test(
    'preserves a successfully loaded empty list while disconnected',
    () async {
      final session = _FakeRelaySession(memberships: [], metadata: []);
      final container = _buildContainer(session: session);
      addTearDown(container.dispose);

      expect(await container.read(channelsProvider.future), isEmpty);
      final fetchCount = session.historyFilters.length;

      session.setStatus(SessionStatus.reconnecting);
      expect(await container.read(channelsProvider.future), isEmpty);
      expect(session.historyFilters, hasLength(fetchCount));
    },
  );

  test('initial fetch issues membership + metadata queries', () async {
    final session = _FakeRelaySession(
      memberships: [_membership(_channelA, myPk)],
      metadata: [_meta(id: _channelA, name: 'general')],
    );
    final container = _buildContainer(session: session);
    addTearDown(container.dispose);

    await container.read(channelsProvider.future);

    expect(session.membershipQueryFilters, isNotEmpty);
    expect(session.membershipQueryFilters.first.kinds, [39002]);
    expect(session.membershipQueryFilters.first.tags['#p'], [myPk]);
    expect(
      session.historyFilters.any(
        (filter) =>
            filter.kinds.contains(39000) &&
            filter.tags['#d']?.contains(_channelA) == true,
      ),
      isTrue,
    );

    // And one live subscription on the resulting channel.
    await _waitUntil(() => session.subscribeFilters.length == 1);
    expect(session.subscribeFilters, hasLength(1));
  });
}

const _channelA = '11111111-1111-4111-8111-111111111111';
const _channelB = '22222222-2222-4222-8222-222222222222';
const _channelD = '44444444-4444-4444-8444-444444444444';
const _otherPk = 'someone-else';

String _generatedChannelId(int index) =>
    '${index.toString().padLeft(8, '0')}-0000-4000-8000-000000000000';

/// Build a kind:39002 membership event tagged with the channel id and member.
NostrEvent _membership(
  String channelId,
  String pubkey, {
  String? additionalPubkey,
  String? ownerPubkey,
}) => NostrEvent(
  id: 'mem-$channelId',
  pubkey: 'creator',
  createdAt: 1,
  kind: 39002,
  tags: [
    ['d', channelId],
    if (ownerPubkey != null) ['p', ownerPubkey, '', 'owner'],
    if (ownerPubkey == null || ownerPubkey != pubkey) ['p', pubkey],
    if (additionalPubkey != null) ['p', additionalPubkey],
  ],
  content: '',
  sig: 'sig',
);

NostrEvent _meta({
  required String id,
  required String name,
  String channelType = 'stream',
  String visibility = 'open',
  int createdAt = 1,
  bool archived = false,
}) => NostrEvent(
  id: 'meta-$id',
  pubkey: 'creator',
  createdAt: createdAt,
  kind: 39000,
  tags: [
    ['d', id],
    ['name', name],
    ['t', channelType],
    [visibility == 'private' ? 'private' : 'public'],
    if (archived) ['archived', 'true'],
  ],
  content: '',
  sig: 'sig',
);

ProviderContainer _buildContainer({required _FakeRelaySession session}) {
  return ProviderContainer(
    retry: (_, _) => null,
    overrides: [
      appLifecycleProvider.overrideWith(() => _FakeAppLifecycleNotifier()),
      relaySessionProvider.overrideWith(() => session),
      // Route the pubkey through a mutable notifier so tests can switch the
      // signing identity mid-flight the way an account change does at runtime.
      myPubkeyProvider.overrideWith((ref) => ref.watch(_testPubkeyProvider)),
    ],
  );
}

/// Mutable stand-in for the signing identity derived from the active community.

/// Mutable stand-in for the signing identity derived from the active community.
class _TestPubkeyNotifier extends Notifier<String?> {
  @override
  String? build() => 'me';

  void set(String? pubkey) => state = pubkey;
}

final _testPubkeyProvider = NotifierProvider<_TestPubkeyNotifier, String?>(
  _TestPubkeyNotifier.new,
);

/// Drains pending microtasks so provider rebuilds and awaited writes land.
Future<void> _settle() async {
  for (var i = 0; i < 20; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

Future<void> _waitUntil(bool Function() predicate) async {
  for (var i = 0; i < 100; i++) {
    if (predicate()) return;
    await Future<void>.delayed(Duration.zero);
  }
  fail('Timed out waiting for asynchronous provider work');
}

/// Fake [RelaySessionNotifier] that returns canned query results and records
/// subscriptions.
class _FakeRelaySession extends RelaySessionNotifier {
  _FakeRelaySession({
    required this.memberships,
    this.membershipPages,
    this.repeatLastMembershipPage = false,
    this.maxMembershipPageRequests,
    this.metadata = const [],
    this.recentMessages = const [],
    this.membershipFailures = 0,
  });

  List<NostrEvent> memberships;
  final List<List<NostrEvent>>? membershipPages;
  final bool repeatLastMembershipPage;
  final int? maxMembershipPageRequests;
  List<NostrEvent> metadata;
  List<NostrEvent> recentMessages;
  int membershipFailures;
  bool failClaimedMemberCountQuery = false;
  bool failClaimedUnreadCatchUpQuery = false;
  int membershipRequestCount = 0;

  final List<NostrFilter> historyFilters = [];
  final List<List<NostrFilter>> queryBatches = [];
  final List<NostrFilter> directoryQueryFilters = [];
  final List<NostrFilter> membershipQueryFilters = [];
  final List<NostrFilter> subscribeFilters = [];
  final Map<
    int,
    (NostrFilter, void Function(NostrEvent), void Function(String message)?)
  >
  _subscriptions = {};
  int _nextSubscriptionKey = 0;
  Completer<void>? _pausedSubscribe;
  Completer<void>? _subscribeStarted;
  Completer<void>? _pausedMemberCount;
  Completer<void>? _memberCountStarted;
  Completer<void>? _claimedMemberCount;
  Completer<void>? _pausedUnreadCatchUp;
  Completer<void>? _unreadCatchUpStarted;
  Completer<void>? _claimedUnreadCatchUp;
  int unsubscribeCount = 0;
  int totalSubscribeCount = 0;
  int subscribeFailures = 0;
  int successfulSubscribesBeforeFailure = 0;

  Set<String> get activeChannels => {
    for (final (filter, _, _) in _subscriptions.values)
      ...filter.tags['#h'] ?? const <String>[],
  };

  int get activeSubscriptionCount => _subscriptions.length;

  Future<void> get nextSubscribeStarted async {
    final started = _subscribeStarted;
    if (started == null) {
      throw StateError('No paused subscription is pending');
    }
    await started.future;
  }

  void pauseNextSubscribe() {
    if (_pausedSubscribe != null) {
      throw StateError('A subscription is already paused');
    }
    _pausedSubscribe = Completer<void>();
    _subscribeStarted = Completer<void>();
  }

  void resumePausedSubscribe() {
    final paused = _pausedSubscribe;
    if (paused == null) throw StateError('No subscription is paused');
    paused.complete();
  }

  /// Holds the next member-count query open, one shot only.
  void pauseNextMemberCountQuery() {
    if (_pausedMemberCount != null) {
      throw StateError('A member-count query is already paused');
    }
    _pausedMemberCount = Completer<void>();
    _memberCountStarted = Completer<void>();
  }

  /// Completes once the parked member-count query has been requested.
  Future<void> get nextMemberCountQueryStarted async {
    final started = _memberCountStarted;
    if (started == null) {
      throw StateError('No member-count query is pending');
    }
    await started.future;
  }

  /// Releases the parked member-count query so its response lands.
  void resumePausedMemberCountQuery() {
    final paused = _claimedMemberCount ?? _pausedMemberCount;
    if (paused == null) throw StateError('No member-count query is paused');
    paused.complete();
  }

  /// Holds the next unread catch-up batch open, one shot only.
  ///
  /// The catch-up runs detached from the refresh that starts it, so this is the
  /// window where a community or identity switch can land between the request
  /// and the writes its response drives.
  void pauseNextUnreadCatchUpQuery() {
    if (_pausedUnreadCatchUp != null) {
      throw StateError('An unread catch-up query is already paused');
    }
    _pausedUnreadCatchUp = Completer<void>();
    _unreadCatchUpStarted = Completer<void>();
  }

  /// Completes once the parked unread catch-up batch has been requested.
  Future<void> get nextUnreadCatchUpQueryStarted async {
    final started = _unreadCatchUpStarted;
    if (started == null) {
      throw StateError('No unread catch-up query is pending');
    }
    await started.future;
  }

  /// Releases the parked unread catch-up batch so its response lands.
  void resumePausedUnreadCatchUpQuery() {
    final paused = _claimedUnreadCatchUp ?? _pausedUnreadCatchUp;
    if (paused == null) {
      throw StateError('No unread catch-up query is paused');
    }
    paused.complete();
  }

  @override
  SessionState build() => const SessionState(status: SessionStatus.connected);

  @override
  Future<List<NostrEvent>> fetchHistory(
    NostrFilter filter, {
    Duration timeout = const Duration(seconds: 8),
  }) async {
    historyFilters.add(filter);
    if (filter.kinds.contains(39002) && filter.tags['#d'] != null) {
      final paused = _pausedMemberCount;
      if (paused != null) {
        _claimedMemberCount = paused;
        _pausedMemberCount = null;
        _memberCountStarted!.complete();
        _memberCountStarted = null;
        await paused.future;
        if (failClaimedMemberCountQuery) {
          throw Exception('member-count fetch failed');
        }
      }
      final ids = (filter.tags['#d'] ?? const <String>[]).toSet();
      return memberships
          .where((event) => ids.contains(event.getTagValue('d')))
          .toList();
    }
    if (filter.kinds.contains(39002) && filter.tags['#p'] != null) {
      membershipRequestCount++;
      if (membershipFailures > 0) {
        membershipFailures--;
        throw Exception('membership fetch failed');
      }
      // Membership query — return all memberships we have for this pubkey.
      final myPk = filter.tags['#p']?.single;
      return memberships
          .where(
            (e) =>
                e.tags.any((t) => t.length >= 2 && t[0] == 'p' && t[1] == myPk),
          )
          .toList();
    }
    if (filter.kinds.contains(39000)) {
      final ids = filter.tags['#d']?.toSet();
      if (ids == null) {
        throw StateError('Directory queries must use the HTTP query bridge');
      }
      // Member metadata query — return only matching `d` tags.
      return metadata.where((e) => ids.contains(e.getTagValue('d'))).toList();
    }
    return const [];
  }

  @override
  Future<List<NostrEvent>> queryRelay(
    List<NostrFilter> filters, {
    Duration timeout = const Duration(seconds: 8),
  }) async {
    if (filters case [final filter]
        when filter.kinds.length == 1 &&
            filter.kinds.single == 39002 &&
            filter.tags['#p'] != null) {
      membershipQueryFilters.add(filter);
      if (membershipFailures > 0) {
        membershipFailures--;
        throw Exception('membership fetch failed');
      }
      final requestIndex = membershipRequestCount++;
      final maxRequests = maxMembershipPageRequests;
      if (maxRequests != null && requestIndex >= maxRequests) {
        throw StateError('Unexpected membership page request');
      }
      final pages = membershipPages;
      if (pages != null) {
        if (requestIndex < pages.length) return List.of(pages[requestIndex]);
        if (repeatLastMembershipPage && pages.isNotEmpty) {
          return List.of(pages.last);
        }
        return const [];
      }
      if (filter.until != null) return const [];
      final myPk = filter.tags['#p']?.single;
      return memberships
          .where(
            (event) => event.tags.any(
              (tag) => tag.length >= 2 && tag[0] == 'p' && tag[1] == myPk,
            ),
          )
          .toList();
    }
    if (filters case [final filter]
        when filter.kinds.length == 1 &&
            filter.kinds.single == 39000 &&
            !filter.tags.containsKey('#d')) {
      // 平台没有公开 Channel 目录（DD-80）：记下来，测试断言它从不发生
      directoryQueryFilters.add(filter);
      return const [];
    }
    queryBatches.add(filters);
    // The unread catch-up is the only batch that carries `since` on every
    // filter; the latest-message batch leaves it null. Snapshot the messages at
    // request time so a parked response reflects the scope that asked for it.
    final isUnreadCatchUp =
        filters.isNotEmpty && filters.every((filter) => filter.since != null);
    final messageSnapshot = List.of(recentMessages);
    if (isUnreadCatchUp) {
      // Claim the parked slot so the refresh that follows the switch can run
      // its own catch-up unblocked while this one stays parked.
      final paused = _pausedUnreadCatchUp;
      if (paused != null) {
        _claimedUnreadCatchUp = paused;
        _pausedUnreadCatchUp = null;
        _unreadCatchUpStarted!.complete();
        _unreadCatchUpStarted = null;
        await paused.future;
        if (failClaimedUnreadCatchUpQuery) {
          throw Exception('unread catch-up fetch failed');
        }
      }
    }
    return messageSnapshot.where((event) {
      return filters.any((filter) {
        if (!filter.kinds.contains(event.kind)) return false;
        for (final entry in filter.tags.entries) {
          final tagName = entry.key.startsWith('#')
              ? entry.key.substring(1)
              : entry.key;
          if (!event.tags.any(
            (tag) =>
                tag.length > 1 &&
                tag[0] == tagName &&
                entry.value.contains(tag[1]),
          )) {
            return false;
          }
        }
        return true;
      });
    }).toList();
  }

  @override
  Future<void Function()> subscribe(
    NostrFilter filter,
    void Function(NostrEvent) onEvent, {
    void Function(String message)? onClosed,
  }) async {
    totalSubscribeCount++;
    subscribeFilters.add(filter);
    final paused = _pausedSubscribe;
    if (paused != null) {
      _subscribeStarted!.complete();
      await paused.future;
      _pausedSubscribe = null;
      _subscribeStarted = null;
    }
    if (subscribeFailures > 0 && successfulSubscribesBeforeFailure == 0) {
      subscribeFailures--;
      subscribeFilters.remove(filter);
      throw StateError('live subscription failed');
    }
    if (successfulSubscribesBeforeFailure > 0) {
      successfulSubscribesBeforeFailure--;
    }
    final subscriptionKey = ++_nextSubscriptionKey;
    _subscriptions[subscriptionKey] = (filter, onEvent, onClosed);
    return () {
      final subscription = _subscriptions.remove(subscriptionKey);
      if (subscription == null) return;
      unsubscribeCount++;
      subscribeFilters.remove(subscription.$1);
    };
  }

  void closeSubscriptionContaining(String channelId, String message) {
    final entry = _subscriptions.entries.singleWhere(
      (entry) => entry.value.$1.tags['#h']?.contains(channelId) ?? false,
    );
    _subscriptions.remove(entry.key);
    subscribeFilters.remove(entry.value.$1);
    entry.value.$3?.call(message);
  }

  void setStatus(SessionStatus status) {
    state = SessionState(status: status);
  }

  /// Emit a live event to all subscribers.
  void emit(NostrEvent event) {
    for (final (_, listener, _) in List.of(_subscriptions.values)) {
      listener(event);
    }
  }
}

class _FakeAppLifecycleNotifier extends AppLifecycleNotifier {
  @override
  AppLifecycleState build() => AppLifecycleState.resumed;
}
