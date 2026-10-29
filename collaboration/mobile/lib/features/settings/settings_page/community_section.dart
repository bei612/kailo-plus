part of '../settings_page.dart';

// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/settings/settings_page/community_section.dart. Kailo: "Invite to community"
// is shown on the BFF's answer for the invitation list (Tenant `manage`; a 403 hides it, an
// unknown answer keeps it reachable like the original `roleAsync.hasError`), and opens the
// DD-83 invitation page. The Theme row is the original one (DD-53, this device only).
class _CommunitySection extends ConsumerWidget {
  const _CommunitySection({required this.invitePageBuilder});

  final WidgetBuilder invitePageBuilder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final access = ref.watch(inviteAccessProvider).asData?.value;
    final canInvite =
        access == InviteAccess.allowed || access == InviteAccess.unknown;
    final preference = ref.watch(communityThemeProvider);

    return AppListCard(
      label: platformText(
        PlatformMessageKey.platformSettingsCommunity,
        locale: locale,
      ),
      verticalPadding: Grid.twelve,
      children: [
        if (canInvite)
          AppListRow(
            key: const ValueKey('community-invite-row'),
            icon: LucideIcons.userPlus,
            title: platformText(
              PlatformMessageKey.invitationsCommunityInvite,
              locale: locale,
            ),
            trailing: const _RowChevron(),
            onTap: () => Navigator.of(
              context,
            ).push(MaterialPageRoute<void>(builder: invitePageBuilder)),
          ),
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
