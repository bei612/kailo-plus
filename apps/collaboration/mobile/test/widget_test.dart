import 'package:buzz/app.dart';
import 'package:buzz/features/platform/platform_sign_in_page.dart';
import 'package:buzz/shared/auth/auth.dart';
import 'package:buzz/shared/platform/platform_api.dart';
import 'package:buzz/shared/theme/theme_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'shared/platform/platform_test_support.dart';

void main() {
  testWidgets('an unconfigured device asks for the deployment first', (
    WidgetTester tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authProvider.overrideWith(() => _FakeAuthNotifier()),
          savedPrefsProvider.overrideWithValue(prefs),
          nativeSessionProvider.overrideWithValue(
            NativeSession(
              client: MockClient((_) async => fail('no network expected')),
              refreshStore: MemoryRefreshStore(),
            ),
          ),
        ],
        child: const App(),
      ),
    );
    await tester.pump();

    expect(find.byType(PlatformSignInPage), findsOneWidget);
    // 地址由部署方给出：表单不预填任何地址
    for (final key in [
      'platform-config-native-url',
      'platform-config-issuer',
      'platform-config-client-id',
    ]) {
      final field = tester.widget<TextField>(find.byKey(ValueKey(key)));
      expect(field.controller!.text, isEmpty);
    }
    expect(find.byKey(const ValueKey('platform-sign-in')), findsNothing);

    await tester.enterText(
      find.byKey(const ValueKey('platform-config-native-url')),
      'https://platform.test:8443',
    );
    await tester.enterText(
      find.byKey(const ValueKey('platform-config-issuer')),
      'https://idp.test/realms/platform',
    );
    await tester.enterText(
      find.byKey(const ValueKey('platform-config-client-id')),
      'platform-native',
    );
    await tester.tap(find.byKey(const ValueKey('platform-config-save')));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('platform-sign-in')), findsOneWidget);
    expect(find.text('Server: platform.test'), findsOneWidget);
  });
}

class _FakeAuthNotifier extends AuthNotifier {
  @override
  Future<AuthState> build() async {
    return const AuthState(status: AuthStatus.unauthenticated);
  }
}
