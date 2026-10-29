import 'dart:async';

import 'package:buzz/shared/push/push_bridge.dart';
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('test/push');
  const codec = StandardMethodCodec();
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  Future<Object?> native(String method, Object? arguments) async {
    final reply = Completer<ByteData?>();
    await messenger.handlePlatformMessage(
      channel.name,
      codec.encodeMethodCall(MethodCall(method, arguments)),
      reply.complete,
    );
    final data = await reply.future;
    return data == null ? null : codec.decodeEnvelope(data);
  }

  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    messenger.setMockMethodCallHandler(channel, null);
    channel.setMethodCallHandler(null);
  });

  test(
    'Android selects FCM only from native configuration and preserves permission intent',
    () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      String? transport = 'FCM';
      final calls = <MethodCall>[];
      messenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(call);
        return call.method == 'pushPlatform' ? transport : null;
      });
      final bridge = MethodChannelPushBridge(channel: channel);
      expect(await bridge.deliveryPlatform(), PushPlatform.FCM);
      transport = null;
      expect(await bridge.deliveryPlatform(), isNull);
      await bridge.startRegistration(requestPermission: false);
      expect(calls.last.arguments, {'requestPermission': false});
      final token = bridge.tokens.first;
      await native('fcmTokenChanged', {'token': 'opaque-fcm-token'});
      expect(await token, 'opaque-fcm-token');
      final changed = bridge.authorizationChanges.first;
      await native('notificationAuthorizationChanged', null);
      await changed;
    },
  );

  test(
    'cold notification remains native-pending until the actual navigation consumer is listening',
    () async {
      final bridge = MethodChannelPushBridge(channel: channel);
      const target = {
        'communityId': 'tenant',
        'channelId': 'channel',
        'eventId': 'forum-reply',
      };
      expect(await native('notificationOpened', target), isNull);
      final opened = bridge.opened.first;
      expect(await native('notificationOpened', target), 'handled');
      final link = await opened;
      expect(link.channelId, 'channel');
      expect(link.messageId, 'forum-reply');
      messenger.setMockMethodCallHandler(
        channel,
        (call) async =>
            call.method == 'takePendingNotificationResponse' ? target : null,
      );
      final cold = await bridge.takePendingOpen();
      expect(cold, link);
    },
  );
}
