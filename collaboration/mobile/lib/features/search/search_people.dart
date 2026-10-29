// Buzz 779af8886caae1317b4de962082429867ab61503 mobile/lib/features/search/search_provider.dart
// (`_searchUsers`, relay kind:0 directory search, limit 8). Kailo: people come only from the
// trusted conversation directory Core admits for this member (`/api/v1/conversation-participants`,
// DD-75) — the same people a DM can be opened with — never from the relay's kind:0 profiles.
// A name match or a prefix of one of the person's keys (hex or npub), oneself excluded.
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:client_kit/shared/platform/reason_text.dart';
import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/platform/platform_api.dart';
import '../../shared/utils/string_utils.dart';
import '../channels/direct_messages.dart';

/// The original People section shows at most this many people.
const searchPeopleLimit = 8;

/// Whether [person] matches the search [query] (case-insensitive).
@visibleForTesting
bool matchesSearchPerson(ConversationParticipant person, String query) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty) return false;
  if (person.displayName.toLowerCase().contains(q)) return true;
  for (final key in person.pubkeys) {
    final hex = key.toLowerCase();
    if (hex.startsWith(q)) return true;
    if (q.startsWith('npub') && (fullNpub(hex)?.startsWith(q) ?? false)) {
      return true;
    }
  }
  return false;
}

/// People matching [query] in the admitted conversation directory.
final searchPeopleProvider = FutureProvider.autoDispose
    .family<List<ConversationParticipant>, String>((ref, query) async {
      if (query.trim().isEmpty) return const [];
      final consumer = await ref.watch(directMessagesProvider.future);
      final directory = await ref.watch(conversationDirectoryProvider.future);
      return [
        for (final person in directory.people)
          if (person.principalId != consumer.principalId &&
              matchesSearchPerson(person, query))
            person,
      ].take(searchPeopleLimit).toList(growable: false);
    });

/// Why opening the DM from a People row did not finish, told apart the same way as the
/// profile sheet's "Message": refused, still preparing, or not confirmed. A sent but
/// unconfirmed request stays the pending command, so it is never called "failed".
String searchDirectMessageFailureText(
  Object error, {
  String? locale,
  required bool pending,
}) => switch (error) {
  DirectMessageEnded(:final task) =>
    task.reason == null
        ? platformText(PlatformMessageKey.dmDenied, locale: locale)
        : platformReasonText(task.reason!, locale: locale),
  DirectMessagePending() => platformText(
    PlatformMessageKey.dmPreparationPending,
    locale: locale,
  ),
  PlatformApiError(:final response) when response.error != null =>
    '${platformReasonText(response.error!.reason, locale: locale)} '
        '(${platformReasonCode(response.error!.reason)})',
  PlatformApiError() => platformText(PlatformMessageKey.dmUnknown, locale: locale),
  _ => platformText(
    pending
        ? PlatformMessageKey.dmUnknown
        : PlatformMessageKey.platformProfileOpenDmFailed,
    locale: locale,
  ),
};
