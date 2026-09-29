import 'dart:async';

import 'package:app_badge_plus/app_badge_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'features/channels/deep_link_dispatcher.dart';
import 'features/channels/unread_badge/unread_badge_provider.dart';
import 'features/channels/voice_note_recording.dart';
import 'features/home/home_page.dart';
import 'features/kailo/kailo_sign_in_page.dart';
import 'features/profile/settings_profile_header.dart';
import 'features/settings/settings_page.dart';
import 'shared/auth/auth.dart';
import 'shared/deeplink/pending_deep_link_provider.dart';
import 'shared/kailo/kailo_link.dart';
import 'shared/relay/relay.dart';
import 'shared/theme/theme.dart';
import 'shared/widgets/buzz_loading_indicator.dart';

class App extends HookConsumerWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final communityTheme = ref.watch(communityThemeProvider);
    final themeMode = communityTheme.mode;
    final accentIndex = effectiveAccentIndex(
      communityTheme.theme,
      communityTheme.accent,
    );
    final schemeName = communityTheme.theme;
    final authState = ref.watch(authProvider);

    // 启动时与 Kailo 核对一次：凭据仍在就刷新设备登记与 Relay 连接事实，
    // 凭据已不在就撤掉残留的协作连接。
    useEffect(() {
      unawaited(ref.read(kailoLinkProvider.notifier).reconcile());
      return null;
    }, const []);

    final resolved = resolveSchemes(schemeName, themeMode);
    final lightScheme = applyAccent(resolved.light, accentIndex);
    final darkScheme = applyAccent(resolved.dark, accentIndex);
    // Light/Dark modes pin the brightness; System leaves it null so Flutter
    // follows the OS across the selected theme and its pair.
    final effectiveMode = resolved.forcedMode ?? themeMode;

    // Derive the gradient from the themes that produced each color scheme.
    // This keeps fallbacks and pinned brightness changes aligned with the
    // rendered palette rather than the raw persisted selection.
    final buzzLightGradient = buzzTopSectionGradient(
      resolved.lightTheme?.name ?? '',
      lightScheme.brightness,
    );
    final buzzDarkGradient = buzzTopSectionGradient(
      resolved.darkTheme?.name ?? '',
      darkScheme.brightness,
    );

    // Eagerly initialize websocket session and lifecycle observer when
    // authenticated. These providers connect and manage the websocket.
    final authenticated = authState.value?.status == AuthStatus.authenticated;
    if (authenticated) {
      ref.watch(relaySessionProvider);
      ref.watch(appLifecycleProvider);
    }

    // Start listening for buzz:// links immediately (even pre-auth) so a
    // cold-start link survives until the authenticated UI can dispatch it.
    ref.watch(pendingDeepLinkProvider);

    void applyBadge(UnreadBadgeState state) {
      if (state.highPriorityCount > 0) {
        AppBadgePlus.updateBadge(state.highPriorityCount);
      } else if (state.generalUnreadCount > 0) {
        AppBadgePlus.updateBadge(1);
      } else {
        AppBadgePlus.updateBadge(0);
      }
    }

    useEffect(() {
      applyBadge(ref.read(unreadBadgeProvider));
      return null;
    }, const []);
    ref.listen<UnreadBadgeState>(unreadBadgeProvider, (_, next) {
      applyBadge(next);
    });

    return MaterialApp(
      supportedLocales: const [Locale('en'), Locale('zh', 'CN')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      navigatorObservers: [voiceNoteRouteObserver],
      title: 'Buzz',
      theme: AppTheme.light(
        colorScheme: lightScheme,
        topSectionGradient: buzzLightGradient,
      ),
      darkTheme: AppTheme.dark(
        colorScheme: darkScheme,
        topSectionGradient: buzzDarkGradient,
      ),
      themeMode: effectiveMode,
      builder: (context, child) =>
          AppMarkdownTheme(child: child ?? const SizedBox.shrink()),
      home: authState.when(
        loading: () => const _SplashScreen(),
        error: (_, _) => const KailoSignInPage(),
        data: (state) => switch (state.status) {
          AuthStatus.authenticated => const DeepLinkDispatcher(
            child: HomePage(settingsPageBuilder: _buildSettingsPage),
          ),
          _ => const DeepLinkDispatcher(
            dispatchMessageLinks: false,
            child: KailoSignInPage(),
          ),
        },
      ),
    );
  }
}

Widget _buildSettingsPage(BuildContext context) =>
    const SettingsPage(profileHeader: SettingsProfileHeader());

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: BuzzLoadingIndicator(size: 56, semanticLabel: 'Starting Buzz'),
      ),
    );
  }
}
