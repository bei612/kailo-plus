import 'package:flutter_test/flutter_test.dart';
import 'package:buzz/features/channels/channel.dart';

void main() {
  group('Channel.copyWith', () {
    final base = Channel(
      id: '1',
      name: 'test',
      channelType: 'stream',
      visibility: 'open',
      description: '',
      createdBy: 'x',
      createdAt: DateTime(2025),
      memberCount: 5,
      archivedAt: DateTime(2025, 1, 2),
      lastMessageAt: DateTime(2025, 6, 1),
      isMember: true,
    );

    test('can explicitly null out archivedAt', () {
      final updated = base.copyWith(archivedAt: null);
      expect(updated.archivedAt, isNull);
    });

    test('can explicitly null out lastMessageAt', () {
      final updated = base.copyWith(lastMessageAt: null);
      expect(updated.lastMessageAt, isNull);
    });

    test('preserves archivedAt when not specified', () {
      final updated = base.copyWith(memberCount: 10);
      expect(updated.archivedAt, base.archivedAt);
      expect(updated.memberCount, 10);
    });

    test('can set new archivedAt value', () {
      final newDate = DateTime(2026);
      final updated = base.copyWith(archivedAt: newDate);
      expect(updated.archivedAt, newDate);
    });
  });
}
