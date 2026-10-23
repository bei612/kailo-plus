// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/channels/channel_sections/channel_sections_provider.dart (with
// channel_sections_manager.dart and channel_sections_storage.dart): the original custom
// channel sections. Kailo (DD-125(5), DD-150(3)): the authority is
// `CollaborationUserState.sidebar_sections` in Core, the same one Web and Desktop write, not a
// NIP-44 kind:30078 document kept on this device. It is a personal preference under DD-40, not
// a Governed Action: every write is a version-CAS request through the BFF. The request is frozen
// and stored before it is sent; an unknown outcome keeps it and locks new writes, and only an
// explicit recheck after an equal-version readback may resend the same bytes. A newer version
// fences it. Nothing is shown optimistically: the list is always the last Core readback.
part of '../direct_messages.dart';

/// One custom section as Core returned it.
@immutable
class ChannelSectionRecord {
  const ChannelSectionRecord({
    required this.id,
    required this.name,
    required this.order,
    this.icon,
  });

  final String id;
  final String name;
  final String? icon;
  final int order;
}

/// The last Core readback of the caller's sections and assignments.
@immutable
class ChannelSectionsState {
  const ChannelSectionsState({
    this.sections = const [],
    this.assignments = const {},
    this.version,
    this.pending = false,
    this.busy = false,
    this.error,
  });

  /// Sorted by the original `order`.
  final List<ChannelSectionRecord> sections;

  /// Native channel ID to section ID (original `assignments`).
  final Map<String, String> assignments;
  final int? version;

  /// A frozen write whose outcome is not known yet; new writes wait for it.
  final bool pending;
  final bool busy;
  final Object? error;

  bool get isReady => version != null;
  bool get writable => isReady && !pending && !busy;

  String? sectionOf(String channelId) {
    final id = assignments[channelId];
    return sections.any((section) => section.id == id) ? id : null;
  }
}

/// One frozen BFF request: method, path and body bytes never change once stored.
class _SectionIntent {
  const _SectionIntent(this.method, this.path, this.body, this.version);

  final PlatformMethod method;
  final String path;
  final Map<String, dynamic> body;
  final int version;

  Map<String, dynamic> toJson() => {
    'method': method.name,
    'path': path,
    'body': body,
  };

  static _SectionIntent fromJson(Map<String, dynamic> json) {
    final method = PlatformMethod.values.byName(json['method'] as String);
    final path = json['path'] as String;
    final body = Map<String, dynamic>.from(json['body'] as Map);
    final version = body['version'];
    if (method == PlatformMethod.get ||
        !path.startsWith('/api/v1/user-state/sidebar-') ||
        version is! int ||
        version < 0) {
      throw const FormatException('Invalid original section intent');
    }
    return _SectionIntent(method, path, body, version);
  }
}

extension _DirectMessageSections on DirectMessages {
  String get _sectionStorageKey =>
      'platform.sidebar-section-intent.v1:'
      '${Uri.encodeComponent(_config.nativeApiUrl)}:'
      '${_actor.tenantId}:$principalId';

  _SectionIntent? _restoreSectionIntent() {
    final saved = _prefs.getString(_sectionStorageKey);
    if (saved == null) return null;
    return _SectionIntent.fromJson(jsonDecode(saved) as Map<String, dynamic>);
  }

  Future<void> _saveSectionIntent(_SectionIntent? intent) async {
    _fence();
    final saved = intent == null
        ? await _prefs.remove(_sectionStorageKey)
        : await _prefs.setString(
            _sectionStorageKey,
            jsonEncode(intent.toJson()),
          );
    _fence();
    if (!saved) {
      throw const PlatformUnavailable('Original section intent not stored');
    }
  }

