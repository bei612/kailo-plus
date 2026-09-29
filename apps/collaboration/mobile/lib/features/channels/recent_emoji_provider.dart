import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/relay/relay.dart';
import '../../shared/theme/theme_provider.dart';

/// Frequently-used emoji, ranked and persisted.
///
/// Mirrors desktop's `useQuickReactionEmojis` (`desktop/src/features/messages/
/// ui/useQuickReactionEmojis.ts`): rank by use count, break ties by recency,
/// cap the stored set. Same storage key shape, so the two clients describe the
/// same concept even though the stores are per-device.
///
/// Persistence is namespaced by community (relay) and account pubkey, matching
/// `ComposeDraftsNotifier` — emoji history is user behaviour and must not
/// leak across an in-place community or account switch.
const _recentEmojiPrefsKey = 'buzz.quick-reaction-emojis.v1';

/// Desktop's `MAX_STORED_REACTIONS`.
const _maxStoredEmoji = 24;

/// One persisted frequently-used emoji ranking entry.
///
/// [emoji] is the Unicode glyph or custom shortcode, [count] is how many times
/// it has been selected, and [lastUsedAt] is the most recent selection time in
/// milliseconds since the Unix epoch.
class RecentEmojiEntry {
  /// The Unicode glyph or `:shortcode:` value that was selected.
  final String emoji;

  /// Number of recorded selections for [emoji].
  final int count;

  /// Most recent selection time in milliseconds since the Unix epoch.
  final int lastUsedAt;

  /// Creates a persisted ranking entry for [emoji].
  const RecentEmojiEntry({
    required this.emoji,
    required this.count,
    required this.lastUsedAt,
  });

  Map<String, dynamic> toJson() => {
    'emoji': emoji,
    'count': count,
    'lastUsedAt': lastUsedAt,
  };

  /// Returns null for anything malformed, so one bad record can't poison the
  /// whole list.
  static RecentEmojiEntry? fromJson(dynamic raw) {
    if (raw is! Map) return null;
    final emoji = raw['emoji'];
    if (emoji is! String || emoji.trim().isEmpty) return null;
    final count = raw['count'];
    final lastUsedAt = raw['lastUsedAt'];
    return RecentEmojiEntry(
      emoji: emoji,
      count: count is int && count > 0 ? count : 1,
      lastUsedAt: lastUsedAt is int && lastUsedAt > 0 ? lastUsedAt : 0,
    );
  }
}

/// Sort by count desc, then most-recent-first — desktop's `sortEntries`.
List<RecentEmojiEntry> sortRecentEmoji(List<RecentEmojiEntry> entries) {
  final sorted = [...entries];
  sorted.sort((left, right) {
    final byCount = right.count - left.count;
    if (byCount != 0) return byCount;
    return right.lastUsedAt - left.lastUsedAt;
  });
  return sorted;
}

/// Record [emoji] against [entries], returning the new capped, sorted list.
/// Pure so it can be tested without SharedPreferences.
List<RecentEmojiEntry> recordRecentEmoji(
  List<RecentEmojiEntry> entries,
  String emoji, {
  required int now,
}) {
  if (emoji.trim().isEmpty) return entries;
  final next = <RecentEmojiEntry>[];
  var matched = false;
  for (final entry in entries) {
    if (entry.emoji == emoji) {
      matched = true;
      next.add(
        RecentEmojiEntry(emoji: emoji, count: entry.count + 1, lastUsedAt: now),
      );
    } else {
      next.add(entry);
    }
  }
  if (!matched) {
    next.add(RecentEmojiEntry(emoji: emoji, count: 1, lastUsedAt: now));
  }
  final sorted = sortRecentEmoji(next);
  return sorted.length <= _maxStoredEmoji
      ? sorted
      : sorted.sublist(0, _maxStoredEmoji);
}

class RecentEmojiNotifier extends Notifier<List<RecentEmojiEntry>> {
  late String _prefsKey;

  @override
  List<RecentEmojiEntry> build() {
    final config = ref.watch(relayConfigProvider);
    final pubkey = ref.watch(myPubkeyProvider) ?? 'anon';
    _prefsKey = '$_recentEmojiPrefsKey:${config.baseUrl}:$pubkey';

    final raw = ref.read(savedPrefsProvider).getString(_prefsKey);
    if (raw == null || raw.isEmpty) return const [];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      return sortRecentEmoji(
        decoded.map(RecentEmojiEntry.fromJson).nonNulls.toList(),
      );
    } catch (_) {
      return const [];
    }
  }

  /// Record one use of [emoji]. Called from every place a user picks an emoji:
  /// the picker, the quick-reaction row, and toggling an existing pill on.
  void record(String emoji) {
    final next = recordRecentEmoji(
      state,
      emoji,
      now: DateTime.now().millisecondsSinceEpoch,
    );
    if (identical(next, state)) return;
    state = next;
    ref
        .read(savedPrefsProvider)
        .setString(
          _prefsKey,
          jsonEncode(next.map((entry) => entry.toJson()).toList()),
        );
  }
}

final recentEmojiProvider =
    NotifierProvider<RecentEmojiNotifier, List<RecentEmojiEntry>>(
      RecentEmojiNotifier.new,
    );
