// Buzz 779af8886caae1317b4de962082429867ab61503 mobile/lib/shared/push/push_bridge.dart,
// narrowed to Kailo's DD-151 channel: the native `buzz/push` bridge (AppDelegate) still asks
// iOS for notification permission, registers with APNs and reports the device token and
// notification taps. Gateway enrollment, endpoint grants and push snapshots are not used —
// the device registers its token with Core instead (push_registration.dart).
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../deeplink/deep_link.dart';

enum PushAuthorizationStatus {
  notDetermined,
  denied,
  authorized,
  provisional,
  ephemeral,
}

/// The native push surface the settings toggle and registration use.
abstract interface class PushBridge {
  Future<PushAuthorizationStatus?> authorizationStatus();
  Future<bool> openNotificationSettings();

  /// Prompts for display permission (first time only) and asks APNs for a token; the token
  /// arrives on [tokens].
  Future<void> startRegistration();
  Stream<String> get tokens;

  /// Notification taps, cold start included (see [takePendingOpen]).
  Stream<MessageDeepLink> get opened;
  Future<MessageDeepLink?> takePendingOpen();
}

/// Navigation arguments the native side sends for a tap: ids only.
MessageDeepLink? pushNotificationLink(Object? arguments) {
  if (arguments is! Map) return null;
  final eventId = arguments['eventId'];
  final channelId = arguments['channelId'];
  if (eventId is! String ||
      eventId.isEmpty ||
      channelId is! String ||
      channelId.isEmpty) {
    return null;
  }
  return MessageDeepLink(channelId: channelId, messageId: eventId);
}

class MethodChannelPushBridge implements PushBridge {
  MethodChannelPushBridge({MethodChannel? channel})
    : _channel = channel ?? const MethodChannel('buzz/push') {
    _channel.setMethodCallHandler(_handle);
  }

  final MethodChannel _channel;
  final _tokens = StreamController<String>.broadcast();
  final _opened = StreamController<MessageDeepLink>.broadcast();

  Future<Object?> _handle(MethodCall call) async {
    switch (call.method) {
      case 'apnsTokenChanged':
        final token = (call.arguments as Map?)?['token'];
        if (token is String && token.isNotEmpty) _tokens.add(token);
        return null;
      case 'apnsRegistrationFailed':
        final message = (call.arguments as Map?)?['message'];
        debugPrint('push: APNs registration failed: $message');
        return null;
      case 'notificationOpened':
        final link = pushNotificationLink(call.arguments);
        if (link == null) return null;
        _opened.add(link);
        return 'handled';
    }
    return null;
  }

  @override
  Stream<String> get tokens => _tokens.stream;

  @override
  Stream<MessageDeepLink> get opened => _opened.stream;

  @override
  Future<PushAuthorizationStatus?> authorizationStatus() async {
    try {
      final raw = await _channel.invokeMethod<String>(
        'notificationAuthorizationStatus',
      );
      return switch (raw) {
        'notDetermined' => PushAuthorizationStatus.notDetermined,
        'denied' => PushAuthorizationStatus.denied,
        'authorized' => PushAuthorizationStatus.authorized,
        'provisional' => PushAuthorizationStatus.provisional,
        'ephemeral' => PushAuthorizationStatus.ephemeral,
        _ => null,
      };
    } on MissingPluginException {
      return null;
    }
  }

  @override
  Future<bool> openNotificationSettings() async {
    try {
      return await _channel.invokeMethod<bool>('openNotificationSettings') ??
          false;
    } on MissingPluginException {
      return false;
    }
  }

  @override
  Future<void> startRegistration() async {
    try {
      await _channel.invokeMethod<void>('startRegistration');
    } on MissingPluginException {
      // Flutter tests and non-Runner embeddings do not install the native bridge.
    }
  }

  @override
  Future<MessageDeepLink?> takePendingOpen() async {
    try {
      final arguments = await _channel.invokeMapMethod<dynamic, dynamic>(
        'takePendingNotificationResponse',
      );
      return pushNotificationLink(arguments);
    } on MissingPluginException {
      return null;
    }
  }
}

final pushBridgeProvider = Provider<PushBridge>(
  (ref) => MethodChannelPushBridge(),
);

/// Display permission as iOS reports it; refreshed when the settings page is shown.
final pushAuthorizationStatusProvider =
    FutureProvider.autoDispose<PushAuthorizationStatus?>(
      (ref) => ref.watch(pushBridgeProvider).authorizationStatus(),
    );
