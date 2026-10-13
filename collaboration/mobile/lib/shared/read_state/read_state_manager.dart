import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'read_state_format.dart';
import 'read_state_storage.dart';

/// 已读位置的权威副本。平台里是 Core 的 CollaborationUserState（`DD-40`）：
/// 三端读写同一份，不经 Relay 的 NIP-78 事件——Relay 也不接受成员发布它们
/// （`DD-80`）。
abstract interface class ReadStateRemote {
  String? get pendingContextId;
  int? get pendingReadAt;

  /// 权威副本里的已读位置（unix 秒）。取不到时抛出。
  Future<Map<String, int>> fetch();

  /// 把这些上下文的已读位置写入权威副本，返回写入后权威副本里的值——并发写入
  /// 时它可能比传入的更新。只传 [isSharedReadContextKey] 接受的键。
  Future<Map<String, int>> publish(Map<String, int> contexts);
}

class ReadStateManager {
  final String pubkey;
  final String storageScope;
  final ReadStateStorage _storage;
  final ReadStateRemote? _remote;
  final VoidCallback _onChanged;

  final Map<String, int> _effectiveState = {};
  final Set<String> _publishableContextIds = {};

  /// 最近一次从权威副本读到或写入确认的值
  final Map<String, int> _remoteContexts = {};

  Timer? _debounceTimer;
  bool _initialized = false;
  bool _authorityReady = false;
  bool _disposed = false;
  Future<void>? _publishing;
  final Set<String> _pendingSyncedAdvances = {};

  ReadStateManager({
    required this.pubkey,
    required this.storageScope,
    required SharedPreferences prefs,
    required ReadStateRemote? remote,
    required VoidCallback onChanged,
  }) : _storage = ReadStateStorage(prefs),
       _remote = remote,
       _onChanged = onChanged {
    _hydrateFromLocalStorage();
    final pendingId = remote?.pendingContextId;
    final pendingAt = remote?.pendingReadAt;
    if (pendingId != null && pendingAt != null) {
      _effectiveState[pendingId] = pendingAt;
      _publishableContextIds.add(pendingId);
    }
  }

  /// Publishable local values are intents, not confirmed cursors. Hydrated
  /// intents stay invisible until this actor reads the Core authority again.
  Map<String, int> get effectiveContexts => Map.unmodifiable({
    for (final entry in _effectiveState.entries)
      if (_remote == null ||
          !isSharedReadContextKey(entry.key) ||
          !_publishableContextIds.contains(entry.key))
        entry.key: entry.value
      else if (_remoteContexts.containsKey(entry.key))
        entry.key: _remoteContexts[entry.key]!,
  });

  int? getEffectiveTimestamp(String contextId) => effectiveContexts[contextId];
  int? confirmedTimestamp(String contextId) => _remoteContexts[contextId];
  bool get authorityReady => _remote == null || _authorityReady;
  String? get pendingContextId => _remote?.pendingContextId;

  Future<void> initialize() async {
    if (_initialized || _disposed) return;
    _initialized = true;
    await _fetchAndMerge();
    if (_pendingPublish().isNotEmpty) _schedulePublish();
    _onChanged();
  }

  void markContextRead(String contextId, int unixTimestamp) {
    _advanceContext(contextId, unixTimestamp, publishable: true);
  }

  Future<bool> markContextReadConfirmed(
    String contextId,
    int unixTimestamp,
  ) async {
    if (_disposed || _remote == null) return false;
    markContextRead(contextId, unixTimestamp);
    await flush(recheck: true);
    return !_disposed && (_remoteContexts[contextId] ?? -1) >= unixTimestamp;
  }

  void seedContextRead(String contextId, int unixTimestamp) {
    _advanceContext(contextId, unixTimestamp, publishable: false);
  }

  Future<void> flush({bool recheck = false}) async {
    _debounceTimer?.cancel();
    _debounceTimer = null;
    if (_disposed) return;
    await _publish(recheck: recheck);
  }

  /// 重新连上之后与权威副本对齐：别的端在此期间读过的会在这里生效。
  Future<void> reinitializeRemote() async {
    if (_disposed || !_initialized) return;
    await _publishing;
    await _fetchAndMerge();
    if (_pendingPublish().isNotEmpty) _schedulePublish();
    _onChanged();
  }

