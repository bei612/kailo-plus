import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'accent_colors.dart';
import 'theme_catalog.dart';
import 'theme_provider.dart' show effectiveTheme, schemeForAppearanceMode;

const defaultCommunityTheme = CommunityThemePreference(
  theme: 'buzz',
  accent: '#3b82f6',
  followSystem: true,
);

class CommunityThemePreference {
  final String theme;
  final String accent;
  final bool followSystem;

  const CommunityThemePreference({
    required this.theme,
    required this.accent,
    required this.followSystem,
  });

  ThemeMode get mode {
    if (followSystem) return ThemeMode.system;
    return findTheme(theme)?.isDark == true ? ThemeMode.dark : ThemeMode.light;
  }

  @override
  bool operator ==(Object other) =>
      other is CommunityThemePreference &&
      theme == other.theme &&
      accent == other.accent &&
      followSystem == other.followSystem;

  @override
  int get hashCode => Object.hash(theme, accent, followSystem);
}

/// 本机的外观偏好。
///
/// 主题与语言属于每端各自解析的 Frontend Presentation Context（`.design/01`
/// §3）；一期不经 Relay 同步 NIP-44 加密的用户状态（`DD-40`），因此只存在本机。
class CommunityThemeStorage {
  static const _modeKey = 'buzz_theme_mode';
  static const _accentKey = 'buzz_accent_color';
  static const _schemeKey = 'buzz_color_scheme';

  final SharedPreferences prefs;

  const CommunityThemeStorage(this.prefs);

  Future<void> write(CommunityThemePreference preference) async {
    await prefs.setString(_modeKey, preference.mode.name);
    await prefs.setString(_schemeKey, preference.theme);
    await prefs.setInt(
      _accentKey,
      accentIndexForWireValue(preference.accent) ?? defaultAccentIndex,
    );
  }

  /// 本机保存的偏好；没有保存过时跟随系统、用 Buzz 主题。
  CommunityThemePreference read() {
    final modeName = prefs.getString(_modeKey);
    final mode =
        ThemeMode.values.where((value) => value.name == modeName).firstOrNull ??
        ThemeMode.system;
    final storedTheme = prefs.getString(_schemeKey);
    final theme = findTheme(storedTheme ?? 'buzz')?.name ?? 'buzz';
    final accentIndex = prefs.getInt(_accentKey);
    final accent =
        accentIndex != null &&
            accentIndex >= 0 &&
            accentIndex < accentColors.length
        ? accentColors[accentIndex].wireValue
        : defaultCommunityTheme.accent;
    final resolvedTheme = switch (mode) {
      ThemeMode.system => schemeForAppearanceMode(theme, mode) ?? theme,
      ThemeMode.light ||
      ThemeMode.dark => effectiveTheme(theme, mode)?.name ?? theme,
    };
    return CommunityThemePreference(
      theme: resolvedTheme,
      accent: accent,
      followSystem: mode == ThemeMode.system,
    );
  }
}
