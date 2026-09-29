import 'package:buzz/shared/deeplink/deep_link.dart';
import 'package:buzz/shared/deeplink/pending_deep_link_provider.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

const _channel = '11111111-1111-4111-8111-111111111111';

void main() {
  setUp(() {
    PendingDeepLinkNotifier.debugUriStreamOverride = const Stream.empty();
  });

  tearDown(() {
    PendingDeepLinkNotifier.debugUriStreamOverride = null;
  });

  test('links queue in arrival order and consume exposes the next', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final notifier = container.read(pendingDeepLinkProvider.notifier);

    notifier.open(Uri.parse('buzz://channel/$_channel'));
    notifier.open(Uri.parse('buzz://pr?id=x&owner=y&d=z'));

    expect(
      container.read(pendingDeepLinkProvider),
      const ChannelDeepLink(channelId: _channel),
    );
    notifier.consume();
    expect(
      container.read(pendingDeepLinkProvider),
      isA<UnavailableOnMobileDeepLink>(),
    );
    notifier.consume();
    expect(container.read(pendingDeepLinkProvider), isNull);
  });

  test('non-buzz links such as the sign-in redirect are not parked', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    container
        .read(pendingDeepLinkProvider.notifier)
        .open(Uri.parse('xyz.block.buzz.mobile:/kailo/oauth2redirect?code=c'));

    expect(container.read(pendingDeepLinkProvider), isNull);
  });
}
