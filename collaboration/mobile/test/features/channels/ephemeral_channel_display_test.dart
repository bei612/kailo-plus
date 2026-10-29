import 'package:buzz/features/channels/channel.dart';
import 'package:buzz/features/channels/channel_management_provider.dart';
import 'package:buzz/features/channels/ephemeral_channel_display.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';

Channel _channel({int? ttlSeconds, DateTime? ttlDeadline}) => Channel(
  id: 'c1',
  name: 'scratch',
  channelType: 'stream',
  visibility: 'private',
  description: '',
  createdBy: 'creator',
  createdAt: DateTime.utc(2026),
  memberCount: 2,
  ttlSeconds: ttlSeconds,
  ttlDeadline: ttlDeadline,
);

void main() {
  setUpAll(() => initializeDateFormatting());

  test('a channel without TTL facts has no ephemeral display', () {
    expect(isEphemeralChannel(_channel()), isFalse);
    expect(ephemeralChannelDisplay(_channel()), isNull);
  });

  test('TTL without a deadline shows the original compact TTL and tooltip', () {
    final channel = _channel(ttlSeconds: 2 * 60 * 60);
    final en = ephemeralChannelDisplay(channel, locale: 'en')!;
    expect(en.detailLabel, '2h TTL');
    expect(
      en.tooltipLabel,
      'Ephemeral channel. Cleans up after 2 hours of inactivity.',
    );
    final zh = ephemeralChannelDisplay(channel, locale: 'zh-CN')!;
    expect(zh.detailLabel, '2 小时后清理');
    expect(zh.tooltipLabel, '临时频道，闲置 2 小时后清理。');
  });

  test('a deadline shows the remaining time and the scheduled moment', () {
    final now = DateTime.utc(2026, 10, 24, 10);
    final channel = _channel(
      ttlSeconds: 86400,
      ttlDeadline: now.add(const Duration(minutes: 90)),
    );
    final en = ephemeralChannelDisplay(channel, now: now, locale: 'en')!;
    expect(en.detailLabel, '2h left');
    expect(en.tooltipLabel, startsWith('Ephemeral channel. Cleans up in 2 hours. Scheduled for '));
    final minute = ephemeralChannelDisplay(
      _channel(ttlDeadline: now.add(const Duration(seconds: 30))),
      now: now,
      locale: 'en',
    )!;
    expect(minute.detailLabel, '1m left');
    expect(minute.tooltipLabel, contains('in 1 minute.'));
  });

  test('a passed deadline says cleanup is due', () {
    final now = DateTime.utc(2026, 10, 24, 10);
    final display = ephemeralChannelDisplay(
      _channel(ttlDeadline: now.subtract(const Duration(minutes: 1))),
      now: now,
      locale: 'zh-CN',
    )!;
    expect(
      display.detailLabel,
      platformText(PlatformMessageKey.channelEphemeralCleanupDue, locale: 'zh-CN'),
    );
    expect(
      display.tooltipLabel,
      platformText(PlatformMessageKey.channelEphemeralTooltipDue, locale: 'zh-CN'),
    );
  });

  test('compact and verbose formatters keep the original unit steps', () {
    expect(formatCompactRemaining(3 * 86400, locale: 'en'), '3d left');
    expect(formatVerboseRemaining(86400 + 1, locale: 'en'), 'in 2 days');
    expect(formatCompactTtl(30, locale: 'en'), '30s TTL');
    expect(formatVerboseTtl(1, locale: 'en'), '1 second');
    expect(formatVerboseTtl(7 * 86400, locale: 'zh-CN'), '7 天');
  });

  test('kind:39000 TTL tags reach Channel and ChannelDetails', () {
    const event = NostrEvent(
      id: 'meta',
      pubkey: 'relay',
      createdAt: 5,
      kind: 39000,
      tags: [
        ['d', 'c1'],
        ['name', 'scratch'],
        ['ttl', '600'],
        ['ttl_deadline', '2026-10-24T12:00:00Z'],
      ],
      content: '',
      sig: 'sig',
    );
    final data = ChannelData.fromEvent(event);
    expect(data.ttlSeconds, 600);
    final details = channelDetailsFromEvent(event);
    expect(details.ttlSeconds, 600);
    expect(details.ttlDeadline, DateTime.utc(2026, 10, 24, 12));
    final merged = _channel().mergeDetails(details);
    expect(merged.isEphemeral, isTrue);
    expect(ChannelDetails.fromChannel(merged).ttlSeconds, 600);
  });
}
