import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'community_theme_preference.dart';
import 'theme_provider.dart';

class CommunityThemeNotifier extends Notifier<CommunityThemePreference> {
  late CommunityThemeStorage _storage;

  @override
  CommunityThemePreference build() {
    _storage = ref.watch(communityThemeStorageProvider);
    return _storage.read();
  }

  void setMode(ThemeMode mode) {
    var theme = state.theme;
    if (mode == ThemeMode.system) {
      theme = schemeForAppearanceMode(theme, mode) ?? theme;
    } else {
      final effective = effectiveTheme(theme, mode);
      if (effective != null) theme = effective.name;
    }
    _save(
      CommunityThemePreference(
        theme: theme,
        accent: state.accent,
        followSystem: mode == ThemeMode.system,
      ),
    );
  }

  /// Persists a complete theme-picker selection as one durable snapshot.
  void setPreference(CommunityThemePreference preference) {
    _save(preference);
  }

  void _save(CommunityThemePreference preference) {
    if (preference == state) return;
    state = preference;
    unawaited(_storage.write(preference));
  }
}

final communityThemeStorageProvider = Provider<CommunityThemeStorage>(
  (ref) => CommunityThemeStorage(ref.watch(savedPrefsProvider)),
);

final communityThemeProvider =
    NotifierProvider<CommunityThemeNotifier, CommunityThemePreference>(
      CommunityThemeNotifier.new,
    );
