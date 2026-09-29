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
                child: Icon(
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
                channel.name,
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
