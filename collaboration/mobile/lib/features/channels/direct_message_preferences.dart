part of 'direct_messages.dart';

/// Only a Core readback is a preference. Pending local data is the original
/// CAS request, never an optimistic preference or another user-state store.
class CollaborationPreferenceState {
  const CollaborationPreferenceState({
    this.preferences = const {},
    this.activeIds = const {},
    this.workspacePreferences = const {},
    this.workspaceIds = const {},
    this.version,
    this.pendingId,
    this.busy = false,
    this.error,
  });
  final Map<String, ConversationPreferenceRequest> preferences;
  final Set<String> activeIds;
  final Map<String, WorkspacePreferenceRequest> workspacePreferences;
  final Set<String> workspaceIds;
  final int? version;
  final String? pendingId;
  final bool busy;
  final Object? error;

  bool? muted(String id) => version == null || !activeIds.contains(id)
      ? null
      : preferences[id]?.muted ?? false;
  bool? starred(String id) => version == null || !workspaceIds.contains(id)
      ? null
      : workspacePreferences[id]?.starred ?? false;

  /// DD-150(3): channel mute is `workspace_preferences.muted`, the same Core
  /// readback as Star; `null` until Core has answered for an admitted channel.
  bool? workspaceMuted(String id) =>
      version == null || !workspaceIds.contains(id)
      ? null
      : workspacePreferences[id]?.muted ?? false;

  /// The confirmed mute of a channel row: DMs read `conversation_preferences`,
  /// Workspace channels `workspace_preferences` (DD-40, DD-150(3)).
  bool? channelMuted(String id, {required bool isDm}) =>
      isDm ? muted(id) : workspaceMuted(id);
}

class _CollaborationPreferenceIntent {
  const _CollaborationPreferenceIntent.conversation(this.id, this.conversation)
    : workspace = null;
  const _CollaborationPreferenceIntent.workspace(this.id, this.workspace)
    : conversation = null;
  final String id;
  final ConversationPreferenceRequest? conversation;
  final WorkspacePreferenceRequest? workspace;
  int get version => conversation?.version ?? workspace!.version;
  Map<String, dynamic> get request =>
      conversation?.toJson() ?? workspace!.toJson();
  bool get isWorkspace => workspace != null;
}

extension _DirectMessagePreferences on DirectMessages {
  String get _preferenceStorageKey =>
      'platform.conversation-preference.v1:'
      '${Uri.encodeComponent(_config.nativeApiUrl)}:'
      '${_actor.tenantId}:$principalId';

  _CollaborationPreferenceIntent? _restorePreferenceIntent() {
    final saved = _prefs.getString(_preferenceStorageKey);
    if (saved == null) return null;
    final json = jsonDecode(saved) as Map<String, dynamic>;
    final conversationId = json['conversationId'] as String?;
    final workspaceId = json['workspaceId'] as String?;
    if ((conversationId == null) == (workspaceId == null)) {
      throw const FormatException('Invalid original preference target');
    }
    final intent = workspaceId == null
        ? _CollaborationPreferenceIntent.conversation(
            conversationId!,
            ConversationPreferenceRequest.fromJson(json['request']),
          )
        : _CollaborationPreferenceIntent.workspace(
            workspaceId,
            WorkspacePreferenceRequest.fromJson(json['request']),
          );
    if (intent.id.isEmpty || intent.version < 0) {
      throw const FormatException('Invalid original preference intent');
    }
    return intent;
  }

  Future<void> _savePreferenceIntent(
    _CollaborationPreferenceIntent? intent,
  ) async {
    _fence();
    final saved = intent == null
        ? await _prefs.remove(_preferenceStorageKey)
        : await _prefs.setString(
            _preferenceStorageKey,
            jsonEncode({
              if (intent.isWorkspace)
                'workspaceId': intent.id
              else
                'conversationId': intent.id,
              'request': intent.request,
            }),
          );
    _fence();
    if (!saved) {
      throw const PlatformUnavailable('Original preference intent not stored');
    }
  }

