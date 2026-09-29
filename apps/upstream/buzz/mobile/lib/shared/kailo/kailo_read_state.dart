/// 已读位置经 BFF 写入 Core 的 CollaborationUserState（Kailo `DD-40`）。
///
/// 三端共用这一份权威：Buzz Web 经浏览器入口、原生端经原生入口，都是同一个
/// `/api/v1/user-state`。写入带乐观版本：版本不符（409）说明别的端刚写过，回读后
/// 只在本机仍更新时重写一次。
library;

import '../contracts/contracts.dart';
import '../read_state/read_state_format.dart';
import '../read_state/read_state_manager.dart';
import '../read_state/read_state_time.dart';
import 'kailo_api.dart';
import 'kailo_config.dart';

class KailoReadStateRemote implements ReadStateRemote {
  KailoReadStateRemote({
    required KailoSession session,
    required KailoConfig config,
  }) : _session = session,
       _config = config;

  final KailoSession _session;
  final KailoConfig _config;
  int? _version;

  @override
  Future<Map<String, int>> fetch() async {
    final response = await _session.send(
      _config,
      KailoMethod.get,
      '/api/v1/user-state',
    );
    if (response.status != 200) throw KailoApiError(response);
    // readContexts 是以上下文键为键的映射，契约的可用子集表达不了任意键的对象，
    // 这里只取它的键值，其余字段不解读
    final body = response.body! as Map<String, dynamic>;
    _version = body['version'] as int;
    final contexts = body['readContexts'] as Map<String, dynamic>;
    final result = <String, int>{};
    for (final entry in contexts.entries) {
      final seconds = isoToUnixSeconds(entry.value);
      if (seconds != null) result[entry.key] = seconds;
    }
    return result;
  }

  @override
  Future<Map<String, int>> publish(Map<String, int> contexts) async {
    final confirmed = <String, int>{};
    for (final entry in contexts.entries) {
      if (!isSharedReadContextKey(entry.key)) continue;
      if (await _put(entry.key, entry.value)) {
        confirmed[entry.key] = entry.value;
        continue;
      }
      // 版本冲突：回读，权威副本若已不早于本机就不必再写
      final latest = await fetch();
      final remote = latest[entry.key] ?? 0;
      if (remote >= entry.value) {
        confirmed[entry.key] = remote;
        continue;
      }
      if (await _put(entry.key, entry.value)) {
        confirmed[entry.key] = entry.value;
      }
      // 再次冲突：这一项留到下次对齐
    }
    return confirmed;
  }

  /// 写入一项。成功返回 true；版本冲突返回 false；其余回应按错误抛出。
  Future<bool> _put(String key, int seconds) async {
    if (_version == null) await fetch();
    final version = _version!;
    final response = await _session.send(
      _config,
      KailoMethod.put,
      '/api/v1/user-state/read',
      body: ReadMarkRequest(
        contextKey: key,
        lastReadAt: unixSecondsToDateTime(seconds).toIso8601String(),
        version: version,
      ).toJson(),
    );
    if (response.status == 409) return false;
    if (response.status != 200) throw KailoApiError(response);
    _version = UserStateVersion.fromJson(
      response.body! as Map<String, dynamic>,
    ).version;
    return true;
  }
}
