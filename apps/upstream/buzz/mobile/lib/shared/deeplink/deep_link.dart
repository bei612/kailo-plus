/// Parsing for `buzz://` deep links.
///
/// Mirrors the desktop handler in `desktop/src-tauri/src/deep_link.rs`:
/// `buzz://message?channel=<uuid>&id=<hex>[&thread=<hex>]` references a
/// message (optionally inside a thread) in a channel. Required params that
/// are missing or empty make the link invalid — the caller never sees a
/// half-formed target.
///
/// Kailo Mobile 只交付 Channel 与消息两种目标。其余 `buzz://` 链接指向的能力不在
/// 移动端交付（Kailo `REQ-21`、`V-SCN-65`）：解析为 [UnavailableOnMobileDeepLink]，
/// 由界面给出稳定 reason code 并指向 Web 或桌面端，不静默丢弃，也不以内嵌
/// WebView 代替。
library;

/// A parsed deep link supported by the app.
sealed class BuzzDeepLink {
  const BuzzDeepLink();
}

/// A parsed channel-only deep link.
///
/// Canonical form: `buzz://channel/<channel-uuid>`.
class ChannelDeepLink extends BuzzDeepLink {
  /// Channel UUID from the sole path segment.
  final String channelId;

  const ChannelDeepLink({required this.channelId});

  @override
  bool operator ==(Object other) =>
      other is ChannelDeepLink && other.channelId == channelId;

  @override
  int get hashCode => channelId.hashCode;

  @override
  String toString() => 'ChannelDeepLink(channel: $channelId)';
}

/// A parsed `buzz://message` deep link.
class MessageDeepLink extends BuzzDeepLink {
  /// Channel UUID from the `channel` query param.
  final String channelId;

  /// Event ID (hex) from the `id` query param.
  final String messageId;

  /// Optional thread root event ID from the `thread` query param.
  final String? threadRootId;

  const MessageDeepLink({
    required this.channelId,
    required this.messageId,
    this.threadRootId,
  });

  @override
  bool operator ==(Object other) =>
      other is MessageDeepLink &&
      other.channelId == channelId &&
      other.messageId == messageId &&
      other.threadRootId == threadRootId;

  @override
  int get hashCode => Object.hash(channelId, messageId, threadRootId);

  @override
  String toString() =>
      'MessageDeepLink(channel: $channelId, id: $messageId, '
      'thread: $threadRootId)';
}

/// Build a canonical `buzz://message` link for a channel message.
///
/// Mirrors `desktop/src/features/messages/lib/messageLink.ts` so links copied
/// or shared from mobile round-trip through every client's parser:
/// `buzz://message?channel=<uuid>&id=<eventId>[&thread=<rootId>]`.
///
/// An empty [threadRootId] is treated as "no thread" so callers can pass
/// through a nullable thread reference without extra checks.
String buildMessageLink({
  required String channelId,
  required String messageId,
  String? threadRootId,
}) {
  if (channelId.isEmpty) {
    throw ArgumentError('buildMessageLink: channelId is required');
  }
  if (messageId.isEmpty) {
    throw ArgumentError('buildMessageLink: messageId is required');
  }

  final params = <String, String>{
    'channel': channelId,
    'id': messageId,
    if (threadRootId != null && threadRootId.isNotEmpty) 'thread': threadRootId,
  };
  return Uri(
    scheme: 'buzz',
    host: 'message',
    queryParameters: params,
  ).toString();
}

/// Parse a canonical `buzz://channel/<channel-uuid>` URI.
///
/// The channel ID must be the URI's sole non-empty path segment. Query
/// parameters and fragments are rejected so malformed or ambiguous links never
/// become navigation targets.
ChannelDeepLink? parseChannelDeepLink(Uri uri) {
  if (uri.scheme != 'buzz' || uri.host != 'channel') return null;
  if (uri.hasQuery ||
      uri.hasFragment ||
      uri.userInfo.isNotEmpty ||
      uri.hasPort) {
    return null;
  }
  if (uri.pathSegments.length != 1 || uri.pathSegments.single.isEmpty) {
    return null;
  }
  final channelId = uri.pathSegments.single;
  if (!RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    caseSensitive: false,
  ).hasMatch(channelId)) {
    return null;
  }
  return ChannelDeepLink(channelId: channelId.toLowerCase());
}

/// Parse a `buzz://message?…` URI into a [MessageDeepLink].
///
/// Returns `null` unless the URI exactly matches the canonical message-link
/// shape: no path, fragment, credentials, duplicate or unknown parameters; a
/// UUID channel; and 64-character hexadecimal message/thread event IDs.
MessageDeepLink? parseMessageDeepLink(Uri uri) {
  if (uri.scheme != 'buzz' || uri.host != 'message') return null;
  if (uri.path.isNotEmpty ||
      uri.hasFragment ||
      uri.userInfo.isNotEmpty ||
      uri.hasPort) {
    return null;
  }

  const allowedParams = {'channel', 'id', 'thread'};
  if (uri.queryParametersAll.keys.any((key) => !allowedParams.contains(key)) ||
      uri.queryParametersAll.values.any((values) => values.length != 1)) {
    return null;
  }

  final channel = uri.queryParameters['channel'];
  final id = uri.queryParameters['id'];
  final thread = uri.queryParameters['thread'];
  final uuid = RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    caseSensitive: false,
  );
  final eventId = RegExp(r'^[0-9a-f]{64}$', caseSensitive: false);
  if (channel == null ||
      !uuid.hasMatch(channel) ||
      id == null ||
      !eventId.hasMatch(id) ||
      (thread != null && !eventId.hasMatch(thread))) {
    return null;
  }

  return MessageDeepLink(
    channelId: channel.toLowerCase(),
    messageId: id.toLowerCase(),
    threadRootId: thread?.toLowerCase(),
  );
}

/// A `buzz://` link whose target this app does not deliver.
class UnavailableOnMobileDeepLink extends BuzzDeepLink {
  /// The link exactly as received.
  final Uri uri;

  const UnavailableOnMobileDeepLink(this.uri);

  @override
  bool operator ==(Object other) =>
      other is UnavailableOnMobileDeepLink && other.uri == uri;

  @override
  int get hashCode => uri.hashCode;

  @override
  String toString() => 'UnavailableOnMobileDeepLink($uri)';
}

/// Parse any `buzz://` link. Returns null for other schemes and for malformed
/// channel or message links, which name a delivered target but not a valid one.
BuzzDeepLink? parseBuzzDeepLink(Uri uri) {
  if (uri.scheme != 'buzz') return null;
  return switch (uri.host) {
    'channel' => parseChannelDeepLink(uri),
    'message' => parseMessageDeepLink(uri),
    _ => UnavailableOnMobileDeepLink(uri),
  };
}
