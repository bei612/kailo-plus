import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../shared/clipboard_utils.dart';
import '../../shared/platform/platform_link.dart';
import '../../shared/platform/platform_locale.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import '../../shared/relay/relay.dart';
import '../../shared/utils/string_utils.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/frosted_scaffold.dart';
import '../../shared/widgets/ios_glass_navigation_button.dart';
import '../../shared/widgets/modal_presentation.dart';
import '../platform/platform_audit_page.dart';
import '../platform/platform_agent_installation_workspaces_page.dart';
import '../platform/platform_devices_page.dart';
import '../platform/platform_members_page.dart';
import '../platform/platform_status_text.dart';
import '../platform/platform_tasks_page.dart';
import 'theme_picker_page.dart';

class SettingsPage extends HookConsumerWidget {
  /// Creates the settings page.
  const SettingsPage({super.key, required this.profileHeader});

  /// Header widget displayed at the top of settings.
  final Widget profileHeader;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final packageInfoFuture = useMemoized(() => PackageInfo.fromPlatform());
    final packageInfo = useFuture(packageInfoFuture);
    final topSectionHeight = frostedAppBarHeight(
      context,
      bottomHeight: Grid.xxs,
    );

    return FrostedScaffold(
      useUtilitySurfaceTheme: true,
      appBar: FrostedAppBar(
        automaticallyImplyLeading: false,
        horizontalInset: Grid.gutter,
        showBottomDivider: false,
        leading: Theme.of(context).platform == TargetPlatform.iOS
            ? IosGlassNavigationButton(
                key: const ValueKey('settings-ios-glass-close'),
                icon: IosGlassNavigationIcon.close,
                semanticLabel: platformText(
                  PlatformMessageKey.platformSettingsClose,
                  locale: locale,
                ),
                onPressed: () {
                  unawaited(HapticFeedback.lightImpact());
                  Navigator.of(context).pop();
                },
                foregroundColor: navigationPrimaryForeground(context),
              )
            : SizedBox(
                width: Grid.xl,
                height: Grid.xl,
                child: IconButton(
                  tooltip: platformText(
                    PlatformMessageKey.platformSettingsClose,
                    locale: locale,
                  ),
                  onPressed: () {
                    unawaited(HapticFeedback.lightImpact());
                    Navigator.of(context).pop();
                  },
                  color: navigationPrimaryForeground(context),
                  icon: const Icon(LucideIcons.x),
                ),
              ),
        bottomHeight: Grid.xxs,
        bottom: const SizedBox.expand(),
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: EdgeInsets.only(top: topSectionHeight, bottom: Grid.xs),
              children: [
                profileHeader,
                const _OrganizationSection(),
                const _AppearanceSection(),
                const _LanguageSection(),
                const _DeviceSection(),
                const _SignOutSection(),
              ],
            ),
          ),
          if (packageInfo.hasData)
            _VersionFooter(
              version: packageInfo.data!.version,
              buildNumber: packageInfo.data!.buildNumber,
            ),
        ],
      ),
    );
  }
}

class _LanguageSection extends HookConsumerWidget {
  const _LanguageSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final selected = ref.watch(platformLocaleProvider);
    final saving = useState(false);
    final failed = useState(false);
    return AppListCard(
      label: platformText(
        PlatformMessageKey.platformSettingsLanguage,
        locale: locale,
      ),
      children: [
        for (final choice in const [Locale('zh', 'CN'), Locale('en')])
          AppListRow(
            title: platformText(
              choice.languageCode == 'en'
                  ? PlatformMessageKey.platformSettingsLanguageEnglish
                  : PlatformMessageKey.platformSettingsLanguageChinese,
              locale: locale,
            ),
            trailing: selected == choice ? const Icon(LucideIcons.check) : null,
            onTap: saving.value
                ? null
                : () async {
                    saving.value = true;
                    final success = await ref
                        .read(platformLocaleProvider.notifier)
                        .select(choice);
                    if (!context.mounted) return;
                    failed.value = !success;
                    saving.value = false;
                  },
          ),
        if (failed.value)
          AppListRow(
            title: platformText(
              PlatformMessageKey.platformSettingsLanguageSaveFailed,
              locale: locale,
            ),
          ),
      ],
    );
  }
}

