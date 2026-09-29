import 'package:buzz/features/kailo/kailo_audit_page.dart';
import 'package:buzz/features/kailo/kailo_devices_page.dart';
import 'package:buzz/features/kailo/kailo_members_page.dart';
import 'package:buzz/features/settings/settings_page.dart';
import 'package:buzz/shared/kailo/kailo_views.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    PackageInfo.setMockInitialValues(
      appName: 'Buzz',
      packageName: 'xyz.block.buzz',
      version: '0.16.0',
      buildNumber: '432',
      buildSignature: '',
    );
  });

  Future<void> pumpSettings(
    WidgetTester tester, {
    Locale locale = const Locale('en'),
  }) async {
    // 整页一屏放下，懒加载列表里的每一行都会建出来
    tester.view.physicalSize = const Size(800, 2000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          savedPrefsProvider.overrideWithValue(prefs),
          myPubkeyProvider.overrideWithValue('ab' * 32),
          kailoWorkspacesProvider.overrideWith((ref) async => const []),
          kailoOwnAuditProvider.overrideWith((ref) async => const []),
          kailoDevicesProvider.overrideWith((ref) async => const []),
        ],
        child: MaterialApp(
          locale: locale,
          supportedLocales: const [Locale('en'), Locale('zh', 'CN')],
          localizationsDelegates: const [
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          theme: AppTheme.light(),
          home: const SettingsPage(profileHeader: SizedBox.shrink()),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('offers the Kailo management views and nothing undelivered', (
    tester,
  ) async {
    await pumpSettings(tester);

    expect(find.text('Members'), findsOneWidget);
    expect(find.text('My activity log'), findsOneWidget);
    expect(find.text('My devices'), findsOneWidget);
    expect(find.text('Theme'), findsOneWidget);
    expect(find.text('Device key'), findsOneWidget);
    expect(find.text('Sign out'), findsOneWidget);
    expect(find.text('v0.16.0 (432)'), findsOneWidget);
    // 上游在这里有的入口，一期不交付：一律不生成
    for (final gone in [
      'Invite to community',
      'Push notifications',
      'Send identity to desktop',
      'Remove community',
      'Edit',
    ]) {
      expect(find.text(gone), findsNothing, reason: gone);
    }
  });

  testWidgets('each management row opens its view', (tester) async {
    await pumpSettings(tester);

    for (final (label, page) in <(String, Type)>[
      ('Members', KailoWorkspacesPage),
      ('My activity log', KailoAuditPage),
      ('My devices', KailoDevicesPage),
    ]) {
      await tester.tap(find.text(label));
      await tester.pumpAndSettle();
      expect(find.byType(page), findsOneWidget, reason: label);
      Navigator.of(tester.element(find.byType(page))).pop();
      await tester.pumpAndSettle();
    }
  });

  testWidgets(
    'renders settings and device copy from the shared zh-CN catalog',
    (tester) async {
      await pumpSettings(tester, locale: const Locale('zh', 'CN'));

      for (final label in ['组织', '外观', '主题', '本机', '服务器连接', '设备密钥', '退出']) {
        expect(find.text(label), findsWidgets, reason: label);
      }
      expect(find.text('Appearance'), findsNothing);
      expect(find.text('Device key'), findsNothing);
      await tester.tap(find.text('退出'));
      await tester.pumpAndSettle();
      expect(find.textContaining('设备仍保持登记'), findsOneWidget);
    },
  );
}
