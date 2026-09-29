import 'dart:async';

import 'package:buzz/features/channels/channel.dart';
import 'package:buzz/features/channels/channels_provider.dart';
import 'package:buzz/features/channels/deep_link_dispatcher.dart';
import 'package:buzz/features/kailo/kailo_unavailable_page.dart';
import 'package:buzz/shared/deeplink/deep_link.dart';
import 'package:buzz/shared/deeplink/pending_deep_link_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

void main() {
  testWidgets('queues deep links in arrival order until acknowledged', (
    tester,
  ) async {
    final controller = StreamController<Uri>();
    PendingDeepLinkNotifier.debugUriStreamOverride = controller.stream;
    addTearDown(() async {
      PendingDeepLinkNotifier.debugUriStreamOverride = null;
      await controller.close();
    });
    final container = ProviderContainer();
    addTearDown(container.dispose);
    container.read(pendingDeepLinkProvider);

    const channelId = '580ca78b-9dae-46f3-8854-bd671853ba32';
    final firstId = 'aa' * 32;
    final secondId = 'bb' * 32;
    controller
      ..add(Uri.parse('buzz://message?channel=$channelId&id=$firstId'))
      ..add(Uri.parse('buzz://message?channel=$channelId&id=$secondId'));
    await tester.pump();

    expect(
      container.read(pendingDeepLinkProvider),
      MessageDeepLink(channelId: channelId, messageId: firstId),
    );
    container.read(pendingDeepLinkProvider.notifier).consume();
    expect(
      container.read(pendingDeepLinkProvider),
      MessageDeepLink(channelId: channelId, messageId: secondId),
    );
    container.read(pendingDeepLinkProvider.notifier).consume();
    expect(container.read(pendingDeepLinkProvider), isNull);
  });

  testWidgets('drops a missing channel and dispatches the next queued link', (
    tester,
  ) async {
    const missing = ChannelDeepLink(channelId: 'missing-channel');
    const next = ChannelDeepLink(channelId: 'channel-1');
    final pending = _QueuedPendingDeepLinkNotifier([missing, next]);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          pendingDeepLinkProvider.overrideWith(() => pending),
          channelsProvider.overrideWith(
            () => _FakeChannelsNotifier(Future.value([_channel])),
          ),
        ],
        child: MaterialApp(
          home: DeepLinkDispatcher(
            destinationBuilder: (channel, link) =>
                _CapturedDestination(channel: channel, link: link),
            child: const Scaffold(body: SizedBox()),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(pending.consumeCalls, 2);
    final destination = tester.widget<_CapturedDestination>(
      find.byType(_CapturedDestination),
    );
    expect(destination.channel.id, 'channel-1');
    expect(destination.link, same(next));
  });

  testWidgets('dispatches a link that is already ready on mount', (
    tester,
  ) async {
    const link = MessageDeepLink(
      channelId: 'channel-1',
      messageId: 'message-2',
      threadRootId: 'message-1',
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          pendingDeepLinkProvider.overrideWith(
            () => _FakePendingDeepLinkNotifier(link),
          ),
          channelsProvider.overrideWith(
            () => _FakeChannelsNotifier(Future.value([_channel])),
          ),
        ],
        child: MaterialApp(
          home: DeepLinkDispatcher(
            destinationBuilder: (channel, link) =>
                _CapturedDestination(channel: channel, link: link),
            child: const Scaffold(body: SizedBox()),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    final destination = tester.widget<_CapturedDestination>(
      find.byType(_CapturedDestination),
    );
    final messageLink = destination.link as MessageDeepLink;
    expect(destination.channel.id, 'channel-1');
    expect(messageLink.messageId, 'message-2');
    expect(messageLink.threadRootId, 'message-1');
  });

  for (final signedIn in [true, false]) {
    testWidgets(
      'answers a link to an undelivered capability with a stable reason '
      '(signed in: $signedIn)',
      (tester) async {
        final link = UnavailableOnMobileDeepLink(
          Uri.parse('buzz://pr?id=${'cd' * 32}&owner=${'ab' * 32}&d=repo'),
        );
        final pending = _QueuedPendingDeepLinkNotifier([link]);

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              pendingDeepLinkProvider.overrideWith(() => pending),
              channelsProvider.overrideWith(
                () => _FakeChannelsNotifier(Future.value([_channel])),
              ),
            ],
            child: MaterialApp(
              home: DeepLinkDispatcher(
                dispatchMessageLinks: signedIn,
                child: const Scaffold(body: SizedBox()),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        // V-SCN-65：不打开目标、不内嵌 WebView，给出稳定 reason code
        expect(find.byType(KailoUnavailablePage), findsOneWidget);
        expect(find.text('SURFACE_CAPABILITY_UNAVAILABLE'), findsOneWidget);
        expect(find.text(link.uri.toString()), findsOneWidget);
        expect(pending.consumeCalls, 1);
      },
    );
  }

  testWidgets('dispatches a channel-only link to the channel root', (
    tester,
  ) async {
    const link = ChannelDeepLink(channelId: 'channel-1');

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          pendingDeepLinkProvider.overrideWith(
            () => _FakePendingDeepLinkNotifier(link),
          ),
          channelsProvider.overrideWith(
            () => _FakeChannelsNotifier(Future.value([_channel])),
          ),
        ],
        child: MaterialApp(
          home: DeepLinkDispatcher(
            destinationBuilder: (channel, link) =>
                _CapturedDestination(channel: channel, link: link),
            child: const Scaffold(body: SizedBox()),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    final destination = tester.widget<_CapturedDestination>(
      find.byType(_CapturedDestination),
    );
    expect(destination.channel.id, 'channel-1');
    expect(destination.link, same(link));
  });
}

final _channel = Channel(
  id: 'channel-1',
  name: 'general',
  channelType: 'stream',
  visibility: 'open',
  description: 'General discussion',
  createdBy: 'creator',
  createdAt: DateTime(2026),
  memberCount: 2,
  isMember: true,
);

class _QueuedPendingDeepLinkNotifier extends PendingDeepLinkNotifier {
  _QueuedPendingDeepLinkNotifier(List<BuzzDeepLink> links)
    : _links = List.of(links);

  final List<BuzzDeepLink> _links;
  int consumeCalls = 0;

  BuzzDeepLink? get _firstOrNull => _links.isEmpty ? null : _links.first;
  BuzzDeepLink? get current => _firstOrNull;

  @override
  BuzzDeepLink? build() => _firstOrNull;

  @override
  void consume() {
    consumeCalls++;
    _links.removeAt(0);
    state = _firstOrNull;
  }
}

class _FakePendingDeepLinkNotifier extends PendingDeepLinkNotifier {
  _FakePendingDeepLinkNotifier(this.link);

  final BuzzDeepLink link;

  @override
  BuzzDeepLink? build() => link;
}

class _FakeChannelsNotifier extends ChannelsNotifier {
  _FakeChannelsNotifier(this.channels);

  final Future<List<Channel>> channels;

  @override
  Future<List<Channel>> build() => channels;
}

class _CapturedDestination extends StatelessWidget {
  const _CapturedDestination({required this.channel, required this.link});

  final Channel channel;
  final BuzzDeepLink link;

  @override
  Widget build(BuildContext context) => const SizedBox();
}
