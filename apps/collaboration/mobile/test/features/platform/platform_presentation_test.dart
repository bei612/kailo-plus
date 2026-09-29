import 'package:buzz/features/kailo/kailo_async_view.dart';
import 'package:buzz/features/kailo/kailo_status_text.dart';
import 'package:buzz/shared/kailo/kailo_api.dart';
import 'package:buzz/shared/kailo/kailo_link.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('connection states use the shared locale catalog', () {
    expect(
      kailoPhaseText(KailoLinkPhase.signingIn, locale: 'zh-CN'),
      '正在等待浏览器中的登录完成…',
    );
    expect(
      kailoPhaseText(KailoLinkPhase.outcomeUnknown, locale: 'zh-CN'),
      '结果尚不明确。',
    );
  });

  test('diagnostic text never leaks into connection or request UI', () {
    const privateDetail = 'private IdP response and token';
    final failed = kailoOutcomeText(
      const KailoLinkState(KailoLinkPhase.failed, detail: privateDetail),
      locale: 'zh-CN',
    );
    final unknown = kailoOutcomeText(
      const KailoLinkState(
        KailoLinkPhase.outcomeUnknown,
        detail: privateDetail,
      ),
      locale: 'zh-CN',
    );
    final unavailable = kailoErrorText(
      const KailoUnavailable(privateDetail),
      locale: 'zh-CN',
    );
    final unexpected = kailoErrorText(privateDetail, locale: 'zh-CN');

    for (final text in [failed!, unknown!, unavailable, unexpected]) {
      expect(text, isNot(contains(privateDetail)));
    }
    expect(unknown, '结果尚不明确。');
    expect(unavailable, contains('结果尚不明确'));
  });

  test('response without a contract error remains outcome unknown', () {
    final text = kailoErrorText(
      const KailoApiError(KailoResponse(502, null)),
      locale: 'zh-CN',
    );
    expect(text, contains('HTTP 502'));
    expect(text, contains('结果尚不明确'));
  });
}
