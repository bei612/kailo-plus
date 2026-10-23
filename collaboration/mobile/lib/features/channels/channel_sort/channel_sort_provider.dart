// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/channels/channel_sort/channel_sort_provider.dart (with
// channel_sort_manager.dart and channel_sort_storage.dart): the original per-group sidebar
// sort (Recent / A–Z). Kailo (DD-125(5), DD-150(3)): the authority is
// `CollaborationUserState.sidebar_sort` in Core, the same one Web and Desktop write, not a
// NIP-44 kind:30078 document on this device. It is a personal preference under DD-40, not a
// Governed Action: every write is one version-CAS request through the BFF. The request is
// frozen and stored before it is sent; an unknown outcome keeps it and locks new writes, and
// only an explicit recheck after an equal-version readback may resend the same bytes. A newer
// version fences it. Nothing is shown optimistically: modes are always the last Core readback.
part of '../direct_messages.dart';

/// Original `ChannelSortMode`.
enum ChannelSortMode {
  alpha('alpha'),
  recent('recent');

  const ChannelSortMode(this.wireValue);

  final String wireValue;

  static ChannelSortMode? fromWire(Object? value) {
    for (final mode in values) {
      if (mode.wireValue == value) return mode;
    }
    return null;
  }
}

/// Original `kDefaultSortMode`.
const ChannelSortMode kDefaultSortMode = ChannelSortMode.alpha;

/// Original `sectionSortGroupKey`.
String sectionSortGroupKey(String sectionId) => 'section:$sectionId';

/// Original fixed groups; custom sections use [sectionSortGroupKey].
const kSortGroupStarred = 'starred';
const kSortGroupChannels = 'channels';
const kSortGroupDms = 'dms';

/// Original `compareChannelsByName`: case-insensitive name, then ID.
int compareChannelsByName(Channel left, Channel right) {
  final name = left.name.toLowerCase().compareTo(right.name.toLowerCase());
  return name != 0 ? name : left.id.compareTo(right.id);
}

/// Original `sortChannelsForList`: A–Z by name, or Recent by last message time
/// (channels without messages last, ties by name).
List<Channel> sortChannelsForList(
  List<Channel> channels,
  ChannelSortMode mode, {
  int Function(Channel left, Channel right) byName = compareChannelsByName,
}) {
  final sorted = channels.toList();
  if (mode == ChannelSortMode.alpha) {
    sorted.sort(byName);
    return sorted;
  }
  sorted.sort((left, right) {
    final leftMs = left.lastMessageAt?.millisecondsSinceEpoch;
    final rightMs = right.lastMessageAt?.millisecondsSinceEpoch;
    if (leftMs != null && rightMs != null && leftMs != rightMs) {
      return rightMs.compareTo(leftMs);
    }
    if (leftMs != null && rightMs == null) return -1;
    if (leftMs == null && rightMs != null) return 1;
    return byName(left, right);
  });
  return sorted;
}

/// The last Core readback of the caller's group sort modes.
@immutable
class ChannelSortState {
  const ChannelSortState({
    this.modes = const {},
    this.version,
    this.pending = false,
    this.busy = false,
    this.error,
  });

  final Map<String, ChannelSortMode> modes;
  final int? version;

  /// A frozen write whose outcome is not known yet; new writes wait for it.
  final bool pending;
  final bool busy;
  final Object? error;

  bool get isReady => version != null;
  bool get writable => isReady && !pending && !busy;

  ChannelSortMode sortModeFor(String groupKey) =>
      modes[groupKey] ?? kDefaultSortMode;
}

/// One frozen BFF request; its body bytes never change once stored.
class _SortIntent {
  const _SortIntent(this.body, this.version);

  static const path = '/api/v1/user-state/sidebar-sort';

  final Map<String, dynamic> body;
  final int version;

  Map<String, dynamic> toJson() => {'body': body};

  static _SortIntent fromJson(Map<String, dynamic> json) {
    final body = Map<String, dynamic>.from(json['body'] as Map);
    final version = body['version'];
    if (version is! int ||
        version < 0 ||
        body['groupKey'] is! String ||
        ChannelSortMode.fromWire(body['mode']) == null) {
      throw const FormatException('Invalid original sort intent');
    }
    return _SortIntent(body, version);
  }
}

extension _DirectMessageSort on DirectMessages {
  String get _sortStorageKey =>
      'platform.sidebar-sort-intent.v1:'
      '${Uri.encodeComponent(_config.nativeApiUrl)}:'
      '${_actor.tenantId}:$principalId';

  _SortIntent? _restoreSortIntent() {
    final saved = _prefs.getString(_sortStorageKey);
    if (saved == null) return null;
    return _SortIntent.fromJson(jsonDecode(saved) as Map<String, dynamic>);
  }

