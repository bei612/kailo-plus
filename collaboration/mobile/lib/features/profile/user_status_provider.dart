// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/profile/user_status_provider.dart. Kailo keeps the original
// NIP-38 status (kind:30315, d=general) signed by this device's CLIENT key and published
// directly to the Relay (DD-75, DD-120). Publishing follows the unconfirmed-publish rule
// (apps/06 §4): an EVENT whose OK never arrived is kept and the same save resends it
// unchanged (same id), never re-signed; a definite rejection or not-sent clears it.
import 'dart:async';
import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/relay/relay.dart';
import 'user_status.dart';
import 'user_status_cache_provider.dart';

/// Manages the current user's own NIP-38 status (kind:30315, d=general).
///
/// Fetches the existing status on build and provides [setStatus] / [clearStatus]
/// for publishing. No heartbeat needed — user status events are parameterised
/// replaceable, not ephemeral.
class UserStatusNotifier extends AsyncNotifier<UserStatus?> {
  Timer? _expirationTimer;

  /// The signed status whose OK never arrived, keyed by the save intent.
  ({String intent, NostrEvent event})? _unconfirmed;

  /// Newest created_at seen for our own status; NIP-01 replaces by created_at,
  /// so two saves within one second must not leave the older one standing.
  int _latestCreatedAt = 0;

  @override
  Future<UserStatus?> build() async {
    ref.watch(relayConfigProvider);
    ref.watch(relaySessionProvider);
    ref.onDispose(() {
      _expirationTimer?.cancel();
      _expirationTimer = null;
    });

    final status = await _fetch();
    _scheduleExpiration(status);
    return status;
  }

  Future<UserStatus?> _fetch() async {
    final pubkey = _currentPubkey();
    if (pubkey == null) return null;

    final sessionState = ref.read(relaySessionProvider);
    if (sessionState.status != SessionStatus.connected) return null;

    try {
      final session = ref.read(relaySessionProvider.notifier);
      final events = await session.fetchHistory(
        NostrFilter(
          kinds: const [EventKind.userStatus],
          authors: [pubkey],
          tags: const {
            '#d': ['general'],
          },
          limit: 1,
        ),
      );

      if (events.isEmpty) return null;

      // Pick the most recent event.
      final latest = events.reduce(
        (a, b) => a.createdAt >= b.createdAt ? a : b,
      );
      if (latest.createdAt > _latestCreatedAt) {
        _latestCreatedAt = latest.createdAt;
      }
      final status = UserStatus.fromEvent(latest);
      final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
      return status.isEmpty || status.isExpiredAt(now) ? null : status;
    } catch (_) {
      return null;
    }
  }

  /// Publishes a status. [duration] counts from now; [until] is an absolute
  /// expiry; neither means no expiry. Throws [RelayPublishOutcomeUnknown] when
  /// the Relay never answered — saving the same status again resends the same
  /// signed event — and other [RelayPublishFailure]s when it was not stored.
  Future<void> setStatus(
    String text,
    String emoji, {
    Duration? duration,
    DateTime? until,
  }) async {
    final trimmed = text.trim();
    final config = ref.read(relayConfigProvider);
    final relay = SignedEventRelay(
      session: ref.read(relaySessionProvider.notifier),
      nsec: config.nsec,
    );
    final pubkey = relay.pubkey?.toLowerCase();
    if (pubkey == null) return;

    final intent = jsonEncode([
      config.baseUrl,
      pubkey,
      trimmed,
      emoji,
      duration?.inSeconds,
      until?.millisecondsSinceEpoch,
    ]);
    final pending = _unconfirmed?.intent == intent ? _unconfirmed : null;
    final NostrEvent event;
    if (pending != null) {
      event = pending.event;
    } else {
      final nowSeconds = DateTime.now().millisecondsSinceEpoch ~/ 1000;
      final expiresAt =
          until ?? (duration == null ? null : DateTime.now().add(duration));
      final tags = <List<String>>[
        ['d', 'general'],
      ];
      if (emoji.isNotEmpty) {
        tags.add(['emoji', emoji]);
      }
      if (expiresAt != null) {
        tags.add([
          'expiration',
          '${expiresAt.millisecondsSinceEpoch ~/ 1000}',
        ]);
      }
      final createdAt = nowSeconds > _latestCreatedAt
          ? nowSeconds
          : _latestCreatedAt + 1;
      event = relay.prepare(
        kind: EventKind.userStatus,
        content: trimmed,
        tags: tags,
        createdAt: createdAt,
      );
      _unconfirmed = (intent: intent, event: event);
    }

    try {
      await relay.resubmit(event);
    } on RelayPublishOutcomeUnknown {
      rethrow;
    } on RelayPublishFailure {
      if (identical(_unconfirmed?.event, event)) _unconfirmed = null;
      rethrow;
    }
    if (identical(_unconfirmed?.event, event)) _unconfirmed = null;
    if (ref.read(relayConfigProvider) != config) return;
    if (event.createdAt > _latestCreatedAt) _latestCreatedAt = event.createdAt;

    final published = UserStatus.fromEvent(event);
    final newStatus = published.isEmpty ? null : published;
    state = AsyncValue.data(newStatus);
    _scheduleExpiration(newStatus);

    // Also update the shared cache so other UI reads stay consistent.
    ref.read(userStatusCacheProvider.notifier).updateStatus(pubkey, newStatus);
  }

  Future<void> clearStatus() => setStatus('', '');

  void _scheduleExpiration(UserStatus? status) {
    _expirationTimer?.cancel();
    _expirationTimer = null;
    final deadline = status?.expirationDateTime;
    if (deadline == null) return;

    final remaining = deadline.difference(DateTime.now());
    _expirationTimer = Timer(
      remaining.isNegative ? Duration.zero : remaining,
      _expireCurrentStatus,
    );
  }

  void _expireCurrentStatus() {
    final current = state.asData?.value;
    if (current == null) return;
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    if (!current.isExpiredAt(now)) {
      // Timer callbacks can land just before the Unix-second boundary.
      _expirationTimer = Timer(
        const Duration(milliseconds: 50),
        _expireCurrentStatus,
      );
      return;
    }

    state = const AsyncValue.data(null);
    final pubkey = _currentPubkey();
    if (pubkey != null) {
      ref.read(userStatusCacheProvider.notifier).updateStatus(pubkey, null);
    }
  }

  String? _currentPubkey() =>
      pubkeyFromNsec(ref.read(relayConfigProvider).nsec)?.toLowerCase();
}

final userStatusProvider =
    AsyncNotifierProvider<UserStatusNotifier, UserStatus?>(
      UserStatusNotifier.new,
    );
