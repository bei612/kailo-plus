import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final now = DateTime.utc(2026, 9, 25, 14);
  String at(int secondsFromNow) =>
      now.add(Duration(seconds: secondsFromNow)).toIso8601String();

  test('relative time uses the shared thresholds and plural forms', () {
    expect(kailoRelativeTime(at(0), locale: 'en', now: now), 'now');
    expect(kailoRelativeTime(at(-1), locale: 'en', now: now), '1 second ago');
    expect(
      kailoRelativeTime(at(-59), locale: 'en', now: now),
      '59 seconds ago',
    );
    expect(kailoRelativeTime(at(-60), locale: 'en', now: now), '1 minute ago');
    expect(kailoRelativeTime(at(120), locale: 'en', now: now), 'in 2 minutes');
    expect(kailoRelativeTime(at(-3600), locale: 'en', now: now), '1 hour ago');
    expect(kailoRelativeTime(at(-86400), locale: 'en', now: now), 'yesterday');
    expect(kailoRelativeTime(at(86400), locale: 'en', now: now), 'tomorrow');
    expect(
      kailoRelativeTime(at(-2592000), locale: 'en', now: now),
      'last month',
    );
  });

  test('Chinese, future times and unavailable timestamps remain explicit', () {
    expect(kailoRelativeTime(at(-60), locale: 'zh-CN', now: now), '1 分钟前');
    expect(kailoRelativeTime(at(120), locale: 'zh-CN', now: now), '2 分钟后');
    expect(kailoRelativeTime(at(86400), locale: 'zh-CN', now: now), '明天');
    expect(kailoRelativeTime(at(-2592000), locale: 'zh-CN', now: now), '上个月');
    expect(kailoRelativeTime('invalid', locale: 'zh-CN', now: now), '时间不可用');
    expect(
      kailoRelativeTime('invalid', locale: 'en', now: now),
      'Time unavailable',
    );
    expect(kailoPluralOne(1, locale: 'en'), isTrue);
    expect(kailoPluralOne(2, locale: 'en'), isFalse);
    expect(kailoPluralOne(1, locale: 'zh-CN'), isFalse);
  });

  test('absolute time follows the catalog date pattern in local time', () {
    final local = DateTime(2026, 9, 25, 14, 5);
    final timestamp = local.toUtc().toIso8601String();
    expect(kailoAbsoluteTime(timestamp, locale: 'en'), '9/25/2026 14:05');
    expect(kailoAbsoluteTime(timestamp, locale: 'zh-CN'), '2026年9月25日 14:05');
    expect(kailoAbsoluteTime('invalid', locale: 'zh-CN'), '时间不可用');
  });
}
