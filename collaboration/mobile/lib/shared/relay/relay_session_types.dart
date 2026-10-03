import 'package:flutter/foundation.dart';

import 'relay_socket.dart';

enum SessionStatus { disconnected, connecting, connected, reconnecting }

typedef RelaySocketFactory =
    RelaySocket Function({
      required String wsUrl,
      required String? nsec,
      required void Function(List<dynamic> message) onMessage,
      required void Function() onConnected,
      required void Function(Object? error) onDisconnected,
    });

@immutable
class SessionState {
  final SessionStatus status;
  final int reconnectAttempt;

  /// Relay 在 NIP-42 AUTH 阶段拒绝了本机身份（例如设备公钥已被撤销）。会话不会
  /// 自动重连：界面须如实显示「服务器不再接受本机」，而不是「正在重连」。
  final bool authRejected;

  const SessionState({
    required this.status,
    this.reconnectAttempt = 0,
    this.authRejected = false,
  });
}

/// Recovery lifecycle for a live relay subscription.
enum RelaySubscriptionStatus { ready, retrying }
