import 'package:buzz/features/activity/feed_item.dart';
import 'package:flutter_test/flutter_test.dart';

FeedItem item({
  String id = 'a',
  int createdAt = 100,
  String category = 'mention',
  List<List<String>> tags = const [],
  String content = 'hello',
}) => FeedItem(
  id: id,
  kind: 9,
  pubkey: 'pk1',
  content: content,
  createdAt: createdAt,
  channelId: 'ch1',
  tags: tags,
  category: category,
);

void main() {
  group('threadHeadId', () {
    test('is the direct parent for nested replies', () {
      final reply = item(
        tags: const [
          ['e', 'root', '', 'root'],
          ['e', 'parent', '', 'reply'],
        ],
      );
      expect(reply.threadHeadId, 'parent');
    });

    test('is null for top-level messages and unmarked e tags', () {
      expect(item().threadHeadId, isNull);
      expect(
        item(
          tags: const [
            ['e', 'quoted'],
          ],
        ).threadHeadId,
        isNull,
      );
    });
  });

  test('headline follows the category in the selected locale', () {
    expect(item(category: 'mention').headline(locale: 'en'), 'Mention');
    expect(item(category: 'activity').headline(locale: 'en'), 'Channel update');
    expect(item(category: 'activity').headline(locale: 'zh-CN'), '频道更新');
  });

  test('displayContent trims and falls back for empty events', () {
    expect(item(content: '  hi  ').displayContent(locale: 'en'), 'hi');
    expect(
      item(content: '   ').displayContent(locale: 'en'),
      'No additional details were attached to this event.',
    );
  });

  test('HomeFeedResponse merges sources newest-first', () {
    final feed = HomeFeedResponse(
      mentions: [item(id: 'm', createdAt: 10)],
      activity: [item(id: 'd', createdAt: 20, category: 'activity')],
    );
    expect(feed.all.map((i) => i.id), ['d', 'm']);
    expect(feed.isEmpty, isFalse);
    expect(HomeFeedResponse.empty().isEmpty, isTrue);
  });
}
