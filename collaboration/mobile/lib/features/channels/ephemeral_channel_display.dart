// Buzz 779af8886caae1317b4de962082429867ab61503
// `mobile/lib/features/channels/ephemeral_channel_display.dart`, restored.
// The TTL facts are the relay's own kind:39000 `ttl` / `ttl_deadline` tags
// (the original reaper and `workspace.update` TTL, DD-119); this file only
// renders them. Copy comes from the shared platform catalog (zh-CN and en).
import 'dart:math' as math;

import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:intl/intl.dart';

import 'channel.dart';

class EphemeralChannelDisplay {
  final String? detailLabel;
  final String tooltipLabel;

  const EphemeralChannelDisplay({
    required this.detailLabel,
    required this.tooltipLabel,
  });
}

bool isEphemeralChannel(Channel channel) =>
    channel.ttlSeconds != null || channel.ttlDeadline != null;

String _t(
  PlatformMessageKey key,
  String? locale, [
  Map<String, Object>? variables,
]) => platformText(key, locale: locale, variables: variables);

EphemeralChannelDisplay? ephemeralChannelDisplay(
  Channel channel, {
  DateTime? now,
  String? locale,
}) {
  if (!isEphemeralChannel(channel)) return null;

  final deadline = channel.ttlDeadline;
  final remainingSeconds = deadline == null
      ? null
      : ((deadline.millisecondsSinceEpoch -
                    (now ?? DateTime.now()).millisecondsSinceEpoch) /
                1000)
            .ceil();

  if (remainingSeconds == null) {
    final ttlSeconds = channel.ttlSeconds;
    return EphemeralChannelDisplay(
      detailLabel: ttlSeconds == null
          ? null
          : formatCompactTtl(ttlSeconds, locale: locale),
      tooltipLabel: ttlSeconds == null
          ? _t(PlatformMessageKey.channelEphemeralTooltipInactivity, locale)
          : _t(PlatformMessageKey.channelEphemeralTooltipAfter, locale, {
              'duration': formatVerboseTtl(ttlSeconds, locale: locale),
            }),
    );
  }

  if (remainingSeconds <= 0) {
    return EphemeralChannelDisplay(
      detailLabel: formatCompactRemaining(remainingSeconds, locale: locale),
      tooltipLabel: _t(PlatformMessageKey.channelEphemeralTooltipDue, locale),
    );
  }

  return EphemeralChannelDisplay(
    detailLabel: formatCompactRemaining(remainingSeconds, locale: locale),
    tooltipLabel: _t(PlatformMessageKey.channelEphemeralTooltipScheduled, locale, {
      'remaining': formatVerboseRemaining(remainingSeconds, locale: locale),
      'deadline': formatAbsoluteDeadline(deadline!, locale: locale),
    }),
  );
}

int _ceilUnits(int seconds, int unit) => math.max(1, (seconds / unit).ceil());

String formatCompactRemaining(int remainingSeconds, {String? locale}) {
  if (remainingSeconds <= 0) {
    return _t(PlatformMessageKey.channelEphemeralCleanupDue, locale);
  }
  if (remainingSeconds <= 60) {
    return _t(PlatformMessageKey.channelEphemeralLeftMinutes, locale, {
      'count': 1,
    });
  }
  if (remainingSeconds < 60 * 60) {
    return _t(PlatformMessageKey.channelEphemeralLeftMinutes, locale, {
      'count': _ceilUnits(remainingSeconds, 60),
    });
  }
  if (remainingSeconds < 60 * 60 * 24) {
    return _t(PlatformMessageKey.channelEphemeralLeftHours, locale, {
      'count': _ceilUnits(remainingSeconds, 60 * 60),
    });
  }
  return _t(PlatformMessageKey.channelEphemeralLeftDays, locale, {
    'count': _ceilUnits(remainingSeconds, 60 * 60 * 24),
  });
}

String formatVerboseRemaining(int remainingSeconds, {String? locale}) {
  if (remainingSeconds <= 0) {
    return _t(PlatformMessageKey.channelEphemeralNow, locale);
  }
  final (int count, PlatformMessageKey one, PlatformMessageKey other) =
      remainingSeconds <= 60
      ? (
          1,
          PlatformMessageKey.channelEphemeralInMinutesOne,
          PlatformMessageKey.channelEphemeralInMinutesOther,
        )
      : remainingSeconds < 60 * 60
      ? (
          _ceilUnits(remainingSeconds, 60),
          PlatformMessageKey.channelEphemeralInMinutesOne,
          PlatformMessageKey.channelEphemeralInMinutesOther,
        )
      : remainingSeconds < 60 * 60 * 24
      ? (
          _ceilUnits(remainingSeconds, 60 * 60),
          PlatformMessageKey.channelEphemeralInHoursOne,
          PlatformMessageKey.channelEphemeralInHoursOther,
        )
      : (
          _ceilUnits(remainingSeconds, 60 * 60 * 24),
          PlatformMessageKey.channelEphemeralInDaysOne,
          PlatformMessageKey.channelEphemeralInDaysOther,
        );
  return _t(count == 1 ? one : other, locale, {'count': count});
}

String formatCompactTtl(int ttlSeconds, {String? locale}) {
  if (ttlSeconds < 60) {
    return _t(PlatformMessageKey.channelEphemeralTtlSeconds, locale, {
      'count': math.max(1, ttlSeconds),
    });
  }
  if (ttlSeconds < 60 * 60) {
    return _t(PlatformMessageKey.channelEphemeralTtlMinutes, locale, {
      'count': _ceilUnits(ttlSeconds, 60),
    });
  }
  if (ttlSeconds < 60 * 60 * 24) {
    return _t(PlatformMessageKey.channelEphemeralTtlHours, locale, {
      'count': _ceilUnits(ttlSeconds, 60 * 60),
    });
  }
  return _t(PlatformMessageKey.channelEphemeralTtlDays, locale, {
    'count': _ceilUnits(ttlSeconds, 60 * 60 * 24),
  });
}

String formatVerboseTtl(int ttlSeconds, {String? locale}) {
  final (int count, PlatformMessageKey one, PlatformMessageKey other) =
      ttlSeconds < 60
      ? (
          math.max(1, ttlSeconds),
          PlatformMessageKey.channelEphemeralSecondsOne,
          PlatformMessageKey.channelEphemeralSecondsOther,
        )
      : ttlSeconds < 60 * 60
      ? (
          _ceilUnits(ttlSeconds, 60),
          PlatformMessageKey.channelEphemeralMinutesOne,
          PlatformMessageKey.channelEphemeralMinutesOther,
        )
      : ttlSeconds < 60 * 60 * 24
      ? (
          _ceilUnits(ttlSeconds, 60 * 60),
          PlatformMessageKey.channelEphemeralHoursOne,
          PlatformMessageKey.channelEphemeralHoursOther,
        )
      : (
          _ceilUnits(ttlSeconds, 60 * 60 * 24),
          PlatformMessageKey.channelEphemeralDaysOne,
          PlatformMessageKey.channelEphemeralDaysOther,
        );
  return _t(count == 1 ? one : other, locale, {'count': count});
}

/// The original `MMM d, h:mm a` deadline, in the view locale's own form.
String formatAbsoluteDeadline(DateTime deadline, {String? locale}) =>
    DateFormat.MMMd(
      platformIntlLocale(locale: locale),
    ).add_jm().format(deadline.toLocal());
