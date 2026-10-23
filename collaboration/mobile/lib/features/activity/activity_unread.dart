// Buzz 779af8886caae1317b4de962082429867ab61503 mobile/lib/app.dart::_unreadInboxItemCountProvider,
// moved next to the Activity module so the Home tab dot needs no root wiring.
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/read_state/read_state_provider.dart';
import 'activity_provider.dart';
import 'inbox_read_state.dart';
import 'inbox_local_state_provider.dart';

/// Number of Activity inbox rows that are not done for the current reader.
final unreadInboxItemCountProvider = Provider<int>((ref) {
  final readState = ref.watch(readStateProvider);
  if (!readState.isReady) return 0;

  final localState = ref.watch(inboxLocalStateProvider);
  final items = ref.watch(inboxItemsProvider);
  return items
      .where(
        (item) => !isInboxItemDone(
          item,
          markerOf: readState.effectiveTimestamp,
          localUnreadOverrides: localState.unreadIds,
          localDoneSet: localState.doneIds,
        ),
      )
      .length;
});

/// Whether the Activity tab shows its unread dot.
final hasUnreadInboxProvider = Provider<bool>(
  (ref) => ref.watch(unreadInboxItemCountProvider) > 0,
);
