// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/channels/channel_management_actions.dart::ChannelActions.{addReaction,
// removeReaction,editMessage,deleteMessage} and channel_management_provider.dart::
// buildDeleteMessageTags. Kailo keeps the governed channel-creation holder in
// ChannelActions; these personal message mutations are the device CLIENT identity's own
// events published directly to the Relay (DD-75), with the same unconfirmed-publish rule as
// sending: an EVENT whose OK never arrived is resent unchanged (same id) on the next identical
// request, never re-signed; a definite rejection or not-sent clears it (apps/06 §4).
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/custom_emoji/custom_emoji.dart';
import '../../shared/custom_emoji/custom_emoji_provider.dart';
import '../../shared/relay/relay.dart';
import 'send_message_provider.dart';

/// Channel-scoped kind:5 deletion tags. The `h` tag lets channel-scoped
/// subscriptions observe the delete; the `e` tag points at the target event.
List<List<String>> buildDeleteMessageTags({
  required String channelId,
  required String eventId,
}) {
  return [
    ['h', channelId],
    ['e', eventId],
  ];
}

class MessageMutations {
  MessageMutations({
    required SignedEventRelay signedEventRelay,
    required UnconfirmedPublishes unconfirmed,
    required String relayBaseUrl,
    required List<CustomEmoji> Function() customEmoji,
    required bool Function() isDeliveryValid,
  }) : _relay = signedEventRelay,
       _unconfirmed = unconfirmed,
       _relayBaseUrl = relayBaseUrl,
       _customEmoji = customEmoji,
       _isDeliveryValid = isDeliveryValid;

  final SignedEventRelay _relay;
  final UnconfirmedPublishes _unconfirmed;
  final String _relayBaseUrl;
  final List<CustomEmoji> Function() _customEmoji;
  final bool Function() _isDeliveryValid;

  Future<void> addReaction(String eventId, String emoji) {
    final shortcode = normalizeShortcode(emoji);
    final emojiUrl = reactionEmojiUrl(emoji, _customEmoji());
    return _publish(
      kind: EventKind.reaction,
      content: emoji,
      tags: [
        ['e', eventId],
        if (shortcode != null && emojiUrl != null)
          ['emoji', shortcode, emojiUrl],
      ],
    );
  }

  Future<void> removeReaction(String reactionEventId, String emoji) =>
      _publish(
        kind: EventKind.deletion,
        content: '',
        tags: [
          ['e', reactionEventId],
        ],
      );

  Future<void> editMessage({
    required String channelId,
    required String eventId,
    required String content,
    List<List<String>> mediaTags = const [],
  }) => _publish(
    kind: EventKind.streamMessageEdit,
    content: content,
    tags: [
      ['h', channelId],
      ['e', eventId],
      ...mediaTags,
    ],
  );

  Future<void> deleteMessage({
    required String channelId,
    required String eventId,
  }) => _publish(
    kind: EventKind.deletion,
    content: '',
    tags: buildDeleteMessageTags(channelId: channelId, eventId: eventId),
  );

  Future<void> _publish({
    required int kind,
    required String content,
    required List<List<String>> tags,
  }) async {
    if (!_isDeliveryValid()) {
      throw StateError('Relay or signing identity changed');
    }
    final fingerprint = UnconfirmedPublishes.fingerprint(
      relayBaseUrl: _relayBaseUrl,
      pubkey: _relay.pubkey,
      kind: kind,
      content: content,
      tags: tags,
    );
    final previous = _unconfirmed.lookup(fingerprint);
    NostrEvent? signed = previous;
    try {
      if (previous != null) {
        await _relay.resubmit(previous);
      } else {
        await _relay.submit(
          kind: kind,
          content: content,
          tags: tags,
          onSigned: (event) {
            signed = event;
            _unconfirmed.remember(fingerprint, event);
          },
        );
      }
      final event = signed;
      if (event != null) _unconfirmed.settle(fingerprint, event.id);
    } on RelayPublishOutcomeUnknown {
      // Keep the signed event: the same request resends it unchanged.
      rethrow;
    } on RelayPublishFailure {
      final event = signed;
      if (event != null) _unconfirmed.settle(fingerprint, event.id);
      rethrow;
    }
  }
}

final messageMutationsProvider = Provider<MessageMutations>((ref) {
  final config = ref.watch(relayConfigProvider);
  return MessageMutations(
    signedEventRelay: SignedEventRelay(
      session: ref.read(relaySessionProvider.notifier),
      nsec: config.nsec,
    ),
    unconfirmed: ref.read(unconfirmedPublishesProvider),
    relayBaseUrl: config.baseUrl,
    customEmoji: () => ref.read(customEmojiListProvider),
    isDeliveryValid: () {
      final current = ref.read(relayConfigProvider);
      return current.baseUrl == config.baseUrl && current.nsec == config.nsec;
    },
  );
});