/// 管理平面的只读视图（`REQ-21`）。
class _OrganizationSection extends StatelessWidget {
  const _OrganizationSection();

  @override
  Widget build(BuildContext context) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    void open(Widget page) => Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: (_) => page));

    return AppListCard(
      label: platformText(
        PlatformMessageKey.platformSettingsOrganization,
        locale: locale,
      ),
      verticalPadding: Grid.twelve,
      children: [
        AppListRow(
          key: const ValueKey('settings-platform-agents'),
          icon: LucideIcons.bot,
          title: platformText(
            PlatformMessageKey.platformTabAgents,
            locale: locale,
          ),
          trailing: const _RowChevron(),
          onTap: () => open(const PlatformAgentInstallationWorkspacesPage()),
        ),
        AppListRow(
          key: const ValueKey('settings-platform-members'),
          icon: LucideIcons.users,
          title: platformText(
            PlatformMessageKey.platformTabMembers,
            locale: locale,
          ),
          trailing: const _RowChevron(),
          onTap: () => open(const PlatformWorkspacesPage()),
        ),
        AppListRow(
          key: const ValueKey('settings-platform-tasks'),
          icon: LucideIcons.listChecks,
          title: platformText(PlatformMessageKey.tasksMyTitle, locale: locale),
          trailing: const _RowChevron(),
          onTap: () => open(const PlatformTasksPage()),
        ),
        AppListRow(
          key: const ValueKey('settings-platform-approvals'),
          icon: LucideIcons.clipboardCheck,
          title: platformText(
            PlatformMessageKey.approvalsPendingTitle,
            locale: locale,
          ),
          trailing: const _RowChevron(),
          onTap: () => open(const PlatformApprovalsPage()),
        ),
        AppListRow(
          key: const ValueKey('settings-platform-audit'),
          icon: LucideIcons.scrollText,
          title: platformText(
            PlatformMessageKey.platformAuditMyTitle,
            locale: locale,
          ),
          trailing: const _RowChevron(),
          onTap: () => open(const PlatformAuditPage()),
        ),
        AppListRow(
          key: const ValueKey('settings-platform-devices'),
          icon: LucideIcons.smartphone,
          title: platformText(
            PlatformMessageKey.platformDevicesMyTitle,
            locale: locale,
          ),
          trailing: const _RowChevron(),
          onTap: () => open(const PlatformDevicesPage()),
        ),
      ],
    );
  }
}

class _AppearanceSection extends ConsumerWidget {
  const _AppearanceSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final preference = ref.watch(communityThemeProvider);
    final locale = Localizations.localeOf(context).toLanguageTag();
    return AppListCard(
      label: platformText(
        PlatformMessageKey.platformSettingsAppearance,
        locale: locale,
      ),
      verticalPadding: Grid.twelve,
      children: [
        AppListRow(
          key: const ValueKey('community-theme-row'),
          icon: LucideIcons.palette,
          title: platformText(
            PlatformMessageKey.platformSettingsTheme,
            locale: locale,
          ),
          value: themeSelectionLabel(preference.theme, preference.mode),
          trailing: const _RowChevron(),
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => const ThemePickerPage()),
          ),
        ),
      ],
    );
  }
}

/// 本机设备身份与它和平台的连接状态。
class _DeviceSection extends ConsumerWidget {
  const _DeviceSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final pubkey = ref.watch(myPubkeyProvider);
    final link = ref.watch(platformLinkProvider);
    final outcome = platformOutcomeText(link);
    return AppListCard(
      label: platformText(
        PlatformMessageKey.platformDevicesThisDevice,
        locale: locale,
      ),
      verticalPadding: Grid.twelve,
      children: [
        if (pubkey != null) _IdentityRow(pubkey: pubkey),
        AppListRow(
          key: const ValueKey('settings-platform-link'),
          icon: LucideIcons.plugZap,
          title: platformText(
            PlatformMessageKey.platformSettingsConnection,
            locale: locale,
          ),
          subtitle: outcome ?? platformPhaseText(link.phase),
          subtitleMaxLines: 4,
          trailing: link.busy || link.phase == PlatformLinkPhase.linked
              ? null
              : TextButton(
                  onPressed: () => unawaited(
                    ref.read(platformLinkProvider.notifier).reconcile(),
                  ),
                  child: Text(
                    platformText(
                      PlatformMessageKey.platformRetry,
                      locale: locale,
                    ),
                  ),
                ),
        ),
      ],
    );
  }
}

