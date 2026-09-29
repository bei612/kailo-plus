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
        .watch(kailoWorkspaceMembersProvider(channel.id))
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
