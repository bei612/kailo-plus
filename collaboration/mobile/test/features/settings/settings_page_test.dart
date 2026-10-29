import 'package:buzz/features/platform/platform_audit_page.dart';
import 'package:buzz/features/platform/platform_devices_page.dart';
import 'package:buzz/features/platform/platform_members_page.dart';
import 'package:buzz/features/invites/invite_create_provider.dart';
import 'package:buzz/features/settings/settings_page.dart';
import 'package:buzz/shared/platform/platform_views.dart';
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
          platformWorkspacesProvider.overrideWith((ref) async => const []),
          platformOwnAuditProvider.overrideWith((ref) async => const []),
          platformDevicesProvider.overrideWith((ref) async => const []),
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

  testWidgets('offers the platform management views and nothing undelivered', (
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

  for (final (access, shown) in const [
    (InviteAccess.allowed, true),
    (InviteAccess.unknown, true),
    (InviteAccess.denied, false),
  ]) {
    testWidgets('the Community section offers Invite on the BFF answer ($access)', (
      tester,
    ) async {
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
            platformWorkspacesProvider.overrideWith((ref) async => const []),
            platformOwnAuditProvider.overrideWith((ref) async => const []),
            platformDevicesProvider.overrideWith((ref) async => const []),
            inviteAccessProvider.overrideWith((ref) async => access),
          ],
          child: MaterialApp(
            theme: AppTheme.light(),
            home: SettingsPage(
              profileHeader: const SizedBox.shrink(),
              invitePageBuilder: (_) => const Text('invite page'),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Community'), findsOneWidget);
      expect(find.text('Theme'), findsOneWidget);
      final invite = find.text('Invite to community');
      expect(invite, shown ? findsOneWidget : findsNothing);
      if (!shown) return;
      await tester.tap(invite);
      await tester.pumpAndSettle();
      expect(find.text('invite page'), findsOneWidget);
    });
  }

  testWidgets('each management row opens its view', (tester) async {
    await pumpSettings(tester);

    for (final (label, page) in <(String, Type)>[
      ('Members', PlatformWorkspacesPage),
      ('My activity log', PlatformAuditPage),
      ('My devices', PlatformDevicesPage),
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

      for (final label in ['组织', '社区', '主题', '本机', '服务器连接', '设备密钥', '退出']) {
        expect(find.text(label), findsWidgets, reason: label);
      }
      expect(find.text('Community'), findsNothing);
      expect(find.text('Device key'), findsNothing);
      await tester.tap(find.text('退出'));
      await tester.pumpAndSettle();
      expect(find.textContaining('设备仍保持登记'), findsOneWidget);
    },
  );

  for (final (locale, photo) in const [
    (Locale('en'), 'Photo'),
    (Locale('zh', 'CN'), '照片'),
  ]) {
    testWidgets('Edit profile offers the original Photo row ($locale)', (
      tester,
    ) async {
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
            platformWorkspacesProvider.overrideWith((ref) async => const []),
            platformOwnAuditProvider.overrideWith((ref) async => const []),
            platformDevicesProvider.overrideWith((ref) async => const []),
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
            home: SettingsPage(
              profileHeader: const SizedBox.shrink(),
              profileEditPageBuilder: (_) =>
                  const Scaffold(body: Text('Profile editor destination')),
              onEditDisplayName: (_) async {},
              onEditProfileDescription: (_) async {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(
        find.byKey(const ValueKey('settings-edit-profile')).first,
      );
      await tester.pumpAndSettle();
      expect(find.text(photo), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('edit-profile-photo')));
      await tester.pumpAndSettle();
      expect(find.text('Profile editor destination'), findsOneWidget);
    });
  }
}
