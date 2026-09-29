part of '../channels_page.dart';

class _CommunityIndicator extends ConsumerWidget {
  const _CommunityIndicator();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activeAsync = ref.watch(activeCommunityProvider);

    final activeCommunity = activeAsync.value;

    return _CommunityAvatar(
      name: activeCommunity?.name,
      relayUrl: activeCommunity?.relayUrl,
    );
  }
}

class _CommunityHeaderTitle extends ConsumerWidget {
  final TextStyle? style;

  const _CommunityHeaderTitle({this.style});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final name = ref.watch(activeCommunityProvider).value?.name;
    final title = name?.trim();
    return SizedBox.expand(
      child: Align(
        alignment: Alignment.centerLeft,
        child: Padding(
          padding: const EdgeInsets.only(left: Grid.xxs),
          child: Text(
            title == null || title.isEmpty ? 'Community' : title,
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
    final trimmedName = name?.trim();
    final initial = trimmedName != null && trimmedName.isNotEmpty
        ? trimmedName.substring(0, 1).toUpperCase()
        : '?';
    final relay = relayUrl;
    final iconUrl = relay == null
        ? null
        : ref.watch(communityIconProvider(relay)).value;

    return AvatarImage(
      imageUrl: iconUrl,
      radius: _kTopSectionCommunityAvatarSize / 2,
      backgroundColor: context.colors.primaryContainer,
      fallback: Text(
        initial,
        style: context.textTheme.labelMedium?.copyWith(
          color: context.colors.onPrimaryContainer,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