  Future<void> _saveSortIntent(_SortIntent? intent) async {
    _fence();
    final saved = intent == null
        ? await _prefs.remove(_sortStorageKey)
        : await _prefs.setString(_sortStorageKey, jsonEncode(intent.toJson()));
    _fence();
    if (!saved) {
      throw const PlatformUnavailable('Original sort intent not stored');
    }
  }

  Future<ChannelSortState> _readSort(int floor) async {
    await _checkActor();
    final response = await _send(PlatformMethod.get, '/api/v1/user-state');
    final json = response.body! as Map<String, dynamic>;
    final version = json['version'] as int;
    if (version < floor) {
      throw const PlatformUnavailable('Older preference snapshot');
    }
    final raw = json['sidebarSort'] as Map<String, dynamic>? ?? const {};
    final modes = <String, ChannelSortMode>{};
    for (final entry in raw.entries) {
      final mode = ChannelSortMode.fromWire(
        (entry.value as Map<String, dynamic>)['mode'],
      );
      if (mode == null) throw const FormatException('Invalid sidebar sort');
      modes[entry.key] = mode;
    }
    return ChannelSortState(modes: Map.unmodifiable(modes), version: version);
  }
}

class ChannelSortNotifier extends Notifier<ChannelSortState> {
  DirectMessages? _consumer;
  _SortIntent? _original;
  bool _restoreFailed = false;
  int _epoch = 0;
  int _floor = 0;
  bool _running = false;

  @override
  ChannelSortState build() {
    final consumer = ref.watch(directMessagesProvider).asData?.value;
    _consumer = consumer;
    _original = null;
    _restoreFailed = false;
    _floor = 0;
    _running = false;
    ++_epoch;
    if (consumer == null) return const ChannelSortState();
    try {
      _original = consumer._restoreSortIntent();
      _floor = _original?.version ?? 0;
    } on Object catch (error) {
      _restoreFailed = true;
      return ChannelSortState(error: error);
    }
    ref.listen(appLifecycleProvider, (_, next) {
      if (next == AppLifecycleState.resumed) refresh();
    });
    Future.microtask(refresh);
    return ChannelSortState(pending: _original != null);
  }

  void _ensure(DirectMessages consumer, int epoch) {
    if (!ref.mounted || _epoch != epoch || _consumer != consumer) {
      throw const PlatformUnavailable('The sort consumer changed');
    }
    consumer._fence();
  }

  void _publish(ChannelSortState snapshot, {Object? error}) {
    state = ChannelSortState(
      modes: snapshot.modes,
      version: snapshot.version,
      pending: _original != null,
      busy: _running,
      error: error,
    );
  }

  Future<ChannelSortState> _load(DirectMessages consumer, int epoch) async {
    final snapshot = await consumer._readSort(_floor);
    _ensure(consumer, epoch);
    _floor = snapshot.version!;
    final original = _original;
    if (original != null && snapshot.version! > original.version) {
      // Any newer version fences the old CAS; the readback is the answer.
      await consumer._saveSortIntent(null);
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

  /// Original `setSortModeFor`. A section group must still exist ([liveSectionIds]).
  Future<bool> setSortModeFor(
    String groupKey,
    ChannelSortMode mode, {
    Iterable<String> liveSectionIds = const [],
  }) {
    if (groupKey.startsWith('section:') &&
        !liveSectionIds.contains(groupKey.substring('section:'.length))) {
      return Future.value(false);
    }
    return _run(
      (snapshot) => snapshot.sortModeFor(groupKey) == mode
          ? null
          : _SortIntent(
              SidebarSortRequest(
                groupKey: groupKey,
                mode: mode == ChannelSortMode.recent
                    ? SidebarSortMode.RECENT
                    : SidebarSortMode.ALPHA,
                version: snapshot.version!,
              ).toJson(),
              snapshot.version!,
            ),
      recheck: false,
    );
  }

  Future<bool> _run(
    _SortIntent? Function(ChannelSortState snapshot)? build, {
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
        _original = consumer._restoreSortIntent();
        _floor = _original?.version ?? 0;
        _restoreFailed = false;
      }
      final snapshot = await _load(consumer, epoch);
      if (build != null) {
        final intent = build(snapshot);
        if (intent == null) return true;
        _original = intent;
      }
      final original = _original;
      if (original == null || (build == null && !recheck)) {
        return build == null;
      }
      // Every attempt durably retains these exact bytes before the BFF sees them.
      await consumer._saveSortIntent(original);
      _ensure(consumer, epoch);
      try {
        final response = await consumer._send(
          PlatformMethod.put,
          _SortIntent.path,
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
          await consumer._saveSortIntent(null);
          _ensure(consumer, epoch);
          _original = null;
          await _load(consumer, epoch);
        }
        rethrow;
      }
      _ensure(consumer, epoch);
      await _load(consumer, epoch);
      if (_original != null) {
        throw const PlatformUnavailable('Sort write is not confirmed');
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

final channelSortProvider =
    NotifierProvider<ChannelSortNotifier, ChannelSortState>(
      ChannelSortNotifier.new,
    );
