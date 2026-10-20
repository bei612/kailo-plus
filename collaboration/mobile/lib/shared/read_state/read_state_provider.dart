import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../relay/relay.dart';
import '../theme/theme_provider.dart';
import '../platform/platform_api.dart';
import '../platform/platform_config.dart';
import '../platform/platform_read_state.dart';
import '../platform/platform_views.dart';
import 'package:client_kit/shared/contracts/contracts.dart';
import 'read_state_manager.dart';

class ReadStateState {
  final bool isReady;
  final String? pubkey;
  final Map<String, int> contexts;
  final int version;
  final String? pendingContextId;

  /// Session-local forced-unread flags, keyed by the forced context id
  /// (a channel id from the channel tile, or a `msg:` key from the message
  /// actions sheet), each mapped to the channel it belongs to so channel
  /// tiles and badges can surface message-level forces.
  final Map<String, String> forcedUnreadContexts;

  const ReadStateState({
    required this.isReady,
    required this.pubkey,
    required this.contexts,
    required this.version,
    this.forcedUnreadContexts = const {},
    this.pendingContextId,
  });

  const ReadStateState.inert()
    : isReady = false,
      pubkey = null,
      contexts = const {},
      version = 0,
      pendingContextId = null,
      forcedUnreadContexts = const {};

  /// Channels that should surface as unread because of a forced-unread flag —
  /// either forced directly, or containing a forced message.
  Set<String> get locallyForcedChannelIds =>
      forcedUnreadContexts.values.toSet();

  /// Whether this exact context (channel id or `msg:` key) is forced unread.
  bool isForcedUnread(String contextId) =>
      forcedUnreadContexts.containsKey(contextId);

  int? effectiveTimestamp(String contextId) => contexts[contextId];

  ReadStateState copyWithContext(String contextId, int timestamp) {
    final current = contexts[contextId] ?? 0;
    if (timestamp <= current) {
      return this;
    }

    return ReadStateState(
      isReady: isReady,
      pubkey: pubkey,
      contexts: Map.unmodifiable({...contexts, contextId: timestamp}),
      version: version + 1,
      forcedUnreadContexts: forcedUnreadContexts,
      pendingContextId: pendingContextId,
    );
  }
}

class ReadStateNotifier extends Notifier<ReadStateState> {
  ReadStateManager? _manager;
  bool _isInitialized = false;
  final Map<String, String> _forcedUnreadContexts = {};
  final Map<String, int> _clearForcedMessages = {};
  int _generation = 0;

  @override
  ReadStateState build() {
    final generation = ++_generation;
    _manager?.dispose(flushPending: false);
    _manager = null;
    _isInitialized = false;
    _forcedUnreadContexts.clear();
    _clearForcedMessages.clear();

    ref.watch(relaySessionProvider);
    // 没有设备密钥就没有协作连接，也就没有已读状态
    final pubkey = pubkeyFromNsec(
      ref.watch(relayConfigProvider).nsec?.trim(),
    )?.toLowerCase();
    if (pubkey == null) {
      return const ReadStateState.inert();
    }
    final config = ref.watch(platformConfigProvider);
    final session = ref.watch(nativeSessionProvider);
    final actor = ref.watch(platformSessionViewProvider).asData?.value;
    if (config == null ||
        actor == null ||
        actor.accessMode != PlatformSessionAccessMode.FULL ||
        actor.tenantPrincipalId.isEmpty) {
      return const ReadStateState.inert();
    }
    final credentialGeneration = session.credentialGeneration;
    final storageScope =
        '${Uri.encodeComponent(config.nativeApiUrl)}:'
        '${actor.tenantId}:${actor.tenantPrincipalId}:$pubkey';

    final prefs = ref.read(savedPrefsProvider);
    late final ReadStateManager manager;
    manager = ReadStateManager(
      pubkey: pubkey,
      storageScope: storageScope,
      prefs: prefs,
      remote: PlatformReadStateRemote(
        session: session,
        config: config,
        actor: actor,
        prefs: prefs,
        storageScope: storageScope,
        isCurrent: () =>
            ref.mounted &&
            generation == _generation &&
            session.credentialGeneration == credentialGeneration,
      ),
      onChanged: () => _emitManagerState(manager),
    );
    _manager = manager;

    ref.onDispose(() {
      manager.dispose(flushPending: false);
      if (_manager == manager) {
        _manager = null;
      }
    });

    ref.listen(appLifecycleProvider, (_, next) {
      if (next == AppLifecycleState.paused ||
          next == AppLifecycleState.detached ||
          next == AppLifecycleState.hidden) {
        unawaited(manager.flush());
      }
    });

    ref.listen(relaySessionProvider, (prev, next) {
      if (prev?.status != SessionStatus.connected &&
          next.status == SessionStatus.connected) {
        unawaited(manager.reinitializeRemote());
      }
    });

    Future.microtask(() async {
      await manager.initialize();
      if (_manager != manager) return;
      _isInitialized = manager.authorityReady;
      _emitManagerState(manager);
    });

    return _stateFromManager(manager, isReady: false);
  }

