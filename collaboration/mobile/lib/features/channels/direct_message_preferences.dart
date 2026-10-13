part of 'direct_messages.dart';

/// Only a Core readback is a preference. Pending local data is the original
/// CAS request, never an optimistic preference or another user-state store.
class ConversationMuteState {
  const ConversationMuteState({
    this.preferences = const {},
    this.activeIds = const {},
    this.version,
    this.pendingId,
    this.busy = false,
    this.error,
  });
  final Map<String, ConversationPreferenceRequest> preferences;
  final Set<String> activeIds;
  final int? version;
  final String? pendingId;
  final bool busy;
  final Object? error;

  bool? muted(String id) => version == null || !activeIds.contains(id)
      ? null
      : preferences[id]?.muted ?? false;
}

class _ConversationMuteIntent {
  const _ConversationMuteIntent(this.id, this.request);
  final String id;
  final ConversationPreferenceRequest request;
}

extension _DirectMessagePreferences on DirectMessages {
  String get _muteStorageKey =>
      'platform.conversation-preference.v1:'
      '${Uri.encodeComponent(_config.nativeApiUrl)}:'
      '${_actor.tenantId}:$principalId';

  _ConversationMuteIntent? _restoreMuteIntent() {
    final saved = _prefs.getString(_muteStorageKey);
    if (saved == null) return null;
    final json = jsonDecode(saved) as Map<String, dynamic>;
    final id = json['conversationId'] as String;
    final request = ConversationPreferenceRequest.fromJson(json['request']);
    if (id.isEmpty || request.version < 0) {
      throw const FormatException('Invalid original preference intent');
    }
    return _ConversationMuteIntent(id, request);
  }

  Future<void> _saveMuteIntent(_ConversationMuteIntent? intent) async {
    _fence();
    final saved = intent == null
        ? await _prefs.remove(_muteStorageKey)
        : await _prefs.setString(
            _muteStorageKey,
            jsonEncode({
              'conversationId': intent.id,
              'request': intent.request.toJson(),
            }),
          );
    _fence();
    if (!saved) {
      throw const PlatformUnavailable('Original preference intent not stored');
    }
  }

  Future<ConversationMuteState> _readMuteState(int floor) async {
    await _checkActor();
    final bindings = await conversations();
    final response = await _send(PlatformMethod.get, '/api/v1/user-state');
    final json = response.body! as Map<String, dynamic>;
    final version = json['version'] as int;
    final raw = json['conversationPreferences'] as Map<String, dynamic>;
    if (version < floor) {
      throw const PlatformUnavailable('Older preference snapshot');
    }
    final active = {
      for (final binding in bindings)
        if (binding.state == ItemState.ACTIVE) binding.id,
    };
    final preferences = <String, ConversationPreferenceRequest>{};
    for (final entry in raw.entries) {
      final value = entry.value as Map<String, dynamic>;
      final preference = ConversationPreferenceRequest(
        muted: value['muted'] as bool,
        starred: value['starred'] as bool,
        version: version,
      );
      if (active.contains(entry.key)) preferences[entry.key] = preference;
    }
    return ConversationMuteState(
      preferences: Map.unmodifiable(preferences),
      activeIds: Set.unmodifiable(active),
      version: version,
    );
  }

  Future<void> _admitMute(String id) async {
    await _checkActor();
    final binding = (await conversations())
        .where((row) => row.id == id && row.state == ItemState.ACTIVE)
        .singleOrNull;
    if (binding == null) {
      throw const PlatformUnavailable('Conversation is not admitted');
    }
    await _verifiedNativeConversation(binding);
  }
}

class ConversationMuteNotifier extends Notifier<ConversationMuteState> {
  DirectMessages? _consumer;
  _ConversationMuteIntent? _original;
  bool _restoreFailed = false;
  int _epoch = 0;
  int _floor = 0;
  int? _runningEpoch;
  Future<void>? _flight;
  int? _flightEpoch;

  @override
  ConversationMuteState build() {
    final consumer = ref.watch(directMessagesProvider).asData?.value;
    _consumer = consumer;
    _original = null;
    _restoreFailed = false;
    _floor = 0;
    ++_epoch;
    if (consumer == null) return const ConversationMuteState();
    try {
      _original = consumer._restoreMuteIntent();
      _floor = _original?.request.version ?? 0;
    } on Object catch (error) {
      _restoreFailed = true;
      return ConversationMuteState(error: error);
    }
    ref.listen(appLifecycleProvider, (_, next) {
      if (next == AppLifecycleState.resumed) refresh();
    });
    ref.listen(relaySessionProvider.select((session) => session.status), (
      previous,
      next,
    ) {
      if (next == SessionStatus.connected && previous != next) refresh();
    });
    Future.microtask(refresh);
    return ConversationMuteState(pendingId: _original?.id);
  }

