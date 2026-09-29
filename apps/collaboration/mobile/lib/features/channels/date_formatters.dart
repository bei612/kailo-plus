import 'package:flutter/foundation.dart';
import 'package:intl/intl.dart';

import 'package:client_kit/shared/platform/platform_text.dart';

// Re-export shortPubkey so existing callers continue to compile.
export '../../shared/utils/string_utils.dart' show shortPubkey;

final _weekdayFormat = DateFormat('EEEE', platformIntlLocale());
final _monthDayFormat = DateFormat.MMMMd(platformIntlLocale());
final _monthDayYearFormat = DateFormat.yMMMMd(platformIntlLocale());
final _shortMonthDayFormat = DateFormat.MMMd(platformIntlLocale());
final _messageTimeFormat = DateFormat.jm(platformIntlLocale());

/// Label for a day divider: "Today", "Yesterday", "Monday",
/// "Tuesday, March 31", or "March 31, 2025".
///
/// ```
/// Today            → "Today"
/// Yesterday        → "Yesterday"
/// 2–6 days ago     → "Monday"
/// older, this year → "Tuesday, March 31"
/// earlier years    → "March 31, 2025"
/// ```
///
/// The weekday rides along within the current year — it still orients ("was
/// that a weekend?") well past the six-day band. Beyond a year it stops
/// earning its width, and the year takes its place.
///
/// Mirrors `formatDayGroupLabel` in `desktop/src/shared/lib/datetime.ts`,
/// including its two departures from the Block writing standard: the day is
/// kept in the oldest band rather than collapsing to month-and-year, because a
/// divider has to *identify* its day — collapsing would give every day in a
/// month the same header. And there is no ordinal suffix ("March 31", never
/// "March 31st"), which the standard does ask for.
///
/// [now] is exposed for testing; production callers should omit it.
String formatDayHeading(int unixSeconds, {@visibleForTesting DateTime? now}) {
  final date = DateTime.fromMillisecondsSinceEpoch(
    unixSeconds * 1000,
    isUtc: true,
  ).toLocal();
  now ??= DateTime.now();
  final dayDiff = _calendarDaysBetween(now, date);

  if (dayDiff == 0) return platformText(PlatformMessageKey.chatTimeToday);
  if (dayDiff == 1) return platformText(PlatformMessageKey.chatTimeYesterday);
  // Bounded below as well as above: a timestamp in the future (clock skew, or a
  // relay ahead of this device) must not be labelled with a weekday that reads
  // as the recent past.
  if (dayDiff > 1 && dayDiff < platformCalendarWeekdayBandDays) {
    return _weekdayFormat.format(date);
  }

  return date.year == now.year
      ? platformText(
          PlatformMessageKey.chatTimeWeekdayDate,
          variables: {
            'weekday': _weekdayFormat.format(date),
            'date': _monthDayFormat.format(date),
          },
        )
      : _monthDayYearFormat.format(date);
}

/// Whole calendar days from [date] to [now], in local time. Rounded rather than
/// truncated so a DST transition — a 23- or 25-hour day — still counts as one.
int _calendarDaysBetween(DateTime now, DateTime date) {
  final startOfNow = DateTime(now.year, now.month, now.day);
  final startOfDate = DateTime(date.year, date.month, date.day);
  return (startOfNow.difference(startOfDate).inHours / 24).round();
}

/// Whether two unix-second timestamps fall on the same calendar day (local time).
bool isSameDay(int a, int b) {
  final dtA = DateTime.fromMillisecondsSinceEpoch(
    a * 1000,
    isUtc: true,
  ).toLocal();
  final dtB = DateTime.fromMillisecondsSinceEpoch(
    b * 1000,
    isUtc: true,
  ).toLocal();
  return dtA.year == dtB.year && dtA.month == dtB.month && dtA.day == dtB.day;
}

/// Returns a compact relative time string like "just now", "5m ago", "3h ago",
/// "2d ago", or a short date for older timestamps.
String relativeTime(int unixSeconds) {
  return platformRelativeTime(
    DateTime.fromMillisecondsSinceEpoch(
      unixSeconds * 1000,
      isUtc: true,
    ).toIso8601String(),
  );
}

/// Returns desktop-parity thread activity copy such as "just now",
/// "3 hours ago", or "on May 19".
String formatThreadSummaryLastReplyTime(
  int unixSeconds, {
  @visibleForTesting int? nowSeconds,
}) {
  nowSeconds ??= DateTime.now().millisecondsSinceEpoch ~/ 1000;
  var diff = nowSeconds - unixSeconds;
  if (diff < 0) diff = 0;

  if (diff < 60) return platformText(PlatformMessageKey.chatTimeJustNow);
  if (diff < platformCalendarWeekdayBandDays * platformTimeSecondsDay) {
    return platformRelativeTime(
      DateTime.fromMillisecondsSinceEpoch(
        unixSeconds * 1000,
        isUtc: true,
      ).toIso8601String(),
      now: DateTime.fromMillisecondsSinceEpoch(nowSeconds * 1000),
    );
  }

  final date = DateTime.fromMillisecondsSinceEpoch(
    unixSeconds * 1000,
    isUtc: true,
  ).toLocal();
  // No ordinal suffix, per the writing standard.
  return platformText(
    PlatformMessageKey.chatTimeOn,
    variables: {'date': _shortMonthDayFormat.format(date)},
  );
}

/// Desktop-parity message clock time, e.g. "2:34 PM".
///
/// Deliberately clock-only at every band, unlike desktop's message header,
/// which reads "Yesterday at 2:34 PM". Mobile timestamps sit inside a chat
/// bubble on a narrow screen with the day divider a short scroll away, so this
/// is the compact side of that split — not an oversight. Change it only
/// alongside a layout that has room for a date.
String formatMessageTime(int unixSeconds) {
  final date = DateTime.fromMillisecondsSinceEpoch(
    unixSeconds * 1000,
    isUtc: true,
  ).toLocal();
  return _messageTimeFormat.format(date);
}
