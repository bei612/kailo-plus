part of '../channel_detail_page.dart';

const _channelHeaderAvatarSize = 40.0;

double _scaledTextHeight(BuildContext context, TextStyle style) {
  final scaledFontSize = MediaQuery.textScalerOf(
    context,
  ).scale(style.fontSize ?? 0);
  return scaledFontSize * (style.height ?? 1);
}

double _twoLineAppBarTitleContentHeight(BuildContext context) {
  final titleStyle = context.textTheme.titleSmall;
  final subtitleStyle = context.textTheme.bodySmall;
  if (titleStyle == null || subtitleStyle == null) {
    return _channelHeaderAvatarSize;
  }
  final textHeight =
      _scaledTextHeight(context, titleStyle) +
      _scaledTextHeight(context, subtitleStyle);
  return textHeight > _channelHeaderAvatarSize
      ? textHeight
      : _channelHeaderAvatarSize;
}

class _ChannelAppBarTitle extends ConsumerWidget {
  const _ChannelAppBarTitle({required this.channel, required this.onTap});

  final Channel channel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // 人数按人算，不按 Relay roster 上的公钥算：一个人可能有 Web 与多台设备
    // 的公钥（DD-77）
    final memberCount = ref
        .watch(platformWorkspaceMembersProvider(channel.id))
        .value
        ?.length;
    final memberLabel = memberCount == null
        ? 'Members'
        : '$memberCount ${memberCount == 1 ? 'member' : 'members'}';

    return Semantics(
      button: true,
      label: 'Open members of ${channel.name}, $memberLabel',
      child: Tooltip(
        message: 'Open channel members',
        child: InkWell(
          key: const ValueKey('channel-header-settings-trigger'),
          borderRadius: BorderRadius.circular(Radii.md),
          onTap: onTap,
          child: Row(
            children: [
              Container(
                key: const ValueKey('channel-header-avatar'),
                width: _channelHeaderAvatarSize,
                height: _channelHeaderAvatarSize,
                decoration: BoxDecoration(
                  color: context.colors.surface,
                  shape: BoxShape.circle,
                  border: Border.fromBorderSide(
                    BorderSide(
                      color: context.colors.inverseSurface.withValues(
                        alpha: 0.07,
                      ),
                      strokeAlign: BorderSide.strokeAlignOutside,
                    ),
                  ),
                ),
                child: Icon(
                  channelIcon(channel),
                  size: 20,
                  color: context.colors.primary,
                ),
              ),
              const SizedBox(width: Grid.twelve),
              Expanded(
                child: ConstrainedBox(
                  key: const ValueKey('channel-header-text-stack'),
                  constraints: const BoxConstraints(
                    minHeight: _channelHeaderAvatarSize,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Flexible(
                            child: Text(
                              channel.name,
                              key: const ValueKey('channel-header-name'),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: context.textTheme.titleSmall?.copyWith(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      ),
                      Text(
                        memberLabel,
                        key: const ValueKey('channel-header-member-count'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.textTheme.bodySmall?.copyWith(
                          color: context.colors.onSurface.withValues(
                            alpha: 0.65,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// Original Buzz _DmAppBarTitle's avatar/name subtree. HUMAN labels are projected
// from Conversation participants, never fetched through a fabricated Workspace.
// The counterpart's kind:20001 presence dot and line appear once a live fact has
// arrived (DD-120 (5)); a missing fact is not shown as Offline.
class _DmAppBarTitle extends ConsumerWidget {
  const _DmAppBarTitle({required this.channel, required this.currentPubkey});
  final Channel channel;
  final String? currentPubkey;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final other = channel.participantPubkeys
        .where((key) => key != currentPubkey?.toLowerCase())
        .firstOrNull;
    final profile = ref.watch(
      userCacheProvider.select((profiles) => profiles[other]),
    );
    final presence = ref.watch(
      presenceCacheProvider.select(
        (presenceMap) => other == null ? null : presenceMap[other],
      ),
    );
    if (other != null) {
      ref.read(presenceCacheProvider.notifier).track([other]);
    }
    final locale = Localizations.localeOf(context).toLanguageTag();
    final label = channel.displayLabel(currentPubkey: currentPubkey);
    final avatar = AvatarImage(
      key: const ValueKey('dm-header-avatar'),
      imageUrl: profile?.avatarUrl,
      radius: 16,
      backgroundColor: context.colors.primaryContainer,
      fallback: Text(
        profile?.initial ?? label.characters.first.toUpperCase(),
        style: context.textTheme.labelSmall?.copyWith(
          color: context.colors.onPrimaryContainer,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
    final name = Text(
      label,
      key: const ValueKey('dm-header-name'),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: context.textTheme.titleSmall,
    );
    return Row(
      children: [
        if (presence == null)
          avatar
        else
          SizedBox(
            width: 32,
            height: 32,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                avatar,
                Positioned(
                  right: -1,
                  bottom: -1,
                  child: Container(
                    key: const ValueKey('dm-header-presence-dot'),
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(
                      color: switch (presence) {
                        'online' => context.appColors.success,
                        'away' => context.appColors.warning,
                        _ => context.colors.outline,
                      },
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: context.theme.scaffoldBackgroundColor,
                        width: 1.5,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(width: Grid.xxs),
        Expanded(
          child: presence == null
              ? name
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    name,
                    Text(
                      platformText(switch (presence) {
                        'online' => PlatformMessageKey.presenceOnline,
                        'away' => PlatformMessageKey.presenceAway,
                        _ => PlatformMessageKey.presenceOffline,
                      }, locale: locale),
                      key: const ValueKey('dm-header-presence'),
                      style: context.textTheme.bodyMedium?.copyWith(
                        color: context.colors.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
        ),
      ],
    );
  }
}
