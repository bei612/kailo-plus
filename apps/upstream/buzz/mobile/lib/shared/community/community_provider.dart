import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'community.dart';
import 'community_storage.dart';

/// Serializes every mutation of the stored community and its credentials.
final class CommunityTransitionCoordinator {
  Future<void> _operationTail = Future.value();

  /// Runs a complete community mutation after every earlier mutation finishes.
  Future<void> runExclusive(Future<void> Function() operation) {
    final result = _operationTail.then((_) => operation());
    _operationTail = result.then<void>(
      (_) {},
      onError: (Object _, StackTrace _) {},
    );
    return result;
  }
}

final communityTransitionProvider = Provider<CommunityTransitionCoordinator>(
  (ref) => CommunityTransitionCoordinator(),
);

final communityStorageProvider = Provider<CommunityStorage>((ref) {
  return CommunityStorage();
});

class CommunityListNotifier extends AsyncNotifier<List<Community>> {
  @override
  Future<List<Community>> build() {
    return ref.read(communityStorageProvider).loadAll();
  }

  /// Removes the active community and its stored credentials so
  /// [AuthNotifier] can publish the resulting signed-out state.
  Future<void> removeActiveCommunityForSignOut() {
    return ref.read(communityTransitionProvider).runExclusive(() async {
      final storage = ref.read(communityStorageProvider);
      final id = await storage.loadActiveId();
      if (id == null) return;
      await storage.remove(id);
      final remaining = await storage.loadAll();
      if (remaining.isNotEmpty) {
        await storage.saveActiveId(remaining.first.id);
      } else {
        await storage.clearActiveId();
      }
      state = AsyncData(remaining);
    });
  }
}

final communityListProvider =
    AsyncNotifierProvider<CommunityListNotifier, List<Community>>(
      CommunityListNotifier.new,
    );

/// The currently active community, derived from the stored active ID and
/// the community list.
final activeCommunityProvider = FutureProvider<Community?>((ref) async {
  final communities = await ref.watch(communityListProvider.future);
  final storage = ref.read(communityStorageProvider);
  final activeId = await storage.loadActiveId();

  if (communities.isEmpty) return null;

  final active = communities.where((w) => w.id == activeId).firstOrNull;
  if (active != null) return active;
  // No usable active ID stored but communities exist — fall back to first.
  await storage.saveActiveId(communities.first.id);
  return communities.first;
});
