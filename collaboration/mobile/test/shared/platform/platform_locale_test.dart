import 'package:buzz/shared/platform/platform_locale.dart';
import 'package:buzz/shared/theme/theme_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'invalid stored presentation preferences retain the Chinese default',
    () async {
      for (final value in [false, 'fr-FR', 'en-US']) {
        SharedPreferences.setMockInitialValues({
          platformLocalePreferenceKey: value,
        });
        final prefs = await SharedPreferences.getInstance();
        final scope = ProviderContainer(
          overrides: [savedPrefsProvider.overrideWithValue(prefs)],
        );
        expect(scope.read(platformLocaleProvider), const Locale('zh', 'CN'));
        scope.dispose();
      }
    },
  );

  test(
    'Chinese default and English preference persist without changing identity',
    () async {
      SharedPreferences.setMockInitialValues({'unrelated-account': 'retained'});
      final prefs = await SharedPreferences.getInstance();
      final scope = ProviderContainer(
        overrides: [savedPrefsProvider.overrideWithValue(prefs)],
      );
      addTearDown(scope.dispose);
      expect(scope.read(platformLocaleProvider), const Locale('zh', 'CN'));
      expect(
        await scope
            .read(platformLocaleProvider.notifier)
            .select(const Locale('en')),
        isTrue,
      );
      expect(scope.read(platformLocaleProvider), const Locale('en'));
      expect(prefs.getString(platformLocalePreferenceKey), 'en');
      expect(prefs.getString('unrelated-account'), 'retained');
      final restarted = ProviderContainer(
        overrides: [savedPrefsProvider.overrideWithValue(prefs)],
      );
      addTearDown(restarted.dispose);
      expect(restarted.read(platformLocaleProvider), const Locale('en'));
      expect(
        await restarted
            .read(platformLocaleProvider.notifier)
            .select(const Locale('zh', 'CN')),
        isTrue,
      );
      expect(restarted.read(platformLocaleProvider), const Locale('zh', 'CN'));
    },
  );
}
