import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:buzz/features/feedback/feedback_draft.dart';
import 'package:buzz/features/feedback/feedback_page.dart';
import 'package:buzz/shared/platform/platform_api.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

const receipt = PlatformResponse(200, {
  'feedbackId': '0eab04f4-21a8-4fb4-a75c-8b76d6354b25',
  'createdAt': '2026-10-26T00:00:00Z',
});

void main() {
  test('lost result retries the frozen request; private images stay local until send', () async {
    final sent = <Map<String, dynamic>>[];
    final draft = FeedbackDraft((body) async {
      sent.add(body);
      if (sent.length == 1) throw Exception('lost response');
      return receipt;
    });
    addTearDown(draft.dispose);
    draft.message = '  private feedback  ';
    draft.attach(Uint8List.fromList([137,80,78,71,13,10,26,10]));
    expect(sent, isEmpty);
    expect(await draft.submit(), isFalse);
    expect(draft.locked, isTrue);
    draft.message = 'later accidental edit';
    expect(await draft.submit(), isTrue);
    expect(sent, hasLength(2));
    expect(sent[0], sent[1]);
    expect(sent[0]['client'], 'MOBILE');
    expect(sent[0]['message'], 'private feedback');
    expect(sent[0].containsKey('diagnostics'), isFalse);
    expect((sent[0]['attachment'] as Map)['dataBase64'], 'iVBORw0KGgo=');
    expect(draft.message, isEmpty);
  });

  test('definitive refusal preserves editable draft; retired scope ignores late success', () async {
    final draft = FeedbackDraft((_) async => const PlatformResponse(429, {}));
    draft.message = 'keep this';
    expect(await draft.submit(), isFalse);
    expect(draft.message, 'keep this');
    expect(draft.locked, isFalse);
    draft.dispose();
    final response = Completer<PlatformResponse>();
    final retired = FeedbackDraft((_) => response.future)..message = 'old identity';
    final pending = retired.submit();
    retired.dispose();
    response.complete(receipt);
    expect(await pending, isFalse);
    expect(retired.message, isEmpty);
  });

  testWidgets('Mobile form shows exact diagnostics and requires consent before Core submission', (tester) async {
    tester.view.physicalSize = const Size(800, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    PackageInfo.setMockInitialValues(appName: 'Buzz', packageName: 'chat.kailo.mobile',
      version: '1.2.3', buildNumber: '4', buildSignature: '');
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final sent = <Map<String, dynamic>>[];
    final draft = FeedbackDraft((body) async { sent.add(body); return const PlatformResponse(503, {}); });
    addTearDown(draft.dispose);
    await tester.pumpWidget(ProviderScope(overrides: [
      savedPrefsProvider.overrideWithValue(prefs),
      feedbackDraftProvider.overrideWithValue(draft),
    ], child: MaterialApp(theme: AppTheme.light(), locale: const Locale('zh', 'CN'),
      supportedLocales: const [Locale('en'), Locale('zh', 'CN')],
      localizationsDelegates: const [GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      home: const FeedbackPage())));
    await tester.pumpAndSettle();
    final preview = tester.widget<SelectableText>(find.byKey(const ValueKey('feedback-diagnostics'))).data!;
    expect((jsonDecode(preview) as Map).keys.toSet(), {'appVersion','platform','userAgent','language','capturedAt'});
    expect(tester.widget<CheckboxListTile>(find.byType(CheckboxListTile)).value, isFalse);
    await tester.tap(find.byType(CheckboxListTile));
    await tester.enterText(find.byKey(const ValueKey('feedback-message')), '移动反馈');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('feedback-submit')));
    await tester.pumpAndSettle();
    expect(sent.single['diagnostics'], preview);
    expect(sent.single['message'], '移动反馈');
    expect(find.text('发送结果待确认。重试同一提交即可确认，草稿已保留。'), findsOneWidget);
    expect(tester.widget<TextField>(find.byKey(const ValueKey('feedback-message'))).enabled, isFalse);
  });
}
