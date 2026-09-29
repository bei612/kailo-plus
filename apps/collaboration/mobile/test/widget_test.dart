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
  testWidgets('an unconfigured device asks for the Kailo deployment first', (
    WidgetTester tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authProvider.overrideWith(() => _FakeAuthNotifier()),
          savedPrefsProvider.overrideWithValue(prefs),
          kailoSessionProvider.overrideWithValue(
            KailoSession(
              client: MockClient((_) async => fail('no network expected')),
              refreshStore: MemoryRefreshStore(),
            ),
          ),
        ],
        child: const App(),
      ),
    );
    await tester.pump();

    expect(find.byType(KailoSignInPage), findsOneWidget);
    // 地址由部署方给出：表单不预填任何地址
    for (final key in [
      'kailo-config-native-url',
      'kailo-config-issuer',
      'kailo-config-client-id',
    ]) {
      final field = tester.widget<TextField>(find.byKey(ValueKey(key)));
      expect(field.controller!.text, isEmpty);
    }
    expect(find.byKey(const ValueKey('kailo-sign-in')), findsNothing);

    await tester.enterText(
      find.byKey(const ValueKey('kailo-config-native-url')),
      'https://kailo.test:8443',
    );
    await tester.enterText(
      find.byKey(const ValueKey('kailo-config-issuer')),
      'https://idp.test/realms/kailo',
    );
    await tester.enterText(
      find.byKey(const ValueKey('kailo-config-client-id')),
      'kailo-native',
    );
    await tester.tap(find.byKey(const ValueKey('kailo-config-save')));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('kailo-sign-in')), findsOneWidget);
    expect(find.text('Server: kailo.test'), findsOneWidget);
  });
}

class _FakeAuthNotifier extends AuthNotifier {
  @override
  Future<AuthState> build() async {
    return const AuthState(status: AuthStatus.unauthenticated);
  }
}
