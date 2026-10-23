part of '../channels_page.dart';

class _ChannelSection extends StatelessWidget {
  final String title;
  final IconData icon;
  final bool expanded;
  final VoidCallback onToggle;
  final List<Channel> channels;
  final bool showTopDivider;
  final Set<String> unreadChannelIds;
  final String emptyLabel;
  final Future<void> Function(Channel channel) onSelectChannel;

  /// A custom section's emoji icon (original section icon), shown instead of [icon].
  final String? emoji;

  /// The original custom-section header menu; built-in groups have none.
  final Widget? menu;

  const _ChannelSection({
    super.key,
    this.emoji,
    this.menu,
    required this.title,
    required this.icon,
    required this.expanded,
    required this.onToggle,
    required this.channels,
    required this.showTopDivider,
    required this.unreadChannelIds,
    required this.emptyLabel,
    required this.onSelectChannel,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (showTopDivider) const _SectionDivider(),
        _SectionHeader(
          label: title,
          icon: icon,
          emoji: emoji,
          menu: menu,
          expanded: expanded,
          onToggle: onToggle,
        ),
        _AnimatedSectionBody(
          expanded: expanded,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (channels.isEmpty)
                Padding(
                  padding: const EdgeInsets.only(
                    left: _kChannelLabelInset,
                    right: _kChannelSectionInset,
                    top: Grid.half,
                    bottom: Grid.half,
                  ),
                  child: Text(
                    emptyLabel,
                    style: contentListBodyTextStyle.copyWith(
                      color: context.colors.onSurfaceVariant,
                    ),
                  ),
                )
              else
                for (final channel in channels)
                  _ChannelTile(
                    channel: channel,
                    isUnread: unreadChannelIds.contains(channel.id),
                    onTap: () => onSelectChannel(channel),
                  ),
              const SizedBox(height: _kExpandedSectionTrailingPadding),
            ],
          ),
        ),
      ],
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.55,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              LucideIcons.messagesSquare,
              size: Grid.xl,
              color: context.colors.onSurfaceVariant,
            ),
            const SizedBox(height: Grid.xs),
            Text(
              'No conversations yet',
              style: context.textTheme.bodyLarge?.copyWith(
                color: context.colors.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionDivider extends StatelessWidget {
  const _SectionDivider();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: Grid.xxs),
      child: Divider(
        height: 1,
        thickness: 1,
        indent: _kChannelSectionInset,
        endIndent: _kChannelSectionInset,
        color: context.colors.primary.withValues(alpha: 0.15),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String label;
  final IconData icon;
  final String? emoji;
  final Widget? menu;
  final bool expanded;
  final VoidCallback onToggle;

  const _SectionHeader({
    this.emoji,
    this.menu,
    required this.label,
    required this.icon,
    required this.expanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final sectionColor = navigationSectionForeground(context);

    return GestureDetector(
      onTap: onToggle,
      behavior: HitTestBehavior.opaque,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          Grid.gutter,
          _kSectionHeaderVerticalPadding,
          Grid.gutter,
          _kSectionHeaderVerticalPadding,
        ),
        child: Row(
          children: [
            SizedBox(
              width: _kChannelLeadingWidth,
              child: Align(
                alignment: Alignment.centerLeft,
                child: emoji == null
                    ? Icon(icon, size: _kChannelIconSize, color: sectionColor)
                    : Text(
                        emoji!,
                        style: const TextStyle(fontSize: _kChannelIconSize),
                      ),
              ),
            ),
            const SizedBox(width: _kChannelLabelGap),
            Expanded(
              child: Text(
                label,
                style: contentListTitleTextStyle.copyWith(
                  color: sectionColor,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            ?menu,
            _SectionChevron(expanded: expanded, color: sectionColor),
          ],
        ),
      ),
    );
  }
}

class _SectionChevron extends StatelessWidget {
  final bool expanded;
  final Color color;

  const _SectionChevron({required this.expanded, required this.color});

  @override
  Widget build(BuildContext context) {
    final reducedMotion = MediaQuery.of(context).disableAnimations;

    return AnimatedRotation(
      turns: expanded ? 0 : -0.25,
      duration: reducedMotion ? Duration.zero : _kSectionExpandDuration,
      curve: _kSectionExpandCurve,
      child: Icon(
        LucideIcons.chevronDown,
        size: _kChannelIconSize,
        color: color,
      ),
    );
  }
}

class _AnimatedSectionBody extends HookWidget {
  final bool expanded;
  final Widget child;

  const _AnimatedSectionBody({required this.expanded, required this.child});

  @override
  Widget build(BuildContext context) {
    final reducedMotion = MediaQuery.of(context).disableAnimations;
    final controller = useAnimationController(
      duration: reducedMotion ? Duration.zero : _kSectionExpandDuration,
      reverseDuration: reducedMotion
          ? Duration.zero
          : _kSectionCollapseDuration,
      initialValue: expanded ? 1 : 0,
    );
    final curvedAnimation = useMemoized(
      () => CurvedAnimation(
        parent: controller,
        curve: _kSectionExpandCurve,
        reverseCurve: _kSectionCollapseCurve,
      ),
      [controller],
    );
    final shouldRender = useState(expanded);

    useEffect(() => curvedAnimation.dispose, [curvedAnimation]);

    useEffect(() {
      void handleStatus(AnimationStatus status) {
        if (status == AnimationStatus.dismissed && !expanded) {
          shouldRender.value = false;
        }
      }

      controller.addStatusListener(handleStatus);
      return () => controller.removeStatusListener(handleStatus);
    }, [controller, expanded]);

    useEffect(() {
      controller.duration = reducedMotion
          ? Duration.zero
          : _kSectionExpandDuration;
      controller.reverseDuration = reducedMotion
          ? Duration.zero
          : _kSectionCollapseDuration;

      if (expanded) {
        shouldRender.value = true;
        if (reducedMotion) {
          controller.value = 1;
        } else {
          unawaited(controller.forward());
        }
      } else if (reducedMotion) {
        controller.value = 0;
        shouldRender.value = false;
      } else {
        unawaited(controller.reverse());
      }

      return null;
    }, [controller, expanded, reducedMotion]);

    return ClipRect(
      child: AnimatedBuilder(
        animation: curvedAnimation,
        child: shouldRender.value ? child : const SizedBox.shrink(),
        builder: (context, child) {
          final value = curvedAnimation.value.clamp(0.0, 1.0);
          final scaleY =
              _kSectionCollapsedScaleY +
              ((1 - _kSectionCollapsedScaleY) * value);

          return Align(
            alignment: Alignment.topCenter,
            heightFactor: value,
            child: Opacity(
              opacity: value,
              child: Transform.scale(
                alignment: Alignment.topCenter,
                scaleY: scaleY,
                child: ExcludeSemantics(
                  excluding: !expanded,
                  child: IgnorePointer(ignoring: !expanded, child: child),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

/// Original custom-section header menu (channels_page/sections.dart): rename,
/// move up/down and delete. Every choice is one Core preference write
/// (DD-150(3)); the list changes only when Core's readback does.
/// Runs one sort write and reports a refused or unconfirmed outcome (original
/// `setSortModeFor`; Kailo writes Core `sidebar_sort`, DD-150(3)).
Future<bool> _runSortWrite(
  BuildContext context,
  String groupKey,
  ChannelSortMode mode,
  Iterable<String> liveSectionIds,
) async {
  final container = ProviderScope.containerOf(context, listen: false);
  final ok = await container
      .read(channelSortProvider.notifier)
      .setSortModeFor(groupKey, mode, liveSectionIds: liveSectionIds);
  if (!ok && context.mounted) {
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      SnackBar(
        content: Text(
          _channelText(
            context,
            container.read(channelSortProvider).pending
                ? PlatformMessageKey.sidebarPreferenceUnknown
                : PlatformMessageKey.sidebarSortUpdateFailed,
          ),
        ),
      ),
    );
  }
  return ok;
}

const _kSortRecentMenuValue = 'sort_recent';
const _kSortAlphaMenuValue = 'sort_alpha';

/// Original `_sortMenuItems`: Recent and A–Z, the current one checked.
List<PopupMenuEntry<String>> _sortMenuItems(
  BuildContext context,
  ChannelSortMode current, {
  bool showDivider = true,
}) {
  PopupMenuItem<String> item(
    String value,
    PlatformMessageKey label,
    bool selected,
  ) => PopupMenuItem(
    value: value,
    child: Row(
      children: [
        Expanded(
          child: Text(
            '${_channelText(context, PlatformMessageKey.sidebarSort)}: '
            '${_channelText(context, label)}',
          ),
        ),
        if (selected)
          const Icon(LucideIcons.check, key: ValueKey('sort-selected-check'))
        else
          const SizedBox(width: 24),
      ],
    ),
  );
  return [
    if (showDivider) const PopupMenuDivider(),
    item(
      _kSortRecentMenuValue,
      PlatformMessageKey.sidebarRecent,
      current == ChannelSortMode.recent,
    ),
    item(
      _kSortAlphaMenuValue,
      PlatformMessageKey.sidebarAlpha,
      current == ChannelSortMode.alpha,
    ),
  ];
}

ChannelSortMode? _sortChoice(String? value) => switch (value) {
  _kSortRecentMenuValue => ChannelSortMode.recent,
  _kSortAlphaMenuValue => ChannelSortMode.alpha,
  _ => null,
};

/// Original built-in group header sort menu (Starred, Channels, Direct messages).
class _SortMenu extends StatelessWidget {
  const _SortMenu({
    required this.groupKey,
    required this.label,
    required this.mode,
  });

  final String groupKey;
  final String label;
  final ChannelSortMode mode;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      key: ValueKey('sort-menu-$groupKey'),
      tooltip: _channelText(
        context,
        PlatformMessageKey.sidebarMoreActions,
        variables: {'section': label},
      ),
      icon: Icon(
        LucideIcons.ellipsis,
        size: _kChannelIconSize,
        color: navigationSectionForeground(context),
      ),
      onSelected: (value) async {
        final next = _sortChoice(value);
        if (next != null)
          await _runSortWrite(context, groupKey, next, const []);
      },
      itemBuilder: (menuContext) =>
          _sortMenuItems(menuContext, mode, showDivider: false),
    );
  }
}

class _UserSectionMenu extends StatelessWidget {
  const _UserSectionMenu({
    required this.section,
    required this.channelCount,
    required this.isFirst,
    required this.isLast,
    required this.sortMode,
    required this.liveSectionIds,
  });

  final ChannelSectionRecord section;
  final int channelCount;
  final bool isFirst;
  final bool isLast;
  final ChannelSortMode sortMode;
  final List<String> liveSectionIds;

  @override
  Widget build(BuildContext context) {
    String t(PlatformMessageKey key, [Map<String, Object>? variables]) =>
        _channelText(context, key, variables: variables ?? const {});
    return PopupMenuButton<String>(
      key: ValueKey('channel-user-section-menu-${section.id}'),
      icon: Icon(
        LucideIcons.ellipsis,
        size: _kChannelIconSize,
        color: navigationSectionForeground(context),
      ),
      onSelected: (choice) async {
        final sort = _sortChoice(choice);
        if (sort != null) {
          await _runSortWrite(
            context,
            sectionSortGroupKey(section.id),
            sort,
            liveSectionIds,
          );
          return;
        }
        switch (choice) {
          case 'rename':
            final name = await showSectionNameDialog(
              context,
              initialValue: section.name,
              rename: true,
            );
            if (name == null || name.isEmpty || !context.mounted) return;
            await runSectionWrite(
              context,
              (notifier) => notifier.renameSection(section.id, name),
            );
          case 'up' || 'down':
            await runSectionWrite(
              context,
              (notifier) =>
                  notifier.moveSection(section.id, up: choice == 'up'),
            );
          case 'delete':
            final confirmed = await showBuzzDialog<bool>(
              context: context,
              builder: (dialogContext) => AlertDialog(
                title: Text(t(PlatformMessageKey.sidebarSectionDelete)),
                content: Text(
                  t(
                    channelCount == 0
                        ? PlatformMessageKey.sidebarSectionDeleteEmpty
                        : channelCount == 1
                        ? PlatformMessageKey.sidebarSectionDeleteOne
                        : PlatformMessageKey.sidebarSectionDeleteMany,
                    {'name': section.name, 'count': channelCount},
                  ),
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(dialogContext, false),
                    child: Text(t(PlatformMessageKey.platformCancel)),
                  ),
                  TextButton(
                    key: const ValueKey('channel-user-section-delete-confirm'),
                    onPressed: () => Navigator.pop(dialogContext, true),
                    child: Text(
                      t(PlatformMessageKey.sidebarSectionDeleteConfirm),
                      style: TextStyle(color: context.colors.error),
                    ),
                  ),
                ],
              ),
            );
            if (confirmed != true || !context.mounted) return;
            await runSectionWrite(
              context,
              (notifier) => notifier.deleteSection(section.id),
            );
        }
      },
      itemBuilder: (menuContext) => [
        PopupMenuItem(
          value: 'rename',
          child: Text(t(PlatformMessageKey.sidebarSectionRename)),
        ),
        if (!isFirst)
          PopupMenuItem(
            value: 'up',
            child: Text(t(PlatformMessageKey.sidebarSectionMoveUp)),
          ),
        if (!isLast)
          PopupMenuItem(
            value: 'down',
            child: Text(t(PlatformMessageKey.sidebarSectionMoveDown)),
          ),
        ..._sortMenuItems(menuContext, sortMode),
        PopupMenuItem(
          value: 'delete',
          child: Text(t(PlatformMessageKey.sidebarSectionDelete)),
        ),
      ],
    );
  }
}
