import 'nostr_models.dart';

/// Canonical [NostrFilter] constructors for common Buzz queries.
///
/// Centralising filter shapes keeps relay queries consistent across providers
/// and makes kind/tag conventions easy to audit.
abstract final class NostrFilters {
  /// Channel metadata for the given channel IDs.
  static NostrFilter channelMetadata(List<String> ids) =>
      NostrFilter(kinds: [39000], tags: {'#d': ids}, limit: ids.length);

  /// Members list for a single channel.
  static NostrFilter channelMembers(String channelId) => NostrFilter(
    kinds: [39002],
    tags: {
      '#d': [channelId],
    },
    limit: 1,
  );

  /// A single user's profile (kind:0).
  static NostrFilter profile(String pubkey) =>
      NostrFilter(kinds: [0], authors: [pubkey], limit: 1);

  /// Batch user profiles (kind:0) for multiple pubkeys.
  static NostrFilter profilesBatch(List<String> pubkeys) =>
      NostrFilter(kinds: [0], authors: pubkeys, limit: pubkeys.length);

  /// Channel messages (all event kinds that appear in channels).
  static NostrFilter messages(
    String channelId, {
    int limit = 200,
    int? until,
  }) => NostrFilter(
    kinds: EventKind.channelEventKinds,
    tags: {
      '#h': [channelId],
    },
    limit: limit,
    until: until,
  );

  /// Agent profiles (kind:10100).
  static NostrFilter agentProfiles() =>
      const NostrFilter(kinds: [10100], limit: 100);
}
