import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../theme/theme_provider.dart';

/// Device presentation preference, using the same key and catalog as Desktop/Web.
const platformLocalePreferenceKey = 'buzz-locale';

final platformLocaleProvider = NotifierProvider<PlatformLocaleNotifier, Locale>(
  PlatformLocaleNotifier.new,
);

class PlatformLocaleNotifier extends Notifier<Locale> {
  @override
  Locale build() =>
      ref.read(savedPrefsProvider).get(platformLocalePreferenceKey) == 'en'
      ? const Locale('en')
      : const Locale('zh', 'CN');

  static Locale _locale(String? value) => platformLocale(locale: value) == 'en'
      ? const Locale('en')
      : const Locale('zh', 'CN');

  Future<bool> select(Locale locale) async {
    final next = _locale(locale.toLanguageTag());
    try {
      final saved = await ref
          .read(savedPrefsProvider)
          .setString(platformLocalePreferenceKey, next.toLanguageTag());
      if (saved) state = next;
      return saved;
    } on Exception {
      return false;
    }
  }
}
