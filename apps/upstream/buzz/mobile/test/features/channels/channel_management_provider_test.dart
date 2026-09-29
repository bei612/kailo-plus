import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:buzz/features/channels/channel_management_provider.dart';
import 'package:buzz/shared/relay/relay.dart';

/// Tests for [channelDetailsFromEvent].
///
/// The function maps a kind:39000 metadata event to [ChannelDetails], and is
/// the source of truth for the merge that [Channel.mergeDetails] performs in
/// the channel detail view. Anything `ChannelData.fromEvent` parses that's
/// also exposed on `ChannelDetails` MUST be propagated here — otherwise
/// `mergeDetails` silently clears that state on the merged Channel.
void main() {
  group('identity labels', () {
    // Valid fixture keys whose npub encodings were verified against the
    // NIP-19 codec independently of the code under test.
    const alicePubkey =
        'a11ce00000000000000000000000000000000000000000000000000000000000';
    const bobPubkey =
        'b0b0000000000000000000000000000000000000000000000000000000000000';

    test('member labels honor "You", authored names, and npub fallback', () {
      final unnamed = ChannelMember(
        pubkey: alicePubkey,
        role: 'member',
        joinedAt: DateTime.fromMillisecondsSinceEpoch(0),
      );
      final named = ChannelMember(
        pubkey: alicePubkey,
        role: 'member',
        joinedAt: DateTime.fromMillisecondsSinceEpoch(0),
        displayName: '  Alice  ',
      );

      // Unnamed members fall back to the compact npub …
      expect(unnamed.labelFor(null), 'npub15yw…ccpw');
      // … but only the member's own identity is "You" — never the caller's key.
      expect(unnamed.labelFor(alicePubkey), 'You');
      expect(unnamed.labelFor(alicePubkey.toUpperCase()), 'You');
      expect(unnamed.labelFor(bobPubkey), 'npub15yw…ccpw');
      // An authored display name wins over every fallback.
      expect(named.labelFor(bobPubkey), 'Alice');
    });
  });

  test('propagates archived state from kind:39000 archived tag', () {
    // Regression: previously this mapping ignored the `archived` tag, so
    // `Channel.mergeDetails` would clear the archived flag the list provider
    // had set, and the detail screen would show compose/manage actions for
    // archived channels.
    final details = channelDetailsFromEvent(
      NostrEvent(
        id: 'meta-1',
        pubkey: 'creator',
        createdAt: 1700000000,
        kind: 39000,
        tags: const [
          ['d', 'c8c629ae-d35c-44fa-bc39-f6c1816756cc'],
          ['name', 'archived'],
          ['t', 'stream'],
          ['public'],
          ['archived', 'true'],
        ],
        content: '',
        sig: 'sig',
      ),
    );

    expect(details.archivedAt, isNotNull);
  });

  test('omits archivedAt when no archived tag is present', () {
    final details = channelDetailsFromEvent(
      NostrEvent(
        id: 'meta-1',
        pubkey: 'creator',
        createdAt: 1700000000,
        kind: 39000,
        tags: const [
          ['d', 'c8c629ae-d35c-44fa-bc39-f6c1816756cc'],
          ['name', 'active'],
          ['t', 'stream'],
          ['public'],
        ],
        content: '',
        sig: 'sig',
      ),
    );

    expect(details.archivedAt, isNull);
  });

  group('Huddle channel lifecycle', () {});

  group('channelMembersProvider', () {
    test('waits for the relay connection before fetching members', () async {
      final session = _ConnectionAwareRelaySession();
      final container = ProviderContainer(
        retry: (_, _) => null,
        overrides: [relaySessionProvider.overrideWith(() => session)],
      );
      addTearDown(container.dispose);
      final subscription = container.listen(
        channelMembersProvider(_channelId),
        (_, _) {},
      );
      addTearDown(subscription.close);

      expect(
        await container.read(channelMembersProvider(_channelId).future),
        isEmpty,
      );
      expect(session.historyQueryCount, 0);

      session.connect();
      await container.pump();
      final members = await container.read(
        channelMembersProvider(_channelId).future,
      );

      expect(session.historyQueryCount, 1);
      expect(members, hasLength(1));
      expect(members.single.pubkey, _memberPubkey);
      expect(members.single.role, 'admin');
    });

    test(
      'keeps the provider member snapshot available during reconnect',
      () async {
        final session = _ConnectionAwareRelaySession();
        final container = ProviderContainer(
          retry: (_, _) => null,
          overrides: [relaySessionProvider.overrideWith(() => session)],
        );
        addTearDown(container.dispose);
        final subscription = container.listen(
          channelMembersProvider(_channelId),
          (_, _) {},
        );
        addTearDown(subscription.close);

        session.connect();
        await container.pump();
        final connectedMembers = await container.read(
          channelMembersProvider(_channelId).future,
        );
        expect(connectedMembers, hasLength(1));
        expect(session.historyQueryCount, 1);

        session.setStatus(SessionStatus.reconnecting);
        await container.pump();

        final reconnectingMembers = container
            .read(channelMembersProvider(_channelId))
            .asData
            ?.value;
        expect(reconnectingMembers, connectedMembers);
        expect(session.historyQueryCount, 1);
      },
    );

    test('keeps the member snapshot available during reconnect', () {
      final cachedMembers = [
        ChannelMember(
          pubkey: _memberPubkey,
          role: 'member',
          joinedAt: DateTime.fromMillisecondsSinceEpoch(1000),
        ),
      ];
      final refreshedMember = ChannelMember(
        pubkey: _memberPubkey,
        role: 'admin',
        joinedAt: DateTime.fromMillisecondsSinceEpoch(2000),
      );

      expect(
        channelMembersForAutocomplete(
          membersAsync: const AsyncData([]),
          sessionStatus: SessionStatus.connected,
          cachedMembers: cachedMembers,
        ),
        isEmpty,
      );
      expect(
        channelMembersForAutocomplete(
          membersAsync: const AsyncData([]),
          sessionStatus: SessionStatus.reconnecting,
          cachedMembers: cachedMembers,
        ),
        same(cachedMembers),
      );
      expect(
        channelMembersForAutocomplete(
          membersAsync: AsyncData([refreshedMember]),
          sessionStatus: SessionStatus.connected,
          cachedMembers: cachedMembers,
        ),
        [refreshedMember],
      );
    });
  });
}

const _channelId = '11111111-1111-4111-8111-111111111111';
const _memberPubkey =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

class _ConnectionAwareRelaySession extends RelaySessionNotifier {
  int historyQueryCount = 0;

  @override
  SessionState build() =>
      const SessionState(status: SessionStatus.disconnected);

  void connect() {
    state = const SessionState(status: SessionStatus.connected);
  }

  @override
  Future<List<NostrEvent>> fetchHistory(
    NostrFilter filter, {
    Duration timeout = const Duration(seconds: 8),
  }) async {
    historyQueryCount++;
    return [
      NostrEvent(
        id: 'members',
        pubkey: 'owner',
        createdAt: 1,
        kind: 39002,
        tags: const [
          ['d', _channelId],
          ['p', _memberPubkey, 'wss://relay.example', 'admin'],
        ],
        content: '',
        sig: 'sig',
      ),
    ];
  }

  void setStatus(SessionStatus status) {
    state = SessionState(status: status);
  }

  @override
  Future<void Function()> subscribe(
    NostrFilter filter,
    void Function(NostrEvent) onEvent, {
    void Function(String message)? onClosed,
  }) async => () {};
}
