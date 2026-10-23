// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/profile/profile_provider.dart::ProfileNotifier. Kailo keeps the original
// kind:0 writer for this device's CLIENT key (DD-75), with the same rule as Desktop's
// `update_profile`: merge onto the newest own kind:0, created_at strictly after it, publish once
// and confirm by reading the exact event back. A save whose OK never arrived keeps its signed
// event; saving the same field value again resends that event unchanged (apps/06 §4).
// The animated-avatar handoff and kind:20001 PresenceNotifier are not restored here.
import 'dart:async';
import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/crypto/nip_oa.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/profile/user_profile.dart';
import '../../shared/relay/relay.dart';

/// Signals that a profile write no longer belongs to the active community.
class ProfileCommunityChangedException extends StateError {
  /// Creates an error for a profile write invalidated by a community switch.
  ProfileCommunityChangedException()
    : super('Profile update cancelled because the active community changed.');
}

/// The current user's profile (kind:0 metadata) loaded over the relay
/// WebSocket. Returns null when no nsec is configured or when the user has
/// not yet published a profile.
class ProfileNotifier extends AsyncNotifier<UserProfile?> {
  Map<String, dynamic> _metadata = {};
  bool _hasHydrated = false;
  int _lastCreatedAt = 0;
  Future<void> _patchQueue = Future.value();

  /// The signed kind:0 whose OK never arrived, keyed by the patch intent.
  ({String intent, NostrEvent event})? _unconfirmed;

  @override
  Future<UserProfile?> build() {
    final config = ref.watch(relayConfigProvider);
    final pubkey = ref.watch(myPubkeyProvider);
    ref.watch(relaySessionProvider);
    final context = _ProfileWriteContext(
      config: config,
      pubkey: pubkey,
      session: ref.read(relaySessionProvider.notifier),
    );
    _hasHydrated = false;
    return _fetch(context);
  }

  Future<UserProfile?> _fetch(_ProfileWriteContext context) async {
    final myPk = context.pubkey;
    if (myPk == null) {
      _requireCurrentWriteContext(context);
      _metadata = {};
      _lastCreatedAt = 0;
      _hasHydrated = true;
      return null;
    }

    final session = context.session;
    final events = await session.fetchHistory(NostrFilters.profile(myPk));
    if (events.isEmpty) {
      _requireCurrentWriteContext(context);
      _metadata = {};
      _lastCreatedAt = 0;
      _hasHydrated = true;
      return null;
    }
    final latest = _latestProfileEvent(events)!;
    final metadata = _decodeProfileMetadata(latest);
    final data = ProfileData.fromEvent(latest);
    final profile = UserProfile(
      pubkey: data.pubkey,
      displayName: data.displayName,
      avatarUrl: data.avatarUrl,
      about: data.about,
      nip05Handle: data.nip05,
      ownerPubkey: verifiedOaOwnerPubkey(latest.tags, data.pubkey),
    );
    _requireCurrentWriteContext(context);
    _metadata = metadata;
    _lastCreatedAt = latest.createdAt;
    _hasHydrated = true;
    return profile;
  }

  Future<void> refresh() async {
    final context = _currentWriteContext();
    _hasHydrated = false;
    state = await AsyncValue.guard(() => _fetch(context));
  }

  /// Updates the current user's display name while preserving the other
  /// metadata fields in their latest kind:0 profile event.
  Future<void> updateDisplayName(String displayName) =>
      _publishProfilePatch({'display_name': displayName.trim()});

  /// Updates the current user's profile description.
  Future<void> updateAbout(String about) =>
      _publishProfilePatch({'about': about.trim()});

  /// Updates the current user's profile photo URL.
  Future<void> updateAvatarUrl(String avatarUrl) =>
      _publishProfilePatch({'picture': avatarUrl.trim()});

  Future<void> _publishProfilePatch(Map<String, dynamic> patch) {
    final context = _currentWriteContext();
    final previous = _patchQueue;
    final released = Completer<void>();
    _patchQueue = released.future;
    return () async {
      await previous;
      try {
        await _publishProfilePatchNow(patch, context);
      } finally {
        released.complete();
      }
    }();
  }

  _ProfileWriteContext _currentWriteContext() => _ProfileWriteContext(
    config: ref.read(relayConfigProvider),
    pubkey: ref.read(myPubkeyProvider),
    session: ref.read(relaySessionProvider.notifier),
  );

