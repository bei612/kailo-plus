import 'package:test/test.dart';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:client_kit/shared/platform/reason_text.dart';

void main() {
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
      'Whether it took effect is not known yet.',
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
}
