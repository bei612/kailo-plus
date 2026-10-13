/// 已读位置经 BFF 写入 Core 的 CollaborationUserState（`DD-40`）。
///
/// 三端共用这一份权威：Buzz Web 经浏览器入口、原生端经原生入口，都是同一个
/// `/api/v1/user-state`。写入带乐观版本：版本不符（409）说明别的端刚写过，回读后
/// 只在本机仍更新时重写一次。
library;

import 'dart:convert';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../read_state/read_state_format.dart';
import '../read_state/read_state_manager.dart';
import '../read_state/read_state_time.dart';
import 'platform_api.dart';
import 'platform_config.dart';

class PlatformReadStateRemote implements ReadStateRemote {
  PlatformReadStateRemote({
    required NativeSession session,
    required PlatformConfig config,
    required PlatformSessionView actor,
    required SharedPreferences prefs,
    required String storageScope,
    required bool Function() isCurrent,
  }) : _session = session,
       _config = config,
       _actor = actor,
       _prefs = prefs,
       _key = 'buzz.channel-read-state.request.v1:$storageScope',
       _isCurrent = isCurrent,
       _generation = session.credentialGeneration {
    final raw = _prefs.getString(_key);
    if (raw != null) {
      try {
        _original = ReadMarkRequest.fromJson(jsonDecode(raw));
        if (!isSharedReadContextKey(_original!.contextKey) ||
            _original!.version < 0 ||
            isoToUnixSeconds(_original!.lastReadAt) == null) {
          throw const FormatException('Invalid original read request');
        }
      } on Object {
        // Keep the original bytes for recovery; malformed intent blocks this
        // consumer, not the collaboration page or another preference authority.
        _blocked = true;
        _original = null;
      }
    }
  }

  final NativeSession _session;
  final PlatformConfig _config;
  final PlatformSessionView _actor;
  final SharedPreferences _prefs;
  final String _key;
  final bool Function() _isCurrent;
  final int _generation;
  int? _version;
  ReadMarkRequest? _original;
  bool _blocked = false;

  @override
  String? get pendingContextId => _original?.contextKey;
  @override
  int? get pendingReadAt =>
      _original == null ? null : isoToUnixSeconds(_original!.lastReadAt);

  void _fence() {
    if (_blocked) {
      throw const PlatformUnavailable('Original read intent is unreadable');
    }
    if (!_isCurrent() || _generation != _session.credentialGeneration) {
      throw const PlatformUnavailable('The platform session changed');
    }
  }

  Future<PlatformResponse> _send(
    PlatformMethod method,
    String path, {
    Object? body,
  }) async {
    _fence();
    final response = await _session.send(_config, method, path, body: body);
    _fence();
    return response;
  }

  Future<void> _checkActor() async {
    final response = await _send(PlatformMethod.get, '/api/v1/session');
    if (response.status != 200) throw PlatformApiError(response);
    final current = PlatformSessionView.fromJson(
      response.body! as Map<String, dynamic>,
    );
    if (current.accessMode != PlatformSessionAccessMode.FULL ||
        current.platformSessionId != _actor.platformSessionId ||
        current.tenantId != _actor.tenantId ||
        current.tenantPrincipalId != _actor.tenantPrincipalId) {
      throw const PlatformUnavailable('The platform actor changed');
    }
  }

  Future<void> _save(ReadMarkRequest? request) async {
    _fence();
    final saved = request == null
        ? await _prefs.remove(_key)
        : await _prefs.setString(_key, jsonEncode(request.toJson()));
    _fence();
    if (!saved) {
      throw const PlatformUnavailable('Original read request not stored');
    }
    _original = request;
  }

  @override
  Future<Map<String, int>> fetch() async {
    await _checkActor();
    final response = await _send(PlatformMethod.get, '/api/v1/user-state');
    if (response.status != 200) throw PlatformApiError(response);
    // readContexts 是以上下文键为键的映射，契约的可用子集表达不了任意键的对象，
    // 这里只取它的键值，其余字段不解读
    final body = response.body! as Map<String, dynamic>;
    final version = body['version'] as int;
    if (version < 0 || (_version != null && version < _version!)) {
      throw const PlatformUnavailable('Older read snapshot');
    }
    _version = version;
    final contexts = body['readContexts'] as Map<String, dynamic>;
    final result = <String, int>{};
    for (final entry in contexts.entries) {
      final seconds = isoToUnixSeconds(entry.value);
      if (seconds != null) result[entry.key] = seconds;
    }
    final original = _original;
    if (original != null && version > original.version) {
      // A committed newer CAS version also fences any still-running old PUT.
      await _save(null);
    }
    return result;
  }

  @override
  Future<Map<String, int>> publish(Map<String, int> contexts) async {
    final confirmed = <String, int>{};
    var latest = await fetch();
    for (final entry in contexts.entries) {
      if (!isSharedReadContextKey(entry.key)) continue;
      if ((latest[entry.key] ?? -1) >= entry.value) {
        confirmed[entry.key] = latest[entry.key]!;
        continue;
      }
      final pending = _original;
      if (pending != null && pending.contextKey != entry.key) {
        throw const PlatformUnavailable('Original read request is unresolved');
      }
      final request =
          pending ??
          ReadMarkRequest(
            contextKey: entry.key,
            lastReadAt: unixSecondsToDateTime(entry.value).toIso8601String(),
            version: _version!,
          );
      // Even a recheck persists the same CAS bytes before the PUT. A previous
      // local persistence failure never grants permission to replay from RAM.
      await _save(request);
      await _checkActor();
      final response = await _send(
        PlatformMethod.put,
        '/api/v1/user-state/read',
        body: request.toJson(),
      );
      if (response.status != 200 && response.status != 409) {
        // A new refusal cannot negate a still-running original UNKNOWN PUT.
        throw PlatformApiError(response);
      }
      if (response.status == 200) {
        final written = UserStateVersion.fromJson(
          response.body! as Map<String, dynamic>,
        ).version;
        if (written <= request.version) {
          throw const PlatformUnavailable('Unconfirmed read version');
        }
      }
      latest = await fetch();
      final at = latest[entry.key];
      if (at != null && at >= entry.value) confirmed[entry.key] = at;
      // A conflict is observed, not blindly rewritten at a freshly read version.
    }
    return confirmed;
  }
}
