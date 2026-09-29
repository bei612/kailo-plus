import 'package:flutter_test/flutter_test.dart';
import 'package:buzz/shared/relay/nostr_models.dart';

void main() {
  test('NostrFilter can serialize broad deletion subscriptions', () {
    const filter = NostrFilter(kinds: [EventKind.deletion], limit: 0);

    expect(filter.toJson(), {
      'kinds': [EventKind.deletion],
      'limit': 0,
    });
  });

  test('NostrFilter serializes relay query extensions', () {
    const filter = NostrFilter(
      kinds: EventKind.channelTimelineContentKinds,
      tags: {
        '#h': ['channel-id'],
      },
      limit: 50,
      extensions: {
        'top_level': true,
        'include_summaries': true,
        'include_aux': true,
        'before_id': 'cursor-id',
      },
    );

    expect(filter.toJson(), {
      'kinds': EventKind.channelTimelineContentKinds,
      'limit': 50,
      '#h': ['channel-id'],
      'top_level': true,
      'include_summaries': true,
      'include_aux': true,
      'before_id': 'cursor-id',
    });
  });
}
