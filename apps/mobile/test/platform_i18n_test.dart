import 'package:test/test.dart';

import '../lib/shared/contracts/contracts.dart';
import '../lib/shared/kailo/kailo_platform_text.dart';
import '../lib/shared/kailo/kailo_reason_text.dart';

void main() {
  test('every contract reason has both supported locale renderings', () {
    for (final reason in ReasonCode.values) {
      expect(kailoReasonText(reason, locale: 'en'), isNotEmpty);
      expect(kailoReasonText(reason, locale: 'zh-CN'), isNotEmpty);
      expect(kailoReasonCode(reason), isNotEmpty);
    }
  });

  test('Mobile resolves zh variants like the shared TypeScript surface', () {
    expect(
      kailoReasonText(ReasonCode.DISPATCH_RESULT_UNKNOWN, locale: 'zh-Hant'),
      '是否已生效尚不明确。',
    );
    expect(
      kailoReasonText(ReasonCode.DISPATCH_RESULT_UNKNOWN, locale: 'fr-FR'),
      'Whether it took effect is not known yet.',
    );
  });

  test('every platform key has en and zh-CN renderings', () {
    for (final key in KailoMessageKey.values) {
      expect(kailoText(key, locale: 'en'), isNotEmpty);
      expect(kailoText(key, locale: 'zh-CN'), isNotEmpty);
    }
    expect(
      kailoText(KailoMessageKey.approvalsRequirement,
          locale: 'zh-Hant',
          variables: {'selector': '组织管理员', 'count': 2}),
      '组织管理员：至少 2 人',
    );
  });

  test('contract enum labels use the same catalog as Web and Desktop', () {
    for (final status in ApprovalStatus.values) {
      expect(kailoApprovalStatusText(status, locale: 'zh-CN'), isNotEmpty);
    }
    for (final status in TenantInvitationStatus.values) {
      expect(kailoTenantInvitationStatusText(status, locale: 'en'), isNotEmpty);
    }
    for (final state in TenantMembershipState.values) {
      expect(kailoTenantMembershipStateText(state, locale: 'zh-CN'), isNotEmpty);
    }
    for (final decision in ApprovalDecision.values) {
      expect(kailoApprovalDecisionText(decision, locale: 'en'), isNotEmpty);
    }
    for (final selector in ApprovalSelector.values) {
      expect(kailoApprovalSelectorText(selector, locale: 'zh-CN'), isNotEmpty);
    }
  });
}
