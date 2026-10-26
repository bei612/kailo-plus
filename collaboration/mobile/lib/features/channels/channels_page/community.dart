part of '../channels_page.dart';

class _CommunityIndicator extends ConsumerWidget {
  const _CommunityIndicator();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activeAsync = ref.watch(activeCommunityProvider);

    final activeCommunity = activeAsync.unwrapPrevious().value;
    final live = ref.watch(tenantProfileLiveProvider).unwrapPrevious();
    final cleared = live.hasValue && live.value == null;

    return _CommunityAvatar(
      name: cleared ? null : live.value?.name ?? activeCommunity?.name,
      relayUrl: activeCommunity?.relayUrl,
    );
  }
}

class _CommunityHeaderTitle extends ConsumerWidget {
  final TextStyle? style;

  const _CommunityHeaderTitle({this.style});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final live = ref.watch(tenantProfileLiveProvider).unwrapPrevious();
    final cleared = live.hasValue && live.value == null;
    final name = cleared
        ? null
        : live.value?.name ??
            ref.watch(activeCommunityProvider).unwrapPrevious().value?.name;
    final title = name?.trim();
    return SizedBox.expand(
      child: Align(
        alignment: Alignment.centerLeft,
        child: Padding(
          padding: const EdgeInsets.only(left: Grid.xxs),
          child: Text(
            title == null || title.isEmpty
                ? _channelText(context, PlatformMessageKey.platformThemeCommunitySample)
                : title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: style,
          ),
        ),
      ),
    );
  }
}

class _CommunityAvatar extends ConsumerWidget {
  final String? name;
  final String? relayUrl;

  const _CommunityAvatar({required this.name, this.relayUrl});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final live = ref.watch(tenantProfileLiveProvider).unwrapPrevious();
    final cleared = live.hasValue && live.value == null;
    final trimmedName = cleared ? null : name?.trim();
    final initial = trimmedName != null && trimmedName.isNotEmpty
        ? trimmedName.substring(0, 1).toUpperCase()
        : '?';
    final relay = relayUrl;
    final profile = live.value;
    final iconUrl = profile != null
        ? profile.icon
        : cleared || relay == null
        ? null
        : ref.watch(communityIconProvider(relay)).value;
    final emoji =
        profile?.icon != null && !profile!.icon!.startsWith('data:image/')
        ? profile.icon
        : null;

    return AvatarImage(
      imageUrl: emoji == null ? iconUrl : null,
      radius: _kTopSectionCommunityAvatarSize / 2,
      backgroundColor: context.colors.primaryContainer,
      fallback: Text(
        emoji ?? initial,
        style: context.textTheme.labelMedium?.copyWith(
          color: context.colors.onPrimaryContainer,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
