import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../shared/clipboard_utils.dart';
import '../../shared/kailo/kailo_link.dart';
import '../../shared/kailo/kailo_platform_text.dart';
import '../../shared/relay/relay.dart';
import '../../shared/utils/string_utils.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/frosted_scaffold.dart';
import '../../shared/widgets/ios_glass_navigation_button.dart';
import '../../shared/widgets/modal_presentation.dart';
import '../kailo/kailo_audit_page.dart';
import '../kailo/kailo_devices_page.dart';
import '../kailo/kailo_members_page.dart';
import '../kailo/kailo_status_text.dart';
import '../kailo/kailo_tasks_page.dart';
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
                semanticLabel: kailoText(
                  KailoMessageKey.platformSettingsClose,
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
                  tooltip: kailoText(
                    KailoMessageKey.platformSettingsClose,
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

/// 管理平面的只读视图（Kailo `REQ-21`）。
class _OrganizationSection extends StatelessWidget {
  const _OrganizationSection();

  @override
  Widget build(BuildContext context) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    void open(Widget page) => Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: (_) => page));

    return AppListCard(
      label: kailoText(
        KailoMessageKey.platformSettingsOrganization,
        locale: locale,
      ),
      verticalPadding: Grid.twelve,
      children: [
        AppListRow(
          key: const ValueKey('settings-kailo-members'),
          icon: LucideIcons.users,
          title: kailoText(KailoMessageKey.platformTabMembers, locale: locale),
          trailing: const _RowChevron(),
          onTap: () => open(const KailoWorkspacesPage()),
        ),
        AppListRow(
          key: const ValueKey('settings-kailo-tasks'),
          icon: LucideIcons.listChecks,
          title: kailoText(KailoMessageKey.tasksMyTitle, locale: locale),
          trailing: const _RowChevron(),
          onTap: () => open(const KailoTasksPage()),
        ),
        AppListRow(
          key: const ValueKey('settings-kailo-approvals'),
          icon: LucideIcons.clipboardCheck,
          title: kailoText(
            KailoMessageKey.approvalsPendingTitle,
            locale: locale,
          ),
          trailing: const _RowChevron(),
          onTap: () => open(const KailoApprovalsPage()),
        ),
        AppListRow(
          key: const ValueKey('settings-kailo-audit'),
          icon: LucideIcons.scrollText,
          title: kailoText(
            KailoMessageKey.platformAuditMyTitle,
            locale: locale,
          ),
          trailing: const _RowChevron(),
          onTap: () => open(const KailoAuditPage()),
        ),
        AppListRow(
          key: const ValueKey('settings-kailo-devices'),
          icon: LucideIcons.smartphone,
          title: kailoText(
            KailoMessageKey.platformDevicesMyTitle,
            locale: locale,
          ),
          trailing: const _RowChevron(),
          onTap: () => open(const KailoDevicesPage()),
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
      label: kailoText(
        KailoMessageKey.platformSettingsAppearance,
        locale: locale,
      ),
      verticalPadding: Grid.twelve,
      children: [
        AppListRow(
          key: const ValueKey('community-theme-row'),
          icon: LucideIcons.palette,
          title: kailoText(
            KailoMessageKey.platformSettingsTheme,
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

/// 本机设备身份与它和 Kailo 的连接状态。
class _DeviceSection extends ConsumerWidget {
  const _DeviceSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final pubkey = ref.watch(myPubkeyProvider);
    final link = ref.watch(kailoLinkProvider);
    final outcome = kailoOutcomeText(link);
    return AppListCard(
      label: kailoText(
        KailoMessageKey.platformDevicesThisDevice,
        locale: locale,
      ),
      verticalPadding: Grid.twelve,
      children: [
        if (pubkey != null) _IdentityRow(pubkey: pubkey),
        AppListRow(
          key: const ValueKey('settings-kailo-link'),
          icon: LucideIcons.plugZap,
          title: kailoText(
            KailoMessageKey.platformSettingsConnection,
            locale: locale,
          ),
          subtitle: outcome ?? kailoPhaseText(link.phase),
          subtitleMaxLines: 4,
          trailing: link.busy || link.phase == KailoLinkPhase.linked
              ? null
              : TextButton(
                  onPressed: () => unawaited(
                    ref.read(kailoLinkProvider.notifier).reconcile(),
                  ),
                  child: Text(
                    kailoText(KailoMessageKey.platformRetry, locale: locale),
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
      label: kailoText(
        KailoMessageKey.platformSettingsCopyDeviceKey,
        locale: locale,
      ),
      value:
          npub ??
          kailoText(
            KailoMessageKey.platformSettingsIdentityUnavailable,
            locale: locale,
          ),
      child: AppListRow(
        icon: LucideIcons.key,
        title: kailoText(
          KailoMessageKey.platformSettingsDeviceKey,
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
                  message: kailoText(
                    KailoMessageKey.platformSettingsKeyCopied,
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
          title: kailoText(KailoMessageKey.platformSignOut, locale: locale),
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
      title: Text(kailoText(KailoMessageKey.platformSignOut, locale: locale)),
      content: Text(
        kailoText(
          KailoMessageKey.platformSettingsSignOutConfirm,
          locale: locale,
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(),
          child: Text(
            kailoText(KailoMessageKey.platformCancel, locale: locale),
          ),
        ),
        FilledButton(
          onPressed: () async {
            Navigator.of(ctx).pop(); // close dialog
            await ref.read(kailoLinkProvider.notifier).signOut();
            if (!context.mounted) return;
            // Pop all pushed routes back to root so MaterialApp.home rebuilds
            // to the sign-in page when auth state changes.
            Navigator.of(context).popUntil((route) => route.isFirst);
          },
          style: FilledButton.styleFrom(backgroundColor: ctx.colors.error),
          child: Text(
            kailoText(KailoMessageKey.platformSignOut, locale: locale),
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
