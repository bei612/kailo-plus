part of '../channels_page.dart';

class _ChannelTile extends ConsumerWidget {
  final Channel channel;
  final bool isUnread;
  final VoidCallback onTap;

  const _ChannelTile({
    required this.channel,
    required this.isUnread,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final contentColor = navigationPrimaryForeground(
      context,
    ).withValues(alpha: isUnread ? 1 : 0.8);

    return InkWell(
      borderRadius: BorderRadius.circular(Radii.md),
      onTap: onTap,
      onLongPress: () => showChannelActionsSheet(
        context: context,
        channel: channel,
        isUnread: isUnread,
      ),
      child: Padding(
        padding: const EdgeInsets.only(
          left: _kChannelSectionInset,
          right: _kChannelSectionInset,
          top: _kChannelRowVerticalPadding,
          bottom: _kChannelRowVerticalPadding,
        ),
        child: Row(
          children: [
            SizedBox(
              width: _kChannelLeadingWidth,
              child: Align(
                alignment: Alignment.centerLeft,
                child: channel.isDm
                    ? _DmAvatar(
                        channel: channel,
                        currentPubkey: ref.watch(myPubkeyProvider),
                      )
                    : Icon(
                        channelIcon(channel),
                        key: ValueKey('channel-icon-${channel.id}'),
                        size: _kChannelIconSize,
                        color: contentColor,
                      ),
              ),
            ),
            const SizedBox(width: _kChannelLabelGap),
            Expanded(
              child: Text(
                channel.displayLabel(
                  currentPubkey: ref.watch(myPubkeyProvider),
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: contentListTitleTextStyle.copyWith(
                  color: contentColor,
                  fontWeight: isUnread ? FontWeight.w700 : FontWeight.w400,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// Original Buzz _DmAvatar, with people counted by the authorized Principal set.
// Presence has no Mobile consumer yet; no synthetic online/offline badge.
class _DmAvatar extends ConsumerWidget {
  const _DmAvatar({required this.channel, required this.currentPubkey});
  final Channel channel;
  final String? currentPubkey;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final other = channel.participantPubkeys
        .where((key) => key != currentPubkey?.toLowerCase())
        .toList();
    if (other.length > 1) {
      return Container(
        width: _kChannelIconSize,
        height: _kChannelIconSize,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: context.colors.surfaceContainerHighest,
          shape: BoxShape.circle,
          border: Border.all(color: context.colors.outlineVariant),
        ),
        child: Text(
          '${other.length}',
          style: context.textTheme.labelSmall?.copyWith(
            fontSize: 9,
            color: context.colors.onSurface,
            fontWeight: FontWeight.w600,
            height: 1,
          ),
        ),
      );
    }
    final profile = ref.watch(
      userCacheProvider.select((profiles) => profiles[other.firstOrNull]),
    );
    final label = channel.displayLabel(currentPubkey: currentPubkey);
    return AvatarImage(
      imageUrl: profile?.avatarUrl,
      radius: _kChannelIconSize / 2,
      backgroundColor: context.colors.primaryContainer,
      fallback: Text(
        profile?.initial ?? label.characters.first.toUpperCase(),
        style: context.textTheme.labelSmall?.copyWith(
          fontSize: 9,
          color: context.colors.onPrimaryContainer,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
