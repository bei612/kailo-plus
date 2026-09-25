import 'package:test/test.dart';

import '../lib/shared/contracts/contracts.dart';
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
}