class _IdentityRow extends StatelessWidget {
  const _IdentityRow({required this.pubkey});

  final String pubkey;

  @override
  Widget build(BuildContext context) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    // The full npub is the canonical copy/share form (never raw hex).
    final npub = fullNpub(pubkey);
    return Semantics(
      button: true,
      label: platformText(
        PlatformMessageKey.platformSettingsCopyDeviceKey,
        locale: locale,
      ),
      value:
          npub ??
          platformText(
            PlatformMessageKey.platformSettingsIdentityUnavailable,
            locale: locale,
          ),
      child: AppListRow(
        icon: LucideIcons.key,
        title: platformText(
          PlatformMessageKey.platformSettingsDeviceKey,
          locale: locale,
        ),
        subtitle: shortPubkey(pubkey),
        trailing: Icon(
          LucideIcons.copy,
          size: 18,
          color: context.colors.onSurfaceVariant,
        ),
        onTap: npub == null
            ? null
            : () async {
                await copyToClipboard(
                  context,
                  npub,
                  message: platformText(
                    PlatformMessageKey.platformSettingsKeyCopied,
                    locale: locale,
                  ),
                );
              },
      ),
    );
  }
}

class _SignOutSection extends ConsumerWidget {
  const _SignOutSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    return AppListCard(
      verticalPadding: Grid.twelve,
      children: [
        AppListRow(
          key: const ValueKey('settings-sign-out'),
          icon: LucideIcons.logOut,
          title: platformText(
            PlatformMessageKey.platformSignOut,
            locale: locale,
          ),
          titleColor: context.colors.error,
          onTap: () => _confirmSignOut(context, ref),
        ),
      ],
    );
  }
}

void _confirmSignOut(BuildContext context, WidgetRef ref) {
  final locale = Localizations.localeOf(context).toLanguageTag();
  showBuzzDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(
        platformText(PlatformMessageKey.platformSignOut, locale: locale),
      ),
      content: Text(
        platformText(
          PlatformMessageKey.platformSettingsSignOutConfirm,
          locale: locale,
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(),
          child: Text(
            platformText(PlatformMessageKey.platformCancel, locale: locale),
          ),
        ),
        FilledButton(
          onPressed: () async {
            Navigator.of(ctx).pop(); // close dialog
            await ref.read(platformLinkProvider.notifier).signOut();
            if (!context.mounted) return;
            // Pop all pushed routes back to root so MaterialApp.home rebuilds
            // to the sign-in page when auth state changes.
            Navigator.of(context).popUntil((route) => route.isFirst);
          },
          style: FilledButton.styleFrom(backgroundColor: ctx.colors.error),
          child: Text(
            platformText(PlatformMessageKey.platformSignOut, locale: locale),
          ),
        ),
      ],
    ),
  );
}

class _VersionFooter extends StatelessWidget {
  const _VersionFooter({required this.version, required this.buildNumber});

  final String version;
  final String buildNumber;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.only(bottom: Grid.xs, top: Grid.xxs),
        child: Center(
          child: Text(
            buildNumber.isEmpty ? 'v$version' : 'v$version ($buildNumber)',
            style: context.textTheme.bodySmall?.copyWith(
              color: context.colors.onSurfaceVariant.withValues(alpha: 0.6),
            ),
          ),
        ),
      ),
    );
  }
}

/// Trailing affordance shared by the rows that push another page.
class _RowChevron extends StatelessWidget {
  const _RowChevron();

  @override
  Widget build(BuildContext context) {
    return Icon(
      LucideIcons.chevronRight,
      size: 18,
      color: context.colors.onSurfaceVariant,
    );
  }
}