  /// Advance a context's read marker. Clears the forced-unread flag for
  /// exactly this context, if any. An explicit channel-level "Mark read"
  /// (channel tile/menu) should pass [clearForcedMessages] so message-level
  /// forces inside the channel are released too; the automatic read on
  /// channel open must not, so a message deliberately marked unread stays
  /// unread until acted on.
  void markContextRead(
    String contextId,
    int unixTimestamp, {
    bool clearForcedMessages = false,
  }) {
    if (clearForcedMessages) _clearForcedMessages[contextId] = unixTimestamp;
    _manager?.markContextRead(contextId, unixTimestamp);
    if ((_manager?.confirmedTimestamp(contextId) ?? -1) >= unixTimestamp) {
      _forcedUnreadContexts.remove(contextId);
      if (clearForcedMessages) {
        _forcedUnreadContexts.removeWhere(
          (_, channelId) => channelId == contextId,
        );
        _clearForcedMessages.remove(contextId);
      }
      _refreshForcedState();
    }
  }

  Future<bool> markContextReadConfirmed(
    String contextId,
    int unixTimestamp, {
    bool clearForcedMessages = true,
  }) async {
    final manager = _manager;
    if (manager == null || !state.isReady) return false;
    if (clearForcedMessages) _clearForcedMessages[contextId] = unixTimestamp;
    final confirmed = await manager.markContextReadConfirmed(
      contextId,
      unixTimestamp,
    );
    if (!ref.mounted || _manager != manager || !confirmed) return false;
    _forcedUnreadContexts.removeWhere(
      (key, channelId) =>
          key == contextId || (clearForcedMessages && channelId == contextId),
    );
    _clearForcedMessages.remove(contextId);
    _emitManagerState(manager);
    return true;
  }

  /// Force a context unread for the rest of the session. [contextId] is a
  /// channel id (channel-tile action) or a `msg:` key (message actions
  /// sheet); [channelId] is the channel the context belongs to, so tiles and
  /// badges can surface message-level forces. Read markers are monotonic,
  /// so this is the only way to move a context back to unread.
  void markContextUnread(String contextId, {required String channelId}) {
    if (_manager == null) return;
    _forcedUnreadContexts[contextId] = channelId;
    _refreshForcedState();
  }

  void _refreshForcedState() {
    final manager = _manager;
    if (manager == null) return;
    state = _stateFromManager(
      manager,
      isReady: _isInitialized,
      previousVersion: state.version,
    );
  }

  void seedContextRead(String contextId, int unixTimestamp) {
    _manager?.seedContextRead(contextId, unixTimestamp);
  }

  Future<void> recheck() async {
    final manager = _manager;
    if (manager == null) return;
    await manager.reinitializeRemote();
    if (ref.mounted && identical(_manager, manager)) _emitManagerState(manager);
  }

  void _emitManagerState(ReadStateManager manager) {
    if (_manager != manager) return;
    final advances = manager.drainSyncedAdvances();
    for (final contextId in advances) {
      _forcedUnreadContexts.remove(contextId);
      final clearAt = _clearForcedMessages[contextId];
      if (clearAt != null &&
          (manager.getEffectiveTimestamp(contextId) ?? -1) >= clearAt) {
        _forcedUnreadContexts.removeWhere(
          (_, channelId) => channelId == contextId,
        );
        _clearForcedMessages.remove(contextId);
      }
    }
    _isInitialized = manager.authorityReady;
    state = _stateFromManager(
      manager,
      isReady: _isInitialized,
      previousVersion: state.version,
    );
  }

  ReadStateState _stateFromManager(
    ReadStateManager manager, {
    required bool isReady,
    int? previousVersion,
  }) {
    return ReadStateState(
      isReady: isReady,
      pubkey: manager.pubkey,
      contexts: manager.effectiveContexts,
      version: (previousVersion ?? 0) + 1,
      forcedUnreadContexts: Map.unmodifiable(
        Map<String, String>.from(_forcedUnreadContexts),
      ),
      pendingContextId: manager.pendingContextId,
    );
  }
}

final readStateProvider = NotifierProvider<ReadStateNotifier, ReadStateState>(
  ReadStateNotifier.new,
);
