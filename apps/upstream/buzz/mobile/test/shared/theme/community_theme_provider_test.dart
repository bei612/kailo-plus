import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

Future<ProviderContainer> _container() async {
  final prefs = await SharedPreferences.getInstance();
  final container = ProviderContainer(
    overrides: [savedPrefsProvider.overrideWithValue(prefs)],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('a complete selection is applied and kept on this device', () async {
    final container = await _container();
    const selection = CommunityThemePreference(
      theme: 'dracula',
      accent: '#22c55e',
      followSystem: false,
    );

    container.read(communityThemeProvider.notifier).setPreference(selection);
    await Future<void>.delayed(Duration.zero);

    expect(container.read(communityThemeProvider), selection);
    final restarted = await _container();
    expect(restarted.read(communityThemeProvider), selection);
  });

  test('mode changes pick the matching theme of the pair', () async {
    final container = await _container();
    container.read(communityThemeProvider.notifier).setMode(ThemeMode.dark);
    expect(container.read(communityThemeProvider).mode, ThemeMode.dark);
    container.read(communityThemeProvider.notifier).setMode(ThemeMode.system);
    expect(container.read(communityThemeProvider).followSystem, isTrue);
  });
}