  Future<CollaborationPreferenceState> _readPreferenceState(int floor) async {
    await _checkActor();
    final bindings = await conversations();
    final workspaces = await _workspaces();
    final response = await _send(PlatformMethod.get, '/api/v1/user-state');
    final json = response.body! as Map<String, dynamic>;
    final version = json['version'] as int;
    final raw = json['conversationPreferences'] as Map<String, dynamic>;
    if (version < floor) {
      throw const PlatformUnavailable('Older preference snapshot');
    }
    final active = {
      for (final binding in bindings)
        if (binding.state == ConversationViewState.ACTIVE) binding.id,
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
    final workspaceIds = {for (final row in workspaces) row.id};
    final workspacePreferences = <String, WorkspacePreferenceRequest>{};
    for (final entry
        in (json['workspacePreferences'] as Map<String, dynamic>).entries) {
      final value = entry.value as Map<String, dynamic>;
      final preference = WorkspacePreferenceRequest(
        muted: value['muted'] as bool,
        starred: value['starred'] as bool,
        version: version,
      );
      if (workspaceIds.contains(entry.key)) {
        workspacePreferences[entry.key] = preference;
      }
    }
    return CollaborationPreferenceState(
      preferences: Map.unmodifiable(preferences),
      activeIds: Set.unmodifiable(active),
      workspacePreferences: Map.unmodifiable(workspacePreferences),
      workspaceIds: Set.unmodifiable(workspaceIds),
      version: version,
    );
  }

  Future<void> _admitConversationPreference(String id) async {
    await _checkActor();
    final binding = (await conversations())
        .where(
          (row) => row.id == id && row.state == ConversationViewState.ACTIVE,
        )
        .singleOrNull;
    if (binding == null) {
      throw const PlatformUnavailable('Conversation is not admitted');
    }
    await _verifiedNativeConversation(binding);
  }

  Future<List<WorkspaceView>> _workspaces() async {
    final response = await _send(PlatformMethod.get, '/api/v1/workspaces');
    final rows = [
      for (final row in response.body! as List<dynamic>)
        WorkspaceView.fromJson(row as Map<String, dynamic>),
    ];
    if (rows.any((row) => row.id.isEmpty) ||
        rows.map((row) => row.id).toSet().length != rows.length) {
      throw const FormatException('Invalid workspace directory');
    }
    // Core filters ACTIVE scope/bindings and fresh authorization. Discovery
    // as an administrator does not make this an original joined channel.
    return rows.where((row) => row.isMember == true).toList();
  }

  Future<void> _admitWorkspacePreference(
    String id, {
    bool allowForum = false,
  }) async {
    await _checkActor();
    if (!(await _workspaces()).any((row) => row.id == id)) {
      throw const PlatformUnavailable('Workspace is not admitted');
    }
    final session = _ref.read(relaySessionProvider.notifier);
    if (_ref.read(relaySessionProvider).status != SessionStatus.connected) {
      throw const PlatformUnavailable('Relay is not connected');
    }
    final metadata = await session.fetchHistory(
      NostrFilters.channelMetadata([id]),
    );
    _fence();
    final event = metadata
        .where((row) => row.kind == 39000 && row.getTagValue('d') == id)
        .singleOrNull;
    if (event == null) {
      throw const PlatformUnavailable('Channel metadata is unavailable');
    }
    nostr.Event.fromMap(event.toJson());
    final channel = ChannelData.fromEvent(event);
    final members = await session.fetchHistory(NostrFilters.channelMembers(id));
    _fence();
    final roster = members
        .where((row) => row.kind == 39002 && row.getTagValue('d') == id)
        .singleOrNull;
    if (roster == null) {
      throw const PlatformUnavailable('Channel roster is unavailable');
    }
    nostr.Event.fromMap(roster.toJson());
    if (channel.id != id ||
        !(channel.channelType == 'stream' ||
            (allowForum && channel.channelType == 'forum')) ||
        channel.visibility != 'private' ||
        channel.isArchived ||
        roster.pubkey != event.pubkey ||
        !membersFromEvent(roster).any((member) => member.pubkey == _pubkey)) {
      throw const PlatformUnavailable('Workspace native projection is stale');
    }
  }
}

class CollaborationPreferenceNotifier
    extends Notifier<CollaborationPreferenceState> {
  DirectMessages? _consumer;
  _CollaborationPreferenceIntent? _original;
  bool _restoreFailed = false;
  int _epoch = 0;
  int _floor = 0;
  int? _runningEpoch;
  Future<void>? _flight;
  int? _flightEpoch;

  @override
  CollaborationPreferenceState build() {
    final consumer = ref.watch(directMessagesProvider).asData?.value;
    _consumer = consumer;
    _original = null;
    _restoreFailed = false;
    _floor = 0;
    ++_epoch;
    if (consumer == null) return const CollaborationPreferenceState();
    try {
      _original = consumer._restorePreferenceIntent();
      _floor = _original?.version ?? 0;
    } on Object catch (error) {
      _restoreFailed = true;
      return CollaborationPreferenceState(error: error);
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
    return CollaborationPreferenceState(pendingId: _original?.id);
  }

  void _ensure(DirectMessages consumer, int epoch) {
    if (!ref.mounted || _epoch != epoch || _consumer != consumer) {
      throw const PlatformUnavailable('The preference consumer changed');
    }
    consumer._fence();
  }

  void _publish(CollaborationPreferenceState snapshot, {Object? error}) {
    state = CollaborationPreferenceState(
      preferences: snapshot.preferences,
      activeIds: snapshot.activeIds,
      workspacePreferences: snapshot.workspacePreferences,
      workspaceIds: snapshot.workspaceIds,
      version: snapshot.version,
      pendingId: _original?.id,
      busy: _runningEpoch == _epoch,
      error: error,
    );
  }

  Future<CollaborationPreferenceState> _load(
    DirectMessages consumer,
    int epoch,
  ) async {
    final snapshot = await consumer._readPreferenceState(_floor);
    _ensure(consumer, epoch);
    _floor = snapshot.version!;
    final original = _original;
    if (original != null && snapshot.version! > original.version) {
      // A shared-version advance fences the old CAS, even when another client
      // changed a different preference. Never overwrite its starred value.
      await consumer._savePreferenceIntent(null);
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
  Future<void> setStarred(String id, bool starred) =>
      _start(id: id, starred: starred, workspace: true, recheck: false);

  /// DD-150(3): the original channel Mute is the caller's Workspace preference,
  /// written with the same frozen CAS request as Star (never a Governed Action).
  Future<void> setWorkspaceMuted(String id, bool muted) =>
      _start(id: id, muted: muted, workspace: true, recheck: false);

  Future<void> _start({
    String? id,
    bool? muted,
    bool? starred,
    bool workspace = false,
    required bool recheck,
  }) {
    if (_flightEpoch == _epoch && _flight != null) return _flight!;
    _flightEpoch = _epoch;
    final flight = _run(
      id: id,
      muted: muted,
      starred: starred,
      workspace: workspace,
      recheck: recheck,
    );
    _flight = flight;
    flight.whenComplete(() {
      if (identical(_flight, flight)) _flight = null;
    });
    return flight;
  }

  Future<void> _run({
    String? id,
    bool? muted,
    bool? starred,
    bool workspace = false,
    required bool recheck,
  }) async {
    final consumer = _consumer;
    final epoch = _epoch;
    if (consumer == null || _runningEpoch == epoch) return;
    if (id != null &&
        (_original != null ||
            (workspace ? state.workspaceMuted(id) : state.muted(id)) ==
                null)) {
      return;
    }
    _runningEpoch = epoch;
    _publish(state);
    try {
      _ensure(consumer, epoch);
      if (_restoreFailed) {
        _original = consumer._restorePreferenceIntent();
        _floor = _original?.version ?? 0;
        _restoreFailed = false;
      }
      final snapshot = await _load(consumer, epoch);
      if (id != null) {
        if ((workspace ? snapshot.workspaceMuted(id) : snapshot.muted(id)) ==
            null) {
          throw const PlatformUnavailable('Preference target is not admitted');
        }
        if (!workspace) {
          await consumer._admitConversationPreference(id);
        } else {
          // Star stays stream-only (original Starred); Mute also covers forums.
          await consumer._admitWorkspacePreference(
            id,
            allowForum: starred == null,
          );
        }
        _ensure(consumer, epoch);
        _original = !workspace
            ? _CollaborationPreferenceIntent.conversation(
                id,
                ConversationPreferenceRequest(
                  muted: muted!,
                  starred: snapshot.preferences[id]?.starred ?? false,
                  version: snapshot.version!,
                ),
              )
            : _CollaborationPreferenceIntent.workspace(
                id,
                WorkspacePreferenceRequest(
                  muted:
                      muted ?? snapshot.workspacePreferences[id]?.muted ?? false,
                  starred:
                      starred ??
                      snapshot.workspacePreferences[id]?.starred ??
                      false,
                  version: snapshot.version!,
                ),
              );
      }
      final original = _original;
      if (original == null || (id == null && !recheck)) return;
      if (id == null) {
        if (original.isWorkspace) {
          // A frozen Star was admitted stream-only when it was made; Core
          // re-admits the replay either way.
          await consumer._admitWorkspacePreference(
            original.id,
            allowForum: true,
          );
        } else {
          await consumer._admitConversationPreference(original.id);
        }
      }
      // Every attempt, including recovery after a failed first save, must
      // durably retain these exact bytes before it may reach the BFF.
      await consumer._savePreferenceIntent(original);
      _ensure(consumer, epoch);
      try {
        final response = await consumer._send(
          PlatformMethod.put,
          '/api/v1/user-state/${original.isWorkspace ? 'workspaces' : 'conversations'}/${Uri.encodeComponent(original.id)}',
          body: original.request,
        );
        final receipt = UserStateVersion.fromJson(
          response.body! as Map<String, dynamic>,
        );
        if (receipt.version != original.version + 1) {
          throw const FormatException('Preference version mismatch');
        }
        _ensure(consumer, epoch);
        _floor = receipt.version;
      } on PlatformApiError catch (error) {
        if (id != null &&
            error.response.status >= 400 &&
            error.response.status < 500) {
          await consumer._savePreferenceIntent(null);
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
        _publish(const CollaborationPreferenceState(), error: error);
      }
    } finally {
      if (ref.mounted && _epoch == epoch && _consumer == consumer) {
        _runningEpoch = null;
        _publish(state, error: state.error);
      }
    }
  }
}

final collaborationPreferencesProvider =
    NotifierProvider<
      CollaborationPreferenceNotifier,
      CollaborationPreferenceState
    >(CollaborationPreferenceNotifier.new);
