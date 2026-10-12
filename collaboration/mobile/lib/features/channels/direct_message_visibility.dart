part of 'direct_messages.dart';

extension _DirectMessageVisibility on DirectMessages {
  void _validateReopen(NostrEvent event) {
    nostr.Event.fromMap(event.toJson());
    if (_submission == null ||
        event.pubkey != _pubkey ||
        event.kind != 41010 ||
        event.content.isNotEmpty ||
        event.tags.length != 1 ||
        event.tags.single.length != 2 ||
        event.tags.single.first != 'h' ||
        event.tags.single.last.isEmpty) {
      throw const FormatException('Invalid original personal DM reopen');
    }
  }

  Future<Set<String>> _hidden(Channel channel) async {
    final events = await _ref
        .read(relaySessionProvider.notifier)
        .fetchHistory(
          NostrFilter(
            kinds: const [30622],
            authors: [channel.createdBy],
            tags: {
              '#d': [_pubkey],
              '#p': [_pubkey],
            },
            limit: 1,
          ),
        );
    _fence();
    return hiddenDirectMessages(
      events,
      relayPubkey: channel.createdBy,
      viewer: _pubkey,
    );
  }
}

/// Buzz NIP-DV's relay-signed, viewer-specific visibility authority. Missing
/// initial snapshot means no hidden DMs; malformed/wrong-owner never means so.
Set<String> hiddenDirectMessages(
  List<NostrEvent> events, {
  required String relayPubkey,
  required String viewer,
}) {
  if (events.length > 1) {
    throw const FormatException('Invalid DM visibility snapshot');
  }
  final hidden = <String>{};
  for (final event in events) {
    nostr.Event.fromMap(event.toJson());
    final owners = event.tags.where(
      (tag) => tag.isNotEmpty && tag.first == 'p',
    );
    final identifiers = event.tags.where(
      (tag) => tag.isNotEmpty && tag.first == 'd',
    );
    if (event.kind != 30622 ||
        event.pubkey != relayPubkey ||
        owners.length != 1 ||
        identifiers.length != 1 ||
        !listEquals(owners.single, ['p', viewer]) ||
        !listEquals(identifiers.single, ['d', viewer])) {
      throw const FormatException('DM visibility belongs to another identity');
    }
    for (final tag in event.tags) {
      if (tag.isNotEmpty && tag.first == 'h') {
        if (tag.length != 2 || tag.last.isEmpty) {
          throw const FormatException('Invalid hidden DM channel');
        }
        hidden.add(tag.last);
      }
    }
  }
  return hidden;
}
