import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:nostr/nostr.dart' as nostr;
import 'package:buzz/features/channels/send_message_provider.dart';
import 'package:buzz/shared/relay/relay.dart';

void main() {
  test(
    'adds the signed message locally before relay acknowledgement',
    () async {
      final session = _PendingPublishRelaySession();
      final localMessages = <NostrEvent>[];
      final removedIds = <String>[];
      final completedIds = <String>[];
      final animatedIds = <String>[];
      final send = SendMessage(
        relayBaseUrl: 'https://relay.example',
        signedEventRelay: SignedEventRelay(
          session: session,
          nsec: nostr.Keys.generate().nsec,
        ),
        fetchMembers: (_) async => const [],
        readUserCache: () => const {},
        addLocalMessage: (_, event) => localMessages.add(event),
        markLocalMessageForAnimation: (_, eventId) => animatedIds.add(eventId),
        completeLocalMessage: (_, eventId) => completedIds.add(eventId),
        removeLocalMessage: (_, eventId) => removedIds.add(eventId),
      );

      final result = send(channelId: _channelId, content: 'hello');
      await session.published;

      expect(localMessages, hasLength(1));
      expect(localMessages.single.id, session.event.id);
      expect(localMessages.single.content, 'hello');
      expect(localMessages.single.channelId, _channelId);
      expect(animatedIds, [localMessages.single.id]);
      expect(removedIds, isEmpty);

      session.accept();
      await result;
      expect(completedIds, [localMessages.single.id]);
      expect(removedIds, isEmpty);
    },
  );

  test('rolls back the signed local message when publish fails', () async {
    final session = _PendingPublishRelaySession();
    final localMessages = <NostrEvent>[];
    final completedIds = <String>[];
    final removedIds = <String>[];
    final send = SendMessage(
      relayBaseUrl: 'https://relay.example',
      signedEventRelay: SignedEventRelay(
        session: session,
        nsec: nostr.Keys.generate().nsec,
      ),
      fetchMembers: (_) async => const [],
      readUserCache: () => const {},
      addLocalMessage: (_, event) => localMessages.add(event),
      completeLocalMessage: (_, eventId) => completedIds.add(eventId),
      removeLocalMessage: (_, eventId) => removedIds.add(eventId),
    );

    final result = send(channelId: _channelId, content: 'hello');
    await session.published;
    session.reject();

    await expectLater(result, throwsException);
    expect(completedIds, isEmpty);
    expect(removedIds, [localMessages.single.id]);
  });

  test('relay readback before publish timeout settles that send', () async {
    final identity = nostr.Keys.generate();
    final session = _PendingPublishRelaySession();
    final unconfirmed = UnconfirmedPublishes();
    final completedIds = <String>[];
    final removedIds = <String>[];
    final send = SendMessage(
      relayBaseUrl: 'https://relay.example',
      signedEventRelay: SignedEventRelay(session: session, nsec: identity.nsec),
      fetchMembers: (_) async => const [],
      readUserCache: () => const {},
      addLocalMessage: (_, _) {},
      completeLocalMessage: (_, id) => completedIds.add(id),
      removeLocalMessage: (_, id) => removedIds.add(id),
      unconfirmed: unconfirmed,
    );
    final result = send(channelId: _channelId, content: 'hello');
    await session.published;
    expect(
      unconfirmed.settleObserved(
        relayBaseUrl: 'https://relay.example',
        pubkey: identity.public,
        event: session.event,
      ),
      isTrue,
    );
    session.fail(RelayPublishOutcomeUnknown(session.event.id, 'timeout'));
    await result;
    expect(completedIds, [session.event.id]);
    expect(removedIds, isEmpty);
  });

  group('an unconfirmed send is retried as the same signed event', () {
    SendMessage build(
      _ScriptedRelaySession session,
      String nsec, {
      UnconfirmedPublishes? unconfirmed,
      String relayBaseUrl = 'https://relay.example',
    }) => SendMessage(
      relayBaseUrl: relayBaseUrl,
      signedEventRelay: SignedEventRelay(session: session, nsec: nsec),
      fetchMembers: (_) async => const [],
      readUserCache: () => const {},
      addLocalMessage: (_, _) {},
      completeLocalMessage: (_, _) {},
      removeLocalMessage: (_, _) {},
      unconfirmed: unconfirmed ?? UnconfirmedPublishes(),
    );

    test('a first definite refusal remains a definite refusal', () async {
      final session = _ScriptedRelaySession([
        (e) => RelayPublishRejected(e.id, 'restricted: not a channel member'),
      ]);
      final send = build(session, nostr.Keys.generate().nsec);

      await expectLater(
        send(channelId: _channelId, content: 'hello', mentionPubkeys: []),
        throwsA(isA<RelayPublishRejected>()),
      );
    });

    test('resending after an unknown outcome reuses the event id', () async {
      final session = _ScriptedRelaySession([
        (e) => RelayPublishOutcomeUnknown(e.id, 'timeout'),
        null,
      ]);
      final send = build(session, nostr.Keys.generate().nsec);

      await expectLater(
        send(channelId: _channelId, content: 'hello', mentionPubkeys: []),
        throwsA(isA<RelayPublishOutcomeUnknown>()),
      );
      await send(channelId: _channelId, content: 'hello', mentionPubkeys: []);

      expect(session.published, hasLength(2));
      expect(
        session.published.last.id,
        session.published.first.id,
        reason: 'Relay 以 duplicate: 接受同一 id；重新签名会存下第二条消息',
      );
      expect(session.published.last.sig, session.published.first.sig);
    });

    test('after acceptance the same text is a new message', () async {
      final session = _ScriptedRelaySession([
        (e) => RelayPublishOutcomeUnknown(e.id, 'timeout'),
        null,
        null,
      ]);
      final send = build(session, nostr.Keys.generate().nsec);

      await expectLater(
        send(channelId: _channelId, content: 'hello', mentionPubkeys: []),
        throwsA(isA<RelayPublishOutcomeUnknown>()),
      );
      await send(channelId: _channelId, content: 'hello', mentionPubkeys: []);
      await Future<void>.delayed(const Duration(seconds: 1));
      await send(channelId: _channelId, content: 'hello', mentionPubkeys: []);

      expect(session.published, hasLength(3));
      expect(
        session.published[2].id,
        isNot(session.published[1].id),
        reason: '确认接受后指纹记录已清除，同样的正文是用户的一条新消息',
      );
    });

    test('a refused resend preserves the original unknown outcome', () async {
      final session = _ScriptedRelaySession([
        (e) => RelayPublishOutcomeUnknown(e.id, 'disconnected'),
        (e) => RelayPublishRejected(e.id, 'restricted: not a channel member'),
        (e) => RelayPublishNotSent(e.id, 'not connected'),
        null,
      ]);
      final send = build(session, nostr.Keys.generate().nsec);

      await expectLater(
        send(channelId: _channelId, content: 'hello', mentionPubkeys: []),
        throwsA(isA<RelayPublishOutcomeUnknown>()),
      );
      await expectLater(
        send(channelId: _channelId, content: 'hello', mentionPubkeys: []),
        throwsA(isA<RelayPublishOutcomeUnknown>()),
        reason: '重发拒绝不证明第一次未存储，仍是不明结果',
      );
      await expectLater(
        send(channelId: _channelId, content: 'hello', mentionPubkeys: []),
        throwsA(isA<RelayPublishOutcomeUnknown>()),
      );
      await send(channelId: _channelId, content: 'hello', mentionPubkeys: []);
      expect(session.published.map((e) => e.id).toSet(), hasLength(1));
      expect(session.published.last.id, session.published.first.id);
    });

    test('an exact scoped relay readback settles the original event', () async {
      final identity = nostr.Keys.generate();
      final unconfirmed = UnconfirmedPublishes();
      final session = _ScriptedRelaySession([
        (e) => RelayPublishOutcomeUnknown(e.id, 'timeout'),
        null,
      ]);
      final send = build(session, identity.nsec, unconfirmed: unconfirmed);
      await expectLater(
        send(channelId: _channelId, content: 'hello', mentionPubkeys: []),
        throwsA(isA<RelayPublishOutcomeUnknown>()),
      );
      final original = session.published.single;
      final fingerprint = UnconfirmedPublishes.fingerprint(
        relayBaseUrl: 'https://relay.example',
        pubkey: identity.public,
        kind: original.kind,
        content: original.content,
        tags: original.tags,
      );
      for (final scope in [
        ('https://other.example', identity.public, original),
        ('https://relay.example', nostr.Keys.generate().public, original),
        (
          'https://relay.example',
          identity.public,
          NostrEvent.fromJson({...original.toJson(), 'id': 'another-id'}),
        ),
      ]) {
        expect(
          unconfirmed.settleObserved(
            relayBaseUrl: scope.$1,
            pubkey: scope.$2,
            event: scope.$3,
          ),
          isFalse,
        );
        expect(unconfirmed.lookup(fingerprint)?.id, original.id);
      }
      expect(
        unconfirmed.settleObserved(
          relayBaseUrl: 'https://relay.example',
          pubkey: identity.public,
          event: original,
        ),
        isTrue,
      );
      expect(unconfirmed.lookup(fingerprint), isNull);
      await Future<void>.delayed(const Duration(seconds: 1));
      await send(channelId: _channelId, content: 'hello', mentionPubkeys: []);
      expect(session.published.last.id, isNot(original.id));
    });

    test(
      'late acceptance of the old event cannot settle a new event',
      () async {
        final first = Completer<NostrEvent>();
        final retry = Completer<NostrEvent>();
        final next = Completer<NostrEvent>();
        final unconfirmed = UnconfirmedPublishes();
        final session = _ScriptedRelaySession([
          (_) => first.future,
          (_) => retry.future,
          (_) => next.future,
        ]);
        final identity = nostr.Keys.generate();
        final send = build(session, identity.nsec, unconfirmed: unconfirmed);
        final initialSend = send(
          channelId: _channelId,
          content: 'hello',
          mentionPubkeys: [],
        );
        await Future<void>.delayed(const Duration(seconds: 1));
        final retrySend = send(
          channelId: _channelId,
          content: 'hello',
          mentionPubkeys: [],
        );
        final original = session.published.first;
        expect(session.published[1].id, original.id);
        expect(session.published[1].sig, original.sig);
        expect(session.published[1].createdAt, original.createdAt);
        first.complete(original);
        await initialSend;
        await Future<void>.delayed(const Duration(seconds: 1));
        final nextSend = send(
          channelId: _channelId,
          content: 'hello',
          mentionPubkeys: [],
        );
        final newEvent = session.published.last;
        expect(newEvent.id, isNot(original.id));
        retry.complete(original);
        await retrySend;
        final expected = expectLater(
          nextSend,
          throwsA(isA<RelayPublishOutcomeUnknown>()),
        );
        next.completeError(RelayPublishOutcomeUnknown(newEvent.id, 'timeout'));
        await expected;
        final fingerprint = UnconfirmedPublishes.fingerprint(
          relayBaseUrl: 'https://relay.example',
          pubkey: identity.public,
          kind: newEvent.kind,
          content: newEvent.content,
          tags: newEvent.tags,
        );
        expect(unconfirmed.lookup(fingerprint)?.id, newEvent.id);
      },
    );

    test(
      'an overlapping unknown retry prevents an earlier refusal from clearing intent',
      () async {
        final first = Completer<NostrEvent>();
        final retry = Completer<NostrEvent>();
        final session = _ScriptedRelaySession([
          (_) => first.future,
          (_) => retry.future,
        ]);
        final send = build(session, nostr.Keys.generate().nsec);
        final initialSend = send(
          channelId: _channelId,
          content: 'hello',
          mentionPubkeys: [],
        );
        final retrySend = send(
          channelId: _channelId,
          content: 'hello',
          mentionPubkeys: [],
        );
        final original = session.published.first;
        final expectedRetry = expectLater(
          retrySend,
          throwsA(isA<RelayPublishOutcomeUnknown>()),
        );
        retry.completeError(RelayPublishOutcomeUnknown(original.id, 'timeout'));
        await expectedRetry;
        final expectedFirst = expectLater(
          initialSend,
          throwsA(isA<RelayPublishOutcomeUnknown>()),
        );
        first.completeError(RelayPublishRejected(original.id, 'restricted'));
        await expectedFirst;
        expect(session.published.map((event) => event.id).toSet(), {
          original.id,
        });
      },
    );

    test('a different text is signed as a different event', () async {
      final session = _ScriptedRelaySession([
        (e) => RelayPublishOutcomeUnknown(e.id, 'timeout'),
        null,
      ]);
      final send = build(session, nostr.Keys.generate().nsec);

      await expectLater(
        send(channelId: _channelId, content: 'hello', mentionPubkeys: []),
        throwsA(isA<RelayPublishOutcomeUnknown>()),
      );
      await send(channelId: _channelId, content: 'hello!', mentionPubkeys: []);

      expect(session.published.last.id, isNot(session.published.first.id));
    });
  });

  test('cancels delivery after the active community changes', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    container
        .read(relayConfigProvider.notifier)
        .update(baseUrl: 'https://first.example');
    final send = container.read(sendMessageProvider);

    container
        .read(relayConfigProvider.notifier)
        .update(baseUrl: 'https://second.example');

    await expectLater(
      send(channelId: _channelId, content: 'old community draft'),
      throwsA(
        isA<StateError>().having(
          (error) => error.message,
          'message',
          contains('active community changed'),
        ),
      ),
    );
  });
}