  Future<void> _publishProfilePatchNow(
    Map<String, dynamic> patch,
    _ProfileWriteContext context,
  ) async {
    _requireCurrentWriteContext(context);
    if (!_hasHydrated || !state.hasValue) {
      throw StateError('Cannot update profile before metadata is loaded.');
    }
    final pubkey = context.pubkey;
    if (pubkey == null) {
      throw StateError('Cannot update profile without a signing identity.');
    }
    final session = context.session;
    final relay = SignedEventRelay(session: session, nsec: context.config.nsec);
    final intent = jsonEncode([context.config.baseUrl, pubkey, patch]);
    final pending = _unconfirmed?.intent == intent ? _unconfirmed : null;

    final NostrEvent event;
    if (pending != null) {
      event = pending.event;
    } else {
      final currentEvents = await session.fetchHistory(
        NostrFilters.profile(pubkey),
      );
      _requireCurrentWriteContext(context);
      final currentHead = _latestProfileEvent(currentEvents);
      if (_lastCreatedAt > 0 &&
          (currentHead == null || currentHead.createdAt < _lastCreatedAt)) {
        throw StateError('Cannot confirm the latest profile metadata.');
      }
      final currentMetadata = currentHead == null
          ? <String, dynamic>{}
          : _decodeProfileMetadata(currentHead);
      final nextMetadata = {...currentMetadata, ...patch};
      if (patch['display_name'] == '') {
        nextMetadata
          ..remove('display_name')
          ..remove('name');
      }
      final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
      final currentCreatedAt = currentHead?.createdAt ?? 0;
      final previousCreatedAt = currentCreatedAt > _lastCreatedAt
          ? currentCreatedAt
          : _lastCreatedAt;
      final createdAt = now > previousCreatedAt ? now : previousCreatedAt + 1;
      event = relay.prepare(
        kind: EventKind.profile,
        content: jsonEncode(nextMetadata),
        tags: currentHead?.tags ?? const [],
        createdAt: createdAt,
      );
      _unconfirmed = (intent: intent, event: event);
    }

    try {
      await relay.resubmit(event);
    } on RelayPublishOutcomeUnknown {
      // Keep the signed event: the same save resends it unchanged.
      rethrow;
    } on RelayPublishFailure {
      if (identical(_unconfirmed?.event, event)) _unconfirmed = null;
      rethrow;
    }
    _requireCurrentWriteContext(context);
    final verifiedHead = _latestProfileEvent(
      await session.fetchHistory(NostrFilters.profile(pubkey)),
    );
    _requireCurrentWriteContext(context);
    if (identical(_unconfirmed?.event, event)) _unconfirmed = null;
    if (verifiedHead?.id != event.id) {
      throw StateError('Profile changed before the update could be confirmed.');
    }

    _metadata = _decodeProfileMetadata(event);
    _lastCreatedAt = event.createdAt;
    final profile = UserProfile(
      pubkey: pubkey,
      displayName:
          _metadata['display_name'] as String? ?? _metadata['name'] as String?,
      avatarUrl: _metadata['picture'] as String?,
      about: _metadata['about'] as String?,
      nip05Handle: _metadata['nip05'] as String?,
      ownerPubkey: verifiedOaOwnerPubkey(event.tags, pubkey),
    );
    state = AsyncData(profile);
    // Record the confirmed event order with the profile so an older batch
    // completing after this save cannot replace it.
    ref.read(userCacheProvider.notifier).cacheProfileEvent(event);
  }

  void _requireCurrentWriteContext(_ProfileWriteContext context) {
    final currentConfig = ref.read(relayConfigProvider);
    final currentSession = ref.read(relaySessionProvider.notifier);
    final currentPubkey = ref.read(myPubkeyProvider);
    if (currentConfig.baseUrl != context.config.baseUrl ||
        currentConfig.nsec != context.config.nsec ||
        currentPubkey != context.pubkey ||
        !identical(currentSession, context.session)) {
      throw ProfileCommunityChangedException();
    }
  }
}

class _ProfileWriteContext {
  const _ProfileWriteContext({
    required this.config,
    required this.pubkey,
    required this.session,
  });

  final RelayConfig config;
  final String? pubkey;
  final RelaySessionNotifier session;
}

NostrEvent? _latestProfileEvent(List<NostrEvent> events) {
  if (events.isEmpty) return null;
  return events.reduce((current, event) {
    if (event.createdAt != current.createdAt) {
      return event.createdAt > current.createdAt ? event : current;
    }
    // Match the relay replacement tie-breaker: the lowest event id wins.
    return event.id.compareTo(current.id) < 0 ? event : current;
  });
}

Map<String, dynamic> _decodeProfileMetadata(NostrEvent event) {
  try {
    final decoded = jsonDecode(event.content);
    return decoded is Map<String, dynamic>
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
  } on FormatException {
    return <String, dynamic>{};
  }
}

final profileProvider = AsyncNotifierProvider<ProfileNotifier, UserProfile?>(
  ProfileNotifier.new,
);