  Future<ChannelSectionsState> _readSections(int floor) async {
    await _checkActor();
    final response = await _send(PlatformMethod.get, '/api/v1/user-state');
    final json = response.body! as Map<String, dynamic>;
    final version = json['version'] as int;
    if (version < floor) {
      throw const PlatformUnavailable('Older preference snapshot');
    }
    final raw = json['sidebarSections'] as Map<String, dynamic>? ?? const {};
    final sections = [
      for (final row in (raw['sections'] as List<dynamic>? ?? const []))
        ChannelSectionRecord(
          id: (row as Map<String, dynamic>)['id'] as String,
          name: row['name'] as String,
          icon: row['icon'] as String?,
          order: (row['order'] as num).toInt(),
        ),
    ]..sort((left, right) => left.order.compareTo(right.order));
    if (sections.map((section) => section.id).toSet().length !=
        sections.length) {
      throw const FormatException('Invalid sidebar sections');
    }
    final assignments = <String, String>{
      for (final entry
          in (raw['assignments'] as Map<String, dynamic>? ?? const {}).entries)
        entry.key: entry.value as String,
    };
    return ChannelSectionsState(
      sections: List.unmodifiable(sections),
      assignments: Map.unmodifiable(assignments),
      version: version,
    );
  }
}

class ChannelSectionsNotifier extends Notifier<ChannelSectionsState> {
  DirectMessages? _consumer;
  _SectionIntent? _original;
  bool _restoreFailed = false;
  int _epoch = 0;
  int _floor = 0;
  bool _running = false;

  @override
  ChannelSectionsState build() {
    final consumer = ref.watch(directMessagesProvider).asData?.value;
    _consumer = consumer;
    _original = null;
    _restoreFailed = false;
    _floor = 0;
    _running = false;
    ++_epoch;
    if (consumer == null) return const ChannelSectionsState();
    try {
      _original = consumer._restoreSectionIntent();
      _floor = _original?.version ?? 0;
    } on Object catch (error) {
      _restoreFailed = true;
      return ChannelSectionsState(error: error);
    }
    ref.listen(appLifecycleProvider, (_, next) {
      if (next == AppLifecycleState.resumed) refresh();
    });
    Future.microtask(refresh);
    return ChannelSectionsState(pending: _original != null);
  }

  void _ensure(DirectMessages consumer, int epoch) {
    if (!ref.mounted || _epoch != epoch || _consumer != consumer) {
      throw const PlatformUnavailable('The section consumer changed');
    }
    consumer._fence();
  }

  void _publish(ChannelSectionsState snapshot, {Object? error}) {
    state = ChannelSectionsState(
      sections: snapshot.sections,
      assignments: snapshot.assignments,
      version: snapshot.version,
      pending: _original != null,
      busy: _running,
      error: error,
    );
  }

  Future<ChannelSectionsState> _load(DirectMessages consumer, int epoch) async {
    final snapshot = await consumer._readSections(_floor);
    _ensure(consumer, epoch);
    _floor = snapshot.version!;
    final original = _original;
    if (original != null && snapshot.version! > original.version) {
      // Any newer version fences the old CAS; the readback is the answer.
      await consumer._saveSectionIntent(null);
      _ensure(consumer, epoch);
      _original = null;
    }
    _publish(snapshot);
    return snapshot;
  }

  /// Rereads Core; never resends.
  Future<void> refresh() => _run(null, recheck: false);

  /// The only path that may resend a frozen request (equal-version readback).
  Future<void> recheck() => _run(null, recheck: true);

  /// Original `assignChannel` / `unassignChannel` ([sectionId] null).
  Future<bool> assignChannel(String channelId, String? sectionId) => _run(
    (snapshot) => _SectionIntent(
      PlatformMethod.put,
      '/api/v1/user-state/sidebar-assignments',
      SidebarAssignmentRequest(
        channelKey: channelId,
        sectionId: sectionId,
        version: snapshot.version!,
      ).toJson(),
      snapshot.version!,
    ),
    recheck: false,
  );

  /// Original `createSection`: appended after the last section. Returns its ID
  /// once Core confirmed it.
  Future<String?> createSection(String name) async {
    final id = const Uuid().v4();
    final ok = await _run(
      (snapshot) => _SectionIntent(
        PlatformMethod.put,
        '/api/v1/user-state/sidebar-sections/$id',
        SidebarSectionRequest(
          name: name.trim(),
          order: snapshot.sections.isEmpty
              ? 0
              : snapshot.sections.last.order + 1,
          version: snapshot.version!,
        ).toJson(),
        snapshot.version!,
      ),
      recheck: false,
    );
    return ok && state.sections.any((section) => section.id == id) ? id : null;
  }

