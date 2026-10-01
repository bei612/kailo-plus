import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('device preference round-trips through storage', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final storage = CommunityThemeStorage(prefs);
    const preference = CommunityThemePreference(
      theme: 'github-dark',
      accent: '#c0a2f1',
      followSystem: false,
    );

    await storage.write(preference);

    expect(CommunityThemeStorage(prefs).read(), preference);
    expect(CommunityThemeStorage(prefs).read().mode, ThemeMode.dark);
  });

  test('an unknown stored scheme falls back to Buzz', () async {
    SharedPreferences.setMockInitialValues({
      'buzz_theme_mode': 'system',
      'buzz_color_scheme': 'unknown',
    });
    final prefs = await SharedPreferences.getInstance();
    expect(CommunityThemeStorage(prefs).read().theme, contains('buzz'));
  });

  test('an empty device follows the system with the Buzz theme', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final preference = CommunityThemeStorage(prefs).read();
    expect(preference.followSystem, isTrue);
    expect(preference.mode, ThemeMode.system);
  });
}
