import 'package:buzz/features/activity/feed_item.dart';
import 'package:buzz/features/activity/inbox_item.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';

FeedItem item({
  required String id,
  int createdAt = 100,
  String category = 'mention',
  String pubkey = 'pk1',
  String? channelId = 'ch1',
  List<List<String>> tags = const [],
  int kind = 9,
  String content = 'hello',
}) => FeedItem(
  id: id,
  kind: kind,
  pubkey: pubkey,
  content: content,
  createdAt: createdAt,
  channelId: channelId,
  tags: tags,
  category: category,
);

List<List<String>> replyTags(String rootId, String parentId) => [
  ['e', rootId, '', 'root'],
  ['e', parentId, '', 'reply'],
];

void main() {
  setUpAll(() => initializeDateFormatting());

  group('inboxConversationId', () {
    test('uses root id when present', () {
      expect(
        inboxConversationId(replyTags('root1', 'parent1'), 'ev1'),
        'root1',
      );
    });

    test('falls back to parent id without a root tag', () {
      expect(
        inboxConversationId([
          ['e', 'parent1', '', 'reply'],
        ], 'ev1'),
        'parent1',
      );
    });

    test('falls back to the event id for top-level messages', () {
      expect(inboxConversationId(const [], 'ev1'), 'ev1');
    });
  });

  group('isThreadReply', () {
    test('true for reply-tagged events', () {
      expect(isThreadReply(replyTags('r', 'p')), isTrue);
    });

    test('false for broadcast replies', () {
      expect(
        isThreadReply([
          ...replyTags('r', 'p'),
          ['broadcast', '1'],
        ]),
        isFalse,
      );
    });

    test('false for top-level messages', () {
      expect(isThreadReply(const []), isFalse);
    });
  });

  group('buildInboxItems', () {
    test('groups thread events into one conversation row', () {
      final rows = buildInboxItems([
        item(id: 'a', createdAt: 10, tags: replyTags('root1', 'root1')),
        item(id: 'b', createdAt: 20, tags: replyTags('root1', 'a')),
        item(id: 'c', createdAt: 15),
      ]);

      expect(rows, hasLength(2));
      final threadRow = rows.firstWhere((r) => r.conversationId == 'root1');
      expect(threadRow.id, 'b'); // latest event represents the row
      expect(threadRow.groupItems, hasLength(2));
      expect(threadRow.latestActivityAt, 20);
      expect(threadRow.threadRootId, 'root1');
    });

    test('sorts rows by latest activity, newest first', () {
      final rows = buildInboxItems([
        item(id: 'old', createdAt: 10),
        item(id: 'new', createdAt: 99),
      ]);
      expect(rows.map((r) => r.id).toList(), ['new', 'old']);
    });

    test('groups ordinary top-level DM messages into one row per DM', () {
      bool isDm(String channelId) => channelId == 'dm1';
      final rows = buildInboxItems([
        item(id: 'd1', createdAt: 10, channelId: 'dm1', category: 'activity'),
        item(id: 'd2', createdAt: 20, channelId: 'dm1', category: 'activity'),
        item(id: 'd3', createdAt: 30, channelId: 'dm1', category: 'activity'),
        item(id: 'c1', createdAt: 40, channelId: 'ch1'),
        item(id: 'c2', createdAt: 50, channelId: 'ch1'),
      ], isDmChannel: isDm);

      expect(rows, hasLength(3));
      final dmRow = rows.singleWhere((r) => r.conversationId == 'dm:dm1');
      expect(dmRow.groupItems, hasLength(3));
      expect(dmRow.id, 'd3');
      expect(dmRow.latestActivityAt, 30);
    });

    test('thread replies inside a DM still group by thread root', () {
      bool isDm(String channelId) => channelId == 'dm1';
      final rows = buildInboxItems([
        item(id: 'top', createdAt: 10, channelId: 'dm1'),
        item(
          id: 'reply',
          createdAt: 20,
          channelId: 'dm1',
          tags: replyTags('top', 'top'),
        ),
      ], isDmChannel: isDm);

      expect(rows, hasLength(2));
      expect(rows.map((r) => r.conversationId).toSet(), {'dm:dm1', 'top'});
    });

    test('categories are priority sorted, mention first', () {
      final rows = buildInboxItems([
        item(
          id: 'a',
          createdAt: 10,
          category: 'activity',
          tags: replyTags('root1', 'root1'),
        ),
        item(
          id: 'b',
          createdAt: 20,
          category: 'mention',
          tags: replyTags('root1', 'a'),
        ),
      ]);
      expect(rows.single.categories, ['mention', 'activity']);
    });
  });

  group('InboxItem.deepLinkTarget', () {
    final rows = buildInboxItems([
      item(id: 'a', createdAt: 10, tags: replyTags('root1', 'root1')),
      item(id: 'b', createdAt: 20, tags: replyTags('root1', 'a')),
      item(id: 'c', createdAt: 30, tags: replyTags('root1', 'b')),
    ]);

    test('targets the oldest unread event', () {
      expect(rows.single.deepLinkTarget(15).id, 'b');
    });

    test('targets the oldest event when nothing is read', () {
      expect(rows.single.deepLinkTarget(5).id, 'a');
    });

    test('falls back to the latest event when all are read', () {
      expect(rows.single.deepLinkTarget(99).id, 'c');
    });

    test('falls back to the latest event without a read marker', () {
      expect(rows.single.deepLinkTarget(null).id, 'c');
    });
  });

  group('matchesInboxFilter', () {
    InboxItem rowOf(FeedItem feedItem) => buildInboxItems([feedItem]).single;

    test('all matches everything', () {
      expect(matchesInboxFilter(rowOf(item(id: 'a')), InboxFilter.all), isTrue);
    });

    test('thread filter needs a thread reply in the group', () {
      expect(
        matchesInboxFilter(rowOf(item(id: 'a')), InboxFilter.thread),
        isFalse,
      );
      expect(
        matchesInboxFilter(
          rowOf(item(id: 'a', tags: replyTags('r', 'p'))),
          InboxFilter.thread,
        ),
        isTrue,
      );
    });

    test('category filters match their category', () {
      final mention = rowOf(item(id: 'a', category: 'mention'));
      expect(matchesInboxFilter(mention, InboxFilter.mention), isTrue);
      expect(matchesInboxFilter(mention, InboxFilter.activity), isFalse);
      final dm = rowOf(item(id: 'b', category: 'activity'));
      expect(matchesInboxFilter(dm, InboxFilter.activity), isTrue);
      expect(matchesInboxFilter(dm, InboxFilter.mention), isFalse);
    });

    test('drafts are a separate surface', () {
      expect(
        matchesInboxFilter(rowOf(item(id: 'a')), InboxFilter.drafts),
        isFalse,
      );
    });

    test('Mobile offers no filter for sources it does not read', () {
      expect(InboxFilter.values.map((f) => f.name), [
        'all',
        'mention',
        'thread',
        'activity',
        'drafts',
      ]);
    });
  });

  group('inboxTypeLabel', () {
    InboxItem rowOf(FeedItem feedItem) => buildInboxItems([feedItem]).single;

    test('DM rows lead with the sender', () {
      final label = inboxTypeLabel(
        rowOf(item(id: 'a', category: 'activity')),
        channelName: null,
        isDm: true,
        senderLabel: 'Alice',
        locale: 'en',
      );
      expect(label.text, 'DM from Alice');
      expect(label.channelLabel, isNull);
    });

    test('labels come from the shared catalog in the selected locale', () {
      final label = inboxTypeLabel(
        rowOf(item(id: 'a', category: 'activity')),
        channelName: null,
        isDm: true,
        senderLabel: 'Alice',
        locale: 'zh-CN',
      );
      expect(label.text, '来自 Alice 的私聊');
    });

    test('mention rows say Mentioned in #channel', () {
      final label = inboxTypeLabel(
        rowOf(item(id: 'a', category: 'mention')),
        channelName: 'general',
        isDm: false,
        senderLabel: 'Alice',
        locale: 'en',
      );
      expect(label.text, 'Mentioned in');
      expect(label.channelLabel, 'general');
    });

    test('mention wins over thread context', () {
      final label = inboxTypeLabel(
        rowOf(item(id: 'a', category: 'mention', tags: replyTags('r', 'p'))),
        channelName: 'general',
        isDm: false,
        senderLabel: 'Alice',
        locale: 'en',
      );
      expect(label.text, 'Mentioned in');
    });

    test('plain thread replies say Thread in', () {
      final label = inboxTypeLabel(
        rowOf(item(id: 'a', category: 'activity', tags: replyTags('r', 'p'))),
        channelName: 'general',
        isDm: false,
        senderLabel: 'Alice',
        locale: 'en',
      );
      expect(label.text, 'Thread in');
    });

    test('other activity uses the headline with its channel', () {
      final label = inboxTypeLabel(
        rowOf(item(id: 'a', category: 'activity')),
        channelName: 'general',
        isDm: false,
        senderLabel: 'Alice',
        locale: 'en',
      );
      expect(label.text, 'Channel update in');
      expect(label.channelLabel, 'general');
    });
  });

  group('inboxTimestamp', () {
    final now = DateTime(2026, 7, 25, 12);
    int at(DateTime d) => d.millisecondsSinceEpoch ~/ 1000;

    test('clock time today, Yesterday, then short dates', () {
      final morning = DateTime(2026, 7, 25, 9, 5);
      expect(
        inboxTimestamp(at(morning), locale: 'en', now: now),
        DateFormat.jm('en_US').format(morning),
      );
      expect(
        inboxTimestamp(at(DateTime(2026, 7, 24, 9)), locale: 'en', now: now),
        'Yesterday',
      );
      expect(
        inboxTimestamp(at(DateTime(2026, 1, 2)), locale: 'en', now: now),
        'Jan 2',
      );
      expect(
        inboxTimestamp(at(DateTime(2025, 12, 31)), locale: 'en', now: now),
        'Dec 31, 2025',
      );
    });

    test('follows the platform locale', () {
      expect(
        inboxTimestamp(
          at(DateTime(2026, 7, 24, 9)),
          locale: 'zh-CN',
          now: now,
        ),
        '昨天',
      );
    });
  });
}