  /// Original `renameSection`: order and icon are kept as read.
  Future<bool> renameSection(String id, String name) => _run((snapshot) {
    final section = snapshot.sections.where((row) => row.id == id).singleOrNull;
    if (section == null) return null;
    return _SectionIntent(
      PlatformMethod.put,
      '/api/v1/user-state/sidebar-sections/$id',
      SidebarSectionRequest(
        name: name.trim(),
        icon: section.icon,
        order: section.order,
        version: snapshot.version!,
      ).toJson(),
      snapshot.version!,
    );
  }, recheck: false);

  /// Original `deleteSection`: its channels move back to Channels.
  Future<bool> deleteSection(String id) => _run(
    (snapshot) => snapshot.sections.any((row) => row.id == id)
        ? _SectionIntent(
            PlatformMethod.delete,
            '/api/v1/user-state/sidebar-sections/$id',
            UserStateVersion(version: snapshot.version!).toJson(),
            snapshot.version!,
          )
        : null,
    recheck: false,
  );

  /// Original `moveSectionUp` / `moveSectionDown`: the full new order.
  Future<bool> moveSection(String id, {required bool up}) => _run((snapshot) {
    final ids = [for (final row in snapshot.sections) row.id];
    final index = ids.indexOf(id);
    final target = up ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= ids.length) return null;
    ids[index] = ids[target];
    ids[target] = id;
    return _SectionIntent(
      PlatformMethod.put,
      '/api/v1/user-state/sidebar-section-order',
      SidebarSectionOrderRequest(
        sectionIds: ids,
        version: snapshot.version!,
      ).toJson(),
      snapshot.version!,
    );
  }, recheck: false);

  Future<bool> _run(
    _SectionIntent? Function(ChannelSectionsState snapshot)? build, {
    required bool recheck,
  }) async {
    final consumer = _consumer;
    final epoch = _epoch;
    if (consumer == null || _running) return false;
    if (build != null && _original != null) return false;
    _running = true;
    _publish(state, error: state.error);
    var confirmed = false;
    try {
      _ensure(consumer, epoch);
      if (_restoreFailed) {
        _original = consumer._restoreSectionIntent();
        _floor = _original?.version ?? 0;
        _restoreFailed = false;
      }
      final snapshot = await _load(consumer, epoch);
      if (build != null) {
        final intent = build(snapshot);
        if (intent == null) return false;
        _original = intent;
      }
      final original = _original;
      if (original == null || (build == null && !recheck)) {
        return build == null;
      }
      // Every attempt durably retains these exact bytes before the BFF sees them.
      await consumer._saveSectionIntent(original);
      _ensure(consumer, epoch);
      try {
        final response = await consumer._send(
          original.method,
          original.path,
          body: original.body,
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
        if (build != null &&
            error.response.status >= 400 &&
            error.response.status < 500) {
          // Only a first, definitively refused attempt may be cleared.
          await consumer._saveSectionIntent(null);
          _ensure(consumer, epoch);
          _original = null;
          await _load(consumer, epoch);
        }
        rethrow;
      }
      _ensure(consumer, epoch);
      await _load(consumer, epoch);
      if (_original != null) {
        throw const PlatformUnavailable('Section write is not confirmed');
      }
      confirmed = true;
      return true;
    } on Object catch (error) {
      if (ref.mounted && _epoch == epoch && _consumer == consumer) {
        _publish(state, error: error);
      }
      return false;
    } finally {
      if (ref.mounted && _epoch == epoch && _consumer == consumer) {
        _running = false;
        _publish(state, error: confirmed ? null : state.error);
      }
    }
  }
}

final channelSectionsProvider =
    NotifierProvider<ChannelSectionsNotifier, ChannelSectionsState>(
      ChannelSectionsNotifier.new,
    );