  void dispose({bool flushPending = true}) {
    if (_disposed) return;
    _disposed = true;

    final hadPendingPublish = _debounceTimer != null;
    _debounceTimer?.cancel();
    _debounceTimer = null;

    if (flushPending && hadPendingPublish) {
      unawaited(_publish(allowDisposed: true));
    }
  }

  void _advanceContext(
    String contextId,
    int unixTimestamp, {
    required bool publishable,
  }) {
    if (_disposed || unixTimestamp < 0) return;

    final current = _effectiveState[contextId];
    if (current != null && unixTimestamp <= current) {
      if (!publishable || _publishableContextIds.contains(contextId)) {
        return;
      }

      _publishableContextIds.add(contextId);
      _persistLocalState();
      _onChanged();
      _schedulePublish();
      return;
    }

    _effectiveState[contextId] = unixTimestamp;
    if (publishable) {
      _publishableContextIds.add(contextId);
    }
    if (_remote == null || !isSharedReadContextKey(contextId)) {
      _pendingSyncedAdvances.add(contextId);
    }
    _persistLocalState();
    _onChanged();
    if (publishable) {
      _schedulePublish();
    }
  }

  Future<void> _fetchAndMerge() async {
    final remote = _remote;
    if (remote == null) return;
    try {
      _mergeRemote(await remote.fetch());
      _authorityReady = true;
      _persistLocalState();
      if (!_disposed) _onChanged();
    } catch (e) {
      // 结果不明：保留本机值，下次连上再对齐
      debugPrint('[ReadStateManager] fetch failed: $e');
    }
  }

  void _mergeRemote(Map<String, int> remote) {
    for (final entry in remote.entries) {
      final known = _remoteContexts[entry.key];
      if (known == null || entry.value > known) {
        _remoteContexts[entry.key] = entry.value;
        _pendingSyncedAdvances.add(entry.key);
      }
      final current = _effectiveState[entry.key];
      if (current == null || entry.value > current) {
        _effectiveState[entry.key] = entry.value;
      }
      // 权威副本里已有的键就是本人读过的，之后本机的推进要回写
      _publishableContextIds.add(entry.key);
    }
  }

  /// 本机比权威副本新、且 Core 接受的上下文。
  Map<String, int> _pendingPublish() => {
    for (final entry in _effectiveState.entries)
      if (_publishableContextIds.contains(entry.key) &&
          isSharedReadContextKey(entry.key) &&
          (!_remoteContexts.containsKey(entry.key) ||
              entry.value > _remoteContexts[entry.key]!))
        entry.key: entry.value,
  };

  void _schedulePublish() {
    if (_remote == null || _disposed) return;

    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(seconds: 5), () {
      _debounceTimer = null;
      unawaited(_publish());
    });
  }

  Future<void> _publish({bool allowDisposed = false, bool recheck = false}) {
    if ((!allowDisposed && _disposed) ||
        _remote == null ||
        (!recheck && _remote.pendingContextId != null)) {
      return Future.value();
    }
    final active = _publishing;
    if (active != null) return active;
    final pending = _pendingPublish();
    if (pending.isEmpty) return Future.value();
    return _publishing = () async {
      try {
        final confirmed = await _remote.publish(pending);
        _mergeRemote(confirmed);
        _persistLocalState();
        if (!_disposed) _onChanged();
      } catch (error) {
        // 未确认写入：本机值保留，下次对齐时再写
        debugPrint('[ReadStateManager] publish failed: $error');
        if (!_disposed) _onChanged();
      } finally {
        _publishing = null;
      }
    }();
  }

  Set<String> drainSyncedAdvances() {
    final drained = Set<String>.from(_pendingSyncedAdvances);
    _pendingSyncedAdvances.clear();
    return drained;
  }

  void _hydrateFromLocalStorage() {
    final stored = _storage.read(storageScope);
    _effectiveState
      ..clear()
      ..addAll(stored.contexts);
    _publishableContextIds
      ..clear()
      ..addAll(stored.publishableContextIds);
  }

  void _persistLocalState() {
    // The exact Core CAS request is separately persisted by the same remote
    // consumer before every PUT. Cache failure never confirms a pending value.
    unawaited(
      _storage
          .write(storageScope, _effectiveState, _publishableContextIds)
          .then<void>(
            (saved) {
              if (!saved) debugPrint('[ReadStateManager] cache not stored');
            },
            onError: (Object _) =>
                debugPrint('[ReadStateManager] cache not stored'),
          ),
    );
  }
}
