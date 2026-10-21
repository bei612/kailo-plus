import 'package:buzz/features/activity/feed_item.dart';
import 'package:buzz/features/activity/inbox_item.dart';
import 'package:buzz/features/activity/inbox_read_state.dart';
import 'package:buzz/shared/read_state/read_state_format.dart';
import 'package:flutter_test/flutter_test.dart';

FeedItem item({
  required String id,
  int createdAt = 100,
  String category = 'mention',
  String? channelId = 'ch1',
  List<List<String>> tags = const [],
}) => FeedItem(
  id: id,
  kind: 9,
  pubkey: 'pk1',
  content: 'hello',
  createdAt: createdAt,
  channelId: channelId,
  tags: tags,
  category: category,
);

List<List<String>> replyTags(String rootId, String parentId) => [
  ['e', rootId, '', 'root'],
  ['e', parentId, '', 'reply'],
];

int? Function(String) markers(Map<String, int> map) =>
    (contextId) => map[contextId];

bool Function(String) forced(Set<String> contexts) => contexts.contains;

void main() {
  group('resolveInboxItemReadAt', () {
    test('channel rows use the channel marker', () {
      final row = buildInboxItems([item(id: 'a')]).single;
      expect(resolveInboxItemReadAt(row, markerOf: markers({'ch1': 42})), 42);
    });

    test('thread rows use max of thread and msg markers', () {
      final row = buildInboxItems([
        item(id: 'a', tags: replyTags('root1', 'root1')),
      ]).single;
      expect(
        resolveInboxItemReadAt(
          row,
          markerOf: markers({'thread:root1': 10, 'msg:a': 25}),
        ),
        25,
      );
    });

    test('channel-less rows have no marker', () {
      final row = buildInboxItems([item(id: 'a', channelId: null)]).single;
      expect(resolveInboxItemReadAt(row, markerOf: markers({})), isNull);
    });
  });

  group('isInboxItemDone', () {
    test('done when no grouped activity is newer than the marker', () {
      final row = buildInboxItems([item(id: 'a', createdAt: 50)]).single;
      expect(
        isInboxItemDone(
          row,
          markerOf: markers({'ch1': 50}),
          isForcedUnread: forced({}),
        ),
        isTrue,
      );
      expect(
        isInboxItemDone(
          row,
          markerOf: markers({'ch1': 49}),
          isForcedUnread: forced({}),
        ),
        isFalse,
      );
    });

    test("a forced-unread flag on the row's context wins", () {
      final channelRow = buildInboxItems([item(id: 'a', createdAt: 50)]).single;
      expect(
        isInboxItemDone(
          channelRow,
          markerOf: markers({'ch1': 99}),
          isForcedUnread: forced({'ch1'}),
        ),
        isFalse,
      );
      final threadRow = buildInboxItems([
        item(id: 'r', createdAt: 50, tags: replyTags('root1', 'root1')),
      ]).single;
      expect(
        isInboxItemDone(
          threadRow,
          markerOf: markers({'msg:r': 99}),
          isForcedUnread: forced({'msg:r'}),
        ),
        isFalse,
      );
      // A force on an unrelated context does not reopen the row.
      expect(
        isInboxItemDone(
          threadRow,
          markerOf: markers({'msg:r': 99}),
          isForcedUnread: forced({'ch1'}),
        ),
        isTrue,
      );
    });

    test('rows without a marker stay unread', () {
      final row = buildInboxItems([item(id: 'a', channelId: null)]).single;
      expect(
        isInboxItemDone(row, markerOf: markers({}), isForcedUnread: forced({})),
        isFalse,
      );
    });
  });

  group('inboxItemReadMarks', () {
    test('channel rows advance the channel to the latest activity', () {
      final row = buildInboxItems([item(id: 'a', createdAt: 50)]).single;
      expect(inboxItemReadMarks(row), [(contextId: 'ch1', timestamp: 50)]);
    });

    test('thread rows advance shared msg markers for every reply', () {
      final root = 'f' * 64;
      final a = 'a' * 64;
      final b = 'b' * 64;
      final row = buildInboxItems([
        item(id: a, createdAt: 10, tags: replyTags(root, root)),
        item(id: b, createdAt: 30, tags: replyTags(root, a)),
      ]).single;
      final marks = {
        for (final mark in inboxItemReadMarks(row))
          mark.contextId: mark.timestamp,
      };
      expect(marks, {'msg:$b': 30, 'msg:$a': 10, 'thread:$root': 30});
      // The msg keys are ones Core accepts, so the position is shared with
      // Web/Desktop (DD-40); the thread key stays on this device.
      expect(marks.keys.where(isSharedReadContextKey).toSet(), {
        'msg:$a',
        'msg:$b',
      });
    });

    test('marking a thread read never swallows unrelated channel posts', () {
      final row = buildInboxItems([
        item(id: 'root1', createdAt: 10),
        item(id: 'b', createdAt: 30, tags: replyTags('root1', 'root1')),
      ]).single;
      final marks = inboxItemReadMarks(row);
      expect(marks, contains((contextId: 'ch1', timestamp: 10)));
      expect(marks, isNot(contains((contextId: 'ch1', timestamp: 30))));
    });

    test('marks clear the context a Mark unread forced', () {
      final row = buildInboxItems([
        item(id: 'root1', createdAt: 40),
        item(id: 'b', createdAt: 30, tags: replyTags('root1', 'root1')),
      ]).single;
      expect(row.item.id, 'root1');
      expect(inboxItemReadContext(row), 'msg:root1');
      expect(
        inboxItemReadMarks(row).map((mark) => mark.contextId),
        contains('msg:root1'),
      );
    });
  });

  group('groupedChannelReadTimestamp', () {
    test('only counts top-level events in the channel', () {
      final row = buildInboxItems([
        item(id: 'a', createdAt: 10, tags: replyTags('root1', 'root1')),
        item(id: 'b', createdAt: 30, tags: replyTags('root1', 'a')),
      ]).single;
      expect(groupedChannelReadTimestamp(row), isNull);
    });

    test('returns the newest top-level timestamp', () {
      final row = buildInboxItems([
        item(id: 'root1', createdAt: 10),
        item(id: 'b', createdAt: 30, tags: replyTags('root1', 'root1')),
      ]).single;
      final result = groupedChannelReadTimestamp(row);
      expect(result?.channelId, 'ch1');
      expect(result?.timestamp, 10);
    });
  });
}
