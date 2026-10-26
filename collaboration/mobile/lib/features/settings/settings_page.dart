import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../shared/clipboard_utils.dart';
import '../../shared/platform/platform_link.dart';
import '../../shared/platform/platform_locale.dart';
import '../../shared/push/push_bridge.dart';
import '../../shared/push/push_registration.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import '../../shared/relay/relay.dart';
import '../../shared/utils/string_utils.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/frosted_scaffold.dart';
import '../../shared/widgets/immediate_page_route.dart';
import '../../shared/widgets/ios_glass_navigation_action.dart';
import '../../shared/widgets/ios_glass_navigation_button.dart';
import '../../shared/widgets/modal_presentation.dart';
import '../platform/platform_audit_page.dart';
import '../platform/platform_agent_installation_workspaces_page.dart';
import '../platform/platform_devices_page.dart';
import '../platform/platform_members_page.dart';
import '../platform/platform_status_text.dart';
import '../platform/platform_tasks_page.dart';
import '../feedback/feedback_page.dart';
import 'theme_picker_page.dart';

part 'settings_page/notifications_section.dart';

// Buzz 779af8886caae1317b4de962082429867ab61503 mobile/lib/features/settings/settings_page.dart:
// the Edit action and its Edit profile sheet open the original display-name and description
// editors and the Photo row opens the original profile editor in its photo mode (kind:0
// signed by this device's CLIENT key, DD-75; avatar bytes through the media upload).
Widget _emptyProfileEditPage(BuildContext context) => const SizedBox.shrink();

enum _ProfileEditAction { displayName, description, photo }

class SettingsPage extends HookConsumerWidget {
  /// Creates the settings page.
  const SettingsPage({
    super.key,
    required this.profileHeader,
    this.profileEditPageBuilder = _emptyProfileEditPage,
    this.onEditDisplayName,
    this.onEditProfileDescription,
  });

  /// Header widget displayed at the top of settings.
  final Widget profileHeader;

  /// Builds the profile editor opened by the Edit Profile sheet's Photo row.
  final WidgetBuilder profileEditPageBuilder;

  /// Opens the display-name editor after the Edit Profile sheet closes.
  final Future<void> Function(BuildContext context)? onEditDisplayName;

  /// Opens the profile-description editor after the Edit Profile sheet closes.
  final Future<void> Function(BuildContext context)? onEditProfileDescription;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final packageInfoFuture = useMemoized(() => PackageInfo.fromPlatform());
    final packageInfo = useFuture(packageInfoFuture);
    final topSectionHeight = frostedAppBarHeight(
      context,
      bottomHeight: Grid.xxs,
    );
    final canEditProfile =
        onEditDisplayName != null || onEditProfileDescription != null;
    final editLabel = platformText(
      PlatformMessageKey.platformProfileEdit,
      locale: locale,
    );

    Future<void> showEditProfileSheet() async {
      final action = await showBuzzModalBottomSheet<_ProfileEditAction>(
        context: context,
        title: platformText(
          PlatformMessageKey.platformSettingsEditProfile,
          locale: locale,
        ),
        builder: (sheetContext) => SafeArea(
          top: false,
          child: Padding(
            key: const ValueKey('edit-profile-sheet-content'),
            padding: const EdgeInsets.only(bottom: Grid.xs),
            // AppListCard normally fills the height offered by a page section.
            // Give it unbounded vertical space here so this compact action sheet
            // hugs its rows instead of filling the modal height cap.
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                AppListCard(
                  key: const ValueKey('edit-profile-options'),
                  dividerIndent: Grid.xs,
                  verticalPadding: 0,
                  children: [
                    AppListRow(
                      key: const ValueKey('edit-profile-display-name'),
                      title: platformText(
                        PlatformMessageKey.platformProfileDisplayName,
                        locale: locale,
                      ),
                      trailing: const _RowChevron(),
                      onTap: () => Navigator.pop(
                        sheetContext,
                        _ProfileEditAction.displayName,
                      ),
                    ),
                    AppListRow(
                      key: const ValueKey('edit-profile-description'),
                      title: platformText(
                        PlatformMessageKey.platformProfileAbout,
                        locale: locale,
                      ),
                      trailing: const _RowChevron(),
                      onTap: () => Navigator.pop(
                        sheetContext,
                        _ProfileEditAction.description,
                      ),
                    ),
                    AppListRow(
                      key: const ValueKey('edit-profile-photo'),
                      title: platformText(
                        PlatformMessageKey.platformProfilePhoto,
                        locale: locale,
                      ),
                      trailing: const _RowChevron(),
                      onTap: () =>
                          Navigator.pop(sheetContext, _ProfileEditAction.photo),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      );
      if (!context.mounted || action == null) return;
      unawaited(HapticFeedback.selectionClick());
      switch (action) {
        case _ProfileEditAction.displayName:
          await onEditDisplayName?.call(context);
        case _ProfileEditAction.description:
          await onEditProfileDescription?.call(context);
        case _ProfileEditAction.photo:
          await Navigator.of(
            context,
          ).push(immediatePageRoute<void>(builder: profileEditPageBuilder));
      }
    }

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
        actions: [
          if (!canEditProfile)
            const SizedBox.shrink()
          else if (Theme.of(context).platform == TargetPlatform.iOS)
            IosGlassNavigationAction(
              key: const ValueKey('settings-edit-profile'),
              label: editLabel,
              foregroundColor: navigationPrimaryForeground(context),
              onPressed: () => unawaited(showEditProfileSheet()),
            )
          else
            Material(
              key: const ValueKey('settings-edit-profile'),
              color: context.colors.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(Radii.full),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: () => unawaited(showEditProfileSheet()),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: Grid.xs,
                    vertical: Grid.xxs,
                  ),
                  child: Text(
                    editLabel,
                    style: context.textTheme.labelLarge?.copyWith(
                      color: context.colors.onSurface,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ),
        ],
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
                const _NotificationsSection(),
                AppListCard(
                  children: [
                    AppListRow(
                      key: const ValueKey('settings-feedback'),
                      icon: LucideIcons.messageSquare,
                      title: platformText(
                        PlatformMessageKey.platformFeedbackTitle,
                        locale: locale,
                      ),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => const FeedbackPage(),
                        ),
                      ),
                    ),
                  ],
                ),
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
