import 'package:buzz/shared/auth/auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:nostr/nostr.dart' as nostr;

import 'community_storage_test.dart';

Community _community(String host) => Community.create(
  name: host,
  relayUrl: 'wss://$host',
  nsec: nostr.Keys.generate().nsec,
);

void main() {
  test('connecting keeps exactly one community: the resolved Tenant', () async {
    final storage = CommunityStorage(secure: FakeSecureStorage());
    final container = ProviderContainer(
      overrides: [communityStorageProvider.overrideWithValue(storage)],
    );
    addTearDown(container.dispose);
    await container.read(authProvider.future);

    final first = _community('t1.kailo.test');
    final second = _community('t1.kailo.test:8443');
    await container
        .read(authProvider.notifier)
        .authenticateWithCommunity(first);
    await container
        .read(authProvider.notifier)
        .authenticateWithCommunity(second);

    expect((await storage.loadAll()).map((c) => c.id), [second.id]);
    expect(await storage.loadActiveId(), second.id);
    expect(
      (await container.read(activeCommunityProvider.future))?.id,
      second.id,
    );
  });

  test('sign-out removes the community and its device secret', () async {
    final storage = CommunityStorage(secure: FakeSecureStorage());
    final container = ProviderContainer(
      overrides: [communityStorageProvider.overrideWithValue(storage)],
    );
    addTearDown(container.dispose);
    await container.read(authProvider.future);
    await container
        .read(authProvider.notifier)
        .authenticateWithCommunity(_community('t1.kailo.test'));

    await container.read(authProvider.notifier).signOut();

    expect(await storage.loadAll(), isEmpty);
    expect(await storage.loadActiveId(), isNull);
    expect(
      (await container.read(authProvider.future)).status,
      AuthStatus.unauthenticated,
    );
  });
}
