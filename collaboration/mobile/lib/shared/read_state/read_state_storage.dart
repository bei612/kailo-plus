import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'read_state_time.dart';

String localReadStateKey(String scope) => 'buzz.channel-read-state.v3:$scope';

class StoredReadState {
  final Map<String, int> contexts;
  final Set<String> publishableContextIds;

  StoredReadState({
    required Map<String, int> contexts,
    required Set<String> publishableContextIds,
  }) : contexts = Map.unmodifiable(contexts),
       publishableContextIds = Set.unmodifiable(publishableContextIds);
}

/// One atomic cache record keeps cursor provenance with the values. Old
/// pubkey-only/two-key caches cannot identify this trusted actor and are not read.
class ReadStateStorage {
  final SharedPreferences _prefs;
  ReadStateStorage(this._prefs);

  StoredReadState read(String scope) {
    try {
      final raw = _prefs.getString(localReadStateKey(scope));
      if (raw == null) {
        return StoredReadState(contexts: {}, publishableContextIds: {});
      }
      final json = jsonDecode(raw) as Map<String, dynamic>;
      if (json['version'] != 3 ||
          json['contexts'] is! Map ||
          json['publishableContextIds'] is! List) {
        throw const FormatException('Invalid read cursor cache');
      }
      final contexts = <String, int>{};
      for (final entry in (json['contexts'] as Map).entries) {
        final seconds = isoToUnixSeconds(entry.value);
        if (entry.key is! String || seconds == null || seconds < 0) {
          throw const FormatException('Invalid read cursor');
        }
        contexts[entry.key as String] = seconds;
      }
      final publishable = <String>{};
      for (final id in json['publishableContextIds'] as List) {
        if (id is! String || !contexts.containsKey(id)) {
          throw const FormatException('Invalid read cursor provenance');
        }
        publishable.add(id);
      }
      return StoredReadState(
        contexts: contexts,
        publishableContextIds: publishable,
      );
    } on Object {
      return StoredReadState(contexts: {}, publishableContextIds: {});
    }
  }

  Future<bool> write(
    String scope,
    Map<String, int> contexts,
    Set<String> publishableContextIds,
  ) => _prefs.setString(
    localReadStateKey(scope),
    jsonEncode({
      'version': 3,
      'contexts': {
        for (final entry in contexts.entries)
          entry.key: unixSecondsToDateTime(entry.value).toIso8601String(),
      },
      'publishableContextIds': publishableContextIds.toList(),
    }),
  );
}