const _channelId = '11111111-1111-4111-8111-111111111111';

class _PendingPublishRelaySession extends RelaySessionNotifier {
  final Completer<NostrEvent> _result = Completer<NostrEvent>();
  final Completer<void> _published = Completer<void>();
  late NostrEvent event;

  Future<void> get published => _published.future;

  @override
  SessionState build() => const SessionState(status: SessionStatus.connected);

  @override
  Future<NostrEvent> publish(
    NostrEvent event, {
    Duration timeout = const Duration(seconds: 8),
  }) {
    this.event = event;
    _published.complete();
    return _result.future;
  }

  void accept() => _result.complete(event);

  void reject() => _result.completeError(Exception('relay rejected event'));

  void fail(Object error) => _result.completeError(error);
}

/// 按脚本逐次回答 publish：null 为接受，否则抛出脚本给出的失败。
class _ScriptedRelaySession extends RelaySessionNotifier {
  _ScriptedRelaySession(this._script);

  final List<Object? Function(NostrEvent event)?> _script;
  final published = <NostrEvent>[];

  @override
  SessionState build() => const SessionState(status: SessionStatus.connected);

  @override
  Future<NostrEvent> publish(
    NostrEvent event, {
    Duration timeout = const Duration(seconds: 8),
  }) async {
    final step = _script[published.length];
    published.add(event);
    final failure = step?.call(event);
    if (failure is Future<NostrEvent>) return await failure;
    if (failure != null) throw failure;
    return event;
  }
}
