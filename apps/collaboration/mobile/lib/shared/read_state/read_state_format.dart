/// 已读上下文的键。
///
/// Channel 的已读位置以 Channel id 为键，单条消息以 `msg:<event id>` 为键——这两种
/// 是 Core 的 CollaborationUserState 接受的全部形式（`DD-40`、`.design/03` §4）。
/// Thread 的已读位置以 `thread:<root id>` 为键，只留在本机。
library;

const msgContextPrefix = 'msg:';
const threadContextPrefix = 'thread:';

String msgContextKey(String messageId) => '$msgContextPrefix$messageId';
String threadContextKey(String rootId) => '$threadContextPrefix$rootId';

int? maxReadAt(Iterable<int?> markers) {
  int? latest;
  for (final marker in markers) {
    if (marker == null) continue;
    if (latest == null || marker > latest) {
      latest = marker;
    }
  }
  return latest;
}

final _uuid = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  caseSensitive: false,
);
final _eventId = RegExp(r'^[0-9a-f]{64}$', caseSensitive: false);

/// Core 是否接受这个上下文键。不接受的键只在本机保存，不发给 BFF——发了也只会
/// 得到 400。
bool isSharedReadContextKey(String key) {
  if (key.startsWith(msgContextPrefix)) {
    return _eventId.hasMatch(key.substring(msgContextPrefix.length));
  }
  return _uuid.hasMatch(key);
}
