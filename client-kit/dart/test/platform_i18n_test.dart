import 'dart:convert';
import 'dart:io';

import 'package:test/test.dart';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:client_kit/shared/platform/reason_text.dart';

void main() {
  test('default and unknown locales are Chinese, explicit English remains English', () {
    for (final locale in [null, '', 'fr-FR', 'zh-Hant']) {
      expect(platformLocale(locale: locale), 'zh-CN');
      expect(platformText(PlatformMessageKey.platformSettingsLanguage, locale: locale), '语言');
      expect(platformReasonText(ReasonCode.values.first, locale: locale),
          platformReasonText(ReasonCode.values.first, locale: 'zh-CN'));
    }
    expect(platformLocale(locale: 'en-US'), 'en');
    expect(platformText(PlatformMessageKey.platformSettingsLanguage, locale: 'en-GB'), 'Language');
  });

  test('every contract reason has both supported locale renderings', () {
    for (final reason in ReasonCode.values) {
      expect(platformReasonText(reason, locale: 'en'), isNotEmpty);
      expect(platformReasonText(reason, locale: 'zh-CN'), isNotEmpty);
      expect(platformReasonCode(reason), isNotEmpty);
    }
  });

  test('Mobile resolves zh variants like the shared TypeScript surface', () {
    expect(
      platformReasonText(ReasonCode.DISPATCH_RESULT_UNKNOWN, locale: 'zh-Hant'),
      '是否已生效尚不明确。',
    );
    expect(
      platformReasonText(ReasonCode.DISPATCH_RESULT_UNKNOWN, locale: 'fr-FR'),
      '是否已生效尚不明确。',
    );
  });

  test('every platform key has en and zh-CN renderings', () {
    // 参数型文案也要用有效参数检查，否则纯参数模板会被误判为空翻译。
    const sampleVariables = <String, Object>{'date': 'sample'};
    for (final key in PlatformMessageKey.values) {
      expect(
        platformText(key, locale: 'en', variables: sampleVariables),
        isNotEmpty,
      );
      expect(
        platformText(key, locale: 'zh-CN', variables: sampleVariables),
        isNotEmpty,
      );
    }
    expect(
      platformText(
        PlatformMessageKey.approvalsRequirement,
        locale: 'zh-Hant',
        variables: {'selector': '组织管理员', 'count': 2},
      ),
      '组织管理员：至少 2 人',
    );
  });

  test('contract enum labels use the same catalog as Web and Desktop', () {
    for (final status in ApprovalStatus.values) {
      expect(platformApprovalStatusText(status, locale: 'zh-CN'), isNotEmpty);
    }
    for (final status in TenantInvitationStatus.values) {
      expect(
        platformTenantInvitationStatusText(status, locale: 'en'),
        isNotEmpty,
      );
    }
    for (final state in TenantMembershipState.values) {
      expect(
        platformTenantMembershipStateText(state, locale: 'zh-CN'),
        isNotEmpty,
      );
    }
    for (final decision in ApprovalDecision.values) {
      expect(platformApprovalDecisionText(decision, locale: 'en'), isNotEmpty);
    }
    for (final selector in ApprovalSelector.values) {
      expect(
        platformApprovalSelectorText(selector, locale: 'zh-CN'),
        isNotEmpty,
      );
    }
  });

  // 三端同源：Mobile 调用这里的生成物，Web 与 Desktop 调用 client-kit/ts；两套测试读同一份
  // 手写期望（client-kit/test-vectors/presentation.json），任一侧偏离即失败。
  group('presentation semantics shared with Web and Desktop', () {
    final vectors =
        jsonDecode(File('../test-vectors/presentation.json').readAsStringSync())
            as Map<String, dynamic>;
    const locales = ['en', 'zh-CN'];

    test('relative time matches the shared vectors in both locales', () {
      final relative = vectors['relativeTime'] as Map<String, dynamic>;
      final now = DateTime.parse(relative['now'] as String);
      for (final c
          in (relative['cases'] as List).cast<Map<String, dynamic>>()) {
        final at = now
            .add(Duration(seconds: c['offsetSeconds'] as int))
            .toIso8601String();
        for (final locale in locales) {
          expect(
            platformRelativeTime(at, locale: locale, now: now),
            c[locale],
            reason: '$locale ${c['offsetSeconds']}',
          );
        }
      }
      final invalid = relative['invalid'] as Map<String, dynamic>;
      for (final locale in locales) {
        expect(
          platformRelativeTime(
            invalid['input'] as String,
            locale: locale,
            now: now,
          ),
          invalid[locale],
        );
      }
    });

    test('plural category, locale resolution and the calendar band match', () {
      for (final c
          in (vectors['pluralOne'] as List).cast<Map<String, dynamic>>()) {
        expect(
          platformPluralOne(c['count'] as int, locale: c['locale'] as String),
          c['one'],
          reason: '${c['locale']} ${c['count']}',
        );
      }
      for (final c
          in (vectors['localeResolution'] as List)
              .cast<Map<String, dynamic>>()) {
        expect(platformLocale(locale: c['input'] as String), c['locale']);
      }
      expect(
        platformCalendarWeekdayBandDays,
        vectors['calendarWeekdayBandDays'],
      );
      expect({
        'minute': platformTimeSecondsMinute,
        'hour': platformTimeSecondsHour,
        'day': platformTimeSecondsDay,
        'month': platformTimeSecondsMonth,
      }, vectors['timeSeconds']);
    });

    test(
      'theme modes are exactly the shared set, each with its catalog label',
      () {
        final modes = (vectors['themeModes'] as List)
            .cast<Map<String, dynamic>>();
        expect(
          PlatformThemeMode.values.map((m) => m.name).toList(),
          modes.map((m) => m['mode']).toList(),
        );
        for (final m in modes) {
          final mode = PlatformThemeMode.values.byName(m['mode'] as String);
          for (final locale in locales) {
            expect(
              platformText(platformThemeModeKey(mode), locale: locale),
              m[locale],
            );
          }
        }
      },
    );
  });
}
