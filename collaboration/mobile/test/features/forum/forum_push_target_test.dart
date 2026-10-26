import 'package:flutter_test/flutter_test.dart';
import 'package:buzz/features/forum/forum_provider.dart';
import 'package:buzz/shared/relay/relay.dart';

NostrEvent event(String id, int kind, {String channel = 'forum', String? parent}) => NostrEvent(
  id: id, pubkey: 'author', createdAt: 100, kind: kind,
  tags: [['h', channel], if (parent != null) ['e', parent, '', 'reply']],
  content: 'full body $id', sig: '',
);

void main() {
  test('a pushed nested comment resolves the actual root and all same-second replies', () async {
    final root = event('post', EventKind.forumPost);
    final parent = event('parent', EventKind.forumComment, parent: root.id);
    final target = event('target', EventKind.forumComment, parent: parent.id);
    final first = List.generate(200, (i) => event('reply-$i', EventKind.forumComment, parent: root.id));
    final filters = <NostrFilter>[];
    final result = await loadForumThread((query) async {
      final filter = query.single;
      filters.add(filter);
      expect(filter.tags['#h'], ['forum']);
      if (filter.ids case final ids?) {
        return [switch(ids.single) { 'post' => root, 'parent' => parent, 'target' => target, _ => throw StateError('bad id') }];
      }
      if (!filter.extensions.containsKey('thread_cursor_id')) return first;
      expect(filter.extensions['thread_cursor_id'], 'reply-199');
      expect(filter.extensions['thread_cursor'], 100);
      return [parent, target];
    }, 'forum', target.id);
    expect(result.post.eventId, root.id);
    expect(result.post.content, 'full body post');
    expect(result.replies, hasLength(202));
    expect(result.replies.any((r) => r.eventId == target.id), isTrue);
    expect(filters, hasLength(5));
  });
  test('a cross-channel pushed target cannot open another forum', () async {
    await expectLater(loadForumThread((_) async => [event('post', EventKind.forumPost, channel: 'other')], 'forum', 'post'), throwsFormatException);
  });
  test('cyclic or absent ancestry fails without inventing a thread', () async {
    await expectLater(loadForumThread((_) async => [event('loop', EventKind.forumComment, parent: 'loop')], 'forum', 'loop'), throwsFormatException);
    await expectLater(loadForumThread((_) async => [], 'forum', 'missing'), throwsFormatException);
  });
}
