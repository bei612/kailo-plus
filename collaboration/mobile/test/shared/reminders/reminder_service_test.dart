import 'dart:convert';

import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/reminders/reminder_service.dart';
import 'package:buzz/shared/reminders/reminder_time_presets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostr/nostr.dart' as nostr;

void main() {
  const target = ReminderTarget(
    eventId: 'event-1',
    channelId: 'channel-1',
    preview: 'hello world',
    authorPubkey: 'author-pk',
  );

  group('buildReminderPlaintext', () {
    test('matches the desktop NIP-ER content shape', () {
      final plaintext = buildReminderPlaintext(target: target, note: 'ping');
      expect(jsonDecode(plaintext), {
        'target': {
          'eventId': 'event-1',
          'channelId': 'channel-1',
          'preview': 'hello world',
          'authorPubkey': 'author-pk',
        },
        'note': 'ping',
        'status': 'pending',
      });
    });

    test('omits note when absent or empty', () {
      for (final note in [null, '']) {
        final decoded =
            jsonDecode(buildReminderPlaintext(target: target, note: note))
                as Map<String, dynamic>;
        expect(decoded.containsKey('note'), isFalse);
        expect(decoded['status'], 'pending');
      }
    });
  });

  group('randomReminderDTag', () {
    test('is 32 lowercase hex chars (128 bits)', () {
      final dTag = randomReminderDTag();
      expect(dTag, matches(RegExp(r'^[0-9a-f]{32}$')));
    });

    test('is unique across calls', () {
      expect(randomReminderDTag(), isNot(randomReminderDTag()));
    });
  });

  group('buildReminderTags', () {
    test('emits d and strict-decimal not_before tags', () {
      expect(buildReminderTags(dTag: 'abc', notBefore: 1753000000), [
        ['d', 'abc'],
        ['not_before', '1753000000'],
      ]);
    });

    test('rejects negative timestamps', () {
      expect(
        () => buildReminderTags(dTag: 'abc', notBefore: -1),
        throwsArgumentError,
      );
    });
  });

  group('ReminderCrypto', () {
    test('encrypts to self and decrypts back', () {
      final keys = nostr.Keys.generate();
      final crypto = ReminderCrypto(keys.nsec, keys.public);

      const plaintext = '{"status":"pending","note":"hi"}';
      final ciphertext = crypto.encrypt(plaintext);
      expect(ciphertext, isNot(contains('pending')));
      expect(crypto.decrypt(ciphertext), plaintext);
    });
  });

  group('reminder time presets', () {
    test('presets resolve strictly in the future', () {
      final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
      for (final preset in reminderTimePresets) {
        expect(
          preset.getTimestamp(),
          greaterThan(now),
          reason: preset.label.name,
        );
      }
    });

    test('nextDayAt9am rolls past instants forward', () {
      final tenAm = DateTime(2026, 7, 25, 10);
      final next = nextDayAt9am(0, now: tenAm);
      expect(
        DateTime.fromMillisecondsSinceEpoch(next * 1000),
        DateTime(2026, 7, 26, 9),
      );
    });

    test('nextDayAt9am keeps future same-day instants', () {
      final eightAm = DateTime(2026, 7, 25, 8);
      final next = nextDayAt9am(0, now: eightAm);
      expect(
        DateTime.fromMillisecondsSinceEpoch(next * 1000),
        DateTime(2026, 7, 25, 9),
      );
    });

    test('daysUntilNextMonday is 1-7 and lands on Monday', () {
      for (var day = 20; day < 27; day++) {
        final now = DateTime(2026, 7, day);
        final days = daysUntilNextMonday(now);
        expect(days, inInclusiveRange(1, 7));
        expect(now.add(Duration(days: days)).weekday, DateTime.monday);
      }
    });

    test('combineCustomDateTime rejects past instants', () {
      final yesterday = DateTime.now().subtract(const Duration(days: 1));
      expect(combineCustomDateTime(yesterday, 9, 0), isNull);

      final tomorrow = DateTime.now().add(const Duration(days: 1));
      expect(combineCustomDateTime(tomorrow, 9, 0), isNotNull);
    });
  });

  group('unknown publish outcome (DD-81)', () {
    test('setting a reminder on the same message again resends the same '
        'signed event', () async {
      final keys = nostr.Keys.generate();
      final relay = _ScriptedRelay(keys.nsec);
      final service = ReminderService(
        signedEventRelay: relay,
        crypto: ReminderCrypto(keys.nsec, keys.public),
        outcomes: ReminderOutcomes(),
      );
      relay.next = const RelayPublishOutcomeUnknown('x', 'timeout');
      await expectLater(
        service.createReminder(target: target, notBefore: 4102444800),
        throwsA(isA<RelayPublishOutcomeUnknown>()),
      );
      relay.next = null;
      await service.createReminder(target: target, notBefore: 4102448400);
      expect(relay.submitted, hasLength(1));
      expect(relay.resubmitted.single.id, relay.submitted.single.id);
      expect(
        relay.resubmitted.single.tags.firstWhere(
          (t) => t[0] == 'not_before',
        )[1],
        '4102444800',
      );
      // Settled: the next request signs a new reminder.
      await service.createReminder(target: target, notBefore: 4102448400);
      expect(relay.submitted, hasLength(2));
    });

    test('a definite rejection releases the request', () async {
      final keys = nostr.Keys.generate();
      final relay = _ScriptedRelay(keys.nsec);
      final service = ReminderService(
        signedEventRelay: relay,
        crypto: ReminderCrypto(keys.nsec, keys.public),
      );
      relay.next = const RelayPublishRejected('x', 'blocked: no');
      await expectLater(
        service.createReminder(target: target, notBefore: 4102444800),
        throwsA(isA<RelayPublishRejected>()),
      );
      relay.next = null;
      await service.createReminder(target: target, notBefore: 4102444800);
      expect(relay.submitted, hasLength(2));
      expect(relay.resubmitted, isEmpty);
    });
  });
}

class _ScriptedRelay extends SignedEventRelay {
  _ScriptedRelay(String nsec)
    : super(session: RelaySessionNotifier(), nsec: nsec);

  Object? next;
  final List<NostrEvent> submitted = [];
  final List<NostrEvent> resubmitted = [];

  @override
  Future<NostrEvent> submit({
    required int kind,
    required String content,
    required List<List<String>> tags,
    int? createdAt,
    void Function(NostrEvent event)? onSigned,
  }) async {
    final event = prepare(kind: kind, content: content, tags: tags);
    onSigned?.call(event);
    submitted.add(event);
    final error = next;
    if (error != null) throw error;
    return event;
  }

  @override
  Future<NostrEvent> resubmit(NostrEvent event) async {
    resubmitted.add(event);
    final error = next;
    if (error != null) throw error;
    return event;
  }
}
