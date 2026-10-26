part of '../settings_page.dart';

// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/settings/settings_page/notifications_section.dart. The original layout
// and states are kept; the switch is this device's DD-151 push registration with Core
// instead of a community gateway enrollment. Without the native SDK configuration or matching provider credentials the
// original "Unavailable in this build" row stays.
class _NotificationsSection extends ConsumerWidget {
  const _NotificationsSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (defaultTargetPlatform != TargetPlatform.iOS && defaultTargetPlatform != TargetPlatform.android) {
      return const SizedBox.shrink();
    }
    final locale = Localizations.localeOf(context).toLanguageTag();
    String text(PlatformMessageKey key) => platformText(key, locale: locale);
    final push = ref.watch(pushRegistrationProvider);
    if (push.loading) return const SizedBox.shrink();
    if (!push.available) {
      return AppListCard(
        label: text(PlatformMessageKey.platformSettingsNotifications),
        verticalPadding: Grid.twelve,
        children: [
          AppListRow(
            key: const ValueKey('push-notifications-unavailable'),
            icon: LucideIcons.bell,
            title: text(PlatformMessageKey.platformSettingsPushNotifications),
            subtitle: text(PlatformMessageKey.platformSettingsPushUnavailable),
          ),
        ],
      );
    }
    final authorization = ref.watch(pushAuthorizationStatusProvider);
    final status = authorization.value;
    final enabled = push.effectiveEnabled;
    final permissionUnavailable = authorization.hasError;
    final permissionDenied = status == PushAuthorizationStatus.denied;
    final showSettingsRecovery =
        enabled && (permissionDenied || permissionUnavailable);
    final subtitle = switch (push.outcome) {
      PushRegistrationOutcome.saving => text(
        PlatformMessageKey.platformSettingsPushSaving,
      ),
      PushRegistrationOutcome.failed => text(
        PlatformMessageKey.platformSettingsPushFailed,
      ),
      PushRegistrationOutcome.notConfirmed => text(
        PlatformMessageKey.platformSettingsPushNotConfirmed,
      ),
      PushRegistrationOutcome.none when push.registrationState == 'REVOKED' =>
        text(PlatformMessageKey.platformSettingsPushRevoked),
      PushRegistrationOutcome.none when !enabled => text(
        PlatformMessageKey.platformSettingsPushOff,
      ),
      PushRegistrationOutcome.none => switch (status) {
        PushAuthorizationStatus.notDetermined => text(
          PlatformMessageKey.platformSettingsPushWaitingPermission,
        ),
        PushAuthorizationStatus.denied => text(
          PlatformMessageKey.platformSettingsPushPermissionDenied,
        ),
        PushAuthorizationStatus.authorized ||
        PushAuthorizationStatus.provisional ||
        PushAuthorizationStatus.ephemeral => text(
          PlatformMessageKey.platformSettingsPushOn,
        ),
        null when authorization.isLoading => text(
          PlatformMessageKey.platformSettingsPushCheckingPermission,
        ),
        null => text(PlatformMessageKey.platformSettingsPushPermissionUnknown),
      },
    };
    final saving = push.outcome == PushRegistrationOutcome.saving;
    void toggle(bool next) {
      if (saving) return;
      unawaited(
        ref.read(pushRegistrationProvider.notifier).setEnabled(next).then((_) {
          ref.invalidate(pushAuthorizationStatusProvider);
        }),
      );
    }

    return AppListCard(
      label: text(PlatformMessageKey.platformSettingsNotifications),
      verticalPadding: Grid.twelve,
      children: [
        AppListRow(
          key: const ValueKey('push-notifications-enabled'),
          icon: LucideIcons.bell,
          title: text(PlatformMessageKey.platformSettingsPushNotifications),
          subtitle: subtitle,
          subtitleStyle:
              showSettingsRecovery ||
                  push.outcome == PushRegistrationOutcome.failed
              ? context.textTheme.bodySmall?.copyWith(
                  color: context.colors.error,
                )
              : null,
          trailing: Switch.adaptive(
            value: enabled,
            onChanged: saving ? null : toggle,
          ),
          onTap: saving ? null : () => toggle(!enabled),
        ),
        if (showSettingsRecovery)
          AppListRow(
            key: const ValueKey('push-notifications-open-settings'),
            icon: LucideIcons.settings,
            title: text(PlatformMessageKey.platformSettingsPushOpenSettings),
            onTap: () => unawaited(
              ref.read(pushBridgeProvider).openNotificationSettings(),
            ),
          ),
      ],
    );
  }
}
