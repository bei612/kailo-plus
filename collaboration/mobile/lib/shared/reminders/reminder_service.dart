import 'dart:convert';
import 'dart:typed_data';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:nostr/nostr.dart' as nostr;

import '../crypto/ecdh.dart';
import '../crypto/nip44.dart';
import '../relay/relay.dart';

/// The message a reminder points back to. Mirrors the desktop
/// `ReminderTarget` shape (`desktop/src/features/reminders/lib/reminderTypes.ts`)
/// so reminders created on mobile are readable by desktop and vice versa.
class ReminderTarget {
  /// Event ID of the target message.
  final String eventId;

  /// Channel ID where the message lives.
  final String channelId;

  /// Preview text of the target message (truncated).
  final String preview;

  /// Author pubkey of the target message.
  final String authorPubkey;

  const ReminderTarget({
    required this.eventId,
    required this.channelId,
    required this.preview,
    required this.authorPubkey,
  });

  Map<String, dynamic> toJson() => {
    'eventId': eventId,
    'channelId': channelId,
    'preview': preview,
    'authorPubkey': authorPubkey,
  };
}

/// Build the NIP-ER reminder plaintext for a new pending reminder.
///
/// Matches the JSON desktop writes in `reminderService.ts#createReminder`:
/// `{"target": {...}, "note": <optional>, "status": "pending"}`. `note` is
/// omitted entirely when absent so both clients parse each other's payloads.
String buildReminderPlaintext({required ReminderTarget target, String? note}) {
  return jsonEncode({
    'target': target.toJson(),
    if (note != null && note.isNotEmpty) 'note': note,
    'status': 'pending',
  });
}

/// Generate a reminder `d`-tag with 128 bits of entropy (NIP-ER MUST).
String randomReminderDTag() {
  final bytes = secureRandomBytes(16);
  return bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
}

/// Tags for a new pending reminder event: `d` plus strict-decimal
/// `not_before`, exactly as the relay's NIP-ER validator expects.
List<List<String>> buildReminderTags({
  required String dTag,
  required int notBefore,
}) {
  if (notBefore < 0) {
    throw ArgumentError('notBefore must be a non-negative Unix timestamp');
  }
  return [
    ['d', dTag],
    ['not_before', '$notBefore'],
  ];
}

/// NIP-44 self-encryption for author-private reminder payloads. Derives the
/// conversation key to the author's own pubkey, matching the desktop's
/// `nip44_encrypt_to_self` Tauri command.
class ReminderCrypto {
  final Uint8List _conversationKey;

  ReminderCrypto(String nsec, String pubkey)
    : _conversationKey = _deriveKey(nsec, pubkey);

  static Uint8List _deriveKey(String nsec, String pubkey) {
    final privkeyHex = nostr.Nip19.decode(payload: nsec).data;
    return getConversationKey(privkeyHex, pubkey);
  }

  String encrypt(String plaintext) => nip44Encrypt(_conversationKey, plaintext);

  String decrypt(String ciphertext) =>
      nip44Decrypt(_conversationKey, ciphertext);
}

/// Creates author-private kind-30300 reminders on the relay.
/// Signed reminder events whose publish outcome is unknown, keyed by author and
/// target message. Setting a reminder on that message again resends the exact
/// signed event (same `d` tag, time and id) instead of creating a second one.
class ReminderOutcomes {
  final Map<String, NostrEvent> _events = {};

  static String key({
    required String? pubkey,
    required ReminderTarget target,
  }) => [pubkey?.toLowerCase(), target.eventId, target.channelId].join('|');

  NostrEvent? lookup(String key) => _events[key];
  void remember(String key, NostrEvent event) => _events[key] = event;
  void settle(String key) => _events.remove(key);
}

final reminderOutcomesProvider = Provider<ReminderOutcomes>(
  (ref) => ReminderOutcomes(),
);

class ReminderService {
  final SignedEventRelay _signedEventRelay;
  final ReminderCrypto _crypto;
  final ReminderOutcomes _outcomes;

  ReminderService({
    required SignedEventRelay signedEventRelay,
    required ReminderCrypto crypto,
    ReminderOutcomes? outcomes,
  }) : _signedEventRelay = signedEventRelay,
       _crypto = crypto,
       _outcomes = outcomes ?? ReminderOutcomes();

  /// Encrypt, sign, and publish a new pending reminder. [notBefore] is a Unix
  /// timestamp in seconds after which clients surface the reminder.
  Future<void> createReminder({
    required ReminderTarget target,
    required int notBefore,
    String? note,
  }) async {
    final key = ReminderOutcomes.key(
      pubkey: _signedEventRelay.pubkey,
      target: target,
    );
    final previous = _outcomes.lookup(key);
    try {
      if (previous != null) {
        await _signedEventRelay.resubmit(previous);
      } else {
        final plaintext = buildReminderPlaintext(target: target, note: note);
        final ciphertext = _crypto.encrypt(plaintext);
        await _signedEventRelay.submit(
          kind: EventKind.eventReminder,
          content: ciphertext,
          tags: buildReminderTags(
            dTag: randomReminderDTag(),
            notBefore: notBefore,
          ),
          onSigned: (event) => _outcomes.remember(key, event),
        );
      }
      _outcomes.settle(key);
    } on RelayPublishOutcomeUnknown {
      // Keep the signed event: the same request resends it unchanged.
      rethrow;
    } on RelayPublishFailure {
      _outcomes.settle(key);
      rethrow;
    }
  }
}

/// Provides a [ReminderService], or null when no signing identity is
/// available (signed out).
final reminderServiceProvider = Provider<ReminderService?>((ref) {
  final relayConfig = ref.watch(relayConfigProvider);
  final pubkey = ref.watch(myPubkeyProvider);

  final nsec = relayConfig.nsec?.trim();
  if (nsec == null || nsec.isEmpty || pubkey == null || pubkey.isEmpty) {
    return null;
  }

  final ReminderCrypto crypto;
  try {
    crypto = ReminderCrypto(nsec, pubkey);
  } catch (_) {
    return null;
  }

  return ReminderService(
    signedEventRelay: SignedEventRelay(
      session: ref.read(relaySessionProvider.notifier),
      nsec: nsec,
    ),
    crypto: crypto,
    outcomes: ref.read(reminderOutcomesProvider),
  );
});
