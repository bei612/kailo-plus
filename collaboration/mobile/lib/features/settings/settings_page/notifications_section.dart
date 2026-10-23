part of '../settings_page.dart';

// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/settings/settings_page/notifications_section.dart. Kailo artifacts carry
// no push gateway and the push enrollment stack (shared/push) is not restored, so this keeps the
// original's unavailable-build branch: iOS shows that push notifications are unavailable rather
// than offering a switch that could not deliver anything.
class _NotificationsSection extends ConsumerWidget {
  const _NotificationsSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (defaultTargetPlatform != TargetPlatform.iOS) {
      return const SizedBox.shrink();
    }
    final locale = Localizations.localeOf(context).toLanguageTag();
    return AppListCard(
      label: platformText(
        PlatformMessageKey.platformSettingsNotifications,
        locale: locale,
      ),
      verticalPadding: Grid.twelve,
      children: [
        AppListRow(
          key: const ValueKey('push-notifications-unavailable'),
          icon: LucideIcons.bell,
          title: platformText(
            PlatformMessageKey.platformSettingsPushNotifications,
            locale: locale,
          ),
          subtitle: platformText(
            PlatformMessageKey.platformSettingsPushUnavailable,
            locale: locale,
          ),
        ),
      ],
    );
  }
}
