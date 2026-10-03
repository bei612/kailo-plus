/// 一次 EVENT 发布没有被 Relay 接受时的三种情形，对用户意义各不相同
/// （apps/06 §4：结果不明不渲染为成功，也不渲染为失败）。
///
/// - [RelayPublishNotSent]：EVENT 没有离开本机（发出前连接已不在）。确定未发送。
/// - [RelayPublishRejected]：Relay 以 `OK false` 明确拒绝。确定未存储；
///   [rateLimited] 为真时是限流（`rate-limited:` 前缀），可在 [retryAfterSeconds]
///   后重试。
/// - [RelayPublishOutcomeUnknown]：EVENT 已发出但没有收到 `OK`（超时、断线、转入
///   后台）。Relay 可能已经存储它：原样重发同一个已签名事件（同一 id）由 Relay
///   以 `duplicate:` 接受（`buzz-relay` `handlers/ingest.rs` 的 `was_inserted` 分支），
///   不会产生第二条消息；重新签名则会。
sealed class RelayPublishFailure implements Exception {
  const RelayPublishFailure(this.eventId);

  /// 这次发布的已签名事件 id
  final String eventId;
}

class RelayPublishNotSent extends RelayPublishFailure {
  const RelayPublishNotSent(super.eventId, this.reason);

  /// 诊断用原因，不进入用户界面
  final String reason;

  @override
  String toString() => 'Event $eventId not sent: $reason';
}

class RelayPublishRejected extends RelayPublishFailure {
  const RelayPublishRejected(
    super.eventId,
    this.message, {
    this.retryAfterSeconds,
  });

  /// Relay 的 `OK` 原文（机器可读前缀 + 说明），只作诊断证据
  final String message;

  /// 限流时 Relay 给出的 `retry in Ns`；未给出时为 null
  final int? retryAfterSeconds;

  bool get rateLimited =>
      message.trim().toLowerCase().startsWith('rate-limited:');

  @override
  String toString() => 'Event $eventId rejected: $message';
}

class RelayPublishOutcomeUnknown extends RelayPublishFailure {
  const RelayPublishOutcomeUnknown(super.eventId, this.reason);

  /// 诊断用原因，不进入用户界面
  final String reason;

  @override
  String toString() => 'Event $eventId outcome unknown: $reason';
}