  void _ensure(DirectMessages consumer, int epoch) {
    if (!ref.mounted || _epoch != epoch || _consumer != consumer) {
      throw const PlatformUnavailable('The preference consumer changed');
    }
    consumer._fence();
  }

  void _publish(ConversationMuteState snapshot, {Object? error}) {
    state = ConversationMuteState(
      preferences: snapshot.preferences,
      activeIds: snapshot.activeIds,
      version: snapshot.version,
      pendingId: _original?.id,
      busy: _runningEpoch == _epoch,
      error: error,
    );
  }

  Future<ConversationMuteState> _load(
    DirectMessages consumer,
    int epoch,
  ) async {
    final snapshot = await consumer._readMuteState(_floor);
    _ensure(consumer, epoch);
    _floor = snapshot.version!;
    final original = _original;
    if (original != null && snapshot.version! > original.request.version) {
      // A shared-version advance fences the old CAS, even when another client
      // changed a different preference. Never overwrite its starred value.
      await consumer._saveMuteIntent(null);
      _ensure(consumer, epoch);
      _original = null;
    }
    _publish(snapshot);
    return snapshot;
  }

  /// Refresh never replays PUT. Only an explicit user recheck may replay the
  /// same persisted request after an equal-version authoritative readback.
  Future<void> refresh() => _start(recheck: false);
  Future<void> recheck() => _start(recheck: true);
  Future<void> setMuted(String id, bool muted) =>
      _start(id: id, muted: muted, recheck: false);

  Future<void> _start({String? id, bool? muted, required bool recheck}) {
    if (_flightEpoch == _epoch && _flight != null) return _flight!;
    _flightEpoch = _epoch;
    final flight = _run(id: id, muted: muted, recheck: recheck);
    _flight = flight;
    flight.whenComplete(() {
      if (identical(_flight, flight)) _flight = null;
    });
    return flight;
  }

  Future<void> _run({String? id, bool? muted, required bool recheck}) async {
    final consumer = _consumer;
    final epoch = _epoch;
    if (consumer == null || _runningEpoch == epoch) return;
    if (id != null && (_original != null || state.muted(id) == null)) return;
    _runningEpoch = epoch;
    _publish(state);
    try {
      _ensure(consumer, epoch);
      if (_restoreFailed) {
        _original = consumer._restoreMuteIntent();
        _floor = _original?.request.version ?? 0;
        _restoreFailed = false;
      }
      final snapshot = await _load(consumer, epoch);
      if (id != null) {
        if (snapshot.muted(id) == null) {
          throw const PlatformUnavailable('Conversation is not admitted');
        }
        await consumer._admitMute(id);
        _ensure(consumer, epoch);
        _original = _ConversationMuteIntent(
          id,
          ConversationPreferenceRequest(
            muted: muted!,
            starred: snapshot.preferences[id]?.starred ?? false,
            version: snapshot.version!,
          ),
        );
      }
      final original = _original;
      if (original == null || (id == null && !recheck)) return;
      if (id == null) await consumer._admitMute(original.id);
      // Every attempt, including recovery after a failed first save, must
      // durably retain these exact bytes before it may reach the BFF.
      await consumer._saveMuteIntent(original);
      _ensure(consumer, epoch);
      try {
        final response = await consumer._send(
          PlatformMethod.put,
          '/api/v1/user-state/conversations/${Uri.encodeComponent(original.id)}',
          body: original.request.toJson(),
        );
        final receipt = UserStateVersion.fromJson(
          response.body! as Map<String, dynamic>,
        );
        if (receipt.version != original.request.version + 1) {
          throw const FormatException('Preference version mismatch');
        }
        _ensure(consumer, epoch);
        _floor = receipt.version;
      } on PlatformApiError catch (error) {
        if (id != null &&
            error.response.status >= 400 &&
            error.response.status < 500) {
          await consumer._saveMuteIntent(null);
          _ensure(consumer, epoch);
          _original = null;
          // Only this first, definitively rejected attempt may be cleared.
          // A recheck rejection cannot disprove a still-in-flight old PUT.
          await _load(consumer, epoch);
        }
        rethrow;
      }
      _ensure(consumer, epoch);
      await _load(consumer, epoch);
      if (_original != null) {
        throw const PlatformUnavailable('Preference write is not confirmed');
      }
    } on Object catch (error) {
      if (ref.mounted && _epoch == epoch && _consumer == consumer) {
        // No optimistic success, and an unconfirmed intent still locks new
        // writes. Read/query failures do not turn UNKNOWN into a failed PUT.
        _publish(const ConversationMuteState(), error: error);
      }
    } finally {
      if (ref.mounted && _epoch == epoch && _consumer == consumer) {
        _runningEpoch = null;
        _publish(state, error: state.error);
      }
    }
  }
}

final conversationMuteProvider =
    NotifierProvider<ConversationMuteNotifier, ConversationMuteState>(
      ConversationMuteNotifier.new,
    );
