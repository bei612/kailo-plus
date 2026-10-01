import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'read_state_time.dart';

String localReadStateKey(String pubkey) => 'buzz.channel-read-state.v2:$pubkey';

String localPublishableContextKey(String pubkey) =>
    'buzz.channel-read-state.publishable.v1:$pubkey';

class StoredReadState {
  final Map<String, int> contexts;
  final Set<String> publishableContextIds;

  StoredReadState({
    required Map<String, int> contexts,
    required Set<String> publishableContextIds,
  }) : contexts = Map.unmodifiable(contexts),
       publishableContextIds = Set.unmodifiable(publishableContextIds);
}

/// 本机的已读缓存：离线时照常判定未读，上线后与 Core 的权威值合并。
class ReadStateStorage {
  final SharedPreferences _prefs;

  ReadStateStorage(this._prefs);

  StoredReadState read(String pubkey) {
    return StoredReadState(
      contexts: _readContexts(pubkey),
      publishableContextIds: _readPublishableContextIds(pubkey),
    );
  }

  void write(
    String pubkey,
    Map<String, int> contexts,
    Set<String> publishableContextIds,
  ) {
    final state = <String, String>{};
    for (final entry in contexts.entries) {
      state[entry.key] = unixSecondsToDateTime(entry.value).toIso8601String();
    }

    _prefs.setString(localReadStateKey(pubkey), jsonEncode(state));
    _prefs.setString(
      localPublishableContextKey(pubkey),
      jsonEncode(publishableContextIds.toList()),
    );
  }

  Map<String, int> _readContexts(String pubkey) {
    final raw = _prefs.getString(localReadStateKey(pubkey));
    if (raw == null || raw.isEmpty) {
      return {};
    }

    final Object? parsed;
    try {
      parsed = jsonDecode(raw);
    } catch (e) {
      debugPrint('[ReadStateManager] storage: contexts JSON corrupt: $e');
      return {};
    }

    if (parsed is! Map) {
      return {};
    }

    final contexts = <String, int>{};
    for (final entry in parsed.entries) {
      final key = entry.key;
      final timestamp = isoToUnixSeconds(entry.value);
      if (key is! String || timestamp == null) continue;

      final current = contexts[key] ?? 0;
      if (timestamp > current) {
        contexts[key] = timestamp;
      }
    }
    return contexts;
  }

  Set<String> _readPublishableContextIds(String pubkey) {
    final raw = _prefs.getString(localPublishableContextKey(pubkey));
    if (raw == null || raw.isEmpty) {
      return {};
    }

    final Object? parsed;
    try {
      parsed = jsonDecode(raw);
    } catch (e) {
      debugPrint(
        '[ReadStateManager] storage: publishableContextIds JSON corrupt: $e',
      );
      return {};
    }

    if (parsed is! List) {
      return {};
    }

    return {
      for (final value in parsed)
        if (value is String) value,
    };
  }
}
